import { expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BackgroundTasks } from "../src/background.ts";
import {
	type DelegationOptions,
	type DelegationResult,
	type DelegationStatus,
	runDelegation,
} from "../src/delegate.ts";
import { RpcProcess, RpcTimeoutError } from "../src/rpc.ts";
import { TaskSteering } from "../src/steering.ts";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
async function flush() {
	for (let i = 0; i < 20; i++) await Promise.resolve();
}
function ready(send: (message: string) => Promise<unknown>) {
	const steering = new TaskSteering(send);
	steering.observe({ type: "agent_start" });
	steering.confirmStart();
	return steering;
}

test("manual readiness requires original start observation and prompt confirmation, with no rejected-text buffering", async () => {
	const sent: string[] = [];
	const steering = new TaskSteering(async (text) => {
		sent.push(text);
		return { disposition: "queued" };
	});
	expect((await steering.control.steer("early")).status).toBe("not_ready");
	steering.confirmStart();
	expect((await steering.control.steer("pre-event")).status).toBe("not_ready");
	steering.observe({ type: "agent_start" });
	expect(await steering.control.steer("/command")).toEqual({
		status: "accepted",
		disposition: "queued",
	});
	expect(sent).toEqual(["[pi-delegate instruction]\n/command"]);
	const other = new TaskSteering(async () => ({ disposition: "queued" }));
	other.observe({ type: "agent_start" });
	expect((await other.control.steer("unconfirmed")).status).toBe("not_ready");
});

for (const first of ["manual", "pressure"] as const) {
	test(`shared RPC-outcome boundary: ${first} first, independent task does not wait`, async () => {
		const held = deferred<unknown>();
		const sent: string[] = [];
		const steering = ready(async (text) => {
			sent.push(text);
			return sent.length === 1 ? held.promise : { disposition: "handled" };
		});
		const firstCall =
			first === "manual"
				? steering.control.steer("first")
				: steering.submit("[pi-delegate pressure: warning] first");
		await flush();
		const second =
			first === "manual"
				? steering.submit("[pi-delegate pressure: urgent] second")
				: steering.control.steer("second");
		const third = steering.control.steer("third");
		await flush();
		expect(sent).toHaveLength(1);
		expect(
			(
				await ready(async () => ({ disposition: "queued" })).control.steer(
					"other",
				)
			).status,
		).toBe("accepted");
		held.resolve({ disposition: "queued" });
		await Promise.all([firstCall, second, third]);
		expect(sent).toHaveLength(3);
		expect(await third).toEqual({ status: "accepted", disposition: "handled" });
	});
}

for (const event of ["agent_settled", "rpc_failure", "close"]) {
	test(`${event} drops unsent instructions; late receipt cannot reopen control`, async () => {
		const held = deferred<unknown>();
		const sent: string[] = [];
		const steering = ready(async (text) => {
			sent.push(text);
			return held.promise;
		});
		steering.observe({ type: "agent_end" });
		const first = steering.control.steer("in-flight");
		await flush();
		const unsent = steering.control.steer("unsent");
		if (event === "close") steering.close();
		else steering.observe({ type: event });
		steering.confirmStart();
		steering.observe({ type: "agent_start" });
		expect((await steering.control.steer("after-close")).status).toBe("closed");
		held.resolve({ disposition: "queued" });
		expect((await first).status).toBe("accepted"); // Acceptance is not consumption.
		expect((await unsent).status).toBe("closed");
		expect(sent).toEqual(["[pi-delegate instruction]\nin-flight"]);
	});
}

for (const error of [
	new Error("host rejected"),
	new RpcTimeoutError("steer"),
]) {
	test(`manual ${error.name} is isolated, releases local tail and never retries`, async () => {
		let attempts = 0;
		const steering = ready(async () => {
			if (++attempts === 1) throw error;
			return { disposition: "queued" };
		});
		expect((await steering.control.steer("first")).status).toBe(
			error instanceof RpcTimeoutError ? "uncertain" : "failed",
		);
		expect(attempts).toBe(1);
		expect((await steering.control.steer("explicit later call")).status).toBe(
			"accepted",
		);
		expect(attempts).toBe(2);
	});
}

function result(status: DelegationStatus): DelegationResult {
	return {
		content: [{ type: "text", text: "ordinary result" }],
		details: { status },
		isError: status === "failed" || status === "cancelled",
		usage: {
			input: 1,
			output: 2,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 3,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}
const context = { isIdle: () => false, hasPendingMessages: () => false };
const options: DelegationOptions = {
	cwd: process.cwd(),
	args: [],
	snapshot: { version: 1, tools: [], active: [] },
	task: "task",
};

for (const terminal of [
	"completed",
	"incomplete",
	"failed",
	"cancelled",
] as const) {
	test(`task owner rejects unknown, foreign and ${terminal} IDs without replacing ordinary result`, async () => {
		const finished = deferred<DelegationResult>();
		let sends = 0;
		const steering = ready(async () => {
			sends++;
			return { disposition: "queued" };
		});
		const owner = new BackgroundTasks(
			async (input) => {
				input.onSteeringControl?.(steering.control);
				return finished.promise;
			},
			() => result("failed"),
			() => {},
		);
		const foreign = new BackgroundTasks(
			async () => result("completed"),
			() => result("failed"),
			() => {},
		);
		const id = owner.start(options, context).details.taskId;
		expect((await owner.steer(id, "early")).details.status).toBe("not_ready");
		expect((await foreign.steer(id, "wrong scope")).details.status).toBe(
			"unknown_task",
		);
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect((await owner.steer(id, "ready")).details).toMatchObject({
			status: "accepted",
			disposition: "queued",
		});
		finished.resolve(result(terminal));
		await flush();
		expect((await owner.steer(id, "late")).details.status).toBe("terminal");
		expect(owner.query(id).details).toMatchObject({
			status: terminal,
			usage: { totalTokens: 3 },
		});
		expect(sends).toBe(1);
		await owner.invalidate(true);
		await foreign.invalidate(true);
	});
}

test("task cancellation rejects immediately before cleanup; invalidation forgets IDs synchronously", async () => {
	const finished = deferred<DelegationResult>();
	const owner = new BackgroundTasks(
		async () => finished.promise,
		() => result("cancelled"),
		() => {},
	);
	const id = owner.start(options, context).details.taskId;
	await new Promise<void>((resolve) => setImmediate(resolve));
	const cancel = owner.cancel(id);
	expect((await owner.steer(id, "cancel window")).details.status).toBe(
		"cancelling",
	);
	const invalidation = owner.invalidate();
	expect((await owner.steer(id, "invalidated")).details.status).toBe(
		"unknown_task",
	);
	finished.resolve(result("cancelled"));
	await Promise.all([cancel, invalidation]);
	await owner.invalidate(true);
	expect((await owner.steer(id, "shutdown")).details.status).toBe("closing");
});

test.serial(
	"actual runner closes control on settlement while background view still awaits result collection",
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "steering-collection-"));
		const held = deferred<void>();
		const collecting = deferred<void>();
		const request = RpcProcess.prototype.request;
		let entries = 0;
		const spy = spyOn(RpcProcess.prototype, "request").mockImplementation(
			async function <T>(
				this: RpcProcess,
				type: string,
				fields?: Record<string, unknown>,
			): Promise<T> {
				if (type === "get_entries" && ++entries === 2) {
					collecting.resolve();
					await held.promise;
				}
				return request.call(this, type, fields) as Promise<T>;
			},
		);
		const owner = new BackgroundTasks(
			runDelegation,
			() => result("failed"),
			() => {},
		);
		try {
			const id = owner.start(
				{
					...options,
					cliPath: resolve("tests/fixtures/pressure-rpc.mjs"),
					env: {
						PRESSURE_FIXTURE_SCENARIO: "settled-before-steer",
						PRESSURE_FIXTURE_LOG: join(directory, "commands.jsonl"),
					},
				},
				context,
			).details.taskId;
			await collecting.promise;
			expect(owner.query(id).details.status).toBe("running");
			expect(
				(await owner.steer(id, "cannot steer collection")).details.status,
			).toBe("closed");
			held.resolve();
			await owner.invalidate(true);
			expect(
				readFileSync(join(directory, "commands.jsonl"), "utf8"),
			).not.toContain('"type":"steer"');
		} finally {
			held.resolve();
			await owner.invalidate(true);
			spy.mockRestore();
			await rm(directory, { recursive: true, force: true });
		}
	},
);
