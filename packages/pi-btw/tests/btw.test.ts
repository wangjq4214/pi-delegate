import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { createEventBus, initTheme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import type {
	DelegateClient,
	DelegateResult,
} from "@wangjq4214/pi-delegate/api";
import {
	getUserBoxBorder,
	LEGACY_DEFAULT_CONFIG,
} from "../../pi-open-tui/src/config.ts";
import { registerSideChatPresentation } from "../../pi-open-tui/src/side-chat-frame.ts";
import { UiRefresh } from "../../pi-open-tui/src/ui-refresh.ts";
import btw from "../src/index.ts";

function setup(
	supportsProgress = true,
	configure?: (pi: ExtensionAPI, ctx: ExtensionCommandContext) => void,
) {
	type Handler = Parameters<ExtensionAPI["registerCommand"]>[1]["handler"];
	type Options = Exclude<
		Parameters<ExtensionCommandContext["ui"]["custom"]>[1],
		undefined
	>;
	const results: ReturnType<typeof Promise.withResolvers<DelegateResult>>[] =
		[];
	const calls: Parameters<DelegateClient["execute"]>[] = [];
	const events = new Map<string, (event?: unknown) => void>();
	let handler: Handler | undefined;
	let component:
		| {
				focused?: boolean;
				render(width: number): string[];
				handleInput(data: string): void;
		  }
		| undefined;
	let options: Options | undefined;
	let focusCount = 0;
	const notices: string[] = [];
	const terminal = { rows: 30 };
	let transcriptWrites = 0;
	const ctx = {
		mode: "tui",
		sessionManager: {
			getBranch: () => [
				{
					type: "message",
					message: { role: "user", content: "Earlier detail" },
				},
				{
					type: "message",
					message: {
						role: "assistant",
						content: [
							{ type: "thinking", thinking: "Hidden thought" },
							{ type: "text", text: "Assistant detail" },
						],
					},
				},
				{
					type: "message",
					message: {
						role: "toolResult",
						content: [{ type: "text", text: "Tool detail" }],
					},
				},
			],
		},
		ui: {
			theme: { fg: (_: string, value: string) => value },
			notify(message: string) {
				notices.push(message);
			},
			custom(factory: (...args: unknown[]) => typeof component, opts: Options) {
				options = opts;
				const closed = Promise.withResolvers<void>();
				component = factory(
					{ terminal, requestRender() {} },
					{
						fg: (_: string, value: string) => value,
						bg: (_: string, value: string) => value,
					},
					{},
					() => {
						component = undefined;
						closed.resolve();
					},
				);
				opts.onHandle?.({
					focus: () => {
						focusCount++;
						if (component) component.focused = true;
					},
				} as Parameters<NonNullable<Options["onHandle"]>>[0]);
				return closed.promise;
			},
		},
	} as unknown as ExtensionCommandContext;
	const bus = createEventBus();
	bus.on("@wangjq4214/pi-delegate:discover", (request) => {
		const payload = request as { reply(value: unknown): void };
		payload.reply({
			version: 1,
			capabilities: supportsProgress ? { invocationProgress: true } : undefined,
			execute(...args: Parameters<DelegateClient["execute"]>) {
				calls.push(args);
				const result = Promise.withResolvers<DelegateResult>();
				results.push(result);
				return result.promise;
			},
			status() {},
			list() {},
			wait() {},
			cancel() {},
		});
	});
	const api = {
		registerCommand(name: string, command: { handler: Handler }) {
			expect(name).toBe("btw");
			handler = command.handler;
		},
		on(name: string, callback: (event?: unknown) => void) {
			events.set(name, callback);
		},
		appendEntry() {
			transcriptWrites++;
		},
		sendMessage() {
			transcriptWrites++;
		},
		sendUserMessage() {
			transcriptWrites++;
		},
		events: bus,
	};
	btw(api as unknown as ExtensionAPI);
	configure?.(api as unknown as ExtensionAPI, ctx);
	return {
		ask: (question: string) => handler?.(question, ctx),
		calls,
		results,
		notices,
		terminal,
		events,
		get component() {
			return component;
		},
		get options() {
			return options;
		},
		get focusCount() {
			return focusCount;
		},
		get transcriptWrites() {
			return transcriptWrites;
		},
	};
}

test("uses ordinary execute with presentation only, keeps context one-way and renders the answer", async () => {
	const h = setup();
	await h.ask("Where is the handler?");
	expect(h.calls).toHaveLength(1);
	const call = h.calls[0];
	if (!call) throw new Error("Missing delegate invocation");
	const [input, , , options] = call;
	expect(input).toEqual({
		task: "Where is the handler?",
		title: "/btw",
		context: expect.any(String),
	});
	expect(input.context).toContain("Earlier detail");
	expect(input.context).toContain("Assistant detail");
	expect(input.context).not.toMatch(/Hidden thought|Tool detail/);
	expect(options).toEqual({
		presentation: "consumer",
		onProgress: expect.any(Function),
	});
	expect(h.options).toMatchObject({
		overlay: true,
		overlayOptions: { anchor: "center", nonCapturing: true },
	});
	expect(h.focusCount).toBe(0);
	options?.onProgress?.({
		taskId: "fixture",
		phase: "running",
		cancelling: false,
	});
	expect(h.component?.render(45).join("\n")).toContain("running");
	h.results[0]?.resolve({
		details: { status: "completed" },
		content: [{ type: "text", text: "答案 \x1b[31mfound\x1b[0m" }],
	} as DelegateResult);
	await Promise.resolve();
	const lines = h.component?.render(45) ?? [];
	expect(lines.join("\n")).toContain("答案 found");
	expect(lines.join("\n")).not.toContain("\x1b[31m");
	for (const width of [1, 2, 11, 45]) {
		const rows = h.component?.render(width) ?? [];
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((line) => visibleWidth(line) <= width)).toBe(true);
	}
	expect(h.transcriptWrites).toBe(0);
	await h.ask("");
	expect(h.focusCount).toBe(1);
	h.component?.handleInput("\x1b");
	expect(h.component).toBeUndefined();
	await h.ask("");
	expect(h.component?.render(45).join("\n")).toContain("答案 found");
	h.events.get("session_shutdown")?.();
	expect(h.component).toBeUndefined();
});

test("shows a compatibility error without dispatch when invocation progress is absent", async () => {
	const h = setup(false);
	await h.ask("A question");
	expect(h.calls).toHaveLength(0);
	expect(h.component?.render(60).join("\n")).toMatch(
		/failed[\s\S]*requires invocation/,
	);
});
function answer(text: string): DelegateResult {
	return {
		details: { status: "completed" },
		content: [{ type: "text", text }],
	} as DelegateResult;
}

test("bare command opens a focused composer; reopening retains the conversation for follow-ups", async () => {
	const h = setup();
	await h.ask("");
	expect(h.notices).toEqual([]);
	expect(h.calls).toHaveLength(0);
	const emptyChat = h.component?.render(60).join("\n") ?? "";
	expect(
		stripVTControlCharacters(emptyChat.replace(CURSOR_MARKER, "")),
	).toContain("Ask a side question");
	expect(h.component?.render(60).join("\n")).toContain(CURSOR_MARKER);
	h.component?.handleInput("\r");
	expect(h.calls).toHaveLength(0);

	h.component?.handleInput("Two options?");
	h.component?.handleInput("\r");
	expect(h.calls[0]?.[0]?.task).toBe("Two options?");
	h.component?.handleInput("\x1b");
	expect(h.component).toBeUndefined();
	expect(h.calls[0]?.[2]?.aborted).toBe(false);
	h.results[0]?.resolve(answer("One: tea. Two: coffee."));
	await Promise.resolve();

	await h.ask("");
	expect(h.component?.render(60).join("\n")).toContain("Two: coffee.");
	expect(h.component?.focused).toBe(true);
	h.component?.handleInput("Tell me about the second one.");
	h.component?.handleInput("\r");
	expect(h.calls).toHaveLength(2);
	expect(h.calls[1]?.[0]).toMatchObject({
		task: "Tell me about the second one.",
		context: expect.stringContaining(
			'{"question":"Two options?","answer":"One: tea. Two: coffee."}',
		),
	});
	expect(h.component?.render(60).join("\n")).toContain("Two options?");
	expect(h.transcriptWrites).toBe(0);
});

test("switching branch or session aborts pending questions and discards old history and late results", async () => {
	const h = setup();
	await h.ask("old completed question");
	h.results[0]?.resolve(answer("old completed answer"));
	await Promise.resolve();
	await h.ask("old pending question");
	h.events.get("session_tree")?.({ oldLeafId: "A", newLeafId: "B" });
	expect(h.calls[1]?.[2]?.aborted).toBe(true);
	expect(h.component).toBeUndefined();

	await h.ask("");
	h.results[1]?.resolve(answer("late old answer"));
	await Promise.resolve();
	expect(h.component?.render(60).join("\n")).not.toMatch(/old|late/);
	await h.ask("new branch question");
	expect(h.calls[2]?.[0]?.context).not.toMatch(/old|late/);
	h.results[2]?.resolve(answer("first session answer"));
	await Promise.resolve();
	h.events.get("session_start")?.();
	await h.ask("new session question");
	expect(h.calls[3]?.[0]?.context).not.toContain("first session answer");
	expect(h.component?.render(60).join("\n")).not.toContain(
		"first session answer",
	);
});

test("scrolling exposes long answers without losing the composer in a short terminal", async () => {
	const h = setup();
	h.terminal.rows = 6;
	await h.ask("Long answer please");
	await h.ask("");
	h.results[0]?.resolve(
		answer(Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n")),
	);
	await Promise.resolve();
	expect(h.component?.render(60).join("\n")).toContain("line 20");
	for (let i = 0; i < 24; i++) h.component?.handleInput("\x1b[5~");
	const lines = h.component?.render(60) ?? [];
	expect(lines.join("\n")).toContain("Long answer please");
	expect(lines.join("\n")).toContain(CURSOR_MARKER);
	expect(lines).toHaveLength(6);

	h.terminal.rows = 1;
	expect(h.component?.render(60)).toHaveLength(1);
	h.component?.handleInput("\x1b[200~你好\n\x1b[31m世界\x1b[0m\x1b[201~");
	h.component?.handleInput("\r");
	expect(h.calls[1]?.[0]?.task).toBe("你好 世界");
});

test("pads the native overlay on all sides and renders replies as Pi Markdown", async () => {
	initTheme();
	const h = setup();
	await h.ask("Show formatting");
	h.results[0]?.resolve(answer("**bold answer**"));
	await Promise.resolve();
	const lines = (h.component?.render(60) ?? []).map(stripVTControlCharacters);
	expect(lines[0]).toBe(" ".repeat(60));
	expect(lines.at(-1)).toBe(" ".repeat(60));
	expect(lines[1]).toStartWith("  /btw");
	expect(lines[1]).toEndWith("  ");
	expect(lines.join("\n")).toContain("  bold answer");
	expect(lines.join("\n")).not.toContain("**bold answer**");
});

test("Open TUI styles individual controls, not the outer overlay; Workline follows side runs", async () => {
	const config = structuredClone(LEGACY_DEFAULT_CONFIG);
	config.userMessageLayout = "compact";
	config.icons.mode = "ascii";
	config.editorBorderStyle = "surround";
	config.workline.attachToBorder = true;
	let active = false;
	let subscriptions = 0;
	const refresh = new UiRefresh();
	const h = setup(true, (pi, ctx) => {
		registerSideChatPresentation(
			pi,
			() => (active ? config : undefined),
			() => ctx.ui.theme,
			{
				subscribe(interval, tick) {
					subscriptions++;
					const stop = refresh.subscribe(interval, tick);
					return () => {
						subscriptions--;
						stop();
					};
				},
				requestRender: (tick) => refresh.requestRender(tick),
			},
		);
	});
	await h.ask("side question");
	await h.ask("");
	h.component?.handleInput("draft survives");
	const render = (width = 60) => h.component?.render(width) ?? [];
	const plain = () => render().map(stripVTControlCharacters);
	expect(plain()[0]).toBe(" ".repeat(60));
	expect(plain().find((line) => line.includes("side question"))).toStartWith(
		"   side question",
	);
	active = true;
	h.calls[0]?.[3]?.onProgress?.({
		taskId: "fixture",
		phase: "running",
		cancelling: false,
	});
	expect(plain()[0]).toBe(" ".repeat(60));
	expect(plain().find((line) => line.includes("side question"))).toStartWith(
		"  |",
	);
	expect(plain().find((line) => line.includes("running"))).toStartWith("  ╭");
	expect(plain().find((line) => line.includes("draft survives"))).toStartWith(
		"  │",
	);
	expect(subscriptions).toBe(1);
	config.userBoxBorder = {
		...getUserBoxBorder(config),
		enabled: true,
		style: "double",
		top: { enabled: true },
		bottom: { enabled: true },
		left: { enabled: true },
		right: { enabled: true },
	};
	expect(plain()).toContain(`  +${"=".repeat(54)}+  `);
	expect(plain()[0]).toBe(" ".repeat(60));
	config.editorBorderStyle = "minimal";
	config.workline.attachToBorder = false;
	expect(plain().find((line) => line.includes("running"))).toMatch(
		/^ {4}.*running/,
	);
	expect(plain().find((line) => line.includes("draft survives"))).not.toContain(
		"│",
	);
	for (const [width, height] of [
		[10, 2],
		[8, 4],
		[60, 5],
		[1, 1],
	] as const) {
		h.terminal.rows = height;
		const lines = render(width);
		expect(lines.length).toBe(height);
		expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
		expect(lines.join("\n")).toContain(CURSOR_MARKER);
	}
	h.terminal.rows = 30;
	h.results[0]?.resolve(answer("side answer"));
	await Promise.resolve();
	expect(plain().find((line) => line.includes("done"))).toBeDefined();
	expect(plain().join("\n")).toContain("side answer");
	const answerRow = plain().findIndex((line) => line.trim() === "side answer");
	expect(plain()[answerRow - 2]).toContain("+====");
	expect(plain()[answerRow - 1]?.trim()).toBe("");
	expect(subscriptions).toBe(0);
	active = false;
	expect(plain()[0]).toBe(" ".repeat(60));
	expect(plain().find((line) => line.includes("draft survives"))).not.toContain(
		"│",
	);
	expect(h.focusCount).toBe(1);
	active = true;
	await h.ask("another side question");
	render();
	const previousAnswer = plain().findIndex(
		(line) => line.trim() === "side answer",
	);
	expect(previousAnswer).toBeGreaterThanOrEqual(0);
	expect(plain()[previousAnswer + 1]?.trim()).toBe("");
	expect(plain()[previousAnswer + 2]).toContain("+====");
	expect(subscriptions).toBe(1);
	h.component?.handleInput("\x1b");
	expect(subscriptions).toBe(0);
	expect(h.calls[1]?.[2]?.aborted).toBe(false);
});
