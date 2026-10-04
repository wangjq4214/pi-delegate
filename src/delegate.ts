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
	type AgentSession,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	defineTool,
	type ExtensionAPI,
	type ExtensionToolContext,
	formatSize,
	getPackageDir,
	type RpcExtensionUIRequest,
	type RpcExtensionUIResponse,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { BACKGROUND_MESSAGE, BackgroundTasks } from "./background.ts";
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
import { AgentStatus, type StatusObserver } from "./status.ts";

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

function sumUsage(messages: AgentSession["messages"]): Usage {
	const sum: Usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	for (const message of messages) {
		if (message.role !== "assistant" && message.role !== "toolResult") continue;
		const usage = message.usage;
		if (!usage) continue;
		for (const key of [
			"input",
			"output",
			"cacheRead",
			"cacheWrite",
			"totalTokens",
		] as const)
			sum[key] += usage[key];
		for (const key of [
			"input",
			"output",
			"cacheRead",
			"cacheWrite",
			"total",
		] as const)
			sum.cost[key] += usage.cost[key];
		if (usage.reasoning !== undefined)
			sum.reasoning = (sum.reasoning ?? 0) + usage.reasoning;
		if (usage.cacheWrite1h !== undefined)
			sum.cacheWrite1h = (sum.cacheWrite1h ?? 0) + usage.cacheWrite1h;
	}
	return sum;
}

export interface DelegationOptions {
	cwd: string;
	args: string[];
	snapshot: InheritanceSnapshot;
	task: string;
	context?: string;
	pressure?: PressureOverrides;
	status?: StatusObserver;
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
	let directory: string | undefined;
	let rpc: RpcProcess | undefined;
	let settlement: ReturnType<RpcProcess["waitForSettled"]> | undefined;
	let pressure: TaskPressure | undefined;
	let unsubscribePressure: (() => void) | undefined;
	let usage = sumUsage([]);
	const details: Omit<DelegationDetails, "status" | "error"> = {};
	try {
		let result: DelegationResult;
		try {
			options.signal?.throwIfAborted();
			const policy = resolvePressure(options.pressure);
			directory = await mkdtemp(join(tmpdir(), "pi-delegate-"));
			const snapshotPath = join(directory, "inheritance.json");
			await writeFile(snapshotPath, JSON.stringify(options.snapshot), {
				mode: 0o600,
			});
			options.signal?.throwIfAborted();
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
			await rpc.request("prompt", { message: `/${INIT_COMMAND}` });
			const { entries } = await rpc.request<{ entries: SessionEntry[] }>(
				"get_entries",
			);
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

			settlement = rpc.waitForSettled();
			const child = rpc;
			pressure = new TaskPressure(policy, async (message) => {
				const response = await child.request("steer", { message });
				options.status?.accepted(
					message.startsWith("[pi-delegate pressure: urgent]")
						? "urgent"
						: "warning",
				);
				return response;
			});
			unsubscribePressure = rpc.subscribe((record) => {
				pressure?.observe(record);
				options.status?.observe(record);
			});
			options.signal?.addEventListener("abort", pressure.dispose, {
				once: true,
			});
			// Prefixing prevents tasks beginning with '/' from becoming extension commands.
			const message = `Task:\n${options.task}${options.context === undefined ? "" : `\n\nSupplementary context:\n${options.context}`}`;
			const accepted = await rpc.request<{ disposition: string }>("prompt", {
				message,
			});
			if (accepted.disposition !== "started")
				throw new Error(`Child task did not start: ${accepted.disposition}`);
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
			usage = sumUsage(messages);
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
			pressure?.dispose();
			unsubscribePressure?.();
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
		return failedResult(error, options.signal?.aborted, details, usage);
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
	const observedRun: typeof runDelegation = async (options) => {
		try {
			const result = await run(options);
			options.status?.finish(result.details.status);
			return result;
		} catch (error) {
			options.status?.finish(options.signal?.aborted ? "cancelled" : "failed");
			throw error;
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
	const entryPath = fileURLToPath(new URL("./index.ts", import.meta.url));
	const parameters = Type.Object({
		task: Type.String({
			minLength: 1,
			description: "Task for the subagent",
		}),
		title: Type.Optional(
			Type.String({
				description: "Short display title; defaults to the first task line",
			}),
		),
		context: Type.Optional(
			Type.String({
				description:
					"Supplementary context; the parent conversation is not copied",
			}),
		),
		background: Type.Optional(
			Type.Boolean({
				description: "Return a background taskId instead of waiting",
			}),
		),
		pressure: Type.Optional(pressureParameters),
	});
	pi.registerTool(
		defineTool({
			name: DELEGATE_TOOL,
			label: "Delegate",
			description: `Run a task in a fresh Pi RPC subagent with the same extensions and inherited tools, excluding delegation. By default waits for completed, incomplete (generation length limit), failed, or cancelled. Set background:true in a long-lived TUI/RPC session to return a taskId without waiting; completion is delivered to the parent after its current work, waking it if idle. Query with delegate_status or cancel with delegate_cancel. Background usage is separate from Pi parent-session totals. Configure task-local pressure.warning/urgent afterSeconds/afterTurns; omitted values default to 300s OR 20 turns and 600s OR 40 turns. Each urgent threshold must exceed warning after defaults. Each stage steers once to encourage finishing, never automatically cancels. Supply necessary context explicitly. Output is limited to ${formatSize(DEFAULT_MAX_BYTES)} or ${DEFAULT_MAX_LINES} lines; oversized answers include a preview and complete-output file path.`,
			parameters,
			prepareArguments(args) {
				if (args === null || typeof args !== "object" || Array.isArray(args))
					return args as Static<typeof parameters>;
				const prepared = { ...(args as Record<string, unknown>) };
				// Private, clone-safe diagnostic: Pi clones prepared args before execute.
				// Never trust an internal diagnostic supplied by a caller.
				delete prepared.__piDelegatePressureError;
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
				const combined = signal
					? AbortSignal.any([signal, controller.signal])
					: controller.signal;
				try {
					combined.throwIfAborted();
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
					const inherited = captureInheritance(pi, ctx, entryPath);
					const options: DelegationOptions = {
						...inherited,
						cwd: ctx.cwd,
						task: params.task,
						context: params.context,
						pressure: policy,
						signal: combined,
						status: status.add(params.task, params.title),
					};
					if (params.background) return background.start(options, ctx);
					const operation = observedRun({
						...options,
						ui: (request) => forwardUi(ctx, combined, request),
					});
					active.set(controller, operation);
					return await operation;
				} catch (error) {
					return failedResult(error, combined.aborted);
				} finally {
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
					? "Cancel a background task by taskId and await its resource cleanup. Completed tasks retain their result. Does not cancel the parent turn."
					: "Query a background task by taskId, including status, available result and separate usage. Results remain queryable if a completion message was cleared. IDs belong to the current session/branch scope; exit, reload, session replacement or tree navigation invalidates them.",
				parameters: Type.Object({ taskId: Type.String({ minLength: 1 }) }),
				async execute(_id, params) {
					return cancel
						? await background.cancel(params.taskId)
						: background.query(params.taskId);
				},
			}),
		);
	}
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
		for (const controller of active.keys()) controller.abort();
		await Promise.allSettled([...active.values(), background.invalidate(true)]);
	});
}
