import { expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type {
	DelegateClient,
	DelegateResult,
} from "@wangjq4214/pi-delegate/api";
import btw from "../src/index.ts";

function setup(supportsProgress = true) {
	type Handler = Parameters<ExtensionAPI["registerCommand"]>[1]["handler"];
	type Options = Exclude<
		Parameters<ExtensionCommandContext["ui"]["custom"]>[1],
		undefined
	>;
	const result = Promise.withResolvers<DelegateResult>();
	const calls: Parameters<DelegateClient["execute"]>[] = [];
	const events = new Map<string, () => void>();
	let handler: Handler | undefined;
	let component:
		| { render(width: number): string[]; handleInput(data: string): void }
		| undefined;
	let options: Options | undefined;
	let focusCount = 0;
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
			custom(factory: (...args: unknown[]) => typeof component, opts: Options) {
				options = opts;
				const closed = Promise.withResolvers<void>();
				component = factory(
					{ terminal: { rows: 30 }, requestRender() {} },
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
					},
				} as Parameters<NonNullable<Options["onHandle"]>>[0]);
				return closed.promise;
			},
		},
	} as unknown as ExtensionCommandContext;
	const api = {
		registerCommand(name: string, command: { handler: Handler }) {
			expect(name).toBe("btw");
			handler = command.handler;
		},
		on(name: string, callback: () => void) {
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
		events: {
			emit(_: string, payload: { reply(value: unknown): void }) {
				payload.reply({
					version: 1,
					capabilities: supportsProgress
						? { invocationProgress: true }
						: undefined,
					execute(...args: Parameters<DelegateClient["execute"]>) {
						calls.push(args);
						return result.promise;
					},
					status() {},
					list() {},
					wait() {},
					cancel() {},
				});
			},
		},
	};
	btw(api as unknown as ExtensionAPI);
	return {
		ask: (question: string) => handler?.(question, ctx),
		calls,
		result,
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
		overlayOptions: { anchor: "top-right", nonCapturing: true },
	});
	expect(h.focusCount).toBe(0);
	options?.onProgress?.({
		taskId: "fixture",
		phase: "running",
		cancelling: false,
	});
	expect(h.component?.render(45).join("\n")).toContain("running");
	h.result.resolve({
		details: { status: "completed" },
		content: [{ type: "text", text: "答案 \x1b[31mfound\x1b[0m" }],
	} as DelegateResult);
	await Promise.resolve();
	const lines = h.component?.render(45) ?? [];
	expect(lines.join("\n")).toContain("答案 found");
	expect(lines.join("\n")).not.toContain("\x1b");
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
	expect(h.calls[0]?.[2]?.aborted).toBe(true);
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
