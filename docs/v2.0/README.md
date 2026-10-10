# docs/v2.0/ — the v2.0 record

v1.9 continued the running `P` sequence (P96-P125). This chapter continues it from P126: a Kira
Space data-font-size bug (P126), then a three-phase shift of Claude Code agent work from Kira Studio
to Kira Space — agent-activity monitoring extracted into a shared package (P127), a module system
for Kira Space with a terminal module both apps share (P128), and Kira Space's `ade` module, an
agent merge queue across git worktrees (P129). P130-P133 came later from four user requests: a
focus-ring colour flash on inputs (P130), the git graph and review view moved onto shadcn-vue
(P131), the Operations panel extracted, fixed to span the full width and brought to Kira Space
(P132), and custom-script configuration moved from Settings into the terminal module (P133).

- **`SPEC.md`** — the phases this chapter is built against, one row per phase, plus each phase's
  own result section.
- **`plans/`** — one plan per phase (or part/iteration), committed before implementation starts.
  None is written as part of this chapter's opening spec.
- `design/` — user-supplied design for P129's `ade` module (`SPEC.md`, `mockup.html`), placed here
  before P129's planning pass, removed once superseded by the shipped implementation. The two
  fixtures still read by tests moved to `apps/kira-space/internal/adeflow/testdata/` and
  `apps/kira-space/tests/unit/support/fixtures/ade-v2-mockup.html`.
