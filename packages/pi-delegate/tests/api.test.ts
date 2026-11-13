import { expect, spyOn, test } from "bun:test";
import {
	createEventBus,
	type ExtensionAPI,
	type ExtensionContext,
	type ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import {
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
		const queued = client.execute(
			{ task: "cancelled before admission" },
			h.ctx,
			queuedController.signal,
		);
		queuedController.abort();
		expect(starts).toEqual(["owned"]);
		expect((await queued).details.status).toBe("cancelled");
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
