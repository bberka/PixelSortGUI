import type {KeyboardEvent} from 'react';
import {
	formatEntryValue,
	formatNumericParam,
	isDefaultParamValue,
	numberFrom,
	parseNumberText,
	parseNumericText,
	type NumericSpec,
} from './format.ts';
import {ExactEntry} from './exact-entry.tsx';
import {controlId} from './ids.ts';
import {steppedValue} from './keyboard.ts';
import {ParamRow} from './param-row.tsx';
import {useTransientParam} from './use-drag-value.ts';
import {Slider} from '@/components/ui/slider';
import {useAppStore} from '@/app/runtime-context.tsx';

export type NumberControlProps = {
	readonly instanceId: string;
	readonly paramKey: string;
	readonly spec: NumericSpec;
	readonly value: number;
};

/**
 A `number` or `integer` parameter: a slider with live drag updates and one
 commit on release, plus a field for exact entry (DESIGN.md section 5.1).
 Keyboard changes go through the nudge action so a burst is one commit.
 */
export function NumberControl({
	instanceId,
	paramKey,
	spec,
	value,
}: NumberControlProps) {
	const dragParam = useAppStore((state) => state.dragParam);
	const commitParam = useAppStore((state) => state.commitParam);
	const nudgeParam = useAppStore((state) => state.nudgeParam);
	const resetParam = useAppStore((state) => state.resetParam);
	const cancelDrag = useAppStore((state) => state.cancelDrag);
	const transient = useTransientParam(instanceId, paramKey);
	const current = numberFrom(transient, value);
	const step = spec.kind === 'number' ? spec.step : 1;
	const inputId = controlId(instanceId, paramKey);
	const labelId = `${inputId}-label`;
	const helpId = `${inputId}-help`;

	const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
		const next = steppedValue(
			event,
			{min: spec.min, max: spec.max, step},
			current,
		);
		if (next === null) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		nudgeParam(instanceId, paramKey, next);
	};

	return (
		<ParamRow
			help={spec.help}
			helpId={helpId}
			htmlFor={inputId}
			label={spec.label}
			labelId={labelId}
			reset={{
				label: spec.label,
				atDefault: isDefaultParamValue(spec, value),
				onReset() {
					void resetParam(instanceId, paramKey);
				},
			}}
			valueText={formatNumericParam(spec, current)}
		>
			<Slider
				defaultMark={spec.default}
				max={spec.max}
				min={spec.min}
				step={step}
				thumbLabels={[spec.label]}
				value={[current]}
				onKeyDownCapture={handleKeyDownCapture}
				onPointerCancel={cancelDrag}
				onValueChange={(values) => {
					const next = values[0];
					if (next !== undefined) {
						dragParam(instanceId, paramKey, next);
					}
				}}
				onValueCommit={(values) => {
					const next = values[0];
					if (next !== undefined) {
						void commitParam(instanceId, paramKey, next);
					}
				}}
			/>
			<div className="flex justify-end">
				<ExactEntry
					className="w-24"
					format={(next) => formatEntryValue(spec, next)}
					id={inputId}
					inputMode={spec.kind === 'number' ? 'decimal' : 'numeric'}
					parse={(text) =>
						spec.kind === 'number'
							? parseNumberText(spec, text)
							: parseNumericText(text)
					}
					value={current}
					onCommit={(next) => {
						void commitParam(instanceId, paramKey, next);
					}}
				/>
			</div>
		</ParamRow>
	);
}
