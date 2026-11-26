import {Fragment, type RefObject} from 'react';
import {ImageUpIcon} from 'lucide-react';
import {EffectShowcase} from './effect-showcase.tsx';
import {useSampleProject} from './use-sample-project.ts';
import {useAppStore} from '@/app/runtime-context.tsx';
import {Button} from '@/components/ui/button';
import {ScrollArea} from '@/components/ui/scroll-area';
import {LANDING} from '@/features/guide/content.ts';
import {GUIDE_HASH} from '@/features/guide/navigation.ts';
import {ImportImagesButton} from '@/features/import/import-images-button.tsx';

export type EmptyLibraryProps = {
	/**
	The pitch heading, so the Library can move focus to it.
	*/
	readonly headingRef: RefObject<HTMLHeadingElement | null>;
};

/**
 The landing screen shown while there are no projects (product.md F2,
 DESIGN.md section 7.3). Files dropped on it are taken by the window's drop
 target.
 */
export function EmptyLibrary({headingRef}: EmptyLibraryProps) {
	const welcomeDismissed = useAppStore((state) => state.welcomeDismissed);
	const dismissWelcome = useAppStore((state) => state.dismissWelcome);
	const sample = useSampleProject();

	return (
		<ScrollArea
			tabStop={false}
			className="min-h-0 flex-1"
			viewportClassName="[&>div]:flex! [&>div]:min-h-full [&>div]:flex-col"
		>
			{/* Auto margins centre the column and never cut off a tall one. */}
			<div className="mx-auto my-auto flex w-full max-w-4xl flex-col items-center gap-3 px-4 py-4 text-center sm:px-6">
				<img
					src="/icons/icon.svg"
					alt=""
					aria-hidden="true"
					width={56}
					height={56}
					className="size-14 shrink-0 rounded-lg border border-border"
				/>
				<h2
					ref={headingRef}
					tabIndex={-1}
					className="max-w-[24ch] text-2xl leading-8 font-semibold text-balance sm:text-3xl sm:leading-9"
				>
					{LANDING.pitch}
				</h2>
				<section
					aria-label={LANDING.dropRegionLabel}
					className="flex w-full max-w-xl flex-col items-center gap-3 rounded-lg border-2 border-dashed border-input bg-card px-4 py-6"
				>
					<ImageUpIcon
						aria-hidden="true"
						className="size-8 text-muted-foreground"
					/>
					<p className="text-base leading-6 font-semibold">
						{LANDING.dropTitle}
					</p>
					<div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row">
						<ImportImagesButton>{LANDING.openLabel}</ImportImagesButton>
						<Button
							type="button"
							variant="outline"
							disabled={sample.busy}
							onClick={() => {
								sample.create();
							}}
						>
							{sample.busy ? LANDING.sampleBusyLabel : LANDING.sampleLabel}
						</Button>
						<Button asChild variant="ghost">
							<a href={GUIDE_HASH}>{LANDING.guideLabel}</a>
						</Button>
					</div>
				</section>
				<div className="flex max-w-[68ch] flex-col gap-2">
					<p className="text-sm leading-5 text-muted-foreground">
						<span>{LANDING.privacy}</span> <span>{LANDING.offline}</span>
					</p>
					<p className="text-xs leading-5 text-muted-foreground">
						{LANDING.formats} {LANDING.shortcutsLabel}
						{LANDING.shortcuts.map((shortcut) => (
							<Fragment key={shortcut.key}>
								{' '}
								<span className="whitespace-nowrap">
									<kbd className="rounded-sm bg-secondary px-1.5 py-0.5 font-mono text-secondary-foreground">
										{shortcut.key}
									</kbd>{' '}
									{shortcut.action}
								</span>
							</Fragment>
						))}
					</p>
				</div>
				{welcomeDismissed ? null : (
					<EffectShowcase
						busy={sample.busy}
						onPick={sample.create}
						onDismiss={() => {
							void dismissWelcome();
							headingRef.current?.focus();
						}}
					/>
				)}
			</div>
		</ScrollArea>
	);
}
