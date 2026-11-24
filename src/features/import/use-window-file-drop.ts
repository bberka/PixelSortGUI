import {useEffect, useRef, useState} from 'react';

const FILE_DRAG_TYPES = new Set(['Files', 'application/x-moz-file']);

function carriesFiles(event: DragEvent): boolean {
	const types = event.dataTransfer?.types;
	return types ? [...types].some((type) => FILE_DRAG_TYPES.has(type)) : false;
}

/**
 Drag and drop onto the whole window (DESIGN.md section 6.1, AC-F1.2). Drag
 events fire on the element under the pointer, so the window listens and keeps
 a depth count: dragging over a child fires `dragenter` before the parent's
 `dragleave`, and only the last `dragleave` ends the drag.
 */
export function useWindowFileDrop(
	onFiles: (files: readonly File[]) => void,
): boolean {
	const handlerRef = useRef(onFiles);
	const [dragging, setDragging] = useState(false);

	useEffect(() => {
		handlerRef.current = onFiles;
	});

	useEffect(() => {
		let depth = 0;

		const handleDragEnter = (event: DragEvent) => {
			if (!carriesFiles(event)) {
				return;
			}

			event.preventDefault();
			depth++;
			setDragging(true);
		};

		const handleDragOver = (event: DragEvent) => {
			if (!carriesFiles(event)) {
				return;
			}

			event.preventDefault();
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'copy';
			}
		};

		const handleDragLeave = (event: DragEvent) => {
			if (!carriesFiles(event)) {
				return;
			}

			depth = Math.max(0, depth - 1);
			if (depth === 0) {
				setDragging(false);
			}
		};

		const handleDrop = (event: DragEvent) => {
			if (!carriesFiles(event)) {
				return;
			}

			event.preventDefault();
			depth = 0;
			setDragging(false);
			const files = [...(event.dataTransfer?.files ?? [])];
			if (files.length > 0) {
				handlerRef.current(files);
			}
		};

		globalThis.addEventListener('dragenter', handleDragEnter);
		globalThis.addEventListener('dragover', handleDragOver);
		globalThis.addEventListener('dragleave', handleDragLeave);
		globalThis.addEventListener('drop', handleDrop);

		return () => {
			globalThis.removeEventListener('dragenter', handleDragEnter);
			globalThis.removeEventListener('dragover', handleDragOver);
			globalThis.removeEventListener('dragleave', handleDragLeave);
			globalThis.removeEventListener('drop', handleDrop);
		};
	}, []);

	return dragging;
}
