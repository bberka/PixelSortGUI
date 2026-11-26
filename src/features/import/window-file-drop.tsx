import {DropOverlay} from './drop-overlay.tsx';
import {useImportFlow} from './import-flow.tsx';
import type {ImageImportOptions} from './use-image-import.ts';
import {useWindowFileDrop} from './use-window-file-drop.ts';
import {useBackupDialogOpen} from '@/features/backup/backup-context.tsx';

export type WindowFileDropProps = {
	readonly probe?: ImageImportOptions['probe'];
	readonly downscale?: ImageImportOptions['downscale'];
	readonly readKind?: ImageImportOptions['readKind'];
};

/**
 Window-wide file drop target active across both library and editor screens
 (product.md F1, DESIGN.md section 6.1).
 */
export function WindowFileDrop({
	probe,
	downscale,
	readKind,
}: WindowFileDropProps = {}) {
	const {flow, feedback} = useImportFlow({probe, downscale, readKind});
	// The listener stays, so the browser does not open a dropped file itself.
	const blocked = useBackupDialogOpen();
	const dragging = useWindowFileDrop((files) => {
		if (!blocked) {
			flow.start(files);
		}
	});

	return (
		<>
			{dragging && !flow.busy && !blocked ? <DropOverlay /> : null}
			{feedback}
		</>
	);
}
