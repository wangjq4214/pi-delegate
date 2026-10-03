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
import type { DelegationDetails } from "../src/delegate.ts";
import { resolveCli } from "../src/delegate.ts";
import { RpcProcess } from "../src/rpc.ts";
import type {
	PressureFixtureCall,
	PressureFixtureRequest,
	PressureTrace,
} from "./fixtures/pressure-provider.ts";

type Message = AgentSession["messages"][number];
type ToolResult = Extract<Message, { role: "toolResult" }>;
interface Child {
	pid: number;
	child: boolean;
	mode: string;
	snapshot: string;
}
const timePolicy = {
	warning: { afterSeconds: 0.15, afterTurns: 100 },
	urgent: { afterSeconds: 0.3, afterTurns: 200 },
};
const turnPolicy = {
	warning: { afterSeconds: 60, afterTurns: 1 },
	urgent: { afterSeconds: 120, afterTurns: 2 },
};

async function eventually<T>(
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
function textOf(message: Message): string {
	if (!("content" in message)) return "";
	return typeof message.content === "string"
		? message.content
		: message.content
				.filter((b) => b.type === "text")
				.map((b) => b.text)
				.join("\n");
}
function tool(messages: Message[], name: string): ToolResult {
	const result = [...messages]
		.reverse()
		.find((m) => m.role === "toolResult" && m.toolName === name);
	if (result?.role !== "toolResult") throw new Error(`Missing ${name} result`);
	return result;
}
function background(result: ToolResult): BackgroundTaskDetails {
	return result.details as unknown as BackgroundTaskDetails;
}
function receipts(trace: PressureTrace[]): PressureTrace[] {
	return trace.filter((e) => e.type === "pressure-receipt");
}
function models(trace: PressureTrace[]): PressureTrace[] {
	return trace.filter((e) => e.type === "model");
}
function report(id: string): string {
	return `REPORT:${id}: current findings; unfinished work and blockers disclosed.`;
}

async function withHost(
	action: (host: Host) => Promise<void>,
	holdInit = false,
) {
	const cwd = await mkdtemp(join(tmpdir(), "pressure-integration-"));
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
		}),
	);
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
			"--tools",
			"delegate,delegate_status,delegate_cancel,pressure_step,pressure_nested,pressure_leaf",
			"--provider",
			"pressure-fixture",
			"--model",
			"deterministic",
		],
		{
			cwd,
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: agentDir,
				PI_OFFLINE: "1",
				PRESSURE_FIXTURE_DIR: logs,
				PRESSURE_HOLD_INIT: holdInit ? "1" : "0",
				PI_DELEGATE_CHILD: undefined,
				PI_DELEGATE_SNAPSHOT: undefined,
				PI_CODING_AGENT_SESSION_DIR: undefined,
			},
		},
	);
	const host = new Host(parent, logs);
	try {
		expect(
			JSON.parse(readFileSync(join(getPackageDir(), "package.json"), "utf8"))
				.version,
		).toBe("1.0.0");
		await parent.request("get_state");
		await action(host);
	} finally {
		await parent.stop();
		// Teardown checks even on an assertion failure; no child or snapshot may escape this file.
		for (const child of host.children()) await host.cleaned(child, false);
		await rm(cwd, { recursive: true, force: true });
	}
}
class Host {
	constructor(
		readonly parent: RpcProcess,
		readonly logs: string,
	) {}
	trace(pid: number): PressureTrace[] {
		const path = join(this.logs, `${pid}.trace.jsonl`);
		return existsSync(path)
			? readFileSync(path, "utf8")
					.split("\n")
					.slice(0, -1)
					.map((line) => JSON.parse(line) as PressureTrace)
			: [];
	}
	children(): Child[] {
		return readdirSync(this.logs)
			.filter((f) => f.endsWith(".meta.json"))
			.map((f) => JSON.parse(readFileSync(join(this.logs, f), "utf8")) as Child)
			.filter((c) => c.child);
	}
	async messages(): Promise<Message[]> {
		return (await this.parent.request<{ messages: Message[] }>("get_messages"))
			.messages;
	}
	async prompt(message: string): Promise<void> {
		const settled = this.parent.waitForSettled();
		try {
			await this.parent.request("prompt", { message });
			await settled.promise;
		} finally {
			settled.dispose();
		}
	}
	begin(request: PressureFixtureRequest): Promise<void> {
		const operation = this.prompt(`RUN ${JSON.stringify(request)}`);
		void operation.catch(() => {});
		return operation;
	}
	async child(id?: string): Promise<Child> {
		const result = await eventually(
			() =>
				this.children().find(
					(c) =>
						id === undefined ||
						models(this.trace(c.pid)).some((m) => m.id === id),
				),
			Boolean,
			`child ${id ?? "initializing"}`,
		);
		if (!result) throw new Error("Missing child");
		expect(result.mode).toBe("rpc");
		return result;
	}
	async event(
		child: Pick<Child, "pid">,
		type: string,
		match: (e: PressureTrace) => boolean = () => true,
	): Promise<PressureTrace> {
		const result = await eventually(
			() => this.trace(child.pid).find((e) => e.type === type && match(e)),
			Boolean,
			`${child.pid} ${type}`,
		);
		if (!result) throw new Error("Missing fixture event");
		return result;
	}
	release(child: Pick<Child, "pid">, name: string): Promise<void> {
		return writeFile(
			join(this.logs, `${child.pid}.${name}-release`),
			"release",
		);
	}
	async model(child: Child, call: number): Promise<PressureTrace> {
		return this.event(child, "model", (e) => e.call === call);
	}
	async advance(child: Child, call: number) {
		await this.model(child, call);
		await this.release(child, `model-${call}`);
	}
	async finish(child: Child, from = 0, finishAt = 6) {
		for (let call = from; call <= finishAt; call++)
			await this.advance(child, call);
	}
	async stagesReceived(child: Child) {
		await eventually(
			() => receipts(this.trace(child.pid)),
			(v) => v.length >= 2,
			"both child pressure receipts",
		);
	}
	async idle() {
		await eventually(
			() => this.parent.request<{ isStreaming: boolean }>("get_state"),
			(s) => !s.isStreaming,
			"parent idle",
		);
	}
	async consumed(id: string): Promise<Message[]> {
		const messages = await eventually(
			() => this.messages(),
			(ms) =>
				ms.some(
					(m) =>
						m.role === "assistant" &&
						textOf(m).startsWith("PARENT_SAW:") &&
						textOf(m).includes(`[Background task ${id}:`),
				),
			"parent model consumes completion",
		);
		await this.idle();
		return messages;
	}
	async cleaned(child: Child, graceful = true) {
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
			`child ${child.pid} and inheritance directory cleaned`,
		);
		expect(() => process.kill(child.pid, 0)).toThrow();
		expect(existsSync(dirname(child.snapshot))).toBe(false);
		if (graceful)
			expect(existsSync(join(this.logs, `${child.pid}.closed`))).toBe(true);
	}
}

function assertParentArguments(
	messages: Message[],
	calls: PressureFixtureCall[],
) {
	const emitted = messages
		.filter((m) => m.role === "assistant")
		.flatMap((m) => m.content)
		.filter((b) => b.type === "toolCall")
		.filter((b) => b.name === "delegate");
	expect(emitted).toHaveLength(calls.length);
	for (const [index, expected] of calls.entries()) {
		expect(emitted[index]?.arguments).toMatchObject({
			task: JSON.stringify(expected.task),
			background: expected.background ?? false,
			pressure: expected.pressure,
		});
	}
}
function assertStages(host: Host, child: Child, finishAt = 6) {
	const trace = host.trace(child.pid);
	const received = receipts(trace);
	expect(received).toHaveLength(2);
	expect(received[0]?.text).toMatch(/^\[pi-delegate pressure: warning\]/);
	expect(received[1]?.text).toMatch(/^\[pi-delegate pressure: urgent\]/);
	const warning = models(trace).find((e) =>
		e.reminders?.some((t) => t.startsWith("[pi-delegate pressure: warning]")),
	);
	const urgent = models(trace).find((e) =>
		e.reminders?.some((t) => t.startsWith("[pi-delegate pressure: urgent]")),
	);
	expect(warning).toBeDefined();
	expect(urgent).toBeDefined();
	const warningText =
		warning?.reminders?.find((t) =>
			t.startsWith("[pi-delegate pressure: warning]"),
		) ?? "";
	const urgentText =
		urgent?.reminders?.find((t) =>
			t.startsWith("[pi-delegate pressure: urgent]"),
		) ?? "";
	expect(warningText).toMatch(/core goal/i);
	expect(warningText).toMatch(/stop expanding.*scope/i);
	expect(warningText).toMatch(/prepare.*report/i);
	expect(urgentText).toMatch(/promptly.*end exploration/i);
	expect(urgentText).toMatch(/current findings.*results/i);
	expect(urgentText).toMatch(/unfinished work.*blockers/i);
	for (const input of models(trace)) {
		for (const stage of ["warning", "urgent"])
			expect(
				input.reminders?.filter((t) =>
					t.startsWith(`[pi-delegate pressure: ${stage}]`),
				).length ?? 0,
			).toBeLessThanOrEqual(1);
		for (const name of ["delegate", "delegate_status", "delegate_cancel"])
			expect(input.tools?.map((t) => t.name)).not.toContain(name);
	}
	// Deliberate further tool use AND turns after consuming urgent: no tool block or hard budget.
	expect(urgent?.call).toBeLessThan(finishAt - 1);
	expect(
		trace.some(
			(e) =>
				e.type === "tool-start" && (e.call ?? -1) > (urgent?.call ?? finishAt),
		),
	).toBe(true);
	expect(
		trace
			.filter((e) => e.type === "tool-end")
			.every((e) => e.isError === false),
	).toBe(true);
}
function assertResult(
	result: ToolResult,
	child: Child,
	id: string,
	modelCalls = 7,
) {
	expect(result.isError).toBe(false);
	expect(result.details as unknown as DelegationDetails).toMatchObject({
		status: "completed",
		stopReason: "stop",
	});
	expect(
		(result.details as unknown as DelegationDetails).sessionId,
	).toBeTruthy();
	expect(textOf(result)).toBe(report(id));
	expect(result.usage).toMatchObject({
		input: modelCalls * 2,
		output: modelCalls,
		totalTokens: modelCalls * 3,
	});
	expect(result.usage?.cost.total).toBeCloseTo(modelCalls * 0.03);
	expect(child.pid).toBeGreaterThan(0);
}

// Real elapsed clocks are intentional. Files order work; polling waits for evidence, not an immediate-next-call SLA.
test("pressure real RPC: sync elapsed OR includes a held provider, excludes initialization, deduplicates later turn triggers, and stays advisory", async () => {
	await withHost(async (host) => {
		const call = {
			task: { id: "sync-time" },
			pressure: {
				warning: { afterSeconds: 0.15, afterTurns: 1 },
				urgent: { afterSeconds: 0.3, afterTurns: 2 },
			},
		};
		const done = host.begin({ calls: [call] });
		const child = await host.child();
		const init = await host.event(
			child,
			"gate-ready",
			(e) => e.text === "init",
		);
		await eventually(
			() => Date.now() - init.at,
			(ms) => ms >= 450,
			"initialization held beyond both elapsed thresholds",
		);
		expect(receipts(host.trace(child.pid))).toHaveLength(0);
		expect(models(host.trace(child.pid))).toHaveLength(0);
		await host.release(child, "init");
		const first = await host.model(child, 0);
		expect(first.reminders).toEqual([]);
		expect(first.completed).toBe(0);
		await host.event(child, "message-start", (e) => e.role === "assistant");
		expect(
			host.trace(child.pid).filter((e) => e.type === "turn-end"),
		).toHaveLength(0);
		await host.stagesReceived(child);
		expect(receipts(host.trace(child.pid)).map((r) => r.completed)).toEqual([
			0, 0,
		]);
		expect(
			host
				.trace(child.pid)
				.some((e) => e.type === "message-end" && e.role === "assistant"),
		).toBe(false);
		expect(() => process.kill(child.pid, 0)).not.toThrow();
		await host.finish(child);
		await done;
		assertParentArguments(await host.messages(), [call]);
		const parentInput = host
			.trace(host.parent.child.pid ?? 0)
			.find((e) => e.type === "parent-model");
		expect(
			parentInput?.tools?.find((t) => t.name === "delegate")?.parameters,
		).toHaveProperty("properties.pressure");
		assertStages(host, child);
		assertResult(tool(await host.messages(), "delegate"), child, call.task.id);
		await host.cleaned(child);
	}, true);
}, 30_000);

test("pressure real RPC: unfinished assistant/multiple parallel and nested tools are one completed turn, not tool/message counters", async () => {
	await withHost(async (host) => {
		const call = {
			task: { id: "sync-turns", batch: true, holdToolsAt: [0] },
			pressure: turnPolicy,
		};
		const done = host.begin({ calls: [call] });
		const child = await host.child(call.task.id);
		await host.advance(child, 0);
		const held = await host.event(
			child,
			"gate-ready",
			(e) => e.text === "tool-0",
		);
		await eventually(
			() => host.trace(child.pid).filter((e) => e.type === "tool-end"),
			(events) => events.length === 4,
			"quick sibling, nested wrapper and two nested leaves finish while last sibling held",
		);
		// Observe a quiet window while the unfinished batch is still file-gated.
		await eventually(
			() => Date.now() - held.at,
			(ms) => ms >= 150,
			"pending tool observation window",
		);
		expect(receipts(host.trace(child.pid))).toHaveLength(0);
		expect(
			host.trace(child.pid).filter((e) => e.type === "turn-end"),
		).toHaveLength(0);
		expect(
			host
				.trace(child.pid)
				.some((e) => e.type === "message-end" && e.role === "assistant"),
		).toBe(true);
		expect(
			host
				.trace(child.pid)
				.filter((e) => e.type === "tool-end" && e.parentToolCallId),
		).toHaveLength(2);
		await host.release(child, "tool-0");
		await host.model(child, 1);
		await host.event(
			child,
			"pressure-receipt",
			(e) => e.text?.includes("warning") ?? false,
		);
		expect(receipts(host.trace(child.pid)).map((e) => e.completed)).toEqual([
			1,
		]);
		expect(
			host.trace(child.pid).find((e) => e.type === "turn-end")?.toolResults,
		).toBe(3);
		await host.advance(child, 1);
		await host.model(child, 2);
		await host.stagesReceived(child);
		expect(receipts(host.trace(child.pid)).map((e) => e.completed)).toEqual([
			1, 2,
		]);
		await host.finish(child, 2);
		await done;
		assertStages(host, child);
		assertResult(tool(await host.messages(), "delegate"), child, call.task.id);
		await host.cleaned(child);
	});
}, 30_000);

test("pressure real RPC: background pressure survives initiating parent completion and retains normal completion/output/separate usage", async () => {
	await withHost(async (host) => {
		const call = {
			task: { id: "background-time", holdToolsAt: [0] },
			background: true,
			pressure: timePolicy,
		};
		await host.begin({ calls: [call] }); // Initiating parent turn is already finished, before actual child task.
		const acknowledgement = tool(await host.messages(), "delegate");
		const id = background(acknowledgement).taskId;
		expect(background(acknowledgement).status).toBe("running");
		expect(acknowledgement.usage).toBeUndefined();
		const child = await host.child();
		await host.release(child, "init");
		await host.advance(child, 0);
		await host.event(child, "gate-ready", (e) => e.text === "tool-0");
		await host.stagesReceived(child);
		expect(receipts(host.trace(child.pid)).map((e) => e.completed)).toEqual([
			0, 0,
		]);
		expect(host.trace(child.pid).some((e) => e.type === "turn-end")).toBe(
			false,
		);
		await host.prompt(`STATUS ${id}`);
		expect(
			background(tool(await host.messages(), "delegate_status")).status,
		).toBe("running");
		await host.release(child, "tool-0");
		await host.finish(child, 1);
		const all = await host.consumed(id);
		assertParentArguments(all, [call]);
		assertStages(host, child);
		expect(
			all.filter(
				(m) => m.role === "custom" && m.customType === BACKGROUND_MESSAGE,
			),
		).toHaveLength(1);
		expect(
			all.some(
				(m) =>
					m.role === "assistant" && textOf(m).includes(report(call.task.id)),
			),
		).toBe(true);
		await host.prompt(`STATUS ${id}`);
		const result = tool(await host.messages(), "delegate_status");
		expect(background(result)).toMatchObject({
			status: "completed",
			result: { status: "completed", stopReason: "stop" },
			usage: { input: 14, output: 7, totalTokens: 21 },
		});
		expect(background(result).result?.sessionId).toBeTruthy();
		expect(result.usage).toBeUndefined();
		const messages = await host.messages();
		const stats = await host.parent.request<{ tokens: { total: number } }>(
			"get_session_stats",
		);
		expect(stats.tokens.total).toBe(
			messages.reduce(
				(sum, m) => sum + (m.role === "assistant" ? m.usage.totalTokens : 0),
				0,
			),
		);
		await host.cleaned(child);
	}, true);
}, 30_000);

test("pressure real RPC: cancelling the initiating background parent turn does not cancel pressure; explicit task cancel cleans continued work", async () => {
	await withHost(async (host) => {
		const call = {
			task: { id: "background-parent-abort", holdToolsAt: [4] },
			background: true,
			pressure: timePolicy,
		};
		const initiating = host.begin({ calls: [call], holdAfterAck: true });
		await host.event(
			{ pid: host.parent.child.pid ?? 0 },
			"gate-ready",
			(e) => e.text === "parent-after-ack",
		);
		const id = background(tool(await host.messages(), "delegate")).taskId;
		await host.parent.request("abort");
		await initiating;
		const child = await host.child();
		await host.release(child, "init");
		await host.model(child, 0);
		await host.stagesReceived(child);
		for (let n = 0; n <= 4; n++) await host.advance(child, n);
		await host.event(child, "gate-ready", (e) => e.text === "tool-4");
		assertStages(host, child);
		await host.prompt(`STATUS ${id}`);
		expect(
			background(tool(await host.messages(), "delegate_status")).status,
		).toBe("running");
		expect(() => process.kill(child.pid, 0)).not.toThrow();
		await host.prompt(`CANCEL ${id}`);
		const cancelled = tool(await host.messages(), "delegate_cancel");
		expect(background(cancelled).status).toBe("cancelled");
		expect(cancelled.isError).toBe(true);
		await host.cleaned(child);
		const count = host.trace(child.pid).length;
		await host.release(child, "tool-4"); // A late file release cannot resurrect the cancelled child.
		await host.consumed(id);
		await host.prompt(`STATUS ${id}`);
		expect(
			background(tool(await host.messages(), "delegate_status")).status,
		).toBe("cancelled");
		expect(host.trace(child.pid)).toHaveLength(count);
	}, true);
}, 30_000);

test("pressure real RPC: concurrent sync/background calls keep distinct thresholds and once-per-stage state", async () => {
	await withHost(async (host) => {
		const calls = [
			{
				task: { id: "isolated-background", finishAt: 8 },
				background: true,
				pressure: {
					warning: { afterSeconds: 60, afterTurns: 3 },
					urgent: { afterSeconds: 120, afterTurns: 5 },
				},
			},
			{ task: { id: "isolated-sync" }, pressure: turnPolicy },
		];
		const parentDone = host.begin({ calls });
		const sync = await host.child("isolated-sync");
		const bg = await host.child("isolated-background");
		expect(bg.pid).not.toBe(sync.pid);
		await host.advance(sync, 0);
		await host.event(
			sync,
			"pressure-receipt",
			(e) => e.text?.includes("warning") ?? false,
		);
		await host.advance(sync, 1);
		await host.stagesReceived(sync);
		expect(receipts(host.trace(bg.pid))).toHaveLength(0);
		expect(models(host.trace(bg.pid))[0]?.reminders).toEqual([]);
		await host.finish(sync, 2);
		await parentDone;
		assertStages(host, sync);
		assertParentArguments(await host.messages(), calls);
		const delegated = (await host.messages()).filter(
			(m): m is ToolResult =>
				m.role === "toolResult" && m.toolName === "delegate",
		);
		const syncResult = delegated.find(
			(r) => (r.details as unknown as DelegationDetails).status === "completed",
		);
		if (!syncResult) throw new Error("Missing sync result");
		assertResult(syncResult, sync, "isolated-sync");
		const ack = delegated.find((r) => background(r).status === "running");
		if (!ack) throw new Error("Missing background acknowledgement");
		for (let n = 0; n < 3; n++) await host.advance(bg, n);
		await host.event(
			bg,
			"pressure-receipt",
			(e) => e.text?.includes("warning") ?? false,
		);
		expect(receipts(host.trace(bg.pid)).map((e) => e.completed)).toEqual([3]);
		for (let n = 3; n < 5; n++) await host.advance(bg, n);
		await host.stagesReceived(bg);
		expect(receipts(host.trace(bg.pid)).map((e) => e.completed)).toEqual([
			3, 5,
		]);
		await host.finish(bg, 5, 8);
		await host.consumed(background(ack).taskId);
		assertStages(host, bg, 8);
		await host.cleaned(sync);
		await host.cleaned(bg);
	});
}, 30_000);

test("pressure real RPC: invalid cross-stage policies fail before spawning or acknowledging either mode", async () => {
	await withHost(async (host) => {
		const calls = [false, true].flatMap((background) => [
			{
				task: { id: `invalid-time-${background}` },
				background,
				pressure: { warning: { afterSeconds: 2 }, urgent: { afterSeconds: 1 } },
			},
			{
				task: { id: `invalid-turns-${background}` },
				background,
				pressure: { warning: { afterTurns: 2 }, urgent: { afterTurns: 2 } },
			},
		]);
		await host.begin({ calls });
		const messages = await host.messages();
		assertParentArguments(messages, calls);
		const results = messages.filter(
			(m): m is ToolResult =>
				m.role === "toolResult" && m.toolName === "delegate",
		);
		expect(results).toHaveLength(4);
		for (const result of results) {
			expect(result.isError).toBe(true);
			expect(result.details).toMatchObject({ status: "failed" });
			expect(result.details).not.toHaveProperty("taskId");
			expect(textOf(result)).toMatch(
				/pressure\.urgent\.(afterSeconds|afterTurns) must exceed/,
			);
		}
		await host.prompt("UNRELATED");
		expect(host.children()).toHaveLength(0);
	});
}, 30_000);

test("pressure real RPC: raw null/string/boolean values are rejected before host coercion in both modes", async () => {
	await withHost(async (host) => {
		const invalid = [
			["pressure", null],
			["pressure.warning", { warning: null }],
			["pressure.warning.afterSeconds", { warning: { afterSeconds: null } }],
			["pressure.urgent.afterTurns", { urgent: { afterTurns: null } }],
			["pressure.warning.afterSeconds", { warning: { afterSeconds: "1" } }],
			["pressure.warning.afterSeconds", { warning: { afterSeconds: true } }],
			["pressure.warning.afterTurns", { warning: { afterTurns: true } }],
			["pressure.warning.afterSeconds", { warning: { afterSeconds: 0 } }],
			["pressure.urgent.afterSeconds", { urgent: { afterSeconds: -1 } }],
			["pressure.warning.afterTurns", { warning: { afterTurns: 0 } }],
			["pressure.urgent.afterTurns", { urgent: { afterTurns: 1.5 } }],
			["pressure.warning.extra", { warning: { extra: 1 } }],
		] as const;
		// Intentionally malformed but JSON-serializable parent-model arguments.
		const calls = [false, true].flatMap((background) =>
			invalid.map(([_path, pressure], index) => ({
				task: { id: `invalid-raw-${background}-${index}` },
				background,
				pressure,
			})),
		) as unknown as PressureFixtureCall[];
		await host.begin({ calls });
		const messages = await host.messages();
		assertParentArguments(messages, calls);
		const results = messages.filter(
			(m): m is ToolResult =>
				m.role === "toolResult" && m.toolName === "delegate",
		);
		expect(results).toHaveLength(calls.length);
		for (const [index, result] of results.entries()) {
			expect(result.isError).toBe(true);
			expect(result.details).toMatchObject({ status: "failed" });
			expect(result.usage?.totalTokens).toBe(0);
			expect(textOf(result)).toContain(invalid[index % invalid.length][0]);
			expect(result.details ?? {}).not.toHaveProperty("taskId");
		}
		await host.prompt("UNRELATED");
		expect(host.children()).toHaveLength(0);
	});
}, 30_000);

test("pressure real RPC: fast completion clears deadlines and cannot create a new child run or late completion", async () => {
	await withHost(async (host) => {
		const call = { task: { id: "fast", fast: true }, pressure: timePolicy };
		await host.begin({ calls: [call] });
		const child = await host.child(call.task.id);
		assertResult(
			tool(await host.messages(), "delegate"),
			child,
			call.task.id,
			1,
		);
		await host.cleaned(child);
		const trace = host.trace(child.pid);
		const finished = trace.find((e) => e.type === "settled");
		if (!finished) throw new Error("Missing child settlement");
		await eventually(
			() => Date.now() - finished.at,
			(ms) => ms >= 450,
			"former pressure deadlines passed after completion",
		);
		await host.release(child, "model-1");
		await host.prompt("UNRELATED");
		expect(host.trace(child.pid)).toEqual(trace);
		expect(receipts(trace)).toHaveLength(0);
		expect(trace.filter((e) => e.type === "agent-start")).toHaveLength(1);
		expect(host.children()).toHaveLength(1);
		expect(
			(await host.messages()).filter(
				(m) => m.role === "custom" && m.customType === BACKGROUND_MESSAGE,
			),
		).toHaveLength(0);
	});
}, 30_000);

test("pressure real RPC: explicit background cancel during gated initialization removes all pre-task resources", async () => {
	await withHost(async (host) => {
		await host.begin({
			calls: [
				{ task: { id: "cancel-init" }, background: true, pressure: timePolicy },
			],
		});
		const id = background(tool(await host.messages(), "delegate")).taskId;
		const child = await host.child();
		await host.event(child, "gate-ready", (e) => e.text === "init");
		await host.prompt(`CANCEL ${id}`);
		expect(
			background(tool(await host.messages(), "delegate_cancel")).status,
		).toBe("cancelled");
		await host.cleaned(child, false); // Startup may require forced stop rather than session_shutdown.
		expect(models(host.trace(child.pid))).toHaveLength(0);
		expect(receipts(host.trace(child.pid))).toHaveLength(0);
		await host.release(child, "init");
		await host.consumed(id);
		expect(models(host.trace(child.pid))).toHaveLength(0);
	}, true);
}, 30_000);

test("pressure real RPC: synchronous parent abort still cancels a pressured child and awaits resource cleanup", async () => {
	await withHost(async (host) => {
		const call = {
			task: { id: "sync-cancel", holdToolsAt: [4] },
			pressure: timePolicy,
		};
		const done = host.begin({ calls: [call] });
		const child = await host.child(call.task.id);
		await host.stagesReceived(child);
		for (let n = 0; n <= 4; n++) await host.advance(child, n);
		await host.event(child, "gate-ready", (e) => e.text === "tool-4");
		assertStages(host, child);
		await host.parent.request("abort");
		await done;
		const result = tool(await host.messages(), "delegate");
		expect(result.isError).toBe(true);
		expect(result.details).toMatchObject({ status: "cancelled" });
		expect(textOf(result)).toContain("Delegation cancelled");
		await host.cleaned(child);
		const trace = host.trace(child.pid);
		await host.release(child, "tool-4");
		await host.prompt("UNRELATED");
		expect(host.trace(child.pid)).toEqual(trace);
	});
}, 30_000);

for (const boundary of ["tree", "shutdown"] as const) {
	test(`pressure real RPC: ${boundary} cleans a child after both tiers without resurrection or stale completion`, async () => {
		await withHost(async (host) => {
			await host.prompt("ANCHOR");
			const { entries } = await host.parent.request<{
				entries: SessionEntry[];
			}>("get_entries");
			const anchor = [...entries]
				.reverse()
				.find((e) => e.type === "message" && e.message.role === "assistant");
			if (!anchor) throw new Error("Missing pressure branch anchor");
			const call = {
				task: { id: `pressure-${boundary}` },
				background: true,
				pressure: timePolicy,
			};
			await host.begin({ calls: [call] });
			const id = background(tool(await host.messages(), "delegate")).taskId;
			const child = await host.child(call.task.id);
			await host.stagesReceived(child);
			if (boundary === "tree")
				await host.parent.request("prompt", {
					message: `/pressure-tree ${anchor.id}`,
				});
			else await host.parent.stop();
			await host.cleaned(child);
			const trace = host.trace(child.pid);
			expect(receipts(trace)).toHaveLength(2);
			await host.release(child, "model-0");
			if (boundary === "tree") {
				await host.prompt(`STATUS ${id}`);
				const query = tool(await host.messages(), "delegate_status");
				expect(query.isError).toBe(true);
				expect(textOf(query)).toContain(`Unknown background task: ${id}`);
				expect(
					(await host.messages()).filter(
						(m) => m.role === "custom" && m.customType === BACKGROUND_MESSAGE,
					),
				).toHaveLength(0);
			}
			expect(host.trace(child.pid)).toEqual(trace);
		});
	}, 30_000);
}

for (const [reason, status, isError] of [
	["length", "incomplete", false],
	["error", "failed", true],
] as const) {
	test(`pressure real RPC: after both tiers ${reason} keeps ${status}, output and available usage semantics`, async () => {
		await withHost(async (host) => {
			const call = {
				task: { id: `pressured-${reason}`, reason },
				pressure: timePolicy,
			};
			const done = host.begin({ calls: [call] });
			const child = await host.child(call.task.id);
			await host.stagesReceived(child);
			await host.finish(child);
			await done;
			assertStages(host, child);
			const result = tool(await host.messages(), "delegate");
			expect(result.isError).toBe(isError);
			expect(result.details).toMatchObject({ status, stopReason: reason });
			expect(textOf(result)).toContain(report(call.task.id));
			expect(result.usage).toMatchObject({
				input: 14,
				output: 7,
				totalTokens: 21,
			});
			expect(result.usage?.cost.total).toBeCloseTo(0.21);
			await host.cleaned(child);
		});
	}, 30_000);
}
