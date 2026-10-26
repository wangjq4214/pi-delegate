import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

export const repository = "wangjq4214/pi-delegate";
export const packageDirectories = [
	"pi-delegate",
	"pi-open-tui",
	"pi-dollar-skills",
] as const;

interface Manifest {
	name: string;
	version: string;
	private?: boolean;
	publishConfig: { access: string };
	repository: { url: string; directory: string };
	files: string[];
	pi: { extensions: string[]; skills?: string[] };
}

export interface ReleasePackage {
	directory: string;
	manifest: Manifest;
	filename: string;
}

export type Run = (command: string, args: string[], cwd: string) => string;
export type Request = (url: string, init?: RequestInit) => Promise<Response>;

export const runCommand: Run = (command, args, cwd) => {
	let executable = command;
	let parameters = args;
	if (process.platform === "win32" && command === "npm") {
		// Windows cannot exec npm.cmd directly; invoke its CLI with Node.
		executable = process.execPath;
		parameters = [
			join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
			...args,
		];
	} else if (process.platform === "win32" && command === "tar") {
		// Git Bash's GNU tar treats drive letters as remote hosts, including
		// archives on another drive. Native bsdtar accepts Windows paths.
		executable = join(
			process.env.SystemRoot ?? "C:\\Windows",
			"System32",
			"tar.exe",
		);
	}
	return execFileSync(executable, parameters, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
	});
};

const request: Request = (url, init) =>
	fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });

export function versionFromTag(tag: string): string {
	if (
		!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag) ||
		tag
			.slice(1)
			.split(".")
			.some((part) => !Number.isSafeInteger(Number(part)))
	) {
		throw new Error(
			`Expected a stable vX.Y.Z tag, received ${JSON.stringify(tag)}`,
		);
	}
	return tag.slice(1);
}

export function loadPackages(root: string, tag: string): ReleasePackage[] {
	const version = versionFromTag(tag);
	if (
		JSON.parse(readFileSync(join(root, "package.json"), "utf8")).private !==
		true
	) {
		throw new Error("Workspace root must remain private");
	}
	return packageDirectories.map((directory) => {
		const manifest: Manifest = JSON.parse(
			readFileSync(join(root, "packages", directory, "package.json"), "utf8"),
		);
		if (
			manifest.name !== `@wangjq4214/${directory}` ||
			manifest.version !== version ||
			manifest.private === true ||
			manifest.publishConfig?.access !== "public"
		) {
			throw new Error(
				`${directory}: expected public ${version}, found ${manifest.version}`,
			);
		}
		if (
			manifest.repository?.url !== `git+https://github.com/${repository}.git` ||
			manifest.repository.directory !== `packages/${directory}`
		) {
			throw new Error(
				`${directory}: repository identity must match the publishing workflow`,
			);
		}
		if (
			!Array.isArray(manifest.files) ||
			manifest.files.some(
				(entry) => !/^[\w.-]+$/.test(entry) || entry === "." || entry === "..",
			) ||
			!manifest.files.includes("dist") ||
			!isDeepStrictEqual(manifest.pi?.extensions, ["./dist/index.js"])
		) {
			throw new Error(`${directory}: unsupported files or Pi entry contract`);
		}
		return {
			directory: join(root, "packages", directory),
			manifest,
			filename: `wangjq4214-${directory}-${version}.tgz`,
		};
	});
}

function sourceFiles(directory: string, prefix: string): string[] {
	return readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap(
		(entry) => {
			const path = `${prefix}/${entry.name}`;
			if (entry.isSymbolicLink())
				throw new Error(`Symlink in shipped files: ${path}`);
			return entry.isDirectory() ? sourceFiles(directory, path) : [path];
		},
	);
}

export function verifyTarball(
	pkg: ReleasePackage,
	file: string,
	run: Run = runCommand,
): void {
	file = resolve(file);
	const members = run("tar", ["-tzf", file], pkg.directory)
		.trim()
		.split(/\r?\n/);
	const files = members
		.filter((path) => !path.endsWith("/"))
		.map((path) => {
			if (
				!path.startsWith("package/") ||
				path.includes("\\") ||
				path
					.split("/")
					.some((part) => ["..", ".", "node_modules", ".env"].includes(part))
			) {
				throw new Error(`Unsafe tarball member: ${path}`);
			}
			return path.slice("package/".length);
		});
	if (new Set(files).size !== files.length)
		throw new Error("Duplicate tarball members");
	const allowed = ["package.json", "LICENSE", ...pkg.manifest.files];
	for (const file of files) {
		if (
			!allowed.some((entry) => file === entry || file.startsWith(`${entry}/`))
		) {
			throw new Error(`Unexpected shipped file: ${file}`);
		}
	}
	const required = ["package.json", "dist/index.js", "dist/LICENSE"];
	for (const entry of pkg.manifest.files.filter((entry) => entry !== "dist")) {
		const path = join(pkg.directory, entry);
		const entryStat = lstatSync(path);
		if (entryStat.isSymbolicLink())
			throw new Error(`Symlink in shipped files: ${path}`);
		required.push(
			...(entryStat.isDirectory()
				? sourceFiles(pkg.directory, entry)
				: [entry]),
		);
	}
	for (const file of required) {
		if (!files.includes(file)) throw new Error(`Missing shipped file: ${file}`);
	}
	const packed: Manifest = JSON.parse(
		run("tar", ["-xOzf", file, "package/package.json"], pkg.directory),
	);
	for (const field of [
		"name",
		"version",
		"private",
		"publishConfig",
		"repository",
		"files",
		"pi",
	] as const) {
		if (!isDeepStrictEqual(packed[field], pkg.manifest[field])) {
			throw new Error(`Packed manifest differs: ${field}`);
		}
	}
	const license = run(
		"tar",
		["-xOzf", file, "package/dist/LICENSE"],
		pkg.directory,
	);
	if (license !== readFileSync(join(pkg.directory, "../../LICENSE"), "utf8")) {
		throw new Error("Packed license differs from repository license");
	}
	if (
		!run("tar", ["-xOzf", file, "package/dist/index.js"], pkg.directory).trim()
	) {
		throw new Error("Empty built Pi entry");
	}
}

export function verifyArtifacts(
	packages: ReleasePackage[],
	output: string,
	run: Run = runCommand,
): void {
	const names = readdirSync(output).sort();
	if (!isDeepStrictEqual(names, packages.map((pkg) => pkg.filename).sort())) {
		throw new Error(
			"Release directory must contain exactly the three expected tarballs",
		);
	}
	for (const pkg of packages)
		verifyTarball(pkg, join(output, pkg.filename), run);
}

export function packArtifacts(
	packages: ReleasePackage[],
	output: string,
	run: Run = runCommand,
): void {
	mkdirSync(output, { recursive: true });
	for (const pkg of packages) {
		// Builds already passed the quality gate; never rebuild during packing/publication.
		run(
			"npm",
			["pack", "--json", "--ignore-scripts", "--pack-destination", output],
			pkg.directory,
		);
	}
	verifyArtifacts(packages, output, run);
}

export async function published(
	pkg: ReleasePackage,
	http: Request = request,
): Promise<boolean> {
	const response = await http(
		`https://registry.npmjs.org/${encodeURIComponent(pkg.manifest.name)}/${pkg.manifest.version}`,
	);
	if (response.status === 404) return false;
	if (!response.ok)
		throw new Error(`npm lookup failed: HTTP ${response.status}`);
	const body = (await response.json()) as { name?: string; version?: string };
	if (
		body.name !== pkg.manifest.name ||
		body.version !== pkg.manifest.version
	) {
		throw new Error("npm lookup returned a different package/version");
	}
	return true;
}

interface Asset {
	id: number;
	name: string;
	digest?: string;
}
interface Release {
	id: number;
	tag_name: string;
	draft: boolean;
	prerelease: boolean;
	assets: Asset[];
}

export async function completeRelease(
	tag: string,
	packages: ReleasePackage[],
	output: string,
	token: string,
	http: Request = request,
): Promise<void> {
	const api = `https://api.github.com/repos/${repository}/releases`;
	const headers = {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	};
	const jsonRequest = async (url: string, method: string, body?: unknown) => {
		const response = await http(url, {
			method,
			headers: { ...headers, "Content-Type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		if (!response.ok)
			throw new Error(`GitHub ${method} failed: HTTP ${response.status}`);
		return response;
	};
	const existing = await http(`${api}/tags/${encodeURIComponent(tag)}`, {
		headers,
	});
	let release: Release | undefined;
	if (existing.status === 404) {
		// The tag endpoint need not expose drafts. List with write-authorized
		// credentials so a retry reuses a draft left by an interrupted upload.
		for (let page = 1; ; page++) {
			const batch = (await (
				await jsonRequest(`${api}?per_page=100&page=${page}`, "GET")
			).json()) as Release[];
			release = batch.find((entry) => entry.tag_name === tag);
			if (release || batch.length < 100) break;
		}
		if (!release)
			release = (await (
				await jsonRequest(api, "POST", {
					tag_name: tag,
					name: tag,
					draft: true,
					prerelease: false,
					generate_release_notes: true,
				})
			).json()) as Release;
	} else {
		if (!existing.ok)
			throw new Error(`GitHub release lookup failed: HTTP ${existing.status}`);
		release = (await existing.json()) as Release;
	}
	if (
		!Number.isSafeInteger(release.id) ||
		release.tag_name !== tag ||
		release.prerelease ||
		!Array.isArray(release.assets)
	) {
		throw new Error("Unexpected GitHub Release identity or prerelease state");
	}
	for (const pkg of packages) {
		const bytes = new Uint8Array(readFileSync(join(output, pkg.filename)));
		const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
		const asset = release.assets.find((asset) => asset.name === pkg.filename);
		if (asset?.digest === digest) continue;
		// Recover a failed/older upload; never create two assets with the same name.
		if (asset) await jsonRequest(`${api}/assets/${asset.id}`, "DELETE");
		const upload = await http(
			`https://uploads.github.com/repos/${repository}/releases/${release.id}/assets?name=${encodeURIComponent(pkg.filename)}`,
			{
				method: "POST",
				headers: { ...headers, "Content-Type": "application/gzip" },
				body: bytes,
			},
		);
		if (!upload.ok)
			throw new Error(`GitHub asset upload failed: HTTP ${upload.status}`);
	}
	if (release.draft)
		await jsonRequest(`${api}/${release.id}`, "PATCH", {
			draft: false,
			prerelease: false,
		});
}

export async function publishArtifacts(
	packages: ReleasePackage[],
	tag: string,
	output: string,
	token: string,
	run: Run = runCommand,
	http: Request = request,
): Promise<void> {
	versionFromTag(tag);
	if (!token) throw new Error("GITHUB_TOKEN is required for Release delivery");
	verifyArtifacts(packages, output, run);
	for (const pkg of packages) {
		if (await published(pkg, http)) {
			console.log(
				`Already published: ${pkg.manifest.name}@${pkg.manifest.version}`,
			);
			continue;
		}
		run(
			"npm",
			[
				"publish",
				join(output, pkg.filename),
				"--access",
				"public",
				"--tag",
				"latest",
				"--ignore-scripts",
				"--registry",
				"https://registry.npmjs.org",
			],
			pkg.directory,
		);
		if (!(await published(pkg, http)))
			throw new Error(
				`npm version not visible after publication: ${pkg.manifest.name}`,
			);
	}
	await completeRelease(tag, packages, output, token, http);
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const [mode, tag = ""] = process.argv.slice(2);
	const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const output = join(root, "dist/release");
	const packages = loadPackages(root, tag);
	if (mode === "validate")
		console.log(`Validated ${tag}: ${packages.length} public packages`);
	else if (mode === "pack") packArtifacts(packages, output);
	else if (mode === "verify") verifyArtifacts(packages, output);
	else if (mode === "publish") {
		if (
			process.env.GITHUB_ACTIONS !== "true" ||
			process.env.GITHUB_REPOSITORY !== repository ||
			process.env.GITHUB_EVENT_NAME !== "push" ||
			process.env.GITHUB_REF !== `refs/tags/${tag}` ||
			!process.env.ACTIONS_ID_TOKEN_REQUEST_URL ||
			!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
		) {
			throw new Error(
				"Publication is allowed only for this repository's Actions tag-push OIDC job",
			);
		}
		await publishArtifacts(
			packages,
			tag,
			output,
			process.env.GITHUB_TOKEN ?? "",
		);
	} else
		throw new Error(
			"Usage: node scripts/release.ts <validate|pack|verify|publish> vX.Y.Z",
		);
}
