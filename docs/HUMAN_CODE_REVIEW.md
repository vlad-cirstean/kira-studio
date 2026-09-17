# Human PR review methodology

**WIP.**

How to walk a human reviewer through a large PR/module: rate every file, skip what carries no
review risk, group the writeup by risk level instead of file order.

**Human review only.** Doesn't apply to an AI-driven review (`/code-review`, ultrareview) — those
run their own findings-based process over the full diff and shouldn't skip or pre-filter files by
this rubric.

## Importance rating (1-3)

Rate each file 1-3 when presenting a module for review.

- **1 — skip/skim.** Pure types, Zod/interface schemas, CRUD boilerplate, default-object
  factories, narrowing helpers (`asFooTab`-style), lookup/mapping tables with no branching. TS
  compiler and the schema itself already guard correctness here — nothing to break.
- **2 — worth a read.** Some real logic but small or low-risk: status/display-class mapping
  functions, small encode/decode helpers, a data table where a duplicate/wrong entry has a real
  effect (e.g. a keybinding table), a schema/contract file whose blast radius is wide even though
  the file itself holds no logic.
- **3 — review carefully.** Real logic, same bar as this repo's own unit-test carve-out
  (`CLAUDE.md`): a parser/splitter with interacting rules, byte-level codec, pagination/cursor
  arithmetic, round-trip encode/decode of credentials or other sensitive data, an
  invariant-enforcing builder.

## Exclusions — never reviewed, never listed with a rating

- Unit tests (`*.test.ts`, `*_test.go`, etc.).
- Generated code (e.g. `packages/shared/protocol/wire/*.ts`, anything a `scripts/generate-*.sh`
  produces). Check only that the generated output matches its source schema after a regen — never
  review the generated file's own lines.

## Presentation

Group the file list by level, not by directory order.

- **Level 1**: list every filename together, state the shared pattern once (e.g. "Zod schema +
  inferred type, no logic") instead of repeating a reason per file.
- **Level 2 / 3**: one line per file — what the logic does and why it's risky.

Report the split (e.g. "9 files worth your time out of 40 reviewable") so the reviewer sees the
filtering, not just the list.
