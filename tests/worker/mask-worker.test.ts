import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {createMask, paintStroke} from '../../src/engine/mask/brush.ts';
import type {
	BrushSample,
	BrushStroke,
} from '../../src/engine/mask/brush-types.ts';
import {fitPaintedMask} from '../../src/engine/mask/fit.ts';
import type {MaskBitmap, MaskGeometry} from '../../src/engine/mask/types.ts';
import {IDENTITY_TRANSFORM} from '../../src/engine/transform.ts';
import {decodeMaskFile} from '../../src/worker/mask-decode.ts';
import type {
	MaskFile,
	MaskWorkerRequest,
	MaskWorkerResponse,
	ProxySize,
} from '../../src/worker/protocol.ts';
import {patternImage, startWorker} from './harness.ts';
import {paintedMask} from './mask-files.ts';

type Answered<T extends MaskWorkerResponse['type']> = Extract<
	MaskWorkerResponse,
	{type: T}
>;

const plain: MaskGeometry = {
	sourceWidth: 200,
	sourceHeight: 150,
	transform: IDENTITY_TRANSFORM,
};
// Rotated, flipped, cropped and shown on a smaller overlay.
const turned: MaskGeometry = {
	sourceWidth: 200,
	sourceHeight: 150,
	transform: {
		rotation: 90,
		flipX: true,
		flipY: false,
		crop: {x: 13, y: 21, width: 117, height: 151},
		resize: null,
	},
};

const paint: BrushStroke = {mode: 'paint', hardness: 30, strength: 80};
const sample = (x: number, y: number, radius = 12): BrushSample => ({
	x: x * 16,
	y: y * 16,
	rx: radius * 16,
	ry: radius * 16,
});

async function setup() {
	const worker = await startWorker<MaskWorkerRequest, MaskWorkerResponse>(
		() => import('../../src/worker/mask.worker.ts'),
		patternImage(1, 1),
	);
	let id = 0;
	let overlay: ProxySize = {width: 0, height: 0};
	let shown = new Uint8Array();
	let read = 0;

	// The overlay as the patches so far leave it.
	const screen = () => {
		for (; read < worker.posted.length; read++) {
			const message = worker.posted[read];
			if (message.type !== 'overlayPatch') {
				continue;
			}

			for (let row = 0; row < message.height; row++) {
				shown.set(
					message.data.subarray(row * message.width, (row + 1) * message.width),
					(message.y + row) * overlay.width + message.x,
				);
			}
		}

		return shown;
	};

	const answer = async <T extends MaskWorkerResponse['type']>(
		types: readonly T[],
		requestId: number,
	) =>
		worker.next(
			(message): message is Answered<T> =>
				(types as readonly string[]).includes(message.type) &&
				(message as {requestId?: number}).requestId === requestId,
		);

	const open = async (
		asset: MaskFile | null,
		{
			geometry = plain,
			size = {width: 200, height: 150},
			invert = false,
		}: {geometry?: MaskGeometry; size?: ProxySize; invert?: boolean} = {},
	) => {
		id++;
		overlay = size;
		shown = new Uint8Array(size.width * size.height);
		read = worker.posted.length;
		worker.send({
			type: 'maskOpen',
			requestId: id,
			asset,
			invert,
			geometry,
			overlay: size,
		});
		return answer(['maskOpened', 'error'], id);
	};

	const draw = async (stroke: BrushStroke, samples: BrushSample[]) => {
		id++;
		const [first, ...rest] = samples;
		worker.send({type: 'strokeStart', stroke, sample: first});
		for (const next of rest) {
			worker.send({type: 'strokeMove', samples: [next]});
		}

		worker.send({type: 'strokeEnd', requestId: id});
		return answer(['maskEdited', 'error'], id);
	};

	return {...worker, open, draw, screen};
}

async function fitted(
	grid: MaskBitmap,
	geometry: MaskGeometry,
	{width, height}: ProxySize,
	invert = false,
) {
	const out = new Uint8Array(width * height);
	await fitPaintedMask(grid, geometry, width, height, out, () => undefined);
	return invert ? out.map((value) => 255 - value) : out;
}

async function bitmapOf(response: MaskWorkerResponse) {
	if (response.type !== 'maskEdited' || !response.asset) {
		throw new Error(`No asset in ${response.type}`);
	}

	return decodeMaskFile(response.asset);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('mask worker (engine.md section 16.6)', () => {
	it('returns the bytes the engine brush makes, and builds on them', async () => {
		const worker = await setup();
		await worker.open(null);
		const first = [sample(20, 20), sample(150, 40), sample(60, 130)];
		const one = paintStroke(createMask(200, 150), paint, first).bitmap;
		expect(await bitmapOf(await worker.draw(paint, first))).toEqual(one);

		const erase: BrushStroke = {mode: 'erase', hardness: 100, strength: 100};
		const second = [sample(100, 0), sample(100, 149)];
		expect(await bitmapOf(await worker.draw(erase, second))).toEqual(
			paintStroke(one, erase, second).bitmap,
		);
	});

	it.each([
		['the whole photo', plain, {width: 200, height: 150}, false],
		['a turned, cropped, smaller view', turned, {width: 50, height: 65}, false],
		['an inverted mask', turned, {width: 117, height: 151}, true],
	])(
		'patches the overlay to match a full fit of %s',
		async (_name, geometry, size, invert) => {
			const worker = await setup();
			const {bitmap, file} = await paintedMask(200, 150);
			await worker.open(file, {geometry, size, invert});
			await vi.waitFor(async () => {
				expect(worker.screen()).toEqual(
					await fitted(bitmap, geometry, size, invert),
				);
			});

			const samples = [sample(30, 100), sample(55, 40, 4), sample(120, 75, 25)];
			const edited = await bitmapOf(await worker.draw(paint, samples));
			expect(edited).toEqual(paintStroke(bitmap, paint, samples).bitmap);
			expect(worker.screen()).toEqual(
				await fitted(edited, geometry, size, invert),
			);
		},
	);

	it('leaves no trace of a cancelled stroke', async () => {
		const worker = await setup();
		const {bitmap, file} = await paintedMask(200, 150);
		const size = {width: 200, height: 150};
		await worker.open(file, {size});
		worker.send({type: 'strokeStart', stroke: paint, sample: sample(10, 10)});
		worker.send({type: 'strokeMove', samples: [sample(190, 140, 30)]});
		worker.send({type: 'strokeCancel'});
		const samples = [sample(100, 75, 5)];
		const edited = await bitmapOf(await worker.draw(paint, samples));
		expect(edited).toEqual(paintStroke(bitmap, paint, samples).bitmap);
		expect(worker.screen()).toEqual(await fitted(edited, plain, size));
	});

	it('reports a stroke that changes no byte without an asset', async () => {
		const worker = await setup();
		await worker.open(null);
		const erase: BrushStroke = {mode: 'erase', hardness: 50, strength: 100};
		const response = await worker.draw(erase, [sample(50, 50)]);
		expect(response).toMatchObject({type: 'maskEdited', changed: false});
		expect(response).not.toHaveProperty('asset');
	});

	it('refuses a damaged mask and paints nothing on it', async () => {
		const worker = await setup();
		const {file} = await paintedMask(200, 150);
		const opened = await worker.open({...file, sha256: 'f'.repeat(64)});
		expect(opened).toMatchObject({type: 'error', code: 'decode-failed'});
		expect(await worker.draw(paint, [sample(50, 50)])).toMatchObject({
			type: 'error',
		});
	});
});
