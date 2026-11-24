import {Button} from '@/components/ui/button';
import {useAppStore} from '@/app/runtime-context.tsx';

/**
 Placeholder: T4.4 replaces the body with the card grid and T4.3 turns the
 "Open images" button into the import flow. Until then the screen shows the
 DESIGN.md section 9 empty state and nothing else.
 */
export function LibraryScreen() {
	const projectCount = useAppStore((state) => state.projects.length);

	if (projectCount > 0) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center p-3 text-sm text-muted-foreground sm:p-4 lg:p-6">
				{projectCount === 1
					? '1 project on this device.'
					: `${projectCount} projects on this device.`}
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 items-center justify-center p-3 sm:p-4 lg:p-6">
			<div className="flex max-w-[36ch] flex-col items-center gap-3 text-center">
				<h2 className="text-lg leading-6 font-semibold">No projects yet</h2>
				<p className="text-sm text-muted-foreground">
					Images stay on this device.
				</p>
				<Button disabled type="button">
					Open images
				</Button>
			</div>
		</div>
	);
}
