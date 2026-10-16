import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { resolveGlyphs } from "../src/icons.ts";
import { buildPeekLabel, collectPeekParts, createPeekState, extractThinkingTitles, reducePeek, type PeekState } from "../src/peek.ts";
import { formatDuration, stripAnsi } from "../src/utils.ts";

const glyphs = resolveGlyphs("ascii");
const plain = (value: string) => stripAnsi(value);

test("collectPeekParts joins real thinking/text, supports text fallback, and ignores malformed parts", () => {
	assert.deepEqual(collectPeekParts([
		{ type: "thinking", thinking: "one" }, { type: "thinking", text: "two" },
		{ type: "text", text: "answer" }, { type: "toolCall", name: "bash" }, null, "bad", {},
		{ type: "thinking", thinking: 7 }, { type: "text", text: false },
	]), { thinking: "onetwo", text: "answer" });
	for (const value of [undefined, null, "bad", {}]) assert.deepEqual(collectPeekParts(value), { thinking: "", text: "" });
});

test("explicit headings and step titles produce only the latest four chronological nodes", () => {
	const source = "# Start\nordinary body\n## Analyze\nStep 3: compare\n阶段四：检查\n### Verify";
	assert.deepEqual(extractThinkingTitles(source), ["Analyze", "Step 3: compare", "阶段四：检查", "Verify"]);
	assert.deepEqual(extractThinkingTitles("Phase 1\n步骤二\n###### Final ###"), ["Phase 1", "步骤二", "Final"]);
});

test("screenshot-style whole-line bold titles need no keywords, numbering or heading marker", () => {
	const source = "**Analyzing voting dynamics**\nI need to explain the outcomes.\n\n**Exploring voting thresholds**\nOrdinary body";
	assert.deepEqual(extractThinkingTitles(source), ["Analyzing voting dynamics", "Exploring voting thresholds"]);
	assert.deepEqual(extractThinkingTitles("**投票边界**\n  **Z**  \n**`peek.ts`**"), ["投票边界", "Z", "peek.ts"]);
	assert.deepEqual(extractThinkingTitles("# A\n**B**\nStep 3: C\n**D**\n**E**"), ["B", "Step 3: C", "D", "E"]);
});

test("partial bold, malformed strong markers, and quoted/code examples are not titles", () => {
	const source = [
		"I am **checking votes** now.", "**First** and **second**", "**not closed", "not opened**",
		"****", "** **", "** leading space**", "**trailing space **", "***italic***",
		"> **quoted**", "    **indented**", "\t**tab code**", "```md", "**fenced**", "```",
		"~~~", "**tilde fence**", "~~~", "**Real**",
	].join("\n");
	assert.deepEqual(extractThinkingTitles(source), ["Real"]);
});

test("chunked bold titles are recognized only when closed, stay deduplicated and bounded", () => {
	const source = "**Start**\nbody\n**Verify boundaries**";
	for (let n = 1; n <= source.length; n++) {
		const part = source.slice(0, n);
		const titles = extractThinkingTitles(part);
		assert.deepEqual(titles, n < "**Start**".length ? [] : n < source.length ? ["Start"] : ["Start", "Verify boundaries"]);
		assert.deepEqual(extractThinkingTitles(part), titles);
	}
	assert.deepEqual(extractThinkingTitles("**A**\n**A**\n**B**\n**C**\n**D**\n**E**"), ["B", "C", "D", "E"]);
});

test("guide words, ordinary prose, quoted/indented examples and code fences are not milestones", () => {
	const source = [
		"Planning: a sentence", "Analyzing the input", "分析约束条件", "检查代码", "Step 2oops",
		"> ## quoted", "    ## indented", "\t## also code", "```md", "## code heading", "Step 2: code", "```",
		"~~~", "## tilde code", "~~~", "## Real", "````md", "```", "## still code", "````", "### After",
	].join("\n");
	assert.deepEqual(extractThinkingTitles(source), ["Real", "After"]);
	assert.deepEqual(extractThinkingTitles("```md\n## unfinished fence"), []);
	assert.deepEqual(extractThinkingTitles("### \n"), []);
});

test("cumulative streams and title growth do not append a new node on every token", () => {
	for (const tail of ["V", "Ve", "Verify", "Verify boundaries"]) {
		const source = `# Start\n## ${tail}`;
		assert.deepEqual(extractThinkingTitles(source), ["Start", tail]);
		assert.deepEqual(extractThinkingTitles(source), ["Start", tail]);
	}
	assert.deepEqual(extractThinkingTitles("# A\nbody\n# A\n# B\n# A"), ["A", "B", "A"]);
});

test("display titles are sanitized without truncating Unicode source identity to 40 code units", () => {
	const title = "分析👩‍💻e\u0301".repeat(30);
	assert.deepEqual(extractThinkingTitles(`## ${title}`), [title]);
	assert.deepEqual(extractThinkingTitles("## \x1b]0;injected\x07**Inspect** `peek.ts`\x1b[31m\x1b[0m"), ["Inspect peek.ts"]);
});

test("phase reduction starts on real thinking, freezes on answer text, and never restarts", () => {
	const idle = createPeekState();
	assert.equal(reducePeek(idle, { thinking: "", text: "plain" }).phase, "idle");
	const thinking = reducePeek(idle, { thinking: "## Start\nbody", text: "" }, 1400);
	assert.deepEqual(thinking, { phase: "thinking", titles: ["Start"], elapsedMs: 1400, outcome: undefined });
	const done = reducePeek(thinking, { thinking: "## Verify", text: "answer" }, 2200);
	assert.deepEqual(done, { phase: "done", titles: ["Verify"], elapsedMs: 2200, outcome: "completed" });
	assert.equal(reducePeek(done, { thinking: "## Late", text: "" }, 9000), done);
	assert.equal(reducePeek(idle, { thinking: "short thought", text: "answer" }).phase, "done");
});

test("title tree uses one root and at most four nodes, never raw reasoning or per-node success", () => {
	const state: PeekState = { phase: "thinking", titles: ["A", "B", "C", "D", "E"], elapsedMs: 14200 };
	assert.deepEqual(buildPeekLabel(state, 1, glyphs, 80).split("\n"), [
		"~ Thinking · 14.2s", "+- B", "+- C", "+- D", "`- / E",
	]);
	assert.equal(buildPeekLabel({ phase: "thinking", titles: [], elapsedMs: 4900 }, 0, glyphs, 80), "~ | Thinking · 4.9s");
	assert.equal(buildPeekLabel({ phase: "thinking", titles: ["分析约束"], elapsedMs: 4900 }, 7, resolveGlyphs("unicode"), 80, "zh"), "💡 思考 · 4.9s\n└─ ⠧ 分析约束");
});

test("native spinner overrides fallback frames, preserves custom/empty indicators and stays sanitized", () => {
	const state: PeekState = { phase: "thinking", titles: ["Verify"], elapsedMs: 1000 };
	for (const frame of [0, 1, 999]) {
		assert.ok(buildPeekLabel(state, frame, resolveGlyphs("unicode"), 80, "en", "\x1b[31m⠴\x1b[0m").endsWith("⠴ Verify"));
		assert.ok(buildPeekLabel(state, frame, glyphs, 80, "en", "\x1b[31m⠴\x1b[0m").endsWith("- Verify"));
		assert.ok(buildPeekLabel(state, frame, glyphs, 80, "en", "custom").endsWith("custom Verify"));
	}
	assert.equal(buildPeekLabel({ ...state, titles: [] }, 0, glyphs, 80, "en", ""), "~ Thinking · 1.0s");
	assert.ok(buildPeekLabel(state, 0, glyphs, 80, "en", "").endsWith("`- Verify"));
	for (const width of [1, 8, 30]) {
		const label = buildPeekLabel(state, 0, glyphs, width, "en", "\x1b]0;unsafe\x07\x1b[2J👩‍💻e\u0301".repeat(20));
		assert.ok(!label.replace(/\x1b\[0m/g, "").includes("\x1b"));
		assert.ok(label.split("\n").every((row) => visibleWidth(row) <= width));
	}
});

test("terminal summaries are single-row, title-before-time, and outcome-specific in every icon mode", () => {
	for (const mode of ["nerd", "unicode", "ascii"] as const) {
		const icons = resolveGlyphs(mode);
		for (const outcome of ["completed", "interrupted", "failed", "ended"] as const) {
			const mark = { completed: icons.done, interrupted: icons.interrupted, failed: icons.failed, ended: icons.ended }[outcome];
			const state: PeekState = { phase: "done", titles: ["old", "Verify"], elapsedMs: 68000, outcome };
			assert.equal(buildPeekLabel(state, 3, icons, 80), `${icons.thinking} ${mark} Verify · 1m 8s`);
			assert.equal(buildPeekLabel({ ...state, titles: [] }, 3, icons, 80), `${icons.thinking} ${mark} · 1m 8s`);
		}
		assert.equal(buildPeekLabel({ phase: "done", titles: [] }, 0, icons, 80), `${icons.thinking} ${icons.ended}`);
	}
});

test("long CJK titles never displace state and measured time, including 80-column regression", () => {
	for (const mode of ["nerd", "unicode", "ascii"] as const) {
		const icons = resolveGlyphs(mode);
		for (const width of [16, 30, 77, 80, 200]) {
			const state: PeekState = { phase: "done", outcome: "completed", titles: ["分析".repeat(40)], elapsedMs: 68000 };
			const line = plain(buildPeekLabel(state, 0, icons, width));
			assert.ok(line.startsWith(`${icons.thinking} ${icons.done}`));
			assert.ok(line.endsWith("1m 8s"));
			assert.ok(visibleWidth(line) <= width);
			const running = buildPeekLabel({ ...state, phase: "thinking" }, 0, icons, width);
			assert.ok(plain(running.split("\n")[0]!).endsWith("1m 8s"));
		}
	}
});

test("all rows remain bounded for tiny widths, graphemes, emoji, control sequences and all modes", () => {
	for (const mode of ["nerd", "unicode", "ascii"] as const) {
		for (const width of [1, 2, 3, 8, 30, 77, 200]) {
			for (const phase of ["thinking", "done"] as const) {
				const title = "\x1b]0;bad\x07\x1b[31m思考👩‍💻e\u0301\x1b[2J".repeat(20);
				const rows = buildPeekLabel({ phase, titles: [title, title, title, title], elapsedMs: 14200 }, 2, resolveGlyphs(mode), width).split("\n");
				assert.ok(rows.length <= (phase === "done" ? 1 : 5));
				assert.ok(rows.every((row) => visibleWidth(row) <= width));
				assert.ok(!rows.join("").includes("\x1b]"));
				assert.ok(!rows.join("").includes("\x1b[2J"));
			}
		}
	}
});

test("shared duration formatting keeps explicit precision policies and long durations consistent", () => {
	assert.equal(formatDuration(14200), "14s");
	assert.equal(formatDuration(14200, "precise"), "14.2s");
	assert.equal(formatDuration(80, "tool"), "80ms");
	assert.equal(formatDuration(14200, "tool"), "14.2s");
	for (const policy of ["seconds", "precise", "tool"] as const) {
		assert.equal(formatDuration(68000, policy), "1m 8s");
		assert.equal(formatDuration(3661000, policy), "1h 1m 1s");
	}
	assert.equal(formatDuration(-1, "precise"), "0.0s");
});
