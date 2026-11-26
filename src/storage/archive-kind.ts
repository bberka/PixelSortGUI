// Which import a `.zip` belongs to (persistence.md section 8.4.3). It runs in
// the archive worker: the main thread must import only its types.
import {MAX_JSON_BYTES} from './project-format.ts';
import {
	readZipDirectory,
	readZipEntry,
	ZipFormatError,
	ZipLimitError,
} from './zip-reader.ts';

export type ArchiveKind = 'project' | 'backup' | 'unknown' | 'damaged';

function manifestKind(bytes: Uint8Array): ArchiveKind {
	let manifest: unknown;
	try {
		manifest = JSON.parse(
			new TextDecoder('utf-8', {fatal: true}).decode(bytes),
		);
	} catch {
		return 'unknown';
	}

	const kind = (manifest as {kind?: unknown} | null)?.kind;
	return kind === 'project' || kind === 'backup' ? kind : 'unknown';
}

/**
 Reads the directory and `manifest.json` only. The import that follows does the
 validation.
 */
export async function readArchiveKind(
	file: Blob,
	{signal}: {signal?: AbortSignal} = {},
): Promise<ArchiveKind> {
	try {
		const directory = await readZipDirectory(file);
		const entry = directory.entries.get('manifest.json');
		if (!entry) {
			return 'unknown';
		}

		return manifestKind(
			await readZipEntry(file, directory, entry, {
				limit: MAX_JSON_BYTES,
				signal,
			}),
		);
	} catch (error) {
		if (error instanceof ZipFormatError || error instanceof ZipLimitError) {
			return 'damaged';
		}

		throw error;
	}
}
