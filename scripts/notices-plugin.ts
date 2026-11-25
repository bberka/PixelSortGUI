import fs from 'node:fs';
import process from 'node:process';
import type {Plugin} from 'vite-plus';
import {THIRD_PARTY_NOTICES} from '../src/features/settings/third-party-notices.generated.ts';
import {
	NOTICES_FILE_NAME,
	collectNotices,
	findBundledPackageDirs,
	renderText,
} from './notices.ts';

/**
Set by scripts/gen-notices.ts: write the module graph there and do nothing else.
*/
export const GRAPH_OUT_ENV = 'PSG_NOTICES_GRAPH_OUT';

type BundleEntries = Record<string, {type: string; modules?: object}>;

/**
 Watches the module graph of the production build. In a normal build it
 checks that the committed in-app list matches the packages that really got
 bundled and emits THIRD-PARTY-NOTICES.txt into the build output.
 */
export function thirdPartyNotices(rootDir: string): {
	readonly plugin: Plugin;
	readonly workerPlugin: Plugin;
} {
	const moduleIds = new Set<string>();
	const collect = (bundle: BundleEntries) => {
		for (const entry of Object.values(bundle)) {
			if (entry.type === 'chunk' && entry.modules) {
				for (const id of Object.keys(entry.modules)) {
					moduleIds.add(id);
				}
			}
		}
	};

	return {
		workerPlugin: {
			name: 'psg-third-party-notices-worker',
			generateBundle(_options, bundle) {
				collect(bundle);
			},
		},
		plugin: {
			name: 'psg-third-party-notices',
			apply: 'build',
			generateBundle(_options, bundle) {
				collect(bundle);
				const graphOut = process.env[GRAPH_OUT_ENV];
				if (graphOut) {
					fs.writeFileSync(graphOut, JSON.stringify([...moduleIds].toSorted()));
					return;
				}

				const notices = collectNotices(
					findBundledPackageDirs(moduleIds, rootDir),
				);
				const bundled = new Set(
					notices.map((notice) => `${notice.name}@${notice.version}`),
				);
				const listed = new Set(
					THIRD_PARTY_NOTICES.map(
						(notice) => `${notice.name}@${notice.version}`,
					),
				);
				const missing = [...bundled].filter((key) => !listed.has(key));
				const extra = [...listed].filter((key) => !bundled.has(key));
				if (missing.length > 0 || extra.length > 0) {
					this.error(
						`The in-app third-party list does not match the bundled packages. Run "pnpm run gen:notices". Bundled but not listed: ${missing.join(', ') || 'none'}. Listed but not bundled: ${extra.join(', ') || 'none'}.`,
					);
				}

				this.emitFile({
					type: 'asset',
					fileName: NOTICES_FILE_NAME,
					source: renderText(notices),
				});
			},
		},
	};
}
