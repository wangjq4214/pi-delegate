import type { ExtensionAPI, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { getUserBoxBorder, getUserMessageLayout, type OpenTuiConfig } from "./config.ts";
import { roundedBorder, type WorkingStatusIndicator } from "./editor.ts";
import { borderFrameOptions, MessageRail, ToolBoxFrame } from "./message-layout.ts";
import { fallbackSpinner } from "./spinner.ts";
import type { UiRefresh } from "./ui-refresh.ts";
import { createWorklineRenderer } from "./workline.ts";

interface SideRun {
	status: string;
	startedAt: number;
	finishedAt?: number;
}

interface SideChatPresentation {
	userKey: string;
	user(width: number, render: (width: number) => string[]): string[];
	composer(width: number, rows: number, render: (width: number) => string, paint: (text: string) => string, run?: SideRun): string[];
}

export function registerSideChatPresentation(
	pi: ExtensionAPI,
	getActiveConfig: () => OpenTuiConfig | undefined,
	getTheme: () => Theme | undefined,
	refresh: Pick<UiRefresh, "subscribe" | "requestRender">,
): void {
	// Request/response over Pi's event bus; neither extension imports the other.
	pi.events?.on?.("@wangjq4214/pi-open-tui:side-chat-presentation:v2", (value) => {
		const request = value as {
			reply?: (style: SideChatPresentation) => void;
			tick?: () => void;
			start?: (stop: () => void) => void;
		} | null;
		if (typeof request?.reply !== "function") return;
		const config = getActiveConfig();
		const theme = getTheme();
		if (!config || !theme) return;
		if (request.tick && request.start) {
			const tick = request.tick;
			request.start(refresh.subscribe(250, () => refresh.requestRender(tick)));
		}

		const border = getUserBoxBorder(config);
		const compact = getUserMessageLayout(config) === "compact";
		const ascii = config.icons.mode === "ascii";
		const borderPaint = (text: string) => theme.fg(
			border.colorMode === "static" ? (border.color as ThemeColor) || "muted" : "userMessageText", text,
		);
		request.reply({
			userKey: JSON.stringify([border, compact, ascii]),
			user(width, render) {
				if (width < 6 || (!border.enabled && !compact)) return render(width);
				const body = { render: (w: number) => render(w), invalidate() {} };
				return border.enabled
					? new ToolBoxFrame(body, borderFrameOptions(border, ascii, borderPaint)).render(width)
					: new MessageRail(body, borderPaint, ascii ? "|" : "┃").render(width);
			},
			composer(width, rows, render, paint, run) {
				const outcome = run?.status === "completed" ? "completed" : run?.status === "failed" ? "failed"
					: run?.status === "cancelled" ? "interrupted" : "ended";
				const now = Date.now();
				const workline = run && createWorklineRenderer(() => ({
					workingSince: run.finishedAt === undefined ? run.startedAt : undefined,
					lastRun: run.finishedAt === undefined ? undefined : { outcome, elapsedMs: run.finishedAt - run.startedAt },
				}), () => config, () => theme, () => now);
				const spinner = fallbackSpinner(Math.floor(now / 250), ascii);
				const native: WorkingStatusIndicator | undefined = run?.finishedAt === undefined && run ? {
					kind: "working",
					renderInBorder: () => `${spinner} ${run.status}`,
					renderSpinnerInBorder: () => spinner,
				} : undefined;
				const status = (w: number, tiny = false) => workline?.render(w, native, tiny) ?? "";
				if (width < 8 || rows < 5) {
					const line = rows >= 3 ? status(width) : "";
					return line ? [line, render(width)] : [render(width)];
				}
				const style = config.editorBorderStyle;
				const rail = style === "minimal" ? " " : paint("│");
				const input = truncateToWidth(render(width - 4), width - 4, "");
				const attached = config.workline.attachToBorder;
				const detached = !attached && rows >= 6 ? status(width - 2) : "";
				const indicator = attached || (run && rows < 6) ? {
					renderInBorder: (w: number) => status(w),
					renderSpinnerInBorder: (w: number) => status(w, true),
				} : undefined;
				return [
					...(detached ? [`  ${detached}`] : []),
					roundedBorder(width, "top", paint, undefined, indicator, style),
					`${rail} ${input}${" ".repeat(Math.max(0, width - 4 - visibleWidth(input)))} ${rail}`,
					roundedBorder(width, "bottom", paint, undefined, undefined, style),
				];
			},
		});
	});
}
