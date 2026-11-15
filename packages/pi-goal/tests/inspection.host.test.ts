import { expect, test } from "bun:test";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GoalStore } from "../src/store.ts";
import { eventually, type Host, required, withHost } from "./fixtures/host.ts";

async function inspect(host: Host, command: string) {
	const start = host.events.length;
	await host.prompt(command, false);
	return required(
		await eventually(
			() =>
				host.events
					.slice(start)
					.find(
						(event) =>
							event.type === "extension_ui_request" &&
							event.method === "notify",
					),
			Boolean,
			`inspection notification for ${command}`,
		),
	);
}

for (const built of [false, true]) {
	test(`${built ? "BUILT" : "SOURCE"} actual RPC human inspection is readable, non-mutating and usable without delegate`, async () => {
		await withHost(
			{ built, noDelegate: true, scenario: "idle" },
			async (host) => {
				expect((await inspect(host, "/goal list")).message).toContain(
					"No saved goals.",
				);
				expect((await inspect(host, "/goal status")).message).toContain(
					"No current goal or draft.",
				);
				const directory = join(host.agentDir, "goals");
				const store = new GoalStore(directory);
				const journal = await store.create({
					cwd: host.cwd,
					objective: "Verify parser 修复解析器",
					criteria: ["Regression passes"],
				});
				try {
					await journal.update((state) => {
						state.status = "active";
						state.run = { id: "old-run", allowance: 8, used: 3 };
						state.items = [
							{
								id: "parser",
								title: "Assess parser result",
								acceptance: "Test passes",
								status: "pending",
								evidence: [],
								artifacts: [],
							},
						];
						state.attempts = [
							{
								id: "worker",
								kind: "worker",
								itemId: "parser",
								status: "completed",
								taskId: "old-task",
								summary: "PRIVATE WORKER REPORT",
							},
						];
					}, "saved-for-inspection");
					const state = journal.read();
					const path = join(directory, `${state.id}.jsonl`);
					const bytes = await readFile(path, "utf8");
					const other = await store.create({
						cwd: join(host.temp, "other-project"),
						objective: "Other project",
						criteria: ["Saved only"],
					});
					await other.close();
					const corrupt = join(directory, "broken.jsonl");
					await writeFile(corrupt, "unsupported torn record\n");
					const names = await readdir(directory);
					const models = host
						.trace()
						.filter((event) => event.type === "model").length;
					const list = await inspect(host, "/goal list");
					for (const value of [
						state.id,
						state.objective,
						state.cwd,
						"0/1 accepted",
						"Other project",
						"Unreadable goal records",
						"ID: broken",
						"not proof of live execution",
					])
						expect(list.message).toContain(value);
					expect(list.message).not.toContain("PRIVATE WORKER REPORT");
					const detail = await inspect(host, `/goal status ${state.id}`);
					for (const value of [
						"Saved goal",
						state.id,
						"5 remaining",
						"Regression passes",
						"Assess parser result",
						"not proof of live execution or ownership",
					])
						expect(detail.message).toContain(value);
					expect(detail.notifyType).toBe("info");
					expect((await inspect(host, "/goal status broken")).notifyType).toBe(
						"error",
					);
					expect(
						(await inspect(host, "/goal status missing-goal")).notifyType,
					).toBe("error");
					expect(await readFile(path, "utf8")).toBe(bytes);
					expect(await readFile(corrupt, "utf8")).toBe(
						"unsupported torn record\n",
					);
					expect(await readdir(directory)).toEqual(names);
					expect(host.children()).toEqual([]);
					expect(
						host.trace().filter((event) => event.type === "model"),
					).toHaveLength(models);
				} finally {
					await journal.close();
				}
			},
		);
	}, 60000);
}
