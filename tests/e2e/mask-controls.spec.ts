// The Mask group, its overlay and the stack badge (product.md F29, DESIGN.md
// section 7.4).
import {Buffer} from 'node:buffer';
import {mkdir, readFile} from 'node:fs/promises';
import {expect, test, type Page} from '@playwright/test';
import {decode as decodePng, encode as encodePng} from 'fast-png';
import type {RgbaImage} from '../../src/engine/types.ts';
import type {AppRuntime} from '../../src/state/index.ts';
import {assertNoA11yViolations} from './axe.ts';
import {chooseImages, readImportState, type ChosenFixture} from './import.ts';
import {syntheticImage} from './render-fixtures.ts';
import {waitForSettleRender} from './settle.ts';
import {PROOF_VIEWPORTS} from './viewports.ts';

type RuntimeGlobal = {__psgRuntime?: AppRuntime};

const WIDTH = 160;
const HEIGHT = 120;
// The centre of the canvas fixture below, well away from its overlays.
const GREY = [100, 100, 100, 255];

function pngFixture(name: string, image: RgbaImage): ChosenFixture {
	return {
		name,
		mimeType: 'image/png',
		buffer: Buffer.from(
			encodePng({
				width: image.width,
				height: image.height,
				data: new Uint8Array(image.data),
				channels: 4,
			}),
		),
	};
}

function filled(
	width: number,
	height: number,
	colour: (x: number, y: number) => readonly number[],
): RgbaImage {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			data.set(colour(x, y), (y * width + x) * 4);
		}
	}

	return {width, height, data};
}

const base = syntheticImage(WIDTH, HEIGHT);

function trackProblems(page: Page): string[] {
	const problems: string[] = [];
	page.on('pageerror', (error) => {
		problems.push(error.message);
	});
	page.on('console', (message) => {
		if (message.type() === 'error') {
			problems.push(message.text());
		}
	});
	return problems;
}

async function openBase(
	page: Page,
	fixture = pngFixture('base.png', base),
): Promise<void> {
	// See image-control.spec.ts: a listener must exist before the picker opens.
	page.on('filechooser', () => {});
	await page.goto('/');
	await chooseImages(page, [fixture]);
	await waitForSettleRender(page);
}

async function addEffect(page: Page, name: string): Promise<void> {
	await page.getByRole('button', {name: 'Add effect'}).click();
	await page
		.getByRole('dialog', {name: 'Add effect'})
		.getByRole('button', {name: new RegExp(`^${name}`)})
		.click();
	await expect(
		page.getByRole('button', {name: `${name} actions`}).last(),
	).toBeVisible();
}

const panel = (page: Page) => page.locator('[data-slot="parameter-panel"]');
const showMask = (page: Page) =>
	panel(page).getByRole('switch', {name: 'Show mask'});

async function readEditor(page: Page) {
	return page.evaluate(async () => {
		const booted = await (globalThis as unknown as RuntimeGlobal).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error(booted.status);
		}

		const {activeProject, history} = booted.bundle.store.getState();
		return {
			head: activeProject!.historyHeadSeq,
			label: history.find((item) => item.seq === activeProject!.historyHeadSeq)
				?.label,
			masks: activeProject!.stack.instances.map((instance) => instance.mask),
		};
	});
}

async function addMask(
	page: Page,
	kind: 'Paint' | 'Brightness' | 'Image',
): Promise<void> {
	await panel(page).getByRole('button', {name: 'Add mask'}).click();
	await page.getByRole('menuitem', {name: kind}).click();
	await expect(
		panel(page).getByRole('radio', {name: kind, exact: true}),
	).toBeFocused();
}

async function setField(
	page: Page,
	name: string,
	value: string,
): Promise<void> {
	const field = panel(page).getByRole('textbox', {name, exact: true});
	await field.fill(value);
	await field.press('Enter');
}

// The pixels of the newest settle frame that has every input.
async function previewData(page: Page): Promise<number[] | null> {
	return page.evaluate(async () => {
		const booted = await (globalThis as unknown as RuntimeGlobal).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error(booted.status);
		}

		const {frame, busy} = booted.bundle.store.getState().render;
		if (
			frame?.level !== 'settle' ||
			frame.sourcesPending ||
			frame.warnings.length > 0 ||
			busy.settle ||
			busy.drag
		) {
			return null;
		}

		const canvas = new globalThis.OffscreenCanvas(frame.width, frame.height);
		const context = canvas.getContext('2d', {willReadFrequently: true})!;
		context.drawImage(frame.bitmap, 0, 0);
		return [...context.getImageData(0, 0, frame.width, frame.height).data];
	});
}

async function expectPreview(
	page: Page,
	pixels: readonly number[],
): Promise<void> {
	await expect
		.poll(async () => {
			const data = await previewData(page);
			return (
				data?.length === pixels.length &&
				data.every((value, index) => value === pixels[index])
			);
		})
		.toBe(true);
}

async function exportPng(page: Page): Promise<number[]> {
	await page.getByRole('button', {name: 'Export'}).click();
	const dialog = page.getByRole('dialog', {name: 'Export'});
	await dialog.getByRole('radio', {name: 'PNG', exact: true}).click();
	const pending = page.waitForEvent('download');
	await dialog.getByRole('button', {name: 'Download'}).click();
	const download = await pending;
	const png = decodePng(await readFile(await download.path()));
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	return [...png.data];
}

/**
 Gives the selected instance a painted mask whose value depends on the column.
 There is no brush yet, so the asset is stored the way a stroke will store it.
 */
async function paintColumns(
	page: Page,
	painted: readonly [number, number],
): Promise<void> {
	await page.evaluate(
		async ([from, to]) => {
			const booted = await (globalThis as unknown as RuntimeGlobal)
				.__psgRuntime!.ready;
			if (booted.status !== 'ready') {
				throw new Error(booted.status);
			}

			const {store, repository} = booted.bundle;
			const project = store.getState().activeProject!;
			const {sourceWidth: width, sourceHeight: height} = project;
			const bytes = new Uint8Array(12 + width * height);
			bytes.set([0x44, 0x4d, 0x53, 0x4b]);
			const header = new DataView(bytes.buffer);
			header.setUint32(4, width, true);
			header.setUint32(8, height, true);
			for (let y = 0; y < height; y++) {
				bytes.fill(255, 12 + y * width + from, 12 + y * width + to);
			}

			const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
			const sha256 = Array.from(new Uint8Array(digest), (byte) =>
				byte.toString(16).padStart(2, '0'),
			).join('');
			const blob = await new Response(
				new Blob([bytes])
					.stream()
					.pipeThrough(new globalThis.CompressionStream('deflate-raw')),
			).blob();
			const selected = project.selectedInstanceId;
			await repository.commitStack({
				projectId: project.id,
				stack: {
					schemaVersion: 2,
					instances: project.stack.instances.map((instance) =>
						instance.id === selected
							? {
									...instance,
									mask: {
										kind: 'paint',
										asset: sha256,
										invert: false,
										feather: 0,
									},
								}
							: instance,
					),
				},
				selectedInstanceId: selected,
				label: 'Paint mask',
				newMasks: [{sha256, width, height, blob}],
			});
		},
		[...painted],
	);
	await page.reload();
	await waitForSettleRender(page);
}

// `inside` where `affected` says so, else `outside`, pixel by pixel.
function merged(
	affected: (x: number, offset: number) => boolean,
	inside: readonly number[],
	outside: readonly number[],
): number[] {
	return outside.map((value, index) => {
		const offset = index - (index % 4);
		return affected((offset / 4) % WIDTH, offset) ? inside[index] : value;
	});
}

// A swap no pixel of the fixture is a fixed point of by accident.
async function addSwap(page: Page): Promise<void> {
	await addEffect(page, 'Channel swap');
	await panel(page).getByRole('combobox', {name: 'Channel order'}).click();
	await page.getByRole('option', {name: 'BRG'}).click();
}

test('AC-F29.1: a new painted mask hides the effect, Fill and Remove mask restore it', async ({
	page,
}) => {
	const problems = trackProblems(page);
	await openBase(page);
	await addEffect(page, 'Pixel sort');
	await waitForSettleRender(page);
	const sorted = await exportPng(page);
	const toggle = page.getByRole('switch', {name: 'Pixel sort'});
	await toggle.click();
	const off = await exportPng(page);
	expect(off).not.toEqual(sorted);
	await toggle.click();
	await expectPreview(page, sorted);
	await expect(page.getByText('Has mask')).toHaveCount(0);

	const start = (await readEditor(page)).head;
	await addMask(page, 'Paint');
	await expect(panel(page)).toContainText('Nothing is painted yet.');
	await expectPreview(page, off);
	expect(await exportPng(page)).toEqual(off);
	await expect(page.getByText('Has mask')).toBeAttached();
	expect(await readEditor(page)).toMatchObject({
		head: start + 1,
		label: 'Add paint mask',
	});

	await panel(page).getByRole('button', {name: 'Fill', exact: true}).click();
	await expect(panel(page)).not.toContainText('Nothing is painted yet.');
	await expectPreview(page, sorted);
	expect(await exportPng(page)).toEqual(sorted);
	expect(await readEditor(page)).toMatchObject({
		head: start + 2,
		label: 'Fill mask',
	});

	await panel(page).getByRole('button', {name: 'Clear', exact: true}).click();
	await expectPreview(page, off);
	expect((await readEditor(page)).label).toBe('Clear mask');

	// The mask and its pixels survive a reload.
	await page.getByRole('button', {name: 'Undo Clear mask'}).click();
	await expectPreview(page, sorted);
	await page.reload();
	await expect(
		panel(page).getByRole('radio', {name: 'Paint', exact: true}),
	).toHaveAttribute('data-state', 'on');
	await expect(page.getByText('Has mask')).toBeAttached();
	await expect(panel(page).getByText('Missing mask')).toHaveCount(0);
	await expectPreview(page, sorted);

	const {head} = await readEditor(page);
	await panel(page).getByRole('button', {name: 'Remove mask'}).click();
	await expect(
		panel(page).getByRole('button', {name: 'Add mask'}),
	).toBeFocused();
	await expect(page.getByText('Has mask')).toHaveCount(0);
	await expectPreview(page, sorted);
	expect(await exportPng(page)).toEqual(sorted);
	expect(await readEditor(page)).toMatchObject({
		head: head + 1,
		label: 'Remove mask',
		masks: [undefined],
	});
	expect(problems).toEqual([]);
});

test('AC-F29.3: Invert mask keeps the painted area and affects the rest', async ({
	page,
}) => {
	await openBase(page);
	await addSwap(page);
	await waitForSettleRender(page);
	const swapped = await exportPng(page);
	const original = [...base.data];
	await paintColumns(page, [0, WIDTH / 2]);
	const left = merged((x) => x < WIDTH / 2, swapped, original);
	await expectPreview(page, left);

	const invert = panel(page).getByRole('switch', {name: 'Invert mask'});
	await invert.click();
	const right = merged((x) => x >= WIDTH / 2, swapped, original);
	await expectPreview(page, right);
	expect(await exportPng(page)).toEqual(right);
	expect((await readEditor(page)).label).toBe('Invert mask on');

	await invert.click();
	await expectPreview(page, left);
	expect(await exportPng(page)).toEqual(left);
});

test('AC-F29.10: a brightness mask selects by the photo, whatever runs above it', async ({
	page,
}) => {
	await openBase(page);
	await addSwap(page);
	await addMask(page, 'Brightness');
	await expect(
		panel(page).getByRole('textbox', {name: 'Low', exact: true}),
	).toHaveValue('50%');
	await expect(
		panel(page).getByRole('textbox', {name: 'High', exact: true}),
	).toHaveValue('100%');
	await setField(page, 'Softness', '0');
	await expect(
		page.getByRole('button', {name: 'Undo Mask softness 0%'}),
	).toBeEnabled();

	const bright = (_x: number, offset: number) => {
		const [r, g, b] = base.data.subarray(offset, offset + 3);
		return Math.floor((2126 * r + 7152 * g + 722 * b + 5000) / 10_000) >= 128;
	};

	const original = [...base.data];
	// BRG: each output channel reads the one before it.
	const swap = (data: readonly number[]) =>
		data.map((value, index) => {
			const channel = index % 4;
			return channel === 3
				? value
				: data[index - channel + ((channel + 2) % 3)];
		});
	const masked = merged(bright, swap(original), original);
	await expectPreview(page, masked);
	expect(await exportPng(page)).toEqual(masked);

	// A second swap above the masked one changes its input, not its selection.
	await addSwap(page);
	await page.getByRole('button', {name: 'Channel swap actions'}).last().click();
	await page.getByRole('menuitem', {name: 'Move up'}).click();
	const above = swap(original);
	const both = merged(bright, swap(above), above);
	await expectPreview(page, both);
	expect(await exportPng(page)).toEqual(both);

	// The range and its keyboard steps commit as percentages.
	await page
		.locator('[data-index="1"]')
		.getByRole('button', {name: /^Channel swap Has mask/})
		.click();
	const low = panel(page).getByRole('slider', {name: 'Mask range low'});
	await low.focus();
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	await expect(
		page.getByRole('button', {name: 'Undo Mask range 52% to 100%'}),
	).toBeEnabled();
	await setField(page, 'Mask feather', '32');
	await expect(
		page.getByRole('button', {name: 'Undo Mask feather 32 px'}),
	).toBeEnabled();
});

test('AC-F29.11: an image mask limits the effect, is stored once and outlives its project', async ({
	page,
}) => {
	await openBase(page);
	const stencil = filled(WIDTH, HEIGHT, (x) =>
		x < WIDTH / 2 ? [255, 255, 255, 255] : [0, 0, 0, 255],
	);
	await page.getByRole('button', {name: 'Back to library'}).click();
	await chooseImages(page, [pngFixture('stencil.png', stencil)]);
	await waitForSettleRender(page);
	await page.getByRole('button', {name: 'Back to library'}).click();
	await page.getByRole('button', {name: 'Open base'}).click();
	await waitForSettleRender(page);
	await addSwap(page);
	await waitForSettleRender(page);
	const swapped = await exportPng(page);

	await addMask(page, 'Image');
	await expect(panel(page)).toContainText('No image selected');
	await panel(page)
		.getByRole('button', {name: 'Choose image', exact: true})
		.click();
	const chooser = page.getByRole('dialog', {name: 'Choose image'});
	await chooser.getByRole('button', {name: 'From library'}).click();
	await chooser.getByRole('button', {name: /^stencil \d/}).click();
	await panel(page).getByRole('radio', {name: 'Stretch'}).click();
	const half = merged((x) => x < WIDTH / 2, swapped, [...base.data]);
	await expectPreview(page, half);
	expect(await exportPng(page)).toEqual(half);
	expect((await readEditor(page)).label).toBe('Mask fit Stretch');
	expect((await readImportState(page)).sourceCount).toBe(2);

	await page.evaluate(async () => {
		const booted = await (globalThis as unknown as RuntimeGlobal).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error(booted.status);
		}

		const {store} = booted.bundle;
		const project = store
			.getState()
			.projects.find((item) => item.name === 'stencil')!;
		await store.getState().deleteProject(project.id);
	});
	expect((await readImportState(page)).sourceCount).toBe(2);
	await page.reload();
	await expectPreview(page, half);
	await expect(panel(page)).toContainText('160 × 120 px');
	await expect(panel(page).getByText('Missing mask')).toHaveCount(0);
});

test('AC-F29.12: no pixel sort run crosses a zero area, and Show selection darkens it', async ({
	page,
}) => {
	await openBase(page);
	await addEffect(page, 'Pixel sort');
	await waitForSettleRender(page);
	// Columns 100 onwards stay zero; the sort runs along the rows.
	await paintColumns(page, [0, 100]);
	const output = await exportPng(page);
	const original = [...base.data];
	expect(output).not.toEqual(original);
	const row = (data: readonly number[], y: number) =>
		Array.from({length: 100}, (_, x) =>
			data.slice((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 4).join(','),
		).toSorted();
	for (let y = 0; y < HEIGHT; y++) {
		// The painted columns hold the same pixels, so nothing crossed the edge.
		expect(row(output, y)).toEqual(row(original, y));
		expect(output.slice((y * WIDTH + 100) * 4, (y + 1) * WIDTH * 4)).toEqual(
			original.slice((y * WIDTH + 100) * 4, (y + 1) * WIDTH * 4),
		);
	}

	await panel(page).getByRole('switch', {name: 'Show selection'}).click();
	const darkened = original.map((value, index) =>
		index % 4 === 3 ? value : Math.floor(value / 4),
	);
	await expect
		.poll(async () => {
			const data = await previewData(page);
			return (
				data !== null &&
				data.every(
					(value, index) =>
						Math.floor(index / 4) % WIDTH < 100 || value === darkened[index],
				)
			);
		})
		.toBe(true);
});

test('AC-F29.15: a saved preset keeps only the brightness mask', async ({
	page,
}) => {
	await openBase(page);
	await addSwap(page);
	await addMask(page, 'Paint');
	await panel(page).getByRole('button', {name: 'Fill', exact: true}).click();
	await addSwap(page);
	await addMask(page, 'Image');
	await panel(page)
		.getByRole('button', {name: 'Choose image', exact: true})
		.click();
	const pending = page.waitForEvent('filechooser');
	await page
		.getByRole('dialog', {name: 'Choose image'})
		.getByRole('button', {name: 'From device'})
		.click();
	const files = await pending;
	await files.setFiles(
		pngFixture(
			'white.png',
			filled(8, 8, () => [255, 255, 255, 255]),
		),
	);
	await expect(panel(page)).toContainText('8 × 8 px');
	await addSwap(page);
	await addMask(page, 'Brightness');
	await expect(page.getByText('Has mask')).toHaveCount(3);

	await page.getByRole('button', {name: 'Presets'}).click();
	await page.getByRole('button', {name: 'Save as preset'}).click();
	const dialog = page.getByRole('dialog', {name: 'Save as preset'});
	await dialog.getByLabel('Preset name').fill('Masked look');
	await dialog.getByRole('button', {name: 'Save preset'}).click();
	await expect(dialog).toHaveCount(0);
	await page.getByRole('button', {name: 'Back to library'}).click();
	await chooseImages(page, [pngFixture('other.png', syntheticImage(90, 70))]);
	await waitForSettleRender(page);
	await page.getByRole('button', {name: 'Presets'}).click();
	await page
		.getByRole('list', {name: 'Saved presets'})
		.getByRole('button', {name: /^Masked look \d/})
		.click();

	await expect(page.getByText('Has mask')).toHaveCount(1);
	const {masks} = await readEditor(page);
	expect(masks.map((mask) => mask?.kind)).toEqual([
		undefined,
		undefined,
		'luma',
	]);
});

// The colour the canvas shows at a fraction of the image's width, mid height.
async function canvasPixel(page: Page, fraction = 0.5): Promise<number[]> {
	return page.evaluate(
		async ([at, width]) => {
			const booted = await (globalThis as unknown as RuntimeGlobal)
				.__psgRuntime!.ready;
			if (booted.status !== 'ready') {
				throw new Error(booted.status);
			}

			const canvas = globalThis.document.querySelector<HTMLCanvasElement>(
				'canvas[aria-label="Image canvas"]',
			)!;
			const {zoom} = booted.bundle.store.getState().activeProject!.viewState;
			const ratio = canvas.width / canvas.clientWidth;
			const x = canvas.clientWidth / 2 + (at - 0.5) * width * zoom;
			return [
				...canvas
					.getContext('2d')!
					.getImageData(
						Math.round(x * ratio),
						Math.round((canvas.clientHeight / 2) * ratio),
						1,
						1,
					).data,
			];
		},
		[fraction, WIDTH],
	);
}

// `#ff2d55` at `alpha` over the grey photo, within the canvas's rounding.
async function expectTint(
	page: Page,
	alpha: number,
	fraction = 0.5,
): Promise<void> {
	const expected = [255, 45, 85].map((value, index) =>
		Math.round(value * alpha + GREY[index] * (1 - alpha)),
	);
	await expect
		.poll(async () => {
			const pixel = await canvasPixel(page, fraction);
			return expected.every(
				(value, index) => Math.abs(value - pixel[index]) <= 3,
			);
		})
		.toBe(true);
}

test('Show mask: the overlay follows the switch, M, opacity, compare and split, and stays out of exports', async ({
	page,
}) => {
	const problems = trackProblems(page);
	await openBase(
		page,
		pngFixture(
			'grey.png',
			filled(WIDTH, HEIGHT, () => GREY),
		),
	);
	await addSwap(page);
	await waitForSettleRender(page);
	// Without a mask the key does nothing.
	await page.keyboard.press('m');
	await addMask(page, 'Paint');
	await expect(showMask(page)).toBeChecked();
	await expectTint(page, 0);
	await panel(page).getByRole('button', {name: 'Fill', exact: true}).click();
	await expectTint(page, 0.5);
	const exported = await exportPng(page);
	expect(exported.slice(0, 4)).toEqual(GREY);
	const {head} = await readEditor(page);

	await page.keyboard.press('m');
	await expect(showMask(page)).not.toBeChecked();
	await expect(
		panel(page).getByRole('textbox', {name: 'Overlay opacity'}),
	).toHaveCount(0);
	await expectTint(page, 0);
	await expect(page.getByText('Mask hidden')).toBeAttached();
	await page.keyboard.press('Shift+M');
	await expect(showMask(page)).toBeChecked();
	await expectTint(page, 0.5);

	await setField(page, 'Overlay opacity', '100');
	await expectTint(page, 1);
	expect((await readEditor(page)).head).toBe(head);

	// Not while typing, and not under a dialog.
	await panel(page).getByRole('textbox', {name: 'Mix'}).focus();
	await page.keyboard.press('m');
	await expect(showMask(page)).toBeChecked();
	await page.keyboard.press('Escape');
	await page.getByRole('button', {name: 'Export'}).click();
	await page.keyboard.press('m');
	await page.keyboard.press('Escape');
	await expect(showMask(page)).toBeChecked();

	// Compare hides it.
	await page.locator('canvas[aria-label="Image canvas"]').focus();
	await page.keyboard.press('\\');
	await expectTint(page, 0);
	await page.keyboard.press('\\');
	await expectTint(page, 1);

	// Split view draws it over the side being edited only.
	await page.keyboard.press('s');
	await expectTint(page, 1, 0.75);
	await expectTint(page, 0, 0.25);
	await page.evaluate(async () => {
		const booted = await (globalThis as unknown as RuntimeGlobal).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error(booted.status);
		}

		const {store} = booted.bundle;
		await store.getState().copyToOtherSide();
		await store.getState().setEditSide('a');
		const [copy] = store.getState().activeProject!.stackA!.instances;
		store.getState().selectEffect(copy.id);
	});
	await expectTint(page, 1, 0.25);
	await expectTint(page, 0, 0.75);
	await page.evaluate(async () => {
		const booted = await (globalThis as unknown as RuntimeGlobal).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error(booted.status);
		}

		await booted.bundle.store.getState().setEditSide('b');
	});
	await page.keyboard.press('s');
	await expectTint(page, 1, 0.25);

	// Pan and zoom carry it along.
	await page.keyboard.press('+');
	await expectTint(page, 1, 0.6);
	await page.keyboard.press('0');

	// Deselecting the instance removes it.
	await addSwap(page);
	await expectTint(page, 0);
	expect(problems).toEqual([]);
});

test('a painted mask that storage lost shows Missing mask and skips the effect', async ({
	page,
}) => {
	await openBase(page);
	await addSwap(page);
	await addMask(page, 'Paint');
	await panel(page).getByRole('button', {name: 'Fill', exact: true}).click();
	await expect(panel(page)).not.toContainText('Nothing is painted yet.');
	await page.evaluate(
		async () =>
			new Promise<void>((resolve, reject) => {
				const request = globalThis.indexedDB.open('drift');
				request.addEventListener('success', () => {
					const transaction = request.result.transaction('masks', 'readwrite');
					transaction.objectStore('masks').clear();
					transaction.addEventListener('complete', () => {
						request.result.close();
						resolve();
					});
					transaction.addEventListener('error', () => {
						reject(new Error('Delete failed'));
					});
				});
			}),
	);
	await page.reload();
	await waitForSettleRender(page);

	await expect(panel(page).getByText('Missing mask')).toBeVisible();
	// The effect is skipped, not applied everywhere.
	expect(await exportPng(page)).toEqual([...base.data]);
	// Fill stores the pixels again.
	await panel(page).getByRole('button', {name: 'Fill', exact: true}).click();
	await expect(panel(page).getByText('Missing mask')).toHaveCount(0);
});

const THEMES = [
	{name: 'light', stored: 'light'},
	{name: 'true-black', stored: 'dark'},
] as const;

async function assertNoHorizontalScroll(page: Page): Promise<void> {
	expect(
		await page.evaluate(
			() =>
				globalThis.document.documentElement.scrollWidth -
				globalThis.document.documentElement.clientWidth,
		),
	).toBeLessThanOrEqual(0);
}

// Every visible mask control is at least 44 px in both directions.
async function smallTargets(page: Page): Promise<string[]> {
	return page.evaluate(() =>
		[
			...globalThis.document.querySelectorAll<HTMLElement>(
				'[data-slot="parameter-panel"] button:is([data-slot="add-mask"], [role="switch"]), [data-slot="mask-type"] button',
			),
		]
			.map((node) => ({node, box: node.getBoundingClientRect()}))
			.filter(
				({box}) => box.width > 0 && (box.width < 43.5 || box.height < 43.5),
			)
			.map(
				({node, box}) =>
					`${node.textContent || node.id} ${box.width}x${box.height}`,
			),
	);
}

for (const theme of THEMES) {
	for (const viewport of PROOF_VIEWPORTS) {
		test(`mask controls at ${viewport.width}x${viewport.height} in ${theme.name} @a11y`, async ({
			browser,
			browserName,
			baseURL,
		}) => {
			const phone = viewport.name === 'phone';
			// Playwright emulates a coarse pointer in Chromium only.
			const coarse = browserName === 'chromium' && viewport.name !== 'desktop';
			const context = await browser.newContext({
				baseURL,
				viewport,
				// Axe must not read colours half way through a transition.
				reducedMotion: 'reduce',
				...(coarse && {hasTouch: true, isMobile: true}),
			});
			await context.addInitScript((stored) => {
				globalThis.localStorage.setItem('drift:theme', stored);
			}, theme.stored);
			const page = await context.newPage();
			const problems = trackProblems(page);
			const shot = async (name: string) => {
				await mkdir('.proof', {recursive: true});
				await page.screenshot({
					path: `.proof/mask-${viewport.width}-${theme.name}-${name}.png`,
				});
			};

			const tab = async (name: string) => {
				if (phone) {
					await page.getByRole('tab', {name, exact: true}).click();
				}
			};

			await openBase(page, pngFixture('base.png', syntheticImage(900, 600)));
			await addEffect(page, 'Pixel sort');
			await waitForSettleRender(page);
			await tab('Mask');
			const maskButton = panel(page).getByRole('button', {name: 'Add mask'});
			await maskButton.scrollIntoViewIfNeeded();
			if (coarse) {
				expect(await smallTargets(page)).toEqual([]);
			}

			for (const kind of ['Paint', 'Image', 'Brightness'] as const) {
				if (kind === 'Paint') {
					await maskButton.click();
					await page.getByRole('menuitem', {name: kind}).click();
				} else {
					await tab('Mask');
					await panel(page)
						.getByRole('radio', {name: kind, exact: true})
						.click();
				}

				await expect(
					panel(page).getByRole('radio', {name: kind, exact: true}),
				).toHaveAttribute('data-state', 'on');
				await assertNoHorizontalScroll(page);
				await assertNoA11yViolations(page);
				if (coarse) {
					expect(await smallTargets(page)).toEqual([]);
				}
			}

			// A range that covers only the dark disc, so the shots show the tint.
			await tab('Range');
			// The effect's own threshold has fields of the same names.
			for (const [end, value, shown] of [
				[0, '0', '0% to 100%'],
				[1, '25', '0% to 25%'],
			] as const) {
				const field = panel(page).locator(`[id$="-mask-range-${end}"]`);
				await field.fill(value);
				await field.press('Enter');
				await expect(
					page.getByRole('button', {name: `Undo Mask range ${shown}`}),
				).toBeAttached();
			}

			if (phone) {
				for (const name of ['Feather', 'Overlay', 'Range', 'Softness']) {
					await tab(name);
					await assertNoHorizontalScroll(page);
					await assertNoA11yViolations(page);
				}

				await tab('Range');
				// One control shown: the canvas keeps at least half of the height.
				const canvas = await page
					.locator('canvas[aria-label="Image canvas"]')
					.boundingBox();
				expect(canvas!.height).toBeGreaterThanOrEqual(viewport.height * 0.5);
				await shot('range');
				await tab('Mask');
			} else {
				await panel(page)
					.getByRole('button', {name: 'Remove mask'})
					.scrollIntoViewIfNeeded();
			}

			await expect(page.getByText('Has mask')).toBeAttached();
			await waitForSettleRender(page);
			await shot('mask');
			expect(problems).toEqual([]);
			await context.close();
		});
	}
}
