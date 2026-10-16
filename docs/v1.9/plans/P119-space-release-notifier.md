# P119 — Kira Space release feed, curl installer, in-app update: plan

Opus planning pass. Plan only — nothing here is implemented yet. Base: `7cc1c16a`. Sites are
`file:line` against that commit. The implementer re-reads each site before editing.

This file replaces an earlier P119 plan written for the SPEC row's since-superseded second
decision (a Homebrew tap and cask formulas). None of that carries forward: no tap, no cask, no
`brew` reference anywhere. The authoritative ask is `docs/v1.9/SPEC.md:63`'s **third** design
decision.

Path shorthands: `ST/` = `apps/kira-studio/`, `SF/` = `apps/kira-studio/frontend/src/`,
`KS/` = `apps/kira-space/`, `KF/` = `apps/kira-space/frontend/src/`, `WB/` =
`packages/workbench/src/`, `AU/` = repo-root `internal/appupdate/` (new home).

## §0 Goal, method, acceptance

**Goal.** Both apps install and self-update through one curl-driven script. Plain `curl` never sets
`com.apple.quarantine`, so Gatekeeper never blocks the unnotarized, ad-hoc-signed bundle. One
shared `v*.*.*` tag builds and releases both DMGs. Each app detects a newer release, shows an
explicit update dialog, and on the user's click runs the installer detached, quits, and is
relaunched at the new version.

**Method.**
- CodeGraph `codegraph_explore` first, on: `appupdate.Checker`/`NewChecker`/`Result`/`ReleaseURL`
  and callers; `bridge.UpdateService`/`OpenReleasePage`/`Browser`; `shell.NewDeferredBrowser`/
  `browserOpener`; both `main.go` service lists; `shell.Quitter`/`RequestQuit`/`ShouldQuit`/
  `flushThenQuit`; `wireLifecycle`; `createCoreControl`/`CoreBindings`; `createKeepAwakeStore`/
  `createAppMetricsStore`; `useAppUpdateStore`/`initAppUpdate`; both `StatusBar.vue`; shadcn-vue
  `Dialog` consumers (`ConfirmDialog.vue`, `GitCredentialDialog.vue`); `procgroup` and
  `gitclient`'s `Setsid` spawn.
- Read in full at base: SPEC row `:63`; `.github/workflows/release.yml`;
  `docs/pending-changes/.github__workflows__release.yml.patch`; `scripts/verify-packaging.sh`;
  Studio `appupdate/{checker,checker_test,version,version_test}.go`; `ST/internal/bridge/update.go`;
  both `main.go`; `KS/internal/bridge/{browser,github}.go`; `WB/bridge/createCoreControl.ts`;
  `WB/state/create{KeepAwake,AppMetrics}Store.ts`; `WB/state/queryClient.ts`; `SF/state/appUpdate.ts`;
  both `StatusBar.vue`/`App.vue`/`main.ts`/`bridge/index.ts`; `ST/tests/ui/update-banner.spec.ts`;
  both apps' `tests/ui/support/{ipcChannels,mockRuntime}.ts`; `docs/DEV_ENVIRONMENT.md:15-41`;
  `docs/PACKAGING.md` §7; `docs/ARCHITECTURE.md:74-80,108-116,2341-2372`; `README.md:212-240,
  421-430`; `KS/README.md:139-160`.

**Acceptance** (SPEC row's own wording, made concrete):
1. `scripts/install.sh` exists, is POSIX `sh`, and `curl -fsSL <raw URL> | sh -s -- --app=studio`
   (or `--app=space`) installs or replaces that app in `/Applications` from the latest published
   release, then opens it. Install and update are the same command.
2. `internal/appupdate` lives at repo root, imports nothing under `apps/`, and is shared by both
   apps. The checker is parameterized only by display name and running version.
3. Each app's `UpdateService` has `Status`, `InstallUpdate`, `CancelInstall`. A detected newer
   version opens an explicit dialog (available vs running, **Update** and **Later**). Nothing
   installs without the **Update** click.
4. **Update** stages the new version through the detached script, then quits the app. The script
   swaps the bundle and relaunches the new version.
5. Kira Studio's old click-opens-release-page behavior is gone: no `OpenReleasePage`, no
   `ReleaseURL`, no `Browser` on `UpdateService`. Deliberate behavior change (§4.6).
6. A dev build (`"0.0.0"`/`"0.0.0-dev"`/`"0.0.0-unknown"`) makes zero network requests, shows
   nothing, and `InstallUpdate` refuses to run.
7. `docs/pending-changes/.github__workflows__release.yml.patch` is rewritten in place. It makes the
   one `release` job stamp, package, verify and draft both DMGs on one `gh release create`. Its
   release notes name the curl command as the only supported install method.
8. `bun run lint`, `bun run typecheck`, `bun run lint:go`, `bun run lint:dead`, `go build ./...`
   pass on every commit. No `--no-verify`.
9. §11.3's Mac checklist runs on real hardware once a shared release exists. A Linux sandbox cannot
   satisfy it; the phase stays open until it runs.

## §1 Current state (verified at `7cc1c16a`)

- `ST/internal/appupdate/checker.go:25` imports `ST/internal/buildinfo`. `:212` uses it only for the
  User-Agent. `NewChecker(runningVersion)` already receives the same value (`ST/main.go:130`). A
  repo-root package cannot import `apps/kira-studio/internal/...` (Go `internal/` rule), so the
  hoist must drop that import.
- `checker.go` dead weight under the new design: `releasesPageURL` (`:34`), `release.HTMLURL`
  (`:55`), `Result.releaseURL` (`:65`), `buildResult`'s `safeReleaseURL` call (`:156`),
  `ReleaseURL()` (`:160-169`), `safeReleaseURL` (`:171-187`), imports `net/url`/`strings`.
  `version_test.go:59-80` `TestSafeReleaseURL` goes with them. Everything else moves unchanged:
  `Checker`, `Status`, `dueForCheck`, `refresh`, `buildResult` (minus the URL line), `httpClient`,
  `httpFetch`, `okInterval`/`failureInterval`, singleflight, and all of `version.go`.
- `ST/internal/bridge/update.go:12-14` declares Studio's `Browser` interface. `LinkService` (`ST/main.go:177`)
  still needs it after `UpdateService` drops it. `:49-51` `OpenReleasePage` is the only
  `ReleaseURL` caller (CodeGraph: 1 caller).
- `KS/internal/bridge/browser.go:3-5`'s comment says Space copies `Browser` because it has no
  `UpdateService` "yet". `KS/internal/bridge/github.go:19,43` cite `appupdate/checker.go`'s
  `safeReleaseURL` as precedent. Both comments go stale.
- Studio frontend: `SF/state/appUpdate.ts` is a hand-rolled `setInterval` hourly poll in a plain
  `defineStore`. `SF/bridge/index.ts:70-71` binds `updateStatus`/`updateOpenReleasePage`.
  `SF/workbench/StatusBar.vue:38-46,85-98` renders `[data-testid="update-available"]` and calls
  `control.updateOpenReleasePage()`. `SF/main.ts:372` calls `initAppUpdate()` after mount.
- Space: no `UpdateService`, no store, no item. `KS/main.go:192` builds its `quitter`;
  `KS/main.go:197-210` is its Services list.
- Shared seams (P116): `WB/bridge/createCoreControl.ts` `CoreBindings` is structural; each app's
  `bridge/index.ts` passes generated `@bindings/*` modules. `createAppMetricsStore(control)` and
  `createKeepAwakeStore(control, extend)` are the store-factory precedent. `WB/components/
  AppMetricsItem.vue` is the shared status-bar-item precedent (plain props).
- Dialog precedent: `WB/components/ConfirmDialog.vue` (shared, mounted in both `App.vue`, `v-if`
  for stacking), `KF/workbench/GitCredentialDialog.vue` (shadcn-vue `Dialog`/`DialogContent`/
  `DialogHeader`/`DialogTitle`/`DialogFooter`, `Button variant="dialog"`/`"dialog-primary"`,
  `size="kira-lg"`, Tailwind utilities, `data-testid` per control).
- TanStack precedent: `SF/api/state/variables.ts:65,96` calls `useQuery(opts, queryClient)` and
  `useMutation(...)` inside a Pinia setup store. `WB/state/queryClient.ts` is shared; both apps
  install `VueQueryPlugin` with it.
- Quit: `shell.Quitter.RequestQuit()` (`internal/shell/quit.go:81`) is `app.Quit()`, which runs the
  flush handshake (2 s cap) then teardown. Both apps hand it to their menu already.
- Detached-spawn precedent: `KS/internal/gitclient/runner.go:320-324` sets
  `SysProcAttr{Setsid: true}`. `internal/procgroup.Kill(pid, sig)` signals a whole group.
- `.github/workflows/release.yml` (live) is Studio-only **and already broken twice**: `:100`
  stamps `apps/kira-studio-vscode/package.json` (renamed `apps/kira-space-vscode`), `:111` runs
  `bun run package` (renamed `package:studio`; no plain `package` key in `package.json`).
- The pending patch (132 lines) fixes both, but adds a **separate** `release-space` job with
  `gh release upload`. The SPEC row replaces that: one job, one `gh release create`, both assets.
  `docs/DEV_ENVIRONMENT.md:37-39`: rewrite that same file, never create a second one.
- `scripts/verify-packaging.sh:125-132` S10 greps `apps/ packages/` for `browser_download_url|
  releases/download`. `:228-317` already carries Space's A1/A3/A5/A6/N2/A4/N3 checks, gated on the
  bundle existing. `:106-123` S9 already pins the vscode manifest to `KS/build/config.yml`.
- `KS/build/config.yml:14` and `ST/build/config.yml:17` are each the file's only two-space
  `  version:` line. `apps/kira-space-vscode/package.json:8` is its only two-space `"version"`.
- `internal/ipcerr` already uses `"E_CANCELLED"` and `"E_TIMEOUT"` codes elsewhere; reuse them.
- `WB/testing/ui/mockRuntime.ts:20-24` `ControlSnapshot` supports a seeded `error`.

## §2 `scripts/install.sh` — the security-sensitive core

Real shell code that runs unattended with the user's privileges and replaces an app bundle. Every
requirement below is load-bearing; none is optional polish.

### §2.1 Interface (the contract with the Go side)

```
install.sh --app=studio|space [--wait-pid=<pid> --notify-fd=<3-9>]
```

- `--app` required. Table, in the script only:

  | `--app` | App name | Bundle ID | Asset |
  | --- | --- | --- | --- |
  | `studio` | `Kira Studio` | `com.kirathecat.kira-studio` | `kira-studio-macos-arm64.dmg` |
  | `space` | `Kira Space` | `com.kirathecat.kira-space` | `kira-space-macos-arm64.dmg` |

- `--wait-pid`/`--notify-fd` are passed only by the app itself (self-update mode). Both or neither.
  `--wait-pid` must match `^[0-9]+$`; `--notify-fd` must match `^[3-9]$` (it is `eval`-interpolated
  into a redirection, so the regex is what keeps `eval` safe). Anything else: usage error, exit 2.
- Line 2 of the file is exactly `# kira-install-contract: 1`. The Go side refuses a fetched script
  without it (§3.3). Rule: never break contract-1 flags or the `staged` handshake. A change that
  must break them bumps the marker to `2`; every older app then refuses the new script with a
  clear error instead of misdriving it.
- Handshake: in self-update mode, once the new bundle is staged and verified, the script writes one
  line `staged <tag>` to fd `N`, then closes fd `N`. The app quits only after reading that line.
- Log file: `$HOME/Library/Logs/<App name>/install.log`. The Go side computes the same path
  (§3.3). Interactive mode: `log()` writes to stderr and appends to the log. Self-update mode: the
  app already made stdout/stderr the log, so `log()` writes stderr only (no duplicate lines).
- Exit codes: `0` installed and launched; `1` any failure; `2` usage; `130` interrupted.

### §2.2 Shape

```sh
#!/bin/sh
# kira-install-contract: 1
# <one-paragraph header: what it does, both invocation forms, the log path>
set -eu
main() {
  ...everything...
}
main "$@"
```

- **`main` wrapper.** `sh` parses the whole function before running it, so a `curl | sh` cut short
  mid-transfer never executes a partial script. The last line calls it.
- **`set -eu`, no `pipefail`.** `pipefail` is not POSIX. Instead, no pipeline carries a step whose
  failure matters: every network response and tool output goes to a file in `$WORK` first, and is
  read back from there. Grep-able rule for the implementer: no `curl ... |`.
- **Fixed `PATH`.** `PATH=/usr/bin:/bin:/usr/sbin:/sbin; export PATH` first thing. A user's
  GNU-coreutils-first `PATH` (or a shadowing `curl`) must not change behavior. Every tool used ships
  with macOS 14: `curl`, `hdiutil`, `ditto`, `codesign`, `/usr/libexec/PlistBuddy`, `osascript`,
  `shasum`, `open`, `pgrep`, `mktemp`, `sw_vers`, `sysctl`, `stat`.
- `umask 022`. Stdin of every child is `</dev/null` (piped-stdin mode must never feed the rest of
  the script to `hdiutil` or anything else that reads stdin).
- **Never ignore `SIGPIPE`.** If the app dies mid-staging, the `staged` write hits a closed pipe and
  the default `SIGPIPE` kills the script before any swap — the correct outcome.

### §2.3 Steps, in order

1. **Parse args** (§2.1). Resolve `APP_NAME`, `BUNDLE_ID`, `ASSET`, `SLUG`, `LOG`. `mkdir -p` the
   log dir (0700). Interactive mode only: truncate `LOG` if over 1 MiB. Log a header line: UTC time,
   mode, `--app`, `$$`.
2. **Preflight.** `sysctl -n hw.optional.arm64` = `1` (not `uname -m` — a Rosetta shell reports
   `x86_64` on Apple Silicon). `sw_vers -productVersion` major ≥ 14. `/Applications` exists and
   `test -w /Applications`, else die: "`/Applications` isn't writable by this user — run as an
   admin user."
3. **Work dirs.** `WORK=$(mktemp -d "${TMPDIR:-/tmp}/kira-install.XXXXXX")`.
   `STAGE=$(mktemp -d "/Applications/.$SLUG-install.XXXXXX")` — same volume as the target, so the
   final swap is two `rename(2)`s, never a cross-device copy. `MNT="$WORK/mnt"`.
4. **Traps.** `trap cleanup EXIT`; `trap 'exit 130' INT TERM HUP`. `cleanup` (§2.4) is the only
   exit path.
5. **Resolve release.** `curl --proto '=https' --tlsv1.2 -fsSL --connect-timeout 20 --retry 3
   --retry-delay 2 -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28'
   -o "$WORK/release.json" https://api.github.com/repos/vlad-cirstean/kira-studio/releases/latest`.
   404: die "no published release yet". Parse with JXA (`osascript -l JavaScript`, built into every
   macOS; JSON.parse over the file, argv-passed path and asset name): `tag_name`, `draft`,
   `prerelease`, and for the asset named `$ASSET`: `browser_download_url`, `size`, `digest`. One
   value per output line, into `$WORK/release.txt`, read back with `sed -n Np`. Why JXA:
   `plutil` rejects JSON `null`s (GitHub's release JSON has them), `jq` ships only from macOS 15,
   `sed`/`grep` over JSON is fragile, `python3` on 14 is a stub that prompts to install CLT.
   Validate: `draft`/`prerelease` both `false` (same belt-and-braces as `buildResult`); tag matches
   `^v[0-9]+\.[0-9]+\.[0-9]+$`; URL starts with
   `https://github.com/vlad-cirstean/kira-studio/releases/download/<tag>/`; `size` is digits.
6. **Download.** Same `curl` flags plus `--speed-limit 1024 --speed-time 60` (abort a stalled
   transfer instead of hanging forever) to `$WORK/app.dmg`. Assert byte size equals `size`. If
   `digest` is `sha256:<hex>`, `shasum -a 256` must match; if absent, log a note (codesign and
   identity checks in step 8 are the real gate).
7. **Mount and copy.** `hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$MNT"
   "$WORK/app.dmg" </dev/null`; set `MOUNTED=1`. Assert `"$MNT/$APP_NAME.app"` is a directory.
   `ditto "$MNT/$APP_NAME.app" "$STAGE/$APP_NAME.app"` (preserves symlinks, xattrs, signature).
   `hdiutil detach "$MNT"`; `MOUNTED=0`.
8. **Verify staged bundle.** `codesign --verify --deep --strict`; `CFBundleIdentifier` equals
   `$BUNDLE_ID`; `CFBundleShortVersionString` equals `${TAG#v}`. Any mismatch: die, nothing
   touched.
9. **Hand off (self-update mode only).** `eval "printf 'staged %s\n' \"\$TAG\" >&$NOTIFY_FD"`, then
   `eval "exec $NOTIFY_FD>&-"`. Set `HANDED_OFF=1`. Then wait for `--wait-pid`: poll `kill -0`
   once a second, up to 60 s (the app's quit flush caps at 2 s; teardown is well under that). Still
   alive at 60 s: die "`$APP_NAME` didn't quit".
10. **Running check.** `pgrep -xq "$APP_NAME"` (process name is the bundle executable, ≤16 chars
    for both). Interactive: die "Quit `$APP_NAME` first, then rerun." Self-update: die
    "`$APP_NAME` was reopened before the update finished."
11. **Swap (critical section).** `trap '' INT TERM HUP`. If `/Applications/$APP_NAME.app` exists,
    `mv` it to `$STAGE/previous.app`. `mv "$STAGE/$APP_NAME.app" "/Applications/$APP_NAME.app"`;
    on failure, `mv "$STAGE/previous.app"` back, then die. Restore `trap 'exit 130' INT TERM HUP`.
    `previous.app` goes with `$STAGE` in `cleanup`. At no instant does a partial bundle sit at the
    final path: it is either the old complete bundle, absent for one `rename` gap, or the new
    complete, verified bundle.
12. **Launch.** `open "/Applications/$APP_NAME.app" </dev/null`. Log "installed `<tag>`". Exit 0.

### §2.4 `cleanup` and failure after the app has quit

`cleanup` runs on every exit (status in `$?`, captured first):
- `MOUNTED=1`: `hdiutil detach "$MNT"`, retry once with `-force`. A mounted DMG never survives.
- `rm -rf "$WORK"`. `rm -rf "$STAGE"` — only the exact `mktemp` path this run created, never a
  glob.
- Non-zero status **and** `HANDED_OFF=1` (the app already quit on our word): the user has no app
  open and no dialog. So: if `/Applications/$APP_NAME.app` exists (the old version — the swap
  either never started or rolled back), `open` it; then show a blocking alert via `osascript` with
  argv-passed strings (never interpolated into AppleScript source):
  title "`$APP_NAME` couldn't update", message = the failure line plus "Details:
  ~/Library/Logs/`$APP_NAME`/install.log". If no bundle is left at all, the message also carries
  the curl command to reinstall.
- Non-zero status before hand-off: no alert. The app is still running and shows the error itself
  (§5).

### §2.5 Relaunch decision

Both modes end by opening the app. Self-update: required — the user just quit their app on our
word; nothing else reopens it. Interactive first install: opening it right away is the proof the
install worked with no Gatekeeper prompt, and it is what a user who just asked to install wants.
No `--no-launch` flag: no current caller needs one, and scope left out stays out.

### §2.6 Known macOS risk (verify on a Mac, §11.3)

macOS 13+ "App Management" privacy control may require consent before one process replaces
another app's bundle. Self-update: the responsible process is the app itself, replacing its own
bundle — expected allowed, but ad-hoc signing (no Team ID) makes this unconfirmed. Interactive:
Terminal may prompt once. Either way, the `mv` in step 11 fails loudly with `Operation not
permitted`; `die` must name System Settings › Privacy & Security › App Management in that case
(match on the `mv` stderr). §11.3 records the real behavior.

## §3 `internal/appupdate` at repo root

### §3.1 Hoist

`git mv ST/internal/appupdate AU` (4 files). Then:
- `NewChecker(appName, runningVersion string) *Checker`. New field `userAgent: appName + "/" +
  runningVersion`. `httpFetch` becomes a method or takes the UA; drop the `buildinfo` import.
  `checker.go:1-10` package doc: say it is shared by both apps.
- Strip §1's dead weight (in commit 8, not commit 1 — `OpenReleasePage` still calls it until
  then).
- `version.go`, `version_test.go` (minus `TestSafeReleaseURL`), `checker_test.go` (minus
  `testRelease`'s `HTMLURL` line) move unchanged. No new tests there.

### §3.2 App table

```go
// App names one of the two installable apps — the same two rows scripts/install.sh's own table
// holds (§2.1); ScriptArg is its --app= value.
type App struct{ Name, ScriptArg string }

var (
	Studio = App{Name: "Kira Studio", ScriptArg: "studio"}
	Space  = App{Name: "Kira Space", ScriptArg: "space"}
)
```

The checker takes `App.Name` only (SPEC: display name + version). The installer takes the `App`.

### §3.3 `Installer` (`AU/install.go`, new)

```go
const (
	InstallScriptURL = "https://raw.githubusercontent.com/vlad-cirstean/kira-studio/main/scripts/install.sh"
	installContract  = "# kira-install-contract: 1"
	maxScriptBytes   = 256 << 10
	scriptTimeout    = 30 * time.Second
	stageTimeout     = 15 * time.Minute // backstop; the script's own curl --speed-limit aborts stalls first
)

type Installer struct {
	app     App
	running string
	// seams, real values set by NewInstaller; tests replace them
	fetch   func(ctx context.Context) ([]byte, error)
	logPath string
	shell   string // "/bin/sh"

	mu     sync.Mutex
	state  installState // idle | staging | handedOff
	cancel context.CancelFunc
}

func NewInstaller(app App, runningVersion string) *Installer
func (i *Installer) DisplayLogPath() string // "~/Library/Logs/<Name>/install.log"
func (i *Installer) Stage(ctx context.Context) error
func (i *Installer) Cancel()
```

`Stage`, in order (split into helpers to stay under `gocognit`/`gocyclo` 30):
1. Lock. `!isReleaseBuild(running)`: `ipcerr.BadRequest("update: not a release build")`. `state !=
   idle`: `ipcerr.New("E_INVALID", "an update is already in progress")`. Set `staging`, derive
   `sctx, cancel` from `ctx` with `stageTimeout`; store `cancel`. Unlock. A deferred block resets
   `state` to `idle` unless hand-off succeeded.
2. **Fetch** `InstallScriptURL` with the package's existing proxy-aware `httpClient`,
   `scriptTimeout`, `User-Agent` = the checker's. 200 only. Body ≤ `maxScriptBytes`
   (`io.LimitReader` + length check). `validateScript`: line 1 exactly `#!/bin/sh`, line 2 exactly
   `installContract`. Failure: `ipcerr.Internal("couldn't download the installer: <err>")`. The
   validation also stops a captive-portal HTML page from ever reaching `sh`.
3. **Write** via `os.CreateTemp("", "kira-install-*.sh")`, `Chmod(0o700)`, close.
4. **Log.** `MkdirAll(dir, 0o700)`. Truncate if over 1 MiB, else `O_APPEND|O_CREATE|O_WRONLY`,
   0600. Write one header line: UTC time, app name, running version, own pid.
5. **Spawn.** `r, w := os.Pipe()`. `exec.Command(shell, scriptPath, "--app="+ScriptArg,
   "--wait-pid="+strconv.Itoa(os.Getpid()), "--notify-fd=3")`; `Stdin` nil (`/dev/null`),
   `Stdout`/`Stderr` = log file, `ExtraFiles = []*os.File{w}` (child fd 3), `Dir = "/"`,
   `Env = os.Environ()` (keeps proxy vars; the script fixes `PATH` itself), `SysProcAttr =
   &syscall.SysProcAttr{Setsid: true}` — its own session and process group, no controlling
   terminal, so the app's exit neither signals nor reaps it. `Start()`; then close `w` and the log
   file in the parent (the child holds its own copies; Go's `CLOEXEC` default keeps every other app
   fd — the DB, sockets — out of the child). `go cmd.Wait()` into an `exited` channel, so an early
   exit is reaped and observed.
6. **Await hand-off.** A goroutine reads one line from `r`. `select`:
   - line `staged <tag>` → set `handedOff`, `os.Remove(scriptPath)` (`sh` holds its own open fd;
     unlinking is safe), return `nil`.
   - EOF/other line → wait for `exited` (≤ 5 s), `os.Remove(scriptPath)`, return
     `ipcerr.Internal("the installer stopped before changing anything: <tail>")`, where `<tail>` is
     the last `ERROR:` line (else last non-empty line) of the log's final 4 KiB.
   - `sctx.Done()` → `procgroup.Kill(pid, SIGTERM)` (the script's trap detaches the DMG and removes
     `$STAGE`); wait `exited` ≤ 10 s, then `SIGKILL` the group. `Cancel()` → `"E_CANCELLED"`;
     deadline → `"E_TIMEOUT"` ("the update took too long and was stopped").
7. `Cancel()`: acts only in `staging` (calls stored `cancel`). `idle`/`handedOff`: no-op — after
   hand-off the quit is the point and nothing must stop the swap.

`DisplayLogPath` is what the dialog shows; `logPath` is its absolute form under
`os.UserHomeDir()`. Same path the script computes (§2.1) — the two spellings are a contract; a
comment on each side names the other.

**Fresh-fetch, not bundled — decision.** The app fetches the script from `main` each time, the same
bytes the documented curl command runs.
- For: one code path for first install and update. An installer bugfix reaches every installed
  version at once. A bundled script with a bug is unfixable in place: the broken installer is the
  thing that would install the fix, so those users could only recover by hand.
- Against, and the answer: an old app runs installer logic it never shipped with. The app's side of
  the contract is tiny (argv, fd 3, the `staged` line, the log path); the contract marker makes any
  incompatible change fail closed with a clear error instead of misbehaving.
- Pinning to the release tag's copy (`.../<tag>/scripts/install.sh`) was considered and rejected:
  it makes a fix to an installer bug in the current latest release wait for a new tag, and it
  splits the one command users run from the one the app runs.

**Security note — normal prose on purpose.** Self-update executes a shell script downloaded at
click time, with the user's own privileges, from the `main` branch of a public repository. The
trust is exactly that of the documented `curl | sh` install and of the DMGs themselves, which are
built from the same repository: anyone who can push to `main` can change what every user's
**Update** click runs. That makes branch protection on `main` a real security boundary for this
feature. TLS to `raw.githubusercontent.com` and the contract-marker check guard transport and
compatibility, not authorship. The implementer records this in `docs/ARCHITECTURE.md` (commit 11).

## §4 `UpdateService` and the dialog, both apps

### §4.1 Go bridge (one thin file per app — Go `internal/` rule, P116's per-app-bridge shape)

`ST/internal/bridge/update.go` (rewritten) and `KS/internal/bridge/update.go` (new), identical
bodies:

```go
type UpdateStatus struct {
	UpdateAvailable bool   `json:"updateAvailable"`
	CurrentVersion  string `json:"currentVersion"`
	LatestVersion   string `json:"latestVersion"`
	InstallLogPath  string `json:"installLogPath"` // display path, never a URL
}

type UpdateService struct {
	Checker   *appupdate.Checker
	Installer *appupdate.Installer
	Quit      func() // shell.Quitter.RequestQuit
}

func (s *UpdateService) Status(ctx context.Context) (UpdateStatus, error)
// InstallUpdate re-checks availability (cached — no forced fetch), stages through the detached
// installer, then quits so the installer can swap the bundle. A dev build's Status is never
// UpdateAvailable, so a dev build can never reach Stage.
func (s *UpdateService) InstallUpdate(ctx context.Context) error {
	if !s.Checker.Status(ctx).UpdateAvailable {
		return ipcerr.BadRequest("update: no newer release available")
	}
	if err := s.Installer.Stage(ctx); err != nil {
		return err
	}
	go s.Quit() // after the bound call returns its reply, not racing it
	return nil
}
func (s *UpdateService) CancelInstall() error { s.Installer.Cancel(); return nil }
```

- Studio: `Browser` interface moves from `update.go:10-14` to new `ST/internal/bridge/browser.go`
  (Space's own file shape). `UpdateService` loses `Browser`.
- `KS/internal/bridge/browser.go:3-5` comment: drop "no equivalent of yet"; say each app declares
  its own `Browser` where consumed. `KS/internal/bridge/github.go:19,43`: restate the rationale in
  place (BrowserManager validates nothing; macOS `open` acts on any scheme) instead of citing the
  deleted `safeReleaseURL`.
- Quit on the renderer's cue is safe: `RequestQuit` → `app.Quit()` → `ShouldQuit` never blocks and
  runs the normal flush handshake, so tabs/layout still save.

### §4.2 `main.go` wiring

- Studio `ST/main.go:127-130`: `updateChecker := appupdate.NewChecker(appupdate.Studio.Name,
  buildinfo.Version)`; `updateInstaller := appupdate.NewInstaller(appupdate.Studio,
  buildinfo.Version)`. Refresh the P66 comment: the installer owns a child process only while
  staging. Pass `updateInstaller` into `wireLifecycle` (`:425`); its `teardown` calls
  `updateInstaller.Cancel()` first — a Cmd+Q mid-download aborts the install rather than leaving an
  orphan that later swaps a bundle the user quit away from. After hand-off `Cancel` is a no-op, so
  the normal update path is unaffected.
- `:176`: `&bridge.UpdateService{Checker: updateChecker, Installer: updateInstaller, Quit:
  quitter.RequestQuit}`. `quitter` exists by then (`:140`); `RequestQuit` reads `q.app` only when
  called, after `quitter.Attach(app)` (`:195`).
- Space `KS/main.go`: same two constructors with `appupdate.Space` near `:111`;
  `updateInstaller.Cancel()` first in `teardown` (`:160`); `application.NewService(updateSvc)` in
  the Services list; `updateSvc.Quit = quitter.RequestQuit` (or build the struct after `:192`).
  Refresh `KS/main.go:43-52`'s "no update checker" sentence.

### §4.3 Shared control seam (`WB/bridge/createCoreControl.ts`)

- `CoreBindings.update: { Status(): Promise<unknown>; InstallUpdate(): Promise<void>;
  CancelInstall(): Promise<void> }`.
- `export interface AppUpdateStatus { updateAvailable: boolean; currentVersion: string;
  latestVersion: string; installLogPath: string }` (restated, `KeepAwakeStatus`'s reasoning).
- Methods `updateStatus`, `updateInstall`, `updateCancelInstall`. Header comment: P119 adds three.
- `SF/bridge/index.ts`: drop `:70-71`; pass `update: UpdateService`. `KF/bridge/index.ts`: import
  `@bindings/updateservice.js`, pass `update: UpdateService`; refresh its service-count comment.

### §4.4 Shared store (`WB/state/createAppUpdateStore.ts`, new)

`createAppUpdateStore(control: AppUpdateControl, appName: string)` returns `defineStore('appUpdate',
...)`. Inside:
- **Status: TanStack `useQuery(..., queryClient)`** (`variables.ts:65` precedent), key
  `['appUpdate']`, `queryFn: control.updateStatus`, `refetchInterval: POLL_MS` (hourly, unchanged),
  `refetchIntervalInBackground: true` (today's `setInterval` polls regardless of focus),
  `enabled` = a ref `initAppUpdate()` flips. Replaces the hand-rolled poll. A failed poll keeps the
  previous data and renders nothing — P66's "failure is silence" holds.
- **Install: `useMutation`** over `control.updateInstall`. `installing` = `isPending`. Error →
  `installError` string, except code `E_CANCELLED` → cleared, back to idle.
- **Dismissal: VueUse `useLocalStorage('kira.appUpdate.dismissedVersion', '')`.** Shared by every
  window of the app (same origin), and VueUse syncs it across windows via the `storage` event.
- `dialogOpen` ref. `watch([available, latestVersion, dismissedVersion])`: available and
  `latestVersion !== dismissedVersion` → open; `dismissedVersion === latestVersion` and not
  `installing` → close (another window pressed **Later**). Net: the dialog auto-opens once per new
  version, across all windows; **Later** silences that version until a newer one appears.
- Actions: `initAppUpdate()`, `openUpdateDialog()` (status-bar click — ignores dismissal),
  `later()` (sets `dismissedVersion`, closes; no-op while installing), `install()`, `cancelInstall()`.
- Exposes `appName`, `available`, `currentVersion`, `latestVersion`, `installLogPath`,
  `dialogOpen`, `installing`, `installError`. Exports `type AppUpdateStore`.

Per app: `SF/state/appUpdate.ts` becomes `export const useAppUpdateStore =
createAppUpdateStore(control, 'Kira Studio')` (P116 comment style). `KF/state/appUpdate.ts` (new),
same with `'Kira Space'`. `KF/main.ts`: `useAppUpdateStore(pinia).initAppUpdate()` after
`app.mount`, mirroring `SF/main.ts:369-372`.

### §4.5 Shared components

**`WB/components/UpdateAvailableItem.vue`** — `AppMetricsItem.vue`'s plain-props shape. Props
`latestVersion`, `currentVersion`; emits `open`. Markup lifted from `SF/workbench/StatusBar.vue:
85-98`, `data-testid="update-available"`, text `Update {latest}`, tooltip "Version X is
available. You have Y." Both `StatusBar.vue` render it first in `#right`, `v-if` on `available`,
`@open="store.openUpdateDialog()"`. Studio's `updateTooltip`/`onOpenReleasePage` and the `control`
import (if then unused) go.

**`WB/components/UpdateDialog.vue`** — shadcn-vue `Dialog` (`ConfirmDialog.vue`/
`GitCredentialDialog.vue` structure and classes). Prop `store: AppUpdateStore` (git-ui dialogs'
store-as-prop precedent, e.g. `StackDialog.vue`'s `ops`). Mounted in both `App.vue` beside
`<ConfirmDialog />`, `v-if="store.dialogOpen"` (`ConfirmDialog.vue:26-32`'s stacking reason).

| State | Body | Buttons |
| --- | --- | --- |
| idle | "`<app> <latest>` is available. You have `<current>`." / "Updating quits `<app>`, installs the new version into /Applications, then reopens it. If it doesn't reopen within a few minutes, see `<installLogPath>`." | **Later** (`dialog`), **Update** (`dialog-primary`) |
| installing | "Downloading and verifying `<app> <latest>`… `<app>` quits once the new version is ready." | **Cancel** only; Esc and overlay click ignored |
| error | idle body plus `installError` in `text-danger`, plus "Details: `<installLogPath>`" | **Later**, **Try again** |

Esc/close while idle or error = **Later**. `data-testid`s: `update-dialog`, `update-dialog-versions`,
`update-dialog-install`, `update-dialog-later`, `update-dialog-cancel`, `update-dialog-error`.
Tailwind utilities only, no `<style>` block.

### §4.6 Deliberate behavior change to existing Studio code

Today a Studio user clicks **Update X** in the status bar and GitHub's release page opens in the
browser (`OpenReleasePage`). After P119 the same click opens the in-app dialog, and the release
page is never opened. Studio also newly auto-opens that dialog once per new version. Removed:
`UpdateService.OpenReleasePage`, `UpdateService.Browser`, `appupdate.Checker.ReleaseURL`,
`safeReleaseURL`, `releasesPageURL`, `Result.releaseURL`, `release.HTMLURL`, `TestSafeReleaseURL`,
`control.updateOpenReleasePage`, `IPC.updateOpenReleasePage`. Same `data-testid="update-available"`
anchor, so no unrelated spec/snapshot moves.

## §5 Failure handling, end to end

| When | What the user sees | Where the detail lives |
| --- | --- | --- |
| Status poll fails | Nothing (P66 unchanged) | debug log |
| Script fetch/validation fails | Dialog error state, app still running, **Try again** | message in dialog; `slog.Warn` in app log |
| Script fails before `staged` (no release, 404 asset, bad digest, codesign/ID/version mismatch, `/Applications` not writable, arch/OS) | Dialog error state with the script's own `ERROR:` line | `install.log` |
| User presses **Cancel** during staging | Dialog back to idle | `install.log` ("interrupted") |
| Stage exceeds 15 min | Dialog error "took too long" | `install.log` |
| User quits (Cmd+Q) during staging | App quits; install aborted, nothing changed | `install.log` |
| Old app doesn't exit within 60 s after hand-off | Old app still running; alert names the log | `install.log` |
| User reopens the app before the swap | Update skipped; alert | `install.log` |
| Swap fails (TCC, disk) | Rolled back; old version relaunched; alert names the log | `install.log` |
| Nothing left in `/Applications` (rollback also failed) | Alert with the curl reinstall command | `install.log` |
| `open` of the new version fails | New version installed; alert names the log | `install.log` |

Everything before hand-off surfaces in the still-open dialog — that is why the app quits on
`staged`, not on spawn (the SPEC row's "spawns ... then the app quits" order is kept; the quit
waits for proof the new bundle is ready). Only the swap and relaunch happen with no app open, and
§2.4 covers both with relaunch-old-plus-alert.

## §6 Release workflow — rewrite the pending patch in place

Keep `test-matrix` and `db-compat` unchanged. The target `release` job (replaces live
`release.yml:52-187`). Write it to a scratch copy, never to `.github/workflows/`.

```yaml
  release:
    needs: [test-matrix, db-compat]
    runs-on: macos-15
    # P119: packages both apps serially in one job (was 40 for Studio alone).
    timeout-minutes: 60
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    steps:
      - uses: actions/checkout@v7
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - uses: actions/setup-go@v7
        with:
          go-version-file: go.mod
      - name: Cache bun install (keyed on the lockfile, so an unchanged dependency set skips re-download)
        uses: actions/cache@v4
        with:
          path: ~/.bun/install/cache
          key: bun-${{ runner.os }}-${{ hashFiles('bun.lock') }}
      - run: bun install --frozen-lockfile
      - name: Cache wails3 CLI (v1.4 P1 — go.mod-keyed, OS-specific binary; same key as pr.yml's checks job, so a release right after a merge to main usually finds it already warm)
        uses: actions/cache@v4
        with:
          path: ~/go/bin/wails3
          key: wails3-${{ runner.os }}-${{ hashFiles('go.mod') }}
      - name: Cache generated Wails bindings, both apps (Wails generates bindings per app)
        uses: actions/cache@v4
        with:
          path: |
            apps/kira-studio/frontend/bindings
            apps/kira-studio/.task
            apps/kira-space/frontend/bindings
            apps/kira-space/.task
          key: wails-bindings-${{ hashFiles('go.mod') }}

      # P119: one tag versions both apps. Each app's build/config.yml info.version is the one place
      # its build reads a version; from there it is linked into the binary and stamped into
      # Info.plist, and verify:packaging's A5 asserts both bundles carry it.
      - name: Set both apps' version from the release tag
        run: |
          set -eu
          TAG="${GITHUB_REF_NAME#v}"
          for CONFIG in apps/kira-studio/build/config.yml apps/kira-space/build/config.yml; do
            perl -i -pe 's/^(  version: )"[^"]*"/$1"'"$TAG"'"/' "$CONFIG"
            test "$(sed -n 's/^  version: *"\([^"]*\)".*/\1/p' "$CONFIG" | head -1)" = "$TAG"
            echo "$CONFIG version set to $TAG (from tag $GITHUB_REF_NAME)"
          done

          # G10 D21: the extension ships inside Kira Space's bundle (P100 Part 3), so its manifest
          # version tracks Kira Space's config.yml — S9 asserts the two agree.
          VSCODE_PKG=apps/kira-space-vscode/package.json
          perl -i -pe 's/^(  "version": )"[^"]*"/$1"'"$TAG"'"/' "$VSCODE_PKG"
          test "$(sed -n 's/^  "version": *"\([^"]*\)".*/\1/p' "$VSCODE_PKG" | head -1)" = "$TAG"
          echo "extension version set to $TAG (from tag $GITHUB_REF_NAME)"

      - name: Generate Wails bindings (P20 D7 — routed through scripts/setup.sh)
        run: sh scripts/setup.sh

      - run: bun run lint
      - run: bun run typecheck

      - run: bun run package:studio
      - run: bun run package:space

      # P10: each package:* script already produced and signed its .dmg — this only gives each the
      # platform-qualified name its release asset carries. scripts/install.sh downloads these exact
      # names (its own --app table), so renaming one breaks that app's install and update.
      - name: Name the signed disk images for distribution
        run: |
          cp "apps/kira-studio/bin/Kira Studio.dmg" "kira-studio-macos-arm64.dmg"
          cp "apps/kira-space/bin/Kira Space.dmg" "kira-space-macos-arm64.dmg"

      # Both bundles exist now, so every Studio and Space artifact check runs instead of skipping.
      - name: Verify packaging
        run: bun run verify:packaging

      - name: Assert packaged bundles and disk images (docs/PACKAGING.md §4 — checks the actual tagged release build of each app)
        run: |
          set -eu
          assert_app() {
            APP="$1/bin/$2.app"
            DMG="$1/bin/$2.dmg"
            MNT="$4"
            test -d "$APP"
            test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")" = "$3"
            codesign -dv --verbose=2 "$APP" 2>&1 | grep -q 'Signature=adhoc'
            # The installer mounts this image and copies the app out of it, so this opens the real
            # thing: the image mounts and the app is inside it.
            test -f "$DMG"
            codesign -dv --verbose=2 "$DMG" 2>&1 | grep -q 'Signature=adhoc'
            hdiutil attach -nobrowse -readonly -mountpoint "$MNT" "$DMG"
            test -d "$MNT/$2.app"
            test -L "$MNT/Applications"
            hdiutil detach "$MNT"
            du -sh "$APP" "$DMG"
          }
          assert_app apps/kira-studio "Kira Studio" com.kirathecat.kira-studio /tmp/kira-studio-dmg
          assert_app apps/kira-space "Kira Space" com.kirathecat.kira-space /tmp/kira-space-dmg

      - name: Compose release notes
        run: |
          cat > release-notes.md <<'EOF'
          Requires macOS 14 or later on Apple Silicon (arm64). Background: docs/PACKAGING.md and
          README.md.

          This release carries two apps, versioned together: **Kira Studio** (database and API
          client) and **Kira Space** (git client).

          ## Install or update

          Run in Terminal — the same command installs a fresh copy or replaces an older one, then
          opens the app:

          ```
          curl -fsSL https://raw.githubusercontent.com/vlad-cirstean/kira-studio/main/scripts/install.sh | sh -s -- --app=studio
          curl -fsSL https://raw.githubusercontent.com/vlad-cirstean/kira-studio/main/scripts/install.sh | sh -s -- --app=space
          ```

          This is the only supported install method. These builds aren't signed by Apple; a disk
          image downloaded through a browser is blocked by Gatekeeper, while the installer's own
          download is not. The disk images attached below are what the installer downloads.

          ## Updating from inside the app

          Each app checks for a newer release and offers an update. Clicking **Update** runs the
          same installer, quits the app, and reopens the new version. Nothing installs without
          that click. Installer log: `~/Library/Logs/<app name>/install.log`.
          EOF

      - name: Create draft release
        run: |
          gh release create "$GITHUB_REF_NAME" \
            --draft \
            --title "Kira Studio and Kira Space $GITHUB_REF_NAME" \
            --notes-file release-notes.md \
            kira-studio-macos-arm64.dmg \
            kira-space-macos-arm64.dmg

      - uses: actions/upload-artifact@v7
        with:
          name: kira-studio-macos-arm64
          path: kira-studio-macos-arm64.dmg
          retention-days: 14
      - uses: actions/upload-artifact@v7
        with:
          name: kira-space-macos-arm64
          path: kira-space-macos-arm64.dmg
          retention-days: 14
```

Notes:
- **Manual DMG path dropped entirely, not kept as a fallback.** The drag-to-Applications and
  `xattr -dr com.apple.quarantine` instructions exist only to undo a quarantine the curl path never
  adds. Keeping them documents a second, worse path that teaches users to strip Gatekeeper's flag,
  and doubles what support has to explain. The DMGs stay attached because the installer downloads
  them; the notes say so in one sentence.
- Bindings cache: `actions/cache` versions an entry by its path list, so this four-path entry never
  collides with `pr.yml`'s Studio-only entry under the same key.
- The draft stays a draft; a human publishes. `/releases/latest` ignores drafts, so neither the
  in-app check nor the installer sees a release until it is published.

**Regenerating the patch.** Build from the **unpatched** live file, never on top of the old patch:

```sh
S=<scratchpad>/p119-release; mkdir -p "$S"
cp .github/workflows/release.yml "$S/release.yml.orig"
cp .github/workflows/release.yml "$S/release.yml.new"
# edit $S/release.yml.new: replace lines 52-187 with the block above
{
  printf '%s\n\n' "Note: P119 — one release job builds, stamps, verifies and drafts BOTH apps under one shared tag and one release, with release notes naming scripts/install.sh's curl command as the only install method (supersedes P100 Part 3's separate release-space job); also carries P106's package -> package:studio rename and P100 Part 3's apps/kira-studio-vscode -> apps/kira-space-vscode stamp retarget. Apply with 'git apply' against .github/workflows/release.yml, then delete this file."
  diff -u --label a/.github/workflows/release.yml --label b/.github/workflows/release.yml \
    "$S/release.yml.orig" "$S/release.yml.new"
} > docs/pending-changes/.github__workflows__release.yml.patch
git apply --check docs/pending-changes/.github__workflows__release.yml.patch
cp "$S/release.yml.orig" "$S/check.yml"
patch -s "$S/check.yml" < docs/pending-changes/.github__workflows__release.yml.patch
cmp "$S/check.yml" "$S/release.yml.new"
```

`diff -u` exits 1 when files differ; run it inside the `{ }` group without `set -e`. If a YAML
parser is available (`python3 -c 'import yaml'` or `bunx js-yaml`), parse `release.yml.new` once.
`git status` must show only the `.patch` changed, never `.github/workflows/release.yml`.

## §7 `scripts/verify-packaging.sh`

- Header `:2-8` and S1/S2 comments: "no *silent* auto-update" — the apps install only on an
  explicit click, through `scripts/install.sh`.
- **S10, rescoped, not removed.** The invariant still holds for the app code: no app code downloads
  a release asset itself. Only its location list changes: `grep -rnE
  'browser_download_url|releases/download' apps/ packages/ internal/` — `internal/` added because
  `appupdate` now lives there. `scripts/` is deliberately outside the scan: `scripts/install.sh` is
  the one sanctioned downloader. Rewrite the comment and failure message to say exactly that.
- **S11, new — installer pin.** All must hold:
  1. `scripts/install.sh` exists and `sh -n scripts/install.sh` exits 0.
  2. `sed -n 2p scripts/install.sh` is exactly `# kira-install-contract: 1`, and
     `grep -c 'installContract *= *"# kira-install-contract: 1"' internal/appupdate/install.go` is 1
     — the two sides of the contract agree.
  3. `grep -rn 'raw.githubusercontent.com' apps/ packages/ internal/ --include=*.go --include=*.ts
     --include=*.vue` hits exactly one line, in `internal/appupdate/install.go`, and it is
     `InstallScriptURL`'s `.../vlad-cirstean/kira-studio/main/scripts/install.sh`.
  4. If `shellcheck` is on `PATH`, `shellcheck -s sh scripts/install.sh` is clean; otherwise
     `note` skipped (same pattern as A1's `codesign` probe).
- Update `docs/PACKAGING.md` §7's S-list to match (commit 11).

## §8 Tests

Bar: `CLAUDE.md`'s unit-test rule.
- **`version_test.go`, `checker_test.go`: unchanged** (minus `TestSafeReleaseURL` and one
  `HTMLURL` line). Dev-sentinel gating is already covered by `TestIsReleaseBuild`.
- **`AU/install_test.go`, new, 3 tests — earns its keep: process-lifecycle concurrency
  (hand-off ordering, cancellation, group kill).** Seams: `fetch` returns a fake script (with
  valid lines 1-2), `logPath` in `t.TempDir()`, `shell = "/bin/sh"`, `running = "1.0.0"`. Runs on
  Linux and macOS. `t.Cleanup` group-kills any survivor.
  1. `TestInstaller_Stage_HandsOffOnStaged`: script prints `staged v9.9.9` to fd 3, closes it,
     sleeps 30 → `Stage` returns nil within 2 s; process still alive (it outlives the handshake);
     temp script file removed.
  2. `TestInstaller_Stage_ReportsScriptFailure`: script prints `ERROR: boom` to stderr, exits 1 →
     error message contains `boom`.
  3. `TestInstaller_Cancel_KillsWholeGroup`: script starts `sleep 30 &`, writes `$!` to a file,
     `wait`s → `Cancel()` after that file appears → `Stage` returns `E_CANCELLED`; both the script
     pid and the grandchild pid are gone (`testx.WaitUntil` + `testx.ProcessAlive`).
  Not tested: `validateScript` (two line compares), the dev-build guard (one `if`), the
  already-in-progress guard (one `if`), timeout (same path as cancel).
- **No test for `UpdateService`** (three pass-throughs) or `createAppUpdateStore` (UI specs cover
  its only interesting rule).
- **The script: no unit test.** It does real network, `hdiutil`, and `/Applications` work.
  `sh -n` + optional `shellcheck` (S11) per run; the real exercise is §11.3 on a Mac.
- **UI specs.** Precedent: `ST/tests/ui/update-banner.spec.ts`. `git mv` it to
  `update-dialog.spec.ts` and rewrite; add `KS/tests/ui/update-dialog.spec.ts`.
  - Studio (4): no update → no item, no dialog; update available → dialog auto-opens with both
    versions, **Later** closes it, item stays, clicking item reopens; **Update** → control log shows
    `IPC.updateInstall`; seeded `updateInstall` error → `update-dialog-error` visible with the
    message, **Try again** enabled.
  - Space (3): the first three Studio cases (the error state is the same shared component).
  - Support files, both apps: `ipcChannels.ts` gains `updateStatus`/`updateInstall`/
    `updateCancelInstall` (Studio drops `updateOpenReleasePage`); `mockRuntime.ts` FQN table gains
    `UpdateService.Status`/`InstallUpdate`/`CancelInstall`; Space's `WILDCARD_DEFAULTS` gains a
    no-update `IPC.updateStatus` default (Studio's `:334` gains `installLogPath`), so every other
    existing Space spec keeps booting unchanged. Check whether the fixture reuses a browser
    context between tests; if so, clear `kira.appUpdate.dismissedVersion` in `beforeEach`.

## §9 Docs (commit 11)

- `docs/ARCHITECTURE.md:74-80`: "No auto-update" (twice) → no silent auto-update; user-initiated
  install via `scripts/install.sh`. `:108-116`: the renderer still sends and receives no URL;
  `InstallUpdate` is nullary. `:2341-2372`: rewrite the P66 section as "Update check and in-app
  install (P66, P119)": shared `internal/appupdate`, the dialog, the staged hand-off, the log path,
  S10/S11, §3.3's security note (normal prose). Kira Space banner (`:2397` area): one sentence —
  Space has the same update item and dialog.
- `docs/PACKAGING.md` §7: retitle "CI, releases, install and update". Steps 2-3 of "Cutting a
  release": both apps, one job, both assets. Replace "No auto-update" and the P66 paragraph with
  the curl install, the in-app flow, S10's rescope, S11. §4 human checklist: add §11.3's items.
  §8: Space's DMG ships on the same release.
- `README.md:212-240`: the curl command as the install path; keep building from source as the
  developer path. `:423-426` "Not shipped": replace the banner sentence — the app offers an update
  and installs it only on click; silent auto-update still not shipped.
- `KS/README.md:139-160`: same install change, `--app=space`.
- `docs/DEV_ENVIRONMENT.md`: no change.

## §10 Split call, commit sequence, resume rule

**Call: one sequential Sonnet implementer. No stream split.** The only candidate split is "script +
workflow patch" vs "Go + frontend". It fails CLAUDE.md's criteria: the script and `Installer` share
a live contract (argv, fd-3 `staged` line, log path, contract marker) that must change in lockstep;
S11 reads both sides; the docs describe both. That is an ordering dependency, not independence.

Commits, in order. Each lands as it completes. Regenerate bindings (`sh scripts/setup.sh`) after
every commit that changes a bound Go method, before typecheck.

1. `refactor: hoist appupdate to repo-root internal` — `git mv`; `NewChecker(appName, version)`;
   UA from args; `buildinfo` import gone; `App` table; Studio `main.go`/`bridge/update.go` imports.
   No behavior change.
2. `feat(appupdate): add detached installer with staged hand-off` — `AU/install.go`,
   `AU/install_test.go` (§3.3, §8).
3. `feat(scripts): add curl installer for both apps` — `scripts/install.sh` (§2), mode 0755.
4. `feat(kira-space): add UpdateService over shared appupdate` — `KS/internal/bridge/update.go`,
   `browser.go`/`github.go` comments, `KS/main.go` wiring.
5. `feat(kira-studio): add InstallUpdate and CancelInstall to UpdateService` — Studio Go only,
   `OpenReleasePage` kept for now so the unchanged frontend still typechecks; `wireLifecycle` gains
   the installer and its `Cancel` in teardown.
6. `feat: in-app update dialog for both apps` — `createCoreControl` update seam; `createAppUpdateStore`;
   `UpdateAvailableItem.vue`; `UpdateDialog.vue`; both apps' `bridge/index.ts`, `state/appUpdate.ts`,
   `StatusBar.vue`, `App.vue`; `KF/main.ts`. Body states §4.6's Studio behavior change.
7. `test: update dialog UI specs for both apps` — §8 specs and support files.
8. `refactor(kira-studio): drop OpenReleasePage and release-URL validation` — §4.6's removal list;
   Studio `Browser` to `bridge/browser.go`; drop `IPC.updateOpenReleasePage`.
9. `feat(packaging): rescope S10 to app code, add S11 installer pin` — §7.
10. `chore(ci): stage one release job for both apps with curl install notes` — §6 patch rewrite.
11. `docs: record curl installer and in-app update` — §9.
12. `docs(v1.9): record P119 result` — `## P119 result` at the end of `docs/v1.9/SPEC.md`: what
    landed, §11.3's outcome (or "not run: no Mac"), §2.6's TCC finding.

| Area | Files |
| --- | --- |
| Shared Go | `internal/appupdate/{checker,checker_test,version,version_test,install,install_test}.go` |
| Studio Go | `ST/main.go`, `ST/internal/bridge/{update,browser}.go`, `ST/internal/appupdate/**` (moved out) |
| Space Go | `KS/main.go`, `KS/internal/bridge/{update,browser,github}.go` |
| Script | `scripts/install.sh`, `scripts/verify-packaging.sh` |
| Shared frontend | `WB/bridge/createCoreControl.ts`, `WB/state/createAppUpdateStore.ts`, `WB/components/{UpdateAvailableItem,UpdateDialog}.vue` |
| Studio frontend | `SF/bridge/index.ts`, `SF/state/appUpdate.ts`, `SF/workbench/StatusBar.vue`, `SF/App.vue` |
| Space frontend | `KF/bridge/index.ts`, `KF/state/appUpdate.ts`, `KF/workbench/StatusBar.vue`, `KF/App.vue`, `KF/main.ts` |
| Tests | `ST/tests/ui/update-dialog.spec.ts` (moved), `KS/tests/ui/update-dialog.spec.ts`, both apps' `tests/ui/support/{ipcChannels,mockRuntime}.ts` |
| Docs/CI | `docs/pending-changes/.github__workflows__release.yml.patch`, `docs/{ARCHITECTURE,PACKAGING}.md`, `README.md`, `KS/README.md`, `docs/v1.9/SPEC.md` |

Resume rule: this doc plus the commit log is the full state. An interrupted run resumes at the
first commit above not yet in `git log`.

## §11 Verification

### §11.1 Per commit (fast)

- `go build ./...`, `bun run lint:go`, `go test ./internal/appupdate/...` (plus `./apps/kira-space/
  internal/bridge/...` / `./apps/kira-studio/internal/bridge/...` when touched).
- `bun run lint`, `bun run typecheck` (the pre-commit hook runs both).
- Commit 3 onward: `sh -n scripts/install.sh`.

### §11.2 Once, near phase end (full)

- `bun run test:go`, `bun run test:unit`, `bun run test:ui:studio`, `bun run test:ui:space`,
  `bun run verify:packaging` (Linux: artifact checks skip, S1-S11 run), `bun run lint:dead`.
- Orchestrator greps (expected result after commit 12):
  - `test -e apps/kira-studio/internal/appupdate` → false.
  - `git grep -n "apps/kira-studio/internal/appupdate\|internal/buildinfo" -- internal/appupdate` → 0.
  - `git grep -n "ReleaseURL\|safeReleaseURL\|releasesPageURL\|OpenReleasePage\|updateOpenReleasePage" -- apps internal packages` → 0.
  - `git grep -n "appupdate.NewChecker\|appupdate.NewInstaller" -- apps/kira-studio/main.go apps/kira-space/main.go` → 4 (2 per app).
  - `git grep -n "updateInstaller.Cancel()" -- apps/kira-studio/main.go apps/kira-space/main.go` → 2.
  - `git grep -n "Setsid: true" -- internal/appupdate/install.go` → 1.
  - `git grep -n "func (s \*UpdateService) \(Status\|InstallUpdate\|CancelInstall\)" -- apps/*/internal/bridge/update.go` → 6.
  - `git grep -n "Browser" -- apps/kira-studio/internal/bridge/update.go` → 0.
  - `git grep -n "createAppUpdateStore" -- apps/kira-studio/frontend/src/state apps/kira-space/frontend/src/state` → 4 (import + call, per app).
  - `git grep -n "useQuery\|useMutation\|useLocalStorage" -- packages/workbench/src/state/createAppUpdateStore.ts` → ≥ 3; `git grep -n "setInterval" -- packages/workbench/src/state/createAppUpdateStore.ts apps/kira-studio/frontend/src/state/appUpdate.ts` → 0.
  - `git grep -n "UpdateDialog" -- apps/kira-studio/frontend/src/App.vue apps/kira-space/frontend/src/App.vue` → 4; `git grep -n "UpdateAvailableItem" -- apps/*/frontend/src/workbench/StatusBar.vue` → 4.
  - `git grep -n "<style" -- packages/workbench/src/components/UpdateDialog.vue packages/workbench/src/components/UpdateAvailableItem.vue` → 0.
  - `go test ./internal/appupdate/ -run TestInstaller -v | grep -c '^--- PASS'` → 3.
  - `sed -n 2p scripts/install.sh` → `# kira-install-contract: 1`; `sh -n scripts/install.sh` → exit 0.
  - `grep -n 'curl .*|' scripts/install.sh` → 0 (no pipeline from curl); `grep -c '^main "\$@"$' scripts/install.sh` → 1; `grep -c 'Setsid\|pipefail' scripts/install.sh` → 0.
  - `grep -ci 'brew\|cask' scripts/install.sh docs/pending-changes/.github__workflows__release.yml.patch` → 0 each.
  - `git apply --check docs/pending-changes/.github__workflows__release.yml.patch` → exit 0.
  - In the patch: `grep -c 'release-space' ` → 0; `grep -c 'xattr' ` → 0; `grep -c 'kira-space-macos-arm64.dmg' ` → ≥ 4; `grep -c 'install.sh | sh -s -- --app=studio\|install.sh | sh -s -- --app=space' ` → 2; `grep -c 'bun run package:space' ` → 1.
  - `git diff --stat 7cc1c16a -- .github/workflows` → empty.
  - `bash -c 'grep -n "internal/" scripts/verify-packaging.sh | grep -c "browser_download_url"'` → 1 (S10 scans `internal/`); `grep -c 'S11' scripts/verify-packaging.sh` → ≥ 1.

### §11.3 Manual, on a Mac (not runnable in this Linux sandbox)

Needs a published shared release with both DMGs, which only the first real run of the patched
`release.yml` produces (a human applies the patch, pushes a tag, publishes the draft). Until then,
this section is open and the result says so. Record each outcome in `## P119 result`.

1. Fresh machine state (no app in `/Applications`): run the Studio curl command in Terminal. App
   installs, opens with **no** Gatekeeper prompt. `xattr -p com.apple.quarantine "/Applications/
   Kira Studio.app"` reports no such attribute. Repeat for Space.
2. Run the same command again with the app open: fails with "Quit Kira Studio first", nothing
   changed, no mount left (`hdiutil info`), no `/Applications/.studio-install.*` left.
3. Build and install an older stamped Studio locally (edit `ST/build/config.yml` to `0.0.1`,
   `bun run package:studio`, copy to `/Applications`). Launch: dialog auto-opens naming both
   versions. **Later**: closes, status item stays; relaunch app: no auto-open for that version;
   click item: opens.
4. **Update**: installing state shows; app quits after staging; new version opens within ~1 min;
   About shows the new version; `install.log` shows every step. Repeat 3-4 for Space.
5. During installing, **Cancel**: dialog returns to idle; no `kira-install` process
   (`pgrep -fl kira-install`), no mount, no staging dir.
6. Failure after hand-off: `chmod` a copy scenario or `sudo chflags uchg "/Applications/Kira
   Studio.app"` before clicking **Update**. Expect: old version relaunched, alert naming the log.
   Undo the flag.
7. Record §2.6: whether any App Management prompt appeared, in which mode, and what the user had
   to grant.
8. Dev build (`bun run dev:studio`): no network request to `api.github.com` (Little Snitch or
   `nettop`), no item, no dialog.

## §12 Open risks

- §2.6 TCC "App Management" behavior for ad-hoc-signed self-replacement: unknown until §11.3.
- `osascript` JXA JSON parsing and `-l JavaScript -` stdin form: standard since 10.10; confirm on
  macOS 14 in §11.3 step 1.
- GitHub's per-asset `digest` field: used when present, not required (§2.3 step 6).
- Unauthenticated GitHub API limit (60/h per IP) applies to both the in-app check (6 h cache) and
  the installer (one call per run). Not a real constraint for this usage.
