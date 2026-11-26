import {useEffect, useRef, useState} from 'react';
import type {LargeImageChoice, LargeImagePrompt} from './read-image-file.ts';

/**
 The pending 50 MP choice of one import flow. Unmounting answers `cancel`.
 */
export function useLargeImagePrompt(): {
	readonly prompt: LargeImagePrompt | null;
	readonly ask: (prompt: LargeImagePrompt) => Promise<LargeImageChoice>;
	readonly decide: (choice: LargeImageChoice) => void;
} {
	const [prompt, setPrompt] = useState<LargeImagePrompt | null>(null);
	const aliveRef = useRef(true);
	const decisionRef = useRef<((choice: LargeImageChoice) => void) | null>(null);

	useEffect(() => {
		aliveRef.current = true;
		return () => {
			aliveRef.current = false;
			decisionRef.current?.('cancel');
			decisionRef.current = null;
		};
	}, []);

	return {
		prompt,
		ask: async (next) =>
			new Promise<LargeImageChoice>((resolve) => {
				decisionRef.current = resolve;
				if (aliveRef.current) {
					setPrompt(next);
				}
			}),
		decide(choice) {
			const resolve = decisionRef.current;
			decisionRef.current = null;
			if (aliveRef.current) {
				setPrompt(null);
			}

			resolve?.(choice);
		},
	};
}
