import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	loadPackages,
	packageDirectories,
	publishArtifacts,
	published,
	type ReleasePackage,
	type Request,
	type Run,
	repository,
	verifyArtifacts,
	verifyTarball,
	versionFromTag,
} from "../scripts/release.ts";

const root = resolve(import.meta.dir, "..");
const temporary: string[] = [];
afterEach(() => {
	for (const directory of temporary.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "pi-release-"));
	temporary.push(directory);
	const output = join(directory, "dist/release");
	mkdirSync(output, { recursive: true });
	writeFileSync(
		join(directory, "package.json"),
		JSON.stringify({ private: true }),
	);
	writeFileSync(join(directory, "LICENSE"), "MIT fixture\n");
	for (const name of packageDirectories) {
		const cwd = join(directory, "packages", name);
		mkdirSync(join(cwd, "dist"), { recursive: true });
		const files = ["dist", "README.md", "README.zh-CN.md"];
		const pi: { extensions: string[]; skills?: string[] } = {
			extensions: ["./dist/index.js"],
		};
		if (name !== "pi-dollar-skills") {
			files.push("docs");
			mkdirSync(join(cwd, "docs"));
			writeFileSync(join(cwd, "docs/guide.md"), "guide");
		}
		if (name === "pi-delegate") {
			files.push("skills");
			pi.skills = ["./skills"];
			mkdirSync(join(cwd, "skills/worktree"), { recursive: true });
			writeFileSync(join(cwd, "skills/worktree/SKILL.md"), "skill");
		}
		writeFileSync(join(cwd, "README.md"), "readme");
		writeFileSync(join(cwd, "README.zh-CN.md"), "说明");
		writeFileSync(join(cwd, "dist/index.js"), "export default () => {};\n");
		writeFileSync(join(cwd, "dist/LICENSE"), "MIT fixture\n");
		writeFileSync(
			join(cwd, "package.json"),
			JSON.stringify({
				name: `@wangjq4214/${name}`,
				version: "1.2.3",
				type: "module",
				publishConfig: { access: "public" },
				repository: {
					type: "git",
					url: `git+https://github.com/${repository}.git`,
					directory: `packages/${name}`,
				},
				files,
				pi,
				scripts: { prepack: "node -e 'process.exit(99)'" },
			}),
		);
	}
	const packages = loadPackages(directory, "v1.2.3");
	for (const pkg of packages)
		writeFileSync(join(output, pkg.filename), `fixture ${pkg.manifest.name}`);
	return { directory, output, packages };
}

function manifestChange(pkg: ReleasePackage, change: Record<string, unknown>) {
	writeFileSync(
		join(pkg.directory, "package.json"),
		JSON.stringify({ ...pkg.manifest, ...change }),
	);
}

function archiveFiles(pkg: ReleasePackage): string[] {
	const walk = (prefix: string): string[] =>
		readdirSync(join(pkg.directory, prefix), { withFileTypes: true }).flatMap(
			(entry) =>
				entry.isDirectory()
					? walk(`${prefix}/${entry.name}`)
					: [`${prefix}/${entry.name}`],
		);
	return [
		"package.json",
		...pkg.manifest.files.flatMap((file) =>
			file.includes(".") ? [file] : walk(file),
		),
	];
}

const archiveRun: Run = (command, args, cwd) => {
	if (command !== "tar") throw new Error(`Unexpected command: ${command}`);
	if (args[0] === "-tzf") {
		const manifest = JSON.parse(
			readFileSync(join(cwd, "package.json"), "utf8"),
		);
		return archiveFiles({ directory: cwd, manifest, filename: "" })
			.map((file) => `package/${file}`)
			.join("\n");
	}
	return readFileSync(join(cwd, args[2].slice("package/".length)), "utf8");
};

test.each(["v0.0.0", "v1.2.3", "v10.20.300"])(
	"accepts stable tag %s",
	(tag) => {
		expect(versionFromTag(tag)).toBe(tag.slice(1));
	},
);

test.each([
	"",
	"main",
	"1.2.3",
	"v1.2",
	"v01.2.3",
	"v1.2.3-beta.1",
	"v1.2.3+build",
	"v1.2.3\n",
	"v1.2.3;echo bad",
	"v9007199254740992.0.0",
])("rejects non-release tag %j", (tag) =>
	expect(() => versionFromTag(tag)).toThrow(),
);

test("validates all identities and versions before packaging or publication", () => {
	const f = fixture();
	expect(
		loadPackages(f.directory, "v1.2.3").map((pkg) => pkg.manifest.name),
	).toEqual(packageDirectories.map((name) => `@wangjq4214/${name}`));
	manifestChange(f.packages[2], { version: "0.1.0" });
	expect(() => loadPackages(f.directory, "v1.2.3")).toThrow(
		"expected public 1.2.3",
	);
});

test.each([
	{ private: true },
	{ publishConfig: { access: "restricted" } },
	{ name: "@other/package" },
	{ repository: { url: "https://example.com" } },
	{ pi: { extensions: ["./src/index.ts"] } },
	{ files: ["../outside", "dist"] },
])("rejects invalid publication manifest %j", (change) => {
	const f = fixture();
	manifestChange(f.packages[2], change);
	expect(() => loadPackages(f.directory, "v1.2.3")).toThrow();
});

test("refuses a publishable workspace root", () => {
	const f = fixture();
	writeFileSync(join(f.directory, "package.json"), "{}");
	expect(() => loadPackages(f.directory, "v1.2.3")).toThrow(
		"root must remain private",
	);
});

test("checks actual archive identity, license, entry, docs and bundled skills", () => {
	const f = fixture();
	expect(() => verifyArtifacts(f.packages, f.output, archiveRun)).not.toThrow();
	const pkg = f.packages[0];
	const file = join(f.output, pkg.filename);
	for (const missing of [
		"dist/index.js",
		"dist/LICENSE",
		"docs/guide.md",
		"skills/worktree/SKILL.md",
		"README.md",
	]) {
		const run: Run = (command, args, cwd) =>
			args[0] === "-tzf"
				? archiveRun(command, args, cwd)
						.split("\n")
						.filter((line) => line !== `package/${missing}`)
						.join("\n")
				: archiveRun(command, args, cwd);
		expect(() => verifyTarball(pkg, file, run)).toThrow("Missing shipped file");
	}
});

test.each([
	"package/src/secret.ts",
	"../escape",
	"package/dist/../../escape",
	"package/dist/node_modules/a",
	"package/dist/.env",
])("rejects unexpected or unsafe archive member %s", (extra) => {
	const f = fixture();
	const run: Run = (command, args, cwd) =>
		args[0] === "-tzf"
			? `${archiveRun(command, args, cwd)}\n${extra}`
			: archiveRun(command, args, cwd);
	expect(() => verifyTarball(f.packages[0], "fixture.tgz", run)).toThrow();
});

test("rejects duplicate archive entries, altered manifest/license, empty bundle and stale artifacts", () => {
	const f = fixture();
	const pkg = f.packages[0];
	const duplicate: Run = (command, args, cwd) =>
		args[0] === "-tzf"
			? `${archiveRun(command, args, cwd)}\npackage/dist/index.js`
			: archiveRun(command, args, cwd);
	expect(() => verifyTarball(pkg, "fixture.tgz", duplicate)).toThrow(
		"Duplicate",
	);
	const wrongManifest: Run = (command, args, cwd) =>
		args[2] === "package/package.json"
			? JSON.stringify({ ...pkg.manifest, version: "9.9.9" })
			: archiveRun(command, args, cwd);
	expect(() => verifyTarball(pkg, "fixture.tgz", wrongManifest)).toThrow(
		"Packed manifest differs",
	);
	writeFileSync(join(pkg.directory, "dist/LICENSE"), "different");
	expect(() => verifyTarball(pkg, "fixture.tgz", archiveRun)).toThrow(
		"license differs",
	);
	writeFileSync(join(pkg.directory, "dist/LICENSE"), "MIT fixture\n");
	writeFileSync(join(pkg.directory, "dist/index.js"), " ");
	expect(() => verifyTarball(pkg, "fixture.tgz", archiveRun)).toThrow(
		"Empty built Pi entry",
	);
	writeFileSync(join(f.output, "stale.tgz"), "");
	expect(() => verifyArtifacts(f.packages, f.output, archiveRun)).toThrow(
		"exactly the three",
	);
});

test("real npm pack and tar inspection work under Node without executing lifecycle scripts", () => {
	const f = fixture();
	rmSync(f.output, { recursive: true });
	const moduleUrl = pathToFileURL(join(root, "scripts/release.ts")).href;
	const source = `import { loadPackages, packArtifacts } from ${JSON.stringify(moduleUrl)};
packArtifacts(loadPackages(${JSON.stringify(f.directory)}, "v1.2.3"), ${JSON.stringify(f.output)});`;
	execFileSync("node", ["--input-type=module", "-e", source], {
		encoding: "utf8",
	});
	expect(readdirSync(f.output).sort()).toEqual(
		f.packages.map((pkg) => pkg.filename).sort(),
	);
}, 30_000);

test.each([401, 403, 429, 500, 503])(
	"npm HTTP %i fails closed",
	async (status) => {
		const pkg = fixture().packages[0];
		await expect(
			published(pkg, async () => new Response("", { status })),
		).rejects.toThrow("lookup failed");
	},
);

test("only a real package/version match is published; network and JSON failures propagate", async () => {
	const pkg = fixture().packages[0];
	expect(
		await published(pkg, async () => new Response("", { status: 404 })),
	).toBe(false);
	expect(await published(pkg, async () => Response.json(pkg.manifest))).toBe(
		true,
	);
	await expect(
		published(pkg, async () =>
			Response.json({ name: pkg.manifest.name, version: "other" }),
		),
	).rejects.toThrow("different package");
	await expect(
		published(pkg, async () => new Response("not json")),
	).rejects.toThrow();
	await expect(
		published(pkg, async () => {
			throw new Error("offline");
		}),
	).rejects.toThrow("offline");
});

function services(f: ReturnType<typeof fixture>) {
	const available = new Set<string>();
	const attempts: string[] = [];
	const calls: string[] = [];
	const sleeps: number[] = [];
	let elapsed = 0;
	const clock = {
		now: () => elapsed,
		sleep: async (ms: number) => {
			sleeps.push(ms);
			elapsed += ms;
		},
	};
	const uploadedAt = new Map<string, number>();
	type FakeRelease = {
		id: number;
		tag_name: string;
		draft: boolean;
		prerelease: boolean;
		assets: { id: number; name: string; digest: string }[];
	};
	const state = {
		release: undefined as FakeRelease | undefined,
		failPackage: "",
		failUpload: 0,
		failCreate: false,
		failFinalize: false,
		lookupStatus: 0,
		visibilityDelayMs: 0,
		creates: 0,
		uploads: 0,
	};
	const run: Run = (command, args, cwd) => {
		if (command === "tar") return archiveRun(command, args, cwd);
		expect(command).toBe("npm");
		expect(args[0]).toBe("publish");
		expect(args).toContain("--ignore-scripts");
		expect(args).toContain("https://registry.npmjs.org");
		const pkg = f.packages.find((pkg) => pkg.filename === basename(args[1]));
		if (!pkg) throw new Error("Unexpected tarball");
		attempts.push(pkg.manifest.name);
		if (state.failPackage === pkg.manifest.name)
			throw new Error("npm authentication/publication failed");
		available.add(pkg.manifest.name);
		uploadedAt.set(pkg.manifest.name, elapsed);
		return "";
	};
	const http: Request = async (url, init) => {
		const parsed = new URL(url);
		const method = init?.method ?? "GET";
		calls.push(`${method} ${url}`);
		if (parsed.hostname === "registry.npmjs.org") {
			if (state.lookupStatus)
				return new Response("", { status: state.lookupStatus });
			const name = decodeURIComponent(parsed.pathname.slice(1).split("/")[0]);
			const uploaded = uploadedAt.get(name);
			if (
				uploaded !== undefined &&
				elapsed - uploaded < state.visibilityDelayMs
			)
				return new Response("", { status: 404 });
			return available.has(name)
				? Response.json({ name, version: "1.2.3" })
				: new Response("", { status: 404 });
		}
		expect(new Headers(init?.headers).get("Authorization")).toBe(
			"Bearer fake-token",
		);
		if (method === "GET" && parsed.pathname.includes("/tags/")) {
			return state.release && !state.release.draft
				? Response.json(state.release)
				: new Response("", { status: 404 });
		}
		if (method === "GET" && parsed.searchParams.has("page"))
			return Response.json(state.release ? [state.release] : []);
		if (method === "POST" && parsed.hostname === "api.github.com") {
			if (state.failCreate) return new Response("", { status: 500 });
			expect(available.size).toBe(3);
			const body = JSON.parse(String(init?.body));
			expect(body.generate_release_notes).toBe(true);
			expect(body.draft).toBe(true);
			state.creates++;
			state.release = {
				id: 42,
				tag_name: body.tag_name,
				draft: true,
				prerelease: false,
				assets: [],
			};
			return Response.json(state.release, { status: 201 });
		}
		if (method === "DELETE") {
			const id = Number(parsed.pathname.split("/").at(-1));
			if (!state.release) throw new Error("No release");
			state.release.assets = state.release.assets.filter(
				(asset) => asset.id !== id,
			);
			return new Response(null, { status: 204 });
		}
		if (parsed.hostname === "uploads.github.com") {
			state.uploads++;
			if (state.uploads === state.failUpload)
				return new Response("", { status: 502 });
			const name = parsed.searchParams.get("name");
			if (!state.release || !name) throw new Error("No release/name");
			expect(state.release.assets.some((asset) => asset.name === name)).toBe(
				false,
			);
			const digest = `sha256:${createHash("sha256")
				.update(init?.body as Uint8Array)
				.digest("hex")}`;
			state.release.assets.push({ id: state.uploads, name, digest });
			return Response.json({}, { status: 201 });
		}
		if (method === "PATCH") {
			if (state.failFinalize) return new Response("", { status: 500 });
			if (!state.release) throw new Error("No release");
			expect(state.release.assets).toHaveLength(3);
			state.release.draft = false;
			return Response.json(state.release);
		}
		throw new Error(`Unexpected HTTP: ${method} ${url}`);
	};
	const publish = () =>
		publishArtifacts(
			f.packages,
			"v1.2.3",
			f.output,
			"fake-token",
			run,
			http,
			clock,
		);
	return {
		available,
		attempts,
		calls,
		state,
		run,
		http,
		publish,
		clock,
		sleeps,
	};
}

test("successful release publishes exactly the checked tarballs then finalizes one Release", async () => {
	const f = fixture();
	const s = services(f);
	await s.publish();
	expect(s.attempts).toHaveLength(3);
	expect(s.state.release?.draft).toBe(false);
	expect(s.state.release?.assets.map((asset) => asset.name).sort()).toEqual(
		f.packages.map((pkg) => pkg.filename).sort(),
	);
	await s.publish();
	expect(s.attempts).toHaveLength(3);
	expect(s.state.creates).toBe(1);
	expect(s.state.uploads).toBe(3);
});

test("npm processing delays are polled without republishing and Release waits for visibility", async () => {
	const f = fixture();
	const s = services(f);
	s.state.visibilityDelayMs = 30_000;
	await s.publish();
	expect(s.attempts).toEqual(f.packages.map((pkg) => pkg.manifest.name));
	expect(s.sleeps).toEqual(Array(6).fill(15_000));
	expect(s.state.release?.draft).toBe(false);
	const firstGitHubCall = s.calls.findIndex(
		(call) => !call.includes("registry.npmjs.org"),
	);
	expect(firstGitHubCall).toBe(12); // Preflight + 404 + 404 + visible, per package.
	await s.publish();
	expect(s.attempts).toHaveLength(3);
	expect(s.sleeps).toHaveLength(6);
});

test("npm visibility timeout blocks Release and a later rerun skips the accepted version", async () => {
	const f = fixture();
	const s = services(f);
	s.state.visibilityDelayMs = 21 * 60_000;
	await expect(s.publish()).rejects.toThrow(
		`Timed out waiting for npm publication: ${f.packages[0].manifest.name}@1.2.3`,
	);
	expect(s.clock.now()).toBe(20 * 60_000);
	expect(s.sleeps).toEqual(Array(80).fill(15_000));
	expect(s.attempts).toEqual([f.packages[0].manifest.name]);
	expect(s.calls.every((call) => call.includes("registry.npmjs.org"))).toBe(
		true,
	);
	expect(s.state.creates).toBe(0);
	s.state.visibilityDelayMs = 0;
	await s.publish();
	expect(s.attempts).toEqual(f.packages.map((pkg) => pkg.manifest.name));
	expect(s.state.release?.draft).toBe(false);
});

test.each([401, 403, 429, 500, 503])(
	"npm HTTP %i during visibility polling aborts without republishing or Release writes",
	async (status) => {
		const f = fixture();
		const s = services(f);
		let postUploadLookups = 0;
		const http: Request = async (url, init) => {
			if (url.includes("registry.npmjs.org") && s.attempts.length > 0) {
				postUploadLookups++;
				return new Response("", {
					status: postUploadLookups === 1 ? 404 : status,
				});
			}
			return s.http(url, init);
		};
		await expect(
			publishArtifacts(
				f.packages,
				"v1.2.3",
				f.output,
				"fake-token",
				s.run,
				http,
				s.clock,
			),
		).rejects.toThrow(`npm lookup failed: HTTP ${status}`);
		expect(postUploadLookups).toBe(2);
		expect(s.sleeps).toEqual([15_000]);
		expect(s.attempts).toHaveLength(1);
		expect(s.state.creates).toBe(0);
	},
);

test.each(["network", "JSON", "identity"])(
	"npm %s failure during visibility polling is not treated as pending or successful",
	async (failure) => {
		const f = fixture();
		const s = services(f);
		const http: Request = async (url, init) => {
			if (url.includes("registry.npmjs.org") && s.attempts.length > 0) {
				if (failure === "network") throw new Error("offline");
				if (failure === "JSON") return new Response("not json");
				return Response.json({
					name: f.packages[0].manifest.name,
					version: "other",
				});
			}
			return s.http(url, init);
		};
		await expect(
			publishArtifacts(
				f.packages,
				"v1.2.3",
				f.output,
				"fake-token",
				s.run,
				http,
				s.clock,
			),
		).rejects.toThrow();
		expect(s.sleeps).toHaveLength(0);
		expect(s.attempts).toHaveLength(1);
		expect(s.state.creates).toBe(0);
	},
);

test("partial npm failure creates no Release and rerun skips successful immutable versions", async () => {
	const f = fixture();
	const s = services(f);
	s.state.failPackage = f.packages[1].manifest.name;
	await expect(s.publish()).rejects.toThrow("npm authentication");
	expect(s.available.size).toBe(1);
	expect(s.state.creates).toBe(0);
	s.state.failPackage = "";
	await s.publish();
	expect(
		s.attempts.filter((name) => name === f.packages[0].manifest.name),
	).toHaveLength(1);
	expect(s.state.release?.draft).toBe(false);
});

test.each(["create", "upload", "finalize"])(
	"recovers GitHub %s failure without republishing or duplicate releases/assets",
	async (failure) => {
		const f = fixture();
		const s = services(f);
		s.state.failCreate = failure === "create";
		s.state.failUpload = failure === "upload" ? 2 : 0;
		s.state.failFinalize = failure === "finalize";
		await expect(s.publish()).rejects.toThrow("GitHub");
		expect(s.available.size).toBe(3);
		expect(s.state.release?.draft ?? true).toBe(true);
		s.state.failCreate = false;
		s.state.failUpload = 0;
		s.state.failFinalize = false;
		await s.publish();
		expect(s.attempts).toHaveLength(3);
		expect(s.state.creates).toBe(1);
		expect(s.state.release?.assets).toHaveLength(3);
		expect(s.state.release?.draft).toBe(false);
	},
);

test("replaces an incomplete same-name GitHub asset instead of duplicating it", async () => {
	const f = fixture();
	const s = services(f);
	await s.publish();
	if (!s.state.release) throw new Error("No Release");
	s.state.release.assets[0].digest = "sha256:bad";
	await s.publish();
	expect(s.state.release.assets).toHaveLength(3);
	expect(s.state.uploads).toBe(4);
	expect(s.calls.some((call) => call.startsWith("DELETE "))).toBe(true);
});

test("registry errors and invalid artifacts block publication and GitHub writes", async () => {
	const f = fixture();
	const s = services(f);
	s.state.lookupStatus = 403;
	await expect(s.publish()).rejects.toThrow("lookup failed");
	expect(s.attempts).toHaveLength(0);
	expect(s.state.creates).toBe(0);
	s.state.lookupStatus = 0;
	rmSync(join(f.output, f.packages[2].filename));
	await expect(s.publish()).rejects.toThrow("exactly the three");
	expect(s.calls.every((call) => call.includes("registry.npmjs.org"))).toBe(
		true,
	);
	expect(s.attempts).toHaveLength(0);
});

test("workflow connects read-only gates to OIDC publication on the exact tagged revision", () => {
	interface Step {
		uses?: string;
		run?: string;
		with?: Record<string, unknown>;
		env?: Record<string, unknown>;
	}
	interface Job {
		needs?: string;
		permissions?: Record<string, string>;
		steps: Step[];
	}
	const yaml = readFileSync(
		join(root, ".github/workflows/release.yml"),
		"utf8",
	);
	const workflow = Bun.YAML.parse(yaml) as {
		on: { push: { tags: string[] } };
		permissions: Record<string, string>;
		concurrency: { "cancel-in-progress": boolean };
		jobs: { validate: Job; publish: Job };
	};
	expect(workflow.on).toEqual({ push: { tags: ["v[0-9]*"] } });
	expect(workflow.permissions).toEqual({ contents: "read" });
	expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
	const { validate, publish } = workflow.jobs;
	expect(validate.permissions).toBeUndefined();
	expect(publish.needs).toBe("validate");
	expect(publish.permissions).toEqual({
		contents: "write",
		"id-token": "write",
	});
	expect(validate.steps.flatMap((step) => step.run ?? [])).toEqual([
		'node scripts/release.ts validate "$RELEASE_TAG"',
		"bun install --frozen-lockfile",
		"bun run check",
		"bun run typecheck",
		"bun run build",
		"bun run test",
		'node scripts/release.ts pack "$RELEASE_TAG"',
	]);
	for (const job of [validate, publish]) {
		const checkout = job.steps.find((step) =>
			step.uses?.startsWith("actions/checkout@"),
		);
		expect(checkout?.with).toEqual({
			// biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
			ref: "${{ github.sha }}",
			"persist-credentials": false,
		});
	}
	const upload = validate.steps.find((step) =>
		step.uses?.startsWith("actions/upload-artifact@"),
	);
	expect(upload?.with?.overwrite).toBe(true);
	const download = publish.steps.find((step) =>
		step.uses?.startsWith("actions/download-artifact@"),
	);
	expect(download?.with?.name).toBe(upload?.with?.name);
	expect(publish.steps.at(-1)?.run).toBe(
		'node scripts/release.ts publish "$RELEASE_TAG"',
	);
	expect(yaml).not.toContain("NPM_TOKEN");
	expect(yaml).not.toContain("NODE_AUTH_TOKEN");
});

test.each([403, 500])(
	"GitHub lookup HTTP %i never creates a replacement Release",
	async (status) => {
		const f = fixture();
		const s = services(f);
		for (const pkg of f.packages) s.available.add(pkg.manifest.name);
		const http: Request = (url, init) =>
			new URL(url).hostname === "api.github.com"
				? Promise.resolve(new Response("", { status }))
				: s.http(url, init);
		await expect(
			publishArtifacts(
				f.packages,
				"v1.2.3",
				f.output,
				"fake-token",
				s.run,
				http,
			),
		).rejects.toThrow("GitHub release lookup failed");
		expect(s.attempts).toHaveLength(0);
		expect(s.state.creates).toBe(0);
	},
);

test("finds an interrupted draft beyond the first page before creating anything", async () => {
	const f = fixture();
	const s = services(f);
	s.state.failUpload = 1;
	await expect(s.publish()).rejects.toThrow("GitHub asset upload");
	s.state.failUpload = 0;
	let paginated = false;
	const http: Request = (url, init) => {
		const parsed = new URL(url);
		if (parsed.searchParams.get("page") === "1") {
			return Promise.resolve(
				Response.json(
					Array.from({ length: 100 }, (_, id) => ({
						id,
						tag_name: `v0.0.${id}`,
						draft: false,
						prerelease: false,
						assets: [],
					})),
				),
			);
		}
		if (parsed.searchParams.get("page") === "2") paginated = true;
		return s.http(url, init);
	};
	await publishArtifacts(
		f.packages,
		"v1.2.3",
		f.output,
		"fake-token",
		s.run,
		http,
	);
	expect(paginated).toBe(true);
	expect(s.state.creates).toBe(1);
	expect(s.state.release?.draft).toBe(false);
	expect(s.state.release?.assets).toHaveLength(3);
});

test("invalid tag or missing GitHub token stops before npm and Release writes", async () => {
	const f = fixture();
	const s = services(f);
	await expect(
		publishArtifacts(
			f.packages,
			"v1.2.3-beta.1",
			f.output,
			"fake-token",
			s.run,
			s.http,
		),
	).rejects.toThrow("stable");
	await expect(
		publishArtifacts(f.packages, "v1.2.3", f.output, "", s.run, s.http),
	).rejects.toThrow("GITHUB_TOKEN");
	expect(s.attempts).toHaveLength(0);
	expect(s.calls).toHaveLength(0);
});
