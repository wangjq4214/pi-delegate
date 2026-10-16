import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { OpenTuiConfig } from "./config.ts";
import { resolveGlyphs } from "./icons.ts";
import { buildPeekLabel, collectPeekParts, createPeekState, reducePeek, type ThinkingOutcome } from "./peek.ts";
import type { SessionLifecycle } from "./session-lifecycle.ts";
import type { UiRefresh } from "./ui-refresh.ts";

const HIDDEN_THINKING_HORIZONTAL_PADDING = 2;
const HIDDEN_THINKING_SCROLLBAR_RESERVE = 1;

export interface PeekLabelEditor {
	getViewportWidth(): number | undefined;
	getWorkingSpinner?(): string | undefined;
	setLatestHiddenThinkingLabel(label: string, requestRender?: boolean): boolean;
	resetHiddenThinkingLabelTarget(): void;
}
interface PeekControllerOptions {
	getConfig(): Pick<OpenTuiConfig, "enabled" | "thinkingPeek" | "icons" | "settingsLanguage">;
	getEditor(): PeekLabelEditor | undefined;
	getContext(): ExtensionContext | undefined;
	isActive(): boolean;
	isTuiContext(ctx: ExtensionContext): boolean;
	lifecycle: SessionLifecycle;
	refresh: UiRefresh;
	requestRender(): void;
	now?: () => number;
}
interface PeekMessage { role?: string; content?: unknown; stopReason?: string }

function terminalOutcome(message: PeekMessage, ctx: ExtensionContext): ThinkingOutcome {
	if (message.stopReason === "aborted") return "interrupted";
	if (message.stopReason === "error") return "failed";
	if (message.stopReason === "stop" || message.stopReason === "toolUse") return "completed";
	return ctx.signal?.aborted ? "interrupted" : "ended";
}

/** Owns one assistant's bounded title window, measurement, and native label target. */
export class PeekController {
	private peek = createPeekState();
	private frame = 0;
	private unsubscribe: (() => void) | undefined;
	private thinkingStartMs: number | undefined;
	private labelActive = false;
	// Historical component labels survive message-local resets, but disable/teardown must restore them.
	private labelsApplied = false;
	private warningShown = false;
	private activeCtx: ExtensionContext | undefined;
	private lastLabel: string | undefined;
	private lastEditor: PeekLabelEditor | undefined;
	private readonly options: PeekControllerOptions;
	private readonly now: () => number;

	constructor(options: PeekControllerOptions) {
		this.options = options;
		this.now = options.now ?? (() => performance.now());
	}

	startSession(): void {
		this.warningShown = false;
		this.reset();
	}

	startTask(): void {
		// An abandoned earlier segment must not keep measuring a new task's preparation.
		if (this.peek.phase === "thinking") this.finish("ended");
	}

	resetAndClear(ctx?: ExtensionContext): void {
		// Keep the captured context available until its native label has been reset.
		this.clearLabel(ctx);
		this.reset();
	}

	clearLabel(ctx?: ExtensionContext): void {
		this.stopTicker();
		if (!this.labelsApplied) return;
		const target = ctx ?? this.activeCtx ?? this.options.getContext();
		if (!target || !this.options.isTuiContext(target)) return;
		target.ui.setHiddenThinkingLabel();
		this.labelsApplied = false;
		this.labelActive = false;
		this.lastLabel = undefined;
		this.lastEditor = undefined;
	}

	messageStart(message: PeekMessage | undefined, ctx: ExtensionContext): void {
		if (!this.options.lifecycle.isCurrent() || this.isAgentIdle(ctx)) return;
		if (message?.role === "user" || message?.role === "assistant") {
			// Final labels belong to their native message components, not to the next message.
			// A global native-label reset would erase every earlier summary too.
			if (this.peek.phase === "thinking") this.finish("ended");
			this.reset();
		}
	}

	messageUpdate(message: PeekMessage | undefined, ctx: ExtensionContext): void {
		if (!this.options.lifecycle.isCurrent() || this.isAgentIdle(ctx) || !this.isEnabled() || !this.options.isTuiContext(ctx)) return;
		if (message?.role !== "assistant" || this.peek.phase === "done") return;
		this.activeCtx = ctx;
		const parts = collectPeekParts(message.content);
		if (parts.thinking && this.thinkingStartMs === undefined) this.thinkingStartMs = this.now();
		this.peek = reducePeek(this.peek, parts, this.elapsed());
		if (this.peek.phase === "thinking") this.startTicker();
		else this.stopTicker();
		this.setLabel(ctx);
	}

	messageEnd(message: PeekMessage | undefined, ctx: ExtensionContext): void {
		if (!this.options.lifecycle.isCurrent() || message?.role !== "assistant" || this.peek.phase === "idle") return;
		this.activeCtx = ctx;
		const outcome = terminalOutcome(message, ctx);
		// Answer text already established that thinking ended normally; don't replace
		// that evidence with an absent final stop reason. Explicit errors still win.
		if (this.peek.phase === "done" && outcome === "ended" && !message.stopReason) return;
		this.finish(outcome, ctx);
	}

	settled(ctx: ExtensionContext): void {
		if (!this.options.lifecycle.isCurrent() || this.peek.phase !== "thinking") return;
		// Settlement is immediate and neutral without message-level completion evidence.
		// No delayed cleanup can later erase a replacement message's tree.
		this.finish(ctx.signal?.aborted ? "interrupted" : "ended", ctx);
	}

	configChanged(_previousLines: number, ctx?: ExtensionContext): void {
		if (!this.isEnabled()) this.resetAndClear(ctx);
		else if (this.labelActive) this.setLabel(ctx);
	}

	/** Called by the existing editor render lifecycle, including resize of a frozen summary. */
	refreshLayout(targetChanged = false): void {
		if (targetChanged) { this.lastLabel = undefined; this.lastEditor = undefined; }
		if (this.labelActive) this.setLabel();
	}

	tick(ctx?: ExtensionContext): void {
		if (!this.isEnabled() || this.peek.phase !== "thinking") {
			this.stopTicker();
			return;
		}
		if (ctx) this.activeCtx = ctx;
		this.frame++;
		this.peek.elapsedMs = this.elapsed();
		this.setLabel(ctx);
	}

	private finish(outcome: ThinkingOutcome, ctx?: ExtensionContext): void {
		this.stopTicker();
		if (this.peek.phase === "thinking") this.peek.elapsedMs = this.elapsed();
		this.peek.phase = "done";
		this.peek.outcome = outcome;
		this.setLabel(ctx);
	}

	private elapsed(): number | undefined {
		return this.thinkingStartMs === undefined ? undefined : Math.max(0, this.now() - this.thinkingStartMs);
	}

	private startTicker(): void {
		if (this.unsubscribe) return;
		const generation = this.options.lifecycle.currentGeneration();
		this.unsubscribe = this.options.refresh.subscribe(250, () => {
			if (!this.options.lifecycle.isCurrent(generation)) this.stopTicker();
			else this.tick();
		});
	}

	private stopTicker(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
	}

	private reset(): void {
		this.stopTicker();
		this.peek = createPeekState();
		this.labelActive = false;
		this.thinkingStartMs = undefined;
		this.activeCtx = undefined;
		this.lastLabel = undefined;
		this.lastEditor = undefined;
		this.options.getEditor()?.resetHiddenThinkingLabelTarget();
	}

	private isEnabled(): boolean {
		const config = this.options.getConfig();
		return this.options.lifecycle.isCurrent() && config.enabled && config.thinkingPeek.lines > 0 && this.options.isActive();
	}

	private setLabel(ctx?: ExtensionContext): void {
		if (!this.isEnabled() || this.peek.phase === "idle") return;
		const target = ctx ?? this.activeCtx ?? this.options.getContext();
		if (!target || !this.options.isTuiContext(target)) { this.stopTicker(); return; }
		const editor = this.options.getEditor();
		const columns = editor?.getViewportWidth();
		if (columns !== undefined && Number.isFinite(columns) && editor) {
			const config = this.options.getConfig();
			const label = buildPeekLabel(this.peek, this.frame, resolveGlyphs(config.icons.mode),
				Math.max(1, columns - HIDDEN_THINKING_HORIZONTAL_PADDING - HIDDEN_THINKING_SCROLLBAR_RESERVE), config.settingsLanguage, this.peek.phase === "thinking" ? editor.getWorkingSpinner?.() : undefined);
			if (label === this.lastLabel && editor === this.lastEditor) return;
			if (editor.setLatestHiddenThinkingLabel(label, false)) {
				this.labelActive = true;
				this.labelsApplied = true;
				this.lastLabel = label;
				this.lastEditor = editor;
				if (this.peek.phase === "thinking") this.startTicker();
				this.options.refresh.requestRender(this.options.requestRender);
				return;
			}
		}
		this.stopTicker();
		this.lastLabel = undefined;
		this.lastEditor = undefined;
		if (!this.warningShown) {
			this.warningShown = true;
			target.ui.notify("open-tui: thinking peek unavailable on this host; retaining the native label", "warning");
		}
	}

	/** False during session-restore replay; absent/throwing probes retain native compatibility. */
	private isAgentIdle(ctx: ExtensionContext): boolean {
		try {
			return (ctx as ExtensionContext & { isIdle?: () => boolean }).isIdle?.() === true;
		} catch {
			return false;
		}
	}
}
