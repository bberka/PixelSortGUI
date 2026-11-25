import {writeFileSync} from 'node:fs';
import process from 'node:process';
import {expect, test} from '@playwright/test';
import type {AppRuntime} from '../../src/state/index.ts';

/**
 AC-F5.3 measured on a 12 MP photo: drag one pixel-sort threshold thumb for
 three seconds, then report how many preview frames the drag produced, that
 the whole drag is one history entry, and which parts of the panel changed
 while it ran.

 Run it on purpose, once per browser:

   PARAM_BENCH=1 pnpm exec playwright test tests/e2e/param-panel-bench.spec.ts --project=chromium
 */

type RuntimeGlobal = {
	__psgRuntime?: AppRuntime;
};

type Bench = {
	frames: Array<{level: string; at: number}>;
	mutations: Array<{row: string; count: number}>;
	mutationDetails: Array<{
		type: string;
		attribute: string | null;
		tag: string;
		slot: string | null;
		row: string;
	}>;
	commits: number;
};

const BENCH_FILE = 'PARAM_BENCH_OUTPUT';

test.describe('parameter panel on a 12 MP photo', () => {
	test.skip(
		process.env.PARAM_BENCH !== '1',
		'set PARAM_BENCH=1 to run the parameter panel measurement',
	);

	test('a three second threshold drag stays responsive and is one history entry', async ({
		page,
	}, testInfo) => {
		test.setTimeout(240_000);
		testInfo.setTimeout(240_000);

		await page.addInitScript(() => {
			const target = globalThis as unknown as Record<string, unknown> & {
				__bench?: Bench;
				__REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown;
			};
			target.__bench = {
				frames: [],
				mutations: [],
				mutationDetails: [],
				commits: 0,
			};
			target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
				supportsFiber: true,
				renderers: new Map<number, unknown>(),
				inject() {},
				onCommitFiberRoot() {
					const bench = target.__bench;
					if (bench) {
						bench.commits += 1;
					}
				},
				onCommitFiberUnmount() {},
				onPostCommitFiberRoot() {},
				checkDCE() {},
			};
		});

		await page.goto('/');
		await page.evaluate(async () => {
			const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
			if (!runtime) {
				throw new Error('App runtime not attached');
			}

			const booted = await runtime.ready;
			if (booted.status !== 'ready') {
				throw new Error(`Expected ready boot, got ${booted.status}`);
			}

			const width = 4000;
			const height = 3000;
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

			const blob = await new Promise<Blob>((resolve, reject) => {
				canvas.toBlob((result) => {
					if (!result) {
						reject(new Error('Failed to encode the synthetic PNG'));
						return;
					}

					resolve(result);
				}, 'image/png');
			});

			await booted.bundle.store
				.getState()
				.importImage({name: '12 MP bench', blob, width, height});
			await booted.bundle.store.getState().addEffect('pixelSort');
		});

		const settle = async () => {
			await expect
				.poll(
					async () =>
						page.evaluate(async () => {
							const runtime = (globalThis as unknown as RuntimeGlobal)
								.__psgRuntime;
							const booted = await runtime?.ready;
							if (booted?.status !== 'ready') {
								return false;
							}

							const state = booted.bundle.store.getState();
							return (
								state.render.frame?.level === 'settle' &&
								!state.render.busy.settle
							);
						}),
					{timeout: 120_000},
				)
				.toBe(true);
		};

		await settle();

		await page.evaluate(async () => {
			const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
			const booted = await runtime?.ready;
			if (booted?.status !== 'ready') {
				throw new Error('App is not ready');
			}

			const bench = (
				globalThis as unknown as Record<string, unknown> & {
					__bench?: Bench;
				}
			).__bench;
			if (!bench) {
				throw new Error('Bench is not installed');
			}

			let previous = booted.bundle.store.getState().render.frame;
			booted.bundle.store.subscribe((state) => {
				const {frame} = state.render;
				if (frame && frame !== previous) {
					bench.frames.push({level: frame.level, at: performance.now()});
				}

				previous = frame;
			});

			const region = globalThis.document.querySelector(
				'[data-slot="parameter-panel"]',
			);
			if (!region) {
				throw new Error('Parameter panel is not mounted');
			}

			const observer = new globalThis.MutationObserver((records) => {
				const perRow = new Map<string, number>();
				for (const record of records) {
					const element =
						record.target instanceof globalThis.Element
							? record.target
							: record.target.parentElement;
					const row = element?.closest('[data-param-row]');
					const label =
						row?.querySelector('label')?.textContent?.trim() ?? 'row';
					perRow.set(label, (perRow.get(label) ?? 0) + 1);
				}

				for (const record of records) {
					if (bench.mutationDetails.length >= 16) {
						break;
					}

					const element =
						record.target instanceof globalThis.Element
							? record.target
							: record.target.parentElement;
					const slot =
						element instanceof globalThis.HTMLElement
							? (element.dataset.slot ?? null)
							: null;
					const rowElement = element?.closest('[data-param-row]');
					const rowLabel =
						rowElement?.querySelector('label')?.textContent?.trim() ?? 'row';
					if (rowLabel !== 'Threshold range') {
						bench.mutationDetails.push({
							type: record.type,
							attribute: record.attributeName,
							tag: element?.tagName ?? 'none',
							slot,
							row: rowLabel,
						});
					}
				}

				for (const [row, count] of perRow) {
					const existing = bench.mutations.find((item) => item.row === row);
					if (existing) {
						existing.count += count;
					} else {
						bench.mutations.push({row, count});
					}
				}
			});
			observer.observe(region, {
				attributes: true,
				characterData: true,
				childList: true,
				subtree: true,
			});
			const holder = globalThis as unknown as {
				__benchObserver?: MutationObserver;
			};
			holder.__benchObserver = observer;
		});

		const thumb = page.getByRole('slider', {name: 'Threshold range high'});
		const box = await thumb.boundingBox();
		if (!box) {
			throw new Error('Slider thumb has no layout box');
		}

		const startX = box.x + box.width / 2;
		const startY = box.y + box.height / 2;
		const before = await page.evaluate(async () => {
			const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
			const booted = await runtime?.ready;
			if (booted?.status !== 'ready') {
				throw new Error('App is not ready');
			}

			const project = booted.bundle.store.getState().activeProject;
			return {
				historyHeadSeq: project?.historyHeadSeq ?? 0,
				threshold: project?.stack.instances[0]?.params.threshold,
				commits: (globalThis as unknown as {__bench?: Bench}).__bench?.commits,
			};
		});

		await page.evaluate(() => {
			const bench = (globalThis as unknown as {__bench?: Bench}).__bench;
			if (!bench) {
				return;
			}

			bench.frames = [];
			bench.mutations = [];
		});
		const commitsBeforeDrag = before.commits ?? 0;

		await page.mouse.move(startX, startY);
		await page.mouse.down();
		const moves: number[] = [];
		const startedAt = Date.now();
		let step = 1;
		while (Date.now() - startedAt < 3000) {
			await page.mouse.move(startX - Math.min(step, 90), startY);
			moves.push(Date.now() - startedAt);
			step += 1;
			await page.waitForTimeout(35);
		}

		const dragDuration = Date.now() - startedAt;
		await page.mouse.up();
		await expect
			.poll(
				async () =>
					page.evaluate(async () => {
						const runtime = (globalThis as unknown as RuntimeGlobal)
							.__psgRuntime;
						const booted = await runtime?.ready;
						if (booted?.status !== 'ready') {
							return false;
						}

						return (
							booted.bundle.store.getState().activeProject?.historyHeadSeq ?? 0
						);
					}),
				{timeout: 30_000},
			)
			.toBe(before.historyHeadSeq + 1);
		const after = await page.evaluate(async () => {
			const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
			const booted = await runtime?.ready;
			if (booted?.status !== 'ready') {
				throw new Error('App is not ready');
			}

			const project = booted.bundle.store.getState().activeProject;
			const bench = (globalThis as unknown as {__bench?: Bench}).__bench;
			const observer = (
				globalThis as unknown as {__benchObserver?: MutationObserver}
			).__benchObserver;
			observer?.disconnect();
			return {
				historyHeadSeq: project?.historyHeadSeq ?? 0,
				threshold: project?.stack.instances[0]?.params.threshold,
				commits: bench?.commits ?? 0,
				frames: bench?.frames ?? [],
				mutations: bench?.mutations ?? [],
				mutationDetails: bench?.mutationDetails ?? [],
				source: booted.bundle.store.getState().render.source,
			};
		});

		const dragFrames = after.frames.filter((frame) => frame.level === 'drag');
		const levelCounts: Record<string, number> = {};
		for (const frame of after.frames) {
			levelCounts[frame.level] = (levelCounts[frame.level] ?? 0) + 1;
		}

		console.log(
			`FRAMES ${JSON.stringify({levelCounts, first: after.frames[0], last: after.frames.at(-1)})}`,
		);
		const updatesPerSecond = dragFrames.length / (dragDuration / 1000);
		const report = {
			browser: testInfo.project.name,
			sourcePixels: after.source
				? `${after.source.width}x${after.source.height}`
				: 'unknown',
			dragDurationMs: dragDuration,
			pointerMoves: moves.length,
			previewFrames: dragFrames.length,
			previewUpdatesPerSecond: Number(updatesPerSecond.toFixed(1)),
			historyEntriesDuringDrag:
				(after.historyHeadSeq ?? 0) - (before.historyHeadSeq ?? 0),
			thresholdBefore: before.threshold,
			thresholdAfter: after.threshold,
			reactCommitsDuringDrag: after.commits - commitsBeforeDrag,
			rowsMutatedDuringDrag: after.mutations,
			mutationsOutsideDraggedRow: after.mutationDetails,
			mountedRows: await page.locator('[data-param-row]').count(),
		};

		const outputPath = process.env[BENCH_FILE];
		if (outputPath) {
			writeFileSync(
				`${outputPath}-${testInfo.project.name}.json`,
				JSON.stringify(report, null, 2),
			);
		}

		console.log(`BENCH ${JSON.stringify(report)}`);
		expect(report.historyEntriesDuringDrag).toBe(1);
		expect(report.previewFrames).toBeGreaterThan(0);
	});
});
