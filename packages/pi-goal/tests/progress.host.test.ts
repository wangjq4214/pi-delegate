import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	eventually,
	type Host,
	type HostRecord,
	required,
	withHost,
} from "./fixtures/host.ts";

let sequence = 0;
async function probe(host: Host, name: string, args: object = {}) {
	const id = `progress-${++sequence}`;
	await host.prompt(`/host-call ${JSON.stringify({ id, name, args })}`, false);
	return required(
		await eventually(
			() =>
				host.trace().find((event) => event.type === "probe" && event.id === id),
			Boolean,
			`public in-flight ${name} result`,
		),
	).result as HostRecord;
}

async function held(host: Host, reviewer: boolean, ordinary = false) {
	return required(
		await eventually(
			() =>
				host.children().find((child) => {
					const trace = host.trace(child.pid);
					return (
						trace.some((event) => event.type === "held") &&
						trace.some(
							(event) =>
								event.type === "child-task" &&
								event.reviewer === reviewer &&
								event.task.includes("ORDINARY") === ordinary,
						)
					);
				}),
			Boolean,
			`${ordinary ? "ordinary" : reviewer ? "reviewer" : "worker"} child held before its first response`,
		),
	);
}

function modelCalls(host: Host) {
	return [
		host.parent.child.pid,
		...host.children().map((child) => child.pid),
	].map(
		(pid) => host.trace(pid).filter((event) => event.type === "model").length,
	);
}

// Elapsed wall-clock time advances between two legitimate public observations.
function stableObservation(value: unknown): unknown {
	return JSON.parse(
		JSON.stringify(value, (key, entry) =>
			key === "elapsedSeconds" ? undefined : entry,
		),
	);
}
// Real Pi 1.1.0 RPC, real goal controller, real delegate execution/records, local
// deterministic provider. RPC does not mount GoalProgressView: these assertions
// establish the structured consumer seam, NOT TUI rendering/compact-row visibility.
for (const built of [false, true])
	for (const goalFirst of [false, true])
		for (const scenario of ["hold", "review-hold"] as const) {
			const reviewer = scenario === "review-hold";
			test(`${built ? "BUILT" : "SOURCE"} ${goalFirst ? "goal" : "delegate"} first: pending ${reviewer ? "reviewer" : "worker"} exact public identity and read-only non-TUI progress`, async () => {
				await withHost(
					{ built, goalFirst, scenario, progress: true },
					async (host) => {
						const ordinary = await host.call("delegate", {
							task: "ORDINARY HOLD unrelated background",
							// A matching title is deliberately not an identity oracle.
							title: reviewer
								? "Independent goal review"
								: "Produce fixture artifact",
							background: true,
						});
						const ordinaryId = ordinary.details.taskId;
						const unrelated = await held(host, false, true);
						await host.start(3, false);
						const owned = await held(host, reviewer);
						expect(owned.pid).not.toBe(unrelated.pid);
						const status = await eventually(
							() => probe(host, "goal_status"),
							(value) => value.details.activity?.task?.phase === "running",
							"goal observes the pending real invocation through public progress",
						);
						expect(status.isError ?? false).toBe(false);
						const report = status.details;
						const activity = report.activity;
						expect(activity).toMatchObject({
							kind: reviewer ? "reviewer" : "worker",
							settled: false,
							task: { phase: "running", cancelling: false },
						});
						expect(report).toMatchObject({
							runtimeActive: true,
							stopping: false,
							reinspectionRequired: false,
						});
						const attempt = required(
							host
								.state()
								.attempts.find((entry) => entry.id === activity.attemptId),
						);
						expect(attempt.kind).toBe(activity.kind);
						expect(attempt.status).toBe("running");
						// The journal only gains taskId on terminal return: this ID must have
						// arrived through the live public callback, not saved-result lookup.
						expect(attempt.taskId).toBeUndefined();
						if (!reviewer) {
							expect(activity).toMatchObject({
								itemId: "artifact",
								itemTitle: "Produce fixture artifact",
							});
							expect(attempt.itemId).toBe(activity.itemId);
						} else expect(activity.itemId).toBeUndefined();
						expect(report.state.items[0].status).toBe(
							reviewer ? "accepted" : "pending",
						);
						expect(report.state.status).toBe("active");
						expect(report.state.review).toBeUndefined();
						expect(report.state.run).toMatchObject({
							allowance: 3,
							used: reviewer ? 3 : 2,
						});
						const taskId = activity.task.taskId;
						expect(typeof taskId).toBe("string");
						expect(taskId).not.toBe(ordinaryId);
						const before = {
							models: modelCalls(host),
							messages: await host.parent.request<{ messages: HostRecord[] }>(
								"get_messages",
							),
							journal: await readFile(host.journalPath(), "utf8"),
						};
						const apiList = await probe(host, "api_list");
						expect(apiList.capabilities.invocationProgress).toBe(true);
						const toolList = await probe(host, "delegate_list");
						expect(stableObservation(toolList.details)).toEqual(
							stableObservation(apiList.details),
						);
						expect(
							toolList.details.tasks.map((task: HostRecord) => task.taskId),
						).toContain(taskId);
						expect(
							toolList.details.tasks.map((task: HostRecord) => task.taskId),
						).toContain(ordinaryId);
						expect(toolList.details.total).toBe(reviewer ? 3 : 2);
						for (let observation = 0; observation < 3; observation++) {
							const apiStatus = await probe(host, "api_status", { taskId });
							const toolStatus = await probe(host, "delegate_status", {
								taskId,
							});
							expect(stableObservation(apiStatus.details)).toEqual(
								stableObservation(toolStatus.details),
							);
							expect(toolStatus.details).toMatchObject({
								taskId,
								status: "running",
							});
							expect(toolStatus.usage).toBeUndefined();
							expect(apiStatus.usage).toBeUndefined();
							expect((await probe(host, "goal_status")).details).toEqual(
								report,
							);
						}
						// Hidden synchronous records remain owned by their invocation signal.
						const cancellation = await probe(host, "delegate_cancel", {
							taskId,
						});
						expect(cancellation.isError).toBe(true);
						expect(
							(await probe(host, "api_status", { taskId: ordinaryId })).details
								.status,
						).toBe("running");
						expect(modelCalls(host)).toEqual(before.models);
						expect(
							await host.parent.request<{ messages: HostRecord[] }>(
								"get_messages",
							),
						).toEqual(before.messages);
						expect(await readFile(host.journalPath(), "utf8")).toBe(
							before.journal,
						);
						expect(
							host.events.filter(
								(event) =>
									event.type === "extension_ui_request" &&
									event.method === "setWidget" &&
									event.widgetKey === "pi-goal:progress",
							),
						).toEqual([]);
						await writeFile(join(host.logs, `${owned.pid}.release`), "release");
						await eventually(
							() => host.state().status,
							(value) => value === "complete",
							"released goal completes",
						);
						await eventually(
							() => host.parent.request<{ isStreaming: boolean }>("get_state"),
							(value) => !value.isStreaming,
							"parent settles",
						);
						const terminal = await probe(host, "api_status", { taskId });
						expect(terminal.details.status).toBe("completed");
						expect(terminal.details.usage.totalTokens).toBe(12);
						expect(
							host
								.state()
								.attempts.find((entry) => entry.id === activity.attemptId),
						).toMatchObject({
							taskId,
							status: "completed",
							usage: terminal.details.usage,
						});
						expect(host.state().run?.used).toBe(3);
						const final = await host.call("goal_status");
						expect(final.details).toMatchObject({
							runtimeActive: false,
							stopping: false,
						});
						expect(final.details.activity).toBeUndefined(); // no false live child after settlement
						expect(
							(await probe(host, "api_status", { taskId: ordinaryId })).details
								.status,
						).toBe("running");
						const messages = await host.parent.request<{
							messages: HostRecord[];
						}>("get_messages");
						const models = modelCalls(host)[0];
						await writeFile(
							join(host.logs, `${unrelated.pid}.release`),
							"release",
						);
						await eventually(
							() => probe(host, "api_status", { taskId: ordinaryId }),
							(value) => value.details.status === "completed",
							"ordinary background completes query-only",
						);
						expect(modelCalls(host)[0]).toBe(models);
						expect(
							await host.parent.request<{ messages: HostRecord[] }>(
								"get_messages",
							),
						).toEqual(messages);
						expect(
							(await probe(host, "api_status", { taskId: ordinaryId })).details
								.usage.totalTokens,
						).toBe(3);
						await host.cleaned();
					},
				);
			}, 120000);
		}

for (const built of [false, true]) {
	test(`${built ? "BUILT" : "SOURCE"} stopping remains observable until actual owned cleanup settles`, async () => {
		await withHost(
			{
				built,
				goalFirst: true,
				scenario: "hold",
				progress: true,
				cleanupHold: true,
			},
			async (host) => {
				await host.start(3, false);
				const child = await held(host, false);
				const before = (await probe(host, "goal_status")).details;
				const taskId = before.activity.task.taskId;
				const calls = modelCalls(host);
				const attempts = host.state().attempts.map((attempt) => attempt.id);
				const continuationCount = () =>
					host
						.trace()
						.filter((event) => event.type === "boundary" && event.continue)
						.length;
				const continuations = continuationCount();
				let returned = false;
				const pause = host.prompt("/goal pause", false).then(() => {
					returned = true;
				});
				try {
					await eventually(
						() =>
							host
								.trace(child.pid)
								.some((event) => event.type === "cleanup-held"),
						Boolean,
						"actual child shutdown held",
					);
					const stopping = (await probe(host, "goal_status")).details;
					expect(stopping).toMatchObject({
						runtimeActive: false,
						stopping: true,
					});
					expect(stopping.activity).toMatchObject({
						attemptId: before.activity.attemptId,
						settled: false,
						task: { taskId },
					});
					expect(returned).toBe(false);
					expect(() => process.kill(child.pid, 0)).not.toThrow();
					for (let repeat = 0; repeat < 3; repeat++)
						expect((await probe(host, "goal_status")).details).toEqual(
							stopping,
						);
					expect(modelCalls(host)).toEqual(calls);
					expect(host.state().run?.used).toBe(2);
				} finally {
					await writeFile(
						join(host.logs, `${child.pid}.cleanup-release`),
						"release",
					);
					await pause;
				}
				await host.cleaned();
				await eventually(
					() => host.parent.request<{ isStreaming: boolean }>("get_state"),
					(value) => !value.isStreaming,
					"native parent result processing settles without goal continuation",
				);
				// User-approved boundary: native parent result processing is allowed;
				// goal must not request another coordinator/child dispatch after pause.
				expect(modelCalls(host).slice(1)).toEqual(calls.slice(1));
				expect(continuationCount()).toBe(continuations);
				expect(host.state().attempts.map((attempt) => attempt.id)).toEqual(
					attempts,
				);
				expect(returned).toBe(true);
				expect(host.state().status).toBe("paused");
				expect(host.state().attempts.at(-1)?.status).toBe("cancelled");
				const final = await host.call("goal_status");
				expect(final.details).toMatchObject({
					runtimeActive: false,
					stopping: false,
				});
				expect(final.details.activity).toBeUndefined();
				expect(host.state().run?.used).toBe(2);
				expect(host.children()).toHaveLength(1);
			},
		);
	}, 120000);
}
