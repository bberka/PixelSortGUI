import {useCallback, useEffect, useRef, useState} from 'react';

const ROOT_MARGIN = '0px';

export type VisibleProjects = {
	/**
	 The scrolling element the observer uses as its root.
	 */
	readonly scrollRef: React.RefObject<HTMLDivElement | null>;
	readonly register: (projectId: string, element: HTMLElement | null) => void;
	readonly isVisible: (projectId: string) => boolean;
	readonly elementFor: (projectId: string) => HTMLElement | undefined;
};

/**
 AC-F2.6: a card is only marked visible once it scrolls into the viewport, so
 its thumbnail blob is fetched and decoded then and not before. Without an
 `IntersectionObserver` every card counts as visible, which keeps the grid
 working in environments that do not implement it.
 */
export function useVisibleProjects(): VisibleProjects {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const observerRef = useRef<IntersectionObserver | null>(null);
	const elementsRef = useRef(new Map<string, HTMLElement>());
	const idsRef = useRef(new Map<Element, string>());
	const [visibleIds, setVisibleIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const supported = typeof IntersectionObserver === 'function';

	const register = useCallback(
		(projectId: string, element: HTMLElement | null) => {
			const previous = elementsRef.current.get(projectId);
			if (previous === element) {
				return;
			}

			if (previous) {
				observerRef.current?.unobserve(previous);
				idsRef.current.delete(previous);
				elementsRef.current.delete(projectId);
			}

			if (!element) {
				return;
			}

			elementsRef.current.set(projectId, element);
			idsRef.current.set(element, projectId);
			observerRef.current?.observe(element);
		},
		[],
	);

	const elementFor = useCallback(
		(projectId: string) => elementsRef.current.get(projectId),
		[],
	);

	useEffect(() => {
		if (!supported) {
			return;
		}

		const observer = new IntersectionObserver(
			(entries) => {
				setVisibleIds((current) => {
					let next: Set<string> | null = null;
					for (const entry of entries) {
						const projectId = idsRef.current.get(entry.target);
						if (
							projectId === undefined ||
							entry.isIntersecting === current.has(projectId)
						) {
							continue;
						}

						next ??= new Set(current);
						if (entry.isIntersecting) {
							next.add(projectId);
						} else {
							next.delete(projectId);
						}
					}

					return next ?? current;
				});
			},
			{root: scrollRef.current, rootMargin: ROOT_MARGIN},
		);
		observerRef.current = observer;
		for (const element of elementsRef.current.values()) {
			observer.observe(element);
		}

		return () => {
			observer.disconnect();
			observerRef.current = null;
		};
	}, [supported]);

	const isVisible = useCallback(
		(projectId: string) => !supported || visibleIds.has(projectId),
		[supported, visibleIds],
	);

	return {scrollRef, register, isVisible, elementFor};
}
