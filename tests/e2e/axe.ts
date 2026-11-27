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

// While a Radix menu or select is open it marks the rest of the page
// `aria-hidden` and traps focus in the list, so axe's `aria-hidden-focus` is a
// false positive there (DESIGN.md section 10). Anything Radix did not mark, or
// marked while no list is open, still counts.
async function isBehindOpenList(
	page: Page,
	selector: string,
): Promise<boolean> {
	return page.evaluate((target) => {
		const {document} = globalThis;
		return (
			document.querySelector(
				'[role="menu"][data-state="open"], [role="listbox"][data-state="open"]',
			) !== null &&
			document.querySelector(target)?.matches('[data-aria-hidden="true"]') ===
				true
		);
	}, selector);
}

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
	const found = [];
	for (const violation of results.violations) {
		if (violation.id !== 'aria-hidden-focus') {
			found.push(violation);
			continue;
		}

		const nodes = [];
		for (const node of violation.nodes) {
			if (!(await isBehindOpenList(page, String(node.target[0])))) {
				nodes.push(node);
			}
		}

		if (nodes.length > 0) {
			found.push({...violation, nodes});
		}
	}

	const violations = found.map((violation) => {
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
