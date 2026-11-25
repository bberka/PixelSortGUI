import {useEffect, useRef, type RefObject} from 'react';
import {MoveHorizontalIcon} from 'lucide-react';
import {
	clampSplitPosition,
	formatSplitPercent,
	stepSplitPosition,
} from './compare-logic.ts';

export type CompareOverlayProps = {
	readonly stageRef: RefObject<HTMLDivElement | null>;
	readonly showingOriginal: boolean;
	readonly splitActive: boolean;
	readonly splitPosition: number;
	readonly onDragSplit: (position: number) => void;
	readonly onCommitSplit: (position: number) => void;
};

/**
 On-canvas compare labels ("Original" / "Edited") and the split-view divider.
 Pointer drags move the divider DOM node directly so no React re-render or
 app-store write occurs per pointer move.
 */
export function CompareOverlay({
	stageRef,
	showingOriginal,
	splitActive,
	splitPosition,
	onDragSplit,
	onCommitSplit,
}: CompareOverlayProps) {
	const dividerRef = useRef<HTMLDivElement | null>(null);
	const handleRef = useRef<HTMLDivElement | null>(null);
	const pointerIdRef = useRef<number | null>(null);
	const livePositionRef = useRef(clampSplitPosition(splitPosition));

	const syncDividerDom = (position: number) => {
		const clamped = clampSplitPosition(position);
		livePositionRef.current = clamped;
		const percent = formatSplitPercent(clamped);
		if (dividerRef.current) {
			dividerRef.current.style.left = `${clamped * 100}%`;
		}

		if (!handleRef.current) {
			return;
		}

		handleRef.current.setAttribute('aria-valuenow', String(percent));
		handleRef.current.setAttribute('aria-valuetext', `${percent}%`);
	};

	useEffect(() => {
		if (pointerIdRef.current !== null) {
			return;
		}

		syncDividerDom(splitPosition);
	}, [splitPosition, splitActive, showingOriginal]);

	if (showingOriginal) {
		return (
			<div
				data-slot="compare-label-original"
				className="surface-overlay pointer-events-none absolute top-2 left-2 rounded-sm px-2 py-1 text-xs leading-4 font-medium"
			>
				Original
			</div>
		);
	}

	if (!splitActive) {
		return null;
	}

	const positionFromClientX = (clientX: number): number => {
		const stage = stageRef.current;
		if (!stage) {
			return livePositionRef.current;
		}

		const rect = stage.getBoundingClientRect();
		return rect.width > 0
			? clampSplitPosition((clientX - rect.left) / rect.width)
			: livePositionRef.current;
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

		const next = positionFromClientX(event.clientX);
		syncDividerDom(next);
		onDragSplit(next);
	};

	const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		if (pointerIdRef.current !== event.pointerId) {
			return;
		}

		event.stopPropagation();
		const next = positionFromClientX(event.clientX);
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

	return (
		<>
			<div
				data-slot="compare-label-original"
				className="surface-overlay pointer-events-none absolute top-2 left-2 rounded-sm px-2 py-1 text-xs leading-4 font-medium"
			>
				Original
			</div>
			<div
				data-slot="compare-label-edited"
				className="surface-overlay pointer-events-none absolute top-2 right-2 rounded-sm px-2 py-1 text-xs leading-4 font-medium"
			>
				Edited
			</div>
			<div
				ref={dividerRef}
				data-slot="split-divider"
				style={{left: `${clamped * 100}%`}}
				className="pointer-events-none absolute inset-y-0 z-10 -translate-x-1/2"
			>
				<div
					className="pointer-events-auto flex h-full w-6 cursor-ew-resize touch-none items-center justify-center"
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onPointerUp={endPointer}
					onPointerCancel={endPointer}
				>
					<div
						aria-hidden="true"
						className="split-divider-line pointer-events-none h-full w-0.5"
					/>
					<div
						ref={handleRef}
						{...splitterAttrs}
						aria-orientation="vertical"
						aria-label="Compare split position"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={percent}
						aria-valuetext={`${percent}%`}
						data-slot="split-divider-handle"
						className="surface-overlay absolute flex size-11 cursor-ew-resize touch-none items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
						onKeyDown={handleKeyDown}
					>
						<MoveHorizontalIcon aria-hidden="true" className="size-4" />
					</div>
				</div>
			</div>
		</>
	);
}
