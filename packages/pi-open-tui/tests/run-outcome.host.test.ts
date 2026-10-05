import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	type AgentBeforeSettleEvent,
	type AgentSession,
	type BoundaryResult,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionAPI,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	VERSION,
} from "@earendil-works/pi-coding-agent";
import { RunOutcomeTracker, type RunOutcome, type RunState } from "../src/run-outcome.ts";
import { deferred, gate, type ResponseStep, runOutcomeProvider } from "./fixtures/run-outcome-provider.ts";

type TrackedEvent = Parameters<RunOutcomeTracker["handle"]>[0];
type Snapshot = RunState & { type: string; at: number; reason?: string; outcome?: string; isError?: boolean; signalAborted?: boolean };
type Options = {
	retry?: boolean;
	retryDelayMs?: number;
	abortAtToolStart?: boolean;
	boundaryGate?: ReturnType<typeof gate>;
	boundary?: (event: AgentBeforeSettleEvent, count: number) => BoundaryResult | undefined;
};

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 5_000);
		})]);
	} finally { clearTimeout(timer); }
}

// Real SDK, resource loader, ExtensionRunner and agent loop; only the provider,
// tool and injected tracker clock are deterministic fakes. No event is fabricated
// or manually emitted into the tracker. This is not a terminal/rendering test.
async function withHost(
	steps: ResponseStep[], options: Options,
	body: (host: Awaited<ReturnType<typeof createHost>>) => Promise<void>,
) {
	const host = await createHost(steps, options);
	try { await body(host); }
	finally { await host.close(); }
}

async function createHost(steps: ResponseStep[], options: Options) {
	assert.equal(VERSION, "1.0.0", "these lifecycle assertions are pinned to Pi 1.0.0");
	const cwd = await mkdtemp(join(tmpdir(), "open-tui-outcome-host-"));
	const agentDir = join(cwd, "agent");
	const state: RunState = { workingSince: undefined, lastRun: undefined };
	let now = 1_000;
	const tracker = new RunOutcomeTracker(state, () => now);
	const trace: Snapshot[] = [];
	const errors: string[] = [];
	const retryEvents: Array<{ type: string; success?: boolean; delayMs?: number }> = [];
	const retryStarted = deferred();
	const provider = runOutcomeProvider(steps);
	let boundaries = 0;
	let session: AgentSession | undefined;
	let unsubscribe: (() => void) | undefined;
	const snapshot = (type: string, extra: Partial<Snapshot> = {}) => {
		trace.push({ type, at: now, workingSince: state.workingSince,
			lastRun: state.lastRun ? { ...state.lastRun } : undefined, ...extra });
	};
	const observe = (event: TrackedEvent, ctx: { signal?: AbortSignal }) => {
		now += 10;
		tracker.handle(event, ctx.signal);
		snapshot(event.type, { signalAborted: ctx.signal?.aborted,
			...(event.type === "message_end" && event.message.role === "assistant"
				? { reason: event.message.stopReason }
				: event.type === "agent_before_settle" ? { outcome: event.outcome } : {}),
		});
	};
	const observer = (pi: ExtensionAPI) => {
		pi.on("agent_start", observe);
		pi.on("message_end", observe);
		pi.on("agent_end", observe);
		pi.on("agent_settled", observe);
		pi.on("turn_start", observe);
		pi.on("turn_end", observe);
		pi.on("agent_before_settle", async (event, ctx) => {
			observe(event, ctx);
			boundaries++;
			if (options.boundaryGate && boundaries === 1) {
				options.boundaryGate.entered.resolve();
				await options.boundaryGate.release.promise;
			}
			return options.boundary?.(event, boundaries);
		});
		pi.on("tool_execution_start", (_event, ctx) => {
			if (options.abortAtToolStart) ctx.abort();
		});
		pi.on("tool_execution_end", (event) => snapshot(event.type, { isError: event.isError }));
	};
	try {
		await mkdir(agentDir);
		await writeFile(join(agentDir, "auth.json"), "{}");
		const settingsManager = SettingsManager.inMemory({
			defaultProvider: "run-outcome-fixture", defaultModel: "deterministic",
			compaction: { enabled: false },
			retry: { enabled: options.retry ?? false, maxRetries: 1, baseDelayMs: options.retryDelayMs ?? 5 },
			cacheWarming: "off", enableInstallTelemetry: false, enableAnalytics: false,
		});
		const resourceLoader = new DefaultResourceLoader({
			cwd, agentDir, settingsManager, noExtensions: true, noSkills: true,
			noPromptTemplates: true, noThemes: true, noContextFiles: true,
			extensionFactories: [provider.extension, observer],
		});
		await resourceLoader.reload();
		assert.deepEqual(resourceLoader.getExtensions().errors, []);
		const modelRuntime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json"),
			modelsStorePath: join(agentDir, "models-cache.json"),
			allowModelNetwork: false, refreshOnCreate: false,
		});
		({ session } = await createAgentSession({
			cwd, agentDir, settingsManager, modelRuntime, resourceLoader,
			sessionManager: SessionManager.inMemory(cwd), thinkingLevel: "off",
			tools: ["outcome_failing_tool"],
		}));
		const model = modelRuntime.getModel("run-outcome-fixture", "deterministic");
		assert.ok(model, "local fixture model is registered by the actual extension runtime");
		await session.setModel(model);
		unsubscribe = session.subscribe((event) => {
			if (event.type === "auto_retry_start") {
				now += 700; // deterministic elapsed interval including recovery wait
				retryEvents.push({ type: event.type, delayMs: event.delayMs });
				snapshot(event.type);
				retryStarted.resolve();
			} else if (event.type === "auto_retry_end") {
				retryEvents.push({ type: event.type, success: event.success });
				snapshot(event.type);
			}
		});
		await session.bindExtensions({ mode: "json", onError: (event) => errors.push(event.error) });
	} catch (error) {
		session?.dispose();
		await rm(cwd, { recursive: true, force: true });
		throw error;
	}
	const activeSession = session;
	return {
		session: activeSession, state, trace, provider, retryEvents, retryStarted,
		advance: (ms: number) => { now += ms; },
		async prompt() { await bounded(activeSession.prompt("exercise deterministic outcome"), "prompt settlement"); },
		async close() {
			options.boundaryGate?.release.resolve();
			for (const step of steps) step.gate?.release.resolve();
			try { await bounded(activeSession.abort(), "cleanup abort"); }
			finally { unsubscribe?.(); activeSession.dispose(); await rm(cwd, { recursive: true, force: true }); }
		},
		assertFinal(outcome: RunOutcome, calls: number) {
			assert.deepEqual(errors, [], "host must not swallow assertion/setup/extension errors");
			assert.deepEqual(provider.failures, []);
			assert.equal(provider.calls, calls);
			const starts = trace.filter((entry) => entry.type === "agent_start");
			const settled = trace.filter((entry) => entry.type === "agent_settled");
			assert.ok(starts.length > 0);
			assert.equal(settled.length, 1, "one full-run finalization");
			const start = starts[0].workingSince;
			assert.equal(typeof start, "number");
			for (const entry of trace.filter((entry) => entry.type !== "agent_settled")) {
				assert.equal(entry.lastRun, undefined, `${entry.type} is provisional`);
				assert.equal(entry.workingSince, start, `${entry.type} retains the full-run timer`);
			}
			assert.deepEqual(state.lastRun, { outcome, elapsedMs: settled[0].at - start! });
			assert.equal(state.workingSince, undefined);
			assert.deepEqual(settled[0].lastRun, state.lastRun);
		},
	};
}

const limits = { timeout: 15_000, concurrency: false };

test("Pi 1.0.0: success is provisional at before_settle and completed only at settled", limits, async () => {
	const boundaryGate = gate();
	await withHost([{ kind: "stop" }], { boundaryGate }, async (h) => {
		const run = h.prompt();
		await bounded(boundaryGate.entered.promise, "before-settle gate");
		assert.equal(h.trace.at(-1)?.type, "agent_before_settle");
		assert.equal(h.trace.at(-1)?.outcome, "completed");
		assert.equal(h.state.lastRun, undefined);
		h.advance(500);
		boundaryGate.release.resolve();
		await run;
		h.assertFinal("completed", 1);
		assert.ok(h.state.lastRun!.elapsedMs >= 500, "timer includes the actionable boundary wait");
	});
});

test("Pi 1.0.0: terminal provider error produces failed at settlement", limits, async () => {
	await withHost([{ kind: "error" }], {}, async (h) => {
		await h.prompt();
		assert.deepEqual(h.trace.filter((e) => e.type === "agent_before_settle").map((e) => e.outcome), ["error"]);
		h.assertFinal("failed", 1);
	});
});

test("Pi 1.0.0: abort during an active stream produces interrupted, without before_settle", limits, async () => {
	const streamGate = gate();
	await withHost([{ kind: "stop", gate: streamGate }], {}, async (h) => {
		const run = h.prompt();
		await bounded(streamGate.entered.promise, "stream gate");
		assert.equal(h.session.isStreaming, true);
		assert.equal(h.state.lastRun, undefined);
		h.advance(300);
		await bounded(h.session.abort(), "stream abort");
		await run;
		assert.ok(h.trace.some((e) => e.reason === "aborted"));
		assert.equal(h.trace.some((e) => e.type === "agent_before_settle"), false);
		h.assertFinal("interrupted", 1);
	});
});

test("Pi 1.0.0: automatic error retry succeeds with no interim final and one continuous timer", limits, async () => {
	await withHost([{ kind: "error", error: "429 rate limit exceeded" }, { kind: "stop" }], { retry: true }, async (h) => {
		await h.prompt();
		assert.deepEqual(h.retryEvents.map((e) => [e.type, e.success]), [["auto_retry_start", undefined], ["auto_retry_end", true]]);
		assert.equal(h.trace.filter((e) => e.type === "agent_start").length, 2);
		assert.equal(h.trace.filter((e) => e.type === "agent_end").length, 2);
		assert.equal(h.trace.filter((e) => e.type === "agent_before_settle").length, 1);
		h.assertFinal("completed", 2);
		assert.ok(h.state.lastRun!.elapsedMs >= 700, "elapsed includes recovery, not only the successful loop");
	});
});

test("Pi 1.0.0: cancellation during retry wait is neutral ended, not stale failed or guessed interrupted", limits, async () => {
	await withHost([{ kind: "error", error: "429 rate limit exceeded" }], { retry: true, retryDelayMs: 60_000 }, async (h) => {
		const run = h.prompt();
		await bounded(h.retryStarted.promise, "automatic retry wait");
		assert.equal(h.session.isRetrying, true);
		assert.equal(h.state.lastRun, undefined);
		await bounded(h.session.abort(), "retry cancellation");
		await run;
		assert.equal(h.trace.some((e) => e.type === "agent_before_settle"), false);
		assert.equal(h.trace.some((e) => e.reason === "aborted"), false);
		assert.equal(h.retryEvents.at(-1)?.success, false);
		h.assertFinal("ended", 1);
	});
});

test("Pi 1.0.0: tool-phase abort uses the captured operation signal", limits, async () => {
	await withHost([{ kind: "toolUse" }], { abortAtToolStart: true }, async (h) => {
		await h.prompt();
		assert.ok(h.trace.some((e) => e.reason === "toolUse"));
		assert.ok(h.trace.some((e) => e.signalAborted === true));
		h.assertFinal("interrupted", 1);
	});
});

test("Pi 1.0.0: real failed tool execution followed by a normal assistant is completed", limits, async () => {
	await withHost([{ kind: "toolUse" }, { kind: "stop" }], {}, async (h) => {
		await h.prompt();
		assert.ok(h.trace.some((e) => e.type === "tool_execution_end" && e.isError));
		assert.ok(h.session.messages.some((m) => m.role === "toolResult" && m.isError));
		assert.deepEqual(h.trace.filter((e) => e.reason).map((e) => e.reason), ["toolUse", "stop"]);
		h.assertFinal("completed", 2);
	});
});

test("Pi 1.0.0: length remains neutral even though the host boundary says completed", limits, async () => {
	await withHost([{ kind: "length" }], {}, async (h) => {
		await h.prompt();
		assert.ok(h.trace.some((e) => e.reason === "length"));
		assert.deepEqual(h.trace.filter((e) => e.type === "agent_before_settle").map((e) => e.outcome), ["completed"]);
		h.assertFinal("ended", 1);
	});
});

test("Pi 1.0.0: before_settle continuation supersedes provisional completion without resetting time", limits, async () => {
	const continuationGate = gate();
	await withHost([{ kind: "stop" }, { kind: "error", gate: continuationGate }], {
		boundary: (_event, count) => count === 1 ? { continue: true, entries: [{ type: "custom_message", customType: "outcome-continuation", content: "continue once", display: false }] } : undefined,
	}, async (h) => {
		const run = h.prompt();
		await bounded(continuationGate.entered.promise, "continued provider request");
		assert.equal(h.trace.filter((e) => e.type === "agent_start").length, 2);
		assert.equal(h.state.lastRun, undefined, "first completed boundary is not final");
		assert.equal(h.state.workingSince, h.trace[0].workingSince);
		h.advance(900);
		continuationGate.release.resolve();
		await run;
		assert.deepEqual(h.trace.filter((e) => e.type === "agent_before_settle").map((e) => e.outcome), ["completed", "error"]);
		h.assertFinal("failed", 2);
		assert.ok(h.state.lastRun!.elapsedMs >= 900);
	});
});

test("Pi 1.0.0: late before_settle cancellation is observationally ambiguous with normal completion", limits, async () => {
	const evidence: Array<Array<{ type: string; reason?: string; outcome?: string; signalAborted?: boolean }>> = [];
	for (const cancel of [false, true]) {
		const boundaryGate = gate();
		await withHost([{ kind: "stop" }], { boundaryGate }, async (h) => {
			const run = h.prompt();
			await bounded(boundaryGate.entered.promise, "late boundary cancellation gate");
			// The agent's operation signal has ended already. abort() is public, but
			// the host emits no distinct outcome event for this late cancellation.
			const abort = cancel ? h.session.abort() : Promise.resolve();
			boundaryGate.release.resolve();
			await bounded(abort, "late abort");
			await run;
			h.assertFinal("completed", 1);
			evidence.push(h.trace.map(({ type, reason, outcome, signalAborted }) => ({ type, reason, outcome, signalAborted })));
		});
	}
	assert.deepEqual(evidence[1], evidence[0], "public lifecycle evidence cannot distinguish this cancellation");
});
