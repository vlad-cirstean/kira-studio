# P266 Stream B findings

Base: F4 tip 347423322, branch p266-b.

## Needs from non-owned files

- `packages/git-core/src/lib/sha.ts` + `index.ts` export: Stream C's `shortSha` (15c4db15d) copied into B4. Merge keeps one copy; expect a trivial add/add conflict, take C's.
- Shared Layout schema (`@shared/domain/layout`) has no `panel.ade.width`. Space keeps it as a Space-only slice in `state/adeLayout.ts`. Move into the shared schema if Studio ever needs it.
- `scripts/check-ui-primitives.sh` U79 exempt path for `bridge/index.ts` never matches. Kept as a named PERMANENT pending line. Fix the pattern, then drop the line.

## Decisions

- Window `view.find` shortcut dropped in favour of palette and View menu entry. The `kira:menu:viewFind` event still runs `view.find`.
- `ReposDialog` virtual row height is `useRowHeight().single + 2` (the `pb-px` gap).
- `MemoryStart` uses `ModuleStart` (front door of the Memory main area), side panels use `EmptyState`.

## Stream B result

Commits (oldest first):

- B1 20280c86e gitrpc, mobileweb, mobileterm catalog errors
- B2 9904a1899 bridge, ADE, memory, renameio, log scopes
- B3 20480b463 shell title bar and palette, ADE width in layout, settings catalog rename
- B4 7d1bc6bc8 ADE views
- B5 4f2cc1dcf repo panels
- B6 8f9ef511d mobile and memory
- B7 343b0a4db specs

Allowlist lines remaining: `stream-b.txt` one pending line (U79 `bridge/index.ts`, PERMANENT) and one PERMANENT U82 line (`mobile/state/useAdeWrites.ts`, UUID slice). `go-stream-b.txt` three G4 lines, all PERMANENT with reasons.

Deviations: none from the ownership table. Layout slice and `shortSha` copy noted above.

Specs written, not run:

- Go: `adeflow/errors_test.go` `TestStaleWorkflowSaveReportsCatalogText`; `mobileweb/respond_test.go` `TestWriteServiceErrorConflictKeepsCatalogText`; `migrate_ade_panel_width_test.go`; `appflow/layout_test.go` (B3).
- UI: `tests/ui/consistency.spec.ts`, `tests/ui/ade-v2-panel.spec.ts` (width), `tests/ui/git-panel-hidden.spec.ts` (updated).
- Mobile: `tests/mobile/consistency.spec.ts`.

Not run: any UI, mobile or Go test suite. Selectors for the diff find widget (`.monaco-editor .find-widget.visible`), the swatch tooltip (`getByRole('tooltip')`) and the day-band label are unverified against a real run.
