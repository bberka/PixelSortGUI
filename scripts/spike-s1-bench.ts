import type {Buffer} from 'node:buffer';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import process from 'node:process';
import {chromium, firefox, type BrowserType} from '@playwright/test';
import type {SpikeS1Report} from '../spikes/s1/report-types.ts';

type BrowserResult = {
	browserName: 'chromium' | 'firefox';
	browserVersion: string;
	headed: boolean;
	report: SpikeS1Report;
	peakRssMiB?: number;
};

const PORT = 5199;
const BENCH_URL = `http://localhost:${PORT}/spikes/s1/bench.html`;

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(url);
			if (res.ok) {
				return;
			}
		} catch {
			// Server still starting
		}

		await new Promise((resolve) => {
			setTimeout(resolve, 250);
		});
	}

	throw new Error(`Timed out waiting for dev server at ${url}`);
}

async function listLinuxPids(): Promise<Set<number>> {
	const pids = new Set<number>();
	try {
		const entries = await fs.readdir('/proc');
		for (const entry of entries) {
			if (/^\d+$/.test(entry)) {
				pids.add(Number(entry));
			}
		}
	} catch {
		// Non-Linux
	}

	return pids;
}

async function sampleNewBrowserRssMiB(
	baselinePids: ReadonlySet<number>,
	browserPattern: RegExp,
): Promise<number> {
	try {
		const entries = await fs.readdir('/proc');
		let totalKb = 0;

		for (const entry of entries) {
			if (!/^\d+$/.test(entry)) {
				continue;
			}

			const pid = Number(entry);
			if (baselinePids.has(pid)) {
				continue;
			}

			try {
				const cmdline = await fs.readFile(`/proc/${pid}/cmdline`, 'utf8');
				if (!browserPattern.test(cmdline)) {
					continue;
				}

				const status = await fs.readFile(`/proc/${pid}/status`, 'utf8');
				const match = /VmRSS:\s+(\d+)\s+kB/.exec(status);
				if (match) {
					totalKb += Number(match[1]);
				}
			} catch {
				// Process exited
			}
		}

		return totalKb / 1024;
	} catch {
		return 0;
	}
}

async function runInBrowser(
	browserName: 'chromium' | 'firefox',
	browserType: BrowserType,
	headed: boolean,
	quick: boolean,
): Promise<BrowserResult> {
	const baselinePids =
		process.platform === 'linux' ? await listLinuxPids() : new Set<number>();
	const browserPattern = browserName === 'chromium' ? /chrom/i : /firefox/i;

	const launchOptions =
		browserName === 'chromium'
			? {
					headless: !headed,
					args: ['--enable-precise-memory-info'],
				}
			: {
					headless: !headed,
				};

	const browser = await browserType.launch(launchOptions);
	const browserVersion = browser.version();

	let peakRssMiB = 0;
	let rssTimer: ReturnType<typeof setInterval> | undefined;

	if (process.platform === 'linux') {
		rssTimer = setInterval(() => {
			void sampleNewBrowserRssMiB(baselinePids, browserPattern).then((mib) => {
				if (mib > peakRssMiB) {
					peakRssMiB = mib;
				}
			});
		}, 500);
	}

	try {
		const context = await browser.newContext({
			viewport: {width: 1440, height: 900},
		});
		const page = await context.newPage();
		page.setDefaultTimeout(300_000);

		const pageErrors: string[] = [];
		page.on('pageerror', (err) => {
			pageErrors.push(err.message);
		});

		await page.goto(BENCH_URL, {waitUntil: 'domcontentloaded'});
		await page.waitForFunction(
			() =>
				typeof (
					globalThis as unknown as {
						__runSpikeS1?: (opts?: {quick?: boolean}) => Promise<SpikeS1Report>;
					}
				).__runSpikeS1 === 'function',
		);

		const report = await page.evaluate(async (isQuick) => {
			const runner = (
				globalThis as unknown as {
					__runSpikeS1?: (opts?: {quick?: boolean}) => Promise<SpikeS1Report>;
				}
			).__runSpikeS1;
			if (!runner) {
				throw new Error('__runSpikeS1 is not defined');
			}

			return runner({quick: isQuick});
		}, quick);

		if (pageErrors.length > 0) {
			throw new Error(`${browserName} page errors: ${pageErrors.join('; ')}`);
		}

		return {
			browserName,
			browserVersion,
			headed,
			report,
			peakRssMiB: peakRssMiB > 0 ? peakRssMiB : undefined,
		};
	} finally {
		if (rssTimer) {
			clearInterval(rssTimer);
		}

		await browser.close();
	}
}

function fmt(n: number, digits = 1): string {
	return n.toFixed(digits);
}

function printResult(res: BrowserResult): void {
	const {browserName, browserVersion, headed, report, peakRssMiB} = res;
	console.log(
		`\n=== ${browserName.toUpperCase()} ${browserVersion} (${headed ? 'headed' : 'headless'}) ===`,
	);
	console.log(`Winning exact algorithm: ${report.winningExactAlgorithm}`);
	if (peakRssMiB !== undefined) {
		console.log(
			`Observed peak browser process-tree RSS: ${fmt(peakRssMiB)} MiB`,
		);
	}

	const stats0 = report.imageStats12Mp.angle0;
	console.log(
		`12 MP synthetic image (angle 0): selected=${fmt(stats0.selectedFraction * 100)}%, runs=${stats0.runCount}, mean=${fmt(stats0.meanRunLength)} px, p50=${stats0.p50RunLength} px, p95=${stats0.p95RunLength} px, max=${stats0.maxRunLength} px`,
	);

	console.log('\nAlgorithm comparison (12 MP, 4000x3000):');
	for (const e of report.algorithmComparison12Mp) {
		console.log(
			`  ${e.algorithm.padEnd(12)} angle=${String(e.angle).padStart(2)}  p50=${fmt(e.kernelMs.p50).padStart(6)} ms  p95=${fmt(e.kernelMs.p95).padStart(6)} ms  (${fmt(e.throughputP50Mps).padStart(5)} MP/s p50, ${fmt(e.throughputP95Mps).padStart(5)} MP/s p95)`,
		);
	}

	console.log(
		`\nFull-resolution throughput (${report.winningExactAlgorithm}):`,
	);
	for (const e of report.fullThroughput) {
		const heapStr =
			e.peakJsHeapBytes === undefined
				? ''
				: `  jsHeap=${fmt(e.peakJsHeapBytes / (1024 * 1024))} MiB`;
		console.log(
			`  ${e.label.padEnd(6)} (${e.width}x${e.height}) angle=${String(e.angle).padStart(2)}  p50=${fmt(e.kernelMs.p50).padStart(7)} ms  p95=${fmt(e.kernelMs.p95).padStart(7)} ms  ${fmt(e.throughputP50Mps).padStart(5)} MP/s (p50)  yields=${fmt(e.avgYieldCount)}${heapStr}`,
		);
	}

	console.log('\nPreview latency (from 12 MP 4:3 source):');
	for (const p of report.previews) {
		console.log(
			`  ${p.level.padEnd(6)} (${p.width}x${p.height}) angle=${String(p.angle).padStart(2)}  worker p50=${fmt(p.workerTotalMs.p50).padStart(5)} ms p95=${fmt(p.workerTotalMs.p95).padStart(5)} ms  (kernel p50=${fmt(p.workerKernelMs.p50)} ms, bitmap p50=${fmt(p.workerBitmapMs.p50)} ms, draw p50=${fmt(p.mainDrawMs.p50)} ms)  visible p50=${fmt(p.visibleUpdateMs.p50).padStart(5)} ms p95=${fmt(p.visibleUpdateMs.p95).padStart(5)} ms`,
		);
	}

	console.log('\nPhase breakdown (12 MP):');
	for (const b of report.breakdowns) {
		const sum = b.gatherMs + b.keySelectMs + b.sortMs + b.scatterMs;
		const pct = (v: number) => (sum > 0 ? fmt((v / sum) * 100) : '0.0');
		console.log(
			`  ${b.algorithm.padEnd(12)} angle=${String(b.angle).padStart(2)}  uninstr=${fmt(b.uninstrumentedMs)} ms  gather=${fmt(b.gatherMs)} ms (${pct(b.gatherMs)}%)  key+select=${fmt(b.keySelectMs)} ms (${pct(b.keySelectMs)}%)  sort=${fmt(b.sortMs)} ms (${pct(b.sortMs)}%)  scatter=${fmt(b.scatterMs)} ms (${pct(b.scatterMs)}%)`,
		);
	}

	console.log('\nCancellation latency (8 ms MessageChannel slicing):');
	for (const c of report.cancellation) {
		console.log(
			`  ${c.label.padEnd(14)} angle=${String(c.angle).padStart(2)}  trials=${c.trials}  p50=${fmt(c.cancelLatencyMs.p50)} ms  p95=${fmt(c.cancelLatencyMs.p95)} ms  max=${fmt(c.cancelLatencyMs.max)} ms`,
		);
	}

	const mt = report.mainThread;
	console.log(
		`\nMain-thread health: longTaskApi=${mt.longTaskApiSupported} count=${mt.longTaskCount} longestLongTask=${fmt(mt.longestLongTaskMs)} ms | stallProbe p95=${fmt(mt.stallProbeP95Ms)} ms max=${fmt(mt.stallProbeMaxMs)} ms | longestDraw=${fmt(mt.longestDrawMs)} ms`,
	);

	// Pass/fail evaluation against S1 roadmap criteria
	const drag0 = report.previews.find(
		(p) => p.level === 'drag' && p.angle === 0,
	);
	const settle0 = report.previews.find(
		(p) => p.level === 'settle' && p.angle === 0,
	);
	const full12a0 = report.fullThroughput.find(
		(e) => e.label === '12 MP' && e.angle === 0,
	);
	const full12a30 = report.fullThroughput.find(
		(e) => e.label === '12 MP' && e.angle === 30,
	);

	if (!drag0 || !settle0 || !full12a0 || !full12a30) {
		return;
	}

	const angleRatio = full12a30.kernelMs.p50 / full12a0.kernelMs.p50;
	const longestMain = mt.longTaskApiSupported
		? mt.longestLongTaskMs
		: mt.stallProbeMaxMs;

	const checks: Array<{name: string; pass: boolean; detail: string}> = [
		{
			name: 'drag p95 <= 50 ms',
			pass: drag0.workerTotalMs.p95 <= 50,
			detail: `${fmt(drag0.workerTotalMs.p95)} ms`,
		},
		{
			name: 'visible update p95 <= 100 ms',
			pass: drag0.visibleUpdateMs.p95 <= 100,
			detail: `${fmt(drag0.visibleUpdateMs.p95)} ms`,
		},
		{
			name: 'settle p95 <= 300 ms',
			pass: settle0.workerTotalMs.p95 <= 300,
			detail: `${fmt(settle0.workerTotalMs.p95)} ms`,
		},
		{
			name: 'angle 30 <= 1.5x angle 0 (12 MP p50)',
			pass: angleRatio <= 1.5,
			detail: `${fmt(angleRatio, 2)}x (${fmt(full12a30.kernelMs.p50)} ms / ${fmt(full12a0.kernelMs.p50)} ms)`,
		},
		{
			name: 'no main-thread long task > 50 ms',
			pass: mt.longTaskApiSupported
				? mt.longTaskCount === 0
				: longestMain <= 50,
			detail: mt.longTaskApiSupported
				? `longTasks=${mt.longTaskCount}, longest=${fmt(mt.longestLongTaskMs)} ms`
				: `stallProbe max=${fmt(mt.stallProbeMaxMs)} ms (Long Tasks API unsupported)`,
		},
		{
			name: 'throughput >= 25 MP/s (12 MP angle 0 p50)',
			pass: full12a0.throughputP50Mps >= 25,
			detail: `${fmt(full12a0.throughputP50Mps)} MP/s`,
		},
	];

	console.log('\nPass / Fail criteria:');
	for (const c of checks) {
		console.log(`  [${c.pass ? 'PASS' : 'FAIL'}] ${c.name}: ${c.detail}`);
	}
}

async function main(): Promise<void> {
	const args = new Set(process.argv.slice(2));
	const headed = args.has('--headed');
	const quick = args.has('--quick');
	const jsonArgIndex = process.argv.indexOf('--json');
	const jsonOutPath =
		jsonArgIndex === -1 ? undefined : process.argv[jsonArgIndex + 1];

	const browsersToRun: Array<{
		name: 'chromium' | 'firefox';
		type: BrowserType;
	}> = [];
	if (args.has('--chromium-only')) {
		browsersToRun.push({name: 'chromium', type: chromium});
	} else if (args.has('--firefox-only')) {
		browsersToRun.push({name: 'firefox', type: firefox});
	} else {
		browsersToRun.push(
			{name: 'chromium', type: chromium},
			{name: 'firefox', type: firefox},
		);
	}

	console.log(
		`Spike S1 benchmark | CPU: ${os.cpus()[0]?.model ?? 'unknown'} (${os.cpus().length} logical cores) | RAM: ${fmt(os.totalmem() / 1024 ** 3)} GiB | OS: ${os.type()} ${os.release()}`,
	);

	const devServer = spawn(
		'pnpm',
		['exec', 'vp', 'dev', '--port', String(PORT), '--strictPort'],
		{
			detached: true,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: {...process.env},
		},
	);

	let serverStderr = '';
	devServer.stderr.on('data', (chunk: Buffer) => {
		serverStderr += chunk.toString();
	});

	const stopDevServer = async (): Promise<void> => {
		const {pid} = devServer;
		if (!pid) {
			return;
		}

		try {
			process.kill(-pid, 'SIGTERM');
		} catch {
			// Already exited
		}

		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				try {
					process.kill(-pid, 'SIGKILL');
				} catch {
					// Already exited
				}

				resolve();
			}, 2000);
			devServer.once('exit', () => {
				clearTimeout(timer);
				resolve();
			});
		});
	};

	try {
		await waitForServer(BENCH_URL, 30_000);
		const results: BrowserResult[] = [];

		for (const entry of browsersToRun) {
			const res = await runInBrowser(entry.name, entry.type, headed, quick);
			results.push(res);
			printResult(res);
		}

		if (jsonOutPath) {
			await fs.writeFile(jsonOutPath, JSON.stringify(results, null, 2), 'utf8');
			console.log(`\nWrote raw JSON to ${jsonOutPath}`);
		}
	} catch (error) {
		if (serverStderr) {
			console.error('Dev server stderr:\n', serverStderr);
		}

		throw error;
	} finally {
		await stopDevServer();
	}
}

await main();
