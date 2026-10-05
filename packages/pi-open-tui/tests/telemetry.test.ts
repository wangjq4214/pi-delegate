import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	AssistantMessageComponent,
	type ExtensionAPI,
	type ExtensionContext,
	type MessageUpdateEvent,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { ScrollView, Text } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { OpenTuiEditor } from "../src/editor.ts";
import { stripAnsi } from "../src/utils.ts";
import openTui from "../src/index.ts";
import { formatTurnTelemetry, TurnTelemetryTracker } from "../src/telemetry.ts";

const theme = {
	fg: (_color: string, text: string) => text,
} as Theme;

function makeMessage(output = 20, input = 50, cacheWrite = 0, cacheRead = 0): AssistantMessage {
	const totalTokens = input + output + cacheWrite + cacheRead;
	return {
		role: "assistant",
		content: [{ type: "text", text: "response" }],
		api: "openai-completions",
		provider: "openai",
		model: "gpt-4",
		usage: {
			input,
			output,
			cacheRead,
			cacheWrite,
			totalTokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: totalTokens * 0.000004 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function update(
	message: AssistantMessage,
	assistantMessageEvent: MessageUpdateEvent["assistantMessageEvent"] = {
		type: "text_delta",
		contentIndex: 0,
		delta: "x",
		partial: message,
	},
): MessageUpdateEvent {
	return {
		type: "message_update",
		message,
		assistantMessageEvent,
	};
}

function startTurn(tracker: TurnTelemetryTracker, message: AssistantMessage, turnIndex = 0): void {
	tracker.handle({ type: "turn_start", turnIndex, timestamp: Date.now() });
	tracker.handle({ type: "message_start", message });
}

function endTurn(tracker: TurnTelemetryTracker, message: AssistantMessage, turnIndex = 0) {
	tracker.handle({ type: "message_end", message });
	return tracker.handle({
		type: "turn_end",
		turnIndex,
		message,
		toolResults: [],
		messageEntryId: "",
		toolResultEntryIds: [],
		entries: [],
		continue: false,
		context: {
			contextEntries: [],
			contextMessages: [],
			llmMessages: [],
			pendingMessages: [],
			canContinue: false,
		},
		outcome: "completed",
	});
}

test("session reset discards pending turns and completed-turn aggregates", () => {
	let now = 0;
	const tracker = new TurnTelemetryTracker(() => now);
	tracker.handle({ type: "agent_start" });
	const previous = makeMessage(100);
	startTurn(tracker, previous);
	now = 100;
	endTurn(tracker, previous);
	startTurn(tracker, previous, 1);
	tracker.reset();
	assert.equal(tracker.handle({ type: "agent_settled" }), undefined);
	assert.equal(endTurn(tracker, previous, 1), undefined);

	now = 1_000;
	tracker.handle({ type: "agent_start" });
	const current = makeMessage(20);
	startTurn(tracker, current);
	now = 1_100;
	endTurn(tracker, current);
	const telemetry = tracker.handle({ type: "agent_settled" });
	assert.ok(telemetry);
	assert.equal(telemetry.outputTokens, 20);
	assert.equal(telemetry.totalMs, 100);
});

test("uses total output over full generation time", () => {
	let now = 0;
	const tracker = new TurnTelemetryTracker(() => now);
	const message = makeMessage();
	startTurn(tracker, message);
	for (const timestamp of [4_000, 4_100]) {
		now = timestamp;
		tracker.handle(update(message));
	}
	now = 5_000;
	const telemetry = endTurn(tracker, message);

	assert.deepEqual(telemetry, {
		tps: 4,
		ttftMs: 4_000,
		totalMs: 5_000,
		inputTokens: 50,
		outputTokens: 20,
		cacheReadTokens: 0,
		stallMs: 0,
		stallCount: 0,
		rateUsdPerMTokens: 4,
		generationMs: 5_000,
		totalTokens: 70,
		costUsd: 0.00028,
		measurementMs: 5_000,
	});
	assert.equal(
		formatTurnTelemetry(telemetry!, theme, DEFAULT_CONFIG.telemetry, "ascii"),
		"> TPS 4.0 tok/s | ~ TTFT 4.0s | + 5.0s | ↑ 50 | ↓ 20 | $ $4.00/M",
	);
});

test("normalizes invalid usage without breaking turn telemetry", () => {
	let now = 0;
	const tracker = new TurnTelemetryTracker(() => now);
	const messages = [makeMessage(), makeMessage()];
	Object.assign(messages[0]!.usage, { input: Number.POSITIVE_INFINITY, totalTokens: null, cost: { total: Number.NaN } });
	Object.assign(messages[1]!.usage, { output: undefined, cost: undefined });

	tracker.handle({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });
	for (const message of messages) {
		tracker.handle({ type: "message_start", message });
		now += 100;
		tracker.handle(update(message));
		now += 100;
		tracker.handle({ type: "message_end", message });
	}
	const telemetry = tracker.handle({
		type: "turn_end",
		turnIndex: 0,
		message: messages[1]!,
		toolResults: [],
		messageEntryId: "",
		toolResultEntryIds: [],
		entries: [],
		continue: false,
		context: {
			contextEntries: [],
			contextMessages: [],
			llmMessages: [],
			pendingMessages: [],
			canContinue: false,
		},
		outcome: "completed",
	})!;

	assert.equal(telemetry.inputTokens, 50);
	assert.equal(telemetry.outputTokens, 20);
	assert.equal(telemetry.totalTokens, 70);
	assert.equal(telemetry.costUsd, 0);
	assert.equal(telemetry.rateUsdPerMTokens, null);
});

test("measures non-streamed responses from turn start", () => {
	let now = 0;
	const tracker = new TurnTelemetryTracker(() => now);
	const message = makeMessage();

	tracker.handle({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });
	now = 5_000;
	tracker.handle({ type: "message_start", message });
	tracker.handle({ type: "message_end", message });
	const telemetry = tracker.handle({
		type: "turn_end",
		turnIndex: 0,
		message,
		toolResults: [],
		messageEntryId: "",
		toolResultEntryIds: [],
		entries: [],
		continue: false,
		context: {
			contextEntries: [],
			contextMessages: [],
			llmMessages: [],
			pendingMessages: [],
			canContinue: false,
		},
		outcome: "completed",
	})!;

	assert.equal(telemetry.tps, 4);
	assert.equal(telemetry.ttftMs, 5_000);
	assert.equal(telemetry.generationMs, 5_000);
	assert.equal(telemetry.measurementMs, 5_000);
});

test("uses footer semantics and respects telemetry segment settings", () => {
	const colors: string[] = [];
	const styledTheme = {
		fg: (color: string, text: string) => {
			colors.push(color);
			return text;
		},
	} as Theme;
	const telemetry = {
		tps: 50,
		ttftMs: 200,
		totalMs: 900,
		inputTokens: 50,
		outputTokens: 20,
		cacheReadTokens: 5_000,
		stallMs: 800,
		stallCount: 1,
		rateUsdPerMTokens: 4,
		generationMs: 700,
		totalTokens: 70,
		costUsd: 0.00028,
		measurementMs: 400,
	};

	assert.match(
		formatTurnTelemetry(telemetry, styledTheme, DEFAULT_CONFIG.telemetry, "ascii"),
		/^> TPS 50\.0 tok\/s \| ~ TTFT 0\.2s.*↑ 5\.0k \(U 50 \+ R 5\.0k\) \| ↓ 20.*! stall 1x \/ 0\.8s \| \$ \$4\.00\/M$/,
	);
	assert.deepEqual(colors, ["accent", "text", "success", "accent", "success", "warning", "warning", "dim"]);

	const hidden: typeof DEFAULT_CONFIG.telemetry = {
		enabled: false,
		tps: false,
		ttft: false,
		duration: false,
		tokens: false,
		stalls: false,
		cost: false,
	};
	assert.equal(formatTurnTelemetry(telemetry, theme, hidden, "ascii"), "");
});

test("returns no TPS without output or generation time", () => {
	const scenarios = [
		{ name: "zero duration", updates: [0, 0], endMs: 0, output: 20 },
		{ name: "zero output", updates: [100, 200], endMs: 800, output: 0 },
	];

	for (const scenario of scenarios) {
		let now = 0;
		const tracker = new TurnTelemetryTracker(() => now);
		const message = makeMessage(scenario.output);
		startTurn(tracker, message);
		for (const timestamp of scenario.updates) {
			now = timestamp;
			tracker.handle(update(message));
		}
		now = scenario.endMs;
		const telemetry = endTurn(tracker, message);
		assert.equal(telemetry?.tps, null, scenario.name);
		assert.equal(telemetry?.outputTokens, scenario.output, scenario.name);
	}
});

test("keeps stalls in delivery time so they lower TPS", () => {
	function measure(updates: number[], endMs: number) {
		let now = 0;
		const tracker = new TurnTelemetryTracker(() => now);
		const message = makeMessage();
		startTurn(tracker, message);
		for (const timestamp of updates) {
			now = timestamp;
			tracker.handle(update(message));
		}
		now = endMs;
		return endTurn(tracker, message)!;
	}

	const uninterrupted = measure([100, 200, 300], 800);
	const stalled = measure([100, 1200, 2300, 2400, 3500], 3600);

	assert.equal(uninterrupted.tps, 25);
	assert.equal(stalled.tps, 5.6);
	assert.ok(stalled.tps! < uninterrupted.tps!);
	assert.equal(stalled.stallMs, 3300);
	assert.equal(stalled.stallCount, 2);
	assert.match(formatTurnTelemetry(stalled, theme, DEFAULT_CONFIG.telemetry, "ascii"), /! stall 2x \/ 3\.3s/);
});

test("only meaningful stream deltas define TTFT and stalls", () => {
	let now = 0;
	const tracker = new TurnTelemetryTracker(() => now);
	const message = makeMessage();
	startTurn(tracker, message);

	now = 100;
	tracker.handle(update(message, { type: "start", partial: message }));
	now = 200;
	tracker.handle(update(message, { type: "text_start", contentIndex: 0, partial: message }));
	now = 700;
	tracker.handle(update(message));
	now = 800;
	tracker.handle(update(message));
	now = 900;
	tracker.handle(update(message));
	now = 10_000;
	tracker.handle(update(message, { type: "done", reason: "stop", message }));
	now = 10_100;
	const telemetry = endTurn(tracker, message)!;

	assert.equal(telemetry.ttftMs, 700);
	assert.equal(telemetry.stallMs, 0);
	assert.equal(telemetry.stallCount, 0);
});

test("is stable across chunk counts", () => {
	function measure(updateTimes: number[]) {
		let now = 0;
		const tracker = new TurnTelemetryTracker(() => now);
		const message = makeMessage();
		startTurn(tracker, message);
		for (const timestamp of updateTimes) {
			now = timestamp;
			tracker.handle(update(message));
		}
		now = 800;
		return endTurn(tracker, message)!;
	}

	assert.equal(measure([100, 700]).tps, 25);
	assert.equal(measure([100, 200, 300, 400, 500, 700]).tps, 25);
});

test("uses full generation time for high rates", () => {
	let now = 0;
	const tracker = new TurnTelemetryTracker(() => now);
	const message = makeMessage(3_000);
	startTurn(tracker, message);
	now = 100;
	tracker.handle(update(message));
	now = 200;
	tracker.handle(update(message));
	now = 300;

	assert.equal(endTurn(tracker, message)?.tps, 10_000);
});

test("excludes tool gaps between assistant messages", () => {
	function measure(toolGapMs: number) {
		let now = 0;
		const tracker = new TurnTelemetryTracker(() => now);
		const first = makeMessage(20, 10);
		const second = makeMessage(20, 10);

		tracker.handle({ type: "agent_start" });
		startTurn(tracker, first);
		for (const timestamp of [100, 200]) {
			now = timestamp;
			tracker.handle(update(first));
		}
		now = 400;
		endTurn(tracker, first);

		now += toolGapMs;
		const secondStartMs = now;
		startTurn(tracker, second, 1);
		for (const offset of [100, 200]) {
			now = secondStartMs + offset;
			tracker.handle(update(second));
		}
		now = secondStartMs + 400;
		endTurn(tracker, second, 1);
		return tracker.handle({ type: "agent_settled" })!;
	}

	assert.equal(measure(0).tps, 50);
	assert.equal(measure(10_000).tps, 50);
});

test("includes every message's tokens and generation time", () => {
	let now = 0;
	const tracker = new TurnTelemetryTracker(() => now);
	const short = makeMessage(5, 20);
	const measured = makeMessage(20, 50);

	tracker.handle({ type: "agent_start" });
	startTurn(tracker, short);
	now = 100;
	tracker.handle(update(short));
	now = 150;
	endTurn(tracker, short);

	startTurn(tracker, measured, 1);
	for (const timestamp of [200, 300]) {
		now = timestamp;
		tracker.handle(update(measured));
	}
	now = 700;
	endTurn(tracker, measured, 1);
	const telemetry = tracker.handle({ type: "agent_settled" })!;

	assert.equal(telemetry.tps, 35.7);
	assert.equal(telemetry.measurementMs, 700);
	assert.equal(telemetry.inputTokens, 70);
	assert.equal(telemetry.outputTokens, 25);
});

test("counts cache-write tokens as input, matching /session's uncached figure", () => {
	// cacheWrite is fresh, near-full-price content; cacheRead is discounted repeat
	// content and stays out of inputTokens.
	let now = 0;
	const tracker = new TurnTelemetryTracker(() => now);
	const message = makeMessage(12, 90, 27009, 5000);

	tracker.handle({ type: "agent_start" });
	startTurn(tracker, message);
	now = 100;
	tracker.handle(update(message));
	now = 150;
	endTurn(tracker, message);
	const telemetry = tracker.handle({ type: "agent_settled" })!;

	assert.equal(telemetry.inputTokens, 27099);
	assert.equal(telemetry.cacheReadTokens, 5000);
	assert.match(
		formatTurnTelemetry(telemetry, theme, DEFAULT_CONFIG.telemetry, "ascii"),
		/\| ↑ 32k \(U 27k \+ R 5\.0k\) \| ↓ 12 \|/,
	);
});

test("aggregates all output and generation time across an agent run", () => {
	let now = 0;
	const tracker = new TurnTelemetryTracker(() => now);
	const short = makeMessage(5, 20);
	const first = makeMessage(20, 50);
	const second = makeMessage(30, 100);

	tracker.handle({ type: "agent_start" });
	startTurn(tracker, short);
	now = 100;
	tracker.handle(update(short));
	now = 150;
	endTurn(tracker, short);

	now = 200;
	startTurn(tracker, first, 1);
	for (const timestamp of [300, 400]) {
		now = timestamp;
		tracker.handle(update(first));
	}
	now = 800;
	endTurn(tracker, first, 1);

	now = 900;
	startTurn(tracker, second, 2);
	for (const timestamp of [1_000, 1_100]) {
		now = timestamp;
		tracker.handle(update(second));
	}
	now = 1_600;
	endTurn(tracker, second, 2);
	now = 1_700;
	const telemetry = tracker.handle({ type: "agent_settled" })!;

	assert.equal(telemetry.tps, 37.9);
	assert.equal(telemetry.measurementMs, 1_450);
	assert.equal(telemetry.inputTokens, 170);
	assert.equal(telemetry.outputTokens, 55);
	assert.equal(telemetry.totalTokens, 225);
	assert.equal(telemetry.rateUsdPerMTokens, 4);
});

test("open-tui notifies once after a complete agent run", () => {
	const handlers = new Map<string, Array<(event: any, ctx: ExtensionContext) => void>>();
	const notifications: string[] = [];
	const pi = {
		on(event: string, handler: (event: any, ctx: ExtensionContext) => void) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerCommand() {},
		getThinkingLevel: () => "off",
	} as unknown as ExtensionAPI;
	const ctx = {
		hasUI: true,
		mode: "tui",
		ui: { theme, notify: (message: string) => notifications.push(message) },
	} as unknown as ExtensionContext;
	const emit = (event: string, payload: unknown) => {
		for (const handler of handlers.get(event) ?? []) handler(payload, ctx);
	};
	const message = makeMessage();

	openTui(pi);
	emit("agent_start", { type: "agent_start" });
	emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: Date.now() });
	emit("message_start", { type: "message_start", message });
	emit("message_update", update(message));
	emit("message_end", { type: "message_end", message });
	emit("turn_end", { type: "turn_end", turnIndex: 0, message, toolResults: [] });

	assert.equal(notifications.length, 0);
	emit("agent_settled", { type: "agent_settled" });
	assert.equal(notifications.length, 1);
	assert.match(notifications[0]!, /TPS .*TTFT/);
});

test("open-tui keeps a bounded peek scoped to the current assistant", async () => {
	const effectiveWidth = 85;
	const handlers = new Map<string, Array<(event: any, ctx: ExtensionContext) => void | Promise<void>>>();
	const globalLabelUpdates: Array<string | undefined> = [];
	let mountedEditor: OpenTuiEditor | undefined;
	let renderRequests = 0;
	const thought = "x".repeat(200);
	const assistant = {
		role: "assistant",
		content: [{ type: "thinking", thinking: thought }],
	};
	const thinkingComponents = [
		new AssistantMessageComponent(undefined, true),
		new AssistantMessageComponent(undefined, true),
	];
	const getThinkingLabel = (component: AssistantMessageComponent) =>
		(component as unknown as { hiddenThinkingLabel: string }).hiddenThinkingLabel;
	const tui = {
		mode: "fullscreen",
		terminal: { rows: 24, columns: effectiveWidth, write() {} },
		children: [{ children: thinkingComponents }],
		getShowHardwareCursor: () => false,
		setShowHardwareCursor() {},
		requestRender() { renderRequests++; },
	};
	const pi = {
		on(event: string, handler: (event: any, ctx: ExtensionContext) => void | Promise<void>) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerCommand() {},
		getThinkingLevel: () => "high",
	} as unknown as ExtensionAPI;
	const ctx = {
		hasUI: true,
		mode: "tui",
		cwd: process.cwd(),
		ui: {
			theme,
			notify() {},
			setHeader() {
				assert.fail("Open TUI must leave Pi's native header untouched during startup and shutdown");
			},
			setFooter() {},
			setEditorComponent(factory?: unknown) {
				if (typeof factory === "function") {
					mountedEditor = factory(tui, { borderColor: (text: string) => text }, { matches: () => false }) as OpenTuiEditor;
				}
			},
			setHiddenThinkingLabel(label?: string) {
				globalLabelUpdates.push(label);
				for (const component of thinkingComponents) component.setHiddenThinkingLabel(label ?? "Thinking...");
			},
		},
	} as unknown as ExtensionContext;
	const emit = async (event: string, payload: unknown) => {
		await Promise.all((handlers.get(event) ?? []).map((handler) => handler(payload, ctx)));
	};
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const previousColumns = Object.getOwnPropertyDescriptor(process.stdout, "columns");
	const agentDir = await mkdtemp(join(tmpdir(), "open-tui-peek-"));
	process.env.PI_CODING_AGENT_DIR = agentDir;

	try {
		Object.defineProperty(process.stdout, "columns", { configurable: true, value: 120 });
		openTui(pi);
		await emit("session_start", { type: "session_start" });
		await emit("agent_start", { type: "agent_start" });
		assert.ok(mountedEditor);
		assert.match(stripAnsi(mountedEditor.render(85)[0]!), /working \d+s/);
		await emit("turn_start", { type: "turn_start" });
		await emit("message_start", { type: "message_start", message: assistant });
		await emit("message_update", {
			type: "message_update",
			message: assistant,
			assistantMessageEvent: { type: "thinking_delta", delta: assistant.content[0]!.thinking },
		});
		const currentLabel = getThinkingLabel(thinkingComponents[1]!);
		assert.ok(currentLabel);
		assert.equal(getThinkingLabel(thinkingComponents[0]!), "Thinking...");
		assert.equal(
			new ScrollView(new Text(currentLabel, 1, 0), { scrollbar: "always" }).render(effectiveWidth).length,
			1,
			"the peek row must fit the narrowed fullscreen transcript",
		);
		assistant.content[0]!.thinking += "y";
		await emit("message_update", {
			type: "message_update",
			message: assistant,
			assistantMessageEvent: { type: "thinking_delta", delta: "y" },
		});
		const streamedLabel = getThinkingLabel(thinkingComponents[1]!);
		assert.notEqual(streamedLabel, currentLabel, "each thinking delta must update the label immediately");

		await emit("agent_settled", { type: "agent_settled" });
		// A custom/continuation task can spend time preparing before its assistant
		// message_start. Its start must still invalidate the previous settle timer.
		await emit("agent_start", { type: "agent_start" });
		const updatesAfterNewTaskStart = globalLabelUpdates.length;
		const requestsBeforeTick = renderRequests;
		await new Promise((resolve) => setTimeout(resolve, 350));

		assert.ok(renderRequests > requestsBeforeTick, "working timer requests a render even without stream deltas");
		await emit("agent_end", { type: "agent_end", messages: [] });
		assert.doesNotMatch(stripAnsi(mountedEditor.render(85)[0]!), /done|ended/);
		assert.match(stripAnsi(mountedEditor.render(85)[0]!), /working/);
		await emit("agent_settled", { type: "agent_settled" });
		assert.match(stripAnsi(mountedEditor.render(85)[0]!), /ended/);
		await emit("agent_start", { type: "agent_start" });
		assert.doesNotMatch(stripAnsi(mountedEditor.render(85)[0]!), /done/);
		assert.ok(
			globalLabelUpdates.slice(updatesAfterNewTaskStart).every((label) => label !== undefined),
			"a stale settle timer must not clear the new task's label",
		);
		assert.equal(getThinkingLabel(thinkingComponents[1]!), streamedLabel, "the label must not animate without a delta");
	} finally {
		if (previousColumns) Object.defineProperty(process.stdout, "columns", previousColumns);
		else Reflect.deleteProperty(process.stdout, "columns");
		await emit("session_shutdown", { type: "session_shutdown" });
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		await rm(agentDir, { recursive: true, force: true });
	}
});

test("settled telemetry notifies attached, merges detached, and resets with task/session", async () => {
	for (const { attached, telemetryMode } of [
		{ attached: true, telemetryMode: "enabled" },
		{ attached: false, telemetryMode: "enabled" },
		{ attached: true, telemetryMode: "disabled" },
		{ attached: false, telemetryMode: "disabled" },
		{ attached: true, telemetryMode: "empty" },
		{ attached: false, telemetryMode: "empty" },
	]) {
		const hasTelemetry = telemetryMode === "enabled";
		const handlers = new Map<string, Array<(event: any, ctx: ExtensionContext) => void | Promise<void>>>();
		const notifications: string[] = [];
		let mountedEditor: OpenTuiEditor | undefined;
		const tui = {
			terminal: { rows: 24, columns: 200, write() {} },
			getShowHardwareCursor: () => false, setShowHardwareCursor() {}, requestRender() {},
		};
		const pi = {
			on(event: string, handler: (event: any, ctx: ExtensionContext) => void | Promise<void>) {
				handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			},
			registerCommand() {}, getThinkingLevel: () => "off",
		} as unknown as ExtensionAPI;
		const ctx = {
			hasUI: true, mode: "tui", cwd: process.cwd(),
			ui: {
				theme, notify: (message: string) => notifications.push(message), setFooter() {},
				setEditorComponent(factory?: unknown) {
					if (typeof factory === "function") mountedEditor = factory(tui, { borderColor: (text: string) => text }, { matches: () => false });
				},
				setHiddenThinkingLabel() {},
			},
		} as unknown as ExtensionContext;
		const emit = async (event: string, payload: unknown = { type: event, ...(event === "agent_end" ? { messages: [] } : {}) }) => {
			for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
		};
		const previous = process.env.PI_CODING_AGENT_DIR;
		const agentDir = await mkdtemp(join(tmpdir(), "open-tui-workline-"));
		process.env.PI_CODING_AGENT_DIR = agentDir;
		const config = structuredClone(DEFAULT_CONFIG);
		config.workline.attachToBorder = attached;
		config.thinkingPeek.lines = 0;
		if (telemetryMode === "disabled") config.telemetry.enabled = false;
		if (telemetryMode === "empty") {
			config.telemetry = { enabled: true, tps: false, ttft: false, duration: false, tokens: false, stalls: false, cost: false };
		}
		try {
			await writeFile(join(agentDir, "open-tui.json"), JSON.stringify(config));
			openTui(pi);
			await emit("session_start");
			assert.ok(mountedEditor);
			const idle = mountedEditor.render(200).map(stripAnsi);
			const run = async () => {
				const message = makeMessage();
				await emit("agent_start");
				await emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: Date.now() });
				await emit("message_start", { type: "message_start", message });
				await emit("message_update", update(message));
				await emit("message_end", { type: "message_end", message });
				await emit("turn_end", { type: "turn_end", turnIndex: 0, message, toolResults: [] });
				await emit("agent_end", { type: "agent_end", messages: [message] });
				assert.doesNotMatch(mountedEditor!.render(200).join("\n"), /TPS|done/);
				await emit("agent_before_settle", { type: "agent_before_settle", outcome: "completed" });
				await emit("agent_settled");
			};
			await run();
			const done = mountedEditor.render(200).map(stripAnsi);
			assert.equal(done.length, idle.length + (attached ? 0 : 3));
			assert.match(done[attached ? 0 : 1]!, /done/);
			if (attached) {
				assert.equal(notifications.length, hasTelemetry ? 1 : 0);
				if (hasTelemetry) assert.match(notifications[0]!, /TPS .*TTFT/);
				assert.doesNotMatch(done.join("\n"), /TPS/);
				assert.deepEqual(done.slice(1), idle.slice(1));
			} else {
				assert.equal(notifications.length, 0);
				assert.equal(done[0], "");
				assert.equal(done[2], "");
				if (hasTelemetry) assert.match(done[1]!, /done .*\| .*TPS .*TTFT/);
				else assert.doesNotMatch(done[1]!, /TPS|\|/);
				assert.equal(done.filter((line) => line.includes("TPS")).length, hasTelemetry ? 1 : 0);
				assert.deepEqual(done.slice(3), idle);
				await new Promise((resolve) => setTimeout(resolve, 350));
				assert.deepEqual(mountedEditor.render(200).map(stripAnsi), done);
			}
			await emit("agent_start");
			assert.doesNotMatch(mountedEditor.render(200).join("\n"), /TPS|done/);
			await emit("agent_end");
			await emit("agent_settled");
			await run();
			await emit("session_start");
			assert.deepEqual(mountedEditor.render(200).map(stripAnsi), idle);
		} finally {
			await emit("session_shutdown");
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
			await rm(agentDir, { recursive: true, force: true });
		}
	}
});
