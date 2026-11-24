import {createStore, type StoreApi} from 'zustand/vanilla';
import type {EffectStack, ParamValue} from '../engine/types.ts';

export type TransientDragOverlay = {
	instanceId: string;
	params: Readonly<Record<string, ParamValue>>;
	mix?: number;
};

/**
 Dedicated store for high-frequency interactive drags (sliders, angle dial,
 split divider). Updating this store never notifies subscribers of the main
 `appStore`, so 60 fps dragging only re-renders the narrow control subscribed
 to its own parameter.

 Recommended narrow subscription in a parameter control component:
 ```ts
 const dragValue = useStore(
   transientStore,
   (state) =>
     state.activeDrag?.instanceId === instanceId
       ? state.activeDrag.params[paramKey]
       : undefined,
 );
 ```
 */
export type TransientState = {
	activeDrag: TransientDragOverlay | null;
	splitPosition: number | null;
};

export type TransientStore = StoreApi<TransientState>;

export function createTransientStore(): TransientStore {
	return createStore<TransientState>(() => ({
		activeDrag: null,
		splitPosition: null,
	}));
}

export function applyTransientDragToStack(
	stack: EffectStack,
	drag: TransientDragOverlay | null,
): EffectStack {
	if (!drag) {
		return stack;
	}

	let changed = false;
	const instances = stack.instances.map((instance) => {
		if (instance.id !== drag.instanceId) {
			return instance;
		}

		changed = true;
		return {
			...instance,
			params: {
				...instance.params,
				...drag.params,
			},
			mix: drag.mix === undefined ? instance.mix : drag.mix,
		};
	});

	return changed ? {...stack, instances} : stack;
}
