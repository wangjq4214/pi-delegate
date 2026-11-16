import { expect, test } from "bun:test";
import {
	copyFile,
	mkdir,
	mkdtemp,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Stage only published files: public declarations must not deep-import src/.
test("published API runtime and declarations resolve without source files", async () => {
	const directory = await mkdtemp(join(tmpdir(), "delegate-api-package-"));
	try {
		const modules = join(directory, "node_modules");
		const pkg = join(modules, "@wangjq4214", "pi-delegate");
		await mkdir(join(pkg, "dist"), { recursive: true });
		await mkdir(join(modules, "@earendil-works"), { recursive: true });
		await copyFile(resolve("package.json"), join(pkg, "package.json"));
		for (const file of ["api.js", "api.d.ts"])
			await copyFile(resolve("dist", file), join(pkg, "dist", file));
		for (const peer of ["pi-coding-agent", "pi-ai", "pi-tui"])
			await symlink(
				resolve("node_modules/@earendil-works", peer),
				join(modules, "@earendil-works", peer),
				"junction",
			);
		await writeFile(
			join(directory, "consumer.mts"),
			`import { getDelegateClient, registerParentOnlyTools, isDelegatedChild, type DelegateInput, type DelegateResult, type DelegateClient, type DelegateExecutionOptions, type DelegateExecutionProgress } from "@wangjq4214/pi-delegate/api";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
export async function consume(pi: ExtensionAPI, ctx: ExtensionContext, signal: AbortSignal): Promise<DelegateResult> {
 if (isDelegatedChild()) throw new Error("child");
 const off: () => void = registerParentOnlyTools(pi, ["consumer_work"]);
 const client = getDelegateClient(pi);
 const version: 1 = client.version;
 const input: DelegateInput = { task: "work", context: "explicit", cwd: ctx.cwd, thinkingLevel: "high", budget: { maxTurns: 1 }, pressure: {} };
 const capability: true | undefined = client.capabilities?.invocationProgress;
 const options: DelegateExecutionOptions = { presentation: "consumer", onProgress(progress: DelegateExecutionProgress) {
   const id: string = progress.taskId;
   const phase: DelegateExecutionProgress["phase"] = progress.phase;
   const cancelling: boolean = progress.cancelling;
 } };
 // Older clients without capabilities and a three-argument execute still typecheck.
 const legacy: DelegateClient = { version: 1, execute: async (_input, _ctx, _signal) => client.execute(input, ctx, signal), status: client.status, list: client.list, wait: client.wait, cancel: client.cancel };
 await client.execute(input, ctx, signal, options);
 const result = await client.execute(input, ctx, signal);
 const status: "completed" | "incomplete" | "failed" | "cancelled" = result.details.status;
 off(); return result;
}
`,
		);
		const compiler = Bun.spawnSync(
			[
				process.execPath,
				fileURLToPath(
					new URL("./bin/tsc", import.meta.resolve("typescript/package.json")),
				),
				"--noEmit",
				"--strict",
				"--skipLibCheck",
				"--target",
				"es2022",
				"--module",
				"nodenext",
				"--moduleResolution",
				"nodenext",
				"consumer.mts",
			],
			{ cwd: directory },
		);
		expect(compiler.stdout.toString() + compiler.stderr.toString()).toBe("");
		expect(compiler.exitCode).toBe(0);
		const runtime = Bun.spawnSync(
			[
				"node",
				"--input-type=module",
				"-e",
				'import { getDelegateClient } from "@wangjq4214/pi-delegate/api"; if (typeof getDelegateClient !== "function") process.exit(1);',
			],
			{ cwd: directory },
		);
		expect(runtime.stderr.toString()).toBe("");
		expect(runtime.exitCode).toBe(0);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
