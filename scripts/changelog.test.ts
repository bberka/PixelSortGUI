/* eslint-disable no-template-curly-in-string -- the test needs a literal placeholder */
import path from 'node:path';
import {describe, expect, it} from 'vite-plus/test';
import {CHANGELOG_TEXT} from '../src/features/settings/changelog.generated.ts';
import {isChangelogCurrent, renderChangelogModule} from './changelog.ts';

const rootDir = path.resolve(import.meta.dirname, '..');

describe('bundled changelog (AC-F24.2)', () => {
	it('matches the root CHANGELOG.md', () => {
		expect(isChangelogCurrent(rootDir)).toBe(true);
		expect(CHANGELOG_TEXT).toContain('## v0.3.0');
		expect(CHANGELOG_TEXT).toContain('## v0.2.0');
		expect(CHANGELOG_TEXT).toContain('## v0.1.0');
	});

	it('keeps backticks, backslashes and ${ literal', async () => {
		const markdown = 'a `code` C:\\new ${value}\r\nend';
		const source = renderChangelogModule(markdown).replace(
			'export const',
			'const',
		);
		// eslint-disable-next-line no-new-func -- evaluates the generated module
		const read = new Function(
			`${source}return CHANGELOG_TEXT;`,
		) as () => string;
		expect(read()).toBe('a `code` C:\\new ${value}\nend');
	});
});
