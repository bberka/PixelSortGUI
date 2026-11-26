// Which sources a project uses (persistence.md section 8.5). Free of storage
// and archive code, so both adapters and the archive worker share it.
import type {EffectStack} from '../engine/types.ts';
import {StorageValidationError, type ProjectRecord} from './types.ts';

export const MAX_EXTRA_SOURCES = 8;
export const EXTRA_SOURCE_LIMIT_MESSAGE = `A project can use at most ${MAX_EXTRA_SOURCES} extra blend images.`;

const SOURCE_HASH = /^[\da-f]{64}$/;

// A project's current stacks, or those of one history entry.
export type StackPair = {stack: EffectStack; stackA?: EffectStack};

// Any parameter shaped like a hash, so an effect this build does not know still
// keeps its images. Only `image` parameters store such a string.
function isReference(value: unknown): value is string {
	return typeof value === 'string' && SOURCE_HASH.test(value);
}

// Adds the references of both stacks to `into`. A damaged stack adds nothing, so
// a database upgrade cannot fail on one.
export function addSourceReferences(
	{stack, stackA}: Partial<StackPair>,
	into: Set<string> = new Set<string>(),
): Set<string> {
	for (const current of [stack, stackA]) {
		if (!Array.isArray(current?.instances)) {
			continue;
		}

		for (const instance of current.instances) {
			for (const value of Object.values(instance?.params ?? {})) {
				if (isReference(value)) {
					into.add(value);
				}
			}
		}
	}

	return into;
}

// The extra sources of one pair of stacks.
export function extraSourceHashes(
	stacks: StackPair,
	sourceHash: string,
): Set<string> {
	const hashes = addSourceReferences(stacks);
	hashes.delete(sourceHash);
	return hashes;
}

/**
 Every source of a project: the primary one first, then the extra ones of its
 stacks and of the history entries given, sorted.
 */
export function projectSourceHashes(
	project: StackPair & {sourceHash: string},
	history?: ReadonlyArray<Partial<StackPair>> | null,
): string[] {
	const hashes = addSourceReferences(project);
	for (const entry of history ?? []) {
		addSourceReferences(entry, hashes);
	}

	hashes.delete(project.sourceHash);
	return [project.sourceHash, ...[...hashes].toSorted()];
}

// The value of `ProjectRecord.referencedSourceHashes`.
export function referencedSourceHashes(
	project: StackPair & {sourceHash: string},
	history: ReadonlyArray<Partial<StackPair>>,
): string[] {
	return projectSourceHashes(project, history).toSorted();
}

/**
 Checks the stacks a write would give `project`. Throws when they pass the cap
 by adding a source; returns the sources the project did not refer to before,
 which the caller must find in storage.
 */
export function addedSourceReferences(
	project: ProjectRecord,
	next: StackPair,
): string[] {
	const current = extraSourceHashes(project, project.sourceHash);
	const extras = [...extraSourceHashes(next, project.sourceHash)];
	if (
		extras.length > MAX_EXTRA_SOURCES &&
		extras.some((hash) => !current.has(hash))
	) {
		throw new StorageValidationError(EXTRA_SOURCE_LIMIT_MESSAGE);
	}

	const known = new Set(project.referencedSourceHashes);
	return extras.filter((hash) => !known.has(hash));
}

export function missingSourceError(sha256: string): StorageValidationError {
	return new StorageValidationError(`Image "${sha256}" is not stored`);
}

// `stack` with every source reference emptied, for a preset.
export function stripSourceReferences(stack: EffectStack): EffectStack {
	return {
		...stack,
		instances: stack.instances.map((instance) => {
			const entries = Object.entries(instance.params);
			if (entries.every(([, value]) => !isReference(value))) {
				return instance;
			}

			return {
				...instance,
				params: Object.fromEntries(
					entries.map(([key, value]) => [key, isReference(value) ? '' : value]),
				),
			};
		}),
	};
}
