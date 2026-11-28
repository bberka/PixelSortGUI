import {MonitorIcon, MoonIcon, SunIcon} from 'lucide-react';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {
	isThemePreference,
	useThemeStore,
	type ThemePreference,
} from '@/state/theme';

const THEME_OPTIONS: ReadonlyArray<{
	value: ThemePreference;
	label: string;
}> = [
	{value: 'system', label: 'System'},
	{value: 'light', label: 'Light'},
	{value: 'dark', label: 'Black'},
];

function ThemeIcon({theme}: {readonly theme: ThemePreference}) {
	if (theme === 'light') {
		return <SunIcon className="size-4" aria-hidden="true" />;
	}

	return theme === 'dark' ? (
		<MoonIcon className="size-4" aria-hidden="true" />
	) : (
		<MonitorIcon className="size-4" aria-hidden="true" />
	);
}

export function ThemeSelector() {
	const theme = useThemeStore((state) => state.theme);
	const setTheme = useThemeStore((state) => state.setTheme);

	return (
		<ToggleGroup
			type="single"
			variant="outline"
			size="sm"
			value={theme}
			aria-label="Theme"
			onValueChange={(value) => {
				if (isThemePreference(value)) {
					setTheme(value);
				}
			}}
		>
			{THEME_OPTIONS.map((option) => (
				<ToggleGroupItem
					key={option.value}
					value={option.value}
					aria-label={option.label}
				>
					<ThemeIcon theme={option.value} />
					<span>{option.label}</span>
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}
