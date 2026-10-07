import assert from "node:assert/strict";
import test from "node:test";
import { LatestRefresh } from "../src/refresh.ts";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("refresh is single-flight, coalesces pending reads and publishes only the latest", async () => {
	const results: string[] = [];
	const refresh = new LatestRefresh<string>((value) => results.push(value));
	const first = deferred<string>();
	const last = deferred<string>();
	let lastReads = 0;
	refresh.request(() => first.promise);
	refresh.request(() => { assert.fail("superseded pending read must not start"); });
	refresh.request(() => { lastReads++; return last.promise; });
	assert.equal(lastReads, 0);
	first.resolve("old");
	await tick();
	assert.deepEqual(results, []);
	assert.equal(lastReads, 1);
	last.resolve("new");
	await tick();
	assert.deepEqual(results, ["new"]);
});

test("session/disable invalidation discards running and queued work, then permits a fresh read", async () => {
	const results: string[] = [];
	const refresh = new LatestRefresh<string>((value) => results.push(value));
	const old = deferred<string>();
	refresh.request(() => old.promise);
	refresh.request(() => { assert.fail("invalidated read must not run"); });
	refresh.invalidate();
	old.resolve("old session");
	await tick();
	assert.deepEqual(results, []);
	refresh.request(async () => "new session");
	await tick();
	assert.deepEqual(results, ["new session"]);
});

test("a failed read does not strand later refreshes", async () => {
	const results: number[] = [];
	const refresh = new LatestRefresh<number>((value) => results.push(value));
	refresh.request(async () => { throw new Error("unavailable metadata"); });
	await tick();
	refresh.request(async () => 42);
	await tick();
	assert.deepEqual(results, [42]);
});
