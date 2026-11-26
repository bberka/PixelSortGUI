import {expect, test, type Page} from '@playwright/test';
import type {AppRuntime} from '../../src/state/index.ts';
import {assertNoA11yViolations} from './axe.ts';
import {makeImage, readImportState} from './import.ts';
import {importSyntheticProject} from './seed.ts';
import {waitForSettleRender} from './settle.ts';
import {PROOF_VIEWPORTS} from './viewports.ts';

const PITCH = 'Glitch art and pixel sorting for your photos';

const TILES = [
	{name: 'Pixel sort', effects: ['pixelSort', 'pixelSort']},
	{name: 'Channel shift', effects: ['channelShift']},
	{name: 'Slice shift', effects: ['sliceShift']},
	{name: 'Posterize', effects: ['posterize']},
] as const;

// The owner reported the screen from a window about this size.
const WIDTHS = [
	...PROOF_VIEWPORTS,
	{name: 'reported', width: 1204, height: 772},
] as const;

const heading = (page: Page) =>
	page.getByRole('heading', {level: 2, name: PITCH});

const introduction = (page: Page) =>
	page.getByRole('region', {name: 'See what Drift does'});

const tile = (page: Page, name: string) =>
	introduction(page).getByRole('button', {name: new RegExp(`^${name}`)});

const sampleButton = (page: Page) =>
	page.getByRole('button', {name: 'Try a sample'});

async function previewsRendered(page: Page) {
	await expect(introduction(page).locator('canvas[data-rendered]')).toHaveCount(
		TILES.length,
	);
}

async function gotoLanding(page: Page) {
	await page.goto('/');
	await expect(heading(page)).toBeVisible();
}

async function activeProject(page: Page) {
	return page.evaluate(async () => {
		const runtime = (globalThis as unknown as {__psgRuntime?: AppRuntime})
			.__psgRuntime;
		const booted = await runtime?.ready;
		if (booted?.status !== 'ready') {
			throw new Error('App not ready');
		}

		const state = booted.bundle.store.getState();
		return {
			name: state.activeProject?.name ?? null,
			effects:
				state.activeProject?.stack.instances.map((item) => item.type) ?? [],
			history: state.history.map((entry) => entry.label),
		};
	});
}

for (const viewport of WIDTHS) {
	test(`the app bar shows Import images, Guide and Settings at ${viewport.name} width (AC-F2.9)`, async ({
		page,
	}) => {
		await page.setViewportSize(viewport);
		await gotoLanding(page);
		const banner = page.getByRole('banner');
		const expectActions = async () => {
			for (const name of ['Import images', 'Guide', 'Settings']) {
				const button = banner.getByRole('button', {name, exact: true});
				await expect(button).toBeInViewport({ratio: 1});
				await button.click({trial: true});
			}
		};

		await expectActions();

		await importSyntheticProject(page, 'Not empty');
		await page.getByRole('button', {name: 'Back to library'}).click();
		await expect(
			page.getByRole('button', {name: 'Open Not empty'}),
		).toBeVisible();
		await expectActions();
	});

	test(`the empty library is centred at ${viewport.name} width (AC-F2.8)`, async ({
		page,
	}) => {
		await page.setViewportSize(viewport);
		await gotoLanding(page);
		await previewsRendered(page);

		for (const part of [
			heading(page),
			page.getByRole('region', {name: 'Add photos'}),
			introduction(page),
		]) {
			const box = (await part.boundingBox())!;
			expect(
				Math.abs(box.x + box.width / 2 - viewport.width / 2),
			).toBeLessThanOrEqual(8);
		}

		expect(
			await page.evaluate(
				() => globalThis.document.documentElement.scrollWidth,
			),
		).toBeLessThanOrEqual(viewport.width);
		await expect(page.getByRole('button', {name: 'Open images'})).toHaveCount(
			1,
		);
		await expect(page.getByRole('link', {name: 'Read the guide'})).toHaveCount(
			1,
		);
	});
}

test('a screen too short for the empty library scrolls from its top (AC-F2.8)', async ({
	page,
}) => {
	await page.setViewportSize({width: 844, height: 390});
	await gotoLanding(page);
	await previewsRendered(page);

	const icon = page.locator('main img[src="/icons/icon.svg"]');
	await expect(icon).toBeInViewport({ratio: 1});
	await tile(page, 'Posterize').scrollIntoViewIfNeeded();
	await expect(tile(page, 'Posterize')).toBeInViewport();
	await icon.scrollIntoViewIfNeeded();
	await expect(icon).toBeInViewport({ratio: 1});
});

test('Try a sample creates one 1200 x 900 project and opens it (AC-F2.10)', async ({
	page,
}) => {
	await gotoLanding(page);

	await sampleButton(page).dblclick();

	await expect(page).toHaveURL(/#\/p\//);
	await waitForSettleRender(page);
	const state = await readImportState(page);
	expect(state.projects).toMatchObject([
		{name: 'Sample', sourceWidth: 1200, sourceHeight: 900},
	]);
	expect(state.sourceCount).toBe(1);
	expect(await activeProject(page)).toEqual({
		name: 'Sample',
		effects: [],
		history: ['Initial'],
	});

	// It survives a reload like any other project.
	await page.reload();
	await expect(
		page.getByRole('region', {name: 'Canvas', exact: true}),
	).toBeVisible();
	expect(await activeProject(page)).toMatchObject({name: 'Sample'});
});

for (const {name, effects} of TILES) {
	test(`the ${name} tile opens the sample with its effects, undoable (AC-F2.11)`, async ({
		page,
	}) => {
		await gotoLanding(page);
		await previewsRendered(page);

		await tile(page, name).click();

		await expect(page).toHaveURL(/#\/p\//);
		await expect
			.poll(async () => activeProject(page))
			.toEqual({
				name: 'Sample',
				effects: [...effects],
				history: ['Initial', `Apply preset ${name}`],
			});
		await waitForSettleRender(page);
		await page.getByRole('button', {name: `Undo Apply preset ${name}`}).click();
		await expect
			.poll(async () => (await activeProject(page)).effects)
			.toEqual([]);
	});
}

test('every action works from the keyboard (AC-F2.12)', async ({page}) => {
	await gotoLanding(page);
	await previewsRendered(page);
	// The last control of the app bar.
	await page.getByRole('button', {name: 'Library actions'}).focus();

	for (const target of [
		page.getByRole('button', {name: 'Open images'}),
		sampleButton(page),
		page.getByRole('link', {name: 'Read the guide'}),
		page.getByRole('button', {name: 'Dismiss introduction'}),
		...TILES.map(({name}) => tile(page, name)),
	]) {
		await page.keyboard.press('Tab');
		await expect(target).toBeFocused();
	}

	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', {name: 'Open images'}).press('Enter');
	await chooser;

	await tile(page, 'Posterize').press('Space');
	await expect(page).toHaveURL(/#\/p\//);
});

test('a photo dropped on the drop zone is imported (AC-F1.2)', async ({
	page,
}) => {
	await gotoLanding(page);
	const fixture = await makeImage(page, {
		name: 'dropped.png',
		width: 64,
		height: 48,
	});
	// Built and dispatched in one page task: Firefox crashes when Playwright
	// passes a synthetic DataTransfer handle to `dispatchEvent`.
	await page.getByRole('region', {name: 'Add photos'}).evaluate(
		(zone, {bytes, name}) => {
			const dataTransfer = new globalThis.DataTransfer();
			dataTransfer.items.add(
				new globalThis.File([new Uint8Array(bytes)], name, {
					type: 'image/png',
				}),
			);
			for (const type of ['dragenter', 'dragover', 'drop']) {
				zone.dispatchEvent(
					Object.assign(
						new globalThis.Event(type, {bubbles: true, cancelable: true}),
						{dataTransfer},
					),
				);
			}
		},
		{bytes: [...fixture.buffer], name: fixture.name},
	);

	await expect(page).toHaveURL(/#\/p\//);
	expect((await readImportState(page)).projects).toMatchObject([
		{name: 'dropped'},
	]);
});

test('previews and the sample work offline with no external request (AC-F2.10)', async ({
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
	await gotoLanding(page);
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
	});
	await page.reload();
	await expect
		.poll(async () =>
			page.evaluate(() => navigator.serviceWorker.controller !== null),
		)
		.toBe(true);

	await context.setOffline(true);
	// A new tab has loaded no chunk yet, so each one comes from the precache.
	const offline = await context.newPage();
	await gotoLanding(offline);
	await previewsRendered(offline);
	await sampleButton(offline).click();
	await expect(offline).toHaveURL(/#\/p\//);
	await waitForSettleRender(offline);
	await context.setOffline(false);
	expect(external).toEqual([]);
});

for (const theme of ['light', 'dark'] as const) {
	for (const viewport of PROOF_VIEWPORTS) {
		test(`@a11y the empty library is clean in ${theme} at ${viewport.width}x${viewport.height}, with and without the introduction (AC-F2.12)`, async ({
			page,
		}) => {
			const errors: string[] = [];
			page.on('console', (message) => {
				if (message.type() === 'error' || message.type() === 'warning') {
					errors.push(message.text());
				}
			});
			page.on('pageerror', (error) => {
				errors.push(error.message);
			});
			await page.addInitScript((selected) => {
				globalThis.localStorage.setItem('drift:theme', selected);
			}, theme);
			await page.setViewportSize(viewport);
			await gotoLanding(page);
			await previewsRendered(page);
			await assertNoA11yViolations(page);

			await page.getByRole('button', {name: 'Dismiss introduction'}).click();
			await expect(introduction(page)).toBeHidden();
			await assertNoA11yViolations(page);
			expect(errors).toEqual([]);
		});
	}
}
