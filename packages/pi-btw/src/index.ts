import { stripVTControlCharacters } from "node:util";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	type OverlayHandle,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
	getDelegateClient,
	isDelegatedChild,
} from "@wangjq4214/pi-delegate/api";

export function dialogueSnapshot(
	branch: ReturnType<ExtensionContext["sessionManager"]["getBranch"]>,
): string | undefined {
	const messages: { role: string; text: string }[] = [];
	let remaining = 8_000;
	for (
		let i = branch.length - 1;
		i >= 0 && remaining && messages.length < 12;
		i--
	) {
		const entry = branch[i];
		if (entry?.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "user" && message.role !== "assistant") continue;
		const { role, content } = message;
		let text = "";
		const limit = Math.min(2_000, remaining);
		if (typeof content === "string") text = content.slice(0, limit);
		else {
			for (const block of content) {
				if (block.type !== "text") continue;
				if (text) text += "\n";
				text += block.text.slice(0, Math.max(0, limit - text.length));
				if (text.length >= limit) break;
			}
		}
		if (!text.trim()) continue;
		remaining -= text.length;
		messages.push({ role, text });
	}
	return messages.length
		? `Recent main conversation (reference only):\n${JSON.stringify(messages.reverse())}`
		: undefined;
}

function terminalText(value: string): string {
	return Array.from(stripVTControlCharacters(value), (character) => {
		const code = character.charCodeAt(0);
		return code === 10 || (code >= 32 && (code < 127 || code > 159))
			? character
			: " ";
	}).join("");
}

interface Question {
	text: string;
	status: string;
	answer?: string;
	controller: AbortController;
}
interface View {
	close?: () => void;
	refresh?: () => void;
	handle?: OverlayHandle;
}

export default function btw(pi: ExtensionAPI): void {
	if (isDelegatedChild()) return;
	let latest: Question | undefined;
	let view: View | undefined;
	const close = () => {
		const previous = view;
		view = undefined;
		previous?.close?.();
	};
	const clear = () => {
		const previous = latest;
		latest = undefined;
		previous?.controller.abort();
		close();
	};
	function show(ctx: ExtensionContext, question: Question) {
		close();
		const current: View = {};
		view = current;
		void ctx.ui
			.custom<void>(
				(tui, theme, _keys, done) => {
					let offset = 0;
					let page = 1;
					current.close = () => done(undefined);
					current.refresh = () => tui.requestRender();
					const heading = terminalText(question.text).slice(0, 240);
					let bodyKey: string | undefined;
					let bodyWidth = 0;
					let wrapped: string[] = [];
					return {
						invalidate() {
							bodyWidth = 0;
						},
						render(width) {
							if (width < 1) return [];
							const padding = width >= 3 ? " " : "";
							const inner = width - 2 * padding.length;
							page = Math.max(1, Math.min(28, tui.terminal.rows - 7));
							if (bodyWidth !== inner || bodyKey !== question.answer) {
								bodyWidth = inner;
								bodyKey = question.answer;
								wrapped = wrapTextWithAnsi(
									terminalText(question.answer ?? ""),
									inner,
								);
							}
							offset = Math.min(offset, Math.max(0, wrapped.length - page));
							const row = (text: string) => {
								const fit = truncateToWidth(text, inner);
								return theme.bg(
									"userMessageBg",
									`${padding}${fit}${" ".repeat(Math.max(0, inner - visibleWidth(fit)))}${padding}`,
								);
							};
							return [
								row(theme.fg("accent", "/btw")),
								row(heading.replaceAll("\n", " ")),
								row(theme.fg("muted", question.status)),
								...wrapped.slice(offset, offset + page).map(row),
								row(theme.fg("dim", "/btw: focus · ↑↓: scroll · Esc: close")),
							];
						},
						handleInput(data) {
							if (matchesKey(data, Key.escape)) {
								close();
								return;
							}
							if (matchesKey(data, Key.up)) offset = Math.max(0, offset - 1);
							else if (matchesKey(data, Key.down)) offset++;
							else if (matchesKey(data, Key.pageUp))
								offset = Math.max(0, offset - page);
							else if (matchesKey(data, Key.pageDown)) offset += page;
							else return;
							tui.requestRender();
						},
					};
				},
				{
					overlay: true,
					overlayOptions: {
						anchor: "top-right",
						width: "40%",
						minWidth: 24,
						nonCapturing: true,
					},
					onHandle(handle) {
						current.handle = handle;
					},
				},
			)
			.catch((error: unknown) => {
				if (view === current)
					ctx.ui.notify(
						`Unable to show /btw: ${terminalText(String(error)).slice(0, 240)}`,
						"error",
					);
			})
			.finally(() => {
				if (view === current) view = undefined;
			});
	}
	pi.registerCommand("btw", {
		description:
			"Ask a side question; no argument opens or focuses the overlay",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") return;
			const text = args.trim();
			if (!text) {
				if (view?.handle) view.handle.focus();
				else if (latest) show(ctx, latest);
				else ctx.ui.notify("Usage: /btw <question>", "info");
				return;
			}
			clear();
			const question: Question = {
				text,
				status: "Starting",
				controller: new AbortController(),
			};
			latest = question;
			show(ctx, question);
			const update = (status: string, answer?: string) => {
				if (latest !== question) return;
				question.status = status;
				question.answer = answer;
				view?.refresh?.();
			};
			try {
				const client = getDelegateClient(pi);
				if (client.capabilities?.invocationProgress !== true)
					throw new Error(
						"Update pi-delegate: /btw requires invocation progress",
					);
				const context = dialogueSnapshot(ctx.sessionManager.getBranch());
				void client
					.execute(
						{ task: text, title: "/btw", context },
						ctx,
						question.controller.signal,
						{
							presentation: "consumer",
							onProgress: (progress) =>
								update(progress.cancelling ? "Cancelling" : progress.phase),
						},
					)
					.then((result) => {
						update(
							result.details.status,
							result.content.map((block) => block.text).join("\n") ||
								result.details.error,
						);
					})
					.catch((error: unknown) => update("failed", String(error)));
			} catch (error) {
				update("failed", String(error));
			}
		},
	});
	pi.on("session_start", clear);
	pi.on("session_shutdown", clear);
	pi.on("session_before_tree", (event) => {
		if (event.preparation.targetId !== event.preparation.oldLeafId) clear();
	});
	pi.on("session_tree", (event) => {
		if (event.newLeafId !== event.oldLeafId) clear();
	});
}
