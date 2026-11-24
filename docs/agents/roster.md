Written by Claude Sonnet 5.5 (thinking medium), documentation subagent.
Reconciled by Claude Sonnet 5.5 (thinking medium), documentation subagent.

# Roster: which model does which task

The owner approved these models for subagent work. The lead agent picks one per task and writes the choice in the brief. The mapping below is a starting guide; the lead may deviate and says why in the brief.

## Approved models

| Model | Effort | Typical use |
| --- | --- | --- |
| Claude Haiku | low, medium | Mechanical edits with an exact instruction: renames, typo and link fixes, moving files, filling a template, config tweaks that copy an existing pattern. |
| Claude Sonnet | low | Small, fully specified changes: one component, one parameter, one bug with a known cause. |
| Claude Sonnet | medium | The default for feature work: effects, UI components, tests, specs, docs, scaffolding, reviews of ordinary diffs. |
| deepseek-flash | as offered | Bulk and low-risk work: generating test cases from a spec, repetitive refactors, reading and summarising. Its output gets a closer review. |
| GPT Luna | as offered | Research, comparing options, drafting specs, and an independent second review of work another model wrote. |
| Gemini 4 Neon, thought level medium, on Antigravity | thought level medium | Opus-class work, only when the rule below says so. |

Do not use a model that is not in this table. Claude Opus is not an option for the Opus-class tier: Antigravity's quota for Claude models ran out mid-task during planning.

## Choosing

- Start from the cheapest model that can do the task as written. A precise brief lets a smaller model succeed.
- Raise effort before raising the model. Low effort for single-file changes with a clear spec, medium for anything that touches several files or needs judgement.
- Keep author and reviewer different where the roster allows. A model reviewing its own diff finds fewer problems.
- One task, one model. Do not split a single small task across models.

## When Opus-class is justified

The lead may use Gemini 4 Neon (thought level medium, on Antigravity) only for one of these, and states which in the brief and in the pull request:

- Engine correctness or performance work where a mistake is hard to see in the output: the sorting core, run and interval semantics, worker and memory handling, any GPU path.
- Persistence design and migrations, because a mistake can lose a user's saved projects.
- A cross-cutting design that other tasks depend on, such as the effect interface or the pipeline model.
- A task that failed after three review rounds with Sonnet medium, or a review that must find subtle bugs in work from the categories above.

Cost is not a reason to avoid escalating when a rule above applies. Habit is not a reason to escalate when none does.

## Identifying yourself in a pull request

Every agent that worked on a pull request gets one line in the **Agents and models** section. This includes the lead, subagents, reviewers, and research agents. Use exactly this form:

```
<model name and version> (<effort or thinking level>): <what it did>
```

Examples:

```
Claude Sonnet 5.5 (thinking medium): wrote the threshold effect, its spec, and its tests
Claude Haiku 5.5 (effort low): fixed broken links in docs/agents
GPT 6.0 Luna (thinking medium): reviewed the diff and reported two findings
Gemini 4 Neon via Antigravity (thought level medium): designed the worker message protocol
```

Rules:

- Use the model name and version your harness reports. Do not guess a version; if you cannot tell, write the name alone, for example `deepseek-flash`.
- Name the effort level as the harness calls it: `effort low`, `thinking medium`, and so on. If the model has no setting, write `no effort setting`.
- Add `via Antigravity` for models reached through Antigravity.
- Say what you did in a clause. A reviewer states how many findings it returned. A lead states that it wrote the brief and reviewed.
- This line goes in the pull request only, never in a commit message or a code file.
