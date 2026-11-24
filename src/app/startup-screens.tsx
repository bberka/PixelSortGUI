import type {ReactNode} from 'react';
import {RotateCwIcon} from 'lucide-react';
import {AppBarFrame} from './app-bar.tsx';
import {ScreenErrorPanel} from './error-boundary.tsx';
import {PendingIndicator} from './pending.tsx';
import {Button} from '@/components/ui/button';

export function StartingScreen() {
	return (
		<div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
			<AppBarFrame>
				<h1 className="text-lg leading-6 font-semibold">PixelSortGUI</h1>
			</AppBarFrame>
			<PendingIndicator label="Starting PixelSortGUI" />
		</div>
	);
}

function BlockingCard({children}: {readonly children: ReactNode}) {
	return (
		<div className="flex h-dvh items-center justify-center bg-background p-6 text-foreground">
			<div className="flex w-full max-w-[46ch] flex-col items-start gap-3 rounded-lg border border-border bg-card p-6">
				{children}
			</div>
		</div>
	);
}

export function SecureContextScreen() {
	return (
		<BlockingCard>
			<h1 className="text-lg leading-6 font-semibold">
				Secure connection required
			</h1>
			<p className="text-sm text-muted-foreground">
				Open PixelSortGUI over HTTPS or http://localhost so browser storage and
				offline features can work.
			</p>
		</BlockingCard>
	);
}

export function VersionErrorScreen({message}: {readonly message: string}) {
	return (
		<BlockingCard>
			<h1 className="text-lg leading-6 font-semibold">Update required</h1>
			<p className="text-sm text-muted-foreground">
				This browser's stored data was written by a newer version of
				PixelSortGUI. Reload to run the newest version.
			</p>
			<code className="max-w-full overflow-hidden font-mono text-xs break-words text-muted-foreground">
				{message}
			</code>
			<Button
				type="button"
				onClick={() => {
					globalThis.location.reload();
				}}
			>
				<RotateCwIcon aria-hidden="true" />
				Reload
			</Button>
		</BlockingCard>
	);
}

export function StartupFailureScreen({message}: {readonly message: string}) {
	return (
		<div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
			<ScreenErrorPanel
				level={1}
				message={message}
				onReload={() => {
					globalThis.location.reload();
				}}
			/>
		</div>
	);
}
