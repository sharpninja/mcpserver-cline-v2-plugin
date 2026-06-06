---
name: sync-logs
description: Synchronize MCP Server session logs for Cline v2 when asked to "sync logs", "repair MCP session logs", or "logging summary".
---

Use the TypeScript bridge tools in `src/transport/repl-bridge.ts` and `src/tools/session*.ts`. Do not use raw REST for normal MCP mutations.

`workflow.*` names below are plugin workflow/REPL method names used by the bridge, not literal Cline v2-visible tool names. Cline v2-visible tools use this plugin's host-facing names, and native `/mcp-transport` tools use names such as `sessionlog_*`, `todo_*`, and `requirements_*`. Do not declare the plugin unavailable solely because generic MCP discovery does not list literal `workflow.*` names.

Run a status check through the bridge before mutation. Ensure session/turn handling is open with `workflow.sessionlog.openSession` or `workflow.sessionlog.beginTurn`, append reasoning with `workflow.sessionlog.appendDialog`, and append durable actions with `workflow.sessionlog.appendActions`.

Discover background sessions from bridge/cache state before closing. Report a compact factual summary with sessions, turns, actions, commits, validation, defects, and blockers.
