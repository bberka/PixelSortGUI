import fs from 'node:fs';
import path from 'node:path';
import {decode, encode} from 'fast-png';
import {effectRegistry} from '../../src/engine/effects/index.ts';
import {renderStack} from '../../src/engine/pipeline.ts';
import {boxDownscale} from '../../src/engine/resample.ts';
import {
	applyTransform,
	type SourceTransform,
} from '../../src/engine/transform.ts';
import type {EffectStack, RgbaImage} from '../../src/engine/types.ts';
import {
	getSyntheticFixture,
	type SyntheticFixtureName,
} from '../fixtures/synthetic.ts';

export type GoldenCaseSpec = {
	input: SyntheticFixtureName;
	// Applied to the input before scaling and the stack (engine.md section 16.3).
	transform?: SourceTransform;
	stack: EffectStack;
	scale: number;
	debug?: {instanceId: string; view: 'selection'};
};

export type GoldenCaseEntry = {
	id: string;
	jsonPath: string;
	pngPath: string;
	spec: GoldenCaseSpec;
};

export const GOLDEN_ROOT = path.resolve(import.meta.dirname);

export function listGoldenCases(root = GOLDEN_ROOT): GoldenCaseEntry[] {
	const entries: GoldenCaseEntry[] = [];
	const dirs = fs
		.readdirSync(root, {withFileTypes: true})
		.filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith('.'))
		.map((dirent) => dirent.name)
		.toSorted();

	for (const dir of dirs) {
		const dirPath = path.join(root, dir);
		const files = fs
			.readdirSync(dirPath)
			.filter((name) => name.endsWith('.json'))
			.toSorted();
		for (const file of files) {
			const base = file.slice(0, -'.json'.length);
			const jsonPath = path.join(dirPath, file);
			const pngPath = path.join(dirPath, `${base}.png`);
			const spec = JSON.parse(
				fs.readFileSync(jsonPath, 'utf8'),
			) as GoldenCaseSpec;
			entries.push({
				id: `${dir}/${base}`,
				jsonPath,
				pngPath,
				spec,
			});
		}
	}

	return entries;
}

export async function renderGoldenCase(
	spec: GoldenCaseSpec,
): Promise<RgbaImage> {
	const fixture = getSyntheticFixture(spec.input);
	const source = spec.transform
		? applyTransform(fixture, spec.transform)
		: fixture;
	const sourceWidth = source.width;
	const sourceHeight = source.height;
	const targetWidth = Math.max(1, Math.floor(sourceWidth * spec.scale));
	const targetHeight = Math.max(1, Math.floor(sourceHeight * spec.scale));
	const input =
		targetWidth === sourceWidth && targetHeight === sourceHeight
			? source
			: boxDownscale(source, targetWidth, targetHeight);

	const result = await renderStack(input, spec.stack, effectRegistry, {
		level: spec.scale < 1 ? 'settle' : 'full',
		sourceWidth,
		sourceHeight,
		debug: spec.debug,
		checkpoint: () => undefined,
	});
	return result.image;
}

export function encodeRgbaPng(image: RgbaImage): Uint8Array {
	return encode({
		width: image.width,
		height: image.height,
		data: image.data,
		channels: 4,
		depth: 8,
	});
}

export function decodeRgbaPng(bytes: Uint8Array): RgbaImage {
	const decoded = decode(bytes);
	if (decoded.channels !== 4 || decoded.depth !== 8) {
		throw new Error(
			`Expected 8-bit RGBA PNG, got channels=${decoded.channels} depth=${decoded.depth}`,
		);
	}

	const data =
		decoded.data instanceof Uint8ClampedArray
			? decoded.data
			: new Uint8ClampedArray(
					decoded.data.buffer,
					decoded.data.byteOffset,
					decoded.data.byteLength,
				);
	return {
		width: decoded.width,
		height: decoded.height,
		data,
	};
}
