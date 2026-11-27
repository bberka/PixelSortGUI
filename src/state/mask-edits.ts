// Changes to one instance's mask (product.md F29).
import type {
	InstanceMask,
	MaskImageFit,
	MaskKind,
} from '../engine/mask/types.ts';
import {validateMask} from '../engine/mask/validate.ts';
import type {EffectStack} from '../engine/types.ts';

// The settings of a mask a control changes. A field the kind lacks is ignored.
export type MaskPatch = {
	readonly invert?: boolean;
	readonly feather?: number;
	readonly range?: readonly [number, number];
	readonly softness?: number;
	readonly source?: string;
	readonly fit?: MaskImageFit;
};

export type MaskOverlaySettings = {
	// "Show mask".
	readonly visible: boolean;
	// Integer percent, `MIN_OVERLAY_OPACITY`..100.
	readonly opacity: number;
};

export const MIN_OVERLAY_OPACITY = 10;

export const DEFAULT_MASK_OVERLAY: MaskOverlaySettings = {
	visible: true,
	opacity: 50,
};

export function createMask(kind: MaskKind): InstanceMask {
	return validateMask({kind})!;
}

// A mask this version does not understand stays as it is.
export function patchMask(mask: InstanceMask, patch: MaskPatch): InstanceMask {
	return validateMask({...mask, ...patch}) ?? mask;
}

// The fields `patch` names, with the values `mask` ended up holding.
export function validatedPatch(mask: InstanceMask, patch: MaskPatch) {
	return Object.fromEntries(
		Object.entries(mask).filter(([key]) => Object.hasOwn(patch, key)),
	) as MaskPatch;
}

// `stack` with the mask of one instance replaced, or removed for `undefined`.
export function withMask(
	stack: EffectStack,
	instanceId: string,
	mask: InstanceMask | undefined,
): EffectStack {
	return {
		...stack,
		instances: stack.instances.map((instance) => {
			if (instance.id !== instanceId) {
				return instance;
			}

			const next = {...instance, mask};
			if (!mask) {
				delete next.mask;
			}

			return next;
		}),
	};
}
