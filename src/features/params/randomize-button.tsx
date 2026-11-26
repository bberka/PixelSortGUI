import {DicesIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {usePhoneLayout} from '@/lib/use-phone-layout.ts';

export function RandomizeButton({
	label,
	disabled,
	className,
	onRandomize,
}: {
	readonly label: string | null;
	readonly disabled: boolean;
	readonly className?: string;
	readonly onRandomize: () => void;
}) {
	const isPhone = usePhoneLayout();

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="inline-flex">
					<Button
						type="button"
						variant="ghost"
						className={className}
						size={isPhone ? 'icon-xs' : 'xs'}
						aria-label={isPhone ? 'Randomize' : undefined}
						disabled={disabled}
						onClick={onRandomize}
					>
						<DicesIcon aria-hidden="true" />
						{isPhone ? null : 'Randomize'}
					</Button>
				</span>
			</TooltipTrigger>
			<TooltipContent>
				{label
					? `Give every ${label} parameter a random value`
					: 'Select an effect to randomize'}
			</TooltipContent>
		</Tooltip>
	);
}
