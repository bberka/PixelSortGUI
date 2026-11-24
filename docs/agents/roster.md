Written by Claude Sonnet 5.5 (thinking medium), documentation subagent.
Reconciled by Claude Sonnet 5.5 (thinking medium), documentation subagent.
Updated for owner decisions by Gemini 4 Neon (Antigravity, thought level medium), documentation subagent.

# Roster: which model does which task

The owner approved these models for subagent work. The lead agent picks one per task and writes the choice in the brief. The mapping below is a starting guide; the lead may deviate and says why in the brief.

## Approved models

| Model | Effort | Typical use |
| --- | --- | --- |
| GPT Luna | as offered | Light tasks: small edits, single-file changes, mechanical work, renames, link fixes, and reviews of small diffs. Also used as an independent reviewer for work written by Gemini 4 Neon or Claude Fable. |
| Gemini 4 Neon on Antigravity | thought level low, medium | Standard and larger tasks: features, effects, UI components, tests, specs, docs, scaffolding, and reviews of ordinary diffs. Use low for focused tasks and medium for multi-file work or judgement calls. |
| Claude Fable | effort low, medium | Big tasks, used sparingly: cross-cutting design, the hardest engine work, and anything a Gemini 4 Neon attempt failed at. Only when the rule below says so. |
| deepseek-flash | as offered | Research and bulk reading: reading and summarising large files, comparing options, low-risk bulk work. Its output gets a closer review. |

Do not use a model that is not in this table.

## Choosing

- Start from the lightest model that can do the task as written. A precise brief lets a lighter model succeed.
- Raise effort before raising the model. Low effort for focused changes with a clear spec, medium for anything that touches several files or needs judgement.
- A reviewer runs a different model from the author. A model reviewing its own diff finds fewer problems.
- One task, one model. Do not split a single small task across models.

## When Claude Fable is justified

The lead may use Claude Fable (effort low or medium, used sparingly) only for one of these, and states which in the brief and in the pull request:

- The hardest engine correctness or performance work where a mistake is hard to see in the output: the sorting core, run and interval semantics, worker concurrency and memory handling, any GPU path.
- A cross-cutting design that other tasks depend on, such as the effect interface or the pipeline model.
- A task that failed after a Gemini 4 Neon attempt, or a review that must find subtle bugs in work from the categories above.

Use Claude Fable sparingly. Escalate when a rule above applies; do not escalate out of habit.

## Identifying yourself in a pull request

Every agent that worked on a pull request gets one line in the **Agents and models** section. This includes the lead, subagents, reviewers, and research agents. Use exactly this form:

```
<model name and version> (<effort or thinking level>): <what it did>
```

Examples:

```
GPT 6.0 Luna (thinking medium): fixed broken links in docs/agents and reviewed the diff
Gemini 4 Neon via Antigravity (thought level medium): wrote the threshold effect, its spec, and its tests
Claude Fable (effort medium): designed the worker message protocol
deepseek-flash (no effort setting): summarised the surveyed repositories
```

Rules:

- Use the model name and version your harness reports. Do not guess a version; if you cannot tell, write the name alone, for example `deepseek-flash`.
- Name the effort level as the harness calls it: `effort low`, `thinking medium`, and so on. If the model has no setting, write `no effort setting`.
- Add `via Antigravity` for models reached through Antigravity.
- Say what you did in a clause. A reviewer states how many findings it returned. A lead states that it wrote the brief and reviewed.
- This line goes in the pull request only, never in a commit message or a code file.
