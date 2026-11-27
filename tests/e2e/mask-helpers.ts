// Page helpers shared by the mask control and brush specs.
import {Buffer} from 'node:buffer';
import {readFile} from 'node:fs/promises';
import {expect, type Page} from '@playwright/test';
import {decode as decodePng, encode as encodePng} from 'fast-png';
import type {RgbaImage} from '../../src/engine/types.ts';
import type {AppRuntime} from '../../src/state/index.ts';
import {chooseImages, type ChosenFixture} from './import.ts';
import {waitForSettleRender} from './settle.ts';

export type RuntimeGlobal = {__psgRuntime?: AppRuntime};

export function pngFixture(name: string, image: RgbaImage): ChosenFixture {
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

export function filled(
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

export function trackProblems(page: Page): string[] {
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

export async function openBase(
	page: Page,
	fixture: ChosenFixture,
): Promise<void> {
	// See image-control.spec.ts: a listener must exist before the picker opens.
	page.on('filechooser', () => {});
	await page.goto('/');
	await chooseImages(page, [fixture]);
	await waitForSettleRender(page);
}

export async function addEffect(page: Page, name: string): Promise<void> {
	await page.getByRole('button', {name: 'Add effect'}).click();
	await page
		.getByRole('dialog', {name: 'Add effect'})
		.getByRole('button', {name: new RegExp(`^${name}`)})
		.click();
	await expect(
		page.getByRole('button', {name: `${name} actions`}).last(),
	).toBeVisible();
}

export const panel = (page: Page) =>
	page.locator('[data-slot="parameter-panel"]');
export async function readEditor(page: Page) {
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

export async function addMask(
	page: Page,
	kind: 'Paint' | 'Brightness' | 'Image',
): Promise<void> {
	await panel(page).getByRole('button', {name: 'Add mask'}).click();
	await page.getByRole('menuitem', {name: kind}).click();
	await expect(
		panel(page).getByRole('radio', {name: kind, exact: true}),
	).toBeFocused();
}

export async function setField(
	page: Page,
	name: string,
	value: string,
): Promise<void> {
	const field = panel(page).getByRole('textbox', {name, exact: true});
	await field.fill(value);
	await field.press('Enter');
}

// The pixels of the newest settle frame that has every input.
export async function previewData(page: Page): Promise<number[] | null> {
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

export async function expectPreview(
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

export async function exportPng(page: Page): Promise<number[]> {
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
