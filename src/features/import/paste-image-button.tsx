import {ClipboardPasteIcon} from 'lucide-react';
import type {ImageImportOptions} from './use-image-import.ts';
import {PASTE_IMAGE_LABEL, usePasteImage} from './use-paste-image.ts';
import {Button} from '@/components/ui/button';

/**
 "Paste image" among the empty Library's actions (DESIGN.md section 7.4).
 */
export function PasteImageButton(props: ImageImportOptions) {
	const {paste, feedback} = usePasteImage(props);

	return (
		<>
			{paste ? (
				<Button type="button" variant="outline" onClick={paste}>
					<ClipboardPasteIcon aria-hidden="true" />
					{PASTE_IMAGE_LABEL}
				</Button>
			) : null}
			{feedback}
		</>
	);
}
