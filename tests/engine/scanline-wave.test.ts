import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {effectRegistry} from '../../src/engine/effects/index.ts';
import {runtimeEffectRegistry} from '../../src/engine/effects/runtime.ts';
import {
	scanlineWaveEffect,
	type ScanlineWaveform,
	type ScanlineWaveParams,
} from '../../src/engine/effects/scanline-wave.ts';
import {clamp, roundHalfAway, wrap} from '../../src/engine/math.ts';
import {defaultParams, validateParams} from '../../src/engine/params.ts';
import {createRenderContext, renderStack} from '../../src/engine/pipeline.ts';
import {intIn} from '../../src/engine/random.ts';
import {createImage, type RgbaImage} from '../../src/engine/types.ts';
import {bytes, instance, noiseImage, options, stack} from './sample-effects.ts';

const WAVEFORMS = ['sine', 'triangle', 'square', 'sawtooth'] as const;

// Offsets of source lines 0..7 for wavelength 8, amplitude 2, phase 0.
const EXPECTED: ReadonlyArray<readonly [ScanlineWaveform, number[]]> = [
	['sine', [0, 1, 2, 1, 0, -1, -2, -1]],
	['triangle', [0, 1, 2, 1, 0, -1, -2, -1]],
	['square', [2, 2, 2, 2, -2, -2, -2, -2]],
	['sawtooth', [-2, -2, -1, -1, 0, 1, 1, 2]],
];

function params(
	overrides: Partial<ScanlineWaveParams> = {},
): ScanlineWaveParams {
	return {
		...defaultParams(scanlineWaveEffect.params),
		amplitude: 2,
		wavelength: 8,
		...overrides,
	};
}

// Every pixel holds its own coordinates, so an output pixel names its source.
function coordinates(width: number, height: number): RgbaImage {
	const result = createImage(width, height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			result.data.set([x, y, 7, 200], (y * width + x) * 4);
		}
	}

	return result;
}

async function render(
	input: RgbaImage,
	settings: ScanlineWaveParams,
	source: {width: number; height: number} = input,
): Promise<RgbaImage> {
	const output = createImage(input.width, input.height);
	const ctx = createRenderContext({
		level: 'full',
		sourceWidth: source.width,
		sourceHeight: source.height,
		renderWidth: input.width,
	});
	await scanlineWaveEffect.render(input, output, settings, ctx);
	return output;
}

// The image that moving line `n` of `input` by `offsets[n]` must produce.
function shifted(
	input: RgbaImage,
	offsets: readonly number[],
	settings: Pick<ScanlineWaveParams, 'axis' | 'edge'>,
): number[] {
	const {width, height} = input;
	const edge = (v: number, n: number) =>
		settings.edge === 'wrap' ? wrap(v, n) : clamp(v, 0, n - 1);
	const result: number[] = [];
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const [sx, sy] =
				settings.axis === 'horizontal'
					? [edge(x - offsets[y], width), y]
					: [x, edge(y - offsets[x], height)];
			const from = (sy * width + sx) * 4;
			result.push(...input.data.slice(from, from + 4));
		}
	}

	return result;
}

// Row offsets read back from a render of `coordinates`, in -128..127.
async function rowOffsets(
	settings: ScanlineWaveParams,
	height = 32,
): Promise<number[]> {
	const output = await render(coordinates(256, height), settings);
	return Array.from(
		{length: height},
		(_, y) => wrap(128 - output.data[(y * 256 + 128) * 4] + 128, 256) - 128,
	);
}

// The pixels of every row or column of `img`, each line sorted.
function sortedLines(
	img: RgbaImage,
	axis: ScanlineWaveParams['axis'],
): number[][] {
	const view = new Uint32Array(
		img.data.buffer,
		img.data.byteOffset,
		img.width * img.height,
	);
	const isRows = axis === 'horizontal';
	return Array.from({length: isRows ? img.height : img.width}, (_, n) =>
		Array.from(
			{length: isRows ? img.width : img.height},
			(__, i) => view[isRows ? n * img.width + i : i * img.width + n],
		).toSorted((a, b) => a - b),
	);
}

const arbImage: fc.Arbitrary<RgbaImage> = fc
	.record({
		width: fc.integer({min: 1, max: 48}),
		height: fc.integer({min: 1, max: 48}),
		seed: fc.integer({min: 0, max: 1_000_000}),
	})
	.map(({width, height, seed}) => noiseImage(width, height, seed));

const arbParams: fc.Arbitrary<ScanlineWaveParams> = fc.record({
	axis: fc.constantFrom('horizontal', 'vertical'),
	waveform: fc.constantFrom(...WAVEFORMS),
	amplitude: fc.integer({min: 0, max: 2048}),
	wavelength: fc.integer({min: 4, max: 4096}),
	phase: fc.integer({min: 0, max: 3599}).map((tenths) => tenths / 10),
	jitter: fc.integer({min: 0, max: 512}),
	edge: fc.constantFrom('wrap', 'clamp'),
	seed: fc.integer({min: 0, max: 0xff_ff_ff_ff}),
});

describe('scanlineWaveEffect', () => {
	it('is registered for the main thread and workers with the spec schema', () => {
		expect(effectRegistry.get('scanlineWave')?.params).toBe(
			scanlineWaveEffect.params,
		);
		expect(runtimeEffectRegistry.get('scanlineWave')).toBe(scanlineWaveEffect);
		expect(scanlineWaveEffect.version).toBe(1);
		expect(scanlineWaveEffect.category).toBe('glitch');
		expect(defaultParams(scanlineWaveEffect.params)).toEqual({
			axis: 'horizontal',
			waveform: 'sine',
			amplitude: 24,
			wavelength: 120,
			phase: 0,
			jitter: 0,
			edge: 'wrap',
			seed: 0,
		});
	});

	describe.each(EXPECTED)('%s wave', (waveform, offsets) => {
		it.each([
			['horizontal', 'wrap'],
			['horizontal', 'clamp'],
			['vertical', 'wrap'],
			['vertical', 'clamp'],
		] as const)('moves %s lines with %s edges', async (axis, edge) => {
			const input = noiseImage(8, 8, 11);
			const settings = params({waveform, axis, edge});
			expect(bytes(await render(input, settings))).toEqual(
				shifted(input, offsets, settings),
			);
		});

		it('advances by the phase', async () => {
			// 90 degrees is a quarter of the 8 pixel wavelength: two lines.
			const rotated = [...offsets.slice(2), ...offsets.slice(0, 2)];
			expect(
				await rowOffsets(params({waveform, phase: 90}), offsets.length),
			).toEqual(rotated);
		});
	});

	it('is the identity when amplitude and jitter are 0', async () => {
		const input = noiseImage(13, 9, 2);
		for (const waveform of WAVEFORMS) {
			const output = await render(input, params({waveform, amplitude: 0}));
			expect(output.data).toEqual(input.data);
		}
	});

	it('adds one seeded jitter draw per source line', async () => {
		const settings = params({amplitude: 0, jitter: 20, seed: 42});
		expect(await rowOffsets(settings)).toEqual(
			Array.from({length: 32}, (_, y) => intIn(-20, 20, 42, 1, y)),
		);
	});

	it('adds the jitter to the wave offset', async () => {
		const [, wave] = EXPECTED[0];
		expect(await rowOffsets(params({jitter: 5, seed: 9}), 8)).toEqual(
			wave.map((offset, y) => offset + intIn(-5, 5, 9, 1, y)),
		);
	});

	it('repeats jitter for a seed and changes it with another seed', async () => {
		const input = noiseImage(64, 64, 4);
		const settings = params({jitter: 12, seed: 123});
		const first = await render(input, settings);
		expect((await render(input, settings)).data).toEqual(first.data);
		const other = await render(input, {...settings, seed: 124});
		expect(other.data).not.toEqual(first.data);
	});

	it('ignores the seed without jitter', async () => {
		const input = noiseImage(24, 24, 6);
		const first = await render(input, params({seed: 1}));
		expect((await render(input, params({seed: 2}))).data).toEqual(first.data);
	});

	it('evaluates the wave and jitter at source lines on a proxy render', async () => {
		const input = noiseImage(8, 4, 8);
		const settings = params({
			amplitude: 4,
			wavelength: 16,
			jitter: 3,
			seed: 77,
		});
		// At half scale, render rows 0..3 read source rows 1, 3, 5 and 7, where
		// the wave is 4 sin(row * 22.5 degrees), rounded.
		const offsets = [
			[1, 2],
			[3, 4],
			[5, 4],
			[7, 2],
		].map(([row, wave]) =>
			roundHalfAway((wave + intIn(-3, 3, 77, 1, row)) / 2),
		);
		expect(
			bytes(await render(input, settings, {width: 16, height: 8})),
		).toEqual(shifted(input, offsets, settings));
	});

	it('only moves whole pixels along their line, for random parameters', async () => {
		await fc.assert(
			fc.asyncProperty(arbImage, arbParams, async (input, settings) => {
				const output = await render(input, {...settings, edge: 'wrap'});
				expect(sortedLines(output, settings.axis)).toEqual(
					sortedLines(input, settings.axis),
				);
			}),
			{numRuns: 200},
		);
	});

	it('never writes its input, fills the output and is deterministic', async () => {
		await fc.assert(
			fc.asyncProperty(arbImage, arbParams, async (input, settings) => {
				const snapshot = bytes(input);
				const first = await render(input, settings);
				const dirty = createImage(input.width, input.height);
				dirty.data.fill(0xab);
				await scanlineWaveEffect.render(
					input,
					dirty,
					settings,
					createRenderContext({
						level: 'full',
						sourceWidth: input.width,
						sourceHeight: input.height,
						renderWidth: input.width,
					}),
				);
				expect(bytes(input)).toEqual(snapshot);
				expect(dirty.data).toEqual(first.data);
			}),
			{numRuns: 200},
		);
	});

	it('renders images larger than one checkpoint slice', async () => {
		const input = noiseImage(160, 160, 3);
		const offsets = Array.from({length: 160}, (_, y) => EXPECTED[2][1][y % 8]);
		const settings = params({waveform: 'square'});
		expect(bytes(await render(input, settings))).toEqual(
			shifted(input, offsets, settings),
		);
	});

	it('survives a saved-stack round trip and clamps out-of-range values', async () => {
		const input = noiseImage(9, 7, 5);
		const settings = params({
			axis: 'vertical',
			waveform: 'triangle',
			phase: 12.3,
			jitter: 2,
			edge: 'clamp',
			seed: 99,
		});
		const saved = stack(instance('scanlineWave', {params: settings}));
		// eslint-disable-next-line unicorn/prefer-structured-clone -- saved projects are JSON
		const loaded = JSON.parse(JSON.stringify(saved)) as typeof saved;
		expect(loaded).toEqual(saved);
		const result = await renderStack(
			input,
			loaded,
			runtimeEffectRegistry,
			options(input),
		);
		expect(result.image.data).toEqual((await render(input, settings)).data);
		expect(
			validateParams(scanlineWaveEffect.params, {
				waveform: 'noise',
				amplitude: 9999,
				wavelength: 0,
				phase: 360,
				jitter: -1,
			}),
		).toMatchObject({
			waveform: 'sine',
			amplitude: 2048,
			wavelength: 4,
			phase: 0,
			jitter: 0,
		});
	});
});
