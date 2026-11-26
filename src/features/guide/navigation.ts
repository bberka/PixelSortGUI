import {useEffect} from 'react';
import {
	isEditableTarget,
	isModalDialogOpen,
} from '@/features/toolbar/shortcuts.ts';
import {formatHashRoute} from '@/state/router.ts';

export const GUIDE_HASH = formatHashRoute({screen: 'guide'});

export function openGuide(): void {
	globalThis.location.hash = GUIDE_HASH;
}

export function isGuideShortcut(
	event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>,
): boolean {
	return event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey;
}

/**
 `?` opens the guide, except while typing or while a dialog is open.
 */
export function useGuideShortcut(): void {
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				!isGuideShortcut(event) ||
				event.defaultPrevented ||
				event.repeat ||
				isEditableTarget(event.target) ||
				isEditableTarget(globalThis.document.activeElement) ||
				isModalDialogOpen(globalThis.document)
			) {
				return;
			}

			event.preventDefault();
			openGuide();
		};

		globalThis.addEventListener('keydown', handleKeyDown);
		return () => {
			globalThis.removeEventListener('keydown', handleKeyDown);
		};
	}, []);
}
