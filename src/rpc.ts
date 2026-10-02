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
		// Drain diagnostics without copying potentially sensitive extension output into tool results.
		this.child.stderr.resume();
		this.child.stdout.on("error", (error) => this.fail(error));
		this.child.stdin.on("error", (error) => this.fail(error));
		this.child.on("error", (error) => this.fail(error));
		this.child.on("exit", (code, exitSignal) => {
			if (!this.closing)
				this.fail(
					new Error(`Pi RPC child exited: code=${code}, signal=${exitSignal}`),
				);
		});
		signal?.addEventListener("abort", this.abort, { once: true });
		if (signal?.aborted) this.abort();
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

	private write(record: RecordValue): void {
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
						this.child.stdin.write(line, (error) =>
							error ? reject(error) : resolve(),
						);
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

	request<T>(type: string, fields: RecordValue = {}): Promise<T> {
		if (this.failure) return Promise.reject(this.failure);
		if (this.closing)
			return Promise.reject(new Error("RPC child is shutting down"));
		const id = `delegate-${++this.sequence}`;
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Pi RPC command timed out: ${type}`));
			}, 40_000);
			this.pending.set(id, {
				resolve: (value) => resolve(value as T),
				reject,
				timer,
			});
			try {
				this.write({ ...fields, type, id });
			} catch (error) {
				this.fail(error instanceof Error ? error : new Error(String(error)));
			}
		});
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
