import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';

export const NOTICES_FILE_NAME = 'THIRD-PARTY-NOTICES.txt';

/**
 Workbox runtime packages bundled into the generated service worker
 (`dist/workbox-*.js`) by `vite-plugin-pwa` / `workbox-build`. These are
 emitted in `closeBundle` outside Vite's main module graph, so we resolve
 their package directories from `workbox-build` explicitly without pulling in
 `workbox-build`'s Node-only CLI dependencies.
 */
export const WORKBOX_SW_RUNTIME_PACKAGES: readonly string[] = [
	'workbox-core',
	'workbox-precaching',
	'workbox-routing',
	'workbox-strategies',
];

// Docs/agents/licensing.md allows MIT, ISC, BSD and Apache-2.0. 0BSD (tslib)
// is the same text as ISC without the condition to keep the notice.
export const ALLOWED_LICENSES: readonly string[] = [
	'MIT',
	'ISC',
	'BSD-2-Clause',
	'BSD-3-Clause',
	'Apache-2.0',
	'0BSD',
];

const templatesDirectory = path.join(import.meta.dirname, 'license-templates');

type PackageJson = {
	name?: string;
	version?: string;
	license?: string | {type?: string};
	licenses?: Array<{type?: string}>;
	homepage?: string;
	repository?: string | {url?: string};
	author?: string | {name?: string};
};

export type NoticeFile = {
	readonly file: string;
	readonly text: string;
};

export type PackageNotice = {
	readonly name: string;
	readonly version: string;
	readonly license: string;
	readonly url?: string;
	readonly author?: string;
	readonly copyrightLines: readonly string[];
	readonly licenseFiles: readonly NoticeFile[];
	readonly noticeFiles: readonly NoticeFile[];
	/**
	True when the package ships no licence file and the standard text is used.
	*/
	readonly standardTextFallback: boolean;
};

const LICENSE_EXTENSIONS = new Set(['', '.md', '.txt', '.markdown']);
const LICENSE_BASE =
	/^(?:licen[cs]e|copying|unlicense|copyright(?:notice)?)(?:[-_][-0-9a-z]+)?$/i;
const NOTICE_BASE = /^notice$/i;
const COPYRIGHT_LINE = /^(?:copyright\b|\(c\)|©)/i;
const COPYRIGHT_PROSE =
	/^copyright\s+(?:notice|holders?|owners?|and|law|statement)\b/i;
const COPYRIGHT_PLACEHOLDER =
	/\[yyyy\]|<year>|\{yyyy\}|\[name of copyright owner\]/i;

export function normalizeText(text: string): string {
	return text
		.replace(/^\uFEFF/, '')
		.replaceAll('\r\n', '\n')
		.replaceAll('\r', '\n')
		.split('\n')
		.map((line) => line.trimEnd())
		.join('\n')
		.trim();
}

export function classifyFile(
	fileName: string,
): 'license' | 'notice' | undefined {
	const extension = path.extname(fileName);
	if (!LICENSE_EXTENSIONS.has(extension.toLowerCase())) {
		return undefined;
	}

	const base = path.basename(fileName, extension);
	if (NOTICE_BASE.test(base)) {
		return 'notice';
	}

	return LICENSE_BASE.test(base) ? 'license' : undefined;
}

export function extractCopyrightLines(text: string): string[] {
	const lines: string[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.replace(/^[\s#*\-/>]+/, '').trim();
		if (
			COPYRIGHT_LINE.test(line) &&
			!COPYRIGHT_PROSE.test(line) &&
			!COPYRIGHT_PLACEHOLDER.test(line) &&
			!lines.includes(line)
		) {
			lines.push(line);
		}
	}

	return lines;
}

function normalizeLicense(pkg: PackageJson): string {
	if (typeof pkg.license === 'string' && pkg.license.trim().length > 0) {
		return pkg.license.trim();
	}

	if (
		pkg.license &&
		typeof pkg.license === 'object' &&
		typeof pkg.license.type === 'string'
	) {
		return pkg.license.type.trim();
	}

	const legacy = pkg.licenses
		?.map((entry) => entry.type?.trim())
		.filter(Boolean);
	return legacy && legacy.length > 0 ? legacy.join(' OR ') : 'Unknown';
}

function normalizeUrl(pkg: PackageJson): string | undefined {
	const raw =
		typeof pkg.homepage === 'string' && pkg.homepage.trim().length > 0
			? pkg.homepage.trim()
			: typeof pkg.repository === 'string'
				? pkg.repository.trim()
				: typeof pkg.repository?.url === 'string'
					? pkg.repository.url.trim()
					: undefined;

	if (!raw) {
		return undefined;
	}

	let cleaned = raw.replace(/^git\+/, '').replace(/\.git$/, '');
	if (cleaned.startsWith('github:')) {
		cleaned = `https://github.com/${cleaned.slice('github:'.length)}`;
	}

	return cleaned.startsWith('https://') ? cleaned : undefined;
}

function normalizeAuthor(pkg: PackageJson): string | undefined {
	const raw = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name;
	const cleaned = raw?.replaceAll(/\s*[(<][^)>]*[)>]/g, '').trim();
	return cleaned && cleaned.length > 0 ? cleaned : undefined;
}

/**
 Returns the SPDX identifiers that make `expression` acceptable, or
 undefined when it is not. Parentheses are refused so that a compound
 expression is never read the wrong way.
 */
export function allowedAlternative(expression: string): string | undefined {
	if (/[()]/.test(expression)) {
		return undefined;
	}

	for (const alternative of expression.split(/\s+or\s+/i)) {
		const parts = alternative.split(/\s+and\s+/i).map((part) => part.trim());
		if (parts.every((part) => ALLOWED_LICENSES.includes(part))) {
			return parts[0];
		}
	}

	return undefined;
}

export function readTemplate(id: string): string {
	return fs.readFileSync(path.join(templatesDirectory, `${id}.txt`), 'utf8');
}

export function collectPackageNotice(packageDir: string): PackageNotice {
	const manifestPath = path.join(packageDir, 'package.json');
	if (!fs.existsSync(manifestPath)) {
		throw new Error(`Missing package manifest: ${manifestPath}`);
	}

	const pkg = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PackageJson;
	if (!pkg.name || !pkg.version) {
		throw new Error(`${manifestPath} has no name or version`);
	}

	const license = normalizeLicense(pkg);
	const alternative = allowedAlternative(license);
	if (!alternative) {
		throw new Error(
			`${pkg.name}@${pkg.version} is distributed in dist/ but its licence "${license}" is not allowed. Allowed: ${ALLOWED_LICENSES.join(', ')} (docs/agents/licensing.md). Remove the dependency, or ask the owner to extend the allowed list in scripts/notices.ts and docs/agents/licensing.md.`,
		);
	}

	const licenseFiles: NoticeFile[] = [];
	const noticeFiles: NoticeFile[] = [];
	const names = fs
		.readdirSync(packageDir)
		.filter((name) => fs.statSync(path.join(packageDir, name)).isFile())
		.toSorted();
	for (const name of names) {
		const kind = classifyFile(name);
		if (!kind) {
			continue;
		}

		const text = normalizeText(
			fs.readFileSync(path.join(packageDir, name), 'utf8'),
		);
		if (text.length === 0) {
			continue;
		}

		(kind === 'license' ? licenseFiles : noticeFiles).push({file: name, text});
	}

	const author = normalizeAuthor(pkg);
	const url = normalizeUrl(pkg);
	const base = {
		name: pkg.name,
		version: pkg.version,
		license,
		...(url && {url}),
		...(author && {author}),
	};

	if (licenseFiles.length > 0) {
		const copyrightLines: string[] = [];
		for (const file of [...licenseFiles, ...noticeFiles]) {
			for (const line of extractCopyrightLines(file.text)) {
				if (!copyrightLines.includes(line)) {
					copyrightLines.push(line);
				}
			}
		}

		return {
			...base,
			copyrightLines,
			licenseFiles,
			noticeFiles,
			standardTextFallback: false,
		};
	}

	const holder = author ?? `the ${pkg.name} authors`;
	const copyright =
		alternative === 'Apache-2.0'
			? `Copyright ${holder}`
			: `Copyright (c) ${holder}`;
	return {
		...base,
		copyrightLines: [copyright],
		licenseFiles: [
			{
				file: `(standard ${alternative} text; the package ships no licence file)`,
				text: normalizeText(
					readTemplate(alternative).replace('{{copyright}}', () => copyright),
				),
			},
		],
		noticeFiles,
		standardTextFallback: true,
	};
}

/**
The package directory for a bundler module id, or undefined for app code.
*/
export function packageDirOfModule(moduleId: string): string | undefined {
	const clean = moduleId.replace(/\?.*$/, '').replace(/^\0/, '');
	const marker = '/node_modules/';
	const index = clean.lastIndexOf(marker);
	if (index === -1) {
		return undefined;
	}

	const segments = clean.slice(index + marker.length).split('/');
	const depth = segments[0]?.startsWith('@') ? 2 : 1;
	return (
		clean.slice(0, index + marker.length) + segments.slice(0, depth).join('/')
	);
}

function packageNameOfSpecifier(specifier: string): string | undefined {
	if (/^(?:[./]|https?:|data:)/.test(specifier)) {
		return undefined;
	}

	const segments = specifier.split('/');
	return segments[0]?.startsWith('@')
		? segments.slice(0, 2).join('/')
		: segments[0];
}

/**
 Resolves the package directories of the Workbox runtime packages bundled into
 the generated service worker when `vite-plugin-pwa` is installed in `rootDir`.
 */
export function resolveWorkboxRuntimePackageDirs(
	rootDir: string,
	packages: readonly string[] = WORKBOX_SW_RUNTIME_PACKAGES,
): string[] {
	const pwaManifest = path.join(
		rootDir,
		'node_modules',
		'vite-plugin-pwa',
		'package.json',
	);
	if (!fs.existsSync(pwaManifest)) {
		return [];
	}

	const pwaRequire = createRequire(fs.realpathSync(pwaManifest));
	const workboxBuildManifest = pwaRequire.resolve('workbox-build/package.json');
	const workboxBuildRequire = createRequire(
		fs.realpathSync(workboxBuildManifest),
	);

	return packages.map((pkg) => {
		const pkgManifest = workboxBuildRequire.resolve(`${pkg}/package.json`);
		return fs.realpathSync(path.dirname(pkgManifest));
	});
}

/**
 Packages whose code reaches dist/: every package behind a bundled module,
 packages that a project stylesheet imports by bare name (the CSS pipeline
 inlines them without listing them as JS modules), and the Workbox runtime
 packages bundled into the generated service worker.
 */
export function findBundledPackageDirs(
	moduleIds: Iterable<string>,
	rootDir: string,
): string[] {
	const dirs = new Set<string>(resolveWorkboxRuntimePackageDirs(rootDir));
	for (const id of moduleIds) {
		const dir = packageDirOfModule(id);
		if (dir) {
			dirs.add(dir);
			continue;
		}

		const file = id.replace(/\?.*$/, '');
		if (!file.endsWith('.css') || !fs.existsSync(file)) {
			continue;
		}

		const css = fs.readFileSync(file, 'utf8');
		for (const match of css.matchAll(
			/@(?:import|plugin)\s+(?:url\()?["']([^"']+)["']/g,
		)) {
			const name = packageNameOfSpecifier(match[1] ?? '');
			if (!name) {
				continue;
			}

			const packageDir = path.join(rootDir, 'node_modules', name);
			if (!fs.existsSync(path.join(packageDir, 'package.json'))) {
				throw new Error(`${file} imports "${name}", which is not installed`);
			}

			dirs.add(fs.realpathSync(packageDir));
		}
	}

	return [...dirs];
}

export function collectNotices(packageDirs: Iterable<string>): PackageNotice[] {
	const byKey = new Map<string, PackageNotice>();
	for (const dir of packageDirs) {
		const notice = collectPackageNotice(dir);
		byKey.set(`${notice.name}@${notice.version}`, notice);
	}

	return [...byKey.values()].toSorted((a, b) =>
		a.name === b.name
			? a.version.localeCompare(b.version, 'en')
			: a.name.localeCompare(b.name, 'en'),
	);
}

function quoteSingle(value: string): string {
	return `'${value
		.replaceAll('\\', '\\\\')
		.replaceAll("'", String.raw`\'`)
		.replaceAll('\n', String.raw`\n`)}'`;
}

export function renderTypeScript(notices: readonly PackageNotice[]): string {
	const entries = notices.map((entry) => {
		const fields = [
			`\t\tname: ${quoteSingle(entry.name)},`,
			`\t\tversion: ${quoteSingle(entry.version)},`,
			`\t\tlicense: ${quoteSingle(entry.license)},`,
		];
		if (entry.url) {
			fields.push(`\t\turl: ${quoteSingle(entry.url)},`);
		}

		return `\t{\n${fields.join('\n')}\n\t},`;
	});

	return [
		'// Generated by scripts/gen-notices.ts from the packages bundled into dist/. Do not edit.',
		'export type ThirdPartyNotice = {',
		'\treadonly name: string;',
		'\treadonly version: string;',
		'\treadonly license: string;',
		'\treadonly url?: string;',
		'};',
		'',
		`export const THIRD_PARTY_NOTICES_FILE = ${quoteSingle(NOTICES_FILE_NAME)};`,
		'',
		'export const THIRD_PARTY_NOTICES: readonly ThirdPartyNotice[] = [',
		...entries,
		'];',
		'',
	].join('\n');
}

const INTRO = [
	'Third-party notices for PixelSortGUI',
	'',
	'PixelSortGUI is released under the MIT licence (see LICENSE). The app',
	'bundles the packages below. Each section reproduces the licence text,',
	'the copyright lines and any NOTICE file that the package itself ships.',
	'This file is generated by scripts/gen-notices.ts; do not edit it.',
];

function copyrightBlock(notice: PackageNotice): string[] {
	if (notice.copyrightLines.length > 0) {
		return notice.copyrightLines.map((line) => `  ${line}`);
	}

	return [
		`  none in the licence file (package.json author: ${notice.author ?? 'not given'})`,
	];
}

function summaryLines(notice: PackageNotice): string[] {
	return [
		`License: ${notice.license}`,
		...(notice.url ? [`Homepage: ${notice.url}`] : []),
		'Copyright:',
		...copyrightBlock(notice),
	];
}

export function renderText(notices: readonly PackageNotice[]): string {
	const rule = '='.repeat(72);
	const sections = notices.map((notice) => {
		const parts = [
			rule,
			`${notice.name} ${notice.version}`,
			rule,
			...summaryLines(notice),
		];
		for (const file of notice.licenseFiles) {
			parts.push('', `--- ${file.file} ---`, '', file.text);
		}

		for (const file of notice.noticeFiles) {
			parts.push('', `--- ${file.file} ---`, '', file.text);
		}

		return parts.join('\n');
	});

	return `${[
		...INTRO,
		'',
		`Packages (${notices.length}):`,
		...notices.map(
			(notice) => `  ${notice.name} ${notice.version} (${notice.license})`,
		),
		'',
		sections.join('\n\n'),
	].join('\n')}\n`;
}

function fenceFor(text: string): string {
	const longest = Math.max(
		2,
		...[...text.matchAll(/`+/g)].map((match) => match[0].length),
	);
	return '`'.repeat(longest + 1);
}

export function renderMarkdown(notices: readonly PackageNotice[]): string {
	const sections = notices.map((notice) => {
		const parts = [
			`## ${notice.name} ${notice.version}`,
			'',
			`- License: ${notice.license}`,
			...(notice.url ? [`- Homepage: ${notice.url}`] : []),
			'- Copyright:',
			...copyrightBlock(notice).map((line) => `  ${line.trim()}`),
		];
		for (const file of [...notice.licenseFiles, ...notice.noticeFiles]) {
			const fence = fenceFor(file.text);
			parts.push('', `\`${file.file}\``, '', fence, file.text, fence);
		}

		return parts.join('\n');
	});

	return `${[
		'# Third-party notices',
		'',
		...INTRO.slice(2),
		'',
		`Packages (${notices.length}):`,
		'',
		...notices.map(
			(notice) => `- ${notice.name} ${notice.version} (${notice.license})`,
		),
		'',
		sections.join('\n\n'),
	].join('\n')}\n`;
}
