# docs/v1.9/ — the v1.9 record

v1.8 closed with `P94` (four-pass code-quality tooling) and `P95` (errcheck/staticcheck, not yet
started) still on its own table; `P94`'s own plan (`docs/v1.8/plans/P94-code-quality-tooling.md`
§2) named a fourth pass — the full-suite flake sweep — that never landed. This folder holds the
next chapter: closing that out, then dropping the repo-map/tree-sitter code-intelligence engine and
extending Biome to lint Vue files, then adopting shadcn-vue/Tailwind/VueUse/Pinia/TanStack Query as
this app's standing UI/state stack. Like v1.6/v1.8, this chapter continues `P` numbering (`P96`+)
rather than taking a fresh letter, since these are independent, unrelated phases rather than one
cohesive subsystem.

- **`SPEC.md`** — the phases this chapter is built against, one row per phase.
- **`plans/`** — one implementation plan per phase, committed before that phase's implementation
  starts and never edited afterward.
