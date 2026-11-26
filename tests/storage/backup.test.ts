import {describe, expect, it, vi} from 'vite-plus/test';
import {IDENTITY_TRANSFORM} from '../../src/engine/transform.ts';
import {readBackup, writeBackup} from '../../src/storage/backup.ts';
import {BackupError} from '../../src/storage/backup-error.ts';
import {
	estimateBackupBytes,
	MAX_BACKUP_BYTES,
	MAX_BACKUP_ENTRIES,
	type BackupInput,
} from '../../src/storage/backup-format.ts';
import {readZipDirectory} from '../../src/storage/zip-reader.ts';
import type {SourceRecord, UserPresetRecord} from '../../src/storage/types.ts';
import {editedBackup} from './backup-fixtures.ts';
import {
	entriesOf,
	instance,
	jsonOf,
	noise,
	projectInput,
	sourceRecord,
	stackOf,
} from './project-fixtures.ts';

const PREFIX = "Can't import backup:";
const FIRST = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';
const SOURCE = sourceRecord(noise(200_000));
const PATH = `sources/${SOURCE.sha256}.png`;

const PRESET: UserPresetRecord = {
	id: 'user:preset-one',
	name: 'Warm',
	nameLower: 'warm',
	stack: stackOf(instance()),
	createdAt: 1,
	updatedAt: 2,
};

function projectItem(id: string, source: SourceRecord = SOURCE) {
	const {project, history, thumbnail} = projectInput(source);
	return {
		project: {...project, id},
		history: history.map((entry) => ({...entry, projectId: id})),
		thumbnail,
	};
}

function backupInput(overrides: Partial<BackupInput> = {}): BackupInput {
	return {
		scope: 'library',
		includesHistory: true,
		projects: [projectItem(FIRST), projectItem(SECOND)],
		sources: [SOURCE],
		presets: [PRESET],
		settings: {theme: 'dark', compareMode: 'split'},
		appVersion: '0.3.0',
		exportedAt: new Date(2026, 10, 27, 9, 5, 7),
		...overrides,
	};
}

// A blob that claims a size without holding the bytes.
function claimedBlob(size: number, type = 'image/png') {
	const blob = new Blob([], {type});
	Object.defineProperty(blob, 'size', {value: size});
	const stream = vi.spyOn(blob, 'stream');
	return {blob, stream};
}

async function written(overrides: Partial<BackupInput> = {}) {
	return writeBackup(backupInput(overrides));
}

describe('writeBackup', () => {
	it('stores a shared source once beside one folder per project', async () => {
		const {blob, fileName} = await written();

		expect(fileName).toBe('glitch-backup-20261127-090507.zip');
		const entries = await entriesOf(blob);
		expect(Object.keys(entries)).toStrictEqual([
			'manifest.json',
			`projects/${FIRST}/project.json`,
			`projects/${FIRST}/history.json`,
			`projects/${SECOND}/project.json`,
			`projects/${SECOND}/history.json`,
			'presets.json',
			'settings.json',
			PATH,
			`projects/${FIRST}/thumbnail.webp`,
			`projects/${SECOND}/thumbnail.webp`,
		]);
		expect(entries[PATH]).toStrictEqual(noise(200_000));
		expect(jsonOf(entries['manifest.json'])).toMatchObject({
			kind: 'backup',
			backupVersion: 1,
			projectFormatVersion: 1,
			appVersion: '0.3.0',
			scope: 'library',
			includesHistory: true,
			includesPresets: true,
			includesSettings: true,
			presetCount: 1,
			sources: [{sha256: SOURCE.sha256, path: PATH, byteLength: 200_000}],
			projects: [
				{
					id: FIRST,
					path: `projects/${FIRST}/project.json`,
					historyPath: `projects/${FIRST}/history.json`,
					thumbnailPath: `projects/${FIRST}/thumbnail.webp`,
					totalSourceBytes: 200_000,
				},
				{id: SECOND, totalSourceBytes: 200_000},
			],
		});
		// Source and pictures are stored, JSON is deflated, and no ZIP64 record
		// is needed.
		const directory = await readZipDirectory(blob);
		expect(directory.entries.get(PATH)?.method).toBe(0);
		expect(directory.entries.get('manifest.json')?.method).toBe(8);
	});

	it('leaves out history, presets, settings and unusable thumbnails', async () => {
		const {blob} = await written({
			includesHistory: false,
			projects: [
				{
					...projectItem(FIRST),
					thumbnail: new Blob(['x'], {type: 'image/png'}),
				},
			],
			presets: undefined,
			settings: undefined,
		});

		expect(Object.keys(await entriesOf(blob))).toStrictEqual([
			'manifest.json',
			`projects/${FIRST}/project.json`,
			PATH,
		]);
		const contents = await readBackup(blob);
		expect(contents.presets).toBeNull();
		expect(contents.settings).toBeNull();
		expect(contents.projects[0].history).toBeNull();
		expect(contents.projects[0].thumbnail).toBeNull();
		expect(contents.projects[0].project.historyMaxSeq).toBe(0);
	});

	it('writes a repaired transform for an invalid stored one', async () => {
		const item = projectItem(FIRST);
		const {blob} = await written({
			projects: [
				{
					...item,
					project: {...item.project, transform: {rotation: 45} as never},
				},
			],
		});

		const contents = await readBackup(blob);
		expect(contents.projects[0].project.transform).toStrictEqual(
			IDENTITY_TRANSFORM,
		);
	});

	it.each<[string, Partial<BackupInput>, string]>([
		[
			'a project whose source is gone',
			{sources: []},
			"Can't export backup: the image data of Night Drive / take 2 is missing.",
		],
		[
			'a project that breaks the format',
			{
				projects: [
					{
						...projectItem(FIRST),
						project: {...projectItem(FIRST).project, name: ''},
					},
				],
			},
			"Can't export backup: the stored data of  is invalid.",
		],
		[
			'a source whose size differs from the project',
			{sources: [{...SOURCE, width: 401}]},
			"Can't export backup: the stored data of Night Drive / take 2 is invalid.",
		],
		[
			'a repeated project id',
			{projects: [projectItem(FIRST), projectItem(FIRST)]},
			"Can't export backup: the stored data of Night Drive / take 2 is invalid.",
		],
		[
			'a broken preset',
			{presets: [{...PRESET, name: ''}]},
			"Can't export backup: a stored preset or setting is invalid.",
		],
	])('refuses %s', async (_, overrides, message) => {
		await expect(written(overrides)).rejects.toThrow(message);
	});

	const TOO_LARGE =
		"Can't export backup: it is too large (limit is 4 GB, or 200 MB per image). Select fewer projects or leave out undo history.";

	it('refuses a library over 4 GB before reading any image (D44)', async () => {
		expect(MAX_BACKUP_BYTES).toBeLessThan(2 ** 32 - 1);
		// 21 images of 199 MB are 4.18 GB.
		const images = Array.from({length: 21}, (_, index) => {
			const claimed = claimedBlob(199_000_000);
			const source = {
				...SOURCE,
				sha256: String(index).padStart(64, '0'),
				blob: claimed.blob,
			};
			return {source, stream: claimed.stream};
		});

		const error: unknown = await written({
			projects: images.map(({source}, index) =>
				projectItem(`project-${index}`, source),
			),
			sources: images.map(({source}) => source),
		}).catch((error: unknown) => error);

		expect(error).toBeInstanceOf(BackupError);
		expect((error as BackupError).code).toBe('export-too-large');
		expect((error as BackupError).message).toBe(TOO_LARGE);
		for (const {stream} of images) {
			expect(stream).not.toHaveBeenCalled();
		}
	});

	it('refuses an image over 200 MB', async () => {
		const {blob} = claimedBlob(200 * 1024 * 1024 + 1);

		await expect(written({sources: [{...SOURCE, blob}]})).rejects.toThrow(
			TOO_LARGE,
		);
	});

	it(
		'writes the most entries a ZIP without ZIP64 counts, and refuses one more',
		{timeout: 120_000},
		async () => {
			// Three entries per project, plus the manifest and one source.
			const most = (MAX_BACKUP_ENTRIES - 2) / 3;
			expect(Number.isSafeInteger(most)).toBe(true);
			const small = sourceRecord(noise(10));
			const item = projectItem(FIRST, small);
			const projects = Array.from({length: most}, (_, index) => ({
				project: {
					...item.project,
					id: `p${index}`,
					historyHeadSeq: 0,
					historyMaxSeq: 0,
				},
				history: [item.history[0]],
				thumbnail: new Blob(['webp'], {type: 'image/webp'}),
			}));
			const input = backupInput({
				projects,
				sources: [small],
				presets: undefined,
				settings: undefined,
			});

			const {blob} = await writeBackup(input);

			const directory = await readZipDirectory(blob);
			expect(directory.entries.size).toBe(MAX_BACKUP_ENTRIES);
			await expect(writeBackup({...input, presets: []})).rejects.toThrow(
				TOO_LARGE,
			);
		},
	);

	it('reports progress up to the end and stops when cancelled', async () => {
		const fractions: number[] = [];
		await writeBackup(backupInput(), {
			onProgress({fraction}) {
				fractions.push(fraction);
			},
		});
		expect(fractions).toStrictEqual(fractions.toSorted((a, b) => a - b));
		expect(fractions.at(-1)).toBe(1);

		const controller = new AbortController();
		await expect(
			writeBackup(backupInput(), {
				signal: controller.signal,
				onProgress() {
					controller.abort();
				},
			}),
		).rejects.toThrow('aborted');
	});
});

describe('readBackup', () => {
	it('returns every record with the verified sources', async () => {
		const input = backupInput();
		const {blob} = await writeBackup(input);

		const contents = await readBackup(blob);

		expect(contents.projects.map(({project}) => project.id)).toStrictEqual([
			FIRST,
			SECOND,
		]);
		const [{project, history, thumbnail}] = contents.projects;
		expect(project).toMatchObject({
			transform: input.projects[0].project.transform,
			stack: input.projects[0].project.stack,
			stackA: input.projects[0].project.stackA,
			selectedInstanceIdA: 'side000a',
		});
		expect(history).toHaveLength(6);
		expect(thumbnail?.type).toBe('image/webp');
		expect(contents.presets).toStrictEqual([PRESET]);
		expect(contents.settings).toStrictEqual({
			theme: 'dark',
			compareMode: 'split',
		});
		const [source] = contents.sources;
		expect(source.blob.type).toBe('image/png');
		expect(new Uint8Array(await source.blob.arrayBuffer())).toStrictEqual(
			noise(200_000),
		);
	});

	it('reads a backup that another tool deflated', async () => {
		const {blob} = await written();
		const repacked = await editedBackup(blob, () => undefined);
		const directory = await readZipDirectory(repacked);
		expect(directory.entries.get(PATH)?.method).toBe(8);

		const [source] = (await readBackup(repacked)).sources;

		expect(new Uint8Array(await source.blob.arrayBuffer())).toStrictEqual(
			noise(200_000),
		);
	});

	const INVALID = `${PREFIX} missing or invalid manifest.`;
	const first = (value: Record<string, unknown>) =>
		(value.projects as Array<Record<string, unknown>>)[0];

	type Change = Parameters<typeof editedBackup>[1];
	const manifest =
		(change: (value: Record<string, unknown>) => void): Change =>
		(_, json) => {
			json('manifest.json', change);
		};

	const remove =
		(path: string): Change =>
		(files) => {
			Reflect.deleteProperty(files, path);
		};

	it.each<[string, Change, string]>([
		['no manifest', remove('manifest.json'), INVALID],
		[
			'a project file manifest',
			manifest((value) => {
				value.kind = 'project';
			}),
			INVALID,
		],
		[
			'no backup version',
			manifest((value) => {
				delete value.backupVersion;
			}),
			INVALID,
		],
		[
			'a version below 1',
			manifest((value) => {
				value.backupVersion = 0;
			}),
			INVALID,
		],
		[
			'a newer backup version (AC-F17.7)',
			manifest((value) => {
				value.backupVersion = 2;
				value.projects = 'a shape this version does not know';
			}),
			`${PREFIX} format version 2 is newer than this app supports. Update the app and try again.`,
		],
		[
			'a newer project format',
			manifest((value) => {
				value.projectFormatVersion = 7;
			}),
			`${PREFIX} format version 7 is newer than this app supports. Update the app and try again.`,
		],
		[
			'a project id that leaves its folder',
			manifest((value) => {
				first(value).id = '../x';
			}),
			INVALID,
		],
		[
			'a repeated project',
			manifest((value) => {
				(value.projects as unknown[]).push(first(value));
			}),
			INVALID,
		],
		[
			'a project path outside the layout',
			manifest((value) => {
				first(value).path = 'projects/other/project.json';
			}),
			INVALID,
		],
		[
			'history left out of one project',
			manifest((value) => {
				first(value).historyPath = null;
			}),
			INVALID,
		],
		[
			'a preset count that differs',
			manifest((value) => {
				value.presetCount = 3;
			}),
			INVALID,
		],
		['no presets.json', remove('presets.json'), INVALID],
		['no settings.json', remove('settings.json'), INVALID],
		[
			'an unknown theme',
			(_, json) => {
				json('settings.json', (value) => {
					value.theme = 'neon';
				});
			},
			INVALID,
		],
		[
			'a preset id without the prefix',
			(_, json) => {
				json('presets.json', (value) => {
					(value.presets as Array<{id: string}>)[0].id = 'builtin:x';
				});
			},
			INVALID,
		],
		['no project.json', remove(`projects/${SECOND}/project.json`), INVALID],
		['no history.json', remove(`projects/${SECOND}/history.json`), INVALID],
		[
			'a project that differs from the manifest',
			(_, json) => {
				json(`projects/${FIRST}/project.json`, (value) => {
					value.name = 'Renamed';
				});
			},
			INVALID,
		],
		[
			'history with a gap',
			(_, json) => {
				json(`projects/${FIRST}/history.json`, (value) => {
					(value.entries as unknown[]).splice(2, 1);
				});
			},
			INVALID,
		],
		[
			'a source size that differs from the project',
			manifest((value) => {
				(value.sources as Array<{width: number}>)[0].width = 401;
			}),
			INVALID,
		],
		[
			'a project whose source is not listed',
			manifest((value) => {
				value.sources = [];
			}),
			`${PREFIX} missing image data (sources/${SOURCE.sha256}).`,
		],
		[
			'a missing source entry',
			remove(PATH),
			`${PREFIX} missing image data (${PATH}).`,
		],
		[
			'a tampered source byte (AC-F17.7)',
			(files) => {
				files[PATH][100] = (files[PATH][100] + 1) % 256;
			},
			`${PREFIX} image data is damaged (${PATH}).`,
		],
		[
			'an oversized JSON entry',
			(files) => {
				files['settings.json'] = new Uint8Array(16 * 1024 * 1024 + 1);
			},
			`${PREFIX} the archive is too large (limit is 4 GB, or 200 MB per image).`,
		],
	])('refuses %s', async (_, change, message) => {
		const {blob} = await written();

		await expect(readBackup(await editedBackup(blob, change))).rejects.toThrow(
			message,
		);
	});

	it('refuses a corrupt archive (AC-F17.7)', async () => {
		const {blob} = await written();
		const message = `${PREFIX} the file is damaged or not a valid ZIP archive.`;

		await expect(readBackup(new Blob(['not a zip']))).rejects.toThrow(message);
		await expect(readBackup(blob.slice(0, 5000))).rejects.toThrow(message);
	});

	it('refuses a file over 4 GB without reading it', async () => {
		const {blob} = claimedBlob(MAX_BACKUP_BYTES + 1);

		await expect(readBackup(blob)).rejects.toThrow(
			`${PREFIX} the archive is too large (limit is 4 GB, or 200 MB per image).`,
		);
	});

	it('ignores a thumbnail the archive lacks', async () => {
		const {blob} = await written();
		const edited = await editedBackup(
			blob,
			remove(`projects/${FIRST}/thumbnail.webp`),
		);

		const contents = await readBackup(edited);

		expect(contents.projects[0].thumbnail).toBeNull();
		expect(contents.projects[1].thumbnail).not.toBeNull();
	});

	it('reports progress up to the end and stops when cancelled', async () => {
		const {blob} = await written();
		const fractions: number[] = [];
		await readBackup(blob, {
			onProgress({fraction}) {
				fractions.push(fraction);
			},
		});
		expect(fractions.at(-1)).toBe(1);

		const controller = new AbortController();
		await expect(
			readBackup(blob, {
				signal: controller.signal,
				onProgress() {
					controller.abort();
				},
			}),
		).rejects.toThrow('aborted');
	});
});

describe('estimateBackupBytes', () => {
	it('counts a shared source once', () => {
		const sizes = {a: 10, b: 5};

		expect(
			estimateBackupBytes(
				[{sourceHash: 'a'}, {sourceHash: 'a'}, {sourceHash: 'b'}],
				sizes,
			),
		).toBe(15);
	});
});
