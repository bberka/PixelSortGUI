import {
	MAX_PROJECT_NAME_LENGTH,
	type ProjectRecord,
} from '../../storage/types.ts';

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	day: 'numeric',
});

const DATE_WITH_YEAR_FORMAT = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	day: 'numeric',
	year: 'numeric',
});

export const PROJECT_NAME_ERROR = `Enter a name between 1 and ${MAX_PROJECT_NAME_LENGTH} characters.`;

const MINUTE_MS = 60_000;

/**
 Date labels only need day precision, so the grid reads a clock that ticks once
 a minute. Subscribing keeps the card render pure: the value arrives as a
 snapshot instead of being read from the system clock during render.
 */
export function subscribeToMinute(onTick: () => void): () => void {
	const timer = globalThis.setInterval(onTick, MINUTE_MS);
	return () => {
		globalThis.clearInterval(timer);
	};
}

export function currentMinute(): number {
	return Math.floor(Date.now() / MINUTE_MS);
}

/**
 Library default order (product.md F2): most recently opened first. The store
 keeps `projects` in this order; sorting again keeps the grid stable when a
 record arrives from a path that forgot to.
 */
export function orderProjectsByOpenedAt(
	projects: readonly ProjectRecord[],
): ProjectRecord[] {
	return projects.toSorted((a, b) => b.openedAt - a.openedAt);
}

export function formatDimensions(width: number, height: number): string {
	return `${width} × ${height} px`;
}

function isSameDay(date: Date, other: Date): boolean {
	return (
		date.getFullYear() === other.getFullYear() &&
		date.getMonth() === other.getMonth() &&
		date.getDate() === other.getDate()
	);
}

export function formatOpenedDate(openedAt: number, now: number): string {
	const opened = new Date(openedAt);
	const today = new Date(now);
	if (isSameDay(opened, today)) {
		return 'Today';
	}

	const yesterday = new Date(today);
	yesterday.setDate(today.getDate() - 1);
	if (isSameDay(opened, yesterday)) {
		return 'Yesterday';
	}

	return opened.getFullYear() === today.getFullYear()
		? DATE_FORMAT.format(opened)
		: DATE_WITH_YEAR_FORMAT.format(opened);
}

export function openedDateIso(openedAt: number): string {
	return new Date(openedAt).toISOString();
}

export type ProjectNameValidation =
	| {readonly ok: true; readonly name: string}
	| {readonly ok: false; readonly error: string};

/**
 AC-F2.3: 1 to 120 characters after trimming the surrounding spaces.
 */
export function validateProjectNameInput(raw: string): ProjectNameValidation {
	const name = raw.trim();
	return name.length === 0 || name.length > MAX_PROJECT_NAME_LENGTH
		? {ok: false, error: PROJECT_NAME_ERROR}
		: {ok: true, name};
}
