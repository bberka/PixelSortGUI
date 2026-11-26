import {useRef, type ChangeEvent, type RefObject} from 'react';

/**
 The picker filter: images and project files (F25). AVIF, BMP, GIF, SVG, and
 TIFF are listed by extension because not every operating system maps them to
 an `image/*` type.
 */
export const IMAGE_ACCEPT = 'image/*,.avif,.bmp,.gif,.svg,.tif,.tiff';
export const IMPORT_ACCEPT = `${IMAGE_ACCEPT},.glproj,.zip`;

export function isProjectFileName(name: string): boolean {
	return /\.glproj$/i.test(name);
}

// A project file or a backup; its manifest says which (F17).
export function isZipFileName(name: string): boolean {
	return /\.zip$/i.test(name);
}

/**
 The hidden file input behind every import trigger (F1, AC-F19.1). Activating
 the visible button opens the system picker from a keyboard or a pointer
 alike; the input is cleared after each pick so choosing the same file twice
 fires again (AC-F1.7).
 */
export function useImagePicker(onFiles: (files: readonly File[]) => void): {
	readonly inputRef: RefObject<HTMLInputElement | null>;
	readonly open: () => void;
	readonly onInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
} {
	const inputRef = useRef<HTMLInputElement>(null);

	return {
		inputRef,
		open() {
			inputRef.current?.click();
		},
		onInputChange(event) {
			const files = [...(event.target.files ?? [])];
			event.target.value = '';
			if (files.length > 0) {
				onFiles(files);
			}
		},
	};
}
