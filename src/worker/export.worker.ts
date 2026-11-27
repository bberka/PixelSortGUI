import {decodeImage, isMemoryError, renderSize} from '../codec/decode.ts';
import {encodeImage, type AvifEncoder} from '../codec/encode.ts';
import {runtimeEffectRegistry as effectRegistry} from '../engine/effects/runtime.ts';
import {MaskAssetError} from '../engine/mask/asset.ts';
import type {MaskBitmap} from '../engine/mask/types.ts';
import {renderStack} from '../engine/pipeline.ts';
import {
	applyTransform,
	IDENTITY_TRANSFORM,
	type Size,
	type SourceTransform,
} from '../engine/transform.ts';
import type {ExtraSource, RgbaImage} from '../engine/types.ts';
import {checkedDimensions, exportTransform, isIdentity} from './geometry.ts';
import {decodeMaskFile} from './mask-decode.ts';
import {
	FULL_TILE_SIZE,
	type EngineErrorCode,
	type ExportRequest,
	type ExportResponse,
	type ExportStage,
	type ExtraSourceFile,
	type FullTile,
	type MaskFile,
	type StackRequest,
} from './protocol.ts';

type WorkerScope = {
	postMessage(message: ExportResponse, transfer?: Transferable[]): void;
	addEventListener(
		type: 'message',
		listener: (event: MessageEvent<ExportRequest>) => void,
	): void;
};

const scope = globalThis as unknown as WorkerScope;

const PROGRESS_INTERVAL_MS = 50;

class JobError extends Error {
	constructor(
		readonly code: EngineErrorCode,
		message: string,
	) {
		super(message);
	}
}

type Job = {
	jobId: number;
	blob: Blob;
	sourceWidth: number;
	sourceHeight: number;
	scale: number;
	transform?: SourceTransform;
	extraSources?: readonly ExtraSourceFile[];
	masks?: readonly MaskFile[];
} & StackRequest;

// Imported on first use: the AVIF encoder is a 3.4 MB Wasm file.
const encodeAvif: AvifEncoder = async (image, quality) => {
	const avif = await import('../codec/avif.ts');
	return avif.encodeAvif(image, quality);
};

function postProgress(jobId: number, stage: ExportStage, fraction: number) {
	scope.postMessage({type: 'progress', jobId, stage, fraction});
}

async function decode(blob: Blob, resize?: Size): Promise<RgbaImage> {
	const decoded = await decodeImage(
		blob,
		resize ? {resizeWidth: resize.width, resizeHeight: resize.height} : {},
	);
	if (!decoded.ok) {
		throw new JobError(decoded.error.code, decoded.error.message);
	}

	return decoded.value;
}

/**
 The effective image at export size (engine.md section 16.3), with the size the
 effects count their pixels in. The full decode is released on return.
 */
async function decodeSource(
	job: Job,
): Promise<{image: RgbaImage; effective: Size}> {
	const {blob, sourceWidth, sourceHeight} = job;
	const transform = job.transform ?? IDENTITY_TRANSFORM;
	const checked = checkedDimensions(sourceWidth, sourceHeight, transform);
	if ('error' in checked) {
		throw new JobError('internal', checked.error);
	}

	const effective = checked.size;
	const size = renderSize(effective.width, effective.height, job.scale);
	if (isIdentity(transform)) {
		const smaller = size.width < sourceWidth || size.height < sourceHeight;
		return {image: await decode(blob, smaller ? size : undefined), effective};
	}

	const full = await decode(blob);
	return {
		image: applyTransform(full, exportTransform(transform, size)),
		effective,
	};
}

// Each extra source at the export scale (engine.md section 16.5), one at a time.
async function decodeExtras(job: Job): Promise<Map<string, ExtraSource>> {
	const files = job.extraSources ?? [];
	const decoded = new Map<string, ExtraSource>();
	for (const [index, file] of files.entries()) {
		const {sha256, blob, sourceWidth, sourceHeight} = file;
		// The project source was the first of the `files.length + 1` decodes.
		postProgress(job.jobId, 'decode', (index + 1) / (files.length + 1));
		const size = renderSize(sourceWidth, sourceHeight, job.scale);
		const smaller = size.width < sourceWidth || size.height < sourceHeight;
		const image = await decode(blob, smaller ? size : undefined);
		decoded.set(sha256, {...image, sourceWidth, sourceHeight});
	}

	return decoded;
}

// One at a time. A grid is at most 4 MP and is fitted to the export size by the render.
async function decodeMasks(job: Job): Promise<Map<string, MaskBitmap>> {
	const decoded = new Map<string, MaskBitmap>();
	for (const file of job.masks ?? []) {
		try {
			decoded.set(file.sha256, await decodeMaskFile(file));
		} catch (error) {
			throw error instanceof MaskAssetError
				? new JobError('decode-failed', error.message)
				: error;
		}
	}

	return decoded;
}

// This worker is cancelled by terminating it, so the render never yields.
async function decodeAndRender(job: Job): Promise<RgbaImage> {
	const {jobId} = job;
	postProgress(jobId, 'decode', 0);
	const {image, effective} = await decodeSource(job);
	const extraSources = await decodeExtras(job);
	const masks = await decodeMasks(job);
	postProgress(jobId, 'decode', 1);
	postProgress(jobId, 'render', 0);
	let lastProgress = performance.now();
	const result = await renderStack(image, job.stack, effectRegistry, {
		level: 'full',
		sourceWidth: effective.width,
		sourceHeight: effective.height,
		debug: job.debug,
		extraSources,
		masks,
		geometry: {
			sourceWidth: job.sourceWidth,
			sourceHeight: job.sourceHeight,
			transform: job.transform ?? IDENTITY_TRANSFORM,
		},
		checkpoint: () => undefined,
		onProgress(fraction) {
			const now = performance.now();
			if (!(fraction < 1 && now - lastProgress >= PROGRESS_INTERVAL_MS)) {
				return;
			}

			lastProgress = now;
			postProgress(jobId, 'render', fraction);
		},
	});
	postProgress(jobId, 'render', 1);
	return result.image;
}

async function cutTiles(image: RgbaImage): Promise<FullTile[]> {
	const imageData = new ImageData(
		image.data as Uint8ClampedArray<ArrayBuffer>,
		image.width,
		image.height,
	);
	const tiles: FullTile[] = [];
	try {
		for (let y = 0; y < image.height; y += FULL_TILE_SIZE) {
			for (let x = 0; x < image.width; x += FULL_TILE_SIZE) {
				const bitmap = await createImageBitmap(
					imageData,
					x,
					y,
					Math.min(FULL_TILE_SIZE, image.width - x),
					Math.min(FULL_TILE_SIZE, image.height - y),
				);
				tiles.push({x, y, bitmap});
			}
		}
	} catch (error) {
		for (const tile of tiles) {
			tile.bitmap.close();
		}

		throw error;
	}

	return tiles;
}

async function handle(message: ExportRequest): Promise<void> {
	const {jobId} = message;
	const started = performance.now();
	try {
		if (message.type === 'renderFull') {
			const image = await decodeAndRender({...message, scale: 1});
			const tiles = await cutTiles(image);
			scope.postMessage(
				{
					type: 'fullRendered',
					jobId,
					generation: message.generation,
					width: image.width,
					height: image.height,
					tiles,
				},
				tiles.map((tile) => tile.bitmap),
			);
			return;
		}

		const image = await decodeAndRender(message);
		postProgress(jobId, 'encode', 0);
		const maxBytes =
			typeof message.maxFileSizeKb === 'number' &&
			Number.isFinite(message.maxFileSizeKb) &&
			message.maxFileSizeKb > 0
				? message.maxFileSizeKb * 1024
				: undefined;
		const encoded = await encodeImage(image, {
			format: message.format,
			quality: message.quality,
			maxBytes,
			encodeAvif,
			onProgress(fraction) {
				postProgress(jobId, 'encode', fraction);
			},
		});
		if (!encoded.ok) {
			throw new JobError(encoded.error.code, encoded.error.message);
		}

		postProgress(jobId, 'encode', 1);
		const {blob, width, height, mime, effectiveQuality, targetMet} =
			encoded.value;
		scope.postMessage({
			type: 'exported',
			jobId,
			file: blob,
			width,
			height,
			mime,
			totalMs: performance.now() - started,
			effectiveQuality,
			targetMet,
		});
	} catch (error) {
		scope.postMessage({
			type: 'error',
			jobId,
			code:
				error instanceof JobError
					? error.code
					: isMemoryError(error)
						? 'out-of-memory'
						: 'internal',
			message: error instanceof Error ? error.message : String(error),
		});
	}
}

scope.addEventListener('message', (event) => {
	void handle(event.data);
});
