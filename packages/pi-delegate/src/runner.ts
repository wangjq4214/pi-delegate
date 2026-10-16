import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Usage } from "@earendil-works/pi-ai";
import {
	getPackageDir,
	type JsonAgentSessionEvent,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { resolveBudget, TaskBudget } from "./budget.ts";
import { isThinkingLevel, type TaskConfiguration } from "./configuration.ts";
import { validateCwd } from "./cwd.ts";
import {
	type DelegationDetails,
	type DelegationOptions,
	type DelegationResult,
	type DelegationStatus,
	failedResult,
	type StartupStage,
} from "./delegation.ts";
import {
	CHILD_ENV,
	INIT_COMMAND,
	INIT_ENTRY,
	SNAPSHOT_ENV,
} from "./inheritance.ts";
import {
	type InitializationProgress,
	readInitializationProgress,
} from "./initialization-progress.ts";
import { ObservedOutput } from "./observed-output.ts";
import { ObservedUsage } from "./observed-usage.ts";
import { formatDelegationOutput } from "./output.ts";
import { resolvePressure, TaskPressure } from "./pressure.ts";
import { delegationPrompt, validateResultFormat } from "./result-format.ts";
import { RpcProcess, RpcTimeoutError } from "./rpc.ts";
import { TaskSteering } from "./steering.ts";
import { entriesUsage } from "./usage.ts";

export async function runDelegation(
	options: DelegationOptions,
): Promise<DelegationResult> {
	options.onPhase?.("initializing");
	let directory: string | undefined;
	let snapshotPath: string | undefined;
	let initializationProgress: InitializationProgress | undefined;
	let rpc: RpcProcess | undefined;
	let settlement: ReturnType<RpcProcess["waitForSettled"]> | undefined;
	let startupStage: StartupStage | undefined = "prepare";
	let primaryFailure: { error: unknown } | undefined;
	const startupBegan = performance.now();
	let operation = "prepare";
	let operationBegan = startupBegan;
	const timings: { operation: string; elapsedMs: number }[] = [];
	const beginOperation = (next: string) => {
		const now = performance.now();
		timings.push({ operation, elapsedMs: Math.max(0, now - operationBegan) });
		operation = next;
		operationBegan = now;
	};
	const startupTiming = () => {
		const now = performance.now();
		return {
			elapsedMs: Math.max(0, now - startupBegan),
			operation,
			timings: [
				...timings,
				{ operation, elapsedMs: Math.max(0, now - operationBegan) },
			],
		};
	};
	let failureTiming: ReturnType<typeof startupTiming> | undefined;
	const started = () => {
		startupStage = undefined;
		rpc?.discardDiagnostics();
	};
	let budget: TaskBudget | undefined;
	let rejectBudget!: (error: Error) => void;
	const budgetStopped = new Promise<never>((_resolve, reject) => {
		rejectBudget = reject;
	});
	void budgetStopped.catch(() => {});
	const observedOutput = new ObservedOutput();
	let pressure: TaskPressure | undefined;
	let unsubscribeEvents: (() => void) | undefined;
	let steering: TaskSteering | undefined;
	let usage: Usage | undefined;
	let observedUsage = new ObservedUsage();
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
			validateResultFormat(options.resultFormat);
			const effectiveBudget = resolveBudget(options.budget);
			if (effectiveBudget) details.budget = effectiveBudget;
			validateCwd(options.cwd);
			const policy = resolvePressure(options.pressure);
			directory = await mkdtemp(join(tmpdir(), "pi-delegate-"));
			snapshotPath = join(directory, "inheritance.json");
			await writeFile(snapshotPath, JSON.stringify(options.snapshot), {
				mode: 0o600,
			});
			options.signal?.throwIfAborted();
			// Snapshot creation awaits filesystem work; recheck immediately before spawn.
			validateCwd(options.cwd);
			startupStage = "spawn";
			beginOperation("child startup + initialization handshake");
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
				options.onCwd?.(options.cwd);
				startupStage = "initialize";
			});
			await rpc.request("prompt", { message: `/${INIT_COMMAND}` });
			beginOperation("initialization readback");
			const { entries } = await rpc.request<{ entries: SessionEntry[] }>(
				"get_entries",
			);
			observedUsage = new ObservedUsage(entries, !!effectiveBudget);
			options.onUsage?.(observedUsage.snapshot());
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
				startupStage = "configure";
				const requested = details.configuration.requested;
				beginOperation("model selection");
				await rpc.request("set_model", {
					provider: requested.model.provider,
					modelId: requested.model.id,
				});
				beginOperation("thinking selection");
				await rpc.request("set_thinking_level", {
					level: requested.thinkingLevel,
				});
				beginOperation("configuration readback");
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
			if (effectiveBudget)
				budget = new TaskBudget(effectiveBudget, (cause) => {
					if (options.signal?.aborted) return;
					details.budgetStop = cause;
					pressure?.dispose();
					steering?.close();
					// Initiate cancellation now, never ask the model for a wrap-up answer.
					void child.request("abort", {}, 250).catch(() => {});
					rejectBudget(new Error("Execution budget reached"));
				});
			unsubscribeEvents = rpc.subscribe((record) => {
				// Keep usage even if cancellation/transport failure prevents get_entries.
				// Streaming updates are cumulative; only message_end commits a message.
				const event = record as JsonAgentSessionEvent;
				if (effectiveBudget) observedOutput.observe(event);
				observedUsage.observe(event);
				if (usage === undefined) options.onUsage?.(observedUsage.snapshot());
				if (record.type === "agent_start") {
					started();
					options.onPhase?.("running");
				}
				steering?.observe(record);
				budget?.observe(record);
				pressure?.observe(record);
				options.status?.observe(record);
			});
			options.signal?.addEventListener("abort", pressure.dispose, {
				once: true,
			});
			if (budget)
				options.signal?.addEventListener("abort", budget.dispose, {
					once: true,
				});
			options.signal?.addEventListener("abort", steering.close, { once: true });
			if (options.signal?.aborted) steering.close();
			const message = delegationPrompt(
				options.task,
				options.context,
				options.resultFormat,
				effectiveBudget,
			);
			startupStage = "submit";
			beginOperation("task submission");
			const accepted = await Promise.race([
				rpc.request<{ disposition: string }>("prompt", { message }),
				budgetStopped,
			]);
			if (accepted.disposition !== "started")
				throw new Error(`Child task did not start: ${accepted.disposition}`);
			started();
			steering.confirmStart();
			if (details.budgetStop) throw new Error("Execution budget reached");
			await Promise.race([settlement.promise, pressure.failure, budgetStopped]);
			if (details.budgetStop) throw new Error("Execution budget reached");
			pressure.dispose();
			budget?.dispose();
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
		} catch (error) {
			if (details.budgetStop && rpc) {
				try {
					// Bounded cleanup readback, not an execution/reporting grace period.
					const { entries } = await rpc.request<{ entries: SessionEntry[] }>(
						"get_entries",
						{},
						250,
					);
					usage = observedUsage.readback(entries);
					options.onUsage?.(usage);
				} catch {
					/* Retain event observations if final entries are unavailable. */
				}
			}
			if (startupStage) failureTiming = startupTiming();
			primaryFailure = { error };
			throw error;
		} finally {
			budget?.dispose();
			if (budget) options.signal?.removeEventListener("abort", budget.dispose);
			steering?.close();
			if (steering)
				options.signal?.removeEventListener("abort", steering.close);
			pressure?.dispose();
			if (!details.budgetStop) {
				unsubscribeEvents?.();
				unsubscribeEvents = undefined;
			}
			if (pressure)
				options.signal?.removeEventListener("abort", pressure.dispose);
			settlement?.dispose();
			try {
				await rpc?.stop();
			} finally {
				unsubscribeEvents?.();
				if (startupStage && !options.signal?.aborted && snapshotPath)
					initializationProgress =
						await readInitializationProgress(snapshotPath);
				if (directory) await rm(directory, { recursive: true, force: true });
			}
		}
		options.signal?.throwIfAborted();
		return result;
	} catch (error) {
		if (details.budgetStop) {
			const stop = details.budgetStop;
			const message = `Execution budget reached: ${stop.dimension} limit ${stop.limit}, observed ${stop.observed}`;
			const { text, ...outputDetails } = await formatDelegationOutput(
				observedOutput.text(),
			);
			const finalUsage = observedUsage.retained();
			options.onUsage?.(finalUsage);
			return {
				content: [
					{
						type: "text",
						text: `[Delegation cancelled: ${message}. Partial output; usage may be partial.]${text ? `\n\n${text}` : ""}`,
					},
				],
				details: {
					...details,
					...outputDetails,
					status: "cancelled",
					error: message,
					partialOutput: true,
					usagePartial: true,
				},
				usage: finalUsage,
				isError: true,
			};
		}
		if (startupStage && !options.signal?.aborted) {
			const failure = primaryFailure?.error ?? error;
			details.startupDiagnostics = {
				stage: startupStage,
				...(failureTiming ?? startupTiming()),
				...(rpc?.diagnostics() ?? { stderr: "", stderrTruncated: false }),
				...(failure instanceof RpcTimeoutError && failure.request
					? { timeout: failure.request }
					: {}),
				...(initializationProgress
					? { initialization: initializationProgress }
					: {}),
			};
		}
		return failedResult(
			primaryFailure ? primaryFailure.error : error,
			options.signal?.aborted,
			details,
			usage ?? observedUsage.snapshot(),
		);
	}
}

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
