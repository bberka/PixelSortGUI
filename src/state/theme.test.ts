import {describe, expect, it} from 'vite-plus/test';
import {
	isThemePreference,
	normalizeThemePreference,
	resolveTheme,
	THEME_STORAGE_KEY,
} from './theme';

describe('theme state helpers', () => {
	it('uses the spec localStorage key', () => {
		expect(THEME_STORAGE_KEY).toBe('psg:theme');
	});

	it('validates and normalizes theme preferences', () => {
		expect(isThemePreference('system')).toBe(true);
		expect(isThemePreference('light')).toBe(true);
		expect(isThemePreference('dark')).toBe(true);
		expect(isThemePreference('auto')).toBe(false);
		expect(isThemePreference(null)).toBe(false);

		expect(normalizeThemePreference('light')).toBe('light');
		expect(normalizeThemePreference('dark')).toBe('dark');
		expect(normalizeThemePreference('invalid')).toBe('system');
		expect(normalizeThemePreference(undefined)).toBe('system');
	});

	it('resolves system preference from OS dark mode flag', () => {
		expect(resolveTheme('system', false)).toBe('light');
		expect(resolveTheme('system', true)).toBe('dark');
		expect(resolveTheme('light', true)).toBe('light');
		expect(resolveTheme('dark', false)).toBe('dark');
	});
});
