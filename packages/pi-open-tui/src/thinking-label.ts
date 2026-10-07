import type { TUI } from "@earendil-works/pi-tui";

interface HiddenThinkingComponent {
	children: unknown[];
	setHiddenThinkingLabel(label: string): void;
	setHideThinkingBlock(hide: boolean): void;
	updateContent(message: unknown, isStreaming?: boolean): void;
}

/** Compatibility bridge until Pi supplies a public per-message thinking-label API. */
export class ThinkingLabelTarget {
	private target: HiddenThinkingComponent | undefined;
	private readonly tui: TUI;

	constructor(tui: TUI) {
		this.tui = tui;
	}

	reset(): void {
		this.target = undefined;
	}

	set(label: string): boolean {
		try {
			this.target ??= this.findLatest();
			if (!this.target) return false;
			this.target.setHiddenThinkingLabel(label);
			this.tui.requestRender();
			return true;
		} catch {
			this.reset();
			return false;
		}
	}

	private findLatest(): HiddenThinkingComponent | undefined {
		const pending: unknown[] = [this.tui];
		const visited = new Set<object>();
		let latest: HiddenThinkingComponent | undefined;
		while (pending.length) {
			const value = pending.pop();
			if (!value || typeof value !== "object" || visited.has(value)) continue;
			visited.add(value);
			const component = value as Partial<HiddenThinkingComponent>;
			if (!Array.isArray(component.children)) continue;
			if (typeof component.setHiddenThinkingLabel === "function"
				&& typeof component.setHideThinkingBlock === "function"
				&& typeof component.updateContent === "function") latest = component as HiddenThinkingComponent;
			for (let i = component.children.length - 1; i >= 0; i--) pending.push(component.children[i]);
		}
		return latest;
	}
}
