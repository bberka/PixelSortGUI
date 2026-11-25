import process from 'node:process';
import {defineConfig} from '@playwright/test';
import base, {PERF_TAG} from './playwright.config.ts';

// The speed budgets (tests tagged @perf). They run one at a time so that
// nothing else on the machine competes for the CPU while a budget is measured.
// A budget that misses once is reported, not retried.
export default defineConfig({
	...base,
	fullyParallel: false,
	workers: 1,
	retries: 0,
	// The list reporter prints each test's measured value (`[perf] ...`) in the job log.
	reporter: process.env.CI
		? [['list'], ['github'], ['html', {open: 'never'}]]
		: 'list',
	projects: (base.projects ?? []).map((project) => ({
		...project,
		name: `${project.name}-perf`,
		grep: PERF_TAG,
		grepInvert: undefined,
	})),
});
