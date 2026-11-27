/**
 The backup dialogs (product.md F17, DESIGN.md section 7.2), opened from the
 dev gallery. Their app entry points are in backup-entry.spec.ts.
 */
import {Buffer} from 'node:buffer';
import {readFile} from 'node:fs/promises';
import {expect, test, type Download, type Page} from '@playwright/test';
import {strFromU8, strToU8, unzipSync, zipSync, type Unzipped} from 'fflate';
import type {AppRuntime} from '../../src/state/index.ts';
import {assertNoA11yViolations} from './axe.ts';
import {seedLibraryProjects} from './library-seed.ts';
import {PROOF_VIEWPORTS} from './viewports.ts';

type RuntimeGlobal = {
	__psgRuntime?: AppRuntime;
};

const NAMES = ['Night Drive', 'Harbour', 'Signal'];

async function openGallery(page: Page): Promise<void> {
	await page.goto('/#/dev/gallery');
	await expect(
		page.getByRole('button', {name: 'Back up library'}),
	).toBeVisible();
}

// Three projects, one preset and the compare mode a backup carries.
async function seed(page: Page): Promise<string[]> {
	await openGallery(page);
	const ids = await seedLibraryProjects(page, NAMES);
	await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime!.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		const {store} = booted.bundle;
		const [first] = store.getState().projects;
		await store.getState().openProject(first.id);
		await store.getState().addEffect('pixelSort');
		await store.getState().saveStackAsPreset('Dusk');
		await store.getState().closeProject();
		globalThis.location.hash = '#/dev/gallery';
	});
	await expect(
		page.getByRole('button', {name: 'Back up library'}),
	).toBeVisible();
	return ids;
}

async function readLibrary(
	page: Page,
): Promise<{projects: string[]; presets: string[]}> {
	return page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime!.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		const snapshot = await booted.bundle.repository.getStartupSnapshot();
		return {
			projects: snapshot.projects.map((project) => project.name).toSorted(),
			presets: snapshot.presets.map((preset) => preset.name).toSorted(),
		};
	});
}

// Renames "Harbour" and deletes "Signal", so a backup of the seed holds one
// modified, one unchanged and one new project.
async function changeLibrary(page: Page, ids: string[]): Promise<void> {
	await page.evaluate(
		async ([renamed, deleted]) => {
			const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
			const booted = await runtime!.ready;
			if (booted.status !== 'ready') {
				throw new Error('Not ready');
			}

			const {store} = booted.bundle;
			await store.getState().renameProject(renamed, 'Harbour local');
			await store.getState().deleteProject(deleted);
		},
		[ids[1], ids[2]],
	);
}

const exportDialog = (page: Page) =>
	page.getByRole('dialog', {name: 'Export backup'});
const importDialog = (page: Page) =>
	page.getByRole('dialog', {name: 'Import backup'});
const row = (page: Page, name: string) =>
	page.getByRole('checkbox', {name: new RegExp(`^${name}`)});
// The whole row, which carries the text and the touch target.
const rowText = (page: Page, name: string) =>
	page
		.locator('[data-slot="check-row"]')
		.filter({hasText: new RegExp(`^${name}`)});

async function openExport(page: Page) {
	await page.getByRole('button', {name: 'Back up library'}).click();
	const dialog = exportDialog(page);
	await expect(dialog).toContainText(/Estimated image data: [\d.]+ [KM]?B/);
	return dialog;
}

async function download(page: Page): Promise<Download> {
	const pending = page.waitForEvent('download');
	await exportDialog(page).getByRole('button', {name: 'Export backup'}).click();
	return pending;
}

async function entriesOf(file: Download): Promise<Unzipped> {
	return unzipSync(await readFile(await file.path()));
}

const jsonOf = (bytes: Uint8Array) =>
	JSON.parse(strFromU8(bytes)) as Record<string, unknown>;

async function backupOfEverything(page: Page): Promise<Buffer> {
	await openExport(page);
	const file = await download(page);
	await expect(exportDialog(page)).toBeHidden();
	return readFile(await file.path());
}

async function chooseFile(page: Page, buffer: Buffer): Promise<void> {
	await page.getByTestId('backup-file').setInputFiles({
		name: 'glitch-backup.zip',
		mimeType: 'application/zip',
		buffer,
	});
	await expect(importDialog(page)).toBeVisible();
}

// The archive worker never starts, so a backup stays in its first stage.
async function stallArchiveWorker(page: Page): Promise<void> {
	await page.route(/archive\.worker.*\.js$/, () => {});
}

type Release = {releaseImport: () => void};

// Holds the next import back until `releaseImport`.
async function stallImport(page: Page): Promise<void> {
	await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime!.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		const {store} = booted.bundle;
		const {importBackup} = store.getState();
		const held = Promise.withResolvers<void>();
		Object.assign(globalThis, {
			releaseImport() {
				held.resolve();
			},
		});

		store.setState({
			async importBackup(...args) {
				await held.promise;
				return importBackup(...args);
			},
		});
	});
}

async function releaseImport(page: Page): Promise<void> {
	await page.evaluate(() => {
		(globalThis as unknown as Release).releaseImport();
	});
}

function collectErrors(page: Page): string[] {
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

test.describe('backup dialogs', () => {
	// A service worker would answer before the stalled route does.
	test.use({serviceWorkers: 'block'});

	test('AC-F17.1: exports only the chosen projects and parts', async ({
		page,
	}) => {
		const errors = collectErrors(page);
		const ids = await seed(page);
		const dialog = await openExport(page);

		await dialog.getByRole('button', {name: 'Select none'}).click();
		await expect(dialog).toContainText('Estimated image data: 0 B');
		await row(page, 'Night Drive').click();
		await row(page, 'Signal').click();
		await row(page, 'Include undo history').click();
		await row(page, 'Include settings').click();
		const file = await download(page);

		expect(file.suggestedFilename()).toMatch(
			/^glitch-backup-\d{8}-\d{6}\.zip$/,
		);
		const entries = await entriesOf(file);
		const paths = Object.keys(entries);
		expect(paths).toContain('presets.json');
		expect(paths).not.toContain('settings.json');
		expect(paths.filter((path) => path.endsWith('history.json'))).toStrictEqual(
			[],
		);
		const exported = paths
			.filter((path) => path.endsWith('project.json'))
			.map((path) => jsonOf(entries[path]).id as string);
		expect(exported.toSorted()).toStrictEqual([ids[0], ids[2]].toSorted());
		await expect(dialog).toBeHidden();
		await expect(
			page.getByText(`Downloaded ${file.suggestedFilename()}.`),
		).toBeVisible();
		await expect(
			page.getByRole('button', {name: 'Back up library'}),
		).toBeFocused();
		expect(errors).toStrictEqual([]);
	});

	test('AC-F17.2 & AC-F17.3: previews statuses and merges only the checked projects', async ({
		page,
	}) => {
		const errors = collectErrors(page);
		const ids = await seed(page);
		const backup = await backupOfEverything(page);
		await changeLibrary(page, ids);

		await chooseFile(page, backup);
		const dialog = importDialog(page);
		await expect(rowText(page, 'Night Drive')).toContainText('Unchanged');
		await expect(row(page, 'Night Drive')).not.toBeChecked();
		await expect(rowText(page, 'Harbour')).toContainText('Modified locally');
		await expect(rowText(page, 'Signal')).toContainText('New');
		await expect(rowText(page, 'User presets')).toContainText('(1)');
		await expect(row(page, 'User presets')).toBeChecked();
		await expect(row(page, 'Settings')).toBeChecked();
		await row(page, 'Harbour').click();
		await dialog.getByRole('button', {name: 'Import', exact: true}).click();

		await expect(dialog).toBeHidden();
		await expect(
			page.getByText('Imported 1 project. Applied settings.'),
		).toBeVisible();
		expect(await readLibrary(page)).toStrictEqual({
			projects: ['Harbour local', 'Night Drive', 'Signal'],
			presets: ['Dusk'],
		});
		expect(errors).toStrictEqual([]);
	});

	test('AC-F17.4: Replace asks first and replaces only on confirmation', async ({
		page,
	}) => {
		const ids = await seed(page);
		const backup = await backupOfEverything(page);
		await changeLibrary(page, ids);
		const before = await readLibrary(page);

		await chooseFile(page, backup);
		const dialog = importDialog(page);
		await dialog.getByRole('radio', {name: 'Replace'}).click();
		await expect(row(page, 'Night Drive')).toBeChecked();
		await row(page, 'Night Drive').click();
		const importButton = dialog.getByRole('button', {
			name: 'Import',
			exact: true,
		});
		await importButton.click();
		const confirmation = page.getByRole('alertdialog', {
			name: 'Replace all local data?',
		});
		await expect(confirmation).toContainText(
			'This deletes 2 existing project(s) and 1 user preset(s) on this device before importing.',
		);
		await assertNoA11yViolations(page);
		await confirmation.getByRole('button', {name: 'Cancel'}).click();
		await expect(confirmation).toBeHidden();
		await expect(importButton).toBeFocused();
		expect(await readLibrary(page)).toStrictEqual(before);

		await importButton.click();
		await stallImport(page);
		await confirmation.getByRole('button', {name: 'Replace'}).click();
		await expect(confirmation).toBeHidden();
		await expect(dialog.getByRole('button', {name: 'Cancel'})).toBeFocused();
		await releaseImport(page);

		await expect(dialog).toBeHidden();
		expect(await readLibrary(page)).toStrictEqual({
			projects: ['Harbour', 'Signal'],
			presets: ['Dusk'],
		});
	});

	test('AC-F17.5: Cancel stops an export and a check and changes nothing', async ({
		page,
	}) => {
		await seed(page);
		const backup = await backupOfEverything(page);
		const before = await readLibrary(page);
		await page.reload();
		await stallArchiveWorker(page);
		let downloads = 0;
		page.on('download', () => {
			downloads++;
		});

		const exporting = await openExport(page);
		await exporting.getByRole('button', {name: 'Export backup'}).click();
		await expect(
			exporting.getByRole('progressbar', {name: 'Packing'}),
		).toBeVisible();
		await expect(row(page, 'Signal')).toBeDisabled();
		await expect(exporting.getByRole('button', {name: 'Cancel'})).toBeFocused();
		await exporting.getByRole('button', {name: 'Cancel'}).click();
		await expect(exporting.getByRole('progressbar')).toBeHidden({
			timeout: 1000,
		});
		await expect(row(page, 'Signal')).toBeEnabled();
		await page.keyboard.press('Escape');
		await expect(exporting).toBeHidden();

		await chooseFile(page, backup);
		const checking = importDialog(page);
		await expect(
			checking.getByRole('progressbar', {name: 'Validating'}),
		).toBeVisible();
		await checking.getByRole('button', {name: 'Cancel'}).click();
		await expect(checking).toBeHidden({timeout: 1000});

		expect(downloads).toBe(0);
		expect(await readLibrary(page)).toStrictEqual(before);
	});

	test('AC-F17.7: shows the exact message for a refused file and writes nothing', async ({
		page,
	}) => {
		await seed(page);
		const backup = await backupOfEverything(page);
		const before = await readLibrary(page);
		const files = unzipSync(backup);
		const manifest = jsonOf(files['manifest.json']);
		const newer = Buffer.from(
			zipSync({
				...files,
				'manifest.json': strToU8(
					JSON.stringify({...manifest, backupVersion: 3}),
				),
			}),
		);
		const cases = [
			{
				file: Buffer.from('not a zip'),
				message:
					"Can't import backup: the file is damaged or not a valid ZIP archive.",
			},
			{
				file: newer,
				message:
					"Can't import backup: format version 3 is newer than this app supports. Update the app and try again.",
			},
		];

		for (const {file, message} of cases) {
			await chooseFile(page, file);
			const dialog = importDialog(page);
			await expect(dialog.getByRole('alert')).toHaveText(message);
			await assertNoA11yViolations(page);
			await dialog.getByRole('button', {name: 'Close'}).click();
			await expect(dialog).toBeHidden();
		}

		expect(await readLibrary(page)).toStrictEqual(before);
	});

	test('D44: refuses an export it could not import', async ({page}) => {
		await openGallery(page);
		await page.evaluate(async () => {
			const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
			const booted = await runtime!.ready;
			if (booted.status !== 'ready') {
				throw new Error('Not ready');
			}

			// One byte over the 200 MB limit of a stored image.
			const megabyte = new Uint8Array(1024 * 1024);
			await booted.bundle.store.getState().importImage({
				name: 'Huge',
				blob: new Blob(
					[...Array.from({length: 200}, () => megabyte), new Uint8Array(1)],
					{type: 'image/png'},
				),
				width: 8,
				height: 8,
				setActive: false,
			});
		});

		const dialog = await openExport(page);
		await expect(dialog).toContainText('Estimated image data: 200.0 MB');
		await dialog.getByRole('button', {name: 'Export backup'}).click();

		await expect(dialog.getByRole('alert')).toHaveText(
			"Can't export backup: it is too large (limit is 4 GB, or 200 MB per image). Select fewer projects or leave out undo history.",
		);
		await assertNoA11yViolations(page);
	});
});

const THEMES = [
	{name: 'light', media: 'light', background: 'rgb(250, 250, 250)'},
	{name: 'true-black', media: 'dark', background: 'rgb(0, 0, 0)'},
] as const;

// Long enough that the dialog body has to scroll at every size.
const MANY = Array.from({length: 18}, (_, index) =>
	index === 0
		? 'A project with a very long name that must truncate instead of widening the dialog'
		: `Photo ${index}`,
);

async function settle(page: Page): Promise<void> {
	await page.evaluate(async () => {
		await Promise.allSettled(
			globalThis.document
				.getAnimations()
				.map(async (animation) => animation.finished),
		);
	});
}

// The dialog fits the viewport, its footer stays on screen and nothing scrolls
// sideways.
async function expectFits(page: Page, name: string): Promise<void> {
	const dialog = page.getByRole('dialog', {name});
	await settle(page);
	const viewport = page.viewportSize()!;
	for (const target of [dialog, dialog.getByRole('button', {name: 'Cancel'})]) {
		const box = (await target.boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.y).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
		expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
	}

	const overflow = await dialog
		.locator('[data-slot="scroll-area-viewport"]')
		.evaluate((element) => element.scrollWidth - element.clientWidth);
	expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('backup dialogs layout @a11y', () => {
	for (const theme of THEMES) {
		for (const viewport of [
			...PROOF_VIEWPORTS,
			{name: 'phone landscape', width: 844, height: 390},
		]) {
			test(`both dialogs fit and are axe-clean in ${theme.name} at ${viewport.name}`, async ({
				page,
			}) => {
				const errors = collectErrors(page);
				await page.emulateMedia({colorScheme: theme.media});
				await page.setViewportSize(viewport);
				await openGallery(page);
				const ids = await seedLibraryProjects(page, MANY);
				await expect(page.locator('body')).toHaveCSS(
					'background-color',
					theme.background,
				);

				const exporting = await openExport(page);
				await expectFits(page, 'Export backup');
				await assertNoA11yViolations(page);
				const last = exporting.getByText('Estimated image data');
				await last.scrollIntoViewIfNeeded();
				await expect(last).toBeInViewport();
				const file = await download(page);

				await page.evaluate(async (id) => {
					const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
					const booted = await runtime!.ready;
					if (booted.status !== 'ready') {
						throw new Error('Not ready');
					}

					await booted.bundle.store.getState().deleteProject(id);
				}, ids[1]);
				await chooseFile(page, await readFile(await file.path()));
				await expect(rowText(page, 'Photo 164 ×')).toContainText('New');
				await expectFits(page, 'Import backup');
				await assertNoA11yViolations(page);
				expect(errors).toStrictEqual([]);
			});
		}
	}
});

test.describe('backup dialogs on a touch phone', () => {
	test.skip(
		({browserName}) => browserName !== 'chromium',
		'Touch emulation with a coarse pointer needs Chromium.',
	);
	test.use({
		viewport: {width: 390, height: 844},
		hasTouch: true,
		isMobile: true,
	});

	test('every control is at least 44 px tall', async ({page}) => {
		await seed(page);
		const targets = async (name: string) => {
			await settle(page);
			// A checkbox is reached through its row.
			const controls = page
				.getByRole('dialog', {name})
				.locator(
					'button:not([role="checkbox"]):visible, [data-slot="check-row"]',
				);
			expect(await controls.count()).toBeGreaterThan(3);
			for (const control of await controls.all()) {
				const box = (await control.boundingBox())!;
				expect(
					Math.round(box.height),
					(await control.textContent()) ?? '',
				).toBeGreaterThanOrEqual(44);
			}
		};

		const backup = await (async () => {
			await openExport(page);
			await targets('Export backup');
			const file = await download(page);
			return readFile(await file.path());
		})();
		await chooseFile(page, backup);
		await expect(row(page, 'Signal')).toBeVisible();
		await targets('Import backup');
		await importDialog(page).getByRole('radio', {name: 'Replace'}).tap();
		await importDialog(page)
			.getByRole('button', {name: 'Import', exact: true})
			.tap();
		await settle(page);
		for (const control of await page
			.getByRole('alertdialog')
			.getByRole('button')
			.all()) {
			expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		}
	});
});
