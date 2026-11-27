import {describe, expect, it, vi} from 'vite-plus/test';
import {imageBlendSpec} from '../../src/engine/effects/image-blend-spec.ts';
import {defaultParams} from '../../src/engine/params.ts';
import type {EffectStack} from '../../src/engine/types.ts';
import {
	createRenderCoordinator,
	type CoordinatorEnv,
	type Frame,
} from '../../src/render/coordinator.ts';
import {createAppStore, type ImageChoice} from '../../src/state/app-store.ts';
import {hashBlobSha256} from '../../src/storage/helpers.ts';
import {MemoryStorageAdapter} from '../../src/storage/memory-adapter.ts';
import {StorageQuotaError} from '../../src/storage/types.ts';
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

// The stack of `blendStack('')`, ready for a choice.
async function blendProject(
	options: Parameters<typeof createTestStore>[0] = {},
) {
	const context = createTestStore(options);
	const images = await importThree(context.store);
	await context.store.getState().applyStack(blendStack(''), 'Add Image blend');
	const state = () => context.store.getState();
	// `applyStack` gives the instance a new id.
	const {id} = state().activeProject!.stack.instances[0];
	const chosen = () => state().activeProject!.stack.instances[0].params.image;
	const head = () => state().activeProject!.historyHeadSeq;
	const choose = async (choice: ImageChoice) =>
		state().commitImageParam(images.projectId, id, 'image', choice);
	return {...context, ...images, instanceId: id, chosen, head, choose};
}

function deviceImage(label: string): ImageChoice {
	return {
		image: {
			blob: makeTestBlob(label),
			mimeType: 'image/png',
			width: 32,
			height: 24,
		},
	};
}

describe('app store commitImageParam (product.md F26)', () => {
	it('stores a device image as one history entry and renders it', async () => {
		const {choose, chosen, head, repository, coordinator, store} =
			await blendProject();
		const before = head();
		const sha256 = await hashBlobSha256(makeTestBlob('green'));

		await expect(choose(deviceImage('green'))).resolves.toBe(true);

		expect(chosen()).toBe(sha256);
		expect(head()).toBe(before + 1);
		expect(store.getState().history.at(-1)?.label).toBe('Blend image chosen');
		expect(await repository.getSource(sha256)).toMatchObject({
			width: 32,
			height: 24,
		});
		expect(coordinator.calls.at(-1)).toMatchObject({
			type: 'setStack',
			request: {stack: {instances: [{params: {image: sha256}}]}},
		});
	});

	it('reuses a stored image, clears it, and undoes and redoes both', async () => {
		const {choose, chosen, red, blue, repository, store} = await blendProject();
		const sizes = await repository.getSourceSizes();

		await choose({sha256: red});
		await choose({sha256: blue});
		await choose({sha256: ''});

		expect(chosen()).toBe('');
		expect(store.getState().history.at(-1)?.label).toBe('Blend image cleared');
		expect(await repository.getSourceSizes()).toStrictEqual(sizes);
		await store.getState().undo();
		expect(chosen()).toBe(blue);
		await store.getState().undo();
		expect(chosen()).toBe(red);
		await store.getState().redo();
		expect(chosen()).toBe(blue);
	});

	it('writes nothing for the image it already shows', async () => {
		const {choose, head, red} = await blendProject();
		await choose(deviceImage('green'));
		const before = head();

		await expect(choose(deviceImage('green'))).resolves.toBe(false);
		await choose({sha256: red});
		await expect(choose({sha256: red})).resolves.toBe(false);

		expect(head()).toBe(before + 1);
	});

	it('keeps the chosen image when another edit was asked for first', async () => {
		const {choose, chosen, store, instanceId} = await blendProject();

		await Promise.all([
			store.getState().commitParam(instanceId, 'opacity', 0.5),
			choose(deviceImage('green')),
		]);

		expect(chosen()).not.toBe('');
		expect(
			store.getState().activeProject!.stack.instances[0].params.opacity,
		).toBe(0.5);
	});

	it('stores nothing for another project, instance or parameter', async () => {
		const {head, store, projectId, repository, instanceId} =
			await blendProject();
		const sizes = await repository.getSourceSizes();
		const before = head();
		const {commitImageParam} = store.getState();
		const choice = deviceImage('green');

		for (const [project, instance, key] of [
			['other', instanceId, 'image'],
			[projectId, 'gone', 'image'],
			[projectId, instanceId, 'opacity'],
		]) {
			await expect(
				commitImageParam(project, instance, key, choice),
			).resolves.toBe(false);
		}

		expect(head()).toBe(before);
		expect(await repository.getSourceSizes()).toStrictEqual(sizes);
	});

	it('refuses a ninth image with the message and stores no blob', async () => {
		const {head, store, projectId, repository} = await blendProject();
		const stack: EffectStack = {
			schemaVersion: 1,
			instances: [],
		};
		for (let index = 0; index < 8; index++) {
			const {source} = await store.getState().importImage({
				name: `extra ${index}.png`,
				blob: makeTestBlob(`extra-${index}`),
				width: 8,
				height: 8,
				setActive: false,
			});
			stack.instances.push({
				...blendStack(source.sha256).instances[0],
				id: `blend00${index}`,
			});
		}

		stack.instances.push({...blendStack('').instances[0], id: 'ninth000'});
		await store.getState().openProject(projectId);
		await store.getState().applyStack(stack, 'Eight images');
		const ninth = store.getState().activeProject!.stack.instances.at(-1)!.id;
		const sizes = await repository.getSourceSizes();
		const before = head();

		await expect(
			store
				.getState()
				.commitImageParam(projectId, ninth, 'image', deviceImage('ninth')),
		).rejects.toThrow('A project can use at most 8 extra blend images.');

		expect(head()).toBe(before);
		expect(await repository.getSourceSizes()).toStrictEqual(sizes);
	});

	it('opens the storage-full dialog when the device image does not fit', async () => {
		const timerEnv = createFakeTimerEnv();
		const repository = new MemoryStorageAdapter({now: () => timerEnv.now()});
		const {choose, store, head} = await blendProject({repository});
		const before = head();
		vi.spyOn(repository, 'commitStack').mockRejectedValueOnce(
			new StorageQuotaError(),
		);

		await expect(choose(deviceImage('green'))).rejects.toThrow(
			StorageQuotaError,
		);

		expect(store.getState().storage.quotaFull).toBe(true);
		expect(head()).toBe(before);
	});
});
