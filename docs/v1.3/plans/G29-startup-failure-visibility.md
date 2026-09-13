# G29 — Startup failure visibility: a native alert before any window exists

> **What this phase is.** The twenty-ninth phase of `docs/v1.3/SPEC.md`'s headless-git chapter, and the only one that is **not** git work at all. It is app-shell/boot-sequence UX: today, if `apps/kira-studio/main.go`'s pre-window boot sequence fails, the process writes one line to a file descriptor nobody is reading and exits 1. Double-clicking the app in Finder produces **nothing** — no window, no dialog, no bounce, no log entry. This phase makes every one of those failures produce a native macOS alert before the process dies.
>
> **The SPEC row's premise is off by one important detail, and correcting it strengthens the phase.** SPEC says these failures "reach only a log file." They do not reach the log file. All eight sites use the standard library's `log` package (`log.Fatalf`/`log.Fatal`), whose default output is `os.Stderr`; nothing in this repo ever calls `log.SetOutput`. The app's own log file is written by `log/slog`, installed by `logging.Init()` (`internal/logging/log.go:58`), an entirely separate mechanism. So the *non-fatal* startup problems (`slog.Warn` at `main.go:141`, `:164`, `:222`, `:226`, `:232`) do land in `~/.kira-studio/logs/kira-YYYY-MM-DD.log`, and the eight *fatal* ones land nowhere durable at all. This phase therefore has two jobs, not one: **show a native alert, and get the message into the log file** (F1, F2, D2).
>
> **The central technical question — how do you show a native dialog with no window, no `NSApp`, and (for five of the eight sites) no `application.App` object in existence — has a decisive, evidence-backed answer.** Wails v3's own dialog API is structurally unusable at all eight sites (F4: `MessageDialog.Show()` → `InvokeSync` → `globalApplication.dispatchOnMainThread` → `a.impl.isOnMainThread()`, and `a.impl` is assigned inside `Run()`, `globalApplication` inside `New()` — both are nil-dereferences at boot). The answer is an **argv-only `osascript` spawn** — the same discipline `internal/gitvsix` already uses for `code`/`open` — chosen over a cgo `NSAlert`/`CFUserNotification` shim for one measured reason among several: a pure-Go package cross-compiles and unit-tests for `darwin/arm64` in this Linux container (verified: `GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build ./…/gitvsix` succeeds), while a cgo one cannot even be compiled here (verified: `CGO_ENABLED=1 GOOS=darwin` fails at `runtime/cgo` with `clang: error: unsupported option '-arch'`). For a feature whose entire purpose is to be reliable on the one path nobody can test interactively, "verifiable in CI" is not a nicety (D3).
>
> **A ninth failure path exists that nobody enumerated.** Wails exits the process itself, without ever returning to `main`, at `application.New`'s transport-start failure (`application.go:96`) and at `webview_window_darwin.go:1755`'s `GetStartURL` failure — the latter fires *inside* `Run()`, during first-window creation, so `main.go:570`'s `log.Fatal(err)` never sees it. `application.Options.ErrorHandler` is the seam that catches both (F6, D7).
>
> **`CONTRACT_VERSION` stays at 30.** This phase adds no RPC, no wire type, no event, and touches neither `packages/git-ipc` nor `apps/kira-studio-vscode`. Confirmed explicitly in D11 so no later phase reads a silence as a bump.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against `claude/feature-v1-3-headless-git` at `241be79d` (G1–G28 complete, working tree clean).

| Claim | Evidence |
|---|---|
| The app shell is **Wails v3 `v3.0.0-beta.16`**, macOS 14+, `arm64` only, dark mode only | `go.mod:36`; `docs/ARCHITECTURE.md` Stack table ("Shell / Wails v3 … macOS 14+, `arm64` only"); `README.md:16` |
| Windows are Wails windows: `app.Window.NewWithOptions` at `main.go:474`; "list windows"/"create window" at `:554`/`:560` are **SQLite rows** (`WindowsRepo`), not OS windows | `main.go:469-494`, `:554-567`; `storage/repos/windows.go:21`, `:70` |
| There are **eight** `log.Fatal*` sites in `main.go` | `main.go:83`, `:86`, `:92`, `:102`, `:181`, `:556`, `:561`, `:570` |
| `log.Fatalf` writes to **`os.Stderr` only** and calls `os.Exit(1)`; nothing in this repo redirects the `log` package | `grep -rn "log.SetOutput" apps/` → no hits; `main.go:6` imports `"log"` alongside `"log/slog"` |
| The app's log file is `slog`-only, installed by `logging.Init()` — a completely separate mechanism from `log` | `internal/logging/log.go:58-73` (`slog.SetDefault` → `dailyWriter` at `KIRA_HOME/logs/kira-YYYY-MM-DD.log`, plus stderr only when `config.IsDev()`) |
| Wails' `MessageDialog.Show()` cannot run before `app.Run()` | `pkg/application/dialogs.go:109` (`InvokeSync(d.impl.show)`) → `mainthread.go:23-31` (`globalApplication.dispatchOnMainThread`) → `application.go:973-986` (`a.impl.isOnMainThread()`); `a.impl = newPlatformApp(a)` is assigned **inside** `Run()` (`application.go:634`), `globalApplication` inside `New()` (`application.go:56`) |
| Wails exits the process itself on two darwin paths that never return to `main` | `application.go:96` (`result.fatal("failed to start custom transport: %w", err)`); `webview_window_darwin.go:1755` (`globalApplication.handleFatalError(err)` on `GetStartURL`); both → `application.go:566-569` → `os.Exit(1)` |
| `application.Options.ErrorHandler` is the interception seam for those | `application_options.go:104`; `application.go:536-542` (`handleError` prefers `ErrorHandler` over the logger) |
| `internal/shell/app.go` is the *only* file besides `main.go` allowed to import `pkg/application` | `internal/shell/app.go:11` ("Nothing else in the repo imports pkg/application (P56 D1)"); `main.go:371-377` records the one deliberate exception |
| `internal/gitvsix` is the house precedent for an argv-only, bounded, seam-injected spawn of a non-git binary | `gitvsix/install.go:22-61` (`Deps`/`New` fallbacks); `gitvsix/exec.go:60-88` (`realRun`: `exec.CommandContext`, `Setpgid`, `WaitDelay`, bounded stderr) |
| Real builds are `CGO_ENABLED=1`; this container cannot cross-compile cgo for darwin | `apps/kira-studio/build/darwin/Taskfile.yml:57`; measured: `GOOS=darwin GOARCH=arm64 CGO_ENABLED=1 go build ./…/localauth` → `clang: error: unsupported option '-arch'` |
| A pure-Go package **does** cross-compile for `darwin/arm64` here | measured: `GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build ./…/gitvsix` → exit 0 |
| `main.go` **must not call `os.Getenv`** — a packaging check fails the build if it does | `scripts/verify-packaging.sh:95-104` (check S8) |
| `storage.Open`'s schema refusal is the case that prompted this phase | `storage/migrate.go:42-47`: `"storage: database schema_version (%d) is newer than this build knows about (%d) — refusing to run against a downgraded app"` |
| `gitreview`'s equivalent refusal is a byte-for-byte sibling, deliberately duplicated | `gitreview/migrate.go:46-51`; its doc comment at `:9-15` explains the module-boundary reason |
| `buildinfo.Version`, `config.KiraHome()`, `config.LogsDir()`, `config.DbPath()` are all usable with **zero** initialisation — they cannot themselves fail | `buildinfo/buildinfo.go:15` (plain `var`); `config/paths.go:11`, `:31`, `:35` (pure, `os.UserHomeDir` already falls back to `"."`) |
| Nothing in the repo has ever shown a native alert, used `osascript`, `NSAlert`, or `CFUserNotification` | `grep -rn "osascript\|NSAlert\|CFUserNotification" apps/ scripts/` → no hits |
| `CONTRACT_VERSION` / `ContractVersion` are both **30** (G28) | `packages/git-ipc/src/validate.ts:97`; `gitrpc/contract.go:107` |
| `apps/kira-studio` has no `main_test.go` — anything left in `main.go` is untestable | `ls apps/kira-studio/*_test.go` → nothing |

**Probes that cannot be run here, and are therefore deferred to §7.3 rather than assumed:** whether a Finder-launched `.app`'s stderr reaches the unified log or `/dev/null`; how `osascript`'s alert renders and z-orders when spawned from a background `.app`; whether `activate` reliably foregrounds it. Every one of these is a Tier-3 item with an explicit expected result stated, exactly as G25 handled its own mutating probes.

### 0.2 Scope

1. **`internal/startupfail`** (new package) — the whole of this phase's logic: a `Step` vocabulary, a pure classifier, a pure message renderer, a pure argv builder, and a seam-injected presenter. Pure Go, no cgo, no `pkg/application` import.
2. **`internal/storage`** — one exported error type so the schema-too-new case can be recognised structurally instead of by string matching. No migration, no schema change.
3. **`apps/kira-studio/main.go`** — eight `log.Fatalf`/`log.Fatal` calls replaced by `startupfail.Fatal(step, err)`; one `ErrorHandler` added to `application.Options`; the `"log"` import dropped.

### 0.3 Not in this phase

Any degraded/partial boot mode (D6); a UI panel for a failure occurring *after* a window exists (G14 D3's, explicitly); `internal/gitreview/migrate.go`'s refusal (F9 proves it already surfaces); recovery/repair actions (no "reset my database" button); a crash reporter; panic capture; recording the writing app's version in `kira.db`; app-branded alert iconography (F5, handed forward); `CONTRACT_VERSION`; anything in `packages/git-*` or `apps/kira-studio-vscode`; editing `docs/v1.3/SPEC.md`.

### 0.4 Ground rules

`CLAUDE.md` in full. Every spawn in this repo is argv-only with no shell (`gitclient`, `ghclient`, `gitvsix`, `gitprepare`); this one is too — and here it matters more than usual, because the strings being passed are **untrusted error text** that can contain quotes, backslashes and newlines. Not one character of app-supplied data is ever interpolated into an AppleScript source string (D4). Per `CLAUDE.md`'s testing bar, the parts that earn tests are the classification table and the argv construction — both are decision structures with many arms, not thin wrappers.

---

## 1. Findings

### F1 — None of the eight fatal sites reaches the app's log file; only stderr, which for a Finder launch is nowhere

`main.go` imports both `"log"` (`:6`) and `"log/slog"` (`:7`). Every non-fatal startup problem uses `slog` and therefore lands in `~/.kira-studio/logs/kira-YYYY-MM-DD.log` once `logging.Init()` has run: the askpass broker (`:141`), the git socket listener (`:164`), both orphan sweeps (`:222`, `:226`), the page reclaim (`:232`). Every *fatal* one uses `log.Fatalf`, whose destination is the `log` package's default `os.Stderr`. The two never meet. SPEC's "reaches only a log file" is thus optimistic by one whole mechanism: today a boot failure produces **no log record at all** in the file a user or bug report would look at.

### F2 — Two of the eight sites happen before any logging exists, and one of them is the logging setup itself

`config.EnsureLayout()` (`main.go:82`) creates `~/.kira-studio` and `~/.kira-studio/logs` at 0700 (`config/paths.go:41-52`). `logging.Init()` (`main.go:85`) creates the same logs directory again and installs the slog default (`logging/log.go:58-73`). A failure at either is precisely a failure to establish the place a log record would go. This is not a reason to give up on logging them: `slog.Default()` before `SetDefault` is the standard library's own stderr handler, so an unconditional `slog.Error` at every site degrades correctly — file after `Init`, stderr before it — with no branch (D2).

### F3 — There is no GUI toolkit dependency to reach for; there is a GUI toolkit, and it is the wrong shape

`main.go`'s import block has no dialog library because the app *is* a Wails app (`main.go:50-51`, `go.mod:36`). `go.mod` contains nothing resembling `dialog`, `zenity`, or a native-alert wrapper; `grep` across `apps/` and `scripts/` finds no `osascript`, `NSAlert` or `CFUserNotification`. The only native-UI-from-Go mechanisms already in the tree are Wails itself and `wails/v3/pkg/services/notifications` (`main.go:51`), and the latter is a *notification*, not a blocking alert — it needs a signed bundle identifier and lazy user authorization (`main.go:587-600`'s own doc comment), and G14 D4 already documents that it fails softly outside a packaged app. It cannot be the mechanism for "the app is about to die, read this."

### F4 — Wails' dialog API is a nil-dereference at every one of the eight sites, for two different reasons

`MessageDialog.Show()` (`dialogs.go:109`) is `InvokeSync(d.impl.show)`. `InvokeSync` (`mainthread.go:23`) calls `globalApplication.dispatchOnMainThread(...)`, which calls `a.impl.isOnMainThread()` (`application.go:975`).

- At `main.go:83`, `:86`, `:92`, `:102`, `:181` — `application.New` has not been called, so `globalApplication` is nil (`application.go:27`, set at `:56`). Immediate nil-pointer panic.
- At `main.go:556`, `:561`, `:570` — `application.New` has returned, but `a.impl` is assigned only inside `Run()` (`application.go:634`, `a.impl = newPlatformApp(a)`). Nil interface, nil-pointer panic.

Even hypothetically past that, the macOS dispatch is `CFRunLoopPerformBlock` on the main run loop (`mainthread_darwin.go`) — before `Run()` that run loop is not turning, so `InvokeSync`'s `wg.Wait()` would deadlock rather than return. **Wails' dialogs are unavailable to this phase in every sense.** This is the single most important negative finding: it forecloses the "just use what's already there" answer.

### F5 — `osascript` is a real, complete mechanism, and its one weakness is cosmetic

`/usr/bin/osascript` ships on every macOS and is on the minimal `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`) a LaunchServices-started process inherits. `display alert … as critical` produces a real modal alert panel with a caution badge, blocks until dismissed, and needs no `NSApplication` in *our* process — the alert belongs to the `osascript` process. It works identically whether the app was double-clicked in Finder or run from a terminal, and — the property that matters at `main.go:570` — it is unaffected by whatever state our own `NSApp` is in after a failed `Run()`.

Its weakness: the alert carries `osascript`'s generic icon, not Kira Studio's. `display alert` has no `with icon` parameter (only `display dialog` does, and `display dialog` folds title/message into one text field and has no `as critical` styling). Accepted and documented; closing it is a handed-forward item (§9), not a reason to take on cgo.

### F6 — Two pre-window failures exist that `main.go` cannot see at all, because Wails exits the process itself

Neither is reachable from any `log.Fatal*` site:

- `application.New` → `result.fatal("failed to start custom transport: %w", err)` (`application.go:96`) → `handleFatalError` (`:566`) → `os.Exit(1)`. This is at `main.go:309`, well before `Run()`.
- `webview_window_darwin.go:1755`: during the first window's creation *inside* `Run()`, `assetserver.GetStartURL(options.URL)` failing calls `globalApplication.handleFatalError(err)` → `os.Exit(1)`. `Run()` never returns, so `main.go:570` is dead code for this case.

Both are exactly this phase's subject (pre-window, silent, process dies). `application.Options.ErrorHandler` (`application_options.go:104`) is called by `handleError` in preference to the logger (`application.go:536-542`), synchronously, *before* `handleFatalError`'s `os.Exit(1)` — so a handler that presents an alert blocks and completes first. The package-level `application.Fatal(...)` (`errors.go:41-55`) routes through the same `handleError`. One seam covers all of it.

### F7 — The same `Settings.GetAll()` call is fatal in one place and warn-only in another

`main.go:179-182` treats a `Settings.GetAll()` failure as fatal. `main.go:120-127` — `gitRegistry.Settings`, running on every push pre-flight and auto-fetch tick — treats the identical call's failure as `slog.Warn` plus zero values. Both are defensible in isolation (one is a boot-time read of a cache budget, the other a hot-path read of a safety list), but the inconsistency is worth recording rather than discovering during G30. This phase does not change either posture (D6).

### F8 — `log.Fatalf` skips `teardown` entirely, and the later the site, the more is left running

`os.Exit` runs no deferred functions. At `main.go:556`/`:561`/`:570`, the git socket listener is bound (`:163`), the askpass broker is live (`:139`), `connectionsSvc` is started (`:203`), the metrics ticker is ticking (`:240`) and `oplogWiring` is running (`:217`) — none of which `teardown` (`:274-295`) will ever run. This is survivable by construction (`gitsock`'s `flock`-based stale-socket recovery, SPEC §3.2, was designed for exactly a crash), and this phase does not change it, but it is a real observation about boot-failure behaviour that belongs on G30's record (§9).

### F9 — `internal/gitreview/migrate.go`'s refusal is **not** silently swallowed; it renders in the review sidebar, and the code path proves it

SPEC explicitly asks. Traced end to end:

1. `gitreview.Store.ensureOpen` (`gitreview/db.go:38-83`) calls `migrate(sqlDB)` at `:69`; the refusal is `gitreview/migrate.go:46-51`, returned as a plain `fmt.Errorf`. Crucially, `ensureOpen`'s failure is **not memoised** (`db.go:35-37`'s own doc comment), so it is re-raised on every attempt rather than latching into silence.
2. Every review RPC reaches it: `RepoEntry.review` (`gitsession/entry.go:105`) → e.g. `e.review.Records(...)` at `gitsession/incremental.go:435`, whose error is returned, not logged-and-swallowed (`:436-438`).
3. `gitrpc.handleReviewFiles` (`gitrpc/incremental.go:35-38`) passes it through `mapDetailError` (`gitrpc/detail.go:18-39`) → `mapGitError` (`gitrpc/handlers.go:275-281`) → `gitclient.KindOf` misses → the error is returned **unchanged**, with its full text.
4. `rpcstream.wireErrorFrom` (`bridge/rpcstream/frame.go:84-90`) turns it into `{code:"E_INTERNAL", message: <the full refusal text>}` and `session.go:186` sends it.
5. `ReviewFilesState.#loadFiles` catches it (`packages/git-ui/src/state/reviewFiles.ts:112-116`) into `loadError`, and `ReviewFilesPane.vue:92-93` renders **"Couldn't load the file list — `gitreview: review.db schema_version (N) is newer than this build knows about (M) — refusing to run against a downgraded app`"**.

`review.files` is the first review call any session makes, so this is the path a real user hits. **Verdict: it already surfaces. Out of scope, as SPEC's default. Not touched.**

### F10 — A genuinely swallowed error *does* exist on the same client file, but it is not the schema refusal

`ReviewFilesState.mark()` (`reviewFiles.ts:230-249`) is `try { … } finally { … }` with **no `catch`**, and its only caller is `void props.reviewFiles.mark(path, !isReviewed)` (`ReviewFilesPane.vue:86`). `#openInEditor` (`reviewFiles.ts:172-195`) likewise has no `try`/`catch` and is called as `void this.#openInEditor(...)` at `:133`, `:135`, `:149`. `grep -rn "unhandledrejection" packages/git-ui/src apps/kira-studio-vscode/src packages/git-core/src` finds nothing, so a rejection from either is a bare unhandled promise rejection: the reviewed-checkbox silently doesn't toggle, and a failed diff-open silently does nothing. This is a real, pre-existing defect — but it is a *client-side error-handling* gap on a mid-session RPC, not a boot failure, and it is not the gap SPEC's escape hatch describes. Handed to G30 (§9), with the one-line fix named there.

### F11 — Everything the message needs is available at every site, with no initialisation

`buildinfo.Version` is a plain package `var` (`buildinfo/buildinfo.go:15`), link-stamped at build time; `config.KiraHome()`/`LogsDir()`/`DbPath()` are pure functions that cannot fail (`config/paths.go:11-38` — `os.UserHomeDir`'s error already falls back to `"."`). All four are usable at `main.go:83`, before *anything* has been set up. What is **not** available: any support email, issue-tracker URL or contact address — `grep` over `README.md`/`CLAUDE.md`/`docs/ARCHITECTURE.md` finds only the CI badge's repo URL. The message therefore points at the log folder and the version, and invents no support channel (D5).

### F12 — The schema-too-new case is the only failure with a genuinely actionable, non-bug cause, and its two numbers are trapped in a string

`storage/migrate.go:42-47` knows both integers — `current` (what's on disk) and `maxVersion` (what this binary ships) — and formats them into an opaque sentence. To phrase the user-facing advice correctly ("your data is newer than this app; use the newer app") the classifier needs those two numbers, and string-matching a message is not acceptable. One exported error type in `internal/storage` fixes it (D1). No app version is stored anywhere in `kira.db` (`grep -rn "buildinfo.Version" internal/` → three unrelated hits; no migration writes one), so the message can report *schema* versions and this binary's version, but cannot name the version that wrote the data.

### F13 — `main.go` is untestable, and a packaging check forbids the obvious shortcut

There is no `apps/kira-studio/main_test.go` and no `package main` test anywhere; anything implemented inline in `main.go` is verified by nothing. Additionally, `scripts/verify-packaging.sh:95-104` (check S8) **fails the build** if `main.go` contains `os.Getenv`. Both constraints point the same way: all logic — including any environment-variable escape hatch — lives in `internal/startupfail`, and `main.go` gets one-line call sites (D8).

---

## 2. Decisions

### D1 — `internal/storage` exports a typed schema-too-new error; the classifier recognises it structurally, never by string

New in `internal/storage/migrate.go`:

```go
// SchemaTooNewError is migrate's refusal when the database was written by a newer build.
type SchemaTooNewError struct{ Found, Known int }

func (e *SchemaTooNewError) Error() string { … same sentence as today … }

// SchemaTooNew lets a caller recognise this refusal without importing internal/storage.
func (e *SchemaTooNewError) SchemaTooNew() (found, known int) { return e.Found, e.Known }
```

`migrate()`'s `if current > maxVersion` (`:42`) returns `&SchemaTooNewError{Found: current, Known: maxVersion}` instead of `fmt.Errorf`. The message text is unchanged, so nothing that logs it changes.

`startupfail` recognises it through the **duck-typed interface**, not an import:

```go
type schemaTooNew interface{ SchemaTooNew() (found, known int) }
```

Rejected alternative: `startupfail` importing `internal/storage` and using `errors.As`. It works and the layering test permits it (`internal/layering_test.go` only forbids `internal/bridge`), but it drags `modernc.org/sqlite` into the dependency graph of a package whose entire job is formatting strings and building an argv, and it hard-couples the boot-failure presenter to one specific store. The interface costs one line, keeps `startupfail` a true leaf, and — a free bonus — would recognise `gitreview`'s identical refusal verbatim if a future phase ever needed it to.

### D2 — Every failure is logged through `slog` **and** presented, unconditionally, in that order

`Report` does, in order: (1) `slog.Error(<headline>, "scope", "startup", "step", <step>, "err", err)`; (2) write the full rendered text to `os.Stderr`; (3) present the alert. Rationale for all three:

- `slog` gets the record into the log file whenever `logging.Init` has already run, and degrades to the standard library's stderr handler when it hasn't (F2) — no branch needed.
- The explicit stderr write is what a developer running `wails3 task dev`, and any future CI harness, actually reads; it is also the fallback when the alert cannot be shown at all.
- The alert is the point of the phase.

Order matters: log first, so a crash or hang inside the presenter cannot lose the diagnosis.

### D3 — The alert mechanism is an argv-only `osascript` spawn

| Option | Deps added | Buildable/testable here | Works with no `NSApp` | Works from Terminal | Verdict |
|---|---|---|---|---|---|
| **(a) `osascript` + `display alert`, args passed as `argv`** | none | **yes** — pure Go, `GOOS=darwin CGO_ENABLED=0` build verified; argv is a golden test | yes (alert belongs to `osascript`) | yes | **Chosen** |
| (b) cgo `NSAlert` shim (`darwin && cgo`, plus a `!darwin || !cgo` stub, the `internal/localauth` pattern) | none (frameworks) | **no** — `CGO_ENABLED=1 GOOS=darwin` fails here at `runtime/cgo`; the darwin file is compiled by nobody until a human builds on a Mac | needs `[NSApplication sharedApplication]` + activation policy + main-thread; brittle at `main.go:570` where `NSApp` is half-torn-down | yes, with caveats | Declined |
| (c) cgo `CFUserNotificationDisplayAlert` | none (CoreFoundation) | **no**, same as (b) | yes — designed for exactly this | yes | Declined |
| (d) A pre-built helper `.app`/binary bundled in the DMG | packaging work in G10's already-shipped pipeline | partially | yes | only if bundled | Declined — most machinery, least benefit |
| (e) Wails `MessageDialog` | none | n/a | **no** — F4 | no | Impossible |
| (f) Wails `notifications` service | none | n/a | needs a signed bundle id + authorization; not blocking | no | Impossible for this purpose |

(b) and (c) are the technically prettier answers — (c) especially, since `CFUserNotificationDisplayAlert` was designed for alerting from a process with no GUI session, and (b) would give a correctly-branded icon. Both are declined on the same measured ground: **in this container nothing about their darwin code path can be compiled, vetted, or tested at all**, so the phase would ship an untested cgo shim whose only purpose is to be reliable on the one path that is never exercised. (a) is fully compiled and unit-tested in CI, matches an existing, reviewed house pattern (`internal/gitvsix`), adds no dependency, and its single real cost is a generic icon. If a human overrides this, (c) is the better of the two cgo options — no `NSApp` prerequisite — and §9 records that.

The exact script, four `-e` statements, arguments after `--`:

```
/usr/bin/osascript
  -e "on run argv"
  -e "activate"
  -e "set r to display alert (item 1 of argv) message (item 2 of argv) as critical buttons {\"Copy Details\", \"OK\"} default button \"OK\""
  -e "return button returned of r"
  -e "end run"
  --
  <title>
  <body>
```

`activate` foregrounds the `osascript` process so the alert is not buried behind whatever the user is looking at. `return button returned of r` makes stdout exactly the pressed label plus a newline — no record parsing, no locale sensitivity beyond our own English button labels. `as critical` gives the caution badge. Buttons are laid out right-to-left, so `{"Copy Details", "OK"}` puts the default `OK` on the right, where macOS expects it.

Locating the binary: `LookPath("osascript")` first; on failure, `Stat("/usr/bin/osascript")` and use the absolute path. If neither resolves (every non-macOS platform, including this container and CI), the presenter reports "unavailable" and D2's stderr write is the whole output — not an error, not a panic.

### D4 — Not one byte of app-supplied text is interpolated into the AppleScript source

Title and body travel as `argv` items and are read back with `item 1 of argv` / `item 2 of argv`. The five `-e` statements are compile-time constants with no format verbs. An error string containing `"`, `\`, `'`, a newline, or a fragment of AppleScript is therefore data, exactly as `gitvsix`'s `.vsix` path with a space is data (`gitvsix/exec.go:60-66`) and as G25's prepare script keeps every app-supplied value in the environment rather than the command string. This is the same "shell over data is an injection bug; shell over the user's own command is the feature" distinction G25 D9 drew — except here there is no user command at all, so the property is absolute.

`--` terminates `osascript`'s own option parsing so a body that somehow began with `-` could never be read as a flag. A golden argv test asserts `--`'s presence and position (§7.1).

### D5 — One message shape for all nine steps: headline, advice, detail, footer

`Classify(step, err) Message` produces:

```go
type Message struct {
    Step     Step
    Expected bool   // true: a state the user can act on; false: report-it-as-a-bug
    Headline string // alert message text — one short sentence, no jargon, no error text
    Advice   string // one or two sentences: what to do about it
    Detail   string // the raw error, collapsed to one line, capped at detailCap (500 bytes)
}
```

`Render` composes the alert body as, in order: `Advice`, blank line, `Details: <Detail>`, blank line, `Kira Studio <buildinfo.Version>` + newline + `Log folder: <config.LogsDir()>`. The alert title (`item 1 of argv`) is always `Headline`. The clipboard payload for *Copy Details* is a superset — step identifier, version, log folder, database path, and the **full, uncapped** error — so a bug report carries everything the alert had to abbreviate.

The table (`Expected` in the third column):

| `Step` | Site | Exp.? | Headline | Advice |
|---|---|---|---|---|
| `StepEnsureLayout` | `main.go:82` | yes | Kira Studio couldn't create its data folder. | Check that `<KiraHome()>` exists, is a folder you can write to, and that the disk isn't full. |
| `StepLogging` | `:85` | yes | Kira Studio couldn't open its log folder. | Check that `<LogsDir()>` exists, is a folder you can write to, and that the disk isn't full. |
| `StepStorage` + `schemaTooNew` | `:90` | **yes** | This copy of Kira Studio is older than your data. | Your Kira Studio data is at format version `<found>`; this copy (`<Version>`) understands up to `<known>`. Open the newer version of Kira Studio, or update this one. Your data has not been changed. |
| `StepStorage`, otherwise | `:90` | yes | Kira Studio couldn't open its database. | The database at `<DbPath()>` may be damaged, unreadable, or in use by another copy of Kira Studio. Quit any other copy and try again. |
| `StepRepos` | `:100` | no | Kira Studio couldn't prepare its database. | This is a bug. Please report it with the details below. |
| `StepSettings` | `:179` | no | Kira Studio couldn't read its settings. | This is a bug. Please report it with the details below. |
| `StepWindowList` | `:554` | no | Kira Studio couldn't read its saved windows. | This is a bug. Please report it with the details below. |
| `StepWindowCreate` | `:560` | yes | Kira Studio couldn't save its window layout. | The disk may be full, or the database at `<DbPath()>` may be read-only. |
| `StepRun` | `:569` | no | Kira Studio couldn't open its main window. | This is a bug. Please report it with the details below. |
| `StepPlatform` | `ErrorHandler` (D7) | no | Kira Studio couldn't start. | This is a bug. Please report it with the details below. |

Two rules the table follows and the implementer must not break: **the headline never contains the raw error**, and **`Expected: false` never pretends to be actionable** — "this is a bug" is the honest advice for a failed statement `Prepare` (`repos.New` is five `db.Prepare` calls, `storage/repos/repos.go:37-58`; failure means the schema does not match the binary's SQL) or a failed window-row read.

The `StepStorage` split is the whole point of D1: a schema-too-new failure is the only boot failure in the app with a specific, correct, non-technical instruction, and it is exactly the one that prompted the phase.

### D6 — All nine steps stay hard-fatal; exit(1) after acknowledgement is the only behaviour

Each site was examined for a degraded mode rather than assumed uniform:

- `EnsureLayout`, `logging.Init` — nothing downstream works without `KIRA_HOME`. Fatal.
- `storage.Open` — no database, no settings, no windows, no tabs, no connections. Fatal. (The schema-too-new arm is the case where continuing would be *actively dangerous*: it exists precisely to avoid a newer database being written by older code.)
- `repos.New` — the app's entire data access layer. Fatal.
- `Settings.GetAll` (`:179`) — *technically* degradable: `GetAll` already returns `model.DefaultSettings()` merged with stored rows (`storage/repos/settings.go:53`), and `main.go:120-127` already treats the identical failure as `slog.Warn` + defaults (F7). Left fatal: a `Query` failure here means the DB is broken in a way that will resurface within seconds, and quietly booting with silently-defaulted settings is a worse user experience than an honest refusal. Changing it is a behaviour change, and `CLAUDE.md`'s "scope left out is left out entirely" applies.
- `Windows.List` (`:554`) — degradable by minting an unpersisted record. Left fatal, same reasoning.
- `Windows.Create` (`:560`) — the most plausible degrade (open the window without persisting it). Left fatal, same reasoning; recorded in §9 as a real candidate.
- `app.Run` / `StepPlatform` — nothing to degrade to.

So: `Fatal(step, err)` = `Report(step, err)` then `os.Exit(1)`, preserving today's exit code exactly. The alert is modal, so "after dismissal" is automatic; *Copy Details* copies and then exits without re-showing.

### D7 — `application.Options.ErrorHandler` catches Wails' own pre-window fatals

```go
ErrorHandler: startupfail.WailsErrorHandler,
```

added to the `application.Options` literal at `main.go:309-350`. The handler:

1. type-asserts `*application.FatalError` — a non-fatal `handleError` call (e.g. `RegisterService` after `Run`, `application.go:556`) is logged and **not** alerted;
2. is wrapped in a `sync.Once` so at most one alert is ever shown per process;
3. classifies as `StepPlatform` and calls `Report` — Wails' own `os.Exit(1)` follows immediately, so this must not exit itself.

This is the one place `startupfail` needs a `pkg/application` type. To keep `startupfail` free of that import (`internal/shell/app.go:11`'s stated rule), `startupfail` exposes `ReportPlatform(err error)` and **`main.go` does the type assertion inline** — three lines, in the file that already legitimately imports `pkg/application` (`main.go:371-377`'s recorded exception). Rejected alternative: putting the handler in `internal/shell`, which does import `pkg/application`; declined because it would split this phase's logic across two packages for no gain, and `shell` is about window/menu/quit lifecycle, not boot failure.

Cost/benefit: ~10 lines, and it is the only thing that makes `application.go:96` and `webview_window_darwin.go:1755` (F6) visible at all.

### D8 — One new leaf package, `Deps`-shaped exactly like `internal/gitvsix`

```go
type Deps struct {
    LookPath func(string) (string, error)
    Stat     func(string) (os.FileInfo, error)
    Run      func(ctx context.Context, path string, args []string, stdin []byte) (stdout string, err error)
    Getenv   func(string) string
    Stderr   io.Writer
    Log      func(msg string, args ...any)
    Now      func() time.Time
}
```

Zero-value fields fall back to the real OS (`gitvsix/install.go:44-61`'s pattern verbatim). A fake `Run` is what lets a Linux test assert "the correct argv was built and the correct body was passed" without any macOS present. The package-level `Fatal`/`Report`/`ReportPlatform` use a default `Reporter`; `NewReporter(Deps)` is what tests construct.

Spawn discipline copied from `gitvsix/exec.go:60-88`: `exec.CommandContext`, `SysProcAttr{Setpgid: true}`, `cmd.WaitDelay = 2 * time.Second`, and a **60 s `context.WithTimeout`** so a wedged or headless `osascript` can never hold a dead app open forever. 60 s is short enough that an unattended machine is not stuck and long enough that a human at the keyboard reads and dismisses it; a timeout is a silent no-op (D2's stderr write already happened).

`Getenv` exists for one reason: `KIRA_NO_STARTUP_ALERT` (D9). It is read **inside this package**, never in `main.go`, because `scripts/verify-packaging.sh:95-104` fails the build otherwise (F13).

### D9 — One escape hatch: `KIRA_NO_STARTUP_ALERT`

Set to anything other than `""`/`"0"`/`"false"` and `Report` skips step (3) only — logging and the stderr write still happen. It exists for an automated harness that might one day launch the real binary on a Mac; without it, a boot failure in such a harness would block on a modal alert until the 60 s timeout. Rejected alternatives: keying off `config.IsDev()` (a developer is exactly who benefits from seeing what the user sees), and a `isatty(stderr)` heuristic (too clever, and a no-op in the Finder-launch case that actually matters — it would only ever change dev behaviour).

### D10 — "Copy Details" is a second button, backed by `pbcopy`

If `osascript`'s stdout trims to exactly `Copy Details`, the reporter spawns `/usr/bin/pbcopy` with the full clipboard payload on stdin — argv-only, same bounded-context spawn, same `Setpgid`. Any other stdout, an empty stdout, or a non-zero `osascript` exit is treated as "dismissed": proceed to exit. This makes the alert's inherently unselectable text recoverable for a bug report, at the cost of one extra branch and one extra spawn, both on a path that is already about to terminate the process. It is this design's most droppable element and is called out as such in §10.5.

### D11 — `CONTRACT_VERSION` stays **30**

This phase adds no RPC method, no wire type, no event, no `OpRequest` kind, no `OpErrorKind`, no capability and no settings leaf. It touches no file under `packages/` or `apps/kira-studio-vscode/`. Every failure it addresses occurs before any socket is accepted or any handshake is exchanged, so there is no client that could observe a difference. `packages/git-ipc/src/validate.ts:97` and `gitrpc/contract.go:107` both remain `30`, and `gitrpc/stash_test.go:48`'s assertion is untouched. Stated explicitly so a later phase reads this as a decision, not an omission.

### D12 — `main.go` keeps eight one-line call sites and drops the `"log"` import

Each `if err != nil { log.Fatalf("kira-studio-shell: X: %v", err) }` becomes `if err != nil { startupfail.Fatal(startupfail.StepX, err) }`. The `"log"` import (`main.go:6`) is removed — after this phase nothing in `main.go` uses it, and its absence is what prevents a future site from silently regressing to a stderr-only death. `internal/startupfail` never imports `"log"` either; it uses `slog` and an explicit `io.Writer`.

---

## 3. The Go side, file by file

| File | Change |
|---|---|
| `apps/kira-studio/internal/startupfail/step.go` | **New.** `type Step string` and the ten constants (`StepEnsureLayout`, `StepLogging`, `StepStorage`, `StepRepos`, `StepSettings`, `StepWindowList`, `StepWindowCreate`, `StepRun`, `StepPlatform`); a `String()`-ish stable identifier used in the slog record and the clipboard payload. Package doc states the phase's premise (no window exists; Wails dialogs are unusable — F4) and the argv-only rule (D4). |
| `apps/kira-studio/internal/startupfail/classify.go` | **New.** `type Message`, the `schemaTooNew` interface (D1), `Classify(step Step, err error) Message` implementing D5's table, `collapse(s string, cap int) string` (newlines → spaces, bounded — `gitvsix.firstLineBounded`'s instinct at a slightly larger cap). Pure: no I/O, no spawn. |
| `apps/kira-studio/internal/startupfail/render.go` | **New.** `RenderAlert(Message) (title, body string)` and `RenderClipboard(Message, fullErr error) string`. Reads `buildinfo.Version`, `config.LogsDir()`, `config.DbPath()`, `config.KiraHome()`. Pure. |
| `apps/kira-studio/internal/startupfail/alert.go` | **New.** `alertArgv(title, body string) []string` — the five `-e` statements, `--`, then the two arguments (D3). `const detailCap`, `const alertTimeout`, `const gracefulStopDelay`, the button labels, the `osascriptFallbackPath`/`pbcopyPath` constants. Pure builder; the golden test targets it. |
| `apps/kira-studio/internal/startupfail/report.go` | **New.** `Deps`, `Reporter`, `NewReporter(Deps)`, `(*Reporter).Report(step, err)`, `(*Reporter).present(Message)` (locate → run → read button → maybe `pbcopy`), the `KIRA_NO_STARTUP_ALERT` check, and the package-level `Fatal(step, err)` (`Report` then `os.Exit(1)`), `Report(step, err)`, `ReportPlatform(err)` over a default `Reporter`. `sync.Once` guarding at-most-one-alert (D7). |
| `apps/kira-studio/internal/startupfail/exec.go` | **New.** `realLookPath`/`realStat`/`realRun`/`realGetenv` — `realRun` is `gitvsix/exec.go:60-88` adapted to also carry stdin and return stdout: `exec.CommandContext`, `SysProcAttr{Setpgid: true}`, `WaitDelay`, `cmd.Env = os.Environ()` (the alert needs the user's real session environment), bounded stdout capture. |
| `apps/kira-studio/internal/startupfail/classify_test.go` | **New.** Table test over all ten steps × the schema-too-new arm: asserts `Expected`, that the headline never contains the raw error text, that the schema arm's advice contains both integers, and that a 10 KB multi-line error collapses to one line at `detailCap`. Uses a local fake implementing `SchemaTooNew()` — no `internal/storage` import. |
| `apps/kira-studio/internal/startupfail/alert_test.go` | **New.** Golden argv assertion, byte for byte, including `--`'s position; a body containing `"`, `\`, a newline and `-leading-dash` appears verbatim as the last argv element and nowhere inside any `-e` statement. |
| `apps/kira-studio/internal/startupfail/report_test.go` | **New.** Fake `Deps`: (a) `osascript` absent → no spawn, stderr still written, no error; (b) present → exactly one spawn with the expected argv; (c) stdout `"Copy Details\n"` → a second spawn of `pbcopy` whose stdin is the clipboard payload; (d) stdout `"OK\n"` → no second spawn; (e) `osascript` exits non-zero → no second spawn, no panic; (f) `KIRA_NO_STARTUP_ALERT=1` → zero spawns, stderr still written. |
| `apps/kira-studio/internal/storage/migrate.go` | **Edit.** `SchemaTooNewError` type + `SchemaTooNew()` method; `:42-47`'s `fmt.Errorf` becomes `&SchemaTooNewError{…}`. Message text unchanged. |
| `apps/kira-studio/main.go` | **Edit.** Drop the `"log"` import (`:6`); add `internal/startupfail`. Eight call sites (`:83`, `:86`, `:92`, `:102`, `:181`, `:556`, `:561`, `:570`) → `startupfail.Fatal(step, err)`. Add `ErrorHandler:` to the `application.Options` literal (`:309`), three lines, asserting `*application.FatalError` and calling `startupfail.ReportPlatform` (D7). |

**No TypeScript, Vue, `packages/`, or `apps/kira-studio-vscode` changes whatsoever.**

---

## 4. Dependencies and tooling

None added. No `go.mod` change, no npm/bun change, no `flatc` regeneration, no migration file, no `build/` or `scripts/` change. `internal/startupfail` imports only `context`, `errors`, `fmt`, `io`, `log/slog`, `os`, `os/exec`, `strings`, `sync`, `syscall`, `time` — plus `internal/buildinfo` and `internal/config`, both of which are already-linked leaves. It imports nothing under `internal/bridge` (`internal/layering_test.go` covers it automatically, since that test enumerates every `internal/*` package from `go list`) and nothing from `pkg/application`.

---

## 5. Implementation order

1. **`internal/storage/migrate.go`** — `SchemaTooNewError` + `SchemaTooNew()`; the refusal returns it. Run `go build ./apps/kira-studio/internal/storage/...`. Smallest, most isolated change; everything downstream depends on it existing.
2. **`internal/startupfail/step.go` + `classify.go`** — the vocabulary and the whole decision table, with `classify_test.go` alongside. Green before anything spawns anything.
3. **`internal/startupfail/render.go`** — alert and clipboard rendering.
4. **`internal/startupfail/alert.go` + `alert_test.go`** — the argv builder and its golden test. This is the security-critical unit (D4); it lands green before any code can spawn.
5. **`internal/startupfail/exec.go` + `report.go` + `report_test.go`** — `Deps`, `Reporter`, the six fake-driven cases, the `sync.Once`, the env escape hatch, `Fatal`/`Report`/`ReportPlatform`.
6. **`main.go`** — the eight call sites and the `"log"` import removal, in one commit; the `ErrorHandler` in a second.
7. **Verification sweep** — `go vet ./apps/kira-studio/...`; `go test` over the SPEC-scoped git package set **plus `internal/startupfail`, `internal/storage`, `internal/storage/repos` and `internal`** (the layering test); `GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build ./apps/kira-studio/internal/startupfail/` (the cross-compile claim D3 rests on); `sh scripts/verify-packaging.sh` (check S8 — the `os.Getenv` guard); `bun run lint`.

Steps 2–5 are strictly sequential (each builds on the previous type). Nothing here is parallelisable; per `CLAUDE.md`, one sequential Sonnet subagent implements the whole phase.

---

## 6. What the user actually sees

A worked example — an older build launched against a newer `kira.db`, the case that prompted the phase:

```
┌─────────────────────────────────────────────────────────────┐
│  ⚠  This copy of Kira Studio is older than your data.       │
│                                                             │
│  Your Kira Studio data is at format version 19; this copy   │
│  (1.3.0) understands up to 17. Open the newer version of    │
│  Kira Studio, or update this one. Your data has not been    │
│  changed.                                                   │
│                                                             │
│  Details: storage: database schema_version (19) is newer    │
│  than this build knows about (17) — refusing to run         │
│  against a downgraded app                                   │
│                                                             │
│  Kira Studio 1.3.0                                          │
│  Log folder: /Users/x/.kira-studio/logs                     │
│                                                             │
│                        [ Copy Details ]        [    OK    ] │
└─────────────────────────────────────────────────────────────┘
```

And in `~/.kira-studio/logs/kira-2026-09-09.log` — which today would contain nothing at all:

```
time=… level=ERROR msg="This copy of Kira Studio is older than your data." scope=startup step=storage err="storage: database schema_version (19) is newer than this build knows about (17) — refusing to run against a downgraded app"
```

---

## 7. Exit criteria

### 7.1 Tier 1 — fully provable in this container

1. `go test ./apps/kira-studio/internal/startupfail/... ./apps/kira-studio/internal/storage/... ./apps/kira-studio/internal/` passes, plus the SPEC-scoped git package set unchanged.
2. `Classify` covers all ten `Step` values; a `switch` with no `default` fallthrough means adding a `Step` without a message is a compile-visible gap, and the table test enumerates every constant.
3. The schema-too-new arm produces advice containing both integers, driven by a **local** fake implementing `SchemaTooNew()` — proving `startupfail` does not import `internal/storage`.
4. The golden argv test passes byte for byte, `--` included, with a hostile body (`"`, `\`, newline, leading `-`) appearing only as the final argv element.
5. `grep -rn "Sprintf\|fmt\.Errorf\|strings\.Join\|+ *title\|+ *body" apps/kira-studio/internal/startupfail/alert.go` finds nothing that reaches an `-e` statement.
6. All six `report_test.go` cases pass, including `KIRA_NO_STARTUP_ALERT` producing zero spawns.
7. `GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build ./apps/kira-studio/internal/startupfail/` succeeds.
8. `go vet ./apps/kira-studio/...` clean; `grep -n '"log"' apps/kira-studio/main.go` finds nothing; `grep -c "log.Fatal" apps/kira-studio/main.go` is 0.
9. `sh scripts/verify-packaging.sh` passes — specifically check S8 (`main.go` contains no `os.Getenv`).
10. `bun run lint` passes; `packages/git-ipc/src/validate.ts:97` and `gitrpc/contract.go:107` are both still `30`, and `git diff --stat` shows **zero** files touched under `packages/` or `apps/kira-studio-vscode/`.
11. `internal/layering_test.go` passes with `internal/startupfail` enumerated and non-exempt.

### 7.2 Tier 2 — reasoned check

12. On Linux, run the built binary with `KIRA_HOME` pointed at a path that is a *file* rather than a directory: `EnsureLayout` fails, exit code is 1, the rendered message appears on stderr, and no spawn is attempted (`osascript` absent). This exercises the real `Fatal` path end to end short of the alert itself.
13. Same, with a `kira.db` whose `schema_version` row is hand-set above `maxVersion`: the stderr output is the schema-too-new wording with both integers, not the generic database wording.

### 7.3 Tier 3 — needs a human on a Mac

14. Packaged `.app`, launched from **Finder**, with `~/.kira-studio` made read-only: an alert appears, in front of whatever was frontmost, with the *couldn't create its data folder* wording. **Expected:** modal, caution-badged, dismissible; app exits after dismissal.
15. Same build, `kira.db`'s `schema_version` hand-raised: the schema-too-new alert renders exactly as §6, and `~/.kira-studio/logs/kira-<today>.log` gains the matching `ERROR` line.
16. *Copy Details* actually populates the clipboard with the full, uncapped payload.
17. The same binary run from **Terminal**: the alert still appears *and* the same text is on stderr.
18. `application.Options.ErrorHandler` fires: force `assetserver.GetStartURL` to fail (or otherwise induce a Wails `FatalError` before the first window) and confirm the *couldn't start* alert appears — today this path exits silently and `main.go` never sees it (F6).
19. Confirm the alert is not buried: launch with several full-screen apps in front and verify `activate` brings it forward. If it does not, the fallback recorded in §9 is `display alert` inside `tell application "System Events"`.
20. Confirm, for the record, where a Finder-launched `.app`'s stderr actually goes today (`log show --predicate 'process == "Kira Studio"'` vs. nothing) — the one factual claim in F1 this container cannot settle. It changes nothing in the design; it settles the doc.

### 7.4 The checklist

- [ ] All eight `log.Fatal*` sites in `main.go` are gone; `"log"` is no longer imported.
- [ ] Every failure produces a `slog.Error` record **and** stderr **and** an alert attempt, in that order.
- [ ] No app-supplied text is ever interpolated into an AppleScript statement; proven by the golden argv test with a hostile body.
- [ ] The schema-too-new case is recognised structurally (`SchemaTooNew() (int, int)`), never by string matching, and `startupfail` does not import `internal/storage`.
- [ ] `Expected: false` steps say "this is a bug", not a fake remedy; no headline contains raw error text.
- [ ] The alert spawn is bounded (60 s context, `WaitDelay`, `Setpgid` group kill) and cannot hang the process.
- [ ] `KIRA_NO_STARTUP_ALERT` is read inside `internal/startupfail`, never in `main.go` (check S8).
- [ ] `application.Options.ErrorHandler` alerts only on `*application.FatalError`, at most once, and does not exit itself.
- [ ] Every step still exits 1, exactly as `log.Fatalf` did.
- [ ] `CONTRACT_VERSION`/`ContractVersion` both still 30; zero files touched under `packages/` or `apps/kira-studio-vscode/`.

---

## 8. Explicit non-goals for G29

Any degraded or partial boot (D6); a recovery/repair action of any kind (no "reset my database", no "back up and start fresh"); a crash reporter or telemetry; capturing panics; an in-window failure panel (G14 D3 owns that); changing `internal/gitreview/migrate.go` or anything else about the review-db refusal (F9 shows it already surfaces); fixing `ReviewFilesState.mark()`'s missing `catch` (F10 — handed to G30); reconciling F7's fatal-vs-warn inconsistency on `Settings.GetAll`; recording the writing app's version in `kira.db`; an app-branded alert icon; a cgo dialog shim; a bundled helper binary; single-instance enforcement; touching `docs/v1.3/SPEC.md`.

---

## 9. Handed forward

**To G30's code-review rounds, noticed in passing and out of this phase's stated scope:**

- **F10 — `packages/git-ui/src/state/reviewFiles.ts:230-249` (`mark`) has `try`/`finally` with no `catch`, and `#openInEditor` (`:172-195`) has neither.** Both are invoked as `void …` (`ReviewFilesPane.vue:86`; `reviewFiles.ts:133`, `:135`, `:149`) and there is no global `unhandledrejection` handler anywhere in `packages/git-ui/src`, `packages/git-core/src` or `apps/kira-studio-vscode/src`. A failed `review.mark` therefore silently does not toggle. The fix is the same three lines `#loadFiles` already has (`:112-116`), writing into a new `markError`/reusing `diffError`. Real, pre-existing, client-side.
- **F7 — `Settings.GetAll()` is fatal at `main.go:181` and `slog.Warn` + zero values at `main.go:120-127`.** Two defensible postures for one call; worth a deliberate decision rather than an accident.
- **F8 — `os.Exit` at the late boot sites skips `teardown` (`main.go:274-295`) entirely**, leaving the git socket bound, the askpass broker live, `connectionsSvc` started, and the metrics/oplog tickers running. Survivable by design (`gitsock`'s `flock` stale-socket recovery, SPEC §3.2) but never stated as intentional anywhere.
- **F6 — Wails calls `os.Exit(1)` itself at `application.go:96` and `webview_window_darwin.go:1755`**, bypassing `main` entirely. G29 makes these *visible* via `ErrorHandler`; it does not make them *recoverable*, and nothing else in the tree accounts for them.
- **`CLAUDE.md`'s "Known open items" first-launch window-size clamp** is a startup-ordering item in the same neighbourhood (windows created before `app.Run()`), untouched here.

**Future work this phase deliberately leaves open:**

- **Branding the alert icon.** `display alert` has no `with icon`; closing this means either `display dialog … with icon POSIX file "<bundle>/Contents/Resources/*.icns"` (losing `as critical` styling and the separate informative-text field) or the cgo `NSAlert` shim D3 declined. Revisit only if a human on a Mac finds the generic icon genuinely confusing.
- **If `activate` proves insufficient (§7.3 item 19)**, the fallback is `tell application "System Events" to display alert …`; if that also fails, `CFUserNotificationDisplayAlert` via cgo is the next option — it is the only one that needs neither `NSApp` nor a foreground process.
- **`internal/startupfail` is the natural home for any future "tell the user something before a window exists" need** — a first-run permission explanation, a disk-full warning at shutdown. Its `Deps` seam and argv discipline generalise; its `Step`/`Classify` table does not, and should be extended rather than bypassed.
- **`Windows.Create` failing (`main.go:560`) is the one genuinely plausible degrade-instead-of-die candidate** — open the window without persisting the row. Deliberately not taken here (D6); if it is ever taken, `openWindow`'s `WindowClosing` delete (`main.go:489`) is already a harmless no-op for a row that was never inserted.

---

## 10. Calls that want a human eye — with a recommendation for each

*This phase is being run autonomously; each recommendation below is the decision that will be taken unless a human overrides it.*

**10.1 — The alert mechanism itself. (The big one.)** Alternatives: (a) argv-only `osascript`; (b) cgo `NSAlert`; (c) cgo `CFUserNotificationDisplayAlert`; (d) a bundled helper app; (e)/(f) Wails' dialog or notification services. **Recommendation: (a), exactly as D3.** (e) and (f) are structurally impossible (F4). (b) and (c) are nicer on macOS but cannot be compiled, vetted or tested in this container at all (measured: `CGO_ENABLED=1 GOOS=darwin` fails at `runtime/cgo`), which is disqualifying for code whose whole purpose is to work on the one path nobody exercises. (a) cross-compiles and unit-tests here (measured), adds no dependency, and reuses a reviewed house pattern (`internal/gitvsix`). If overridden, take **(c)**, not (b) — it needs no `NSApplication`, which is exactly the property that matters at `main.go:570`.

**10.2 — Logging *and* alerting, rather than alerting alone.** **Recommendation: both, as D2.** SPEC's premise was that these failures reach the log file; they do not (F1). Fixing the alert without fixing the log record would leave a user who dismisses the alert with nothing to attach to a bug report, and would leave the phase's own stated premise still false.

**10.3 — All nine steps stay hard-fatal.** **Recommendation: as designed (D6).** Two sites (`Settings.GetAll`, `Windows.Create`) are genuinely degradable, and each is recorded in §9 with the shape a future change would take. Taking them now would make this phase a behaviour change to boot semantics rather than a visibility change, against `CLAUDE.md`'s "scope left out is left out entirely."

**10.4 — Wiring `application.Options.ErrorHandler`.** **Recommendation: wire it (D7).** ~10 lines for the only coverage of two real pre-window fatal paths that `main.go` structurally cannot see (F6). The `*FatalError` type assertion and the `sync.Once` are what keep it from firing on ordinary errors or twice.

**10.5 — The "Copy Details" button and its `pbcopy` spawn.** **Recommendation: ship it (D10)** — an alert's text is unselectable, and this is the difference between a usable bug report and a retyped error. **This is the single most droppable item in the plan**: dropping it removes one branch, one spawn and two test cases, and costs only that convenience. If overridden, the alert becomes a one-button `{"OK"}` alert and `present` stops reading stdout entirely.

**10.6 — `KIRA_NO_STARTUP_ALERT` rather than a dev-mode or TTY heuristic.** **Recommendation: the env var, read inside the package (D9).** `config.IsDev()` would suppress it for exactly the audience that benefits most; a TTY check is a pure no-op in the Finder-launch case that motivates the phase and would only ever change dev behaviour. The env var must not be read in `main.go` — `scripts/verify-packaging.sh:95-104` fails the build (F13).

**10.7 — Leaving `internal/gitreview/migrate.go` alone.** **Recommendation: leave it (F9).** SPEC's escape hatch opens only if the refusal is silently swallowed. It is not: it renders as "Couldn't load the file list — …" in `ReviewFilesPane.vue:92-93`, via a path traced site by site in F9. Widening scope on a surface that already works would be motion, not progress.

**10.8 — Handing F10's missing `catch` to G30 rather than fixing it here.** **Recommendation: hand it forward (§9).** It is a real defect, but it is a client-side mid-session RPC gap, not a boot failure, and G30 is one phase away with a dedicated correctness reviewer. Fixing it here would put a `packages/git-ui` diff into a phase that otherwise touches zero frontend files — which is itself a useful reviewability property worth preserving.

**10.9 — Recognising the schema refusal by a duck-typed interface instead of `errors.As` on an imported type.** **Recommendation: the interface (D1).** One line, keeps `startupfail` a leaf with no `modernc.org/sqlite` in its dependency graph, keeps its tests importable from anywhere, and would recognise `gitreview`'s byte-identical refusal for free if a later phase ever needs it — without violating the module boundary `gitreview/migrate.go:9-15` deliberately duplicated code to protect.

### Critical Files for Implementation

- /home/user/kira-studio/apps/kira-studio/main.go
- /home/user/kira-studio/apps/kira-studio/internal/storage/migrate.go
- /home/user/kira-studio/apps/kira-studio/internal/gitvsix/exec.go
- /home/user/kira-studio/apps/kira-studio/internal/gitvsix/install.go
- /home/user/kira-studio/apps/kira-studio/internal/config/paths.go
- /home/user/kira-studio/apps/kira-studio/internal/logging/log.go
