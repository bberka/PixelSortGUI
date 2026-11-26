// Blending a second image through the image control (product.md F26, DESIGN.md
// section 7.2).
import {Buffer} from 'node:buffer';
import {readFile} from 'node:fs/promises';
import {
	expect,
	test,
	type Browser,
	type Locator,
	type Page,
} from '@playwright/test';
import {decode as decodePng, encode as encodePng} from 'fast-png';
import {renderSizeForPixelCap} from '../../src/codec/decode.ts';
import {effectRegistry} from '../../src/engine/effects/index.ts';
import {renderStack} from '../../src/engine/pipeline.ts';
import type {EffectStack, RgbaImage} from '../../src/engine/types.ts';
import type {AppRuntime} from '../../src/state/index.ts';
import {assertNoA11yViolations} from './axe.ts';
import {
	blockFullStorage,
	chooseImages,
	makeImage,
	readImportState,
	type ChosenFixture,
} from './import.ts';
import {syntheticImage} from './render-fixtures.ts';
import {waitForSettleRender} from './settle.ts';
import {PROOF_VIEWPORTS} from './viewports.ts';

type RuntimeGlobal = {__psgRuntime?: AppRuntime};

const CAP_MESSAGE = 'A project can use at most 8 extra blend images.';
type Colour = readonly [number, number, number];
const BASE_COLOUR: Colour = [200, 100, 50];
const RED: Colour = [50, 60, 70];
const GREEN: Colour = [10, 220, 90];

const difference = (a: Colour, b: Colour) => [
	...a.map((value, index) => Math.abs(value - b[index])),
	255,
];

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

function solid(
	name: string,
	colour: Colour,
	width = 64,
	height = 48,
): ChosenFixture {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let index = 0; index < data.length; index += 4) {
		data.set([...colour, 255], index);
	}

	return pngFixture(name, {width, height, data});
}

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

// Stores each fixture as a project without opening it; returns the hashes.
async function seedLibrary(
	page: Page,
	fixtures: readonly ChosenFixture[],
): Promise<string[]> {
	const hashes: string[] = [];
	for (const fixture of fixtures) {
		hashes.push(
			await page.evaluate(
				async ({bytes, name}) => {
					const booted = await (globalThis as unknown as RuntimeGlobal)
						.__psgRuntime!.ready;
					if (booted.status !== 'ready') {
						throw new Error(booted.status);
					}

					const response = await fetch(`data:image/png;base64,${bytes}`);
					const blob = await response.blob();
					const bitmap = await globalThis.createImageBitmap(blob);
					const {width, height} = bitmap;
					bitmap.close();
					const {source} = await booted.bundle.store
						.getState()
						.importImage({name, blob, width, height, setActive: false});
					return source.sha256;
				},
				{bytes: fixture.buffer.toString('base64'), name: fixture.name},
			),
		);
	}

	return hashes;
}

async function readEditor(page: Page) {
	return page.evaluate(async () => {
		const booted = await (globalThis as unknown as RuntimeGlobal).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error(booted.status);
		}

		const {activeProject} = booted.bundle.store.getState();
		return {
			id: activeProject!.id,
			head: activeProject!.historyHeadSeq,
			stack: activeProject!.stack,
			images: activeProject!.stack.instances.map(
				(instance) => instance.params.image,
			),
		};
	});
}

async function openBase(
	page: Page,
	fixture = solid('base.png', BASE_COLOUR),
): Promise<void> {
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
		page.getByRole('button', {name: `${name} actions`}),
	).toBeVisible();
}

const chooser = (page: Page) =>
	page.getByRole('dialog', {name: 'Choose image'});
const chooseButton = (page: Page) =>
	page.getByRole('button', {name: 'Choose image', exact: true});
const clearButton = (page: Page) =>
	page.getByRole('button', {name: 'Clear image'});
const panel = (page: Page) => page.locator('[data-slot="parameter-panel"]');
const missing = (page: Page) => page.getByText('Missing image');

async function pickFromDevice(
	page: Page,
	fixture: ChosenFixture,
): Promise<void> {
	await chooseButton(page).click();
	const pending = page.waitForEvent('filechooser');
	await chooser(page).getByRole('button', {name: 'From device'}).click();
	const files = await pending;
	await files.setFiles(fixture);
}

async function pickFromLibrary(page: Page, name: string): Promise<void> {
	await chooseButton(page).click();
	await chooser(page).getByRole('button', {name: 'From library'}).click();
	await chooser(page)
		.getByRole('button', {name: new RegExp(String.raw`^${name} \d`)})
		.click();
	await expect(chooser(page)).toBeHidden();
}

// The pixel in the middle of the newest settle frame that has every image.
async function previewPixel(page: Page): Promise<number[] | null> {
	return page.evaluate(async () => {
		const booted = await (globalThis as unknown as RuntimeGlobal).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error(booted.status);
		}

		const {frame} = booted.bundle.store.getState().render;
		if (
			frame?.level !== 'settle' ||
			frame.sourcesPending ||
			frame.warnings.length > 0
		) {
			return null;
		}

		const canvas = new globalThis.OffscreenCanvas(frame.width, frame.height);
		const context = canvas.getContext('2d', {willReadFrequently: true})!;
		context.drawImage(frame.bitmap, 0, 0);
		return [
			...context.getImageData(
				Math.floor(frame.width / 2),
				Math.floor(frame.height / 2),
				1,
				1,
			).data,
		];
	});
}

const expectPreview = async (page: Page, pixel: readonly number[]) => {
	await expect.poll(async () => previewPixel(page)).toEqual([...pixel]);
};

async function exportPng(page: Page) {
	await page.getByRole('button', {name: 'Export'}).click();
	const dialog = page.getByRole('dialog', {name: 'Export'});
	await dialog.getByRole('radio', {name: 'PNG', exact: true}).click();
	const pending = page.waitForEvent('download');
	await dialog.getByRole('button', {name: 'Download'}).click();
	const download = await pending;
	const bytes = await readFile(await download.path());
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	const png = decodePng(bytes);
	return {bytes, width: png.width, height: png.height, data: [...png.data]};
}

const pixelOf = (image: {data: number[]; width: number; height: number}) => {
	const offset =
		(Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)) *
		4;
	return image.data.slice(offset, offset + 4);
};

async function deleteProject(page: Page, name: string): Promise<void> {
	await page.evaluate(async (projectName) => {
		const booted = await (globalThis as unknown as RuntimeGlobal).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error(booted.status);
		}

		const {store} = booted.bundle;
		const project = store
			.getState()
			.projects.find((item) => item.name === projectName)!;
		await store.getState().deleteProject(project.id);
	}, name);
}

test('AC-F26.1: a device image blends in the preview and exports the same bytes twice', async ({
	page,
}) => {
	const problems = trackProblems(page);
	await openBase(page);
	await addEffect(page, 'Image blend');
	await expect(panel(page)).toContainText('No image selected');
	await expect(clearButton(page)).toHaveCount(0);

	await pickFromDevice(page, solid('red.png', RED, 32, 24));
	await expect(panel(page)).toContainText('32 × 24 px');
	await panel(page).getByRole('combobox', {name: 'Blend mode'}).click();
	await page.getByRole('option', {name: 'Difference'}).click();
	const opacity = panel(page).getByRole('textbox', {name: 'Opacity'});
	await opacity.fill('100');
	await opacity.press('Enter');

	const expected = difference(BASE_COLOUR, RED);
	await expectPreview(page, expected);
	await expect(
		page.getByRole('button', {name: 'Undo Blend mode Difference'}),
	).toBeEnabled();
	const first = await exportPng(page);
	const second = await exportPng(page);
	expect([first.width, first.height]).toEqual([64, 48]);
	expect(pixelOf(first)).toEqual(expected);
	expect(first.bytes.equals(second.bytes)).toBe(true);
	// The picked image is a stored source, not a project.
	const state = await readImportState(page);
	expect(state.projects).toHaveLength(1);
	expect(state.sourceCount).toBe(2);

	await page.reload();
	await expect(panel(page)).toContainText('32 × 24 px');
	await expectPreview(page, expected);
	await expect(missing(page)).toHaveCount(0);
	expect(problems).toEqual([]);
});

test('AC-F26.2: effects before the blend change the photo only, effects after it change the result', async ({
	page,
}) => {
	const base = syntheticImage(160, 120);
	const extra = syntheticImage(90, 130);
	await openBase(page, pngFixture('base.png', base));
	const [hash] = await seedLibrary(page, [pngFixture('extra.png', extra)]);
	await addEffect(page, 'Pixel sort');
	await addEffect(page, 'Image blend');
	await pickFromLibrary(page, 'extra');
	await panel(page).getByRole('combobox', {name: 'Blend mode'}).click();
	await page.getByRole('option', {name: 'Screen'}).click();
	await addEffect(page, 'Channel shift');
	const redX = panel(page).getByRole('textbox', {name: 'Red X'});
	await redX.fill('12');
	await redX.press('Enter');
	await expect(
		page.getByRole('button', {name: 'Undo Red X 12 px'}),
	).toBeEnabled();

	const exported = await exportPng(page);

	const {stack} = await readEditor(page);
	const render = async (order: EffectStack) => {
		const result = await renderStack(base, order, effectRegistry, {
			level: 'full',
			sourceWidth: base.width,
			sourceHeight: base.height,
			extraSources: new Map([
				[hash, {...extra, sourceWidth: 90, sourceHeight: 130}],
			]),
			checkpoint: () => undefined,
		});
		expect(result.warnings).toEqual([]);
		return [...result.image.data];
	};

	expect(stack.instances.map((instance) => instance.type)).toEqual([
		'pixelSort',
		'imageBlend',
		'channelShift',
	]);
	expect(exported.data).toEqual(await render(stack));
	// Sorting after the blend would give another picture.
	const [sort, blend, shift] = stack.instances;
	expect(exported.data).not.toEqual(
		await render({...stack, instances: [blend, sort, shift]}),
	);
});

test('F26 library: every other project is offered and its image is blended', async ({
	page,
}) => {
	await openBase(page);
	await seedLibrary(page, [solid('red.png', RED)]);
	await addEffect(page, 'Image blend');
	const before = await readImportState(page);
	expect(before.sourceCount).toBe(2);

	// The open project is not offered.
	await chooseButton(page).click();
	await chooser(page).getByRole('button', {name: 'From library'}).click();
	await expect(
		chooser(page).getByRole('list', {name: 'Library images'}),
	).toBeVisible();
	await expect(
		chooser(page).getByRole('listitem').getByRole('button'),
	).toHaveCount(1);
	await page.keyboard.press('Escape');

	await pickFromLibrary(page, 'red');
	await expectPreview(page, [...RED, 255]);
});

test('AC-F26.3: picking the same image reuses its blob, and deleting both projects removes it', async ({
	page,
}) => {
	await openBase(page);
	const red = solid('red.png', RED);
	await seedLibrary(page, [red]);
	await addEffect(page, 'Image blend');

	await pickFromLibrary(page, 'red');
	await expect(panel(page)).toContainText('64 × 48 px');
	expect((await readImportState(page)).sourceCount).toBe(2);
	// The same bytes from the device are the same stored image.
	await clearButton(page).click();
	await pickFromDevice(page, {...red, name: 'again.png'});
	await expect(panel(page)).toContainText('64 × 48 px');
	expect((await readImportState(page)).sourceCount).toBe(2);

	await deleteProject(page, 'red');
	expect((await readImportState(page)).sourceCount).toBe(2);
	await expectPreview(page, [...RED, 255]);
	await deleteProject(page, 'base');
	expect((await readImportState(page)).sourceCount).toBe(0);
});

test('AC-F26.4: undo and redo restore the image, also after the effect was removed', async ({
	page,
}) => {
	await openBase(page);
	await seedLibrary(page, [solid('red.png', RED)]);
	await addEffect(page, 'Image blend');
	await pickFromLibrary(page, 'red');
	await expectPreview(page, [...RED, 255]);
	await pickFromDevice(page, solid('green.png', GREEN, 40, 30));
	await expectPreview(page, [...GREEN, 255]);

	await page.getByRole('button', {name: 'Undo Blend image chosen'}).click();
	await expect(panel(page)).toContainText('64 × 48 px');
	await expectPreview(page, [...RED, 255]);
	await page.getByRole('button', {name: 'Redo Blend image chosen'}).click();
	await expect(panel(page)).toContainText('40 × 30 px');
	await expectPreview(page, [...GREEN, 255]);

	await clearButton(page).click();
	await expect(panel(page)).toContainText('No image selected');
	await expect(chooseButton(page)).toBeFocused();
	await expectPreview(page, [...BASE_COLOUR, 255]);
	await page.getByRole('button', {name: 'Undo Blend image cleared'}).click();
	await expectPreview(page, [...GREEN, 255]);

	await page.getByRole('button', {name: 'Image blend actions'}).click();
	await page.getByRole('menuitem', {name: 'Remove'}).click();
	await expectPreview(page, [...BASE_COLOUR, 255]);
	// Only history holds the green image now; a reload runs the cleanup.
	await page.reload();
	await waitForSettleRender(page);
	await page.getByRole('button', {name: 'Undo Remove Image blend'}).click();
	await expect(panel(page)).toContainText('40 × 30 px');
	await expectPreview(page, [...GREEN, 255]);
	await expect(missing(page)).toHaveCount(0);
});

async function freshPage(browser: Browser, baseURL: string): Promise<Page> {
	const context = await browser.newContext({baseURL, acceptDownloads: true});
	const page = await context.newPage();
	await page.goto('/');
	return page;
}

test('AC-F26.5: a project file and a backup carry the blended image to a fresh profile', async ({
	page,
	browser,
	baseURL,
}) => {
	await openBase(page);
	await addEffect(page, 'Image blend');
	await pickFromDevice(page, solid('green.png', GREEN));
	await expectPreview(page, [...GREEN, 255]);
	const original = await exportPng(page);

	await page.getByRole('button', {name: 'Save project file'}).click();
	const saving = page.waitForEvent('download');
	await page
		.getByRole('dialog', {name: 'Save project file'})
		.getByRole('button', {name: 'Save'})
		.click();
	const saved = await saving;
	const projectFile = await readFile(await saved.path());
	const backup = await page.evaluate(async () => {
		const booted = await (globalThis as unknown as RuntimeGlobal).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error(booted.status);
		}

		const {blob} = await booted.bundle.store.getState().exportBackup();
		return [...new Uint8Array(await blob.arrayBuffer())];
	});

	const opened = await freshPage(browser, baseURL!);
	await chooseImages(opened, [
		{
			name: saved.suggestedFilename(),
			mimeType: 'application/zip',
			buffer: projectFile,
		},
	]);
	await expectPreview(opened, [...GREEN, 255]);
	expect((await exportPng(opened)).data).toEqual(original.data);
	await opened.context().close();

	const restored = await freshPage(browser, baseURL!);
	await restored.evaluate(async (bytes) => {
		const booted = await (globalThis as unknown as RuntimeGlobal).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error(booted.status);
		}

		const {store} = booted.bundle;
		const inspection = await store
			.getState()
			.inspectBackup(new Blob([new Uint8Array(bytes)]));
		await store.getState().importBackup(inspection, {
			mode: 'merge',
			projectIds: inspection.preview.projects.map((project) => project.id),
			presets: false,
			settings: false,
		});
		await store.getState().openProject(store.getState().projects[0].id);
	}, backup);
	await expectPreview(restored, [...GREEN, 255]);
	expect((await exportPng(restored)).data).toEqual(original.data);
	await restored.context().close();
});

test('AC-F26.6: a ninth image is refused with the message and stores nothing', async ({
	page,
}) => {
	await openBase(page);
	const fixtures = Array.from({length: 9}, (_, index) =>
		solid(`extra-${index}.png`, [index * 20, 100, 100]),
	);
	const hashes = await seedLibrary(page, fixtures);
	await addEffect(page, 'Image blend');
	await page.evaluate(
		async (images) => {
			const booted = await (globalThis as unknown as RuntimeGlobal)
				.__psgRuntime!.ready;
			if (booted.status !== 'ready') {
				throw new Error(booted.status);
			}

			const {store} = booted.bundle;
			const [first] = store.getState().activeProject!.stack.instances;
			await store.getState().applyStack(
				{
					schemaVersion: 1,
					instances: ['', ...images].map((image, index) => ({
						...first,
						id: `blend00${index}`,
						params: {...first.params, image},
					})),
				},
				'Eight images',
			);
		},
		hashes.slice(0, 8),
	);
	// The first instance, still empty, is selected.
	await expect(panel(page)).toContainText('No image selected');
	const before = {
		...(await readEditor(page)),
		sources: (await readImportState(page)).sourceCount,
	};

	await pickFromDevice(page, solid('ninth.png', GREEN));
	await expect(panel(page).getByRole('alert')).toHaveText(CAP_MESSAGE);
	await pickFromLibrary(page, 'extra-8');
	await expect(panel(page).getByRole('alert')).toHaveText(CAP_MESSAGE);

	expect({
		...(await readEditor(page)),
		sources: (await readImportState(page)).sourceCount,
	}).toEqual(before);
	// An image the project already blends is not a ninth one.
	await pickFromLibrary(page, 'extra-3');
	await expect(panel(page).getByRole('alert')).toHaveCount(0);
	await expect(panel(page)).toContainText('64 × 48 px');
});

test('AC-F26.7: a saved preset keeps the blend settings and no image', async ({
	page,
}) => {
	await openBase(page);
	await addEffect(page, 'Image blend');
	await pickFromDevice(page, solid('green.png', GREEN));
	await panel(page).getByRole('combobox', {name: 'Blend mode'}).click();
	await page.getByRole('option', {name: 'Multiply'}).click();

	await page.getByRole('button', {name: 'Presets'}).click();
	await page.getByRole('button', {name: 'Save as preset'}).click();
	const dialog = page.getByRole('dialog', {name: 'Save as preset'});
	await dialog.getByLabel('Preset name').fill('Blend look');
	await dialog.getByRole('button', {name: 'Save preset'}).click();
	await expect(dialog).toHaveCount(0);
	await page.getByRole('button', {name: 'Back to library'}).click();
	await chooseImages(page, [solid('other.png', RED)]);
	await waitForSettleRender(page);
	await page.getByRole('button', {name: 'Presets'}).click();
	await page
		.getByRole('list', {name: 'Saved presets'})
		.getByRole('button', {name: /^Blend look \d/})
		.click();

	await expect(panel(page)).toContainText('No image selected');
	await expect(
		panel(page).getByRole('combobox', {name: 'Blend mode'}),
	).toHaveText('Multiply');
	await expect(missing(page)).toHaveCount(0);
	expect((await readEditor(page)).images).toEqual(['']);
});

async function tabTo(page: Page, target: Locator): Promise<void> {
	for (let step = 0; step < 60; step++) {
		if (
			await target.evaluate((node) => node === node.ownerDocument.activeElement)
		) {
			return;
		}

		await page.keyboard.press('Tab');
	}

	await expect(target).toBeFocused();
}

test('F26 keyboard: choose from both sources and clear without a pointer', async ({
	page,
}) => {
	await openBase(page);
	await seedLibrary(page, [solid('red.png', RED)]);
	await addEffect(page, 'Image blend');

	await chooseButton(page).focus();
	await page.keyboard.press('Enter');
	await expect(
		chooser(page).getByRole('button', {name: 'From device'}),
	).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(chooser(page)).toBeHidden();
	await expect(chooseButton(page)).toBeFocused();

	await page.keyboard.press('Space');
	await tabTo(page, chooser(page).getByRole('button', {name: 'From library'}));
	await page.keyboard.press('Enter');
	const tile = chooser(page).getByRole('button', {name: 'red 64 × 48 px'});
	await expect(tile).toBeFocused();
	await page.keyboard.press('Shift+Tab');
	await tabTo(page, chooser(page).getByRole('button', {name: 'Back'}));
	await page.keyboard.press('Enter');
	await expect(
		chooser(page).getByRole('button', {name: 'From library'}),
	).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(tile).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(chooser(page)).toBeHidden();
	await expect(chooseButton(page)).toBeFocused();
	await expectPreview(page, [...RED, 255]);

	await tabTo(page, clearButton(page));
	await page.keyboard.press('Enter');
	await expect(chooseButton(page)).toBeFocused();
	await expect(panel(page)).toContainText('No image selected');

	await page.keyboard.press('Enter');
	const pending = page.waitForEvent('filechooser');
	await page.keyboard.press('Enter');
	const files = await pending;
	await files.setFiles(solid('green.png', GREEN));
	await expectPreview(page, [...GREEN, 255]);
	await expect(chooseButton(page)).toBeFocused();
});

test('F26 missing image: the warning shows only for an image that is gone', async ({
	page,
}) => {
	// Records whether the warning was ever on screen, however briefly.
	await page.addInitScript(() => {
		new MutationObserver(() => {
			if (globalThis.document.body?.textContent?.includes('Missing image')) {
				globalThis.sessionStorage.setItem('sawMissing', 'yes');
			}
		}).observe(globalThis.document, {childList: true, subtree: true});
	});
	const sawMissing = async () =>
		page.evaluate(() => globalThis.sessionStorage.getItem('sawMissing'));
	await openBase(page);
	await addEffect(page, 'Image blend');
	await pickFromDevice(page, solid('green.png', GREEN));
	await expectPreview(page, [...GREEN, 255]);
	await page.reload();
	await expect(panel(page)).toContainText('64 × 48 px');
	await expectPreview(page, [...GREEN, 255]);
	expect(await sawMissing()).toBeNull();

	// Storage loses the image behind the app's back.
	await page.evaluate(async () => {
		const booted = await (globalThis as unknown as RuntimeGlobal).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error(booted.status);
		}

		const image = String(
			booted.bundle.store.getState().activeProject!.stack.instances[0].params
				.image,
		);
		await new Promise<void>((resolve, reject) => {
			const request = globalThis.indexedDB.open('drift');
			request.addEventListener('success', () => {
				const transaction = request.result.transaction('sources', 'readwrite');
				transaction.objectStore('sources').delete(image);
				transaction.addEventListener('complete', () => {
					request.result.close();
					resolve();
				});
				transaction.addEventListener('error', () => {
					reject(new Error('Delete failed'));
				});
			});
		});
	});
	await page.reload();

	await expect(missing(page)).toBeVisible();
	await expect(chooseButton(page)).toBeVisible();
	await waitForSettleRender(page);
	// Picking the file again stores it again.
	await pickFromDevice(page, solid('green.png', GREEN));
	await expect(missing(page)).toHaveCount(0);
	await expectPreview(page, [...GREEN, 255]);
});

const REFUSALS = [
	{
		fixture: {
			name: 'phone.heic',
			mimeType: 'image/heic',
			buffer: Buffer.from('\0\0\0\u0018ftypheic'),
		},
		title: "Can't open image",
		message:
			"Can't open phone.heic: HEIC/HEIF is not supported in this browser. Convert it to JPEG, PNG, or WebP first.",
	},
	{
		fixture: {
			name: 'shot.cr2',
			mimeType: '',
			buffer: Buffer.from('II*\0\u0010\0\0\0CR\u0002\0'),
		},
		title: "Can't open image",
		message:
			"Can't open shot.cr2: RAW camera files are not supported. Export a TIFF, PNG, or JPEG from your RAW converter first.",
	},
	{
		fixture: {
			name: 'text.jpg',
			mimeType: 'image/jpeg',
			buffer: Buffer.from('not an image'),
		},
		title: "Can't open image",
		message: "Can't open text.jpg: the browser can't read this image format.",
	},
];

test('F26 device pick: files the import rules refuse change nothing', async ({
	page,
}) => {
	await openBase(page);
	await addEffect(page, 'Image blend');
	const wide = await makeImage(page, {
		name: 'wide.png',
		width: 20_000,
		height: 20,
	});
	const before = await readEditor(page);
	const refusals = [
		...REFUSALS,
		{
			fixture: wide,
			title: 'Image too large',
			message:
				'Image too large: the longest side is 20,000 px; the limit is 16,384 px.',
		},
	];

	for (const {fixture, title, message} of refusals) {
		await pickFromDevice(page, fixture);
		const dialog = page.getByRole('alertdialog', {name: title});
		await expect(dialog).toContainText(message);
		await dialog.getByRole('button', {name: 'Dismiss'}).click();
		await expect(dialog).toBeHidden();
		await expect(chooseButton(page)).toBeFocused();
	}

	expect(await readEditor(page)).toEqual(before);
	expect((await readImportState(page)).sourceCount).toBe(1);
});

test('F26 device pick: an image over 50 MP can be taken at 50 MP', async ({
	page,
}) => {
	test.slow();
	await openBase(page);
	await addEffect(page, 'Image blend');
	const large = await makeImage(page, {
		name: 'huge.jpg',
		width: 8000,
		height: 6400,
		type: 'image/jpeg',
		quality: 0.7,
	});

	await pickFromDevice(page, large);
	const dialog = page.getByRole('alertdialog');
	await expect(
		dialog.getByRole('heading', {name: 'huge.jpg is 8000 × 6400 px'}),
	).toBeVisible();
	await dialog.getByRole('button', {name: 'Cancel'}).click();
	await expect(panel(page)).toContainText('No image selected');
	expect((await readImportState(page)).sourceCount).toBe(1);

	await pickFromDevice(page, large);
	await dialog.getByRole('button', {name: 'Import at 50 MP'}).click();
	const size = renderSizeForPixelCap(8000, 6400, 50_000_000);
	await expect(panel(page)).toContainText(`${size.width} × ${size.height} px`);
	expect((await readImportState(page)).sourceCount).toBe(2);
});

test('F26 device pick: a full storage opens "Storage is full" and changes nothing', async ({
	page,
}) => {
	await openBase(page);
	await addEffect(page, 'Image blend');
	const before = await readEditor(page);
	await blockFullStorage(page);
	await page.reload();
	await waitForSettleRender(page);

	await pickFromDevice(page, solid('green.png', GREEN));

	await expect(
		page.getByRole('alertdialog', {name: 'Storage is full'}),
	).toBeVisible();
	expect(await readEditor(page)).toEqual(before);
	expect((await readImportState(page)).sourceCount).toBe(1);
});

test('F26: a picked file survives a layout change while the picker is open', async ({
	page,
}) => {
	await page.setViewportSize(PROOF_VIEWPORTS[0]);
	await openBase(page);
	await addEffect(page, 'Image blend');
	await chooseButton(page).click();
	const pending = page.waitForEvent('filechooser');
	await chooser(page).getByRole('button', {name: 'From device'}).click();
	const files = await pending;
	// The phone panel is replaced by the tablet one.
	await page.setViewportSize(PROOF_VIEWPORTS[1]);
	await expect(page.locator('[data-viewport-class="tablet"]')).toBeVisible();

	await files.setFiles(solid('green.png', GREEN));

	await expect(panel(page)).toContainText('64 × 48 px');
	await expectPreview(page, [...GREEN, 255]);
});

for (const viewport of PROOF_VIEWPORTS) {
	test(`F26: the control and its chooser fit ${viewport.width}x${viewport.height}`, async ({
		page,
	}) => {
		const problems = trackProblems(page);
		await page.setViewportSize(viewport);
		await openBase(page);
		await seedLibrary(page, [solid('red.png', RED)]);
		await addEffect(page, 'Image blend');
		await pickFromLibrary(page, 'red');
		await expectPreview(page, [...RED, 255]);
		await assertNoA11yViolations(page);
		await chooseButton(page).click();
		await chooser(page).getByRole('button', {name: 'From library'}).click();
		await expect(
			chooser(page).getByRole('button', {name: 'red 64 × 48 px'}),
		).toBeInViewport({ratio: 1});
		await expect
			.poll(async () =>
				chooser(page).evaluate(
					(node) => node.getAnimations({subtree: true}).length,
				),
			)
			.toBe(0);
		await assertNoA11yViolations(page);
		expect(
			await page.evaluate(
				() =>
					globalThis.document.documentElement.scrollWidth <=
					globalThis.innerWidth,
			),
		).toBe(true);
		expect(problems).toEqual([]);
	});
}

test.describe('on a touch phone', () => {
	test.skip(
		({browserName}) => browserName !== 'chromium',
		'Playwright emulates a coarse pointer in Chromium only',
	);
	test.use({viewport: PROOF_VIEWPORTS[0], hasTouch: true, isMobile: true});

	async function expectTouchTarget(control: Locator): Promise<void> {
		await expect
			.poll(async () => (await control.boundingBox())?.height ?? 0)
			.toBeGreaterThanOrEqual(44);
		expect((await control.boundingBox())!.width).toBeGreaterThanOrEqual(44);
	}

	for (const size of [
		{name: 'portrait', width: 390, height: 844, side: 'bottom'},
		{name: 'landscape', width: 844, height: 390, side: 'right'},
	]) {
		test(`F26: 44 px targets and a sheet in ${size.name}`, async ({page}) => {
			await page.setViewportSize(size);
			await openBase(page);
			await seedLibrary(page, [solid('red.png', RED)]);
			await addEffect(page, 'Image blend');
			await pickFromLibrary(page, 'red');
			await expect(panel(page)).toContainText('64 × 48 px');

			await expectTouchTarget(chooseButton(page));
			await expectTouchTarget(clearButton(page));
			// Both fit the control area without scrolling it (DESIGN.md 6.4).
			await expect(chooseButton(page)).toBeInViewport({ratio: 1});
			await expect(clearButton(page)).toBeInViewport({ratio: 1});

			await chooseButton(page).tap();
			const sheet = page.locator('[data-slot="sheet-content"]');
			await expect(sheet).toBeVisible();
			await expect
				.poll(async () => sheet.evaluate((node) => node.getAnimations().length))
				.toBe(0);
			const box = (await sheet.boundingBox())!;
			expect(
				size.side === 'bottom' ? box.y + box.height : box.x + box.width,
			).toBeCloseTo(size.side === 'bottom' ? size.height : size.width, 0);
			await expectTouchTarget(sheet.getByRole('button', {name: 'Close'}));
			await expectTouchTarget(sheet.getByRole('button', {name: 'From device'}));
			await expectTouchTarget(
				sheet.getByRole('button', {name: 'From library'}),
			);
			await sheet.getByRole('button', {name: 'From library'}).tap();
			await expectTouchTarget(sheet.getByRole('button', {name: 'Back'}));
			const tile = sheet.getByRole('button', {name: 'red 64 × 48 px'});
			await expectTouchTarget(tile);
			await expect(tile).toBeInViewport({ratio: 1});
		});
	}
});
