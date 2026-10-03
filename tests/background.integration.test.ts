import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	type AgentSession,
	getPackageDir,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import {
	BACKGROUND_MESSAGE,
	type BackgroundTaskDetails,
} from "../src/background.ts";
import { resolveCli } from "../src/delegate.ts";
import { RpcProcess } from "../src/rpc.ts";

type Message = AgentSession["messages"][number];
type ToolResult = Extract<Message, { role: "toolResult" }>;
interface ChildLog {
	pid: number;
	child: boolean;
	mode: string;
	snapshot: string;
}

async function eventually<T>(
	observe: () => T | Promise<T>,
	accept: (value: T) => boolean,
	label: string,
): Promise<T> {
	const deadline = Date.now() + 12_000;
	while (true) {
		const value = await observe();
		if (accept(value)) return value;
		if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 15));
	}
}
function textOf(message: Message): string {
	if (!("content" in message)) return "";
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((b) => b.type === "text")
		.map((b) => b.text)
		.join("\n");
}
function tool(messages: Message[], name: string): ToolResult {
	const result = [...messages]
		.reverse()
		.find((m) => m.role === "toolResult" && m.toolName === name);
	if (result?.role !== "toolResult")
		throw new Error(`Missing ${name} tool result: ${JSON.stringify(messages)}`);
	return result;
}
function details(result: ToolResult): BackgroundTaskDetails {
	return result.details as unknown as BackgroundTaskDetails;
}
function completions(messages: Message[]) {
	return messages.filter(
		(m) => m.role === "custom" && m.customType === BACKGROUND_MESSAGE,
	);
}

async function withParent(
	action: (host: {
		parent: RpcProcess;
		logs: string;
		messages(): Promise<Message[]>;
		prompt(text: string): Promise<void>;
		start(task?: string): Promise<string>;
		child(): Promise<ChildLog>;
		release(name: "child" | "parent"): Promise<void>;
		consumed(id: string): Promise<Message[]>;
		modals: string[];
	}) => Promise<void>,
) {
	const cwd = await mkdtemp(join(tmpdir(), "background-integration-"));
	const agentDir = join(cwd, "agent");
	const logs = join(cwd, "logs");
	await mkdir(agentDir);
	await mkdir(logs);
	await writeFile(
		join(agentDir, "settings.json"),
		JSON.stringify({
			compaction: { enabled: false },
			retry: { enabled: false },
			cacheWarming: "off",
			enableInstallTelemetry: false,
			enableAnalytics: false,
		}),
	);
	const modals: string[] = [];
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
			resolve("tests/fixtures/background-provider.ts"),
			"--tools",
			"delegate,delegate_status,delegate_cancel,background_dialogs",
			"--provider",
			"background-fixture",
			"--model",
			"deterministic",
		],
		{
			cwd,
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: agentDir,
				PI_OFFLINE: "1",
				BACKGROUND_FIXTURE_DIR: logs,
				PI_DELEGATE_CHILD: undefined,
				PI_DELEGATE_SNAPSHOT: undefined,
				PI_CODING_AGENT_SESSION_DIR: undefined,
			},
		},
		undefined,
		async (request) => {
			if (["select", "confirm", "input", "editor"].includes(request.method))
				modals.push(request.method);
			return undefined;
		},
	);
	const messages = async () =>
		(await parent.request<{ messages: Message[] }>("get_messages")).messages;
	const prompt = async (message: string) => {
		const settled = parent.waitForSettled();
		try {
			await parent.request("prompt", { message });
			await settled.promise;
		} finally {
			settled.dispose();
		}
	};
	try {
		expect(
			JSON.parse(readFileSync(join(getPackageDir(), "package.json"), "utf8"))
				.version,
		).toBe("1.0.0");
		await parent.request("get_state"); // Startup handshake before installing run waits.
		await action({
			parent,
			logs,
			messages,
			prompt,
			modals,
			async start(task = "gated proof") {
				await prompt(`START ${task}`);
				const result = tool(await messages(), "delegate");
				expect(result.isError).toBe(false);
				expect(details(result).status).toBe("running");
				expect(details(result).taskId).toBeTruthy();
				expect(details(result).result).toBeUndefined();
				expect(result.usage).toBeUndefined();
				expect(textOf(result)).toContain("not a final task result");
				return details(result).taskId;
			},
			async child() {
				const children = await eventually(
					() =>
						readdirSync(logs)
							.filter((f) => f.endsWith(".json"))
							.map(
								(f) =>
									JSON.parse(readFileSync(join(logs, f), "utf8")) as ChildLog,
							)
							.filter((v) => v.child),
					(v) => v.length === 1,
					"child initialization",
				);
				const child = children[0];
				if (!child) throw new Error("Missing initialized child");
				await eventually(
					() => existsSync(join(logs, `${child.pid}.child-ready`)),
					Boolean,
					"gated child model",
				);
				expect(child.mode).toBe("rpc");
				return child;
			},
			release: (name) => writeFile(join(logs, `${name}-release`), "release"),
			async consumed(id) {
				const seen = await eventually(
					messages,
					(ms) =>
						ms.some(
							(m) =>
								m.role === "assistant" &&
								textOf(m).startsWith("MODEL_SAW:") &&
								textOf(m).includes(id),
						),
					"model consumes automatic completion",
				);
				await eventually(
					() => parent.request<{ isStreaming: boolean }>("get_state"),
					(s) => !s.isStreaming,
					"completion turn settles",
				);
				return seen;
			},
		});
	} finally {
		await parent.stop();
		await rm(cwd, { recursive: true, force: true });
	}
}
function cleaned(logs: string, child: ChildLog) {
	expect(existsSync(join(logs, `${child.pid}.closed`))).toBe(true);
	expect(existsSync(dirname(child.snapshot))).toBe(false);
	expect(() => process.kill(child.pid, 0)).toThrow();
}

test("real Pi RPC: acknowledges gated background work, proceeds independently, and idle completion wakes the model with separate usage", async () => {
	await withParent(async (host) => {
		const id = await host.start();
		const child = await host.child();
		await host.prompt("UNRELATED");
		expect(
			(await host.messages()).some(
				(m) => textOf(m) === "PARENT_REPLY:UNRELATED",
			),
		).toBe(true);
		await host.prompt(`STATUS ${id}`);
		const running = tool(await host.messages(), "delegate_status");
		expect(details(running).status).toBe("running");
		expect(details(running).usage).toBeUndefined();
		expect(completions(await host.messages())).toHaveLength(0);
		expect(existsSync(join(host.logs, `${child.pid}.closed`))).toBe(false);
		await host.release("child");
		const delivered = await host.consumed(id); // No new prompt after release.
		expect(completions(delivered)).toHaveLength(1);
		const seen = [...delivered]
			.reverse()
			.find(
				(m) => m.role === "assistant" && textOf(m).startsWith("MODEL_SAW:"),
			);
		if (!seen) throw new Error("Missing model-visible completion");
		expect(textOf(seen)).toContain(`${id}: completed`);
		expect(textOf(seen)).toContain("CHILD_RESULT:Task:\ngated proof");
		expect(textOf(seen)).toContain("explicit-only");
		const childTools = JSON.parse(
			textOf(seen).split("TOOLS:")[1] ?? "",
		) as string[];
		for (const name of ["delegate", "delegate_status", "delegate_cancel"])
			expect(childTools).not.toContain(name);
		await host.prompt(`STATUS ${id}`);
		const query = tool(await host.messages(), "delegate_status");
		expect(details(query)).toMatchObject({
			taskId: id,
			status: "completed",
			usage: { totalTokens: 3 },
		});
		expect(details(query).result?.sessionId).toBeTruthy();
		expect(query.usage).toBeUndefined();
		expect(textOf(query)).toContain(
			"not automatically included in Pi parent-session totals",
		);
		const all = await host.messages();
		const ownTokens = all.reduce(
			(n, m) => n + (m.role === "assistant" ? m.usage.totalTokens : 0),
			0,
		);
		const stats = await host.parent.request<{ tokens: { total: number } }>(
			"get_session_stats",
		);
		expect(stats.tokens.total).toBe(ownTokens);
		cleaned(host.logs, child);
	});
}, 30_000);

test("real Pi RPC: busy-parent completion stays out of host queue and reaches the model only after parent work", async () => {
	await withParent(async (host) => {
		const id = await host.start();
		const child = await host.child();
		await host.parent.request("prompt", { message: "BUSY" });
		await eventually(
			() => readdirSync(host.logs).some((f) => f.endsWith(".parent-ready")),
			Boolean,
			"busy parent model",
		);
		await host.release("child");
		await eventually(
			() =>
				existsSync(join(host.logs, `${child.pid}.closed`)) &&
				!existsSync(dirname(child.snapshot)),
			Boolean,
			"completed child cleanup while parent busy",
		);
		// A real model-owned status query cannot run until BUSY settles. Observe host queue now.
		await host.parent.request("follow_up", { message: "discard me" });
		const cleared = await host.parent.request<{ followUp: string[] }>(
			"clear_queue",
		);
		expect(cleared.followUp).toEqual(["discard me"]);
		expect(completions(await host.messages())).toHaveLength(0);
		expect(
			(await host.parent.request<{ isStreaming: boolean }>("get_state"))
				.isStreaming,
		).toBe(true);
		await host.release("parent");
		const all = await host.consumed(id);
		const finished = all.findIndex((m) => textOf(m) === "PARENT_BUSY_FINISHED");
		const completion = all.findIndex(
			(m) => m.role === "custom" && m.customType === BACKGROUND_MESSAGE,
		);
		expect(finished).toBeGreaterThan(-1);
		expect(completion).toBeGreaterThan(finished);
		await host.prompt(`STATUS ${id}`);
		expect(details(tool(await host.messages(), "delegate_status")).status).toBe(
			"completed",
		);
		cleaned(host.logs, child);
	});
}, 30_000);

test("real Pi RPC: ordinary parent abort leaves child alive; explicit cancel reports cancellation and awaits cleanup", async () => {
	await withParent(async (host) => {
		const id = await host.start();
		const child = await host.child();
		await host.parent.request("prompt", { message: "BUSY" });
		await eventually(
			() => readdirSync(host.logs).some((f) => f.endsWith(".parent-ready")),
			Boolean,
			"parent abort gate",
		);
		await host.parent.request("abort");
		await host.prompt(`STATUS ${id}`);
		expect(details(tool(await host.messages(), "delegate_status")).status).toBe(
			"running",
		);
		expect(existsSync(join(host.logs, `${child.pid}.closed`))).toBe(false);
		expect(() => process.kill(child.pid, 0)).not.toThrow();
		await host.prompt(`CANCEL ${id}`);
		const cancelled = tool(await host.messages(), "delegate_cancel");
		expect(details(cancelled).status).toBe("cancelled");
		expect(cancelled.isError).toBe(true);
		expect(cancelled.usage).toBeUndefined();
		cleaned(host.logs, child);
		const all = await host.consumed(id);
		expect(
			all.some(
				(m) => m.role === "assistant" && textOf(m).includes(`${id}: cancelled`),
			),
		).toBe(true);
	});
}, 30_000);

test("real Pi RPC: background modal refusal permits successful child completion without forwarding dialogs", async () => {
	await withParent(async (host) => {
		const id = await host.start("dialogs");
		const child = await host.child();
		await host.release("child");
		const all = await host.consumed(id);
		expect(readFileSync(join(host.logs, `${child.pid}.dialogs`), "utf8")).toBe(
			"[null,false,null,null]",
		);
		expect(host.modals).toEqual([]);
		expect(
			all.some(
				(m) =>
					m.role === "assistant" &&
					textOf(m).includes(
						"CHILD_RESULT:dialogs refused [null,false,null,null]",
					),
			),
		).toBe(true);
		await host.prompt(`STATUS ${id}`);
		expect(
			details(tool(await host.messages(), "delegate_status")),
		).toMatchObject({ status: "completed", usage: { totalTokens: 6 } });
		cleaned(host.logs, child);
	});
}, 30_000);

test("real Pi RPC: actual tree navigation invalidates pending work and does not wake the destination branch", async () => {
	await withParent(async (host) => {
		await host.prompt("branch anchor");
		const { entries } = await host.parent.request<{ entries: SessionEntry[] }>(
			"get_entries",
		);
		const anchor = [...entries]
			.reverse()
			.find((e) => e.type === "message" && e.message.role === "assistant");
		if (!anchor) throw new Error("Missing branch anchor");
		const id = await host.start();
		const child = await host.child();
		await host.parent.request("prompt", {
			message: `/background-tree ${anchor.id}`,
		});
		cleaned(host.logs, child);
		await host.release("child");
		await host.prompt(`STATUS ${id}`); // Destination branch stays usable; former task is unknown.
		const query = tool(await host.messages(), "delegate_status");
		expect(query.isError).toBe(true);
		expect(textOf(query)).toContain(`Unknown background task: ${id}`);
		expect(completions(await host.messages())).toHaveLength(0);
	});
}, 30_000);

test("real Pi RPC: abort with unrelated follow-up queued then clear_queue automatically wakes locally pending completion", async () => {
	await withParent(async (host) => {
		const id = await host.start();
		const child = await host.child();
		await host.parent.request("prompt", { message: "BUSY" });
		await eventually(
			() => readdirSync(host.logs).some((f) => f.endsWith(".parent-ready")),
			Boolean,
			"busy parent gate",
		);
		await host.release("child");
		await eventually(
			() =>
				existsSync(join(host.logs, `${child.pid}.closed`)) &&
				!existsSync(dirname(child.snapshot)),
			Boolean,
			"completed child cleanup",
		);
		await host.parent.request("follow_up", {
			message: "unrelated queued host work",
		});
		await host.parent.request("abort");
		expect(
			(await host.parent.request<{ isStreaming: boolean }>("get_state"))
				.isStreaming,
		).toBe(false);
		expect(completions(await host.messages())).toHaveLength(0);
		const cleared = await host.parent.request<{ followUp: string[] }>(
			"clear_queue",
		);
		expect(cleared.followUp).toEqual(["unrelated queued host work"]);
		const all = await host.consumed(id); // No prompt or gate release: queue clearing emits no settled event.
		expect(completions(all)).toHaveLength(1);
		expect(all.some((m) => textOf(m) === "PARENT_BUSY_FINISHED")).toBe(false);
		expect(
			all.some((m) => textOf(m) === "PARENT_REPLY:unrelated queued host work"),
		).toBe(false);
		cleaned(host.logs, child);
	});
}, 30_000);
