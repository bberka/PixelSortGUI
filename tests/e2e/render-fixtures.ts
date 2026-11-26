/* eslint-disable no-bitwise -- integer hashing for a deterministic test image */
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {Page} from '@playwright/test';
import {effectRegistry} from '../../src/engine/effects/index.ts';
import {pixelSortEffect} from '../../src/engine/effects/pixel-sort/index.ts';
import {defaultParams} from '../../src/engine/params.ts';
import {renderStack} from '../../src/engine/pipeline.ts';
import type * as CoordinatorModule from '../../src/render/coordinator.ts';
import type {
	EffectStack,
	ParamValue,
	RenderLevel,
	RgbaImage,
} from '../../src/engine/types.ts';

/**
 A photo-like opaque image: a vertical gradient with bands, a bright and a dark
 disc, and per-pixel grain. Integer and IEEE-exact arithmetic only, so Node,
 Chromium and Firefox produce the same bytes. It runs in the page too, so it
 must not reference anything outside its own body.
 */
export function syntheticPhoto(
	width: number,
	height: number,
): Uint8ClampedArray<ArrayBuffer> {
	const data = new Uint8ClampedArray(width * height * 4);
	const side = Math.min(width, height);
	const brightX = Math.floor(width * 0.72);
	const brightY = Math.floor(height * 0.24);
	const brightRadius = Math.floor(side * 0.14) ** 2;
	const darkX = Math.floor(width * 0.28);
	const darkY = Math.floor(height * 0.62);
	const darkRadius = Math.floor(side * 0.18) ** 2;
	let index = 0;
	for (let y = 0; y < height; y++) {
		const t = Math.floor((y * 255) / height);
		for (let x = 0; x < width; x++) {
			const u = Math.floor((x * 1024) / width);
			const wave = Math.abs(((u * 5 + t * 3) & 255) - 128) >> 2;
			let r = 55 + ((t * 150) >> 8) + wave;
			let g = 90 + ((t * 110) >> 8) + wave;
			let b = 175 - ((t * 90) >> 8) + (wave >> 1);
			if ((x - brightX) ** 2 + (y - brightY) ** 2 < brightRadius) {
				r = 246;
				g = 240;
				b = 220;
			} else if ((x - darkX) ** 2 + (y - darkY) ** 2 < darkRadius) {
				r = 28 + (wave >> 2);
				g = 34;
				b = 46;
			}

			let h = (Math.imul(y, 0x9e_37_79_b1) ^ Math.imul(x, 0x85_eb_ca_6b)) >>> 0;
			h ^= h >>> 16;
			h = Math.imul(h, 0x7f_eb_35_2d);
			h ^= h >>> 15;
			h = Math.imul(h, 0x84_6c_a6_8b);
			h ^= h >>> 16;
			const grain = (h & 31) - 16;
			data[index] = r + grain;
			data[index + 1] = g + grain;
			data[index + 2] = b + grain;
			data[index + 3] = 255;
			index += 4;
		}
	}

	return data;
}

export function syntheticImage(width: number, height: number): RgbaImage {
	return {width, height, data: syntheticPhoto(width, height)};
}

export function pixelSortStack(
	...overrides: Array<Record<string, ParamValue>>
): EffectStack {
	return {
		schemaVersion: 1,
		instances: overrides.map((params, index) => ({
			id: `sort${String(index).padStart(4, '0')}`,
			type: 'pixelSort',
			version: pixelSortEffect.version,
			enabled: true,
			params: {...defaultParams(pixelSortEffect.params), ...params},
			mix: 1,
			blend: 'normal',
		})),
	};
}

export function sha256(data: Uint8ClampedArray): string {
	return createHash('sha256').update(data).digest('hex');
}

// The reference: the engine run directly in Node, without a worker.
export async function directRenderHash(
	source: RgbaImage,
	stack: EffectStack,
	level: RenderLevel,
	sourceWidth = source.width,
	sourceHeight = source.height,
): Promise<string> {
	const result = await renderStack(source, stack, effectRegistry, {
		level,
		sourceWidth,
		sourceHeight,
		checkpoint: () => undefined,
	});
	return sha256(result.image.data);
}

// The URL of a chunk of the production build, found by its name in `dist/assets`.
export function builtAsset(
	name: 'coordinator' | 'preview.worker' | 'archive-client',
): string {
	const directory = path.resolve(import.meta.dirname, '../../dist/assets');
	const candidates = fs
		.readdirSync(directory)
		.filter((entry) => entry.startsWith(`${name}-`) && entry.endsWith('.js'));
	const file =
		name === 'coordinator'
			? candidates.find((entry) =>
					fs
						.readFileSync(path.join(directory, entry), 'utf8')
						.includes('createRenderCoordinator'),
				)
			: candidates[0];
	if (!file) {
		throw new Error(`No ${name} chunk in ${directory}`);
	}

	return `/assets/${file}`;
}

export type MainThreadReport = {
	// Durations of the tasks the Long Tasks API reported (Chromium only).
	longTasks: number[];
	longTasksSupported: boolean;
	// Longest delay of a 10 ms interval timer beyond its period.
	maxStallMs: number;
	// Every such delay over 20 ms, with the phase it happened in.
	stalls: Array<{phase: string; ms: number}>;
};

export type PageHelpers = {
	sourceBlob(
		width: number,
		height: number,
		type: 'image/png' | 'image/jpeg',
	): Promise<Blob>;
	bitmapPixels(bitmap: ImageBitmap): Uint8ClampedArray<ArrayBuffer>;
	sha256(data: Uint8ClampedArray<ArrayBuffer>): Promise<string>;
	watchMainThread(): {
		phase(name: string): void;
		stop(): Promise<MainThreadReport>;
	};
	percentile(values: number[], p: number): number;
	// `until` resolves once `done()` holds, checking again after every `wake()`.
	signal(): {wake(): void; until(done: () => boolean): Promise<void>};
	sleep(ms: number): Promise<void>;
	// The coordinator chunk of the production build.
	loadCoordinator(url: string): Promise<typeof CoordinatorModule>;
};

function installPageHelpers(): void {
	const scope = globalThis as unknown as {
		syntheticPhoto: typeof syntheticPhoto;
		renderTest: PageHelpers;
	};

	const sleep = async (ms: number) =>
		new Promise<void>((resolve) => {
			setTimeout(resolve, ms);
		});

	scope.renderTest = {
		async sourceBlob(width, height, type) {
			const canvas = new OffscreenCanvas(width, height);
			const context = canvas.getContext('2d')!;
			context.putImageData(
				new ImageData(scope.syntheticPhoto(width, height), width, height),
				0,
				0,
			);
			return canvas.convertToBlob({type, quality: 0.92});
		},

		bitmapPixels(bitmap) {
			const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
			const context = canvas.getContext('2d', {willReadFrequently: true})!;
			context.drawImage(bitmap, 0, 0);
			return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
		},

		async sha256(data) {
			const digest = await crypto.subtle.digest('SHA-256', data);
			return [...new Uint8Array(digest)]
				.map((byte) => byte.toString(16).padStart(2, '0'))
				.join('');
		},

		watchMainThread() {
			const longTasks: number[] = [];
			const longTasksSupported =
				PerformanceObserver.supportedEntryTypes.includes('longtask');
			const observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					longTasks.push(entry.duration);
				}
			});
			if (longTasksSupported) {
				observer.observe({entryTypes: ['longtask']});
			}

			const period = 10;
			const stalls: Array<{phase: string; ms: number}> = [];
			let currentPhase = 'start';
			let maxStallMs = 0;
			let last = performance.now();
			const timer = setInterval(() => {
				const now = performance.now();
				const stall = now - last - period;
				maxStallMs = Math.max(maxStallMs, stall);
				if (stall > 20) {
					stalls.push({phase: currentPhase, ms: Math.round(stall)});
				}

				last = now;
			}, period);

			return {
				phase(name) {
					currentPhase = name;
				},
				async stop() {
					// Long task entries are delivered after the task ends.
					await sleep(100);
					clearInterval(timer);
					for (const entry of observer.takeRecords()) {
						longTasks.push(entry.duration);
					}

					observer.disconnect();
					return {longTasks, longTasksSupported, maxStallMs, stalls};
				},
			};
		},

		signal() {
			let waiters: Array<() => void> = [];
			return {
				wake() {
					const waiting = waiters;
					waiters = [];
					for (const resolve of waiting) {
						resolve();
					}
				},
				async until(done) {
					while (!done()) {
						const {promise, resolve} = Promise.withResolvers<void>();
						waiters.push(resolve);
						await promise;
					}
				},
			};
		},

		sleep,

		async loadCoordinator(url) {
			return import(url) as Promise<typeof CoordinatorModule>;
		},

		percentile(values, p) {
			const sorted = values.toSorted((a, b) => a - b);
			return sorted[
				Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)
			];
		},
	};
}

// Opens the production build and defines `globalThis.renderTest` in the page.
export async function openRenderPage(page: Page): Promise<void> {
	await page.goto('/');
	await page.addScriptTag({
		content: `globalThis.syntheticPhoto = ${syntheticPhoto.toString()};`,
	});
	await page.evaluate(installPageHelpers);
}
