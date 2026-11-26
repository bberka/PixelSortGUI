import {describe, expect, it} from 'vite-plus/test';
import {formatHistoryTime} from './history-format.ts';

const now = new Date(2026, 10, 26, 18, 0).getTime();

describe('formatHistoryTime', () => {
	it('shows the clock time for an entry made today', () => {
		expect(formatHistoryTime(new Date(2026, 10, 26, 0, 5).getTime(), now)).toBe(
			'00:05',
		);
	});

	it('shows the day for an older entry', () => {
		expect(
			formatHistoryTime(new Date(2026, 10, 25, 23, 59).getTime(), now),
		).toBe('Yesterday');
		expect(formatHistoryTime(new Date(2026, 10, 1).getTime(), now)).toBe(
			'Nov 1',
		);
	});
});
