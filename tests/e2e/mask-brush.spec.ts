// The mask brush (product.md F29, DESIGN.md section 7.4). Strokes run in the real
// mask worker, and the results are read back from storage and exported files.
// Pen and touch input is synthetic: no pen or touch hardware is driven here.
import {mkdir} from 'node:fs/promises';
import {expect, test, type Page} from '@playwright/test';
import type {SourceTransform} from '../../src/engine/transform.ts';
import {assertNoA11yViolations} from './axe.ts';
import {
	addEffect,
	addMask,
	expectPreview,
	exportPng,
	openBase,
	panel,
	pngFixture,
	readEditor,
	setField,
	trackProblems,
	type RuntimeGlobal,
} from './mask-helpers.ts';
import {syntheticImage} from './render-fixtures.ts';
import {waitForSettleRender} from './settle.ts';
import {PROOF_VIEWPORTS} from './viewports.ts';

const WIDTH = 160;
const HEIGHT = 120;
const base = syntheticImage(WIDTH, HEIGHT);

type Point = {x: number; y: number};
type PointerKind = 'mouse' | 'pen' | 'touch';

const canvas = (page: Page) => page.getByLabel('Image canvas');
const toolbar = (page: Page) => page.getByRole('toolbar', {name: 'Mask brush'});
const cursor = (page: Page) => page.locator('[data-slot="brush-cursor"]');
const status = (page: Page) => page.getByRole('status').filter({hasText: /\S/});

// Opens the fixture with a channel swap, which moves no pixel, at 100% zoom.
async function openSwap(page: Page): Promise<void> {
	await openBase(page, pngFixture('base.png', base));
	await addEffect(page, 'Channel swap');
	await waitForSettleRender(page);
}

async function actualSize(page: Page): Promise<void> {
	// Zoom keys do nothing while a field has the focus.
	await canvas(page).focus();
	await page.keyboard.press('0');
	await page.keyboard.press('1');
}

// An open project with an empty painted mask, the brush on and set as given.
async function openBrush(
	page: Page,
	{size = 40, hardness = 100} = {},
): Promise<void> {
	await openSwap(page);
	await addMask(page, 'Paint');
	await expect(toolbar(page)).toBeVisible();
	await setField(page, 'Brush size', String(size));
	await setField(page, 'Hardness', String(hardness));
	await actualSize(page);
}

// A point of a `width x height` image shown at 100%, in client coordinates.
async function client(
	page: Page,
	{x, y}: Point,
	width = WIDTH,
	height = HEIGHT,
): Promise<Point> {
	const box = (await canvas(page).boundingBox())!;
	return {
		x: box.x + box.width / 2 + (x - width / 2),
		y: box.y + box.height / 2 + (y - height / 2),
	};
}

async function head(page: Page): Promise<number> {
	return (await readEditor(page)).head;
}

async function expectHead(page: Page, expected: number): Promise<void> {
	await expect.poll(async () => head(page)).toBe(expected);
}

async function drag(
	page: Page,
	points: readonly Point[],
	size = {width: WIDTH, height: HEIGHT},
): Promise<void> {
	const [first, ...rest] = points;
	const from = await client(page, first, size.width, size.height);
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	for (const point of rest) {
		const to = await client(page, point, size.width, size.height);
		await page.mouse.move(to.x, to.y, {steps: 8});
	}

	await page.mouse.up();
}

// One mouse stroke, waited for until it is a history entry.
async function stroke(
	page: Page,
	points: readonly Point[],
	size?: {width: number; height: number},
): Promise<void> {
	const before = await head(page);
	await drag(page, points, size);
	await expectHead(page, before + 1);
}

type PointerStep = {
	type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointerout';
	id: number;
	kind: PointerKind;
	at: Point;
	pressure?: number;
};

// Synthetic pointer events on the canvas, at client coordinates.
async function pointers(
	page: Page,
	steps: readonly PointerStep[],
): Promise<void> {
	await canvas(page).evaluate((element, events) => {
		for (const {type, id, kind, at, pressure = 0.5} of events) {
			const held = type !== 'pointerup' && type !== 'pointerout';
			element.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					cancelable: true,
					pointerId: id,
					pointerType: kind,
					isPrimary: id === 1,
					clientX: at.x,
					clientY: at.y,
					button: type === 'pointermove' ? -1 : 0,
					buttons: held ? 1 : 0,
					pressure: held ? pressure : 0,
				}),
			);
		}
	}, steps);
}

// The painted grid of one instance, as storage holds it.
async function readMask(page: Page, side: 'a' | 'b' = 'b') {
	return page.evaluate(async (wanted) => {
		const booted = await (globalThis as unknown as RuntimeGlobal).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error(booted.status);
		}

		const {store, repository} = booted.bundle;
		const project = store.getState().activeProject!;
		const stack = wanted === 'a' ? project.stackA : project.stack;
		const mask = stack?.instances[0]?.mask;
		if (mask?.kind !== 'paint') {
			return null;
		}

		if (mask.asset === '') {
			return {asset: '', width: 0, data: [] as number[]};
		}

		const record = (await repository.getMask(mask.asset))!;
		const bytes = new Uint8Array(
			await new Response(
				record.blob
					.stream()
					.pipeThrough(new globalThis.DecompressionStream('deflate-raw')),
			).arrayBuffer(),
		);
		return {
			asset: mask.asset,
			width: record.width,
			data: [...bytes.subarray(12)],
		};
	}, side);
}

type StoredMask = NonNullable<Awaited<ReturnType<typeof readMask>>>;

const at = (mask: StoredMask, x: number, y: number): number =>
	mask.data[y * mask.width + x] ?? 0;

// How many rows of column `x` the mask touches.
const columnHeight = (mask: StoredMask, x: number): number =>
	Array.from({length: HEIGHT}, (_, y) => at(mask, x, y)).filter(
		(value) => value > 0,
	).length;

// Distance from the pixel centre to a horizontal segment.
function distance(
	x: number,
	y: number,
	from: number,
	to: number,
	row: number,
): number {
	const near = Math.min(to, Math.max(from, x + 0.5));
	return Math.hypot(x + 0.5 - near, y + 0.5 - row);
}

const pixel = (data: readonly number[], x: number, y: number, width = WIDTH) =>
	data.slice((y * width + x) * 4, (y * width + x) * 4 + 4);

async function viewState(page: Page) {
	return page.evaluate(async () => {
		const booted = await (globalThis as unknown as RuntimeGlobal).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error(booted.status);
		}

		return booted.bundle.store.getState().activeProject!.viewState;
	});
}

// The colour the canvas shows at a client point.
async function canvasColour(page: Page, point: Point): Promise<number[]> {
	return canvas(page).evaluate((element, {x, y}) => {
		const target = element as HTMLCanvasElement;
		const box = target.getBoundingClientRect();
		const scale = target.width / box.width;
		return [
			...target
				.getContext('2d')!
				.getImageData(
					Math.floor((x - box.left) * scale),
					Math.floor((y - box.top) * scale),
					1,
					1,
				).data,
		];
	}, point);
}

test('AC-F29.2: pixels outside the stroke keep the input, the hard core gets the effect', async ({
	page,
}) => {
	const problems = trackProblems(page);
	const requests: string[] = [];
	await openSwap(page);
	const full = await exportPng(page);
	const toggle = page.getByRole('switch', {name: 'Channel swap'});
	await toggle.click();
	const off = await exportPng(page);
	await toggle.click();
	page.on('request', (request) => {
		requests.push(new URL(request.url()).origin);
	});

	await addMask(page, 'Paint');
	await setField(page, 'Brush size', '40');
	await setField(page, 'Hardness', '100');
	await actualSize(page);
	await stroke(page, [
		{x: 40, y: 60},
		{x: 120, y: 60},
	]);
	expect(await readEditor(page)).toMatchObject({label: 'Paint mask'});
	await expect(status(page).filter({hasText: 'Stroke added'})).toBeAttached();
	const painted = await exportPng(page);
	await expectPreview(page, painted);

	let core = 0;
	const wrong: string[] = [];
	for (let y = 0; y < HEIGHT; y++) {
		for (let x = 0; x < WIDTH; x++) {
			const d = distance(x, y, 40, 120, 60);
			if (d <= 22 && d >= 17) {
				continue;
			}

			const expected = d > 22 ? off : full;
			core += d < 17 ? 1 : 0;
			if (pixel(painted, x, y).join(',') !== pixel(expected, x, y).join(',')) {
				wrong.push(`${x},${y}`);
			}
		}
	}

	expect(wrong).toEqual([]);
	expect(core).toBeGreaterThan(1000);
	// AC-F29.20: nothing but the app's own files.
	expect(
		requests.filter(
			(origin) => origin !== 'null' && origin !== new URL(page.url()).origin,
		),
	).toEqual([]);
	expect(problems).toEqual([]);
});

test('AC-F29.4: erase removes the effect, and one 50% stroke never builds up past 128', async ({
	page,
}) => {
	await openBrush(page, {size: 20});
	await setField(page, 'Strength', '50');
	// One stroke that crosses itself twice at (80, 60).
	await stroke(page, [
		{x: 40, y: 60},
		{x: 120, y: 60},
		{x: 80, y: 30},
		{x: 80, y: 90},
		{x: 80, y: 30},
	]);
	const half = (await readMask(page))!;
	expect(at(half, 80, 60)).toBe(128);
	expect(at(half, 50, 60)).toBe(128);
	expect(Math.max(...half.data)).toBe(128);

	await panel(page).getByRole('button', {name: 'Fill', exact: true}).click();
	await expect
		.poll(async () => (await readEditor(page)).label)
		.toBe('Fill mask');
	const filledExport = await exportPng(page);
	await setField(page, 'Strength', '100');
	await toolbar(page).getByRole('radio', {name: 'Erase'}).click();
	await stroke(page, [
		{x: 40, y: 60},
		{x: 120, y: 60},
	]);
	expect(await readEditor(page)).toMatchObject({label: 'Erase mask'});
	const erased = (await readMask(page))!;
	expect(at(erased, 80, 60)).toBe(0);
	expect(at(erased, 80, 20)).toBe(255);
	const toggle = page.getByRole('switch', {name: 'Channel swap'});
	const result = await exportPng(page);
	await toggle.click();
	const off = await exportPng(page);
	expect(pixel(result, 80, 60)).toEqual(pixel(off, 80, 60));
	expect(pixel(result, 80, 20)).toEqual(pixel(filledExport, 80, 20));
});

test('AC-F29.5: hardness shapes the edge, and feather widens it in preview and export', async ({
	page,
}) => {
	await openBrush(page, {size: 40, hardness: 100});
	await stroke(page, [
		{x: 30, y: 60},
		{x: 130, y: 60},
	]);
	const hard = (await readMask(page))!;
	const column = (mask: StoredMask) =>
		Array.from({length: HEIGHT}, (_, y) => at(mask, 80, y));
	const soft = (values: number[]) =>
		values.filter((value) => value > 0 && value < 255).length;
	// At most about two mask pixels on each side.
	expect(soft(column(hard))).toBeLessThanOrEqual(4);
	expect(column(hard).filter((value) => value === 255).length).toBeGreaterThan(
		34,
	);

	const sharp = await exportPng(page);
	await setField(page, 'Mask feather', '32');
	await expect
		.poll(async () => (await readEditor(page)).label)
		.toBe('Mask feather 32 px');
	const feathered = await exportPng(page);
	await expectPreview(page, feathered);
	// Rows that the hard edge left alone now change.
	const changedRows = (data: number[]) =>
		Array.from({length: HEIGHT}, (_, y) => y).filter(
			(y) => pixel(data, 80, y).join(',') !== pixel(sharp, 80, y).join(','),
		);
	expect(changedRows(feathered).some((y) => y < 38 || y > 82)).toBe(true);

	await panel(page).getByRole('button', {name: 'Clear', exact: true}).click();
	await expect.poll(async () => (await readMask(page))!.asset).toBe('');
	await setField(page, 'Hardness', '0');
	await stroke(page, [
		{x: 30, y: 60},
		{x: 130, y: 60},
	]);
	const faded = column((await readMask(page))!).slice(60, 81);
	expect(faded[0]).toBeGreaterThan(240);
	expect(faded.at(-1)).toBe(0);
	expect(faded).toEqual(faded.toSorted((a, b) => b - a));
	expect(soft(faded)).toBeGreaterThan(14);
});

test('AC-F29.6: one drag is one history entry that undo, redo, reload and History restore', async ({
	page,
}) => {
	await openBrush(page, {size: 20});
	const start = await head(page);
	await stroke(page, [
		{x: 30, y: 30},
		{x: 130, y: 30},
		{x: 130, y: 90},
	]);
	await stroke(page, [
		{x: 30, y: 90},
		{x: 60, y: 90},
	]);
	const second = (await readMask(page))!.asset;
	expect(await head(page)).toBe(start + 2);

	await page.keyboard.press('Control+z');
	await expectHead(page, start + 1);
	const first = (await readMask(page))!;
	expect(at(first, 45, 90)).toBe(0);
	expect(at(first, 80, 30)).toBe(255);
	// Undo keeps the brush on.
	await expect(toolbar(page)).toBeVisible();
	await page.keyboard.press('Control+Shift+z');
	await expectHead(page, start + 2);
	expect((await readMask(page))!.asset).toBe(second);

	// A stroke after an undo builds on the mask that undo brought back.
	await page.keyboard.press('Control+z');
	await expectHead(page, start + 1);
	await stroke(page, [
		{x: 80, y: 60},
		{x: 90, y: 60},
	]);
	const rebuilt = (await readMask(page))!;
	expect(at(rebuilt, 45, 90)).toBe(0);
	expect(at(rebuilt, 85, 60)).toBe(255);

	await page.reload();
	await waitForSettleRender(page);
	await expect(toolbar(page)).toHaveCount(0);
	await page.keyboard.press('Control+z');
	await expectHead(page, start + 1);
	expect((await readMask(page))!.asset).toBe(first.asset);
	await page.keyboard.press('Control+Shift+z');
	await expectHead(page, start + 2);
	expect((await readMask(page))!.asset).toBe(rebuilt.asset);

	await page.getByRole('tab', {name: 'History'}).click();
	await page
		.getByRole('list', {name: 'Project history'})
		.getByRole('button', {name: /^Add paint mask/})
		.first()
		.click();
	await expectHead(page, start);
	expect((await readMask(page))!.asset).toBe('');
});

test('AC-F29.7: pen pressure sets the size only when asked, and a mouse stroke is even', async ({
	page,
}) => {
	await openBrush(page, {size: 40});
	const rising = async (kind: PointerKind) => {
		const points = await Promise.all(
			Array.from({length: 21}, async (_, index) =>
				client(page, {x: 30 + index * 5, y: 60}),
			),
		);
		const before = await head(page);
		await pointers(page, [
			...points.map((point, index) => ({
				type: index === 0 ? ('pointerdown' as const) : ('pointermove' as const),
				id: 1,
				kind,
				at: point,
				pressure: index / 20,
			})),
			{type: 'pointerup', id: 1, kind, at: points.at(-1)!},
			{type: 'pointerout', id: 1, kind, at: points.at(-1)!},
		]);
		await expectHead(page, before + 1);
		const mask = (await readMask(page))!;
		await page.keyboard.press('Control+z');
		await expectHead(page, before);
		return [columnHeight(mask, 31), columnHeight(mask, 128)] as const;
	};

	const [thin, wide] = await rising('pen');
	// About 20% to 100% of 40 px.
	expect(thin).toBeGreaterThanOrEqual(6);
	expect(thin).toBeLessThanOrEqual(14);
	expect(wide).toBeGreaterThanOrEqual(36);
	expect(wide).toBeLessThanOrEqual(42);

	const [mouseStart, mouseEnd] = await rising('mouse');
	expect(Math.abs(mouseEnd - mouseStart)).toBeLessThanOrEqual(2);
	expect(mouseStart).toBeGreaterThanOrEqual(38);

	await panel(page)
		.getByRole('switch', {name: 'Pen pressure sets size'})
		.click();
	const [offStart, offEnd] = await rising('pen');
	expect(Math.abs(offEnd - offStart)).toBeLessThanOrEqual(2);
	expect(offStart).toBeGreaterThanOrEqual(38);
});

test('AC-F29.8: a second finger drops the stroke and zooms; a pen shuts out touches', async ({
	page,
}) => {
	await openBrush(page, {size: 20});
	const start = await head(page);
	const left = await client(page, {x: 60, y: 60});
	const right = await client(page, {x: 100, y: 60});
	const shift = (point: Point, x: number) => ({x: point.x + x, y: point.y});
	await pointers(page, [
		{type: 'pointerdown', id: 11, kind: 'touch', at: left},
		{type: 'pointermove', id: 11, kind: 'touch', at: shift(left, 6)},
		{type: 'pointerdown', id: 12, kind: 'touch', at: right},
		{type: 'pointermove', id: 11, kind: 'touch', at: shift(left, -40)},
		{type: 'pointermove', id: 12, kind: 'touch', at: shift(right, 40)},
		{type: 'pointerup', id: 12, kind: 'touch', at: shift(right, 40)},
		// The finger left behind pans; it does not paint.
		{type: 'pointermove', id: 11, kind: 'touch', at: shift(left, -20)},
		{type: 'pointerup', id: 11, kind: 'touch', at: shift(left, -20)},
	]);
	await expect
		.poll(async () => (await viewState(page)).zoom)
		.toBeGreaterThan(2);

	// The next single finger paints, so the brush is still on.
	await actualSize(page);
	await pointers(page, [
		{type: 'pointerdown', id: 13, kind: 'touch', at: left},
		{type: 'pointermove', id: 13, kind: 'touch', at: right},
		{type: 'pointerup', id: 13, kind: 'touch', at: right},
	]);
	await expectHead(page, start + 1);
	// Only that stroke was committed: undoing it empties the mask.
	await page.keyboard.press('Control+z');
	await expectHead(page, start);
	expect((await readMask(page))!.asset).toBe('');

	const view = await viewState(page);
	const low = await client(page, {x: 60, y: 90});
	await pointers(page, [
		{type: 'pointerdown', id: 1, kind: 'pen', at: left},
		{type: 'pointerdown', id: 14, kind: 'touch', at: low},
		{type: 'pointermove', id: 14, kind: 'touch', at: shift(low, 40)},
		{type: 'pointermove', id: 1, kind: 'pen', at: right},
		{type: 'pointerup', id: 14, kind: 'touch', at: shift(low, 40)},
		{type: 'pointerup', id: 1, kind: 'pen', at: right},
		{type: 'pointerout', id: 1, kind: 'pen', at: right},
	]);
	await expectHead(page, start + 1);
	const mask = (await readMask(page))!;
	expect(at(mask, 80, 60)).toBeGreaterThan(0);
	expect(at(mask, 80, 90)).toBe(0);
	expect(await viewState(page)).toEqual(view);
});

test('AC-F29.9: the keyboard alone adds a mask, paints, sets the brush and leaves it', async ({
	page,
}) => {
	await openSwap(page);
	await panel(page).getByRole('button', {name: 'Add mask'}).focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('menuitem', {name: 'Paint'})).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(toolbar(page)).toBeVisible();
	await page.keyboard.press('b');
	await expect(toolbar(page)).toHaveCount(0);
	await expect(status(page).filter({hasText: 'Brush off'})).toBeAttached();
	await page.keyboard.press('b');
	await expect(toolbar(page)).toBeVisible();
	await expect(status(page).filter({hasText: 'Brush on'})).toBeAttached();

	for (let presses = 0; presses < 60; presses++) {
		if (
			await canvas(page).evaluate((el) => el === el.ownerDocument.activeElement)
		) {
			break;
		}

		await page.keyboard.press('Shift+Tab');
	}

	await expect(canvas(page)).toBeFocused();
	await expect(canvas(page)).toHaveAccessibleDescription(/Enter starts/);
	await actualSize(page);
	await setBrushSize(page, 20);

	const start = await head(page);
	await page.keyboard.press('ArrowLeft');
	await expect(cursor(page)).toBeVisible();
	const x = Number(await cursor(page).getAttribute('data-x'));
	await page.keyboard.press('ArrowLeft');
	// A quarter of the brush; with Shift the whole of it.
	await expect(cursor(page)).toHaveAttribute('data-x', String(x - 5));
	await page.keyboard.press('Shift+ArrowLeft');
	await expect(cursor(page)).toHaveAttribute('data-x', String(x - 25));
	await page.keyboard.press('Enter');
	await expect(status(page).filter({hasText: 'Stroke started'})).toBeAttached();
	await page.keyboard.press('Shift+ArrowRight');
	await page.keyboard.press('Shift+ArrowRight');
	await page.keyboard.press('Enter');
	await expectHead(page, start + 1);
	await expect(status(page).filter({hasText: 'Stroke added'})).toBeAttached();
	const mask = (await readMask(page))!;
	// From x = 80 - 5 - 5 - 20 to 40 px further right.
	expect(at(mask, 52, 60)).toBe(255);
	expect(at(mask, 85, 60)).toBe(255);

	await page.keyboard.press('x');
	await expect(toolbar(page).getByRole('radio', {name: 'Erase'})).toBeChecked();
	await expect(status(page).filter({hasText: 'Erase'})).toBeAttached();
	await page.keyboard.press(']');
	const size = panel(page).getByRole('textbox', {name: 'Brush size'});
	await expect(size).toHaveValue('22 px');
	await expect(
		status(page).filter({hasText: 'Brush size 22 px'}),
	).toBeAttached();
	await page.keyboard.press('[');
	await expect(size).toHaveValue('20 px');
	await page.keyboard.press('Shift+BracketLeft');
	await expect(
		panel(page).getByRole('textbox', {name: 'Hardness'}),
	).toHaveValue('40%');
	await expect(status(page).filter({hasText: 'Hardness 40%'})).toBeAttached();
	await page.keyboard.press('m');
	await expect(
		toolbar(page).getByRole('button', {name: 'Show mask'}),
	).toHaveAttribute('aria-pressed', 'false');

	// Escape drops the stroke first, and only then turns the brush off.
	await page.keyboard.press('Enter');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Escape');
	await expect(
		status(page).filter({hasText: 'Stroke canceled'}),
	).toBeAttached();
	await expect(toolbar(page)).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(toolbar(page)).toHaveCount(0);
	expect(await head(page)).toBe(start + 1);
});

async function setBrushSize(page: Page, size: number): Promise<void> {
	await setField(page, 'Brush size', String(size));
	await canvas(page).focus();
}

test('AC-F29.13: paint stays on the same photo content through rotate and crop', async ({
	page,
}) => {
	await openBrush(page, {size: 20});
	await stroke(page, [
		{x: 30, y: 25},
		{x: 30, y: 95},
	]);
	const {asset} = (await readMask(page))!;
	const upright = await exportPng(page);
	const transform = async (next: Partial<SourceTransform>, label: string) => {
		const before = await head(page);
		await page.evaluate(
			async ([patch, name]) => {
				const booted = await (globalThis as unknown as RuntimeGlobal)
					.__psgRuntime!.ready;
				if (booted.status !== 'ready') {
					throw new Error(booted.status);
				}

				const {store} = booted.bundle;
				const project = store.getState().activeProject!;
				await store
					.getState()
					.setTransform(project.id, {...project.transform, ...patch}, name);
			},
			[next, label] as const,
		);
		await expectHead(page, before + 1);
		await waitForSettleRender(page);
	};

	await transform({rotation: 90}, 'Rotate 90° CW');
	const rotated = await exportPng(page);
	// One comparison per image: an assertion per pixel is too slow.
	const picture = (
		width: number,
		height: number,
		from: (x: number, y: number) => number[],
	) =>
		Array.from({length: width * height}, (_, index) =>
			from(index % width, Math.floor(index / width)),
		).flat();
	// Rotated pixel (x, y) shows upright pixel (y, HEIGHT - 1 - x).
	expect(rotated).toEqual(
		picture(HEIGHT, WIDTH, (x, y) => pixel(upright, y, HEIGHT - 1 - x)),
	);

	const crop = {x: 20, y: 40, width: 80, height: 100};
	await transform({crop}, 'Crop 80 × 100');
	expect(await exportPng(page)).toEqual(
		picture(crop.width, crop.height, (x, y) =>
			pixel(rotated, x + crop.x, y + crop.y, HEIGHT),
		),
	);

	await transform({crop: null}, 'Reset crop');
	expect(await exportPng(page)).toEqual(rotated);
	expect((await readMask(page))!.asset).toBe(asset);

	// A stroke on the rotated photo lands on the matching grid pixels. The brush
	// stayed on through every change.
	await expect(toolbar(page)).toBeVisible();
	await actualSize(page);
	const size = {width: HEIGHT, height: WIDTH};
	await stroke(
		page,
		[
			{x: 60, y: 120},
			{x: 61, y: 120},
		],
		size,
	);
	const mask = (await readMask(page))!;
	// Rotated (60, 120) is stored (120, 120 - 60).
	expect(at(mask, 120, 59)).toBe(255);
	expect(at(mask, 30, 60)).toBe(255);
});

test('AC-F29.14: in split view the brush paints only the side being edited', async ({
	page,
}) => {
	await openSwap(page);
	await addMask(page, 'Paint');
	await page.getByRole('button', {name: 'Split', exact: true}).click();
	await page.getByRole('button', {name: 'Copy to other side'}).click();
	await expect.poll(async () => (await readMask(page, 'a'))?.asset).toBe('');
	const sideB = await exportPng(page);

	const edit = async (name: RegExp) => {
		await page.getByRole('radio', {name}).click();
		// Another selection turned the brush off.
		await expect(toolbar(page)).toHaveCount(0);
		await page.keyboard.press('b');
		await expect(toolbar(page)).toBeVisible();
		await setField(page, 'Brush size', '20');
		await actualSize(page);
	};

	await edit(/^A /);
	await stroke(page, [
		{x: 20, y: 40},
		{x: 60, y: 40},
	]);
	const paintedA = (await readMask(page, 'a'))!;
	expect(at(paintedA, 40, 40)).toBe(255);
	expect((await readMask(page, 'b'))!.asset).toBe('');
	expect(await exportPng(page)).toEqual(sideB);

	// Dragging on the other side pans.
	const view = await viewState(page);
	const entries = await head(page);
	await drag(page, [
		{x: 120, y: 40},
		{x: 140, y: 60},
	]);
	await expect
		.poll(async () => (await viewState(page)).centerX)
		.not.toBe(view.centerX);
	expect(await head(page)).toBe(entries);

	await page.getByRole('button', {name: 'Copy to other side'}).click();
	await expect
		.poll(async () => (await readMask(page, 'b'))!.asset)
		.toBe(paintedA.asset);
	await edit(/^B /);
	await stroke(page, [
		{x: 100, y: 80},
		{x: 140, y: 80},
	]);
	expect(at((await readMask(page, 'b'))!, 120, 80)).toBe(255);
	expect((await readMask(page, 'a'))!.asset).toBe(paintedA.asset);
});

test('the overlay, cursor, panning and suspending follow the brush rules', async ({
	page,
}) => {
	const problems = trackProblems(page);
	await openBrush(page, {size: 20});
	await setField(page, 'Strength', '100');
	const start = await head(page);
	const spot = await client(page, {x: 80, y: 60});
	const photo = await canvasColour(page, spot);

	// The cursor is the brush's size on screen.
	await page.mouse.move(spot.x, spot.y);
	await expect(cursor(page)).toBeVisible();
	await expect(cursor(page)).toHaveAttribute('data-radius', '10');
	await expect(cursor(page)).toHaveAttribute('data-tool', 'paint');

	// The overlay shows during a stroke even with "Show mask" off.
	await page.keyboard.press('m');
	await page.mouse.down();
	await expect.poll(async () => canvasColour(page, spot)).not.toEqual(photo);
	const during = await canvasColour(page, spot);
	expect(during[0]).toBeGreaterThan(during[1]);
	// The effect waits for the release.
	expect(await head(page)).toBe(start);
	await page.mouse.up();
	await expectHead(page, start + 1);

	// Undo during a stroke drops it.
	await page.mouse.move(spot.x + 30, spot.y);
	await page.mouse.down();
	await page.mouse.move(spot.x + 50, spot.y);
	await page.keyboard.press('Control+z');
	await expectHead(page, start);
	await page.mouse.move(spot.x + 60, spot.y);
	await page.mouse.up();
	await expect(toolbar(page)).toBeVisible();
	await page.keyboard.press('Control+Shift+z');
	await expectHead(page, start + 1);
	expect(at((await readMask(page))!, 120, 60)).toBe(0);

	const panned = async (act: () => Promise<void>) => {
		await actualSize(page);
		const before = await viewState(page);
		await act();
		await expect
			.poll(async () => (await viewState(page)).centerX)
			.not.toBe(before.centerX);
		expect(await head(page)).toBe(start + 1);
	};

	const sweep = async (button: 'left' | 'middle') => {
		await page.mouse.move(spot.x, spot.y);
		await page.mouse.down({button});
		await page.mouse.move(spot.x + 25, spot.y + 10, {steps: 4});
		await page.mouse.up({button});
	};

	await panned(async () => sweep('middle'));
	await panned(async () => {
		await canvas(page).focus();
		await page.keyboard.down(' ');
		await sweep('left');
		await page.keyboard.up(' ');
	});
	// Compare suspends the brush, so a drag pans and the cursor is gone.
	await page.keyboard.press('\\');
	await panned(async () => sweep('left'));
	await expect(cursor(page)).toBeHidden();
	await page.keyboard.press('\\');
	await page.getByRole('button', {name: 'Done'}).click();
	await expect(toolbar(page)).toHaveCount(0);
	await expect(cursor(page)).toBeHidden();

	// Selecting another effect and removing the mask turn it off.
	await page.keyboard.press('b');
	await expect(toolbar(page)).toBeVisible();
	await addEffect(page, 'Posterize');
	await expect(toolbar(page)).toHaveCount(0);
	await page.getByRole('button', {name: 'Channel swap Has mask'}).click();
	await panel(page).getByRole('button', {name: 'Edit with brush'}).click();
	await page.getByRole('button', {name: 'Guide'}).click();
	await page.getByRole('button', {name: /Back/}).click();
	await waitForSettleRender(page);
	await expect(toolbar(page)).toHaveCount(0);
	await panel(page).getByRole('button', {name: 'Edit with brush'}).click();
	await panel(page).getByRole('button', {name: 'Remove mask'}).click();
	await expect(toolbar(page)).toHaveCount(0);
	expect(problems).toEqual([]);
});

test('brush settings are kept on the device', async ({page}) => {
	await openBrush(page, {size: 33, hardness: 70});
	await setField(page, 'Strength', '60');
	await setField(page, 'Overlay opacity', '80');
	await panel(page)
		.getByRole('switch', {name: 'Pen pressure sets size'})
		.click();
	await page.keyboard.press('m');
	await expect
		.poll(async () =>
			page.evaluate(async () => {
				const booted = await (globalThis as unknown as RuntimeGlobal)
					.__psgRuntime!.ready;
				if (booted.status !== 'ready') {
					throw new Error(booted.status);
				}

				return (await booted.bundle.repository.getAppState()).brush;
			}),
		)
		.toEqual({
			size: 33,
			hardness: 70,
			strength: 60,
			penPressure: false,
			showMask: false,
			overlayOpacity: 80,
		});
	await page.reload();
	await waitForSettleRender(page);
	await panel(page).getByRole('button', {name: 'Edit with brush'}).click();
	await expect(
		panel(page).getByRole('textbox', {name: 'Brush size'}),
	).toHaveValue('33 px');
	await expect(
		panel(page).getByRole('switch', {name: 'Show mask'}),
	).not.toBeChecked();
});

const THEMES = [
	{name: 'light', stored: 'light'},
	{name: 'true-black', stored: 'dark'},
] as const;

for (const theme of THEMES) {
	for (const viewport of PROOF_VIEWPORTS) {
		test(`the brush at ${viewport.width}x${viewport.height} in ${theme.name} @a11y`, async ({
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

			await openBase(page, pngFixture('base.png', syntheticImage(900, 600)));
			await addEffect(page, 'Channel swap');
			await waitForSettleRender(page);
			if (phone) {
				await page.getByRole('tab', {name: 'Mask', exact: true}).click();
			}

			await panel(page).getByRole('button', {name: 'Add mask'}).click();
			await page.getByRole('menuitem', {name: 'Paint'}).click();
			await expect(toolbar(page)).toBeVisible();
			if (phone) {
				await expect(
					page.getByRole('tab', {name: 'Size', exact: true}),
				).toHaveAttribute('aria-selected', 'true');
				await expect(
					page.getByRole('tab', {name: 'Size', exact: true}),
				).toBeInViewport({ratio: 1});
			}

			await setField(page, 'Brush size', '120');
			const box = (await canvas(page).boundingBox())!;
			const place = (x: number, y: number) => ({
				x: box.x + box.width * x,
				y: box.y + box.height * y,
			});
			const kind: PointerKind = coarse ? 'touch' : 'mouse';
			const before = await head(page);
			await pointers(page, [
				{type: 'pointerdown', id: 1, kind, at: place(0.35, 0.45)},
				{type: 'pointermove', id: 1, kind, at: place(0.5, 0.55)},
				{type: 'pointermove', id: 1, kind, at: place(0.65, 0.45)},
				{type: 'pointerup', id: 1, kind, at: place(0.65, 0.45)},
			]);
			await expectHead(page, before + 1);
			await waitForSettleRender(page);
			if (!coarse) {
				await page.mouse.move(place(0.6, 0.6).x, place(0.6, 0.6).y);
				await expect(cursor(page)).toBeVisible();
			}

			const check = async () => {
				expect(
					await page.evaluate(
						() =>
							globalThis.document.documentElement.scrollWidth -
							globalThis.document.documentElement.clientWidth,
					),
				).toBeLessThanOrEqual(0);
				await assertNoA11yViolations(page);
			};

			await check();
			// The longest size fits its field.
			const field = panel(page).getByRole('textbox', {name: 'Brush size'});
			await field.fill('2000');
			await field.press('Enter');
			expect(
				await field.evaluate((input) => input.scrollWidth - input.clientWidth),
			).toBeLessThanOrEqual(0);
			await field.fill('120');
			await field.press('Enter');
			await page.evaluate(() => {
				(globalThis.document.activeElement as HTMLElement).blur();
			});
			const strip = (await toolbar(page).boundingBox())!;
			const now = (await canvas(page).boundingBox())!;
			if (phone) {
				// The strip takes the effect strip's place, off the photo.
				expect(strip.y).toBeGreaterThanOrEqual(now.y + now.height);
				expect(now.height).toBeGreaterThanOrEqual(viewport.height / 2);
			} else {
				expect(strip.x - now.x).toBeCloseTo(12, 0);
				expect(strip.y).toBeGreaterThan(now.y + 32);
			}

			for (const button of await toolbar(page).locator('button').all()) {
				const target = (await button.boundingBox())!;
				const least = coarse ? 44 : 36;
				expect(target.width).toBeGreaterThanOrEqual(least - 0.5);
				expect(target.height).toBeGreaterThanOrEqual(least - 0.5);
				expect(target.x + target.width).toBeLessThanOrEqual(viewport.width);
			}

			// Arrow keys move between the buttons.
			await toolbar(page).getByRole('radio', {name: 'Paint'}).focus();
			await page.keyboard.press(phone ? 'ArrowRight' : 'ArrowDown');
			await expect(
				toolbar(page).getByRole('radio', {name: 'Erase'}),
			).toBeFocused();
			await page.evaluate(() => {
				(globalThis.document.activeElement as HTMLElement).blur();
			});

			await mkdir('.proof', {recursive: true});
			// Chromium only, so Firefox does not overwrite the proof.
			if (browserName === 'chromium') {
				await page.screenshot({
					path: `.proof/brush-${viewport.width}-${theme.name}.png`,
				});
			}

			if (phone) {
				for (const name of ['Hardness', 'Strength', 'Mask']) {
					await page.getByRole('tab', {name, exact: true}).click();
					await check();
				}

				await expect(
					panel(page).getByRole('button', {name: 'Edit with brush'}),
				).toHaveAttribute('aria-pressed', 'true');
			}

			expect(problems).toEqual([]);
			await context.close();
		});
	}
}
