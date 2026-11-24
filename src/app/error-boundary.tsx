import {Component, type ReactNode} from 'react';
import {RotateCwIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';

export type ScreenErrorPanelProps = {
	readonly message: string;
	readonly onReload: () => void;
	readonly level?: 1 | 2;
};

/**
 Recoverable crash state: the shell, its banner and the app bar stay usable.
 */
export function ScreenErrorPanel({
	message,
	onReload,
	level = 2,
}: ScreenErrorPanelProps) {
	return (
		<div className="flex min-h-0 flex-1 items-center justify-center p-6">
			<div className="flex w-full max-w-[48ch] flex-col items-start gap-3 rounded-lg border border-border bg-card p-6">
				{level === 1 ? (
					<h1 className="text-lg leading-6 font-semibold">
						This screen stopped working
					</h1>
				) : (
					<h2 className="text-lg leading-6 font-semibold">
						This screen stopped working
					</h2>
				)}
				<p className="text-sm text-muted-foreground">
					Reload to start it again. Work saved before the crash is kept.
				</p>
				<code className="max-w-full overflow-hidden font-mono text-xs break-words text-muted-foreground">
					{message}
				</code>
				<Button type="button" onClick={onReload}>
					<RotateCwIcon aria-hidden="true" />
					Reload
				</Button>
			</div>
		</div>
	);
}

type ScreenErrorBoundaryState = {
	readonly error: Error | null;
};

export type ScreenErrorBoundaryProps = {
	readonly children: ReactNode;
	readonly onReload?: () => void;
};

/**
 One boundary per screen. The route host mounts a fresh boundary when the
 route changes, so navigating away from a crashed screen recovers.
 */
export class ScreenErrorBoundary extends Component<
	ScreenErrorBoundaryProps,
	ScreenErrorBoundaryState
> {
	static getDerivedStateFromError(error: Error): ScreenErrorBoundaryState {
		return {error};
	}

	override state: ScreenErrorBoundaryState = {error: null};

	override render() {
		const {error} = this.state;
		if (!error) {
			return this.props.children;
		}

		return (
			<ScreenErrorPanel
				message={error.message}
				onReload={
					this.props.onReload ??
					(() => {
						globalThis.location.reload();
					})
				}
			/>
		);
	}
}
