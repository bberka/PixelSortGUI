// The tools that bind to the canvas (engine.md section 4.7). An effect with no
// entry here needs no canvas code.
import type {ComponentType} from 'react';
import {BrushToolbar} from './mask-brush/brush-toolbar.tsx';
import type {CanvasToolbarProps} from './types.ts';
import {useAppStore, useTransientStore} from '@/app/runtime-context.tsx';
import type {AppState} from '@/state/app-store.ts';

export type CanvasTool = {
	readonly id: string;
	isOn(state: AppState): boolean;
	readonly toolbar: ComponentType<CanvasToolbarProps>;
};

export const CANVAS_TOOLS: readonly CanvasTool[] = [
	// Binds to the selected instance's mask, whatever the effect type.
	{
		id: 'maskBrush',
		isOn: (state) => state.activeBrush !== null,
		toolbar: BrushToolbar,
	},
];

// The tool whose strip is shown. Crop mode shows none.
export function useCanvasToolStrip(): CanvasTool | undefined {
	const tool = useAppStore((state) =>
		CANVAS_TOOLS.find((item) => item.isOn(state)),
	);
	const cropping = useTransientStore((state) => state.geometry.cropping);
	return cropping ? undefined : tool;
}
