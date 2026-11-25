// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {ScrollArea} from './scroll-area.tsx';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let root: Root | undefined;
let host: HTMLElement | undefined;

function render(element: React.ReactElement): HTMLElement {
	host = document.createElement('div');
	document.body.append(host);
	root = createRoot(host);
	act(() => {
		root?.render(element);
	});
	return host;
}

afterEach(() => {
	act(() => {
		root?.unmount();
	});
	host?.remove();
	root = undefined;
	host = undefined;
	vi.useRealTimers();
});

function viewportOf(container: HTMLElement): HTMLElement {
	const viewport = container.querySelector<HTMLElement>(
		'[data-slot="scroll-area-viewport"]',
	);
	if (!viewport) {
		throw new Error('Viewport not rendered');
	}

	return viewport;
}

describe('ScrollArea', () => {
	it('renders its children inside the viewport', () => {
		const container = render(
			<ScrollArea>
				<p>Long content</p>
			</ScrollArea>,
		);

		expect(viewportOf(container).textContent).toBe('Long content');
	});

	it('scrolls its viewport and marks the area as scrolling for a moment', () => {
		vi.useFakeTimers();
		const container = render(
			<ScrollArea>
				<p>Long content</p>
			</ScrollArea>,
		);
		const viewport = viewportOf(container);
		const area = container.querySelector('[data-slot="scroll-area"]');

		act(() => {
			viewport.scrollTop = 120;
			viewport.dispatchEvent(new Event('scroll'));
		});
		expect(viewport.scrollTop).toBe(120);
		expect(area?.hasAttribute('data-scrolling')).toBe(true);

		act(() => {
			vi.advanceTimersByTime(1000);
		});
		expect(area?.hasAttribute('data-scrolling')).toBe(false);
	});

	it('renders no arrow buttons and no extra focusable element', () => {
		const container = render(
			<ScrollArea orientation="both">
				<p>Long content</p>
			</ScrollArea>,
		);

		expect(container.querySelectorAll('button, [role="button"]')).toHaveLength(
			0,
		);
		expect(container.querySelectorAll('[tabindex]')).toHaveLength(1);
	});

	it('keeps the viewport as a tab stop by default so the keyboard can scroll', () => {
		const container = render(
			<ScrollArea>
				<p>Long content</p>
			</ScrollArea>,
		);

		expect(viewportOf(container).tabIndex).toBe(0);
	});

	it('adds no tab stop when the browser decides focus, as for a plain overflow element', () => {
		const container = render(
			<ScrollArea tabStop={false}>
				<p>Long content</p>
			</ScrollArea>,
		);

		expect(viewportOf(container).hasAttribute('tabindex')).toBe(false);
	});
});
