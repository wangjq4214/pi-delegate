import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentBeforeSettleEvent, ExtensionAPI, ExtensionContext, ExtensionEvent, Theme } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { OpenTuiEditor } from "../src/editor.ts";
import { resolveGlyphs } from "../src/icons.ts";
import openTui from "../src/index.ts";
import { stripAnsi } from "../src/utils.ts";

function assistant(stopReason: AssistantMessage["stopReason"]): AssistantMessage {
	return {
		role: "assistant", content: [{ type: "text", text: "failed interrupted done" }],
		api: "openai-completions", provider: "fixture", model: "fixture", stopReason, timestamp: 0,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	};
}

function boundary(outcome: AgentBeforeSettleEvent["outcome"]): AgentBeforeSettleEvent {
	return {
		type: "agent_before_settle", outcome, entries: [], continue: false,
		context: { contextEntries: [], contextMessages: [], llmMessages: [], pendingMessages: [], canContinue: false },
	};
}

for (const attached of [true, false]) {
	test(`extension lifecycle: ${attached ? "attached" : "detached"} outcomes, continuous duration and session resets`, async (t) => {
		let now = 1_000;
		t.mock.method(Date, "now", () => now);
		const agentDir = await mkdtemp(join(tmpdir(), "open-tui-outcomes-"));
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		const config = structuredClone(DEFAULT_CONFIG);
		config.icons.mode = "ascii";
		config.workline.attachToBorder = attached;
		config.thinkingPeek.lines = 0;
		config.telemetry.enabled = false;
		const handlers = new Map<string, Array<(event: any, ctx: ExtensionContext) => unknown>>();
		let editor: OpenTuiEditor | undefined;
		let renderRequests = 0;
		const notifications: string[] = [];
		const tui = {
			mode: "regular", doRender() {}, renderNow() {},
			terminal: { rows: 24, columns: 100, write() {}, start() {}, stop() {}, showCursor() {}, hideCursor() {} },
			getShowHardwareCursor: () => false, setShowHardwareCursor() {},
			requestRender() { renderRequests++; },
		};
		const ctx = {
			hasUI: true, mode: "tui", cwd: agentDir,
			ui: {
				theme: { fg: (_color: string, text: string) => text } as Theme,
				notify: (message: string) => notifications.push(message), setFooter() {}, setHiddenThinkingLabel() {},
				setEditorComponent(factory?: unknown) {
					if (typeof factory === "function") editor = factory(tui, { borderColor: (text: string) => text }, { matches: () => false });
				},
			},
		} as unknown as ExtensionContext;
		const pi = {
			on(event: string, handler: (event: any, ctx: ExtensionContext) => unknown) {
				handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			},
			registerCommand() {}, getThinkingLevel: () => "off",
		} as unknown as ExtensionAPI;
		const emit = async (event: ExtensionEvent) => {
			for (const handler of handlers.get(event.type) ?? []) await handler(event, ctx);
		};
		const render = () => editor!.render(100).map(stripAnsi);
		const line = () => render()[attached ? 0 : 1]!;
		const finishLoop = async (reason: AssistantMessage["stopReason"]) => {
			const message = assistant(reason);
			await emit({ type: "message_end", message });
			await emit({ type: "agent_end", messages: [message] });
			assert.doesNotMatch(line(), /done|interrupted|failed|ended/);
		};
		try {
			await writeFile(join(agentDir, "open-tui.json"), JSON.stringify(config));
			openTui(pi);
			await emit({ type: "session_start", reason: "startup" });
			assert.ok(editor);
			const idle = render();
			for (const { reason, outcome, label, glyph } of [
				{ reason: "stop", outcome: "completed", label: "done", glyph: "done" },
				{ reason: "aborted", outcome: undefined, label: "interrupted", glyph: "interrupted" },
				{ reason: "error", outcome: "error", label: "failed", glyph: "failed" },
				{ reason: "length", outcome: "completed", label: "ended", glyph: "ended" },
			] as const) {
				now = 1_000;
				// No user message is needed: custom-message/continuation runs count too.
				await emit({ type: "agent_start" });
				assert.doesNotMatch(line(), /done|interrupted|failed|ended/);
				now = 2_000;
				await finishLoop(reason);
				if (outcome) await emit(boundary(outcome));
				assert.doesNotMatch(line(), /done|interrupted|failed|ended/);
				now = 4_000;
				await emit({ type: "agent_settled" });
				assert.ok(line().includes(`${resolveGlyphs("ascii")[glyph]} ${label} 3s`));
				const result = render();
				assert.equal(result.length, idle.length + (attached ? 0 : 3));
				now = 9_000;
				await emit({ type: "agent_settled" });
				assert.deepEqual(render(), result, "retained results do not keep counting");
			}

			now = 10_000;
			await emit({ type: "agent_start" });
			now = 11_000;
			await finishLoop("error");
			editor.setWorkingStatusIndicator({ kind: "retry", renderInBorder: () => "native retry", renderSpinnerInBorder: () => "R" });
			assert.ok(line().includes("native retry"));
			now = 13_000;
			await emit({ type: "agent_start" });
			editor.setWorkingStatusIndicator(undefined);
			assert.match(line(), /working 3s/);
			await emit({ type: "message_end", message: {
				role: "toolResult", toolCallId: "id", toolName: "fixture", content: [{ type: "text", text: "aborted" }], isError: true, timestamp: now,
			} });
			await finishLoop("stop");
			await emit(boundary("completed"));
			// Another extension requests a continuation after the provisional success.
			now = 14_000;
			await emit({ type: "agent_start" });
			await emit({ type: "agent_end", messages: [] });
			now = 15_000;
			await emit({ type: "agent_settled" });
			assert.ok(line().includes("- ended 5s"), "no previous success is reused by an empty continuation");

			for (const reason of ["reload", "new", "resume", "fork"] as const) {
				await emit({ type: "session_start", reason });
				assert.deepEqual(render(), idle);
				await emit({ type: "message_end", message: assistant("aborted") });
				await emit({ type: "agent_settled" });
				assert.deepEqual(render(), idle, "replay and late settlement cannot publish a result");
				await emit({ type: "agent_start" });
				await finishLoop("stop");
				await emit(boundary("completed"));
				await emit({ type: "agent_settled" });
				assert.ok(line().includes("done"));
			}
			await emit({ type: "session_tree", newLeafId: "new-leaf", oldLeafId: "old-leaf" });
			assert.deepEqual(render(), idle);
			await emit({ type: "agent_start" });
			await finishLoop("error");
			await emit(boundary("error"));
			await emit({ type: "session_tree", newLeafId: "other-leaf", oldLeafId: "new-leaf" });
			await emit({ type: "agent_settled" });
			assert.deepEqual(render(), idle);
			await new Promise((resolve) => setTimeout(resolve, 300));
			const stoppedRequests = renderRequests;
			await new Promise((resolve) => setTimeout(resolve, 300));
			assert.equal(renderRequests, stoppedRequests, "tree navigation stops the working timer");
			await emit({ type: "session_shutdown", reason: "quit" });
			await emit({ type: "agent_start" });
			await emit(boundary("error"));
			await emit({ type: "agent_settled" });
			assert.equal(notifications.length, 0);
		} finally {
			await emit({ type: "session_shutdown", reason: "quit" });
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
			await rm(agentDir, { recursive: true, force: true });
		}
	});
}
