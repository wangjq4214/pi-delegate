import { expect, spyOn, test } from "bun:test";
import {
	createEventBus,
	type ExtensionAPI,
	type ExtensionContext,
	type ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import {
	type DelegateExecutionProgress,
	getDelegateClient,
	isDelegatedChild,
	registerParentOnlyTools,
} from "../src/api.ts";
import { registerChild } from "../src/child.ts";
import { registerDelegate } from "../src/delegate.ts";
import { type DelegationOptions, failedResult } from "../src/delegation.ts";
import { captureInheritance } from "../src/inheritance.ts";
import { AgentStatus } from "../src/status.ts";
import { sumUsage } from "../src/usage.ts";
import { configurationContext } from "./fixtures/configuration-context.ts";

function fixture(run?: Parameters<typeof registerDelegate>[1]) {
	const events = createEventBus();
	const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
	const hooks = new Map<string, ((...args: unknown[]) => unknown)[]>();
	let registrations = 0;
	const pi = {
		events,
		registerTool(tool: Parameters<ExtensionAPI["registerTool"]>[0]) {
			registrations++;
			tools.set(tool.name, tool);
		},
		on(name: string, hook: (...args: unknown[]) => unknown) {
			hooks.set(name, [...(hooks.get(name) ?? []), hook]);
			return () => {};
		},
		getAllTools: () => [],
		getActiveTools: () => [],
		getCommands: () => [],
	} as unknown as ExtensionAPI;
	const ctx = {
		...configurationContext,
		cwd: process.cwd(),
		mode: "rpc",
		hasUI: false,
		isProjectTrusted: () => false,
	} as ExtensionContext;
	const emit = async (name: string, event: unknown = {}) => {
		for (const hook of hooks.get(name) ?? []) await hook(event, ctx);
	};
	const tool = (name: string, input: Record<string, unknown>) => {
		const t = tools.get(name);
		if (!t) throw new Error(`Missing ${name}`);
		return t.execute(
			"fixture",
			input,
			undefined,
			undefined,
			ctx as ExtensionToolContext,
		);
	};
	if (run) registerDelegate(pi, run);
	return { pi, ctx, emit, tool, tools, registrations: () => registrations };
}

const completed = () => ({
	content: [{ type: "text" as const, text: "report" }] as [
		{ type: "text"; text: string },
	],
	details: { status: "completed" as const },
	usage: { ...sumUsage([]), input: 2, output: 1, totalTokens: 3 },
	isError: false,
});

test("discovery is synchronous, explicit, bus-local and rejects incompatible/duplicate owners", () => {
	const h = fixture();
	expect(() => getDelegateClient(h.pi)).toThrow("Missing pi-delegate runtime");
	expect(h.registrations()).toBe(0);
	const off = h.pi.events.on("@wangjq4214/pi-delegate:discover", (request) => {
		(request as { reply(value: unknown): void }).reply({ version: 2 });
	});
	expect(() => getDelegateClient(h.pi)).toThrow("Incompatible");
	expect(() => registerDelegate(h.pi)).toThrow("Incompatible");
	expect(h.registrations()).toBe(0);
	off();
	registerDelegate(h.pi, async () => completed());
	expect(getDelegateClient(h.pi).version).toBe(1);
	expect(() => getDelegateClient(fixture().pi)).toThrow("Missing");
	const duplicate = h.pi.events.on(
		"@wangjq4214/pi-delegate:discover",
		(request) => {
			(request as { reply(value: unknown): void }).reply({ version: 1 });
		},
	);
	expect(() => getDelegateClient(h.pi)).toThrow("Incompatible");
	duplicate();
});

test("API and tools share registrations, records, admission and one usage contribution per task", async () => {
	let calls = 0;
	const total = spyOn(AgentStatus.prototype, "total");
	const h = fixture(async (options) => {
		calls++;
		options.onUsage?.(completed().usage);
		options.onUsage?.(completed().usage);
		return completed();
	});
	try {
		const client = getDelegateClient(h.pi);
		registerDelegate({ ...h.pi } as ExtensionAPI, async () => {
			throw new Error("duplicate runner");
		});
		expect(h.registrations()).toBe(6);
		const api = await client.execute(
			{
				task: "goal-like work",
				title: "goal worker",
				context: "explicit",
				budget: { maxTurns: 2 },
			},
			h.ctx,
		);
		const ordinary = await h.tool("delegate", { task: "ordinary work" });
		expect(calls).toBe(2);
		expect(api.details.status).toBe("completed");
		expect(typeof api.details.taskId).toBe("string");
		expect((await h.tool("delegate_list", {})).details).toEqual(
			client.list().details,
		);
		expect(JSON.stringify(client.list().details)).toContain("goal worker");
		expect(client.status(api.details.taskId ?? "").details).toEqual(
			(await h.tool("delegate_status", { taskId: api.details.taskId })).details,
		);
		expect(JSON.stringify(client.list().details)).toContain(
			(ordinary.details as { taskId: string }).taskId,
		);
		expect(total.mock.calls.at(-1)?.[0].totalTokens).toBe(6);
		const waited = await client.wait({ taskIds: [api.details.taskId ?? ""] });
		expect(waited).toMatchObject({ details: { reason: "completed" } });
		expect(JSON.stringify(waited.details)).not.toContain("report");
		expect(total.mock.calls.at(-1)?.[0].totalTokens).toBe(6);
		expect((await client.cancel(api.details.taskId ?? "")).isError).toBe(true);
		expect(
			(
				await client.execute(
					{ task: "no ambiguous ack", background: true },
					h.ctx,
				)
			).details,
		).toMatchObject({
			status: "failed",
			error: expect.stringContaining("synchronous"),
		});
		expect(calls).toBe(2);
	} finally {
		await h.emit("session_shutdown");
		total.mockRestore();
	}
});

for (const stop of [
	"signal",
	"session_before_tree",
	"session_tree",
	"session_shutdown",
]) {
	test(`API cancellation via ${stop} waits for cleanup and does not cancel ordinary background work on caller abort`, async () => {
		let cleaned = false;
		let started!: () => void;
		const ready = new Promise<void>((resolve) => {
			started = resolve;
		});
		const h = fixture(async (options: DelegationOptions) => {
			if (options.task === "ordinary") return completed();
			started();
			await new Promise<void>((resolve) =>
				options.signal?.addEventListener("abort", () => resolve(), {
					once: true,
				}),
			);
			await Promise.resolve();
			cleaned = true;
			return failedResult("cancel", true);
		});
		const client = getDelegateClient(h.pi);
		const controller = new AbortController();
		const operation = client.execute(
			{ task: "owned" },
			h.ctx,
			controller.signal,
		);
		await ready;
		await h.tool("delegate", { task: "ordinary", background: true });
		if (stop === "signal") controller.abort();
		else
			await h.emit(stop, {
				preparation: { targetId: "new", oldLeafId: "old" },
				newLeafId: "new",
				oldLeafId: "old",
			});
		expect((await operation).details.status).toBe("cancelled");
		expect(cleaned).toBe(true);
		if (stop === "session_shutdown") {
			expect(() => getDelegateClient(h.pi)).toThrow("Missing");
			expect(() => client.list()).toThrow("shut down");
			await expect(client.execute({ task: "stale" }, h.ctx)).rejects.toThrow(
				"shut down",
			);
		} else await h.emit("session_shutdown");
	});
}

test("parent-only declarations work before delegate loads, capture exclusion and withdraw", () => {
	const h = fixture();
	const off = registerParentOnlyTools(h.pi, [
		"consumer_direct",
		"consumer_deferred",
	]);
	const capture = () =>
		captureInheritance(
			{
				...h.pi,
				getAllTools: () =>
					["consumer_direct", "consumer_deferred"].map((name) => ({
						name,
						parameters: {},
						exposure: "deferred",
						sourceInfo: { path: "<runtime-only>" },
					})) as ReturnType<ExtensionAPI["getAllTools"]>,
				getActiveTools: () => ["consumer_direct"],
			},
			h.ctx,
			"src/index.ts",
			[],
		);
	const result = capture();
	expect(result.snapshot.tools).toEqual([]);
	expect(result.snapshot.active).toEqual([]);
	expect(result.args[result.args.indexOf("--exclude-tools") + 1]).toContain(
		"consumer_deferred",
	);
	off();
	expect(capture).toThrow("runtime-only");
});

test("child cannot acquire or register the parent service; duplicate child init has one owner", () => {
	const saved = process.env.PI_DELEGATE_CHILD;
	process.env.PI_DELEGATE_CHILD = "1";
	try {
		const h = fixture();
		expect(isDelegatedChild()).toBe(true);
		expect(() => getDelegateClient(h.pi)).toThrow("child");
		expect(() => registerParentOnlyTools(h.pi, ["consumer"])).toThrow("child");
		registerDelegate(h.pi);
		expect(h.registrations()).toBe(0);
		let commands = 0;
		h.pi.registerCommand = () => {
			commands++;
		};
		registerChild(h.pi);
		registerChild({ ...h.pi });
		expect(commands).toBe(1);
	} finally {
		if (saved === undefined) delete process.env.PI_DELEGATE_CHILD;
		else process.env.PI_DELEGATE_CHILD = saved;
	}
});

test("API and ordinary background work share one admission queue and caller cancellation stays scoped", async () => {
	const saved = process.env.PI_DELEGATE_CONCURRENCY;
	process.env.PI_DELEGATE_CONCURRENCY = "1";
	const starts: string[] = [];
	const releases = new Map<string, () => void>();
	const h = fixture(async (options) => {
		starts.push(options.task);
		await new Promise<void>((resolve) => {
			releases.set(options.task, resolve);
			options.signal?.addEventListener("abort", () => resolve(), {
				once: true,
			});
		});
		return options.signal?.aborted ? failedResult("abort", true) : completed();
	});
	try {
		const client = getDelegateClient(h.pi);
		const controller = new AbortController();
		const active = client.execute({ task: "owned" }, h.ctx, controller.signal);
		await Bun.sleep(0);
		const ordinary = await h.tool("delegate", {
			task: "ordinary background",
			background: true,
		});
		const queuedController = new AbortController();
		const queuedProgress: DelegateExecutionProgress[] = [];
		const queued = client.execute(
			{ task: "cancelled before admission" },
			h.ctx,
			queuedController.signal,
			{
				presentation: "consumer",
				onProgress: (value) => queuedProgress.push(value),
			},
		);
		queuedController.abort();
		expect(starts).toEqual(["owned"]);
		expect((await queued).details.status).toBe("cancelled");
		expect(
			queuedProgress.map(({ phase, cancelling }) => ({ phase, cancelling })),
		).toEqual([
			{ phase: "queued", cancelling: false },
			{ phase: "queued", cancelling: true },
			{ phase: "cancelled", cancelling: false },
		]);
		controller.abort();
		expect((await active).details.status).toBe("cancelled");
		await Bun.sleep(0);
		expect(starts).toEqual(["owned", "ordinary background"]);
		releases.get("ordinary background")?.();
		const taskId = (ordinary.details as { taskId: string }).taskId;
		await client.wait({ taskIds: [taskId] });
		expect(client.status(taskId).details).toMatchObject({
			status: "completed",
		});
	} finally {
		for (const release of releases.values()) release();
		await h.emit("session_shutdown");
		if (saved === undefined) delete process.env.PI_DELEGATE_CONCURRENCY;
		else process.env.PI_DELEGATE_CONCURRENCY = saved;
	}
});

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function captureAgents(h: ReturnType<typeof fixture>) {
	const frames: string[] = [];
	let render: ((width: number) => string[]) | undefined;
	h.ctx.mode = "tui";
	h.ctx.ui = {
		setWidget(_key, factory) {
			if (typeof factory !== "function") {
				render = undefined;
				return;
			}
			const component = factory(
				{
					requestRender: () => frames.push(render?.(240).join("\n") ?? ""),
				} as never,
				{ fg: (_color: string, value: string) => value } as never,
			);
			render = (width) => component.render(width);
			frames.push(render(240).join("\n"));
		},
	} as ExtensionContext["ui"];
	return { frames, text: () => render?.(240).join("\n") ?? "" };
}

test("consumer progress observes pending queue/init/run/cleanup and terminal without a row flash or extra charge", async () => {
	const saved = process.env.PI_DELEGATE_CONCURRENCY;
	process.env.PI_DELEGATE_CONCURRENCY = "1";
	const blocker = deferred();
	const initialized = deferred();
	const finish = deferred();
	let owned!: DelegationOptions;
	const totals = spyOn(AgentStatus.prototype, "total");
	const h = fixture(async (options) => {
		if (options.task === "blocker") await blocker.promise;
		else {
			owned = options;
			initialized.resolve();
			await finish.promise;
		}
		return completed();
	});
	const agents = captureAgents(h);
	try {
		await h.emit("session_start");
		const client = getDelegateClient(h.pi);
		expect(client.capabilities?.invocationProgress).toBe(true);
		await h.tool("delegate", {
			task: "blocker",
			title: "same",
			background: true,
		});
		const progress: DelegateExecutionProgress[] = [];
		let settled = false;
		const operation = client
			.execute({ task: "owned", title: "same" }, h.ctx, undefined, {
				presentation: "consumer",
				onProgress: (value) => progress.push(value),
			})
			.then((result) => {
				settled = true;
				return result;
			});
		expect(progress.map((value) => value.phase)).toEqual(["queued"]);
		const taskId = progress[0]?.taskId;
		expect(typeof taskId).toBe("string");
		expect(client.status(taskId ?? "").details).toMatchObject({
			task: { status: "queued", controls: { cancel: false, steer: false } },
		});
		expect(agents.text()).toContain("1/1 active · ◷ 1 queued");
		expect(agents.text()).toContain("#1");
		expect(agents.text()).not.toContain("#2");
		blocker.resolve();
		await initialized.promise;
		expect(progress.at(-1)?.phase).toBe("initializing");
		expect(settled).toBe(false);
		owned.status?.observe({ type: "agent_start" });
		expect(progress.at(-1)?.phase).toBe("running");
		owned.onUsage?.(completed().usage);
		owned.onUsage?.(completed().usage);
		for (let i = 0; i < 3; i++) {
			client.status(taskId ?? "");
			client.list();
		}
		expect(totals.mock.calls.at(-1)?.[0].totalTokens).toBe(6);
		owned.status?.observe({ type: "agent_settled" });
		expect(progress.at(-1)).toEqual({
			taskId,
			phase: "cleanup",
			cancelling: false,
		});
		expect(settled).toBe(false);
		finish.resolve();
		const result = await operation;
		expect(progress.map((value) => value.phase)).toEqual([
			"queued",
			"initializing",
			"running",
			"cleanup",
			"completed",
		]);
		expect(
			progress.every((value) => value.taskId === result.details.taskId),
		).toBe(true);
		expect(totals.mock.calls.at(-1)?.[0].totalTokens).toBe(6);
		expect(client.status(taskId ?? "").content[0]?.text).toContain("report");
		expect(client.list().details).toMatchObject({ total: 2 });
		expect((await client.cancel(taskId ?? "")).isError).toBe(true);
		// Default API and ordinary tools keep rows, even with exactly matching titles.
		finish.resolve();
		await client.execute({ task: "default", title: "same" }, h.ctx);
		await h.tool("delegate", {
			task: "ordinary",
			title: "same",
			background: true,
		});
		const list = client.list().details as { tasks: { taskId: string }[] };
		await client.wait({
			taskIds: list.tasks.map((task) => task.taskId),
			condition: "all",
		});
		expect(agents.text()).toContain("#3");
		expect(agents.text()).toContain("#4");
		expect(agents.frames.every((frame) => !frame.includes("#2"))).toBe(true);
		expect(totals.mock.calls.at(-1)?.[0].totalTokens).toBe(12);
	} finally {
		blocker.resolve();
		finish.resolve();
		await h.emit("session_shutdown");
		totals.mockRestore();
		if (saved === undefined) delete process.env.PI_DELEGATE_CONCURRENCY;
		else process.env.PI_DELEGATE_CONCURRENCY = saved;
	}
});

test("preaccept validation, pre-abort and unsupported background publish no identity or observation", async () => {
	let calls = 0;
	const h = fixture(async () => {
		calls++;
		return completed();
	});
	const client = getDelegateClient(h.pi);
	const progress: DelegateExecutionProgress[] = [];
	try {
		for (const input of [
			{ task: " " },
			{ task: "work", budget: { maxTurns: 0 } },
			{ task: "work", background: true },
			{ task: "work", cwd: "missing-preaccept-directory" },
		]) {
			const result = await client.execute(input, h.ctx, undefined, {
				presentation: "consumer",
				onProgress: (value) => progress.push(value),
			});
			expect(result.details.status).toBe("failed");
			expect(result.details.taskId).toBeUndefined();
		}
		const result = await client.execute(
			{ task: "work" },
			h.ctx,
			AbortSignal.abort(),
			{
				onProgress: (value) => progress.push(value),
			},
		);
		expect(result.details.status).toBe("cancelled");
		expect(result.details.taskId).toBeUndefined();
		expect(progress).toEqual([]);
		expect(client.list().details).toMatchObject({ total: 0 });
		expect(calls).toBe(0);
	} finally {
		await h.emit("session_shutdown");
	}
});

test("signal cancellation is observed without claiming cleanup until observed, and terminal waits for cleanup", async () => {
	const ready = deferred();
	const finish = deferred();
	let owned!: DelegationOptions;
	const h = fixture(async (options) => {
		owned = options;
		options.status?.observe({ type: "agent_start" });
		ready.resolve();
		await finish.promise;
		return failedResult("abort", true);
	});
	const client = getDelegateClient(h.pi);
	const controller = new AbortController();
	const progress: DelegateExecutionProgress[] = [];
	try {
		const operation = client.execute(
			{ task: "owned" },
			h.ctx,
			controller.signal,
			{
				presentation: "consumer",
				onProgress: (value) => progress.push(value),
			},
		);
		await ready.promise;
		controller.abort();
		expect(progress.at(-1)).toMatchObject({
			phase: "running",
			cancelling: true,
		});
		const taskId = progress[0]?.taskId ?? "";
		expect(client.status(taskId).details).toMatchObject({
			task: { cancelling: true },
		});
		owned.status?.observe({ type: "agent_settled" });
		expect(progress.at(-1)).toMatchObject({
			phase: "cleanup",
			cancelling: true,
		});
		finish.resolve();
		expect((await operation).details.status).toBe("cancelled");
		expect(progress.at(-1)).toEqual({
			taskId,
			phase: "cancelled",
			cancelling: false,
		});
		const count = progress.length;
		controller.abort();
		owned.onUsage?.(completed().usage);
		owned.status?.observe({ type: "agent_start" });
		expect(progress).toHaveLength(count);
	} finally {
		finish.resolve();
		await h.emit("session_shutdown");
	}
});

for (const status of [
	"completed",
	"incomplete",
	"failed",
	"cancelled",
] as const) {
	test(`observer throws/rejections and mutated snapshots cannot affect ${status} or default rows`, async () => {
		const h = fixture(async (options) => {
			options.status?.observe({ type: "agent_start" });
			options.onUsage?.(completed().usage);
			if (status === "failed") throw new Error("provider failure");
			return {
				...completed(),
				details: { status },
				isError: status !== "completed",
			};
		});
		const agents = captureAgents(h);
		const progress: DelegateExecutionProgress[] = [];
		try {
			await h.emit("session_start");
			const client = getDelegateClient(h.pi);
			const result = await client.execute(
				{ task: "ordinary observed" },
				h.ctx,
				undefined,
				{
					onProgress: (value) => {
						progress.push({ ...value });
						value.taskId = "mutated";
						value.phase = "failed";
						if (progress.length === 1) throw new Error("observer failure");
						return Promise.reject(new Error("async observer failure"));
					},
				},
			);
			await Promise.resolve();
			expect(result.details.status).toBe(status);
			expect(progress.map((value) => value.phase)).toEqual([
				"queued",
				"initializing",
				"running",
				status,
			]);
			expect(
				progress.every((value) => value.taskId === result.details.taskId),
			).toBe(true);
			expect(agents.text()).toContain("ordinary observed");
			expect(result.usage.totalTokens).toBe(3);
		} finally {
			await h.emit("session_shutdown");
		}
	});
}

for (const stop of [
	"session_before_tree",
	"session_tree",
	"session_shutdown",
] as const) {
	test(`scope invalidation via ${stop} detaches before late cleanup/result observations`, async () => {
		const ready = deferred();
		const cancelled = deferred();
		const finish = deferred();
		let owned!: DelegationOptions;
		const h = fixture(async (options) => {
			owned = options;
			options.signal?.addEventListener("abort", cancelled.resolve, {
				once: true,
			});
			options.status?.observe({ type: "agent_start" });
			ready.resolve();
			await finish.promise;
			options.status?.observe({ type: "agent_settled" });
			return failedResult("abort", true);
		});
		const agents = captureAgents(h);
		const progress: DelegateExecutionProgress[] = [];
		try {
			await h.emit("session_start");
			const client = getDelegateClient(h.pi);
			const operation = client.execute({ task: "old" }, h.ctx, undefined, {
				presentation: "consumer",
				onProgress: (value) => progress.push(value),
			});
			await ready.promise;
			const count = progress.length;
			const invalidation = h.emit(stop, {
				preparation: { targetId: "new", oldLeafId: "old" },
				newLeafId: "new",
				oldLeafId: "old",
			});
			await cancelled.promise;
			owned.status?.phase?.("running");
			finish.resolve();
			await invalidation;
			expect((await operation).details.status).toBe("cancelled");
			expect(progress).toHaveLength(count);
			expect(agents.text()).toBe("");
			if (stop !== "session_shutdown") {
				expect(client.list().details).toMatchObject({ total: 0 });
				await h.emit("session_start");
				expect(progress).toHaveLength(count);
			}
		} finally {
			finish.resolve();
			await h.emit("session_shutdown");
		}
	});
}

for (const phase of ["queued", "initializing"] as const) {
	test(`synchronous ${phase} observer invalidation cannot start work in the obsolete scope`, async () => {
		let calls = 0;
		const h = fixture(async () => {
			calls++;
			return completed();
		});
		const client = getDelegateClient(h.pi);
		const progress: DelegateExecutionProgress[] = [];
		let invalidation = Promise.resolve();
		const result = await client.execute(
			{ task: "obsolete" },
			h.ctx,
			undefined,
			{
				presentation: "consumer",
				onProgress(value) {
					progress.push(value);
					if (value.phase === phase)
						invalidation = h.emit("session_before_tree", {
							preparation: { targetId: "new", oldLeafId: "old" },
						});
				},
			},
		);
		await invalidation;
		expect(calls).toBe(0);
		expect(progress.map((value) => value.phase)).toEqual(
			phase === "queued" ? ["queued"] : ["queued", "initializing"],
		);
		expect(result.details.taskId).toBe(progress[0]?.taskId);
		expect(result.details.status).toBe("cancelled");
		expect(client.list().details).toMatchObject({ total: 0 });
		await h.emit("session_shutdown");
	});
}
