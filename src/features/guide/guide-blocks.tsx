import {useMemo} from 'react';
import {SHORTCUTS, type GuideBlock} from './content.ts';
import {buildEffectsReference} from './effects-reference.ts';
import {effectRegistry} from '@/engine/effects/index.ts';
import {BUILTIN_PRESETS} from '@/presets/builtin.ts';

function Effects() {
	const effects = useMemo(() => buildEffectsReference(effectRegistry), []);

	return (
		<div className="flex flex-col gap-3">
			{effects.map((effect) => (
				<section
					key={effect.type}
					aria-labelledby={`guide-effect-${effect.type}`}
					data-guide-effect={effect.type}
					className="rounded-lg border border-border bg-card p-4"
				>
					<h4
						id={`guide-effect-${effect.type}`}
						className="text-base leading-6 font-semibold"
					>
						{effect.label}
					</h4>
					<p className="text-sm text-muted-foreground">{effect.description}</p>
					<dl className="mt-2 flex flex-col divide-y divide-border">
						{effect.params.map((param) => (
							<div key={param.key} className="py-2">
								<dt className="font-medium">{param.label}</dt>
								<dd className="text-sm">
									Range: {param.range}. Default: {param.defaultValue}.
								</dd>
								{param.help ? (
									<dd className="text-sm text-muted-foreground">
										{param.help}
									</dd>
								) : null}
								{param.shownWhen ? (
									<dd className="text-xs leading-4 text-muted-foreground">
										Shown when {param.shownWhen}.
									</dd>
								) : null}
							</div>
						))}
					</dl>
				</section>
			))}
		</div>
	);
}

function Shortcuts() {
	return (
		<table className="w-full border-collapse text-left text-sm">
			<thead>
				<tr className="border-b border-border text-muted-foreground">
					<th scope="col" className="py-2 pr-3 font-medium">
						Keys
					</th>
					<th scope="col" className="py-2 pr-3 font-medium">
						Where
					</th>
					<th scope="col" className="py-2 font-medium">
						Action
					</th>
				</tr>
			</thead>
			<tbody>
				{SHORTCUTS.map((shortcut) => (
					<tr
						key={`${shortcut.where} ${shortcut.keys.join(' ')}`}
						className="border-b border-border align-top"
					>
						<td className="py-2 pr-3">
							<div className="flex flex-wrap gap-1">
								{shortcut.keys.map((key) => (
									<kbd
										key={key}
										className="rounded-sm border border-border bg-secondary px-1.5 font-mono text-[13px] leading-5"
									>
										{key}
									</kbd>
								))}
							</div>
						</td>
						<td className="py-2 pr-3 text-muted-foreground">
							{shortcut.where}
						</td>
						<td className="py-2">{shortcut.action}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

export function Block({block}: {readonly block: GuideBlock}) {
	switch (block.kind) {
		case 'paragraph': {
			return <p>{block.text}</p>;
		}

		case 'list':
		case 'steps': {
			const List = block.kind === 'list' ? 'ul' : 'ol';
			return (
				<List
					className={`flex flex-col gap-1.5 pl-5 ${block.kind === 'list' ? 'list-disc' : 'list-decimal'}`}
				>
					{block.items.map((item) => (
						<li key={item}>{item}</li>
					))}
				</List>
			);
		}

		case 'terms': {
			return (
				<dl className="flex flex-col gap-2">
					{block.items.map((item) => (
						<div key={item.term}>
							<dt className="font-medium">{item.term}</dt>
							<dd className="text-muted-foreground">{item.text}</dd>
						</div>
					))}
				</dl>
			);
		}

		case 'shortcuts': {
			return <Shortcuts />;
		}

		case 'builtinPresets': {
			return (
				<ul className="flex list-disc flex-col gap-1.5 pl-5">
					{BUILTIN_PRESETS.map((preset) => (
						<li key={preset.id}>{preset.name}</li>
					))}
				</ul>
			);
		}

		case 'effects': {
			return <Effects />;
		}
	}
}
