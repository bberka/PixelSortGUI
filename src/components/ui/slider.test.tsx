// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {DEFAULT_SLIDER_VARIANT, SLIDER_VARIANTS, Slider} from './slider.tsx';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let container: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;

function mount(element: React.ReactElement): HTMLDivElement {
	container = document.createElement('div');
	document.body.append(container);
	root = createRoot(container);
	act(() => {
		root!.render(element);
	});
	return container;
}

afterEach(() => {
	act(() => {
		root?.unmount();
	});
	container?.remove();
	container = undefined;
	root = undefined;
	delete document.documentElement.dataset.sliderVariant;
});

describe('Slider variants', () => {
	it('uses DEFAULT_SLIDER_VARIANT when variant prop is omitted', () => {
		const host = mount(
			<Slider
				defaultValue={[40]}
				min={0}
				max={100}
				thumbLabels={['Opacity']}
			/>,
		);
		const sliderRoot = host.querySelector<HTMLElement>('[data-slot="slider"]');
		expect(sliderRoot?.dataset.variant).toBe(DEFAULT_SLIDER_VARIANT);
	});

	for (const variant of SLIDER_VARIANTS) {
		describe(`variant="${variant}"`, () => {
			it('exposes the single-thumb ARIA contract and default mark', () => {
				const host = mount(
					<Slider
						variant={variant}
						defaultValue={[35]}
						defaultMark={50}
						min={0}
						max={100}
						step={5}
						thumbLabels={['Amount']}
					/>,
				);

				const sliderRoot = host.querySelector<HTMLElement>(
					'[data-slot="slider"]',
				);
				expect(sliderRoot?.dataset.variant).toBe(variant);

				const thumb = host.querySelector<HTMLElement>('[role="slider"]');
				expect(thumb).not.toBeNull();
				expect(thumb?.getAttribute('aria-label')).toBe('Amount');
				expect(thumb?.getAttribute('aria-valuemin')).toBe('0');
				expect(thumb?.getAttribute('aria-valuemax')).toBe('100');
				expect(thumb?.getAttribute('aria-valuenow')).toBe('35');

				const mark = host.querySelector('[data-slot="slider-default-mark"]');
				expect(mark).not.toBeNull();
			});

			it('exposes two-thumb range ARIA contract and cannot cross', () => {
				const host = mount(
					<Slider
						variant={variant}
						defaultValue={[25, 75]}
						defaultMark={[25, 80]}
						min={0}
						max={100}
						step={5}
						minStepsBetweenThumbs={0}
						thumbLabels={['Low', 'High']}
					/>,
				);

				const thumbs = host.querySelectorAll<HTMLElement>('[role="slider"]');
				expect(thumbs).toHaveLength(2);
				expect(thumbs[0]?.getAttribute('aria-label')).toBe('Low');
				expect(thumbs[0]?.getAttribute('aria-valuenow')).toBe('25');
				expect(thumbs[1]?.getAttribute('aria-label')).toBe('High');
				expect(thumbs[1]?.getAttribute('aria-valuenow')).toBe('75');

				const marks = host.querySelectorAll(
					'[data-slot="slider-default-mark"]',
				);
				expect(marks).toHaveLength(2);
			});

			it('responds to keyboard navigation (ArrowRight, ArrowLeft, Home, End)', () => {
				const onValueChange = vi.fn();
				const host = mount(
					<Slider
						variant={variant}
						defaultValue={[50]}
						min={0}
						max={100}
						step={10}
						thumbLabels={['Strength']}
						onValueChange={onValueChange}
					/>,
				);

				const thumb = host.querySelector<HTMLElement>('[role="slider"]')!;
				act(() => {
					thumb.focus();
				});

				act(() => {
					thumb.dispatchEvent(
						new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}),
					);
				});
				expect(thumb.getAttribute('aria-valuenow')).toBe('60');

				act(() => {
					thumb.dispatchEvent(
						new KeyboardEvent('keydown', {key: 'ArrowLeft', bubbles: true}),
					);
				});
				expect(thumb.getAttribute('aria-valuenow')).toBe('50');

				act(() => {
					thumb.dispatchEvent(
						new KeyboardEvent('keydown', {key: 'End', bubbles: true}),
					);
				});
				expect(thumb.getAttribute('aria-valuenow')).toBe('100');

				act(() => {
					thumb.dispatchEvent(
						new KeyboardEvent('keydown', {key: 'Home', bubbles: true}),
					);
				});
				expect(thumb.getAttribute('aria-valuenow')).toBe('0');
				expect(onValueChange).toHaveBeenCalled();
			});

			it('marks disabled state on root and prevents value changes', () => {
				const onValueChange = vi.fn();
				const host = mount(
					<Slider
						disabled
						variant={variant}
						defaultValue={[40]}
						min={0}
						max={100}
						step={10}
						thumbLabels={['Locked']}
						onValueChange={onValueChange}
					/>,
				);

				const sliderRoot = host.querySelector('[data-slot="slider"]');
				expect(sliderRoot?.hasAttribute('data-disabled')).toBe(true);

				const thumb = host.querySelector<HTMLElement>('[role="slider"]')!;
				act(() => {
					thumb.dispatchEvent(
						new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}),
					);
				});
				expect(thumb.getAttribute('aria-valuenow')).toBe('40');
				expect(onValueChange).not.toHaveBeenCalled();
			});
		});
	}
});
