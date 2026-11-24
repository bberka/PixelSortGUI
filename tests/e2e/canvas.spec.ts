import {expect, test, type Page} from '@playwright/test';
import type {AppRuntime} from '../../src/state/index.ts';
import {assertNoA11yViolations} from './axe.ts';
import {PROOF_VIEWPORTS, type ProofViewport} from './viewports.ts';

/**
 The canvas stage against the production build: zoom presets, pointer, wheel,
 touch and keyboard navigation, the pan clamp and the render overlays. Every
 image is generated in code; no photo file is committed.
 */

type RuntimeGlobal = {
	__psgRuntime?: AppRuntime;
	__canvasCounters?: {draws: number; renderRequests: number};
};

type ProjectOptions = {
	name?: string;
	width?: number;
	height?: number;
	pattern?: 'gradient' | 'blocks' | 'checker';
};

const BLOCK_COLOURS = [
	'#ff0000',
	'#00ff00',
	'#0000ff',
	'#ffffff',
	'#000000',
	'#ffff00',
] as const;

const BLOCK_COLOUR_RGB = new Set([
	'255,0,0',
	'0,255,0',
	'0,0,255',
	'255,255,255',
	'0,0,0',
	'255,255,0',
]);

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
 Stores one generated image through the real app store, which opens it and
 moves the hash to `#/p/<id>`.
 */
async function importProject(
	page: Page,
	options: ProjectOptions = {},
): Promise<string> {
	const {
		name = 'Canvas image',
		width = 320,
		height = 240,
		pattern = 'gradient',
	} = options;

	return page.evaluate(
		async ({projectName, imageWidth, imageHeight, imagePattern, colours}) => {
			const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
			if (!runtime) {
				throw new Error('App runtime not attached');
			}

			const booted = await runtime.ready;
			if (booted.status !== 'ready') {
				throw new Error(`Expected ready boot, got ${booted.status}`);
			}

			const canvas = globalThis.document.createElement('canvas');
			canvas.width = imageWidth;
			canvas.height = imageHeight;
			const context = canvas.getContext('2d');
			if (!context) {
				throw new Error('2D context unavailable');
			}

			if (imagePattern === 'checker') {
				// One-pixel checkerboard: a downscaled proxy averages it to grey,
				// so pure black or white on screen can only come from full
				// resolution tiles.
				const tile = globalThis.document.createElement('canvas');
				tile.width = 2;
				tile.height = 2;
				const tileContext = tile.getContext('2d');
				if (!tileContext) {
					throw new Error('2D context unavailable for the checker tile');
				}

				tileContext.fillStyle = '#000000';
				tileContext.fillRect(0, 0, 2, 2);
				tileContext.fillStyle = '#ffffff';
				tileContext.fillRect(0, 0, 1, 1);
				tileContext.fillRect(1, 1, 1, 1);
				const checker = context.createPattern(tile, 'repeat');
				if (!checker) {
					throw new Error('Checker pattern unavailable');
				}

				context.fillStyle = checker;
				context.fillRect(0, 0, imageWidth, imageHeight);
			} else if (imagePattern === 'blocks') {
				const size = 8;
				for (let y = 0; y < imageHeight; y += size) {
					for (let x = 0; x < imageWidth; x += size) {
						const index = (x / size + y / size) % colours.length;
						context.fillStyle = colours[index] ?? '#ffffff';
						context.fillRect(x, y, size, size);
					}
				}
			} else {
				const gradient = context.createLinearGradient(
					0,
					0,
					imageWidth,
					imageHeight,
				);
				gradient.addColorStop(0, '#0b1f3a');
				gradient.addColorStop(0.45, '#d08040');
				gradient.addColorStop(1, '#f4f4f5');
				context.fillStyle = gradient;
				context.fillRect(0, 0, imageWidth, imageHeight);
			}

			const blob = await new Promise<Blob>((resolve, reject) => {
				canvas.toBlob((result) => {
					if (result) {
						resolve(result);
					} else {
						reject(new Error('Failed to encode the generated image'));
					}
				}, 'image/png');
			});

			const created = await booted.bundle.store.getState().importImage({
				name: projectName,
				blob,
				width: imageWidth,
				height: imageHeight,
			});

			return created.project.id;
		},
		{
			projectName: name,
			imageWidth: width,
			imageHeight: height,
			imagePattern: pattern,
			colours: [...BLOCK_COLOURS],
		},
	);
}

type ViewSnapshot = {
	fitMode: 'fit' | 'custom';
	zoom: number;
	centerX: number;
	centerY: number;
	sourceWidth: number;
	sourceHeight: number;
};

async function readView(page: Page): Promise<ViewSnapshot> {
	return page.evaluate(() => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const result = runtime?.result;
		if (!runtime || !result || result.status !== 'ready') {
			throw new Error('App is not ready');
		}

		const project = result.bundle.store.getState().activeProject;
		if (!project) {
			throw new Error('No active project');
		}

		return {
			fitMode: project.viewState.fitMode,
			zoom: project.viewState.zoom,
			centerX: project.viewState.centerX,
			centerY: project.viewState.centerY,
			sourceWidth: project.sourceWidth,
			sourceHeight: project.sourceHeight,
		};
	});
}

type RenderSnapshot = {
	hasFrame: boolean;
	fullGeneration: number | null;
	fullWidth: number | null;
	tileCount: number;
	busy: {drag: boolean; settle: boolean; full: boolean};
	failed: boolean;
};

async function readRender(page: Page): Promise<RenderSnapshot> {
	return page.evaluate(() => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const result = runtime?.result;
		if (!runtime || !result || result.status !== 'ready') {
			throw new Error('App is not ready');
		}

		const {render} = result.bundle.store.getState();
		return {
			hasFrame: render.frame !== undefined,
			fullGeneration: render.full?.generation ?? null,
			fullWidth: render.full?.width ?? null,
			tileCount: render.full?.tiles.length ?? 0,
			busy: {...render.busy},
			failed: render.failed,
		};
	});
}

/**
Writes the pending view-state save to storage, as closing the tab would.
*/
async function flushView(page: Page): Promise<void> {
	await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const result = runtime?.result;
		if (!runtime || !result || result.status !== 'ready') {
			throw new Error('App is not ready');
		}

		await result.bundle.store.getState().flushViewState();
	});
}

async function waitForSettledFrame(page: Page): Promise<void> {
	await expect
		.poll(async () => {
			const render = await readRender(page);
			return render.hasFrame && !render.busy.settle;
		})
		.toBe(true);
}

async function canvasBox(page: Page) {
	const box = await page.locator('canvas').boundingBox();
	if (!box) {
		throw new Error('The canvas has no layout box');
	}

	return box;
}

/**
 The stage measures itself with `clientWidth`/`clientHeight`; the bounding box
 can be a fraction wider, so the view math uses these integers.
 */
async function canvasViewport(
	page: Page,
): Promise<{width: number; height: number}> {
	return page.evaluate(() => {
		const stage = globalThis.document.querySelector('canvas')?.parentElement;
		if (!stage) {
			throw new Error('No canvas stage');
		}

		return {width: stage.clientWidth, height: stage.clientHeight};
	});
}

async function chooseZoom(page: Page, label: string): Promise<void> {
	await page.getByRole('button', {name: /^Zoom /}).click();
	await page.getByRole('menuitem', {name: label, exact: true}).click();
}

/**
Drags from `from` by `dx` CSS px in steps, releasing at the end.
*/
async function dragBy(
	page: Page,
	from: {x: number; y: number},
	dx: number,
): Promise<void> {
	const steps = 10;
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	for (let step = 1; step <= steps; step++) {
		await page.mouse.move(from.x + (dx * step) / steps, from.y);
	}

	await page.mouse.up();
}

test('the zoom menu offers Fit, 50%, 100%, 200% and 400% (AC-F13.2)', async ({
	page,
}) => {
	await page.goto('/');
	await importProject(page);
	await expect(page.locator('canvas')).toBeVisible();

	const trigger = page.getByRole('button', {name: /^Zoom /});
	await trigger.click();
	for (const label of ['Fit', '50%', '100%', '200%', '400%']) {
		await expect(
			page.getByRole('menuitem', {name: label, exact: true}),
		).toBeVisible();
	}

	await page.getByRole('menuitem', {name: '200%', exact: true}).click();
	await expect(trigger).toHaveText(/200%/);
	expect(await readView(page)).toMatchObject({fitMode: 'custom', zoom: 2});

	await chooseZoom(page, '50%');
	await expect(trigger).toHaveText(/50%/);
	expect((await readView(page)).zoom).toBe(0.5);

	await chooseZoom(page, 'Fit');
	expect((await readView(page)).fitMode).toBe('fit');
	// 320x240 in a wider stage fits at 100%: fit never upscales.
	await expect(trigger).toHaveText(/100%/);
});

test('zooming and panning redraw at frame rate without writing the store or asking for a render (AC-F13.1)', async ({
	page,
}) => {
	await page.addInitScript(() => {
		const counters = {draws: 0, renderRequests: 0};
		Object.defineProperty(globalThis, '__canvasCounters', {
			value: counters,
			writable: true,
			configurable: true,
		});

		const drawing = CanvasRenderingContext2D.prototype as unknown as {
			drawImage: (...args: unknown[]) => unknown;
		};
		const {drawImage} = drawing;
		drawing.drawImage = function (
			this: CanvasRenderingContext2D,
			...args: unknown[]
		) {
			counters.draws++;
			return drawImage.apply(this, args);
		};

		const posting = Worker.prototype as unknown as {
			postMessage: (message: unknown, ...rest: unknown[]) => void;
		};
		const {postMessage} = posting;
		posting.postMessage = function (
			this: Worker,
			message: unknown,
			...rest: unknown[]
		) {
			if (
				typeof message === 'object' &&
				message !== null &&
				'type' in message &&
				(message as {type?: unknown}).type === 'render'
			) {
				counters.renderRequests++;
			}

			Reflect.apply(postMessage, this, [message, ...rest]);
		};
	});

	await page.goto('/');
	await importProject(page, {width: 2000, height: 1500});
	await waitForSettledFrame(page);
	await chooseZoom(page, '100%');

	const measured = await page.evaluate(async () => {
		const canvas = globalThis.document.querySelector('canvas');
		const counters = (globalThis as unknown as RuntimeGlobal).__canvasCounters;
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const result = runtime?.result;
		if (
			!canvas ||
			!counters ||
			!runtime ||
			!result ||
			result.status !== 'ready'
		) {
			throw new Error('Measurement harness missing');
		}

		const {store} = result.bundle;
		const box = canvas.getBoundingClientRect();
		const x = box.left + box.width / 2;
		const y = box.top + box.height / 2;
		const before = store.getState().activeProject?.viewState.zoom ?? 0;
		const start = performance.now();
		counters.draws = 0;
		counters.renderRequests = 0;
		while (performance.now() - start < 1000) {
			canvas.dispatchEvent(
				new globalThis.WheelEvent('wheel', {
					deltaY: -4,
					ctrlKey: true,
					clientX: x,
					clientY: y,
					bubbles: true,
					cancelable: true,
				}),
			);

			await new Promise((resolve) => {
				globalThis.requestAnimationFrame(() => {
					resolve(null);
				});
			});
		}

		return {
			draws: counters.draws,
			renderRequests: counters.renderRequests,
			elapsedMs: performance.now() - start,
			before,
			duringGesture: store.getState().activeProject?.viewState.zoom ?? 0,
		};
	});

	const framesPerSecond = (measured.draws / measured.elapsedMs) * 1000;
	expect(
		framesPerSecond,
		`redraws per second while zooming: ${framesPerSecond.toFixed(1)}`,
	).toBeGreaterThanOrEqual(30);
	expect(
		measured.renderRequests,
		'a zoom must not request an engine render',
	).toBe(0);
	expect(
		measured.duringGesture,
		'the view state must not reach the store during the gesture',
	).toBe(measured.before);
	await expect
		.poll(async () => (await readView(page)).zoom, {timeout: 3000})
		.toBeGreaterThan(measured.before);
});

test('ctrl+wheel zooms around the pointer, plain wheel pans', async ({
	page,
}) => {
	await page.goto('/');
	await importProject(page);
	await expect(page.locator('canvas')).toBeVisible();
	await chooseZoom(page, '100%');

	const measured = await page.evaluate(async () => {
		const canvas = globalThis.document.querySelector('canvas');
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const result = runtime?.result;
		const stage = canvas?.parentElement;
		if (!canvas || !stage || !runtime || !result || result.status !== 'ready') {
			throw new Error('Canvas or runtime missing');
		}

		const {store} = result.bundle;
		const viewOf = () => {
			const project = store.getState().activeProject;
			if (!project) {
				throw new Error('No active project');
			}

			return {...project.viewState};
		};

		const nextFrame = async () => {
			await new Promise((resolve) => {
				globalThis.requestAnimationFrame(() => {
					resolve(null);
				});
			});
		};

		// A wheel gesture commits after a pause, so wait for the store to move.
		const waitForCommit = async (previous: {
			zoom: number;
			centerX: number;
			centerY: number;
		}) => {
			const started = performance.now();
			while (performance.now() - started < 4000) {
				const current = viewOf();
				if (
					current.zoom !== previous.zoom ||
					current.centerX !== previous.centerX ||
					current.centerY !== previous.centerY
				) {
					return current;
				}

				await nextFrame();
			}

			throw new Error('The wheel gesture never reached the store');
		};

		const rect = canvas.getBoundingClientRect();
		const viewport = {width: stage.clientWidth, height: stage.clientHeight};
		// WheelEvent coordinates are integers, so pin them and derive the anchor
		// from the rounded values the handler will actually see.
		const clientX = Math.round(rect.left + viewport.width * 0.75);
		const clientY = Math.round(rect.top + viewport.height * 0.4);
		const anchor = {x: clientX - rect.left, y: clientY - rect.top};
		const before = viewOf();
		const anchorSource = {
			x: before.centerX + (anchor.x - viewport.width / 2) / before.zoom,
			y: before.centerY + (anchor.y - viewport.height / 2) / before.zoom,
		};

		const send = (init: {
			deltaY: number;
			deltaX?: number;
			ctrlKey?: boolean;
		}) => {
			canvas.dispatchEvent(
				new globalThis.WheelEvent('wheel', {
					deltaY: init.deltaY,
					deltaX: init.deltaX ?? 0,
					ctrlKey: init.ctrlKey ?? false,
					clientX,
					clientY,
					bubbles: true,
					cancelable: true,
				}),
			);
		};

		send({deltaY: -100, ctrlKey: true});
		const zoomed = await waitForCommit(before);

		send({deltaY: 120});
		const panned = await waitForCommit(zoomed);

		send({deltaY: 120, deltaX: 90});
		const pannedBoth = await waitForCommit(panned);

		return {anchor, viewport, before, anchorSource, zoomed, panned, pannedBoth};
	});

	expect(measured.zoomed.zoom).toBeGreaterThan(measured.before.zoom);
	expect(measured.zoomed.centerX).toBeCloseTo(
		measured.anchorSource.x -
			(measured.anchor.x - measured.viewport.width / 2) / measured.zoomed.zoom,
		1,
	);
	expect(measured.zoomed.centerY).toBeCloseTo(
		measured.anchorSource.y -
			(measured.anchor.y - measured.viewport.height / 2) / measured.zoomed.zoom,
		1,
	);

	expect(measured.panned.zoom).toBeCloseTo(measured.zoomed.zoom, 6);
	expect(measured.panned.centerY).toBeCloseTo(
		measured.zoomed.centerY + 120 / measured.zoomed.zoom,
		1,
	);
	expect(measured.panned.centerX).toBeCloseTo(measured.zoomed.centerX, 1);

	expect(measured.pannedBoth.centerX).toBeCloseTo(
		measured.panned.centerX + 90 / measured.zoomed.zoom,
		1,
	);
});

test('double-click and the keyboard zoom and fit (DESIGN.md section 8.1)', async ({
	page,
}) => {
	await page.goto('/');
	await importProject(page);
	await expect(page.locator('canvas')).toBeVisible();

	const box = await canvasBox(page);
	const centre = {x: box.x + box.width / 2, y: box.y + box.height / 2};

	await page.mouse.dblclick(centre.x, centre.y);
	expect(await readView(page)).toMatchObject({fitMode: 'custom', zoom: 1});

	await page.mouse.dblclick(centre.x, centre.y);
	expect((await readView(page)).fitMode).toBe('fit');

	await page.keyboard.press('1');
	expect((await readView(page)).zoom).toBe(1);
	await page.keyboard.press('+');
	expect((await readView(page)).zoom).toBe(2);
	await page.keyboard.press('-');
	expect((await readView(page)).zoom).toBe(1);
	await page.keyboard.press('0');
	expect((await readView(page)).fitMode).toBe('fit');
});

test('arrow keys pan by 10% of the viewport when the canvas has focus', async ({
	page,
}) => {
	await page.goto('/');
	await importProject(page);
	await expect(page.locator('canvas')).toBeVisible();
	await chooseZoom(page, '100%');

	const viewport = await canvasViewport(page);
	const before = await readView(page);
	await page.locator('canvas').focus();
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowDown');

	const after = await readView(page);
	expect(after.centerX - before.centerX).toBeCloseTo(
		(0.1 * viewport.width) / before.zoom,
		1,
	);
	expect(after.centerY - before.centerY).toBeCloseTo(
		(0.1 * viewport.height) / before.zoom,
		1,
	);
});

test('a drag leaves at least 64 CSS px of the image on screen (AC-F13.3)', async ({
	page,
}) => {
	await page.goto('/');
	await importProject(page);
	await expect(page.locator('canvas')).toBeVisible();
	await chooseZoom(page, '400%');

	const box = await canvasBox(page);
	const viewport = await canvasViewport(page);
	// Every drag starts and ends inside the stage: a pointer released outside
	// the window leaves Firefox with a button it thinks is still down.
	const row = box.y + box.height / 2;
	const fromLeft = {x: box.x + box.width * 0.25, y: row};
	const fromRight = {x: box.x + box.width * 0.75, y: row};

	// Pulling to the right leaves the left edge of the image at the right margin.
	for (let pull = 0; pull < 8; pull++) {
		await dragBy(page, fromLeft, 500);
	}

	const pulled = await readView(page);
	const imageLeft = viewport.width / 2 - pulled.centerX * pulled.zoom;
	expect(imageLeft).toBeCloseTo(viewport.width - 64, 0);

	const rightPixels = await page.evaluate(
		({left}) => {
			const canvas = globalThis.document.querySelector('canvas');
			if (!canvas) {
				throw new Error('No canvas');
			}

			const context = canvas.getContext('2d');
			if (!context) {
				throw new Error('No 2D context');
			}

			const dpr = canvas.width / canvas.getBoundingClientRect().width;
			const y = Math.floor(canvas.height / 2);
			const read = (x: number) =>
				context.getImageData(Math.floor(x * dpr), y, 1, 1).data[3] ?? 0;
			return {inside: read(left + 10), outside: read(left - 30)};
		},
		{left: viewport.width - 64},
	);
	expect(rightPixels.inside, 'the remaining sliver is drawn').toBeGreaterThan(
		0,
	);
	expect(rightPixels.outside, 'the rest of the stage stays empty').toBe(0);

	// Pulling to the left leaves the right edge of the image at the left margin.
	for (let pull = 0; pull < 8; pull++) {
		await dragBy(page, fromRight, -500);
	}

	const pulledBack = await readView(page);
	const pulledLeft = viewport.width / 2 - pulledBack.centerX * pulledBack.zoom;
	expect(pulledLeft + pulledBack.sourceWidth * pulledBack.zoom).toBeCloseTo(
		64,
		0,
	);

	const leftPixels = await page.evaluate(() => {
		const canvas = globalThis.document.querySelector('canvas');
		if (!canvas) {
			throw new Error('No canvas');
		}

		const context = canvas.getContext('2d');
		if (!context) {
			throw new Error('No 2D context');
		}

		const dpr = canvas.width / canvas.getBoundingClientRect().width;
		const y = Math.floor(canvas.height / 2);
		const read = (x: number) =>
			context.getImageData(Math.floor(x * dpr), y, 1, 1).data[3] ?? 0;
		return {inside: read(64 - 10), outside: read(64 + 30)};
	});
	expect(leftPixels.inside, 'the remaining sliver is drawn').toBeGreaterThan(0);
	expect(leftPixels.outside, 'the rest of the stage stays empty').toBe(0);
});

test('above 200% zoom the image is drawn without smoothing (DESIGN.md section 7)', async ({
	page,
}) => {
	await page.goto('/');
	await importProject(page, {width: 64, height: 64, pattern: 'blocks'});
	await expect(page.locator('canvas')).toBeVisible();
	await chooseZoom(page, '400%');

	const colours = await page.evaluate(() => {
		const canvas = globalThis.document.querySelector('canvas');
		if (!canvas) {
			throw new Error('No canvas');
		}

		const context = canvas.getContext('2d');
		if (!context) {
			throw new Error('No 2D context');
		}

		const y = Math.floor(canvas.height / 2);
		const line = context.getImageData(0, y, canvas.width, 1).data;
		const seen = new Set<string>();
		for (let x = 0; x < canvas.width; x++) {
			const offset = x * 4;
			if ((line[offset + 3] ?? 0) === 0) {
				continue;
			}

			seen.add(`${line[offset]},${line[offset + 1]},${line[offset + 2]}`);
		}

		return [...seen];
	});

	const blended = colours.filter((colour) => !BLOCK_COLOUR_RGB.has(colour));
	expect(
		blended,
		'a nearest-neighbour draw has no colour between two source colours',
	).toEqual([]);
	expect(colours.length).toBeGreaterThan(1);
});

test('two-finger pinch zooms around the midpoint and double-tap toggles fit', async ({
	page,
}) => {
	await page.goto('/');
	await importProject(page);
	await expect(page.locator('canvas')).toBeVisible();

	const box = await canvasBox(page);
	const centre = {x: box.width / 2, y: box.height / 2};
	const before = await readView(page);

	const pinched = await page.evaluate((point) => {
		const canvas = globalThis.document.querySelector('canvas');
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		if (!canvas || !runtime) {
			throw new Error('Canvas or runtime missing');
		}

		const send = (type: string, pointerId: number, x: number, y: number) => {
			canvas.dispatchEvent(
				new globalThis.PointerEvent(type, {
					pointerId,
					pointerType: 'touch',
					isPrimary: pointerId === 1,
					clientX: x,
					clientY: y,
					bubbles: true,
					cancelable: true,
				}),
			);
		};

		send('pointerdown', 1, point.x - 40, point.y);
		send('pointerdown', 2, point.x + 40, point.y);
		send('pointermove', 1, point.x - 80, point.y);
		send('pointermove', 2, point.x + 80, point.y);
		send('pointerup', 2, point.x + 80, point.y);
		send('pointerup', 1, point.x - 80, point.y);

		const project =
			runtime.result?.status === 'ready'
				? runtime.result.bundle.store.getState().activeProject
				: null;
		return project?.viewState.zoom ?? 0;
	}, centre);

	expect(pinched).toBeCloseTo(before.zoom * 2, 2);

	await page.evaluate((point) => {
		const canvas = globalThis.document.querySelector('canvas');
		if (!canvas) {
			throw new Error('No canvas');
		}

		for (const _tap of [0, 1]) {
			for (const type of ['pointerdown', 'pointerup']) {
				canvas.dispatchEvent(
					new globalThis.PointerEvent(type, {
						pointerId: 7,
						pointerType: 'touch',
						isPrimary: true,
						clientX: point.x,
						clientY: point.y,
						bubbles: true,
						cancelable: true,
					}),
				);
			}
		}
	}, centre);

	expect((await readView(page)).fitMode).toBe('fit');
});

test('the view state is restored after a reload (AC-F3.3)', async ({page}) => {
	await page.goto('/');
	await importProject(page);
	await expect(page.locator('canvas')).toBeVisible();
	await chooseZoom(page, '200%');

	const box = await canvasBox(page);
	await dragBy(
		page,
		{x: box.x + box.width / 2, y: box.y + box.height / 2},
		-120,
	);

	await flushView(page);
	const before = await readView(page);
	await page.reload();
	await expect(page.locator('canvas')).toBeVisible();
	await expect(page.getByRole('button', {name: /^Zoom /})).toHaveText(/200%/);

	const after = await readView(page);
	expect(after.zoom).toBeCloseTo(before.zoom, 5);
	expect(Math.abs(after.centerX - before.centerX)).toBeLessThanOrEqual(1);
	expect(Math.abs(after.centerY - before.centerY)).toBeLessThanOrEqual(1);
});

test('resizing across layout classes keeps the zoom and pan (AC-F18.2)', async ({
	page,
}) => {
	await page.goto('/');
	await importProject(page);
	await expect(page.locator('canvas')).toBeVisible();
	await chooseZoom(page, '200%');
	const before = await readView(page);

	const viewports: ProofViewport[] = [...PROOF_VIEWPORTS].toReversed();
	for (const viewport of viewports) {
		await page.setViewportSize({
			width: viewport.width,
			height: viewport.height,
		});
		await expect(page.locator('canvas')).toBeVisible();
		const during = await readView(page);
		expect(during.zoom).toBeCloseTo(before.zoom, 5);
		expect(Math.abs(during.centerX - before.centerX)).toBeLessThanOrEqual(1);
		expect(Math.abs(during.centerY - before.centerY)).toBeLessThanOrEqual(1);
		await expect(page.getByRole('button', {name: /^Zoom /})).toHaveText(/200%/);
	}
});

test('a long render shows the progress bar only after 300 ms (AC-F8.3)', async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.goto('/');
	// 24 pixel sort passes over a 12 MP source take about a second, well past
	// the delay, so the bar has a window in which it must not be visible.
	await importProject(page, {width: 4000, height: 3000});
	await waitForSettledFrame(page);

	// Changing the head of the pipeline invalidates every later stage, which is
	// what makes this render long enough for the bar to appear.
	const instance = await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const result = runtime?.result;
		if (!runtime || !result || result.status !== 'ready') {
			throw new Error('App is not ready');
		}

		const {store} = result.bundle;
		for (let index = 0; index < 24; index++) {
			await store.getState().addEffect('pixelSort');
		}

		const head = store.getState().activeProject?.stack.instances.at(0);
		if (!head) {
			throw new Error('The stack is empty');
		}

		return head.id;
	});

	await expect
		.poll(
			async () => {
				const render = await readRender(page);
				return render.busy.settle || render.busy.drag;
			},
			{timeout: 120_000},
		)
		.toBe(false);

	const timing = await page.evaluate(async (instanceId) => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const result = runtime?.result;
		if (!runtime || !result || result.status !== 'ready') {
			throw new Error('App is not ready');
		}

		const {store} = result.bundle;
		const nextFrame = async () => {
			await new Promise((resolve) => {
				globalThis.requestAnimationFrame(() => {
					resolve(null);
				});
			});
		};

		const isBusy = () => {
			const {busy} = store.getState().render;
			return busy.settle || busy.drag;
		};

		// Stacked renders chain together, so wait for a quiet stretch first.
		let quietSince = performance.now();
		while (performance.now() - quietSince < 5000) {
			if (isBusy()) {
				quietSince = performance.now();
			}

			await nextFrame();
		}

		await store.getState().commitParam(instanceId, 'angle', 30);
		const committedAt = performance.now();
		let segmentStart: number | null = null;
		let barAt: number | null = null;
		while (performance.now() - committedAt < 120_000) {
			const elapsed = performance.now() - committedAt;
			const busyNow = isBusy();
			if (busyNow && segmentStart === null) {
				segmentStart = elapsed;
				barAt = null;
			}

			if (
				busyNow &&
				barAt === null &&
				globalThis.document.querySelector('[role="progressbar"]')
			) {
				barAt = elapsed;
			}

			if (!busyNow && segmentStart !== null) {
				return {duration: elapsed - segmentStart, barAt};
			}

			await nextFrame();
		}

		return {duration: -1, barAt: null};
	}, instance);

	expect(
		timing.barAt,
		'the bar appears once the render passes 300 ms',
	).not.toBeNull();
	expect(timing.barAt ?? 0).toBeGreaterThanOrEqual(250);
	expect(timing.duration).toBeGreaterThan((timing.barAt ?? 0) + 100);
	await expect(page.getByRole('progressbar')).toHaveCount(0);
});

test('zooming past 200% renders full resolution and shows the pill (AC-F8.4, AC-F8.5)', async ({
	page,
}) => {
	test.setTimeout(120_000);
	await page.goto('/');
	await importProject(page, {width: 4000, height: 3000, pattern: 'checker'});
	await waitForSettledFrame(page);

	// 400% is above the smoothing threshold, so the drawn pixels stay exact.
	await chooseZoom(page, '400%');
	const pill = page.getByText('Rendering full resolution');
	await expect(pill).toBeVisible({timeout: 5000});

	await expect
		.poll(async () => (await readRender(page)).fullWidth, {timeout: 3000})
		.toBe(4000);
	await expect(pill).toHaveCount(0, {timeout: 5000});

	const comparison = await page.evaluate(() => {
		const canvas = globalThis.document.querySelector('canvas');
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const result = runtime?.result;
		if (!canvas || !runtime || !result || result.status !== 'ready') {
			throw new Error('App is not ready');
		}

		const state = result.bundle.store.getState();
		const {frame, full} = state.render;
		const context = canvas.getContext('2d');
		if (!frame || !full || !context) {
			throw new Error('No frames to compare');
		}

		const scratch = globalThis.document.createElement('canvas');
		scratch.width = 1;
		scratch.height = 1;
		const scratchContext = scratch.getContext('2d');
		if (!scratchContext) {
			throw new Error('No scratch context');
		}

		const readBitmap = (bitmap: ImageBitmap, x: number, y: number) => {
			scratchContext.clearRect(0, 0, 1, 1);
			scratchContext.drawImage(bitmap, x, y, 1, 1, 0, 0, 1, 1);
			const {data} = scratchContext.getImageData(0, 0, 1, 1);
			return [data[0], data[1], data[2]];
		};

		const y = Math.floor(canvas.height / 2);
		const samples: number[][] = [];
		for (let index = 1; index <= 32; index++) {
			const x = Math.floor((canvas.width * index) / 33);
			const {data} = context.getImageData(x, y, 1, 1);
			samples.push([data[0] ?? 0, data[1] ?? 0, data[2] ?? 0]);
		}

		return {
			generation: full.generation,
			samples,
			// The proxy the frame holds: a 1px checkerboard averages to mid grey.
			frameCentre: readBitmap(
				frame.bitmap,
				Math.floor(frame.width / 2),
				Math.floor(frame.height / 2),
			),
			frameWidth: frame.width,
			fullWidth: full.width,
		};
	});

	expect(comparison.fullWidth).toBe(4000);
	expect(comparison.frameWidth).toBeLessThan(4000);
	const isBlackOrWhite = (value: number) => value <= 8 || value >= 247;
	const grey = comparison.frameCentre.every(
		(channel) => channel > 60 && channel < 200,
	);
	expect(
		grey,
		`the proxy frame is a grey average of the checkerboard, got ${comparison.frameCentre.join(',')}`,
	).toBe(true);

	const pure = comparison.samples.filter((pixel) =>
		pixel.every((channel) => isBlackOrWhite(channel)),
	);
	expect(
		pure.length,
		`every sampled pixel is a full-resolution checkerboard pixel, got ${JSON.stringify(comparison.samples)}`,
	).toBe(comparison.samples.length);

	await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const result = runtime?.result;
		if (!runtime || !result || result.status !== 'ready') {
			throw new Error('App is not ready');
		}

		const {store} = result.bundle;
		const added = await store.getState().addEffect('pixelSort');
		await store.getState().commitParam(added.id, 'angle', 45);
	});

	await expect
		.poll(async () => (await readRender(page)).fullGeneration, {timeout: 5000})
		.not.toBe(comparison.generation);
	await expect(pill).toHaveCount(0, {timeout: 5000});
});

const THEMES = [
	{name: 'light', media: 'light', stored: 'light'},
	{name: 'dark', media: 'dark', stored: 'dark'},
] as const;

for (const theme of THEMES) {
	for (const viewport of PROOF_VIEWPORTS) {
		test(`the canvas stage has no a11y violations or horizontal scroll in ${theme.name} at ${viewport.name} @a11y`, async ({
			page,
		}) => {
			const consoleErrors = collectConsoleErrors(page);
			await page.emulateMedia({colorScheme: theme.media});
			await page.addInitScript((value) => {
				globalThis.localStorage.setItem('psg:theme', value);
			}, theme.stored);
			await page.setViewportSize({
				width: viewport.width,
				height: viewport.height,
			});
			await page.goto('/');
			await importProject(page, {name: 'Layout check'});
			await expect(page.locator('canvas')).toBeVisible();
			await waitForSettledFrame(page);
			await chooseZoom(page, '200%');

			const metrics = await page.evaluate(() => ({
				scrollWidth: globalThis.document.documentElement.scrollWidth,
				innerWidth: globalThis.innerWidth,
			}));
			expect(
				metrics.scrollWidth,
				`no horizontal page scroll at ${viewport.width}x${viewport.height}`,
			).toBeLessThanOrEqual(metrics.innerWidth);

			const canvas = await canvasBox(page);
			expect(canvas.width).toBeLessThanOrEqual(viewport.width);
			expect(canvas.height).toBeLessThanOrEqual(viewport.height);

			await assertNoA11yViolations(page);
			expect(consoleErrors, 'Console errors').toEqual([]);
		});
	}
}
