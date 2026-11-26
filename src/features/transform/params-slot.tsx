import {GeometryPanel} from './geometry-panel.tsx';
import {useAppStore, useTransientStore} from '@/app/runtime-context.tsx';
import {ParameterPanel} from '@/features/params/params-panel.tsx';

// The Geometry panel takes the parameter panel's place while it is open.
export function ParamsSlot() {
	const open = useTransientStore((state) => state.geometry.open);
	const hasProject = useAppStore((state) => state.activeProject !== null);

	return open && hasProject ? <GeometryPanel /> : <ParameterPanel />;
}
