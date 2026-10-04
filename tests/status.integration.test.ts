import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
	ExtensionAPI,
	ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { registerDelegate, runDelegation } from "../src/delegate.ts";
import { configurationContext } from "./fixtures/configuration-context.ts";
import { statusUI } from "./fixtures/status-ui.ts";

async function waitFor(predicate: () => boolean) {
	const end = Date.now() + 6000;
	while (!predicate()) {
		if (Date.now() > end) throw new Error("Status fixture timed out");
		await Bun.sleep(10);
	}
}

for (const background of [false, true]) {
	for (const reject of [false, true]) {
		test(`real runner + Pi widget/TUI: ${background ? "background" : "sync"} held acknowledgements, urgent ${reject ? "rejected" : "accepted"}`, async () => {
			const dir = await mkdtemp(join(tmpdir(), "status-rpc-"));
			const host = await statusUI();
			const tools = new Map<
				string,
				Parameters<ExtensionAPI["registerTool"]>[0]
			>();
			const hooks = new Map<string, (...args: unknown[]) => unknown>();
			const observed: string[] = [];
			registerDelegate(
				{
					registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
						tools.set(tool.name, tool),
					on: (name: string, handler: (...args: unknown[]) => unknown) => {
						hooks.set(name, handler);
						return () => {};
					},
					getAllTools: () => [],
					getActiveTools: () => [],
					getCommands: () => [],
					sendMessage() {},
				} as unknown as ExtensionAPI,
				(options) =>
					runDelegation({
						...options,
						cliPath: resolve("tests/fixtures/status-rpc.mjs"),
						env: {
							STATUS_FIXTURE_DIR: dir,
							STATUS_FIXTURE_REJECT: reject ? "1" : "0",
						},
						status: options.status && {
							...options.status,
							observe: (record) => {
								options.status?.observe(record);
								observed.push(host.frame());
							},
						},
					}),
			);
			const ctx = {
				...configurationContext,
				cwd: process.cwd(),
				mode: "tui",
				ui: host.ui,
				isProjectTrusted: () => false,
				isIdle: () => false,
				hasPendingMessages: () => false,
			} as ExtensionToolContext;
			const delegate = tools.get("delegate");
			const query = tools.get("delegate_status");
			if (!delegate || !query) throw new Error("Missing registered tools");
			let operation: ReturnType<typeof delegate.execute> | undefined;
			try {
				await hooks.get("session_start")?.({}, ctx);
				host.tui.start();
				operation = delegate.execute(
					"status",
					{
						task: "fallback line\nPRIVATE CONTEXT",
						title: "UI proof",
						background,
						pressure: { warning: { afterTurns: 1 }, urgent: { afterTurns: 2 } },
					},
					undefined,
					undefined,
					ctx,
				);
				await waitFor(() => existsSync(join(dir, "warning-pending")));
				expect(host.frame()).toContain("1  UI proof");
				expect(host.frame()).toContain("2 turns · pressure: none");
				expect(host.styledFrame()).toContain(
					host.ui.theme.fg("dim", "pressure: none"),
				);
				expect(host.frame()).not.toContain("PRIVATE");
				expect(host.frame().indexOf("Agents")).toBeLessThan(
					host.frame().indexOf("INPUT SENTINEL"),
				);
				expect(host.above.size).toBe(1);
				expect(host.below.size).toBe(0);
				expect(observed.some((frame) => frame.includes("thinking…"))).toBe(
					true,
				);
				expect(
					observed.some((frame) => frame.includes("toolcall · read")),
				).toBe(true);
				await writeFile(join(dir, "warning-release"), "release");
				await waitFor(() => existsSync(join(dir, "urgent-pending")));
				expect(host.frame()).toContain("pressure: warning");
				expect(host.styledFrame()).toContain(
					host.ui.theme.fg("warning", "pressure: warning"),
				);
				expect(host.frame()).not.toContain("pressure: urgent");
				await Bun.sleep(30);
				expect(host.output()).toContain("Agents");
				expect(host.output()).toContain("INPUT SENTINEL");
				await writeFile(join(dir, "urgent-release"), "release");
				const result = await operation;
				await waitFor(() =>
					host.frame().includes(reject ? "└─ failed" : "└─ completed"),
				);
				expect(host.frame()).toContain(
					`pressure: ${reject ? "warning" : "urgent"}`,
				);
				expect(host.styledFrame()).toContain(
					host.ui.theme.fg(
						reject ? "error" : "success",
						reject ? "failed" : "completed",
					),
				);
				expect(host.styledFrame()).toContain(
					host.ui.theme.fg(
						reject ? "warning" : "error",
						`pressure: ${reject ? "warning" : "urgent"}`,
					),
				);
				if (background) {
					const taskId = (result.details as { taskId: string }).taskId;
					await waitFor(() => !host.frame().includes("Agents"));
					const retained = await query.execute(
						"query",
						{ taskId },
						undefined,
						undefined,
						ctx,
					);
					expect(retained.details).toMatchObject({
						status: reject ? "failed" : "completed",
					});
				}
				for (const width of [8, 30, 80, 160])
					expect(host.frame(width)).toContain("INPUT");
			} finally {
				await hooks.get("session_shutdown")?.();
				await operation;
				host.tui.stop();
				await rm(dir, { recursive: true, force: true });
			}
		}, 15_000);
	}
}
