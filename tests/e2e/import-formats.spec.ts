import {Buffer} from 'node:buffer';
import {expect, test, type Page} from '@playwright/test';
import {
	animatedAvifBytes,
	BLUE,
	bmpBytes,
	FIXTURE_HEIGHT,
	FIXTURE_WIDTH,
	gifBytes,
	RED,
	stillAvifBytes,
	type Rgb,
} from '../fixtures/formats.ts';
import type {AppRuntime} from '../../src/state/index.ts';
import {assertNoA11yViolations} from './axe.ts';
import {
	chooseImages,
	dropImages,
	readImportState,
	type ImageFixture,
} from './import.ts';
import {PROOF_VIEWPORTS} from './viewports.ts';

function fixture(
	name: string,
	mimeType: string,
	bytes: Uint8Array,
): ImageFixture {
	return {name, mimeType, buffer: Buffer.from(bytes)};
}

function notice(name: string): string {
	return `Imported the first frame of ${name}. Animation is not supported yet.`;
}

function heicRefusal(name: string): string {
	return `Can't open ${name}: HEIC/HEIF is not supported in this browser. Convert it to JPEG, PNG, or WebP first.`;
}

function rawRefusal(name: string): string {
	return `Can't open ${name}: RAW camera files are not supported. Export a TIFF, PNG, or JPEG from your RAW converter first.`;
}

const REFUSED = [
	fixture('phone.heic', 'image/heic', Buffer.from('\0\0\0\u0018ftypheic')),
	fixture('studio.dng', '', Buffer.from('II*\0')),
	fixture('canon.cr2', '', Buffer.from('II*\0\u0010\0\0\0CR\u0002\0')),
];

async function gotoLibrary(page: Page): Promise<void> {
	await page.goto('/');
	await expect(
		page.getByRole('banner').getByRole('button', {name: 'Import images'}),
	).toBeVisible();
}

/**
 The first pixel of the stored source as the browser decodes it, which is what
 the editor's workers see.
 */
async function sourcePixel(page: Page): Promise<number[]> {
	return page.evaluate(async () => {
		const runtime = (globalThis as unknown as {__psgRuntime: AppRuntime})
			.__psgRuntime;
		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			throw new Error('App not ready');
		}

		const source = booted.bundle.store.getState().activeSource!;
		const bitmap = await globalThis.createImageBitmap(source.blob);
		const canvas = new globalThis.OffscreenCanvas(bitmap.width, bitmap.height);
		const context = canvas.getContext('2d')!;
		context.drawImage(bitmap, 0, 0);
		bitmap.close();
		return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
	});
}

async function expectImported(page: Page, color: Rgb): Promise<void> {
	await expect(
		page.getByRole('region', {name: 'Canvas', exact: true}),
	).toBeVisible();
	const snapshot = await readImportState(page);
	expect(snapshot.projects).toHaveLength(1);
	expect(snapshot.projects[0]).toMatchObject({
		sourceWidth: FIXTURE_WIDTH,
		sourceHeight: FIXTURE_HEIGHT,
	});
	const pixel = await sourcePixel(page);
	for (const [channel, expected] of color.entries()) {
		// AVIF is converted through YUV, so allow rounding.
		expect(Math.abs(pixel[channel] - expected)).toBeLessThanOrEqual(4);
	}
}

for (const [name, mimeType, bytes] of [
	['loop.gif', 'image/gif', gifBytes([RED, BLUE])],
	['loop.avif', 'image/avif', animatedAvifBytes()],
] as const) {
	test(`${name} imports frame 0 and shows the first-frame notice (AC-F21.3)`, async ({
		page,
	}) => {
		await gotoLibrary(page);
		await chooseImages(page, [fixture(name, mimeType, bytes)]);

		await expect(page.getByText(notice(name), {exact: true})).toBeVisible();
		await expectImported(page, RED);
	});
}

for (const [name, mimeType, bytes] of [
	['still.gif', 'image/gif', gifBytes([RED])],
	['scan.bmp', 'image/bmp', bmpBytes(RED)],
	['shot.avif', 'image/avif', stillAvifBytes()],
] as const) {
	test(`${name} imports at its exact size without a notice`, async ({page}) => {
		await gotoLibrary(page);
		await chooseImages(page, [fixture(name, mimeType, bytes)]);

		await expectImported(page, RED);
		await expect(page.getByText('Imported the first frame')).toHaveCount(0);
	});
}

for (const [file, message] of [
	[REFUSED[0], heicRefusal('phone.heic')],
	[REFUSED[1], rawRefusal('studio.dng')],
	[REFUSED[2], rawRefusal('canon.cr2')],
] as const) {
	test(`dropping ${file.name} creates no project and names the format (AC-F21.4)`, async ({
		page,
	}) => {
		await gotoLibrary(page);
		await dropImages(page, [file]);

		await expect(page.getByText(message, {exact: true})).toBeVisible();
		const snapshot = await readImportState(page);
		expect(snapshot.projects).toHaveLength(0);
		expect(snapshot.sourceCount).toBe(0);
		expect(snapshot.screen).toBe('library');

		await page.getByRole('button', {name: 'Dismiss'}).click();
		await expect(page.getByRole('alertdialog')).toHaveCount(0);
	});
}

for (const viewport of PROOF_VIEWPORTS) {
	test(`refusals and the first-frame notice fit at ${viewport.name} @a11y`, async ({
		page,
		browserName,
	}) => {
		const errors: string[] = [];
		page.on('console', (message) => {
			if (message.type() === 'error') {
				errors.push(message.text());
			}
		});
		page.on('pageerror', (error) => {
			errors.push(error.message);
		});
		await page.setViewportSize(viewport);
		await gotoLibrary(page);
		const expectFits = async (state: string) => {
			const overflow = await page.evaluate(
				() =>
					globalThis.document.documentElement.scrollWidth -
					globalThis.innerWidth,
			);
			expect(overflow, 'Horizontal overflow').toBeLessThanOrEqual(0);
			if (browserName === 'chromium') {
				await page.screenshot({
					path: `.proof/format-${state}-${viewport.width}x${viewport.height}.png`,
					animations: 'disabled',
				});
			}
		};

		await dropImages(page, REFUSED);
		await expect(
			page.getByText(heicRefusal('phone.heic'), {exact: true}),
		).toBeVisible();
		await assertNoA11yViolations(page);
		await expectFits('refused');
		await page.getByRole('button', {name: 'Dismiss'}).click();
		await expect(page.getByRole('alertdialog')).toHaveCount(0);

		await dropImages(page, [
			fixture('loop.gif', 'image/gif', gifBytes([RED, BLUE])),
		]);
		const toast = page.getByText(notice('loop.gif'), {exact: true});
		await expect(toast).toBeVisible();
		// Let the toast finish sliding in before it is measured and captured.
		await expect
			.poll(async () => {
				const box = await toast.boundingBox();
				return box ? box.y + box.height : Infinity;
			})
			.toBeLessThanOrEqual(viewport.height);
		await page.waitForTimeout(500);
		await assertNoA11yViolations(page);
		await expectFits('notice');
		expect(errors, 'Console errors').toEqual([]);
	});
}
