import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  attachRequiredMemoryToResult,
  convertToMemoryItems,
  formatRequiredMemoryContext,
  getRequiredMemoryContext,
  injectRequiredMemoryIntoModelRequest,
  invokeMemoryWorkflow,
  loadMemoryDescriptor,
  mergeRequiredMemoryIntoParts,
  resolveMemoryWorkflowMethod,
} from '../src/memory-context.js';

const root = path.resolve(__dirname, '..');

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe('cline-v2 required-memory injection', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      'MCP_PLUGIN_ROOT',
      'MCP_PLUGIN_HOST',
      'MCP_MEMORY_DESCRIPTOR_PATH',
      'MCP_MEMORY_REPL_RESPONSE',
      'MCP_PLUGIN_REPL_LOG',
      'MCP_PLUGIN_REPL_RESPONSE',
      'MCP_MEMORY_FETCH_ERROR',
    ]) {
      saved[key] = process.env[key];
    }
    process.env.MCP_PLUGIN_ROOT = root;
    process.env.MCP_PLUGIN_HOST = 'cline-v2';
    delete process.env.MCP_MEMORY_DESCRIPTOR_PATH;
    delete process.env.MCP_MEMORY_REPL_RESPONSE;
    delete process.env.MCP_PLUGIN_REPL_LOG;
    delete process.env.MCP_PLUGIN_REPL_RESPONSE;
    delete process.env.MCP_MEMORY_FETCH_ERROR;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      restoreEnv(key, value);
    }
  });

  test('loads the host descriptor and maps memory_* aliases to workflow.memory.*', () => {
    const descriptor = loadMemoryDescriptor({ pluginRoot: root, host: 'cline-v2' });
    expect(descriptor.loaded).toBe(true);
    expect(descriptor.host).toBe('cline-v2');
    expect(descriptor.path).toMatch(/memory-descriptor\.json$/);
    expect(descriptor.injection.requiredMemoriesPrefix).toBe('REQUIRED MEMORIES -');
    expect(descriptor.injection.emptyFallback).toBe('REQUIRED MEMORIES - None.');
    expect(resolveMemoryWorkflowMethod('memory_remember', descriptor)).toBe('workflow.memory.remember');
    expect(resolveMemoryWorkflowMethod('workflow.memory.list', descriptor)).toBe('workflow.memory.list');
  });

  test('renders explicit None when the stubbed memory fetch is empty', async () => {
    const context = await getRequiredMemoryContext({
      pluginRoot: root,
      fetchOverride: () => '',
    });
    expect(context).toBe('REQUIRED MEMORIES - None.');
  });

  test('renders descriptor prefix plus raw memory text from a stubbed fetch', async () => {
    const yaml = `type: result
payload:
  result:
    items:
      - id: MEMORY-REQ-001
        text: Raw memory text.
`;
    const context = await getRequiredMemoryContext({
      pluginRoot: root,
      fetchOverride: () => yaml,
    });
    expect(context).toBe('REQUIRED MEMORIES - MEMORY-REQ-001: Raw memory text.');
  });

  test('uses a custom descriptor path for prefix and empty fallback', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cline-v2-memory-desc-'));
    const custom = path.join(tmp, 'custom-memory-descriptor.json');
    fs.writeFileSync(
      custom,
      JSON.stringify({
        host: 'cline-v2',
        injection: {
          requiredMemoriesPrefix: 'CUSTOM MEMORIES -',
          emptyFallback: 'CUSTOM MEMORIES - None.',
        },
        tools: ['memory_list'],
        workflowMethods: { memory_list: 'workflow.memory.list' },
      }),
    );
    process.env.MCP_MEMORY_DESCRIPTOR_PATH = custom;
    try {
      const context = await getRequiredMemoryContext({
        pluginRoot: root,
        fetchOverride: () => '',
      });
      expect(context).toBe('CUSTOM MEMORIES - None.');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('fail-softs to None when the memory fetch throws', async () => {
    const context = await getRequiredMemoryContext({
      pluginRoot: root,
      fetchOverride: () => {
        throw new Error('mcp unavailable');
      },
    });
    expect(context).toBe('REQUIRED MEMORIES - None.');
  });

  test('fail-softs to None when MCP_MEMORY_FETCH_ERROR is set', async () => {
    process.env.MCP_MEMORY_FETCH_ERROR = '1';
    const context = await getRequiredMemoryContext({ pluginRoot: root });
    expect(context).toBe('REQUIRED MEMORIES - None.');
  });

  test('parses JSON, YAML, and line-oriented memory items', () => {
    expect(
      convertToMemoryItems({ payload: { result: { items: [{ id: 'MEMORY-REQ-002', text: 'From object.' }] } } }),
    ).toEqual([{ id: 'MEMORY-REQ-002', text: 'From object.' }]);
    expect(
      convertToMemoryItems('id: MEMORY-REQ-003\ntext: From lines.'),
    ).toEqual([{ id: 'MEMORY-REQ-003', text: 'From lines.' }]);
    expect(convertToMemoryItems('')).toEqual([]);
  });

  test('formats multiline memory text without losing the remainder', () => {
    const text = formatRequiredMemoryContext(undefined, [
      { id: 'MEMORY-REQ-004', text: 'First line.\nSecond line.' },
    ]);
    expect(text).toBe('REQUIRED MEMORIES - MEMORY-REQ-004: First line.\nSecond line.');
  });

  test('attachRequiredMemoryToResult is idempotent for the same context', () => {
    const first = attachRequiredMemoryToResult(
      { content: [{ type: 'text', text: 'hello' }] },
      'REQUIRED MEMORIES - None.',
    );
    const second = attachRequiredMemoryToResult(first, 'REQUIRED MEMORIES - None.');
    expect((second.content as Array<{ text: string }>)[0].text).toBe('REQUIRED MEMORIES - None.\n\nhello');
  });

  test('beforeModel helper injects once into the first model request', () => {
    const parts = mergeRequiredMemoryIntoParts([{ type: 'text', text: 'user prompt' }], 'REQUIRED MEMORIES - None.');
    expect(parts).toEqual([
      { type: 'text', text: 'user prompt' },
      { type: 'text', text: 'REQUIRED MEMORIES - None.' },
    ]);
    const injected = injectRequiredMemoryIntoModelRequest(
      { request: { messages: [{ role: 'user', content: 'hi' }] } },
      'REQUIRED MEMORIES - None.',
    );
    expect(injected?.messages).toHaveLength(2);
    expect(JSON.stringify(injected?.messages)).toContain('REQUIRED MEMORIES - None.');
    expect(
      injectRequiredMemoryIntoModelRequest(
        { request: { messages: injected?.messages } },
        'REQUIRED MEMORIES - None.',
      ),
    ).toBeUndefined();
  });

  test('invokeMemoryWorkflow resolves aliases through the descriptor registry', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cline-v2-memory-invoke-'));
    const log = path.join(tmp, 'repl-log.txt');
    fs.writeFileSync(log, '');
    process.env.MCP_PLUGIN_REPL_LOG = log;
    process.env.MCP_MEMORY_REPL_RESPONSE = 'type: result\npayload:\n  result:\n    ok: true\n';
    try {
      await invokeMemoryWorkflow('memory_recall', { query: 'auth' }, { pluginRoot: root });
      const logged = fs.readFileSync(log, 'utf8');
      expect(logged).toMatch(/workflow\.memory\.recall/);
      expect(logged).toMatch(/query: auth/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('src/plugin.ts wires beforeRun fetch and beforeModel inject', () => {
    const pluginSource = fs.readFileSync(path.join(root, 'src', 'plugin.ts'), 'utf8');
    const helperSource = fs.readFileSync(path.join(root, 'src', 'memory-context.ts'), 'utf8');
    expect(pluginSource).toContain('getRequiredMemoryContext');
    expect(pluginSource).toContain('injectRequiredMemoryIntoModelRequest');
    expect(pluginSource).toContain('beforeRun');
    expect(pluginSource).toContain('beforeModel');
    expect(helperSource).toContain("invoke('workflow.memory.list', { scope: 'Effective' })");
  });
});
