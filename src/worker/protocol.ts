import type {CodecErrorCode} from '../codec/decode.ts';
import type {ExportFormat} from '../codec/encode.ts';
import type {PipelineWarning} from '../engine/pipeline.ts';
import type {EffectStack} from '../engine/types.ts';

// Message types shared by the main thread and both workers (engine.md section 11).
// Import types only from here on the main thread: a value import of the engine
// or the codec would pull them into the main bundle.

export const SETTLE_PIXEL_CAP = 4_194_304;
export const DRAG_PIXEL_CAP_MAX = 1_048_576;
export const DRAG_PIXEL_CAP_MIN = 131_072;
export const FULL_TILE_SIZE = 2048;

export type StackRequest = {
	stack: EffectStack;
	debug?: {instanceId: string; view: 'selection'};
};

export type PreviewLevel = 'drag' | 'settle';

export type EngineErrorCode = CodecErrorCode | 'internal';

export type ProxySize = {width: number; height: number};

export type PreviewRequest =
	| {
			type: 'loadSource';
			requestId: number;
			sourceKey: string;
			blob: Blob;
			sourceWidth: number;
			sourceHeight: number;
			caps: {drag: number; settle: number};
	  }
	| ({
			type: 'render';
			jobId: number;
			generation: number;
			sourceKey: string;
			level: PreviewLevel;
	  } & StackRequest)
	| {type: 'cancel'; belowGeneration: number}
	| {type: 'setDragCap'; pixels: number}
	| {type: 'unloadSource'; sourceKey: string};

export type PreviewResponse =
	| {
			type: 'sourceLoaded';
			requestId: number;
			sourceKey: string;
			settle: ProxySize;
			drag: ProxySize;
			original: ImageBitmap;
	  }
	| {type: 'progress'; jobId: number; fraction: number}
	| {
			type: 'rendered';
			jobId: number;
			generation: number;
			level: PreviewLevel;
			width: number;
			height: number;
			bitmap: ImageBitmap;
			totalMs: number;
			perInstanceMs: number[];
			warnings: PipelineWarning[];
	  }
	| {type: 'cancelled'; jobId: number}
	| {
			type: 'error';
			jobId?: number;
			requestId?: number;
			code: EngineErrorCode;
			message: string;
	  };

export type ExportStage = 'decode' | 'render' | 'encode';

export type FullTile = {x: number; y: number; bitmap: ImageBitmap};

export type ExportRequest =
	| ({
			type: 'export';
			jobId: number;
			blob: Blob;
			sourceWidth: number;
			sourceHeight: number;
			// Input of the render size rule (engine.md section 8.1), in (0, 1].
			scale: number;
			format: ExportFormat;
			// 0..100. Ignored for PNG.
			quality: number;
			// Optional maximum output file size in KB (10..102400).
			maxFileSizeKb?: number | null;
	  } & StackRequest)
	| ({
			type: 'renderFull';
			jobId: number;
			generation: number;
			blob: Blob;
			sourceWidth: number;
			sourceHeight: number;
	  } & StackRequest);

export type ExportResponse =
	| {type: 'progress'; jobId: number; stage: ExportStage; fraction: number}
	| {
			type: 'exported';
			jobId: number;
			file: Blob;
			width: number;
			height: number;
			mime: string;
			totalMs: number;
			effectiveQuality?: number;
			targetMet?: boolean;
	  }
	| {
			type: 'fullRendered';
			jobId: number;
			generation: number;
			width: number;
			height: number;
			tiles: FullTile[];
	  }
	| {type: 'error'; jobId: number; code: EngineErrorCode; message: string};
