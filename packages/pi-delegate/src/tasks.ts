import { randomUUID } from "node:crypto";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type {
	ConfigurationDetails,
	TaskConfiguration,
} from "./configuration.ts";
import type { DelegationResult, DelegationStatus } from "./delegate.ts";
import type { PressureClock, PressurePolicy } from "./pressure.ts";
import { safeText, TaskProgress, taskClock } from "./progress.ts";
import type { SteeringControl } from "./steering.ts";

export type TaskMode = "synchronous" | "background";
export type TaskGroup = "all" | "active" | "finished";
export interface TaskSummary {
	taskId: string;
	label: number;
	title: string;
	mode: TaskMode;
	status: "queued" | "initializing" | "running" | DelegationStatus;
	elapsedSeconds: number;
	turns: number;
	activity: string;
	resultAvailable: boolean;
	cancelling: boolean;
	controls: { cancel: boolean; steer: boolean; reason?: string };
}
export interface TaskDetails extends TaskSummary {
	cwd: { selected: string; effective?: string };
	configuration: ConfigurationDetails;
	currentTools: string[];
	pressure: { policy: PressurePolicy; accepted: TaskProgress["pressure"] };
	usage: TaskProgress["usageValue"];
	delivery: {
		status:
			| "not_applicable"
			| "awaiting_result"
			| "pending"
			| "submitted"
			| "failed";
		error?: string;
	};
}
export interface TaskPage {
	tasks: TaskSummary[];
	total: number;
	nextOffset?: number;
}
export interface TaskInput {
	task: string;
	title?: string;
	mode: TaskMode;
	cwd: string;
	configuration: TaskConfiguration;
	pressure: PressurePolicy;
}

/** Record-only handle: execution/control remain with the existing owners. */
export class TaskRecord {
	readonly taskId = randomUUID();
	readonly progress: TaskProgress;
	result?: DelegationResult;
	private effectiveCwd?: string;
	private control?: SteeringControl;
	private cancelling = false;
	private delivery: TaskDetails["delivery"];
	readonly input: TaskInput;

	constructor(
		label: number,
		input: TaskInput,
		time: PressureClock,
		readonly valid: () => boolean,
		private notify: () => void,
	) {
		// Do not retain task/context bodies in the discoverable record.
		const title = safeText(
			input.title?.trim() || input.task.split(/\r?\n/)[0] || "",
		);
		this.input = { ...structuredClone(input), task: "", title };
		this.progress = new TaskProgress(label, title, time, valid, notify);
		this.delivery = {
			status:
				input.mode === "background" ? "awaiting_result" : "not_applicable",
		};
	}
	spawned = (cwd: string): void => {
		if (!this.valid()) return;
		this.effectiveCwd = cwd;
		this.notify();
	};
	controlled = (control: SteeringControl): void => {
		if (!this.valid()) return;
		this.control = control;
		this.notify();
	};
	cancelRequested = (): void => {
		if (!this.valid() || this.result) return;
		this.cancelling = true;
		this.notify();
	};
	delivered = (error?: string): void => {
		if (!this.valid()) return;
		this.delivery =
			error !== undefined
				? { status: "failed", error }
				: { status: "submitted" };
		this.notify();
	};
	complete(result: DelegationResult): DelegationResult {
		const identified = {
			...result,
			details: { ...result.details, taskId: this.taskId },
		};
		if (!this.valid()) return identified;
		this.result = structuredClone(identified);
		this.effectiveCwd ??= result.details.cwd;
		if (result.details.configuration?.effective)
			this.progress.configuration = structuredClone(
				result.details.configuration.effective,
			);
		this.progress.usageValue = structuredClone(result.usage);
		this.control = undefined;
		this.cancelling = false;
		if (this.input.mode === "background") this.delivery = { status: "pending" };
		this.progress.finish(result.details.status);
		this.notify();
		return identified;
	}
	summary(): TaskSummary {
		const p = this.progress;
		const active = !p.status;
		const background = this.input.mode === "background";
		const readiness = this.control?.state?.() ?? "not_ready";
		const reason = !background
			? "Synchronous tasks are read-only"
			: !active
				? "Task is terminal"
				: this.cancelling
					? "Task is cancelling"
					: readiness === "closed"
						? "Execution control is closed"
						: readiness !== "ready"
							? "Original task is not ready for steering"
							: undefined;
		return {
			taskId: this.taskId,
			label: p.id,
			title: truncateToWidth(p.title, 120),
			mode: this.input.mode,
			status: p.status ?? p.executionPhase,
			elapsedSeconds: p.elapsedSeconds,
			turns: p.turns,
			activity:
				p.status ??
				(p.tools.size
					? `toolcall · ${truncateToWidth([...p.tools.values()].at(-1) ?? "", 120)}${p.tools.size > 1 ? ` (+${p.tools.size - 1})` : ""}`
					: p.activity),
			resultAvailable: !!this.result,
			cancelling: this.cancelling,
			controls: {
				cancel: background && active && !this.cancelling,
				steer:
					background && active && !this.cancelling && readiness === "ready",
				...(reason ? { reason } : {}),
			},
		};
	}
	details(): TaskDetails {
		return {
			...this.summary(),
			title: this.progress.title,
			cwd: {
				selected: this.input.cwd,
				...(this.effectiveCwd ? { effective: this.effectiveCwd } : {}),
			},
			configuration: structuredClone({
				requested: this.input.configuration,
				...(this.progress.configuration
					? { effective: this.progress.configuration }
					: {}),
			}),
			currentTools: [...this.progress.tools.values()],
			pressure: {
				policy: structuredClone(this.input.pressure),
				accepted: this.progress.pressure,
			},
			usage: structuredClone(this.progress.usageValue),
			delivery: { ...this.delivery },
		};
	}
}

export class TaskRecords {
	private records = new Map<string, TaskRecord>();
	private next = 0;
	private epoch = 0;
	private listeners = new Set<() => void>();
	constructor(private time: PressureClock = taskClock) {}
	get generation(): number {
		return this.epoch;
	}
	private notify = (): void => {
		for (const listener of this.listeners) {
			try {
				listener();
			} catch (error) {
				console.error("pi-delegate task view update failed", error);
			}
		}
	};
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	accept(input: TaskInput): TaskRecord {
		const generation = this.epoch;
		const record: TaskRecord = new TaskRecord(
			++this.next,
			input,
			this.time,
			() =>
				this.epoch === generation && this.records.get(record.taskId) === record,
			this.notify,
		);
		this.records.set(record.taskId, record);
		this.notify();
		return record;
	}
	get(taskId: string): TaskRecord | undefined {
		return this.records.get(taskId);
	}
	private ordered(group: TaskGroup): TaskRecord[] {
		if (!["all", "active", "finished"].includes(group))
			throw new Error("Unknown task group");
		const records = [...this.records.values()].filter(
			(record) => group === "all" || (group === "finished") === !!record.result,
		);
		records.sort(
			(a, b) =>
				Number(!!a.result) - Number(!!b.result) ||
				(a.result && b.result
					? (b.progress.terminalAt ?? 0) - (a.progress.terminalAt ?? 0) ||
						b.progress.id - a.progress.id
					: a.progress.id - b.progress.id),
		);
		return records;
	}
	/** Complete metadata-only view; do not repeat a full sort for every bounded page. */
	summaries(group: TaskGroup = "all"): TaskSummary[] {
		return this.ordered(group).map((record) => record.summary());
	}
	list({
		group = "all",
		offset = 0,
		limit = 20,
	}: {
		group?: TaskGroup;
		offset?: number;
		limit?: number;
	} = {}): TaskPage {
		if (!Number.isInteger(offset) || offset < 0)
			throw new Error("offset must be a nonnegative integer");
		if (!Number.isInteger(limit) || limit < 1 || limit > 100)
			throw new Error("limit must be an integer from 1 to 100");
		const records = this.ordered(group);
		const tasks = records
			.slice(offset, offset + limit)
			.map((record) => record.summary());
		return {
			tasks,
			total: records.length,
			...(offset + tasks.length < records.length
				? { nextOffset: offset + tasks.length }
				: {}),
		};
	}
	invalidate(resetLabels = false): void {
		this.epoch++;
		this.records.clear();
		if (resetLabels) this.next = 0;
		this.notify();
	}
}
