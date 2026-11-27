// The controls of the "Mask" group (DESIGN.md section 7.4). The full panel
// stacks them; a phone shows one per tab.
import {useEffect, useRef, useState} from 'react';
import {
	BrushIcon,
	ImageIcon,
	SunMediumIcon,
	Trash2Icon,
	VenetianMaskIcon,
} from 'lucide-react';
import {MaskRangeSlider, MaskSlider} from './mask-slider.tsx';
import {useMaskMissing} from './use-mask-missing.ts';
import {announce} from '@/app/announcer.ts';
import {useAppStore, useTransientStore} from '@/app/runtime-context.tsx';
import {Button} from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Switch} from '@/components/ui/switch';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import type {InstanceMask, MaskKind} from '@/engine/mask/types.ts';
import {validateMask} from '@/engine/mask/validate.ts';
import type {EffectInstance} from '@/engine/types.ts';
import {controlId} from '@/features/params/ids.ts';
import {ImageControl} from '@/features/params/image-control.tsx';
import {ParamRow} from '@/features/params/param-row.tsx';
import {
	MIN_OVERLAY_OPACITY,
	DEFAULT_MASK_OVERLAY,
	type MaskPatch,
} from '@/state/mask-edits.ts';
import {BRUSH_LIMITS, DEFAULT_BRUSH_SETTINGS} from '@/state/brush.ts';

const MASK_KINDS: ReadonlyArray<{
	kind: MaskKind;
	label: string;
	icon: typeof BrushIcon;
}> = [
	{kind: 'paint', label: 'Paint', icon: BrushIcon},
	{kind: 'luma', label: 'Brightness', icon: SunMediumIcon},
	{kind: 'image', label: 'Image', icon: ImageIcon},
];

const FITS = [
	{value: 'cover', label: 'Cover'},
	{value: 'contain', label: 'Contain'},
	{value: 'stretch', label: 'Stretch'},
] as const;

// Not an effect parameter key, so its control ids clash with none.
const MASK_IMAGE_KEY = 'mask-image';

type MaskProps<Kind extends MaskKind = MaskKind> = {
	readonly instanceId: string;
	readonly mask: InstanceMask & {kind: Kind};
};

function toPercent(value: number): number {
	return Math.round(value * 1000) / 10;
}

// The drag, commit and arrow key actions of one mask setting.
function useMaskSetting(instanceId: string) {
	const dragMask = useAppStore((state) => state.dragMask);
	const commitMask = useAppStore((state) => state.commitMask);
	const nudgeMask = useAppStore((state) => state.nudgeMask);
	const cancelDrag = useAppStore((state) => state.cancelDrag);
	const dragged = useTransientStore((state) =>
		state.activeDrag?.instanceId === instanceId
			? state.activeDrag.mask
			: undefined,
	);

	return {
		dragged,
		commit(patch: MaskPatch) {
			void commitMask(instanceId, patch);
		},
		handlers<Value>(patch: (value: Value) => MaskPatch) {
			return {
				onCancel: cancelDrag,
				onDrag(value: Value) {
					dragMask(instanceId, patch(value));
				},
				onCommit(value: Value) {
					void commitMask(instanceId, patch(value));
				},
				onNudge(value: Value) {
					nudgeMask(instanceId, patch(value));
				},
			};
		},
	};
}

export function MaskTypeControl({
	instanceId,
	kind: selected,
}: {
	readonly instanceId: string;
	// A kind this version does not know selects no type.
	readonly kind: string;
}) {
	const setMaskKind = useAppStore((state) => state.setMaskKind);
	const id = controlId(instanceId, 'mask', 'type');

	return (
		<ParamRow label="Type" labelId={id}>
			<ToggleGroup
				aria-labelledby={id}
				className="flex w-full flex-wrap"
				data-slot="mask-type"
				size="sm"
				type="single"
				value={selected}
				onValueChange={(next) => {
					const choice = MASK_KINDS.find((item) => item.kind === next);
					if (choice) {
						void setMaskKind(instanceId, choice.kind);
					}
				}}
			>
				{MASK_KINDS.map(({kind, label}) => (
					<ToggleGroupItem key={kind} value={kind}>
						{label}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
		</ParamRow>
	);
}

export function ShowMaskControl({instanceId}: {readonly instanceId: string}) {
	const visible = useAppStore((state) => state.maskOverlay.visible);
	const setMaskOverlay = useAppStore((state) => state.setMaskOverlay);
	const id = controlId(instanceId, 'mask', 'show');

	return (
		<ParamRow
			htmlFor={id}
			inline={
				<Switch
					checked={visible}
					id={id}
					onCheckedChange={(checked) => {
						setMaskOverlay({visible: checked});
					}}
				/>
			}
			label="Show mask"
			labelId={`${id}-label`}
		/>
	);
}

export function OverlayOpacityControl({
	instanceId,
}: {
	readonly instanceId: string;
}) {
	const opacity = useAppStore((state) => state.maskOverlay.opacity);
	const setMaskOverlay = useAppStore((state) => state.setMaskOverlay);
	const set = (value: number) => {
		setMaskOverlay({opacity: value});
	};

	return (
		<MaskSlider
			defaultValue={DEFAULT_MASK_OVERLAY.opacity}
			id={controlId(instanceId, 'mask', 'opacity')}
			label="Overlay opacity"
			max={100}
			min={MIN_OVERLAY_OPACITY}
			unit="%"
			value={opacity}
			onCancel={() => {}}
			onCommit={set}
			onDrag={set}
			onNudge={set}
		/>
	);
}

export function InvertMaskControl({instanceId, mask}: MaskProps) {
	const {commit} = useMaskSetting(instanceId);
	const id = controlId(instanceId, 'mask', 'invert');

	return (
		<ParamRow
			htmlFor={id}
			inline={
				<Switch
					checked={mask.invert}
					id={id}
					onCheckedChange={(invert) => {
						commit({invert});
					}}
				/>
			}
			label="Invert mask"
			labelId={`${id}-label`}
		/>
	);
}

export function MaskFeatherControl({instanceId, mask}: MaskProps) {
	const {dragged, handlers} = useMaskSetting(instanceId);

	return (
		<MaskSlider
			{...handlers((feather: number) => ({feather}))}
			defaultValue={0}
			id={controlId(instanceId, 'mask', 'feather')}
			label="Mask feather"
			max={256}
			min={0}
			unit=" px"
			value={dragged?.feather ?? mask.feather}
		/>
	);
}

// A brush setting: no commit, so a drag and a release store the same thing.
function BrushSlider({
	instanceId,
	setting,
	label,
	unit,
}: {
	readonly instanceId: string;
	readonly setting: keyof typeof BRUSH_LIMITS;
	readonly label: string;
	readonly unit: '%' | ' px';
}) {
	const value = useAppStore((state) => state.brushSettings[setting]);
	const setBrushSettings = useAppStore((state) => state.setBrushSettings);
	const set = (next: number) => {
		setBrushSettings({[setting]: next});
	};

	return (
		<MaskSlider
			{...BRUSH_LIMITS[setting]}
			defaultValue={DEFAULT_BRUSH_SETTINGS[setting]}
			id={controlId(instanceId, 'brush', setting)}
			label={label}
			unit={unit}
			value={value}
			onCancel={() => {}}
			onCommit={set}
			onDrag={set}
			onNudge={set}
		/>
	);
}

function PenPressureControl({instanceId}: {readonly instanceId: string}) {
	const penPressure = useAppStore((state) => state.brushSettings.penPressure);
	const setBrushSettings = useAppStore((state) => state.setBrushSettings);
	const id = controlId(instanceId, 'brush', 'pressure');

	return (
		<ParamRow
			htmlFor={id}
			inline={
				<Switch
					checked={penPressure}
					id={id}
					onCheckedChange={(checked) => {
						setBrushSettings({penPressure: checked});
					}}
				/>
			}
			label="Pen pressure sets size"
			labelId={`${id}-label`}
		/>
	);
}

export function BrushSizeControl({instanceId}: {readonly instanceId: string}) {
	return (
		<BrushSlider
			instanceId={instanceId}
			label="Brush size"
			setting="size"
			unit=" px"
		/>
	);
}

export function BrushHardnessControl({
	instanceId,
}: {
	readonly instanceId: string;
}) {
	return (
		<BrushSlider
			instanceId={instanceId}
			label="Hardness"
			setting="hardness"
			unit="%"
		/>
	);
}

export function BrushStrengthControl({
	instanceId,
}: {
	readonly instanceId: string;
}) {
	return (
		<BrushSlider
			instanceId={instanceId}
			label="Strength"
			setting="strength"
			unit="%"
		/>
	);
}

// The phone's "Size" tab also holds the pen switch.
export function BrushSizeTab({instanceId}: {readonly instanceId: string}) {
	return (
		<>
			<BrushSizeControl instanceId={instanceId} />
			<PenPressureControl instanceId={instanceId} />
		</>
	);
}

// The settings under "Edit with brush" while the brush is on.
function BrushSettingsGroup({instanceId}: {readonly instanceId: string}) {
	const ref = useRef<HTMLDivElement>(null);

	// Turning the brush on brings its settings into view.
	useEffect(() => {
		ref.current?.scrollIntoView({block: 'nearest'});
	}, []);

	return (
		<div ref={ref} data-slot="brush-settings">
			<BrushSizeControl instanceId={instanceId} />
			<BrushHardnessControl instanceId={instanceId} />
			<BrushStrengthControl instanceId={instanceId} />
			<PenPressureControl instanceId={instanceId} />
		</div>
	);
}

export function PaintMaskActions({
	instanceId,
	mask,
	compact,
}: MaskProps<'paint'> & {readonly compact: boolean}) {
	const fillMask = useAppStore((state) => state.fillMask);
	const clearMask = useAppStore((state) => state.clearMask);
	const brushing = useAppStore(
		(state) => state.activeBrush?.instanceId === instanceId,
	);
	const setBrush = useAppStore((state) => state.setBrush);

	return (
		<>
			<div className="flex flex-col gap-1 px-2 py-1.5" data-param-row="">
				<Button
					type="button"
					variant={brushing ? 'default' : 'outline'}
					size="sm"
					aria-pressed={brushing}
					className="w-full pointer-coarse:min-h-11"
					onClick={() => {
						setBrush(brushing ? null : instanceId);
					}}
				>
					<BrushIcon aria-hidden="true" />
					Edit with brush
				</Button>
				<div className="flex gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="flex-1 pointer-coarse:min-h-11"
						onClick={() => {
							void fillMask(instanceId).then(() => {
								announce('Mask filled');
							});
						}}
					>
						Fill
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="flex-1 pointer-coarse:min-h-11"
						onClick={() => {
							void clearMask(instanceId).then(() => {
								announce('Mask cleared');
							});
						}}
					>
						Clear
					</Button>
				</div>
				{mask.asset === '' && !brushing ? (
					<p className="text-xs leading-4 text-muted-foreground">
						Nothing is painted yet.
					</p>
				) : null}
			</div>
			{brushing && !compact ? (
				<BrushSettingsGroup instanceId={instanceId} />
			) : null}
		</>
	);
}

export function MaskRangeControl({instanceId, mask}: MaskProps<'luma'>) {
	const {dragged, handlers} = useMaskSetting(instanceId);
	const [low, high] = dragged?.range ?? mask.range;

	return (
		<MaskRangeSlider
			{...handlers(([from, to]: readonly [number, number]) => ({
				range: [from / 100, to / 100],
			}))}
			defaultValue={[50, 100]}
			id={controlId(instanceId, 'mask', 'range')}
			label="Mask range"
			value={[toPercent(low), toPercent(high)]}
		/>
	);
}

export function MaskSoftnessControl({instanceId, mask}: MaskProps<'luma'>) {
	const {dragged, handlers} = useMaskSetting(instanceId);

	return (
		<MaskSlider
			{...handlers((value: number) => ({softness: value / 100}))}
			defaultValue={10}
			id={controlId(instanceId, 'mask', 'softness')}
			label="Softness"
			max={100}
			min={0}
			unit="%"
			value={toPercent(dragged?.softness ?? mask.softness)}
		/>
	);
}

export function MaskImageControl({instanceId, mask}: MaskProps<'image'>) {
	const commitMaskImage = useAppStore((state) => state.commitMaskImage);

	return (
		<ImageControl
			commit={async (projectId, choice) =>
				commitMaskImage(projectId, instanceId, choice)
			}
			instanceId={instanceId}
			paramKey={MASK_IMAGE_KEY}
			spec={{kind: 'image', label: 'Mask image', group: 'Mask', default: ''}}
			value={mask.source}
		/>
	);
}

export function MaskFitControl({instanceId, mask}: MaskProps<'image'>) {
	const {commit} = useMaskSetting(instanceId);
	const id = controlId(instanceId, 'mask', 'fit');

	return (
		<ParamRow
			label="Fit"
			labelId={id}
			reset={{
				label: 'Fit',
				atDefault: mask.fit === 'cover',
				onReset() {
					commit({fit: 'cover'});
				},
			}}
		>
			<ToggleGroup
				aria-labelledby={id}
				className="flex w-full flex-wrap"
				size="sm"
				type="single"
				value={mask.fit}
				onValueChange={(next) => {
					const fit = FITS.find((item) => item.value === next);
					if (fit) {
						commit({fit: fit.value});
					}
				}}
			>
				{FITS.map(({value, label}) => (
					<ToggleGroupItem key={value} value={value}>
						{label}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
		</ParamRow>
	);
}

/**
 "Add mask" without a mask; otherwise the controls every kind shares, with
 `children` between "Mask feather" and "Remove mask". A phone leaves feather and
 opacity to their own tabs (`compact`).
 */
export function MaskSetup({
	instance,
	compact = false,
}: {
	readonly instance: EffectInstance;
	readonly compact?: boolean;
}) {
	const setMaskKind = useAppStore((state) => state.setMaskKind);
	const visible = useAppStore((state) => state.maskOverlay.visible);
	const missing = useMaskMissing(instance);
	const rootRef = useRef<HTMLDivElement>(null);
	// Where the focus goes once the control that had it is gone.
	const [focusNext, setFocusNext] = useState<'add' | 'type' | null>(null);
	const {id: instanceId} = instance;
	const mask = instance.mask ? validateMask(instance.mask) : undefined;
	const kind = instance.mask?.kind;

	useEffect(() => {
		if (!focusNext || (focusNext === 'add') !== (kind === undefined)) {
			return;
		}

		rootRef.current
			?.querySelector<HTMLElement>(
				focusNext === 'add'
					? '[data-slot="add-mask"]'
					: '[data-slot="mask-type"] [data-state="on"]',
			)
			?.focus();
		setFocusNext(null);
	}, [focusNext, kind]);

	const add = (next: MaskKind) => {
		setFocusNext('type');
		void setMaskKind(instanceId, next).then(() => {
			// A new painted mask turns the brush on.
			announce(next === 'paint' ? 'Mask added. Brush on' : 'Mask added');
		});
	};

	const remove = () => {
		setFocusNext('add');
		void setMaskKind(instanceId, null).then(() => {
			announce('Mask removed');
		});
	};

	return (
		<div ref={rootRef} className="flex flex-col">
			{instance.mask ? (
				<>
					<MaskTypeControl instanceId={instanceId} kind={instance.mask.kind} />
					{missing ? (
						<p
							className="px-2 text-xs leading-4 font-medium text-destructive-text"
							role="status"
						>
							Missing mask
						</p>
					) : null}
					{mask ? (
						<>
							<ShowMaskControl instanceId={instanceId} />
							{visible && !compact ? (
								<OverlayOpacityControl instanceId={instanceId} />
							) : null}
							<InvertMaskControl instanceId={instanceId} mask={mask} />
							{compact ? null : (
								<MaskFeatherControl instanceId={instanceId} mask={mask} />
							)}
							{mask.kind === 'paint' ? (
								<PaintMaskActions
									compact={compact}
									instanceId={instanceId}
									mask={mask}
								/>
							) : null}
							{compact ? null : mask.kind === 'luma' ? (
								<>
									<MaskRangeControl instanceId={instanceId} mask={mask} />
									<MaskSoftnessControl instanceId={instanceId} mask={mask} />
								</>
							) : mask.kind === 'image' ? (
								<>
									<MaskImageControl instanceId={instanceId} mask={mask} />
									<MaskFitControl instanceId={instanceId} mask={mask} />
								</>
							) : null}
						</>
					) : null}
					<div className="px-2 py-1">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="pointer-coarse:min-h-11"
							onClick={remove}
						>
							<Trash2Icon aria-hidden="true" />
							Remove mask
						</Button>
					</div>
				</>
			) : (
				<div className="px-2 py-1.5">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="w-full pointer-coarse:min-h-11"
								data-slot="add-mask"
							>
								<VenetianMaskIcon aria-hidden="true" />
								Add mask
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="start"
							onCloseAutoFocus={(event) => {
								// The button is replaced by the new mask's controls.
								if (focusNext) {
									event.preventDefault();
								}
							}}
						>
							{MASK_KINDS.map(({kind: choice, label, icon: Icon}) => (
								<DropdownMenuItem
									key={choice}
									onSelect={() => {
										add(choice);
									}}
								>
									<Icon aria-hidden="true" />
									{label}
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			)}
		</div>
	);
}
