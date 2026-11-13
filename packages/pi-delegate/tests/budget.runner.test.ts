import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type {
	ExtensionAPI,
	ExtensionToolContext,
	JsonAgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { BackgroundTasks } from "../src/background.ts";
import {
	type DelegationOptions,
	registerDelegate,
	runDelegation,
} from "../src/delegate.ts";
import { configurationContext } from "./fixtures/configuration-context.ts";
import { processExited } from "./fixtures/process-exit.ts";

async function fixture(
	scenario: string,
	action: (
		options: DelegationOptions,
		log: () => Record<string, unknown>[],
	) => Promise<void>,
) {
	const cwd = await mkdtemp(join(tmpdir(), "budget-test-"));
	const path = join(cwd, "trace.jsonl");
	try {
		await action(
			{
				cwd,
				args: [],
				task: "Return only JSON",
				context: "supplemental",
				resultFormat: "handoff",
				snapshot: { version: 1, tools: [], active: [] },
				cliPath: resolve("tests/fixtures/budget-rpc.mjs"),
				env: { BUDGET_SCENARIO: scenario, BUDGET_LOG: path },
			},
			() =>
				existsSync(path)
					? readFileSync(path, "utf8")
							.trim()
							.split("\n")
							.map((line) => JSON.parse(line))
					: [],
		);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
}
for (const scenario of [
	"time",
	"turn",
	"init",
	"large",
	"readback",
	"held-acceptance",
	"overlap",
	"late-readback",
])
	test(`${scenario}: budget cancels, retains text/usage and cleans child before returning`, async () => {
		await fixture(scenario, async (options, log) => {
			const controller = new AbortController();
			const result = await runDelegation({
				...options,
				signal: controller.signal,
				budget: ["turn", "overlap"].includes(scenario)
					? { maxTurns: 1 }
					: { maxSeconds: 0.05 },
			});
			expect(result.details.status).toBe("cancelled");
			expect(result.details.budgetStop).toMatchObject({
				cause: "budget",
				dimension: ["turn", "overlap"].includes(scenario) ? "turns" : "seconds",
				limit: ["turn", "overlap"].includes(scenario) ? 1 : 0.05,
			});
			expect(result.details.budgetStop?.observed).toBeGreaterThanOrEqual(
				result.details.budgetStop?.limit ?? 0,
			);
			expect(result.details.partialOutput).toBe(true);
			expect(result.details.usagePartial).toBe(true);
			expect(result.content[0].text).toContain("Partial output");
			expect(result.content[0].text).toContain("first observed answer");
			expect(result.content[0].text).toContain("partial ");
			expect(result.usage.input).toBe(
				scenario === "readback" ? 10 : scenario === "late-readback" ? 11 : 7,
			);
			expect(controller.signal.aborted).toBe(false);
			const trace = log();
			expect(trace.filter((r) => r.type === "abort")).toHaveLength(1);
			expect(trace.filter((r) => r.type === "prompt")).toHaveLength(2); // Init + original task, no reporting generation.
			const prompt = trace.find(
				(r) => r.type === "prompt" && String(r.message).startsWith("Task:"),
			);
			for (const text of [
				"Return only JSON",
				"supplemental",
				"Result reporting convention",
				"Execution budget",
				"queueing",
				"no additional model reporting allowance",
			])
				expect(prompt?.message).toContain(text);
			const spawned = trace.find((r) => r.kind === "spawn");
			expect(processExited(Number(spawned?.pid))).toBe(true);
			expect(existsSync(dirname(String(spawned?.snapshot)))).toBe(false);
			expect(existsSync(options.cwd)).toBe(true);
			if (scenario === "large") {
				expect(result.details.truncation?.truncated).toBe(true);
				const path = result.details.fullOutputPath;
				expect(path).toBeDefined();
				if (path) {
					expect(readFileSync(path, "utf8")).toBe(
						`first observed answer\n\npartial ${"line\n".repeat(3000)}`,
					);
					await rm(dirname(path), { recursive: true, force: true });
				}
			}
		});
	});
test("settlement closes timer; successful unbudgeted and budgeted results remain successful", async () => {
	await fixture("settled", async (options) => {
		for (const budget of [undefined, {}, { maxSeconds: 0.1, maxTurns: 2 }]) {
			const result = await runDelegation({ ...options, budget });
			expect(result.details.status).toBe("completed");
			expect(result.details.budgetStop).toBeUndefined();
		}
	});
});
for (const scenario of ["time", "held-acceptance", "late-readback", "large"])
	for (const budget of [undefined, { maxSeconds: 10 }])
		test(`${scenario}: manual cancellation retains available output without an enabled/reached budget (${!!budget})`, async () => {
			await fixture(scenario, async (options, log) => {
				const controller = new AbortController();
				const result = await runDelegation({
					...options,
					budget,
					signal: controller.signal,
					status: {
						observe(record) {
							const event = record as JsonAgentSessionEvent;
							if (
								event.type === "message_update" &&
								event.assistantMessageEvent?.type === "text_delta" &&
								event.assistantMessageEvent.delta !== "partial "
							)
								controller.abort();
						},
						accepted() {},
						finish() {},
					},
				});
				expect(result.details.status).toBe("cancelled");
				expect(result.isError).toBe(true);
				expect(result.details.error).toBe("Delegation cancelled");
				expect(result.details.budgetStop).toBeUndefined();
				expect(result.details.stopReason).toBeUndefined();
				expect(result.details.partialOutput).toBe(true);
				expect(result.details.usagePartial).toBe(true);
				expect(result.content[0].text).toContain("Partial output");
				expect(result.content[0].text).toContain(
					"first observed answer\n\npartial ",
				);
				expect(result.usage.input).toBe(scenario === "late-readback" ? 9 : 7);
				const trace = log();
				expect(trace.filter((r) => r.type === "prompt")).toHaveLength(2);
				expect(trace.some((r) => r.type === "steer")).toBe(false);
				expect(trace.some((r) => r.kind === "closed")).toBe(true);
				const spawned = trace.find((r) => r.kind === "spawn");
				expect(processExited(Number(spawned?.pid))).toBe(true);
				expect(existsSync(dirname(String(spawned?.snapshot)))).toBe(false);
				expect(existsSync(options.cwd)).toBe(true);
				if (scenario === "large") {
					expect(result.details.truncation?.truncated).toBe(true);
					const path = result.details.fullOutputPath;
					expect(path).toBeDefined();
					if (path) {
						expect(readFileSync(path, "utf8")).toBe(
							`first observed answer\n\npartial ${"line\n".repeat(3000)}`,
						);
						await rm(dirname(path), { recursive: true, force: true });
					}
				}
			});
		});
test("manual cancellation wins before budget and preserves existing cause semantics", async () => {
	await fixture("time", async (options) => {
		const controller = new AbortController();
		const result = await runDelegation({
			...options,
			signal: controller.signal,
			budget: { maxSeconds: 1 },
			status: {
				observe(event) {
					if (event.type === "agent_start") controller.abort();
				},
				accepted() {},
				finish() {},
			},
		});
		expect(result.details.status).toBe("cancelled");
		expect(result.details.budgetStop).toBeUndefined();
	});
});
test("background budget result is query-only and repeated reads retain one usage snapshot", async () => {
	await fixture("time", async (options) => {
		const owner = new BackgroundTasks(runDelegation, () => {
			throw new Error("Unexpected runner throw");
		});
		const ack = owner.start({ ...options, budget: { maxSeconds: 0.05 } });
		try {
			for (
				let i = 0;
				i < 300 && !owner.query(ack.details.taskId).details.result;
				i++
			)
				await Bun.sleep(10);
			const result = owner.query(ack.details.taskId);
			expect(result.details.status).toBe("cancelled");
			expect(result.details.result?.budgetStop?.cause).toBe("budget");
			expect(result.details.usage?.input).toBe(7);
			expect(owner.query(ack.details.taskId)).toEqual(result);
		} finally {
			await owner.invalidate(true);
		}
	});
});
test("manual background cancellation retains output query-only and keeps initiating-signal ownership", async () => {
	await fixture("time", async (options, log) => {
		const owner = new BackgroundTasks(runDelegation, () => {
			throw new Error("Unexpected runner throw");
		});
		const initiating = new AbortController();
		const ack = owner.start({ ...options, signal: initiating.signal });
		try {
			for (
				let i = 0;
				i < 300 && owner.query(ack.details.taskId).details.usage?.input !== 7;
				i++
			)
				await Bun.sleep(10);
			expect(owner.query(ack.details.taskId).details.usage?.input).toBe(7);
			initiating.abort();
			expect(owner.query(ack.details.taskId).details.status).toBe("running");
			const result = await owner.cancel(ack.details.taskId);
			expect(result.details.status).toBe("cancelled");
			expect(result.details.result?.partialOutput).toBe(true);
			expect(result.details.result?.usagePartial).toBe(true);
			expect(result.details.result?.budgetStop).toBeUndefined();
			expect(result.content[0].text).toContain(
				"first observed answer\n\npartial answer",
			);
			expect(result.details.usage?.input).toBe(7);
			expect(result).not.toHaveProperty("usage"); // Observation is not a host usage charge.
			expect(owner.query(ack.details.taskId)).toEqual(result);
			const trace = log();
			expect(trace.filter((r) => r.type === "prompt")).toHaveLength(2);
			const spawned = trace.find((r) => r.kind === "spawn");
			expect(processExited(Number(spawned?.pid))).toBe(true);
			expect(existsSync(dirname(String(spawned?.snapshot)))).toBe(false);
		} finally {
			await owner.invalidate(true);
		}
	});
});

test("pre-aborted runner cancellation does not invent available text or reported usage", async () => {
	await fixture("time", async (options, log) => {
		const controller = new AbortController();
		controller.abort();
		const result = await runDelegation({
			...options,
			signal: controller.signal,
		});
		expect(result.details.status).toBe("cancelled");
		expect(result.details.partialOutput).toBe(true);
		expect(result.details.usagePartial).toBe(true);
		expect(result.content[0].text).not.toContain("first observed answer");
		expect(result.usage.totalTokens).toBe(0);
		expect(log()).toEqual([]);
	});
});
test("invalid raw budgets fail in sync/background before runner invocation; diagnostics cannot be spoofed", async () => {
	let delegate: Parameters<ExtensionAPI["registerTool"]>[0] | undefined;
	let runs = 0;
	registerDelegate(
		{
			registerTool(tool: Parameters<ExtensionAPI["registerTool"]>[0]) {
				if (tool.name === "delegate") delegate = tool;
			},
			on: () => () => {},
			getAllTools: () => [],
			getActiveTools: () => [],
			getCommands: () => [],
		} as unknown as ExtensionAPI,
		async () => {
			runs++;
			throw new Error("Unexpected run");
		},
	);
	if (!delegate) throw new Error("Missing tool");
	const ctx = {
		...configurationContext,
		cwd: process.cwd(),
		mode: "rpc",
		hasUI: false,
		isProjectTrusted: () => false,
	} as unknown as ExtensionToolContext;
	for (const background of [false, true])
		for (const budget of [
			null,
			0,
			{ maxSeconds: 0 },
			{ maxSeconds: Infinity },
			{ maxTurns: 1.5 },
			{ maxTurns: "2" },
			{ other: 1 },
		]) {
			const raw = {
				task: "probe",
				background,
				budget,
				__piDelegateBudgetError: "spoof",
			};
			const prepared = delegate.prepareArguments?.(raw) ?? raw;
			const result = await delegate.execute(
				"probe",
				prepared as never,
				undefined,
				undefined,
				ctx,
			);
			expect(result.details).toMatchObject({ status: "failed" });
			expect(result.content[0]).toMatchObject({
				type: "text",
				text: expect.stringContaining("budget"),
			});
		}
	expect(runs).toBe(0);
	await fixture("time", async (options, log) => {
		const result = await runDelegation({
			...options,
			budget: { maxSeconds: 0 },
		});
		expect(result.details.status).toBe("failed");
		expect(log()).toEqual([]);
	});
});
