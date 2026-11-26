// @vitest-environment happy-dom
import {act, type ReactElement} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vite-plus/test';
import {createTestStore} from '../../tests/state/fixtures.ts';
import {App} from './app.tsx';
import {announce} from './announcer.ts';
import type {ScreenRegistry} from './route-host.tsx';
import type {RestoreResult} from '@/storage/restore.ts';
import type {AppRuntime} from '@/state/index.ts';
import type {AppRoute} from '@/state/router.ts';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

type ReadyOptions = {
	route?: AppRoute;
	storageUnavailable?: boolean;
	notice?: string | null;
};

function createRuntime(
	ready: Promise<RestoreResult> | RestoreResult,
): AppRuntime {
	return {ready: Promise.resolve(ready), result: null, dispose() {}};
}

function createReadyRuntime(options: ReadyOptions = {}) {
	const test = createTestStore();
	const route = options.route ?? {screen: 'library'};
	const storageUnavailable = options.storageUnavailable ?? false;
	const notice = options.notice ?? null;

	test.store.getState().hydrateFromRestore({
		projects: [],
		presets: [],
		theme: 'system',
		compareMode: 'toggle',
		storageUnavailable,
		route,
		notice,
		activeProject: null,
	});

	const result: RestoreResult = {
		status: 'ready',
		bundle: test.bundle,
		storageUnavailable,
		route,
		notice,
		hydrationPromise: Promise.resolve(),
		housekeepingPromise: Promise.resolve(),
	};

	return {runtime: createRuntime(result), store: test.store};
}

let container: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;

function mount(element: ReactElement): HTMLDivElement {
	container = document.createElement('div');
	document.body.append(container);
	root = createRoot(container);
	act(() => {
		root!.render(element);
	});
	return container;
}

async function flush(): Promise<void> {
	await act(async () => {
		await Promise.resolve();
	});
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

function textOf(element: ParentNode): string {
	return element.textContent ?? '';
}

describe('route host', () => {
	it('renders the library screen with the empty state for the library route', async () => {
		const {runtime} = createReadyRuntime();
		const screen = mount(<App runtime={runtime} />);
		await flush();

		expect(screen.querySelector('h1')?.textContent).toBe('Drift');
		expect(textOf(screen)).toContain('No projects yet');
		expect(textOf(screen)).toContain('Images stay on this device.');
		expect(
			[...screen.querySelectorAll('button')].map(
				(button) => button.textContent,
			),
		).toContain('Open images');
	});

	it('shows the decorative app icon immediately before the title', async () => {
		const {runtime} = createReadyRuntime();
		const screen = mount(<App runtime={runtime} />);
		await flush();

		const icon = screen.querySelector('h1')?.previousElementSibling;
		expect(icon?.getAttribute('src')).toBe('/icons/icon.svg');
		expect(icon?.getAttribute('alt')).toBe('');
		expect(icon?.getAttribute('aria-hidden')).toBe('true');
	});

	it('lays out the four editor regions in reading order for the editor route', async () => {
		const {runtime} = createReadyRuntime({
			route: {screen: 'editor', projectId: 'project-1'},
		});
		const screen = mount(<App runtime={runtime} />);
		await flush();

		const regions = [
			...screen.querySelectorAll(':scope main section[aria-label]'),
		].map((element) => element.getAttribute('aria-label'));
		expect(regions).toEqual([
			'Canvas toolbar',
			'Canvas',
			'Effect stack',
			'Parameters',
		]);
		expect(textOf(screen)).not.toContain('No projects yet');
	});
});

describe('startup states', () => {
	it('shows a busy placeholder and no library before restore resolves', () => {
		const runtime = createRuntime(
			new Promise<RestoreResult>(() => {
				/*
				 The restore promise never settles: this is the state between the
				 first paint and the end of startup restore.
				 */
			}),
		);
		const screen = mount(<App runtime={runtime} />);

		expect(textOf(screen)).not.toContain('No projects yet');
		expect(screen.querySelector('[aria-busy="true"]')).not.toBeNull();
		expect(screen.querySelector('h1')?.textContent).toBe('Drift');
	});

	it('blocks the app with the secure-context screen outside a secure context', async () => {
		const runtime = createRuntime({status: 'insecure-context'});
		const screen = mount(<App runtime={runtime} />);
		await flush();

		expect(screen.querySelector('h1')?.textContent).toBe(
			'Secure connection required',
		);
		expect(textOf(screen)).toContain(
			'Open Drift over HTTPS or http://localhost so browser storage and offline features can work.',
		);
		expect(textOf(screen)).not.toContain('No projects yet');
	});

	it('blocks the app with the newer-version screen when storage was written by a newer app', async () => {
		const runtime = createRuntime({
			status: 'version-error',
			expectedVersion: 1,
			message: 'Stored database schema is newer than supported version 1',
		});
		const screen = mount(<App runtime={runtime} />);
		await flush();

		expect(screen.querySelector('h1')?.textContent).toBe('Update required');
		expect(textOf(screen)).toContain(
			'Stored database schema is newer than supported version 1',
		);
		expect(screen.querySelector('button')?.textContent).toContain('Reload');
	});

	it('shows the storage-unavailable banner above a working library screen', async () => {
		const {runtime} = createReadyRuntime({storageUnavailable: true});
		const screen = mount(<App runtime={runtime} />);
		await flush();

		const banner = screen.querySelector('[role="alert"]');
		expect(banner?.textContent).toBe(
			'Storage unavailable: nothing will be saved after you close this tab.',
		);
		expect(textOf(screen)).toContain('No projects yet');
	});

	it('shows no banner when storage opened normally', async () => {
		const {runtime} = createReadyRuntime();
		const screen = mount(<App runtime={runtime} />);
		await flush();

		expect(screen.querySelector('[role="alert"]')).toBeNull();
	});

	it('returns to the library and consumes the missing-project notice', async () => {
		const {runtime, store} = createReadyRuntime({
			route: {screen: 'library'},
			notice: 'That project no longer exists.',
		});
		const screen = mount(<App runtime={runtime} />);
		await flush();

		expect(textOf(screen)).toContain('No projects yet');
		expect(store.getState().notice).toBeNull();
		// The toast library mounts the message on a later tick than the store update.
		await vi.waitFor(() => {
			expect(textOf(document.body)).toContain('That project no longer exists.');
		});
	});

	it('opens the storage-full dialog and returns to the library from it', async () => {
		const {runtime, store} = createReadyRuntime({
			route: {screen: 'editor', projectId: 'project-1'},
		});
		const screen = mount(<App runtime={runtime} />);
		await flush();

		act(() => {
			store.setState((state) => ({
				storage: {...state.storage, quotaFull: true},
			}));
		});

		expect(textOf(document.body)).toContain('Storage is full');
		const manage = [...document.querySelectorAll('button')].find(
			(button) => button.textContent === 'Manage library',
		);
		expect(manage).toBeDefined();
		act(() => {
			manage!.click();
		});
		await flush();

		expect(store.getState().storage.quotaFull).toBe(false);
		expect(textOf(screen)).toContain('No projects yet');
	});
});

describe('screen error boundary', () => {
	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => {
			/*
			 React logs the caught render error; the test asserts the recovery UI
			 instead and keeps the test output readable.
			 */
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function ThrowingScreen(): never {
		throw new Error('Canvas exploded');
	}

	const throwingScreens: ScreenRegistry = {
		library: {chrome: 'shell', component: ThrowingScreen},
		editor: {chrome: 'shell', component: ThrowingScreen},
		guide: {chrome: 'shell', component: ThrowingScreen},
		gallery: {chrome: 'bare', component: ThrowingScreen},
	};

	it('shows a recoverable error state with a reload action instead of a blank screen', async () => {
		const {runtime} = createReadyRuntime();
		const screen = mount(<App runtime={runtime} screens={throwingScreens} />);
		await flush();

		expect(textOf(screen)).toContain('This screen stopped working');
		expect(textOf(screen)).toContain('Canvas exploded');
		expect(
			[...screen.querySelectorAll('button')].map(
				(button) => button.textContent,
			),
		).toContain('Reload');
		// The shell itself survives a screen crash.
		expect(screen.querySelector('h1')?.textContent).toBe('Drift');
	});

	it('recovers when the route changes to a screen that renders', async () => {
		const {runtime, store} = createReadyRuntime();
		const screens: ScreenRegistry = {
			...throwingScreens,
			editor: {chrome: 'shell', component: () => <p>Editor recovered</p>},
		};
		const screen = mount(<App runtime={runtime} screens={screens} />);
		await flush();
		expect(textOf(screen)).toContain('This screen stopped working');

		const nextRoute: AppRoute = {screen: 'editor', projectId: 'project-1'};
		act(() => {
			store.setState({route: nextRoute});
		});
		await flush();

		expect(textOf(screen)).toContain('Editor recovered');
		expect(textOf(screen)).not.toContain('This screen stopped working');
	});
});

describe('live region', () => {
	it('announces through a polite status region', async () => {
		const {runtime} = createReadyRuntime();
		const screen = mount(<App runtime={runtime} />);
		await flush();

		const region = screen.querySelector('[role="status"]');
		expect(region?.getAttribute('aria-live')).toBe('polite');
		expect(textOf(region!)).toBe('');

		act(() => {
			announce('Rendered');
		});
		expect(textOf(region!)).toBe('Rendered');

		act(() => {
			announce('  ');
		});
		expect(textOf(region!)).toBe('Rendered');
	});
});
