import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_PATTERN = /^0\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseMinor(text: string): number {
	const value = text.trim();
	if (!/^(?:0|[1-9]\d*)$/.test(value)) {
		throw new Error(
			`VERSION must contain a single whole number (the ZeroVer minor part), got "${value}".`,
		);
	}

	return Number(value);
}

export function parseReleaseTag(
	tag: string,
): {minor: number; patch: number} | null {
	const match = VERSION_PATTERN.exec(tag.trim().replace(/^v/, ''));
	return match ? {minor: Number(match[1]), patch: Number(match[2])} : null;
}

export function nextVersion(minor: number, tags: readonly string[]): string {
	let latest: {minor: number; patch: number} | null = null;
	for (const tag of tags) {
		const release = parseReleaseTag(tag);
		if (
			release &&
			(!latest ||
				release.minor > latest.minor ||
				(release.minor === latest.minor && release.patch > latest.patch))
		) {
			latest = release;
		}
	}

	if (!latest || latest.minor < minor) {
		return `0.${minor}.0`;
	}

	if (latest.minor === minor) {
		return `0.${minor}.${latest.patch + 1}`;
	}

	throw new Error(
		`VERSION is ${minor}, but release 0.${latest.minor}.${latest.patch} already exists. Set VERSION to ${latest.minor} or higher.`,
	);
}

export type BuildVersionInput = {
	readonly minor: number;
	readonly exactTag?: string | null;
	readonly shortSha?: string | null;
	readonly envVersion?: string | null;
};

export function formatBuildVersion(input: BuildVersionInput): string {
	const fromEnv = input.envVersion?.trim();
	if (fromEnv) {
		return fromEnv.replace(/^v/, '');
	}

	if (input.exactTag) {
		const parsed = parseReleaseTag(input.exactTag);
		if (parsed) {
			return `0.${parsed.minor}.${parsed.patch}`;
		}
	}

	const sha = input.shortSha?.trim();
	return sha ? `0.${input.minor}.x (${sha})` : `0.${input.minor}.x (dev)`;
}

function readGitOutput(args: readonly string[], cwd: string): string | null {
	try {
		const out = execFileSync('git', [...args], {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
		return out.length > 0 ? out : null;
	} catch {
		return null;
	}
}

export function resolveBuildVersion(rootDir = projectRoot): string {
	const minor = parseMinor(readFileSync(resolve(rootDir, 'VERSION'), 'utf8'));
	const envVersion = process.env.VITE_APP_VERSION;
	if (envVersion?.trim()) {
		return formatBuildVersion({minor, envVersion});
	}

	const tags = readGitOutput(
		['tag', '--points-at', 'HEAD', '--list', 'v0.*', '--sort=-v:refname'],
		rootDir,
	);
	const exactTag = tags?.split('\n', 1)[0] ?? null;
	const shortSha = readGitOutput(['rev-parse', '--short', 'HEAD'], rootDir);
	return formatBuildVersion({minor, exactTag, shortSha});
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const [command] = process.argv.slice(2);
	if (command === 'next') {
		const minor = parseMinor(
			readFileSync(resolve(projectRoot, 'VERSION'), 'utf8'),
		);
		const tags = execFileSync('git', ['tag', '--list', 'v0.*'], {
			cwd: projectRoot,
			encoding: 'utf8',
		})
			.split('\n')
			.filter(Boolean);
		console.log(nextVersion(minor, tags));
	} else if (command === 'build') {
		console.log(resolveBuildVersion(projectRoot));
	} else {
		console.error('Usage: node scripts/release-version.ts <next|build>');
		process.exitCode = 1;
	}
}
