import {useEffect, useState} from 'react';
import {useAppRuntime} from '@/app/runtime-context.tsx';

export type CardThumbnailProps = {
	readonly projectId: string;
	readonly visible: boolean;
};

/**
 Reads the stored result thumbnail for one card and keeps its object URL only
 while the card is on screen (AC-F2.6). The image is decorative: the card
 button already carries the project name.
 */
export function CardThumbnail({projectId, visible}: CardThumbnailProps) {
	const {repository} = useAppRuntime().bundle;
	const [url, setUrl] = useState<string | null>(null);

	useEffect(() => {
		if (!visible) {
			setUrl(null);
			return;
		}

		let cancelled = false;
		let objectUrl: string | null = null;
		void repository
			.getThumbnail(projectId)
			.then((thumbnail) => {
				if (cancelled || !thumbnail) {
					return;
				}

				objectUrl = URL.createObjectURL(thumbnail.blob);
				setUrl(objectUrl);
			})
			.catch(() => undefined);

		return () => {
			cancelled = true;
			if (objectUrl) {
				URL.revokeObjectURL(objectUrl);
			}
		};
	}, [projectId, repository, visible]);

	if (!url) {
		return null;
	}

	return (
		<img
			alt=""
			decoding="async"
			src={url}
			className="absolute inset-0 size-full object-cover"
		/>
	);
}
