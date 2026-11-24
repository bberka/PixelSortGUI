import {decodeImage, isMemoryError, renderSize} from '../codec/decode.ts';
import {encodeImage} from '../codec/encode.ts';
import {effectRegistry} from '../engine/effects/index.ts';
import {renderStack} from '../engine/pipeline.ts';
import type {RgbaImage} from '../engine/types.ts';
import {
	FULL_TILE_SIZE,
	type EngineErrorCode,
	type ExportRequest,
	type ExportResponse,
	type ExportStage,
	type FullTile,
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
} & StackRequest;

function postProgress(jobId: number, stage: ExportStage, fraction: number) {
	scope.postMessage({type: 'progress', jobId, stage, fraction});
}

// This worker is cancelled by terminating it, so the render never yields.
async function decodeAndRender(job: Job): Promise<RgbaImage> {
	const {jobId, sourceWidth, sourceHeight} = job;
	postProgress(jobId, 'decode', 0);
	const size = renderSize(sourceWidth, sourceHeight, job.scale);
	const decoded = await decodeImage(
		job.blob,
		size.width < sourceWidth || size.height < sourceHeight
			? {resizeWidth: size.width, resizeHeight: size.height}
			: {},
	);
	if (!decoded.ok) {
		throw new JobError(decoded.error.code, decoded.error.message);
	}

	postProgress(jobId, 'decode', 1);
	postProgress(jobId, 'render', 0);
	let lastProgress = performance.now();
	const result = await renderStack(decoded.value, job.stack, effectRegistry, {
		level: 'full',
		sourceWidth,
		sourceHeight,
		debug: job.debug,
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
		const encoded = await encodeImage(image, {
			format: message.format,
			quality: message.quality,
		});
		if (!encoded.ok) {
			throw new JobError(encoded.error.code, encoded.error.message);
		}

		postProgress(jobId, 'encode', 1);
		const {blob, width, height, mime} = encoded.value;
		scope.postMessage({
			type: 'exported',
			jobId,
			file: blob,
			width,
			height,
			mime,
			totalMs: performance.now() - started,
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
