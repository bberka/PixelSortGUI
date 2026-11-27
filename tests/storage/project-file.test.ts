import {strToU8} from 'fflate';
import {describe, expect, it, vi} from 'vite-plus/test';
import {IDENTITY_TRANSFORM} from '../../src/engine/transform.ts';
import {ProjectFileError} from '../../src/storage/project-file-error.ts';
import {
	MAX_JSON_BYTES,
	MAX_PROJECT_FILE_BYTES,
	MAX_SOURCE_BYTES,
	migrateProjectDocuments,
	projectFileName,
	readProjectFile,
	writeProjectFile,
	type ArchiveProgress,
	type ProjectFileInput,
} from '../../src/storage/project-file.ts';
import {MemoryStorageAdapter} from '../../src/storage/memory-adapter.ts';
import {MAX_HISTORY_ENTRIES} from '../../src/storage/types.ts';
import {
	CROPPED,
	editedArchive,
	entriesOf,
	instance,
	jsonOf,
	noise,
	projectInput,
	sourceRecord,
	stackOf,
	zipOf,
	type Edit,
} from './project-fixtures.ts';

const NAME = 'drive.glproj';
const TOO_LARGE = `Can't open ${NAME}: the project file is too large (limit is 1 GB, or 200 MB per image).`;
const DAMAGED = `Can't open ${NAME}: the file is damaged or not a valid project archive.`;
const INVALID = `Can't open ${NAME}: missing or invalid project metadata.`;

async function bytesOf(blob: Blob) {
	return new Uint8Array(await blob.arrayBuffer());
}

async function saved(input: ProjectFileInput = projectInput()) {
	const output = await writeProjectFile(input);
	return output.blob;
}

async function expectOpenError(file: Blob, message: string) {
	const error: unknown = await readProjectFile(file, NAME).then(
		() => undefined,
		(error: unknown) => error,
	);
	expect(error).toBeInstanceOf(ProjectFileError);
	expect((error as ProjectFileError).message).toBe(message);
}

// Overwrites the uncompressed size the central directory declares for `path`.
async function withDeclaredSize(blob: Blob, path: string, size: number) {
	const bytes = await bytesOf(blob);
	const view = new DataView(bytes.buffer);
	const decoder = new TextDecoder();
	for (let at = 0; at < bytes.length - 46; at++) {
		if (
			view.getUint32(at, true) === 0x02_01_4b_50 &&
			decoder.decode(bytes.subarray(at + 46, at + 46 + path.length)) === path
		) {
			view.setUint32(at + 24, size, true);
			return new Blob([bytes]);
		}
	}

	throw new Error(`No directory entry for ${path}`);
}

describe('writeProjectFile', () => {
	it('writes the archive layout with the source stored bit for bit (AC-F25.1)', async () => {
		const input = projectInput();
		const {blob, fileName} = await writeProjectFile(input);

		expect(fileName).toBe('night-drive-take-2-20261126-090507.glproj');
		const entries = await entriesOf(blob);
		const path = `sources/${input.sources[0].sha256}.png`;
		expect(Object.keys(entries)).toStrictEqual([
			'manifest.json',
			'project.json',
			'history.json',
			'thumbnail.webp',
			path,
		]);
		expect(entries[path]).toStrictEqual(await bytesOf(input.sources[0].blob));
		expect(jsonOf(entries['manifest.json'])).toStrictEqual({
			kind: 'project',
			formatVersion: 1,
			appVersion: '0.3.0',
			exportedAt: input.exportedAt!.toISOString(),
			includesHistory: true,
			primarySourceHash: input.sources[0].sha256,
			sources: [
				{
					sha256: input.sources[0].sha256,
					path,
					mimeType: 'image/png',
					byteLength: 200_000,
					width: 400,
					height: 300,
				},
			],
			thumbnailPath: 'thumbnail.webp',
		});
		expect(jsonOf(entries['project.json'])).toMatchObject({
			transform: input.project.transform,
		});
	});

	it('stores media and deflates metadata', async () => {
		const bytes = await bytesOf(await saved());
		const view = new DataView(bytes.buffer);
		const methods: Record<string, number> = {};
		for (let at = 0; at < bytes.length - 46; at++) {
			if (view.getUint32(at, true) !== 0x02_01_4b_50) {
				continue;
			}

			const name = new TextDecoder().decode(
				bytes.subarray(at + 46, at + 46 + view.getUint16(at + 28, true)),
			);
			methods[name.split('/', 1)[0]] = view.getUint16(at + 10, true);
		}

		expect(methods).toStrictEqual({
			'manifest.json': 8,
			'project.json': 8,
			'history.json': 8,
			'thumbnail.webp': 0,
			sources: 0,
		});
	});

	it('puts the primary source first and writes each hash once', async () => {
		const input = projectInput();
		const extra = sourceRecord(noise(300, 9), {mimeType: 'image/jpeg'});
		const blob = await saved({
			...input,
			sources: [extra, input.sources[0], extra],
		});

		const contents = await readProjectFile(blob, NAME);
		expect(contents.sources.map((source) => source.path)).toStrictEqual([
			`sources/${input.sources[0].sha256}.png`,
			`sources/${extra.sha256}.jpg`,
		]);
	});

	it('writes repaired geometry for stored records that are invalid', async () => {
		const input = projectInput();
		const broken = {...IDENTITY_TRANSFORM, rotation: 45 as 0};
		const contents = await readProjectFile(
			await saved({
				...input,
				project: {...input.project, transform: broken},
				history: input.history.map((entry) => ({...entry, transform: broken})),
			}),
			NAME,
		);

		expect(contents.project.transform).toStrictEqual(IDENTITY_TRANSFORM);
		expect(contents.history![5].transform).toStrictEqual(IDENTITY_TRANSFORM);
	});

	it.each([
		[
			'a missing source',
			{sources: []},
			"Can't save Night Drive / take 2: its image data is missing.",
		],
		[
			'history that does not match the head',
			{history: []},
			"Can't save Night Drive / take 2: its stored data is invalid.",
		],
		[
			'a source over 200 MB',
			{
				sources: [
					{
						...projectInput().sources[0],
						blob: {size: MAX_SOURCE_BYTES + 1} as Blob,
					},
				],
			},
			"Can't save Night Drive / take 2: the project is too large for a project file (limit is 1 GB, or 200 MB per image).",
		],
	])('refuses %s', async (_name, overrides, message) => {
		await expect(
			writeProjectFile({...projectInput(), ...overrides}),
		).rejects.toThrow(message);
	});
});

describe('readProjectFile', () => {
	it('round-trips a project with history, transform and side A (AC-F25.2)', async () => {
		const input = projectInput();
		const contents = await readProjectFile(await saved(input), NAME);

		// Derived on import, so `project.json` leaves them out.
		const {
			effectiveWidth,
			effectiveHeight,
			referencedSourceHashes,
			...project
		} = input.project;
		expect(contents.project).toStrictEqual({
			...project,
			exportSettings: input.project.exportSettings,
		});
		expect(contents.history).toStrictEqual(input.history);
		expect(contents.sources).toHaveLength(1);
		expect(await bytesOf(contents.sources[0].blob)).toStrictEqual(
			await bytesOf(input.sources[0].blob),
		);
		expect(contents.sources[0].blob.type).toBe('image/png');
		expect(contents.thumbnail?.type).toBe('image/webp');
		expect(await bytesOf(contents.thumbnail!)).toStrictEqual(noise(900, 7));
	});

	it('leaves history out when asked to (AC-F25.3)', async () => {
		const {history, thumbnail, ...input} = projectInput();
		const blob = await saved(input);

		expect(Object.keys(await entriesOf(blob))).not.toContain('history.json');
		const contents = await readProjectFile(blob, NAME);
		expect(contents.history).toBeNull();
		expect(contents.thumbnail).toBeNull();
		expect(contents.project).toMatchObject({
			historyHeadSeq: 0,
			historyMinSeq: 0,
			historyMaxSeq: 0,
		});
	});

	it('keeps a source whose bytes hold ZIP signatures whole', async () => {
		const bytes = noise(4000, 3);
		for (const [index, signature] of [3, 1, 7].entries()) {
			bytes.set([0x50, 0x4b, signature, signature + 1], 1000 * (index + 1));
		}

		const contents = await readProjectFile(
			await saved(projectInput(sourceRecord(bytes))),
			NAME,
		);

		expect(await bytesOf(contents.sources[0].blob)).toStrictEqual(bytes);
	});

	it('reads an archive another tool packed, with deflated media', async () => {
		const blob = zipOf(await entriesOf(await saved()));

		const contents = await readProjectFile(blob, NAME);
		expect(contents.sources[0].blob.size).toBe(200_000);
	});

	it('keeps unknown effects and newer stack envelopes verbatim (AC-F25.8)', async () => {
		const unknown = {
			...instance({type: 'fromTheFuture', version: 9}),
			blend: 'screen',
			extra: {anything: [1]},
		};
		const input = projectInput();
		const contents = await readProjectFile(
			await saved({
				...input,
				project: {
					...input.project,
					stack: {...stackOf(unknown as never), schemaVersion: 2},
				},
			}),
			NAME,
		);

		expect(contents.project.stack).toStrictEqual({
			schemaVersion: 2,
			instances: [unknown],
		});
	});

	it('reads a missing transform as the identity', async () => {
		const blob = await editedArchive(await saved(), ({project, history}) => {
			delete project.transform;
			history.entries = (history.entries as Array<{transform?: unknown}>).map(
				({transform, ...entry}) => entry,
			);
		});

		const contents = await readProjectFile(blob, NAME);
		expect(contents.project.transform).toStrictEqual(IDENTITY_TRANSFORM);
		expect(contents.history![0].transform).toStrictEqual(IDENTITY_TRANSFORM);
	});

	it('ignores a thumbnail the archive lacks', async () => {
		const blob = await editedArchive(await saved(), ({files}) => {
			Reflect.deleteProperty(files, 'thumbnail.webp');
		});

		const contents = await readProjectFile(blob, NAME);
		expect(contents.thumbnail).toBeNull();
	});

	it.each([
		['text', new Blob(['not a zip at all'])],
		['an empty file', new Blob()],
	])('calls %s damaged (AC-F25.5)', async (_name, file) => {
		await expectOpenError(file, DAMAGED);
	});

	it('calls a truncated archive damaged', async () => {
		const blob = await saved();
		await expectOpenError(blob.slice(0, blob.size - 40), DAMAGED);
		await expectOpenError(blob.slice(100), DAMAGED);
	});

	it.each(['../evil', '/abs', String.raw`sources\x`])(
		'calls an archive with the path %s damaged',
		async (path) => {
			const files = await entriesOf(await saved());
			await expectOpenError(zipOf({...files, [path]: strToU8('x')}), DAMAGED);
		},
	);

	it('names a missing source entry (AC-F25.6)', async () => {
		const input = projectInput();
		const path = `sources/${input.sources[0].sha256}.png`;
		const blob = await editedArchive(await saved(input), ({files}) => {
			Reflect.deleteProperty(files, path);
		});

		await expectOpenError(
			blob,
			`Can't open ${NAME}: missing image data (${path}).`,
		);
	});

	it('names a primary source the manifest does not list', async () => {
		const input = projectInput();
		const blob = await editedArchive(await saved(input), ({manifest}) => {
			manifest.sources = [];
		});

		await expectOpenError(
			blob,
			`Can't open ${NAME}: missing image data (sources/${input.sources[0].sha256}).`,
		);
	});

	it.each([
		[
			'one changed byte',
			(bytes: Uint8Array) => {
				bytes[500] = (bytes[500] + 1) % 256;
				return bytes;
			},
		],
		['a missing byte', (bytes: Uint8Array) => bytes.slice(1)],
	])('calls a source with %s damaged (AC-F25.6)', async (_name, change) => {
		const input = projectInput();
		const path = `sources/${input.sources[0].sha256}.png`;
		const blob = await editedArchive(await saved(input), ({files}) => {
			files[path] = change(files[path]);
		});

		await expectOpenError(
			blob,
			`Can't open ${NAME}: image data is damaged (${path}).`,
		);
	});

	it('checks byteLength even when the hash matches', async () => {
		const blob = await editedArchive(await saved(), ({manifest}) => {
			const [source] = manifest.sources as Array<{byteLength: number}>;
			source.byteLength += 1;
		});

		await expect(readProjectFile(blob, NAME)).rejects.toMatchObject({
			code: 'damaged-source',
		});
	});

	it.each([2, 1.5, '2'])(
		'refuses format version %s as newer (AC-F25.7)',
		async (version) => {
			const blob = await editedArchive(await saved(), ({manifest, project}) => {
				manifest.formatVersion = version;
				// A newer format may hold anything else.
				delete project.name;
			});

			await expectOpenError(
				blob,
				`Can't open ${NAME}: project format version ${version} is newer than this app supports. Update the app and try again.`,
			);
		},
	);

	it.each<[string, Edit]>([
		[
			'a backup manifest',
			({manifest}) => {
				manifest.kind = 'backup';
			},
		],
		[
			'no format version',
			({manifest}) => {
				delete manifest.formatVersion;
			},
		],
		[
			'format version 0',
			({manifest}) => {
				manifest.formatVersion = 0;
			},
		],
		[
			'no project.json',
			({files}) => {
				Reflect.deleteProperty(files, 'project.json');
			},
		],
		[
			'no history.json',
			({files}) => {
				Reflect.deleteProperty(files, 'history.json');
			},
		],
		[
			'an empty name',
			({project}) => {
				project.name = '  ';
			},
		],
		[
			'a long name',
			({project}) => {
				project.name = 'x'.repeat(121);
			},
		],
		[
			'33 effects',
			({project}) => {
				project.stack = stackOf(...Array.from({length: 33}, () => instance()));
			},
		],
		[
			'a broken effect',
			({project}) => {
				project.stack = stackOf({...instance(), mix: 'all' as never});
			},
		],
		[
			'a wrong source hash',
			({project}) => {
				project.sourceHash = 'a'.repeat(64);
			},
		],
		[
			'a wrong source size',
			({project}) => {
				project.sourceWidth = 401;
			},
		],
		[
			'a side over 16,384 px',
			({manifest}) => {
				const [source] = manifest.sources as object[];
				manifest.sources = [{...source, width: 20_000}];
			},
		],
		[
			'a transform outside the image',
			({project}) => {
				project.transform = {
					...CROPPED,
					crop: {x: 0, y: 0, width: 5000, height: 1},
				};
			},
		],
		[
			'an unknown export format',
			({project}) => {
				project.exportSettings = {
					...projectInput().project.exportSettings,
					format: 'gif',
				};
			},
		],
		[
			'a path outside sources/',
			({manifest}) => {
				const [source] = manifest.sources as object[];
				manifest.sources = [{...source, path: 'thumbnail.webp'}];
			},
		],
		[
			'a history gap',
			({history}) => {
				history.entries = (history.entries as unknown[]).toSpliced(2, 1);
			},
		],
		[
			'a head outside history',
			({project}) => {
				project.historyHeadSeq = 6;
			},
		],
		[
			'202 history entries',
			({history, project}) => {
				const [first] = history.entries as object[];
				history.entries = Array.from({length: 202}, (_, seq) => ({
					...first,
					seq,
				}));
				project.historyMaxSeq = 201;
			},
		],
	])('refuses %s as invalid metadata', async (_name, edit) => {
		await expectOpenError(await editedArchive(await saved(), edit), INVALID);
	});

	it('refuses invalid JSON', async () => {
		const files = await entriesOf(await saved());
		await expectOpenError(
			zipOf({...files, 'project.json': strToU8('{"name":')}),
			INVALID,
		);
	});
});

describe('zip-bomb caps', () => {
	it('refuses a file over 1 GB without reading it', async () => {
		const slice = vi.fn();
		await expectOpenError(
			{size: MAX_PROJECT_FILE_BYTES + 1, slice} as unknown as Blob,
			TOO_LARGE,
		);
		expect(slice).not.toHaveBeenCalled();
	});

	it.each([
		['project.json', MAX_JSON_BYTES],
		['thumbnail.webp', 2 * 1024 * 1024],
		['sources/extra.png', MAX_SOURCE_BYTES],
	])('refuses %s declared over its cap', async (path, cap) => {
		const files = await entriesOf(await saved());
		const blob = zipOf({'sources/extra.png': strToU8('x'), ...files});
		await expectOpenError(
			await withDeclaredSize(blob, path, cap + 1),
			TOO_LARGE,
		);
	});

	it('stops inflating at the cap when the header understates the size', async () => {
		const files = await entriesOf(await saved());
		const bomb = zipOf({
			...files,
			'manifest.json': new Uint8Array(MAX_JSON_BYTES * 2),
		});
		expect(bomb.size).toBeLessThan(MAX_JSON_BYTES);
		await expectOpenError(
			await withDeclaredSize(bomb, 'manifest.json', 100),
			TOO_LARGE,
		);
	});

	it('refuses an entry longer than its declared size', async () => {
		const blob = zipOf(await entriesOf(await saved()));
		await expectOpenError(
			await withDeclaredSize(blob, 'manifest.json', 10),
			DAMAGED,
		);
	});

	it('refuses entries that add up to more than 1 GB', async () => {
		const extras = Array.from({length: 6}, (_, index) =>
			sourceRecord(noise(100, index + 20)),
		);
		const input = projectInput();
		let blob = zipOf(
			await entriesOf(
				await saved({...input, sources: [...input.sources, ...extras]}),
			),
		);
		for (const extra of extras) {
			blob = await withDeclaredSize(
				blob,
				`sources/${extra.sha256}.png`,
				MAX_SOURCE_BYTES,
			);
		}

		await expectOpenError(blob, TOO_LARGE);
	});
});

describe('progress and cancel', () => {
	const large = () => projectInput(sourceRecord(noise(3 * 1024 * 1024, 5)));

	function expectProgress(seen: ArchiveProgress[]) {
		const fractions = seen.map((progress) => progress.fraction);
		expect(fractions).toStrictEqual(fractions.toSorted((a, b) => a - b));
		expect(fractions.length).toBeGreaterThan(3);
		expect(fractions.at(-1)).toBe(1);
		expect(seen.at(-1)!.path).toMatch(/^sources\//);
	}

	it('reports rising progress while saving and opening', async () => {
		const saving: ArchiveProgress[] = [];
		const {blob} = await writeProjectFile(large(), {
			onProgress(progress) {
				saving.push(progress);
			},
		});
		expectProgress(saving);

		const opening: ArchiveProgress[] = [];
		await readProjectFile(blob, NAME, {
			onProgress(progress) {
				opening.push(progress);
			},
		});
		// Entries are opened sources first, then the thumbnail.
		const sourceProgress = opening.filter((progress) =>
			progress.path.startsWith('sources/'),
		);
		expect(sourceProgress.length).toBeGreaterThan(3);
		expect(opening.at(-1)!.fraction).toBe(1);
	});

	it.each(['save', 'open'])('stops a %s part-way', async (job) => {
		const blob = await saved(large());
		const controller = new AbortController();
		const seen: number[] = [];
		const options = {
			signal: controller.signal,
			onProgress({fraction}: ArchiveProgress) {
				seen.push(fraction);
				if (fraction > 0) {
					controller.abort();
				}
			},
		};
		const running =
			job === 'save'
				? writeProjectFile(large(), options)
				: readProjectFile(blob, NAME, options);

		await expect(running).rejects.toMatchObject({name: 'AbortError'});
		expect(seen.at(-1)).toBeLessThan(1);
	});

	it('starts nothing when already cancelled', async () => {
		const signal = AbortSignal.abort();
		await expect(
			writeProjectFile(projectInput(), {signal}),
		).rejects.toMatchObject({name: 'AbortError'});
		await expect(
			readProjectFile(new Blob(), NAME, {signal}),
		).rejects.toMatchObject({name: 'AbortError'});
	});
});

describe('format migrations', () => {
	it('runs each migrator in order', () => {
		const result = migrateProjectDocuments(
			{manifest: {steps: ''}, project: null, history: null},
			1,
			3,
			{
				1: (documents) => ({
					...documents,
					manifest: {steps: `${String(documents.manifest.steps)}a`},
				}),
				2: (documents) => ({
					...documents,
					manifest: {steps: `${String(documents.manifest.steps)}b`},
				}),
			},
		);

		expect(result.manifest).toStrictEqual({steps: 'ab'});
	});

	it('refuses a version with no migrator', () => {
		expect(() =>
			migrateProjectDocuments(
				{manifest: {}, project: null, history: null},
				1,
				2,
				{},
			),
		).toThrow('No migration from format 1');
	});
});

describe('projectFileName', () => {
	const date = new Date(2026, 0, 2, 3, 4, 5);

	it.each([
		['  Hello,  World! ', 'hello-world'],
		['Gece Sürüşü', 'gece-sürüşü'],
		['///', 'project'],
		[`${'a'.repeat(63)} bcd`, 'a'.repeat(63)],
	])('slugs %j', (name, slug) => {
		expect(projectFileName(name, date)).toBe(`${slug}-20260102-030405.glproj`);
	});
});

describe('records from the repository', () => {
	it('round-trips a project with pruned and undone history', async () => {
		const storage = new MemoryStorageAdapter();
		const {project, source} = await storage.createProject({
			name: 'photo.png',
			blob: new Blob([noise(2048)], {type: 'image/png'}),
			width: 64,
			height: 32,
		});
		for (let commit = 1; commit <= MAX_HISTORY_ENTRIES + 3; commit++) {
			await storage.commitStack({
				projectId: project.id,
				stack: stackOf(instance({mix: (commit % 100) / 100})),
				selectedInstanceId: 'abcd1234',
				label: `Commit ${commit}`,
				...(commit === 5 && {
					transform: {...IDENTITY_TRANSFORM, rotation: 180},
				}),
			});
		}

		await storage.undo(project.id);
		const current = (await storage.getProject(project.id))!;
		const history = await storage.getHistory(project.id);
		const {blob} = await writeProjectFile({
			project: current,
			sources: [source],
			history,
			appVersion: '0.3.0',
		});

		const contents = await readProjectFile(blob, NAME);
		expect(contents.history).toStrictEqual(history);
		expect(contents.project).toMatchObject({
			name: 'photo',
			historyHeadSeq: current.historyHeadSeq,
			historyMinSeq: 4,
			historyMaxSeq: MAX_HISTORY_ENTRIES + 3,
		});
	});
});
