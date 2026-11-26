import type {EffectDefinition, ParamSpecs} from '../types.ts';

export type BlockShuffleParams = {
	tileSize: number;
	amount: number;
	seed: number;
};

export const blockShuffleParamSpecs: ParamSpecs<BlockShuffleParams> = {
	tileSize: {
		kind: 'integer',
		label: 'Tile size',
		group: 'Tiles',
		min: 4,
		max: 1024,
		default: 64,
		unit: 'px',
	},
	amount: {
		kind: 'number',
		label: 'Shuffle amount',
		group: 'Tiles',
		min: 0,
		max: 1,
		step: 0.01,
		default: 0.15,
		unit: 'ratio',
	},
	seed: {kind: 'seed', label: 'Seed', group: 'Seed'},
};

export const blockShuffleSpec: Omit<
	EffectDefinition<BlockShuffleParams>,
	'render'
> = {
	type: 'blockShuffle',
	version: 1,
	label: 'Block shuffle',
	description: 'Swap square tiles around the image.',
	category: 'glitch',
	params: blockShuffleParamSpecs,
};
