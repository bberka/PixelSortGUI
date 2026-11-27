import {memo, useCallback, useEffect, useRef} from 'react';
import {
	ArchiveIcon,
	CopyIcon,
	EllipsisIcon,
	FolderOpenIcon,
	PencilIcon,
	Trash2Icon,
} from 'lucide-react';
import {Card} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {CardThumbnail} from '@/features/library/card-thumbnail.tsx';
import {
	formatDimensions,
	formatOpenedDate,
	openedDateIso,
} from '@/features/library/library-format.ts';
import type {ProjectRecord} from '@/storage/types.ts';

export type ProjectCardProps = {
	readonly project: ProjectRecord;
	readonly visible: boolean;
	readonly now: number;
	readonly onOpen: (projectId: string) => void;
	readonly onRename: (project: ProjectRecord) => void;
	readonly onDuplicate: (project: ProjectRecord) => void;
	readonly onSaveFile: (project: ProjectRecord) => void;
	readonly onDelete: (project: ProjectRecord) => void;
	readonly onElement: (projectId: string, element: HTMLElement | null) => void;
};

const ProjectCardView = ({
	project,
	visible,
	now,
	onOpen,
	onRename,
	onDuplicate,
	onSaveFile,
	onDelete,
	onElement,
}: ProjectCardProps) => {
	const listItemRef = useRef<HTMLLIElement | null>(null);
	const {id} = project;

	useEffect(() => {
		onElement(id, listItemRef.current);
		return () => {
			onElement(id, null);
		};
	}, [id, onElement]);

	const open = useCallback(() => {
		onOpen(id);
	}, [id, onOpen]);

	return (
		<li ref={listItemRef} className="min-w-0">
			<Card className="relative gap-0 overflow-hidden py-0">
				<button
					type="button"
					aria-label={`Open ${project.name}`}
					data-open-project={id}
					className="block w-full cursor-pointer text-left focus-visible:-outline-offset-2"
					onClick={open}
				>
					<span className="relative block aspect-[4/3] w-full overflow-hidden border-b border-border bg-muted">
						<CardThumbnail projectId={id} visible={visible} />
					</span>
					<span className="block truncate px-2.5 pt-2 text-sm leading-5 font-medium">
						{project.name}
					</span>
				</button>
				<div className="flex items-center justify-between gap-1 px-2.5 pt-0.5 pb-1.5">
					<div className="min-w-0">
						<span className="block text-xs leading-4 text-muted-foreground">
							{formatDimensions(
								project.effectiveWidth,
								project.effectiveHeight,
							)}
						</span>
						<time
							className="block text-xs leading-4 text-muted-foreground"
							dateTime={openedDateIso(project.openedAt)}
						>
							{formatOpenedDate(project.openedAt, now)}
						</time>
					</div>
					<DropdownMenu>
						<Tooltip>
							<TooltipTrigger asChild>
								<DropdownMenuTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										className="max-lg:size-11"
										aria-label={`Actions for ${project.name}`}
										data-slot="project-actions"
									>
										<EllipsisIcon aria-hidden="true" />
									</Button>
								</DropdownMenuTrigger>
							</TooltipTrigger>
							<TooltipContent>Project actions</TooltipContent>
						</Tooltip>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onSelect={open}>
								<FolderOpenIcon aria-hidden="true" />
								Open
							</DropdownMenuItem>
							<DropdownMenuItem
								onSelect={() => {
									onRename(project);
								}}
							>
								<PencilIcon aria-hidden="true" />
								Rename
							</DropdownMenuItem>
							<DropdownMenuItem
								onSelect={() => {
									onDuplicate(project);
								}}
							>
								<CopyIcon aria-hidden="true" />
								Duplicate
							</DropdownMenuItem>
							<DropdownMenuItem
								onSelect={() => {
									onSaveFile(project);
								}}
							>
								<ArchiveIcon aria-hidden="true" />
								Save project file
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								variant="destructive"
								onSelect={() => {
									onDelete(project);
								}}
							>
								<Trash2Icon aria-hidden="true" />
								Delete
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</Card>
		</li>
	);
};

export const ProjectCard = memo(ProjectCardView);
