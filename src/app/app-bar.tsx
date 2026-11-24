import {createElement, type ReactNode} from 'react';
import {ArrowLeftIcon} from 'lucide-react';
import {useAppStore} from './runtime-context.tsx';
import {APP_BAR_ACTIONS} from './app-bar-actions.ts';
import {ThemeToggle} from '@/components/theme-toggle';
import {Button} from '@/components/ui/button';

export function AppBarFrame({children}: {readonly children: ReactNode}) {
	return (
		<header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border bg-background px-3 lg:h-12 lg:px-6">
			{children}
		</header>
	);
}

export function AppBar() {
	const route = useAppStore((state) => state.route);
	const projectName = useAppStore((state) => state.activeProject?.name ?? null);
	const closeProject = useAppStore((state) => state.closeProject);
	const setTheme = useAppStore((state) => state.setTheme);
	const isEditor = route.screen === 'editor';
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
			<div className="flex min-w-0 items-center gap-2">
				<h1 className="shrink-0 text-lg leading-6 font-semibold">
					PixelSortGUI
				</h1>
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
				<ThemeToggle
					onSelect={(theme) => {
						void setTheme(theme);
					}}
				/>
			</div>
		</AppBarFrame>
	);
}
