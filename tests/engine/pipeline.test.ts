import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {
	createRenderContext,
	createStageCache,
	renderStack,
} from '../../src/engine/pipeline.ts';
import {validateParams} from '../../src/engine/params.ts';
import {createRegistry} from '../../src/engine/registry.ts';
import {
	Cancelled,
	canonicalStackJson,
	createImage,
	type BlendMode,
	type EffectDefinition,
	type EffectStack,
	type RenderContext,
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
	selectionEffect,
	stack,
} from './sample-effects.ts';

const registry = createRegistry([
	addEffect(),
	invertEffect,
	noiseEffect,
	selectionEffect,
]);

const pixel = image(1, 1, [200, 50, 10, 255]);

describe('renderStack: order and skipping', () => {
	it('returns a copy of the source for an empty stack', async () => {
		const source = noiseImage(4, 3);
		const result = await renderStack(
			source,
			stack(),
			registry,
			options(source),
		);
		expect(result.image).toEqual(source);
		expect(result.image.data).not.toBe(source.data);
		expect(result.perInstanceMs).toEqual([]);
		expect(result.warnings).toEqual([]);
	});

	it('applies instances in array order', async () => {
		const add = instance('testAdd', {params: {amount: 20}});
		const invert = instance('testInvert');
		const sumThenInvert = await renderStack(
			pixel,
			stack(add, invert),
			registry,
			options(pixel),
		);
		const invertFirst = await renderStack(
			pixel,
			stack(invert, add),
			registry,
			options(pixel),
		);
		expect(bytes(sumThenInvert.image)).toEqual([35, 185, 225, 255]);
		expect(bytes(invertFirst.image)).toEqual([75, 225, 255, 255]);
	});

	it('skips a disabled instance without rendering it', async () => {
		const amounts: number[] = [];
		const counting = createRegistry([
			addEffect((amount) => {
				amounts.push(amount);
			}),
		]);
		const result = await renderStack(
			pixel,
			stack(
				instance('testAdd', {params: {amount: 1}}),
				instance('testAdd', {params: {amount: 100}, enabled: false}),
				instance('testAdd', {params: {amount: 2}}),
			),
			counting,
			options(pixel),
		);
		expect(amounts).toEqual([1, 2]);
		expect(bytes(result.image)).toEqual([203, 53, 13, 255]);
		expect(result.perInstanceMs).toHaveLength(3);
		expect(result.perInstanceMs[1]).toBe(0);
		expect(result.warnings).toEqual([]);
	});

	it('skips an unknown type and a newer version with a warning each', async () => {
		const unknown = instance('fromTheFuture', {params: {tiles: 4}});
		const newer = instance('testInvert', {version: 2});
		const result = await renderStack(
			pixel,
			stack(unknown, instance('testAdd', {params: {amount: 5}}), newer),
			registry,
			options(pixel),
		);
		expect(bytes(result.image)).toEqual([205, 55, 15, 255]);
		expect(result.warnings).toEqual([
			{instanceId: unknown.id, code: 'unknown-type'},
			{instanceId: newer.id, code: 'newer-version'},
		]);
	});

	it('does not warn about a disabled unknown instance', async () => {
		const result = await renderStack(
			pixel,
			stack(instance('fromTheFuture', {enabled: false})),
			registry,
			options(pixel),
		);
		expect(result.warnings).toEqual([]);
	});

	it('leaves the stack untouched, so unknown types and parameters survive a save', async () => {
		const original = {
			schemaVersion: 1,
			instances: [
				{
					...instance('fromTheFuture', {version: 7}),
					params: {tiles: 4, shape: {sides: 6}},
					maskId: 'm1',
				},
				instance('testAdd', {params: {amount: 9999, extra: 'kept'}}),
				instance('testInvert', {version: 3, params: {strength: 0.4}}),
			],
		} as unknown as EffectStack;
		const snapshot = JSON.stringify(original);
		const frozen = structuredClone(original);
		await renderStack(pixel, original, registry, options(pixel));
		expect(original).toEqual(frozen);
		expect(JSON.stringify(original)).toBe(snapshot);
		expect(JSON.parse(canonicalStackJson(original))).toEqual(frozen);
	});
});

describe('renderStack: parameters', () => {
	it('validates before render and warns when it had to change a value', async () => {
		const wild = instance('testAdd', {params: {amount: 9999}});
		const result = await renderStack(
			image(1, 1, [0, 0, 0, 255]),
			stack(wild),
			registry,
			options(pixel),
		);
		expect(bytes(result.image)).toEqual([255, 255, 255, 255]);
		expect(result.warnings).toEqual([
			{instanceId: wild.id, code: 'params-fixed'},
		]);
	});

	it('fills a missing parameter from the default and says so', async () => {
		const bare = instance('testAdd');
		const result = await renderStack(
			pixel,
			stack(bare),
			registry,
			options(pixel),
		);
		expect(bytes(result.image)).toEqual([210, 60, 20, 255]);
		expect(result.warnings).toEqual([
			{instanceId: bare.id, code: 'params-fixed'},
		]);
	});

	it('migrates an older instance before rendering, without a warning', async () => {
		const seen: unknown[] = [];
		const v2: EffectDefinition<{amount: number}> = {
			...addEffect((amount) => {
				seen.push(amount);
			}),
			version: 2,
			migrations: {1: (old) => ({amount: old.delta ?? 0})},
		};
		const old = instance('testAdd', {version: 1, params: {delta: 3}});
		const result = await renderStack(
			pixel,
			stack(old),
			createRegistry([v2]),
			options(pixel),
		);
		expect(seen).toEqual([3]);
		expect(bytes(result.image)).toEqual([203, 53, 13, 255]);
		expect(result.warnings).toEqual([]);
		expect(old.params).toEqual({delta: 3});
		expect(old.version).toBe(1);
	});
});

describe('renderStack: mix and blend', () => {
	// Input (200, 50, 10, 255); testInvert gives (55, 205, 245, 255).
	it.each<[BlendMode, number, number[]]>([
		['normal', 1, [55, 205, 245, 255]],
		['normal', 0, [200, 50, 10, 255]],
		['normal', 0.5, [128, 128, 128, 255]],
		['normal', 0.2, [171, 81, 57, 255]],
		['lighten', 1, [200, 205, 245, 255]],
		['darken', 1, [55, 50, 10, 255]],
		['difference', 1, [145, 155, 235, 255]],
		['difference', 0.5, [173, 103, 123, 255]],
	])('%s at mix %d', async (blend, mix, expected) => {
		const result = await renderStack(
			pixel,
			stack(instance('testInvert', {mix, blend})),
			registry,
			options(pixel),
		);
		expect(bytes(result.image)).toEqual(expected);
	});

	it('mixes against the instance input, not the original source', async () => {
		const result = await renderStack(
			pixel,
			stack(
				instance('testAdd', {params: {amount: 20}}),
				instance('testInvert', {mix: 0.5}),
			),
			registry,
			options(pixel),
		);
		// Input to the second instance is (220, 70, 30); its inverse is (35, 185, 225).
		expect(bytes(result.image)).toEqual([128, 128, 128, 255]);
	});
});

describe('renderStack: debug view', () => {
	it('shows the selection view of the named instance and stops there', async () => {
		const amounts: number[] = [];
		const counting = createRegistry([
			addEffect((amount) => {
				amounts.push(amount);
			}),
			selectionEffect,
		]);
		const target = instance('testSelection', {mix: 0.5, blend: 'difference'});
		const source = noiseImage(3, 2);
		const result = await renderStack(
			source,
			stack(
				instance('testAdd', {params: {amount: 1}}),
				target,
				instance('testAdd', {params: {amount: 2}}),
			),
			counting,
			options(source, {debug: {instanceId: target.id, view: 'selection'}}),
		);
		expect(amounts).toEqual([1]);
		expect(bytes(result.image)).toEqual(Array.from({length: 24}, () => 255));
	});

	it('gives other instances the normal view', async () => {
		const views: string[] = [];
		const spy: EffectDefinition<{}> = {
			...selectionEffect,
			type: 'testSpy',
			render(input, output, _params, ctx) {
				views.push(ctx.debugView);
				output.data.set(input.data);
			},
		};
		const first = instance('testSpy');
		const second = instance('testSpy');
		await renderStack(
			pixel,
			stack(first, second),
			createRegistry([spy]),
			options(pixel, {debug: {instanceId: second.id, view: 'selection'}}),
		);
		expect(views).toEqual(['none', 'selection']);
	});

	it('renders an effect with no selection view normally, mix included, and still stops', async () => {
		const target = instance('testInvert', {mix: 0.5});
		const result = await renderStack(
			pixel,
			stack(target, instance('testAdd', {params: {amount: 50}})),
			registry,
			options(pixel, {debug: {instanceId: target.id, view: 'selection'}}),
		);
		expect(bytes(result.image)).toEqual([128, 128, 128, 255]);
	});

	it('renders the whole stack when the named instance is disabled', async () => {
		const target = instance('testSelection', {enabled: false});
		const result = await renderStack(
			pixel,
			stack(target, instance('testAdd', {params: {amount: 5}})),
			registry,
			options(pixel, {debug: {instanceId: target.id, view: 'selection'}}),
		);
		expect(bytes(result.image)).toEqual([205, 55, 15, 255]);
	});
});

describe('renderStack: render context', () => {
	async function capture(
		params: Record<string, number>,
		sourceWidth: number,
	): Promise<RenderContext> {
		let seen: RenderContext | undefined;
		const spy: EffectDefinition<{seed: number}> = {
			...noiseEffect,
			type: 'testSpy',
			params: {seed: noiseEffect.params.seed},
			render(input, output, _params, ctx) {
				seen = ctx;
				output.data.set(input.data);
			},
		};
		const source = noiseImage(50, 20);
		await renderStack(
			source,
			stack(instance('testSpy', {params})),
			createRegistry([spy]),
			options(source, {level: 'drag', sourceWidth, sourceHeight: 80}),
		);
		return seen!;
	}

	it('carries the level, source size, scale and seed', async () => {
		const ctx = await capture({seed: 77}, 200);
		expect(ctx.level).toBe('drag');
		expect(ctx.sourceWidth).toBe(200);
		expect(ctx.sourceHeight).toBe(80);
		expect(ctx.scale).toBe(0.25);
		expect(ctx.seed).toBe(77);
		expect(ctx.debugView).toBe('none');
	});

	it('uses seed 0 for an effect with no seed parameter', async () => {
		let seed = -1;
		const spy: EffectDefinition<{}> = {
			...invertEffect,
			render(input, output, _params, ctx) {
				seed = ctx.seed;
				output.data.set(input.data);
			},
		};
		await renderStack(
			pixel,
			stack(instance('testInvert')),
			createRegistry([spy]),
			options(pixel),
		);
		expect(seed).toBe(0);
	});
});

describe('createRenderContext', () => {
	const ctx = createRenderContext({
		level: 'settle',
		sourceWidth: 400,
		sourceHeight: 300,
		renderWidth: 100,
	});

	it('px is roundHalfAway(sourcePx * scale)', () => {
		expect(ctx.scale).toBe(0.25);
		expect(ctx.px(8)).toBe(2);
		expect(ctx.px(10)).toBe(3);
		expect(ctx.px(-10)).toBe(-3);
		expect(ctx.px(1)).toBe(0);
	});

	it('pxLength never shrinks a positive length to 0', () => {
		expect(ctx.pxLength(1)).toBe(1);
		expect(ctx.pxLength(10)).toBe(3);
		expect(ctx.pxLength(0)).toBe(0);
		expect(ctx.pxLength(-4)).toBe(0);
	});

	it('toSource is Math.floor((renderCoord + 0.5) / scale)', () => {
		expect(ctx.toSource(0)).toBe(2);
		expect(ctx.toSource(1)).toBe(6);
		expect(ctx.toSource(99)).toBe(398);
	});

	it('defaults to seed 0, the normal view and a checkpoint that does nothing', () => {
		expect(ctx.seed).toBe(0);
		expect(ctx.debugView).toBe('none');
		expect(ctx.checkpoint()).toBeUndefined();
	});

	it('scratch reuses a slot, keeps slots apart and grows on demand', () => {
		const a = ctx.scratch(0, 16);
		expect(a).toHaveLength(16);
		expect(ctx.scratch(0, 16).buffer).toBe(a.buffer);
		expect(ctx.scratch(0, 8).buffer).toBe(a.buffer);
		expect(ctx.scratch(0, 8)).toHaveLength(8);
		expect(ctx.scratch(1, 16).buffer).not.toBe(a.buffer);
		expect(ctx.scratch(0, 64)).toHaveLength(64);
	});
});

describe('renderStack: cancellation', () => {
	const source = noiseImage(16, 12, 5);
	const noisy = stack(
		instance('testNoise', {params: {seed: 3, strength: 1}}),
		instance('testInvert', {mix: 0.5}),
		instance('testNoise', {params: {seed: 4, strength: 0.5}}),
	);

	function cancelAfter(calls: number): () => void {
		let count = 0;
		return () => {
			count++;
			if (count > calls) {
				throw new Cancelled();
			}
		};
	}

	it('rejects with whatever the checkpoint throws', async () => {
		await expect(
			renderStack(
				source,
				noisy,
				registry,
				options(source, {checkpoint: cancelAfter(0)}),
			),
		).rejects.toBeInstanceOf(Cancelled);
	});

	it('can be cancelled at every checkpoint, and the next render is unaffected', async () => {
		const expected = await renderStack(
			source,
			noisy,
			registry,
			options(source),
		);
		let total = 0;
		await renderStack(
			source,
			noisy,
			registry,
			options(source, {
				checkpoint() {
					total++;
				},
			}),
		);
		expect(total).toBeGreaterThan(24);

		for (let calls = 0; calls < total; calls++) {
			const cache = createStageCache();
			await expect(
				renderStack(
					source,
					noisy,
					registry,
					options(source, {checkpoint: cancelAfter(calls), cache}),
				),
			).rejects.toBeInstanceOf(Cancelled);
			const after = await renderStack(
				source,
				noisy,
				registry,
				options(source, {cache}),
			);
			expect(after.image).toEqual(expected.image);
		}
	});

	it('checks for cancellation between compositing slices of a large image', async () => {
		const large = noiseImage(256, 256, 9);
		const mixed = stack(instance('testInvert', {mix: 0.5}));
		let total = 0;
		const expected = await renderStack(
			large,
			mixed,
			registry,
			options(large, {
				checkpoint() {
					total++;
				},
			}),
		);
		expect(total).toBeGreaterThanOrEqual(1 + (256 * 256) / 16_384);

		const cache = createStageCache();
		await expect(
			renderStack(
				large,
				mixed,
				registry,
				options(large, {checkpoint: cancelAfter(total - 1), cache}),
			),
		).rejects.toBeInstanceOf(Cancelled);
		expect(cache.size).toBe(0);

		const after = await renderStack(
			large,
			mixed,
			registry,
			options(large, {cache}),
		);
		expect(after.image).toEqual(expected.image);
	});

	it('awaits a checkpoint that returns a promise and honours its rejection', async () => {
		let yields = 0;
		const result = await renderStack(
			source,
			noisy,
			registry,
			options(source, {
				async checkpoint() {
					yields++;
					await new Promise((resolve) => {
						setTimeout(resolve, 0);
					});
				},
			}),
		);
		const sync = await renderStack(source, noisy, registry, options(source));
		expect(yields).toBeGreaterThan(24);
		expect(result.image).toEqual(sync.image);

		let calls = 0;
		await expect(
			renderStack(
				source,
				noisy,
				registry,
				options(source, {
					async checkpoint() {
						calls++;
						if (calls === 20) {
							throw new Cancelled();
						}
					},
				}),
			),
		).rejects.toBeInstanceOf(Cancelled);
	});

	it('does not render later instances after a cancellation', async () => {
		const amounts: number[] = [];
		const counting = createRegistry([
			addEffect((amount) => {
				amounts.push(amount);
			}),
		]);
		await expect(
			renderStack(
				pixel,
				stack(
					instance('testAdd', {params: {amount: 1}}),
					instance('testAdd', {params: {amount: 2}}),
				),
				counting,
				options(pixel, {checkpoint: cancelAfter(1)}),
			),
		).rejects.toBeInstanceOf(Cancelled);
		expect(amounts).toEqual([1]);
	});

	it('keeps overlapping renders apart', async () => {
		const tick = async () =>
			new Promise<void>((resolve) => {
				setTimeout(resolve, 0);
			});
		const other = stack(
			instance('testNoise', {params: {seed: 9, strength: 1}}),
			instance('testInvert'),
		);
		const [a, b] = await Promise.all([
			renderStack(source, noisy, registry, options(source, {checkpoint: tick})),
			renderStack(source, other, registry, options(source, {checkpoint: tick})),
		]);
		expect(a.image).toEqual(
			(await renderStack(source, noisy, registry, options(source))).image,
		);
		expect(b.image).toEqual(
			(await renderStack(source, other, registry, options(source))).image,
		);
	});
});

describe('renderStack: buffers and progress', () => {
	it('leaves the source bytes unmodified', async () => {
		const source = noiseImage(9, 7, 2);
		const before = bytes(source);
		await renderStack(
			source,
			stack(
				instance('testNoise', {params: {seed: 1, strength: 1}}),
				instance('testInvert', {mix: 0.3, blend: 'difference'}),
				instance('testAdd', {params: {amount: 40}, mix: 0}),
			),
			registry,
			options(source),
		);
		expect(bytes(source)).toEqual(before);
	});

	it('returns a buffer the caller owns: writing to it changes no later render', async () => {
		const source = noiseImage(6, 6, 3);
		const invert = stack(instance('testInvert'));
		const first = await renderStack(source, invert, registry, options(source));
		const expected = bytes(first.image);
		first.image.data.fill(7);
		const second = await renderStack(source, invert, registry, options(source));
		expect(bytes(second.image)).toEqual(expected);
		expect(second.image.data).not.toBe(first.image.data);
	});

	it('gives identical bytes when run twice and at a different size in between', async () => {
		const source = noiseImage(8, 8, 4);
		const noisy = stack(
			instance('testNoise', {params: {seed: 11, strength: 1}}),
			instance('testInvert', {mix: 0.7, blend: 'lighten'}),
		);
		const first = await renderStack(source, noisy, registry, options(source));
		const small = noiseImage(3, 3);
		await renderStack(small, noisy, registry, options(small));
		const second = await renderStack(source, noisy, registry, options(source));
		expect(second.image).toEqual(first.image);
	});

	it('reports (completed + fraction) / enabled count, ending at 1', async () => {
		const source = noiseImage(4, 4);
		const seen: number[] = [];
		await renderStack(
			source,
			stack(
				instance('testNoise', {params: {seed: 1, strength: 1}}),
				instance('fromTheFuture'),
				instance('testInvert', {enabled: false}),
				instance('testNoise', {params: {seed: 2, strength: 1}}),
			),
			registry,
			options(source, {
				onProgress(fraction) {
					seen.push(fraction);
				},
			}),
		);
		// Three enabled instances; the unknown one in the middle counts as done.
		expect(seen).toEqual(
			[0.25, 0.5, 0.75, 1, 1, 2.25, 2.5, 2.75, 3, 3].map((done) => done / 3),
		);
	});

	it('never reports a lower fraction than before, and jumps to 1 when a debug render stops early', async () => {
		const source = noiseImage(4, 4);
		const backwards: EffectDefinition<{}> = {
			...invertEffect,
			type: 'testBackwards',
			render(input, output, _params, ctx) {
				ctx.progress(0.8);
				ctx.progress(0.2);
				ctx.progress(7);
				output.data.set(input.data);
			},
		};
		const target = instance('testBackwards');
		const seen: number[] = [];
		await renderStack(
			source,
			stack(target, instance('testBackwards')),
			createRegistry([backwards]),
			options(source, {
				debug: {instanceId: target.id, view: 'selection'},
				onProgress(fraction) {
					seen.push(fraction);
				},
			}),
		);
		expect(seen).toEqual([0.4, 0.5, 0.5, 1]);
	});

	it('reports progress 1 for a stack with nothing to render', async () => {
		const seen: number[] = [];
		await renderStack(
			pixel,
			stack(instance('testInvert', {enabled: false})),
			registry,
			options(pixel, {
				onProgress(fraction) {
					seen.push(fraction);
				},
			}),
		);
		expect(seen).toEqual([1]);
	});

	it('rejects a source whose data length does not match its size', async () => {
		const broken = {width: 2, height: 2, data: new Uint8ClampedArray(12)};
		await expect(
			renderStack(broken, stack(), registry, options(broken)),
		).rejects.toThrow(RangeError);
	});
});

describe('engine.md section 14.3 properties on test effects', () => {
	const sizes = fc.record({
		width: fc.integer({min: 1, max: 64}),
		height: fc.integer({min: 1, max: 64}),
		imageSeed: fc.integer({min: 0, max: 0xff_ff_ff_ff}),
	});
	const blend = fc.constantFrom<BlendMode>(
		'normal',
		'lighten',
		'darken',
		'difference',
	);
	const mix = fc.integer({min: 0, max: 100}).map((percent) => percent / 100);
	const anyInstance = fc.oneof(
		fc
			.record({amount: fc.integer({min: -300, max: 300}), mix, blend})
			.map(({amount, ...rest}) =>
				instance('testAdd', {params: {amount}, ...rest}),
			),
		fc.record({mix, blend}).map((rest) => instance('testInvert', rest)),
		fc
			.record({
				seed: fc.integer({min: 0, max: 0xff_ff_ff_ff}),
				strength: fc.double({min: 0, max: 1, noNaN: true}),
				mix,
				blend,
			})
			.map(({seed, strength, ...rest}) =>
				instance('testNoise', {params: {seed, strength}, ...rest}),
			),
	);
	const anyStack = fc
		.array(anyInstance, {maxLength: 4})
		.map((instances) => stack(...instances));

	it('output size equals input size, the input is unchanged, and two runs match', async () => {
		await fc.assert(
			fc.asyncProperty(sizes, anyStack, async (size, effects) => {
				const source = noiseImage(size.width, size.height, size.imageSeed);
				const before = bytes(source);
				const first = await renderStack(
					source,
					effects,
					registry,
					options(source),
				);
				const second = await renderStack(
					source,
					effects,
					registry,
					options(source),
				);
				expect(first.image.width).toBe(size.width);
				expect(first.image.height).toBe(size.height);
				expect(first.image.data).toHaveLength(size.width * size.height * 4);
				expect(bytes(source)).toEqual(before);
				expect(second.image).toEqual(first.image);
			}),
			{numRuns: 200},
		);
	});

	it('mix 0 returns the input exactly, whatever the effect and blend mode', async () => {
		await fc.assert(
			fc.asyncProperty(sizes, anyInstance, async (size, effect) => {
				const source = noiseImage(size.width, size.height, size.imageSeed);
				const result = await renderStack(
					source,
					stack({...effect, mix: 0}),
					registry,
					options(source),
				);
				expect(result.image).toEqual(source);
			}),
			{numRuns: 200},
		);
	});

	it('mix 1 with normal blend returns exactly what render wrote', async () => {
		await fc.assert(
			fc.asyncProperty(sizes, anyInstance, async (size, effect) => {
				const source = noiseImage(size.width, size.height, size.imageSeed);
				const definition = registry.get(effect.type)!;
				const params = validateParams(definition.params, effect.params);
				const direct = createImage(source.width, source.height);
				await definition.render(
					source,
					direct,
					params,
					createRenderContext({
						level: 'settle',
						sourceWidth: source.width,
						sourceHeight: source.height,
						renderWidth: source.width,
						seed: typeof params.seed === 'number' ? params.seed : 0,
					}),
				);
				const result = await renderStack(
					source,
					stack({...effect, mix: 1, blend: 'normal'}),
					registry,
					options(source),
				);
				expect(result.image).toEqual(direct);
			}),
			{numRuns: 200},
		);
	});

	it('a stack that went through JSON renders identically', async () => {
		await fc.assert(
			fc.asyncProperty(sizes, anyStack, async (size, effects) => {
				const source = noiseImage(size.width, size.height, size.imageSeed);
				const reloaded = JSON.parse(canonicalStackJson(effects)) as EffectStack;
				const original = await renderStack(
					source,
					effects,
					registry,
					options(source),
				);
				const again = await renderStack(
					source,
					reloaded,
					registry,
					options(source),
				);
				expect(again.image).toEqual(original.image);
			}),
			{numRuns: 200},
		);
	});
});
