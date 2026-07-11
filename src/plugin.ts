import { createTool, type AgentPlugin, type AgentToolContext } from '@cline/core';
import {
  createMcpServerPluginCore,
  allToolDescriptors,
  contextWorkspacePath,
  contextLogger,
  toolError,
  type HostContext,
  type ToolResult,
} from '@sharpninja/mcpserver-plugin-core';

/**
 * Host glue for the Cline V2 AgentPlugin.
 *
 * All transport, marker-trust, cache, tool-dispatch, and session-audit logic
 * lives in @sharpninja/mcpserver-plugin-core (Model C). This file keeps ONLY
 * the @cline/core SDK wiring: building the AgentPlugin, registering each core
 * tool descriptor via createTool/registerTool, and forwarding the run/tool
 * lifecycle hooks to the shared HostContext.
 */

export interface McpServerPluginConfig {
  agentName?: string;
  sessionTitle?: string;
  workspacePath?: string;
  bridge?: import('@sharpninja/mcpserver-plugin-core').ReplBridge;
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
    : inputRecord(rawToolInput(context, fallbackInput)) ?? {};
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

export function createMcpServerPlugin(config: McpServerPluginConfig = {}): AgentPlugin {
  const toolTimeoutMs = config.toolTimeoutMs ?? 30_000;
  const core: HostContext = createMcpServerPluginCore({
    agentName: config.agentName ?? 'Cline',
    pluginId: 'cline-v2',
    sessionTitle: config.sessionTitle,
    workspacePath: config.workspacePath,
    bridge: config.bridge,
    autoBootstrap: config.autoBootstrap,
    autoFlushCache: config.autoFlushCache,
    toolTimeoutMs,
  });

  const plugin: AgentPlugin = {
    name: 'mcpserver-cline-v2-plugin',
    manifest: {
      capabilities: ['tools', 'hooks'],
    },
    setup(api: PluginSetupApi, ctx: PluginSetupContext) {
      core.setWorkspacePath(contextWorkspacePath(ctx));
      core.resolveWorkspacePath(ctx);

      for (const descriptor of allToolDescriptors) {
        api.registerTool(
          createTool<unknown, ToolResult>({
            name: descriptor.name,
            description: descriptor.description,
            inputSchema: descriptor.inputSchema,
            timeoutMs: toolTimeoutMs,
            retryable: false,
            execute: async (input: unknown, toolContext: AgentToolContext) => {
              const normalizedInput = normalizeToolInput(input, descriptor);
              await core.bootstrapBestEffort(sanitizedToolContext(toolContext, descriptor, normalizedInput));
              return core.dispatchTool(descriptor.name, normalizedInput);
            },
          }),
        );
      }
    },
    hooks: {
      beforeRun: async (context: unknown) => {
        await core.bootstrapBestEffort(context);
        await core.flushCacheBestEffort(context);
        try {
          await core.startSession(context);
        } catch (error) {
          logWarn(
            context,
            `[mcpserver-cline-v2] beforeRun session audit failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        return undefined;
      },
      beforeTool: async (context: unknown) => {
        try {
          await core.appendToolAction(sanitizedToolContext(context), 'pending');
        } catch (error) {
          process.stderr.write(
            `[mcpserver-cline-v2] beforeTool audit failed: ${
              error instanceof Error ? error.message : String(error)
            }\n`,
          );
        }
        return undefined;
      },
      afterTool: async (context: unknown) => {
        try {
          const auditContext = sanitizedToolContext(context);
          const failure = toolError(auditContext);
          await core.appendToolAction(auditContext, failure ? 'pending' : 'completed', failure);
        } catch (error) {
          process.stderr.write(
            `[mcpserver-cline-v2] afterTool audit failed: ${
              error instanceof Error ? error.message : String(error)
            }\n`,
          );
        }
        return undefined;
      },
      afterRun: async (context: unknown) => {
        try {
          await core.completeSession(context);
        } catch (error) {
          logWarn(
            context,
            `[mcpserver-cline-v2] afterRun session audit failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        } finally {
          await core.bridge.close().catch(() => undefined);
        }
        return undefined;
      },
    },
  };

  return plugin;
}

export default createMcpServerPlugin();
