# P246 result

Popup routing across windows plus system notifications. Design facts live in `docs/ARCHITECTURE.md`
("Prompt routing (P246)").

Commits: `fc1242466` window order and main key, `7b55ec89d` shared notification sink, `af9082839` router,
`975d7a840` owners, `7699c4848` git credential routing, `4fd3c0430` prompt host, `1fdb8bdd4` tests,
`ab8577407` credential relay UI fix, `9daaeebac` settings baselines, `dd0171c67` e2e-real fix, docs commit after.

## Suites

- Flows, Studio and Space, with the coverage gate: green; `exempt.txt` empty in both apps.
- `go test -race`: `internal/prompts`, `internal/shell`, `internal/pairing`, `gitcred`, `gitsession` green.
- `go vet ./...`, `go build -tags server ./apps/...`, golangci-lint: clean.
- UI: Studio 378 + `sql-schema` rerun, Space 366 + `git-credential-relay` rerun: green.
- Visual: only the two `settings-advanced` baselines changed (new switch); regenerated.
- e2e-real: Studio 28, Space 33: green.

## Deviations and notes

- `GOOS=darwin CGO_ENABLED=0 go vet` cannot run: Wails darwin files need cgo. The darwin sink is
  unchecked until a Mac build.
- Flow suites fail transiently under CPU load (adeflow, termflow, journeyflow); all green when run with
  no competing work. `sql-schema` "stages until Save" failed on the baseline under load too; green idle.
- Pairing queues per client IP, so the mobile flow approves then denies sequentially.
- The scheduler flow tests advance the fake clock a minute at a time until two schedule entries wait,
  because a script created after the scheduler armed joins asynchronously.
- `git-credential-relay` UI spec emits the empty relay and prompt snapshots after `Provide`, since the
  dialog now closes on router withdrawal.
- e2e-real: a plain Chromium page needs `openMainWindow` (added to `@workbench/testing/e2eReal`) to hold
  the main window key; the second page comes from `browser.newPage()`.

## Mac handover (user, signed builds of both apps)

- A due recurring script with two windows open shows the popup only in the first-opened window and
  posts one banner while another app is focused.
- Clicking the banner focuses that window and the popup.
- Answering in Kira removes the banner.
- With every window closed (app still running) the banner click reopens a window showing the popup.
- Studio DB MCP approval does the same.
- `Send test notification` works in both apps.
- First use asks the macOS permission once.

Until then the macOS notifications item stays in Known open items.
