// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {createTestStore, makeTestBlob} from '../../../tests/state/fixtures.ts';
import {
	COMPARE_HOLD_MS,
	clampSplitPosition,
	createCompareHoldController,
	stepSplitPosition,
} from './compare-logic.ts';
import {CompareOverlay} from './compare.tsx';
import {AppRuntimeProvider} from '@/app/runtime-context.tsx';
import {TooltipProvider} from '@/components/ui/tooltip';
import {EditorToolbar} from '@/features/toolbar/editor-toolbar.tsx';
import type {AppRuntime} from '@/state/index.ts';
import {selectShowingOriginal} from '@/state/transient.ts';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const stubRuntime: AppRuntime = {
	ready: Promise.resolve({status: 'insecure-context'}),
	result: null,
	dispose() {},
};

let container: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(() => {
	vi.useRealTimers();
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

describe('compare-logic', () => {
	it('clamps split positions into [0, 1] and defaults non-finite values to 0.5', () => {
		expect(clampSplitPosition(-0.25)).toBe(0);
		expect(clampSplitPosition(1.5)).toBe(1);
		expect(clampSplitPosition(0.42)).toBe(0.42);
		expect(clampSplitPosition(Number.parseFloat('nope'))).toBe(0.5);
	});

	it('steps split position by 1% on Arrow keys, 10% on Shift+Arrow, and 0/1 on Home/End', () => {
		expect(stepSplitPosition(0.5, 'ArrowLeft', false)).toBe(0.49);
		expect(stepSplitPosition(0.5, 'ArrowRight', false)).toBe(0.51);
		expect(stepSplitPosition(0.5, 'ArrowLeft', true)).toBe(0.4);
		expect(stepSplitPosition(0.5, 'ArrowRight', true)).toBe(0.6);
		expect(stepSplitPosition(0.05, 'ArrowLeft', true)).toBe(0);
		expect(stepSplitPosition(0.95, 'ArrowRight', true)).toBe(1);
		expect(stepSplitPosition(0.5, 'Home', false)).toBe(0);
		expect(stepSplitPosition(0.5, 'End', false)).toBe(1);
		expect(stepSplitPosition(0.5, 'ArrowUp', false)).toBeNull();
	});

	it('toggles latched compare on a short press (< 300 ms) and returns to edited on a long hold (>= 300 ms)', () => {
		vi.useFakeTimers();
		let latched = false;
		let holding = false;
		const controller = createCompareHoldController({
			getLatched: () => latched,
			setHolding(next) {
				holding = next;
			},
			setLatched(next) {
				latched = next;
			},
		});

		// Tap 1: latches original on.
		controller.pressStart();
		expect(holding).toBe(true);
		vi.advanceTimersByTime(100);
		controller.pressEnd();
		expect(holding).toBe(false);
		expect(latched).toBe(true);

		// Tap 2: latches original off.
		controller.pressStart();
		vi.advanceTimersByTime(100);
		controller.pressEnd();
		expect(holding).toBe(false);
		expect(latched).toBe(false);

		// Hold >= 300 ms: shows original while held, returns to edited on release.
		controller.pressStart();
		expect(holding).toBe(true);
		vi.advanceTimersByTime(COMPARE_HOLD_MS);
		expect(holding).toBe(true);
		controller.pressEnd();
		expect(holding).toBe(false);
		expect(latched).toBe(false);
	});
});

describe('CompareOverlay', () => {
	it('renders Original pill in compare mode and Original/Edited + accessible separator in split mode', () => {
		container = document.createElement('div');
		document.body.append(container);
		root = createRoot(container);

		const stageRef = {current: container};
		const onDrag = vi.fn();
		const onCommit = vi.fn();

		act(() => {
			root!.render(
				<CompareOverlay
					showingOriginal
					stageRef={stageRef}
					splitActive={false}
					splitPosition={0.5}
					onDragSplit={onDrag}
					onCommitSplit={onCommit}
				/>,
			);
		});
		expect(container.textContent).toContain('Original');
		expect(container.querySelector('[role="separator"]')).toBeNull();

		act(() => {
			root!.render(
				<CompareOverlay
					splitActive
					stageRef={stageRef}
					showingOriginal={false}
					splitPosition={0.4}
					onDragSplit={onDrag}
					onCommitSplit={onCommit}
				/>,
			);
		});
		expect(container.textContent).toContain('Original');
		expect(container.textContent).toContain('Edited');
		const separator =
			container.querySelector<HTMLDivElement>('[role="separator"]');
		expect(separator).not.toBeNull();
		expect(separator?.getAttribute('aria-label')).toBe(
			'Compare split position',
		);
		expect(separator?.getAttribute('aria-orientation')).toBe('vertical');
		expect(separator?.getAttribute('aria-valuemin')).toBe('0');
		expect(separator?.getAttribute('aria-valuemax')).toBe('100');
		expect(separator?.getAttribute('aria-valuenow')).toBe('40');

		// Keyboard stepping commits 1% and 10%.
		act(() => {
			separator?.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'ArrowRight',
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		expect(onCommit).toHaveBeenLastCalledWith(0.41);

		act(() => {
			separator?.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'ArrowLeft',
					shiftKey: true,
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		expect(onCommit).toHaveBeenLastCalledWith(0.31);
	});
});

describe('EditorToolbar compare and split controls', () => {
	it('toggles Compare and Split via buttons and keyboard shortcuts without creating history entries', async () => {
		vi.useFakeTimers();
		const context = createTestStore();
		await context.store.getState().importImage({
			name: 'photo.png',
			blob: makeTestBlob('photo'),
			width: 32,
			height: 32,
		});
		const initialHistoryCount = context.store.getState().history.length;

		container = document.createElement('div');
		document.body.append(container);
		root = createRoot(container);
		act(() => {
			root!.render(
				<TooltipProvider>
					<AppRuntimeProvider
						value={{runtime: stubRuntime, bundle: context.bundle}}
					>
						<EditorToolbar />
					</AppRuntimeProvider>
				</TooltipProvider>,
			);
		});

		const compareButton = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Compare"]',
		);
		const splitButton = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Split"]',
		);
		expect(compareButton).not.toBeNull();
		expect(splitButton).not.toBeNull();

		// Tap Compare via backslash key.
		act(() => {
			globalThis.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: '\\',
					bubbles: true,
					cancelable: true,
				}),
			);
			vi.advanceTimersByTime(50);
			globalThis.dispatchEvent(
				new KeyboardEvent('keyup', {
					key: '\\',
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		expect(selectShowingOriginal(context.transientStore.getState())).toBe(true);
		expect(compareButton?.getAttribute('aria-pressed')).toBe('true');

		// Hold backslash >= 300 ms and release -> returns to result.
		act(() => {
			globalThis.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: '\\',
					bubbles: true,
					cancelable: true,
				}),
			);
			vi.advanceTimersByTime(400);
			globalThis.dispatchEvent(
				new KeyboardEvent('keyup', {
					key: '\\',
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		expect(selectShowingOriginal(context.transientStore.getState())).toBe(
			false,
		);

		// Press S to toggle split mode on.
		act(() => {
			globalThis.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 's',
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		expect(context.store.getState().compareMode).toBe('split');
		expect(splitButton?.getAttribute('aria-pressed')).toBe('true');

		// Switching projects resets transient compare state.
		await act(async () => {
			context.transientStore.setState({compareLatched: true});
			await context.store.getState().closeProject();
		});
		expect(selectShowingOriginal(context.transientStore.getState())).toBe(
			false,
		);

		// History count never changed.
		expect(initialHistoryCount).toBe(1);
	});
});
