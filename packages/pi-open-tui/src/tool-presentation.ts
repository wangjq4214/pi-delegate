import * as host from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, Theme, ThemeColor, ToolRenderers, ToolRendererResolver } from "@earendil-works/pi-coding-agent";
import { type Component, Box, Container, Spacer, Text, getCapabilities, imageFallback } from "@earendil-works/pi-tui";
import { UiRefresh } from "./ui-refresh.ts";
import { getToolMessageLayout, type OpenTuiConfig } from "./config.ts";
import { MessageRail, ToolBoxFrame, borderFrameOptions } from "./message-layout.ts";
import {
	type Result, type Status, argumentsText, clean, finite, toolPolicy, statusColor,
	renderCallSummary, renderChildActivity, compactContent, compactDiffLines, defaultOutputLines,
	renderNotices, withoutResultNotices, expansionHint, truncateSummary, CHILD_SUMMARY_NOTE,
} from "./tool-presentation-policy.ts";

// Keep the existing helper exports available to consumers.
export { codemodeCalls, selectChildren } from "./tool-presentation-policy.ts";

type ToolRenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
const CARD = Symbol("open-tui-tool-card");

/** Native identity gates only tool-specific enhancements, never basic styling eligibility. */
function nativeRenderers(): Map<string, ToolRenderers & { parameters: unknown }> {
	const cwd = process.cwd();
	const definitions = [
		host.createReadToolDefinition(cwd), host.createBashToolDefinition(cwd),
		host.createEditToolDefinition(cwd), host.createWriteToolDefinition(cwd),
		host.createGrepToolDefinition(cwd), host.createFindToolDefinition(cwd), host.createLsToolDefinition(cwd),
	];
	const native = new Map<string, ToolRenderers & { parameters: unknown }>(definitions.map((tool) => [tool.name, tool as ToolRenderers & { parameters: unknown }]));
	// Capture a definition on a capture-only stub, not the real API: no tools are re-registered or executed.
	host.createCodemodeExtension()({ registerTool: (tool: { name: string } & ToolRenderers & { parameters: unknown }) => native.set(tool.name, tool) } as unknown as ExtensionAPI);
	return native;
}

/** Compose actual children, rather than flattening their lines and losing mouse/focus routing. */
class ToolContainer extends Container {
	private readonly components: () => Component[];
	constructor(components: () => Component[]) {
		super();
		this.components = components;
	}
	override render(width: number): string[] {
		this.children = this.components();
		return super.render(width);
	}
}

interface CardState {
	epoch: number;
	result?: Result;
	nativeCall?: Component;
	nativeResult?: Component;
}
interface LiveCall { started: number; invalidate?: () => void; finishNative?: () => void }

/** Session-scoped evidence only. Results and child records remain owned by the host's parent result. */
export class ToolPresentation {
	private readonly live = new Map<string, LiveCall>();
	private unsubscribe: (() => void) | undefined;
	private epoch = 0;
	private interactive = false;
	readonly available: boolean;
	readonly resolver: ToolRendererResolver | undefined;

	private readonly getConfig: () => OpenTuiConfig;
	private readonly now: () => number;
	private readonly refresh: UiRefresh;

	constructor(getConfig: () => OpenTuiConfig, pi: ExtensionAPI, now = () => performance.now(), refresh = new UiRefresh()) {
		this.getConfig = getConfig;
		this.now = now;
		this.refresh = refresh;
		this.available = typeof pi.registerToolRenderer === "function";
		if (!this.available) return;
		const native = nativeRenderers();
		this.resolver = (name, next) => {
			const base = next();
			const expected = native.get(name);
			// Shell factories allocate closures: require both the native schema reference and
			// native function source. All other tools use exact renderer function identity.
			const sameFunctions = base && expected && (base.renderCall === expected.renderCall && base.renderResult === expected.renderResult
				|| name === "bash" && base.renderCall?.toString() === expected.renderCall?.toString()
					&& base.renderResult?.toString() === expected.renderResult?.toString()
					&& pi.getAllTools().some((tool) => tool.name === name && tool.parameters === expected.parameters));
			const recognized = !!base && !!expected && base.renderShell === expected.renderShell && !!sameFunctions;
			return this.compose(name, base ?? {}, recognized);
		};
		pi.registerToolRenderer(this.resolver);
	}

	startSession(interactive: boolean): void { this.reset(); this.interactive = interactive; }
	reset(): void {
		this.epoch++;
		for (const call of this.live.values()) call.finishNative?.();
		this.live.clear(); this.stopTimer();
	}
	shutdown(): void { this.reset(); this.interactive = false; }
	start(id: string, parentId?: string): void {
		if (!this.available || !this.interactive || parentId) return;
		this.live.set(id, { started: this.now() });
		this.configChanged();
	}
	end(id: string): void {
		this.live.get(id)?.finishNative?.();
		this.live.delete(id);
		this.configChanged();
	}
	private stopTimer(): void { this.unsubscribe?.(); this.unsubscribe = undefined; }

	configChanged(): void {
		const needed = this.enhanced() && this.interactive && Array.from(this.live.values()).some((call) => call.invalidate);
		if (!needed) this.stopTimer();
		else if (!this.unsubscribe) this.unsubscribe = this.refresh.subscribe(500, () => {
			if (!this.enhanced()) { this.stopTimer(); return; }
			// Public host invalidation also marks cached components dirty. Keep it;
			// the host coalesces its own frame requests, and we deduplicate channels.
			for (const call of this.live.values()) if (call.invalidate) this.refresh.requestRender(call.invalidate);
		});
	}
	private enhanced(): boolean { const config = this.getConfig(); return config.enabled && config.toolPresentation; }

	private card(context: ToolRenderContext): CardState {
		const state = context.state as Record<symbol, CardState>;
		return state[CARD] ??= { epoch: this.epoch };
	}
	private status(context: ToolRenderContext): Status {
		return context.isPartial ? context.executionStarted ? "running" : "pending" : context.isError ? "error" : "ok";
	}
	private elapsed(context: ToolRenderContext, state: CardState): number | undefined {
		if (finite(context.durationMs)) return context.durationMs;
		const live = state.epoch === this.epoch && context.isPartial ? this.live.get(context.toolCallId) : undefined;
		return live ? Math.max(0, this.now() - live.started) : undefined;
	}

	private nativeContext(name: string, context: ToolRenderContext, state: CardState): ToolRenderContext {
		// A detached shell card may render again after navigation. Do not let native live
		// state resurrect its timer or borrow observations from the replacement session.
		return name === "bash" && state.epoch !== this.epoch
			? { ...context, state: {}, executionStarted: false }
			: context;
	}
	private nativeResult(name: string, base: ToolRenderers, result: Result, options: Parameters<NonNullable<ToolRenderers["renderResult"]>>[1], theme: Theme, context: ToolRenderContext, state: CardState): Component {
		state.nativeResult = base.renderResult!(result, options, theme, { ...this.nativeContext(name, context, state), lastComponent: state.nativeResult });
		const live = state.epoch === this.epoch ? this.live.get(context.toolCallId) : undefined;
		if (name === "bash" && live && options.isPartial) {
			// Native shell rendering owns a refresh timer. Finalize it even when a branch/session
			// drops this component before the host can deliver its final result to the UI.
			live.finishNative = () => {
				base.renderResult!({ content: [], details: undefined }, { expanded: false, isPartial: false }, theme,
					{ ...context, isPartial: false, lastComponent: state.nativeResult });
			};
		}
		return state.nativeResult;
	}
	private frame(component: Component, context: ToolRenderContext, state: CardState, nativeShell: ToolRenderers["renderShell"], call: boolean, theme: Theme): Component {
		return new ToolContainer(() => {
			const config = this.getConfig();
			if (config.enabled && config.toolBoxBorder?.enabled) {
				const isAscii = config.icons.mode === "ascii";
				const borderCfg = config.toolBoxBorder;
				const paint = (text: string) => {
					if (borderCfg.colorMode === "static") {
						return theme.fg((borderCfg.color as ThemeColor) || "muted", text);
					}
					return theme.fg(statusColor(this.status(context)), text);
				};
				const showTop = call && borderCfg.top.enabled;
				const showBottom = (!call || !state.result) && borderCfg.bottom.enabled;
				return [new ToolBoxFrame(component, {
					...borderFrameOptions(borderCfg, isAscii, paint),
					top: showTop, bottom: showBottom,
				})];
			}
			if (config.enabled && getToolMessageLayout(config) === "compact") {
				// Dormant legacy box colors must not change a rail merely on upgrade.
				const color = config.toolMessageLayout !== undefined && config.toolBoxBorder.colorMode === "static"
					? (config.toolBoxBorder.color as ThemeColor) || "muted" : statusColor(this.status(context));
				return [new MessageRail(component, (text) => theme.fg(color, text), config.icons.mode === "ascii" ? "|" : "┃")];
			}
			if (nativeShell === "self") return [component];
			// Reproduce the host default shell across the call/result sections. The host
			// supplies one leading message gap; only the call has top padding and only
			// the final section has bottom padding. No private tool component patch.
			const bg = context.isPartial ? "toolPendingBg" : context.isError ? "toolErrorBg" : "toolSuccessBg";
			const box = new Box(context.outputPad, 0, (text) => theme.bg(bg, text));
			if (call) box.addChild(new Spacer(1));
			box.addChild(component);
			if (!call || !state.result) box.addChild(new Spacer(1));
			return [box];
		});
	}
	private compose(name: string, base: ToolRenderers, recognized: boolean): ToolRenderers {
		const renderCall = (args: unknown, theme: Theme, context: ToolRenderContext, state: CardState): Component => {
			try {
				state.nativeCall = base.renderCall?.(args, theme, {
					...(recognized ? this.nativeContext(name, context, state) : context), lastComponent: state.nativeCall,
				});
			} catch { state.nativeCall = undefined; } // Preserve the host's renderer-callback fallback.
			if (recognized && name === "edit" && context.expanded && getToolMessageLayout(this.getConfig()) === "compact" && state.result && base.renderResult) {
				// Native edit results populate the call-owned diff. Synchronize it before
				// drawing the first expanded frame after the successful preview was hidden.
				try {
					this.nativeResult(name, base, state.result, { expanded: true, isPartial: context.isPartial }, theme, context, state);
				} catch { state.nativeResult = undefined; }
			}
			return state.nativeCall ?? new Text(`${theme.fg("toolTitle", theme.bold(clean(name)))}\n${argumentsText(args, context.expanded || !this.enhanced())}`, 0, 0);
		};
		const defaultResult = (result: Result, options: Parameters<NonNullable<ToolRenderers["renderResult"]>>[1], theme: Theme, context: ToolRenderContext): Component => {
			// Generic details also recover raw parent content omitted by a specialized renderer.
			// Images themselves remain owned by ToolExecutionComponent.
			const lines = defaultOutputLines(result, options.expanded || !this.enhanced());
			if (!context.showImages || !getCapabilities().images) {
				for (const part of result.content) if (part.type === "image") lines.push(imageFallback(part.mimeType));
			}
			return new Text(lines.map((line) => theme.fg(context.isError ? "error" : "toolOutput", line)).join("\n"), 0, 0);
		};
		const renderResult = (result: Result, options: Parameters<NonNullable<ToolRenderers["renderResult"]>>[1], theme: Theme, context: ToolRenderContext, state: CardState): Component => {
			if (base.renderResult) {
				try {
					if (recognized) return this.nativeResult(name, base, result, options, theme, context, state);
					state.nativeResult = base.renderResult(result, options, theme, { ...context, lastComponent: state.nativeResult });
					return state.nativeResult;
				} catch { state.nativeResult = undefined; }
			}
			return defaultResult(result, options, theme, context);
		};
		return {
			...base,
			// Self framing allows a live layout toggle; normal mode reconstructs the
			// original default shell, or passes through an existing self renderer.
			renderShell: "self",
			renderCall: (args, theme, context) => {
				const state = this.card(context);
				const live = state.epoch === this.epoch ? this.live.get(context.toolCallId) : undefined;
				if (live) { live.invalidate = context.invalidate; this.configChanged(); }
				return this.frame(new ToolContainer(() => {
					if (!this.enhanced()) return [renderCall(args, theme, context, state)];
					const special = toolPolicy(name, args, recognized, state.result).special;
					const header: Component = {
						invalidate() {},
						render: (width) => {
							return renderCallSummary({
								name, args, special, result: state.result && getToolMessageLayout(this.getConfig()) === "compact" && !context.expanded
									? withoutResultNotices(state.result) : state.result,
								isPartial: context.isPartial, isError: context.isError, status: this.status(context),
								elapsedMs: this.elapsed(context, state),
								hideOutput: getToolMessageLayout(this.getConfig()) === "compact" && !context.expanded && !context.isError,
								scriptHint: special && name === "codemode" && !state.result ? host.keyHint("app.tools.expand", "to expand script") : "",
							}, theme, this.getConfig().icons.mode, width);
						},
					};
					// Do not flatten custom components: they may own buttons, focus or mouse regions.
					const details = context.expanded && !special && base.renderCall ? [new Text(argumentsText(args, true), 0, 0)] : [];
					return [header, ...details, ...(context.expanded || !special && base.renderCall ? [renderCall(args, theme, context, state)] : [])];
				}), context, state, base.renderShell, true, theme);
			},
			renderResult: (result, options, theme, context) => {
				const state = this.card(context);
				state.result = result;
				if (recognized && name === "bash" && !options.isPartial && state.nativeResult) renderResult(result, options, theme, context, state);
				return this.frame(new ToolContainer(() => {
					const { special, calls } = toolPolicy(name, context.args, recognized, result);
					if (!this.enhanced() || options.expanded) {
						const note = this.enhanced() && calls ? new Text(theme.fg("muted", CHILD_SUMMARY_NOTE), 0, 0) : undefined;
						const raw = this.enhanced() && options.expanded && !special && base.renderResult
							? [defaultResult(result, options, theme, context)] : [];
						const notices: Component[] = this.enhanced() && options.expanded && getToolMessageLayout(this.getConfig()) === "compact"
							? [{ invalidate() {}, render: (width) => renderNotices(result, theme, width) }] : [];
						return [...(note ? [note] : []), ...raw, renderResult(result, options, theme, context, state), ...notices];
					}
					const compact = getToolMessageLayout(this.getConfig()) === "compact";
					const displayed = compact ? withoutResultNotices(result) : result;
					const hideOutput = compact && !options.isPartial && !context.isError;
					const body: Component[] = [];
					// Preserve a third-party renderer's own compact presentation and actual controls.
					if (!hideOutput && !special && base.renderResult) body.push(renderResult(displayed, options, theme, context, state));
					const preview: Component = {
						invalidate() {},
						render: (width) => {
							const lines = renderChildActivity(calls, theme, this.getConfig().icons.mode, width, compact);
							const content = hideOutput ? { kind: "output" as const, lines: [] }
								: compactContent(name, special, displayed, options.isPartial, context.isError, calls);
							if (content.kind === "diff") {
								const diff = new Text(host.renderDiff(content.diff), 0, 0).render(width);
								lines.push(...compactDiffLines(diff, theme));
							} else if (content.kind === "native-edit") {
								lines.push(...renderResult(displayed, options, theme, context, state).render(width));
							} else {
								lines.push(...content.lines.map((line) => theme.fg(context.isError ? "error" : "toolOutput", line)));
							}
							if (!base.renderResult && (!context.showImages || !getCapabilities().images)) {
								for (const part of result.content) if (part.type === "image") lines.push(imageFallback(part.mimeType));
							}
							if (!compact) lines.push(...renderNotices(result, theme, width));
							lines.push(theme.fg("dim", expansionHint(calls, host.keyHint("app.tools.expand", "to expand"))));
							return lines.map((line) => truncateSummary(line, width));
						},
					};
					return [preview, ...body];
				}), context, state, base.renderShell, false, theme);
			},
		};
	}
}
