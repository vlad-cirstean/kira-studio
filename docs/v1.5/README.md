# docs/v1.5/ — the v1.5 record

v1.4 shipped six independent reliability/tooling/feature phases (`docs/v1.4/SPEC.md`). This folder
holds the next chapter, **code intelligence** — a fourth top-level subsystem beside `studio`, `api`
and the headless `git` module: a native, in-app code-navigation surface (file tree, Monaco-backed
file/diff viewing, ripgrep search, quick-open, tree-sitter-derived go-to-definition/implementation)
with the v1.3 git graph mounted directly inside Kira Studio's own shell instead of only the
separately-installed VS Code extension, plus a local MCP server that exposes the same code graph to
an AI client. The graph's code-review layer (inline comment threads over a diff) lands too, deferred
to the chapter's last phase rather than alongside the rest of the graph. Like v1.3's git chapter,
this is one cohesive subsystem, so it uses a fresh phase prefix (C1, C2, …) rather than continuing
v1.4's `P` numbering. It holds:

- **`SPEC.md`** — the phases this chapter is built against, one row per phase.
- **`plans/`** — one implementation plan per phase, committed before that phase's implementation
  starts and never edited afterward. None is written as part of this chapter spec.

Same discipline as every earlier chapter folder: kept as originally written once a phase starts.
None is retro-edited to track a later change, so a path or a fact named inside any of them is true
**as of the phase that named it**, and may have moved or changed since. `docs/ARCHITECTURE.md` is
authoritative for how the app actually works today; where the tree, `ARCHITECTURE.md` and this
folder disagree, the tree outranks both, and `ARCHITECTURE.md` is authoritative for behavior over
`SPEC.md`.

`SPEC.md`'s phasing table accrues rows as new phases land, the same way every earlier chapter's did
— it just does not otherwise change what an earlier phase already said about itself.

Earlier chapters stay in the repository as history; nothing here retroactively edits them, and
`CLAUDE.md` now points at this folder's `SPEC.md` as the live phasing record instead.
