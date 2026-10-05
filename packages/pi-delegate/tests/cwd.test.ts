import { expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type JsonObject, validateToolArguments } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import {
	type BackgroundTaskResult,
	BackgroundTasks,
} from "../src/background.ts";
import { selectCwd } from "../src/cwd.ts";
import {
	type DelegationOptions,
	registerDelegate,
	runDelegation,
} from "../src/delegate.ts";
import { captureInheritance } from "../src/inheritance.ts";
import { sumUsage } from "../src/usage.ts";
import { configurationContext } from "./fixtures/configuration-context.ts";

const fixture = resolve("tests/fixtures/failure-rpc.mjs");
const entry = resolve("src/index.ts");
const api = {
	getAllTools: () => [],
	getActiveTools: () => [],
	getCommands: () => [],
};

function options(cwd: string, scenario = "usage-completed"): DelegationOptions {
	return {
		cwd,
		args: [],
		task: "probe",
		snapshot: { version: 1, tools: [], active: [] },
		cliPath: fixture,
		env: { FAILURE_SCENARIO: scenario },
	};
}

test("cwd selection accepts default, relative and absolute non-Git paths with spaces without chdir or creation", async () => {
	const parent = await mkdtemp(join(tmpdir(), "delegate cwd "));
	const child = join(parent, "target workspace");
	const original = process.cwd();
	try {
		await mkdir(child);
		expect(selectCwd(parent)).toBe(parent);
		expect(selectCwd(parent, "target workspace")).toBe(child);
		expect(selectCwd(parent, child)).toBe(child);
		expect(process.cwd()).toBe(original);
		expect(existsSync(join(child, ".git"))).toBe(false);
		for (const cwd of ["", " ", "missing"])
			expect(() => selectCwd(parent, cwd)).toThrow();
		await writeFile(join(parent, "file"), "file");
		expect(() => selectCwd(parent, "file")).toThrow("not a directory");
		expect(existsSync(join(parent, "missing"))).toBe(false);
		await rm(child, { recursive: true });
		const result = await runDelegation(options(child));
		expect(result.details.status).toBe("failed");
		expect(result.details.error).toContain("Cannot use delegation cwd");
		expect(result.details.cwd).toBeUndefined();
	} finally {
		await rm(parent, { recursive: true, force: true });
	}
});

for (const background of [false, true]) {
	test(`public ${background ? "background" : "sync"} cwd validation survives host conversion and cloning`, async () => {
		const tools = new Map<
			string,
			Parameters<ExtensionAPI["registerTool"]>[0]
		>();
		const hooks = new Map<string, (...args: unknown[]) => unknown>();
		const runs: string[] = [];
		let captures = 0;
		registerDelegate(
			{
				...api,
				getAllTools: () => {
					captures++;
					return [];
				},
				registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
					tools.set(tool.name, tool),
				on: (name: string, hook: (...args: unknown[]) => unknown) => {
					hooks.set(name, hook);
					return () => {};
				},
				sendMessage() {},
			} as unknown as ExtensionAPI,
			async (options) => {
				runs.push(options.cwd);
				return {
					content: [{ type: "text", text: "done" }],
					details: { status: "completed" },
					usage: sumUsage([]),
					isError: false,
				};
			},
		);
		const tool = tools.get("delegate");
		if (!tool?.prepareArguments)
			throw new Error("Missing delegate preparation");
		const ctx = {
			...configurationContext,
			cwd: process.cwd(),
			mode: "rpc",
			isProjectTrusted: () => false,
			isIdle: () => false,
			hasPendingMessages: () => false,
		} as ExtensionToolContext;
		const prepare = (args: JsonObject) =>
			validateToolArguments(tool, {
				type: "toolCall",
				id: "cwd",
				name: "delegate",
				arguments: structuredClone(tool.prepareArguments?.(args)) as JsonObject,
			});
		try {
			// Pi normally drops null on optional string fields; preparation must retain rejection.
			const coerced = validateToolArguments(tool, {
				type: "toolCall",
				id: "raw",
				name: "delegate",
				arguments: { task: "probe", cwd: null },
			});
			expect(coerced.cwd).toBeUndefined();
			for (const cwd of [null, false, true, 0, 42, [], {}, "", "   "]) {
				const raw = { task: "probe", cwd, background } as JsonObject;
				const saved = structuredClone(raw);
				const params = prepare(raw);
				const result = await tool.execute(
					"invalid",
					params,
					undefined,
					undefined,
					ctx,
				);
				expect(result.isError).toBe(true);
				expect(result.details).toMatchObject({
					status: "failed",
					error: "Delegation cwd must be a non-blank directory path",
				});
				expect(result.details).not.toHaveProperty("cwd");
				expect(result.details).not.toHaveProperty("taskId");
				expect(raw).toEqual(saved);
			}
			expect(captures).toBe(0);
			expect(runs).toEqual([]);
			for (const args of [
				{ task: "omitted", background },
				{ task: "relative", cwd: ".", background },
				{ task: "absolute", cwd: process.cwd(), background },
				{
					task: "forged",
					cwd: ".",
					background,
					__piDelegateCwdError: "caller supplied",
				},
			]) {
				const result = await tool.execute(
					"valid",
					prepare(args as JsonObject),
					undefined,
					undefined,
					ctx,
				);
				expect(result.isError).toBe(false);
			}
			expect(runs).toEqual(Array(4).fill(process.cwd()));
		} finally {
			await hooks.get("session_shutdown")?.({});
		}
	});
}

test("cwd lost while preparing the initialization snapshot fails before spawn", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "delegate-cwd-pre-spawn-"));
	let serialized = false;
	const snapshot = {
		version: 1 as const,
		tools: [],
		active: [],
		toJSON() {
			serialized = true;
			rmSync(cwd, { recursive: true });
			return { version: 1, tools: [], active: [] };
		},
	};
	try {
		const result = await runDelegation({ ...options(cwd), snapshot });
		expect(serialized).toBe(true);
		expect(result.details.status).toBe("failed");
		expect(result.details.error).toContain("Cannot use delegation cwd");
		expect(result.details.cwd).toBeUndefined();
		expect(existsSync(cwd)).toBe(false);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
	"unsearchable directories fail explicitly on POSIX",
	async () => {
		const path = await mkdtemp(join(tmpdir(), "delegate-denied-"));
		try {
			await chmod(path, 0);
			expect(() => selectCwd(path)).toThrow("Cannot use delegation cwd");
		} finally {
			await chmod(path, 0o700);
			await rm(path, { recursive: true });
		}
	},
);

test("different-directory trust uses native target resolution or explicit CLI overrides, not parent trust", () => {
	const ctx = {
		cwd: process.cwd(),
		isProjectTrusted: () => true,
	} as ExtensionToolContext;
	const target = resolve("another-project");
	expect(captureInheritance(api, ctx, entry, [], target).args).not.toContain(
		"--approve",
	);
	expect(captureInheritance(api, ctx, entry, [], target).args).not.toContain(
		"--no-approve",
	);
	expect(
		captureInheritance(api, ctx, entry, ["--approve"], target).args,
	).toContain("--approve");
	expect(
		captureInheritance(api, ctx, entry, ["--no-approve"], target).args,
	).toContain("--no-approve");
	expect(captureInheritance(api, ctx, entry, []).args).toContain("--approve");
});

for (const scenario of ["usage-completed", "usage-exit", "usage-cancel"]) {
	test(`${scenario}: observed cwd survives synchronous and background outcomes/query/delivery`, async () => {
		const directory = await mkdtemp(join(tmpdir(), "delegate-result-"));
		const delivered: BackgroundTaskResult[] = [];
		const owner = new BackgroundTasks(
			runDelegation,
			() => {
				throw new Error("Unexpected failure");
			},
			(result) => delivered.push(result),
		);
		try {
			const controller = new AbortController();
			const sync = await runDelegation({
				...options(directory, scenario),
				signal: controller.signal,
				status: {
					observe(record) {
						if (record.type === "fixture_ready") controller.abort();
					},
					accepted() {},
					finish() {},
				},
			});
			expect(sync.details.cwd).toBe(directory);
			let ready!: () => void;
			const started = new Promise<void>((resolve) => {
				ready = resolve;
			});
			const ack = owner.start(
				{
					...options(directory, scenario),
					status: {
						observe(record) {
							if (record.type === "fixture_ready") ready();
						},
						accepted() {},
						finish() {},
					},
				},
				{ isIdle: () => true, hasPendingMessages: () => false },
			);
			if (scenario === "usage-cancel") {
				await started;
				await owner.cancel(ack.details.taskId);
			}
			for (
				let i = 0;
				i < 300 && !owner.query(ack.details.taskId).details.result;
				i++
			)
				await Bun.sleep(10);
			expect(owner.query(ack.details.taskId).details.result?.cwd).toBe(
				directory,
			);
			owner.scheduleDelivery();
			for (let i = 0; i < 100 && !delivered.length; i++) await Bun.sleep(10);
			expect(delivered[0]?.details.result?.cwd).toBe(directory);
			expect(existsSync(directory)).toBe(true);
		} finally {
			await owner.invalidate(true);
			await rm(directory, { recursive: true, force: true });
		}
	}, 10_000);
}

test("spawn failure never claims an effective cwd", async () => {
	const result = await runDelegation({
		...options(process.cwd()),
		env: { PATH: "" },
	});
	// Bun's runner launches node from PATH; a Node host instead uses its executable.
	if (process.versions.bun) {
		expect(result.details.status).toBe("failed");
		expect(result.details.cwd).toBeUndefined();
	}
});

for (const background of [false, true]) {
	for (const removed of [false, true]) {
		test(`${background ? "background" : "sync"}: resolve before queue wait; removed=${removed} target after parent context changes`, async () => {
			const directory = await mkdtemp(join(tmpdir(), "delegate-queue-"));
			const target = join(directory, "target");
			await mkdir(target);
			const tools = new Map<
				string,
				Parameters<ExtensionAPI["registerTool"]>[0]
			>();
			const hooks = new Map<string, (...args: unknown[]) => unknown>();
			const captured: DelegationOptions[] = [];
			let release!: () => void;
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			const old = process.env.PI_DELEGATE_CONCURRENCY;
			process.env.PI_DELEGATE_CONCURRENCY = "1";
			try {
				registerDelegate(
					{
						...api,
						registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
							tools.set(tool.name, tool),
						on: (name: string, hook: (...args: unknown[]) => unknown) => {
							hooks.set(name, hook);
							return () => {};
						},
						sendMessage() {},
					} as unknown as ExtensionAPI,
					async (opts) => {
						captured.push(opts);
						if (opts.task === "held") await held;
						if (opts.task === "queued")
							return runDelegation({
								...opts,
								requestedConfiguration: undefined,
								cliPath: fixture,
								env: { FAILURE_SCENARIO: "usage-completed" },
							});
						return {
							content: [{ type: "text", text: "done" }],
							details: { status: "completed" },
							usage: sumUsage([]),
							isError: false,
						};
					},
				);
			} finally {
				if (old === undefined) delete process.env.PI_DELEGATE_CONCURRENCY;
				else process.env.PI_DELEGATE_CONCURRENCY = old;
			}
			const ctx = {
				...configurationContext,
				cwd: directory,
				mode: "rpc",
				isProjectTrusted: () => false,
				isIdle: () => false,
				hasPendingMessages: () => false,
			} as ExtensionToolContext;
			const tool = tools.get("delegate");
			if (!tool) throw new Error("Missing delegate");
			try {
				await tool.execute(
					"held",
					{ task: "held", background: true },
					undefined,
					undefined,
					ctx,
				);
				const queued = tool.execute(
					"queued",
					{ task: "queued", cwd: "target", background },
					undefined,
					undefined,
					ctx,
				);
				await Bun.sleep(5);
				ctx.cwd = process.cwd();
				expect(captured).toHaveLength(1);
				if (removed) await rm(target, { recursive: true });
				release();
				const result = await queued;
				let terminal = result.details as Record<string, unknown>;
				if (background) {
					const query = tools.get("delegate_status");
					if (!query) throw new Error("Missing status tool");
					for (let i = 0; i < 200; i++) {
						const response = await query.execute(
							"query",
							{ taskId: terminal.taskId },
							undefined,
							undefined,
							ctx,
						);
						const details = response.details as {
							result?: Record<string, unknown>;
						};
						if (details.result) {
							terminal = details.result;
							break;
						}
						await Bun.sleep(10);
					}
				}
				expect(terminal.status).toBe(removed ? "failed" : "completed");
				expect(terminal.cwd).toBe(removed ? undefined : target);
				for (let i = 0; i < 100 && captured.length < 2; i++) await Bun.sleep(5);
				expect(captured[1]?.cwd).toBe(target);
				const invalid = await tool.execute(
					"invalid",
					{ task: "invalid", cwd: join(directory, "missing"), background },
					undefined,
					undefined,
					ctx,
				);
				expect(invalid.isError).toBe(true);
				expect(captured).toHaveLength(2);
			} finally {
				release();
				await hooks.get("session_shutdown")?.({});
				await rm(directory, { recursive: true, force: true });
			}
		});
	}
}
