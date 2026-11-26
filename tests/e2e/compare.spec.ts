import {expect, test, type Page} from '@playwright/test';
import type {AppRuntime} from '../../src/state/index.ts';
import {assertNoA11yViolations} from './axe.ts';
import {waitForSettleRender} from './settle.ts';
import {PROOF_VIEWPORTS} from './viewports.ts';

type RuntimeGlobal = {
	__psgRuntime?: AppRuntime;
};

type Rgb = readonly [number, number, number];

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

/**
 Creates a high-contrast 320x240 synthetic image with a solid pure-red square
 on the left half and solid pure-blue on the right half, then adds a
 channelShift effect that shifts red far right so original and result have
 unmistakably different RGB values across the image.
 */
async function seedCompareProject(page: Page): Promise<string> {
	await page.goto('/');
	const projectId = await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		if (!runtime) {
			throw new Error('App runtime not attached');
		}

		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			throw new Error(`Expected ready boot, got ${booted.status}`);
		}

		const width = 320;
		const height = 240;
		const canvas = globalThis.document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			throw new Error('2D context unavailable');
		}

		// Alternating vertical stripes of red and cyan so a horizontal channel shift
		// dramatically changes colours everywhere on the canvas.
		for (let x = 0; x < width; x += 20) {
			ctx.fillStyle = (x / 20) % 2 === 0 ? '#ff0000' : '#00ffff';
			ctx.fillRect(x, 0, 20, height);
		}

		const blob = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((result) => {
				if (result) {
					resolve(result);
				} else {
					reject(new Error('Failed to encode PNG'));
				}
			}, 'image/png');
		});

		const store = booted.bundle.store.getState();
		const created = await store.importImage({
			name: 'compare-test.png',
			blob,
			width,
			height,
		});
		const instance = await booted.bundle.store
			.getState()
			.addEffect('channelShift');
		await booted.bundle.store
			.getState()
			.commitParam(instance.id, 'redX', 20, 'Change Red X');
		await booted.bundle.store
			.getState()
			.commitParam(instance.id, 'blueX', -20, 'Change Blue X');
		return created.project.id;
	});

	await expect(page.getByLabel('Image canvas')).toBeVisible();
	// Wait until the settle frame is delivered and drawn.
	await waitForSettleRender(page);
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				globalThis.requestAnimationFrame(() => {
					globalThis.requestAnimationFrame(() => {
						resolve();
					});
				});
			}),
	);
	return projectId;
}

async function readCanvasPixel(
	page: Page,
	cssXRatio: number,
	cssYRatio: number,
): Promise<Rgb> {
	return page.evaluate(
		({xRatio, yRatio}) => {
			const canvas = globalThis.document.querySelector<HTMLCanvasElement>(
				'canvas[aria-label="Image canvas"]',
			);
			if (!canvas) {
				throw new Error('Image canvas not found');
			}

			const ctx = canvas.getContext('2d');
			if (!ctx) {
				throw new Error('2D context not available');
			}

			const px = Math.min(
				canvas.width - 1,
				Math.max(0, Math.round(canvas.width * xRatio)),
			);
			const py = Math.min(
				canvas.height - 1,
				Math.max(0, Math.round(canvas.height * yRatio)),
			);
			const {data} = ctx.getImageData(px, py, 1, 1);
			return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0] as const;
		},
		{xRatio: cssXRatio, yRatio: cssYRatio},
	);
}

async function waitTwoFrames(page: Page): Promise<void> {
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				globalThis.requestAnimationFrame(() => {
					globalThis.requestAnimationFrame(() => {
						resolve();
					});
				});
			}),
	);
}

async function readHistoryCount(page: Page): Promise<number> {
	return page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime!.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		return booted.bundle.store.getState().history.length;
	});
}

test('AC-F11.1: clicking Compare toggles original with label, creates no history entry, and export still outputs edited result', async ({
	page,
}) => {
	const consoleErrors = collectConsoleErrors(page);
	await seedCompareProject(page);

	const historyBefore = await readHistoryCount(page);
	const editedPixel = await readCanvasPixel(page, 0.5, 0.5);

	const compareButton = page.getByRole('button', {name: 'Compare'});
	await expect(compareButton).toHaveAttribute('aria-pressed', 'false');

	// Click Compare -> shows original and "Original" pill.
	await compareButton.click();
	await expect(compareButton).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('[data-slot="compare-label-original"]')).toHaveText(
		'Original',
	);
	await waitTwoFrames(page);
	const originalPixel = await readCanvasPixel(page, 0.5, 0.5);
	expect(originalPixel).not.toEqual(editedPixel);

	// Export while comparing must still output the edited result, not the original.
	const exportedMatchesEdited = await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime!.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		const state = booted.bundle.store.getState();
		const project = state.activeProject!;
		const editedTask = booted.bundle.coordinator.exportImage({
			stack: project.stack,
			scale: 1,
			format: 'png',
		});
		const editedOutcome = await editedTask.result;
		const originalTask = booted.bundle.coordinator.exportImage({
			stack: {schemaVersion: 1, instances: []},
			scale: 1,
			format: 'png',
		});
		const originalOutcome = await originalTask.result;
		if (editedOutcome.status !== 'done' || originalOutcome.status !== 'done') {
			throw new Error('Export failed');
		}

		const editedBytes = new Uint8Array(await editedOutcome.file.arrayBuffer());
		const originalBytes = new Uint8Array(
			await originalOutcome.file.arrayBuffer(),
		);
		return editedBytes.length === originalBytes.length
			? editedBytes.some((byte, index) => byte !== originalBytes[index])
			: true;
	});
	expect(exportedMatchesEdited).toBe(true);

	// Click Compare again -> returns to edited result and removes label.
	await compareButton.click();
	await expect(compareButton).toHaveAttribute('aria-pressed', 'false');
	await expect(
		page.locator('[data-slot="compare-label-original"]'),
	).toHaveCount(0);
	await waitTwoFrames(page);
	expect(await readCanvasPixel(page, 0.5, 0.5)).toEqual(editedPixel);

	// Compare creates no history entry.
	expect(await readHistoryCount(page)).toBe(historyBefore);
	expect(consoleErrors).toEqual([]);
});

test('AC-F11.2: pressing and holding Compare for 1 s and releasing returns to the edited result', async ({
	page,
}) => {
	const consoleErrors = collectConsoleErrors(page);
	await seedCompareProject(page);

	const editedPixel = await readCanvasPixel(page, 0.5, 0.5);
	const compareButton = page.getByRole('button', {name: 'Compare'});
	const box = await compareButton.boundingBox();
	if (!box) {
		throw new Error('Compare button has no bounding box');
	}

	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await expect(page.locator('[data-slot="compare-label-original"]')).toHaveText(
		'Original',
	);
	await waitTwoFrames(page);
	const heldPixel = await readCanvasPixel(page, 0.5, 0.5);
	expect(heldPixel).not.toEqual(editedPixel);

	// Hold for 1 s, then release -> must return to edited result.
	await page.waitForTimeout(1000);
	await page.mouse.up();
	await expect(compareButton).toHaveAttribute('aria-pressed', 'false');
	await expect(
		page.locator('[data-slot="compare-label-original"]'),
	).toHaveCount(0);
	await waitTwoFrames(page);
	expect(await readCanvasPixel(page, 0.5, 0.5)).toEqual(editedPixel);

	// Also verify backslash keyboard hold-to-compare restores result on release.
	await page.keyboard.down('\\');
	await expect(page.locator('[data-slot="compare-label-original"]')).toHaveText(
		'Original',
	);
	await page.waitForTimeout(400);
	await page.keyboard.up('\\');
	await expect(
		page.locator('[data-slot="compare-label-original"]'),
	).toHaveCount(0);
	await waitTwoFrames(page);
	expect(await readCanvasPixel(page, 0.5, 0.5)).toEqual(editedPixel);
	expect(consoleErrors).toEqual([]);
});

test('AC-F11.3: split view shows original on left and result on right, drags and steps by keyboard, and persists across reload', async ({
	page,
}) => {
	const consoleErrors = collectConsoleErrors(page);
	await seedCompareProject(page);

	const historyBefore = await readHistoryCount(page);

	// Sample reference pixels at x = 0.45 and x = 0.55 for edited and original.
	const editedLeft = await readCanvasPixel(page, 0.45, 0.5);
	const editedRight = await readCanvasPixel(page, 0.55, 0.5);

	await page.getByRole('button', {name: 'Compare'}).click();
	await waitTwoFrames(page);
	const originalLeft = await readCanvasPixel(page, 0.45, 0.5);
	const originalRight = await readCanvasPixel(page, 0.55, 0.5);
	expect(originalLeft).not.toEqual(editedLeft);
	expect(originalRight).not.toEqual(editedRight);
	await page.getByRole('button', {name: 'Compare'}).click();

	// Enable split view via S shortcut.
	await page.keyboard.press('s');
	const separator = page.getByRole('separator', {
		name: 'Compare split position',
	});
	await expect(separator).toBeVisible();
	await expect(separator).toHaveAttribute('aria-valuenow', '50');
	await expect(page.locator('[data-slot="split-label-a"]')).toHaveText(
		'Original',
	);
	await expect(page.locator('[data-slot="split-label-b"]')).toHaveText('B');
	await waitTwoFrames(page);

	// Left of divider (0.45) matches original; right of divider (0.55) matches edited.
	expect(await readCanvasPixel(page, 0.45, 0.5)).toEqual(originalLeft);
	expect(await readCanvasPixel(page, 0.55, 0.5)).toEqual(editedRight);

	// Drag divider to ~70% of the stage width -> 0.55 now falls on the original side!
	const canvasBox = await page.getByLabel('Image canvas').boundingBox();
	const sepBox = await separator.boundingBox();
	if (!canvasBox || !sepBox) {
		throw new Error('Missing canvas or separator bounding box');
	}

	await page.mouse.move(
		sepBox.x + sepBox.width / 2,
		sepBox.y + sepBox.height / 2,
	);
	await page.mouse.down();
	await page.mouse.move(
		canvasBox.x + canvasBox.width * 0.7,
		sepBox.y + sepBox.height / 2,
		{steps: 8},
	);
	await page.mouse.up();
	await waitTwoFrames(page);

	const draggedValue = Number(await separator.getAttribute('aria-valuenow'));
	expect(draggedValue).toBeGreaterThanOrEqual(66);
	expect(draggedValue).toBeLessThanOrEqual(74);
	expect(await readCanvasPixel(page, 0.55, 0.5)).toEqual(originalRight);

	// Keyboard: Left (-1%), Right (+1%), Shift+Left (-10%), Shift+Right (+10%).
	await separator.focus();
	await page.keyboard.press('ArrowLeft');
	await expect(separator).toHaveAttribute(
		'aria-valuenow',
		String(draggedValue - 1),
	);
	await page.keyboard.press('ArrowRight');
	await expect(separator).toHaveAttribute(
		'aria-valuenow',
		String(draggedValue),
	);
	await page.keyboard.press('Shift+ArrowLeft');
	const afterShiftLeft = draggedValue - 10;
	await expect(separator).toHaveAttribute(
		'aria-valuenow',
		String(afterShiftLeft),
	);
	await page.keyboard.press('Shift+ArrowRight');
	await expect(separator).toHaveAttribute(
		'aria-valuenow',
		String(draggedValue),
	);

	// Wait for debounced view-state persistence (> 200 ms) and reload.
	await page.waitForTimeout(400);
	await page.reload();
	const restoredSeparator = page.getByRole('separator', {
		name: 'Compare split position',
	});
	await expect(restoredSeparator).toBeVisible();
	await expect(restoredSeparator).toHaveAttribute(
		'aria-valuenow',
		String(draggedValue),
	);

	expect(await readHistoryCount(page)).toBe(historyBefore);
	expect(consoleErrors).toEqual([]);
});

test('AC-F11.4: compare and split stay pixel-aligned while zoomed and panned', async ({
	page,
}) => {
	const consoleErrors = collectConsoleErrors(page);
	await seedCompareProject(page);

	// Zoom to 200% and pan via keyboard arrows.
	const canvas = page.getByLabel('Image canvas');
	await canvas.focus();
	await page.keyboard.press('1');
	await page.keyboard.press('+');
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('ArrowUp');
	await waitTwoFrames(page);

	// Capture zoomed & panned edited pixels on both sides of centre.
	const editedLeft = await readCanvasPixel(page, 0.42, 0.5);
	const editedRight = await readCanvasPixel(page, 0.58, 0.5);

	// Compare original while zoomed & panned.
	await page.getByRole('button', {name: 'Compare'}).click();
	await waitTwoFrames(page);
	const originalLeft = await readCanvasPixel(page, 0.42, 0.5);
	const originalRight = await readCanvasPixel(page, 0.58, 0.5);
	expect(originalLeft).not.toEqual(editedLeft);
	expect(originalRight).not.toEqual(editedRight);

	// Switch to split view at 50% while zoomed & panned: left matches original, right matches edited.
	await page.getByRole('button', {name: 'Split'}).click();
	await waitTwoFrames(page);
	expect(await readCanvasPixel(page, 0.42, 0.5)).toEqual(originalLeft);
	expect(await readCanvasPixel(page, 0.58, 0.5)).toEqual(editedRight);

	// Panning on the canvas still works while split view is active.
	const box = await canvas.boundingBox();
	if (!box) {
		throw new Error('Canvas has no bounding box');
	}

	const centerBefore = await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime!.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		return booted.bundle.store.getState().activeProject!.viewState.centerX;
	});

	await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.5, {
		steps: 5,
	});
	await page.mouse.up();
	await waitTwoFrames(page);

	const centerAfter = await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime!.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		return booted.bundle.store.getState().activeProject!.viewState.centerX;
	});
	expect(centerAfter).not.toBe(centerBefore);
	expect(consoleErrors).toEqual([]);
});

test('AC-F18.1 AC-F19.2 @a11y: split and compare layouts have zero horizontal scroll and zero axe violations across viewports and themes', async ({
	page,
}) => {
	const consoleErrors = collectConsoleErrors(page);
	await seedCompareProject(page);
	await page.getByRole('button', {name: 'Split'}).click();
	await expect(
		page.getByRole('separator', {name: 'Compare split position'}),
	).toBeVisible();

	for (const theme of THEMES) {
		await page.emulateMedia({colorScheme: theme.media});
		await page.evaluate(async (nextTheme) => {
			const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
			const booted = await runtime!.ready;
			if (booted.status === 'ready') {
				await booted.bundle.store.getState().setTheme(nextTheme);
			}
		}, theme.stored);

		for (const viewport of PROOF_VIEWPORTS) {
			await page.setViewportSize({
				width: viewport.width,
				height: viewport.height,
			});
			await waitTwoFrames(page);

			const overflow = await page.evaluate(
				() =>
					globalThis.document.documentElement.scrollWidth >
					globalThis.document.documentElement.clientWidth,
			);
			expect(
				overflow,
				`Horizontal overflow at ${viewport.name} (${theme.name})`,
			).toBe(false);

			await assertNoA11yViolations(page);
		}
	}

	expect(consoleErrors).toEqual([]);
});
