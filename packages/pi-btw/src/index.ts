import { stripVTControlCharacters } from "node:util";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
	Input,
	Key,
	Markdown,
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
	startedAt: number;
	finishedAt?: number;
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
	dispose?: () => void;
	refresh?: (follow?: boolean) => void;
	handle?: OverlayHandle;
	focusOnMount: boolean;
}

// Optional synchronous presentation handshake; neither extension imports the other.
interface SideChatPresentation {
	userKey: string;
	user(width: number, render: (width: number) => string[]): string[];
	composer(
		width: number,
		rows: number,
		render: (width: number) => string,
		paint: (text: string) => string,
		run?: Pick<Turn, "status" | "startedAt" | "finishedAt">,
	): string[];
}

function currentStyle(
	pi: ExtensionAPI,
	tick?: () => void,
	start?: (stop: () => void) => void,
): SideChatPresentation | undefined {
	let style: SideChatPresentation | undefined;
	pi.events?.emit?.("@wangjq4214/pi-open-tui:side-chat-presentation:v2", {
		tick,
		start,
		reply(value: unknown) {
			const candidate = value as Partial<SideChatPresentation> | undefined;
			if (
				typeof candidate?.userKey === "string" &&
				typeof candidate.user === "function" &&
				typeof candidate.composer === "function"
			) {
				style = candidate as SideChatPresentation;
			}
		},
	});
	return style;
}

export default function btw(pi: ExtensionAPI): void {
	if (isDelegatedChild()) return;
	const turns: Turn[] = [];
	const pending = new Set<AbortController>();
	let view: View | undefined;
	const close = () => {
		const previous = view;
		view = undefined;
		previous?.dispose?.();
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
					const input = new Input({
						prompt: "",
						placeholder: "Ask a side question…",
					});
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
					const markdownTheme = getMarkdownTheme();
					let bodyStyle: string | undefined;
					let stopTick: (() => void) | undefined;
					const stopAnimation = () => {
						stopTick?.();
						stopTick = undefined;
					};
					current.dispose = stopAnimation;
					const tick = () => tui.requestRender();
					const renderContent = (width: number) => {
						const rows = tui.terminal.rows;
						if (width < 1 || rows < 1) {
							stopAnimation();
							return [];
						}
						let run = turns.at(-1);
						for (let i = turns.length - 1; i >= 0; i--) {
							const turn = turns[i];
							if (turn && turn.finishedAt === undefined) {
								run = turn;
								break;
							}
						}
						const animate =
							view === current &&
							run &&
							run.finishedAt === undefined &&
							rows >= 3;
						const style =
							animate && !stopTick
								? currentStyle(pi, tick, (stop) => {
										stopTick = stop;
									})
								: currentStyle(pi);
						if (!animate || !style) stopAnimation();
						const padding = " ".repeat(width >= 12 ? 2 : width >= 6 ? 1 : 0);
						const inner = width - 2 * padding.length;
						const paint =
							theme.getThinkingBorderColor?.(
								pi.getThinkingLevel?.() ?? "off",
							) ?? ((text: string) => theme.fg("borderMuted", text));
						const renderInput = (w: number) => input.render(w)[0] ?? "";
						const composer = style
							? style.composer(inner, rows, renderInput, paint, run)
							: [
									...(run && rows >= 3
										? [
												theme.fg(
													"muted",
													`${run.finishedAt === undefined ? "⠋ " : ""}${run.status}`,
												),
											]
										: []),
									...(inner >= 4 && rows >= 5
										? [paint("─".repeat(inner))]
										: []),
									renderInput(inner),
									...(inner >= 4 && rows >= 5
										? [paint("─".repeat(inner))]
										: []),
								];
						const remaining = rows - composer.length;
						const title = remaining >= 3;
						const hint = remaining >= 4;
						const vertical = remaining >= 7;
						page = Math.min(
							12,
							remaining - Number(title) - Number(hint) - 2 * Number(vertical),
						);
						if (bodyWidth !== inner || bodyStyle !== style?.userKey) {
							bodyWidth = inner;
							bodyStyle = style?.userKey;
							wrapped = turns.flatMap((turn, index) => {
								const question = terminalText(turn.text);
								const renderUser = (w: number) =>
									w >= 3
										? new Markdown(
												question,
												1,
												1,
												markdownTheme,
												{
													color: (text) => theme.fg("userMessageText", text),
													bgColor: (text) => theme.bg("userMessageBg", text),
												},
												{
													preserveOrderedListMarkers: true,
													preserveBackslashEscapes: true,
												},
											).render(w)
										: wrapTextWithAnsi(question, w).map((line) =>
												theme.fg("userMessageText", line),
											);
								const lines = style
									? style.user(inner, renderUser)
									: renderUser(inner);
								if (
									turn.finishedAt !== undefined &&
									turn.status !== "completed"
								) {
									lines.push(
										...wrapTextWithAnsi(theme.fg("muted", turn.status), inner),
									);
								}
								if (turn.answer) {
									const answer = terminalText(turn.answer);
									lines.push(
										"",
										...(turn.status === "completed" && inner >= 4
											? new Markdown(answer, 0, 0, markdownTheme).render(inner)
											: wrapTextWithAnsi(answer, inner)),
									);
								}
								return index === 0 ? lines : ["", ...lines];
							});
						}
						const end = Math.max(0, wrapped.length - page);
						offset = follow ? end : Math.min(offset, end);
						const row = (text: string) => {
							const fit =
								visibleWidth(text) <= inner
									? text
									: truncateToWidth(text, inner);
							return (
								theme.bg("customMessageBg", padding + fit) +
								theme.bg(
									"customMessageBg",
									" ".repeat(inner - visibleWidth(fit)) + padding,
								)
							);
						};
						const body = wrapped.slice(offset, offset + page);
						while (body.length < page) body.push("");
						return [
							...(vertical ? [""] : []),
							...(title ? [theme.fg("accent", "/btw · Side chat")] : []),
							...body,
							...composer,
							...(hint
								? [theme.fg("dim", "Enter: send · ↑↓: scroll · Esc: close")]
								: []),
							...(vertical ? [""] : []),
						].map(row);
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
						render: renderContent,
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
				current.dispose?.();
				if (view === current) view = undefined;
			});
	}

	function submit(ctx: ExtensionContext, text: string) {
		const history = sideSnapshot(turns);
		const turn: Turn = { text, status: "Starting", startedAt: Date.now() };
		const controller = new AbortController();
		turns.push(turn);
		pending.add(controller);
		view?.refresh?.(true);

		const update = (status: string, answer?: string, finished = false) => {
			if (!pending.has(controller)) return;
			turn.status = status;
			turn.answer = answer;
			if (finished) turn.finishedAt = Date.now();
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
						true,
					);
				})
				.catch((error: unknown) => update("failed", String(error), true))
				.finally(() => pending.delete(controller));
		} catch (error) {
			update("failed", String(error), true);
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
