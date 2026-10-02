# RPC subagents with parent-only delegation and tool reinitialization

**Status:** Completed
**Date:** 2026-07-17

## Context

The user wants pi-delegate to register a tool that launches subagents through Pi RPC mode. The delegation tool must be registered only in the parent agent and must not be exposed to subagents launched by that tool.

At proposal time, `src/index.ts` registered only the `/hello` example command and delegation was not implemented. Pi RPC runs a separate process controlled through stdin/stdout JSONL records; see `node_modules/@earendil-works/pi-coding-agent/docs/rpc.md`. Tool registration and exposure are described in `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`.

The user selected tool reinitialization rather than cross-process proxy calls to avoid proxy complexity, and confirmed that subagent sessions do not need to be reused.

## Decision

- Launch subagents through Pi RPC mode.
- Register the delegation tool only in the parent agent. Do not register it in, or expose it to, subagents launched by this tool. Enforce this through registration and reachability controls, not merely prompt instructions.
- Create a fresh subagent for each delegation; do not reuse subagent sessions.
- Reinitialize the parent's tool sources and conventional configuration in the child process rather than forwarding tool execution to the parent process. Load the same extensions using normal discovery, configured/explicit extension paths, and observable tool/command source paths. Replay available startup flags and use the same working directory and inherited environment; no separate user-maintained reconstruction manifest is required.
- Preserve the parent's current tool activation state and retain discoverable tools, including tools reached through `tool_search` or `codemode`, while excluding the delegation tool.
- If a required tool exists only as a runtime registration in the parent and has no reconstructible source or initialization configuration, report an explicit error. Do not silently omit the tool or fall back to proxy execution.

## Consequences

- The implementation must distinguish the parent from its launched subagents so that loading the extension in a child does not register the delegation tool again.
- Tool names alone are insufficient for inheritance: reconstruction requires tool sources and initialization configuration. The implementation replays conventional CLI/configuration discovery and observable tool/command source paths, then validates child tool metadata and restores the active subset. Real Pi RPC, extension, and MCP integration tests verify this mechanism in Pi 1.0.0.
- Child processes share initialization configuration, not the parent's in-memory tool state, connections, or caches. Reinitialization may incur additional startup costs.
- Keeping discoverable tools avoids reducing inheritance to only the tools currently declared to the model.
- The registration boundary is not an operating-system sandbox or a guarantee that a child with shell access cannot launch another process.

### Host verification (2026-10-02)

An isolated probe against Pi 1.0.0 found that the same file-based tool source can have identical public `ToolInfo` and effective settings while using different host-supplied extension flag values. Reinitialization without those flag values changes tool behavior. The extension API's `getFlag()` is scoped to flags registered by the calling extension, so delegation cannot use it to read another extension's flag configuration.

This establishes a configuration-observability limitation, not a reason to reject conventional CLI/configuration replay. The user subsequently clarified that loading the same extensions with normal reinitialization is sufficient. Unobservable host-only configuration is not promised to be copied; no separate reconstruction manifest is required. The earlier blocking interpretation was too strict and is withdrawn (2026-10-02). Probe results and the revised implementation approach are saved locally in `.grimoire/plans/0002-rpc-subagent-delegation.md` (the repository's existing ignore policy excludes plans from Git).

## Delegation contract

- Wait for the fresh subagent to complete before returning the delegation result; do not return a background task handle.
- When the parent delegation call is cancelled, terminate its subagent and clean up owned resources.
- Accept task text and optional supplementary context. Do not automatically copy the parent's complete conversation.
- Return the subagent's final text on success. Explicitly report failure or cancellation instead of presenting either as a successful result.

These lifecycle and input/output requirements were explicitly confirmed by the user.
