import assert from "node:assert/strict";
import test from "node:test";
import type { Terminal, TUI } from "@earendil-works/pi-tui";
import { installCursorOutput } from "../src/cursor-output.ts";

const BEGIN = "\x1b[?2026h";
const END = "\x1b[?2026l";
const SHOW = "\x1b[?25h";
const HIDE = "\x1b[?25l";

function fixture(mode: "regular" | "fullscreen" = "regular", methodsUseWrite = false) {
	const writes: string[] = [];
	const terminal = {
		columns: 80, rows: 24, kittyProtocolActive: false,
		write(data: string) { writes.push(data); },
		showCursor(this: Terminal) { if (methodsUseWrite) this.write(SHOW); else writes.push(SHOW); },
		hideCursor(this: Terminal) { if (methodsUseWrite) this.write(HIDE); else writes.push(HIDE); },
		start() {}, stop() {},
	} as unknown as Terminal;
	let draw = () => {};
	const renderer = {
		mode, terminal,
		doRender() { draw(); },
		renderNow(this: TUI & { doRender(): void }) { this.doRender(); },
		requestRender() {},
	} as unknown as TUI & { doRender(): void };
	const originals = Object.getOwnPropertyDescriptors(renderer);
	const terminalOriginals = Object.getOwnPropertyDescriptors(terminal);
	return { renderer, terminal, writes, originals, terminalOriginals, draw: (fn: () => void) => { draw = fn; } };
}

for (const methodsUseWrite of [false, true]) {
	test(`regular commits final position before sync-end and deduplicates visibility (write method: ${methodsUseWrite})`, () => {
		const f = fixture("regular", methodsUseWrite);
		const adapter = installCursorOutput(f.renderer, () => assert.fail("unexpected fallback"));
		assert.ok(adapter);
		f.draw(() => {
			f.terminal.write(BEGIN + "workline" + END);
			f.terminal.write("\x1b[2A\x1b[3G");
			f.terminal.showCursor();
		});
		f.renderer.doRender();
		assert.equal(f.writes.join(""), BEGIN + "workline\x1b[2A\x1b[3G" + SHOW + END);
		f.writes.length = 0;
		f.renderer.doRender();
		assert.equal(f.writes.join(""), BEGIN + "workline\x1b[2A\x1b[3G" + END);
		f.draw(() => { f.terminal.write("\x1b[4G"); f.terminal.showCursor(); });
		f.writes.length = 0;
		f.renderer.doRender();
		assert.equal(f.writes.join(""), "\x1b[4G", "cursor-only frame still moves without redundant show or artificial sync");
		f.draw(() => f.terminal.hideCursor());
		f.writes.length = 0;
		f.renderer.doRender();
		f.renderer.doRender();
		assert.equal(f.writes.join(""), HIDE);
		adapter.cleanup();
	});
}

test("fullscreen deduplicates embedded visibility without changing its commit ordering", () => {
	const f = fixture("fullscreen");
	const adapter = installCursorOutput(f.renderer, () => {});
	assert.ok(adapter);
	f.draw(() => f.terminal.write(BEGIN + "text\x1b[3;4H" + SHOW + END));
	f.renderer.doRender();
	f.writes.length = 0;
	f.renderer.doRender();
	assert.equal(f.writes.join(""), BEGIN + "text\x1b[3;4H" + END);
	adapter.cleanup();
});

test("controls fragmented at every byte boundary retain data and final-position ordering", () => {
	const data = BEGIN + "工作 👩‍💻 é" + SHOW + END + "\x1b[3G";
	for (let split = 0; split <= data.length; split++) {
		const f = fixture();
		const adapter = installCursorOutput(f.renderer, () => {});
		assert.ok(adapter);
		f.draw(() => { f.terminal.write(data.slice(0, split)); f.terminal.write(data.slice(split)); });
		f.renderer.doRender();
		assert.equal(f.writes.join(""), BEGIN + "工作 👩‍💻 é" + SHOW + "\x1b[3G" + END, `split ${split}`);
		adapter.cleanup();
	}
});

test("OSC, DCS, SOS, PM and APC payloads are opaque, including fragmented terminators", () => {
	for (const prefix of ["]", "P", "X", "^", "_"]) for (const terminator of ["\x1b\\", ...(prefix === "]" ? ["\x07"] : [])]) {
		const f = fixture();
		const adapter = installCursorOutput(f.renderer, () => {});
		assert.ok(adapter);
		// Use a single terminal string, with both an apparent commit and a show inside it.
		const opaque = `\x1b${prefix}payload${END}${SHOW}${terminator}`;
		f.draw(() => {
			f.terminal.write(BEGIN);
			for (const char of opaque) f.terminal.write(char);
			f.terminal.write(END);
			f.terminal.write("\x1b[4G");
			f.terminal.showCursor();
		});
		f.renderer.doRender();
		assert.equal(f.writes.join(""), BEGIN + opaque + "\x1b[4G" + SHOW + END);
		adapter.cleanup();
	}
});

test("large frames stream bounded original chunks synchronously", () => {
	const f = fixture();
	const adapter = installCursorOutput(f.renderer, () => {});
	assert.ok(adapter);
	const chunk = "x".repeat(1024 * 1024);
	f.draw(() => {
		f.terminal.write(BEGIN);
		for (let i = 0; i < 4; i++) {
			f.terminal.write(chunk);
			assert.equal(f.writes.at(-1)?.length, chunk.length, "no frame buffering");
		}
		f.terminal.write(END);
		assert.notEqual(f.writes.at(-1), END, "commit held only until render returns");
		f.terminal.write("\x1b[5G");
		f.terminal.showCursor();
	});
	f.renderer.doRender();
	assert.equal(f.writes.at(-1), END);
	assert.ok(f.writes.every((data) => data.length <= chunk.length));
	adapter.cleanup();
});

test("exceptions close an open synchronized frame and invalidate visibility", () => {
	const f = fixture();
	const adapter = installCursorOutput(f.renderer, () => {});
	assert.ok(adapter);
	f.draw(() => { f.terminal.write(BEGIN); f.terminal.showCursor(); throw new Error("render failure"); });
	assert.throws(() => f.renderer.doRender(), /render failure/);
	assert.equal(f.writes.at(-1), END);
	f.writes.length = 0;
	f.draw(() => f.terminal.showCursor());
	f.renderer.doRender();
	assert.equal(f.writes.join(""), SHOW);
	adapter.cleanup();
});

test("malformed/incomplete controls do not strand sync mode or grow CSI carry", () => {
	for (const tail of ["\x1b[?", "\x1b]unterminated", "\x1b[" + "1;".repeat(1000)]) {
		const f = fixture();
		const adapter = installCursorOutput(f.renderer, () => {});
		assert.ok(adapter);
		f.draw(() => f.terminal.write(BEGIN + tail));
		f.renderer.doRender();
		assert.equal(f.writes.join(""), BEGIN + tail + "\x18" + END);
		adapter.cleanup();
	}
});

test("out-of-render output, forced redraw, private modes and terminal lifecycle invalidate cache", () => {
	const f = fixture();
	const adapter = installCursorOutput(f.renderer, () => {});
	assert.ok(adapter);
	f.draw(() => f.terminal.showCursor());
	f.renderer.doRender();
	for (const invalidate of [
		() => f.terminal.write("external output"),
		() => f.renderer.requestRender(true),
		() => f.terminal.stop(),
		() => f.terminal.start(() => {}, () => {}),
	]) {
		invalidate();
		f.writes.length = 0;
		f.renderer.doRender();
		assert.equal(f.writes.join(""), SHOW);
	}
	for (const control of ["\x1bc", "\x1b8", "\x1b[u", "\x1b[?1049h", "\x1b[?25;7l"]) {
		f.writes.length = 0;
		f.draw(() => { f.terminal.write(control); f.terminal.showCursor(); });
		f.renderer.doRender();
		assert.equal(f.writes.join(""), control + SHOW);
	}
	f.writes.length = 0;
	f.terminal.showCursor();
	f.terminal.showCursor();
	assert.equal(f.writes.join(""), SHOW + SHOW, "never suppress shell-owned operations");
	adapter.cleanup();
});

test("cleanup exactly restores descriptors and is idempotent", () => {
	const f = fixture();
	const adapter = installCursorOutput(f.renderer, () => {});
	assert.ok(adapter);
	adapter.refresh();
	adapter.cleanup();
	adapter.cleanup();
	assert.deepEqual(Object.getOwnPropertyDescriptors(f.renderer), f.originals);
	assert.deepEqual(Object.getOwnPropertyDescriptors(f.terminal), f.terminalOriginals);
});

test("later wrappers survive cleanup; retained adapter wrappers become inert", () => {
	const f = fixture();
	const adapter = installCursorOutput(f.renderer, () => {});
	assert.ok(adapter);
	const retainedWrite = f.terminal.write;
	const retainedRender = f.renderer.doRender;
	let calls = 0;
	const laterWrite = function (this: Terminal, data: string) { calls++; retainedWrite.call(this, data); };
	const laterRender = function (this: typeof f.renderer) { retainedRender.call(this); };
	f.terminal.write = laterWrite;
	f.renderer.doRender = laterRender;
	adapter.cleanup();
	assert.equal(f.terminal.write, laterWrite);
	assert.equal(f.renderer.doRender, laterRender);
	f.draw(() => f.terminal.write(BEGIN + "native" + END));
	f.renderer.doRender();
	assert.equal(f.writes.join(""), BEGIN + "native" + END);
	assert.equal(calls, 1);
});

test("unsupported and partially non-writable surfaces leave no patches or probe symbols", () => {
	for (const key of ["showCursor", "doRender"]) {
		const f = fixture();
		const target = key === "doRender" ? f.renderer : f.terminal;
		Object.defineProperty(target, key, { configurable: false, writable: false });
		const beforeRenderer = Object.getOwnPropertyDescriptors(f.renderer);
		const beforeTerminal = Object.getOwnPropertyDescriptors(f.terminal);
		assert.equal(installCursorOutput(f.renderer, () => {}), undefined);
		assert.deepEqual(Object.getOwnPropertyDescriptors(f.renderer), beforeRenderer);
		assert.deepEqual(Object.getOwnPropertyDescriptors(f.terminal), beforeTerminal);
	}
	const frozen = Object.freeze(fixture().renderer);
	assert.equal(installCursorOutput(frozen, () => {}), undefined);
	const f = fixture();
	Reflect.deleteProperty(f.renderer, "doRender");
	assert.equal(installCursorOutput(f.renderer, () => {}), undefined);
	assert.equal(Object.getOwnPropertySymbols(f.renderer).length, 0);
});

test("missing public render methods or an asynchronous render seam are rejected", () => {
	for (const key of ["requestRender", "renderNow"]) {
		const f = fixture();
		Reflect.deleteProperty(f.renderer, key);
		const before = Object.getOwnPropertyDescriptors(f.terminal);
		assert.equal(installCursorOutput(f.renderer, () => {}), undefined);
		assert.deepEqual(Object.getOwnPropertyDescriptors(f.terminal), before);
	}
	const f = fixture();
	f.renderer.doRender = async () => {};
	assert.equal(installCursorOutput(f.renderer, () => {}), undefined);
	assert.equal(Object.getOwnPropertySymbols(f.renderer).length, 0);
});

test("partial fullscreen terminal-write failure still attempts sync-end and invalidates visibility", () => {
	const f = fixture("fullscreen");
	let failed = false;
	const nativeWrite = f.terminal.write;
	f.terminal.write = function (this: Terminal, data: string) {
		if (!failed && data.includes(BEGIN)) {
			failed = true;
			f.writes.push(BEGIN); // A terminal/wrapper emitted a prefix, then threw.
			throw new Error("partial write");
		}
		return nativeWrite.call(this, data);
	};
	const adapter = installCursorOutput(f.renderer, () => {});
	assert.ok(adapter);
	f.draw(() => f.terminal.write(BEGIN + "text" + SHOW + END));
	assert.throws(() => f.renderer.doRender(), /partial write/);
	assert.equal(f.writes.join(""), BEGIN + END);
	f.writes.length = 0;
	f.draw(() => f.terminal.showCursor());
	f.renderer.doRender();
	assert.equal(f.writes.join(""), SHOW);
	adapter.cleanup();
});
