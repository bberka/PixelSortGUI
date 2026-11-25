import {useMemo} from 'react';
import {AppBar} from '@/app/app-bar.tsx';
import {LiveRegion} from '@/app/live-region.tsx';
import {NoticeToasts} from '@/app/notices.tsx';
import {
	AppRuntimeProvider,
	useAppStore,
	type AppRuntimeValue,
} from '@/app/runtime-context.tsx';
import {RouteHost, SCREENS, type ScreenRegistry} from '@/app/route-host.tsx';
import {
	SecureContextScreen,
	StartingScreen,
	StartupFailureScreen,
	VersionErrorScreen,
} from '@/app/startup-screens.tsx';
import {
	DatabaseReloadBanner,
	StorageUnavailableBanner,
} from '@/app/storage-banner.tsx';
import {StorageFullDialog} from '@/app/storage-full-dialog.tsx';
import {
	useAppBoot,
	type AppBoot,
	type ReadyRestore,
} from '@/app/use-app-boot.ts';
import {Toaster} from '@/components/ui/sonner';
import {TooltipProvider} from '@/components/ui/tooltip';
import {WindowFileDrop} from '@/features/import/window-file-drop.tsx';
import type {AppRuntime} from '@/state/index.ts';

export type AppProps = {
	readonly runtime: AppRuntime;
	/**
	Test seam: lets a test render the shell with a stand-in screen registry.
	*/
	readonly screens?: ScreenRegistry;
};

export function App({runtime, screens}: AppProps) {
	const boot = useAppBoot(runtime);

	return (
		<TooltipProvider>
			{boot.status === 'ready' ? (
				<BootedApp result={boot.result} runtime={runtime} screens={screens} />
			) : (
				<BootScreen boot={boot} />
			)}
			<Toaster />
		</TooltipProvider>
	);
}

function BootScreen({
	boot,
}: {
	readonly boot: Exclude<AppBoot, {status: 'ready'}>;
}) {
	switch (boot.status) {
		case 'starting': {
			return <StartingScreen />;
		}

		case 'insecure-context': {
			return <SecureContextScreen />;
		}

		case 'version-error': {
			return <VersionErrorScreen message={boot.message} />;
		}

		case 'failed': {
			return <StartupFailureScreen message={boot.message} />;
		}
	}
}

function BootedApp({
	result,
	runtime,
	screens,
}: {
	readonly result: ReadyRestore;
	readonly runtime: AppRuntime;
	readonly screens?: ScreenRegistry;
}) {
	const value = useMemo<AppRuntimeValue>(
		() => ({runtime, bundle: result.bundle}),
		[runtime, result.bundle],
	);

	return (
		<AppRuntimeProvider value={value}>
			<AppFrame screens={screens} />
		</AppRuntimeProvider>
	);
}

function AppFrame({screens}: {readonly screens?: ScreenRegistry}) {
	const route = useAppStore((state) => state.route);
	const {chrome} = (screens ?? SCREENS)[route.screen];

	if (chrome === 'bare') {
		return (
			<div className="min-h-dvh bg-background text-foreground">
				<RouteHost route={route} screens={screens} />
				<LiveRegion />
			</div>
		);
	}

	return (
		<div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
			<AppBar />
			<StorageUnavailableBanner />
			<DatabaseReloadBanner />
			<main className="flex min-h-0 flex-1 flex-col">
				<RouteHost route={route} screens={screens} />
			</main>
			<StorageFullDialog />
			<WindowFileDrop />
			<NoticeToasts />
			<LiveRegion />
		</div>
	);
}
