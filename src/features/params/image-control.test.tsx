// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {createTestStore, makeTestBlob} from '../../../tests/state/fixtures.ts';
import {ImagePickProvider} from './image-pick.tsx';
import {ParameterPanel} from './params-panel.tsx';
import type * as Decode from '@/codec/decode.ts';
import {LiveRegion} from '@/app/live-region.tsx';
import {AppRuntimeProvider} from '@/app/runtime-context.tsx';
import {TooltipProvider} from '@/components/ui/tooltip';
import type {ImportProbe} from '@/features/import/read-image-file.ts';
import type {SourceRecord} from '@/storage/types.ts';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

// Happy-dom decodes nothing: bytes starting with `broken` stand for a file the
// browser cannot read.
vi.mock('@/codec/decode.ts', async (importOriginal) => ({
	...(await importOriginal<typeof Decode>()),
	async decodeImage(blob: Blob) {
		return (await blob.text()).startsWith('broken')
			? {ok: false, error: {code: 'decode-failed', message: 'No'}}
			: {
					ok: true,
					value: {width: 2, height: 2, data: new Uint8ClampedArray(16)},
				};
	},
}));

const probe: ImportProbe = async () => ({
	ok: true,
	value: {width: 32, height: 24, exceedsGuaranteedArea: false},
});

let root: ReturnType<typeof createRoot> | undefined;

afterEach(() => {
	act(() => {
		root?.unmount();
	});
	root = undefined;
	document.body.replaceChildren();
});

// Lets storage, hashing and React finish.
async function settle(): Promise<void> {
	for (let turn = 0; turn < 5; turn++) {
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 0);
			});
		});
	}
}

// A project with a selected Image blend, and two more projects to take from.
async function setup() {
	const context = createTestStore();
	const {store, repository} = context;
	const add = async (name: string, width: number, height: number) =>
		store.getState().importImage({
			name: `${name}.png`,
			blob: makeTestBlob(name),
			width,
			height,
		});
	const red = await add('red', 640, 480);
	await add('blue', 300, 900);
	const base = await add('base', 40, 30);
	const instance = await store.getState().addEffect('imageBlend');

	const container = document.createElement('div');
	document.body.append(container);
	root = createRoot(container);
	act(() => {
		root!.render(
			<AppRuntimeProvider
				value={{
					runtime: {
						ready: Promise.resolve({status: 'insecure-context'}),
						result: null,
						dispose() {},
					},
					bundle: context.bundle,
				}}
			>
				<TooltipProvider>
					<ImagePickProvider probe={probe}>
						<ParameterPanel random={() => 0.7} />
					</ImagePickProvider>
					<LiveRegion />
				</TooltipProvider>
			</AppRuntimeProvider>,
		);
	});
	await settle();

	const project = () => store.getState().activeProject!;
	return {
		...context,
		red: red.source.sha256,
		projectId: base.project.id,
		instanceId: instance.id,
		repository,
		image: () => project().stack.instances[0].params.image,
		head: () => project().historyHeadSeq,
		async choose(image: string) {
			await act(async () => {
				await store
					.getState()
					.commitImageParam(base.project.id, instance.id, 'image', {
						sha256: image,
					});
			});
			await settle();
		},
	};
}

function button(name: string): HTMLButtonElement | undefined {
	return [...document.querySelectorAll('button')].find(
		(item) =>
			item.getAttribute('aria-label') === name ||
			item.textContent?.trim() === name,
	);
}

async function press(name: string): Promise<void> {
	const found = button(name);
	expect(found, name).toBeDefined();
	act(() => {
		found!.click();
	});
	await settle();
}

const text = () => document.body.textContent ?? '';

function fileInput(): HTMLInputElement {
	return document.querySelector<HTMLInputElement>(
		'[data-slot="image-param-input"]',
	)!;
}

async function pickFile(file: File): Promise<void> {
	const input = fileInput();
	Object.defineProperty(input, 'files', {value: [file], configurable: true});
	act(() => {
		input.dispatchEvent(new Event('change', {bubbles: true}));
	});
	await settle();
}

describe('ImageControl', () => {
	it('starts empty, with no Clear button and no warning', async () => {
		await setup();

		expect(text()).toContain('No image selected');
		expect(button('Choose image')).toBeDefined();
		expect(button('Clear image')).toBeUndefined();
		expect(text()).not.toContain('Missing image');
	});

	it('shows the size of the chosen image', async () => {
		const {choose, red} = await setup();

		await choose(red);

		expect(text()).toContain('640 × 480 px');
		expect(text()).not.toContain('No image selected');
		expect(text()).not.toContain('Missing image');
	});

	it('says nothing about a missing image while storage is still reading', async () => {
		const read = Promise.withResolvers<SourceRecord | undefined>();
		const {choose, red, repository} = await setup();
		vi.spyOn(repository, 'getSource').mockImplementationOnce(
			async () => read.promise,
		);

		await choose(red);
		expect(text()).not.toContain('Missing image');

		await act(async () => {
			read.resolve(undefined);
		});
		await settle();
		expect(text()).toContain('Missing image');
	});

	it('warns about a stored image that cannot be decoded', async () => {
		const {choose, repository} = await setup();
		const {source} = await repository.createProject({
			name: 'broken.png',
			blob: new Blob(['broken'], {type: 'image/png'}),
			width: 8,
			height: 8,
			setActive: false,
		});

		await choose(source.sha256);

		expect(text()).toContain('Missing image');
	});

	it('clears the image as one step and moves focus to Choose image', async () => {
		const {choose, red, image, head} = await setup();
		await choose(red);
		const before = head();

		await press('Clear image');

		expect(image()).toBe('');
		expect(head()).toBe(before + 1);
		expect(document.activeElement).toBe(button('Choose image'));
		expect(text()).toContain('No image selected');
	});

	it('offers the other projects and uses the one picked', async () => {
		const {image, red, repository} = await setup();
		const sizes = await repository.getSourceSizes();
		await press('Choose image');
		await press('From library');

		const tiles = [
			...document.querySelectorAll('[aria-label="Library images"] button'),
		].map((tile) => tile.textContent);
		expect(tiles.toSorted((a, b) => a.localeCompare(b))).toEqual([
			'blue300 × 900 px',
			'red640 × 480 px',
		]);
		await press('red640 × 480 px');

		expect(image()).toBe(red);
		expect(await repository.getSourceSizes()).toStrictEqual(sizes);
	});

	it('shows the photo of a project that has no thumbnail yet', async () => {
		await setup();
		await press('Choose image');
		await press('From library');

		expect(
			document.querySelectorAll('[aria-label="Library images"] canvas'),
		).toHaveLength(2);
	});

	it('stores a device file with its commit', async () => {
		const {image, repository} = await setup();

		await pickFile(
			new File([await makeTestBlob('green').arrayBuffer()], 'green.png', {
				type: 'image/png',
			}),
		);
		// Nothing asked for a file yet, so the change is ignored.
		expect(image()).toBe('');
		await press('Choose image');
		await press('From device');
		await pickFile(
			new File([await makeTestBlob('green').arrayBuffer()], 'green.png', {
				type: 'image/png',
			}),
		);

		expect(await repository.getSource(image() as string)).toMatchObject({
			width: 32,
			height: 24,
		});
		expect(text()).toContain('32 × 24 px');
	});

	it('refuses a HEIC file with the import message and changes nothing', async () => {
		const {head, repository} = await setup();
		const sizes = await repository.getSourceSizes();
		const before = head();

		await press('Choose image');
		await press('From device');
		await pickFile(new File(['x'], 'photo.heic', {type: 'image/heic'}));

		expect(text()).toContain(
			"Can't open photo.heic: HEIC/HEIF is not supported in this browser.",
		);
		expect(head()).toBe(before);
		expect(await repository.getSourceSizes()).toStrictEqual(sizes);
	});

	it('shows why a library image that is gone was refused', async () => {
		const {head, repository} = await setup();
		const before = head();
		await press('Choose image');
		await press('From library');
		const gone = (await repository.listProjects()).find(
			(project) => project.name === 'red',
		)!;
		await repository.deleteProject(gone.id);

		await press('red640 × 480 px');

		expect(document.querySelector('[role="alert"]')?.textContent).toBe(
			'That image is no longer stored on this device.',
		);
		expect(head()).toBe(before);
	});

	it('keeps the image when the effect is randomized', async () => {
		const {choose, red, image, store} = await setup();
		await choose(red);
		const opacity = () =>
			store.getState().activeProject!.stack.instances[0].params.opacity;
		const before = opacity();

		await press('Randomize');

		expect(opacity()).not.toBe(before);
		expect(image()).toBe(red);
	});
});
