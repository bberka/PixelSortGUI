import type {ReactNode} from 'react';
import {RotateCcwIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {cn} from '@/lib/utils';

export type ParamRowProps = {
	readonly labelId: string;
	readonly htmlFor?: string;
	readonly label: string;
	readonly valueText?: string;
	readonly helpId?: string;
	readonly help?: string;
	readonly reset?: {
		readonly label: string;
		readonly atDefault: boolean;
		readonly onReset: () => void;
	};
	/**
	Rendered at the right of the label row instead of going below it.
	*/
	readonly inline?: ReactNode;
	readonly children?: ReactNode;
};

/**
 One parameter's row: its label, its formatted value with unit, its reset
 button, the control itself and the schema's help text (DESIGN.md section
 5.1, AC-F5.6).
 */
export function ParamRow({
	labelId,
	htmlFor,
	label,
	valueText,
	helpId,
	help,
	reset,
	inline,
	children,
}: ParamRowProps) {
	return (
		<div className="flex flex-col gap-1 px-2 py-1.5" data-param-row="">
			<div className="flex min-h-6 items-center justify-between gap-2">
				<Label className="min-w-0 truncate" htmlFor={htmlFor} id={labelId}>
					{label}
				</Label>
				<div className="flex shrink-0 items-center gap-1">
					{valueText === undefined ? null : (
						<span className="font-mono text-[13px] tabular-nums text-muted-foreground">
							{valueText}
						</span>
					)}
					{inline}
					{reset ? (
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label={`Reset ${reset.label} to default`}
							className={cn(
								'transition-opacity',
								reset.atDefault
									? 'opacity-0 focus-visible:opacity-100'
									: 'opacity-100',
							)}
							onClick={reset.onReset}
						>
							<RotateCcwIcon aria-hidden="true" />
						</Button>
					) : null}
				</div>
			</div>
			{children}
			{help === undefined ? null : (
				<p className="text-xs leading-4 text-muted-foreground" id={helpId}>
					{help}
				</p>
			)}
		</div>
	);
}
