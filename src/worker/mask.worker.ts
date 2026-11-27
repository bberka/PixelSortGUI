// The mask brush worker (engine.md section 16.6, decisions.md D49). It holds the
// painted mask being edited, stamps strokes onto it, and sends the changed parts
// of the overlay. The main thread never stamps.

import {isMemoryError} from '../codec/decode.ts';
import {encodeMaskAsset, MaskAssetError} from '../engine/mask/asset.ts';
import {
	applyStroke,
	createMask,
	placeDabs,
	stampDab,
} from '../engine/mask/brush.ts';
import type {
	BrushSample,
	BrushStroke,
	MaskRect,
} from '../engine/mask/brush-types.ts';
import {maskToEffective} from '../engine/mask/coords.ts';
import {fitPaintedMask} from '../engine/mask/fit.ts';
import {maskGridSize} from '../engine/mask/grid.ts';
import type {MaskBitmap, MaskGeometry} from '../engine/mask/types.ts';
import {effectiveDimensions, type Size} from '../engine/transform.ts';
import {decodeMaskFile} from './mask-decode.ts';
import type {MaskWorkerRequest, MaskWorkerResponse} from './protocol.ts';

type OpenRequest = Extract<MaskWorkerRequest, {type: 'maskOpen'}>;

type WorkerScope = {
	postMessage(message: MaskWorkerResponse, transfer?: Transferable[]): void;
	addEventListener(
		type: 'message',
		listener: (event: MessageEvent<MaskWorkerRequest>) => void,
	): void;
};

const scope = globalThis as unknown as WorkerScope;

type ActiveStroke = {
	stroke: BrushStroke;
	previous: BrushSample | undefined;
	// The mask pixels any dab has touched.
	rect: MaskRect | undefined;
};

type Session = {
	invert: boolean;
	geometry: MaskGeometry;
	overlay: Size;
	// The mask before the stroke in progress.
	base: MaskBitmap;
	// The mask with it applied; equal to `base` outside a stroke.
	edit: MaskBitmap;
	// The coverage of the stroke in progress; zero outside a stroke.
	cover: MaskBitmap;
	// `edit` fitted to the overlay, without invert.
	fitted: Uint8Array;
	active: ActiveStroke | undefined;
	// The overlay pixels that no patch has carried yet.
	dirty: MaskRect | undefined;
};

let session: Session | undefined;
let flushScheduled = false;
// Requests are handled one at a time, in the order they arrive.
let queue: Promise<void> = Promise.resolve();

function union(a: MaskRect | undefined, b: MaskRect): MaskRect {
	if (!a) {
		return b;
	}

	const x = Math.min(a.x, b.x);
	const y = Math.min(a.y, b.y);
	return {
		x,
		y,
		width: Math.max(a.x + a.width, b.x + b.width) - x,
		height: Math.max(a.y + a.height, b.y + b.height) - y,
	};
}

// Calls `row` with the offset of each row of `rect` in a bitmap `width` wide.
function forEachRow(
	rect: MaskRect,
	width: number,
	row: (start: number, end: number) => void,
): void {
	for (let {y} = rect; y < rect.y + rect.height; y++) {
		const start = y * width + rect.x;
		row(start, start + rect.width);
	}
}

function copyRect(from: MaskBitmap, to: MaskBitmap, rect: MaskRect): void {
	forEachRow(rect, from.width, (start, end) => {
		to.data.set(from.data.subarray(start, end), start);
	});
}

/**
 The overlay pixels that read any mask pixel of `rect`. A fitted pixel reads at
 most one mask pixel beyond its own area, so one pixel of margin on each side of
 both rectangles covers it.
 */
function overlayRect(
	{geometry, overlay}: Session,
	rect: MaskRect,
): MaskRect | undefined {
	const effective = effectiveDimensions(
		geometry.sourceWidth,
		geometry.sourceHeight,
		geometry.transform,
	);
	const corners = [
		maskToEffective(geometry, {x: rect.x - 1, y: rect.y - 1}),
		maskToEffective(geometry, {
			x: rect.x + rect.width + 1,
			y: rect.y + rect.height + 1,
		}),
	];
	const xs = corners.map(({x}) => (x * overlay.width) / effective.width);
	const ys = corners.map(({y}) => (y * overlay.height) / effective.height);
	const left = Math.max(0, Math.floor(Math.min(...xs)) - 1);
	const top = Math.max(0, Math.floor(Math.min(...ys)) - 1);
	const right = Math.min(overlay.width, Math.ceil(Math.max(...xs)) + 1);
	const bottom = Math.min(overlay.height, Math.ceil(Math.max(...ys)) + 1);
	return right > left && bottom > top
		? {x: left, y: top, width: right - left, height: bottom - top}
		: undefined;
}

// Sends the dirty part of the overlay.
async function flush(target: Session): Promise<void> {
	const rect = target.dirty;
	if (!rect || session !== target) {
		return;
	}

	target.dirty = undefined;
	const {overlay, fitted, invert} = target;
	await fitPaintedMask(
		target.edit,
		target.geometry,
		overlay.width,
		overlay.height,
		fitted,
		() => undefined,
		rect,
	);
	const data = new Uint8Array(rect.width * rect.height);
	let out = 0;
	forEachRow(rect, overlay.width, (start, end) => {
		for (let p = start; p < end; p++, out++) {
			data[out] = invert ? 255 - fitted[p] : fitted[p];
		}
	});
	scope.postMessage({type: 'overlayPatch', ...rect, data}, [data.buffer]);
}

// Marks mask pixels as changed. Queued moves share the patch that follows them.
function invalidate(target: Session, rect: MaskRect): void {
	const changed = overlayRect(target, rect);
	if (!changed) {
		return;
	}

	target.dirty = union(target.dirty, changed);
	if (flushScheduled) {
		return;
	}

	flushScheduled = true;
	setTimeout(() => {
		flushScheduled = false;
		const current = session;
		if (current) {
			enqueue(async () => flush(current));
		}
	}, 0);
}

function stamp(target: Session, samples: readonly BrushSample[]): void {
	const {active, base, edit, cover} = target;
	if (!active) {
		return;
	}

	let touched: MaskRect | undefined;
	for (const sample of samples) {
		for (const dab of placeDabs(active.previous, sample)) {
			const rect = stampDab(cover, dab, active.stroke.hardness);
			if (!rect) {
				continue;
			}

			// Applied dab by dab, so a fast move does not redo the pixels between
			// two far ends.
			applyStroke(base, cover, active.stroke, edit, rect);
			touched = union(touched, rect);
		}

		active.previous = sample;
	}

	if (!touched) {
		return;
	}

	active.rect = union(active.rect, touched);
	invalidate(target, touched);
}

// Ends the stroke in progress without keeping it.
function revert(target: Session): void {
	const rect = target.active?.rect;
	target.active = undefined;
	if (!rect) {
		return;
	}

	copyRect(target.base, target.edit, rect);
	forEachRow(rect, target.cover.width, (start, end) => {
		target.cover.data.fill(0, start, end);
	});
	invalidate(target, rect);
}

async function open(request: OpenRequest): Promise<void> {
	session = undefined;
	const {asset, geometry, invert, overlay} = request;
	const grid = maskGridSize(geometry.sourceWidth, geometry.sourceHeight);
	if (asset && (asset.width !== grid.width || asset.height !== grid.height)) {
		throw new MaskAssetError('The mask does not fit the photo');
	}

	const base = asset
		? await decodeMaskFile(asset)
		: createMask(grid.width, grid.height);
	const next: Session = {
		invert,
		geometry,
		overlay,
		base,
		edit: {...base, data: Uint8Array.from(base.data)},
		cover: createMask(grid.width, grid.height),
		fitted: new Uint8Array(overlay.width * overlay.height),
		active: undefined,
		dirty: {x: 0, y: 0, ...overlay},
	};
	session = next;
	scope.postMessage({type: 'maskOpened', requestId: request.requestId});
	await flush(next);
}

async function endStroke(requestId: number): Promise<void> {
	const target = session;
	const active = target?.active;
	if (!target || !active) {
		throw new Error('No stroke is in progress');
	}

	const {base, edit, cover} = target;
	const {rect, stroke} = active;
	const changed =
		rect !== undefined && applyStroke(base, cover, stroke, edit, rect);
	const asset = changed ? await encodeMaskAsset(edit) : undefined;
	target.active = undefined;
	if (rect) {
		copyRect(edit, base, rect);
		forEachRow(rect, cover.width, (start, end) => {
			cover.data.fill(0, start, end);
		});
	}

	await flush(target);
	scope.postMessage({
		type: 'maskEdited',
		requestId,
		changed,
		...(asset && {
			asset: {
				sha256: asset.sha256,
				width: asset.width,
				height: asset.height,
				blob: new Blob([asset.compressed]),
			},
		}),
	});
}

async function handle(message: MaskWorkerRequest): Promise<void> {
	switch (message.type) {
		case 'maskOpen': {
			await open(message);
			break;
		}

		case 'strokeStart': {
			if (session) {
				revert(session);
				session.active = {
					stroke: message.stroke,
					previous: undefined,
					rect: undefined,
				};
				stamp(session, [message.sample]);
			}

			break;
		}

		case 'strokeMove': {
			if (session) {
				stamp(session, message.samples);
			}

			break;
		}

		case 'strokeEnd': {
			await endStroke(message.requestId);
			break;
		}

		case 'strokeCancel': {
			if (session) {
				revert(session);
				await flush(session);
			}

			break;
		}
	}
}

function enqueue(task: () => Promise<void>, requestId?: number): void {
	queue = queue.then(task).catch((error: unknown) => {
		// The mask may be half edited, so nothing builds on it.
		session = undefined;
		scope.postMessage({
			type: 'error',
			requestId,
			code:
				error instanceof MaskAssetError
					? 'decode-failed'
					: isMemoryError(error)
						? 'out-of-memory'
						: 'internal',
			message: error instanceof Error ? error.message : String(error),
		});
	});
}

scope.addEventListener('message', (event) => {
	const message = event.data;
	enqueue(
		async () => handle(message),
		'requestId' in message ? message.requestId : undefined,
	);
});
