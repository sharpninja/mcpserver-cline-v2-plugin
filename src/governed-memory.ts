// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  formatRequiredMemoryContext,
  type MemoryDescriptor,
  type MemoryFetchBridge,
  type MemoryItem,
} from './memory-context.js';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Required memory response is malformed.');
  return value as Record<string, unknown>;
}

/** Governed hosts use only their verified installation and bound bridge, never ambient stubs. */
export async function getGovernedRequiredMemoryContext(options: {
  pluginRoot: string;
  bridge: MemoryFetchBridge;
}): Promise<string> {
  try {
    if (!isAbsolute(options.pluginRoot) || typeof options.bridge?.invoke !== 'function') throw new Error();
    const descriptorPath = join(options.pluginRoot, 'memory-descriptor.json');
    const stat = lstatSync(descriptorPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error();
    const json = record(JSON.parse(readFileSync(descriptorPath, 'utf8')));
    const injection = record(json.injection);
    const fallback = record(json.fallback);
    const methods = record(json.workflowMethods);
    if (
      json.host !== 'cline-v2' ||
      typeof injection.requiredMemoriesPrefix !== 'string' ||
      !injection.requiredMemoriesPrefix.trim() ||
      typeof injection.emptyFallback !== 'string' ||
      !injection.emptyFallback.trim() ||
      fallback.localFailsafe !== true ||
      fallback.replayAfterAck !== true ||
      !Array.isArray(json.tools) ||
      !json.tools.every((tool) => typeof tool === 'string') ||
      !json.tools.includes('memory_list') ||
      methods.memory_list !== 'workflow.memory.list'
    )
      throw new Error();
    const descriptor: MemoryDescriptor = {
      host: 'cline-v2',
      path: descriptorPath,
      loaded: true,
      injection: {
        requiredMemoriesPrefix: injection.requiredMemoriesPrefix,
        emptyFallback: injection.emptyFallback,
      },
      fallback: { localFailsafe: true, replayAfterAck: true },
      tools: json.tools as string[],
      workflowMethods: { memory_list: 'workflow.memory.list' },
    };
    const response = record(await options.bridge.invoke('workflow.memory.list', { scope: 'Effective' }));
    if (response.type !== 'result' || response.error) throw new Error();
    const payload = record(response.payload);
    if (payload.error || payload.success === false || payload.ok === false) throw new Error();
    let result = record(payload.result ?? payload);
    if (result.result !== undefined) result = record(result.result);
    if (result.error || result.success === false || result.ok === false) throw new Error();
    const rows = result.items ?? result.Items;
    if (!Array.isArray(rows)) throw new Error();
    const ids = new Set<string>();
    const items: MemoryItem[] = rows.map((value) => {
      const item = record(value);
      if (typeof item.id !== 'string' || !item.id.trim() || typeof item.text !== 'string' || ids.has(item.id))
        throw new Error();
      ids.add(item.id);
      return { id: item.id, text: item.text };
    });
    return formatRequiredMemoryContext(descriptor, items);
  } catch (cause) {
    // Preserve a structured cause for host recovery; never print transport payloads.
    throw new Error('Required memory is unavailable or invalid; governed execution is blocked.', { cause });
  }
}

/** SDK request-only hook results are not persisted in conversation state. Inject on every request. */
export function injectGovernedRequiredMemory(context: unknown, memoryText: string): { messages: unknown[] } {
  const request = record(record(context).request);
  if (!Array.isArray(request.messages) || !memoryText.trim()) {
    throw new Error('Required memory could not be injected into the model request.');
  }
  return {
    messages: [
      ...request.messages,
      {
        id: `required-memories-${randomUUID()}`,
        role: 'user',
        content: [{ type: 'text', text: memoryText }],
        createdAt: Date.now(),
      },
    ],
  };
}
