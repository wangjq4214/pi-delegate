import type {
	AgentBeforeSettleEvent,
	AgentEndEvent,
	AgentSettledEvent,
	AgentStartEvent,
	MessageEndEvent,
	TurnEndEvent,
	TurnStartEvent,
} from "@earendil-works/pi-coding-agent";

export type RunOutcome = "completed" | "interrupted" | "failed" | "ended";

export interface RunResult {
	outcome: RunOutcome;
	elapsedMs: number;
}

export interface RunState {
	workingSince: number | undefined;
	lastRun: RunResult | undefined;
}

type RunEvent = AgentStartEvent | AgentEndEvent | AgentBeforeSettleEvent | AgentSettledEvent | MessageEndEvent | TurnStartEvent | TurnEndEvent;

/** Public lifecycle evidence only; no prompts, tool contents or error text are retained. */
export class RunOutcomeTracker {
	private stopReason: string | undefined;
	private pendingOutcome: AgentBeforeSettleEvent["outcome"] | undefined;
	private signal: AbortSignal | undefined;

	private readonly state: RunState;
	private readonly now: () => number;

	constructor(state: RunState, now: () => number = Date.now) {
		this.state = state;
		this.now = now;
	}

	reset(): void {
		this.state.workingSince = undefined;
		this.state.lastRun = undefined;
		this.clearEvidence();
	}

	private clearEvidence(): void {
		this.stopReason = undefined;
		this.pendingOutcome = undefined;
		this.signal = undefined;
	}

	handle(event: RunEvent, signal?: AbortSignal): void {
		if (event.type === "agent_start") {
			// More loops can start within one run (retry, compaction, queued continuation).
			if (this.state.workingSince === undefined) {
				this.state.workingSince = this.now();
				this.state.lastRun = undefined;
			}
			this.clearEvidence();
			this.signal = signal;
			return;
		}
		// Ignore idle session replay, orphan settlement and events after reset/shutdown.
		if (this.state.workingSince === undefined) return;
		if (signal) this.signal = signal;
		switch (event.type) {
			case "turn_start":
				this.stopReason = undefined;
				this.pendingOutcome = undefined;
				break;
			case "turn_end":
				// Later boundaries see finalized/replaced messages from message_end handlers.
				this.stopReason = event.message.role === "assistant" ? event.message.stopReason : undefined;
				this.pendingOutcome = undefined;
				break;
			case "message_end":
				if (event.message.role === "assistant") {
					this.stopReason = event.message.stopReason;
					this.pendingOutcome = undefined;
				}
				break;
			case "agent_end": {
				// This event may precede recovery. It is evidence, not finalization.
				for (let i = event.messages.length - 1; i >= 0; i--) {
					const message = event.messages[i];
					if (message.role !== "assistant") continue;
					this.stopReason = message.stopReason;
					break;
				}
				break;
			}
			case "agent_before_settle":
				this.pendingOutcome = event.outcome;
				break;
			case "agent_settled":
				this.state.lastRun = {
					outcome: this.classify(),
					elapsedMs: Math.max(0, this.now() - this.state.workingSince),
				};
				this.state.workingSince = undefined;
				this.clearEvidence();
				break;
		}
	}

	private classify(): RunOutcome {
		if (this.signal?.aborted || this.stopReason === "aborted") return "interrupted";
		// In Pi 1.0.0, length maps to a completed activity but is not a proven completion.
		if (this.stopReason === "length") return "ended";
		if (this.pendingOutcome === "error" && this.stopReason === "error") return "failed";
		if (this.pendingOutcome === "completed" && (this.stopReason === "stop" || this.stopReason === "toolUse")) return "completed";
		// Cancellation during retry/compaction can skip before-settle and leave a stale
		// error/success message. Settlement alone does not make that message decisive.
		return "ended";
	}
}
