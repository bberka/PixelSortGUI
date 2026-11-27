import {useEffect, useState} from 'react';
import {useAppRuntime} from '@/app/runtime-context.tsx';
import {decodeImage} from '@/codec/decode.ts';
import type {RgbaImage} from '@/engine/types.ts';

// The longest side of the decoded thumbnail, enough for 48 × 36 px at 2x.
const PREVIEW_SIDE = 144;

export type SourcePreview =
	| {readonly status: 'none' | 'loading' | 'missing'}
	| {
			readonly status: 'ready';
			readonly width: number;
			readonly height: number;
			// Absent when the browser ran short of memory for it.
			readonly image: RgbaImage | undefined;
	  };

/**
 The stored image an `image` parameter names. `missing` means storage does not
 hold it or its bytes cannot be decoded, never that it is still being read.
 `revision` changes when the project is written, which reads a missing image
 again.
 */
export function useSourcePreview(
	sha256: string,
	revision: number | undefined,
): SourcePreview {
	const {repository} = useAppRuntime().bundle;
	const [state, setState] = useState<{
		sha256: string;
		preview: SourcePreview;
	}>();
	const current = state?.sha256 === sha256 ? state.preview : undefined;
	const ready = current?.status === 'ready';

	useEffect(() => {
		if (sha256 === '' || ready) {
			return;
		}

		let cancelled = false;
		const read = async (): Promise<SourcePreview> => {
			const source = await repository.getSource(sha256);
			if (!source) {
				return {status: 'missing'};
			}

			const {width, height} = source;
			const scale = Math.min(1, PREVIEW_SIDE / Math.max(width, height));
			const decoded = await decodeImage(source.blob, {
				resizeWidth: Math.max(1, Math.round(width * scale)),
				skipFileSizeLimit: true,
			});
			return !decoded.ok && decoded.error.code !== 'out-of-memory'
				? {status: 'missing'}
				: {
						status: 'ready',
						width,
						height,
						image: decoded.ok ? decoded.value : undefined,
					};
		};

		void read()
			.then((preview) => {
				if (!cancelled) {
					setState({sha256, preview});
				}
			})
			// A failed read says nothing about the image.
			.catch(() => {});

		return () => {
			cancelled = true;
		};
	}, [ready, repository, revision, sha256]);

	return sha256 === '' ? {status: 'none'} : (current ?? {status: 'loading'});
}
