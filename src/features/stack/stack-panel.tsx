import {useEffect, useMemo, useRef, useState, type PointerEvent} from 'react';
import {AddEffectPicker} from './add-effect-picker.tsx';
import {StackRow} from './stack-row.tsx';
import {usePhoneLayout} from '@/lib/use-phone-layout.ts';
import {cn} from '@/lib/utils';
import {ScrollArea} from '@/components/ui/scroll-area';
import {announce} from '@/app/announcer.ts';
import {useAppStore} from '@/app/runtime-context.tsx';
import {effectRegistry} from '@/engine/effects/index.ts';
import {
	MAX_STACK_INSTANCES,
	type EffectInstance,
	type EffectRegistry,
} from '@/engine/types.ts';
import type {UnsupportedInstanceInfo} from '@/storage/migrations.ts';
import {
	selectEditingSelectedId,
	selectEditingStack,
} from '@/state/split-sides.ts';

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
	const stack = useAppStore(selectEditingStack);
	const selectedInstanceId = useAppStore(selectEditingSelectedId);
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
	const pickerTriggerRef = useRef<HTMLButtonElement>(null);
	const listRef = useRef<HTMLUListElement>(null);
	const pendingFocusIndexRef = useRef<number | null>(null);
	const pendingPickerFocusRef = useRef(false);
	const [drag, setDrag] = useState<DragState | null>(null);

	const unsupportedById = useMemo(() => {
		const map = new Map<string, UnsupportedInstanceInfo>();
		for (const info of unsupportedInstances) {
			map.set(info.instanceId, info);
		}

		return map;
	}, [unsupportedInstances]);

	const instances = stack?.instances ?? [];
	const instanceIdsKey = instances.map((instance) => instance.id).join('\0');

	useEffect(() => {
		// The first effect swaps the empty state for the list, which mounts a new
		// Add effect button in place of the one the picker would return to.
		if (pendingPickerFocusRef.current && instances.length > 0) {
			pendingPickerFocusRef.current = false;
			pickerTriggerRef.current?.focus();
			return;
		}

		const pendingIndex = pendingFocusIndexRef.current;
		if (pendingIndex === null) {
			return;
		}

		pendingFocusIndexRef.current = null;
		if (instances.length === 0) {
			pickerTriggerRef.current?.focus();
			return;
		}

		const targetIndex = Math.min(pendingIndex, instances.length - 1);
		const targetRow = listRef.current?.children.item(targetIndex);
		targetRow?.querySelector<HTMLButtonElement>('button')?.focus();
	}, [instanceIdsKey, instances.length]);

	// A narrow strip can hold the selected chip out of sight, such as a newly
	// added effect at its end.
	useEffect(() => {
		if (!compact || !selectedInstanceId) {
			return;
		}

		listRef.current
			?.querySelector('[data-state="selected"]')
			?.scrollIntoView({block: 'nearest', inline: 'nearest'});
	}, [compact, selectedInstanceId, instanceIdsKey]);

	if (!stack) {
		return null;
	}

	const atLimit = instances.length >= MAX_STACK_INSTANCES;
	const limitNoteId = 'stack-limit-note';

	const add = async (type: string) => {
		const label = registry.get(type)?.label ?? type;
		pendingPickerFocusRef.current = instances.length === 0;
		try {
			await addEffect(type);
			announce(`Added ${label}`);
		} catch {
			pendingPickerFocusRef.current = false;
		}
	};

	const move = async (instance: EffectInstance, from: number, to: number) => {
		if (to < 0 || to >= instances.length || to === from) {
			return;
		}

		const label = labelFor(
			instance,
			registry,
			unsupportedById.get(instance.id),
		);
		try {
			await reorderEffect(from, to);
			announce(`Moved ${label} to position ${to + 1} of ${instances.length}`);
		} catch {
			// Store surfaces persistence and runtime errors separately.
		}
	};

	const remove = async (instance: EffectInstance, index: number) => {
		const label = labelFor(
			instance,
			registry,
			unsupportedById.get(instance.id),
		);
		pendingFocusIndexRef.current = index;
		try {
			await removeEffect(instance.id);
			announce(`Removed ${label}`);
		} catch {
			pendingFocusIndexRef.current = null;
		}
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
			void move(instance, drag.from, drag.target);
		}
	};

	const picker = (
		<AddEffectPicker
			registry={registry}
			compact={compact}
			labelled={instances.length === 0}
			disabled={atLimit}
			describedBy={atLimit ? limitNoteId : undefined}
			triggerRef={pickerTriggerRef}
			onAdd={(type) => {
				void add(type);
			}}
		/>
	);

	if (instances.length === 0) {
		return (
			<div
				className={cn(
					'flex h-full w-full items-center justify-center gap-2 px-2',
					!compact && 'flex-col',
				)}
			>
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
		<div
			className={cn(
				'flex h-full min-h-0 w-full',
				compact
					? 'items-center gap-1.5 px-1.5'
					: 'flex-col items-stretch gap-2 px-2 py-2',
			)}
		>
			<div
				className={cn(
					'flex shrink-0 gap-1.5',
					compact ? 'items-center' : 'w-full flex-col items-stretch',
				)}
			>
				{picker}
				{limitNote}
			</div>
			<ScrollArea
				orientation={compact ? 'horizontal' : 'vertical'}
				tabStop={false}
				className="min-h-0 min-w-0 flex-1 self-stretch"
				viewportClassName={compact ? '[&>div]:h-full' : undefined}
			>
				<ul
					ref={listRef}
					className={cn(
						'flex gap-1',
						compact ? 'h-full items-center' : 'flex-col items-stretch',
					)}
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
								void move(instance, index, to);
							}}
							onDuplicate={() => {
								// Only the selected chip has a menu on a phone, so the one
								// that was used goes away with the selection.
								if (compact) {
									pendingFocusIndexRef.current = index + 1;
								}

								void duplicateEffect(instance.id);
							}}
							onRemove={() => {
								void remove(instance, index);
							}}
						/>
					))}
				</ul>
			</ScrollArea>
		</div>
	);
}
