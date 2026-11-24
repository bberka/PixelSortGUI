import {describe, expect, it} from 'vite-plus/test';
import {effectRegistry} from '../../src/engine/effects/index.ts';
import {defaultParams, validateParams} from '../../src/engine/params.ts';
import {createRenderContext, renderStack} from '../../src/engine/pipeline.ts';
import {createRegistry} from '../../src/engine/registry.ts';
import {
	Cancelled,
	copyImage,
	STACK_SCHEMA_VERSION,
	type EffectDefinition,
	type EffectStack,
	type RgbaImage,
} from '../../src/engine/types.ts';
import {hash32} from '../../src/engine/random.ts';

function makeImage(width: number, height: number, seed = 0x55_aa): RgbaImage {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const h = hash32(seed, x, y);
			const i = (y * width + x) * 4;
			// eslint-disable-next-line no-bitwise -- byte extraction from uint32 hash
			data[i] = h & 0xff;
			// eslint-disable-next-line no-bitwise -- byte extraction from uint32 hash
			data[i + 1] = (h >>> 8) & 0xff;
			// eslint-disable-next-line no-bitwise -- byte extraction from uint32 hash
			data[i + 2] = (h >>> 16) & 0xff;
			data[i + 3] = 255;
		}
	}

	return {width, height, data};
}

function singleStack(effect: EffectDefinition, mix = 1): EffectStack {
	return {
		schemaVersion: STACK_SCHEMA_VERSION,
		instances: [
			{
				id: 'test0001',
				type: effect.type,
				version: effect.version,
				enabled: true,
				params: defaultParams(effect.params),
				mix,
				blend: 'normal',
			},
		],
	};
}

async function assertInputImmutability(
	effect: EffectDefinition,
): Promise<void> {
	const input = makeImage(24, 18);
	const snapshot = copyImage(input);
	const output: RgbaImage = {
		width: input.width,
		height: input.height,
		data: new Uint8ClampedArray(input.data.length),
	};
	const ctx = createRenderContext({
		level: 'full',
		sourceWidth: input.width,
		sourceHeight: input.height,
		renderWidth: input.width,
	});
	await effect.render(input, output, defaultParams(effect.params), ctx);
	expect(input.data).toEqual(snapshot.data);
}

async function assertDeterminism(effect: EffectDefinition): Promise<void> {
	const input = makeImage(24, 18);
	const params = defaultParams(effect.params);
	const out1: RgbaImage = {
		width: input.width,
		height: input.height,
		data: new Uint8ClampedArray(input.data.length),
	};
	const out2: RgbaImage = {
		width: input.width,
		height: input.height,
		data: new Uint8ClampedArray(input.data.length),
	};
	await effect.render(
		input,
		out1,
		params,
		createRenderContext({
			level: 'full',
			sourceWidth: input.width,
			sourceHeight: input.height,
			renderWidth: input.width,
		}),
	);
	await effect.render(
		input,
		out2,
		params,
		createRenderContext({
			level: 'full',
			sourceWidth: input.width,
			sourceHeight: input.height,
			renderWidth: input.width,
		}),
	);
	expect(out1.data).toEqual(out2.data);
}

function assertDefaultsValidateUnchanged(effect: EffectDefinition): void {
	const rawDefaults: Record<string, unknown> = {};
	for (const [key, spec] of Object.entries(effect.params)) {
		rawDefaults[key] = spec.kind === 'seed' ? 0 : spec.default;
	}

	const validated = validateParams(effect.params, rawDefaults);
	expect(validated).toEqual(rawDefaults);
}

async function assertEdgeSizes(effect: EffectDefinition): Promise<void> {
	const sizes: Array<readonly [number, number]> = [
		[1, 1],
		[1, 17],
		[17, 1],
		[13, 19],
	];
	const params = defaultParams(effect.params);
	for (const [width, height] of sizes) {
		const input = makeImage(width, height);
		const output: RgbaImage = {
			width,
			height,
			data: new Uint8ClampedArray(width * height * 4),
		};
		await effect.render(
			input,
			output,
			params,
			createRenderContext({
				level: 'full',
				sourceWidth: width,
				sourceHeight: height,
				renderWidth: width,
			}),
		);
		expect(output.width).toBe(width);
		expect(output.height).toBe(height);
		expect(output.data.length).toBe(width * height * 4);
	}
}

async function assertMixZeroIdentity(effect: EffectDefinition): Promise<void> {
	const input = makeImage(20, 16);
	const registry = createRegistry([effect]);
	const result = await renderStack(input, singleStack(effect, 0), registry, {
		level: 'full',
		sourceWidth: input.width,
		sourceHeight: input.height,
		checkpoint: () => undefined,
	});
	expect(result.image.data).toEqual(input.data);
}

async function assertCancellation(effect: EffectDefinition): Promise<void> {
	// 160x160 = 25,600 pixels > 16,384 checkpoint threshold
	const input = makeImage(160, 160);
	const output: RgbaImage = {
		width: input.width,
		height: input.height,
		data: new Uint8ClampedArray(input.data.length),
	};
	let checkpointCalls = 0;
	const ctx = createRenderContext({
		level: 'full',
		sourceWidth: input.width,
		sourceHeight: input.height,
		renderWidth: input.width,
		checkpoint() {
			checkpointCalls++;
			throw new Cancelled();
		},
	});
	await expect(
		Promise.resolve(
			effect.render(input, output, defaultParams(effect.params), ctx),
		),
	).rejects.toThrow(Cancelled);
	expect(checkpointCalls).toBeGreaterThan(0);
}

function assertParameterLabels(effect: EffectDefinition): void {
	for (const [key, spec] of Object.entries(effect.params)) {
		expect(
			typeof spec.label === 'string' && spec.label.trim().length > 0,
			`Parameter "${key}" on effect "${effect.type}" must have a non-empty label`,
		).toBe(true);
	}
}

async function assertSelectionDebugView(
	effect: EffectDefinition,
): Promise<void> {
	if (!effect.debugViews?.includes('selection')) {
		return;
	}

	const input = makeImage(24, 18);
	const registry = createRegistry([effect]);
	const result = await renderStack(input, singleStack(effect, 1), registry, {
		level: 'full',
		sourceWidth: input.width,
		sourceHeight: input.height,
		debug: {instanceId: 'test0001', view: 'selection'},
		checkpoint: () => undefined,
	});
	expect(result.image.width).toBe(input.width);
	expect(result.image.height).toBe(input.height);
	expect(result.image.data.length).toBe(input.data.length);
}

describe('effect contract (all registered effects)', () => {
	const registered = effectRegistry.list();

	it('covers at least one registered effect', () => {
		expect(registered.length).toBeGreaterThan(0);
	});

	for (const effect of registered) {
		describe(effect.type, () => {
			it('never writes to its input', async () => {
				await assertInputImmutability(effect);
			});

			it('produces identical output for identical inputs', async () => {
				await assertDeterminism(effect);
			});

			it('validates default parameters unchanged', () => {
				assertDefaultsValidateUnchanged(effect);
			});

			it('renders 1x1, 1xN, Nx1, and odd sizes without error', async () => {
				await assertEdgeSizes(effect);
			});

			it('returns input unchanged when mix is 0', async () => {
				await assertMixZeroIdentity(effect);
			});

			it('calls checkpoint and rejects when cancelled', async () => {
				await assertCancellation(effect);
			});

			it('gives every parameter a non-empty label', () => {
				assertParameterLabels(effect);
			});

			it('renders the selection debug view when declared', async () => {
				await assertSelectionDebugView(effect);
			});
		});
	}
});

describe('effect contract catches violating effects', () => {
	function makeBaseEffect(
		overrides: Partial<EffectDefinition>,
	): EffectDefinition {
		return {
			type: 'brokenEffect',
			version: 1,
			label: 'Broken',
			description: 'Test-only broken effect',
			category: 'glitch',
			params: {
				amount: {
					kind: 'integer',
					label: 'Amount',
					group: 'General',
					min: 0,
					max: 10,
					default: 5,
				},
			},
			async render(input, output, _params, ctx) {
				await ctx.checkpoint();
				output.data.set(input.data);
			},
			...overrides,
		};
	}

	it('catches an effect that mutates its input', async () => {
		const mutating = makeBaseEffect({
			async render(input, output, _params, ctx) {
				await ctx.checkpoint();
				input.data[0] = (input.data[0] + 1) % 256;
				output.data.set(input.data);
			},
		});
		await expect(assertInputImmutability(mutating)).rejects.toThrow();
	});

	it('catches a non-deterministic effect', async () => {
		let counter = 0;
		const nonDeterministic = makeBaseEffect({
			async render(input, output, _params, ctx) {
				await ctx.checkpoint();
				output.data.set(input.data);
				counter++;
				output.data[0] = (output.data[0] + counter) % 256;
			},
		});
		await expect(assertDeterminism(nonDeterministic)).rejects.toThrow();
	});

	it('catches an effect whose default parameter fails validation', () => {
		const badDefault = makeBaseEffect({
			params: {
				amount: {
					kind: 'integer',
					label: 'Amount',
					group: 'General',
					min: 0,
					max: 10,
					default: 99,
				},
			},
		});
		expect(() => assertDefaultsValidateUnchanged(badDefault)).toThrow();
	});

	it('catches an effect that fails on edge dimensions', async () => {
		const failsOn1x1 = makeBaseEffect({
			async render(input, output, _params, ctx) {
				await ctx.checkpoint();
				if (input.width === 1 && input.height === 1) {
					throw new Error('cannot render 1x1');
				}

				output.data.set(input.data);
			},
		});
		await expect(assertEdgeSizes(failsOn1x1)).rejects.toThrow(
			'cannot render 1x1',
		);
	});

	it('catches an effect that ignores cancellation checkpoints', async () => {
		const noCheckpoint = makeBaseEffect({
			render(input, output) {
				output.data.set(input.data);
			},
		});
		await expect(assertCancellation(noCheckpoint)).rejects.toThrow();
	});

	it('catches an effect with a missing parameter label', () => {
		const missingLabel = makeBaseEffect({
			params: {
				amount: {
					kind: 'integer',
					label: '',
					group: 'General',
					min: 0,
					max: 10,
					default: 5,
				},
			},
		});
		expect(() => assertParameterLabels(missingLabel)).toThrow();
	});

	it('catches an effect that declares selection debugView but fails to render it', async () => {
		const brokenDebug = makeBaseEffect({
			debugViews: ['selection'],
			async render(input, output, _params, ctx) {
				await ctx.checkpoint();
				if (ctx.debugView === 'selection') {
					throw new Error('selection view not implemented');
				}

				output.data.set(input.data);
			},
		});
		await expect(assertSelectionDebugView(brokenDebug)).rejects.toThrow(
			'selection view not implemented',
		);
	});
});
