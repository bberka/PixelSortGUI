import {resolveInstance} from '../engine/params.ts';
import {
	STACK_SCHEMA_VERSION,
	type EffectInstance,
	type EffectRegistry,
	type EffectStack,
} from '../engine/types.ts';

export type StackEnvelopeMigration = (
	stack: Record<string, unknown>,
) => Record<string, unknown>;

export const stackEnvelopeMigrations: Readonly<
	Record<number, StackEnvelopeMigration>
> = {};

export type EnvelopeMigrationResult = {
	stack: EffectStack;
	status: 'ok' | 'newer-version';
	migrated: boolean;
};

export function migrateStackEnvelope(
	stack: EffectStack,
	migrations: Readonly<
		Record<number, StackEnvelopeMigration>
	> = stackEnvelopeMigrations,
): EnvelopeMigrationResult {
	const rawVersion = (stack as {schemaVersion: number}).schemaVersion;
	if (rawVersion > STACK_SCHEMA_VERSION) {
		return {stack, status: 'newer-version', migrated: false};
	}

	if (rawVersion === STACK_SCHEMA_VERSION) {
		return {stack, status: 'ok', migrated: false};
	}

	let current: Record<string, unknown> = {...stack};
	const startVersion =
		Number.isSafeInteger(rawVersion) && rawVersion >= 1 ? rawVersion : 1;
	for (let version = startVersion; version < STACK_SCHEMA_VERSION; version++) {
		const migrate = migrations[version];
		if (migrate) {
			current = {...migrate(current)};
		}
	}

	current.schemaVersion = STACK_SCHEMA_VERSION;
	return {
		stack: current as EffectStack,
		status: 'ok',
		migrated: true,
	};
}

export type UnsupportedInstanceInfo = {
	instanceId: string;
	type: string;
	version: number;
	reason: 'unknown-type' | 'newer-version';
};

export type ResolvedStackResult = {
	stack: EffectStack;
	envelopeStatus: 'ok' | 'newer-version';
	needsWriteBack: boolean;
	unsupportedInstances: UnsupportedInstanceInfo[];
};

export function resolveStoredStack(
	stack: EffectStack,
	registry: EffectRegistry,
): ResolvedStackResult {
	const envelope = migrateStackEnvelope(stack);
	if (envelope.status === 'newer-version') {
		return {
			stack: envelope.stack,
			envelopeStatus: 'newer-version',
			needsWriteBack: false,
			unsupportedInstances: [],
		};
	}

	let needsWriteBack = envelope.migrated;
	const unsupportedInstances: UnsupportedInstanceInfo[] = [];
	const instances: EffectInstance[] = [];

	for (const instance of envelope.stack.instances) {
		const resolved = resolveInstance(instance, registry);
		if (
			resolved.status === 'unknown-type' ||
			resolved.status === 'newer-version'
		) {
			unsupportedInstances.push({
				instanceId: instance.id,
				type: instance.type,
				version: instance.version,
				reason: resolved.status,
			});
			instances.push(instance);
			continue;
		}

		if (resolved.migrated || resolved.fixed) {
			needsWriteBack = true;
			instances.push({
				...instance,
				version: resolved.definition.version,
				params: resolved.params,
			});
			continue;
		}

		instances.push(instance);
	}

	const resultStack: EffectStack = needsWriteBack
		? {...envelope.stack, instances}
		: envelope.stack;

	return {
		stack: resultStack,
		envelopeStatus: 'ok',
		needsWriteBack,
		unsupportedInstances,
	};
}
