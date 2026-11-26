import {XIcon} from 'lucide-react';
import {WELCOME} from './content.ts';
import {GUIDE_HASH} from './navigation.ts';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {ImportImagesButton} from '@/features/import/import-images-button.tsx';

export type WelcomeCardProps = {
	readonly onDismiss: () => void;
};

/**
 Shown in the empty Library on a first launch until dismissed (product.md F27).
 */
export function WelcomeCard({onDismiss}: WelcomeCardProps) {
	return (
		<Card
			role="region"
			aria-labelledby="welcome-title"
			className="relative w-full max-w-md gap-3 px-4 text-left"
		>
			<h2
				id="welcome-title"
				className="pr-10 text-base leading-6 font-semibold"
			>
				{WELCOME.title}
			</h2>
			<p className="text-sm text-muted-foreground">{WELCOME.text}</p>
			<div className="flex flex-wrap items-center gap-2">
				<ImportImagesButton variant="outline" size="sm">
					{WELCOME.importLabel}
				</ImportImagesButton>
				<Button asChild variant="ghost" size="sm">
					<a href={GUIDE_HASH}>{WELCOME.guideLabel}</a>
				</Button>
			</div>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="absolute top-2 right-2"
				aria-label={WELCOME.dismissLabel}
				onClick={onDismiss}
			>
				<XIcon aria-hidden="true" />
			</Button>
		</Card>
	);
}
