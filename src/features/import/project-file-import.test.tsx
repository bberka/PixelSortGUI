// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {createTestStore, makeTestBlob} from '../../../tests/state/fixtures.ts';
import {
	SOURCE_SIZE,
	transferDependencies,
} from '../../../tests/storage/project-transfer-fixtures.ts';
import {ImportFlowProvider} from './import-flow.tsx';
import {ImportImagesAction} from './import-images-action.tsx';
import {isProjectFileName} from './use-image-picker.ts';
import {WindowFileDrop} from './window-file-drop.tsx';
import {AppRuntimeProvider, useAppStore} from '@/app/runtime-context.tsx';
import {unsupportedEffectsNotice} from '@/state/app-store.ts';
import type {AppRuntime} from '@/state/index.ts';
import {MemoryStorageAdapter} from '@/storage/memory-adapter.ts';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const probe = async () => ({
	ok: true as const,
	value: {width: 100, height: 50, exceedsGuaranteedArea: false},
});

let root: ReturnType<typeof createRoot> | undefined;

afterEach(() => {
	act(() => {
		root?.unmount();
	});
	root = undefined;
	document.body.replaceChildren();
});

function setup() {
	const repository = new MemoryStorageAdapter(transferDependencies());
	return createTestStore({repository});
}

// A real `.glproj` of a project called `drive`.
async function projectFile(name = 'drive.glproj'): Promise<File> {
	const {store} = setup();
	const {project} = await store.getState().importImage({
		name: 'drive',
		blob: makeTestBlob(),
		...SOURCE_SIZE,
	});
	const {blob} = await store.getState().exportProjectFile(project.id);
	return new File([blob], name);
}

// The trigger leaves the screen once a project exists, as the empty Library does.
function EmptyOnlyTrigger() {
	const empty = useAppStore((state) => state.projects.length === 0);
	return empty ? <ImportImagesAction /> : null;
}

function mount(test: ReturnType<typeof setup>, ui: React.ReactNode) {
	const runtime = {
		ready: new Promise(() => {}),
		result: null,
		dispose() {},
	} as unknown as AppRuntime;
	const container = document.createElement('div');
	document.body.append(container);
	root = createRoot(container);
	act(() => {
		root!.render(
			<AppRuntimeProvider value={{runtime, bundle: test.bundle}}>
				{ui}
			</AppRuntimeProvider>,
		);
	});
}

function choose(files: readonly File[]): void {
	const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
	input.files = Object.assign(new FileList(), files);
	act(() => {
		input.dispatchEvent(new Event('change', {bubbles: true}));
	});
}

function drop(files: readonly File[]): void {
	const event = new Event('drop');
	Object.defineProperty(event, 'dataTransfer', {
		value: {types: ['Files'], files: [...files], dropEffect: 'none'},
	});
	act(() => {
		globalThis.dispatchEvent(event);
	});
}

async function until(predicate: () => boolean): Promise<void> {
	await vi.waitFor(async () => {
		await act(async () => {
			await Promise.resolve();
		});
		expect(predicate()).toBe(true);
	});
}

const text = () => document.body.textContent;
const dialogTitle = () =>
	document.querySelector('[role="alertdialog"] h2')?.textContent;

describe('opening project files (F25)', () => {
	it('knows project files by extension, in any letter case', () => {
		expect(
			['a.glproj', 'a.GLPROJ', 'a.zip', 'a.Zip'].every((name) =>
				isProjectFileName(name),
			),
		).toBe(true);
		expect(
			['a.png', 'glproj', 'a.zip.png'].some((name) => isProjectFileName(name)),
		).toBe(false);
	});

	it.each(['drive.glproj', 'drive.zip'])(
		'opens a dropped %s as the active project',
		async (name) => {
			const file = await projectFile(name);
			const test = setup();
			mount(test, <WindowFileDrop />);

			drop([file]);
			await until(() => test.store.getState().activeProject?.name === 'drive');

			expect(test.store.getState().projects).toHaveLength(1);
			expect(dialogTitle()).toBeUndefined();
		},
	);

	it('shows the exact error for a damaged file and stores nothing', async () => {
		const test = setup();
		mount(test, <WindowFileDrop />);

		drop([new File(['not a zip'], 'broken.glproj')]);
		await until(() => dialogTitle() !== undefined);

		expect(dialogTitle()).toBe("Can't open project");
		expect(text()).toContain(
			"Can't open broken.glproj: the file is damaged or not a valid project archive.",
		);
		expect(test.store.getState().projects).toHaveLength(0);
	});

	it('titles several refused projects, and a mix with images', async () => {
		const test = setup();
		mount(
			test,
			<WindowFileDrop
				probe={async () => ({
					ok: false,
					error: {code: 'decode-failed', message: 'no'},
				})}
			/>,
		);

		drop([new File(['x'], 'a.glproj'), new File(['y'], 'b.glproj')]);
		await until(() => dialogTitle() === "Can't open 2 projects");

		const dismiss = [...document.querySelectorAll('button')].find(
			(button) => button.textContent === 'Dismiss',
		)!;
		act(() => {
			dismiss.click();
		});
		await until(() => dialogTitle() === undefined);

		drop([
			new File(['x'], 'a.glproj'),
			new File(['y'], 'b.png', {type: 'image/png'}),
		]);
		await until(() => dialogTitle() === "Can't open 2 files");
	});

	it.each([
		{order: ['project', 'image'], active: 'drive'},
		{order: ['image', 'project'], active: 'photo'},
	])('opens the first chosen of $order', async ({order, active}) => {
		const files = {
			project: await projectFile(),
			image: new File([new Uint8Array([1, 2, 3])], 'photo.png', {
				type: 'image/png',
			}),
		};
		const test = setup();
		mount(test, <WindowFileDrop probe={probe} />);

		drop(order.map((kind) => files[kind as keyof typeof files]));
		await until(
			() =>
				test.store.getState().projects.length === 2 &&
				test.store.getState().activeProject?.name === active,
		);
	});

	it('keeps the error of a refused file after the trigger leaves the screen', async () => {
		const good = await projectFile();
		const test = setup();
		mount(
			test,
			<ImportFlowProvider>
				<EmptyOnlyTrigger />
			</ImportFlowProvider>,
		);

		choose([good, new File(['x'], 'broken.glproj')]);
		await until(() => text().includes("Can't open broken.glproj"));

		expect(document.querySelector('input[type="file"]')).toBeNull();
		expect(test.store.getState().activeProject?.name).toBe('drive');
	});

	it('reports unsupported effects through the store notice', async () => {
		const source = setup();
		const {project} = await source.store.getState().importImage({
			name: 'drive',
			blob: makeTestBlob(),
			...SOURCE_SIZE,
		});
		await source.repository.saveProjectStack(project.id, {
			schemaVersion: 1,
			instances: [
				{
					id: 'abcd1234',
					type: 'fromTheFuture',
					version: 1,
					enabled: true,
					params: {},
					mix: 1,
					blend: 'normal',
				},
			],
		});
		const {blob} = await source.repository.exportProjectFile(project.id);
		const test = setup();
		mount(test, <WindowFileDrop />);

		drop([new File([blob], 'drive.glproj')]);
		await until(
			() =>
				test.store.getState().notice === unsupportedEffectsNotice('drive', 1),
		);
	});
});
