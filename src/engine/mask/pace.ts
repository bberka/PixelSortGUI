import type {Pace} from '../blur.ts';

const CHECKPOINT_PIXELS = 16_384;

// Calls `checkpoint` so that no more than 16,384 reported pixels pass between two calls.
export function createPacer(checkpoint: () => void | Promise<void>): Pace {
	let since = 0;
	return (pixels) => {
		if (since > 0 && since + pixels > CHECKPOINT_PIXELS) {
			since = pixels;
			return checkpoint();
		}

		since += pixels;
	};
}
