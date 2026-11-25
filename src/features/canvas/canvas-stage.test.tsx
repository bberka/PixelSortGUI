// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vite-plus/test';
import {createTestStore, makeTestBlob} from '../../../tests/state/fixtures.ts';
import {
	CanvasStage,
	PROGRESS_DELAY_MS,
	WHEEL_COMMIT_MS,
} from './canvas-stage.tsx';
import type {AppRuntime} from '@/state/index.ts';
import {AppRuntimeProvider} from '@/app/runtime-context.tsx';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

type TestStore = ReturnType<typeof createTestStore>;

type Mounted = {
	store: TestStore['store'];
	coordinator: TestStore['coordinator'];
	container: HTMLDivElement;
	root: Root;
	canvas: () => HTMLCanvasElement;
	notifications: {count: number};
};

const stubRuntime: AppRuntime = {
	ready: Promise.resolve({status: 'insecure-context'}),
	result: null,
	dispose() {},
};

let mounted: Mounted | undefined;

async function mount(options: {withProject?: boolean} = {}): Promise<Mounted> {
	const withProject = options.withProject ?? true;
	const test = createTestStore();
	if (withProject) {
		await test.store.getState().importImage({
			name: 'canvas.png',
			blob: makeTestBlob('canvas'),
			width: 400,
			height: 300,
		});
		test.coordinator.calls.length = 0;
	}

	const notifications = {count: 0};
	test.store.subscribe(() => {
		notifications.count++;
	});

	const container = document.createElement('div');
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(
			<AppRuntimeProvider value={{runtime: stubRuntime, bundle: test.bundle}}>
				<CanvasStage />
			</AppRuntimeProvider>,
		);
	});

	const canvasElement = container.querySelector('canvas');
	if (!canvasElement) {
		throw new Error('The stage must render a canvas');
	}

	mounted = {
		store: test.store,
		coordinator: test.coordinator,
		container,
		root,
		canvas: () => canvasElement,
		notifications,
	};
	return mounted;
}

function setRender(
	store: TestStore['store'],
	patch: {
		busy?: Partial<Record<'drag' | 'settle' | 'full', boolean>>;
		failed?: boolean;
	},
): void {
	act(() => {
		store.setState((state) => ({
			render: {
				...state.render,
				busy: {...state.render.busy, ...patch.busy},
				failed: patch.failed ?? state.render.failed,
			},
		}));
	});
}

function pressKey(key: string): void {
	act(() => {
		document.body.dispatchEvent(
			new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}),
		);
	});
}

function pointer(
	canvas: HTMLCanvasElement,
	type: 'pointerdown' | 'pointermove' | 'pointerup',
	init: {x: number; y: number; pointerType?: string; button?: number},
): void {
	act(() => {
		canvas.dispatchEvent(
			new PointerEvent(type, {
				pointerId: 1,
				pointerType: init.pointerType ?? 'mouse',
				button: init.button ?? 0,
				buttons: type === 'pointerup' ? 0 : 1,
				isPrimary: true,
				clientX: init.x,
				clientY: init.y,
				bubbles: true,
				cancelable: true,
			}),
		);
	});
}

/**
 Happy-dom's WheelEvent drops the MouseEvent fields (`ctrlKey`, `clientX`,
 `deltaX`), so they are defined on the instance before dispatch.
 */
function wheel(
	canvas: HTMLCanvasElement,
	init: {
		deltaY: number;
		deltaX?: number;
		ctrlKey?: boolean;
		clientX?: number;
		clientY?: number;
	},
): void {
	const event = new WheelEvent('wheel', {
		deltaY: init.deltaY,
		bubbles: true,
		cancelable: true,
	});
	Object.defineProperties(event, {
		ctrlKey: {value: init.ctrlKey ?? false},
		clientX: {value: init.clientX ?? 0},
		clientY: {value: init.clientY ?? 0},
		deltaX: {value: init.deltaX ?? 0},
	});
	act(() => {
		canvas.dispatchEvent(event);
	});
}

function viewState(store: TestStore['store']) {
	const project = store.getState().activeProject;
	if (!project) {
		throw new Error('An active project is required');
	}

	return project.viewState;
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	if (mounted) {
		act(() => {
			mounted?.root.unmount();
		});
		mounted.container.remove();
		mounted = undefined;
	}

	document.body.replaceChildren();
	vi.useRealTimers();
});

describe('canvas stage', () => {
	it('renders a labelled canvas with the zoom readout', async () => {
		const view = await mount();

		expect(view.canvas().getAttribute('aria-label')).toBe('Image canvas');
		expect(view.canvas().getAttribute('tabindex')).toBe('0');

		const zoomButton = view.container.querySelector('button');
		expect(zoomButton?.textContent).toContain('Zoom');
		expect(zoomButton?.textContent).toContain('100%');
	});

	it('stays usable when there is no project and no frame yet', async () => {
		const view = await mount({withProject: false});

		expect(view.canvas()).toBeDefined();
		expect(view.container.textContent).toContain('Zoom');
		expect(view.container.querySelector('[role="progressbar"]')).toBeNull();
		expect(view.container.textContent).not.toContain(
			'Rendering full resolution',
		);
		expect(view.container.querySelector('[role="alert"]')).toBeNull();
	});

	it('zooms with the +, -, 0 and 1 keys and stores one view state per press', async () => {
		const view = await mount();
		expect(viewState(view.store).fitMode).toBe('fit');

		pressKey('1');
		expect(viewState(view.store)).toMatchObject({fitMode: 'custom', zoom: 1});

		pressKey('+');
		expect(viewState(view.store).zoom).toBe(2);

		pressKey('-');
		expect(viewState(view.store).zoom).toBe(1);

		pressKey('0');
		expect(viewState(view.store).fitMode).toBe('fit');
	});

	it('ignores zoom keys typed into a text field', async () => {
		const view = await mount();
		const input = document.createElement('input');
		document.body.append(input);

		act(() => {
			input.dispatchEvent(
				new KeyboardEvent('keydown', {key: '1', bubbles: true}),
			);
		});

		expect(viewState(view.store).fitMode).toBe('fit');
	});

	it('pans by dragging without touching the store, then commits once on release', async () => {
		const view = await mount();
		const before = viewState(view.store);
		view.notifications.count = 0;

		pointer(view.canvas(), 'pointerdown', {x: 10, y: 10});
		pointer(view.canvas(), 'pointermove', {x: 60, y: 10});
		pointer(view.canvas(), 'pointermove', {x: 110, y: 10});

		expect(viewState(view.store)).toEqual(before);
		expect(view.notifications.count).toBe(0);

		pointer(view.canvas(), 'pointerup', {x: 110, y: 10});

		const after = viewState(view.store);
		expect(after.centerX).toBeCloseTo(before.centerX - 100, 6);
		expect(after.fitMode).toBe('custom');
		expect(view.notifications.count).toBe(1);
	});

	it('zooms around the pointer with ctrl+wheel and commits after the wheel stops', async () => {
		const view = await mount();
		const before = viewState(view.store);

		wheel(view.canvas(), {deltaY: -100, ctrlKey: true, clientX: 0, clientY: 0});
		expect(viewState(view.store).zoom).toBe(before.zoom);

		act(() => {
			vi.advanceTimersByTime(WHEEL_COMMIT_MS);
		});

		const after = viewState(view.store);
		expect(after.zoom).toBeGreaterThan(before.zoom);
		expect(after.fitMode).toBe('custom');
	});

	it('pans vertically with a plain wheel', async () => {
		const view = await mount();
		const before = viewState(view.store);

		wheel(view.canvas(), {deltaY: 100});
		act(() => {
			vi.advanceTimersByTime(WHEEL_COMMIT_MS);
		});

		const after = viewState(view.store);
		expect(after.zoom).toBe(before.zoom);
		expect(after.centerY).toBeCloseTo(before.centerY + 100, 6);
	});

	it('toggles between fit and 100% on a double click', async () => {
		const view = await mount();
		expect(viewState(view.store).fitMode).toBe('fit');

		act(() => {
			view.canvas().dispatchEvent(
				new MouseEvent('dblclick', {
					clientX: 0,
					clientY: 0,
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		expect(viewState(view.store)).toMatchObject({fitMode: 'custom', zoom: 1});

		act(() => {
			view.canvas().dispatchEvent(
				new MouseEvent('dblclick', {
					clientX: 0,
					clientY: 0,
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		expect(viewState(view.store).fitMode).toBe('fit');
	});

	it('shows the progress bar only after the render has run for 300 ms', async () => {
		const view = await mount();
		setRender(view.store, {busy: {settle: true}});

		expect(view.container.querySelector('[role="progressbar"]')).toBeNull();

		act(() => {
			vi.advanceTimersByTime(PROGRESS_DELAY_MS);
		});

		const bar = view.container.querySelector('[role="progressbar"]');
		expect(bar?.getAttribute('aria-label')).toBe('Render progress');

		setRender(view.store, {busy: {settle: false}});
		expect(view.container.querySelector('[role="progressbar"]')).toBeNull();
	});

	it('hides the progress bar when a render finishes before 300 ms', async () => {
		const view = await mount();
		setRender(view.store, {busy: {drag: true}});
		act(() => {
			vi.advanceTimersByTime(100);
		});
		setRender(view.store, {busy: {drag: false}});
		act(() => {
			vi.advanceTimersByTime(500);
		});

		expect(view.container.querySelector('[role="progressbar"]')).toBeNull();
	});

	it('shows the full-resolution pill while a full render runs', async () => {
		const view = await mount();
		expect(view.container.textContent).not.toContain(
			'Rendering full resolution',
		);

		setRender(view.store, {busy: {full: true}});
		expect(view.container.textContent).toContain('Rendering full resolution');

		setRender(view.store, {busy: {full: false}});
		expect(view.container.textContent).not.toContain(
			'Rendering full resolution',
		);
	});

	it('offers a retry through the coordinator when rendering stopped', async () => {
		const view = await mount();
		setRender(view.store, {failed: true});

		const alert = view.container.querySelector('[role="alert"]');
		expect(alert?.textContent).toContain('Rendering stopped unexpectedly.');

		const retry = [...view.container.querySelectorAll('button')].find(
			(button) => button.textContent?.trim() === 'Retry',
		);
		expect(retry).toBeDefined();
		act(() => {
			retry?.dispatchEvent(new MouseEvent('click', {bubbles: true}));
		});
		expect(view.coordinator.calls).toContainEqual({type: 'retry'});

		setRender(view.store, {failed: false});
		expect(view.container.querySelector('[role="alert"]')).toBeNull();
	});

	it('reports the real fitted scale to the coordinator in fit mode instead of 0', async () => {
		const view = await mount();
		view.coordinator.calls.length = 0;

		view.store
			.getState()
			.setViewState(
				{fitMode: 'fit', zoom: 1.5, centerX: 200, centerY: 150},
				{devicePixelRatio: 2},
			);

		expect(view.coordinator.calls).toContainEqual({
			type: 'setViewScale',
			scale: 3,
		});
	});
});
