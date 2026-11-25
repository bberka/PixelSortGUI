import {useTransientStore} from '@/app/runtime-context.tsx';
import type {ParamValue} from '@/engine/types.ts';

/**
 The value of one parameter while it is being dragged, or `undefined` when no
 drag touches it. Subscribing to the transient store keeps a drag from
 re-rendering the panel: only the control whose own value changed re-renders.
 */
export function useTransientParam(
	instanceId: string,
	paramKey: string,
): ParamValue | undefined {
	return useTransientStore((state) => {
		const drag = state.activeDrag;
		return drag?.instanceId === instanceId ? drag.params[paramKey] : undefined;
	});
}

export function useTransientMix(instanceId: string): number | undefined {
	return useTransientStore((state) => {
		const drag = state.activeDrag;
		return drag?.instanceId === instanceId ? drag.mix : undefined;
	});
}
