/**
 AVIF encoding through the single-threaded Wasm build of `@jsquash/avif`
 (libavif and libaom). Only the export worker imports this module, on first
 use. The package's own `encode` entry is not used: it also pulls in the
 multi-threaded build, which needs cross-origin isolation.
 */
import createEncoderModule, {
	type EncoderModule,
	type EncoderModuleOptions,
} from '@jsquash/avif/codec/enc/avif_enc.js';
import {defaultOptions} from '@jsquash/avif/meta.js';
import type {AvifEncoder} from './encode.ts';

// The libaom speed, from 0 (slowest) to 10. Speed 8 takes about a third of the
// default 6's time for nearly the same size and error (engine.md section 16.4).
const ENCODER_SPEED = 8;

export function createAvifEncoder(
	moduleOptions: EncoderModuleOptions = {},
): AvifEncoder {
	let loading: Promise<EncoderModule> | undefined;
	return async ({data, width, height}, quality) => {
		loading ??= createEncoderModule(moduleOptions);
		const encoder = await loading;
		const output = encoder.encode(
			new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
			width,
			height,
			{...defaultOptions, quality, speed: ENCODER_SPEED},
		);
		if (!output) {
			throw new Error('The AVIF encoder produced no output.');
		}

		return output;
	};
}

export const encodeAvif = createAvifEncoder();
