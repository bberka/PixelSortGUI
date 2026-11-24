import {expect, test} from '@playwright/test';
import {assertNoA11yViolations} from './axe.ts';
import {PROOF_VIEWPORTS} from './viewports.ts';

for (const viewport of PROOF_VIEWPORTS) {
	test(`library screen renders cleanly at ${viewport.name} (${viewport.width}x${viewport.height}) @a11y`, async ({
		page,
	}) => {
		const consoleErrors: string[] = [];
		const pageErrors: string[] = [];

		page.on('console', (message) => {
			if (message.type() === 'error') {
				consoleErrors.push(message.text());
			}
		});
		page.on('pageerror', (error) => {
			pageErrors.push(error.message);
		});

		await page.setViewportSize({
			width: viewport.width,
			height: viewport.height,
		});
		await page.goto('/');

		await expect(
			page.getByRole('heading', {level: 1, name: 'PixelSortGUI'}),
		).toBeVisible();

		const dimensions = await page.evaluate(() => ({
			scrollWidth: globalThis.document.documentElement.scrollWidth,
			innerWidth: globalThis.innerWidth,
		}));
		expect(
			dimensions.scrollWidth,
			`Expected no horizontal page scroll at ${viewport.width}x${viewport.height}`,
		).toBeLessThanOrEqual(dimensions.innerWidth);

		expect(consoleErrors, 'Console errors').toEqual([]);
		expect(pageErrors, 'Uncaught page errors').toEqual([]);

		await assertNoA11yViolations(page);
	});
}
