import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vite-plus/test';
import {
	findFlakyTests,
	formatAnnotations,
	formatSummary,
	type PlaywrightReport,
} from './flaky-report.ts';

// A real Playwright JSON report with two projects, one test that failed once
// then passed (flaky), one that always fails, one skipped and one that passes.
const report = JSON.parse(
	readFileSync(
		new URL('fixtures/playwright-report-flaky.json', import.meta.url),
		'utf8',
	),
) as PlaywrightReport;

describe('findFlakyTests', () => {
	it('lists a test that failed and then passed on retry, once per project', () => {
		const flaky = findFlakyTests(report, '/repo');
		expect(flaky.map((test) => [test.project, test.name])).toEqual([
			['chromium', 'group › flaky: passes on retry'],
			['firefox', 'group › flaky: passes on retry'],
		]);
		expect(flaky[0]).toMatchObject({
			file: 'tests/e2e/example.spec.ts',
			line: 4,
			attempts: 2,
		});
		expect(flaky[0].firstError).toContain('first attempt fails');
	});

	it('leaves out tests that passed first time, failed every attempt, or were skipped', () => {
		const names = findFlakyTests(report, '/repo').map((test) => test.name);
		expect(names).not.toContain('steady');
		expect(names).not.toContain('group › broken, always');
		expect(names).not.toContain('skipped');
	});

	it('returns nothing for a report with no tests', () => {
		expect(findFlakyTests({suites: []})).toEqual([]);
		expect(findFlakyTests({})).toEqual([]);
	});
});

describe('formatAnnotations', () => {
	it('writes one warning per flaky test with file and line', () => {
		const lines = formatAnnotations(findFlakyTests(report, '/repo'));
		expect(lines).toHaveLength(2);
		expect(lines[0]).toBe(
			'::warning file=tests/e2e/example.spec.ts,line=4,title=Flaky test::[chromium] group › flaky: passes on retry failed, then passed on retry (2 attempts). Error: first attempt fails',
		);
	});

	it('escapes newlines, percent signs, colons and commas for the runner', () => {
		const [line] = formatAnnotations([
			{
				name: '100% sure\nsecond line',
				project: 'chromium',
				file: 'a:b,c.spec.ts',
				line: 3,
				attempts: 2,
				firstError: '',
			},
		]);
		expect(line).toBe(
			'::warning file=a%3Ab%2Cc.spec.ts,line=3,title=Flaky test::[chromium] 100%25 sure%0Asecond line failed, then passed on retry (2 attempts).',
		);
	});
});

describe('formatSummary', () => {
	it('shows a table row for each flaky test and says the job stays green', () => {
		const summary = formatSummary(findFlakyTests(report, '/repo'));
		expect(summary).toContain('### Flaky tests (2)');
		expect(summary).toContain('The job stays green');
		expect(summary).toContain(
			'| chromium | `tests/e2e/example.spec.ts:4` | group › flaky: passes on retry | 2 | Error: first attempt fails |',
		);
	});

	it('does not break the table when a name contains a pipe', () => {
		const summary = formatSummary([
			{
				name: 'a | b',
				project: 'firefox',
				file: 'x.spec.ts',
				line: 1,
				attempts: 2,
				firstError: '',
			},
		]);
		expect(summary).toContain(String.raw`a \| b`);
	});

	it('says so when nothing was flaky', () => {
		expect(formatSummary([])).toContain('None');
	});
});
