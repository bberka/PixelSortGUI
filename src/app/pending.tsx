import {Loader2Icon} from 'lucide-react';

export function PendingIndicator({label}: {readonly label: string}) {
	return (
		<div
			aria-busy="true"
			className="flex min-h-0 flex-1 items-center justify-center"
		>
			<Loader2Icon
				aria-hidden="true"
				className="size-5 animate-spin text-muted-foreground"
			/>
			<span className="sr-only">{label}</span>
		</div>
	);
}
