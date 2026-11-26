import type {ArchiveKind} from '../storage/archive-kind.ts';
import type {CodecErrorCode} from '../codec/decode.ts';
import type {ExportFormat} from '../codec/encode.ts';
import type {PipelineWarning} from '../engine/pipeline.ts';
import type {SourceTransform} from '../engine/transform.ts';
import type {EffectStack} from '../engine/types.ts';
import type {BackupErrorCode} from '../storage/backup-error.ts';
import type {
	BackupContents,
	BackupInput,
	BackupOutput,
} from '../storage/backup-format.ts';
import type {ProjectFileErrorCode} from '../storage/project-file-error.ts';
import type {
	ArchiveProgress,
	ProjectFileContents,
	ProjectFileInput,
	ProjectFileOutput,
} from '../storage/project-file.ts';

// Message types shared by the main thread and the workers (engine.md section 11).
// Import types only from here on the main thread: a value import of the engine,
// the codec or the archive code would pull them into the main bundle.

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
			// Missing means the identity (engine.md section 16.3).
			transform?: SourceTransform;
	  }
	| {
			// New geometry for the loaded source, answered by `sourceLoaded`.
			type: 'setTransform';
			requestId: number;
			sourceKey: string;
			transform: SourceTransform;
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
			// The image size after the transform.
			effective?: ProxySize;
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
			// Input of the render size rule (engine.md section 8.1), in (0, 1],
			// applied to the size after the transform.
			scale: number;
			transform?: SourceTransform;
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
			transform?: SourceTransform;
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

// The archive worker runs one job and is then terminated, which is also how a
// job is cancelled (persistence.md section 8.3.4).
export type ArchiveRequest =
	| {type: 'writeProject'; input: ProjectFileInput}
	| {type: 'readProject'; file: Blob; fileName: string}
	| {type: 'writeBackup'; input: BackupInput}
	| {type: 'readBackup'; file: Blob}
	| {type: 'readKind'; file: Blob};

export type ArchiveResponse =
	| ({type: 'progress'} & ArchiveProgress)
	| ({type: 'projectWritten'} & ProjectFileOutput)
	| {type: 'projectRead'; contents: ProjectFileContents}
	| ({type: 'backupWritten'} & BackupOutput)
	| {type: 'backupRead'; contents: BackupContents}
	| {type: 'kindRead'; kind: ArchiveKind}
	| {
			type: 'error';
			// Missing when the failure is not about the file or project itself.
			code?: ProjectFileErrorCode | BackupErrorCode;
			message: string;
	  };
