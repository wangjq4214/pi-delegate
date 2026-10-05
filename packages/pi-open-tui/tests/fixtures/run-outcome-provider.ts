import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	Type,
} from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}

export function gate() {
	return { entered: deferred(), release: deferred() };
}

export type ResponseStep = {
	kind: "stop" | "length" | "error" | "toolUse";
	error?: string;
	gate?: ReturnType<typeof gate>;
};

/** In-process scripted provider. No fetch, credentials, files, or external tools. */
export function runOutcomeProvider(steps: ResponseStep[]) {
	let calls = 0;
	const failures: string[] = [];
	const extension = (pi: ExtensionAPI) => {
		pi.registerTool(defineTool({
			name: "outcome_failing_tool",
			label: "Outcome fixture failure",
			description: "Deterministically throws to exercise real host tool failure handling",
			parameters: Type.Object({}),
			async execute() { throw new Error("intentional local tool failure"); },
		}));
		pi.registerProvider("run-outcome-fixture", {
			api: "run-outcome-fixture-api",
			apiKey: "local-placeholder-not-a-credential",
			baseUrl: "https://invalid.example",
			models: [{
				id: "deterministic", name: "Offline outcome fixture", reasoning: false,
				input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000, maxTokens: 8192,
			}],
			streamSimple(model, _context, options) {
				const step = steps[calls++];
				const stream = createAssistantMessageEventStream();
				const message: AssistantMessage = {
					role: "assistant", api: model.api, provider: model.provider, model: model.id,
					content: [], stopReason: "pending", timestamp: Date.now(),
					usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				};
				void (async () => {
					try {
						await options?.onPayload?.({ fixture: calls }, model);
						await options?.onResponse?.({ status: 200, headers: {} }, model);
						await options?.onProviderStreamEvent?.({ fixture: calls }, model);
						stream.push({ type: "start", partial: message });
						if (!step) {
							failures.push(`Unexpected provider request ${calls}`);
							throw new Error("fixture script exhausted");
						}
						if (step.kind === "toolUse") {
							const toolCall = { type: "toolCall" as const, id: `fixture-${calls}`,
								name: "outcome_failing_tool", arguments: {} };
							message.content = [toolCall];
							stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
							stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
						} else {
							message.content = [{ type: "text", text: "fixture response" }];
							stream.push({ type: "text_start", contentIndex: 0, partial: message });
							stream.push({ type: "text_delta", contentIndex: 0, delta: "fixture response", partial: message });
							stream.push({ type: "text_end", contentIndex: 0, content: "fixture response", partial: message });
						}
						if (step.gate) {
							// Wait without polling; real session.abort() releases this via its signal.
							await new Promise<void>((resolve) => {
								const signal = options?.signal;
								const finish = () => { signal?.removeEventListener("abort", finish); resolve(); };
								signal?.addEventListener("abort", finish, { once: true });
								void step.gate!.release.promise.then(finish);
								step.gate!.entered.resolve();
								if (signal?.aborted) finish();
							});
						}
						if (options?.signal?.aborted) {
							message.stopReason = "aborted";
							message.errorMessage = "local stream aborted";
							stream.push({ type: "error", reason: "aborted", error: message });
						} else if (step.kind === "error") {
							message.stopReason = "error";
							message.errorMessage = step.error ?? "invalid local fixture request";
							stream.push({ type: "error", reason: "error", error: message });
						} else {
							message.stopReason = step.kind;
							stream.push({ type: "done", reason: step.kind, message });
						}
					} catch (error) {
						message.stopReason = "error";
						message.errorMessage = String(error);
						stream.push({ type: "error", reason: "error", error: message });
					} finally { stream.end(); }
				})();
				return stream;
			},
		});
	};
	return { extension, failures, get calls() { return calls; } };
}
