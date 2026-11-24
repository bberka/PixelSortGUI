import type {KeyboardEvent} from 'react';
import {ExactEntry} from './exact-entry.tsx';
import {controlId} from './ids.ts';
import {parseNumericText} from './format.ts';
import {steppedValue} from './keyboard.ts';
import {useTransientMix} from './use-drag-value.ts';
import {useAppStore} from '@/app/runtime-context.tsx';
import {Label} from '@/components/ui/label';
import {Slider} from '@/components/ui/slider';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {clamp} from '@/engine/math.ts';
import type {BlendMode} from '@/engine/types.ts';

const BLEND_MODES: ReadonlyArray<{value: BlendMode; label: string}> = [
	{value: 'normal', label: 'Normal'},
	{value: 'lighten', label: 'Lighten'},
	{value: 'darken', label: 'Darken'},
	{value: 'difference', label: 'Difference'},
];

const PERCENT = {min: 0, max: 100, step: 1} as const;

function formatPercent(mix: number): string {
	return `${Math.round(mix * 100)}%`;
}

function parsePercent(text: string): number | null {
	const value = parseNumericText(text.replace(/%$/, ''));
	return value === null ? null : value / 100;
}

export type MixControlProps = {
	readonly instanceId: string;
	readonly mix: number;
};

/**
 The Mix control every effect instance has (engine.md section 4.5): 0 to 100
 in steps of 1 percent, stored as 0..1.
 */
export function MixControl({instanceId, mix}: MixControlProps) {
	const dragMix = useAppStore((state) => state.dragMix);
	const commitMix = useAppStore((state) => state.commitMix);
	const nudgeMix = useAppStore((state) => state.nudgeMix);
	const cancelDrag = useAppStore((state) => state.cancelDrag);
	const transient = useTransientMix(instanceId);
	const current = transient ?? mix;
	const percent = clamp(Math.round(current * 100), PERCENT.min, PERCENT.max);
	const inputId = controlId(instanceId, 'mix');
	const labelId = `${inputId}-label`;

	const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
		const next = steppedValue(event, PERCENT, percent);
		if (next === null) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		nudgeMix(instanceId, next / 100);
	};

	return (
		<div className="flex flex-col gap-1 px-2 py-1.5" data-param-row="">
			<div className="flex min-h-6 items-center justify-between gap-2">
				<Label className="min-w-0 truncate" htmlFor={inputId} id={labelId}>
					Mix
				</Label>
				<span className="font-mono text-[13px] tabular-nums text-muted-foreground">
					{formatPercent(current)}
				</span>
			</div>
			<Slider
				max={PERCENT.max}
				min={PERCENT.min}
				step={PERCENT.step}
				thumbLabels={['Mix']}
				value={[percent]}
				onKeyDownCapture={handleKeyDownCapture}
				onPointerCancel={cancelDrag}
				onValueChange={(values) => {
					const next = values[0];
					if (next !== undefined) {
						dragMix(instanceId, next / 100);
					}
				}}
				onValueCommit={(values) => {
					const next = values[0];
					if (next !== undefined) {
						void commitMix(instanceId, next / 100);
					}
				}}
			/>
			<div className="flex justify-end">
				<ExactEntry
					className="w-24"
					format={formatPercent}
					id={inputId}
					parse={parsePercent}
					value={current}
					onCommit={(next) => {
						void commitMix(instanceId, next);
					}}
				/>
			</div>
		</div>
	);
}

export type BlendControlProps = {
	readonly instanceId: string;
	readonly blend: BlendMode;
};

/**
 The Blend control every effect instance has (engine.md section 4.5).
 */
export function BlendControl({instanceId, blend}: BlendControlProps) {
	const setBlend = useAppStore((state) => state.setBlend);
	const labelId = controlId(instanceId, 'blend', 'label');

	return (
		<div className="flex flex-col gap-1 px-2 py-1.5" data-param-row="">
			<Label id={labelId}>Blend</Label>
			<ToggleGroup
				aria-labelledby={labelId}
				className="flex w-full flex-wrap"
				size="sm"
				type="single"
				value={blend}
				onValueChange={(next) => {
					const mode = BLEND_MODES.find((item) => item.value === next);
					if (mode) {
						void setBlend(instanceId, mode.value);
					}
				}}
			>
				{BLEND_MODES.map((mode) => (
					<ToggleGroupItem key={mode.value} value={mode.value}>
						{mode.label}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
		</div>
	);
}
