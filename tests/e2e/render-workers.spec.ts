import {expect, test} from '@playwright/test';
import {renderSize, renderSizeForPixelCap} from '../../src/codec/decode.ts';
import {boxDownscale} from '../../src/engine/resample.ts';
import {
	DRAG_PIXEL_CAP_MAX,
	type PreviewRequest,
	type PreviewResponse,
} from '../../src/worker/protocol.ts';
import {
	builtAsset,
	directRenderHash,
	openRenderPage,
	pixelSortStack,
	syntheticImage,
	type PageHelpers,
} from './render-fixtures.ts';

type PageScope = {renderTest: PageHelpers};

const defaultStack = pixelSortStack({});
const angledStack = pixelSortStack(
	{angle: 30, sortKey: 'hue'},
	{angle: 90, intervalMode: 'edges', order: 'descending'},
);
const heavyStack = pixelSortStack(
	...[20, 40, 60, 80, 100, 120].map((angle) => ({angle})),
);

test.describe('render workers in the production build', () => {
	test('preview frames equal a direct render with the same inputs', async ({
		page,
	}) => {
		const width = 1600;
		const height = 1200;
		const source = syntheticImage(width, height);
		const dragSize = renderSizeForPixelCap(width, height, DRAG_PIXEL_CAP_MAX);
		expect(dragSize.width).toBeLessThan(width);
		const expected = [
			{
				level: 'drag',
				width: dragSize.width,
				height: dragSize.height,
				hash: await directRenderHash(
					boxDownscale(source, dragSize.width, dragSize.height),
					defaultStack,
					'drag',
					width,
					height,
				),
			},
			{
				level: 'settle',
				width,
				height,
				hash: await directRenderHash(source, defaultStack, 'settle'),
			},
			{
				level: 'settle',
				width,
				height,
				hash: await directRenderHash(source, angledStack, 'settle'),
			},
		];

		await openRenderPage(page);
		const actual = await page.evaluate(
			async (input) => {
				const {renderTest} = globalThis as unknown as PageScope;
				const {createRenderCoordinator} = await renderTest.loadCoordinator(
					input.url,
				);
				const coordinator = createRenderCoordinator();
				const frames: Array<{
					level: string;
					width: number;
					height: number;
					pixels: Uint8ClampedArray<ArrayBuffer>;
				}> = [];
				const errors: string[] = [];
				let loaded = false;
				const signal = renderTest.signal();
				coordinator.subscribe((event) => {
					switch (event.type) {
						case 'frame': {
							const {frame} = event;
							frames.push({
								level: frame.level,
								width: frame.width,
								height: frame.height,
								pixels: renderTest.bitmapPixels(frame.bitmap),
							});

							break;
						}

						case 'source': {
							loaded = event.source !== undefined;

							break;
						}

						case 'error': {
							errors.push(event.error.message);

							break;
						}
						// No default
					}

					signal.wake();
				});

				coordinator.setSource({
					key: 'hash',
					blob: await renderTest.sourceBlob(
						input.width,
						input.height,
						'image/png',
					),
					width: input.width,
					height: input.height,
				});
				await signal.until(() => loaded || errors.length > 0);
				coordinator.setStack({stack: input.defaultStack}, {dragging: true});
				await signal.until(() => frames.length === 2 || errors.length > 0);
				coordinator.setStack({stack: input.angledStack});
				await signal.until(() => frames.length === 3 || errors.length > 0);

				const hashed = [];
				for (const frame of frames) {
					hashed.push({
						level: frame.level,
						width: frame.width,
						height: frame.height,
						hash: await renderTest.sha256(frame.pixels),
					});
				}

				coordinator.dispose();
				return {frames: hashed, errors};
			},
			{
				url: builtAsset('coordinator'),
				width,
				height,
				defaultStack,
				angledStack,
			},
		);

		expect(actual.errors).toEqual([]);
		expect(actual.frames).toEqual(expected);
	});

	test('a newer request cancels an older one and only the newer frame is delivered', async ({
		page,
	}) => {
		const width = 2000;
		const height = 1500;
		const expectedHash = await directRenderHash(
			syntheticImage(width, height),
			defaultStack,
			'settle',
		);

		await openRenderPage(page);
		const actual = await page.evaluate(
			async (input) => {
				const {renderTest} = globalThis as unknown as PageScope;
				const blob = await renderTest.sourceBlob(
					input.width,
					input.height,
					'image/png',
				);
				const signal = renderTest.signal();

				// The worker protocol directly: what the worker answers to each job.
				const worker = new globalThis.Worker(input.workerUrl, {type: 'module'});
				const answers: Array<{type: string; jobId?: number}> = [];
				let workerHash = '';
				let sourceLoaded = false;
				worker.addEventListener(
					'message',
					async (event: MessageEvent<PreviewResponse>) => {
						const response = event.data;
						if (response.type === 'sourceLoaded') {
							sourceLoaded = true;
							response.original.close();
						} else if (response.type !== 'progress') {
							answers.push({type: response.type, jobId: response.jobId});
						}

						if (response.type === 'rendered') {
							const pixels = renderTest.bitmapPixels(response.bitmap);
							response.bitmap.close();
							workerHash = await renderTest.sha256(pixels);
						}

						signal.wake();
					},
				);
				const post = (message: PreviewRequest) => {
					worker.postMessage(message);
				};

				const render = (jobId: number, stack: typeof input.heavyStack) => {
					post({
						type: 'render',
						jobId,
						generation: jobId,
						sourceKey: 'cancel',
						level: 'settle',
						stack,
					});
				};

				post({
					type: 'loadSource',
					requestId: 1,
					sourceKey: 'cancel',
					blob,
					sourceWidth: input.width,
					sourceHeight: input.height,
					caps: {drag: 1_048_576, settle: 4_194_304},
				});
				await signal.until(() => sourceLoaded);
				render(1, input.heavyStack);
				await renderTest.sleep(20);
				render(2, input.defaultStack);
				await signal.until(() => workerHash !== '');
				await renderTest.sleep(300);
				worker.terminate();

				// The same through the coordinator: what a subscriber sees.
				const {createRenderCoordinator} = await renderTest.loadCoordinator(
					input.coordinatorUrl,
				);
				const coordinator = createRenderCoordinator();
				const frames: Array<{
					generation: number;
					pixels: Uint8ClampedArray<ArrayBuffer>;
				}> = [];
				let loaded = false;
				coordinator.subscribe((event) => {
					if (event.type === 'frame') {
						frames.push({
							generation: event.frame.generation,
							pixels: renderTest.bitmapPixels(event.frame.bitmap),
						});
					} else if (event.type === 'source') {
						loaded = true;
					}

					signal.wake();
				});
				coordinator.setSource({
					key: 'cancel',
					blob,
					width: input.width,
					height: input.height,
				});
				await signal.until(() => loaded);
				coordinator.setStack({stack: input.heavyStack});
				await renderTest.sleep(20);
				coordinator.setStack({stack: input.defaultStack});
				await signal.until(() => frames.length > 0);
				await renderTest.sleep(300);
				const {generation} = coordinator.getState();
				coordinator.dispose();

				return {
					answers,
					workerHash,
					newestGeneration: generation,
					frameGenerations: frames.map((frame) => frame.generation),
					frameHash: await renderTest.sha256(frames[0].pixels),
				};
			},
			{
				workerUrl: builtAsset('preview.worker'),
				coordinatorUrl: builtAsset('coordinator'),
				width,
				height,
				heavyStack,
				defaultStack,
			},
		);

		expect(actual.answers).toEqual([
			{type: 'cancelled', jobId: 1},
			{type: 'rendered', jobId: 2},
		]);
		expect(actual.workerHash).toBe(expectedHash);
		expect(actual.frameGenerations).toEqual([actual.newestGeneration]);
		expect(actual.frameHash).toBe(expectedHash);
	});

	test('the main thread has no task over 50 ms while a 12 MP project renders', async ({
		page,
		browserName,
	}) => {
		test.setTimeout(120_000);
		await openRenderPage(page);
		const actual = await page.evaluate(
			async (input) => {
				const {renderTest} = globalThis as unknown as PageScope;
				const width = 4000;
				const height = 3000;
				const blob = await renderTest.sourceBlob(width, height, 'image/jpeg');
				const {createRenderCoordinator} = await renderTest.loadCoordinator(
					input.url,
				);
				const coordinator = createRenderCoordinator();
				const frames: string[] = [];
				const errors: string[] = [];
				let full: {width: number; height: number; tiles: number} | undefined;
				const signal = renderTest.signal();
				coordinator.subscribe((event) => {
					if (event.type === 'frame') {
						frames.push(event.frame.level);
					} else if (event.type === 'full' && event.full) {
						full = {
							width: event.full.width,
							height: event.full.height,
							tiles: event.full.tiles.length,
						};
					} else if (event.type === 'error') {
						errors.push(event.error.message);
					}

					signal.wake();
				});
				const until = async (done: () => boolean) =>
					signal.until(() => done() || errors.length > 0);

				// Phases that decode the source file in a worker.
				const decoding = renderTest.watchMainThread();
				coordinator.setSource({key: 'large', blob, width, height});
				coordinator.setStack({stack: input.defaultStack});
				await until(() => frames.includes('settle'));
				decoding.phase('full');
				coordinator.setViewScale(2);
				await until(() => full !== undefined);
				decoding.phase('export');
				const exported = await coordinator.exportImage({
					stack: input.defaultStack,
					scale: 1,
					format: 'png',
				}).result;
				const decodingReport = await decoding.stop();

				// Phases that only render in the preview worker.
				const rendering = renderTest.watchMainThread();
				rendering.phase('drag');
				for (let step = 1; step <= 20; step++) {
					const seen = frames.length;
					const stack = structuredClone(input.defaultStack);
					stack.instances[0].params.threshold = [0.25 + step * 0.01, 0.8];
					coordinator.setStack({stack}, {dragging: true});
					await until(() => frames.length > seen);
				}

				rendering.phase('settle');
				coordinator.endDrag();
				await until(() => frames.at(-1) === 'settle');
				const renderingReport = await rendering.stop();
				coordinator.dispose();
				return {
					decodingReport,
					renderingReport,
					errors,
					full,
					dragFrames: frames.filter((level) => level === 'drag').length,
					exported:
						exported.status === 'done'
							? {width: exported.width, height: exported.height}
							: exported,
				};
			},
			{url: builtAsset('coordinator'), defaultStack},
		);

		expect(actual.errors).toEqual([]);
		expect(actual.dragFrames).toBeGreaterThan(0);
		expect(actual.full).toEqual({width: 4000, height: 3000, tiles: 4});
		expect(actual.exported).toEqual({width: 4000, height: 3000});

		const {renderingReport, decodingReport} = actual;
		expect(renderingReport.longTasks).toEqual([]);
		expect(renderingReport.stalls.filter((stall) => stall.ms >= 50)).toEqual(
			[],
		);

		if (browserName === 'firefox') {
			// Firefox decodes `createImageBitmap(blob)` calls made in a worker on the
			// main thread, so opening a project, the full render and an export each
			// stall it for one decode of the file. Recorded, not asserted.
			test.info().annotations.push({
				type: 'firefox-decode-stall',
				description: JSON.stringify(decodingReport.stalls),
			});
		} else {
			expect(decodingReport.longTasksSupported).toBe(true);
			expect(decodingReport.longTasks).toEqual([]);
			expect(decodingReport.stalls.filter((stall) => stall.ms >= 50)).toEqual(
				[],
			);
		}
	});

	test('an export is a PNG whose decoded pixels equal the direct render', async ({
		page,
	}) => {
		const width = 1601;
		const height = 1201;
		const expectedHash = await directRenderHash(
			syntheticImage(width, height),
			angledStack,
			'full',
		);
		const half = renderSize(width, height, 0.5);
		expect(half).toMatchObject({width: 800, height: 600});

		await openRenderPage(page);
		const actual = await page.evaluate(
			async (input) => {
				const {renderTest} = globalThis as unknown as PageScope;
				const {createRenderCoordinator} = await renderTest.loadCoordinator(
					input.url,
				);
				const coordinator = createRenderCoordinator();
				coordinator.setSource({
					key: 'export',
					blob: await renderTest.sourceBlob(
						input.width,
						input.height,
						'image/png',
					),
					width: input.width,
					height: input.height,
				});
				const stages: string[] = [];
				const fullSize = await coordinator.exportImage({
					stack: input.angledStack,
					scale: 1,
					format: 'png',
					onProgress(stage) {
						if (stages.at(-1) !== stage) {
							stages.push(stage);
						}
					},
				}).result;
				const halfSize = await coordinator.exportImage({
					stack: input.angledStack,
					scale: 0.5,
					format: 'jpeg',
					quality: 90,
				}).result;
				coordinator.dispose();
				if (fullSize.status !== 'done' || halfSize.status !== 'done') {
					throw new Error(JSON.stringify({fullSize, halfSize}));
				}

				const signature = new Uint8Array(
					await fullSize.file.slice(0, 8).arrayBuffer(),
				);
				const decoded = await globalThis.createImageBitmap(fullSize.file);
				return {
					stages,
					signature: [...signature],
					mime: fullSize.mime,
					fileType: fullSize.file.type,
					width: fullSize.width,
					height: fullSize.height,
					decodedWidth: decoded.width,
					decodedHeight: decoded.height,
					hash: await renderTest.sha256(renderTest.bitmapPixels(decoded)),
					half: {
						width: halfSize.width,
						height: halfSize.height,
						mime: halfSize.mime,
					},
				};
			},
			{url: builtAsset('coordinator'), width, height, angledStack},
		);

		expect(actual).toEqual({
			stages: ['decode', 'render', 'encode'],
			signature: [137, 80, 78, 71, 13, 10, 26, 10],
			mime: 'image/png',
			fileType: 'image/png',
			width,
			height,
			decodedWidth: width,
			decodedHeight: height,
			hash: expectedHash,
			half: {width: 800, height: 600, mime: 'image/jpeg'},
		});
	});

	test('cancelling an export stops it promptly', async ({page}) => {
		test.setTimeout(120_000);
		await openRenderPage(page);
		const actual = await page.evaluate(
			async (input) => {
				const {renderTest} = globalThis as unknown as PageScope;
				const {createRenderCoordinator} = await renderTest.loadCoordinator(
					input.url,
				);
				const coordinator = createRenderCoordinator();
				const width = 4000;
				const height = 3000;
				coordinator.setSource({
					key: 'cancel-export',
					blob: await renderTest.sourceBlob(width, height, 'image/jpeg'),
					width,
					height,
				});
				const rendering = Promise.withResolvers<void>();
				const task = coordinator.exportImage({
					stack: input.heavyStack,
					scale: 1,
					format: 'png',
					onProgress(stage, fraction) {
						if (stage === 'render' && fraction > 0) {
							rendering.resolve();
						}
					},
				});
				await rendering.promise;
				const cancelledAt = performance.now();
				task.cancel();
				const outcome = await task.result;
				const cancelMs = performance.now() - cancelledAt;
				coordinator.dispose();
				return {outcome, cancelMs};
			},
			{url: builtAsset('coordinator'), heavyStack},
		);

		expect(actual.outcome).toEqual({status: 'cancelled'});
		// Product.md AC-F12.4 allows 1 s.
		expect(actual.cancelMs).toBeLessThan(1000);
	});
});
