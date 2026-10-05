import { defineConfig } from "rolldown";

export default defineConfig({
	input: "src/index.ts",
	platform: "node",
	external: [/^node:/, /^@earendil-works\//],
	output: {
		dir: "dist",
		format: "esm",
		sourcemap: true,
		cleanDir: true,
	},
});
