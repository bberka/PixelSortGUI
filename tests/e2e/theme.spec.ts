import {expect, test} from '@playwright/test';
import {assertNoA11yViolations} from './axe.ts';
import {PROOF_VIEWPORTS} from './viewports.ts';

const GALLERY_PATH = '/#/dev/gallery';

const LIGHT_BG = 'rgb(250, 250, 250)';
const TRUE_BLACK_BG = 'rgb(0, 0, 0)';
const LIGHT_RING = 'rgb(37, 99, 235)';
const DARK_RING = 'rgb(96, 165, 250)';

const THEMES = [
	{name: 'light', background: LIGHT_BG, ring: LIGHT_RING},
	{name: 'dark', background: TRUE_BLACK_BG, ring: DARK_RING},
] as const;

for (const theme of THEMES) {
	for (const viewport of PROOF_VIEWPORTS) {
		test(`gallery passes a11y and layout in ${theme.name} at ${viewport.name} (${viewport.width}x${viewport.height}) @a11y`, async ({
			page,
		}) => {
			await page.emulateMedia({colorScheme: theme.name});
			await page.addInitScript((value) => {
				globalThis.localStorage.setItem('drift:theme', value);
			}, theme.name);
			await page.setViewportSize({
				width: viewport.width,
				height: viewport.height,
			});
			await page.goto(GALLERY_PATH);

			await expect(
				page.getByRole('heading', {level: 1, name: 'Drift'}),
			).toBeVisible();

			const metrics = await page.evaluate(() => ({
				datasetTheme: globalThis.document.documentElement.dataset.theme,
				bg: globalThis.getComputedStyle(globalThis.document.documentElement)
					.backgroundColor,
				scrollWidth: globalThis.document.documentElement.scrollWidth,
				innerWidth: globalThis.innerWidth,
			}));

			expect(metrics.datasetTheme).toBe(theme.name);
			expect(metrics.bg).toBe(theme.background);
			expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);

			await assertNoA11yViolations(page);
		});
	}
}

test('theme selection persists across reloads and True Black computes to rgb(0, 0, 0)', async ({
	page,
}) => {
	await page.emulateMedia({colorScheme: 'light'});
	await page.goto(GALLERY_PATH);

	const themeGroup = page.getByRole('radiogroup', {name: 'Theme'}).first();
	await themeGroup.getByRole('radio', {name: 'True Black'}).click();

	await expect
		.poll(() =>
			page.evaluate(() => ({
				stored: globalThis.localStorage.getItem('drift:theme'),
				attr: globalThis.document.documentElement.dataset.theme,
				bg: globalThis.getComputedStyle(globalThis.document.documentElement)
					.backgroundColor,
			})),
		)
		.toEqual({stored: 'dark', attr: 'dark', bg: TRUE_BLACK_BG});

	await page.reload();
	expect(
		await page.evaluate(() => ({
			stored: globalThis.localStorage.getItem('drift:theme'),
			attr: globalThis.document.documentElement.dataset.theme,
			bg: globalThis.getComputedStyle(globalThis.document.documentElement)
				.backgroundColor,
		})),
	).toEqual({stored: 'dark', attr: 'dark', bg: TRUE_BLACK_BG});

	await page
		.getByRole('radiogroup', {name: 'Theme'})
		.first()
		.getByRole('radio', {name: 'Light'})
		.click();
	await page.reload();
	expect(
		await page.evaluate(() => ({
			stored: globalThis.localStorage.getItem('drift:theme'),
			attr: globalThis.document.documentElement.dataset.theme,
			bg: globalThis.getComputedStyle(globalThis.document.documentElement)
				.backgroundColor,
		})),
	).toEqual({stored: 'light', attr: 'light', bg: LIGHT_BG});

	await page
		.getByRole('radiogroup', {name: 'Theme'})
		.first()
		.getByRole('radio', {name: 'System'})
		.click();
	await page.reload();
	expect(
		await page.evaluate(() => ({
			stored: globalThis.localStorage.getItem('drift:theme'),
			attr: globalThis.document.documentElement.dataset.theme,
		})),
	).toEqual({stored: 'system', attr: 'system'});
});

test('System theme follows emulated OS colour scheme changes without reload', async ({
	page,
}) => {
	await page.emulateMedia({colorScheme: 'light'});
	await page.goto(GALLERY_PATH);

	expect(
		await page.evaluate(
			() =>
				globalThis.getComputedStyle(globalThis.document.documentElement)
					.backgroundColor,
		),
	).toBe(LIGHT_BG);

	await page.emulateMedia({colorScheme: 'dark'});
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					globalThis.getComputedStyle(globalThis.document.documentElement)
						.backgroundColor,
			),
		)
		.toBe(TRUE_BLACK_BG);

	await page.emulateMedia({colorScheme: 'light'});
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					globalThis.getComputedStyle(globalThis.document.documentElement)
						.backgroundColor,
			),
		)
		.toBe(LIGHT_BG);
});

test('reloading Light on dark OS and True Black on light OS applies theme before DOMContentLoaded', async ({
	page,
}) => {
	for (const scenario of [
		{os: 'dark' as const, chosen: 'light' as const, expectedBg: LIGHT_BG},
		{os: 'light' as const, chosen: 'dark' as const, expectedBg: TRUE_BLACK_BG},
	]) {
		await page.emulateMedia({colorScheme: scenario.os});
		await page.goto(GALLERY_PATH);
		await page.evaluate((value) => {
			globalThis.localStorage.setItem('drift:theme', value);
		}, scenario.chosen);

		await page.addInitScript(() => {
			const record = (phase: string) => {
				const win = globalThis as unknown as {
					__themeBootLog?: Array<{
						phase: string;
						attr: string | undefined;
						bg: string;
					}>;
				};
				win.__themeBootLog ??= [];
				win.__themeBootLog.push({
					phase,
					attr: globalThis.document.documentElement.dataset.theme,
					bg: globalThis.getComputedStyle(globalThis.document.documentElement)
						.backgroundColor,
				});
			};

			globalThis.document.addEventListener('DOMContentLoaded', () => {
				record('DOMContentLoaded');
			});
			globalThis.addEventListener('load', () => {
				record('load');
			});
		});

		await page.reload({waitUntil: 'load'});

		const log = await page.evaluate(() => {
			const win = globalThis as unknown as {
				__themeBootLog?: Array<{
					phase: string;
					attr: string | undefined;
					bg: string;
				}>;
			};
			return win.__themeBootLog ?? [];
		});

		expect(log.length).toBeGreaterThanOrEqual(2);
		for (const entry of log) {
			expect(entry.attr, `phase ${entry.phase}`).toBe(scenario.chosen);
			expect(entry.bg, `phase ${entry.phase}`).toBe(scenario.expectedBg);
		}
	}
});

for (const theme of THEMES) {
	test(`keyboard focus rings are visible on button, input, slider, and dialog in ${theme.name}`, async ({
		page,
	}) => {
		await page.emulateMedia({colorScheme: theme.name});
		await page.addInitScript((value) => {
			globalThis.localStorage.setItem('drift:theme', value);
		}, theme.name);
		await page.goto(GALLERY_PATH);

		const assertFocusRing = async (
			locator: ReturnType<typeof page.locator>,
		) => {
			await expect
				.poll(() =>
					locator.evaluate((element) => {
						const computed = globalThis.getComputedStyle(element);
						return {
							outlineStyle: computed.outlineStyle,
							outlineWidth: computed.outlineWidth,
							outlineColor: computed.outlineColor,
						};
					}),
				)
				.toEqual({
					outlineStyle: 'solid',
					outlineWidth: '2px',
					outlineColor: theme.ring,
				});
		};

		const exportButton = page.getByRole('button', {name: 'Export'});
		await exportButton.focus();
		await page.keyboard.press('Tab');
		await page.keyboard.press('Shift+Tab');
		await expect(exportButton).toBeFocused();
		await assertFocusRing(exportButton);

		const filenameInput = page.getByLabel('Filename');
		await filenameInput.focus();
		await page.keyboard.press('Tab');
		await page.keyboard.press('Shift+Tab');
		await expect(filenameInput).toBeFocused();
		await assertFocusRing(filenameInput);

		const mixSlider = page.getByRole('slider', {name: 'Mix'});
		await mixSlider.focus();
		await page.keyboard.press('Tab');
		await page.keyboard.press('Shift+Tab');
		await expect(mixSlider).toBeFocused();
		await assertFocusRing(mixSlider);
		await page.keyboard.press('ArrowRight');
		await expect(mixSlider).toHaveAttribute('aria-valuenow', '76');

		const dialogTrigger = page.getByRole('button', {name: 'Open dialog'});
		await dialogTrigger.focus();
		await page.keyboard.press('Enter');
		const dialog = page.getByRole('dialog', {name: 'Export image'});
		await expect(dialog).toBeVisible();

		const dialogInput = dialog.getByLabel('Output name');
		await expect(dialogInput).toBeFocused();
		await page.keyboard.press('Tab');
		const cancelButton = dialog.getByRole('button', {name: 'Cancel'});
		await expect(cancelButton).toBeFocused();
		await assertFocusRing(cancelButton);

		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect(dialogTrigger).toBeFocused();
	});
}
