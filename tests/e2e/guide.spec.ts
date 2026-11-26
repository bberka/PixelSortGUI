import {expect, test, type Page} from '@playwright/test';
import type {AppRuntime} from '../../src/state/index.ts';
import {assertNoA11yViolations} from './axe.ts';
import {importSyntheticProject} from './seed.ts';
import {DESKTOP_VIEWPORT, PROOF_VIEWPORTS} from './viewports.ts';

const title = (page: Page) =>
	page.getByRole('heading', {level: 2, name: 'Drift guide'});

const guideButton = (page: Page) =>
	page.getByRole('banner').getByRole('button', {name: 'Guide', exact: true});

const welcome = (page: Page) =>
	page.getByRole('region', {name: 'Welcome to Drift'});

async function gotoLibrary(page: Page) {
	await page.goto('/');
	await expect(
		page.getByRole('heading', {level: 2, name: 'No projects yet'}),
	).toBeVisible();
}

async function storedWelcomeDismissed(page: Page) {
	return page.evaluate(async () => {
		const runtime = (globalThis as unknown as {__psgRuntime?: AppRuntime})
			.__psgRuntime;
		const booted = await runtime?.ready;
		if (booted?.status !== 'ready') {
			return false;
		}

		const appState = await booted.bundle.repository.getAppState();
		return appState.welcomeDismissed === true;
	});
}

async function hasNoHorizontalScroll(page: Page) {
	const overflow = await page.evaluate(
		() =>
			globalThis.document.documentElement.scrollWidth -
			globalThis.document.documentElement.clientWidth,
	);
	expect(overflow).toBeLessThanOrEqual(0);
}

test('the app bar button opens the guide from the library and the editor (AC-F27.1)', async ({
	page,
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => {
		errors.push(error.message);
	});
	await gotoLibrary(page);

	await guideButton(page).click();
	await expect(page).toHaveURL(/#\/guide$/);
	await expect(title(page)).toBeFocused();
	await expect(
		page.getByRole('heading', {level: 4, name: 'Pixel sort'}),
	).toBeVisible();
	await page.getByRole('button', {name: 'Back to library'}).click();
	await expect(page).toHaveURL(/#\/$/);

	const id = await importSyntheticProject(page, 'Guide check');
	const canvas = page.getByLabel('Image canvas');
	await expect(canvas).toBeVisible();
	await guideButton(page).click();
	await expect(title(page)).toBeVisible();
	await page.getByRole('button', {name: 'Back to editor'}).click();
	await expect(page).toHaveURL(new RegExp(`#/p/${id}$`));
	await expect(canvas).toBeVisible();
	// The preview is drawn again: the canvas holds more than one colour.
	await expect
		.poll(async () =>
			canvas.evaluate((element) => {
				const target = element as unknown as {
					width: number;
					height: number;
					getContext(type: '2d'): {
						getImageData(
							x: number,
							y: number,
							w: number,
							h: number,
						): {data: Uint8ClampedArray};
					};
				};
				const {data} = target
					.getContext('2d')
					.getImageData(0, 0, target.width, target.height);
				const colours = new Set<number>();
				for (let i = 0; i < data.length; i += 4 * 97) {
					colours.add(data[i] * 65_536 + data[i + 1] * 256 + data[i + 2]);
				}

				return colours.size;
			}),
		)
		.toBeGreaterThan(10);
	expect(errors).toEqual([]);
});

test('? opens the guide, but not while typing or with a dialog open (AC-F27.2)', async ({
	page,
}) => {
	await gotoLibrary(page);

	await page.getByRole('button', {name: 'Settings'}).click();
	await expect(page.getByRole('dialog', {name: 'Settings'})).toBeVisible();
	await page.keyboard.press('?');
	await expect(page).not.toHaveURL(/guide/);
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).toBeHidden();

	await page.keyboard.press('?');
	await expect(title(page)).toBeVisible();

	await page.getByRole('button', {name: 'Back to library'}).click();
	await importSyntheticProject(page, 'Typing');
	await page.getByRole('button', {name: 'Add effect'}).click();
	await page.getByRole('button', {name: /^Channel shift/}).click();
	const field = page.getByRole('textbox', {name: 'Red X'});
	await field.focus();
	await page.keyboard.press('?');
	await expect(field).toHaveValue(/\?/);
	await expect(page).toHaveURL(/#\/p\//);

	await field.press('Escape');
	await page.keyboard.press('?');
	await expect(title(page)).toBeVisible();
});

test('Settings links to the guide and closes (AC-F27.3)', async ({page}) => {
	await gotoLibrary(page);
	await page.getByRole('button', {name: 'Settings'}).click();
	await page
		.getByRole('dialog', {name: 'Settings'})
		.getByRole('link', {name: 'Read the guide'})
		.click();

	await expect(title(page)).toBeVisible();
	await expect(page.getByRole('dialog')).toBeHidden();
});

test('the contents list stays beside the text on desktop and moves focus (AC-F27.5)', async ({
	page,
}) => {
	await page.setViewportSize(DESKTOP_VIEWPORT);
	await page.goto('/#/guide');
	const contents = page.getByRole('navigation', {name: 'Contents'});
	await expect(contents.getByRole('button', {name: 'Contents'})).toBeHidden();

	for (const name of ['Storage and privacy', 'Keyboard shortcuts']) {
		await contents.getByRole('button', {name}).click();
		const heading = page.getByRole('heading', {level: 3, name});
		await expect(heading).toBeFocused();
		await expect(heading).toBeInViewport();
		await expect(
			contents.getByRole('button', {name: 'What Drift is'}),
		).toBeInViewport();
	}

	await expect(page).toHaveURL(/#\/guide$/);
});

const NARROW_VIEWPORTS = PROOF_VIEWPORTS.filter(
	(item) => item.name !== 'desktop',
);

for (const viewport of NARROW_VIEWPORTS) {
	test(`the contents list collapses at ${viewport.name} width (AC-F27.5)`, async ({
		page,
	}) => {
		await page.setViewportSize(viewport);
		await page.goto('/#/guide');
		const contents = page.getByRole('navigation', {name: 'Contents'});
		const toggle = contents.getByRole('button', {name: 'Contents'});
		const entry = contents.getByRole('button', {name: 'Export'});

		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await expect(entry).toBeHidden();
		await toggle.click();
		await entry.click();

		const heading = page.getByRole('heading', {level: 3, name: 'Export'});
		await expect(heading).toBeFocused();
		await expect(heading).toBeInViewport();
		await expect(entry).toBeHidden();
		// The heading is not hidden under the sticky bar.
		const bar = await contents.boundingBox();
		const box = await heading.boundingBox();
		expect(box!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height);
		await hasNoHorizontalScroll(page);
	});
}

test('the welcome card appears once and stays dismissed after reload (AC-F27.7)', async ({
	page,
}) => {
	await gotoLibrary(page);
	await expect(welcome(page)).toBeVisible();
	await expect(
		welcome(page).getByRole('button', {name: 'Import a photo'}),
	).toBeEnabled();
	await expect(
		welcome(page).getByRole('link', {name: 'Read the guide'}),
	).toBeVisible();

	await welcome(page).getByRole('button', {name: 'Dismiss welcome'}).click();
	await expect(welcome(page)).toBeHidden();
	// The card hides before the write finishes, and a reload cancels a write
	// still in flight.
	await expect.poll(async () => storedWelcomeDismissed(page)).toBe(true);

	await page.reload();
	const link = page.getByRole('link', {name: 'New here? Read the guide'});
	await expect(link).toBeVisible();
	await expect(welcome(page)).toBeHidden();
	await link.click();
	await expect(title(page)).toBeVisible();
});

test('#/guide loads offline with no external request (AC-F27.6)', async ({
	page,
	context,
}) => {
	const external: string[] = [];
	context.on('request', (request) => {
		const url = new URL(request.url());
		if (
			url.protocol.startsWith('http') &&
			url.hostname !== 'localhost' &&
			url.hostname !== '127.0.0.1'
		) {
			external.push(request.url());
		}
	});
	await gotoLibrary(page);
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
	});
	// The first load is not controlled; reload so the worker serves the page.
	await page.reload();
	await expect
		.poll(async () =>
			page.evaluate(() => navigator.serviceWorker.controller !== null),
		)
		.toBe(true);

	await context.setOffline(true);
	// A new tab never loaded the guide chunk, so it must come from the precache.
	const offline = await context.newPage();
	await offline.goto('/#/guide');
	await expect(title(offline)).toBeVisible();
	await expect(
		offline.getByRole('heading', {level: 4, name: 'Channel shift'}),
	).toBeVisible();
	await context.setOffline(false);
	expect(external).toEqual([]);
});

for (const theme of ['light', 'dark'] as const) {
	for (const viewport of PROOF_VIEWPORTS) {
		test(`@a11y guide and welcome card are clean in ${theme} at ${viewport.width}x${viewport.height} (AC-F27.8)`, async ({
			page,
		}) => {
			await page.addInitScript((selected) => {
				globalThis.localStorage.setItem('drift:theme', selected);
			}, theme);
			await page.setViewportSize(viewport);

			await gotoLibrary(page);
			await expect(welcome(page)).toBeVisible();
			await hasNoHorizontalScroll(page);
			await assertNoA11yViolations(page);

			await page.goto('/#/guide');
			await expect(title(page)).toBeVisible();
			await hasNoHorizontalScroll(page);
			await assertNoA11yViolations(page);

			if (viewport.name === 'desktop') {
				return;
			}

			await page
				.getByRole('navigation', {name: 'Contents'})
				.getByRole('button', {name: 'Contents'})
				.click();
			await assertNoA11yViolations(page);
		});
	}
}
