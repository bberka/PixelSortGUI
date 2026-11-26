// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {
	PHONE_LANDSCAPE_MEDIA_QUERY,
	PHONE_MEDIA_QUERY,
	TABLET_MEDIA_QUERY,
	useEditorViewportClass,
	usePhoneLayout,
	useTabletLayout,
} from './use-phone-layout.ts';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let container: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;

function Probe() {
	const isPhone = usePhoneLayout();
	const isTablet = useTabletLayout();
	const viewportClass = useEditorViewportClass();
	return (
		<span
			data-phone={String(isPhone)}
			data-tablet={String(isTablet)}
			data-class={viewportClass}
		/>
	);
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

describe('viewport layout hooks', () => {
	it('tracks phone, tablet, landscape, and desktop viewport classes and cleans up listeners', () => {
		let state = {phone: false, landscape: false, tablet: false};
		const listeners = new Set<() => void>();
		vi.spyOn(globalThis, 'matchMedia').mockImplementation(
			(query: string) =>
				({
					get matches() {
						if (query === PHONE_LANDSCAPE_MEDIA_QUERY) {
							return state.landscape;
						}

						if (query === PHONE_MEDIA_QUERY) {
							return state.phone || state.landscape;
						}

						return query === TABLET_MEDIA_QUERY ? state.tablet : false;
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

		const notify = () => {
			act(() => {
				for (const listener of listeners) {
					listener();
				}
			});
		};

		container = document.createElement('div');
		document.body.append(container);
		root = createRoot(container);
		act(() => {
			root!.render(<Probe />);
		});

		const span = () => container!.querySelector('span')!;
		expect(span().dataset.phone).toBe('false');
		expect(span().dataset.tablet).toBe('false');
		expect(span().dataset.class).toBe('desktop');

		state = {phone: false, landscape: false, tablet: true};
		notify();
		expect(span().dataset.phone).toBe('false');
		expect(span().dataset.tablet).toBe('true');
		expect(span().dataset.class).toBe('tablet');

		state = {phone: true, landscape: false, tablet: false};
		notify();
		expect(span().dataset.phone).toBe('true');
		expect(span().dataset.tablet).toBe('false');
		expect(span().dataset.class).toBe('phone-portrait');

		state = {phone: false, landscape: true, tablet: false};
		notify();
		expect(span().dataset.phone).toBe('true');
		expect(span().dataset.tablet).toBe('false');
		expect(span().dataset.class).toBe('phone-landscape');

		act(() => {
			root!.unmount();
		});
		root = undefined;
		expect(listeners.size).toBe(0);
	});
});
