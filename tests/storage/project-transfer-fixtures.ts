// The archive codec in process and a stand-in image decoder: Node has neither
// workers nor `createImageBitmap`.
import {vi} from 'vite-plus/test';
import {readBackup, writeBackup} from '../../src/storage/backup.ts';
import type {BackupTransferDependencies} from '../../src/storage/backup-transfer.ts';
import {
	readProjectFile,
	writeProjectFile,
} from '../../src/storage/project-file.ts';
import type {ProjectTransferDependencies} from '../../src/storage/project-transfer.ts';

export const SOURCE_SIZE = {width: 400, height: 300};
export const THUMBNAIL_SIZE = {width: 200, height: 150};

export function transferDependencies() {
	const probeImage = vi.fn<
		NonNullable<ProjectTransferDependencies['probeImage']>
	>(async (blob) => ({
		ok: true,
		value: {
			...(blob.type === 'image/webp' ? THUMBNAIL_SIZE : SOURCE_SIZE),
			exceedsGuaranteedArea: false,
		},
	}));
	return {
		projectArchive: {save: writeProjectFile, open: readProjectFile},
		backupArchive: {save: writeBackup, open: readBackup},
		probeImage,
	} satisfies ProjectTransferDependencies & BackupTransferDependencies;
}
