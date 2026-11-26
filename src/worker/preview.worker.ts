import {
	decodeImage,
	isMemoryError,
	renderSizeForPixelCap,
} from '../codec/decode.ts';
import {runtimeEffectRegistry as effectRegistry} from '../engine/effects/runtime.ts';
import {createStageCache, renderStack} from '../engine/pipeline.ts';
import {boxDownscale} from '../engine/resample.ts';
import {
	applyTransform,
	IDENTITY_TRANSFORM,
	transformKey,
	type Size,
	type SourceTransform,
} from '../engine/transform.ts';
import {Cancelled, type ExtraSource, type RgbaImage} from '../engine/types.ts';
import {checkedDimensions, isIdentity, planProxy} from './geometry.ts';
import {
	DRAG_PIXEL_CAP_MAX,
	SETTLE_PIXEL_CAP,
	type EngineErrorCode,
	type PreviewRequest,
	type PreviewResponse,
} from './protocol.ts';

type RenderRequest = Extract<PreviewRequest, {type: 'render'}>;
type LoadRequest = Extract<PreviewRequest, {type: 'loadSource'}>;
type LoadExtraRequest = Extract<PreviewRequest, {type: 'loadExtraSource'}>;
// What the last `loadSource` asked for, as changed by `setTransform` and `setDragCap`.
type Wanted = Omit<LoadRequest, 'type' | 'requestId' | 'transform'> & {
	transform: SourceTransform;
};

type WorkerScope = {
	postMessage(message: PreviewResponse, transfer?: Transferable[]): void;
	addEventListener(
		type: 'message',
		listener: (event: MessageEvent<PreviewRequest>) => void,
	): void;
};

type Source = {
	key: string;
	// The key plus the transform, for the stage cache.
	cacheKey: string;
	// The image size after the transform.
	width: number;
	height: number;
	settle: RgbaImage;
	drag: RgbaImage;
};

type Extra = {
	// Size of the stored image.
	sourceWidth: number;
	sourceHeight: number;
	// Missing while the file is being decoded.
	proxies?: {settle: RgbaImage; drag: RgbaImage};
};

const scope = globalThis as unknown as WorkerScope;

const SLICE_MS = 8;
const PROGRESS_INTERVAL_MS = 50;

// A MessageChannel round trip yields to the event loop without the 4 ms clamp
// of nested timers, so queued `render` and `cancel` messages are handled.
const yieldChannel = new MessageChannel();
let resolveYield: (() => void) | undefined;
yieldChannel.port1.addEventListener('message', () => {
	const resolve = resolveYield;
	resolveYield = undefined;
	resolve?.();
});
yieldChannel.port1.start();

function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => {
		resolveYield = resolve;
		yieldChannel.port2.postMessage(undefined);
	});
}

let cache = createStageCache();
// Extra sources by SHA-256. They do not depend on the project source.
const extras = new Map<string, Extra>();
// Extra sources are decoded one at a time to bound the memory of full decodes.
let extraDecodes = Promise.resolve();
let dragCap = DRAG_PIXEL_CAP_MAX;
let wanted: Wanted | undefined;
let source: Source | undefined;
let loadCount = 0;
let newestGeneration = 0;
let running = false;
const pending = new Map<RenderRequest['level'], RenderRequest>();

function toImageData(image: RgbaImage): ImageData {
	return new ImageData(
		image.data as Uint8ClampedArray<ArrayBuffer>,
		image.width,
		image.height,
	);
}

function errorCode(error: unknown): EngineErrorCode {
	return isMemoryError(error) ? 'out-of-memory' : 'internal';
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function deriveDrag(
	settle: RgbaImage,
	width: number,
	height: number,
	pixels: number,
): RgbaImage {
	const size = renderSizeForPixelCap(width, height, pixels);
	return size.width >= settle.width || size.height >= settle.height
		? settle
		: boxDownscale(settle, size.width, size.height);
}

function isStale(request: RenderRequest): boolean {
	return (
		request.generation < newestGeneration || request.sourceKey !== source?.key
	);
}

/**
 Decodes the wanted source, applies its transform once and keeps the `settle`
 and `drag` proxies of the result.
 */
async function loadProxies(requestId: number, spec: Wanted): Promise<void> {
	const {sourceKey, sourceWidth, sourceHeight, transform} = spec;
	loadCount++;
	const load = loadCount;
	source = undefined;
	cache.clear();
	try {
		const effective = checkedDimensions(sourceWidth, sourceHeight, transform);
		if ('error' in effective) {
			scope.postMessage({
				type: 'error',
				requestId,
				code: 'internal',
				message: effective.error,
			});
			return;
		}

		const {width, height} = effective.size;
		const target: Size = renderSizeForPixelCap(width, height, spec.caps.settle);
		const plan = planProxy(sourceWidth, sourceHeight, transform, target);
		const decoded = await decodeImage(
			spec.blob,
			plan.decode.width < sourceWidth || plan.decode.height < sourceHeight
				? {resizeWidth: plan.decode.width, resizeHeight: plan.decode.height}
				: {},
		);
		if (load !== loadCount) {
			return;
		}

		if (!decoded.ok) {
			const {code, message} = decoded.error;
			scope.postMessage({type: 'error', requestId, code, message});
			return;
		}

		const settle = isIdentity(transform)
			? decoded.value
			: applyTransform(decoded.value, plan.transform);
		const drag = deriveDrag(settle, width, height, spec.caps.drag);
		const original = await createImageBitmap(toImageData(settle));
		if (load !== loadCount) {
			original.close();
			return;
		}

		source = {
			key: sourceKey,
			cacheKey: `${sourceKey}:${transformKey(transform)}`,
			width,
			height,
			settle,
			drag,
		};
		scope.postMessage(
			{
				type: 'sourceLoaded',
				requestId,
				sourceKey,
				settle: {width: settle.width, height: settle.height},
				drag: {width: drag.width, height: drag.height},
				effective: {width, height},
				original,
			},
			[original],
		);
	} catch (error) {
		if (load === loadCount) {
			scope.postMessage({
				type: 'error',
				requestId,
				code: errorCode(error),
				message: errorMessage(error),
			});
		}
	}
}

async function loadExtra(
	request: LoadExtraRequest,
	extra: Extra,
): Promise<void> {
	const {requestId, sha256, blob} = request;
	const {sourceWidth, sourceHeight} = extra;
	// Unloaded, or unloaded and asked for again, since it was queued.
	const superseded = () => extras.get(sha256) !== extra;
	if (superseded()) {
		return;
	}

	const fail = (code: EngineErrorCode, message: string) => {
		extras.delete(sha256);
		scope.postMessage({type: 'error', requestId, code, message});
	};

	try {
		const target = renderSizeForPixelCap(
			sourceWidth,
			sourceHeight,
			SETTLE_PIXEL_CAP,
		);
		const decoded = await decodeImage(
			blob,
			target.width < sourceWidth || target.height < sourceHeight
				? {resizeWidth: target.width, resizeHeight: target.height}
				: {},
		);
		if (superseded()) {
			return;
		}

		if (!decoded.ok) {
			fail(decoded.error.code, decoded.error.message);
			return;
		}

		const settle = decoded.value;
		const drag = deriveDrag(settle, sourceWidth, sourceHeight, dragCap);
		extra.proxies = {settle, drag};
		scope.postMessage({type: 'extraSourceLoaded', requestId, sha256});
	} catch (error) {
		if (!superseded()) {
			fail(errorCode(error), errorMessage(error));
		}
	}
}

// The extra sources loaded now, at the proxy of `level`.
function loadedExtras(level: RenderRequest['level']): Map<string, ExtraSource> {
	const loaded = new Map<string, ExtraSource>();
	for (const [sha256, {proxies, sourceWidth, sourceHeight}] of extras) {
		if (!proxies) {
			continue;
		}

		loaded.set(sha256, {...proxies[level], sourceWidth, sourceHeight});
	}

	return loaded;
}

// Remakes every `drag` proxy for a new cap.
function applyDragCap(pixels: number): void {
	dragCap = pixels;
	try {
		if (source) {
			const {settle, width, height, drag} = source;
			const next = deriveDrag(settle, width, height, pixels);
			if (next.width !== drag.width || next.height !== drag.height) {
				source.drag = next;
				cache.clear();
			}
		}

		for (const {proxies, sourceWidth, sourceHeight} of extras.values()) {
			if (!proxies) {
				continue;
			}

			const {settle, drag} = proxies;
			const next = deriveDrag(settle, sourceWidth, sourceHeight, pixels);
			if (next.width === drag.width && next.height === drag.height) {
				continue;
			}

			proxies.drag = next;
			// Stage keys do not name this size (engine.md section 8.5).
			cache = createStageCache();
		}
	} catch (error) {
		scope.postMessage({
			type: 'error',
			code: errorCode(error),
			message: errorMessage(error),
		});
	}
}

async function runRender(request: RenderRequest, from: Source): Promise<void> {
	const {jobId, generation, level} = request;
	const started = performance.now();
	let lastYield = started;
	let lastProgress = started;

	const throwIfStale = () => {
		if (isStale(request)) {
			throw new Cancelled();
		}
	};

	const checkpoint = (): void | Promise<void> => {
		throwIfStale();
		if (performance.now() - lastYield < SLICE_MS) {
			return undefined;
		}

		return yieldToEventLoop().then(() => {
			lastYield = performance.now();
			throwIfStale();
		});
	};

	try {
		const result = await renderStack(
			level === 'drag' ? from.drag : from.settle,
			request.stack,
			effectRegistry,
			{
				level,
				sourceWidth: from.width,
				sourceHeight: from.height,
				debug: request.debug,
				cache,
				sourceKey: from.cacheKey,
				// A snapshot: loads and unloads during the render do not reach it.
				extraSources: loadedExtras(level),
				checkpoint,
				onProgress(fraction) {
					const now = performance.now();
					if (!(now - lastProgress >= PROGRESS_INTERVAL_MS)) {
						return;
					}

					lastProgress = now;
					scope.postMessage({type: 'progress', jobId, fraction});
				},
			},
		);
		const {width, height} = result.image;
		const bitmap = await createImageBitmap(toImageData(result.image));
		if (isStale(request)) {
			bitmap.close();
			throw new Cancelled();
		}

		scope.postMessage(
			{
				type: 'rendered',
				jobId,
				generation,
				level,
				width,
				height,
				bitmap,
				totalMs: performance.now() - started,
				perInstanceMs: result.perInstanceMs,
				warnings: result.warnings,
			},
			[bitmap],
		);
	} catch (error) {
		scope.postMessage(
			error instanceof Cancelled
				? {type: 'cancelled', jobId}
				: {
						type: 'error',
						jobId,
						code: errorCode(error),
						message: errorMessage(error),
					},
		);
	}
}

function takeNext(): RenderRequest | undefined {
	const level = pending.has('drag') ? 'drag' : 'settle';
	const request = pending.get(level);
	pending.delete(level);
	return request;
}

async function pump(): Promise<void> {
	if (running) {
		return;
	}

	running = true;
	try {
		for (let next = takeNext(); next; next = takeNext()) {
			if (isStale(next) || !source) {
				scope.postMessage({type: 'cancelled', jobId: next.jobId});
				continue;
			}

			await runRender(next, source);
		}
	} finally {
		running = false;
	}
}

function dropStalePending(): void {
	for (const [level, request] of pending) {
		if (!isStale(request)) {
			continue;
		}

		pending.delete(level);
		scope.postMessage({type: 'cancelled', jobId: request.jobId});
	}
}

scope.addEventListener('message', (event) => {
	const message = event.data;
	switch (message.type) {
		case 'loadSource': {
			const {
				type,
				requestId,
				transform = IDENTITY_TRANSFORM,
				...rest
			} = message;
			wanted = {...rest, transform};
			void loadProxies(requestId, wanted);
			applyDragCap(wanted.caps.drag);

			dropStalePending();
			break;
		}

		case 'setTransform': {
			const {requestId, sourceKey, transform} = message;
			if (wanted?.sourceKey !== sourceKey) {
				scope.postMessage({
					type: 'error',
					requestId,
					code: 'internal',
					message: 'No source is loaded for this transform.',
				});
				break;
			}

			wanted = {...wanted, transform};
			void loadProxies(requestId, wanted);
			dropStalePending();
			break;
		}

		case 'render': {
			newestGeneration = Math.max(newestGeneration, message.generation);
			const replaced = pending.get(message.level);
			if (replaced) {
				scope.postMessage({type: 'cancelled', jobId: replaced.jobId});
			}

			pending.set(message.level, message);
			dropStalePending();
			void pump();
			break;
		}

		case 'cancel': {
			newestGeneration = Math.max(newestGeneration, message.belowGeneration);
			dropStalePending();
			break;
		}

		case 'setDragCap': {
			if (wanted) {
				wanted.caps = {...wanted.caps, drag: message.pixels};
			}

			applyDragCap(message.pixels);
			break;
		}

		case 'unloadSource': {
			if (wanted?.sourceKey === message.sourceKey) {
				wanted = undefined;
				// A decode still in flight must not bring the source back.
				loadCount++;
				source = undefined;
				cache.clear();
				dropStalePending();
			}

			break;
		}

		case 'loadExtraSource': {
			const {requestId, sha256, sourceWidth, sourceHeight} = message;
			// The hash names the bytes, so a loaded source never needs a new decode.
			if (extras.get(sha256)?.proxies) {
				scope.postMessage({type: 'extraSourceLoaded', requestId, sha256});
				break;
			}

			const extra: Extra = {sourceWidth, sourceHeight};
			extras.set(sha256, extra);
			extraDecodes = extraDecodes.then(async () => loadExtra(message, extra));
			break;
		}

		case 'unloadExtraSource': {
			if (extras.delete(message.sha256)) {
				cache = createStageCache();
			}

			break;
		}
	}
});
