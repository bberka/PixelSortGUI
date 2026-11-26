import type {DownscaledSource} from './downscale.ts';
import {
	problemForCodecError,
	problemForRefusedFormat,
	type ImportProblem,
} from './import-problems.ts';
import {isSvgFile, rasterizeSvg} from './rasterize-svg.ts';
import {
	checkDimensionLimits,
	checkFileSizeLimit,
	inspectImageFormat,
	type CodecResult,
	type ImageDimensions,
} from '@/codec/decode.ts';

export type ImportProbe = (blob: Blob) => Promise<CodecResult<ImageDimensions>>;
export type ImportDownscale = (
	blob: Blob,
	width: number,
	height: number,
) => Promise<CodecResult<DownscaledSource>>;

export type LargeImageChoice = 'downscale' | 'keep' | 'cancel';

export type LargeImagePrompt = {
	readonly fileName: string;
	readonly width: number;
	readonly height: number;
};

// An image that passed every F1 rule, as it is to be stored.
export type ReadImage = {
	readonly blob: Blob;
	// Absent when the file has no type.
	readonly mimeType: string | undefined;
	readonly width: number;
	readonly height: number;
	// Only the first frame was read.
	readonly animated: boolean;
};

export type ReadImageSteps = {
	readonly probe: ImportProbe;
	readonly downscale: ImportDownscale;
	readonly askLargeImage: (
		prompt: LargeImagePrompt,
	) => Promise<LargeImageChoice>;
	// `undefined` while the user is being asked.
	readonly onStage: (stage: 'Checking' | 'Downscaling' | undefined) => void;
};

/**
 Reads one image file under the F1 rules: file size, format refusals, SVG
 rasterisation, decodability, pixel limits and the 50 MP choice. `null` when
 the user cancels that choice.
 */
export async function readImageFile(
	file: File,
	{probe, downscale, askLargeImage, onStage}: ReadImageSteps,
): Promise<ReadImage | ImportProblem | null> {
	const sizeError = checkFileSizeLimit(file.size);
	if (sizeError) {
		return problemForCodecError(file.name, sizeError);
	}

	onStage('Checking');
	const format = await inspectImageFormat(file, file.name);
	if (format.refused) {
		return problemForRefusedFormat(file.name, format.refused);
	}

	// The raster is already within the size limits, so it needs no probe.
	if (isSvgFile(file)) {
		const raster = await rasterizeSvg(file);
		return raster.ok
			? {
					blob: raster.value.blob,
					mimeType: raster.value.blob.type,
					width: raster.value.width,
					height: raster.value.height,
					animated: false,
				}
			: problemForCodecError(file.name, raster.error);
	}

	const probed = await probe(file);
	if (!probed.ok) {
		return problemForCodecError(file.name, probed.error);
	}

	const {width, height} = probed.value;
	const limits = checkDimensionLimits(width, height);
	if (limits.hardError) {
		return problemForCodecError(file.name, limits.hardError);
	}

	const original: ReadImage = {
		blob: file,
		mimeType: file.type || undefined,
		width,
		height,
		animated: format.animated,
	};
	if (!probed.value.exceedsGuaranteedArea) {
		return original;
	}

	onStage(undefined);
	const choice = await askLargeImage({fileName: file.name, width, height});
	if (choice !== 'downscale') {
		return choice === 'keep' ? original : null;
	}

	onStage('Downscaling');
	const scaled = await downscale(file, width, height);
	return scaled.ok
		? {
				...original,
				blob: scaled.value.blob,
				mimeType: scaled.value.blob.type,
				width: scaled.value.width,
				height: scaled.value.height,
			}
		: problemForCodecError(file.name, scaled.error);
}
