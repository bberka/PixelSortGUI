import type {RefObject} from 'react';
import {ChevronDownIcon} from 'lucide-react';
import {ZOOM_PRESETS, formatZoomPercent} from './view.ts';
import {Button} from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type ZoomControlProps = {
	/**
	 The stage writes the live zoom here while a gesture runs, so a wheel or
	 pinch zoom updates the readout without re-rendering React.
	 */
	readonly labelRef: RefObject<HTMLSpanElement | null>;
	readonly zoom: number;
	readonly onFit: () => void;
	readonly onZoom: (zoom: number) => void;
};

/**
AC-F13.2: the current zoom percentage, opening a menu of zoom presets.
*/
export function ZoomControl({labelRef, zoom, onFit, onZoom}: ZoomControlProps) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="xs"
					className="surface-overlay gap-1 font-mono tabular-nums"
				>
					<span className="sr-only">Zoom</span>
					<span ref={labelRef}>{formatZoomPercent(zoom)}</span>
					<ChevronDownIcon aria-hidden="true" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" side="top">
				<DropdownMenuItem onSelect={onFit}>Fit</DropdownMenuItem>
				{ZOOM_PRESETS.map((preset) => (
					<DropdownMenuItem
						key={preset}
						onSelect={() => {
							onZoom(preset);
						}}
					>
						{formatZoomPercent(preset)}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
