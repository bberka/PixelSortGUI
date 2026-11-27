import {
	assertGridSize,
	checkedMaskBitmap,
	MASK_HEADER_BYTES,
	MaskAssetError,
} from '../engine/mask/asset.ts';
import type {MaskBitmap} from '../engine/mask/types.ts';
import type {MaskFile} from './protocol.ts';

/**
 Decompresses and verifies a painted mask asset (engine.md section 16.6),
 stopping as soon as the output passes the size its grid allows. Rejects with
 `MaskAssetError` for data that is not that mask.
 */
export async function decodeMaskFile(file: MaskFile): Promise<MaskBitmap> {
	assertGridSize(file.width, file.height);
	const length = MASK_HEADER_BYTES + file.width * file.height;
	const bytes = new Uint8Array(length);
	let size = 0;
	try {
		const reader = file.blob
			.stream()
			.pipeThrough(new DecompressionStream('deflate-raw'))
			.getReader();
		for (;;) {
			const {done, value} = await reader.read();
			if (done) {
				break;
			}

			if (size + value.length > length) {
				await reader.cancel();
				throw new MaskAssetError(`Mask data is longer than ${length} bytes`);
			}

			bytes.set(value, size);
			size += value.length;
		}
	} catch (error) {
		if (error instanceof MaskAssetError) {
			throw error;
		}

		throw new MaskAssetError('Mask data cannot be decompressed', {
			cause: error,
		});
	}

	return checkedMaskBitmap(bytes.subarray(0, size), file);
}
