import {isDefaultParamValue, stringFrom, type EnumSpec} from './format.ts';
import {controlId} from './ids.ts';
import {ParamRow} from './param-row.tsx';
import {useTransientParam} from './use-drag-value.ts';
import {useAppStore} from '@/app/runtime-context.tsx';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';

const MAX_SEGMENTS = 4;

export type EnumControlProps = {
	readonly instanceId: string;
	readonly paramKey: string;
	readonly spec: EnumSpec;
	readonly value: string;
};

/**
 An `enum` parameter: a segmented toggle up to four options, a dropdown above
 that (DESIGN.md section 5.1).
 */
export function EnumControl({
	instanceId,
	paramKey,
	spec,
	value,
}: EnumControlProps) {
	const commitParam = useAppStore((state) => state.commitParam);
	const resetParam = useAppStore((state) => state.resetParam);
	const transient = useTransientParam(instanceId, paramKey);
	const current = stringFrom(transient, value);
	const labelId = controlId(instanceId, paramKey, 'label');
	const helpId = controlId(instanceId, paramKey, 'help');

	return (
		<ParamRow
			help={spec.help}
			helpId={helpId}
			label={spec.label}
			labelId={labelId}
			reset={{
				label: spec.label,
				atDefault: isDefaultParamValue(spec, value),
				onReset() {
					void resetParam(instanceId, paramKey);
				},
			}}
		>
			{spec.options.length <= MAX_SEGMENTS ? (
				<ToggleGroup
					aria-describedby={helpId}
					aria-labelledby={labelId}
					className="flex w-full flex-wrap"
					size="sm"
					type="single"
					value={current}
					onValueChange={(next) => {
						if (next !== '') {
							void commitParam(instanceId, paramKey, next);
						}
					}}
				>
					{spec.options.map((option) => (
						<ToggleGroupItem key={option.value} value={option.value}>
							{option.label}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			) : (
				<Select
					value={current}
					onValueChange={(next) => {
						void commitParam(instanceId, paramKey, next);
					}}
				>
					<SelectTrigger
						aria-describedby={helpId}
						aria-labelledby={labelId}
						className="w-full"
						size="sm"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{spec.options.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}
		</ParamRow>
	);
}
