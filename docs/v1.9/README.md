# docs/v1.9/ — the v1.9 record

v1.8 continued the running `P` sequence (P71-P95). This chapter continues it from P96: dropping
the repo-map subsystem, adopting a frontend library baseline (Pinia, TanStack Query, VueUse,
shadcn-vue, Tailwind) and migrating onto it, extracting the git module and native code
workspace into a standalone app, **Kira Space** (P100), a shared app base both apps build on
(P103), and a whole-codebase review (P108).

- **`SPEC.md`** — the phases this chapter is built against, one row per phase, plus each phase's
  own result section.
- **`plans/`** — one plan per phase (or part/iteration), committed before implementation starts;
  findings documents from audit phases sit beside them.
