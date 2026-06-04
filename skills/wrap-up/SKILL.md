---
name: wrap-up
description: Close out MCP-backed Cline v2 work when asked to "wrap up", "export requirements", or "close out".
---

Trust marker details only after the TypeScript bridge verifies workspace/marker state. Use tools in `src/tools/requirements.ts`, `src/tools/session*.ts`, `src/tools/todo.ts`, and `src/tools/workspace.ts`; do not use raw REST for normal MCP mutations.

Reconcile requirements through `workflow.requirements.*`, export wiki documents with `workflow.requirements.generateDocument`, run validation, then use the `commit-sync` pause contract for commit/push. Reconcile the session log with `workflow.sessionlog.appendDialog` and `workflow.sessionlog.appendActions`.

Complete the turn with `workflow.sessionlog.completeTurn`. Use `workflow.sessionlog.failTurn` for validation failure, export failure, or blocked commit/push.
