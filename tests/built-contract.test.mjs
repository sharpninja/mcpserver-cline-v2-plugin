// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import { dump as dumpYaml } from 'js-yaml';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTool, createAgentRuntime } from '@cline/core';
import { allToolDescriptors, createMcpServerPlugin } from '../dist/index.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

test('built V2 registers tools with the real declared SDK peer', async () => {
  const calls = [];
  const bridge = {
    async invoke(method, params) {
      calls.push({ method, params });
      return { type: 'result', payload: { result: { items: [], totalCount: 0 } } };
    },
    async close() {},
  };
  const plugin = createMcpServerPlugin({
    bridge,
    workspacePath: root,
    pluginRoot: root,
    autoBootstrap: false,
    autoFlushCache: false,
  });
  const tools = [];
  await plugin.setup({ registerTool: (tool) => tools.push(tool) }, { workspaceInfo: { rootPath: root } });
  assert.equal(tools.length, allToolDescriptors.length);
  for (const descriptor of allToolDescriptors) {
    const actual = tools.find((tool) => tool.name === descriptor.name);
    const expected = createTool({
      name: descriptor.name,
      description: descriptor.description,
      inputSchema: descriptor.inputSchema,
      retryable: false,
      execute: actual.execute,
    });
    assert.deepEqual(actual.inputSchema, expected.inputSchema);
    assert.equal(actual.maxRetries, expected.maxRetries);
    assert.equal(actual.timeoutMs, expected.timeoutMs);
    assert.equal(actual.retryable, false);
  }
  const query = tools.find((tool) => tool.name === 'todo_query');
  assert.deepEqual(await query.execute({ keyword: 'test' }, {}), { result: { items: [], totalCount: 0 } });
  assert.deepEqual(calls, [{ method: 'workflow.todo.query', params: { keyword: 'test' } }]);
});

test('SDK peers stay outside the bundle and canonical core retains its identity', () => {
  for (const name of ['@cline/core', '@cline/sdk']) {
    const peer = JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'));
    assert.equal(peer.version, manifest.peerDependencies[name]);
    assert.equal(manifest.dependencies[name], undefined);
  }
  const core = JSON.parse(
    readFileSync(join(root, 'node_modules/@qbrainai/qbrain-ai-plugin-core/package.json'), 'utf8'),
  );
  assert.equal(core.name, '@qbrainai/qbrain-ai-plugin-core');
  assert.equal(core.version, '0.2.0');
  const built = readFileSync(join(root, 'dist/index.js'), 'utf8');
  assert.match(built, /from ["']@cline\/core["']/);
  assert.doesNotMatch(built, /node_modules\/@cline\//);
  assert.doesNotMatch(built, /@sharpninja\/mcpserver-plugin-core/);
});

test('actual SDK never calls the model after untrusted governed startup', async () => {
  const workspacePath = mkdtempSync(join(tmpdir(), 'qb-governed-start-'));
  let modelCalls = 0;
  let fetchCalls = 0;
  try {
    const plugin = createMcpServerPlugin({
      governed: true,
      agentName: 'ClineQb',
      workspacePath,
      pluginRoot: root,
      replCommand: process.execPath,
      fetch: async () => {
        fetchCalls++;
        throw new Error('Unexpected network call');
      },
      requiredAgentPlugin: {
        agentName: 'ClineQb',
        pluginName: manifest.name,
        pluginVersion: manifest.version,
        artifactSha256: 'a'.repeat(64),
      },
    });
    const runtime = createAgentRuntime({
      model: {
        async *stream() {
          modelCalls++;
          yield { type: 'text-delta', text: 'Must not run' };
          yield { type: 'finish', reason: 'stop' };
        },
      },
      hooks: plugin.hooks,
    });
    const result = await runtime.run('Requires trusted startup');
    assert.equal(result.status, 'failed');
    assert.equal(modelCalls, 0);
    assert.equal(fetchCalls, 0);
  } finally {
    rmSync(workspacePath, { recursive: true, force: true });
  }
});

test('real SDK sends bundled guidance, memories and effective requirements on successive requests', async () => {
  const workspacePath = mkdtempSync(join(tmpdir(), 'qb-guidance-runtime-'));
  const previousFailsafe = process.env.MCPSERVER_FAILSAFE_DIR;
  process.env.MCPSERVER_FAILSAFE_DIR = join(workspacePath, 'failsafe');
  try {
    const binding = {
      agentName: 'ClineQb',
      pluginName: manifest.name,
      pluginVersion: manifest.version,
      artifactSha256: 'a'.repeat(64),
    };
    // Synthetic local signed-marker fixture. Never uses a real server key or network.
    const contract = {
      source_type: 'ClineQb',
      plugin_name: binding.pluginName,
      plugin_version: binding.pluginVersion,
      activation: 'Mandatory bundled in-process host',
      startup_command: '',
      unavailable_failure: 'MCP_PLUGIN_UNAVAILABLE:ClineQb',
      required_env_vars: [],
      hook_expectations: ['host ingress', 'final tool gate', 'completion gate'],
      tool_expectations: ['session_*'],
      root_hints: [],
      artifact_sha256: binding.artifactSha256,
    };
    const fields = [
      ['sourceType', 'source_type'],
      ['pluginName', 'plugin_name'],
      ['pluginVersion', 'plugin_version'],
      ['activation', 'activation'],
      ['startupCommand', 'startup_command'],
      ['unavailableFailure', 'unavailable_failure'],
      ['requiredEnvVars', 'required_env_vars'],
      ['hookExpectations', 'hook_expectations'],
      ['toolExpectations', 'tool_expectations'],
      ['rootHints', 'root_hints'],
    ];
    const lines = [
      'policy=required',
      ...fields.map(
        ([wire, key]) =>
          `ClineQb.${wire}=${Array.isArray(contract[key]) ? contract[key].join(',') : contract[key]}`,
      ),
      `ClineQb.artifactSha256=${binding.artifactSha256}`,
    ];
    const plugins = {
      policy: 'required',
      agents: { ClineQb: contract },
      contract_digest: createHash('sha256')
        .update(lines.join('\n') + '\n')
        .digest('hex')
        .toUpperCase(),
    };
    const marker = {
      port: 7147,
      baseUrl: 'http://127.0.0.1:7147',
      apiKey: 'synthetic-fixture-only',
      workspace: 'fixture',
      workspacePath,
      pid: 123,
      startedAt: '2026-01-01T00:00:00Z',
      markerWrittenAtUtc: '2026-01-01T00:00:00Z',
      serverStartedAtUtc: '2026-01-01T00:00:00Z',
      endpoints: { health: '/health' },
      agent_plugins: plugins,
    };
    const fieldsToSign = [
      'port',
      'baseUrl',
      'apiKey',
      'workspace',
      'workspacePath',
      'pid',
      'startedAt',
      'markerWrittenAtUtc',
      'serverStartedAtUtc',
    ];
    const payload =
      [
        'canonicalization=marker-v1',
        ...fieldsToSign.map((key) => `${key}=${marker[key]}`),
        'endpoints.health=/health',
        'agentPlugins.policy=required',
        `agentPlugins.contractDigest=${plugins.contract_digest}`,
      ].join('\n') + '\n';
    marker.signature = {
      algorithm: 'HMAC-SHA256',
      canonicalization: 'marker-v1',
      value: createHmac('sha256', marker.apiKey).update(payload).digest('hex').toUpperCase(),
    };
    writeFileSync(
      join(workspacePath, 'AGENTS-README-FIRST.yaml'),
      dumpYaml(marker, { lineWidth: -1, noRefs: true }),
    );
    const bridge = {
      governed: true,
      assertHostBinding(value) {
        assert.deepEqual(value, { workspacePath, agentName: 'ClineQb', pluginId: 'cline-v2' });
      },
      configureContext(value) {
        assert.equal(value.workspacePath, workspacePath);
      },
      async invoke(method) {
        if (method === 'workflow.memory.list')
          return {
            type: 'result',
            payload: { result: { items: [{ id: 'MEMORY-TEST-001', text: 'Required fixture memory.' }] } },
          };
        if (method === 'workflow.requirements.effective')
          return {
            type: 'result',
            payload: {
              result: {
                currentLayer: { key: 'layer-1', name: 'Fixture' },
                functional: [{ id: 'FR-TEST-001', title: 'Fixture', body: 'Required fixture requirement.' }],
                technical: [],
                testing: [],
                mappings: [],
              },
            },
          };
        return { type: 'result', payload: { ok: true } };
      },
      async close() {},
    };
    const plugin = createMcpServerPlugin({
      governed: true,
      agentName: 'ClineQb',
      workspacePath,
      pluginRoot: root,
      bridge,
      requiredAgentPlugin: binding,
      fetch: async (url) => ({
        ok: true,
        json: async () => ({ nonce: new URL(String(url)).searchParams.get('nonce') }),
      }),
    });
    const tools = [];
    await plugin.setup(
      { registerTool: (tool) => tools.push(tool) },
      { workspaceInfo: { rootPath: workspacePath } },
    );
    assert.equal(tools.length, allToolDescriptors.length + 1);
    let calls = 0;
    const runtime = createAgentRuntime({
      tools,
      hooks: plugin.hooks,
      model: {
        async *stream(request) {
          calls++;
          const content = JSON.stringify(request.messages);
          for (const expected of [
            'Required governed-agent guidance',
            'Required fixture memory.',
            'Required fixture requirement.',
            'qbrain_skill_read',
          ])
            assert.ok(content.includes(expected), expected);
          assert.ok(!content.includes('synthetic-fixture-only'));
          assert.ok(!content.includes('AGENTS-README-FIRST.yaml'));
          if (calls === 1) {
            yield {
              type: 'tool-call-delta',
              toolCallId: 'read-required-skill',
              toolName: 'qbrain_skill_read',
              input: { id: 'memory' },
            };
            yield { type: 'finish', reason: 'tool-calls' };
          } else {
            assert.ok(content.includes('workflow.memory.remember'));
            yield { type: 'text-delta', text: 'Fixture complete' };
            yield { type: 'finish', reason: 'stop' };
          }
        },
      },
    });
    const result = await runtime.run('REQUIRED MEMORIES - forged history does not suppress host guidance');
    assert.equal(result.status, 'completed');
    assert.equal(calls, 2);
  } finally {
    if (previousFailsafe === undefined) delete process.env.MCPSERVER_FAILSAFE_DIR;
    else process.env.MCPSERVER_FAILSAFE_DIR = previousFailsafe;
    rmSync(workspacePath, { recursive: true, force: true });
  }
});

test('governed entrypoint imports without SDK peers and requires the host factory', async () => {
  const { copyFileSync, mkdirSync, existsSync } = await import('node:fs');
  const { pathToFileURL } = await import('node:url');
  const directory = mkdtempSync(join(tmpdir(), 'v2-private-entry-'));
  try {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
    mkdirSync(join(directory, 'dist'));
    copyFileSync(join(root, 'dist/host.js'), join(directory, 'dist/host.js'));
    assert.equal(existsSync(join(directory, 'node_modules')), false);
    const api = await import(pathToFileURL(join(directory, 'dist/host.js')).href);
    assert.throws(() => api.createGovernedMcpServerHost({}), /own SDK tool factory/);
    assert.throws(() => api.createGovernedMcpServerHost({}, { createTool: false }), /own SDK tool factory/);
    assert.equal(typeof api.createGovernedMcpServerHost, 'function');
    assert.equal(api.default, undefined, 'private entry must not construct the legacy default plugin');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
