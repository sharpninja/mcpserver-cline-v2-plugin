import defaultPlugin, { allToolDescriptors, createMcpServerPlugin } from '../src/index.js';
import type { ReplBridge, ReplResponse } from '@sharpninja/mcpserver-plugin-core';

class FakeBridge {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  closed = false;
  nextResponse: ReplResponse = { type: 'result', payload: { ok: true } };
  responsesByMethod = new Map<string, ReplResponse>();
  throwOnInvoke = false;

  async invoke(method: string, params?: Record<string, unknown>): Promise<ReplResponse> {
    this.calls.push({ method, params });
    if (this.throwOnInvoke) throw new Error('mcp unavailable');
    return this.responsesByMethod.get(method) ?? this.nextResponse;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function asBridge(fake: FakeBridge): ReplBridge {
  return fake as unknown as ReplBridge;
}

function setupPlugin(fake = new FakeBridge()) {
  const plugin = createMcpServerPlugin({
    bridge: asBridge(fake),
    workspacePath: 'F:\\GitHub\\FeatureFlags',
    pluginRoot: process.cwd(),
    autoBootstrap: false,
    autoFlushCache: false,
  });
  const registered: Array<{ name: string; execute: (input: Record<string, unknown>, context?: unknown) => Promise<Record<string, unknown>> }> = [];
  const api = {
    registerTool(tool: (typeof registered)[number]) {
      registered.push(tool);
    },
  };
  plugin.setup?.(api as never, { workspaceInfo: { rootPath: 'F:\\GitHub\\FeatureFlags' } } as never);
  return { plugin, fake, registered };
}

describe('Cline V2 AgentPlugin contract', () => {
  test('exports a default AgentPlugin and factory', () => {
    expect(defaultPlugin.name).toBe('mcpserver-cline-v2-plugin');
    expect(defaultPlugin.manifest.capabilities).toEqual(expect.arrayContaining(['tools', 'hooks']));
    expect(typeof createMcpServerPlugin).toBe('function');
  });

  test('setup registers all expected Cline tools including workspace_ensure', () => {
    const { registered } = setupPlugin();
    const names = registered.map((tool) => tool.name);

    expect(names).toHaveLength(allToolDescriptors.length);
    expect(names).toEqual(expect.arrayContaining([
      'workspace_ensure',
      'todo_query',
      'todo_internal_status',
      'todo_internal_enable',
      'session_query_history',
      'req_generate_document',
      'graphrag_query',
    ]));
  });

  test('tool execution returns plain JSON and routes through the retained workflow method', async () => {
    const fake = new FakeBridge();
    fake.nextResponse = {
      type: 'result',
      payload: { result: { items: [], totalCount: 0 } },
    };
    const { registered } = setupPlugin(fake);
    const todoQuery = registered.find((tool) => tool.name === 'todo_query');
    if (!todoQuery) throw new Error('todo_query was not registered');

    const result = await todoQuery.execute({ keyword: 'MCP-TODO-001' }, {});

    expect(result).toEqual({ result: { items: [], totalCount: 0 } });
    expect(result).not.toHaveProperty('content');
    expect(fake.calls).toEqual([
      { method: 'workflow.todo.query', params: { keyword: 'MCP-TODO-001' } },
    ]);
  });

  test('lifecycle hooks open, audit, complete, and close a session without throwing', async () => {
    const { plugin, fake } = setupPlugin();
    const cyclicToolInput: Record<string, unknown> = { done: false };
    cyclicToolInput.self = cyclicToolInput;
    const cyclicToolContext: Record<string, unknown> = {
      toolCall: { name: 'todo_query', input: cyclicToolInput },
    };
    cyclicToolContext.self = cyclicToolContext;

    await plugin.hooks?.beforeRun?.({ prompt: 'Implement plugin test', modelId: 'test-model' } as never);
    await plugin.hooks?.beforeTool?.(cyclicToolContext as never);
    await plugin.hooks?.afterTool?.(cyclicToolContext as never);
    await plugin.hooks?.afterRun?.({ result: { output: 'complete' } } as never);

    expect(fake.calls.map((call) => call.method)).toContain('client.SessionLog.SubmitAsync');
    const dialogContents = fake.calls
      .flatMap((call) => {
        const turn = call.params?.turn as { processingDialog?: Array<{ content?: string }> } | undefined;
        const sessionLog = call.params?.sessionLog as
          | { turns?: Array<{ processingDialog?: Array<{ content?: string }> }> }
          | undefined;
        return [
          ...(turn?.processingDialog ?? []),
          ...(sessionLog?.turns?.flatMap((item) => item.processingDialog ?? []) ?? []),
        ];
      })
      .map((item) => JSON.parse(item.content ?? '{}'));
    expect(dialogContents).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: 'todo_query', input: { done: false }, status: 'pending' }),
      expect.objectContaining({ tool: 'todo_query', input: { done: false }, status: 'completed' }),
    ]));
    expect(JSON.stringify(dialogContents)).not.toContain('"self"');
    expect(fake.closed).toBe(true);
  });

  test('beforeRun fetches Effective memories and beforeModel injects them into the first request', async () => {
    const fake = new FakeBridge();
    fake.responsesByMethod.set('workflow.memory.list', {
      type: 'result',
      payload: { result: { items: [{ id: 'MEMORY-REQ-001', text: 'Raw memory text.' }] } },
    });
    const { plugin } = setupPlugin(fake);

    await plugin.hooks?.beforeRun?.({ prompt: 'Implement plugin test', modelId: 'test-model' } as never);
    expect(fake.calls).toEqual(expect.arrayContaining([
      { method: 'workflow.memory.list', params: { scope: 'Effective' } },
    ]));

    const first = await plugin.hooks?.beforeModel?.({
      snapshot: { iteration: 0 },
      request: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Implement plugin test' }] }] },
    } as never) as { messages?: Array<{ content?: unknown }> } | undefined;
    expect(JSON.stringify(first?.messages)).toContain('REQUIRED MEMORIES - MEMORY-REQ-001: Raw memory text.');

    const second = await plugin.hooks?.beforeModel?.({
      snapshot: { iteration: 1 },
      request: { messages: first?.messages ?? [] },
    } as never);
    expect(second).toBeUndefined();
  });

  test('beforeRun fail-softs and beforeModel still injects the None fallback', async () => {
    const fake = new FakeBridge();
    fake.throwOnInvoke = true;
    const { plugin } = setupPlugin(fake);

    await expect(plugin.hooks?.beforeRun?.({ prompt: 'still work' } as never)).resolves.toBeUndefined();
    const injected = await plugin.hooks?.beforeModel?.({
      request: { messages: [{ role: 'user', content: 'still work' }] },
    } as never) as { messages?: unknown[] } | undefined;
    expect(JSON.stringify(injected?.messages)).toContain('REQUIRED MEMORIES - None.');
  });
});
