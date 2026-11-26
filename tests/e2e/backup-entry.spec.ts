/**
 The backup entry points and `.zip` routing in the app shell (product.md F17,
 DESIGN.md section 7.2).
 */
import {Buffer} from 'node:buffer';
import {readFile} from 'node:fs/promises';
import {expect, test, type Download, type Page} from '@playwright/test';
import {strFromU8, strToU8, unzipSync, zipSync} from 'fflate';
import {assertNoA11yViolations} from './axe.ts';
import {
	chooseImages,
	dragOverWindow,
	dropImages,
	makeImage,
	readImportState,
	type ChosenFixture,
} from './import.ts';
import {PROOF_VIEWPORTS} from './viewports.ts';

const BACKUP_NAME = /^glitch-backup-\d{8}-\d{6}\.zip$/;
const DROP_COPY = 'Drop images or project files to open';

const exportDialog = (page: Page) =>
	page.getByRole('dialog', {name: 'Export backup'});
const importDialog = (page: Page) =>
	page.getByRole('dialog', {name: 'Import backup'});
const settingsDialog = (page: Page) =>
	page.getByRole('dialog', {name: 'Settings'});
const banner = (page: Page) => page.getByRole('banner');
const settingsButton = (page: Page) =>
	banner(page).getByRole('button', {name: 'Settings'});
const libraryActions = (page: Page) =>
	banner(page).getByRole('button', {name: 'Library actions'});
const moreActions = (page: Page) =>
	banner(page).getByRole('button', {name: 'More actions'});
const importButton = (page: Page) =>
	importDialog(page).getByRole('button', {name: 'Import', exact: true});
const projectCard = (page: Page, name: string) =>
	page.getByRole('button', {name: `Actions for ${name}`});

const zipFixture = (name: string, buffer: Buffer): ChosenFixture => ({
	name,
	mimeType: 'application/zip',
	buffer,
});

async function open(page: Page): Promise<void> {
	// Keeps the picker intercepted for the whole test: Firefox can miss a click
	// that follows straight on a new subscription.
	page.on('filechooser', () => {});
	await page.goto('/');
	await expect(settingsButton(page)).toBeVisible();
}

// Imports one picture through the picker, which opens it in the editor.
async function addProject(page: Page, name: string): Promise<void> {
	if (await page.getByRole('button', {name: 'Back to library'}).isVisible()) {
		await toLibrary(page);
	}

	const image = await makeImage(page, {
		name: `${name}.png`,
		width: 64 + name.length,
		height: 48,
	});
	await chooseImages(page, [image]);
	await expect(
		page.getByRole('region', {name: 'Canvas', exact: true}),
	).toBeVisible();
}

async function toLibrary(page: Page): Promise<void> {
	await page.getByRole('button', {name: 'Back to library'}).click();
	await expect(libraryActions(page)).toBeVisible();
}

async function names(page: Page): Promise<string[]> {
	const state = await readImportState(page);
	return state.projects.map((project) => project.name).toSorted();
}

async function download(page: Page): Promise<Download> {
	const pending = page.waitForEvent('download');
	await exportDialog(page).getByRole('button', {name: 'Export backup'}).click();
	const file = await pending;
	await expect(exportDialog(page)).toBeHidden();
	return file;
}

async function exportFromLibrary(page: Page): Promise<Buffer> {
	await libraryActions(page).click();
	await page.getByRole('menuitem', {name: 'Export backup'}).click();
	const file = await download(page);
	expect(file.suggestedFilename()).toMatch(BACKUP_NAME);
	return readFile(await file.path());
}

async function saveProjectFile(page: Page, name: string): Promise<Buffer> {
	await projectCard(page, name).click();
	await page.getByRole('menuitem', {name: 'Save project file'}).click();
	const pending = page.waitForEvent('download');
	await page
		.getByRole('dialog', {name: 'Save project file'})
		.getByRole('button', {name: 'Save'})
		.click();
	const file = await pending;
	await expect(page.getByRole('dialog')).toBeHidden();
	return readFile(await file.path());
}

async function deleteProject(page: Page, name: string): Promise<void> {
	await projectCard(page, name).click();
	await page.getByRole('menuitem', {name: 'Delete'}).click();
	await page
		.getByRole('alertdialog')
		.getByRole('button', {name: 'Delete'})
		.click();
	await expect(projectCard(page, name)).toHaveCount(0);
}

// Presses `trigger` and answers the file picker it opens.
async function pickAfter(
	page: Page,
	trigger: () => Promise<void>,
	fixtures: readonly ChosenFixture[],
): Promise<void> {
	const chooser = page.waitForEvent('filechooser');
	await trigger();
	const opened = await chooser;
	await opened.setFiles([...fixtures]);
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
	expect(
		await page.evaluate(
			() =>
				globalThis.document.documentElement.scrollWidth <=
				globalThis.document.documentElement.clientWidth,
		),
	).toBe(true);
}

// A scan needs the overlay opaque.
async function settle(page: Page): Promise<void> {
	await page.waitForFunction(() =>
		globalThis.document
			.getAnimations()
			.every((item) => item.playState !== 'running'),
	);
}

async function expectAccessible(page: Page, include?: string): Promise<void> {
	await settle(page);
	await expectNoSidewaysScroll(page);
	await assertNoA11yViolations(page, include ? {include: [include]} : {});
}

function collectErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('console', (message) => {
		// Leaving the Library revokes a card thumbnail that may still be loading.
		if (
			message.type() === 'error' &&
			!message.location().url.startsWith('blob:')
		) {
			errors.push(message.text());
		}
	});
	page.on('pageerror', (error) => {
		errors.push(error.message);
	});
	return errors;
}

for (const viewport of PROOF_VIEWPORTS) {
	for (const theme of ['light', 'dark'] as const) {
		test(`AC-F17.8: the backup entry points work at ${viewport.name} width, ${theme} @a11y`, async ({
			page,
		}) => {
			const errors = collectErrors(page);
			await page.emulateMedia({colorScheme: theme});
			await page.setViewportSize(viewport);
			await open(page);
			await addProject(page, 'Night drive');
			await toLibrary(page);

			// The Library overflow menu.
			await expectNoSidewaysScroll(page);
			const trigger = libraryActions(page);
			const box = (await trigger.boundingBox())!;
			expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
			await trigger.click();
			await expect(page.getByRole('menuitem')).toHaveText([
				'Export backup',
				'Import backup',
			]);
			await expectAccessible(page, '[role="menu"]');
			await page.getByRole('menuitem', {name: 'Export backup'}).click();
			await expect(exportDialog(page)).toContainText('Night drive');
			await expectAccessible(page, '[role="dialog"]');
			await page.keyboard.press('Escape');
			await expect(exportDialog(page)).toBeHidden();
			await expect(trigger).toBeFocused();

			const backup = await exportFromLibrary(page);
			await expect(trigger).toBeFocused();

			await pickAfter(page, async () => {
				await trigger.click();
				await page.getByRole('menuitem', {name: 'Import backup'}).click();
			}, [zipFixture('library.zip', backup)]);
			await expect(importDialog(page)).toContainText('Unchanged');
			await expectAccessible(page, '[role="dialog"]');
			await importDialog(page).getByRole('button', {name: 'Cancel'}).click();
			await expect(importDialog(page)).toBeHidden();
			await expect(trigger).toBeFocused();

			// Settings, from the Library and from the editor.
			for (const screen of ['library', 'editor'] as const) {
				if (screen === 'editor') {
					await page.getByRole('button', {name: /^Open Night drive/}).click();
					await expect(
						page.getByRole('region', {name: 'Canvas', exact: true}),
					).toBeVisible();
				}

				await settingsButton(page).click();
				const settings = settingsDialog(page);
				await expect(
					settings.getByRole('heading', {name: 'Backup & restore'}),
				).toBeVisible();
				await expectAccessible(page, '[role="dialog"]');
				await settings.getByRole('button', {name: 'Export backup'}).click();
				await expect(settings).toBeHidden();
				await expect(exportDialog(page)).toBeVisible();
				await exportDialog(page).getByRole('button', {name: 'Cancel'}).click();
				await expect(exportDialog(page)).toBeHidden();
				await expect(settingsButton(page)).toBeFocused();

				await settingsButton(page).click();
				await pickAfter(page, async () => {
					await settings.getByRole('button', {name: 'Import backup'}).click();
				}, [zipFixture('library.zip', backup)]);
				await expect(settings).toBeHidden();
				await expect(importDialog(page)).toContainText('Unchanged');
				await page.keyboard.press('Escape');
				await expect(importDialog(page)).toBeHidden();
				await expect(settingsButton(page)).toBeFocused();
			}

			// The editor's overflow menu is the phone's.
			if (viewport.name === 'phone') {
				await moreActions(page).click();
				await expect(page.getByRole('menuitem')).toHaveText([
					'Save project file',
					'Export backup',
					'Import backup',
				]);
				await expectAccessible(page, '[role="menu"]');
				await page.getByRole('menuitem', {name: 'Export backup'}).click();
				await expect(exportDialog(page)).toBeVisible();
				await page.keyboard.press('Escape');
				await expect(moreActions(page)).toBeFocused();
				await pickAfter(page, async () => {
					await moreActions(page).click();
					await page.getByRole('menuitem', {name: 'Import backup'}).click();
				}, [zipFixture('library.zip', backup)]);
				await expect(importDialog(page)).toContainText('Unchanged');
				await page.keyboard.press('Escape');
				await expect(moreActions(page)).toBeFocused();
			} else {
				await expect(moreActions(page)).toHaveCount(0);
			}

			expect(errors).toStrictEqual([]);
		});
	}
}

test('the Library menu and the dialogs work from the keyboard', async ({
	page,
}) => {
	await open(page);
	await libraryActions(page).focus();
	await page.keyboard.press('Enter');
	await expect(
		page.getByRole('menuitem', {name: 'Export backup'}),
	).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(exportDialog(page)).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(libraryActions(page)).toBeFocused();

	await settingsButton(page).focus();
	await page.keyboard.press('Enter');
	await settingsDialog(page)
		.getByRole('button', {name: 'Export backup'})
		.focus();
	await page.keyboard.press('Enter');
	await expect(exportDialog(page)).toBeVisible();
	await expect(exportDialog(page).locator(':focus')).toHaveCount(1);
	await page.keyboard.press('Escape');
	await expect(settingsButton(page)).toBeFocused();
});

for (const route of ['drop', 'picker'] as const) {
	test(`AC-F17.9: a ${route} sends a backup to its dialog and a project .zip to the Library`, async ({
		page,
	}) => {
		const errors = collectErrors(page);
		const choose = route === 'drop' ? dropImages : chooseImages;
		await open(page);
		await addProject(page, 'Night drive');
		await toLibrary(page);
		const backup = await exportFromLibrary(page);
		const project = await saveProjectFile(page, 'Night drive');
		await deleteProject(page, 'Night drive');

		await choose(page, [zipFixture('my-backup.ZIP', backup)]);
		await expect(importDialog(page)).toContainText('New');
		expect(await names(page)).toStrictEqual([]);
		await importButton(page).click();
		await expect(importDialog(page)).toBeHidden();
		await expect(projectCard(page, 'Night drive')).toBeVisible();
		await expect(page.getByText(/^Imported 1 project/)).toBeVisible();

		await choose(page, [zipFixture('one-project.zip', project)]);
		await expect(
			page.getByRole('region', {name: 'Canvas', exact: true}),
		).toBeVisible();
		await expect(importDialog(page)).toHaveCount(0);
		expect(await names(page)).toStrictEqual([
			'Night drive',
			'Night drive (imported)',
		]);
		expect(errors).toStrictEqual([]);
	});
}

test('a backup dropped on the editor opens its dialog over it', async ({
	page,
}) => {
	await open(page);
	await addProject(page, 'Night drive');
	await toLibrary(page);
	const backup = await exportFromLibrary(page);
	await page.getByRole('button', {name: /^Open Night drive/}).click();
	await expect(
		page.getByRole('region', {name: 'Canvas', exact: true}),
	).toBeVisible();

	await dropImages(page, [zipFixture('my-backup.zip', backup)]);
	await expect(importDialog(page)).toContainText('Unchanged');

	// Another drop must not replace the file under the open dialog.
	await dragOverWindow(page);
	await expect(page.getByText(DROP_COPY)).toHaveCount(0);
	await dropImages(page, [zipFixture('junk.zip', Buffer.from('junk'))]);
	await expect(importDialog(page)).toContainText('Unchanged');
	await expect(page.getByRole('alertdialog')).toHaveCount(0);

	await page.keyboard.press('Escape');
	await expect(importDialog(page)).toBeHidden();
	// Nothing had the focus when the file was dropped.
	await expect(settingsButton(page)).toBeFocused();
	await expect(
		page.getByRole('region', {name: 'Canvas', exact: true}),
	).toBeVisible();
});

test('AC-F17.9: a .zip that is neither is refused with a clear message', async ({
	page,
}) => {
	await open(page);
	const cases = [
		{
			file: zipFixture('text.zip', Buffer.from('not a zip')),
			message:
				"Can't open text.zip: the file is damaged or not a valid ZIP archive.",
		},
		{
			file: zipFixture(
				'photos.zip',
				Buffer.from(zipSync({'notes.txt': strToU8('hello')})),
			),
			message: "Can't open photos.zip: it is not a project file or a backup.",
		},
		{
			file: zipFixture(
				'other.zip',
				Buffer.from(zipSync({'manifest.json': strToU8('{"kind":"theme"}')})),
			),
			message: "Can't open other.zip: it is not a project file or a backup.",
		},
	];

	for (const choose of [dropImages, chooseImages]) {
		for (const {file, message} of cases) {
			await choose(page, [file]);
			const dialog = page.getByRole('alertdialog', {name: "Can't open file"});
			await expect(dialog).toContainText(message);
			await expectAccessible(page, '[role="alertdialog"]');
			await dialog.getByRole('button', {name: 'Dismiss'}).click();
			await expect(dialog).toBeHidden();
		}
	}

	// "Import backup" says it in the backup's own words.
	await pickAfter(page, async () => {
		await libraryActions(page).click();
		await page.getByRole('menuitem', {name: 'Import backup'}).click();
	}, [cases[1].file]);
	await expect(importDialog(page).getByRole('alert')).toHaveText(
		"Can't import backup: missing or invalid manifest.",
	);
	await importDialog(page).getByRole('button', {name: 'Close'}).click();
	await expect(libraryActions(page)).toBeFocused();
	expect(await names(page)).toStrictEqual([]);
});

test('Import backup opens a project file chosen by mistake as a project', async ({
	page,
}) => {
	await open(page);
	await addProject(page, 'Night drive');
	await toLibrary(page);
	const project = await saveProjectFile(page, 'Night drive');

	await pickAfter(page, async () => {
		await libraryActions(page).click();
		await page.getByRole('menuitem', {name: 'Import backup'}).click();
	}, [zipFixture('one-project.zip', project)]);

	await expect(
		page.getByRole('region', {name: 'Canvas', exact: true}),
	).toBeVisible();
	await expect(importDialog(page)).toHaveCount(0);
	expect(await names(page)).toStrictEqual([
		'Night drive',
		'Night drive (imported)',
	]);
});

test('a mixed batch imports the images, reports the refused files, then asks about one backup', async ({
	page,
}) => {
	await open(page);
	await addProject(page, 'Night drive');
	await toLibrary(page);
	const backup = await exportFromLibrary(page);
	const image = await makeImage(page, {
		name: 'extra.png',
		width: 40,
		height: 30,
	});

	await dropImages(page, [
		zipFixture('first.zip', backup),
		zipFixture('second.zip', backup),
		zipFixture('junk.zip', Buffer.from('junk')),
		image,
	]);

	const problems = page.getByRole('alertdialog', {name: "Can't open 2 files"});
	await expect(problems).toContainText(
		"Can't open second.zip: import one backup at a time.",
	);
	await expect(problems).toContainText(
		"Can't open junk.zip: the file is damaged or not a valid ZIP archive.",
	);
	await expect(importDialog(page)).toHaveCount(0);
	await problems.getByRole('button', {name: 'Dismiss'}).click();

	await expect(importDialog(page)).toContainText('Night drive');
	await expect(importDialog(page).locator(':focus')).toHaveCount(1);
	await page.keyboard.press('Escape');
	await expect(importDialog(page)).toBeHidden();
	expect(await names(page)).toStrictEqual(['Night drive', 'extra']);
});

test('AC-F17.10: a library round trip ends with a Replace from the editor', async ({
	page,
	browser,
	baseURL,
}) => {
	const errors = collectErrors(page);
	await open(page);
	await addProject(page, 'Night drive');
	await page.getByRole('button', {name: 'Add effect'}).first().click();
	await page.getByRole('button', {name: /^Pixel sort/}).click();
	await addProject(page, 'Harbour');
	await toLibrary(page);
	const backup = await exportFromLibrary(page);
	const entries = unzipSync(backup);
	expect(
		(JSON.parse(strFromU8(entries['manifest.json'])) as {kind: string}).kind,
	).toBe('backup');

	// A fresh browser profile gets the whole library back.
	const context = await browser.newContext({baseURL});
	const other = await context.newPage();
	await open(other);
	await pickAfter(other, async () => {
		await settingsButton(other).click();
		await settingsDialog(other)
			.getByRole('button', {name: 'Import backup'})
			.click();
	}, [zipFixture('library.zip', backup)]);
	await importButton(other).click();
	await expect(importDialog(other)).toBeHidden();
	await expect(projectCard(other, 'Night drive')).toBeVisible();
	expect(await names(other)).toStrictEqual(['Harbour', 'Night drive']);
	await context.close();

	// This one changes, then replaces everything from inside the editor.
	await deleteProject(page, 'Harbour');
	await addProject(page, 'Signal');
	await pickAfter(page, async () => {
		await settingsButton(page).click();
		await settingsDialog(page)
			.getByRole('button', {name: 'Import backup'})
			.click();
	}, [zipFixture('library.zip', backup)]);
	await importDialog(page).getByRole('radio', {name: 'Replace'}).click();
	await importButton(page).click();
	await page
		.getByRole('alertdialog', {name: 'Replace all local data?'})
		.getByRole('button', {name: 'Replace'})
		.click();

	await expect(importDialog(page)).toBeHidden();
	await expect(page).toHaveURL(/#\/(?:library)?$/);
	await expect(projectCard(page, 'Harbour')).toBeVisible();
	await expect(projectCard(page, 'Signal')).toHaveCount(0);
	await expect(page.getByText(/^Imported 2 projects/)).toBeVisible();
	await expect(settingsButton(page)).toBeFocused();
	expect(await names(page)).toStrictEqual(['Harbour', 'Night drive']);

	await page.reload();
	await expect(projectCard(page, 'Harbour')).toBeVisible();
	expect(await names(page)).toStrictEqual(['Harbour', 'Night drive']);
	expect(errors).toStrictEqual([]);
});

test.describe('backup entry points on a touch phone', () => {
	test.skip(
		({browserName}) => browserName !== 'chromium',
		'Touch emulation with a coarse pointer needs Chromium.',
	);
	test.use({
		viewport: {width: 390, height: 844},
		hasTouch: true,
		isMobile: true,
	});

	test('every entry point is at least 44 px tall', async ({page}) => {
		const expectTouchTargets = async (
			targets: ReadonlyArray<ReturnType<Page['getByRole']>>,
		) => {
			await settle(page);
			for (const target of targets) {
				const box = (await target.boundingBox())!;
				expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
			}
		};

		const items = () => [
			page.getByRole('menuitem', {name: 'Export backup'}),
			page.getByRole('menuitem', {name: 'Import backup'}),
		];

		await open(page);
		await expectTouchTargets([libraryActions(page)]);
		expect(
			(await libraryActions(page).boundingBox())!.width,
		).toBeGreaterThanOrEqual(44);
		await libraryActions(page).tap();
		await expectTouchTargets(items());
		await page.keyboard.press('Escape');

		await settingsButton(page).tap();
		await expectTouchTargets([
			settingsDialog(page).getByRole('button', {name: 'Export backup'}),
			settingsDialog(page).getByRole('button', {name: 'Import backup'}),
		]);
		await page.keyboard.press('Escape');

		await addProject(page, 'Night drive');
		await expectTouchTargets([moreActions(page)]);
		await moreActions(page).tap();
		await expectTouchTargets(items());
	});
});
