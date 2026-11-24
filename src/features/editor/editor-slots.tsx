import type {ComponentType} from 'react';
import {cn} from '@/lib/utils';
import {CanvasStage} from '@/features/canvas/canvas-stage.tsx';

/**
 Regions of the editor, in reading order. A later task fills a region by
 importing its component above and naming it in `EDITOR_SLOTS`; a region left
 `null` renders its empty placeholder. The responsive layout in
 `editor-screen.tsx` already places all four at phone, tablet and desktop
 widths.
 */
export type EditorSlotId = 'toolbar' | 'canvas' | 'stack' | 'params';

export const EDITOR_SLOTS: Record<EditorSlotId, ComponentType | null> = {
	toolbar: null,
	canvas: CanvasStage,
	stack: null,
	params: null,
};

function SlotPlaceholder({label}: {readonly label: string}) {
	return (
		<div className="flex h-full min-h-0 w-full items-center justify-center p-2">
			<span className="truncate rounded-sm border border-dashed border-input px-2 py-1 text-[11px] leading-4 font-semibold tracking-[0.05em] text-muted-foreground uppercase">
				{label}
			</span>
		</div>
	);
}

export type EditorSlotProps = {
	readonly id: EditorSlotId;
	readonly label: string;
	readonly className?: string;
};

export function EditorSlot({id, label, className}: EditorSlotProps) {
	const Slot = EDITOR_SLOTS[id];

	return (
		<section
			aria-label={label}
			className={cn('flex min-h-0 min-w-0 flex-col overflow-hidden', className)}
		>
			{Slot ? <Slot /> : <SlotPlaceholder label={label} />}
		</section>
	);
}
