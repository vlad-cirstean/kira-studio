# P242 Part 1 result

Plan: `P242-part1-plan-iter2.md`. Branch `p242a-G`, rebased on v2.0 after P240.

## Delivered

- `runoutcome` shared package; ADE and prepare runs record outcomes through it.
- `quickcommands` renamed `scripts` (Go, bridge, storage migrations, UI). Terminal module renamed Automations in both apps.
- `scriptruns` store + `ScriptRunsService` (List, Get, Stop, ResolveDir). Terminal registry reports close cause (user/window/quit). `terminal.Open` with `scriptId` takes folder and command from Go, ignores renderer values.
- Runs UI: status badge, elapsed, outcome block with Copy for agent, Runs section with filter, status-bar item, tab badge, script tab status strip.
- Tests: flow tests for runs, outcomes, folder rule; migration tests; UI specs (`automations-*`, runs); e2e-real `automations-real` in both apps.
- Docs: ARCHITECTURE, READMEs, SPEC row.

## Resolved decisions

- ADE worktree toggle moves to Part 2.
- Memory runs stay out of Automations list.
- Bound-method coverage gate: 0 exemptions.

## Deviations

- Clipboard uses `copyOrReportError`, not VueUse `useClipboard` (that util's comment explains).
- `tailOf` not in module context; `tailTerminal` imported directly.
- Tab badge icons static (`loading`/`check`/`error`).
- Blocked folder records a `failed` run with source `start`.
- Run-row click expands outcome; does not focus tab.
- Space `host.ts` gained `tabBadge`.
- `golangci-lint` unusable here (Go version mismatch); used `go vet` + `gofmt`.
- Stale "Terminal module"/"quick-command" comments reworded.

## Checks

- `bun run lint`, `bun run typecheck`: clean.
- `test:flows:space`, `test:flows:studio`, coverage gate (0 exempt), migrations: green.
- Unit tests: green after mock-runtime FQN additions.
- Space UI: 285 pass.
- Studio UI: first full run had 33 failures, all from missing default `scriptRunsList` boot snapshot (422 console error). Added to `bootSnapshots.ts`; reran failing files, 71 pass; automations/color-rails/mode-switch pass.
- Studio visual: `script-dialog` baseline regenerated; unrelated baselines reverted.
- e2e-real: Space 5 pass, Studio 7 pass.
- Real claude: ADE row PASS (0.0079 USD); hook row (`TestTerminalAgentHooks|TestHookPayloadContract|TestShimInertForPlainClaude`) PASS (0.0059 USD).
- `bun run lint:dead`: clean.

## Not done

- Space visual suite not run.
- `go build -tags server ./apps/kira-space/...` fails on missing `frontend/dist-mobile` (environment, not this change).
- Full Studio UI suite not rerun end to end after boot-snapshot fix (affected files rerun only).
