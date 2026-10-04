import { randomUUID } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	DelegationOptions,
	DelegationResult,
	DelegationStatus,
} from "./delegate.ts";

import type { SteeringControl, SteeringReceipt } from "./steering.ts";
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
	context: TaskContext;
	operation: Promise<void>;
	steering?: SteeringControl;
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
				this.run({
					...options,
					signal: task.controller.signal,
					ui: undefined,
					onSteeringControl: (control) => {
						task.steering = control;
					},
				}),
			)
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
		return this.view(task);
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
