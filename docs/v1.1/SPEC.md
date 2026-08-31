# Kira Studio — v1.1

v1 shipped: the whole application described in `docs/v1/SPEC.md`, closed out through P58 (native
Go adapters, the Node engine sidecar removed). This is the next chapter — a fresh round of
phases, numbered from P1 again rather than continuing v1's own numbering, since v1's numbering was
specific to that spec's scope and this chapter's isn't a continuation of the same list.

`docs/ARCHITECTURE.md` is authoritative for how the app actually works today; this file exists
only to record this chapter's own phases, one row per phase, the same discipline
`docs/v1/README.md` describes for `docs/v1/SPEC.md`.

## Phasing

| Phase | Deliverable | Why here |
|---|---|---|
| **P1 Cutover closeout + dependency/script/folder audit** | The P58f cutover itself (deleting `src/engine`, `enginehost` and the vendored Node runtime — implemented under `docs/v1/SPEC.md`'s P58 row before this chapter opened) plus a full audit of every dependency (`package.json`, `shell/go.mod`) and every script (`scripts/*`, `package.json`'s own `scripts` block) against what the post-cutover tree actually uses, removing anything stale — named example: `tsgo` no longer does anything meaningful now that the toolchain has moved on. Also audit the repository's own folder structure now that it is a single Go backend + single Vue frontend rather than the old two-backend/two-framework (Electron+Node engine) shape, and remove or fold in any stale folders or structural constructs left over from that shape that no longer serve a purpose | P58f leaves a tree with a materially smaller dependency and tooling surface than it had going in; nobody has swept it for what's now dead weight rather than just what P58f itself touched, and starting the new chapter on a clean baseline is cheaper than carrying stale tooling — or a folder layout designed for a shape the app no longer has — into every phase after it |
| **P2 Code review, three rounds** | `AGENTS.md`'s code-review process — three parallel Opus subagents (architecture/structure/maintainability/security; functional correctness/business logic; performance/resource efficiency), findings only, Sonnet fixes every finding — for three full rounds against the tree as it stands after P1, each round starting from what the previous round's fixes actually changed | A hardening pass over the Wails/Go rewrite and the P1 cleanup before building further on top of it; three rounds (not v1's five) since P1 already narrows the tree this review runs against |
| **P3 RAM usage** | Audit where the app's own RAM usage can be reduced, and fix what is found | `docs/PERF.md` records a real, measured memory story but the app has never had a dedicated sweep asking specifically "where is RAM used that doesn't need to be" the way P13 did for v1's own nonfunctional debt |
| **P4 Vue Vapor mode** | Evaluate Vue's Vapor mode (compiled, no-virtual-DOM rendering) against this app's own component tree, and adopt it wherever it genuinely helps | A newer Vue rendering mode with different tradeoffs than the app was originally built against; worth a real evaluation now that the backend rewrite is stable, rather than carrying an unexamined assumption either way |
| **P5 CPU/memory status readout** | Fix the app's own CPU/memory status-bar readout (`internal/metrics`) — the current figure is suspected inefficient and not correct, with CPU in particular reading far higher than expected. Mac-first app: use Activity Monitor's own approach to process CPU/memory accounting as the reference model | User-reported: the status bar's own numbers are not trusted, on the one platform this app ships on |
| **P6 Multi-window correctness** | Make sure the app works correctly with two or more windows open at once | Not verified since the Wails migration; multi-window is a real usage pattern this app should support cleanly, not an edge case |
| **P7 Row coloring settings** | A settings toggle to disable the data grid's row coloring — when off, every row renders white/plain. Separately, drop the distinct color currently applied to string-typed cell values in the grid; strings render in the plain text color like every other type | User-directed UI change: row coloring should be optional, and string values shouldn't stand out from other types by color |
