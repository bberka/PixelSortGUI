/**
 Engine throughput benchmark in Node.
 Run with: `vp run bench`

 Times every registered effect with default parameters on a 12 MP synthetic
 image, plus `pixelSort` at angle 30 (12 MP) and at 50 MP (angle 0).
 Exits non-zero if any case falls below the 25 MP/s floor (engine.md §9).
 */
import process from 'node:process';
import {effectRegistry} from '../src/engine/effects/index.ts';
import {pixelSortEffect} from '../src/engine/effects/pixel-sort/index.ts';
import {defaultParams} from '../src/engine/params.ts';
import {createRenderContext} from '../src/engine/pipeline.ts';
import type {
	EffectDefinition,
	ParamValue,
	RgbaImage,
} from '../src/engine/types.ts';

const FLOOR_MP_PER_SEC = 25;

type BenchCase = {
	label: string;
	effect: EffectDefinition;
	params: Record<string, ParamValue>;
	width: number;
	height: number;
	runs: number;
};

function generateSyntheticImage(width: number, height: number): RgbaImage {
	const data = new Uint8ClampedArray(width * height * 4);
	let i = 0;
	for (let y = 0; y < height; y++) {
		const t = Math.floor((y * 255) / height);
		for (let x = 0; x < width; x++) {
			const u = Math.floor((x * 255) / width);
			// eslint-disable-next-line no-bitwise -- fast deterministic synthetic gradient + grain
			const wave = ((x * 3 + y * 5) & 63) - 32;
			data[i] = Math.min(255, Math.max(0, t + wave));
			data[i + 1] = Math.min(255, Math.max(0, u + wave));
			data[i + 2] = Math.min(
				255,
				Math.max(0, 255 - Math.floor((t + u) / 2) + wave),
			);
			data[i + 3] = 255;
			i += 4;
		}
	}

	return {width, height, data};
}

function median(values: number[]): number {
	const sorted = values.toSorted((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
}

async function runCase(
	benchCase: BenchCase,
	input: RgbaImage,
	output: RgbaImage,
): Promise<{ms: number; mpPerSec: number}> {
	const ctx = createRenderContext({
		level: 'full',
		sourceWidth: benchCase.width,
		sourceHeight: benchCase.height,
		renderWidth: benchCase.width,
	});

	// Warmup
	await benchCase.effect.render(input, output, benchCase.params, ctx);

	const times: number[] = [];
	for (let r = 0; r < benchCase.runs; r++) {
		const start = performance.now();
		await benchCase.effect.render(input, output, benchCase.params, ctx);
		times.push(performance.now() - start);
	}

	const ms = median(times);
	const megapixels = (benchCase.width * benchCase.height) / 1_000_000;
	const mpPerSec = megapixels / (ms / 1000);
	return {ms, mpPerSec};
}

async function main(): Promise<void> {
	const cases: BenchCase[] = [
		...effectRegistry.list().map((effect) => ({
			label: `${effect.type} (defaults, 12 MP)`,
			effect,
			params: defaultParams(effect.params),
			width: 4000,
			height: 3000,
			runs: 5,
		})),
		{
			label: 'pixelSort (angle 30, 12 MP)',
			effect: pixelSortEffect,
			params: {...defaultParams(pixelSortEffect.params), angle: 30},
			width: 4000,
			height: 3000,
			runs: 5,
		},
		{
			label: 'pixelSort (defaults, 50 MP)',
			effect: pixelSortEffect,
			params: defaultParams(pixelSortEffect.params),
			width: 8000,
			height: 6250,
			runs: 3,
		},
	];

	const image12 = generateSyntheticImage(4000, 3000);
	const out12: RgbaImage = {
		width: 4000,
		height: 3000,
		data: new Uint8ClampedArray(4000 * 3000 * 4),
	};
	const image50 = generateSyntheticImage(8000, 6250);
	const out50: RgbaImage = {
		width: 8000,
		height: 6250,
		data: new Uint8ClampedArray(8000 * 6250 * 4),
	};

	const rows: Array<{
		case: string;
		pixels: string;
		p50Ms: string;
		mpPerSec: string;
		status: string;
	}> = [];
	let failed = false;

	for (const benchCase of cases) {
		const is50 = benchCase.width === 8000;
		const {ms, mpPerSec} = await runCase(
			benchCase,
			is50 ? image50 : image12,
			is50 ? out50 : out12,
		);
		const ok = mpPerSec >= FLOOR_MP_PER_SEC;
		if (!ok) {
			failed = true;
		}

		rows.push({
			case: benchCase.label,
			pixels: `${((benchCase.width * benchCase.height) / 1_000_000).toFixed(0)} MP`,
			p50Ms: ms.toFixed(1),
			mpPerSec: mpPerSec.toFixed(1),
			status: ok ? 'PASS' : `FAIL (< ${FLOOR_MP_PER_SEC} MP/s)`,
		});
	}

	console.table(rows);
	if (failed) {
		process.exitCode = 1;
	}
}

await main();
