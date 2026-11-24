import {DicesIcon} from 'lucide-react';
import {type SeedSpec, parseNumericText} from './format.ts';
import {ExactEntry} from './exact-entry.tsx';
import {controlId} from './ids.ts';
import {ParamRow} from './param-row.tsx';
import {useTransientParam} from './use-drag-value.ts';
import {generateRandomSeed} from '@/state/effect-utils.ts';
import {Button} from '@/components/ui/button';
import {useAppStore} from '@/app/runtime-context.tsx';

export type SeedControlProps = {
	readonly instanceId: string;
	readonly paramKey: string;
	readonly spec: SeedSpec;
	readonly value: number;
};

function numberFromSeed(value: unknown, fallback: number): number {
	return typeof value === 'number' ? value : fallback;
}

/**
 A `seed` parameter: a uint32 field plus a button that writes a random value
 from `crypto.getRandomValues` as one commit (DESIGN.md section 5.1).
 */
export function SeedControl({
	instanceId,
	paramKey,
	spec,
	value,
}: SeedControlProps) {
	const commitParam = useAppStore((state) => state.commitParam);
	const resetParam = useAppStore((state) => state.resetParam);
	const transient = useTransientParam(instanceId, paramKey);
	const current = numberFromSeed(transient ?? value, value);
	const inputId = controlId(instanceId, paramKey);
	const labelId = `${inputId}-label`;
	const helpId = `${inputId}-help`;

	return (
		<ParamRow
			help={spec.help}
			helpId={helpId}
			htmlFor={inputId}
			label={spec.label}
			labelId={labelId}
			reset={{
				label: spec.label,
				atDefault: false,
				onReset() {
					void resetParam(instanceId, paramKey);
				},
			}}
			valueText={String(current)}
		>
			<div className="flex items-center gap-1.5">
				<ExactEntry
					className="w-full min-w-0"
					format={String}
					id={inputId}
					inputMode="numeric"
					parse={parseNumericText}
					value={current}
					onCommit={(next) => {
						void commitParam(instanceId, paramKey, next);
					}}
				/>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => {
						void commitParam(instanceId, paramKey, generateRandomSeed());
					}}
				>
					<DicesIcon aria-hidden="true" />
					New seed
				</Button>
			</div>
		</ParamRow>
	);
}
