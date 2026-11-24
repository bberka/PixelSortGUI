import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import './styles/app.css';
import {Toaster} from '@/components/ui/sonner';
import {TooltipProvider} from '@/components/ui/tooltip';
import {ComponentGallery} from '@/features/gallery/component-gallery';

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
