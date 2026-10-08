import { expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type ExtensionAPI,
	getPackageDir,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	CURSOR_MARKER,
	Input,
	stripTerminalSequences,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { registerTaskPanel, TaskPanel } from "../src/task-panel.ts";
import { TaskRecords } from "../src/tasks.ts";
import { statusUI } from "./fixtures/status-ui.ts";
import { taskInput, taskResult } from "./fixtures/task-record.ts";

async function setup(height = () => 24) {
	const host = await statusUI();
	const records = new TaskRecords();
	const calls: { action: string; id: string; text?: string }[] = [];
	let closes = 0;
	let renders = 0;
	const panel = new TaskPanel(
		records,
		{
			cancel: async (id) => {
				calls.push({ action: "cancel", id });
				return { content: [{ type: "text", text: "cancelled" }] };
			},
			steer: async (id, text) => {
				calls.push({ action: "steer", id, text });
				return {
					content: [{ type: "text", text: "accepted queued; not execution" }],
				};
			},
		},
		() => host.ui.theme,
		height,
		() => {
			renders++;
		},
		() => {
			closes++;
		},
	);
	panel.focused = true;
	const frame = (width = 100) =>
		stripTerminalSequences(panel.render(width).join("\n"));
	return {
		host,
		records,
		calls,
		panel,
		frame,
		closes: () => closes,
		renders: () => renders,
		dispose: () => {
			panel.dispose();
			host.tui.stop();
		},
	};
}
const down = "\x1b[B",
	enter = "\r",
	esc = "\x1b",
	tab = "\t";

test.serial(
	"filter changes keep the heading, footer and label columns fixed",
	async () => {
		let height = 24;
		const s = await setup(() => height);
		try {
			const active = s.records.accept({ ...taskInput, title: "Active task" });
			for (let i = 0; i < 8; i++)
				s.records
					.accept({ ...taskInput, title: `Finished ${i}` })
					.complete(taskResult());
			const capture = () => s.panel.render(100).map(stripTerminalSequences);
			const check = () => {
				const frames: string[][] = [];
				for (let i = 0; i < 3; i++) {
					frames.push(capture());
					s.panel.handleInput(tab);
				}
				for (const frame of frames) {
					expect(frame).toHaveLength(height);
					expect(frame[1]?.trim()).toBe("Delegated Tasks");
					expect(frame[height - 2]).toContain("Tab: filter");
					for (const name of ["All", "Active", "Finished"])
						expect(frame[2]?.indexOf(name)).toBe(frames[0]?.[2]?.indexOf(name));
				}
			};
			check();
			active.complete(taskResult()); // Active becomes empty; live updates must not move the heading.
			check();
			s.records.accept(taskInput);
			check();
			for (const h of [9, 14, 32]) {
				height = h;
				check();
			}
		} finally {
			s.dispose();
		}
	},
);

test.serial(
	"detail tabs and action pages keep a stable frame through resize",
	async () => {
		let height = 24;
		const s = await setup(() => height);
		try {
			const record = s.records.accept({ ...taskInput, title: "Layout task" });
			record.controlled({
				state: () => "ready",
				steer: async () => ({ status: "accepted", disposition: "queued" }),
			});
			const capture = (width: number) => {
				const lines = s.panel.render(width);
				expect(lines).toHaveLength(height);
				for (const line of lines)
					expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				return lines.map(stripTerminalSequences);
			};
			s.frame();
			s.panel.handleInput(enter);
			for (const h of [1, 2, 8, 9, 24, 32]) {
				height = h;
				for (const width of [20, 100]) {
					const overview = capture(width);
					s.panel.handleInput(tab);
					const result = capture(width);
					expect(result[height < 9 ? 0 : 1]).toBe(overview[height < 9 ? 0 : 1]);
					if (height >= 9) {
						for (const name of ["Overview", "Result"])
							expect(result[2]?.indexOf(name)).toBe(overview[2]?.indexOf(name));
					}
					s.panel.handleInput(tab);
				}
			}
			height = 24;
			const detail = capture(100);
			s.panel.handleInput("c");
			expect(capture(100)[1]).toBe(detail[1]);
			s.panel.handleInput(esc);
			s.panel.handleInput("s");
			s.panel.handleInput("q中文");
			expect(capture(100)[1]).toBe(detail[1]);
			expect(s.frame()).toContain("q中文");
			expect(s.calls).toHaveLength(0);
		} finally {
			s.dispose();
		}
	},
);
test.serial(
	"floating component filters, stable IDs, result scrolling and close without controls",
	async () => {
		const s = await setup();
		try {
			const one = s.records.accept({ ...taskInput, title: "One" });
			const two = s.records.accept({
				...taskInput,
				title: "Two",
				mode: "synchronous",
			});
			s.frame();
			s.panel.handleInput(down);
			one.complete(taskResult());
			s.frame();
			s.panel.handleInput(enter);
			expect(s.frame()).toContain(`#2  Two`);
			expect(s.frame()).toContain("Mode: synchronous");
			s.panel.handleInput("c");
			s.panel.handleInput("s");
			expect(s.calls).toHaveLength(0);
			two.complete({
				...taskResult(),
				content: [
					{
						type: "text",
						text: Array.from({ length: 80 }, (_, i) => `Result line ${i}`).join(
							"\n",
						),
					},
				],
			});
			s.panel.handleInput(tab);
			expect(s.frame()).toContain("Result line 0");
			for (let i = 0; i < 30; i++) s.panel.handleInput(down);
			expect(s.frame()).not.toContain("Result line 0");
			s.panel.handleInput(esc);
			s.panel.handleInput(tab);
			expect(s.frame()).toContain("No tasks");
			s.panel.handleInput(tab);
			expect(s.frame()).toContain("[Finished]");
			expect(s.frame()).toContain("Two");
			s.panel.handleInput(esc);
			expect(s.closes()).toBe(1);
			expect(s.records.list().total).toBe(2);
			expect(s.calls).toHaveLength(0);
		} finally {
			s.dispose();
		}
	},
);

test.serial(
	"instruction composition preserves q/Unicode/cursor focus and truthful receipt",
	async () => {
		const s = await setup();
		try {
			const record = s.records.accept(taskInput);
			record.controlled({
				state: () => "ready",
				steer: async () => ({ status: "accepted", disposition: "queued" }),
			});
			s.frame();
			s.panel.handleInput(enter);
			s.panel.handleInput("s");
			s.panel.handleInput("q");
			s.panel.handleInput("中文");
			expect(s.frame()).toContain("q中文");
			expect(s.panel.render(100).join("\n")).toContain(CURSOR_MARKER);
			s.panel.focused = false;
			expect(s.panel.render(100).join("\n")).not.toContain(CURSOR_MARKER);
			s.panel.focused = true;
			s.panel.handleInput(enter);
			await Bun.sleep(0);
			expect(s.calls).toEqual([
				{ action: "steer", id: record.taskId, text: "q中文" },
			]);
			for (let i = 0; i < 30; i++) {
				s.frame();
				s.panel.handleInput(down);
			}
			expect(s.frame()).toContain("accepted queued; not execution");
			s.panel.handleInput("s");
			s.panel.handleInput("discard");
			s.panel.handleInput(esc);
			expect(s.calls).toHaveLength(1);
		} finally {
			s.dispose();
		}
	},
);

test.serial(
	"cancel requires confirmation, queued tasks are cancellable, and terminal race does not dispatch",
	async () => {
		const s = await setup();
		try {
			const record = s.records.accept(taskInput);
			s.frame();
			s.panel.handleInput(enter);
			s.panel.handleInput("c");
			expect(s.frame()).toContain("does not roll back");
			expect(s.frame()).toContain(record.taskId);
			expect(s.calls).toHaveLength(0);
			s.panel.handleInput(esc);
			expect(s.calls).toHaveLength(0);
			s.panel.handleInput("c");
			s.frame();
			record.complete(taskResult());
			s.panel.handleInput(enter);
			await Bun.sleep(0);
			expect(s.calls).toHaveLength(0);
		} finally {
			s.dispose();
		}
	},
);

test.serial(
	"pending cleanup stays responsive; scope invalidation closes and late receipts do not redraw",
	async () => {
		const host = await statusUI();
		const records = new TaskRecords();
		let finish!: () => void;
		let closes = 0;
		let renders = 0;
		const panel = new TaskPanel(
			records,
			{
				cancel: async () => {
					await new Promise<void>((resolve) => {
						finish = resolve;
					});
					return { content: [{ type: "text", text: "late cleanup" }] };
				},
				steer: async () => ({ content: [] }),
			},
			() => host.ui.theme,
			() => 24,
			() => {
				renders++;
			},
			() => {
				closes++;
			},
		);
		try {
			records.accept(taskInput);
			panel.render(100);
			panel.handleInput(enter);
			panel.handleInput("c");
			panel.render(100);
			panel.handleInput(enter);
			await Bun.sleep(0);
			expect(finish).toBeDefined();
			panel.handleInput(esc);
			expect(stripTerminalSequences(panel.render(100).join("\n"))).toContain(
				"Delegated Tasks",
			);
			records.invalidate();
			expect(closes).toBe(1);
			const count = renders;
			finish();
			await Bun.sleep(0);
			expect(renders).toBe(count);
			expect(panel.render(100)).toEqual([]);
		} finally {
			finish?.();
			panel.dispose();
			host.tui.stop();
		}
	},
);

test.serial(
	"unsafe metadata/results are sanitized, Unicode fits resize and theme changes affect existing panel",
	async () => {
		const s = await setup();
		try {
			const task = s.records.accept({
				...taskInput,
				title: "\x1b[31m宽👩‍💻 é\x1b[0m",
			});
			for (const width of [1, 2, 8, 20, 40, 80, 120])
				for (const line of s.panel.render(width))
					expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			const dark = s.panel.render(100).join("\n");
			s.host.themes.setTheme("light");
			s.panel.invalidate();
			expect(s.panel.render(100).join("\n")).not.toBe(dark);
			task.complete({
				...taskResult(),
				content: [
					{
						type: "text",
						text: "\x1b]8;;https://evil.example\x07unsafe\x1b]8;;\x07\n\x1b[2Jresult",
					},
				],
			});
			s.panel.handleInput(enter);
			s.panel.handleInput(tab);
			expect(s.panel.render(100).join("\n")).not.toContain(
				"https://evil.example",
			);
			expect(s.frame()).toContain("unsafe");
			expect(s.frame()).toContain("result");
			for (const line of s.panel.render(20))
				expect(visibleWidth(line)).toBeLessThanOrEqual(20);
			expect(s.panel.render(100).length).toBeLessThanOrEqual(24);
		} finally {
			s.dispose();
		}
	},
);

test.serial(
	"actual Pi custom-overlay adapter creates/disposes a single panel and restores editor focus",
	async () => {
		const host = await statusUI();
		const { InteractiveMode } = await import(
			pathToFileURL(
				join(getPackageDir(), "dist/modes/interactive/interactive-mode.js"),
			).href
		);
		class Editor extends Input {
			getText() {
				return this.getValue();
			}
			setText(text: string) {
				this.setValue(text);
			}
		}
		const editor = new Editor();
		editor.setValue("original editor text");
		host.tui.setFocus(editor);
		let current!: TaskPanel;
		const notices: string[] = [];
		const receiver = {
			ui: host.tui,
			editor,
			editorContainer: new Container(),
			keybindings: {},
		};
		let handler!: Parameters<ExtensionAPI["registerCommand"]>[1]["handler"];
		const records = new TaskRecords();
		records.accept(taskInput);
		registerTaskPanel(
			{
				registerCommand: (_name, command) => {
					handler = command.handler;
				},
			} as ExtensionAPI,
			records,
			{
				cancel: async () => ({ content: [] }),
				steer: async () => ({ content: [] }),
			},
		);
		const ctx = {
			mode: "tui",
			ui: {
				notify: (message: string) => notices.push(message),
				get theme() {
					return host.ui.theme;
				},
				custom: (
					factory: Parameters<
						import("@earendil-works/pi-coding-agent").ExtensionUIContext["custom"]
					>[0],
					options: unknown,
				) =>
					InteractiveMode.prototype.showExtensionCustom.call(
						receiver,
						async (...args: Parameters<typeof factory>) => {
							current = (await factory(...args)) as TaskPanel;
							return current;
						},
						options,
					),
			},
		};
		try {
			const command = handler("", ctx as never);
			await Bun.sleep(0);
			expect(host.tui.hasOverlay()).toBe(true);
			expect(editor.focused).toBe(false);
			// Use the real renderer's focused component input path, not a fake command close.
			expect(current).toBeInstanceOf(TaskPanel);
			expect(current.focused).toBe(true);
			// Exercise the real host compositor: constant component height must keep
			// the heading at the same terminal row/column when a filter becomes empty.
			const compositor = host.tui as unknown as {
				compositeOverlays(
					lines: string[],
					width: number,
					height: number,
				): string[];
			};
			const headingPosition = () => {
				const lines = compositor
					.compositeOverlays([], 160, 40)
					.map(stripTerminalSequences);
				const row = lines.findIndex((line) => line.includes("Delegated Tasks"));
				expect(row).toBeGreaterThanOrEqual(0);
				return { row, col: lines[row]?.indexOf("Delegated Tasks") };
			};
			const position = headingPosition();
			for (let i = 0; i < 6; i++) {
				current.handleInput(tab);
				expect(headingPosition()).toEqual(position);
			}
			const first = current;
			await handler("", ctx as never);
			expect(current).toBe(first);
			expect(notices).toEqual(["The task panel is already open."]);
			current.handleInput(esc);
			await command;
			expect(host.tui.hasOverlay()).toBe(false);
			expect(editor.focused).toBe(true);
			expect(editor.getValue()).toBe("original editor text");
			expect(records.list().total).toBe(1);
			const second = handler("", ctx as never);
			await Bun.sleep(0);
			expect(host.tui.hasOverlay()).toBe(true);
			records.invalidate();
			await second;
			expect(host.tui.hasOverlay()).toBe(false);
			expect(editor.focused).toBe(true);
			expect(editor.getValue()).toBe("original editor text");
			expect(first.render(100)).toEqual([]);
			await handler("", {
				mode: "rpc",
				ui: { notify: (message: string) => notices.push(message) },
			} as never);
			expect(notices.at(-1)).toContain("use delegate_list and delegate_status");
		} finally {
			records.invalidate();
			host.tui.stop();
		}
	},
);

test.serial(
	"very short resize stays bounded without losing selection or composition",
	async () => {
		let height = 24;
		const s = await setup(() => height);
		try {
			const record = s.records.accept({ ...taskInput, mode: "synchronous" });
			expect(s.frame(32)).toContain("sync");
			expect(s.frame(32)).toContain("queued");
			s.panel.handleInput(enter);
			for (const h of [1, 2, 4, 8, 24]) {
				height = h;
				expect(s.panel.render(32).length).toBeLessThanOrEqual(h);
			}
			expect(s.frame()).toContain(record.taskId);
			s.panel.handleInput(esc);
			const background = s.records.accept(taskInput);
			background.controlled({
				state: () => "ready",
				steer: async () => ({ status: "accepted", disposition: "queued" }),
			});
			s.panel.handleInput(down);
			s.panel.handleInput(enter);
			s.panel.handleInput("s");
			s.panel.handleInput("q中文");
			height = 2;
			expect(s.panel.render(32).length).toBeLessThanOrEqual(2);
			height = 24;
			expect(s.frame()).toContain("q中文");
			s.panel.handleInput(esc);
			s.panel.handleInput(esc);
			s.panel.handleInput(esc);
			expect(s.closes()).toBe(1);
			expect(s.calls).toHaveLength(0);
		} finally {
			s.dispose();
		}
	},
);

test.serial(
	"cancel warning wraps and cannot be confirmed before a complete usable confirmation render",
	async () => {
		let height = 8;
		const s = await setup(() => height);
		try {
			const record = s.records.accept(taskInput);
			s.frame(32);
			s.panel.handleInput(enter);
			s.panel.handleInput("c");
			s.panel.handleInput(enter);
			expect(s.calls).toHaveLength(0);
			expect(s.frame(32)).toContain("Enlarge terminal");
			s.panel.handleInput(enter);
			expect(s.calls).toHaveLength(0);
			height = 24;
			const frame = s.frame(32).replace(/\s+/g, " ");
			expect(frame).toContain(
				"does not roll back file changes or external side effects.",
			);
			expect(s.panel.render(32).length).toBeLessThanOrEqual(height);
			s.panel.handleInput(enter);
			await Bun.sleep(0);
			expect(s.calls).toEqual([{ action: "cancel", id: record.taskId }]);
		} finally {
			s.dispose();
		}
	},
);
