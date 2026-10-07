import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type OpenTuiConfig, DEFAULT_CONFIG, loadConfig, saveConfig } from "./config.ts";
import { installEditor } from "./editor.ts";
import { installFooter } from "./footer.ts";
import { createWorklineRenderer } from "./workline.ts";
import { emptyGitStatus, readGitStatus } from "./git.ts";
import { readRuntimeInfo } from "./runtime.ts";
import { SessionLifecycle } from "./session-lifecycle.ts";
import { LatestRefresh } from "./refresh.ts";
import { registerSettingsCommand } from "./settings-command.ts";
import { formatTurnTelemetry, TurnTelemetryTracker, type TurnTelemetry } from "./telemetry.ts";
import { RunOutcomeTracker } from "./run-outcome.ts";
import {
	createInitialState,
	getModelMeta,
	invalidateUsageCache,
	type FooterState,
} from "./state.ts";
import { resolveGlyphs } from "./icons.ts";
import {
	buildPeekLabel,
	collectPeekParts,
	createPeekState,
	reducePeek,
	type PeekState,
} from "./peek.ts";

type PendingUiChange = "install" | "uninstall";
const HIDDEN_THINKING_HORIZONTAL_PADDING = 2;
// Pi's fullscreen transcript can reserve one more column for its scrollbar.
const HIDDEN_THINKING_SCROLLBAR_RESERVE = 1;

export function getPendingUiChange(enabled: boolean, active: boolean): PendingUiChange | undefined {
	if (enabled === active) return undefined;
	return enabled ? "install" : "uninstall";
}

function isTuiContext(ctx: ExtensionContext): boolean {
	try {
		const mode = (ctx as ExtensionContext & { mode?: string }).mode;
		return ctx.hasUI && (mode === undefined || mode === "tui");
	} catch {
		return false;
	}
}

export default function (pi: ExtensionAPI) {
	const sessionLifecycle = new SessionLifecycle();
	const state: FooterState = createInitialState();
	const runOutcome = new RunOutcomeTracker(state);
	const turnTelemetry = new TurnTelemetryTracker();
	let worklineTelemetry: TurnTelemetry | undefined;

	let config: OpenTuiConfig = structuredClone(DEFAULT_CONFIG);
	let active = false;
	let lastCtx: ExtensionContext | undefined;
	let requestFooterRender: (() => void) | undefined;
	let workingTimer: ReturnType<typeof setInterval> | undefined;
	let cleanupFooter: (() => void) | undefined;
	let editor: ReturnType<typeof installEditor> | undefined;
	let pendingUiChange: PendingUiChange | undefined;

	// thinking-peek state (rendered by Pi inside its hidden-thinking block)
	const peek: PeekState = createPeekState();
	let peekFrame = 0;
	let peekSettleTimer: ReturnType<typeof setTimeout> | undefined;
	let peekTaskEpoch = 0; // bumped at every agent task boundary
	let peekLabelActive = false;
	let peekWarningShown = false;

	const gitRefresh = new LatestRefresh<typeof state.git>((git) => {
		state.git = git;
		requestFooterRender?.();
	});
	const runtimeRefresh = new LatestRefresh<typeof state.runtime>((runtime) => {
		state.runtime = runtime;
		requestFooterRender?.();
	});

	const getThinkingLevel = () => (sessionLifecycle.isCurrent() ? pi.getThinkingLevel() : "off");

	/** True while the agent is running (false during session-restore replay). */
	const isAgentIdle = (ctx: ExtensionContext): boolean => {
		try {
			return (ctx as ExtensionContext & { isIdle?: () => boolean }).isIdle?.() === true;
		} catch {
			return false;
		}
	};

	/** Pi decides whether this label is visible; our toggle only controls updates. */
	const isPeekEnabled = () => sessionLifecycle.isCurrent() && config.enabled && config.thinkingPeek.lines > 0 && active;

	const setPeekLabel = (ctx?: ExtensionContext): void => {
		if (!isPeekEnabled() || peek.phase === "idle") return;
		const target = ctx ?? lastCtx;
		if (!target || !isTuiContext(target)) return;
		const columns = editor?.getViewportWidth();
		const updated = columns !== undefined && editor?.setLatestHiddenThinkingLabel(buildPeekLabel(
			peek,
			peekFrame,
			resolveGlyphs(config.icons.mode),
			Math.max(1, columns - HIDDEN_THINKING_HORIZONTAL_PADDING - HIDDEN_THINKING_SCROLLBAR_RESERVE),
			config.thinkingPeek.lines,
		));
		if (updated) peekLabelActive = true;
		else if (!peekWarningShown) {
			peekWarningShown = true;
			target.ui.notify("open-tui: thinking peek unavailable on this host; retaining the native label", "warning");
		}
	};

	const clearPeekLabel = (ctx?: ExtensionContext): void => {
		if (!peekLabelActive) return;
		const target = ctx ?? lastCtx;
		if (!target || !isTuiContext(target)) return;
		// The global reset is safe here: every completed message returns to Pi's native label.
		target.ui.setHiddenThinkingLabel();
		peekLabelActive = false;
	};

	/** Reset peek state to idle and cancel any scheduled cleanup. */
	const resetPeek = () => {
		peek.phase = "idle";
		peek.tail = "";
		editor?.resetHiddenThinkingLabelTarget();
		if (peekSettleTimer) {
			clearTimeout(peekSettleTimer);
			peekSettleTimer = undefined;
		}
	};
	const applyUi = (ctx: ExtensionContext) => {
		if (!isTuiContext(ctx)) return;
		if (!config.enabled) {
			uninstallUi(ctx);
			return;
		}
		if (!active) {
			const footer = installFooter(
				ctx,
				() => state,
				() => config,
				() => getModelMeta(ctx, getThinkingLevel, config.footerSegments.capitalizeProviderName),
				{
					setRequestRender: (fn) => {
						requestFooterRender = fn ?? undefined;
					},
					scheduleGitRefresh: () => {
						void scheduleGitRefresh(ctx);
					},
				},
			);
			cleanupFooter = footer.cleanup;
			editor = installEditor(
				pi,
				ctx,
				config.cursorStyle,
				{
					enabled: () => config.inlineFooter,
					render: footer.renderInline,
				},
				config.editorBorderStyle,
				createWorklineRenderer(() => state, () => config, () => ctx.ui.theme, Date.now, () => worklineTelemetry),
			);
			active = true;
		}
	};

	const uninstallUi = (ctx: ExtensionContext) => {
		if (!isTuiContext(ctx)) return;
		if (active) {
			cleanupFooter?.();
			editor?.cleanup();
			cleanupFooter = undefined;
			editor = undefined;
			requestFooterRender = undefined;
			resetPeek();
			clearPeekLabel(ctx);
			active = false;
		}
	};

	const scheduleGitRefresh = (ctx: ExtensionContext) => {
		if (!sessionLifecycle.isCurrent()) return;
		const segs = config.footerSegments;
		if (!config.enabled || (!segs.gitBranch && !segs.gitStatus && !segs.gitCommit)) {
			gitRefresh.invalidate();
			state.git = emptyGitStatus();
			requestFooterRender?.();
			return;
		}
		const cwd = ctx.cwd;
		const options = { readCommit: segs.gitCommit, readTag: segs.gitCommit, readCounts: segs.gitStatus };
		gitRefresh.request(() => readGitStatus(cwd, options));
	};

	const refreshRuntime = (ctx: ExtensionContext) => {
		if (!sessionLifecycle.isCurrent()) return;
		if (!config.enabled || !config.footerSegments.runtime) {
			runtimeRefresh.invalidate();
			state.runtime = null;
			return;
		}
		const cwd = ctx.cwd;
		runtimeRefresh.request(() => readRuntimeInfo(cwd));
	};

	const refreshInteractiveState = (ctx: ExtensionContext, project = false) => {
		if (!sessionLifecycle.isCurrent() || !ctx.hasUI) return;
		if (project) {
			void scheduleGitRefresh(ctx);
			void refreshRuntime(ctx);
		}
		requestFooterRender?.();
	};

	const startWorkingTimer = () => {
		stopWorkingTimer();
		const tick = () => {
			if (!sessionLifecycle.isCurrent() || !active) return;
			editor?.requestRender();
		};
		tick();
		workingTimer = setInterval(tick, 250);
		workingTimer.unref?.();
	};

	const stopWorkingTimer = () => {
		if (workingTimer) {
			clearInterval(workingTimer);
			workingTimer = undefined;
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		sessionLifecycle.start();
		pendingUiChange = undefined;
		peekWarningShown = false;
		peekTaskEpoch++;
		resetPeek();
		lastCtx = ctx;
		gitRefresh.invalidate();
		runtimeRefresh.invalidate();
		state.git = emptyGitStatus();
		state.runtime = null;
		stopWorkingTimer();
		runOutcome.reset();
		turnTelemetry.reset();
		worklineTelemetry = undefined;
		invalidateUsageCache();

		config = loadConfig((msg, level) => ctx.ui.notify(msg, level));
		clearPeekLabel(ctx);

		applyUi(ctx);

		refreshInteractiveState(ctx, true);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		sessionLifecycle.shutdown();
		gitRefresh.invalidate();
		runtimeRefresh.invalidate();
		stopWorkingTimer();
		runOutcome.reset();
		turnTelemetry.reset();
		worklineTelemetry = undefined;
		if (active) {
			uninstallUi(ctx);
		}
		lastCtx = undefined;
	});

	pi.on("agent_start", (event, ctx) => {
		if (!sessionLifecycle.isCurrent()) return;
		const newRun = state.workingSince === undefined;
		runOutcome.handle(event, ctx.signal);
		turnTelemetry.handle(event);
		// agent_start also covers custom-message and continuation-triggered tasks
		// that do not emit a user message_start event.
		peekTaskEpoch++;
		if (newRun) worklineTelemetry = undefined;
		startWorkingTimer();
	});

	pi.on("agent_end", (event, ctx) => {
		if (!sessionLifecycle.isCurrent()) return;
		runOutcome.handle(event, ctx.signal);
		// A low-level loop can end before automatic recovery or continuation.
		// Keep the timer running; only agent_settled publishes the final result.
	});

	pi.on("agent_before_settle", (event) => {
		if (!sessionLifecycle.isCurrent()) return;
		runOutcome.handle(event);
	});

	pi.on("turn_start", (event, ctx) => {
		if (!sessionLifecycle.isCurrent()) return;
		runOutcome.handle(event, ctx.signal);
		turnTelemetry.handle(event);
	});

	pi.on("message_start", (event, ctx) => {
		turnTelemetry.handle(event);
		if (!sessionLifecycle.isCurrent() || isAgentIdle(ctx)) return;
		const role = event.message?.role;
		if (role === "user") {
			// Restore Pi's native label until real thinking arrives. The task epoch is
			// advanced by agent_start so custom/no-user tasks are covered too.
			resetPeek();
			clearPeekLabel(ctx);
		} else if (role === "assistant") {
			resetPeek();
			clearPeekLabel(ctx);
		}
	});

	pi.on("message_update", (event, ctx) => {
		turnTelemetry.handle(event);
		if (!sessionLifecycle.isCurrent() || isAgentIdle(ctx)) return;
		if (!isPeekEnabled()) return;
		const message = event.message;
		if (!message || message.role !== "assistant") return;
		if (peek.phase === "done") return;
		const parts = collectPeekParts(message.content);
		const next = reducePeek(peek, parts);
		const changed = next.phase !== peek.phase || next.tail !== peek.tail;
		peek.phase = next.phase;
		peek.tail = next.tail;
		if (!changed) return;
		if (peek.phase === "thinking") {
			peekFrame++;
			setPeekLabel(ctx);
		} else if (peek.phase === "done") {
			setPeekLabel(ctx);
		}
	});

	pi.on("tool_execution_start", (event) => {
		turnTelemetry.handle(event);
	});

	pi.on("turn_end", (event, ctx) => {
		if (!sessionLifecycle.isCurrent()) return;
		runOutcome.handle(event, ctx.signal);
		turnTelemetry.handle(event);
	});

	pi.on("agent_settled", (event, ctx) => {
		if (!sessionLifecycle.isCurrent() || state.workingSince === undefined) return;
		runOutcome.handle(event);
		stopWorkingTimer();
		editor?.requestRender();
		requestFooterRender?.();
		refreshInteractiveState(ctx, true);
		const telemetry = turnTelemetry.handle(event);
		if (telemetry && config.enabled && config.telemetry.enabled && isTuiContext(ctx)) {
			if (config.workline.attachToBorder) {
				const message = formatTurnTelemetry(telemetry, ctx.ui.theme, config.telemetry, config.icons.mode);
				if (message) ctx.ui.notify(message, "info");
			} else if (sessionLifecycle.isCurrent() && active) {
				worklineTelemetry = telemetry;
				editor?.requestRender();
			}
		}
		// Only clear the peek label when this task is still the current one.
		const settleEpoch = peekTaskEpoch;
		if (peekSettleTimer) clearTimeout(peekSettleTimer);
		const settleGeneration = sessionLifecycle.currentGeneration();
		peekSettleTimer = setTimeout(() => {
			peekSettleTimer = undefined;
			if (!sessionLifecycle.isCurrent(settleGeneration) || peekTaskEpoch !== settleEpoch) return;
			resetPeek();
			clearPeekLabel(ctx);
		}, 300);
	});

	pi.on("model_select", (_event, ctx) => {
		refreshInteractiveState(ctx);
	});

	pi.on("thinking_level_select", (_event, ctx) => {
		refreshInteractiveState(ctx);
	});

	pi.on("message_end", (event, ctx) => {
		if (!sessionLifecycle.isCurrent()) return;
		runOutcome.handle(event, ctx.signal);
		turnTelemetry.handle(event);
		if (event.message?.role === "assistant" && peek.phase === "thinking") {
			// Sub-message finished (answer text or a tool call): freeze the peek line.
			peek.phase = "done";
			setPeekLabel(ctx);
		}
		invalidateUsageCache();
		refreshInteractiveState(ctx);
	});

	pi.on("tool_execution_end", (_event, ctx) => {
		refreshInteractiveState(ctx, true);
	});

	pi.on("session_compact", (_event, ctx) => {
		if (!sessionLifecycle.isCurrent()) return;
		invalidateUsageCache();
		refreshInteractiveState(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		if (!sessionLifecycle.isCurrent()) return;
		stopWorkingTimer();
		runOutcome.reset();
		turnTelemetry.reset();
		worklineTelemetry = undefined;
		peekTaskEpoch++;
		resetPeek();
		clearPeekLabel(ctx);
		editor?.requestRender();
		invalidateUsageCache();
		refreshInteractiveState(ctx);
	});

	registerSettingsCommand(pi, {
		getConfig: () => config,
		onConfigChanged: (newConfig) => {
			const cursorStyleChanged = config.cursorStyle !== newConfig.cursorStyle;
			const borderStyleChanged = config.editorBorderStyle !== newConfig.editorBorderStyle;
			const thinkingPeekLinesChanged = config.thinkingPeek.lines !== newConfig.thinkingPeek.lines;
			try {
				saveConfig(newConfig);
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				lastCtx?.ui.notify(newConfig.settingsLanguage === "zh"
					? `open-tui：设置仅在本次会话生效，保存失败：${detail}`
					: `open-tui: settings applied for this session only; save failed: ${detail}`, "warning");
			}
			config = newConfig;
			if (newConfig.thinkingPeek.lines === 0 || !newConfig.enabled) {
				resetPeek();
				clearPeekLabel(lastCtx);
			} else if (thinkingPeekLinesChanged && peekLabelActive) {
				setPeekLabel(lastCtx);
			}
			if (cursorStyleChanged && active && editor) {
				editor.setCursorStyle(newConfig.cursorStyle);
			}
			if (borderStyleChanged && active && editor) {
				editor.setBorderStyle(newConfig.editorBorderStyle);
			}
			if (lastCtx) {
				pendingUiChange = getPendingUiChange(newConfig.enabled, active);
			}
			if (lastCtx) refreshInteractiveState(lastCtx, true);
			requestFooterRender?.();
		},
		onOverlayClosed: () => {
			if (!lastCtx || pendingUiChange === undefined) return;
			const change = pendingUiChange;
			pendingUiChange = undefined;
			if (!config.enabled || change === "uninstall") {
				uninstallUi(lastCtx);
			} else {
				applyUi(lastCtx);
			}
		},
	});
}
