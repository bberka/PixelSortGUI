import {useEffect, useId, useRef, useState, type RefObject} from 'react';
import {ArrowLeftIcon, ImageIcon, ImagesIcon, UploadIcon} from 'lucide-react';
import {SourcePicture} from './source-picture.tsx';
import {useSourcePreview} from './use-source-preview.ts';
import {useAppRuntime, useAppStore} from '@/app/runtime-context.tsx';
import {Button} from '@/components/ui/button';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {ScrollArea} from '@/components/ui/scroll-area';
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from '@/components/ui/sheet';
import {CardThumbnail} from '@/features/library/card-thumbnail.tsx';
import {formatDimensions} from '@/features/library/library-format.ts';
import {useEditorViewportClass} from '@/lib/use-phone-layout.ts';
import {cn} from '@/lib/utils';

// 44 px on a coarse pointer and on the phone and tablet widths (DESIGN.md
// section 4).
export const IMAGE_BUTTON_CLASS = 'pointer-coarse:h-11 max-lg:h-11';

export type ImageChooserProps = {
	// Of the "Choose image" button.
	readonly id: string;
	// The current value of the parameter.
	readonly value: string;
	readonly busy: boolean;
	readonly describedBy?: string;
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
	readonly onDevice: () => void;
	readonly onLibrary: (sha256: string) => void;
};

type View = 'sources' | 'library';

// The project's library thumbnail. A project never opened has none yet, so its
// photo stands in.
function TilePicture({
	projectId,
	sourceHash,
}: {
	readonly projectId: string;
	readonly sourceHash: string;
}) {
	const {repository} = useAppRuntime().bundle;
	const [bare, setBare] = useState(false);
	const preview = useSourcePreview(bare ? sourceHash : '', undefined);

	useEffect(() => {
		let cancelled = false;
		void repository
			.getThumbnail(projectId)
			.then((thumbnail) => {
				if (!cancelled) {
					setBare(!thumbnail);
				}
			})
			.catch(() => {});

		return () => {
			cancelled = true;
		};
	}, [projectId, repository]);

	return (
		<span
			aria-hidden="true"
			className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-sm bg-muted"
		>
			{preview.status === 'ready' && preview.image ? (
				<SourcePicture image={preview.image} />
			) : (
				<ImageIcon className="size-5 text-muted-foreground" />
			)}
			<CardThumbnail visible projectId={projectId} />
		</span>
	);
}

function LibraryGrid({
	value,
	onChoose,
}: {
	readonly value: string;
	readonly onChoose: (sha256: string) => void;
}) {
	const projects = useAppStore((state) => state.projects);
	const activeId = useAppStore((state) => state.activeProjectId);
	const others = projects.filter((project) => project.id !== activeId);

	if (others.length === 0) {
		return (
			<p className="py-2 text-sm text-muted-foreground">
				No other projects yet.
			</p>
		);
	}

	return (
		<ScrollArea
			tabStop={false}
			className="flex max-h-[min(20rem,40dvh)] min-h-0 flex-col"
		>
			{/* The padding keeps a tile's focus ring inside the scroll area. */}
			<ul aria-label="Library images" className="grid grid-cols-3 gap-2 p-1">
				{others.map((project) => {
					const size = formatDimensions(
						project.sourceWidth,
						project.sourceHeight,
					);
					const chosen = project.sourceHash === value;
					return (
						<li key={project.id} className="min-w-0">
							<button
								type="button"
								aria-pressed={chosen}
								className={cn(
									'flex w-full flex-col overflow-hidden rounded-md border-2 border-transparent text-left hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
									chosen && 'border-accent',
								)}
								onClick={() => {
									onChoose(project.sourceHash);
								}}
							>
								<TilePicture
									projectId={project.id}
									sourceHash={project.sourceHash}
								/>
								<span className="block w-full truncate px-0.5 pt-1 text-xs leading-4 font-medium">
									{project.name}
								</span>
								<span className="block w-full truncate px-0.5 text-[11px] leading-4 text-muted-foreground">
									{size}
								</span>
							</button>
						</li>
					);
				})}
			</ul>
		</ScrollArea>
	);
}

function ChooserBody({
	value,
	onDevice,
	onLibrary,
}: Pick<ImageChooserProps, 'value' | 'onDevice' | 'onLibrary'>) {
	const [view, setView] = useState<View>('sources');
	const bodyRef = useRef<HTMLDivElement>(null);
	const shownRef = useRef(view);

	// The button that changed the view is gone, so focus follows.
	useEffect(() => {
		if (shownRef.current === view) {
			return;
		}

		shownRef.current = view;
		// In the library: the current image's tile, else the first, else "Back".
		const selectors =
			view === 'library'
				? ['[aria-pressed="true"]', 'li button', 'button']
				: ['[data-source="library"]'];
		for (const selector of selectors) {
			const found = bodyRef.current?.querySelector<HTMLElement>(selector);
			if (found) {
				found.focus();
				return;
			}
		}
	}, [view]);

	return (
		<div ref={bodyRef} className="flex min-h-0 flex-col gap-2">
			{view === 'sources' ? (
				<>
					<Button
						type="button"
						variant="outline"
						className={cn('justify-start', IMAGE_BUTTON_CLASS)}
						onClick={onDevice}
					>
						<UploadIcon aria-hidden="true" />
						From device
					</Button>
					<Button
						type="button"
						variant="outline"
						className={cn('justify-start', IMAGE_BUTTON_CLASS)}
						data-source="library"
						onClick={() => {
							setView('library');
						}}
					>
						<ImagesIcon aria-hidden="true" />
						From library
					</Button>
				</>
			) : (
				<>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className={cn('self-start', IMAGE_BUTTON_CLASS)}
						onClick={() => {
							setView('sources');
						}}
					>
						<ArrowLeftIcon aria-hidden="true" />
						Back
					</Button>
					<p className="text-xs leading-4 text-muted-foreground">
						Uses the original photo, without that project&apos;s effects.
					</p>
					<LibraryGrid value={value} onChoose={onLibrary} />
				</>
			)}
		</div>
	);
}

/**
 The "Choose image" button and its two sources: a popover, or a sheet on a
 phone (DESIGN.md section 7.2).
 */
export function ImageChooser({
	id,
	value,
	busy,
	describedBy,
	triggerRef,
	onDevice,
	onLibrary,
}: ImageChooserProps) {
	const viewportClass = useEditorViewportClass();
	const phone = viewportClass.startsWith('phone');
	const [open, setOpen] = useState(false);
	const titleId = useId();

	const changeOpen = (next: boolean) => {
		// Not `disabled`, which would drop the focus while a file is read.
		setOpen(next && !busy);
	};

	const trigger = (
		<Button
			ref={triggerRef}
			id={id}
			type="button"
			variant="outline"
			size="sm"
			aria-describedby={describedBy}
			aria-disabled={busy || undefined}
			className={cn(IMAGE_BUTTON_CLASS, busy && 'opacity-50')}
		>
			Choose image
		</Button>
	);
	const body = (
		<ChooserBody
			value={value}
			onDevice={() => {
				setOpen(false);
				onDevice();
			}}
			onLibrary={(sha256) => {
				setOpen(false);
				onLibrary(sha256);
			}}
		/>
	);

	if (phone) {
		return (
			<Sheet open={open} onOpenChange={changeOpen}>
				<SheetTrigger asChild>{trigger}</SheetTrigger>
				<SheetContent
					side={viewportClass === 'phone-landscape' ? 'right' : 'bottom'}
					aria-describedby={undefined}
					className="max-h-dvh gap-0 pb-[env(safe-area-inset-bottom)] [&>button:last-child]:top-1.5 [&>button:last-child]:right-1.5 [&>button:last-child]:size-11"
				>
					<SheetHeader className="shrink-0 border-b border-border">
						<SheetTitle>Choose image</SheetTitle>
					</SheetHeader>
					<div className="flex min-h-0 flex-col p-4">{body}</div>
				</SheetContent>
			</Sheet>
		);
	}

	return (
		<Popover open={open} onOpenChange={changeOpen}>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
			<PopoverContent
				align="start"
				aria-labelledby={titleId}
				// No height limit of its own: the grid is capped, so the popover keeps
				// its size and Radix moves it to the side with room.
				className="flex w-80 flex-col gap-2 p-3"
			>
				<p
					id={titleId}
					className="text-[11px] leading-4 font-semibold tracking-[0.05em] text-muted-foreground uppercase"
				>
					Choose image
				</p>
				{body}
			</PopoverContent>
		</Popover>
	);
}
