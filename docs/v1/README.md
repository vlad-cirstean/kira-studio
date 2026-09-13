# docs/v1/ — the v1 record

This folder is history, not documentation of the app as it exists today. It holds:

- **`SPEC.md`** — the specification v1 was built against, phase by phase.
- **`plans/`** — one implementation plan per phase, committed before that phase's implementation
  started and never edited afterward.

Both are kept exactly as originally written. Neither is retro-edited to track a later change —
including this repository's own later reorganizations — so a path or a fact named inside either one
is true **as of the phase that named it**, and may have moved or changed since. `docs/ARCHITECTURE.md`
is authoritative for the app as it stands today; where the tree, `ARCHITECTURE.md` and this folder
disagree, the tree outranks both, and `ARCHITECTURE.md` is authoritative for behavior over `SPEC.md`.

`SPEC.md` §10's phasing table is closed at P58, the last v1 phase — it does not accrue rows for
post-v1 work. Post-v1 phases get their own rows in `docs/v1.1/SPEC.md` instead, exactly as
`docs/v1.1/README.md` describes; that is the live phasing ledger.
