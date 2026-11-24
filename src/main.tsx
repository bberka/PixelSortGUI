import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import './styles/app.css';
import {Toaster} from '@/components/ui/sonner';
import {TooltipProvider} from '@/components/ui/tooltip';
import {ComponentGallery} from '@/features/gallery/component-gallery';
import {bootAppRuntime, type AppRuntime} from '@/state/index';

declare global {
	var __psgRuntime: AppRuntime | undefined;
}

const runtime = bootAppRuntime();
Object.defineProperty(globalThis, '__psgRuntime', {
	value: runtime,
	writable: true,
	configurable: true,
});

function App() {
	return (
		<TooltipProvider>
			<ComponentGallery />
			<Toaster />
		</TooltipProvider>
	);
}

const rootElement = document.querySelector('#root');
if (!rootElement) {
	throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
