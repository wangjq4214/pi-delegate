import { randomUUID } from "node:crypto";
import {
	type FileHandle,
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	unlink,
} from "node:fs/promises";
import { hostname } from "node:os";
import { isAbsolute, join } from "node:path";
import {
	type GoalState,
	validateGoalId,
	validateGoalState,
	validateGoalTransition,
} from "./model.js";

export class GoalRecoveryError extends Error {
	readonly lastValid?: GoalState;

	constructor(message: string, lastValid?: GoalState) {
		super(message);
		this.name = "GoalRecoveryError";
		this.lastValid =
			lastValid === undefined ? undefined : structuredClone(lastValid);
	}
}

interface GoalHeader {
	type: "goal";
	version: 1;
	id: string;
	cwd: string;
	timestamp: string;
}

interface Checkpoint {
	type: "checkpoint";
	id: string;
	goalId: string;
	cwd: string;
	timestamp: string;
	parentId: string | null;
	reason: string;
	state: GoalState;
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function code(error: unknown): string | undefined {
	return (error as NodeJS.ErrnoException)?.code;
}

function check(condition: unknown, description: string): asserts condition {
	if (!condition) throw new Error(description);
}

function record(
	value: unknown,
	keys: string[],
): asserts value is Record<string, unknown> {
	check(
		value !== null && typeof value === "object" && !Array.isArray(value),
		"Expected a record",
	);
	check(
		Object.keys(value).length === keys.length &&
			keys.every((key) => Object.hasOwn(value, key)),
		"Invalid record fields",
	);
}

function timestamp(value: unknown): void {
	check(
		typeof value === "string" &&
			Number.isFinite(Date.parse(value)) &&
			new Date(value).toISOString() === value,
		"Invalid timestamp",
	);
}

function checkpoint(
	state: GoalState,
	parentId: string | null,
	reason: string,
): Checkpoint {
	return {
		type: "checkpoint",
		id: randomUUID(),
		goalId: state.id,
		cwd: state.cwd,
		timestamp: new Date().toISOString(),
		parentId,
		reason,
		state,
	};
}

function line(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

function parse(
	bytes: Buffer,
	id: string,
): { state: GoalState; parentId: string } {
	let lastValid: GoalState | undefined;
	let parentId: string | null = null;
	try {
		// Decode per line so even an invalid UTF-8 tail retains earlier checkpoints.
		const decoder = new TextDecoder("utf-8", { fatal: true });
		let start = 0;
		let header: GoalHeader | undefined;
		const ids = new Set<string>();
		for (
			let end = bytes.indexOf(10);
			end !== -1;
			end = bytes.indexOf(10, start)
		) {
			const value: unknown = JSON.parse(
				decoder.decode(bytes.subarray(start, end)),
			);
			start = end + 1;
			if (!header) {
				record(value, ["type", "version", "id", "cwd", "timestamp"]);
				check(
					value.type === "goal" && value.version === 1,
					"Unsupported goal journal type/version",
				);
				check(
					value.id === id &&
						typeof value.cwd === "string" &&
						isAbsolute(value.cwd),
					"Goal header identity/cwd mismatch",
				);
				timestamp(value.timestamp);
				header = value as unknown as GoalHeader;
				continue;
			}
			record(value, [
				"type",
				"id",
				"goalId",
				"cwd",
				"timestamp",
				"parentId",
				"reason",
				"state",
			]);
			check(
				value.type === "checkpoint" &&
					typeof value.id === "string" &&
					value.id.length > 0 &&
					!ids.has(value.id),
				"Invalid checkpoint type/id",
			);
			check(
				value.goalId === id &&
					value.cwd === header.cwd &&
					value.parentId === parentId,
				"Checkpoint identity/ancestry mismatch",
			);
			check(
				typeof value.reason === "string" && value.reason.trim().length > 0,
				"Missing checkpoint reason",
			);
			timestamp(value.timestamp);
			validateGoalState(value.state);
			check(
				value.state.id === id && value.state.cwd === header.cwd,
				"State identity/cwd mismatch",
			);
			if (lastValid) validateGoalTransition(lastValid, value.state);
			else {
				check(
					value.state.status === "paused" &&
						value.state.revision === 0 &&
						value.state.workRevision === 0 &&
						value.state.items.length === 0 &&
						value.state.attempts.length === 0 &&
						value.state.checkpoint === "" &&
						value.state.run === undefined &&
						value.state.review === undefined &&
						value.state.stopReason === undefined,
					"Invalid initial checkpoint",
				);
			}
			ids.add(value.id);
			parentId = value.id;
			lastValid = value.state;
		}
		check(
			start === bytes.length,
			"Torn journal tail (missing newline); explicit repair required",
		);
		check(
			header && lastValid && parentId,
			"Journal has no committed initial checkpoint",
		);
		return { state: lastValid, parentId };
	} catch (error) {
		throw new GoalRecoveryError(
			`Goal ${id} needs recovery: ${message(error)}`,
			lastValid,
		);
	}
}

interface LockOwner {
	type: "goal-lease";
	version: 1;
	host: string;
	pid: number;
	token: string;
}

/** Only ESRCH on this host proves death; permission errors and foreign hosts do not. */
function deadOwner(value: unknown): boolean {
	record(value, ["type", "version", "host", "pid", "token"]);
	check(
		value.type === "goal-lease" &&
			value.version === 1 &&
			typeof value.token === "string" &&
			value.token.length > 0 &&
			Number.isSafeInteger(value.pid) &&
			(value.pid as number) > 0,
		"Uncertain lease owner",
	);
	if (value.host !== hostname()) return false;
	try {
		process.kill(value.pid as number, 0);
		return false;
	} catch (error) {
		return code(error) === "ESRCH";
	}
}

class Lease {
	private constructor(
		private readonly path: string,
		private readonly handle: FileHandle,
		private readonly bytes: string,
	) {}

	static async acquire(
		path: string,
		recoverDeadOwner: boolean,
	): Promise<Lease> {
		const make = async () => {
			const handle = await open(path, "wx", 0o600);
			const owner: LockOwner = {
				type: "goal-lease",
				version: 1,
				host: hostname(),
				pid: process.pid,
				token: randomUUID(),
			};
			const bytes = line(owner);
			try {
				await handle.writeFile(bytes);
				await handle.sync();
				return new Lease(path, handle, bytes);
			} catch (error) {
				// An incomplete lease is uncertain, not permission to delete/retry.
				await handle.close();
				throw error;
			}
		};
		try {
			return await make();
		} catch (error) {
			if (code(error) !== "EEXIST" || !recoverDeadOwner)
				throw new GoalRecoveryError(
					`Cannot acquire goal lease: ${message(error)}`,
				);
		}
		// Serialize explicit reclaimers. A crashed reclaimer leaves a visible blocker,
		// never a second automatic stale-lock recovery protocol.
		const guardPath = `${path}.recover`;
		const guard = await open(guardPath, "wx", 0o600);
		const guardLease = new Lease(guardPath, guard, "");
		try {
			const owner = JSON.parse(await readFile(path, "utf8"));
			check(
				deadOwner(owner),
				"Lease owner is live or uncertain; recovery refused",
			);
			await unlink(path);
			return await make();
		} catch (error) {
			throw new GoalRecoveryError(
				`Cannot recover goal lease: ${message(error)}`,
			);
		} finally {
			await guardLease.release();
		}
	}

	async verify(): Promise<void> {
		const [held, current, bytes] = await Promise.all([
			this.handle.stat(),
			lstat(this.path),
			readFile(this.path, "utf8"),
		]);
		check(
			current.isFile() &&
				held.ino === current.ino &&
				held.dev === current.dev &&
				bytes === this.bytes,
			"Goal lease was replaced or lost",
		);
	}

	async release(): Promise<void> {
		try {
			await this.verify();
			await unlink(this.path);
		} finally {
			await this.handle.close();
		}
	}
}

export class GoalJournal {
	private queue: Promise<void> = Promise.resolve();
	private closing?: Promise<void>;
	private unsafe?: GoalRecoveryError;

	constructor(
		private readonly path: string,
		private readonly handle: FileHandle,
		private readonly lease: Lease,
		private state: GoalState,
		private parentId: string,
		private bytes: Buffer,
	) {}

	read(): GoalState {
		return structuredClone(this.state);
	}

	update(
		change: (draft: GoalState) => void,
		reason: string,
	): Promise<GoalState> {
		if (this.closing)
			return Promise.reject(new Error("Goal journal is closing/closed"));
		const pending = this.queue.then(async () => {
			if (this.unsafe) throw this.unsafe;
			check(
				typeof reason === "string" && reason.trim().length > 0,
				"Checkpoint reason is required",
			);
			const draft = this.read();
			const result: unknown = change(draft);
			if (
				result !== null &&
				(typeof result === "object" || typeof result === "function") &&
				"then" in result
			) {
				void Promise.resolve(result).catch(() => undefined);
				throw new Error("Goal update callback must be synchronous");
			}
			check(
				draft.revision === this.state.revision,
				"Revision is managed by the journal",
			);
			draft.revision++;
			validateGoalTransition(this.state, draft);
			// Detach even from a draft retained by the caller; JSON is the durable value.
			const next: GoalState = JSON.parse(JSON.stringify(draft));
			validateGoalTransition(this.state, next);
			const entry = checkpoint(next, this.parentId, reason);
			const addition = Buffer.from(line(entry));
			try {
				await this.lease.verify();
				const [held, current, bytes] = await Promise.all([
					this.handle.stat(),
					lstat(this.path),
					readFile(this.path),
				]);
				check(
					current.isFile() &&
						held.ino === current.ino &&
						held.dev === current.dev &&
						bytes.equals(this.bytes),
					"Journal changed outside its lease; refusing append",
				);
				let written = 0;
				while (written < addition.length) {
					const part = await this.handle.write(
						addition,
						written,
						addition.length - written,
						this.bytes.length + written,
					);
					check(part.bytesWritten > 0, "Journal write made no progress");
					written += part.bytesWritten;
				}
				await this.handle.sync();
			} catch (error) {
				this.unsafe = new GoalRecoveryError(
					`Goal commit unsafe: ${message(error)}`,
					this.state,
				);
				throw this.unsafe;
			}
			this.bytes = Buffer.concat([this.bytes, addition]);
			this.parentId = entry.id;
			this.state = next;
			return this.read();
		});
		this.queue = pending.then(
			() => undefined,
			() => undefined,
		);
		return pending;
	}

	close(): Promise<void> {
		this.closing ??= this.queue.then(async () => {
			try {
				await this.handle.close();
			} finally {
				await this.lease.release();
			}
		});
		return this.closing;
	}
}

/** The caller supplies the resolved global agent goals directory, never a cwd. */
export class GoalStore {
	constructor(private readonly directory: string) {
		check(
			typeof directory === "string" && isAbsolute(directory),
			"Goal storage directory must be absolute; no cwd fallback",
		);
	}

	private path(id: string): string {
		validateGoalId(id);
		return join(this.directory, `${id}.jsonl`);
	}

	async create(input: {
		cwd: string;
		objective: string;
		criteria: string[];
	}): Promise<GoalJournal> {
		const state: GoalState = {
			id: randomUUID(),
			cwd: input.cwd,
			objective: input.objective,
			criteria: structuredClone(input.criteria),
			status: "paused",
			revision: 0,
			workRevision: 0,
			items: [],
			attempts: [],
			checkpoint: "",
		};
		validateGoalState(state);
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		const path = this.path(state.id);
		const lease = await Lease.acquire(`${path}.lock`, false);
		let handle: FileHandle | undefined;
		try {
			handle = await open(path, "wx+", 0o600);
			const header: GoalHeader = {
				type: "goal",
				version: 1,
				id: state.id,
				cwd: state.cwd,
				timestamp: new Date().toISOString(),
			};
			const entry = checkpoint(state, null, "created");
			const bytes = Buffer.from(line(header) + line(entry));
			await handle.writeFile(bytes);
			await handle.sync();
			return new GoalJournal(path, handle, lease, state, entry.id, bytes);
		} catch (error) {
			try {
				await handle?.close();
			} finally {
				await lease.release();
			}
			throw error;
		}
	}

	async load(id: string): Promise<GoalState> {
		return structuredClone(parse(await readFile(this.path(id)), id).state);
	}

	async open(
		id: string,
		options?: { recoverDeadOwner?: boolean },
	): Promise<GoalJournal> {
		const path = this.path(id);
		// Do not create locks for nonexistent records or create a missing root.
		await lstat(path);
		let lease: Lease;
		try {
			lease = await Lease.acquire(
				`${path}.lock`,
				options?.recoverDeadOwner === true,
			);
		} catch (error) {
			let lastValid: GoalState | undefined;
			try {
				lastValid = await this.load(id);
			} catch (loadError) {
				if (loadError instanceof GoalRecoveryError)
					lastValid = loadError.lastValid;
			}
			throw new GoalRecoveryError(message(error), lastValid);
		}
		let handle: FileHandle | undefined;
		try {
			handle = await open(path, "r+");
			const stat = await lstat(path);
			const held = await handle.stat();
			check(
				stat.isFile() && held.ino === stat.ino && held.dev === stat.dev,
				"Not a regular goal journal",
			);
			const bytes = await handle.readFile();
			const parsed = parse(bytes, id);
			return new GoalJournal(
				path,
				handle,
				lease,
				parsed.state,
				parsed.parentId,
				bytes,
			);
		} catch (error) {
			try {
				await handle?.close();
			} finally {
				await lease.release();
			}
			throw error;
		}
	}

	async list(): Promise<{
		goals: GoalState[];
		errors: { id: string; error: string }[];
	}> {
		const goals: GoalState[] = [];
		const errors: { id: string; error: string }[] = [];
		let names: string[];
		try {
			names = await readdir(this.directory);
		} catch (error) {
			if (code(error) === "ENOENT") return { goals, errors };
			throw error;
		}
		for (const name of names.sort()) {
			if (!name.endsWith(".jsonl")) continue;
			const id = name.slice(0, -6);
			try {
				goals.push(await this.load(id));
			} catch (error) {
				errors.push({ id, error: message(error) });
			}
		}
		return { goals, errors };
	}
}
