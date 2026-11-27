import {CircleHelpIcon} from 'lucide-react';
import {GUIDE_BUTTON_LABEL} from './content.ts';
import {openGuide} from './navigation.ts';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {useShortcutHint} from '@/lib/keyboard-hints.ts';

export function GuideButton() {
	const hint = useShortcutHint();

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label={GUIDE_BUTTON_LABEL}
					data-guide-button=""
					onClick={openGuide}
				>
					<CircleHelpIcon className="size-4" aria-hidden="true" />
				</Button>
			</TooltipTrigger>
			<TooltipContent>{hint(GUIDE_BUTTON_LABEL, '?')}</TooltipContent>
		</Tooltip>
	);
}
