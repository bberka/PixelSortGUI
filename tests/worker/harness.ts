// Runs a real worker script in Node. Only the browser image APIs are faked: a
// "decode" returns the given pixels, box downscaled when a smaller size is asked.
import {Buffer} from 'node:buffer';
import {vi} from 'vite-plus/test';
import {boxDownscale} from '../../src/engine/resample.ts';
import {
	copyImage,
	createImage,
	type RgbaImage,
} from '../../src/engine/types.ts';

export type FakeBitmap = RgbaImage & {close(): void};

export type Size = {width: number; height: number};

// Distinct colours per pixel position, so a wrong crop or orientation shows.
export function patternImage(width: number, height: number): RgbaImage {
	const image = createImage(width, height);
	const {data} = image;
	for (let y = 0, o = 0; y < height; y++) {
		for (let x = 0; x < width; x++, o += 4) {
			data[o] = (x * 7 + y) % 256;
			data[o + 1] = (y * 11 + x * 3) % 256;
			data[o + 2] = (x * y + 5) % 256;
			data[o + 3] = 255;
		}
	}

	return image;
}

// Same size and bytes. Far faster than a deep equality on millions of pixels.
export function sameImage(actual: RgbaImage, expected: RgbaImage): boolean {
	return (
		actual.width === expected.width &&
		actual.height === expected.height &&
		Buffer.from(actual.data).equals(Uint8Array.from(expected.data))
	);
}

class FakeImageData {
	constructor(
		readonly data: Uint8ClampedArray,
		readonly width: number,
		readonly height: number,
	) {}
}

function bitmapOf({width, height, data}: RgbaImage): FakeBitmap {
	return {width, height, data, close() {}};
}

function region(
	image: RgbaImage,
	x: number,
	y: number,
	width: number,
	height: number,
): RgbaImage {
	const out = createImage(width, height);
	for (let row = 0; row < height; row++) {
		const from = ((y + row) * image.width + x) * 4;
		out.data.set(image.data.subarray(from, from + width * 4), row * width * 4);
	}

	return out;
}

export async function startWorker<Request, Response>(
	load: () => Promise<unknown>,
	source: RgbaImage,
) {
	const posted: Response[] = [];
	// The size each decode of the file asked for; `undefined` is a full decode.
	const decodes: Array<Size | undefined> = [];
	// The pixels each encode received.
	const encoded: RgbaImage[] = [];
	let listener: ((event: {data: Request}) => void) | undefined;

	class FakeCanvas {
		private drawn: RgbaImage | undefined;

		constructor(
			public width: number,
			public height: number,
		) {}

		getContext() {
			return {
				drawImage: (bitmap: RgbaImage) => {
					this.drawn = bitmap;
				},
				getImageData: () => copyImage(this.drawn!),
				putImageData: (data: RgbaImage) => {
					this.drawn = copyImage(data);
					encoded.push(this.drawn);
				},
			};
		}

		async convertToBlob({type}: {type: string}) {
			return new Blob(['file'], {type});
		}
	}

	vi.resetModules();
	vi.stubGlobal(
		'addEventListener',
		(_type: string, added: (event: {data: Request}) => void) => {
			listener = added;
		},
	);
	vi.stubGlobal('postMessage', (message: Response) => {
		posted.push(message);
	});
	vi.stubGlobal('ImageData', FakeImageData);
	vi.stubGlobal('OffscreenCanvas', FakeCanvas);
	vi.stubGlobal(
		'createImageBitmap',
		async (
			input: Blob | RgbaImage,
			...rest: [{resizeWidth?: number; resizeHeight?: number}?] | number[]
		) => {
			if (!(input instanceof Blob)) {
				const [x, y, width, height] = rest as number[];
				return bitmapOf(
					x === undefined
						? copyImage(input)
						: region(input, x, y, width, height),
				);
			}

			const options = rest[0] as
				{resizeWidth?: number; resizeHeight?: number} | undefined;
			const size = options?.resizeWidth
				? {width: options.resizeWidth, height: options.resizeHeight!}
				: undefined;
			decodes.push(size);
			return bitmapOf(
				size
					? boxDownscale(source, size.width, size.height)
					: copyImage(source),
			);
		},
	);
	await load();

	const send = (message: Request) => {
		listener!({data: message});
	};

	// The first posted message from `from` on that `matches`.
	const next = async <T extends Response>(
		matches: (message: Response) => message is T,
		from = 0,
	): Promise<T> =>
		vi.waitFor(
			() => {
				const found = posted.slice(from).find((item) => matches(item));
				if (!found) {
					throw new Error(`No matching message in ${JSON.stringify(posted)}`);
				}

				return found;
			},
			{timeout: 20_000, interval: 5},
		);

	return {send, next, posted, decodes, encoded};
}
