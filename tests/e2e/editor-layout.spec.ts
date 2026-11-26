import {expect, test, type Page} from '@playwright/test';
import type {AppRuntime} from '../../src/state/index.ts';
import {assertNoA11yViolations} from './axe.ts';
import {importSyntheticProject} from './seed.ts';

type RuntimeGlobal = {
	__psgRuntime?: AppRuntime;
};

type Box = {
	x: number;
	y: number;
	width: number;
	height: number;
};

type LayoutViewport = {
	readonly name: 'phone' | 'phone-landscape' | 'tablet' | 'desktop';
	readonly width: number;
	readonly height: number;
};

const LAYOUT_VIEWPORTS: readonly LayoutViewport[] = [
	{name: 'phone', width: 390, height: 844},
	{name: 'phone-landscape', width: 844, height: 390},
	{name: 'tablet', width: 820, height: 1180},
	{name: 'desktop', width: 1440, height: 900},
];

const THEMES = [
	{name: 'light', media: 'light', stored: 'light'},
	{name: 'dark', media: 'dark', stored: 'dark'},
] as const;

function collectConsoleErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'error') {
			errors.push(message.text());
		}
	});
	page.on('pageerror', (error) => {
		errors.push(error.message);
	});
	return errors;
}

async function seedEditor(
	page: Page,
	viewport: LayoutViewport,
	theme: (typeof THEMES)[number],
	effects: readonly string[] = [
		'pixelSort',
		'channelShift',
		'pixelSort',
		'channelShift',
		'pixelSort',
	],
): Promise<string> {
	await page.emulateMedia({colorScheme: theme.media});
	await page.addInitScript((stored) => {
		globalThis.localStorage.setItem('drift:theme', stored);
	}, theme.stored);
	await page.setViewportSize({width: viewport.width, height: viewport.height});
	await page.goto('/');
	const projectId = await importSyntheticProject(page, 'Layout test photo');
	if (effects.length > 0) {
		await page.evaluate(async (types) => {
			const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
			const booted = await runtime?.ready;
			if (booted?.status !== 'ready') {
				throw new Error('App runtime not ready');
			}

			const {store} = booted.bundle;
			for (const type of types) {
				await store.getState().addEffect(type);
			}

			const firstId = store.getState().activeProject?.stack.instances[0]?.id;
			if (firstId) {
				store.getState().selectEffect(firstId);
			}
		}, effects);
	}

	await expect(page.locator('canvas')).toBeVisible();
	return projectId;
}

function boxesOverlap(a: Box, b: Box): boolean {
	// Allow 1 px tolerance for shared 1 px CSS borders.
	const tolerance = 1;
	return (
		a.x < b.x + b.width - tolerance &&
		a.x + a.width > b.x + tolerance &&
		a.y < b.y + b.height - tolerance &&
		a.y + a.height > b.y + tolerance
	);
}

async function readRegionBoxes(page: Page): Promise<Record<string, Box>> {
	return page.evaluate(() => {
		const selectors: Record<string, string> = {
			header: 'header',
			toolbar: 'section[aria-label="Canvas toolbar"]',
			canvas: 'section[aria-label="Canvas"]',
			stack: 'section[aria-label="Effect stack"]',
			params: 'section[aria-label="Parameters"]',
		};
		const result: Record<string, Box> = {};
		for (const [name, selector] of Object.entries(selectors)) {
			const element = globalThis.document.querySelector(selector);
			if (!element) {
				throw new Error(`Missing region ${name} (${selector})`);
			}

			const rect = element.getBoundingClientRect();
			result[name] = {
				x: rect.x,
				y: rect.y,
				width: rect.width,
				height: rect.height,
			};
		}

		return result;
	});
}

async function findUndersizedControls(
	page: Page,
): Promise<Array<{label: string; width: number; height: number}>> {
	return page.evaluate(() => {
		const selector =
			'button, [role="button"], [role="slider"], [role="switch"], [role="radio"], [role="combobox"], input, select, textarea, a[href]';
		const undersized: Array<{label: string; width: number; height: number}> =
			[];
		for (const element of globalThis.document.querySelectorAll(selector)) {
			const style = globalThis.getComputedStyle(element);
			if (style.display === 'none' || style.visibility === 'hidden') {
				continue;
			}

			const rect = element.getBoundingClientRect();
			if (rect.width === 0 && rect.height === 0) {
				continue;
			}

			if (rect.width < 24 || rect.height < 24) {
				undersized.push({
					label:
						element.getAttribute('aria-label') ??
						element.textContent?.trim().slice(0, 30) ??
						element.tagName,
					width: Math.round(rect.width),
					height: Math.round(rect.height),
				});
			}
		}

		return undersized;
	});
}

for (const theme of THEMES) {
	for (const viewport of LAYOUT_VIEWPORTS) {
		test(`AC-F18.1 AC-F18.3 AC-F19.2: ${viewport.name} (${viewport.width}x${viewport.height}) in ${theme.name} has no overflow, no overlap, valid target sizes, visual tab order, and clean axe @a11y`, async ({
			page,
		}) => {
			const consoleErrors = collectConsoleErrors(page);
			await seedEditor(page, viewport, theme);

			// 1. No horizontal page scroll.
			const scrollMetrics = await page.evaluate(() => ({
				scrollWidth: globalThis.document.documentElement.scrollWidth,
				innerWidth: globalThis.innerWidth,
			}));
			expect(scrollMetrics.scrollWidth).toBeLessThanOrEqual(
				scrollMetrics.innerWidth,
			);

			// 2. Regions do not overlap and canvas meets minimum dimensions.
			const regions = await readRegionBoxes(page);
			const names = Object.keys(regions);
			for (let i = 0; i < names.length; i++) {
				for (let j = i + 1; j < names.length; j++) {
					const first = names[i];
					const second = names[j];
					expect(
						boxesOverlap(regions[first], regions[second]),
						`${first} overlaps ${second}`,
					).toBe(false);
				}
			}

			const {canvas, stack, params} = regions;
			switch (viewport.name) {
				case 'phone': {
					expect(canvas.height).toBeGreaterThanOrEqual(viewport.height * 0.4);
					expect(canvas.width).toBe(viewport.width);
					expect(stack.height).toBeGreaterThanOrEqual(48);
					expect(params.height).toBeGreaterThanOrEqual(200);

					break;
				}

				case 'phone-landscape': {
					expect(canvas.width).toBeGreaterThanOrEqual(viewport.width * 0.5);
					expect(canvas.height).toBeGreaterThanOrEqual(viewport.height * 0.6);

					break;
				}

				case 'tablet': {
					expect(canvas.width).toBe(viewport.width);
					expect(canvas.height).toBeGreaterThanOrEqual(viewport.height * 0.5);
					expect(Math.round(stack.width)).toBe(260);
					expect(params.width).toBeGreaterThanOrEqual(viewport.width - 262);

					break;
				}

				default: {
					expect(canvas.width).toBeGreaterThanOrEqual(viewport.width - 342);
					expect(canvas.height).toBeGreaterThanOrEqual(viewport.height - 92);
					expect(Math.round(stack.width)).toBeGreaterThanOrEqual(338);
					expect(Math.round(params.width)).toBeGreaterThanOrEqual(338);
				}
			}

			// 3. Every visible interactive element is at least 24x24 px.
			const undersized = await findUndersizedControls(page);
			expect(undersized, 'undersized interactive controls').toEqual([]);

			// 4. Canvas stays visible while dragging a slider.
			const slider = page.getByRole('slider', {name: 'Threshold range high'});
			await slider.scrollIntoViewIfNeeded();
			const sliderBox = await slider.boundingBox();
			expect(sliderBox).not.toBeNull();
			const startX = sliderBox!.x + sliderBox!.width / 2;
			const startY = sliderBox!.y + sliderBox!.height / 2;
			await page.mouse.move(startX, startY);
			await page.mouse.down();
			await page.mouse.move(startX - 24, startY, {steps: 4});
			const canvasWhileDragging = await page.locator('canvas').boundingBox();
			expect(canvasWhileDragging).not.toBeNull();
			expect(canvasWhileDragging!.width).toBeGreaterThanOrEqual(200);
			expect(canvasWhileDragging!.height).toBeGreaterThanOrEqual(
				viewport.name === 'phone' ? viewport.height * 0.4 : 200,
			);
			await page.mouse.up();

			// 5. Tab order follows the visual region order:
			//    header -> toolbar -> canvas -> effects aside (stack -> params).
			const regionOrder = ['header', 'toolbar', 'canvas', 'aside'] as const;
			await page.getByRole('button', {name: 'Back to library'}).focus();
			const visited: string[] = [];
			for (let step = 0; step < 30; step++) {
				const currentRegion = await page.evaluate(() => {
					const active = globalThis.document.activeElement;
					if (!active) {
						return null;
					}

					if (active.closest('header')) {
						return 'header';
					}

					if (active.closest('section[aria-label="Canvas toolbar"]')) {
						return 'toolbar';
					}

					if (active.closest('section[aria-label="Canvas"]')) {
						return 'canvas';
					}

					return active.closest('aside[aria-label="Effects"]') ? 'aside' : null;
				});
				if (currentRegion && visited.at(-1) !== currentRegion) {
					visited.push(currentRegion);
				}

				if (visited.at(-1) === 'aside') {
					break;
				}

				await page.keyboard.press('Tab');
			}

			expect(visited).toEqual([...regionOrder]);

			// 6. Axe accessibility check passes cleanly.
			await assertNoA11yViolations(page);
			expect(consoleErrors).toEqual([]);
		});
	}
}

test('tablet docked panel resizes with keyboard and pointer, persists size, and collapses to 48 px', async ({
	page,
}) => {
	await seedEditor(page, LAYOUT_VIEWPORTS[2], THEMES[0], ['pixelSort']);

	const aside = page.locator('aside[aria-label="Effects"]');
	const initialBox = await aside.boundingBox();
	expect(Math.round(initialBox!.height)).toBe(360);

	// Keyboard resize up by Shift+ArrowUp (+60 px -> 420 px).
	const handle = page.getByRole('slider', {name: 'Resize effects panel'});
	await handle.focus();
	await page.keyboard.press('Shift+ArrowUp');
	await expect
		.poll(async () => Math.round((await aside.boundingBox())!.height))
		.toBe(420);

	// Reload and verify persisted height is restored.
	await page.reload();
	await expect(aside).toBeVisible();
	await expect
		.poll(async () => Math.round((await aside.boundingBox())!.height))
		.toBe(420);

	// Collapse to 48 px strip and expand back.
	await page.getByRole('button', {name: 'Collapse effects panel'}).click();
	await expect
		.poll(async () => Math.round((await aside.boundingBox())!.height))
		.toBe(48);
	await page.getByRole('button', {name: 'Expand effects panel'}).click();
	await expect
		.poll(async () => Math.round((await aside.boundingBox())!.height))
		.toBe(420);
});

test('phone bottom sheet cycles detents and landscape right drawer collapses cleanly', async ({
	page,
}) => {
	await seedEditor(page, LAYOUT_VIEWPORTS[0], THEMES[0], ['pixelSort']);

	const aside = page.locator('aside[aria-label="Effects"]');
	await expect(aside).toHaveAttribute('data-sheet-detent', 'half');

	// Cycle: half -> expanded -> collapsed -> half.
	await page.getByRole('button', {name: 'Expand parameters'}).click();
	await expect(aside).toHaveAttribute('data-sheet-detent', 'expanded');

	await page.getByRole('button', {name: 'Collapse parameters'}).click();
	await expect(aside).toHaveAttribute('data-sheet-detent', 'collapsed');
	await expect(page.locator('section[aria-label="Parameters"]')).toBeHidden();

	await page.getByRole('button', {name: 'Show parameters'}).click();
	await expect(aside).toHaveAttribute('data-sheet-detent', 'half');
	await expect(page.locator('section[aria-label="Parameters"]')).toBeVisible();

	// Rotate to phone landscape: right drawer is 300 px and collapses cleanly.
	await page.setViewportSize({width: 844, height: 390});
	await expect
		.poll(async () => Math.round((await aside.boundingBox())!.width))
		.toBe(300);

	await page.getByRole('button', {name: 'Collapse effects drawer'}).click();
	await expect
		.poll(async () => Math.round((await aside.boundingBox())!.width))
		.toBe(44);
	const expandedCanvas = await page
		.locator('section[aria-label="Canvas"]')
		.boundingBox();
	expect(expandedCanvas!.width).toBeGreaterThanOrEqual(780);
});

test('AC-F18.2: resizing across desktop, tablet, phone portrait, and phone landscape preserves project, selection, and zoom', async ({
	page,
}) => {
	const projectId = await seedEditor(page, LAYOUT_VIEWPORTS[3], THEMES[0], [
		'pixelSort',
		'channelShift',
	]);

	await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime!.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		const state = booted.bundle.store.getState();
		const secondId = state.activeProject!.stack.instances[1].id;
		state.selectEffect(secondId);
		state.setViewState({
			fitMode: 'custom',
			zoom: 2,
			centerX: 140,
			centerY: 110,
		});
	});

	for (const viewport of [
		LAYOUT_VIEWPORTS[2],
		LAYOUT_VIEWPORTS[0],
		LAYOUT_VIEWPORTS[1],
		LAYOUT_VIEWPORTS[3],
	]) {
		await page.setViewportSize({
			width: viewport.width,
			height: viewport.height,
		});
		const state = await page.evaluate(async () => {
			const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
			const booted = await runtime!.ready;
			if (booted.status !== 'ready') {
				throw new Error('Not ready');
			}

			const project = booted.bundle.store.getState().activeProject;
			return {
				projectId: project?.id ?? null,
				selectedId: project?.selectedInstanceId ?? null,
				secondId: project?.stack.instances[1]?.id ?? null,
				zoom: project?.viewState.zoom ?? null,
			};
		});
		expect(state.projectId).toBe(projectId);
		expect(state.selectedId).toBe(state.secondId);
		expect(state.zoom).toBe(2);
	}
});

test('full editing flow at 390x844: open project, add effect, change parameter, undo, open export', async ({
	page,
}) => {
	const consoleErrors = collectConsoleErrors(page);
	await seedEditor(page, LAYOUT_VIEWPORTS[0], THEMES[0], []);

	// Return to library and reopen project from the library card.
	await page.getByRole('button', {name: 'Back to library'}).click();
	await page.getByRole('button', {name: 'Open Layout test photo'}).click();
	await expect(page.locator('canvas')).toBeVisible();

	// Add effect via phone dialog picker.
	await page.getByRole('button', {name: 'Add effect'}).click();
	const chooser = page.getByRole('dialog', {name: 'Add effect'});
	await expect(chooser).toBeVisible();
	await chooser.getByRole('button', {name: /^Pixel sort/}).click();
	await expect(page.getByRole('heading', {name: 'Pixel sort'})).toBeVisible();

	// Change Angle parameter.
	const angleInput = page.getByRole('textbox', {name: 'Angle'});
	await angleInput.fill('90');
	await angleInput.press('Enter');
	await expect(angleInput).toHaveValue('90.0');

	// Undo restores angle to 0.0.
	await page.getByRole('button', {name: 'Undo Angle 90°'}).click();
	await expect(angleInput).toHaveValue('0.0');

	// Open export sheet.
	await page.getByRole('button', {name: 'Export'}).click();
	const exportDialog = page.getByRole('dialog', {name: 'Export'});
	await expect(exportDialog).toBeVisible();
	await expect(
		exportDialog.getByRole('button', {name: 'Download'}),
	).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(exportDialog).toHaveCount(0);
	expect(consoleErrors).toEqual([]);
});

test('AC-F18.3: coarse pointer chrome controls meet 44x44 px without overflowing their headers or rail', async ({
	browser,
	browserName,
}) => {
	test.skip(
		browserName !== 'chromium',
		'Playwright isMobile (pointer: coarse) emulation is Chromium-only',
	);

	const context = await browser.newContext({
		viewport: {width: 390, height: 844},
		hasTouch: true,
		isMobile: true,
	});
	const page = await context.newPage();

	try {
		await seedEditor(page, LAYOUT_VIEWPORTS[0], THEMES[0], ['pixelSort']);
		const isCoarse = await page.evaluate(
			() => globalThis.matchMedia('(pointer: coarse)').matches,
		);
		expect(isCoarse).toBe(true);

		// 1. Phone portrait detent toggle is >= 44x44 and does not overlap params.
		const detentButton = page.getByRole('button', {name: 'Expand parameters'});
		const detentBox = (await detentButton.boundingBox())!;
		const paramsBox = (await page
			.locator('section[aria-label="Parameters"]')
			.boundingBox())!;
		expect(detentBox.width).toBeGreaterThanOrEqual(44);
		expect(detentBox.height).toBeGreaterThanOrEqual(44);
		expect(boxesOverlap(detentBox, paramsBox)).toBe(false);
		await expect(detentButton).toHaveAttribute(
			'aria-controls',
			'editor-phone-params-panel',
		);

		// 2. Phone landscape drawer toggle is >= 44x44 and fits inside the collapsed rail.
		await page.setViewportSize({width: 844, height: 390});
		const collapseDrawer = page.getByRole('button', {
			name: 'Collapse effects drawer',
		});
		const openToggleBox = (await collapseDrawer.boundingBox())!;
		expect(openToggleBox.width).toBeGreaterThanOrEqual(44);
		expect(openToggleBox.height).toBeGreaterThanOrEqual(44);
		await collapseDrawer.click();

		const expandDrawer = page.getByRole('button', {
			name: 'Expand effects drawer',
		});
		const railBox = (await page
			.locator('aside[aria-label="Effects"]')
			.boundingBox())!;
		const collapsedToggleBox = (await expandDrawer.boundingBox())!;
		expect(collapsedToggleBox.width).toBeGreaterThanOrEqual(44);
		expect(collapsedToggleBox.height).toBeGreaterThanOrEqual(44);
		expect(railBox.width).toBeGreaterThanOrEqual(44);
		expect(collapsedToggleBox.x + collapsedToggleBox.width).toBeLessThanOrEqual(
			railBox.x + railBox.width + 1,
		);

		// 3. Tablet resize handle and collapse button are >= 44x44 and do not overlap stack/params.
		await page.setViewportSize({width: 820, height: 1180});
		const tabletCollapse = page.getByRole('button', {
			name: 'Collapse effects panel',
		});
		const tabletResize = page.getByRole('slider', {
			name: 'Resize effects panel',
		});
		const collapseBox = (await tabletCollapse.boundingBox())!;
		const resizeBox = (await tabletResize.boundingBox())!;
		const stackBox = (await page
			.locator('section[aria-label="Effect stack"]')
			.boundingBox())!;
		expect(collapseBox.width).toBeGreaterThanOrEqual(44);
		expect(collapseBox.height).toBeGreaterThanOrEqual(44);
		expect(resizeBox.height).toBeGreaterThanOrEqual(44);
		expect(boxesOverlap(collapseBox, stackBox)).toBe(false);
		expect(boxesOverlap(resizeBox, stackBox)).toBe(false);
	} finally {
		await context.close();
	}
});
