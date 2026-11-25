import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {pathToFileURL} from 'node:url';
import {build} from 'vite-plus';
import {
	collectNotices,
	findBundledPackageDirs,
	renderMarkdown,
	renderTypeScript,
	type PackageNotice,
} from './notices.ts';
import {GRAPH_OUT_ENV} from './notices-plugin.ts';

const rootDir = path.resolve(import.meta.dirname, '..');

export const OUTPUT_FILES = {
	typescript: path.join(
		rootDir,
		'src/features/settings/third-party-notices.generated.ts',
	),
	markdown: path.join(rootDir, 'THIRD-PARTY-NOTICES.md'),
} as const;

/**
Runs the production build in memory and returns the modules it bundled.
*/
async function bundledModuleIds(): Promise<string[]> {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'psg-notices-'));
	const graphFile = path.join(directory, 'graph.json');
	process.env[GRAPH_OUT_ENV] = graphFile;
	try {
		await build({root: rootDir, logLevel: 'silent', build: {write: false}});
		return JSON.parse(fs.readFileSync(graphFile, 'utf8')) as string[];
	} finally {
		Reflect.deleteProperty(process.env, GRAPH_OUT_ENV);
		fs.rmSync(directory, {recursive: true});
	}
}

export async function computeNotices(): Promise<PackageNotice[]> {
	return collectNotices(
		findBundledPackageDirs(await bundledModuleIds(), rootDir),
	);
}

export function renderOutputs(notices: readonly PackageNotice[]) {
	return {
		[OUTPUT_FILES.typescript]: renderTypeScript(notices),
		[OUTPUT_FILES.markdown]: renderMarkdown(notices),
	};
}

async function main() {
	const check = process.argv.includes('--check');
	const notices = await computeNotices();
	const outputs = renderOutputs(notices);

	if (check) {
		const stale = Object.entries(outputs)
			.filter(
				([file, content]) =>
					!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content,
			)
			.map(([file]) => path.relative(rootDir, file));
		if (stale.length > 0) {
			console.error(
				`Third-party notices are out of date: ${stale.join(', ')}. Run "pnpm run gen:notices" and commit the result.`,
			);
			process.exitCode = 1;
			return;
		}

		console.log(
			`Third-party notices are up to date (${notices.length} packages)`,
		);
		return;
	}

	for (const [file, content] of Object.entries(outputs)) {
		fs.writeFileSync(file, content, 'utf8');
	}

	console.log(`Wrote notices for ${notices.length} packages`);
	const withoutFile = notices.filter((entry) => entry.standardTextFallback);
	for (const notice of withoutFile) {
		console.log(
			`Check by hand: ${notice.name}@${notice.version} ships no licence file (standard ${notice.license} text used)`,
		);
	}

	const withoutCopyright = notices.filter(
		(entry) => entry.copyrightLines.length === 0,
	);
	for (const notice of withoutCopyright) {
		console.log(
			`Check by hand: ${notice.name}@${notice.version} has no copyright line in its licence file`,
		);
	}
}

if (
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	await main();
}
