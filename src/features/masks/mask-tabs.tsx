import type {ReactNode} from 'react';
import {
	MaskFeatherControl,
	MaskFitControl,
	MaskImageControl,
	MaskRangeControl,
	MaskSetup,
	MaskSoftnessControl,
	OverlayOpacityControl,
} from './mask-controls.tsx';
import {validateMask} from '@/engine/mask/validate.ts';
import type {EffectInstance} from '@/engine/types.ts';

export type MaskTab = {
	// Starts with `$`, so it clashes with no parameter key.
	readonly key: string;
	readonly label: string;
	readonly content: ReactNode;
};

/**
 The mask tabs of the one-control phone panel (DESIGN.md section 7.4).
 */
export function maskTabs(
	instance: EffectInstance,
	showMask: boolean,
): MaskTab[] {
	const {id: instanceId} = instance;
	const tabs: MaskTab[] = [
		{
			key: '$mask',
			label: 'Mask',
			content: <MaskSetup key={instanceId} compact instance={instance} />,
		},
	];
	const mask = instance.mask ? validateMask(instance.mask) : undefined;
	if (!mask) {
		return tabs;
	}

	tabs.push({
		key: '$maskFeather',
		label: 'Feather',
		content: <MaskFeatherControl instanceId={instanceId} mask={mask} />,
	});
	if (showMask) {
		tabs.push({
			key: '$maskOverlay',
			label: 'Overlay',
			content: <OverlayOpacityControl instanceId={instanceId} />,
		});
	}

	if (mask.kind === 'luma') {
		tabs.push(
			{
				key: '$maskRange',
				label: 'Range',
				content: <MaskRangeControl instanceId={instanceId} mask={mask} />,
			},
			{
				key: '$maskSoftness',
				label: 'Softness',
				content: <MaskSoftnessControl instanceId={instanceId} mask={mask} />,
			},
		);
	} else if (mask.kind === 'image') {
		tabs.push(
			{
				key: '$maskImage',
				label: 'Mask image',
				content: <MaskImageControl instanceId={instanceId} mask={mask} />,
			},
			{
				key: '$maskFit',
				label: 'Fit',
				content: <MaskFitControl instanceId={instanceId} mask={mask} />,
			},
		);
	}

	return tabs;
}
