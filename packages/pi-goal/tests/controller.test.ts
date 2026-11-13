import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	allowanceValue,
	GoalController,
	type GoalExecutor,
} from "../src/controller.ts";
import { GoalJournal, GoalStore } from "../src/store.ts";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const completed = (text = "Implemented and tested") => ({
	content: [{ type: "text", text }],
	details: { status: "completed" as const, taskId: "transient-task" },
	usage: { input: 3, output: 4 },
});
const item = {
	id: "one",
	title: "One bounded change",
	acceptance: "Artifact matches criteria",
};
const work = { itemId: "one", task: "Implement the bounded change" };
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
async function fixture(
	execute: GoalExecutor = async () => completed(),
	allowance = 10,
) {
	const directory = await mkdtemp(join(tmpdir(), "pi-goal-controller-"));
	cleanups.push(() => rm(directory, { recursive: true, force: true }));
	const cwd = join(directory, "project");
	await mkdir(cwd);
	const store = new GoalStore(join(directory, "agent", "goals"));
	const controller = new GoalController(store, execute);
	cleanups.push(() => controller.pause("test cleanup"));
	await controller.create({
		cwd,
		objective: "Deliver verified change",
		criteria: ["Artifact matches criteria"],
		allowance,
	});
	await controller.plan([item], "Bounded plan");
	const state = controller.status();
	if (!state) throw new Error("Fixture failed to create a goal");
	return { directory, cwd, store, controller, id: state.id };
}

describe("bounded goal controller", () => {
	test("explicit allowance rejects zero, infinity, fractions and numeric strings", () => {
		for (const value of [
			undefined,
			0,
			-1,
			Infinity,
			NaN,
			1.1,
			"3",
			Number.MAX_SAFE_INTEGER + 1,
		])
			expect(() => allowanceValue(value)).toThrow();
		expect(allowanceValue(3)).toBe(3);
	});

	test("worker success is not acceptance; independent fresh review completes current evidence", async () => {
		const calls: string[] = [];
		const { controller, store, id, cwd } = await fixture(async (input) => {
			calls.push(input.task);
			return completed(
				input.title === "Independent goal review"
					? "Inspected the artifact and criteria; all met.\n<approved/>"
					: "Artifact generated",
			);
		});
		await writeFile(join(cwd, "artifact.txt"), "verified");
		await controller.coordination();
		await controller.work(work);
		expect(controller.status()?.items[0].status).toBe("pending");
		expect(controller.status()?.status).toBe("active");
		await controller.accept(
			"one",
			["Read artifact and ran acceptance test"],
			["artifact.txt"],
		);
		await controller.review();
		expect(calls).toHaveLength(2);
		expect(calls[1]).toContain("Independently assess");
		expect(controller.active).toBe(false);
		expect(controller.status()?.status).toBe("complete");
		expect(controller.status()?.run?.used).toBe(3);
		const persisted = await store.load(id);
		expect(persisted.review?.approved).toBe(true);
		expect(persisted.attempts.map((attempt) => attempt.kind)).toEqual([
			"coordinator",
			"worker",
			"reviewer",
		]);
		expect(persisted.attempts[1].summary).toBe("Artifact generated");
		expect(persisted.attempts[1].usage).toEqual({ input: 3, output: 4 });
	});

	test("one final worker slot cannot grant review or reset allowance after reload", async () => {
		let calls = 0;
		const { controller, store, id } = await fixture(async () => {
			calls++;
			return completed();
		}, 2);
		await controller.coordination();
		await controller.work(work);
		expect(calls).toBe(1);
		expect(controller.status()?.status).toBe("paused");
		expect(controller.status()?.stopReason).toContain("allowance exhausted");
		expect(await controller.coordination()).toBeUndefined();
		expect((await store.load(id)).run?.used).toBe(2);
		await expect(controller.review()).rejects.toThrow("paused");
		expect(calls).toBe(1);
	});

	test("rejected, malformed, failed and partial reviews never complete", async () => {
		for (const mode of [
			"rejected",
			"marker-only",
			"failed",
			"partial",
		] as const) {
			const { controller } = await fixture(async () =>
				mode === "rejected"
					? completed("Missing required behavior\n<disapproved/>")
					: {
							...completed(
								mode === "marker-only"
									? "<approved/>"
									: "Looks complete\n<approved/>",
							),
							details: {
								status: mode === "failed" ? "failed" : "completed",
								partialOutput: mode === "partial",
							},
						},
			);
			await controller.accept("one", ["Parent evidence"], []);
			await controller.review();
			expect(controller.status()?.status).toBe("active");
			expect(controller.status()?.review?.approved).toBe(false);
			await controller.pause();
		}
	});

	test("pause keeps lease through child cleanup and rejects a late affirmative review", async () => {
		const started = deferred<AbortSignal>();
		const finish = deferred<Awaited<ReturnType<GoalExecutor>>>();
		const { controller, store, id } = await fixture(async (_input, signal) => {
			started.resolve(signal);
			return finish.promise;
		});
		await controller.accept("one", ["Parent checked evidence"], []);
		const reviewing = controller.review();
		const signal = await started.promise;
		const paused = controller.pause("User paused review");
		expect(signal.aborted).toBe(true);
		expect(controller.active).toBe(false);
		await expect(store.open(id)).rejects.toThrow();
		finish.resolve(completed("All conditions met\n<approved/>"));
		await Promise.all([reviewing, paused]);
		expect(controller.status()?.status).toBe("paused");
		expect((await store.load(id)).status).toBe("paused");
		const journal = await store.open(id);
		await journal.close();
	});

	test("changing a registered artifact during review invalidates approval", async () => {
		const started = deferred<void>();
		const finish = deferred<Awaited<ReturnType<GoalExecutor>>>();
		const { controller, cwd } = await fixture(async () => {
			started.resolve();
			return finish.promise;
		});
		await writeFile(join(cwd, "artifact.txt"), "before");
		await controller.accept("one", ["Inspected artifact"], ["artifact.txt"]);
		const reviewing = controller.review();
		await started.promise;
		await writeFile(join(cwd, "artifact.txt"), "changed while reviewed");
		finish.resolve(completed("All conditions met\n<approved/>"));
		await reviewing;
		expect(controller.status()?.review?.approved).toBe(false);
		expect(controller.status()?.review?.summary).toContain("invalidated");
		expect(controller.status()?.status).not.toBe("complete");
	});

	test("loading dispatches nothing; resume requires cwd validation and explicit effect reinspection", async () => {
		let calls = 0;
		const { controller, store, id, cwd } = await fixture(async () => {
			calls++;
			return completed();
		});
		await controller.work(work);
		await controller.pause();
		const restored = new GoalController(store, async () => {
			calls++;
			return completed();
		});
		cleanups.push(() => restored.pause());
		expect((await store.load(id)).attempts).toHaveLength(1);
		expect(calls).toBe(1);
		await restored.resume(id, 5, cwd);
		expect(restored.needsReinspection).toBe(true);
		await restored.coordination();
		expect(restored.prompt()).toContain('recoveryRequired":true');
		await restored.reinspect(
			[
				"Read current files and confirmed previous effects; next work is distinct",
			],
			[],
		);
		await restored.work({
			...work,
			task: "Only implement remaining verified gap",
		});
		expect(calls).toBe(2);
		expect(
			restored
				.status()
				?.attempts.filter((attempt) => attempt.kind === "worker"),
		).toHaveLength(2);
	});

	test("wrong cwd and unavailable artifacts block resume without new execution", async () => {
		const { controller, store, id, directory } = await fixture();
		await controller.pause();
		const another = new GoalController(store, async () => {
			throw new Error("must not dispatch");
		});
		cleanups.push(() => another.pause());
		await expect(another.resume(id, 5, directory)).rejects.toThrow(
			"saved working directory",
		);
		expect((await store.load(id)).status).toBe("paused");
	});

	test("resume refuses fresh dispatch until reinspection; attempt failure preserves honest state", async () => {
		const { controller, store, id, cwd } = await fixture();
		await controller.pause();
		const another = new GoalController(store, async () => {
			throw new Error("transport lost");
		});
		cleanups.push(() => another.pause());
		await another.resume(id, 6, cwd);
		await expect(another.work(work)).rejects.toThrow("goal_reinspect");
		await another.resume(id, 6, cwd);
		await another.reinspect(
			["Verified existing effects before continuing"],
			[],
		);
		await expect(another.work(work)).rejects.toThrow("transport lost");
		const saved = await store.load(id);
		expect(saved.status).toBe("paused");
		expect(saved.attempts.at(-1)?.status).toBe("interrupted");
		expect(saved.attempts.at(-1)?.summary).toContain("transport lost");
	});

	test("concurrent work is not duplicated and abort affects only goal-owned execution", async () => {
		const started = deferred<AbortSignal>();
		const finish = deferred<Awaited<ReturnType<GoalExecutor>>>();
		let count = 0;
		const { controller } = await fixture(async (_input, signal) => {
			count++;
			started.resolve(signal);
			return finish.promise;
		});
		const running = controller.work(work);
		await started.promise;
		await expect(controller.work(work)).rejects.toThrow("still settling");
		const pause = controller.pause();
		finish.resolve({
			...completed("partial retained"),
			details: { status: "cancelled", taskId: "own-task" },
		});
		await Promise.all([running, pause]);
		expect(count).toBe(1);
		expect(controller.status()?.attempts.at(-1)?.summary).toBe(
			"partial retained",
		);
		expect(controller.status()?.attempts.at(-1)?.status).toBe("cancelled");
	});

	test("global journal stores evidence independently from temporary full output paths", async () => {
		const { controller, store, id, cwd } = await fixture();
		await controller.work(work);
		await controller.pause();
		expect((await store.load(id)).attempts[0].summary).toBe(
			"Implemented and tested",
		);
		await expect(
			readFile(join(cwd, ".pi", "goals", `${id}.jsonl`)),
		).rejects.toThrow();
	});

	test("pause after persisted charge but before dispatch prevents execution", async () => {
		let calls = 0;
		const { controller, store, id } = await fixture(async () => {
			calls++;
			return completed();
		});
		const charged = deferred<void>();
		const resumeCommit = deferred<void>();
		const update = GoalJournal.prototype.update;
		const spy = spyOn(GoalJournal.prototype, "update").mockImplementation(
			async function (this: GoalJournal, change, reason) {
				const state = await update.call(this, change, reason);
				if (reason === "dispatch-worker") {
					charged.resolve();
					await resumeCommit.promise;
				}
				return state;
			},
		);
		try {
			const executing = controller.work(work);
			const observed = executing.catch((error: unknown) => error);
			await charged.promise;
			const paused = controller.pause("Pause before dispatch");
			resumeCommit.resolve();
			expect(await observed).toBeInstanceOf(Error);
			await paused;
			expect(calls).toBe(0);
			expect((await store.load(id)).status).toBe("paused");
			expect((await store.load(id)).run?.used).toBe(1);
		} finally {
			resumeCommit.resolve();
			spy.mockRestore();
		}
	});

	test("a fresh global goal directory lists no records without creating project metadata", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-goal-empty-"));
		cleanups.push(() => rm(directory, { recursive: true, force: true }));
		expect(
			await new GoalStore(join(directory, "missing-global-goals")).list(),
		).toEqual({ goals: [], errors: [] });
	});

	test("pause during completion persistence acknowledgement remains durably unfinished", async () => {
		const { controller, store, id } = await fixture(async () =>
			completed("Verified all acceptance conditions\n<approved/>"),
		);
		await controller.accept("one", ["Inspected current evidence"], []);
		const committed = deferred<void>();
		const acknowledge = deferred<void>();
		const update = GoalJournal.prototype.update;
		const spy = spyOn(GoalJournal.prototype, "update").mockImplementation(
			async function (this: GoalJournal, change, reason) {
				const state = await update.call(this, change, reason);
				if (reason === "reviewer-result") {
					committed.resolve();
					await acknowledge.promise;
				}
				return state;
			},
		);
		try {
			const reviewing = controller.review();
			await committed.promise;
			const paused = controller.pause(
				"Pause while approval commit is settling",
			);
			acknowledge.resolve();
			await Promise.all([reviewing, paused]);
			expect(controller.status()?.status).toBe("paused");
			expect((await store.load(id)).status).toBe("paused");
			expect((await store.load(id)).review?.approved).toBe(false);
		} finally {
			acknowledge.resolve();
			spy.mockRestore();
		}
	});

	test("directory artifacts cannot hide changed nested evidence behind directory timestamps", async () => {
		let calls = 0;
		const { controller, cwd } = await fixture(async () => {
			calls++;
			return completed("Approved\n<approved/>");
		});
		await mkdir(join(cwd, "evidence"));
		await writeFile(join(cwd, "evidence", "nested.txt"), "nested evidence");
		await expect(
			controller.accept("one", ["Directory evidence"], ["evidence"]),
		).rejects.toThrow("regular file");
		expect(calls).toBe(0);
		expect(controller.status()?.status).not.toBe("complete");
	});
});
