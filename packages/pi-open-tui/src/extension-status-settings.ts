import type { Theme } from "@earendil-works/pi-coding-agent";
import { Input, Key, matchesKey, ScrollView, SelectList, truncateToWidth, wrapTextWithAnsi, type Focusable } from "@earendil-works/pi-tui";
import { getExtensionStatusPreference, type ExtensionStatusPreference, type OpenTuiConfig } from "./config.ts";
import { sanitizeStatus, sanitizeStatusPreservingStyles } from "./utils.ts";

export interface ExtensionStatusSettingsHooks {
	getExtensionStatuses?: () => ReadonlyMap<string, string>;
	getFoldedStatusKeys?: () => ReadonlySet<string>;
}

const COPY = {
	en: {
		full: "View full current status text", open: "Enter to open", empty: "No current extension statuses",
		visible: "Visible", row: "Row", priority: "Priority", on: "On", off: "Off", folded: "folded",
		priorityHint: "Priority: finite number; higher stays visible first. Empty resets to 0. Enter: save · Esc: cancel",
		invalid: "Enter a finite number.",
		detailHint: "↑/↓ · PgUp/PgDn · Home/End: scroll · Esc/q: back",
	},
	zh: {
		full: "查看当前状态全文", open: "Enter 打开", empty: "当前没有扩展状态",
		visible: "可见", row: "逻辑行", priority: "优先级", on: "开启", off: "关闭", folded: "已折叠",
		priorityHint: "优先级：有限数字，越大越优先显示。留空恢复 0。Enter：保存 · Esc：取消",
		invalid: "请输入有限数字。",
		detailHint: "↑/↓ · PgUp/PgDn · Home/End：滚动 · Esc/q：返回",
	},
} as const;

type Field = keyof ExtensionStatusPreference;
const FIELDS: Field[] = ["visible", "row", "priority"];
const FULL = "full";
// A quoted key is unambiguous even when it contains delimiters, whitespace or controls.
const keyLabel = (key: string) => sanitizeStatus(JSON.stringify(key));

/** Settings-only view. Host getters are read on render; no polling or producer ownership. */
export class ExtensionStatusSettings implements Focusable {
	private list!: SelectList;
	private actions = new Map<string, { key: string; field: Field }>();
	private signature = "";
	private selected = FULL;
	private editing: { key: string; input: Input; error?: string } | undefined;
	private details = false;
	private hasFocus = false;
	private detailLines: string[] = [];
	private readonly scroll = new ScrollView({ render: () => this.detailLines, invalidate() {} });

	private readonly theme: Theme;
	private readonly getConfig: () => OpenTuiConfig;
	private readonly onChange: (config: OpenTuiConfig) => void;
	private readonly hooks: ExtensionStatusSettingsHooks;
	private readonly getRows: () => number;

	constructor(
		theme: Theme,
		getConfig: () => OpenTuiConfig,
		onChange: (config: OpenTuiConfig) => void,
		hooks: ExtensionStatusSettingsHooks,
		getRows: () => number,
	) {
		this.theme = theme;
		this.getConfig = getConfig;
		this.onChange = onChange;
		this.hooks = hooks;
		this.getRows = getRows;
	}

	get focused(): boolean { return this.hasFocus; }
	set focused(value: boolean) {
		this.hasFocus = value;
		if (this.editing) this.editing.input.focused = value;
	}
	get capturesInput(): boolean { return !!this.editing || this.details; }
	invalidate(): void { this.list?.invalidate(); this.editing?.input.invalidate(); }

	private update(key: string, patch: Partial<ExtensionStatusPreference>): void {
		const config = this.getConfig();
		this.onChange({
			...config,
			extensionStatusItems: {
				...config.extensionStatusItems,
				[key]: { ...getExtensionStatusPreference(config, key), ...patch },
			},
		});
	}

	private apply(id: string): void {
		if (id === FULL) {
			this.details = true;
			this.scroll.scrollToStart();
			return;
		}
		const action = this.actions.get(id);
		if (!action) return;
		const { key, field } = action;
		const preference = getExtensionStatusPreference(this.getConfig(), key);
		if (field === "visible") this.update(key, { visible: !preference.visible });
		else if (field === "row") this.update(key, { row: preference.row === 1 ? 2 : 1 });
		else {
			const input = new Input();
			input.setValue(String(preference.priority));
			input.focused = this.focused;
			this.editing = { key, input };
			input.onEscape = () => { this.editing = undefined; };
			input.onSubmit = (value) => {
				const priority = value.trim() ? Number(value) : 0;
				if (!Number.isFinite(priority)) {
					if (this.editing) this.editing.error = COPY[this.getConfig().settingsLanguage].invalid;
					return;
				}
				this.update(key, { priority });
				this.editing = undefined;
			};
		}
	}

	private syncList(width: number): void {
		const config = this.getConfig();
		const copy = COPY[config.settingsLanguage];
		const keys = [...(this.hooks.getExtensionStatuses?.().keys() ?? [])].sort();
		const signature = JSON.stringify([width <= 60, this.getRows(), config.settingsLanguage,
			keys.map((key) => [key, getExtensionStatusPreference(config, key)])]);
		if (this.list && signature === this.signature) return;
		this.signature = signature;
		this.actions.clear();
		const items = [{ value: FULL, label: copy.full as string, description: copy.open as string }];
		for (const key of keys) {
			const preference = getExtensionStatusPreference(config, key);
			for (const field of FIELDS) {
				const id = JSON.stringify([key, field]);
				this.actions.set(id, { key, field });
				const value = field === "visible" ? preference.visible ? copy.on : copy.off : String(preference[field]);
				items.push({ value: id, label: `${keyLabel(key)} · ${copy[field]}`, description: value });
			}
		}
		this.list = new SelectList(items.map((item) => width <= 60
			? { ...item, label: `${item.label}: ${item.description}`, description: undefined } : item), this.getRows(), {
			selectedPrefix: (s) => this.theme.fg("accent", s), selectedText: (s) => this.theme.fg("accent", s),
			description: (s) => this.theme.fg("muted", s), scrollInfo: (s) => this.theme.fg("dim", s),
			noMatch: (s) => this.theme.fg("warning", s),
		});
		const index = items.findIndex((item) => item.value === this.selected);
		this.list.setSelectedIndex(Math.max(0, index));
		this.selected = this.list.getSelectedItem()?.value ?? FULL;
		this.list.onSelectionChange = (item) => { this.selected = item.value; };
		this.list.onSelect = (item) => this.apply(item.value);
	}

	handleInput(data: string): void {
		if (this.editing) { this.editing.input.handleInput(data); return; }
		if (this.details) {
			if (matchesKey(data, Key.escape) || data === "q") this.details = false;
			else if (matchesKey(data, Key.up)) this.scroll.scrollBy(-1);
			else if (matchesKey(data, Key.down)) this.scroll.scrollBy(1);
			else if (matchesKey(data, Key.pageUp)) this.scroll.scrollBy(-this.getRows());
			else if (matchesKey(data, Key.pageDown)) this.scroll.scrollBy(this.getRows());
			else if (matchesKey(data, Key.home)) this.scroll.scrollToStart();
			else if (matchesKey(data, Key.end)) this.scroll.scrollToEnd();
			return;
		}
		// Keep actions bound to the last displayed key, never an index in a new host map.
		if (data === " " || matchesKey(data, Key.space)) this.apply(this.selected);
		else this.list?.handleInput(data);
	}

	render(width: number): string[] {
		if (width < 1) return [""];
		// A two-column grapheme cannot wrap into one column. Keep the view open
		// and its source intact until resize instead of emitting an over-wide row.
		if (width === 1) return ["…"];
		const copy = COPY[this.getConfig().settingsLanguage];
		if (this.editing) {
			return [
				...wrapTextWithAnsi(`${keyLabel(this.editing.key)} · ${copy.priority}`, width),
				...wrapTextWithAnsi(copy.priorityHint, width),
				...this.editing.input.render(width),
				...(this.editing.error ? wrapTextWithAnsi(this.theme.fg("error", this.editing.error), width) : []),
			];
		}
		if (this.details) {
			const statuses = this.hooks.getExtensionStatuses?.() ?? new Map<string, string>();
			const folded = this.hooks.getFoldedStatusKeys?.();
			this.detailLines = [];
			for (const [key, value] of [...statuses].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
				this.detailLines.push(...wrapTextWithAnsi(this.theme.fg("accent", `${keyLabel(key)}${folded?.has(key) ? ` [${copy.folded}]` : ""}`), width));
				// Reset after each item; wrapping replays SGR at each continuation line.
				this.detailLines.push(...wrapTextWithAnsi(sanitizeStatusPreservingStyles(value) + "\x1b[0m", width), "");
			}
			if (!this.detailLines.length) this.detailLines = wrapTextWithAnsi(copy.empty, width);
			this.scroll.updateLayout(this.detailLines.length, this.getRows(), () => {});
			return [truncateToWidth(this.theme.fg("accent", copy.full), width), truncateToWidth(copy.detailHint, width),
				...this.scroll.render(width).slice(this.scroll.scrollTop, this.scroll.scrollTop + this.getRows()),
				truncateToWidth(`${this.scroll.scrollTop + 1}–${Math.min(this.detailLines.length, this.scroll.scrollTop + this.getRows())} / ${this.detailLines.length}`, width)];
		}
		this.syncList(width);
		return this.list.render(width);
	}
}
