// Which painted masks a project uses, new mask assets and preset stripping
// (persistence.md section 8.6). Both adapters use these.
import {MASK_PIXEL_CAP} from '../engine/mask/grid.ts';
import {stackSchemaVersion, type EffectStack} from '../engine/types.ts';
import {stripSourceReferences, type StackPair} from './extra-sources.ts';
import {
	StorageValidationError,
	type MaskRecord,
	type NewMask,
	type ProjectRecord,
} from './types.ts';

const MASK_HASH = /^[\da-f]{64}$/;

// A mask as a stored stack may hold it, which need not be valid.
type StoredMask = {kind?: unknown; asset?: unknown} | null | undefined;

// Adds the painted assets of both stacks to `into`. A damaged stack adds
// nothing, so a database upgrade cannot fail on one.
export function addMaskReferences(
	{stack, stackA}: Partial<StackPair>,
	into: Set<string> = new Set<string>(),
): Set<string> {
	for (const current of [stack, stackA]) {
		if (!Array.isArray(current?.instances)) {
			continue;
		}

		for (const instance of current.instances) {
			const mask = instance?.mask as StoredMask;
			if (
				mask?.kind === 'paint' &&
				typeof mask.asset === 'string' &&
				MASK_HASH.test(mask.asset)
			) {
				into.add(mask.asset);
			}
		}
	}

	return into;
}

// The value of `ProjectRecord.referencedMaskHashes`.
export function referencedMaskHashes(
	project: Partial<StackPair>,
	history: ReadonlyArray<Partial<StackPair>>,
): string[] {
	const hashes = addMaskReferences(project);
	for (const entry of history) {
		addMaskReferences(entry, hashes);
	}

	return [...hashes].toSorted();
}

// The masks `next` names that the project did not refer to before, which the
// caller must find in storage.
export function addedMaskReferences(
	project: ProjectRecord,
	next: StackPair,
): string[] {
	const known = new Set(project.referencedMaskHashes);
	return [...addMaskReferences(next)].filter((hash) => !known.has(hash));
}

// Checks the shape of each new asset, not its hash: the maker computes that and
// every reader verifies it.
export function validateNewMasks(newMasks: readonly NewMask[]): void {
	for (const {sha256, width, height, blob} of newMasks) {
		if (
			!MASK_HASH.test(sha256) ||
			!Number.isSafeInteger(width) ||
			!Number.isSafeInteger(height) ||
			width < 1 ||
			height < 1 ||
			width * height > MASK_PIXEL_CAP ||
			!(blob instanceof Blob) ||
			blob.size === 0
		) {
			throw new StorageValidationError(`Invalid mask "${sha256}"`);
		}
	}
}

// The records a commit stores for `newMasks`: one for each hash that a stack
// names, so a commit never leaves a blob nothing uses.
export function newMaskRecords(
	newMasks: readonly NewMask[],
	stacks: StackPair,
	createdAt: number,
): MaskRecord[] {
	const used = addMaskReferences(stacks);
	const records = new Map<string, MaskRecord>();
	for (const {sha256, width, height, blob} of newMasks) {
		if (used.has(sha256)) {
			records.set(sha256, {
				sha256,
				width,
				height,
				blob,
				byteLength: blob.size,
				createdAt,
			});
		}
	}

	return [...records.values()];
}

export function missingMaskError(sha256: string): StorageValidationError {
	return new StorageValidationError(`Mask "${sha256}" is not stored`);
}

// A preset belongs to no photo: it holds no image and keeps no painted or image
// mask. Brightness masks stay.
export function stripPresetReferences(stack: EffectStack): EffectStack {
	let removed = false;
	const instances = stripSourceReferences(stack).instances.map((instance) => {
		const mask = instance.mask as StoredMask;
		if (mask?.kind !== 'paint' && mask?.kind !== 'image') {
			return instance;
		}

		removed = true;
		const rest = {...instance};
		delete rest.mask;
		return rest;
	});

	return {
		...stack,
		instances,
		schemaVersion: removed
			? stackSchemaVersion(instances)
			: stack.schemaVersion,
	};
}
