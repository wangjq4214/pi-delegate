import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
	getDelegateClient,
	registerParentOnlyTools,
} from "@wangjq4214/pi-delegate/api";
import { allowanceValue, GoalController } from "./controller.ts";
import {
	confirmationText,
	GoalCreation,
	type GoalProposal,
} from "./creation.ts";
import {
	displayText,
	formatCurrentGoal,
	formatGoalList,
	formatGoalStatus,
} from "./presentation.ts";
import { GoalProgressView } from "./progress-view.ts";
import { GoalStore } from "./store.ts";

export const GOAL_TOOLS = [
	"goal_propose",
	"goal_status",
	"goal_plan",
	"goal_work",
	"goal_accept",
	"goal_review",
	"goal_reinspect",
	"goal_block",
];

export default function goal(pi: ExtensionAPI): void {
	if (process.env.PI_DELEGATE_CHILD === "1") return;
	registerParentOnlyTools(pi, GOAL_TOOLS);
	const store = new GoalStore(join(getAgentDir(), "goals"));
	let context: ExtensionContext | undefined;
	const creation = new GoalCreation();
	let activating: GoalProposal | undefined;
	const clearDraft = () => {
		creation.cancel();
		view.refresh();
	};
	const delegateClient = () => {
		const client = getDelegateClient(pi);
		if (client.capabilities?.invocationProgress !== true)
			throw new Error(
				"pi-goal requires pi-delegate invocation progress / consumer presentation support; update pi-delegate",
			);
		return client;
	};
	const controller = new GoalController(store, (input, signal, onProgress) => {
		if (!context) throw new Error("No current parent context is available");
		return delegateClient().execute(input, context, signal, {
			presentation: "consumer",
			onProgress,
		});
	});
	const view = new GoalProgressView(controller, () => creation.status());
	const report = () => ({
		activity: controller.progress().dispatch,
		stopping: controller.progress().stopping,
		draft: creation.status(),
		state: controller.status(),
		runtimeActive: controller.active,
		reinspectionRequired: controller.needsReinspection,
	});
	const result = (value: unknown) => ({
		content: [{ type: "text" as const, text: JSON.stringify(value) }],
		details: value,
	});
	const errorResult = (error: unknown) => ({
		...result({
			error: error instanceof Error ? error.message : String(error),
			...report(),
		}),
		isError: true,
	});
	const notice = (ctx: ExtensionContext, error: unknown) =>
		ctx.ui.notify(
			displayText(error instanceof Error ? error.message : String(error)),
			"error",
		);
	const strings = Type.Array(Type.String({ minLength: 1 }));

	// Retain ownership until the host admits the run, not merely until our handler returns.
	let pendingCoordinator = false;
	let initialCoordinatorCharged = false;
	const pause = (ctx: ExtensionContext, reason?: string): Promise<void> => {
		initialCoordinatorCharged = false;
		clearDraft();
		const cleanup = controller.pause(reason); // Revoke authority synchronously first.
		if (pendingCoordinator) {
			pendingCoordinator = false;
			// Pi keeps returned boundary proposals while later handlers await. Native abort
			// hard-stops that admission without cancelling unrelated delegated children.
			ctx.abort();
		}
		return cleanup;
	};

	const dispatchInitial = async (
		ctx: ExtensionContext,
		current = () => true,
	) => {
		const checkpoint = await controller.coordination();
		if (!checkpoint || !controller.active) return;
		if (!current() || !ctx.isIdle()) {
			await pause(
				ctx,
				"Goal authorization changed or parent became busy before initial dispatch",
			);
			return;
		}
		pendingCoordinator = true;
		pi.sendMessage(
			{
				customType: "pi-goal:continue",
				content: `Coordinate goal ${controller.status()?.id}. Use the current goal context.`,
				display: false,
			},
			{ triggerTurn: true },
		);
	};
	const activate = async (
		proposal: GoalProposal,
		ctx: ExtensionContext,
		signal: AbortSignal,
	) => {
		delegateClient();
		activating = proposal;
		// Keep confirmation and persistence inside the live native tool run. An
		// approval must never outlive that run while waiting for an idle callback.
		const abort = () => {
			void pause(ctx, "Goal activation was interrupted").catch((error) =>
				notice(ctx, error),
			);
		};
		signal.addEventListener("abort", abort, { once: true });
		try {
			signal.throwIfAborted();
			const input = creation.consume(proposal, ctx.cwd);
			await controller.create(input);
			if (signal.aborted || !creation.isCurrent(proposal, ctx.cwd)) {
				await pause(ctx, "Goal draft changed during activation");
				throw new Error("Goal activation was invalidated");
			}
			// Meter before returning authority to sibling tools or codemode. A nested
			// terminate flag is not guaranteed to end the outer native tool batch.
			const checkpoint = await controller.coordination();
			if (
				!checkpoint ||
				signal.aborted ||
				!creation.isCurrent(proposal, ctx.cwd)
			) {
				await pause(ctx, "Initial goal coordination was invalidated");
				throw new Error("Initial goal coordination was invalidated");
			}
			initialCoordinatorCharged = true;
		} catch (error) {
			if (activating === proposal)
				await pause(ctx, "Confirmed goal activation failed");
			throw error;
		} finally {
			signal.removeEventListener("abort", abort);
			if (activating === proposal) activating = undefined;
		}
	};

	pi.registerTool({
		name: "goal_propose",
		label: "Confirm a goal draft",
		description:
			"Submit the current conversational goal draft after obtaining an explicit allowance from the user. Shows a runtime-owned Start/Cancel choice; proposed data and chat assent do not authorize execution. Never dispatch work during drafting.",
		executionMode: "sequential",
		parameters: Type.Object({
			draftId: Type.String({ minLength: 1 }),
			objective: Type.String({ minLength: 1 }),
			criteria: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
			allowance: Type.Integer({ minimum: 1 }),
		}),
		async execute(_id, params, signal, _update, ctx) {
			context = ctx;
			view.bind(ctx);
			let proposal: GoalProposal | undefined;
			let approved = false;
			try {
				signal?.throwIfAborted();
				if (controller.active || activating)
					throw new Error("Pause the current goal before proposing another");
				if (!creation.status())
					throw new Error("Use /goal <objective> to begin a goal discussion");
				proposal = creation.prepare(params.draftId, params, ctx.cwd);
				view.refresh();
				if (!ctx.hasUI)
					throw new Error(
						"User confirmation UI is unavailable; the goal has not started",
					);
				const cancellation = signal
					? AbortSignal.any([signal, proposal.signal])
					: proposal.signal;
				const choice = await ctx.ui.select(
					confirmationText(proposal),
					["Start", "Cancel"],
					{ signal: cancellation },
				);
				cancellation.throwIfAborted();
				if (choice !== "Start") {
					if (creation.isCurrent(proposal, ctx.cwd)) clearDraft();
					return {
						...result({
							started: false,
							reason:
								"Goal creation cancelled. Use /goal <objective> to discuss another draft.",
						}),
						terminate: true,
					};
				}
				creation.approve(proposal, ctx.cwd);
				approved = true;
				await activate(proposal, ctx, cancellation);
				clearDraft();
				// End the draft tool run. The existing metered actionable boundary
				// admits the first coordinator, just as it admits later continuations.
				return { ...result({ started: true, ...report() }), terminate: true };
			} catch (error) {
				if (approved || proposal?.signal.aborted || signal?.aborted)
					return { ...errorResult(error), terminate: true };
				return errorResult(error);
			}
		},
	});
	pi.registerTool({
		name: "goal_status",
		label: "Goal status",
		description:
			"Inspect the current goal or a saved global goal by ID. Saved active status is not proof of live execution.",
		parameters: Type.Object({ id: Type.Optional(Type.String()) }),
		async execute(_id, params) {
			try {
				return result(
					params.id
						? {
								state: await store.load(params.id),
								runtimeActive:
									controller.active && params.id === controller.status()?.id,
							}
						: report(),
				);
			} catch (error) {
				return errorResult(error);
			}
		},
	});
	pi.registerTool({
		name: "goal_plan",
		label: "Plan goal work",
		description:
			"Upsert bounded logical work items and a progress checkpoint. This is not execution or acceptance.",
		parameters: Type.Object({
			items: Type.Array(
				Type.Object({
					id: Type.String(),
					title: Type.String(),
					acceptance: Type.String(),
				}),
				{ minItems: 1 },
			),
			checkpoint: Type.String({ minLength: 1 }),
		}),
		async execute(_id, params) {
			try {
				await controller.plan(params.items, params.checkpoint);
				return result(report());
			} catch (error) {
				return errorResult(error);
			}
		},
	});
	pi.registerTool({
		name: "goal_work",
		label: "Execute goal work",
		description:
			"Run one planned work item through the shared delegate runtime. Consumes goal allowance. Worker completion is not acceptance. Scope task/context explicitly; edits are not sandboxed or rolled back.",
		parameters: Type.Object({
			itemId: Type.String(),
			task: Type.String({ minLength: 1 }),
			context: Type.Optional(Type.String()),
			budget: Type.Optional(
				Type.Object({
					maxSeconds: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
					maxTurns: Type.Optional(Type.Integer({ minimum: 1 })),
				}),
			),
			model: Type.Optional(
				Type.Object({ provider: Type.String(), id: Type.String() }),
			),
			thinkingLevel: Type.Optional(
				Type.Union(
					["off", "minimal", "low", "medium", "high", "xhigh", "max"].map(
						(level) => Type.Literal(level),
					),
				),
			),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			context = ctx;
			view.bind(ctx);
			const abort = () => {
				void pause(ctx, "Goal work invocation aborted").catch((error) =>
					notice(ctx, error),
				);
			};
			signal?.addEventListener("abort", abort, { once: true });
			try {
				signal?.throwIfAborted();
				if (activating)
					throw new Error(
						"Goal creation is still settling; wait before dispatching work or review",
					);
				await controller.work({
					...params,
					thinkingLevel: params.thinkingLevel as Parameters<
						GoalController["work"]
					>[0]["thinkingLevel"],
				});
				return result(report());
			} catch (error) {
				return errorResult(error);
			} finally {
				signal?.removeEventListener("abort", abort);
			}
		},
	});
	pi.registerTool({
		name: "goal_accept",
		label: "Accept goal evidence",
		description:
			"Explicit parent assessment of an item's evidence. Does not complete the goal; independent review is mandatory. Register relevant artifact paths for recovery and review freshness checks.",
		parameters: Type.Object({
			itemId: Type.String(),
			evidence: strings,
			artifacts: strings,
		}),
		async execute(_id, params) {
			try {
				await controller.accept(
					params.itemId,
					params.evidence,
					params.artifacts,
				);
				return result(report());
			} catch (error) {
				return errorResult(error);
			}
		},
	});
	pi.registerTool({
		name: "goal_review",
		label: "Independently review goal",
		description:
			"Run a fresh independent delegated reviewer after all items have acceptance evidence. Consumes the same goal allowance. Only current affirmative review can complete the goal.",
		parameters: Type.Object({}),
		async execute(_id, _params, signal, _onUpdate, ctx) {
			context = ctx;
			view.bind(ctx);
			const abort = () => {
				void pause(ctx, "Goal review invocation aborted").catch((error) =>
					notice(ctx, error),
				);
			};
			signal?.addEventListener("abort", abort, { once: true });
			try {
				signal?.throwIfAborted();
				if (activating)
					throw new Error(
						"Goal creation is still settling; wait before dispatching work or review",
					);
				await controller.review();
				return result(report());
			} catch (error) {
				return errorResult(error);
			} finally {
				signal?.removeEventListener("abort", abort);
			}
		},
	});
	pi.registerTool({
		name: "goal_reinspect",
		label: "Record recovery reinspection",
		description:
			"After manually inspecting actual current files/tests and previous attempt effects, record findings before any resumed work. Never blindly replay an interrupted task.",
		parameters: Type.Object({ evidence: strings, artifacts: strings }),
		async execute(_id, params) {
			try {
				await controller.reinspect(params.evidence, params.artifacts);
				return result(report());
			} catch (error) {
				return errorResult(error);
			}
		},
	});
	pi.registerTool({
		name: "goal_block",
		label: "Pause blocked goal",
		description:
			"Stop scheduling and cancel goal-owned work when a user decision or other blocker prevents safe continuation. Preserve progress and report the blocker.",
		parameters: Type.Object({ reason: Type.String({ minLength: 1 }) }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			try {
				await pause(ctx, params.reason);
				return result(report());
			} catch (error) {
				return errorResult(error);
			}
		},
	});

	pi.registerCommand("goal", {
		description:
			"Goal: <natural-language objective>, status [id], list, pause, or resume <id> <allowance>",
		async handler(args, ctx) {
			context = ctx;
			view.bind(ctx);
			let resumed = false;
			try {
				const input = args.trim();
				if (!input || input === "status") {
					ctx.ui.notify(formatCurrentGoal(report()), "info");
					return;
				}
				if (input === "list") {
					ctx.ui.notify(formatGoalList(await store.list()), "info");
					return;
				}
				if (input.startsWith("status ")) {
					ctx.ui.notify(
						formatGoalStatus(await store.load(input.slice(7).trim())),
						"info",
					);
					return;
				}
				if (input === "pause") {
					await pause(ctx);
					ctx.ui.notify(
						"Goal paused; owned children have settled. Existing edits remain.",
						"info",
					);
					return;
				}
				if (!ctx.isIdle())
					throw new Error(
						"Start or resume a goal only when the parent is idle",
					);
				if (controller.active || activating)
					throw new Error("Pause the current goal before starting another");
				delegateClient();
				clearDraft();
				if (input.startsWith("resume ")) {
					const parts = input.split(/\s+/);
					if (parts.length !== 3)
						throw new Error("Usage: /goal resume <id> <positive allowance>");
					await controller.resume(
						parts[1],
						allowanceValue(Number(parts[2])),
						ctx.cwd,
					);
					resumed = true;
					await dispatchInitial(ctx);
				} else {
					creation.begin(input, ctx.cwd);
					view.refresh();
					pi.sendUserMessage(
						`Discuss this goal draft; do not execute it yet:\n${input}`,
					);
				}
			} catch (error) {
				if (resumed && controller.active)
					await pause(ctx, "Initial goal dispatch failed");
				notice(ctx, error);
			}
		},
	});

	pi.on("session_start", (_event, ctx) => {
		context = ctx;
		view.bind(ctx);
	});
	pi.on("input", async (_event, ctx) => {
		creation.invalidate();
		view.refresh();
		if (activating)
			await pause(ctx, "New user input invalidated pending goal activation");
	});
	pi.on("context", async (event) => {
		const prompt = controller.active ? controller.prompt() : creation.prompt();
		if (!prompt) return;
		return {
			messages: [
				...event.messages,
				{
					role: "custom" as const,
					customType: "pi-goal:context",
					content: prompt,
					display: false,
					timestamp: Date.now(),
				},
			],
		};
	});
	pi.on("agent_before_settle", async (event, ctx) => {
		if (event.outcome !== "completed") creation.invalidate();
		if (!controller.active) return;
		try {
			if (event.outcome !== "completed") {
				await pause(ctx, `Parent ended: ${event.outcome}`);
				return;
			}
			const checkpoint = initialCoordinatorCharged
				? controller.prompt()
				: await controller.coordination();
			initialCoordinatorCharged = false;
			if (!checkpoint || !controller.active) return;
			// canContinue describes the old projection; our new user-role draft enables it.
			pendingCoordinator = true;
			return {
				entries: [
					...event.entries,
					{
						type: "custom_message" as const,
						customType: "pi-goal:continue",
						content: `Continue coordinating goal ${controller.status()?.id} using current context.`,
						display: false,
					},
				],
				continue: true,
			};
		} catch (error) {
			notice(ctx, error);
		}
	});
	pi.on("turn_start", () => {
		// A mixed batch or codemode may continue straight into a model turn,
		// consuming the precharged initial coordinator without a host boundary.
		initialCoordinatorCharged = false;
	});
	pi.on("agent_start", () => {
		pendingCoordinator = false;
	});
	pi.on("agent_settled", async (event, ctx) => {
		pendingCoordinator = false;
		if (event.aborted)
			await pause(ctx, "Parent aborted; resume explicitly after inspection");
	});
	pi.on("session_before_tree", async (event, ctx) => {
		if (event.preparation.targetId !== event.preparation.oldLeafId) {
			view.dispose();
			await pause(ctx, "Branch navigation invalidated goal execution");
		}
	});
	pi.on("session_tree", async (event, ctx) => {
		// New source-branch work may have been accepted while navigation awaited.
		if (event.newLeafId !== event.oldLeafId) {
			view.dispose();
			await pause(
				ctx,
				"Committed branch navigation invalidated goal execution",
			);
		}
	});
	pi.on("session_before_switch", clearDraft);
	pi.on("session_before_fork", clearDraft);
	pi.on("session_shutdown", async (_event, ctx) => {
		view.dispose();
		await pause(ctx, "Session runtime stopped; resume explicitly");
		pendingCoordinator = false;
	});
}
