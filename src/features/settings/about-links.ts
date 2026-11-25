export const REPOSITORY_URL = 'https://github.com/bberka/PixelSortGUI';

export type AboutExternalLink = {
	readonly label: string;
	readonly href: string;
	readonly accessibleName: string;
};

export const ABOUT_EXTERNAL_LINKS: readonly AboutExternalLink[] = [
	{
		label: 'Source code',
		href: REPOSITORY_URL,
		accessibleName: 'Source code (opens GitHub)',
	},
	{
		label: 'Report a problem',
		href: `${REPOSITORY_URL}/issues/new`,
		accessibleName: 'Report a problem (opens GitHub)',
	},
	{
		label: 'Licence (MIT)',
		href: `${REPOSITORY_URL}/blob/main/LICENSE`,
		accessibleName: 'Licence (MIT) (opens GitHub)',
	},
	{
		label: 'Releases',
		href: `${REPOSITORY_URL}/releases`,
		accessibleName: 'Releases (opens GitHub)',
	},
];
