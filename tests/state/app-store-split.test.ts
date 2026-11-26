import {describe, expect, it} from 'vite-plus/test';
import {selectRedoLabel, selectUndoLabel} from '../../src/state/app-store.ts';
import {
	selectEditingSide,
	selectEditingStack,
	sideCanvasLabel,
	sideOptionLabel,
} from '../../src/state/split-sides.ts';
import {
	createDefaultViewState,
	normalizeViewState,
} from '../../src/storage/helpers.ts';
import {restoreStartup} from '../../src/storage/restore.ts';
import {
	createFakeCoordinator,
	createFakeRouterEnv,
	createTestStore,
	makeTestBlob,
	type FakeCoordinator,
} from './fixtures.ts';

type Context = ReturnType<typeof createTestStore>;

async function setupSplit() {
	const context = createTestStore();
	const {project} = await context.store.getState().importImage({
		name: 'split.png',
		blob: makeTestBlob('split'),
		width: 400,
		height: 300,
	});
	await context.store.getState().setCompareMode('split');
	context.coordinator.calls.length = 0;
	return {...context, project};
}

const active = (context: Context) => context.store.getState().activeProject!;

const types = (stack: {instances: ReadonlyArray<{type: string}>} | undefined) =>
	(stack?.instances ?? []).map((instance) => instance.type);

const stackRequests = (coordinator: FakeCoordinator) =>
	coordinator.calls.filter((call) => call.type === 'setStack');

describe('app store — split sides', () => {
	it('edits side B by default, and side A only after it is chosen with the split on', async () => {
		const context = await setupSplit();
		const {store} = context;

		await store.getState().addEffect('pixelSort');
		await store.getState().setEditSide('a');
		await store.getState().addEffect('channelShift');

		expect(types(active(context).stack)).toEqual(['pixelSort']);
		expect(types(active(context).stackA)).toEqual(['channelShift']);
		expect(selectEditingStack(store.getState())).toBe(active(context).stackA);

		// With the split off the panels and new edits go back to side B.
		await store.getState().setCompareMode('toggle');
		expect(selectEditingSide(store.getState())).toBe('b');
		await store.getState().addEffect('channelShift');
		expect(types(active(context).stack)).toEqual(['pixelSort', 'channelShift']);
		expect(types(active(context).stackA)).toEqual(['channelShift']);
	});

	it('names the side in history labels only while the split is on or for side A', async () => {
		const context = await setupSplit();
		const {store, repository, project} = context;

		await store.getState().addEffect('pixelSort');
		await store.getState().setEditSide('a');
		const side = await store.getState().addEffect('channelShift');
		await store.getState().setCompareMode('toggle');
		await store.getState().addEffect('pixelSort');
		// A pending edit to side A flushed after the split closed still says so.
		await store.getState().commitMix(side.id, 0.5);

		const history = await repository.getHistory(project.id);
		expect(history.map((entry) => entry.label)).toEqual([
			'Initial',
			'Add Pixel sort (side B)',
			'Add Channel shift (side A)',
			'Add Pixel sort',
			'Mix 50% (side A)',
		]);
	});

	it('undoes and redoes edits to both sides in order', async () => {
		const context = await setupSplit();
		const {store} = context;

		await store.getState().addEffect('pixelSort');
		await store.getState().setEditSide('a');
		await store.getState().addEffect('channelShift');

		expect(selectUndoLabel(store.getState())).toBe(
			'Add Channel shift (side A)',
		);
		await store.getState().undo();
		expect(active(context).stackA).toBeUndefined();
		expect(types(active(context).stack)).toEqual(['pixelSort']);
		expect(selectRedoLabel(store.getState())).toBe(
			'Add Channel shift (side A)',
		);
		// Undo never changes which side is being edited.
		expect(selectEditingSide(store.getState())).toBe('a');

		await store.getState().undo();
		expect(types(active(context).stack)).toEqual([]);
		await store.getState().redo();
		await store.getState().redo();
		expect(types(active(context).stackA)).toEqual(['channelShift']);
		expect(types(active(context).stack)).toEqual(['pixelSort']);

		// A history jump moves both sides too.
		await store.getState().jumpToHistory(context.project.id, 1);
		expect(active(context).stackA).toBeUndefined();
		await store.getState().jumpToHistory(context.project.id, 2);
		expect(types(active(context).stackA)).toEqual(['channelShift']);
	});

	it('routes edits by instance id, keeping a selection per side', async () => {
		const context = await setupSplit();
		const {store} = context;
		const main = await store.getState().addEffect('channelShift');
		await store.getState().setEditSide('a');
		const side = await store.getState().addEffect('channelShift');

		// Editing B's instance while A is chosen still changes B only.
		await store.getState().commitParam(main.id, 'redX', 7);
		await store.getState().setEffectEnabled(side.id, false);

		expect(active(context).stack.instances[0]?.params.redX).toBe(7);
		expect(active(context).stack.instances[0]?.enabled).toBe(true);
		expect(active(context).stackA?.instances[0]?.enabled).toBe(false);
		expect(active(context).selectedInstanceId).toBe(main.id);
		expect(active(context).selectedInstanceIdA).toBe(side.id);

		store.getState().selectEffect(null);
		expect(active(context).selectedInstanceIdA).toBeNull();
		expect(active(context).selectedInstanceId).toBe(main.id);

		await store.getState().removeEffect(side.id);
		expect(active(context).stackA).toBeUndefined();
		expect(types(active(context).stack)).toEqual(['channelShift']);
	});

	it('copies the edited side over the other with new ids, as one undo step', async () => {
		const context = await setupSplit();
		const {store, repository, project} = context;
		await store.getState().addEffect('pixelSort');
		const second = await store.getState().addEffect('channelShift');
		const before = (await repository.getHistory(project.id)).length;

		await store.getState().copyToOtherSide();

		const copied = active(context);
		expect(types(copied.stackA)).toEqual(types(copied.stack));
		expect(copied.stackA?.instances.map((item) => item.params)).toEqual(
			copied.stack.instances.map((item) => item.params),
		);
		const ids = [...copied.stack.instances, ...copied.stackA!.instances].map(
			(item) => item.id,
		);
		expect(new Set(ids).size).toBe(4);
		// The counterpart of the selected instance is selected on the other side.
		expect(copied.selectedInstanceId).toBe(second.id);
		expect(copied.selectedInstanceIdA).toBe(copied.stackA!.instances[1].id);
		const history = await repository.getHistory(project.id);
		expect(history).toHaveLength(before + 1);
		expect(history.at(-1)?.label).toBe('Copy B to A');

		await store.getState().undo();
		expect(active(context).stackA).toBeUndefined();
	});

	it('does not copy an empty side over the other', async () => {
		const context = await setupSplit();
		const {store} = context;
		await store.getState().addEffect('pixelSort');
		await store.getState().setEditSide('a');

		await store.getState().copyToOtherSide();

		expect(types(active(context).stack)).toEqual(['pixelSort']);
		expect(context.store.getState().history).toHaveLength(2);
	});

	it('swaps the two stacks and their selections as one undo step', async () => {
		const context = await setupSplit();
		const {store} = context;
		await store.getState().swapSides();
		expect(store.getState().history).toHaveLength(1);

		const main = await store.getState().addEffect('pixelSort');
		await store.getState().swapSides();

		expect(types(active(context).stack)).toEqual([]);
		expect(active(context).stackA?.instances[0]?.id).toBe(main.id);
		expect(active(context).selectedInstanceIdA).toBe(main.id);
		expect(active(context).selectedInstanceId).toBeNull();
		expect(selectUndoLabel(store.getState())).toBe('Swap sides');

		await store.getState().undo();
		expect(active(context).stack.instances[0]?.id).toBe(main.id);
		expect(active(context).stackA).toBeUndefined();
	});

	it('applies, appends and saves presets on the edited side', async () => {
		const context = await setupSplit();
		const {store, repository, project} = context;
		await store.getState().addEffect('channelShift');
		await store.getState().setEditSide('a');

		await store.getState().applyPreset('builtin:asdf-classic');
		await store.getState().addPresetToStack('builtin:grey-band');
		const saved = await store.getState().saveStackAsPreset('Left look');

		expect(types(active(context).stack)).toEqual(['channelShift']);
		expect(types(active(context).stackA)).toHaveLength(3);
		expect(saved.stack.instances).toHaveLength(3);
		const history = await repository.getHistory(project.id);
		expect(history.at(-2)?.label).toBe('Apply preset ASDF classic (side A)');
		expect(history.at(-1)?.label).toBe('Add Grey band (side A)');
	});

	it('creates no side A renderer while side A is empty or the split is off', async () => {
		const context = await setupSplit();
		const {store, sideCoordinators} = context;
		await store.getState().addEffect('pixelSort');
		expect(sideCoordinators).toHaveLength(0);

		await store.getState().setEditSide('a');
		await store.getState().addEffect('channelShift');
		expect(sideCoordinators).toHaveLength(1);
		const first = sideCoordinators[0];
		expect(stackRequests(first).at(-1)?.request.stack).toEqual(
			active(context).stackA,
		);

		await store.getState().setCompareMode('toggle');
		expect(first.calls.at(-1)?.type).toBe('dispose');
		await store.getState().setCompareMode('split');
		expect(sideCoordinators).toHaveLength(2);

		await store
			.getState()
			.removeEffect(active(context).stackA!.instances[0].id);
		expect(sideCoordinators[1].calls.at(-1)?.type).toBe('dispose');
		expect(sideCoordinators).toHaveLength(2);
	});

	it('gives side A the same transformed source as side B', async () => {
		const context = await setupSplit();
		const {store, sideCoordinators} = context;
		const transform = {
			rotation: 90,
			flipX: false,
			flipY: true,
			crop: {x: 10, y: 20, width: 200, height: 150},
			resize: null,
		} as const;
		await store.getState().setEditSide('a');
		await store.getState().addEffect('channelShift');
		// Storage does not keep a transform until T7.14, so set it in memory.
		store.setState({activeProject: {...active(context), transform}});

		const sources = sideCoordinators[0].calls.filter(
			(call) => call.type === 'setSource',
		);
		expect(sources.at(-1)).toMatchObject({source: {transform}});
	});

	it('renders only the side that changed, coalescing drags per side', async () => {
		const context = await setupSplit();
		const {store, coordinator, sideCoordinators} = context;
		const main = await store.getState().addEffect('channelShift');
		await store.getState().setEditSide('a');
		const side = await store.getState().addEffect('channelShift');
		const sideCoordinator = sideCoordinators[0];
		coordinator.calls.length = 0;
		sideCoordinator.calls.length = 0;

		store.getState().dragParam(side.id, 'redX', 5);
		store.getState().dragParam(side.id, 'redX', 9);
		await store.getState().commitParam(side.id, 'redX', 9);

		expect(stackRequests(coordinator)).toEqual([]);
		const requests = stackRequests(sideCoordinator);
		expect(
			requests.map((call) => [
				call.request.stack.instances[0]?.params.redX,
				call.options?.dragging ?? false,
			]),
		).toEqual([
			[5, true],
			[9, true],
		]);
		// The release asks for the settle render of the value already sent.
		expect(sideCoordinator.calls.at(-1)?.type).toBe('endDrag');

		sideCoordinator.calls.length = 0;
		store.getState().dragParam(main.id, 'redX', 3);
		await store.getState().commitParam(main.id, 'redX', 3);
		expect(stackRequests(coordinator).length).toBeGreaterThan(0);
		expect(sideCoordinator.calls).toEqual([]);
	});

	it('returns side A to its committed value when a drag is cancelled', async () => {
		const context = await setupSplit();
		const {store, coordinator, sideCoordinators} = context;
		await store.getState().setEditSide('a');
		const side = await store.getState().addEffect('channelShift');
		const sideCoordinator = sideCoordinators[0];
		const committed = active(context).stackA!.instances[0].params.redX;
		coordinator.calls.length = 0;

		store.getState().dragParam(side.id, 'redX', 11);
		store.getState().cancelDrag();

		expect(
			stackRequests(sideCoordinator).at(-1)?.request.stack.instances[0]?.params
				.redX,
		).toBe(committed);
		expect(stackRequests(coordinator)).toEqual([]);
	});

	it('re-sends side B when undo drops its drag but changes only side A', async () => {
		const context = await setupSplit();
		const {store, coordinator} = context;
		const main = await store.getState().addEffect('channelShift');
		await store.getState().setEditSide('a');
		await store.getState().addEffect('channelShift');
		const committed = active(context).stack.instances[0].params.redX;
		coordinator.calls.length = 0;

		store.getState().dragParam(main.id, 'redX', 11);
		await store.getState().undo();

		expect(active(context).stackA).toBeUndefined();
		const last = stackRequests(coordinator).at(-1);
		expect(last?.request.stack.instances[0]?.params.redX).toBe(committed);
		expect(last?.options?.dragging ?? false).toBe(false);
	});

	it('keeps side A frames apart from side B and clears them with the renderer', async () => {
		const context = await setupSplit();
		const {store, sideCoordinators} = context;
		await store.getState().setEditSide('a');
		await store.getState().addEffect('channelShift');

		sideCoordinators[0].emit({type: 'busy', level: 'settle', busy: true});
		expect(store.getState().renderA.busy.settle).toBe(true);
		expect(store.getState().render.busy.settle).toBe(false);

		await store.getState().setCompareMode('toggle');
		expect(store.getState().renderA.busy.settle).toBe(false);
	});

	it('restores orientation, edited side, side A and its renderer after a restart', async () => {
		const context = await setupSplit();
		const {store, repository, project} = context;
		await store.getState().setEditSide('a');
		const side = await store.getState().addEffect('channelShift');
		store.getState().setSplitOrientation('horizontal');
		store.getState().commitSplitPosition(0.3);
		await store.getState().flushViewState();

		const sideCoordinators: FakeCoordinator[] = [];
		const result = await restoreStartup({
			coordinator: createFakeCoordinator(),
			createSideCoordinator() {
				const created = createFakeCoordinator();
				sideCoordinators.push(created);
				return created;
			},
			routerEnv: createFakeRouterEnv(`#/p/${project.id}`),
			isSecureContext: true,
			scheduleIdle() {},
			mirrorTheme() {},
			readLocalTheme: () => null,
			async openStorageFn() {
				return {
					repository,
					persistence: 'memory',
					storageUnavailable: true,
					error: undefined,
				};
			},
		});
		if (result.status !== 'ready') {
			throw new Error(result.status);
		}

		await result.hydrationPromise;
		const restored = result.bundle.store.getState();
		expect(restored.activeProject?.viewState).toMatchObject({
			splitOrientation: 'horizontal',
			editSide: 'a',
			splitPosition: 0.3,
		});
		expect(restored.activeProject?.selectedInstanceIdA).toBe(side.id);
		expect(selectEditingStack(restored)?.instances[0]?.id).toBe(side.id);
		expect(sideCoordinators).toHaveLength(1);
		result.bundle.dispose();
	});

	it('keeps the edited side when its pending save overlaps a commit', async () => {
		const context = await setupSplit();
		const {store, repository} = context;
		const commitStack = repository.commitStack.bind(repository);
		// The debounced save starts after the commit read the old view state.
		repository.commitStack = async (input) => {
			const result = await commitStack(input);
			void store.getState().flushViewState();
			return result;
		};

		await store.getState().setEditSide('a');
		await store.getState().addEffect('channelShift');

		expect(selectEditingSide(store.getState())).toBe('a');

		const undo = repository.undo.bind(repository);
		repository.undo = async (id) => {
			store.getState().setSplitOrientation('horizontal');
			return undo(id);
		};

		await store.getState().undo();
		expect(active(context).viewState.splitOrientation).toBe('horizontal');
		expect(selectEditingSide(store.getState())).toBe('a');
	});

	it('keeps orientation per project', async () => {
		const context = await setupSplit();
		const {store, project} = context;
		store.getState().setSplitOrientation('horizontal');
		await store.getState().importImage({
			name: 'other.png',
			blob: makeTestBlob('other'),
			width: 40,
			height: 30,
		});
		expect(active(context).viewState.splitOrientation).toBeUndefined();

		await store.getState().openProject(project.id);
		expect(active(context).viewState.splitOrientation).toBe('horizontal');
	});
});

describe('split labels and view state', () => {
	it('labels each side by letter and position, and "Original" while empty', async () => {
		const context = await setupSplit();
		expect(sideOptionLabel('a', 'vertical')).toBe('A · Left');
		expect(sideOptionLabel('b', 'vertical')).toBe('B · Right');
		expect(sideOptionLabel('a', 'horizontal')).toBe('A · Top');
		expect(sideOptionLabel('b', 'horizontal')).toBe('B · Bottom');

		await context.store.getState().addEffect('pixelSort');
		expect(sideCanvasLabel(active(context), 'a')).toBe('Original');
		expect(sideCanvasLabel(active(context), 'b')).toBe('B');
	});

	it('removes unknown orientation and side values from a stored view state', () => {
		const normalized = normalizeViewState({
			...createDefaultViewState(10, 10),
			splitOrientation: 'diagonal' as never,
			editSide: 'c' as never,
		});

		expect(normalized).toEqual(createDefaultViewState(10, 10));
	});
});
