// SPDX-License-Identifier: Apache-2.0
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getGovernedRequiredMemoryContext } from '../src/governed-memory.js';

const source = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'memory-descriptor.json'), 'utf8'));
const directories: string[] = [];
function fixture(descriptor = source) {
  const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qb-required-memory-'));
  directories.push(pluginRoot);
  fs.writeFileSync(path.join(pluginRoot, 'memory-descriptor.json'), JSON.stringify(descriptor));
  const bridge = {
    invoke: jest.fn().mockResolvedValue({ type: 'result', payload: { result: { items: [] } } }),
  };
  return { pluginRoot, bridge };
}
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

test('explicit successful empty list is the only None path', async () => {
  const options = fixture();
  await expect(getGovernedRequiredMemoryContext(options)).resolves.toBe('REQUIRED MEMORIES - None.');
  expect(options.bridge.invoke).toHaveBeenCalledWith('workflow.memory.list', { scope: 'Effective' });
});

test('renders all successful memories preserving text', async () => {
  const options = fixture();
  options.bridge.invoke.mockResolvedValue({
    type: 'result',
    payload: { result: { items: [{ id: 'MEMORY-REQ-001', text: 'first\nsecond' }] } },
  });
  await expect(getGovernedRequiredMemoryContext(options)).resolves.toBe(
    'REQUIRED MEMORIES - MEMORY-REQ-001: first\nsecond',
  );
});

test('ignores ambient memory stubs, descriptor override, failure and log routing', async () => {
  const options = fixture();
  const keys = [
    'MCP_MEMORY_REPL_RESPONSE',
    'MCP_PLUGIN_REPL_RESPONSE',
    'MCP_MEMORY_DESCRIPTOR_PATH',
    'MCP_MEMORY_FETCH_ERROR',
    'MCP_PLUGIN_REPL_LOG',
  ];
  const saved = keys.map((key) => process.env[key]);
  try {
    for (const key of keys)
      process.env[key] = key === 'MCP_MEMORY_FETCH_ERROR' ? '1' : '/invalid/ambient-stub';
    await expect(getGovernedRequiredMemoryContext(options)).resolves.toBe('REQUIRED MEMORIES - None.');
    expect(options.bridge.invoke).toHaveBeenCalledTimes(1);
  } finally {
    keys.forEach((key, index) => {
      if (saved[index] === undefined) delete process.env[key];
      else process.env[key] = saved[index];
    });
  }
});

test.each([
  undefined,
  '',
  {},
  { type: 'error', payload: { message: 'unavailable' } },
  { type: 'result', payload: { result: {} } },
  { type: 'result', payload: { error: 'failed', result: { items: [] } } },
  { type: 'result', payload: { result: { success: false, items: [] } } },
  { type: 'result', payload: { result: { items: [{}] } } },
  {
    type: 'result',
    payload: {
      result: {
        items: [
          { id: 'same', text: 'a' },
          { id: 'same', text: 'b' },
        ],
      },
    },
  },
])('refuses unsuccessful or malformed response %#', async (response) => {
  const options = fixture();
  options.bridge.invoke.mockResolvedValue(response);
  await expect(getGovernedRequiredMemoryContext(options)).rejects.toThrow('governed execution is blocked');
});

test('transport error is preserved as cause without becoming None', async () => {
  const options = fixture();
  const cause = new Error('transport failed');
  options.bridge.invoke.mockRejectedValue(cause);
  await expect(getGovernedRequiredMemoryContext(options)).rejects.toMatchObject({ cause });
});

test.each([
  { ...source, host: 'another-host' },
  { ...source, injection: {} },
  { ...source, fallback: { localFailsafe: false, replayAfterAck: true } },
  { ...source, tools: [] },
  { ...source, workflowMethods: {} },
])('refuses invalid required descriptor %# before invoking transport', async (descriptor) => {
  const options = fixture(descriptor);
  await expect(getGovernedRequiredMemoryContext(options)).rejects.toThrow();
  expect(options.bridge.invoke).not.toHaveBeenCalled();
});

test.each(['missing', 'symlink', 'malformed'])('refuses %s descriptor', async (kind) => {
  const options = fixture();
  const file = path.join(options.pluginRoot, 'memory-descriptor.json');
  if (kind === 'malformed') fs.writeFileSync(file, 'not json');
  else {
    fs.rmSync(file);
    if (kind === 'symlink') fs.symlinkSync(path.join(process.cwd(), 'memory-descriptor.json'), file);
  }
  await expect(getGovernedRequiredMemoryContext(options)).rejects.toThrow();
  expect(options.bridge.invoke).not.toHaveBeenCalled();
});
