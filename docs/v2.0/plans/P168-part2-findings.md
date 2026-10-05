# P168 Part 2: findings, Studio persistence, secrets and connection lifecycle

Review plan: `P168-part2-persistence-secrets.md`. One Opus reviewer, freeform, report only.

- Base commit (tree surveyed by plan): `07036af`. HEAD reviewed: `d817d7b` (`p168-stream-a`; adds
  only the plan doc, no Part 2 file differs).
- Scope: whole chunk, not a diff (shallow clone, plan §1).
- P166 F9 (`storage/model/settings.go:84`) skipped per plan §6. No `P167-code-review.md` exists.
- P108 Part 3 fixes checked and holding: preconnect F1 `WaitDelay` (`supervisor.go:157`), connections
  F4 in-flight cancel (`service.go:667`), variables F2 three-state value (`variables.go:375`), keychain
  F7 duplicate-item length check (`keyring_darwin.go:96`). F1 has a side effect, see F1 below.

## Checks

- `go vet ./apps/kira-studio/internal/...`: clean.
- `go test ./apps/kira-studio/internal/{storage,secrets,localauth,connections,preconnect,datagrip}/...`:
  all `ok`.
- `go test -race -count=1` on `connections`, `preconnect`, `storage/repos`, `localauth`: all `ok`.

No red check.

## Findings

Ranked by severity, then impact.

### F1 (medium): one-shot script leaving an in-group background child is misclassified, and the child outlives Disconnect and quit

`apps/kira-studio/internal/preconnect/supervisor.go:157`, `:166-169`, `:318-324`, `:356-376`.

- What: `cmd.WaitDelay = killGrace` makes `cmd.Wait()` return `exec.ErrWaitDelay` 2 s after the shell
  exits when a background child still holds stderr. Two effects follow.
  1. Classification. Exit plus 2 s always lands after the 2 s settle timer, so the script is tracked
     as a sidecar and its exit code is never checked. `classifyExit(ErrWaitDelay)` also returns
     `outcome{}` ("exit unknown"), dropping the real code, which `cmd.ProcessState` still holds.
  2. Leak. Once `e.exited` closes, `killEntry` skips signalling entirely (P21 r3 finding 6 guard).
     The background child stays in the process group and is never signalled by `Stop`/`StopAll`.
- Scenario (reproduced in a scratch copy of the package): command
  `sleep 30 & echo started >&2; exit 3`. `Start` returns `{Kind: "sidecar"}, nil` after 2.0 s, not
  the "Pre-connect script failed (exit 3)" error. After `Stop`, `sleep 30` is still running. Real
  shape: `kubectl port-forward svc/db 5432 & sleep 1` keeps forwarding after Disconnect and after
  app quit.
- Fix: classify from `cmd.ProcessState` when `Wait` returns `exec.ErrWaitDelay` (exit code kept).
  In `killEntry`, still signal `-e.pid` when the leader is reaped but `Wait` ended via
  `ErrWaitDelay` (a group member held the pipe, so the group is very likely alive). A pgid cannot
  be recycled while any member lives, so that path keeps finding 6's pid-reuse protection. Decide
  separately whether the settle window should still classify a script that already exited.

### F2 (medium): URI-mode password given as a `password=` query parameter is stored and listed in plaintext

`apps/kira-studio/internal/connections/service.go:271-281` (Create), `:332-344` (Update);
`apps/kira-studio/internal/connections/uri.go:19-42`.

- What: `stripURIPassword` only strips userinfo. A libpq-style `?password=` survives into
  `connections.uri`. `pgx.ParseConfig` (`adapters/postgres/client.go:37`) honours that key, so the
  connection works, which hides the problem.
- Scenario: user pastes `postgres://app@db.internal/prod?password=s3cret`. The secret is written
  unencrypted to `kira.db`, bypasses the `kira:v3:` cipher and the reveal gate, and returns in every
  `List`/`listChanged` payload. That breaks D9's "List never leaks a password" guarantee, which
  `validateMode`'s F3 check exists to protect.
- Fix: in Create/Update, move a `password` query value into the three-state password (same
  precedence as userinfo) and remove it from the stored URI. Alternatively reject it with
  `BadRequest`, as F3 does for an ambiguous userinfo password. Apply the same rule in
  `resolveFromInput` for Test.

### F3 (medium): editing a connection while it is connecting leaves it connected to the old destination and old ReadOnly

`apps/kira-studio/internal/connections/service.go:379-399`.

- What: Update reconnects only when status is `connected`. A `connecting` attempt resolved its config
  (`resolve`, `:714`) before the edit, and nothing cancels or redoes it.
- Scenario: a connection with a slow preconnect script or slow network is connecting. The user opens
  Edit, turns on Read-only, and saves. The attempt finishes `connected` with the adapter's captured
  `ReadOnly=false`. The UI shows the connection as read-only while writes still go through. Same for
  a host/database edit: cached metadata from the old destination serves under the new name. No
  frontend guard prevents editing while connecting.
- Fix: treat an in-flight attempt like `connected`. Cancel it, wait for it to finish, then reconnect.
  This depends on F4's fix, since a `Connect` issued right after `Disconnect` currently joins the
  cancelled attempt.

### F4 (low): Disconnect and Remove do not wait for the attempt they cancel

`apps/kira-studio/internal/connections/service.go:638-641`, `:667-674`, `:749-760`, `:469-489`,
`:794-803`.

- What: `cancelInFlight` only cancels. The attempt keeps its `inFlight` entry until `doConnect`
  returns, and its last ctx check (`:752`) is not atomic with the `connected` emit (`:760`).
- Scenarios:
  1. Connect, then Disconnect, then Connect again before the first attempt unwinds (a driver slow to
     honour ctx widens this window). The second Connect joins the cancelled attempt
     (`:638-641`) and returns its `disconnected` state with a nil error. The user's explicit
     Connect silently does nothing.
  2. Disconnect lands between `:752` and `:760`. Disconnect tears down the adapter and emits
     `disconnected`, then the attempt emits `connected`. `states[id]` says connected with no live
     adapter. With Remove, it leaves a `states` entry and a `connected` event for a deleted id.
  3. `emitState` stores under `s.mu` but emits after unlocking (`:228-233`). Two concurrent emits can
     reach the renderer in the opposite order from what `states` holds.
- Fix: in Disconnect and Remove, cancel and then wait on `a.done` before teardown, as `Shutdown`
  already does. Then the attempt's final emit always comes before the caller's own. Optionally have
  `Connect` not join an attempt whose ctx is already cancelled.

### F5 (low): two concurrent reveals outside the grace window show two OS prompts

`apps/kira-studio/internal/localauth/localauth.go:106-133`.

- What: `Authorize` releases `a.mu` after the grace check and calls `evaluate` unlocked. The type
  comment says two windows' Reveal calls really race here. Each call that misses the grace window
  runs its own `evaluatePolicy`.
- Scenario: two windows (or a connection reveal and a variable reveal, which share one
  `*Authorizer`) press Show within one prompt's duration. The user gets two stacked Touch ID or
  password sheets, and the second follows a just-granted first.
- Fix: serialise evaluation with a second mutex (or `singleflight`), and re-check the grace deadline
  after acquiring it. A waiter then reuses the first grant instead of prompting.

### F6 (low): the fixed 5-minute grace window survives system sleep

`apps/kira-studio/internal/localauth/localauth.go:108`, `:130`.

- What: `deadline = now().Add(GraceWindow)` keeps the monotonic reading, so `Before` compares
  monotonic time. Go documents that the monotonic clock may stop while the computer sleeps, and on
  macOS it does. Sleep time does not count toward the window.
- Scenario: user reveals a password, closes the lid for 8 hours, and wakes the Mac. If the Mac does
  not require a password right after sleep, the next reveal is granted with no prompt. That
  contradicts D5's "fixed, non-sliding" contract.
- Fix: compare wall-clock time too, for example `now.Round(0).Before(deadline.Round(0))` together
  with the monotonic check. A backwards wall-clock jump must not extend the window, so require both
  checks to pass.

### F7 (low): the connection name limit counts bytes, but the renderer's schema counts UTF-16 units

`apps/kira-studio/internal/connections/input.go:57`.

- What: `len(name) > maxNameLength` counts bytes. `packages/shared/domain/connection.ts:83`
  (`z.string().trim().max(120)`) counts UTF-16 code units. Also, Create and Update store the
  untrimmed `in.Name`, while the check runs on the trimmed copy.
- Scenario: a 50-character Japanese name (150 bytes) passes the dialog's zod check, then Go rejects
  it with "name must be 1-120 characters".
- Fix: count runes, or UTF-16 units to match zod exactly (`utf16.RuneLen` sum). Store the trimmed
  name. Keep `duplicateName` and datagrip `truncateName` on the same unit.

### F8 (low): the ambiguous-password guard rejects valid IPv6 URIs that contain a later `@`

`apps/kira-studio/internal/connections/uri.go:114-118`.

- What: the heuristic takes the first `:` before the delimiter. For a bracketed IPv6 host, that colon
  is inside the brackets, so the remainder is never all digits.
- Scenario (verified in scratch): `postgres://[::1]:5432/db?application_name=me@corp` and
  `postgres://user@[::1]:5432/db?options=a@b` both return true. Validate rejects them with the
  "percent-encode special characters" error, though neither contains a password.
- Fix: skip a leading `user@` segment and a bracketed `[...]` host before looking for the colon.
  Alternatively, only flag when the text before the delimiter has no `@` and its colon lies outside
  brackets.

### F9 (low): byte caps cut strings mid-rune

`apps/kira-studio/internal/storage/repos/ops.go:105-113`;
`apps/kira-studio/internal/storage/repos/response_history.go:81`, `:141`, `:146`;
`apps/kira-studio/internal/storage/repos/grpc_history.go:87`, `:97`.

- What: `s[:max]` can split a multi-byte rune. `ops.go` stores invalid UTF-8 in `op_log.command` and
  `error`. The snapshot paths are re-encoded by `json.Marshal`, which turns the partial rune into
  U+FFFD.
- Scenario: a 64 KiB+ console batch with CJK text near the cut shows a trailing replacement
  character in Operation history. A truncated non-ASCII response body ends in U+FFFD. Cosmetic,
  with no data-safety impact, but F9 (P108 Part 3) fixed the same class in `filter_history.go`.
- Fix: reuse `truncateUTF8ToBoundary` (`filter_history.go:51`) at each site.

### F10 (low): Reorder accepts partial, stale, or out-of-scope id lists

`apps/kira-studio/internal/storage/repos/connections.go:413-429`;
`apps/kira-studio/internal/storage/repos/variables.go:277-292`, `:700-718`.

- What: each Reorder writes `sort_order = index` for the given ids only. It neither checks that the
  list is the full current set nor reindexes the rest. `VariablesRepo.Reorder` validates `scope` but
  never uses `scope`/`ownerID` in its `UPDATE`, so its doc's "rewrites one scope's sort_order dense"
  is not enforced.
- Scenario: window A reorders connections from a list read before window B created one. The new row
  keeps `sort_order = n-1`, which collides with a reordered row. Order then falls back to name, and
  the next drag reorders from a non-dense base.
- Fix: inside the transaction, apply the given order, then reindex dense every row in scope
  (`sqlitex.ReindexSortOrder`) with unlisted rows appended. Scope the variables `UPDATE` with
  `AND <column> = ?`.

## Coverage

- Reviewed in full: `secrets/*` (cipher, scope, status, all keyring files); `localauth/*`;
  `connections/{service,input,resolve,uri}.go`; `preconnect/{supervisor,tail,signal}.go`;
  `datagrip/{apply,jdbc,scan,configdir}.go`, `datasources.go` parse/bounded-read paths;
  `storage/db.go`; `migrations/embed.go` plus `0018`, `0023`, `0025`-`0029`;
  `repos/{secrets,connections,variables,maskkeys,settings,history,tabs,maintenance}.go`;
  `model/settings.go`; `main.go` `openCore`/`wireAdapters` and teardown order.
- Skimmed: `repos/{ops,response_history,grpc_history,collections}.go` (caps, sweeps, create/save
  paths); `migrations/0001`-`0017` (FK graph via `REFERENCES` grep only); frontend
  `VariableSetView.vue`, `api/state/variables.ts`, `state/tabs.ts` (reachability only).
- Not reached: `repos/{customscripts,filter_history,filters,layout,maskrules,metadata_cache,
  saved_queries,schema,windows,repos}.go` beyond grep hits; `model/*` other than `settings.go`,
  `connection.go` usage, `variables.go`; `datagrip/{keychain_darwin,keychain_other,errors}.go`;
  `migrate_*_test.go`.
- Runtime claims checked in scratch replicas: F1 (copied package, real `/bin/sh`), F8 (copied
  function), and `PRAGMA incremental_vacuum` via `Exec` on modernc v1.58.0 (frees the full
  freelist; not a finding).
