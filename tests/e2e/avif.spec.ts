import {Buffer} from 'node:buffer';
import {readFile} from 'node:fs/promises';
import {expect, test, type Page} from '@playwright/test';
import {encode as encodePng} from 'fast-png';
import {assertNoA11yViolations} from './axe.ts';
import {chooseImages, makeImage} from './import.ts';
import {PROOF_VIEWPORTS} from './viewports.ts';

// The lazy encoder script and its Wasm file.
const AVIF_CHUNK = /\/assets\/avif(?:_enc)?-[^/]+\.(?:js|wasm)$/;

// Firefox saves an image it can display and then opens it in a tab, and
// Playwright reports no download for that. This keeps the download event.
test.use({
	launchOptions: {
		firefoxUserPrefs: {
			'browser.download.viewableInternally.enabledTypes': '',
		},
	},
});

// Noise compresses badly, so a size limit has quality to give up.
function noiseImage(width: number, height: number) {
	let state = 1;
	const data = new Uint8Array(width * height * 3).map(() => {
		state = (state * 48_271) % 2_147_483_647;
		return state / 256;
	});
	return {
		name: 'noise.png',
		mimeType: 'image/png',
		buffer: Buffer.from(encodePng({width, height, data, channels: 3})),
	};
}

function collectErrors(page: Page): string[] {
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

async function openProject(
	page: Page,
	width: number,
	height: number,
	image?: ReturnType<typeof noiseImage>,
) {
	await page.goto('/');
	await expect(
		page.getByRole('banner').getByRole('button', {name: 'Import images'}),
	).toBeVisible();
	await chooseImages(page, [
		image ?? (await makeImage(page, {name: 'a.png', width, height})),
	]);
	await expect(
		page.getByRole('region', {name: 'Canvas', exact: true}),
	).toBeVisible();
}

async function openExport(page: Page) {
	await page.getByRole('button', {name: 'Export'}).click();
	const dialog = page.getByRole('dialog', {name: 'Export'});
	await expect(dialog).toBeVisible();
	return dialog;
}

async function download(page: Page, format: string): Promise<Buffer> {
	const dialog = page.getByRole('dialog', {name: 'Export'});
	await dialog.getByRole('radio', {name: format, exact: true}).click();
	const [file] = await Promise.all([
		page.waitForEvent('download'),
		dialog.getByRole('button', {name: 'Download'}).click(),
	]);
	if (format === 'AVIF') {
		expect(file.suggestedFilename()).toMatch(/\.avif$/);
	}

	return readFile(await file.path());
}

function expectAvifHeader(bytes: Buffer): void {
	expect(bytes.subarray(4, 12).toString('latin1')).toBe('ftypavif');
}

async function decodedSize(page: Page, bytes: Buffer) {
	return page.evaluate(async (base64) => {
		const response = await fetch(`data:image/avif;base64,${base64}`);
		const bitmap = await globalThis.createImageBitmap(await response.blob());
		return {width: bitmap.width, height: bitmap.height};
	}, bytes.toString('base64'));
}

test('AVIF export has the right header, size and no metadata, with a size limit too (AC-F21.5)', async ({
	page,
}) => {
	const errors = collectErrors(page);
	await openProject(page, 301, 203, noiseImage(301, 203));
	const dialog = await openExport(page);
	await dialog.getByRole('radio', {name: 'AVIF', exact: true}).click();
	await expect(dialog.getByRole('spinbutton', {name: 'Quality'})).toHaveValue(
		'80',
	);

	const full = await download(page, 'AVIF');
	expectAvifHeader(full);
	expect(await decodedSize(page, full)).toEqual({width: 301, height: 203});
	expect(full.includes('Exif')).toBe(false);
	// An ICC profile would be a `colr` box of type `prof` or `rICC`.
	expect(full.includes('colrprof')).toBe(false);
	expect(full.includes('colrrICC')).toBe(false);

	await dialog.getByRole('radio', {name: '1/2', exact: true}).click();
	const half = await download(page, 'AVIF');
	expect(await decodedSize(page, half)).toEqual({width: 150, height: 101});

	await dialog.getByRole('radio', {name: 'Full', exact: true}).click();
	await dialog.getByRole('radio', {name: 'Custom', exact: true}).last().click();
	const limit = dialog.getByRole('spinbutton', {name: 'Max size'});
	const limitKb = Math.max(10, Math.floor(full.length / 1024 / 2));
	expect(full.length).toBeGreaterThan(limitKb * 1024);
	await limit.fill(String(limitKb));
	await limit.press('Enter');
	const limited = await download(page, 'AVIF');
	expectAvifHeader(limited);
	expect(limited.length).toBeLessThanOrEqual(limitKb * 1024);
	expect(errors).toEqual([]);
});

// Without the service worker, every request the page and its workers make is
// visible here; the offline precache downloads the files in the background.
test.describe('lazy AVIF encoder (AC-F21.6)', () => {
	test.use({serviceWorkers: 'block'});

	test('stays unloaded until an AVIF export', async ({page}) => {
		const requests: string[] = [];
		page.context().on('request', (request) => {
			if (AVIF_CHUNK.test(request.url())) {
				requests.push(new URL(request.url()).pathname);
			}
		});
		await openProject(page, 40, 30);
		await openExport(page);
		await download(page, 'PNG');
		await download(page, 'JPEG');
		await page.waitForLoadState('networkidle');
		expect(requests).toEqual([]);

		await download(page, 'AVIF');
		expect(requests.some((url) => url.endsWith('.wasm'))).toBe(true);
		expect(requests.some((url) => url.endsWith('.js'))).toBe(true);
	});
});

test('AVIF export works offline once the app is precached (AC-F21.6)', async ({
	page,
	context,
}) => {
	await openProject(page, 40, 30);
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
	});
	// The first load is not controlled by the new service worker.
	await page.reload({waitUntil: 'load'});
	await expect
		.poll(async () =>
			page.evaluate(() => navigator.serviceWorker.controller !== null),
		)
		.toBe(true);

	await context.setOffline(true);
	try {
		await page.reload({waitUntil: 'load'});
		await openExport(page);
		const avif = await download(page, 'AVIF');
		expectAvifHeader(avif);
		expect(await decodedSize(page, avif)).toEqual({width: 40, height: 30});
	} finally {
		await context.setOffline(false);
	}
});

for (const viewport of PROOF_VIEWPORTS) {
	test(`the export dialog offers AVIF at ${viewport.name} @a11y`, async ({
		page,
		browserName,
	}) => {
		const errors = collectErrors(page);
		await page.setViewportSize(viewport);
		await openProject(page, 120, 80);
		const dialog = await openExport(page);
		await dialog.getByRole('radio', {name: 'AVIF', exact: true}).click();
		await expect(dialog.getByRole('spinbutton', {name: 'Quality'})).toHaveValue(
			'80',
		);

		for (const format of ['PNG', 'JPEG', 'WebP', 'AVIF', 'BMP', 'TIFF']) {
			const radio = dialog.getByRole('radio', {name: format, exact: true});
			await expect(radio).toBeInViewport({ratio: 1});
			expect(
				await radio.evaluate(
					(element) => element.scrollWidth <= element.clientWidth,
				),
				`${format} label fits`,
			).toBe(true);
		}

		const overflow = await page.evaluate(
			() =>
				globalThis.document.documentElement.scrollWidth - globalThis.innerWidth,
		);
		expect(overflow, 'Horizontal overflow').toBeLessThanOrEqual(0);
		await assertNoA11yViolations(page);
		if (browserName === 'chromium') {
			await page.screenshot({
				path: `.proof/avif-export-${viewport.width}x${viewport.height}.png`,
				animations: 'disabled',
			});
		}

		expect(errors).toEqual([]);
	});
}
