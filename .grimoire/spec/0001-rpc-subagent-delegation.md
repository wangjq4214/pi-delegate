# RPC subagent delegation

**Spec ID:** 0001
**Status:** Implemented
**Date:** 2026-07-17
**Sources:** User conversation confirming RPC-based delegation, parent-only registration, tool reinitialization, fresh child sessions, and synchronous task/result semantics; [ADR 0001](../adr/0001-rpc-subagents-and-parent-only-delegation.md).

## Requirements

### Parent-only delegation

- The parent agent has a model-callable delegation tool that launches a Pi subprocess in RPC mode.
- Subagents launched by this tool must not register or expose the delegation tool. This must hold across direct model declarations, discoverability, and nested tool-call paths, including `codemode`.
- Loading this extension in a launched subagent must not register the delegation tool again. A prompt instruction against recursive delegation is insufficient.

### Tool inheritance

- Each delegation reinitializes the parent's tool sources and conventional initialization configuration in the child process, excluding the delegation tool. Load the same extensions through normal discovery and configured/explicit paths, supplemented by observable tool/command source paths. Use the same working directory and inherited environment, and replay available startup flags. No separate user-maintained reconstruction manifest is required. Tool execution is local to the child, not proxied to the parent.
- Preserve the parent's tool activation state at delegation and retain its discoverable tool capabilities, including tools reached through `tool_search` and `codemode`. Do not reduce inheritance to only tools currently declared to the model.
- Tool registration/exposure and activation are separate parts of the inheritance contract. An inactive but discoverable tool must remain discoverable rather than being silently omitted or indiscriminately activated.
- Inheritance shares initialization configuration, not the parent's in-memory tool state, live connections, or caches.
- If an inherited tool has no reconstructible source or initialization configuration, delegation must explicitly report the inability to reconstruct it. It must not silently omit that tool, continue as though inheritance succeeded, or fall back to proxy execution.

### Task and lifecycle

- Accept task text and optional supplementary context from the caller. Exact tool and field names are implementation details.
- Do not automatically copy the parent's complete conversation into the child session.
- Every delegation uses a fresh subagent session; previous child sessions are not reused.
- The delegation call waits for child completion and then returns the child's final text on success. It does not return a background task handle.
- Report child startup errors, reconstruction errors, model/run failures, and cancellation explicitly rather than presenting them as successful task results.
- Cancelling the parent delegation call must terminate its child and clean up resources owned by that delegation.
- Completion and failure paths must also release owned child-process resources; fresh non-reused children must not remain running after their delegation has finished.

## Solution

The extension registers delegation only in the parent runtime. A call captures the tool-inheritance inputs, initializes a fresh Pi RPC child with the reconstructible tool sources and configuration, and enforces the parent-only registration boundary in that child. The child's activation and discoverability state must satisfy the inheritance contract before task execution is treated as valid.

The parent submits the explicit task and optional context over RPC and consumes responses and run events until task completion or failure. A successful prompt-command response is not a successful task result. Pi's RPC documentation identifies `agent_settled` as the completion boundary for automatic continuation; successful task completion must also be distinguished from provider errors and aborts. The parent returns the final child text and cleans up the child. Cancellation propagates to the owned child lifecycle.

### Seams

| Seam | Connects | Expects | Provides |
| --- | --- | --- | --- |
| Delegation tool | Parent model → extension | Task text, optional supplementary context, call cancellation | Final child text on success; explicit failure or cancellation |
| Tool reconstruction | Parent tool/resource configuration → child initialization | Reconstructible sources, initialization configuration, activation and exposure information | Reinitialized tool capabilities with parent activation state and discoverability, excluding delegation; explicit error for unsupported reconstruction |
| Registration boundary | Extension loading → parent/child runtime | Reliable distinction between the parent and this tool's launched children | Delegation registered only in the parent and unreachable in launched children |
| Pi RPC lifecycle | Delegation owner → Pi child process | JSONL commands and events; explicit task/context; process and cancellation lifecycle | Observable task completion, final text, run failures, and child cleanup |

### Technical verification boundary

At the start of this work, the repository contained only the `/hello` example in `src/index.ts`, with no tool-reconstruction implementation.

Before implementation can claim complete inheritance, verify that the supported Pi host exposes or permits obtaining the necessary tool sources, initialization configuration, and activation/exposure state for built-in, extension, MCP, and dynamically registered tools. Passing tool names alone is insufficient. This spec does not assert an automatic export API or prescribe an unverified reconstruction mechanism. Unsupported runtime-only tools follow the explicit-error requirement; if a broader incompatibility prevents the confirmed contract, return that limitation for a user decision rather than silently narrowing inheritance.

Host verification on 2026-10-02 demonstrated one concrete limitation in Pi 1.0.0: a file-based tool can have identical public tool metadata and effective settings across two sessions while its host-supplied extension flag differs. `getFlag()` cannot read another extension's flags. Thus, source/schema/settings equality alone is not sufficient evidence of identical initialization. The user subsequently confirmed that conventional reinitialization by loading the same extensions is sufficient, so this is not a blocker to implementation. Unobservable host-only configuration is not promised to be copied; comparing declarations verifies tool availability/exposure, not arbitrary closure state. See ADR 0001's host-verification section.

Local reference sources:

- `node_modules/@earendil-works/pi-coding-agent/docs/rpc.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- `src/index.ts`

## End-to-End Tests

### Explicit task succeeds

- **Given:** A parent with reconstructible tools and a task plus optional supplementary context.
- **When:** The parent calls delegation.
- **Then:** A fresh Pi RPC child receives the explicit task/context without an automatic copy of the parent's complete conversation. The call stays pending until the child completes, returns the final child text on success, and leaves no owned child process running.

### Delegation is parent-only

- **Given:** The parent has delegation and the child loads this extension.
- **When:** The child inspects model declarations, discovers tools, or attempts nested tool access.
- **Then:** The delegation tool is not registered in the child and is not exposed or reachable through any of those paths. The parent's delegation tool remains available.

### Activation and discoverability survive reconstruction

- **Given:** A parent with an active direct tool, an inactive discoverable tool, and the applicable `tool_search`/`codemode` capabilities.
- **When:** Delegation initializes the child and the child uses those capabilities.
- **Then:** The active tool remains active, the discoverable tool remains discoverable without being indiscriminately activated, and their child-side execution uses reinitialized implementations rather than parent proxies. Delegation is excluded.

### An unreconstructible tool fails explicitly

- **Given:** A parent tool exists only as a runtime registration with no reconstructible source or initialization configuration.
- **When:** Delegation attempts to inherit it.
- **Then:** The call explicitly reports reconstruction failure, does not represent the reduced tool set as successful inheritance, does not use a proxy fallback, and cleans up any child resources already created.

### Each call has a fresh session

- **Given:** A completed delegation that created child conversation state.
- **When:** Another delegation starts.
- **Then:** It uses a new child session and does not reuse the previous child's conversation state.

### Cancellation cleans up the child

- **Given:** A delegation is waiting on an active child.
- **When:** The parent call is cancelled.
- **Then:** The child is terminated, owned resources are cleaned up, and the outcome is reported as cancellation rather than success.

### Command acceptance is not task success

- **Given:** The child accepts the RPC prompt, then its model run fails.
- **When:** The delegation owner processes the accepted-command response and subsequent events.
- **Then:** It does not return success at prompt acceptance; it reports the run failure and cleans up the child.

## Decisions

- **Choice:** Pi RPC rather than an in-process child agent. **Source:** Explicit user requirement and ADR 0001.
- **Choice:** Parent-only registration rather than prompt-only prevention. **Source:** User's registration/exposure boundary and ADR 0001.
- **Choice:** Reinitialize the same tool sources/configuration, preserve activation and discoverability, and reject unreconstructible tools explicitly. **Reason/source:** User confirmed this interpretation to avoid proxy complexity; ADR 0001.
- **Choice:** Fresh sessions and waiting for completion rather than reuse or background handles. **Source:** Explicit user confirmations; ADR 0001.
- **Choice:** Explicit task and supplementary context rather than automatic full-transcript inheritance. **Source:** User accepted the proposed input/output contract; ADR 0001.

## Verification Results (2026-10-02)

Implementation: `src/index.ts` registers delegation only for the parent; `src/inheritance.ts` captures resource sources and tool state; `src/child.ts` validates readiness/restores activation; `src/delegate.ts` owns task/result semantics and per-call resources; `src/rpc.ts` owns JSONL framing, cancellation, process failure, and shutdown.

| Outcome | Evidence |
| --- | --- |
| Parent-only registration and complete exclusion from the child's tool registry | `tests/inheritance.test.ts` registration assertions and real child registry assertions in `tests/delegate.integration.test.ts` |
| Conventional extension reload, including hook-only extensions and visible flags | Real Pi CLI tests for explicit extension paths and settings-based discovery in `tests/delegate.integration.test.ts` |
| Built-in workspace tools and child-local extension/MCP execution | Real built-in read, tool_search/codemode, and separate child-owned MCP process tests |
| Activation and discoverability preserved | Snapshot validation tests plus real inactive/deferred-tool discovery and execution |
| Unsupported runtime-only source fails explicitly | `tests/inheritance.test.ts`; schema/exposure mismatch and missing-tool validation are also covered |
| Fresh sessions, explicit task/context, final text, usage | Concurrent real children with distinct PIDs/session IDs, no parent-history copy, and delegated usage assertions |
| Failure, cancellation, cleanup, acceptance-versus-completion | `tests/rpc.test.ts` controlled-process scenarios plus real model failure and parent shutdown integration tests |

Final integrated checks: `bun test` (35 passed, 0 failed), `bun run typecheck`, `bun run check`, and `git diff --check` passed after formatting. Frozen-lockfile dependency installation also passed without changes. Real-host tests use Pi 1.0.0 with an isolated deterministic provider and local MCP server, not an external model service. Arbitrary host-only initialization state and other Pi versions remain outside the verified compatibility claim.

## Test Plan

- Use controlled RPC child fixtures to verify prompt acceptance versus completion, model failure, process exit, cancellation, and resource cleanup without requiring model credentials.
- Verify child registration and reachability, not merely prompt text or absence from the direct model declaration list.
- Exercise representative built-in, extension, and MCP reconstruction sources, plus an unsupported runtime-only registration. Verify child-local initialization and activation/discoverability against the parent inputs.
- Add a real Pi RPC smoke test for process startup, extension loading, and final-text delivery in an environment with suitable model credentials. Fixture-only evidence does not establish real-host reconstruction compatibility.

## Out of Scope

- Cross-process proxy execution of inherited tools.
- Reusing child sessions or returning background task handles.
- Automatically transferring the parent's complete conversation.
- Registering or exposing delegation to launched subagents.
- Operating-system sandboxing: the parent-only tool boundary does not prevent a child with shell access from independently launching processes.
