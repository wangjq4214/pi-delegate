import { afterEach, describe, expect, expectTypeOf, test } from "bun:test";
import type { Static } from "@earendil-works/pi-ai";
import { Value } from "typebox/value";
import {
	type PressureClock,
	type PressureOverrides,
	type PressurePolicy,
	pressureParameters,
	resolvePressure,
	TaskPressure,
} from "../src/pressure.ts";

const defaults: PressurePolicy = {
	warning: { afterSeconds: 300, afterTurns: 20 },
	urgent: { afterSeconds: 600, afterTurns: 40 },
};

class FakeClock implements PressureClock {
	seconds = 0;
	readonly delays: number[] = [];
	private sequence = 0;
	private timers = new Map<number, { at: number; callback: () => void }>();

	now = () => this.seconds;
	schedule = (callback: () => void, delayMs: number) => {
		if (!Number.isFinite(delayMs) || delayMs < 1 || delayMs > 2_147_483_647)
			throw new Error(`Unsafe timer delay: ${delayMs}`);
		this.delays.push(delayMs);
		const id = ++this.sequence;
		this.timers.set(id, { at: this.seconds + delayMs / 1000, callback });
		return () => {
			this.timers.delete(id);
		};
	};

	get pending() {
		return this.timers.size;
	}

	get nextCallback() {
		const next = [...this.timers.values()].sort((a, b) => a.at - b.at)[0];
		if (!next) throw new Error("No timer scheduled");
		return next.callback;
	}

	advanceTo(target: number) {
		if (target < this.seconds) throw new Error("Fake clock must be monotonic");
		let ticks = 0;
		while (true) {
			const next = [...this.timers.entries()]
				.filter(([, timer]) => timer.at <= target)
				.sort(([, a], [, b]) => a.at - b.at)[0];
			if (!next) break;
			if (++ticks > 1000) throw new Error("Runaway pressure timer");
			this.timers.delete(next[0]);
			this.seconds = next[1].at;
			next[1].callback();
		}
		this.seconds = target;
	}
}

function deferred() {
	let resolve!: () => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<void>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

// Steering is deliberately serialized through promises. Drain that queue without real sleeps.
async function flushSteering() {
	for (let i = 0; i < 20; i++) await Promise.resolve();
}

const monitors = new Set<TaskPressure>();
afterEach(() => {
	for (const monitor of monitors) monitor.dispose();
	monitors.clear();
});

function harness(
	policy = resolvePressure(),
	steer?: (message: string) => Promise<unknown>,
) {
	const clock = new FakeClock();
	const messages: string[] = [];
	const monitor = new TaskPressure(
		policy,
		async (message) => {
			messages.push(message);
			return steer?.(message);
		},
		clock,
	);
	monitors.add(monitor);
	return { clock, messages, monitor };
}

function turns(monitor: TaskPressure, count: number) {
	for (let i = 0; i < count; i++) monitor.observe({ type: "turn_end" });
}

function expectStages(messages: string[], stages: string[]) {
	expect(
		messages.map((message) => /pressure: (warning|urgent)/.exec(message)?.[1]),
	).toEqual(stages);
}

function expectReminderIntent(messages: string[]) {
	expect(messages[0]).toMatch(/core goal/i);
	expect(messages[0]).toMatch(/scope/i);
	expect(messages[0]).toMatch(/report/i);
	expect(messages[1]).toMatch(/end exploration/i);
	expect(messages[1]).toMatch(/report/i);
	expect(messages[1]).toMatch(/unfinished work/i);
	expect(messages[1]).toMatch(/blockers/i);
}

describe("pressure policy", () => {
	test("omitted policy, empty stages and undefined fields independently use all four defaults", () => {
		for (const input of [
			undefined,
			{},
			{ warning: {} },
			{ urgent: {} },
			{
				warning: { afterSeconds: undefined },
				urgent: { afterTurns: undefined },
			},
		])
			expect(resolvePressure(input)).toEqual(defaults);
	});

	for (const [name, input, expected] of [
		[
			"warning time",
			{ warning: { afterSeconds: 360 } },
			{ ...defaults, warning: { afterSeconds: 360, afterTurns: 20 } },
		],
		[
			"warning turns",
			{ warning: { afterTurns: 25 } },
			{ ...defaults, warning: { afterSeconds: 300, afterTurns: 25 } },
		],
		[
			"urgent time",
			{ urgent: { afterSeconds: 900 } },
			{ ...defaults, urgent: { afterSeconds: 900, afterTurns: 40 } },
		],
		[
			"urgent turns",
			{ urgent: { afterTurns: 45 } },
			{ ...defaults, urgent: { afterSeconds: 600, afterTurns: 45 } },
		],
		[
			"mixed overrides",
			{ warning: { afterSeconds: 360 }, urgent: { afterTurns: 45 } },
			{
				warning: { afterSeconds: 360, afterTurns: 20 },
				urgent: { afterSeconds: 600, afterTurns: 45 },
			},
		],
	] as const) {
		test(`${name} preserves every omitted value`, () => {
			expect(resolvePressure(input)).toEqual(expected);
		});
	}

	test("resolution neither mutates inputs nor shares stage objects between invocations", () => {
		const input = Object.freeze({
			warning: Object.freeze({ afterSeconds: 360 }),
		});
		const first = resolvePressure(input);
		const second = resolvePressure(input);
		const omitted = resolvePressure();
		expect(first).not.toBe(second);
		expect(first.warning).not.toBe(second.warning);
		expect(first.urgent).not.toBe(second.urgent);
		first.warning.afterSeconds = 1;
		first.urgent.afterTurns = 99;
		expect(second).toEqual({
			warning: { afterSeconds: 360, afterTurns: 20 },
			urgent: defaults.urgent,
		});
		expect(omitted).toEqual(defaults);
		expect(input.warning.afterSeconds).toBe(360);
	});

	test("positive finite fractional and huge times and positive integer turns are accepted unchanged", () => {
		for (const time of [Number.MIN_VALUE, 0.125, 1]) {
			expect(
				resolvePressure({ warning: { afterSeconds: time } }).warning
					.afterSeconds,
			).toBe(time);
		}
		const input = {
			warning: { afterSeconds: Number.MAX_VALUE / 2, afterTurns: 1 },
			urgent: {
				afterSeconds: Number.MAX_VALUE,
				afterTurns: Number.MAX_SAFE_INTEGER,
			},
		} satisfies PressureOverrides;
		expect(resolvePressure(input)).toEqual(input);
	});

	for (const stage of ["warning", "urgent"] as const) {
		for (const field of ["afterSeconds", "afterTurns"] as const) {
			const invalid = [
				null,
				0,
				-1,
				Number.NaN,
				Number.POSITIVE_INFINITY,
				Number.NEGATIVE_INFINITY,
				"1",
				true,
				{},
				[],
			];
			if (field === "afterTurns") invalid.push(0.5);
			for (const value of invalid) {
				test(`rejects ${stage}.${field} = ${JSON.stringify(value)} (${String(value)}) rather than falling back`, () => {
					expect(() =>
						resolvePressure({ [stage]: { [field]: value } }),
					).toThrow(
						`pressure.${stage}.${field} must be a positive ${field === "afterTurns" ? "integer" : "finite number"}`,
					);
				});
			}
		}
	}

	for (const [name, input, error] of [
		["top-level null", null, "pressure must be an object"],
		["top-level number", 0, "pressure must be an object"],
		["top-level array", [], "pressure must be an object"],
		["top-level boolean", false, "pressure must be an object"],
		["top-level string", "", "pressure must be an object"],
		["unknown stage", { critical: {} }, "pressure.critical"],
		["null stage", { warning: null }, "pressure.warning must be an object"],
		["array stage", { urgent: [] }, "pressure.urgent must be an object"],
		["scalar stage", { urgent: 1 }, "pressure.urgent must be an object"],
		[
			"unknown nested key",
			{ warning: { afterMilliseconds: 1 } },
			"pressure.warning.afterMilliseconds",
		],
		[
			"unknown urgent key",
			{ urgent: { disabled: true } },
			"pressure.urgent.disabled",
		],
		[
			"nested value object",
			{ warning: { afterSeconds: { value: 1 } } },
			"pressure.warning.afterSeconds",
		],
	] as const) {
		test(`rejects invalid shape: ${name}`, () => {
			expect(() => resolvePressure(input)).toThrow(error);
		});
	}

	for (const [input, field] of [
		[{ warning: { afterSeconds: 600 } }, "afterSeconds"],
		[{ warning: { afterSeconds: 601 } }, "afterSeconds"],
		[{ urgent: { afterSeconds: 300 } }, "afterSeconds"],
		[{ urgent: { afterSeconds: 299 } }, "afterSeconds"],
		[{ warning: { afterTurns: 40 } }, "afterTurns"],
		[{ warning: { afterTurns: 41 } }, "afterTurns"],
		[{ urgent: { afterTurns: 20 } }, "afterTurns"],
		[{ urgent: { afterTurns: 19 } }, "afterTurns"],
		[
			{ warning: { afterSeconds: 1 }, urgent: { afterSeconds: 1 } },
			"afterSeconds",
		],
		[{ warning: { afterTurns: 2 }, urgent: { afterTurns: 1 } }, "afterTurns"],
	] as const) {
		test(`rejects contradictory ${field} after default resolution: ${JSON.stringify(input)}`, () => {
			const before = structuredClone(input);
			expect(() => resolvePressure(input)).toThrow(
				`pressure.urgent.${field} must exceed pressure.warning.${field} after applying defaults`,
			);
			expect(input).toEqual(before);
		});
	}

	test("schema static type matches overrides; schema enforces scalar and nested-shape constraints", () => {
		expectTypeOf<
			Static<typeof pressureParameters>
		>().toEqualTypeOf<PressureOverrides>();
		for (const input of [
			{},
			{ warning: {} },
			{ warning: { afterSeconds: 0.125 }, urgent: { afterTurns: 45 } },
			defaults,
		]) {
			expect(Value.Check(pressureParameters, input)).toBe(true);
		}
		for (const input of [
			[],
			{ critical: {} },
			{ warning: [] },
			{ warning: { extra: 1 } },
			{ warning: { afterSeconds: 0 } },
			{ warning: { afterSeconds: Number.NaN } },
			{ urgent: { afterSeconds: Number.POSITIVE_INFINITY } },
			{ warning: { afterTurns: 0.5 } },
			{ urgent: { afterTurns: -1 } },
			{ warning: { afterSeconds: "1" } },
		])
			expect(Value.Check(pressureParameters, input)).toBe(false);
		// Cross-stage/default-dependent ordering belongs to resolvePressure, not JSON Schema.
		expect(
			Value.Check(pressureParameters, { urgent: { afterSeconds: 1 } }),
		).toBe(true);
		expect(() => resolvePressure({ urgent: { afterSeconds: 1 } })).toThrow(
			"after applying defaults",
		);
	});
});

describe("task pressure", () => {
	test("the default constructor arms the real monotonic clock without parameter-shadowing failure", () => {
		const monitor = new TaskPressure(resolvePressure(), async () => {});
		monitors.add(monitor);
		expect(() => monitor.observe({ type: "agent_start" })).not.toThrow();
		monitor.dispose();
	});

	test("full default 300/600-second deadlines are inclusive, independent of turns and once-only", async () => {
		const { clock, messages, monitor } = harness();
		clock.seconds = 7000;
		monitor.observe({ type: "agent_start" });
		clock.advanceTo(7299.999);
		await flushSteering();
		expect(messages).toEqual([]);
		clock.advanceTo(7300);
		await flushSteering();
		expectStages(messages, ["warning"]);
		clock.advanceTo(7599.999);
		await flushSteering();
		expectStages(messages, ["warning"]);
		clock.advanceTo(7600);
		await flushSteering();
		expectStages(messages, ["warning", "urgent"]);
		expectReminderIntent(messages);
		clock.advanceTo(17000);
		turns(monitor, 100);
		await flushSteering();
		expectStages(messages, ["warning", "urgent"]);
		expect(clock.pending).toBe(0);
	});

	test("full default 20/40-turn thresholds fire before time and not at 19/39", async () => {
		const { clock, messages, monitor } = harness();
		monitor.observe({ type: "agent_start" });
		clock.advanceTo(1);
		turns(monitor, 19);
		await flushSteering();
		expect(messages).toEqual([]);
		turns(monitor, 1);
		await flushSteering();
		expectStages(messages, ["warning"]);
		turns(monitor, 19);
		await flushSteering();
		expectStages(messages, ["warning"]);
		turns(monitor, 1);
		await flushSteering();
		expectStages(messages, ["warning", "urgent"]);
		expectReminderIntent(messages);
		expect(clock.pending).toBe(0);
	});

	test("partial custom deadlines retain urgent time fallback and independent task state", async () => {
		const custom = harness(
			resolvePressure({
				warning: { afterSeconds: 360 },
				urgent: { afterTurns: 45 },
			}),
		);
		const other = harness();
		for (const task of [custom, other])
			task.monitor.observe({ type: "agent_start" });
		custom.clock.advanceTo(300);
		other.clock.advanceTo(300);
		await flushSteering();
		expect(custom.messages).toEqual([]);
		expectStages(other.messages, ["warning"]);
		custom.clock.advanceTo(360);
		await flushSteering();
		expectStages(custom.messages, ["warning"]);
		custom.clock.advanceTo(600);
		await flushSteering();
		expectStages(custom.messages, ["warning", "urgent"]);
		expectStages(other.messages, ["warning"]);
	});

	test("custom turn thresholds preserve omitted warning turns and urgent override", async () => {
		const { monitor, messages } = harness(
			resolvePressure({
				warning: { afterSeconds: 360 },
				urgent: { afterTurns: 45 },
			}),
		);
		monitor.observe({ type: "agent_start" });
		turns(monitor, 20);
		await flushSteering();
		expectStages(messages, ["warning"]);
		turns(monitor, 24);
		await flushSteering();
		expectStages(messages, ["warning"]);
		turns(monitor, 1);
		await flushSteering();
		expectStages(messages, ["warning", "urgent"]);
	});

	for (const order of [
		"time first",
		"turn first",
		"same observation",
	] as const) {
		test(`time/turn overlap dedupes both stages with pending steering: ${order}`, async () => {
			const held = deferred();
			const { monitor, messages, clock } = harness(
				resolvePressure(),
				() => held.promise,
			);
			monitor.observe({ type: "agent_start" });
			const alreadyDispatchedTimer = clock.nextCallback;
			if (order === "time first") {
				clock.advanceTo(600);
				turns(monitor, 40);
			} else if (order === "turn first") {
				turns(monitor, 40);
				clock.advanceTo(600);
			} else {
				turns(monitor, 19);
				clock.seconds = 300;
				turns(monitor, 1);
				turns(monitor, 19);
				clock.seconds = 600;
				turns(monitor, 1);
			}
			alreadyDispatchedTimer();
			turns(monitor, 100);
			await flushSteering();
			expectStages(messages, ["warning"]);
			held.resolve();
			await flushSteering();
			expectStages(messages, ["warning", "urgent"]);
			expect(clock.pending).toBe(0);
		});
	}

	test("time overshoot >= crosses both OR thresholds without any completed turns", async () => {
		const { clock, messages, monitor } = harness();
		monitor.observe({ type: "agent_start" });
		clock.seconds = 601;
		monitor.observe({ type: "agent_start" });
		await flushSteering();
		expectStages(messages, ["warning", "urgent"]);
	});

	test("pre-start initialization/waiting events neither count turns nor start time", async () => {
		const { clock, messages, monitor } = harness();
		turns(monitor, 100);
		monitor.observe({ type: "message_end" });
		monitor.observe({ type: "tool_execution_end" });
		clock.advanceTo(10000);
		await flushSteering();
		expect(messages).toEqual([]);
		expect(clock.pending).toBe(0);
		monitor.observe({ type: "agent_start" });
		turns(monitor, 19);
		clock.advanceTo(10299.999);
		await flushSteering();
		expect(messages).toEqual([]);
		clock.advanceTo(10300);
		await flushSteering();
		expectStages(messages, ["warning"]);
	});

	test("streaming, message completion, individual/parallel/nested tools are not completed turns", async () => {
		const { monitor, messages } = harness();
		monitor.observe({ type: "agent_start" });
		turns(monitor, 19);
		for (let i = 0; i < 50; i++) {
			for (const type of [
				"turn_start",
				"message_start",
				"message_update",
				"message_end",
				"tool_execution_start",
				"tool_execution_update",
				"tool_execution_end",
				"extension_ui_request",
				"response",
				"custom",
			]) {
				monitor.observe({
					type,
					event: { type: "turn_end" },
					tools: [{ type: "turn_end" }, { nested: { type: "turn_end" } }],
				});
			}
		}
		await flushSteering();
		expect(messages).toEqual([]);
		turns(monitor, 1);
		await flushSteering();
		expectStages(messages, ["warning"]);
	});

	test("recovery agent_start preserves elapsed time, completed turns and issued stages", async () => {
		const { monitor, messages, clock } = harness();
		monitor.observe({ type: "agent_start" });
		turns(monitor, 19);
		clock.advanceTo(299);
		monitor.observe({ type: "agent_start" });
		turns(monitor, 1);
		await flushSteering();
		expectStages(messages, ["warning"]);
		clock.advanceTo(599);
		monitor.observe({ type: "agent_start" });
		clock.advanceTo(600);
		await flushSteering();
		expectStages(messages, ["warning", "urgent"]);
	});

	test("agent_end is not settlement: waiting/recovery still receives timed pressure", async () => {
		const { monitor, messages, clock } = harness();
		monitor.observe({ type: "agent_start" });
		monitor.observe({ type: "agent_end" });
		expect(clock.pending).toBe(1);
		clock.advanceTo(300);
		await flushSteering();
		expectStages(messages, ["warning"]);
		monitor.observe({ type: "agent_end" });
		clock.advanceTo(600);
		await flushSteering();
		expectStages(messages, ["warning", "urgent"]);
	});

	for (const boundary of [
		"agent_settled",
		"rpc_failure",
		"abort",
		"cleanup",
	] as const) {
		test(`${boundary} disposal cancels timers, ignores stale callbacks and subsequent records`, async () => {
			const { monitor, messages, clock } = harness();
			const signal = new AbortController();
			signal.signal.addEventListener("abort", monitor.dispose, { once: true });
			monitor.observe({ type: "agent_start" });
			const staleWakeup = clock.nextCallback;
			if (boundary === "abort") signal.abort();
			else if (boundary === "cleanup") monitor.dispose();
			else
				monitor.observe({
					type: boundary,
					error: new Error("transport stopped"),
				});
			monitor.dispose(); // Disposal is idempotent even after a terminal event.
			expect(clock.pending).toBe(0);
			clock.advanceTo(10000);
			staleWakeup();
			monitor.observe({ type: "agent_start" });
			turns(monitor, 100);
			await flushSteering();
			expect(messages).toEqual([]);
			expect(clock.pending).toBe(0);
			signal.signal.removeEventListener("abort", monitor.dispose);
		});
	}

	test("disposal before the steering microtask prevents even the first unsent stage", async () => {
		const { monitor, messages, clock } = harness();
		monitor.observe({ type: "agent_start" });
		turns(monitor, 40);
		monitor.observe({ type: "agent_settled" });
		await flushSteering();
		expect(messages).toEqual([]);
		expect(clock.pending).toBe(0);
	});

	test("disposal while warning is in flight prevents the queued unsent urgent stage", async () => {
		const held = deferred();
		const { monitor, messages } = harness(
			resolvePressure(),
			() => held.promise,
		);
		monitor.observe({ type: "agent_start" });
		turns(monitor, 40);
		await flushSteering();
		expectStages(messages, ["warning"]);
		monitor.dispose();
		held.resolve();
		await flushSteering();
		expectStages(messages, ["warning"]);
	});

	for (const error of [new Error("steer refused"), "steer refused"]) {
		test(`observed steering failure rejects failure and stops queued pressure (${typeof error})`, async () => {
			const { monitor, messages, clock } = harness(
				resolvePressure(),
				async () => {
					throw error;
				},
			);
			monitor.observe({ type: "agent_start" });
			turns(monitor, 40);
			await expect(monitor.failure).rejects.toThrow(
				"Subagent pressure delivery failed: steer refused",
			);
			expect(clock.pending).toBe(0);
			clock.advanceTo(10000);
			turns(monitor, 100);
			await flushSteering();
			expectStages(messages, ["warning"]);
		});
	}

	test("late steering rejection after settlement is consumed without changing the disposed outcome", async () => {
		const held = deferred();
		const { monitor, messages, clock } = harness(
			resolvePressure(),
			() => held.promise,
		);
		let failure: unknown;
		void monitor.failure.catch((error: unknown) => {
			failure = error;
		});
		monitor.observe({ type: "agent_start" });
		turns(monitor, 40);
		await flushSteering();
		monitor.observe({ type: "agent_settled" });
		held.reject(new Error("late steer refusal"));
		await flushSteering();
		expect(failure).toBeUndefined();
		expectStages(messages, ["warning"]);
		expect(clock.pending).toBe(0);
	});

	test("huge finite budgets use bounded timer waits without clamping the budget or overflowing milliseconds", async () => {
		const { monitor, messages, clock } = harness(
			resolvePressure({
				warning: { afterSeconds: Number.MAX_VALUE / 2 },
				urgent: { afterSeconds: Number.MAX_VALUE },
			}),
		);
		monitor.observe({ type: "agent_start" });
		expect(clock.delays).toEqual([2_147_483_647]);
		clock.advanceTo(2 * 2_147_483.647);
		await flushSteering();
		expect(messages).toEqual([]);
		expect(clock.delays).toEqual([2_147_483_647, 2_147_483_647, 2_147_483_647]);
		clock.seconds = Number.MAX_VALUE;
		monitor.observe({ type: "agent_start" });
		await flushSteering();
		expectStages(messages, ["warning", "urgent"]);
		expect(clock.pending).toBe(0);
	});

	test("fractional deadlines do not fire early, and sub-millisecond budgets never schedule zero or overflowing waits", async () => {
		const fractional = harness(
			resolvePressure({
				warning: { afterSeconds: 0.125 },
				urgent: { afterSeconds: 0.375 },
			}),
		);
		fractional.monitor.observe({ type: "agent_start" });
		fractional.clock.advanceTo(0.124);
		await flushSteering();
		expect(fractional.messages).toEqual([]);
		fractional.clock.advanceTo(0.125);
		await flushSteering();
		expectStages(fractional.messages, ["warning"]);
		fractional.clock.advanceTo(0.375);
		await flushSteering();
		expectStages(fractional.messages, ["warning", "urgent"]);

		const tiny = harness(
			resolvePressure({
				warning: { afterSeconds: Number.MIN_VALUE },
				urgent: { afterSeconds: 0.0015 },
			}),
		);
		tiny.monitor.observe({ type: "agent_start" });
		tiny.clock.advanceTo(0.000999);
		await flushSteering();
		expect(tiny.messages).toEqual([]);
		tiny.clock.advanceTo(0.001);
		await flushSteering();
		expectStages(tiny.messages, ["warning"]);
		tiny.clock.advanceTo(0.002);
		await flushSteering();
		expectStages(tiny.messages, ["warning", "urgent"]);
		expect(tiny.clock.delays).toEqual([1, 1]);
	});
});
