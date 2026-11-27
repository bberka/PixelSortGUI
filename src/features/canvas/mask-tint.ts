/**
 The mask as pixels of the overlay colour, the mask value as their alpha. The
 brush tints a patch for every move, so each pixel is one 32-bit write, in the
 little-endian byte order of every platform a browser runs on.
 */
export function tintMask(
	mask: Uint8Array,
	width: number,
	height: number,
): ImageData {
	const [red = 0, green = 0, blue = 0] = globalThis
		.getComputedStyle(globalThis.document.documentElement)
		.getPropertyValue('--mask-overlay')
		.trim()
		.split(/\s+/)
		.map(Number);
	const image = new ImageData(width, height);
	const pixels = new Uint32Array(
		image.data.buffer,
		image.data.byteOffset,
		mask.length,
	);
	const colour = red + green * 0x1_00 + blue * 0x1_00_00;
	// An indexed loop: an iterator is several times slower over 4 million pixels.
	// eslint-disable-next-line unicorn/no-for-loop
	for (let index = 0; index < mask.length; index++) {
		pixels[index] = colour + mask[index] * 0x1_00_00_00;
	}

	return image;
}
