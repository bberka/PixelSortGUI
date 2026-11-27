import {encodeMaskAsset} from '../../src/engine/mask/asset.ts';
import {maskGridSize} from '../../src/engine/mask/grid.ts';
import type {MaskBitmap} from '../../src/engine/mask/types.ts';
import type {MaskFile} from '../../src/worker/protocol.ts';
import {getMaskFixture} from '../fixtures/mask.ts';

// A painted asset as storage holds it, on the grid of a source of this size.
export async function paintedMask(
	sourceWidth: number,
	sourceHeight: number,
): Promise<{bitmap: MaskBitmap; file: MaskFile}> {
	const size = maskGridSize(sourceWidth, sourceHeight);
	const bitmap = getMaskFixture('shapes', size.width, size.height);
	const {sha256, width, height, compressed} = await encodeMaskAsset(bitmap);
	return {
		bitmap,
		file: {sha256, width, height, blob: new Blob([compressed])},
	};
}
