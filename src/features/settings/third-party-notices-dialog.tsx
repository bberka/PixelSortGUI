import {ExternalLinkIcon, FileTextIcon} from 'lucide-react';
import {
	THIRD_PARTY_NOTICES,
	THIRD_PARTY_NOTICES_FILE,
} from './third-party-notices.generated.ts';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import {ScrollArea} from '@/components/ui/scroll-area';

export function ThirdPartyNoticesDialog() {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="self-start"
				>
					<FileTextIcon className="size-4" aria-hidden="true" />
					<span>Third-party notices ({THIRD_PARTY_NOTICES.length})</span>
				</Button>
			</DialogTrigger>
			<DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
				<DialogHeader className="border-b border-border py-4 pr-14 pl-6">
					<DialogTitle>Third-party notices</DialogTitle>
					<DialogDescription>
						Open-source packages bundled with Drift, with their versions and
						licences.
					</DialogDescription>
				</DialogHeader>
				<ScrollArea tabStop={false} className="min-h-0 flex-1">
					<ul
						data-testid="third-party-notices"
						className="flex flex-col divide-y divide-border"
					>
						{THIRD_PARTY_NOTICES.map((notice) => (
							<li
								key={notice.name}
								className="flex items-center justify-between gap-3 px-6 py-2 text-xs"
							>
								<div className="flex min-w-0 flex-col items-start">
									{notice.url ? (
										<a
											href={notice.url}
											target="_blank"
											rel="noopener noreferrer"
											className="inline-flex min-h-6 pointer-coarse:min-h-11 items-center gap-1 font-medium text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
										>
											<span>{notice.name}</span>
											<ExternalLinkIcon
												className="size-3 shrink-0"
												aria-hidden="true"
											/>
										</a>
									) : (
										<span className="font-medium text-foreground">
											{notice.name}
										</span>
									)}
									<span className="font-mono text-muted-foreground tabular-nums">
										{notice.version}
									</span>
								</div>
								<Badge variant="outline" className="shrink-0">
									{notice.license}
								</Badge>
							</li>
						))}
					</ul>
				</ScrollArea>
				<div className="border-t border-border px-6 py-3">
					<a
						href={`/${THIRD_PARTY_NOTICES_FILE}`}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex min-h-6 pointer-coarse:min-h-11 items-center gap-1.5 text-sm font-medium text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
					>
						<FileTextIcon className="size-3.5 shrink-0" aria-hidden="true" />
						<span>Full licence texts</span>
					</a>
				</div>
			</DialogContent>
		</Dialog>
	);
}
