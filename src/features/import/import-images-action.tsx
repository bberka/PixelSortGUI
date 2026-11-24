import {ImagePlusIcon} from 'lucide-react';
import {DropOverlay} from './drop-overlay.tsx';
import {ImportFeedback} from './import-feedback.tsx';
import {useImageImport, type ImageImportOptions} from './use-image-import.ts';
import {useImagePicker} from './use-image-picker.ts';
import {useWindowFileDrop} from './use-window-file-drop.ts';
import {Button} from '@/components/ui/button';

export type ImportImagesActionProps = {
	/**
	 Test seam: lets a test inject the codec calls, like `App`'s `screens` prop.
	 */
	readonly probe?: ImageImportOptions['probe'];
	readonly downscale?: ImageImportOptions['downscale'];
};

/**
 The library action in the app bar (DESIGN.md section 6.1). It also owns the
 window-wide drop target, so dropping files anywhere on the library screen
 works whether or not the empty state is showing (AC-F1.2).
 */
export function ImportImagesAction({
	probe,
	downscale,
}: ImportImagesActionProps = {}) {
	const flow = useImageImport({probe, downscale});
	const picker = useImagePicker(flow.start);
	const dragging = useWindowFileDrop(flow.start);

	return (
		<>
			<input
				ref={picker.inputRef}
				multiple
				hidden
				type="file"
				accept="image/*"
				onChange={picker.onInputChange}
			/>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="max-sm:hidden"
				onClick={picker.open}
			>
				<ImagePlusIcon aria-hidden="true" />
				Import images
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="sm:hidden"
				aria-label="Import images"
				onClick={picker.open}
			>
				<ImagePlusIcon aria-hidden="true" />
			</Button>
			{dragging && !flow.busy ? <DropOverlay /> : null}
			<ImportFeedback flow={flow} />
		</>
	);
}
