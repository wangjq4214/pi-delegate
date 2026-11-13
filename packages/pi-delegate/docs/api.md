# Public consumer API (v1)

Import from `@wangjq4214/pi-delegate/api`, not delegate's internal source files.
The API is additive: load the delegate extension normally. Discovery never loads
or registers it on the consumer's behalf. This boundary is verified on Pi 1.1.0.

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  getDelegateClient,
  isDelegatedChild,
  registerParentOnlyTools,
} from "@wangjq4214/pi-delegate/api";

export default function consumer(pi: ExtensionAPI) {
  if (isDelegatedChild()) return;
  registerParentOnlyTools(pi, ["consumer_work"]);
  // Register consumer_work only in this parent branch.
  pi.registerCommand("consumer-run", {
    handler: async (_args, ctx) => {
      const client = getDelegateClient(pi);
      const controller = new AbortController(); // Consumer owns cancellation.
      const result = await client.execute({
        task: "Inspect the requested files and report the findings",
        context: "Explicit scope and acceptance conditions go here",
        cwd: ctx.cwd,
        title: "Consumer worker",
        budget: { maxTurns: 4 },
      }, ctx, controller.signal);
      ctx.ui.notify(`${result.details.taskId}: ${result.details.status}`, "info");
    },
  });
}
```

## Discovery and lifecycle

`getDelegateClient(pi: ExtensionAPI): DelegateClient` is synchronous. Call it
at `session_start` or later, after all extension factories have loaded. Either
extension load order is supported; do not discover unconditionally during a
factory that might load before delegate. The returned `version` is the literal
`1`. Missing, incompatible, or multiple responding services throw explicit
errors. Discovery uses a versioned request/reply on the shared `pi.events` bus,
not globals, a module-local singleton, or bundled class identity. Separately
bundled/source copies on the same bus register one owner and one set of tools.

Shutdown withdraws the service before awaiting cancellation/cleanup. Captured
clients reject new use after shutdown; discover again in the replacement session.
No task handles survive reload, session replacement, exit, or branch invalidation.
Branch navigation cancels live synchronous API work as well as background work;
a cancelled navigation does not revive the old attempts. No automatic result
messages, continuations, or idle-parent wakeups are added.

## Execution and results

`client.execute(input: DelegateInput, ctx: ExtensionContext,
signal?: AbortSignal): Promise<DelegateResult>` uses the **same callable path**
as the ordinary delegate tool: input capture/validation, source-or-built entry
reconstruction, records, FIFO admission, child owner and delegated usage ledger.
Tasks appear in `delegate_list`, `/delegates` and the compact Agents view. Usage
snapshots/final reconciliation contribute once per task; observing a result is
not a new charge. API consumption itself does not append tool messages or add
usage to the host's parent-session total. A consumer returning usage through its
own tool must avoid charging it again elsewhere.

Inputs support task, title, context, cwd, budget, model, thinkingLevel,
resultFormat and pressure with the ordinary tool meanings. v1 `execute` is
**synchronous**: omit `background` or set it false. `background:true` returns an
explicit failed result without accepting work (there is no ambiguous nonterminal
acknowledgement typed as a terminal result). Ordinary background tools are
unchanged. Execution/validation failures return honest terminal results;
stale-runtime use rejects. An already aborted signal prevents acceptance.

Results contain text blocks, `usage`, `isError`, and `details.status`:
`completed | incomplete | failed | cancelled`. Accepted tasks have
`details.taskId`; validation/pre-acceptance cancellation need not. Available stop
information includes `details.error`, `partialOutput`, `usagePartial`,
`fullOutputPath` and `stopReason`. Additional ordinary tool details may be present.
`completed` describes child termination, not independent acceptance of its work.

Abort the invocation's own signal to cancel queued/running synchronous work. Its
promise resolves only after the existing runner releases owned resources. This
is not instantaneous process termination or rollback of edits/external effects.
Cancelling one caller does not cancel an unrelated ordinary background task.

Manual signal cancellation returns `status: "cancelled"` and `isError: true`,
with available assistant text labelled `partialOutput: true` and conservative
`usagePartial: true`; these flags do not promise that text or usage is available.
No `budgetStop` is invented for a manual stop, and no additional generation is
requested. Text already observed, including bounded shutdown observations, is
retained independently of whether a budget was enabled. Only an assistant-text
prefix of at most 256 Ki UTF-16 code units is buffered (with an explicit omission
notice when capped); this is not a transcript export. Existing preview/full-output
artifacts contain retained text only, not missing provider output or tool logs.

## Observation and background control

These methods reuse the ordinary tools' current paths and return tool-shaped
`{ content, details, isError? }` observations, with no top-level usage charge:

- `client.list({ group?, offset?, limit? } = {})`: bounded summaries like
  `delegate_list`; group is all/active/finished.
- `client.status(taskId)`: metadata and available report like `delegate_status`.
- `client.wait({ taskIds, condition?, timeoutSeconds? }, signal?)`: status-only,
  like `delegate_wait`; any/all, default 30 seconds, maximum 120. Aborting this
  wait does not cancel a task. Retrieve reports separately with `status`.
- `client.cancel(taskId)`: background-only, like `delegate_cancel`, waiting for
  cleanup. Synchronous IDs reject this control; abort their initiating signal.

These methods have the same owning-session visibility as the tools. The API is
not an authorization sandbox or a task-specific access token; consumers must
only cancel background task IDs they own. Goal-like synchronous consumers should
retain their own AbortControllers instead of cancelling unrelated task IDs.

## Parent-only consumer tools

`isDelegatedChild(): boolean` tests `PI_DELEGATE_CHILD === "1"`. Return from the
consumer extension factory before registering tools, commands, loops or state
owners in a child. API discovery/declaration is unavailable in children.

`registerParentOnlyTools(pi: ExtensionAPI, names: readonly string[]): () => void`
declares exact tool names on the shared bus. It works before delegate loads,
captures a copy of the names and returns an unsubscribe function. Shutdown also
withdraws it. Declare before dispatching work and keep it registered for the
runtime's lifetime. Multiple consumers' declarations are combined.

Inheritance excludes these names from the snapshot, active subset and child
CLI `--exclude-tools` registration filter. They cannot remain reachable merely
as inactive or deferred/codemode tools. Child initialization still validates all
other tools and fails on unexpected/missing registrations. Exclusion does not
hardcode consumer-specific names into delegate. It does not replace the child
marker guard for commands/hooks/other orchestration authority and is not an OS
security boundary.

## Build and types

`bun run build` emits `dist/api.js` and standalone `dist/api.d.ts`; both are
published under the `/api` export alongside the existing extension entry. The
declaration depends only on shipped/public host types, never unshipped delegate
internals. Build the local workspace package before consuming its package export.
Source-oriented workspace typechecks may map the public `/api` specifier to
`packages/pi-delegate/src/api.ts`; runtime consumers still use the public export.
