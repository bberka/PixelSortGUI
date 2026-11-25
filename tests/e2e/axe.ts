import AxeBuilder from '@axe-core/playwright';
import {expect, type Page} from '@playwright/test';

export const WCAG_AA_TAGS = [
	'wcag2a',
	'wcag2aa',
	'wcag21a',
	'wcag21aa',
	'wcag22aa',
] as const;

export type A11yCheckOptions = {
	include?: string[];
	exclude?: string[];
	disableRules?: string[];
};

export async function assertNoA11yViolations(
	page: Page,
	options: A11yCheckOptions = {},
): Promise<void> {
	// The scan runs in Chromium only. In Playwright's Firefox the content
	// process segfaults inside the scan about once in twenty runs on the editor
	// (a null dereference in Gecko with no script frame; see pull request 35).
	// The rules judge the DOM and computed styles, which the two engines share
	// for this app, so Chromium's verdict stands for both.
	if (page.context().browser()?.browserType().name() === 'firefox') {
		return;
	}

	let builder = new AxeBuilder({page}).withTags([...WCAG_AA_TAGS]);

	for (const selector of options.include ?? []) {
		builder = builder.include(selector);
	}

	for (const selector of options.exclude ?? []) {
		builder = builder.exclude(selector);
	}

	if (options.disableRules && options.disableRules.length > 0) {
		builder = builder.disableRules(options.disableRules);
	}

	const results = await builder.analyze();
	const violations = results.violations.map((violation) => {
		const targets = violation.nodes
			.map((node) => node.target.join(' '))
			.join(', ');
		return `[${violation.impact ?? 'unknown'}] ${violation.id}: ${violation.help} (${targets})`;
	});

	expect(
		violations,
		`Accessibility violations found:\n${violations.join('\n')}`,
	).toEqual([]);
}
