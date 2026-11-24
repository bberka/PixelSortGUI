import {createContext, use, type ReactNode} from 'react';
import {useStore} from 'zustand';
import type {AppState, AppStoreBundle} from '@/state/app-store.ts';
import type {AppRuntime} from '@/state/index.ts';
import type {TransientState} from '@/state/transient.ts';

/**
 The only way a component reaches the stores. `src/App.tsx` provides the
 runtime it booted (or the fake runtime a test injected), so no component
 imports `bootAppRuntime` or reads `globalThis.__psgRuntime`.

 Subscribe narrowly: one hook call, one slice. Pick a primitive or a stored
 object (`useAppStore((state) => state.route)`), never an object built inside
 the selector, or every store write re-renders the component. When a component
 genuinely needs several values, call this hook once per value, or wrap the
 selector in `useShallow` from `zustand/react/shallow`.
 */
export type AppRuntimeValue = {
	readonly runtime: AppRuntime;
	readonly bundle: AppStoreBundle;
};

const RuntimeContext = createContext<AppRuntimeValue | null>(null);

export function AppRuntimeProvider({
	value,
	children,
}: {
	readonly value: AppRuntimeValue;
	readonly children: ReactNode;
}) {
	return <RuntimeContext value={value}>{children}</RuntimeContext>;
}

export function useAppRuntime(): AppRuntimeValue {
	const value = use(RuntimeContext);
	if (!value) {
		throw new Error(
			'useAppRuntime must be called under AppRuntimeProvider (see src/App.tsx)',
		);
	}

	return value;
}

export function useAppStore<T>(selector: (state: AppState) => T): T {
	return useStore(useAppRuntime().bundle.store, selector);
}

export function useTransientStore<T>(
	selector: (state: TransientState) => T,
): T {
	return useStore(useAppRuntime().bundle.transientStore, selector);
}
