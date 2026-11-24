import {useEffect, useState} from 'react';

const PHONE_MEDIA_QUERY = '(max-width: 639px)';

function queryMatches(): boolean {
	return typeof globalThis.matchMedia === 'function'
		? globalThis.matchMedia(PHONE_MEDIA_QUERY).matches
		: false;
}

/**
 The add-effect picker is a `Popover` on tablet and desktop and a `Dialog` on
 phone (DESIGN.md section 5.3), so the component needs the viewport class in
 JavaScript and not only in CSS.
 */
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
