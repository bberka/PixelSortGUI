Written by Claude Sonnet 5.5 (thinking medium), documentation subagent.
Reconciled by Claude Sonnet 5.5 (thinking medium), documentation subagent.
Updated for owner decisions by Gemini 4 Neon (Antigravity, thought level medium), documentation subagent.

# Adding an effect

An effect is one image operation the user can put in an effect stack (see [CONTEXT.md](../../CONTEXT.md)). The owner will add custom effects over time, and the lead agent turns each request into the tasks below. The effect interface, the registration mechanism, and where effect code lives are defined in [engine.md](../specs/engine.md). Read that file first. Do not guess or restate them here.

If `docs/specs/engine.md` does not exist yet, stop and tell the lead agent.

## Where the effect's spec lives

One file per effect: `docs/specs/effects/<kebab-name>.md`, where `<kebab-name>` is the effect's lowercase hyphenated name, used for file and directory names only. The effect's `type` in code and saved projects is camelCase (for example `channelShift`), as engine.md section 4.1 requires. If `engine.md` names a different location, `engine.md` wins.

## Steps

### 1. Spec first

Write the spec as its own commit, before any code. It contains:

- **Name and type.** User-facing name, the stable camelCase `type`, and the kebab-case file name.
- **What it does**, in plain language, with one or two before and after sketches or a reference image description.
- **Parameters.** For each: name, type, range, default, unit, and what it changes. Use the words in `CONTEXT.md`.
- **Behavior.** The exact rule for the result, including the edge cases: empty or one-pixel image, fully transparent pixels, a mask that is all on or all off, a parameter at each end of its range.
- **Determinism.** Same input and parameters give the same output. If it uses randomness, say how the seed is stored.
- **Cost and proxy preview.** How it behaves on the proxy preview versus the full-size render, and whether it can be cancelled.
- **Saved data.** What goes into a saved project and preset, per [persistence.md](../specs/persistence.md), and what a project from a different version of the effect does.
- **Provenance.** Where the idea or algorithm comes from. If it comes from a surveyed project, state its licence and whether code was copied; see [licensing.md](licensing.md).
- **Tests.** The list of cases the tests will cover, with concrete small input and expected output where possible.

Done when the lead agent has reviewed the spec. The implementation brief is sent only after that.

### 2. Implement

Follow the interface in `engine.md` and register the effect the way it says. Keep to the spec. If the spec turns out to be wrong or incomplete, change the spec in a separate commit before changing the code.

### 3. Tests

- A test per behavior and edge case in the spec's test list. Small fixed pixel arrays with expected output.
- A determinism test: same input and parameters, same output.
- A test that parameters at each end of their range do not crash and stay in range.
- A saved-project round trip: the effect and its parameters serialize and load back unchanged.
- Run them with the check commands in [tooling.md](tooling.md) (planned; not available until scaffolding lands).

### 4. UI controls

- Write no control code. The parameter panel is generated from the effect's parameter schema (`ParamSpec`, engine.md sections 3 and 4.6), so the labels, ranges, and units in the spec's parameter list must be in the schema. Add UI code only if the effect needs a new `ParamSpec` kind (change `engine.md` and `DESIGN.md` first) or uses the reserved on-canvas tool slot once that slot is implemented (engine.md section 4.7, DESIGN.md section 7.1).
- Check the generated controls in a desktop browser at 390x844, 820x1180, and 1440x900: each parameter has a control with the right label and range, and it works by pointer and keyboard. Take screenshots (see [workflow.md](workflow.md#proof)).

### 5. Docs and notices

- Add any new domain word to `CONTEXT.md`.
- Update the roadmap in `docs/specs/roadmap.md` if the effect is listed there.
- If code was copied from an MIT project, add its notice as [licensing.md](licensing.md) says.

### 6. Pull request

One effect per pull request. Fill the template, including Agents and models, and proof for every acceptance criterion in the spec.
