import {Buffer} from 'node:buffer';
import {readFile} from 'node:fs/promises';
import {expect, test, type Download, type Page} from '@playwright/test';
import {decode as decodePng} from 'fast-png';
import type {AppRuntime} from '../../src/state/index.ts';
import {assertNoA11yViolations} from './axe.ts';
import {PROOF_VIEWPORTS, type ProofViewport} from './viewports.ts';

type RuntimeGlobal = {
	__psgRuntime?: AppRuntime;
};

const THEMES = [
	{name: 'light', media: 'light', stored: 'light'},
	{name: 'dark', media: 'dark', stored: 'dark'},
] as const;

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

async function seedProject(
	page: Page,
	options: {
		name?: string;
		width?: number;
		height?: number;
		effects?: readonly string[];
		withExifJpeg?: boolean;
	} = {},
): Promise<string> {
	await page.goto('/');
	return page.evaluate(async (opts) => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		if (!runtime) {
			throw new Error('App runtime not attached');
		}

		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			throw new Error(`Expected ready boot, got ${booted.status}`);
		}

		const width = opts.width ?? 320;
		const height = opts.height ?? 240;
		const canvas = globalThis.document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d');
		if (!context) {
			throw new Error('2D context unavailable');
		}

		const gradient = context.createLinearGradient(0, 0, width, height);
		gradient.addColorStop(0, '#0b1f3a');
		gradient.addColorStop(0.5, '#d08040');
		gradient.addColorStop(1, '#f4f4f5');
		context.fillStyle = gradient;
		context.fillRect(0, 0, width, height);
		context.fillStyle = '#18181b';
		context.fillRect(
			Math.floor(width * 0.2),
			Math.floor(height * 0.2),
			Math.floor(width * 0.35),
			Math.floor(height * 0.35),
		);

		let blob = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(result) => {
					if (result) {
						resolve(result);
					} else {
						reject(new Error('Failed to encode synthetic image'));
					}
				},
				opts.withExifJpeg ? 'image/jpeg' : 'image/png',
				opts.withExifJpeg ? 0.9 : undefined,
			);
		});

		if (opts.withExifJpeg) {
			const original = new Uint8Array(await blob.arrayBuffer());
			// Minimal APP1 Exif segment inserted right after JPEG SOI (FF D8).
			const exifPayload = new Uint8Array([
				0xff, 0xe1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d,
				0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
			]);
			const patched = new Uint8Array(original.length + exifPayload.length);
			patched.set(original.subarray(0, 2), 0);
			patched.set(exifPayload, 2);
			patched.set(original.subarray(2), 2 + exifPayload.length);
			blob = new Blob([patched], {type: 'image/jpeg'});
		}

		const {store} = booted.bundle;
		const created = await store.getState().importImage({
			name: opts.name ?? 'Export proof',
			blob,
			width,
			height,
		});
		for (const type of opts.effects ?? []) {
			await store.getState().addEffect(type);
		}

		return created.project.id;
	}, options);
}

async function readDownloadBytes(download: Download): Promise<Uint8Array> {
	const filePath = await download.path();
	if (!filePath) {
		throw new Error('Download path unavailable');
	}

	const buffer = await readFile(filePath);
	return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function pngChunkTypes(bytes: Uint8Array): string[] {
	const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	for (const [index, byte] of sig.entries()) {
		if (bytes[index] !== byte) {
			throw new Error('Not a PNG file');
		}
	}

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const types: string[] = [];
	let offset = 8;
	while (offset + 12 <= bytes.length) {
		const length = view.getUint32(offset, false);
		const type = String.fromCodePoint(
			bytes[offset + 4],
			bytes[offset + 5],
			bytes[offset + 6],
			bytes[offset + 7],
		);
		types.push(type);
		offset += 12 + length;
	}

	return types;
}

function assertJpegHasNoExif(bytes: Uint8Array): void {
	expect(bytes[0]).toBe(0xff);
	expect(bytes[1]).toBe(0xd8);
	let offset = 2;
	while (offset + 4 <= bytes.length) {
		if (bytes[offset] !== 0xff) {
			break;
		}

		const marker = bytes[offset + 1];
		if (marker === 0xda || marker === 0xd9) {
			break;
		}

		const length = bytes[offset + 2] * 256 + bytes[offset + 3];
		if (marker === 0xe1) {
			const header = String.fromCodePoint(
				...bytes.subarray(offset + 4, offset + 10),
			);
			expect(header).not.toBe('Exif\0\0');
		}

		offset += 2 + length;
	}
}

function webpChunkTypes(bytes: Uint8Array): string[] {
	const riff = String.fromCodePoint(...bytes.subarray(0, 4));
	const webp = String.fromCodePoint(...bytes.subarray(8, 12));
	expect(riff).toBe('RIFF');
	expect(webp).toBe('WEBP');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const chunks: string[] = [];
	let offset = 12;
	while (offset + 8 <= bytes.length) {
		const id = String.fromCodePoint(...bytes.subarray(offset, offset + 4));
		const size = view.getUint32(offset + 4, true);
		chunks.push(id);
		offset += 8 + size + (size % 2);
	}

	return chunks;
}

async function decodeImageInPage(
	page: Page,
	bytes: Uint8Array,
	mime: string,
): Promise<{width: number; height: number}> {
	return page.evaluate(
		async ({data, type}) => {
			const blob = new Blob([new Uint8Array(data)], {type});
			const bitmap = await globalThis.createImageBitmap(blob);
			const result = {width: bitmap.width, height: bitmap.height};
			bitmap.close();
			return result;
		},
		{data: [...bytes], type: mime},
	);
}

test('AC-F12.1 & timing: exports a 12 MP project as PNG and JPEG at Full size', async ({
	page,
}, testInfo) => {
	const consoleErrors = collectConsoleErrors(page);
	await seedProject(page, {
		name: 'TwelveMP',
		width: 4000,
		height: 3000,
		effects: ['pixelSort'],
	});

	await page.getByRole('button', {name: 'Export'}).click();
	const dialog = page.getByRole('dialog', {name: 'Export'});
	await expect(dialog).toBeVisible();
	await expect(dialog.locator('[data-slot="export-dimensions"]')).toHaveText(
		'4000 × 3000 px',
	);

	const pngStart = performance.now();
	const [pngDownload] = await Promise.all([
		page.waitForEvent('download'),
		dialog.getByRole('button', {name: 'Download'}).click(),
	]);
	const pngBytes = await readDownloadBytes(pngDownload);
	const pngMs = performance.now() - pngStart;

	expect(pngDownload.suggestedFilename()).toMatch(
		/^TwelveMP-\d{8}-\d{6}\.png$/,
	);
	const pngDecoded = decodePng(pngBytes);
	expect(pngDecoded.width).toBe(4000);
	expect(pngDecoded.height).toBe(3000);
	expect(pngChunkTypes(pngBytes)).not.toContain('eXIf');
	expect(pngMs).toBeLessThan(5000);

	await dialog.getByRole('radio', {name: 'JPEG'}).click();
	await expect(dialog.getByRole('spinbutton', {name: 'Quality'})).toHaveValue(
		'92',
	);

	const jpegStart = performance.now();
	const [jpegDownload] = await Promise.all([
		page.waitForEvent('download'),
		dialog.getByRole('button', {name: 'Download'}).click(),
	]);
	const jpegBytes = await readDownloadBytes(jpegDownload);
	const jpegMs = performance.now() - jpegStart;

	expect(jpegDownload.suggestedFilename()).toMatch(
		/^TwelveMP-\d{8}-\d{6}\.jpg$/,
	);
	assertJpegHasNoExif(jpegBytes);
	const jpegDims = await decodeImageInPage(page, jpegBytes, 'image/jpeg');
	expect(jpegDims).toEqual({width: 4000, height: 3000});

	console.log(
		`[export-timing] ${testInfo.project.name} 12MP PNG=${Math.round(pngMs)}ms JPEG=${Math.round(jpegMs)}ms`,
	);
	expect(consoleErrors).toEqual([]);
});

test('AC-F12.2: WebP appears when supported and is omitted when convertToBlob probe fails', async ({
	page,
}, testInfo) => {
	// Playwright's headless Firefox stalls on `<a download="*.webp">` blob clicks
	// (never emitting a `download` event), so in Firefox we observe the real
	// encoded Blob and download filename right as `anchor.click()` runs.
	if (testInfo.project.name === 'firefox') {
		await page.addInitScript(() => {
			const blobs = new Map<string, Blob>();
			const captured: Array<{
				bytes: number[];
				type: string;
				filename: string;
			}> = [];
			Object.defineProperty(globalThis, '__capturedWebpExports', {
				configurable: true,
				value: captured,
			});
			const origCreate = URL.createObjectURL.bind(URL);
			URL.createObjectURL = (object: Blob | MediaSource) => {
				const url = origCreate(object);
				if (object instanceof Blob) {
					blobs.set(url, object);
				}

				return url;
			};

			const origClick = HTMLAnchorElement.prototype.click;
			HTMLAnchorElement.prototype.click = function () {
				if (this.download.endsWith('.webp')) {
					const blob = blobs.get(this.href);
					const filename = this.download;
					if (blob) {
						void blob.arrayBuffer().then((buffer) => {
							captured.push({
								bytes: [...new Uint8Array(buffer)],
								type: blob.type,
								filename,
							});
						});
					}

					return;
				}

				origClick.call(this);
			};
		});
	}

	await seedProject(page, {name: 'WebPCheck', width: 200, height: 150});
	await page.getByRole('button', {name: 'Export'}).click();
	const dialog = page.getByRole('dialog', {name: 'Export'});

	await expect(dialog.getByRole('radio', {name: 'WebP'})).toBeVisible();
	await dialog.getByRole('radio', {name: 'WebP'}).click();

	let webpBytes: Uint8Array;
	if (testInfo.project.name === 'firefox') {
		await dialog.getByRole('button', {name: 'Download'}).click();
		await expect(
			page.getByRole('status', {name: 'Status messages'}),
		).toHaveText(/^Export finished: WebPCheck-\d{8}-\d{6}\.webp$/);
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(
							globalThis as unknown as {
								__capturedWebpExports?: Array<{
									bytes: number[];
									type: string;
									filename: string;
								}>;
							}
						).__capturedWebpExports?.length ?? 0,
				),
			)
			.toBe(1);
		const captured = await page.evaluate(
			() =>
				(
					globalThis as unknown as {
						__capturedWebpExports?: Array<{
							bytes: number[];
							type: string;
							filename: string;
						}>;
					}
				).__capturedWebpExports![0],
		);
		expect(captured.type).toBe('image/webp');
		expect(captured.filename).toMatch(/^WebPCheck-\d{8}-\d{6}\.webp$/);
		webpBytes = new Uint8Array(captured.bytes);
	} else {
		const [webpDownload] = await Promise.all([
			page.waitForEvent('download'),
			dialog.getByRole('button', {name: 'Download'}).click(),
		]);
		webpBytes = await readDownloadBytes(webpDownload);
		expect(webpDownload.suggestedFilename()).toMatch(
			/^WebPCheck-\d{8}-\d{6}\.webp$/,
		);
	}

	expect(webpChunkTypes(webpBytes)).not.toContain('EXIF');
	expect(await decodeImageInPage(page, webpBytes, 'image/webp')).toEqual({
		width: 200,
		height: 150,
	});

	await page.addInitScript(() => {
		const original = OffscreenCanvas.prototype.convertToBlob;
		OffscreenCanvas.prototype.convertToBlob = async function (options) {
			return options?.type === 'image/webp'
				? original.call(this, {type: 'image/png'})
				: original.call(this, options);
		};
	});
	await page.reload();
	await page.getByRole('button', {name: 'Export'}).click();
	const fallbackDialog = page.getByRole('dialog', {name: 'Export'});
	await expect(fallbackDialog.getByRole('radio', {name: 'PNG'})).toBeVisible();
	await expect(fallbackDialog.getByRole('radio', {name: 'WebP'})).toHaveCount(
		0,
	);
});

test('AC-F12.3: 4001 × 3001 at 1/2 size exports exact 2000 × 1500 PNG', async ({
	page,
}) => {
	await seedProject(page, {
		name: 'OddSize',
		width: 4001,
		height: 3001,
		effects: ['channelShift'],
	});
	await page.getByRole('button', {name: 'Export'}).click();
	const dialog = page.getByRole('dialog', {name: 'Export'});

	await expect(dialog.locator('[data-slot="export-dimensions"]')).toHaveText(
		'4001 × 3001 px',
	);
	await dialog.getByRole('radio', {name: '1/2'}).click();
	await expect(dialog.locator('[data-slot="export-dimensions"]')).toHaveText(
		'2000 × 1500 px',
	);

	const [download] = await Promise.all([
		page.waitForEvent('download'),
		dialog.getByRole('button', {name: 'Download'}).click(),
	]);
	const bytes = await readDownloadBytes(download);
	const decoded = decodePng(bytes);
	expect(decoded.width).toBe(2000);
	expect(decoded.height).toBe(1500);
});

test('AC-F12.4: Cancel stops the export within 1 s and writes no file', async ({
	page,
}) => {
	await seedProject(page, {
		name: 'CancelTest',
		width: 4000,
		height: 3000,
		effects: ['pixelSort', 'pixelSort'],
	});
	await page.getByRole('button', {name: 'Export'}).click();
	const dialog = page.getByRole('dialog', {name: 'Export'});

	// Make the export stay in flight long enough to cancel reliably.
	await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime!.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		const original = booted.bundle.coordinator.exportImage;
		const cancelState = {cancelled: false};
		Object.defineProperty(globalThis, '__exportCancelState', {
			configurable: true,
			value: cancelState,
		});
		booted.bundle.coordinator.exportImage = (options) => {
			const real = original(options);
			let cancelled = false;
			const {promise: result, resolve} =
				Promise.withResolvers<Awaited<typeof real.result>>();
			options.onProgress?.('render', 0.25);
			return {
				result,
				cancel() {
					if (cancelled) {
						return;
					}

					cancelled = true;
					cancelState.cancelled = true;
					real.cancel();
					resolve({status: 'cancelled'});
				},
			};
		};
	});

	let downloaded = false;
	page.on('download', () => {
		downloaded = true;
	});

	await dialog.getByRole('button', {name: 'Download'}).click();
	const cancelButton = dialog.getByRole('button', {name: 'Cancel'});
	await expect(cancelButton).toBeVisible();

	const cancelStart = performance.now();
	await cancelButton.click();
	await expect(dialog.getByRole('button', {name: 'Download'})).toBeVisible();
	expect(performance.now() - cancelStart).toBeLessThan(1000);
	expect(
		await page.evaluate(
			() =>
				(
					globalThis as unknown as {
						__exportCancelState?: {cancelled: boolean};
					}
				).__exportCancelState?.cancelled,
		),
	).toBe(true);
	expect(downloaded).toBe(false);
});

test('AC-F12.6 & AC-F6.5: strips EXIF metadata and two PNG exports are deterministic', async ({
	page,
}) => {
	await seedProject(page, {
		name: 'ExifPhoto',
		width: 320,
		height: 240,
		effects: ['pixelSort'],
		withExifJpeg: true,
	});
	await page.getByRole('button', {name: 'Export'}).click();
	const dialog = page.getByRole('dialog', {name: 'Export'});

	const [firstPng] = await Promise.all([
		page.waitForEvent('download'),
		dialog.getByRole('button', {name: 'Download'}).click(),
	]);
	const firstBytes = await readDownloadBytes(firstPng);

	const [secondPng] = await Promise.all([
		page.waitForEvent('download'),
		dialog.getByRole('button', {name: 'Download'}).click(),
	]);
	const secondBytes = await readDownloadBytes(secondPng);

	expect(pngChunkTypes(firstBytes)).not.toContain('eXIf');
	expect(pngChunkTypes(firstBytes)).not.toContain('iCCP');

	const decodedA = decodePng(firstBytes);
	const decodedB = decodePng(secondBytes);
	expect(decodedA.width).toBe(320);
	expect(decodedA.height).toBe(240);
	const pixelsA = new Uint8Array(
		decodedA.data.buffer,
		decodedA.data.byteOffset,
		decodedA.data.byteLength,
	);
	const pixelsB = new Uint8Array(
		decodedB.data.buffer,
		decodedB.data.byteOffset,
		decodedB.data.byteLength,
	);
	expect(Buffer.compare(pixelsA, pixelsB)).toBe(0);
	expect(Buffer.compare(firstBytes, secondBytes)).toBe(0);

	// AC-F6.6: Show selection debug view must not appear in exports.
	await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime!.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		const {store} = booted.bundle;
		const instanceId = store.getState().activeProject?.stack.instances[0]?.id;
		if (!instanceId) {
			throw new Error('Missing pixelSort instance');
		}

		store.getState().setDebugView({instanceId, view: 'selection'});
	});

	const [debugExport] = await Promise.all([
		page.waitForEvent('download'),
		dialog.getByRole('button', {name: 'Download'}).click(),
	]);
	const debugBytes = await readDownloadBytes(debugExport);
	const decodedDebug = decodePng(debugBytes);
	const pixelsDebug = new Uint8Array(
		decodedDebug.data.buffer,
		decodedDebug.data.byteOffset,
		decodedDebug.data.byteLength,
	);
	expect(Buffer.compare(pixelsA, pixelsDebug)).toBe(0);

	await dialog.getByRole('radio', {name: 'JPEG'}).click();
	const [jpegDownload] = await Promise.all([
		page.waitForEvent('download'),
		dialog.getByRole('button', {name: 'Download'}).click(),
	]);
	assertJpegHasNoExif(await readDownloadBytes(jpegDownload));
});

test('AC-F12.7: export settings are remembered per project across reloads', async ({
	page,
}) => {
	await seedProject(page, {name: 'RememberMe', width: 800, height: 600});
	await page.getByRole('button', {name: 'Export'}).click();
	const dialog = page.getByRole('dialog', {name: 'Export'});

	await dialog.getByRole('radio', {name: 'JPEG'}).click();
	const qualityInput = dialog.getByRole('spinbutton', {name: 'Quality'});
	await qualityInput.fill('78');
	await qualityInput.press('Enter');
	await dialog.getByRole('radio', {name: '1/2'}).click();
	await expect(dialog.locator('[data-slot="export-dimensions"]')).toHaveText(
		'400 × 300 px',
	);

	await page.keyboard.press('Escape');
	await page.reload();

	await page.getByRole('button', {name: 'Export'}).click();
	const reopened = page.getByRole('dialog', {name: 'Export'});
	await expect(reopened.getByRole('radio', {name: 'JPEG'})).toHaveAttribute(
		'data-state',
		'on',
	);
	await expect(reopened.getByRole('spinbutton', {name: 'Quality'})).toHaveValue(
		'78',
	);
	await expect(reopened.getByRole('radio', {name: '1/2'})).toHaveAttribute(
		'data-state',
		'on',
	);
	await expect(reopened.locator('[data-slot="export-dimensions"]')).toHaveText(
		'400 × 300 px',
	);
});

test('Share button appears when navigator.canShare supports files and OOM error offers smaller sizes', async ({
	page,
}) => {
	await page.addInitScript(() => {
		const shared: Array<{name: string; type: string}> = [];
		Object.defineProperty(globalThis, '__sharedFiles', {
			configurable: true,
			value: shared,
		});
		Object.defineProperties(globalThis.navigator, {
			canShare: {
				configurable: true,
				value: (data?: ShareData) =>
					Array.isArray(data?.files) && data.files.length > 0,
			},
			share: {
				configurable: true,
				async value(data?: ShareData) {
					for (const file of data?.files ?? []) {
						shared.push({name: file.name, type: file.type});
					}
				},
			},
		});
	});

	await seedProject(page, {name: 'ShareTest', width: 200, height: 150});
	await page.getByRole('button', {name: 'Export'}).click();
	const dialog = page.getByRole('dialog', {name: 'Export'});

	const shareButton = dialog.getByRole('button', {name: 'Share'});
	await expect(shareButton).toBeVisible();
	await shareButton.click();

	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(
						globalThis as unknown as {
							__sharedFiles?: Array<{name: string; type: string}>;
						}
					).__sharedFiles ?? [],
			),
		)
		.toHaveLength(1);

	await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime!.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		booted.bundle.coordinator.exportImage = () => ({
			result: Promise.resolve({
				status: 'error',
				error: {code: 'out-of-memory', message: 'RangeError'},
			}),
			cancel() {},
		});
	});

	await dialog.getByRole('button', {name: 'Download'}).click();
	const alert = dialog.getByRole('alert');
	await expect(alert).toContainText(
		'Not enough memory to export at this size. Try 1/2 or 1/4 size.',
	);
	await alert.getByRole('button', {name: 'Use 1/2 size'}).click();
	await expect(dialog.getByRole('alert')).toHaveCount(0);
	await expect(dialog.getByRole('radio', {name: '1/2'})).toHaveAttribute(
		'data-state',
		'on',
	);
});

async function openExportInTheme(
	page: Page,
	theme: (typeof THEMES)[number],
	viewport: ProofViewport,
): Promise<void> {
	await page.emulateMedia({colorScheme: theme.media});
	await page.addInitScript((stored) => {
		globalThis.localStorage.setItem('psg:theme', stored);
	}, theme.stored);
	await page.setViewportSize({width: viewport.width, height: viewport.height});
	await seedProject(page, {
		name: 'Layout proof',
		width: 4001,
		height: 3001,
		effects: ['pixelSort'],
	});
}

async function waitForTransitions(page: Page): Promise<void> {
	await page.evaluate(async () => {
		const animations = globalThis.document.getAnimations();
		await Promise.allSettled(animations.map((animation) => animation.finished));
	});
}

for (const theme of THEMES) {
	for (const viewport of PROOF_VIEWPORTS) {
		test(`export dialog lays out cleanly with no a11y violations in ${theme.name} at ${viewport.name} @a11y`, async ({
			page,
		}) => {
			const consoleErrors = collectConsoleErrors(page);
			await openExportInTheme(page, theme, viewport);

			await page.getByRole('button', {name: 'Export'}).click();
			const surface = page.locator(
				viewport.name === 'phone'
					? '[data-slot="sheet-content"]'
					: '[data-slot="dialog-content"]',
			);
			await expect(surface).toBeVisible();
			await waitForTransitions(page);
			await assertNoA11yViolations(page);

			await surface.getByRole('radio', {name: 'JPEG'}).click();
			await surface.getByRole('radio', {name: 'Custom'}).click();
			await expect(
				surface.getByRole('spinbutton', {name: 'Quality'}),
			).toBeVisible();
			await expect(
				surface.getByRole('slider', {name: 'Quality'}),
			).toBeVisible();
			await expect(surface.getByLabel('Longest side (px)')).toBeVisible();
			await waitForTransitions(page);
			await assertNoA11yViolations(page);

			const metrics = await page.evaluate(() => ({
				scrollWidth: globalThis.document.documentElement.scrollWidth,
				innerWidth: globalThis.innerWidth,
			}));
			expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
			expect(consoleErrors).toEqual([]);
		});
	}
}
