import type {ExportFormat} from '../codec/encode.ts';
import type {PipelineWarning} from '../engine/pipeline.ts';
import type {EffectStack, RenderLevel} from '../engine/types.ts';
import {
	DRAG_PIXEL_CAP_MAX,
	DRAG_PIXEL_CAP_MIN,
	SETTLE_PIXEL_CAP,
	type EngineErrorCode,
	type ExportRequest,
	type ExportResponse,
	type ExportStage,
	type FullTile,
	type PreviewLevel,
	type PreviewRequest,
	type PreviewResponse,
	type ProxySize,
	type StackRequest,
} from '../worker/protocol.ts';

// The main-thread scheduler of engine.md sections 8.3, 8.4 and 11. It imports
// only types from the engine and the codec, so neither lands in the main bundle.

export const SETTLE_DELAY_MS = 150;
export const FULL_DELAY_MS = 500;
export const RENDER_TIMEOUT_MS = 30_000;
export const CRASH_WINDOW_MS = 60_000;
export const DRAG_BUDGET_MS = 50;
export const FULL_ZOOM_THRESHOLD = 1.25;

export type WorkerHandlers<Response> = {
	message(response: Response): void;
	// The worker script failed: an uncaught error or an undeliverable message.
	error(message: string): void;
};

export type WorkerPort<Request> = {
	post(message: Request): void;
	terminate(): void;
};

// The seam for tests: workers and the clock.
export type CoordinatorEnv = {
	createPreviewWorker(
		handlers: WorkerHandlers<PreviewResponse>,
	): WorkerPort<PreviewRequest>;
	createExportWorker(
		handlers: WorkerHandlers<ExportResponse>,
	): WorkerPort<ExportRequest>;
	now(): number;
	setTimeout(callback: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
};

export type RenderSource = {
	// Identifies the image, for example its content hash.
	key: string;
	blob: Blob;
	width: number;
	height: number;
};

export type SourceInfo = {
	key: string;
	width: number;
	height: number;
	settle: ProxySize;
	// At the cap in use when the source loaded. A `drag` frame carries its own size.
	drag: ProxySize;
	// The unprocessed image at `settle` size, for Compare.
	original: ImageBitmap;
};

export type Frame = {
	generation: number;
	level: PreviewLevel;
	bitmap: ImageBitmap;
	width: number;
	height: number;
	totalMs: number;
	perInstanceMs: number[];
	warnings: PipelineWarning[];
};

export type FullFrame = {
	generation: number;
	width: number;
	height: number;
	tiles: FullTile[];
};

export type RenderError = {
	code: EngineErrorCode | 'worker-crashed';
	message: string;
};

/**
 Bitmaps in events belong to the coordinator. One stays valid until the event
 that replaces it has been delivered to every listener (`frame` replaces
 `frame`, `full` replaces `full`, `source` replaces all three), so a listener
 swaps its reference inside the handler and never calls `close()`.
 */
export type RenderEvent =
	// `undefined`: the source was unloaded or is being replaced; the frame and the full result are gone.
	| {type: 'source'; source: SourceInfo | undefined}
	| {type: 'frame'; frame: Frame}
	// `undefined`: the full result was discarded because the stack changed.
	| {type: 'full'; full: FullFrame | undefined}
	// `full` is busy from the moment the full render is scheduled.
	| {type: 'busy'; level: RenderLevel; busy: boolean}
	| {type: 'progress'; level: RenderLevel; fraction: number}
	// `failed`: rendering has stopped after repeated worker crashes, until `retry()`.
	| {type: 'error'; error: RenderError; failed: boolean};

export type ExportOptions = {
	stack: EffectStack;
	// Input of the render size rule: 1, 0.5, 0.25, or `maxSide / longestSide`. Not `RenderSize.scale`.
	scale: number;
	format: ExportFormat;
	// 0..100. Ignored for PNG.
	quality?: number;
	onProgress?: (stage: ExportStage, fraction: number) => void;
};

export type ExportOutcome =
	| {
			status: 'done';
			file: Blob;
			width: number;
			height: number;
			mime: string;
			totalMs: number;
	  }
	| {status: 'cancelled'}
	| {status: 'error'; error: {code: EngineErrorCode; message: string}};

export type ExportTask = {
	// Never rejects.
	result: Promise<ExportOutcome>;
	// Terminates the export worker. No file is produced.
	cancel(): void;
};

export type RenderCoordinator = {
	// Loads the image into the preview worker, replacing the previous one. A call with the current key does nothing.
	setSource(source: RenderSource | undefined): void;
	/**
	 Renders a new effective stack. With `dragging`, the value is an intermediate
	 one from a control being moved: `drag` renders are coalesced to the newest
	 and a `settle` render follows 150 ms after the last change. Without it, the
	 `settle` render starts at once.
	 */
	setStack(request: StackRequest, options?: {dragging?: boolean}): void;
	// The control was released without a further change: render `settle` now.
	endDrag(): void;
	// Device pixels per source pixel on screen. Zooming past the `settle` proxy schedules the `full` render.
	setViewScale(devicePixelsPerSourcePixel: number): void;
	subscribe(listener: (event: RenderEvent) => void): () => void;
	exportImage(options: ExportOptions): ExportTask;
	// Stops preview and full renders in flight. The displayed frame stays; the next `setStack` renders again.
	cancel(): void;
	// Leaves the failed state and reloads the source.
	retry(): void;
	getState(): {
		generation: number;
		source: SourceInfo | undefined;
		frame: Frame | undefined;
		full: FullFrame | undefined;
		dragCap: number;
		failed: boolean;
	};
	dispose(): void;
};

// Engine.md section 8.2: halve when over the budget, double when under 40% of it.
export function nextDragCap(cap: number, totalMs: number): number {
	if (totalMs > DRAG_BUDGET_MS) {
		return Math.max(DRAG_PIXEL_CAP_MIN, cap / 2);
	}

	return totalMs < DRAG_BUDGET_MS * 0.4
		? Math.min(DRAG_PIXEL_CAP_MAX, cap * 2)
		: cap;
}

function attach<Request, Response>(
	worker: Worker,
	handlers: WorkerHandlers<Response>,
): WorkerPort<Request> {
	worker.addEventListener('message', (event: MessageEvent<Response>) => {
		handlers.message(event.data);
	});
	worker.addEventListener('error', (event) => {
		handlers.error(event.message || 'The worker stopped with an error.');
	});
	worker.addEventListener('messageerror', () => {
		handlers.error('A worker message could not be read.');
	});
	return {
		post(message) {
			worker.postMessage(message);
		},
		terminate() {
			worker.terminate();
		},
	};
}

export function createBrowserEnv(): CoordinatorEnv {
	return {
		createPreviewWorker: (handlers) =>
			attach(
				new Worker(new URL('../worker/preview.worker.ts', import.meta.url), {
					type: 'module',
				}),
				handlers,
			),
		createExportWorker: (handlers) =>
			attach(
				new Worker(new URL('../worker/export.worker.ts', import.meta.url), {
					type: 'module',
				}),
				handlers,
			),
		now: () => performance.now(),
		setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
		clearTimeout(handle) {
			globalThis.clearTimeout(handle as number);
		},
	};
}

type Job = {
	jobId: number;
	generation: number;
	timeout: unknown;
	// Set by `cancel()`: the result is dropped even if the worker finished first.
	discard: boolean;
};

type FullJob = {jobId: number; worker: WorkerPort<ExportRequest>};

const PREVIEW_LEVELS: readonly PreviewLevel[] = ['drag', 'settle'];

export function createRenderCoordinator(
	env: CoordinatorEnv = createBrowserEnv(),
): RenderCoordinator {
	const listeners = new Set<(event: RenderEvent) => void>();
	const cancelExports = new Set<() => void>();
	let disposed = false;
	let nextId = 0;
	let generation = 0;

	let source: RenderSource | undefined;
	let sourceInfo: SourceInfo | undefined;
	let ready = false;
	let loadRequestId = 0;
	let request: StackRequest | undefined;

	let preview: WorkerPort<PreviewRequest> | undefined;
	const inFlight: {drag?: Job; settle?: Job} = {};
	const sentGeneration = {drag: -1, settle: -1};
	let dragWanted = false;
	let settleWanted = false;
	let settleTimer: unknown;
	let cancelledBelow = 0;
	let dragCap = DRAG_PIXEL_CAP_MAX;
	let frame: Frame | undefined;

	let lastCrashAt: number | undefined;
	let failed = false;

	let viewScale = 0;
	let fullTimer: unknown;
	let fullJob: FullJob | undefined;
	let full: FullFrame | undefined;
	let fullFailedGeneration = -1;

	const emit = (event: RenderEvent) => {
		for (const listener of listeners) {
			listener(event);
		}
	};

	const closeTiles = (tiles: readonly FullTile[]) => {
		for (const tile of tiles) {
			tile.bitmap.close();
		}
	};

	const finishJob = (level: PreviewLevel): Job | undefined => {
		const job = inFlight[level];
		if (job) {
			env.clearTimeout(job.timeout);
			inFlight[level] = undefined;
			emit({type: 'busy', level, busy: false});
		}

		return job;
	};

	const levelOfJob = (jobId: number): PreviewLevel | undefined =>
		PREVIEW_LEVELS.find((level) => inFlight[level]?.jobId === jobId);

	const stopSettleTimer = () => {
		if (settleTimer === undefined) {
			return;
		}

		env.clearTimeout(settleTimer);
		settleTimer = undefined;
	};

	const discardFull = () => {
		const wasBusy = fullTimer !== undefined || fullJob !== undefined;
		if (fullTimer !== undefined) {
			env.clearTimeout(fullTimer);
			fullTimer = undefined;
		}

		fullJob?.worker.terminate();
		fullJob = undefined;
		if (wasBusy) {
			emit({type: 'busy', level: 'full', busy: false});
		}

		if (!full) {
			return;
		}

		const discarded = full;
		full = undefined;
		emit({type: 'full', full: undefined});
		closeTiles(discarded.tiles);
	};

	const send = (level: PreviewLevel) => {
		if (!preview || !source || !request) {
			return;
		}

		nextId++;
		const jobId = nextId;
		inFlight[level] = {
			jobId,
			generation,
			discard: false,
			timeout: env.setTimeout(() => {
				crash('The preview worker did not answer within 30 seconds.');
			}, RENDER_TIMEOUT_MS),
		};
		sentGeneration[level] = generation;
		emit({type: 'busy', level, busy: true});
		preview.post({
			type: 'render',
			jobId,
			generation,
			sourceKey: source.key,
			level,
			...request,
		});
	};

	const cancelBelow = (belowGeneration: number) => {
		if (!(belowGeneration > cancelledBelow)) {
			return;
		}

		cancelledBelow = belowGeneration;
		preview?.post({type: 'cancel', belowGeneration});
	};

	const pump = () => {
		if (disposed || failed || !ready || !request) {
			return;
		}

		if (settleWanted) {
			if (
				PREVIEW_LEVELS.some(
					(level) => (inFlight[level]?.generation ?? generation) < generation,
				)
			) {
				cancelBelow(generation);
			}

			if (!inFlight.settle) {
				settleWanted = false;
				send('settle');
			}

			return;
		}

		if (!dragWanted || inFlight.drag) {
			return;
		}

		dragWanted = false;
		send('drag');
	};

	const requestSettle = () => {
		stopSettleTimer();
		dragWanted = false;
		if (!request || sentGeneration.settle === generation) {
			return;
		}

		settleWanted = true;
		pump();
	};

	const loadSource = () => {
		if (!source || disposed) {
			return;
		}

		ready = false;
		preview ??= env.createPreviewWorker({
			message: onPreviewMessage,
			error: crash,
		});
		nextId++;
		loadRequestId = nextId;
		preview.post({
			type: 'loadSource',
			requestId: loadRequestId,
			sourceKey: source.key,
			blob: source.blob,
			sourceWidth: source.width,
			sourceHeight: source.height,
			caps: {drag: dragCap, settle: SETTLE_PIXEL_CAP},
		});
	};

	// Engine.md section 11: terminate, start a new worker, reload the source and
	// repeat the newest request. A second crash within 60 s is the failed state.
	function crash(message: string) {
		if (disposed || !preview) {
			return;
		}

		preview.terminate();
		preview = undefined;
		ready = false;
		cancelledBelow = 0;
		for (const level of PREVIEW_LEVELS) {
			finishJob(level);
		}

		const now = env.now();
		const repeated =
			lastCrashAt !== undefined && now - lastCrashAt <= CRASH_WINDOW_MS;
		lastCrashAt = now;
		if (repeated) {
			failed = true;
			stopSettleTimer();
			discardFull();
		} else {
			loadSource();
		}

		emit({
			type: 'error',
			error: {code: 'worker-crashed', message},
			failed: repeated,
		});
	}

	const showFrame = (next: Frame) => {
		const previous = frame;
		frame = next;
		emit({type: 'frame', frame: next});
		previous?.bitmap.close();
	};

	const acceptsFrame = (level: PreviewLevel, frameGeneration: number) =>
		!frame ||
		(level === 'settle'
			? frameGeneration >= frame.generation
			: frameGeneration > frame.generation);

	const wantsFull = () =>
		ready &&
		!failed &&
		source !== undefined &&
		sourceInfo !== undefined &&
		frame?.level === 'settle' &&
		frame.generation === generation &&
		fullFailedGeneration !== generation &&
		sourceInfo.settle.width < source.width &&
		(viewScale * source.width) / sourceInfo.settle.width > FULL_ZOOM_THRESHOLD;

	const endFullJob = (error?: RenderError) => {
		fullJob?.worker.terminate();
		fullJob = undefined;
		emit({type: 'busy', level: 'full', busy: false});
		if (!error) {
			return;
		}

		fullFailedGeneration = generation;
		emit({type: 'error', error, failed: false});
	};

	const startFull = () => {
		fullTimer = undefined;
		if (!source || !request) {
			return;
		}

		nextId++;
		const jobId = nextId;
		const worker = env.createExportWorker({
			message(response) {
				if (fullJob?.jobId !== response.jobId) {
					if (response.type === 'fullRendered') {
						closeTiles(response.tiles);
					}

					return;
				}

				switch (response.type) {
					case 'progress': {
						if (response.stage === 'render') {
							emit({
								type: 'progress',
								level: 'full',
								fraction: response.fraction,
							});
						}

						break;
					}

					case 'fullRendered': {
						const {width, height, tiles} = response;
						endFullJob();
						full = {generation: response.generation, width, height, tiles};
						emit({type: 'full', full});
						break;
					}

					case 'error': {
						endFullJob({code: response.code, message: response.message});
						break;
					}

					case 'exported': {
						break;
					}
				}
			},
			error(message) {
				if (fullJob?.jobId === jobId) {
					endFullJob({code: 'internal', message});
				}
			},
		});
		fullJob = {jobId, worker};
		worker.post({
			type: 'renderFull',
			jobId,
			generation,
			blob: source.blob,
			sourceWidth: source.width,
			sourceHeight: source.height,
			...request,
		});
	};

	const scheduleFull = () => {
		if (!wantsFull()) {
			if (fullTimer !== undefined) {
				env.clearTimeout(fullTimer);
				fullTimer = undefined;
				emit({type: 'busy', level: 'full', busy: false});
			}

			return;
		}

		if (fullTimer !== undefined || fullJob || full) {
			return;
		}

		fullTimer = env.setTimeout(startFull, FULL_DELAY_MS);
		emit({type: 'busy', level: 'full', busy: true});
	};

	function onPreviewMessage(response: PreviewResponse) {
		switch (response.type) {
			case 'sourceLoaded': {
				if (response.requestId !== loadRequestId || !source) {
					response.original.close();
					return;
				}

				const previous = sourceInfo;
				sourceInfo = {
					key: source.key,
					width: source.width,
					height: source.height,
					settle: response.settle,
					drag: response.drag,
					original: response.original,
				};
				ready = true;
				emit({type: 'source', source: sourceInfo});
				previous?.original.close();
				if (request) {
					dragWanted = false;
					settleWanted = true;
					pump();
				}

				break;
			}

			case 'progress': {
				const level = levelOfJob(response.jobId);
				if (level && !inFlight[level]?.discard) {
					emit({type: 'progress', level, fraction: response.fraction});
				}

				break;
			}

			case 'rendered': {
				const {level, bitmap} = response;
				if (inFlight[level]?.jobId !== response.jobId) {
					bitmap.close();
					return;
				}

				const job = finishJob(level);
				if (level === 'drag') {
					const cap = nextDragCap(dragCap, response.totalMs);
					if (cap !== dragCap) {
						dragCap = cap;
						preview?.post({type: 'setDragCap', pixels: cap});
					}
				}

				if (!job?.discard && acceptsFrame(level, response.generation)) {
					showFrame({
						generation: response.generation,
						level,
						bitmap,
						width: response.width,
						height: response.height,
						totalMs: response.totalMs,
						perInstanceMs: response.perInstanceMs,
						warnings: response.warnings,
					});
				} else {
					bitmap.close();
				}

				pump();
				scheduleFull();
				break;
			}

			case 'cancelled': {
				const level = levelOfJob(response.jobId);
				if (level) {
					finishJob(level);
					pump();
				}

				break;
			}

			case 'error': {
				const {code, message, jobId, requestId} = response;
				if (requestId !== undefined && requestId !== loadRequestId) {
					return;
				}

				if (jobId !== undefined) {
					const level = levelOfJob(jobId);
					if (!level) {
						return;
					}

					finishJob(level);
				}

				emit({type: 'error', error: {code, message}, failed: false});
				pump();
				break;
			}
		}
	}

	const dropSource = () => {
		const previousInfo = sourceInfo;
		const previousFrame = frame;
		discardFull();
		sourceInfo = undefined;
		frame = undefined;
		ready = false;
		if (!(previousInfo || previousFrame)) {
			return;
		}

		emit({type: 'source', source: undefined});
		previousInfo?.original.close();
		previousFrame?.bitmap.close();
	};

	const startExport = (
		from: RenderSource,
		options: ExportOptions,
		resolve: (outcome: ExportOutcome) => void,
	): (() => void) => {
		nextId++;
		const jobId = nextId;
		let settled = false;
		const finish = (outcome: ExportOutcome) => {
			if (settled) {
				return;
			}

			settled = true;
			cancelExports.delete(cancel);
			worker.terminate();
			resolve(outcome);
		};

		const cancel = () => {
			finish({status: 'cancelled'});
		};

		const worker = env.createExportWorker({
			message(response) {
				switch (response.type) {
					case 'progress': {
						if (!settled) {
							options.onProgress?.(response.stage, response.fraction);
						}

						break;
					}

					case 'exported': {
						const {file, width, height, mime, totalMs} = response;
						finish({status: 'done', file, width, height, mime, totalMs});
						break;
					}

					case 'error': {
						const {code, message} = response;
						finish({status: 'error', error: {code, message}});
						break;
					}

					case 'fullRendered': {
						closeTiles(response.tiles);
						break;
					}
				}
			},
			error(message) {
				finish({status: 'error', error: {code: 'internal', message}});
			},
		});
		cancelExports.add(cancel);
		worker.post({
			type: 'export',
			jobId,
			blob: from.blob,
			sourceWidth: from.width,
			sourceHeight: from.height,
			scale: options.scale,
			format: options.format,
			quality: options.quality ?? 92,
			stack: options.stack,
		});
		return cancel;
	};

	const invalidate = () => {
		generation++;
		stopSettleTimer();
		dragWanted = false;
		settleWanted = false;
		discardFull();
	};

	return {
		setSource(next) {
			if (disposed || next?.key === source?.key) {
				return;
			}

			const previousKey = source?.key;
			invalidate();
			for (const level of PREVIEW_LEVELS) {
				const job = inFlight[level];
				if (job) {
					job.discard = true;
				}
			}

			dropSource();
			source = next;
			dragCap = DRAG_PIXEL_CAP_MAX;
			failed = false;
			if (next) {
				loadSource();
			} else if (previousKey !== undefined) {
				preview?.post({type: 'unloadSource', sourceKey: previousKey});
			}
		},

		setStack(next, options = {}) {
			if (disposed) {
				return;
			}

			invalidate();
			request = next;
			if (options.dragging) {
				dragWanted = true;
				settleTimer = env.setTimeout(requestSettle, SETTLE_DELAY_MS);
			} else {
				settleWanted = true;
			}

			pump();
		},

		endDrag() {
			if (!disposed) {
				requestSettle();
			}
		},

		setViewScale(devicePixelsPerSourcePixel) {
			viewScale = devicePixelsPerSourcePixel;
			if (!disposed) {
				scheduleFull();
			}
		},

		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},

		exportImage(options) {
			const current = source;
			if (disposed || !current) {
				return {
					result: Promise.resolve({
						status: 'error',
						error: {code: 'internal', message: 'No image is loaded.'},
					}),
					cancel() {},
				};
			}

			let cancel = () => {};
			const result = new Promise<ExportOutcome>((resolve) => {
				cancel = startExport(current, options, resolve);
			});
			return {
				result,
				cancel() {
					cancel();
				},
			};
		},

		cancel() {
			if (disposed) {
				return;
			}

			invalidate();
			sentGeneration.settle = generation;
			for (const level of PREVIEW_LEVELS) {
				const job = inFlight[level];
				if (job) {
					job.discard = true;
				}
			}

			cancelBelow(generation);
		},

		retry() {
			if (disposed || !failed) {
				return;
			}

			failed = false;
			lastCrashAt = undefined;
			loadSource();
		},

		getState: () => ({
			generation,
			source: sourceInfo,
			frame,
			full,
			dragCap,
			failed,
		}),

		dispose() {
			if (disposed) {
				return;
			}

			stopSettleTimer();
			for (const level of PREVIEW_LEVELS) {
				finishJob(level);
			}

			discardFull();
			for (const cancel of cancelExports) {
				cancel();
			}

			preview?.terminate();
			preview = undefined;
			disposed = true;
			listeners.clear();
			sourceInfo?.original.close();
			frame?.bitmap.close();
			sourceInfo = undefined;
			frame = undefined;
		},
	};
}
