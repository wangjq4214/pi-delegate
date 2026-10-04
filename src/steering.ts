import { RpcTimeoutError } from "./rpc.ts";

export type SteeringReceipt =
	| { status: "accepted"; disposition: "queued" | "handled" }
	| { status: "not_ready" | "closed" | "failed" | "uncertain"; error: string };

/** The task owner receives no process, transport, or lifecycle authority. */
export interface SteeringControl {
	steer(message: string): Promise<SteeringReceipt>;
}

/** Runner-owned readiness, closure and the one task-local RPC submission boundary. */
export class TaskSteering {
	private started = false;
	private confirmed = false;
	private closed = false;
	private tail: Promise<unknown> = Promise.resolve();
	readonly control: SteeringControl = {
		steer: async (message) => {
			if (this.closed)
				return { status: "closed", error: "Task execution control is closed" };
			if (!this.started || !this.confirmed)
				return {
					status: "not_ready",
					error: "Original task has not started yet",
				};
			try {
				const response = await this.submit(
					`[pi-delegate instruction]\n${message}`,
				);
				const disposition = (response as { disposition?: unknown } | undefined)
					?.disposition;
				if (disposition !== "queued" && disposition !== "handled")
					throw new Error("Unrecognized Pi steering disposition");
				return { status: "accepted", disposition };
			} catch (error) {
				return {
					status:
						error instanceof RpcTimeoutError
							? "uncertain"
							: this.closed
								? "closed"
								: "failed",
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	};

	constructor(private send: (message: string) => Promise<unknown>) {}

	/** Called only after initialization succeeded and the original prompt returned started. */
	confirmStart(): void {
		this.confirmed = true;
	}

	observe = (record: Record<string, unknown>): void => {
		if (record.type === "agent_settled" || record.type === "rpc_failure")
			this.close();
		else if (record.type === "agent_start" && !this.closed) this.started = true;
	};

	close = (): void => {
		this.closed = true;
	};

	/** Automatic pressure already has a non-slash prefix and retains its failure policy. */
	submit(message: string): Promise<unknown> {
		const operation = this.tail.then(() => {
			if (this.closed) throw new Error("Task execution control is closed");
			if (!this.started) throw new Error("Original task has not started yet");
			return this.send(message);
		});
		// A manual failure must neither poison the next submission nor fail the task.
		this.tail = operation.catch(() => {});
		return operation;
	}
}
