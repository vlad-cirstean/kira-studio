# P242 Part 4 result

Plan: `P242-part4-plan-iter2.md`. D1-D20 implemented as planned.

## Commits

Linewriter move; schedule on script plus migrations (Studio 0037, Space 0030) and `runoutcome`; headless normal runs; scheduler, confirm, Run now, six Bound methods, fakeclock and harness options `WithClock`/`WithScheduleTimeout`; Space failure notice; frontend (editor, rows, confirm popup, run views); tests; UI fixture fixes; docs.

## Checks

- gofmt, `go vet`, golangci-lint (`./internal/...`, both apps), `bun run typecheck`, `bun run lint`, `bun run lint:dead`: clean.
- `go test ./internal/... ./apps/*/internal/...`: green, both coverage gates green with empty `exempt.txt`.
- Studio UI 374 pass, Space UI 363 pass. Visual: Studio `script-dialog` baseline regenerated (schedule switch), Space 8 pass.
- e2e-real: Studio 26, Space 32 pass (new `automations-recurring-real.spec.ts` in each).
- Real claude: `TestSmartScriptRun` both apps PASS.
- Fixes found by the suites: existing UI boot snapshots lacked `mainWindow` (a 422 console error in 36 specs), two script-create expectations lacked `schedule: null`.
- Shared helper `bound()` in `packages/workbench/src/testing/e2eReal.ts` now returns an unquoted string result as is (Wails does not quote `string` returns).

## Notes

- The ADE task picker in the schedule fields needs a saved script (it previews with `listTasks`).
- An archived task reads as "the task no longer exists", same as a deleted one.
- A repeated wall time fires once: `NextFires` drops the second occurrence (`repeatedWall`), so `* * * * *` fires 60 times in the fall-back hour.
- Space e2e-real opens the page with the server's main window key (`MainWindow`) so the popup shows.

## Not done

- Complete flow suites (`:complete`) not run.
