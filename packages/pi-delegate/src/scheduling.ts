export interface Capacity {
	occupied: number;
	queued: number;
	maximum: number;
}

export function concurrencyLimit(
	value = process.env.PI_DELEGATE_CONCURRENCY,
): number {
	if (value === undefined) return 4;
	if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
		throw new Error("PI_DELEGATE_CONCURRENCY must be a positive safe integer");
	return Number(value);
}

interface Waiting {
	signal?: AbortSignal;
	admitted?: () => void;
	resolve: (release: () => void) => void;
	reject: (error: unknown) => void;
	abort: () => void;
}

/** Reserves in submission order; only the caller's cleanup releases a lease. */
export class Admission {
	private occupied = 0;
	private waiting: Waiting[] = [];

	constructor(
		private maximum: number,
		private changed: (capacity: Capacity) => void = () => {},
	) {
		if (!Number.isSafeInteger(maximum) || maximum < 1)
			throw new Error("Invalid concurrency limit");
	}

	acquire(signal?: AbortSignal, admitted?: () => void): Promise<() => void> {
		return new Promise((resolve, reject) => {
			if (signal?.aborted) {
				reject(signal.reason);
				return;
			}
			const entry: Waiting = {
				signal,
				resolve,
				reject,
				admitted,
				abort: () => {
					const index = this.waiting.indexOf(entry);
					if (index < 0) return;
					this.waiting.splice(index, 1);
					signal?.removeEventListener("abort", entry.abort);
					reject(signal?.reason);
					this.drain();
				},
			};
			this.waiting.push(entry);
			signal?.addEventListener("abort", entry.abort, { once: true });
			this.drain();
		});
	}

	private drain(): void {
		while (this.occupied < this.maximum && this.waiting.length) {
			const entry = this.waiting.shift();
			if (!entry) break;
			entry.signal?.removeEventListener("abort", entry.abort);
			if (entry.signal?.aborted) {
				entry.reject(entry.signal.reason);
				continue;
			}
			this.occupied++;
			try {
				entry.admitted?.();
			} catch (error) {
				this.occupied--;
				entry.reject(error);
				continue;
			}
			let released = false;
			entry.resolve(() => {
				if (released) return;
				released = true;
				this.occupied--;
				this.drain();
			});
		}
		this.changed({
			occupied: this.occupied,
			queued: this.waiting.length,
			maximum: this.maximum,
		});
	}
}
