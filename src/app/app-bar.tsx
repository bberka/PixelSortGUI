import {createElement, type ReactNode} from 'react';
import {ArrowLeftIcon} from 'lucide-react';
import {useAppStore} from './runtime-context.tsx';
import {APP_BAR_ACTIONS} from './app-bar-actions.ts';
import {Button} from '@/components/ui/button';
import {formatHashRoute} from '@/state/router.ts';

export function AppBarFrame({children}: {readonly children: ReactNode}) {
	return (
		<header className="flex min-h-[52px] shrink-0 items-center gap-2 border-b border-border bg-background px-3 pt-[env(safe-area-inset-top)] lg:min-h-12 lg:px-6">
			{children}
		</header>
	);
}

export function AppBar() {
	const route = useAppStore((state) => state.route);
	const projectName = useAppStore((state) => state.activeProject?.name ?? null);
	const closeProject = useAppStore((state) => state.closeProject);
	const activeProjectId = useAppStore((state) => state.activeProjectId);
	const isEditor = route.screen === 'editor';
	const isGuide = route.screen === 'guide';
	const actions = APP_BAR_ACTIONS.filter(
		(action) => action.screen === route.screen,
	);

	return (
		<AppBarFrame>
			{isEditor ? (
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label="Back to library"
					onClick={() => {
						void closeProject();
					}}
				>
					<ArrowLeftIcon aria-hidden="true" />
				</Button>
			) : null}
			{isGuide ? (
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label={activeProjectId ? 'Back to editor' : 'Back to library'}
					onClick={() => {
						globalThis.location.hash = formatHashRoute(
							activeProjectId
								? {screen: 'editor', projectId: activeProjectId}
								: {screen: 'library'},
						);
					}}
				>
					<ArrowLeftIcon aria-hidden="true" />
				</Button>
			) : null}
			<div className="flex min-w-0 items-center gap-2">
				<h1 className="shrink-0 text-lg leading-6 font-semibold">Drift</h1>
				{isEditor && projectName ? (
					<span className="max-sm:hidden min-w-0 truncate text-sm text-muted-foreground">
						{projectName}
					</span>
				) : null}
			</div>
			<div className="ml-auto flex shrink-0 items-center gap-1.5">
				{actions.map((action) =>
					createElement(action.component, {key: action.id}),
				)}
			</div>
		</AppBarFrame>
	);
}
