import {describe, expect, it} from 'vite-plus/test';
import {
	formatDimensions,
	formatOpenedDate,
	orderProjectsByOpenedAt,
	PROJECT_NAME_ERROR,
	validateProjectNameInput,
} from './library-format.ts';
import {IDENTITY_TRANSFORM} from '@/engine/transform.ts';
import type {ProjectRecord} from '@/storage/types.ts';

function project(
	id: string,
	openedAt: number,
	overrides: Partial<ProjectRecord> = {},
): ProjectRecord {
	return {
		id,
		name: id,
		sourceHash: `hash-${id}`,
		referencedSourceHashes: [`hash-${id}`],
		sourceWidth: 320,
		sourceHeight: 240,
		transform: IDENTITY_TRANSFORM,
		effectiveWidth: 320,
		effectiveHeight: 240,
		stack: {schemaVersion: 1, instances: []},
		selectedInstanceId: null,
		historyHeadSeq: 0,
		historyMinSeq: 0,
		historyMaxSeq: 0,
		viewState: {
			fitMode: 'fit',
			zoom: 1,
			centerX: 0,
			centerY: 0,
			splitPosition: 0.5,
		},
		exportSettings: {
			format: 'png',
			quality: 92,
			sizeMode: 'full',
			customLongestSide: null,
		},
		createdAt: openedAt,
		updatedAt: openedAt,
		openedAt,
		...overrides,
	};
}

describe('orderProjectsByOpenedAt', () => {
	it('puts the most recently opened project first', () => {
		const ordered = orderProjectsByOpenedAt([
			project('old', 1000),
			project('newest', 3000),
			project('middle', 2000),
		]);

		expect(ordered.map((item) => item.id)).toEqual(['newest', 'middle', 'old']);
	});

	it('leaves the input array alone', () => {
		const input = [project('a', 1000), project('b', 2000)];
		orderProjectsByOpenedAt(input);

		expect(input.map((item) => item.id)).toEqual(['a', 'b']);
	});
});

describe('formatDimensions', () => {
	it('shows both sides in pixels', () => {
		expect(formatDimensions(4032, 3024)).toBe('4032 × 3024 px');
	});
});

describe('formatOpenedDate', () => {
	const now = new Date(2026, 4, 20, 15, 30).getTime();

	it('says Today for a project opened earlier the same day', () => {
		const openedAt = new Date(2026, 4, 20, 0, 5).getTime();
		expect(formatOpenedDate(openedAt, now)).toBe('Today');
	});

	it('says Yesterday for the previous calendar day', () => {
		const openedAt = new Date(2026, 4, 19, 23, 55).getTime();
		expect(formatOpenedDate(openedAt, now)).toBe('Yesterday');
	});

	it('shows the month and day for anything older, without the year', () => {
		const openedAt = new Date(2026, 0, 18, 9, 0).getTime();
		expect(formatOpenedDate(openedAt, now)).toBe('Jan 18');
	});

	it('adds the year when the project was opened in a different year', () => {
		const openedAt = new Date(2025, 10, 18, 9, 0).getTime();
		expect(formatOpenedDate(openedAt, now)).toBe('Nov 18, 2025');
	});
});

describe('validateProjectNameInput', () => {
	it('accepts a name and trims the surrounding spaces', () => {
		expect(validateProjectNameInput('  sunset  ')).toEqual({
			ok: true,
			name: 'sunset',
		});
	});

	it('accepts 120 characters', () => {
		const name = 'n'.repeat(120);
		expect(validateProjectNameInput(name)).toEqual({ok: true, name});
	});

	it('rejects an empty name', () => {
		expect(validateProjectNameInput('')).toEqual({
			ok: false,
			error: PROJECT_NAME_ERROR,
		});
	});

	it('rejects a name that is only spaces after trimming', () => {
		expect(validateProjectNameInput(' '.repeat(3))).toEqual({
			ok: false,
			error: PROJECT_NAME_ERROR,
		});
	});

	it('rejects 121 characters', () => {
		expect(validateProjectNameInput('n'.repeat(121))).toEqual({
			ok: false,
			error: PROJECT_NAME_ERROR,
		});
	});
});
