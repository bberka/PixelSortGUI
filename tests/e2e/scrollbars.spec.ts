import {expect, test, type Locator, type Page} from '@playwright/test';
import type {AppRuntime} from '../../src/state/index.ts';
import {importSyntheticProject} from './seed.ts';

type RuntimeGlobal = {
	__psgRuntime?: AppRuntime;
};

const THEMES = ['light', 'dark'] as const;
const REST_MAX = 5;
const EXPANDED_MIN = 8;

async function openLongPanel(page: Page, theme: string): Promise<Locator> {
	await page.emulateMedia({colorScheme: theme as 'light' | 'dark'});
	await page.goto('/');
	await page.evaluate((value) => {
		globalThis.localStorage.setItem('psg:theme', value);
	}, theme);
	await page.reload();
	await importSyntheticProject(page, 'Scrollbar proof');
	await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime?.ready;
		if (booted?.status !== 'ready') {
			throw new Error(`Expected a ready boot, got ${booted?.status ?? 'none'}`);
		}

		await booted.bundle.store.getState().addEffect('pixelSort');
	});
	const area = page
		.locator('[data-slot="scroll-area"]')
		.filter({hasText: 'Blend & Mix'});
	await expect(area).toBeVisible();
	return area;
}

async function widthOf(locator: Locator): Promise<number> {
	return locator.evaluate((element) => element.getBoundingClientRect().width);
}

async function contentWidth(area: Locator): Promise<number> {
	return area
		.locator('[data-slot="scroll-area-viewport"] > div')
		.evaluate((element) => element.getBoundingClientRect().width);
}

async function farCorner(page: Page): Promise<void> {
	await page.mouse.move(2, 2);
}

for (const theme of THEMES) {
	test.describe(`overlay scrollbar, ${theme} theme`, () => {
		test('is a thin overlay thumb that widens only while dragged', async ({
			page,
		}) => {
			const area = await openLongPanel(page, theme);
			const viewport = area.locator('[data-slot="scroll-area-viewport"]');
			const scrollbar = area.locator('[data-slot="scroll-area-scrollbar"]');
			const thumb = area.locator('[data-slot="scroll-area-thumb"]');

			const areaBox = await area.boundingBox();
			if (!areaBox) {
				throw new Error('Panel has no box');
			}

			const idleContentWidth = await contentWidth(area);

			await page.mouse.move(areaBox.x + 20, areaBox.y + 20);
			await expect(thumb).toBeVisible();
			await expect(scrollbar).toHaveCSS('opacity', '1');
			const restWidth = await widthOf(thumb);
			expect(restWidth).toBeLessThanOrEqual(REST_MAX);
			expect(await widthOf(scrollbar)).toBeGreaterThanOrEqual(12);
			await expect(scrollbar).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
			expect(await contentWidth(area)).toBe(idleContentWidth);
			expect(
				await viewport.evaluate(
					(element) =>
						element.getBoundingClientRect().width - element.clientWidth,
				),
			).toBe(0);

			const scrollTopBefore = await viewport.evaluate(
				(element) => element.scrollTop,
			);
			const thumbBox = await thumb.boundingBox();
			if (!thumbBox) {
				throw new Error('Thumb has no box');
			}

			const grabX = thumbBox.x + thumbBox.width / 2;
			const grabY = thumbBox.y + thumbBox.height / 2;
			await page.mouse.move(grabX, grabY);
			await page.mouse.down();
			await page.mouse.move(grabX, grabY + 60, {steps: 6});

			await expect
				.poll(() => widthOf(thumb), {message: 'thumb width while dragging'})
				.toBeGreaterThanOrEqual(EXPANDED_MIN);
			test.info().annotations.push({
				type: 'thumb width',
				description: `rest ${restWidth} px, dragging ${await widthOf(thumb)} px`,
			});
			expect(
				await viewport.evaluate((element) => element.scrollTop),
			).toBeGreaterThan(scrollTopBefore);
			expect(await contentWidth(area)).toBe(idleContentWidth);

			await page.mouse.up();
			await farCorner(page);

			await expect
				.poll(() => widthOf(thumb), {message: 'thumb width after the drag'})
				.toBeLessThanOrEqual(REST_MAX);
			await expect(scrollbar).toHaveCSS('opacity', '0');
			expect(await contentWidth(area)).toBe(idleContentWidth);
		});

		test('thumb colour has 3:1 contrast against the surface behind it', async ({
			page,
		}) => {
			const area = await openLongPanel(page, theme);
			const box = await area.boundingBox();
			if (!box) {
				throw new Error('Panel has no box');
			}

			await page.mouse.move(box.x + 20, box.y + 20);
			const ratio = await area
				.locator('[data-slot="scroll-area-thumb"]')
				.evaluate((thumb) => {
					const parse = (value: string): number[] =>
						(value.match(/[\d.]+/g) ?? []).map(Number);
					const channel = (value: number): number => {
						const unit = value / 255;
						return unit <= 0.03928
							? unit / 12.92
							: ((unit + 0.055) / 1.055) ** 2.4;
					};

					const luminance = ([red, green, blue]: number[]): number =>
						0.2126 * channel(red) +
						0.7152 * channel(green) +
						0.0722 * channel(blue);
					let surface: HTMLElement | null = thumb.parentElement;
					let colour = parse(
						getComputedStyle(surface ?? thumb).backgroundColor,
					);
					while (surface && (colour.length === 3 ? false : colour[3] === 0)) {
						surface = surface.parentElement;
						colour = parse(getComputedStyle(surface ?? thumb).backgroundColor);
					}

					const front = luminance(
						parse(getComputedStyle(thumb).backgroundColor),
					);
					const back = luminance(colour);
					return (
						(Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05)
					);
				});
			expect(ratio).toBeGreaterThanOrEqual(3);
		});
	});
}
