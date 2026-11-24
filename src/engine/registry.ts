import type {EffectDefinition, EffectRegistry} from './types.ts';

export function createRegistry(
	definitions: readonly EffectDefinition[],
): EffectRegistry {
	const byType = new Map<string, EffectDefinition>();
	for (const definition of definitions) {
		if (byType.has(definition.type)) {
			throw new Error(`Duplicate effect type "${definition.type}"`);
		}

		byType.set(definition.type, definition);
	}

	const ordered = Object.freeze([...definitions]);
	return {
		get: (type) => byType.get(type),
		list: () => ordered,
	};
}
