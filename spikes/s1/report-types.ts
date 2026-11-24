import type {PixelSortStats, SortAlgorithm, SortAngle} from './kernel.ts';

export type PercentileSummary = {
	runs: number;
	min: number;
	p50: number;
	p95: number;
	max: number;
	mean: number;
};

export type ThroughputEntry = {
	label: string;
	width: number;
	height: number;
	megapixels: number;
	angle: SortAngle;
	algorithm: SortAlgorithm;
	kernelMs: PercentileSummary;
	totalWorkerMs: PercentileSummary;
	throughputP50Mps: number;
	throughputP95Mps: number;
	avgYieldCount: number;
	peakJsHeapBytes?: number;
};

export type PreviewEntry = {
	level: 'drag' | 'settle';
	width: number;
	height: number;
	megapixels: number;
	angle: SortAngle;
	algorithm: SortAlgorithm;
	workerKernelMs: PercentileSummary;
	workerBitmapMs: PercentileSummary;
	workerTotalMs: PercentileSummary;
	mainDrawMs: PercentileSummary;
	visibleUpdateMs: PercentileSummary;
};

export type BreakdownEntry = {
	label: string;
	width: number;
	height: number;
	angle: SortAngle;
	algorithm: SortAlgorithm;
	uninstrumentedMs: number;
	instrumentedTotalMs: number;
	gatherMs: number;
	keySelectMs: number;
	sortMs: number;
	scatterMs: number;
};

export type CancelEntry = {
	label: string;
	width: number;
	height: number;
	angle: SortAngle;
	trials: number;
	cancelLatencyMs: PercentileSummary;
};

export type MainThreadHealth = {
	longTaskApiSupported: boolean;
	longTaskCount: number;
	longestLongTaskMs: number;
	stallProbeMaxMs: number;
	stallProbeP95Ms: number;
	longestDrawMs: number;
};

export type SpikeS1Report = {
	userAgent: string;
	hardwareConcurrency: number;
	correctnessPassed: boolean;
	winningExactAlgorithm: SortAlgorithm;
	imageStats12Mp: {
		angle0: PixelSortStats;
		angle30: PixelSortStats;
	};
	algorithmComparison12Mp: ThroughputEntry[];
	fullThroughput: ThroughputEntry[];
	previews: PreviewEntry[];
	breakdowns: BreakdownEntry[];
	cancellation: CancelEntry[];
	mainThread: MainThreadHealth;
};
