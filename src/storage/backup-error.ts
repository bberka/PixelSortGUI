// Errors of the backup codec and import (persistence.md section 8.4.4). The main
// thread imports this file, so it must not reach `fflate`.

export type BackupImportErrorCode =
	| 'too-large'
	| 'damaged'
	| 'invalid-manifest'
	| 'newer-version'
	| 'missing-source'
	| 'damaged-source'
	| 'unreadable-image';

export type BackupExportErrorCode =
	| 'export-too-large'
	| 'export-missing-source'
	| 'export-invalid-project'
	| 'export-invalid-record';

export type BackupErrorCode = BackupImportErrorCode | BackupExportErrorCode;

export type BackupImportErrorDetail = {
	// The archive path of the entry, for the two image data errors.
	path?: string;
	// The version the file declares, for `newer-version`.
	version?: unknown;
};

export function backupImportMessage(
	code: BackupImportErrorCode,
	{path, version}: BackupImportErrorDetail = {},
): string {
	const prefix = "Can't import backup:";
	switch (code) {
		case 'too-large': {
			return `${prefix} the archive is too large (limit is 4 GB, or 200 MB per image).`;
		}

		case 'damaged': {
			return `${prefix} the file is damaged or not a valid ZIP archive.`;
		}

		case 'invalid-manifest': {
			return `${prefix} missing or invalid manifest.`;
		}

		case 'newer-version': {
			return `${prefix} format version ${String(version)} is newer than this app supports. Update the app and try again.`;
		}

		case 'missing-source': {
			return `${prefix} missing image data (${path}).`;
		}

		case 'damaged-source': {
			return `${prefix} image data is damaged (${path}).`;
		}

		case 'unreadable-image': {
			return `${prefix} embedded image is unreadable or exceeds 16,384 px.`;
		}
	}
}

// `projectName` names the project of the two codes that blame one.
export function backupExportMessage(
	code: BackupExportErrorCode,
	projectName = '',
): string {
	const prefix = "Can't export backup:";
	switch (code) {
		case 'export-too-large': {
			return `${prefix} it is too large (limit is 4 GB, or 200 MB per image). Select fewer projects or leave out undo history.`;
		}

		case 'export-missing-source': {
			return `${prefix} the image data of ${projectName} is missing.`;
		}

		case 'export-invalid-project': {
			return `${prefix} the stored data of ${projectName} is invalid.`;
		}

		case 'export-invalid-record': {
			return `${prefix} a stored preset or setting is invalid.`;
		}
	}
}

// `message` is the exact text to show the user.
export class BackupError extends Error {
	override name = 'BackupError';

	constructor(
		readonly code: BackupErrorCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
	}
}
