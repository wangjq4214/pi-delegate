import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const manifest = (path: string) =>
	JSON.parse(readFileSync(resolve(root, path, "package.json"), "utf8"));

test("the private Bun workspace contains independent delegate and UI extension packages", () => {
	const workspace = manifest(".");
	const delegate = manifest("packages/pi-delegate");
	const ui = manifest("packages/pi-open-tui");
	expect(workspace.private).toBe(true);
	expect(workspace.workspaces).toEqual(["packages/*"]);
	expect(workspace.pi).toBeUndefined();
	expect(delegate.name).toBe("@wangjq4214/pi-delegate");
	expect(ui.name).toBe("@wangjq4214/pi-open-tui");
	expect(ui.private).toBeUndefined();
	expect(ui.publishConfig.access).toBe("public");
	expect(ui.version).toBe(delegate.version);
	expect(ui.license).toBe("MIT");
	expect(ui.pi.extensions).toEqual(["./dist/index.js"]);
	expect(ui.scripts.build).toBe("rolldown -c");
	expect(ui.scripts.dev).toBe("pi -e ./src/index.ts");
	expect(existsSync(resolve(root, "packages/pi-open-tui/src/index.ts"))).toBe(
		true,
	);
	expect(existsSync(resolve(root, "packages/pi-open-tui/extensions"))).toBe(
		false,
	);
	expect(ui.scripts.start).toBe("pi -e ./dist/index.js");
	expect(ui.scripts.test).toStartWith("node --test ");
	expect(ui.files).not.toContain("LICENSE");
	expect(ui.files).not.toContain("assets/");
	expect(ui.pi.image).toBeUndefined();
	expect(ui.files).toContain("dist");
	expect(ui.files).not.toContain("extensions/");
	for (const pkg of [delegate, ui]) {
		expect(pkg.scripts.build).toBe("rolldown -c");
		expect(pkg.scripts["build:watch"]).toBe("rolldown -c --watch");
		expect(pkg.scripts.prepack).toBe("bun run build");
		expect(pkg.scripts.start).toBe("pi -e ./dist/index.js");
	}
	expect(workspace.license).toBe("MIT");
	expect(delegate.license).toBe("MIT");
	const license = readFileSync(resolve(root, "LICENSE"), "utf8");
	expect(license).toContain("MIT License");
	expect(license).toContain("Copyright (c) 2026 wangjq4214");
	expect(license).toContain("Copyright (c) 2026 pi-open-tui contributors");
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
	expect(delegate.version).toMatch(/^\d+\.\d+\.\d+$/);
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

test("dollar skills is a public independently loadable Pi extension", () => {
	const dollar = manifest("packages/pi-dollar-skills");
	expect(dollar.name).toBe("@wangjq4214/pi-dollar-skills");
	expect(dollar.private).toBeUndefined();
	expect(dollar.publishConfig.access).toBe("public");
	expect(dollar.repository.directory).toBe("packages/pi-dollar-skills");
	expect(dollar.pi.extensions).toEqual(["./dist/index.js"]);
	expect(dollar.scripts.build).toBe("rolldown -c");
	expect(dollar.scripts.typecheck).toBe("tsc --noEmit");
	for (const other of ["@wangjq4214/pi-delegate", "@wangjq4214/pi-open-tui"]) {
		for (const field of [
			"dependencies",
			"devDependencies",
			"peerDependencies",
		]) {
			expect(dollar[field]?.[other]).toBeUndefined();
		}
	}
	for (const host of [
		"@earendil-works/pi-coding-agent",
		"@earendil-works/pi-ai",
		"@earendil-works/pi-tui",
	]) {
		expect(dollar.dependencies?.[host]).toBeUndefined();
		expect(dollar.peerDependencies[host]).toBe("*");
	}
});
