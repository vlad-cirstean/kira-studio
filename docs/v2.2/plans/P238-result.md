# P238 result

Desktop notification when a Kira Space agent session finishes or needs input, and when an ADE headless
run ends. Design facts live in `docs/ARCHITECTURE.md` ("Agent notifications (P238)").

Commits: `9ce4abf89` hook field, `f48064f99` notifier + wiring + bound service + settings,
`8c36a891a` darwin sink, `8badd012d` frontend, `8f1417e42` tests, docs commit after.

Deviations from the plan:

- Terminal tabs are not persisted (`terminalTabStateSchema` comment), so no tab row exists. Name is
  task title, else code repo whose root holds the cwd, else cwd basename.
- `Deps.Alive` is used for run-ended suppression only. A terminal target gets its window from
  `terminal.Registry.WindowOf`, so it is alive by construction; the flow harness registers no real windows.
- `Deps.TaskTitle` added (run task title). `ade.Tracker.RecordOf` added (terminal to ADE record).
- Bindings call lives in `frontend/src/bridge/index.ts` (control.ts only re-exports it).
- Mock bridge edits are in `tests/ui/support/{ipcChannels,mockRuntime}.ts` (the mock lives there, not `tests/fixtures`).
- Fixtures gaining `lastAssistantMessage: ''`: reducer spec, mobile agents spec, `tests/ui/support/adeV2.ts`.
- `go.mod` gains `git.sr.ht/~jackmordaunt/go-toast/v2` (indirect, pulled by the Wails notifications package).
- Plan's `grep -c application.NewService appwire.go` equals 21 is wrong: several calls share a line (8 lines).
  `Wired.Bound()` has 21 entries; `TestHarnessBootsWithDefaultSettings` counts them (see findings).

## Verification checklist

- `grep -rn "notifications.New()" apps/kira-space/*.go`: `apps/kira-space/notify_darwin.go:14: ns := notifications.New()`;
  `head -1 notify_darwin.go`: `//go:build darwin && !server`.
- `go build ./...` ok; `go build -tags server ./apps/kira-space/...` printed `server-ok`.
- `GOOS=darwin CGO_ENABLED=0 go vet ./apps/kira-space/internal/agentnotify/` cannot run: Wails `application` needs cgo
  on darwin (`undefined: errSMAppServiceNotRegistered`). The darwin sink was checked against the module source API by hand only.
- `CGO_ENABLED=1 go test ./apps/kira-space/internal/flows/notifyflow/ -race`: `ok .../flows/notifyflow 22.997s` (12 tests).
- `bun run test:flows:space`: every flow package `ok` incl. `flows/notifyflow 6.469s`, except
  `flowharness`: `harness_test.go:23: bound services = 21, want 20` (Stream A file, see P238-findings.md).
- `bunx playwright test --config=apps/kira-space/playwright.config.ts --project=ui`: `257 passed (7.0m)`.
- `bun run test:unit`: `1826 pass 0 fail`. `bun run lint`, `lint:dead`, `lint:go` (`0 issues.`), `typecheck` (pre-commit) clean.
- P236 coverage gate: not run (Stream A's, not on this branch).
- Mac handover (user), not run here: signed build; Claude terminal tab question then switch app: banner
  "Claude finished · <repo>" with the reply's first line; click focuses window and tab; no banner while looking at
  that tab; permission prompt gives "needs input"; ADE headless run end gives "ADE run done"; Settings toggles and
  "Send test notification" work; first use asks macOS permission once.
