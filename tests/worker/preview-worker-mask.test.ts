import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {runtimeEffectRegistry} from '../../src/engine/effects/runtime.ts';
import {renderMask, resolveMask} from '../../src/engine/mask/evaluate.ts';
import type {InstanceMask} from '../../src/engine/mask/types.ts';
import {renderStack, type PipelineOptions} from '../../src/engine/pipeline.ts';
import {boxDownscale} from '../../src/engine/resample.ts';
import {
	applyTransform,
	IDENTITY_TRANSFORM,
	type SourceTransform,
} from '../../src/engine/transform.ts';
import type {EffectStack, RgbaImage} from '../../src/engine/types.ts';
import {
	SETTLE_PIXEL_CAP,
	type MaskFile,
	type PreviewLevel,
	type PreviewRequest,
	type PreviewResponse,
} from '../../src/worker/protocol.ts';
import {
	patternImage,
	sameImage,
	startWorker,
	type FakeBitmap,
} from './harness.ts';
import {paintedMask} from './mask-files.ts';

type Rendered = Extract<PreviewResponse, {type: 'rendered'}>;
type Answered<T extends PreviewResponse['type']> = Extract<
	PreviewResponse,
	{type: T}
>;

const SOURCE = patternImage(40, 30);
const IMAGE = 'a'.repeat(64);

function swapStack(mask: InstanceMask): EffectStack {
	return {
		schemaVersion: 2,
		instances: [
			{
				id: 'swap0000',
				type: 'channelSwap',
				version: 1,
				enabled: true,
				params: {order: 'bgr'},
				mix: 1,
				blend: 'normal',
				mask,
			},
		],
	};
}

const paint = (asset: string, feather = 0): InstanceMask => ({
	kind: 'paint',
	asset,
	invert: false,
	feather,
});

async function expected(
	image: RgbaImage,
	stack: EffectStack,
	options: Partial<PipelineOptions> = {},
): Promise<RgbaImage> {
	const result = await renderStack(image, stack, runtimeEffectRegistry, {
		level: 'settle',
		sourceWidth: image.width,
		sourceHeight: image.height,
		checkpoint: () => undefined,
		...options,
	});
	return result.image;
}

const pixels = (frame: Rendered) => frame.bitmap as unknown as FakeBitmap;

async function setup(drag = 1_048_576) {
	const worker = await startWorker<PreviewRequest, PreviewResponse>(
		() => import('../../src/worker/preview.worker.ts'),
		SOURCE,
	);
	let id = 100;

	const reply = async <T extends PreviewResponse['type']>(
		types: readonly T[],
		matches: (message: Answered<T>) => boolean,
	) =>
		worker.next(
			(message): message is Answered<T> =>
				(types as readonly string[]).includes(message.type) &&
				matches(message as Answered<T>),
		);

	const loadBase = async (transform?: SourceTransform) => {
		const requestId = ++id;
		worker.send({
			type: 'loadSource',
			requestId,
			sourceKey: 'base',
			blob: new Blob(['base']),
			sourceWidth: SOURCE.width,
			sourceHeight: SOURCE.height,
			caps: {drag, settle: SETTLE_PIXEL_CAP},
			transform,
		});
		await reply(['sourceLoaded'], (m) => m.requestId === requestId);
	};

	const postMask = (file: MaskFile) => {
		const requestId = ++id;
		worker.send({type: 'loadMask', requestId, ...file});
		return requestId;
	};

	const maskAnswer = async (requestId: number) =>
		reply(['maskLoaded', 'error'], (m) => m.requestId === requestId);

	const render = async (stack: EffectStack, level: PreviewLevel = 'settle') => {
		const jobId = ++id;
		worker.send({
			type: 'render',
			jobId,
			generation: jobId,
			sourceKey: 'base',
			level,
			stack,
		});
		return reply(['rendered'], (m) => m.jobId === jobId);
	};

	const maskOf = async (mask: InstanceMask, width: number, height: number) => {
		const jobId = ++id;
		worker.send({
			type: 'renderMask',
			jobId,
			sourceKey: 'base',
			mask,
			width,
			height,
		});
		return reply(['maskRendered', 'error'], (m) => m.jobId === jobId);
	};

	return {
		...worker,
		loadBase,
		postMask,
		maskAnswer,
		render,
		maskOf,
		async loadMask(file: MaskFile) {
			await expect(maskAnswer(postMask(file))).resolves.toMatchObject({
				type: 'maskLoaded',
				sha256: file.sha256,
			});
		},
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('preview worker masks (engine.md section 16.6)', () => {
	it('skips the instance before the mask loads and masks it after, never from the cache', async () => {
		const {bitmap, file} = await paintedMask(40, 30);
		const worker = await setup();
		await worker.loadBase();
		const stack = swapStack(paint(file.sha256));

		const before = await worker.render(stack);
		expect(before.warnings).toEqual([
			{instanceId: 'swap0000', code: 'missing-mask'},
		]);
		expect(sameImage(pixels(before), SOURCE)).toBe(true);

		await worker.loadMask(file);
		// The same stack: no stage of the render above may answer it.
		const after = await worker.render(stack);
		expect(after.warnings).toEqual([]);
		const masked = await expected(SOURCE, stack, {
			masks: new Map([[file.sha256, bitmap]]),
		});
		expect(sameImage(pixels(after), masked)).toBe(true);
		expect(sameImage(masked, SOURCE)).toBe(false);

		worker.send({type: 'unloadMask', sha256: file.sha256});
		const unloaded = await worker.render(stack);
		expect(unloaded.warnings).toMatchObject([{code: 'missing-mask'}]);
		expect(sameImage(pixels(unloaded), SOURCE)).toBe(true);
	});

	it('fits the grid through the geometry of the source, at drag and settle', async () => {
		const {bitmap, file} = await paintedMask(40, 30);
		// 300 px: a 20 x 15 drag proxy of the identity, 15 x 20 once turned.
		const worker = await setup(300);
		const transform = {...IDENTITY_TRANSFORM, rotation: 90 as const};
		await worker.loadBase(transform);
		await worker.loadMask(file);
		const stack = swapStack(paint(file.sha256));
		const turned = applyTransform(SOURCE, transform);
		const options = {
			sourceWidth: 30,
			sourceHeight: 40,
			masks: new Map([[file.sha256, bitmap]]),
			geometry: {sourceWidth: 40, sourceHeight: 30, transform},
		};

		const settle = await worker.render(stack);
		expect(
			sameImage(pixels(settle), await expected(turned, stack, options)),
		).toBe(true);
		const drag = await worker.render(stack, 'drag');
		const small = boxDownscale(turned, 15, 20);
		expect(
			sameImage(
				pixels(drag),
				await expected(small, stack, {...options, level: 'drag'}),
			),
		).toBe(true);
	});

	it('renders a mask image from the extra sources', async () => {
		const overlay = patternImage(24, 36);
		const worker = await setup();
		await worker.loadBase();
		const stack = swapStack({
			kind: 'image',
			source: IMAGE,
			fit: 'stretch',
			invert: false,
			feather: 0,
		});
		const before = await worker.render(stack);
		expect(before.warnings).toMatchObject([{code: 'missing-source'}]);

		worker.send({
			type: 'loadExtraSource',
			requestId: 1,
			sha256: IMAGE,
			blob: worker.addFile(overlay),
			sourceWidth: 24,
			sourceHeight: 36,
		});
		await worker.next(
			(message): message is PreviewResponse =>
				message.type === 'extraSourceLoaded',
		);
		const after = await worker.render(stack);
		const masked = await expected(SOURCE, stack, {
			extraSources: new Map([
				[IMAGE, {...overlay, sourceWidth: 24, sourceHeight: 36}],
			]),
		});
		expect(sameImage(pixels(after), masked)).toBe(true);
		expect(sameImage(masked, SOURCE)).toBe(false);
	});

	it('answers a damaged asset with an error, and a second load without decoding', async () => {
		const {file} = await paintedMask(40, 30);
		const worker = await setup();
		const wrong = {...file, sha256: '0'.repeat(64)};
		await expect(
			worker.maskAnswer(worker.postMask(wrong)),
		).resolves.toMatchObject({type: 'error', code: 'decode-failed'});
		const garbage = {...file, blob: new Blob(['not deflate'])};
		await expect(
			worker.maskAnswer(worker.postMask(garbage)),
		).resolves.toMatchObject({type: 'error', code: 'decode-failed'});
		const long = {...file, height: file.height - 1};
		await expect(
			worker.maskAnswer(worker.postMask(long)),
		).resolves.toMatchObject({
			type: 'error',
			message: expect.stringContaining('longer') as string,
		});

		await worker.loadMask(file);
		await worker.loadMask({...file, blob: new Blob(['unread'])});
	});

	it('does not bring back a mask unloaded while it was decoding', async () => {
		const {file} = await paintedMask(40, 30);
		const worker = await setup();
		await worker.loadBase();
		const requestId = worker.postMask(file);
		worker.send({type: 'unloadMask', sha256: file.sha256});
		const frame = await worker.render(swapStack(paint(file.sha256)));
		expect(frame.warnings).toMatchObject([{code: 'missing-mask'}]);
		expect(
			worker.posted.some(
				(message) => 'requestId' in message && message.requestId === requestId,
			),
		).toBe(false);
	});

	it('answers renderMask with the final mask, at the proxy size or smaller', async () => {
		const {bitmap, file} = await paintedMask(40, 30);
		const worker = await setup();
		await worker.loadBase();
		await worker.loadMask(file);
		const painted: InstanceMask = {...paint(file.sha256, 3), invert: true};
		const luma: InstanceMask = {
			kind: 'luma',
			range: [0.4, 0.8],
			softness: 0.1,
			invert: false,
			feather: 0,
		};

		for (const [mask, width, height] of [
			[painted, 40, 30],
			[painted, 20, 15],
			[luma, 20, 15],
		] as const) {
			const ready = resolveMask(mask, {
				source: boxDownscale(SOURCE, width, height),
				sourceWidth: 40,
				sourceHeight: 30,
				masks: new Map([[file.sha256, bitmap]]),
			});
			if (ready.status !== 'ready') {
				throw new Error(ready.code);
			}

			const data = await renderMask(ready, {
				width,
				height,
				sourceWidth: 40,
				target: new Uint8Array(width * height),
				spare: () => new Uint8Array(width * height),
				checkpoint: () => undefined,
			});
			await expect(worker.maskOf(mask, width, height)).resolves.toMatchObject({
				type: 'maskRendered',
				data,
			});
		}
	});

	it('answers renderMask with an error when it cannot render', async () => {
		const worker = await setup();
		const missing = paint('f'.repeat(64));
		await expect(worker.maskOf(missing, 4, 3)).resolves.toMatchObject({
			type: 'error',
		});
		await worker.loadBase();
		await expect(worker.maskOf(missing, 4, 3)).resolves.toMatchObject({
			type: 'error',
			message: 'The mask is missing.',
		});
		// Larger than the proxy.
		await expect(worker.maskOf(paint(''), 80, 60)).resolves.toMatchObject({
			type: 'error',
		});
	});
});
