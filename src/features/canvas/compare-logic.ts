import type {SplitOrientation} from '@/storage/types.ts';

// DESIGN.md section 8.2: presses shorter than 300 ms toggle; longer presses hold-to-peek.
export const COMPARE_HOLD_MS = 300;
// AC-F11.3 and AC-F11.6: the arrows across the divider move it by 1%,
// Shift+Arrow by 10%.
export const SPLIT_KEY_STEP = 0.01;
export const SPLIT_KEY_SHIFT_STEP = 0.1;

export function clampSplitPosition(position: number): number {
	return Number.isFinite(position) ? Math.min(1, Math.max(0, position)) : 0.5;
}

export function formatSplitPercent(position: number): number {
	return Math.round(clampSplitPosition(position) * 100);
}

const SPLIT_KEYS = {
	vertical: {back: 'ArrowLeft', forward: 'ArrowRight'},
	horizontal: {back: 'ArrowUp', forward: 'ArrowDown'},
} as const;

export function stepSplitPosition(
	current: number,
	key: string,
	shiftKey: boolean,
	orientation: SplitOrientation = 'vertical',
): number | null {
	const base = clampSplitPosition(current);
	const step = shiftKey ? SPLIT_KEY_SHIFT_STEP : SPLIT_KEY_STEP;
	const {back, forward} = SPLIT_KEYS[orientation];
	switch (key) {
		case back: {
			return clampSplitPosition(Math.round((base - step) * 1000) / 1000);
		}

		case forward: {
			return clampSplitPosition(Math.round((base + step) * 1000) / 1000);
		}

		case 'Home': {
			return 0;
		}

		case 'End': {
			return 1;
		}

		default: {
			return null;
		}
	}
}

export type CompareHoldCallbacks = {
	getLatched(): boolean;
	setHolding(holding: boolean): void;
	setLatched(latched: boolean): void;
	setTimeout?: (callback: () => void, ms: number) => unknown;
	clearTimeout?: (handle: unknown) => void;
};

export type CompareHoldController = {
	pressStart(): void;
	pressEnd(): void;
	cancel(): void;
	toggle(): void;
	isPressed(): boolean;
};

export function createCompareHoldController(
	callbacks: CompareHoldCallbacks,
): CompareHoldController {
	const schedule =
		callbacks.setTimeout ??
		((callback: () => void, ms: number) => globalThis.setTimeout(callback, ms));
	const cancelTimer =
		callbacks.clearTimeout ??
		((handle: unknown) => {
			globalThis.clearTimeout(handle as number);
		});

	let pressed = false;
	let held = false;
	let wasLatched = false;
	let timer: unknown;

	const clearPendingTimer = () => {
		if (timer === undefined) {
			return;
		}

		cancelTimer(timer);
		timer = undefined;
	};

	return {
		pressStart() {
			if (pressed) {
				return;
			}

			pressed = true;
			held = false;
			wasLatched = callbacks.getLatched();
			callbacks.setHolding(true);
			timer = schedule(() => {
				timer = undefined;
				held = true;
			}, COMPARE_HOLD_MS);
		},

		pressEnd() {
			if (!pressed) {
				return;
			}

			pressed = false;
			clearPendingTimer();
			callbacks.setHolding(false);
			callbacks.setLatched(held ? false : !wasLatched);
		},

		cancel() {
			if (!pressed) {
				return;
			}

			pressed = false;
			held = false;
			clearPendingTimer();
			callbacks.setHolding(false);
		},

		toggle() {
			clearPendingTimer();
			pressed = false;
			held = false;
			callbacks.setHolding(false);
			callbacks.setLatched(!callbacks.getLatched());
		},

		isPressed() {
			return pressed;
		},
	};
}
