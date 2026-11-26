import {useCallback, useEffect, useRef, useState} from 'react';
import {CompareOverlay} from './compare.tsx';
import {clampSplitPosition} from './compare-logic.ts';
import {drawCanvas, type CompareDraw} from './draw.ts';
import {createCheckerPattern} from './checker.ts';
import {
	arrowPan,
	beginPinch,
	commandView,
	isDoubleTap,
	isTap,
	pinchView,
	viewCommandFor,
	wheelView,
	type Pinch,
} from './gestures.ts';
import {StageOverlays} from './stage-overlays.tsx';
import {useDelayedFlag} from './use-delayed-flag.ts';
import {
	clampCenter,
	fitView,
	formatZoomPercent,
	panBy,
	resolveView,
	zoomAt,
	zoomTo,
	type CanvasView,
	type Point,
	type Size,
} from './view.ts';
import {announce} from '@/app/announcer.ts';
import {
	useAppRuntime,
	useAppStore,
	useTransientStore,
} from '@/app/runtime-context.tsx';
import {selectShowingOriginal} from '@/state/transient.ts';
import {sideCanvasLabel, selectSplitOrientation} from '@/state/split-sides.ts';
import type {RenderStatus} from '@/state/app-store.ts';
import {DEFAULT_SPLIT_POSITION} from '@/storage/types.ts';

/**
AC-F8.3: the progress bar appears once a render has run this long.
*/
export const PROGRESS_DELAY_MS = 300;
/**
A wheel gesture has no release event; the view is saved this long after it.
*/
export const WHEEL_COMMIT_MS = 200;
const WHEEL_ZOOM_RATE = 0.0015;
const CANVAS_LABEL = 'Image canvas';

function devicePixelRatio(): number {
	const ratio = globalThis.devicePixelRatio;
	return typeof ratio === 'number' && ratio > 0 ? ratio : 1;
}

function toRenderedSide({frame, full}: Pick<RenderStatus, 'frame' | 'full'>) {
	return {
		frame: frame
			? {bitmap: frame.bitmap, width: frame.width, height: frame.height}
			: null,
		tiles: full
			? full.tiles.map((tile) => ({
					x: tile.x,
					y: tile.y,
					bitmap: tile.bitmap,
					width: tile.bitmap.width,
					height: tile.bitmap.height,
				}))
			: null,
	};
}

function isPointerTarget(target: EventTarget | null): boolean {
	if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) {
		return false;
	}

	const tag = target.tagName;
	return (
		tag === 'INPUT' ||
		tag === 'TEXTAREA' ||
		tag === 'SELECT' ||
		target.isContentEditable
	);
}

/**
 The centre of the editor: one canvas drawn imperatively at device pixel ratio
 from the frames the render coordinator delivers, plus the render overlays.
 Pan and zoom change only refs and the canvas pixels; the view state reaches
 the store once per gesture, so a drag never re-renders React.
 */
export function CanvasStage() {
	const {bundle} = useAppRuntime();
	const projectId = useAppStore((state) => state.activeProjectId);
	const sourceWidth = useAppStore((state) => state.activeProject?.sourceWidth);
	const sourceHeight = useAppStore(
		(state) => state.activeProject?.sourceHeight,
	);
	const setViewState = useAppStore((state) => state.setViewState);
	const commitSplitPosition = useAppStore((state) => state.commitSplitPosition);
	const compareMode = useAppStore((state) => state.compareMode);
	const splitPosition = useAppStore(
		(state) =>
			state.activeProject?.viewState.splitPosition ?? DEFAULT_SPLIT_POSITION,
	);
	const showingOriginal = useTransientStore(selectShowingOriginal);
	const renderSource = useAppStore((state) => state.render.source);
	const frame = useAppStore((state) => state.render.frame);
	const full = useAppStore((state) => state.render.full);
	const busy = useAppStore((state) => state.render.busy);
	const progress = useAppStore((state) => state.render.progress);
	const failed = useAppStore(
		(state) => state.render.failed || state.renderA.failed,
	);
	const frameA = useAppStore((state) => state.renderA.frame);
	const fullA = useAppStore((state) => state.renderA.full);
	const busyA = useAppStore((state) => state.renderA.busy);
	const progressA = useAppStore((state) => state.renderA.progress);
	const orientation = useAppStore(selectSplitOrientation);
	const labelA = useAppStore((state) =>
		sideCanvasLabel(state.activeProject, 'a'),
	);
	const labelB = useAppStore((state) =>
		sideCanvasLabel(state.activeProject, 'b'),
	);

	const [labelZoom, setLabelZoom] = useState(1);

	const stageRef = useRef<HTMLDivElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const labelRef = useRef<HTMLSpanElement | null>(null);
	const viewRef = useRef<CanvasView | null>(null);
	const viewportRef = useRef<Size>({width: 0, height: 0});
	const sourceRef = useRef<Size | null>(null);
	const renderSourceRef = useRef(renderSource);
	const frameRef = useRef(frame);
	const fullRef = useRef(full);
	const compareModeRef = useRef(compareMode);
	const showingOriginalRef = useRef(showingOriginal);
	const splitPositionRef = useRef(clampSplitPosition(splitPosition));
	const checkerRef = useRef<CanvasPattern | null>(null);
	const rafRef = useRef<number | null>(null);
	const dirtyRef = useRef(false);
	const pointersRef = useRef(new Map<number, Point>());
	const pinchRef = useRef<Pinch | null>(null);
	const gestureStartRef = useRef<Point | null>(null);
	const lastTapRef = useRef<{time: number; position: Point} | null>(null);
	const wheelTimerRef = useRef<unknown>(null);

	const previewBusyB = busy.drag || busy.settle;
	const previewBusy = previewBusyB || busyA.drag || busyA.settle;
	const progressVisible = useDelayedFlag(previewBusy, PROGRESS_DELAY_MS);
	// One bar: side B's progress, or side A's while only A is rendering.
	const shown = previewBusyB
		? {busy, progress}
		: {busy: busyA, progress: progressA};
	const progressFraction = shown.busy.settle
		? shown.progress.settle
		: shown.progress.drag;
	const announcedRenderRef = useRef(false);
	const renderingFull = busy.full || busyA.full;
	const renderBusy = busy.settle || busyA.settle || renderingFull;
	const announceRender = useDelayedFlag(renderBusy, PROGRESS_DELAY_MS);

	// Announce long settle and full-resolution renders (>= 300 ms) without
	// flooding live announcements during rapid drag frames or fast updates
	// (AC-F19.3).
	useEffect(() => {
		if (projectId === null) {
			announcedRenderRef.current = false;
			return;
		}

		if (failed) {
			if (announcedRenderRef.current) {
				announcedRenderRef.current = false;
				announce('Render failed.');
			}

			return;
		}

		if (announceRender && !announcedRenderRef.current) {
			announcedRenderRef.current = true;
			announce('Rendering');
			return;
		}

		if (renderBusy || !announcedRenderRef.current) {
			return;
		}

		announcedRenderRef.current = false;
		announce('Rendered');
	}, [announceRender, failed, projectId, renderBusy]);

	const draw = useCallback(() => {
		const canvas = canvasRef.current;
		const stage = stageRef.current;
		if (!canvas || !stage) {
			return;
		}

		const width = stage.clientWidth;
		const height = stage.clientHeight;
		if (!(width > 0) || !(height > 0)) {
			return;
		}

		const dpr = devicePixelRatio();
		const backingWidth = Math.max(1, Math.round(width * dpr));
		const backingHeight = Math.max(1, Math.round(height * dpr));
		if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
			canvas.width = backingWidth;
			canvas.height = backingHeight;
		}

		const surface = canvas.getContext('2d');
		if (!surface) {
			return;
		}

		const loadedSource = renderSourceRef.current;
		// Read at draw time: side A's bitmaps close as soon as it leaves the state.
		const {renderA, activeProject} = bundle.store.getState();
		let compare: CompareDraw = {mode: 'none'};
		if (showingOriginalRef.current) {
			compare = {mode: 'original'};
		} else if (compareModeRef.current === 'split') {
			compare = {
				mode: 'split',
				position: splitPositionRef.current,
				orientation: activeProject?.viewState.splitOrientation,
			};
		}

		drawCanvas({
			surface,
			viewport: {width, height},
			view: viewRef.current,
			source: sourceRef.current,
			original: loadedSource
				? {
						bitmap: loadedSource.original,
						width: loadedSource.settle.width,
						height: loadedSource.settle.height,
					}
				: null,
			...toRenderedSide({frame: frameRef.current, full: fullRef.current}),
			sideA: toRenderedSide(renderA),
			compare,
			checker: checkerRef.current,
			dpr,
		});
	}, [bundle.store]);

	const scheduleDraw = useCallback(() => {
		if (rafRef.current !== null) {
			return;
		}

		rafRef.current = globalThis.requestAnimationFrame(() => {
			rafRef.current = null;
			draw();
		});
	}, [draw]);

	const writeLabel = useCallback((zoom: number) => {
		const label = labelRef.current;
		if (label) {
			label.textContent = formatZoomPercent(zoom);
		}
	}, []);

	const clearWheelTimer = useCallback(() => {
		if (wheelTimerRef.current === null) {
			return;
		}

		globalThis.clearTimeout(wheelTimerRef.current as number);
		wheelTimerRef.current = null;
	}, []);

	const commitView = useCallback(
		(next: CanvasView) => {
			viewRef.current = next;
			dirtyRef.current = false;
			clearWheelTimer();
			writeLabel(next.zoom);
			setLabelZoom(next.zoom);
			scheduleDraw();
			setViewState({
				fitMode: next.fitMode,
				zoom: next.zoom,
				centerX: next.centerX,
				centerY: next.centerY,
			});
		},
		[clearWheelTimer, scheduleDraw, setViewState, writeLabel],
	);

	const applyLive = useCallback(
		(next: CanvasView) => {
			viewRef.current = next;
			dirtyRef.current = true;
			writeLabel(next.zoom);
			scheduleDraw();
		},
		[scheduleDraw, writeLabel],
	);

	const claimView = useCallback(
		(next: CanvasView) => {
			viewRef.current = next;
			dirtyRef.current = false;
			writeLabel(next.zoom);
			setLabelZoom(next.zoom);
			if (viewportRef.current.width > 0 && viewportRef.current.height > 0) {
				bundle.store
					.getState()
					.setRenderViewScale(next.zoom * devicePixelRatio());
			}

			scheduleDraw();
		},
		[bundle.store, scheduleDraw, writeLabel],
	);

	// A new project, or a new source size, takes the stored view state.
	useEffect(() => {
		const project = bundle.store.getState().activeProject;
		if (!project) {
			sourceRef.current = null;
			viewRef.current = null;
			scheduleDraw();
			return;
		}

		const source: Size = {
			width: project.sourceWidth,
			height: project.sourceHeight,
		};
		sourceRef.current = source;
		claimView(resolveView(project.viewState, source, viewportRef.current));
	}, [bundle, projectId, sourceWidth, sourceHeight, claimView, scheduleDraw]);

	const syncViewport = useCallback((): Size => {
		const stage = stageRef.current;
		if (!stage) {
			return viewportRef.current;
		}

		const width = stage.clientWidth;
		const height = stage.clientHeight;
		const previous = viewportRef.current;
		if (previous.width === width && previous.height === height) {
			return previous;
		}

		const next: Size = {width, height};
		viewportRef.current = next;
		const source = sourceRef.current;
		const {current} = viewRef;
		if (source && current) {
			claimView(
				current.fitMode === 'fit'
					? fitView(source, next)
					: clampCenter(current, source, next),
			);
			return next;
		}

		scheduleDraw();
		return next;
	}, [claimView, scheduleDraw]);

	// The viewport decides the fit zoom; a resize keeps a custom zoom and centre.
	useEffect(() => {
		const stage = stageRef.current;
		if (!stage) {
			return undefined;
		}

		syncViewport();
		if (typeof ResizeObserver !== 'function') {
			return undefined;
		}

		const observer = new ResizeObserver(syncViewport);
		observer.observe(stage);
		return () => {
			observer.disconnect();
		};
	}, [syncViewport]);

	useEffect(() => {
		renderSourceRef.current = renderSource;
		frameRef.current = frame;
		fullRef.current = full;
		scheduleDraw();
	}, [renderSource, frame, full, scheduleDraw]);

	useEffect(() => {
		compareModeRef.current = compareMode;
		showingOriginalRef.current = showingOriginal;
		splitPositionRef.current = clampSplitPosition(splitPosition);
		scheduleDraw();
	}, [compareMode, showingOriginal, splitPosition, scheduleDraw]);

	useEffect(() => {
		scheduleDraw();
	}, [frameA, fullA, orientation, scheduleDraw]);

	useEffect(
		() =>
			bundle.transientStore.subscribe((state, previous) => {
				if (
					state.splitPosition === previous.splitPosition ||
					state.splitPosition === null
				) {
					return;
				}

				splitPositionRef.current = clampSplitPosition(state.splitPosition);
				scheduleDraw();
			}),
		[bundle.transientStore, scheduleDraw],
	);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) {
			return undefined;
		}

		const handleWheel = (event: WheelEvent) => {
			const {current} = viewRef;
			const source = sourceRef.current;
			if (!current || !source) {
				return;
			}

			event.preventDefault();
			const rect = canvas.getBoundingClientRect();
			applyLive(
				wheelView(
					current,
					event,
					{x: event.clientX - rect.left, y: event.clientY - rect.top},
					source,
					viewportRef.current,
					WHEEL_ZOOM_RATE,
				),
			);

			clearWheelTimer();
			wheelTimerRef.current = globalThis.setTimeout(() => {
				wheelTimerRef.current = null;
				if (dirtyRef.current && viewRef.current) {
					commitView(viewRef.current);
				}
			}, WHEEL_COMMIT_MS);
		};

		canvas.addEventListener('wheel', handleWheel, {passive: false});
		return () => {
			canvas.removeEventListener('wheel', handleWheel);
			if (wheelTimerRef.current === null) {
				return;
			}

			globalThis.clearTimeout(wheelTimerRef.current as number);
			wheelTimerRef.current = null;
		};
	}, [applyLive, clearWheelTimer, commitView]);

	useEffect(
		() => () => {
			clearWheelTimer();
			if (rafRef.current === null) {
				return;
			}

			globalThis.cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		},
		[clearWheelTimer],
	);

	const refreshChecker = useCallback(() => {
		const canvas = canvasRef.current;
		const surface = canvas?.getContext('2d');
		if (!canvas || !surface) {
			return;
		}

		const styles = globalThis.getComputedStyle(canvas);
		const first = styles.getPropertyValue('--checker-a').trim();
		const second = styles.getPropertyValue('--checker-b').trim();
		if (first === '' || second === '') {
			return;
		}

		checkerRef.current = createCheckerPattern(
			surface,
			`rgb(${first})`,
			`rgb(${second})`,
		);
		scheduleDraw();
	}, [scheduleDraw]);

	// The checkerboard colours come from the theme tokens, so it follows a theme
	// switch or a change to the system preference.
	useEffect(() => {
		refreshChecker();
		if (typeof MutationObserver !== 'function') {
			return undefined;
		}

		const observer = new MutationObserver(refreshChecker);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-theme'],
		});
		const media =
			typeof globalThis.matchMedia === 'function'
				? globalThis.matchMedia('(prefers-color-scheme: dark)')
				: null;
		media?.addEventListener('change', refreshChecker);
		return () => {
			observer.disconnect();
			media?.removeEventListener('change', refreshChecker);
		};
	}, [refreshChecker]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				event.ctrlKey ||
				event.metaKey ||
				event.altKey ||
				isPointerTarget(event.target)
			) {
				return;
			}

			const command = viewCommandFor(event.key);
			const {current} = viewRef;
			const source = sourceRef.current;
			if (!command || !current || !source) {
				return;
			}

			event.preventDefault();
			commitView(commandView(command, current, source, viewportRef.current));
		};

		globalThis.addEventListener('keydown', handleKeyDown);
		return () => {
			globalThis.removeEventListener('keydown', handleKeyDown);
		};
	}, [commitView]);

	const pointerPosition = (event: {
		clientX: number;
		clientY: number;
		currentTarget: HTMLElement;
	}): Point => {
		const rect = event.currentTarget.getBoundingClientRect();
		return {x: event.clientX - rect.left, y: event.clientY - rect.top};
	};

	const toggleFitAndActual = (anchor: Point) => {
		const {current} = viewRef;
		const source = sourceRef.current;
		if (!current || !source) {
			return;
		}

		const viewport = viewportRef.current;
		commitView(
			current.fitMode === 'fit'
				? zoomAt(current, anchor, 1, source, viewport)
				: fitView(source, viewport),
		);
	};

	const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
		const {current} = viewRef;
		const source = sourceRef.current;
		if (
			!current ||
			!source ||
			(event.pointerType === 'mouse' && event.button !== 0)
		) {
			return;
		}

		if (event.pointerType !== 'mouse') {
			event.preventDefault();
			event.currentTarget.focus({preventScroll: true});
		}

		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {}

		const position = pointerPosition(event);
		pointersRef.current.set(event.pointerId, position);
		if (pointersRef.current.size === 1) {
			gestureStartRef.current = position;
			// Set here rather than through state so a drag never re-renders React.
			event.currentTarget.classList.replace('cursor-grab', 'cursor-grabbing');
		}

		if (pointersRef.current.size >= 2) {
			pinchRef.current = beginPinch(
				current,
				[...pointersRef.current.values()],
				viewportRef.current,
			);
		}
	};

	const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
		const previous = pointersRef.current.get(event.pointerId);
		if (!previous) {
			return;
		}

		const position = pointerPosition(event);
		pointersRef.current.set(event.pointerId, position);
		const {current} = viewRef;
		const source = sourceRef.current;
		if (!current || !source) {
			return;
		}

		const points = [...pointersRef.current.values()];
		if (pinchRef.current && points.length >= 2) {
			const next = pinchView(
				pinchRef.current,
				points,
				source,
				viewportRef.current,
			);
			if (next) {
				applyLive(next);
			}

			return;
		}

		applyLive(
			panBy(
				current,
				position.x - previous.x,
				position.y - previous.y,
				source,
				viewportRef.current,
			),
		);
	};

	const endPointer = (
		event: React.PointerEvent<HTMLCanvasElement>,
		canTap: boolean,
	) => {
		if (!pointersRef.current.has(event.pointerId)) {
			return;
		}

		const position =
			pointersRef.current.get(event.pointerId) ?? pointerPosition(event);
		const start = gestureStartRef.current;
		pointersRef.current.delete(event.pointerId);
		try {
			event.currentTarget.releasePointerCapture(event.pointerId);
		} catch {}

		if (pointersRef.current.size > 0) {
			pinchRef.current = null;
			gestureStartRef.current = [...pointersRef.current.values()][0] ?? null;
			return;
		}

		pinchRef.current = null;
		gestureStartRef.current = null;
		event.currentTarget.classList.replace('cursor-grabbing', 'cursor-grab');
		if (dirtyRef.current && viewRef.current) {
			commitView(viewRef.current);
		}

		if (!canTap || event.pointerType === 'mouse' || !isTap(position, start)) {
			lastTapRef.current = null;
			return;
		}

		const now = globalThis.performance.now();
		if (isDoubleTap(lastTapRef.current, position, now)) {
			lastTapRef.current = null;
			toggleFitAndActual(position);
			return;
		}

		lastTapRef.current = {time: now, position};
	};

	const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
		endPointer(event, true);
	};

	const handlePointerCancel = (
		event: React.PointerEvent<HTMLCanvasElement>,
	) => {
		endPointer(event, false);
	};

	const handleDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		toggleFitAndActual(pointerPosition(event));
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
		const viewport = syncViewport();
		const {current} = viewRef;
		const source = sourceRef.current;
		if (!current || !source) {
			return;
		}

		const next = arrowPan(event.key, current, source, viewport);
		if (!next) {
			return;
		}

		event.preventDefault();
		commitView(next);
	};

	return (
		<div
			ref={stageRef}
			className="relative h-full min-h-0 w-full overflow-hidden"
		>
			<canvas
				ref={canvasRef}
				aria-label={CANVAS_LABEL}
				tabIndex={0}
				className="absolute inset-0 block h-full w-full cursor-grab touch-none select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				onPointerCancel={handlePointerCancel}
				onDoubleClick={handleDoubleClick}
				onKeyDown={handleKeyDown}
			/>
			<CompareOverlay
				stageRef={stageRef}
				showingOriginal={showingOriginal}
				splitActive={compareMode === 'split' && projectId !== null}
				splitPosition={splitPosition}
				orientation={orientation}
				labelA={labelA}
				labelB={labelB}
				onDragSplit={(position) => {
					splitPositionRef.current = clampSplitPosition(position);
					scheduleDraw();
				}}
				onCommitSplit={(position) => {
					const clamped = clampSplitPosition(position);
					splitPositionRef.current = clamped;
					scheduleDraw();
					commitSplitPosition(clamped);
				}}
			/>
			<StageOverlays
				labelRef={labelRef}
				zoom={labelZoom}
				progressVisible={progressVisible}
				progressFraction={progressFraction}
				renderingFull={renderingFull}
				renderingFullAtTop={
					compareMode === 'split' && orientation === 'horizontal'
				}
				failed={failed}
				onFit={() => {
					const source = sourceRef.current;
					if (source) {
						commitView(fitView(source, viewportRef.current));
					}
				}}
				onZoom={(zoom) => {
					const {current} = viewRef;
					const source = sourceRef.current;
					if (current && source) {
						commitView(zoomTo(current, zoom, source, viewportRef.current));
					}
				}}
				onRetry={() => {
					bundle.store.getState().retryRender();
				}}
			/>
		</div>
	);
}
