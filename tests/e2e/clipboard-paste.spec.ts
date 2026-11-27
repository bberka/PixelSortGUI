/**
 Paste image from clipboard (product.md F30, DESIGN.md section 7.4).
 */
import {expect, test, type Page} from '@playwright/test';
import {assertNoA11yViolations} from './axe.ts';
import {makeImage, readImportState, type ImageFixture} from './import.ts';
import {PROOF_VIEWPORTS} from './viewports.ts';

const CANVAS = {name: 'Canvas', exact: true} as const;

const banner = (page: Page) => page.getByRole('banner');
const libraryActions = (page: Page) =>
	banner(page).getByRole('button', {name: 'Library actions'});
const pasteItem = (page: Page) =>
	page.getByRole('menuitem', {name: /^Paste image/});
const pasteButton = (page: Page) =>
	page.getByRole('main').getByRole('button', {name: 'Paste image'});

test.beforeEach(async ({context, browserName}) => {
	if (browserName === 'chromium') {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	}
});

async function open(page: Page): Promise<void> {
	await page.goto('/');
	await expect(libraryActions(page)).toBeVisible();
}

// Puts a real PNG on the browser's clipboard.
async function copyImage(page: Page, width = 80, height = 60): Promise<void> {
	await page.evaluate(
		async (size) => {
			const canvas = new globalThis.OffscreenCanvas(size.width, size.height);
			const context = canvas.getContext('2d')!;
			context.fillStyle = '#d08040';
			context.fillRect(0, 0, size.width, size.height);
			context.fillStyle = '#102040';
			context.fillRect(0, 0, size.width / 2, size.height / 2);
			const blob = await canvas.convertToBlob({type: 'image/png'});
			await globalThis.navigator.clipboard.write([
				new globalThis.ClipboardItem({'image/png': blob}),
			]);
		},
		{width, height},
	);
}

async function copyText(page: Page, text: string): Promise<void> {
	await page.evaluate(async (value) => {
		await globalThis.navigator.clipboard.writeText(value);
	}, text);
}

const pressPaste = async (page: Page) => page.keyboard.press('ControlOrMeta+V');

// A paste event carrying a named file, which no script can put on the clipboard.
async function dispatchPaste(page: Page, fixture: ImageFixture): Promise<void> {
	await page.evaluate(
		({name, type, bytes}) => {
			const data = new globalThis.DataTransfer();
			data.items.add(
				new globalThis.File([new Uint8Array(bytes)], name, {type}),
			);
			const event = new globalThis.Event('paste', {
				bubbles: true,
				cancelable: true,
			});
			Object.defineProperty(event, 'clipboardData', {value: data});
			globalThis.document.body.dispatchEvent(event);
		},
		{
			name: fixture.name,
			type: fixture.mimeType,
			bytes: [...fixture.buffer],
		},
	);
}

async function projects(page: Page) {
	const state = await readImportState(page);
	return state.projects;
}

async function expectProjectCount(page: Page, count: number): Promise<void> {
	await expect.poll(async () => (await projects(page)).length).toBe(count);
}

// For "nothing happened": an import of this size would have landed by now.
async function expectStillCount(page: Page, count: number): Promise<void> {
	await page.waitForTimeout(600);
	expect(await projects(page)).toHaveLength(count);
}

async function toLibrary(page: Page): Promise<void> {
	await page.getByRole('button', {name: 'Back to library'}).click();
	await expect(libraryActions(page)).toBeVisible();
}

test('Ctrl+V imports on the Library and in the editor (AC-F30.1, .2, .5)', async ({
	page,
}) => {
	await open(page);
	await copyImage(page);

	await pressPaste(page);

	await expect(page.getByRole('region', CANVAS)).toBeVisible();
	await expectProjectCount(page, 1);
	const first = await readImportState(page);
	expect(first.projects).toMatchObject([
		{name: 'Pasted image', sourceWidth: 80, sourceHeight: 60},
	]);

	await pressPaste(page);

	await expectProjectCount(page, 2);
	const second = await readImportState(page);
	expect(second.activeProjectId).not.toBe(first.activeProjectId);
	expect(second.projects).toContainEqual(first.projects[0]);
	expect(second.sourceCount).toBe(1);
});

test('a copied file keeps its name, and the size limits apply (AC-F30.6)', async ({
	page,
}) => {
	await open(page);

	await dispatchPaste(
		page,
		await makeImage(page, {name: 'wide.png', width: 16_400, height: 4}),
	);
	const refused = page.getByRole('alertdialog', {name: 'Image too large'});
	await expect(refused).toContainText('the limit is 16,384 px');
	await refused.getByRole('button', {name: 'Dismiss'}).click();
	await expectStillCount(page, 0);

	await dispatchPaste(
		page,
		await makeImage(page, {
			name: 'huge.jpg',
			width: 8000,
			height: 6400,
			type: 'image/jpeg',
		}),
	);
	const large = page.getByRole('alertdialog', {name: /huge\.jpg is 8000/});
	await expect(
		large.getByRole('button', {name: 'Import at 50 MP'}),
	).toBeVisible();
	await large.getByRole('button', {name: 'Cancel'}).click();
	await expectStillCount(page, 0);

	await dispatchPaste(
		page,
		await makeImage(page, {name: 'sunset.png', width: 40, height: 30}),
	);
	await expectProjectCount(page, 1);
	expect(await projects(page)).toMatchObject([{name: 'sunset'}]);
});

test('typing fields and dialogs keep the paste (AC-F30.3)', async ({page}) => {
	await open(page);
	await copyImage(page);
	await pressPaste(page);
	await expectProjectCount(page, 1);
	await toLibrary(page);

	await page.getByRole('button', {name: 'Actions for Pasted image'}).click();
	await page.getByRole('menuitem', {name: 'Rename'}).click();
	const dialog = page.getByRole('dialog');
	const field = dialog.getByRole('textbox');
	await expect(field).toBeFocused();
	await pressPaste(page);
	await expectStillCount(page, 1);

	// Text still reaches the field.
	await copyText(page, 'Renamed');
	await field.selectText();
	await pressPaste(page);
	await expect(field).toHaveValue('Renamed');
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();

	await banner(page).getByRole('button', {name: 'Settings'}).click();
	await expect(page.getByRole('dialog', {name: 'Settings'})).toBeVisible();
	await copyImage(page);
	await pressPaste(page);
	await expectStillCount(page, 1);
});

test('a text field in the editor keeps the paste (AC-F30.3)', async ({
	page,
}) => {
	await open(page);
	await copyImage(page);
	await pressPaste(page);
	await expect(page.getByRole('region', CANVAS)).toBeVisible();
	await page.getByRole('button', {name: 'Add effect'}).first().click();
	await page.getByRole('button', {name: /^Pixel sort/}).click();
	const field = page.getByRole('textbox').first();
	await field.focus();

	await pressPaste(page);

	await expectStillCount(page, 1);
});

test('text and the Guide import nothing (AC-F30.4)', async ({page}) => {
	await open(page);
	await copyText(page, 'just words');
	await pressPaste(page);
	await expectStillCount(page, 0);
	await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);

	await page.goto('/#/guide');
	await expect(page.getByRole('heading', {name: 'Drift guide'})).toBeVisible();
	await copyImage(page);
	await pressPaste(page);
	await expectStillCount(page, 0);
});

test('"Paste image" imports from the empty Library and the menu by keyboard (AC-F30.7)', async ({
	page,
}) => {
	await open(page);
	await copyImage(page);

	await pasteButton(page).press('Enter');
	await expect(page.getByRole('region', CANVAS)).toBeVisible();
	await expectProjectCount(page, 1);
	await toLibrary(page);

	await libraryActions(page).press('Enter');
	await expect(pasteItem(page)).toBeFocused();
	await expect(pasteItem(page)).toContainText(/Ctrl\+V|⌘V/);
	await page.keyboard.press('Enter');

	await expect(page.getByRole('region', CANVAS)).toBeVisible();
	await expectProjectCount(page, 2);
});

test('"Paste image" says that the clipboard has no picture (AC-F30.8)', async ({
	page,
}) => {
	await open(page);
	await copyText(page, 'just words');

	await pasteButton(page).click();

	await expect(page.getByText('No image on the clipboard.')).toBeVisible();
	await expectStillCount(page, 0);
});

test('"Paste image" says that access was denied (AC-F30.8)', async ({page}) => {
	await page.addInitScript(() => {
		globalThis.navigator.clipboard.read = async () => {
			throw new DOMException('Denied', 'NotAllowedError');
		};
	});
	await open(page);

	await libraryActions(page).click();
	await pasteItem(page).click();

	await expect(
		page.getByText("Drift isn't allowed to read the clipboard."),
	).toBeVisible();
	await expect(page.getByText(/to paste instead/)).toBeVisible();
	await expectStillCount(page, 0);
});

test.describe('touch only', () => {
	test.skip(
		({browserName}) => browserName !== 'chromium',
		'Only Chromium emulates a pointer that cannot hover.',
	);
	test.use({
		viewport: {width: 390, height: 844},
		hasTouch: true,
		isMobile: true,
	});

	test('no paste shortcut is named (AC-F30.9)', async ({page}) => {
		await page.addInitScript(() => {
			globalThis.navigator.clipboard.read = async () => {
				throw new DOMException('Denied', 'NotAllowedError');
			};
		});
		await open(page);

		await libraryActions(page).tap();
		await expect(pasteItem(page)).toHaveText('Paste image');
		await pasteItem(page).tap();

		await expect(
			page.getByText("Drift isn't allowed to read the clipboard."),
		).toBeVisible();
		await expect(page.getByText(/Ctrl\+V|⌘V|paste instead/)).toHaveCount(0);
	});
});

for (const theme of ['light', 'dark'] as const) {
	for (const viewport of PROOF_VIEWPORTS) {
		test(`paste actions lay out at ${viewport.name} in ${theme} @a11y`, async ({
			page,
		}, testInfo) => {
			const errors: string[] = [];
			page.on('pageerror', (error) => {
				errors.push(error.message);
			});
			await page.emulateMedia({colorScheme: theme});
			await page.addInitScript((value) => {
				globalThis.localStorage.setItem('drift:theme', value);
			}, theme);
			await page.setViewportSize(viewport);
			await open(page);
			const shot = async (name: string) => {
				expect(
					await page.evaluate(
						() => globalThis.document.documentElement.scrollWidth,
					),
				).toBeLessThanOrEqual(viewport.width);
				await page.screenshot({
					animations: 'disabled',
					path: testInfo.outputPath(
						`paste-${name}-${viewport.name}-${theme}.png`,
					),
				});
			};

			await expect(pasteButton(page)).toBeInViewport({ratio: 1});
			await expect(page.locator('main canvas[data-rendered]')).toHaveCount(4);
			await assertNoA11yViolations(page);
			await shot('empty');

			await libraryActions(page).click();
			await expect(pasteItem(page)).toBeInViewport({ratio: 1});
			await assertNoA11yViolations(page);
			await shot('menu');
			await page.keyboard.press('Escape');

			await copyText(page, 'just words');
			await pasteButton(page).click();
			await expect(page.getByText('No image on the clipboard.')).toBeVisible();
			await expect(page.locator('[data-sonner-toast]')).toHaveCSS(
				'opacity',
				'1',
			);
			await assertNoA11yViolations(page);
			await shot('message');
			expect(errors).toEqual([]);
		});
	}
}
