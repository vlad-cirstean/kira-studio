# docs/v1.4/ — the v1.4 record

v1.3 shipped the **git** subsystem, headless behind a VS Code extension (`docs/v1.3/SPEC.md`). This
folder holds the next chapter. Unlike v1.3, v1.4 has no single headline subsystem — it is a set of
independent reliability, tooling and feature phases across modules that already exist. It uses a
fresh phase numbering (P1, P2, …) rather than a continuation of v1.3's, and returns to the `P`
prefix v1.1 and v1.2 both used: v1.3's `G` prefix marked a chapter that *was* one subsystem, and
this one isn't. It holds:

- **`SPEC.md`** — the phases this chapter is built against, one row per phase.
- **`plans/`** — one implementation plan per phase, committed before that phase's implementation
  starts and never edited afterward. None is written as part of this chapter spec.

Same discipline as `docs/v1/`, `docs/v1.1/`, `docs/v1.2/` and `docs/v1.3/`: all five are kept as
originally written once a phase starts. None is retro-edited to track a later change, so a path or
a fact named inside any of them is true **as of the phase that named it**, and may have moved or
changed since. `docs/ARCHITECTURE.md` is authoritative for how the app actually works today; where
the tree, `ARCHITECTURE.md` and this folder disagree, the tree outranks both, and `ARCHITECTURE.md`
is authoritative for behavior over `SPEC.md`.

`SPEC.md`'s phasing table accrues rows as new phases land, the same way `docs/v1.1/`'s,
`docs/v1.2/`'s and `docs/v1.3/`'s did — it just does not otherwise change what an earlier phase
already said about itself.

Earlier chapters stay in the repository as history; nothing here retroactively edits them, and
`AGENTS.md` now points at this folder's `SPEC.md` as the live phasing record instead.
