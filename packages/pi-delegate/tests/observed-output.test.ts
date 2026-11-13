import { expect, test } from "bun:test";
import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { ObservedOutput } from "../src/observed-output.ts";

test("retain only assistant text, authoritative end without cumulative duplication and unfinished response", () => {
	const output = new ObservedOutput();
	const event = (value: unknown) =>
		output.observe(value as JsonAgentSessionEvent);
	event({ type: "message_start", message: { role: "assistant", content: [] } });
	event({
		type: "message_update",
		assistantMessageEvent: {
			type: "text_delta",
			contentIndex: 1,
			delta: "later",
		},
	});
	event({
		type: "message_update",
		assistantMessageEvent: {
			type: "text_delta",
			contentIndex: 0,
			delta: "first ",
		},
	});
	event({
		type: "message_update",
		assistantMessageEvent: {
			type: "text_delta",
			contentIndex: 0,
			delta: "part",
		},
	});
	event({
		type: "message_update",
		assistantMessageEvent: {
			type: "text_end",
			contentIndex: 0,
			content: "first part",
		},
	});
	event({
		type: "message_update",
		assistantMessageEvent: {
			type: "thinking_delta",
			contentIndex: 2,
			delta: "secret",
		},
	});
	event({
		type: "message_end",
		message: {
			role: "toolResult",
			content: [{ type: "text", text: "tool log" }],
		},
	});
	expect(output.text()).toBe("first part\nlater");
	event({
		type: "message_end",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "final authoritative answer" }],
		},
	});
	event({ type: "message_start", message: { role: "assistant", content: [] } });
	event({
		type: "message_update",
		assistantMessageEvent: {
			type: "text_delta",
			contentIndex: 0,
			delta: "unfinished",
		},
	});
	expect(output.text()).toBe("final authoritative answer\n\nunfinished");
});
test("empty aborted message-end and abandoned responses do not discard observed text", () => {
	const output = new ObservedOutput();
	const event = (value: unknown) =>
		output.observe(value as JsonAgentSessionEvent);
	event({
		type: "message_start",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "partial" }],
		},
	});
	event({
		type: "message_end",
		message: { role: "assistant", content: [], stopReason: "aborted" },
	});
	event({
		type: "message_start",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "abandoned" }],
		},
	});
	event({
		type: "message_start",
		message: { role: "assistant", content: [{ type: "text", text: "new" }] },
	});
	expect(output.text()).toBe("partial\n\nabandoned\n\nnew");
});

for (const source of ["delta", "start", "end"])
	test(`assistant retention is bounded and explicitly reports omitted text (${source})`, () => {
		const output = new ObservedOutput();
		const event = (value: unknown) =>
			output.observe(value as JsonAgentSessionEvent);
		const text = "x".repeat(256 * 1024 + 10);
		if (source === "delta") {
			event({
				type: "message_start",
				message: { role: "assistant", content: [] },
			});
			event({
				type: "message_update",
				assistantMessageEvent: {
					type: "text_delta",
					contentIndex: 0,
					delta: text,
				},
			});
		} else {
			event({
				type: source === "start" ? "message_start" : "message_end",
				message: { role: "assistant", content: [{ type: "text", text }] },
			});
		}
		const retained = output.text();
		expect(retained).toStartWith("x".repeat(100));
		expect(retained).toContain("retention limit reached");
		expect(retained.length).toBeLessThan(256 * 1024 + 100);
		event({ type: "message_end", message: { role: "assistant", content: [] } });
		for (let i = 0; i < 10; i++)
			event({
				type: "message_start",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "later" }],
				},
			});
		expect(output.text()).toBe(retained);
	});

test("many completed assistant messages share the same retention bound", () => {
	const output = new ObservedOutput();
	for (let i = 0; i < 300; i++)
		output.observe({
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "x".repeat(1024) }],
			},
		} as JsonAgentSessionEvent);
	expect(output.text()).toContain("retention limit reached");
	expect(output.text().length).toBeLessThan(256 * 1024 + 100);
});
