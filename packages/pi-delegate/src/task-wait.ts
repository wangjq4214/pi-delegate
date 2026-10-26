import { Type } from "@earendil-works/pi-ai";
import { type Clock, taskClock } from "./clock.ts";
import type { TaskRecords, TaskSummary } from "./tasks.ts";

export const waitParameters = Type.Object({
	taskIds: Type.Array(Type.String({ minLength: 1 }), {
		minItems: 1,
		description:
			"Exact taskIds in the current session/branch; duplicates count once.",
	}),
	condition: Type.Optional(
		Type.Union([Type.Literal("any"), Type.Literal("all")], {
			description:
				"Return when any (default) or all selected tasks end, including failure/cancellation.",
		}),
	),
	timeoutSeconds: Type.Optional(
		Type.Number({
			exclusiveMinimum: 0,
			maximum: 120,
			description:
				"Positive finite wait duration; defaults to 30 seconds, maximum 120. Timeout does not cancel tasks.",
		}),
	),
});

interface WaitRequest {
	taskIds: string[];
	condition: "any" | "all";
	timeoutSeconds: number;
}
export interface TaskWaitDetails {
	reason: "completed" | "timeout" | "cancelled" | "invalidated";
	tasks: { taskId: string; status: TaskSummary["status"] }[];
}

/** Validate before host argument coercion, and also support direct callers. */
export function validateWaitArguments(args: unknown): WaitRequest {
	if (!args || typeof args !== "object" || Array.isArray(args))
		throw new Error("delegate_wait arguments must be an object");
	const {
		taskIds,
		condition = "any",
		timeoutSeconds = 30,
	} = args as Record<string, unknown>;
	if (
		!Array.isArray(taskIds) ||
		taskIds.length === 0 ||
		taskIds.some((id) => typeof id !== "string" || !id.trim())
	)
		throw new Error(
			"taskIds must be a non-empty array of exact taskId strings",
		);
	if (condition !== "any" && condition !== "all")
		throw new Error('condition must be "any" or "all"');
	if (
		typeof timeoutSeconds !== "number" ||
		!Number.isFinite(timeoutSeconds) ||
		timeoutSeconds <= 0 ||
		timeoutSeconds > 120
	)
		throw new Error(
			"timeoutSeconds must be a positive finite number no greater than 120",
		);
	return { taskIds: [...new Set(taskIds)], condition, timeoutSeconds };
}

/** An observation only: no execution controller, admission lease, result projection or usage. */
export async function waitForTasks(
	records: TaskRecords,
	args: unknown,
	signal?: AbortSignal,
	clock: Clock = taskClock,
): Promise<TaskWaitDetails> {
	const request = validateWaitArguments(args);
	const generation = records.generation;
	const selected = request.taskIds.map((id) => {
		const record = records.get(id);
		if (!record) throw new Error(`Unknown delegated task: ${id}`);
		return record;
	});
	const deadline = clock.now() + request.timeoutSeconds;
	let unsubscribe = () => {};
	let cancelTimeout = () => {};
	let onAbort = () => {};
	try {
		return await new Promise<TaskWaitDetails>((resolve) => {
			let done = false;
			const finish = (
				reason: TaskWaitDetails["reason"],
				tasks: TaskWaitDetails["tasks"] = [],
			) => {
				if (done) return;
				done = true;
				resolve({ reason, tasks });
			};
			const check = (timedOut = false) => {
				if (done) return;
				if (records.generation !== generation) return finish("invalidated");
				if (signal?.aborted) return finish("cancelled");
				const tasks = selected.map((record) => ({
					taskId: record.taskId,
					status:
						record.result?.details.status ?? record.progress.executionPhase,
				}));
				const ended = (record: (typeof selected)[number]) => !!record.result;
				if (
					request.condition === "all"
						? selected.every(ended)
						: selected.some(ended)
				)
					finish("completed", tasks);
				else if (timedOut) finish("timeout", tasks);
			};
			// Subscribe before the initial check; generation and abort are checked on every exit.
			unsubscribe = records.subscribe(() => check());
			onAbort = () => check();
			signal?.addEventListener("abort", onAbort, { once: true });
			check();
			if (!done)
				cancelTimeout = clock.schedule(
					() => check(true),
					Math.max(0, (deadline - clock.now()) * 1000),
				);
		});
	} finally {
		unsubscribe();
		cancelTimeout();
		signal?.removeEventListener("abort", onAbort);
	}
}
