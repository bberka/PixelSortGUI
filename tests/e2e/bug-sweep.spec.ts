/**
 Regressions found by walking the shipped app: touch targets, focus after
 dialogs, screen changes and self-removing controls, long names, scroll
 regions and export fields.
 */
import {Buffer} from 'node:buffer';
import {expect, test, type Locator, type Page} from '@playwright/test';
import {assertNoA11yViolations} from './axe.ts';
import {dropImages} from './import.ts';
import {importSyntheticProject} from './seed.ts';

// No spaces, so nothing but an explicit rule can wrap it.
const LONG_NAME = 'W'.repeat(120);
const PHONE = {width: 390, height: 844};
const TABLET = {width: 820, height: 1180};

const button = (page: Page, name: string) =>
	page.getByRole('button', {name, exact: true});

async function openEditor(page: Page, name = 'Sweep'): Promise<void> {
	await page.goto('/');
	await importSyntheticProject(page, name);
	await expect(page.locator('canvas')).toBeVisible();
}

async function addEffect(page: Page, name: string): Promise<void> {
	await button(page, 'Add effect').click();
	await page
		.getByRole('dialog')
		.getByRole('button', {name: new RegExp(`^${name}`)})
		.click();
	await expect(button(page, `${name} actions`)).toBeVisible();
}

async function savePreset(page: Page, name: string): Promise<void> {
	await button(page, 'Presets').click();
	await button(page, 'Save as preset').click();
	const input = page.getByRole('textbox', {name: 'Preset name'});
	await expect(input).toBeFocused();
	await input.fill(name);
	await input.press('Enter');
	await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function expectTouchTarget(target: Locator): Promise<void> {
	await expect(target).toBeVisible();
	// Polled, because dialogs and menus zoom in from 95 %.
	await expect
		.poll(async () => {
			const box = (await target.boundingBox())!;
			return Math.min(Math.round(box.width), Math.round(box.height));
		})
		.toBeGreaterThanOrEqual(44);
}

async function expectInViewport(page: Page, target: Locator): Promise<void> {
	await expect(target).toBeVisible();
	await expect(target).toBeInViewport({ratio: 1});
	const box = (await target.boundingBox())!;
	expect(box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

for (const [layout, viewport] of [
	['phone', PHONE],
	['tablet', TABLET],
] as const) {
	test.describe(`touch ${layout}`, () => {
		test.skip(
			({browserName}) => browserName !== 'chromium',
			'Playwright emulates a coarse pointer in Chromium only',
		);
		test.use({viewport, hasTouch: true, isMobile: true});

		test('buttons, switches, menus and fields are at least 44 px', async ({
			page,
		}) => {
			await openEditor(page);
			await addEffect(page, 'Pixel sort');

			// Each of these is a tooltip or menu trigger, or sets its own size.
			for (const name of ['Guide', 'Settings', 'Pixel sort actions']) {
				await expectTouchTarget(button(page, name));
			}

			await expectTouchTarget(page.getByRole('button', {name: /^Zoom/}));
			await expectTouchTarget(button(page, 'Pixel sort'));
			await expectTouchTarget(
				page.getByRole('switch', {name: 'Pixel sort', exact: true}),
			);

			const angle = page.getByRole('textbox', {name: 'Angle'});
			await expectTouchTarget(angle);
			await expect(angle).toHaveCSS('font-size', '16px');

			await button(page, 'Pixel sort actions').click();
			await expectTouchTarget(page.getByRole('menuitem', {name: 'Duplicate'}));
			await page.keyboard.press('Escape');

			await button(page, 'Presets').click();
			await expectTouchTarget(
				page.getByRole('button', {name: /^ASDF classic/}),
			);
		});

		test('library menu items and the history checkbox row are at least 44 px', async ({
			page,
		}) => {
			await openEditor(page);
			await button(page, 'Back to library').click();
			for (const trigger of ['Actions for Sweep', 'Library actions']) {
				await button(page, trigger).click();
				const items = page.getByRole('menuitem');
				await expect(items.first()).toBeVisible();
				for (const item of await items.all()) {
					await expectTouchTarget(item);
				}

				await page.keyboard.press('Escape');
				await expect(items).toHaveCount(0);
			}

			await button(page, 'Actions for Sweep').click();
			await page.getByRole('menuitem', {name: 'Save project file'}).click();
			await expectTouchTarget(page.locator('[data-slot="check-row"]'));
		});

		test('the lower crop handles clear the zoom control', async ({page}) => {
			await openEditor(page);
			await button(page, 'Transform').click();
			const handle = page.locator('[data-crop-handle="sw"]');
			await expect(handle).toBeVisible();
			const zoom = page.getByRole('button', {name: /^Zoom/});
			await expect
				.poll(async () => {
					const a = (await handle.boundingBox())!;
					const b = (await zoom.boundingBox())!;
					return (
						a.y + a.height <= b.y ||
						a.x >= b.x + b.width ||
						a.x + a.width <= b.x
					);
				})
				.toBe(true);
		});
	});
}

test.describe('touch tablet toolbar', () => {
	test.skip(
		({browserName}) => browserName !== 'chromium',
		'Playwright emulates a coarse pointer in Chromium only',
	);
	test.use({viewport: TABLET, hasTouch: true, isMobile: true});

	test('is tall enough for its buttons', async ({page}) => {
		await openEditor(page);
		const row = (await page
			.locator('section[aria-label="Canvas toolbar"]')
			.boundingBox())!;
		const compare = (await button(page, 'Compare').boundingBox())!;
		expect(compare.y).toBeGreaterThanOrEqual(row.y);
		expect(compare.y + compare.height).toBeLessThanOrEqual(row.y + row.height);
	});
});

test.describe('touch phone focus', () => {
	test.skip(
		({browserName}) => browserName !== 'chromium',
		'Playwright emulates a coarse pointer in Chromium only',
	);
	test.use({viewport: PHONE, hasTouch: true, isMobile: true});

	test('Duplicate on a chip moves focus to the copy', async ({page}) => {
		await openEditor(page);
		await addEffect(page, 'Pixel sort');
		await button(page, 'Pixel sort actions').click();
		await page.getByRole('menuitem', {name: 'Duplicate'}).click();
		const chips = button(page, 'Pixel sort');
		await expect(chips).toHaveCount(2);
		await expect(chips.nth(1)).toBeFocused();
	});
});

test('adding the first effect returns focus to Add effect', async ({page}) => {
	await openEditor(page);
	await addEffect(page, 'Posterize');
	await expect(button(page, 'Add effect')).toBeFocused();
});

test('closing the Transform panel returns focus to its button', async ({
	page,
}) => {
	await openEditor(page);
	await button(page, 'Transform').click();
	await button(page, 'Close transform panel').press('Enter');
	await expect(button(page, 'Transform')).toBeFocused();
});

test('the preset dialogs keep focus, then return it to Presets', async ({
	page,
}) => {
	await openEditor(page);
	await addEffect(page, 'Posterize');
	const presets = button(page, 'Presets');
	await savePreset(page, 'Mine');
	await expect(presets).toBeFocused();

	await presets.click();
	await button(page, 'Mine actions').click();
	await page.getByRole('menuitem', {name: 'Rename'}).click();
	await expect(page.getByRole('textbox', {name: 'Preset name'})).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(presets).toBeFocused();

	await presets.click();
	await button(page, 'Mine actions').click();
	await page.getByRole('menuitem', {name: 'Delete'}).click();
	const confirm = page.getByRole('alertdialog');
	await expect(confirm.getByRole('button', {name: 'Cancel'})).toBeFocused();
	await confirm.getByRole('button', {name: 'Delete'}).click();
	await expect(presets).toBeFocused();
});

test('a long preset name truncates inside the list', async ({page}) => {
	await page.setViewportSize(PHONE);
	await openEditor(page);
	await addEffect(page, 'Posterize');
	await savePreset(page, 'M'.repeat(60));
	await button(page, 'Presets').click();
	const viewport = page
		.getByRole('dialog')
		.locator('[data-slot="scroll-area-viewport"]');
	await expect
		.poll(async () =>
			viewport.evaluate((element) => element.scrollWidth - element.clientWidth),
		)
		.toBe(0);
	await expectInViewport(page, button(page, 'Save as preset'));
});

test('a project name without spaces leaves the delete buttons on screen', async ({
	page,
}) => {
	await page.setViewportSize(PHONE);
	await openEditor(page, LONG_NAME);
	await button(page, 'Back to library').click();
	await button(page, `Actions for ${LONG_NAME}`).click();
	await page.getByRole('menuitem', {name: 'Delete'}).click();
	const confirm = page.getByRole('alertdialog');
	for (const name of ['Cancel', 'Delete']) {
		await expectInViewport(page, confirm.getByRole('button', {name}));
	}
});

test('card dialogs return focus to the card menu button', async ({page}) => {
	await openEditor(page);
	await button(page, 'Back to library').click();
	const actions = button(page, 'Actions for Sweep');

	for (const item of ['Rename', 'Delete']) {
		await actions.click();
		await page.getByRole('menuitem', {name: item}).click();
		await page.getByRole('button', {name: 'Cancel'}).click();
		await expect(actions).toBeFocused();
	}

	await actions.click();
	await page.getByRole('menuitem', {name: 'Rename'}).click();
	await page.getByRole('textbox', {name: 'Name'}).fill('Renamed');
	await page.keyboard.press('Enter');
	await expect(button(page, 'Actions for Renamed')).toBeFocused();
});

for (const [layout, viewport] of [
	['phone', PHONE],
	['short desktop', {width: 1440, height: 600}],
] as const) {
	test(`the effect picker scrolls in the app's scroll area, ${layout}`, async ({
		page,
	}) => {
		await page.setViewportSize(viewport);
		await openEditor(page);
		await button(page, 'Add effect').click();
		const area = page
			.getByRole('dialog')
			.locator('[data-slot="scroll-area-viewport"]');
		await expect
			.poll(async () =>
				area.evaluate((element) => element.scrollHeight - element.clientHeight),
			)
			.toBeGreaterThan(0);
		const last = page
			.getByRole('dialog')
			.getByRole('button', {name: /^JPEG crush/});
		await last.scrollIntoViewIfNeeded();
		await expectInViewport(page, last);
		await last.click();
		await expect(button(page, 'JPEG crush actions')).toBeVisible();
	});
}

test('AC-F12.11: clearing the longest side blocks the download until it is restored', async ({
	page,
}) => {
	await openEditor(page);
	await button(page, 'Export').click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('radio', {name: 'Custom'}).first().click();
	const field = dialog.getByRole('spinbutton', {name: 'Longest side (px)'});
	const download = dialog.getByRole('button', {name: 'Download'});
	await field.fill('200');

	await field.fill('');
	await expect(field).toHaveValue('');
	await expect(field).toHaveAttribute('aria-invalid', 'true');
	await expect(field).toHaveAccessibleDescription(
		'Enter a whole number from 1 to 320.',
	);
	await expect(download).toBeDisabled();
	await assertNoA11yViolations(page);

	await field.press('Tab');
	await expect(field).toHaveValue('320');
	await expect(download).toBeEnabled();
	await expect(dialog.getByText('Enter a whole number')).toHaveCount(0);

	await dialog.getByRole('radio', {name: 'Custom'}).last().click();
	const size = dialog.getByRole('spinbutton', {name: 'Max size'});
	await size.fill('');
	await expect(download).toBeDisabled();
	await size.press('Tab');
	await expect(size).toHaveValue('1024');
	await expect(download).toBeEnabled();
});

for (const back of ['button', 'browser'] as const) {
	test(`leaving the Guide and the editor by ${back} places the focus`, async ({
		page,
	}) => {
		await openEditor(page);
		const leave = async (name: string) => {
			await (back === 'button' ? button(page, name).click() : page.goBack());
		};

		await button(page, 'Guide').click();
		await expect(page.getByRole('heading', {level: 2})).toBeFocused();
		await leave('Back to editor');
		await expect(button(page, 'Guide')).toBeFocused();

		// A hash change is how the browser leaves the editor for the library.
		await (back === 'button'
			? button(page, 'Back to library').click()
			: page.evaluate(() => {
					globalThis.location.hash = '#/';
				}));
		await expect(button(page, 'Open Sweep')).toBeFocused();

		await button(page, 'Guide').click();
		await expect(page.getByRole('heading', {level: 2})).toBeFocused();
		await leave('Back to library');
		await expect(button(page, 'Guide')).toBeFocused();
	});
}

const BROKEN_IMAGE = {
	name: 'broken.jpg',
	mimeType: 'image/jpeg',
	buffer: Buffer.from('not a picture'),
};

test('dismissing a dropped file error returns the focus', async ({page}) => {
	await openEditor(page);
	const dismiss = button(page, 'Dismiss');
	const main = page.getByRole('main');

	// Nothing had the focus.
	await page.evaluate(() => {
		(globalThis.document.activeElement as HTMLElement | null)?.blur();
	});
	await dropImages(page, [BROKEN_IMAGE]);
	await dismiss.click();
	await expect(main).toBeFocused();

	await button(page, 'Transform').focus();
	await expect(main).not.toHaveAttribute('tabindex');
	await dropImages(page, [BROKEN_IMAGE]);
	await expect(dismiss).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(button(page, 'Transform')).toBeFocused();
});

for (const list of ['menu', 'select'] as const) {
	test(`an open ${list} keeps the focus away from the hidden page`, async ({
		page,
	}) => {
		await openEditor(page);
		await addEffect(page, 'Pixel sort');
		await (
			list === 'menu'
				? button(page, 'Pixel sort actions')
				: page.getByRole('combobox').first()
		).click();
		const open = page.getByRole(list === 'menu' ? 'menu' : 'listbox');
		await expect(open).toBeVisible();
		await assertNoA11yViolations(page);

		// Why axe's `aria-hidden-focus` is a false positive here.
		const focusInside = async () =>
			open.evaluate((element) =>
				element.contains(globalThis.document.activeElement),
			);
		for (const key of ['Tab', 'Shift+Tab']) {
			await page.keyboard.press(key);
			expect(await focusInside()).toBe(true);
		}

		await page.evaluate(() => {
			globalThis.document
				.querySelector<HTMLElement>('header[aria-hidden="true"] button')!
				.focus();
		});
		expect(await focusInside()).toBe(true);
	});
}

test('the whole undo history row toggles its checkbox', async ({page}) => {
	await openEditor(page);
	await button(page, 'Back to library').click();
	await button(page, 'Actions for Sweep').click();
	await page.getByRole('menuitem', {name: 'Save project file'}).click();
	const row = page.locator('[data-slot="check-row"]');
	const checkbox = page.getByRole('checkbox', {name: 'Include undo history'});
	await expect(checkbox).toBeChecked();
	// Polled, because the dialog zooms in from 95 %.
	await expect
		.poll(async () => Math.round((await row.boundingBox())!.height))
		.toBeGreaterThanOrEqual(24);
	const {width, height} = (await row.boundingBox())!;
	// The far end, away from the box and its text.
	await row.click({position: {x: width - 4, y: height / 2}});
	await expect(checkbox).not.toBeChecked();
});
