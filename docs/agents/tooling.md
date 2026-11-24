Written by Claude Sonnet 5.5 (thinking medium), documentation subagent.
Updated for owner decisions by Gemini 4 Neon (Antigravity, thought level medium), documentation subagent.

# Tooling and CI

The core project scaffold (T0.1) and `.hooks/commit-msg` exist. Items still marked `(planned)` below land in subsequent Milestone 0 tasks (T0.2–T0.5). Reference material and the source projects' real files: `docs/research/tooling-reference.md`.

Once a file or command named here exists, delete "planned" from this document in the same pull request.

## Stack

Vite+ (`vite-plus` through `vp`), pnpm 12, Node 24 in CI (`engines`: `^22.18.0 || >=24.11.0`), TypeScript with `tsgo -b` as the type checker, React 19, Tailwind 4, shadcn (new-york, lucide icons), Zustand, xo with Prettier for lint and format, Vitest through `vp test`. Single app at the repository root, no `apps/` folder.

Code comments follow the prose rule (write no comment that restates the code, and put the reason for a lint or type directive inside the directive), with no lint ban or comment ratchet.

## Commands

Defined in `package.json` or `vite.config.ts`, never both under one name (`vp run <name>` cannot take both).

| Command | Does |
| --- | --- |
| `vp run dev` | Dev server |
| `vp run gui` | Build production `dist/`, then serve it locally at `http://localhost:4173` |
| `vp run build` | Production build into `dist/` |
| `vp run check` | `xo`, `tsgo -b`, `vp test run`: what pre-push and CI run |
| `vp run lint`, `vp run lint:fix` | xo check, xo with fixes |
| `vp run typecheck` | `tsgo -b` |
| `vp run test`, `vp run test:watch` | `vp test run`, `vp test` |
| `vp run test:e2e` | Playwright end-to-end suite against the production build on Chromium and Firefox |
| `vp run check:a11y` | Playwright `@axe-core/playwright` accessibility checks (`@a11y` tests) |
| `vp run proof:sheet` | Capture proof viewports and build a contact sheet via `scripts/proof-sheet.ts` |
| `vp run browser:install` | Install Playwright Chromium and Firefox browsers |
| `vp run check:agent-context`, `vp run agent-context:write` | Size budget check and rewrite |
| `vp run version:next` | Print the next release version |
| `vp run evidence` | Upload proof screenshots into the pull request via `scripts/publish-evidence.ts` |
| `vp run skills:install` | Restore the agent skills listed in `skills-lock.json` (planned, optional) |

`vp dev` is a built-in that ignores a `dev` script, so `dev` and `gui` are defined explicitly under `run.tasks` in `vite.config.ts` (`dev` runs `vp dev` and `gui` runs `vp build && vp preview`, both with `cache: false`) and omitted from `package.json` `scripts`. Verified with `vp` 1.4.0 (local `vite-plus` 1.6.0): Vite+ splits `&&` in `run.tasks.<name>.command` into sequential subcommands, respects `cache: false`, and serves `vp run gui` at `http://localhost:4173`.

`vp run evidence` (`scripts/publish-evidence.ts`) only writes to the `evidence` branch for an open pull request in this repository. It accepts at most 10 regular image files per run (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`) inside `.proof/`, verified by both extension and file header bytes, with a 5 MB limit per file, and validates all inputs before any API write.

## Core scaffold files

`package.json` (with `"prepare": "vp hooks enable --hooks-dir .hooks"`), `pnpm-workspace.yaml` (catalog with `vite` as `npm:@voidzero-dev/vite-plus-core@<version>` and `vite-plus`, override `vite@*` to the catalog), `vite.config.ts`, `xo.config.ts`, `tsconfig.json` as a solution file with `tsconfig/base.json`, `app.json`, `node.json`, `test.json`, `components.json`, `index.html`, `.gitignore`, `VERSION`, and `t3.json` (planned, optional, buttons for `dev` and `gui`), plus the scripts below (planned).

`.gitignore` must include `node_modules/`, `dist/`, `*.tsbuildinfo`, `coverage/`, `/.agents/`, `/.claude/worktrees/`, `.unslop/`, and the local proof folder.

## Git hooks

Hooks live in `.hooks/` and are committed. `vp hooks enable --hooks-dir .hooks` points `core.hooksPath` at a generated `.hooks/_` dispatcher that calls them. Before scaffolding, the lead sets `git config core.hooksPath .hooks` so `commit-msg` already runs.

| Hook | Does | State |
| --- | --- | --- |
| `commit-msg` | Rejects `Co-authored-by` trailers and "Generated with" lines. POSIX sh, no dependencies. Test: `sh .hooks/test-commit-msg.sh` | exists |
| `pre-commit` | Refuses `main`; `git diff --cached --check`; runs the agent-context check when agent docs are staged; `vp staged --no-stash --quiet` (xo on staged files); `pnpm exec tsgo -b` | exists |
| `pre-push` | Blocks any push that updates or deletes `main` (read the refs from stdin); then `vp run check` | exists |

The branch checks share one helper, `scripts/git-hooks/protected-branch.sh`. Hooks check and never edit files. The scaffolding task must keep `commit-msg` working under the `.hooks/_` dispatcher and add the hook test to CI.

Hooks do not stop a server-side merge from adding a trailer. The owner turns off any GitHub setting that adds co-authors to merge commits, and the lead checks the message on `main` after each merge.

## CI (GitHub Actions)

Runner `ubuntu-latest`, `permissions: contents: read`, concurrency group per ref with `cancel-in-progress`, steps `actions/checkout`, `pnpm/action-setup`, `actions/setup-node` (Node 24, `cache: pnpm`), `pnpm install --frozen-lockfile`. Call `vp` through `pnpm exec` so the pinned version runs.

`test.yml`, on pull requests and pushes to `main`:

| Job | Runs |
| --- | --- |
| `lint` | `pnpm exec xo` |
| `typecheck` | `pnpm exec tsgo -b` |
| `unit` | `pnpm exec vp test run` |
| `hooks` | `sh .hooks/test-commit-msg.sh` |
| `commit-messages` | Runs `.hooks/commit-msg` on every commit in a pull request |
| `build` | `pnpm exec vp run build` |
| `test` | The required gate. `needs` all jobs above, `if: always()`, passes only when every needed job succeeded (except `commit-messages`, which may be `skipped` on `push` events only). Keep its name stable, because the branch ruleset requires it. |

`agent-context.yml`, on pull requests (opened, synchronize, reopened, labeled, unlabeled): runs the size budget check against the base branch. Fetch the base from `github.base_ref`, not a hard-coded name. A pull request that grows the budget needs the label `agent-context-increase`.

The owner sets a ruleset on `main` that requires a pull request and the checks `test` and the agent-context job.

## Agent-context size budget

Goal: the always-loaded files stay small as the docs grow.

- Script `scripts/agent-context.ts` (run by Node type stripping, no dependencies) and `scripts/agent-context-budget.json` with one byte count per file.
- Measured files: `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, and every file in `docs/agents/`. Specs are large reference documents and are not budgeted.
- The measured size must equal the JSON. `--write` rewrites it. With `--base <ref>`, any value above the base branch's value fails unless the pull request carries the label.
- Targets for the root map: `AGENTS.md` under 100 lines and 6 KB; the always-loaded total (`AGENTS.md` plus `CLAUDE.md`) is the number to watch.
- The pre-commit hook runs the check when any measured file is staged.
- The script gets a test file in `scripts/`, run by `vp test run`.

## Deployment and release

Hosting target: **GitHub Pages** on the custom domain **`glitch.bbay.dev`** (`.github/workflows/pages.yml`). Pushes to `main` and manual dispatch build and deploy; pull requests build and validate output without deployment. The production build (`dist/`) must work when served from the domain root (`/`), and the published output includes `CNAME` containing `glitch.bbay.dev`. Run `pnpm run check:pages-output` locally to check the built output.

ZeroVer, `0.<minor>.<patch>`. The `VERSION` file holds the minor number only and is bumped by hand in a normal pull request when starting a new minor series; the release workflow never commits or pushes to `main`. A manual workflow `release.yml` (`workflow_dispatch`, default branch only) does, in order:

1. Determine the release version: if the current commit already has a `v0.*` tag without a GitHub release, reuse it; otherwise compute the next patch from the latest `v0.<VERSION>.*` tag (`scripts/release-version.ts next`).
2. Run `vp run check` and `vp run build`.
3. Create and push the `v0.<minor>.<patch>` tag (skipped when reusing an existing tag on the same commit).
4. Create the GitHub release last.

Because tagging happens only after checks and build pass, and a re-run on a commit that already carries a `v0.*` tag without a GitHub release reuses that tag instead of computing a higher patch, retrying a failed release run will not accidentally skip a version. If both the tag and the GitHub release already exist on that commit, the run fails early.

The source tree keeps no version number; the build stamps it.

## Open owner decisions

1. **Optional guards:** whether to add the em dash check in pre-commit that mediastash uses, a Claude Code Stop hook that holds a UI task until proof screenshots exist, and `skills-lock.json` with `vp run skills:install` versus vendoring skills (Q10 in [decisions.md](../specs/decisions.md#open-questions-for-the-owner)).
