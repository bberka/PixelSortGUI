import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {renderSizeForPixelCap} from '../../src/codec/decode.ts';
import {runtimeEffectRegistry} from '../../src/engine/effects/runtime.ts';
import {createStageCache, renderStack} from '../../src/engine/pipeline.ts';
import {boxDownscale} from '../../src/engine/resample.ts';
import {
	applyTransform,
	IDENTITY_TRANSFORM,
	transformKey,
	type SourceTransform,
} from '../../src/engine/transform.ts';
import type {EffectStack, RgbaImage} from '../../src/engine/types.ts';
import type * as Pipeline from '../../src/engine/pipeline.ts';
import type {
	PreviewRequest,
	PreviewResponse,
} from '../../src/worker/protocol.ts';
import {
	patternImage,
	sameImage,
	startWorker,
	type FakeBitmap,
} from './harness.ts';

// Records the stage cache key of every render; the pipeline itself is real.
const sourceKeys = vi.hoisted((): string[] => []);
vi.mock('../../src/engine/pipeline.ts', async (importOriginal) => {
	const real = await importOriginal<typeof Pipeline>();
	return {
		...real,
		renderStack(...args: Parameters<typeof real.renderStack>) {
			sourceKeys.push(args[3].sourceKey ?? '');
			return real.renderStack(...args);
		},
	};
});

type Loaded = Extract<PreviewResponse, {type: 'sourceLoaded'}>;
type Rendered = Extract<PreviewResponse, {type: 'rendered'}>;
type Failed = Extract<PreviewResponse, {type: 'error'}>;

const CAPS = {drag: 300, settle: 1200};

const STACK: EffectStack = {
	schemaVersion: 1,
	instances: [
		{
			id: 'aaaaaaaa',
			type: 'pixelSort',
			version: 1,
			enabled: true,
			params: {},
			mix: 1,
			blend: 'normal',
		},
	],
};

function transform(overrides: Partial<SourceTransform>): SourceTransform {
	return {...IDENTITY_TRANSFORM, ...overrides};
}

const pixels = (bitmap: ImageBitmap) => [
	...(bitmap as unknown as FakeBitmap).data,
];

async function setup(source: RgbaImage) {
	const worker = await startWorker<PreviewRequest, PreviewResponse>(
		() => import('../../src/worker/preview.worker.ts'),
		source,
	);
	const blob = new Blob(['original bytes']);
	let requestId = 0;
	let jobId = 100;

	const answer = async (id: number) =>
		worker.next(
			(message): message is Loaded | Failed =>
				(message.type === 'sourceLoaded' || message.type === 'error') &&
				message.requestId === id,
		);
	const loaded = async (id: number): Promise<Loaded> => {
		const response = await answer(id);
		if (response.type !== 'sourceLoaded') {
			throw new Error(response.message);
		}

		return response;
	};

	const postLoad = (value?: SourceTransform, caps = CAPS) => {
		requestId++;
		worker.send({
			type: 'loadSource',
			requestId,
			sourceKey: 'hash',
			blob,
			sourceWidth: source.width,
			sourceHeight: source.height,
			caps,
			transform: value,
		});
		return requestId;
	};

	const postTransform = (value: SourceTransform, sourceKey = 'hash') => {
		requestId++;
		worker.send({
			type: 'setTransform',
			requestId,
			sourceKey,
			transform: value,
		});
		return requestId;
	};

	const render = async (level: 'drag' | 'settle' = 'settle') => {
		jobId++;
		const id = jobId;
		worker.send({
			type: 'render',
			jobId: id,
			generation: id,
			sourceKey: 'hash',
			level,
			stack: STACK,
		});
		return worker.next(
			(message): message is Rendered =>
				message.type === 'rendered' && message.jobId === id,
		);
	};

	return {
		...worker,
		blob,
		postLoad,
		postTransform,
		answer,
		loaded,
		render,
		load: async (value?: SourceTransform, caps = CAPS) =>
			loaded(postLoad(value, caps)),
		setTransform: async (value: SourceTransform) =>
			loaded(postTransform(value)),
	};
}

async function direct(
	image: RgbaImage,
	effective: {width: number; height: number},
) {
	const result = await renderStack(image, STACK, runtimeEffectRegistry, {
		level: 'settle',
		sourceWidth: effective.width,
		sourceHeight: effective.height,
		cache: createStageCache(),
		checkpoint: () => undefined,
	});
	return [...result.image.data];
}

afterEach(() => {
	vi.unstubAllGlobals();
	sourceKeys.length = 0;
});

describe('preview worker geometry (engine.md section 16.3)', () => {
	it('AC-F20.1: rotates a 4000 x 3000 source to 3000 x 4000 and leaves the file alone', async () => {
		const source = patternImage(4000, 3000);
		const worker = await setup(source);
		const turned = transform({rotation: 90});
		const response = await worker.load(turned, {
			drag: 1_048_576,
			settle: 4_194_304,
		});

		const settle = renderSizeForPixelCap(3000, 4000, 4_194_304);
		expect(response.effective).toEqual({width: 3000, height: 4000});
		expect(response.settle).toEqual({
			width: settle.width,
			height: settle.height,
		});
		// The browser decodes in source orientation, then the worker turns it.
		expect(worker.decodes).toEqual([
			{width: settle.height, height: settle.width},
		]);
		const expected = applyTransform(
			boxDownscale(source, settle.height, settle.width),
			turned,
		);
		expect(
			sameImage(response.original as unknown as FakeBitmap, expected),
		).toBe(true);
		await expect(worker.blob.text()).resolves.toBe('original bytes');
	}, 60_000);

	it('keeps the identity decode when no transform is sent', async () => {
		const source = patternImage(80, 60);
		const worker = await setup(source);
		const response = await worker.load();

		expect(worker.decodes).toEqual([{width: 40, height: 30}]);
		expect(response.effective).toEqual({width: 80, height: 60});
		expect(pixels(response.original)).toEqual([
			...boxDownscale(source, 40, 30).data,
		]);
		await worker.render();
		expect(sourceKeys).toEqual([`hash:${transformKey()}`]);
	});

	it('returns the transformed image as `original`, aligned with the rendered result', async () => {
		const source = patternImage(40, 30);
		const worker = await setup(source);
		const value = transform({
			rotation: 270,
			flipX: true,
			crop: {x: 3, y: 5, width: 20, height: 28},
		});
		const response = await worker.load(value);
		const expected = applyTransform(source, value);

		expect(response.settle).toEqual({width: 20, height: 28});
		expect(pixels(response.original)).toEqual([...expected.data]);
		const frame = await worker.render();
		expect([frame.width, frame.height]).toEqual([20, 28]);
		expect(pixels(frame.bitmap)).toEqual(await direct(expected, expected));
		const drag = await worker.render('drag');
		expect([drag.width, drag.height]).toEqual([
			response.drag.width,
			response.drag.height,
		]);
		expect(drag.width).toBeLessThan(20);
	});

	it('decodes only as large as a crop needs to fill the settle proxy', async () => {
		const worker = await setup(patternImage(160, 120));
		const response = await worker.load(
			transform({crop: {x: 40, y: 30, width: 80, height: 60}}),
		);

		expect(response.effective).toEqual({width: 80, height: 60});
		expect(response.settle).toEqual({width: 40, height: 30});
		expect(worker.decodes).toEqual([{width: 80, height: 60}]);
	});

	it('invalidates the stage cache on a crop change of the same effective size', async () => {
		const source = patternImage(60, 40);
		const worker = await setup(source);
		const left = transform({crop: {x: 0, y: 0, width: 30, height: 40}});
		const right = transform({crop: {x: 30, y: 0, width: 30, height: 40}});
		await worker.load(left);
		const first = await worker.render();
		const response = await worker.setTransform(right);
		const second = await worker.render();

		const expected = applyTransform(source, right);
		expect(pixels(response.original)).toEqual([...expected.data]);
		expect(pixels(second.bitmap)).toEqual(await direct(expected, expected));
		expect(pixels(second.bitmap)).not.toEqual(pixels(first.bitmap));
		expect(sourceKeys.slice(0, 2)).toEqual([
			`hash:${transformKey(left)}`,
			`hash:${transformKey(right)}`,
		]);
	});

	it('keeps the drag cap across a transform change', async () => {
		const worker = await setup(patternImage(80, 60));
		await worker.load();
		worker.send({type: 'setDragCap', pixels: 108});
		const response = await worker.setTransform(transform({flipY: true}));

		expect(response.drag).toEqual({width: 12, height: 9});
	});

	it('answers only the newest of a load and a transform that overtakes it', async () => {
		const worker = await setup(patternImage(40, 30));
		const first = worker.postLoad();
		const second = worker.postTransform(transform({rotation: 90}));
		const response = await worker.loaded(second);

		expect(response.effective).toEqual({width: 30, height: 40});
		expect(
			worker.posted.some(
				(message) => 'requestId' in message && message.requestId === first,
			),
		).toBe(false);
	});

	it('reports a transform that does not fit the source without decoding', async () => {
		const worker = await setup(patternImage(40, 30));
		const id = worker.postLoad(
			transform({crop: {x: 0, y: 0, width: 41, height: 30}}),
		);

		await expect(worker.answer(id)).resolves.toMatchObject({
			type: 'error',
			code: 'internal',
		});
		expect(worker.decodes).toEqual([]);
	});

	it('refuses a transform for a source it does not hold', async () => {
		const worker = await setup(patternImage(40, 30));
		await worker.load();
		const id = worker.postTransform(transform({flipX: true}), 'other');

		await expect(worker.answer(id)).resolves.toMatchObject({
			type: 'error',
			code: 'internal',
		});
	});
});
