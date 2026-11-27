import {useEffect, useRef} from 'react';
import {pastedImages} from './clipboard-images.ts';
import {
	isEditableTarget,
	isModalDialogOpen,
} from '@/features/toolbar/shortcuts.ts';

/**
 `Ctrl/Cmd+V` anywhere on the window (product.md F30). A paste into a field or
 while a dialog is open stays the browser's own.
 */
export function useWindowImagePaste(
	onFiles: (files: readonly File[]) => void,
): void {
	const handlerRef = useRef(onFiles);

	useEffect(() => {
		handlerRef.current = onFiles;
	});

	useEffect(() => {
		const handlePaste = (event: ClipboardEvent) => {
			if (
				event.defaultPrevented ||
				isEditableTarget(event.target) ||
				isEditableTarget(globalThis.document.activeElement) ||
				isModalDialogOpen(globalThis.document)
			) {
				return;
			}

			const files = pastedImages(event.clipboardData);
			if (files.length === 0) {
				return;
			}

			event.preventDefault();
			handlerRef.current(files);
		};

		globalThis.addEventListener('paste', handlePaste);
		return () => {
			globalThis.removeEventListener('paste', handlePaste);
		};
	}, []);
}
