import {useAnnouncement} from './announcer.ts';

export function LiveRegion() {
	const {message, revision} = useAnnouncement();

	return (
		<div
			role="status"
			aria-live="polite"
			aria-atomic="true"
			aria-label="Status messages"
			className="sr-only"
		>
			{message === '' ? null : <span key={revision}>{message}</span>}
		</div>
	);
}
