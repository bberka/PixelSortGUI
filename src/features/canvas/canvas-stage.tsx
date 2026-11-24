import {useCallback, useEffect, useRef, useState} from 'react';
import {RotateCwIcon} from 'lucide-react';
import {drawCanvas} from './draw.ts';
import {ZoomControl} from './zoom-control.tsx';
import {
	clampCenter,
	clampZoom,
	fitView,
	fitZoom,
	formatZoomPercent,
	panBy,
	panByKey,
	resolveView,
	sourceAt,
	zoomAt,
	zoomTo,
	type CanvasView,
	type Point,
	type Size,
} from './view.ts';
import {useAppRuntime, useAppStore} from '@/app/runtime-context.tsx';
import {Button} from '@/components/ui/button';
import {Progress} from '@/components/ui/progress';

/**
AC-F8.3: the progress bar appears once a render has run this long.
*/
export const PROGRESS_DELAY_MS = 300;
/**
A wheel gesture has no release event; the view is saved this long after it.
*/
export const WHEEL_COMMIT_MS = 200;
const WHEEL_ZOOM_RATE = 0.0015;
const TAP_TIMEOUT_MS = 300;
const TAP_SLOP_PX = 12;
const CHECKER_TILE_PX = 16;
const CANVAS_LABEL = 'Image canvas';

type Pinch = {
	readonly startZoom: number;
	readonly anchorSource: Point;
	readonly startDistance: number;
};

function devicePixelRatio(): number {
	const ratio = globalThis.devicePixelRatio;
	return typeof ratio === 'number' && ratio > 0 ? ratio : 1;
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

function createCheckerPattern(
	context: CanvasRenderingContext2D,
	first: string,
	second: string,
): CanvasPattern | null {
	const tile = document.createElement('canvas');
	tile.width = CHECKER_TILE_PX * 2;
	tile.height = CHECKER_TILE_PX * 2;
	const tileContext = tile.getContext('2d');
	if (!tileContext) {
		return null;
	}

	tileContext.fillStyle = second;
	tileContext.fillRect(0, 0, tile.width, tile.height);
	tileContext.fillStyle = first;
	tileContext.fillRect(0, 0, CHECKER_TILE_PX, CHECKER_TILE_PX);
	tileContext.fillRect(
		CHECKER_TILE_PX,
		CHECKER_TILE_PX,
		CHECKER_TILE_PX,
		CHECKER_TILE_PX,
	);
	return context.createPattern(tile, 'repeat');
}

function useDelayedFlag(active: boolean, delayMs: number): boolean {
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		if (!active) {
			setVisible(false);
			return undefined;
		}

		const timer = globalThis.setTimeout(() => {
			setVisible(true);
		}, delayMs);
		return () => {
			globalThis.clearTimeout(timer);
		};
	}, [active, delayMs]);
	return visible;
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
	const frame = useAppStore((state) => state.render.frame);
	const full = useAppStore((state) => state.render.full);
	const busy = useAppStore((state) => state.render.busy);
	const progress = useAppStore((state) => state.render.progress);
	const failed = useAppStore((state) => state.render.failed);

	const [labelZoom, setLabelZoom] = useState(1);

	const stageRef = useRef<HTMLDivElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const labelRef = useRef<HTMLSpanElement | null>(null);
	const viewRef = useRef<CanvasView | null>(null);
	const viewportRef = useRef<Size>({width: 0, height: 0});
	const sourceRef = useRef<Size | null>(null);
	const frameRef = useRef(frame);
	const fullRef = useRef(full);
	const checkerRef = useRef<CanvasPattern | null>(null);
	const rafRef = useRef<number | null>(null);
	const dirtyRef = useRef(false);
	const pointersRef = useRef(new Map<number, Point>());
	const pinchRef = useRef<Pinch | null>(null);
	const gestureStartRef = useRef<Point | null>(null);
	const lastTapRef = useRef<{time: number; position: Point} | null>(null);
	const wheelTimerRef = useRef<unknown>(null);

	const previewBusy = busy.drag || busy.settle;
	const progressVisible = useDelayedFlag(previewBusy, PROGRESS_DELAY_MS);
	const progressFraction = busy.settle ? progress.settle : progress.drag;

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

		const tiles = fullRef.current;
		drawCanvas({
			surface,
			viewport: {width, height},
			view: viewRef.current,
			source: sourceRef.current,
			frame: frameRef.current
				? {
						bitmap: frameRef.current.bitmap,
						width: frameRef.current.width,
						height: frameRef.current.height,
					}
				: null,
			tiles: tiles
				? tiles.tiles.map((tile) => ({
						x: tile.x,
						y: tile.y,
						bitmap: tile.bitmap,
						width: tile.bitmap.width,
						height: tile.bitmap.height,
					}))
				: null,
			checker: checkerRef.current,
			dpr,
		});
	}, []);

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
			scheduleDraw();
		},
		[scheduleDraw, writeLabel],
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

	// The viewport decides the fit zoom; a resize keeps a custom zoom and centre.
	useEffect(() => {
		const stage = stageRef.current;
		if (!stage) {
			return undefined;
		}

		const sync = () => {
			const width = stage.clientWidth;
			const height = stage.clientHeight;
			const previous = viewportRef.current;
			if (previous.width === width && previous.height === height) {
				return;
			}

			viewportRef.current = {width, height};
			const source = sourceRef.current;
			const {current} = viewRef;
			if (source && current) {
				claimView(
					current.fitMode === 'fit'
						? fitView(source, {width, height})
						: clampCenter(current, source, {width, height}),
				);
				return;
			}

			scheduleDraw();
		};

		sync();
		if (typeof ResizeObserver !== 'function') {
			return undefined;
		}

		const observer = new ResizeObserver(sync);
		observer.observe(stage);
		return () => {
			observer.disconnect();
		};
	}, [claimView, scheduleDraw]);

	useEffect(() => {
		frameRef.current = frame;
		fullRef.current = full;
		scheduleDraw();
	}, [frame, full, scheduleDraw]);

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
			const viewport = viewportRef.current;
			const rect = canvas.getBoundingClientRect();
			const anchor = {
				x: event.clientX - rect.left,
				y: event.clientY - rect.top,
			};

			if (event.ctrlKey || event.metaKey) {
				const zoom = clampZoom(
					current.zoom * Math.exp(-event.deltaY * WHEEL_ZOOM_RATE),
					fitZoom(source, viewport),
				);
				applyLive(zoomAt(current, anchor, zoom, source, viewport));
			} else {
				const horizontal =
					event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
				const vertical =
					event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;
				applyLive(panBy(current, -horizontal, -vertical, source, viewport));
			}

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

			const {current} = viewRef;
			const source = sourceRef.current;
			if (!current || !source) {
				return;
			}

			const viewport = viewportRef.current;
			switch (event.key) {
				case '+':
				case '=': {
					event.preventDefault();
					commitView(zoomTo(current, current.zoom * 2, source, viewport));
					break;
				}

				case '-':
				case '_': {
					event.preventDefault();
					commitView(zoomTo(current, current.zoom / 2, source, viewport));
					break;
				}

				case '0': {
					event.preventDefault();
					commitView(fitView(source, viewport));
					break;
				}

				case '1': {
					event.preventDefault();
					commitView(zoomTo(current, 1, source, viewport));
					break;
				}

				default: {
					break;
				}
			}
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

	const startPinch = (current: CanvasView) => {
		const points = [...pointersRef.current.values()];
		if (points.length < 2) {
			return;
		}

		const [first, second] = points;
		const midpoint = {
			x: (first.x + second.x) / 2,
			y: (first.y + second.y) / 2,
		};
		pinchRef.current = {
			startZoom: current.zoom,
			anchorSource: sourceAt(current, midpoint, viewportRef.current),
			startDistance: Math.hypot(second.x - first.x, second.y - first.y),
		};
	};

	const movePinch = (source: Size): CanvasView | null => {
		const pinch = pinchRef.current;
		const points = [...pointersRef.current.values()];
		if (!pinch || points.length < 2) {
			return null;
		}

		const [first, second] = points;
		const distance = Math.hypot(second.x - first.x, second.y - first.y);
		if (!(pinch.startDistance > 0) || !(distance > 0)) {
			return null;
		}

		const viewport = viewportRef.current;
		const zoom = clampZoom(
			(pinch.startZoom * distance) / pinch.startDistance,
			fitZoom(source, viewport),
		);
		const midpoint = {
			x: (first.x + second.x) / 2,
			y: (first.y + second.y) / 2,
		};
		return clampCenter(
			{
				zoom,
				centerX:
					pinch.anchorSource.x - (midpoint.x - viewport.width / 2) / zoom,
				centerY:
					pinch.anchorSource.y - (midpoint.y - viewport.height / 2) / zoom,
				fitMode: 'custom',
			},
			source,
			viewport,
		);
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
			startPinch(current);
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

		if (pointersRef.current.size >= 2) {
			const next = movePinch(source);
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

		const moved =
			start !== null &&
			Math.hypot(position.x - start.x, position.y - start.y) > TAP_SLOP_PX;
		if (!canTap || moved || event.pointerType === 'mouse') {
			lastTapRef.current = null;
			return;
		}

		const last = lastTapRef.current;
		const now = globalThis.performance.now();
		if (
			last &&
			now - last.time <= TAP_TIMEOUT_MS &&
			Math.hypot(position.x - last.position.x, position.y - last.position.y) <=
				TAP_SLOP_PX
		) {
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
		const {key} = event;
		if (
			key !== 'ArrowLeft' &&
			key !== 'ArrowRight' &&
			key !== 'ArrowUp' &&
			key !== 'ArrowDown'
		) {
			return;
		}

		const {current} = viewRef;
		const source = sourceRef.current;
		if (!current || !source) {
			return;
		}

		event.preventDefault();
		commitView(panByKey(current, key, source, viewportRef.current));
	};

	const retry = () => {
		bundle.coordinator.retry();
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
			{/*
				T5.2 (compare and split) draws its overlay layers here, using the
				same `viewRef` and `sourceRef` so both stay aligned under zoom and pan.
			*/}
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
					zoom={labelZoom}
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
				/>
			</div>
			{busy.full ? (
				<div className="surface-overlay pointer-events-none absolute right-2 bottom-2 rounded-sm px-2 py-1 text-xs leading-4 font-medium">
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
						<Button type="button" variant="outline" size="sm" onClick={retry}>
							<RotateCwIcon aria-hidden="true" />
							Retry
						</Button>
					</div>
				</div>
			) : null}
		</div>
	);
}
