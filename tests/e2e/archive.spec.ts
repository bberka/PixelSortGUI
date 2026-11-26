import {expect, test} from '@playwright/test';
import type * as ArchiveClient from '../../src/storage/archive-client.ts';
import {builtAsset} from './render-fixtures.ts';

test.describe('archive worker in the production build', () => {
	test('is not loaded with the app', async ({page}) => {
		const requested: string[] = [];
		page.on('request', (request) => {
			requested.push(request.url());
		});
		await page.goto('/', {waitUntil: 'networkidle'});

		expect(
			requested.filter((url) => url.includes('/assets/')),
		).not.toHaveLength(0);
		expect(requested.filter((url) => url.includes('archive'))).toStrictEqual(
			[],
		);
	});

	test('saves, opens and cancels a project file', async ({page, baseURL}) => {
		const origins = new Set<string>();
		page.on('request', (request) => {
			origins.add(new URL(request.url()).origin);
		});
		await page.goto('/');

		const result = await page.evaluate(async (url) => {
			const client = (await import(url)) as typeof ArchiveClient;
			const bytes = new Uint8Array(40 * 1024 * 1024);
			for (let at = 0; at < bytes.length; at += 65_536) {
				crypto.getRandomValues(bytes.subarray(at, at + 65_536));
			}

			const hex = async (data: BufferSource) =>
				Array.from(
					new Uint8Array(await crypto.subtle.digest('SHA-256', data)),
					(byte) => byte.toString(16).padStart(2, '0'),
				).join('');
			const sha256 = await hex(bytes);
			const stack = {schemaVersion: 1 as const, instances: []};
			const transform = {
				rotation: 90 as const,
				flipX: false,
				flipY: false,
				crop: null,
				resize: null,
			};
			const input = {
				appVersion: 'e2e',
				project: {
					id: crypto.randomUUID(),
					name: 'Browser round trip',
					sourceHash: sha256,
					sourceWidth: 8000,
					sourceHeight: 6250,
					transform,
					effectiveWidth: 6250,
					effectiveHeight: 8000,
					stack,
					selectedInstanceId: null,
					historyHeadSeq: 0,
					historyMinSeq: 0,
					historyMaxSeq: 0,
					viewState: {
						fitMode: 'fit' as const,
						zoom: 1,
						centerX: 3125,
						centerY: 4000,
						splitPosition: 0.5,
					},
					exportSettings: {
						format: 'png' as const,
						quality: 92,
						sizeMode: 'full' as const,
						customLongestSide: null,
						maxFileSizeKb: null,
					},
					createdAt: 1,
					updatedAt: 2,
					openedAt: 3,
				},
				sources: [
					{
						sha256,
						blob: new Blob([bytes], {type: 'image/jpeg'}),
						mimeType: 'image/jpeg',
						byteLength: bytes.length,
						width: 8000,
						height: 6250,
						createdAt: 1,
					},
				],
				history: [
					{
						projectId: 'p',
						seq: 0,
						label: 'Initial',
						stack,
						selectedInstanceId: null,
						transform,
						createdAt: 1,
					},
				],
			};

			const saving: number[] = [];
			const {blob, fileName} = await client.saveProjectFile(input, {
				onProgress({fraction}) {
					saving.push(fraction);
				},
			});
			const opening: number[] = [];
			const contents = await client.openProjectFile(blob, fileName, {
				onProgress({fraction}) {
					opening.push(fraction);
				},
			});

			const cancel = async (
				// eslint-disable-next-line unicorn/isolated-functions -- a type, erased before the page runs the function
				job: (options: ArchiveClient.ArchiveJobOptions) => Promise<unknown>,
			) => {
				const controller = new AbortController();
				let abortedAt = 0;
				try {
					await job({
						signal: controller.signal,
						onProgress() {
							abortedAt ||= performance.now();
							controller.abort();
						},
					});
					return {name: 'finished', milliseconds: 0};
				} catch (error) {
					return {
						name: (error as Error).name,
						milliseconds: performance.now() - abortedAt,
					};
				}
			};

			const damaged = await client
				.openProjectFile(blob.slice(0, 1000), 'cut.glproj')
				.catch((error: unknown) => (error as Error).message);

			return {
				fileName,
				saving,
				opening,
				transform: contents.project.transform,
				history: contents.history?.length,
				sameSource:
					(await hex(await contents.sources[0].blob.arrayBuffer())) === sha256,
				cancelledSave: await cancel(async (options) =>
					client.saveProjectFile(input, options),
				),
				cancelledOpen: await cancel(async (options) =>
					client.openProjectFile(blob, fileName, options),
				),
				damaged,
			};
		}, builtAsset('archive-client'));

		expect(result.fileName).toMatch(/^browser-round-trip-\d{8}-\d{6}\.glproj$/);
		expect(result.sameSource).toBe(true);
		expect(result.transform.rotation).toBe(90);
		expect(result.history).toBe(1);
		for (const progress of [result.saving, result.opening]) {
			expect(progress.length).toBeGreaterThan(10);
			expect(progress.at(-1)).toBe(1);
		}

		for (const cancelled of [result.cancelledSave, result.cancelledOpen]) {
			expect(cancelled.name).toBe('AbortError');
			expect(cancelled.milliseconds).toBeLessThan(1000);
		}

		expect(result.damaged).toBe(
			"Can't open cut.glproj: the file is damaged or not a valid project archive.",
		);
		expect([...origins]).toStrictEqual([new URL(baseURL!).origin]);
	});
});
