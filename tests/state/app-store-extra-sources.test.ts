import {describe, expect, it} from 'vite-plus/test';
import {imageBlendSpec} from '../../src/engine/effects/image-blend-spec.ts';
import {defaultParams} from '../../src/engine/params.ts';
import type {EffectStack} from '../../src/engine/types.ts';
import {
	createRenderCoordinator,
	type CoordinatorEnv,
	type Frame,
} from '../../src/render/coordinator.ts';
import {createAppStore} from '../../src/state/app-store.ts';
import {MemoryStorageAdapter} from '../../src/storage/memory-adapter.ts';
import type {PreviewRequest} from '../../src/worker/protocol.ts';
import {
	createFakeRouterEnv,
	createFakeTimerEnv,
	createTestStore,
	flushMicrotasks,
	makeTestBlob,
} from './fixtures.ts';

function blendStack(image: string): EffectStack {
	return {
		schemaVersion: 1,
		instances: [
			{
				id: 'blend000',
				type: 'imageBlend',
				version: 1,
				enabled: true,
				params: {...defaultParams(imageBlendSpec.params), image},
				mix: 1,
				blend: 'normal',
			},
		],
	};
}

// A project to edit, plus two stored images for it to blend.
async function importThree(
	store: ReturnType<typeof createTestStore>['store'],
): Promise<{red: string; blue: string; projectId: string}> {
	const add = async (name: string, width: number, height: number) =>
		store.getState().importImage({
			name: `${name}.png`,
			blob: makeTestBlob(name),
			width,
			height,
		});
	const red = await add('red', 640, 480);
	const blue = await add('blue', 300, 900);
	const base = await add('base', 400, 300);
	return {
		red: red.source.sha256,
		blue: blue.source.sha256,
		projectId: base.project.id,
	};
}

describe('app store extra sources (engine.md section 8.3)', () => {
	it('reads them from storage for both coordinators', async () => {
		const context = createTestStore();
		const {store, coordinator, sideCoordinators} = context;
		const {red} = await importThree(store);
		await store.getState().setCompareMode('split');
		await store.getState().setEditSide('a');
		await store.getState().applyStack(blendStack(red), 'Blend');

		for (const used of [coordinator, sideCoordinators.at(-1)!]) {
			const loader = used.extraSourceLoader!;
			await expect(loader(red)).resolves.toMatchObject({
				sha256: red,
				width: 640,
				height: 480,
			});
			await expect(loader('f'.repeat(64))).resolves.toBeUndefined();
		}
	});

	it('gives each side of the split view its own images, and follows a swap', async () => {
		const posted: PreviewRequest[][] = [];
		const env: CoordinatorEnv = {
			createPreviewWorker() {
				const messages: PreviewRequest[] = [];
				posted.push(messages);
				return {
					post(message) {
						messages.push(message);
					},
					terminate() {},
				};
			},
			createExportWorker: () => ({post() {}, terminate() {}}),
			now: () => 0,
			setTimeout: () => 0,
			clearTimeout() {},
		};
		const timerEnv = createFakeTimerEnv();
		const {store, dispose} = createAppStore({
			repository: new MemoryStorageAdapter({now: () => timerEnv.now()}),
			coordinator: createRenderCoordinator(env),
			createSideCoordinator: () => createRenderCoordinator(env),
			routerEnv: createFakeRouterEnv(),
			timerEnv,
			thumbnailGenerator: async () => null,
		});
		const {red, blue} = await importThree(store);
		await store.getState().setCompareMode('split');
		await store.getState().applyStack(blendStack(red), 'Blend');
		await store.getState().setEditSide('a');
		await store.getState().applyStack(blendStack(blue), 'Blend');
		await flushMicrotasks();

		// The images each worker holds after every load and unload sent to it.
		const held = (worker: number) => {
			const images = new Set<string>();
			for (const message of posted[worker]) {
				if (message.type === 'loadExtraSource') {
					images.add(message.sha256);
				} else if (message.type === 'unloadExtraSource') {
					images.delete(message.sha256);
				}
			}

			return [...images];
		};

		expect(posted).toHaveLength(2);
		expect(held(0)).toEqual([red]);
		expect(held(1)).toEqual([blue]);
		expect(
			posted[1].find((message) => message.type === 'loadExtraSource'),
		).toMatchObject({sourceWidth: 300, sourceHeight: 900});

		await store.getState().swapSides();
		await flushMicrotasks();
		expect(held(0)).toEqual([blue]);
		expect(held(1)).toEqual([red]);

		await store.getState().closeProject();
		expect(held(0)).toEqual([]);
		dispose();
	});

	it('makes no thumbnail from a frame that may lack an image', async () => {
		const context = createTestStore();
		const {store, coordinator, thumbnailCalls} = context;
		const {red} = await importThree(store);
		await store.getState().applyStack(blendStack(red), 'Blend');

		const frame = (generation: number): Frame => ({
			generation,
			level: 'settle',
			bitmap: {width: 400, height: 300, close() {}},
			width: 400,
			height: 300,
			totalMs: 1,
			perInstanceMs: [1],
			warnings: [],
		});
		coordinator.emit({
			type: 'frame',
			frame: {...frame(1), sourcesPending: true},
		});
		await flushMicrotasks();
		expect(thumbnailCalls).toEqual([]);

		coordinator.emit({type: 'frame', frame: frame(2)});
		await flushMicrotasks();
		expect(thumbnailCalls).toEqual([2]);
	});
});
