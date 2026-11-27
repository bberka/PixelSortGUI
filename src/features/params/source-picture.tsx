import {useEffect, useRef} from 'react';
import type {RgbaImage} from '@/engine/types.ts';

// A decoded source preview, cropped to fill its box.
export function SourcePicture({image}: {readonly image: RgbaImage}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) {
			return;
		}

		canvas.width = image.width;
		canvas.height = image.height;
		canvas
			.getContext('2d')
			?.putImageData(
				new ImageData(
					image.data as Uint8ClampedArray<ArrayBuffer>,
					image.width,
					image.height,
				),
				0,
				0,
			);
	}, [image]);

	return <canvas ref={canvasRef} className="size-full object-cover" />;
}
