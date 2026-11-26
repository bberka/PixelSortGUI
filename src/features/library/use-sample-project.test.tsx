// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {toast} from 'sonner';
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {createTestStore, makeTestBlob} from '../../../tests/state/fixtures.ts';
import {SHOWCASE_TILES} from './showcase.ts';
import {useSampleProject, type SampleProject} from './use-sample-project.ts';
import {AppRuntimeProvider} from '@/app/runtime-context.tsx';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let root: ReturnType<typeof createRoot> | undefined;

afterEach(() => {
	act(() => {
		root?.unmount();
	});
	vi.restoreAllMocks();
});

function mountHook(makeBlob: () => Promise<Blob>) {
	const test = createTestStore();
	let latest: SampleProject | undefined;
	function Probe() {
		latest = useSampleProject(makeBlob);
		return null;
	}

	root = createRoot(document.createElement('div'));
	act(() => {
		root!.render(
			<AppRuntimeProvider
				value={{
					runtime: {
						ready: new Promise(() => {}),
						result: null,
						dispose() {},
					},
					bundle: test.bundle,
				}}
			>
				<Probe />
			</AppRuntimeProvider>,
		);
	});
	return {...test, sample: () => latest!};
}

async function settle(isDone: () => boolean) {
	await vi.waitFor(async () => {
		// Each poll lets React apply the updates made since the last one.
		await act(async () => {
			await Promise.resolve();
		});
		expect(isDone()).toBe(true);
	});
}

describe('useSampleProject', () => {
	it('creates one project for two activations in a row (AC-F2.10)', async () => {
		const makeBlob = vi.fn(async () => makeTestBlob('sample'));
		const {store, sample} = mountHook(makeBlob);

		act(() => {
			sample().create();
			sample().create();
		});
		expect(sample().busy).toBe(true);
		await settle(() => !sample().busy);

		expect(makeBlob).toHaveBeenCalledTimes(1);
		expect(store.getState().projects).toHaveLength(1);
		expect(store.getState().activeProject).toMatchObject({
			name: 'Sample',
			sourceWidth: 1200,
			sourceHeight: 900,
			stack: {instances: []},
		});
	});

	it('applies the picked tile as one history entry (AC-F2.11)', async () => {
		const {store, sample} = mountHook(async () => makeTestBlob('sample'));

		act(() => {
			sample().create(SHOWCASE_TILES[1]);
		});
		await settle(() => !sample().busy);

		expect(store.getState().history.map((entry) => entry.label)).toEqual([
			'Initial',
			'Apply preset Channel shift',
		]);
		expect(store.getState().activeProject!.stack.instances[0].type).toBe(
			'channelShift',
		);
	});

	it('says so when the sample cannot be made, and can be tried again', async () => {
		const failed = vi.spyOn(toast, 'error');
		const makeBlob = vi
			.fn<() => Promise<Blob>>()
			.mockRejectedValueOnce(new Error('no canvas'))
			.mockResolvedValue(makeTestBlob('sample'));
		const {store, sample} = mountHook(makeBlob);

		act(() => {
			sample().create();
		});
		await settle(() => !sample().busy);
		expect(failed).toHaveBeenCalledWith("Couldn't create the sample project.");
		expect(store.getState().projects).toHaveLength(0);

		act(() => {
			sample().create();
		});
		await settle(() => !sample().busy);
		expect(store.getState().projects).toHaveLength(1);
	});
});
