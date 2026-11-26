# Drift

Web GUI editor for glitch art and pixel sorting of still photos. Static-hostable (`drift.bbay.dev`), works offline with no account, state in browser storage, desktop-first, responsive.
Stack: Vite+ (`vp`), pnpm, TypeScript, React 19, Tailwind 4, shadcn, Zustand, xo. Status: v0.2.0 features built; see README.md.
The owner does not write code. A lead agent splits work into tasks, delegates each to a subagent, reviews the result, and merges approved pull requests.

## Hard rules

- Never commit on or push to `main`. Work on a `<type>/<short-topic>` branch in your own git worktree, then open a pull request. The lead agent squash-merges once CI is green and a different-model reviewer approves; the owner reviews at each milestone.
- Never add a co-author or an attribution line to a commit: no `Co-authored-by` trailer, no "Generated with" line. `.hooks/commit-msg` rejects both. Never bypass hooks (`--no-verify`, `core.hooksPath` changes).
- Every pull request lists each agent and model that worked on it, with effort or thinking level and what it did. Use the template in `.github/PULL_REQUEST_TEMPLATE.md` and the wording in [roster.md](docs/agents/roster.md).
- Documents come before code: specify a feature in `docs/specs/` first. A change is not done while a doc describes the old behavior.
- Copy code only from projects that [licensing.md](docs/agents/licensing.md) lists as MIT, and keep their notice. Learn from every other surveyed project, never copy. The project's own licence is MIT (`LICENSE` at the repository root).
- Nothing leaves the browser at runtime: no network calls for app features, no accounts, no analytics, no remote fonts or scripts. Photos stay on the device. Only exception: opt-in cloud backup/sync (product.md F28) may reach its provider and load Google's sign-in script.
- A UI change is checked in a desktop browser at 390x844, 820x1180, and 1440x900 widths (layout check only), with screenshots uploaded to the pull request. Report only what you ran, and say what you could not run.
- Do only the task you were given. Install no tools and add no config unless the task is the scaffolding task.

## Commands

Details in [tooling.md](docs/agents/tooling.md).

- `vp run dev`: dev mode
- `vp run gui`: build, then serve the production build locally at `http://localhost:4173`
- `vp run check`: lint, typecheck, tests
- `vp run build`: production build into `dist/`
- `sh .hooks/test-commit-msg.sh`: tests the commit-msg hook

## Load on demand

- Starting a task, branching, committing, review, merge → [workflow.md](docs/agents/workflow.md)
- Choosing or identifying as a model, effort levels, escalation → [roster.md](docs/agents/roster.md)
- Adding an effect, or a custom feature the owner asked for → [adding-an-effect.md](docs/agents/adding-an-effect.md)
- Reusing code or an algorithm from another project, notices, project licence → [licensing.md](docs/agents/licensing.md)
- Scripts, hooks, CI, size budget, releases, scaffolding task → [tooling.md](docs/agents/tooling.md)
- Domain words (run, interval, mask, effect, effect stack, pipeline, proxy) → [CONTEXT.md](CONTEXT.md)
- What the product is and is not → [product.md](docs/specs/product.md)
- Sorting engine, effect interface, pipeline → [engine.md](docs/specs/engine.md)
- Saved projects, library, browser storage, migrations → [persistence.md](docs/specs/persistence.md)
- Visual design, tokens, components → [DESIGN.md](DESIGN.md)
- Planned order of work → [roadmap.md](docs/specs/roadmap.md)
- Why something was decided → [decisions.md](docs/specs/decisions.md)
- Algorithms and prior art → `docs/research/` (background only; the specs rule where they differ)

If a linked file is missing, tell the lead agent; do not invent its contents.
