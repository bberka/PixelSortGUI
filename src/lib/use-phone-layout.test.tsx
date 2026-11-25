// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {PHONE_MEDIA_QUERY, usePhoneLayout} from './use-phone-layout.ts';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let container: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;

function Probe() {
	const isPhone = usePhoneLayout();
	return <span data-phone={String(isPhone)} />;
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
	vi.restoreAllMocks();
});

describe('usePhoneLayout', () => {
	it('tracks the phone media query and updates when it changes', () => {
		let matches = false;
		const listeners = new Set<() => void>();
		vi.spyOn(globalThis, 'matchMedia').mockImplementation(
			(query: string) =>
				({
					get matches() {
						return query === PHONE_MEDIA_QUERY ? matches : false;
					},
					media: query,
					addEventListener(_type: string, listener: () => void) {
						listeners.add(listener);
					},
					removeEventListener(_type: string, listener: () => void) {
						listeners.delete(listener);
					},
				}) as unknown as MediaQueryList,
		);

		container = document.createElement('div');
		document.body.append(container);
		root = createRoot(container);
		act(() => {
			root!.render(<Probe />);
		});

		const span = () => container!.querySelector('span')!;
		expect(span().dataset.phone).toBe('false');

		matches = true;
		act(() => {
			for (const listener of listeners) {
				listener();
			}
		});
		expect(span().dataset.phone).toBe('true');

		act(() => {
			root!.unmount();
		});
		root = undefined;
		expect(listeners.size).toBe(0);
	});
});
