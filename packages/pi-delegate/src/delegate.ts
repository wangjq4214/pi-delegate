import { fileURLToPath } from "node:url";
import { type Static, Type, type Usage } from "@earendil-works/pi-ai";
import {
	defineTool,
	type ExtensionAPI,
	type ExtensionToolContext,
	type RpcExtensionUIRequest,
	type RpcExtensionUIResponse,
} from "@earendil-works/pi-coding-agent";
import {
	prepareDelegationArguments,
	validatePreparedArguments,
} from "./arguments.ts";
import { BackgroundTasks } from "./background.ts";
import { budgetParameters } from "./budget.ts";
import {
	captureConfiguration,
	modelParameter,
	thinkingParameter,
} from "./configuration.ts";
import { selectCwd } from "./cwd.ts";
import { type DelegationOptions, failedResult } from "./delegation.ts";
import { captureInheritance, DELEGATE_TOOL } from "./inheritance.ts";
import { pressureParameters, resolvePressure } from "./pressure.ts";
import { resultFormatParameter } from "./result-format.ts";
import { runDelegation } from "./runner.ts";
import { Admission, concurrencyLimit } from "./scheduling.ts";
import { AgentStatus } from "./status.ts";
import { registerTaskPanel } from "./task-panel.ts";
import { taskQuery } from "./task-query.ts";
import {
	validateWaitArguments,
	waitForTasks,
	waitParameters,
} from "./task-wait.ts";
import { type TaskRecord, TaskRecords } from "./tasks.ts";
import { sumUsage, UsageLedger } from "./usage.ts";

// Preserve the existing source import seam while internals depend on contracts/runner directly.
export type {
	DelegationDetails,
	DelegationOptions,
	DelegationResult,
	DelegationStatus,
	StartupStage,
} from "./delegation.ts";
export { resolveCli, runDelegation } from "./runner.ts";

async function forwardUi(
	ctx: ExtensionToolContext,
	signal: AbortSignal,
	request: RpcExtensionUIRequest,
): Promise<RpcExtensionUIResponse | undefined> {
	if (!ctx.hasUI || signal.aborted) return undefined;
	const opts = {
		signal,
		timeout: "timeout" in request ? request.timeout : undefined,
	};
	const title = "title" in request ? `[subagent] ${request.title}` : "Subagent";
	switch (request.method) {
		case "select": {
			const value = await ctx.ui.select(title, request.options, opts);
			return {
				type: "extension_ui_response",
				id: request.id,
				...(value === undefined ? { cancelled: true } : { value }),
			};
		}
		case "confirm":
			return {
				type: "extension_ui_response",
				id: request.id,
				confirmed: await ctx.ui.confirm(title, request.message, opts),
			};
		case "input": {
			const value = await ctx.ui.input(title, request.placeholder, opts);
			return {
				type: "extension_ui_response",
				id: request.id,
				...(value === undefined ? { cancelled: true } : { value }),
			};
		}
		case "notify":
			ctx.ui.notify(`[subagent] ${request.message}`, request.notifyType);
			break;
		// Editor has no abortable extension API. Cancel it rather than orphaning an editor on tool cancellation.
		case "editor":
			return { type: "extension_ui_response", id: request.id, cancelled: true };
	}
	return undefined;
}

export function registerDelegate(
	pi: ExtensionAPI,
	run: typeof runDelegation = runDelegation,
): void {
	const active = new Map<AbortController, Promise<unknown>>();
	const status = new AgentStatus();
	const updateStatus = (update: () => void): void => {
		try {
			update();
		} catch (error) {
			console.error("pi-delegate Agents view update failed", error);
		}
	};
	const records = new TaskRecords();
	records.subscribe(status.update);
	const admission = new Admission(concurrencyLimit(), (capacity) =>
		updateStatus(() => status.capacity(capacity)),
	);
	const ledger = new UsageLedger((total) =>
		updateStatus(() => status.total(total)),
	);
	const observedRun: typeof runDelegation = async (options) => {
		const task = {};
		let latest = sumUsage([]);
		const report = (usage: Usage) => {
			latest = structuredClone(usage);
			ledger.update(task, usage);
			options.status?.usage?.(usage);
			options.onUsage?.(usage);
		};
		let release: (() => void) | undefined;
		const phase = (value: "queued" | "initializing" | "running") => {
			options.status?.phase?.(value);
			options.onPhase?.(value);
		};
		try {
			phase("queued");
			release = await admission.acquire(options.signal, () =>
				phase("initializing"),
			);
			options.signal?.throwIfAborted();
			const result = await run({ ...options, onPhase: phase, onUsage: report });
			report(result.usage);
			const identified = options.taskRecord?.complete(result) ?? result;
			options.status?.finish(result.details.status);
			return identified;
		} catch (error) {
			const result = failedResult(error, options.signal?.aborted, {}, latest);
			const identified = options.taskRecord?.complete(result) ?? result;
			options.status?.finish(result.details.status);
			return identified;
		} finally {
			release?.();
		}
	};
	const background = new BackgroundTasks(observedRun, failedResult);
	const entryPath = fileURLToPath(
		new URL(
			import.meta.url.endsWith(".ts") ? "./index.ts" : "./index.js",
			import.meta.url,
		),
	);
	const parameters = Type.Object({
		task: Type.String({
			minLength: 1,
			description:
				"Self-contained task: specify the goal, scope, constraints, and expected deliverable.",
		}),
		title: Type.Optional(
			Type.String({
				description: "Short UI label; defaults to the first task line",
			}),
		),
		context: Type.Optional(
			Type.String({
				description:
					"Relevant background, decisions, or file paths. The parent conversation is not copied.",
			}),
		),
		cwd: Type.Optional(
			Type.String({
				description:
					"Existing child startup directory. Relative paths resolve against the parent cwd at submission; omitted uses parent cwd. Not a sandbox.",
			}),
		),
		background: Type.Optional(
			Type.Boolean({
				description:
					"Return a taskId without waiting. Default false; requires a long-lived TUI/RPC session. Tasks do not survive exit, reload, session replacement, or branch navigation. Usage is separate from parent-session totals.",
			}),
		),
		resultFormat: Type.Optional(resultFormatParameter),
		model: Type.Optional(modelParameter),
		thinkingLevel: Type.Optional(thinkingParameter),
		pressure: Type.Optional(pressureParameters),
		budget: Type.Optional(budgetParameters),
	});
	pi.registerTool(
		defineTool({
			name: DELEGATE_TOOL,
			label: "Delegate",
			description:
				"Run a self-contained task in a fresh subagent with inherited tools except delegation. The parent conversation is not copied; supply necessary context. By default the subagent shares the parent working directory; optional cwd selects another existing directory, not a sandbox. Coordinate file edits. By default, wait for the result. With background:true, return a taskId without waiting; completion does not send an automatic message or wake the parent; use delegate_list to discover tasks, delegate_wait to wait for task statuses, and delegate_status to retrieve reports. delegate_steer/delegate_cancel manage background tasks only. Large results include a full-output file path.",
			parameters,
			prepareArguments(args) {
				return prepareDelegationArguments(args) as Static<typeof parameters>;
			},
			async execute(_id, params, signal, _onUpdate, ctx) {
				const controller = new AbortController();
				const uiController = new AbortController();
				const combined = signal
					? AbortSignal.any([signal, controller.signal])
					: controller.signal;
				let record: TaskRecord | undefined;
				try {
					combined.throwIfAborted();
					const budget = validatePreparedArguments(params);
					if (!params.task.trim())
						throw new Error("Delegation task must not be blank");
					if (params.background && ctx.mode !== "tui" && ctx.mode !== "rpc")
						throw new Error(
							"Background delegation requires a long-lived TUI or RPC parent session",
						);
					const policy = resolvePressure(params.pressure);
					const requestedConfiguration = captureConfiguration(
						ctx,
						params.model,
						params.thinkingLevel,
					);
					const cwd = selectCwd(ctx.cwd, params.cwd);
					const inherited = captureInheritance(
						pi,
						ctx,
						entryPath,
						process.argv.slice(2),
						cwd,
					);
					record = records.accept({
						task: params.task,
						title: params.title,
						mode: params.background ? "background" : "synchronous",
						cwd,
						configuration: requestedConfiguration,
						pressure: policy,
						budget,
					});
					const progress = record.progress;
					updateStatus(() => status.show(progress));
					const options: DelegationOptions = {
						...inherited,
						requestedConfiguration,
						cwd,
						task: params.task,
						context: params.context,
						resultFormat: params.resultFormat,
						pressure: policy,
						budget,
						signal: combined,
						status: record.progress,
						taskRecord: record,
						onCwd: record.spawned,
						onSteeringControl: record.controlled,
					};
					if (params.background) return background.start(options);
					const operation = observedRun({
						...options,
						ui: (request) =>
							forwardUi(
								ctx,
								AbortSignal.any([combined, uiController.signal]),
								request,
							),
					});
					active.set(controller, operation);
					return await operation;
				} catch (error) {
					const result = failedResult(error, combined.aborted);
					return record?.complete(result) ?? result;
				} finally {
					// Dialogs belong to this invocation, including when the child fails.
					// Do not abort the execution signal and turn a completed result into cancellation.
					uiController.abort();
					active.delete(controller);
				}
			},
		}),
	);
	const query = (taskId: string) => {
		const record = records.get(taskId);
		if (!record)
			return {
				content: [
					{ type: "text" as const, text: `Unknown delegated task: ${taskId}` },
				],
				details: { taskId, status: "failed" as const },
				isError: true,
			};
		const backgroundMode = record.input.mode === "background";
		if (backgroundMode) {
			const view = background.query(taskId);
			if (view.details.task) return view;
		}
		const task = record.details();
		return taskQuery(
			{
				taskId,
				mode: record.input.mode,
				status: task.status,
				task,
				result: record.result,
				usage: task.usage,
			},
			"record",
		);
	};
	pi.registerTool(
		defineTool({
			name: "delegate_list",
			label: "List delegated tasks",
			description:
				"Discover synchronous and background tasks in the current session/branch without remembered task IDs. Returns bounded summaries, not results; use delegate_wait to wait without polling, then delegate_status for details. Observing tasks does not charge usage again.",
			parameters: Type.Object({
				group: Type.Optional(
					Type.Union([
						Type.Literal("all"),
						Type.Literal("active"),
						Type.Literal("finished"),
					]),
				),
				offset: Type.Optional(
					Type.Integer({
						minimum: 0,
						description:
							"Live-list offset; defaults to 0. Ordering can change as tasks finish.",
					}),
				),
				limit: Type.Optional(
					Type.Integer({
						minimum: 1,
						maximum: 100,
						description: "Maximum summaries; defaults to 20.",
					}),
				),
			}),
			async execute(_id, params) {
				try {
					const page = records.list(params);
					return {
						content: [{ type: "text", text: JSON.stringify(page) }],
						details: page,
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: error instanceof Error ? error.message : String(error),
							},
						],
						details: undefined,
						isError: true,
					};
				}
			},
		}),
	);
	pi.registerTool(
		defineTool({
			name: "delegate_wait",
			label: "Wait for delegated tasks",
			description:
				"Wait for any (default) or all selected synchronous/background tasks to end, including failure/cancellation. Default timeout 30 seconds, maximum 120. Returns only task statuses, never reports; use delegate_status to retrieve reports. Timeout or cancelling this wait does not cancel tasks. Scope invalidation ends obsolete waits. Observing tasks does not charge usage again.",
			parameters: waitParameters,
			prepareArguments: validateWaitArguments,
			async execute(_id, params, signal) {
				try {
					const details = await waitForTasks(records, params, signal);
					return {
						content: [{ type: "text", text: JSON.stringify(details) }],
						details,
						isError:
							details.reason === "cancelled" ||
							details.reason === "invalidated",
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: error instanceof Error ? error.message : String(error),
							},
						],
						details: undefined,
						isError: true,
					};
				}
			},
		}),
	);
	for (const cancel of [false, true]) {
		pi.registerTool(
			defineTool({
				name: cancel ? "delegate_cancel" : "delegate_status",
				label: cancel ? "Cancel delegated task" : "Delegated task status",
				description: cancel
					? "Cancel a background task and wait for cleanup. Already-finished tasks return their existing result. Does not cancel the parent turn or undo changes already made."
					: "Get a synchronous or background task's current status, metadata, available result, and usage without waiting for completion. Background tasks do not send automatic completion messages or wake the parent; query results on demand. Results remain available until the current session/branch scope is invalidated.",
				parameters: Type.Object({
					taskId: Type.String({
						minLength: 1,
						description:
							"Exact taskId returned by delegate or discovered by delegate_list in the current session/branch runtime.",
					}),
				}),
				async execute(_id, params) {
					if (!cancel) return query(params.taskId);
					const record = records.get(params.taskId);
					if (record?.input.mode === "synchronous")
						return {
							content: [
								{
									type: "text",
									text: "Synchronous tasks are read-only; cancel the initiating call instead.",
								},
							],
							details: { taskId: params.taskId },
							isError: true,
						};
					if (record?.result) return query(params.taskId);
					return background.cancel(params.taskId);
				},
			}),
		);
	}
	pi.registerTool(
		defineTool({
			name: "delegate_steer",
			label: "Steer delegated task",
			description:
				"Send additional instructions to an active background task without restarting it or interrupting its current operation. Acceptance does not mean the instructions have been followed. Do not automatically retry after a timeout: submission may have succeeded.",
			parameters: Type.Object({
				taskId: Type.String({
					minLength: 1,
					description:
						"Exact taskId returned by delegate with background:true or discovered by delegate_list for a background task in the current session/branch runtime.",
				}),
				message: Type.String({
					description:
						"Additional instructions or corrections; specify what should change and which constraints still apply.",
				}),
			}),
			async execute(_id, params) {
				if (records.get(params.taskId)?.input.mode === "synchronous")
					return {
						content: [
							{
								type: "text",
								text: "Synchronous tasks are read-only; manual steering is background-only.",
							},
						],
						details: {
							taskId: params.taskId,
							status: "failed" as const,
							error: "Synchronous tasks are read-only",
						},
						isError: true,
					};
				return background.steer(params.taskId, params.message);
			},
		}),
	);
	registerTaskPanel(pi, records, {
		cancel: (taskId) => background.cancel(taskId),
		steer: (taskId, message) => background.steer(taskId, message),
	});
	pi.on("session_start", (_event, ctx) => {
		records.invalidate(true);
		updateStatus(() => status.bind(ctx));
	});
	pi.on("session_before_tree", async (event) => {
		if (event.preparation.targetId !== event.preparation.oldLeafId) {
			updateStatus(() => status.clear());
			records.invalidate();
			await background.invalidate();
		}
	});
	pi.on("session_tree", async (event) => {
		// A prompt may accept new work while before-tree handlers/summarization await.
		// Commit invalidation prevents that source-branch work reaching the new leaf.
		if (event.newLeafId !== event.oldLeafId) {
			updateStatus(() => status.clear());
			records.invalidate();
			await background.invalidate();
		}
	});
	pi.on("session_shutdown", async () => {
		updateStatus(() => status.close());
		records.invalidate();
		ledger.close();
		for (const controller of active.keys()) controller.abort();
		await Promise.allSettled([...active.values(), background.invalidate(true)]);
	});
}
