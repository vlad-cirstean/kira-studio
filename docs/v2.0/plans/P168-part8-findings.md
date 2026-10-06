# P168 Part 8 findings: shared Go base and repo tooling

Plan: `P168-part8-go-base.md`. Base `af3bd8c`; HEAD reviewed `b421550` (plan commit on `820d476`).
Reviewer reports only. Fixer rules: plan §8.

## Findings

### Block 1: listeners and RPC

#### F1 (low, routed Part 14 F4): `localsock.Serve` `wg.Add` races `Close`'s `wg.Wait`

- `internal/localsock/localsock.go:85-97,102-109`.
- `Serve` calls `wg.Add(1)` after `Accept` returns. `Close` closes the listener, then `Wait`s. A conn
  accepted just before `Close` reaches `Add` after `Wait` saw zero.
- Confirmed by scratch probe (deleted): 200 Listen/Serve/Close cycles with a dial loop under
  `-race`. Result: `WARNING: DATA RACE`, and 2 handlers still running after `Close` returned (and
  after `RemoveAll(Dir)`). Real caller: `PI/gitaskpass/broker.go` at app shutdown.
- `agenthooks` checked on its own terms: it serves via `http.Server.Serve`, not `localsock.Serve`.
  `Server.Close` calls `http.Server.Shutdown` (closes the listener, waits for active handlers up to
  5 s), then `RemoveAll`. Not affected. Only the 5 s timeout path falls back to `http.Server.Close`
  without waiting; a handler blocked there is mid-body-read and fails without calling `onEvent`.
  Nothing filed for `agenthooks`.
- Fix: per routed note. One mutex guards a `closed` flag and `Add`. `Serve` checks `closed` under
  the lock; a conn accepted after `closed` is closed without a handler. `Close` sets `closed` under
  the lock before `Wait`. Add a `-race` test (dial loop while `Close`; assert no handler runs after
  `Close` returns). Signatures unchanged; `gitaskpass` needs no edit.

#### F2 (low, routed Part 17 F2): dead `wireError.Kind`

- `internal/rpcstream/frame.go:11-19`.
- `wireErrorFrom` never sets `Kind`. TS `WireError`/`RpcError` (`packages/git-ipc/src/rpc.ts:49-65`)
  no longer carry `kind` (Part 17 fixer). No Go reader (`git grep`).
- Codes checked against `WireErrorCode` (`contract.ts:1040-1052`): every code `rpcstream`
  (`E_INTERNAL`, `E_BAD_REQUEST`, `E_FRAME_TOO_LARGE`) and `gitrpc`/`gitsock` emit is listed.
  Nothing to route.
- Fix: delete `Kind` and rewrite the struct comment ("mirrors rpc.ts WireError: code and message").

#### F3 (low): `localsock.Listen` accepts `TokenBytes <= 0`, giving an empty token that `agenthooks` accepts

- `internal/localsock/localsock.go:70`, `internal/localsock/localsock.go:112-118`;
  `internal/agenthooks/http.go:54`.
- `RandHex(0)` returns `""` with no error (probe: `token0=""`). `agenthooks.handleHook` compares
  `bearerToken(r)` (`""` for a missing header) with `ln.Token` via `ConstantTimeCompare`, which
  returns 1 for two empty slices. So a listener built with `TokenBytes: 0` authenticates every
  request with no `Authorization` header. Both callers pass 32 today: latent, but the guard sits on
  the package whose whole job is this security boundary.
- Fix: `Listen` returns an error when `opts.TokenBytes < 16`. No caller change.

Block 1 other checks, nothing filed:
- Candidate 1 (`creditGate` dead waiter) dropped. Each stream owns its gate (`session.go:316`), and
  `acquire` is only cancelled by that stream's own ctx. Once cancelled, every later `acquire` with
  no credit returns `ctx.Err()`. No live waiter can queue behind a dead one.
- Candidate 10 (`wireErrorFrom` raw message) dropped. Both peers are the same user's authenticated
  local clients (paired `gitsock` client, own renderer). `gitrpc` maps git failures through
  `mapGitError` first; a path in an `E_INTERNAL` message crosses no trust boundary.
- `localsock`: socket created inside a 0700 mkdtemp dir before `Chmod`, so the umask window is not
  reachable. macOS `sun_path`: `$TMPDIR` (~49 bytes) + prefix + 10 digits + `/s` stays under 104.
  Second `Close` returns the net "use of closed" error; harmless.
- `agenthooks`: `buildShim`/`shellSingleQuote` refuse `"`/`'`/newline; token and terminal id reach
  curl only through env expansion inside double quotes. `X-Kira-Terminal` trusted as given: only a
  token holder (a `claude` child the user launched) can post; attributing to another terminal is
  within that trust. `Manager` start/stop under one mutex; double `Start` no-op.
- `tokenauth`: fixed-length salt makes `salt||tok` unambiguous; `Verify` compares on decode failure.
- `rpcstream` session: `Emit`/`send` after `close` return via `done`; duplicate id refused; unknown
  cancel no-op; identity-keyed cleanup (P108 Part 2 F8) holds.

### Block 2: processes

#### F4 (low): `toolexec.Run` cancel path can leave SIGTERM-ignoring group members alive

- `internal/toolexec/exec.go:114-119`; `internal/procgroup/procgroup.go:34-48`.
- On ctx timeout `Cancel` SIGTERMs the group and arms a `delay` SIGKILL timer. Run calls
  `stopEscalate()` as soon as `cmd.Run` returns. Two paths stop the timer before it fires:
  (a) the direct child exits promptly on SIGTERM while a grandchild ignores it; (b) os/exec's own
  `WaitDelay` (same `delay`) fires first and `Process.Kill`s only the direct child. Either way the
  group SIGKILL never lands and the grandchild survives the hard timeout. Callers:
  `SI/mcpinstall/install.go:241-259` (`claude mcp add`/`remove`, `spawnTimeout`),
  `PI/gitvsix/install.go:215-232` (`code --install-extension`, `open -R`).
- `PI/gitprepare/runner.go:138-150` and `PI/adeagent/process.go:138` already fixed this shape
  (P108 Part 15 F8: immediate group SIGKILL after `Wait` on timeout/cancel). `toolexec` lacks it.
  Confirmed by reading; stdlib `WaitDelay` kills `cmd.Process` only.
- Fix: in `Run`, after `cmd.Run` returns, if `ctx.Err() != nil` and `cmd.Process != nil`, call
  `killGroup(cmd.Process.Pid, syscall.SIGKILL)` before `stopEscalate()` (same reasoning as
  gitprepare's comment). Optionally move that into `procgroup` as a `stop(cancelled bool)` helper so
  ghclient/gitclient can adopt it later; their runners are Space files, so leave them (route only
  if the helper signature changes).

#### F5 (low): `terminal.Registry` has no closed state; an Open racing `CloseWindow`/`CloseAll` registers an orphan PTY

- `internal/terminal/session.go:345-377,466-502`.
- `Open` reserves `sessions[id] = nil` and adds the id to `byWindow` only after spawn. `CloseWindow`
  snapshots `byWindow[key]`; `CloseAll` skips nil entries. Sequence: renderer calls Open (window W)
  and the user closes W while `newSession` runs. `CloseWindow(W)` finds nothing; Open then
  registers a live shell under a closed window's key. It runs until app quit, emits to a dead
  window, and an agent launch keeps `AgentSessions` (Space ADE count, keep-awake reason) non-zero.
  Same after `ShutdownBound` (both `main.go` teardowns): nothing stops a later `BoundService.Open`
  from spawning while teardown continues to `db.Close()`; in Space its exit then fires
  `Registry.OnChange` into `ade.Tracker.Reconcile` on a closed DB. Confirmed by reading (no seam to
  delay `newSession` in a probe).
- Fix: give `Registry` a `closed bool` (set by `CloseAll`) and a per-window generation counter
  (bumped by `CloseWindow`). `Open` records the generation at reservation; at registration, if
  `closed` or the generation moved, it deletes the reservation, closes the new session and returns
  an error (`ErrRegistryClosed`, mapped to `E_INVALID` in `BoundService.Open`). Add a race test
  (concurrent Open and CloseWindow with a fake spawn seam, or a real `/bin/sh`), which clears the
  bar (concurrency).

#### F6 (low): `keepawake.Toggle.SetManual` updates `manual` and the controller under different locks

- `internal/keepawake/toggle.go:41-47`.
- Two windows toggle at once: A sets `manual=true`, B sets `manual=false`, B calls
  `Ctl.Set(false)`, A calls `Ctl.Set(true)`. Result: `manual=false` (button shows off) while
  `ReasonManual` holds the assertion and the Mac stays awake. Wails runs each bound call on its own
  goroutine, so the interleaving is reachable; narrow window.
- Fix: hold `t.mu` across both writes (`t.manual = on; t.Ctl.Set(ReasonManual, on)`), then release
  before `State()`. No lock-order risk: `Controller` never calls back into `Toggle`.

#### F7 (low): `startupfail.collapse` byte-truncates and can split a UTF-8 rune in the alert body

- `internal/startupfail/classify.go:45-54` (`s[:max]`, `detailCap` 500).
- An error text with a non-ASCII byte straddling byte 500 (a localized OS message, a user path such
  as `~/Projets/données`) yields invalid UTF-8 in `Message.Detail`, which goes to osascript as argv
  (`alert.go:57-68`). osascript builds `argv` items via UTF-8 decoding; an invalid sequence can
  leave the item unconvertible, so the alert shows garbage or fails (then `showAlert` treats it as
  dismissed, and a Finder-launched user sees nothing). Not verified on macOS (unavailable here).
- Fix: back off to a rune boundary after slicing (reuse the `agenthooks.truncateMessage` loop, or
  `strings.ToValidUTF8(s[:max], "")`). Extend `classify_test.go`'s cap case with a multi-byte rune
  at the boundary.

#### F8 (low): dead `terminal.Service.Shutdown` and a stale comment after `07e7387`

- `internal/terminal/service.go:64-65`; `internal/terminal/session.go:36`.
- `07e7387` replaced the bound method with `ShutdownBound`. `Service.Shutdown` now has no caller
  (`git grep`). `closeKillWait`'s comment still names "both apps' TerminalService.Shutdown".
  `Service` is not Wails-bound (only `BoundService` is embedded), so this is cleanup, not exposure.
- Fix: delete `Service.Shutdown`; reword the comment to `terminal.ShutdownBound`.

Block 2 other checks, nothing filed:
- Candidate 7 (`toolexec` unbounded stderr) dropped: callers run fixed local tools
  (`claude mcp add`, `code --install-extension`, `open -R`) under `spawnTimeout`; none streams
  enough stderr to matter.
- `07e7387` new code holds: `BoundService` exports only `DefaultCwd`/`Open`/`Write`/`Resize`/`Close`;
  `Registry`/`Emit`/`ComposeAgent` are fields, not promoted methods; `Service` is not embedded.
- `procgroup.GracefulCancel`: `escalate` written in `Cancel`, read in `stop` after `Wait`; the
  happens-before holds for every caller that calls stop after Wait.
- `terminal.Session`: Close/readLoop ordering, bounded Close (P108 Part 2 F1) holds. A `Write`
  during the 200 ms `exitDrain` after the master is force-closed returns `file already closed` as
  `E_INTERNAL` instead of a silent no-op; harmless (renderer logs), not filed.
- `ValidateOpen` bounds and the `ComposeAgent` recheck hold. `windowKey` is renderer-supplied by the
  first-party trust model.
- `keepawake` reap race (P108 Part 7 F12) holds: report decided under `d.cmd == cmd`.
- `startupfail`: argv-only osascript, `--` before data, `alertOnce`, `KIRA_NO_STARTUP_ALERT` hold.
  `realRun` comment says the group is killed after `WaitDelay`; stdlib kills only the child.
  osascript forks nothing, so not filed.

### Block 3: self-update

Nothing real found. Checked:
- Candidate 9 (script fetched from `main`, no signature) not filed: a recorded decision exists.
  `internal/appupdate/install.go:59-73` (fresh-fetch decision plus the security note: branch
  protection on `main` is the boundary), `docs/ARCHITECTURE.md:2565`, P119 plan
  (`docs/v1.9/plans/P119-space-release-notifier.md:374`).
- Fetch: `LimitReader(maxScriptBytes+1)` then size check; status 200 required; contract line and
  shebang checked byte-exact before `sh`. Temp script via `CreateTemp` (0600, per-user
  `$TMPDIR`), removed on every path. Log file 0600 under a 0700 dir.
- State machine: `begin`/`finish`/`Cancel` under one mutex; `Cancel` no-op once handed off; a
  `staged` line racing ctx cancel only kills a script still waiting on `--wait-pid` (nothing
  swapped yet). `handleCancel` signals the Setsid group (pgid = pid, unreaped until `<-exited`, so
  no pid reuse). The fd-3 reader ends on EOF or one line; `exited` is buffered (no goroutine leak).
- Checker: proxy-aware client, `LimitReader` 1 MiB, singleflight, 6 h/30 min cadence, draft and
  prerelease excluded, `x/mod/semver` compare, dev sentinels never fetch. The singleflight runs
  with the first caller's ctx, so a cancelled first call costs one 30 min backoff; minor, not
  filed.
- `install.sh`: `set -eu` with every global defaulted; `--notify-fd` whitelisted before `eval`;
  `--wait-pid` digits only; curl `--proto =https --tlsv1.2 -f`, `--speed-limit`; asset URL prefix
  pinned to the tag; size and sha256 digest required (refuses a release without a digest);
  `hdiutil -readonly -nobrowse`; `codesign --verify --deep --strict`, bundle id and version
  checked; swap is two `rename(2)`s on one volume with restore on failure; `cleanup` on EXIT
  detaches and removes only its own mktemp paths; osascript gets argv, not source. Contract line
  byte-exact at line 2. Not runnable here (macOS-only tools); read by hand.

### Block 4: shell and events

#### F9 (low): `Quitter.app` is a plain field written after `application.New` and read from other goroutines

- `internal/shell/quit.go:29,60-62,81,141`.
- `Attach` stores the app on main after `application.New` (`apps/kira-studio/main.go:196`,
  `apps/kira-space/main.go:287`). `RequestQuit` (menu click goroutine) and `flushThenQuit` (its own
  goroutine) read it. This is the exact class `aa218aa` (Part 6 F17) fixed in `wails.go` with
  `atomic.Pointer`; `Quitter` was not covered. No nil deref is reachable today (both readers need
  the run loop, which starts after `Attach`), so this is a formal race for consistency with F17.
- Fix: `app atomic.Pointer[application.App]`; `Attach` stores, `RequestQuit`/`flushThenQuit` load
  and no-op on nil (log a warning in `flushThenQuit`, then still `teardown`).

#### F10 (low): restored window bounds are never checked against the current screens

- `internal/shell/window.go:102-109`; `internal/shell/openwindow.go:300-305`.
- `Options` applies a stored rectangle verbatim with `InitialPosition: WindowXY`. A window last
  placed on an external display that is now disconnected reopens at those coordinates, off every
  screen. Dock-click does not help (the window exists and counts as visible), and the app has no
  "gather windows" command. Common laptop flow: close the app docked, relaunch undocked. Not
  verified on macOS (unavailable here); AppKit does not constrain a programmatic `setFrame:`
  origin for an already-titled window in general, so the risk is real.
- Fix: once screens are known (startup windows open before `app.Run`, so do it from the window's
  `WindowRuntimeReady` hook or after `ApplicationDidFinishLaunching`), check that `win.Bounds()`
  intersects some `app.Screen.GetAll()` work area; if not, move it to the primary work area
  origin (reuse `cascadeRect`'s clamp). Unit-test the pure intersect-and-clamp helper only if it
  grows past a couple of conditions.

Block 4 other checks, nothing filed:
- Candidate 3 (`Coalescer.flushLocked` emits under `c.mu`) dropped. `flush` is a base64 encode of
  at most 16 KiB plus `DispatchWailsEvent`, which hands the JS to the main thread asynchronously.
  Holding the lock is what keeps batches, and the final exit event, in order; moving the emit out
  would trade a non-problem for an ordering bug.
- `aa218aa` new code holds: every reader in `wails.go` goes through `Load`; `Dialogs.attached`
  returns "no application" before attach. No other plain app holder in `shell` besides F9
  (`OpenWindow`'s `WindowOpenerDeps.App` is passed by value after New, read on the same paths).
- Quit: `started` CAS, `done` flag, `Flushed` idempotent for unknown keys, release once. A window
  opened after the pending set is seeded is not awaited, and a signal-path `Shutdown` during an
  in-flight flush tears down early; both bounded edge cases, not filed.
- Close flush: one waiter per key (the `flushing` guard makes the hook one-shot), P108 Part 2 F2
  reset holds. `debouncer.cancel` cannot stop a persist already running; it takes milliseconds
  against a 2 s flush window, not filed.
- `link.go`: `url.Parse` lowercases the scheme; only http(s) with a host pass. `security.go`
  denies mic/camera/geolocation/notifications and automatic `window.open`.
- `notify.Emitter` delivers outside its lock; `OrderedEmitter` (P108 Part 2 F7) holds;
  `PendingQueue` documented caller-locked. `windowsvc` validates `windowKey`; `mode` is normalised
  in `appstorage.WindowRepo.SetMode`.

### Block 5: storage, paths, misc

#### F11 (low, routed Part 12 F12): `adapterhost.Host.CancelOp` forgets a cancel that arrives before `RunOp` registers

- `apps/kira-studio/internal/adapterhost/host.go:306-312` (`CancelOp`), `:195-208` (`RunOp`).
  Part 5's file; Part 8 one-hop caller (`host.go` imports `internal/notify`); fixer edits it per
  plan §7.
- `CancelOp` returns `false, nil` for an id not in `h.running` and records nothing. The renderer
  mints the op id and sends Run and Stop as separate bound calls on separate goroutines. A Stop
  pressed right after Run can win the race to `h.mu`; the cancel is dropped and the statement
  (possibly a write) runs to completion. Confirmed by reading: no other path remembers the id.
- Fix: per routed note. `Host` keeps `cancelledEarly map[string]time.Time` under `h.mu`.
  `CancelOp` on an unknown id records it (TTL a few seconds; prune expired entries on insert; cap
  the map, e.g. 1024 entries, dropping the oldest, so a misbehaving renderer cannot grow it).
  `RunOp` checks and deletes the id under `h.mu` before registering; a match returns
  `adapters.New(adapters.CodeCancelled, ...)` without running and without op:start/op:end (the
  throttle-queue cancel path's precedent at `host.go:227-229`). Test: cancel-before-run returns
  `E_CANCELLED` and never calls fn; an expired entry does not block a later run. Commit names
  `P168 Part 8 (routed Part 12 F12)`. Checks: `go test -race ./apps/kira-studio/internal/
  {adapterhost,bridge,ipcfixture}/...` (ipcfixture needs Docker; see coverage).

Block 5 other checks, nothing filed:
- Candidate 6 (WAL sidecar modes) dropped by probe (scratch `_test.go`, deleted): under umask 022,
  first and second `sqlitex.Open` runs both leave `x.db`, `-wal`, `-shm` at 0600. The sidecars are
  created on first write, after `Open`'s `Chmod`, and SQLite copies the main file's mode.
- Candidate 5 (`EnsureLayoutAt` chmods an existing `KIRA_HOME` to 0700) not filed. Documented
  intent ("tightening an existing loose directory too"); `KIRA_HOME`/`KIRA_SPACE_HOME` are
  dev/test overrides; and that chmod is what keeps every file under the home private regardless
  of where the override points.
- `66174c8` new code (`ReorderSortOrder`) holds: rejects an id outside the set or listed twice,
  appends unlisted rows in existing order, runs inside the caller's tx. Empty `ids` degenerates to
  a reindex. Errors are plain (`E_INTERNAL` at the bridge); acceptable for a stale reorder.
- `ee9a71e` new code (`ipcerr.NotFound`) has a real caller (`SI/bridge/collections.go:71`).
- `sqlitex.Migrate`: per-step tx, `SchemaTooNew` before any step. `BuildDSN` escaping (P108 Part 2
  F9) holds. `pathsafe` dangling-symlink fix (P108 Part 2 F10) holds; `..` and absolute refused;
  root resolved once. `logging`: 0600 daily files, writer under a mutex, `Sweep` prefix/suffix
  bound. `appsettings`: `fontSize` unbounded on both sides (Go and `SD/settings.ts` `z.number()`),
  consistent. `appstorage`: bounds and mode writes bounded, `ReplaceKeyed` one tx.
- `metrics`: create-time guard on CPU deltas; `elapsed <= 0`/`logicalCPUs <= 0` return 0;
  `Ticker.Stop` without `Start` would block on `done`, but both apps call `Start` right after
  construction (latent only). darwin cgo probes read, not runnable here.
- `layeringtest` scans `<app>/internal/...` for a bridge import; repo-root `internal/` importing
  an app's `internal/` is already impossible under Go's internal rule. `testx` cleans its temp
  root after `m.Run` (a panic inside `m.Run` exits the binary anyway).

### Block 6: scripts, mutation tooling, hooks, Claude config

#### F12 (medium): `check-theme-classes.sh` depends on GNU `grep -P` and hides grep errors, so it passes silently on macOS, including the CI lint job

- `scripts/check-theme-classes.sh:45-47,62-65,82-86,105-113,129-131` and every other `grep -P`
  call (37 in the file); each pipes through `2>/dev/null` and `|| true`.
- BSD grep (macOS `/usr/bin/grep`) has no `-P` (PCRE) option. On a Mac, every `grep -rnoP` call
  exits 2 with "invalid option", the error goes to `/dev/null`, `|| true` turns it into empty
  output, and every check reports nothing. The script then prints "no retired class names found"
  and exits 0. `pr.yml`'s `checks` job runs `bun run lint` on `macos-15` (`pr.yml:20,50`), so this
  guard is not enforced in CI at all, and not on a Mac dev machine; it only runs for real in Linux
  sandboxes (pre-commit here). Same masking on Linux: a malformed pattern (grep exit 2) also reads
  as "no hits". Not run on macOS here; BSD grep's man page lists no `-P`.
- Fix: stop swallowing errors. Distinguish grep's exit 1 (no match) from 2 (error) and fail the
  script on 2. Then either (a) require GNU grep explicitly (`ggrep` on macOS, a `require_cmd`
  check that `grep -P '' </dev/null` works, and `brew install grep` on the CI runner via
  `docs/pending-changes/`), or (b) port the checks to `rg` (PCRE2 via `rg -P`, already used by
  agents here) or to a small bun script, matching `check-class-conflicts.ts`. (b) removes the
  platform dependency; prefer it.

Block 6 other checks, nothing filed:
- Candidate 12 (`check-class-conflicts.ts` returns on an SFC parse error) dropped: `parseSFC`
  reports syntax errors in `descriptor.errors` and rarely throws; a file that breaks the SFC
  parser also fails `vue-tsc` in the same pre-commit hook (`bun run typecheck`). Its `SCAN_DIRS`
  omit `packages/kira-ui/src`, which holds one `.vue` file with a single literal class; not filed.
- Candidate 13 dropped. `summarize.ts:81`'s `URL.pathname` is used only for tool version lookups
  wrapped in try/catch (a space in the path degrades the "tools:" line to "unknown"). `run.sh`
  target splitting: Go package dirs and `areas.json` keys contain no spaces in this repo.
- Candidate 14 (no Go check in pre-commit) not filed: recorded decision, P94 plan §0/§5
  ("pre-commit unchanged ... pre-push is new: go build, golangci-lint, knip").
- `areas.json`: every area's `mutate` globs and `tests` dirs match real files (scratch bun probe:
  22-645 mutate files, 3-102 spec files per area).
- `check-tokens.sh`: `var(--x, fallback)` references and `.ts` files are not scanned; the one TS
  reference with no definition (`--kira-float-max-h`) is set at runtime by `floatingPosition.ts`.
  Not filed.
- `install-golangci-lint.sh`: version and toolchain pinned, binary rebuilt when either differs
  (`go install` verifies against `go.sum`/sumdb, no separate checksum needed).
  `generate-wire.sh`: flatc pinned by version and SHA-256 per platform; output paths hold
  (P108 Part 2 F6). `sign-bundle.sh`: ad-hoc identity by design (ARCHITECTURE packaging row).
- `setup.sh`/`prepare-worktree.sh`: idempotent; stamp-driven bindings regen; `version_lt` safe under
  `set -e`. `prepare-worktree.sh` prints "deps already present" on macOS too (cosmetic).
- Hooks: `pre-commit` (lint, typecheck) and `pre-push` (go build, lint:go, lint:dead) run from the
  repo top level (git's hook cwd), so subdirectory commits and worktrees behave the same.
- `.claude/settings.json`: a missing `codegraph` binary makes `UserPromptSubmit` exit non-zero but
  not 2, which Claude Code reports without blocking the prompt. `postcompact-style-reminder.sh`
  needs `jq`, listed in `docs/DEV_ENVIRONMENT.md:560`. `.mcp.json` assumes a global `codegraph`,
  installed by `codegraph-setup.sh`.
- `codegraph-duplicates.ts` (report tool, `dedup:*`) runs clean against this index.

## Coverage

- Block 1 (listeners and RPC): done. Read in full: `localsock/localsock.go`, `agenthooks/{agenthooks,
  http,manager,config,shim}.go`, `tokenauth/tokenauth.go`, `rpcstream/{frame,credit,session}.go`.
  Tests deferred to block 8.
- Block 2 (processes): done. Read in full: `procgroup/procgroup.go`, `toolexec/exec.go`,
  `terminal/{session,service,bound,shell,validate,ptmx_linux,ptmx_other}.go`,
  `keepawake/{keepawake,caffeinate,toggle,driver}.go`, `startupfail/{report,alert,exec,render}.go`,
  `startupfail/classify.go` (collapse and Classify head). `step.go`, `info.go` skimmed (constants and
  path helpers).
- Block 3 (self-update): done. Read in full: `appupdate/{install,checker,version,app}.go`,
  `scripts/install.sh`, both `bridge/update.go` callers (read only).
- Block 4 (shell and events): done. Read in full: `shell/{quit,closeflush,registry,window,openwindow,
  wails,security,link,debounce,dialogs,accel,menu}.go`, `appevent/{coalescer,appevent}.go`,
  `notify/{notify,ordered}.go`, `windowsvc/windowsvc.go`. Skimmed: `shell/{menutemplate,deps,wake}.go`
  (types and one-line event hooks). Both `main.go` wiring read at the Attach/teardown sites.
- Block 5 (storage, paths, misc): done. Read in full: `sqlitex/{sqlitex,reindex,query,load}.go`,
  `kirapaths/{paths,prod_default}.go`, `appsettings/{repo,appsettings}.go`, `appstorage/{window,tabs,
  leaves}.go`, `pathsafe`, `logging/{log,sweep}.go`, `metrics/{sampler,ticker,probe_darwin,
  processlist_darwin}.go`, `jsonx`, `kiratime`, `ipcerr/errors.go`, `testx/{testx,apphome}.go`,
  `layeringtest`. Skimmed: `kirapaths/{env,prod}.go`, `appstorage/appstorage.go`,
  `metrics/{responsible_*,processlist_other,probe_other}.go` (build-tag stubs). Routed
  `SI/adapterhost/host.go` read (`RunOp`, `CancelOp`).
- Block 6 (scripts, tooling, hooks): done. Read in full: `.githooks/{pre-commit,pre-push}`,
  `.claude/{settings.json,hooks/postcompact-style-reminder.sh}`, `.mcp.json`, `scripts/{lib,setup,
  prepare-worktree,prepare-dev-environment,prepare-ui-tests,codegraph-setup,install-golangci-lint,
  generate-wire,sign-bundle,check-tokens}.sh`, `scripts/mutation/{run,go,ts}.sh`,
  `tools/mutation/{summarize.ts,stryker.config.mjs,areas.json}`. Read in part:
  `check-theme-classes.sh` (helpers, lines 1-140, and the `grep -P` call sites),
  `check-class-conflicts.ts` (scan dirs, parse path, main), `verify-packaging.sh` (every check
  header and S6/S7/S11), `codegraph-duplicates.ts` (CLI, DB open). Skimmed: `check-ade-colours.sh`
  (`grep -E` only, BSD-safe), `tools/mutation/{package.json,tsconfig.json,.gitignore}`.
  `scripts/install.sh` covered in block 3.
