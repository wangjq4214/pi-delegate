import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type AssistantMessage,
	type Static,
	Type,
	type Usage,
} from "@earendil-works/pi-ai";
import {
	defineTool,
	type ExtensionAPI,
	type ExtensionToolContext,
	getPackageDir,
	type JsonAgentSessionEvent,
	type RpcExtensionUIRequest,
	type RpcExtensionUIResponse,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { BACKGROUND_MESSAGE, BackgroundTasks } from "./background.ts";
import {
	type ConfigurationDetails,
	captureConfiguration,
	isThinkingLevel,
	modelParameter,
	type TaskConfiguration,
	thinkingParameter,
	validateSelection,
} from "./configuration.ts";
import { selectCwd, validateCwd, validateCwdInput } from "./cwd.ts";
import {
	CHILD_ENV,
	captureInheritance,
	DELEGATE_TOOL,
	INIT_COMMAND,
	INIT_ENTRY,
	type InheritanceSnapshot,
	SNAPSHOT_ENV,
} from "./inheritance.ts";
import { formatDelegationOutput } from "./output.ts";
import {
	type PressureOverrides,
	pressureParameters,
	resolvePressure,
	TaskPressure,
	validatePressureInput,
} from "./pressure.ts";
import { RpcProcess } from "./rpc.ts";
import { Admission, concurrencyLimit } from "./scheduling.ts";
import { AgentStatus, type StatusObserver } from "./status.ts";
import { type SteeringControl, TaskSteering } from "./steering.ts";
import { entriesUsage, sumUsage, UsageLedger } from "./usage.ts";

export function resolveCli(): string {
	const root = getPackageDir();
	for (const path of [
		join(root, "dist/bundle/cli.js"),
		join(root, "dist/cli.js"),
	]) {
		if (existsSync(path)) return path;
	}
	throw new Error("Cannot locate the Pi CLI in the installed host package");
}

export interface DelegationOptions {
	cwd: string;
	args: string[];
	snapshot: InheritanceSnapshot;
	requestedConfiguration?: TaskConfiguration;
	task: string;
	context?: string;
	pressure?: PressureOverrides;
	status?: StatusObserver;
	onSteeringControl?: (control: SteeringControl) => void;
	onPhase?: (phase: "queued" | "initializing" | "running") => void;
	onUsage?: (usage: Usage) => void;
	signal?: AbortSignal;
	ui?: (
		request: RpcExtensionUIRequest,
	) => Promise<RpcExtensionUIResponse | undefined>;
	cliPath?: string;
	env?: NodeJS.ProcessEnv;
}

export type DelegationStatus =
	| "completed"
	| "incomplete"
	| "failed"
	| "cancelled";

export interface DelegationDetails
	extends Omit<Awaited<ReturnType<typeof formatDelegationOutput>>, "text"> {
	status: DelegationStatus;
	stopReason?: AssistantMessage["stopReason"];
	sessionId?: string;
	error?: string;
	configuration?: ConfigurationDetails;
	/** Absolute startup directory, present only after the child has spawned. */
	cwd?: string;
}

export interface DelegationResult {
	content: [{ type: "text"; text: string }];
	details: DelegationDetails;
	usage: Usage;
	isError: boolean;
}

function failedResult(
	error: unknown,
	cancelled = false,
	details: Omit<DelegationDetails, "status" | "error"> = {},
	usage = sumUsage([]),
): DelegationResult {
	const status = cancelled ? "cancelled" : "failed";
	const message = cancelled
		? "Delegation cancelled"
		: error instanceof Error
			? error.message
			: String(error);
	return {
		content: [
			{
				type: "text",
				text: `[Delegation ${status}: ${message}]${details.fullOutputPath ? `\nPartial output saved to: ${details.fullOutputPath}. Use read to retrieve it.` : ""}`,
			},
		],
		details: { ...details, status, error: message },
		usage,
		isError: true,
	};
}

export async function runDelegation(
	options: DelegationOptions,
): Promise<DelegationResult> {
	options.onPhase?.("initializing");
	let directory: string | undefined;
	let rpc: RpcProcess | undefined;
	let settlement: ReturnType<RpcProcess["waitForSettled"]> | undefined;
	let pressure: TaskPressure | undefined;
	let unsubscribeEvents: (() => void) | undefined;
	let steering: TaskSteering | undefined;
	let usage: Usage | undefined;
	let observedUsage = sumUsage([]);
	let completedUsage = sumUsage([]);
	let streamingUsage: Usage | undefined;
	const pendingToolUsage = new Map<string, Usage>();
	const details: Omit<DelegationDetails, "status" | "error"> =
		options.requestedConfiguration
			? {
					configuration: {
						requested: structuredClone(options.requestedConfiguration),
					},
				}
			: {};
	try {
		let result: DelegationResult;
		try {
			options.signal?.throwIfAborted();
			validateCwd(options.cwd);
			const policy = resolvePressure(options.pressure);
			directory = await mkdtemp(join(tmpdir(), "pi-delegate-"));
			const snapshotPath = join(directory, "inheritance.json");
			await writeFile(snapshotPath, JSON.stringify(options.snapshot), {
				mode: 0o600,
			});
			options.signal?.throwIfAborted();
			// Snapshot creation awaits filesystem work; recheck immediately before spawn.
			validateCwd(options.cwd);
			rpc = new RpcProcess(
				process.versions.bun ? "node" : process.execPath,
				[options.cliPath ?? resolveCli(), "--mode", "rpc", ...options.args],
				{
					cwd: options.cwd,
					env: {
						...process.env,
						...options.env,
						[CHILD_ENV]: "1",
						[SNAPSHOT_ENV]: snapshotPath,
					},
				},
				options.signal,
				options.ui,
			);
			rpc.child.once("spawn", () => {
				details.cwd = options.cwd;
			});
			await rpc.request("prompt", { message: `/${INIT_COMMAND}` });
			const { entries } = await rpc.request<{ entries: SessionEntry[] }>(
				"get_entries",
			);
			observedUsage = entriesUsage(entries);
			completedUsage = observedUsage;
			options.onUsage?.(observedUsage);
			const initialized = [...entries]
				.reverse()
				.find(
					(entry) => entry.type === "custom" && entry.customType === INIT_ENTRY,
				);
			const initialization =
				initialized?.type === "custom"
					? (initialized.data as { ok?: boolean; error?: string } | undefined)
					: undefined;
			if (!initialization?.ok)
				throw new Error(
					initialization?.error ?? "Child initialization handshake failed",
				);

			if (details.configuration) {
				const requested = details.configuration.requested;
				await rpc.request("set_model", {
					provider: requested.model.provider,
					modelId: requested.model.id,
				});
				await rpc.request("set_thinking_level", {
					level: requested.thinkingLevel,
				});
				const state = await rpc.request<{
					model?: { provider?: string; id?: string };
					thinkingLevel?: unknown;
				}>("get_state");
				if (
					state.model?.provider !== requested.model.provider ||
					state.model?.id !== requested.model.id ||
					!isThinkingLevel(state.thinkingLevel)
				)
					throw new Error("Child startup configuration verification failed");
				options.signal?.throwIfAborted();
				const effective: TaskConfiguration = {
					model: { ...requested.model },
					thinkingLevel: state.thinkingLevel,
				};
				details.configuration.effective = effective;
				options.status?.configured?.(effective);
			}
			settlement = rpc.waitForSettled();
			const child = rpc;
			const taskSteering = new TaskSteering((message) =>
				child.request("steer", { message }),
			);
			steering = taskSteering;
			options.onSteeringControl?.(steering.control);
			pressure = new TaskPressure(policy, async (message) => {
				const response = await taskSteering.submit(message);
				options.status?.accepted(
					message.startsWith("[pi-delegate pressure: urgent]")
						? "urgent"
						: "warning",
				);
				return response;
			});
			unsubscribeEvents = rpc.subscribe((record) => {
				// Keep usage even if cancellation/transport failure prevents get_entries.
				// Streaming updates are cumulative; only message_end commits a message.
				const event = record as JsonAgentSessionEvent;
				if (event.type === "message_start") {
					const message = event.message;
					if (message.role === "assistant") streamingUsage = message.usage;
					// Tool results already carry usage at start, before async end hooks finish.
					if (message.role === "toolResult" && message.usage)
						pendingToolUsage.set(message.toolCallId, message.usage);
				}
				if (event.type === "message_update") streamingUsage = event.usage;
				if (event.type === "message_end") {
					const message = event.message;
					if (message.role === "assistant" || message.role === "toolResult") {
						if (message.usage)
							completedUsage = sumUsage([completedUsage, message.usage]);
						if (message.role === "assistant") streamingUsage = undefined;
						else pendingToolUsage.delete(message.toolCallId);
					}
				}
				observedUsage = sumUsage([
					completedUsage,
					...pendingToolUsage.values(),
					...(streamingUsage ? [streamingUsage] : []),
				]);
				options.onUsage?.(observedUsage);
				if (record.type === "agent_start") options.onPhase?.("running");
				steering?.observe(record);
				pressure?.observe(record);
				options.status?.observe(record);
			});
			options.signal?.addEventListener("abort", pressure.dispose, {
				once: true,
			});
			options.signal?.addEventListener("abort", steering.close, { once: true });
			if (options.signal?.aborted) steering.close();
			// Prefixing prevents tasks beginning with '/' from becoming extension commands.
			const message = `Task:\n${options.task}${options.context === undefined ? "" : `\n\nSupplementary context:\n${options.context}`}`;
			const accepted = await rpc.request<{ disposition: string }>("prompt", {
				message,
			});
			if (accepted.disposition !== "started")
				throw new Error(`Child task did not start: ${accepted.disposition}`);
			steering.confirmStart();
			await Promise.race([settlement.promise, pressure.failure]);
			pressure.dispose();
			// Projected get_messages can omit a length response during host recovery.
			// Persisted entries retain every attempt, including the final truncated answer.
			const { entries: resultEntries } = await rpc.request<{
				entries: SessionEntry[];
			}>("get_entries");
			const messages = resultEntries.flatMap((entry) =>
				entry.type === "message" ? [entry.message] : [],
			);
			usage = entriesUsage(resultEntries);
			options.onUsage?.(usage);
			const final = [...messages]
				.reverse()
				.find((item) => item.role === "assistant");
			if (final?.role !== "assistant")
				throw new Error("Child completed without an assistant result");
			details.stopReason = final.stopReason;
			let status: DelegationStatus;
			let error: string | undefined;
			switch (final.stopReason) {
				case "stop":
					status = "completed";
					break;
				case "length":
					status = "incomplete";
					break;
				case "error":
					status = "failed";
					error = final.errorMessage ?? "Child model run failed";
					break;
				case "aborted":
					status = "cancelled";
					error = final.errorMessage ?? "Child task cancelled";
					break;
				default:
					status = "failed";
					error = `Child did not finish with a final answer: ${final.stopReason}`;
			}
			const text = final.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n");
			const state = await rpc.request<{ sessionId: string }>("get_state");
			details.sessionId = state.sessionId;
			options.signal?.throwIfAborted();
			const { text: resultText, ...outputDetails } =
				await formatDelegationOutput(text, options.signal);
			Object.assign(details, outputDetails);
			const notice =
				status === "completed"
					? ""
					: status === "incomplete"
						? "[Delegation incomplete: generation reached its length limit; the answer may be unfinished.]"
						: `[Delegation ${status}: ${error}]`;
			result = {
				content: [
					{
						type: "text",
						text: notice ? `${notice}\n\n${resultText}` : resultText,
					},
				],
				details: {
					...details,
					...outputDetails,
					status,
					...(error === undefined ? {} : { error }),
				},
				usage,
				isError: status === "failed" || status === "cancelled",
			};
		} finally {
			steering?.close();
			if (steering)
				options.signal?.removeEventListener("abort", steering.close);
			pressure?.dispose();
			unsubscribeEvents?.();
			if (pressure)
				options.signal?.removeEventListener("abort", pressure.dispose);
			settlement?.dispose();
			try {
				await rpc?.stop();
			} finally {
				if (directory) await rm(directory, { recursive: true, force: true });
			}
		}
		options.signal?.throwIfAborted();
		return result;
	} catch (error) {
		return failedResult(
			error,
			options.signal?.aborted,
			details,
			usage ?? observedUsage,
		);
	}
}

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
	const admission = new Admission(concurrencyLimit(), (capacity) =>
		status.capacity(capacity),
	);
	const ledger = new UsageLedger((total) => status.total(total));
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
			options.status?.finish(result.details.status);
			return result;
		} catch (error) {
			const result = failedResult(error, options.signal?.aborted, {}, latest);
			options.status?.finish(result.details.status);
			return result;
		} finally {
			release?.();
		}
	};
	const background = new BackgroundTasks(
		observedRun,
		failedResult,
		(result) => {
			pi.sendMessage(
				{
					customType: BACKGROUND_MESSAGE,
					content: result.content,
					display: true,
					details: result.details,
				},
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		},
	);
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
		model: Type.Optional(modelParameter),
		thinkingLevel: Type.Optional(thinkingParameter),
		pressure: Type.Optional(pressureParameters),
	});
	pi.registerTool(
		defineTool({
			name: DELEGATE_TOOL,
			label: "Delegate",
			description:
				"Run a self-contained task in a fresh subagent with inherited tools except delegation. The parent conversation is not copied; supply necessary context. By default the subagent shares the parent working directory; optional cwd selects another existing directory, not a sandbox. Coordinate file edits. By default, wait for the result. With background:true, return a taskId and deliver completion automatically; use delegate_status, delegate_steer, or delegate_cancel to manage the task. Large results include a full-output file path.",
			parameters,
			prepareArguments(args) {
				if (args === null || typeof args !== "object" || Array.isArray(args))
					return args as Static<typeof parameters>;
				const prepared = { ...(args as Record<string, unknown>) };
				// Private, clone-safe diagnostic: Pi clones prepared args before execute.
				// Never trust an internal diagnostic supplied by a caller.
				delete prepared.__piDelegatePressureError;
				delete prepared.__piDelegateSelectionError;
				delete prepared.__piDelegateCwdError;
				try {
					validateCwdInput(prepared.cwd);
				} catch (error) {
					delete prepared.cwd;
					prepared.__piDelegateCwdError =
						error instanceof Error ? error.message : String(error);
				}
				try {
					validateSelection(prepared.model, prepared.thinkingLevel);
				} catch (error) {
					delete prepared.model;
					delete prepared.thinkingLevel;
					prepared.__piDelegateSelectionError =
						error instanceof Error ? error.message : String(error);
				}
				try {
					validatePressureInput(prepared.pressure);
				} catch (error) {
					// Preserve raw rejection without letting host validation bypass failedResult.
					delete prepared.pressure;
					prepared.__piDelegatePressureError =
						error instanceof Error ? error.message : String(error);
				}
				return prepared as Static<typeof parameters>;
			},
			async execute(_id, params, signal, _onUpdate, ctx) {
				const controller = new AbortController();
				const uiController = new AbortController();
				const combined = signal
					? AbortSignal.any([signal, controller.signal])
					: controller.signal;
				try {
					combined.throwIfAborted();
					const cwdError = (
						params as Static<typeof parameters> & {
							__piDelegateCwdError?: string;
						}
					).__piDelegateCwdError;
					if (cwdError !== undefined) throw new Error(cwdError);
					const selectionError = (
						params as Static<typeof parameters> & {
							__piDelegateSelectionError?: string;
						}
					).__piDelegateSelectionError;
					if (selectionError !== undefined) throw new Error(selectionError);
					const preparationError = (
						params as Static<typeof parameters> & {
							__piDelegatePressureError?: string;
						}
					).__piDelegatePressureError;
					if (preparationError !== undefined) throw new Error(preparationError);
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
					const options: DelegationOptions = {
						...inherited,
						requestedConfiguration,
						cwd,
						task: params.task,
						context: params.context,
						pressure: policy,
						signal: combined,
						status: status.add(params.task, params.title),
					};
					if (params.background) return background.start(options, ctx);
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
					return failedResult(error, combined.aborted);
				} finally {
					// Dialogs belong to this invocation, including when the child fails.
					// Do not abort the execution signal and turn a completed result into cancellation.
					uiController.abort();
					active.delete(controller);
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
					: "Get a background task's current status, available result, and separate usage without waiting for completion. Completion is delivered automatically; repeated polling is unnecessary. Results remain queryable if the completion message was cleared.",
				parameters: Type.Object({
					taskId: Type.String({
						minLength: 1,
						description:
							"Exact taskId returned by delegate with background:true in the current session/branch runtime.",
					}),
				}),
				async execute(_id, params) {
					return cancel
						? await background.cancel(params.taskId)
						: background.query(params.taskId);
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
						"Exact taskId returned by delegate with background:true in the current session/branch runtime.",
				}),
				message: Type.String({
					description:
						"Additional instructions or corrections; specify what should change and which constraints still apply.",
				}),
			}),
			async execute(_id, params) {
				return background.steer(params.taskId, params.message);
			},
		}),
	);
	pi.on("session_start", (_event, ctx) => status.bind(ctx));
	pi.on("agent_settled", () => background.scheduleDelivery());
	pi.on("session_compact", () => background.scheduleDelivery());
	pi.on("session_compact_failed", () => background.scheduleDelivery());
	pi.on("session_before_tree", async (event) => {
		if (event.preparation.targetId !== event.preparation.oldLeafId) {
			status.clear();
			await background.invalidate();
		}
	});
	pi.on("session_tree", async (event) => {
		// A prompt may accept new work while before-tree handlers/summarization await.
		// Commit invalidation prevents that source-branch work reaching the new leaf.
		if (event.newLeafId !== event.oldLeafId) {
			status.clear();
			await background.invalidate();
		}
	});
	pi.on("session_shutdown", async () => {
		status.close();
		ledger.close();
		for (const controller of active.keys()) controller.abort();
		await Promise.allSettled([...active.values(), background.invalidate(true)]);
	});
}
