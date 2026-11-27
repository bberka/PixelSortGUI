import {loadavg} from 'node:os';
import process from 'node:process';
import {expect, test} from '@playwright/test';
import {imageBlendSpec} from '../../src/engine/effects/image-blend-spec.ts';
import {defaultParams} from '../../src/engine/params.ts';
import type {EffectStack, ParamValue} from '../../src/engine/types.ts';
import {
	builtAsset,
	openRenderPage,
	pixelSortStack,
	type PageHelpers,
} from './render-fixtures.ts';

type PageScope = {renderTest: PageHelpers};

// Timing never fails CI (engine.md section 14.4): this prints numbers and runs
// only on request, with `RENDER_BENCH=1 pnpm exec playwright test render-bench --workers 1`.
test.skip(!process.env.RENDER_BENCH, 'set RENDER_BENCH=1 to run');

test('12 MP timings with the default pixelSort stack', async ({
	page,
	browserName,
}) => {
	test.setTimeout(300_000);
	await openRenderPage(page);
	const report = await page.evaluate(
		async (input) => {
			const {renderTest} = globalThis as unknown as PageScope;
			const width = 4000;
			const height = 3000;
			const runs = 30;
			const blob = await renderTest.sourceBlob(width, height, 'image/jpeg');
			const {createRenderCoordinator} = await renderTest.loadCoordinator(
				input.url,
			);

			const summary = (values: number[]) => ({
				runs: values.length,
				p50: Math.round(renderTest.percentile(values, 0.5) * 10) / 10,
				p95: Math.round(renderTest.percentile(values, 0.95) * 10) / 10,
				max: Math.round(Math.max(...values) * 10) / 10,
			});
			const stackAt = (step: number) => {
				const stack = structuredClone(input.defaultStack);
				stack.instances[0].params.threshold = [0.2 + (step % 97) * 0.001, 0.8];
				return stack;
			};

			let step = 0;
			const signal = renderTest.signal();
			const frames: Array<{level: string; workerMs: number; pixels: number}> =
				[];
			const busy = {drag: false, settle: false, full: false};
			let loaded = false;
			let fullTiles = 0;
			const subscribe = (
				coordinator: ReturnType<typeof createRenderCoordinator>,
			) => {
				coordinator.subscribe((event) => {
					switch (event.type) {
						case 'frame': {
							frames.push({
								level: event.frame.level,
								workerMs: event.frame.totalMs,
								pixels: event.frame.width * event.frame.height,
							});
							break;
						}

						case 'busy': {
							busy[event.level] = event.busy;
							break;
						}

						case 'source': {
							loaded = event.source !== undefined;
							break;
						}

						case 'full': {
							fullTiles = event.full?.tiles.length ?? 0;
							break;
						}

						case 'progress': {
							break;
						}

						case 'error': {
							throw new Error(event.error.message);
						}
					}

					signal.wake();
				});
			};

			// Project open: decode and first settle frame, a new worker each time.
			const open: number[] = [];
			for (let run = 0; run < 5; run++) {
				const fresh = createRenderCoordinator();
				subscribe(fresh);
				const seen = frames.length;
				const started = performance.now();
				fresh.setSource({key: `open-${run}`, blob, width, height});
				fresh.setStack({stack: input.defaultStack});
				await signal.until(() => frames.length > seen);
				open.push(performance.now() - started);
				fresh.dispose();
			}

			const coordinator = createRenderCoordinator();
			subscribe(coordinator);
			loaded = false;
			coordinator.setSource({key: 'bench', blob, width, height});
			await signal.until(() => loaded);

			const measure = async (level: 'drag' | 'settle', count: number) => {
				const roundTrip: number[] = [];
				const worker: number[] = [];
				let pixels = 0;
				for (let run = 0; run < count; run++) {
					step++;
					const seen = frames.length;
					const started = performance.now();
					coordinator.setStack(
						{stack: stackAt(step)},
						{dragging: level === 'drag'},
					);
					await signal.until(
						() => frames.length > seen && frames.at(-1)!.level === level,
					);
					roundTrip.push(performance.now() - started);
					worker.push(frames.at(-1)!.workerMs);
					pixels = frames.at(-1)!.pixels;
				}

				return {
					pixels,
					requestToFrame: summary(roundTrip),
					worker: summary(worker),
				};
			};

			await measure('drag', 5);
			const drag = await measure('drag', runs);
			const {dragCap} = coordinator.getState();
			await measure('settle', 3);
			const settle = await measure('settle', runs);

			// AC-F8.1: a control moved for 5 s, one new value every 16 ms.
			const before = frames.length;
			const dragStarted = performance.now();
			while (performance.now() - dragStarted < 5000) {
				step++;
				coordinator.setStack({stack: stackAt(step)}, {dragging: true});
				await renderTest.sleep(16);
			}

			const updatesPerSecond = (frames.length - before) / 5;
			const releaseSeen = frames.length;
			const released = performance.now();
			coordinator.endDrag();
			await signal.until(
				() => frames.length > releaseSeen && frames.at(-1)!.level === 'settle',
			);
			const settleAfterRelease = performance.now() - released;

			// Cancellation: a six-instance settle render, cancelled 15 ms in.
			const cancel: number[] = [];
			for (let run = 0; run < runs; run++) {
				step++;
				const stack = structuredClone(input.heavyStack);
				stack.instances[0].params.threshold = [0.2 + (step % 97) * 0.001, 0.8];
				coordinator.setStack({stack});
				await renderTest.sleep(15);
				if (!busy.settle) {
					throw new Error('The render ended before it could be cancelled.');
				}

				const started = performance.now();
				coordinator.cancel();
				await signal.until(() => !busy.settle);
				cancel.push(performance.now() - started);
			}

			// AC-F8.4: zoom to 200%, including the 500 ms wait.
			step++;
			const settleSeen = frames.length;
			coordinator.setStack({stack: stackAt(step)});
			await signal.until(() => frames.length > settleSeen);
			const zoomed = performance.now();
			coordinator.setViewScale(2);
			await signal.until(() => fullTiles > 0);
			const fullMs = performance.now() - zoomed;
			const tileCount = fullTiles;

			const exportMs: number[] = [];
			const exportWorkerMs: number[] = [];
			let fileBytes = 0;
			for (let run = 0; run < 7; run++) {
				const started = performance.now();
				const outcome = await coordinator.exportImage({
					stack: input.defaultStack,
					scale: 1,
					format: 'png',
				}).result;
				if (
					outcome.status !== 'done' ||
					outcome.width !== width ||
					outcome.height !== height
				) {
					throw new Error(JSON.stringify(outcome));
				}

				exportMs.push(performance.now() - started);
				exportWorkerMs.push(outcome.totalMs);
				fileBytes = outcome.file.size;
			}

			const exportCancel: number[] = [];
			for (let run = 0; run < 10; run++) {
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
				const started = performance.now();
				task.cancel();
				await task.result;
				exportCancel.push(performance.now() - started);
			}

			coordinator.dispose();
			return {
				sourceBytes: blob.size,
				projectOpenMs: summary(open),
				drag,
				dragCapAfter: dragCap,
				settle,
				updatesPerSecondWhileDragging: updatesPerSecond,
				settleAfterReleaseMs: Math.round(settleAfterRelease),
				previewCancelMs: summary(cancel),
				fullAfterZoomMs: Math.round(fullMs),
				fullTiles: tileCount,
				exportPngMs: summary(exportMs),
				exportPngWorkerMs: summary(exportWorkerMs),
				exportFileBytes: fileBytes,
				exportCancelMs: summary(exportCancel),
			};
		},
		{
			url: builtAsset('coordinator'),
			defaultStack: pixelSortStack({}),
			heavyStack: pixelSortStack(
				...[20, 40, 60, 80, 100, 120].map((angle) => ({angle})),
			),
		},
	);

	console.log(
		`render-bench ${browserName} ${page.context().browser()?.version()}\n${JSON.stringify(report, null, 2)}`,
	);
	expect(report.fullTiles).toBe(4);
});

function blendStack(params: Record<string, ParamValue>): EffectStack {
	return {
		schemaVersion: 1,
		instances: [
			{
				id: 'blend0000',
				type: 'imageBlend',
				version: imageBlendSpec.version,
				enabled: true,
				params: {
					...defaultParams(imageBlendSpec.params),
					image: 'a'.repeat(64),
					...params,
				},
				mix: 1,
				blend: 'normal',
			},
		],
	};
}

// Times `imageBlend` against the `drag` and `settle` targets (engine.md section
// 16.5), with a `pixelSort` render in the same run to show the machine's speed.
test('imageBlend timings on a 12 MP base', async ({page, browserName}) => {
	test.setTimeout(300_000);
	await openRenderPage(page);
	const loadBefore = loadavg();
	const report = await page.evaluate(
		async (input) => {
			const {renderTest} = globalThis as unknown as PageScope;
			const base = {width: 4000, height: 3000};
			const overlay = {width: 3600, height: 3200};
			const runs = 20;
			const blob = await renderTest.sourceBlob(
				base.width,
				base.height,
				'image/jpeg',
			);
			const extra = await renderTest.sourceBlob(
				overlay.width,
				overlay.height,
				'image/png',
			);
			const {createRenderCoordinator} = await renderTest.loadCoordinator(
				input.url,
			);
			const coordinator = createRenderCoordinator();
			const signal = renderTest.signal();
			const frames: Array<{
				level: string;
				workerMs: number;
				pixels: number;
				pending: boolean;
				missing: boolean;
			}> = [];
			let loaded = false;
			coordinator.setExtraSourceLoader(async () => ({
				blob: extra,
				...overlay,
			}));
			coordinator.subscribe((event) => {
				if (event.type === 'frame') {
					frames.push({
						level: event.frame.level,
						workerMs: event.frame.totalMs,
						pixels: event.frame.width * event.frame.height,
						pending: Boolean(event.frame.sourcesPending),
						missing: event.frame.warnings.some(
							({code}) => code === 'missing-source',
						),
					});
				}

				if (event.type === 'source') {
					loaded = event.source !== undefined;
				}

				if (event.type === 'error') {
					throw new Error(event.error.message);
				}

				signal.wake();
			});
			coordinator.setSource({key: 'blend', blob, ...base});
			await signal.until(() => loaded);

			let step = 0;
			const measure = async (
				stack: typeof input.sort,
				level: 'drag' | 'settle',
				count: number,
			) => {
				const worker: number[] = [];
				let pixels = 0;
				for (let run = 0; run < count; run++) {
					step++;
					const next = structuredClone(stack);
					const [{params}] = next.instances;
					// A new value each time, so no stage comes from the cache.
					if (next.instances[0].type === 'imageBlend') {
						params.opacity = (50 + (step % 49)) / 100;
					} else {
						params.threshold = [0.2 + (step % 97) * 0.001, 0.8];
					}

					const seen = frames.length;
					coordinator.setStack({stack: next}, {dragging: level === 'drag'});
					await signal.until(() =>
						frames
							.slice(seen)
							.some((item) => item.level === level && !item.pending),
					);
					const done = frames
						.slice(seen)
						.find((item) => item.level === level && !item.pending)!;
					if (done.missing) {
						throw new Error('The blend image was missing.');
					}

					worker.push(done.workerMs);
					pixels = done.pixels;
				}

				const round = (value: number) => Math.round(value);
				return {
					pixels,
					median: round(renderTest.percentile(worker, 0.5)),
					p95: round(renderTest.percentile(worker, 0.95)),
					max: round(Math.max(...worker)),
				};
			};

			const results: Record<string, unknown> = {};
			for (const [name, stack] of Object.entries({
				normal: input.normal,
				rotated: input.rotated,
				sort: input.sort,
			})) {
				// Loads the blend image; a `settle` render follows its arrival.
				await measure(stack, 'settle', 1);
				await measure(stack, 'drag', 5);
				const drag = await measure(stack, 'drag', runs);
				const {dragCap} = coordinator.getState();
				await measure(stack, 'settle', 3);
				const settle = await measure(stack, 'settle', runs);
				results[name] = {settle, drag, dragCap};
			}

			coordinator.dispose();
			return results;
		},
		{
			url: builtAsset('coordinator'),
			normal: blendStack({}),
			rotated: blendStack({blendMode: 'overlay', rotation: 33.3}),
			sort: pixelSortStack({}),
		},
	);

	console.log(
		`imageBlend-bench ${browserName} ${page.context().browser()?.version()} load before ${loadBefore.join(' ')}, after ${loadavg().join(' ')}\n${JSON.stringify(report)}`,
	);
});
