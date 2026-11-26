import {Buffer} from 'node:buffer';
import {expect, test, type Page} from '@playwright/test';
import type {AppRuntime} from '../../src/state/index.ts';
import {assertNoA11yViolations} from './axe.ts';
import {
	chooseImages,
	decodedSourceSize,
	dropImages,
	readImportState,
	type ImageFixture,
} from './import.ts';
import {PROOF_VIEWPORTS} from './viewports.ts';

const EXTERNAL = 'https://external.invalid';
const PROBE = 'svg-external-probe';

function svg(name: string, markup: string): ImageFixture {
	return {name, mimeType: 'image/svg+xml', buffer: Buffer.from(markup)};
}

function document(attributes: string, body: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attributes}>${body}</svg>`;
}

const RED_BOX = '<rect width="100" height="50" fill="#ff0000"/>';

/**
 Every way an SVG can ask for another file, aimed at another origin and at this
 one, plus scripts that would ask if they ran.
 */
function hostileSvg(origin: string): string {
	const urls = [EXTERNAL, origin].map((base) => `${base}/${PROBE}`);
	const references = urls
		.map(
			(url) => `
	<style>@import url("${url}.css"); @font-face {font-family: remote; src: url("${url}.woff2");}
		rect {cursor: url("${url}.cur"), auto;}</style>
	<image href="${url}.png" width="100" height="50"/>
	<image xlink:href="${url}-xlink.png" width="100" height="50"/>
	<use href="${url}.svg#shape"/>
	<text font-family="remote" y="40">text</text>
	<rect width="1" height="1" fill="url(${url}-paint.svg#p)" style="filter: url(${url}-filter.svg#f)"/>
	<foreignObject width="100" height="50"><img xmlns="http://www.w3.org/1999/xhtml" src="${url}-html.png"/></foreignObject>
	<script href="${url}.js"/>
	<script>fetch("${url}-fetch")</script>
	<image href="missing-${PROBE}.png" width="1" height="1" onerror="fetch('${url}-onerror')"/>`,
		)
		.join('');
	return `<?xml-stylesheet type="text/css" href="${EXTERNAL}/${PROBE}-pi.css"?>${document(
		`viewBox="0 0 100 50" onload="fetch('${EXTERNAL}/${PROBE}-onload')"`,
		`${RED_BOX}${references}`,
	)}`;
}

/**
 Records every network request the page or its service worker makes.
 */
function recordRequests(page: Page): string[] {
	const requests: string[] = [];
	page.context().on('request', (request) => {
		if (/^(?:https?|wss?):/.test(request.url())) {
			requests.push(request.url());
		}
	});
	return requests;
}

/**
 What a leak would look like: anything but the app loading its own chunks.
 */
function leaks(requests: readonly string[], baseURL: string): string[] {
	return requests.filter(
		(url) => url.includes(PROBE) || !url.startsWith(`${baseURL}/assets/`),
	);
}

async function gotoLibrary(page: Page): Promise<void> {
	await page.goto('/');
	await expect(
		page.getByRole('banner').getByRole('button', {name: 'Import images'}),
	).toBeVisible();
}

async function expectEditorOpen(page: Page): Promise<void> {
	await expect(
		page.getByRole('region', {name: 'Canvas', exact: true}),
	).toBeVisible();
}

async function storedSource(
	page: Page,
): Promise<{type: string; pixel: number[]}> {
	return page.evaluate(async () => {
		const runtime = (globalThis as unknown as {__psgRuntime: AppRuntime})
			.__psgRuntime;
		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			throw new Error('App not ready');
		}

		const {blob} = booted.bundle.store.getState().activeSource!;
		const bitmap = await globalThis.createImageBitmap(blob);
		const canvas = new globalThis.OffscreenCanvas(bitmap.width, bitmap.height);
		const context = canvas.getContext('2d')!;
		context.drawImage(bitmap, 0, 0);
		// Bottom right, so a drawing left at its viewBox size reads as empty.
		const pixel = context.getImageData(
			bitmap.width - 10,
			bitmap.height - 10,
			1,
			1,
		).data;
		bitmap.close();
		return {type: blob.type, pixel: [...pixel]};
	});
}

test('a viewBox-only SVG imports at 2048 × 1024 and requests nothing it references (AC-F21.2)', async ({
	page,
	baseURL,
}) => {
	const requests = recordRequests(page);
	// Answer locally, so a leak is recorded without leaving the machine.
	await page
		.context()
		.route(`${EXTERNAL}/**`, async (route) => route.fulfill({status: 404}));
	await gotoLibrary(page);
	await page.waitForLoadState('networkidle');

	// Control: the recorder does see a request for another origin.
	await page.evaluate(async (url) => {
		await globalThis.fetch(url, {mode: 'no-cors'}).catch(() => undefined);
	}, `${EXTERNAL}/control`);
	expect(requests).toContain(`${EXTERNAL}/control`);

	const start = requests.length;
	await chooseImages(page, [
		svg('poster.svg', hostileSvg(new URL(baseURL!).origin)),
	]);
	await expectEditorOpen(page);
	await page.waitForLoadState('networkidle');

	const snapshot = await readImportState(page);
	expect(snapshot.projects).toHaveLength(1);
	expect(snapshot.projects[0]).toMatchObject({
		name: 'poster',
		sourceWidth: 2048,
		sourceHeight: 1024,
	});
	expect(await decodedSourceSize(page)).toEqual({width: 2048, height: 1024});
	expect(await storedSource(page)).toEqual({
		type: 'image/png',
		pixel: [255, 0, 0, 255],
	});

	// Opening the editor loads the app's own chunks; nothing else may appear.
	expect(leaks(requests.slice(start), baseURL!)).toEqual([]);
});

test('importing a second SVG from the open editor requests nothing it references (AC-F21.2)', async ({
	page,
	baseURL,
}) => {
	const requests = recordRequests(page);
	await gotoLibrary(page);
	await chooseImages(page, [
		svg('first.svg', document('viewBox="0 0 100 50"', RED_BOX)),
	]);
	await expectEditorOpen(page);
	await page.waitForLoadState('networkidle');

	const start = requests.length;
	await dropImages(page, [
		svg('second.svg', hostileSvg(new URL(baseURL!).origin)),
	]);
	await expect
		.poll(async () => (await readImportState(page)).activeProjectName)
		.toBe('second');
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(500);

	expect(leaks(requests.slice(start), baseURL!)).toEqual([]);
});

for (const [name, attributes, width, height] of [
	['sized.svg', 'width="120" height="80"', 120, 80],
	['units.svg', 'width="2in" height="1in" viewBox="0 0 100 50"', 192, 96],
	['huge.svg', 'width="40000" height="200"', 16_384, 81],
	[
		'styled.svg',
		'viewBox="0 0 100 50" style="width: 10px; height: 5px"',
		2048,
		1024,
	],
] as const) {
	test(`${name} rasterises at ${width} × ${height}`, async ({page}) => {
		await gotoLibrary(page);
		await chooseImages(page, [
			svg(name, document(attributes, '<rect width="100%" height="100%"/>')),
		]);
		await expectEditorOpen(page);

		expect(await decodedSourceSize(page)).toEqual({width, height});
		expect((await storedSource(page)).pixel).toEqual([0, 0, 0, 255]);
	});
}

test('a broken SVG creates no project and shows the unreadable message', async ({
	page,
}) => {
	await gotoLibrary(page);
	await chooseImages(page, [svg('broken.svg', '<svg><rect></svg>')]);

	await expect(
		page.getByText(
			"Can't open broken.svg: the browser can't read this image format.",
			{exact: true},
		),
	).toBeVisible();
	const snapshot = await readImportState(page);
	expect(snapshot.projects).toHaveLength(0);
	expect(snapshot.sourceCount).toBe(0);
});

for (const viewport of PROOF_VIEWPORTS) {
	test(`an imported SVG opens in the editor at ${viewport.name} @a11y`, async ({
		page,
		browserName,
	}) => {
		const errors: string[] = [];
		page.on('console', (message) => {
			if (message.type() === 'error') {
				errors.push(message.text());
			}
		});
		page.on('pageerror', (error) => {
			errors.push(error.message);
		});
		await page.setViewportSize(viewport);
		await gotoLibrary(page);
		await dropImages(page, [
			svg(
				'badge.svg',
				document(
					'viewBox="0 0 100 50"',
					'<rect width="100" height="50" fill="#102040"/><circle cx="30" cy="25" r="18" fill="#d08040"/><text x="55" y="30" font-size="14" fill="#f4f4f5">SVG</text>',
				),
			),
		]);
		await expectEditorOpen(page);
		await expect(page.getByText('Imported 1 image')).toBeAttached();
		await page.waitForTimeout(1000);

		const overflow = await page.evaluate(
			() =>
				globalThis.document.documentElement.scrollWidth - globalThis.innerWidth,
		);
		expect(overflow, 'Horizontal overflow').toBeLessThanOrEqual(0);
		await assertNoA11yViolations(page);
		if (browserName === 'chromium') {
			await page.screenshot({
				path: `.proof/svg-editor-${viewport.width}x${viewport.height}.png`,
				animations: 'disabled',
			});
		}

		expect(errors, 'Console errors').toEqual([]);
	});
}
