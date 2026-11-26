import {useEffect, useId, useRef} from 'react';
import {ASPECT_LABELS} from './crop-math.ts';
import {geometryController} from './geometry-controller.ts';
import {GeometrySection} from './section.tsx';
import {
	useAppRuntime,
	useAppStore,
	useTransientStore,
} from '@/app/runtime-context.tsx';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import {normalizeCrop, type CropRect} from '@/engine/transform.ts';
import {ExactEntry} from '@/features/params/exact-entry.tsx';
import {parseNumericText} from '@/features/params/format.ts';
import {
	ASPECT_IDS,
	draftCrop,
	projectOrientedDimensions,
	projectTransform,
	sameCrop,
	savedCrop,
	type AspectId,
} from '@/state/geometry.ts';
import {usePhoneLayout} from '@/lib/use-phone-layout.ts';

const FIELDS: ReadonlyArray<{key: keyof CropRect; label: string}> = [
	{key: 'x', label: 'X'},
	{key: 'y', label: 'Y'},
	{key: 'width', label: 'Width'},
	{key: 'height', label: 'Height'},
];

export function CropSection() {
	const {bundle} = useAppRuntime();
	const project = useAppStore((state) => state.activeProject);
	const cropping = useTransientStore((state) => state.geometry.cropping);
	const aspect = useTransientStore((state) => state.geometry.aspect);
	const draft = useTransientStore((state) => state.geometry.draft);
	const id = useId();
	// Short panels: the crop buttons go above the fields so they stay in view.
	const actionsFirst = usePhoneLayout();
	const primaryRef = useRef<HTMLButtonElement | null>(null);
	const wasCroppingRef = useRef(cropping);

	// Apply, Cancel and Edit replace one another; focus follows to the button
	// that took the removed one's place.
	useEffect(() => {
		if (wasCroppingRef.current === cropping) {
			return;
		}

		wasCroppingRef.current = cropping;
		const focused = globalThis.document.activeElement;
		if (!focused || focused === globalThis.document.body) {
			primaryRef.current?.focus({preventScroll: true});
		}
	}, [cropping]);

	if (!project) {
		return null;
	}

	const controller = geometryController(bundle);
	const crop = cropping ? draftCrop(project, draft) : savedCrop(project);
	const saved = savedCrop(project);
	const dropsResize =
		cropping &&
		projectTransform(project).resize !== null &&
		(crop.width !== saved.width || crop.height !== saved.height);

	const commitField = (key: keyof CropRect, value: number) => {
		const next = normalizeCrop(
			{...crop, [key]: value},
			projectOrientedDimensions(project),
		);
		if (sameCrop(next, crop)) {
			return;
		}

		// A typed size no longer follows a locked ratio.
		const typedSize = key === 'width' || key === 'height';
		controller.setBox(next, typedSize ? 'free' : undefined);
	};

	const actions = (
		<div className="flex flex-wrap items-center gap-2">
			{cropping ? (
				<>
					<Button
						key="apply"
						ref={primaryRef}
						type="button"
						size="sm"
						onClick={() => {
							void controller.applyCrop();
						}}
					>
						Apply crop
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => {
							controller.cancelCrop();
						}}
					>
						Cancel
					</Button>
				</>
			) : (
				<Button
					key="edit"
					ref={primaryRef}
					type="button"
					variant="outline"
					size="sm"
					onClick={() => {
						controller.startCrop();
					}}
				>
					Edit crop
				</Button>
			)}
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="ml-auto"
				onClick={() => {
					void controller.resetCrop();
				}}
			>
				Reset crop
			</Button>
		</div>
	);

	return (
		<GeometrySection title="Crop">
			<div className="flex items-center justify-between gap-2">
				<Label htmlFor={`${id}-aspect`}>Aspect ratio</Label>
				<Select
					value={aspect}
					onValueChange={(value) => {
						controller.chooseAspect(value as AspectId);
					}}
				>
					<SelectTrigger id={`${id}-aspect`} size="sm" className="w-32">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{ASPECT_IDS.map((option) => (
							<SelectItem key={option} value={option}>
								{ASPECT_LABELS[option]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{actionsFirst ? actions : null}
			<div className="grid grid-cols-2 gap-x-3 gap-y-2">
				{FIELDS.map(({key, label}) => (
					<div key={key} className="flex min-w-0 items-center gap-2">
						<Label htmlFor={`${id}-${key}`} className="w-11 shrink-0">
							{label}
						</Label>
						<ExactEntry
							className="min-w-0 flex-1 [@media(pointer:coarse)]:h-11"
							format={String}
							id={`${id}-${key}`}
							inputMode="numeric"
							parse={parseNumericText}
							value={crop[key]}
							onCommit={(value) => {
								commitField(key, value);
							}}
						/>
					</div>
				))}
			</div>
			{dropsResize ? (
				<p className="text-xs leading-4 text-muted-foreground">
					Applying this crop removes the resize.
				</p>
			) : null}
			{actionsFirst ? null : actions}
		</GeometrySection>
	);
}
