import type {KeyboardEvent} from 'react';
import {
	formatRange,
	isDefaultParamValue,
	parseNumericText,
	pairFrom,
	type RangeSpec,
} from './format.ts';
import {ExactEntry} from './exact-entry.tsx';
import {controlId} from './ids.ts';
import {steppedValue} from './keyboard.ts';
import {ParamRow} from './param-row.tsx';
import {useParamsLayout} from './params-layout.ts';
import {useTransientParam} from './use-drag-value.ts';
import {Slider} from '@/components/ui/slider';
import {Label} from '@/components/ui/label';
import {useAppStore} from '@/app/runtime-context.tsx';
import {cn} from '@/lib/utils';

export type RangeControlProps = {
	readonly instanceId: string;
	readonly paramKey: string;
	readonly spec: RangeSpec;
	readonly value: readonly [number, number];
};

type End = 0 | 1;

function withEnd(
	pair: readonly [number, number],
	end: End,
	next: number,
): readonly [number, number] {
	return end === 0 ? [next, pair[1]] : [pair[0], next];
}

/**
 A `range` parameter: a two-thumb slider whose thumbs cannot cross, plus a
 field per end. Typing a low value above the high value swaps them, as
 `validateParams` does (DESIGN.md section 5.1).
 */
export function RangeControl({
	instanceId,
	paramKey,
	spec,
	value,
}: RangeControlProps) {
	const dragParam = useAppStore((state) => state.dragParam);
	const commitParam = useAppStore((state) => state.commitParam);
	const nudgeParam = useAppStore((state) => state.nudgeParam);
	const resetParam = useAppStore((state) => state.resetParam);
	const cancelDrag = useAppStore((state) => state.cancelDrag);
	const transient = useTransientParam(instanceId, paramKey);
	const current = pairFrom(transient, value);
	// Short panels put the Low and High fields on the slider's own line.
	const inline = useParamsLayout().density !== 'regular';
	const lowId = controlId(instanceId, paramKey, 'low');
	const highId = controlId(instanceId, paramKey, 'high');
	const labelId = controlId(instanceId, paramKey, 'label');
	const helpId = controlId(instanceId, paramKey, 'help');
	const endLabels: readonly [string, string] = [
		`${spec.label} low`,
		`${spec.label} high`,
	];

	const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
		const end = endOfThumb(event.target, endLabels);
		const thumbValue = current[end];
		const next = steppedValue(
			event,
			{min: spec.min, max: spec.max, step: spec.step},
			thumbValue,
		);
		if (next === null) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		nudgeParam(instanceId, paramKey, withEnd(current, end, next));
	};

	const field = (end: End) => (
		<>
			<Label
				className={cn(
					'text-xs leading-4 text-muted-foreground',
					inline && 'sr-only',
				)}
				htmlFor={end === 0 ? lowId : highId}
			>
				{end === 0 ? 'Low' : 'High'}
			</Label>
			<ExactEntry
				className={inline ? 'w-16 shrink-0' : 'w-full min-w-0'}
				format={String}
				id={end === 0 ? lowId : highId}
				parse={parseNumericText}
				value={current[end]}
				onCommit={(next) => {
					void commitParam(instanceId, paramKey, withEnd(current, end, next));
				}}
			/>
		</>
	);

	const slider = (
		<Slider
			className={cn(inline && 'min-w-0 flex-1')}
			defaultMark={spec.default}
			max={spec.max}
			min={spec.min}
			minStepsBetweenThumbs={0}
			step={spec.step}
			thumbLabels={endLabels}
			value={[current[0], current[1]]}
			onKeyDownCapture={handleKeyDownCapture}
			onPointerCancel={cancelDrag}
			onValueChange={(values) => {
				if (values.length === 2) {
					dragParam(instanceId, paramKey, [values[0], values[1]]);
				}
			}}
			onValueCommit={(values) => {
				if (values.length === 2) {
					void commitParam(instanceId, paramKey, [values[0], values[1]]);
				}
			}}
		/>
	);

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
			valueText={formatRange(current)}
		>
			{inline ? (
				<div className="flex items-center gap-3">
					{field(0)}
					{slider}
					{field(1)}
				</div>
			) : (
				<>
					{slider}
					<div className="flex items-center gap-1.5">
						{field(0)}
						{field(1)}
					</div>
				</>
			)}
		</ParamRow>
	);
}

function endOfThumb(
	target: EventTarget,
	labels: readonly [string, string],
): End {
	const name =
		target instanceof Element ? target.getAttribute('aria-label') : null;
	return name === labels[1] ? 1 : 0;
}
