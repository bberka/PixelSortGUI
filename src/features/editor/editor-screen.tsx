import {EditorSlot} from './editor-slots.tsx';

/**
 Placeholder: later tasks fill the four slots with the canvas stage (T5.1), the
 effect stack (T5.3), the parameter panel (T5.4) and canvas tools. The
 responsive frame around them is settled here: one column with a canvas strip
 and a bottom panel at phone and tablet widths, a canvas plus a 340 px right
 sidebar at desktop width (DESIGN.md section 6).
 */
export function EditorScreen() {
	return (
		<div className="flex min-h-0 flex-1 flex-col md:grid md:grid-rows-[minmax(0,1fr)_360px] lg:flex lg:flex-row">
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<EditorSlot
					className="h-10 shrink-0 border-b border-border"
					id="toolbar"
					label="Canvas toolbar"
				/>
				<EditorSlot
					className="min-h-0 flex-1 bg-canvas-stage"
					id="canvas"
					label="Canvas"
				/>
			</div>
			<aside
				aria-label="Effects"
				className="flex min-h-0 min-w-0 flex-col border-t border-border md:flex-row lg:w-[340px] lg:flex-col lg:border-t-0 lg:border-l"
			>
				<EditorSlot
					className="h-12 shrink-0 border-b border-border md:h-full md:w-[260px] md:shrink-0 md:border-r md:border-b-0 lg:max-h-[38%] lg:h-auto lg:min-h-[72px] lg:w-full lg:border-r-0 lg:border-b"
					id="stack"
					label="Effect stack"
				/>
				<EditorSlot
					className="h-[44dvh] shrink-0 md:h-auto md:min-h-0 md:flex-1"
					id="params"
					label="Parameters"
				/>
			</aside>
		</div>
	);
}
