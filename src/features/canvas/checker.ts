/**
 Side of one checkerboard square in CSS px. The pattern is a 2×2 tile, so the
 squares stay this size at every zoom level and device pixel ratio.
 */
export const CHECKER_TILE_PX = 16;

/**
 Builds the transparency backdrop from two CSS colours. The caller keeps the
 pattern and hands it to the draw call, so the tile is built once per theme.
 */
export function createCheckerPattern(
	context: CanvasRenderingContext2D,
	first: string,
	second: string,
): CanvasPattern | null {
	const tile = document.createElement('canvas');
	tile.width = CHECKER_TILE_PX * 2;
	tile.height = CHECKER_TILE_PX * 2;
	const tileContext = tile.getContext('2d');
	if (!tileContext) {
		return null;
	}

	tileContext.fillStyle = second;
	tileContext.fillRect(0, 0, tile.width, tile.height);
	tileContext.fillStyle = first;
	tileContext.fillRect(0, 0, CHECKER_TILE_PX, CHECKER_TILE_PX);
	tileContext.fillRect(
		CHECKER_TILE_PX,
		CHECKER_TILE_PX,
		CHECKER_TILE_PX,
		CHECKER_TILE_PX,
	);
	return context.createPattern(tile, 'repeat');
}
