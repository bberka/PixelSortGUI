import {useEffect, useRef} from 'react';
import {focusMain, isFocusLost} from '@/lib/focus.ts';
import type {AppRoute} from '@/state/router.ts';

// The control that led away from the screen now shown, if a screen change from
// `from` to `to` has one to go back to.
function returnSelector(from: AppRoute, to: AppRoute): string | null {
	if (from.screen === 'guide' && to.screen !== 'guide') {
		return '[data-guide-button]';
	}

	return from.screen === 'editor' && to.screen === 'library'
		? `[data-open-project="${CSS.escape(from.projectId)}"]`
		: null;
}

/**
 Places the focus after a screen change that removed the focused control
 (DESIGN.md section 10).
 */
export function useScreenChangeFocus(route: AppRoute): void {
	const previousRef = useRef(route);

	useEffect(() => {
		const selector = returnSelector(previousRef.current, route);
		previousRef.current = route;
		if (selector === null || !isFocusLost()) {
			return;
		}

		const target = globalThis.document.querySelector<HTMLElement>(selector);
		if (target) {
			target.focus();
		} else {
			focusMain();
		}
	}, [route]);
}
