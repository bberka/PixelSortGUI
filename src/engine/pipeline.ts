import {compositeRows} from './composite.ts';
import {roundHalfAway} from './math.ts';
import {resolveInstance} from './params.ts';
import {
	canonicalStackJson,
	copyImage,
	type DebugView,
	type EffectDefinition,
	type EffectInstance,
	type EffectRegistry,
	type EffectStack,
	type ParamValue,
	type RenderContext,
	type RenderLevel,
	type RgbaImage,
} from './types.ts';

export type PipelineOptions = {
	level: RenderLevel;
	// Source image size. The `source` passed to `renderStack` is already at render size.
	sourceWidth: number;
	sourceHeight: number;
	debug?: {instanceId: string; view: 'selection'};
	cache?: StageCache;
	// Identifies the source image in stage cache keys. Defaults to `''`.
	sourceKey?: string;
	// Called between instances and by effects. Whatever it throws ends the render and is rethrown.
	checkpoint: () => void | Promise<void>;
	onProgress?: (fraction: number) => void;
};

export type PipelineWarning = {
	instanceId: string;
	code: 'unknown-type' | 'newer-version' | 'params-fixed';
};

export type PipelineResult = {
	// A new buffer owned by the caller. It never aliases the source, the cache or a working buffer.
	image: RgbaImage;
	// One entry per stack instance, same index. 0 for an instance that did not run.
	perInstanceMs: number[];
	warnings: PipelineWarning[];
};

export const STAGE_CACHE_MAX_ENTRIES = 6;
export const STAGE_CACHE_MAX_BYTES = 160 * 1024 * 1024;

export type StageCache = {
	// Marks the entry as most recently used. The returned image is shared: do not write to it.
	get(key: string): RgbaImage | undefined;
	// Takes ownership of `image`: the caller must not write to it afterwards.
	set(key: string, image: RgbaImage): void;
	clear(): void;
	readonly size: number;
	readonly byteLength: number;
};

/**
 Least-recently-used cache of pipeline stage outputs (engine.md section 8.5).
 It evicts until both limits hold. An image larger than `maxBytes` is not stored.
 */
export function createStageCache(
	limits: {maxEntries?: number; maxBytes?: number} = {},
): StageCache {
	const maxEntries = limits.maxEntries ?? STAGE_CACHE_MAX_ENTRIES;
	const maxBytes = limits.maxBytes ?? STAGE_CACHE_MAX_BYTES;
	const entries = new Map<string, RgbaImage>();
	let byteLength = 0;

	const remove = (key: string) => {
		const image = entries.get(key);
		if (!image) {
			return;
		}

		byteLength -= image.data.byteLength;
		entries.delete(key);
	};

	return {
		get(key) {
			const image = entries.get(key);
			if (image) {
				entries.delete(key);
				entries.set(key, image);
			}

			return image;
		},
		set(key, image) {
			remove(key);
			if (image.data.byteLength > maxBytes || maxEntries < 1) {
				return;
			}

			entries.set(key, image);
			byteLength += image.data.byteLength;
			for (const oldest of entries.keys()) {
				if (entries.size <= maxEntries && byteLength <= maxBytes) {
					break;
				}

				remove(oldest);
			}
		},
		clear() {
			entries.clear();
			byteLength = 0;
		},
		get size() {
			return entries.size;
		},
		get byteLength() {
			return byteLength;
		},
	};
}

/**
 Cache key for the output after the last instance of `enabledPrefix`, which
 holds the enabled instances from index 0 up to and including that instance.
 */
export function stageCacheKey(
	level: RenderLevel,
	width: number,
	height: number,
	sourceKey: string,
	enabledPrefix: EffectStack,
): string {
	return `${level}:${width}x${height}:${sourceKey}:${canonicalStackJson(enabledPrefix)}`;
}

type Scratch = (slot: number, byteLength: number) => Uint8Array;

function createScratch(): Scratch {
	const buffers = new Map<number, Uint8Array>();
	return (slot, byteLength) => {
		let buffer = buffers.get(slot);
		if (!buffer || buffer.byteLength < byteLength) {
			buffer = new Uint8Array(byteLength);
			buffers.set(slot, buffer);
		}

		return buffer.byteLength === byteLength
			? buffer
			: buffer.subarray(0, byteLength);
	};
}

export type RenderContextInit = {
	level: RenderLevel;
	sourceWidth: number;
	sourceHeight: number;
	// Width of the image being rendered. `scale` is `renderWidth / sourceWidth`.
	renderWidth: number;
	seed?: number;
	debugView?: DebugView;
	checkpoint?: () => void | Promise<void>;
	progress?: (fraction: number) => void;
};

function buildContext(
	init: RenderContextInit,
	scratch: Scratch,
): RenderContext {
	const scale = init.renderWidth / init.sourceWidth;
	const px = (sourcePx: number) => roundHalfAway(sourcePx * scale);
	return {
		level: init.level,
		sourceWidth: init.sourceWidth,
		sourceHeight: init.sourceHeight,
		scale,
		seed: init.seed ?? 0,
		px,
		pxLength: (sourcePx) => (sourcePx <= 0 ? 0 : Math.max(1, px(sourcePx))),
		toSource: (renderCoord) => Math.floor((renderCoord + 0.5) / scale),
		checkpoint: init.checkpoint ?? (() => undefined),
		progress: init.progress ?? (() => undefined),
		scratch,
		debugView: init.debugView ?? 'none',
	};
}

// The context `renderStack` gives an effect, for calling `render` directly (tests, benchmarks).
export function createRenderContext(init: RenderContextInit): RenderContext {
	return buildContext(init, createScratch());
}

// Working buffers of the most recent render size, kept between renders. A
// render takes its buffers out of the pool and returns them when it ends, so
// overlapping renders never share one.
const MAX_POOLED = 2;
let pool: Uint8ClampedArray[] = [];

function acquireWorkingImage(width: number, height: number): RgbaImage {
	const length = width * height * 4;
	if (pool.length > 0 && pool[0].length !== length) {
		pool = [];
	}

	return {width, height, data: pool.pop() ?? new Uint8ClampedArray(length)};
}

function releaseWorkingImage(image: RgbaImage): void {
	if (pool.length > 0 && pool[0].length !== image.data.length) {
		pool = [];
	}

	if (pool.length < MAX_POOLED) {
		pool.push(image.data);
	}
}

type Step = {
	index: number;
	instance: EffectInstance;
	definition: EffectDefinition;
	params: Record<string, ParamValue>;
	isDebug: boolean;
	cacheKey: string | undefined;
	// Enabled instances before this one, skipped ones included.
	enabledBefore: number;
};

const CHECKPOINT_PIXELS = 16_384;

/**
 Runs the enabled instances of `stack` over `source` in order.
 Copies: `source` and `stack` are only read. Each instance renders from the
 previous result into one of two working buffers, with no defensive copy of
 its input, so an effect that wrote to its input would corrupt the source or a
 cache entry. A stage cache gets its own copy of each stage output, and the
 returned image is always a fresh copy.
 Cancellation: `options.checkpoint` runs before every instance and inside
 compositing, and effects call it through the context. Whatever it throws
 rejects the returned promise; nothing partial reaches the cache.
 */
export async function renderStack(
	source: RgbaImage,
	stack: EffectStack,
	registry: EffectRegistry,
	options: PipelineOptions,
): Promise<PipelineResult> {
	const {width, height} = source;
	if (source.data.length !== width * height * 4) {
		throw new RangeError(
			`Source data length ${source.data.length} does not match ${width}x${height}`,
		);
	}

	const {cache, debug, checkpoint, onProgress} = options;
	const warnings: PipelineWarning[] = [];
	const perInstanceMs = stack.instances.map(() => 0);

	const steps: Step[] = [];
	const enabled: EffectInstance[] = [];
	for (const [index, instance] of stack.instances.entries()) {
		if (!instance.enabled) {
			continue;
		}

		const enabledBefore = enabled.length;
		enabled.push(instance);
		const resolved = resolveInstance(instance, registry);
		if (resolved.status !== 'ok') {
			warnings.push({instanceId: instance.id, code: resolved.status});
			continue;
		}

		if (resolved.fixed) {
			warnings.push({instanceId: instance.id, code: 'params-fixed'});
		}

		const isDebug = debug?.instanceId === instance.id;
		steps.push({
			index,
			instance,
			definition: resolved.definition,
			params: resolved.params,
			isDebug,
			enabledBefore,
			cacheKey:
				cache && !isDebug
					? stageCacheKey(
							options.level,
							width,
							height,
							options.sourceKey ?? '',
							{...stack, instances: [...enabled]},
						)
					: undefined,
		});
		if (isDebug) {
			break;
		}
	}

	let current = source;
	let firstStep = 0;
	if (cache) {
		for (let s = steps.length - 1; s >= 0; s--) {
			const key = steps[s].cacheKey;
			const hit = key === undefined ? undefined : cache.get(key);
			if (hit) {
				current = hit;
				firstStep = s + 1;
				break;
			}
		}
	}

	const enabledCount = stack.instances.filter((item) => item.enabled).length;
	let reported = -1;
	const report = (fraction: number) => {
		if (!(onProgress && fraction >= reported)) {
			return;
		}

		reported = fraction;
		onProgress(fraction);
	};

	const scratch = createScratch();
	const working: RgbaImage[] = [];
	const rowsPerSlice = Math.max(1, Math.ceil(CHECKPOINT_PIXELS / width));
	try {
		for (let s = firstStep; s < steps.length; s++) {
			const {
				index,
				instance,
				definition,
				params,
				isDebug,
				cacheKey,
				enabledBefore,
			} = steps[s];
			const pending = checkpoint();
			if (pending) {
				await pending;
			}

			const started = performance.now();
			const slot = (s - firstStep) % 2;
			working[slot] ??= acquireWorkingImage(width, height);
			const output = working[slot];
			const debugView: DebugView =
				isDebug && definition.debugViews?.includes(debug!.view)
					? debug!.view
					: 'none';
			const ctx = buildContext(
				{
					level: options.level,
					sourceWidth: options.sourceWidth,
					sourceHeight: options.sourceHeight,
					renderWidth: width,
					seed: typeof params.seed === 'number' ? params.seed : 0,
					debugView,
					checkpoint,
					progress(fraction) {
						report(
							(enabledBefore + Math.min(Math.max(fraction, 0), 1)) /
								enabledCount,
						);
					},
				},
				scratch,
			);

			const rendering = definition.render(current, output, params, ctx);
			if (rendering) {
				await rendering;
			}

			if (
				debugView === 'none' &&
				(instance.mix < 1 || instance.blend !== 'normal')
			) {
				for (let row = 0; row < height; row += rowsPerSlice) {
					const sliced = checkpoint();
					if (sliced) {
						await sliced;
					}

					compositeRows(
						current,
						output,
						instance.mix,
						instance.blend,
						row,
						Math.min(height, row + rowsPerSlice),
					);
				}
			}

			current = output;
			if (cache && !debug && cacheKey !== undefined) {
				cache.set(cacheKey, copyImage(output));
			}

			perInstanceMs[index] = performance.now() - started;
			report((enabledBefore + 1) / enabledCount);
		}

		if (reported < 1) {
			report(1);
		}

		return {image: copyImage(current), perInstanceMs, warnings};
	} finally {
		for (const image of working) {
			releaseWorkingImage(image);
		}
	}
}
