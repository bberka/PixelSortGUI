import {useEffect} from 'react';
import {toast} from 'sonner';
import {useAppStore} from './runtime-context.tsx';

/**
 One polite notice channel for the shell: the store sets `notice` (a missing
 project at startup, for example) and the shell shows it once as a toast.
 */
export function NoticeToasts() {
	const notice = useAppStore((state) => state.notice);
	const clearNotice = useAppStore((state) => state.clearNotice);

	useEffect(() => {
		if (!notice) {
			return;
		}

		toast(notice);
		clearNotice();
	}, [notice, clearNotice]);

	return null;
}
