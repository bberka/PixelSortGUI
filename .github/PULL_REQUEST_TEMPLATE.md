## Summary

<!-- Before → after, one line per behavior change, as a user would see it. Then the files changed, grouped. -->

- 
- Files: 
- Spec: <!-- path under docs/specs/, or "none, docs/tooling change" -->

## Evidence

**Tests:** <!-- exact command → result. Name each added or changed test and the bug it catches. Say which checks you skipped and why. -->

**Validation:** <!-- where you ran it, the page or flow, the viewport widths, and what you saw. "not run in app" with the reason if you did not. -->

<!-- UI changes: screenshots at 390x844, 820x1180, 1440x900. If they are not uploaded, list the file paths and write "screenshots not uploaded". -->

## Merge Danger

**Door:** <!-- one-way | two-way. The part that cannot be undone, if any. -->
**Blast Radius:** <!-- none | local | feature | app | consumers | data. Who or what breaks if this is wrong. -->
**Watch after merge:** <!-- what to check, or none -->

## Agents and models

<!-- Required. One line per agent that worked on this PR, including the lead agent, reviewers, and research agents:
     <model name and version> (<effort or thinking level>): <what it did>
     Example: Claude Sonnet 5.5 (thinking medium): wrote the threshold effect and its tests
     Wording rules: docs/agents/roster.md -->

- 

## Checklist

- [ ] No commit on this branch has a `Co-authored-by` trailer or a "Generated with" style attribution line
- [ ] The spec for this change is in `docs/specs/` and was merged or committed before the code
- [ ] Every doc that describes the changed behavior is updated
- [ ] User-visible changes are reflected in the README lists "What works today" and "Not there yet"
- [ ] I ran the checks listed under Tests and reported only what I ran
- [ ] Code copied from another project is MIT, its notice is kept, and `docs/agents/licensing.md` lists it
