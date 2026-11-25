import {booleanFrom, isDefaultParamValue, type BooleanSpec} from './format.ts';
import {controlId} from './ids.ts';
import {ParamRow} from './param-row.tsx';
import {useTransientParam} from './use-drag-value.ts';
import {Switch} from '@/components/ui/switch';
import {useAppStore} from '@/app/runtime-context.tsx';

export type BooleanControlProps = {
	readonly instanceId: string;
	readonly paramKey: string;
	readonly spec: BooleanSpec;
	readonly value: boolean;
};

/**
 A `boolean` parameter: a switch that commits one history entry per toggle.
 */
export function BooleanControl({
	instanceId,
	paramKey,
	spec,
	value,
}: BooleanControlProps) {
	const commitParam = useAppStore((state) => state.commitParam);
	const resetParam = useAppStore((state) => state.resetParam);
	const transient = useTransientParam(instanceId, paramKey);
	const current = booleanFrom(transient, value);
	const id = controlId(instanceId, paramKey);
	const labelId = `${id}-label`;
	const helpId = `${id}-help`;

	return (
		<ParamRow
			help={spec.help}
			helpId={helpId}
			htmlFor={id}
			inline={
				<Switch
					aria-describedby={helpId}
					checked={current}
					id={id}
					onCheckedChange={(checked) => {
						void commitParam(instanceId, paramKey, checked);
					}}
				/>
			}
			label={spec.label}
			labelId={labelId}
			reset={{
				label: spec.label,
				atDefault: isDefaultParamValue(spec, value),
				onReset() {
					void resetParam(instanceId, paramKey);
				},
			}}
		/>
	);
}
