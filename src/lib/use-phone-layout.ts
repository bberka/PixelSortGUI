import {useEffect, useState} from 'react';

/**
 Matches the phone viewport class from DESIGN.md section 6:
 width < 640 CSS px, or height < 500 CSS px in landscape.
 */
export const PHONE_MEDIA_QUERY = '(max-width: 639px), (max-height: 499px)';
export const PHONE_LANDSCAPE_MEDIA_QUERY = '(max-height: 499px)';
export const TABLET_MEDIA_QUERY =
	'(min-width: 640px) and (max-width: 1023px) and (min-height: 500px)';
export const DESKTOP_MEDIA_QUERY =
	'(min-width: 1024px) and (min-height: 500px)';

export type EditorViewportClass =
	'phone-portrait' | 'phone-landscape' | 'tablet' | 'desktop';

function matchesMedia(query: string): boolean {
	return typeof globalThis.matchMedia === 'function'
		? globalThis.matchMedia(query).matches
		: false;
}

function readViewportClass(): EditorViewportClass {
	if (matchesMedia(PHONE_LANDSCAPE_MEDIA_QUERY)) {
		return 'phone-landscape';
	}

	if (matchesMedia(PHONE_MEDIA_QUERY)) {
		return 'phone-portrait';
	}

	return matchesMedia(TABLET_MEDIA_QUERY) ? 'tablet' : 'desktop';
}

export function usePhoneLayout(): boolean {
	const [isPhone, setIsPhone] = useState(() => matchesMedia(PHONE_MEDIA_QUERY));

	useEffect(() => {
		if (typeof globalThis.matchMedia !== 'function') {
			return;
		}

		const mediaQuery = globalThis.matchMedia(PHONE_MEDIA_QUERY);
		const update = () => {
			setIsPhone(mediaQuery.matches);
		};

		update();
		mediaQuery.addEventListener('change', update);
		return () => {
			mediaQuery.removeEventListener('change', update);
		};
	}, []);

	return isPhone;
}

export function useTabletLayout(): boolean {
	const [isTablet, setIsTablet] = useState(() =>
		matchesMedia(TABLET_MEDIA_QUERY),
	);

	useEffect(() => {
		if (typeof globalThis.matchMedia !== 'function') {
			return;
		}

		const mediaQuery = globalThis.matchMedia(TABLET_MEDIA_QUERY);
		const update = () => {
			setIsTablet(mediaQuery.matches);
		};

		update();
		mediaQuery.addEventListener('change', update);
		return () => {
			mediaQuery.removeEventListener('change', update);
		};
	}, []);

	return isTablet;
}

export function useEditorViewportClass(): EditorViewportClass {
	const [viewportClass, setViewportClass] =
		useState<EditorViewportClass>(readViewportClass);

	useEffect(() => {
		if (typeof globalThis.matchMedia !== 'function') {
			return;
		}

		const queries = [
			globalThis.matchMedia(PHONE_LANDSCAPE_MEDIA_QUERY),
			globalThis.matchMedia(PHONE_MEDIA_QUERY),
			globalThis.matchMedia(TABLET_MEDIA_QUERY),
		];
		const update = () => {
			setViewportClass(readViewportClass());
		};

		update();
		for (const query of queries) {
			query.addEventListener('change', update);
		}

		return () => {
			for (const query of queries) {
				query.removeEventListener('change', update);
			}
		};
	}, []);

	return viewportClass;
}
