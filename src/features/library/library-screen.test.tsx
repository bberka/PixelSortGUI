// @vitest-environment happy-dom
import {act, type ReactElement} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vite-plus/test';
import {createTestStore, makeTestBlob} from '../../../tests/state/fixtures.ts';
import {App} from '@/app/app.tsx';
import {IDENTITY_TRANSFORM} from '@/engine/transform.ts';
import {LANDING} from '@/features/guide/content.ts';
import {MemoryStorageAdapter} from '@/storage/memory-adapter.ts';
import type {RestoreResult} from '@/storage/restore.ts';
import type {AppStore} from '@/state/app-store.ts';
import type {AppRuntime} from '@/state/index.ts';
import type {ProjectRecord} from '@/storage/types.ts';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

type IntersectingTarget = {
	readonly target: Element;
	readonly isIntersecting: boolean;
};

/**
 Stands in for the browser observer: nothing intersects until a test says so,
 which is how the lazy thumbnail rule (AC-F2.6) is exercised.
 */
class FakeIntersectionObserver {
	static instances: FakeIntersectionObserver[] = [];

	readonly #callback: (entries: IntersectionObserverEntry[]) => void;

	readonly observed = new Set<Element>();
	readonly options: IntersectionObserverInit | undefined;

	constructor(
		callback: (entries: IntersectionObserverEntry[], observer: unknown) => void,
		options?: IntersectionObserverInit,
	) {
		this.#callback = (entries) => {
			callback(entries, this);
		};

		this.options = options;
		FakeIntersectionObserver.instances.push(this);
	}

	observe(target: Element): void {
		this.observed.add(target);
	}

	unobserve(target: Element): void {
		this.observed.delete(target);
	}

	disconnect(): void {
		this.observed.clear();
	}

	emit(entries: IntersectingTarget[]): void {
		this.#callback(
			entries.map(
				({target, isIntersecting}) =>
					({
						target,
						isIntersecting,
						intersectionRatio: isIntersecting ? 1 : 0,
					}) as unknown as IntersectionObserverEntry,
			),
		);
	}

	emitAll(isIntersecting: boolean): void {
		this.emit([...this.observed].map((target) => ({target, isIntersecting})));
	}
}

function lastObserver(): FakeIntersectionObserver {
	const observer = FakeIntersectionObserver.instances.at(-1);
	if (!observer) {
		throw new Error('No IntersectionObserver was created');
	}

	return observer;
}

type Harness = {
	readonly runtime: AppRuntime;
	readonly store: AppStore;
	readonly repository: MemoryStorageAdapter;
	readonly container: HTMLDivElement;
	readonly projects: ProjectRecord[];
};

let mounted: {
	container: HTMLDivElement;
	root: ReturnType<typeof createRoot>;
} | null = null;

function mount(element: ReactElement): HTMLDivElement {
	const container = document.createElement('div');
	document.body.append(container);
	const root = createRoot(container);
	mounted = {container, root};
	act(() => {
		root.render(element);
	});
	return container;
}

async function flush(turns = 4): Promise<void> {
	for (let index = 0; index < turns; index++) {
		await act(async () => {
			await Promise.resolve();
		});
	}
}

type Clock = {time: number};

async function seed(
	repository: MemoryStorageAdapter,
	clock: Clock,
	names: readonly string[],
	withThumbnail = true,
): Promise<ProjectRecord[]> {
	const projects: ProjectRecord[] = [];
	for (const name of names) {
		const created = await repository.createProject({
			name,
			blob: makeTestBlob(`source-${name}`),
			width: 320,
			height: 240,
		});
		if (withThumbnail) {
			await repository.putThumbnail({
				projectId: created.project.id,
				blob: makeTestBlob(`thumb-${name}`),
				width: 320,
				height: 240,
				stackSignature: 'signature',
				updatedAt: clock.time,
			});
		}

		projects.push(created.project);
		clock.time += 60_000;
	}

	return projects;
}

async function renderLibrary(
	names: readonly string[],
	options: {readonly withThumbnail?: boolean} = {},
): Promise<Harness> {
	const clock: Clock = {time: Date.now()};
	const repository = new MemoryStorageAdapter({now: () => clock.time});
	const test = createTestStore({repository});
	const projects = await seed(
		repository,
		clock,
		names,
		options.withThumbnail ?? true,
	);
	test.store.getState().hydrateFromRestore({
		projects,
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

	const container = mount(<App runtime={runtime} />);
	await flush();
	await act(async () => {
		lastObserver().emitAll(true);
	});
	await flush();

	return {
		runtime,
		store: test.store,
		repository,
		container,
		projects,
	};
}

function cardElements(container: HTMLElement): HTMLLIElement[] {
	return [...container.querySelectorAll<HTMLLIElement>('li')];
}

function visibleThumbnails(container: HTMLElement): HTMLImageElement[] {
	return [...container.querySelectorAll<HTMLImageElement>('img[src^="blob:"]')];
}

beforeEach(() => {
	FakeIntersectionObserver.instances = [];
	vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
	vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});

afterEach(() => {
	if (mounted) {
		act(() => {
			mounted!.root.unmount();
		});
		mounted = null;
	}

	document.body.replaceChildren();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('empty library', () => {
	it('shows the DESIGN.md empty state with no cards', async () => {
		const harness = await renderLibrary([]);

		expect(harness.container.querySelector('h2')?.textContent).toBe(
			LANDING.pitch,
		);
		expect(harness.container.textContent).toContain('Drop photos here');
		expect(harness.container.textContent).toContain(
			'Images stay on this device.',
		);
		const openButtons = [
			...harness.container.querySelectorAll<HTMLButtonElement>('button'),
		].filter((button) => button.textContent === 'Open images');
		expect(openButtons).toHaveLength(1);
		expect(openButtons[0].disabled).toBe(false);
		expect(cardElements(harness.container)).toHaveLength(0);
	});

	it('shows the effect introduction until it is dismissed, then keeps the actions (AC-F27.7)', async () => {
		const harness = await renderLibrary([]);
		const names = () =>
			[
				...harness.container.querySelectorAll(
					':scope main button, :scope main a',
				),
			].map(
				(element) =>
					element.getAttribute('aria-label') ?? element.textContent ?? '',
			);
		expect(names()).toEqual(
			expect.arrayContaining(['Dismiss introduction', 'Try a sample']),
		);
		expect(harness.container.textContent).toContain('See what Drift does');

		await act(async () => {
			harness.container
				.querySelector<HTMLButtonElement>(
					'button[aria-label="Dismiss introduction"]',
				)!
				.click();
		});

		expect(harness.container.textContent).not.toContain('See what Drift does');
		expect(globalThis.document.activeElement?.textContent).toBe(LANDING.pitch);
		expect(names()).toEqual([
			'Open images',
			'Paste image',
			'Try a sample',
			'Read the guide',
		]);
		expect((await harness.repository.getAppState()).welcomeDismissed).toBe(
			true,
		);
	});

	it('keeps Import images, Guide and Settings in the app bar (AC-F2.9)', async () => {
		const harness = await renderLibrary([]);

		const labels = [
			...harness.container.querySelectorAll(':scope header button'),
		].map((button) => button.getAttribute('aria-label') ?? button.textContent);
		expect(labels).toEqual(
			expect.arrayContaining(['Import images', 'Guide', 'Settings']),
		);
	});

	it('triggers the hidden file picker when Open images is activated', async () => {
		const harness = await renderLibrary([]);
		const openButton = [
			...harness.container.querySelectorAll<HTMLButtonElement>('button'),
		].find((button) => button.textContent === 'Open images');
		expect(openButton).toBeDefined();

		const fileInputs = [
			...harness.container.querySelectorAll<HTMLInputElement>(
				':scope main input[type="file"]',
			),
		];
		expect(fileInputs).toHaveLength(1);
		const clickSpy = vi.spyOn(fileInputs[0], 'click');

		act(() => {
			openButton!.click();
		});

		expect(clickSpy).toHaveBeenCalledTimes(1);
	});
});

describe('project cards', () => {
	it('lists every project newest-opened first', async () => {
		const harness = await renderLibrary(['Alpha', 'Beta', 'Gamma']);

		expect(cardElements(harness.container)).toHaveLength(3);
		expect(
			[...harness.container.querySelectorAll('li')].map(
				(card) => card.querySelector('button')?.textContent,
			),
		).toEqual(['Gamma', 'Beta', 'Alpha']);
	});

	it('shows the name, the pixel dimensions and the opened date', async () => {
		const harness = await renderLibrary(['Sunset']);

		const card = cardElements(harness.container)[0];
		expect(card.textContent).toContain('Sunset');
		expect(card.textContent).toContain('320 × 240 px');
		expect(card.textContent).toContain('Today');
		expect(card.querySelector('time')?.getAttribute('datetime')).toContain('T');
	});

	it('shows the size after the geometry transform (AC-F20.1)', async () => {
		const harness = await renderLibrary(['turned']);
		const [{id, stack}] = harness.projects;
		const {project} = await harness.repository.commitStack({
			projectId: id,
			stack,
			selectedInstanceId: null,
			transform: {...IDENTITY_TRANSFORM, rotation: 90},
			label: 'Rotate 90° CW',
		});

		await act(async () => {
			harness.store.setState({projects: [project]});
		});

		expect(harness.container.textContent).toContain('240 × 320 px');
		expect(harness.container.textContent).not.toContain('320 × 240 px');
	});

	it('opens the project when the card body is activated', async () => {
		const harness = await renderLibrary(['Sunset', 'Street']);

		const open = [...harness.container.querySelectorAll('button')].find(
			(button) => button.getAttribute('aria-label') === 'Open Street',
		);
		act(() => {
			open!.click();
		});
		await flush(12);

		expect(harness.store.getState().route).toEqual({
			screen: 'editor',
			projectId: harness.projects[1].id,
		});
	});
});

describe('thumbnails', () => {
	it('decodes only the cards the observer reports on screen', async () => {
		const harness = await renderLibrary(['Alpha', 'Beta', 'Gamma']);
		const observer = lastObserver();
		const getThumbnail = vi.spyOn(harness.repository, 'getThumbnail');

		act(() => {
			observer.emitAll(false);
		});
		await flush();
		expect(getThumbnail).not.toHaveBeenCalled();
		expect(visibleThumbnails(harness.container)).toHaveLength(0);

		act(() => {
			observer.emit([
				{target: cardElements(harness.container)[0], isIntersecting: true},
			]);
		});
		await flush();

		expect(getThumbnail).toHaveBeenCalledTimes(1);
		expect(getThumbnail).toHaveBeenCalledWith(harness.projects[2].id);
		expect(visibleThumbnails(harness.container)).toHaveLength(1);
	});

	it('revokes a thumbnail object URL when the card leaves the viewport', async () => {
		const createObjectURL = vi.spyOn(URL, 'createObjectURL');
		const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL');
		const harness = await renderLibrary(['Alpha']);

		expect(createObjectURL).toHaveBeenCalledTimes(1);
		expect(visibleThumbnails(harness.container)).toHaveLength(1);

		act(() => {
			lastObserver().emit([
				{target: cardElements(harness.container)[0], isIntersecting: false},
			]);
		});
		await flush();

		expect(revokeObjectURL).toHaveBeenCalledTimes(1);
		expect(visibleThumbnails(harness.container)).toHaveLength(0);
	});

	it('loads a thumbnail written after the card first rendered without reloading', async () => {
		const harness = await renderLibrary(['Alpha'], {withThumbnail: false});
		const project = harness.projects[0];

		expect(visibleThumbnails(harness.container)).toHaveLength(0);

		await harness.repository.putThumbnail({
			projectId: project.id,
			blob: makeTestBlob('late-thumb'),
			width: 320,
			height: 240,
			stackSignature: 'late-signature',
			updatedAt: Date.now(),
		});
		act(() => {
			harness.store.getState().notifyThumbnailUpdated(project.id);
		});
		await flush();

		expect(visibleThumbnails(harness.container)).toHaveLength(1);
	});
});

async function openCardMenu(
	container: HTMLElement,
	name: string,
): Promise<HTMLElement[]> {
	const trigger = container.querySelector<HTMLButtonElement>(
		`button[aria-label="Actions for ${CSS.escape(name)}"]`,
	);
	if (!trigger) {
		throw new Error(`No menu trigger for ${name}`);
	}

	await act(async () => {
		trigger.dispatchEvent(
			new PointerEvent('pointerdown', {
				bubbles: true,
				button: 0,
				ctrlKey: false,
				pointerType: 'mouse',
			}),
		);
	});
	await flush();

	return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

function menuItem(items: readonly HTMLElement[], label: string): HTMLElement {
	const item = items.find((entry) => entry.textContent === label);
	if (!item) {
		throw new Error(`No menu item labelled ${label}`);
	}

	return item;
}

async function chooseMenuItem(
	container: HTMLElement,
	name: string,
	label: string,
): Promise<void> {
	const items = await openCardMenu(container, name);
	await act(async () => {
		menuItem(items, label).click();
	});
	await flush();
}

function setInputValue(input: HTMLInputElement, value: string): void {
	const setter = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		'value',
	)?.set;
	setter?.call(input, value);
	input.dispatchEvent(new Event('input', {bubbles: true}));
}

function statusText(): string {
	const region = document.querySelector(
		'[role="status"][aria-label="Status messages"]',
	);
	return region?.textContent ?? '';
}

function dialog(): HTMLElement | null {
	return document.querySelector<HTMLElement>(
		'[role="dialog"], [role="alertdialog"]',
	);
}

async function settleTimer(): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => {
			globalThis.setTimeout(resolve, 0);
		});
	});
}

describe('card menu', () => {
	it('offers Open, Rename, Duplicate, Save project file and Delete', async () => {
		const harness = await renderLibrary(['Alpha']);

		const items = await openCardMenu(harness.container, 'Alpha');

		expect(items.map((item) => item.textContent)).toEqual([
			'Open',
			'Rename',
			'Duplicate',
			'Save project file',
			'Delete',
		]);
	});

	it('renames a project, trims the name and announces it', async () => {
		const harness = await renderLibrary(['Alpha']);

		await chooseMenuItem(harness.container, 'Alpha', 'Rename');
		const renameDialog = dialog();
		expect(renameDialog).not.toBeNull();
		const input = renameDialog!.querySelector('input');
		expect(input?.value).toBe('Alpha');

		await act(async () => {
			setInputValue(input!, '   Sunset  ');
		});
		await act(async () => {
			renameDialog!
				.querySelector<HTMLButtonElement>('button[type="submit"]')!
				.click();
		});
		await flush(12);

		expect(
			harness.store.getState().projects.map((project) => project.name),
		).toEqual(['Sunset']);
		expect(harness.container.textContent).toContain('Sunset');
		expect(dialog()).toBeNull();
		expect(statusText()).toBe('Renamed to Sunset');
	});

	it('keeps the rename dialog open and explains an empty name', async () => {
		const harness = await renderLibrary(['Alpha']);

		await chooseMenuItem(harness.container, 'Alpha', 'Rename');
		const renameDialog = dialog();
		const input = renameDialog!.querySelector('input')!;
		await act(async () => {
			setInputValue(input, ' '.repeat(3));
		});
		await act(async () => {
			renameDialog!
				.querySelector<HTMLButtonElement>('button[type="submit"]')!
				.click();
		});
		await flush();

		expect(dialog()).not.toBeNull();
		expect(renameDialog!.querySelector('[role="alert"]')?.textContent).toBe(
			'Enter a name between 1 and 120 characters.',
		);
		expect(
			harness.store.getState().projects.map((project) => project.name),
		).toEqual(['Alpha']);
	});

	it('duplicates a project as "<name> copy" and announces it', async () => {
		const harness = await renderLibrary(['Alpha']);

		await chooseMenuItem(harness.container, 'Alpha', 'Duplicate');
		await flush(12);

		expect(
			harness.store
				.getState()
				.projects.map((project) => project.name)
				.toSorted(),
		).toEqual(['Alpha', 'Alpha copy']);
		expect(harness.container.textContent).toContain('Alpha copy');
		expect(statusText()).toBe('Duplicated Alpha copy');
	});

	it('asks for confirmation before deleting and keeps the project on Cancel', async () => {
		const harness = await renderLibrary(['Alpha']);

		await chooseMenuItem(harness.container, 'Alpha', 'Delete');
		const confirmDialog = dialog();
		expect(confirmDialog?.textContent).toContain(
			'Delete Alpha? This removes it from this device.',
		);

		await act(async () => {
			[...confirmDialog!.querySelectorAll<HTMLButtonElement>('button')]
				.find((button) => button.textContent === 'Cancel')!
				.click();
		});
		await flush();
		await settleTimer();

		expect(harness.store.getState().projects).toHaveLength(1);
		expect(harness.container.textContent).toContain('Alpha');
	});

	it('deletes the project, announces it and moves focus to the next card', async () => {
		const harness = await renderLibrary(['Alpha', 'Beta']);

		await chooseMenuItem(harness.container, 'Beta', 'Delete');
		await act(async () => {
			[...dialog()!.querySelectorAll<HTMLButtonElement>('button')]
				.find((button) => button.textContent === 'Delete')!
				.click();
		});
		await flush(12);
		await settleTimer();

		expect(
			harness.store.getState().projects.map((project) => project.name),
		).toEqual(['Alpha']);
		expect(statusText()).toBe('Deleted Beta');
		expect(globalThis.document.activeElement?.getAttribute('aria-label')).toBe(
			'Open Alpha',
		);
	});

	it('moves focus to the empty-state heading when the last project goes', async () => {
		const harness = await renderLibrary(['Alpha']);

		await chooseMenuItem(harness.container, 'Alpha', 'Delete');
		await act(async () => {
			[...dialog()!.querySelectorAll<HTMLButtonElement>('button')]
				.find((button) => button.textContent === 'Delete')!
				.click();
		});
		await flush(12);
		await settleTimer();

		expect(harness.container.textContent).toContain(LANDING.pitch);
		expect(globalThis.document.activeElement?.tagName).toBe('H2');
		expect(globalThis.document.activeElement?.textContent).toBe(LANDING.pitch);
	});
});
