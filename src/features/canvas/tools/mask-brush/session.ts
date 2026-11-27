// The main-thread side of the mask worker (engine.md section 16.6): it keeps the
// worker holding the mask the brush edits, sends strokes to it and commits each
// finished one. It touches no DOM, so it runs in tests with a fake worker.
import type {BrushSample} from '@/engine/mask/brush-types.ts';
import {maskGridSize} from '@/engine/mask/grid.ts';
import type {MaskGeometry} from '@/engine/mask/types.ts';
import {transformKey} from '@/engine/transform.ts';
import type {BrushTool} from '@/state/brush.ts';
import type {NewMask} from '@/storage/types.ts';
import type {
	MaskWorkerRequest,
	MaskWorkerResponse,
	ProxySize,
} from '@/worker/protocol.ts';

// What the worker must hold for the brush to paint.
export type BrushTarget = {
	// Mask hash, or '' for nothing painted.
	readonly asset: string;
	readonly invert: boolean;
	readonly geometry: MaskGeometry;
	readonly overlay: ProxySize;
};

export type MaskWorkerPort = {
	post(message: MaskWorkerRequest): void;
	terminate(): void;
};

export type OverlayPatch = Extract<MaskWorkerResponse, {type: 'overlayPatch'}>;

// 'missing': the mask's file cannot be read. 'failed': the worker stopped.
export type BrushProblem = 'missing' | 'failed';

export type BrushSessionOptions = {
	createWorker(handlers: {
		message(response: MaskWorkerResponse): void;
		error(): void;
	}): MaskWorkerPort;
	// Read when needed, never cached. `null` while the brush is suspended or
	// the photo is still loading.
	getTarget(): BrushTarget | null;
	loadMask(sha256: string): Promise<NewMask | undefined>;
	// Resolves whether the stroke became a history entry.
	commit(mode: BrushTool, asset: Promise<NewMask | null>): Promise<boolean>;
	// The overlay has this size from now on; patches follow.
	onOpened(overlay: ProxySize): void;
	onPatch(patch: OverlayPatch): void;
	onCommitted(): void;
	onProblem(problem: BrushProblem): void;
};

type Opened = {
	readonly requestId: number;
	// Everything but the mask itself.
	readonly context: string;
	readonly overlaySize: ProxySize;
	// The mask the worker holds once it has handled every message sent.
	asset: string;
	broken: boolean;
};

function contextKey({invert, geometry, overlay}: BrushTarget): string {
	return `${invert} ${geometry.sourceWidth}x${geometry.sourceHeight} ${transformKey(geometry.transform)} ${overlay.width}x${overlay.height}`;
}

export function createBrushSession(options: BrushSessionOptions) {
	let worker: MaskWorkerPort | undefined;
	let opened: Opened | undefined;
	// The open whose patches the overlay takes.
	let shownOpen = 0;
	let stroke: BrushTool | undefined;
	// Strokes sent whose history entry is not written yet.
	let pending = 0;
	let nextId = 0;
	let disposed = false;
	// Messages leave in order, behind a mask that is still being read.
	let queue: Promise<void> = Promise.resolve();
	// By the request id of a `strokeEnd` the worker has not answered.
	const ending = new Map<number, (asset: NewMask | null) => void>();

	// Strokes the worker has not answered change nothing.
	const stopWorker = () => {
		worker?.terminate();
		worker = undefined;
		shownOpen = 0;
		for (const resolve of ending.values()) {
			resolve(null);
		}

		ending.clear();
	};

	const crash = () => {
		stroke = undefined;
		stopWorker();
		opened = undefined;
		if (!disposed) {
			options.onProblem('failed');
		}
	};

	// Stops the worker, so nothing paints on the mask it held before.
	const breakOpen = (target: Opened) => {
		target.broken = true;
		stroke = undefined;
		stopWorker();
		options.onProblem('missing');
	};

	const receive = (response: MaskWorkerResponse) => {
		switch (response.type) {
			case 'maskOpened': {
				if (opened?.requestId === response.requestId) {
					shownOpen = response.requestId;
					options.onOpened(opened.overlaySize);
				}

				break;
			}

			case 'overlayPatch': {
				if (!disposed && shownOpen !== 0 && shownOpen === opened?.requestId) {
					options.onPatch(response);
				}

				break;
			}

			case 'maskEdited': {
				const resolve = ending.get(response.requestId);
				ending.delete(response.requestId);
				const {asset} = response;
				if (asset && opened) {
					opened.asset = asset.sha256;
				}

				resolve?.(asset ?? null);
				break;
			}

			case 'error': {
				if (
					response.code === 'decode-failed' &&
					opened?.requestId === response.requestId
				) {
					breakOpen(opened!);
				} else {
					crash();
				}

				break;
			}
		}
	};

	const send = (message: MaskWorkerRequest) => {
		queue = queue.then(() => {
			worker?.post(message);
		});
	};

	const open = (target: BrushTarget) => {
		worker ??= options.createWorker({message: receive, error: crash});
		nextId++;
		const next: Opened = {
			requestId: nextId,
			context: contextKey(target),
			overlaySize: target.overlay,
			asset: target.asset,
			broken: false,
		};
		opened = next;
		const {asset, geometry, invert, overlay} = target;
		queue = queue.then(async () => {
			if (opened !== next) {
				return;
			}

			let record: NewMask | undefined;
			if (asset !== '') {
				record = await options.loadMask(asset).catch(() => undefined);
				const grid = maskGridSize(geometry.sourceWidth, geometry.sourceHeight);
				if (record?.width !== grid.width || record.height !== grid.height) {
					if (opened === next) {
						breakOpen(next);
					}

					return;
				}
			}

			worker?.post({
				type: 'maskOpen',
				requestId: next.requestId,
				asset: record
					? {
							sha256: record.sha256,
							width: record.width,
							height: record.height,
							blob: record.blob,
						}
					: null,
				invert,
				geometry,
				overlay,
			});
		});
	};

	const cancel = () => {
		if (stroke === undefined) {
			return;
		}

		stroke = undefined;
		send({type: 'strokeCancel'});
	};

	// Opens the wanted mask in the worker unless it holds it already.
	const sync = () => {
		if (disposed) {
			return;
		}

		const target = options.getTarget();
		if (!target) {
			cancel();
			return;
		}

		const sameContext = opened?.context === contextKey(target);
		// While strokes are being written, the stored mask lags the worker's.
		const current =
			sameContext && (pending > 0 || opened?.asset === target.asset);
		if (current) {
			return;
		}

		cancel();
		if (pending === 0) {
			open(target);
		}
	};

	const finish = () => {
		if (!(disposed && pending === 0)) {
			return;
		}

		stopWorker();
		opened = undefined;
	};

	return {
		sync,

		get stroking(): boolean {
			return stroke !== undefined;
		},

		// Starts a stroke; `false` when the mask cannot be painted now.
		begin(
			mode: BrushTool,
			settings: {readonly hardness: number; readonly strength: number},
			sample: BrushSample,
		): boolean {
			sync();
			if (disposed || !options.getTarget() || !opened || opened.broken) {
				return false;
			}

			stroke = mode;
			send({type: 'strokeStart', stroke: {mode, ...settings}, sample});
			return true;
		},

		move(samples: readonly BrushSample[]): void {
			if (stroke !== undefined && samples.length > 0) {
				send({type: 'strokeMove', samples});
			}
		},

		end(): void {
			const mode = stroke;
			if (mode === undefined) {
				return;
			}

			stroke = undefined;
			nextId++;
			const requestId = nextId;
			const asset = new Promise<NewMask | null>((resolve) => {
				ending.set(requestId, resolve);
			});
			send({type: 'strokeEnd', requestId});
			pending++;
			void options
				.commit(mode, asset)
				.then((committed) => {
					if (committed) {
						options.onCommitted();
					}
				})
				// The store reports a failed write; the stored mask is opened again.
				.catch(() => {})
				.finally(() => {
					pending--;
					sync();
					finish();
				});
		},

		cancel,

		// Ends the session once every finished stroke is written.
		dispose(): void {
			cancel();
			disposed = true;
			queue = queue.then(finish);
		},
	};
}

export type BrushSession = ReturnType<typeof createBrushSession>;
