import {useEffect, useState} from 'react';

/**
 True once `active` has been true for `delayMs`; false again as soon as it goes
 false, so a short render never shows an indicator.
 */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		if (!active) {
			setVisible(false);
			return undefined;
		}

		const timer = globalThis.setTimeout(() => {
			setVisible(true);
		}, delayMs);
		return () => {
			globalThis.clearTimeout(timer);
		};
	}, [active, delayMs]);
	return visible;
}
