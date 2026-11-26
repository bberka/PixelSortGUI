import {useCallback, useEffect, useRef, type RefObject} from 'react';
import {MoveHorizontalIcon, MoveVerticalIcon} from 'lucide-react';
import {
	clampSplitPosition,
	formatSplitPercent,
	stepSplitPosition,
} from './compare-logic.ts';
import type {SplitOrientation} from '@/storage/types.ts';
import {cn} from '@/lib/utils';

export type CompareOverlayProps = {
	readonly stageRef: RefObject<HTMLDivElement | null>;
	readonly showingOriginal: boolean;
	readonly splitActive: boolean;
	readonly splitPosition: number;
	readonly orientation?: SplitOrientation;
	readonly labelA?: string;
	readonly labelB?: string;
	readonly onDragSplit: (position: number) => void;
	readonly onCommitSplit: (position: number) => void;
};

const PILL_CLASS =
	'surface-overlay pointer-events-none absolute rounded-sm px-2 py-1 text-xs leading-4 font-medium';

/**
 On-canvas compare labels (one per split side) and the split-view divider.
 Pointer drags move the divider DOM node directly so no React re-render or
 app-store write occurs per pointer move.
 */
export function CompareOverlay({
	stageRef,
	showingOriginal,
	splitActive,
	splitPosition,
	orientation = 'vertical',
	labelA = 'Original',
	labelB = 'Original',
	onDragSplit,
	onCommitSplit,
}: CompareOverlayProps) {
	const horizontal = orientation === 'horizontal';
	const dividerRef = useRef<HTMLDivElement | null>(null);
	const handleRef = useRef<HTMLDivElement | null>(null);
	const pointerIdRef = useRef<number | null>(null);
	const livePositionRef = useRef(clampSplitPosition(splitPosition));

	const syncDividerDom = useCallback(
		(position: number) => {
			const clamped = clampSplitPosition(position);
			livePositionRef.current = clamped;
			const percent = formatSplitPercent(clamped);
			const divider = dividerRef.current;
			if (divider) {
				divider.style.left = horizontal ? '' : `${clamped * 100}%`;
				divider.style.top = horizontal ? `${clamped * 100}%` : '';
			}

			if (!handleRef.current) {
				return;
			}

			handleRef.current.setAttribute('aria-valuenow', String(percent));
			handleRef.current.setAttribute('aria-valuetext', `${percent}%`);
		},
		[horizontal],
	);

	useEffect(() => {
		if (pointerIdRef.current !== null) {
			return;
		}

		syncDividerDom(splitPosition);
	}, [splitPosition, splitActive, showingOriginal, syncDividerDom]);

	if (showingOriginal) {
		return (
			<div
				data-slot="compare-label-original"
				className={cn(PILL_CLASS, 'top-2 left-2')}
			>
				Original
			</div>
		);
	}

	if (!splitActive) {
		return null;
	}

	const positionFromPointer = (event: React.PointerEvent): number => {
		const rect = stageRef.current?.getBoundingClientRect();
		const extent = horizontal ? rect?.height : rect?.width;
		if (!rect || !extent) {
			return livePositionRef.current;
		}

		const offset = horizontal
			? event.clientY - rect.top
			: event.clientX - rect.left;
		return clampSplitPosition(offset / extent);
	};

	const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		if (event.pointerType === 'mouse' && event.button !== 0) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		pointerIdRef.current = event.pointerId;
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {}

		const next = positionFromPointer(event);
		syncDividerDom(next);
		onDragSplit(next);
	};

	const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		if (pointerIdRef.current !== event.pointerId) {
			return;
		}

		event.stopPropagation();
		const next = positionFromPointer(event);
		syncDividerDom(next);
		onDragSplit(next);
	};

	const endPointer = (event: React.PointerEvent<HTMLDivElement>) => {
		if (pointerIdRef.current !== event.pointerId) {
			return;
		}

		event.stopPropagation();
		pointerIdRef.current = null;
		try {
			event.currentTarget.releasePointerCapture(event.pointerId);
		} catch {}

		onCommitSplit(livePositionRef.current);
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.ctrlKey || event.metaKey || event.altKey) {
			return;
		}

		const next = stepSplitPosition(
			livePositionRef.current,
			event.key,
			event.shiftKey,
			orientation,
		);
		if (next === null) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		syncDividerDom(next);
		onCommitSplit(next);
	};

	const clamped = clampSplitPosition(splitPosition);
	const percent = formatSplitPercent(clamped);
	// WAI-ARIA 1.2 focusable window splitter: role="separator" with tabIndex=0.
	const splitterAttrs = {
		role: 'separator' as const,
		tabIndex: 0,
	};

	const MoveIcon = horizontal ? MoveVerticalIcon : MoveHorizontalIcon;
	const cursor = horizontal ? 'cursor-ns-resize' : 'cursor-ew-resize';

	return (
		<>
			<div data-slot="split-label-a" className={cn(PILL_CLASS, 'top-2 left-2')}>
				{labelA}
			</div>
			<div
				data-slot="split-label-b"
				className={cn(
					PILL_CLASS,
					horizontal ? 'right-2 bottom-2' : 'top-2 right-2',
				)}
			>
				{labelB}
			</div>
			<div
				ref={dividerRef}
				data-slot="split-divider"
				data-orientation={orientation}
				style={
					horizontal ? {top: `${clamped * 100}%`} : {left: `${clamped * 100}%`}
				}
				className={cn(
					'pointer-events-none absolute z-10',
					horizontal
						? 'inset-x-0 -translate-y-1/2'
						: 'inset-y-0 -translate-x-1/2',
				)}
			>
				<div
					className={cn(
						'pointer-events-auto flex touch-none items-center justify-center',
						horizontal ? 'h-6 w-full' : 'h-full w-6',
						cursor,
					)}
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onPointerUp={endPointer}
					onPointerCancel={endPointer}
				>
					<div
						aria-hidden="true"
						className={cn(
							'split-divider-line pointer-events-none',
							horizontal ? 'h-0.5 w-full' : 'h-full w-0.5',
						)}
					/>
					<div
						ref={handleRef}
						{...splitterAttrs}
						aria-orientation={orientation}
						aria-label="Compare split position"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={percent}
						aria-valuetext={`${percent}%`}
						data-slot="split-divider-handle"
						className={cn(
							'surface-overlay absolute flex size-11 touch-none items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
							cursor,
						)}
						onKeyDown={handleKeyDown}
					>
						<MoveIcon aria-hidden="true" className="size-4" />
					</div>
				</div>
			</div>
		</>
	);
}
