import {expect, test, type Page} from '@playwright/test';
import type {AppRuntime, AppStore} from '../../src/state/index.ts';
import type {
	BlendMode,
	EffectInstance,
	ParamValue,
} from '../../src/engine/types.ts';
import type {RenderCoordinator} from '../../src/render/coordinator.ts';
import type {StorageRepository} from '../../src/storage/types.ts';
import {assertNoA11yViolations} from './axe.ts';
import {importSyntheticProject} from './seed.ts';
import {PROOF_VIEWPORTS, type ProofViewport} from './viewports.ts';

type Bundle = {
	store: AppStore;
	coordinator: RenderCoordinator;
	repository: StorageRepository;
};

type RuntimeGlobal = {
	__psgRuntime?: AppRuntime;
	__psgBundle?: Bundle;
};

type Snapshot = {
	instances: EffectInstance[];
	selectedInstanceId: string | null;
	historyHeadSeq: number;
	mix: number;
	blend: string;
};

type Pixels = {
	level: string;
	width: number;
	height: number;
	data: number[];
};

const THEMES = [
	{name: 'light', media: 'light', stored: 'light'},
	{name: 'dark', media: 'dark', stored: 'dark'},
] as const;

const BLENDS: readonly BlendMode[] = [
	'normal',
	'lighten',
	'darken',
	'difference',
];

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
 Opens the app, stores its runtime bundle on `globalThis.__psgBundle` so later
 evaluations stay short, imports a synthetic photo and adds the given effects.
 */
async function seedProject(
	page: Page,
	types: readonly string[],
	name = 'Params proof',
): Promise<void> {
	await page.goto('/');
	await importSyntheticProject(page, name);
	await page.evaluate(async (list) => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime?.ready;
		if (booted?.status !== 'ready') {
			throw new Error(`Expected a ready boot, got ${booted?.status ?? 'none'}`);
		}

		const holder = globalThis as unknown as RuntimeGlobal;
		holder.__psgBundle = booted.bundle;
		for (const type of list) {
			await booted.bundle.store.getState().addEffect(type);
		}
	}, types);
}

async function readStack(page: Page): Promise<Snapshot> {
	return page.evaluate(() => {
		const project = (
			globalThis as unknown as RuntimeGlobal
		).__psgBundle?.store.getState().activeProject;
		if (!project) {
			throw new Error('No active project');
		}

		const selected = project.stack.instances.find(
			(item) => item.id === project.selectedInstanceId,
		);
		return {
			instances: project.stack.instances,
			selectedInstanceId: project.selectedInstanceId,
			historyHeadSeq: project.historyHeadSeq,
			mix: selected?.mix ?? -1,
			blend: selected?.blend ?? 'missing',
		};
	});
}

async function selectedId(page: Page): Promise<string> {
	const id = await page.evaluate(
		() =>
			(globalThis as unknown as RuntimeGlobal).__psgBundle?.store.getState()
				.activeProject?.selectedInstanceId ?? null,
	);
	if (!id) {
		throw new Error('No selected instance');
	}

	return id;
}

async function readView(
	page: Page,
): Promise<{fitMode: string; zoom: number; centerX: number; centerY: number}> {
	return page.evaluate(() => {
		const project = (
			globalThis as unknown as RuntimeGlobal
		).__psgBundle?.store.getState().activeProject;
		if (!project) {
			throw new Error('No active project');
		}

		const {fitMode, zoom, centerX, centerY} = project.viewState;
		return {fitMode, zoom, centerX, centerY};
	});
}

async function readParams(
	page: Page,
): Promise<Record<string, ParamValue> | undefined> {
	return page.evaluate(() => {
		const project = (
			globalThis as unknown as RuntimeGlobal
		).__psgBundle?.store.getState().activeProject;
		return project?.stack.instances.find(
			(item) => item.id === project.selectedInstanceId,
		)?.params;
	});
}

async function setParam(
	page: Page,
	key: string,
	value: ParamValue,
): Promise<void> {
	await page.evaluate(
		async (input) => {
			const {store} = (globalThis as unknown as RuntimeGlobal).__psgBundle!;
			await store.getState().commitParam(input.id, input.key, input.value);
		},
		{id: await selectedId(page), key, value},
	);
}

async function setBlend(page: Page, blend: BlendMode): Promise<void> {
	await page.evaluate(
		async (input) => {
			const {store} = (globalThis as unknown as RuntimeGlobal).__psgBundle!;
			await store.getState().setBlend(input.id, input.blend);
		},
		{id: await selectedId(page), blend},
	);
}

async function setMix(page: Page, mix: number): Promise<void> {
	await page.evaluate(
		async (input) => {
			const {store} = (globalThis as unknown as RuntimeGlobal).__psgBundle!;
			await store.getState().commitMix(input.id, input.mix);
		},
		{id: await selectedId(page), mix},
	);
}

async function setEnabled(page: Page, enabled: boolean): Promise<void> {
	await page.evaluate(
		async (input) => {
			const {store} = (globalThis as unknown as RuntimeGlobal).__psgBundle!;
			await store.getState().setEffectEnabled(input.id, input.enabled);
		},
		{id: await selectedId(page), enabled},
	);
}

async function undo(page: Page): Promise<void> {
	await page.evaluate(async () => {
		const {store} = (globalThis as unknown as RuntimeGlobal).__psgBundle!;
		await store.getState().undo();
	});
}

async function frameGeneration(page: Page): Promise<number> {
	return page.evaluate(
		() =>
			(globalThis as unknown as RuntimeGlobal).__psgBundle?.store.getState()
				.render.frame?.generation ?? 0,
	);
}

async function settledLevel(page: Page): Promise<boolean> {
	return page.evaluate(() => {
		const state = (
			globalThis as unknown as RuntimeGlobal
		).__psgBundle?.store.getState();
		return (
			Boolean(state) &&
			state!.render.frame?.level === 'settle' &&
			!state!.render.busy.settle
		);
	});
}

/**
Waits until a settle frame newer than `afterGeneration` is on screen.
*/
async function waitForSettle(
	page: Page,
	afterGeneration: number,
): Promise<void> {
	await expect
		.poll(async () => {
			const generation = await frameGeneration(page);
			return generation > afterGeneration && (await settledLevel(page));
		})
		.toBe(true);
}

async function waitForDisplayedSettle(page: Page): Promise<void> {
	await expect.poll(() => settledLevel(page)).toBe(true);
}

async function readPreview(page: Page): Promise<Pixels> {
	return page.evaluate(() => {
		const frame = (
			globalThis as unknown as RuntimeGlobal
		).__psgBundle?.store.getState().render.frame;
		if (!frame) {
			throw new Error('No preview frame');
		}

		const canvas = globalThis.document.createElement('canvas');
		canvas.width = frame.width;
		canvas.height = frame.height;
		const context = canvas.getContext('2d');
		if (!context) {
			throw new Error('2D context unavailable');
		}

		context.drawImage(frame.bitmap, 0, 0);
		const image = context.getImageData(0, 0, canvas.width, canvas.height);
		return {
			level: frame.level,
			width: canvas.width,
			height: canvas.height,
			data: [...image.data],
		};
	});
}

/**
Applies one change to the stack and returns the frame it settles on.
*/
async function settled(
	page: Page,
	change: () => Promise<void>,
): Promise<Pixels> {
	const before = await frameGeneration(page);
	await change();
	await waitForSettle(page, before);
	return readPreview(page);
}

/**
Reads the exported PNG as pixels, independent of the preview debug view.
*/
async function exportPixels(page: Page): Promise<Pixels> {
	return page.evaluate(async () => {
		const {store, coordinator} = (globalThis as unknown as RuntimeGlobal)
			.__psgBundle!;
		const project = store.getState().activeProject;
		if (!project) {
			throw new Error('No active project');
		}

		const task = coordinator.exportImage({
			stack: project.stack,
			scale: 1,
			format: 'png',
		});
		const outcome = (await task.result) as {status: string; file?: Blob};
		if (outcome.status !== 'done' || !outcome.file) {
			throw new Error(`Export failed: ${outcome.status}`);
		}

		const bitmap = await globalThis.createImageBitmap(outcome.file);
		const canvas = globalThis.document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d');
		if (!context) {
			throw new Error('2D context unavailable');
		}

		context.drawImage(bitmap, 0, 0);
		const image = context.getImageData(0, 0, canvas.width, canvas.height);
		return {
			level: 'export',
			width: canvas.width,
			height: canvas.height,
			data: [...image.data],
		};
	});
}

/**
Engine.md 4.5: out = floor((2 * (i * (100 - m) + b * m) + 100) / 200).
*/
function mixed(i: number, blended: number, percent: number): number {
	return Math.floor(
		(2 * (i * (100 - percent) + blended * percent) + 100) / 200,
	);
}

function mismatches(actual: Pixels, expected: Pixels, label: string): string[] {
	if (actual.width !== expected.width || actual.height !== expected.height) {
		return [
			`${label}: ${actual.width}x${actual.height} != ${expected.width}x${expected.height}`,
		];
	}

	const found: string[] = [];
	for (let index = 0; index < expected.data.length; index++) {
		if (actual.data[index] !== expected.data[index] && found.length < 4) {
			found.push(
				`${label}: channel ${index % 4} of pixel ${Math.floor(index / 4)}: ${actual.data[index]} != ${expected.data[index]}`,
			);
		}
	}

	return found;
}

function paramRow(page: Page, label: string) {
	return page
		.locator('[data-param-row]')
		.filter({has: page.getByText(label, {exact: true})})
		.first();
}

async function seedInTheme(
	page: Page,
	theme: (typeof THEMES)[number],
	viewport: ProofViewport,
): Promise<void> {
	await page.emulateMedia({colorScheme: theme.media});
	await page.addInitScript((stored) => {
		globalThis.localStorage.setItem('psg:theme', stored);
	}, theme.stored);
	await page.setViewportSize({width: viewport.width, height: viewport.height});
	await seedProject(page, ['pixelSort']);
}

/**
Drags a two-value slider's high thumb to the left and returns it.
*/
async function dragHighThumb(
	page: Page,
	durationMs: number,
	step = 2,
): Promise<void> {
	const box = await page
		.getByRole('slider', {name: 'Threshold range high'})
		.boundingBox();
	if (!box) {
		throw new Error('Slider thumb has no layout box');
	}

	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	const startedAt = Date.now();
	let offset = step;
	while (Date.now() - startedAt < durationMs) {
		await page.mouse.move(x - offset, y);
		offset += step;
		await page.waitForTimeout(35);
	}

	await page.mouse.up();
}

test('the panel shows every parameter with its label, value and unit', async ({
	page,
}) => {
	const consoleErrors = collectConsoleErrors(page);
	await seedProject(page, ['pixelSort']);

	await expect(page.getByRole('heading', {name: 'Pixel sort'})).toBeVisible();
	await expect(page.getByText('Show selection')).toBeVisible();
	await expect(page.getByRole('button', {name: 'Reset all'})).toBeVisible();

	for (const group of ['Direction', 'Selection', 'Length', 'Order', 'Output']) {
		await expect(
			page.getByRole('heading', {name: group, exact: true}),
		).toBeVisible();
	}

	const angle = page.getByRole('slider', {name: 'Angle', exact: true});
	await expect(angle).toHaveAttribute('aria-valuemin', '0');
	await expect(angle).toHaveAttribute('aria-valuemax', '360');
	await expect(angle).toHaveAttribute('aria-valuenow', '0');
	await expect(angle).toHaveAttribute('aria-valuetext', '0.0°');
	await expect(paramRow(page, 'Angle')).toContainText('0.0°');
	await expect(page.getByRole('textbox', {name: 'Angle'})).toHaveValue('0.0');

	const low = page.getByRole('slider', {name: 'Threshold range low'});
	await expect(low).toHaveAttribute('aria-valuemin', '0');
	await expect(low).toHaveAttribute('aria-valuemax', '1');
	await expect(paramRow(page, 'Threshold range')).toContainText('0.25 – 0.8');
	await expect(page.getByRole('textbox', {name: 'Low'})).toHaveValue('0.25');
	await expect(page.getByRole('textbox', {name: 'High'})).toHaveValue('0.8');

	await expect(paramRow(page, 'Maximum interval length')).toContainText('0 px');
	await expect(page.getByRole('slider', {name: 'Skip chance'})).toHaveAttribute(
		'aria-valuemax',
		'1',
	);
	await expect(paramRow(page, 'Skip chance')).toContainText('0');

	const modes = page.getByRole('radiogroup', {name: 'Interval mode'});
	await expect(modes.getByRole('radio')).toHaveText([
		'Threshold',
		'Edges',
		'Whole line',
	]);
	await expect(
		page.getByRole('combobox', {name: 'Selection key'}),
	).toContainText('Luma');

	await expect(paramRow(page, 'Mix')).toContainText('100%');
	await expect(page.getByRole('slider', {name: 'Mix'})).toHaveAttribute(
		'aria-valuenow',
		'100',
	);
	const blends = page.getByRole('radiogroup', {name: 'Blend'});
	await expect(blends.getByRole('radio')).toHaveText([
		'Normal',
		'Lighten',
		'Darken',
		'Difference',
	]);
	await expect(blends.getByRole('radio', {name: 'Normal'})).toHaveAttribute(
		'aria-checked',
		'true',
	);

	expect(consoleErrors, 'Console errors').toEqual([]);
});

test('typing 37.5 into the angle field sets the angle as one commit', async ({
	page,
}) => {
	await seedProject(page, ['pixelSort']);
	const before = await readStack(page);
	const field = page.getByRole('textbox', {name: 'Angle'});

	await field.fill('37.5');
	await field.press('Enter');

	await expect(field).toHaveValue('37.5');
	await expect(paramRow(page, 'Angle')).toContainText('37.5°');
	await expect
		.poll(async () => (await readStack(page)).historyHeadSeq)
		.toBe(before.historyHeadSeq + 1);
	expect((await readStack(page)).instances[0].params.angle).toBe(37.5);
});

test('a typed value outside the range clamps and shows the clamped value', async ({
	page,
}) => {
	await seedProject(page, ['pixelSort']);
	const field = page.getByRole('textbox', {name: 'Skip chance'});

	await field.fill('400');
	await field.press('Enter');

	await expect(field).toHaveValue('1');
	await expect
		.poll(async () => (await readStack(page)).instances[0].params.skipChance)
		.toBe(1);
});

test('dragging a slider for 3 seconds creates exactly one commit on release', async ({
	page,
}) => {
	await seedProject(page, ['pixelSort']);
	await waitForDisplayedSettle(page);
	const before = await readStack(page);

	await dragHighThumb(page, 3000);
	await expect
		.poll(async () => (await readStack(page)).historyHeadSeq)
		.toBe(before.historyHeadSeq + 1);

	await page.waitForTimeout(600);
	const after = await readStack(page);
	expect(after.historyHeadSeq, 'one history entry for the whole drag').toBe(
		before.historyHeadSeq + 1,
	);
	expect(after.instances[0].params.threshold).not.toEqual(
		before.instances[0].params.threshold,
	);
});

test('the drag value is only committed when the pointer is released', async ({
	page,
}) => {
	await seedProject(page, ['pixelSort']);
	await waitForDisplayedSettle(page);
	const before = await readStack(page);
	const rowText = async () =>
		(await paramRow(page, 'Threshold range').innerText())
			.replaceAll(/\s+/g, ' ')
			.trim();
	const beforeText = await rowText();
	const box = await page
		.getByRole('slider', {name: 'Threshold range high'})
		.boundingBox();
	if (!box) {
		throw new Error('Slider thumb has no layout box');
	}

	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x - 40, y);

	await expect
		.poll(rowText, 'the drag value is on screen')
		.not.toBe(beforeText);
	const during = await readStack(page);
	expect(during.instances[0].params.threshold, 'nothing committed yet').toEqual(
		before.instances[0].params.threshold,
	);
	expect(during.historyHeadSeq).toBe(before.historyHeadSeq);

	await page.mouse.up();
	await expect
		.poll(async () => (await readStack(page)).historyHeadSeq)
		.toBe(before.historyHeadSeq + 1);
	expect((await readStack(page)).instances[0].params.threshold).not.toEqual(
		before.instances[0].params.threshold,
	);
});

test('dragging the default single slider by pointer updates the value with one history entry', async ({
	page,
}) => {
	await seedProject(page, ['pixelSort']);
	await waitForDisplayedSettle(page);
	const before = await readStack(page);
	const slider = page.getByRole('slider', {name: 'Skip chance'});
	await slider.scrollIntoViewIfNeeded();
	const box = await slider.boundingBox();
	if (!box) {
		throw new Error('Skip chance slider thumb has no layout box');
	}

	const startX = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(startX, y);
	await page.mouse.down();
	await page.mouse.move(startX + 80, y, {steps: 6});
	await page.mouse.up();

	await expect
		.poll(async () => (await readStack(page)).historyHeadSeq)
		.toBe(before.historyHeadSeq + 1);
	const after = await readStack(page);
	expect(after.instances[0].params.skipChance as number).toBeGreaterThan(0);
});

test('a burst of arrow keys on a slider is one commit after 500 ms', async ({
	page,
}) => {
	await seedProject(page, ['pixelSort']);
	const before = await readStack(page);
	const thumb = page.getByRole('slider', {name: 'Skip chance'});
	await thumb.focus();

	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Shift+ArrowRight');
	await expect(paramRow(page, 'Skip chance')).toContainText('0.12');
	expect((await readStack(page)).historyHeadSeq).toBe(before.historyHeadSeq);

	await expect
		.poll(async () => (await readStack(page)).historyHeadSeq)
		.toBe(before.historyHeadSeq + 1);
	expect((await readStack(page)).instances[0].params.skipChance).toBe(0.12);

	await thumb.focus();
	await page.keyboard.press('End');
	await expect
		.poll(async () => (await readStack(page)).historyHeadSeq)
		.toBe(before.historyHeadSeq + 2);
	expect((await readStack(page)).instances[0].params.skipChance).toBe(1);
});

test('arrow keys belong to the focused control, never to the whole page', async ({
	page,
}) => {
	await seedProject(page, ['pixelSort']);
	await expect(page.locator('canvas')).toBeVisible();

	// The canvas has focus: the arrows pan it and leave every parameter alone.
	const beforeCanvas = {
		view: await readView(page),
		params: await readParams(page),
	};
	await page.locator('canvas').focus();
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowDown');
	const afterCanvas = {
		view: await readView(page),
		params: await readParams(page),
	};

	expect(afterCanvas.view.centerX).toBeGreaterThan(beforeCanvas.view.centerX);
	expect(afterCanvas.view.centerY).toBeGreaterThan(beforeCanvas.view.centerY);
	expect(afterCanvas.params).toEqual(beforeCanvas.params);

	// A slider in the panel has focus: the arrows move that slider only.
	const thumb = page.getByRole('slider', {name: 'Skip chance'});
	await thumb.focus();
	const beforeSlider = {
		view: await readView(page),
		params: await readParams(page),
	};
	await page.keyboard.press('ArrowRight');
	await expect(paramRow(page, 'Skip chance')).toContainText('0.01');
	// A burst of nudges commits once, after the burst ends.
	await expect
		.poll(async () => (await readParams(page))?.skipChance)
		.toBeCloseTo((beforeSlider.params?.skipChance as number) + 0.01, 5);

	expect(await readView(page)).toEqual(beforeSlider.view);
});

test('the angle dial snaps within 4 degrees and Shift bypasses the snap', async ({
	page,
}) => {
	await seedProject(page, ['pixelSort']);
	const box = await page
		.getByRole('slider', {name: 'Angle', exact: true})
		.boundingBox();
	if (!box) {
		throw new Error('Dial has no layout box');
	}

	const centerX = box.x + box.width / 2;
	const centerY = box.y + box.height / 2;
	const radius = box.width / 2;
	const at = (degrees: number, scale: number) => {
		const radians = (degrees * Math.PI) / 180;
		return {
			x: centerX + radius * scale * Math.cos(radians),
			y: centerY - radius * scale * Math.sin(radians),
		};
	};

	const snapped = at(43, 0.7);
	await page.mouse.move(snapped.x, snapped.y);
	await page.mouse.down();
	await page.mouse.move(at(43, 0.9).x, at(43, 0.9).y);
	await page.mouse.up();
	await expect
		.poll(async () => (await readStack(page)).instances[0].params.angle)
		.toBe(45);

	await page.keyboard.down('Shift');
	const free = at(30, 0.6);
	await page.mouse.move(free.x, free.y);
	await page.mouse.down();
	await page.mouse.move(at(30, 0.9).x, at(30, 0.9).y);
	await page.mouse.up();
	await page.keyboard.up('Shift');

	await expect
		.poll(async () => (await readStack(page)).instances[0].params.angle)
		.not.toBe(45);
	const angle = (await readStack(page)).instances[0].params.angle as number;
	expect(Math.abs(angle - 30), 'Shift keeps the pointer angle').toBeLessThan(
		1.5,
	);
});

test('choosing the Edges interval mode swaps the threshold range for the edge controls', async ({
	page,
}) => {
	await seedProject(page, ['pixelSort']);
	await expect(paramRow(page, 'Threshold range')).toBeVisible();

	await page
		.getByRole('radiogroup', {name: 'Interval mode'})
		.getByRole('radio', {name: 'Edges'})
		.click();

	await expect(paramRow(page, 'Threshold range')).toHaveCount(0);
	await expect(
		page.getByRole('slider', {name: 'Threshold range low'}),
	).toHaveCount(0);
	await expect(paramRow(page, 'Edge threshold')).toBeVisible();
	await expect(paramRow(page, 'Edge blur')).toContainText('1 px');
	await expect(paramRow(page, 'Invert')).toBeVisible();

	await page
		.getByRole('radiogroup', {name: 'Interval mode'})
		.getByRole('radio', {name: 'Whole line'})
		.click();
	await expect(paramRow(page, 'Invert')).toHaveCount(0);
});

test('Mix and Blend each create one commit and Undo restores the previous value', async ({
	page,
}) => {
	await seedProject(page, ['pixelSort']);
	const mixField = page.getByRole('textbox', {name: 'Mix'});
	await expect(mixField).toHaveValue('100%');
	const before = await readStack(page);

	await mixField.fill('40');
	await mixField.press('Enter');
	await expect.poll(async () => (await readStack(page)).mix).toBe(0.4);
	expect((await readStack(page)).historyHeadSeq).toBe(
		before.historyHeadSeq + 1,
	);

	await page
		.getByRole('radiogroup', {name: 'Blend'})
		.getByRole('radio', {name: 'Lighten'})
		.click();
	await expect.poll(async () => (await readStack(page)).blend).toBe('lighten');
	expect((await readStack(page)).historyHeadSeq).toBe(
		before.historyHeadSeq + 2,
	);

	await undo(page);
	await expect.poll(async () => (await readStack(page)).blend).toBe('normal');
	expect((await readStack(page)).mix).toBe(0.4);
});

test('Reset all returns every parameter, the mix and the blend to defaults as one commit', async ({
	page,
}) => {
	await seedProject(page, ['pixelSort']);
	await settled(page, async () => {
		await setParam(page, 'angle', 90);
		await setMix(page, 0.5);
		await setBlend(page, 'difference');
	});
	const before = await readStack(page);

	await page.getByRole('button', {name: 'Reset all'}).click();

	await expect.poll(async () => (await readStack(page)).mix).toBe(1);
	const after = await readStack(page);
	expect(after.blend).toBe('normal');
	expect(after.instances[0].params.angle).toBe(0);
	expect(after.historyHeadSeq).toBe(before.historyHeadSeq + 1);
});

test('a parameter reset is one commit and its undo restores the value', async ({
	page,
}) => {
	await seedProject(page, ['pixelSort']);
	await setParam(page, 'angle', 90);
	const before = await readStack(page);

	await page.getByRole('button', {name: 'Reset Angle to default'}).click();
	await expect
		.poll(async () => (await readStack(page)).instances[0].params.angle)
		.toBe(0);
	expect((await readStack(page)).historyHeadSeq).toBe(
		before.historyHeadSeq + 1,
	);
});

test('a new seed is written as one commit and changes the rendered result', async ({
	page,
}) => {
	await seedProject(page, ['pixelSort']);
	const before = await settled(page, async () => {
		await setParam(page, 'order', 'shuffle');
	});
	const stackBefore = await readStack(page);

	const generation = await frameGeneration(page);
	await page.getByRole('button', {name: 'New seed'}).click();
	await expect
		.poll(async () => (await readStack(page)).instances[0].params.seed)
		.not.toBe(stackBefore.instances[0].params.seed);
	await waitForSettle(page, generation);

	expect((await readStack(page)).historyHeadSeq).toBe(
		stackBefore.historyHeadSeq + 1,
	);
	expect((await readPreview(page)).data).not.toEqual(before.data);
});

/**
Replaces `crypto.getRandomValues` with a fixed sequence so Randomize draws the
same values on every run; the app code under test is unchanged.
*/
async function fixRandomBytes(page: Page): Promise<void> {
	await page.addInitScript(() => {
		let state = 20_251_125;
		globalThis.crypto.getRandomValues = <T extends ArrayBufferView | null>(
			array: T,
		): T => {
			if (array) {
				const bytes = new Uint8Array(
					array.buffer,
					array.byteOffset,
					array.byteLength,
				);
				for (let index = 0; index < bytes.length; index++) {
					state = (state * 1_664_525 + 1_013_904_223) % 2 ** 32;
					bytes[index] = Math.floor(state / 2 ** 24);
				}
			}

			return array;
		};
	});
}

async function displayedValues(page: Page): Promise<string[]> {
	return page
		.locator(
			'[data-slot="parameter-panel"] input[type="text"], [data-slot="parameter-panel"] input:not([type])',
		)
		.evaluateAll((inputs) =>
			inputs.map((input) => (input as HTMLInputElement).value),
		);
}

test('Randomize changes the values and the canvas as one commit, and Undo restores the exact previous values', async ({
	page,
}) => {
	const consoleErrors = collectConsoleErrors(page);
	await fixRandomBytes(page);
	await seedProject(page, ['pixelSort']);
	await waitForDisplayedSettle(page);
	const canvasBefore = await readPreview(page);
	const stackBefore = await readStack(page);
	const valuesBefore = await displayedValues(page);

	const generation = await frameGeneration(page);
	await page.getByRole('button', {name: 'Randomize', exact: true}).click();
	await waitForSettle(page, generation);

	await expect(page.getByRole('status', {name: 'Status messages'})).toHaveText(
		'Randomized Pixel sort',
	);
	const stackAfter = await readStack(page);
	expect(stackAfter.historyHeadSeq).toBe(stackBefore.historyHeadSeq + 1);
	expect(stackAfter.instances[0].params).not.toEqual(
		stackBefore.instances[0].params,
	);
	expect(stackAfter.mix).toBe(stackBefore.mix);
	expect(stackAfter.blend).toBe(stackBefore.blend);
	expect(stackAfter.instances[0].enabled).toBe(true);
	await expect.poll(() => displayedValues(page)).not.toEqual(valuesBefore);
	expect((await readPreview(page)).data).not.toEqual(canvasBefore.data);

	const undoButton = page.getByRole('button', {name: /^Undo/});
	await expect(undoButton).toHaveAccessibleName('Undo Randomize Pixel sort');
	await undoButton.click();
	await expect
		.poll(async () => (await readStack(page)).historyHeadSeq)
		.toBe(stackBefore.historyHeadSeq);
	expect(await readParams(page)).toEqual(stackBefore.instances[0].params);
	await expect.poll(() => displayedValues(page)).toEqual(valuesBefore);
	expect(consoleErrors, 'Console errors').toEqual([]);
});

test('Randomize works from the keyboard and leaves Mix, Blend and the off state alone', async ({
	page,
}) => {
	await fixRandomBytes(page);
	await seedProject(page, ['pixelSort']);
	await setMix(page, 0.4);
	await setBlend(page, 'difference');
	await setEnabled(page, false);
	const before = await readStack(page);

	const button = page.getByRole('button', {name: 'Randomize', exact: true});
	await button.focus();
	await page.keyboard.press('Enter');
	await expect
		.poll(async () => (await readStack(page)).historyHeadSeq)
		.toBe(before.historyHeadSeq + 1);
	const afterEnter = await readStack(page);
	await expect(button).toBeFocused();
	await page.keyboard.press('Space');
	await expect
		.poll(async () => (await readStack(page)).historyHeadSeq)
		.toBe(before.historyHeadSeq + 2);

	const after = await readStack(page);
	expect(after.instances[0].params).not.toEqual(afterEnter.instances[0].params);
	expect(after.mix).toBe(0.4);
	expect(after.blend).toBe('difference');
	expect(after.instances[0].enabled).toBe(false);
});

test('at 390 px Randomize is an icon-only button with a tooltip beside Reset all @a11y', async ({
	page,
}) => {
	await page.setViewportSize({width: 390, height: 844});
	await seedProject(page, ['pixelSort']);

	const button = page.getByRole('button', {name: 'Randomize', exact: true});
	const reset = page.getByRole('button', {name: 'Reset all'});
	await expect(button).toBeVisible();
	await expect(button).toHaveText('');
	await button.hover();
	await expect(page.getByRole('tooltip')).toContainText('random');

	const boxes = await Promise.all([button.boundingBox(), reset.boundingBox()]);
	const [randomBox, resetBox] = boxes;
	if (!randomBox || !resetBox) {
		throw new Error('A header button has no layout box');
	}

	expect(randomBox.x + randomBox.width).toBeLessThanOrEqual(resetBox.x);
	expect(resetBox.x + resetBox.width).toBeLessThanOrEqual(390);
	expect(randomBox.y).toBe(resetBox.y);
	await assertNoA11yViolations(page);
});

test('the selection view changes only the preview, never an export', async ({
	page,
}) => {
	await seedProject(page, ['pixelSort']);
	const normal = await settled(page, () =>
		setParam(page, 'threshold', [0.3, 0.6]),
	);
	const normalExport = await exportPixels(page);

	await page.getByRole('switch', {name: 'Show selection'}).click();
	await expect
		.poll(async () => (await readPreview(page)).data.join(','), {
			timeout: 20_000,
		})
		.not.toBe(normal.data.join(','));
	expect(
		mismatches(
			await exportPixels(page),
			normalExport,
			'export with Show selection',
		),
	).toEqual([]);

	await page.getByRole('switch', {name: 'Show selection'}).click();
	await expect
		.poll(async () => (await readPreview(page)).data.join(','), {
			timeout: 20_000,
		})
		.toBe(normal.data.join(','));
});

test('Mix 0 is pixel-identical to the instance switched off for every blend mode', async ({
	page,
}) => {
	await seedProject(page, ['pixelSort']);
	const withEffect = await settled(page, async () => {
		await setParam(page, 'threshold', [0.3, 0.7]);
		await setParam(page, 'order', 'shuffle');
	});
	const off = await settled(page, () => setEnabled(page, false));
	expect(
		mismatches(off, withEffect, 'the effect must change the preview'),
	).not.toEqual([]);

	for (const blend of BLENDS) {
		await setEnabled(page, true);
		const generation = await frameGeneration(page);
		await setBlend(page, blend);
		await setMix(page, 0);
		await waitForSettle(page, generation);
		expect(
			mismatches(await readPreview(page), off, `mix 0 with blend ${blend}`),
		).toEqual([]);
	}

	const restored = await settled(page, async () => {
		await setMix(page, 1);
		await setBlend(page, 'normal');
	});
	expect(mismatches(restored, withEffect, 'mix 100')).toEqual([]);
});

test('Mix 50 follows the engine blend formula and Mix 100 follows each blend mode', async ({
	page,
}) => {
	await seedProject(page, ['pixelSort']);
	const off = await settled(page, async () => {
		await setParam(page, 'threshold', [0.3, 0.7]);
		await setParam(page, 'order', 'shuffle');
		await setEnabled(page, false);
	});
	const full = await settled(page, () => setEnabled(page, true));
	expect(mismatches(full, off, 'the effect must sort something')).not.toEqual(
		[],
	);

	const half = await settled(page, () => setMix(page, 0.5));
	const wrong: string[] = [];
	for (let index = 0; index < off.data.length; index += 4) {
		for (let channel = 0; channel < 4; channel++) {
			const expected = mixed(
				off.data[index + channel],
				full.data[index + channel],
				50,
			);
			if (half.data[index + channel] !== expected && wrong.length < 4) {
				wrong.push(
					`channel ${channel} of pixel ${index / 4}: ${half.data[index + channel]} != ${expected}`,
				);
			}
		}
	}

	expect(wrong, 'mix 50 in the engine formula').toEqual([]);

	const blends = [
		{name: 'lighten', combine: (i: number, f: number) => Math.max(i, f)},
		{name: 'darken', combine: (i: number, f: number) => Math.min(i, f)},
		{name: 'difference', combine: (i: number, f: number) => Math.abs(i - f)},
	] as const;

	for (const blend of blends) {
		const frame = await settled(page, async () => {
			await setBlend(page, blend.name);
			await setMix(page, 1);
		});
		const found: string[] = [];
		for (let index = 0; index < off.data.length; index += 4) {
			for (let channel = 0; channel < 3; channel++) {
				const expected = blend.combine(
					off.data[index + channel],
					full.data[index + channel],
				);
				if (frame.data[index + channel] !== expected && found.length < 3) {
					found.push(
						`channel ${channel} of pixel ${index / 4}: ${frame.data[index + channel]} != ${expected}`,
					);
				}
			}

			if (frame.data[index + 3] !== full.data[index + 3] && found.length < 4) {
				found.push(`alpha of pixel ${index / 4} is not the effect alpha`);
			}
		}

		expect(found, `mix 100 with blend ${blend.name}`).toEqual([]);
	}
});

test('the panel shows no selection, an unsupported instance and a disabled one', async ({
	page,
}) => {
	await seedProject(page, ['pixelSort', 'channelShift']);

	await page.evaluate(() => {
		(globalThis as unknown as RuntimeGlobal).__psgBundle?.store
			.getState()
			.selectEffect(null);
	});
	await expect(page.getByText('No effect selected')).toBeVisible();

	await page.evaluate(async () => {
		const {store} = (globalThis as unknown as RuntimeGlobal).__psgBundle!;
		const project = store.getState().activeProject;
		if (!project) {
			throw new Error('No active project');
		}

		const instanceId = project.stack.instances[1].id;
		await store.getState().setEffectEnabled(instanceId, false);
		store.getState().selectEffect(instanceId);
	});
	await expect(
		page.getByRole('heading', {name: 'Channel shift'}),
	).toBeVisible();
	await expect(page.getByText('Off', {exact: true}).first()).toBeVisible();
	await expect(page.getByRole('slider', {name: 'Red X'})).toBeVisible();
	await expect(page.getByText('Show selection')).toHaveCount(0);

	await page.evaluate(async () => {
		const {store, repository} = (globalThis as unknown as RuntimeGlobal)
			.__psgBundle!;
		const project = store.getState().activeProject;
		if (!project) {
			throw new Error('No active project');
		}

		await repository.saveProjectStack(project.id, {
			schemaVersion: 1,
			instances: [
				...project.stack.instances,
				{
					id: 'future01',
					type: 'futureEffect',
					version: 7,
					enabled: true,
					params: {},
					mix: 1,
					blend: 'normal',
				},
			],
		});
		await store.getState().openProject(project.id);
		store.getState().selectEffect('future01');
	});
	await expect(
		page
			.getByRole('region', {name: 'Parameters'})
			.getByText('Unsupported effect (futureEffect v7)'),
	).toBeVisible();
	await expect(page.getByRole('slider')).toHaveCount(0);
	expect(await page.locator('input').count()).toBe(0);
});

for (const theme of THEMES) {
	for (const viewport of PROOF_VIEWPORTS) {
		test(`the parameter panel follows the ${viewport.name} layout with no a11y violations in ${theme.name} @a11y`, async ({
			page,
		}) => {
			const consoleErrors = collectConsoleErrors(page);
			await seedInTheme(page, theme, viewport);
			await setParam(page, 'angle', 45);
			await expect(
				page.getByRole('heading', {name: 'Pixel sort'}),
			).toBeVisible();
			await expect(page.getByText('Show selection')).toBeVisible();
			await page.waitForTimeout(500);

			const metrics = await page.evaluate(() => {
				const region = globalThis.document.querySelector(
					'section[aria-label="Parameters"]',
				);
				const scroller = globalThis.document.querySelector(
					'section[aria-label="Parameters"] [data-slot="scroll-area-viewport"]',
				);
				return {
					scrollWidth: globalThis.document.documentElement.scrollWidth,
					innerWidth: globalThis.innerWidth,
					regionWidth: region?.getBoundingClientRect().width ?? 0,
					regionHeight: region?.getBoundingClientRect().height ?? 0,
					viewportHeight: scroller?.clientHeight ?? 0,
					contentHeight: scroller?.scrollHeight ?? 0,
				};
			});

			expect(
				metrics.scrollWidth,
				'the page never scrolls sideways',
			).toBeLessThanOrEqual(metrics.innerWidth);
			expect(metrics.regionWidth).toBeGreaterThan(0);
			expect(metrics.regionHeight).toBeGreaterThan(0);
			expect(
				metrics.contentHeight,
				'the panel scrolls inside its region',
			).toBeGreaterThan(metrics.viewportHeight);

			await page.screenshot({
				path: `.proof/params/${theme.name}-${viewport.width}x${viewport.height}.png`,
			});

			await assertNoA11yViolations(page);
			expect(consoleErrors, 'Console errors').toEqual([]);
		});
	}
}
