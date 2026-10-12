# P266 Stream A findings

## Needs from non-owned files

- `scripts/check-ui-primitives.sh` U79 exempt-path logic mis-exempts one path. Stream A added a named permanent line in `stream-a.txt` instead. Script owner: fix, then drop that line.
- `Queries.Get` (plan §5.3) does not exist. `Queries.Update` on a deleted id stands in.
- `Tabs.Save` had no E_CONTRACT path. Added `Required("windowKey")` to `Tabs.List` and `Tabs.Save`.

## Stream A result

Commits on `p266-a` (base 347423322): f10a80a4a (A1), 93a0d2381 (A2), ecfe3df60 (A3), 3350c51de (A4), cee58e1e4 (A5), dbf1f5ac0 (A6), 38260920e (A8). A7 (sweep) needed no commit; allowlists hold only permanent lines.

Allowlist lines remaining: `stream-a.txt` 1 (permanent U79), `go-stream-a.txt` 4 (permanent G4).

Deviations:
- Saved-query not-found mapping (`ErrSavedQueryNotFound`, `backend.studio.query.notFound.body`) and windowKey guard are new Studio behaviour, added so the specs have something to assert.
- Deleted `workbench/TitleBar.vue`; App.vue uses `WorkbenchTitleBar`.

Specs written, not run (no test suites per brief; lint, typecheck, `go build`, `lint:go` green):
- `apps/kira-studio/internal/flows/appflow/errors_test.go` (4 Go flow tests).
- `apps/kira-studio/tests/ui/consistency.spec.ts`. "Duplicate tab" icon, OpenExternal live-region and Color submenu checks were written without a run; selectors may need adjustment.
