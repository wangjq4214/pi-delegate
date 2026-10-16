import type { ExtensionAPI, ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
	Box,
	Input,
	type Focusable,
	Key,
	matchesKey,
	SelectList,
	type SelectItem,
	type TUI,
	Text,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { getUserBoxBorder, getUserMessageLayout, getToolMessageLayout, type CursorStyle, type IconMode, type OpenTuiConfig, type SettingsLanguage, type ToolBoxBorderConfig, type ToolBoxBorderStyle, type UserBoxBorderConfig } from "./config.ts";
import { resolveBorderGlyphs } from "./message-layout.ts";

interface SettingItem {
	id: string;
	label: string;
	currentValue: string;
}

type Tab = "features" | "icons" | "segments" | "telemetry" | "toolBorder" | "userBorder";

const TABS: Tab[] = ["features", "icons", "segments", "telemetry", "toolBorder", "userBorder"];

const COPY = {
	en: {
		title: "Open TUI Settings",
		tabs: { features: "General", icons: "Appearance", segments: "Footer", telemetry: "Telemetry", toolBorder: "Tools", userBorder: "User / Skill" },
		scope: { toolBorder: "Enhanced presentation adds summaries and details. Compression reduces spacing and hides successful previews when enhanced. Border style is independent; Off hides border options.", userBorder: "Applies to User messages and Skill cards; preserves Skill expansion. Off restores native presentation and hides all styling options." },
		hint: "Tab/Shift+Tab/←/→: tabs · ↑/↓: move · Enter/Space: change · Esc/q: close",
		editHint: "Enter: save · Esc: cancel · Empty: reset to default",
		charHint: "One visible column, e.g. ─, │, #",
		colorHint: "Theme color token, e.g. muted, accent, success",
		invalidChar: "Use a symbol occupying one visible column.",
		invalidColor: "Unknown theme color token.",
		labels: {
			enabled: "Enabled",
			inlineFooter: "Inline footer",
			thinkingPeek: "Thinking titles",
			toolPresentation: "Enhanced presentation",
			language: "Language",
			cursorStyle: "Cursor style",
			editorBorderStyle: "Editor border",
			messageLayout: "Compression",
			worklineMarquee: "Workline marquee",
			worklineAttachToBorder: "Workline attached to border",
			iconMode: "Icon mode",
			cwd: "CWD",
			hostname: "Hostname",
			sessionName: "Session name",
			gitBranch: "Git branch",
			gitStatus: "Git status",
			gitCommit: "Git commit (detached)",
			runtime: "Runtime",
			context: "Context bar",
			tokens: "Tokens",
			cost: "Cost",
			extensionStatuses: "Extension status line",
			capitalizeProviderName: "Capitalize provider name",
			totalDuration: "Total duration",
			tokenCounts: "Token counts",
			stallDetails: "Stall details",
			costRate: "Cost rate",
			borderStyle: "Border style",
			borderColorMode: "Color mode",
			borderColor: "Static color (theme token)",
			top: "Top border",
			bottom: "Bottom border",
			left: "Left border",
			topChar: "Top symbol",
			bottomChar: "Bottom symbol",
			leftChar: "Left symbol",
			right: "Right border", rightChar: "Right symbol",
		},
		values: {
			on: "On",
			off: "Off",
			languages: { en: "English", zh: "简体中文" },
			cursorStyles: { block: "Block", bar: "Bar", underline: "Underline" },
			editorBorderStyles: { surround: "Surround", minimal: "Minimal" },
			icons: { auto: "Auto", nerd: "Nerd", unicode: "Unicode", ascii: "ASCII" },
			borderStyles: { single: "Single", bold: "Bold", double: "Double", dashed: "Dashed", custom: "Custom" },
			borderColorModes: { status: "Execution status", static: "Fixed color", theme: "Theme" },
			default: "Default",
		},
	},
	zh: {
		title: "Open TUI 设置",
		tabs: { features: "常规", icons: "外观", segments: "Footer", telemetry: "遥测", toolBorder: "工具卡片", userBorder: "用户 / Skill" },
		scope: { toolBorder: "增强展示提供摘要和详情；压缩展示减少留白，并在增强模式下隐藏成功预览。边框样式独立，关闭时隐藏边框选项。", userBorder: "同时影响用户消息和 Skill 卡片，保留 Skill 展开交互。关闭时恢复原生展示并隐藏全部样式选项。" },
		hint: "Tab/Shift+Tab/←/→：切页 · ↑/↓：移动 · Enter/Space：更改 · Esc/q：关闭",
		editHint: "Enter：保存 · Esc：取消 · 留空：恢复默认",
		charHint: "单列宽度符号，例如 ─、│、#",
		colorHint: "主题颜色标记，例如 muted、accent、success",
		invalidChar: "请输入占一个显示列的符号。",
		invalidColor: "未知的主题颜色标记。",
		labels: {
			enabled: "启用",
			inlineFooter: "内联底栏",
			thinkingPeek: "思考标题",
			toolPresentation: "增强展示",
			language: "语言",
			cursorStyle: "光标样式",
			editorBorderStyle: "编辑器边框",
			messageLayout: "压缩展示",
			worklineMarquee: "Workline 跑马灯",
			worklineAttachToBorder: "Workline 贴合边框",
			iconMode: "图标模式",
			cwd: "当前目录",
			hostname: "主机名",
			sessionName: "会话名",
			gitBranch: "Git 分支",
			gitStatus: "Git 状态",
			gitCommit: "Git 提交（分离 HEAD）",
			runtime: "运行环境",
			context: "上下文栏",
			tokens: "Token",
			cost: "费用",
			extensionStatuses: "扩展状态行",
			capitalizeProviderName: "提供商名称首字母大写",
			totalDuration: "总耗时",
			tokenCounts: "Token 数量",
			stallDetails: "停顿详情",
			costRate: "费用速率",
			borderStyle: "边框样式",
			borderColorMode: "配色模式",
			borderColor: "固定颜色（主题标记）",
			top: "上边框",
			bottom: "下边框",
			left: "左边框",
			topChar: "上边框符号",
			bottomChar: "下边框符号",
			leftChar: "左边框符号",
			right: "右边框", rightChar: "右边框符号",
		},
		values: {
			on: "开启",
			off: "关闭",
			languages: { en: "English", zh: "简体中文" },
			cursorStyles: { block: "块", bar: "竖线", underline: "下划线" },
			editorBorderStyles: { surround: "环绕", minimal: "简洁" },
			icons: { auto: "自动", nerd: "Nerd", unicode: "Unicode", ascii: "ASCII" },
			borderStyles: { single: "单线", bold: "粗线", double: "双线", dashed: "虚线", custom: "自定义" },
			borderColorModes: { status: "跟随执行状态", static: "固定配色", theme: "跟随主题" },
			default: "默认",
		},
	},
} as const;

type SettingsCopy = (typeof COPY)[SettingsLanguage];

function toggleSetting(config: OpenTuiConfig, key: keyof OpenTuiConfig["footerSegments"]): OpenTuiConfig {
	return {
		...config,
		footerSegments: {
			...config.footerSegments,
			[key]: !config.footerSegments[key],
		},
	};
}

function cycleIconMode(config: OpenTuiConfig): OpenTuiConfig {
	const order: IconMode[] = ["auto", "nerd", "unicode", "ascii"];
	const currentIdx = order.indexOf(config.icons.mode);
	const next = order[(currentIdx + 1) % order.length]!;
	return { ...config, icons: { ...config.icons, mode: next } };
}

function toggleEnabled(config: OpenTuiConfig): OpenTuiConfig {
	return { ...config, enabled: !config.enabled };
}

function toggleLanguage(config: OpenTuiConfig): OpenTuiConfig {
	return { ...config, settingsLanguage: config.settingsLanguage === "en" ? "zh" : "en" };
}

function cycleCursorStyle(config: OpenTuiConfig): OpenTuiConfig {
	const order: CursorStyle[] = ["block", "bar", "underline"];
	const currentIdx = order.indexOf(config.cursorStyle);
	const next = order[(currentIdx + 1) % order.length]!;
	return { ...config, cursorStyle: next };
}

function toggleTelemetry(config: OpenTuiConfig, key: keyof OpenTuiConfig["telemetry"]): OpenTuiConfig {
	return {
		...config,
		telemetry: { ...config.telemetry, [key]: !config.telemetry[key] },
	};
}

function cycleThinkingPeek(config: OpenTuiConfig): OpenTuiConfig {
	const next = config.thinkingPeek.lines > 0 ? 0 : 1;
	return {
		...config,
		thinkingPeek: { ...config.thinkingPeek, lines: next },
	};
}

function buildFeaturesItems(config: OpenTuiConfig, copy: SettingsCopy): SettingItem[] {
	const flag = (value: boolean) => value ? copy.values.on : copy.values.off;
	return [
		{ id: "enabled", label: copy.labels.enabled, currentValue: flag(config.enabled) },
		{ id: "settingsLanguage", label: copy.labels.language, currentValue: copy.values.languages[config.settingsLanguage] },
		{ id: "thinkingPeek", label: copy.labels.thinkingPeek, currentValue: flag(config.thinkingPeek.lines > 0) },
		{ id: "inlineFooter", label: copy.labels.inlineFooter, currentValue: flag(config.inlineFooter) },
	];
}

function buildIconsItems(config: OpenTuiConfig, copy: SettingsCopy): SettingItem[] {
	const flag = (value: boolean) => value ? copy.values.on : copy.values.off;
	return [
		{ id: "mode", label: copy.labels.iconMode, currentValue: copy.values.icons[config.icons.mode] },
		{ id: "cursorStyle", label: copy.labels.cursorStyle, currentValue: copy.values.cursorStyles[config.cursorStyle] },
		{ id: "editorBorderStyle", label: copy.labels.editorBorderStyle, currentValue: copy.values.editorBorderStyles[config.editorBorderStyle] },
		{ id: "worklineMarquee", label: copy.labels.worklineMarquee, currentValue: flag(config.workline.marquee) },
		{ id: "worklineAttachToBorder", label: copy.labels.worklineAttachToBorder, currentValue: flag(config.workline.attachToBorder) },
	];
}

function buildSegmentsItems(config: OpenTuiConfig, copy: SettingsCopy): SettingItem[] {
	const segs = config.footerSegments;
	const flag = (value: boolean) => value ? copy.values.on : copy.values.off;
	return [
		{ id: "cwd", label: copy.labels.cwd, currentValue: flag(segs.cwd) },
		{ id: "hostname", label: copy.labels.hostname, currentValue: flag(segs.hostname) },
		{ id: "sessionName", label: copy.labels.sessionName, currentValue: flag(segs.sessionName) },
		{ id: "gitBranch", label: copy.labels.gitBranch, currentValue: flag(segs.gitBranch) },
		{ id: "gitStatus", label: copy.labels.gitStatus, currentValue: flag(segs.gitStatus) },
		{ id: "gitCommit", label: copy.labels.gitCommit, currentValue: flag(segs.gitCommit) },
		{ id: "runtime", label: copy.labels.runtime, currentValue: flag(segs.runtime) },
		{ id: "context", label: copy.labels.context, currentValue: flag(segs.context) },
		{ id: "tokens", label: copy.labels.tokens, currentValue: flag(segs.tokens) },
		{ id: "cost", label: copy.labels.cost, currentValue: flag(segs.cost) },
		{ id: "extensionStatuses", label: copy.labels.extensionStatuses, currentValue: flag(segs.extensionStatuses) },
		{ id: "capitalizeProviderName", label: copy.labels.capitalizeProviderName, currentValue: flag(segs.capitalizeProviderName) },
	];
}

function buildTelemetryItems(config: OpenTuiConfig, copy: SettingsCopy): SettingItem[] {
	const telemetry = config.telemetry;
	const flag = (value: boolean) => value ? copy.values.on : copy.values.off;
	return [
		{ id: "enabled", label: copy.labels.enabled, currentValue: flag(telemetry.enabled) },
		{ id: "tps", label: "TPS", currentValue: flag(telemetry.tps) },
		{ id: "ttft", label: "TTFT", currentValue: flag(telemetry.ttft) },
		{ id: "duration", label: copy.labels.totalDuration, currentValue: flag(telemetry.duration) },
		{ id: "tokens", label: copy.labels.tokenCounts, currentValue: flag(telemetry.tokens) },
		{ id: "stalls", label: copy.labels.stallDetails, currentValue: flag(telemetry.stalls) },
		{ id: "cost", label: copy.labels.costRate, currentValue: flag(telemetry.cost) },
	];
}

const BORDER_TEXT_EDGES = { topChar: "top", bottomChar: "bottom", leftChar: "left", rightChar: "right" } as const;
type BorderTextField = "color" | keyof typeof BORDER_TEXT_EDGES;

function isBorderTextField(id: string): id is BorderTextField {
	return id === "color" || Object.hasOwn(BORDER_TEXT_EDGES, id);
}

function presentationBorder(config: OpenTuiConfig, tab: Tab): ToolBoxBorderConfig | UserBoxBorderConfig {
	return tab === "userBorder" ? getUserBoxBorder(config) : config.toolBoxBorder;
}

function userPresentationEnabled(config: OpenTuiConfig): boolean {
	return getUserMessageLayout(config) === "compact" || getUserBoxBorder(config).enabled;
}

function withPresentationBorder(config: OpenTuiConfig, tab: Tab, border: ToolBoxBorderConfig | UserBoxBorderConfig): OpenTuiConfig {
	return tab === "userBorder"
		? { ...config, userMessageLayout: "compact", userBoxBorder: { ...border, enabled: true } as UserBoxBorderConfig }
		: { ...config, toolMessageLayout: getToolMessageLayout(config), toolBoxBorder: border as ToolBoxBorderConfig };
}

function buildBorderItems(tab: Tab, config: OpenTuiConfig, copy: SettingsCopy): SettingItem[] {
	const user = tab === "userBorder";
	const border = presentationBorder(config, tab);
	const flag = (value: boolean) => value ? copy.values.on : copy.values.off;
	const items: SettingItem[] = user
		? [{ id: "enabled", label: copy.labels.enabled, currentValue: flag(userPresentationEnabled(config)) }]
		: [
			{ id: "toolPresentation", label: copy.labels.toolPresentation, currentValue: flag(config.toolPresentation) },
			...(config.toolPresentation ? [{ id: "messageLayout", label: copy.labels.messageLayout, currentValue: flag(getToolMessageLayout(config) === "compact") }] : []),
			{ id: "style", label: copy.labels.borderStyle, currentValue: border.enabled ? copy.values.borderStyles[border.style] : copy.values.off },
		];
	if (user ? !userPresentationEnabled(config) : !border.enabled) return items;
	if (user) items.push({ id: "style", label: copy.labels.borderStyle, currentValue: copy.values.borderStyles[border.style] });
	items.push({ id: "colorMode", label: copy.labels.borderColorMode, currentValue: copy.values.borderColorModes[border.colorMode] });
	if (border.colorMode === "static") items.push({ id: "color", label: copy.labels.borderColor, currentValue: border.color || "muted" });
	const glyphs = resolveBorderGlyphs(border.style, config.icons.mode === "ascii");
	for (const edge of ["top", "bottom", "left", "right"] as const) {
		items.push({ id: edge, label: copy.labels[edge], currentValue: flag(border[edge]?.enabled ?? false) });
		items.push({ id: `${edge}Char`, label: copy.labels[`${edge}Char`], currentValue: border[edge]?.char === undefined ? `${copy.values.default} (${glyphs[edge]})` : JSON.stringify(border[edge].char) });
	}
	return items;
}

function buildItems(tab: Tab, config: OpenTuiConfig): SettingItem[] {
	const copy = COPY[config.settingsLanguage];
	switch (tab) {
		case "features": return buildFeaturesItems(config, copy);
		case "icons": return buildIconsItems(config, copy);
		case "segments": return buildSegmentsItems(config, copy);
		case "telemetry": return buildTelemetryItems(config, copy);
		case "toolBorder":
		case "userBorder": return buildBorderItems(tab, config, copy);
	}
}

function handleSettingChange(
	tab: Tab,
	itemId: string,
	config: OpenTuiConfig,
): OpenTuiConfig {
	if (tab === "features") {
		if (itemId === "enabled") return toggleEnabled(config);
		if (itemId === "inlineFooter") return { ...config, inlineFooter: !config.inlineFooter };
		if (itemId === "settingsLanguage") return toggleLanguage(config);
		if (itemId === "thinkingPeek") return cycleThinkingPeek(config);
	}
	if (tab === "icons") {
		if (itemId === "mode") return cycleIconMode(config);
		if (itemId === "cursorStyle") return cycleCursorStyle(config);
		if (itemId === "editorBorderStyle") return { ...config, editorBorderStyle: config.editorBorderStyle === "surround" ? "minimal" : "surround" };
		if (itemId === "worklineMarquee") return { ...config, workline: { ...config.workline, marquee: !config.workline.marquee } };
		if (itemId === "worklineAttachToBorder") return { ...config, workline: { ...config.workline, attachToBorder: !config.workline.attachToBorder } };
	}
	if (tab === "toolBorder" || tab === "userBorder") {
		const user = tab === "userBorder";
		const border = presentationBorder(config, tab);
		if (itemId === "toolPresentation" && !user) return { ...config, toolPresentation: !config.toolPresentation };
		if (itemId === "messageLayout" && !user) {
			return { ...config, toolMessageLayout: getToolMessageLayout(config) === "normal" ? "compact" : "normal" };
		}
		if (itemId === "enabled" && user) {
			const enabled = !userPresentationEnabled(config);
			return { ...config, userMessageLayout: enabled ? "compact" : "normal", userBoxBorder: { ...border, enabled } as UserBoxBorderConfig };
		}
		if (itemId === "style") {
			const presets: ToolBoxBorderStyle[] = ["single", "bold", "double", "dashed", "custom"];
			const order: Array<ToolBoxBorderStyle | "off"> = user ? presets : ["off", ...presets];
			const current = !user && !border.enabled ? "off" : border.style;
			const next = order[(order.indexOf(current) + 1) % order.length]!;
			return withPresentationBorder(config, tab, next === "off" ? { ...border, enabled: false } : { ...border, enabled: true, style: next });
		}
		if (itemId === "colorMode") {
			return withPresentationBorder(config, tab, { ...border, colorMode: border.colorMode === "static" ? (user ? "theme" : "status") : "static" });
		}
		if (itemId === "top" || itemId === "bottom" || itemId === "left" || itemId === "right") {
			return withPresentationBorder(config, tab, { ...border, [itemId]: { ...border[itemId], enabled: !border[itemId]?.enabled } });
		}
	}
	if (tab === "segments") {
		return toggleSetting(config, itemId as keyof OpenTuiConfig["footerSegments"]);
	}
	if (tab === "telemetry") {
		return toggleTelemetry(config, itemId as keyof OpenTuiConfig["telemetry"]);
	}
	return config;
}

interface SettingsUiHandle extends Focusable {
	render: (width: number) => string[];
	invalidate: () => void;
	handleInput: (data: string) => void;
}

class SettingsUi implements SettingsUiHandle {
	private tab: Tab = "features";
	private config: OpenTuiConfig;
	private selectList!: SelectList;
	private readonly selectedItemByTab: Partial<Record<Tab, string>> = {};
	private readonly container: Box;
	private readonly theme: Theme;
	private readonly onChange: (config: OpenTuiConfig) => void;
	private readonly onClose: () => void;
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;
	private compact = false;
	private editing: { field: BorderTextField; input: Input; error?: string } | undefined;
	private hasFocus = false;

	get focused(): boolean { return this.hasFocus; }
	set focused(value: boolean) {
		this.hasFocus = value;
		if (this.editing) this.editing.input.focused = value;
		this.invalidate();
	}

	constructor(
		theme: Theme,
		config: OpenTuiConfig,
		onChange: (config: OpenTuiConfig) => void,
		onClose: () => void,
	) {
		this.theme = theme;
		this.config = config;
		this.onChange = onChange;
		this.onClose = onClose;
		this.container = new Box(1, 1, (s: string) => theme.bg("customMessageBg", s));
		this.rebuild();
	}

	private applySetting(itemId: string): void {
		this.selectedItemByTab[this.tab] = itemId;
		if ((this.tab === "toolBorder" || this.tab === "userBorder") && isBorderTextField(itemId)) {
			const border = presentationBorder(this.config, this.tab);
			const input = new Input();
			input.setValue(itemId === "color" ? border.color ?? "" : border[BORDER_TEXT_EDGES[itemId]]?.char ?? "");
			input.focused = this.focused;
			this.editing = { field: itemId, input };
			input.onSubmit = (value) => this.saveBorderText(itemId, value);
			input.onEscape = () => {
				this.editing = undefined;
				this.rebuild(itemId);
			};
			this.rebuild(itemId);
			return;
		}
		this.config = handleSettingChange(this.tab, itemId, this.config);
		this.onChange(this.config);
		this.rebuild(itemId);
	}

	private saveBorderText(field: BorderTextField, value: string): void {
		const copy = COPY[this.config.settingsLanguage];
		value = value.trim();
		let error: string | undefined;
		if (value) {
			if (field === "color") {
				try { this.theme.fg(value as ThemeColor, ""); }
				catch { error = copy.invalidColor; }
			} else if (/[\x00-\x1f\x7f-\x9f]/u.test(value) || visibleWidth(value) !== 1) {
				error = copy.invalidChar;
			}
		}
		if (error && this.editing) {
			this.editing.error = error;
			this.rebuild(field);
			return;
		}
		const border = { ...presentationBorder(this.config, this.tab) };
		if (field === "color") {
			if (value) border.color = value;
			else delete border.color;
		} else {
			const edge = BORDER_TEXT_EDGES[field];
			border[edge] = { enabled: border[edge]?.enabled ?? false, ...border[edge] };
			if (value) border[edge].char = value;
			else delete border[edge].char;
		}
		this.config = withPresentationBorder(this.config, this.tab, border);
		this.editing = undefined;
		this.onChange(this.config);
		this.rebuild(field);
	}

	private switchTab(offset: number): void {
		const idx = TABS.indexOf(this.tab);
		this.tab = TABS[(idx + offset + TABS.length) % TABS.length]!;
		this.rebuild();
	}

	private rebuild(preferredItemId = this.selectedItemByTab[this.tab]): void {
		const copy = COPY[this.config.settingsLanguage];
		this.container.clear();
		this.container.addChild(new Text(this.theme.bold(this.theme.fg("accent", copy.title)), 1, 0));

		const tabBar = TABS.map((tab) => {
			const active = tab === this.tab;
			const label = active ? `[${copy.tabs[tab]}]` : ` ${copy.tabs[tab]} `;
			return active ? this.theme.fg("accent", label) : this.theme.fg("dim", label);
		}).join(" ");
		this.container.addChild(new Text(tabBar, 1, 0));
		this.container.addChild(new Text(this.theme.fg("dim", this.editing ? copy.editHint : copy.hint), 1, 0));
		if (this.tab === "toolBorder" || this.tab === "userBorder") this.container.addChild(new Text(this.theme.fg("muted", copy.scope[this.tab]), 1, 0));

		if (this.editing) {
			const { field, input, error } = this.editing;
			const label = field === "color" ? copy.labels.borderColor : copy.labels[field];
			this.container.addChild(new Text(label, 1, 0));
			this.container.addChild(new Text(this.theme.fg("muted", field === "color" ? copy.colorHint : copy.charHint), 1, 0));
			this.container.addChild(input);
			if (error) this.container.addChild(new Text(this.theme.fg("error", error), 1, 0));
			this.cachedWidth = undefined;
			this.cachedLines = undefined;
			return;
		}
		const items = buildItems(this.tab, this.config).map((item) => ({
			value: item.id,
			label: this.compact ? `${item.label}: ${item.currentValue}` : item.label,
			description: this.compact ? undefined : item.currentValue,
		} as SelectItem));
		this.selectList = new SelectList(items, Math.min(items.length, 12), {
			selectedPrefix: (t) => this.theme.fg("accent", t),
			selectedText: (t) => this.theme.fg("accent", t),
			description: (t) => this.theme.fg("muted", t),
			scrollInfo: (t) => this.theme.fg("dim", t),
			noMatch: (t) => this.theme.fg("warning", t),
		});
		const selectedIndex = items.findIndex((item) => item.value === preferredItemId);
		if (selectedIndex >= 0) {
			this.selectList.setSelectedIndex(selectedIndex);
		}
		this.selectedItemByTab[this.tab] = this.selectList.getSelectedItem()?.value;
		this.selectList.onSelectionChange = (item) => {
			this.selectedItemByTab[this.tab] = item.value;
		};
		this.selectList.onSelect = (item) => {
			this.applySetting(item.value);
		};
		this.selectList.onCancel = () => {
			this.onClose();
		};
		this.container.addChild(this.selectList);

		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	handleInput(data: string): void {
		if (this.editing) {
			this.editing.input.handleInput(data);
			this.invalidate();
			return;
		}
		if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
			this.switchTab(1);
			this.invalidate();
			return;
		}
		if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
			this.switchTab(-1);
			this.invalidate();
			return;
		}
		if (matchesKey(data, Key.escape) || matchesKey(data, "q")) {
			this.onClose();
			return;
		}
		if (matchesKey(data, Key.space) || data === " ") {
			const selected = this.selectList.getSelectedItem();
			if (selected) this.applySetting(selected.value);
		} else {
			this.selectList.handleInput?.(data);
		}
		this.invalidate();
	}

	render(width: number): string[] {
		const compact = width <= 60;
		if (compact !== this.compact) {
			this.compact = compact;
			this.rebuild();
		}
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		this.cachedWidth = width;
		this.cachedLines = this.container.render(width);
		return this.cachedLines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
		this.container.invalidate();
	}
}

export function registerSettingsCommand(
	pi: ExtensionAPI,
	hooks: {
		getConfig: () => OpenTuiConfig;
		onConfigChanged: (config: OpenTuiConfig) => void;
		onOverlayClosed?: () => void;
	},
): void {
	pi.registerCommand("open-tui", {
		description: "Open the open-tui settings UI",
		handler: async (_args, ctx: ExtensionContext) => {
			if (!ctx.hasUI) return;
		await ctx.ui.custom<void>((tui: TUI, theme, _kb, done) => {
			const ui = new SettingsUi(
				theme,
				hooks.getConfig(),
				(config) => hooks.onConfigChanged(config),
				() => done(undefined),
			);
			return {
				get focused() { return ui.focused; },
				set focused(value: boolean) { ui.focused = value; },
				render: (w: number) => ui.render(w),
				invalidate: () => ui.invalidate(),
				handleInput: (data: string) => {
					ui.handleInput(data);
					tui.requestRender();
				},
			};
		}, { overlay: true });
		// Overlay is closed and focus is back on the editor. Deferred UI changes
		// (e.g. toggling the extension) run here, so pi core's focus restore
		// cannot strand the overlay without keyboard input.
		hooks.onOverlayClosed?.();
		},
	});
}
