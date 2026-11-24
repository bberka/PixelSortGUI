import {analyzeImageRuns, KernelScratch, pixelSortKernel} from './kernel.ts';
import type {WorkerRequest, WorkerResponse} from './protocol.ts';
import {generateSyntheticPhoto} from './synthetic.ts';

class CancelledError extends Error {
	constructor() {
		super('Render cancelled');
	}
}

type PerformanceWithMemory = Performance & {
	memory?: {
		usedJSHeapSize: number;
		totalJSHeapSize: number;
		jsHeapSizeLimit: number;
	};
};

type WorkerScope = {
	postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void;
	addEventListener: (
		type: 'message',
		listener: (event: MessageEvent<WorkerRequest>) => void,
	) => void;
};

const scope = globalThis as unknown as WorkerScope;

const SLICE_MS = 8;

const yieldChannel = new MessageChannel();
let resolveYield: (() => void) | undefined;
yieldChannel.port1.addEventListener('message', () => {
	const fn = resolveYield;
	resolveYield = undefined;
	fn?.();
});
yieldChannel.port1.start();

function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => {
		resolveYield = resolve;
		yieldChannel.port2.postMessage(undefined);
	});
}

function readJsHeapUsedBytes(): number | undefined {
	const perf = performance as PerformanceWithMemory;
	return perf.memory?.usedJSHeapSize;
}

let cachedWidth = 0;
let cachedHeight = 0;
let cachedSource: Uint8ClampedArray<ArrayBuffer> | undefined;
let cachedOutput: Uint8ClampedArray<ArrayBuffer> | undefined;
const scratch = new KernelScratch(8192);

let latestGeneration = 0;
let isRunning = false;
let pendingRender: Extract<WorkerRequest, {type: 'render'}> | undefined;

function ensureBuffers(width: number, height: number): number {
	if (cachedSource && cachedWidth === width && cachedHeight === height) {
		return 0;
	}

	const t0 = performance.now();
	cachedSource = generateSyntheticPhoto(width, height);
	cachedOutput = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
	cachedWidth = width;
	cachedHeight = height;
	return performance.now() - t0;
}

async function runRenderJob(
	request: Extract<WorkerRequest, {type: 'render'}>,
): Promise<void> {
	isRunning = true;
	const {
		jobId,
		generation,
		width,
		height,
		angle,
		algorithm,
		collectBreakdown,
		returnBitmap,
	} = request;

	let yieldCount = 0;

	try {
		ensureBuffers(width, height);
		if (!cachedSource || !cachedOutput) {
			throw new Error('Buffers not initialized');
		}

		if (generation < latestGeneration) {
			throw new CancelledError();
		}

		const totalStart = performance.now();
		let lastYield = totalStart;

		const checkpoint = (): void | Promise<void> => {
			if (generation < latestGeneration) {
				throw new CancelledError();
			}

			const now = performance.now();
			if (now - lastYield >= SLICE_MS) {
				yieldCount++;
				return yieldToEventLoop().then(() => {
					lastYield = performance.now();
					if (generation < latestGeneration) {
						throw new CancelledError();
					}
				});
			}

			return undefined;
		};

		const kernelStart = performance.now();
		const {breakdown} = await pixelSortKernel(
			cachedSource,
			cachedOutput,
			width,
			height,
			{
				angle,
				algorithm,
				collectBreakdown,
				checkpoint,
			},
			scratch,
		);

		if (generation < latestGeneration) {
			throw new CancelledError();
		}

		const kernelMs = performance.now() - kernelStart;

		let bitmap: ImageBitmap | undefined;
		let bitmapMs = 0;
		if (returnBitmap) {
			const bitmapStart = performance.now();
			const imageData = new ImageData(cachedOutput, width, height);
			bitmap = await createImageBitmap(imageData);
			bitmapMs = performance.now() - bitmapStart;
		}

		if (generation < latestGeneration) {
			bitmap?.close();
			throw new CancelledError();
		}

		const totalWorkerMs = performance.now() - totalStart;
		const response: WorkerResponse = {
			type: 'rendered',
			jobId,
			generation,
			kernelMs,
			bitmapMs,
			totalWorkerMs,
			yieldCount,
			breakdown,
			bitmap,
			jsHeapUsedBytes: readJsHeapUsedBytes(),
		};

		if (bitmap) {
			scope.postMessage(response, [bitmap]);
		} else {
			scope.postMessage(response);
		}
	} catch (error) {
		if (error instanceof CancelledError) {
			scope.postMessage({
				type: 'cancelled',
				jobId,
				generation,
				yieldCount,
			});
		} else {
			scope.postMessage({
				type: 'error',
				jobId,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	} finally {
		isRunning = false;
		if (pendingRender) {
			const next = pendingRender;
			pendingRender = undefined;
			void runRenderJob(next);
		}
	}
}

scope.addEventListener('message', (event) => {
	const msg = event.data;

	if (msg.type === 'prepare') {
		try {
			const generateMs = ensureBuffers(msg.width, msg.height);
			const stats =
				msg.analyzeAngle !== undefined && cachedSource
					? analyzeImageRuns(
							cachedSource,
							msg.width,
							msg.height,
							msg.analyzeAngle,
						)
					: undefined;
			scope.postMessage({
				type: 'prepared',
				requestId: msg.requestId,
				width: msg.width,
				height: msg.height,
				generateMs,
				stats,
				jsHeapUsedBytes: readJsHeapUsedBytes(),
			});
		} catch (error) {
			scope.postMessage({
				type: 'error',
				requestId: msg.requestId,
				message: error instanceof Error ? error.message : String(error),
			});
		}

		return;
	}

	if (msg.type === 'release') {
		cachedSource = undefined;
		cachedOutput = undefined;
		cachedWidth = 0;
		cachedHeight = 0;
		scope.postMessage({type: 'released', requestId: msg.requestId});
		return;
	}

	if (msg.type === 'cancel') {
		if (msg.belowGeneration > latestGeneration) {
			latestGeneration = msg.belowGeneration;
		}

		if (pendingRender && pendingRender.generation < latestGeneration) {
			const dropped = pendingRender;
			pendingRender = undefined;
			scope.postMessage({
				type: 'cancelled',
				jobId: dropped.jobId,
				generation: dropped.generation,
				yieldCount: 0,
			});
		}

		return;
	}

	if (msg.generation > latestGeneration) {
		latestGeneration = msg.generation;
	}

	if (isRunning) {
		if (pendingRender) {
			const dropped = pendingRender;
			scope.postMessage({
				type: 'cancelled',
				jobId: dropped.jobId,
				generation: dropped.generation,
				yieldCount: 0,
			});
		}

		pendingRender = msg;
	} else {
		void runRenderJob(msg);
	}
});
