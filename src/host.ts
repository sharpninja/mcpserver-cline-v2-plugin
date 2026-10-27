// SPDX-License-Identifier: Apache-2.0
// This entrypoint has no runtime SDK import. Compiled and private hosts provide
// their existing SDK instance explicitly; no ambient package lookup is needed.
import { createPluginState, type McpServerPluginConfig } from './plugin-state.js';
export type { McpServerPluginConfig } from './plugin-state.js';
function freezePlain<T>(value: T, seen = new WeakSet<object>()): T {
  if (value !== null && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value)) freezePlain(child, seen);
    Object.freeze(value);
  }
  return value;
}

/** In-process host binding, outside optional plugin discovery and hook ordering.
 * The host must call lifecycle hooks and compose getRequiredModelContext at its
 * final model boundary. This is not a substitute for durable audit integration. */
export function createGovernedMcpServerHost(
  config: Omit<McpServerPluginConfig, 'governed'>,
  sdk: { readonly createTool: typeof import('@cline/core').createTool },
) {
  const createTool = sdk?.createTool;
  if (typeof createTool !== 'function')
    throw new Error('The governed host requires its own SDK tool factory.');
  const state = createPluginState({ ...config, governed: true }, createTool);
  const requiredTools = Object.freeze(
    state.createTools().map((tool) => {
      const { execute, ...metadata } = tool;
      return Object.freeze({ ...freezePlain(structuredClone(metadata)), execute });
    }),
  );
  const { beforeModel: _optionalModelHook, ...hooks } = state.plugin.hooks!;
  return Object.freeze({
    requiredTools,
    hooks: Object.freeze(hooks),
    readVerificationPolicy: state.readVerificationPolicy,
    async getRequiredModelContext() {
      const guidance = await state.getGuidance();
      const tools = requiredTools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema: structuredClone(inputSchema),
      }));
      return { guidance, tools };
    },
  });
}
