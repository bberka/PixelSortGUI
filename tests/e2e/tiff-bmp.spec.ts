import {Buffer} from 'node:buffer';
import {readFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {expect, test, type Page} from '@playwright/test';
import {decode as decodePng} from 'fast-png';
import {tiffBytes, type TiffFixture} from '../fixtures/tiff.ts';
import {assertNoA11yViolations} from './axe.ts';
import {chooseImages, makeImage, readImportState} from './import.ts';
import {PROOF_VIEWPORTS} from './viewports.ts';

const WIDTH = 48;
const HEIGHT = 32;
const UTIF_CHUNK = /\/assets\/UTIF-[^/]+\.js$/;

/**
 Red grows to the right and green downwards, so a flipped or turned import
 changes the pixels.
 */
function gradient(): number[] {
	const out: number[] = [];
	for (let y = 0; y < HEIGHT; y++) {
		for (let x = 0; x < WIDTH; x++) {
			out.push(x * 5, y * 7, 90);
		}
	}

	return out;
}

/**
 The gradient stored as orientation 6 expects: the viewer turns the stored
 page 90 degrees clockwise to get the upright image.
 */
function storedQuarterTurn(): number[] {
	const upright = gradient();
	const out: number[] = [];
	for (let y = 0; y < WIDTH; y++) {
		for (let x = 0; x < HEIGHT; x++) {
			const at = (x * WIDTH + (WIDTH - 1 - y)) * 3;
			out.push(...upright.slice(at, at + 3));
		}
	}

	return out;
}

function tiffFile(name: string, fixture: TiffFixture) {
	return {
		name,
		mimeType: 'image/tiff',
		buffer: Buffer.from(tiffBytes(fixture)),
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

async function gotoLibrary(page: Page): Promise<void> {
	await page.goto('/');
	await expect(
		page.getByRole('banner').getByRole('button', {name: 'Import images'}),
	).toBeVisible();
}

async function openExport(page: Page) {
	await page.getByRole('button', {name: 'Export'}).click();
	const dialog = page.getByRole('dialog', {name: 'Export'});
	await expect(dialog).toBeVisible();
	return dialog;
}

async function download(page: Page, format: string): Promise<Uint8Array> {
	const dialog = page.getByRole('dialog', {name: 'Export'});
	await dialog.getByRole('radio', {name: format, exact: true}).click();
	const [file] = await Promise.all([
		page.waitForEvent('download'),
		dialog.getByRole('button', {name: 'Download'}).click(),
	]);
	const extension = {PNG: 'png', BMP: 'bmp', TIFF: 'tif'}[format]!;
	expect(file.suggestedFilename()).toMatch(
		new RegExp(String.raw`\.${extension}$`),
	);
	return new Uint8Array(await readFile(await file.path()));
}

function rgbOfPng(bytes: Uint8Array): number[] {
	const png = decodePng(bytes);
	return Array.from(png.data).filter((_, index) => index % png.channels !== 3);
}

for (const [name, fixture] of [
	['8-bit RGB', {width: WIDTH, height: HEIGHT, pixels: gradient()}],
	[
		'16-bit big-endian',
		{
			width: WIDTH,
			height: HEIGHT,
			bits: 16,
			littleEndian: false,
			pixels: gradient().map((value) => value * 256 + 200),
		},
	],
	[
		'Deflate',
		{
			width: WIDTH,
			height: HEIGHT,
			pixels: gradient(),
			compression: 8,
			strip: deflateSync(Buffer.from(gradient())),
		},
	],
	[
		'quarter-turned',
		{
			width: HEIGHT,
			height: WIDTH,
			pixels: storedQuarterTurn(),
			orientation: 6,
		},
	],
] as const satisfies ReadonlyArray<readonly [string, TiffFixture]>) {
	test(`a ${name} TIFF imports upright at its exact size (AC-F21.1)`, async ({
		page,
	}) => {
		const errors = collectErrors(page);
		await gotoLibrary(page);
		await chooseImages(page, [tiffFile('scan.tif', fixture)]);

		await expect(
			page.getByRole('region', {name: 'Canvas', exact: true}),
		).toBeVisible();
		const snapshot = await readImportState(page);
		expect(snapshot.projects).toHaveLength(1);
		expect(snapshot.projects[0]).toMatchObject({
			sourceWidth: WIDTH,
			sourceHeight: HEIGHT,
		});

		// With an empty stack the export is the decoded source.
		await openExport(page);
		const png = await download(page, 'PNG');
		expect(decodePng(png)).toMatchObject({width: WIDTH, height: HEIGHT});
		expect(rgbOfPng(png)).toEqual(gradient());
		expect(errors).toEqual([]);
	});
}

test('an unsupported TIFF creates no project and says why', async ({page}) => {
	await gotoLibrary(page);
	await chooseImages(page, [
		tiffFile('fax.tif', {
			width: WIDTH,
			height: HEIGHT,
			pixels: gradient(),
			compression: 4,
		}),
	]);

	await expect(
		page.getByText(
			"Can't open fax.tif: the browser can't read this image format.",
		),
	).toBeVisible();
	expect((await readImportState(page)).projects).toHaveLength(0);
});

test('BMP and TIFF exports have the right header, size and no metadata (AC-F21.5)', async ({
	page,
}) => {
	const errors = collectErrors(page);
	await gotoLibrary(page);
	await chooseImages(page, [
		await makeImage(page, {name: 'a.png', width: 301, height: 203}),
	]);
	await openExport(page);
	const source = rgbOfPng(await download(page, 'PNG'));

	const bmp = await download(page, 'BMP');
	const bmpView = new DataView(bmp.buffer, bmp.byteOffset);
	expect(Buffer.from(bmp.subarray(0, 2)).toString('latin1')).toBe('BM');
	expect(bmpView.getInt32(18, true)).toBe(301);
	expect(bmpView.getInt32(22, true)).toBe(203);
	expect(bmpView.getUint16(28, true)).toBe(24);
	// Header and padded rows only: there is no room for a metadata block.
	expect(bmp.length).toBe(54 + Math.ceil((301 * 3) / 4) * 4 * 203);
	const bmpPixels = await page.evaluate(async (base64) => {
		const response = await fetch(`data:image/bmp;base64,${base64}`);
		const bitmap = await globalThis.createImageBitmap(await response.blob());
		const context = new globalThis.OffscreenCanvas(
			bitmap.width,
			bitmap.height,
		).getContext('2d')!;
		context.drawImage(bitmap, 0, 0);
		return [
			...context.getImageData(0, 0, bitmap.width, bitmap.height).data,
		].filter((_, index) => index % 4 !== 3);
	}, Buffer.from(bmp).toString('base64'));
	expect(bmpPixels).toEqual(source);

	const tiff = await download(page, 'TIFF');
	const view = new DataView(tiff.buffer, tiff.byteOffset);
	expect([...tiff.subarray(0, 4)]).toEqual([0x4d, 0x4d, 0, 42]);
	const directory = view.getUint32(4);
	const tags = new Map<number, number>();
	for (let i = 0; i < view.getUint16(directory); i++) {
		const entry = directory + 2 + i * 12;
		// A single SHORT sits in the high half of the value field.
		tags.set(
			view.getUint16(entry),
			view.getUint16(entry + 2) === 3
				? view.getUint16(entry + 8)
				: view.getUint32(entry + 8),
		);
	}

	expect(tags.get(256)).toBe(301);
	expect(tags.get(257)).toBe(203);
	// Uncompressed.
	expect(tags.get(259)).toBe(1);
	// EXIF, GPS, XMP, IPTC, Photoshop and ICC profile tags.
	for (const metadata of [34_665, 34_853, 700, 33_723, 34_377, 34_675]) {
		expect(tags.has(metadata)).toBe(false);
	}

	expect(tiff.length).toBe(1000 + 301 * 203 * 4);
	expect(
		[...tiff.subarray(1000)].filter((_, index) => index % 4 !== 3),
	).toEqual(source);
	expect(errors).toEqual([]);
});

// Without the service worker, every request the page and its workers make is
// visible here; the offline precache is allowed to hold the chunk (AC-F21.6).
test.describe('lazy utif2 chunk (AC-F21.6)', () => {
	test.use({serviceWorkers: 'block'});

	function watchChunk(page: Page): string[] {
		const requests: string[] = [];
		page.context().on('request', (request) => {
			if (UTIF_CHUNK.test(request.url())) {
				requests.push(request.url());
			}
		});
		return requests;
	}

	test('stays unloaded until TIFF export is selected', async ({page}) => {
		const requests = watchChunk(page);
		await gotoLibrary(page);
		await chooseImages(page, [
			await makeImage(page, {name: 'a.png', width: 40, height: 30}),
		]);
		await openExport(page);
		await download(page, 'PNG');
		await download(page, 'BMP');
		await page.waitForLoadState('networkidle');
		expect(requests).toEqual([]);

		await download(page, 'TIFF');
		expect(requests.length).toBeGreaterThan(0);
	});

	test('loads when a TIFF is imported', async ({page}) => {
		const requests = watchChunk(page);
		await gotoLibrary(page);
		await page.waitForLoadState('networkidle');
		expect(requests).toEqual([]);

		await chooseImages(page, [
			tiffFile('scan.tif', {width: WIDTH, height: HEIGHT, pixels: gradient()}),
		]);
		await expect.poll(() => requests.length).toBeGreaterThan(0);
	});
});

test('TIFF export works offline once the app is precached (AC-F21.6)', async ({
	page,
	context,
}) => {
	await gotoLibrary(page);
	await chooseImages(page, [
		await makeImage(page, {name: 'a.png', width: 40, height: 30}),
	]);
	await expect(
		page.getByRole('region', {name: 'Canvas', exact: true}),
	).toBeVisible();
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
		const tiff = await download(page, 'TIFF');
		expect([...tiff.subarray(0, 4)]).toEqual([0x4d, 0x4d, 0, 42]);
	} finally {
		await context.setOffline(false);
	}
});

for (const viewport of PROOF_VIEWPORTS) {
	test(`the export dialog offers BMP and TIFF at ${viewport.name} @a11y`, async ({
		page,
		browserName,
	}) => {
		const errors = collectErrors(page);
		await page.setViewportSize(viewport);
		await gotoLibrary(page);
		await chooseImages(page, [
			tiffFile('scan.tif', {width: WIDTH, height: HEIGHT, pixels: gradient()}),
		]);
		await expect(
			page.getByRole('region', {name: 'Canvas', exact: true}),
		).toBeVisible();
		const dialog = await openExport(page);
		await dialog.getByRole('radio', {name: 'TIFF', exact: true}).click();
		await expect(dialog.getByRole('spinbutton', {name: 'Quality'})).toHaveCount(
			0,
		);
		await dialog.getByRole('radio', {name: '1 MB', exact: true}).click();
		await expect(dialog).toContainText(
			'TIFF is lossless and scales dimensions to fit.',
		);

		for (const format of ['PNG', 'JPEG', 'WebP', 'BMP', 'TIFF']) {
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
				path: `.proof/tiff-export-${viewport.width}x${viewport.height}.png`,
				animations: 'disabled',
			});
		}

		expect(errors).toEqual([]);
	});
}
