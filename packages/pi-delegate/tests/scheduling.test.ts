import { expect, test } from "bun:test";
import {
	Admission,
	type Capacity,
	concurrencyLimit,
} from "../src/scheduling.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("startup limit defaults to four and rejects invalid values", () => {
	expect(concurrencyLimit("1")).toBe(1);
	expect(concurrencyLimit("4")).toBe(4);
	for (const value of [
		"",
		"0",
		"-1",
		"1.5",
		" 4",
		"4e1",
		"Infinity",
		"9007199254740992",
	])
		expect(() => concurrencyLimit(value)).toThrow();
	const old = process.env.PI_DELEGATE_CONCURRENCY;
	try {
		delete process.env.PI_DELEGATE_CONCURRENCY;
		expect(concurrencyLimit()).toBe(4);
	} finally {
		if (old !== undefined) process.env.PI_DELEGATE_CONCURRENCY = old;
	}
});

test("FIFO leases include cleanup, skip cancellations, and release exactly once", async () => {
	let capacity: Capacity | undefined;
	const pool = new Admission(1, (value) => {
		capacity = value;
	});
	const release = await pool.acquire();
	const cancel = new AbortController();
	const cancelled = pool.acquire(cancel.signal).catch(() => "cancelled");
	const order: number[] = [];
	const second = pool.acquire().then((lease) => {
		order.push(2);
		return lease;
	});
	const third = pool.acquire().then((lease) => {
		order.push(3);
		return lease;
	});
	expect(capacity).toEqual({ occupied: 1, queued: 3, maximum: 1 });
	cancel.abort();
	expect(await cancelled).toBe("cancelled");
	await tick();
	expect(order).toEqual([]); // Completion without owned cleanup does not release a lease.
	release();
	release();
	const releaseSecond = await second;
	expect(order).toEqual([2]);
	expect(capacity).toEqual({ occupied: 1, queued: 1, maximum: 1 });
	releaseSecond();
	(await third)();
	expect(order).toEqual([2, 3]);
	expect(capacity).toEqual({ occupied: 0, queued: 0, maximum: 1 });
});

test("abort at admission is seen by owner before execution and aborted entries never reserve", async () => {
	const pool = new Admission(1);
	const controller = new AbortController();
	const lease = await pool.acquire(controller.signal, () => controller.abort());
	expect(controller.signal.aborted).toBe(true);
	lease();
	await expect(pool.acquire(AbortSignal.abort())).rejects.toBeDefined();
	(await pool.acquire())();
});

test("an admission observer failure cannot leak capacity", async () => {
	const pool = new Admission(1);
	await expect(
		pool.acquire(undefined, () => {
			throw new Error("observer");
		}),
	).rejects.toThrow("observer");
	(await pool.acquire())();
});
