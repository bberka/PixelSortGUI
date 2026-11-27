import {useCallback, useEffect, useRef, type RefObject} from 'react';
import type {MaskOverlayImage} from './draw.ts';
import {
	useAppRuntime,
	useAppStore,
	useTransientStore,
} from '@/app/runtime-context.tsx';
import type {InstanceMask} from '@/engine/mask/types.ts';
import {validateMask} from '@/engine/mask/validate.ts';
import {canonicalJson} from '@/engine/types.ts';
import {patchMask} from '@/state/mask-edits.ts';
import {
	selectEditingSelectedId,
	selectEditingSide,
	selectEditingStack,
} from '@/state/split-sides.ts';
import {selectShowingOriginal} from '@/state/transient.ts';
import type {SplitSide} from '@/storage/types.ts';

type OverlayRequest = {
	readonly side: SplitSide;
	// The instance and the loaded image: another one's overlay is never shown.
	readonly target: string;
	readonly source: object;
	readonly mask: InstanceMask;
	// The mask itself, to see whether the shown overlay is current.
	readonly key: string;
	readonly width: number;
	readonly height: number;
};

type Shown = {
	readonly request: OverlayRequest;
	readonly bitmap: ImageBitmap;
};

// The mask as pixels of the overlay colour, the mask value as their alpha.
async function tintMask(
	mask: Uint8Array,
	width: number,
	height: number,
): Promise<ImageBitmap> {
	const [red = 0, green = 0, blue = 0] = globalThis
		.getComputedStyle(globalThis.document.documentElement)
		.getPropertyValue('--mask-overlay')
		.trim()
		.split(/\s+/)
		.map(Number);
	const image = new ImageData(width, height);
	const {data} = image;
	for (const [index, element] of mask.entries()) {
		const offset = index * 4;
		data[offset] = red;
		data[offset + 1] = green;
		data[offset + 2] = blue;
		data[offset + 3] = element;
	}

	return globalThis.createImageBitmap(image);
}

/**
 Keeps `overlayRef` holding the overlay of the selected instance's mask while
 "Show mask" is on (DESIGN.md section 7.4), and calls `redraw` when it changes.
 One mask is rendered at a time; changes made meanwhile collapse into the newest.
 */
export function useMaskOverlay(
	overlayRef: RefObject<MaskOverlayImage | null>,
	redraw: () => void,
): void {
	const {bundle} = useAppRuntime();
	const side = useAppStore(selectEditingSide);
	const instance = useAppStore((state) => {
		const id = selectEditingSelectedId(state);
		return selectEditingStack(state)?.instances.find((item) => item.id === id);
	});
	const dragged = useTransientStore((state) =>
		state.activeDrag && state.activeDrag.instanceId === instance?.id
			? state.activeDrag.mask
			: undefined,
	);
	const {visible, opacity} = useAppStore((state) => state.maskOverlay);
	const source = useAppStore((state) =>
		side === 'a' ? state.renderA.source : state.render.source,
	);
	// A frame means the worker may hold what it lacked before.
	const frame = useAppStore((state) =>
		side === 'a' ? state.renderA.frame : state.render.frame,
	);
	const comparing = useAppStore((state) => state.compareHistorySeq !== null);
	const showingOriginal = useTransientStore(selectShowingOriginal);
	const cropping = useTransientStore((state) => state.geometry.cropping);

	const wantedRef = useRef<OverlayRequest | null>(null);
	const shownRef = useRef<Shown | null>(null);
	const busyRef = useRef(false);
	const mountedRef = useRef(true);
	const opacityRef = useRef(opacity);

	const show = useCallback(
		(next: Shown | null) => {
			const previous = shownRef.current;
			if (previous === next) {
				return;
			}

			shownRef.current = next;
			overlayRef.current = next && {
				bitmap: next.bitmap,
				width: next.request.width,
				height: next.request.height,
				side: next.request.side,
				opacity: opacityRef.current / 100,
			};
			previous?.bitmap.close();
			redraw();
		},
		[overlayRef, redraw],
	);

	const pump = useCallback(async () => {
		if (busyRef.current) {
			return;
		}

		busyRef.current = true;
		let request = wantedRef.current;
		while (request) {
			const shown = shownRef.current?.request;
			if (shown?.key === request.key && shown.source === request.source) {
				break;
			}

			const {mask, width, height} = request;
			let bitmap: ImageBitmap | undefined;
			try {
				const data = await bundle.store
					.getState()
					.renderMask(request.side, mask, width, height);
				bitmap = data && (await tintMask(data, width, height));
			} catch {
				// Without memory for it there is no overlay.
			}

			const latest: OverlayRequest | null = wantedRef.current;
			// An older mask of the same instance still shows a drag moving.
			const fits =
				mountedRef.current &&
				latest?.target === request.target &&
				latest.source === request.source;
			if (bitmap && fits) {
				show({request, bitmap});
			} else {
				bitmap?.close();
				if (latest === request) {
					show(null);
				}
			}

			// Unchanged: wait for the next frame or mask.
			if (latest === request) {
				break;
			}

			request = latest;
		}

		busyRef.current = false;
	}, [bundle.store, show]);

	const active =
		visible && !comparing && !showingOriginal && !cropping && Boolean(source);

	useEffect(() => {
		const stored = instance?.mask ? validateMask(instance.mask) : undefined;
		if (!active || !instance || !stored || !source) {
			wantedRef.current = null;
			show(null);
			return;
		}

		const mask = dragged ? patchMask(stored, dragged) : stored;
		const target = `${side}:${instance.id}`;
		const request: OverlayRequest = {
			side,
			target,
			source,
			mask,
			key: `${target}:${canonicalJson(mask)}`,
			width: source.settle.width,
			height: source.settle.height,
		};
		wantedRef.current = request;
		const shown = shownRef.current?.request;
		if (shown && (shown.target !== target || shown.source !== source)) {
			show(null);
		}

		void pump();
	}, [active, dragged, frame, instance, pump, show, side, source]);

	useEffect(() => {
		opacityRef.current = opacity;
		if (!overlayRef.current) {
			return;
		}

		overlayRef.current = {...overlayRef.current, opacity: opacity / 100};
		redraw();
	}, [opacity, overlayRef, redraw]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			wantedRef.current = null;
			overlayRef.current = null;
			shownRef.current?.bitmap.close();
			shownRef.current = null;
		};
	}, [overlayRef]);
}
