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
signal?: AbortSignal, options?: DelegateExecutionOptions): Promise<DelegateResult>`
uses the **same callable path**
as the ordinary delegate tool: input capture/validation, source-or-built entry
reconstruction, records, FIFO admission, child owner and delegated usage ledger.
Tasks appear in `delegate_list` and `/delegates`. By default they also appear in
the compact Agents view; an invocation may opt into consumer-managed presentation
below. Usage snapshots/final reconciliation contribute once per task; observing a result is
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

## Invocation progress and consumer-managed presentation

The additive v1 capability is advertised as optional
`client.capabilities?: { invocationProgress: true }`. Existing v1 clients need
not advertise it. Consumers requiring live progress or row replacement must check
`client.capabilities?.invocationProgress === true` before dispatch and report an
explicit compatibility error if unavailable, not globally hide Agents or import
delegate internals.

```typescript
if (client.capabilities?.invocationProgress !== true)
  throw new Error("This consumer requires delegate invocation progress");
const result = await client.execute(input, ctx, signal, {
  presentation: "consumer",
  onProgress(progress) {
    // Associate this invocation with your own attempt/item, never by title.
    updateView(progress.taskId, progress.phase, progress.cancelling);
  },
});
```

Exported `DelegateExecutionOptions` has optional
`presentation?: "default" | "consumer"` and
`onProgress?: (progress: DelegateExecutionProgress) => void`.
Omitting presentation (or choosing `"default"`) preserves ordinary compact rows,
including when an observer is supplied. `"consumer"` suppresses only this exact
invocation's per-task compact row, from its first display through terminal
retention. Matching titles, unrelated API calls and ordinary synchronous/background
tools are unaffected. Task records, list/status/wait, reports/errors, synchronous
read-only controls and the on-demand `/delegates` panel remain unchanged. Shared
capacity and delegated-usage indicators still include hidden tasks, even when no
per-task rows are visible. Row suppression does not affect inherited child dialogs.

`DelegateExecutionProgress` contains the exact accepted `taskId`,
`phase: "queued" | "initializing" | "running" | "cleanup" | "completed" |
"incomplete" | "failed" | "cancelled"`, and `cancelling: boolean`. Snapshots
start after acceptance, while `execute` is still pending; pre-acceptance
validation/cancellation publishes no observation or invented ID. Phase and
cancellation changes are delivered best-effort, without polling or transcript,
token or output streaming. Duplicate phase/cancellation snapshots are coalesced.
Queueing is not execution; `cleanup` means finishing was actually observed, not
merely that cancellation was requested. Some failures may skip phases when no
finer observation exists. A terminal observation reflects the existing runner's
settlement after cleanup, not evidence acceptance.

The callback is not awaited. Synchronous throws and returned promise rejections
are isolated from child execution, cancellation, results and usage. Notifications
detach on terminal settlement, invocation exit or scope invalidation; no late
old-scope terminal notification is promised. Already-running async observer code
cannot be withdrawn: consumers must guard their own asynchronous continuations
and dispose their view/subscription on replacement. Observing or disposing a view
never cancels, resumes or starts work. Use only the invocation's execution signal
for actual synchronous cancellation and await its result for owned cleanup.
No observation/redraw charges usage again, consumes dispatch allowance, injects
messages or requires TUI mounting; progress also works in RPC/print/JSON modes.

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
