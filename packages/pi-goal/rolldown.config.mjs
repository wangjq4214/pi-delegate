import { readFileSync } from "node:fs";
import { defineConfig } from "rolldown";

export default defineConfig({
	input: "src/index.ts",
	platform: "node",
	external: [/^node:/, /^@earendil-works\//, /^@wangjq4214\/pi-delegate/],
	plugins: [
		{
			name: "include-license",
			generateBundle() {
				this.emitFile({
					type: "asset",
					fileName: "LICENSE",
					source: readFileSync(
						new URL("../../LICENSE", import.meta.url),
						"utf8",
					),
				});
			},
		},
	],
	output: { dir: "dist", format: "esm", sourcemap: true, cleanDir: true },
});
