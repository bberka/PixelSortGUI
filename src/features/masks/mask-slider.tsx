import type {KeyboardEvent} from 'react';
import {ExactEntry} from '@/features/params/exact-entry.tsx';
import {parseNumericText} from '@/features/params/format.ts';
import {steppedValue} from '@/features/params/keyboard.ts';
import {ParamRow} from '@/features/params/param-row.tsx';
import {useParamsLayout} from '@/features/params/params-layout.ts';
import {Label} from '@/components/ui/label';
import {Slider} from '@/components/ui/slider';
import {cn} from '@/lib/utils';

export type SliderLimits = {
	readonly min: number;
	readonly max: number;
};

type Handlers<Value> = {
	// An intermediate value from the slider.
	readonly onDrag: (value: Value) => void;
	readonly onCommit: (value: Value) => void;
	// An arrow key step; a burst of them is one commit.
	readonly onNudge: (value: Value) => void;
	readonly onCancel: () => void;
};

export type MaskSliderProps = Handlers<number> &
	SliderLimits & {
		readonly id: string;
		readonly label: string;
		// In the unit the control shows, such as percent or px.
		readonly value: number;
		readonly defaultValue: number;
		readonly unit: '%' | ' px';
	};

function parseValue(text: string): number | null {
	return parseNumericText(text.trim().replace(/\s*(?:%|px)$/, ''));
}

/**
 One number of the mask group: a slider with a field for exact entry, like a
 numeric effect parameter (DESIGN.md sections 5.1 and 7.4).
 */
export function MaskSlider({
	id,
	label,
	min,
	max,
	value,
	defaultValue,
	unit,
	onDrag,
	onCommit,
	onNudge,
	onCancel,
}: MaskSliderProps) {
	const inline = useParamsLayout().density !== 'regular';
	const text = `${value}${unit}`;

	const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
		const next = steppedValue(event, {min, max, step: 1}, value);
		if (next === null) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		onNudge(next);
	};

	return (
		<ParamRow
			htmlFor={id}
			label={label}
			labelId={`${id}-label`}
			reset={{
				label,
				atDefault: value === defaultValue,
				onReset() {
					onCommit(defaultValue);
				},
			}}
			valueText={text}
		>
			<div className={inline ? 'flex items-center gap-3' : 'contents'}>
				<Slider
					className={cn(inline && 'min-w-0 flex-1')}
					defaultMark={defaultValue}
					max={max}
					min={min}
					step={1}
					thumbLabels={[label]}
					value={[value]}
					onKeyDownCapture={handleKeyDownCapture}
					onPointerCancel={onCancel}
					onValueChange={([next]) => {
						if (next !== undefined) {
							onDrag(next);
						}
					}}
					onValueCommit={([next]) => {
						if (next !== undefined) {
							onCommit(next);
						}
					}}
				/>
				<div className={cn('flex justify-end', inline && 'shrink-0')}>
					<ExactEntry
						// "2000 px" needs the wider field on a touch screen too.
						className={inline && unit === '%' ? 'w-20' : 'w-24'}
						format={(next) => `${next}${unit}`}
						id={id}
						parse={parseValue}
						value={value}
						onCommit={onCommit}
					/>
				</div>
			</div>
		</ParamRow>
	);
}

export type MaskRangeSliderProps = Handlers<readonly [number, number]> & {
	readonly id: string;
	readonly label: string;
	// Percent, low then high.
	readonly value: readonly [number, number];
	readonly defaultValue: readonly [number, number];
};

const PERCENT = {min: 0, max: 100, step: 1} as const;

/**
 The brightness range of a `luma` mask: two thumbs and a `Low` and `High`
 field, in percent.
 */
export function MaskRangeSlider({
	id,
	label,
	value,
	defaultValue,
	onDrag,
	onCommit,
	onNudge,
	onCancel,
}: MaskRangeSliderProps) {
	const inline = useParamsLayout().density !== 'regular';
	const thumbs = [`${label} low`, `${label} high`] as const;

	const withEnd = (end: 0 | 1, next: number): readonly [number, number] =>
		end === 0 ? [next, value[1]] : [value[0], next];

	const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
		const name = (event.target as Element).getAttribute('aria-label');
		const end = name === thumbs[1] ? 1 : 0;
		const next = steppedValue(event, PERCENT, value[end]);
		if (next === null) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		onNudge(withEnd(end, next));
	};

	const field = (end: 0 | 1) => (
		<>
			<Label
				className={cn(
					'text-xs leading-4 text-muted-foreground',
					inline && 'sr-only',
				)}
				htmlFor={`${id}-${end}`}
			>
				{end === 0 ? 'Low' : 'High'}
			</Label>
			<ExactEntry
				className={inline ? 'w-16 shrink-0' : 'w-full min-w-0'}
				format={(next) => `${next}%`}
				id={`${id}-${end}`}
				parse={parseValue}
				value={value[end]}
				onCommit={(next) => {
					onCommit(withEnd(end, next));
				}}
			/>
		</>
	);

	const slider = (
		<Slider
			className={cn(inline && 'min-w-0 flex-1')}
			defaultMark={defaultValue}
			max={PERCENT.max}
			min={PERCENT.min}
			minStepsBetweenThumbs={0}
			step={PERCENT.step}
			thumbLabels={thumbs}
			value={[value[0], value[1]]}
			onKeyDownCapture={handleKeyDownCapture}
			onPointerCancel={onCancel}
			onValueChange={([low, high]) => {
				if (low !== undefined && high !== undefined) {
					onDrag([low, high]);
				}
			}}
			onValueCommit={([low, high]) => {
				if (low !== undefined && high !== undefined) {
					onCommit([low, high]);
				}
			}}
		/>
	);

	return (
		<ParamRow
			label={label}
			labelId={`${id}-label`}
			reset={{
				label,
				atDefault: value[0] === defaultValue[0] && value[1] === defaultValue[1],
				onReset() {
					onCommit(defaultValue);
				},
			}}
			valueText={`${value[0]}% – ${value[1]}%`}
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
