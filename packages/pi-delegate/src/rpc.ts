import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type {
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
} from "@earendil-works/pi-coding-agent";

type RecordValue = Record<string, unknown>;
interface Pending {
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
}

export interface RpcRequestDiagnostics {
	command: string;
	id: string;
	timeoutMs: number;
	elapsedMs: number;
	/** A completed pipe write does not establish host acceptance. */
	writeState: "queued" | "written";
}

/** A control response timeout leaves host preprocessing/submission outcome uncertain. */
export class RpcTimeoutError extends Error {
	constructor(
		type: string,
		readonly request?: RpcRequestDiagnostics,
	) {
		super(
			`Pi RPC command timed out: ${type}${request ? ` (no matching response within ${request.timeoutMs} ms; pipe write ${request.writeState})` : ""}`,
		);
		this.name = "RpcTimeoutError";
	}
}

const STDERR_MAX_BYTES = 16 * 1024;

export interface RpcDiagnostics {
	stderr: string;
	stderrTruncated: boolean;
	exitCode?: number | null;
	signal?: NodeJS.Signals | null;
	lastRecord?: { type: string; command?: string; ageMs: number };
	extensionErrors?: { extensionPath: string; event: string; error: string }[];
}

export class RpcProcess {
	readonly child: ChildProcessWithoutNullStreams;
	private pending = new Map<string, Pending>();
	private listeners = new Set<(record: RecordValue) => void>();
	private failure?: Error;
	private sequence = 0;
	private closing = false;
	private stopPromise?: Promise<void>;
	private closed: Promise<void>;
	private writeTail: Promise<void> = Promise.resolve();
	private stderrTail = Buffer.alloc(0);
	private stderrTruncated = false;
	private collectingDiagnostics = true;
	private unexpectedExit?: Pick<RpcDiagnostics, "exitCode" | "signal">;
	private lastRecord?: { type: string; command?: string; at: number };
	private extensionErrors: NonNullable<RpcDiagnostics["extensionErrors"]> = [];

	constructor(
		executable: string,
		args: string[],
		options: { cwd: string; env: NodeJS.ProcessEnv },
		private signal?: AbortSignal,
		private ui?: (
			request: RpcExtensionUIRequest,
		) => Promise<RpcExtensionUIResponse | undefined>,
	) {
		signal?.throwIfAborted();
		this.child = spawn(executable, args, {
			...options,
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
			detached: process.platform !== "win32",
		});
		this.closed = new Promise((resolve) => this.child.once("close", resolve));
		const decoder = new StringDecoder("utf8");
		let buffer = "";
		this.child.stdout.on("data", (chunk: Buffer) => {
			buffer += decoder.write(chunk);
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const line = buffer.slice(0, newline).replace(/\r$/, "");
				buffer = buffer.slice(newline + 1);
				if (line) this.receive(line);
				newline = buffer.indexOf("\n");
			}
		});
		this.child.stderr.on("data", (chunk: Buffer) => {
			if (!this.collectingDiagnostics) return;
			const size = this.stderrTail.length + chunk.length;
			this.stderrTruncated ||= size > STDERR_MAX_BYTES;
			if (chunk.length >= STDERR_MAX_BYTES) {
				// Copy, rather than retain a view of a potentially huge backing buffer.
				this.stderrTail = Buffer.from(chunk.subarray(-STDERR_MAX_BYTES));
			} else {
				this.stderrTail = Buffer.concat([
					this.stderrTail.subarray(Math.max(0, size - STDERR_MAX_BYTES)),
					chunk,
				]);
			}
		});
		this.child.stdout.on("error", (error) => this.fail(error));
		this.child.stdin.on("error", (error) => this.fail(error));
		this.child.on("error", (error) => this.fail(error));
		this.child.on("exit", (code, exitSignal) => {
			if (!this.closing) {
				this.unexpectedExit = { exitCode: code, signal: exitSignal };
				this.fail(
					new Error(`Pi RPC child exited: code=${code}, signal=${exitSignal}`),
				);
			}
		});
		signal?.addEventListener("abort", this.abort, { once: true });
		if (signal?.aborted) this.abort();
	}

	/** Snapshot after bounded cleanup to include the last available pipe bytes. */
	diagnostics(): RpcDiagnostics {
		let start = 0;
		if (this.stderrTruncated) {
			// A raw-byte tail can start halfway through a UTF-8 code point.
			while ((this.stderrTail[start] & 0xc0) === 0x80) start++;
		}
		return {
			stderr: this.stderrTail.subarray(start).toString("utf8"),
			stderrTruncated: this.stderrTruncated,
			...this.unexpectedExit,
			...(this.lastRecord
				? {
						lastRecord: {
							type: this.lastRecord.type,
							...(this.lastRecord.command
								? { command: this.lastRecord.command }
								: {}),
							ageMs: Math.max(0, performance.now() - this.lastRecord.at),
						},
					}
				: {}),
			...(this.extensionErrors.length
				? { extensionErrors: structuredClone(this.extensionErrors) }
				: {}),
		};
	}

	discardDiagnostics(): void {
		this.collectingDiagnostics = false;
		this.stderrTail = Buffer.alloc(0);
		this.stderrTruncated = false;
		this.unexpectedExit = undefined;
		this.lastRecord = undefined;
		this.extensionErrors = [];
	}

	private abort = () => {
		this.fail(new Error("Delegation cancelled"));
		void this.stop();
	};

	private fail(error: Error): void {
		if (this.failure) return;
		this.failure = error;
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
		for (const listener of this.listeners)
			listener({ type: "rpc_failure", error });
	}

	private write(record: RecordValue, onWritten?: () => void): void {
		const line = `${JSON.stringify(record)}\n`;
		// Serialize writes and await each callback before writing more, honoring pipe backpressure.
		this.writeTail = this.writeTail
			.then(
				() =>
					new Promise<void>((resolve, reject) => {
						if (this.failure) {
							reject(this.failure);
							return;
						}
						this.child.stdin.write(line, (error) => {
							if (error) reject(error);
							else {
								onWritten?.();
								resolve();
							}
						});
					}),
			)
			.catch((error: unknown) => {
				this.fail(error instanceof Error ? error : new Error(String(error)));
			});
	}

	private receive(line: string): void {
		let record: RecordValue;
		try {
			const parsed: unknown = JSON.parse(line);
			if (
				parsed === null ||
				typeof parsed !== "object" ||
				Array.isArray(parsed)
			)
				throw new Error();
			record = parsed as RecordValue;
		} catch {
			this.fail(new Error("Invalid JSONL from Pi RPC child"));
			return;
		}
		if (this.collectingDiagnostics) {
			this.lastRecord = {
				type: String(record.type ?? "unknown").slice(0, 100),
				...(typeof record.command === "string"
					? { command: record.command.slice(0, 100) }
					: {}),
				at: performance.now(),
			};
			if (record.type === "extension_error") {
				this.extensionErrors.push({
					extensionPath: String(record.extensionPath ?? "unknown").slice(
						0,
						500,
					),
					event: String(record.event ?? "unknown").slice(0, 100),
					error: String(record.error ?? "unknown").slice(0, 2_000),
				});
				if (this.extensionErrors.length > 8) this.extensionErrors.shift();
			}
		}
		if (record.type === "response" && typeof record.id === "string") {
			const pending = this.pending.get(record.id);
			if (!pending) return;
			this.pending.delete(record.id);
			clearTimeout(pending.timer);
			if (record.success === true) pending.resolve(record.data);
			else
				pending.reject(new Error(String(record.error ?? "RPC command failed")));
			return;
		}
		if (record.type === "extension_ui_request") {
			const request = record as unknown as RpcExtensionUIRequest;
			void this.handleUi(request);
		}
		for (const listener of this.listeners) listener(record);
	}

	private async handleUi(request: RpcExtensionUIRequest): Promise<void> {
		try {
			const response = await this.ui?.(request);
			if (this.closing || this.failure) return;
			if (response) this.write(response as unknown as RecordValue);
			else if (
				["select", "confirm", "input", "editor"].includes(request.method)
			) {
				this.write({
					type: "extension_ui_response",
					id: request.id,
					cancelled: true,
				});
			}
		} catch {
			if (!this.closing && !this.failure)
				this.write({
					type: "extension_ui_response",
					id: request.id,
					cancelled: true,
				});
		}
	}

	request<T>(
		type: string,
		fields: RecordValue = {},
		timeoutMs = 40_000,
	): Promise<T> {
		if (this.failure) return Promise.reject(this.failure);
		if (this.closing)
			return Promise.reject(new Error("RPC child is shutting down"));
		const id = `delegate-${++this.sequence}`;
		const began = performance.now();
		let writeState: RpcRequestDiagnostics["writeState"] = "queued";
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(
					new RpcTimeoutError(type, {
						command: type,
						id,
						timeoutMs,
						elapsedMs: Math.max(0, performance.now() - began),
						writeState,
					}),
				);
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (value) => resolve(value as T),
				reject,
				timer,
			});
			try {
				this.write({ ...fields, type, id }, () => {
					writeState = "written";
				});
			} catch (error) {
				this.fail(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	subscribe(listener: (record: RecordValue) => void): () => void {
		this.listeners.add(listener);
		if (this.failure) listener({ type: "rpc_failure", error: this.failure });
		return () => this.listeners.delete(listener);
	}
	waitForSettled(): { promise: Promise<void>; dispose(): void } {
		let listener: (record: RecordValue) => void;
		const promise = new Promise<void>((resolve, reject) => {
			listener = (record) => {
				if (record.type === "agent_settled") resolve();
				if (record.type === "rpc_failure") reject(record.error);
			};
			this.listeners.add(listener);
			if (this.failure) reject(this.failure);
		});
		// The prompt may reject before the caller awaits settlement.
		void promise.catch(() => {});
		return { promise, dispose: () => this.listeners.delete(listener) };
	}

	stop(): Promise<void> {
		this.stopPromise ??= this.close();
		return this.stopPromise;
	}

	private async close(): Promise<void> {
		this.closing = true;
		this.signal?.removeEventListener("abort", this.abort);
		this.fail(new Error("RPC child stopped"));
		this.child.stdin.end();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const graceful = await Promise.race([
			this.closed.then(() => true),
			new Promise<false>((resolve) => {
				timer = setTimeout(() => resolve(false), 1_000);
			}),
		]);
		clearTimeout(timer);
		if (!graceful && this.child.pid) {
			if (
				process.platform === "win32" &&
				this.child.exitCode === null &&
				this.child.signalCode === null
			) {
				await new Promise<void>((resolve) => {
					const killer = spawn(
						"taskkill",
						["/PID", String(this.child.pid), "/T", "/F"],
						{ stdio: "ignore", windowsHide: true },
					);
					killer.on("error", () => {
						this.child.kill("SIGKILL");
						resolve();
					});
					killer.on("close", () => {
						this.child.kill("SIGKILL");
						resolve();
					});
				});
			} else if (process.platform !== "win32") {
				try {
					process.kill(-this.child.pid, "SIGKILL");
				} catch {
					this.child.kill("SIGKILL");
				}
			}
		}
		if (!graceful) {
			// A crashed child can leave inherited stdio handles open in descendants. Do not wait
			// forever for those pipes or target an already-exited Windows PID with taskkill.
			this.child.stdin.destroy();
			this.child.stdout.destroy();
			this.child.stderr.destroy();
		}
		await this.closed;
		this.listeners.clear();
	}
}
