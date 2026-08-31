# docs/v1.1/ — the v1.1 record

v1 shipped (`docs/v1/SPEC.md`, closed out through P58). This folder holds the next chapter: a
fresh phase numbering (P1, P2, …) rather than a continuation of v1's, since v1's own numbering
was specific to that spec's scope. It holds:

- **`SPEC.md`** — the phases this chapter is built against, one row per phase.
- **`plans/`** — one implementation plan per phase, committed before that phase's implementation
  starts and never edited afterward.

Same discipline as `docs/v1/`: both are kept exactly as originally written once a phase starts.
Neither is retro-edited to track a later change — including this repository's own later
reorganizations — so a path or a fact named inside either one is true **as of the phase that named
it**, and may have moved or changed since. `docs/ARCHITECTURE.md` is authoritative for the app as
it stands today; where the tree, `ARCHITECTURE.md` and this folder disagree, the tree outranks
both, and `ARCHITECTURE.md` is authoritative for behavior over `SPEC.md`.

`SPEC.md`'s phasing table keeps accruing rows as new phases land, the same way `docs/v1/SPEC.md`'s
did — it just does not otherwise change what earlier phases already said about themselves.

`docs/v1/` stays in the repository as history; nothing here retroactively edits it, and `AGENTS.md`
now points at this folder's `SPEC.md` as the live phasing record instead.
