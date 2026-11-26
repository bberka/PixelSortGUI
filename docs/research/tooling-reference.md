Written by Claude Sonnet 5.5 (thinking medium), research subagent.

# Tooling, agent workflow and CI reference (TabLodge and mediastash)

Source projects, read only, on 2026-11-24:

- TabLodge: `/home/berg/Projects/TabLodge`. First commit 2026-10-25, last 2026-11-24. pnpm workspace with four apps (extension, Android app, sync server, Astro site).
- mediastash: `/home/berg/Projects/mediastash`. First commit 2026-07-03, last 2026-11-23. pnpm workspace with five apps and four packages.

Both use Vite+ (`vp`), pnpm 12, Tailwind 4, shadcn (new-york style, Radix), React 19, and an `AGENTS.md` that is a short map into `docs/agents/`. Their commit history shows the same owner, with agents opening most PRs. Secrets, tokens and hostnames are left out below. Secrets are named only.

A later agent can set up Drift from this file alone. "Quoted" blocks are copied from the source files.

## 0. Findings that change the setup

1. `vp run <name>` runs a `package.json` script or a task under `run.tasks` in `vite.config.ts`. One name cannot come from both. Neither source project defines `run.tasks`. Both only forward `vp run x` to package.json scripts. Drift needs `vp run dev` and `vp run gui`, so section 5 shows both options.
2. `vp dev` is a built-in command and is not the same as `vp run dev`. The built-in `vp dev` ignores a `dev` script. So `vp run dev` and `vp run gui` must be defined explicitly. Source: `node_modules/vite-plus/docs/guide/run.md` in TabLodge.
3. Neither project has a real `commit-msg` hook. Both have only the generated stub under `.hooks/_/` or `.husky/_/`. Neither project enforces a ban on `Co-authored-by` trailers in a hook.
   - TabLodge has the rule in prose: `AGENTS.md` and `docs/agents/workflow.md`.
   - TabLodge's `unslop-git` skill (rule git-7) also says to delete AI-tool trailers.
   - mediastash has nothing on the topic.
   - Drift must add the hook itself (section 11).
4. Only TabLodge has a PR template (`.github/pull_request_template.md`), with a `## Model` section. mediastash has no template. Its `pr` skill writes Summary, Evidence and Merge Danger, and its `file-pr` skill ends the description with the model and harness.
5. Linting differs. TabLodge uses XO (ESLint based) with Prettier through XO. mediastash uses `vp lint` (oxlint) with no formatter. The new project wants XO, so TabLodge is the model.
6. T3 Code `t3.json` exists only in mediastash.

## 1. Agent instructions

### 1.1 Always loaded versus on demand

| Layer | TabLodge | mediastash |
| --- | --- | --- |
| Always loaded (root map) | `AGENTS.md`, 4098 bytes. No `CLAUDE.md`. | `AGENTS.md`, 4766 bytes. `CLAUDE.md` is 11 bytes: `@AGENTS.md`. |
| Per-folder, loaded when working there | `apps/{extension,mobile,server,site}/AGENTS.md`, 461 to 735 bytes each. | `apps/*/AGENTS.md` and `packages/*/AGENTS.md`, 350 to 1033 bytes each. Each has a sibling `CLAUDE.md` containing only `@AGENTS.md`. |
| On demand topic docs | `docs/agents/*.md`, 13 files, 75,575 bytes. | `docs/agents/*.md`, 11 files, 70,181 bytes. |
| Domain and design docs | `docs/architecture.md` (122 KB), `docs/adr/*.md` (ADRs, 20+), `docs/PRIVACY.md`. No `CONTEXT.md` or `DESIGN.md`. | `CONTEXT.md` (41 KB glossary), `DESIGN.md` (11.7 KB design system), `docs/adr/` (66+ ADRs), `docs/guides/`, `docs/specs/`. |
| Human entry | `docs/README.md`, `docs/CONTRIBUTING.md` | `README.md`, `docs/README.md` |

Both root files have the same shape:

1. One-line description.
2. `## Layout` (folder to purpose bullets).
3. `## Hard rules` (about 10 bullets).
4. `## Load on demand` (one line per doc: situation, then arrow, then link).

TabLodge opens with: "Humans start at docs/README.md; agents load docs/agents/ on demand below." mediastash says the same. `docs/agents/documentation.md` in mediastash states the rules for these files (quoted from the source):

> `AGENTS.md` = map, not manual. Holds layout, hard rules every task needs, one pointer per doc, each saying when to load. Everything else in `docs/agents/`.
> - Keep `AGENTS.md` under about 60 lines.
> - Per-folder `AGENTS.md` holds few rules that break something when missed, each with reason, points to its doc for rest. Under 15 lines, with `CLAUDE.md` beside it holding only `@AGENTS.md`.
> - Add a doc only when topic applies to some tasks and has durable audience, give it one line under Load on demand. Word trigger as situation, lead with distinctive word, one trigger per branch.
> - Delete rule that code, config, or script already enforces.
> - Write or edit these files with `writing-for-agents` skill loaded.
> - Compress after editing. Run `/caveman-compress <file>` on each changed agent file, then `vp run agent-context:write`.

Style of the files: terse, articles dropped ("Never commit on or push to master or main; work on `<type>/<short-topic>` branch"). This comes from running the `caveman-compress` skill.

### 1.2 Hard rules, TabLodge `AGENTS.md`

Full text of the rule bullets, because Drift should start from these:

> - Never commit on or push to `master` or `main`; work on `<type>/<short-topic>` branch, open pull request.
> - Commits name human author only. Pull request names model.
> - Check and claim before coding: read issue's comments, search pull requests for its number, then comment that you are taking it. Release claim if you stop.
> - Work from spec: feature has issue with acceptance criteria before first edit, fix has its bug report. Challenge new feature with `challenge-feature` first, unless told to implement it.
> - Every fix or feature carries proof in pull request, one piece per acceptance criterion. Ask user only when no proof possible.
> - Report only what you ran. Say what you could not run or check; never infer result.
> - Change user can see, including follow up request, gets fresh screenshots ... uploaded with `vp run evidence <pr> <files>` into pull request. Local file paths are not proof.
> - Guard (hook, lint rule, check, skipped test) says what it prevents, in its doc or config entry. Lint or type directive carries its reason inside it (`eslint-disable-next-line rule -- reason`, `@ts-expect-error reason`). Read reason before changing guard.
> - Write no code comments; reason goes in name, type, test, or ADR.
> - Never ask whether to run app, take screenshots, or open pull request. Do them, then report.
> - Finish task: commit, push, open pull request, wait for green CI, stop every process you started, then say done. Load workflow.md and validation.md before first edit.
> - Before every push, run `unslop-*` skills on diff and finish gate. Leave Git hooks on.
> - Change not done while document still describes old behavior.

mediastash `AGENTS.md` hard rules differ in these ways:

- Every task runs the full task workflow to the end. "Open a PR" means the whole workflow.
- Worktree per task, then `vp run dev:setup` in it.
- Proof goes to `.mediastash/proof/` and is never committed or uploaded. This is the opposite of TabLodge, which uploads proof into the PR.
- Screenshots at 390x844, 820x1180 and 1440x900.
- Run `unslop-diff` before committing.
- Standing authorization to commit, push and open a PR. Merge, amend, rebase and force-push wait for the user.
- Never use `git reset`, `checkout`, `restore`, `clean` or `stash` to discard work.
- Em dashes (U+2014) are banned in all text. This is enforced in `pre-commit` and by `vp run dashes:check` in CI.
- Use the session's own model. Start subagents only when the user asks.

### 1.3 `docs/agents/` file lists

TabLodge: `workflow.md` (4.6 KB), `validation.md` (9.4 KB), `spec-driven.md`, `issue-tracker.md`, `comments.md`, `cross-app.md`, `documentation.md`, `ci.md` (13 KB), `ui.md`, `extension.md`, `mobile.md`, `server.md`, `site.md`.

mediastash: `contributor-workflow.md` (16 KB, workflow plus proof plus hooks), `spec-driven-development.md`, `issue-tracker.md`, `triage-labels.md`, `repository-map.md`, `frontend-rules.md` (20 KB), `storage-rules.md`, `domain-docs.md`, `writing-rules.md`, `comment-rules.md`, `documentation.md`.

For a single-app project the useful set is: `workflow.md`, `validation.md`, `spec-driven.md`, `ui.md`, `ci.md`, `comments.md` (optional), `documentation.md`, `writing-rules.md`.

### 1.4 Size budget check

Both projects have a checked-in JSON budget of bytes, a script, a pre-commit check (mediastash only) and a CI workflow that fails when the budget grows over the base branch.

- TabLodge:
  - `scripts/agent-context.ts` (first commit 2026-11-20).
  - `scripts/agent-context-budget.json`: `{"AGENTS.md": 4098, "apps/*/AGENTS.md": 2364, "docs/agents": 75575}`. Three grouped totals.
  - `.github/workflows/agent-context.yml`.
  - `vp run check:agent-context` and `node scripts/agent-context.ts --write`.
- mediastash:
  - `scripts/agent-context-budget.mjs` (2026-11-20), with a test.
  - `scripts/agent-context-budget.json`. One entry per file, so growth is traceable per file.
  - `.github/workflows/agent-context-budget.yml`.
  - `agent-context:check` and `agent-context:write` scripts.
  - `.husky/pre-commit` runs the check when `AGENTS.md`, `CLAUDE.md`, `docs/agents/` or the budget file is staged.

The check works like this:

1. The measured sizes must equal the JSON exactly. If they differ, run `--write` and commit.
2. With `--base <ref>`, the script reads the base branch's JSON via `git show <ref>:scripts/agent-context-budget.json`. Any value above the base value fails, unless the PR carries the label `agent-context-increase`.
3. The workflow runs on `pull_request` types `[opened, synchronize, reopened, labeled, unlabeled]`, so toggling the label reruns only this check.
4. Both repos suggest adding the check to the branch ruleset's required checks.

TabLodge workflow (quoted):

```yaml
name: Agent context
on:
  pull_request:
    types: [opened, synchronize, reopened, labeled, unlabeled]
permissions:
  contents: read
jobs:
  budget:
    name: Agent instructions size
    runs-on: ubuntu-latest
    timeout-minutes: 5
    env:
      ALLOW_INCREASE: ${{ contains(github.event.pull_request.labels.*.name, 'agent-context-increase') }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: git fetch --quiet --depth=1 origin master
      - run: node scripts/agent-context.ts --base FETCH_HEAD
```

Note: mediastash's version uses `git fetch ... origin "$BASE_REF"` from `github.base_ref`, which is better than hard-coding `master`.

### 1.5 Other agent files

| File | TabLodge | mediastash |
| --- | --- | --- |
| `CLAUDE.md` | none | `@AGENTS.md` (root and per folder) |
| `CONTEXT.md` | none | domain glossary: `## Term` heading and one or two sentence definition, 41 KB. Read when the task touches domain terms (`domain-docs.md`). First commit 2026-07-15. |
| `DESIGN.md` | none (UI rules are in `docs/agents/ui.md`) | numbered sections: 1 Atmosphere and identity, 2 Color (token role table), 3 Typography, 4 Spacing and layout, 5 Components ... Source of truth for tokens is `apps/web/src/index.css`. "Do not add raw color values in components." Read after `frontend-rules.md` when visuals change. |
| `t3.json` | none | `{"$schema": "https://t3.codes/schema/t3.json", "scripts": [{"name": "dev:all", "command": "vp run dev:all", "icon": "play", "runOnWorktreeCreate": false, "previewUrl": "http://localhost:50080", "autoOpenPreview": true}, {"name": "dev", "command": "vp run dev", ...same fields}]}`. Two buttons in T3 Code that run a vp task and open a preview URL. First commit 2026-11-08. |
| `skills-lock.json` | `{"version": 2, "skills": {name: {source, sourceType: "github", skillPath, computedHash}}}`. Sources: `juliusbrussee/caveman`, `mattpocock/skills`. | `version: 1`, same entry shape. |
| Skills directory | `.agents/` and `.claude/worktrees/` are in `.gitignore`. Skills are restored per machine: `"skills:install": "npx skills experimental_install"` (also `vp run skills:install`). Only `.claude/skills/delete-comment/SKILL.md` is tracked. `workflow.md` says to check `ls .agents/skills ~/.agents/skills` at session start and run `vp run skills:install` if both are empty. | Skills are vendored and committed in `.agents/skills/` (about 28 skills). `.claude/skills/<name>` are symlinks to them. `TSTACK-LICENSE` credits tstack. The `babysit-pr` script is `.agents/skills/babysit-pr/scripts/pr-wait`. |
| `.claude/settings.json` | none | One Stop hook: `node "$CLAUDE_PROJECT_DIR/scripts/agent-proof-check.mjs"`. It holds the first stop of a turn when the branch changes UI files and fewer than three screenshots under `.mediastash/proof/` are newer than the last UI edit. The second stop passes (`stop_hook_active`). |
| `tasks/` | none | 10 deferred refactor plans, one Markdown file each, such as `split-storage-adapter-files.md`. Each starts `Status: deferred (...). Not started. From the architecture review of <date>.` then `## Why`, `## Change`, `## Benefit`. Not referenced from `AGENTS.md` or `docs/agents/`. One `.failing-test.draft.ts` sits beside a plan. Treat them as a parking lot for work found but not done. |
| `docs/specs/`, `docs/research/` | `docs/adr/` | `docs/adr/`, `docs/specs/`, `docs/research/`, `docs/guides/` |

Skills worth installing in the new project (names seen in both projects' `skills-lock.json`):

- Workflow: `caveman`, `caveman-compress`, `code-review`, `codebase-design`, `diagnosing-bugs`, `grilling`, `grill-me`, `handoff`, `implement`, `implement-spec`, `improve`, `pr`, `tdd`, `to-spec`, `to-tickets`, `triage`, `writing-for-agents`.
- Unslop: `unslop-all`, `unslop-git`, `unslop-react`, `unslop-tests`, `unslop-text`, `unslop-typescript`, `unslop-ui`, `unslop-diff` (mediastash only).
- UI: `frontend-design`, `shadcn`.

TabLodge adds `challenge-feature`, which both projects call before any new feature.

## 2. Agent development flow

### 2.1 Task steps

Both flows are the same shape. TabLodge `docs/agents/workflow.md` has the more compact version (8 steps, quoted in summary):

1. Worktree. A new `<type>/<short-topic>` branch from latest `origin/master`. Types: `feat/`, `fix/`, `docs/`, `chore/`, `refactor/`. Run `pnpm install` in it, which also enables the hooks. mediastash: `git worktree add ../<name> -b <branch> origin/master`, then `vp run dev:setup`.
2. Scope and spec. Run `git status --short` and keep existing user changes. Then find or write the spec.
3. Challenge new features with `challenge-feature`. Skipped for fix, refactor, docs, tooling, and when the user says "implement it" or "just do it".
4. Work, then the validation gate and proof.
5. Commit one self-contained step at a time, each passing hooks alone.
6. Unslop the diff, push, open the PR without asking. Ready for review, never draft.
7. Wait for CI. TabLodge says use the harness's PR watcher, otherwise one `gh pr checks <n> --watch`. Never a `sleep` and `gh pr checks` loop. Up to 3 fix rounds. Then fix only real CodeRabbit findings. Maintainer merges.
8. Clean up and report. Stop every process the agent started, then reply "Done" with the PR link and one line on proof.

mediastash adds:

- Stopping processes only by own handle, never `pkill -f` or by port, because those hit other worktrees' stacks.
- A "shared worktree loop" (status and diff-stat before and after each edit, never reset/restore/checkout/clean/stash).
- `Reading a failed CI run`: `gh run view <run-id> --log-failed | grep -E 'group\]FAILED| FAIL |×|Z Error|error TS' | head -n 40`.
- After green CI the agent stops and waits. It never merges or enables auto-merge. "Full send" is the keyword that authorizes a merge.

TabLodge `validation.md` adds the numbered gate: add regression test, run `vp run check` and `vp run build`, check runtime in a dev browser, capture proof, unslop, review scope with `git diff --check`, `git status --short`, `git diff HEAD`.

### 2.2 Commit messages

- Style: Conventional Commits with a lowercase type and optional scope, and an issue number in parentheses. Examples from `git log`: `feat: send a whole bookmark column or session to private storage (#503)`, `fix(web): put Up Next actions on the title row on mobile`, `docs(agents): trim documentation.md under base size`, `chore: drop the Android release job and docs`. Merge commits come from GitHub: `Merge pull request #971 from bberka/t3/7b52ce49`.
- Messages come from the `unslop-git` skill. Rules (quoted from its rule list):
  - Summary starts with a verb. No "This commit adds".
  - Blank line after the subject.
  - Body wrapped at 72 characters.
  - No AI vocabulary, no chatbot voice.
  - "git-7 AI tool attribution: 'Generated with...' footers and `Co-authored-by` trailers naming an AI tool. Fix: delete them, every time."
  - Trailers may carry `Closes #123` and a human `Co-authored-by`.
- TabLodge `workflow.md` step 5: "Messages ... name human author only: no `Co-Authored-By`, no AI attribution." and "Model goes in pull request, never in commit."
- mediastash `writing-rules.md`: no em dashes in commit messages or PR text.
- mediastash commits in groups: "one semantic commit per logical change", stage by explicit path, inspect `git diff --cached`.

### 2.3 Co-author trailers

| Where | What it says | Enforced? |
| --- | --- | --- |
| TabLodge `AGENTS.md` | "Commits name human author only. Pull request names model." | No hook. Social rule only. |
| TabLodge `workflow.md` | "no `Co-Authored-By`, no AI attribution" | No hook. |
| TabLodge `unslop-git` skill | git-7 deletes AI trailers | Skill (manual, before push). |
| mediastash | nothing | No. |

`.hooks/_/commit-msg` exists in both repos only because the Vite+ dispatcher generates stubs for every hook name. There is no project-owned `commit-msg` script.

### 2.4 PR template

TabLodge `.github/pull_request_template.md` (full file, quoted):

```markdown
## What and why

<!-- What does this change, and which issue does it address? -->

## Spec

<!-- Link the issue. Copy its Acceptance list and put the proof beside each criterion. For a refactor, docs, or tooling change, one sentence on what must stay true. A feature carries the `Entry points:` and `Settings:` lines from docs/agents/cross-app.md. -->

## Model

<!-- Product name and exact model ID that did the work, for example Claude Sonnet 5.5 (claude-sonnet-5-5). List each model and what it did if several contributed. Write "Human only" if no model was used. -->

## Checklist

- [ ] `vp run check` and `vp run build` pass, or I have explained which checks I couldn't run
- [ ] Tests cover the change, or I have explained why they aren't needed
- [ ] For runtime changes, I tested the affected workflow in the dev browser and recorded the steps and result below
- [ ] Every acceptance criterion has proof below (screenshot, recording, or output, with a before and after for a fix), and nothing beyond the spec was added
- [ ] UI changes work with the keyboard alone and in both themes, anything done by dragging or hovering has a keyboard alternative, and `vp run check:a11y` passes
- [ ] For UI changes, I listed the keyboard and accessibility checks or tools used, workflows tested, and limitations below
- [ ] I ran the `unslop-*` skills on the changed files only and fixed what they found
- [ ] I reviewed the full diff, every changed file supports this request, and unrelated changes are removed
- [ ] Any new permissions are justified and documented; no remote code or background network calls were added
- [ ] Storage changes preserve older data and include a migration where needed
- [ ] Affected docs, Help, website copy, and screenshots are current

## Validation evidence

- Automated checks and results:
- Browser used, steps, and observed result:
- Proof (screenshot, recording, or output), or why browser validation is not applicable:
- Scope review, including why each changed file is needed:
```

Two issue templates sit beside it: `bug_report.md` and `feature_request.md`.

Required PR sections (TabLodge, `validation.md` "Pull request body lists"): Spec with the Acceptance list and proof beside each item, commands run and whether each passed, browser used and steps with result, a11y result for UI changes, proof with before and after for a fix, a statement that the unslop pass ran, why browser validation does not apply (docs or tooling only), and that each changed file is needed.

Naming the model: TabLodge's `## Model` section ("product and exact model ID, with what each model did when several contributed", for example `Claude Sonnet 5.5 (claude-sonnet-5-5)`). mediastash `file-pr` skill: end the description with `Created with <model> in <harness>.` and include subagent models.

The user's global instructions (`~/.pi/agent/AGENTS.md`) set a different report for PR bodies: Summary, Evidence, Merge Danger (Door, Blast Radius, Watch after merge), written with the `pr` skill. Neither repo contradicts that. The Drift template should keep `## Model` and also keep a place for Evidence and Merge Danger.

### 2.5 Review steps

- Self review before the PR: `unslop-diff` (mediastash) or the `unslop-*` table in TabLodge `validation.md`:

| Changed files | Skill |
| --- | --- |
| `.ts`, `.tsx` | `unslop-typescript` (continues into `unslop-react`, `unslop-ui`) |
| `apps/*/tests/` | `unslop-tests` |
| Markdown, copy | `unslop-text` |
| Commit messages | `unslop-git` |

- Scope review: "Keep patch to smallest set of changes implementing request and its tests."
- TabLodge also has CodeRabbit on PRs. The agent fixes only real bugs or acceptance breaks, answers the rest in one line without pushing, and stops after 3 rounds.
- mediastash has the optional `full-stop` (proof, independent review, PR, CI monitor) and `full-send` (also merges) skills, `sol-loop`, and `code-review`. Review uses the session's model. Subagents only on request.
- Both: the maintainer merges.

### 2.6 Proof and screenshots

| Topic | TabLodge | mediastash |
| --- | --- | --- |
| Viewports | 440x956 @3x phone, 768x1024, 1440x900, 1920x1080, in light and dark | 390x844, 820x1180, 1440x900 |
| Where saved | `apps/extension/.dev/evidence/` (gitignored), viewport and theme in file name | `.mediastash/proof/` (gitignored) |
| Upload | `vp run evidence <pr> <files>` (`scripts/publish-evidence.ts`) prints Markdown image links to paste into the PR body (`gh pr edit <pr> --body-file`). "Path on your disk is not proof." | Not uploaded. No `proof/*` branches or image links in the PR. The PR describes each screenshot and gives the local path. |
| Final chat message | embeds every screenshot with an absolute path: `![mobile 440 light](/abs/path.png)` | same, grouped by view and labeled with viewport |
| Contact sheet | `vp run proof:sheet <files or folder>`, open the one image once | same (`scripts/proof-sheet.mjs`) |
| Assertions | The capture script asserts text, visibility, no horizontal scroll, no console errors, then look once | same |
| Data | `--seed-data` sample data | seeded dev stack with developer sign-in. Never mock the page, never a throwaway harness. |
| Enforcement | none | Stop hook `agent-proof-check.mjs` |
| Follow-ups | "Every change gets own screenshots", including requests after the PR opens | same |

The user's global rule (embed proof images in the final chat message by absolute path, and upload them in a PR) matches TabLodge.

## 3. Git hooks

### 3.1 TabLodge (Vite+ hooks)

- Install: `package.json` script `"prepare": "vp hooks enable --hooks-dir .hooks"`. `pnpm install` runs it. It sets `core.hooksPath` to `.hooks/_`, a generated dispatcher directory (it has its own `.gitignore`). The hook scripts themselves sit in `.hooks/` and are committed.
- `vp hooks status` shows the state. A new worktree has no hooks until `pnpm install` runs there.
- The `.vite-hooks/_` directory in the repo root is a leftover of the default directory name and is not used.

`.hooks/pre-commit` (full):

```sh
# Work happens on a branch; master and main change only through pull requests (AGENTS.md).
branch=$(git branch --show-current)
if [ "$branch" = master ] || [ "$branch" = main ]; then
	echo "Commits go on a branch, not $branch. Create one first: git switch -c <type>/<topic>" >&2
	exit 1
fi

# Lint the staged files, then type check the project. The full test suite runs before a push.
# XO only checks here and never edits files, so lint-staged's backup stash is not needed; it would also go on
# the stash list that every worktree shares. --quiet drops the warning about the missing backup, not lint errors.
vp staged --no-stash --quiet
pnpm exec tsgo -b
```

`.hooks/pre-push` (full):

```sh
# The same checks CI runs first: lint, type checks, and the tests.
vp run check
```

`vp staged` reads the `staged` block of `vite.config.ts`:

```ts
staged: {
	'*.{ts,tsx,js,mjs,cjs}': 'xo',
	'package.json': 'xo',
},
```

- No `commit-msg` script.
- Timing: not stated for the hooks. `docs/agents/ci.md` / `test.yml` comments give XO cold start about 8 s and full lint about 50 s (about 20 s per third). `tsgo -b` is described as "about ten times faster than `tsc -b`".
- Rules about hooks (`workflow.md`): "Hooks check and never edit. Fix findings with `pnpm exec xo --fix <files>` and stage result. Bypassing off limits: `--no-verify`, `VP_GIT_HOOKS=0`, `VITE_GIT_HOOKS=0`, `HUSKY=0`, and `vp hooks disable`."
- Workaround noted: if `pnpm` on PATH is a broken shim, `PATH=/usr/bin:$PATH git commit ...` and leave hooks on.

### 3.2 mediastash (Husky 9)

- Install: `"prepare": "husky"`, devDependency `husky ^9.1.7`. Scripts in `.husky/`.
- Shared helper `scripts/git-hooks/protected-branch.sh` defines `PROTECTED_BRANCHES="main master"`, `is_protected_branch`, `block_protected_branch` (prints "Direct <commit|push> to '<branch>' is blocked. Create a feature branch and open a pull request.").
- `.husky/pre-commit` runs in order:
  1. Block commit on a protected branch.
  2. `git diff --cached --check` (whitespace errors and conflict markers).
  3. When `.md` or `docs/` is staged: `pnpm run docs:check` (`scripts/verify-readme-commands.mjs`, checks README command references).
  4. When `AGENTS.md`, `CLAUDE.md`, `docs/agents/` or the budget file is staged: `pnpm run agent-context:check`.
  5. Reject added lines with an em dash or a spaced en dash (grep over `git diff --cached -U0`).
  6. `vp lint <staged code files>` (ts, tsx, js, jsx, mjs, cjs).
- `.husky/pre-push`: reads the pushed refs from stdin and blocks any update or delete of `main`/`master` on the remote (catches `git push origin HEAD:main`), then runs `vp run lint`. "The PR's CI runs every other check."
- `.husky/commit-msg` is only the Husky stub.
- No timing stated for hooks. `scripts/ci.mjs` (not a hook) takes "about 70 seconds for `app` area", "about two minutes" for everything.
- The Claude Code Stop hook is a separate guard (see 1.5).
- "`--no-verify` skips hooks, so not substitute for remote branch protection, agents must not use it."

Recommendation: TabLodge's `vp hooks` setup, because the new project is Vite+ and needs no extra dependency. Take mediastash's shared protected-branch helper, the pre-push ref check, and the em dash check.

## 4. Tooling

### 4.1 Versions

| Item | TabLodge | mediastash |
| --- | --- | --- |
| pnpm | `"packageManager": "pnpm@12.15.0"` | `"packageManager": "pnpm@12.18.0"`, `engines.pnpm ">=12"` |
| Node `engines` | `"^22.18.0 \|\| >=24.11.0"` | `">=20"` |
| Node in CI | 24 (`actions/setup-node@v7`, `cache: pnpm`) | 22 (composite action) |
| `vite-plus` | `catalog:`, `1.6.0` (global `vp` on this machine is 1.4.0, local 1.6.0) | `catalog:`, `1.6.0` |
| `vite` | `catalog:` = `npm:@voidzero-dev/vite-plus-core@1.6.0` | same |
| Test | `vp test run` (Vitest bundled in Vite+) | `vp test run`, plus `vitest` pinned in the catalog at `5.1.0`, `@vitest/coverage-v8` 5.1.0, `@vitest/ui` 5.1.0 |
| TypeScript | `typescript ^6.0.3`, plus `@typescript/native-preview ^7.0.0-dev.20260707.2` (the `tsgo` binary) | `tsc -b` per app |
| Type checker command | `tsgo -b` (root script `typecheck`) | `tsc -b && vp build` |
| Lint and format | `xo ^5.0.1` with `eslint-config-xo-react ^0.32.0`, Prettier through XO (`{prettier: true}`) | `vp lint` (oxlint) config under `lint:` in root `vite.config.ts`. No formatter. |
| React | 19.3.1 | 19.3.1 (React Compiler via `@rolldown/plugin-babel`) |
| Tailwind | `tailwindcss` and `@tailwindcss/postcss` 4.3.5, exact | `tailwindcss ^4.3.5`, `@tailwindcss/vite ^4.3.5`, `tw-animate-css ^1.4.0` |
| Playwright | `^1.65.0` | `1.65.1` |
| Husky or `vp hooks` | `vp hooks` | `husky ^9.1.7` |

### 4.2 `package.json` (TabLodge root)

Header fields: `"private": true`, `"type": "module"`, `engines`, `packageManager`. Scripts (the ones Drift should copy or adapt):

```json
"prepare": "vp hooks enable --hooks-dir .hooks",
"skills:install": "npx skills experimental_install",
"evidence": "node scripts/publish-evidence.ts",
"proof:sheet": "pnpm --filter tablodge-extension run proof:sheet",
"version:next": "node scripts/release-version.ts next",
"test": "vp test run",
"test:watch": "vp test",
"typecheck": "tsgo -b",
"lint": "xo",
"lint:fix": "xo --fix",
"format": "xo --fix",
"check": "xo && tsgo -b && vp test run && node scripts/comment-ratchet.ts",
"check:changed": "node scripts/check-changed.ts",
"check:comments": "node scripts/comment-ratchet.ts",
"check:agent-context": "node scripts/agent-context.ts",
"clean": "..."
```

Node runs the `.ts` scripts directly with type stripping (`node scripts/x.ts`), hence `erasableSyntaxOnly` in `tsconfig/node.json`. Root devDependencies: `@types/chrome`, `@types/node ^24.19.2`, `@typescript/native-preview`, `eslint-config-xo-react`, `typescript`, `vite: catalog:`, `vite-plus: catalog:`, `xo`.

mediastash root scripts of note: `dev`, `dev:all`, `dev:setup` (all call `node scripts/dev.mjs` with flags), `check:changed` (`scripts/check-changed.mjs`), `ci` (`scripts/ci.mjs --areas=...`), `lint` (`vp lint`), `docs:check`, `dashes:check`, `comments:check`, `version:check`, `agent-context:check`, `agent-context:write`, `dev:browser:install` (`playwright install chromium`), `dev:proof`, `proof:sheet`, `worktree:cleanup`.

### 4.3 `pnpm-workspace.yaml`

TabLodge (full):

```yaml
packages:
  - .
  - apps/*
allowBuilds:
  esbuild: true
  # wrangler's local runtime downloads its platform binary on install.
  workerd: true
  # Prebuilt binaries come from optional dependencies; its postinstall check isn't needed.
  unrs-resolver: false
catalog:
  vite: npm:@voidzero-dev/vite-plus-core@1.6.0
  vite-plus: 1.6.0
minimumReleaseAgeExclude:
  - expo@58.0.25
  - expo-dev-client@58.0.20
  - expo-dev-launcher@58.0.20
  - expo-sqlite@58.0.17
overrides:
  vite@*: "catalog:"
patchedDependencies:
  expo-share-intent@9.0.0: patches/expo-share-intent@9.0.0.patch
peerDependencyRules:
  allowAny:
    - vite
  allowedVersions:
    vite: "*"
```

mediastash:

```yaml
packages:
  - "packages/*"
  - "apps/*"
overrides:
  babel-plugin-react-compiler: 1.0.0
  sharp: 0.35.5
  source-map-js: 1.2.2
  vite@*: "catalog:"
  vitest@*: "catalog:"
  workbox-build>glob: ^14.0.2
allowBuilds:
  esbuild: true
  unrs-resolver: true
  workerd: true
catalog:
  vite: npm:@voidzero-dev/vite-plus-core@1.6.0
  vitest: 5.1.0
  vite-plus: 1.6.0
  "@vitest/coverage-v8": 5.1.0
  "@vitest/ui": 5.1.0
peerDependencyRules:
  allowAny: [vite, vitest]
  allowedVersions: {vite: "*", vitest: "*"}
```

What this means:

- The `catalog` entry `vite: npm:@voidzero-dev/vite-plus-core@1.6.0` plus `overrides: vite@*: "catalog:"` makes every package that asks for `vite` get Vite+'s core build. `peerDependencyRules` silences the version mismatch.
- `allowBuilds` is pnpm 12's allow list for install scripts.
- `minimumReleaseAgeExclude` is the exception list for pnpm's minimum release age setting.
- Patches live in `patches/<name>@<version>.patch` and are listed in `patchedDependencies`. A single-app project probably needs none.

### 4.4 `vite.config.ts`

TabLodge (full, 13 lines):

```ts
import {defineConfig} from 'vite-plus';

export default defineConfig({
	test: {
		include: ['apps/*/tests/**/*.test.ts', 'scripts/**/*.test.ts'],
		environment: 'node',
	},
	staged: {
		'*.{ts,tsx,js,mjs,cjs}': 'xo',
		'package.json': 'xo',
	},
});
```

No `run.tasks` here. The extension has its own `apps/extension/vite.pages.config.ts` and the build is custom in `apps/extension/scripts/build.ts`.

mediastash root `vite.config.ts` only has a `lint` block (oxlint): `ignorePatterns` (`**/node_modules/**`, `**/dist/**`, `**/out/**`, `**/.next/**`, `**/coverage/**`, `**/*.tsbuildinfo`, `**/next-env.d.ts`), `plugins: ["unicorn","typescript","oxc"]`, and per-folder `overrides` (React hooks rules for web/admin, `no-console` and `no-explicit-any` as errors for admin). `apps/web/vite.config.ts` is the real app config: `defineConfig` from `vite-plus`, plugins `@vitejs/plugin-react` (with `reactCompilerPreset`), `@rolldown/plugin-babel`, `@tailwindcss/vite`, `vite-plugin-pwa`, `@vitejs/plugin-basic-ssl` (optional HTTPS), `rollup-plugin-visualizer` (when `ANALYZE=true`). `apps/web/package.json` scripts call `vp dev`, `vp build`, `vp preview`, `vp lint`, `vp test run`.

### 4.5 `xo.config.ts` (TabLodge)

Shape of the file (about 300 lines). Parts to copy, in order:

1. Imports `xoReact from 'eslint-config-xo-react'`, `type {XoConfigItem} from 'xo'`.
2. A local rule `local/no-comments` built from `scripts/comment-policy.ts`. It bans all comments except directives with a reason. Files in `scripts/comment-baseline.json` are exempt, and CI runs a ratchet (`scripts/comment-ratchet.ts`, 2026-11-21) so a PR cannot add comments or leave a baseline stale. Optional for Drift: only copy if "Write no code comments" stays a rule.
3. `ignores`: `dist/**`, `release/**`, `docs/**`, `**/dist/**`, `.agents/**`, `.claude/worktrees/**`, `skills-lock.json`, test fixtures.
4. `{prettier: true}`.
5. `...(xoReact({prettier: true}) as XoConfigItem[])` and `{files: ['**/*.tsx'], settings: {react: {version: 'detect'}}}`.
6. Typed lint for TS: `languageOptions.parserOptions` with `projectService: false`, `project: [list of tsconfig files]`, `tsconfigRootDir: import.meta.dirname`.
7. One large `rules` block turning off noisy rules, each with a reason in the commit history only (for example `complexity`, `max-params`, `max-lines`, `max-depth`, `no-await-in-loop`, many `unicorn/*`, `@typescript-eslint/strict-boolean-expressions`, `@typescript-eslint/prefer-nullish-coalescing`) and tuning a few: `eqeqeq: ['error','always',{null:'ignore'}]`, `@typescript-eslint/switch-exhaustiveness-check` with `considerDefaultExhaustiveForUnions`, `jsx-a11y-x/label-has-associated-control` with `controlComponents: ['Checkbox']`.
8. Per-folder overrides: shadcn folder `src/components/ui/**` turns off `@eslint-react/no-forward-ref`, `no-context-provider`, `no-use-context`, `naming-convention-ref-name`, `naming-convention-id-name`, `jsx-a11y-x/heading-has-content`. Tests turn off `@typescript-eslint/naming-convention`. JSON files that hold comments use `language: 'json/jsonc'`. CSS with Tailwind at-rules gets `customSyntax: {atrules: {theme: {prelude: '<ident>*'}, source: {prelude: '<string> | not <string>'}}}`.

Rule from `AGENTS.md`: a lint directive carries its reason: `eslint-disable-next-line rule -- reason`. A guard states what it prevents.

### 4.6 TypeScript layout (TabLodge)

Root `tsconfig.json` is a solution file:

```jsonc
{
	"files": [],
	"references": [
		{"path": "./apps/extension/tsconfig.json"},
		...
		{"path": "./tsconfig/test.json"},
		{"path": "./tsconfig/node.json"}
	]
}
```

`tsconfig/base.json`: `target ES2022`, `module ESNext`, `moduleResolution bundler`, `moduleDetection force`, `strict`, `noEmit`, `skipLibCheck`, `isolatedModules`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `resolveJsonModule`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `forceConsistentCasingInFileNames`, and an `@/*` path alias.

- `tsconfig/node.json` extends base: `module NodeNext`, `moduleResolution NodeNext`, `erasableSyntaxOnly`, `lib ES2024`, `types ["node"]`. Includes `vite.config.ts`, `xo.config.ts`, `scripts/**/*.ts`. Excludes tests.
- `tsconfig/test.json` extends base: `lib ES2024 + DOM`, `jsx react-jsx`, includes `apps/*/tests/**/*.ts` and `scripts/**/*.test.ts`.
- App tsconfig (`apps/extension/tsconfig.json`): extends base, `tsBuildInfoFile` under `node_modules/.tmp/`, `lib ES2023 + DOM`, `jsx react-jsx`, `types ["chrome", "vite-plus/client"]`, `include ["src", ...]`.

mediastash `apps/web`: `tsconfig.json` is a solution file referencing `tsconfig.app.json` (target es2023, bundler resolution, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `types ["vite/client", "vite-plugin-pwa/client", "vitest/globals"]`, `@/*` alias) and `tsconfig.node.json` (`module nodenext`).

Single-app project: keep `tsconfig.json` (solution), `tsconfig/base.json`, `tsconfig/app.json`, `tsconfig/node.json`, `tsconfig/test.json`, all checked with `tsgo -b`.

### 4.7 Other root files

- `.gitignore` (TabLodge): `node_modules/`, `dist/`, `.dev/`, `*.tsbuildinfo`, `node_modules/.tmp/`, `coverage/`, `/.agents/`, `/.claude/worktrees/`, `logs/`, `.DS_Store`, `.idea/`, `.vscode/*` (except `extensions.json`). mediastash adds `.mediastash/`, `.omo`, `.playwright-mcp/`, `.testagent/`.
- `.unslop/` (ledger from the unslop skills) is said to be git-ignored in `validation.md`.
- `LICENSE` (MIT in TabLodge), `VERSION` (see 6).
- `scripts/check-changed.ts`: runs lint, typecheck and tests only for what differs from `origin/master` (a quick loop, never the gate).

## 5. How `vp` is used

Commands seen in the two repos:

| Command | Use |
| --- | --- |
| `vp run <script>` | Everything in the docs. Forwards to a `package.json` script (TabLodge root scripts forward to `pnpm --filter <app> run <script>`) |
| `vp run check`, `check:changed`, `build`, `pack`, `dev:chrome`, `check:a11y`, `evidence`, `proof:sheet`, `browser:install`, `version:next`, `skills:install` | TabLodge tasks (all are package.json scripts) |
| `vp test run`, `vp test` | Vitest once or in watch mode |
| `vp staged --no-stash --quiet` | pre-commit lint of staged files |
| `vp hooks enable --hooks-dir .hooks`, `vp hooks status`, `vp hooks disable` | hook management |
| `vp lint`, `vp dev`, `vp build`, `vp preview` | mediastash (oxlint and Vite built-ins) |
| `pnpm exec vp run build` in CI | CI calls `vp` through pnpm exec so the local version is used |

Facts to remember from `node_modules/vite-plus/docs/guide/run.md`:

- A task is defined in `vite.config.ts` under `run.tasks` or as a package.json script. Not both under the same name.
- `vite.config.ts` tasks are cached by default. package.json scripts are not, unless `--cache` or `run.cache.scripts: true`.
- `run.tasks` accepts a string, an array of strings (run in sequence, like `&&`), or an object with `command`, `dependsOn`, `cache`, `cwd`, `env`.
- Do not split one command into argv in an array. `['vp', 'build']` is two commands.
- `vp run` with no name opens an interactive task picker.
- `vp` global CLI on this machine is 1.4.0. The project's local `vite-plus` 1.6.0 takes over inside a project.
- `vp dev`, `vp build`, `vp test`, `vp lint`, `vp check`, `vp preview`, `vp pack` are built-ins. `vp run dev` and the others run a script or task of the same name.

How Drift should define `dev` and `gui` (option A, recommended, because tasks get caching and `dependsOn` and the file already exists):

```ts
import {defineConfig} from 'vite-plus';

export default defineConfig({
	run: {
		tasks: {
			dev: {command: 'vp dev', cache: false},
			gui: {command: ['vp build', 'vp preview'], cache: false},
		},
	},
	test: {include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'scripts/**/*.test.ts'], environment: 'node'},
	staged: {'*.{ts,tsx,js,mjs,cjs}': 'xo', 'package.json': 'xo'},
});
```

Option B: package.json scripts `"dev": "vp dev"` and `"gui": "vp build && vp preview"`. Pick one place per name, not both. Whether `gui` serves the dev server or a production preview is a product choice, and this file does not decide it.

This sketch is untested. `run.tasks` fields come from the Vite+ docs read above, and it has not been run.

## 6. CI/CD

### 6.1 TabLodge workflows (`.github/workflows/`)

| File | Trigger | What it does |
| --- | --- | --- |
| `test.yml` (290 lines) | `push` to `master`/`main`, `pull_request` | Jobs below. Concurrency `test-${{ github.ref }}`, `cancel-in-progress: true`. `permissions: contents: read`. |
| `agent-context.yml` | `pull_request` (opened, synchronize, reopened, labeled, unlabeled) | Size budget (see 1.4) |
| `pages.yml` ("Website") | `pull_request`, `repository_dispatch: tablodge-release-published`, `workflow_dispatch` | Builds the Astro site. Only a release dispatch or manual run deploys to GitHub Pages (`pages: write`, `id-token: write`). No `paths` filter so the required check always reports. |
| `release.yml` | `workflow_dispatch` only, on the default branch | Described in 6.4 |
| `store-publish.yml` | `repository_dispatch`, `workflow_dispatch` (inputs `version`, `store`), `schedule` cron `17 */6 * * *` | Chrome Web Store and Firefox Add-ons submission with retry. Secret names: `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, variable `CWS_PUBLISHER_ID`, `AMO_JWT_ISSUER`, `AMO_JWT_SECRET`. Not relevant to Drift. |
| `mobile.yml` | `push`/`pull_request` with a `paths` filter | Debug APK, artifact kept 14 days. Not relevant. |
| `sync-server.yml` | `push` to master, `pull_request`, `workflow_dispatch`, with paths | Docker image to GHCR. Not relevant. |

`test.yml` jobs: `changes` (path filter via `gh api repos/.../pulls/$PR/files`, no third-party action), `lint` (matrix of 3 file groups running `pnpm exec xo <paths>`), `comments` (comment ratchet, `fetch-depth: 0`), `typecheck` (`pnpm exec tsgo -b`), `unit` (`pnpm exec vp test run`), browser jobs (`extension`, `a11y` in 4 shards with `A11Y_SHARD`, `browser`, `private-storage`), `cloudflare`, `mobile`, and the required gate `test`.

Common step block (quoted, repeated in each job):

```yaml
    steps:
      - uses: actions/checkout@v7
      # Uses the pnpm version pinned in package.json "packageManager".
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
```

Playwright cache:

```yaml
      - uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}
      - run: pnpm exec vp run browser:install
```

Gate job (required check):

```yaml
  test:
    name: Lint, typecheck, test, build, package, Firefox smoke check
    needs: [changes, lint, comments, typecheck, unit, ...]
    if: ${{ always() }}
    runs-on: ubuntu-latest
    steps:
      # A job skipped by the changes job counts as passed; a failed or cancelled one does not.
      - env:
          RESULTS: ${{ toJSON(needs.*.result) }}
          CHANGES: ${{ needs.changes.result }}
        run: |
          test "$CHANGES" = success
          echo "$RESULTS"
          ! echo "$RESULTS" | grep -Eq 'failure|cancelled'
```

Notes from `docs/agents/ci.md`: keep the gate job name stable because the branch ruleset requires it. Add new jobs to the gate's `needs`. Split a job before it becomes the slowest. Unknown paths turn every job on. Every tracked source file must be in exactly one lint group. The agent-context check is a separate workflow and must be added to the ruleset's required checks by hand.

### 6.2 mediastash workflows

| File | Trigger | What it does |
| --- | --- | --- |
| `test.yml` (101 lines) | `pull_request` (opened, synchronize, reopened, closed), `workflow_call` with input `run_full_suite` | One job `CI` on a `self-hosted` runner, `timeout-minutes: 20`, `fetch-depth: 2`. `dorny/paths-filter@v4` maps files to areas (`app`, `server`, `admin`, `landing`, `status`, `sdk`, `contract`, `config`, `tooling`, `docs`, `policy`), then `node scripts/ci.mjs "--areas=$AREAS" --changed-from=HEAD^`. Without filter output (release or non-PR) it runs `node scripts/ci.mjs` in full. Reason for one job: the self-hosted runner executes one job at a time, so separate jobs repeated checkout and install. |
| `agent-context-budget.yml` | `pull_request` (opened, synchronize, reopened, labeled, unlabeled) | Budget check. `runs-on: ubuntu-24.04`. |
| `release.yml` (469 lines) | `workflow_dispatch` (inputs `patch`, `prerelease`, `dry_run`, `force`) | Described in 6.4 |

Reusable composite action `.github/actions/setup-workspace/action.yml` (quoted part): `pnpm/action-setup@v6`, `actions/setup-node@v7` with `node-version: '22'` and `package-manager-cache: false`, then `pnpm install --frozen-lockfile --store-dir "${{ runner.tool_cache }}/pnpm-store"` so the pnpm store stays on the runner disk (a PR-scoped cache miss cost about 2 minutes), then `pnpm run config:build`.

`.github/dependabot.yml`: npm, directory `/`, weekly, `open-pull-requests-limit: 10`, one group `pnpm-dependencies` with pattern `*`.

### 6.3 Caching summary

- TabLodge: `setup-node` `cache: pnpm` for the store, `actions/cache@v4` for `~/.cache/ms-playwright` keyed on the lockfile hash, `cancel-in-progress` for PR runs.
- mediastash: store kept on the self-hosted runner's tool cache. No Actions cache.
- Vite+ also documents GitHub Actions cache for its task cache (`docs/guide/github-actions-cache.md`). Neither project uses it.

### 6.4 Release and versioning (ZeroVer, `VERSION` file)

Both use [ZeroVer](https://0ver.org): `0.<minor>.<patch>`.

- The root `VERSION` file holds only the minor number (TabLodge: `4`, mediastash: `6`). A value that is not digits fails (`scripts/validate-version.js` in mediastash: "VERSION must contain only the ZeroVer milestone number").
- The workflow computes the patch from the latest `v0.<VERSION>.*` tag (TabLodge `scripts/release-version.ts next`). Example from `ci.md`: `VERSION` = 1, latest 0.1.1, next 0.1.2. Set `VERSION` to 2 and the next release is 0.2.0. The minor cannot go below the latest released minor. `vp run version:next` shows the next version locally.
- Release is manual: Actions, Release, Run workflow, on the default branch (`if: github.ref == ...default_branch`). Concurrency group `release` with `cancel-in-progress: false`.
- TabLodge sequence: compute version (fails if tag exists), stamp version into `apps/extension/shell/manifest.json` (source holds `0.0.0`), run `vp run check` and `vp run build`, package ZIPs with SHA256 checksums, create the GitHub release under tag `v0.x.y`, send `repository_dispatch` `tablodge-release-published` (starts Pages deploy and store publishing), then sub-jobs for the Docker image and signed APK.
- mediastash sequence:
  1. `prepare`: verify the ZeroVer policy, check whether this commit is already released (a published non-draft release whose tag points at the commit), compute the next patch (optional `patch` override, `prerelease`, `dry_run`, `force` inputs).
  2. Tag the release commit.
  3. Validate the commit (reuses `test.yml` through `workflow_call`).
  4. Deploy jobs, each with a GitHub `environment` (`production-pages`, `production`, `production-admin`, `production-status`): Cloudflare Pages through `wrangler pages deploy`, D1 migrations, Worker.
  5. Create the GitHub release (`Media Stash <version>`) only after all deploys succeed. A failed run leaves a tag, and a retry still deploys.
  6. Sets `APP_VERSION` in `packages/config/src/index.ts` at build time (the source is not edited in git).

For Drift the useful part is the VERSION to tag logic and the "only create the release after deploy" order. A static web app needs one deploy job.

### 6.5 Deployment targets

- TabLodge: GitHub Pages for the Astro site (Pages source must be set to GitHub Actions once), GitHub Releases for ZIPs and APK, GHCR for the Docker image, Chrome Web Store and Firefox Add-ons, Cloudflare Worker via a prebuilt `worker.js` and a `release` branch.
- mediastash: Cloudflare Pages (web app, landing, admin, status) and a Cloudflare Worker with D1, through `wrangler`. Secrets resolved in a `Resolve Cloudflare auth` step (the composite action `.github/actions/cloudflare-auth`). Secret values are not recorded here.
- Drift is a client-side app, so it needs no server. GitHub Pages (TabLodge's `pages.yml` pattern) or Cloudflare Pages (mediastash's pattern) both fit. The choice is open (see section 11).

### 6.6 Required checks

Not stored in the repo. TabLodge `ci.md` says "`test.yml` keeps one required gate job named like branch ruleset expects" and that one ruleset targets the default branch. Required checks to set in a ruleset: the gate job `test`, `Build site` (Pages), `Agent instructions size` (the agent-context workflow), plus a rule requiring a PR.

## 7. Tailwind and shadcn

| Item | TabLodge (`apps/extension`) | mediastash (`apps/web`, `packages/ui`) |
| --- | --- | --- |
| Tailwind | 4.3.5, CSS-first, no `tailwind.config` (`"config": ""`). `@tailwindcss/postcss` via `postcss.config.cjs`: `module.exports = {plugins: {'@tailwindcss/postcss': {base: __dirname}}}`. | 4.x via `@tailwindcss/vite` plugin. Theme in shared package `packages/ui/src/theme.css`, imported from `apps/web/src/index.css` (`@import "tailwindcss"; @import "tw-animate-css"; @import "@mediastash/ui/theme.css";`). |
| shadcn config | `apps/extension/components.json` | `apps/web/components.json` |
| Style / base | `style: new-york`, `baseColor: zinc`, `cssVariables: true`, `iconLibrary: lucide`, `rsc: false`, `tsx: true` | `style: new-york`, `baseColor: neutral`, same flags, plus one extra registry (`@kibo-ui`) |
| `tailwind.css` path | `styles/extension-app.css` | `src/index.css` |
| Aliases | `@/components`, `@/lib/utils`, `@/components/ui`, `@/lib`, `@/hooks` | same |
| Add a component | `pnpm dlx shadcn@latest add <component>`, then review the generated code | `ui:add` and `ui:diff` scripts: `pnpm dlx shadcn@latest add`/`diff` |
| UI location | `apps/extension/src/components/ui/*.tsx` (alert-dialog, button, card, checkbox, context-menu, dialog, dropdown-menu, input, label, popover, scroll-area, select, switch, textarea, tooltip, ...) | `packages/ui/src/*.tsx`, source-only, no build step, exports map per file |
| Deps | `@radix-ui/react-*` per primitive, `class-variance-authority ^0.7.1`, `clsx ^2.1.1`, `tailwind-merge ^2.6.1`, `lucide-react ^1.72.0` | `radix-ui 1.8.1` (single package), `tailwind-merge ^3.7.0`, `next-themes`, `sonner`, `tw-animate-css`, `lucide-react` |
| Rules | `docs/agents/ui.md` | `docs/agents/frontend-rules.md`, `DESIGN.md`, `.agents/skills/shadcn/` (rules for forms, icons, composition, styling) |

TabLodge `apps/extension/styles/extension-app.css` outline (the useful part for the new project):

```css
@import 'tailwindcss';

@source not '../dist';
@source not '../tests';

@theme {
	--color-background: rgb(var(--background));
	--color-foreground: rgb(var(--foreground));
	--color-card: ...; --color-popover: ...; --color-primary: ...; --color-secondary: ...;
	--color-muted: ...; --color-accent: ...; --color-destructive: ...;
	--color-border: ...; --color-input: ...; --color-ring: ...;
}

@layer base {
	:root {
		color-scheme: light;
		--background: 250 250 250;
		--foreground: 24 24 27;
		--card: 255 255 255;
		--primary: var(--brand-primary);
		--muted-foreground: 100 100 110;
		--destructive: 220 38 38;
		--border: 228 228 231;
		--input: 212 212 216;
		--ring: var(--brand-primary);
		--radius: 0.5rem;
	}
	:root[data-theme='dark'] {
		color-scheme: dark;
		--background: 9 9 11;
		--foreground: 250 250 250;
		--card: 17 17 20;
		--border: 39 39 42;
		--input: 63 63 70;
		...
	}
	@media (prefers-color-scheme: dark) {
		:root[data-theme='system'] { ...same dark values... }
	}
}
```

- Tokens are space-separated RGB triples, wrapped with `rgb(var(--x))` in `@theme`. This differs from the current shadcn default (oklch values), so a fresh `shadcn init` would produce oklch tokens.
- Tailwind 3 palette values were restored in `@theme` (`--color-amber-*`, `--color-emerald-*`) and the default border color was set back to gray-200 in `@layer base`, for the Tailwind 3 to 4 migration. Skip this in a new project.
- Dark mode: attribute `data-theme` on `<html>` with values `light`, `dark`, `system`. A boot script (`shell/theme-boot.ts`) sets it before first paint, so there is no flash. `theme.tsx` takes over afterwards. The `system` value uses a `prefers-color-scheme` media query. Accent colors (`--brand-primary-*`) vary at runtime by inline style. Both themes must be checked for every UI change.
- mediastash: dark-first. `DESIGN.md` says the app is "a dark, focused media library" with a violet accent. Tokens: `background`, `card`, `popover`, `secondary`, `muted`, `foreground`, `muted-foreground`, `primary`, `ring`, `success`, `warning`, `destructive`, `info`. Theming through `next-themes` and palettes in `packages/ui/src/palettes.ts`. Font: Outfit with system fallbacks.
- Both: semantic tokens only (`bg-background`, `text-muted-foreground`), never raw colors. Pointer cursor on anything clickable is set once in the base CSS rule, and a test enforces it in TabLodge (`tests/pointer-cursor-rule.test.ts`). Icons from `lucide-react`. Icon-only buttons need `aria-label` plus a tooltip. Scroll areas use the `ScrollArea` component, not bare `overflow-y-auto`.

## 8. Accessibility and UI checks worth copying

TabLodge runs axe-core on every page in both themes plus keyboard workflows (`scripts/a11y/`, `vp run check:a11y`, 4 shards in CI). Rules in `docs/agents/ui.md`: WCAG 2.2 AA, a keyboard alternative for anything done by drag, hover, or right click, visible focus, `aria-label` on icon buttons, `showStatus` announcements, targets of at least 24 by 24 CSS pixels. For a pixel-sorting editor (canvas, sliders, drag), this applies directly.

## 9. Differences between the projects, with a recommendation

Dates from `git log`: mediastash started 2026-07-03, TabLodge 2026-10-25. Their agent docs have the same shape, and both budget scripts were first committed on 2026-11-20 and 2026-11-21.

| Topic | TabLodge | mediastash | Newer or more deliberate | Recommendation for Drift |
| --- | --- | --- | --- | --- |
| Lint and format | XO plus Prettier (since 2026-10-25) | oxlint through `vp lint`, no formatter | TabLodge (the owner asked for XO) | XO, because the new project requires it. |
| Git hooks | `vp hooks` with `.hooks/` (2026-10-25, pre-commit 2026-11-14) | Husky 9 (2026-10-15) | TabLodge | `vp hooks`, because no extra dependency and same tool as the rest. Add mediastash's protected-branch helper and em dash check. |
| Type checker | `tsgo -b` | `tsc -b` | TabLodge | `tsgo -b`, because it is about 10 times faster. |
| Agent map | `AGENTS.md` only, no `CLAUDE.md` | `AGENTS.md` plus `CLAUDE.md` of `@AGENTS.md`, per folder too | mediastash (and it is documented in `documentation.md`) | Add `CLAUDE.md` with `@AGENTS.md`, because Claude Code reads `CLAUDE.md`, not `AGENTS.md`. |
| Budget check | 3 grouped totals, CI only | per file, CI and pre-commit | mediastash (finer and earlier feedback) | Per-file JSON, pre-commit check and CI, with TabLodge's TypeScript script. |
| PR template | file with `## Model` | none | TabLodge | TabLodge's template, extended (section 11). |
| Proof | uploaded into the PR | local only, shown in chat | TabLodge matches the global rule | Upload with `vp run evidence`, and embed in chat. |
| Proof enforcement | none | Stop hook `agent-proof-check.mjs` (2026-11-18) | mediastash | Copy the Stop hook if the owner uses Claude Code in this project. |
| Skills | not committed, restored from `skills-lock.json` | vendored and committed | TabLodge (smaller repo, lock file, newer lock format `version: 2`) | Lock file and `vp run skills:install`. |
| Comments | banned with a ratchet (2026-11-21) | rules doc, ratchet script too (`comments.mjs`) | both recent | Ask the owner. This is a style decision, not tooling. Left out of the proposed list as optional. |
| CI shape | many parallel jobs on GitHub-hosted runners plus a gate job | one job on a self-hosted runner running `scripts/ci.mjs` | depends on the runner | Parallel jobs on `ubuntu-latest` with a gate job, because the new project has no self-hosted runner and the check list is short. |
| Node | 24 in CI, `engines ^22.18 \|\| >=24.11` | 22 in CI, `>=20` | TabLodge | Node 24 and TabLodge's `engines` range. |
| Release | manual dispatch, `VERSION` minor | manual dispatch, `VERSION` minor, tag then deploy then release | similar | Same flow with one deploy job. |
| `vp run` tasks | package.json only | package.json only | none | Section 5. |
| Domain and design docs | none | `CONTEXT.md`, `DESIGN.md`, `docs/adr/` | mediastash | Add both, because a pixel-sorting editor has domain terms (sort axis, threshold, mask, interval) and a design system. |

## 10. Things to avoid copying

- mediastash's `docs/agents/domain-docs.md` says "Currently no checked-in architectural decision records", but `docs/adr/` holds 66 files. The doc is stale. Do not copy that sentence.
- TabLodge `docs/agents/ci.md` sections on Store publishing, Android and Cloudflare are app-specific. Do not copy.
- `.vite-hooks/` in the TabLodge root holds only generated stubs and is not the configured hooks directory (`.hooks/` is).
- The `.delta/`, `.omo/`, `.testagent/`, `.codegraph/` and `.playwright-mcp/` directories in the mediastash root are agent scratch space. Do not copy them. `.delta/` holds nested worktree copies of the repo.
- `.unslop/` is described as git-ignored in TabLodge `validation.md`, but it is not in the first 40 lines of that `.gitignore`. Add it to the new `.gitignore` explicitly.

## 11. Proposed setup for Drift

Single app at the repository root (no `apps/`), pnpm, Vite+ 1.6, XO, Tailwind 4, shadcn. "Model" names the source project. Files marked "write later" belong to phases after this one. This phase wrote only this research file.

### Agent docs

| File | Purpose | Modelled on |
| --- | --- | --- |
| `AGENTS.md` | Root map: description, layout, hard rules, load-on-demand list. Under about 60 lines. Include rules: branch from `origin/master` (or `main`), no `Co-authored-by` trailer in any commit, PR names every agent and model, proof per acceptance criterion, run unslop before push. | TabLodge `AGENTS.md`, structure from mediastash `documentation.md` |
| `CLAUDE.md` | Single line `@AGENTS.md` so Claude Code loads the map. | mediastash |
| `docs/README.md` | Human entry point, install and run instructions, links. | both |
| `docs/agents/workflow.md` | Worktree, branch types, commit style, PR steps, CI watching, cleanup, hook table, and the Co-authored-by ban with the reason. | TabLodge `workflow.md` |
| `docs/agents/validation.md` | Gate (`vp run check`, `vp run build`), proof rules, viewports, screenshot upload, "report only what you ran", unslop table, PR body contents. | TabLodge `validation.md` (viewport list from mediastash if the owner prefers 3) |
| `docs/agents/spec-driven.md` | Issue format with Acceptance list and when a spec is required. | TabLodge |
| `docs/agents/issue-tracker.md` | `gh` commands and triage labels. | TabLodge |
| `docs/agents/ui.md` | Tailwind tokens, shadcn rules, keyboard and a11y rules, both themes, canvas and slider notes. | TabLodge `ui.md` |
| `docs/agents/ci.md` | Workflow list, gate job name, how to add a job, release steps. | TabLodge `ci.md`, reduced |
| `docs/agents/documentation.md` | How to edit agent docs, the size budget, compress-after-edit rule. | mediastash |
| `docs/agents/writing-rules.md` | Prose rules (em dash ban if the owner wants it). | mediastash |
| `CONTEXT.md` | Glossary of pixel-sorting terms (write later). | mediastash |
| `DESIGN.md` | Design system: identity, color tokens, type, spacing, components (write later). | mediastash |
| `docs/adr/` | Decision records, one file per decision, numbered. | both |
| `tasks/` | Optional parking lot for deferred work, one Markdown file each with a `Status:` line. | mediastash |
| `t3.json` | T3 Code buttons for `vp run dev` and `vp run gui`, with the preview URL (the port is a Vite default decision). | mediastash `t3.json` |
| `skills-lock.json` | Pinned list of skills with source and hash, restored by `vp run skills:install`. | TabLodge (format `version: 2`) |
| `.claude/settings.json` | Optional Stop hook for screenshot proof check. | mediastash |
| `scripts/agent-context-budget.json` and `scripts/agent-context.ts` | Byte budget per agent file and the check (`--write`, `--base`). | TabLodge script, per-file JSON from mediastash |

### Git hooks

| File | Purpose | Modelled on |
| --- | --- | --- |
| `.hooks/pre-commit` | Refuse `master`/`main`, `git diff --cached --check`, run the agent-context check when agent docs are staged, reject added em dashes, `vp staged --no-stash --quiet`, `pnpm exec tsgo -b`. | TabLodge `pre-commit` plus mediastash `pre-commit` extras |
| `.hooks/commit-msg` | Reject any message with a `Co-authored-by:` trailer (case-insensitive), with a message pointing at the rule. This is new, no source has it. Sketch below. | New. Dispatcher stub from `vp hooks` |
| `.hooks/pre-push` | Block pushes to `master`/`main` by reading the refs from stdin, then `vp run check`. | TabLodge `pre-push` plus mediastash ref check |
| `scripts/git-hooks/protected-branch.sh` | Shared `is_protected_branch` and `block_protected_branch` helpers sourced by both hooks. | mediastash |
| `package.json` `"prepare"` script | `vp hooks enable --hooks-dir .hooks`. | TabLodge |

The `commit-msg` sketch. It was not run, and the commit message path arrives as `$1`:

```sh
if grep -qiE '^[[:space:]]*co-authored-by[[:space:]]*:' "$1"; then
	echo "Commit messages must not carry Co-authored-by trailers. Name the agents and models in the pull request (## Agents and models)." >&2
	exit 1
fi
```

Also add a test (`scripts/commit-msg.test.ts` or a shell test) that feeds a message with and without the trailer, because this hook is the only enforcement. Add the same rule as a hard rule in `AGENTS.md` and a sentence in `docs/agents/workflow.md`. Note that GitHub web merges and squash merges can still add trailers on the server side. Mention this in the workflow doc, and turn off "Include co-authors" style settings if the repo offers them.

### CI and GitHub files

| File | Purpose | Modelled on |
| --- | --- | --- |
| `.github/workflows/test.yml` | PR and push checks: `changes`, `lint` (xo), `typecheck` (`tsgo -b`), `unit` (`vp test run`), `build`, optional `a11y` and browser jobs, and gate job `test`. Concurrency cancel, `contents: read`. | TabLodge `test.yml` |
| `.github/workflows/agent-context.yml` | Fail when the agent docs grow over the base branch, unless label `agent-context-increase`. | TabLodge, base ref from mediastash |
| `.github/workflows/pages.yml` (or a Cloudflare Pages job) | Build on PR, deploy on release or manual run. Target is an owner decision. | TabLodge `pages.yml` |
| `.github/workflows/release.yml` | Manual dispatch on the default branch. Compute version from `VERSION`, stamp it, check, build, tag, deploy, create the GitHub release last. | TabLodge `release.yml`, order from mediastash |
| `.github/pull_request_template.md` | Sections: What and why, Spec, Model, Checklist, Validation evidence. See below. | TabLodge |
| `.github/ISSUE_TEMPLATE/bug_report.md`, `feature_request.md` | Issue forms for the spec flow. | TabLodge |
| `.github/dependabot.yml` | Weekly npm updates, one group. | mediastash |
| `VERSION` | One number, the ZeroVer minor. | both |
| `scripts/release-version.ts` | `next`, `set` commands, with a test. | TabLodge |

PR template changes from TabLodge's version:

- Rename `## Model` to `## Agents and models`. The comment must say: list every agent and model that worked on this PR, product name plus exact model ID, one per line, with what each did (for example `Claude Sonnet 5.5 (claude-sonnet-5-5): wrote the code`). Include subagents, reviewers and research agents. Write `Human only` if none.
- Add a checkbox `- [ ] No commit on this branch has a Co-authored-by trailer`.
- Add `## Merge Danger` (Door, Blast Radius, Watch after merge) to match the user's global report format.
- Replace the extension-specific checklist items (permissions, storage migration, dev browser) with ones for the app: the proof screenshots in light and dark at the chosen viewports, and an image processing check with a sample image before and after.

### Config files

| File | Purpose | Modelled on |
| --- | --- | --- |
| `package.json` | `private`, `type: module`, `engines`, `packageManager: pnpm@12.18.0` or newer, scripts from 4.2 plus `dev` and `gui` if option B | TabLodge |
| `pnpm-workspace.yaml` | `catalog` with `vite: npm:@voidzero-dev/vite-plus-core@1.6.0` and `vite-plus: 1.6.0`, `overrides vite@*: catalog:`, `allowBuilds` (esbuild), `peerDependencyRules` | TabLodge |
| `vite.config.ts` | `defineConfig` from `vite-plus`, `run.tasks` with `dev` and `gui` (option A), `test`, `staged`, the React and Tailwind plugins | TabLodge, `@tailwindcss/vite` from mediastash |
| `xo.config.ts` | Ignores, `{prettier: true}`, `xoReact`, typed lint through tsconfig list, rule overrides, shadcn folder override, JSON-with-comments override, CSS `customSyntax` for Tailwind at-rules | TabLodge |
| `tsconfig.json`, `tsconfig/base.json`, `tsconfig/app.json`, `tsconfig/node.json`, `tsconfig/test.json` | Solution file and the three project configs, checked by `tsgo -b` | TabLodge |
| `components.json` | shadcn: `new-york`, `cssVariables: true`, `iconLibrary: lucide`, `tailwind.config: ""`, aliases `@/...` | both (same shape) |
| `src/styles/app.css` | `@import 'tailwindcss'`, `@theme` token map, light and dark variables, `data-theme` handling | TabLodge CSS, dark-first palette from mediastash if wanted |
| `index.html` plus a theme boot script | Sets `data-theme` before first paint | TabLodge `theme-boot.ts` |
| `.gitignore` | `node_modules/`, `dist/`, `.dev/`, `*.tsbuildinfo`, `/.agents/`, `/.claude/worktrees/`, `.unslop/` | TabLodge |
| `LICENSE` | Owner decides which one. | TabLodge |

### Scripts

| File | Purpose | Modelled on |
| --- | --- | --- |
| `scripts/check-changed.ts` | Run lint, typecheck and tests only for what differs from `origin/master`. | TabLodge |
| `scripts/publish-evidence.ts` | Upload screenshots, print Markdown image links. | TabLodge |
| `scripts/proof-sheet.ts` | Combine screenshots into one contact sheet. | TabLodge / mediastash |
| `scripts/agent-context.ts` | See above. | TabLodge |

### Open items for the lead agent and the owner

- Default branch name: both source projects use `master`. Their hooks and CI also accept `main`.
- Deployment target (GitHub Pages or Cloudflare Pages).
- Proof upload (TabLodge) or local only (mediastash). The global rule favors upload.
- Whether to copy the comment ban and ratchet.
- Whether `gui` means the dev server, a production preview, or a packaged desktop shell. Section 5 gives only a placeholder.
- Whether to vendor skills (mediastash) or lock them (TabLodge). The report above recommends lock.
- Nothing here was executed in the new project, and no sources were changed.
