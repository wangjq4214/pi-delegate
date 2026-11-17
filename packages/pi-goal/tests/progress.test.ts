import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { DelegateExecutionProgress } from "@wangjq4214/pi-delegate/api";
import {
	GoalController,
	type GoalExecutor,
	type GoalProgress,
} from "../src/controller.ts";
import { GoalCreation } from "../src/creation.ts";
import { GoalProgressView, renderGoalProgress } from "../src/progress-view.ts";
import { GoalStore } from "../src/store.ts";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Missing required test observation");
	return value;
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
const completed = {
	content: [{ type: "text", text: "Inspected actual evidence.\n<approved/>" }],
	details: { status: "completed" as const, taskId: "actual-subagent-exact-id" },
	usage: { input: 4, output: 5 },
};
async function fixture(execute: GoalExecutor, allowance = 8) {
	const root = await mkdtemp(join(tmpdir(), "pi-goal-progress-"));
	cleanups.push(() => rm(root, { recursive: true, force: true }));
	const cwd = join(root, "project");
	await mkdir(cwd);
	const store = new GoalStore(join(root, "goals"));
	const controller = new GoalController(store, execute);
	cleanups.push(() => controller.pause("test cleanup"));
	await controller.create({
		cwd,
		objective: "Verify 中文界面 👩‍💻 é",
		criteria: ["Evidence matches"],
		allowance,
	});
	await controller.plan(
		[
			{
				id: "item",
				title: "Logical work item",
				acceptance: "Evidence matches",
			},
		],
		"Bounded plan",
	);
	return { controller, store, cwd };
}
const work = { itemId: "item", task: "One bounded task" };
function heldExecutor() {
	const entered = deferred<{
		observe: (value: DelegateExecutionProgress) => void;
		signal: AbortSignal;
	}>();
	const finish = deferred<typeof completed>();
	let calls = 0;
	const execute: GoalExecutor = (_input, signal, observe) => {
		calls++;
		entered.resolve({ observe, signal });
		return finish.promise;
	};
	return { entered, finish, execute, calls: () => calls };
}
function uiFixture(controller: GoalController) {
	let component:
		| { render(width: number): string[]; invalidate(): void }
		| undefined;
	let redraws = 0;
	let color = "31";
	const keys: string[] = [];
	const ui = {
		get theme() {
			return {
				fg: (_color: string, value: string) => `\x1b[${color}m${value}\x1b[0m`,
			} as Theme;
		},
		setWidget(
			key: string,
			factory?: (tui: unknown, theme: Theme) => typeof component,
		) {
			keys.push(key);
			component = factory?.(
				{
					requestRender() {
						redraws++;
					},
				},
				ui.theme,
			);
		},
	} as unknown as ExtensionContext["ui"];
	const view = new GoalProgressView(controller, () => undefined);
	view.bind({ mode: "tui", ui });
	return {
		view,
		ui,
		component: () => component,
		redraws: () => redraws,
		keys,
		theme: () => {
			color = "32";
		},
	};
}

test("pending synchronous worker correlates item/attempt/accepted task immediately without acceptance or redraw charges", async () => {
	const held = heldExecutor();
	const { controller, store } = await fixture(held.execute);
	const snapshots: GoalProgress[] = [];
	controller.subscribe(() => {
		snapshots.push(controller.progress());
	});
	controller.subscribe(() => {
		throw new Error("broken view");
	});
	controller.subscribe(async () => {
		throw new Error("broken async view");
	});
	const running = controller.work(work);
	const { observe } = await held.entered.promise;
	expect(controller.progress().dispatch).toMatchObject({
		kind: "worker",
		itemId: "item",
		itemTitle: "Logical work item",
		settled: false,
	});
	expect(controller.progress().dispatch?.task).toBeUndefined();
	expect(
		renderGoalProgress(controller.progress(), undefined, 160).join("\n"),
	).toContain("waiting for delegate acceptance");
	for (const phase of [
		"queued",
		"initializing",
		"running",
		"cleanup",
	] as const) {
		observe({ taskId: completed.details.taskId, phase, cancelling: false });
		expect(controller.progress().dispatch?.task).toEqual({
			taskId: completed.details.taskId,
			phase,
			cancelling: false,
		});
	}
	const revision = controller.status()?.revision;
	for (let i = 0; i < 20; i++)
		renderGoalProgress(controller.progress(), undefined, 32);
	expect(controller.status()?.revision).toBe(revision);
	expect(controller.status()?.run?.used).toBe(1);
	expect(controller.status()?.items[0]?.status).toBe("pending");
	expect(
		(await store.load(required(controller.status()).id)).attempts[0]?.taskId,
	).toBeUndefined(); // identity projection is ephemeral
	held.finish.resolve(completed);
	await running;
	observe({ taskId: "late-spoof", phase: "running", cancelling: false });
	expect(controller.progress().dispatch).toBeUndefined();
	expect(controller.status()?.items[0]?.status).toBe("pending");
	expect(controller.status()?.attempts[0]?.taskId).toBe(
		completed.details.taskId,
	);
	expect(controller.status()?.attempts[0]?.usage).toEqual(completed.usage);
	expect(snapshots.some((p) => p.dispatch?.task?.phase === "running")).toBe(
		true,
	);
	expect(held.calls()).toBe(1);
});

test("pause shows cleanup until settlement; old callbacks cannot revive activity, authority or new recovery", async () => {
	const held = heldExecutor();
	const { controller, cwd } = await fixture(held.execute);
	const running = controller.work(work);
	const { observe, signal } = await held.entered.promise;
	observe({
		taskId: completed.details.taskId,
		phase: "running",
		cancelling: false,
	});
	let settled = false;
	const pause = controller.pause("User blocker").then(() => {
		settled = true;
	});
	expect(signal.aborted).toBe(true);
	expect(controller.active).toBe(false);
	expect(controller.progress().stopping).toBe(true);
	expect(
		renderGoalProgress(controller.progress(), undefined, 160).join("\n"),
	).toContain("waiting for owned cleanup");
	expect(
		renderGoalProgress(controller.progress(), undefined, 160).join("\n"),
	).toContain("User blocker");
	observe({ taskId: "late-old-scope", phase: "running", cancelling: false });
	expect(controller.progress().dispatch?.task?.taskId).toBe(
		completed.details.taskId,
	);
	await Promise.resolve();
	expect(settled).toBe(false);
	held.finish.resolve(completed);
	await Promise.all([running, pause]);
	expect(controller.progress()).toMatchObject({
		stopping: false,
		runtimeActive: false,
		dispatch: undefined,
	});
	expect(controller.status()?.status).toBe("paused");
	const id = required(controller.status()).id;
	await controller.resume(id, 5, cwd);
	observe({ taskId: "late-previous-run", phase: "running", cancelling: false });
	expect(controller.progress().dispatch).toBeUndefined();
	expect(controller.needsReinspection).toBe(true);
	expect(
		renderGoalProgress(controller.progress(), undefined, 160).join("\n"),
	).toContain("reinspection required");
	expect(held.calls()).toBe(1);
});

test("independent review has distinct in-flight identity; disposal does not cancel or accept and old view stays empty", async () => {
	const held = heldExecutor();
	const { controller } = await fixture(held.execute);
	await controller.accept("item", ["Verified actual outputs"], []);
	const ui = uiFixture(controller);
	const oldComponent = required(ui.component());
	const running = controller.review();
	const { observe, signal } = await held.entered.promise;
	observe({
		taskId: completed.details.taskId,
		phase: "running",
		cancelling: false,
	});
	expect(oldComponent.render(160).join("\n")).toContain(
		"Independent review · running",
	);
	expect(ui.redraws()).toBeGreaterThan(0);
	expect(controller.status()?.status).toBe("active");
	ui.view.dispose();
	const redraws = ui.redraws();
	observe({
		taskId: completed.details.taskId,
		phase: "cleanup",
		cancelling: false,
	});
	expect(oldComponent.render(160)).toEqual([]);
	expect(ui.component()).toBeUndefined();
	expect(ui.redraws()).toBe(redraws);
	expect(signal.aborted).toBe(false);
	expect(controller.active).toBe(true);
	expect(new Set(ui.keys)).toEqual(new Set(["pi-goal:progress"]));
	held.finish.resolve(completed);
	await running;
	expect(controller.status()?.status).toBe("complete");
	expect(ui.component()).toBeUndefined();
	expect(oldComponent.render(160)).toEqual([]);
});

test("pre-acceptance failure invents no ID or executing child; non-TUI mounting is unnecessary", async () => {
	const { controller } = await fixture(async () => ({
		content: [],
		details: { status: "failed", error: "Admission unavailable" },
	}));
	const view = new GoalProgressView(controller, () => undefined);
	view.bind({
		mode: "rpc",
		ui: new Proxy(
			{},
			{
				get() {
					throw new Error("No UI in this test");
				},
			},
		) as ExtensionContext["ui"],
	});
	await controller.work(work);
	expect(controller.status()?.attempts[0]?.taskId).toBeUndefined();
	const output = renderGoalProgress(controller.progress(), undefined, 160).join(
		"\n",
	);
	expect(output).toContain("Admission unavailable");
	expect(output).toContain("no current child");
	expect(output).not.toContain("Subagent:");
	view.dispose();
});

test("rendering is display-width safe, hides compact UUIDs, stays theme-current and text-only", async () => {
	const { controller } = await fixture(async () => completed);
	const base = controller.progress();
	required(base.state).objective =
		"中文 👩‍💻 é\n\x1b]52;c;clipboard\x07\x1b[31m untrusted";
	base.dispatch = {
		attemptId: "attempt",
		kind: "worker",
		itemId: "item",
		itemTitle: "\x1b[2J title",
		settled: false,
		task: {
			taskId: completed.details.taskId,
			phase: "queued",
			cancelling: false,
		},
	};
	for (const width of [1, 2, 5, 12, 32, 80, 160]) {
		const lines = renderGoalProgress(base, undefined, width);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			expect(
				Array.from(stripVTControlCharacters(line)).some((character) => {
					const point = character.codePointAt(0) ?? 0;
					return point < 32 || (point >= 127 && point <= 159);
				}),
			).toBe(false);
			expect(line).not.toContain("\x1b]");
			expect(line).not.toContain("\x1b[2J");
		}
		expect(lines.join("")).not.toContain(completed.details.taskId);
	}
	const output = renderGoalProgress(base, undefined, 200).join("\n");
	expect(output).toContain("\\u001b");
	expect(output).toContain("queued; child not started");
	const ui = uiFixture(controller);
	expect(required(ui.component()).render(80).join("")).toContain("\x1b[31m");
	ui.theme();
	required(ui.component()).invalidate();
	expect(required(ui.component()).render(80).join("")).toContain("\x1b[32m");
	ui.view.dispose();
});

test("empty, draft, saved-active, unknown and rejected/stale review states never claim live execution or approval", async () => {
	const empty: GoalProgress = {
		runtimeActive: false,
		reinspectionRequired: false,
		stopping: false,
	};
	expect(renderGoalProgress(empty, undefined, 100).join("\n")).toContain(
		"no current goal or draft",
	);
	const creation = new GoalCreation();
	creation.begin("Discuss only", "/project");
	expect(
		renderGoalProgress(empty, creation.status(), 100).join("\n"),
	).toContain("Not authorized");
	const { controller } = await fixture(async () => completed);
	const saved = controller.progress();
	saved.runtimeActive = false;
	required(saved.state).attempts.push({
		id: "old",
		kind: "worker",
		taskId: "remembered-not-live",
		status: "running",
		summary: "",
	});
	let output = renderGoalProgress(saved, undefined, 160).join("\n");
	expect(output).toContain("no running child");
	expect(output).not.toContain("remembered-not-live");
	for (const approved of [false, true]) {
		required(saved.state).review = {
			attemptId: "old-review",
			workRevision: required(saved.state).workRevision - 1,
			approved,
			summary: "Stale",
		};
		output = renderGoalProgress(saved, undefined, 160).join("\n");
		expect(output).toContain("stale; unfinished");
		expect(output).not.toContain("Complete ·");
	}
});
