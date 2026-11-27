import {useEffect, useRef} from 'react';
import {ChevronsUpIcon, ScanEyeIcon} from 'lucide-react';
import {BlendControl, MixControl} from './instance-controls.tsx';
import {ParamControl} from './param-control.tsx';
import {RandomizeButton} from './randomize-button.tsx';
import {useAppStore} from '@/app/runtime-context.tsx';
import {maskTabs} from '@/features/masks/mask-tabs.tsx';
import {Button} from '@/components/ui/button';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import type {
	EffectDefinition,
	EffectInstance,
	ParamSpec,
	ParamValue,
} from '@/engine/types.ts';

// Effect parameter keys are identifiers, so these cannot clash with one.
const MIX_TAB = '$mix';
const BLEND_TAB = '$blend';

export type FocusedParamsProps = {
	readonly definition: EffectDefinition;
	readonly instance: EffectInstance;
	readonly params: Readonly<Record<string, ParamValue>>;
	/**
	The parameters whose `visibleWhen` rule holds, in panel order.
	*/
	readonly entries: ReadonlyArray<{key: string; spec: ParamSpec}>;
	readonly activeKey: string | undefined;
	readonly onActiveKeyChange: (key: string) => void;
	readonly showSelection: boolean;
	readonly onShowSelectionChange: (checked: boolean) => void;
	readonly onRandomize: () => void;
	readonly onShowAll: () => void;
};

/**
 One control at a time, picked from a row of parameter names, so a portrait
 phone keeps the photo large and has nothing to scroll while dragging
 (DESIGN.md section 6.4).
 */
export function FocusedParams({
	definition,
	instance,
	params,
	entries,
	activeKey,
	onActiveKeyChange,
	showSelection,
	onShowSelectionChange,
	onRandomize,
	onShowAll,
}: FocusedParamsProps) {
	const showMask = useAppStore((state) => state.maskOverlay.visible);
	const masks = maskTabs(instance, showMask);
	const tabs = [
		...entries.map(({key, spec}) => ({key, label: spec.label})),
		{key: MIX_TAB, label: 'Mix'},
		{key: BLEND_TAB, label: 'Blend'},
		...masks,
	];
	// A parameter that has just been hidden falls back to the first one.
	const active = tabs.find((tab) => tab.key === activeKey)?.key ?? tabs[0].key;
	const listRef = useRef<HTMLDivElement>(null);

	// A tab selected from elsewhere, as "Size" is by the brush, comes into view.
	useEffect(() => {
		listRef.current
			?.querySelector('[data-state="active"]')
			?.scrollIntoView({block: 'nearest', inline: 'nearest'});
	}, [active]);

	return (
		<Tabs
			className="w-full shrink-0 gap-0"
			data-slot="parameter-panel"
			value={active}
			onValueChange={onActiveKeyChange}
		>
			<h2 className="sr-only">{definition.label}</h2>
			<div className="flex shrink-0 items-start gap-0.5 border-b border-border px-1">
				<ScrollArea
					orientation="horizontal"
					tabStop={false}
					className="min-w-0 flex-1"
				>
					{/* Radix leaves the list itself tabbable, which traps Shift+Tab
					    in Firefox, so only the selected tab is a tab stop. */}
					<TabsList
						ref={listRef}
						tabIndex={-1}
						aria-label="Parameters"
						className="w-max items-start gap-1 border-0 bg-transparent p-0 group-data-[orientation=horizontal]/tabs:h-[50px]"
					>
						{tabs.map((tab) => (
							<TabsTrigger
								key={tab.key}
								value={tab.key}
								tabIndex={tab.key === active ? 0 : -1}
								className="h-11 min-w-11 flex-none px-2.5 after:hidden data-[state=active]:border-accent data-[state=active]:bg-secondary"
							>
								{tab.label}
							</TabsTrigger>
						))}
					</TabsList>
				</ScrollArea>
				{definition.debugViews?.includes('selection') ? (
					<Button
						type="button"
						variant={showSelection ? 'default' : 'ghost'}
						size="icon-sm"
						aria-label="Show selection"
						aria-pressed={showSelection}
						onClick={() => {
							onShowSelectionChange(!showSelection);
						}}
					>
						<ScanEyeIcon aria-hidden="true" />
					</Button>
				) : null}
				<RandomizeButton
					className="size-8 [&_svg:not([class*='size-'])]:size-4"
					disabled={entries.length === 0}
					label={definition.label}
					onRandomize={onRandomize}
				/>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label="Show all controls"
					aria-controls="editor-phone-params-panel"
					aria-expanded={false}
					data-panel-toggle=""
					onClick={onShowAll}
				>
					<ChevronsUpIcon aria-hidden="true" />
				</Button>
			</div>
			{/* A fixed height, so switching parameters never resizes the canvas. */}
			<ScrollArea tabStop={false} className="h-36 shrink-0">
				{tabs.map((tab) => (
					<TabsContent key={tab.key} value={tab.key} tabIndex={-1}>
						{tab.key === MIX_TAB ? (
							<MixControl instanceId={instance.id} mix={instance.mix} />
						) : tab.key === BLEND_TAB ? (
							<BlendControl blend={instance.blend} instanceId={instance.id} />
						) : tab.key.startsWith('$') ? (
							masks.find((mask) => mask.key === tab.key)?.content
						) : (
							entries
								.filter((entry) => entry.key === tab.key)
								.map(({key, spec}) => (
									<ParamControl
										key={`${instance.id}-${key}`}
										instanceId={instance.id}
										paramKey={key}
										spec={spec}
										value={params[key]}
									/>
								))
						)}
					</TabsContent>
				))}
			</ScrollArea>
		</Tabs>
	);
}
