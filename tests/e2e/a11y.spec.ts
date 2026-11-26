import {expect, test, type Locator, type Page} from '@playwright/test';
import type {AppRuntime} from '../../src/state/index.ts';
import {assertNoA11yViolations} from './axe.ts';
import {seedLibraryProjects} from './library-seed.ts';
import {importSyntheticProject} from './seed.ts';
import {DESKTOP_VIEWPORT, PROOF_VIEWPORTS} from './viewports.ts';

type RuntimeGlobal = {
	__psgRuntime?: AppRuntime;
};

const THEMES = [
	{
		name: 'light',
		media: 'light',
		stored: 'light',
		expectedBackground: 'rgb(250, 250, 250)',
	},
	{
		name: 'true-black',
		media: 'dark',
		stored: 'dark',
		expectedBackground: 'rgb(0, 0, 0)',
	},
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

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
	const overflow = await page.evaluate(
		() =>
			globalThis.document.documentElement.scrollWidth -
			globalThis.document.documentElement.clientWidth,
	);
	expect(overflow).toBeLessThanOrEqual(0);
}

/**
 Moves keyboard focus with `Tab` (or `Shift+Tab`) until `target` becomes the
 active element. Fails if the target is not reachable within `maxTabs` presses.
 */
async function tabTo(
	page: Page,
	target: Locator,
	options: {direction?: 'forward' | 'backward'; maxTabs?: number} = {},
): Promise<void> {
	const {direction = 'forward', maxTabs = 100} = options;
	const key = direction === 'backward' ? 'Shift+Tab' : 'Tab';
	const handle = await target.elementHandle();
	if (!handle) {
		throw new Error('Target element is not attached');
	}

	try {
		for (let step = 0; step < maxTabs; step++) {
			const isFocused = await page.evaluate(
				(element) => globalThis.document.activeElement === element,
				handle,
			);
			if (isFocused) {
				return;
			}

			await page.keyboard.press(key);
		}

		const activeDescription = await page.evaluate(() => {
			const el = globalThis.document.activeElement;
			return el
				? `${el.tagName.toLowerCase()}[aria-label="${el.getAttribute('aria-label') ?? ''}"] "${el.textContent?.trim().slice(0, 40) ?? ''}"`
				: 'null';
		});
		throw new Error(
			`Could not reach target within ${maxTabs} ${key} presses; last active element: ${activeDescription}`,
		);
	} finally {
		await handle.dispose();
	}
}

async function waitForTransitions(page: Page): Promise<void> {
	await page.evaluate(async () => {
		const animations = globalThis.document.getAnimations();
		await Promise.allSettled(
			animations.map(async (animation) => animation.finished),
		);
	});
}

async function assertVisibleFocusIndicator(page: Page): Promise<void> {
	const indicator = await page.evaluate(() => {
		const el = globalThis.document.activeElement;
		if (!el || !(el instanceof globalThis.HTMLElement)) {
			return null;
		}

		const style = globalThis.getComputedStyle(el);
		return {
			matchesFocusVisible: el.matches(':focus-visible'),
			outlineStyle: style.outlineStyle,
			outlineWidth: Number.parseFloat(style.outlineWidth),
			boxShadow: style.boxShadow,
		};
	});
	expect(indicator).not.toBeNull();
	expect(indicator?.matchesFocusVisible).toBe(true);
	const hasOutline =
		indicator !== null &&
		indicator.outlineStyle !== 'none' &&
		indicator.outlineWidth >= 2;
	const hasShadow = indicator !== null && indicator.boxShadow !== 'none';
	expect(hasOutline || hasShadow).toBe(true);
}

test.describe('Accessibility suite (T6.2) @a11y', () => {
	for (const theme of THEMES) {
		for (const viewport of PROOF_VIEWPORTS) {
			test(`AC-F14.3 AC-F19.2: Library, Settings, Editor (active effects + split), and Export are axe-clean in ${theme.name} at ${viewport.name} (${viewport.width}x${viewport.height}) @a11y`, async ({
				page,
			}) => {
				const errors = collectConsoleErrors(page);
				await page.emulateMedia({colorScheme: theme.media});
				await page.addInitScript((stored) => {
					globalThis.localStorage.setItem('psg:theme', stored);
				}, theme.stored);
				await page.setViewportSize({
					width: viewport.width,
					height: viewport.height,
				});
				await page.goto('/');

				await seedLibraryProjects(page, ['A11y Sunset', 'A11y Glitch']);
				await expect(
					page.getByRole('button', {name: 'Open A11y Sunset'}),
				).toBeVisible();

				const background = await page.evaluate(
					() =>
						globalThis.getComputedStyle(globalThis.document.body)
							.backgroundColor,
				);
				expect(background).toBe(theme.expectedBackground);

				// 1. Library surface
				await assertNoHorizontalOverflow(page);
				await assertNoA11yViolations(page);

				// 2. Settings dialog
				const settingsButton = page.getByRole('button', {name: 'Settings'});
				await settingsButton.click();
				const settingsDialog = page.getByRole('dialog', {name: 'Settings'});
				await expect(settingsDialog).toBeVisible();
				await assertNoA11yViolations(page);
				await page.keyboard.press('Escape');
				await expect(settingsDialog).toBeHidden();
				await expect(settingsButton).toBeFocused();

				// 3. Editor surface with active effects + split compare view
				await page.getByRole('button', {name: 'Open A11y Sunset'}).click();
				await expect(page.locator('canvas')).toBeVisible();
				await page.evaluate(async () => {
					const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
					const booted = await runtime?.ready;
					if (booted?.status !== 'ready') {
						throw new Error('App runtime not ready');
					}

					const {store} = booted.bundle;
					const first = await store.getState().addEffect('pixelSort');
					await store.getState().addEffect('channelShift');
					store.getState().selectEffect(first.id);
					await store.getState().setCompareMode('split');
				});
				await expect(page.getByRole('separator')).toBeVisible();
				await waitForTransitions(page);
				await assertNoHorizontalOverflow(page);
				await assertNoA11yViolations(page);

				// 4. Export dialog
				await page.getByRole('button', {name: 'Export'}).click();
				const exportDialog = page.getByRole('dialog', {name: 'Export'});
				await expect(exportDialog).toBeVisible();
				await assertNoA11yViolations(page);
				await page.keyboard.press('Escape');
				await expect(exportDialog).toBeHidden();

				expect(errors).toEqual([]);
			});
		}
	}

	test('AC-F19.1: full keyboard-only core loop completes with zero mouse clicks, visible focus, and no focus traps @a11y', async ({
		page,
	}) => {
		const errors = collectConsoleErrors(page);
		await page.setViewportSize(DESKTOP_VIEWPORT);
		await page.goto('/');
		await seedLibraryProjects(page, ['Keyboard Photo']);

		const openCard = page.getByRole('button', {name: 'Open Keyboard Photo'});
		await expect(openCard).toBeVisible();

		// 1. Open project from Library with keyboard only
		await tabTo(page, openCard);
		await assertVisibleFocusIndicator(page);
		await page.keyboard.press('Enter');
		await expect(page.locator('canvas')).toBeVisible();

		// 2. Add two effects via keyboard
		const effectPickerButton = page.getByRole('button', {name: 'Add effect'});
		await expect(effectPickerButton).toBeVisible();
		await tabTo(page, effectPickerButton);
		await assertVisibleFocusIndicator(page);
		await page.keyboard.press('Enter');

		const pixelSortOption = page.getByRole('button', {name: /pixel sort/i});
		await expect(pixelSortOption).toBeVisible();
		await tabTo(page, pixelSortOption);
		await page.keyboard.press('Enter');
		await expect(page.locator('li[data-index]')).toHaveCount(1);

		await tabTo(page, effectPickerButton);
		await page.keyboard.press('Enter');
		const channelShiftOption = page.getByRole('button', {
			name: /channel shift/i,
		});
		await expect(channelShiftOption).toBeVisible();
		await tabTo(page, channelShiftOption);
		await page.keyboard.press('Enter');
		await expect(page.locator('li[data-index]')).toHaveCount(2);

		// 3. Reorder effect with Alt+ArrowUp and Alt+ArrowDown
		const secondRowButton = page.locator('li[data-index="1"] button').first();
		await tabTo(page, secondRowButton);
		await assertVisibleFocusIndicator(page);
		await page.keyboard.press('Alt+ArrowUp');
		await expect(page.locator('li[data-index="0"]')).toContainText(
			'Channel shift',
		);
		await expect(page.locator('li[data-index="1"]')).toContainText(
			'Pixel sort',
		);

		await page.keyboard.press('Alt+ArrowDown');
		await expect(page.locator('li[data-index="0"]')).toContainText(
			'Pixel sort',
		);
		await expect(page.locator('li[data-index="1"]')).toContainText(
			'Channel shift',
		);

		// 4. Adjust a parameter with keyboard and wait for burst commit
		const slider = page
			.locator(
				'[data-slot="slider-thumb"], input[type="range"], [role="slider"]',
			)
			.first();
		await expect(slider).toBeVisible();
		await tabTo(page, slider);
		await assertVisibleFocusIndicator(page);
		const beforeValue = await slider.getAttribute('aria-valuenow');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		await expect
			.poll(async () => slider.getAttribute('aria-valuenow'))
			.not.toBe(beforeValue);
		const afterValue = await slider.getAttribute('aria-valuenow');

		// Wait past the 500 ms keyboard commit burst window
		await page.waitForTimeout(650);

		// 5. Undo and Redo via keyboard
		const undoButton = page.getByRole('button', {name: /^Undo/});
		const redoButton = page.getByRole('button', {name: /^Redo/});
		await expect(undoButton).toBeEnabled();
		await page.keyboard.press('Control+z');
		await expect
			.poll(async () => slider.getAttribute('aria-valuenow'))
			.toBe(beforeValue);
		await expect(redoButton).toBeEnabled();

		await page.keyboard.press('Control+Shift+z');
		await expect
			.poll(async () => slider.getAttribute('aria-valuenow'))
			.toBe(afterValue);

		// 6. Toggle Compare (\) and Split (S)
		await page.keyboard.press('Backslash');
		await expect(page.getByText('Original', {exact: true})).toBeVisible();
		await page.keyboard.press('Backslash');
		await expect(page.getByText('Original', {exact: true})).toBeHidden();

		await page.keyboard.press('s');
		const splitDivider = page.getByRole('separator');
		await expect(splitDivider).toBeVisible();
		const splitBefore = Number(
			await splitDivider.getAttribute('aria-valuenow'),
		);
		await tabTo(page, splitDivider, {direction: 'backward'});
		await assertVisibleFocusIndicator(page);
		await page.keyboard.press('ArrowRight');
		await expect
			.poll(async () =>
				Number(await splitDivider.getAttribute('aria-valuenow')),
			)
			.toBeGreaterThan(splitBefore);
		await page.keyboard.press('s');
		await expect(splitDivider).toBeHidden();

		// 7. Open Export dialog via keyboard, verify focus enters dialog, close with Escape, verify focus returns
		const exportButton = page.getByRole('button', {name: 'Export'});
		await tabTo(page, exportButton, {direction: 'backward'});
		await assertVisibleFocusIndicator(page);
		await page.keyboard.press('Enter');

		const exportDialog = page.getByRole('dialog', {name: 'Export'});
		await expect(exportDialog).toBeVisible();
		const focusInsideExport = await page.evaluate(() => {
			const dialog = globalThis.document.querySelector('[role="dialog"]');
			return Boolean(dialog?.contains(globalThis.document.activeElement));
		});
		expect(focusInsideExport).toBe(true);

		await page.keyboard.press('Escape');
		await expect(exportDialog).toBeHidden();
		await expect(exportButton).toBeFocused();

		expect(errors).toEqual([]);
	});

	test('AC-F19.3: polite live region announces stack changes, undo/redo, presets, and export status @a11y', async ({
		page,
	}) => {
		const errors = collectConsoleErrors(page);
		await page.setViewportSize(DESKTOP_VIEWPORT);
		await page.goto('/');
		await importSyntheticProject(page, 'Live Region Photo');
		await expect(page.locator('canvas')).toBeVisible();

		const status = page.getByRole('status', {name: 'Status messages'});
		await expect(status).toHaveAttribute('aria-live', 'polite');
		await expect(status).toHaveAttribute('aria-atomic', 'true');

		// Add effect
		await page.getByRole('button', {name: 'Add effect'}).click();
		await page.getByRole('button', {name: /pixel sort/i}).click();
		await expect(status).toHaveText('Added Pixel sort');

		// Add second effect
		await page.getByRole('button', {name: 'Add effect'}).click();
		await page.getByRole('button', {name: /channel shift/i}).click();
		await expect(status).toHaveText('Added Channel shift');

		// Reorder via keyboard
		const secondRowButton = page.locator('li[data-index="1"] button').first();
		await secondRowButton.focus();
		await page.keyboard.press('Alt+ArrowUp');
		await expect(status).toHaveText('Moved Channel shift to position 1 of 2');

		// Remove via row menu (and verify focus moves to remaining row)
		await page.getByRole('button', {name: 'Channel shift actions'}).click();
		await page.getByRole('menuitem', {name: 'Remove'}).click();
		await expect(status).toHaveText('Removed Channel shift');

		// Undo & Redo
		await page.keyboard.press('Control+z');
		await expect(status).toHaveText(/^Undid /);
		await page.keyboard.press('Control+Shift+z');
		await expect(status).toHaveText(/^Redid /);

		// Apply preset
		await page.getByRole('button', {name: 'Presets'}).click();
		await page.getByRole('button', {name: /^asdf classic/i}).click();
		const replaceDialog = page.getByRole('alertdialog');
		if (await replaceDialog.isVisible()) {
			await replaceDialog.getByRole('button', {name: 'Replace'}).click();
		}

		await expect(status).toHaveText('Applied preset ASDF classic');

		// Export
		await page.getByRole('button', {name: 'Export'}).click();
		const exportDialog = page.getByRole('dialog', {name: 'Export'});
		await expect(exportDialog).toBeVisible();
		const downloadPromise = page.waitForEvent('download');
		await exportDialog.getByRole('button', {name: 'Download'}).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(/\.png$/);
		await expect(status).toHaveText(/^Export finished: /);

		expect(errors).toEqual([]);
	});

	test('AC-F19.4: prefers-reduced-motion suppresses CSS transitions and animations @a11y', async ({
		page,
	}) => {
		const errors = collectConsoleErrors(page);
		await page.emulateMedia({reducedMotion: 'reduce'});
		await page.setViewportSize({
			width: PROOF_VIEWPORTS[0].width,
			height: PROOF_VIEWPORTS[0].height,
		});
		await page.goto('/');
		await importSyntheticProject(page, 'Reduced Motion Photo');
		await expect(page.locator('canvas')).toBeVisible();

		const reducedMatch = await page.evaluate(
			() => globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches,
		);
		expect(reducedMatch).toBe(true);

		// Verify the phone parameters bottom sheet has transition suppressed
		const sheetStyles = await page.evaluate(() => {
			const panel = globalThis.document.querySelector(
				'#editor-phone-params-panel',
			);
			const sheet = panel?.parentElement;
			if (!sheet) {
				return null;
			}

			const style = globalThis.getComputedStyle(sheet);
			return {
				transitionProperty: style.transitionProperty,
				transitionDuration: style.transitionDuration,
				animationDuration: style.animationDuration,
			};
		});
		expect(sheetStyles).not.toBeNull();
		expect(sheetStyles?.transitionProperty).toBe('none');
		expect(
			Number.parseFloat(sheetStyles?.transitionDuration ?? '1'),
		).toBeLessThanOrEqual(0.001);

		// Verify animated controls across the UI have near-instant / zero duration
		const controlDurations = await page.evaluate(() => {
			const elements = [
				...globalThis.document.querySelectorAll<HTMLElement>(
					'button, [role="switch"]',
				),
			];
			return elements.map((el) => {
				const style = globalThis.getComputedStyle(el);
				return {
					transitionSeconds: Number.parseFloat(style.transitionDuration) || 0,
					animationSeconds: Number.parseFloat(style.animationDuration) || 0,
				};
			});
		});
		expect(controlDurations.length).toBeGreaterThan(0);
		for (const item of controlDurations) {
			expect(item.transitionSeconds).toBeLessThanOrEqual(0.001);
			expect(item.animationSeconds).toBeLessThanOrEqual(0.001);
		}

		// Verify phone sheet detent still toggles cleanly under reduced motion
		const detentButton = page.getByRole('button', {
			name: /(Expand|Collapse|Show) parameters/,
		});
		const aside = page.locator('aside[aria-label="Effects"]');
		const initialDetent = await aside.getAttribute('data-sheet-detent');
		await detentButton.click();
		await expect(aside).not.toHaveAttribute(
			'data-sheet-detent',
			initialDetent ?? '',
		);

		expect(errors).toEqual([]);
	});
});
