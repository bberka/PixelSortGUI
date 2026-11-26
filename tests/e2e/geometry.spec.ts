import {readFile} from 'node:fs/promises';
import {expect, test, type Page} from '@playwright/test';
import {effectRegistry} from '../../src/engine/effects/index.ts';
import {renderStack} from '../../src/engine/pipeline.ts';
import {
	applyTransform,
	IDENTITY_TRANSFORM,
	type SourceTransform,
} from '../../src/engine/transform.ts';
import type {RgbaImage} from '../../src/engine/types.ts';
import type {AppRuntime} from '../../src/state/index.ts';
import {
	builtAsset,
	openRenderPage,
	pixelSortStack,
	sha256,
	syntheticImage,
	type PageHelpers,
} from './render-fixtures.ts';

type PageScope = {renderTest: PageHelpers};
type RuntimeGlobal = {__psgRuntime?: AppRuntime};

const WIDTH = 320;
const HEIGHT = 240;
const stack = pixelSortStack({angle: 30});

function transformOf(overrides: Partial<SourceTransform>): SourceTransform {
	return {...IDENTITY_TRANSFORM, ...overrides};
}

// The reference: transform and effects run directly in Node.
async function expectedHashes(source: RgbaImage, transform: SourceTransform) {
	const image = applyTransform(source, transform);
	const render = async (level: 'settle' | 'full') => {
		const result = await renderStack(image, stack, effectRegistry, {
			level,
			sourceWidth: image.width,
			sourceHeight: image.height,
			checkpoint: () => undefined,
		});
		return sha256(result.image.data);
	};

	return {
		width: image.width,
		height: image.height,
		original: sha256(image.data),
		frame: await render('settle'),
		file: await render('full'),
	};
}

test.describe('geometry pipeline in the production build', () => {
	test('preview, original and export follow the crop as it changes', async ({
		page,
	}) => {
		const source = syntheticImage(WIDTH, HEIGHT);
		const transforms = [
			transformOf({crop: {x: 0, y: 0, width: 150, height: 100}}),
			// Same effective size, so only the transform tells the two apart.
			transformOf({crop: {x: 160, y: 120, width: 150, height: 100}}),
			transformOf({
				rotation: 90,
				flipX: true,
				crop: {x: 10, y: 20, width: 200, height: 260},
			}),
			IDENTITY_TRANSFORM,
		];
		const expected = [];
		for (const transform of transforms) {
			expected.push(await expectedHashes(source, transform));
		}

		await openRenderPage(page);
		const actual = await page.evaluate(
			async (input) => {
				const {renderTest} = globalThis as unknown as PageScope;
				const {createRenderCoordinator} = await renderTest.loadCoordinator(
					input.url,
				);
				const coordinator = createRenderCoordinator();
				const signal = renderTest.signal();
				const errors: string[] = [];
				coordinator.subscribe((event) => {
					if (event.type === 'error') {
						errors.push(event.error.message);
					}

					signal.wake();
				});
				const blob = await renderTest.sourceBlob(
					input.width,
					input.height,
					'image/png',
				);
				const hash = async (bitmap: ImageBitmap) =>
					renderTest.sha256(renderTest.bitmapPixels(bitmap));

				const results = [];
				coordinator.setStack({stack: input.stack});
				for (const transform of input.transforms) {
					coordinator.setSource({
						key: 'hash',
						blob,
						width: input.width,
						height: input.height,
						transform,
					});
					await signal.until(
						() =>
							errors.length > 0 ||
							coordinator.getState().frame?.level === 'settle',
					);
					const {source: info, frame} = coordinator.getState();
					const original = await hash(info!.original);
					const frameHash = await hash(frame!.bitmap);
					const outcome = await coordinator.exportImage({
						stack: input.stack,
						scale: 1,
						format: 'png',
					}).result;
					if (outcome.status !== 'done') {
						throw new Error(`Export ${outcome.status}`);
					}

					results.push({
						width: info!.width,
						height: info!.height,
						original,
						frame: frameHash,
						file: await hash(await globalThis.createImageBitmap(outcome.file)),
					});
				}

				coordinator.dispose();
				return {results, errors};
			},
			{
				url: builtAsset('coordinator'),
				width: WIDTH,
				height: HEIGHT,
				stack,
				transforms,
			},
		);

		expect(actual.errors).toEqual([]);
		expect(actual.results).toEqual(expected);
	});
});

// No control writes a transform yet, so the test stores one the way a saved
// project will carry it and reopens the app.
async function openWithTransform(
	page: Page,
	transform: SourceTransform,
): Promise<void> {
	await page.goto('/');
	await page.evaluate(async (value) => {
		const booted = await (globalThis as unknown as RuntimeGlobal).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error(`Expected ready boot, got ${booted.status}`);
		}

		const canvas = new globalThis.OffscreenCanvas(4000, 3000);
		const context = canvas.getContext('2d')!;
		const gradient = context.createLinearGradient(0, 0, 4000, 3000);
		gradient.addColorStop(0, '#0b1f3a');
		gradient.addColorStop(1, '#d08040');
		context.fillStyle = gradient;
		context.fillRect(0, 0, 4000, 3000);
		const created = await booted.bundle.store.getState().importImage({
			name: 'geometry.png',
			blob: await canvas.convertToBlob({type: 'image/png'}),
			width: 4000,
			height: 3000,
		});

		const request = async <T>(pending: IDBRequest<T>) =>
			new Promise<T>((resolve, reject) => {
				pending.addEventListener('success', () => {
					resolve(pending.result);
				});
				pending.addEventListener('error', () => {
					reject(new Error(String(pending.error)));
				});
			});
		const database = await request(globalThis.indexedDB.open('drift'));
		const projects = () =>
			database.transaction('projects', 'readwrite').objectStore('projects');
		const stored = (await request(
			projects().get(created.project.id),
		)) as object;
		await request(projects().put({...stored, transform: value}));
		database.close();
	}, transform);
	await page.reload();
	await expect(page.getByRole('button', {name: 'Export'})).toBeEnabled();
}

async function sourceDigest(page: Page): Promise<string> {
	return page.evaluate(async () => {
		const booted = await (globalThis as unknown as RuntimeGlobal).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		const {store, repository} = booted.bundle;
		const hash = store.getState().activeProject!.sourceHash;
		const source = (await repository.getSource(hash))!;
		const digest = await crypto.subtle.digest(
			'SHA-256',
			await source.blob.arrayBuffer(),
		);
		const hex = [...new Uint8Array(digest)]
			.map((byte) => byte.toString(16).padStart(2, '0'))
			.join('');
		return hex === hash ? 'unchanged' : 'changed';
	});
}

// Downloads at the chosen size and reads the dimensions from the PNG header.
async function downloadSize(page: Page, preset: 'Full' | '1/2') {
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('radio', {name: preset, exact: true}).click();
	const pending = page.waitForEvent('download');
	await dialog.getByRole('button', {name: 'Download'}).click();
	const download = await pending;
	const header = await readFile(await download.path());
	return [header.readUInt32BE(16), header.readUInt32BE(20)];
}

test.describe('a project with a stored transform', () => {
	test('AC-F20.1: shows and exports a rotated 4000 x 3000 photo at 3000 x 4000', async ({
		page,
	}) => {
		await openWithTransform(page, transformOf({rotation: 90}));
		await page.getByRole('button', {name: 'Export'}).click();
		await expect(page.locator('[data-slot="export-dimensions"]')).toHaveText(
			'3000 × 4000 px',
		);
		expect(await downloadSize(page, 'Full')).toEqual([3000, 4000]);
		expect(await sourceDigest(page)).toBe('unchanged');
	});

	test('AC-F20.5: a 1200 x 800 crop exports at 1200 x 800 and 600 x 400', async ({
		page,
	}) => {
		await openWithTransform(
			page,
			transformOf({crop: {x: 500, y: 600, width: 1200, height: 800}}),
		);
		await page.getByRole('button', {name: 'Export'}).click();
		expect(await downloadSize(page, 'Full')).toEqual([1200, 800]);
		expect(await downloadSize(page, '1/2')).toEqual([600, 400]);
	});
});
