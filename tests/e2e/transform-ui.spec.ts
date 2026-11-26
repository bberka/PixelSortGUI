import {Buffer} from 'node:buffer';
import {readFile} from 'node:fs/promises';
import {expect, test, type Locator, type Page} from '@playwright/test';
import type {AppRuntime} from '../../src/state/index.ts';
import {assertNoA11yViolations} from './axe.ts';
import {PROOF_VIEWPORTS} from './viewports.ts';

type RuntimeGlobal = {__psgRuntime?: AppRuntime};

const LIMIT_MESSAGE =
	'Maximum output size is 50 MP (50,000,000 px) and 16,384 px per side.';

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

// Imports an image of four coloured quadrants with a green block off centre, so
// every rotation, flip and crop shows different pixels.
async function openImage(
	page: Page,
	width: number,
	height: number,
): Promise<void> {
	await page.goto('/');
	await page.evaluate(
		async (size) => {
			const booted = await (globalThis as unknown as RuntimeGlobal)
				.__psgRuntime!.ready;
			if (booted.status !== 'ready') {
				throw new Error(`Expected ready boot, got ${booted.status}`);
			}

			const canvas = new globalThis.OffscreenCanvas(size.width, size.height);
			const context = canvas.getContext('2d')!;
			const colors = ['#c02020', '#2040c0', '#c0a020', '#202020'];
			for (const [index, color] of colors.entries()) {
				context.fillStyle = color;
				context.fillRect(
					(index % 2) * (size.width / 2),
					Math.floor(index / 2) * (size.height / 2),
					size.width / 2,
					size.height / 2,
				);
			}

			context.fillStyle = '#00ff00';
			context.fillRect(
				size.width / 8,
				size.height / 8,
				size.width / 4,
				size.height / 4,
			);
			await booted.bundle.store.getState().importImage({
				name: 'geometry.png',
				blob: await canvas.convertToBlob({type: 'image/png'}),
				width: size.width,
				height: size.height,
			});
		},
		{width, height},
	);
	await expect(page.getByRole('button', {name: 'Export'})).toBeEnabled();
}

async function readProject(page: Page) {
	return page.evaluate(async () => {
		const booted = await (globalThis as unknown as RuntimeGlobal).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		const {activeProject, history, compareMode} =
			booted.bundle.store.getState();
		return {
			transform: activeProject?.transform,
			size: [activeProject?.effectiveWidth, activeProject?.effectiveHeight],
			entries: history.length,
			label: history.find(
				(entry) => entry.seq === activeProject?.historyHeadSeq,
			)?.label,
			effects: activeProject?.stack.instances.map((item) => item.type),
			compareMode,
		};
	});
}

async function expectSize(page: Page, width: number, height: number) {
	await expect
		.poll(async () => (await readProject(page)).size)
		.toEqual([width, height]);
}

async function sourceDigest(page: Page): Promise<string> {
	return page.evaluate(async () => {
		const booted = await (globalThis as unknown as RuntimeGlobal).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		const {store, repository} = booted.bundle;
		const hash = store.getState().activeProject!.sourceHash;
		const source = (await repository.getSource(hash))!;
		const digest = await crypto.subtle.digest(
			'SHA-256',
			await source.blob.arrayBuffer(),
		);
		const hex = [...new Uint8Array(digest)]
			.map((byte) => byte.toString(16).padStart(2, '0'))
			.join('');
		return hex === hash ? 'unchanged' : 'changed';
	});
}

const panel = (page: Page) => page.locator('[data-slot="geometry-panel"]');
const button = (page: Page, name: string) =>
	page.getByRole('button', {name, exact: true});
const transformToggle = (page: Page) => button(page, 'Transform');
const cropField = (page: Page, name: string) =>
	panel(page)
		.getByRole('region', {name: 'Crop'})
		.getByLabel(name, {exact: true});
const resizeField = (page: Page, name: 'Width' | 'Height') =>
	panel(page)
		.getByRole('region', {name: 'Resize'})
		.getByRole('textbox', {name: new RegExp(`^${name}`)});

async function expectCropFields(
	page: Page,
	[x, y, width, height]: readonly [number, number, number, number],
) {
	await expect(cropField(page, 'X')).toHaveValue(String(x));
	await expect(cropField(page, 'Y')).toHaveValue(String(y));
	await expect(cropField(page, 'Width')).toHaveValue(String(width));
	await expect(cropField(page, 'Height')).toHaveValue(String(height));
}

async function typeCrop(
	page: Page,
	[x, y, width, height]: readonly [number, number, number, number],
) {
	// Size first, so the position is not clamped by the old size.
	for (const [name, value] of [
		['Width', width],
		['Height', height],
		['X', x],
		['Y', y],
	] as const) {
		await cropField(page, name).fill(String(value));
		await cropField(page, name).press('Enter');
	}
}

async function chooseOption(page: Page, label: string, option: string) {
	await panel(page).getByRole('combobox', {name: label}).click();
	await page.getByRole('option', {name: option, exact: true}).click();
}

// Downloads a PNG at the chosen size.
async function exportPng(page: Page, preset: 'Full' | '1/2' = 'Full') {
	await button(page, 'Export').click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('radio', {name: preset, exact: true}).click();
	const pending = page.waitForEvent('download');
	await dialog.getByRole('button', {name: 'Download'}).click();
	const download = await pending;
	const file = await readFile(await download.path());
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	return {
		file,
		size: [file.readUInt32BE(16), file.readUInt32BE(20)],
	};
}

// The box of the crop area in CSS px, relative to the canvas.
async function cropBox(page: Page) {
	const box = (await page.locator('[data-slot="crop-box"]').boundingBox())!;
	const canvas = (await page.getByLabel('Image canvas').boundingBox())!;
	return {
		x: box.x - canvas.x,
		y: box.y - canvas.y,
		width: box.width,
		height: box.height,
	};
}

async function canvasPixel(page: Page, x: number, y: number) {
	return page.getByLabel('Image canvas').evaluate(
		(canvas, point) => {
			const element = canvas as HTMLCanvasElement;
			const ratio = element.width / element.clientWidth;
			const {data} = element
				.getContext('2d')!
				.getImageData(
					Math.floor(point.x * ratio),
					Math.floor(point.y * ratio),
					1,
					1,
				);
			return [data[0], data[1], data[2]];
		},
		{x, y},
	);
}

const isGreen = ([r, g, b]: number[]) => g > 200 && r < 60 && b < 60;

async function dragBy(page: Page, target: Locator, dx: number, dy: number) {
	const box = (await target.boundingBox())!;
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + dx, y + dy, {steps: 5});
	await page.mouse.up();
}

// Moves focus with Tab, or Shift+Tab for an earlier control, to `target`.
async function tabTo(page: Page, target: Locator) {
	// Going the right way never needs the browser's own wrap-around.
	const backwards = await target.evaluate((element) => {
		const focused = globalThis.document.activeElement;
		return (
			focused !== null &&
			focused !== globalThis.document.body &&
			element.compareDocumentPosition(focused) ===
				Node.DOCUMENT_POSITION_FOLLOWING
		);
	});
	for (let step = 0; step < 120; step++) {
		if (
			await target.evaluate(
				(element) => element === globalThis.document.activeElement,
			)
		) {
			return;
		}

		await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
	}

	throw new Error(`Tab never reached ${target.toString()}`);
}

test('AC-F20.1: rotating 4000 x 3000 updates canvas, export and library, and survives reload, undo and redo', async ({
	page,
}) => {
	const errors = collectConsoleErrors(page);
	await openImage(page, 4000, 3000);
	const before = await readProject(page);
	await transformToggle(page).click();
	await button(page, 'Rotate 90° clockwise').click();
	await expectSize(page, 3000, 4000);
	const rotated = await readProject(page);
	expect(rotated.entries).toBe(before.entries + 1);
	expect(rotated.label).toBe('Rotate 90° CW');
	// The canvas shows the turned image: the box over it is taller than wide.
	await expectCropFields(page, [0, 0, 3000, 4000]);
	await expect
		.poll(async () => {
			const box = await cropBox(page);
			return Math.round((box.width / box.height) * 100);
		})
		.toBe(75);
	expect(await sourceDigest(page)).toBe('unchanged');
	await button(page, 'Close transform panel').click();
	expect((await exportPng(page)).size).toEqual([3000, 4000]);

	await page.reload();
	await expectSize(page, 3000, 4000);
	await page.getByRole('button', {name: /^Undo Rotate 90° CW/}).click();
	await expectSize(page, 4000, 3000);
	await page.getByRole('button', {name: /^Redo Rotate 90° CW/}).click();
	await expectSize(page, 3000, 4000);
	await page.goto('/#/');
	await expect(page.getByText('3000 × 4000 px')).toBeVisible();
	expect(errors).toEqual([]);
});

test('AC-F20.2: two flips or four rotations give pixel-identical output', async ({
	page,
}) => {
	await openImage(page, 320, 240);
	const original = await exportPng(page);
	await transformToggle(page).click();

	await button(page, 'Flip horizontal').click();
	await expect.poll(async () => (await readProject(page)).entries).toBe(2);
	const flipped = await exportPng(page);
	expect(Buffer.compare(flipped.file, original.file)).not.toBe(0);
	await button(page, 'Flip horizontal').click();
	await expect.poll(async () => (await readProject(page)).entries).toBe(3);
	expect((await exportPng(page)).file.equals(original.file)).toBe(true);

	// Clicked faster than a save, every turn still counts, over a crop and a
	// mirrored image as well.
	await button(page, 'Flip vertical').click();
	await typeCrop(page, [10, 20, 100, 60]);
	await button(page, 'Apply crop').click();
	await expect
		.poll(async () => (await readProject(page)).size)
		.toEqual([100, 60]);
	const cropped = await exportPng(page);
	const {entries} = await readProject(page);
	for (let turn = 0; turn < 4; turn++) {
		await button(page, 'Rotate 90° clockwise').click();
	}

	await expect
		.poll(async () => (await readProject(page)).entries)
		.toBe(entries + 4);
	await expectSize(page, 100, 60);
	expect((await exportPng(page)).file.equals(cropped.file)).toBe(true);
	for (let turn = 0; turn < 4; turn++) {
		await button(page, 'Rotate 90° counter-clockwise').click();
	}

	await expect
		.poll(async () => (await readProject(page)).entries)
		.toBe(entries + 8);
	expect((await exportPng(page)).file.equals(cropped.file)).toBe(true);
});

test('AC-F20.3: ratios start centred boxes, Apply saves once, and reset restores the image', async ({
	page,
}) => {
	await openImage(page, 4000, 3000);
	await transformToggle(page).click();
	await chooseOption(page, 'Aspect ratio', '1:1');
	await expectCropFields(page, [500, 0, 3000, 3000]);
	await chooseOption(page, 'Aspect ratio', '16:9');
	await expectCropFields(page, [0, 375, 4000, 2250]);
	await chooseOption(page, 'Aspect ratio', 'Original');
	await expectCropFields(page, [0, 0, 4000, 3000]);
	await chooseOption(page, 'Aspect ratio', '2:3');
	await expectCropFields(page, [1000, 0, 2000, 3000]);
	await chooseOption(page, 'Aspect ratio', '16:9');
	expect((await readProject(page)).entries).toBe(1);

	await button(page, 'Apply crop').click();
	await expectSize(page, 4000, 2250);
	const applied = await readProject(page);
	expect(applied.entries).toBe(2);
	expect(applied.label).toBe('Crop 4000 × 2250');
	expect(applied.transform?.crop).toEqual({
		x: 0,
		y: 375,
		width: 4000,
		height: 2250,
	});
	await expect(page.locator('[data-slot="crop-box"]')).toBeHidden();
	await expect(button(page, 'Edit crop')).toBeFocused();
	expect(await sourceDigest(page)).toBe('unchanged');

	await page.reload();
	await expectSize(page, 4000, 2250);
	await page.getByRole('button', {name: /^Undo Crop/}).click();
	await expectSize(page, 4000, 3000);
	await page.getByRole('button', {name: /^Redo Crop/}).click();
	await expectSize(page, 4000, 2250);

	await transformToggle(page).click();
	await expectCropFields(page, [0, 375, 4000, 2250]);
	await button(page, 'Reset crop').click();
	await expectSize(page, 4000, 3000);
	const reset = await readProject(page);
	expect(reset.label).toBe('Reset crop');
	expect(reset.transform?.crop).toBeNull();
	await page.getByRole('button', {name: /^Undo Reset crop/}).click();
	await expectSize(page, 4000, 2250);
	await expectCropFields(page, [0, 375, 4000, 2250]);
});

test('AC-F20.4: resize by percent keeps the ratio, and sizes over the limits are refused', async ({
	page,
}) => {
	await openImage(page, 2000, 1000);
	await transformToggle(page).click();
	await panel(page).getByRole('radio', {name: 'Percent'}).click();
	await resizeField(page, 'Width').fill('50');
	await expect(resizeField(page, 'Height')).toHaveValue('50');
	await expect(page.locator('[data-slot="resize-output"]')).toHaveText(
		'Output 1000 × 500 px',
	);
	await button(page, 'Apply resize').click();
	await expectSize(page, 1000, 500);
	expect((await readProject(page)).label).toBe('Resize 1000 × 500');
	// The canvas leaves crop mode, so the result shows.
	await expect(page.locator('[data-slot="crop-box"]')).toBeHidden();

	await page.reload();
	await expectSize(page, 1000, 500);
	await page.getByRole('button', {name: /^Undo Resize/}).click();
	await expectSize(page, 2000, 1000);
	await page.getByRole('button', {name: /^Redo Resize/}).click();
	await expectSize(page, 1000, 500);

	await transformToggle(page).click();
	await expect(resizeField(page, 'Width')).toHaveValue('1000');
	const {entries} = await readProject(page);
	const refused = panel(page).getByRole('alert');
	await resizeField(page, 'Width').fill('20,000');
	await expect(resizeField(page, 'Height')).toHaveValue('10000');
	await expect(refused).toHaveText(LIMIT_MESSAGE);
	await expect(resizeField(page, 'Width')).toHaveAttribute(
		'aria-invalid',
		'true',
	);
	await resizeField(page, 'Width').press('Enter');
	await button(page, 'Apply resize').click();

	// Each side within 16,384 px, the area over 50 MP.
	await button(page, 'Lock aspect ratio').click();
	await resizeField(page, 'Width').fill('8000');
	await resizeField(page, 'Height').fill('7000');
	await expect(refused).toHaveText(LIMIT_MESSAGE);
	await button(page, 'Apply resize').click();

	await resizeField(page, 'Height').fill('');
	await expect(refused).toHaveText('Enter whole numbers of at least 1.');
	await panel(page).getByRole('radio', {name: 'Percent'}).click();
	await resizeField(page, 'Width').fill('1001');
	await expect(refused).toHaveText('Enter a percentage from 1 to 1000.');
	await button(page, 'Apply resize').click();
	expect((await readProject(page)).entries).toBe(entries);
	await expectSize(page, 1000, 500);

	await button(page, 'Reset resize').click();
	await expectSize(page, 2000, 1000);
	expect((await readProject(page)).label).toBe('Reset resize');
});

test('AC-F20.5: a 1200 x 800 crop made in the panel exports at full and half size', async ({
	page,
}) => {
	await openImage(page, 2000, 1500);
	await transformToggle(page).click();
	await typeCrop(page, [500, 400, 1200, 800]);
	await button(page, 'Apply crop').click();
	await expectSize(page, 1200, 800);
	expect((await exportPng(page)).size).toEqual([1200, 800]);
	expect((await exportPng(page, '1/2')).size).toEqual([600, 400]);
});

test('AC-F20.6: applying a preset leaves crop, rotation, flip and resize in place', async ({
	page,
}) => {
	await openImage(page, 800, 600);
	await transformToggle(page).click();
	await button(page, 'Rotate 90° clockwise').click();
	await button(page, 'Flip horizontal').click();
	await typeCrop(page, [50, 100, 400, 500]);
	await button(page, 'Apply crop').click();
	await expectSize(page, 400, 500);
	await resizeField(page, 'Width').fill('200');
	await chooseOption(page, 'Filter', 'Nearest');
	await button(page, 'Apply resize').click();
	await expectSize(page, 200, 250);
	const before = await readProject(page);
	expect(before.transform?.resize?.filter).toBe('nearest');

	await button(page, 'Presets').click();
	await page.getByRole('button', {name: /^ASDF classic/}).click();
	await expect
		.poll(async () => (await readProject(page)).effects?.length)
		.toBeGreaterThan(0);
	const after = await readProject(page);
	expect(after.transform).toEqual(before.transform);
	expect(after.size).toEqual([200, 250]);
});

test('AC-F20.7: every geometry control works from the keyboard alone', async ({
	page,
}) => {
	await openImage(page, 400, 300);
	await tabTo(page, transformToggle(page));
	await page.keyboard.press('Enter');
	await expect(panel(page)).toBeVisible();

	const activate = async (name: string, key = 'Enter') => {
		await tabTo(page, button(page, name));
		await page.keyboard.press(key);
	};

	await activate('Rotate 90° clockwise');
	await expectSize(page, 300, 400);
	await activate('Rotate 90° counter-clockwise', 'Space');
	await expectSize(page, 400, 300);
	await activate('Flip horizontal');
	await activate('Flip vertical');
	await expect
		.poll(async () => (await readProject(page)).transform)
		.toMatchObject({flipX: true, flipY: true});

	const aspect = panel(page).getByRole('combobox', {name: 'Aspect ratio'});
	await tabTo(page, aspect);
	await page.keyboard.press('Enter');
	const option = (name: string) =>
		page.getByRole('option', {name, exact: true});
	await expect(option('Free')).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(option('Original')).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(option('1:1')).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(aspect).toHaveText('1:1');
	await expectCropFields(page, [50, 0, 300, 300]);

	for (const [name, value] of [
		['Width', '200'],
		['Height', '100'],
		['X', '30'],
		['Y', '40'],
	]) {
		await tabTo(page, cropField(page, name));
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type(value);
		await page.keyboard.press('Enter');
	}

	await expectCropFields(page, [30, 40, 200, 100]);
	await expect(aspect).toHaveText('Free');

	await activate('Cancel');
	await expectCropFields(page, [0, 0, 400, 300]);
	await expect(button(page, 'Edit crop')).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(button(page, 'Apply crop')).toBeFocused();

	// The box and its handles, on the canvas side of the tab order.
	await typeCrop(page, [30, 40, 200, 100]);
	const handle = (name: string) => button(page, `${name} crop handle`);
	await tabTo(page, button(page, 'Move crop box'));
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Shift+ArrowDown');
	await expectCropFields(page, [31, 50, 200, 100]);
	await page.keyboard.press('Tab');
	await expect(handle('Top left')).toBeFocused();
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Shift+ArrowDown');
	await expectCropFields(page, [32, 60, 199, 90]);
	await page.keyboard.press('Tab');
	await expect(handle('Top')).toBeFocused();
	await page.keyboard.press('ArrowUp');
	// An edge handle ignores the other axis.
	await page.keyboard.press('ArrowLeft');
	await expectCropFields(page, [32, 59, 199, 91]);
	for (const [name, key] of [
		['Top right', 'Shift+ArrowLeft'],
		['Right', 'ArrowRight'],
		['Bottom right', 'ArrowDown'],
		['Bottom', 'Shift+ArrowDown'],
		['Bottom left', 'ArrowLeft'],
		['Left', 'Shift+ArrowRight'],
	]) {
		await page.keyboard.press('Tab');
		await expect(handle(name)).toBeFocused();
		await page.keyboard.press(key);
	}

	await expectCropFields(page, [41, 59, 181, 102]);
	const {entries} = await readProject(page);
	// Escape drops the box; Enter saves it.
	await page.keyboard.press('Escape');
	await expect(page.locator('[data-slot="crop-box"]')).toBeHidden();
	expect((await readProject(page)).entries).toBe(entries);

	await expect(button(page, 'Edit crop')).toBeFocused();
	await page.keyboard.press('Enter');
	await tabTo(page, handle('Bottom right'));
	await page.keyboard.press('Shift+ArrowLeft');
	await page.keyboard.press('Shift+ArrowUp');
	await page.keyboard.press('Enter');
	await expectSize(page, 390, 290);
	expect((await readProject(page)).entries).toBe(entries + 1);
	await activate('Reset crop');
	await expectSize(page, 400, 300);

	await tabTo(page, panel(page).getByRole('radio', {name: 'Pixels'}));
	await page.keyboard.press('ArrowRight');
	await expect(panel(page).getByRole('radio', {name: 'Percent'})).toBeFocused();
	await page.keyboard.press('Space');
	await expect(resizeField(page, 'Width')).toHaveValue('100');
	await tabTo(page, resizeField(page, 'Width'));
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.type('50');
	await tabTo(page, resizeField(page, 'Height'));
	await expect(resizeField(page, 'Height')).toHaveValue('50');
	await activate('Lock aspect ratio', 'Space');
	await expect(button(page, 'Lock aspect ratio')).toHaveAttribute(
		'aria-pressed',
		'false',
	);
	const filter = panel(page).getByRole('combobox', {name: 'Filter'});
	await tabTo(page, filter);
	await page.keyboard.press('Enter');
	await expect(page.getByRole('option', {name: 'Lanczos-3'})).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(page.getByRole('option', {name: 'Bilinear'})).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(filter).toHaveText('Bilinear');
	await activate('Apply resize');
	await expectSize(page, 200, 150);
	expect((await readProject(page)).transform?.resize?.filter).toBe('bilinear');
	await activate('Reset resize');
	await expectSize(page, 400, 300);

	await activate('Close transform panel');
	await expect(panel(page)).toBeHidden();
});

test('crop mode shows the whole image, suspends split view and Compare, and saves once', async ({
	page,
}) => {
	const errors = collectConsoleErrors(page);
	await openImage(page, 800, 600);
	await transformToggle(page).click();
	await typeCrop(page, [400, 300, 300, 200]);
	await button(page, 'Apply crop').click();
	await expectSize(page, 300, 200);
	await button(page, 'Close transform panel').click();
	await button(page, 'Split').click();
	const separator = page.getByRole('separator', {
		name: 'Compare split position',
	});
	await expect(separator).toBeVisible();

	await transformToggle(page).click();
	await expect(separator).toBeHidden();
	for (const name of ['Compare', 'Split', 'Switch to top/bottom view']) {
		await expect(button(page, name)).toBeDisabled();
	}

	await page.getByLabel('Image canvas').focus();
	await page.keyboard.press('s');
	await page.keyboard.press('\\');
	expect((await readProject(page)).compareMode).toBe('split');
	await expect(
		page.locator('[data-slot="compare-label-original"]'),
	).toHaveCount(0);
	// The green block lies outside the saved crop and is on screen again.
	await expect
		.poll(async () => {
			const box = await cropBox(page);
			const zoom = box.width / 300;
			return isGreen(
				await canvasPixel(page, box.x - 200 * zoom, box.y - 150 * zoom),
			);
		})
		.toBe(true);

	// Dragging a handle and the box saves nothing until Apply.
	const {entries} = await readProject(page);
	const zoom = (await cropBox(page)).width / 300;
	await dragBy(
		page,
		button(page, 'Top left crop handle'),
		-100 * zoom,
		-50 * zoom,
	);
	await expectCropFields(page, [300, 250, 400, 250]);
	const box = await cropBox(page);
	const canvas = (await page.getByLabel('Image canvas').boundingBox())!;
	await page.mouse.move(
		canvas.x + box.x + box.width / 2,
		canvas.y + box.y + box.height / 2,
	);
	await page.mouse.down();
	await page.mouse.move(
		canvas.x + box.x + box.width / 2 - 200 * zoom,
		canvas.y + box.y + box.height / 2 - 100 * zoom,
		{steps: 5},
	);
	await expect(page.locator('[data-slot="crop-guide"]')).toHaveCount(4);
	await page.mouse.up();
	await expect(page.locator('[data-slot="crop-guide"]')).toHaveCount(0);
	await expectCropFields(page, [100, 150, 400, 250]);
	expect((await readProject(page)).entries).toBe(entries);

	// A turn takes the unsaved box with it.
	await button(page, 'Rotate 90° clockwise').click();
	await expectCropFields(page, [200, 100, 250, 400]);
	await expect(
		panel(page).getByText('Apply or cancel the crop first.'),
	).toBeVisible();
	await expect(button(page, 'Apply resize')).toBeDisabled();
	await button(page, 'Apply crop').click();
	await expectSize(page, 250, 400);
	await expect(separator).toBeVisible();
	await expect(button(page, 'Split')).toBeEnabled();
	expect(errors).toEqual([]);
});

test('the crop box stays on its pixels under zoom and pan, and the saved view returns', async ({
	page,
}) => {
	await openImage(page, 800, 600);
	const canvas = page.getByLabel('Image canvas');
	await page.getByRole('button', {name: /^Zoom/}).click();
	await page.getByRole('menuitem', {name: '200%'}).click();
	await transformToggle(page).click();
	// The green block of the seeded image.
	await typeCrop(page, [100, 75, 200, 150]);

	// Just inside every edge is green, just outside is not.
	const expectAligned = async () => {
		await expect
			.poll(async () => {
				const box = await cropBox(page);
				const inset = 4;
				const midX = box.x + box.width / 2;
				const midY = box.y + box.height / 2;
				const right = box.x + box.width;
				const bottom = box.y + box.height;
				const inside = await Promise.all(
					[
						[box.x + inset, midY],
						[right - inset, midY],
						[midX, box.y + inset],
						[midX, bottom - inset],
					].map(async ([x, y]) => isGreen(await canvasPixel(page, x, y))),
				);
				const outside = await Promise.all(
					[
						[box.x - inset, midY],
						[right + inset, midY],
						[midX, box.y - inset],
						[midX, bottom + inset],
					].map(async ([x, y]) => isGreen(await canvasPixel(page, x, y))),
				);
				return [...inside, ...outside.map((value) => !value)];
			})
			.toEqual(Array.from({length: 8}, () => true));
	};

	await expectAligned();
	const fitted = await cropBox(page);

	// Zoom around the box's centre with the wheel, then pan with the wheel and by
	// dragging outside the box.
	const area = (await canvas.boundingBox())!;
	await page.mouse.move(
		area.x + fitted.x + fitted.width / 2,
		area.y + fitted.y + fitted.height / 2,
	);
	await page.keyboard.down('Control');
	await page.mouse.wheel(0, -400);
	await page.keyboard.up('Control');
	await expect
		.poll(async () => (await cropBox(page)).width)
		.toBeGreaterThan(fitted.width * 1.4);
	await expectAligned();
	const zoomed = await cropBox(page);
	await page.mouse.wheel(30, 20);
	await expect
		.poll(async () => Math.round(zoomed.x - (await cropBox(page)).x))
		.toBe(30);
	await expectAligned();
	const panned = await cropBox(page);
	await page.mouse.move(area.x + 20, area.y + 20);
	await page.mouse.down();
	await page.mouse.move(area.x + 50, area.y + 40, {steps: 4});
	await page.mouse.up();
	await expect
		.poll(async () => Math.round((await cropBox(page)).x - panned.x))
		.toBe(30);
	await expectAligned();
	await expectCropFields(page, [100, 75, 200, 150]);

	// Space drags the image from inside the box.
	const held = await cropBox(page);
	await page.mouse.move(
		area.x + held.x + held.width / 2,
		area.y + held.y + held.height / 2,
	);
	await page.keyboard.down('Space');
	await page.mouse.down();
	await page.mouse.move(
		area.x + held.x + held.width / 2 + 25,
		area.y + held.y + held.height / 2,
		{steps: 4},
	);
	await page.mouse.up();
	await page.keyboard.up('Space');
	await expect
		.poll(async () => Math.round((await cropBox(page)).x - held.x))
		.toBe(25);
	await expectCropFields(page, [100, 75, 200, 150]);

	await canvas.focus();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('button', {name: /^Zoom/})).toHaveText(/200%/);
});

test('a locked ratio holds while dragging, and a new crop size drops the resize', async ({
	page,
}) => {
	await openImage(page, 800, 600);
	await transformToggle(page).click();
	await resizeField(page, 'Width').fill('400');
	await button(page, 'Apply resize').click();
	await expectSize(page, 400, 300);
	await chooseOption(page, 'Aspect ratio', '1:1');
	await expect(
		panel(page).getByText('Applying this crop removes the resize.'),
	).toBeVisible();
	const zoom = (await cropBox(page)).width / 600;
	await dragBy(
		page,
		button(page, 'Bottom right crop handle'),
		-200 * zoom,
		-20 * zoom,
	);
	await expectCropFields(page, [100, 0, 400, 400]);
	await page.keyboard.press('ArrowDown');
	await expectCropFields(page, [100, 0, 401, 401]);
	await page.keyboard.press('Enter');
	await expectSize(page, 401, 401);
	expect((await readProject(page)).transform?.resize).toBeNull();
	await page.getByRole('button', {name: /^Undo Crop/}).click();
	await expectSize(page, 400, 300);
});

test('selecting an effect gives the panel back to its parameters', async ({
	page,
}) => {
	await openImage(page, 320, 240);
	await transformToggle(page).click();
	await button(page, 'Add effect').first().click();
	await page
		.locator('[data-slot="popover-content"]')
		.getByRole('button', {name: /^Pixel sort/})
		.click();
	await expect(panel(page)).toBeHidden();
	await expect(transformToggle(page)).toHaveAttribute('aria-pressed', 'false');
});

const THEMES = [
	{name: 'light', media: 'light'},
	{name: 'dark', media: 'dark'},
] as const;

for (const theme of THEMES) {
	for (const viewport of PROOF_VIEWPORTS) {
		test(`the geometry panel at ${viewport.width}x${viewport.height} in ${theme.name} fits and passes axe @a11y`, async ({
			page,
		}) => {
			const errors = collectConsoleErrors(page);
			await page.emulateMedia({colorScheme: theme.media});
			await page.setViewportSize(viewport);
			await openImage(page, 800, 600);
			await transformToggle(page).click();
			await chooseOption(page, 'Aspect ratio', '4:3');
			await expect(panel(page)).toBeVisible();
			for (const name of ['Top left', 'Bottom right']) {
				await expect(button(page, `${name} crop handle`)).toBeInViewport();
			}

			const overflow = await page.evaluate(
				() =>
					globalThis.document.documentElement.scrollWidth -
					globalThis.innerWidth,
			);
			expect(overflow).toBeLessThanOrEqual(0);
			await assertNoA11yViolations(page);
			await resizeField(page, 'Width').fill('20000');
			await assertNoA11yViolations(page);
			expect(errors).toEqual([]);
		});
	}
}

test.describe('on a touch screen', () => {
	test.skip(
		({browserName}) => browserName !== 'chromium',
		'Playwright emulates a coarse pointer in Chromium only',
	);
	test.use({
		viewport: {width: 390, height: 844},
		hasTouch: true,
		isMobile: true,
	});

	test('geometry controls and crop handles are at least 44 px', async ({
		page,
	}) => {
		await openImage(page, 800, 600);
		await transformToggle(page).click();
		const small = await page.evaluate(() => {
			const found: string[] = [];
			for (const element of globalThis.document.querySelectorAll(
				'[data-slot="geometry-panel"] :is(button, input), [data-crop-handle]',
			)) {
				const rect = element.getBoundingClientRect();
				const isInput = element.tagName === 'INPUT';
				if (
					rect.width > 0 &&
					(rect.height < 43.5 || (!isInput && rect.width < 43.5))
				) {
					found.push(
						`${element.getAttribute('aria-label') ?? element.textContent} ${rect.width}x${rect.height}`,
					);
				}
			}

			return found;
		});
		expect(small).toEqual([]);
	});
});
