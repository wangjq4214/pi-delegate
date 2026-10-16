interface Subscription {
	intervalMs: number;
	due: number;
	update(): void;
}

/** One demand-driven periodic source. Components still own their measurements and invalidation. */
export class UiRefresh {
	private readonly subscriptions = new Map<symbol, Subscription>();
	private readonly renders = new Set<() => void>();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private deadline: number | undefined;
	private origin: number | undefined;
	private generation = 0;
	private batchDepth = 0;
	readonly now: () => number;

	constructor(now: () => number = () => performance.now()) {
		this.now = now;
	}

	subscribe(intervalMs: number, update: () => void): () => void {
		if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error("UI refresh interval must be positive");
		const key = Symbol();
		this.origin ??= this.now();
		this.subscriptions.set(key, { intervalMs, due: this.nextDue(intervalMs), update });
		this.schedule();
		return () => {
			if (this.subscriptions.delete(key)) this.schedule();
		};
	}

	/** Defer identical render/invalidation channels until all due state updates are applied. */
	requestRender(render: () => void): void {
		if (this.batchDepth) this.renders.add(render);
		else render();
	}

	reset(): void {
		this.generation++;
		this.subscriptions.clear();
		this.renders.clear();
		this.origin = undefined;
		this.stop();
	}

	private stop(): void {
		clearTimeout(this.timer);
		this.timer = undefined;
		this.deadline = undefined;
	}

	private nextDue(intervalMs: number): number {
		const origin = this.origin ?? this.now();
		return origin + (Math.floor((this.now() - origin) / intervalMs) + 1) * intervalMs;
	}

	private schedule(): void {
		const deadline = Math.min(...Array.from(this.subscriptions.values(), (entry) => entry.due));
		if (deadline === this.deadline) return;
		this.stop();
		if (!Number.isFinite(deadline)) { this.origin = undefined; return; }
		this.deadline = deadline;
		const generation = this.generation;
		this.timer = setTimeout(() => {
			if (generation !== this.generation) return;
			this.timer = undefined;
			this.deadline = undefined;
			this.batchDepth++;
			try {
				const now = this.now();
				for (const [key, entry] of Array.from(this.subscriptions)) {
					if (generation !== this.generation) break;
					if (this.subscriptions.get(key) !== entry || entry.due > now) continue;
					// Missed frames are not useful work; never replay a backlog after a pause.
					entry.due = this.nextDue(entry.intervalMs);
					entry.update();
				}
			} finally {
				this.batchDepth--;
				const renders = Array.from(this.renders);
				this.renders.clear();
				try {
					for (const render of renders) {
						if (generation !== this.generation) break;
						render();
					}
				} finally {
					this.schedule();
				}
			}
		}, Math.max(1, deadline - this.now()));
		this.timer.unref?.();
	}
}
