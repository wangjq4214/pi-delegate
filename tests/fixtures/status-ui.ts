import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type ExtensionUIContext,
	getPackageDir,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Container,
	type Terminal,
	Text,
	TuiMainScreen,
} from "@earendil-works/pi-tui";

/** Real Pi 1.0.0 widget adapter methods and TUI renderer, with an in-memory terminal transport.
 * Not a full InteractiveMode startup, keyboard/input or manual visual E2E test.
 */
export async function statusUI() {
	const { InteractiveMode } = await import(
		pathToFileURL(
			join(getPackageDir(), "dist/modes/interactive/interactive-mode.js"),
		).href
	);
	let output = "";
	const terminal: Terminal = {
		columns: 160,
		rows: 40,
		kittyProtocolActive: false,
		start() {},
		stop() {},
		async drainInput() {},
		write: (data) => {
			output += data;
		},
		moveBy() {},
		hideCursor() {},
		showCursor() {},
		clearLine() {},
		clearFromCursor() {},
		clearScreen() {},
		setTitle() {},
		setProgress() {},
	};
	const tui = new TuiMainScreen(terminal);
	const above = new Container();
	const below = new Container();
	const methods = InteractiveMode.prototype;
	const receiver = {
		ui: tui,
		extensionWidgetsAbove: new Map<string, Component>(),
		extensionWidgetsBelow: new Map<string, Component>(),
		widgetContainerAbove: above,
		widgetContainerBelow: below,
		renderWidgets: methods.renderWidgets,
		renderWidgetContainer: methods.renderWidgetContainer,
	};
	tui.addChild(above);
	tui.addChild(new Text("INPUT SENTINEL", 0, 0));
	tui.addChild(below);
	const setWidget: ExtensionUIContext["setWidget"] = (key, content, options) =>
		methods.setExtensionWidget.call(receiver, key, content, options);
	return {
		ui: { setWidget } as ExtensionUIContext,
		frame: (width = 160) => tui.render(width).join("\n"),
		tui,
		output: () => output,
		above: receiver.extensionWidgetsAbove,
		below: receiver.extensionWidgetsBelow,
	};
}
