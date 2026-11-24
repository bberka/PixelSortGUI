import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {create} from 'zustand';
import './styles/app.css';
import {Button} from '@/components/ui/button';

type ScaffoldState = {
	clicks: number;
	increment: () => void;
};

const useScaffoldStore = create<ScaffoldState>((set) => ({
	clicks: 0,
	increment() {
		set((state) => ({clicks: state.clicks + 1}));
	},
}));

function App() {
	const clicks = useScaffoldStore((state) => state.clicks);
	const increment = useScaffoldStore((state) => state.increment);

	return (
		<main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background p-6 text-foreground">
			<h1 className="text-lg font-semibold">PixelSortGUI</h1>
			<p className="text-sm text-muted-foreground">
				Offline pixel sorting and glitch art editor.
			</p>
			<Button type="button" onClick={increment}>
				Scaffold check ({clicks})
			</Button>
		</main>
	);
}

const rootElement = document.querySelector('#root');
if (!rootElement) {
	throw new Error('Root element #root not found');
}

console.error('CI e2e failure probe');

createRoot(rootElement).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
