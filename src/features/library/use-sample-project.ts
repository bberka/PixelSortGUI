import {useRef, useState} from 'react';
import {toast} from 'sonner';
import {nextTask} from './next-task.ts';
import {createSampleBlob, SAMPLE_HEIGHT, SAMPLE_WIDTH} from './sample-image.ts';
import type {ShowcaseTile} from './showcase.ts';
import {announce} from '@/app/announcer.ts';
import {useAppStore} from '@/app/runtime-context.tsx';
import {LANDING} from '@/features/guide/content.ts';
import {isQuotaExceededError} from '@/storage/types.ts';

export type SampleProject = {
	readonly busy: boolean;
	/**
	 Creates and opens a "Sample" project, with `tile`'s effects applied when one
	 is given.
	 */
	create(tile?: ShowcaseTile): void;
};

export function useSampleProject(
	makeBlob: () => Promise<Blob> = createSampleBlob,
): SampleProject {
	const importImage = useAppStore((state) => state.importImage);
	const applyStack = useAppStore((state) => state.applyStack);
	const [busy, setBusy] = useState(false);
	// `busy` is stale between two activations in one frame.
	const busyRef = useRef(false);

	const run = async (tile?: ShowcaseTile) => {
		// Drawing the sample blocks the main thread, so paint the busy state first.
		await nextTask();
		await importImage({
			name: LANDING.sampleProjectName,
			blob: await makeBlob(),
			width: SAMPLE_WIDTH,
			height: SAMPLE_HEIGHT,
		});
		if (tile) {
			await applyStack(tile.stack, `Apply preset ${tile.name}`);
		}

		announce(LANDING.sampleCreated);
	};

	return {
		busy,
		create(tile) {
			if (busyRef.current) {
				return;
			}

			busyRef.current = true;
			setBusy(true);
			void (async () => {
				try {
					await run(tile);
				} catch (error) {
					// A full disk has its own dialog.
					if (!isQuotaExceededError(error)) {
						toast.error(LANDING.sampleFailed);
					}
				} finally {
					busyRef.current = false;
					setBusy(false);
				}
			})();
		},
	};
}
