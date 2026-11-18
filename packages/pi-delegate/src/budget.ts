import { Type } from "typebox";
import { type Clock as PressureClock, taskClock } from "./clock.ts";

export interface ExecutionBudget {
	maxSeconds?: number;
	maxTurns?: number;
}
export type BudgetStop = {
	cause: "budget";
} & (
	| { dimension: "seconds"; limit: number; observed: number }
	| { dimension: "turns"; limit: number; observed: number }
);

export const budgetParameters = Type.Object(
	{
		maxSeconds: Type.Optional(
			Type.Number({
				exclusiveMinimum: 0,
				description:
					"Maximum original-task running seconds (positive, finite; fractions allowed). Queue/init excluded; provider/tool waits included.",
			}),
		),
		maxTurns: Type.Optional(
			Type.Integer({
				minimum: 1,
				description:
					"Maximum completed assistant-plus-tools turns (positive integer).",
			}),
		),
	},
	{
		additionalProperties: false,
		description:
			"Opt-in execution budget, disclosed to the child upfront. Omitted dimensions are unlimited; no default limits. Either observed threshold cancels without extra model wrap-up. Independent of advisory pressure; output/usage may be partial and effects are not rolled back.",
	},
);

/** Validate before host coercion and capture a fresh invocation-local policy. */
export function resolveBudget(value: unknown): ExecutionBudget | undefined {
	if (value === undefined) return undefined;
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new Error("budget must be an object");
	const input = value as Record<string, unknown>;
	const budget: ExecutionBudget = {};
	for (const key of Object.keys(input)) {
		if (key !== "maxSeconds" && key !== "maxTurns")
			throw new Error(`Unknown budget setting: budget.${key}`);
		const limit = input[key];
		if (limit === undefined) continue;
		if (
			typeof limit !== "number" ||
			!Number.isFinite(limit) ||
			limit <= 0 ||
			(key === "maxTurns" && !Number.isInteger(limit))
		)
			throw new Error(
				`budget.${key} must be a positive ${key === "maxTurns" ? "integer" : "finite number"}`,
			);
		budget[key] = limit;
	}
	return Object.keys(budget).length ? budget : undefined;
}

export function budgetInstructions(budget: ExecutionBudget): string {
	return `Execution budget (not advisory pressure):
Maximum running time: ${budget.maxSeconds === undefined ? "unlimited" : `${budget.maxSeconds} seconds`}.
Maximum completed turns: ${budget.maxTurns === undefined ? "unlimited" : `${budget.maxTurns} turns`}.
Running time starts at the observed original-task agent_start; queueing and child initialization are excluded. Provider requests, tools and waits during the task are included. A turn is a completed assistant response with its associated tools/results; streaming or unfinished tools do not count, and parallel/nested tools are not separate turns.
Either observed enabled limit triggers cancellation with no additional model reporting allowance. Advisory pressure is independent and cannot extend this budget; reminders beyond a limit may never arrive. Observation and cleanup are not instantaneous, and effects are not rolled back.
Prioritize the core goal, avoid unnecessary scope expansion, and prepare an honest report of completed/unfinished work and blockers within the allowance. Completion is not guaranteed. Preserve the task's output-format requirements (including JSON-only); this information requires no extra final sections and grants no additional permissions or workspace authority.`;
}

/** Observation only; the shared runner owns cancellation and cleanup. */
export class TaskBudget {
	private startedAt?: number;
	private turns = 0;
	private disposed = false;
	private cancelTimer?: () => void;
	constructor(
		private readonly budget: ExecutionBudget,
		private readonly stop: (cause: BudgetStop) => void,
		private readonly clock: PressureClock = taskClock,
	) {}
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
		const { maxSeconds, maxTurns } = this.budget;
		const cause: BudgetStop | undefined =
			maxSeconds !== undefined && elapsed >= maxSeconds
				? {
						cause: "budget",
						dimension: "seconds",
						limit: maxSeconds,
						observed: elapsed,
					}
				: maxTurns !== undefined && this.turns >= maxTurns
					? {
							cause: "budget",
							dimension: "turns",
							limit: maxTurns,
							observed: this.turns,
						}
					: undefined;
		if (cause) {
			this.dispose(); // Reserve before cancellation: timer/turn overlap stops once.
			this.stop(cause);
		} else if (maxSeconds !== undefined) {
			const delay = Math.max(
				1,
				Math.ceil(Math.min(maxSeconds - elapsed, 2_147_483.647) * 1000),
			);
			this.cancelTimer = this.clock.schedule(this.evaluate, delay);
		}
	};
}
