// SPDX-License-Identifier: Apache-2.0
import { createQBrainAiPluginCore, fullBootstrap, type ReplBridge } from '@qbrainai/qbrain-ai-plugin-core';
import {
  createGovernedMcpServerHost,
  createMcpServerPlugin,
  type McpServerPluginConfig,
} from '../src/plugin.js';

jest.mock('@qbrainai/qbrain-ai-plugin-core', () => {
  const actual = jest.requireActual('@qbrainai/qbrain-ai-plugin-core');
  return {
    ...actual,
    fullBootstrap: jest.fn(),
    createQBrainAiPluginCore: jest.fn((config) => ({
      bridge: config.bridge ?? { configureContext: jest.fn(), close: jest.fn().mockResolvedValue(undefined) },
      setWorkspacePath: jest.fn(),
      resolveWorkspacePath: jest.fn(() => config.workspacePath),
      bootstrapBestEffort: jest.fn().mockResolvedValue(undefined),
      flushCacheBestEffort: jest.fn().mockResolvedValue(undefined),
      startSession: jest.fn().mockResolvedValue(undefined),
      completeSession: jest.fn().mockResolvedValue(undefined),
      appendToolAction: jest.fn().mockResolvedValue(undefined),
      dispatchTool: jest.fn().mockResolvedValue({ ok: true }),
    })),
  };
});

function configuration(): McpServerPluginConfig {
  return {
    governed: true,
    agentName: 'ClineQb',
    workspacePath: process.cwd(),
    pluginRoot: process.cwd(),
    fetch: jest.fn(),
    requiredAgentPlugin: {
      agentName: 'ClineQb',
      pluginName: '@sharpninja/mcpserver-cline-v2-plugin',
      pluginVersion: '1.118.0',
      artifactSha256: 'a'.repeat(64),
    },
    bridge: {
      governed: true,
      configureContext: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
      invoke: jest.fn().mockImplementation(async (method: string) => ({
        type: 'result',
        payload: {
          result:
            method === 'workflow.requirements.effective'
              ? {
                  currentLayer: { key: 'layer-1', name: 'Workspace' },
                  functional: [],
                  technical: [],
                  testing: [],
                  mappings: [],
                }
              : { items: [] },
        },
      })),
    } as unknown as ReplBridge,
  };
}
function fixture(config = configuration()) {
  const plugin = createMcpServerPlugin(config);
  const core = jest.mocked(createQBrainAiPluginCore).mock.results.at(-1)!.value;
  const tools: Array<{ name: string; execute: (input: unknown, context: unknown) => Promise<unknown> }> = [];
  plugin.setup?.(
    { registerTool: (tool: (typeof tools)[number]) => tools.push(tool) } as never,
    { workspaceInfo: { rootPath: process.cwd() } } as never,
  );
  return { plugin, core, tools, config };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fullBootstrap).mockResolvedValue({
    markerFile: 'fixture',
    baseUrl: 'http://127.0.0.1',
    apiKey: 'fixture',
    workspace: 'fixture',
    workspacePath: process.cwd(),
    port: '1',
  });
});

test.each([
  'workspacePath',
  'pluginRoot',
  'fetch',
  'requiredAgentPlugin',
  'agentName',
] as const)('requires explicit governed %s', (field) => {
  const config = configuration();
  delete config[field];
  expect(() => createMcpServerPlugin(config)).toThrow('Governed V2 requires');
});
test.each(['autoBootstrap', 'autoFlushCache'] as const)('refuses %s=false', (field) => {
  expect(() => createMcpServerPlugin({ ...configuration(), [field]: false })).toThrow();
});
test('captures host config, forwards guarded transport settings and freezes hooks', async () => {
  const config = configuration();
  const fetcher = config.fetch;
  const expected = { ...config.requiredAgentPlugin! };
  const { plugin, core } = fixture(config);
  Object.assign(config.requiredAgentPlugin!, { artifactSha256: 'b'.repeat(64) });
  config.fetch = jest.fn();
  config.governed = false;
  expect(createQBrainAiPluginCore).toHaveBeenLastCalledWith(
    expect.objectContaining({
      governed: true,
      fetch: fetcher,
      validateArguments: true,
      workspacePath: process.cwd(),
    }),
  );
  await plugin.hooks?.beforeRun?.({} as never);
  expect(fullBootstrap).toHaveBeenCalledWith(process.cwd(), {
    fetch: fetcher,
    expectedWorkspacePath: process.cwd(),
    requiredAgentPlugin: expected,
  });
  expect(core.bootstrapBestEffort).not.toHaveBeenCalled();
  expect(core.bridge.configureContext).toHaveBeenCalledTimes(1);
  expect(Object.isFrozen(plugin)).toBe(true);
  expect(Object.isFrozen(plugin.hooks)).toBe(true);
  expect(Object.isFrozen(plugin.manifest.capabilities)).toBe(true);
});
test('refuses model, hook and direct tool execution before a successful run', async () => {
  const { plugin, tools, core } = fixture();
  await expect(plugin.hooks?.beforeModel?.({} as never)).rejects.toThrow('run is not ready');
  await expect(plugin.hooks?.beforeTool?.({} as never)).rejects.toThrow('run is not ready');
  await expect(tools[0].execute({}, {})).rejects.toThrow('run is not ready');
  expect(core.dispatchTool).not.toHaveBeenCalled();
});
test('invalid signed binding stops before session or transport configuration', async () => {
  const { plugin, core } = fixture();
  jest.mocked(fullBootstrap).mockRejectedValueOnce(new Error('wrong signed artifact'));
  await expect(plugin.hooks?.beforeRun?.({} as never)).rejects.toThrow('wrong signed artifact');
  expect(core.startSession).not.toHaveBeenCalled();
  expect(core.bridge.configureContext).not.toHaveBeenCalled();
});
test.each([
  'flushCacheBestEffort',
  'startSession',
] as const)('propagates %s failure and blocks model', async (method) => {
  const { plugin, core } = fixture();
  jest.mocked(core[method]).mockRejectedValueOnce(new Error('required audit failed'));
  await expect(plugin.hooks?.beforeRun?.({} as never)).rejects.toThrow('required audit failed');
  await expect(plugin.hooks?.beforeModel?.({} as never)).rejects.toThrow('run is not ready');
});
test('failed required memory blocks the model', async () => {
  const { plugin, core } = fixture();
  jest.mocked(core.bridge.invoke).mockRejectedValueOnce(new Error('memory unavailable'));
  await expect(plugin.hooks?.beforeRun?.({} as never)).rejects.toThrow('Required memory');
  await expect(plugin.hooks?.beforeModel?.({} as never)).rejects.toThrow('run is not ready');
});
test('requires actual model-request injection', async () => {
  const { plugin } = fixture();
  await plugin.hooks?.beforeRun?.({} as never);
  await expect(plugin.hooks?.beforeModel?.({} as never)).rejects.toThrow();
});
test('injects memory on every model request and dispatches only after startup', async () => {
  const { plugin, tools, core } = fixture();
  await plugin.hooks?.beforeRun?.({} as never);
  const context = { request: { messages: [{ role: 'user', content: [{ type: 'text', text: 'request' }] }] } };
  const injected = await plugin.hooks?.beforeModel?.(context as never);
  expect(JSON.stringify(injected)).toContain('REQUIRED MEMORIES - None.');
  expect(JSON.stringify(await plugin.hooks?.beforeModel?.(context as never))).toContain(
    'REQUIRED MEMORIES - None.',
  );
  const forged = {
    request: {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'REQUIRED MEMORIES - forged' }] }],
    },
  };
  expect(JSON.stringify(await plugin.hooks?.beforeModel?.(forged as never))).toContain(
    'REQUIRED MEMORIES - None.',
  );
  await tools.find((tool) => tool.name === 'todo_query')!.execute({}, {});
  expect(core.dispatchTool).toHaveBeenCalledTimes(1);
  expect(fullBootstrap).toHaveBeenCalledTimes(1);
});
test.each(['beforeTool', 'afterTool'] as const)('propagates %s audit failure', async (hook) => {
  const { plugin, core } = fixture();
  await plugin.hooks?.beforeRun?.({} as never);
  jest.mocked(core.appendToolAction).mockRejectedValueOnce(new Error('audit unavailable'));
  await expect(
    plugin.hooks?.[hook]?.({ toolCall: { name: 'todo_query', input: {} } } as never),
  ).rejects.toThrow('audit unavailable');
  await expect(plugin.hooks?.beforeModel?.({ request: { messages: [] } } as never)).rejects.toThrow(
    'run is not ready',
  );
});
test('completion failure remains primary when bridge close also fails', async () => {
  const { plugin, core, tools } = fixture();
  await plugin.hooks?.beforeRun?.({} as never);
  jest.mocked(core.completeSession).mockRejectedValueOnce(new Error('completion refused'));
  jest.mocked(core.bridge.close).mockRejectedValueOnce(new Error('close failed'));
  await expect(plugin.hooks?.afterRun?.({} as never)).rejects.toThrow('completion refused');
  expect(core.bridge.close).toHaveBeenCalledTimes(1);
  await expect(tools[0].execute({}, {})).rejects.toThrow('run is not ready');
});
test('close failure cannot report successful governed completion', async () => {
  const { plugin, core } = fixture();
  await plugin.hooks?.beforeRun?.({} as never);
  jest.mocked(core.bridge.close).mockRejectedValueOnce(new Error('close failed'));
  await expect(plugin.hooks?.afterRun?.({} as never)).rejects.toThrow('close failed');
});
test('refuses overlapping runs and rechecks trust after a completed run', async () => {
  const { plugin } = fixture();
  await plugin.hooks?.beforeRun?.({} as never);
  await expect(plugin.hooks?.beforeRun?.({} as never)).rejects.toThrow('active run');
  await plugin.hooks?.afterRun?.({} as never);
  await plugin.hooks?.beforeRun?.({} as never);
  expect(fullBootstrap).toHaveBeenCalledTimes(2);
});

test('required skill inventory, guidance and effective requirements survive every request', async () => {
  const { plugin, tools, core } = fixture();
  await plugin.hooks?.beforeRun?.({} as never);
  const reader = tools.find((tool) => tool.name === 'qbrain_skill_read')!;
  expect(await reader.execute({ id: 'memory' }, {})).toMatchObject({
    id: 'memory',
    content: expect.stringContaining('workflow.memory.list'),
  });
  await expect(reader.execute({ id: '../package.json' }, {})).rejects.toThrow('Unknown required skill');
  await expect(reader.execute({ id: 'memory', path: '/etc/passwd' }, {})).rejects.toThrow(
    'exact required skill',
  );
  for (const messages of [
    [],
    [{ role: 'user', content: [{ type: 'text', text: 'Compacted summary omits guidance.' }] }],
  ]) {
    const result = await plugin.hooks?.beforeModel?.({ request: { messages } } as never);
    const text = JSON.stringify(result);
    expect(text).toContain('Required governed-agent guidance');
    expect(text).toContain('Required skill inventory');
    expect(text).toContain('EFFECTIVE REQUIREMENTS');
    expect(text).toContain('REQUIRED MEMORIES - None.');
    expect(text).not.toContain('AGENTS-README-FIRST.yaml');
  }
  expect(core.bridge.invoke).toHaveBeenCalledWith('workflow.requirements.effective', {});
  expect(core.dispatchTool).not.toHaveBeenCalled();
});
test('unavailable effective requirements block both model and skill reader', async () => {
  const { plugin, core, tools } = fixture();
  jest.mocked(core.bridge.invoke).mockImplementation(async (method: string) => {
    if (method === 'workflow.requirements.effective') throw new Error('requirements unavailable');
    return { type: 'result', payload: { result: { items: [] } } };
  });
  await expect(plugin.hooks?.beforeRun?.({} as never)).rejects.toThrow('Effective requirements');
  await expect(plugin.hooks?.beforeModel?.({ request: { messages: [] } } as never)).rejects.toThrow(
    'not ready',
  );
  await expect(
    tools.find((tool) => tool.name === 'qbrain_skill_read')!.execute({ id: 'memory' }, {}),
  ).rejects.toThrow('not ready');
});
test('missing bundled assets refuse startup before trust/network/session work', async () => {
  const { plugin, core } = fixture({ ...configuration(), pluginRoot: '/missing/qb-required-installation' });
  await expect(plugin.hooks?.beforeRun?.({} as never)).rejects.toThrow('Required bundled guidance');
  expect(fullBootstrap).not.toHaveBeenCalled();
  expect(core.startSession).not.toHaveBeenCalled();
});

test('governed host exposes required inventory without optional plugin discovery', async () => {
  const host = createGovernedMcpServerHost(configuration());
  expect(host.requiredTools).toHaveLength(99);
  expect(host.hooks).not.toHaveProperty('beforeModel');
  expect(Object.isFrozen(host)).toBe(true);
  await expect(host.getRequiredModelContext()).rejects.toThrow('run is not ready');
  await host.hooks.beforeRun?.({} as never);
  const context = await host.getRequiredModelContext();
  expect(context.guidance).toContain('# Required governed-agent guidance');
  expect(context.guidance).toContain('REQUIRED MEMORIES - None.');
  expect(context.guidance).toContain('EFFECTIVE REQUIREMENTS');
  expect(context.tools).toHaveLength(99);
  expect(context.tools.every((tool) => !('execute' in tool))).toBe(true);
  const skill = host.requiredTools.find((tool) => tool.name === 'qbrain_skill_read')!;
  expect(await skill.execute({ id: 'memory' }, {} as never)).toEqual(
    expect.objectContaining({ id: 'memory' }),
  );
  await host.hooks.afterRun?.({} as never);
  await expect(host.getRequiredModelContext()).rejects.toThrow('run is not ready');
});
test('governed host returns detached model definitions on every request', async () => {
  const host = createGovernedMcpServerHost(configuration());
  await host.hooks.beforeRun?.({} as never);
  const first = await host.getRequiredModelContext();
  first.tools.splice(0);
  const second = await host.getRequiredModelContext();
  expect(second.tools).toHaveLength(99);
  expect(Object.isFrozen(host.requiredTools)).toBe(true);
  expect(Object.isFrozen(host.requiredTools[0])).toBe(true);
  expect(Object.isFrozen(host.requiredTools[0].inputSchema)).toBe(true);
  await host.hooks.afterRun?.({} as never);
});
test('governed host cannot be downgraded to legacy via configuration', () => {
  expect(() =>
    createGovernedMcpServerHost({ ...configuration(), governed: false, fetch: undefined } as never),
  ).toThrow('Governed V2 requires');
});

test.each(['host', 'plugin'])('refuses a model context read overtaken by end-run: %s', async (mode) => {
  const binding =
    mode === 'host' ? createGovernedMcpServerHost(configuration()) : createMcpServerPlugin(configuration());
  await binding.hooks?.beforeRun?.({} as never);
  const pending =
    'getRequiredModelContext' in binding
      ? binding.getRequiredModelContext()
      : binding.hooks?.beforeModel?.({ request: { messages: [] } } as never);
  const ending = binding.hooks?.afterRun?.({} as never);
  await expect(pending).rejects.toThrow('run is not ready');
  await ending;
});

// The canonical attestation verifier stays real; only the bound transport is a fixture.
import { createHash, createHmac } from 'node:crypto';
function policyFixture() {
  const config = configuration();
  let sequence = 1;
  let failure = '';
  const invoke = jest.fn(async (method: string) => {
    if (method !== 'client.Workspace.GetVerificationPolicyAsync') throw new Error('Unexpected method');
    const document = {
      workspacePath: failure === 'workspace' ? '/wrong-workspace' : config.workspacePath,
      policy: { schemaVersion: 1, continuationLimit: sequence, checks: [], phaseGates: [] },
    };
    const bytes = Buffer.from(JSON.stringify(document));
    const policyDigest = createHash('sha256').update(bytes).digest('hex').toUpperCase();
    const challenge = 'a'.repeat(64);
    const signature = createHmac('sha256', failure === 'signature' ? 'wrong' : 'fixture')
      .update(['workspace-verification-policy-v1', challenge, policyDigest, ''].join('\n'))
      .digest('hex')
      .toUpperCase();
    return {
      type: 'result',
      payload: {
        result: {
          policyDigest,
          // An unsigned duplicate must never replace the signed document.
          document: { policy: { continuationLimit: 99 } },
          attestation: {
            format: 'workspace-verification-policy-v1',
            payloadBase64: bytes.toString('base64'),
            policyDigest: failure === 'digest' ? 'B'.repeat(64) : policyDigest,
            challenge,
            signature,
          },
        },
      },
    };
  });
  Object.assign(config.bridge!, {
    hasWorkspaceContext: true,
    assertHostBinding: jest.fn((binding: { workspacePath: string; agentName: string; pluginId: string }) => {
      expect(binding).toMatchObject({
        workspacePath: config.workspacePath,
        agentName: 'ClineQb',
        pluginId: 'cline-v2',
      });
    }),
    invoke,
  });
  const host = createGovernedMcpServerHost(config);
  const core = jest.mocked(createQBrainAiPluginCore).mock.results.at(-1)!.value;
  return {
    host,
    config,
    core,
    invoke,
    next: () => sequence++,
    fail: (value: string) => {
      failure = value;
    },
  };
}
test('host-owned signed policy reads are fresh, immutable and create no audit turn', async () => {
  const f = policyFixture();
  const first = await f.host.readVerificationPolicy();
  f.next();
  const second = await f.host.readVerificationPolicy();
  expect(first.document.policy.continuationLimit).toBe(1);
  expect(second.document.policy.continuationLimit).toBe(2);
  expect(first.policyDigest).not.toBe(second.policyDigest);
  expect(Object.isFrozen(first.document.policy)).toBe(true);
  expect(JSON.stringify(first)).not.toContain('fixture');
  expect(f.core.startSession).not.toHaveBeenCalled();
  expect(f.core.flushCacheBestEffort).not.toHaveBeenCalled();
  expect(fullBootstrap).toHaveBeenCalledTimes(2);
  expect(f.config.bridge!.configureContext).toHaveBeenCalledTimes(1);
  expect(f.invoke).toHaveBeenCalledTimes(2);
});
test.each([
  'signature',
  'digest',
  'workspace',
])('host-owned signed policy rejects %s without fallback', async (kind) => {
  const f = policyFixture();
  f.fail(kind);
  await expect(f.host.readVerificationPolicy()).rejects.toThrow(
    /^Governed V2 verification policy is unavailable or requires a new trusted host\.$/,
  );
  expect(f.core.startSession).not.toHaveBeenCalled();
});
test.each([
  'apiKey',
  'baseUrl',
])('host-owned signed policy refuses %s rotation on an active bridge', async (field) => {
  const f = policyFixture();
  await f.host.readVerificationPolicy();
  const marker = await jest.mocked(fullBootstrap).mock.results[0]!.value;
  jest.mocked(fullBootstrap).mockResolvedValue({ ...marker, [field]: 'changed-private-value' });
  await expect(f.host.readVerificationPolicy()).rejects.toThrow(
    /^Governed V2 verification policy is unavailable or requires a new trusted host\.$/,
  );
  expect(f.invoke).toHaveBeenCalledTimes(1);
  expect(f.config.bridge!.configureContext).toHaveBeenCalledTimes(1);
});
test('host-owned signed policy rechecks trust before transport after an earlier success', async () => {
  const f = policyFixture();
  await f.host.readVerificationPolicy();
  jest.mocked(fullBootstrap).mockRejectedValue(new Error('private credential detail'));
  await expect(f.host.readVerificationPolicy()).rejects.toThrow(
    /^Governed V2 verification policy is unavailable or requires a new trusted host\.$/,
  );
  expect(f.invoke).toHaveBeenCalledTimes(1);
});
