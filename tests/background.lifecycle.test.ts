import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	type AgentSession,
	type AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	VERSION,
} from "@earendil-works/pi-coding-agent";
import {
	BACKGROUND_MESSAGE,
	type BackgroundTaskDetails,
} from "../src/background.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function eventually<T>(
	observe: () => T,
	accept: (v: T) => boolean,
	label: string,
): Promise<T> {
	const deadline = Date.now() + 8000;
	while (true) {
		const v = observe();
		if (accept(v)) return v;
		if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`);
		await sleep(10);
	}
}
type Message = AgentSession["messages"][number];
type Child = { pid: number; child: boolean; snapshot: string };
function textOf(m: Message) {
	if (!("content" in m)) return "";
	return typeof m.content === "string"
		? m.content
		: m.content
				.filter((b) => b.type === "text")
				.map((b) => b.text)
				.join("\n");
}
function tool(s: AgentSession, name: string) {
	const m = [...s.messages]
		.reverse()
		.find((m) => m.role === "toolResult" && m.toolName === name);
	if (m?.role !== "toolResult") throw new Error(`Missing ${name}`);
	return m;
}
function completions(s: AgentSession) {
	return s.messages.filter(
		(m) => m.role === "custom" && m.customType === BACKGROUND_MESSAGE,
	);
}
function cleaned(c: Child, logs: string) {
	expect(existsSync(join(logs, `${c.pid}.closed`))).toBe(true);
	expect(existsSync(dirname(c.snapshot))).toBe(false);
	expect(() => process.kill(c.pid, 0)).toThrow();
}
// Real SDK runtime and real gated RPC children. No injected delegation runner or terminal renderer.
// Environment/argv are process-global, so run these scenarios serially.
async function withRuntime(
	action: (h: {
		runtime: AgentSessionRuntime;
		logs: string;
		beforeTree: { release(): void };
		treeEntered: () => boolean;
		start(task: string): Promise<{ id: string; child: Child }>;
		releaseChild(): Promise<void>;
		unknown(id: string): Promise<void>;
	}) => Promise<void>,
) {
	const cwd = await mkdtemp(join(tmpdir(), "background-lifecycle-"));
	const agentDir = join(cwd, "agent"),
		logs = join(cwd, "logs");
	const env = { ...process.env },
		argv = process.argv;
	let runtime: AgentSessionRuntime | undefined;
	const beforeTree = {
		release: () => writeFileSync(join(logs, "tree-release"), "release"),
	};
	const errors: string[] = [];
	try {
		await mkdir(agentDir);
		await mkdir(logs);
		for (const k of Object.keys(process.env)) delete process.env[k];
		for (const [k, v] of Object.entries(env))
			if (/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP)$/i.test(k))
				process.env[k] = v;
		Object.assign(process.env, {
			HOME: cwd,
			USERPROFILE: cwd,
			PI_CODING_AGENT_DIR: agentDir,
			PI_OFFLINE: "1",
			BACKGROUND_FIXTURE_DIR: logs,
		});
		process.argv = argv
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
		await writeFile(join(agentDir, "settings.json"), JSON.stringify(settings));
		await writeFile(join(agentDir, "auth.json"), "{}");
		const modelRuntime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: join(agentDir, "models.json"),
			modelsStorePath: join(agentDir, "cache.json"),
			allowModelNetwork: false,
			refreshOnCreate: false,
		});
		const factory: CreateAgentSessionRuntimeFactory = async ({
			cwd,
			sessionManager,
			sessionStartEvent,
		}) => {
			const services = await createAgentSessionServices({
				cwd,
				agentDir,
				modelRuntime,
				settingsManager: SettingsManager.inMemory(settings),
				resourceLoaderOptions: {
					noExtensions: true,
					noSkills: true,
					noPromptTemplates: true,
					noThemes: true,
					noContextFiles: true,
					additionalExtensionPaths: [
						resolve("src/index.ts"),
						resolve("tests/fixtures/background-provider.ts"),
						resolve("tests/fixtures/background-lifecycle.ts"),
					],
				},
			});
			expect(services.resourceLoader.getExtensions().errors).toEqual([]);
			const result = await createAgentSessionFromServices({
				services,
				sessionManager,
				sessionStartEvent,
				thinkingLevel: "off",
				tools: [
					"delegate",
					"delegate_status",
					"delegate_cancel",
					"background_dialogs",
				],
			});
			const model = modelRuntime.getModel(
				"background-fixture",
				"deterministic",
			);
			if (!model) throw new Error("Missing local model");
			await result.session.setModel(model);
			return { ...result, services, diagnostics: services.diagnostics };
		};
		runtime = await createAgentSessionRuntime(factory, {
			cwd,
			agentDir,
			sessionManager: SessionManager.inMemory(cwd),
		});
		const bind = (s: AgentSession) =>
			s.bindExtensions({ mode: "tui", onError: (e) => errors.push(e.error) });
		runtime.setRebindSession(bind);
		await bind(runtime.session);
		expect(VERSION).toBe("1.0.0");
		const host = runtime;
		const seen = new Set<number>();
		await action({
			runtime: host,
			logs,
			beforeTree,
			treeEntered: () => existsSync(join(logs, "tree-entered")),
			async start(task) {
				await host.session.prompt(`START ${task}`);
				const ack = tool(host.session, "delegate");
				const d = ack.details as unknown as BackgroundTaskDetails;
				expect(ack.isError).toBe(false);
				expect(d.status).toBe("running");
				expect(ack.usage).toBeUndefined();
				const child = await eventually(
					() =>
						readdirSync(logs)
							.filter((f) => f.endsWith(".json"))
							.map(
								(f) => JSON.parse(readFileSync(join(logs, f), "utf8")) as Child,
							)
							.find((c) => c.child && !seen.has(c.pid)),
					(c) => !!c,
					"new child",
				);
				if (!child) throw new Error("Missing child");
				seen.add(child.pid);
				await eventually(
					() => existsSync(join(logs, `${child.pid}.child-ready`)),
					Boolean,
					"child gate",
				);
				return { id: d.taskId, child };
			},
			releaseChild: () => writeFile(join(logs, "child-release"), "release"),
			async unknown(id) {
				await host.session.prompt(`STATUS ${id}`);
				await host.session.waitForIdle();
				const q = tool(host.session, "delegate_status");
				expect(q.isError).toBe(true);
				expect(textOf(q)).toContain(`Unknown background task: ${id}`);
			},
		});
		expect(errors).toEqual([]);
	} finally {
		beforeTree.release();
		try {
			await runtime?.dispose();
		} finally {
			process.argv = argv;
			for (const k of Object.keys(process.env)) delete process.env[k];
			Object.assign(process.env, env);
			await rm(cwd, { recursive: true, force: true });
		}
	}
}

test.serial(
	"SDK tree commit cancels NEW child accepted while async before-tree handler holds the source leaf",
	async () => {
		await withRuntime(async (h) => {
			const s = h.runtime.session;
			await s.prompt("destination anchor");
			const target = s.sessionManager.getLeafId();
			if (!target) throw new Error("Missing target");
			await s.prompt("source branch");
			const source = s.sessionManager.getLeafId();
			const navigation = s.navigateTree(target, { summarize: false });
			await eventually(h.treeEntered, Boolean, "before-tree gate");
			expect(s.sessionManager.getLeafId()).toBe(source);
			const { id, child } = await h.start("accepted during navigation");
			expect(s.sessionManager.getLeafId()).not.toBe(target);
			h.beforeTree.release();
			expect((await navigation).cancelled).toBe(false);
			cleaned(child, h.logs);
			expect(s.sessionManager.getLeafId()).toBe(target);
			expect(s.messages.some((m) => textOf(m).includes(id))).toBe(false); // Source acknowledgement excluded.
			let starts = 0;
			const off = s.subscribe((e) => {
				if (e.type === "agent_start") starts++;
			});
			try {
				await h.releaseChild();
				await sleep(100);
				expect(starts).toBe(0);
				expect(completions(s)).toHaveLength(0);
			} finally {
				off();
			}
			await h.unknown(id);
			expect(completions(s)).toHaveLength(0);
		});
	},
	20000,
);

test.serial(
	"SDK reload cancels held child, suppresses locally pending completion, and installs usable fresh task scope",
	async () => {
		await withRuntime(async (h) => {
			const s = h.runtime.session;
			const held = await h.start("held before reload");
			await s.reload();
			cleaned(held.child, h.logs);
			await h.unknown(held.id);
			const pending = await h.start("pending before reload");
			const busy = s.prompt("BUSY");
			await eventually(
				() => existsSync(join(h.logs, `${process.pid}.parent-ready`)),
				Boolean,
				"busy gate",
			);
			await h.releaseChild();
			await eventually(
				() =>
					existsSync(join(h.logs, `${pending.child.pid}.closed`)) &&
					!existsSync(dirname(pending.child.snapshot)),
				Boolean,
				"pending child cleaned",
			);
			await sleep(60);
			expect(completions(s)).toHaveLength(0);
			// Keep a host queue item so abort cannot deliver before reload invalidates local ownership.
			await s.followUp("discard before reload");
			await s.abort();
			await busy;
			await s.reload();
			s.clearQueue();
			await h.unknown(pending.id);
			await sleep(100);
			expect(completions(s)).toHaveLength(0);
			await rm(join(h.logs, "child-release"));
			const fresh = await h.start("fresh after reload");
			expect(fresh.id).not.toBe(pending.id);
			await h.releaseChild();
			await eventually(
				() =>
					s.messages.some(
						(m) =>
							m.role === "assistant" &&
							textOf(m).startsWith("MODEL_SAW:") &&
							textOf(m).includes(fresh.id),
					),
				Boolean,
				"fresh automatic wake",
			);
			await s.waitForIdle();
			expect(completions(s)).toHaveLength(1);
			cleaned(fresh.child, h.logs);
		});
	},
	20000,
);

test.serial(
	"SDK runtime newSession and actual runtime shutdown clean held children without stale delivery",
	async () => {
		await withRuntime(async (h) => {
			const first = await h.start("held before replacement");
			const old = h.runtime.session;
			expect((await h.runtime.newSession()).cancelled).toBe(false);
			expect(h.runtime.session).not.toBe(old);
			cleaned(first.child, h.logs);
			expect(h.runtime.session.messages).toHaveLength(0);
			await h.unknown(first.id);
			const held = await h.start("held before shutdown");
			const s = h.runtime.session;
			let starts = 0;
			const off = s.subscribe((e) => {
				if (e.type === "agent_start") starts++;
			});
			try {
				await h.runtime.dispose();
				cleaned(held.child, h.logs);
				await h.releaseChild();
				await sleep(100);
				expect(starts).toBe(0);
				expect(completions(s)).toHaveLength(0);
			} finally {
				off();
			}
		});
	},
	20000,
);
