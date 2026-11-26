import {useId, type ReactNode} from 'react';

export function GeometrySection({
	title,
	children,
}: {
	readonly title: string;
	readonly children: ReactNode;
}) {
	const headingId = useId();

	return (
		<section aria-labelledby={headingId} className="flex flex-col gap-2 px-2">
			<h3
				id={headingId}
				className="pt-2 text-[11px] leading-4 font-semibold tracking-[0.05em] text-muted-foreground uppercase"
			>
				{title}
			</h3>
			{children}
		</section>
	);
}
