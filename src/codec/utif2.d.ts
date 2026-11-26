/**
 The part of `utif2` this app calls. The package's own declarations pull Node
 types into the browser build, so `tsconfig/base.json` points here instead.
 */

/**
One image file directory: tag values are keyed `t<tag number>`.
*/
export type Ifd = {
	[tag: string]: ArrayLike<number> | ArrayLike<string> | number | undefined;
	width: number;
	height: number;
};

export function decode(buffer: ArrayBuffer): Ifd[];
export function decodeImage(buffer: ArrayBuffer, ifd: Ifd): void;
// eslint-disable-next-line @typescript-eslint/naming-convention -- the library's name
export function toRGBA8(ifd: Ifd): Uint8Array;
export function encodeImage(
	rgba: Uint8Array,
	width: number,
	height: number,
	tags?: Record<string, ArrayLike<number> | ArrayLike<string>>,
): ArrayBuffer;
