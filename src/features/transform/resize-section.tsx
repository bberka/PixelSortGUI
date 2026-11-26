import {useId, useState, type SyntheticEvent} from 'react';
import {LockIcon, LockOpenIcon} from 'lucide-react';
import {geometryController} from './geometry-controller.ts';
import {
	convertSize,
	editSize,
	resizeTarget,
	sizeFields,
	type ResizeAxis,
	type ResizeUnit,
	type SizeFields,
} from './resize-fields.ts';
import {GeometrySection} from './section.tsx';
import {
	useAppRuntime,
	useAppStore,
	useTransientStore,
} from '@/app/runtime-context.tsx';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import type {ResizeFilter} from '@/engine/transform.ts';
import {
	cropDraftKey,
	draftCrop,
	projectTransform,
	sameCrop,
	savedCrop,
} from '@/state/geometry.ts';

const FILTERS: ReadonlyArray<{value: ResizeFilter; label: string}> = [
	{value: 'lanczos3', label: 'Lanczos-3'},
	{value: 'bilinear', label: 'Bilinear'},
	{value: 'nearest', label: 'Nearest'},
];

const AXES: ReadonlyArray<{axis: ResizeAxis; label: string}> = [
	{axis: 'width', label: 'Width'},
	{axis: 'height', label: 'Height'},
];

type Edit = {
	// The saved geometry the fields were edited over; a change resets them.
	readonly key: string;
	readonly fields: SizeFields;
	readonly filter: ResizeFilter;
};

export function ResizeSection() {
	const {bundle} = useAppRuntime();
	const project = useAppStore((state) => state.activeProject);
	const cropUnsaved = useTransientStore(
		({geometry}) =>
			geometry.cropping &&
			project !== null &&
			!sameCrop(draftCrop(project, geometry.draft), savedCrop(project)),
	);
	const [unit, setUnit] = useState<ResizeUnit>('px');
	const [locked, setLocked] = useState(true);
	const [edit, setEdit] = useState<Edit | null>(null);
	const id = useId();

	if (!project) {
		return null;
	}

	const transform = projectTransform(project);
	const key = cropDraftKey(project.id, transform);
	const {width, height} = savedCrop(project);
	const cropped = {width, height};
	const {fields, filter} =
		edit?.key === key
			? edit
			: {
					fields: sizeFields(cropped, transform.resize, unit),
					filter: transform.resize?.filter ?? ('lanczos3' as const),
				};
	const target = resizeTarget(fields, unit, cropped, transform.resize);
	const errorId = `${id}-error`;
	const noteId = `${id}-note`;
	const unitLabel = unit === 'px' ? 'px' : '%';

	const submit = (event: SyntheticEvent) => {
		event.preventDefault();
		if (!cropUnsaved && target.output) {
			void geometryController(bundle).applyResize({...target.output, filter});
		}
	};

	return (
		<GeometrySection title="Resize">
			<form noValidate className="flex flex-col gap-2" onSubmit={submit}>
				{cropUnsaved ? (
					<p id={noteId} className="text-xs leading-4 text-muted-foreground">
						Apply or cancel the crop first.
					</p>
				) : null}
				<div className="flex items-center justify-between gap-2">
					<span className="text-xs leading-4 text-muted-foreground">
						From {cropped.width} × {cropped.height} px
					</span>
					<ToggleGroup
						type="single"
						variant="outline"
						size="sm"
						aria-label="Resize unit"
						value={unit}
						disabled={cropUnsaved}
						onValueChange={(next) => {
							if (next !== 'px' && next !== 'percent') {
								return;
							}

							setEdit({
								key,
								filter,
								fields: convertSize(
									fields,
									unit,
									next,
									cropped,
									transform.resize,
								),
							});
							setUnit(next);
						}}
					>
						<ToggleGroupItem
							value="px"
							aria-label="Pixels"
							className="[@media(pointer:coarse)]:min-w-11"
						>
							px
						</ToggleGroupItem>
						<ToggleGroupItem
							value="percent"
							aria-label="Percent"
							className="[@media(pointer:coarse)]:min-w-11"
						>
							%
						</ToggleGroupItem>
					</ToggleGroup>
				</div>
				<div className="flex items-end gap-2">
					{AXES.map(({axis, label}) => (
						<div key={axis} className="flex min-w-0 flex-1 flex-col gap-1">
							<Label htmlFor={`${id}-${axis}`}>
								{label} ({unitLabel})
							</Label>
							<Input
								id={`${id}-${axis}`}
								inputMode={unit === 'px' ? 'numeric' : 'decimal'}
								autoComplete="off"
								className="h-8 font-mono text-[13px] tabular-nums [@media(pointer:coarse)]:h-11"
								disabled={cropUnsaved}
								value={fields[axis]}
								aria-invalid={target.invalid?.includes(axis) ?? false}
								aria-describedby={target.output ? undefined : errorId}
								onChange={(event) => {
									setEdit({
										key,
										filter,
										fields: editSize(fields, axis, event.target.value, {
											unit,
											locked,
											cropped,
										}),
									});
								}}
							/>
						</div>
					))}
					<Button
						type="button"
						variant={locked ? 'secondary' : 'ghost'}
						size="icon-sm"
						aria-label="Lock aspect ratio"
						aria-pressed={locked}
						disabled={cropUnsaved}
						onClick={() => {
							setLocked(!locked);
						}}
					>
						{locked ? (
							<LockIcon aria-hidden="true" />
						) : (
							<LockOpenIcon aria-hidden="true" />
						)}
					</Button>
				</div>
				{target.output ? (
					<p
						data-slot="resize-output"
						className="font-mono text-xs leading-4 text-muted-foreground tabular-nums"
					>
						Output {target.output.width} × {target.output.height} px
					</p>
				) : (
					<p
						id={errorId}
						role="alert"
						className="text-xs leading-4 text-destructive"
					>
						{target.error}
					</p>
				)}
				<div className="flex items-center justify-between gap-2">
					<Label htmlFor={`${id}-filter`}>Filter</Label>
					<Select
						value={filter}
						disabled={cropUnsaved}
						onValueChange={(value) => {
							setEdit({key, fields, filter: value as ResizeFilter});
						}}
					>
						<SelectTrigger id={`${id}-filter`} size="sm" className="w-32">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{FILTERS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						type="submit"
						size="sm"
						disabled={cropUnsaved}
						aria-describedby={cropUnsaved ? noteId : undefined}
					>
						Apply resize
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="ml-auto"
						disabled={cropUnsaved}
						onClick={() => {
							setEdit(null);
							void geometryController(bundle).resetResize();
						}}
					>
						Reset resize
					</Button>
				</div>
			</form>
		</GeometrySection>
	);
}
