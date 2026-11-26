import {IDBFactory, IDBKeyRange as FakeKeyRange} from 'fake-indexeddb';
import {describe, expect, it} from 'vite-plus/test';
import {
	IDENTITY_TRANSFORM,
	type SourceTransform,
} from '../../src/engine/transform.ts';
import type {EffectStack} from '../../src/engine/types.ts';
import {
	IndexedDbRepository,
	MemoryStorageAdapter,
	StorageValidationError,
	openDatabase,
	repairProjectGeometry,
	resolveStoredGeometry,
	type ProjectRecord,
	type StorageRepository,
} from '../../src/storage/index.ts';

const EMPTY: EffectStack = {schemaVersion: 1, instances: []};

const CROPPED: SourceTransform = {
	rotation: 90,
	flipX: false,
	flipY: true,
	crop: {x: 10, y: 20, width: 100, height: 200},
	resize: {width: 50, height: 100, filter: 'bilinear'},
};

describe('resolveStoredGeometry', () => {
	it('sizes a valid transform without repairing it', () => {
		expect(resolveStoredGeometry(400, 300, CROPPED)).toEqual({
			transform: CROPPED,
			effectiveWidth: 50,
			effectiveHeight: 100,
			repaired: false,
		});
	});

	it('reads a missing transform as the identity without a repair', () => {
		expect(resolveStoredGeometry(400, 300, undefined)).toEqual({
			transform: IDENTITY_TRANSFORM,
			effectiveWidth: 400,
			effectiveHeight: 300,
			repaired: false,
		});
	});

	const invalid: ReadonlyArray<[string, unknown]> = [
		['null', null],
		['a string', 'rotate'],
		['an empty object', {}],
		['an unknown rotation', {...IDENTITY_TRANSFORM, rotation: 45}],
		['a missing flip', {rotation: 0, flipY: false, crop: null, resize: null}],
		['a missing crop', {rotation: 0, flipX: false, flipY: false, resize: null}],
		['a missing resize', {rotation: 0, flipX: false, flipY: false, crop: null}],
		['a crop that is not an object', {...IDENTITY_TRANSFORM, crop: 5}],
		[
			'a crop outside the image',
			{...IDENTITY_TRANSFORM, crop: {x: 399, y: 0, width: 2, height: 1}},
		],
		[
			'a resize past the side limit',
			{
				...IDENTITY_TRANSFORM,
				resize: {width: 20_000, height: 1, filter: 'lanczos3'},
			},
		],
		[
			'an unknown filter',
			{
				...IDENTITY_TRANSFORM,
				resize: {width: 2, height: 2, filter: 'cubic'},
			},
		],
	];

	for (const [name, value] of invalid) {
		it(`repairs ${name} to the identity without throwing`, () => {
			expect(resolveStoredGeometry(400, 300, value)).toEqual({
				transform: IDENTITY_TRANSFORM,
				effectiveWidth: 400,
				effectiveHeight: 300,
				repaired: true,
			});
		});
	}

	it('corrects a stale cached size and leaves a correct record alone', () => {
		const record = {
			sourceWidth: 400,
			sourceHeight: 300,
			transform: CROPPED,
			effectiveWidth: 400,
			effectiveHeight: 300,
		} as ProjectRecord;
		const fixed = repairProjectGeometry(record);

		expect([fixed.effectiveWidth, fixed.effectiveHeight]).toEqual([50, 100]);
		expect(repairProjectGeometry(fixed)).toBe(fixed);
	});
});

const adapters: ReadonlyArray<[string, () => Promise<StorageRepository>]> = [
	[
		'IndexedDbRepository',
		async () =>
			new IndexedDbRepository(
				await openDatabase({indexedDB: new IDBFactory()}),
				{keyRange: FakeKeyRange},
			),
	],
	['MemoryStorageAdapter', async () => new MemoryStorageAdapter()],
];

for (const [name, createRepository] of adapters) {
	describe(`stored geometry: ${name}`, () => {
		const setup = async () => {
			const repository = await createRepository();
			const {project} = await repository.createProject({
				name: 'geometry.png',
				blob: new Blob([new Uint8Array([1, 2, 3])], {type: 'image/png'}),
				width: 400,
				height: 300,
			});
			const commit = async (transform?: SourceTransform) =>
				repository.commitStack({
					projectId: project.id,
					stack: EMPTY,
					selectedInstanceId: null,
					transform,
					label: 'step',
				});
			return {repository, project, commit};
		};

		it('creates a project and its first entry with the identity', async () => {
			const {repository, project} = await setup();

			expect(project).toMatchObject({
				transform: IDENTITY_TRANSFORM,
				effectiveWidth: 400,
				effectiveHeight: 300,
			});
			const [initial] = await repository.getHistory(project.id);
			expect(initial.transform).toEqual(IDENTITY_TRANSFORM);
		});

		it('snapshots the transform per commit, keeps it when omitted, and restores it on undo, redo and jump', async () => {
			const {repository, project, commit} = await setup();
			await commit(CROPPED);
			const kept = await commit();

			expect(kept.entry.transform).toEqual(CROPPED);
			expect(kept.project.effectiveWidth).toBe(50);

			await repository.undo(project.id);
			const undone = await repository.undo(project.id);
			expect(undone?.project).toMatchObject({
				transform: IDENTITY_TRANSFORM,
				effectiveWidth: 400,
				effectiveHeight: 300,
			});
			const redone = await repository.redo(project.id);
			expect(redone?.project).toMatchObject({
				transform: CROPPED,
				effectiveWidth: 50,
				effectiveHeight: 100,
			});
			await repository.jumpToHistory(project.id, 0);
			expect(await repository.getProject(project.id)).toMatchObject({
				transform: IDENTITY_TRANSFORM,
				effectiveWidth: 400,
			});
		});

		it('rejects an invalid transform and keeps the redo branch', async () => {
			const {repository, project, commit} = await setup();
			await commit(CROPPED);
			await repository.undo(project.id);

			await expect(
				commit({
					...IDENTITY_TRANSFORM,
					crop: {x: 0, y: 0, width: 401, height: 1},
				}),
			).rejects.toThrow(StorageValidationError);
			expect(await repository.getHistory(project.id)).toHaveLength(2);
			expect((await repository.redo(project.id))?.project.transform).toEqual(
				CROPPED,
			);
		});

		it('duplicates the transform, its history, and centres the view on the new size', async () => {
			const {repository, project, commit} = await setup();
			await commit(CROPPED);

			const copy = await repository.duplicateProject(project.id);

			expect(copy).toMatchObject({
				transform: CROPPED,
				effectiveWidth: 50,
				effectiveHeight: 100,
				viewState: {centerX: 25, centerY: 50},
			});
			const history = await repository.getHistory(copy.id);
			expect(history.map((entry) => entry.transform)).toEqual([
				IDENTITY_TRANSFORM,
				CROPPED,
			]);
		});
	});
}
