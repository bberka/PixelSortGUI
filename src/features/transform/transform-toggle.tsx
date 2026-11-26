import {CropIcon} from 'lucide-react';
import {geometryController} from './geometry-controller.ts';
import {useAppRuntime, useTransientStore} from '@/app/runtime-context.tsx';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {PHONE_TOOL_CLASS} from '@/features/toolbar/phone-tool.ts';

// The toolbar button that opens and closes the Geometry panel.
export function TransformToggle({compact}: {readonly compact: boolean}) {
	const {bundle} = useAppRuntime();
	const open = useTransientStore((state) => state.geometry.open);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant={open ? 'default' : 'ghost'}
					size={compact ? 'default' : 'sm'}
					className={compact ? PHONE_TOOL_CLASS : undefined}
					aria-label="Transform"
					aria-pressed={open}
					onClick={() => {
						const controller = geometryController(bundle);
						if (open) {
							controller.close();
						} else {
							controller.open();
						}
					}}
				>
					<CropIcon aria-hidden="true" />
					<span>Transform</span>
				</Button>
			</TooltipTrigger>
			<TooltipContent>Crop, rotate and resize</TooltipContent>
		</Tooltip>
	);
}
