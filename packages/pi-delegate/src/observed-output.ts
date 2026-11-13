import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";

const MAX_RETAINED_CHARS = 256 * 1024;
const RETENTION_NOTICE =
	"[Partial output retention limit reached; later assistant text omitted.]";

/** Bounded assistant-text prefix only: never retain tool logs, thinking or session entries. */
export class ObservedOutput {
	private completed: string[] = [];
	private completedSize = 0;
	private current = new Map<number, string>();
	private currentSize = 0;
	private frozen?: string;

	observe(event: JsonAgentSessionEvent): void {
		if (this.frozen !== undefined) return;
		if (event.type === "message_start" && event.message.role === "assistant") {
			this.complete();
			for (const [index, block] of event.message.content.entries())
				if (block.type === "text") this.set(index, block.text);
		} else if (event.type === "message_update") {
			const update = event.assistantMessageEvent;
			if (update?.type === "text_delta")
				this.set(update.contentIndex, update.delta, true);
			else if (update?.type === "text_end")
				this.set(update.contentIndex, update.content);
		} else if (
			event.type === "message_end" &&
			event.message.role === "assistant"
		) {
			// Empty aborted messages must not erase text already received as deltas.
			if (
				event.message.content.some(
					(block) => block.type === "text" && block.text,
				)
			) {
				this.current.clear();
				this.currentSize = 0;
				for (const [index, block] of event.message.content.entries())
					if (block.type === "text") this.set(index, block.text);
			}
			this.complete();
		}
	}

	private set(index: number, text: string, append = false): void {
		if (this.frozen !== undefined) return;
		const previous = this.current.get(index) ?? "";
		if (!append) {
			this.current.delete(index);
			this.currentSize -= previous.length;
		}
		// Include space for block/message separators; slice before concatenating a delta.
		const room = Math.max(
			0,
			MAX_RETAINED_CHARS -
				this.completedSize -
				this.currentSize -
				this.current.size -
				2,
		);
		const retained = text.slice(0, room);
		const next = (append ? previous : "") + retained;
		if (next) this.current.set(index, next);
		this.currentSize += retained.length;
		if (retained.length < text.length) this.freeze();
	}

	private complete(): void {
		if (this.frozen !== undefined) return;
		const text = this.currentText();
		if (text) {
			this.completed.push(text);
			this.completedSize += text.length + 2;
		}
		this.current.clear();
		this.currentSize = 0;
	}

	private currentText(): string {
		return [...this.current.entries()]
			.sort(([a], [b]) => a - b)
			.map(([, text]) => text)
			.join("\n");
	}

	private freeze(): void {
		this.frozen = this.text().slice(0, MAX_RETAINED_CHARS);
		this.completed = [];
		this.current.clear();
	}

	text(): string {
		return this.frozen === undefined
			? [...this.completed, this.currentText()].filter(Boolean).join("\n\n")
			: `${this.frozen}\n\n${RETENTION_NOTICE}`;
	}
}
