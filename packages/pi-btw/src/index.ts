import { stripVTControlCharacters } from "node:util";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	Input,
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

interface Turn {
	text: string;
	status: string;
	answer?: string;
}

function sideSnapshot(turns: Turn[]): string | undefined {
	let remaining = 8_000;
	const exchanges: { question: string; answer: string }[] = [];
	for (
		let i = turns.length - 1;
		i >= 0 && remaining > 0 && exchanges.length < 8;
		i--
	) {
		const turn = turns[i];
		if (turn?.status !== "completed" || !turn.answer) continue;
		const question = turn.text.slice(0, Math.min(1_000, remaining));
		const answer = turn.answer.slice(
			0,
			Math.min(4_000, remaining - question.length),
		);
		if (!answer) break;
		exchanges.push({ question, answer });
		remaining -= question.length + answer.length;
	}
	return exchanges.length
		? `Recent /btw exchanges (reference only):\n${JSON.stringify(exchanges.reverse())}`
		: undefined;
}

interface View {
	close?: () => void;
	refresh?: (follow?: boolean) => void;
	handle?: OverlayHandle;
	focusOnMount: boolean;
}

export default function btw(pi: ExtensionAPI): void {
	if (isDelegatedChild()) return;
	const turns: Turn[] = [];
	const pending = new Set<AbortController>();
	let view: View | undefined;
	const close = () => {
		const previous = view;
		view = undefined;
		previous?.close?.();
	};
	const clear = () => {
		turns.length = 0;
		for (const controller of pending) controller.abort();
		pending.clear();
		close();
	};

	function show(ctx: ExtensionContext, focus: boolean) {
		if (view) {
			if (focus) {
				view.focusOnMount = true;
				view.handle?.focus();
			}
			return;
		}

		const current: View = { focusOnMount: focus };
		view = current;
		void ctx.ui
			.custom<void>(
				(tui, theme, _keys, done) => {
					const input = new Input({ placeholder: "Ask a side question…" });
					input.onEscape = close;
					input.onSubmit = (value) => {
						const question = value.trim();
						if (!question) return;
						input.setValue("");
						submit(ctx, question);
					};
					let offset = 0;
					let page = 0;
					let follow = true;
					let bodyWidth = 0;
					let wrapped: string[] = [];
					current.close = () => done(undefined);
					current.refresh = (followLatest) => {
						bodyWidth = 0;
						follow ||= !!followLatest;
						tui.requestRender();
					};
					return {
						get focused() {
							return input.focused;
						},
						set focused(value: boolean) {
							input.focused = value;
						},
						invalidate() {
							bodyWidth = 0;
							input.invalidate();
						},
						render(width) {
							if (width < 1) return [];
							const padding = width >= 5 ? " " : "";
							const inner = width - 2 * padding.length;
							const rows = tui.terminal.rows;
							page = Math.max(0, Math.min(12, rows - 3));
							if (bodyWidth !== inner) {
								bodyWidth = inner;
								wrapped = turns.flatMap((turn) => {
									const lines = [`You: ${turn.text}`, `/btw · ${turn.status}`];
									if (turn.answer) lines.push(turn.answer);
									return wrapTextWithAnsi(
										terminalText(lines.join("\n")),
										inner,
									);
								});
							}
							const end = Math.max(0, wrapped.length - page);
							offset = follow ? end : Math.min(offset, end);
							const row = (text: string) => {
								const fit =
									visibleWidth(text) <= inner
										? text
										: truncateToWidth(text, inner);
								return theme.bg(
									"userMessageBg",
									`${padding}${fit}${" ".repeat(Math.max(0, inner - visibleWidth(fit)))}${padding}`,
								);
							};
							const body = wrapped.slice(offset, offset + page);
							while (body.length < page) body.push("");
							return [
								...(rows >= 2
									? [row(theme.fg("accent", "/btw · Side chat"))]
									: []),
								...body.map(row),
								...input.render(inner).map(row),
								...(rows >= 3
									? [
											row(
												theme.fg(
													"dim",
													"Enter: send · ↑↓: scroll · Esc: close",
												),
											),
										]
									: []),
							];
						},
						handleInput(data) {
							if (matchesKey(data, Key.escape)) {
								close();
								return;
							}
							const step = matchesKey(data, Key.up)
								? -1
								: matchesKey(data, Key.down)
									? 1
									: matchesKey(data, Key.pageUp)
										? -page
										: matchesKey(data, Key.pageDown)
											? page
											: 0;
							if (step) {
								const end = Math.max(0, wrapped.length - page);
								offset = Math.max(0, Math.min(end, offset + step));
								follow = offset === end;
							} else {
								// Pi delivers bracketed paste in one packet. Keep its framing,
								// but don't let pasted control sequences reach the renderer.
								const pasteStart = "\x1b[200~";
								const pasteEnd = "\x1b[201~";
								if (data.startsWith(pasteStart) && data.endsWith(pasteEnd)) {
									const content = data.slice(
										pasteStart.length,
										-pasteEnd.length,
									);
									data =
										pasteStart +
										terminalText(content.replace(/\r\n?|\n/g, " ")) +
										pasteEnd;
								}
								input.handleInput(data);
							}
							tui.requestRender();
						},
					};
				},
				{
					overlay: true,
					overlayOptions: {
						anchor: "center",
						width: "70%",
						minWidth: 28,
						nonCapturing: true,
					},
					onHandle(handle) {
						if (view !== current) return;
						current.handle = handle;
						if (current.focusOnMount) handle.focus();
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

	function submit(ctx: ExtensionContext, text: string) {
		const history = sideSnapshot(turns);
		const turn: Turn = { text, status: "Starting" };
		const controller = new AbortController();
		turns.push(turn);
		pending.add(controller);
		view?.refresh?.(true);

		const update = (status: string, answer?: string) => {
			if (!pending.has(controller)) return;
			turn.status = status;
			turn.answer = answer;
			view?.refresh?.();
		};

		try {
			const client = getDelegateClient(pi);
			if (client.capabilities?.invocationProgress !== true)
				throw new Error(
					"Update pi-delegate: /btw requires invocation progress",
				);
			const context =
				[dialogueSnapshot(ctx.sessionManager.getBranch()), history]
					.filter(Boolean)
					.join("\n\n") || undefined;
			void client
				.execute(
					{ task: text, title: "/btw", context },
					ctx,
					controller.signal,
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
				.catch((error: unknown) => update("failed", String(error)))
				.finally(() => pending.delete(controller));
		} catch (error) {
			update("failed", String(error));
			pending.delete(controller);
		}
	}

	pi.registerCommand("btw", {
		description: "Open a side chat or ask a quick question",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") return;
			const text = args.trim();
			show(ctx, !text);
			if (text) submit(ctx, text);
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
