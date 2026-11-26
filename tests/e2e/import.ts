import {Buffer} from 'node:buffer';
import type {Page} from '@playwright/test';
import type {AppRuntime} from '../../src/state/index.ts';

type RuntimeGlobal = {
	__psgRuntime?: AppRuntime;
};

export type ImageFixture = {
	readonly name: string;
	readonly mimeType: string;
	readonly buffer: Buffer;
};

export type ChosenFixture = Pick<ImageFixture, 'name' | 'mimeType' | 'buffer'>;

export type StoredProject = {
	readonly id: string;
	readonly name: string;
	readonly sourceHash: string;
	readonly sourceWidth: number;
	readonly sourceHeight: number;
};

export type ImportSnapshot = {
	readonly projects: readonly StoredProject[];
	readonly activeProjectId: string | null;
	readonly activeProjectName: string | null;
	readonly screen: string;
	readonly quotaFull: boolean;
	readonly sourceCount: number;
};

type ImageOptions = {
	readonly name: string;
	readonly width: number;
	readonly height: number;
	readonly type?: 'image/png' | 'image/jpeg';
	readonly quality?: number;
};

/**
 Draws a deterministic gradient with a lit corner in the page and encodes it
 with the browser's own encoder, so no photograph is committed and the fixture
 holds real image bytes the browser can decode.
 */
export async function makeImage(
	page: Page,
	options: ImageOptions,
): Promise<ImageFixture> {
	const mimeType = options.type ?? 'image/png';
	const base64 = await page.evaluate(
		async ({width, height, fixtureType, quality}) => {
			const canvas = globalThis.document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const context = canvas.getContext('2d');
			if (!context) {
				throw new Error('2D context unavailable');
			}

			const gradient = context.createLinearGradient(0, 0, width, height);
			gradient.addColorStop(0, '#0b1f3a');
			gradient.addColorStop(0.45, '#d08040');
			gradient.addColorStop(1, '#f4f4f5');
			context.fillStyle = gradient;
			context.fillRect(0, 0, width, height);
			context.fillStyle = '#102040';
			context.fillRect(
				0,
				Math.floor(height * 0.6),
				Math.max(1, Math.floor(width * 0.18)),
				Math.max(1, Math.floor(height * 0.3)),
			);

			const blob = await new Promise<Blob>((resolve, reject) => {
				canvas.toBlob(
					(result) => {
						if (result) {
							resolve(result);
						} else {
							reject(new Error('Failed to encode the fixture image'));
						}
					},
					fixtureType,
					quality,
				);
			});

			const dataUrl = await new Promise<string>((resolve, reject) => {
				const reader = new globalThis.FileReader();
				reader.addEventListener('error', () => {
					reject(reader.error ?? new Error('Failed to read the fixture image'));
				});
				reader.addEventListener('load', () => {
					resolve(String(reader.result));
				});
				reader.readAsDataURL(blob);
			});

			return dataUrl.slice(dataUrl.indexOf(',') + 1);
		},
		{
			width: options.width,
			height: options.height,
			fixtureType: mimeType,
			quality: options.quality ?? 0.85,
		},
	);

	return {
		name: options.name,
		mimeType,
		buffer: Buffer.from(base64, 'base64'),
	};
}

/**
 Inserts an EXIF APP1 segment holding the given orientation right after the
 JPEG start-of-image marker, as a camera writes it.
 */
export function withExifOrientation(jpeg: Buffer, orientation: number): Buffer {
	if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
		throw new Error('Fixture is not a JPEG');
	}

	const tiff = Buffer.alloc(26);
	tiff.write('II', 0, 'ascii');
	tiff.writeUInt16LE(0x2a, 2);
	tiff.writeUInt32LE(8, 4);
	tiff.writeUInt16LE(1, 8);
	tiff.writeUInt16LE(0x01_12, 10);
	tiff.writeUInt16LE(3, 12);
	tiff.writeUInt32LE(1, 14);
	tiff.writeUInt16LE(orientation, 18);
	tiff.writeUInt32LE(0, 22);

	const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
	const length = Buffer.alloc(2);
	length.writeUInt16BE(payload.length + 2, 0);

	return Buffer.concat([
		jpeg.subarray(0, 2),
		Buffer.from([0xff, 0xe1]),
		length,
		payload,
		jpeg.subarray(2),
	]);
}

function chooserButton(page: Page) {
	return page.getByRole('banner').getByRole('button', {name: 'Import images'});
}

export async function chooseImages(
	page: Page,
	fixtures: readonly ChosenFixture[],
): Promise<void> {
	const chooserPromise = page.waitForEvent('filechooser');
	await chooserButton(page).click();
	const chooser = await chooserPromise;
	await chooser.setFiles(
		fixtures.map((fixture) => ({
			name: fixture.name,
			mimeType: fixture.mimeType,
			buffer: fixture.buffer,
		})),
	);
}

async function dispatchDrag(page: Page, type: string): Promise<void> {
	await page.evaluate((eventType) => {
		const dataTransfer = new globalThis.DataTransfer();
		dataTransfer.items.add(
			new globalThis.File([new Uint8Array([0])], 'dragged.png', {
				type: 'image/png',
			}),
		);
		globalThis.dispatchEvent(
			Object.assign(
				new globalThis.Event(eventType, {bubbles: true, cancelable: true}),
				{dataTransfer},
			),
		);
	}, type);
}

export async function dragOverWindow(page: Page): Promise<void> {
	await dispatchDrag(page, 'dragenter');
}

export async function dragAwayFromWindow(page: Page): Promise<void> {
	await dispatchDrag(page, 'dragleave');
}

export async function dropImages(
	page: Page,
	fixtures: readonly ChosenFixture[],
): Promise<void> {
	await page.evaluate(
		(items) => {
			const dataTransfer = new globalThis.DataTransfer();
			for (const item of items) {
				dataTransfer.items.add(
					new globalThis.File([item.bytes], item.name, {type: item.mimeType}),
				);
			}

			for (const type of ['dragenter', 'dragover', 'drop']) {
				globalThis.dispatchEvent(
					Object.assign(
						new globalThis.Event(type, {bubbles: true, cancelable: true}),
						{dataTransfer},
					),
				);
			}
		},
		fixtures.map((fixture) => ({
			name: fixture.name,
			mimeType: fixture.mimeType,
			bytes: new Uint8Array(fixture.buffer),
		})),
	);
}

export async function readImportState(page: Page): Promise<ImportSnapshot> {
	return page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		if (!runtime) {
			throw new Error('App runtime not attached');
		}

		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			throw new Error(`Expected ready boot, got ${booted.status}`);
		}

		const state = booted.bundle.store.getState();
		const sourceCount = await new Promise<number>((resolve, reject) => {
			const request = globalThis.indexedDB.open('drift');
			request.addEventListener('error', () => {
				reject(request.error ?? new Error('IndexedDB open failed'));
			});
			request.addEventListener('success', () => {
				try {
					const transaction = request.result.transaction('sources', 'readonly');
					const count = transaction.objectStore('sources').count();
					count.addEventListener('error', () => {
						reject(count.error ?? new Error('Source count failed'));
					});
					count.addEventListener('success', () => {
						resolve(count.result);
					});
				} catch (error) {
					reject(error instanceof Error ? error : new Error(String(error)));
				}
			});
		});

		return {
			projects: state.projects.map((project) => ({
				id: project.id,
				name: project.name,
				sourceHash: project.sourceHash,
				sourceWidth: project.sourceWidth,
				sourceHeight: project.sourceHeight,
			})),
			activeProjectId: state.activeProjectId,
			activeProjectName: state.activeProject?.name ?? null,
			screen: state.route.screen,
			quotaFull: state.storage.quotaFull,
			sourceCount,
		};
	});
}

export async function decodedSourceSize(
	page: Page,
): Promise<{width: number; height: number}> {
	return page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		if (!runtime) {
			throw new Error('App runtime not attached');
		}

		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			throw new Error(`Expected ready boot, got ${booted.status}`);
		}

		const source = booted.bundle.store.getState().activeSource;
		if (!source) {
			throw new Error('No active source');
		}

		const bitmap = await globalThis.createImageBitmap(source.blob, {
			imageOrientation: 'from-image',
		});
		const size = {width: bitmap.width, height: bitmap.height};
		bitmap.close();
		return size;
	});
}

export async function readStorageUsage(page: Page): Promise<number | null> {
	return page.evaluate(async () => {
		const estimate = await globalThis.navigator.storage.estimate();
		return typeof estimate.usage === 'number' ? estimate.usage : null;
	});
}

export type StallSample = {
	readonly maxGapMs: number;
	readonly frameCount: number;
};

/**
 Starts a rAF loop that records the longest gap between frames: the longest
 stretch in which the main thread was unavailable to paint.
 */
export async function startStallSampler(page: Page): Promise<void> {
	await page.evaluate(() => {
		const sampler = {maxGapMs: 0, frameCount: 0, running: true, last: 0};
		Object.defineProperty(globalThis, '__importStall', {
			value: sampler,
			configurable: true,
			writable: true,
		});
		sampler.last = globalThis.performance.now();
		const tick = (time: number) => {
			const gap = time - sampler.last;
			sampler.last = time;
			sampler.frameCount++;
			if (gap > sampler.maxGapMs) {
				sampler.maxGapMs = gap;
			}

			if (sampler.running) {
				globalThis.requestAnimationFrame(tick);
			}
		};

		globalThis.requestAnimationFrame(tick);
	});
}

export async function stopStallSampler(page: Page): Promise<StallSample> {
	return page.evaluate(() => {
		const sampler = (
			globalThis as unknown as {
				__importStall?: {
					maxGapMs: number;
					frameCount: number;
					running: boolean;
				};
			}
		).__importStall;
		if (!sampler) {
			throw new Error('No stall sampler running');
		}

		sampler.running = false;
		return {maxGapMs: sampler.maxGapMs, frameCount: sampler.frameCount};
	});
}

export async function blockFullStorage(page: Page): Promise<void> {
	await page.addInitScript(() => {
		Object.defineProperty(globalThis.navigator.storage, 'estimate', {
			configurable: true,
			value: async () => ({usage: 1000, quota: 1100}),
		});
	});
}
