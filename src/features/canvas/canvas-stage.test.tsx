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
import {LiveRegion} from '@/app/live-region.tsx';
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
				<LiveRegion />
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

	const openZoomMenu = (container: HTMLElement) => {
		const zoomTrigger = container.querySelector('button');
		expect(zoomTrigger).not.toBeNull();

		// Open the Radix dropdown menu via pointerdown (Radix Trigger opens on
		// primary mouse pointerdown, not click) and flush the mount timer that
		// registers Radix DismissableLayer's outside-pointerdown listener.
		act(() => {
			zoomTrigger!.dispatchEvent(
				new PointerEvent('pointerdown', {
					button: 0,
					ctrlKey: false,
					pointerType: 'mouse',
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		act(() => {
			vi.advanceTimersByTime(0);
		});

		const findItem = (label: string) =>
			[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
				(element) => element.textContent?.trim() === label,
			);

		return {zoomTrigger: zoomTrigger!, findItem};
	};

	it('keeps focus on the canvas and pans with arrow keys when focused right after picking a zoom preset', async () => {
		const view = await mount();
		const stage = view.canvas().parentElement!;
		Object.defineProperties(stage, {
			clientWidth: {value: 800, configurable: true},
			clientHeight: {value: 600, configurable: true},
		});

		const {findItem} = openZoomMenu(view.container);
		const item100 = findItem('100%');
		expect(item100).toBeDefined();

		// Choose 100%, which closes the menu and schedules Radix FocusScope's
		// setTimeout(..., 0) onCloseAutoFocus restoration.
		act(() => {
			item100!.dispatchEvent(
				new MouseEvent('click', {bubbles: true, cancelable: true}),
			);
		});

		// Focus the canvas before that macrotask fires (the exact race window
		// between chooseZoom and keyboard.press in E2E and fast user clicks).
		act(() => {
			view.canvas().focus();
		});
		expect(document.activeElement).toBe(view.canvas());

		// Flush Radix FocusScope's deferred unmount auto-focus timer.
		act(() => {
			vi.advanceTimersByTime(0);
		});

		expect(document.activeElement).toBe(view.canvas());

		const before = viewState(view.store);
		act(() => {
			document.activeElement!.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'ArrowRight',
					bubbles: true,
					cancelable: true,
				}),
			);
		});

		const after = viewState(view.store);
		expect(after.centerX - before.centerX).toBeCloseTo(80 / before.zoom, 6);
	});

	it('syncs a stale zero viewport before panning with arrow keys when ResizeObserver has not fired yet', async () => {
		const view = await mount();
		pressKey('1');

		// Happy-dom reports 0x0 on mount; update stage dimensions directly without
		// firing ResizeObserver so viewportRef stays {0, 0} until keydown.
		const stage = view.canvas().parentElement!;
		Object.defineProperties(stage, {
			clientWidth: {value: 800, configurable: true},
			clientHeight: {value: 600, configurable: true},
		});

		act(() => {
			view.canvas().focus();
		});

		const before = viewState(view.store);
		act(() => {
			view.canvas().dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'ArrowRight',
					bubbles: true,
					cancelable: true,
				}),
			);
		});

		const after = viewState(view.store);
		expect(after.centerX - before.centerX).toBeCloseTo(80 / before.zoom, 6);
	});

	it('still returns focus to the zoom trigger when nothing else takes focus after closing the menu', async () => {
		const view = await mount();
		const {zoomTrigger, findItem} = openZoomMenu(view.container);
		const item100 = findItem('100%');
		expect(item100).toBeDefined();

		act(() => {
			item100!.dispatchEvent(
				new MouseEvent('click', {bubbles: true, cancelable: true}),
			);
		});

		act(() => {
			vi.advanceTimersByTime(0);
		});

		expect(document.activeElement).toBe(zoomTrigger);
	});

	it('restores focus to the zoom trigger on Escape and Enter after a prior right-click outside close', async () => {
		const view = await mount();
		const {zoomTrigger} = openZoomMenu(view.container);

		act(() => {
			view.canvas().dispatchEvent(
				new PointerEvent('pointerdown', {
					button: 2,
					ctrlKey: false,
					pointerType: 'mouse',
					bubbles: true,
					cancelable: true,
				}),
			);
			view.canvas().focus();
		});
		act(() => {
			vi.advanceTimersByTime(0);
		});
		expect(document.activeElement).toBe(view.canvas());

		// Reopen and close with Escape.
		openZoomMenu(view.container);
		act(() => {
			document.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'Escape',
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		act(() => {
			vi.advanceTimersByTime(0);
		});
		expect(document.activeElement).toBe(zoomTrigger);

		// Reopen and select an item with Enter.
		const {findItem} = openZoomMenu(view.container);
		const item100 = findItem('100%');
		expect(item100).toBeDefined();
		act(() => {
			item100!.focus();
			item100!.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'Enter',
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		act(() => {
			vi.advanceTimersByTime(0);
		});
		expect(document.activeElement).toBe(zoomTrigger);
	});

	it('announces Rendering, Rendered, and Render failed on long settle/full renders, ignoring fast renders', async () => {
		const view = await mount();
		const status = view.container.querySelector('[role="status"]');
		expect(status?.getAttribute('aria-live')).toBe('polite');

		// Rapid drag renders do not change the live region.
		const beforeDrag = status?.textContent;
		setRender(view.store, {busy: {drag: true}});
		act(() => {
			vi.advanceTimersByTime(100);
		});
		setRender(view.store, {busy: {drag: false}});
		expect(status?.textContent).toBe(beforeDrag);

		// Fast full-resolution renders (< 300 ms) do not chatter Rendering/Rendered.
		setRender(view.store, {busy: {full: true}});
		act(() => {
			vi.advanceTimersByTime(100);
		});
		setRender(view.store, {busy: {full: false}});
		act(() => {
			vi.advanceTimersByTime(PROGRESS_DELAY_MS);
		});
		expect(status?.textContent).toBe(beforeDrag);

		// A settle render lasting >= 300 ms announces Rendering then Rendered.
		setRender(view.store, {busy: {settle: true}});
		act(() => {
			vi.advanceTimersByTime(PROGRESS_DELAY_MS);
		});
		expect(status?.textContent).toBe('Rendering');

		setRender(view.store, {busy: {settle: false}});
		expect(status?.textContent).toBe('Rendered');

		// A full-resolution render lasting >= 300 ms announces Rendering then Rendered.
		setRender(view.store, {busy: {full: true}});
		act(() => {
			vi.advanceTimersByTime(PROGRESS_DELAY_MS - 1);
		});
		expect(status?.textContent).toBe('Rendered');

		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(status?.textContent).toBe('Rendering');

		setRender(view.store, {busy: {full: false}});
		expect(status?.textContent).toBe('Rendered');

		// If a render fails after Rendering was announced, announce Render failed.
		setRender(view.store, {busy: {settle: true}});
		act(() => {
			vi.advanceTimersByTime(PROGRESS_DELAY_MS);
		});
		expect(status?.textContent).toBe('Rendering');

		setRender(view.store, {busy: {settle: false}, failed: true});
		expect(status?.textContent).toBe('Render failed.');

		// Clearing failed does not emit a stale Rendered announcement.
		setRender(view.store, {failed: false});
		expect(status?.textContent).toBe('Render failed.');
	});
});
