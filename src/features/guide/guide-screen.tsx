import {useEffect, useRef, useState} from 'react';
import {ChevronDownIcon, ChevronRightIcon} from 'lucide-react';
import {
	GUIDE_CONTENTS_LABEL,
	GUIDE_SECTIONS,
	GUIDE_TITLE,
	type GuideSection,
} from './content.ts';
import {Block} from './guide-blocks.tsx';
import {Button} from '@/components/ui/button';
import {ScrollArea} from '@/components/ui/scroll-area';
import {useShowKeyboardHints} from '@/lib/keyboard-hints.ts';

function headingId(sectionId: string): string {
	return `guide-${sectionId}`;
}

/**
 The router owns the URL hash, so the table of contents scrolls to a section
 and moves focus to its heading instead of linking to an anchor.
 */
function showSection(sectionId: string): void {
	const heading = globalThis.document.querySelector<HTMLElement>(
		`#${headingId(sectionId)}`,
	);
	heading?.focus({preventScroll: true});
	heading?.scrollIntoView({block: 'start'});
}

function ContentsList({
	sections,
	onSelect,
}: {
	readonly sections: readonly GuideSection[];
	readonly onSelect: (sectionId: string) => void;
}) {
	return (
		<ul className="flex flex-col gap-0.5">
			{sections.map((section) => (
				<li key={section.id}>
					<button
						type="button"
						className="flex min-h-8 w-full items-center rounded-sm px-2 py-1 text-left text-sm hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11"
						onClick={() => {
							onSelect(section.id);
						}}
					>
						{section.title}
					</button>
				</li>
			))}
		</ul>
	);
}

/**
 The in-app guide (product.md F27, DESIGN.md section 7.3).
 */
export function GuideScreen() {
	const [contentsOpen, setContentsOpen] = useState(false);
	const titleRef = useRef<HTMLHeadingElement>(null);
	const showKeys = useShowKeyboardHints();
	const sections = GUIDE_SECTIONS.filter(
		(section) => showKeys || !section.keyboardOnly,
	);

	useEffect(() => {
		titleRef.current?.focus({preventScroll: true});
	}, []);

	return (
		<ScrollArea
			tabStop={false}
			className="min-h-0 flex-1"
			viewportClassName="[&>div]:block!"
		>
			<div className="mx-auto flex max-w-5xl flex-col px-3 pb-12 lg:flex-row lg:items-start lg:gap-8 lg:px-6">
				<nav
					aria-label={GUIDE_CONTENTS_LABEL}
					className="sticky top-0 z-10 -mx-3 border-b border-border bg-background px-3 py-2 lg:top-0 lg:mx-0 lg:w-56 lg:shrink-0 lg:border-b-0 lg:px-0 lg:py-6"
				>
					<div className="lg:hidden">
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="w-full justify-start pointer-coarse:min-h-11"
							aria-expanded={contentsOpen}
							aria-controls="guide-contents"
							onClick={() => {
								setContentsOpen((open) => !open);
							}}
						>
							{contentsOpen ? (
								<ChevronDownIcon aria-hidden="true" />
							) : (
								<ChevronRightIcon aria-hidden="true" />
							)}
							<span>{GUIDE_CONTENTS_LABEL}</span>
						</Button>
					</div>
					<p
						aria-hidden="true"
						className="px-2 pb-2 text-[11px] leading-4 font-semibold tracking-wider text-muted-foreground uppercase max-lg:hidden"
					>
						{GUIDE_CONTENTS_LABEL}
					</p>
					<ScrollArea
						id="guide-contents"
						tabStop={false}
						className={`max-lg:mt-2 max-lg:max-h-[60dvh] lg:max-h-[calc(100dvh-8rem)] ${contentsOpen ? '' : 'max-lg:hidden'}`}
					>
						<ContentsList
							sections={sections}
							onSelect={(sectionId) => {
								setContentsOpen(false);
								// Wait for the collapsed list to leave the layout.
								globalThis.requestAnimationFrame(() => {
									showSection(sectionId);
								});
							}}
						/>
					</ScrollArea>
				</nav>
				<article className="flex max-w-[68ch] min-w-0 flex-1 flex-col gap-8 py-6 text-sm leading-6 max-lg:mx-auto max-lg:w-full">
					<h2
						ref={titleRef}
						tabIndex={-1}
						className="text-2xl leading-8 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
					>
						{GUIDE_TITLE}
					</h2>
					{sections.map((section) => (
						<section
							key={section.id}
							aria-labelledby={headingId(section.id)}
							className="flex flex-col gap-3"
						>
							<h3
								id={headingId(section.id)}
								tabIndex={-1}
								className="scroll-mt-16 text-lg leading-6 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:scroll-mt-6"
							>
								{section.title}
							</h3>
							{section.blocks.map((block) => (
								<Block key={JSON.stringify(block)} block={block} />
							))}
						</section>
					))}
				</article>
			</div>
		</ScrollArea>
	);
}
