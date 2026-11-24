import type {
	PhaseBreakdown,
	PixelSortStats,
	SortAlgorithm,
	SortAngle,
} from './kernel.ts';

export type WorkerRequest =
	| {
			type: 'prepare';
			requestId: number;
			width: number;
			height: number;
			analyzeAngle?: SortAngle;
	  }
	| {
			type: 'render';
			jobId: number;
			generation: number;
			width: number;
			height: number;
			angle: SortAngle;
			algorithm: SortAlgorithm;
			collectBreakdown: boolean;
			returnBitmap: boolean;
	  }
	| {
			type: 'cancel';
			belowGeneration: number;
	  }
	| {
			type: 'release';
			requestId: number;
	  };

export type WorkerResponse =
	| {
			type: 'prepared';
			requestId: number;
			width: number;
			height: number;
			generateMs: number;
			stats?: PixelSortStats;
			jsHeapUsedBytes?: number;
	  }
	| {
			type: 'rendered';
			jobId: number;
			generation: number;
			kernelMs: number;
			bitmapMs: number;
			totalWorkerMs: number;
			yieldCount: number;
			breakdown?: PhaseBreakdown;
			bitmap?: ImageBitmap;
			jsHeapUsedBytes?: number;
	  }
	| {
			type: 'cancelled';
			jobId: number;
			generation: number;
			yieldCount: number;
	  }
	| {
			type: 'released';
			requestId: number;
	  }
	| {
			type: 'error';
			jobId?: number;
			requestId?: number;
			message: string;
	  };
