// Painted mask storage and reference counting (persistence.md section 8.6,
// product.md F29), against both adapters.
import {IDBObjectStore} from 'fake-indexeddb';
import {describe, expect, it, vi} from 'vite-plus/test';
import {encodeMaskAsset} from '../../src/engine/mask/asset.ts';
import type {InstanceMask} from '../../src/engine/mask/types.ts';
import type {EffectInstance, EffectStack} from '../../src/engine/types.ts';
import {presetsValue} from '../../src/storage/backup-format.ts';
import {
	StorageQuotaError,
	StorageValidationError,
	hashBlobSha256,
	type NewMask,
	type NewSource,
	type StorageRepository,
} from '../../src/storage/index.ts';
import {adapters, indexedDbSetup} from './backup-fixtures.ts';
import {instance, noise, stackOf} from './project-fixtures.ts';
import {SOURCE_SIZE} from './project-transfer-fixtures.ts';
import {allRecords} from './idb-helpers.ts';

const LIMIT = 'A project can use at most 8 extra blend and mask images.';

// A real asset: a painted grid, by default small, whose pixels are all `value`.
async function asset(value: number, size = {width: 4, height: 3}) {
	const {sha256, width, height, compressed} = await encodeMaskAsset({
		...size,
		data: new Uint8Array(size.width * size.height).fill(value),
	});
	return {sha256, width, height, blob: new Blob([compressed])};
}

const paint = (mask: {sha256: string}): InstanceMask => ({
	kind: 'paint',
	asset: mask.sha256,
	invert: false,
	feather: 0,
});
const imageMask = (source: string): InstanceMask => ({
	kind: 'image',
	source,
	fit: 'cover',
	invert: false,
	feather: 0,
});
const luma: InstanceMask = {
	kind: 'luma',
	range: [0.5, 1],
	softness: 0.1,
	invert: false,
	feather: 0,
};

function maskedStack(...masks: InstanceMask[]): EffectStack {
	return {
		schemaVersion: 2,
		instances: masks.map((mask, index) => instance({id: `m${index}`, mask})),
	};
}

const painted = (...assets: Array<{sha256: string}>) =>
	maskedStack(...assets.map((item) => paint(item)));

async function add(repository: StorageRepository, seed = 1) {
	const {project} = await repository.createProject({
		name: `Image ${seed}.png`,
		blob: new Blob([noise(2000 + seed, seed)], {type: 'image/png'}),
		...SOURCE_SIZE,
	});
	return project;
}

async function commit(
	repository: StorageRepository,
	projectId: string,
	stack: EffectStack,
	extra: {
		stackA?: EffectStack;
		newMasks?: NewMask[];
		newSource?: NewSource;
	} = {},
) {
	const {project} = await repository.commitStack({
		projectId,
		stack,
		selectedInstanceId: null,
		label: 'Paint mask',
		...extra,
	});
	return project;
}

async function picked(seed: number): Promise<NewSource> {
	const blob = new Blob([noise(3000, seed)], {type: 'image/png'});
	return {
		sha256: await hashBlobSha256(blob),
		blob,
		mimeType: 'image/png',
		...SOURCE_SIZE,
	};
}

async function everything(repository: StorageRepository, id: string) {
	return {
		project: await repository.getProject(id),
		history: await repository.getHistory(id),
		sources: await repository.getSourceSizes(),
	};
}

const stored = async (repository: StorageRepository, ...masks: NewMask[]) =>
	Promise.all(
		masks.map(async ({sha256}) => Boolean(await repository.getMask(sha256))),
	);

const sorted = (...masks: NewMask[]) =>
	masks.map(({sha256}) => sha256).toSorted();

describe.each(adapters)('masks on $name', ({create}) => {
	it('stores a new mask with the commit that names it, once', async () => {
		const {repository} = await create({now: () => 500});
		const project = await add(repository);
		const [used, unused] = [await asset(1), await asset(2)];

		const updated = await commit(repository, project.id, painted(used), {
			newMasks: [used, unused, used],
		});

		expect(updated.referencedMaskHashes).toStrictEqual([used.sha256]);
		const record = (await repository.getMask(used.sha256))!;
		expect(record).toMatchObject({
			sha256: used.sha256,
			width: 4,
			height: 3,
			byteLength: used.blob.size,
			createdAt: 500,
		});
		expect(await record.blob.arrayBuffer()).toStrictEqual(
			await used.blob.arrayBuffer(),
		);
		expect(await stored(repository, unused)).toStrictEqual([false]);

		// A stored hash is trusted: the record is not replaced.
		await commit(repository, project.id, painted(used), {
			newMasks: [{...used, blob: new Blob([new Uint8Array(99)])}],
		});
		expect(await repository.getMask(used.sha256)).toMatchObject({
			byteLength: used.blob.size,
		});
		repository.close();
	});

	it('writes nothing when a commit is refused', async () => {
		const {repository} = await create();
		const project = await add(repository);
		const [kept, fresh, absent] = [
			await asset(1),
			await asset(2),
			await asset(3),
		];
		await commit(repository, project.id, painted(kept), {newMasks: [kept]});
		await repository.undo(project.id);
		const before = await everything(repository, project.id);
		const source = await picked(40);
		const stack = maskedStack(
			paint(fresh),
			paint(absent),
			imageMask(source.sha256),
		);

		for (const attempt of [
			// A mask that is neither stored nor given.
			{stack, newMasks: [fresh], newSource: source},
			// An asset of the wrong shape.
			{stack: painted(fresh), newMasks: [{...fresh, width: 0}]},
			{stack: painted(fresh), newMasks: [{...fresh, height: 5_000_000}]},
			{stack: painted(fresh), newMasks: [{...fresh, blob: new Blob()}]},
			// An image that is not stored.
			{
				stack: maskedStack(paint(fresh), imageMask('9'.repeat(64))),
				newMasks: [fresh],
			},
		]) {
			await expect(
				commit(repository, project.id, attempt.stack, attempt),
			).rejects.toThrow(StorageValidationError);
		}

		await expect(
			repository.saveProjectStack(project.id, painted(absent)),
		).rejects.toThrow(`Mask "${absent.sha256}" is not stored`);

		expect(await everything(repository, project.id)).toStrictEqual(before);
		expect(await stored(repository, kept, fresh, absent)).toStrictEqual([
			true,
			false,
			false,
		]);
		repository.close();
	});

	it('keeps masks for undo and drops them with a discarded redo branch', async () => {
		const {repository} = await create();
		const project = await add(repository);
		const [first, second, sideA, third] = [
			await asset(1),
			await asset(2),
			await asset(3),
			await asset(4),
		];
		await commit(repository, project.id, painted(first), {newMasks: [first]});
		const two = await commit(repository, project.id, painted(second), {
			stackA: painted(sideA),
			newMasks: [second, sideA],
		});
		expect(two.referencedMaskHashes).toStrictEqual(
			sorted(first, second, sideA),
		);

		const undone = await repository.undo(project.id);
		expect(undone?.project.referencedMaskHashes).toStrictEqual(
			two.referencedMaskHashes,
		);
		expect(await repository.cleanupOrphanedMasks()).toBe(0);
		await repository.redo(project.id);
		await repository.jumpToHistory(project.id, 1);

		const branched = await commit(repository, project.id, painted(third), {
			newMasks: [third],
		});
		expect(branched.referencedMaskHashes).toStrictEqual(sorted(first, third));
		// Left for the idle cleanup.
		expect(await stored(repository, second, sideA)).toStrictEqual([true, true]);
		expect(await repository.cleanupOrphanedMasks()).toBe(2);
		expect(await stored(repository, first, second, sideA, third)).toStrictEqual(
			[true, false, false, true],
		);
		repository.close();
	});

	it('drops the reference of a mask that leaves the history window', async () => {
		const {repository} = await create();
		const project = await add(repository);
		const old = await asset(1);
		await commit(repository, project.id, painted(old), {newMasks: [old]});
		let latest = project;
		for (let step = 0; step < 201; step++) {
			latest = await commit(repository, project.id, stackOf());
		}

		expect(latest.referencedMaskHashes).toStrictEqual([]);
		expect(await repository.cleanupOrphanedMasks()).toBe(1);
		repository.close();
	});

	it('shares masks between a project and its copy until both are deleted', async () => {
		const {repository} = await create();
		const project = await add(repository);
		const [undoOnly, current] = [await asset(1), await asset(2)];
		await commit(repository, project.id, painted(undoOnly), {
			newMasks: [undoOnly],
		});
		await commit(repository, project.id, painted(current), {
			newMasks: [current],
		});

		const copy = await repository.duplicateProject(project.id);
		expect(copy.referencedMaskHashes).toStrictEqual(sorted(undoOnly, current));
		await repository.deleteProject(project.id);
		expect(await stored(repository, undoOnly, current)).toStrictEqual([
			true,
			true,
		]);
		expect(await repository.cleanupOrphanedMasks()).toBe(0);

		await repository.deleteProject(copy.id);
		expect(await stored(repository, undoOnly, current)).toStrictEqual([
			false,
			false,
		]);
		repository.close();
	});

	it('recomputes the references when a stack is saved or a file imported', async () => {
		const {repository} = await create();
		const project = await add(repository);
		// An export needs the grid of the source.
		const mask = await asset(1, SOURCE_SIZE);
		await commit(repository, project.id, painted(mask), {newMasks: [mask]});
		const other = await add(repository, 2);
		await repository.deleteProject(other.id);

		const saved = await repository.saveProjectStack(project.id, stackOf());
		// History still uses it.
		expect(saved.referencedMaskHashes).toStrictEqual([mask.sha256]);

		const {blob, fileName} = await repository.exportProjectFile(project.id);
		const imported = await repository.importProjectFile(blob, fileName);
		expect(imported.project.referencedMaskHashes).toStrictEqual([mask.sha256]);
		repository.close();
	});

	it('counts mask images as extra sources, with one cap and message', async () => {
		const {repository} = await create();
		const project = await add(repository);
		const owner = await add(repository, 2);
		await commit(
			repository,
			project.id,
			maskedStack(imageMask(owner.sourceHash)),
		);
		const blends: EffectInstance[] = [];
		for (let index = 0; index < 7; index++) {
			const other = await add(repository, 10 + index);
			blends.push(
				instance({
					id: `b${index}`,
					type: 'imageBlend',
					params: {image: other.sourceHash},
				}),
			);
		}

		const full = stackOf(
			...blends,
			instance({id: 'mask', mask: imageMask(owner.sourceHash)}),
		);
		await commit(repository, project.id, full);
		const ninth = await picked(50);
		await expect(
			commit(repository, project.id, full, {
				stackA: maskedStack(imageMask(ninth.sha256)),
				newSource: ninth,
			}),
		).rejects.toThrow(LIMIT);
		expect(await repository.hasSource(ninth.sha256)).toBe(false);

		// AC-F29.11: the image survives the project it was picked from.
		await repository.deleteProject(owner.id);
		expect(await repository.cleanupOrphanedSources()).toBe(0);
		expect(await repository.hasSource(owner.sourceHash)).toBe(true);
		await repository.deleteProject(project.id);
		expect(await repository.hasSource(owner.sourceHash)).toBe(false);
		repository.close();
	});

	it('stores an image picked for a mask with its commit', async () => {
		const {repository} = await create();
		const project = await add(repository);
		const source = await picked(60);

		const updated = await commit(
			repository,
			project.id,
			maskedStack(imageMask(source.sha256)),
			{newSource: source},
		);

		expect(updated.referencedSourceHashes).toContain(source.sha256);
		expect(await repository.hasSource(source.sha256)).toBe(true);
		repository.close();
	});

	it('keeps only brightness masks in a preset (AC-F29.15)', async () => {
		const {repository} = await create();
		const mask = await asset(1);

		const preset = await repository.createPreset({
			name: 'All',
			stack: maskedStack(paint(mask), imageMask('9'.repeat(64)), luma),
		});

		expect(preset.stack.schemaVersion).toBe(2);
		expect(preset.stack.instances.map((item) => item.mask)).toStrictEqual([
			undefined,
			undefined,
			luma,
		]);
		expect(preset.stack.instances[0]).not.toHaveProperty('mask');
		expect(await repository.getPreset(preset.id)).toStrictEqual(preset);

		const stripped = await repository.createPreset({
			name: 'None left',
			stack: painted(mask),
		});
		expect(stripped.stack).toStrictEqual(stackOf(instance({id: 'm0'})));

		// Backup export and import read presets through this.
		const [read] = presetsValue({
			presets: [{...preset, stack: maskedStack(paint(mask))}],
		});
		expect(read.stack).toStrictEqual(stackOf(instance({id: 'm0'})));
		repository.close();
	});
});

describe('masks in IndexedDB', () => {
	it('leaves no asset behind when the transaction aborts', async () => {
		const {repository, database} = await indexedDbSetup();
		const project = await add(repository);
		const mask = await asset(1);
		const before = await everything(repository, project.id);
		const {put} = IDBObjectStore.prototype;
		const spy = vi
			.spyOn(IDBObjectStore.prototype, 'put')
			.mockImplementation(function (this: IDBObjectStore, value, key) {
				// The last write of a commit, after the asset.
				if (this.name === 'projects') {
					throw new DOMException('Disk full', 'QuotaExceededError');
				}

				return put.call(this, value, key);
			});

		await expect(
			commit(repository, project.id, painted(mask), {newMasks: [mask]}),
		).rejects.toThrow(StorageQuotaError);
		spy.mockRestore();

		expect(await everything(repository, project.id)).toStrictEqual(before);
		expect(await allRecords(database, 'masks')).toStrictEqual([]);
		repository.close();
	});

	it('checks the quota for new mask bytes only', async () => {
		let quota = 1_000_000;
		const {repository} = await indexedDbSetup({
			storageManager: {estimate: async () => ({usage: 0, quota})},
		});
		const project = await add(repository);
		const [kept, fresh] = [await asset(1), await asset(2)];
		await commit(repository, project.id, painted(kept), {newMasks: [kept]});
		quota = 1;
		const before = await everything(repository, project.id);

		await expect(
			commit(repository, project.id, painted(fresh), {newMasks: [fresh]}),
		).rejects.toThrow(StorageQuotaError);
		expect(await everything(repository, project.id)).toStrictEqual(before);
		expect(await stored(repository, fresh)).toStrictEqual([false]);

		await commit(repository, project.id, painted(kept), {newMasks: [kept]});
		repository.close();
	});

	it('keeps a project with a missing mask editable and restores it', async () => {
		const {repository, database} = await indexedDbSetup();
		const project = await add(repository);
		const mask = await asset(1);
		await commit(repository, project.id, painted(mask), {newMasks: [mask]});
		const transaction = database.transaction('masks', 'readwrite');
		transaction.objectStore('masks').clear();

		await commit(repository, project.id, painted(mask));
		expect(await stored(repository, mask)).toStrictEqual([false]);
		await commit(repository, project.id, painted(mask), {newMasks: [mask]});
		expect(await stored(repository, mask)).toStrictEqual([true]);
		repository.close();
	});
});
