import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {boxDownscale} from '../../src/engine/resample.ts';
import {
	applyTransform,
	IDENTITY_TRANSFORM,
	type SourceTransform,
} from '../../src/engine/transform.ts';
import type {RgbaImage} from '../../src/engine/types.ts';
import type {ExportRequest, ExportResponse} from '../../src/worker/protocol.ts';
import {
	patternImage,
	sameImage,
	startWorker,
	type FakeBitmap,
} from './harness.ts';

type Done = Extract<
	ExportResponse,
	{type: 'exported' | 'fullRendered' | 'error'}
>;

const NO_EFFECTS = {schemaVersion: 1, instances: []} as const;

function transform(overrides: Partial<SourceTransform>): SourceTransform {
	return {...IDENTITY_TRANSFORM, ...overrides};
}

const isDone = (message: ExportResponse): message is Done =>
	message.type !== 'progress';

async function setup(source: RgbaImage) {
	const worker = await startWorker<ExportRequest, ExportResponse>(
		() => import('../../src/worker/export.worker.ts'),
		source,
	);
	const job = {
		jobId: 1,
		blob: new Blob(['original bytes']),
		sourceWidth: source.width,
		sourceHeight: source.height,
		stack: {...NO_EFFECTS, instances: []},
	};

	return {
		...worker,
		job,
		async export(scale: number, value?: SourceTransform) {
			const from = worker.posted.length;
			worker.send({
				...job,
				type: 'export',
				scale,
				format: 'png',
				quality: 92,
				transform: value,
			});
			return worker.next(isDone, from);
		},
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('export worker geometry (engine.md section 16.3)', () => {
	it('AC-F20.5: a 1200 x 800 crop exports at 1200 x 800 and at 1/2 as 600 x 400', async () => {
		const source = patternImage(4000, 3000);
		const crop = {x: 700, y: 500, width: 1200, height: 800};
		const cropped = transform({crop});
		const worker = await setup(source);

		await expect(worker.export(1, cropped)).resolves.toMatchObject({
			type: 'exported',
			width: 1200,
			height: 800,
		});
		expect(sameImage(worker.encoded[0], applyTransform(source, cropped))).toBe(
			true,
		);

		await expect(worker.export(0.5, cropped)).resolves.toMatchObject({
			type: 'exported',
			width: 600,
			height: 400,
		});
		const half = applyTransform(
			source,
			transform({
				crop,
				resize: {width: 600, height: 400, filter: 'lanczos3'},
			}),
		);
		expect(sameImage(worker.encoded[1], half)).toBe(true);
		// A transform always starts from the full decode.
		expect(worker.decodes).toEqual([undefined, undefined]);
		await expect(worker.job.blob.text()).resolves.toBe('original bytes');
	}, 60_000);

	it('AC-F20.1: exports a rotated 4000 x 3000 source at 3000 x 4000', async () => {
		const source = patternImage(4000, 3000);
		const turned = transform({rotation: 90});
		const worker = await setup(source);

		await expect(worker.export(1, turned)).resolves.toMatchObject({
			width: 3000,
			height: 4000,
		});
		expect(sameImage(worker.encoded[0], applyTransform(source, turned))).toBe(
			true,
		);
	}, 60_000);

	it('resamples once, straight to the export size, with the resize filter', async () => {
		const source = patternImage(40, 30);
		const worker = await setup(source);
		const resized = transform({
			resize: {width: 80, height: 60, filter: 'nearest'},
		});
		await worker.export(0.25, resized);

		const once = applyTransform(
			source,
			transform({resize: {width: 20, height: 15, filter: 'nearest'}}),
		);
		expect(sameImage(worker.encoded[0], once)).toBe(true);
	});

	it('lets the browser scale an untransformed source, as before', async () => {
		const source = patternImage(40, 30);
		const worker = await setup(source);
		await worker.export(0.5);
		await worker.export(1, IDENTITY_TRANSFORM);

		expect(worker.decodes).toEqual([{width: 20, height: 15}, undefined]);
		expect(sameImage(worker.encoded[0], boxDownscale(source, 20, 15))).toBe(
			true,
		);
		expect(sameImage(worker.encoded[1], source)).toBe(true);
	});

	it('tiles the transformed image for a full render', async () => {
		const source = patternImage(40, 30);
		const value = transform({
			rotation: 90,
			crop: {x: 1, y: 2, width: 25, height: 33},
		});
		const worker = await setup(source);
		worker.send({
			...worker.job,
			type: 'renderFull',
			generation: 1,
			transform: value,
		});
		const done = await worker.next(isDone);

		expect(done).toMatchObject({type: 'fullRendered', width: 25, height: 33});
		const [tile] = (done as Extract<Done, {type: 'fullRendered'}>).tiles;
		expect(
			sameImage(
				tile.bitmap as unknown as FakeBitmap,
				applyTransform(source, value),
			),
		).toBe(true);
	});

	it('reports a transform that does not fit the source without decoding', async () => {
		const worker = await setup(patternImage(40, 30));
		const done = await worker.export(
			1,
			transform({crop: {x: 30, y: 0, width: 20, height: 30}}),
		);

		expect(done).toMatchObject({type: 'error', code: 'internal'});
		expect(worker.decodes).toEqual([]);
	});
});
