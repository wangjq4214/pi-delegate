import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerChild } from "./child.ts";
import { registerDelegate } from "./delegate.ts";
import { CHILD_ENV } from "./inheritance.ts";

export default function extension(pi: ExtensionAPI): void {
	if (process.env[CHILD_ENV] === "1") registerChild(pi);
	else registerDelegate(pi);
}
