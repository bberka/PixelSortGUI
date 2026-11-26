import {useEffect, useRef, useState} from 'react';
import {XIcon} from 'lucide-react';
import {nextTask} from './next-task.ts';
import {SHOWCASE_TILES, type ShowcaseTile} from './showcase.ts';
import type * as ShowcaseRender from './showcase-render.ts';
import {Button} from '@/components/ui/button';
import type {RgbaImage} from '@/engine/types.ts';
import {LANDING} from '@/features/guide/content.ts';

const loadRenderer = async (): Promise<typeof ShowcaseRender> =>
	import('./showcase-render.ts');

/**
 The tile previews, filled in one at a time. A preview that cannot be rendered
 stays empty.
 */
function useShowcasePreviews(): Readonly<Record<string, RgbaImage>> {
	const [previews, setPreviews] = useState<Record<string, RgbaImage>>({});

	useEffect(() => {
		let alive = true;
		void (async () => {
			const {renderShowcasePreview} = await loadRenderer();
			for (const tile of SHOWCASE_TILES) {
				await nextTask();
				if (!alive) {
					return;
				}

				const image = await renderShowcasePreview(tile.stack);
				if (alive) {
					setPreviews((current) => ({...current, [tile.id]: image}));
				}
			}
		})().catch((error: unknown) => {
			console.warn('Effect previews could not be rendered', error);
		});
		return () => {
			alive = false;
		};
	}, []);

	return previews;
}

function PreviewCanvas({image}: {readonly image: RgbaImage | undefined}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		const context = canvas?.getContext('2d');
		if (!canvas || !context || !image) {
			return;
		}

		canvas.width = image.width;
		canvas.height = image.height;
		const pixels = context.createImageData(image.width, image.height);
		pixels.data.set(image.data);
		context.putImageData(pixels, 0, 0);
		canvas.dataset.rendered = '';
	}, [image]);

	return (
		<span aria-hidden="true" className="relative block aspect-[4/3] bg-muted">
			<canvas ref={canvasRef} className="block size-full" />
			{image ? (
				<span className="split-divider-line absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2" />
			) : null}
		</span>
	);
}

export type EffectShowcaseProps = {
	readonly busy: boolean;
	readonly onDismiss: () => void;
	readonly onPick: (tile: ShowcaseTile) => void;
};

/**
 The first-launch introduction of the empty Library (product.md F27).
 */
export function EffectShowcase({busy, onDismiss, onPick}: EffectShowcaseProps) {
	const previews = useShowcasePreviews();

	return (
		<section
			aria-labelledby="introduction-title"
			className="flex w-full flex-col gap-3 pt-2"
		>
			<div className="relative px-12">
				<h3
					id="introduction-title"
					className="text-base leading-6 font-semibold"
				>
					{LANDING.introTitle}
				</h3>
				<p className="text-xs leading-4 text-muted-foreground">
					{LANDING.introText}
				</p>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					className="absolute top-0 right-0"
					aria-label={LANDING.introDismissLabel}
					onClick={onDismiss}
				>
					<XIcon aria-hidden="true" />
				</Button>
			</div>
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				{SHOWCASE_TILES.map((tile) => (
					<button
						key={tile.id}
						type="button"
						disabled={busy}
						className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card text-left hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-wait"
						onClick={() => {
							onPick(tile);
						}}
					>
						<PreviewCanvas image={previews[tile.id]} />
						<span className="flex flex-col gap-0.5 p-3">
							<span className="text-sm leading-5 font-semibold">
								{tile.name}
							</span>
							<span className="text-xs leading-4 text-muted-foreground">
								{tile.description}
							</span>
						</span>
					</button>
				))}
			</div>
		</section>
	);
}
