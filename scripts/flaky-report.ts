/*
Reports tests that failed and then passed on a Playwright retry.

Reads the JSON report (`test-results/report.json` in CI), writes a Markdown
table to the job summary and one `::warning` annotation per flaky test. It
never fails the job: a flaky test passed, and the report only makes that
visible.

Usage: node scripts/flaky-report.ts [report.json]
*/
import {appendFileSync, existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {pathToFileURL} from 'node:url';
import {stripVTControlCharacters} from 'node:util';

type ReportResult = {
	status: string;
	retry: number;
	error?: {message?: string};
};

type ReportTest = {
	projectName: string;
	status: string;
	results: ReportResult[];
};

type ReportSpec = {
	title: string;
	file: string;
	line: number;
	tests: ReportTest[];
};

type ReportSuite = {
	title: string;
	file?: string;
	suites?: ReportSuite[];
	specs?: ReportSpec[];
};

export type PlaywrightReport = {
	config?: {rootDir?: string};
	suites?: ReportSuite[];
};

export type FlakyTest = {
	name: string;
	project: string;
	file: string;
	line: number;
	attempts: number;
	firstError: string;
};

function firstLine(message: string | undefined): string {
	const plain = stripVTControlCharacters(message ?? '').trim();
	return plain.split('\n').find((line) => line.trim() !== '') ?? '';
}

function collectSpecs(
	suite: ReportSuite,
	parents: string[],
	out: Array<{spec: ReportSpec; path: string[]}>,
): void {
	// The top suite of a file is titled with the file name, which every spec
	// already carries in `file`, so only describe blocks go into the name.
	const names =
		suite.title === suite.file ? parents : [...parents, suite.title];
	for (const spec of suite.specs ?? []) {
		out.push({spec, path: names});
	}

	for (const child of suite.suites ?? []) {
		collectSpecs(child, names, out);
	}
}

export function findFlakyTests(
	report: PlaywrightReport,
	repoRoot = process.cwd(),
): FlakyTest[] {
	const specs: Array<{spec: ReportSpec; path: string[]}> = [];
	for (const suite of report.suites ?? []) {
		collectSpecs(suite, [], specs);
	}

	const rootDir = report.config?.rootDir ?? repoRoot;
	const flaky: FlakyTest[] = [];
	for (const {spec, path: names} of specs) {
		for (const test of spec.tests) {
			if (test.status !== 'flaky') {
				continue;
			}

			const failed = test.results.find((result) =>
				['failed', 'timedOut', 'interrupted'].includes(result.status),
			);
			flaky.push({
				name: [...names, spec.title].join(' › '),
				project: test.projectName,
				file: path
					.relative(repoRoot, path.resolve(rootDir, spec.file))
					.split(path.sep)
					.join('/'),
				line: spec.line,
				attempts: test.results.length,
				firstError: firstLine(failed?.error?.message),
			});
		}
	}

	return flaky;
}

function escapeData(value: string): string {
	return value
		.replaceAll('%', '%25')
		.replaceAll('\r', '%0D')
		.replaceAll('\n', '%0A');
}

function escapeProperty(value: string): string {
	return escapeData(value).replaceAll(':', '%3A').replaceAll(',', '%2C');
}

export function formatAnnotations(flaky: FlakyTest[]): string[] {
	return flaky.map(
		(test) =>
			`::warning file=${escapeProperty(test.file)},line=${test.line},title=${escapeProperty('Flaky test')}::${escapeData(
				`[${test.project}] ${test.name} failed, then passed on retry (${test.attempts} attempts). ${test.firstError}`.trim(),
			)}`,
	);
}

function escapeCell(value: string): string {
	return value.replaceAll('|', String.raw`\|`).replaceAll('\n', ' ');
}

export function formatSummary(flaky: FlakyTest[]): string {
	if (flaky.length === 0) {
		return '### Flaky tests\n\nNone: no test needed a retry.\n';
	}

	const rows = flaky.map(
		(test) =>
			`| ${escapeCell(test.project)} | \`${escapeCell(test.file)}:${test.line}\` | ${escapeCell(test.name)} | ${test.attempts} | ${escapeCell(test.firstError)} |`,
	);
	return [
		`### Flaky tests (${flaky.length})`,
		'',
		'These tests failed, then passed on retry. The job stays green; fix or quarantine them.',
		'',
		'| Project | Location | Test | Attempts | First failure |',
		'| --- | --- | --- | --- | --- |',
		...rows,
		'',
	].join('\n');
}

function main(): void {
	const reportPath = process.argv[2] ?? 'test-results/report.json';
	if (!existsSync(reportPath)) {
		console.log(`::notice::No Playwright JSON report at ${reportPath}.`);
		return;
	}

	const report = JSON.parse(
		readFileSync(reportPath, 'utf8'),
	) as PlaywrightReport;
	const flaky = findFlakyTests(report);
	for (const line of formatAnnotations(flaky)) {
		console.log(line);
	}

	const summary = formatSummary(flaky);
	const summaryFile = process.env.GITHUB_STEP_SUMMARY;
	if (summaryFile) {
		appendFileSync(summaryFile, `${summary}\n`);
	} else {
		console.log(summary);
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main();
}
