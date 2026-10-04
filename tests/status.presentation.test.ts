import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPackageDir } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { AgentStatus } from "../src/status.ts";
import { statusUI } from "./fixtures/status-ui.ts";

function statusFor(host: Awaited<ReturnType<typeof statusUI>>) {
	// Hold task time fixed: theme changes must work without task events or refresh timers.
	// Exact five-second expiry and elapsed-time progression are covered in status.test.ts.
	const status = new AgentStatus({ now: () => 0, schedule: () => () => {} });
	status.bind({ mode: "tui", ui: host.ui });
	return status;
}

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Missing status row");
	return value;
}

async function waitFor(predicate: () => boolean) {
	const deadline = Date.now() + 5000;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("Theme watcher timed out");
		await Bun.sleep(10);
	}
}

test.serial(
	"composed Pi widget has two-column insets and exactly one host-aware gap above/below",
	async () => {
		const host = await statusUI();
		const status = statusFor(host);
		try {
			status.add("宽 é 👩‍💻 ".repeat(30));
			const lines = host
				.frame(80)
				.split("\n")
				.map((line) => line.trimEnd());
			expect(lines).toHaveLength(8);
			expect(lines[0]).toBe("CONTENT SENTINEL");
			expect(lines[1]).toBe("");
			expect(lines[2]).toBe("  Agents");
			expect(lines[3]?.startsWith("  1  ")).toBe(true);
			expect(lines[3]).toContain("0 turns · pressure: none");
			expect(lines[4]).toBe(
				"    │  model: unconfirmed · thinking: unconfirmed",
			);
			expect(lines[5]).toBe("    └─ initializing…");
			expect(lines[6]).toBe("");
			expect(lines[7]).toBe("INPUT SENTINEL");
			for (const index of [2, 3, 4, 5])
				expect(visibleWidth(required(lines[index]))).toBeLessThanOrEqual(78);
			for (const width of [1, 2, 8, 20, 40, 42, 44, 50, 80, 160, 50, 80]) {
				for (const line of host.styledFrame(width).split("\n"))
					expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
			const summaryWidth = visibleWidth("1   · 0s · 0 turns · pressure: none");
			for (const padding of [0, 1, 2]) {
				const line = required(status.render(summaryWidth + 2 * padding)[1]);
				expect(line.startsWith(`${" ".repeat(padding)}1`)).toBe(true);
				expect(line).toContain("pressure: none");
			}
			expect(status.render(0)).toEqual([]);
			expect(stripTerminalSequences(required(status.render(1)[1]))).toBe("1");
			status.clear();
			expect(host.frame()).not.toContain("Agents");
		} finally {
			status.close();
			host.tui.stop();
		}
	},
);

test.serial(
	"all activity/outcome and pressure roles preserve text, metadata hierarchy, and sanitization",
	async () => {
		const host = await statusUI();
		const status = statusFor(host);
		const fg = (role: Parameters<typeof host.ui.theme.fg>[0], text: string) =>
			host.ui.theme.fg(role, text);
		try {
			const one = required(
				status.add("fallback\nSECRET", "\x1b[31mClean\x1b[0m\nSECRET"),
			);
			expect(host.styledFrame()).toContain(fg("text", "1  Clean"));
			expect(host.styledFrame()).toContain(fg("muted", " · 0s · 0 turns · "));
			expect(host.styledFrame()).toContain(fg("dim", "pressure: none"));
			expect(host.styledFrame()).toContain(fg("muted", "initializing…"));
			one.observe({ type: "agent_start" });
			expect(host.styledFrame()).toContain(fg("accent", "running…"));
			one.observe({
				type: "message_update",
				assistantMessageEvent: { type: "thinking_start" },
			});
			expect(host.styledFrame()).toContain(fg("accent", "thinking…"));
			one.observe({
				type: "tool_execution_start",
				toolCallId: "a",
				toolName: "\x1b]8;;SECRET LINK\x07read\x1b]8;;\x07",
			});
			expect(host.styledFrame()).toContain(fg("accent", "toolcall · read"));
			expect(host.styledFrame()).not.toContain("\x1b]8;");
			one.observe({ type: "tool_execution_end", toolCallId: "a" });
			one.observe({ type: "turn_end" });
			expect(host.styledFrame()).toContain(fg("muted", " · 0s · 1 turn · "));
			one.observe({ type: "agent_settled" });
			expect(host.styledFrame()).toContain(fg("muted", "finishing…"));
			one.accepted("warning");
			expect(host.styledFrame()).toContain(fg("warning", "pressure: warning"));
			one.accepted("urgent");
			one.accepted("warning");
			one.finish("completed");
			expect(host.styledFrame()).toContain(fg("success", "completed"));
			expect(host.styledFrame()).toContain(fg("error", "pressure: urgent"));
			expect(host.frame()).toContain("└─ completed");
			expect(host.frame()).not.toContain("SECRET");
			for (const [outcome, role] of [
				["incomplete", "warning"],
				["failed", "error"],
				["cancelled", "muted"],
			] as const) {
				required(status.add(outcome)).finish(outcome);
				expect(host.styledFrame()).toContain(fg(role, outcome));
			}
			for (const width of [1, 2, 8, 20, 50, 80, 160]) {
				for (const line of status.render(width, host.ui.theme))
					expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		} finally {
			status.close();
			host.tui.stop();
		}
	},
);

test.serial(
	"real Pi theme switch and custom-file hot reload update existing rows without task events",
	async () => {
		const host = await statusUI();
		const status = statusFor(host);
		const agentDir = await mkdtemp(join(tmpdir(), "delegate-status-theme-"));
		const previousDir = process.env.PI_CODING_AGENT_DIR;
		try {
			host.tui.start();
			const running = required(status.add("running row"));
			running.configured?.({
				model: { provider: "provider", id: "theme/id" },
				thinkingLevel: "low",
			});
			running.observe({ type: "agent_start" });
			running.observe({
				type: "message_update",
				assistantMessageEvent: { type: "thinking_start" },
			});
			const finished = required(status.add("retained row"));
			finished.configured?.({
				model: { provider: "other", id: "retained" },
				thinkingLevel: "off",
			});
			finished.accepted("urgent");
			finished.finish("completed");
			const plain = host.frame();
			const initialWidget = host.above.get("pi-delegate:agents");
			const source = JSON.parse(
				await readFile(
					join(getPackageDir(), "dist/modes/interactive/theme/dark.json"),
					"utf8",
				),
			);
			const custom = {
				...source,
				name: "delegate-status-fixture",
				colors: {
					...source.colors,
					accent: "#123456",
					success: "#456789",
					error: "#987654",
				},
			};
			process.env.PI_CODING_AGENT_DIR = agentDir;
			await mkdir(join(agentDir, "themes"));
			const themeFile = join(agentDir, "themes", `${custom.name}.json`);
			await writeFile(themeFile, JSON.stringify(custom));
			for (const name of ["light", "dark", "system", custom.name]) {
				const changes = host.themeChanges();
				const outputStart = host.output().length;
				expect(host.themes.setTheme(name, name === custom.name).success).toBe(
					true,
				);
				expect(host.themeChanges()).toBe(changes + 1);
				expect(host.above.get("pi-delegate:agents")).toBe(initialWidget);
				expect(host.styledFrame()).toContain(
					host.ui.theme.fg("accent", "thinking…"),
				);
				expect(host.styledFrame()).toContain(
					host.ui.theme.fg("success", "completed"),
				);
				expect(host.styledFrame()).toContain(
					host.ui.theme.fg("error", "pressure: urgent"),
				);
				await waitFor(() =>
					host
						.output()
						.slice(outputStart)
						.includes(host.ui.theme.fg("accent", "thinking…")),
				);
				expect(host.frame()).toBe(plain);
			}
			const oldAccent = host.ui.theme.fg("accent", "thinking…");
			const oldSuccess = host.ui.theme.fg("success", "completed");
			const changes = host.themeChanges();
			const outputStart = host.output().length;
			await writeFile(
				themeFile,
				JSON.stringify({
					...custom,
					colors: { ...custom.colors, accent: "#abcdef", success: "#fedcba" },
				}),
			);
			await waitFor(() => host.themeChanges() > changes);
			await waitFor(() =>
				host
					.output()
					.slice(outputStart)
					.includes(host.ui.theme.fg("accent", "thinking…")),
			);
			expect(host.styledFrame()).not.toContain(oldAccent);
			expect(host.styledFrame()).not.toContain(oldSuccess);
			expect(host.styledFrame()).toContain(
				host.ui.theme.fg("accent", "thinking…"),
			);
			expect(host.styledFrame()).toContain(
				host.ui.theme.fg("success", "completed"),
			);
			expect(stripTerminalSequences(host.styledFrame())).toBe(plain);
			expect(host.above.get("pi-delegate:agents")).toBe(initialWidget);
		} finally {
			host.themes.stopThemeWatcher();
			if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousDir;
			host.themes.initTheme("dark");
			status.close();
			host.tui.stop();
			await rm(agentDir, { recursive: true, force: true });
		}
	},
);

test.serial(
	"composed configuration rows align connector and activity text, sanitize IDs, and fit resized widths",
	async () => {
		const host = await statusUI();
		const status = statusFor(host);
		try {
			for (let i = 1; i <= 10; i++) {
				const row = required(status.add(`task ${i}`));
				row.configured?.({
					model: {
						provider: "宽é",
						id: "\x1b[31mexact/id:variant\x1b[0m\nsecond\u2028third\x1b]8;;HIDDEN LINK\x07\x1b]8;;\x07",
					},
					thinkingLevel: "low",
				});
				row.observe({ type: "agent_start" });
				if (i === 1)
					row.observe({
						type: "message_update",
						assistantMessageEvent: { type: "thinking_start" },
					});
				if (i === 2)
					row.observe({
						type: "tool_execution_start",
						toolCallId: "call",
						toolName: "read",
					});
				if (i === 10) row.finish("completed");
			}
			for (const width of [1, 2, 8, 20, 40, 50, 80, 160, 80]) {
				const lines = host.frame(width).split("\n");
				for (const line of host.styledFrame(width).split("\n"))
					expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				for (let i = 0; i < lines.length; i++) {
					const metadata = required(lines[i]);
					if (!metadata.includes("│") || !metadata.includes("model:")) continue;
					const activity = required(lines[i + 1]);
					expect(visibleWidth(metadata.slice(0, metadata.indexOf("│")))).toBe(
						visibleWidth(activity.slice(0, activity.indexOf("└"))),
					);
					expect(
						visibleWidth(metadata.slice(0, metadata.indexOf("model:"))),
					).toBe(visibleWidth(activity.slice(0, activity.indexOf("└") + 3)));
				}
			}
			const plain = host.frame(160);
			expect(plain).toContain("10  task 10");
			expect(plain).toContain("thinking: low");
			expect(plain).toContain("└─ thinking…");
			expect(plain).toContain("└─ toolcall · read");
			expect(plain).toContain("└─ completed");
			expect(plain).not.toContain("HIDDEN");
			expect(plain).not.toContain("\u2028");
		} finally {
			status.close();
			host.tui.stop();
		}
	},
);
