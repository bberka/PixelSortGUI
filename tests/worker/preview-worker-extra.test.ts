import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {renderSizeForPixelCap} from '../../src/codec/decode.ts';
import {imageBlendSpec} from '../../src/engine/effects/image-blend-spec.ts';
import {runtimeEffectRegistry} from '../../src/engine/effects/runtime.ts';
import {defaultParams} from '../../src/engine/params.ts';
import {renderStack} from '../../src/engine/pipeline.ts';
import {boxDownscale} from '../../src/engine/resample.ts';
import {
	applyTransform,
	IDENTITY_TRANSFORM,
	type SourceTransform,
} from '../../src/engine/transform.ts';
import {
	createImage,
	type EffectStack,
	type ParamValue,
	type RgbaImage,
} from '../../src/engine/types.ts';
import {
	SETTLE_PIXEL_CAP,
	type PreviewLevel,
	type PreviewRequest,
	type PreviewResponse,
} from '../../src/worker/protocol.ts';
import {
	patternImage,
	sameImage,
	startWorker,
	type FakeBitmap,
	type Size,
} from './harness.ts';

type Rendered = Extract<PreviewResponse, {type: 'rendered'}>;
type Answer = Extract<PreviewResponse, {type: 'extraSourceLoaded' | 'error'}>;

const SHA = 'a'.repeat(64);

function blendStack(params: Record<string, ParamValue> = {}): EffectStack {
	return {
		schemaVersion: 1,
		instances: [
			{
				id: 'blend000',
				type: 'imageBlend',
				version: 1,
				enabled: true,
				params: {
					...defaultParams(imageBlendSpec.params),
					image: SHA,
					blendMode: 'difference',
					...params,
				},
				mix: 1,
				blend: 'normal',
			},
		],
	};
}

// Differs from `patternImage` at every position.
function overlayImage(width: number, height: number): RgbaImage {
	const image = createImage(width, height);
	const {data} = image;
	for (let y = 0, o = 0; y < height; y++) {
		for (let x = 0; x < width; x++, o += 4) {
			data[o] = (x * 5 + y * 13 + 90) % 256;
			data[o + 1] = (x * 2 + y * 9 + 40) % 256;
			data[o + 2] = (x * 17 + y) % 256;
			data[o + 3] = 255;
		}
	}

	return image;
}

async function expectedPixels(
	base: RgbaImage,
	stack: EffectStack,
	level: PreviewLevel,
	overlay?: {image: RgbaImage; stored: Size},
	effective: Size = base,
): Promise<RgbaImage> {
	const result = await renderStack(base, stack, runtimeEffectRegistry, {
		level,
		sourceWidth: effective.width,
		sourceHeight: effective.height,
		extraSources: new Map(
			overlay && [
				[
					SHA,
					{
						...overlay.image,
						sourceWidth: overlay.stored.width,
						sourceHeight: overlay.stored.height,
					},
				],
			],
		),
		checkpoint: () => undefined,
	});
	return result.image;
}

const rendered = (frame: Rendered) => frame.bitmap as unknown as FakeBitmap;

async function setup(
	base: RgbaImage,
	caps = {drag: 1_048_576, settle: SETTLE_PIXEL_CAP},
) {
	const worker = await startWorker<PreviewRequest, PreviewResponse>(
		() => import('../../src/worker/preview.worker.ts'),
		base,
	);
	let requestId = 0;
	let jobId = 100;
	const blob = new Blob(['base']);

	const loadBase = async (transform?: SourceTransform) => {
		requestId++;
		const id = requestId;
		worker.send({
			type: 'loadSource',
			requestId: id,
			sourceKey: 'base',
			blob,
			sourceWidth: base.width,
			sourceHeight: base.height,
			caps,
			transform,
		});
		await worker.next(
			(message): message is PreviewResponse =>
				message.type === 'sourceLoaded' && message.requestId === id,
		);
	};

	const postExtra = (file: Blob, stored: Size) => {
		requestId++;
		worker.send({
			type: 'loadExtraSource',
			requestId,
			sha256: SHA,
			blob: file,
			sourceWidth: stored.width,
			sourceHeight: stored.height,
		});
		return requestId;
	};

	const answer = async (id: number) =>
		worker.next(
			(message): message is Answer =>
				(message.type === 'extraSourceLoaded' || message.type === 'error') &&
				message.requestId === id,
		);

	const render = async (stack: EffectStack, level: PreviewLevel = 'settle') => {
		jobId++;
		const id = jobId;
		worker.send({
			type: 'render',
			jobId: id,
			generation: id,
			sourceKey: 'base',
			level,
			stack,
		});
		return worker.next(
			(message): message is Rendered =>
				message.type === 'rendered' && message.jobId === id,
		);
	};

	return {
		...worker,
		loadBase,
		postExtra,
		answer,
		render,
		async loadExtra(image: RgbaImage) {
			const response = await answer(postExtra(worker.addFile(image), image));
			if (response.type !== 'extraSourceLoaded') {
				throw new Error(response.message);
			}
		},
		setDragCap(pixels: number) {
			worker.send({type: 'setDragCap', pixels});
		},
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('preview worker extra sources (engine.md section 16.5)', () => {
	const base = patternImage(40, 30);
	const overlay = overlayImage(24, 36);
	const full = {image: overlay, stored: overlay};

	it('shows the base with a warning before the image arrives, and blends it after', async () => {
		const worker = await setup(base);
		await worker.loadBase();
		const stack = blendStack();

		const before = await worker.render(stack);
		expect(before.warnings).toEqual([
			{instanceId: 'blend000', code: 'missing-source'},
		]);
		expect(sameImage(rendered(before), base)).toBe(true);

		await worker.loadExtra(overlay);
		// The same stack: no stage of the render above may answer it.
		const after = await worker.render(stack);
		expect(after.warnings).toEqual([]);
		const expected = await expectedPixels(base, stack, 'settle', full);
		expect(sameImage(rendered(after), expected)).toBe(true);
		expect(sameImage(expected, base)).toBe(false);
	});

	it('decodes a large image to the 4 MP settle proxy and keeps its stored size', async () => {
		const large = overlayImage(3000, 2000);
		const worker = await setup(base);
		await worker.loadBase();
		await worker.loadExtra(large);

		const proxy = renderSizeForPixelCap(3000, 2000, SETTLE_PIXEL_CAP);
		const size = {width: proxy.width, height: proxy.height};
		expect(worker.decodes.at(-1)).toEqual(size);
		// `none` places stored pixels, which the proxy alone cannot tell.
		const stack = blendStack({fit: 'tile', scale: 0.1});
		const image = boxDownscale(large, size.width, size.height);
		const expected = await expectedPixels(base, stack, 'settle', {
			image,
			stored: large,
		});
		expect(sameImage(rendered(await worker.render(stack)), expected)).toBe(
			true,
		);
		const fromProxy = await expectedPixels(base, stack, 'settle', {
			image,
			stored: size,
		});
		expect(sameImage(expected, fromProxy)).toBe(false);
	}, 60_000);

	it('renders drag with a proxy at the drag cap', async () => {
		// 300 px: a 20 x 15 base and a 14 x 21 overlay.
		const worker = await setup(base, {drag: 300, settle: SETTLE_PIXEL_CAP});
		await worker.loadBase();
		await worker.loadExtra(overlay);
		const stack = blendStack({fit: 'none'});

		const size = renderSizeForPixelCap(24, 36, 300);
		const expected = await expectedPixels(
			boxDownscale(base, 20, 15),
			stack,
			'drag',
			{
				image: boxDownscale(overlay, size.width, size.height),
				stored: overlay,
			},
			base,
		);
		const frame = await worker.render(stack, 'drag');
		expect(sameImage(rendered(frame), expected)).toBe(true);
	});

	it('resizes the drag proxy when the cap changes, though the base keeps its size', async () => {
		// The base is under every cap here, so only the overlay proxy changes.
		const small = patternImage(12, 9);
		const worker = await setup(small, {drag: 600, settle: SETTLE_PIXEL_CAP});
		await worker.loadBase();
		await worker.loadExtra(overlay);
		const stack = blendStack({fit: 'stretch'});
		const at = async (pixels: number) => {
			const size = renderSizeForPixelCap(24, 36, pixels);
			return expectedPixels(small, stack, 'drag', {
				image: boxDownscale(overlay, size.width, size.height),
				stored: overlay,
			});
		};

		const first = await worker.render(stack, 'drag');
		expect(sameImage(rendered(first), await at(600))).toBe(true);
		worker.setDragCap(150);
		const second = await worker.render(stack, 'drag');
		expect(sameImage(rendered(second), await at(150))).toBe(true);
		expect(sameImage(await at(150), await at(600))).toBe(false);
	});

	it('does not reuse a stage of an image unloaded and loaded again at another cap', async () => {
		const small = patternImage(12, 9);
		const worker = await setup(small, {drag: 600, settle: SETTLE_PIXEL_CAP});
		await worker.loadBase();
		await worker.loadExtra(overlay);
		const stack = blendStack({fit: 'stretch'});
		await worker.render(stack, 'drag');

		worker.send({type: 'unloadExtraSource', sha256: SHA});
		worker.setDragCap(150);
		await worker.loadExtra(overlay);
		const size = renderSizeForPixelCap(24, 36, 150);
		const expected = await expectedPixels(small, stack, 'drag', {
			image: boxDownscale(overlay, size.width, size.height),
			stored: overlay,
		});
		const frame = await worker.render(stack, 'drag');
		expect(sameImage(rendered(frame), expected)).toBe(true);
	});

	it('takes the drag cap of a new source', async () => {
		const worker = await setup(base, {drag: 300, settle: SETTLE_PIXEL_CAP});
		await worker.loadExtra(overlay);
		await worker.loadBase();
		const stack = blendStack({fit: 'stretch'});
		const size = renderSizeForPixelCap(24, 36, 300);
		const expected = await expectedPixels(
			boxDownscale(base, 20, 15),
			stack,
			'drag',
			{
				image: boxDownscale(overlay, size.width, size.height),
				stored: overlay,
			},
			base,
		);
		const frame = await worker.render(stack, 'drag');
		expect(sameImage(rendered(frame), expected)).toBe(true);
	});

	it('drops an unloaded image', async () => {
		const worker = await setup(base);
		await worker.loadBase();
		await worker.loadExtra(overlay);
		const stack = blendStack();
		await worker.render(stack);

		worker.send({type: 'unloadExtraSource', sha256: SHA});
		const frame = await worker.render(stack);
		expect(frame.warnings).toMatchObject([{code: 'missing-source'}]);
		expect(sameImage(rendered(frame), base)).toBe(true);
	});

	it('does not bring back an image unloaded while it was decoding', async () => {
		const worker = await setup(base);
		await worker.loadBase();
		const id = worker.postExtra(worker.addFile(overlay), overlay);
		worker.send({type: 'unloadExtraSource', sha256: SHA});
		const frame = await worker.render(blendStack());

		expect(frame.warnings).toMatchObject([{code: 'missing-source'}]);
		expect(
			worker.posted.some(
				(message) => 'requestId' in message && message.requestId === id,
			),
		).toBe(false);
	});

	it('answers a second load of a loaded image without decoding it again', async () => {
		const worker = await setup(base);
		await worker.loadExtra(overlay);
		const count = worker.decodes.length;
		await worker.loadExtra(overlay);
		expect(worker.decodes).toHaveLength(count);
	});

	it('keeps it when the source is reloaded, transformed or unloaded', async () => {
		const worker = await setup(base);
		await worker.loadExtra(overlay);
		const count = worker.decodes.length;
		await worker.loadBase();
		worker.send({type: 'unloadSource', sourceKey: 'base'});
		const turned = {...IDENTITY_TRANSFORM, rotation: 90 as const};
		await worker.loadBase(turned);

		// The geometry turns the base only (engine.md section 16.5).
		const image = applyTransform(base, turned);
		const stack = blendStack({fit: 'none'});
		const expected = await expectedPixels(image, stack, 'settle', full);
		expect(sameImage(rendered(await worker.render(stack)), expected)).toBe(
			true,
		);
		// Only the two loads of the base decoded anything more.
		expect(worker.decodes).toHaveLength(count + 2);
	});

	it('answers an image it cannot decode with an error for that request', async () => {
		const worker = await setup(base);
		await worker.loadBase();
		const id = worker.postExtra(worker.addFile('broken'), overlay);

		await expect(worker.answer(id)).resolves.toMatchObject({
			type: 'error',
			code: 'decode-failed',
		});
		// The next one is decoded as usual.
		await worker.loadExtra(overlay);
		const frame = await worker.render(blendStack());
		expect(frame.warnings).toEqual([]);
	});
});
