// Errors of the project file codec (persistence.md section 8.3.5). The main
// thread imports this file, so it must not reach `fflate`.

export type ProjectFileErrorCode =
	| 'too-large'
	| 'damaged'
	| 'invalid-metadata'
	| 'newer-version'
	| 'missing-source'
	| 'damaged-source'
	| 'unreadable-image';

export type ProjectFileErrorDetail = {
	// The archive path of the entry, for the two image data errors.
	path?: string;
	// The `formatVersion` of the file, for `newer-version`.
	version?: unknown;
};

export function projectOpenMessage(
	code: ProjectFileErrorCode,
	fileName: string,
	{path, version}: ProjectFileErrorDetail = {},
): string {
	const prefix = `Can't open ${fileName}:`;
	switch (code) {
		case 'too-large': {
			return `${prefix} the project file is too large (limit is 1 GB, or 200 MB per image).`;
		}

		case 'damaged': {
			return `${prefix} the file is damaged or not a valid project archive.`;
		}

		case 'invalid-metadata': {
			return `${prefix} missing or invalid project metadata.`;
		}

		case 'newer-version': {
			return `${prefix} project format version ${String(version)} is newer than this app supports. Update the app and try again.`;
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

export type ProjectSaveErrorCode = Extract<
	ProjectFileErrorCode,
	'too-large' | 'missing-source' | 'invalid-metadata'
>;

export function projectSaveMessage(
	code: ProjectSaveErrorCode,
	projectName: string,
): string {
	const prefix = `Can't save ${projectName}:`;
	switch (code) {
		case 'too-large': {
			return `${prefix} the project is too large for a project file (limit is 1 GB, or 200 MB per image).`;
		}

		case 'missing-source': {
			return `${prefix} its image data is missing.`;
		}

		case 'invalid-metadata': {
			return `${prefix} its stored data is invalid.`;
		}
	}
}

// `message` is the exact text to show the user.
export class ProjectFileError extends Error {
	override name = 'ProjectFileError';

	constructor(
		readonly code: ProjectFileErrorCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
	}
}
