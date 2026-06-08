import { createTool, type AgentPlugin, type AgentToolContext } from '@cline/core';
import * as path from 'path';
import { ReplBridge } from './transport/repl-bridge.js';
import { fullBootstrap, type MarkerContext } from './discovery/marker-resolver.js';
import { cacheFlush } from './cache/cache-manager.js';
import { todoTools, canHandleTodoTool, handleTodoTool } from './tools/todo.js';
import { sessionTools, canHandleSessionTool, handleSessionTool } from './tools/session.js';
import { memoryTools, canHandleMemoryTool, handleMemoryTool } from './tools/memory.js';
import { requirementsTools, canHandleRequirementsTool, handleRequirementsTool } from './tools/requirements.js';
import { graphragTools, canHandleGraphragTool, handleGraphragTool } from './tools/graphrag.js';
import { workspaceTools, canHandleWorkspaceTool, handleWorkspaceTool } from './tools/workspace.js';
import type { ToolDescriptor, ToolResult } from './tool-descriptor.js';

export interface McpServerPluginConfig {
  agentName?: string;
  sessionTitle?: string;
  workspacePath?: string;
  bridge?: ReplBridge;
  autoBootstrap?: boolean;
  autoFlushCache?: boolean;
  toolTimeoutMs?: number;
}

export const allToolDescriptors: ToolDescriptor[] = [
  ...workspaceTools,
  ...todoTools,
  ...sessionTools,
  ...memoryTools,
  ...requirementsTools,
  ...graphragTools,
];

type PluginSetup = NonNullable<AgentPlugin['setup']>;
type PluginSetupApi = Parameters<PluginSetup>[0];
type PluginSetupContext = Parameters<PluginSetup>[1];

function utcStamp(date = new Date()): string {
  return (
    date.getUTCFullYear().toString() +
    (date.getUTCMonth() + 1).toString().padStart(2, '0') +
    date.getUTCDate().toString().padStart(2, '0') +
    'T' +
    date.getUTCHours().toString().padStart(2, '0') +
    date.getUTCMinutes().toString().padStart(2, '0') +
    date.getUTCSeconds().toString().padStart(2, '0') +
    'Z'
  );
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'run';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function contextWorkspacePath(value: unknown): string | undefined {
  const record = asRecord(value);
  const direct =
    stringValue(record.workspacePath) ||
    stringValue(record.workspaceRoot) ||
    stringValue(record.cwd) ||
    stringValue(record.rootPath);
  if (direct) return direct;

  const workspaceInfo = asRecord(record.workspaceInfo);
  return stringValue(workspaceInfo.rootPath) || stringValue(workspaceInfo.workspacePath);
}

function contextPrompt(value: unknown): string {
  const record = asRecord(value);
  const snapshot = asRecord(record.snapshot);
  return (
    stringValue(record.prompt) ||
    stringValue(record.input) ||
    stringValue(record.queryText) ||
    stringValue(snapshot.prompt) ||
    stringValue(snapshot.input) ||
    stringValue(snapshot.queryText) ||
    'Cline run'
  );
}

function contextModel(value: unknown): string | undefined {
  const record = asRecord(value);
  const snapshot = asRecord(record.snapshot);
  return stringValue(record.model) || stringValue(record.modelId) || stringValue(snapshot.model) || stringValue(snapshot.modelId);
}

function toolName(value: unknown): string {
  const record = asRecord(value);
  const toolCall = asRecord(record.toolCall);
  const tool = asRecord(record.tool);
  return stringValue(toolCall.name) || stringValue(tool.name) || stringValue(record.toolName) || stringValue(record.name) || 'unknown_tool';
}

function toolInput(value: unknown): unknown {
  const record = asRecord(value);
  if (Object.prototype.hasOwnProperty.call(record, 'input')) return record.input;
  const toolCall = asRecord(record.toolCall);
  if (Object.prototype.hasOwnProperty.call(toolCall, 'input')) return toolCall.input;
  return undefined;
}

function toolError(value: unknown): string | undefined {
  const record = asRecord(value);
  const error = record.error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'string' && error.length > 0) return error;
  const toolCall = asRecord(record.toolCall);
  const callError = toolCall.error;
  if (callError instanceof Error) return callError.message;
  if (typeof callError === 'string' && callError.length > 0) return callError;
  return undefined;
}

function logger(value: unknown): { warn?: (message: string) => void; error?: (message: string) => void } {
  return asRecord(value).logger as { warn?: (message: string) => void; error?: (message: string) => void };
}

function setMarkerEnvironment(marker: MarkerContext, agentName: string): void {
  process.env.MCPSERVER_BASE_URL = marker.baseUrl;
  process.env.MCPSERVER_API_KEY = marker.apiKey;
  process.env.MCPSERVER_WORKSPACE_PATH = marker.workspacePath;
  process.env.MCP_WORKSPACE_PATH = marker.workspacePath;
  process.env.MCPSERVER_WORKSPACE = marker.workspace;
  process.env.PLUGIN_AGENT_NAME = agentName;
}

export function createMcpServerPlugin(config: McpServerPluginConfig = {}): AgentPlugin {
  const agentName = config.agentName ?? 'Cline';
  const bridge = config.bridge ?? new ReplBridge();
  let setupWorkspacePath = config.workspacePath;
  let bootstrappedWorkspace: string | undefined;
  let activeSessionId: string | undefined;
  let activeRequestId: string | undefined;
  let actionOrder = 0;
  let cacheFlushed = false;

  async function bootstrap(context?: unknown): Promise<MarkerContext | null> {
    const workspacePath =
      config.workspacePath ||
      contextWorkspacePath(context) ||
      setupWorkspacePath ||
      process.env.MCPSERVER_WORKSPACE_PATH ||
      process.env.MCP_WORKSPACE_PATH ||
      process.cwd();
    setupWorkspacePath = workspacePath;

    if (config.autoBootstrap === false) return null;
    if (bootstrappedWorkspace && path.resolve(bootstrappedWorkspace) === path.resolve(workspacePath)) return null;

    const marker = await fullBootstrap(workspacePath);
    setMarkerEnvironment(marker, agentName);
    bootstrappedWorkspace = marker.workspacePath;
    return marker;
  }

  async function bootstrapBestEffort(context?: unknown): Promise<void> {
    try {
      await bootstrap(context);
    } catch (error) {
      const message = `[mcpserver-cline-v2] marker bootstrap failed; continuing with failsafe behavior: ${
        error instanceof Error ? error.message : String(error)
      }`;
      logger(context).warn?.(message);
      process.stderr.write(`${message}\n`);
    }
  }

  async function flushCacheBestEffort(context?: unknown): Promise<void> {
    if (config.autoFlushCache === false || cacheFlushed) return;
    try {
      const result = await cacheFlush(bridge);
      cacheFlushed = true;
      if (result.flushed > 0 || result.failed > 0) {
        process.stderr.write(
          `[mcpserver-cline-v2] failsafe replay flushed=${result.flushed} failed=${result.failed} pending=${result.pending}\n`,
        );
      }
    } catch (error) {
      const message = `[mcpserver-cline-v2] failsafe replay failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      logger(context).warn?.(message);
      process.stderr.write(`${message}\n`);
    }
  }

  async function dispatchTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (canHandleWorkspaceTool(name)) return handleWorkspaceTool(name, args, bridge, setupWorkspacePath);
    if (canHandleTodoTool(name)) return handleTodoTool(name, args, bridge);
    if (canHandleSessionTool(name)) return handleSessionTool(name, args, bridge);
    if (canHandleMemoryTool(name)) return handleMemoryTool(name, args, bridge);
    if (canHandleRequirementsTool(name)) return handleRequirementsTool(name, args, bridge);
    if (canHandleGraphragTool(name)) return handleGraphragTool(name, args, bridge);
    throw new Error(`Unknown tool: ${name}`);
  }

  async function invokeSession(name: string, args: Record<string, unknown>): Promise<void> {
    await handleSessionTool(name, args, bridge);
  }

  async function startSession(context?: unknown): Promise<void> {
    const stamp = utcStamp();
    const prompt = contextPrompt(context);
    activeSessionId = activeSessionId ?? `${agentName}-${stamp}-${slug(setupWorkspacePath ?? 'workspace')}`;
    activeRequestId = `req-${stamp}-${slug(prompt)}`;
    await invokeSession('session_bootstrap', {});
    await invokeSession('session_open', {
      agent: agentName,
      sessionId: activeSessionId,
      title: config.sessionTitle ?? prompt.slice(0, 120),
      model: contextModel(context),
    });
    await invokeSession('session_begin_turn', {
      requestId: activeRequestId,
      queryTitle: prompt.slice(0, 120),
      queryText: prompt,
    });
  }

  async function completeSession(context?: unknown): Promise<void> {
    if (!activeSessionId || !activeRequestId) return;
    const record = asRecord(context);
    const result = asRecord(record.result);
    const error = toolError(context) || stringValue(result.error);
    if (error) {
      await invokeSession('session_fail_turn', { errorMessage: error, errorCode: 'cline_run_failed' });
      await invokeSession('session_close', { agent: agentName, sessionId: activeSessionId, status: 'failed' });
    } else {
      await invokeSession('session_complete_turn', {
        response: stringValue(result.output) || stringValue(record.response) || 'Cline run completed.',
      });
      await invokeSession('session_close', { agent: agentName, sessionId: activeSessionId, status: 'completed' });
    }
    activeRequestId = undefined;
  }

  async function appendToolAction(context: unknown, status: 'pending' | 'completed', error?: string): Promise<void> {
    if (!activeRequestId) return;
    const name = toolName(context);
    const input = toolInput(context);
    await invokeSession('session_append_actions', {
      actions: [
        {
          order: ++actionOrder,
          type: 'design_decision',
          status,
          description: error
            ? `Cline tool ${name} failed: ${error}`
            : `Cline tool ${name} ${status === 'pending' ? 'started' : 'completed'}`,
        },
      ],
    });
    await invokeSession('session_append_dialog', {
      dialogItems: [
        {
          timestamp: new Date().toISOString(),
          role: 'tool',
          category: error ? 'tool_result' : status === 'pending' ? 'tool_call' : 'tool_result',
          content: JSON.stringify({ tool: name, input, status, ...(error ? { error } : {}) }),
        },
      ],
    });
  }

  const plugin: AgentPlugin = {
    name: 'mcpserver-cline-v2-plugin',
    manifest: {
      capabilities: ['tools', 'hooks'],
    },
    setup(api: PluginSetupApi, ctx: PluginSetupContext) {
      setupWorkspacePath =
        config.workspacePath ||
        contextWorkspacePath(ctx) ||
        setupWorkspacePath ||
        process.env.MCPSERVER_WORKSPACE_PATH ||
        process.env.MCP_WORKSPACE_PATH ||
        process.cwd();

      for (const descriptor of allToolDescriptors) {
        api.registerTool(
          createTool<unknown, ToolResult>({
            name: descriptor.name,
            description: descriptor.description,
            inputSchema: descriptor.inputSchema,
            timeoutMs: config.toolTimeoutMs ?? 30_000,
            retryable: false,
            execute: async (input: unknown, toolContext: AgentToolContext) => {
              await bootstrapBestEffort(toolContext);
              return dispatchTool(descriptor.name, asRecord(input));
            },
          }),
        );
      }
    },
    hooks: {
      beforeRun: async (context: unknown) => {
        await bootstrapBestEffort(context);
        await flushCacheBestEffort(context);
        try {
          await startSession(context);
        } catch (error) {
          const message = `[mcpserver-cline-v2] beforeRun session audit failed: ${
            error instanceof Error ? error.message : String(error)
          }`;
          logger(context).warn?.(message);
          process.stderr.write(`${message}\n`);
        }
        return undefined;
      },
      beforeTool: async (context: unknown) => {
        try {
          await appendToolAction(context, 'pending');
        } catch (error) {
          process.stderr.write(
            `[mcpserver-cline-v2] beforeTool audit failed: ${error instanceof Error ? error.message : String(error)}\n`,
          );
        }
        return undefined;
      },
      afterTool: async (context: unknown) => {
        try {
          await appendToolAction(context, toolError(context) ? 'pending' : 'completed', toolError(context));
        } catch (error) {
          process.stderr.write(
            `[mcpserver-cline-v2] afterTool audit failed: ${error instanceof Error ? error.message : String(error)}\n`,
          );
        }
        return undefined;
      },
      afterRun: async (context: unknown) => {
        try {
          await completeSession(context);
        } catch (error) {
          const message = `[mcpserver-cline-v2] afterRun session audit failed: ${
            error instanceof Error ? error.message : String(error)
          }`;
          logger(context).warn?.(message);
          process.stderr.write(`${message}\n`);
        } finally {
          await bridge.close().catch(() => undefined);
        }
        return undefined;
      },
      onEvent: async (event: unknown) => {
        if (!activeRequestId) return;
        try {
          await invokeSession('session_append_dialog', {
            dialogItems: [
              {
                timestamp: new Date().toISOString(),
                role: 'system',
                category: 'observation',
                content: JSON.stringify(event),
              },
            ],
          });
        } catch (error) {
          process.stderr.write(
            `[mcpserver-cline-v2] onEvent audit failed: ${error instanceof Error ? error.message : String(error)}\n`,
          );
        }
      },
    },
  };

  return plugin;
}

export default createMcpServerPlugin();
