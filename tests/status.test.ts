import { expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { PressureClock } from "../src/pressure.ts";
import { AgentStatus } from "../src/status.ts";

class Clock implements PressureClock {
	seconds = 0;
	jobs = new Set<{ at: number; callback: () => void }>();
	now = () => this.seconds;
	schedule = (callback: () => void, ms: number) => {
		const job = { at: this.seconds + ms / 1000, callback };
		this.jobs.add(job);
		return () => {
			this.jobs.delete(job);
		};
	};
	advance(seconds: number) {
		const end = this.seconds + seconds;
		while (true) {
			const job = [...this.jobs].sort((a, b) => a.at - b.at)[0];
			if (!job || job.at > end) break;
			this.seconds = job.at;
			this.jobs.delete(job);
			job.callback();
		}
		this.seconds = end;
	}
}
function setup() {
	const time = new Clock();
	let renders = 0;
	const status = new AgentStatus(time);
	status.bind({
		mode: "tui",
		ui: {
			setWidget: (_key, factory) => {
				if (typeof factory === "function")
					factory({ requestRender: () => renders++ } as never, {} as never);
			},
		} as ExtensionContext["ui"],
	});
	return {
		status,
		time,
		text: () => status.render(200).join("\n"),
		renders: () => renders,
	};
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Missing fixture value");
	return value;
}

test("actual onset excludes initialization; waits progress, turns and activity are current and content-free", () => {
	const { status, time, text, renders } = setup();
	const one = required(status.add("first line\nSECRET CONTEXT"));
	status.add("fallback", "parent title");
	time.advance(20);
	one.observe({ type: "turn_end" });
	one.observe({
		type: "message_update",
		assistantMessageEvent: { type: "thinking_delta", delta: "SECRET THOUGHT" },
	});
	expect(text()).toContain("0s · 0 turns · pressure: none");
	expect(text()).not.toContain("thinking…");
	one.observe({ type: "agent_start" });
	time.advance(2);
	expect(text()).toContain("2s · 0 turns");
	expect(renders()).toBeGreaterThan(2);
	one.observe({
		type: "message_update",
		assistantMessageEvent: { type: "thinking_start" },
	});
	expect(text()).toContain("thinking…");
	one.observe({ type: "message_end" });
	expect(text()).not.toContain("thinking…");
	for (const [id, name] of [
		["a", "read"],
		["b", "bash"],
		["a/1", "nested"],
	])
		one.observe({
			type: "tool_execution_start",
			toolCallId: id,
			toolName: name,
			args: { secret: "SECRET ARGS" },
		});
	expect(text()).toContain("toolcall · nested");
	one.observe({
		type: "tool_execution_end",
		toolCallId: "a/1",
		result: "SECRET RESULT",
	});
	expect(text()).toContain("toolcall · bash");
	one.observe({ type: "tool_execution_end", toolCallId: "b" });
	expect(text()).toContain("toolcall · read");
	expect(text()).toContain("0 turns");
	one.observe({ type: "tool_execution_end", toolCallId: "a" });
	expect(text()).not.toContain("toolcall");
	one.observe({ type: "turn_end" });
	expect(text()).toContain("1 turn ·");
	one.observe({ type: "turn_end" });
	expect(text()).toContain("2 turns ·");
	expect(text()).not.toContain("SECRET");
	expect(text()).toContain("2  parent title");
	status.clear();
	expect(time.jobs.size).toBe(0);
});

test("acknowledged pressure is monotone, independent and invalidated with old callbacks", () => {
	const { status, time, text } = setup();
	const one = required(status.add("first"));
	const two = required(status.add("second"));
	one.accepted("warning");
	one.accepted("urgent");
	one.accepted("warning");
	expect(status.render(200)[1]).toContain("pressure: urgent");
	expect(status.render(200)[5]).toContain("pressure: none");
	const oldTimer = required([...time.jobs][0]).callback;
	status.clear();
	const three = required(status.add("third"));
	one.observe({ type: "agent_start" });
	two.accepted("urgent");
	one.finish("failed");
	oldTimer();
	expect(text()).toContain("3  third");
	expect(text()).not.toContain("first");
	expect(text()).not.toContain("urgent");
	status.bind({ mode: "rpc", ui: {} as ExtensionContext["ui"] });
	three.accepted("warning");
	expect(status.add("non-terminal")).toBeUndefined();
	expect(text()).toBe("");
	expect(time.jobs.size).toBe(0);
	status.bind({
		mode: "tui",
		ui: { setWidget() {} } as unknown as ExtensionContext["ui"],
	});
	status.add("replacement");
	one.accepted("urgent");
	expect(text()).toContain("1  replacement");
	expect(text()).not.toContain("pressure: urgent");
	status.close();
	expect(status.add("after shutdown")).toBeUndefined();
	expect(text()).toBe("");
	expect(time.jobs.size).toBe(0);
});

for (const outcome of [
	"completed",
	"incomplete",
	"failed",
	"cancelled",
] as const) {
	test(`${outcome} freezes on settlement and expires at exactly five seconds without reusing identity`, () => {
		const { status, time, text } = setup();
		const one = required(status.add("task"));
		one.observe({ type: "agent_start" });
		time.advance(3);
		one.observe({ type: "turn_end" });
		one.observe({ type: "agent_settled" });
		time.advance(10);
		one.observe({ type: "agent_start" });
		one.observe({ type: "turn_end" });
		one.finish(outcome);
		expect(text()).toContain(`└─ ${outcome}`);
		expect(text()).toContain("3s · 1 turn");
		time.advance(4.999);
		expect(text()).toContain(outcome);
		time.advance(0.001);
		expect(text()).toBe("");
		status.add("next");
		expect(text()).toContain("2  next");
		status.clear();
	});
}

test("narrow/wide Unicode and control/ANSI metadata cannot expose hidden lines or manipulate rendering", () => {
	const { status, text } = setup();
	status.add("fallback\nHIDDEN", "\x1b[31m宽👩‍💻 é\x1b[0m\t title\nHIDDEN");
	for (const width of [1, 2, 8, 20, 80, 160]) {
		for (const line of status.render(width))
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
	}
	expect(text()).not.toContain("\x1b");
	expect(text()).not.toContain("HIDDEN");
	expect(status.render(1)[1]?.startsWith("1")).toBe(true);
	expect(status.render(80)[1]).toContain("pressure: none");
	expect(status.render(50)[1]).toContain("0 turns · pressure: none");
	status.clear();
});

test("confirmed configuration expires with terminal rows and old callbacks cannot restore it", () => {
	const { status, time, text } = setup();
	const row = required(status.add("configured"));
	const configuration = {
		model: { provider: "provider", id: "exact/id:variant" },
		thinkingLevel: "low" as const,
	};
	row.configured?.(configuration);
	configuration.model.id = "caller mutated";
	expect(text()).toContain("provider/exact/id:variant");
	row.finish("completed");
	time.advance(4.999);
	expect(text()).toContain("thinking: low");
	time.advance(0.001);
	expect(text()).toBe("");
	row.configured?.(configuration);
	expect(text()).toBe("");
	const old = required(status.add("old scope"));
	status.clear(true);
	old.configured?.(configuration);
	expect(text()).toBe("");
	const failed = required(status.add("failed before confirmation"));
	failed.finish("failed");
	failed.configured?.(configuration);
	expect(text()).toContain("model: unconfirmed");
	expect(text()).not.toContain("thinking: low");
	status.close();
});

test("capacity and delegated total survive row expiry and branch clearing without reviving old rows", () => {
	const { status, time, text } = setup();
	status.capacity({ occupied: 1, queued: 2, maximum: 4 });
	const row = required(status.add("consumed"));
	const usage = {
		input: 8200,
		output: 1100,
		cacheRead: 20000,
		cacheWrite: 0,
		totalTokens: 29300,
		cost: {
			input: 0.01,
			output: 0.03,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0.04,
		},
	};
	row.phase?.("queued");
	expect(text()).toContain("└─ queued");
	time.advance(30);
	expect(text()).toContain("0s · 0 turns");
	row.usage?.(usage);
	status.total(usage);
	expect(text()).toContain("active: 1/4 · queued: 2");
	expect(text()).toContain("│  ↑8.2k ↓1.1k R20k W0 · $0.04");
	row.finish("cancelled");
	time.advance(5);
	expect(text()).not.toContain("consumed");
	expect(text()).toContain("Delegated total · ↑8.2k");
	status.clear();
	row.usage?.({ ...usage, input: 1000000 });
	expect(text()).not.toContain("1000k");
	expect(text()).toContain("Delegated total · ↑8.2k");
	for (const width of [1, 2, 8, 20, 80, 200])
		for (const line of status.render(width))
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
	status.close();
	expect(text()).toBe("");
});
