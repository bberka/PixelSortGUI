import {DropOverlay} from './drop-overlay.tsx';
import {ImportFeedback} from './import-feedback.tsx';
import {useImageImport, type ImageImportOptions} from './use-image-import.ts';
import {useWindowFileDrop} from './use-window-file-drop.ts';

export type WindowFileDropProps = {
	readonly probe?: ImageImportOptions['probe'];
	readonly downscale?: ImageImportOptions['downscale'];
};

/**
 Window-wide file drop target active across both library and editor screens
 (product.md F1, DESIGN.md section 6.1).
 */
export function WindowFileDrop({probe, downscale}: WindowFileDropProps = {}) {
	const flow = useImageImport({probe, downscale});
	const dragging = useWindowFileDrop(flow.start);

	return (
		<>
			{dragging && !flow.busy ? <DropOverlay /> : null}
			<ImportFeedback flow={flow} />
		</>
	);
}
