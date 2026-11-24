import {useMemo, useRef, useState, type PointerEvent} from 'react';
import {AddEffectPicker} from './add-effect-picker.tsx';
import {StackRow} from './stack-row.tsx';
import {usePhoneLayout} from './use-phone-layout.ts';
import {announce} from '@/app/announcer.ts';
import {useAppStore} from '@/app/runtime-context.tsx';
import {effectRegistry} from '@/engine/effects/index.ts';
import {
	MAX_STACK_INSTANCES,
	type EffectInstance,
	type EffectRegistry,
} from '@/engine/types.ts';
import type {UnsupportedInstanceInfo} from '@/storage/migrations.ts';

export type EffectStackPanelProps = {
	/**
	 Test seam, like `App`'s `screens` prop: the panel is built from whichever
	 registry it is given, so a test can prove a newly registered effect shows
	 up without a change here.
	 */
	readonly registry?: EffectRegistry;
};

type DragState = {
	instanceId: string;
	from: number;
	target: number;
};

function labelFor(
	instance: EffectInstance,
	registry: EffectRegistry,
	unsupported: UnsupportedInstanceInfo | undefined,
): string {
	return unsupported
		? `Unsupported effect (${instance.type} v${instance.version})`
		: (registry.get(instance.type)?.label ?? instance.type);
}

export function EffectStackPanel({
	registry = effectRegistry,
}: EffectStackPanelProps = {}) {
	const stack = useAppStore((state) => state.activeProject?.stack ?? null);
	const selectedInstanceId = useAppStore(
		(state) => state.activeProject?.selectedInstanceId ?? null,
	);
	const unsupportedInstances = useAppStore(
		(state) => state.unsupportedInstances,
	);
	const addEffect = useAppStore((state) => state.addEffect);
	const removeEffect = useAppStore((state) => state.removeEffect);
	const reorderEffect = useAppStore((state) => state.reorderEffect);
	const duplicateEffect = useAppStore((state) => state.duplicateEffect);
	const setEffectEnabled = useAppStore((state) => state.setEffectEnabled);
	const selectEffect = useAppStore((state) => state.selectEffect);

	const compact = usePhoneLayout();
	const listRef = useRef<HTMLUListElement>(null);
	const [drag, setDrag] = useState<DragState | null>(null);

	const unsupportedById = useMemo(() => {
		const map = new Map<string, UnsupportedInstanceInfo>();
		for (const info of unsupportedInstances) {
			map.set(info.instanceId, info);
		}

		return map;
	}, [unsupportedInstances]);

	if (!stack) {
		return null;
	}

	const {instances} = stack;
	const atLimit = instances.length >= MAX_STACK_INSTANCES;
	const limitNoteId = 'stack-limit-note';

	const move = (instance: EffectInstance, from: number, to: number) => {
		if (to < 0 || to >= instances.length || to === from) {
			return;
		}

		const label = labelFor(
			instance,
			registry,
			unsupportedById.get(instance.id),
		);
		void reorderEffect(from, to).then(() => {
			announce(`Moved ${label} to position ${to + 1} of ${instances.length}`);
		});
	};

	const handlePointerDown = (event: PointerEvent<HTMLUListElement>) => {
		const handle = (event.target as Element).closest('[data-drag-handle]');
		const row = handle?.closest<HTMLElement>('li[data-index]');
		if (!handle || !row) {
			return;
		}

		const index = Number(row.dataset.index);
		const instance = instances[index];
		if (!instance) {
			return;
		}

		event.preventDefault();
		handle.setPointerCapture(event.pointerId);
		setDrag({instanceId: instance.id, from: index, target: index});
	};

	const handlePointerMove = (event: PointerEvent<HTMLUListElement>) => {
		const list = listRef.current;
		if (!drag || !list) {
			return;
		}

		let target = drag.from;
		const rows = [...list.children];
		for (const [index, row] of rows.entries()) {
			const rect = row.getBoundingClientRect();
			if (event.clientY >= rect.top + rect.height / 2) {
				target = index;
			}
		}

		if (target !== drag.target) {
			setDrag({...drag, target});
		}
	};

	const handlePointerUp = () => {
		if (!drag) {
			return;
		}

		const instance = instances.find((item) => item.id === drag.instanceId);
		setDrag(null);
		if (instance) {
			move(instance, drag.from, drag.target);
		}
	};

	const picker = (
		<AddEffectPicker
			registry={registry}
			compact={compact}
			disabled={atLimit}
			describedBy={atLimit ? limitNoteId : undefined}
			onAdd={(type) => {
				void addEffect(type);
			}}
		/>
	);

	if (instances.length === 0) {
		return (
			<div className="flex h-full w-full items-center justify-center gap-2 px-2 md:flex-col">
				<p className="text-sm text-muted-foreground">No effects yet</p>
				{picker}
			</div>
		);
	}

	const limitNote = atLimit ? (
		<p id={limitNoteId} className="shrink-0 px-1 text-xs text-muted-foreground">
			{MAX_STACK_INSTANCES} effects maximum
		</p>
	) : null;

	return (
		<div className="flex h-full min-h-0 w-full items-center gap-1.5 px-1.5 md:flex-col md:items-stretch md:gap-2 md:px-2 md:py-2">
			<div className="flex shrink-0 items-center gap-1.5 md:w-full">
				{picker}
				{limitNote}
			</div>
			<ul
				ref={listRef}
				className="flex min-h-0 min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden md:flex-col md:items-stretch md:overflow-x-hidden md:overflow-y-auto"
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				onPointerCancel={() => {
					setDrag(null);
				}}
			>
				{instances.map((instance, index) => (
					<StackRow
						key={instance.id}
						instance={instance}
						index={index}
						total={instances.length}
						label={labelFor(
							instance,
							registry,
							unsupportedById.get(instance.id),
						)}
						isSelected={instance.id === selectedInstanceId}
						isUnsupported={unsupportedById.has(instance.id)}
						isDragging={drag?.instanceId === instance.id}
						compact={compact}
						onSelect={() => {
							selectEffect(instance.id);
						}}
						onToggleEnabled={(enabled) => {
							void setEffectEnabled(instance.id, enabled);
						}}
						onMove={(to) => {
							move(instance, index, to);
						}}
						onDuplicate={() => {
							void duplicateEffect(instance.id);
						}}
						onRemove={() => {
							void removeEffect(instance.id);
						}}
					/>
				))}
			</ul>
		</div>
	);
}
