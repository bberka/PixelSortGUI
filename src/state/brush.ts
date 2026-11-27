// The mask brush as the app holds it (product.md F29). Settings are kept per
// device (persistence.md section 3); whether the brush is on is not saved.
import {clamp} from '../engine/math.ts';
import type {BrushSettings} from '../storage/types.ts';
import {DEFAULT_MASK_OVERLAY, MIN_OVERLAY_OPACITY} from './mask-edits.ts';

export type BrushTool = 'paint' | 'erase';

// The brush while it is on.
export type ActiveBrush = {
	readonly instanceId: string;
	readonly tool: BrushTool;
};

// The settings a stroke uses; the overlay's two are `MaskOverlaySettings`.
export type BrushOptions = Pick<
	BrushSettings,
	'size' | 'hardness' | 'strength' | 'penPressure'
>;

export const BRUSH_LIMITS = {
	size: {min: 1, max: 2000},
	hardness: {min: 0, max: 100},
	strength: {min: 1, max: 100},
} as const;

export const DEFAULT_BRUSH_SETTINGS: BrushSettings = {
	size: 100,
	hardness: 50,
	strength: 100,
	penPressure: true,
	showMask: DEFAULT_MASK_OVERLAY.visible,
	overlayOpacity: DEFAULT_MASK_OVERLAY.opacity,
};

export const BRUSH_SAVE_DEBOUNCE_MS = 200;

function integer(
	value: unknown,
	{min, max}: {readonly min: number; readonly max: number},
	fallback: number,
): number {
	return typeof value === 'number' && Number.isFinite(value)
		? Math.round(clamp(value, min, max))
		: fallback;
}

// A stored or patched record with every value in range.
export function normalizeBrushSettings(value: unknown): BrushSettings {
	const record = (
		typeof value === 'object' && value !== null ? value : {}
	) as Partial<Record<keyof BrushSettings, unknown>>;
	const defaults = DEFAULT_BRUSH_SETTINGS;
	const flag = (given: unknown, fallback: boolean) =>
		typeof given === 'boolean' ? given : fallback;
	return {
		size: integer(record.size, BRUSH_LIMITS.size, defaults.size),
		hardness: integer(
			record.hardness,
			BRUSH_LIMITS.hardness,
			defaults.hardness,
		),
		strength: integer(
			record.strength,
			BRUSH_LIMITS.strength,
			defaults.strength,
		),
		penPressure: flag(record.penPressure, defaults.penPressure),
		showMask: flag(record.showMask, defaults.showMask),
		overlayOpacity: integer(
			record.overlayOpacity,
			{min: MIN_OVERLAY_OPACITY, max: 100},
			defaults.overlayOpacity,
		),
	};
}

// The next size for `[` and `]`: 1 px steps below 20 px, then 10%.
export function stepBrushSize(size: number, direction: 1 | -1): number {
	const {min, max} = BRUSH_LIMITS.size;
	if (direction === 1) {
		return Math.min(max, size < 20 ? size + 1 : Math.round(size * 1.1));
	}

	return Math.max(
		min,
		size <= 20 ? size - 1 : Math.max(20, Math.round(size * 0.9)),
	);
}
