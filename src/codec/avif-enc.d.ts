/**
 The part of the `@jsquash/avif` encoder module this app calls. The package's
 own declarations rely on a global Emscripten namespace it does not declare, so
 `tsconfig/base.json` points here instead.
 */

export type EncoderModuleOptions = {
	// The compiled encoder, for runtimes that cannot fetch it by URL.
	wasmBinary?: ArrayBuffer | Uint8Array;
};

export type EncoderModule = {
	encode(
		data: Uint8Array,
		width: number,
		height: number,
		options: Readonly<Record<string, number | boolean>>,
	): Uint8Array<ArrayBuffer> | null;
};

export default function createEncoderModule(
	options?: EncoderModuleOptions,
): Promise<EncoderModule>;
