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
              await core.bootstrapBestEffort(toolContext);
              return core.dispatchTool(
                descriptor.name,
                (input && typeof input === 'object' && !Array.isArray(input)
                  ? (input as Record<string, unknown>)
                  : {}),
              );
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
          await core.appendToolAction(context, 'pending');
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
          const failure = toolError(context);
          await core.appendToolAction(context, failure ? 'pending' : 'completed', failure);
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
