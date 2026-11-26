import {useRef} from 'react';
import {ImageIcon, XIcon} from 'lucide-react';
import type {ImageSpec} from './format.ts';
import {controlId} from './ids.ts';
import {ImageChooser} from './image-chooser.tsx';
import {useImagePick, type ImageTarget} from './image-pick.tsx';
import {ParamRow} from './param-row.tsx';
import {SourcePicture} from './source-picture.tsx';
import {useSourcePreview, type SourcePreview} from './use-source-preview.ts';
import {useAppStore} from '@/app/runtime-context.tsx';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {formatDimensions} from '@/features/library/library-format.ts';

export type ImageControlProps = {
	readonly instanceId: string;
	readonly paramKey: string;
	readonly spec: ImageSpec;
	readonly value: string;
};

function Thumbnail({preview}: {readonly preview: SourcePreview}) {
	const image = preview.status === 'ready' ? preview.image : undefined;

	return (
		<span
			aria-hidden="true"
			className="flex h-9 w-12 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted"
			data-slot="image-thumbnail"
		>
			{image ? (
				<SourcePicture image={image} />
			) : (
				<ImageIcon className="size-4 text-muted-foreground" />
			)}
		</span>
	);
}

/**
 An `image` parameter: the chosen image's thumbnail and size, "Choose image"
 and "Clear" (DESIGN.md section 7.2).
 */
export function ImageControl({
	instanceId,
	paramKey,
	spec,
	value,
}: ImageControlProps) {
	const projectId = useAppStore((state) => state.activeProjectId);
	const revision = useAppStore((state) => state.activeProject?.updatedAt);
	const preview = useSourcePreview(value, revision);
	const {busy, failure, pickFile, choose} = useImagePick();
	const chooseRef = useRef<HTMLButtonElement>(null);
	const labelId = controlId(instanceId, paramKey, 'label');
	const helpId = controlId(instanceId, paramKey, 'help');
	const sizeId = controlId(instanceId, paramKey, 'size');
	const triggerId = controlId(instanceId, paramKey, 'choose');
	const target: ImageTarget = {
		projectId: projectId ?? '',
		instanceId,
		paramKey,
		label: spec.label,
		triggerId,
	};
	const failed =
		failure?.target.projectId === target.projectId &&
		failure.target.instanceId === instanceId &&
		failure.target.paramKey === paramKey;

	return (
		<ParamRow
			help={spec.help}
			helpId={helpId}
			label={spec.label}
			labelId={labelId}
		>
			<div
				role="group"
				aria-labelledby={labelId}
				className="flex flex-col gap-1"
			>
				<div className="flex items-center gap-2">
					<Thumbnail preview={preview} />
					<span
						className="min-w-0 truncate font-mono text-[13px] text-muted-foreground tabular-nums"
						id={sizeId}
					>
						{preview.status === 'none' ? 'No image selected' : null}
						{preview.status === 'ready'
							? formatDimensions(preview.width, preview.height)
							: null}
					</span>
				</div>
				<div className="flex min-w-0 items-center gap-2">
					<ImageChooser
						busy={busy}
						describedBy={sizeId}
						id={triggerId}
						triggerRef={chooseRef}
						value={value}
						onDevice={() => {
							pickFile(target);
						}}
						onLibrary={(sha256) => {
							choose(target, sha256);
						}}
					/>
					{value === '' ? null : (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									aria-label="Clear image"
									className="pointer-coarse:size-11 max-lg:size-11"
									onClick={() => {
										choose(target, '');
										// This button goes away with the image.
										chooseRef.current?.focus();
									}}
								>
									<XIcon aria-hidden="true" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Clear image</TooltipContent>
						</Tooltip>
					)}
					{preview.status === 'missing' ? (
						<span
							className="text-xs leading-4 font-medium text-destructive-text"
							role="status"
						>
							Missing image
						</span>
					) : null}
				</div>
				{failed ? (
					<p className="text-xs leading-4 text-destructive-text" role="alert">
						{failure.message}
					</p>
				) : null}
			</div>
		</ParamRow>
	);
}
