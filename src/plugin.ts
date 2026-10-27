import './qbrain-env.js';
import { createTool, type AgentPlugin } from '@cline/core';
import { createPluginState, type McpServerPluginConfig } from './plugin-state.js';
import { createGovernedMcpServerHost as createHost } from './host.js';
export { allToolDescriptors } from './plugin-state.js';
export type { McpServerPluginConfig } from './plugin-state.js';

/** Ordinary SDK plugin entrypoint; trusted product hosts load ./host directly. */
export function createMcpServerPlugin(config: McpServerPluginConfig = {}): AgentPlugin {
  return createPluginState(config, createTool).plugin;
}

/** Compatibility binding for SDK consumers that already resolve the declared peers. */
export function createGovernedMcpServerHost(config: Omit<McpServerPluginConfig, 'governed'>) {
  return createHost(config, { createTool });
}

export default createMcpServerPlugin();

/** QBrain.AI name retained as a compatibility alias. */
export const createQBrainAiPlugin = createMcpServerPlugin;
