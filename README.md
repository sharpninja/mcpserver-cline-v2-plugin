# mcpserver-cline-v2-plugin

Cline V2 `AgentPlugin` package for McpServer workspace automation.

The package exports a default `AgentPlugin` and `createMcpServerPlugin(config?)`.
It registers MCP TODO, session-log, requirements, GraphRAG, and workspace
initialization tools through Cline's V2 `createTool` surface. Tool results are
plain JSON objects.

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
