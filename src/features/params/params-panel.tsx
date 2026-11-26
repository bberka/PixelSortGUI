import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {ChevronsDownIcon, EyeOffIcon} from 'lucide-react';
import {FocusedParams} from './focused-params.tsx';
import {controlId} from './ids.ts';
import {BlendControl, MixControl} from './instance-controls.tsx';
import {ParamControl} from './param-control.tsx';
import {useParamsLayout} from './params-layout.ts';
import {RandomizeButton} from './randomize-button.tsx';
import {cryptoRandom, randomizeParams, type RandomSource} from './randomize.ts';
import {isParamVisible} from './visibility.ts';
import {announce} from '@/app/announcer.ts';
import {useAppStore} from '@/app/runtime-context.tsx';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Separator} from '@/components/ui/separator';
import {Switch} from '@/components/ui/switch';
import {effectRegistry} from '@/engine/effects/index.ts';
import {resolveInstance} from '@/engine/params.ts';
import {
	selectEditingSelectedId,
	selectEditingStack,
} from '@/state/split-sides.ts';
import type {
	EffectDefinition,
	EffectInstance,
	EffectRegistry,
	ParamSpec,
	ParamValue,
} from '@/engine/types.ts';

export type ParameterPanelProps = {
	/**
	 Test seam, like `EffectStackPanel`'s: the panel is built from whichever
	 registry it is given, so a test can prove a newly registered effect gets a
	 complete panel without a change here.
	 */
	readonly registry?: EffectRegistry;
	/**
	 Test seam: the random numbers Randomize draws from. Defaults to
	 `crypto.getRandomValues`.
	 */
	readonly random?: RandomSource;
};

type ParamGroup = {
	readonly name: string;
	readonly entries: ReadonlyArray<{key: string; spec: ParamSpec}>;
};

const GROUP_HEADING_CLASS =
	'px-2 pt-2 text-[11px] leading-4 font-semibold tracking-[0.05em] text-muted-foreground uppercase';

function groupSpecs(
	definition: EffectDefinition,
	params: Readonly<Record<string, ParamValue>>,
): ParamGroup[] {
	const groups = new Map<string, Array<{key: string; spec: ParamSpec}>>();
	for (const [key, spec] of Object.entries<ParamSpec>(definition.params)) {
		if (!isParamVisible(spec, params)) {
			continue;
		}

		const entries = groups.get(spec.group) ?? [];
		entries.push({key, spec});
		groups.set(spec.group, entries);
	}

	return [...groups].map(([name, entries]) => ({name, entries}));
}

function noop(): void {}

function Note({children}: {readonly children: ReactNode}) {
	return <p className="px-2 py-3 text-sm text-muted-foreground">{children}</p>;
}

function InstanceHeader({
	definition,
	instance,
	showSelection,
	onShowSelectionChange,
	onResetAll,
	onRandomize,
	onShowOne,
}: {
	readonly definition: EffectDefinition;
	readonly instance: EffectInstance;
	readonly showSelection: boolean;
	readonly onShowSelectionChange: (checked: boolean) => void;
	readonly onResetAll: () => void;
	readonly onRandomize: () => void;
	readonly onShowOne?: () => void;
}) {
	const showSelectionId = controlId(instance.id, 'showSelection');

	return (
		<div className="flex shrink-0 flex-col gap-1 border-b border-border px-2 py-1.5">
			<div className="flex min-h-6 items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-1.5">
					<h2 className="truncate text-sm font-semibold">{definition.label}</h2>
					{instance.enabled ? null : (
						<Badge variant="outline">
							<EyeOffIcon aria-hidden="true" />
							Off
						</Badge>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-0.5">
					<RandomizeButton
						disabled={Object.keys(definition.params).length === 0}
						label={definition.label}
						onRandomize={onRandomize}
					/>
					<Button type="button" variant="ghost" size="xs" onClick={onResetAll}>
						Reset all
					</Button>
					{onShowOne ? (
						<Button
							aria-expanded
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label="Show one control"
							aria-controls="editor-phone-params-panel"
							data-panel-toggle=""
							onClick={onShowOne}
						>
							<ChevronsDownIcon aria-hidden="true" />
						</Button>
					) : null}
				</div>
			</div>
			{definition.debugViews?.includes('selection') ? (
				<div className="flex min-h-6 items-center justify-between gap-2">
					<Label htmlFor={showSelectionId}>Show selection</Label>
					<Switch
						checked={showSelection}
						id={showSelectionId}
						size="sm"
						onCheckedChange={onShowSelectionChange}
					/>
				</div>
			) : null}
		</div>
	);
}

/**
 The parameter panel: every control comes from the selected instance's
 parameter schema, so a new effect needs no UI code (engine.md sections 3 and
 4.6, DESIGN.md section 5.1).
 */
export function ParameterPanel({
	registry = effectRegistry,
	random = cryptoRandom,
}: ParameterPanelProps = {}) {
	const stack = useAppStore(selectEditingStack);
	const selectedInstanceId = useAppStore(selectEditingSelectedId);
	const debugView = useAppStore((state) => state.debugView);
	const setDebugView = useAppStore((state) => state.setDebugView);
	const resetInstance = useAppStore((state) => state.resetInstance);
	const commitInstanceParams = useAppStore(
		(state) => state.commitInstanceParams,
	);

	const {density, onToggleFocus} = useParamsLayout();
	// The control a focused panel shows, remembered per effect type.
	const [activeKeys, setActiveKeys] = useState<
		Readonly<Record<string, string>>
	>({});
	const rootRef = useRef<HTMLDivElement>(null);
	const shownDensityRef = useRef(density);

	// The two panel toggle buttons replace one another; focus follows.
	useEffect(() => {
		if (shownDensityRef.current === density) {
			return;
		}

		shownDensityRef.current = density;
		const focused = globalThis.document.activeElement;
		if (!focused || focused === globalThis.document.body) {
			rootRef.current
				?.querySelector<HTMLElement>('[data-panel-toggle]')
				?.focus({preventScroll: true});
		}
	}, [density]);

	const resolved = useMemo(() => {
		if (!stack || !selectedInstanceId) {
			return null;
		}

		const instance = stack.instances.find(
			(item) => item.id === selectedInstanceId,
		);
		if (!instance) {
			return null;
		}

		const resolution = resolveInstance(instance, registry);
		return {instance, resolution};
	}, [stack, selectedInstanceId, registry]);

	if (!stack) {
		return null;
	}

	if (!resolved) {
		return (
			<div className="flex items-center justify-between gap-2 px-2">
				<Note>No effect selected</Note>
				<RandomizeButton disabled label={null} onRandomize={noop} />
			</div>
		);
	}

	const {instance, resolution} = resolved;
	if (resolution.status !== 'ok') {
		return (
			<Note>{`Unsupported effect (${instance.type} v${instance.version})`}</Note>
		);
	}

	const {definition, params} = resolution;
	const groups = groupSpecs(definition, params);
	const showSelection =
		debugView?.instanceId === instance.id && debugView.view === 'selection';

	const randomize = () => {
		void commitInstanceParams(
			instance.id,
			randomizeParams(definition.params, random),
			`Randomize ${definition.label}`,
		).then(() => {
			announce(`Randomized ${definition.label}`);
		});
	};

	const changeShowSelection = (checked: boolean) => {
		setDebugView(checked ? {instanceId: instance.id, view: 'selection'} : null);
	};

	if (density === 'focused' && onToggleFocus) {
		return (
			<div ref={rootRef} className="flex w-full shrink-0 flex-col">
				<FocusedParams
					activeKey={activeKeys[definition.type]}
					definition={definition}
					entries={groups.flatMap((group) => group.entries)}
					instance={instance}
					params={params}
					showSelection={showSelection}
					onActiveKeyChange={(key) => {
						setActiveKeys((current) => ({
							...current,
							[definition.type]: key,
						}));
					}}
					onRandomize={randomize}
					onShowAll={onToggleFocus}
					onShowSelectionChange={changeShowSelection}
				/>
			</div>
		);
	}

	return (
		<div
			ref={rootRef}
			className="flex h-full min-h-0 w-full flex-col"
			data-slot="parameter-panel"
		>
			<InstanceHeader
				definition={definition}
				instance={instance}
				showSelection={showSelection}
				onRandomize={randomize}
				onResetAll={() => {
					void resetInstance(instance.id);
				}}
				onShowOne={onToggleFocus}
				onShowSelectionChange={changeShowSelection}
			/>
			<ScrollArea className="min-h-0 flex-1">
				<div className="flex flex-col pb-2">
					{groups.map((group) => (
						<ParamGroupSection
							key={group.name}
							group={group}
							instanceId={instance.id}
							params={params}
						/>
					))}
					<Separator className="my-1" />
					<section
						aria-labelledby={controlId(instance.id, 'blendMix', 'heading')}
						className="flex flex-col"
					>
						<h3
							className={GROUP_HEADING_CLASS}
							id={controlId(instance.id, 'blendMix', 'heading')}
						>
							Blend &amp; Mix
						</h3>
						<MixControl instanceId={instance.id} mix={instance.mix} />
						<BlendControl blend={instance.blend} instanceId={instance.id} />
					</section>
				</div>
			</ScrollArea>
		</div>
	);
}

function ParamGroupSection({
	group,
	instanceId,
	params,
}: {
	readonly group: ParamGroup;
	readonly instanceId: string;
	readonly params: Readonly<Record<string, ParamValue>>;
}) {
	const headingId = `${instanceId}-${group.name}-heading`;

	return (
		<>
			<section aria-labelledby={headingId} className="flex flex-col">
				<h3 className={GROUP_HEADING_CLASS} id={headingId}>
					{group.name}
				</h3>
				{group.entries.map(({key, spec}) => (
					<ParamControl
						key={key}
						instanceId={instanceId}
						paramKey={key}
						spec={spec}
						value={params[key]}
					/>
				))}
			</section>
			<Separator className="my-1" />
		</>
	);
}
