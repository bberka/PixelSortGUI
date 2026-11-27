/**
 What the app takes from the clipboard (product.md F30): image files only,
 handed to the import flow as ordinary files.
 */

const PASTED_NAME = 'Pasted image';

// Includes the refused formats, so they get their own message (F21).
const IMAGE_EXTENSION =
	/\.(?:apng|arw|avif|bmp|cr2|cr3|dng|gif|heic|heif|jpe?g|nef|orf|png|raf|rw2|svg|tiff?|webp)$/i;

// What a browser calls a picture that never was a file.
const STAND_IN_NAME = /^(?:image|blob|clipboard|unknown|untitled)?(?:\.\w+)?$/i;

const EXTENSIONS: Readonly<Record<string, string>> = {
	'image/jpeg': 'jpg',
	'image/svg+xml': 'svg',
	'image/tiff': 'tif',
};

function extensionFor(mimeType: string): string {
	return EXTENSIONS[mimeType] ?? mimeType.slice('image/'.length);
}

/**
 The file under the name its project and its messages use.
 */
export function namePastedFile(file: File): File {
	if (!STAND_IN_NAME.test(file.name)) {
		return file;
	}

	// Without a type, the old extension still names a refused format.
	const extension = file.type.startsWith('image/')
		? `.${extensionFor(file.type)}`
		: (/\.\w+$/.exec(file.name)?.[0] ?? '');
	return new File([file], `${PASTED_NAME}${extension}`, {type: file.type});
}

function isImageFile(file: File): boolean {
	return file.type.startsWith('image/') || IMAGE_EXTENSION.test(file.name);
}

/**
 The images of a `paste` event. Read it during the event: the browser empties
 the data afterwards.
 */
export function pastedImages(data: DataTransfer | null): File[] {
	if (!data) {
		return [];
	}

	let files = [...data.files];
	if (files.length === 0) {
		files = [...data.items]
			.filter((item) => item.kind === 'file')
			.map((item) => item.getAsFile())
			.filter((file) => file !== null);
	}

	return files
		.filter((file) => isImageFile(file))
		.map((file) => namePastedFile(file));
}

export type ClipboardReadResult =
	| {readonly status: 'images'; readonly files: readonly File[]}
	| {readonly status: 'empty' | 'denied' | 'failed'};

export function canReadClipboard(): boolean {
	return typeof globalThis.navigator?.clipboard?.read === 'function';
}

// One picture per item: its other types are the same content again.
function imageType(types: readonly string[]): string | undefined {
	return types.includes('image/png')
		? 'image/png'
		: types.find((type) => type.startsWith('image/'));
}

function errorName(error: unknown): string {
	return error instanceof Error || error instanceof DOMException
		? error.name
		: '';
}

/**
 Reads the clipboard for "Paste image". Call it straight from the click, or the
 browser refuses.
 */
export async function readClipboardImages(): Promise<ClipboardReadResult> {
	try {
		const items = await globalThis.navigator.clipboard.read();
		const files: File[] = [];
		for (const item of items) {
			const type = imageType(item.types);
			if (type === undefined) {
				continue;
			}

			const blob = await item.getType(type);
			files.push(namePastedFile(new File([blob], '', {type})));
		}

		return files.length > 0 ? {status: 'images', files} : {status: 'empty'};
	} catch (error) {
		switch (errorName(error)) {
			case 'NotAllowedError':
			case 'SecurityError': {
				return {status: 'denied'};
			}

			// Chromium's answer for an empty clipboard on some systems.
			case 'DataError':
			case 'NotFoundError': {
				return {status: 'empty'};
			}

			default: {
				return {status: 'failed'};
			}
		}
	}
}
