import {describe, expect, it} from 'vite-plus/test';
import {encodeMaskAsset} from '../../src/engine/mask/asset.ts';
import {
	BRUSH_SAVE_DEBOUNCE_MS,
	DEFAULT_BRUSH_SETTINGS,
	normalizeBrushSettings,
	stepBrushSize,
} from '../../src/state/brush.ts';
import type {NewMask} from '../../src/storage/types.ts';
import {createTestStore, flushMicrotasks, makeTestBlob} from './fixtures.ts';

async function setup() {
	const context = createTestStore();
	const {store} = context;
	await store.getState().importImage({
		name: 'base.png',
		blob: makeTestBlob('base'),
		width: 40,
		height: 30,
	});
	const {id} = await store.getState().addEffect('pixelSort');
	await store.getState().setMaskKind(id, 'paint');
	const mask = () => {
		const found = store
			.getState()
			.activeProject!.stack.instances.find((item) => item.id === id)?.mask;
		return found?.kind === 'paint' ? found.asset : undefined;
	};

	const labels = () => store.getState().history.map((entry) => entry.label);
	return {...context, id, mask, labels};
}

async function asset(value: number): Promise<NewMask> {
	const {sha256, width, height, compressed} = await encodeMaskAsset({
		width: 40,
		height: 30,
		data: new Uint8Array(1200).fill(value),
	});
	return {sha256, width, height, blob: new Blob([compressed])};
}

describe('app store brush (product.md F29)', () => {
	it('turns on with a new painted mask and only for one', async () => {
		const {store, id} = await setup();
		expect(store.getState().activeBrush).toEqual({
			instanceId: id,
			tool: 'paint',
		});
		await store.getState().setMaskKind(id, 'luma');
		expect(store.getState().activeBrush).toBeNull();
		store.getState().setBrush(id);
		expect(store.getState().activeBrush).toBeNull();
	});

	it.each([
		[
			'another effect is selected',
			async (store: Awaited<ReturnType<typeof setup>>['store']) => {
				await store.getState().addEffect('pixelSort');
			},
		],
		[
			'the mask is removed',
			async (store: Awaited<ReturnType<typeof setup>>['store'], id: string) => {
				await store.getState().setMaskKind(id, null);
			},
		],
		[
			'the effect is removed',
			async (store: Awaited<ReturnType<typeof setup>>['store'], id: string) => {
				await store.getState().removeEffect(id);
			},
		],
		[
			'the editor is left',
			async (store: Awaited<ReturnType<typeof setup>>['store']) => {
				await store.getState().closeProject();
			},
		],
	])('turns off when %s', async (_case, act) => {
		const {store, id} = await setup();
		await act(store, id);
		expect(store.getState().activeBrush).toBeNull();
	});

	it('stays on while Compare suspends it', async () => {
		const {store, transientStore} = await setup();
		transientStore.setState({compareLatched: true});
		store.getState().setBrushTool('erase');
		transientStore.setState({compareLatched: false});
		expect(store.getState().activeBrush?.tool).toBe('erase');
	});

	it('commits one stroke as one entry, and a later undo waits for it', async () => {
		const {store, id, mask, labels} = await setup();
		const painted = await asset(200);
		const {promise, resolve} = Promise.withResolvers<NewMask>();
		const committed = store.getState().commitStroke(id, 'erase', promise);
		const undone = store.getState().undo();
		expect(store.getState().brushInterrupt).toBe(1);
		await flushMicrotasks();
		resolve(painted);
		await expect(committed).resolves.toBe(true);
		await undone;
		expect(labels().at(-1)).toBe('Erase mask');
		expect(mask()).toBe('');
		await store.getState().redo();
		expect(mask()).toBe(painted.sha256);
		expect(store.getState().activeBrush?.instanceId).toBe(id);
	});

	it('writes no entry for a stroke that changed nothing', async () => {
		const {store, id, labels} = await setup();
		const before = labels();
		await expect(
			store.getState().commitStroke(id, 'paint', Promise.resolve(null)),
		).resolves.toBe(false);
		expect(labels()).toEqual(before);
	});

	it('selects the painted effect again after an undo that moved the selection', async () => {
		const {store, id} = await setup();
		const other = await store.getState().addEffect('pixelSort');
		store.getState().selectEffect(id);
		store.getState().setBrush(id);
		await store.getState().undo();
		expect(other.id).not.toBe(id);
		expect(store.getState().activeProject!.selectedInstanceId).toBe(id);
		expect(store.getState().activeBrush?.instanceId).toBe(id);
	});

	it('saves the brush and overlay settings on the device after a pause', async () => {
		const {store, repository, timerEnv} = await setup();
		store.getState().setBrushSettings({size: 5000, hardness: 12});
		store.getState().setMaskOverlay({visible: false});
		timerEnv.advance(BRUSH_SAVE_DEBOUNCE_MS - 1);
		await flushMicrotasks();
		expect((await repository.getAppState()).brush).toBeUndefined();
		timerEnv.advance(1);
		await flushMicrotasks();
		expect((await repository.getAppState()).brush).toEqual({
			...DEFAULT_BRUSH_SETTINGS,
			size: 2000,
			hardness: 12,
			showMask: false,
		});
	});
});

describe('brush settings', () => {
	it('repairs a stored record', () => {
		expect(normalizeBrushSettings(undefined)).toEqual(DEFAULT_BRUSH_SETTINGS);
		expect(
			normalizeBrushSettings({
				size: 0,
				hardness: 'soft',
				strength: 50.6,
				overlayOpacity: 1,
				penPressure: false,
			}),
		).toEqual({
			...DEFAULT_BRUSH_SETTINGS,
			size: 1,
			strength: 51,
			overlayOpacity: 10,
			penPressure: false,
		});
	});

	it('steps the size by 1 px below 20 px and by 10% from there', () => {
		expect(
			[1, 19, 20, 100, 2000].map((size) => stepBrushSize(size, 1)),
		).toEqual([2, 20, 22, 110, 2000]);
		expect(
			[1, 2, 20, 21, 22, 100].map((size) => stepBrushSize(size, -1)),
		).toEqual([1, 1, 19, 20, 20, 90]);
	});
});
