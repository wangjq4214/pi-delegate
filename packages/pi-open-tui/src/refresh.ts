/** Single-flight external snapshots: coalesce requests and never publish superseded results. */
export class LatestRefresh<T> {
	private version = 0;
	private pending: { version: number; read: () => Promise<T> } | undefined;
	private running = false;

	private readonly apply: (value: T) => void;

	constructor(apply: (value: T) => void) {
		this.apply = apply;
	}

	invalidate(): void {
		this.version++;
		this.pending = undefined;
	}

	request(read: () => Promise<T>): void {
		this.pending = { version: ++this.version, read };
		if (!this.running) void this.drain();
	}

	private async drain(): Promise<void> {
		this.running = true;
		try {
			while (this.pending) {
				const request = this.pending;
				this.pending = undefined;
				try {
					const value = await request.read();
					if (request.version === this.version) this.apply(value);
				} catch {
					// Project metadata is best-effort; a failed read retains the last snapshot.
				}
			}
		} finally {
			this.running = false;
		}
	}
}
