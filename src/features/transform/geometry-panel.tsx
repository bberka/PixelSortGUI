import {XIcon} from 'lucide-react';
import {CropSection} from './crop-section.tsx';
import {geometryController} from './geometry-controller.ts';
import {OrientationBar} from './orientation-bar.tsx';
import {ResizeSection} from './resize-section.tsx';
import {useAppRuntime} from '@/app/runtime-context.tsx';
import {Button} from '@/components/ui/button';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Separator} from '@/components/ui/separator';
import {useEditorViewportClass} from '@/lib/use-phone-layout.ts';

/**
 Rotate, flip, crop and resize of the open project (product.md F20, DESIGN.md
 section 7.2).
 */
export function GeometryPanel() {
	const {bundle} = useAppRuntime();
	// The portrait phone sheet already shows the title, and height is short.
	const compact = useEditorViewportClass() === 'phone-portrait';
	const close = (
		<Button
			type="button"
			variant="ghost"
			size="icon-xs"
			aria-label="Close transform panel"
			className="ml-auto"
			onClick={() => {
				geometryController(bundle).close();
			}}
		>
			<XIcon aria-hidden="true" />
		</Button>
	);

	return (
		<div
			className="flex h-full min-h-0 w-full flex-col"
			data-slot="geometry-panel"
		>
			{compact ? (
				<h2 className="sr-only">Transform</h2>
			) : (
				<div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1">
					<h2 className="truncate text-sm font-semibold">Transform</h2>
					{close}
				</div>
			)}
			<ScrollArea className="min-h-0 flex-1">
				<div className="flex flex-col pb-2">
					<OrientationBar trailing={compact ? close : null} />
					<Separator className="my-1" />
					<CropSection />
					<Separator className="my-1" />
					<ResizeSection />
				</div>
			</ScrollArea>
		</div>
	);
}
