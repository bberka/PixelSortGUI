import {
	KernelScratch,
	pixelSortKernel,
	type PhaseBreakdown,
	type SortAlgorithm,
	type SortAngle,
} from './kernel.ts';
import type {WorkerRequest, WorkerResponse} from './protocol.ts';
import type {
	BreakdownEntry,
	CancelEntry,
	MainThreadHealth,
	PercentileSummary,
	PreviewEntry,
	SpikeS1Report,
	ThroughputEntry,
} from './report-types.ts';
import {generateSyntheticPhoto} from './synthetic.ts';

type PerformanceWithMemory = Performance & {
	memory?: {
		usedJSHeapSize: number;
	};
};

declare global {
	var __runSpikeS1:
		((options?: {quick?: boolean}) => Promise<SpikeS1Report>) | undefined;
}

function percentile(sorted: readonly number[], p: number): number {
	if (sorted.length === 0) {
		return 0;
	}

	const idx = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil(p * sorted.length) - 1),
	);
	return sorted[idx];
}

function summarize(values: readonly number[]): PercentileSummary {
	const sorted = values.toSorted((a, b) => a - b);
	let sum = 0;
	for (const v of sorted) {
		sum += v;
	}

	return {
		runs: sorted.length,
		min: sorted[0] ?? 0,
		p50: percentile(sorted, 0.5),
		p95: percentile(sorted, 0.95),
		max: sorted.at(-1) ?? 0,
		mean: sorted.length > 0 ? sum / sorted.length : 0,
	};
}

function renderSize(
	sourceW: number,
	sourceH: number,
	pixelCap: number,
): {width: number; height: number} {
	const scale = Math.min(1, Math.sqrt(pixelCap / (sourceW * sourceH)));
	return {
		width: Math.max(1, Math.floor(sourceW * scale)),
		height: Math.max(1, Math.floor(sourceH * scale)),
	};
}

function nextAnimationFrame(): Promise<number> {
	return new Promise((resolve) => {
		requestAnimationFrame(resolve);
	});
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

class MainThreadMonitor {
	private readonly stallSamples: number[] = [];
	private observer: PerformanceObserver | undefined;
	private intervalId: number | undefined;
	private lastTick = 0;
	readonly longTaskApiSupported: boolean;
	longTaskCount = 0;
	longestLongTaskMs = 0;
	longestDrawMs = 0;

	constructor() {
		const supportedTypes =
			typeof PerformanceObserver === 'function' &&
			Array.isArray(PerformanceObserver.supportedEntryTypes)
				? PerformanceObserver.supportedEntryTypes
				: [];
		this.longTaskApiSupported = supportedTypes.includes('longtask');
	}

	start(): void {
		if (this.longTaskApiSupported) {
			this.observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					this.longTaskCount++;
					if (entry.duration > this.longestLongTaskMs) {
						this.longestLongTaskMs = entry.duration;
					}
				}
			});
			this.observer.observe({entryTypes: ['longtask']});
		}

		this.lastTick = performance.now();
		this.intervalId = globalThis.setInterval(() => {
			const now = performance.now();
			const stall = Math.max(0, now - this.lastTick - 16);
			this.stallSamples.push(stall);
			this.lastTick = now;
		}, 16);
	}

	recordDraw(drawMs: number): void {
		if (drawMs > this.longestDrawMs) {
			this.longestDrawMs = drawMs;
		}
	}

	stop(): MainThreadHealth {
		this.observer?.disconnect();
		if (this.intervalId !== undefined) {
			globalThis.clearInterval(this.intervalId);
		}

		const stallSummary = summarize(this.stallSamples);
		return {
			longTaskApiSupported: this.longTaskApiSupported,
			longTaskCount: this.longTaskCount,
			longestLongTaskMs: this.longestLongTaskMs,
			stallProbeMaxMs: stallSummary.max,
			stallProbeP95Ms: stallSummary.p95,
			longestDrawMs: this.longestDrawMs,
		};
	}
}

class WorkerClient {
	private readonly worker: Worker;
	private nextRequestId = 1;
	private nextJobId = 1;
	private generation = 1;
	private readonly pendingPrepare = new Map<
		number,
		(response: Extract<WorkerResponse, {type: 'prepared'}>) => void
	>();

	private readonly pendingRelease = new Map<number, () => void>();
	private readonly pendingRender = new Map<
		number,
		(
			response:
				| Extract<WorkerResponse, {type: 'rendered'}>
				| Extract<WorkerResponse, {type: 'cancelled'}>,
		) => void
	>();

	constructor() {
		this.worker = new Worker(new URL('worker.ts', import.meta.url), {
			type: 'module',
		});
		this.worker.addEventListener(
			'message',
			(event: MessageEvent<WorkerResponse>) => {
				const msg = event.data;
				switch (msg.type) {
					case 'prepared': {
						const resolve = this.pendingPrepare.get(msg.requestId);
						this.pendingPrepare.delete(msg.requestId);
						resolve?.(msg);
						break;
					}

					case 'released': {
						const resolve = this.pendingRelease.get(msg.requestId);
						this.pendingRelease.delete(msg.requestId);
						resolve?.();
						break;
					}

					case 'rendered':
					case 'cancelled': {
						const resolve = this.pendingRender.get(msg.jobId);
						this.pendingRender.delete(msg.jobId);
						resolve?.(msg);
						break;
					}

					case 'error': {
						throw new Error(`Worker error: ${msg.message}`);
					}
				}
			},
		);
	}

	prepare(
		width: number,
		height: number,
		analyzeAngle?: SortAngle,
	): Promise<Extract<WorkerResponse, {type: 'prepared'}>> {
		const requestId = this.nextRequestId++;
		return new Promise((resolve) => {
			this.pendingPrepare.set(requestId, resolve);
			const req: WorkerRequest = {
				type: 'prepare',
				requestId,
				width,
				height,
				analyzeAngle,
			};
			this.worker.postMessage(req);
		});
	}

	release(): Promise<void> {
		const requestId = this.nextRequestId++;
		return new Promise((resolve) => {
			this.pendingRelease.set(requestId, resolve);
			this.worker.postMessage({
				type: 'release',
				requestId,
			} satisfies WorkerRequest);
		});
	}

	startRender(params: {
		width: number;
		height: number;
		angle: SortAngle;
		algorithm: SortAlgorithm;
		collectBreakdown: boolean;
		returnBitmap: boolean;
	}): {
		jobId: number;
		generation: number;
		promise: Promise<
			| Extract<WorkerResponse, {type: 'rendered'}>
			| Extract<WorkerResponse, {type: 'cancelled'}>
		>;
	} {
		const jobId = this.nextJobId++;
		const generation = ++this.generation;
		const promise = new Promise<
			| Extract<WorkerResponse, {type: 'rendered'}>
			| Extract<WorkerResponse, {type: 'cancelled'}>
		>((resolve) => {
			this.pendingRender.set(jobId, resolve);
			this.worker.postMessage({
				type: 'render',
				jobId,
				generation,
				...params,
			} satisfies WorkerRequest);
		});
		return {jobId, generation, promise};
	}

	cancelAll(): number {
		const nextGen = ++this.generation;
		this.worker.postMessage({
			type: 'cancel',
			belowGeneration: nextGen,
		} satisfies WorkerRequest);
		return nextGen;
	}

	terminate(): void {
		this.worker.terminate();
	}
}

async function verifyCorrectness(): Promise<boolean> {
	const w = 128;
	const h = 96;
	const input = generateSyntheticPhoto(w, h, 42);
	const scratch = new KernelScratch(Math.max(w, h));

	for (const angle of [0, 30] as const) {
		const outTyped = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
		const outRadix = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));

		await pixelSortKernel(
			input,
			outTyped,
			w,
			h,
			{angle, algorithm: 'typed-array'},
			scratch,
		);
		await pixelSortKernel(
			input,
			outRadix,
			w,
			h,
			{angle, algorithm: 'radix-16'},
			scratch,
		);

		for (const [i, value] of outTyped.entries()) {
			if (value !== outRadix[i]) {
				return false;
			}
		}
	}

	return true;
}

function readMainHeapBytes(): number | undefined {
	const perf = performance as PerformanceWithMemory;
	return perf.memory?.usedJSHeapSize;
}

function setStatus(text: string): void {
	const el = document.querySelector('#status');
	if (el) {
		el.textContent = text;
	}
}

async function runBenchmark(options?: {
	quick?: boolean;
}): Promise<SpikeS1Report> {
	const quick = options?.quick ?? false;
	const canvas = document.querySelector<HTMLCanvasElement>('#stage');
	const ctx = canvas?.getContext('2d');
	if (!canvas || !ctx) {
		throw new Error('Missing #stage 2D canvas');
	}

	setStatus('Running correctness check...');
	const correctnessPassed = await verifyCorrectness();
	if (!correctnessPassed) {
		throw new Error('Correctness check failed: typed-array !== radix-16');
	}

	const monitor = new MainThreadMonitor();
	monitor.start();

	const worker = new WorkerClient();

	try {
		// 1. Analyze 12 MP synthetic image run statistics
		setStatus('Preparing 12 MP image (4000x3000)...');
		const prep0 = await worker.prepare(4000, 3000, 0);
		const prep30 = await worker.prepare(4000, 3000, 30);
		if (!prep0.stats || !prep30.stats) {
			throw new Error('Missing image stats');
		}

		const imageStats12Mp = {
			angle0: prep0.stats,
			angle30: prep30.stats,
		};

		const runThroughputCase = async (
			label: string,
			width: number,
			height: number,
			angle: SortAngle,
			algorithm: SortAlgorithm,
			warmup: number,
			runs: number,
		): Promise<ThroughputEntry> => {
			setStatus(`Throughput: ${label} angle=${angle} algo=${algorithm}...`);
			await worker.prepare(width, height);
			const kernelSamples: number[] = [];
			const totalSamples: number[] = [];
			let yieldSum = 0;
			let peakHeap = readMainHeapBytes();

			for (let i = 0; i < warmup + runs; i++) {
				const {promise} = worker.startRender({
					width,
					height,
					angle,
					algorithm,
					collectBreakdown: false,
					returnBitmap: false,
				});
				const res = await promise;
				if (res.type !== 'rendered') {
					throw new Error('Unexpected cancellation during throughput run');
				}

				if (res.jsHeapUsedBytes !== undefined) {
					peakHeap = Math.max(peakHeap ?? 0, res.jsHeapUsedBytes);
				}

				if (i < warmup) {
					continue;
				}

				kernelSamples.push(res.kernelMs);
				totalSamples.push(res.totalWorkerMs);
				yieldSum += res.yieldCount;
			}

			const kernelSummary = summarize(kernelSamples);
			const totalSummary = summarize(totalSamples);
			const megapixels = (width * height) / 1_000_000;

			return {
				label,
				width,
				height,
				megapixels,
				angle,
				algorithm,
				kernelMs: kernelSummary,
				totalWorkerMs: totalSummary,
				throughputP50Mps: megapixels / (kernelSummary.p50 / 1000),
				throughputP95Mps: megapixels / (kernelSummary.p95 / 1000),
				avgYieldCount: yieldSum / runs,
				peakJsHeapBytes: peakHeap,
			};
		};

		// 2. Compare sorting algorithms on 12 MP (angle 0 and angle 30)
		const algoWarmup = quick ? 1 : 2;
		const algoRuns = quick ? 3 : 7;
		const algorithmComparison12Mp: ThroughputEntry[] = [];
		for (const algorithm of [
			'typed-array',
			'radix-16',
			'counting-8',
		] as const) {
			for (const angle of [0, 30] as const) {
				algorithmComparison12Mp.push(
					await runThroughputCase(
						'12 MP',
						4000,
						3000,
						angle,
						algorithm,
						algoWarmup,
						algoRuns,
					),
				);
			}
		}

		const typed0 = algorithmComparison12Mp.find(
			(e) => e.algorithm === 'typed-array' && e.angle === 0,
		);
		const radix0 = algorithmComparison12Mp.find(
			(e) => e.algorithm === 'radix-16' && e.angle === 0,
		);
		const winningExactAlgorithm: SortAlgorithm =
			radix0 && typed0 && radix0.kernelMs.p50 < typed0.kernelMs.p50
				? 'radix-16'
				: 'typed-array';

		// 3. Phase breakdown on 12 MP for both exact algorithms
		const breakdowns: BreakdownEntry[] = [];
		for (const algorithm of ['typed-array', 'radix-16'] as const) {
			for (const angle of [0, 30] as const) {
				setStatus(`Breakdown: 12 MP angle=${angle} algo=${algorithm}...`);
				const ref = algorithmComparison12Mp.find(
					(e) => e.algorithm === algorithm && e.angle === angle,
				);
				const runs = quick ? 1 : 3;
				const totals: PhaseBreakdown = {
					gatherMs: 0,
					keySelectMs: 0,
					sortMs: 0,
					scatterMs: 0,
				};
				let totalInstr = 0;

				for (let i = 0; i < runs; i++) {
					const {promise} = worker.startRender({
						width: 4000,
						height: 3000,
						angle,
						algorithm,
						collectBreakdown: true,
						returnBitmap: false,
					});
					const res = await promise;
					if (res.type !== 'rendered' || !res.breakdown) {
						throw new Error('Missing breakdown');
					}

					totals.gatherMs += res.breakdown.gatherMs;
					totals.keySelectMs += res.breakdown.keySelectMs;
					totals.sortMs += res.breakdown.sortMs;
					totals.scatterMs += res.breakdown.scatterMs;
					totalInstr += res.kernelMs;
				}

				breakdowns.push({
					label: '12 MP',
					width: 4000,
					height: 3000,
					angle,
					algorithm,
					uninstrumentedMs: ref?.kernelMs.p50 ?? 0,
					instrumentedTotalMs: totalInstr / runs,
					gatherMs: totals.gatherMs / runs,
					keySelectMs: totals.keySelectMs / runs,
					sortMs: totals.sortMs / runs,
					scatterMs: totals.scatterMs / runs,
				});
			}
		}

		// 4. Full-resolution throughput at 12 MP, 24 MP, 50 MP using winning exact algorithm
		const fullThroughput: ThroughputEntry[] = [];
		for (const angle of [0, 30] as const) {
			const existing = algorithmComparison12Mp.find(
				(e) => e.algorithm === winningExactAlgorithm && e.angle === angle,
			);
			if (existing) {
				fullThroughput.push(existing);
			}
		}

		await worker.release();

		// 24 MP (4:3): 5656 x 4244 = 24.004 MP
		for (const angle of [0, 30] as const) {
			fullThroughput.push(
				await runThroughputCase(
					'24 MP',
					5656,
					4244,
					angle,
					winningExactAlgorithm,
					1,
					quick ? 2 : 5,
				),
			);
		}

		await worker.release();

		// 50 MP (4:3): 8166 x 6124 = 50.009 MP
		for (const angle of [0, 30] as const) {
			fullThroughput.push(
				await runThroughputCase(
					'50 MP',
					8166,
					6124,
					angle,
					winningExactAlgorithm,
					1,
					quick ? 1 : 3,
				),
			);
		}

		await worker.release();

		// 5. Preview levels: drag (1 MP cap -> 1182x886) and settle (4 MP cap -> 2364x1773)
		const dragSize = renderSize(4000, 3000, 1_048_576);
		const settleSize = renderSize(4000, 3000, 4_194_304);

		const runPreviewCase = async (
			level: 'drag' | 'settle',
			size: {width: number; height: number},
			angle: SortAngle,
			warmup: number,
			runs: number,
		): Promise<PreviewEntry> => {
			setStatus(
				`Preview: ${level} (${size.width}x${size.height}) angle=${angle}...`,
			);
			canvas.width = size.width;
			canvas.height = size.height;
			await worker.prepare(size.width, size.height);

			const workerKernel: number[] = [];
			const workerBitmap: number[] = [];
			const workerTotal: number[] = [];
			const mainDraw: number[] = [];
			const visibleUpdate: number[] = [];

			for (let i = 0; i < warmup + runs; i++) {
				const start = performance.now();
				const {promise} = worker.startRender({
					width: size.width,
					height: size.height,
					angle,
					algorithm: winningExactAlgorithm,
					collectBreakdown: false,
					returnBitmap: true,
				});
				const res = await promise;
				if (res.type !== 'rendered' || !res.bitmap) {
					throw new Error('Expected rendered bitmap for preview');
				}

				const drawStart = performance.now();
				ctx.drawImage(res.bitmap, 0, 0);
				res.bitmap.close();
				const drawEnd = performance.now();
				const drawDuration = drawEnd - drawStart;
				monitor.recordDraw(drawDuration);

				await nextAnimationFrame();

				if (i < warmup) {
					continue;
				}

				const visibleEnd = performance.now();
				workerKernel.push(res.kernelMs);
				workerBitmap.push(res.bitmapMs);
				workerTotal.push(res.totalWorkerMs);
				mainDraw.push(drawDuration);
				visibleUpdate.push(visibleEnd - start);
			}

			return {
				level,
				width: size.width,
				height: size.height,
				megapixels: (size.width * size.height) / 1_000_000,
				angle,
				algorithm: winningExactAlgorithm,
				workerKernelMs: summarize(workerKernel),
				workerBitmapMs: summarize(workerBitmap),
				workerTotalMs: summarize(workerTotal),
				mainDrawMs: summarize(mainDraw),
				visibleUpdateMs: summarize(visibleUpdate),
			};
		};

		const previews: PreviewEntry[] = [
			await runPreviewCase('drag', dragSize, 0, quick ? 2 : 3, quick ? 5 : 21),
			await runPreviewCase('drag', dragSize, 30, quick ? 2 : 3, quick ? 5 : 21),
			await runPreviewCase(
				'settle',
				settleSize,
				0,
				quick ? 1 : 2,
				quick ? 3 : 11,
			),
			await runPreviewCase(
				'settle',
				settleSize,
				30,
				quick ? 1 : 2,
				quick ? 3 : 11,
			),
		];

		// 6. Cancellation latency
		const cancellation: CancelEntry[] = [];
		const runCancelCase = async (
			label: string,
			width: number,
			height: number,
			angle: SortAngle,
			trials: number,
			delayMs: number,
		): Promise<CancelEntry> => {
			setStatus(`Cancellation: ${label} angle=${angle}...`);
			await worker.prepare(width, height);
			const latencies: number[] = [];

			for (let i = 0; i < trials; i++) {
				const {promise: firstPromise} = worker.startRender({
					width,
					height,
					angle,
					algorithm: winningExactAlgorithm,
					collectBreakdown: false,
					returnBitmap: false,
				});

				await sleep(delayMs);
				const cancelSentAt = performance.now();
				worker.cancelAll();
				const res = await firstPromise;
				const cancelDoneAt = performance.now();
				if (res.type === 'cancelled') {
					latencies.push(cancelDoneAt - cancelSentAt);
				}
			}

			return {
				label,
				width,
				height,
				angle,
				trials: latencies.length,
				cancelLatencyMs: summarize(latencies),
			};
		};

		const cancelTrials = quick ? 4 : 15;
		cancellation.push(
			await runCancelCase(
				'settle (4 MP)',
				settleSize.width,
				settleSize.height,
				0,
				cancelTrials,
				15,
			),
			await runCancelCase(
				'settle (4 MP)',
				settleSize.width,
				settleSize.height,
				30,
				cancelTrials,
				15,
			),
			await runCancelCase('12 MP', 4000, 3000, 0, cancelTrials, 20),
		);

		const mainThread = monitor.stop();
		setStatus('Done.');

		const report: SpikeS1Report = {
			userAgent: navigator.userAgent,
			hardwareConcurrency: navigator.hardwareConcurrency,
			correctnessPassed,
			winningExactAlgorithm,
			imageStats12Mp,
			algorithmComparison12Mp,
			fullThroughput,
			previews,
			breakdowns,
			cancellation,
			mainThread,
		};

		const outputEl = document.querySelector('#output');
		if (outputEl) {
			outputEl.textContent = JSON.stringify(report, null, 2);
		}

		return report;
	} finally {
		worker.terminate();
	}
}

// eslint-disable-next-line unicorn/no-global-object-property-assignment -- Expose benchmark entry point to Playwright page.evaluate
globalThis.__runSpikeS1 = runBenchmark;

const runButton = document.querySelector<HTMLButtonElement>('#run-btn');
runButton?.addEventListener('click', () => {
	void runBenchmark();
});
