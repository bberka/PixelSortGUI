import {describe, expect, it} from 'vite-plus/test';
import {
	containRegion,
	drawCanvas,
	type CanvasSurface,
	type FrameImage,
} from './draw.ts';
import type {CanvasView} from './view.ts';

type DrawCall = {
	bitmap: unknown;
	source: [number, number, number, number];
	destination: [number, number, number, number];
};

type Recorder = {
	surface: CanvasSurface;
	calls: string[];
	draws: DrawCall[];
	clips: Array<[number, number, number, number]>;
	transform: number[] | null;
};

function record(): Recorder {
	const recorder: Recorder = {
		calls: [],
		draws: [],
		clips: [],
		transform: null,
		surface: {
			imageSmoothingEnabled: true,
			globalAlpha: 1,
			fillStyle: '',
			setTransform(a, b, c, d, e, f) {
				recorder.transform = [a, b, c, d, e, f];
			},
			clearRect(x, y, width, height) {
				recorder.calls.push(`clearRect(${x},${y},${width},${height})`);
			},
			fillRect(x, y, width, height) {
				recorder.calls.push(`fillRect(${x},${y},${width},${height})`);
			},
			save() {
				recorder.calls.push('save');
			},
			restore() {
				recorder.calls.push('restore');
			},
			beginPath() {
				recorder.calls.push('beginPath');
			},
			rect(x, y, width, height) {
				recorder.calls.push(`rect(${x},${y},${width},${height})`);
				recorder.clips.push([x, y, width, height]);
			},
			clip() {
				recorder.calls.push('clip');
			},
			drawImage(bitmap, sx, sy, sw, sh, dx, dy, dw, dh) {
				recorder.calls.push('drawImage');
				recorder.draws.push({
					bitmap,
					source: [sx, sy, sw, sh],
					destination: [dx, dy, dw, dh],
				});
			},
		},
	};
	return recorder;
}

function image(width: number, height: number): FrameImage {
	return {
		bitmap: {width, height} as unknown as CanvasImageSource,
		width,
		height,
	};
}

function view(zoom: number, centerX: number, centerY: number): CanvasView {
	return {zoom, centerX, centerY, fitMode: 'custom'};
}

const CHECKER = 'checker-pattern' as unknown as CanvasPattern;

describe('canvas drawing', () => {
	it('clears and draws nothing while there is no frame and no source', () => {
		const recorder = record();
		drawCanvas({
			surface: recorder.surface,
			viewport: {width: 800, height: 600},
			view: null,
			source: null,
			frame: null,
			tiles: null,
			checker: CHECKER,
			dpr: 1,
		});

		expect(recorder.calls).toEqual(['clearRect(0,0,800,600)']);
		expect(recorder.draws).toEqual([]);
	});

	it('draws in CSS px behind a device pixel ratio transform', () => {
		const recorder = record();
		drawCanvas({
			surface: recorder.surface,
			viewport: {width: 400, height: 300},
			view: view(1, 50, 50),
			source: {width: 100, height: 100},
			frame: image(100, 100),
			tiles: null,
			checker: null,
			dpr: 2,
		});

		expect(recorder.transform).toEqual([2, 0, 0, 2, 0, 0]);
		expect(recorder.calls[0]).toBe('clearRect(0,0,400,300)');
		expect(recorder.draws[0]?.destination).toEqual([150, 100, 100, 100]);
	});

	it('fills the image rectangle with the transparency checkerboard under the frame', () => {
		const recorder = record();
		drawCanvas({
			surface: recorder.surface,
			viewport: {width: 200, height: 150},
			view: view(1, 200, 150),
			source: {width: 400, height: 300},
			frame: image(400, 300),
			tiles: null,
			checker: CHECKER,
			dpr: 1,
		});

		expect(recorder.calls).toEqual([
			'clearRect(0,0,200,150)',
			'fillRect(0,0,200,150)',
			'drawImage',
		]);
		expect(recorder.surface.fillStyle).toBe(CHECKER);
	});

	it('keeps smoothing at 200% and turns it off above 200% (DESIGN.md section 7)', () => {
		const atTwoHundred = record();
		drawCanvas({
			surface: atTwoHundred.surface,
			viewport: {width: 200, height: 150},
			view: view(2, 50, 50),
			source: {width: 100, height: 100},
			frame: image(100, 100),
			tiles: null,
			checker: null,
			dpr: 1,
		});
		expect(atTwoHundred.surface.imageSmoothingEnabled).toBe(true);

		const above = record();
		drawCanvas({
			surface: above.surface,
			viewport: {width: 200, height: 150},
			view: view(2.01, 50, 50),
			source: {width: 100, height: 100},
			frame: image(100, 100),
			tiles: null,
			checker: null,
			dpr: 1,
		});
		expect(above.surface.imageSmoothingEnabled).toBe(false);
	});

	it('draws only the visible part of the frame, snapped to whole image pixels', () => {
		const recorder = record();
		drawCanvas({
			surface: recorder.surface,
			viewport: {width: 200, height: 150},
			view: view(1, 200, 150),
			source: {width: 400, height: 300},
			frame: image(400, 300),
			tiles: null,
			checker: null,
			dpr: 1,
		});

		expect(recorder.draws).toHaveLength(1);
		expect(recorder.draws[0]?.source).toEqual([100, 75, 200, 150]);
		expect(recorder.draws[0]?.destination).toEqual([0, 0, 200, 150]);
	});

	it('scales a proxy frame to the source size', () => {
		const recorder = record();
		drawCanvas({
			surface: recorder.surface,
			viewport: {width: 400, height: 300},
			view: view(0.5, 200, 150),
			source: {width: 400, height: 300},
			frame: image(200, 150),
			tiles: null,
			checker: null,
			dpr: 1,
		});

		expect(recorder.draws[0]?.source).toEqual([0, 0, 200, 150]);
		expect(recorder.draws[0]?.destination).toEqual([100, 75, 200, 150]);
	});

	it('draws full-resolution tiles over the frame at their source offset', () => {
		const recorder = record();
		drawCanvas({
			surface: recorder.surface,
			viewport: {width: 400, height: 100},
			view: view(1, 1000, 50),
			source: {width: 2000, height: 100},
			frame: image(500, 25),
			tiles: [
				{x: 0, y: 0, ...image(1000, 100)},
				{x: 1000, y: 0, ...image(1000, 100)},
			],
			checker: null,
			dpr: 1,
		});

		expect(recorder.draws.map((call) => call.destination)).toEqual([
			[0, 0, 400, 100],
			[0, 0, 200, 100],
			[200, 0, 200, 100],
		]);
		expect(recorder.draws[1]?.source).toEqual([800, 0, 200, 100]);
	});

	it('draws nothing when the image is outside the viewport', () => {
		const recorder = record();
		drawCanvas({
			surface: recorder.surface,
			viewport: {width: 200, height: 150},
			view: view(1, -2000, 150),
			source: {width: 400, height: 300},
			frame: image(400, 300),
			tiles: [{x: 0, y: 0, ...image(400, 300)}],
			checker: CHECKER,
			dpr: 1,
		});

		expect(recorder.calls).toEqual(['clearRect(0,0,200,150)']);
		expect(recorder.draws).toEqual([]);
	});

	it('draws only the original bitmap in compare original mode', () => {
		const recorder = record();
		const original = image(400, 300);
		const edited = image(400, 300);
		drawCanvas({
			surface: recorder.surface,
			viewport: {width: 400, height: 300},
			view: view(1, 200, 150),
			source: {width: 400, height: 300},
			original,
			frame: edited,
			tiles: [{x: 0, y: 0, ...image(400, 300)}],
			compare: {mode: 'original'},
			checker: null,
			dpr: 1,
		});

		expect(recorder.draws).toHaveLength(1);
		expect(recorder.draws[0]?.bitmap).toBe(original.bitmap);
		expect(recorder.draws[0]?.destination).toEqual([0, 0, 400, 300]);
	});

	it('clips original on the left and edited result on the right in split mode with identical alignment', () => {
		const recorder = record();
		const original = image(200, 150);
		const edited = image(200, 150);
		const tile = {x: 0, y: 0, ...image(400, 300)};
		drawCanvas({
			surface: recorder.surface,
			viewport: {width: 400, height: 300},
			view: view(2, 180, 120),
			source: {width: 400, height: 300},
			original,
			frame: edited,
			tiles: [tile],
			compare: {mode: 'split', position: 0.35},
			checker: null,
			dpr: 1,
		});

		expect(recorder.clips).toEqual([
			[0, 0, 140, 300],
			[140, 0, 260, 300],
		]);
		expect(recorder.draws).toHaveLength(3);
		expect(recorder.draws[0]?.bitmap).toBe(original.bitmap);
		expect(recorder.draws[1]?.bitmap).toBe(edited.bitmap);
		expect(recorder.draws[2]?.bitmap).toBe(tile.bitmap);
		expect(recorder.draws[0]?.destination).toEqual(
			recorder.draws[1]?.destination,
		);
		expect(recorder.draws[0]?.source).toEqual(recorder.draws[1]?.source);
	});

	it('clips side A above and side B below in a horizontal split, drawing both frames under one transform', () => {
		const recorder = record();
		const original = image(200, 150);
		const edited = image(200, 150);
		const sideFrame = image(100, 75);
		const sideTile = {x: 0, y: 0, ...image(400, 300)};
		drawCanvas({
			surface: recorder.surface,
			viewport: {width: 400, height: 300},
			view: view(2, 180, 120),
			source: {width: 400, height: 300},
			original,
			frame: edited,
			tiles: null,
			sideA: {frame: sideFrame, tiles: [sideTile]},
			compare: {mode: 'split', position: 0.25, orientation: 'horizontal'},
			checker: null,
			dpr: 1,
		});

		expect(recorder.clips).toEqual([
			[0, 0, 400, 75],
			[0, 75, 400, 225],
		]);
		expect(recorder.draws.map((call) => call.bitmap)).toEqual([
			sideFrame.bitmap,
			sideTile.bitmap,
			edited.bitmap,
		]);
		// A frame of another size still covers the same source rectangle.
		expect(recorder.draws[0]?.destination).toEqual(
			recorder.draws[2]?.destination,
		);
	});

	it('shows the original on side A until its first frame arrives', () => {
		const recorder = record();
		const original = image(200, 150);
		drawCanvas({
			surface: recorder.surface,
			viewport: {width: 400, height: 300},
			view: view(1, 200, 150),
			source: {width: 400, height: 300},
			original,
			frame: image(200, 150),
			tiles: null,
			sideA: {frame: null, tiles: null},
			compare: {mode: 'split', position: 0.5},
			checker: null,
			dpr: 1,
		});

		expect(recorder.draws[0]?.bitmap).toBe(original.bitmap);
	});

	it('contain-fits sideA centered without stretching when its effective size differs (F31)', () => {
		expect(
			containRegion({width: 400, height: 300}, {width: 300, height: 400}),
		).toEqual({x: 87.5, y: 0, width: 225, height: 300});

		const recorder = record();
		const historyFrame = image(300, 400);
		const currentFrame = image(400, 300);
		drawCanvas({
			surface: recorder.surface,
			viewport: {width: 400, height: 300},
			view: view(1, 200, 150),
			source: {width: 400, height: 300},
			frame: currentFrame,
			tiles: null,
			sideA: {
				frame: historyFrame,
				tiles: null,
				size: {width: 300, height: 400},
			},
			compare: {mode: 'split', position: 0.5},
			checker: null,
			dpr: 1,
		});

		expect(recorder.draws[0]?.bitmap).toBe(historyFrame.bitmap);
		expect(recorder.draws[0]?.destination).toEqual([87.5, 0, 225, 300]);
		expect(recorder.draws[1]?.bitmap).toBe(currentFrame.bitmap);
		expect(recorder.draws[1]?.destination).toEqual([0, 0, 400, 300]);
	});

	it('draws sideA in toggle compare mode when useSideA is set (F31)', () => {
		const recorder = record();
		const original = image(400, 300);
		const historyFrame = image(300, 400);
		drawCanvas({
			surface: recorder.surface,
			viewport: {width: 400, height: 300},
			view: view(1, 200, 150),
			source: {width: 400, height: 300},
			original,
			frame: image(400, 300),
			tiles: null,
			sideA: {
				frame: historyFrame,
				tiles: null,
				size: {width: 300, height: 400},
			},
			compare: {mode: 'original', useSideA: true},
			checker: null,
			dpr: 1,
		});

		expect(recorder.draws).toHaveLength(1);
		expect(recorder.draws[0]?.bitmap).toBe(historyFrame.bitmap);
		expect(recorder.draws[0]?.destination).toEqual([87.5, 0, 225, 300]);
	});
});
