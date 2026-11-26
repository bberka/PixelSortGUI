import {
	useCallback,
	useEffect,
	useMemo,
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
import {
	useAppRuntime,
	useAppStore,
	useTransientStore,
} from '@/app/runtime-context.tsx';
import {
	ParamsLayoutContext,
	type ParamsLayout,
} from '@/features/params/params-layout.ts';
import {SplitSideSwitcher} from '@/features/stack/split-side-switcher.tsx';
import {Button} from '@/components/ui/button';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {HistoryPanel} from '@/features/history/history-panel.tsx';
import {geometryController} from '@/features/transform/geometry-controller.ts';
import {useEditorViewportClass} from '@/lib/use-phone-layout.ts';
import {cn} from '@/lib/utils';
import {selectEditingStack} from '@/state/split-sides.ts';

const TABLET_PANEL_HEIGHT_KEY = 'drift:tablet-panel-height';
const TABLET_PANEL_COLLAPSED_KEY = 'drift:tablet-panel-collapsed';
const TABLET_DEFAULT_HEIGHT = 360;
const TABLET_MIN_HEIGHT = 240;
const TABLET_COLLAPSED_HEIGHT = 48;
const TABLET_KEY_STEP = 20;
const TABLET_KEY_SHIFT_STEP = 60;

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

type PhoneControls = 'one' | 'all';

// All controls: as tall as leaves the canvas 40% of the screen under the app
// bar, toolbar and effect strip; the split side switcher comes out of it too.
const PHONE_ALL_CONTROLS_HEIGHT =
	'max(160px, calc(60dvh - 160px - var(--split-switcher-height, 0px)))';
const PHONE_DRAG_THRESHOLD = 24;

/**
 The handle above the portrait phone panel: drag up for all controls, down for
 one. The panel's own buttons do the same without a drag.
 */
function PanelHandle({
	onSnap,
}: {
	readonly onSnap: (controls: PhoneControls) => void;
}) {
	const startRef = useRef<number | null>(null);

	return (
		<div
			aria-hidden="true"
			data-slot="panel-handle"
			className="flex h-4 shrink-0 cursor-row-resize touch-none items-center justify-center"
			onPointerDown={(event) => {
				event.currentTarget.setPointerCapture(event.pointerId);
				startRef.current = event.clientY;
			}}
			onPointerUp={(event) => {
				const start = startRef.current;
				startRef.current = null;
				if (start === null) {
					return;
				}

				const delta = start - event.clientY;
				if (Math.abs(delta) > PHONE_DRAG_THRESHOLD) {
					onSnap(delta > 0 ? 'all' : 'one');
				}
			}}
			onPointerCancel={() => {
				startRef.current = null;
			}}
		>
			<span className="h-1 w-10 rounded-full bg-input" />
		</div>
	);
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
	const [phoneControls, setPhoneControls] = useState<PhoneControls>('one');
	const [landscapeDrawerOpen, setLandscapeDrawerOpen] = useState(true);
	const [panelTab, setPanelTab] = useState('stack');
	const {bundle} = useAppRuntime();
	const geometryOpen = useTransientStore((state) => state.geometry.open);
	const [geometryRevealed, setGeometryRevealed] = useState(geometryOpen);
	// Opening the Geometry panel brings it into view.
	if (geometryRevealed !== geometryOpen) {
		setGeometryRevealed(geometryOpen);
		if (geometryOpen) {
			setPanelTab('stack');
			setTabletCollapsed(false);
			setLandscapeDrawerOpen(true);
		}
	}

	// Leaving the editor drops an unsaved crop.
	useEffect(
		() => () => {
			geometryController(bundle).close();
		},
		[bundle],
	);

	// Phones open the history from the toolbar instead.
	const showPanelTabs = isDesktop || isTablet;
	const historyActive = showPanelTabs && panelTab === 'history';

	const dragRef = useRef<{startY: number; startHeight: number} | null>(null);

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

	const stackEmpty = useAppStore(
		(state) => (selectEditingStack(state)?.instances.length ?? 0) === 0,
	);
	const isPhone = isPhonePortrait || isPhoneLandscape;
	// The Geometry panel needs the taller snap point.
	const phoneShowsAll = geometryOpen || phoneControls === 'all';

	const paramsLayout = useMemo<ParamsLayout>(() => {
		if (isDesktop) {
			return {density: 'regular'};
		}

		if (isTablet) {
			return {density: 'compact'};
		}

		return {
			density: phoneControls === 'one' ? 'focused' : 'compact',
			onToggleFocus() {
				setPhoneControls((current) => (current === 'one' ? 'all' : 'one'));
			},
		};
	}, [isDesktop, isTablet, phoneControls]);

	// A phone toolbar sits under the canvas, within thumb reach. Keys keep both
	// slots mounted when a rotation swaps their order.
	const toolbarSlot = (
		<EditorSlot
			key="toolbar"
			className={cn(
				'shrink-0 border-border',
				isPhone ? 'h-13 border-t bg-background' : 'h-10 border-b',
			)}
			id="toolbar"
			label="Canvas toolbar"
		/>
	);
	const canvasSlot = (
		<EditorSlot
			key="canvas"
			className="min-h-0 flex-1 bg-canvas-stage"
			id="canvas"
			label="Canvas"
		/>
	);

	const horizontalShell = isDesktop || isPhoneLandscape;
	const tabletMax = maxTabletHeight();

	return (
		<ParamsLayoutContext value={paramsLayout}>
			<div
				data-viewport-class={viewportClass}
				className={cn(
					'flex min-h-0 flex-1 overflow-hidden',
					horizontalShell ? 'flex-row' : 'flex-col',
				)}
			>
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
					{isPhone ? [canvasSlot, toolbarSlot] : [toolbarSlot, canvasSlot]}
				</div>

				<aside
					aria-label="Effects"
					data-collapsed={
						(isTablet && tabletCollapsed) ||
						(isPhoneLandscape && !landscapeDrawerOpen)
							? 'true'
							: 'false'
					}
					data-controls={
						isPhonePortrait ? (phoneShowsAll ? 'all' : 'one') : undefined
					}
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
						'has-data-[slot=split-side-switcher]:[--split-switcher-height:44px]',
						isDesktop && 'w-[340px] border-l border-border',
						isTablet && 'w-full border-t border-border',
						isPhonePortrait &&
							'w-full border-t border-border pb-[env(safe-area-inset-bottom)]',
						isPhoneLandscape &&
							(landscapeDrawerOpen
								? 'w-[300px] border-l border-border'
								: 'w-11 border-l border-border'),
					)}
				>
					{isTablet ? (
						<div
							className={cn(
								'flex shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-3',
								tabletCollapsed
									? 'h-12 border-b-0'
									: 'h-7 [@media(pointer:coarse)]:min-h-11',
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
									className="flex h-6 flex-1 cursor-row-resize touch-none items-center justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [@media(pointer:coarse)]:min-h-11"
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
								'flex shrink-0 items-center border-b border-border bg-background',
								landscapeDrawerOpen
									? 'h-7 justify-between px-1.5 [@media(pointer:coarse)]:min-h-11'
									: 'h-full flex-col justify-start border-b-0 px-0 py-1.5',
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

					{(isTablet && tabletCollapsed) ||
					(isPhoneLandscape && !landscapeDrawerOpen) ||
					// The desktop history view replaces the stack and parameters.
					(isDesktop && historyActive) ? null : (
						<SplitSideSwitcher />
					)}

					<Tabs
						className={cn(
							'min-h-0 min-w-0 flex-1 gap-0',
							isTablet &&
								'grid grid-cols-[260px_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)]',
							((isTablet && tabletCollapsed) ||
								(isPhoneLandscape && !landscapeDrawerOpen)) &&
								'hidden',
						)}
						value={historyActive ? 'history' : 'stack'}
						onValueChange={(tab) => {
							setPanelTab(tab);
							// The desktop history view hides the crop controls.
							if (isDesktop && tab === 'history') {
								geometryController(bundle).cancelCrop();
							}
						}}
					>
						{showPanelTabs ? (
							<div
								className={cn(
									'flex shrink-0 border-b border-border p-1.5',
									isTablet && 'col-start-1 row-start-1 border-r',
								)}
							>
								{/* Radix leaves the list itself tabbable, which traps Shift+Tab
							    in Firefox, so only the selected tab is a tab stop. */}
								<TabsList
									tabIndex={-1}
									aria-label="Effects views"
									className="w-full group-data-[orientation=horizontal]/tabs:[@media(pointer:coarse)]:h-12"
								>
									<TabsTrigger value="stack" tabIndex={historyActive ? -1 : 0}>
										Stack
									</TabsTrigger>
									<TabsTrigger
										value="history"
										tabIndex={historyActive ? 0 : -1}
									>
										History
									</TabsTrigger>
								</TabsList>
							</div>
						) : null}

						<TabsContent
							forceMount
							value="stack"
							{...(showPanelTabs
								? {tabIndex: -1}
								: {
										role: undefined,
										tabIndex: undefined,
										'aria-labelledby': undefined,
									})}
							className={cn(
								'flex min-h-0 min-w-0 flex-none flex-col',
								isDesktop && 'max-h-[38%] min-h-[72px]',
								isTablet && 'col-start-1 row-start-2',
								historyActive && 'hidden',
							)}
						>
							<EditorSlot
								className={cn(
									'flex-auto border-border',
									isDesktop && 'w-full border-b',
									isTablet && 'w-full border-r',
									(isPhonePortrait || isPhoneLandscape) &&
										'h-13 w-full flex-none border-b',
								)}
								id="stack"
								label="Effect stack"
							/>
						</TabsContent>

						{showPanelTabs ? (
							<TabsContent
								value="history"
								tabIndex={-1}
								className={cn(
									'min-h-0 min-w-0',
									isTablet && 'col-start-1 row-start-2 border-r border-border',
								)}
							>
								<HistoryPanel />
							</TabsContent>
						) : null}

						{isPhone ? (
							// With no effect and no Geometry panel there is nothing to
							// edit, so a portrait canvas takes the room.
							isPhonePortrait && stackEmpty && !geometryOpen ? null : (
								<div
									id="editor-phone-params-panel"
									style={
										isPhonePortrait && phoneShowsAll
											? {height: PHONE_ALL_CONTROLS_HEIGHT}
											: undefined
									}
									className={cn(
										'flex min-h-0 flex-col',
										isPhoneLandscape ? 'flex-1' : 'shrink-0',
										// Handle, parameter row with its border, control area.
										isPhonePortrait && !phoneShowsAll && 'h-[211px]',
									)}
								>
									{isPhoneLandscape || geometryOpen ? null : (
										<PanelHandle onSnap={setPhoneControls} />
									)}
									<EditorSlot
										className="min-h-0 flex-1"
										id="params"
										label="Parameters"
									/>
								</div>
							)
						) : (
							<EditorSlot
								className={cn(
									'min-h-0 flex-1',
									isTablet && 'col-start-2 row-span-2 row-start-1',
									isDesktop && historyActive && 'hidden',
								)}
								id="params"
								label="Parameters"
							/>
						)}
					</Tabs>
				</aside>
			</div>
		</ParamsLayoutContext>
	);
}
