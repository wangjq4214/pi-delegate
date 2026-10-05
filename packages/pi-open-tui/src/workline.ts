import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { OpenTuiConfig } from "./config.ts";
import type { WorkingStatusIndicator, WorklineRenderer } from "./editor.ts";
import { resolveGlyphs } from "./icons.ts";
import type { FooterState } from "./state.ts";
import { formatDuration, stripAnsi } from "./utils.ts";
import { formatTurnTelemetry, type TurnTelemetry } from "./telemetry.ts";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** A moving highlight only: text never changes position or scrolls. */
function sweep(text: string, theme: Theme, now: number): string {
	const cells = Array.from(graphemes.segment(stripAnsi(text)), (part) => part.segment);
	const head = Math.floor(now / 250) % (cells.length + 4);
	return cells.map((cell, index) => theme.fg(index >= head - 3 && index <= head ? "accent" : "muted", cell)).join("");
}

export function createWorklineRenderer(
	getState: () => Pick<FooterState, "workingSince" | "lastDoneIn">,
	getConfig: () => OpenTuiConfig,
	getTheme: () => Theme,
	now: () => number = Date.now,
	getTelemetry: () => TurnTelemetry | undefined = () => undefined,
): WorklineRenderer {
	const render = (width: number, native?: WorkingStatusIndicator, compact = false): string => {
		if (width <= 0) return "";
		// Retry, compaction and branch-summary messages retain their native semantics/colors.
		if (native?.kind && native.kind !== "working") {
			return truncateToWidth(compact ? native.renderSpinnerInBorder(width) : native.renderInBorder(width), width, "");
		}
		const state = getState();
		const config = getConfig();
		const theme = getTheme();
		const glyphs = resolveGlyphs(config.icons.mode);
		const timestamp = now();
		if (state.workingSince !== undefined) {
			const duration = theme.fg("accent", formatDuration(timestamp - state.workingSince));
			const budget = Math.max(0, width - visibleWidth(duration) - 1);
			let label = compact
				? native?.renderSpinnerInBorder(budget) ?? glyphs.working
				: native?.renderInBorder(budget) ?? `${glyphs.working} working`;
			label = truncateToWidth(label, budget, "");
			if (config.workline.marquee && !compact) label = sweep(label, theme, timestamp);
			return truncateToWidth(label ? `${label} ${duration}` : duration, width, "");
		}
		if (state.lastDoneIn !== undefined) {
			const done = theme.fg("success", `${glyphs.done} done ${formatDuration(state.lastDoneIn)}`);
			const telemetry = !config.workline.attachToBorder && config.telemetry.enabled ? getTelemetry() : undefined;
			const result = telemetry ? formatTurnTelemetry(telemetry, theme, config.telemetry, config.icons.mode) : "";
			return truncateToWidth(result ? `${done} ${theme.fg("dim", "|")} ${result}` : done, width, "");
		}
		return truncateToWidth(native?.renderInBorder(width) ?? "", width, "");
	};
	return { attached: () => getConfig().workline.attachToBorder, render };
}
