import {TriangleAlertIcon} from 'lucide-react';
import {useAppStore} from './runtime-context.tsx';

/**
 Docked under the app bar and never over the canvas, per DESIGN.md section 9.
 The store keeps this flag for the whole session once IndexedDB fails to open.
 */
export function StorageUnavailableBanner() {
	const storageUnavailable = useAppStore(
		(state) => state.storage.storageUnavailable,
	);
	if (!storageUnavailable) {
		return null;
	}

	return (
		<div
			role="alert"
			className="flex shrink-0 items-center gap-2 border-b border-border bg-muted px-3 py-2 text-xs leading-4 text-foreground lg:px-6"
		>
			<TriangleAlertIcon
				aria-hidden="true"
				className="size-4 shrink-0 text-warning"
			/>
			<span>
				Storage unavailable: nothing will be saved after you close this tab.
			</span>
		</div>
	);
}
