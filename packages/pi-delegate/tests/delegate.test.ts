import { expect, expectTypeOf, spyOn, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type JsonObject, validateToolArguments } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import {
	type DelegationOptions,
	type DelegationResult,
	registerDelegate,
	runDelegation,
} from "../src/delegate.ts";
import {
	type PressureOverrides,
	pressureParameters,
	resolvePressure,
} from "../src/pressure.ts";
import { RpcProcess } from "../src/rpc.ts";
import { configurationContext } from "./fixtures/configuration-context.ts";

function registeredTool() {
	let tool: Parameters<ExtensionAPI["registerTool"]>[0] | undefined;
	registerDelegate({
		registerTool: (definition: Parameters<ExtensionAPI["registerTool"]>[0]) => {
			if (definition.name === "delegate") tool = definition;
		},
		on: () => () => {},
		getAllTools: () => {
			throw new Error("fixture inheritance failure");
		},
	} as unknown as ExtensionAPI);
	if (!tool) throw new Error("Delegate not registered");
	return tool;
}

for (const [task, signal, status, error] of [
	["   ", undefined, "failed", "Delegation task must not be blank"],
	["task", undefined, "failed", "fixture inheritance failure"],
	["task", AbortSignal.abort(), "cancelled", "Delegation cancelled"],
] as const) {
	test(`registered delegate returns ${status} for ${error}`, async () => {
		const tool = registeredTool();
		const result = await tool.execute("test", { task }, signal, undefined, {
			...configurationContext,
			cwd: process.cwd(),
		} as ExtensionToolContext);
		expect(result.details).toMatchObject({ status, error });
		expect(result.isError).toBe(true);
		expect(result.content[0]).toMatchObject({
			type: "text",
			text: `[Delegation ${status}: ${error}]`,
		});
		expect(result.usage?.totalTokens).toBe(0);
	});
}

function successfulResult(): DelegationResult {
	return {
		content: [{ type: "text", text: "report" }],
		details: { status: "completed" },
		isError: false,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}

function pressureRegistration(
	run: typeof runDelegation,
	failInheritance = false,
) {
	const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
	const hooks = new Map<string, () => unknown>();
	const messages: unknown[] = [];
	let inheritanceReads = 0;
	registerDelegate(
		{
			registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
				tools.set(tool.name, tool),
			on: (name: string, hook: () => unknown) => {
				hooks.set(name, hook);
				return () => {};
			},
			getAllTools: () => {
				inheritanceReads++;
				if (failInheritance) throw new Error("inheritance must not run");
				return [];
			},
			getActiveTools: () => [],
			getCommands: () => [],
			sendMessage: (message: unknown) => {
				messages.push(message);
			},
		} as unknown as ExtensionAPI,
		run,
	);
	const tool = tools.get("delegate");
	if (!tool) throw new Error("Delegate not registered");
	const ctx = {
		...configurationContext,
		cwd: process.cwd(),
		mode: "rpc",
		isProjectTrusted: () => false,
		isIdle: () => true,
		hasPendingMessages: () => false,
	} as ExtensionToolContext;
	return {
		tool,
		tools,
		hooks,
		messages,
		ctx,
		inheritanceReads: () => inheritanceReads,
	};
}

const invalidPressureCases: [string, unknown, string][] = [
	["null policy", null, "pressure must be an object"],
	["null stage", { warning: null }, "pressure.warning"],
	[
		"null time",
		{ warning: { afterSeconds: null } },
		"pressure.warning.afterSeconds",
	],
	["zero turns", { urgent: { afterTurns: 0 } }, "pressure.urgent.afterTurns"],
	[
		"NaN time",
		{ warning: { afterSeconds: Number.NaN } },
		"pressure.warning.afterSeconds",
	],
	[
		"infinite time",
		{ urgent: { afterSeconds: Number.POSITIVE_INFINITY } },
		"pressure.urgent.afterSeconds",
	],
	[
		"fractional turns",
		{ warning: { afterTurns: 1.5 } },
		"pressure.warning.afterTurns",
	],
	["unknown shape", { urgent: { extra: 1 } }, "pressure.urgent.extra"],
	[
		"default time ordering",
		{ warning: { afterSeconds: 600 } },
		"pressure.urgent.afterSeconds",
	],
	[
		"default turn ordering",
		{ urgent: { afterTurns: 20 } },
		"pressure.urgent.afterTurns",
	],
];

for (const background of [false, true]) {
	for (const [name, pressure, error] of invalidPressureCases) {
		test(`public ${background ? "background" : "synchronous"} delegate rejects ${name} before inheritance or runner/acknowledgement`, async () => {
			let runs = 0;
			const registration = pressureRegistration(async () => {
				runs++;
				return successfulResult();
			}, true);
			try {
				const result = await registration.tool.execute(
					"invalid",
					{ task: "task", background, pressure },
					undefined,
					undefined,
					registration.ctx,
				);
				expect(result.details).toMatchObject({
					status: "failed",
					error: expect.stringContaining(error),
				});
				expect(result.isError).toBe(true);
				expect(result.usage?.totalTokens).toBe(0);
				expect(result.details).not.toHaveProperty("taskId");
				expect(registration.inheritanceReads()).toBe(0);
				expect(runs).toBe(0);
				expect(registration.messages).toEqual([]);
			} finally {
				await registration.hooks.get("session_shutdown")?.();
			}
		});
	}
}

async function waitFor(predicate: () => boolean) {
	const deadline = Date.now() + 3000;
	while (!predicate()) {
		if (Date.now() > deadline)
			throw new Error("Timed out waiting for controlled pressure fixture");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

for (const background of [false, true]) {
	for (const pressure of [
		undefined,
		{},
		{ warning: { afterSeconds: 360 }, urgent: { afterTurns: 45 } },
	] satisfies (PressureOverrides | undefined)[]) {
		test(`public ${background ? "background" : "synchronous"} path forwards resolved policy ${JSON.stringify(pressure)}`, async () => {
			const calls: DelegationOptions[] = [];
			const registration = pressureRegistration(async (options) => {
				calls.push(options);
				return successfulResult();
			});
			try {
				const result = await registration.tool.execute(
					"valid",
					{ task: "task", background, pressure },
					undefined,
					undefined,
					registration.ctx,
				);
				expect(result.details).toMatchObject({
					status: background ? "initializing" : "completed",
				});
				await waitFor(() => calls.length === 1);
				expect(calls[0].pressure).toEqual(resolvePressure(pressure));
				expect(calls[0].snapshot).toEqual({
					version: 1,
					tools: [],
					active: [],
				});
				expect(registration.inheritanceReads()).toBe(1);
				if (pressure) expect(calls[0].pressure).not.toBe(pressure);
			} finally {
				await registration.hooks.get("session_shutdown")?.();
			}
		});
	}
}

test("public synchronous/background invocation policies do not share mutable defaults or inputs", async () => {
	const calls: DelegationOptions[] = [];
	const registration = pressureRegistration(async (options) => {
		calls.push(options);
		return successfulResult();
	});
	const input = {
		warning: { afterSeconds: 360 },
		urgent: { afterTurns: 45 },
	} satisfies PressureOverrides;
	try {
		await registration.tool.execute(
			"sync",
			{ task: "task", pressure: input },
			undefined,
			undefined,
			registration.ctx,
		);
		await registration.tool.execute(
			"bg",
			{ task: "task", background: true },
			undefined,
			undefined,
			registration.ctx,
		);
		await waitFor(() => calls.length === 2);
		input.warning.afterSeconds = 1;
		expect(calls[0].pressure).toEqual({
			warning: { afterSeconds: 360, afterTurns: 20 },
			urgent: { afterSeconds: 600, afterTurns: 45 },
		});
		const first = calls[0].pressure;
		const second = calls[1].pressure;
		if (!first?.warning || !first.urgent || !second?.warning || !second.urgent)
			throw new Error("Runner did not receive fully resolved policies");
		first.warning.afterSeconds = 999;
		expect(second).toEqual(resolvePressure());
		expect(first.warning).not.toBe(second.warning);
		expect(first.urgent).not.toBe(second.urgent);
	} finally {
		await registration.hooks.get("session_shutdown")?.();
	}
});

test("the public schema includes pressure with the same type/shape as direct runner options", () => {
	const registration = pressureRegistration(async () => successfulResult());
	expect(registration.tool.parameters).toMatchObject({
		properties: { pressure: pressureParameters },
	});
	expectTypeOf<DelegationOptions["pressure"]>().toEqualTypeOf<
		PressureOverrides | undefined
	>();
	const validated = validateToolArguments(registration.tool, {
		type: "toolCall",
		id: "valid",
		name: "delegate",
		arguments: {
			task: "task",
			pressure: {
				warning: { afterSeconds: 0.125 },
				urgent: { afterTurns: 45 },
			},
		},
	});
	expect(validated.pressure).toEqual({
		warning: { afterSeconds: 0.125 },
		urgent: { afterTurns: 45 },
	});
});

for (const [path, pressure, label] of [
	["pressure", null, "null policy"],
	["pressure.warning", { warning: null }, "null stage"],
	[
		"pressure.warning.afterSeconds",
		{ warning: { afterSeconds: null } },
		"null time",
	],
	[
		"pressure.urgent.afterTurns",
		{ urgent: { afterTurns: null } },
		"null turns",
	],
	[
		"pressure.warning.afterSeconds",
		{ warning: { afterSeconds: "1" } },
		"string time",
	],
	[
		"pressure.warning.afterSeconds",
		{ warning: { afterSeconds: true } },
		"boolean time",
	],
	[
		"pressure.warning.afterTurns",
		{ warning: { afterTurns: true } },
		"boolean turns",
	],
] as const) {
	test(`public host validation must reject explicitly invalid ${label} at ${path} rather than silently default/coerce`, async () => {
		let runs = 0;
		const registration = pressureRegistration(async () => {
			runs++;
			return successfulResult();
		});
		try {
			// Exercise preparation + the cloning/coercing host validator + execute.
			// Every invalid pressure must retain the structured failed result contract.
			const rawArguments = { task: "task", pressure };
			const params = validateToolArguments(registration.tool, {
				type: "toolCall",
				id: "invalid",
				name: "delegate",
				arguments: (registration.tool.prepareArguments?.(rawArguments) ??
					rawArguments) as JsonObject,
			});
			expect(rawArguments).toEqual({ task: "task", pressure });
			const result = await registration.tool.execute(
				"null",
				params,
				undefined,
				undefined,
				registration.ctx,
			);
			expect(result.details).toMatchObject({
				status: "failed",
				error: expect.stringContaining(path),
			});
			expect(runs).toBe(0);
			expect(registration.inheritanceReads()).toBe(0);
		} finally {
			await registration.hooks.get("session_shutdown")?.();
		}
	});
}

test("prepared pressure errors survive cloning without mutating inputs, leaking between calls, or trusting caller diagnostics", async () => {
	let runs = 0;
	const registration = pressureRegistration(async () => {
		runs++;
		return successfulResult();
	});
	const prepareArguments = registration.tool.prepareArguments;
	if (!prepareArguments)
		throw new Error("Missing delegate argument preparation");
	const prepare = (args: JsonObject) =>
		validateToolArguments(registration.tool, {
			type: "toolCall",
			id: "prepared",
			name: "delegate",
			arguments: prepareArguments(args) as JsonObject,
		});
	const invalid = { task: "task", pressure: { warning: { afterSeconds: 0 } } };
	try {
		const bad = prepare(invalid);
		const good = prepare({
			task: "task",
			__piDelegatePressureError: "caller-injected",
		});
		const valid = await registration.tool.execute(
			"good",
			good,
			undefined,
			undefined,
			registration.ctx,
		);
		expect(valid.details).toMatchObject({ status: "completed" });
		const failed = await registration.tool.execute(
			"bad",
			bad,
			undefined,
			undefined,
			registration.ctx,
		);
		expect(failed.details).toMatchObject({
			status: "failed",
			error: expect.stringContaining("pressure.warning.afterSeconds"),
		});
		expect(failed.usage?.totalTokens).toBe(0);
		expect(invalid.pressure.warning.afterSeconds).toBe(0);
		expect(invalid).not.toHaveProperty("__piDelegatePressureError");
		expect(good).not.toHaveProperty("__piDelegatePressureError");
		expect(runs).toBe(1);
		expect(registration.inheritanceReads()).toBe(1);
	} finally {
		await registration.hooks.get("session_shutdown")?.();
	}
});

interface FixtureRecord {
	kind: string;
	type?: string;
	message?: string;
	pid?: number;
	snapshot?: string;
}

async function runnerProbe(
	action: (
		options: DelegationOptions,
		records: () => FixtureRecord[],
	) => Promise<void>,
	scenario = "turns",
) {
	const directory = await mkdtemp(join(tmpdir(), "delegate-pressure-probe-"));
	const log = join(directory, "commands.jsonl");
	const records = () =>
		existsSync(log)
			? readFileSync(log, "utf8")
					.trim()
					.split("\n")
					.filter(Boolean)
					.map((line) => JSON.parse(line) as FixtureRecord)
			: [];
	try {
		await action(
			{
				cwd: process.cwd(),
				args: [],
				snapshot: { version: 1, tools: [], active: [] },
				task: "controlled task",
				cliPath: resolve("tests/fixtures/pressure-rpc.mjs"),
				pressure: { warning: { afterTurns: 1 }, urgent: { afterTurns: 2 } },
				env: { PRESSURE_FIXTURE_SCENARIO: scenario, PRESSURE_FIXTURE_LOG: log },
			},
			records,
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

function assertRunnerCleaned(records: FixtureRecord[]) {
	const spawned = records.find((record) => record.kind === "spawn");
	if (!spawned?.snapshot || !spawned.pid)
		throw new Error("Missing pressure fixture spawn record");
	expect(existsSync(dirname(spawned.snapshot))).toBe(false);
	const pid = spawned.pid;
	expect(() => process.kill(pid, 0)).toThrow();
	expect(records.some((record) => record.kind === "shutdown")).toBe(true);
}

for (const [name, pressure, error] of invalidPressureCases) {
	test(`direct runner rejects ${name} before snapshot serialization or child spawn`, async () => {
		await runnerProbe(async (options, records) => {
			let snapshotReads = 0;
			let cliReads = 0;
			const result = await runDelegation({
				...options,
				pressure: pressure as PressureOverrides,
				get snapshot(): DelegationOptions["snapshot"] {
					snapshotReads++;
					throw new Error("snapshot must not be captured");
				},
				get cliPath(): string {
					cliReads++;
					throw new Error("child must not be spawned");
				},
			});
			expect(result.details).toMatchObject({
				status: "failed",
				error: expect.stringContaining(error),
			});
			expect(result.isError).toBe(true);
			expect(result.usage.totalTokens).toBe(0);
			expect(snapshotReads).toBe(0);
			expect(cliReads).toBe(0);
			expect(records()).toEqual([]);
		});
	});
}

for (const [scenario, status, stages] of [
	["turns", "completed", ["warning", "urgent"]],
	["timer", "completed", ["warning", "urgent"]],
	["settled-before-steer", "completed", []],
	["steer-failure", "failed", ["warning"]],
	["late-steer-failure", "completed", ["warning"]],
	["rpc-failure", "failed", []],
	["prompt-failure", "failed", []],
] as const) {
	test(`controlled runner ${scenario}: pressure respects settlement/failure and cleans subscription/signal/child resources`, async () => {
		const original = RpcProcess.prototype.subscribe;
		let unsubscribed = 0;
		const subscription = spyOn(
			RpcProcess.prototype,
			"subscribe",
		).mockImplementation(function (this: RpcProcess, listener) {
			const dispose = original.call(this, listener);
			return () => {
				unsubscribed++;
				dispose();
			};
		});
		const controller = new AbortController();
		const watchdog = setTimeout(() => controller.abort(), 3000);
		const added = spyOn(controller.signal, "addEventListener");
		const removed = spyOn(controller.signal, "removeEventListener");
		try {
			await runnerProbe(async (options, records) => {
				const result = await runDelegation({
					...options,
					signal: controller.signal,
					...(scenario === "timer"
						? {
								pressure: {
									warning: { afterSeconds: 0.01 },
									urgent: { afterSeconds: 0.02 },
								},
							}
						: {}),
				});
				expect(result.details.status).toBe(status);
				expect(result.isError).toBe(status === "failed");
				if (scenario === "steer-failure")
					expect(result.details.error).toContain(
						"Subagent pressure delivery failed: fixture steer refused",
					);
				else if (scenario === "rpc-failure")
					expect(result.details.error).toContain("Invalid JSONL");
				else if (scenario === "prompt-failure")
					expect(result.details.error).toContain("fixture prompt refused");
				else {
					expect(result.details.stopReason).toBe("stop");
					expect(result.content[0].text).toBe(
						"Report: unfinished work and blockers remain.",
					);
					expect(result.usage.totalTokens).toBe(3);
				}
				const commands = records().filter(
					(record) => record.kind === "command",
				);
				const steers = commands.filter((record) => record.type === "steer");
				expect(
					steers.map(
						(record) =>
							/pressure: (warning|urgent)/.exec(record.message ?? "")?.[1],
					),
				).toEqual([...stages]);
				const taskPrompt = commands.findIndex(
					(record) =>
						record.type === "prompt" && record.message?.startsWith("Task:"),
				);
				expect(taskPrompt).toBeGreaterThan(0);
				expect(
					commands
						.slice(0, taskPrompt)
						.some((record) => record.type === "steer"),
				).toBe(false);
				expect(subscription).toHaveBeenCalledTimes(1);
				expect(unsubscribed).toBe(1);
				for (const [type, listener] of added.mock.calls) {
					if (type === "abort")
						expect(
							removed.mock.calls.some(
								([event, removedListener]) =>
									event === type && removedListener === listener,
							),
						).toBe(true);
				}
				assertRunnerCleaned(records());
			}, scenario);
		} finally {
			clearTimeout(watchdog);
			controller.abort();
			subscription.mockRestore();
			added.mockRestore();
			removed.mockRestore();
		}
	});
}

test("direct runner abort after actual task start disposes pressure/subscription before child cleanup", async () => {
	const original = RpcProcess.prototype.subscribe;
	let unsubscribed = 0;
	const subscription = spyOn(
		RpcProcess.prototype,
		"subscribe",
	).mockImplementation(function (this: RpcProcess, listener) {
		const dispose = original.call(this, listener);
		return () => {
			unsubscribed++;
			dispose();
		};
	});
	try {
		await runnerProbe(async (options, records) => {
			const controller = new AbortController();
			const removed = spyOn(controller.signal, "removeEventListener");
			const operation = runDelegation({
				...options,
				pressure: undefined,
				signal: controller.signal,
			});
			try {
				await waitFor(() =>
					records().some((record) => record.kind === "task-started"),
				);
				controller.abort();
				const result = await operation;
				expect(result.details.status).toBe("cancelled");
				expect(result.isError).toBe(true);
				expect(records().filter((record) => record.type === "steer")).toEqual(
					[],
				);
				expect(subscription).toHaveBeenCalledTimes(1);
				expect(unsubscribed).toBe(1);
				expect(
					removed.mock.calls.filter(([event]) => event === "abort"),
				).toHaveLength(3);
				assertRunnerCleaned(records());
			} finally {
				controller.abort();
				await operation;
				removed.mockRestore();
			}
		}, "abort-held");
	} finally {
		subscription.mockRestore();
	}
});
