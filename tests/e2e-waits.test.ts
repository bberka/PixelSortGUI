import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vite-plus/test';

const E2E_DIR = path.join(import.meta.dirname, 'e2e');

describe('e2e waits', () => {
	it('never passes an async predicate to waitForFunction', () => {
		const offenders = readdirSync(E2E_DIR, {recursive: true, encoding: 'utf8'})
			.filter((file) => file.endsWith('.ts'))
			.filter((file) =>
				/\.waitForFunction\(\s*async\b/.test(
					readFileSync(path.join(E2E_DIR, file), 'utf8'),
				),
			);

		// The returned Promise is truthy, so the call does not wait.
		expect(offenders).toEqual([]);
	});
});
