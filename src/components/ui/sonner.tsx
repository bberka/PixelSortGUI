import type * as React from 'react';
import {
	CircleCheckIcon,
	InfoIcon,
	Loader2Icon,
	OctagonXIcon,
	TriangleAlertIcon,
} from 'lucide-react';
import {Toaster as Sonner, type ToasterProps} from 'sonner';
import {useThemeStore} from '@/state/theme';

function Toaster({...props}: ToasterProps) {
	const resolvedTheme = useThemeStore((state) => state.resolvedTheme);

	return (
		<Sonner
			theme={resolvedTheme}
			className="toaster group"
			icons={{
				success: <CircleCheckIcon className="size-4 text-success" />,
				info: <InfoIcon className="size-4 text-accent-text" />,
				warning: <TriangleAlertIcon className="size-4 text-warning" />,
				error: <OctagonXIcon className="size-4 text-destructive-text" />,
				loading: <Loader2Icon className="size-4 animate-spin" />,
			}}
			style={
				{
					'--normal-bg': 'rgb(var(--popover))',
					'--normal-text': 'rgb(var(--popover-foreground))',
					'--normal-border': 'var(--overlay-border)',
					'--border-radius': 'var(--radius)',
				} as React.CSSProperties
			}
			{...props}
		/>
	);
}

export {Toaster};
