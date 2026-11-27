// Project files in the running app (product.md F25, DESIGN.md section 7.2).
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {
	expect,
	test,
	type Browser,
	type Download,
	type Page,
} from '@playwright/test';
import {strFromU8, strToU8, unzipSync, zipSync} from 'fflate';
import type {AppRuntime} from '../../src/state/index.ts';
import {assertNoA11yViolations} from './axe.ts';
import {waitForServiceWorkerControl} from './dist-server.ts';
import {
	blockFullStorage,
	chooseImages,
	dragOverWindow,
	dropImages,
	makeImage,
	readImportState,
	readSettledStorageUsage,
	withTrailingBytes,
	type ChosenFixture,
	type ImageFixture,
} from './import.ts';
import {PROOF_VIEWPORTS} from './viewports.ts';

type RuntimeGlobal = {__psgRuntime?: AppRuntime};

const NAME = 'Night drive';
const FILE_NAME = /^night-drive-\d{8}-\d{6}\.glproj$/;
const ZIP_TYPE = 'application/zip';

type Saved = {name: string; bytes: Buffer};

async function boot(page: Page): Promise<void> {
	await page.goto('/');
	await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime!;
		await runtime.ready;
	});
}

// Two effects, a transform, custom export settings and five commits.
async function seedProject(page: Page, fixture: ImageFixture): Promise<string> {
	return page.evaluate(
		async ({bytes, mimeType, name}) => {
			const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime!;
			const booted = await runtime.ready;
			if (booted.status !== 'ready') {
				throw new Error(booted.status);
			}

			const {store} = booted.bundle;
			const response = await fetch(`data:${mimeType};base64,${bytes}`);
			const blob = await response.blob();
			const bitmap = await globalThis.createImageBitmap(blob);
			const {width, height} = bitmap;
			bitmap.close();
			const {project} = await store
				.getState()
				.importImage({name, blob, width, height});
			const sort = await store.getState().addEffect('pixelSort');
			await store.getState().addEffect('channelShift');
			await store.getState().setTransform(
				project.id,
				{
					rotation: 90,
					flipX: true,
					flipY: false,
					crop: null,
					resize: null,
				},
				'Rotate',
			);
			await store.getState().commitMix(sort.id, 0.5);
			await store.getState().setEffectEnabled(sort.id, false);
			await store.getState().updateExportSettings({
				...store.getState().activeProject!.exportSettings,
				format: 'jpeg',
				quality: 61,
				sizeMode: 'half',
			});
			return project.id;
		},
		{
			bytes: fixture.buffer.toString('base64'),
			mimeType: fixture.mimeType,
			name: NAME,
		},
	);
}

// What a project file has to carry over.
async function readProject(page: Page) {
	return page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime!;
		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			throw new Error(booted.status);
		}

		const {activeProject, history} = booted.bundle.store.getState();
		if (!activeProject) {
			return null;
		}

		return {
			id: activeProject.id,
			kept: {
				name: activeProject.name,
				createdAt: activeProject.createdAt,
				updatedAt: activeProject.updatedAt,
				sourceHash: activeProject.sourceHash,
				sourceWidth: activeProject.sourceWidth,
				sourceHeight: activeProject.sourceHeight,
				transform: activeProject.transform,
				stack: activeProject.stack,
				exportSettings: activeProject.exportSettings,
				historyHeadSeq: activeProject.historyHeadSeq,
			},
			history: history.map(({seq, label}) => ({seq, label})),
		};
	});
}

async function openLibrary(page: Page): Promise<void> {
	await page.getByRole('button', {name: 'Back to library'}).click();
	await expect(
		page.getByRole('button', {name: `Actions for ${NAME}`}),
	).toBeVisible();
}

async function openSaveFromCard(page: Page): Promise<void> {
	await page.getByRole('button', {name: `Actions for ${NAME}`}).click();
	await page.getByRole('menuitem', {name: 'Save project file'}).click();
}

const saveDialog = (page: Page) =>
	page.getByRole('dialog', {name: 'Save project file'});

async function save(page: Page): Promise<Saved> {
	const downloading: Promise<Download> = page.waitForEvent('download');
	await saveDialog(page).getByRole('button', {name: 'Save'}).click();
	const download = await downloading;
	await expect(saveDialog(page)).toBeHidden();
	return {
		name: download.suggestedFilename(),
		bytes: await readFile(await download.path()),
	};
}

// Saves a seeded project from its library card.
async function seededFile(
	page: Page,
	{
		includeHistory = true,
		fixture,
	}: {
		includeHistory?: boolean;
		fixture?: ImageFixture;
	} = {},
) {
	await boot(page);
	const image =
		fixture ??
		(await makeImage(page, {name: 'drive.png', width: 400, height: 300}));
	await seedProject(page, image);
	const original = (await readProject(page))!;
	await openLibrary(page);
	await openSaveFromCard(page);
	if (!includeHistory) {
		await saveDialog(page)
			.getByRole('checkbox', {name: 'Include undo history'})
			.click();
	}

	return {file: await save(page), original, image};
}

const asFixture = ({name, bytes}: Saved): ChosenFixture => ({
	name,
	mimeType: ZIP_TYPE,
	buffer: bytes,
});

async function freshPage(browser: Browser, baseURL: string): Promise<Page> {
	const context = await browser.newContext({baseURL, acceptDownloads: true});
	const page = await context.newPage();
	await boot(page);
	return page;
}

async function expectRefused(
	page: Page,
	fixture: ChosenFixture,
	message: string,
): Promise<void> {
	await dropImages(page, [fixture]);
	const dialog = page.getByRole('alertdialog', {name: "Can't open project"});
	await expect(dialog).toContainText(message);
	await dialog.getByRole('button', {name: 'Dismiss'}).click();
	await expect(dialog).toBeHidden();
	expect((await readImportState(page)).projects).toHaveLength(0);
}

// The saved archive with some entries changed; `undefined` removes one.
function edited(
	{bytes}: Saved,
	edit: (entries: Record<string, Uint8Array>) => void,
): Buffer {
	const entries = unzipSync(bytes);
	edit(entries);
	return Buffer.from(zipSync(entries));
}

function editJson<T>(
	entries: Record<string, Uint8Array>,
	path: string,
	edit: (value: T) => void,
): void {
	const value = JSON.parse(strFromU8(entries[path])) as T;
	edit(value);
	entries[path] = strToU8(JSON.stringify(value));
}

const sourcePath = (entries: Record<string, Uint8Array>) =>
	Object.keys(entries).find((path) => path.startsWith('sources/'))!;

test('AC-F25.1: the card menu saves a .glproj with the layout and the exact source bytes', async ({
	page,
}) => {
	const {file, image} = await seededFile(page);

	expect(file.name).toMatch(FILE_NAME);
	const entries = unzipSync(file.bytes);
	const sha256 = createHash('sha256').update(image.buffer).digest('hex');
	const names = Object.keys(entries).filter(
		(path) => !path.startsWith('thumbnail.'),
	);
	expect(names.toSorted()).toStrictEqual([
		'history.json',
		'manifest.json',
		'project.json',
		`sources/${sha256}.png`,
	]);
	expect(
		Buffer.from(entries[`sources/${sha256}.png`]).equals(image.buffer),
	).toBe(true);
	const history = JSON.parse(strFromU8(entries['history.json'])) as {
		entries: unknown[];
	};
	expect(history.entries).toHaveLength(6);
	await expect(
		page.getByRole('button', {name: `Actions for ${NAME}`}),
	).toBeFocused();
});

for (const route of ['picker', 'drop'] as const) {
	test(`AC-F25.2: a fresh profile opens the file by ${route} with every undo step`, async ({
		page,
		browser,
		baseURL,
	}) => {
		const {file, original} = await seededFile(page);
		const other = await freshPage(browser, baseURL!);

		if (route === 'picker') {
			await chooseImages(other, [asFixture(file)]);
		} else {
			await dragOverWindow(other);
			await expect(
				other.getByText('Drop images or project files to open'),
			).toBeVisible();
			await dropImages(other, [asFixture(file)]);
		}

		await expect(other).toHaveURL(/#\/p\//);
		await expect.poll(async () => readProject(other)).not.toBeNull();
		await expect
			.poll(async () => (await readProject(other))?.history.length)
			.toBe(6);
		const opened = (await readProject(other))!;
		expect(opened.kept).toStrictEqual(original.kept);
		expect(opened.history).toStrictEqual(original.history);
		expect(opened.id).not.toBe(original.id);
		for (let step = 0; step < 5; step++) {
			await other.getByRole('button', {name: /^Undo/}).click();
			await expect
				.poll(async () => (await readProject(other))?.kept.historyHeadSeq)
				.toBe(4 - step);
		}

		await other.context().close();
	});
}

test('AC-F25.3: without undo history the file has none and opens with one Initial step', async ({
	page,
	browser,
	baseURL,
}) => {
	const {file, original} = await seededFile(page, {includeHistory: false});
	expect(Object.keys(unzipSync(file.bytes))).not.toContain('history.json');
	const other = await freshPage(browser, baseURL!);

	await dropImages(other, [asFixture(file)]);

	await expect
		.poll(async () => (await readProject(other))?.history)
		.toStrictEqual([{seq: 0, label: 'Initial'}]);
	const opened = (await readProject(other))!;
	expect(opened.kept.stack).toStrictEqual(original.kept.stack);
	expect(opened.kept.transform).toStrictEqual(original.kept.transform);
	await other.context().close();
});

test('AC-F25.4: opening a saved project again reuses the source and renames the copy', async ({
	page,
}) => {
	await boot(page);
	const photo = withTrailingBytes(
		await makeImage(page, {
			name: 'drive.jpg',
			width: 400,
			height: 300,
			type: 'image/jpeg',
		}),
		30 * 1024 * 1024,
	);
	const {file} = await seededFile(page, {fixture: photo});
	const before = await readSettledStorageUsage(page);

	await dropImages(page, [asFixture(file)]);

	await expect
		.poll(async () => (await readImportState(page)).activeProjectName)
		.toBe(`${NAME} (imported)`);
	const state = await readImportState(page);
	expect(state.projects).toHaveLength(2);
	expect(state.sourceCount).toBe(1);
	expect((await readSettledStorageUsage(page)) - before).toBeLessThan(
		photo.buffer.length / 100,
	);
});

test('AC-F25.5 to 25.7: refused files show the exact message and create nothing', async ({
	page,
	browser,
	baseURL,
}) => {
	const {file} = await seededFile(page);
	const other = await freshPage(browser, baseURL!);
	const entries = unzipSync(file.bytes);
	const path = sourcePath(entries);
	const fixture = (name: string, buffer: Buffer) => ({
		name,
		mimeType: ZIP_TYPE,
		buffer,
	});

	await expectRefused(
		other,
		fixture('text.glproj', Buffer.from('not a zip')),
		"Can't open text.glproj: the file is damaged or not a valid project archive.",
	);
	await expectRefused(
		other,
		fixture('cut.glproj', file.bytes.subarray(0, file.bytes.length / 2)),
		"Can't open cut.glproj: the file is damaged or not a valid project archive.",
	);
	await expectRefused(
		other,
		fixture(
			'gone.glproj',
			edited(file, (all) => {
				Reflect.deleteProperty(all, path);
			}),
		),
		`Can't open gone.glproj: missing image data (${path}).`,
	);
	await expectRefused(
		other,
		fixture(
			'flip.glproj',
			edited(file, (all) => {
				all[path][100] = (all[path][100] + 1) % 256;
			}),
		),
		`Can't open flip.glproj: image data is damaged (${path}).`,
	);
	await expectRefused(
		other,
		fixture(
			'new.zip',
			edited(file, (all) => {
				editJson<{formatVersion: number}>(all, 'manifest.json', (manifest) => {
					manifest.formatVersion = 3;
				});
			}),
		),
		"Can't open new.zip: project format version 3 is newer than this app supports. Update the app and try again.",
	);
	await other.context().close();
});

test('AC-F25.5: the picker shows the same dialog', async ({page}) => {
	await boot(page);

	await chooseImages(page, [
		{name: 'bad.glproj', mimeType: ZIP_TYPE, buffer: Buffer.from('no')},
	]);

	await expect(
		page.getByRole('alertdialog', {name: "Can't open project"}),
	).toContainText(
		"Can't open bad.glproj: the file is damaged or not a valid project archive.",
	);
});

test('AC-F25.8: unknown effects are kept and a notice counts them', async ({
	page,
	browser,
	baseURL,
}) => {
	const {file} = await seededFile(page, {includeHistory: false});
	const unknown = edited(file, (all) => {
		editJson<{stack: {instances: Array<{type: string; version: number}>}}>(
			all,
			'project.json',
			({stack}) => {
				stack.instances[0].type = 'fromTheFuture';
				stack.instances[1].version = 99;
			},
		);
	});
	const other = await freshPage(browser, baseURL!);

	await dropImages(other, [
		{name: 'future.glproj', mimeType: ZIP_TYPE, buffer: unknown},
	]);

	await expect(
		other.getByText(`Opened ${NAME} with 2 unsupported effect(s).`),
	).toBeVisible();
	await expect(other).toHaveURL(/#\/p\//);
	const opened = (await readProject(other))!;
	expect(
		(opened.kept.stack.instances as Array<{type: string}>).map(
			({type}) => type,
		),
	).toStrictEqual(['fromTheFuture', 'channelShift']);
	await other.context().close();
});

test('a full quota shows the Storage is full dialog and stores nothing', async ({
	page,
	browser,
	baseURL,
}) => {
	const {file} = await seededFile(page);
	const context = await browser.newContext({baseURL});
	const other = await context.newPage();
	await blockFullStorage(other);
	await boot(other);

	await dropImages(other, [asFixture(file)]);

	await expect(
		other.getByRole('alertdialog', {name: 'Storage is full'}),
	).toBeVisible();
	expect((await readImportState(other)).projects).toHaveLength(0);
	await context.close();
});

test('Cancel stops a save, downloads nothing and returns to the form', async ({
	page,
}) => {
	// Holds the save request back from the archive worker until it is cancelled.
	await page.addInitScript(() => {
		const post = Worker.prototype.postMessage;
		const {terminate} = Worker.prototype;
		const held = new Set<Worker>();
		const counts = {held: 0, terminated: 0};
		Object.defineProperty(globalThis, '__saves', {value: counts});
		Object.defineProperties(Worker.prototype, {
			postMessage: {
				value(this: Worker, message: {type?: string}) {
					if (message.type === 'writeProject') {
						held.add(this);
						counts.held++;
						return;
					}

					post.call(this, message);
				},
			},
			terminate: {
				value(this: Worker) {
					if (held.has(this)) {
						counts.terminated++;
					}

					terminate.call(this);
				},
			},
		});
	});
	const saves = async () =>
		page.evaluate(
			() =>
				(
					globalThis as unknown as {
						__saves: {held: number; terminated: number};
					}
				).__saves,
		);
	await boot(page);
	await seedProject(
		page,
		await makeImage(page, {name: 'drive.png', width: 400, height: 300}),
	);
	let downloads = 0;
	page.on('download', () => {
		downloads++;
	});
	const trigger = page.getByRole('button', {name: 'Save project file'});
	await trigger.click();
	await saveDialog(page).getByRole('button', {name: 'Save'}).click();
	await expect(
		saveDialog(page).getByRole('progressbar', {name: 'Save progress'}),
	).toBeVisible();

	await saveDialog(page).getByRole('button', {name: 'Cancel'}).click();

	await expect(
		saveDialog(page).getByRole('button', {name: 'Save'}),
	).toBeVisible();
	await expect(saveDialog(page).getByRole('progressbar')).toBeHidden();
	// Closing during a save stops it too.
	await saveDialog(page).getByRole('button', {name: 'Save'}).click();
	await expect.poll(async () => (await saves()).held).toBe(2);
	await page.keyboard.press('Escape');
	await expect(saveDialog(page)).toBeHidden();
	await expect(trigger).toBeFocused();
	expect(await saves()).toStrictEqual({held: 2, terminated: 2});
	expect(downloads).toBe(0);
});

test('AC-F25.9: a 50 MP project saves and opens offline without full-size pixel reads', async ({
	page,
	context,
}) => {
	test.setTimeout(120_000);
	// Records the largest pixel read the main thread makes.
	await page.addInitScript(() => {
		Object.assign(globalThis, {__largestRead: 0});
		for (const type of [
			CanvasRenderingContext2D,
			OffscreenCanvasRenderingContext2D,
		]) {
			const read = type.prototype.getImageData;
			type.prototype.getImageData = function (
				this: never,
				...args: Parameters<typeof read>
			) {
				const store = globalThis as unknown as {__largestRead: number};
				store.__largestRead = Math.max(store.__largestRead, args[2] * args[3]);
				return read.apply(this, args);
			};
		}
	});
	await boot(page);
	await waitForServiceWorkerControl(page);
	const photo = await makeImage(page, {
		name: 'large.jpg',
		width: 8000,
		height: 6250,
		type: 'image/jpeg',
	});
	await seedProject(page, photo);
	await openLibrary(page);

	const requests: string[] = [];
	context.on('request', (request) => {
		const url = request.url();
		if (!url.startsWith('blob:') && !url.startsWith('data:')) {
			requests.push(url);
		}
	});
	await context.setOffline(true);
	await openSaveFromCard(page);
	const file = await save(page);
	await dropImages(page, [asFixture(file)]);
	await expect
		.poll(async () => (await readImportState(page)).activeProjectName)
		.toBe(`${NAME} (imported)`);
	// The same file on a library without the source, so it is probed and stored.
	await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime!;
		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			throw new Error(booted.status);
		}

		const {store} = booted.bundle;
		for (const {id} of store.getState().projects) {
			await store.getState().deleteProject(id);
		}
	});
	await dropImages(page, [asFixture(file)]);
	await expect
		.poll(async () => (await readImportState(page)).activeProjectName)
		.toBe(NAME);
	expect((await readImportState(page)).sourceCount).toBe(1);

	// Only the app's own files, which the service worker answers offline.
	const {origin} = new URL(page.url());
	expect(
		requests.filter(
			(url) =>
				new URL(url).origin !== origin ||
				!new URL(url).pathname.startsWith('/assets/'),
		),
	).toStrictEqual([]);
	expect(
		await page.evaluate(
			() => (globalThis as unknown as {__largestRead: number}).__largestRead,
		),
	).toBeLessThan(8000 * 6250);
	await context.setOffline(false);
});

for (const viewport of PROOF_VIEWPORTS) {
	for (const theme of ['light', 'dark'] as const) {
		test(`the save action fits and works at ${viewport.name} width, ${theme} @a11y`, async ({
			page,
		}) => {
			await page.emulateMedia({colorScheme: theme});
			await page.setViewportSize(viewport);
			await boot(page);
			await seedProject(
				page,
				await makeImage(page, {name: 'drive.png', width: 400, height: 300}),
			);
			const isPhone = viewport.name === 'phone';
			const toolbar = page.getByRole('toolbar', {name: 'Editor actions'});
			await expect(toolbar).toBeVisible();

			if (isPhone) {
				await expect(
					toolbar.getByRole('button', {name: 'Save project file'}),
				).toHaveCount(0);
				await expect(toolbar.getByRole('button')).toHaveCount(7);
				const more = page.getByRole('button', {name: 'More actions'});
				const box = (await more.boundingBox())!;
				expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
				await more.click();
				await page.getByRole('menuitem', {name: 'Save project file'}).click();
			} else {
				await expect(
					page.getByRole('button', {name: 'More actions'}),
				).toHaveCount(0);
				await toolbar.getByRole('button', {name: 'Save project file'}).click();
			}

			await expect(
				saveDialog(page).getByRole('checkbox', {name: 'Include undo history'}),
			).toBeChecked();
			expect(
				await page.evaluate(
					() =>
						globalThis.document.documentElement.scrollWidth <=
						globalThis.document.documentElement.clientWidth,
				),
			).toBe(true);
			// The dialog animates in; the scan needs it opaque.
			await page.waitForFunction(() =>
				globalThis.document
					.getAnimations()
					.every((item) => item.playState !== 'running'),
			);
			await assertNoA11yViolations(page, {include: ['[role="dialog"]']});
			const file = await save(page);
			expect(file.name).toMatch(FILE_NAME);
		});
	}
}
