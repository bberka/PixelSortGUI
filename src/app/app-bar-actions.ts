import type {ComponentType} from 'react';
import {ImportImagesAction} from '@/features/import';
import {SettingsButton} from '@/features/settings/settings-button.tsx';
import type {AppRoute} from '@/state/router.ts';

/**
 Buttons the app bar shows next to the theme toggle. A later task adds its
 action by importing its component at the top of this file and appending one
 entry below; the app bar renders the entries whose `screen` matches the
 current route, in list order. Actions must fit the 48/52 px bar and must be
 icon-sized on phone widths.
 */
export type AppBarAction = {
	readonly id: string;
	readonly screen: AppRoute['screen'];
	readonly component: ComponentType;
};

export const APP_BAR_ACTIONS: readonly AppBarAction[] = [
	{id: 'import-images', screen: 'library', component: ImportImagesAction},
	{id: 'settings-library', screen: 'library', component: SettingsButton},
	{id: 'settings-editor', screen: 'editor', component: SettingsButton},
];
