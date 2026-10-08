import { randomUUID } from "node:crypto";
import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	DelegationOptions,
	DelegationResult,
	DelegationStatus,
} from "./delegate.ts";

import type { SteeringControl, SteeringReceipt } from "./steering.ts";
import type { TaskDetails, TaskRecord } from "./tasks.ts";
export const BACKGROUND_USAGE_NOTICE =
	"Background task usage is reported separately and is not automatically included in Pi parent-session totals.";
export const BACKGROUND_MESSAGE = "pi-delegate:completed";

type TaskContext = Pick<ExtensionContext, "isIdle" | "hasPendingMessages">;
export interface BackgroundTaskDetails {
	taskId: string;
	status: "queued" | "initializing" | "running" | DelegationStatus;
	result?: DelegationResult["details"];
	usage?: DelegationResult["usage"];
	accounting: string;
	deliveryError?: string;
	task?: TaskDetails;
}
export interface BackgroundTaskResult {
	content: [{ type: "text"; text: string }];
	details: BackgroundTaskDetails;
	isError: boolean;
}
export type BackgroundSteeringResult = {
	content: [{ type: "text"; text: string }];
	details: { taskId: string } & (
		| SteeringReceipt
		| {
				status: "unknown_task" | "terminal" | "cancelling" | "closing";
				error: string;
		  }
	);
	isError: boolean;
};

interface Task {
	id: string;
	controller: AbortController;
	record?: TaskRecord;
	context: TaskContext;
	operation: Promise<void>;
	phase: "queued" | "initializing" | "running";
	usage?: Usage;
	steering?: SteeringControl;
	result?: DelegationResult;
	pendingDelivery: boolean;
	deliveryError?: string;
}

/** Owns work and queued completion independently of the initiating agent turn. */
export class BackgroundTasks {
	private tasks = new Map<string, Task>();
	private cleanups = new Set<Promise<void>>();
	private closed = false;
	private timer?: ReturnType<typeof setTimeout>;

	constructor(
		private run: (options: DelegationOptions) => Promise<DelegationResult>,
		private failure: (error: unknown, cancelled: boolean) => DelegationResult,
		private deliver: (result: BackgroundTaskResult) => void,
	) {}

	start(
		options: DelegationOptions,
		context: TaskContext,
	): BackgroundTaskResult {
		if (this.closed) throw new Error("Background task owner is closing");
		options.signal?.throwIfAborted();
		const task: Task = {
			id: options.taskRecord?.taskId ?? randomUUID(),
			record: options.taskRecord,
			controller: new AbortController(),
			context,
			operation: Promise.resolve(),
			pendingDelivery: false,
			phase: "queued",
		};
		this.tasks.set(task.id, task);
		// Reserve admission at acceptance; async settlement still follows acknowledgement.
		task.operation = (async () =>
			this.run({
				...options,
				signal: task.controller.signal,
				ui: undefined,
				onPhase: (phase) => {
					task.phase = phase;
					options.onPhase?.(phase);
				},
				onUsage: (usage) => {
					task.usage = structuredClone(usage);
					options.onUsage?.(usage);
				},
				onSteeringControl: (control) => {
					task.steering = control;
					options.onSteeringControl?.(control);
				},
			}))()
			.catch((error: unknown) =>
				this.failure(error, task.controller.signal.aborted),
			)
			.then((result) => {
				task.steering = undefined;
				task.result = result;
				task.pendingDelivery = true;
				if (this.tasks.get(task.id) === task) this.scheduleDelivery();
			});
		return this.view(task);
	}

	query(taskId: string): BackgroundTaskResult {
		const task = this.tasks.get(taskId);
		if (!task) {
			return {
				content: [{ type: "text", text: `Unknown background task: ${taskId}` }],
				details: {
					taskId,
					status: "failed",
					accounting: BACKGROUND_USAGE_NOTICE,
				},
				isError: true,
			};
		}
		return this.view(task, true);
	}

	async steer(
		taskId: string,
		message: string,
	): Promise<BackgroundSteeringResult> {
		const task = this.tasks.get(taskId);
		let receipt: BackgroundSteeringResult["details"];
		if (this.closed)
			receipt = {
				taskId,
				status: "closing",
				error: "Background task owner is closing",
			};
		else if (!task)
			receipt = {
				taskId,
				status: "unknown_task",
				error: `Unknown background task: ${taskId}`,
			};
		else if (task.result)
			receipt = {
				taskId,
				status: "terminal",
				error: `Background task is ${task.result.details.status}`,
			};
		else if (task.controller.signal.aborted)
			receipt = {
				taskId,
				status: "cancelling",
				error: "Background task is cancelling",
			};
		else
			receipt = {
				taskId,
				...(task.steering
					? await task.steering.steer(message)
					: {
							status: "not_ready" as const,
							error: "Child initialization has not completed",
						}),
			};
		const notice =
			receipt.status === "accepted"
				? `${receipt.disposition}: ${receipt.disposition === "handled" ? "A trusted Pi input handler handled this submission." : "Pi queued this instruction; it may already have drained or been cleared."} This is not a provider/model-consumption, execution, compliance, or final-result acknowledgement.`
				: `${receipt.status}: ${receipt.error}${receipt.status === "uncertain" ? " Submission outcome is uncertain; host processing may still finish. Do not automatically retry." : ""}`;
		return {
			content: [
				{ type: "text", text: `[Background steering ${taskId}] ${notice}` },
			],
			details: receipt,
			isError: receipt.status !== "accepted",
		};
	}

	async cancel(taskId: string): Promise<BackgroundTaskResult> {
		const task = this.tasks.get(taskId);
		if (!task) return this.query(taskId);
		if (!task.result) {
			task.record?.cancelRequested();
			task.controller.abort();
			await task.operation;
		}
		return this.query(taskId);
	}

	private view(task: Task, includeMetadata = false): BackgroundTaskResult {
		const record = task.record?.valid() ? task.record : undefined;
		const metadata = record?.details();
		const result = record?.result ?? task.result;
		const status = result?.details.status ?? metadata?.status ?? task.phase;
		return {
			content: [
				{
					type: "text",
					text: `[Background task ${task.id}: ${status}]\n${BACKGROUND_USAGE_NOTICE}${includeMetadata && metadata ? `\nTask metadata: ${JSON.stringify(metadata)}` : ""}${result ? `\n\n${result.content[0].text}` : "\nAccepted for background execution; this is not a final task result."}`,
				},
			],
			details: {
				taskId: task.id,
				status,
				...(result
					? {
							result: structuredClone(result.details),
							usage: metadata?.usage ?? structuredClone(result.usage),
						}
					: {}),
				...(!result && (metadata || task.usage)
					? { usage: metadata?.usage ?? structuredClone(task.usage) }
					: {}),
				accounting: BACKGROUND_USAGE_NOTICE,
				...(metadata ? { task: metadata } : {}),
				...(task.deliveryError ? { deliveryError: task.deliveryError } : {}),
			},
			isError: result?.isError ?? false,
		};
	}

	/** Queue in our ownership scope, not an unremovable host follow-up queue. */
	scheduleDelivery(delay = 0): void {
		if (this.closed || this.timer !== undefined) return;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			for (const task of this.tasks.values()) {
				if (
					!task.pendingDelivery ||
					!task.context.isIdle() ||
					task.context.hasPendingMessages()
				)
					continue;
				task.pendingDelivery = false;
				try {
					this.deliver(this.view(task));
				} catch (error) {
					task.deliveryError =
						error instanceof Error ? error.message : String(error);
				}
				task.record?.delivered(task.deliveryError);
			}
			// Queue clearing and async compaction handlers need not emit another settled event.
			if ([...this.tasks.values()].some((task) => task.pendingDelivery))
				this.scheduleDelivery(25);
		}, delay);
	}

	/** Invalidate delivery synchronously, then await execution-resource cleanup. */
	async invalidate(closing = false): Promise<void> {
		this.closed ||= closing;
		const tasks = this.tasks;
		this.tasks = new Map();
		clearTimeout(this.timer);
		this.timer = undefined;
		// Retain detached work so overlapping invalidations cannot lose its cleanup.
		// Register before abort, whose listeners can synchronously reenter this owner.
		const cleanup = Promise.allSettled(
			[...tasks.values()].map((task) => task.operation),
		).then(() => {
			this.cleanups.delete(cleanup);
		});
		this.cleanups.add(cleanup);
		// Ordinary navigation waits only for work invalidated by this boundary,
		// not new work accepted while cleanup is pending. Closing rejects new work.
		const pending = [...this.cleanups];
		for (const task of tasks.values()) {
			if (!task.result) task.controller.abort();
		}
		await Promise.allSettled(pending);
	}
}
