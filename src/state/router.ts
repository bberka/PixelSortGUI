export type AppRoute =
	| {screen: 'library'}
	| {screen: 'editor'; projectId: string}
	| {screen: 'guide'}
	| {screen: 'gallery'};

export type HashRouterEnv = {
	getHash(): string;
	setHash(hash: string): void;
	replaceHash(hash: string): void;
	addHashChangeListener(listener: () => void): () => void;
};

export const DEV_GALLERY_HASH = '#/dev/gallery';

export function parseHashRoute(rawHash: string): AppRoute {
	const trimmed = rawHash.trim();
	const withoutHash = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
	const normalized = withoutHash.startsWith('/')
		? withoutHash
		: `/${withoutHash}`;

	if (normalized === '/guide') {
		return {screen: 'guide'};
	}

	if (normalized === '/dev/gallery') {
		return {screen: 'gallery'};
	}

	const projectMatch = /^\/p\/([^#/?]+)$/.exec(normalized);
	if (projectMatch) {
		try {
			const projectId = decodeURIComponent(projectMatch[1]);
			if (projectId.length > 0) {
				return {screen: 'editor', projectId};
			}
		} catch {
			return {screen: 'library'};
		}
	}

	return {screen: 'library'};
}

export function formatHashRoute(route: AppRoute): string {
	switch (route.screen) {
		case 'library': {
			return '#/';
		}

		case 'editor': {
			return `#/p/${encodeURIComponent(route.projectId)}`;
		}

		case 'guide': {
			return '#/guide';
		}

		case 'gallery': {
			return DEV_GALLERY_HASH;
		}
	}
}

export function createBrowserHashRouterEnv(): HashRouterEnv {
	return {
		getHash() {
			return globalThis.location === undefined ? '' : globalThis.location.hash;
		},
		setHash(hash) {
			if (globalThis.location === undefined) {
				return;
			}

			if (globalThis.location.hash !== hash) {
				globalThis.location.hash = hash;
			}
		},
		replaceHash(hash) {
			if (
				globalThis.location === undefined ||
				globalThis.location.hash === hash
			) {
				return;
			}

			if (
				globalThis.history !== undefined &&
				typeof globalThis.history.replaceState === 'function'
			) {
				const url = `${globalThis.location.pathname}${globalThis.location.search}${hash}`;
				globalThis.history.replaceState(globalThis.history.state, '', url);
				return;
			}

			globalThis.location.hash = hash;
		},
		addHashChangeListener(listener) {
			if (typeof globalThis.addEventListener !== 'function') {
				return () => {};
			}

			globalThis.addEventListener('hashchange', listener);
			return () => {
				globalThis.removeEventListener('hashchange', listener);
			};
		},
	};
}
