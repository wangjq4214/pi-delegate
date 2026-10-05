import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const manifest = (path: string) =>
	JSON.parse(readFileSync(resolve(root, path, "package.json"), "utf8"));

test("the private Bun workspace contains independent delegate and application packages", () => {
	const workspace = manifest(".");
	const delegate = manifest("packages/pi-delegate");
	const ui = manifest("packages/pi-open-tui");
	expect(workspace.private).toBe(true);
	expect(workspace.workspaces).toEqual(["packages/*"]);
	expect(workspace.pi).toBeUndefined();
	expect(delegate.name).toBe("@wangjq4214/pi-delegate");
	expect(ui.name).toBe("@wangjq4214/pi-open-tui");
	expect(ui.private).toBe(true);
	expect(ui.pi).toBeUndefined();
	for (const field of [
		"dependencies",
		"devDependencies",
		"peerDependencies",
		"optionalDependencies",
	]) {
		expect(delegate[field]?.[ui.name]).toBeUndefined();
		expect(ui[field]?.[delegate.name]).toBeUndefined();
	}
	for (const script of ["build", "typecheck", "test"])
		expect(workspace.scripts[script]).toContain("--workspaces --sequential");
	for (const script of ["build", "dev", "start", "typecheck", "test"])
		expect(ui.scripts[script]).toBeString();
});

test("delegate retains its public Pi manifest and publication boundary", () => {
	const delegate = manifest("packages/pi-delegate");
	expect(delegate.version).toBe("0.1.0");
	expect(delegate.pi).toEqual({
		extensions: ["./dist/index.js"],
		skills: ["./skills"],
	});
	expect(delegate.publishConfig.access).toBe("public");
	expect(delegate.files).toEqual([
		"dist",
		"skills",
		"docs",
		"README.md",
		"README.zh-CN.md",
	]);
	expect(delegate.peerDependencies).toEqual({
		"@earendil-works/pi-ai": "*",
		"@earendil-works/pi-coding-agent": "*",
		"@earendil-works/pi-tui": "*",
	});
});
