/**
 The one rule for mentioning keys (DESIGN.md section 8.4). Every tooltip, menu
 and screen that names a shortcut asks here.
 */
import {useCallback, useSyncExternalStore} from 'react';

/**
 A primary input that is touch and cannot hover: phones and tablets. A laptop
 with a touch screen does not match.
 */
export const TOUCH_ONLY_MEDIA_QUERY = '(pointer: coarse) and (hover: none)';

function touchOnlyQuery(): MediaQueryList | null {
	return typeof globalThis.matchMedia === 'function'
		? globalThis.matchMedia(TOUCH_ONLY_MEDIA_QUERY)
		: null;
}

function subscribe(onChange: () => void): () => void {
	const query = touchOnlyQuery();
	query?.addEventListener('change', onChange);
	return () => {
		query?.removeEventListener('change', onChange);
	};
}

export function keyboardHintsShown(): boolean {
	return !touchOnlyQuery()?.matches;
}

export function useShowKeyboardHints(): boolean {
	return useSyncExternalStore(subscribe, keyboardHintsShown);
}

/**
 `Split view (S)` where keys are shown, `Split view` otherwise. A note applies
 to every input, so it stays: `Compare (\, hold to peek)` or
 `Compare, hold to peek`.
 */
export function formatHint(
	show: boolean,
	text: string,
	keys: string,
	note?: string,
): string {
	if (show) {
		return `${text} (${note === undefined ? keys : `${keys}, ${note}`})`;
	}

	return note === undefined ? text : `${text}, ${note}`;
}

export function useShortcutHint(): (
	text: string,
	keys: string,
	note?: string,
) => string {
	const show = useShowKeyboardHints();
	return useCallback(
		(text: string, keys: string, note?: string) =>
			formatHint(show, text, keys, note),
		[show],
	);
}
