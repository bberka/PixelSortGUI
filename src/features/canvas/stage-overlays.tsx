import type {RefObject} from 'react';
import {RotateCwIcon} from 'lucide-react';
import {ZoomControl} from './zoom-control.tsx';
import {Button} from '@/components/ui/button';
import {Progress} from '@/components/ui/progress';
import {cn} from '@/lib/utils';

export type StageOverlaysProps = {
	readonly labelRef: RefObject<HTMLSpanElement | null>;
	readonly zoom: number;
	readonly onFit: () => void;
	readonly onZoom: (zoom: number) => void;
	readonly progressVisible: boolean;
	readonly progressFraction: number;
	readonly renderingFull: boolean;
	// The bottom-right corner holds a split side's label.
	readonly renderingFullAtTop?: boolean;
	readonly failed: boolean;
	readonly onRetry: () => void;
};

/**
 The layers above the canvas: the render progress bar, the zoom control, the
 full-resolution pill and the error card. All of them ignore pointer events
 except the buttons, so a drag started on the canvas is never swallowed.
 */
export function StageOverlays({
	labelRef,
	zoom,
	onFit,
	onZoom,
	progressVisible,
	progressFraction,
	renderingFull,
	renderingFullAtTop = false,
	failed,
	onRetry,
}: StageOverlaysProps) {
	return (
		<>
			{progressVisible ? (
				<div className="pointer-events-none absolute inset-x-0 top-0">
					<Progress
						aria-label="Render progress"
						className="h-0.5 w-full rounded-none bg-accent/20"
						value={Math.round(progressFraction * 100)}
					/>
				</div>
			) : null}
			<div className="absolute bottom-2 left-2">
				<ZoomControl
					labelRef={labelRef}
					zoom={zoom}
					onFit={onFit}
					onZoom={onZoom}
				/>
			</div>
			{renderingFull ? (
				<div
					className={cn(
						'surface-overlay pointer-events-none absolute right-2 rounded-sm px-2 py-1 text-xs leading-4 font-medium',
						renderingFullAtTop ? 'top-2' : 'bottom-2',
					)}
				>
					Rendering full resolution
				</div>
			) : null}
			{failed ? (
				<div
					role="alert"
					className="pointer-events-none absolute inset-0 flex items-center justify-center p-4"
				>
					<div className="surface-overlay pointer-events-auto flex w-full max-w-[36ch] flex-col items-start gap-3 rounded-lg p-4">
						<p className="text-sm leading-5 font-medium">
							Rendering stopped unexpectedly.
						</p>
						<Button type="button" variant="outline" size="sm" onClick={onRetry}>
							<RotateCwIcon aria-hidden="true" />
							Retry
						</Button>
					</div>
				</div>
			) : null}
		</>
	);
}
