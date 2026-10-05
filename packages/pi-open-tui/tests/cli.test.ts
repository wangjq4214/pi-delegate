import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("the independent application entry starts without delegate", () => {
	const result = Bun.spawnSync([
		process.execPath,
		fileURLToPath(new URL("../src/cli.ts", import.meta.url)),
	]);
	expect(result.exitCode).toBe(0);
	expect(result.stdout.toString()).toContain(
		"pi-open-tui: application scaffold",
	);
	expect(result.stderr.toString()).toBe("");
});
