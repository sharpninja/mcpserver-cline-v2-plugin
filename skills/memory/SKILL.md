---
name: memory
description: Use when the operator wants durable MCP memories remembered, recalled, explored, consolidated, promoted, or reverted.
version: 0.5.0
host: cline-v2
---

# MCP Memory (cline-v2)

Use the Cline v2 plugin memory surface. Do not invent memories. Prefer the plugin REPL/workflow wrapper over local files. Host-registered `memory_*` MCP tools are aliases for `workflow.memory.*` methods invoked through `lib/repl-invoke.ps1` or `skills/memory/scripts/invoke.ps1`.

## Injection

Cline v2 does not expose Claude-style `UserPromptSubmit`. The always-on request-boundary path is the AgentPlugin hooks in `src/plugin.ts`:

- `beforeRun` loads `memory-descriptor.json` and fetches required memories via `workflow.memory.list` (`scope: Effective`)
- `beforeModel` injects them into the first model request, including the explicit `None` fallback

Render required memories exactly as:

```
REQUIRED MEMORIES - MEMORY-REQ-001: Raw memory text.
```

If no required memories are visible:

```
REQUIRED MEMORIES - None.
```

Preserve raw memory text. Do not summarize, paraphrase, or add secrets. The request-boundary path is fail-soft: it logs the error and continues with the explicit `None` fallback.

## Fallback

If the MCP server is unavailable, keep a local failsafe for mutating tools and replay after the server acknowledges the write. Agent-local memory stores are caches only.

## Running memory methods

Drive memory through the plugin wrapper (or the host `memory_*` aliases that resolve to the same methods):

```pwsh
pwsh -NoProfile -File "<plugin-root>/lib/repl-invoke.ps1" -Method workflow.memory.list -ParamsYaml @'
scope: Effective
'@
```

Alias form (same verbs, resolved from `memory-descriptor.json`):

```pwsh
pwsh -NoProfile -File "<plugin-root>/skills/memory/scripts/invoke.ps1" -Name memory_list -ParamsYaml @'
scope: Effective
'@
```

`workflow.memory.*` is a plugin workflow/REPL namespace. Native `/mcp-transport` discovery may show `memory_*` names when this plugin is configured; those names still dispatch to `workflow.memory.*`.

## Tools

Call these REPL methods (aliases in parentheses):

- `workflow.memory.remember` (`memory_remember`) when a fact, decision, preference, procedure, or entity should persist. Params: `content` (required), optional `title`, `type`, `tags`, `confidence`, `scope`.
- `workflow.memory.recall` (`memory_recall`) when you need ranked guidance by meaning. Params: `query` (required), optional `minScore`, `topN`, `type`, `scope`.
- `workflow.memory.explore` (`memory_explore`) when you need neighborhood context from a seed. Params: optional `seedId`, `query`, `depth`, `maxNeighbors`.
- `workflow.memory.consolidate` (`memory_consolidate`) when the operator asks for sleep/merge maintenance. Params: optional `dryRun`, `similarityThreshold`, `allowHardDelete`.
- `workflow.memory.promote` (`memory_promote`) when the operator explicitly wants a session-log or context source remembered. Params: `sourceKind`, `sourceRef` (required), optional `content`.
- `workflow.memory.revert` (`memory_revert`) when current content is wrong and a snapshot should be restored. Params: `id`, `versionNumber`.

Compat CRUD remains:

- `workflow.memory.list` (`memory_list`) — optional `scope` (`Effective` / `Global` / `Workspace`), `category`, `keyword`
- `workflow.memory.get` (`memory_get`) — required `id`
- `workflow.memory.add` (`memory_add`) — required `category`, `text`; optional `id`, `scope`, `updatedBy`
- `workflow.memory.update` (`memory_update`) — required `id`; optional `category`, `text`, `scope`, `updatedBy`
- `workflow.memory.remove` (`memory_remove`) — required `id`

```yaml
type: request
payload:
  requestId: req-20260409T120000Z-memory-list-001
  method: workflow.memory.list
  params:
    scope: Effective
```

```yaml
type: request
payload:
  requestId: req-20260409T120001Z-memory-remember-001
  method: workflow.memory.remember
  params:
    content: Prefer MCP tools over local files for durable memories.
    scope: Workspace
```
