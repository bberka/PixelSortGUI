import {useStore} from 'zustand';
import {createStore} from 'zustand/vanilla';

export type Announcement = {
	readonly message: string;
	readonly revision: number;
};

const announcementStore = createStore<Announcement>(() => ({
	message: '',
	revision: 0,
}));

/**
 Speaks a short message through the shell's polite live region
 (`role="status"`), for features that finish something the user cannot see:
 renders, exports, undo and redo. Announce state transitions, not every drag
 frame, so assistive technology is not flooded.
 */
export function announce(message: string): void {
	const trimmed = message.trim();
	if (trimmed.length === 0) {
		return;
	}

	announcementStore.setState((state) => ({
		message: trimmed,
		revision: state.revision + 1,
	}));
}

export function useAnnouncement(): Announcement {
	return useStore(announcementStore);
}
