import {
	useCallback,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react';
import {ScrollArea} from '@/components/ui/scroll-area';
import {announce} from '@/app/announcer.ts';
import {useAppStore} from '@/app/runtime-context.tsx';
import {GUIDE_EMPTY_LIBRARY_LINK} from '@/features/guide/content.ts';
import {GUIDE_HASH} from '@/features/guide/navigation.ts';
import {WelcomeCard} from '@/features/guide/welcome-card.tsx';
import {ImportImagesButton} from '@/features/import/import-images-button.tsx';
import {
	DeleteProjectDialog,
	RenameProjectDialog,
} from '@/features/library/card-dialogs.tsx';
import {
	currentMinute,
	orderProjectsByOpenedAt,
	subscribeToMinute,
} from '@/features/library/library-format.ts';
import {ProjectCard} from '@/features/library/project-card.tsx';
import {useVisibleProjects} from '@/features/library/use-visible-projects.ts';
import type {ProjectRecord} from '@/storage/types.ts';

type RenameRequest = {
	readonly project: ProjectRecord;
	readonly seq: number;
};

/**
 The library screen (product.md F2, DESIGN.md section 6.1).
 */
export function LibraryScreen() {
	const projects = useAppStore((state) => state.projects);
	const openProject = useAppStore((state) => state.openProject);
	const renameProject = useAppStore((state) => state.renameProject);
	const duplicateProject = useAppStore((state) => state.duplicateProject);
	const deleteProject = useAppStore((state) => state.deleteProject);
	const welcomeDismissed = useAppStore((state) => state.welcomeDismissed);
	const dismissWelcome = useAppStore((state) => state.dismissWelcome);

	const ordered = useMemo(() => orderProjectsByOpenedAt(projects), [projects]);
	const minute = useSyncExternalStore(subscribeToMinute, currentMinute);
	const {scrollRef, register, isVisible, elementFor} = useVisibleProjects();

	const [renameRequest, setRenameRequest] = useState<RenameRequest | null>(
		null,
	);
	const [pendingDeletion, setPendingDeletion] = useState<ProjectRecord | null>(
		null,
	);
	const renameSeqRef = useRef(0);
	const emptyHeadingRef = useRef<HTMLHeadingElement | null>(null);

	const handleOpen = useCallback(
		(projectId: string) => {
			void openProject(projectId);
		},
		[openProject],
	);

	const handleRename = useCallback((project: ProjectRecord) => {
		renameSeqRef.current += 1;
		setRenameRequest({project, seq: renameSeqRef.current});
	}, []);

	const handleDuplicate = useCallback(
		(project: ProjectRecord) => {
			void duplicateProject(project.id).then((copy) => {
				announce(`Duplicated ${copy.name}`);
			});
		},
		[duplicateProject],
	);

	const handleDelete = useCallback((project: ProjectRecord) => {
		setPendingDeletion(project);
	}, []);

	if (ordered.length === 0) {
		return (
			<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 p-3 sm:p-4 lg:p-6">
				<div className="flex max-w-[36ch] flex-col items-center gap-3 text-center">
					<h2
						ref={emptyHeadingRef}
						tabIndex={-1}
						className="text-lg leading-6 font-semibold"
					>
						No projects yet
					</h2>
					<p className="text-sm text-muted-foreground">
						Images stay on this device.
					</p>
					<ImportImagesButton />
					{welcomeDismissed ? (
						<a
							href={GUIDE_HASH}
							className="inline-flex min-h-6 items-center text-sm font-medium text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11"
						>
							{GUIDE_EMPTY_LIBRARY_LINK}
						</a>
					) : null}
				</div>
				{welcomeDismissed ? null : (
					<WelcomeCard
						onDismiss={() => {
							void dismissWelcome();
							emptyHeadingRef.current?.focus();
						}}
					/>
				)}
			</div>
		);
	}

	const confirmRename = (project: ProjectRecord, name: string) => {
		setRenameRequest(null);
		void renameProject(project.id, name).then((updated) => {
			announce(`Renamed to ${updated.name}`);
		});
	};

	const confirmDelete = async (project: ProjectRecord) => {
		const index = ordered.findIndex((item) => item.id === project.id);
		setPendingDeletion(null);
		await deleteProject(project.id);
		announce(`Deleted ${project.name}`);

		const remaining = ordered.filter((item) => item.id !== project.id);
		const next = remaining[Math.min(Math.max(0, index), remaining.length - 1)];
		// The dialog moves focus when it unmounts, so follow it in a later task.
		globalThis.setTimeout(() => {
			if (next) {
				elementFor(next.id)
					?.querySelector<HTMLButtonElement>('button')
					?.focus();
			} else {
				emptyHeadingRef.current?.focus();
			}
		}, 0);
	};

	return (
		<>
			<ScrollArea
				viewportRef={scrollRef}
				tabStop={false}
				className="min-h-0 flex-1"
				viewportClassName="[&>div]:block!"
			>
				<ul className="grid grid-cols-2 gap-3 p-3 md:grid-cols-3 md:gap-4 md:p-4 lg:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] lg:gap-4 lg:p-6">
					{ordered.map((project) => (
						<ProjectCard
							key={project.id}
							now={minute * 60_000}
							project={project}
							visible={isVisible(project.id)}
							onDelete={handleDelete}
							onDuplicate={handleDuplicate}
							onElement={register}
							onOpen={handleOpen}
							onRename={handleRename}
						/>
					))}
				</ul>
			</ScrollArea>
			<RenameProjectDialog
				key={renameRequest?.seq ?? 0}
				project={renameRequest?.project ?? null}
				onClose={() => {
					setRenameRequest(null);
				}}
				onRename={confirmRename}
			/>
			<DeleteProjectDialog
				project={pendingDeletion}
				onClose={() => {
					setPendingDeletion(null);
				}}
				onConfirm={(project) => {
					void confirmDelete(project);
				}}
			/>
		</>
	);
}
