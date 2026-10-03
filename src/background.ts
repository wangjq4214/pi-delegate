import { randomUUID } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	DelegationOptions,
	DelegationResult,
	DelegationStatus,
} from "./delegate.ts";

export const BACKGROUND_USAGE_NOTICE =
	"Background task usage is reported separately and is not automatically included in Pi parent-session totals.";
export const BACKGROUND_MESSAGE = "pi-delegate:completed";

type TaskContext = Pick<ExtensionContext, "isIdle" | "hasPendingMessages">;
export interface BackgroundTaskDetails {
	taskId: string;
	status: "running" | DelegationStatus;
	result?: DelegationResult["details"];
	usage?: DelegationResult["usage"];
	accounting: string;
	deliveryError?: string;
}
export interface BackgroundTaskResult {
	content: [{ type: "text"; text: string }];
	details: BackgroundTaskDetails;
	isError: boolean;
}
interface Task {
	id: string;
	controller: AbortController;
	context: TaskContext;
	operation: Promise<void>;
	result?: DelegationResult;
	pendingDelivery: boolean;
	deliveryError?: string;
}

/** Owns work and queued completion independently of the initiating agent turn. */
export class BackgroundTasks {
	private tasks = new Map<string, Task>();
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
			id: randomUUID(),
			controller: new AbortController(),
			context,
			operation: Promise.resolve(),
			pendingDelivery: false,
		};
		this.tasks.set(task.id, task);
		// Acknowledgement and its tool result precede even an immediately finished child.
		task.operation = new Promise<void>((resolve) => setImmediate(resolve))
			.then(() =>
				this.run({ ...options, signal: task.controller.signal, ui: undefined }),
			)
			.catch((error: unknown) =>
				this.failure(error, task.controller.signal.aborted),
			)
			.then((result) => {
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
		return this.view(task);
	}

	async cancel(taskId: string): Promise<BackgroundTaskResult> {
		const task = this.tasks.get(taskId);
		if (!task) return this.query(taskId);
		if (!task.result) {
			task.controller.abort();
			await task.operation;
		}
		return this.query(taskId);
	}

	private view(task: Task): BackgroundTaskResult {
		const result = task.result;
		const status = result?.details.status ?? "running";
		return {
			content: [
				{
					type: "text",
					text: `[Background task ${task.id}: ${status}]\n${BACKGROUND_USAGE_NOTICE}${result ? `\n\n${result.content[0].text}` : "\nAccepted for background execution; this is not a final task result."}`,
				},
			],
			details: {
				taskId: task.id,
				status,
				...(result ? { result: result.details, usage: result.usage } : {}),
				accounting: BACKGROUND_USAGE_NOTICE,
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
		for (const task of tasks.values()) {
			if (!task.result) task.controller.abort();
		}
		await Promise.allSettled([...tasks.values()].map((task) => task.operation));
	}
}
