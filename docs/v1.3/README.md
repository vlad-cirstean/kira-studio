# docs/v1.3/ — the v1.3 record

v1.2 shipped the **Api** module (`docs/v1.2/SPEC.md`). This folder holds the next chapter, **git**
— a third top-level subsystem beside `studio` and `api`, shipping **headless**: the git backend
runs inside Kira Studio, and the frontend is a separately-installed VS Code extension. It uses a
fresh phase numbering (G1, G2, …) rather than a continuation of v1.2's own. It holds:

- **`SPEC.md`** — the phases this chapter is built against, one row per phase, G1 through G33.
- **`plans/`** — one implementation plan per phase, committed before that phase's implementation
  starts and never edited afterward.

Same discipline as `docs/v1/`, `docs/v1.1/` and `docs/v1.2/`: all four are kept as originally
written once a phase starts. None is retro-edited to track a later change, so a path or a fact
named inside any of them is true **as of the phase that named it**, and may have moved or changed
since. `docs/ARCHITECTURE.md` is authoritative for how the app actually works today; where the
tree, `ARCHITECTURE.md` and this folder disagree, the tree outranks both, and `ARCHITECTURE.md` is
authoritative for behavior over `SPEC.md`.

`SPEC.md`'s phasing table accrued rows as new phases landed, the same way `docs/v1.1/`'s and
`docs/v1.2/`'s did — it just does not otherwise change what an earlier phase already said about
itself. Its "Known open items" and "Out of scope for v1.3" sections are the one exception, swept at
G33 (the docs closeout) for what the chapter actually resolved.
