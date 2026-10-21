// SPDX-License-Identifier: Apache-2.0
import { isAbsolute, resolve } from 'node:path';
import {
  loadBundledGuidance,
  getEffectiveRequirementContext,
  type BundledGuidance,
} from './required-guidance.js';

import { getGovernedRequiredMemoryContext, injectGovernedRequiredMemory } from './governed-memory.js';
import type { AgentPlugin, AgentTool, AgentToolContext } from '@cline/core';
import {
  createQBrainAiPluginCore,
  fullBootstrap,
  readWorkspaceVerificationPolicy,
  type RequiredAgentPluginBinding,
  allToolDescriptors,
  contextWorkspacePath,
  contextLogger,
  toolError,
  type HostContext,
  type ToolResult,
} from '@qbrainai/qbrain-ai-plugin-core';
import {
  getMemoryPluginRoot,
  getRequiredMemoryContext,
  injectRequiredMemoryIntoModelRequest,
} from './memory-context.js';

/**
 * Host glue for the Cline V2 AgentPlugin.
 *
 * All transport, marker-trust, cache, tool-dispatch, and session-audit logic
 * lives in @qbrainai/qbrain-ai-plugin-core (Model C). This file keeps ONLY
 * the @cline/core SDK wiring: building the AgentPlugin, registering each core
 * tool descriptor via createTool/registerTool, and forwarding the run/tool
 * lifecycle hooks to the shared HostContext.
 */

export interface McpServerPluginConfig {
  /** Trusted product hosts enable this before construction; model/plugin settings cannot supply it. */
  governed?: boolean;
  fetch?: typeof globalThis.fetch;
  replCommand?: string;
  requiredAgentPlugin?: RequiredAgentPluginBinding;
  agentName?: string;
  sessionTitle?: string;
  workspacePath?: string;
  pluginRoot?: string;
  bridge?: import('@qbrainai/qbrain-ai-plugin-core').ReplBridge;
  autoBootstrap?: boolean;
  autoFlushCache?: boolean;
  toolTimeoutMs?: number;
}

export { allToolDescriptors };

type PluginSetup = NonNullable<AgentPlugin['setup']>;
type PluginSetupApi = Parameters<PluginSetup>[0];
type PluginSetupContext = Parameters<PluginSetup>[1];

type CoreToolDescriptor = (typeof allToolDescriptors)[number];

function inputRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function copySchemaFields(
  target: Record<string, unknown>,
  source: Record<string, unknown> | undefined,
  propertyNames: string[],
): void {
  if (!source) return;

  for (const propertyName of propertyNames) {
    if (Object.prototype.hasOwnProperty.call(source, propertyName)) {
      target[propertyName] = source[propertyName];
    }
  }
}

function normalizeToolInput(input: unknown, descriptor: CoreToolDescriptor): Record<string, unknown> {
  const schema = descriptor.inputSchema as { properties?: Record<string, unknown> };
  const propertyNames = Object.keys(schema.properties ?? {});
  if (propertyNames.length === 0) return {};

  const source = inputRecord(input);
  const normalized: Record<string, unknown> = {};
  copySchemaFields(normalized, source, propertyNames);

  for (const key of ['input', 'arguments', 'args', 'request']) {
    copySchemaFields(normalized, inputRecord(source?.[key]), propertyNames);
  }

  const toolCall = inputRecord(source?.toolCall);
  copySchemaFields(normalized, inputRecord(toolCall?.input), propertyNames);

  return normalized;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function hasOwn(record: Record<string, unknown> | undefined, propertyName: string): boolean {
  return !!record && Object.prototype.hasOwnProperty.call(record, propertyName);
}

function toolNameFromContext(context: unknown, fallback?: string): string {
  const source = inputRecord(context);
  const toolCall = inputRecord(source?.toolCall);
  const tool = inputRecord(source?.tool);
  return (
    stringValue(toolCall?.name) ??
    stringValue(tool?.name) ??
    stringValue(source?.toolName) ??
    stringValue(source?.name) ??
    fallback ??
    'unknown_tool'
  );
}

function rawToolInput(context: unknown, fallback?: unknown): unknown {
  const source = inputRecord(context);
  if (hasOwn(source, 'input')) return source?.input;

  const toolCall = inputRecord(source?.toolCall);
  if (hasOwn(toolCall, 'input')) return toolCall?.input;

  return fallback;
}

function descriptorByName(name: string): CoreToolDescriptor | undefined {
  return allToolDescriptors.find((descriptor) => descriptor.name === name);
}

function sanitizedToolContext(
  context: unknown,
  descriptor?: CoreToolDescriptor,
  fallbackInput?: unknown,
): Record<string, unknown> {
  const name = toolNameFromContext(context, descriptor?.name);
  const matchingDescriptor = descriptor ?? descriptorByName(name);
  const input = matchingDescriptor
    ? normalizeToolInput(rawToolInput(context, fallbackInput), matchingDescriptor)
    : (inputRecord(rawToolInput(context, fallbackInput)) ?? {});
  const sanitized: Record<string, unknown> = { toolCall: { name, input } };
  const workspacePath = contextWorkspacePath(context);
  if (workspacePath) sanitized.workspacePath = workspacePath;

  const failure = toolError(context);
  if (failure) sanitized.error = failure;

  return sanitized;
}

function logWarn(context: unknown, message: string): void {
  contextLogger(context).warn?.(message);
  process.stderr.write(`${message}\n`);
}

export function createPluginState(
  config: McpServerPluginConfig,
  createTool: typeof import('@cline/core').createTool,
) {
  config = Object.freeze({
    ...config,
    requiredAgentPlugin: config.requiredAgentPlugin
      ? Object.freeze({ ...config.requiredAgentPlugin })
      : undefined,
  });
  if (
    config.governed &&
    (!config.workspacePath ||
      !isAbsolute(config.workspacePath) ||
      !config.pluginRoot ||
      !isAbsolute(config.pluginRoot) ||
      typeof config.fetch !== 'function' ||
      config.agentName !== 'ClineQb' ||
      config.requiredAgentPlugin?.agentName !== config.agentName ||
      config.requiredAgentPlugin?.pluginName !== '@sharpninja/mcpserver-cline-v2-plugin' ||
      !config.requiredAgentPlugin.pluginVersion?.trim() ||
      !/^[a-f0-9]{64}$/i.test(config.requiredAgentPlugin.artifactSha256) ||
      config.autoBootstrap === false ||
      config.autoFlushCache === false ||
      (!config.bridge && (!config.replCommand || !isAbsolute(config.replCommand))))
  )
    throw new Error(
      'Governed V2 requires explicit workspace, installation, identity, artifact pin, fetch and REPL binding.',
    );
  const toolTimeoutMs = config.toolTimeoutMs ?? 30_000;
  const pluginRoot = config.governed ? resolve(config.pluginRoot!) : getMemoryPluginRoot(config.pluginRoot);
  const core: HostContext = createQBrainAiPluginCore({
    governed: config.governed,
    fetch: config.fetch,
    replCommand: config.replCommand,
    validateArguments: config.governed === true,
    agentName: config.agentName ?? 'Cline',
    pluginId: 'cline-v2',
    sessionTitle: config.sessionTitle,
    workspacePath: config.workspacePath,
    bridge: config.bridge,
    autoBootstrap: config.autoBootstrap,
    autoFlushCache: config.autoFlushCache,
    toolTimeoutMs,
  });

  let runReady = false;
  let runGeneration = 0;
  let runStarting = false;
  let governedBootstrap: Promise<Awaited<ReturnType<typeof fullBootstrap>>> | undefined;
  async function bootstrap(context: unknown): Promise<void> {
    if (!config.governed) return core.bootstrapBestEffort(context);
    core.resolveWorkspacePath(context);
    governedBootstrap ??= (async () => {
      const marker = await fullBootstrap(config.workspacePath!, {
        fetch: config.fetch,
        expectedWorkspacePath: config.workspacePath,
        requiredAgentPlugin: config.requiredAgentPlugin,
      });
      core.bridge.configureContext(marker);
      return marker;
    })();
    await governedBootstrap;
  }
  async function readVerificationPolicy() {
    try {
      if (!config.governed) throw new Error('Governed host required');
      const alreadyBound = governedBootstrap !== undefined;
      await bootstrap({ workspacePath: config.workspacePath });
      const bound = await governedBootstrap!;
      // A live bridge cannot be silently retargeted or have credentials replaced.
      const current = alreadyBound
        ? await fullBootstrap(config.workspacePath!, {
            fetch: config.fetch,
            expectedWorkspacePath: config.workspacePath,
            requiredAgentPlugin: config.requiredAgentPlugin,
          })
        : bound;
      if (
        !bound ||
        !current ||
        ['markerFile', 'baseUrl', 'apiKey', 'workspacePath', 'port'].some(
          (key) => current[key as keyof typeof current] !== bound[key as keyof typeof bound],
        ) ||
        current.agentPluginContract?.contractDigest !== bound.agentPluginContract?.contractDigest
      )
        throw new Error('Trusted binding changed');
      return await readWorkspaceVerificationPolicy(core.bridge, {
        workspacePath: config.workspacePath!,
        agentName: config.agentName!,
        pluginId: 'cline-v2',
        apiKey: bound.apiKey,
      });
    } catch {
      throw new Error('Governed V2 verification policy is unavailable or requires a new trusted host.');
    }
  }
  function assertReady(): void {
    if (config.governed && !runReady)
      throw new Error('Governed V2 run is not ready; model and tool execution are blocked.');
  }
  let bundledGuidance: BundledGuidance | undefined;
  let effectiveRequirements: string | undefined;
  let requiredMemoryContext: string | undefined;
  let requiredMemoryInjected = false;

  async function loadRequiredMemoryContext(context: unknown): Promise<string> {
    if (requiredMemoryContext !== undefined) return requiredMemoryContext;
    try {
      requiredMemoryContext = config.governed
        ? await getGovernedRequiredMemoryContext({ pluginRoot, bridge: core.bridge })
        : await getRequiredMemoryContext({
            pluginRoot,
            host: 'cline-v2',
            bridge: core.bridge,
          });
    } catch (error) {
      if (config.governed) {
        runReady = false;
        throw error;
      }
      logWarn(
        context,
        `[mcpserver-cline-v2] required-memory fetch failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      requiredMemoryContext = 'REQUIRED MEMORIES - None.';
    }
    return requiredMemoryContext;
  }

  async function getGuidance(): Promise<string> {
    assertReady();
    if (!config.governed || !bundledGuidance || effectiveRequirements === undefined)
      throw new Error('Required model context requires a ready governed host.');
    const generation = runGeneration;
    const guidance = bundledGuidance.text;
    const requirements = effectiveRequirements;
    const memory = await loadRequiredMemoryContext({});
    assertReady();
    if (generation !== runGeneration) throw new Error('Governed V2 run changed during model context read.');
    return [guidance, memory, requirements].join('\n\n');
  }
  function createTools(): AgentTool[] {
    const tools: AgentTool[] = [];
    if (config.governed) {
      tools.push(
        createTool<unknown, { id: string; content: string }>({
          name: 'qbrain_skill_read',
          description:
            'Read an applicable required bundled skill by exact inventory ID. Reading never executes the workflow.',
          inputSchema: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
            additionalProperties: false,
          },
          retryable: false,
          execute: async (raw: unknown) => {
            const input = inputRecord(raw);
            assertReady();
            if (
              !bundledGuidance ||
              !input ||
              typeof input.id !== 'string' ||
              Object.keys(input).some((key) => key !== 'id')
            )
              throw new Error('An exact required skill ID is required.');
            return { id: input.id, content: bundledGuidance.readSkill(input.id) };
          },
        }),
      );
    }

    for (const descriptor of allToolDescriptors) {
      tools.push(
        createTool<unknown, ToolResult>({
          name: descriptor.name,
          description: descriptor.description,
          inputSchema: descriptor.inputSchema,
          timeoutMs: toolTimeoutMs,
          retryable: false,
          execute: async (input: unknown, toolContext: AgentToolContext) => {
            const normalizedInput = normalizeToolInput(input, descriptor);
            assertReady();
            await bootstrap(sanitizedToolContext(toolContext, descriptor, normalizedInput));
            return core.dispatchTool(descriptor.name, normalizedInput);
          },
        }),
      );
    }
    return tools;
  }

  const plugin: AgentPlugin = {
    name: 'mcpserver-cline-v2-plugin',
    manifest: {
      capabilities: ['tools', 'hooks'],
    },
    setup(api: PluginSetupApi, ctx: PluginSetupContext) {
      core.setWorkspacePath(contextWorkspacePath(ctx));
      core.resolveWorkspacePath(ctx);

      for (const tool of createTools()) api.registerTool(tool);
    },
    hooks: {
      beforeRun: async (context: unknown) => {
        if (config.governed && (runReady || runStarting))
          throw new Error('Governed V2 already has an active run.');
        runStarting = true;
        runGeneration++;
        try {
          requiredMemoryContext = undefined;
          requiredMemoryInjected = false;
          effectiveRequirements = undefined;
          bundledGuidance = config.governed ? loadBundledGuidance(pluginRoot) : undefined;
          await bootstrap(context);
          await core.flushCacheBestEffort(context);
          try {
            await core.startSession(context);
          } catch (error) {
            if (config.governed) {
              runReady = false;
              throw error;
            }
            logWarn(
              context,
              `[mcpserver-cline-v2] beforeRun session audit failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
          await loadRequiredMemoryContext(context);
          if (config.governed) effectiveRequirements = await getEffectiveRequirementContext(core.bridge);
          runReady = true;
          return undefined;
        } finally {
          runStarting = false;
        }
      },
      beforeModel: async (context: unknown) => {
        assertReady();
        if (!config.governed && requiredMemoryInjected) return undefined;
        try {
          const text = config.governed ? await getGuidance() : await loadRequiredMemoryContext(context);
          const injected = config.governed
            ? injectGovernedRequiredMemory(context, text)
            : injectRequiredMemoryIntoModelRequest(context, text);
          if (injected) {
            requiredMemoryInjected = true;
            return injected as NonNullable<
              Awaited<ReturnType<NonNullable<NonNullable<AgentPlugin['hooks']>['beforeModel']>>>
            >;
          }
          if (config.governed)
            throw new Error('Required memory could not be injected into the model request.');
          if (text.trim()) requiredMemoryInjected = true;
        } catch (error) {
          if (config.governed) {
            runReady = false;
            throw error;
          }
          logWarn(
            context,
            `[mcpserver-cline-v2] beforeModel required-memory inject failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        return undefined;
      },
      beforeTool: async (context: unknown) => {
        assertReady();
        try {
          await core.appendToolAction(sanitizedToolContext(context), 'pending');
        } catch (error) {
          if (config.governed) {
            runReady = false;
            throw error;
          }
          process.stderr.write(
            `[mcpserver-cline-v2] beforeTool audit failed: ${
              error instanceof Error ? error.message : String(error)
            }\n`,
          );
        }
        return undefined;
      },
      afterTool: async (context: unknown) => {
        assertReady();
        try {
          const auditContext = sanitizedToolContext(context);
          const failure = toolError(auditContext);
          await core.appendToolAction(auditContext, failure ? 'pending' : 'completed', failure);
        } catch (error) {
          if (config.governed) {
            runReady = false;
            throw error;
          }
          process.stderr.write(
            `[mcpserver-cline-v2] afterTool audit failed: ${
              error instanceof Error ? error.message : String(error)
            }\n`,
          );
        }
        return undefined;
      },
      afterRun: async (context: unknown) => {
        if (config.governed && runStarting)
          throw new Error('Governed V2 startup must finish before ending the run.');
        runReady = false;
        runGeneration++;
        let completionError: unknown;
        requiredMemoryContext = undefined;
        requiredMemoryInjected = false;
        try {
          await core.completeSession(context);
        } catch (error) {
          if (config.governed) {
            completionError = error;
            throw error;
          }
          logWarn(
            context,
            `[mcpserver-cline-v2] afterRun session audit failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        } finally {
          try {
            await core.bridge.close();
          } catch (error) {
            if (config.governed && !completionError) throw error;
          } finally {
            governedBootstrap = undefined;
          }
        }
        return undefined;
      },
    },
  };

  if (config.governed) {
    Object.freeze(plugin.hooks);
    Object.freeze(plugin.manifest.capabilities);
    Object.freeze(plugin.manifest);
    Object.freeze(plugin);
  }
  return {
    plugin,
    createTools,
    getGuidance,
    readVerificationPolicy,
  };
}
