// Acceptance for v0.3.0 (docs/specs/acceptance-v0.3.0.md): projects that blend
// images travel through project files and backups (product.md F17, F25, F26),
// also offline at 50 MP.
import {type Buffer} from 'node:buffer';
import {readFile} from 'node:fs/promises';
import {
	expect,
	test,
	type Browser,
	type Download,
	type Page,
} from '@playwright/test';
import {strFromU8, unzipSync} from 'fflate';
import {imageBlendSpec} from '../../src/engine/effects/image-blend-spec.ts';
import {defaultParams} from '../../src/engine/params.ts';
import type {
	EffectInstance,
	EffectStack,
	ParamValue,
} from '../../src/engine/types.ts';
import type {AppRuntime} from '../../src/state/index.ts';
import {decodeRgbaPng} from '../golden/helpers.ts';
import {waitForServiceWorkerControl} from './dist-server.ts';
import {
	blockFullStorage,
	chooseImages,
	dropImages,
	makeImage,
	readImportState,
	type ChosenFixture,
	type ImageFixture,
} from './import.ts';
import {
	builtAsset,
	openRenderPage,
	pixelSortStack,
	sha256,
	type PageHelpers,
} from './render-fixtures.ts';
import {waitForSettleRender} from './settle.ts';

type RuntimeGlobal = {__psgRuntime?: AppRuntime};
type PageScope = {renderTest: PageHelpers};

const ZIP_TYPE = 'application/zip';

function trackProblems(page: Page): string[] {
	const problems: string[] = [];
	page.on('pageerror', (error) => {
		problems.push(error.message);
	});
	page.on('console', (message) => {
		// Leaving the Library revokes a card thumbnail that may still be loading.
		if (
			message.type() === 'error' &&
			!message.location().url.startsWith('blob:')
		) {
			problems.push(message.text());
		}
	});
	return problems;
}

async function boot(page: Page): Promise<void> {
	// Keeps the picker intercepted for the whole test: Firefox can miss a click
	// that follows straight on a new subscription.
	page.on('filechooser', () => {});
	await page.goto('/');
	await page.evaluate(async () => {
		await (globalThis as unknown as RuntimeGlobal).__psgRuntime!.ready;
	});
}

async function freshPage(browser: Browser, baseURL: string): Promise<Page> {
	const context = await browser.newContext({baseURL, acceptDownloads: true});
	const page = await context.newPage();
	await boot(page);
	return page;
}

// Stores a picture as a project and returns the project's id and source hash.
async function addProject(
	page: Page,
	fixture: ImageFixture,
	opened: boolean,
): Promise<{id: string; hash: string}> {
	return page.evaluate(
		async (input) => {
			const booted = await (globalThis as unknown as RuntimeGlobal)
				.__psgRuntime!.ready;
			if (booted.status !== 'ready') {
				throw new Error(booted.status);
			}

			const response = await fetch(
				`data:${input.mimeType};base64,${input.bytes}`,
			);
			const blob = await response.blob();
			const bitmap = await globalThis.createImageBitmap(blob);
			const {width, height} = bitmap;
			bitmap.close();
			const {project, source} = await booted.bundle.store
				.getState()
				.importImage({
					name: input.name,
					blob,
					width,
					height,
					setActive: input.opened,
				});
			return {id: project.id, hash: source.sha256};
		},
		{
			bytes: fixture.buffer.toString('base64'),
			mimeType: fixture.mimeType,
			name: fixture.name,
			opened,
		},
	);
}

async function deleteProjects(page: Page, ids: string[]): Promise<void> {
	await page.evaluate(async (list) => {
		const booted = await (globalThis as unknown as RuntimeGlobal).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error(booted.status);
		}

		for (const id of list) {
			await booted.bundle.store.getState().deleteProject(id);
		}
	}, ids);
}

function blend(
	id: string,
	image: string,
	params: Record<string, ParamValue> = {},
): EffectInstance {
	return {
		id,
		type: 'imageBlend',
		version: imageBlendSpec.version,
		enabled: true,
		params: {...defaultParams(imageBlendSpec.params), image, ...params},
		mix: 1,
		blend: 'normal',
	};
}

const stackOf = (...instances: EffectInstance[]): EffectStack => ({
	schemaVersion: 1,
	instances,
});

async function applyStack(
	page: Page,
	stack: EffectStack,
	label: string,
): Promise<void> {
	await page.evaluate(
		async (change) => {
			const booted = await (globalThis as unknown as RuntimeGlobal)
				.__psgRuntime!.ready;
			if (booted.status !== 'ready') {
				throw new Error(booted.status);
			}

			await booted.bundle.store
				.getState()
				.applyStack(change.stack, change.label);
		},
		{stack, label},
	);
}

// What a project carries from one profile to another.
async function readActiveProject(page: Page) {
	return page.evaluate(async () => {
		const booted = await (globalThis as unknown as RuntimeGlobal).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error(booted.status);
		}

		const {activeProject, history} = booted.bundle.store.getState();
		if (!activeProject) {
			return null;
		}

		const {
			name,
			sourceHash,
			stack,
			stackA,
			transform,
			referencedSourceHashes,
			historyHeadSeq,
		} = activeProject;
		return {
			project: {
				name,
				sourceHash,
				stack,
				stackA,
				transform,
				referencedSourceHashes,
				historyHeadSeq,
			},
			history: history.map(({seq, label}) => ({seq, label})),
		};
	});
}

// The stored bytes of every image the active project uses, hashed again.
async function storedHashes(page: Page): Promise<string[]> {
	return page.evaluate(async () => {
		const booted = await (globalThis as unknown as RuntimeGlobal).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error(booted.status);
		}

		const {repository, store} = booted.bundle;
		const hashes: string[] = [];
		for (const hash of store.getState().activeProject!.referencedSourceHashes) {
			const source = await repository.getSource(hash);
			const digest = await crypto.subtle.digest(
				'SHA-256',
				await source!.blob.arrayBuffer(),
			);
			hashes.push(
				[...new Uint8Array(digest)]
					.map((byte) => byte.toString(16).padStart(2, '0'))
					.join(''),
			);
		}

		return hashes;
	});
}

// A settle frame of side B that has every image it names.
async function expectBlended(page: Page): Promise<void> {
	await expect
		.poll(
			async () =>
				page.evaluate(async () => {
					const booted = await (globalThis as unknown as RuntimeGlobal)
						.__psgRuntime!.ready;
					if (booted.status !== 'ready') {
						return false;
					}

					const {frame, busy} = booted.bundle.store.getState().render;
					return (
						frame?.level === 'settle' &&
						!busy.settle &&
						!frame.sourcesPending &&
						frame.warnings.length === 0
					);
				}),
			{timeout: 30_000},
		)
		.toBe(true);
}

async function finishDownload(download: Promise<Download>): Promise<Buffer> {
	const file = await download;
	return readFile(await file.path());
}

// The size and pixel hash of the full-size PNG the export dialog downloads.
// Pixels, not bytes: Firefox adds a `deBG` chunk that differs between profiles.
async function exportPng(
	page: Page,
	side?: 'A · Left' | 'B · Right',
): Promise<string> {
	await page.getByRole('button', {name: 'Export', exact: true}).click();
	const dialog = page.getByRole('dialog', {name: 'Export'});
	if (side) {
		await dialog.getByRole('radio', {name: side}).click();
	}

	await dialog.getByRole('radio', {name: 'PNG', exact: true}).click();
	await dialog.getByRole('radio', {name: 'Full', exact: true}).click();
	const pending = page.waitForEvent('download', {timeout: 120_000});
	await dialog.getByRole('button', {name: 'Download'}).click();
	const bytes = await finishDownload(pending);
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	const {width, height, data} = decodeRgbaPng(bytes);
	return `${width}x${height} ${sha256(data)}`;
}

async function saveProjectFile(page: Page): Promise<ChosenFixture> {
	await page.getByRole('button', {name: 'Save project file'}).click();
	const dialog = page.getByRole('dialog', {name: 'Save project file'});
	const pending = page.waitForEvent('download', {timeout: 60_000});
	await dialog.getByRole('button', {name: 'Save'}).click();
	const download = await pending;
	const buffer = await readFile(await download.path());
	await expect(dialog).toBeHidden();
	return {name: download.suggestedFilename(), mimeType: ZIP_TYPE, buffer};
}

async function toLibrary(page: Page): Promise<void> {
	await page.getByRole('button', {name: 'Back to library'}).click();
	await expect(
		page.getByRole('button', {name: 'Library actions'}),
	).toBeVisible();
}

async function exportBackup(page: Page): Promise<ChosenFixture> {
	await page.getByRole('button', {name: 'Library actions'}).click();
	await page.getByRole('menuitem', {name: 'Export backup'}).click();
	const dialog = page.getByRole('dialog', {name: 'Export backup'});
	const pending = page.waitForEvent('download', {timeout: 60_000});
	await dialog.getByRole('button', {name: 'Export backup'}).click();
	const download = await pending;
	const buffer = await readFile(await download.path());
	await expect(dialog).toBeHidden();
	return {name: download.suggestedFilename(), mimeType: ZIP_TYPE, buffer};
}

async function importBackup(page: Page, file: ChosenFixture): Promise<void> {
	await dropImages(page, [file]);
	const dialog = page.getByRole('dialog', {name: 'Import backup'});
	await dialog
		.getByRole('button', {name: 'Import', exact: true})
		.click({timeout: 60_000});
	await expect(dialog).toBeHidden({timeout: 60_000});
}

async function openProject(page: Page, name: string): Promise<void> {
	await page.getByRole('button', {name: new RegExp(`^Open ${name}`)}).click();
	await expectBlended(page);
}

const sourceEntries = (file: ChosenFixture) =>
	Object.keys(unzipSync(file.buffer))
		.filter((path) => path.startsWith('sources/'))
		.map((path) => path.slice('sources/'.length, path.lastIndexOf('.')))
		.toSorted();

async function picture(
	page: Page,
	name: string,
	width: number,
	height: number,
): Promise<ImageFixture> {
	return makeImage(page, {name: `${name}.png`, width, height});
}

test('AC-F25.2 & AC-F26.5: a .glproj round trip keeps both blended sides, undo history and pixels', async ({
	page,
	browser,
	baseURL,
}) => {
	test.setTimeout(120_000);
	const problems = trackProblems(page);
	await boot(page);
	const extras = [];
	for (const [name, width] of [
		['over', 90],
		['side', 110],
		['tile', 40],
		['dropped', 70],
	] as const) {
		extras.push(
			await addProject(page, await picture(page, name, width, 60), false),
		);
	}

	const [over, side, tile, dropped] = extras.map(({hash}) => hash);
	const base = await addProject(
		page,
		await picture(page, 'collage', 200, 150),
		true,
	);
	await expect(page.getByRole('button', {name: 'Export'})).toBeEnabled();
	// An image only the undo history keeps, then two blends between other effects
	// on side B and a third image on side A.
	await applyStack(page, stackOf(blend('blend000', dropped)), 'First blend');
	const [sort] = pixelSortStack({angle: 30}).instances;
	await applyStack(
		page,
		stackOf(
			sort,
			blend('blend001', over, {
				blendMode: 'difference',
				fit: 'none',
				rotation: 33.3,
			}),
			blend('blend002', tile, {blendMode: 'screen', fit: 'tile', scale: 0.5}),
		),
		'Collage',
	);
	await page.evaluate(async (image) => {
		const booted = await (globalThis as unknown as RuntimeGlobal).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error(booted.status);
		}

		const {store} = booted.bundle;
		const {activeProject} = store.getState();
		await store.getState().setTransform(
			activeProject!.id,
			{
				rotation: 90,
				flipX: true,
				flipY: false,
				crop: null,
				resize: null,
			},
			'Rotate',
		);
		await store.getState().setCompareMode('split');
		await store.getState().setEditSide('a');
		const [first] = store.getState().activeProject!.stack.instances.slice(1);
		await store.getState().applyStack(
			{
				schemaVersion: 1,
				instances: [
					{
						...first,
						id: 'sidea000',
						params: {...first.params, image, blendMode: 'multiply'},
					},
				],
			},
			'Side A',
		);
	}, side);
	// Only the project keeps the images now.
	await deleteProjects(
		page,
		extras.map(({id}) => id),
	);
	await expectBlended(page);
	const original = (await readActiveProject(page))!;
	const references = [base.hash, over, side, tile, dropped].toSorted();
	expect(original.project.referencedSourceHashes).toStrictEqual(references);
	const sideB = await exportPng(page, 'B · Right');
	const sideA = await exportPng(page, 'A · Left');
	expect(sideA).not.toBe(sideB);

	const file = await saveProjectFile(page);

	expect(sourceEntries(file)).toStrictEqual(references);
	const other = await freshPage(browser, baseURL!);
	const otherProblems = trackProblems(other);
	await dropImages(other, [file]);
	await expect(other).toHaveURL(/#\/p\//);
	await expectBlended(other);
	const opened = (await readActiveProject(other))!;
	expect(opened).toStrictEqual(original);
	expect(await storedHashes(other)).toStrictEqual(references);
	expect((await readImportState(other)).sourceCount).toBe(5);
	expect(await exportPng(other, 'B · Right')).toBe(sideB);
	expect(await exportPng(other, 'A · Left')).toBe(sideA);

	// Undo walks back to the stack whose image only history holds.
	await other.evaluate(async () => {
		const booted = await (globalThis as unknown as RuntimeGlobal).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error(booted.status);
		}

		const {activeProject, jumpToHistory} = booted.bundle.store.getState();
		await jumpToHistory(activeProject!.id, 1);
	});
	await expectBlended(other);
	const restored = (await readActiveProject(other))!;
	expect(
		restored.project.stack.instances.map(({params}) => params.image),
	).toStrictEqual([dropped]);
	expect(problems).toStrictEqual([]);
	expect(otherProblems).toStrictEqual([]);
	await other.context().close();
});

test('AC-F17.2 & AC-F26.5: a backup round trip restores blended projects with their shared image', async ({
	page,
	browser,
	baseURL,
}) => {
	test.setTimeout(120_000);
	const problems = trackProblems(page);
	await boot(page);
	const shared = await addProject(
		page,
		await picture(page, 'shared', 80, 60),
		false,
	);
	const own = await addProject(page, await picture(page, 'own', 60, 80), false);
	const projects = [];
	for (const [name, width, images] of [
		['First', 160, [shared.hash]],
		['Second', 140, [shared.hash, own.hash]],
	] as const) {
		const base = await addProject(
			page,
			await picture(page, name, width, 120),
			true,
		);
		await expect(page.getByRole('button', {name: 'Export'})).toBeEnabled();
		await applyStack(
			page,
			stackOf(
				...images.map((image, index) =>
					blend(`blend00${index}`, image, {blendMode: 'overlay', opacity: 0.8}),
				),
			),
			'Blend',
		);
		await expectBlended(page);
		projects.push({
			...base,
			name,
			before: (await readActiveProject(page))!,
			png: await exportPng(page),
		});
		await toLibrary(page);
	}

	await deleteProjects(page, [shared.id, own.id]);

	const backup = await exportBackup(page);

	// The shared image is in the archive once.
	expect(sourceEntries(backup)).toStrictEqual(
		[...projects.map(({hash}) => hash), shared.hash, own.hash].toSorted(),
	);
	const manifest = JSON.parse(
		strFromU8(unzipSync(backup.buffer)['manifest.json']),
	) as {projects: unknown[]};
	expect(manifest.projects).toHaveLength(2);

	const other = await freshPage(browser, baseURL!);
	const otherProblems = trackProblems(other);
	await importBackup(other, backup);
	expect((await readImportState(other)).sourceCount).toBe(4);
	for (const project of projects) {
		await openProject(other, project.name);
		expect(await readActiveProject(other)).toStrictEqual(project.before);
		expect(await exportPng(other)).toBe(project.png);
		await toLibrary(other);
	}

	// The restored references still count: the shared image goes with the last
	// project that uses it.
	const ids = new Map(
		(await readImportState(other)).projects.map(({name, id}) => [name, id]),
	);
	await deleteProjects(other, [ids.get('Second')!]);
	expect((await readImportState(other)).sourceCount).toBe(2);
	await deleteProjects(other, [ids.get('First')!]);
	expect((await readImportState(other)).sourceCount).toBe(0);
	expect(problems).toStrictEqual([]);
	expect(otherProblems).toStrictEqual([]);
	await other.context().close();
});

test('AC-F25.9: a 50 MP blended project saves, backs up, restores and exports offline', async ({
	page,
	context,
}) => {
	test.setTimeout(420_000);
	const problems = trackProblems(page);
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
	const overlay = await makeImage(page, {
		name: 'overlay.jpg',
		width: 6250,
		height: 8000,
		type: 'image/jpeg',
	});

	// Offline before the first import, so no lazy chunk can come from the network.
	const requests: string[] = [];
	context.on('request', (request) => {
		const url = request.url();
		if (!url.startsWith('blob:') && !url.startsWith('data:')) {
			requests.push(url);
		}
	});
	await context.setOffline(true);

	const extra = await addProject(page, overlay, false);
	await chooseImages(page, [photo]);
	await waitForSettleRender(page);
	await applyStack(
		page,
		stackOf(
			blend('blend000', extra.hash, {
				blendMode: 'difference',
				rotation: 33.3,
			}),
		),
		'Blend',
	);
	await deleteProjects(page, [extra.id]);
	await expectBlended(page);
	const original = (await readActiveProject(page))!;
	const exported = await exportPng(page);
	const file = await saveProjectFile(page);
	await toLibrary(page);
	const backup = await exportBackup(page);
	expect(sourceEntries(backup)).toStrictEqual(sourceEntries(file));
	expect(sourceEntries(file)).toHaveLength(2);

	const emptyLibrary = async () => {
		const {projects} = await readImportState(page);
		await deleteProjects(
			page,
			projects.map(({id}) => id),
		);
		expect((await readImportState(page)).sourceCount).toBe(0);
	};

	await emptyLibrary();
	await dropImages(page, [file]);
	await expect(page).toHaveURL(/#\/p\//, {timeout: 60_000});
	await expectBlended(page);
	expect(await readActiveProject(page)).toStrictEqual(original);
	expect(await exportPng(page)).toBe(exported);

	await toLibrary(page);
	await emptyLibrary();
	await importBackup(page, backup);
	await openProject(page, 'large');
	expect(await readActiveProject(page)).toStrictEqual(original);
	expect(await exportPng(page)).toBe(exported);

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
	expect(problems).toStrictEqual([]);
	await context.setOffline(false);
});

test('AC-F17.6: a full storage during a backup import keeps every project rendering', async ({
	page,
	browser,
	baseURL,
}) => {
	test.setTimeout(120_000);
	const problems = trackProblems(page);
	await boot(page);
	const extra = await addProject(
		page,
		await picture(page, 'extra', 80, 60),
		false,
	);
	await addProject(page, await picture(page, 'Incoming', 160, 120), true);
	await applyStack(page, stackOf(blend('blend000', extra.hash)), 'Blend');
	await expectBlended(page);
	await toLibrary(page);
	const backup = await exportBackup(page);

	// Another library, on a disk that takes its own project and then fills up.
	const context = await browser.newContext({baseURL});
	const full = await context.newPage();
	const fullProblems = trackProblems(full);
	await boot(full);
	await addProject(full, await picture(full, 'Local', 120, 90), true);
	await applyStack(
		full,
		stackOf(...pixelSortStack({}).instances),
		'Pixel sort',
	);
	await expectBlended(full);
	const before = (await readActiveProject(full))!;
	const png = await exportPng(full);
	await toLibrary(full);
	await blockFullStorage(full);
	await full.reload();
	await expect(
		full.getByRole('button', {name: 'Library actions'}),
	).toBeVisible();

	await dropImages(full, [backup]);
	await full
		.getByRole('dialog', {name: 'Import backup'})
		.getByRole('button', {name: 'Import', exact: true})
		.click();

	const dialog = full.getByRole('alertdialog', {name: 'Storage is full'});
	await expect(dialog).toBeVisible();
	const state = await readImportState(full);
	expect(state.projects.map(({name}) => name)).toStrictEqual(['Local']);
	expect(state.sourceCount).toBe(1);
	await dialog.getByRole('button', {name: 'Manage library'}).click();
	await expect(full.getByRole('dialog')).toHaveCount(0);
	await openProject(full, 'Local');
	expect(await readActiveProject(full)).toStrictEqual(before);
	expect(await exportPng(full)).toBe(png);
	expect(problems).toStrictEqual([]);
	expect(fullProblems).toStrictEqual([]);
	await context.close();
});

// The acceptance limit behind the "visible-update budget" while a control moves
// (product.md AC-F8.1): at least 5 preview updates a second.
test('AC-F26.1: dragging a blend control on a 12 MP photo updates the preview 5 times a second @perf', async ({
	page,
	browserName,
}) => {
	test.setTimeout(120_000);
	await openRenderPage(page);
	const updatesPerSecond = await page.evaluate(
		async (input) => {
			const {renderTest} = globalThis as unknown as PageScope;
			const base = {width: 4000, height: 3000};
			const overlay = {width: 3600, height: 3200};
			const blob = await renderTest.sourceBlob(
				base.width,
				base.height,
				'image/jpeg',
			);
			const extra = await renderTest.sourceBlob(
				overlay.width,
				overlay.height,
				'image/png',
			);
			const {createRenderCoordinator} = await renderTest.loadCoordinator(
				input.url,
			);
			const coordinator = createRenderCoordinator();
			const signal = renderTest.signal();
			let blended = 0;
			coordinator.setExtraSourceLoader(async () => ({
				blob: extra,
				...overlay,
			}));
			coordinator.subscribe((event) => {
				if (event.type === 'error') {
					throw new Error(event.error.message);
				}

				if (
					event.type === 'frame' &&
					!event.frame.sourcesPending &&
					event.frame.warnings.length === 0
				) {
					blended++;
				}

				signal.wake();
			});
			coordinator.setSource({key: 'perf', blob, ...base});
			coordinator.setStack({stack: input.stack});
			await signal.until(() => blended > 0);

			const seen = blended;
			const started = performance.now();
			for (let step = 0; performance.now() - started < 5000; step++) {
				const stack = structuredClone(input.stack);
				stack.instances[0].params.opacity = (50 + (step % 49)) / 100;
				coordinator.setStack({stack}, {dragging: true});
				await renderTest.sleep(16);
			}

			const rate = (blended - seen) / ((performance.now() - started) / 1000);
			coordinator.dispose();
			return rate;
		},
		{
			url: builtAsset('coordinator'),
			stack: stackOf(
				blend('blend000', 'a'.repeat(64), {
					blendMode: 'overlay',
					rotation: 33.3,
				}),
			),
		},
	);

	console.log(
		`[perf] imageBlend drag ${browserName}: ${updatesPerSecond.toFixed(1)} updates/s`,
	);
	expect(updatesPerSecond).toBeGreaterThanOrEqual(5);
});
