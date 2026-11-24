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
