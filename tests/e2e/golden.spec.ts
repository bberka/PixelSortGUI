import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import path from 'node:path';
import {expect, test, type Page} from '@playwright/test';
import {decodeRgbaPng, listGoldenCases} from '../golden/helpers.ts';

const repoRoot = path.resolve(import.meta.dirname, '../..');

function sha256Hex(data: Uint8ClampedArray): string {
	return createHash('sha256').update(data).digest('hex');
}

function loadStrippedModule(relPath: string): string {
	const fullPath = path.join(repoRoot, relPath);
	const source = fs.readFileSync(fullPath, 'utf8');
	const stripped = stripTypeScriptTypes(source, {mode: 'strip'});
	return stripped.replaceAll(
		/((?:from|import)\s+["'][^"']+)\.ts(?=["'])/g,
		'$1.js',
	);
}

async function mountEngineModules(page: Page): Promise<void> {
	await page.route('**/__golden-test/**', async (route) => {
		const url = new URL(route.request().url());
		const subPath = url.pathname.replace(/^\/__golden-test\//, '');
		const tsRelPath = subPath.replace(/\.js$/, '.ts');
		const body = loadStrippedModule(tsRelPath);
		await route.fulfill({
			status: 200,
			contentType: 'application/javascript; charset=utf-8',
			body,
		});
	});
}

test.describe('golden cases match in real browsers', () => {
	test('every golden case produces the exact Node golden hash in Chromium and Firefox', async ({
		page,
	}) => {
		const cases = listGoldenCases();
		expect(cases.length).toBeGreaterThan(0);

		const expected = cases.map((entry) => {
			const png = decodeRgbaPng(fs.readFileSync(entry.pngPath));
			return {
				id: entry.id,
				spec: entry.spec,
				width: png.width,
				height: png.height,
				hash: sha256Hex(png.data),
			};
		});

		await mountEngineModules(page);
		await page.goto('/');

		const actual = await page.evaluate(async (inputCases) => {
			const pipelineUrl = '/__golden-test/src/engine/pipeline.js';
			const effectsUrl = '/__golden-test/src/engine/effects/index.js';
			const resampleUrl = '/__golden-test/src/engine/resample.js';
			const fixturesUrl = '/__golden-test/tests/fixtures/synthetic.js';
			const transformUrl = '/__golden-test/src/engine/transform.js';

			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- route-served module in browser
			const {renderStack} = await import(pipelineUrl);
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- route-served module in browser
			const {effectRegistry} = await import(effectsUrl);
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- route-served module in browser
			const {boxDownscale} = await import(resampleUrl);
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- route-served module in browser
			const {getSyntheticFixture} = await import(fixturesUrl);
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- route-served module in browser
			const {applyTransform} = await import(transformUrl);

			async function digestHex(
				data: Uint8ClampedArray<ArrayBuffer>,
			): Promise<string> {
				const digest = await crypto.subtle.digest('SHA-256', data);
				return [...new Uint8Array(digest)]
					.map((byte) => byte.toString(16).padStart(2, '0'))
					.join('');
			}

			const results: Array<{
				id: string;
				width: number;
				height: number;
				hash: string;
			}> = [];

			for (const entry of inputCases) {
				type Image = {
					width: number;
					height: number;
					data: Uint8ClampedArray<ArrayBuffer>;
				};
				// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- dynamic route module
				const fixture = getSyntheticFixture(entry.spec.input) as Image;
				// Same order as renderGoldenCase: transform, then scale, then the stack.
				const source = entry.spec.transform
					? // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- dynamic route module
						(applyTransform(fixture, entry.spec.transform) as Image)
					: fixture;
				const scaled = (image: Image, scale: number): Image => {
					const width = Math.max(1, Math.floor(image.width * scale));
					const height = Math.max(1, Math.floor(image.height * scale));
					return width === image.width && height === image.height
						? image
						: // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- dynamic route module
							(boxDownscale(image, width, height) as Image);
				};

				const renderInput = scaled(source, entry.spec.scale);
				const extraSources = new Map(
					Object.entries(entry.spec.extraSources ?? {}).map(
						([sha256, extra]) => {
							// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- dynamic route module
							const stored = getSyntheticFixture(extra.fixture) as Image;
							return [
								sha256,
								{
									...scaled(stored, extra.scale ?? entry.spec.scale),
									sourceWidth: stored.width,
									sourceHeight: stored.height,
								},
							];
						},
					),
				);

				// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- dynamic route module
				const rendered = (await renderStack(
					renderInput,
					entry.spec.stack,
					effectRegistry,
					{
						level: entry.spec.scale < 1 ? 'settle' : 'full',
						sourceWidth: source.width,
						sourceHeight: source.height,
						debug: entry.spec.debug,
						extraSources,
						checkpoint: () => undefined,
					},
				)) as {
					image: {
						width: number;
						height: number;
						data: Uint8ClampedArray<ArrayBuffer>;
					};
				};

				results.push({
					id: entry.id,
					width: rendered.image.width,
					height: rendered.image.height,
					hash: await digestHex(rendered.image.data),
				});
			}

			return results;
		}, expected);

		for (const [index, exp] of expected.entries()) {
			const act = actual[index];
			expect(act, `Mismatch in golden case ${exp.id}`).toEqual({
				id: exp.id,
				width: exp.width,
				height: exp.height,
				hash: exp.hash,
			});
		}
	});
});
