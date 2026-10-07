import type { ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { hostname as osHostname } from "node:os";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { OpenTuiConfig } from "./config.ts";
import type { InlineFooterLine, InlineFooterLines } from "./editor.ts";
import type { IconGlyphs } from "./icons.ts";
import { resolveGlyphs, resolveIconMode, runtimeSymbol } from "./icons.ts";
import type { GitStatus } from "./git.ts";
import type { RuntimeInfo } from "./runtime.ts";
import {
	alignRight,
	basenamePath,
	cacheHitColor,
	effortColor,
	fitSegmentsByPriority,
	fmtTokens,
	formatCwd,
	formatInputBreakdown,
	hasAnsiStyles,
	providerColor,
	sanitizeStatusPreservingStyles,
	stressColor,
	truncateBranch,
	truncatePath,
	type PrioritizedSegment,
} from "./utils.ts";
import type { FooterState, ModelMeta, UsageTotals } from "./state.ts";
import { getUsageTotals } from "./state.ts";
export type { InlineFooterLine, InlineFooterLines } from "./editor.ts";

export function shortHostname(hostname: string): string {
	return hostname.split(".")[0] ?? "";
}

function renderBar(theme: Theme, pct: number, barWidth: number, ascii: boolean): string {
	const filled = Math.max(0, Math.min(barWidth, Math.round((pct / 100) * barWidth)));
	const empty = barWidth - filled;
	const color = stressColor(pct);
	const filledCell = ascii ? "#" : "█";
	const emptyCell = ascii ? "-" : "░";
	return (
		theme.fg("dim", "[") +
		theme.fg(color, filledCell.repeat(filled)) +
		theme.fg("dim", emptyCell.repeat(empty)) +
		theme.fg("dim", "]")
	);
}

/** Compact context form: icon + percentage, no bar or token counts. */
function renderContextCompact(theme: Theme, ctx: ExtensionContext, glyphs: IconGlyphs): string {
	const contextUsage = ctx.getContextUsage();
	const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	if (contextWindow <= 0) return "";
	const contextPct = contextUsage?.percent ?? 0;
	return `${theme.fg(stressColor(contextPct), glyphs.context)} ${theme.fg(stressColor(contextPct), `${contextPct.toFixed(1)}%`)}`;
}

function renderGitSegment(
	theme: Theme,
	git: GitStatus,
	glyphs: IconGlyphs,
	segments: OpenTuiConfig["footerSegments"],
	maxBranchLen = 20,
): string {
	const parts: string[] = [];
	if (segments.gitBranch) {
		if (git.branch) {
			parts.push(theme.fg("mdLink", glyphs.git));
			parts.push(theme.fg("mdLink", truncateBranch(git.branch, maxBranchLen)));
		} else if (git.commit?.detached) {
			parts.push(theme.fg("warning", glyphs.git));
			parts.push(theme.fg("warning", "HEAD"));
		}
	}
	if (segments.gitCommit && git.commit?.detached && git.commit.oid) {
		if (!segments.gitBranch) parts.push(theme.fg("warning", glyphs.git));
		const tag = git.commit.tag ? ` ${git.commit.tag}` : "";
		parts.push(theme.fg("dim", `${git.commit.oid.slice(0, 7)}${tag}`));
	}

	if (segments.gitStatus) {
		const statusIcons: string[] = [];
		// ponytail: always show count — `!1` not `!`, so 1 vs 100 is distinguishable.
		const addStatus = (count: number, glyph: string, color: ThemeColor) => {
			if (count > 0) statusIcons.push(theme.fg(color, `${glyph}${count}`));
		};
		addStatus(git.conflicted, glyphs.conflicted, "error");
		addStatus(git.deleted, glyphs.deleted, "error");
		addStatus(git.modified, glyphs.modified, "warning");
		addStatus(git.renamed, glyphs.renamed, "warning");
		addStatus(git.staged, glyphs.staged, "success");
		addStatus(git.untracked, glyphs.untracked, "muted");
		addStatus(git.stashed, glyphs.stashed, "muted");

		if (git.ahead > 0 && git.behind > 0) {
			statusIcons.push(theme.fg("warning", `${glyphs.diverged}${git.ahead}/${git.behind}`));
		} else if (git.ahead > 0) {
			statusIcons.push(theme.fg("success", `${glyphs.ahead}${git.ahead}`));
		} else if (git.behind > 0) {
			statusIcons.push(theme.fg("warning", `${glyphs.behind}${git.behind}`));
		}

		const statusBlock = statusIcons.join(" ");
		if (statusBlock) {
			parts.push(`${theme.fg("dim", "[")}${statusBlock}${theme.fg("dim", "]")}`);
		}
	}

	return parts.join(" ");
}

function renderRuntimeSegment(
	theme: Theme,
	runtime: RuntimeInfo | null,
	iconMode: OpenTuiConfig["icons"]["mode"],
): string {
	if (!runtime) return "";
	const symbol = theme.fg("success", runtimeSymbol(runtime.name, iconMode));
	const version = runtime.version ? theme.fg("muted", runtime.version) : "";
	const label = [symbol, version].filter(Boolean).join(" ");
	return label;
}

function renderContextBar(
	theme: Theme,
	ctx: ExtensionContext,
	width: number,
	glyphs: IconGlyphs,
	iconMode: OpenTuiConfig["icons"]["mode"],
): string {
	const contextUsage = ctx.getContextUsage();
	const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	const contextTokens = contextUsage?.tokens ?? 0;
	const contextPct = contextUsage?.percent ?? 0;

	// ponytail: render 0% bar once we know the window — keeps the right side
	// populated instead of collapsing everything left in an empty session.
	if (contextWindow <= 0) return "";

	const pctText = theme.fg(stressColor(contextPct), `${contextPct.toFixed(1)}%`);
	const ctxText = `${theme.fg("text", fmtTokens(contextTokens))}${theme.fg("dim", "/")}${theme.fg("text", fmtTokens(contextWindow))}`;
	const contextIcon = theme.fg(stressColor(contextPct), glyphs.context);
	// Cap the bar at `width - reserved` (with a floor of 4) so the full form
	// never forces the left segments out before compact/drop logic kicks in.
	const reserved = visibleWidth(contextIcon) + visibleWidth(pctText) + visibleWidth(ctxText) + 5 + 2;
	const barWidth = Math.max(4, Math.min(12, width - reserved));
	return `${contextIcon} ${renderBar(theme, contextPct, barWidth, resolveIconMode(iconMode) === "ascii")} ${pctText} ${theme.fg("dim", "·")} ${ctxText}`;
}

function renderStatsBlock(
	theme: Theme,
	totals: UsageTotals,
	glyphs: IconGlyphs,
	segments: OpenTuiConfig["footerSegments"],
): string {
	const stats: string[] = [];
	if (segments.tokens) {
		stats.push(theme.fg("accent", `${glyphs.input} ${formatInputBreakdown(totals.input, totals.cacheRead)}`));
		stats.push(theme.fg("success", `${glyphs.output} ${fmtTokens(totals.output)}`));
		// ponytail: hide cache-hit rate when the provider never reported cache
		// tokens — avoids a misleading "0%" on providers without prompt caching.
		const hasCacheTokens = totals.cacheRead > 0 || totals.cacheWrite > 0;
		if (hasCacheTokens && totals.latestCacheHitRate !== undefined) {
			stats.push(theme.fg(cacheHitColor(totals.latestCacheHitRate), `${glyphs.cacheHit} ${totals.latestCacheHitRate.toFixed(1)}%`));
		}
	}
	if (segments.cost) {
		stats.push(theme.fg("warning", `${glyphs.cost} $${totals.cost.toFixed(3)}`));
	}

	return stats.join(` ${theme.fg("dim", "|")} `);
}

const ANSI_RESET = "\x1b[0m";

/**
 * Keep the colours an extension applied to its own status text. Plain text stays
 * muted so unstyled statuses keep the quiet footer look. The trailing reset
 * stops an unclosed style from tinting the separator and the next status.
 */
function renderStatusText(theme: Theme, status: string): string {
	if (!hasAnsiStyles(status)) return theme.fg("muted", status);
	return `${status}${ANSI_RESET}`;
}

function renderExtensionStatusLines(
	theme: Theme,
	extensionStatuses: ReadonlyMap<string, string>,
	glyphs: IconGlyphs,
	width: number,
): string[] {
	const statuses = Array.from(extensionStatuses.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, text]) => sanitizeStatusPreservingStyles(text))
		.filter((text) => text.length > 0);
	if (statuses.length === 0) return [];

	const separator = ` ${theme.fg("dim", "|")} `;
	const statusText = statuses.map((status) => renderStatusText(theme, status)).join(separator);
	const line = `${theme.fg("mdLink", glyphs.extensions)} ${statusText}`;
	return wrapTextWithAnsi(line, width);
}

export interface FooterHooks {
	setRequestRender: (fn: (() => void) | undefined) => void;
	scheduleGitRefresh: () => void;
}

/**
 * Split the bottom border content the way `alignRight` splits the plain row:
 * the right block (statistics) survives, the left one (model) shrinks to an
 * ellipsis and only then disappears. Keeps the assembled border inside its
 * budget so editor-side truncation never eats the right corner.
 */
function fitInlineLine(left: string, right: string, width: number, theme: Theme): InlineFooterLine {
	const rightWidth = visibleWidth(right);
	if (rightWidth > width) {
		return { left: "", right: truncateToWidth(right, width, theme.fg("dim", "...")) };
	}
	const availableForLeft = width - rightWidth - 1;
	if (availableForLeft <= 0) return { left: "", right };
	return { left: truncateToWidth(left, availableForLeft, theme.fg("dim", "...")), right };
}

export interface FooterHandle {
	renderInline(width: number): InlineFooterLines | undefined;
	cleanup(): void;
}

function fitInlineSegments(
	parts: readonly PrioritizedSegment[],
	width: number,
	theme: Theme,
): string {
	const separator = theme.fg("dim", " · ");
	const separatorReserve = Math.max(0, parts.length - 1) * Math.max(0, visibleWidth(separator) - 1);
	return fitSegmentsByPriority(
		parts,
		Math.max(0, width - separatorReserve),
		theme.fg("dim", "..."),
	).join(separator);
}

function renderFooterContent(
	ctx: ExtensionContext,
	getState: () => FooterState,
	getConfig: () => OpenTuiConfig,
	getModelMeta: () => ModelMeta,
	theme: Theme,
	width: number,
	inline: boolean,
): InlineFooterLines {
	if (width <= 0) return { top: { left: "", right: "" }, bottom: { left: "", right: "" } };

	const state = getState();
	const config = getConfig();
	const glyphs = resolveGlyphs(config.icons.mode);
	const segments = config.footerSegments;
	const meta = getModelMeta();
	const totals = getUsageTotals(ctx);

	const leftParts: PrioritizedSegment[] = [];
	const inlineTopLeftParts: PrioritizedSegment[] = [];
	const inlineTopRightParts: PrioritizedSegment[] = [];
	if (segments.cwd) {
		const maxCwd = Math.min(30, Math.max(10, Math.floor(width * 0.4)));
		const cwd = formatCwd(ctx.sessionManager.getCwd());
		const cwdPrefix = `${theme.fg("mdLink", glyphs.cwd)} `;
		const accent = (text: string) => theme.fg("accent", text);
		leftParts.push({
			text: `${cwdPrefix}${accent(truncatePath(cwd, maxCwd))}`,
			compactText: `${cwdPrefix}${accent(truncatePath(basenamePath(cwd), maxCwd))}`,
			priority: 0,
			truncate: (_text, maxWidth, ellipsis) => {
				const pathWidth = maxWidth - visibleWidth(cwdPrefix);
				if (pathWidth <= visibleWidth(ellipsis)) {
					return truncateToWidth(`${cwdPrefix}${accent(basenamePath(cwd))}`, maxWidth, ellipsis);
				}
				return `${cwdPrefix}${accent(truncatePath(basenamePath(cwd), pathWidth))}`;
			},
		});
		inlineTopRightParts.push(leftParts.at(-1)!);
	}
	if (segments.hostname) {
		const shortHost = shortHostname(osHostname());
		if (shortHost) {
			leftParts.push({
				text: `${theme.fg("dim", glyphs.host)} ${theme.fg("accent", shortHost)}`,
				priority: 1,
			});
			inlineTopRightParts.push(leftParts.at(-1)!);
		}
	}
	const sessionName = ctx.sessionManager.getSessionName();
	if (sessionName) {
		const sessionPart: PrioritizedSegment = {
			text: `${theme.fg("dim", glyphs.session)} ${theme.fg("text", truncateToWidth(sessionName, 24, theme.fg("dim", "...")))}`,
			priority: 2,
		};
		if (segments.sessionName) {
			leftParts.push(sessionPart);
			inlineTopLeftParts.push(sessionPart);
		}
	}
	const gitSeg = renderGitSegment(theme, state.git, glyphs, segments);
	if (gitSeg) {
		leftParts.push({ text: gitSeg, priority: 3 });
		inlineTopLeftParts.push(leftParts.at(-1)!);
	}
	if (segments.runtime) {
		const runtimeSeg = renderRuntimeSegment(theme, state.runtime, config.icons.mode);
		if (runtimeSeg) {
			leftParts.push({ text: runtimeSeg, priority: 4 });
			inlineTopRightParts.push(leftParts.at(-1)!);
		}
	}

	// The context bar competes with the left segments for the same row:
	// full bar first, then the compact icon+pct form, then dropped.
	let contextText = "";
	let contextCompact: string | undefined;
	if (segments.context) {
		contextText = renderContextBar(theme, ctx, width, glyphs, config.icons.mode);
		const compact = renderContextCompact(theme, ctx, glyphs);
		if (compact && visibleWidth(compact) < visibleWidth(contextText)) {
			contextCompact = compact;
		}
	}
	if (contextText) inlineTopRightParts.push({ text: contextText, compactText: contextCompact, priority: 4 });

	let top: InlineFooterLine;
	if (inline) {
		const left = fitInlineSegments(inlineTopLeftParts, Math.floor(width * 0.45), theme);
		const rightBudget = Math.max(0, width - visibleWidth(left) - (left ? 1 : 0));
		top = { left, right: fitInlineSegments(inlineTopRightParts, rightBudget, theme) };
	} else {
		// Higher numeric priority survives longer: context/runtime outrank cwd.
		const allParts = [...leftParts];
		if (contextText) allParts.push({ text: contextText, compactText: contextCompact, priority: 4 });
		const fitted = fitSegmentsByPriority(allParts, width, theme.fg("dim", "..."));
		const right = contextText ? fitted.pop() ?? "" : "";
		top = { left: fitted.join(" "), right };
	}
	const modelParts: string[] = [];
	modelParts.push(theme.fg("mdLink", glyphs.model));
	if (meta.provider && meta.provider !== "Unknown") {
		modelParts.push(theme.fg(providerColor(ctx.model?.provider ?? "none"), meta.provider));
	}
	modelParts.push(theme.fg("text", meta.model));
	if (meta.effort && meta.effort !== "off") {
		modelParts.push(theme.fg(effortColor(meta.effort), `${glyphs.thinking} ${meta.effort}`));
	}
	const modelBlock = modelParts.join(theme.fg("dim", " · "));
	const statsBlock = renderStatsBlock(theme, totals, glyphs, segments);
	return { top, bottom: fitInlineLine(modelBlock, statsBlock, width, theme) };
}

export function installFooter(
	ctx: ExtensionContext,
	getState: () => FooterState,
	getConfig: () => OpenTuiConfig,
	getModelMeta: () => ModelMeta,
	hooks: FooterHooks,
): FooterHandle {
	let renderInline: (width: number) => InlineFooterLines | undefined = () => undefined;

	ctx.ui.setFooter((tui, theme, footerData) => {
		hooks.setRequestRender(() => tui.requestRender());
		const unsubBranch = footerData.onBranchChange(() => {
			hooks.scheduleGitRefresh();
			tui.requestRender();
		});
		const getContent = (width: number, inline: boolean) => renderFooterContent(
			ctx,
			getState,
			getConfig,
			getModelMeta,
			theme,
			width,
			inline,
		);

		renderInline = (width) => getContent(width, true);

		return {
			dispose() {
				unsubBranch();
				hooks.setRequestRender(undefined);
				renderInline = () => undefined;
			},
			invalidate() {},
			render(width: number): string[] {
				if (width <= 0) return [""];
				const config = getConfig();
				const extensionLines = config.footerSegments.extensionStatuses
					? renderExtensionStatusLines(theme, footerData.getExtensionStatuses(), resolveGlyphs(config.icons.mode), width)
					: [];
				if (config.inlineFooter) return extensionLines;
				const { top, bottom } = getContent(width, false);
				const mainLines = [top, bottom].map((line) =>
					truncateToWidth(alignRight(line.left, line.right, width, theme), width, theme.fg("dim", "...")));
				return [...mainLines, ...extensionLines];
			},
		};
	});

	return {
		renderInline: (width) => renderInline(width),
		cleanup() {
			ctx.ui.setFooter(undefined);
		},
	};
}
