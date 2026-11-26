import type {ComponentProps, ReactNode} from 'react';
import {ImportFeedback} from './import-feedback.tsx';
import {useImageImport, type ImageImportOptions} from './use-image-import.ts';
import {IMPORT_ACCEPT, useImagePicker} from './use-image-picker.ts';
import {Button} from '@/components/ui/button';

export type ImportImagesButtonProps = {
	readonly children?: ReactNode;
	/**
	 Test seam: lets a test inject the codec calls, like `App`'s `screens` prop.
	 */
	readonly probe?: ImageImportOptions['probe'];
	readonly downscale?: ImageImportOptions['downscale'];
	readonly variant?: ComponentProps<typeof Button>['variant'];
	readonly size?: ComponentProps<typeof Button>['size'];
	readonly className?: string;
};

/**
 The import trigger a screen renders itself, with the copy DESIGN.md section 9
 gives the library empty state. The hidden file input, the checks and the
 dialogs all come with it.
 */
export function ImportImagesButton({
	children = 'Open images',
	variant = 'default',
	size = 'default',
	className,
	probe,
	downscale,
}: ImportImagesButtonProps) {
	const flow = useImageImport({probe, downscale});
	const picker = useImagePicker(flow.start);

	return (
		<>
			<input
				ref={picker.inputRef}
				multiple
				hidden
				type="file"
				accept={IMPORT_ACCEPT}
				onChange={picker.onInputChange}
			/>
			<Button
				type="button"
				variant={variant}
				size={size}
				className={className}
				onClick={picker.open}
			>
				{children}
			</Button>
			<ImportFeedback flow={flow} />
		</>
	);
}
