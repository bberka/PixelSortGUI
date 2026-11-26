import {createPortal} from 'react-dom';

/**
 The drag-and-drop overlay from DESIGN.md section 6.1: a dashed frame over the
 whole window while files are dragged, which lets the drop land on the window
 instead of the element under the pointer.
 */
export function DropOverlay() {
	return createPortal(
		<div
			aria-hidden="true"
			className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-background/90 p-6"
		>
			<div className="w-full max-w-[36ch] rounded-lg border-2 border-dashed border-ring bg-card px-6 py-8 text-center text-sm leading-5 font-medium text-foreground">
				Drop images or project files to open
			</div>
		</div>,
		globalThis.document.body,
	);
}
