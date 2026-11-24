import {
	useRef,
	type KeyboardEvent,
	type PointerEvent as ReactPointerEvent,
} from 'react';
import {
	formatAngle,
	formatAngleInput,
	isDefaultParamValue,
	numberFrom,
	parseNumericText,
	type AngleSpec,
} from './format.ts';
import {ExactEntry} from './exact-entry.tsx';
import {controlId} from './ids.ts';
import {dialValue, snapAngle} from './keyboard.ts';
import {ParamRow} from './param-row.tsx';
import {useTransientParam} from './use-drag-value.ts';
import {useAppStore} from '@/app/runtime-context.tsx';

export type AngleControlProps = {
	readonly instanceId: string;
	readonly paramKey: string;
	readonly spec: AngleSpec;
	readonly value: number;
};

function angleAt(
	event: {readonly clientX: number; readonly clientY: number},
	rect: {
		readonly left: number;
		readonly top: number;
		readonly width: number;
		readonly height: number;
	},
	snaps: readonly number[],
	bypassSnap: boolean,
): number {
	const centerX = rect.left + rect.width / 2;
	const centerY = rect.top + rect.height / 2;
	const raw =
		(Math.atan2(-(event.clientY - centerY), event.clientX - centerX) * 180) /
		Math.PI;
	const angle = raw < 0 ? raw + 360 : raw;
	return bypassSnap ? angle : snapAngle(angle, snaps);
}

/**
 An `angle` parameter: a circular dial that drags with the pointer and snaps
 within 4° of the schema's snap points (Shift bypasses the snap), plus a field
 for exact entry (DESIGN.md section 5.1). The dial carries the slider role and
 its value so assistive technology reads it as a slider.
 */
export function AngleControl({
	instanceId,
	paramKey,
	spec,
	value,
}: AngleControlProps) {
	const dragParam = useAppStore((state) => state.dragParam);
	const commitParam = useAppStore((state) => state.commitParam);
	const nudgeParam = useAppStore((state) => state.nudgeParam);
	const resetParam = useAppStore((state) => state.resetParam);
	const cancelDrag = useAppStore((state) => state.cancelDrag);
	const transient = useTransientParam(instanceId, paramKey);
	const current = numberFrom(transient, value);
	const draggingRef = useRef(false);
	const inputId = controlId(instanceId, paramKey);
	const labelId = `${inputId}-label`;
	const helpId = `${inputId}-help`;

	const report = (event: ReactPointerEvent<HTMLDivElement>) =>
		angleAt(
			event,
			event.currentTarget.getBoundingClientRect(),
			spec.snaps,
			event.shiftKey,
		);

	const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) {
			return;
		}

		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		draggingRef.current = true;
		dragParam(instanceId, paramKey, report(event));
	};

	const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!draggingRef.current) {
			return;
		}

		dragParam(instanceId, paramKey, report(event));
	};

	const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!draggingRef.current) {
			return;
		}

		draggingRef.current = false;
		void commitParam(instanceId, paramKey, report(event));
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const next = dialValue(event, current);
		if (next === null) {
			return;
		}

		event.preventDefault();
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
			valueText={formatAngle(current)}
		>
			<div className="flex items-center gap-2">
				<div
					aria-describedby={helpId}
					aria-label={spec.label}
					aria-valuemax={360}
					aria-valuemin={0}
					aria-valuenow={current}
					aria-valuetext={formatAngle(current)}
					className="relative size-11 shrink-0 touch-none rounded-full border border-input bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
					role="slider"
					tabIndex={0}
					onKeyDown={handleKeyDown}
					onPointerCancel={() => {
						draggingRef.current = false;
						cancelDrag();
					}}
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onPointerUp={handlePointerUp}
				>
					<span
						aria-hidden="true"
						className="pointer-events-none absolute inset-0"
						style={{rotate: `${-current}deg`}}
					>
						<span className="absolute top-1/2 right-1/2 h-0.5 w-[calc(50%-5px)] -translate-y-1/2 rounded-full bg-accent" />
					</span>
					<span
						aria-hidden="true"
						className="pointer-events-none absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
					/>
				</div>
				<ExactEntry
					className="w-24"
					format={formatAngleInput}
					id={inputId}
					parse={parseNumericText}
					value={current}
					onCommit={(next) => {
						void commitParam(instanceId, paramKey, next);
					}}
				/>
			</div>
		</ParamRow>
	);
}
