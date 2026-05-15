import defaultPlugin, { allToolDescriptors, createMcpServerPlugin } from '../src/index.js';
import type { ReplBridge, ReplResponse } from '../src/transport/repl-bridge.js';

class FakeBridge {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  closed = false;
  nextResponse: ReplResponse = { type: 'result', payload: { ok: true } };

  async invoke(method: string, params?: Record<string, unknown>): Promise<ReplResponse> {
    this.calls.push({ method, params });
    return this.nextResponse;
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

    const result = await todoQuery.execute({ id: 'MCP-TODO-001' }, {});

    expect(result).toEqual({ result: { items: [], totalCount: 0 } });
    expect(result).not.toHaveProperty('content');
    expect(fake.calls).toEqual([
      { method: 'workflow.todo.query', params: { id: 'MCP-TODO-001' } },
    ]);
  });

  test('lifecycle hooks open, audit, complete, and close a session without throwing', async () => {
    const { plugin, fake } = setupPlugin();

    await plugin.hooks?.beforeRun?.({ prompt: 'Implement plugin test', modelId: 'test-model' } as never);
    await plugin.hooks?.beforeTool?.({ toolCall: { name: 'todo_query', input: { done: false } } } as never);
    await plugin.hooks?.afterTool?.({ toolCall: { name: 'todo_query', input: { done: false } }, output: { ok: true } } as never);
    await plugin.hooks?.afterRun?.({ result: { output: 'complete' } } as never);

    expect(fake.calls.map((call) => call.method)).toContain('client.SessionLog.SubmitAsync');
    expect(fake.closed).toBe(true);
  });
});
