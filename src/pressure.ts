import { Type } from "@earendil-works/pi-ai";

const stageParameters = Type.Object(
	{
		afterSeconds: Type.Optional(
			Type.Number({
				exclusiveMinimum: 0,
				description:
					"Elapsed task-running seconds (positive, finite; fractions allowed)",
			}),
		),
		afterTurns: Type.Optional(
			Type.Integer({
				minimum: 1,
				description: "Completed assistant-plus-tools turns (positive integer)",
			}),
		),
	},
	{ additionalProperties: false },
);

export const pressureParameters = Type.Object(
	{
		warning: Type.Optional(stageParameters),
		urgent: Type.Optional(stageParameters),
	},
	{
		additionalProperties: false,
		description:
			"Task-local soft pressure. Omitted values default to warning: 300 seconds OR 20 turns; urgent: 600 seconds OR 40 turns. Urgent thresholds must each exceed warning. Each stage reminds once, never automatically cancels.",
	},
);

interface PressureStage {
	afterSeconds: number;
	afterTurns: number;
}
export interface PressureOverrides {
	warning?: Partial<PressureStage>;
	urgent?: Partial<PressureStage>;
}
export interface PressurePolicy {
	warning: PressureStage;
	urgent: PressureStage;
}

function object(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${path} must be an object`);
	return value as Record<string, unknown>;
}

function readPressure(value: unknown = undefined): PressurePolicy {
	const input = value === undefined ? {} : object(value, "pressure");
	for (const key of Object.keys(input)) {
		if (key !== "warning" && key !== "urgent")
			throw new Error(`Unknown pressure setting: pressure.${key}`);
	}
	const policy: PressurePolicy = {
		warning: { afterSeconds: 300, afterTurns: 20 },
		urgent: { afterSeconds: 600, afterTurns: 40 },
	};
	for (const stage of ["warning", "urgent"] as const) {
		const values =
			input[stage] === undefined
				? {}
				: object(input[stage], `pressure.${stage}`);
		for (const key of Object.keys(values)) {
			if (key !== "afterSeconds" && key !== "afterTurns")
				throw new Error(`Unknown pressure setting: pressure.${stage}.${key}`);
		}
		for (const key of ["afterSeconds", "afterTurns"] as const) {
			const setting = values[key];
			if (setting === undefined) continue;
			if (
				typeof setting !== "number" ||
				!Number.isFinite(setting) ||
				setting <= 0 ||
				(key === "afterTurns" && !Number.isInteger(setting))
			)
				throw new Error(
					`pressure.${stage}.${key} must be a positive ${key === "afterTurns" ? "integer" : "finite number"}`,
				);
			policy[stage][key] = setting;
		}
	}
	return policy;
}

/** Check raw pressure fields before Pi normalizes optional nulls or coerces scalar values. */
export function validatePressureInput(value: unknown): void {
	readPressure(value);
}

export function resolvePressure(value: unknown = undefined): PressurePolicy {
	const policy = readPressure(value);
	for (const key of ["afterSeconds", "afterTurns"] as const) {
		if (policy.urgent[key] <= policy.warning[key])
			throw new Error(
				`pressure.urgent.${key} must exceed pressure.warning.${key} after applying defaults`,
			);
	}
	return policy;
}

export interface PressureClock {
	/** Monotonic seconds. */
	now(): number;
	/** Returns an idempotent cancellation function. */
	schedule(callback: () => void, delayMs: number): () => void;
}
const monotonicClock: PressureClock = {
	now: () => performance.now() / 1000,
	schedule: (callback, delayMs) => {
		const timer = setTimeout(callback, delayMs);
		return () => clearTimeout(timer);
	},
};
const instructions = {
	warning:
		"Prioritize the core goal, stop expanding the task scope, and prepare your final report.",
	urgent:
		"Promptly end exploration and finish your final report using current findings and results. Clearly disclose unfinished work and blockers; do not keep working merely for completeness.",
};

/** Owns one task's clock, completed-turn count and once-per-stage steering submissions. */
export class TaskPressure {
	readonly failure: Promise<never>;
	private rejectFailure!: (error: Error) => void;
	private startedAt?: number;
	private turns = 0;
	private issued = { warning: false, urgent: false };
	private cancelTimer?: () => void;
	private disposed = false;
	private tail: Promise<unknown> = Promise.resolve();

	constructor(
		private policy: PressurePolicy,
		private steer: (message: string) => Promise<unknown>,
		private clock: PressureClock = monotonicClock,
	) {
		this.failure = new Promise<never>((_resolve, reject) => {
			this.rejectFailure = reject;
		});
		// A fast control failure can precede the runner awaiting settlement.
		void this.failure.catch(() => {});
	}

	observe = (record: Record<string, unknown>): void => {
		if (this.disposed) return;
		if (record.type === "agent_settled" || record.type === "rpc_failure") {
			this.dispose();
			return;
		}
		if (record.type === "agent_start" && this.startedAt === undefined)
			this.startedAt = this.clock.now();
		if (this.startedAt === undefined) return;
		if (record.type === "turn_end") this.turns++;
		if (record.type === "agent_start" || record.type === "turn_end")
			this.evaluate();
	};

	dispose = (): void => {
		this.disposed = true;
		this.cancelTimer?.();
		this.cancelTimer = undefined;
	};

	private evaluate = (): void => {
		this.cancelTimer?.();
		this.cancelTimer = undefined;
		if (this.disposed || this.startedAt === undefined) return;
		const elapsed = Math.max(0, this.clock.now() - this.startedAt);
		let nextSeconds = Number.POSITIVE_INFINITY;
		for (const stage of ["warning", "urgent"] as const) {
			if (this.issued[stage]) continue;
			const threshold = this.policy[stage];
			if (
				elapsed >= threshold.afterSeconds ||
				this.turns >= threshold.afterTurns
			) {
				// Reserve before asynchronous RPC work: timer/turn overlap must not double-submit.
				this.issued[stage] = true;
				const message = `[pi-delegate pressure: ${stage}] ${instructions[stage]}`;
				this.tail = this.tail
					.then(() => {
						if (!this.disposed) return this.steer(message);
					})
					.catch((error: unknown) => {
						if (this.disposed) return;
						this.dispose();
						this.rejectFailure(
							new Error(
								`Subagent pressure delivery failed: ${error instanceof Error ? error.message : String(error)}`,
							),
						);
					});
			} else {
				nextSeconds = Math.min(nextSeconds, threshold.afterSeconds - elapsed);
			}
		}
		if (Number.isFinite(nextSeconds)) {
			// Cap each wait, not the budget: JS timers overflow beyond ~24.8 days.
			const delayMs = Math.max(
				1,
				Math.ceil(Math.min(nextSeconds, 2_147_483.647) * 1000),
			);
			this.cancelTimer = this.clock.schedule(this.evaluate, delayMs);
		}
	};
}
