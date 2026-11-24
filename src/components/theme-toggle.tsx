import {CheckIcon, MonitorIcon, MoonIcon, SunIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
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
	{value: 'dark', label: 'True Black'},
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

function labelForTheme(theme: ThemePreference): string {
	const match = THEME_OPTIONS.find((option) => option.value === theme);
	return match ? match.label : 'System';
}

export function ThemeToggle() {
	const theme = useThemeStore((state) => state.theme);
	const setTheme = useThemeStore((state) => state.setTheme);
	const activeLabel = labelForTheme(theme);

	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="outline"
							size="icon-sm"
							aria-label={`Theme: ${activeLabel}`}
						>
							<ThemeIcon theme={theme} />
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent>Theme: {activeLabel}</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="end">
				{THEME_OPTIONS.map((option) => (
					<DropdownMenuItem
						key={option.value}
						onSelect={() => {
							setTheme(option.value);
						}}
					>
						<ThemeIcon theme={option.value} />
						<span>{option.label}</span>
						{theme === option.value && (
							<CheckIcon className="ml-auto size-4" aria-hidden="true" />
						)}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
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
