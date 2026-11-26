import {create} from 'zustand';

export const THEME_STORAGE_KEY = 'drift:theme';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const VALID_THEMES: ReadonlySet<string> = new Set(['system', 'light', 'dark']);

export function isThemePreference(value: unknown): value is ThemePreference {
	return typeof value === 'string' && VALID_THEMES.has(value);
}

export function normalizeThemePreference(value: unknown): ThemePreference {
	return isThemePreference(value) ? value : 'system';
}

export function resolveTheme(
	preference: ThemePreference,
	systemPrefersDark: boolean,
): ResolvedTheme {
	if (preference === 'light' || preference === 'dark') {
		return preference;
	}

	return systemPrefersDark ? 'dark' : 'light';
}

function readSystemPrefersDark(): boolean {
	return typeof globalThis.matchMedia === 'function'
		? globalThis.matchMedia('(prefers-color-scheme: dark)').matches
		: false;
}

export function readStoredTheme(): ThemePreference {
	if (typeof document === 'undefined') {
		return 'system';
	}

	const fromDataset = document.documentElement.dataset.theme;
	if (isThemePreference(fromDataset)) {
		return fromDataset;
	}

	try {
		return normalizeThemePreference(
			globalThis.localStorage.getItem(THEME_STORAGE_KEY),
		);
	} catch {}

	return 'system';
}

export function applyThemePreference(theme: ThemePreference): void {
	if (typeof document === 'undefined') {
		return;
	}

	document.documentElement.dataset.theme = theme;

	try {
		globalThis.localStorage.setItem(THEME_STORAGE_KEY, theme);
	} catch {}
}

type ThemeState = {
	theme: ThemePreference;
	resolvedTheme: ResolvedTheme;
	setTheme: (theme: ThemePreference) => void;
};

const initialTheme = readStoredTheme();

export const useThemeStore = create<ThemeState>((set) => ({
	theme: initialTheme,
	resolvedTheme: resolveTheme(initialTheme, readSystemPrefersDark()),
	setTheme(theme) {
		applyThemePreference(theme);
		set({
			theme,
			resolvedTheme: resolveTheme(theme, readSystemPrefersDark()),
		});
	},
}));

if (typeof globalThis.matchMedia === 'function') {
	const mediaQuery = globalThis.matchMedia('(prefers-color-scheme: dark)');
	const handleMediaChange = (event: MediaQueryListEvent) => {
		const current = useThemeStore.getState().theme;
		useThemeStore.setState({
			resolvedTheme: resolveTheme(current, event.matches),
		});
	};

	mediaQuery.addEventListener('change', handleMediaChange);

	globalThis.addEventListener('storage', (event) => {
		if (event.key !== THEME_STORAGE_KEY) {
			return;
		}

		const next = normalizeThemePreference(event.newValue);
		if (typeof document !== 'undefined') {
			document.documentElement.dataset.theme = next;
		}

		useThemeStore.setState({
			theme: next,
			resolvedTheme: resolveTheme(next, mediaQuery.matches),
		});
	});
}
