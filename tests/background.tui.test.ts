import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	VERSION,
} from "@earendil-works/pi-coding-agent";
import {
	BACKGROUND_MESSAGE,
	type BackgroundTaskDetails,
} from "../src/background.ts";

import { statusUI } from "./fixtures/status-ui.ts";

type Message = AgentSession["messages"][number];
type Child = { pid: number; child: boolean; mode: string; snapshot: string };

async function eventually<T>(
	observe: () => T,
	accept: (v: T) => boolean,
	label: string,
) {
	const deadline = Date.now() + 12_000;
	while (true) {
		const value = observe();
		if (accept(value)) return value;
		if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 15));
	}
}
function textOf(message: Message): string {
	if (!("content" in message)) return "";
	return typeof message.content === "string"
		? message.content
		: message.content
				.filter((b) => b.type === "text")
				.map((b) => b.text)
				.join("\n");
}
function tool(session: AgentSession, name: string) {
	const result = [...session.messages]
		.reverse()
		.find((m) => m.role === "toolResult" && m.toolName === name);
	if (result?.role !== "toolResult") throw new Error(`Missing ${name} result`);
	return result;
}
function completions(session: AgentSession) {
	return session.messages.filter(
		(m) => m.role === "custom" && m.customType === BACKGROUND_MESSAGE,
	);
}

// Real AgentSession + ExtensionRunner TUI binding, RPC child events, and installed
// InteractiveMode widget adapter/TUI component rendering. No full interactive input
// startup or manual visual E2E is claimed.
for (const busy of [false, true]) {
	test.serial(
		`real Pi TUI-mode runtime: gated child completion ${busy ? "waits for busy parent" : "wakes idle parent"}`,
		async () => {
			const cwd = await mkdtemp(join(tmpdir(), "background-tui-"));
			const agentDir = join(cwd, "agent");
			const logs = join(cwd, "logs");
			const savedEnv = { ...process.env };
			const savedArgv = process.argv;
			let session: AgentSession | undefined;
			const statusHost = await statusUI();
			let unsubscribe: (() => void) | undefined;
			try {
				await mkdir(agentDir);
				await mkdir(logs);
				// Preserve only OS process-launch essentials, never provider keys/proxies/config.
				for (const key of Object.keys(process.env)) delete process.env[key];
				for (const [key, value] of Object.entries(savedEnv)) {
					if (/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP)$/i.test(key))
						process.env[key] = value;
				}
				Object.assign(process.env, {
					HOME: cwd,
					USERPROFILE: cwd,
					PI_CODING_AGENT_DIR: agentDir,
					PI_OFFLINE: "1",
					BACKGROUND_FIXTURE_DIR: logs,
					STATUS_FIXTURE_THINKING: busy ? "1" : "0",
				});
				// captureInheritance reads argv; suppress child discovery just as the SDK loader does.
				process.argv = savedArgv
					.slice(0, 2)
					.concat(
						"--offline",
						"--no-extensions",
						"--no-skills",
						"--no-prompt-templates",
						"--no-context-files",
					);
				const settings = {
					defaultProvider: "background-fixture",
					defaultModel: "deterministic",
					compaction: { enabled: false },
					retry: { enabled: false },
					cacheWarming: "off" as const,
					enableInstallTelemetry: false,
					enableAnalytics: false,
				};
				await writeFile(
					join(agentDir, "settings.json"),
					JSON.stringify(settings),
				);
				await writeFile(join(agentDir, "auth.json"), "{}");
				const settingsManager = SettingsManager.inMemory(settings);
				const resourceLoader = new DefaultResourceLoader({
					cwd,
					agentDir,
					settingsManager,
					noExtensions: true,
					noSkills: true,
					noPromptTemplates: true,
					noThemes: true,
					noContextFiles: true,
					additionalExtensionPaths: [
						resolve("src/index.ts"),
						resolve("tests/fixtures/background-provider.ts"),
					],
				});
				await resourceLoader.reload();
				expect(resourceLoader.getExtensions().errors).toEqual([]);
				const modelRuntime = await ModelRuntime.create({
					authPath: join(agentDir, "auth.json"),
					modelsPath: join(agentDir, "models.json"),
					modelsStorePath: join(agentDir, "models-cache.json"),
					allowModelNetwork: false,
					refreshOnCreate: false,
				});
				({ session } = await createAgentSession({
					cwd,
					agentDir,
					settingsManager,
					modelRuntime,
					resourceLoader,
					sessionManager: SessionManager.inMemory(cwd),
					thinkingLevel: "off",
					tools: [
						"delegate",
						"delegate_status",
						"delegate_cancel",
						"background_dialogs",
					],
				}));
				const parent = session;
				// SDK applies extension provider registrations when constructing the session runtime.
				const model = modelRuntime.getModel(
					"background-fixture",
					"deterministic",
				);
				if (!model) throw new Error("Missing local fixture model");
				await parent.setModel(model);
				const errors: string[] = [];
				let starts = 0;
				let settled = 0;
				unsubscribe = parent.subscribe((event) => {
					if (event.type === "agent_start") starts++;
					if (event.type === "agent_settled") settled++;
				});
				await parent.bindExtensions({
					mode: "tui",
					uiContext: statusHost.ui,
					onError: (e) => errors.push(e.error),
				});
				expect(VERSION).toBe("1.0.0");
				expect(
					JSON.parse(readFileSync(join(logs, `${process.pid}.json`), "utf8")),
				).toMatchObject({ child: false, mode: "tui" });
				await parent.prompt("START gated TUI proof");
				await parent.waitForIdle();
				const ack = tool(parent, "delegate");
				const details = ack.details as unknown as BackgroundTaskDetails;
				expect(ack.isError).toBe(false);
				expect(details.status).toBe("running");
				expect(details.result).toBeUndefined();
				expect(details.taskId).toBeTruthy();
				expect(ack.usage).toBeUndefined();
				expect(textOf(ack)).toContain("not a final task result");
				const child = await eventually(
					() =>
						readdirSync(logs)
							.filter((f) => f.endsWith(".json"))
							.map(
								(f) => JSON.parse(readFileSync(join(logs, f), "utf8")) as Child,
							)
							.find((c) => c.child),
					(c) => !!c,
					"child initialization",
				);
				if (!child) throw new Error("Missing child");
				expect(child.mode).toBe("rpc");
				await eventually(
					() => existsSync(join(logs, `${child.pid}.child-ready`)),
					Boolean,
					"child gate",
				);
				expect(statusHost.frame()).toContain("1  gated TUI proof");
				expect(statusHost.frame()).toContain("pressure: none");
				expect(statusHost.frame()).toContain("0 turns");
				await eventually(
					() => statusHost.frame().includes("thinking…"),
					(thinking) => thinking === busy,
					"observed thinking status",
				);
				expect(statusHost.frame()).not.toContain("PRIVATE THINKING CONTENT");
				await parent.prompt("UNRELATED");
				await parent.waitForIdle();
				expect(
					parent.messages.some((m) => textOf(m) === "PARENT_REPLY:UNRELATED"),
				).toBe(true);
				expect(settled).toBeGreaterThanOrEqual(2);
				expect(completions(parent)).toHaveLength(0);
				expect(existsSync(join(logs, "child-release"))).toBe(false);
				expect(existsSync(join(logs, `${child.pid}.closed`))).toBe(false);
				const startsBeforeRelease = starts;
				const settledBeforeRelease = settled;
				let busyRun: Promise<void> | undefined;
				if (busy) {
					busyRun = parent.prompt("BUSY");
					await eventually(
						() => existsSync(join(logs, `${process.pid}.parent-ready`)),
						Boolean,
						"parent gate",
					);
				}
				await writeFile(join(logs, "child-release"), "release");
				await eventually(
					() =>
						existsSync(join(logs, `${child.pid}.closed`)) &&
						!existsSync(dirname(child.snapshot)),
					Boolean,
					"child process and snapshot cleanup",
				);
				if (busy) {
					expect(parent.isStreaming).toBe(true);
					expect(completions(parent)).toHaveLength(0);
					expect(starts).toBe(startsBeforeRelease + 1);
					await writeFile(join(logs, "parent-release"), "release");
					await busyRun;
				}
				// No prompt after release: observe automatic model-visible delivery and turn settlement.
				const seen = await eventually(
					() =>
						parent.messages.find(
							(m) =>
								m.role === "assistant" &&
								textOf(m).startsWith("MODEL_SAW:") &&
								textOf(m).includes(details.taskId),
						),
					Boolean,
					"automatic completion turn",
				);
				await eventually(
					() => settled,
					(n) => n > settledBeforeRelease + (busy ? 1 : 0),
					"wake turn settled",
				);
				await parent.waitForIdle();
				expect(starts).toBe(startsBeforeRelease + (busy ? 2 : 1));
				expect(completions(parent)).toHaveLength(1);
				if (!seen) throw new Error("Missing model consumption");
				expect(textOf(seen)).toContain(`${details.taskId}: completed`);
				expect(textOf(seen)).toContain("CHILD_RESULT:Task:\ngated TUI proof");
				expect(textOf(seen)).toContain("explicit-only");
				if (busy) {
					const finished = parent.messages.findIndex(
						(m) => textOf(m) === "PARENT_BUSY_FINISHED",
					);
					const delivered = parent.messages.findIndex(
						(m) => m.role === "custom" && m.customType === BACKGROUND_MESSAGE,
					);
					expect(finished).toBeGreaterThan(-1);
					expect(delivered).toBeGreaterThan(finished);
				}
				expect(() => process.kill(child.pid, 0)).toThrow();
				expect(statusHost.frame()).toContain("└─ completed");
				expect(statusHost.frame()).toContain("1 turn · pressure: none");
				expect(statusHost.frame()).not.toContain("CHILD_RESULT");
				expect(errors).toEqual([]);
			} finally {
				try {
					if (session) {
						await session.abort();
						// SDK dispose does not emit shutdown; the embedding host owns this boundary.
						await session.extensionRunner.emit({
							type: "session_shutdown",
							reason: "quit",
						});
					}
				} finally {
					unsubscribe?.();
					session?.dispose();
					process.argv = savedArgv;
					for (const key of Object.keys(process.env)) delete process.env[key];
					Object.assign(process.env, savedEnv);
					await rm(cwd, { recursive: true, force: true });
				}
			}
		},
		30_000,
	);
}
