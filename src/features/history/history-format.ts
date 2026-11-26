import {formatOpenedDate} from '../library/library-format.ts';

const TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
});

export function formatHistoryTime(createdAt: number, now: number): string {
	const day = formatOpenedDate(createdAt, now);
	return day === 'Today' ? TIME_FORMAT.format(createdAt) : day;
}
