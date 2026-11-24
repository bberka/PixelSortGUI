export type ProofViewport = {
	readonly name: 'phone' | 'tablet' | 'desktop';
	readonly width: number;
	readonly height: number;
};

export const PROOF_VIEWPORTS: readonly ProofViewport[] = [
	{name: 'phone', width: 390, height: 844},
	{name: 'tablet', width: 820, height: 1180},
	{name: 'desktop', width: 1440, height: 900},
];

export const DESKTOP_VIEWPORT: ProofViewport = PROOF_VIEWPORTS[2];
