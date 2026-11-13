import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createEventBus,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { GoalController } from "../src/controller.ts";
import goal from "../src/index.ts";
import type { GoalState } from "../src/model.ts";
import { GoalStore } from "../src/store.ts";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface Report {
	draft?: { id: string; request: string; proposal?: unknown };
	state?: GoalState;
	runtimeActive: boolean;
	started?: boolean;
	error?: string;
}
interface ToolResult {
	details: Report;
	isError?: boolean;
	terminate?: boolean;
}
const proposalValues = {
	objective: "Fix the parser regression",
	criteria: ["Regression passes", "Existing tests pass"],
	allowance: 7,
};

async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "pi-goal-creation-adapter-"));
	const agentRoot = join(directory, "agent");
	const cwd = join(directory, "project");
	await mkdir(cwd);
	const oldRoot = process.env.PI_CODING_AGENT_DIR;
	const oldChild = process.env.PI_DELEGATE_CHILD;
	process.env.PI_CODING_AGENT_DIR = agentRoot;
	delete process.env.PI_DELEGATE_CHILD;
	const events = createEventBus();
	const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
	const commands = new Map<
		string,
		Parameters<ExtensionAPI["registerCommand"]>[1]
	>();
	const hooks = new Map<string, ((...args: unknown[]) => unknown)[]>();
	const messages: unknown[] = [];
	const userMessages: string[] = [];
	const notices: { message: string; level: string }[] = [];
	const dialogs: {
		title: string;
		options: string[];
		signal?: AbortSignal;
		answer: ReturnType<typeof deferred<string | undefined>>;
	}[] = [];
	let idleNow = true;
	let idleCalls = 0;
	let aborts = 0;
	let executions = 0;
	// Real public discovery protocol, but no runner/model/child process. Any
	// worker/reviewer dispatch during these creation-only cases is a failure.
	const unexpected = () => {
		throw new Error("Unexpected delegate operation during creation");
	};
	events.on("@wangjq4214/pi-delegate:discover", (request) => {
		(request as { reply(value: unknown): void }).reply({
			version: 1,
			execute: async () => {
				executions++;
				return unexpected();
			},
			status: unexpected,
			list: unexpected,
			wait: unexpected,
			cancel: unexpected,
		});
	});
	const pi = {
		events,
		registerTool(tool: Parameters<ExtensionAPI["registerTool"]>[0]) {
			tools.set(tool.name, tool);
		},
		registerCommand(
			name: string,
			command: Parameters<ExtensionAPI["registerCommand"]>[1],
		) {
			commands.set(name, command);
		},
		on(name: string, hook: (...args: unknown[]) => unknown) {
			hooks.set(name, [...(hooks.get(name) ?? []), hook]);
		},
		sendMessage(message: unknown) {
			messages.push(message);
		},
		sendUserMessage(message: string) {
			userMessages.push(message);
		},
	} as unknown as ExtensionAPI;
	const ctx = {
		cwd,
		hasUI: true,
		isIdle: () => idleNow,
		waitForIdle: () => {
			idleCalls++;
			throw new Error("Creation must not depend on waitForIdle");
		},
		abort: () => {
			aborts++;
		},
		ui: {
			notify: (message: string, level: string) => {
				notices.push({ message, level });
			},
			// Intentionally does NOT obey signal: exercise late host callbacks even
			// when the native UI would normally dismiss the aborted dialog.
			select: (
				title: string,
				options: string[],
				settings?: { signal?: AbortSignal },
			) => {
				const answer = deferred<string | undefined>();
				dialogs.push({ title, options, signal: settings?.signal, answer });
				return answer.promise;
			},
		},
	} as unknown as ExtensionCommandContext;
	const emit = async (name: string, event: unknown = {}) => {
		const responses: unknown[] = [];
		for (const hook of hooks.get(name) ?? [])
			responses.push(await hook(event, ctx));
		return responses;
	};
	const command = async (text: string) => {
		const registered = commands.get("goal");
		if (!registered) throw new Error("Missing /goal command");
		await registered.handler(text, ctx);
	};
	const tool = async (
		name: string,
		params: Record<string, unknown> = {},
		signal?: AbortSignal,
	) => {
		const registered = tools.get(name);
		if (!registered) throw new Error(`Missing tool ${name}`);
		return (await registered.execute(
			"creation-test",
			params,
			signal,
			undefined,
			ctx as unknown as ExtensionToolContext,
		)) as unknown as ToolResult;
	};
	const status = async () => (await tool("goal_status")).details;
	const begin = async (
		text = "Fix the parser regression and keep existing tests passing",
	) => {
		await command(text);
		const id = (await status()).draft?.id;
		if (!id) throw new Error(`No draft: ${JSON.stringify(notices)}`);
		return { draftId: id, ...structuredClone(proposalValues) };
	};
	const store = new GoalStore(join(agentRoot, "goals"));
	cleanups.push(async () => {
		try {
			await emit("session_shutdown");
			for (const dialog of dialogs) dialog.answer.resolve(undefined);
			await Bun.sleep(0);
		} finally {
			if (oldRoot === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = oldRoot;
			if (oldChild === undefined) delete process.env.PI_DELEGATE_CHILD;
			else process.env.PI_DELEGATE_CHILD = oldChild;
			await rm(directory, { recursive: true, force: true });
		}
	});
	goal(pi);
	return {
		ctx,
		pi,
		tools,
		dialogs,
		messages,
		userMessages,
		notices,
		store,
		status,
		begin,
		tool,
		command,
		emit,
		setIdle: (value: boolean) => {
			idleNow = value;
		},
		idleCalls: () => idleCalls,
		aborts: () => aborts,
		executions: () => executions,
	};
}

type Harness = Awaited<ReturnType<typeof fixture>>;
type ActivationStage = "create" | "persistence";

// Hold real durable operations, never fabricate a controller state or replace the
// store. Spies are cwd-scoped and restored before the temporary root is removed.
function holdActivation(h: Harness, stage: ActivationStage) {
	const entered = deferred<void>();
	const release = deferred<void>();
	const cwd = h.ctx.cwd;
	const restorers: (() => void)[] = [];
	const hold = async () => {
		entered.resolve();
		await release.promise;
	};
	if (stage === "create") {
		const create = GoalController.prototype.create;
		const spy = spyOn(GoalController.prototype, "create").mockImplementation(
			async function (this: GoalController, input) {
				const state = await create.call(this, input);
				if (input.cwd === cwd) await hold();
				return state;
			},
		);
		restorers.push(() => spy.mockRestore());
	} else {
		const create = GoalStore.prototype.create;
		const spy = spyOn(GoalStore.prototype, "create").mockImplementation(
			async function (this: GoalStore, input) {
				const journal = await create.call(this, input);
				if (input.cwd === cwd) {
					const update = journal.update;
					const commit = spyOn(journal, "update").mockImplementation(
						async (change, reason) => {
							const state = await update.call(journal, change, reason);
							// The active checkpoint is on disk, but create has not
							// returned it to the controller/adapter yet.
							if (reason === "start") await hold();
							return state;
						},
					);
					restorers.push(() => commit.mockRestore());
				}
				return journal;
			},
		);
		restorers.push(() => spy.mockRestore());
	}
	cleanups.push(async () => {
		release.resolve();
		await h.command("pause");
		for (const restore of restorers.reverse()) restore();
	});
	return { entered: entered.promise, release: () => release.resolve() };
}

async function boundary(h: Harness) {
	return h.emit("agent_before_settle", { outcome: "completed", entries: [] });
}

async function expectPausedWithoutDispatch(h: Harness) {
	const report = await h.status();
	expect(report.runtimeActive).toBe(false);
	expect(report.draft).toBeUndefined();
	expect(report.state).toMatchObject({
		status: "paused",
		run: { allowance: 7, used: 0 },
		attempts: [],
	});
	const id = report.state?.id;
	if (!id) throw new Error("Expected preserved durable goal");
	expect(await h.store.load(id)).toEqual(report.state as GoalState);
	expect(await boundary(h)).toEqual([undefined]);
	expect(h.messages).toEqual([]);
	expect(h.executions()).toBe(0);
	expect(h.idleCalls()).toBe(0);
	// Pausing must release the real journal lease, not just hide runtimeActive.
	const reopened = await h.store.open(id);
	await reopened.close();
}

async function expectNonExecuting(h: Awaited<ReturnType<typeof fixture>>) {
	const report = await h.status();
	expect(report.runtimeActive).toBe(false);
	expect(report.state).toBeUndefined();
	expect(h.messages).toEqual([]);
	expect(h.executions()).toBe(0);
	expect(await h.store.list()).toEqual({ goals: [], errors: [] });
}

describe("R7 adapter confirmation and native boundary admission", () => {
	test("delegated child exits before touching registration or capability discovery", () => {
		const previous = process.env.PI_DELEGATE_CHILD;
		process.env.PI_DELEGATE_CHILD = "1";
		let accesses = 0;
		const childAPI = new Proxy(
			{},
			{
				get() {
					accesses++;
					throw new Error("Child must not access parent extension API");
				},
			},
		) as ExtensionAPI;
		try {
			expect(() => goal(childAPI)).not.toThrow();
			expect(accesses).toBe(0);
		} finally {
			if (previous === undefined) delete process.env.PI_DELEGATE_CHILD;
			else process.env.PI_DELEGATE_CHILD = previous;
		}
	});
	test("natural language enters ordinary chat only, with parent-only proposal registration", async () => {
		const h = await fixture();
		const params = await h.begin();
		expect(h.userMessages).toEqual([
			"Discuss this goal draft; do not execute it yet:\nFix the parser regression and keep existing tests passing",
		]);
		expect(h.dialogs).toEqual([]);
		await expectNonExecuting(h);
		const context = await h.emit("context", { messages: [] });
		expect(JSON.stringify(context)).toContain(params.draftId);
		expect(JSON.stringify(context)).toContain("ordinary chat");
		expect(
			await h.emit("agent_before_settle", {
				outcome: "completed",
				entries: [],
			}),
		).toEqual([undefined]);
		const inherited: string[] = [];
		h.pi.events.emit("@wangjq4214/pi-delegate:parent-only-tools", {
			version: 1,
			add: (names: string[]) => inherited.push(...names),
		});
		expect(inherited).toContain("goal_propose");
	});

	test("no root draft or absent/wrong draft ID can open a confirmation", async () => {
		const h = await fixture();
		expect(
			(await h.tool("goal_propose", { ...proposalValues, confirmed: true }))
				.isError,
		).toBe(true);
		await h.begin();
		for (const draftId of [undefined, "", "not-the-root-draft"]) {
			expect(
				(
					await h.tool("goal_propose", {
						...proposalValues,
						draftId,
						confirmed: true,
					})
				).isError,
			).toBe(true);
		}
		expect(h.dialogs).toHaveLength(0);
		await expectNonExecuting(h);
	});

	test.each([undefined, 0, -1, 1.5, Infinity, "7"])(
		"allowance %p fails before displaying Start",
		async (allowance) => {
			const h = await fixture();
			const params = await h.begin();
			const result = await h.tool("goal_propose", {
				...params,
				allowance,
				confirmed: true,
			});
			expect(result.isError).toBe(true);
			expect(result.details.error).toContain("explicit positive safe integer");
			expect(h.dialogs).toHaveLength(0);
			await expectNonExecuting(h);
		},
	);

	test("unavailable UI and model confirmed:true never activate", async () => {
		const h = await fixture();
		const params = await h.begin();
		h.ctx.hasUI = false;
		const result = await h.tool("goal_propose", { ...params, confirmed: true });
		expect(result.isError).toBe(true);
		expect(result.details.error).toContain("confirmation UI is unavailable");
		expect(h.dialogs).toHaveLength(0);
		await expectNonExecuting(h);
	});

	test.each(["Cancel", undefined, "confirmed", "start"])(
		"choice %p cannot grant authorization",
		async (choice) => {
			const h = await fixture();
			const params = await h.begin();
			const run = h.tool("goal_propose", { ...params, confirmed: true });
			expect(h.dialogs[0]?.options).toEqual(["Start", "Cancel"]);
			await expectNonExecuting(h);
			h.dialogs[0]?.answer.resolve(choice);
			const result = await run;
			expect(result.terminate).toBe(true);
			expect(result.details.started).toBe(false);
			expect((await h.status()).draft).toBeUndefined();
			await expectNonExecuting(h);
		},
	);

	test("Start durably activates and precharges the displayed goal before returning; native admission does not double-charge", async () => {
		const h = await fixture();
		const params = await h.begin();
		const run = h.tool("goal_propose", params);
		expect(h.dialogs[0]?.title).toContain(
			"Objective: Fix the parser regression",
		);
		expect(h.dialogs[0]?.title).toContain(
			"• Regression passes\n• Existing tests pass",
		);
		expect(h.dialogs[0]?.title).toContain("Allowance: 7 goal dispatches");
		expect(h.dialogs[0]?.title).toContain(`Working directory: ${h.ctx.cwd}`);
		await expectNonExecuting(h);
		expect(await boundary(h)).toEqual([undefined]);
		params.objective = "Unshown objective";
		params.criteria.push("Unshown condition");
		params.allowance = 99;
		// goal_propose runs inside an active parent turn, not an idle command.
		h.setIdle(false);
		h.dialogs[0]?.answer.resolve("Start");
		const started = await run;
		expect(started.isError).not.toBe(true);
		expect(started.terminate).toBe(true);
		expect(started.details.started).toBe(true);
		const report = await h.status();
		expect(started.details).toMatchObject(report);
		expect(report.runtimeActive).toBe(true);
		expect(report.draft).toBeUndefined();
		expect(report.state).toMatchObject({
			objective: proposalValues.objective,
			criteria: proposalValues.criteria,
			cwd: h.ctx.cwd,
			status: "active",
			run: { allowance: 7, used: 1 },
			attempts: [{ kind: "coordinator", status: "completed" }],
		});
		expect(report.state?.review?.approved).not.toBe(true);
		expect(h.messages).toEqual([]);
		expect(h.executions()).toBe(0);
		expect(h.idleCalls()).toBe(0);
		const id = report.state?.id;
		if (!id) throw new Error("Expected durable goal");
		expect(await h.store.load(id)).toEqual(report.state as GoalState);
		expect(
			(
				await h.tool("goal_propose", {
					...proposalValues,
					draftId: params.draftId,
				})
			).isError,
		).toBe(true);
		expect((await h.status()).state?.attempts).toHaveLength(1);

		const responses = await boundary(h);
		expect(responses).toEqual([
			{
				entries: [
					{
						type: "custom_message",
						customType: "pi-goal:continue",
						content: `Continue coordinating goal ${id} using current context.`,
						display: false,
					},
				],
				continue: true,
			},
		]);
		const coordinated = (await h.status()).state;
		expect(coordinated).toMatchObject({
			status: "active",
			run: { allowance: 7, used: 1 },
			attempts: [{ kind: "coordinator", status: "completed" }],
		});
		expect(coordinated?.attempts).toHaveLength(1);
		expect(await h.store.load(id)).toEqual(coordinated as GoalState);
		expect(h.messages).toEqual([]); // No detached sendMessage(triggerTurn).
		expect(h.executions()).toBe(0);
		expect(h.idleCalls()).toBe(0);
		await h.command("pause");
		expect(h.aborts()).toBe(1);
		expect((await h.status()).runtimeActive).toBe(false);
	});

	test.each([
		"input",
		"pause",
		"abort",
		"session_before_switch",
		"session_before_fork",
		"session_shutdown",
		"session_tree",
		"session_before_tree",
		"failed parent",
	])("late Start after %s cannot start a goal", async (invalidation) => {
		const h = await fixture();
		const params = await h.begin();
		const run = h.tool("goal_propose", params);
		if (invalidation === "pause") await h.command("pause");
		else if (invalidation === "abort")
			await h.emit("agent_settled", { aborted: true });
		else if (invalidation === "session_tree")
			await h.emit("session_tree", { oldLeafId: "a", newLeafId: "b" });
		else if (invalidation === "session_before_tree")
			await h.emit("session_before_tree", {
				preparation: { oldLeafId: "a", targetId: "b" },
			});
		else if (invalidation === "failed parent")
			await h.emit("agent_before_settle", { outcome: "error", entries: [] });
		else await h.emit(invalidation);
		expect(h.dialogs[0]?.signal?.aborted).toBe(true);
		h.dialogs[0]?.answer.resolve("Start");
		expect((await run).isError).toBe(true);
		await expectNonExecuting(h);
	});

	for (const stage of ["create", "persistence"] as const) {
		test.each([
			"input",
			"pause",
			"abort",
			"invocation abort",
			"session_shutdown",
			"session_before_switch",
			"session_before_fork",
			"session_tree",
			"session_before_tree",
			"failed parent",
		])(
			`cancellation by %s during ${stage} revokes authority before completion`,
			async (invalidation) => {
				const h = await fixture();
				const params = await h.begin();
				const held = holdActivation(h, stage);
				const cancellation = new AbortController();
				let returned = false;
				const run = h
					.tool("goal_propose", params, cancellation.signal)
					.then((result) => {
						returned = true;
						return result;
					});
				h.dialogs[0]?.answer.resolve("Start");
				await held.entered;
				expect(returned).toBe(false);
				const saved = await h.store.list();
				expect(saved.errors).toEqual([]);
				expect(saved.goals).toHaveLength(1);
				expect(saved.goals[0]).toMatchObject({
					status: "active",
					run: { allowance: 7, used: 0 },
					attempts: [],
				});
				expect((await h.status()).runtimeActive).toBe(stage === "create");
				const invalidate = () => {
					if (invalidation === "pause") return h.command("pause");
					if (invalidation === "invocation abort") {
						cancellation.abort();
						return Promise.resolve();
					}
					if (invalidation === "abort")
						return h.emit("agent_settled", { aborted: true });
					if (invalidation === "session_tree")
						return h.emit("session_tree", { oldLeafId: "a", newLeafId: "b" });
					if (invalidation === "session_before_tree")
						return h.emit("session_before_tree", {
							preparation: { oldLeafId: "a", targetId: "b" },
						});
					if (invalidation === "failed parent")
						return h.emit("agent_before_settle", {
							outcome: "error",
							entries: [],
						});
					return h.emit(invalidation);
				};
				// Do not await pause cleanup while persistence is deliberately held.
				const invalidated = invalidate();
				// session_shutdown first withdraws the delegate tool declaration;
				// let emit advance past that earlier hook, without releasing create.
				await Promise.resolve();
				expect(h.dialogs[0]?.signal?.aborted).toBe(true);
				expect((await h.status()).runtimeActive).toBe(false);
				expect(await boundary(h)).toEqual([undefined]);
				expect(returned).toBe(false);
				expect(h.messages).toEqual([]);
				expect(h.executions()).toBe(0);
				held.release();
				const [result] = await Promise.all([run, invalidated]);
				expect(result.isError).toBe(true);
				expect(result.terminate).toBe(true);
				expect(result.details.started).not.toBe(true);
				await expectPausedWithoutDispatch(h);
			},
		);

		test(`cwd change during ${stage} fails post-create validity without dispatch`, async () => {
			const h = await fixture();
			const params = await h.begin();
			const held = holdActivation(h, stage);
			const run = h.tool("goal_propose", params);
			h.dialogs[0]?.answer.resolve("Start");
			await held.entered;
			const originalCwd = h.ctx.cwd;
			h.ctx.cwd = join(originalCwd, "elsewhere");
			held.release();
			const result = await run;
			expect(result.isError).toBe(true);
			expect(result.details.started).not.toBe(true);
			expect((await h.status()).state?.cwd).toBe(originalCwd);
			await expectPausedWithoutDispatch(h);
		});
	}

	test("replacement dialog invalidates old callback; new displayed draft requires its own Start", async () => {
		const h = await fixture();
		const params = await h.begin();
		const old = h.tool("goal_propose", params);
		const replacement = h.tool("goal_propose", {
			...params,
			objective: "Revised objective",
			criteria: ["New criterion"],
			allowance: 4,
		});
		expect(h.dialogs[0]?.signal?.aborted).toBe(true);
		h.dialogs[0]?.answer.resolve("Start");
		expect((await old).isError).toBe(true);
		await expectNonExecuting(h);
		expect(h.dialogs[1]?.title).toContain("Objective: Revised objective");
		expect(h.dialogs[1]?.title).toContain("• New criterion");
		expect(h.dialogs[1]?.title).toContain("Allowance: 4 goal dispatches");
		h.dialogs[1]?.answer.resolve("Start");
		const result = await replacement;
		expect(result.details.started).toBe(true);
		expect(result.terminate).toBe(true);
		expect(h.messages).toEqual([]);
		expect(h.executions()).toBe(0);
		expect(h.idleCalls()).toBe(0);
		expect((await h.status()).state).toMatchObject({
			objective: "Revised objective",
			criteria: ["New criterion"],
			run: { allowance: 4, used: 1 },
		});
	});

	test("tool invocation abort invalidates confirmation even when the UI returns late", async () => {
		const h = await fixture();
		const params = await h.begin();
		const cancellation = new AbortController();
		const run = h.tool("goal_propose", params, cancellation.signal);
		cancellation.abort();
		expect(h.dialogs[0]?.signal?.aborted).toBe(true);
		h.dialogs[0]?.answer.resolve("Start");
		expect((await run).isError).toBe(true);
		await expectNonExecuting(h);
	});

	test("durable creation failure is returned by the live tool, not a detached notification", async () => {
		const h = await fixture();
		const params = await h.begin();
		const create = GoalStore.prototype.create;
		const cwd = h.ctx.cwd;
		const spy = spyOn(GoalStore.prototype, "create").mockImplementation(
			function (this: GoalStore, input) {
				if (input.cwd === cwd)
					return Promise.reject(new Error("Global goal store unavailable"));
				return create.call(this, input);
			},
		);
		cleanups.push(async () => {
			spy.mockRestore();
		});
		const run = h.tool("goal_propose", params);
		h.dialogs[0]?.answer.resolve("Start");
		const result = await run;
		expect(result.isError).toBe(true);
		expect(result.details.error).toBe("Global goal store unavailable");
		expect(result.details.started).not.toBe(true);
		expect((await h.status()).draft).toBeUndefined();
		expect(h.notices).toEqual([]);
		expect(await boundary(h)).toEqual([undefined]);
		expect(h.idleCalls()).toBe(0);
		await expectNonExecuting(h);
	});

	test("natural-language initial admission still requires an idle parent", async () => {
		const h = await fixture();
		h.setIdle(false);
		await h.command("Fix the parser regression");
		expect(h.notices).toEqual([
			{
				message: "Start or resume a goal only when the parent is idle",
				level: "error",
			},
		]);
		expect((await h.status()).draft).toBeUndefined();
		expect(h.userMessages).toEqual([]);
		expect(h.dialogs).toEqual([]);
		expect(h.idleCalls()).toBe(0);
		await expectNonExecuting(h);
	});

	test("malformed replacement revokes the old dialog instead of retaining its approval", async () => {
		const h = await fixture();
		const params = await h.begin();
		const old = h.tool("goal_propose", params);
		expect(
			(await h.tool("goal_propose", { ...params, allowance: 0 })).isError,
		).toBe(true);
		expect(h.dialogs).toHaveLength(1);
		expect(h.dialogs[0]?.signal?.aborted).toBe(true);
		h.dialogs[0]?.answer.resolve("Start");
		expect((await old).isError).toBe(true);
		await expectNonExecuting(h);
	});

	test("cwd changed while the dialog is open rejects a late Start", async () => {
		const h = await fixture();
		const params = await h.begin();
		const run = h.tool("goal_propose", params);
		h.ctx.cwd = join(h.ctx.cwd, "elsewhere");
		h.dialogs[0]?.answer.resolve("Start");
		expect((await run).isError).toBe(true);
		await expectNonExecuting(h);
	});

	test("already aborted invocation never opens the dialog", async () => {
		const h = await fixture();
		const params = await h.begin();
		const cancellation = new AbortController();
		cancellation.abort();
		expect(
			(await h.tool("goal_propose", params, cancellation.signal)).isError,
		).toBe(true);
		expect(h.dialogs).toHaveLength(0);
		await expectNonExecuting(h);
	});

	test("pending durable activation cannot be replaced and the tool stays live until create returns", async () => {
		const h = await fixture();
		const params = await h.begin();
		const held = holdActivation(h, "create");
		let returned = false;
		const run = h.tool("goal_propose", params).then((result) => {
			returned = true;
			return result;
		});
		h.dialogs[0]?.answer.resolve("Start");
		await held.entered;
		expect(returned).toBe(false);
		expect((await h.status()).runtimeActive).toBe(true);
		expect((await h.status()).state?.run?.used).toBe(0);
		await h.command("A different goal");
		expect(h.notices).toEqual([
			{
				message: "Pause the current goal before starting another",
				level: "error",
			},
		]);
		const replacement = await h.tool("goal_propose", {
			...params,
			objective: "Unapproved replacement",
		});
		expect(replacement.isError).toBe(true);
		expect(replacement.details.error).toBe(
			"Pause the current goal before proposing another",
		);
		expect(h.dialogs).toHaveLength(1);
		expect(h.dialogs[0]?.signal?.aborted).toBe(false);
		expect(h.messages).toEqual([]);
		expect(h.executions()).toBe(0);
		held.release();
		const result = await run;
		expect(result.isError).not.toBe(true);
		expect(result.terminate).toBe(true);
		expect(result.details.started).toBe(true);
		expect(result.details.state?.objective).toBe(proposalValues.objective);
		expect(result.details.state?.run?.used).toBe(1);
		expect(
			result.details.state?.attempts?.map((attempt) => attempt.kind),
		).toEqual(["coordinator"]);
		expect((await h.store.list()).goals).toHaveLength(1);
		expect(h.idleCalls()).toBe(0);
	});

	test("UI failure is an error, not implicit assent", async () => {
		const h = await fixture();
		const params = await h.begin();
		const run = h.tool("goal_propose", { ...params, confirmed: true });
		h.dialogs[0]?.answer.reject(new Error("UI transport unavailable"));
		const result = await run;
		expect(result.isError).toBe(true);
		expect(result.details.error).toContain("UI transport unavailable");
		await expectNonExecuting(h);
	});

	test("concurrent execution cannot use authority while confirmed creation is still settling", async () => {
		const h = await fixture();
		const params = await h.begin();
		const held = holdActivation(h, "create");
		const run = h.tool("goal_propose", params);
		h.dialogs[0]?.answer.resolve("Start");
		await held.entered;
		await h.tool("goal_plan", {
			items: [{ id: "early", title: "Early work", acceptance: "Evidence" }],
			checkpoint: "test early attempt",
		});
		const work = await h.tool("goal_work", {
			itemId: "early",
			task: "Must not dispatch during activation",
		});
		const review = await h.tool("goal_review");
		expect(work.isError).toBe(true);
		expect(work.details.error).toContain("still settling");
		expect(review.isError).toBe(true);
		expect(review.details.error).toContain("still settling");
		expect(h.executions()).toBe(0);
		expect((await h.status()).state?.run?.used).toBe(0);
		held.release();
		expect((await run).details.started).toBe(true);
		expect((await h.status()).state?.run?.used).toBe(1);
	});

	test("a direct native model turn consumes the precharged handoff before any later continuation charge", async () => {
		const h = await fixture();
		const params = await h.begin();
		const run = h.tool("goal_propose", params);
		h.dialogs[0]?.answer.resolve("Start");
		await run;
		expect((await h.status()).state?.run?.used).toBe(1);
		await h.emit("turn_start", { turnIndex: 1, timestamp: Date.now() });
		await boundary(h);
		expect((await h.status()).state?.run?.used).toBe(2);
		expect((await h.status()).state?.attempts.map((a) => a.kind)).toEqual([
			"coordinator",
			"coordinator",
		]);
	});
});
