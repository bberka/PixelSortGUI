Written by Claude Sonnet 5.5 (thinking medium), documentation subagent.

# Tooling and CI: target for the scaffolding task

Nothing in this document exists yet except `.hooks/commit-msg` and `.hooks/test-commit-msg.sh`. It specifies what the scaffolding task builds. The scaffolding agent writes the config files; this document is the spec for them. Reference material and the source projects' real files: `docs/research/tooling-reference.md`.

Once a file or command named here exists, delete "planned" from this document in the same pull request.

## Stack

Vite+ (`vite-plus` through `vp`), pnpm 12, Node 24 in CI (`engines`: `^22.18.0 || >=24.11.0`), TypeScript with `tsgo -b` as the type checker, React 19, Tailwind 4, shadcn (new-york, lucide icons), xo with Prettier for lint and format, Vitest through `vp test`. Single app at the repository root, no `apps/` folder.

## Commands

Defined in `package.json` or `vite.config.ts`, never both under one name (`vp run <name>` cannot take both).

| Command | Does |
| --- | --- |
| `vp run dev` | Dev server (planned) |
| `vp run gui` | Production build, then serve it locally (planned) |
| `vp run build` | Production build into `dist/` (planned) |
| `vp run check` | `xo`, `tsgo -b`, `vp test run`: what pre-push and CI run (planned) |
| `vp run lint`, `vp run lint:fix` | xo check, xo with fixes (planned) |
| `vp run typecheck` | `tsgo -b` (planned) |
| `vp run test`, `vp run test:watch` | `vp test run`, `vp test` (planned) |
| `vp run check:agent-context`, `vp run agent-context:write` | Size budget check and rewrite (planned) |
| `vp run version:next` | Print the next release version (planned) |
| `vp run skills:install` | Restore the agent skills listed in `skills-lock.json` (planned, optional) |

`vp dev` is a built-in that ignores a `dev` script, so `dev` and `gui` must be defined explicitly. Recommended: `run.tasks` in `vite.config.ts`, with `dev` running `vp dev` and `gui` running `vp build` then `vp preview`, both with caching off. Untested; the scaffolding agent verifies it and records the result here.

## Files the scaffolding task writes (all planned)

`package.json` (with `"prepare": "vp hooks enable --hooks-dir .hooks"`), `pnpm-workspace.yaml` (catalog with `vite` as `npm:@voidzero-dev/vite-plus-core@<version>` and `vite-plus`, override `vite@*` to the catalog), `vite.config.ts`, `xo.config.ts`, `tsconfig.json` as a solution file with `tsconfig/base.json`, `app.json`, `node.json`, `test.json`, `components.json`, `index.html`, `.gitignore`, `VERSION`, `t3.json` (optional, buttons for `dev` and `gui`), and the scripts below.

`.gitignore` must include `node_modules/`, `dist/`, `*.tsbuildinfo`, `coverage/`, `/.agents/`, `/.claude/worktrees/`, `.unslop/`, and the local proof folder.

## Git hooks

Hooks live in `.hooks/` and are committed. `vp hooks enable --hooks-dir .hooks` points `core.hooksPath` at a generated `.hooks/_` dispatcher that calls them. Before scaffolding, the lead sets `git config core.hooksPath .hooks` so `commit-msg` already runs.

| Hook | Does | State |
| --- | --- | --- |
| `commit-msg` | Rejects `Co-authored-by` trailers and "Generated with" lines. POSIX sh, no dependencies. Test: `sh .hooks/test-commit-msg.sh` | exists |
| `pre-commit` | Refuses `main`; `git diff --cached --check`; runs the agent-context check when agent docs are staged; `vp staged --no-stash --quiet` (xo on staged files); `pnpm exec tsgo -b` | planned |
| `pre-push` | Blocks any push that updates or deletes `main` (read the refs from stdin); then `vp run check` | planned |

The branch checks share one helper, `scripts/git-hooks/protected-branch.sh` (planned). Hooks check and never edit files. The scaffolding task must keep `commit-msg` working under the `.hooks/_` dispatcher and add the hook test to CI.

Hooks do not stop a server-side merge from adding a trailer. The owner turns off any GitHub setting that adds co-authors to merge commits, and the lead checks the message on `main` after each merge.

## CI (GitHub Actions, planned)

Runner `ubuntu-latest`, `permissions: contents: read`, concurrency group per ref with `cancel-in-progress`, steps `actions/checkout`, `pnpm/action-setup`, `actions/setup-node` (Node 24, `cache: pnpm`), `pnpm install --frozen-lockfile`. Call `vp` through `pnpm exec` so the pinned version runs.

`test.yml`, on pull requests and pushes to `main`:

| Job | Runs |
| --- | --- |
| `lint` | `pnpm exec xo` |
| `typecheck` | `pnpm exec tsgo -b` |
| `unit` | `pnpm exec vp test run` |
| `hooks` | `sh .hooks/test-commit-msg.sh` |
| `build` | `pnpm exec vp run build` |
| `test` | The required gate. `needs` all jobs above, `if: always()`, fails if any result is `failure` or `cancelled`. Keep its name stable, because the branch ruleset requires it. |

`agent-context.yml`, on pull requests (opened, synchronize, reopened, labeled, unlabeled): runs the size budget check against the base branch. Fetch the base from `github.base_ref`, not a hard-coded name. A pull request that grows the budget needs the label `agent-context-increase`.

The owner sets a ruleset on `main` that requires a pull request and the checks `test` and the agent-context job.

## Agent-context size budget

Goal: the always-loaded files stay small as the docs grow.

- Script `scripts/agent-context.ts` (planned, run by Node type stripping, no dependencies) and `scripts/agent-context-budget.json` with one byte count per file.
- Measured files: `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, and every file in `docs/agents/`. Specs are large reference documents and are not budgeted.
- The measured size must equal the JSON. `--write` rewrites it. With `--base <ref>`, any value above the base branch's value fails unless the pull request carries the label.
- Targets for the root map: `AGENTS.md` under 100 lines and 6 KB; the always-loaded total (`AGENTS.md` plus `CLAUDE.md`) is the number to watch.
- The pre-commit hook runs the check when any measured file is staged.
- The script gets a test file in `scripts/`, run by `vp test run`.

## Release (planned)

ZeroVer, `0.<minor>.<patch>`. The `VERSION` file holds the minor number only. A manual workflow `release.yml` (`workflow_dispatch`, default branch only) does, in order:

1. Compute the next patch from the latest `v0.<VERSION>.*` tag (`scripts/release-version.ts next`). Fail if the tag exists.
2. Run `vp run check` and `vp run build`.
3. Tag the commit.
4. Deploy the contents of `dist/` to the hosting target.
5. Create the GitHub release last, so a failed deploy leaves no release.

The source tree keeps no version number; the build stamps it.

## Open owner decisions

These block parts of the scaffolding. The lead asks the owner before the scaffolding brief goes out.

1. **Deployment target:** GitHub Pages or Cloudflare Pages. Decides `pages.yml` or a Cloudflare job, secrets, and whether custom response headers are possible (some engine options need them; see `docs/research/engine-architecture.md`).
2. **Proof screenshots:** uploaded into the pull request, or kept local and shown in chat only. Uploading needs a script (`scripts/publish-evidence.ts`, planned). The owner's global rule favors upload.
3. **Code comments:** whether the ban on code comments from the owner's other project (TabLodge, enforced by a lint rule and a ratchet) applies here. Until decided, write no comment that restates the code, and put the reason for a lint or type directive inside the directive.
4. **Project licence:** see [licensing.md](licensing.md).
5. **Optional guards:** whether to add the em dash check in pre-commit that mediastash uses, and a Claude Code Stop hook that holds a UI task until proof screenshots exist.
