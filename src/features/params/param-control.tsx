import {AngleControl} from './angle-control.tsx';
import {BooleanControl} from './boolean-control.tsx';
import {EnumControl} from './enum-control.tsx';
import {booleanFrom, numberFrom, pairFrom, stringFrom} from './format.ts';
import {NumberControl} from './number-control.tsx';
import {RangeControl} from './range-control.tsx';
import {SeedControl} from './seed-control.tsx';
import type {ParamSpec, ParamValue} from '@/engine/types.ts';

export type ParamControlProps = {
	readonly instanceId: string;
	readonly paramKey: string;
	readonly spec: ParamSpec;
	readonly value: ParamValue;
};

function assertNever(kind: never): never {
	throw new Error(`Unhandled parameter kind: ${String(kind)}`);
}

/**
 One control per parameter kind in `ParamSpec` (engine.md section 3). A kind
 missing here is a type error, so a new kind cannot render nothing.
 */
export function ParamControl({
	instanceId,
	paramKey,
	spec,
	value,
}: ParamControlProps) {
	switch (spec.kind) {
		case 'number': {
			return (
				<NumberControl
					instanceId={instanceId}
					paramKey={paramKey}
					spec={spec}
					value={numberFrom(value, spec.default)}
				/>
			);
		}

		case 'integer': {
			return (
				<NumberControl
					instanceId={instanceId}
					paramKey={paramKey}
					spec={spec}
					value={numberFrom(value, spec.default)}
				/>
			);
		}

		case 'boolean': {
			return (
				<BooleanControl
					instanceId={instanceId}
					paramKey={paramKey}
					spec={spec}
					value={booleanFrom(value, spec.default)}
				/>
			);
		}

		case 'enum': {
			return (
				<EnumControl
					instanceId={instanceId}
					paramKey={paramKey}
					spec={spec}
					value={stringFrom(value, spec.default)}
				/>
			);
		}

		case 'range': {
			return (
				<RangeControl
					instanceId={instanceId}
					paramKey={paramKey}
					spec={spec}
					value={pairFrom(value, spec.default)}
				/>
			);
		}

		case 'angle': {
			return (
				<AngleControl
					instanceId={instanceId}
					paramKey={paramKey}
					spec={spec}
					value={numberFrom(value, spec.default)}
				/>
			);
		}

		case 'seed': {
			return (
				<SeedControl
					instanceId={instanceId}
					paramKey={paramKey}
					spec={spec}
					value={numberFrom(value, 0)}
				/>
			);
		}

		// No control yet: every effect with an image parameter is unlisted
		// (engine.md section 16.5).
		case 'image': {
			return null;
		}

		default: {
			return assertNever(spec);
		}
	}
}
