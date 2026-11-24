import {useEffect, useState} from 'react';
import type {AppRuntime} from '@/state/index.ts';
import type {RestoreResult} from '@/storage/restore.ts';

export type ReadyRestore = Extract<RestoreResult, {status: 'ready'}>;

export type AppBoot =
	| {readonly status: 'starting'}
	| {readonly status: 'insecure-context'}
	| {readonly status: 'version-error'; readonly message: string}
	| {readonly status: 'failed'; readonly message: string}
	| {readonly status: 'ready'; readonly result: ReadyRestore};

function toBoot(result: RestoreResult): AppBoot {
	switch (result.status) {
		case 'ready': {
			return {status: 'ready', result};
		}

		case 'insecure-context': {
			return {status: 'insecure-context'};
		}

		case 'version-error': {
			return {status: 'version-error', message: result.message};
		}
	}
}

/**
 Holds the screen on the starting state until restore finishes, so an empty
 library never flashes before the stored projects arrive.
 */
export function useAppBoot(runtime: AppRuntime): AppBoot {
	const [boot, setBoot] = useState<AppBoot>({status: 'starting'});

	useEffect(() => {
		let active = true;
		void runtime.ready.then(
			(result) => {
				if (active) {
					setBoot(toBoot(result));
				}
			},
			(error: unknown) => {
				if (active) {
					setBoot({
						status: 'failed',
						message: error instanceof Error ? error.message : String(error),
					});
				}
			},
		);

		return () => {
			active = false;
		};
	}, [runtime]);

	return boot;
}
