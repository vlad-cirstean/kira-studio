# P239 plan: Claude Code usage limits in the status bar (ADE module)

SPEC row P239. User's words: "Show in the status bar, when in the ADE module, the Claude Code usage
limits at that point (5-hour session and weekly windows, % used, reset time). Check how Orca ADE
does it. It uses the Anthropic APIs but I don't know how it gets a token without me doing
anything."

Base: `v2.0` at `a6637fbdf`, on top of P238 (Stream C, sequential: both edit `internal/agenthooks`,
`appwire`, `main.go`, the settings model and `ClaudeCodePane.vue`). One sequential Sonnet
implementer.

Discovery: `codegraph_explore` over `agenthooks` (`Manager.ComposeLaunch`, `buildHooksDocument`,
`shellSingleQuote`, `handleHook`), `internal/terminal` (`BoundService.Open`, `ComposeAgent`).
`apps/kira-space/**` read directly (not indexed): `ade/tracker.go` `Compose`/`SetHooks`,
`appwire/wire.go`, `workbench/StatusBar.vue`, `workbench/modes.ts`, `state/mode.ts`. Research:
Orca source (shallow clone of `github.com/stablyai/orca`, MIT, HEAD `bd85767e`, 2026-10-09),
Claude Code statusline docs (`code.claude.com/docs/en/statusline`), community write-ups, and live
runs of `claude` 2.1.295 in this sandbox.

## 1. Research: what is verified, what is not

### 1.1 How Orca gets usage (read in its source, verified as code, not run)

Three sources, in this order of preference:

1. **Statusline feed** (`src/main/claude/statusline-script.ts`, `agent-hooks/server/server-listeners.ts`):
   Orca installs a `statusLine` command that receives Claude Code's statusline JSON on stdin and,
   when it contains `rate_limits`, POSTs it to Orca's local hook server (throttled, curl,
   loopback, per-pane token). Comment: "Claude Code pipes `rate_limits` to the statusLine command
   on every turn; forwarding it gives Orca live usage without spending the OAuth usage endpoint's
   tight budget." Orca writes this into the user's `~/.claude/settings.json` `statusLine` slot when
   empty (`hook-settings.ts` `applyManagedStatusLine`). Kira must not write that file (P233), so
   Kira uses per-session `--settings` instead (2.1).
2. **OAuth usage endpoint** (`src/main/rate-limits/claude-oauth-usage-request.ts`):
   `GET https://api.anthropic.com/api/oauth/usage`, headers `Authorization: Bearer <accessToken>`,
   `anthropic-beta: oauth-2025-04-20`, `User-Agent: claude-code/2.1.0`, 10 s timeout. Response read
   as `five_hour`, `seven_day` objects with `utilization` (or `used_percentage`) and `resets_at`
   (ISO string or epoch), plus optional `limits[]` (`kind: weekly_scoped`, per model), `extra_usage`,
   `spend`, model-scoped weekly windows.
3. A hidden PTY running Claude's `/usage` and parsing the screen (fallback; not adopted here).

**The token "without you doing anything"**: Orca reads the credentials Claude Code already stored
(`src/main/rate-limits/claude-oauth-credentials.ts`, `src/main/claude-accounts/keychain.ts`):

- macOS: `security find-generic-password -s "Claude Code-credentials" -a <user> -w` (the `security`
  CLI). With `CLAUDE_CONFIG_DIR` set, Claude Code 2.1+ uses service
  `Claude Code-credentials-<first 8 hex of sha256(NFC(config dir))>` (Orca comment).
- Linux/Windows: `<CLAUDE_CONFIG_DIR or ~/.claude>/.credentials.json`.
- Both hold JSON `{"claudeAiOauth": {"accessToken", "refreshToken", "expiresAt", ...}}`. Orca uses
  `accessToken` only and ignores `expiresAt` ("let the server decide").
- For the user's own login Orca does NOT refresh: on a stale token it waits "for the live Claude
  terminal to rotate its credentials" (`claude-oauth-recovery.ts`). It refreshes only accounts it
  manages itself (`oauth-refresh.ts`, `platform.claude.com/v1/oauth/token`, public client id),
  because refresh tokens are single-use and rotating the user's would log Claude Code out.

Why no prompt (inference, not verified): Claude Code itself writes the Keychain item, apparently
through the same `security` tool, so the item's ACL trusts `/usr/bin/security` and another process
calling it gets the secret silently. Verify on the Mac (section 6).

### 1.2 Official statusline data (verified live here)

- Docs: statusline stdin has `rate_limits.five_hour.used_percentage`, `rate_limits.seven_day.
  used_percentage` (0-100) and `.resets_at` (Unix epoch seconds); "appears only for claude.ai Pro
  and Max subscribers ... and only after the first API response in the session"; each window may be
  absent; Claude Code drops a window once its `resets_at` passes.
- Live run (TUI in a PTY, haiku, `--settings` with only a `statusLine` capture command): payload
  keys included `rate_limits` = `{"five_hour":{"used_percentage":3,"resets_at":1791575400},
  "seven_day":{"used_percentage":44,"resets_at":1792044000}}`.
- Live run: a `statusLine` in `--settings` **replaces** the user's own `statusLine` from
  `~/.claude/settings.json` for that session (the user's `echo USERLINE` never rendered). So the
  Kira wrapper must run the user's command and print its output (2.1).

### 1.3 Not verified

- The OAuth endpoint itself: no `.credentials.json` or Keychain here (auth is via env), so no live
  call. Its path, beta header and response shape come from Orca's code and community tools; it is
  undocumented and may change. A 429 burst on this endpoint was reported in March 2026 (community
  issue); Orca's comment calls its budget "tight".
- Whether `/api/oauth/usage` needs a `claude-code/*` User-Agent. Kira will not send another
  product's User-Agent; it sends `kira-space/<version>`. If the Mac check returns 4xx for that
  reason, the account source stays "unavailable" and the statusline source still works.
- Keychain silent read; the config-dir-scoped service name; behaviour for Team/Enterprise seats.

## 2. Design

Two sources, one snapshot.

- **Session source (default on, no token)**: every Kira-started Claude Code session reports its
  statusline `rate_limits` to Kira. Official data, no credential access.
- **Account source (opt-in, default off, D1)**: when no session reported in the last 10 minutes,
  read Claude Code's stored access token read-only and call the usage endpoint.

### 2.1 Statusline feed through the hooks listener (`internal/agenthooks`)

- Signature change: `Manager.ComposeLaunch(terminalID, cwd, command string)`; `ade.Tracker.Compose`,
  `Tracker.SetHooks` fn type and `terminal.BoundService.ComposeAgent` gain `cwd` (Open has
  `args.Cwd`). Studio leaves `ComposeAgent` nil, no change there. Update P238's `notifyflow` calls.
- `Options.StatusLine func() bool`: `claudeCode.usageEnabled`. Off: launches get today's hooks-only
  file, no `statusLine`.
- On: per-launch settings file `<server dir>/settings-<first 12 hex of sha256(terminalID)>.json`
  (0600, rewritten on relaunch of the same tab, removed with the dir on `Close`; bounded by tab
  count) = the hooks document plus `"statusLine": {"type":"command","command":"'<shim>' statusline"}`
  plus the user's own `padding` and `refreshInterval` if set. `--settings` points at it.
- User's statusline, read-only, at compose time: first of `<cwd>/.claude/settings.local.json`,
  `<cwd>/.claude/settings.json`, `<CLAUDE_CONFIG_DIR or ~/.claude>/settings.json` whose
  `statusLine.type` is `command` (the CLI's precedence: local > project > user). Passed to the shim
  as env `KIRA_USER_STATUSLINE` (added to `Server.Env` output for this launch only). Unparseable
  file: treated as absent, logged once at debug. Never written.
- Shim `statusline` mode (`shim.go`), POSIX sh:
  1. `payload=$(cat)`.
  2. If `KIRA_AGENT_HOOK_TOKEN` and `KIRA_TERMINAL_ID` are set and the payload contains
     `"rate_limits"`, and the per-terminal stamp file `${TMPDIR:-/tmp}/kira-sl-$KIRA_TERMINAL_ID`
     is older than 30 s (or absent): touch it, then in the background `printf '%s' "$payload" |
     curl ... --max-time 1 --unix-socket <sock> -H "Authorization: Bearer ..." -H
     "X-Kira-Terminal: ..." --data-binary @- http://localhost/statusline`.
  3. If `KIRA_USER_STATUSLINE` is set: `printf '%s' "$payload" | sh -c "$KIRA_USER_STATUSLINE"`;
     exit with its status. Else print nothing, exit 0.
- Listener: `POST /statusline`, same token and terminal checks as `/hook`, body cap 64 KiB, decodes
  only `{"rate_limits": {"five_hour": {...}, "seven_day": {...}}}` into
  `RateLimits{FiveHour, SevenDay *RateWindow{UsedPercentage float64; ResetsAt int64}}`; nothing else
  is kept. `Options.OnStatusLine func(terminalID string, rl RateLimits)`.

### 2.2 `apps/kira-space/internal/claudeusage` (new)

```go
type Window struct{ UsedPercent float64 `json:"usedPercent"`; ResetsAt int64 `json:"resetsAt"` } // unix ms
type Snapshot struct {
    State     string  `json:"state"`  // ok | waiting | signed-out | unavailable | off
    Source    string  `json:"source"` // session | account | ""
    FiveHour  *Window `json:"fiveHour"`
    SevenDay  *Window `json:"sevenDay"`
    UpdatedAt int64   `json:"updatedAt"`
    Detail    string  `json:"detail"` // short user-facing reason for a non-ok state
}
type Service struct{ /* mu, last Snapshot, account *Account, prefs func() Prefs, now, persistPath */ }
func (s *Service) Ingest(rl agenthooks.RateLimits)          // session source
func (s *Service) Get(ctx context.Context, refresh bool) Snapshot
```

- Clamp percent to 0..100; a window whose `ResetsAt` has passed is dropped on read (CLI semantics).
- Persist the last good snapshot (numbers only, never a token) to
  `<KIRA_SPACE_HOME>/claude-usage.json` (0600, atomic write); load at start so a restart shows the
  last values until they reset.
- `waiting` when nothing is known yet: Detail "Start a Claude Code session to see usage".

Account source (`account.go`, only when `usageAccountFallback` is on and the session data is older
than 10 min or absent):

- `CredentialSource interface{ Read(ctx) (Credential, error) }`, `Credential{AccessToken string;
  ExpiresAt time.Time}`. Implementations:
  - `fileCredentials` (all OSes): `<CLAUDE_CONFIG_DIR or $HOME/.claude>/.credentials.json`.
  - `keychainCredentials` (`keychain_darwin.go`, `darwin`): `exec.CommandContext(ctx,
    "/usr/bin/security", "find-generic-password", "-s", service, "-a", user, "-w")`, 5 s timeout;
    service per 1.1 including the config-dir variant. darwin tries keychain, then the file.
  - Parse `claudeAiOauth.accessToken`, `expiresAt` (ms). Read only. No refresh, no rotation, no
    write, no copy into app config, no caching of the token beyond the one request (zero the local
    after use; Go cannot truly wipe, so keep it in one stack variable and do not store it).
  - Expired (`ExpiresAt` before now): no request; state `signed-out`, Detail "Claude Code sign-in
    expired; run claude to refresh it". Re-read on the next eligible poll (the CLI rotates it).
- `Fetcher`: `GET https://api.anthropic.com/api/oauth/usage`, headers `Authorization: Bearer`,
  `anthropic-beta: oauth-2025-04-20`, `Accept: application/json`, `User-Agent: kira-space/<version>`.
  `http.Client{Timeout: 10s, CheckRedirect: refuse}`. Before sending, assert the URL is `https` and
  host `api.anthropic.com`; the only exception is `AccountOptions.AllowTestEndpoint` (a test-only
  field, documented as such) used by the flow test's local TLS server. Body cap 64 KiB.
- Defensive parser (`parse.go`): window percent from `utilization` or `used_percentage` (number);
  `resets_at` from ISO 8601 string, epoch seconds, or epoch ms (values above 1e10 are ms, Orca's
  rule); missing or wrong-typed window -> nil; both nil -> `unavailable`, Detail "Usage endpoint
  returned no limits"; invalid JSON -> `unavailable`. Unknown extra fields ignored.
- Status handling: 200 -> ok; 401/403 -> `signed-out`; 404 -> `unavailable` ("account has no
  subscription usage"); 429 -> keep last values, honour `Retry-After` (seconds or HTTP date), else
  backoff; 5xx/network -> keep last values, backoff.
- Rate: at most one account request per 5 min after a success; failures back off 5, 10, 20, 30 min
  (cap). Driven by `Get(refresh)` calls, no Go ticker (nothing to stop at teardown).
- Logging: status code and state only. Never the token, the Authorization header, or the raw body.
  A `slog` attribute filter is unnecessary if the token never reaches a log call; the flow test
  asserts the log file does not contain the fake token (3.1).

### 2.3 Wiring and bound service (Space 21 -> 22)

- `appwire`: `claudeusage.New(...)`; `agenthooks.Options.OnStatusLine` -> `usage.Ingest`;
  `StatusLine` -> settings read. `Wired.ClaudeUsage *bridge.ClaudeUsageService` (field `Account`
  replaceable by the flow test, the P238 `SetSink` pattern; no harness edit).
- `bridge/claudeusage.go`: `ClaudeUsageService.Get(ctx, args{Refresh bool}) (claudeusage.Snapshot,
  error)`. Push `kira:claude:usage` (Space channel in `bridge/events.go`) on an ingest that changes
  a value, at most once per 10 s. Not on the mobile allowlist.

### 2.4 Settings (`claudeCode` leaves)

- `usageEnabled` (default `true`): session feed + status-bar item. Off: no `statusLine` injection
  for new launches, item hidden, `Get` returns `off`, no account calls.
- `usageAccountFallback` (default `false`, D1): the token read and endpoint call.
- Files: same four as P238 (`model/settings.go`, `repos/settings.go`, `settingsDomain.ts`,
  `ClaudeCodePane.vue`).

### 2.5 Frontend

- `state/claudeUsage.ts`: TanStack Query `useQuery({ queryKey: ['claudeUsage'], queryFn: () =>
  control.claudeUsageGet({ refresh: true }), enabled: mode === 'ade' && settings.usageEnabled,
  refetchInterval: 60_000, refetchOnWindowFocus: true })`; `control.onClaudeUsage` invalidates the
  key. Go owns the real rate limit, so a 60 s client poll costs nothing extra.
- `workbench/ClaudeUsageItem.vue`: status-bar item, shadcn `Tooltip`, Tailwind, codicon `pulse`.
  Text `5h 23% · wk 41%`; tone token at >= 80 % (warning) and >= 95 % (error). States: `waiting` ->
  `Usage: –`, `signed-out` -> `Usage: sign in via claude`, `unavailable` -> `Usage unavailable`.
  Tooltip: per window "<n>% used · resets <local time> (in 2h 10m)" via VueUse `useNow({ interval:
  30_000 })`; source line "From your last Claude Code session, <relative time>" or "From your
  Claude account"; Detail for non-ok states. `data-testid="claude-usage-status"`.
- `workbench/StatusBar.vue` `#right`: `<ClaudeUsageItem v-if="modeStore.mode === 'ade' &&
  settings.claudeCode.usageEnabled" />` before `AppMetricsItem`.
- `ClaudeCodePane.vue` "Usage limits" group: `usageEnabled` switch; `usageAccountFallback` switch
  with the security note below as `FieldDescription` (short form).

## 3. Tests

### 3.1 Go flow: `apps/kira-space/internal/flows/usageflow/` (new, Stream C)

| Test | Asserts |
|---|---|
| `TestStatusLineFeed` | open a claude-code terminal; read the `--settings` path from `ComposeLaunch(id, repo, "claude")`; run its `statusLine.command` via `sh -c` with the launch env and a statusline JSON (rate_limits 23.5 / 41.2) on stdin -> `ClaudeUsage.Get` returns `ok`, source `session`, both windows, `resets_at` in ms; push recorded |
| `TestUserStatusLinePreserved` | temp HOME `~/.claude/settings.json` `statusLine` `printf USER`; wrapper stdout is `USER`; a project `.claude/settings.local.json` override wins; the user files are byte-identical after |
| `TestStatusLineThrottle` | two runs within 30 s -> one post (listener count) |
| `TestUsageOffNoInjection` | `usageEnabled=false` -> settings file has no `statusLine`; `Get` -> `off` |
| `TestExpiredWindowDropped` | ingest a window with `resets_at` in the past -> nil on `Get` |
| `TestAccountFallback` | fake `$HOME/.claude/.credentials.json` (token `kira-test-token`), local `httptest.NewTLSServer` serving the Orca-shaped body (ISO `resets_at`, `utilization`); `usageAccountFallback=true`; `Get(refresh)` -> `account` source; server saw one request with the bearer and beta headers; a second `Get` within 5 min -> no request; credentials file byte-identical; the app log dir contains no `kira-test-token` |
| `TestAccountStates` | expired `expiresAt` -> `signed-out`, zero requests; 401 -> `signed-out`; 429 with `Retry-After: 120` -> last values kept, no request before 120 s (clock via `claudeusage` exported `Now` var, shortened intervals var); malformed JSON -> `unavailable`; endpoint with no windows -> `unavailable` |
| `TestAccountOffByDefault` | default settings with a credentials file present -> zero requests to the fake server, state `waiting` |
| `TestSnapshotSurvivesRestart` | ingest, `app.Restart()`, `Get` returns the persisted values |

### 3.2 Unit: `apps/kira-space/internal/claudeusage/parse_test.go`

Table test for the defensive parser only (interacting rules: two percent field names, three
timestamp encodings, absent/mistyped windows, clamping). Nothing else gets a unit test.

### 3.3 UI tier: `apps/kira-space/tests/ui/claude-usage.spec.ts`

Mock bridge: item hidden in `git`/`terminal`/`memory` modes, shown in `ade`; text and tone for 23 %,
85 %, 97 %; tooltip lists both windows with reset times; each non-ok state's text; hidden with
`usageEnabled` off; settings switches write the two leaves; a `kira:claude:usage` push refreshes
the item.

## 4. User-facing security note (goes in the plan, the Settings description, and ARCHITECTURE)

- Default mode reads no credential. Usage comes from the Claude Code sessions Kira Space starts:
  Claude Code hands the numbers to Kira's status-line hook on this machine; nothing leaves the
  machine.
- The account fallback, if you turn it on, reads the OAuth access token Claude Code stored
  (macOS Keychain item "Claude Code-credentials", or `~/.claude/.credentials.json`) each time it
  polls. Kira keeps it in memory for that one request, sends it only to `api.anthropic.com`, never
  logs, stores or refreshes it, and never edits the credentials. Anyone who can run code as you
  can already read that token; Kira adds no new storage of it.
- The endpoint is not documented by Anthropic. It may change, rate-limit, or stop working, and using
  a Claude Code login token from another app may not match Anthropic's terms for that token. That is
  why it is off by default. If it fails, the item shows "unavailable"; the session feed keeps
  working.

## 5. Docs (`docs/ARCHITECTURE.md`)

- Subsection "Claude Code usage (P239)": two sources, statusline wrapper (user's command kept),
  account fallback rules, rate limits, states, security note.
- Bound count 21 -> 22; `ComposeLaunch` signature; per-launch settings files.
- Known open items: account endpoint unverified against a real subscription; `rate_limits` only for
  Pro/Max; no data until the first API response of a Kira-started session; Team/Enterprise
  unverified.

## 6. Mac verification (user, in the handover)

1. Signed build, Pro/Max login in Claude Code. Start a Claude terminal tab in Kira Space, send one
   prompt. ADE module status bar shows `5h n% · wk m%`; compare with Claude Code's `/usage`.
2. Your own Claude statusline still shows in that tab (if you have one).
3. Settings > Claude Code > enable account fallback; quit all Kira sessions; wait for the poll.
   Note whether macOS shows a Keychain prompt (expected: none). Values match `/usage`.
4. `grep -r "sk-ant-oat" ~/.kira-space/logs` prints nothing. `shasum ~/.claude/.credentials.json`
   (if present) unchanged.
5. Log out of Claude Code (`claude /logout`) -> item shows `sign in via claude` (account source) or
   keeps the last session values until they reset.

## 7. Decision for the user

- D1: account fallback default. Plan default: **off** (verified session feed covers the ADE use
  case; the token path is unofficial). Flip to on only if the user asks.

## 8. Commits

1. `refactor(space): pass cwd through agent launch composition`.
2. `feat(agenthooks): statusline wrapper and rate_limits listener`.
3. `feat(space): claude usage service, session source, persistence`.
4. `feat(space): opt-in account usage source`.
5. `feat(space): usage status-bar item and settings`.
6. `test(space): usage flows, parser table, UI spec`.
7. `docs: claude usage`.

## 9. Verification checklist (orchestrator)

- `grep -rn "api/oauth/usage" apps internal` hits only `claudeusage`; `grep -rn "credentials.json\|find-generic-password" apps internal --include=*.go | grep -v _test` hits only `claudeusage`.
- No writer: `grep -rn "WriteFile\|os.Create\|Rename" apps/kira-space/internal/claudeusage/*.go | grep -v _test` shows only the `claude-usage.json` snapshot write.
- No refresh: `grep -rn "oauth/token\|refreshToken\|refresh_token" apps/kira-space/internal/claudeusage` empty except the parser ignoring the field (none needed).
- Real callers: `grep -n "OnStatusLine\|usage.Ingest" apps/kira-space/internal/appwire/*.go`; `grep -n "ClaudeUsageItem" apps/kira-space/frontend/src/workbench/StatusBar.vue`; `grep -n "useQuery" apps/kira-space/frontend/src/state/claudeUsage.ts`.
- `grep -c "application.NewService" apps/kira-space/internal/appwire/appwire.go` is 22.
- `go build ./...`, `go build -tags server ./apps/kira-space/...`, `GOOS=darwin CGO_ENABLED=0 go vet ./apps/kira-space/internal/claudeusage/`.
- `CGO_ENABLED=1 go test ./apps/kira-space/internal/flows/usageflow/ ./apps/kira-space/internal/flows/notifyflow/ ./apps/kira-space/internal/claudeusage/ ./internal/agenthooks/ -race`; `bun run test:flows:space`; `claudeflow.TestClaudeSettingsUntouched` still passes (one `--settings` path, outside the fake home).
- `bunx playwright test --config=apps/kira-space/playwright.config.ts --project=ui claude-usage settings-claude-code settings-agent-notify`.
- After rebase onto Streams A and B: P236 coverage gate passes; P237 `TestHookPayloadContract` and `TestRealClaudeSettingsUntouched` re-run once with `KIRA_REAL_CLAUDE=1` (hook composition changed).
- `bun run lint`, `bun run typecheck`, `bun run lint:dead`, golangci-lint clean.
