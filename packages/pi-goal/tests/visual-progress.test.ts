import { describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { GoalController, GoalProgress } from "../src/controller.ts";
import { formatCurrentGoal } from "../src/presentation.ts";
import { GoalProgressView, renderGoalProgress } from "../src/progress-view.ts";

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Missing required test observation");
	return value;
}
function progress(): GoalProgress {
	return {
		runtimeActive: true,
		reinspectionRequired: false,
		stopping: false,
		state: {
			id: "goal-visual",
			cwd: "/project",
			objective:
				"Pane workspace. Follow /project/.grimoire/spec/example.md and run all checks.",
			criteria: ["Commands are safe"],
			status: "active",
			revision: 3,
			workRevision: 1,
			items: [
				{
					id: "T0004",
					title: "Pane commands",
					acceptance: "Verified",
					status: "pending",
					evidence: [],
					artifacts: [],
				},
			],
			attempts: [],
			checkpoint: "Inspect actual evidence",
			run: { id: "run", allowance: 18, used: 2 },
		},
		dispatch: {
			attemptId: "attempt",
			kind: "worker",
			itemId: "T0004",
			itemTitle: "Pane commands",
			settled: false,
			task: {
				taskId: "5c3f2e82-632c-4d92-885c-f3aff15c67fe",
				phase: "running",
				cancelling: false,
			},
		},
	};
}

function text(value: GoalProgress, width = 100, frame = 0) {
	return renderGoalProgress(value, undefined, width, undefined, frame);
}
function details(value: GoalProgress) {
	return formatCurrentGoal({ ...value, activity: value.dispatch });
}

// The fake scheduler keeps cancelled callbacks to exercise a late queued tick.
function mounted(realClock = false) {
	const value = progress();
	let listener = () => {};
	let component:
		| { render(width: number): string[]; invalidate(): void }
		| undefined;
	let redraws = 0;
	let snapshots = 0;
	const ticks: { fire: () => void; cancelled: boolean }[] = [];
	const controller = {
		status: () => value.state,
		progress: () => {
			snapshots++;
			return structuredClone(value);
		},
		subscribe: (next: () => void) => {
			listener = next;
			return () => {
				listener = () => {};
			};
		},
	} as GoalController;
	let color = "36";
	const ui = {
		get theme() {
			return {
				fg: (_key: ThemeColor, body: string) => `\x1b[${color}m${body}\x1b[0m`,
			} as Theme;
		},
		setWidget(_key: string, factory?: (tui: unknown) => typeof component) {
			component = factory?.({
				requestRender: () => {
					redraws++;
				},
			});
		},
	};
	const view = new GoalProgressView(
		controller,
		() => undefined,
		realClock
			? undefined
			: (fire) => {
					const tick = { fire, cancelled: false };
					ticks.push(tick);
					return () => {
						tick.cancelled = true;
					};
				},
	);
	view.bind({ mode: "tui", ui } as Parameters<GoalProgressView["bind"]>[0]);
	return {
		value,
		view,
		ui,
		ticks,
		change: () => listener(),
		render: () => component?.render(100) ?? [],
		component: () => component,
		redraws: () => redraws,
		snapshots: () => snapshots,
		theme: () => {
			color = "35";
		},
	};
}

describe("compact goal visuals", () => {
	test("title shortening preserves dotted paths and versions rather than splitting inside them", () => {
		const value = progress();
		required(value.state).objective =
			"Fix src/parser.ts for v1.2. Run regression tests.";
		expect(text(value)[0]).toContain("Fix src/parser.ts for v1.2");
		expect(text(value)[0]).not.toContain("Run regression");
	});
	test("ordinary worker uses three rows, a short title and detail-only UUID without mutating state", () => {
		const value = progress();
		const before = structuredClone(value);
		const rows = text(value);
		expect(rows).toHaveLength(3);
		expect(rows[0]).toContain("Pane workspace");
		expect(rows[0]).toContain("0/1 accepted");
		expect(rows[0]).not.toContain("/project/");
		expect(rows[1]).toContain("T0004 · Pane commands");
		expect(rows[2]).toContain("16/18 dispatches left");
		expect(rows.join("\n")).not.toContain(
			value.dispatch?.task?.taskId ?? "missing",
		);
		expect(rows.join("\n")).not.toContain("not yet assessed");
		expect(details(value)).toContain(value.state?.objective ?? "missing");
		expect(details(value)).toContain(
			`Subagent: ${value.dispatch?.task?.taskId}`,
		);
		expect(details(value)).toContain("Worker · running");
		expect(value).toEqual(before);
	});

	test("frames only move the observed running activity indicator, including independent review", () => {
		for (const kind of ["worker", "reviewer"] as const) {
			const value = progress();
			if (!value.dispatch) throw new Error("Missing test dispatch");
			value.dispatch.kind = kind;
			const first = text(value, 100, 0);
			const next = text(value, 100, 1);
			expect(next[0]).toBe(first[0]);
			expect(next[2]).toBe(first[2]);
			expect(next[1]).not.toBe(first[1]);
			expect(next[1]?.slice(1)).toBe(first[1]?.slice(1));
			expect(first[1]).toContain(
				kind === "worker" ? "Worker · running" : "Independent review · running",
			);
		}
	});

	test("queued, initializing, unknown, ended and inactive observations do not animate or resurrect a saved child", () => {
		const value = progress();
		if (!value.dispatch?.task) throw new Error("Missing test task");
		for (const phase of [
			"queued",
			"initializing",
			"cleanup",
			"completed",
			"failed",
		] as const) {
			value.dispatch.task.phase = phase;
			expect(text(value, 100, 0)).toEqual(text(value, 100, 4));
		}
		delete value.dispatch.task;
		expect(text(value, 100, 0)).toEqual(text(value, 100, 4));
		expect(details(value)).toContain("Subagent: unavailable");
		value.dispatch.task = progress().dispatch?.task;
		value.runtimeActive = false;
		expect(text(value, 100, 0)).toEqual(text(value, 100, 4));
		expect(details(value)).not.toContain("5c3f2e82");
	});

	test("narrow, Unicode and untrusted text remain width-safe and details preserve exact identity", () => {
		const value = progress();
		if (!value.state || !value.dispatch) throw new Error("Missing test state");
		value.state.objective = "中文 👩‍💻 é\n\x1b]52;c;clipboard\x07";
		value.dispatch.itemTitle = "\x1b[2J 中文 👩‍💻";
		for (const width of [1, 2, 5, 12, 32, 80, 160]) {
			for (const line of text(value, width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				expect(
					Array.from(stripVTControlCharacters(line)).some((character) => {
						const point = character.codePointAt(0) ?? 0;
						return point < 32 || (point >= 127 && point <= 159);
					}),
				).toBe(false);
				expect(line).not.toContain("\x1b]");
				expect(line).not.toContain("\x1b[2J");
				expect(line).not.toContain("\n");
			}
		}
		expect(details(value)).toContain("5c3f2e82-632c-4d92-885c-f3aff15c67fe");
		expect(details(value)).toContain("\\u001b");
	});

	test("theme colors are localized; only actual reviewed completion uses success treatment", () => {
		const value = progress();
		const colored = (p: GoalProgress) =>
			renderGoalProgress(p, undefined, 100, {
				fg: (key, body) => `<${key}>${body}</${key}>`,
			}).join("\n");
		const output = colored(value);
		expect(output).toContain("<accent>◆ Goal</accent>");
		expect(output).toContain("<syntaxVariable>");
		expect(output).not.toContain("<syntaxVariable>Pane commands");
		if (!value.state) throw new Error("Missing test state");
		required(value.state.items[0]).status = "accepted";
		delete value.dispatch;
		expect(colored(value)).not.toContain("<success>");
		value.runtimeActive = false;
		value.state.status = "paused";
		expect(colored(value)).toContain("<warning>");
		value.state.attempts.push({
			id: "failed",
			kind: "worker",
			status: "failed",
			summary: "Provider failed",
		});
		expect(colored(value)).toContain("<error>");
		value.state.status = "complete";
		value.state.review = {
			attemptId: "review",
			workRevision: 1,
			approved: true,
			summary: "Actual evidence matches",
		};
		expect(colored(value)).toContain("<success>");
		value.state.review.workRevision = 0;
		expect(colored(value)).not.toContain("<success>");
	});

	test("exceptions remain visible outside the ordinary three rows", () => {
		const value = progress();
		if (!value.state) throw new Error("Missing test state");
		value.runtimeActive = false;
		value.stopping = true;
		value.stopReason = "Allowance exhausted";
		value.reinspectionRequired = true;
		value.state.review = {
			attemptId: "review",
			workRevision: 0,
			approved: true,
			summary: "Old evidence",
		};
		const output = text(value).join("\n");
		for (const expected of [
			"waiting for owned cleanup",
			"Allowance exhausted",
			"reinspection required",
			"stale; unfinished",
		])
			expect(output).toContain(expected);
		expect(text(value, 100, 0)).toEqual(text(value, 100, 1));
	});
});

describe("goal animation lifetime", () => {
	test("the real animation clock redraws without observations and stops on non-TUI rebinding", async () => {
		const h = mounted(true);
		try {
			const redraws = h.redraws();
			const snapshots = h.snapshots();
			await Bun.sleep(160);
			expect(h.redraws()).toBeGreaterThan(redraws);
			expect(h.snapshots()).toBe(snapshots);
			const oldComponent = h.component();
			h.view.bind({ mode: "rpc", ui: h.ui } as Parameters<
				GoalProgressView["bind"]
			>[0]);
			const stopped = h.redraws();
			await Bun.sleep(160);
			expect(h.redraws()).toBe(stopped);
			expect(oldComponent?.render(100)).toEqual([]);
		} finally {
			h.view.dispose();
		}
	});
	test("ticks redraw without cloning state, charging or dispatching; state changes stop animation immediately", () => {
		const h = mounted();
		try {
			expect(h.ticks).toHaveLength(1);
			const before = structuredClone(h.value);
			const first = h.render();
			const snapshots = h.snapshots();
			const redraws = h.redraws();
			required(h.ticks[0]).fire();
			expect(h.redraws()).toBe(redraws + 1);
			expect(h.render()[1]).not.toBe(first[1]);
			expect(h.snapshots()).toBe(snapshots);
			expect(h.value).toEqual(before);
			h.value.runtimeActive = false;
			h.change();
			expect(h.ticks[0]?.cancelled).toBe(true);
			const stopped = h.render();
			const after = h.redraws();
			required(h.ticks[0]).fire();
			expect(h.redraws()).toBe(after);
			expect(h.render()).toEqual(stopped);
		} finally {
			h.view.dispose();
		}
	});

	test("queued work stays static, reactivation has one timer, and cancelled ticks cannot affect replacement scopes", () => {
		const h = mounted();
		try {
			const old = h.ticks[0];
			if (!h.value.dispatch?.task) throw new Error("Missing test task");
			h.value.dispatch.task.phase = "queued";
			h.change();
			expect(old?.cancelled).toBe(true);
			h.value.dispatch.task.phase = "running";
			h.change();
			h.change();
			expect(h.ticks).toHaveLength(2);
			const redraws = h.redraws();
			old?.fire();
			expect(h.redraws()).toBe(redraws);
			const component = h.component();
			h.view.dispose();
			h.view.bind({ mode: "tui", ui: h.ui } as Parameters<
				GoalProgressView["bind"]
			>[0]);
			const fresh = h.redraws();
			required(h.ticks[1]).fire();
			expect(h.redraws()).toBe(fresh);
			expect(component?.render(100)).toEqual([]);
			expect(h.ticks[1]?.cancelled).toBe(true);
			h.theme();
			expect(h.render().join("")).toContain("\x1b[35m");
		} finally {
			h.view.dispose();
		}
	});
});
