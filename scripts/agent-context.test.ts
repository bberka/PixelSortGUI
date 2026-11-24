import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vite-plus/test';
import {
	compareToMeasured,
	growthSince,
	isMeasured,
	measure,
} from './agent-context.ts';

describe('isMeasured', () => {
	it('includes always-loaded and docs/agents markdown files', () => {
		expect(isMeasured('AGENTS.md')).toBe(true);
		expect(isMeasured('CLAUDE.md')).toBe(true);
		expect(isMeasured('CONTEXT.md')).toBe(true);
		expect(isMeasured('docs/agents/tooling.md')).toBe(true);
	});

	it('excludes specs, research, and non-markdown files', () => {
		expect(isMeasured('docs/specs/product.md')).toBe(false);
		expect(isMeasured('docs/research/tooling-reference.md')).toBe(false);
		expect(isMeasured('docs/agents/notes.txt')).toBe(false);
		expect(isMeasured('README.md')).toBe(false);
	});
});

describe('measure', () => {
	it('measures only agent context files in byte size', () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'agent-context-test-'));
		try {
			mkdirSync(path.join(dir, 'docs/agents'), {recursive: true});
			mkdirSync(path.join(dir, 'docs/specs'), {recursive: true});
			mkdirSync(path.join(dir, 'docs/research'), {recursive: true});

			writeFileSync(path.join(dir, 'AGENTS.md'), 'hello\n');
			writeFileSync(path.join(dir, 'CLAUDE.md'), '@AGENTS.md\n');
			writeFileSync(path.join(dir, 'CONTEXT.md'), 'terms\n');
			writeFileSync(path.join(dir, 'docs/agents/workflow.md'), 'workflow');
			writeFileSync(path.join(dir, 'docs/specs/product.md'), 'not measured');
			writeFileSync(path.join(dir, 'docs/research/notes.md'), 'not measured');

			expect(measure(dir)).toEqual({
				'AGENTS.md': 6,
				'CLAUDE.md': 11,
				'CONTEXT.md': 6,
				'docs/agents/workflow.md': 8,
			});
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	});
});

describe('compareToMeasured', () => {
	it('returns no problems when budget matches measured sizes', () => {
		const sizes = {'AGENTS.md': 100, 'CLAUDE.md': 11};
		expect(compareToMeasured(sizes, sizes)).toEqual([]);
	});

	it('reports size mismatches, missing files, and untracked files', () => {
		const problems = compareToMeasured(
			{'AGENTS.md': 100, 'docs/agents/old.md': 50},
			{'AGENTS.md': 120, 'CLAUDE.md': 11},
		);

		expect(problems).toEqual([
			'AGENTS.md: 120 bytes, budget says 100',
			'CLAUDE.md: 11 bytes, not in the budget',
			'docs/agents/old.md: in the budget but no longer present',
		]);
	});
});

describe('growthSince', () => {
	it('reports files that grew and new files that did not exist at base', () => {
		const grown = growthSince(
			{'AGENTS.md': 120, 'CLAUDE.md': 11, 'docs/agents/new.md': 40},
			{'AGENTS.md': 100, 'CLAUDE.md': 11},
			() => false,
		);

		expect(grown).toEqual([
			'AGENTS.md: 100 -> 120 (+20)',
			'docs/agents/new.md: 0 -> 40 (+40)',
		]);
	});

	it('ignores files that already existed at base when added to budget', () => {
		const grown = growthSince(
			{'AGENTS.md': 100, 'CONTEXT.md': 50},
			{'AGENTS.md': 100},
			(file) => file === 'CONTEXT.md',
		);

		expect(grown).toEqual([]);
	});
});
