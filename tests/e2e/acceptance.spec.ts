import {readFile} from 'node:fs/promises';
import {expect, test, type Download, type Page} from '@playwright/test';
import {decode as decodePng} from 'fast-png';
import {effectRegistry} from '../../src/engine/effects/index.ts';
import {listedEffects} from '../../src/engine/registry.ts';
import {defaultParams} from '../../src/engine/params.ts';
import type {ParamSpec} from '../../src/engine/types.ts';
import {isParamVisible} from '../../src/features/params/visibility.ts';
import type {AppRuntime} from '../../src/state/index.ts';
import {chooseImages, makeImage} from './import.ts';
import {waitForSettleRender} from './settle.ts';
import {DESKTOP_VIEWPORT, PROOF_VIEWPORTS} from './viewports.ts';

type RuntimeGlobal = {
	__psgRuntime?: AppRuntime;
};

function trackErrorsAndNetwork(page: Page): {
	consoleErrors: string[];
	externalRequests: string[];
} {
	const consoleErrors: string[] = [];
	const externalRequests: string[] = [];

	page.on('console', (message) => {
		if (message.type() === 'error') {
			consoleErrors.push(message.text());
		}
	});
	page.on('pageerror', (error) => {
		consoleErrors.push(error.message);
	});
	page.on('request', (request) => {
		const url = request.url();
		if (
			!url.startsWith('http://127.0.0.1:') &&
			!url.startsWith('http://localhost:') &&
			!url.startsWith('data:') &&
			!url.startsWith('blob:')
		) {
			externalRequests.push(url);
		}
	});

	return {consoleErrors, externalRequests};
}

// The open project's size after its geometry transform, and its effect types.
async function readGeometry(page: Page) {
	return page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime!;
		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		const project = booted.bundle.store.getState().activeProject;
		return {
			size: [
				project?.effectiveWidth ?? project?.sourceWidth,
				project?.effectiveHeight ?? project?.sourceHeight,
			],
			effects: project?.stack.instances.map((item) => item.type),
		};
	});
}

async function readDownloadBytes(download: Download): Promise<Uint8Array> {
	const filePath = await download.path();
	if (!filePath) {
		throw new Error('Download path unavailable');
	}

	const buffer = await readFile(filePath);
	return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function pngChunkTypes(bytes: Uint8Array): string[] {
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	for (const [index, byte] of signature.entries()) {
		if (bytes[index] !== byte) {
			throw new Error('Not a valid PNG file');
		}
	}

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const types: string[] = [];
	let offset = 8;
	while (offset + 12 <= bytes.length) {
		const length = view.getUint32(offset, false);
		const type = String.fromCodePoint(
			bytes[offset + 4],
			bytes[offset + 5],
			bytes[offset + 6],
			bytes[offset + 7],
		);
		types.push(type);
		offset += 12 + length;
	}

	return types;
}

test.describe('v0.1.0 E2E acceptance suite (T6.3)', () => {
	test('F1, F2, F3, F9, F15: full session reload, stack persistence, and cross-reload undo', async ({
		page,
	}) => {
		const {consoleErrors, externalRequests} = trackErrorsAndNetwork(page);
		await page.setViewportSize(DESKTOP_VIEWPORT);
		await page.goto('/');

		const fixture = await makeImage(page, {
			name: 'acceptance-photo.png',
			width: 240,
			height: 180,
		});
		await chooseImages(page, [fixture]);

		await expect(
			page.getByRole('button', {name: 'Back to library'}),
		).toBeVisible();
		await waitForSettleRender(page);

		// Add pixelSort via UI
		await page.getByRole('button', {name: 'Add effect'}).click();
		await page.getByRole('button', {name: /^Pixel sort/}).click();

		const angleInput = page.getByRole('textbox', {name: 'Angle'});
		await angleInput.fill('90');
		await angleInput.press('Enter');

		// Add channelShift via UI
		await page.getByRole('button', {name: 'Add effect'}).click();
		await page.getByRole('button', {name: /^Channel shift/}).click();

		const redXInput = page.getByRole('textbox', {name: 'Red X'});
		await redXInput.fill('16');
		await redXInput.press('Enter');
		await expect(
			page.getByRole('button', {name: 'Undo Red X 16 px'}),
		).toBeEnabled();

		await waitForSettleRender(page);

		const beforeReload = await page.evaluate(async () => {
			const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime!;
			const booted = await runtime.ready;
			if (booted.status !== 'ready') {
				throw new Error('Not ready');
			}

			const {activeProject, history} = booted.bundle.store.getState();
			if (!activeProject) {
				throw new Error('No active project');
			}

			return {
				projectId: activeProject.id,
				name: activeProject.name,
				types: activeProject.stack.instances.map((i) => i.type),
				angle: activeProject.stack.instances[0]?.params.angle,
				redX: activeProject.stack.instances[1]?.params.redX,
				historyHeadSeq: activeProject.historyHeadSeq,
				historyLength: history.length,
			};
		});

		expect(beforeReload.name).toBe('acceptance-photo');
		expect(beforeReload.types).toEqual(['pixelSort', 'channelShift']);
		expect(beforeReload.angle).toBe(90);
		expect(beforeReload.redX).toBe(16);
		expect(beforeReload.historyHeadSeq).toBe(4);
		expect(beforeReload.historyLength).toBe(5);

		// Reload and verify full restoration
		await page.reload();
		await expect(
			page.getByRole('button', {name: 'Back to library'}),
		).toBeVisible();
		await waitForSettleRender(page);

		const afterReload = await page.evaluate(async () => {
			const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime!;
			const booted = await runtime.ready;
			if (booted.status !== 'ready') {
				throw new Error('Not ready');
			}

			await booted.hydrationPromise;
			const {activeProject, history} = booted.bundle.store.getState();
			if (!activeProject) {
				throw new Error('No active project after reload');
			}

			return {
				hash: globalThis.location.hash,
				projectId: activeProject.id,
				name: activeProject.name,
				types: activeProject.stack.instances.map((i) => i.type),
				angle: activeProject.stack.instances[0]?.params.angle,
				redX: activeProject.stack.instances[1]?.params.redX,
				historyHeadSeq: activeProject.historyHeadSeq,
				historyLength: history.length,
			};
		});

		expect(afterReload.hash).toBe(`#/p/${beforeReload.projectId}`);
		expect(afterReload.projectId).toBe(beforeReload.projectId);
		expect(afterReload.types).toEqual(['pixelSort', 'channelShift']);
		expect(afterReload.angle).toBe(90);
		expect(afterReload.redX).toBe(16);
		expect(afterReload.historyHeadSeq).toBe(4);
		expect(afterReload.historyLength).toBe(5);

		// Undo works across reload
		const undoButton = page.getByRole('button', {name: /^Undo/});
		await expect(undoButton).toBeEnabled();
		await undoButton.click();

		await expect
			.poll(() =>
				page.evaluate(async () => {
					const runtime = (globalThis as unknown as RuntimeGlobal)
						.__psgRuntime!;
					const booted = await runtime.ready;
					if (booted.status !== 'ready') {
						return null;
					}

					const project = booted.bundle.store.getState().activeProject;
					return {
						redX: project?.stack.instances[1]?.params.redX ?? null,
						headSeq: project?.historyHeadSeq ?? null,
					};
				}),
			)
			.toEqual({redX: 6, headSeq: 3});

		// Navigate back to library and verify project card exists
		await page.getByRole('button', {name: 'Back to library'}).click();
		await expect(page.getByText('acceptance-photo')).toBeVisible();

		expect(consoleErrors).toEqual([]);
		expect(externalRequests).toEqual([]);
	});

	test('F6, F12, F15: deterministic double-export PNG pixel equality and EXIF-free output', async ({
		page,
	}) => {
		const {consoleErrors, externalRequests} = trackErrorsAndNetwork(page);
		await page.setViewportSize(DESKTOP_VIEWPORT);
		await page.goto('/');

		const width = 200;
		const height = 150;
		const fixture = await makeImage(page, {
			name: 'determinism.png',
			width,
			height,
		});
		await chooseImages(page, [fixture]);
		await expect(
			page.getByRole('button', {name: 'Back to library'}),
		).toBeVisible();
		await waitForSettleRender(page);

		// Add pixelSort + channelShift with deterministic parameters
		await page.evaluate(async () => {
			const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime!;
			const booted = await runtime.ready;
			if (booted.status !== 'ready') {
				throw new Error('Not ready');
			}

			const {store} = booted.bundle;
			const ps = await store.getState().addEffect('pixelSort');
			await store.getState().commitParam(ps.id, 'angle', 45);
			const cs = await store.getState().addEffect('channelShift');
			await store.getState().commitParam(cs.id, 'redX', 10);
			await store.getState().commitParam(cs.id, 'blueX', -8);
		});
		await waitForSettleRender(page);

		const exportOnce = async (): Promise<Uint8Array> => {
			await page.getByRole('button', {name: 'Export'}).click();
			const dialog = page.getByRole('dialog', {name: 'Export'});
			await expect(dialog).toBeVisible();

			const downloadPromise = page.waitForEvent('download');
			await dialog.getByRole('button', {name: 'Download'}).click();
			const download = await downloadPromise;
			const bytes = await readDownloadBytes(download);
			await page.keyboard.press('Escape');
			await expect(dialog).toBeHidden();
			return bytes;
		};

		const firstBytes = await exportOnce();
		const secondBytes = await exportOnce();

		// Verify EXIF-free PNG chunks
		for (const bytes of [firstBytes, secondBytes]) {
			const chunks = pngChunkTypes(bytes);
			expect(chunks).not.toContain('eXIf');
			expect(chunks).not.toContain('iCCP');
			expect(chunks).not.toContain('tEXt');
			expect(chunks).not.toContain('iTXt');
		}

		const firstDecoded = decodePng(firstBytes);
		const secondDecoded = decodePng(secondBytes);

		expect(firstDecoded.width).toBe(width);
		expect(firstDecoded.height).toBe(height);
		expect(secondDecoded.width).toBe(width);
		expect(secondDecoded.height).toBe(height);
		expect(firstDecoded.data).toEqual(secondDecoded.data);

		expect(consoleErrors).toEqual([]);
		expect(externalRequests).toEqual([]);
	});

	test('F10, F11, F13, F15: presets, compare/split, and zoom/pan round-trip across reload', async ({
		page,
	}) => {
		const {consoleErrors, externalRequests} = trackErrorsAndNetwork(page);
		await page.setViewportSize(DESKTOP_VIEWPORT);
		await page.goto('/');

		const fixture = await makeImage(page, {
			name: 'preset-compare.png',
			width: 320,
			height: 240,
		});
		await chooseImages(page, [fixture]);
		await expect(
			page.getByRole('button', {name: 'Back to library'}),
		).toBeVisible();
		await waitForSettleRender(page);

		// Apply built-in "ASDF classic" preset
		await page.getByRole('button', {name: 'Presets'}).click();
		await expect(
			page.getByRole('list', {name: 'Built-in presets'}),
		).toBeVisible();
		await page.getByRole('button', {name: /^ASDF classic/}).click();
		await expect(
			page.getByRole('button', {name: 'Undo Apply preset ASDF classic'}),
		).toBeEnabled();
		await waitForSettleRender(page);

		// Verify ASDF classic produced 2 pixelSort instances (angle 270, then 0)
		const presetAngles = await page.evaluate(async () => {
			const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime!;
			const booted = await runtime.ready;
			if (booted.status !== 'ready') {
				throw new Error('Not ready');
			}

			return (
				booted.bundle.store
					.getState()
					.activeProject?.stack.instances.map((i) => ({
						type: i.type,
						angle: i.params.angle,
					})) ?? []
			);
		});
		expect(presetAngles).toEqual([
			{type: 'pixelSort', angle: 270},
			{type: 'pixelSort', angle: 0},
		]);

		// Save as custom preset
		await page.getByRole('button', {name: 'Presets'}).click();
		await page.getByRole('button', {name: 'Save as preset'}).click();
		const presetNameInput = page.getByRole('textbox', {name: 'Preset name'});
		await presetNameInput.fill('Acceptance custom');
		await page.getByRole('button', {name: 'Save preset'}).click();
		await expect(presetNameInput).toBeHidden();

		// Close presets popover/tab by focusing canvas
		const canvas = page.getByLabel('Image canvas');
		await canvas.click();

		// Toggle Compare with backslash (\)
		await page.keyboard.press('\\');
		await expect(page.getByText('Original', {exact: true})).toBeVisible();
		await page.keyboard.press('\\');
		await expect(page.getByText('Original', {exact: true})).toBeHidden();

		// Toggle Split with S and move divider with Shift+ArrowRight
		await page.keyboard.press('s');
		const divider = page.getByRole('separator', {
			name: 'Compare split position',
		});
		await expect(divider).toBeVisible();
		await divider.focus();
		await page.keyboard.press('Shift+ArrowRight');

		// Zoom to 200% via zoom dropdown and pan with ArrowRight
		await page.getByRole('button', {name: /^Zoom /}).click();
		await page.getByRole('menuitem', {name: '200%', exact: true}).click();
		const centerXBeforePan = await page.evaluate(async () => {
			const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime!;
			const booted = await runtime.ready;
			if (booted.status !== 'ready') {
				throw new Error('Not ready');
			}

			return booted.bundle.store.getState().activeProject?.viewState.centerX;
		});
		expect(typeof centerXBeforePan).toBe('number');
		await canvas.focus();
		await page.keyboard.press('ArrowRight');

		// Flush debounced view state before reload
		const beforeReload = await page.evaluate(async () => {
			const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime!;
			const booted = await runtime.ready;
			if (booted.status !== 'ready') {
				throw new Error('Not ready');
			}

			await booted.bundle.store.getState().flushViewState();
			const state = booted.bundle.store.getState();
			return {
				viewState: state.activeProject?.viewState,
				presets: state.presets.map((p) => p.name),
			};
		});

		expect(beforeReload.viewState?.zoom).toBeCloseTo(2, 2);
		expect(beforeReload.viewState?.splitPosition).toBeCloseTo(0.6, 2);
		expect(typeof beforeReload.viewState?.centerX).toBe('number');
		expect(beforeReload.viewState?.centerX).not.toBe(centerXBeforePan);
		expect(beforeReload.presets).toContain('Acceptance custom');

		// Reload and verify state restoration
		await page.reload();
		await expect(
			page.getByRole('button', {name: 'Back to library'}),
		).toBeVisible();
		await waitForSettleRender(page);

		const afterReload = await page.evaluate(async () => {
			const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime!;
			const booted = await runtime.ready;
			if (booted.status !== 'ready') {
				throw new Error('Not ready');
			}

			await booted.hydrationPromise;
			const state = booted.bundle.store.getState();
			return {
				viewState: state.activeProject?.viewState,
				presets: state.presets.map((p) => p.name),
				instanceCount: state.activeProject?.stack.instances.length ?? 0,
			};
		});

		expect(afterReload.instanceCount).toBe(2);
		expect(afterReload.presets).toContain('Acceptance custom');
		expect(afterReload.viewState?.zoom).toBeCloseTo(2, 2);
		expect(afterReload.viewState?.splitPosition).toBeCloseTo(0.6, 2);
		expect(typeof afterReload.viewState?.centerX).toBe('number');
		expect(
			Math.abs(
				afterReload.viewState!.centerX - beforeReload.viewState!.centerX,
			),
		).toBeLessThanOrEqual(1);

		expect(consoleErrors).toEqual([]);
		expect(externalRequests).toEqual([]);
	});

	test('F14, F16, F18, F15: theme persistence, storage status, and responsive zero-overflow smoke', async ({
		page,
	}) => {
		const {consoleErrors, externalRequests} = trackErrorsAndNetwork(page);
		await page.emulateMedia({colorScheme: 'dark'});
		await page.setViewportSize(DESKTOP_VIEWPORT);
		await page.goto('/');

		// Open Settings, verify storage status, switch to Light theme
		await page.getByRole('button', {name: 'Settings'}).click();
		const dialog = page.getByRole('dialog', {name: 'Settings'});
		await expect(dialog).toBeVisible();

		await expect(
			dialog.locator('p').filter({
				hasText:
					/^(Using \d+(?:\.\d)? (?:MB|GB) of \d+(?:\.\d)? (?:MB|GB)|Storage usage unavailable)$/,
			}),
		).toBeVisible();
		await expect(
			dialog.getByText(
				/Storage protection: (Persistent|Best-effort \(browser may clear data when space is low\))/,
			),
		).toBeVisible();

		await dialog.getByRole('radio', {name: 'Light'}).click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
		await page.keyboard.press('Escape');

		// Reload on dark OS and verify Light theme persisted across reload
		// (zero-FOUC pre-paint check is covered in tests/e2e/theme.spec.ts)
		await page.reload();
		const lightMetrics = await page.evaluate(() => ({
			theme: globalThis.document.documentElement.dataset.theme,
			bg: globalThis.getComputedStyle(globalThis.document.documentElement)
				.backgroundColor,
		}));
		expect(lightMetrics).toEqual({
			theme: 'light',
			bg: 'rgb(250, 250, 250)',
		});

		// Import a photo and verify zero horizontal scroll across all 3 proof viewports
		const fixture = await makeImage(page, {
			name: 'responsive-smoke.png',
			width: 200,
			height: 150,
		});
		await chooseImages(page, [fixture]);
		await expect(
			page.getByRole('button', {name: 'Back to library'}),
		).toBeVisible();
		await waitForSettleRender(page);

		for (const viewport of PROOF_VIEWPORTS) {
			await page.setViewportSize({
				width: viewport.width,
				height: viewport.height,
			});
			const overflow = await page.evaluate(() => ({
				scrollWidth: globalThis.document.documentElement.scrollWidth,
				innerWidth: globalThis.innerWidth,
			}));
			expect(
				overflow.scrollWidth,
				`Horizontal overflow at ${viewport.name} (${viewport.width}x${viewport.height})`,
			).toBeLessThanOrEqual(overflow.innerWidth);
		}

		expect(consoleErrors).toEqual([]);
		expect(externalRequests).toEqual([]);
	});
});

test.describe('v0.2.0 E2E acceptance suite (T7.17)', () => {
	test('AC-F22.1: Add effect offers every registered effect and builds its controls from the schema', async ({
		page,
	}) => {
		const {consoleErrors, externalRequests} = trackErrorsAndNetwork(page);
		await page.setViewportSize(DESKTOP_VIEWPORT);
		await page.goto('/');
		await chooseImages(page, [
			await makeImage(page, {name: 'effects.png', width: 160, height: 120}),
		]);
		await waitForSettleRender(page);

		const panel = page.locator('[data-slot="parameter-panel"]');
		const chooser = page.getByRole('dialog', {name: 'Add effect'});
		for (const definition of listedEffects(effectRegistry)) {
			await page.getByRole('button', {name: 'Add effect'}).click();
			const option = chooser.getByRole('button', {
				name: `${definition.label} ${definition.description}`,
			});
			await expect(option).toBeVisible();
			await option.click();

			await expect(
				panel.getByRole('heading', {level: 2, name: definition.label}),
			).toBeVisible();
			const defaults = defaultParams(definition.params);
			// The panel lists groups in order of first appearance, then each
			// group's params in declaration order (params-panel.tsx groupSpecs).
			const visible = Object.values<ParamSpec>(definition.params).filter(
				(spec) => isParamVisible(spec, defaults),
			);
			const groupOrder = [...new Set(visible.map((spec) => spec.group))];
			const labels = groupOrder.flatMap((group) =>
				visible
					.filter((spec) => spec.group === group)
					.map((spec) => spec.label),
			);
			// Only each row's own label, then Mix and Blend, which every instance has.
			await expect(
				panel.locator(
					'[data-param-row] > label:first-child, [data-param-row] > div:first-child > label',
				),
			).toHaveText([...labels, 'Mix', 'Blend']);
		}

		// Unlisted effects are registered but not offered.
		await page.getByRole('button', {name: 'Add effect'}).click();
		await expect(chooser.getByRole('button')).not.toHaveCount(0);
		for (const definition of effectRegistry.list()) {
			if (definition.unlisted) {
				await expect(
					chooser.getByRole('button', {name: definition.label}),
				).toHaveCount(0);
			}
		}

		await page.keyboard.press('Escape');

		await waitForSettleRender(page);
		expect(consoleErrors).toEqual([]);
		expect(externalRequests).toEqual([]);
	});

	test('F20, F22, F23: a history jump restores geometry and effects, and survives reload and export', async ({
		page,
	}) => {
		const {consoleErrors, externalRequests} = trackErrorsAndNetwork(page);
		await page.setViewportSize(DESKTOP_VIEWPORT);
		await page.goto('/');
		await chooseImages(page, [
			await makeImage(page, {name: 'journey.png', width: 240, height: 180}),
		]);
		await waitForSettleRender(page);

		await page.getByRole('button', {name: 'Add effect'}).click();
		await page.getByRole('button', {name: /^Slice shift/}).click();
		await page.getByRole('button', {name: 'Transform', exact: true}).click();
		await page
			.getByRole('button', {name: 'Rotate 90° clockwise', exact: true})
			.click();
		await expect
			.poll(async () => readGeometry(page))
			.toEqual({size: [180, 240], effects: ['sliceShift']});
		await page
			.getByRole('button', {name: 'Close transform panel', exact: true})
			.click();

		await page.getByRole('tab', {name: 'History'}).click();
		const history = page.getByRole('list', {name: 'Project history'});
		const jumpTo = async (label: string) => {
			await history
				.getByRole('button')
				.filter({has: page.getByTitle(label, {exact: true})})
				.click();
		};

		await jumpTo('Initial');
		await expect
			.poll(async () => readGeometry(page))
			.toEqual({size: [240, 180], effects: []});
		await jumpTo('Rotate 90° CW');
		await expect
			.poll(async () => readGeometry(page))
			.toEqual({size: [180, 240], effects: ['sliceShift']});

		await page.reload();
		await expect
			.poll(async () => readGeometry(page))
			.toEqual({size: [180, 240], effects: ['sliceShift']});
		await waitForSettleRender(page);
		await page.getByRole('button', {name: 'Export'}).click();
		const dialog = page.getByRole('dialog', {name: 'Export'});
		await dialog.getByRole('radio', {name: 'PNG', exact: true}).click();
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			dialog.getByRole('button', {name: 'Download'}).click(),
		]);
		const png = decodePng(await readDownloadBytes(download));
		expect([png.width, png.height]).toEqual([180, 240]);

		expect(consoleErrors).toEqual([]);
		expect(externalRequests).toEqual([]);
	});
});
