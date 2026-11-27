import type {RefObject} from 'react';

// Each line is white inside a black casing, so it shows on any photo.
const CASING = [
	{stroke: '#000', width: 3},
	{stroke: '#fff', width: 1},
] as const;

/**
 The brush outline, its dashed hardness ring and the `+` or `-` of the tool
 (DESIGN.md section 7.4). `placeCursor` moves and sizes it without a render.
 */
export function BrushCursor({
	ref,
}: {
	readonly ref: RefObject<HTMLDivElement | null>;
}) {
	return (
		<div
			ref={ref}
			hidden
			aria-hidden="true"
			data-slot="brush-cursor"
			className="group pointer-events-none absolute top-0 left-0"
		>
			<svg className="block size-px overflow-visible" fill="none">
				{CASING.map(({stroke, width}) => (
					<g key={stroke} stroke={stroke} strokeWidth={width}>
						<ellipse data-ring="outer" />
						<ellipse data-ring="hard" strokeDasharray="4 4" />
						<path d="M-4 0H4" />
						<path className="group-data-[tool=erase]:hidden" d="M0 -4V4" />
					</g>
				))}
			</svg>
		</div>
	);
}
