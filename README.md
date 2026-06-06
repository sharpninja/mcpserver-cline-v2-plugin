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
npm install
npm run build
npm test -- --runInBand
npm pack --dry-run
```
