import { expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { type DelegationOptions, registerDelegate } from "../src/delegate.ts";
import { sumUsage } from "../src/usage.ts";
import { configurationContext } from "./fixtures/configuration-context.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const usage = (input: number) => ({
	...sumUsage([]),
	input,
	totalTokens: input,
});

function runtime(limit?: string) {
	const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
	const hooks = new Map<string, (...args: unknown[]) => unknown>();
	const runs = new Map<
		string,
		{ options: DelegationOptions; finish: () => void }
	>();
	const order: string[] = [];
	let render: ((width: number) => string[]) | undefined;
	const old = process.env.PI_DELEGATE_CONCURRENCY;
	if (limit) process.env.PI_DELEGATE_CONCURRENCY = limit;
	else delete process.env.PI_DELEGATE_CONCURRENCY;
	try {
		registerDelegate(
			{
				registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
					tools.set(tool.name, tool),
				on: (name: string, handler: (...args: unknown[]) => unknown) => {
					hooks.set(name, handler as never);
					return () => {};
				},
				getAllTools: () => [],
				getActiveTools: () => [],
				getCommands: () => [],
				sendMessage() {},
			} as unknown as ExtensionAPI,
			async (options) => {
				order.push(options.task);
				await new Promise<void>((finish) =>
					runs.set(options.task, { options, finish }),
				);
				options.onUsage?.(usage(20));
				if (options.task === "failure")
					throw new Error("fixture transport failure");
				return {
					content: [{ type: "text", text: "answer" }],
					details: {
						status: options.signal?.aborted ? "cancelled" : "completed",
					},
					usage: usage(20),
					isError: !!options.signal?.aborted,
				};
			},
		);
	} finally {
		if (old === undefined) delete process.env.PI_DELEGATE_CONCURRENCY;
		else process.env.PI_DELEGATE_CONCURRENCY = old;
	}
	const ctx = {
		...configurationContext,
		cwd: process.cwd(),
		mode: "tui",
		isProjectTrusted: () => false,
		isIdle: () => false,
		hasPendingMessages: () => false,
		ui: {
			setWidget(_key: string, factory: unknown) {
				if (typeof factory === "function")
					render = factory(
						{ requestRender() {} },
						{ fg: (_color: string, text: string) => text },
					).render;
				else render = undefined;
			},
		},
	} as unknown as ExtensionToolContext;
	const call = (name: string, params: unknown, signal?: AbortSignal) => {
		const tool = tools.get(name);
		if (!tool) throw new Error("Missing tool");
		return tool.execute("call", params, signal, undefined, ctx);
	};
	hooks.get("session_start")?.({}, ctx);
	return {
		call,
		ctx,
		hooks,
		runs,
		order,
		text: () => render?.(200).join("\n") ?? "",
		close: async () => {
			for (const run of runs.values()) run.finish();
			await hooks.get("session_shutdown")?.({});
		},
	};
}

test("shared override pool reserves FIFO at background acceptance, holds initialization/cleanup and captures queued inputs", async () => {
	const host = runtime("1");
	try {
		const first = await host.call("delegate", {
			task: "first",
			background: true,
		});
		expect(first.details).toMatchObject({ status: "initializing" });
		await tick();
		const second = await host.call("delegate", {
			task: "second",
			background: true,
		});
		const sync = host.call("delegate", { task: "sync" });
		await tick();
		expect(second.details).toMatchObject({ status: "queued" });
		expect(host.order).toEqual(["first"]);
		expect(host.text()).toContain("active: 1/1 · queued: 2");
		expect(host.text()).toContain("0s · 0 turns · pressure: none");
		expect(
			(
				await host.call("delegate_steer", {
					taskId: (second.details as { taskId: string }).taskId,
					message: "no buffering",
				})
			).details,
		).toMatchObject({ status: "not_ready" });
		const original = structuredClone(host.ctx.model);
		host.ctx.model = {
			...host.ctx.model,
			id: "changed-parent",
		} as typeof host.ctx.model;
		host.runs.get("first")?.options.status?.observe({ type: "agent_settled" });
		await tick();
		expect(host.order).toEqual(["first"]);
		host.runs.get("first")?.finish();
		await tick();
		expect(host.order).toEqual(["first", "second"]);
		expect(
			host.runs.get("second")?.options.requestedConfiguration?.model.id,
		).toBe(original?.id);
		host.runs.get("second")?.finish();
		await tick();
		expect(host.order).toEqual(["first", "second", "sync"]);
		host.runs.get("sync")?.finish();
		expect((await sync).details).toMatchObject({ status: "completed" });
		expect(host.text()).toContain("Delegated total · ↑60");
	} finally {
		await host.close();
	}
});

test("queued cancellation never runs, navigation retains late cleanup usage without restoring rows, fresh runtime resets", async () => {
	const host = runtime("1");
	try {
		await host.call("delegate", { task: "held", background: true });
		await tick();
		host.runs.get("held")?.options.onUsage?.(usage(10));
		const parent = new AbortController();
		const sync = host.call("delegate", { task: "cancel-sync" }, parent.signal);
		const queued = await host.call("delegate", {
			task: "cancel-bg",
			background: true,
		});
		const id = (queued.details as { taskId: string }).taskId;
		parent.abort();
		expect((await sync).details).toMatchObject({ status: "cancelled" });
		expect(
			(await host.call("delegate_cancel", { taskId: id })).details,
		).toMatchObject({ status: "cancelled" });
		await host.call("delegate", { task: "invalidated", background: true });
		const navigation = host.hooks.get("session_before_tree")?.({
			preparation: { targetId: "new", oldLeafId: "old" },
		});
		expect(host.text()).toContain("Delegated total · ↑10");
		expect(host.text()).not.toContain("held");
		host.runs.get("held")?.finish();
		await navigation;
		expect(host.order).toEqual(["held"]);
		expect(host.text()).toContain("Delegated total · ↑20");
		expect(host.text()).not.toContain("held");
		const fresh = runtime("1");
		try {
			expect(fresh.text()).toBe("");
		} finally {
			await fresh.close();
		}
	} finally {
		await host.close();
	}
});

test("default shared pool admits four tasks and queues the fifth", async () => {
	const host = runtime();
	try {
		for (let i = 0; i < 5; i++)
			await host.call("delegate", { task: String(i), background: true });
		await tick();
		expect(host.order).toEqual(["0", "1", "2", "3"]);
		expect(host.text()).toContain("active: 4/4 · queued: 1");
		const navigation = host.hooks.get("session_before_tree")?.({
			preparation: { targetId: "new", oldLeafId: "old" },
		});
		for (const run of host.runs.values()) run.finish();
		await navigation;
		expect(host.order).toHaveLength(4);
	} finally {
		await host.close();
	}
});

test("runner failure retains available usage and releases the slot for a queued follower", async () => {
	const host = runtime("1");
	try {
		const failed = host.call("delegate", { task: "failure" });
		await tick();
		const follower = await host.call("delegate", {
			task: "follower",
			background: true,
		});
		expect(follower.details).toMatchObject({ status: "queued" });
		host.runs.get("failure")?.finish();
		const result = await failed;
		expect(result.details).toMatchObject({ status: "failed" });
		expect(result.usage?.input).toBe(20);
		await tick();
		expect(host.order).toEqual(["failure", "follower"]);
		expect(host.text()).toContain("Delegated total · ↑20");
		host.runs.get("follower")?.finish();
		await tick();
		expect(host.text()).toContain("Delegated total · ↑40");
	} finally {
		await host.close();
	}
});
