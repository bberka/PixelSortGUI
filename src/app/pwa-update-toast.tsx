import {useEffect, useRef} from 'react';
import {toast} from 'sonner';
import {usePwaStore} from '@/state/pwa.ts';

export const PWA_UPDATE_TOAST_ID = 'psg-pwa-update-ready';

export function PwaUpdateToast() {
	const updateReady = usePwaStore((state) => state.updateReady);
	const shownRef = useRef(false);

	useEffect(() => {
		if (!updateReady) {
			if (shownRef.current) {
				toast.dismiss(PWA_UPDATE_TOAST_ID);
				shownRef.current = false;
			}

			return;
		}

		shownRef.current = true;
		toast('A new version is ready.', {
			id: PWA_UPDATE_TOAST_ID,
			duration: Infinity,
			action: {
				label: 'Reload to update',
				onClick() {
					void usePwaStore.getState().applyUpdate();
				},
			},
			cancel: {
				label: 'Later',
				onClick() {
					usePwaStore.getState().dismissUpdate();
				},
			},
		});
	}, [updateReady]);

	return null;
}
