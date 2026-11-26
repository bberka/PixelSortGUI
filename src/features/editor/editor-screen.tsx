import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type KeyboardEvent,
	type PointerEvent,
} from 'react';
import {
	ChevronDownIcon,
	ChevronUpIcon,
	PanelRightCloseIcon,
	PanelRightOpenIcon,
} from 'lucide-react';
import {EditorSlot} from './editor-slots.tsx';
import {Button} from '@/components/ui/button';
import {useEditorViewportClass} from '@/lib/use-phone-layout.ts';
import {cn} from '@/lib/utils';

const TABLET_PANEL_HEIGHT_KEY = 'psg:tablet-panel-height';
const TABLET_PANEL_COLLAPSED_KEY = 'psg:tablet-panel-collapsed';
const TABLET_DEFAULT_HEIGHT = 360;
const TABLET_MIN_HEIGHT = 240;
const TABLET_COLLAPSED_HEIGHT = 48;
const TABLET_KEY_STEP = 20;
const TABLET_KEY_SHIFT_STEP = 60;

type PhoneSheetDetent = 'collapsed' | 'half' | 'expanded';

function maxTabletHeight(): number {
	const viewportHeight =
		typeof globalThis.innerHeight === 'number' && globalThis.innerHeight > 0
			? globalThis.innerHeight
			: 900;
	return Math.max(TABLET_MIN_HEIGHT, Math.floor(viewportHeight * 0.5));
}

function clampTabletHeight(height: number): number {
	return Math.max(
		TABLET_MIN_HEIGHT,
		Math.min(maxTabletHeight(), Math.round(height)),
	);
}

function readStoredTabletHeight(): number {
	try {
		const raw = globalThis.localStorage?.getItem(TABLET_PANEL_HEIGHT_KEY);
		if (raw !== null) {
			const parsed = Number(raw);
			if (Number.isFinite(parsed)) {
				return clampTabletHeight(parsed);
			}
		}
	} catch {}

	return clampTabletHeight(TABLET_DEFAULT_HEIGHT);
}

function readStoredTabletCollapsed(): boolean {
	try {
		return (
			globalThis.localStorage?.getItem(TABLET_PANEL_COLLAPSED_KEY) === 'true'
		);
	} catch {
		return false;
	}
}

function writeStorage(key: string, value: string): void {
	try {
		globalThis.localStorage?.setItem(key, value);
	} catch {}
}

function nextDetent(detent: PhoneSheetDetent): PhoneSheetDetent {
	switch (detent) {
		case 'collapsed': {
			return 'half';
		}

		case 'half': {
			return 'expanded';
		}

		case 'expanded': {
			return 'collapsed';
		}
	}
}

function detentButtonLabel(detent: PhoneSheetDetent): string {
	switch (detent) {
		case 'collapsed': {
			return 'Show parameters';
		}

		case 'half': {
			return 'Expand parameters';
		}

		case 'expanded': {
			return 'Collapse parameters';
		}
	}
}

function phoneSheetHeightStyle(detent: PhoneSheetDetent): string {
	switch (detent) {
		case 'collapsed': {
			return 'calc(56px + env(safe-area-inset-bottom, 0px))';
		}

		case 'half': {
			// Cap Half detent so the canvas keeps >= 40% of viewport height while a slider is dragged.
			return 'min(42dvh, calc(60dvh - 142px))';
		}

		case 'expanded': {
			return '80dvh';
		}
	}
}

/**
 Responsive editor frame assembling the four slots across phone portrait,
 phone landscape, tablet, and desktop viewports (DESIGN.md section 6).
 Both the canvas column and the effects aside stay mounted in stable tree
 positions across viewport changes so resizing preserves worker and view state.
 */
export function EditorScreen() {
	const viewportClass = useEditorViewportClass();
	const isDesktop = viewportClass === 'desktop';
	const isTablet = viewportClass === 'tablet';
	const isPhonePortrait = viewportClass === 'phone-portrait';
	const isPhoneLandscape = viewportClass === 'phone-landscape';

	const [tabletHeight, setTabletHeight] = useState(readStoredTabletHeight);
	const [tabletCollapsed, setTabletCollapsed] = useState(
		readStoredTabletCollapsed,
	);
	const [phoneDetent, setPhoneDetent] = useState<PhoneSheetDetent>('half');
	const [landscapeDrawerOpen, setLandscapeDrawerOpen] = useState(true);

	const dragRef = useRef<{startY: number; startHeight: number} | null>(null);
	const sheetDragRef = useRef<{
		startY: number;
		startDetent: PhoneSheetDetent;
	} | null>(null);

	const updateTabletHeight = useCallback((next: number) => {
		const clamped = clampTabletHeight(next);
		setTabletHeight(clamped);
		writeStorage(TABLET_PANEL_HEIGHT_KEY, String(clamped));
	}, []);

	const toggleTabletCollapsed = useCallback(() => {
		setTabletCollapsed((previous) => {
			const next = !previous;
			writeStorage(TABLET_PANEL_COLLAPSED_KEY, String(next));
			return next;
		});
	}, []);

	useEffect(() => {
		if (!isTablet) {
			return;
		}

		const handleResize = () => {
			setTabletHeight((current) => clampTabletHeight(current));
		};

		globalThis.addEventListener('resize', handleResize);
		return () => {
			globalThis.removeEventListener('resize', handleResize);
		};
	}, [isTablet]);

	const handleTabletSeparatorPointerDown = (
		event: PointerEvent<HTMLDivElement>,
	) => {
		if (event.button !== 0 && event.pointerType === 'mouse') {
			return;
		}

		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = {startY: event.clientY, startHeight: tabletHeight};
	};

	const handleTabletSeparatorPointerMove = (
		event: PointerEvent<HTMLDivElement>,
	) => {
		if (!dragRef.current) {
			return;
		}

		const delta = dragRef.current.startY - event.clientY;
		updateTabletHeight(dragRef.current.startHeight + delta);
	};

	const handleTabletSeparatorPointerUp = (
		event: PointerEvent<HTMLDivElement>,
	) => {
		if (!dragRef.current) {
			return;
		}

		dragRef.current = null;
		try {
			event.currentTarget.releasePointerCapture(event.pointerId);
		} catch {}
	};

	const handleTabletSeparatorKeyDown = (
		event: KeyboardEvent<HTMLDivElement>,
	) => {
		const step = event.shiftKey ? TABLET_KEY_SHIFT_STEP : TABLET_KEY_STEP;
		switch (event.key) {
			case 'ArrowUp': {
				event.preventDefault();
				updateTabletHeight(tabletHeight + step);
				break;
			}

			case 'ArrowDown': {
				event.preventDefault();
				updateTabletHeight(tabletHeight - step);
				break;
			}

			case 'Home': {
				event.preventDefault();
				updateTabletHeight(TABLET_MIN_HEIGHT);
				break;
			}

			case 'End': {
				event.preventDefault();
				updateTabletHeight(maxTabletHeight());
				break;
			}

			default: {
				break;
			}
		}
	};

	const handleSheetPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		if (
			(event.button !== 0 && event.pointerType === 'mouse') ||
			(event.target instanceof Element && event.target.closest('button'))
		) {
			return;
		}

		event.currentTarget.setPointerCapture(event.pointerId);
		sheetDragRef.current = {startY: event.clientY, startDetent: phoneDetent};
	};

	const handleSheetPointerUp = (event: PointerEvent<HTMLDivElement>) => {
		const active = sheetDragRef.current;
		if (!active) {
			return;
		}

		sheetDragRef.current = null;
		try {
			event.currentTarget.releasePointerCapture(event.pointerId);
		} catch {}

		const delta = active.startY - event.clientY;
		if (delta > 32) {
			setPhoneDetent(active.startDetent === 'collapsed' ? 'half' : 'expanded');
		} else if (delta < -32) {
			setPhoneDetent(active.startDetent === 'expanded' ? 'half' : 'collapsed');
		}
	};

	const handleSheetKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			setPhoneDetent((current) =>
				current === 'collapsed' ? 'half' : 'expanded',
			);
		} else if (event.key === 'ArrowDown') {
			event.preventDefault();
			setPhoneDetent((current) =>
				current === 'expanded' ? 'half' : 'collapsed',
			);
		}
	};

	const horizontalShell = isDesktop || isPhoneLandscape;
	const tabletMax = maxTabletHeight();

	return (
		<div
			data-viewport-class={viewportClass}
			className={cn(
				'flex min-h-0 flex-1 overflow-hidden',
				horizontalShell ? 'flex-row' : 'flex-col',
			)}
		>
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
				data-collapsed={
					(isTablet && tabletCollapsed) ||
					(isPhoneLandscape && !landscapeDrawerOpen)
						? 'true'
						: 'false'
				}
				data-sheet-detent={isPhonePortrait ? phoneDetent : undefined}
				style={
					isTablet
						? {
								height: tabletCollapsed
									? `${TABLET_COLLAPSED_HEIGHT}px`
									: `${tabletHeight}px`,
							}
						: undefined
				}
				className={cn(
					'flex min-h-0 min-w-0 shrink-0 flex-col bg-card',
					isDesktop && 'w-[340px] border-l border-border',
					isTablet && 'w-full border-t border-border',
					isPhonePortrait && 'w-full border-t border-border',
					isPhoneLandscape &&
						(landscapeDrawerOpen
							? 'w-[300px] border-l border-border'
							: 'w-10 border-l border-border'),
				)}
			>
				{isTablet ? (
					<div
						className={cn(
							'flex shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-3',
							tabletCollapsed ? 'h-12 border-b-0' : 'h-7',
						)}
					>
						{tabletCollapsed ? (
							<span className="text-xs font-semibold tracking-[0.05em] text-muted-foreground uppercase">
								Effects
							</span>
						) : (
							<div
								role="slider"
								aria-orientation="vertical"
								aria-label="Resize effects panel"
								aria-valuemin={TABLET_MIN_HEIGHT}
								aria-valuemax={tabletMax}
								aria-valuenow={tabletHeight}
								aria-valuetext={`${tabletHeight} px`}
								tabIndex={0}
								className="flex h-6 flex-1 cursor-row-resize touch-none items-center justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
								onPointerDown={handleTabletSeparatorPointerDown}
								onPointerMove={handleTabletSeparatorPointerMove}
								onPointerUp={handleTabletSeparatorPointerUp}
								onPointerCancel={handleTabletSeparatorPointerUp}
								onKeyDown={handleTabletSeparatorKeyDown}
							>
								<span
									aria-hidden="true"
									className="h-1 w-10 rounded-full bg-input"
								/>
							</div>
						)}
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label={
								tabletCollapsed
									? 'Expand effects panel'
									: 'Collapse effects panel'
							}
							aria-expanded={!tabletCollapsed}
							onClick={toggleTabletCollapsed}
						>
							{tabletCollapsed ? (
								<ChevronUpIcon aria-hidden="true" />
							) : (
								<ChevronDownIcon aria-hidden="true" />
							)}
						</Button>
					</div>
				) : null}

				{isPhoneLandscape ? (
					<div
						className={cn(
							'flex shrink-0 items-center border-b border-border bg-background px-1.5',
							landscapeDrawerOpen
								? 'h-7 justify-between'
								: 'h-full flex-col justify-start border-b-0 py-1.5',
						)}
					>
						{landscapeDrawerOpen ? (
							<span className="px-1 text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
								Effects
							</span>
						) : null}
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label={
								landscapeDrawerOpen
									? 'Collapse effects drawer'
									: 'Expand effects drawer'
							}
							aria-expanded={landscapeDrawerOpen}
							onClick={() => {
								setLandscapeDrawerOpen((open) => !open);
							}}
						>
							{landscapeDrawerOpen ? (
								<PanelRightCloseIcon aria-hidden="true" />
							) : (
								<PanelRightOpenIcon aria-hidden="true" />
							)}
						</Button>
					</div>
				) : null}

				<div
					className={cn(
						'flex min-h-0 min-w-0 flex-1',
						isTablet ? 'flex-row' : 'flex-col',
						((isTablet && tabletCollapsed) ||
							(isPhoneLandscape && !landscapeDrawerOpen)) &&
							'hidden',
					)}
				>
					<EditorSlot
						className={cn(
							isDesktop &&
								'h-auto max-h-[38%] min-h-[72px] w-full shrink-0 border-b border-border',
							isTablet && 'h-full w-[260px] shrink-0 border-r border-border',
							(isPhonePortrait || isPhoneLandscape) &&
								'h-12 w-full shrink-0 border-b border-border',
						)}
						id="stack"
						label="Effect stack"
					/>

					{isPhonePortrait ? (
						<div
							style={{height: phoneSheetHeightStyle(phoneDetent)}}
							className="flex shrink-0 flex-col bg-card pb-[env(safe-area-inset-bottom)] transition-[height] duration-150 motion-reduce:transition-none"
						>
							<div
								className={cn(
									'flex shrink-0 touch-none items-center justify-between gap-2 border-b border-border bg-background px-3',
									phoneDetent === 'collapsed' ? 'h-14 border-b-0' : 'h-7',
								)}
								onPointerDown={handleSheetPointerDown}
								onPointerUp={handleSheetPointerUp}
								onPointerCancel={handleSheetPointerUp}
							>
								<span className="text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
									Parameters
								</span>
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									aria-label={detentButtonLabel(phoneDetent)}
									aria-expanded={phoneDetent !== 'collapsed'}
									onClick={() => {
										setPhoneDetent((current) => nextDetent(current));
									}}
									onKeyDown={handleSheetKeyDown}
								>
									{phoneDetent === 'expanded' ? (
										<ChevronDownIcon aria-hidden="true" />
									) : (
										<ChevronUpIcon aria-hidden="true" />
									)}
								</Button>
							</div>
							<EditorSlot
								className={cn(
									'min-h-0 flex-1',
									phoneDetent === 'collapsed' && 'hidden',
								)}
								id="params"
								label="Parameters"
							/>
						</div>
					) : (
						<EditorSlot
							className="min-h-0 flex-1"
							id="params"
							label="Parameters"
						/>
					)}
				</div>
			</aside>
		</div>
	);
}
