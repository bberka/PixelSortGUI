import {execFileSync} from 'node:child_process';
import {
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {pathToFileURL} from 'node:url';

export const BUDGET_FILE = 'scripts/agent-context-budget.json';

export type Budget = Record<string, number>;

const ROOT_FILES = new Set(['AGENTS.md', 'CLAUDE.md', 'CONTEXT.md']);
const AGENTS_DOCS_DIR = 'docs/agents';

export function isMeasured(file: string): boolean {
	return ROOT_FILES.has(file)
		? true
		: file.startsWith(`${AGENTS_DOCS_DIR}/`) && file.endsWith('.md');
}

export function measure(cwd = process.cwd()): Budget {
	const files: string[] = [];

	for (const file of ROOT_FILES) {
		if (existsSync(path.join(cwd, file))) {
			files.push(file);
		}
	}

	const agentsDir = path.join(cwd, AGENTS_DOCS_DIR);
	if (existsSync(agentsDir)) {
		for (const entry of readdirSync(agentsDir)) {
			if (entry.endsWith('.md')) {
				files.push(`${AGENTS_DOCS_DIR}/${entry}`);
			}
		}
	}

	files.sort();
	return Object.fromEntries(
		files.map((file) => [file, statSync(path.join(cwd, file)).size]),
	);
}

export function compareToMeasured(budget: Budget, measured: Budget): string[] {
	const problems: string[] = [];
	const allFiles = [
		...new Set([...Object.keys(budget), ...Object.keys(measured)]),
	].toSorted();

	for (const file of allFiles) {
		const allowed = budget[file];
		const size = measured[file];
		if (size === undefined) {
			problems.push(`${file}: in the budget but no longer present`);
		} else if (allowed === undefined) {
			problems.push(`${file}: ${size} bytes, not in the budget`);
		} else if (size !== allowed) {
			problems.push(`${file}: ${size} bytes, budget says ${allowed}`);
		}
	}

	return problems;
}

export function growthSince(
	budget: Budget,
	base: Budget,
	existedAtBase: (file: string) => boolean = () => false,
): string[] {
	return Object.entries(budget).flatMap(([file, value]) => {
		if (base[file] === undefined && existedAtBase(file)) {
			return [];
		}

		const before = base[file] ?? 0;
		return value > before
			? [`${file}: ${before} -> ${value} (+${value - before})`]
			: [];
	});
}

function parseBaseRef(args: string[]): string | undefined {
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === '--base') {
			return args[index + 1];
		}

		if (arg?.startsWith('--base=')) {
			return arg.slice('--base='.length);
		}
	}

	return undefined;
}

function readBaseBudget(ref: string): Budget | undefined {
	try {
		const content = execFileSync('git', ['show', `${ref}:${BUDGET_FILE}`], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		return JSON.parse(content) as Budget;
	} catch {
		return undefined;
	}
}

function fileExistsAt(ref: string): (file: string) => boolean {
	return (file) => {
		try {
			execFileSync('git', ['cat-file', '-e', `${ref}:${file}`], {
				stdio: 'ignore',
			});
			return true;
		} catch {
			return false;
		}
	};
}

export function main(args: string[]): number {
	const measured = measure();

	if (args.includes('--write')) {
		writeFileSync(BUDGET_FILE, `${JSON.stringify(measured, null, '\t')}\n`);
		console.log(`Wrote ${BUDGET_FILE}`);
		return 0;
	}

	if (!existsSync(BUDGET_FILE)) {
		console.error(
			`Missing ${BUDGET_FILE}. Run \`vp run agent-context:write\`.`,
		);
		return 1;
	}

	const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8')) as Budget;
	const problems = compareToMeasured(budget, measured);
	if (problems.length > 0) {
		console.error(
			`Agent context does not match ${BUDGET_FILE}:\n  ${problems.join('\n  ')}`,
		);
		console.error(
			'Cut text before raising a budget. After an intended change, run `vp run agent-context:write`.',
		);
		return 1;
	}

	const baseRef = parseBaseRef(args);
	if (baseRef !== undefined && baseRef.length > 0) {
		const base = readBaseBudget(baseRef);
		if (base === undefined) {
			console.log(`${baseRef} has no agent context budget yet.`);
			return 0;
		}

		const grown = growthSince(budget, base, fileExistsAt(baseRef));
		if (grown.length > 0) {
			console.log(
				`Agent context grew compared to ${baseRef}:\n  ${grown.join('\n  ')}`,
			);
			if (process.env.ALLOW_INCREASE === 'true') {
				console.log('Accepted by the agent-context-increase label.');
				return 0;
			}

			console.error(
				'Cut the added text, or ask a maintainer to add the agent-context-increase label.',
			);
			return 1;
		}
	}

	const alwaysLoaded =
		(measured['AGENTS.md'] ?? 0) + (measured['CLAUDE.md'] ?? 0);
	const total = Object.values(measured).reduce((sum, size) => sum + size, 0);
	console.log(
		`Agent context OK: ${Object.keys(measured).length} files, ${alwaysLoaded} bytes always loaded, ${total} bytes total.`,
	);
	return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	process.exitCode = main(process.argv.slice(2));
}
