import {afterEach, describe, expect, it} from 'vite-plus/test';
import type {Frame} from '../../src/render/coordinator.ts';
import {
	computeThumbnailDimensions,
	createCanvasThumbnailGenerator,
	MAX_THUMBNAIL_SIDE,
	THUMBNAIL_QUALITY,
} from '../../src/state/thumbnail.ts';

function makeFrame(
	width: number,
	height: number,
	bitmap: ImageBitmap = {close() {}} as unknown as ImageBitmap,
): Frame {
	return {
		generation: 1,
		level: 'settle',
		bitmap,
		width,
		height,
		totalMs: 10,
		perInstanceMs: [10],
		warnings: [],
	};
}

describe('computeThumbnailDimensions', () => {
	it('scales landscape images so width equals maxSide and preserves aspect ratio', () => {
		expect(computeThumbnailDimensions(1024, 512)).toEqual({
			width: 512,
			height: 256,
		});
		expect(computeThumbnailDimensions(2000, 1000)).toEqual({
			width: MAX_THUMBNAIL_SIDE,
			height: 256,
		});
	});

	it('scales portrait images so height equals maxSide and preserves aspect ratio', () => {
		expect(computeThumbnailDimensions(600, 1200)).toEqual({
			width: 256,
			height: MAX_THUMBNAIL_SIDE,
		});
	});

	it('does not upscale images whose longest side is at or below maxSide', () => {
		expect(computeThumbnailDimensions(512, 300)).toEqual({
			width: 512,
			height: 300,
		});
		expect(computeThumbnailDimensions(120, 80)).toEqual({
			width: 120,
			height: 80,
		});
	});

	it('returns 1x1 for non-positive dimensions and clamps extreme aspect ratios to at least 1px', () => {
		expect(computeThumbnailDimensions(0, 500)).toEqual({width: 1, height: 1});
		expect(computeThumbnailDimensions(500, -10)).toEqual({width: 1, height: 1});
		expect(computeThumbnailDimensions(10_000, 1)).toEqual({
			width: 512,
			height: 1,
		});
	});

	it('respects a custom maxSide argument', () => {
		expect(computeThumbnailDimensions(400, 200, 100)).toEqual({
			width: 100,
			height: 50,
		});
	});
});

describe('createCanvasThumbnailGenerator', () => {
	const originalOffscreenCanvas = Object.getOwnPropertyDescriptor(
		globalThis,
		'OffscreenCanvas',
	);

	afterEach(() => {
		if (originalOffscreenCanvas) {
			Object.defineProperty(
				globalThis,
				'OffscreenCanvas',
				originalOffscreenCanvas,
			);
		} else {
			Reflect.deleteProperty(globalThis, 'OffscreenCanvas');
		}
	});

	it('returns null when OffscreenCanvas is unavailable', async () => {
		Reflect.deleteProperty(globalThis, 'OffscreenCanvas');
		const generator = createCanvasThumbnailGenerator();
		expect(await generator(makeFrame(800, 600))).toBeNull();
	});

	it('draws frame.bitmap synchronously before awaiting encode, encodes webp at quality 0.8, and returns scaled dimensions', async () => {
		const events: string[] = [];
		const convertCalls: Array<{type?: string; quality?: number}> = [];
		const drawCalls: Array<{
			bitmap: unknown;
			width: number;
			height: number;
		}> = [];

		class FakeOffscreenCanvas {
			width: number;
			height: number;

			constructor(width: number, height: number) {
				this.width = width;
				this.height = height;
			}

			getContext(type: string) {
				if (type !== '2d') {
					return null;
				}

				return {
					drawImage(
						bitmap: unknown,
						_dx: number,
						_dy: number,
						width: number,
						height: number,
					) {
						events.push('drawImage');
						drawCalls.push({bitmap, width, height});
					},
				};
			}

			async convertToBlob(options?: {type?: string; quality?: number}) {
				events.push(`convert:${options?.type}`);
				convertCalls.push(options ?? {});
				return new Blob([new Uint8Array([1, 2, 3])], {type: 'image/webp'});
			}
		}

		Object.defineProperty(globalThis, 'OffscreenCanvas', {
			configurable: true,
			value: FakeOffscreenCanvas,
		});

		const bitmap = {close() {}} as unknown as ImageBitmap;
		const generator = createCanvasThumbnailGenerator();
		const promise = generator(makeFrame(1024, 512, bitmap));

		// Draw must happen synchronously before any await
		expect(events).toEqual(['drawImage', 'convert:image/webp']);
		expect(drawCalls).toEqual([{bitmap, width: 512, height: 256}]);

		const result = await promise;
		expect(result).not.toBeNull();
		expect(result?.width).toBe(512);
		expect(result?.height).toBe(256);
		expect(result?.blob.type).toBe('image/webp');
		expect(convertCalls).toEqual([
			{type: 'image/webp', quality: THUMBNAIL_QUALITY},
		]);
	});

	it('falls back to image/jpeg when webp encoding is unsupported or throws, and shrinks canvas in finally', async () => {
		const convertCalls: Array<{type?: string; quality?: number}> = [];
		const finalSize = {width: 0, height: 0};

		class FallbackOffscreenCanvas {
			#width: number;
			#height: number;

			constructor(width: number, height: number) {
				this.#width = width;
				this.#height = height;
				finalSize.width = width;
				finalSize.height = height;
			}

			get width() {
				return this.#width;
			}

			set width(next: number) {
				this.#width = next;
				finalSize.width = next;
			}

			get height() {
				return this.#height;
			}

			set height(next: number) {
				this.#height = next;
				finalSize.height = next;
			}

			getContext() {
				return {
					drawImage() {},
				};
			}

			async convertToBlob(options?: {type?: string; quality?: number}) {
				convertCalls.push(options ?? {});
				return options?.type === 'image/webp'
					? new Blob([new Uint8Array([9])], {type: 'image/png'})
					: new Blob([new Uint8Array([4, 5])], {type: 'image/jpeg'});
			}
		}

		Object.defineProperty(globalThis, 'OffscreenCanvas', {
			configurable: true,
			value: FallbackOffscreenCanvas,
		});

		const generator = createCanvasThumbnailGenerator();
		const result = await generator(makeFrame(400, 300));
		expect(result?.blob.type).toBe('image/jpeg');
		expect(result?.width).toBe(400);
		expect(result?.height).toBe(300);
		expect(convertCalls).toEqual([
			{type: 'image/webp', quality: THUMBNAIL_QUALITY},
			{type: 'image/jpeg', quality: THUMBNAIL_QUALITY},
		]);
		expect(finalSize).toEqual({width: 1, height: 1});
	});

	it('returns null when getContext returns null or both webp and jpeg fail', async () => {
		class NoContextCanvas {
			getContext() {
				return null;
			}
		}

		Object.defineProperty(globalThis, 'OffscreenCanvas', {
			configurable: true,
			value: NoContextCanvas,
		});

		const generator = createCanvasThumbnailGenerator();
		expect(await generator(makeFrame(200, 200))).toBeNull();

		class FailingEncodeCanvas {
			width = 200;
			height = 200;

			getContext() {
				return {drawImage() {}};
			}

			async convertToBlob() {
				throw new Error('encode failed');
			}
		}

		Object.defineProperty(globalThis, 'OffscreenCanvas', {
			configurable: true,
			value: FailingEncodeCanvas,
		});

		expect(await generator(makeFrame(200, 200))).toBeNull();
	});
});
