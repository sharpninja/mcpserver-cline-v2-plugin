# mcpserver-cline-v2-plugin

Cline V2 `AgentPlugin` package for McpServer workspace automation.

The package exports a default `AgentPlugin` and `createMcpServerPlugin(config?)`.
It registers MCP TODO, session-log, requirements, GraphRAG, and workspace
initialization tools through Cline's V2 `createTool` surface. Tool results are
plain JSON objects.

## Tool Name Surfaces

Cline v2-visible tools use this plugin's `createTool` names, such as
`session_begin_turn`, `todo_query`, and `req_generate_document`. The helper
scripts may still call `workflow.sessionlog.*`, `workflow.todo.*`, and
`workflow.requirements.*` through the plugin workflow/REPL shim. Those
`workflow.*` names are distinct from native McpServer `/mcp-transport` tool
names such as `sessionlog_*`, `todo_*`, and `requirements_*`, and from
hosted-agent aliases such as `mcp_session_*`.

Do not treat the absence of literal `workflow.*` names from generic MCP tool
discovery as proof that this plugin is unavailable. Validate Cline v2 plugin
registration and the host-facing tool list instead.

Failsafe YAML replay files are written under:

```text
.mcpServer/failsafe/cline-v2
```

Install from this local workspace with a Cline CLI that supports V2 plugins:

```bash
cline plugin install /f/GitHub/mcpserver-cline-v2-plugin --force
```

Run local validation:

```bash
bun install --frozen-lockfile --ignore-scripts
bun run build
bun run test -- --runInBand
bun run test:built
bun pm pack --ignore-scripts --dry-run
```

## External research (Perplexity)

Canonical policy: [`docs/research/perplexity-research-policy.md`](docs/research/perplexity-research-policy.md)  
Workflow: [`docs/research/research-to-plan-workflow.md`](docs/research/research-to-plan-workflow.md)

Before planning or substantive documentation that depends on external facts, use Perplexity research when available. This plugin does **not** require `PERPLEXITY_API_KEY` for installation or ordinary MCP tool execution.

## Governed host adapter

Trusted hosts can explicitly construct `createMcpServerPlugin` with `governed: true`, absolute workspace and verified installation paths, `agentName: 'ClineQb'`, a host-bound fetch function, a reviewed absolute REPL executable or governed bridge, and the exact `requiredAgentPlugin` identity/version/archive SHA256. Disabling bootstrap or replay is rejected. Configuration and hooks are captured and frozen; the default export remains the legacy adapter.

The governed adapter verifies the required signed artifact binding before configuring transport. Model requests and tools refuse execution until bootstrap, replay, session startup and required-memory loading succeed. Audit and completion failures propagate. Overlapping runs are rejected, the bridge closes at run end, and the next run rechecks trust.

Required memories come only from the verified installation's descriptor and the bound bridge. Ambient memory stubs and descriptor overrides are ignored. Only an explicit successful empty list produces `REQUIRED MEMORIES - None.`; malformed data or transport failure blocks execution. Memory is injected into every model request because SDK hook results do not persist into conversation history. User/history text containing the memory prefix cannot suppress that injection.

Tests distinguish mocked canonical orchestration from real SDK execution. A built real-SDK case confirms that failed marker trust prevents any model call. These adapter checks do not certify the canonical A8 session lifecycle, durable outbox admission, S6 turn minting, protected final host composition, or production readiness. Hosts still must authenticate and verify installed bytes before import and supply their private storage, SDK and reviewed REPL layout.
### Required guidance and skills

`package.json.qbrainGovernance` declares required guidance assets and all ten bundled skills. Governed startup validates this inventory before trust/network calls, snapshots every skill body and registers `qbrain_skill_read` for exact-ID reads. Reading a skill does not execute its workflow. Missing/extra skills, linked assets and malformed metadata block startup.

Startup obtains the complete effective requirement set through `workflow.requirements.effective`. FR/TR bodies, TEST conditions, acceptance criteria, mappings and extra response fields are preserved. Failed or malformed results are never treated as empty. Declared guidance, skill catalogue, required memories and effective requirements appear on every model request. A real-SDK test covers two requests separated by a skill-tool call with synthetic signed trust/transport fixtures; it does not certify live A8/S6 or protected host integration.
## Current candidate dependency migration

The candidate uses canonical `@qbrainai/qbrain-ai-plugin-core` 0.2.0 through its real `createQBrainAiPluginCore` factory. This is an explicit migration from the baseline `@sharpninja/mcpserver-plugin-core`, not an alias claiming both names identify the same artifact. The canonical package is built in McpServer with Bun and copied as a checksum-recorded vendor archive. PowerShell files are regenerated only by McpServer's `plugins/core/sync/sync-plugin-core.ps1`; `CORE-MANIFEST.yaml` records each copied hash.

`@cline/core` and `@cline/sdk` 0.0.92 are host peers and development dependencies, never runtime dependency copies. The Bun build checks their resolved versions, emits declarations, and bundles runtime plugin-core and YAML code. The legacy entry keeps SDK imports external; the private host entry receives the existing SDK factory explicitly. The built-contract test loads the real SDK and verifies tool registration and execution; the legacy Jest shim suite remains separate. Consumers must supply the matching SDK instance; private QBrain factory composition is still pending.

`licenses/provenance.json` distinguishes package declarations, existing project license text and new Apache-2.0 sources. The retained V2 package declaration remains MIT. Canonical core includes mixed-license source; its package MIT declaration does not relabel the copied McpServer Apache license or new SPDX-marked files. This candidate is not an approved production pin. Governed lifecycle/A8/S6 integration, final host packaging, complete file-level release provenance and native acceptance remain required.

## Private host entrypoint

Trusted product hosts use the `./host` export (`dist/host.js`) after verifying the
signed workspace contract, reviewed artifact and installed inventory. This module
does not import SDK runtime packages or construct the legacy default plugin. Call
`createGovernedMcpServerHost(config, { createTool })` with the already-running host's
actual SDK factory. The factory is captured at construction; a missing or invalid
factory is refused. Runtime plugin-core and YAML dependencies are bundled. This
entrypoint can therefore live in private product storage outside node_modules and
does not need a download, symlink farm or process-wide import hook.

The existing root exports preserve their SDK-peer behavior and supply `createTool`
through the compatibility facade. Shared plugin-state code keeps tools, guidance,
memory and lifecycle behavior identical between entries. The built contract suite
copies the host bundle into a private directory without node_modules and confirms
import succeeds and missing SDK injection is refused. The Cline packed-artifact
harness additionally runs real AgentRuntime requests from a private installation.
These checks do not approve the artifact or substitute for A8/S6 lifecycle acceptance.

The required V2 host also exposes readVerificationPolicy() for host-owned
verification and completion control. It uses the existing bound canonical bridge
and attestation verifier, rechecks marker trust on every read, rejects credential,
endpoint or contract rotation until a new trusted host is constructed, and returns
only fresh immutable signed policy data. Policy browsing opens no session or turn.
The loader refuses hosts lacking this capability. This API does not register a
production verification map, accept a release pin or replace the A8 lifecycle.
