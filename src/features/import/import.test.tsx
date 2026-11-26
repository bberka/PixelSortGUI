// @vitest-environment happy-dom
import {act, type ReactElement} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {toast} from 'sonner';
import {
	BLUE,
	bmpBytes,
	gifBytes,
	RED,
	stillAvifBytes,
} from '../../../tests/fixtures/formats.ts';
import {createTestStore} from '../../../tests/state/fixtures.ts';
import {ImportImagesAction} from './import-images-action.tsx';
import {ImportImagesButton} from './import-images-button.tsx';
import {WindowFileDrop} from './window-file-drop.tsx';
import type {ImportDownscale, ImportProbe} from './use-image-import.ts';
import {App} from '@/app/app.tsx';
import {AppRuntimeProvider} from '@/app/runtime-context.tsx';
import * as decode from '@/codec/decode.ts';
import type {CodecError, CodecResult, ImageDimensions} from '@/codec/decode.ts';
import type {AppRuntime} from '@/state/index.ts';
import {MemoryStorageAdapter} from '@/storage/memory-adapter.ts';
import type {RestoreResult} from '@/storage/restore.ts';
import {StorageQuotaError, type CreateProjectResult} from '@/storage/types.ts';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const decodeFailure: CodecError = {
	code: 'decode-failed',
	message: 'The browser could not decode this image file.',
};

function okProbe(width: number, height: number): ImportProbe {
	return async () => ({
		ok: true,
		value: {width, height, exceedsGuaranteedArea: width * height > 50_000_000},
	});
}

function failingProbe(error: CodecError = decodeFailure): ImportProbe {
	return async () => ({ok: false, error});
}

function fakeDownscale(width: number, height: number) {
	return vi.fn<ImportDownscale>(async () => ({
		ok: true,
		value: {
			blob: new Blob(['downscaled'], {type: 'image/jpeg'}),
			width,
			height,
		},
	}));
}

function imageFile(name: string, type = 'image/png'): File {
	return new File([new Uint8Array([1, 2, 3, 4])], name, {type});
}

class FullStorageRepository extends MemoryStorageAdapter {
	override async createProject(): Promise<CreateProjectResult> {
		throw new StorageQuotaError('Storage is full');
	}
}

type HarnessOptions = {
	readonly repository?: MemoryStorageAdapter;
	readonly probe?: ImportProbe;
	readonly downscale?: ImportDownscale;
	readonly button?: boolean;
	readonly drop?: boolean;
};

function setup(options: HarnessOptions = {}) {
	const test = createTestStore({repository: options.repository});
	test.store.getState().hydrateFromRestore({
		projects: [],
		presets: [],
		theme: 'system',
		compareMode: 'toggle',
		storageUnavailable: false,
		route: {screen: 'library'},
		notice: null,
		activeProject: null,
	});
	const result: RestoreResult = {
		status: 'ready',
		bundle: test.bundle,
		storageUnavailable: false,
		route: {screen: 'library'},
		notice: null,
		hydrationPromise: Promise.resolve(),
		housekeepingPromise: Promise.resolve(),
	};
	const runtime: AppRuntime = {
		ready: Promise.resolve(result),
		result: null,
		dispose() {},
	};
	const flowProps = {
		probe: options.probe ?? okProbe(100, 50),
		downscale: options.downscale,
	};

	return {
		...test,
		mount(): HTMLDivElement {
			const element: ReactElement = (
				<AppRuntimeProvider value={{runtime, bundle: test.bundle}}>
					{options.drop ? (
						<WindowFileDrop {...flowProps} />
					) : options.button ? (
						<ImportImagesButton {...flowProps} />
					) : (
						<ImportImagesAction {...flowProps} />
					)}
				</AppRuntimeProvider>
			);
			container = document.createElement('div');
			document.body.append(container);
			root = createRoot(container);
			act(() => {
				root!.render(element);
			});
			return container;
		},
	};
}

let container: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;

async function settle(turns = 8): Promise<void> {
	for (let index = 0; index < turns; index++) {
		await act(async () => {
			await Promise.resolve();
		});
	}
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (predicate()) {
			return;
		}

		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 5);
			});
		});
	}

	throw new Error(`Timed out waiting for ${label}`);
}

function fileInput(): HTMLInputElement {
	const input = document.querySelector<HTMLInputElement>('input[type="file"]');
	if (!input) {
		throw new Error('The import flow renders no file input');
	}

	return input;
}

function chooseFiles(files: readonly File[]): void {
	const input = fileInput();
	const list: FileList = Object.assign(new FileList(), files);
	input.files = list;
	act(() => {
		input.dispatchEvent(new Event('change', {bubbles: true}));
	});
}

function dispatchFileDrag(type: string, files: readonly File[]): void {
	const event = new Event(type);
	Object.defineProperty(event, 'dataTransfer', {
		value: {types: ['Files'], files: [...files], dropEffect: 'none'},
	});
	act(() => {
		globalThis.dispatchEvent(event);
	});
}

function bodyText(): string {
	return document.body.textContent ?? '';
}

function buttonByText(text: string): HTMLElement {
	const match = [...document.querySelectorAll('button')].find(
		(button) => button.textContent === text,
	);
	if (!match) {
		throw new Error(`No button labelled "${text}"`);
	}

	return match;
}

afterEach(() => {
	if (root) {
		act(() => {
			root!.unmount();
		});
		root = undefined;
	}

	container?.remove();
	container = undefined;
	document.body.replaceChildren();
});

describe('validation before anything is stored', () => {
	it('refuses a file the browser cannot decode with the exact message and stores nothing', async () => {
		const harness = setup({probe: failingProbe()});
		harness.mount();

		chooseFiles([imageFile('holiday.png')]);
		await waitFor(
			() =>
				bodyText().includes(
					"Can't open holiday.png: the browser can't read this image format.",
				),
			'the unreadable-file dialog',
		);

		expect(harness.store.getState().projects).toHaveLength(0);
	});

	it('refuses a file over the 200 MB limit before it is read', async () => {
		const probe = vi.fn(okProbe(100, 50));
		const harness = setup({probe});
		harness.mount();

		const file = imageFile('huge.jpg', 'image/jpeg');
		Object.defineProperty(file, 'size', {value: 209_715_201});
		chooseFiles([file]);
		await waitFor(
			() =>
				bodyText().includes(
					'File too large: 209,715,201 bytes exceeds the 200 MB limit.',
				),
			'the file-size dialog',
		);

		expect(probe).not.toHaveBeenCalled();
		expect(harness.store.getState().projects).toHaveLength(0);
	});

	it('refuses an image whose longest side is over 16,384 px with the exact message', async () => {
		const harness = setup({probe: okProbe(20_000, 1000)});
		harness.mount();

		chooseFiles([imageFile('pano.png')]);
		await waitFor(
			() =>
				bodyText().includes(
					'Image too large: the longest side is 20,000 px; the limit is 16,384 px.',
				),
			'the dimension dialog',
		);

		expect(harness.store.getState().projects).toHaveLength(0);
	});

	it('still imports the readable files in the same pick', async () => {
		const harness = setup({
			probe: async (blob) =>
				blob.size === 4 && (blob as File).name === 'broken.jpg'
					? {ok: false, error: decodeFailure}
					: {
							ok: true,
							value: {width: 100, height: 50, exceedsGuaranteedArea: false},
						},
		});
		harness.mount();

		chooseFiles([imageFile('broken.jpg', 'image/jpeg'), imageFile('good.png')]);
		await waitFor(
			() =>
				bodyText().includes(
					"Can't open broken.jpg: the browser can't read this image format.",
				) && harness.store.getState().projects.length === 1,
			'the mixed pick',
		);

		expect(harness.store.getState().projects[0].name).toBe('good');
	});
});

describe('images over 50 MP', () => {
	const largeProbe = okProbe(8000, 8000);

	it('asks first, then stores the downscaled copy on Import at 50 MP', async () => {
		const downscale = fakeDownscale(7068, 7068);
		const harness = setup({probe: largeProbe, downscale});
		harness.mount();

		chooseFiles([imageFile('mural.png')]);
		await waitFor(
			() => bodyText().includes('mural.png is 8000 × 8000 px'),
			'the 50 MP dialog',
		);

		expect(bodyText()).toContain('mural.png is 8000 × 8000 px');
		expect(bodyText()).not.toContain('Checking mural.png');
		expect(
			[...document.querySelectorAll('button')].map((b) => b.textContent),
		).toEqual(
			expect.arrayContaining(['Import at 50 MP', 'Import anyway', 'Cancel']),
		);
		expect(harness.store.getState().projects).toHaveLength(0);

		act(() => {
			buttonByText('Import at 50 MP').click();
		});
		await waitFor(
			() => harness.store.getState().projects.length === 1,
			'the downscaled import',
		);

		expect(downscale).toHaveBeenCalledTimes(1);
		const active = harness.store.getState().activeSource;
		expect(active?.width).toBe(7068);
		expect(active?.height).toBe(7068);
		expect(active?.mimeType).toBe('image/jpeg');
		const project = harness.store.getState().activeProject;
		expect(project?.sourceWidth).toBe(7068);
		expect(project?.sourceHeight).toBe(7068);
	});

	it('stores the original dimensions on Import anyway', async () => {
		const downscale = fakeDownscale(7068, 7068);
		const harness = setup({probe: largeProbe, downscale});
		harness.mount();

		chooseFiles([imageFile('mural.png')]);
		await waitFor(
			() => bodyText().includes('mural.png is 8000 × 8000 px'),
			'the 50 MP dialog',
		);
		act(() => {
			buttonByText('Import anyway').click();
		});
		await waitFor(
			() => harness.store.getState().projects.length === 1,
			'the full-size import',
		);

		expect(downscale).not.toHaveBeenCalled();
		expect(harness.store.getState().activeSource?.width).toBe(8000);
		expect(harness.store.getState().projects).toHaveLength(1);
	});

	it('stores nothing on Cancel', async () => {
		const harness = setup({probe: largeProbe});
		harness.mount();

		chooseFiles([imageFile('mural.png')]);
		await waitFor(
			() => bodyText().includes('mural.png is 8000 × 8000 px'),
			'the 50 MP dialog',
		);
		act(() => {
			buttonByText('Cancel').click();
		});
		await settle(8);

		expect(harness.store.getState().projects).toHaveLength(0);
		expect(bodyText()).not.toContain('Import at 50 MP');
	});
});

describe('format detection', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it.each([
		[
			'IMG_1.heic',
			"Can't open IMG_1.heic: HEIC/HEIF is not supported in this browser. Convert it to JPEG, PNG, or WebP first.",
		],
		[
			'IMG_2.dng',
			"Can't open IMG_2.dng: RAW camera files are not supported. Export a TIFF, PNG, or JPEG from your RAW converter first.",
		],
		[
			'IMG_3.cr2',
			"Can't open IMG_3.cr2: RAW camera files are not supported. Export a TIFF, PNG, or JPEG from your RAW converter first.",
		],
	])(
		'refuses %s with its own message before decoding',
		async (name, message) => {
			const probe = vi.fn(okProbe(100, 50));
			const harness = setup({probe, drop: true});
			harness.mount();

			dispatchFileDrag('drop', [imageFile(name, '')]);
			await waitFor(() => bodyText().includes(message), 'the refusal dialog');

			expect(probe).not.toHaveBeenCalled();
			expect(harness.store.getState().projects).toHaveLength(0);
		},
	);

	it('shows the first-frame notice once, only for the animated file', async () => {
		const info = vi.fn();
		vi.spyOn(toast, 'message').mockImplementation(info);
		const harness = setup();
		harness.mount();

		chooseFiles([
			new File([gifBytes([RED, BLUE])], 'loop.gif', {type: 'image/gif'}),
			new File([gifBytes([RED])], 'still.gif', {type: 'image/gif'}),
			new File([bmpBytes(RED)], 'scan.bmp', {type: 'image/bmp'}),
			new File([stillAvifBytes()], 'shot.avif', {type: 'image/avif'}),
		]);
		await waitFor(
			() => harness.store.getState().projects.length === 4,
			'four stored projects',
		);

		expect(info).toHaveBeenCalledTimes(1);
		expect(info).toHaveBeenCalledWith(
			'Imported the first frame of loop.gif. Animation is not supported yet.',
		);
	});

	it('shows no notice when the animated file could not be saved', async () => {
		const info = vi.fn();
		vi.spyOn(toast, 'message').mockImplementation(info);
		const harness = setup({repository: new FullStorageRepository()});
		harness.mount();

		chooseFiles([
			new File([gifBytes([RED, BLUE])], 'loop.gif', {type: 'image/gif'}),
		]);
		await waitFor(
			() => harness.store.getState().storage.quotaFull,
			'the full-storage state',
		);

		expect(info).not.toHaveBeenCalled();
	});
});

describe('several files', () => {
	it('stores every accepted file and opens the first one', async () => {
		const harness = setup();
		harness.mount();

		chooseFiles([
			imageFile('first.png'),
			imageFile('second.png'),
			imageFile('third.png'),
		]);
		await waitFor(
			() => harness.store.getState().projects.length === 3,
			'three stored projects',
		);

		const state = harness.store.getState();
		expect(state.projects.map((project) => project.name).toSorted()).toEqual([
			'first',
			'second',
			'third',
		]);
		expect(state.activeProject?.name).toBe('first');
		expect(state.route).toEqual({
			screen: 'editor',
			projectId: state.projects.find((p) => p.name === 'first')?.id,
		});
	});

	it('shows progress while a file is being checked', async () => {
		const {promise: release, resolve} =
			Promise.withResolvers<CodecResult<ImageDimensions>>();
		const probe: ImportProbe = async () => release;
		const harness = setup({probe});
		harness.mount();

		chooseFiles([imageFile('slow.png')]);
		await settle(2);

		expect(bodyText()).toContain('Checking slow.png (1 of 1)');
		expect(
			document
				.querySelector('[role="progressbar"]')
				?.getAttribute('aria-label'),
		).toBe('Import progress');

		await act(async () => {
			resolve({
				ok: true,
				value: {width: 100, height: 50, exceedsGuaranteedArea: false},
			});
		});
		await waitFor(
			() => harness.store.getState().projects.length === 1,
			'the stored project',
		);

		expect(bodyText()).not.toContain('Checking slow.png');
		expect(harness.store.getState().projects).toHaveLength(1);
	});

	it('ignores a second import attempt while an import is already in progress', async () => {
		const first = Promise.withResolvers<CodecResult<ImageDimensions>>();
		const probe = vi.fn<ImportProbe>(async (blob) => {
			if ((blob as File).name === 'first.png') {
				return first.promise;
			}

			return {
				ok: true,
				value: {width: 100, height: 50, exceedsGuaranteedArea: false},
			};
		});
		const harness = setup({probe});
		harness.mount();

		chooseFiles([imageFile('first.png')]);
		await settle(2);

		// Trigger a second import while the first is still probing.
		chooseFiles([imageFile('second.png')]);
		await settle(2);

		expect(probe).toHaveBeenCalledTimes(1);

		await act(async () => {
			first.resolve({
				ok: true,
				value: {width: 100, height: 50, exceedsGuaranteedArea: false},
			});
		});
		await waitFor(
			() => harness.store.getState().projects.length === 1,
			'the first project',
		);

		expect(harness.store.getState().projects.map((p) => p.name)).toEqual([
			'first',
		]);

		// Once finished, a subsequent import is accepted again.
		chooseFiles([imageFile('after.png')]);
		await waitFor(
			() => harness.store.getState().projects.length === 2,
			'the follow-up project',
		);
		expect(probe).toHaveBeenCalledTimes(2);
	});
});

describe('drag and drop onto the window', () => {
	it('shows the overlay while files are dragged and hides it again', async () => {
		const harness = setup({drop: true});
		harness.mount();

		expect(bodyText()).not.toContain('Drop images to open');
		dispatchFileDrag('dragenter', [imageFile('dropped.png')]);
		expect(bodyText()).toContain('Drop images to open');

		dispatchFileDrag('dragleave', [imageFile('dropped.png')]);
		expect(bodyText()).not.toContain('Drop images to open');
	});

	it('imports the dropped files', async () => {
		const harness = setup({drop: true});
		harness.mount();

		dispatchFileDrag('drop', [imageFile('dropped.png')]);
		await waitFor(
			() => harness.store.getState().projects.length === 1,
			'the dropped project',
		);

		expect(bodyText()).not.toContain('Drop images to open');
		expect(harness.store.getState().projects[0]?.name).toBe('dropped');
	});

	it('imports and opens a dropped file while the editor screen is active', async () => {
		const probeSpy = vi
			.spyOn(decode, 'probeImageDimensions')
			.mockImplementation(okProbe(120, 80));
		const repository = new MemoryStorageAdapter();
		const created = await repository.createProject({
			name: 'existing',
			blob: new Blob([new Uint8Array([9, 8, 7])], {type: 'image/png'}),
			width: 100,
			height: 100,
		});
		const test = createTestStore({repository});
		test.store.getState().hydrateFromRestore({
			projects: [created.project],
			presets: [],
			theme: 'system',
			compareMode: 'toggle',
			storageUnavailable: false,
			route: {screen: 'editor', projectId: created.project.id},
			notice: null,
			activeProject: created.project,
		});
		const result: RestoreResult = {
			status: 'ready',
			bundle: test.bundle,
			storageUnavailable: false,
			route: {screen: 'editor', projectId: created.project.id},
			notice: null,
			hydrationPromise: Promise.resolve(),
			housekeepingPromise: Promise.resolve(),
		};
		const runtime: AppRuntime = {
			ready: Promise.resolve(result),
			result: null,
			dispose() {},
		};

		container = document.createElement('div');
		document.body.append(container);
		root = createRoot(container);
		act(() => {
			root!.render(<App runtime={runtime} />);
		});
		await settle(8);

		dispatchFileDrag('dragenter', [imageFile('from-editor.png')]);
		expect(bodyText()).toContain('Drop images to open');

		dispatchFileDrag('drop', [imageFile('from-editor.png')]);
		await waitFor(
			() => test.store.getState().projects.length === 2,
			'the dropped project from editor',
		);

		expect(test.store.getState().activeProject?.name).toBe('from-editor');
		expect(test.store.getState().route).toEqual({
			screen: 'editor',
			projectId: test.store.getState().activeProject?.id,
		});
		probeSpy.mockRestore();
	});
});

describe('storage', () => {
	it('leaves the storage-full case to the shell dialog and creates no project', async () => {
		const harness = setup({repository: new FullStorageRepository()});
		harness.mount();

		chooseFiles([imageFile('keeper.png')]);
		await waitFor(
			() => harness.store.getState().storage.quotaFull,
			'the quota flag',
		);

		expect(harness.store.getState().storage.quotaFull).toBe(true);
		expect(harness.store.getState().projects).toHaveLength(0);
		expect(bodyText()).not.toContain("Can't open keeper.png");
	});

	it('renders the import trigger the library empty state uses', () => {
		const harness = setup({button: true});
		const screen = harness.mount();

		const trigger = [...screen.querySelectorAll('button')].find(
			(button) => button.textContent === 'Open images',
		);
		expect(trigger).toBeDefined();
		expect(fileInput().accept).toBe('image/*,.avif,.bmp,.gif,.svg');
		expect(fileInput().multiple).toBe(true);
	});
});
