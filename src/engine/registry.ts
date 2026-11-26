import type {EffectDefinition, EffectRegistry} from './types.ts';

// The effects a user is offered: those not marked `unlisted`, in registration order.
export function listedEffects(
	registry: EffectRegistry,
): readonly EffectDefinition[] {
	return registry.list().filter((definition) => !definition.unlisted);
}

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
