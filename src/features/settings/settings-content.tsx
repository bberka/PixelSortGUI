import {useEffect, useRef, useState} from 'react';
import {
	ChevronDownIcon,
	ChevronRightIcon,
	DownloadIcon,
	ExternalLinkIcon,
	FileTextIcon,
	MonitorIcon,
	MoonIcon,
	ShieldCheckIcon,
	SunIcon,
} from 'lucide-react';
import {ABOUT_EXTERNAL_LINKS} from './about-links.ts';
import {CHANGELOG_TEXT} from './changelog.generated.ts';
import {
	THIRD_PARTY_NOTICES,
	THIRD_PARTY_NOTICES_FILE,
} from './third-party-notices.generated.ts';
import {useAppStore} from '@/app/runtime-context.tsx';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Separator} from '@/components/ui/separator';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {usePwaStore} from '@/state/pwa.ts';
import {isThemePreference, type ThemePreference} from '@/state/theme.ts';
import {
	formatStorageUsage,
	getStorageEstimate,
	isStoragePersisted,
	requestPersistentStorage,
	type StorageManagerLike,
} from '@/storage/quota.ts';

const THEME_OPTIONS: ReadonlyArray<{
	readonly value: ThemePreference;
	readonly label: string;
}> = [
	{value: 'system', label: 'System'},
	{value: 'light', label: 'Light'},
	{value: 'dark', label: 'True Black'},
];

function ThemeOptionIcon({theme}: {readonly theme: ThemePreference}) {
	if (theme === 'light') {
		return <SunIcon className="size-4" aria-hidden="true" />;
	}

	return theme === 'dark' ? (
		<MoonIcon className="size-4" aria-hidden="true" />
	) : (
		<MonitorIcon className="size-4" aria-hidden="true" />
	);
}

function getAppVersionLabel(): string {
	const stamped = (globalThis as {VITE_APP_VERSION?: string}).VITE_APP_VERSION;
	return typeof stamped === 'string' && stamped.trim().length > 0
		? stamped.trim()
		: '0.x (dev)';
}

export type SettingsContentProps = {
	readonly open: boolean;
	readonly storageManager?: StorageManagerLike;
};

export function SettingsContent({open, storageManager}: SettingsContentProps) {
	const theme = useAppStore((state) => state.theme);
	const setTheme = useAppStore((state) => state.setTheme);
	const storage = useAppStore((state) => state.storage);
	const setStorageMetrics = useAppStore((state) => state.setStorageMetrics);
	const installPrompt = usePwaStore((state) => state.installPrompt);
	const installing = usePwaStore((state) => state.installing);
	const promptInstall = usePwaStore((state) => state.promptInstall);

	const [requestingPersistence, setRequestingPersistence] = useState(false);
	const [noticesOpen, setNoticesOpen] = useState(false);
	const [changelogOpen, setChangelogOpen] = useState(false);
	const mountedRef = useRef(true);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	useEffect(() => {
		if (!open) {
			return;
		}

		let cancelled = false;
		void (async () => {
			const [estimate, persisted] = await Promise.all([
				getStorageEstimate(storageManager),
				isStoragePersisted(storageManager),
			]);
			if (!cancelled) {
				setStorageMetrics(estimate, persisted);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [open, setStorageMetrics, storageManager]);

	const handleRequestProtection = () => {
		if (requestingPersistence || storage.storageUnavailable) {
			return;
		}

		setRequestingPersistence(true);
		requestPersistentStorage(storageManager, (persisted) => {
			void (async () => {
				const estimate = await getStorageEstimate(storageManager);
				setStorageMetrics(estimate, persisted);
				if (mountedRef.current) {
					setRequestingPersistence(false);
				}
			})();
		});
	};

	const usageText = formatStorageUsage(storage.estimate);
	const versionLabel = getAppVersionLabel();
	const licenceTextsHref = `/${THIRD_PARTY_NOTICES_FILE}`;

	return (
		<div className="flex flex-col gap-5 text-sm">
			<section
				aria-labelledby="settings-appearance-heading"
				className="flex flex-col gap-2.5"
			>
				<h2
					id="settings-appearance-heading"
					className="text-[11px] leading-4 font-semibold tracking-wider text-muted-foreground uppercase"
				>
					Appearance
				</h2>
				<div className="flex flex-col gap-2">
					<span
						id="settings-theme-label"
						className="font-medium text-foreground"
					>
						Theme
					</span>
					<ToggleGroup
						type="single"
						variant="outline"
						size="sm"
						value={theme}
						aria-labelledby="settings-theme-label"
						className="w-full"
						onValueChange={(value) => {
							if (isThemePreference(value)) {
								void setTheme(value);
							}
						}}
					>
						{THEME_OPTIONS.map((option) => (
							<ToggleGroupItem
								key={option.value}
								value={option.value}
								className="flex-1 gap-1.5"
							>
								<ThemeOptionIcon theme={option.value} />
								<span>{option.label}</span>
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				</div>
			</section>

			<Separator />

			<section
				aria-labelledby="settings-storage-heading"
				className="flex flex-col gap-2.5"
			>
				<h2
					id="settings-storage-heading"
					className="text-[11px] leading-4 font-semibold tracking-wider text-muted-foreground uppercase"
				>
					Storage
				</h2>
				<p className="font-mono text-[13px] leading-[18px] text-foreground tabular-nums">
					{usageText}
				</p>
				{storage.storageUnavailable ? (
					<p
						role="status"
						className="rounded-md border border-border bg-secondary px-3 py-2 text-xs leading-4 text-foreground"
					>
						Storage unavailable: nothing will be saved after you close this tab.
					</p>
				) : null}
				<div className="flex flex-col gap-2">
					{storage.persisted ? (
						<div className="flex flex-wrap items-center gap-2">
							<Badge variant="secondary" className="gap-1">
								<ShieldCheckIcon
									className="size-3.5 text-success"
									aria-hidden="true"
								/>
								<span>Persistent</span>
							</Badge>
							<span className="text-foreground">
								Storage protection: Persistent
							</span>
						</div>
					) : (
						<>
							<p className="text-foreground">
								Storage protection: Best-effort (browser may clear data when
								space is low)
							</p>
							<div>
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={requestingPersistence || storage.storageUnavailable}
									aria-busy={requestingPersistence}
									onClick={handleRequestProtection}
								>
									{requestingPersistence
										? 'Requesting protection...'
										: 'Request protection'}
								</Button>
							</div>
						</>
					)}
				</div>
				<p className="text-xs leading-4 text-muted-foreground">
					Private Browsing windows clear all stored data when closed.
				</p>
			</section>

			{installPrompt ? (
				<>
					<Separator />
					<section
						aria-labelledby="settings-app-heading"
						className="flex flex-col gap-2.5"
					>
						<h2
							id="settings-app-heading"
							className="text-[11px] leading-4 font-semibold tracking-wider text-muted-foreground uppercase"
						>
							App
						</h2>
						<div>
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={installing}
								aria-busy={installing}
								onClick={() => {
									void promptInstall();
								}}
							>
								<DownloadIcon className="size-4" aria-hidden="true" />
								<span>{installing ? 'Installing...' : 'Install app'}</span>
							</Button>
						</div>
					</section>
				</>
			) : null}

			<Separator />

			<section
				aria-labelledby="settings-about-heading"
				className="flex flex-col gap-3"
			>
				<h2
					id="settings-about-heading"
					className="text-[11px] leading-4 font-semibold tracking-wider text-muted-foreground uppercase"
				>
					About
				</h2>
				<div className="flex items-baseline justify-between gap-2">
					<span className="font-medium text-foreground">Drift</span>
					<span className="font-mono text-[13px] leading-[18px] text-muted-foreground tabular-nums">
						{versionLabel}
					</span>
				</div>
				<p className="text-xs leading-4 text-muted-foreground">
					Pixel sorting lineage: inspired by Kim Asendorf&apos;s ASDFPixelSort.
				</p>

				<ul className="flex flex-col gap-1.5">
					{ABOUT_EXTERNAL_LINKS.map((link) => (
						<li key={link.href}>
							<a
								href={link.href}
								target="_blank"
								rel="noopener noreferrer"
								aria-label={link.accessibleName}
								className="inline-flex min-h-6 items-center gap-1.5 text-sm font-medium text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
							>
								<span>{link.label}</span>
								<ExternalLinkIcon
									className="size-3.5 shrink-0"
									aria-hidden="true"
								/>
							</a>
						</li>
					))}
				</ul>

				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between gap-2">
						<span className="text-foreground">
							Third-party notices ({THIRD_PARTY_NOTICES.length})
						</span>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							aria-expanded={noticesOpen}
							aria-controls="settings-third-party-notices"
							onClick={() => {
								setNoticesOpen((previous) => !previous);
							}}
						>
							{noticesOpen ? (
								<ChevronDownIcon className="size-4" aria-hidden="true" />
							) : (
								<ChevronRightIcon className="size-4" aria-hidden="true" />
							)}
							<span>{noticesOpen ? 'Hide notices' : 'View notices'}</span>
						</Button>
					</div>
					<a
						href={licenceTextsHref}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex min-h-6 items-center gap-1.5 self-start text-sm font-medium text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
					>
						<FileTextIcon className="size-3.5 shrink-0" aria-hidden="true" />
						<span>Full licence texts</span>
					</a>
					{noticesOpen ? (
						<ScrollArea
							id="settings-third-party-notices"
							orientation="both"
							tabStop={false}
							className="max-h-56 rounded-md border border-border bg-secondary"
						>
							<ul className="flex flex-col divide-y divide-border">
								{THIRD_PARTY_NOTICES.map((notice) => (
									<li
										key={notice.name}
										className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
									>
										<div className="flex min-w-0 flex-col">
											{notice.url ? (
												<a
													href={notice.url}
													target="_blank"
													rel="noopener noreferrer"
													className="inline-flex items-center gap-1 truncate font-medium text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
												>
													<span className="truncate">{notice.name}</span>
													<ExternalLinkIcon
														className="size-3 shrink-0"
														aria-hidden="true"
													/>
												</a>
											) : (
												<span className="truncate font-medium text-foreground">
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
					) : null}
				</div>

				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between gap-2">
						<span className="text-foreground">Changelog</span>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							aria-expanded={changelogOpen}
							aria-controls="settings-changelog"
							onClick={() => {
								setChangelogOpen((previous) => !previous);
							}}
						>
							{changelogOpen ? (
								<ChevronDownIcon className="size-4" aria-hidden="true" />
							) : (
								<ChevronRightIcon className="size-4" aria-hidden="true" />
							)}
							<span>{changelogOpen ? 'Hide changelog' : 'View changelog'}</span>
						</Button>
					</div>
					{changelogOpen ? (
						<ScrollArea
							id="settings-changelog"
							role="region"
							aria-label="Release notes"
							className="max-h-56 rounded-md border border-border bg-secondary"
						>
							<p className="px-3 py-2 text-xs leading-4 break-words whitespace-pre-wrap text-foreground">
								{CHANGELOG_TEXT}
							</p>
						</ScrollArea>
					) : null}
				</div>
			</section>
		</div>
	);
}
