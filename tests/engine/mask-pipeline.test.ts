import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import type {InstanceMask, MaskBitmap} from '../../src/engine/mask/types.ts';
import {floorDiv} from '../../src/engine/math.ts';
import {
	createStageCache,
	renderStack,
	type PipelineOptions,
} from '../../src/engine/pipeline.ts';
import {hash32} from '../../src/engine/random.ts';
import {createRegistry} from '../../src/engine/registry.ts';
import {IDENTITY_TRANSFORM} from '../../src/engine/transform.ts';
import type {
	BlendMode,
	EffectDefinition,
	EffectInstance,
	EffectStack,
	RgbaImage,
} from '../../src/engine/types.ts';
import {
	addEffect,
	bytes,
	image,
	instance,
	invertEffect,
	noiseEffect,
	noiseImage,
	options,
	stack,
} from './sample-effects.ts';

const HASH = 'ef'.repeat(32);
const OTHER = '12'.repeat(32);

// Records the mask each render was given; its selection view paints the mask.
function maskProbe(seen: Array<number[] | null>): EffectDefinition<{}> {
	return {
		type: 'testMaskProbe',
		version: 1,
		label: 'Mask probe',
		description: 'Test effect.',
		category: 'color',
		params: {},
		debugViews: ['selection'],
		render(input, output, _params, ctx) {
			seen.push(ctx.mask && [...ctx.mask]);
			output.data.fill(255);
			if (ctx.debugView === 'selection') {
				for (let p = 0; p < input.data.length; p += 4) {
					output.data[p] = ctx.mask?.[p / 4] ?? 9;
				}
			}
		},
	};
}

const seen: Array<number[] | null> = [];
const amounts: number[] = [];
const registry = createRegistry([
	addEffect((amount) => {
		amounts.push(amount);
	}),
	invertEffect,
	noiseEffect,
	maskProbe(seen),
]);

function paint(overrides: Partial<InstanceMask> = {}): InstanceMask {
	return {
		kind: 'paint',
		asset: HASH,
		invert: false,
		feather: 0,
		...overrides,
	} as InstanceMask;
}

const luma: InstanceMask = {
	kind: 'luma',
	invert: false,
	feather: 0,
	range: [0.5, 1],
	softness: 0,
};

function bitmap(
	width: number,
	height: number,
	value: (i: number) => number,
): MaskBitmap {
	return {
		width,
		height,
		data: Uint8Array.from({length: width * height}, (_, i) => value(i)),
	};
}

function masked(
	source: RgbaImage,
	overrides: Partial<PipelineOptions> = {},
	mask: MaskBitmap = bitmap(source.width, source.height, (i) => i % 256),
): PipelineOptions {
	return options(source, {masks: new Map([[HASH, mask]]), ...overrides});
}

function maskedStack(...instances: EffectInstance[]): EffectStack {
	return {schemaVersion: 2, instances};
}

async function render(
	source: RgbaImage,
	effects: EffectStack,
	settings: PipelineOptions = masked(source),
) {
	return renderStack(source, effects, registry, settings);
}

describe('masked compositing in the pipeline', () => {
	const source = image(3, 1, [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
	const grid = bitmap(3, 1, (i) => [0, 128, 255][i]);

	it('weights the result by the mask even at mix 1 and blend normal', async () => {
		const result = await render(
			source,
			maskedStack(instance('testInvert', {mask: paint()})),
			masked(source, {}, grid),
		);
		expect(bytes(result.image)).toEqual([
			0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255,
		]);
		expect(result.warnings).toEqual([]);
	});

	it('passes the final mask to the effect, and null without one', async () => {
		seen.length = 0;
		await render(
			source,
			maskedStack(
				instance('testMaskProbe', {mask: paint({invert: true})}),
				instance('testMaskProbe'),
			),
			masked(source, {}, grid),
		);
		expect(seen).toEqual([[255, 127, 0], null]);
	});

	it('gives each instance its own mask in the shared buffer', async () => {
		seen.length = 0;
		await render(
			source,
			maskedStack(
				instance('testMaskProbe', {mask: paint({feather: 1})}),
				instance('testMaskProbe', {mask: paint({asset: ''})}),
				instance('testMaskProbe', {mask: paint()}),
			),
			masked(source, {}, grid),
		);
		expect(seen[1]).toEqual([0, 0, 0]);
		expect(seen[2]).toEqual([0, 128, 255]);
	});

	it('computes a brightness mask from the source, whatever runs above', async () => {
		const grey = image(2, 1, [100, 100, 100, 255, 200, 200, 200, 255]);
		const probe = instance('testMaskProbe', {mask: luma});
		for (const amount of [0, 100, -255]) {
			seen.length = 0;
			await render(
				grey,
				maskedStack(instance('testAdd', {params: {amount}}), probe),
			);
			expect(seen).toEqual([[0, 255]]);
		}
	});

	it('computes no mask for a disabled instance', async () => {
		let checkpoints = 0;
		const result = await render(
			source,
			maskedStack(
				instance('testInvert', {
					mask: {kind: 'newer'} as unknown as InstanceMask,
					enabled: false,
				}),
			),
			masked(source, {
				checkpoint() {
					checkpoints++;
				},
			}),
		);
		expect(result.warnings).toEqual([]);
		expect(checkpoints).toBe(0);
	});

	it('places the painted grid through options.geometry', async () => {
		seen.length = 0;
		// A 3 x 1 source rotated into a 1 x 3 effective image.
		const turned = noiseImage(1, 3);
		await render(
			turned,
			maskedStack(instance('testMaskProbe', {mask: paint()})),
			masked(
				turned,
				{
					geometry: {
						sourceWidth: 3,
						sourceHeight: 1,
						transform: {...IDENTITY_TRANSFORM, rotation: 90, flipY: true},
					},
				},
				grid,
			),
		);
		expect(seen).toEqual([[255, 128, 0]]);
	});

	it('reads only its inputs', async () => {
		const input = noiseImage(5, 4);
		const maskData = bitmap(5, 4, (i) => i * 12);
		const effects = maskedStack(
			instance('testInvert', {mask: paint({invert: true, feather: 2})}),
		);
		const before = structuredClone({input, maskData, effects});
		await render(input, effects, masked(input, {}, maskData));
		expect({input, maskData, effects}).toEqual(before);
	});
});

describe('missing masks', () => {
	const source = noiseImage(4, 3);
	const cases: Array<[string, unknown, 'missing-mask' | 'missing-source']> = [
		['an asset that was not supplied', paint({asset: OTHER}), 'missing-mask'],
		['a newer mask kind', {kind: 'depth', invert: true}, 'missing-mask'],
		['a mask that is not an object', null, 'missing-mask'],
		[
			'an image that was not supplied',
			{kind: 'image', source: OTHER, fit: 'cover', invert: true, feather: 0},
			'missing-source',
		],
	];

	it.each(cases)(
		'skips the instance for %s, never applying it everywhere',
		async (_name, mask, code) => {
			const effect = instance('testMaskProbe', {mask: mask as InstanceMask});
			const effects = maskedStack(effect);
			const stored = structuredClone(effects);
			seen.length = 0;
			const result = await render(source, effects);
			expect(seen).toEqual([]);
			expect(result.image).toEqual(source);
			expect(result.warnings).toEqual([{instanceId: effect.id, code}]);
			expect(result.perInstanceMs).toEqual([0]);
			expect(effects).toEqual(stored);
		},
	);

	it('skips a painted mask of the wrong size and runs the other instances', async () => {
		const skipped = instance('testInvert', {mask: paint()});
		const result = await render(
			source,
			maskedStack(skipped, instance('testAdd', {params: {amount: 1}})),
			masked(
				source,
				{},
				bitmap(3, 4, () => 255),
			),
		);
		const added = await render(
			source,
			stack(instance('testAdd', {params: {amount: 1}})),
		);
		expect(result.image).toEqual(added.image);
		expect(result.warnings).toEqual([
			{instanceId: skipped.id, code: 'missing-mask'},
		]);
	});

	it('reports progress to the end when every instance is skipped', async () => {
		const progress: number[] = [];
		await render(
			source,
			maskedStack(instance('testInvert', {mask: paint({asset: OTHER})})),
			masked(source, {
				onProgress(fraction) {
					progress.push(fraction);
				},
			}),
		);
		expect(progress.at(-1)).toBe(1);
	});

	it('warns once when the parameter and the mask miss the same kind of input', async () => {
		const withImage: EffectDefinition<{image: string}> = {
			...invertEffect,
			type: 'testImage',
			params: {image: {kind: 'image', label: 'I', group: 'Main', default: ''}},
		};
		const effect = instance('testImage', {
			params: {image: OTHER},
			mask: {
				kind: 'image',
				source: HASH,
				fit: 'cover',
				invert: false,
				feather: 0,
			},
		});
		const result = await renderStack(
			source,
			maskedStack(effect),
			createRegistry([withImage]),
			options(source),
		);
		expect(result.warnings).toEqual([
			{instanceId: effect.id, code: 'missing-source'},
		]);
		expect(result.image).toEqual(source);
	});
});

describe('stage cache with masks (engine.md sections 8.5 and 16.6)', () => {
	const source = noiseImage(4, 4);
	const grid = bitmap(4, 4, (i) => i * 17);

	function pair(mask: InstanceMask) {
		return [
			instance('testAdd', {params: {amount: 1}}),
			instance('testAdd', {params: {amount: 2}, mask}),
			instance('testAdd', {params: {amount: 3}}),
		];
	}

	it('stores nothing from a missing mask on, and never reuses that frame', async () => {
		const cache = createStageCache();
		const effects = maskedStack(...pair(paint()));
		amounts.length = 0;
		const missing = await render(source, effects, options(source, {cache}));
		expect(amounts).toEqual([1, 3]);
		expect(cache.size).toBe(1);

		amounts.length = 0;
		const supplied = await render(
			source,
			effects,
			masked(source, {cache}, grid),
		);
		const fresh = await render(source, effects, masked(source, {}, grid));
		expect(supplied.image).toEqual(fresh.image);
		expect(supplied.image).not.toEqual(missing.image);
		expect(amounts.slice(0, 2)).toEqual([2, 3]);
		expect(cache.size).toBe(3);
	});

	it('skips a cached later stage once the mask is gone', async () => {
		const cache = createStageCache();
		const effects = maskedStack(...pair(paint()));
		await render(source, effects, masked(source, {cache}, grid));
		const without = await render(source, effects, options(source, {cache}));
		const fresh = await render(source, effects, options(source));
		expect(without.image).toEqual(fresh.image);
		expect(without.warnings).toHaveLength(1);
	});

	it('re-renders from the instance whose mask changed', async () => {
		const cache = createStageCache();
		const instances = pair(paint());
		await render(
			source,
			maskedStack(...instances),
			masked(source, {cache}, grid),
		);
		for (const change of [
			{invert: true},
			{feather: 1},
			{asset: ''},
		] satisfies Array<Partial<InstanceMask> & Record<string, unknown>>) {
			const edited = maskedStack(
				instances[0],
				{...instances[1], mask: paint(change)},
				instances[2],
			);
			amounts.length = 0;
			const cached = await render(
				source,
				edited,
				masked(source, {cache}, grid),
			);
			expect(amounts).toEqual([2, 3]);
			const fresh = await render(source, edited, masked(source, {}, grid));
			expect(cached.image).toEqual(fresh.image);
		}
	});

	it('keeps the earlier stages when a later instance gains a mask', async () => {
		const cache = createStageCache();
		const [first, second] = pair(paint());
		const plain = {...second, mask: undefined};
		await render(source, stack(first, plain), options(source, {cache}));
		amounts.length = 0;
		await render(
			source,
			maskedStack(first, second),
			masked(source, {cache}, grid),
		);
		expect(amounts).toEqual([2]);
	});
});

describe('debug views with masks', () => {
	const source = noiseImage(3, 1);
	const grid = bitmap(3, 1, (i) => [0, 128, 255][i]);

	it('passes the mask to the selection view and skips the composite', async () => {
		const probe = instance('testMaskProbe', {mask: paint(), mix: 0.5});
		const result = await render(
			source,
			maskedStack(probe),
			masked(source, {debug: {instanceId: probe.id, view: 'selection'}}, grid),
		);
		expect([0, 4, 8].map((p) => result.image.data[p])).toEqual([0, 128, 255]);
	});

	it('composites an effect without a selection view and stops there', async () => {
		const first = instance('testInvert', {mask: paint()});
		const result = await render(
			source,
			maskedStack(first, instance('testInvert')),
			masked(source, {debug: {instanceId: first.id, view: 'selection'}}, grid),
		);
		const expected = await render(
			source,
			maskedStack(first),
			masked(source, {}, grid),
		);
		expect(result.image).toEqual(expected.image);
	});

	it('renders the whole stack when the debug instance has a missing mask', async () => {
		const probe = instance('testMaskProbe', {mask: paint({asset: OTHER})});
		const result = await render(
			source,
			maskedStack(probe, instance('testInvert')),
			masked(source, {debug: {instanceId: probe.id, view: 'selection'}}, grid),
		);
		const inverted = await render(source, stack(instance('testInvert')));
		expect(result.image).toEqual(inverted.image);
	});
});

describe('mask properties (engine.md section 16.6)', () => {
	const caseArb = fc.record({
		width: fc.integer({min: 1, max: 12}),
		height: fc.integer({min: 1, max: 12}),
		seed: fc.integer({min: 0, max: 0xff_ff}),
		type: fc.constantFrom('testInvert', 'testNoise', 'testAdd'),
		mix: fc.integer({min: 0, max: 100}).map((m) => m / 100),
		blend: fc.constantFrom<BlendMode>(
			'normal',
			'lighten',
			'darken',
			'difference',
		),
		feather: fc.integer({min: 0, max: 20}),
	});
	type Case = typeof caseArb extends fc.Arbitrary<infer T> ? T : never;

	function setup({width, height, seed, type, mix, blend}: Case) {
		const source = noiseImage(width, height, seed);
		const effect = instance(type, {mix, blend, params: {seed}});
		return {source, effect};
	}

	it('an all-255 mask equals no mask', async () => {
		await fc.assert(
			fc.asyncProperty(caseArb, async (given) => {
				const {source, effect} = setup(given);
				const full = bitmap(source.width, source.height, () => 255);
				const mask = paint({feather: given.feather});
				const withMask = await render(
					source,
					maskedStack({...effect, mask}),
					masked(source, {}, full),
				);
				const without = await render(source, stack(effect));
				expect(withMask.image).toEqual(without.image);
			}),
		);
	});

	it('an all-0 mask equals the instance switched off', async () => {
		await fc.assert(
			fc.asyncProperty(caseArb, async (given) => {
				const {source, effect} = setup(given);
				const none = bitmap(source.width, source.height, () => 0);
				const mask = paint({feather: given.feather});
				const withMask = await render(
					source,
					maskedStack({...effect, mask}),
					masked(source, {}, none),
				);
				const off = await render(source, stack({...effect, enabled: false}));
				expect(withMask.image).toEqual(off.image);
			}),
		);
	});

	it('inverting twice is the identity', async () => {
		await fc.assert(
			fc.asyncProperty(caseArb, async (given) => {
				const {source, effect} = setup(given);
				const noise = bitmap(
					source.width,
					source.height,
					(i) => hash32(given.seed, i) % 256,
				);
				const negative = bitmap(
					source.width,
					source.height,
					(i) => 255 - noise.data[i],
				);
				const straight = await render(
					source,
					maskedStack({...effect, mask: paint()}),
					masked(source, {}, noise),
				);
				const twice = await render(
					source,
					maskedStack({...effect, mask: paint({invert: true})}),
					masked(source, {}, negative),
				);
				expect(twice.image).toEqual(straight.image);
			}),
		);
	});

	it('every channel is the section 4.5 weighted mix', async () => {
		await fc.assert(
			fc.asyncProperty(caseArb, async (given) => {
				const {source, effect} = setup({...given, feather: 0});
				const noise = bitmap(
					source.width,
					source.height,
					(i) => hash32(given.seed, i) % 256,
				);
				const result = await render(
					source,
					maskedStack({...effect, mask: paint()}),
					masked(source, {}, noise),
				);
				const raw = await render(
					source,
					stack({...effect, mix: 1, blend: 'normal'}),
				);
				const m = Math.round(effect.mix * 100);
				const blended = {
					normal: (_i: number, f: number) => f,
					lighten: Math.max,
					darken: Math.min,
					difference: (i: number, f: number) => Math.abs(i - f),
				}[effect.blend];
				const expected = [...source.data].map((i, p) => {
					const f = raw.image.data[p];
					const b = p % 4 === 3 ? f : blended(i, f);
					const w = m * noise.data[Math.floor(p / 4)];
					return floorDiv(2 * (i * (25_500 - w) + b * w) + 25_500, 51_000);
				});
				expect(bytes(result.image)).toEqual(expected);
			}),
		);
	});
});
