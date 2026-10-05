import { defineConfig } from "rolldown";

export default defineConfig({
	input: "src/cli.ts",
	platform: "node",
	external: [/^node:/],
	output: {
		dir: "dist",
		format: "esm",
		sourcemap: true,
		cleanDir: true,
	},
});
