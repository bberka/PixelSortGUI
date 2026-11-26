import {expect, test, type Page} from '@playwright/test';
import {assertNoA11yViolations} from './axe.ts';
import {importSyntheticProject} from './seed.ts';
import {PROOF_VIEWPORTS, type ProofViewport} from './viewports.ts';

const THEMES = [
	{
		name: 'light',
		media: 'light',
		stored: 'light',
		background: 'rgb(250, 250, 250)',
	},
	{name: 'dark', media: 'dark', stored: 'dark', background: 'rgb(0, 0, 0)'},
] as const;

type ThemeCase = (typeof THEMES)[number];

const MISSING_PROJECT_HASH = '/#/p/3f5e2b8a-0000-4000-8000-000000000000';

function collectConsoleErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'error') {
			errors.push(message.text());
		}
	});
	page.on('pageerror', (error) => {
		errors.push(error.message);
	});
	return errors;
}

async function openInTheme(
	page: Page,
	theme: ThemeCase,
	path: string,
	viewport?: ProofViewport,
): Promise<void> {
	await page.emulateMedia({colorScheme: theme.media});
	await page.addInitScript((value) => {
		globalThis.localStorage.setItem('drift:theme', value);
	}, theme.stored);

	if (viewport) {
		await page.setViewportSize({
			width: viewport.width,
			height: viewport.height,
		});
	}

	await page.goto(path);
}

/**
 Hovers the notice toast: sonner pauses its dismiss timer on hover, so axe does
 not sample the contrast of the exit fade.
 */
async function hoverNoticeToast(page: Page): Promise<void> {
	const toast = page.getByText('That project no longer exists.').first();
	await toast.waitFor();
	await toast.hover();
}

/**
 Plain http over a LAN address is an insecure context; this makes every run
 insecure regardless of the loopback host the preview server listens on.
 */
async function blockSecureContext(page: Page): Promise<void> {
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, 'isSecureContext', {
			value: false,
			configurable: true,
		});
	});
}

async function blockIndexedDb(page: Page): Promise<void> {
	await page.addInitScript(() => {
		IDBFactory.prototype.open = () => {
			throw new Error('IndexedDB is blocked by this test');
		};
	});
}

async function expectLayoutAndA11y(
	page: Page,
	viewport: ProofViewport,
	consoleErrors: string[],
): Promise<void> {
	const metrics = await page.evaluate(() => ({
		scrollWidth: globalThis.document.documentElement.scrollWidth,
		innerWidth: globalThis.innerWidth,
	}));

	expect(
		metrics.scrollWidth,
		`Expected no horizontal page scroll at ${viewport.width}x${viewport.height}`,
	).toBeLessThanOrEqual(metrics.innerWidth);
	await assertNoA11yViolations(page);
	expect(consoleErrors, 'Console errors').toEqual([]);
}

test('the app opens on the library screen with the empty state', async ({
	page,
}) => {
	const consoleErrors = collectConsoleErrors(page);
	await page.goto('/');

	await expect(
		page.getByRole('heading', {level: 1, name: 'Drift'}),
	).toBeVisible();
	await expect(
		page.getByRole('heading', {
			level: 2,
			name: 'Glitch art and pixel sorting for your photos',
		}),
	).toBeVisible();
	await expect(page.getByText('Images stay on this device.')).toBeVisible();
	await expect(page.getByRole('button', {name: 'Open images'})).toBeEnabled();
	expect(consoleErrors, 'Console errors').toEqual([]);
});

test('an unknown project id shows the notice and lands on the library', async ({
	page,
}) => {
	await page.goto(MISSING_PROJECT_HASH);

	await hoverNoticeToast(page);
	await expect(
		page.getByRole('heading', {
			level: 2,
			name: 'Glitch art and pixel sorting for your photos',
		}),
	).toBeVisible();
	expect(new URL(page.url()).hash).toBe('#/');
});

test('with IndexedDB unavailable the banner shows and the app stays usable', async ({
	page,
}) => {
	const consoleErrors = collectConsoleErrors(page);
	await blockIndexedDb(page);
	await page.goto('/');

	await expect(page.getByRole('alert')).toHaveText(
		'Storage unavailable: nothing will be saved after you close this tab.',
	);
	await expect(
		page.getByRole('heading', {
			level: 2,
			name: 'Glitch art and pixel sorting for your photos',
		}),
	).toBeVisible();

	await importSyntheticProject(page, 'Memory only');
	await expect(
		page.getByRole('region', {name: 'Canvas', exact: true}),
	).toBeVisible();
	expect(consoleErrors, 'Console errors').toEqual([]);
});

test('the app bar goes back to the library from the editor', async ({page}) => {
	await page.goto('/');
	await importSyntheticProject(page);
	await expect(
		page.getByRole('region', {name: 'Canvas', exact: true}),
	).toBeVisible();

	await page.getByRole('button', {name: 'Back to library'}).click();

	await expect(
		page.getByRole('region', {name: 'Canvas', exact: true}),
	).toHaveCount(0);
	expect(new URL(page.url()).hash).toBe('#/');
});

for (const theme of THEMES) {
	for (const viewport of PROOF_VIEWPORTS) {
		test(`the app bar icon loads without overflow in ${theme.name} at ${viewport.name} @a11y`, async ({
			page,
		}) => {
			const consoleErrors = collectConsoleErrors(page);
			await openInTheme(page, theme, '/', viewport);
			await importSyntheticProject(page, 'A rather long project name');
			await expect(
				page.getByRole('region', {name: 'Canvas', exact: true}),
			).toBeVisible();

			const icon = page.locator('header img[src="/icons/icon.svg"]');
			await expect(icon).toBeVisible();
			await expect(icon).toHaveAttribute('alt', '');
			await expect(icon).toHaveJSProperty('naturalWidth', 512);
			expect(await icon.boundingBox()).toMatchObject({width: 24, height: 24});
			await expectLayoutAndA11y(page, viewport, consoleErrors);
		});
	}
}

test('the Settings theme selector changes the theme and survives a reload', async ({
	page,
}) => {
	await page.goto('/');

	const readTheme = () =>
		page.evaluate(() => ({
			stored: globalThis.localStorage.getItem('drift:theme'),
			attr: globalThis.document.documentElement.dataset.theme,
			background: globalThis.getComputedStyle(
				globalThis.document.documentElement,
			).backgroundColor,
		}));

	await page.getByRole('button', {name: 'Settings'}).click();
	await page
		.getByRole('dialog')
		.getByRole('radio', {name: 'True Black'})
		.click();
	await expect.poll(readTheme).toEqual({
		stored: 'dark',
		attr: 'dark',
		background: 'rgb(0, 0, 0)',
	});

	await page.reload();
	expect(await readTheme()).toEqual({
		stored: 'dark',
		attr: 'dark',
		background: 'rgb(0, 0, 0)',
	});

	await page.getByRole('button', {name: 'Settings'}).click();
	await page.getByRole('dialog').getByRole('radio', {name: 'Light'}).click();
	await page.reload();
	expect(await readTheme()).toEqual({
		stored: 'light',
		attr: 'light',
		background: 'rgb(250, 250, 250)',
	});
});

test('the live region announces a message when the announce function is called', async ({
	page,
}) => {
	await page.goto('/');

	const status = page.getByRole('status', {name: 'Status messages'});
	await expect(status).toHaveText('');

	await page.evaluate(() => {
		(
			globalThis as unknown as {__psgAnnounce?: (message: string) => void}
		).__psgAnnounce?.('Rendered');
	});

	await expect(status).toHaveText('Rendered');
});

test('keyboard: the first Tab reaches a visible control and focus follows the visual order', async ({
	page,
}) => {
	await page.goto('/');
	await importSyntheticProject(page);
	await expect(
		page.getByRole('heading', {level: 1, name: 'Drift'}),
	).toBeVisible();

	await page.keyboard.press('Tab');
	const backButton = page.getByRole('button', {name: 'Back to library'});
	await expect(backButton).toBeFocused();
	await expect(backButton).toBeVisible();
	await expect
		.poll(() =>
			backButton.evaluate((element) => {
				const computed = globalThis.getComputedStyle(element);
				return {
					outlineStyle: computed.outlineStyle,
					outlineWidth: computed.outlineWidth,
				};
			}),
		)
		.toEqual({outlineStyle: 'solid', outlineWidth: '2px'});

	const backBox = await backButton.boundingBox();
	await page.keyboard.press('Tab');
	const exportButton = page.getByRole('button', {name: 'Export'});
	await expect(exportButton).toBeFocused();
	const exportBox = await exportButton.boundingBox();
	await page.keyboard.press('Tab');
	const guideButton = page.getByRole('button', {name: 'Guide', exact: true});
	await expect(guideButton).toBeFocused();
	const guideBox = await guideButton.boundingBox();
	await page.keyboard.press('Tab');
	const settingsButton = page.getByRole('button', {name: 'Settings'});
	await expect(settingsButton).toBeFocused();
	const settingsBox = await settingsButton.boundingBox();
	if (!backBox || !exportBox || !guideBox || !settingsBox) {
		throw new Error('All app bar controls must have a layout box');
	}

	expect(backBox.x).toBeLessThan(exportBox.x);
	expect(exportBox.x).toBeLessThan(guideBox.x);
	expect(guideBox.x).toBeLessThan(settingsBox.x);
});

test('the app bar has no theme button on the library and editor screens', async ({
	page,
}) => {
	await page.goto('/');
	const header = page.getByRole('banner');
	await expect(header.getByRole('button', {name: 'Settings'})).toBeVisible();
	await expect(header.getByRole('button', {name: /theme/i})).toHaveCount(0);

	await importSyntheticProject(page);
	await expect(
		page.getByRole('button', {name: 'Back to library'}),
	).toBeVisible();
	await expect(header.getByRole('button', {name: 'Settings'})).toBeVisible();
	await expect(header.getByRole('button', {name: /theme/i})).toHaveCount(0);
});

test('the component gallery is still reachable at its dev route', async ({
	page,
}) => {
	await page.goto('/#/dev/gallery');

	await expect(
		page.getByRole('heading', {level: 1, name: 'Drift'}),
	).toBeVisible();
	await expect(
		page.getByRole('radiogroup', {name: 'Theme'}).first(),
	).toBeVisible();
});

for (const theme of THEMES) {
	for (const viewport of PROOF_VIEWPORTS) {
		test(`library empty state has no a11y violations or horizontal scroll in ${theme.name} at ${viewport.name} @a11y`, async ({
			page,
		}) => {
			const consoleErrors = collectConsoleErrors(page);
			await openInTheme(page, theme, '/', viewport);
			await expect(
				page.getByRole('heading', {
					level: 2,
					name: 'Glitch art and pixel sorting for your photos',
				}),
			).toBeVisible();
			await expectLayoutAndA11y(page, viewport, consoleErrors);
		});

		test(`editor placeholder has no a11y violations or horizontal scroll in ${theme.name} at ${viewport.name} @a11y`, async ({
			page,
		}) => {
			const consoleErrors = collectConsoleErrors(page);
			await openInTheme(page, theme, '/', viewport);
			await importSyntheticProject(page);
			await expect(
				page.getByRole('region', {name: 'Canvas', exact: true}),
			).toBeVisible();
			await expectLayoutAndA11y(page, viewport, consoleErrors);
		});

		test(`storage-unavailable banner has no a11y violations or horizontal scroll in ${theme.name} at ${viewport.name} @a11y`, async ({
			page,
		}) => {
			const consoleErrors = collectConsoleErrors(page);
			await blockIndexedDb(page);
			await openInTheme(page, theme, '/', viewport);
			await expect(page.getByRole('alert')).toBeVisible();
			await expectLayoutAndA11y(page, viewport, consoleErrors);
		});

		test(`secure-context screen has no a11y violations or horizontal scroll in ${theme.name} at ${viewport.name} @a11y`, async ({
			page,
		}) => {
			const consoleErrors = collectConsoleErrors(page);
			await blockSecureContext(page);
			await openInTheme(page, theme, '/', viewport);
			await expect(
				page.getByRole('heading', {
					level: 1,
					name: 'Secure connection required',
				}),
			).toBeVisible();
			await expectLayoutAndA11y(page, viewport, consoleErrors);
		});

		test(`missing-project notice has no a11y violations or horizontal scroll in ${theme.name} at ${viewport.name} @a11y`, async ({
			page,
		}) => {
			const consoleErrors = collectConsoleErrors(page);
			await openInTheme(page, theme, MISSING_PROJECT_HASH, viewport);
			await hoverNoticeToast(page);
			await expectLayoutAndA11y(page, viewport, consoleErrors);
		});
	}
}
