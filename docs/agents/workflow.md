Written by Claude Sonnet 5.5 (thinking medium), documentation subagent.
Reconciled by Claude Sonnet 5.5 (thinking medium), documentation subagent.
Updated for owner decisions by Gemini 4 Neon (Antigravity, thought level medium), documentation subagent.

# Workflow: task to merged pull request

Every task that changes a file follows these steps. The lead agent writes the brief, arranges an independent review, and merges once the gates pass. A subagent does the work. The owner reviews at each milestone.

## Roles

- **Owner.** Asks for features and fixes, decides open questions, reviews at each milestone, and can revert.
- **Lead agent.** Acts as product manager. Breaks the owner's request into tasks, picks a model for each from [roster.md](roster.md), writes the brief, arranges review by a different model, merges approved pull requests, and reports to the owner. It does not implement what it can delegate.
- **Subagent.** Does one task in one worktree and hands back a pull request. It starts no subagents unless the brief says so.

## 1. Task brief (lead agent)

A subagent has no access to the lead's conversation, so the brief must stand alone. Write it with these parts:

- **Goal:** one or two sentences, in the owner's terms.
- **Spec:** the path in `docs/specs/` the work implements. If none exists, the task is to write the spec first (rule: documents come before code).
- **Acceptance criteria:** a checkable list. The pull request answers each one with proof.
- **Scope:** files or areas to touch, and what is out of scope.
- **Branch:** `<type>/<short-topic>`.
- **Model and effort:** from the roster, with the reason if it is a big-task model (Claude Fable).
- **Checks and proof:** which checks to run and what proof to attach.
- **Docs to read:** the exact files, for example `AGENTS.md`, the spec, `CONTEXT.md`.

Done when a reader with no other context could do the task and could tell when it is finished.

## 2. Branch and worktree

- One worktree per subagent task, so parallel tasks never share a working directory. Create it from the up-to-date default branch: `git worktree add ../drift-<topic> -b <type>/<topic> origin/main`. With T3 Code, `delegate_task` with `isolation: "worktree"` does this.
- Branch name is `<type>/<short-topic>`, lowercase, hyphens. Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`.
- Never commit on or push to `main`. The `pre-commit` hook refuses it once the hooks land (see [tooling.md](tooling.md)).
- Hooks are configured per repository clone and apply to every worktree. Once scaffolding exists, run `pnpm install` in a new worktree before the first commit (planned).
- Remove the worktree only if you created it, and only after the pull request is merged or closed.

## 3. Work

1. Read `AGENTS.md`, the brief, the spec, and `CONTEXT.md`. Run `git status --short` and leave changes you did not make alone.
2. If the spec is missing or does not cover the task, write or amend it first, as its own commit. The spec commit comes before the code commit.
3. Implement against the acceptance criteria. Keep the diff to the smallest change that meets them.
4. Update every doc that describes the changed behavior in the same pull request.
5. A pull request that adds, removes or changes something a user can see or do updates the "What works today" and "Not there yet" lists in `README.md` in the same pull request.

## 4. Commits

- Format: Conventional Commits, `type(scope): summary`. Lowercase type, optional scope, imperative verb, subject at most 72 characters, no trailing period. Examples: `feat(engine): add brightness threshold run selection`, `docs: specify the mask format`.
- Body, when the reason is not obvious: blank line after the subject, wrapped at 72 characters, says why and not what.
- One self-contained step per commit. Each commit passes the hooks on its own.
- A commit message holds no `Co-authored-by` trailer, no "Generated with" line, and no model name. Agents and models are named in the pull request only. `.hooks/commit-msg` rejects the first two. If a commit is rejected, fix the message and commit again. Never use `--no-verify` or change `core.hooksPath`.
- The commit author is whatever git is configured with. Do not change it.

## 5. Verify before handing back

The subagent runs these and reports only what it ran:

1. **Checks.** Until scaffolding lands: `sh .hooks/test-commit-msg.sh` when hooks changed, and a check that every path and link in changed docs resolves. After scaffolding: `vp run check` and `vp run build` (planned; see [tooling.md](tooling.md)).
2. **Tests.** New behavior has a test that fails without the change. A fix has a regression test.
3. **Diff review.** Run `git diff --check`, `git status --short`, and read the full diff. Every changed file must serve the brief. Remove the rest.
4. **Unslop.** If the `unslop-diff` skill is installed, run it on the branch diff and apply its fixes. Otherwise reread the diff for filler, restated code, and dead code.
5. **Proof**, as below.
6. **Pull request.** Push and open it ready for review (not draft) with `.github/PULL_REQUEST_TEMPLATE.md` filled in. Every section is filled, including Agents and models. Write `none` under a heading with nothing to say.

## Proof

- **UI change.** Run the app in a desktop browser and check it at three viewport widths: 390x844 (phone width), 820x1180 (tablet width), and 1440x900 (desktop width). This checks responsive layout only; it does not reproduce mobile canvas, memory, or storage limits. Take a screenshot at each width. Assert in the script what can be asserted (text present, no horizontal scroll, no console errors) and look at the screenshots once, after the last edit. Do not mock the page. A fix shows before and after. A follow-up change after the pull request opens gets fresh screenshots.
- **Engine change.** A test over fixed input pixels with expected output, plus a before and after image from a sample photo when the result is visual.
- **Docs or tooling change.** The command output that shows it works, or the link and path check.
- **Where screenshots go.** Save them to a local folder that git ignores, embed them in the final chat message by absolute path, and upload them into the pull request via `scripts/publish-evidence.ts` (`vp run evidence`).
- **Not possible.** Say what you tried and write `Validation: not run in app` with the reason.

## 6. Review (lead agent)

The lead reads the pull request against the brief, not against its own memory of the task, and assigns an independent review agent running a different model from the author.

- Each acceptance criterion has proof. Open the screenshots once as a contact sheet or have a reviewer report in text.
- The diff stays in scope and the spec was updated first.
- The Agents and models section names every agent that worked on it, in the wording from [roster.md](roster.md), and matches who did what.
- `git log --format=%B <base>..HEAD` shows no trailers or attribution lines.
- Licence rule: no code copied from a project that is not on the MIT list in [licensing.md](licensing.md).
- The independent reviewer reviews the diff only and returns findings, not edits.

Send findings back to the subagent as a list. Allow three fix rounds. After that the lead takes the task over or escalates the model (see [roster.md](roster.md)).

## 7. Merge

The lead agent merges, one pull request per task, using squash merge. A pull request merges when:

1. CI is green (before CI exists during scaffolding, review approval alone is the gate).
2. A review agent running a different model from the author has approved the pull request.

The `main` branch is protected so nothing is pushed to it directly. The squash merge commit message must carry no trailer or attribution line; check the final message on `main` after each merge. The owner reviews at each milestone and can revert.

## 8. Clean up

Stop every process you started (dev servers, browsers, watchers). Then report: pull request link, checks run with results, proof.
