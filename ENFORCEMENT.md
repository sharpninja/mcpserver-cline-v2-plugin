# Per-Turn Enforcement Protocol (Cline)

Cline consumes this plugin as an MCP server. The server does not (and cannot)
intercept Cline's message loop — Cline decides when to call MCP tools. This
document specifies the Per-User-Message contract that the Cline **agent** must
follow, plus the helper scripts in `lib/` that automate the bookkeeping.

## Why this is required

`AGENTS-README-FIRST.yaml` in every MCP-enabled workspace mandates:

- **Rule 2**: Post a new session log turn before starting work on each user
  message.
- **Rule 10**: Do not ship code you have not verified compiles.
- **Before Delivering Output**: Session log must be current, decisions
  recorded, code compiles.

These rules have no hook-based enforcement in Cline (unlike Claude Code or
Copilot CLI). Compliance is agent-driven.

## The Three Scripts

The plugin ships three bash scripts in `lib/` that Cline agents should invoke
per user message:

### Phase 1 — On user message receipt

```bash
echo '{"prompt":"<verbatim user message>"}' | bash ${CLINE_PLUGIN_ROOT}/lib/user-prompt-submit.sh
```

What it does:
- Reads the active `sessionId` from `cache/session-state.yaml`
- Builds a fresh `req-<yyyyMMddTHHmmssZ>-prompt-xxxx` requestId
- Invokes `workflow.sessionlog.beginTurn` via `mcpserver-repl`
- Writes `cache/current-turn.yaml` so Phase 3 can verify completion

Alternatively, Cline agents can call the MCP tool `session_begin_turn`
directly — but the script also seeds `current-turn.yaml` which the Stop gate
relies on. **Prefer the script.**

### Phase 2 — After every code edit

```bash
echo '{"tool_name":"Edit","tool_input":{"file_path":"<absolute path>"}}' \
  | bash ${CLINE_PLUGIN_ROOT}/lib/code-verify.sh
```

Runs `dotnet build` (for .NET files) or `tsc --noEmit` (for TypeScript)
against the containing project. Updates `cache/current-turn.yaml` with
`lastBuildStatus` and increments `codeEdits`. Appends a session log action
via `workflow.sessionlog.appendActions`.

If the build fails, stdout contains build errors. The agent should fix them
before the next phase.

### Phase 3 — Before final response

```bash
bash ${CLINE_PLUGIN_ROOT}/lib/stop-gate.sh
```

Returns `decision: block` with reason if:
- Turn is still `in_progress` → agent forgot `workflow.sessionlog.completeTurn`
- `lastBuildStatus: failed` → build is broken

When blocked, fulfill the missing requirement. Call the MCP tool
`session_complete_turn` with a response summary, or fix the build, then
re-run `stop-gate.sh`.

## Why scripts and not MCP tools?

The scripts coordinate shared state (`cache/current-turn.yaml`) that needs
to persist across MCP tool invocations. They can also run `dotnet build` /
`tsc` which are not surfaced as MCP tools. A future version may expose
equivalent MCP tools (`enforce_begin_turn`, `enforce_verify_build`,
`enforce_stop_gate`) that wrap these scripts; until then, invoke via shell.

## Integration hint for Cline prompts

Add to the agent's system prompt or task instructions:

```
Before calling any other tool on a new user message, run
  echo '{"prompt":"..."}' | bash $CLINE_PLUGIN_ROOT/lib/user-prompt-submit.sh

After editing any .cs/.axaml/.ts/.tsx file, run
  echo '{"tool_name":"Edit","tool_input":{"file_path":"..."}}' | bash $CLINE_PLUGIN_ROOT/lib/code-verify.sh

Before emitting your final response, run
  bash $CLINE_PLUGIN_ROOT/lib/stop-gate.sh
```

## See also

- `F:\GitHub\mcpserver-marketplace\plugins\mcpserver\hooks\hooks.json` —
  reference hook configuration for the Claude Code plugin where these
  scripts run as automated hooks (`UserPromptSubmit`, `PostToolUse`, `Stop`).
- `AGENTS-README-FIRST.yaml` in each workspace — authoritative contract
  these scripts implement.
