// Acceptance for v0.4.0 (docs/specs/acceptance-v0.4.0.md): masked projects travel
// through project files and backups, survive the database upgrade from version 3
// (product.md AC-F29.16, AC-F29.17) and stay fast while painting (AC-F29.18).
import {Buffer} from 'node:buffer';
import {readFile} from 'node:fs/promises';
import process from 'node:process';
import {expect, test, type Browser, type Page} from '@playwright/test';
import {strFromU8, unzipSync, zipSync} from 'fflate';
import {decodeRgbaPng} from '../golden/helpers.ts';
import {
	chooseImages,
	dropImages,
	makeImage,
	readImportState,
	type ChosenFixture,
} from './import.ts';
import {
	addEffect,
	addMask,
	openBase,
	panel,
	pngFixture,
	readEditor,
	setField,
	trackProblems,
	type RuntimeGlobal,
} from './mask-helpers.ts';
import {sha256, syntheticImage} from './render-fixtures.ts';
import {waitForSettleRender} from './settle.ts';

const ZIP_TYPE = 'application/zip';

const canvas = (page: Page) => page.getByLabel('Image canvas');

async function freshPage(browser: Browser, baseURL: string): Promise<Page> {
	const context = await browser.newContext({baseURL, acceptDownloads: true});
	const page = await context.newPage();
	// Keeps the picker intercepted, as in acceptance-v030.spec.ts.
	page.on('filechooser', () => {});
	await page.goto('/');
	await page.evaluate(async () => {
		await (globalThis as unknown as RuntimeGlobal).__psgRuntime!.ready;
	});
	return page;
}

// The size and pixel hash of the full-size PNG the export dialog downloads.
async function exportHash(page: Page): Promise<string> {
	await page.getByRole('button', {name: 'Export', exact: true}).click();
	const dialog = page.getByRole('dialog', {name: 'Export'});
	await dialog.getByRole('radio', {name: 'PNG', exact: true}).click();
	await dialog.getByRole('radio', {name: 'Full', exact: true}).click();
	const pending = page.waitForEvent('download', {timeout: 120_000});
	await dialog.getByRole('button', {name: 'Download'}).click();
	const download = await pending;
	const {width, height, data} = decodeRgbaPng(
		await readFile(await download.path()),
	);
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	return `${width}x${height} ${sha256(data)}`;
}

async function readProject(page: Page) {
	return page.evaluate(async () => {
		const booted = await (globalThis as unknown as RuntimeGlobal).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error(booted.status);
		}

		const {activeProject, history} = booted.bundle.store.getState();
		const {stack, historyHeadSeq, referencedMaskHashes} = activeProject!;
		return {
			stack,
			historyHeadSeq,
			referencedMaskHashes,
			history: history.map(({seq, label}) => ({seq, label})),
		};
	});
}

async function jumpTo(page: Page, seq: number): Promise<void> {
	await page.evaluate(async (target) => {
		const booted = await (globalThis as unknown as RuntimeGlobal).__psgRuntime!
			.ready;
		if (booted.status !== 'ready') {
			throw new Error(booted.status);
		}

		const {activeProject, jumpToHistory} = booted.bundle.store.getState();
		await jumpToHistory(activeProject!.id, target);
	}, seq);
	await waitForSettleRender(page);
}

// The export of every history step, oldest first, ending on the newest.
async function exportEveryStep(page: Page): Promise<string[]> {
	const {history} = await readProject(page);
	const hashes: string[] = [];
	for (const seq of history.map((item) => item.seq).toSorted((a, b) => a - b)) {
		await jumpTo(page, seq);
		hashes.push(await exportHash(page));
	}

	return hashes;
}

// One horizontal mouse stroke across the middle of the canvas.
async function stroke(page: Page, offset: number): Promise<void> {
	const {head} = await readEditor(page);
	const box = (await canvas(page).boundingBox())!;
	const y = box.y + box.height / 2 + offset;
	await page.mouse.move(box.x + box.width / 2 - 40, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 40, y, {steps: 8});
	await page.mouse.up();
	await expect.poll(async () => (await readEditor(page)).head).toBe(head + 1);
	await waitForSettleRender(page);
}

async function saveProjectFile(page: Page): Promise<Buffer> {
	await page.getByRole('button', {name: 'Save project file'}).click();
	const dialog = page.getByRole('dialog', {name: 'Save project file'});
	const pending = page.waitForEvent('download');
	await dialog.getByRole('button', {name: 'Save'}).click();
	const download = await pending;
	const buffer = await readFile(await download.path());
	await expect(dialog).toBeHidden();
	return buffer;
}

async function exportBackup(page: Page): Promise<Buffer> {
	await page.getByRole('button', {name: 'Back to library'}).click();
	await page.getByRole('button', {name: 'Library actions'}).click();
	await page.getByRole('menuitem', {name: 'Export backup'}).click();
	const dialog = page.getByRole('dialog', {name: 'Export backup'});
	const pending = page.waitForEvent('download');
	await dialog.getByRole('button', {name: 'Export backup'}).click();
	const download = await pending;
	const buffer = await readFile(await download.path());
	await expect(dialog).toBeHidden();
	return buffer;
}

const zipFixture = (name: string, buffer: Buffer): ChosenFixture => ({
	name,
	mimeType: ZIP_TYPE,
	buffer,
});

const manifestOf = (archive: Buffer) =>
	JSON.parse(strFromU8(unzipSync(archive)['manifest.json'])) as {
		formatVersion?: number;
		backupVersion?: number;
	};

const maskEntries = (archive: Buffer) =>
	Object.keys(unzipSync(archive)).filter((path) => path.startsWith('masks/'));

// The archive with its first mask entry removed or one byte of it changed.
function damaged(
	archive: Buffer,
	how: 'missing' | 'changed',
): {path: string; buffer: Buffer} {
	const entries = unzipSync(archive);
	const [path] = maskEntries(archive);
	if (how === 'missing') {
		Reflect.deleteProperty(entries, path);
	} else {
		const bytes = entries[path];
		const middle = Math.floor(bytes.length / 2);
		bytes[middle] = (bytes[middle] + 1) % 256;
	}

	return {path, buffer: Buffer.from(zipSync(entries))};
}

test('AC-F29.16: a project file and a backup of a masked project restore pixels and undo steps on a fresh profile', async ({
	page,
	browser,
	baseURL,
}) => {
	test.setTimeout(180_000);
	const problems = trackProblems(page);
	await openBase(page, pngFixture('masked.png', syntheticImage(160, 120)));
	await addEffect(page, 'Channel swap');
	await addMask(page, 'Paint');
	await setField(page, 'Brush size', '30');
	await canvas(page).focus();
	await page.keyboard.press('0');
	await page.keyboard.press('1');
	await stroke(page, -20);
	await stroke(page, 20);
	await addEffect(page, 'Posterize');
	await addMask(page, 'Brightness');
	await waitForSettleRender(page);
	const original = await readProject(page);
	// Two strokes, two stored masks; only the newer one is in the current stack.
	expect(original.referencedMaskHashes).toHaveLength(2);
	const steps = await exportEveryStep(page);
	expect(new Set(steps).size).toBeGreaterThan(3);

	const file = await saveProjectFile(page);
	const backup = await exportBackup(page);
	expect(manifestOf(file).formatVersion).toBe(2);
	expect(manifestOf(backup).backupVersion).toBe(2);
	expect(maskEntries(file)).toHaveLength(2);
	expect(maskEntries(backup)).toStrictEqual(maskEntries(file));

	for (const route of ['project file', 'backup'] as const) {
		const other = await freshPage(browser, baseURL!);
		const otherProblems = trackProblems(other);
		if (route === 'project file') {
			await dropImages(other, [zipFixture('masked.glproj', file)]);
		} else {
			await dropImages(other, [zipFixture('backup.zip', backup)]);
			const dialog = other.getByRole('dialog', {name: 'Import backup'});
			await dialog.getByRole('button', {name: 'Import', exact: true}).click();
			await expect(dialog).toBeHidden();
			await other.getByRole('button', {name: /^Open masked/}).click();
		}

		await expect(other).toHaveURL(/#\/p\//);
		await waitForSettleRender(other);
		expect(await readProject(other), route).toStrictEqual(original);
		expect(await exportEveryStep(other), route).toStrictEqual(steps);
		expect(otherProblems, route).toStrictEqual([]);
		await other.context().close();
	}

	const target = await freshPage(browser, baseURL!);
	for (const how of ['missing', 'changed'] as const) {
		const reason =
			how === 'missing' ? 'missing mask data' : 'mask data is damaged';
		const project = damaged(file, how);
		await dropImages(target, [zipFixture('bad.glproj', project.buffer)]);
		const refused = target.getByRole('alertdialog', {
			name: "Can't open project",
		});
		await expect(refused).toContainText(
			`Can't open bad.glproj: ${reason} (${project.path}).`,
		);
		await refused.getByRole('button', {name: 'Dismiss'}).click();
		await expect(refused).toBeHidden();

		const archive = damaged(backup, how);
		await dropImages(target, [zipFixture('bad.zip', archive.buffer)]);
		const dialog = target.getByRole('dialog', {name: 'Import backup'});
		await expect(dialog.getByRole('alert')).toHaveText(
			`Can't import backup: ${reason} (${archive.path}).`,
		);
		await dialog.getByRole('button', {name: 'Close'}).click();
		await expect(dialog).toBeHidden();
		expect(await readImportState(target)).toMatchObject({
			projects: [],
			sourceCount: 0,
		});
	}

	await target.context().close();
	expect(problems).toStrictEqual([]);
});

test('AC-F29.16: a project without masks still saves as format version 1', async ({
	page,
}) => {
	await openBase(page, pngFixture('plain.png', syntheticImage(160, 120)));
	await addEffect(page, 'Channel swap');
	await waitForSettleRender(page);
	const file = await saveProjectFile(page);
	const backup = await exportBackup(page);
	expect(manifestOf(file).formatVersion).toBe(1);
	expect(manifestOf(backup).backupVersion).toBe(1);
	expect(maskEntries(file)).toStrictEqual([]);
	expect(maskEntries(backup)).toStrictEqual([]);
});

// Rewrites the app's database as version 3 held it: no `masks` store, no mask
// index and no mask references (persistence.md section 8.6). Runs on a blank
// page of the same origin, so the app holds no connection.
async function downgradeToVersion3(page: Page): Promise<string[]> {
	return page.evaluate(async () => {
		const done = async <T>(request: IDBRequest<T>) =>
			new Promise<T>((resolve, reject) => {
				request.addEventListener('success', () => {
					resolve(request.result);
				});
				request.addEventListener('error', () => {
					reject(new Error(request.error?.message));
				});
			});

		const current = await done(globalThis.indexedDB.open('drift'));
		const names = [...current.objectStoreNames].filter(
			(name) => name !== 'masks',
		);
		const reading = current.transaction(names);
		const stores = await Promise.all(
			names.map(async (name) => {
				const store = reading.objectStore(name);
				const indexes = [...store.indexNames]
					.filter((index) => index !== 'byReferencedMaskHash')
					.map((index) => {
						const {keyPath, unique, multiEntry} = store.index(index);
						return {name: index, keyPath, unique, multiEntry};
					});
				return {
					name,
					keyPath: store.keyPath,
					indexes,
					keys: await done(store.getAllKeys()),
					records: (await done(store.getAll())) as Array<
						Record<string, unknown>
					>,
				};
			}),
		);
		// Firefox drops a stored blob's file with its database: copy the bytes out.
		for (const {records} of stores) {
			for (const record of records) {
				for (const [key, value] of Object.entries(record)) {
					if (value instanceof Blob) {
						record[key] = new Blob([await value.arrayBuffer()], {
							type: value.type,
						});
					}
				}
			}
		}

		current.close();
		await done(globalThis.indexedDB.deleteDatabase('drift'));

		const opening = globalThis.indexedDB.open('drift', 3);
		opening.addEventListener('upgradeneeded', () => {
			for (const {name, keyPath, indexes, keys, records} of stores) {
				const store = opening.result.createObjectStore(
					name,
					keyPath === null ? {} : {keyPath},
				);
				for (const index of indexes) {
					store.createIndex(index.name, index.keyPath, index);
				}

				for (const [position, record] of records.entries()) {
					delete record.referencedMaskHashes;
					store.put(record, keyPath === null ? keys[position] : undefined);
				}
			}
		});
		const old = await done(opening);
		const result = [`version ${old.version}`, ...old.objectStoreNames];
		old.close();
		return result;
	});
}

test('AC-F29.17: a 4000 × 3000 project upgraded from database version 3 keeps pixels and history, and masked exports are identical', async ({
	browser,
	baseURL,
}) => {
	test.setTimeout(300_000);
	// The service worker would answer the blank page with the app.
	const context = await browser.newContext({
		baseURL,
		acceptDownloads: true,
		serviceWorkers: 'block',
	});
	await context.route('**/blank-for-upgrade', async (route) =>
		route.fulfill({contentType: 'text/html', body: '<!doctype html>'}),
	);
	const page = await context.newPage();
	const problems = trackProblems(page);
	page.on('filechooser', () => {});
	await page.goto('/');
	await chooseImages(page, [
		await makeImage(page, {name: 'photo.png', width: 4000, height: 3000}),
	]);
	await waitForSettleRender(page);
	await addEffect(page, 'Channel swap');
	await addEffect(page, 'Posterize');
	await waitForSettleRender(page);
	const before = await readProject(page);
	const steps = await exportEveryStep(page);

	await page.goto('/blank-for-upgrade');
	const old = await downgradeToVersion3(page);
	expect(old[0]).toBe('version 3');
	expect(old).not.toContain('masks');

	await page.goto('/');
	await waitForSettleRender(page);
	expect(
		await page.evaluate(async () => {
			const booted = await (globalThis as unknown as RuntimeGlobal)
				.__psgRuntime!.ready;
			if (booted.status !== 'ready') {
				throw new Error(booted.status);
			}

			return (await booted.bundle.repository.getSchemaInfo())?.dbVersion;
		}),
	).toBe(4);
	expect(await readProject(page)).toStrictEqual(before);
	expect(await exportEveryStep(page)).toStrictEqual(steps);

	await addMask(page, 'Paint');
	await setField(page, 'Brush size', '600');
	await canvas(page).focus();
	await stroke(page, 0);
	const first = await exportHash(page);
	expect(first).not.toBe(steps.at(-1));
	expect(await exportHash(page)).toBe(first);
	expect(problems).toStrictEqual([]);
	await context.close();
});

type TaskReport = {
	longTasks: number[];
	longTasksSupported: boolean;
	// Longest delay of a 10 ms interval timer beyond its period.
	maxStallMs: number;
};

// Measures how long after each pointer move the canvas pixel under it changes.
async function startOverlayProbe(page: Page): Promise<void> {
	await canvas(page).evaluate((element) => {
		const target = element as HTMLCanvasElement;
		// One pixel is copied out, so the app's canvas is never read directly.
		const copy = new OffscreenCanvas(1, 1).getContext('2d', {
			willReadFrequently: true,
		})!;
		const read = (x: number, y: number) => {
			copy.clearRect(0, 0, 1, 1);
			copy.drawImage(target, x, y, 1, 1, 0, 0, 1, 1);
			return [...copy.getImageData(0, 0, 1, 1).data];
		};

		const waiting: Array<{
			x: number;
			y: number;
			from: number[];
			at: number;
		}> = [];
		const latencies: number[] = [];
		let sampling = true;
		// Capture on the window runs before the brush sees the move.
		globalThis.addEventListener(
			'pointermove',
			(event) => {
				if (event.buttons !== 1) {
					return;
				}

				const box = target.getBoundingClientRect();
				const scale = target.width / box.width;
				const x = Math.floor((event.clientX - box.left) * scale);
				const y = Math.floor((event.clientY - box.top) * scale);
				waiting.push({x, y, from: read(x, y), at: event.timeStamp});
			},
			{capture: true},
		);
		const frame = () => {
			for (let index = waiting.length - 1; index >= 0; index--) {
				const {x, y, from, at} = waiting[index];
				const change = read(x, y).map((value, c) => Math.abs(value - from[c]));
				if (!(Math.max(...change) > 6)) {
					continue;
				}

				latencies.push(performance.now() - at);
				waiting.splice(index, 1);
			}

			if (sampling) {
				globalThis.requestAnimationFrame(frame);
			}
		};

		globalThis.requestAnimationFrame(frame);
		Object.assign(globalThis, {
			__overlayProbe: {
				stop() {
					sampling = false;
					return {latencies, unseen: waiting.length};
				},
			},
		});
	});
}

// Strokes in rows across the photo, with moves about 60 times a second. The
// moves are further apart than the brush is wide, so each one paints new pixels.
async function paintRows(
	page: Page,
	rows: readonly number[],
	afterRelease: () => Promise<void>,
): Promise<void> {
	const box = (await canvas(page).boundingBox())!;
	// The photo fits the canvas at 4:3.
	const width = Math.min(box.width, (box.height * 4) / 3) * 0.7;
	const height = (width * 3) / 4;
	const step = 40;
	for (const row of rows) {
		const y = box.y + box.height / 2 + (row - 0.5) * height;
		const left = box.x + (box.width - width) / 2;
		await page.mouse.move(left, y);
		await page.mouse.down();
		for (let x = step; x <= width; x += step) {
			await page.mouse.move(left + x, y);
			await page.waitForTimeout(16);
		}

		// The last move must show before the stroke ends.
		await page.waitForTimeout(150);
		await afterRelease();
	}
}

test('AC-F29.18: painting a 12 MP photo shows the overlay and the preview in time @perf', async ({
	page,
	browserName,
}) => {
	test.setTimeout(300_000);
	const problems = trackProblems(page);
	page.on('filechooser', () => {});
	await page.goto('/');
	await chooseImages(page, [
		await makeImage(page, {
			name: 'photo.jpg',
			width: 4000,
			height: 3000,
			type: 'image/jpeg',
		}),
	]);
	await waitForSettleRender(page);
	// The default effect, with the default brush.
	await addEffect(page, 'Pixel sort');
	await addMask(page, 'Paint');
	await expect(
		panel(page).getByRole('textbox', {name: 'Brush size'}),
	).toHaveValue('100 px');
	await waitForSettleRender(page);

	// Releases the button and times the preview of the finished stroke.
	const settles: number[] = [];
	const release = async () => {
		await page.evaluate(async () => {
			const booted = await (globalThis as unknown as RuntimeGlobal)
				.__psgRuntime!.ready;
			if (booted.status !== 'ready') {
				throw new Error(booted.status);
			}

			const {store} = booted.bundle;
			const head = store.getState().activeProject!.historyHeadSeq;
			const shown = Promise.withResolvers<number>();
			globalThis.addEventListener(
				'pointerup',
				(event) => {
					let before: unknown;
					const unsubscribe = store.subscribe(({activeProject, render}) => {
						if (activeProject!.historyHeadSeq === head) {
							return;
						}

						// The frame on screen when the stroke is written is the old one.
						before ??= render.frame;
						const {frame, busy} = render;
						const complete =
							frame?.level === 'settle' &&
							!frame.sourcesPending &&
							frame.warnings.length === 0;
						if (frame === before || !complete || busy.settle) {
							return;
						}

						unsubscribe();
						// eslint-disable-next-line max-nested-callbacks -- page code: one frame after the store update
						globalThis.requestAnimationFrame(() => {
							shown.resolve(performance.now() - event.timeStamp);
						});
					});
				},
				{capture: true, once: true},
			);
			Object.assign(globalThis, {__settle: shown.promise});
		});
		await page.mouse.up();
		settles.push(
			await page.evaluate(
				async () =>
					(globalThis as unknown as {__settle: Promise<number>}).__settle,
			),
		);
	};

	// Overlay latency and preview time, with the probe reading pixels.
	await startOverlayProbe(page);
	const rows = Array.from({length: 10}, (_, index) => 0.05 + index * 0.1);
	await paintRows(page, rows, release);
	const probe = await page.evaluate(() =>
		(
			globalThis as unknown as {
				__overlayProbe: {stop(): {latencies: number[]; unseen: number}};
			}
		).__overlayProbe.stop(),
	);

	// Main-thread tasks, without the probe's own work, on a mask not yet painted.
	await panel(page).getByRole('button', {name: 'Clear'}).click();
	await waitForSettleRender(page);
	await page.evaluate(() => {
		const longTasks: number[] = [];
		const longTasksSupported =
			PerformanceObserver.supportedEntryTypes.includes('longtask');
		const observer = new PerformanceObserver((list) => {
			longTasks.push(...list.getEntries().map((entry) => entry.duration));
		});
		if (longTasksSupported) {
			observer.observe({entryTypes: ['longtask']});
		}

		let maxStallMs = 0;
		let last = performance.now();
		const timer = setInterval(() => {
			const now = performance.now();
			maxStallMs = Math.max(maxStallMs, now - last - 10);
			last = now;
		}, 10);
		Object.assign(globalThis, {
			__tasks: {
				stop() {
					clearInterval(timer);
					longTasks.push(
						...observer.takeRecords().map((item) => item.duration),
					);
					observer.disconnect();
					return {longTasks, longTasksSupported, maxStallMs};
				},
			},
		});
	});
	await paintRows(page, rows, async () => {
		const {head} = await readEditor(page);
		await page.mouse.up();
		await expect.poll(async () => (await readEditor(page)).head).toBe(head + 1);
		await waitForSettleRender(page);
	});
	const tasks = await page.evaluate(() =>
		(
			globalThis as unknown as {
				__tasks: {stop(): TaskReport};
			}
		).__tasks.stop(),
	);

	const percentile = (values: number[], p: number) =>
		values.toSorted((a, b) => a - b)[Math.ceil(p * values.length) - 1];
	const report = (values: number[]) =>
		`n=${values.length} median ${Math.round(percentile(values, 0.5))} ms, p95 ${Math.round(percentile(values, 0.95))} ms, max ${Math.round(Math.max(...values))} ms`;
	console.log(
		`[perf] mask overlay latency ${browserName}: ${report(probe.latencies)}, ${probe.unseen} moves unseen`,
	);
	console.log(`[perf] mask stroke preview ${browserName}: ${report(settles)}`);
	console.log(
		`[perf] main thread while painting ${browserName}: ${tasks.longTasksSupported ? `long tasks [${tasks.longTasks.map((ms) => Math.round(ms)).join(', ')}] ms, ` : 'no Long Tasks API, '}longest timer stall ${Math.round(tasks.maxStallMs)} ms`,
	);

	expect(probe.latencies.length).toBeGreaterThan(100);
	expect(probe.unseen).toBe(0);
	// Chromium names every long task, also on a slow machine.
	expect(tasks.longTasks.filter((ms) => ms > 50)).toStrictEqual([]);
	// AC-F29.18 sets its times for the reference laptop, so they are asserted only
	// there (BRUSH_BUDGETS=1). Elsewhere a tenfold miss still fails the test.
	const slack = process.env.BRUSH_BUDGETS === '1' ? 1 : 10;
	expect.soft(percentile(probe.latencies, 0.95)).toBeLessThan(50 * slack);
	expect.soft(percentile(settles, 0.95)).toBeLessThan(500 * slack);
	if (!tasks.longTasksSupported) {
		expect.soft(tasks.maxStallMs).toBeLessThan(50 * slack);
	}

	expect(problems).toStrictEqual([]);
});
