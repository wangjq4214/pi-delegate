import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Loaded after delegate: hold navigation AFTER its before-tree invalidation.
export default function lifecycleGate(pi: ExtensionAPI): void {
	if (process.env.PI_DELEGATE_CHILD === "1") return;
	const directory = process.env.BACKGROUND_FIXTURE_DIR;
	if (!directory) throw new Error("Missing lifecycle fixture directory");
	pi.on("session_before_tree", async () => {
		writeFileSync(join(directory, "tree-entered"), "ready");
		const deadline = Date.now() + 8000;
		while (!existsSync(join(directory, "tree-release"))) {
			if (Date.now() >= deadline)
				throw new Error("Lifecycle tree gate timed out");
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	});
}
