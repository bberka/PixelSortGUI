import {toast} from 'sonner';
import {canReadClipboard, readClipboardImages} from './clipboard-images.ts';
import {useImportFlow} from './import-flow.tsx';
import type {ImageImportOptions} from './use-image-import.ts';
import {keyboardHintsShown} from '@/lib/keyboard-hints.ts';
import {isMacPlatform} from '@/features/toolbar/shortcuts.ts';

export const PASTE_IMAGE_LABEL = 'Paste image';

export function pasteKeys(): string {
	return isMacPlatform(
		globalThis.navigator?.platform,
		globalThis.navigator?.userAgent,
	)
		? '⌘V'
		: 'Ctrl+V';
}

const MESSAGES = {
	empty: 'No image on the clipboard.',
	denied: "Drift isn't allowed to read the clipboard.",
	failed: "Couldn't read the clipboard.",
} as const;

function report(status: keyof typeof MESSAGES): void {
	let description: string | undefined;
	if (status === 'empty') {
		description = 'Copy an image, then try again.';
	} else if (keyboardHintsShown()) {
		description = `Press ${pasteKeys()} to paste instead.`;
	}

	toast.error(MESSAGES[status], {description});
}

/**
 The "Paste image" action (product.md F30). `paste` is `null` where the browser
 cannot read the clipboard; `feedback` is rendered like the import flow's.
 */
export function usePasteImage(options: ImageImportOptions = {}) {
	const {flow, feedback} = useImportFlow(options);
	const paste = async () => {
		const result = await readClipboardImages();
		if (result.status === 'images') {
			flow.start(result.files);
		} else {
			report(result.status);
		}
	};

	return {
		paste: canReadClipboard()
			? () => {
					void paste();
				}
			: null,
		feedback,
	};
}
