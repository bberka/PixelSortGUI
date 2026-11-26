// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vite-plus/test';
import {
	formatHint,
	keyboardHintsShown,
	TOUCH_ONLY_MEDIA_QUERY,
	useShortcutHint,
} from './keyboard-hints.ts';

type Listener = () => void;

function stubPointer(touchOnly: boolean) {
	const listeners = new Set<Listener>();
	const state = {touchOnly};
	vi.stubGlobal('matchMedia', (query: string) => ({
		get matches() {
			return query === TOUCH_ONLY_MEDIA_QUERY && state.touchOnly;
		},
		addEventListener(_type: string, listener: Listener) {
			listeners.add(listener);
		},
		removeEventListener(_type: string, listener: Listener) {
			listeners.delete(listener);
		},
	}));

	return {
		listeners,
		set(next: boolean) {
			state.touchOnly = next;
			for (const listener of listeners) {
				listener();
			}
		},
	};
}

function Probe() {
	const hint = useShortcutHint();
	return <p>{hint('Split view', 'S')}</p>;
}

describe('keyboard hint rule', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
		container = document.createElement('div');
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		vi.unstubAllGlobals();
	});

	it('hides hints only for a touch pointer that cannot hover', () => {
		stubPointer(true);
		expect(keyboardHintsShown()).toBe(false);
		stubPointer(false);
		expect(keyboardHintsShown()).toBe(true);
	});

	it('shows hints where media queries are unavailable', () => {
		vi.stubGlobal('matchMedia', undefined);
		expect(keyboardHintsShown()).toBe(true);
	});

	it('formats keys in parentheses and keeps a note without them', () => {
		expect(formatHint(true, 'Split view', 'S')).toBe('Split view (S)');
		expect(formatHint(false, 'Split view', 'S')).toBe('Split view');
		expect(formatHint(true, 'Compare', '\\', 'hold to peek')).toBe(
			String.raw`Compare (\, hold to peek)`,
		);
		expect(formatHint(false, 'Compare', '\\', 'hold to peek')).toBe(
			'Compare, hold to peek',
		);
	});

	it('follows the pointer while mounted and stops listening afterwards', () => {
		const pointer = stubPointer(false);
		act(() => {
			root.render(<Probe />);
		});
		expect(container.textContent).toBe('Split view (S)');

		act(() => {
			pointer.set(true);
		});
		expect(container.textContent).toBe('Split view');

		act(() => {
			root.render(null);
		});
		expect(pointer.listeners.size).toBe(0);
	});
});
