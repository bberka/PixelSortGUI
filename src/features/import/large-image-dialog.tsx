import type {ImageImport, LargeImagePrompt} from './use-image-import.ts';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function megapixels(width: number, height: number): string {
	return ((width * height) / 1_000_000).toFixed(1);
}

/**
 The blocking choice DESIGN.md section 5.3 and product.md section 4 give an
 image over the 50 MP guaranteed maximum: a downscaled copy, the original as a
 best effort, or nothing.
 */
export function LargeImageDialog({
	prompt,
	onDecide,
}: {
	readonly prompt: LargeImagePrompt;
	readonly onDecide: ImageImport['decide'];
}) {
	return (
		<AlertDialog
			open
			onOpenChange={(open) => {
				if (!open) {
					onDecide('cancel');
				}
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{prompt.fileName} is {prompt.width} × {prompt.height} px
					</AlertDialogTitle>
					<AlertDialogDescription>
						That is {megapixels(prompt.width, prompt.height)} megapixels. The
						guaranteed maximum is 50 megapixels, so this image may fail to
						preview or export at its full size. Importing it at 50 MP stores a
						downscaled copy as the source image.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter className="sm:justify-between">
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<div className="flex flex-col-reverse gap-2 sm:flex-row">
						<AlertDialogAction
							variant="outline"
							onClick={() => {
								onDecide('keep');
							}}
						>
							Import anyway
						</AlertDialogAction>
						<AlertDialogAction
							onClick={() => {
								onDecide('downscale');
							}}
						>
							Import at 50 MP
						</AlertDialogAction>
					</div>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
