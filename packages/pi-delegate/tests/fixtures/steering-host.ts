import { expect } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import type {
	BackgroundSteeringResult,
	BackgroundTaskDetails,
} from "../../src/background.ts";
import { resolveCli } from "../../src/delegate.ts";
import { RpcProcess } from "../../src/rpc.ts";
import type {
	PressureFixtureCall,
	PressureTrace,
} from "./pressure-provider.ts";

export type Message = AgentSession["messages"][number];
export interface Child {
	pid: number;
	snapshot: string;
	child: boolean;
}
export async function eventually<T>(
	observe: () => T | Promise<T>,
	accept: (value: T) => boolean,
	label: string,
): Promise<T> {
	const deadline = Date.now() + 12_000;
	while (true) {
		const value = await observe();
		if (accept(value)) return value;
		if (Date.now() >= deadline)
			throw new Error(`Timed out: ${label}; observed ${JSON.stringify(value)}`);
		await Bun.sleep(10);
	}
}
export function tool(messages: Message[], name: string) {
	const result = [...messages]
		.reverse()
		.find((m) => m.role === "toolResult" && m.toolName === name);
	if (result?.role !== "toolResult") throw new Error(`Missing ${name} result`);
	return result;
}
export class SteeringHost {
	constructor(
		readonly parent: RpcProcess,
		readonly logs: string,
	) {}
	children(): Child[] {
		return readdirSync(this.logs)
			.filter((f) => f.endsWith(".meta.json"))
			.map((f) => JSON.parse(readFileSync(join(this.logs, f), "utf8")) as Child)
			.filter((c) => c.child);
	}
	trace(child: Pick<Child, "pid">): PressureTrace[] {
		const path = join(this.logs, `${child.pid}.trace.jsonl`);
		return existsSync(path)
			? readFileSync(path, "utf8")
					.split("\n")
					.slice(0, -1)
					.map((line) => JSON.parse(line) as PressureTrace)
			: [];
	}
	async event(
		child: Child,
		type: string,
		match: (e: PressureTrace) => boolean = () => true,
	) {
		return eventually(
			() => this.trace(child).find((e) => e.type === type && match(e)),
			Boolean,
			`${child.pid} ${type}`,
		);
	}
	release(child: Child, gate: string) {
		return writeFile(
			join(this.logs, `${child.pid}.${gate}-release`),
			"release",
		);
	}
	async messages(): Promise<Message[]> {
		return (await this.parent.request<{ messages: Message[] }>("get_messages"))
			.messages;
	}
	async prompt(message: string) {
		const settled = this.parent.waitForSettled();
		try {
			await this.parent.request("prompt", { message });
			await settled.promise;
		} finally {
			settled.dispose();
		}
	}
	async start(
		task: PressureFixtureCall["task"] = { id: "child", finishAt: 2 },
		pressure?: PressureFixtureCall["pressure"],
	) {
		await this.prompt(
			`RUN ${JSON.stringify({ calls: [{ task, background: true, pressure }] })}`,
		);
		return (
			tool(await this.messages(), "delegate")
				.details as unknown as BackgroundTaskDetails
		).taskId;
	}
	async child(id?: string) {
		const value = await eventually(
			() =>
				this.children().find(
					(c) =>
						!id || this.trace(c).some((e) => e.type === "model" && e.id === id),
				),
			Boolean,
			"child",
		);
		if (!value) throw new Error("Missing child");
		return value;
	}
	beginSteers(calls: { taskId: string; message: string }[]) {
		const operation = this.prompt(`STEERS ${JSON.stringify(calls)}`);
		void operation.catch(() => {});
		return operation;
	}
	async steer(taskId: string, message: string) {
		await this.beginSteers([{ taskId, message }]);
		return tool(
			await this.messages(),
			"delegate_steer",
		) as unknown as BackgroundSteeringResult;
	}
	async model(child: Child, call: number) {
		return this.event(child, "model", (e) => e.call === call);
	}
	async advance(child: Child, call: number) {
		await this.model(child, call);
		await this.release(child, `model-${call}`);
	}
	async finish(child: Child, from = 0, end = 2) {
		for (let call = from; call <= end; call++) await this.advance(child, call);
	}
	async query(id: string) {
		await this.prompt(`STATUS ${id}`);
		return tool(await this.messages(), "delegate_status")
			.details as unknown as BackgroundTaskDetails;
	}
	async cleaned(child: Child) {
		await eventually(
			() => {
				try {
					process.kill(child.pid, 0);
					return false;
				} catch {
					return !existsSync(dirname(child.snapshot));
				}
			},
			Boolean,
			"child process and snapshot cleanup",
		);
	}
}
export async function withSteeringHost(
	action: (host: SteeringHost) => Promise<void>,
	env: NodeJS.ProcessEnv = {},
	mode: "all" | "one-at-a-time" = "all",
) {
	const cwd = await mkdtemp(join(tmpdir(), "steering-host-"));
	const logs = join(cwd, "logs");
	const agentDir = join(cwd, "agent");
	await mkdir(logs);
	await mkdir(agentDir);
	await writeFile(
		join(agentDir, "settings.json"),
		JSON.stringify({
			compaction: { enabled: false },
			retry: { enabled: false },
			cacheWarming: "off",
			enableInstallTelemetry: false,
			enableAnalytics: false,
			steeringMode: mode,
		}),
	);
	const skill = join(cwd, "SKILL.md");
	const template = join(cwd, "sentinel-template.md");
	await writeFile(
		skill,
		"---\nname: steering-skill\ndescription: sentinel\n---\nSKILL_EXPANDED_SENTINEL",
	);
	await writeFile(template, "TEMPLATE_EXPANDED_SENTINEL");
	const parent = new RpcProcess(
		"node",
		[
			resolveCli(),
			"--mode",
			"rpc",
			"--offline",
			"--no-session",
			"--no-approve",
			"--no-extensions",
			"--no-skills",
			"--no-prompt-templates",
			"--no-context-files",
			"--extension",
			resolve("src/index.ts"),
			"--extension",
			resolve("tests/fixtures/pressure-provider.ts"),
			"--extension",
			resolve("tests/fixtures/steering-controls.ts"),
			"--extension",
			"builtin:codemode",
			"--extension",
			"builtin:tool-search",
			"--skill",
			skill,
			"--prompt-template",
			template,
			"--tools",
			"delegate,delegate_status,delegate_cancel,delegate_steer,pressure_step,pressure_nested,pressure_leaf,steering_reachability,codemode,tool_search",
			"--provider",
			"pressure-fixture",
			"--model",
			"deterministic",
		],
		{
			cwd,
			env: {
				...process.env,
				...env,
				PI_CODING_AGENT_DIR: agentDir,
				PI_OFFLINE: "1",
				PRESSURE_FIXTURE_DIR: logs,
				PI_DELEGATE_CHILD: undefined,
				PI_DELEGATE_SNAPSHOT: undefined,
				PI_CODING_AGENT_SESSION_DIR: undefined,
			},
		},
	);
	const host = new SteeringHost(parent, logs);
	try {
		expect(VERSION).toBe("1.0.0");
		await parent.request("get_state");
		const commands = await parent.request<{ commands: { name: string }[] }>(
			"get_commands",
		);
		expect(commands.commands.map((c) => c.name)).toEqual(
			expect.arrayContaining([
				"steering-sentinel",
				"skill:steering-skill",
				"sentinel-template",
			]),
		);
		await action(host);
	} finally {
		await parent.stop();
		for (const child of host.children()) await host.cleaned(child);
		await rm(cwd, { recursive: true, force: true });
	}
}
