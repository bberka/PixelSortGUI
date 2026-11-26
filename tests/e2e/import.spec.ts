import {Buffer} from 'node:buffer';
import {expect, test, type Page} from '@playwright/test';
import {assertNoA11yViolations} from './axe.ts';
import {
	blockFullStorage,
	chooseImages,
	decodedSourceSize,
	dragAwayFromWindow,
	dragOverWindow,
	dropImages,
	makeImage,
	readImportState,
	readStorageUsage,
	startStallSampler,
	stopStallSampler,
	withExifOrientation,
	type ImageFixture,
} from './import.ts';
import {PROOF_VIEWPORTS, type ProofViewport} from './viewports.ts';

const THEMES = [
	{name: 'light', media: 'light', stored: 'light'},
	{name: 'dark', media: 'dark', stored: 'dark'},
] as const;

type ThemeCase = (typeof THEMES)[number];

const EDITOR_CANVAS = {name: 'Canvas', exact: true} as const;
const DROP_PROMPT = 'Drop images to open';

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

async function openInTheme(
	page: Page,
	theme: ThemeCase,
	viewport?: ProofViewport,
): Promise<void> {
	await page.emulateMedia({colorScheme: theme.media});
	await page.addInitScript((value) => {
		globalThis.localStorage.setItem('drift:theme', value);
	}, theme.stored);
	if (viewport) {
		await page.setViewportSize({
			width: viewport.width,
			height: viewport.height,
		});
	}

	await page.goto('/');
}

async function expectEditorOpen(page: Page): Promise<void> {
	await expect(page.getByRole('region', EDITOR_CANVAS)).toBeVisible();
}

function importButton(page: Page) {
	return page.getByRole('banner').getByRole('button', {name: 'Import images'});
}

async function waitForProjectCount(page: Page, count: number): Promise<void> {
	await expect
		.poll(async () => (await readImportState(page)).projects.length)
		.toBe(count);
}

async function gotoLibrary(page: Page): Promise<void> {
	await page.goto('/');
	await expect(importButton(page)).toBeVisible();
}

async function expectNoHorizontalScroll(
	page: Page,
	viewport: ProofViewport,
): Promise<void> {
	const metrics = await page.evaluate(() => ({
		scrollWidth: globalThis.document.documentElement.scrollWidth,
		innerWidth: globalThis.innerWidth,
	}));
	expect(
		metrics.scrollWidth,
		`Expected no horizontal page scroll at ${viewport.width}x${viewport.height}`,
	).toBeLessThanOrEqual(metrics.innerWidth);
}

async function bigJpeg(page: Page): Promise<ImageFixture> {
	return makeImage(page, {
		name: 'mural.jpg',
		width: 7100,
		height: 7100,
		type: 'image/jpeg',
		quality: 0.7,
	});
}

test('three JPEGs chosen through the picker become three projects and the first opens (AC-F1.1)', async ({
	page,
}) => {
	const errors = collectConsoleErrors(page);
	await gotoLibrary(page);

	const accept = await page
		.locator('input[type="file"]')
		.first()
		.getAttribute('accept');
	expect(accept).toBe('image/*');

	const fixtures = [
		await makeImage(page, {
			name: 'alpha.jpg',
			width: 400,
			height: 300,
			type: 'image/jpeg',
		}),
		await makeImage(page, {
			name: 'bravo.jpg',
			width: 300,
			height: 400,
			type: 'image/jpeg',
		}),
		await makeImage(page, {
			name: 'charlie.jpg',
			width: 250,
			height: 250,
			type: 'image/jpeg',
		}),
	];
	await chooseImages(page, fixtures);

	await waitForProjectCount(page, 3);
	const snapshot = await readImportState(page);
	expect(snapshot.projects.map((project) => project.name).toSorted()).toEqual([
		'alpha',
		'bravo',
		'charlie',
	]);
	expect(snapshot.activeProjectName).toBe('alpha');
	expect(snapshot.screen).toBe('editor');
	expect(new URL(page.url()).hash).toBe(`#/p/${snapshot.activeProjectId}`);
	expect(errors, 'Console errors').toEqual([]);
});

test('dropping a PNG on the library shows the overlay and opens the image (AC-F1.2)', async ({
	page,
}) => {
	await gotoLibrary(page);

	await dragOverWindow(page);
	await expect(page.getByText(DROP_PROMPT, {exact: true})).toBeVisible();
	await dragAwayFromWindow(page);
	await expect(page.getByText(DROP_PROMPT, {exact: true})).toHaveCount(0);

	const fixture = await makeImage(page, {
		name: 'dropped.png',
		width: 320,
		height: 240,
	});
	await dropImages(page, [fixture]);

	await expectEditorOpen(page);
	const snapshot = await readImportState(page);
	expect(snapshot.projects.map((project) => project.name)).toEqual(['dropped']);
	expect(snapshot.activeProjectName).toBe('dropped');
});

test('a file the browser cannot decode creates no project and shows the exact message (AC-F1.3)', async ({
	page,
}) => {
	await gotoLibrary(page);

	const notAnImage: ImageFixture = {
		name: 'notes.jpg',
		mimeType: 'image/jpeg',
		buffer: Buffer.from('this is not an image at all', 'latin1'),
	};
	await chooseImages(page, [notAnImage]);

	await expect(
		page.getByText(
			"Can't open notes.jpg: the browser can't read this image format.",
			{exact: true},
		),
	).toBeVisible();
	const snapshot = await readImportState(page);
	expect(snapshot.projects).toHaveLength(0);
	expect(snapshot.screen).toBe('library');

	await page.getByRole('button', {name: 'Dismiss'}).click();
	await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('a 20,000 px side is rejected with the exact message (AC-F1.4)', async ({
	page,
}) => {
	test.slow();
	await gotoLibrary(page);

	const pano = await makeImage(page, {
		name: 'panorama.png',
		width: 20_000,
		height: 1000,
	});
	await chooseImages(page, [pano]);

	await expect(
		page.getByText(
			'Image too large: the longest side is 20,000 px; the limit is 16,384 px.',
			{exact: true},
		),
	).toBeVisible();
	const snapshot = await readImportState(page);
	expect(snapshot.projects).toHaveLength(0);
});

test('an image over 50 MP offers the downscaled import and keeps the aspect ratio (AC-F1.5)', async ({
	page,
}) => {
	test.slow();
	await gotoLibrary(page);

	const large = await makeImage(page, {
		name: 'huge.jpg',
		width: 8000,
		height: 6400,
		type: 'image/jpeg',
		quality: 0.7,
	});
	await chooseImages(page, [large]);

	const dialog = page.getByRole('alertdialog');
	await expect(dialog).toBeVisible();
	await expect(
		dialog.getByRole('heading', {name: 'huge.jpg is 8000 × 6400 px'}),
	).toBeVisible();
	await expect(
		dialog.getByRole('button', {name: 'Import anyway'}),
	).toBeVisible();
	expect((await readImportState(page)).projects).toHaveLength(0);

	await dialog.getByRole('button', {name: 'Import at 50 MP'}).click();
	await expectEditorOpen(page);

	const snapshot = await readImportState(page);
	expect(snapshot.projects).toHaveLength(1);
	const project = snapshot.projects[0];
	expect(project.sourceWidth * project.sourceHeight).toBeLessThanOrEqual(
		50_000_000,
	);
	// The ratio is kept within one pixel of the source.
	expect(
		Math.abs(project.sourceWidth * 0.8 - project.sourceHeight),
	).toBeLessThanOrEqual(1);
	const decoded = await decodedSourceSize(page);
	expect(decoded).toEqual({
		width: project.sourceWidth,
		height: project.sourceHeight,
	});
});

test('a JPEG with EXIF orientation 6 is imported rotated (AC-F1.6)', async ({
	page,
}) => {
	await gotoLibrary(page);

	const landscape = await makeImage(page, {
		name: 'sideways.jpg',
		width: 40,
		height: 20,
		type: 'image/jpeg',
	});
	const rotated = {
		...landscape,
		buffer: withExifOrientation(landscape.buffer, 6),
	};
	await chooseImages(page, [rotated]);

	await expectEditorOpen(page);
	const snapshot = await readImportState(page);
	expect(snapshot.projects).toHaveLength(1);
	expect(snapshot.projects[0].sourceWidth).toBe(20);
	expect(snapshot.projects[0].sourceHeight).toBe(40);
	expect(await decodedSourceSize(page)).toEqual({width: 20, height: 40});
});

test('importing the same file twice keeps one stored copy (AC-F1.7)', async ({
	page,
}) => {
	await gotoLibrary(page);

	const fixture = await makeImage(page, {
		name: 'repeat.jpg',
		width: 400,
		height: 300,
		type: 'image/jpeg',
	});
	await chooseImages(page, [fixture]);
	await expectEditorOpen(page);

	await page.getByRole('button', {name: 'Back to library'}).click();
	await chooseImages(page, [fixture]);
	await expectEditorOpen(page);

	const snapshot = await readImportState(page);
	expect(snapshot.projects).toHaveLength(2);
	expect(snapshot.projects[0].sourceHash).toBe(snapshot.projects[1].sourceHash);
	expect(snapshot.sourceCount).toBe(1);
});

test('the second import grows storage by less than 1% of the file size (AC-F1.7)', async ({
	page,
	browserName,
}) => {
	test.skip(
		browserName === 'firefox',
		'Firefox rounds navigator.storage.estimate(), so byte growth is not readable there',
	);
	await gotoLibrary(page);

	const fixture = await makeImage(page, {
		name: 'large-repeat.jpg',
		width: 2400,
		height: 1800,
		type: 'image/jpeg',
		quality: 0.92,
	});
	await chooseImages(page, [fixture]);
	await expectEditorOpen(page);
	const usageAfterFirst = await readStorageUsage(page);
	expect(usageAfterFirst).not.toBeNull();

	await page.getByRole('button', {name: 'Back to library'}).click();
	await chooseImages(page, [fixture]);
	await expectEditorOpen(page);
	const usageAfterSecond = await readStorageUsage(page);
	expect(usageAfterSecond).not.toBeNull();

	const growth = (usageAfterSecond ?? 0) - (usageAfterFirst ?? 0);
	expect(
		growth,
		`Second import of a ${fixture.buffer.byteLength} byte file added ${growth} bytes`,
	).toBeLessThan(fixture.buffer.byteLength / 100);
});

test('a full storage shows the shell dialog and creates no project (AC-F16.2)', async ({
	page,
}) => {
	await blockFullStorage(page);
	await gotoLibrary(page);

	const fixture = await makeImage(page, {
		name: 'nofit.jpg',
		width: 400,
		height: 300,
		type: 'image/jpeg',
	});
	await chooseImages(page, [fixture]);

	const dialog = page.getByRole('alertdialog');
	await expect(dialog).toHaveCount(1);
	await expect(
		dialog.getByRole('heading', {name: 'Storage is full'}),
	).toBeVisible();
	await expect(
		dialog.getByRole('button', {name: 'Manage library'}),
	).toBeVisible();
	const snapshot = await readImportState(page);
	expect(snapshot.projects).toHaveLength(0);
	expect(snapshot.sourceCount).toBe(0);
});

async function probeFiftyMegapixels(page: Page) {
	await gotoLibrary(page);

	const large = await bigJpeg(page);
	await startStallSampler(page);
	await dropImages(page, [large]);
	const dialog = page.getByRole('alertdialog');
	await expect(
		dialog.getByRole('heading', {name: 'mural.jpg is 7100 × 7100 px'}),
	).toBeVisible();
	const sample = await stopStallSampler(page);
	await dialog.getByRole('button', {name: 'Cancel'}).click();
	return sample;
}

async function importTwelveMegapixels(page: Page) {
	await gotoLibrary(page);

	const big = await makeImage(page, {
		name: 'twelve.jpg',
		width: 4000,
		height: 3000,
		type: 'image/jpeg',
		quality: 0.85,
	});
	await startStallSampler(page);
	await dropImages(page, [big]);
	await expectEditorOpen(page);
	return stopStallSampler(page);
}

test('a 50 MP image is probed and offered for a decision', async ({page}) => {
	test.slow();
	const sample = await probeFiftyMegapixels(page);
	expect(sample.frameCount).toBeGreaterThan(0);
});

test('a 12 MP image imports and opens the editor', async ({page}) => {
	test.slow();
	const sample = await importTwelveMegapixels(page);
	expect(sample.frameCount).toBeGreaterThan(0);
});

test('probing a 50 MP image does not block the main thread @perf', async ({
	page,
}) => {
	test.slow();
	const sample = await probeFiftyMegapixels(page);

	console.log(
		`main-thread stall while probing a 50 MP image: ${sample.maxGapMs.toFixed(1)} ms over ${sample.frameCount} frames`,
	);
	expect(sample.frameCount).toBeGreaterThan(0);
	expect(sample.maxGapMs).toBeLessThan(500);
});

test('importing a 12 MP image does not block the main thread @perf', async ({
	page,
}) => {
	test.slow();
	const sample = await importTwelveMegapixels(page);

	console.log(
		`main-thread stall while importing a 12 MP image: ${sample.maxGapMs.toFixed(1)} ms over ${sample.frameCount} frames`,
	);
	expect(sample.frameCount).toBeGreaterThan(0);
	expect(sample.maxGapMs).toBeLessThan(500);
});

for (const theme of THEMES) {
	for (const viewport of PROOF_VIEWPORTS) {
		test(`import states have no a11y violations or horizontal scroll in ${theme.name} at ${viewport.name} @a11y`, async ({
			page,
		}) => {
			test.slow();
			const errors = collectConsoleErrors(page);
			await openInTheme(page, theme, viewport);

			await expect(
				page.getByRole('banner').getByRole('button', {name: 'Import images'}),
			).toBeVisible();
			await assertNoA11yViolations(page);
			await expectNoHorizontalScroll(page, viewport);

			await dragOverWindow(page);
			await expect(page.getByText(DROP_PROMPT, {exact: true})).toBeVisible();
			await assertNoA11yViolations(page);
			await expectNoHorizontalScroll(page, viewport);
			await dragAwayFromWindow(page);

			const tooWide = await makeImage(page, {
				name: 'wide.png',
				width: 16_385,
				height: 1,
			});
			await dropImages(page, [tooWide]);
			const rejection = page.getByRole('alertdialog');
			await expect(rejection).toBeVisible();
			await expect(
				rejection.getByRole('heading', {name: 'Image too large'}),
			).toBeVisible();
			await assertNoA11yViolations(page);
			await expectNoHorizontalScroll(page, viewport);
			await rejection.getByRole('button', {name: 'Dismiss'}).click();

			const large = await bigJpeg(page);
			await dropImages(page, [large]);
			const choice = page.getByRole('alertdialog');
			await expect(
				choice.getByRole('heading', {name: 'mural.jpg is 7100 × 7100 px'}),
			).toBeVisible();
			await expect(
				choice.getByRole('button', {name: 'Import at 50 MP'}),
			).toBeVisible();
			await assertNoA11yViolations(page);
			await expectNoHorizontalScroll(page, viewport);
			await choice.getByRole('button', {name: 'Cancel'}).click();

			expect(errors, 'Console errors').toEqual([]);
		});
	}
}
