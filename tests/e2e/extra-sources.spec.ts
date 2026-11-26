import {readFile} from 'node:fs/promises';
import {expect, test, type Page} from '@playwright/test';
import {renderSize} from '../../src/codec/decode.ts';
import {imageBlendSpec} from '../../src/engine/effects/image-blend-spec.ts';
import {effectRegistry} from '../../src/engine/effects/index.ts';
import {defaultParams} from '../../src/engine/params.ts';
import {renderStack} from '../../src/engine/pipeline.ts';
import {
	applyTransform,
	IDENTITY_TRANSFORM,
	type SourceTransform,
} from '../../src/engine/transform.ts';
import type {
	EffectStack,
	ParamValue,
	RgbaImage,
} from '../../src/engine/types.ts';
import type {AppRuntime} from '../../src/state/index.ts';
import {exportTransform} from '../../src/worker/geometry.ts';
import {decodeRgbaPng} from '../golden/helpers.ts';
import {
	openRenderPage,
	pixelSortStack,
	sha256,
	syntheticImage,
	type PageHelpers,
} from './render-fixtures.ts';

type PageScope = {renderTest: PageHelpers; __psgRuntime?: AppRuntime};

const BASE = {width: 320, height: 240};
// Neither extra image has the base's size or shape.
const EXTRA_B = {width: 200, height: 300};
const EXTRA_A = {width: 90, height: 70};

const TRANSFORM: SourceTransform = {
	...IDENTITY_TRANSFORM,
	rotation: 90,
	crop: {x: 10, y: 20, width: 200, height: 260},
};

function blendInstance(
	id: string,
	image: string,
	params: Record<string, ParamValue>,
): EffectStack['instances'][number] {
	return {
		id,
		type: 'imageBlend',
		version: 1,
		enabled: true,
		params: {...defaultParams(imageBlendSpec.params), image, ...params},
		mix: 1,
		blend: 'normal',
	};
}

// `none` places stored pixels one to one, turned off the pixel grid.
function sideBStack(image: string): EffectStack {
	const sort = pixelSortStack({angle: 30}).instances;
	return {
		schemaVersion: 1,
		instances: [
			...sort,
			blendInstance('blendb00', image, {
				blendMode: 'difference',
				fit: 'none',
				offsetX: 0.2,
				rotation: 33.3,
			}),
		],
	};
}

function sideAStack(image: string): EffectStack {
	return {
		schemaVersion: 1,
		instances: [
			blendInstance('blenda00', image, {
				blendMode: 'screen',
				fit: 'tile',
				scale: 0.5,
				opacity: 0.7,
			}),
		],
	};
}

/**
 Stores a project that blends one image on each side of the split view under a
 geometry transform. No control picks an image yet, so the test commits it
 through the store and reopens the app.
 */
async function openBlendProject(page: Page) {
	await openRenderPage(page);
	const halfB = renderSize(EXTRA_B.width, EXTRA_B.height, 0.5);
	const stored = await page.evaluate(
		async (input) => {
			const scope = globalThis as unknown as PageScope;
			const booted = await scope.__psgRuntime!.ready;
			if (booted.status !== 'ready') {
				throw new Error(`Expected ready boot, got ${booted.status}`);
			}

			const {store} = booted.bundle;
			const add = async (name: string, size: typeof input.base) => {
				const blob = await scope.renderTest.sourceBlob(
					size.width,
					size.height,
					'image/png',
				);
				return store
					.getState()
					.importImage({name: `${name}.png`, blob, ...size});
			};

			const extraB = await add('extra-b', input.extraB);
			const extraA = await add('extra-a', input.extraA);
			const base = await add('base', input.base);
			const b = extraB.source.sha256;
			const a = extraA.source.sha256;
			const withImage = (stack: typeof input.stackB, image: string) => ({
				...stack,
				instances: stack.instances.map((instance) =>
					instance.type === 'imageBlend'
						? {...instance, params: {...instance.params, image}}
						: instance,
				),
			});

			await store.getState().setTransform(base.project.id, input.transform);
			await store.getState().applyStack(withImage(input.stackB, b), 'Blend B');
			await store.getState().setCompareMode('split');
			await store.getState().setEditSide('a');
			await store.getState().applyStack(withImage(input.stackA, a), 'Blend A');
			await store.getState().flushViewState();

			// The browser's own half-size decode of side B's image, as an export at
			// 1/2 asks for it.
			const stored = await booted.bundle.repository.getSource(b);
			const half = await globalThis.createImageBitmap(stored!.blob, {
				imageOrientation: 'from-image',
				colorSpaceConversion: 'default',
				resizeWidth: input.halfB.width,
				resizeHeight: input.halfB.height,
				resizeQuality: 'high',
			});
			return {a, b, halfB: [...scope.renderTest.bitmapPixels(half)]};
		},
		{
			base: BASE,
			extraA: EXTRA_A,
			extraB: EXTRA_B,
			transform: TRANSFORM,
			stackA: sideAStack(''),
			stackB: sideBStack(''),
			halfB,
		},
	);
	await page.reload();
	await expect(page.getByRole('button', {name: 'Export'})).toBeEnabled();
	return {
		a: stored.a,
		b: stored.b,
		halfExtraB: {
			width: halfB.width,
			height: halfB.height,
			data: Uint8ClampedArray.from(stored.halfB),
		},
	};
}

// The preview frame of one side once it has every image, hashed.
async function previewFrame(page: Page, side: 'render' | 'renderA') {
	return page.evaluate(async (key) => {
		const booted = await (globalThis as unknown as PageScope).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		const {frame} = booted.bundle.store.getState()[key];
		if (
			frame?.level !== 'settle' ||
			frame.sourcesPending ||
			frame.warnings.length > 0
		) {
			return null;
		}

		const canvas = new globalThis.OffscreenCanvas(frame.width, frame.height);
		const context = canvas.getContext('2d', {willReadFrequently: true})!;
		context.drawImage(frame.bitmap, 0, 0);
		const {data} = context.getImageData(0, 0, frame.width, frame.height);
		const digest = await crypto.subtle.digest('SHA-256', data);
		return {
			width: frame.width,
			height: frame.height,
			hash: [...new Uint8Array(digest)]
				.map((byte) => byte.toString(16).padStart(2, '0'))
				.join(''),
		};
	}, side);
}

// The reference: transform and effects run directly in Node.
async function engine(
	stack: EffectStack,
	level: 'settle' | 'full',
	hash: string,
	extra: RgbaImage,
	stored: {width: number; height: number},
	scale = 1,
) {
	const source = syntheticImage(BASE.width, BASE.height);
	const effective = applyTransform(source, TRANSFORM);
	const image =
		scale === 1
			? effective
			: applyTransform(
					source,
					exportTransform(
						TRANSFORM,
						renderSize(effective.width, effective.height, scale),
					),
				);
	const result = await renderStack(image, stack, effectRegistry, {
		level,
		sourceWidth: effective.width,
		sourceHeight: effective.height,
		extraSources: new Map([
			[
				hash,
				{...extra, sourceWidth: stored.width, sourceHeight: stored.height},
			],
		]),
		checkpoint: () => undefined,
	});
	expect(result.warnings).toEqual([]);
	return {
		width: result.image.width,
		height: result.image.height,
		hash: sha256(result.image.data),
	};
}

async function download(page: Page, side: string, size: 'Full' | '1/2') {
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('radio', {name: side}).click();
	await dialog.getByRole('radio', {name: size, exact: true}).click();
	const pending = page.waitForEvent('download');
	await dialog.getByRole('button', {name: 'Download'}).click();
	const file = await pending;
	const image = decodeRgbaPng(await readFile(await file.path()));
	return {width: image.width, height: image.height, hash: sha256(image.data)};
}

test.describe('a project that blends stored images', () => {
	test('previews and exports both split sides as the engine renders them', async ({
		page,
	}) => {
		const problems: string[] = [];
		page.on('pageerror', (error) => {
			problems.push(error.message);
		});
		page.on('console', (message) => {
			if (message.type() === 'error') {
				problems.push(message.text());
			}
		});

		const {a, b, halfExtraB} = await openBlendProject(page);
		const extraA = syntheticImage(EXTRA_A.width, EXTRA_A.height);
		const extraB = syntheticImage(EXTRA_B.width, EXTRA_B.height);

		const previewB = await engine(sideBStack(b), 'settle', b, extraB, EXTRA_B);
		const previewA = await engine(sideAStack(a), 'settle', a, extraA, EXTRA_A);
		await expect
			.poll(async () => previewFrame(page, 'render'))
			.toEqual(previewB);
		await expect
			.poll(async () => previewFrame(page, 'renderA'))
			.toEqual(previewA);

		await page.getByRole('button', {name: 'Export'}).click();
		expect(await download(page, 'B · Right', 'Full')).toEqual(
			await engine(sideBStack(b), 'full', b, extraB, EXTRA_B),
		);
		// The main coordinator never previewed side A's image.
		expect(await download(page, 'A · Left', 'Full')).toEqual(
			await engine(sideAStack(a), 'full', a, extraA, EXTRA_A),
		);

		const halfB = await download(page, 'B · Right', '1/2');
		expect(halfB).toEqual(
			await engine(sideBStack(b), 'full', b, halfExtraB, EXTRA_B, 0.5),
		);
		expect(problems).toEqual([]);
	});
});
