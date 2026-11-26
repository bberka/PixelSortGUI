import {CircleHelpIcon} from 'lucide-react';
import {GUIDE_BUTTON_LABEL, GUIDE_BUTTON_TOOLTIP} from './content.ts';
import {openGuide} from './navigation.ts';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';

export function GuideButton() {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label={GUIDE_BUTTON_LABEL}
					onClick={openGuide}
				>
					<CircleHelpIcon className="size-4" aria-hidden="true" />
				</Button>
			</TooltipTrigger>
			<TooltipContent>{GUIDE_BUTTON_TOOLTIP}</TooltipContent>
		</Tooltip>
	);
}
