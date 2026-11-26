import {readFile} from 'node:fs/promises';
import {expect, test, type Locator, type Page} from '@playwright/test';
import type {AppRuntime} from '../../src/state/index.ts';
import {assertNoA11yViolations} from './axe.ts';
import {PROOF_VIEWPORTS} from './viewports.ts';

type RuntimeGlobal = {
	__psgRuntime?: AppRuntime;
};

type Rgb = readonly [number, number, number];

const SEPARATOR = {name: 'Compare split position'};

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

// Both coordinators have shown their newest settle frame and the canvas drew it.
// `page.waitForFunction` does not poll an async predicate, so this polls here.
async function waitForRender(page: Page): Promise<void> {
	await expect
		.poll(async () =>
			page.evaluate(async () => {
				const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
				const booted = await runtime?.ready;
				if (!booted || booted.status !== 'ready') {
					return false;
				}

				const {render, renderA, activeProject, compareMode} =
					booted.bundle.store.getState();
				const settled = (status: typeof render) =>
					status.frame?.level === 'settle' &&
					!status.busy.settle &&
					!status.busy.drag;
				const sideAShown =
					compareMode === 'split' &&
					(activeProject?.stackA?.instances.length ?? 0) > 0;
				return settled(render) && (!sideAShown || settled(renderA));
			}),
		)
		.toBe(true);
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

// Stores a 320x240 image of vertical red and cyan stripes, 20 px wide.
async function importStripes(page: Page, name: string): Promise<string> {
	return page.evaluate(async (projectName) => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime!.ready;
		if (booted.status !== 'ready') {
			throw new Error(`Expected ready boot, got ${booted.status}`);
		}

		const canvas = globalThis.document.createElement('canvas');
		canvas.width = 320;
		canvas.height = 240;
		const context = canvas.getContext('2d')!;
		for (let x = 0; x < 320; x += 20) {
			context.fillStyle = (x / 20) % 2 === 0 ? '#ff0000' : '#00ffff';
			context.fillRect(x, 0, 20, 240);
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
		const created = await booted.bundle.store.getState().importImage({
			name: projectName,
			blob,
			width: 320,
			height: 240,
		});
		return created.project.id;
	}, name);
}

// Adds a channel shift to the side being edited, moving red and blue apart.
async function addShift(page: Page, offset = 20): Promise<void> {
	await page.evaluate(async (shift) => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime!.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		const {store} = booted.bundle;
		const instance = await store.getState().addEffect('channelShift');
		await store.getState().commitParam(instance.id, 'redX', shift);
		await store.getState().commitParam(instance.id, 'blueX', -shift);
	}, offset);
}

// A project whose side B has a channel shift, shown in the editor.
async function seed(page: Page): Promise<string> {
	await page.goto('/');
	const id = await importStripes(page, 'split-test.png');
	await addShift(page);
	await expect(page.getByLabel('Image canvas')).toBeVisible();
	await waitForRender(page);
	return id;
}

async function readState(page: Page) {
	return page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime!.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		const {activeProject, history} = booted.bundle.store.getState();
		return {
			stack: activeProject!.stack,
			stackA: activeProject!.stackA,
			selectedInstanceId: activeProject!.selectedInstanceId,
			selectedInstanceIdA: activeProject!.selectedInstanceIdA,
			viewState: activeProject!.viewState,
			historyLabels: history.map((entry) => entry.label),
		};
	});
}

async function pixel(page: Page, x: number, y: number): Promise<Rgb> {
	return page.evaluate(
		({xRatio, yRatio}) => {
			const canvas = globalThis.document.querySelector<HTMLCanvasElement>(
				'canvas[aria-label="Image canvas"]',
			)!;
			const {data} = canvas
				.getContext('2d')!
				.getImageData(
					Math.round(canvas.width * xRatio),
					Math.round(canvas.height * yRatio),
					1,
					1,
				);
			return [data[0], data[1], data[2]] as const;
		},
		{xRatio: x, yRatio: y},
	);
}

// Reads points beside both dividers: x for a left/right split, y for top/bottom.
const POINTS = {
	left: [0.4, 0.4],
	right: [0.6, 0.4],
	bottom: [0.4, 0.6],
} as const;

async function pixels(page: Page) {
	return {
		left: await pixel(page, ...POINTS.left),
		right: await pixel(page, ...POINTS.right),
		bottom: await pixel(page, ...POINTS.bottom),
	};
}

// The same points with the whole canvas showing the original, then side B.
async function referencePixels(page: Page) {
	const edited = await pixels(page);
	await page.getByRole('button', {name: 'Compare'}).click();
	await waitForRender(page);
	const original = await pixels(page);
	await page.getByRole('button', {name: 'Compare'}).click();
	await waitForRender(page);
	for (const key of ['left', 'right', 'bottom'] as const) {
		expect(original[key], key).not.toEqual(edited[key]);
	}

	return {original, edited};
}

async function pickEffect(page: Page, name: RegExp): Promise<void> {
	await page.getByRole('button', {name: 'Add effect'}).click();
	await page.getByRole('button', {name}).click();
}

const sideOption = (page: Page, name: string) =>
	page.getByRole('radio', {name});

const label = (page: Page, side: 'a' | 'b') =>
	page.locator(`[data-slot="split-label-${side}"]`);

// The view state is saved 200 ms after the last change.
async function reload(page: Page): Promise<void> {
	await page.waitForTimeout(400);
	await page.reload();
	await expect(page.getByLabel('Image canvas')).toBeVisible();
	await waitForRender(page);
}

test('AC-F11.5: Shift+S and the orientation button switch between left/right and top/bottom, turning split on', async ({
	page,
}) => {
	const errors = collectConsoleErrors(page);
	await seed(page);
	const {original, edited} = await referencePixels(page);
	const separator = page.getByRole('separator', SEPARATOR);
	await expect(separator).toHaveCount(0);

	await page.keyboard.press('Shift+S');
	await expect(separator).toHaveAttribute('aria-orientation', 'horizontal');
	await expect(
		page.getByRole('button', {name: 'Split', exact: true}),
	).toHaveAttribute('aria-pressed', 'true');
	await waitForRender(page);
	// Above the divider is the original, below it the result.
	expect(await pixel(page, ...POINTS.left)).toEqual(original.left);
	expect(await pixel(page, ...POINTS.right)).toEqual(original.right);
	expect(await pixel(page, ...POINTS.bottom)).toEqual(edited.bottom);
	await expect(sideOption(page, 'A · Top')).toBeVisible();
	await expect(sideOption(page, 'B · Bottom')).toHaveAttribute(
		'aria-checked',
		'true',
	);

	await page.getByRole('button', {name: 'Switch to left/right view'}).click();
	await expect(separator).toHaveAttribute('aria-orientation', 'vertical');
	await waitForRender(page);
	expect(await pixel(page, ...POINTS.left)).toEqual(original.left);
	expect(await pixel(page, ...POINTS.bottom)).toEqual(original.bottom);
	expect(await pixel(page, ...POINTS.right)).toEqual(edited.right);
	await expect(sideOption(page, 'A · Left')).toBeVisible();

	// From split off, the button turns it on in the other orientation.
	await page.keyboard.press('s');
	await expect(separator).toHaveCount(0);
	await page.getByRole('button', {name: 'Switch to top/bottom view'}).click();
	await expect(separator).toHaveAttribute('aria-orientation', 'horizontal');
	expect(errors).toEqual([]);
});

test('AC-F11.6: a horizontal divider drags up and down and steps with Up/Down by 1% and 10%', async ({
	page,
}) => {
	const errors = collectConsoleErrors(page);
	await seed(page);
	const {original, edited} = await referencePixels(page);
	await page.keyboard.press('Shift+S');
	const separator = page.getByRole('separator', SEPARATOR);
	await expect(separator).toHaveAttribute('aria-valuenow', '50');

	const canvasBox = (await page.getByLabel('Image canvas').boundingBox())!;
	const handle = (await separator.boundingBox())!;
	const x = handle.x + handle.width / 2;
	await page.mouse.move(x, handle.y + handle.height / 2);
	await page.mouse.down();
	await page.mouse.move(x, canvasBox.y + canvasBox.height * 0.7, {steps: 8});
	await page.mouse.up();
	const dragged = Number(await separator.getAttribute('aria-valuenow'));
	expect(dragged).toBeGreaterThanOrEqual(68);
	expect(dragged).toBeLessThanOrEqual(72);
	await waitForRender(page);
	// The point at 60% height is now above the divider.
	expect(await pixel(page, ...POINTS.bottom)).toEqual(original.bottom);
	expect(original.bottom).not.toEqual(edited.bottom);

	await separator.focus();
	const expectValue = async (key: string, value: number) => {
		await page.keyboard.press(key);
		await expect(separator).toHaveAttribute('aria-valuenow', String(value));
	};

	await expectValue('ArrowUp', dragged - 1);
	await expectValue('ArrowDown', dragged);
	await expectValue('Shift+ArrowUp', dragged - 10);
	await expectValue('Shift+ArrowDown', dragged);
	await expectValue('ArrowLeft', dragged);
	await expectValue('ArrowRight', dragged);
	expect(errors).toEqual([]);
});

test('AC-F11.7: orientation and divider position are kept per project across reload', async ({
	page,
}) => {
	const errors = collectConsoleErrors(page);
	const first = await seed(page);
	await page.keyboard.press('Shift+S');
	const separator = page.getByRole('separator', SEPARATOR);
	await separator.focus();
	await page.keyboard.press('Shift+ArrowUp');
	await page.keyboard.press('Shift+ArrowUp');
	await expect(separator).toHaveAttribute('aria-valuenow', '30');

	const second = await importStripes(page, 'second.png');
	await expect(separator).toHaveAttribute('aria-orientation', 'vertical');
	await expect(separator).toHaveAttribute('aria-valuenow', '50');

	await page.goto(`/#/p/${first}`);
	await reload(page);
	await expect(separator).toHaveAttribute('aria-orientation', 'horizontal');
	await expect(separator).toHaveAttribute('aria-valuenow', '30');
	await expect(sideOption(page, 'A · Top')).toBeVisible();

	await page.goto(`/#/p/${second}`);
	await reload(page);
	await expect(separator).toHaveAttribute('aria-orientation', 'vertical');
	await expect(separator).toHaveAttribute('aria-valuenow', '50');
	expect(errors).toEqual([]);
});

test('AC-F11.8: side A starts as the original and takes its own effects through the Editing switch', async ({
	page,
}) => {
	const errors = collectConsoleErrors(page);
	await seed(page);
	const {original, edited} = await referencePixels(page);
	const mainBefore = (await readState(page)).stack;

	await page.keyboard.press('s');
	await waitForRender(page);
	await expect(label(page, 'a')).toHaveText('Original');
	await expect(label(page, 'b')).toHaveText('B');
	expect(await pixel(page, ...POINTS.left)).toEqual(original.left);

	await sideOption(page, 'A · Left').click();
	await expect(sideOption(page, 'A · Left')).toHaveAttribute(
		'aria-checked',
		'true',
	);
	await expect(page.getByText('No effects yet')).toBeVisible();
	await pickEffect(page, /Channel shift/);
	await expect(label(page, 'a')).toHaveText('A');

	// Typing into the parameter panel edits side A's instance.
	const redX = page.getByRole('textbox', {name: 'Red X'});
	await redX.fill('20');
	await redX.press('Enter');
	const blueX = page.getByRole('textbox', {name: 'Blue X'});
	await blueX.fill('-20');
	await blueX.press('Enter');
	await expect
		.poll(async () => (await readState(page)).stackA?.instances[0]?.params)
		.toMatchObject({redX: 20, blueX: -20});
	await waitForRender(page);

	expect(await pixel(page, ...POINTS.left)).toEqual(edited.left);
	expect(await pixel(page, ...POINTS.right)).toEqual(edited.right);
	const state = await readState(page);
	expect(state.stack).toEqual(mainBefore);
	expect(state.stackA?.instances).toHaveLength(1);

	// With the split off, the panel shows side B again.
	await page.getByRole('button', {name: 'Split', exact: true}).click();
	await expect(sideOption(page, 'A · Left')).toHaveCount(0);
	await expect(redX).toHaveValue(/^20/);
	await waitForRender(page);
	expect(await pixel(page, ...POINTS.left)).toEqual(edited.left);
	expect(errors).toEqual([]);
});

test('AC-F11.9: Copy to other side and Swap sides are each one undoable step', async ({
	page,
}) => {
	const errors = collectConsoleErrors(page);
	await seed(page);
	const {original, edited} = await referencePixels(page);
	await page.keyboard.press('s');
	await waitForRender(page);
	const copy = page.getByRole('button', {name: 'Copy to other side'});
	const swap = page.getByRole('button', {name: 'Swap sides'});
	const before = await readState(page);

	await sideOption(page, 'A · Left').click();
	await expect(copy).toBeDisabled();
	await sideOption(page, 'B · Right').click();
	await copy.click();
	await expect(label(page, 'a')).toHaveText('A');
	await waitForRender(page);
	expect(await pixel(page, ...POINTS.left)).toEqual(edited.left);
	let state = await readState(page);
	expect(state.historyLabels).toEqual([...before.historyLabels, 'Copy B to A']);

	await page.getByRole('button', {name: 'Undo Copy B to A'}).click();
	await expect(label(page, 'a')).toHaveText('Original');
	await waitForRender(page);
	expect(await pixel(page, ...POINTS.left)).toEqual(original.left);

	await swap.click();
	await expect(label(page, 'a')).toHaveText('A');
	await expect(label(page, 'b')).toHaveText('Original');
	await waitForRender(page);
	expect(await pixel(page, ...POINTS.left)).toEqual(edited.left);
	expect(await pixel(page, ...POINTS.right)).toEqual(original.right);
	state = await readState(page);
	expect(state.historyLabels.at(-1)).toBe('Swap sides');

	await page.getByRole('button', {name: 'Undo Swap sides'}).click();
	await expect(label(page, 'a')).toHaveText('Original');
	await expect(label(page, 'b')).toHaveText('B');
	await waitForRender(page);
	expect(await pixel(page, ...POINTS.right)).toEqual(edited.right);
	state = await readState(page);
	expect(state.stack).toEqual(before.stack);
	expect(state.stackA).toBeUndefined();
	expect(errors).toEqual([]);
});

test('AC-F11.10: undo and redo step through both sides with the side in the button name', async ({
	page,
}) => {
	const errors = collectConsoleErrors(page);
	await seed(page);
	await page.keyboard.press('s');
	await sideOption(page, 'A · Left').click();
	await pickEffect(page, /Channel shift/);
	await expect(label(page, 'a')).toHaveText('A');
	await sideOption(page, 'B · Right').click();
	await pickEffect(page, /Pixel sort/);

	await expect(
		page.getByRole('button', {name: 'Undo Add Pixel sort (side B)'}),
	).toBeEnabled();
	await page.keyboard.press('Control+z');
	await expect(
		page.getByRole('button', {name: 'Undo Add Channel shift (side A)'}),
	).toBeEnabled();
	expect((await readState(page)).stack.instances).toHaveLength(1);

	await page.keyboard.press('Control+z');
	await expect(label(page, 'a')).toHaveText('Original');
	await expect(
		page.getByRole('button', {name: 'Redo Add Channel shift (side A)'}),
	).toBeEnabled();

	// Each step is written to storage first. The button names change with the
	// stacks, so wait for them before pressing again or reading the stacks.
	await page.keyboard.press('Control+Shift+z');
	await expect(
		page.getByRole('button', {name: 'Redo Add Pixel sort (side B)'}),
	).toBeEnabled();
	await page.keyboard.press('Control+Shift+z');
	await expect(
		page.getByRole('button', {name: 'Undo Add Pixel sort (side B)'}),
	).toBeEnabled();
	await expect(label(page, 'a')).toHaveText('A');
	const state = await readState(page);
	expect(state.stack.instances).toHaveLength(2);
	expect(state.stackA?.instances).toHaveLength(1);
	expect(errors).toEqual([]);
});

test('AC-F11.11: presets apply to and save from the side being edited', async ({
	page,
}) => {
	const errors = collectConsoleErrors(page);
	await seed(page);
	await page.keyboard.press('s');
	await sideOption(page, 'A · Left').click();
	await addShift(page, 5);
	const mainBefore = (await readState(page)).stack;

	await page.getByRole('button', {name: 'Presets'}).click();
	await page.getByRole('button', {name: /^ASDF classic/}).click();
	await expect(page.getByRole('alertdialog')).toContainText(
		'removes the 1 effect on side A',
	);
	await page.getByRole('button', {name: 'Replace'}).click();
	await expect
		.poll(async () => (await readState(page)).stackA?.instances.length)
		.toBe(2);
	let state = await readState(page);
	expect(state.stack).toEqual(mainBefore);
	expect(state.historyLabels.at(-1)).toBe('Apply preset ASDF classic (side A)');

	await page.getByRole('button', {name: 'Presets'}).click();
	await page.getByRole('button', {name: 'Save as preset'}).click();
	await page.getByRole('textbox', {name: /name/i}).fill('Left look');
	await page.getByRole('button', {name: 'Save preset'}).click();
	await page.getByRole('button', {name: 'Presets'}).click();
	await expect(
		page.getByRole('button', {name: /^Left look.*2 effects/}),
	).toBeVisible();
	state = await readState(page);
	expect(state.stack).toEqual(mainBefore);
	expect(errors).toEqual([]);
});

test('AC-F11.12: side A, both selections and the edited side survive a reload', async ({
	page,
}) => {
	const errors = collectConsoleErrors(page);
	await seed(page);
	const {edited} = await referencePixels(page);
	await page.keyboard.press('s');
	await sideOption(page, 'A · Left').click();
	await addShift(page);
	await waitForRender(page);
	const before = await readState(page);

	await reload(page);

	const after = await readState(page);
	expect(after.stackA).toEqual(before.stackA);
	expect(after.stack).toEqual(before.stack);
	expect(after.selectedInstanceId).toBe(before.selectedInstanceId);
	expect(after.selectedInstanceIdA).toBe(before.selectedInstanceIdA);
	expect(after.historyLabels).toEqual(before.historyLabels);
	await expect(sideOption(page, 'A · Left')).toHaveAttribute(
		'aria-checked',
		'true',
	);
	await expect(page.getByRole('textbox', {name: 'Red X'})).toHaveValue(/^20/);
	await expect(label(page, 'a')).toHaveText('A');
	expect(await pixel(page, ...POINTS.left)).toEqual(edited.left);
	expect(errors).toEqual([]);
});

test('AC-F11.13: two sides with the same stack stay pixel-aligned while zoomed and panned', async ({
	page,
}) => {
	const errors = collectConsoleErrors(page);
	await seed(page);
	const canvas = page.getByLabel('Image canvas');
	await canvas.focus();
	await page.keyboard.press('1');
	await page.keyboard.press('+');
	await page.keyboard.press('+');
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('ArrowUp');
	await waitForRender(page);

	// A row of points across both halves, read with side B filling the canvas.
	const row = Array.from({length: 17}, (_, index) => 0.1 + index * 0.05).filter(
		(x) => Math.abs(x - 0.5) > 0.04,
	);
	const readRow = async () => {
		const values: Rgb[] = [];
		for (const x of row) {
			values.push(await pixel(page, x, 0.3), await pixel(page, x, 0.7));
		}

		return values;
	};

	const whole = await readRow();
	expect(new Set(whole.map(String)).size).toBeGreaterThan(1);

	await page.keyboard.press('s');
	await page.getByRole('button', {name: 'Copy to other side'}).click();
	await expect(label(page, 'a')).toHaveText('A');
	await waitForRender(page);
	expect(await readRow()).toEqual(whole);

	await page.keyboard.press('Shift+S');
	await waitForRender(page);
	expect(await readRow()).toEqual(whole);

	// Panning moves both sides together.
	await canvas.focus();
	await page.keyboard.press('ArrowRight');
	await waitForRender(page);
	const panned = await readRow();
	await page.keyboard.press('s');
	await waitForRender(page);
	expect(await readRow()).toEqual(panned);
	expect(errors).toEqual([]);
});

test('AC-F11.14: a second preview worker exists only while a non-empty side A is shown', async ({
	page,
}) => {
	const errors = collectConsoleErrors(page);
	await seed(page);
	const previewWorkers = () =>
		page.workers().filter((worker) => worker.url().includes('preview.worker'))
			.length;
	await expect.poll(previewWorkers).toBe(1);

	await page.keyboard.press('s');
	await sideOption(page, 'A · Left').click();
	await waitForRender(page);
	expect(previewWorkers()).toBe(1);

	await addShift(page);
	await expect.poll(previewWorkers).toBe(2);
	await waitForRender(page);

	await page.keyboard.press('s');
	await expect.poll(previewWorkers).toBe(1);
	await page.keyboard.press('s');
	await expect.poll(previewWorkers).toBe(2);
	await waitForRender(page);

	// Undo the three commits that built side A.
	await page.keyboard.press('Control+z');
	await page.keyboard.press('Control+z');
	await page.keyboard.press('Control+z');
	await expect(label(page, 'a')).toHaveText('Original');
	await expect.poll(previewWorkers).toBe(1);
	expect(errors).toEqual([]);
});

test('AC-F12.10: export offers a side only when side A has effects, and downloads the chosen one', async ({
	page,
}) => {
	const errors = collectConsoleErrors(page);
	await seed(page);
	const dialog = page.getByRole('dialog', {name: 'Export'});
	const openExport = async () => {
		await page.getByRole('button', {name: 'Export'}).click();
		await expect(dialog).toBeVisible();
	};

	await openExport();
	await expect(dialog.getByText('Side', {exact: true})).toHaveCount(0);
	await page.keyboard.press('Escape');

	await page.keyboard.press('s');
	await sideOption(page, 'A · Left').click();
	await addShift(page, 40);
	await waitForRender(page);

	// Red and blue of one source pixel, from the downloaded file.
	const download = async () => {
		const pending = page.waitForEvent('download');
		await dialog.getByRole('button', {name: 'Download'}).click();
		const file = await readFile(await (await pending).path());
		return page.evaluate(
			async (bytes) => {
				const bitmap = await globalThis.createImageBitmap(
					new Blob([new Uint8Array(bytes)], {type: 'image/png'}),
				);
				const canvas = new globalThis.OffscreenCanvas(
					bitmap.width,
					bitmap.height,
				);
				const context = canvas.getContext('2d')!;
				context.drawImage(bitmap, 0, 0);
				return [...context.getImageData(110, 120, 1, 1).data].slice(0, 3);
			},
			[...file],
		);
	};

	// Source pixel x = 110 is cyan (stripe 5). Side B shifts by one stripe, so
	// red and blue come from red stripes and it turns red-and-green; side A
	// shifts by two and it stays cyan.
	await openExport();
	await expect(dialog.getByRole('radio', {name: 'B · Right'})).toHaveAttribute(
		'aria-checked',
		'true',
	);
	const sideB = await download();
	await dialog.getByRole('radio', {name: 'A · Left'}).click();
	const sideA = await download();
	expect(sideA).toEqual([0, 255, 255]);
	expect(sideB).toEqual([255, 255, 0]);
	expect(errors).toEqual([]);
});

test('AC-F18.1 AC-F19.2 @a11y: the split side switcher fits every viewport in both orientations and themes', async ({
	page,
}) => {
	const errors = collectConsoleErrors(page);
	await seed(page);
	await page.keyboard.press('s');
	await sideOption(page, 'A · Left').click();
	await addShift(page);
	await waitForRender(page);

	for (const theme of ['light', 'dark'] as const) {
		await page.evaluate(async (next) => {
			const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
			const booted = await runtime!.ready;
			if (booted.status === 'ready') {
				await booted.bundle.store.getState().setTheme(next);
			}
		}, theme);

		for (const orientation of ['vertical', 'horizontal'] as const) {
			if (
				(await page
					.getByRole('separator', SEPARATOR)
					.getAttribute('aria-orientation')) !== orientation
			) {
				await page.keyboard.press('Shift+S');
			}

			for (const viewport of PROOF_VIEWPORTS) {
				await page.setViewportSize(viewport);
				await waitForRender(page);
				const where = `${viewport.name} ${theme} ${orientation}`;
				const switcher = page.locator('[data-slot="split-side-switcher"]');
				await expect(switcher, where).toBeVisible();
				expect(
					await page.evaluate(
						() =>
							globalThis.document.documentElement.scrollWidth >
							globalThis.document.documentElement.clientWidth,
					),
					where,
				).toBe(false);
				// Nothing in the switcher or the toolbar is pushed out of view.
				for (const control of [
					page.getByRole('button', {name: 'Swap sides'}),
					page.getByRole('button', {name: /^Switch to/}),
					page.getByRole('button', {name: 'Presets'}),
				]) {
					const box = (await control.boundingBox())!;
					expect(box.x, where).toBeGreaterThanOrEqual(0);
					expect(box.x + box.width, where).toBeLessThanOrEqual(viewport.width);
				}

				const canvasBox = (await page
					.getByLabel('Image canvas')
					.boundingBox())!;
				if (viewport.width < 640) {
					expect(canvasBox.height / viewport.height, where).toBeGreaterThan(
						0.39,
					);
				}

				await assertNoA11yViolations(page);
			}
		}
	}

	expect(errors).toEqual([]);
});

test('AC-F18.3: on a coarse-pointer phone the split controls meet 44x44 px and stay on screen', async ({
	browser,
	browserName,
}) => {
	test.skip(
		browserName !== 'chromium',
		'Playwright isMobile (pointer: coarse) emulation is Chromium-only',
	);
	const viewport = {width: 390, height: 844};
	const context = await browser.newContext({
		viewport,
		hasTouch: true,
		isMobile: true,
	});
	const page = await context.newPage();
	await seed(page);
	await page.getByRole('button', {name: 'Split', exact: true}).click();

	const toolbar = page.getByRole('toolbar', {name: 'Editor actions'});
	const switcher = page.locator('[data-slot="split-side-switcher"]');
	await expect(switcher).toBeVisible();
	const onScreen = async (control: Locator) => {
		const name = (await control.textContent()) ?? '';
		const box = (await control.boundingBox())!;
		expect(box.x, name).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width, name).toBeLessThanOrEqual(viewport.width);
		return box;
	};

	for (const control of await toolbar.getByRole('button').all()) {
		await onScreen(control);
	}

	for (const control of [
		toolbar.getByRole('button', {name: 'Switch to top/bottom view'}),
		...(await switcher.getByRole('radio').all()),
		...(await switcher.getByRole('button').all()),
	]) {
		const box = await onScreen(control);
		expect(box.width).toBeGreaterThanOrEqual(44);
		expect(box.height).toBeGreaterThanOrEqual(44);
	}

	const canvasBox = (await page.getByLabel('Image canvas').boundingBox())!;
	expect(canvasBox.height / viewport.height).toBeGreaterThan(0.39);
	await context.close();
});
