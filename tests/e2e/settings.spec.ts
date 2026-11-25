import {expect, test, type Page} from '@playwright/test';
import {assertNoA11yViolations} from './axe.ts';
import {importSyntheticProject} from './seed.ts';
import {DESKTOP_VIEWPORT, PROOF_VIEWPORTS} from './viewports.ts';

async function openSettings(page: Page) {
	const button = page.getByRole('button', {name: 'Settings'});
	await expect(button).toBeVisible();
	await button.click();
	const dialog = page.getByRole('dialog', {name: 'Settings'});
	await expect(dialog).toBeVisible();
	return dialog;
}

test.describe('Settings, storage status, and About', () => {
	test('AC-F14 & AC-F16.1: opens from Library and Editor, switches theme, shows usage, persistence, and About notices', async ({
		page,
	}) => {
		const externalRequests: string[] = [];
		page.on('request', (request) => {
			const url = request.url();
			if (
				!url.startsWith('http://127.0.0.1:') &&
				!url.startsWith('http://localhost:') &&
				!url.startsWith('data:') &&
				!url.startsWith('blob:')
			) {
				externalRequests.push(url);
			}
		});

		await page.setViewportSize(DESKTOP_VIEWPORT);
		await page.goto('/');

		const dialog = await openSettings(page);

		// Usage line matches persistence.md §7.2 format or unavailable fallback
		const usageLine = dialog.locator('p').filter({
			hasText:
				/^(Using \d+(?:\.\d)? (?:MB|GB) of \d+(?:\.\d)? (?:MB|GB)|Storage usage unavailable)$/,
		});
		await expect(usageLine).toBeVisible();

		// Persistence status and private browsing note
		await expect(
			dialog.getByText(
				/Storage protection: (Persistent|Best-effort \(browser may clear data when space is low\))/,
			),
		).toBeVisible();
		await expect(
			dialog.getByText(
				'Private Browsing windows clear all stored data when closed.',
			),
		).toBeVisible();

		// Theme switching in Settings updates html[data-theme]
		await dialog.getByRole('radio', {name: 'Light'}).click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
		await dialog.getByRole('radio', {name: 'True Black'}).click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

		// About: product name, ASDFPixelSort credit, MIT licence, third-party notices
		await expect(
			dialog.getByText(
				"Pixel sorting lineage: inspired by Kim Asendorf's ASDFPixelSort.",
			),
		).toBeVisible();

		await expect(
			dialog.getByRole('button', {name: 'View licence'}),
		).toHaveCount(0);
		await expect(
			dialog.getByRole('link', {name: /Licence \(MIT\)/}),
		).toBeVisible();

		await dialog.getByRole('button', {name: 'View notices'}).click();
		const noticesList = dialog.locator('#settings-third-party-notices');
		await expect(noticesList).toBeVisible();
		await expect(noticesList.getByText('react', {exact: true})).toBeVisible();
		await expect(noticesList.getByText('zustand', {exact: true})).toBeVisible();

		// Close with Escape
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();

		// Also reachable from Editor screen
		await importSyntheticProject(page, 'Settings check');
		await expect(
			page.getByRole('button', {name: 'Back to library'}),
		).toBeVisible();
		const editorDialog = await openSettings(page);
		await expect(editorDialog.getByText('PixelSortGUI')).toBeVisible();

		expect(externalRequests).toEqual([]);
	});

	test('persistence request stays non-blocking while pending', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			if (!navigator.storage) {
				return;
			}

			Object.defineProperties(navigator.storage, {
				persisted: {
					configurable: true,
					value: async () => false,
				},
				persist: {
					configurable: true,
					value: () => new Promise<boolean>(() => {}),
				},
			});
		});

		await page.setViewportSize(DESKTOP_VIEWPORT);
		await page.goto('/');

		const dialog = await openSettings(page);
		const requestButton = dialog.getByRole('button', {
			name: 'Request protection',
		});
		await expect(requestButton).toBeVisible();
		await requestButton.click();

		await expect(
			dialog.getByRole('button', {name: 'Requesting protection...'}),
		).toBeDisabled();

		// Dialog remains interactive while persist() is pending
		await dialog.getByRole('radio', {name: 'Light'}).click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
	});

	for (const theme of ['light', 'dark'] as const) {
		for (const viewport of PROOF_VIEWPORTS) {
			test(`@a11y layout and axe clean in ${theme} theme at ${viewport.width}x${viewport.height}`, async ({
				page,
			}) => {
				await page.addInitScript((selectedTheme) => {
					globalThis.localStorage.setItem('psg:theme', selectedTheme);
				}, theme);

				await page.setViewportSize({
					width: viewport.width,
					height: viewport.height,
				});
				await page.goto('/');

				const dialog = await openSettings(page);
				await expect(
					dialog.getByRole('heading', {name: 'Appearance'}),
				).toBeVisible();

				const overflow = await page.evaluate(
					() =>
						globalThis.document.documentElement.scrollWidth >
						globalThis.document.documentElement.clientWidth,
				);
				expect(overflow).toBe(false);

				await assertNoA11yViolations(page);
			});
		}
	}
});
