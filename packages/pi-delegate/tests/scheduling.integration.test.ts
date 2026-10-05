import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
	ExtensionAPI,
	ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { registerDelegate, runDelegation } from "../src/delegate.ts";
import { configurationContext } from "./fixtures/configuration-context.ts";

async function waitFor(predicate: () => boolean) {
	const deadline = Date.now() + 5000;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("Scheduling fixture timed out");
		await Bun.sleep(5);
	}
}

test("actual RPC children do not spawn while queued; initialization occupies the shared sync/background slot", async () => {
	const directory = await mkdtemp(join(tmpdir(), "delegate-scheduling-test-"));
	const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
	const hooks = new Map<string, (...args: unknown[]) => unknown>();
	const old = process.env.PI_DELEGATE_CONCURRENCY;
	process.env.PI_DELEGATE_CONCURRENCY = "1";
	try {
		registerDelegate(
			{
				registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
					tools.set(tool.name, tool),
				on: (name: string, handler: (...args: unknown[]) => unknown) => {
					hooks.set(name, handler);
					return () => {};
				},
				getAllTools: () => [],
				getActiveTools: () => [],
				getCommands: () => [],
				sendMessage() {},
			} as unknown as ExtensionAPI,
			(options) =>
				runDelegation({
					...options,
					requestedConfiguration: undefined,
					cliPath: resolve("tests/fixtures/scheduling-rpc.mjs"),
					env: { SCHEDULING_DIR: directory, SCHEDULING_TASK: options.task },
				}),
		);
	} finally {
		if (old === undefined) delete process.env.PI_DELEGATE_CONCURRENCY;
		else process.env.PI_DELEGATE_CONCURRENCY = old;
	}
	const ctx = {
		...configurationContext,
		cwd: process.cwd(),
		mode: "rpc",
		isProjectTrusted: () => false,
		isIdle: () => false,
		hasPendingMessages: () => false,
	} as unknown as ExtensionToolContext;
	const call = (name: string, params: unknown) => {
		const tool = tools.get(name);
		if (!tool) throw new Error("Missing tool");
		return tool.execute("call", params, undefined, undefined, ctx);
	};
	const file = (name: string) => join(directory, name);
	let sync: ReturnType<typeof call> | undefined;
	try {
		const first = await call("delegate", { task: "first", background: true });
		const id = (first.details as { taskId: string }).taskId;
		expect(first.details).toMatchObject({ status: "initializing" });
		await waitFor(() => existsSync(file("first-spawned")));
		sync = call("delegate", { task: "second" });
		const cancelled = await call("delegate", {
			task: "cancelled",
			background: true,
		});
		const cancelledId = (cancelled.details as { taskId: string }).taskId;
		expect(cancelled.details).toMatchObject({ status: "queued" });
		expect(
			(await call("delegate_cancel", { taskId: cancelledId })).details,
		).toMatchObject({ status: "cancelled" });
		await Bun.sleep(30);
		expect(existsSync(file("second-spawned"))).toBe(false);
		expect(existsSync(file("cancelled-spawned"))).toBe(false);
		expect(
			(await call("delegate_status", { taskId: id })).details,
		).toMatchObject({ status: "initializing" });
		await writeFile(file("first-initialize"), "");
		await waitFor(() => existsSync(file("first-running")));
		expect(
			(await call("delegate_status", { taskId: id })).details,
		).toMatchObject({ status: "running" });
		expect(existsSync(file("second-spawned"))).toBe(false);
		await writeFile(file("first-finish"), "");
		await waitFor(() => existsSync(file("second-spawned")));
		expect(
			(await call("delegate_status", { taskId: id })).details,
		).toMatchObject({ status: "completed", usage: { input: 8 } });
		await writeFile(file("second-initialize"), "");
		await writeFile(file("second-finish"), "");
		expect((await sync).details).toMatchObject({ status: "completed" });
	} finally {
		await hooks.get("session_shutdown")?.({});
		await sync;
		await rm(directory, { recursive: true, force: true });
	}
});
