import {
	GUARANTEED_MAX_PIXELS,
	isMemoryError,
	MAX_LONGEST_SIDE,
	type CodecError,
	type CodecResult,
} from '@/codec/decode.ts';

/**
 The longest side of an SVG that states no pixel size (engine.md section 16.4).
 */
export const SVG_DEFAULT_LONGEST_SIDE = 2048;

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const DEFAULT_VIEWPORT = {width: 300, height: 150};
const PIXELS_PER_UNIT: Record<string, number> = {
	'': 1,
	px: 1,
	pt: 96 / 72,
	pc: 16,
	in: 96,
	cm: 96 / 2.54,
	mm: 96 / 25.4,
	q: 96 / 101.6,
};

export type RasterizedSvg = {
	readonly blob: Blob;
	readonly width: number;
	readonly height: number;
};

export type SvgRootAttributes = {
	readonly width: string | null;
	readonly height: string | null;
	readonly viewBox: string | null;
};

export type SvgSize = {
	readonly width: number;
	readonly height: number;
	/**
	The `viewBox` that makes the drawing scale to `width` × `height`.
	*/
	readonly viewBox: string;
};

export function isSvgFile(file: File): boolean {
	return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
}

/**
 A root `width` or `height` in pixels. Relative units (`%`, `em`) and anything
 else that gives no pixel size are `undefined`.
 */
function absoluteLength(value: string | null): number | undefined {
	const match = /^(\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([a-z]*)$/i.exec(
		value?.trim() ?? '',
	);
	if (!match) {
		return undefined;
	}

	const pixels = Number(match[1]) * PIXELS_PER_UNIT[match[2].toLowerCase()];
	return Number.isFinite(pixels) && pixels > 0 ? pixels : undefined;
}

function viewBoxSize(
	value: string | null,
): {width: number; height: number} | undefined {
	const parts = (value?.trim() ?? '').split(/[\s,]+/).map(Number);
	const [, , width, height] = parts;
	return parts.length === 4 &&
		parts.every((part) => Number.isFinite(part)) &&
		width > 0 &&
		height > 0
		? {width, height}
		: undefined;
}

/**
 The pixel size an SVG is rasterised at (engine.md section 16.4): its stated
 size, or its `viewBox` at a longest side of 2,048 px, scaled down to fit
 16,384 px per side and 50 MP.
 */
export function svgRasterSize(root: SvgRootAttributes): SvgSize {
	const statedWidth = absoluteLength(root.width);
	const statedHeight = absoluteLength(root.height);
	const box = viewBoxSize(root.viewBox);
	let width = statedWidth;
	let height = statedHeight;

	if (box) {
		width ??= statedHeight && (statedHeight * box.width) / box.height;
		height ??= statedWidth && (statedWidth * box.height) / box.width;
	}

	const intrinsic = box ?? {
		width: statedWidth ?? DEFAULT_VIEWPORT.width,
		height: statedHeight ?? DEFAULT_VIEWPORT.height,
	};
	if (width === undefined && height === undefined) {
		const scale =
			SVG_DEFAULT_LONGEST_SIDE / Math.max(intrinsic.width, intrinsic.height);
		width = intrinsic.width * scale;
		height = intrinsic.height * scale;
	}

	width = Math.max(1, Math.round(width ?? intrinsic.width));
	height = Math.max(1, Math.round(height ?? intrinsic.height));

	const fit = Math.min(
		1,
		MAX_LONGEST_SIDE / Math.max(width, height),
		Math.sqrt(GUARANTEED_MAX_PIXELS / (width * height)),
	);

	return {
		width: Math.max(1, Math.floor(width * fit)),
		height: Math.max(1, Math.floor(height * fit)),
		viewBox:
			box && root.viewBox
				? root.viewBox
				: `0 0 ${intrinsic.width} ${intrinsic.height}`,
	};
}

/**
 XML may be UTF-16 (with a byte order mark) or name its own encoding.
 */
async function readXmlText(blob: Blob): Promise<string> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let encoding = /^<\?xml[^>]*\sencoding=["']([\w\-.]+)["']/.exec(
		String.fromCodePoint(...bytes.subarray(0, 200)),
	)?.[1];
	if (bytes[0] === 0xff && bytes[1] === 0xfe) {
		encoding = 'utf-16le';
	} else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
		encoding = 'utf-16be';
	}

	return new TextDecoder(encoding ?? 'utf8').decode(bytes);
}

/**
 The SVG as a standalone document that draws at exactly its raster size.
 */
function sizeSvg(text: string): {markup: string; size: SvgSize} {
	// A parsed document is inert: it runs no script and loads nothing.
	const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
	const root = parsed.documentElement;
	if (
		root.namespaceURI !== SVG_NAMESPACE ||
		root.localName !== 'svg' ||
		parsed.querySelector('parsererror')
	) {
		throw new Error('Not a well-formed SVG document');
	}

	const size = svgRasterSize({
		width: root.getAttribute('width'),
		height: root.getAttribute('height'),
		viewBox: root.getAttribute('viewBox'),
	});
	root.setAttribute('width', String(size.width));
	root.setAttribute('height', String(size.height));
	if (root.getAttribute('viewBox') !== size.viewBox) {
		// Stretch the added viewBox, so rounding the size leaves no empty edge.
		root.setAttribute('preserveAspectRatio', 'none');
		root.setAttribute('viewBox', size.viewBox);
	}

	// A CSS size on the root would override the attributes just set.
	const {style} = root as unknown as SVGSVGElement;
	style.removeProperty('width');
	style.removeProperty('height');

	return {markup: new XMLSerializer().serializeToString(root), size};
}

async function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.addEventListener('load', () => {
			resolve(image);
		});
		image.addEventListener('error', () => {
			reject(new Error('The browser could not render the SVG'));
		});
		image.src = url;
	});
}

async function encodePng(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) {
				resolve(blob);
			} else {
				reject(new Error('Out of memory while encoding the PNG'));
			}
		}, 'image/png');
	});
}

function makeSvgError(error: unknown): CodecError {
	return isMemoryError(error)
		? {
				code: 'out-of-memory',
				message: 'Not enough memory to rasterise this SVG.',
				cause: error,
			}
		: {
				code: 'decode-failed',
				message: 'The browser could not decode this image file.',
				cause: error,
			};
}

/**
 Turns an SVG file into the PNG stored as the project's source. It runs on the
 main thread because workers cannot decode SVG. The file only ever reaches the
 browser as an `<img>` source, where scripts do not run and external resources
 are not fetched; keep it that way (product.md F21, AC-F21.2).
 */
export async function rasterizeSvg(
	file: Blob,
): Promise<CodecResult<RasterizedSvg>> {
	let canvas: HTMLCanvasElement | undefined;
	try {
		const {markup, size} = sizeSvg(await readXmlText(file));
		// A data URL, because Chromium taints the canvas for a blob URL SVG that
		// holds a `foreignObject`, and the PNG could not be read back.
		const image = await loadImage(
			`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`,
		);

		canvas = document.createElement('canvas');
		canvas.width = size.width;
		canvas.height = size.height;
		const context = canvas.getContext('2d', {colorSpace: 'srgb'});
		if (!context) {
			return {
				ok: false,
				error: {
					code: 'out-of-memory',
					message: 'Failed to allocate a 2D canvas context for the SVG.',
				},
			};
		}

		context.drawImage(image, 0, 0, size.width, size.height);
		return {
			ok: true,
			value: {
				blob: await encodePng(canvas),
				width: size.width,
				height: size.height,
			},
		};
	} catch (error) {
		return {ok: false, error: makeSvgError(error)};
	} finally {
		if (canvas) {
			canvas.width = 1;
			canvas.height = 1;
		}
	}
}
