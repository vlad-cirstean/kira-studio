# docs/v1.3/ — the v1.3 record

v1.2 built the Api module (`docs/v1.2/SPEC.md`). This folder holds the next chapter: the **Git**
module — a third top-level mode beside Studio and Api — with a fresh phase numbering (P1, P2, …)
rather than a continuation of v1.2's own, the same way v1.1 and v1.2 each numbered from P1. It
holds:

- **`SPEC.md`** — the phases this chapter is built against, one row per phase.
- **`plans/`** — one implementation plan per phase, committed before that phase's implementation
  starts and never edited afterward.

Same discipline as `docs/v1/`, `docs/v1.1/` and `docs/v1.2/`: all four are kept exactly as
originally written once a phase starts. None is retro-edited to track a later change, so a path or
a fact named inside any of them is true **as of the phase that named it**, and may have moved or
changed since. `docs/ARCHITECTURE.md` is authoritative for how the app actually works today; where
the tree, `ARCHITECTURE.md`, and this folder disagree, the tree outranks both, and
`ARCHITECTURE.md` is authoritative for behavior over `SPEC.md`.

## One thing that is different about this chapter

Studio and Api were designed here. **Git was not** — it is brought in from a previously-independent
project ("Kira Version"), whose full 86-commit history was imported into this repository as the
disjoint branch `origin/import/kira-version-vscode-kickoff`. That branch shares no ancestor with
`main` and is **reference material only**: it is read, never merged and never rebased into this
repository's history. Everything this chapter lands is written as ordinary commits on an ordinary
branch forked from `claude/feature-v1-2`'s tip.

Two documents on that branch are worth reading before any phase here:

- **its `docs/SPEC.md`** — the authoritative product description of the Git graph tool (the graph
  at 100k+ commits, the operations reachable from it, the pre-flight hazard analysis, the
  reflog-backed recoverability). `docs/v1.3/SPEC.md` deliberately does not restate it; it records
  what changes on the way in and how the work is phased once it lands here.
- **its `docs/plans/P0.md` … `P4b-remove-electron.md`** — what was actually built there (P0–P4)
  versus what its own spec only planned (P5–P11). `P4b-remove-electron.md` in particular is the
  clearest statement of what a host implementation touches and nothing else, which is exactly the
  boundary this chapter's Wails host has to sit behind.
