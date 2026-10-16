import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CHILD_ENV } from "./inheritance.ts";

export default async function extension(pi: ExtensionAPI): Promise<void> {
	if (process.env[CHILD_ENV] === "1") {
		const { registerChild } = await import("./child.ts");
		registerChild(pi);
	} else {
		const { registerDelegate } = await import("./delegate.ts");
		registerDelegate(pi);
	}
}
