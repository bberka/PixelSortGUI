import {ClipboardPasteIcon} from 'lucide-react';
import {
	PASTE_IMAGE_LABEL,
	pasteKeys,
	usePasteImage,
} from './use-paste-image.ts';
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu';

/**
 "Paste image" in the Library's overflow menu. The menu closes before the
 clipboard answers, so it relies on the shell's import flow for its dialogs.
 */
export function PasteImageMenuItem() {
	const {paste} = usePasteImage();
	if (!paste) {
		return null;
	}

	return (
		<>
			<DropdownMenuItem className="pointer-coarse:min-h-11" onSelect={paste}>
				<ClipboardPasteIcon aria-hidden="true" />
				{PASTE_IMAGE_LABEL}
				<DropdownMenuShortcut>{pasteKeys()}</DropdownMenuShortcut>
			</DropdownMenuItem>
			<DropdownMenuSeparator />
		</>
	);
}
