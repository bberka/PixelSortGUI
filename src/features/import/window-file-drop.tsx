import {DropOverlay} from './drop-overlay.tsx';
import {useImportFlow} from './import-flow.tsx';
import type {ImageImportOptions} from './use-image-import.ts';
import {useWindowFileDrop} from './use-window-file-drop.ts';
import {useWindowImagePaste} from './use-window-image-paste.ts';
import {useAppStore} from '@/app/runtime-context.tsx';
import {useBackupDialogOpen} from '@/features/backup/backup-context.tsx';

export type WindowFileDropProps = {
	readonly probe?: ImageImportOptions['probe'];
	readonly downscale?: ImageImportOptions['downscale'];
	readonly readKind?: ImageImportOptions['readKind'];
};

/**
 Window-wide file drop and image paste target for the library and editor
 screens (product.md F1 and F30, DESIGN.md section 6.1).
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
	const screen = useAppStore((state) => state.route.screen);
	useWindowImagePaste((files) => {
		if (!blocked && (screen === 'library' || screen === 'editor')) {
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
