import {useEffect, useState} from 'react';
import {useAppRuntime, useAppStore} from '@/app/runtime-context.tsx';
import {maskGridSize} from '@/engine/mask/grid.ts';
import {validateMask} from '@/engine/mask/validate.ts';
import type {EffectInstance} from '@/engine/types.ts';
import {useSourcePreview} from '@/features/params/use-source-preview.ts';
import {selectEditingSide} from '@/state/split-sides.ts';

/**
 Whether the instance's mask cannot be applied: a kind this version does not
 know, a painted mask or mask image that is not stored or has the wrong size, or
 one the renderer reported as unreadable (product.md F29, "Missing mask").
 */
export function useMaskMissing(instance: EffectInstance): boolean {
	const {repository} = useAppRuntime().bundle;
	const mask = instance.mask ? validateMask(instance.mask) : undefined;
	const asset = mask?.kind === 'paint' ? mask.asset : '';
	// A write may have stored the missing bytes again.
	const revision = useAppStore((state) => state.activeProject?.updatedAt);
	const image = useSourcePreview(
		mask?.kind === 'image' ? mask.source : '',
		revision,
	);
	const sourceWidth = useAppStore(
		(state) => state.activeProject?.sourceWidth ?? 0,
	);
	const sourceHeight = useAppStore(
		(state) => state.activeProject?.sourceHeight ?? 0,
	);
	const unreadable = useAppStore((state) => {
		const {frame} =
			selectEditingSide(state) === 'a' ? state.renderA : state.render;
		return Boolean(
			frame &&
			!frame.sourcesPending &&
			frame.warnings.some(
				(warning) =>
					warning.instanceId === instance.id && warning.code === 'missing-mask',
			),
		);
	});
	const [unstored, setUnstored] = useState('');

	useEffect(() => {
		if (asset === '') {
			return;
		}

		let cancelled = false;
		void repository
			.getMask(asset)
			.then((record) => {
				if (cancelled) {
					return;
				}

				const grid = maskGridSize(sourceWidth, sourceHeight);
				const usable =
					record?.width === grid.width && record.height === grid.height;
				setUnstored(usable ? '' : asset);
			})
			// A failed read says nothing about the mask.
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [asset, repository, revision, sourceHeight, sourceWidth]);

	if (!instance.mask) {
		return false;
	}

	return (
		!mask ||
		unreadable ||
		(asset !== '' && unstored === asset) ||
		image.status === 'missing'
	);
}
