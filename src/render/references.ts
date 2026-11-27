// What a stack reads besides the project source (engine.md sections 8.3 and
// 16.6). Types only from the engine, so none of it reaches the main bundle.
import type {EffectStack} from '../engine/types.ts';
import {addSourceReferences} from '../storage/extra-sources.ts';

const HASH = /^[\da-f]{64}$/;

export type StackReferences = {
	// Images named by `image` parameters and by image masks.
	sources: Set<string>;
	// Painted mask assets.
	masks: Set<string>;
};

export function stackReferences(stack: EffectStack): StackReferences {
	const sources = addSourceReferences({stack});
	const masks = new Set<string>();
	for (const {mask} of stack.instances) {
		if (mask?.kind === 'paint' && HASH.test(mask.asset)) {
			masks.add(mask.asset);
		} else if (mask?.kind === 'image' && HASH.test(mask.source)) {
			sources.add(mask.source);
		}
	}

	return {sources, masks};
}

// What an export or a `full` render needs.
export function enabledReferences(stack: EffectStack): StackReferences {
	return stackReferences({
		...stack,
		instances: stack.instances.filter((instance) => instance.enabled),
	});
}
