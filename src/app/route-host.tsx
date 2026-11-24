import {
	lazy,
	Suspense,
	type ComponentType,
	type LazyExoticComponent,
} from 'react';
import {ScreenErrorBoundary} from './error-boundary.tsx';
import {PendingIndicator} from './pending.tsx';
import {EditorScreen} from '@/features/editor/editor-screen.tsx';
import {LibraryScreen} from '@/features/library/library-screen.tsx';
import type {AppRoute} from '@/state/router.ts';

const GalleryScreen = lazy(async () => {
	const module = await import('@/features/gallery/component-gallery.tsx');
	return {default: module.ComponentGallery};
});

export type ScreenComponent =
	ComponentType | LazyExoticComponent<ComponentType>;

export type ScreenDefinition = {
	/**
	 `shell` screens sit under the app bar; dev pages render on their own.
	 */
	readonly chrome: 'shell' | 'bare';
	readonly component: ScreenComponent;
};

/**
 The screen registry. A later task adds a screen by creating its component in
 `src/features/<name>/` and adding one entry here; the route values are the
 union in `src/state/router.ts`.
 */
export type ScreenRegistry = Record<AppRoute['screen'], ScreenDefinition>;

export const SCREENS: ScreenRegistry = {
	library: {chrome: 'shell', component: LibraryScreen},
	editor: {chrome: 'shell', component: EditorScreen},
	gallery: {chrome: 'bare', component: GalleryScreen},
};

function routeKey(route: AppRoute): string {
	return route.screen === 'editor' ? `editor:${route.projectId}` : route.screen;
}

export type RouteHostProps = {
	readonly route: AppRoute;
	/**
	 Test seam: a test renders the host with a throwing screen to cross the
	 boundary.
	 */
	readonly screens?: ScreenRegistry;
};

export function RouteHost({route, screens = SCREENS}: RouteHostProps) {
	const Screen = screens[route.screen].component;

	return (
		<ScreenErrorBoundary key={routeKey(route)}>
			<Suspense fallback={<PendingIndicator label="Loading screen" />}>
				<Screen />
			</Suspense>
		</ScreenErrorBoundary>
	);
}
