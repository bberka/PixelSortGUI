import {useEffect, useState} from 'react';

/**
 Matches the phone viewport class from DESIGN.md section 6:
 width < 640 CSS px, or height < 500 CSS px in landscape.
 */
export const PHONE_MEDIA_QUERY = '(max-width: 639px), (max-height: 499px)';

function queryMatches(): boolean {
	return typeof globalThis.matchMedia === 'function'
		? globalThis.matchMedia(PHONE_MEDIA_QUERY).matches
		: false;
}

export function usePhoneLayout(): boolean {
	const [isPhone, setIsPhone] = useState(queryMatches);

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
