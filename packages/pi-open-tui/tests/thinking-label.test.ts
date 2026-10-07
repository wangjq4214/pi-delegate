import assert from "node:assert/strict";
import test from "node:test";
import type { TUI } from "@earendil-works/pi-tui";
import { ThinkingLabelTarget } from "../src/thinking-label.ts";

function component() {
	return {
		children: [] as unknown[], label: "Thinking...",
		setHiddenThinkingLabel(label: string) { this.label = label; },
		setHideThinkingBlock() {}, updateContent() {},
	};
}

test("thinking compatibility finds the latest component, tolerates cycles and resets its cached target", () => {
	const first = component();
	const second = component();
	let renders = 0;
	const tui = { children: [first, { children: [second] }] as unknown[], requestRender() { renders++; } };
	tui.children.push(tui, null);
	const bridge = new ThinkingLabelTarget(tui as unknown as TUI);
	assert.equal(bridge.set("latest"), true);
	assert.equal(first.label, "Thinking...");
	assert.equal(second.label, "latest");
	const third = component();
	tui.children.push(third);
	bridge.set("cached");
	assert.equal(second.label, "cached");
	bridge.reset();
	bridge.set("next message");
	assert.equal(third.label, "next message");
	assert.equal(renders, 3);
});

test("missing/incompatible/throwing host components fail safely and later recover", () => {
	const tui = { children: [{ children: [], setHiddenThinkingLabel() { throw new Error("incompatible"); } }] as unknown[], requestRender() {} };
	const bridge = new ThinkingLabelTarget(tui as unknown as TUI);
	assert.equal(bridge.set("no target"), false);
	const broken = component();
	broken.setHiddenThinkingLabel = () => { throw new Error("host changed"); };
	tui.children.push(broken);
	assert.equal(bridge.set("throwing"), false);
	const recovered = component();
	tui.children.push(recovered);
	assert.equal(bridge.set("recovered"), true);
	assert.equal(recovered.label, "recovered");
});
