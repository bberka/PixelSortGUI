import {clamp} from '../engine/math.ts';
import {defaultParams, validateParams} from '../engine/params.ts';
import {
	MAX_STACK_INSTANCES,
	STACK_SCHEMA_VERSION,
	type BlendMode,
	type EffectDefinition,
	type EffectInstance,
	type EffectRegistry,
	type EffectStack,
	type ParamSpec,
	type ParamValue,
} from '../engine/types.ts';
import {StorageValidationError} from '../storage/types.ts';

const INSTANCE_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const INSTANCE_ID_LENGTH = 8;
const MAX_UNBIASED_BYTE = 252; // 36 * 7

const VALID_BLEND_MODES: ReadonlySet<string> = new Set<BlendMode>([
	'normal',
	'lighten',
	'darken',
	'difference',
]);

export type RandomBytesSource = (
	bytes: Uint8Array<ArrayBuffer>,
) => Uint8Array<ArrayBuffer>;

function defaultGetRandomValues(
	bytes: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
	return globalThis.crypto.getRandomValues(bytes);
}

export function generateRandomSeed(
	getRandomValues: RandomBytesSource = defaultGetRandomValues,
): number {
	const bytes = new Uint8Array(4);
	getRandomValues(bytes);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return view.getUint32(0, true);
}

export function generateInstanceId(
	existingIds?: ReadonlySet<string>,
	getRandomValues: RandomBytesSource = defaultGetRandomValues,
): string {
	for (let attempt = 0; attempt < 64; attempt++) {
		let id = '';
		const buffer = new Uint8Array(16);
		while (id.length < INSTANCE_ID_LENGTH) {
			getRandomValues(buffer);
			for (const byte of buffer) {
				if (byte >= MAX_UNBIASED_BYTE) {
					continue;
				}

				id += INSTANCE_ID_ALPHABET[byte % 36];
				if (id.length === INSTANCE_ID_LENGTH) {
					break;
				}
			}
		}

		if (!existingIds?.has(id)) {
			return id;
		}
	}

	throw new Error('Failed to generate a unique effect instance id');
}

export function cloneParamValue(value: ParamValue): ParamValue {
	return Array.isArray(value) ? [value[0], value[1]] : value;
}

export function cloneParams(
	params: Readonly<Record<string, ParamValue>>,
): Record<string, ParamValue> {
	const copy: Record<string, ParamValue> = {};
	for (const [key, value] of Object.entries(params)) {
		copy[key] = cloneParamValue(value);
	}

	return copy;
}

export function cloneEffectInstance(instance: EffectInstance): EffectInstance {
	return {
		...instance,
		params: cloneParams(instance.params),
	};
}

export function cloneEffectStack(stack: EffectStack): EffectStack {
	return {
		schemaVersion: stack.schemaVersion,
		instances: stack.instances.map((instance) => cloneEffectInstance(instance)),
	};
}

export function createInstanceDefaults(
	definition: EffectDefinition,
	getRandomValues: RandomBytesSource = defaultGetRandomValues,
): Record<string, ParamValue> {
	const params = defaultParams(definition.params);
	for (const [key, spec] of Object.entries<ParamSpec>(definition.params)) {
		if (spec.kind === 'seed') {
			params[key] = generateRandomSeed(getRandomValues);
		}
	}

	return params;
}

export function createEffectInstance(
	type: string,
	registry: EffectRegistry,
	existingIds?: ReadonlySet<string>,
	getRandomValues: RandomBytesSource = defaultGetRandomValues,
): EffectInstance {
	const definition = registry.get(type);
	if (!definition) {
		throw new StorageValidationError(`Unknown effect type "${type}"`);
	}

	return {
		id: generateInstanceId(existingIds, getRandomValues),
		type: definition.type,
		version: definition.version,
		enabled: true,
		params: createInstanceDefaults(definition, getRandomValues),
		mix: 1,
		blend: 'normal',
	};
}

export function cloneInstanceWithNewId(
	instance: EffectInstance,
	existingIds: Set<string>,
	getRandomValues: RandomBytesSource = defaultGetRandomValues,
): EffectInstance {
	const id = generateInstanceId(existingIds, getRandomValues);
	existingIds.add(id);
	return {
		...cloneEffectInstance(instance),
		id,
	};
}

export function cloneStackWithNewIds(
	stack: EffectStack,
	existingIds?: ReadonlySet<string>,
	getRandomValues: RandomBytesSource = defaultGetRandomValues,
): EffectStack {
	const used = new Set<string>(existingIds);
	return {
		schemaVersion: STACK_SCHEMA_VERSION,
		instances: stack.instances.map((instance) =>
			cloneInstanceWithNewId(instance, used, getRandomValues),
		),
	};
}

export function assertStackCapacity(count: number): void {
	if (count > MAX_STACK_INSTANCES) {
		throw new StorageValidationError(
			`EffectStack cannot exceed ${MAX_STACK_INSTANCES} instances`,
		);
	}
}

export function normalizeMix(mix: number): number {
	return Number.isFinite(mix) ? Math.round(clamp(mix, 0, 1) * 100) / 100 : 1;
}

export function normalizeBlend(blend: BlendMode): BlendMode {
	return VALID_BLEND_MODES.has(blend) ? blend : 'normal';
}

export function validateSingleParam(
	definition: EffectDefinition,
	currentParams: Readonly<Record<string, ParamValue>>,
	paramKey: string,
	value: ParamValue,
): Record<string, ParamValue> {
	if (!Object.hasOwn(definition.params, paramKey)) {
		throw new StorageValidationError(
			`Unknown parameter "${paramKey}" for effect "${definition.type}"`,
		);
	}

	return validateParams(definition.params, {
		...currentParams,
		[paramKey]: value,
	});
}

export function getEffectLabel(
	instance: EffectInstance,
	registry: EffectRegistry,
): string {
	return registry.get(instance.type)?.label ?? instance.type;
}
