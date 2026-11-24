import {describe, expect, it} from 'vite-plus/test';
import {nextVersion, parseMinor, parseReleaseTag} from './release-version.ts';

describe('parseMinor', () => {
	it('parses a whole number with surrounding whitespace', () => {
		expect(parseMinor('0\n')).toBe(0);
		expect(parseMinor(' 12 ')).toBe(12);
	});

	it('rejects empty, negative, leading-zero, or non-numeric values', () => {
		expect(() => parseMinor('')).toThrow();
		expect(() => parseMinor('01')).toThrow();
		expect(() => parseMinor('-1')).toThrow();
		expect(() => parseMinor('0.1.0')).toThrow();
	});
});

describe('parseReleaseTag', () => {
	it('parses ZeroVer tags with or without a v prefix', () => {
		expect(parseReleaseTag('v0.1.2')).toEqual({minor: 1, patch: 2});
		expect(parseReleaseTag('0.0.0')).toEqual({minor: 0, patch: 0});
	});

	it('returns null for non-ZeroVer tags', () => {
		expect(parseReleaseTag('v1.0.0')).toBeNull();
		expect(parseReleaseTag('v0.1.0-beta.1')).toBeNull();
		expect(parseReleaseTag('release-1')).toBeNull();
	});
});

describe('nextVersion', () => {
	it('starts at patch 0 when no matching tags exist', () => {
		expect(nextVersion(0, [])).toBe('0.0.0');
		expect(nextVersion(1, ['v1.0.0', 'notes'])).toBe('0.1.0');
	});

	it('increments the highest patch for the current minor', () => {
		expect(nextVersion(1, ['v0.1.0', 'v0.1.9', 'v0.1.2'])).toBe('0.1.10');
	});

	it('resets patch to 0 when VERSION advances past the latest released minor', () => {
		expect(nextVersion(2, ['v0.1.0', 'v0.1.4'])).toBe('0.2.0');
	});

	it('throws when VERSION is lower than an existing release minor', () => {
		expect(() => nextVersion(1, ['v0.2.0'])).toThrow(/Set VERSION to 2/);
	});
});
