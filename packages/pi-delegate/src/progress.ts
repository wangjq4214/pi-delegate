import type { Usage } from "@earendil-works/pi-ai";
import type { TaskConfiguration } from "./configuration.ts";
import type { DelegationStatus } from "./delegate.ts";
import type { PressureClock } from "./pressure.ts";
import { sumUsage } from "./usage.ts";

export type AcceptedPressure = "none" | "warning" | "urgent";
export interface StatusObserver {
	observe(record: Record<string, unknown>): void;
	accepted(stage: Exclude<AcceptedPressure, "none">): void;
	configured?(configuration: TaskConfiguration): void;
	phase?(phase: "queued" | "initializing" | "running"): void;
	usage?(usage: Usage): void;
	finish(status: DelegationStatus): void;
}
export const taskClock: PressureClock = {
	now: () => performance.now() / 1000,
	schedule: (callback, ms) => {
		const timer = setTimeout(callback, ms);
		return () => clearTimeout(timer);
	},
};

/** Never replay untrusted terminal escapes, bidi controls or cursor commands. */
export function safeText(text: string, multiline = false): string {
	return text
		.replace(
			// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal data sanitization.
			/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[ -/]*[@-~]/g,
			"",
		)
		.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (char) =>
			multiline && char === "\n" ? "\n" : " ",
		)
		.trim();
}

/** Shared observation reducer, independent of UI and execution ownership. */
export class TaskProgress implements StatusObserver {
	startedAt?: number;
	stoppedAt?: number;
	terminalAt?: number;
	turns = 0;
	pressure: AcceptedPressure = "none";
	activity = "initializing…";
	tools = new Map<string, string>();
	status?: DelegationStatus;
	executionPhase: "queued" | "initializing" | "running" = "queued";
	configuration?: TaskConfiguration;
	usageValue: Usage = sumUsage([]);

	constructor(
		readonly id: number,
		readonly title: string,
		private time: PressureClock,
		private valid: () => boolean,
		private changed: () => void,
	) {}

	get elapsedSeconds(): number {
		return this.startedAt === undefined
			? 0
			: Math.max(0, (this.stoppedAt ?? this.time.now()) - this.startedAt);
	}
	phase = (phase: "queued" | "initializing" | "running"): void => {
		if (!this.valid() || this.status || this.startedAt !== undefined) return;
		this.executionPhase = phase;
		this.activity = phase === "queued" ? "queued" : `${phase}…`;
		this.changed();
	};
	usage = (usage: Usage): void => {
		if (!this.valid()) return;
		this.usageValue = structuredClone(usage);
		this.changed();
	};
	configured = (configuration: TaskConfiguration): void => {
		if (!this.valid() || this.status) return;
		this.configuration = structuredClone(configuration);
		this.changed();
	};
	observe = (record: Record<string, unknown>): void => {
		if (!this.valid() || this.status || this.stoppedAt !== undefined) return;
		if (record.type === "agent_start" && this.startedAt === undefined) {
			this.startedAt = this.time.now();
			this.executionPhase = "running";
			this.activity = "running…";
		}
		if (this.startedAt === undefined) return;
		switch (record.type) {
			case "message_update": {
				const event = record.assistantMessageEvent as
					| { type?: string }
					| undefined;
				if (
					event?.type === "thinking_start" ||
					event?.type === "thinking_delta"
				)
					this.activity = "thinking…";
				else if (
					[
						"thinking_end",
						"text_start",
						"text_delta",
						"toolcall_start",
					].includes(event?.type ?? "")
				)
					this.activity = "running…";
				break;
			}
			case "message_start":
			case "message_end":
				this.activity = "running…";
				break;
			case "tool_execution_start":
				if (
					typeof record.toolCallId === "string" &&
					typeof record.toolName === "string"
				)
					this.tools.set(record.toolCallId, safeText(record.toolName));
				this.activity = "running…";
				break;
			case "tool_execution_end":
				if (typeof record.toolCallId === "string")
					this.tools.delete(record.toolCallId);
				this.activity = "running…";
				break;
			case "turn_end":
				this.turns++;
				this.tools.clear();
				this.activity = "running…";
				break;
			case "agent_settled":
			case "rpc_failure":
				this.stoppedAt = this.time.now();
				this.tools.clear();
				this.activity = "finishing…";
		}
		this.changed();
	};
	accepted = (stage: Exclude<AcceptedPressure, "none">): void => {
		if (!this.valid() || this.status) return;
		if (this.pressure !== "urgent") this.pressure = stage;
		this.changed();
	};
	finish = (status: DelegationStatus): void => {
		if (!this.valid() || this.status) return;
		this.status = status;
		this.stoppedAt ??= this.time.now();
		this.terminalAt = this.time.now();
		this.tools.clear();
		this.changed();
	};
}
