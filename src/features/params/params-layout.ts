import {createContext, use} from 'react';

/**
 How the parameter controls are laid out (DESIGN.md section 5.1): `regular` in
 the desktop sidebar, `compact` where height is short, `focused` for the one
 control a phone shows at a time.
 */
export type ParamsDensity = 'regular' | 'compact' | 'focused';

export type ParamsLayout = {
	readonly density: ParamsDensity;
	/**
	 Phones only: switches between one control and all of them.
	 */
	readonly onToggleFocus?: () => void;
};

// eslint-disable-next-line @typescript-eslint/naming-convention -- React contexts are PascalCase
export const ParamsLayoutContext = createContext<ParamsLayout>({
	density: 'regular',
});

export function useParamsLayout(): ParamsLayout {
	return use(ParamsLayoutContext);
}
