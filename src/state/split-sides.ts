import {STACK_SCHEMA_VERSION, type EffectStack} from '../engine/types.ts';
import type {
	CompareMode,
	ProjectRecord,
	SplitOrientation,
	SplitSide,
} from '../storage/types.ts';

// One shared object, so a selector that returns it keeps a stable reference.
export const EMPTY_STACK: EffectStack = {
	schemaVersion: STACK_SCHEMA_VERSION,
	instances: [],
};

type SplitState = {
	readonly compareMode: CompareMode;
	readonly activeProject: ProjectRecord | null;
	readonly compareHistorySeq?: number | null;
};

export function otherSide(side: SplitSide): SplitSide {
	return side === 'a' ? 'b' : 'a';
}

export function sideStack(
	project: ProjectRecord,
	side: SplitSide,
): EffectStack {
	return side === 'a' ? (project.stackA ?? EMPTY_STACK) : project.stack;
}

export function sideSelectedId(
	project: ProjectRecord,
	side: SplitSide,
): string | null {
	return side === 'a'
		? (project.selectedInstanceIdA ?? null)
		: project.selectedInstanceId;
}

export function findInstanceSide(
	project: ProjectRecord,
	instanceId: string,
): SplitSide | null {
	for (const side of ['b', 'a'] as const) {
		if (
			sideStack(project, side).instances.some((item) => item.id === instanceId)
		) {
			return side;
		}
	}

	return null;
}

export function projectInstanceIds(project: ProjectRecord): Set<string> {
	return new Set(
		[project.stack, project.stackA ?? EMPTY_STACK].flatMap((stack) =>
			stack.instances.map((item) => item.id),
		),
	);
}

/**
 The side the effects panel and presets act on. The stored choice counts only
 while the split view is on; otherwise it is the main stack, side B.
 */
export function selectEditingSide(state: SplitState): SplitSide {
	return state.compareMode === 'split' &&
		(state.compareHistorySeq ?? null) === null
		? (state.activeProject?.viewState.editSide ?? 'b')
		: 'b';
}

export function selectEditingStack(state: SplitState): EffectStack | null {
	return state.activeProject
		? sideStack(state.activeProject, selectEditingSide(state))
		: null;
}

export function selectEditingSelectedId(state: SplitState): string | null {
	return state.activeProject
		? sideSelectedId(state.activeProject, selectEditingSide(state))
		: null;
}

export function selectSplitOrientation(state: SplitState): SplitOrientation {
	return state.activeProject?.viewState.splitOrientation ?? 'vertical';
}

export function sideLetter(side: SplitSide): 'A' | 'B' {
	return side === 'a' ? 'A' : 'B';
}

export function sidePositionName(
	side: SplitSide,
	orientation: SplitOrientation,
): 'Left' | 'Right' | 'Top' | 'Bottom' {
	if (orientation === 'vertical') {
		return side === 'a' ? 'Left' : 'Right';
	}

	return side === 'a' ? 'Top' : 'Bottom';
}

export function sideOptionLabel(
	side: SplitSide,
	orientation: SplitOrientation,
): string {
	return `${sideLetter(side)} · ${sidePositionName(side, orientation)}`;
}

// The pill on each side of the canvas.
export function sideCanvasLabel(
	project: ProjectRecord | null,
	side: SplitSide,
): string {
	return project && sideStack(project, side).instances.length > 0
		? sideLetter(side)
		: 'Original';
}

/**
 History labels name the side for any edit to side A and for edits made while
 the split view is on; a single-stack edit keeps its plain label.
 */
export function sideHistoryLabel(
	label: string,
	side: SplitSide,
	splitOn: boolean,
): string {
	return splitOn || side === 'a'
		? `${label} (side ${sideLetter(side)})`
		: label;
}

/**
 The name of the button that turns the split: it states where it will go.
 */
export function orientationSwitchLabel(orientation: SplitOrientation): string {
	return orientation === 'vertical'
		? 'Switch to top/bottom view'
		: 'Switch to left/right view';
}

/**
 What turning the split to `orientation` announces.
 */
export function orientationAnnouncement(orientation: SplitOrientation): string {
	return orientation === 'vertical'
		? 'Split view left and right'
		: 'Split view top and bottom';
}
