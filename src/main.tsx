import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import './styles/app.css';
import {App} from '@/app/app.tsx';
import {announce} from '@/app/announcer';
import {initPwa} from '@/app/pwa-register.ts';
import {bootAppRuntime, type AppRuntime} from '@/state/index';

declare global {
	var __psgRuntime: AppRuntime | undefined;
	var __psgAnnounce: ((message: string) => void) | undefined;
}

initPwa();
const runtime = bootAppRuntime();

// Test hooks for the end-to-end suite. Nothing in the app reads either global:
// components take the runtime from React context (`src/app/runtime-context.tsx`).
Object.defineProperties(globalThis, {
	__psgRuntime: {value: runtime, writable: true, configurable: true},
	__psgAnnounce: {value: announce, writable: true, configurable: true},
});

const rootElement = document.querySelector('#root');
if (!rootElement) {
	throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
	<StrictMode>
		<App runtime={runtime} />
	</StrictMode>,
);
