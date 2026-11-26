import type {ReactNode} from 'react';
import {
	FlipHorizontal2Icon,
	FlipVertical2Icon,
	RotateCcwIcon,
	RotateCwIcon,
} from 'lucide-react';
import type {Orientation} from './crop-math.ts';
import {geometryController} from './geometry-controller.ts';
import {GeometrySection} from './section.tsx';
import {useAppRuntime} from '@/app/runtime-context.tsx';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';

const STEPS: ReadonlyArray<{
	step: Orientation;
	label: string;
	Icon: typeof RotateCwIcon;
}> = [
	{step: 'ccw', label: 'Rotate 90° counter-clockwise', Icon: RotateCcwIcon},
	{step: 'cw', label: 'Rotate 90° clockwise', Icon: RotateCwIcon},
	// Lucide names these by the mirror line: "vertical" draws a left-right flip.
	{step: 'flipH', label: 'Flip horizontal', Icon: FlipVertical2Icon},
	{step: 'flipV', label: 'Flip vertical', Icon: FlipHorizontal2Icon},
];

// Each button saves one history entry.
export function OrientationBar({trailing}: {readonly trailing: ReactNode}) {
	const {bundle} = useAppRuntime();

	return (
		<GeometrySection title="Orientation">
			<div className="flex items-center gap-2">
				{STEPS.map(({step, label, Icon}) => (
					<Tooltip key={step}>
						<TooltipTrigger asChild>
							<span className="inline-flex">
								<Button
									type="button"
									variant="outline"
									size="icon-sm"
									aria-label={label}
									onClick={() => {
										void geometryController(bundle).orient(step);
									}}
								>
									<Icon aria-hidden="true" />
								</Button>
							</span>
						</TooltipTrigger>
						<TooltipContent>{label}</TooltipContent>
					</Tooltip>
				))}
				{trailing}
			</div>
		</GeometrySection>
	);
}
