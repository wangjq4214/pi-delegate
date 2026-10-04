import { expect, test } from "bun:test";
import { resolve } from "node:path";
import type {
	ExtensionAPI,
	ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { BackgroundTasks } from "../src/background.ts";
import {
	type DelegationOptions,
	registerDelegate,
	runDelegation,
} from "../src/delegate.ts";
import { configurationContext } from "./fixtures/configuration-context.ts";

const fixture = resolve("tests/fixtures/failure-rpc.mjs");
function options(scenario: string): DelegationOptions {
	return {
		cwd: process.cwd(),
		args: [],
		task: "probe",
		snapshot: { version: 1, tools: [], active: [] },
		cliPath: fixture,
		env: { FAILURE_SCENARIO: scenario },
	};
}
function expectedUsage(n: number) {
	return {
		input: n,
		output: n,
		cacheRead: n,
		cacheWrite: n,
		totalTokens: n * 4,
		reasoning: n,
		cacheWrite1h: n,
		cost: { input: n, output: n, cacheRead: n, cacheWrite: n, total: n * 4 },
	};
}

for (const [scenario, status, sum] of [
	["usage-cancel", "cancelled", 10],
	["usage-stream-cancel", "cancelled", 9],
	["usage-stream-exit", "failed", 9],
	["usage-tool-start-cancel", "cancelled", 5],
	["usage-tool-start-exit", "failed", 5],
	["usage-exit", "failed", 10],
	["usage-entries-failure", "failed", 10],
	["usage-state-failure", "failed", 10],
	["usage-completed", "completed", 10],
	["usage-readback", "completed", 13],
] as const) {
	test(`${scenario}: retain available usage without counting cumulative updates, turn_end or nested tools twice`, async () => {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 4_000);
		try {
			const result = await runDelegation({
				...options(scenario),
				signal: controller.signal,
				status: {
					observe(record) {
						if (record.type === "fixture_ready") controller.abort();
					},
					accepted() {},
					finish() {},
				},
			});
			expect(result.details.status).toBe(status);
			expect(result.usage).toEqual(expectedUsage(sum));
		} finally {
			clearTimeout(timeout);
			controller.abort();
		}
	});
}

test("background cancellation and later query preserve observed child usage", async () => {
	let ready!: () => void;
	const started = new Promise<void>((resolve) => {
		ready = resolve;
	});
	const owner = new BackgroundTasks(
		runDelegation,
		() => {
			throw new Error("Unexpected runner throw");
		},
		() => {},
	);
	const ack = owner.start(
		{
			...options("usage-cancel"),
			status: {
				observe(record) {
					if (record.type === "fixture_ready") ready();
				},
				accepted() {},
				finish() {},
			},
		},
		{ isIdle: () => false, hasPendingMessages: () => false },
	);
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			started,
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("Child did not become ready")),
					4_000,
				);
			}),
		]);
		const result = await owner.cancel(ack.details.taskId);
		expect(result.details.status).toBe("cancelled");
		expect(result.details.usage).toEqual(expectedUsage(10));
		expect(owner.query(ack.details.taskId).details.usage).toEqual(
			expectedUsage(10),
		);
	} finally {
		clearTimeout(timer);
		await owner.invalidate(true);
	}
});

for (const method of ["input", "select", "confirm"] as const) {
	for (const [scenario, status] of [
		["ui-exit", "failed"],
		["ui-completed", "completed"],
		["ui-cancel", "cancelled"],
	] as const) {
		test(`${method}: ${scenario} closes pending parent dialog without changing task outcome`, async () => {
			let tool: Parameters<ExtensionAPI["registerTool"]>[0] | undefined;
			const controller = new AbortController();
			let dialogSignal: AbortSignal | undefined;
			let executionSignal: AbortSignal | undefined;
			let closed = false;
			registerDelegate(
				{
					registerTool(
						definition: Parameters<ExtensionAPI["registerTool"]>[0],
					) {
						if (definition.name === "delegate") tool = definition;
					},
					on: () => () => {},
					getAllTools: () => [],
					getActiveTools: () => [],
					getCommands: () => [],
				} as unknown as ExtensionAPI,
				(captured) => {
					executionSignal = captured.signal;
					return runDelegation({
						...captured,
						requestedConfiguration: undefined,
						cliPath: fixture,
						env: { FAILURE_SCENARIO: scenario, UI_METHOD: method },
					});
				},
			);
			const dialog = (
				_title: string,
				_value: unknown,
				opts: { signal: AbortSignal },
			) => {
				dialogSignal = opts.signal;
				return new Promise<undefined>((resolve) => {
					opts.signal.addEventListener(
						"abort",
						() => {
							closed = true;
							resolve(undefined);
						},
						{ once: true },
					);
					if (scenario === "ui-cancel") controller.abort();
				});
			};
			const ctx = {
				...configurationContext,
				cwd: process.cwd(),
				mode: "tui",
				hasUI: true,
				isProjectTrusted: () => false,
				ui: { input: dialog, select: dialog, confirm: dialog },
			} as unknown as ExtensionToolContext;
			const timeout = setTimeout(() => controller.abort(), 4_000);
			try {
				if (!tool) throw new Error("Tool not registered");
				const result = await tool.execute(
					"probe",
					{ task: "probe" },
					controller.signal,
					undefined,
					ctx,
				);
				expect(result.details).toMatchObject({ status });
				expect(dialogSignal).toBeDefined();
				expect(dialogSignal?.aborted).toBe(true);
				expect(closed).toBe(true);
				expect(executionSignal?.aborted).toBe(scenario === "ui-cancel");
				expect(controller.signal.aborted).toBe(scenario === "ui-cancel");
			} finally {
				clearTimeout(timeout);
				controller.abort();
			}
		});
	}
}
