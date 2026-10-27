# Enforcement surfaces in Cline V2

This package exports an AgentPlugin factory. It is not itself an MCP server and does not ship the old user-prompt-submit.sh, code-verify.sh or stop-gate.sh scripts described in the former document.

## Governed adapter

Trusted product hosts explicitly construct the governed adapter with its verified installation, exact signed artifact binding, bound workspace/fetch and reviewed REPL transport. The adapter validates required assets before bootstrap; startup verifies trust, replays cache, starts session handling, obtains required memories and effective requirements, and only then permits model/tool execution. Failures propagate to the host. Canonical A8/S6 integration remains required before production acceptance.

package.json declares the exact guidance assets and complete skill inventory under qbrainGovernance. Startup loads each skill into an immutable snapshot and exposes qbrain_skill_read. The tool accepts only an exact declared skill ID and returns captured text, never executes it. Unrelated workflows remain inactive until their documented triggers and operator authorization apply.

Every model request receives declared guidance, the required skill catalogue, the required-memory block and the complete effective requirement result. Missing files, inventory mismatch, malformed metadata or failed guidance queries block startup. A successful empty memory query is distinct from failure. Marker credentials, marker prompt and bootstrap instructions are not model guidance.

The adapter propagates audit and completion failures. Mandatory final tool authorization, protected registration, completion evidence and all-host construction are separate host integration obligations; an optional hook or afterRun callback alone is not enforcement. The product must also authenticate installed bytes before import. No test of this adapter alone closes those host obligations.

## Required in-process host binding

`createGovernedMcpServerHost(config)` forces governed mode and returns an immutable
`requiredTools` inventory, lifecycle `hooks`, and `getRequiredModelContext()`.
It does not register through optional plugin discovery. The model context method
refuses calls before successful startup or after the run ends; while ready, it
returns full required guidance and fresh copies of trusted tool definitions.
The returned hooks intentionally omit `beforeModel`: the product must compose
the context at its final model-request gate, after optional hooks and compaction.

The cline-qb private `createRequiredModelGate` appends this guidance after the
final custom system prompt and restores required advertised tool definitions.
The SDK's separate `requiredTools` registration protects local implementations.
These are distinct obligations: registration alone does not restore advertised
tools, and a model gate alone does not protect registered implementations.
The packed-artifact contract runs against the modified workspace SDK and tests
both together. Published peer version equality alone does not prove these host
capabilities. Durable audit integration, final tool policy, provider-internal
capability admission and shipped host factories remain required before release.

## Legacy adapter

The default export and factory without governed: true retain compatibility behavior, including best-effort bootstrap/audit and first-request memory injection. They are not eligible construction paths for shipped governed applications.

## Workflow names

Host tools such as session_begin_turn and req_effective route through the supported plugin workflow/REPL surface. workflow.sessionlog.*, workflow.requirements.* and workflow.memory.* are workflow method names, distinct from native MCP discovery names. Use the registered tools or supported wrappers, not raw REST or direct edits to session/cache files.
