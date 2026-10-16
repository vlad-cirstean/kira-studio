# docs/v1.5/ — the v1.5 record

v1.4 shipped six independent reliability/tooling/feature phases (`docs/v1.4/SPEC.md`). This folder
holds the next chapter, **code intelligence** — a fourth top-level subsystem beside `studio`, `api`
and the headless `git` module: a native, read-only, VS Code-like workspace per imported repository
(a filesystem project tree, tabs with preview/permanent/pinned behavior, Monaco-backed file/diff
viewing, in-file and repository-wide Go-native search, quick-open, tree-sitter-derived
go-to-definition/implementation) with the v1.3 git graph mounted as that workspace's own pinned first
tab instead of living only in the separately-installed VS Code extension, plus a local MCP server
that exposes the same code graph to an AI client. The graph's code-review layer (inline AI-feedback
gutter icons, comment threads over a diff) lands too, deferred to the chapter's last phase rather
than alongside the rest of the graph, its own placement in the workspace resolved then rather than
guessed now. Like v1.3's git chapter, this is one cohesive subsystem, so it uses a fresh phase prefix
(C1, C2, …) rather than continuing v1.4's `P` numbering. It holds:

- **`SPEC.md`** — the phases this chapter is built against, one row per phase.
- **`plans/`** — one implementation plan per phase, committed before that phase's implementation
  starts and never edited afterward. None is written as part of this chapter spec.
- **`mcp-repo-map-issues.md`** — starting C5, every phase dogfoods the repo-map MCP server (C3) for
  its own implementation work and logs what it finds. A living log, unlike `plans/`: entries close
  in place rather than getting deleted. A non-trivial open entry blocks the next phase from
  starting until fixed.
- **`mcp-ab-test.md`** — the design, and eventually the results, of a real with/without comparison
  of the MCP server's effect on token usage, run on C7.

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
