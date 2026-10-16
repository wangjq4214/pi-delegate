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
import { ToolPresentation } from "./tool-presentation.ts";
import { PeekController } from "./peek-controller.ts";
import { UiRefresh } from "./ui-refresh.ts";

type PendingUiChange = "install" | "uninstall";

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
	const refresh = new UiRefresh();
	const toolPresentation = new ToolPresentation(() => config, pi, undefined, refresh);
	let toolPresentationWarningShown = false;
	const notifyToolPresentationCapability = (ctx: ExtensionContext) => {
		if (!isTuiContext(ctx) || !config.enabled || !config.toolPresentation || toolPresentation.available || toolPresentationWarningShown) return;
		toolPresentationWarningShown = true;
		ctx.ui.notify(config.settingsLanguage === "zh"
			? "open-tui：紧凑工具展示需要 Pi 1.1.0 的公开渲染 API；保留原生展示"
			: "open-tui: compact tool presentation requires the Pi 1.1.0 public renderer API; retaining native presentation", "warning");
	};
	let active = false;
	let lastCtx: ExtensionContext | undefined;
	let requestFooterRender: (() => void) | undefined;
	let stopWorklineRefresh: (() => void) | undefined;
	let cleanupFooter: (() => void) | undefined;
	let editor: ReturnType<typeof installEditor> | undefined;
	let pendingUiChange: PendingUiChange | undefined;

	const renderUi = () => editor?.requestRender();
	const peekController = new PeekController({
		getConfig: () => config,
		getEditor: () => editor,
		getContext: () => lastCtx,
		isActive: () => active,
		isTuiContext,
		lifecycle: sessionLifecycle,
		refresh,
		requestRender: renderUi,
	});

	const gitRefresh = new LatestRefresh<typeof state.git>((git) => {
		state.git = git;
		requestFooterRender?.();
	});
	const runtimeRefresh = new LatestRefresh<typeof state.runtime>((runtime) => {
		state.runtime = runtime;
		requestFooterRender?.();
	});

	const getThinkingLevel = () => (sessionLifecycle.isCurrent() ? pi.getThinkingLevel() : "off");

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
				{
					getConfig: () => config,
					unavailable: () => ctx.ui.notify(config.settingsLanguage === "zh"
						? "open-tui：当前宿主不支持紧凑用户／技能消息布局；保留原生消息"
						: "open-tui: compact User/skill message layout unavailable on this host; retaining native messages", "warning"),
				},
				(targetChanged) => peekController.refreshLayout(targetChanged),
			);
			active = true;
			if (state.workingSince !== undefined) startWorkingTimer();
		}
	};

	const uninstallUi = (ctx: ExtensionContext) => {
		if (!isTuiContext(ctx)) return;
		if (active) {
			stopWorkingTimer();
			cleanupFooter?.();
			editor?.cleanup();
			cleanupFooter = undefined;
			editor = undefined;
			requestFooterRender = undefined;
			peekController.resetAndClear(ctx);
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
		if (!sessionLifecycle.isCurrent() || !active || !config.enabled || state.workingSince === undefined) return;
		refresh.requestRender(renderUi);
		stopWorklineRefresh = refresh.subscribe(250, () => refresh.requestRender(renderUi));
	};

	const stopWorkingTimer = () => {
		stopWorklineRefresh?.();
		stopWorklineRefresh = undefined;
	};

	pi.on("session_start", async (_event, ctx) => {
		sessionLifecycle.start();
		refresh.reset();
		pendingUiChange = undefined;
		peekController.startSession();
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
		toolPresentation.startSession(isTuiContext(ctx));
		toolPresentationWarningShown = false;
		notifyToolPresentationCapability(ctx);
		peekController.clearLabel(ctx);

		applyUi(ctx);

		refreshInteractiveState(ctx, true);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		sessionLifecycle.shutdown();
		refresh.reset();
		toolPresentation.shutdown();
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
		peekController.startTask();
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
		peekController.messageStart(event.message, ctx);
	});

	pi.on("message_update", (event, ctx) => {
		turnTelemetry.handle(event);
		peekController.messageUpdate(event.message, ctx);
	});

	pi.on("tool_execution_start", (event) => {
		turnTelemetry.handle(event);
		if (sessionLifecycle.isCurrent()) toolPresentation.start(event.toolCallId, event.parentToolCallId);
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
		peekController.settled(ctx);
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
		peekController.messageEnd(event.message, ctx);
		invalidateUsageCache();
		refreshInteractiveState(ctx);
	});

	pi.on("tool_execution_end", (_event, ctx) => {
		toolPresentation.end(_event.toolCallId);
		refreshInteractiveState(ctx, true);
	});

	pi.on("session_compact", (_event, ctx) => {
		if (!sessionLifecycle.isCurrent()) return;
		invalidateUsageCache();
		refreshInteractiveState(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		if (!sessionLifecycle.isCurrent()) return;
		refresh.reset();
		stopWorkingTimer();
		toolPresentation.reset();
		runOutcome.reset();
		turnTelemetry.reset();
		worklineTelemetry = undefined;
		peekController.startTask();
		peekController.resetAndClear(ctx);
		editor?.requestRender();
		invalidateUsageCache();
		refreshInteractiveState(ctx);
	});

	registerSettingsCommand(pi, {
		getConfig: () => config,
		onConfigChanged: (newConfig) => {
			const cursorStyleChanged = config.cursorStyle !== newConfig.cursorStyle;
			const borderStyleChanged = config.editorBorderStyle !== newConfig.editorBorderStyle;
			const previousPeekLines = config.thinkingPeek.lines;
			try {
				saveConfig(newConfig);
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				lastCtx?.ui.notify(newConfig.settingsLanguage === "zh"
					? `open-tui：设置仅在本次会话生效，保存失败：${detail}`
					: `open-tui: settings applied for this session only; save failed: ${detail}`, "warning");
			}
			config = newConfig;
			toolPresentation.configChanged();
			startWorkingTimer();
			editor?.requestRender();
			peekController.configChanged(previousPeekLines, lastCtx);
			if (cursorStyleChanged && active && editor) {
				editor.setCursorStyle(newConfig.cursorStyle);
			}
			if (borderStyleChanged && active && editor) {
				editor.setBorderStyle(newConfig.editorBorderStyle);
			}
			if (lastCtx) {
				pendingUiChange = getPendingUiChange(newConfig.enabled, active);
				notifyToolPresentationCapability(lastCtx);
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
