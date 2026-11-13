import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import {
	appendFile,
	type FileHandle,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import type { GoalState } from "../src/model.js";
import {
	type GoalJournal,
	GoalRecoveryError,
	GoalStore,
} from "../src/store.js";

const roots: string[] = [];
const journals: GoalJournal[] = [];
afterEach(async () => {
	await Promise.all(
		journals.splice(0).map((journal) => journal.close().catch(() => undefined)),
	);
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "pi-goal-store-"));
	roots.push(root);
	const directory = join(root, "agent", "goals");
	const cwd = join(root, "project");
	await mkdir(cwd);
	const store = new GoalStore(directory);
	const input = {
		cwd,
		objective: "Ship a bounded change",
		criteria: ["Tests pass", "Review current evidence"],
	};
	const create = async () => {
		const journal = await store.create(input);
		journals.push(journal);
		return journal;
	};
	return { root, directory, cwd, store, input, create };
}

async function recovery(promise: Promise<unknown>): Promise<GoalRecoveryError> {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(GoalRecoveryError);
		return error as GoalRecoveryError;
	}
	throw new Error("Expected recovery error");
}

function progress(draft: GoalState) {
	draft.status = "active";
	draft.workRevision++;
	draft.items.push({
		id: "item-1",
		title: "Implementation",
		acceptance: "Focused tests",
		status: "accepted",
		evidence: ["3 passing tests"],
		artifacts: ["no-longer-present.txt"],
	});
	draft.attempts.push({
		id: "worker-1",
		kind: "worker",
		itemId: "item-1",
		taskId: "ephemeral-task",
		status: "incomplete",
		summary: "Useful partial result",
		usage: { totalTokens: 12 },
		partialOutput: true,
	});
	draft.run = { id: "run-1", allowance: 3, used: 1 };
	draft.checkpoint = "Implementation inspected";
}

describe("global goal journal", () => {
	test("roundtrips typed, identified, timestamped checkpoints without redirecting cwd or verifying missing artifacts", async () => {
		const f = await fixture();
		const journal = await f.create();
		const initial = journal.read();
		expect(initial).toEqual({
			id: initial.id,
			...f.input,
			status: "paused",
			revision: 0,
			workRevision: 0,
			items: [],
			attempts: [],
			checkpoint: "",
		});
		await journal.update(progress, "worker outcome");
		const expected = await journal.update((draft) => {
			draft.status = "paused";
			draft.stopReason = "Reinspect before resuming";
			draft.attempts.push({
				id: "review-1",
				kind: "reviewer",
				status: "failed",
				summary: "Missing evidence",
			});
			draft.review = {
				attemptId: "review-1",
				workRevision: 1,
				approved: false,
				summary: "Not yet accepted",
			};
		}, "pause");
		await journal.close();
		expect(await f.store.load(initial.id)).toEqual(expected);
		const reopened = await new GoalStore(f.directory).open(initial.id);
		journals.push(reopened);
		expect(reopened.read()).toEqual(expected);
		expect(await f.store.list()).toEqual({ goals: [expected], errors: [] });
		expect(await readdir(f.cwd)).toEqual([]);
		expect(await readdir(f.directory)).toEqual([
			`${initial.id}.jsonl`,
			`${initial.id}.jsonl.lock`,
		]);
		const records = (
			await readFile(join(f.directory, `${initial.id}.jsonl`), "utf8")
		)
			.trimEnd()
			.split("\n")
			.map((row) => JSON.parse(row));
		expect(records[0]).toMatchObject({
			type: "goal",
			version: 1,
			id: initial.id,
			cwd: f.cwd,
		});
		expect(records).toHaveLength(4);
		for (let index = 0; index < records.length; index++) {
			expect(new Date(records[index].timestamp).toISOString()).toBe(
				records[index].timestamp,
			);
			if (index === 0) continue;
			expect(records[index]).toMatchObject({
				type: "checkpoint",
				goalId: initial.id,
				cwd: f.cwd,
				parentId: index === 1 ? null : records[index - 1].id,
			});
		}
		expect(new Set(records.slice(1).map((entry) => entry.id)).size).toBe(3);
	});

	test("create holds an exclusive lease; load is read-only and explicit recovery cannot steal a live owner", async () => {
		const f = await fixture();
		const journal = await f.create();
		const id = journal.read().id;
		expect((await recovery(f.store.open(id))).lastValid).toEqual(
			journal.read(),
		);
		await recovery(
			new GoalStore(f.directory).open(id, { recoverDeadOwner: true }),
		);
		expect(await f.store.load(id)).toEqual(journal.read());
		await journal.update((draft) => {
			draft.checkpoint = "still owned";
		}, "owner remains");
		await journal.close();
		const opened = await f.store.open(id);
		journals.push(opened);
		expect(opened.read().checkpoint).toBe("still owned");
	});

	test.skipIf(process.platform === "win32")(
		"new directories and journal/lease files are private even with a permissive umask",
		async () => {
			const f = await fixture();
			const mask = process.umask(0);
			try {
				const journal = await f.create();
				const path = join(f.directory, `${journal.read().id}.jsonl`);
				expect((await stat(f.directory)).mode & 0o777).toBe(0o700);
				expect((await stat(path)).mode & 0o777).toBe(0o600);
				expect((await stat(`${path}.lock`)).mode & 0o777).toBe(0o600);
			} finally {
				process.umask(mask);
			}
		},
	);

	test("serialized updates read the latest state, detach drafts/results/reads, and close drains the queue", async () => {
		const f = await fixture();
		const journal = await f.create();
		const id = journal.read().id;
		let retained: GoalState | undefined;
		const updates = Array.from({ length: 20 }, (_, index) =>
			journal.update((draft) => {
				draft.checkpoint += `${index},`;
				retained = draft;
			}, `update ${index}`),
		);
		const closed = journal.close();
		expect(journal.close()).toBe(closed);
		await expect(journal.update(() => {}, "too late")).rejects.toThrow(
			"closing/closed",
		);
		const results = await Promise.all(updates);
		await closed;
		expect(results.map((state) => state.revision)).toEqual(
			Array.from({ length: 20 }, (_, index) => index + 1),
		);
		const expected = journal.read();
		expect(expected.checkpoint).toBe(
			Array.from({ length: 20 }, (_, index) => `${index},`).join(""),
		);
		if (!retained) throw new Error("Missing draft");
		retained.checkpoint = "retained draft mutation";
		results[19].criteria.push("result mutation");
		const read = journal.read();
		read.criteria.push("read mutation");
		const loaded = await f.store.load(id);
		loaded.criteria.push("loaded mutation");
		expect(journal.read()).toEqual(expected);
		expect(await f.store.load(id)).toEqual(expected);
		const next = await f.store.open(id);
		journals.push(next);
		await journal.close(); // must not remove the next owner's lease
		await recovery(f.store.open(id));
	});

	test("actual process exit leaves persisted uncertain work, requiring explicit dead-local-owner recovery", async () => {
		const f = await fixture();
		const source = new URL("../src/store.ts", import.meta.url).href;
		const script = `import {GoalStore} from ${JSON.stringify(source)};
const journal = await new GoalStore(${JSON.stringify(f.directory)}).create(${JSON.stringify(f.input)});
await journal.update(d => { d.status='active'; d.run={id:'crashed-run',allowance:2,used:1}; d.attempts.push({id:'uncertain',kind:'worker',status:'running',summary:'Dispatch persisted before crash'}); }, 'dispatch intent');
console.log(journal.read().id); process.exit(0);`;
		const child = spawnSync(process.execPath, ["--eval", script], {
			encoding: "utf8",
		});
		expect(child.status).toBe(0);
		const id = child.stdout.trim();
		const path = join(f.directory, `${id}.jsonl`);
		const before = await readFile(path);
		const saved = await f.store.load(id);
		expect(saved.attempts[0].status).toBe("running");
		expect(saved.run).toEqual({ id: "crashed-run", allowance: 2, used: 1 });
		await recovery(f.store.open(id));
		const attempts = await Promise.allSettled([
			f.store.open(id, { recoverDeadOwner: true }),
			f.store.open(id, { recoverDeadOwner: true }),
		]);
		expect(
			attempts.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		const winner = attempts.find((result) => result.status === "fulfilled");
		if (winner?.status !== "fulfilled") throw new Error("No recovery winner");
		journals.push(winner.value);
		expect(winner.value.read()).toEqual(saved);
		expect(await readFile(path)).toEqual(before);
	});

	test("a permission error probing a same-host PID is uncertain, never proof of death", async () => {
		const f = await fixture();
		const journal = await f.create();
		const id = journal.read().id;
		await journal.close();
		const path = join(f.directory, `${id}.jsonl.lock`);
		const owner = JSON.stringify({
			type: "goal-lease",
			version: 1,
			host: hostname(),
			pid: process.pid,
			token: "permission-denied",
		});
		await writeFile(path, owner);
		const probe = spyOn(process, "kill").mockImplementation(() => {
			throw Object.assign(new Error("denied"), { code: "EPERM" });
		});
		try {
			await recovery(f.store.open(id, { recoverDeadOwner: true }));
		} finally {
			probe.mockRestore();
		}
		expect(await readFile(path, "utf8")).toBe(owner);
	});
	for (const owner of ["malformed", "foreign", "invalid-pid"]) {
		test(`explicit recovery refuses ${owner} ownership and preserves both files`, async () => {
			const f = await fixture();
			const journal = await f.create();
			const id = journal.read().id;
			await journal.close();
			const path = join(f.directory, `${id}.jsonl`);
			const lock =
				owner === "malformed"
					? "{"
					: JSON.stringify({
							type: "goal-lease",
							version: 1,
							host: owner === "foreign" ? `${hostname()}-foreign` : hostname(),
							pid: owner === "invalid-pid" ? -1 : process.pid,
							token: "uncertain",
						});
			await writeFile(`${path}.lock`, lock);
			const before = await readFile(path);
			await recovery(f.store.open(id, { recoverDeadOwner: true }));
			expect(await readFile(path)).toEqual(before);
			expect(await readFile(`${path}.lock`, "utf8")).toBe(lock);
		});
	}

	for (const tail of [
		'{"type":',
		"{}",
		"{broken}\n",
		"\n",
		Buffer.from([0xff, 10]),
	]) {
		test(`unsafe tail ${JSON.stringify(tail)} preserves last valid progress and cannot be reopened for append`, async () => {
			const f = await fixture();
			const journal = await f.create();
			const expected = await journal.update(progress, "saved progress");
			await journal.close();
			const path = join(f.directory, `${expected.id}.jsonl`);
			await appendFile(path, tail);
			const before = await readFile(path);
			expect((await recovery(f.store.load(expected.id))).lastValid).toEqual(
				expected,
			);
			expect(
				(await recovery(f.store.open(expected.id, { recoverDeadOwner: true })))
					.lastValid,
			).toEqual(expected);
			expect(await readFile(path)).toEqual(before);
			expect(await f.store.list()).toMatchObject({
				goals: [],
				errors: [{ id: expected.id }],
			});
		});
	}

	const corruptions: [
		string,
		(entry: {
			version?: number;
			id: string;
			cwd: string;
			type: string;
			parentId: string;
			timestamp: string;
			state: Omit<GoalState, "items"> & { items: GoalState["items"] | null };
		}) => void,
	][] = [
		[
			"unsupported version",
			(entry) => {
				entry.version = 2;
			},
		],
		[
			"header identity",
			(entry) => {
				entry.id = "different-goal";
			},
		],
		[
			"state identity",
			(entry) => {
				entry.state.id = "different-goal";
			},
		],
		[
			"cwd identity",
			(entry) => {
				entry.cwd += "-other";
			},
		],
		[
			"unknown record type",
			(entry) => {
				entry.type = "session";
			},
		],
		[
			"duplicate checkpoint identity",
			(entry) => {
				entry.id = "duplicate";
			},
		],
		[
			"parent ancestry",
			(entry) => {
				entry.parentId = "unknown";
			},
		],
		[
			"timestamp",
			(entry) => {
				entry.timestamp = "not-a-time";
			},
		],
		[
			"revision gap",
			(entry) => {
				entry.state.revision += 2;
			},
		],
		[
			"schema",
			(entry) => {
				entry.state.items = null;
			},
		],
		[
			"immutable objective",
			(entry) => {
				entry.state.objective = "replacement";
			},
		],
	];
	for (const [name, corrupt] of corruptions) {
		test(`detects ${name} corruption rather than overwriting committed history`, async () => {
			const f = await fixture();
			const journal = await f.create();
			const initial = journal.read();
			await journal.update(progress, "progress");
			await journal.close();
			const path = join(f.directory, `${initial.id}.jsonl`);
			const entries = (await readFile(path, "utf8"))
				.trimEnd()
				.split("\n")
				.map((row) => JSON.parse(row));
			const headerCorruption =
				name === "unsupported version" || name === "header identity";
			if (name === "duplicate checkpoint identity") entries[1].id = "duplicate";
			corrupt(entries[headerCorruption ? 0 : 2]);
			await writeFile(
				path,
				`${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
			);
			const before = await readFile(path);
			const error = await recovery(f.store.open(initial.id));
			expect(error.lastValid).toEqual(headerCorruption ? undefined : initial);
			expect(await readFile(path)).toEqual(before);
		});
	}

	test("refuses further commits after external torn writes and keeps the original last committed snapshot", async () => {
		const f = await fixture();
		const journal = await f.create();
		const expected = await journal.update(progress, "progress");
		const path = join(f.directory, `${expected.id}.jsonl`);
		await appendFile(path, "{torn");
		const before = await readFile(path);
		expect(
			(
				await recovery(
					journal.update((draft) => {
						draft.checkpoint = "unsafe";
					}, "next"),
				)
			).lastValid,
		).toEqual(expected);
		await recovery(journal.update(() => {}, "retry forbidden"));
		expect(journal.read()).toEqual(expected);
		expect(await readFile(path)).toEqual(before);
	});
	test("a partial write failure preserves lastValid, poisons further commits and remains visible after close", async () => {
		const f = await fixture();
		const journal = await f.create();
		const expected = await journal.update(progress, "progress");
		const path = join(f.directory, `${expected.id}.jsonl`);
		const before = await readFile(path);
		// Inject the filesystem failure at the actual journal descriptor, after bytes escape.
		const handle = (journal as unknown as { handle: FileHandle }).handle;
		const write = handle.write.bind(handle);
		const fault = spyOn(handle, "write").mockImplementationOnce(async () => {
			await write(Buffer.from("{partial"), 0, 8, before.length);
			throw new Error("injected disk failure");
		});
		try {
			expect(
				(
					await recovery(
						journal.update((draft) => {
							draft.checkpoint = "not committed";
						}, "fault"),
					)
				).lastValid,
			).toEqual(expected);
		} finally {
			fault.mockRestore();
		}
		await recovery(journal.update(() => {}, "must not retry"));
		await journal.close();
		expect(journal.read()).toEqual(expected);
		expect((await recovery(f.store.load(expected.id))).lastValid).toEqual(
			expected,
		);
		expect(await readFile(path)).toEqual(
			Buffer.concat([before, Buffer.from("{partial")]),
		);
	});

	test("a displaced owner cannot commit or remove a replacement owner's lease on close", async () => {
		const f = await fixture();
		const journal = await f.create();
		const path = join(f.directory, `${journal.read().id}.jsonl.lock`);
		const replacement = JSON.stringify({
			type: "goal-lease",
			version: 1,
			host: hostname(),
			pid: process.pid,
			token: "different-owner",
		});
		await unlink(path);
		await writeFile(path, replacement, { flag: "wx" });
		await recovery(journal.update(() => {}, "stolen"));
		await expect(journal.close()).rejects.toThrow("replaced or lost");
		expect(await readFile(path, "utf8")).toBe(replacement);
	});

	test("nonexistent IDs, traversal, unavailable roots and blocked storage never create project-local fallback", async () => {
		const f = await fixture();
		await expect(f.store.load("missing")).rejects.toThrow();
		await expect(f.store.open("missing")).rejects.toThrow();
		expect(await f.store.list()).toEqual({ goals: [], errors: [] });
		for (const id of ["../escape", "..", "a/b", "a\\b", "", "/absolute"]) {
			await expect(f.store.load(id)).rejects.toThrow("invalid goal id");
			await expect(f.store.open(id)).rejects.toThrow("invalid goal id");
		}
		expect(() => new GoalStore("relative/goals")).toThrow("no cwd fallback");
		await writeFile(join(f.root, "blocked"), "not a directory");
		await expect(
			new GoalStore(join(f.root, "blocked", "goals")).create(f.input),
		).rejects.toThrow();
		expect(await readdir(f.cwd)).toEqual([]);
		expect((await readdir(f.root)).sort()).toEqual(["blocked", "project"]);
	});

	test("rejects invalid mutations without committing them and permits a subsequent valid update", async () => {
		const f = await fixture();
		const journal = await f.create();
		const invalid: ((draft: GoalState) => void)[] = [
			(d) => {
				d.id = "replacement";
			},
			(d) => {
				d.cwd = f.root;
			},
			(d) => {
				d.objective = "replacement";
			},
			(d) => {
				d.criteria.push("replacement");
			},
			(d) => {
				d.revision = 7;
			},
			(d) => {
				d.workRevision = -1;
			},
			(d) => {
				d.workRevision = Number.NaN;
			},
			(d) => {
				d.workRevision = 2;
			},
			(d) => {
				d.run = { id: "r", allowance: 0, used: 0 };
			},
			(d) => {
				d.run = { id: "r", allowance: Number.POSITIVE_INFINITY, used: 0 };
			},
			(d) => {
				d.run = { id: "r", allowance: 1, used: -1 };
			},
			(d) => {
				d.run = { id: "r", allowance: 1, used: 2 };
			},
			(d) => {
				d.run = { id: "r", allowance: 1, used: Number.NaN };
			},
			(d) => {
				d.attempts.push({
					id: "a",
					kind: "worker",
					status: "running",
					summary: "",
					usage: { bad: Number.NaN },
				});
			},
		];
		for (const change of invalid)
			await expect(journal.update(change, "invalid")).rejects.toThrow();
		expect(journal.read().revision).toBe(0);
		await journal.update(progress, "valid");
		await expect(
			journal.update((draft) => {
				if (draft.run) draft.run.used = 0;
			}, "replenish"),
		).rejects.toThrow();
		await expect(
			journal.update((draft) => {
				if (draft.run) draft.run.allowance = 10;
			}, "expand"),
		).rejects.toThrow();
		await expect(
			journal.update((draft) => {
				draft.workRevision = 0;
			}, "stale revision"),
		).rejects.toThrow();
		expect((await f.store.load(journal.read().id)).revision).toBe(1);
	});

	test("a generated ID collision cannot replace an existing goal or its committed history", async () => {
		const f = await fixture();
		const journal = await f.create();
		const expected = await journal.update(progress, "preserved");
		await journal.close();
		const path = join(f.directory, `${expected.id}.jsonl`);
		const before = await readFile(path);
		const collision = spyOn(crypto, "randomUUID").mockReturnValue(
			expected.id as ReturnType<typeof crypto.randomUUID>,
		);
		try {
			await expect(f.create()).rejects.toThrow();
		} finally {
			collision.mockRestore();
		}
		expect(await readFile(path)).toEqual(before);
		expect(await f.store.load(expected.id)).toEqual(expected);
		expect(await readdir(f.directory)).toEqual([`${expected.id}.jsonl`]);
	});

	test("list reports a corrupt goal separately without hiding healthy goals", async () => {
		const f = await fixture();
		const healthy = await f.create();
		const broken = await f.create();
		await broken.close();
		await appendFile(join(f.directory, `${broken.read().id}.jsonl`), "torn");
		const listed = await f.store.list();
		expect(listed.goals).toEqual([healthy.read()]);
		expect(listed.errors).toHaveLength(1);
		expect(listed.errors[0].id).toBe(broken.read().id);
		expect(listed.errors[0].error).toContain("recovery");
	});
});
