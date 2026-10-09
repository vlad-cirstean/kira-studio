# P239 result

Commits (branch `p236-239-C`): `a2484cadd` cwd threading, `6105ee28b` statusline wrapper and listener,
`aebcebed7` usage service and sources, `be199fcbf` status-bar item and settings, `6d5ff3dd3` flow and UI
tests, `d314dfd91` docs, `031f7564a` lint fixes.

## Scope changes (user, 2026-10-09)

- Account source removed entirely: no Keychain or `.credentials.json` read, no `api.anthropic.com` call,
  no account setting. Recorded in `P239-plan.md` ("Revision" section).
- `ClaudeUsageService.Get` takes no `refresh` argument (nothing to refresh without an account source).

## Empirical check: statusLine in `claude -p`

Claude 2.1.295, haiku, `--settings` with a `statusLine` capture command:

- Case that applies: the `statusLine` command is NOT invoked in a `-p` run (capture file never written).
- The stream-json output does carry the numbers: one `rate_limit_event` line with
  `rate_limit_info.unifiedWindows.{five_hour,seven_day}.{utilization 0..1, resetsAt epoch s}`.
- So ADE headless runs feed usage from their own output (`adeagent.Handler.OnRateLimits`, source `run`);
  interactive Kira tabs feed through the statusline wrapper (source `session`). Newest wins per window.
  With neither yet: state `waiting`, text `Usage: –`, hint "Start a Claude Code session to see usage".

## Delivered

- `Manager.ComposeLaunch(terminalID, cwd, command)`; cwd threaded through `Tracker.SetHooks`, `Tracker.Compose`,
  `BoundService.ComposeAgent`.
- `internal/agenthooks`: `Options.StatusLine`, `Options.OnStatusLine`, per-launch `settings-<12 hex>.json`
  (0600), shim `statusline` mode (30 s throttle per terminal, user's statusline preserved read-only),
  `POST /statusline` (token, terminal, 64 KiB cap, decodes `rate_limits` only).
- `apps/kira-space/internal/claudeusage`: `Ingest`, `Get`, clamp 0..100, expired window dropped,
  numbers-only persistence to `<KIRA_SPACE_HOME>/claude-usage.json` (0600, atomic), `OnChange` at most once
  per 10 s.
- `ClaudeUsageService` (22nd bound service), push `kira:claude:usage`, setting `claudeCode.usageEnabled`
  (default on; off: no injection, item hidden, `Get` returns `off`).
- Frontend: `state/claudeUsage.ts` (TanStack `useQuery`), `workbench/ClaudeUsageItem.vue`, `StatusBar.vue`
  (ADE mode only), `ClaudeCodePane.vue` switch.
- Tests: `flows/usageflow` (feed, user statusline preserved, throttle, off, expired window, restart, run
  stream), `tests/ui/claude-usage.spec.ts` (9 tests). No parser unit test: the `rate_limit_event` parser has
  no interacting rules.

## Verification

- `go build ./...` and `go build -tags server ./apps/kira-space/...`: clean.
- `GOOS=darwin CGO_ENABLED=0 go vet ./apps/kira-space/internal/claudeusage/`: ok (the darwin agentnotify sink
  still needs cgo, see P238 result).
- `go test -race`: `internal/agenthooks`, `internal/terminal`, `adeagent`, `usageflow`, `notifyflow`, `claudeflow` ok.
- `bun run test:flows:space`: all packages ok except two, both outside this stream:
  `flowharness` "bound services = 22, want 20" (Stream A file, see findings) and one load flake in
  `repoflow` `TestCodeSearch/cancel_stops_events` (passes 3 of 3 reruns).
- `bun run test:ui:space`: `266 passed (6.2m)`.
- `bun run test:unit`: `1826 pass`, `0 fail`.
- `bun run lint`: clean; `bun run lint:go`: `0 issues.`; `bun run lint:dead` (knip): clean.
- No credential or Anthropic endpoint in the new code: `grep -rn "api/oauth/usage\|find-generic-password\|find-generic" apps internal --include=*.go` hits nothing in `claudeusage`, `agenthooks` or `adeagent`.
- Real callers: `appwire/wire.go:100` `OnStatusLine`, `:108`/`:195` `usage.Ingest`; `StatusBar.vue:76` `ClaudeUsageItem`;
  `state/claudeUsage.ts:22` `useQuery`.
- `grep -c application.NewService appwire.go` is 8 (several per line); `Bound()` holds 22 services.

## Not run

- Real-Mac check (signed build, Pro/Max login): item shows `5h n% · wk m%` after one prompt and matches
  `/usage`; user's own statusline still renders in that tab.
- P236 coverage gate and P237 real-claude hook tests: post-rebase (other streams).
