# P66 — Update-availability banner

> **What this phase is.** `docs/v1.6/SPEC.md`'s P66 row, turned into concrete steps from direct
> reads of the real tree — every file, line number, constant and API below was opened and checked,
> never recalled. The three GitHub endpoints in §1.6 were probed live from this container, not
> assumed.

## 0. What SPEC left open, and how each is resolved

SPEC's P66 row names three questions for this plan.

**1. "Does `internal/ghclient` already expose, or can it be extended with, an anonymous list-releases
call?"** **No, and it must not be extended with one.** `ghclient` is a wrapper around the user's own
`gh` CLI, not an HTTP client — §2 states the evidence and the decision. A new package,
`internal/appupdate`, makes one plain `net/http` GET instead.

**2. "Cadence: on launch, periodically, both?"** **Both**, with the cadence owned by Go, not by the
renderer. One check shortly after the first window mounts, then a 6-hour floor between real network
calls per app process (30 minutes after a failed one). §3.3.

**3. "This app's existing mechanism for opening a URL in the OS browser."** **None exists** — grepped
directly, zero hits for `BrowserOpenURL`, `openExternal`, `OpenURL`, `xdg-open`, `window.open`,
`target="_blank"` or `<a href>` anywhere in `apps/`/`packages/` source. Wails v3.0.0-beta.21 does
carry one (`application.App.Browser.OpenURL`), reached through a new deferred seam in
`internal/shell`, exactly as `Dialogs` already is. §4.2.

---

## 1. Confirmed current state

### 1.1 Where the running version comes from

| File | What is there |
| --- | --- |
| `apps/kira-studio/internal/buildinfo/buildinfo.go:17` | `var Version = "0.0.0-dev"` — the dev literal, overwritten at link time |
| `apps/kira-studio/Taskfile.yml:18-22` | `APP_VERSION` reads `build/config.yml`'s `info.version`; falls back to `0.0.0-unknown` |
| `apps/kira-studio/Taskfile.yml:23` | `VERSION_VAR` = `…/internal/buildinfo.Version` |
| `apps/kira-studio/build/darwin/Taskfile.yml:52` | `-ldflags "-X {{.VERSION_VAR}}={{.APP_VERSION}}"`, both dev and production arms |
| `apps/kira-studio/build/config.yml:17` | `version: "0.0.0"` in the tree today |
| `.github/workflows/release.yml:55-60` | writes `${GITHUB_REF_NAME#v}` into that key, then asserts the write landed |

So a tagged build reports the tag minus its `v` (`v1.3.0` → `1.3.0`), and every other build reports
one of exactly three sentinels: `0.0.0-dev` (`go run`/`go test`, no `-X`), `0.0.0-unknown` (the
Taskfile's own fallback), `0.0.0` (a local `wails3 task` build off the untouched `config.yml`).
§3.2 turns that into the guard.

`buildinfo.Version` already reaches the renderer through `AppService.Info()`
(`internal/bridge/app.go:51`), which has zero renderer callers today. This phase does not change
that: it adds its own service rather than growing `AppInfo`.

### 1.2 `internal/ghclient` is a `gh` CLI wrapper, not an HTTP client

`doc.go:1-5`: *"a Go wrapper around the user's own `gh` CLI, spawned exactly like internal/gitclient
spawns `git` — argv only, no shell, ever."* `api.go:52`'s `get` gates **every** call on
`c.discovery.Status(ctx, repo.Host).OK()`, and `discovery.go:166`'s `probe` requires, in order:

1. `gh` found on PATH or at `/opt/homebrew/bin/gh` or `/usr/local/bin/gh` (`:167`),
2. `gh --version` exiting 0 (`:176`),
3. `gh auth status --hostname <host>` exiting 0 (`:200`).

A user with no `gh`, or with `gh` installed but not logged in, gets `KindNotFound`/
`KindUnauthenticated` and no spawn at all. §2 is the decision that follows.

### 1.3 Opening a URL — what Wails beta.21 actually has

Read under `$(go env GOPATH)/pkg/mod/github.com/wailsapp/wails/v3@v3.0.0-beta.21/`, per
`docs/DEV_ENVIRONMENT.md`'s own instruction to read the pinned module rather than the docs site:

| Need | API | File |
| --- | --- | --- |
| Open in the OS browser | `(*BrowserManager).OpenURL(url string) error` | `pkg/application/browser_manager.go:20` |
| How it is reached | `App.Browser *BrowserManager`, set in `New` | `pkg/application/application.go:428`, `:592` |
| What it does on darwin | `exec.Command("open", target)`, `Start()` then `go Wait()` | `internal/browser/browser_darwin.go` |

Two properties that shape §3.5:

1. **`BrowserManager.OpenURL` does no validation at all.** `ValidateAndSanitizeURL`
   (`pkg/application/urlvalidator.go:11` — scheme denylist, control characters, shell
   metacharacters) is called only on the *JavaScript runtime* path
   (`messageprocessor_browser.go:26`), never from `BrowserManager`. A Go caller gets the raw string
   handed to `open`.
2. `exec.Command` is argv, so there is no shell-injection surface — but macOS `open` will happily
   act on `file://` or any registered scheme. So this app validates the URL itself (§3.5).

### 1.4 The status bar

`workbench/WorkbenchShell.vue:78-79` mounts `StatusBar.vue` in `grid-area: status`, under
`data-testid="status-bar"`. `TitleBar.vue` only *mentions* the status bar in a CSS comment
(`:270`) — it hosts nothing. `SettingsDialog.vue`'s only mention is an unrelated lifecycle comment
(`:40`).

`StatusBar.vue` has two `.side` groups (`primitives.css:981-993`, `justify-content: space-between`):

- **left** — one item, `data-testid="caret-status"`, governed by **LAW 14** (`:60-62`): *"the left
  readout answers 'where is the caret' and nothing else."*
- **right** — three app-wide readouts, each a `<span class="p-status">`: `app-metrics`,
  `cache-size`, `engine-status`.

An update readout is an app-wide fact, not a caret fact, so it belongs in the **right** group and
LAW 14 is untouched. §5.2.

### 1.5 The packaging guards this phase must not trip

`scripts/verify-packaging.sh` (run by `bun run verify:packaging`, by `ci.yml`'s `checks` job and
twice by `release.yml`):

- **S1** (`:36`) — `package.json` references no `electron-updater`/`update-electron-app`.
- **S2** (`:41`) — `grep -rnE "autoUpdater|electron-updater" apps/ packages/` finds nothing.
- **S5** (`:122`) — the `package` script still runs `wails3 task darwin:package:dmg`.

**Naming constraint, load-bearing:** the identifier `autoUpdater` must appear nowhere under `apps/`
or `packages/`, in any language, including a Vue component filename or a comment. `appupdate`,
`UpdateService`, `updateStatus`, `appUpdateState` are all clear of S2's pattern. §7 adds a fourth
check rather than weakening these three.

### 1.6 The GitHub side, probed live from this container

| Request | Answer |
| --- | --- |
| `GET https://api.github.com/rate_limit` | `200` — the API is reachable from here |
| `GET https://api.github.com/repos/vlad-cirstean/kira-studio` | `200` — the repository is public |
| `GET https://api.github.com/repos/vlad-cirstean/kira-studio/releases/latest` | **`404`**, with GitHub's own `{"message":"Not Found","documentation_url":"…/releases#get-the-latest-release"}` body |

The 404 is the real, current answer and it is expected: `/releases/latest` excludes drafts and
prereleases, and `release.yml:125-131` creates every release as a **draft** that a human publishes
by hand (`docs/PACKAGING.md` §7 step 4). `docs/PACKAGING.md` §7 also records that *no tag has ever
been pushed*. So **today, and until someone publishes a release, this feature's only correct
behaviour is silence** — which is exactly what §3.4 makes the 404 mean.

**Repository coordinates.** The Go module path is `github.com/kirathecat/kira-studio`, which is
*not* the GitHub location. `git remote -v` and `README.md:3`'s CI badge both say
`vlad-cirstean/kira-studio`, and that is where `release.yml` runs and where a release lands. The
constants in §3.1 use that pair. OQ-1.

---

## 2. D1 — a new package, not an extended `ghclient`

**Decision: `internal/appupdate`, one `net/http` GET. `ghclient` is not touched.**

Extending `ghclient` was considered and is declined for a reason inside the package, not a
preference:

- Every `ghclient` call is gated on a working, authenticated `gh` (§1.2). An update check that only
  runs for users who have installed and logged into the GitHub CLI is not an update check.
- Routing around that gate means adding a second, HTTP transport to a package whose own doc comment
  defines it as *"a Go wrapper around the user's own `gh` CLI"* that *"owns NO credential of any
  kind"*. One package would then have two unrelated transports with two different preconditions.
- SPEC's own premise — *"public release metadata needs no per-user credential"* — is precisely why
  the `gh` machinery is the wrong dependency here, not why it should be reused.

What *is* reused is `ghclient`'s two request-header values, restated (its `apiVersionHeader`
constant is unexported): `Accept: application/vnd.github+json` and
`X-GitHub-Api-Version: 2022-11-28` (`api.go:11`, `:37-43`). Same reason `ghclient` pins it — a
GitHub-side default-version bump can never silently reshape the decoded fields.

`internal/httpclient` is also not reused: it is the user-facing request builder (redirect-chain
recording, `Timeline` capture, body truncation reporting, 10 MiB caps — `client.go:1-5`). Its
`Send` answers a question this phase is not asking.

---

## 3. `internal/appupdate`

One package, no Wails import, no storage import, drivable from a plain `httptest` server — the
same self-contained shape `internal/httpclient` states as its own contract.

### 3.1 Constants

```go
const (
	repoOwner = "vlad-cirstean"
	repoName  = "kira-studio"

	latestReleaseURL = "https://api.github.com/repos/" + repoOwner + "/" + repoName + "/releases/latest"
	releasesPageURL  = "https://github.com/" + repoOwner + "/" + repoName + "/releases"

	requestTimeout = 10 * time.Second   // ghclient's own apiTimeout, same reasoning
	maxBodyBytes   = 1 << 20            // a releases/latest body is tens of KiB; this is headroom
)

// okInterval/failureInterval mirror ghclient/discovery.go's own okTTL/notOKTTL split: a good
// answer is worth holding for a long time, a failure is worth retrying sooner.
const (
	okInterval      = 6 * time.Hour
	failureInterval = 30 * time.Minute
)
```

### 3.2 The dev-build guard — no network call at all from an untagged build

```go
// releaseVersions are the three literals a build that is NOT a tagged release can report
// (buildinfo.go:17, Taskfile.yml:18-22, build/config.yml:17). A build reporting any of them
// performs no check and makes no request: there is nothing meaningful to compare against, and a
// `go test` run or a `wails3 task dev` session must never reach the network.
var devVersions = map[string]struct{}{
	"0.0.0":         {},
	"0.0.0-dev":     {},
	"0.0.0-unknown": {},
}
```

`isReleaseBuild(v string) bool` is `!devVersions[v] && semver.IsValid("v"+strings.TrimPrefix(v,"v"))`.
Consequence, stated up front so it is not discovered as a surprise: **the banner is unreachable
under `bun run dev`, under `go test`, and under a `-tags server` build.** §11.2 says how to exercise
it deliberately.

### 3.3 `Checker`

```go
type Result struct {
	UpdateAvailable bool
	CurrentVersion  string
	LatestVersion   string
	releaseURL      string // unexported: never crosses the wire (§4.1)
}

type Checker struct {
	running string
	fetch   func(ctx context.Context) (release, error) // seam; the real one is httpFetch
	now     func() time.Time

	group singleflight.Group

	mu        sync.Mutex
	checkedAt time.Time
	result    Result
}

func NewChecker(runningVersion string) *Checker
func (c *Checker) Status(ctx context.Context) Result
func (c *Checker) ReleaseURL() string
```

`Status`:

1. `isReleaseBuild(c.running)` false → return the zero `Result` with `CurrentVersion` set. No
   request, no cache write, no goroutine.
2. Under `mu`: if `now().Sub(checkedAt) < interval` (`okInterval` after a successful check,
   `failureInterval` after a failed one) return the cached `Result`.
3. Otherwise `c.group.Do("latest", …)` — fetch, compare (§3.4), store `result`+`checkedAt` under
   `mu`, return. Concurrent callers (two windows, or a renderer poll racing another window's boot)
   join the one in-flight request instead of issuing a second.
4. On any error: store `checkedAt = now()` with the previous `result` left as-is, and return it. The
   error is `slog.Debug`-logged and goes no further — it never reaches the wire or the UI.

`golang.org/x/sync/singleflight` is used rather than a hand-rolled `chan struct{}` gate, per
`CLAUDE.md`'s library-first rule. It is already in `go.sum` as an indirect dependency
(`golang.org/x/sync v0.23.0`), BSD-3-Clause, so this promotes a line in `go.mod` and downloads
nothing.

**Cadence, stated as the answer to SPEC's question.** *Both.* `Status` is called by the renderer
once shortly after mount and then hourly (§5.1), and the Go-side interval above is what decides
whether any given call actually reaches the network. So: one check per launch, then at most one per
six hours per app process, however many windows are open and however often they poll.

**Rate limit.** Unauthenticated GitHub REST is 60 requests/hour/IP. At most 4/day from one app
process. Not a concern, recorded so nobody has to re-derive it.

### 3.4 The request and the comparison

`httpFetch`:

- `http.NewRequestWithContext(ctx, http.MethodGet, latestReleaseURL, nil)` on a package-level
  `*http.Client` whose `Transport` sets `Proxy: http.ProxyFromEnvironment` — `httpclient`'s
  `sharedClient` precedent (`client.go:45-50`), and the reason a user behind a corporate proxy is
  not silently broken. TLS config left nil, so verification is on with no opt-out.
- Headers: the two from §2, plus `User-Agent: "Kira Studio/"+buildinfo.Version`
  (`httpclient/client.go:349`'s own format).
- `ctx` wrapped in `context.WithTimeout(ctx, requestTimeout)`.
- Any status other than `200` → error. `404` (no published release yet — §1.6) and `403`
  (rate-limited) are errors like any other, which means silence.
- Body read through `io.LimitReader(resp.Body, maxBodyBytes)`, decoded into:

```go
type release struct {
	TagName    string `json:"tag_name"`
	HTMLURL    string `json:"html_url"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
}
```

`Draft`/`Prerelease` are decoded and skipped even though `/releases/latest` already excludes both —
one `if` against a server-side guarantee this app does not control.

Comparison, `golang.org/x/mod/semver` (already indirect at `v0.41.0`, BSD-3-Clause — another go.mod
promotion, no download):

```go
// normalize turns both "1.3.0" (buildinfo's shape) and "v1.3.0" (a tag's shape) into "v1.3.0",
// which is the only form x/mod/semver accepts.
func normalize(v string) string { return "v" + strings.TrimPrefix(v, "v") }
```

An update is available when `semver.IsValid` holds for both normalized strings **and**
`semver.Compare(latest, running) > 0`. An unparseable tag yields no update, not a guess.

`semver` rather than hand-rolled digit splitting because prerelease ordering (`v1.3.0-rc.1` <
`v1.3.0`) and build-metadata handling are exactly the interacting rules a library already gets
right, and this one is in the dependency graph already.

### 3.5 URL validation before anything reaches `open`

`releaseURL` is set from the decoded `html_url`, but only after:

```go
func safeReleaseURL(raw string) string
```

which returns `raw` only when `url.Parse` succeeds **and** `Scheme == "https"` **and**
`Host == "github.com"` **and** `strings.HasPrefix(Path, "/"+repoOwner+"/"+repoName+"/releases/")`.
Anything else returns the `releasesPageURL` constant.

This is not defensive theatre: §1.3 established that `BrowserManager.OpenURL` validates nothing, and
macOS `open` acts on any scheme it recognises. The only string this app ever hands it is therefore
either a constant or a value that passed the check above.

**What gets opened.** The specific release's page when `html_url` validates, the repository's
`/releases` page otherwise — the latter is also what is opened when no check has ever succeeded. Both
satisfy SPEC's "opens the GitHub releases page"; the specific one is strictly more useful.

---

## 4. The bridge and the shell seam

### 4.1 `internal/bridge/update.go`

```go
// Browser is the OS-browser seam, declared where it is consumed — the same precedent Dialogs
// (files.go:52) and RepoMapInstaller (repomap.go:19) already set.
type Browser interface {
	OpenURL(url string) error
}

// UpdateStatus is the whole wire shape. It deliberately carries no URL and no error string: the
// renderer never supplies or receives a URL (§4.3), and a failed check is silence, not a surface.
type UpdateStatus struct {
	UpdateAvailable bool   `json:"updateAvailable"`
	CurrentVersion  string `json:"currentVersion"`
	LatestVersion   string `json:"latestVersion"`
}

type UpdateService struct {
	Checker *appupdate.Checker
	Browser Browser
}

func (s *UpdateService) Status(ctx context.Context) (UpdateStatus, error)
func (s *UpdateService) OpenReleasePage() error
```

`Status` blocks on the network only when a check is actually due (§3.3), and it is never on the boot
critical path (§5.1). `ctx` as a first parameter is already the shape Wails' generated bindings
support — `CodeWorkspaceService.ReadFile` (`codeworkspace.go:208`) and eight siblings take it.

`OpenReleasePage` passes `s.Checker.ReleaseURL()` to `s.Browser.OpenURL` and wraps a failure through
`internal/ipcerr`, as `RepoMapService` already does for its own actions.

### 4.2 `internal/shell/app.go` — the deferred browser

Modelled line-for-line on `NewDeferredDialogs` (`app.go:115-121`), for the identical ordering reason
its comment gives (the service list is an argument to `application.New`, which is the only thing
that produces the `*App`):

```go
type browserOpener struct{ app *application.App }

func (b *browserOpener) OpenURL(url string) error {
	if b.app == nil {
		return errors.New("no application")
	}
	return b.app.Browser.OpenURL(url)
}

func NewDeferredBrowser() (b bridge.Browser, attach func(*application.App))
```

`internal/shell` stays the only package importing `pkg/application` (`app.go:12`'s own invariant).

### 4.3 `main.go`

- beside `emitter, attachEmitter := shell.NewDeferredEmitter()` (`:251`) and
  `dialogs, attachDialogs := shell.NewDeferredDialogs()` (`:253`):
  `browserOpener, attachBrowser := shell.NewDeferredBrowser()`
- `updateChecker := appupdate.NewChecker(buildinfo.Version)` — `buildinfo` is already imported
  (`:28`).
- one more entry in the `Services` list (`:342-367`):
  `application.NewService(&bridge.UpdateService{Checker: updateChecker, Browser: browserOpener})`
- `attachBrowser(app)` beside `attachEmitter(app)` (`:404`).

Nothing is added to the quit teardown: the `Checker` owns no goroutine, no ticker and no file
handle. Its only in-flight work is bounded by `requestTimeout`.

**Security property worth naming.** The renderer never sends a URL and never receives one. It calls
a nullary `OpenReleasePage()`; the Go side opens a string it either built from constants or
validated itself. There is no renderer-controlled path into `open`.

### 4.4 Regenerate bindings

A new bound service means `wails3 task common:generate:bindings` (or `sh scripts/setup.sh`), per
`docs/DEV_ENVIRONMENT.md`'s own warning that `-names` is load-bearing for `tests/ui/`. Produces
`apps/kira-studio/frontend/bindings/…/bridge/updateservice.ts` and a new `UpdateStatus` in
`models.ts`.

---

## 5. The renderer

### 5.1 `frontend/src/state/appUpdate.ts`

`appMetrics.ts`'s shape, pull instead of push:

```ts
export const appUpdateState = reactive({
  available: false,
  currentVersion: '',
  latestVersion: '',
});

const POLL_MS = 60 * 60 * 1000; // hourly; Go's own 6h floor (§3.3) decides what actually fetches

export function initAppUpdate(): void
```

`initAppUpdate` calls `control.updateStatus()` once, then on a `setInterval`, assigning the result
and swallowing every rejection (a failed check is not a UI event). Idempotent, guarded by a
module-level flag exactly as `initAppMetrics` is.

**Called after the mount, not inside `bootstrap`'s `Promise.all`** — `main.ts:318`'s
`createApp(App)…mount('#app')` is `bootstrap`'s last statement; `initAppUpdate()` goes immediately
after it. The `Promise.all` at `:291` is the boot critical path and gains nothing.

`bridge/index.ts` gains two methods on `studioControl` (`:73`), beside `appInfo` (`:74`), plus the
`@bindings/updateservice.js` import:

```ts
updateStatus: (): Promise<WailsModels.UpdateStatus> => unwrap(UpdateService.Status()),
updateOpenReleasePage: (): Promise<void> => unwrap(UpdateService.OpenReleasePage()),
```

### 5.2 `workbench/StatusBar.vue`

One new element, **first in the right-hand `.side`** (before `app-metrics`), so the three existing
readouts keep their positions and their reserved widths (`:108-117`):

```html
<button
  v-if="appUpdateState.available"
  class="p-status update"
  data-testid="update-available"
  v-tooltip="updateTooltip"
  @click="onOpenReleasePage"
>
  <CodiconIcon name="cloud-download" :size="13" />
  Update {{ appUpdateState.latestVersion }}
</button>
```

- `cloud-download` is confirmed present in the installed `@vscode/codicons` (`codicon.css`).
- A `<button>`, not the `<span>` its neighbours use, because this one is activated — keyboard focus
  and Enter/Space come free, and no `<a href>` enters the renderer (§1.4, and the Invariants
  bullet §9 quotes).
- `updateTooltip` is a `computed`: `Version <latest> is available. You have <current>. Opens GitHub
  in your browser.`
- `onOpenReleasePage` is `void control.updateOpenReleasePage().catch(() => {})`.
- Scoped CSS: reset the button's own chrome (`background: none; border: 0; padding: 0; font:
  inherit; cursor: pointer`), `color: var(--kira-info)` so it reads as actionable against the bar's
  `--kira-fg-muted`, and a `:hover` colour shift. No new token; `--kira-info` is already used by
  `.p-td.fk` (`primitives.css:977`).

Hidden entirely when no update is available, which is every dev run and every run before this
repository publishes a release (§1.6) — so the status bar is byte-identical to today in every
existing test and snapshot.

---

## 6. Files

**New**

```
apps/kira-studio/internal/appupdate/checker.go        Checker, Status, httpFetch, safeReleaseURL (§3)
apps/kira-studio/internal/appupdate/version.go        devVersions, isReleaseBuild, normalize, compare (§3.2/§3.4)
apps/kira-studio/internal/appupdate/version_test.go   the decision table (§8)
apps/kira-studio/internal/appupdate/checker_test.go   cache interval + single-flight (§8)
apps/kira-studio/internal/bridge/update.go            Browser, UpdateStatus, UpdateService (§4.1)
apps/kira-studio/frontend/src/state/appUpdate.ts      the store and the poll (§5.1)
apps/kira-studio/tests/ui/update-banner.spec.ts       two cases (§8)
```

**Extended**

```
go.mod                                                x/mod and x/sync promoted to direct (§3.3/§3.4)
apps/kira-studio/internal/shell/app.go                NewDeferredBrowser (§4.2)
apps/kira-studio/main.go                              checker, service, attachBrowser (§4.3)
apps/kira-studio/frontend/src/bridge/index.ts         two control methods (§5.1)
apps/kira-studio/frontend/src/main.ts                 initAppUpdate() after mount (§5.1)
apps/kira-studio/frontend/src/workbench/StatusBar.vue the readout (§5.2)
apps/kira-studio/tests/ui/support/ipcChannels.ts      two channel keys (§8)
apps/kira-studio/tests/ui/support/mockRuntime.ts      two FQN entries + a WILDCARD default (§8)
scripts/verify-packaging.sh                           S9 (§7)
docs/ARCHITECTURE.md                                  one subsection + one Invariants clause (§9)
docs/PACKAGING.md                                     §7's auto-update paragraph (§9)
apps/kira-studio/frontend/bindings/**                 regenerated, not hand-edited (§4.4)
```

**Untouched, and that is the point**: `internal/ghclient/**` (§2), `internal/httpclient/**`,
`packages/shared/domain/settings.ts` (§10), `.github/workflows/**` (§9).

---

## 7. S9 — the executable form of "no silent auto-update"

`scripts/verify-packaging.sh` grows one static check beside S1/S2/S5, in the same style:

```sh
# --- S9: the update check reads release metadata only — it never downloads an artifact ---
if grep -rnE 'browser_download_url|releases/download' apps/ packages/ >/dev/null 2>&1; then
  fail "release asset download present" "apps/ or packages/ references a release asset download; P66 ships an availability banner only"
fi
```

This is SPEC's own "no silent auto-update" premise made checkable, and it is the guard that stops a
later phase quietly turning the banner into a downloader. S1, S2 and S5 are unchanged and stay green
— nothing this phase adds matches `autoUpdater` or `electron-updater` (§1.5).

`scripts/` is not under `.github/workflows/`, so this commits and pushes normally.

---

## 8. Testing

`CLAUDE.md`'s bar is a dedicated unit test only for genuinely hard logic. Two Go test files clear it
and nothing else does.

**`version_test.go` — earns its keep.** A table over the decision structure of §3.2/§3.4/§3.5, which
is several interacting rules, not one `if`: each of the three dev sentinels suppresses the check; a
tagged version does not; `1.3.0` vs `v1.3.0` normalize equal; a newer tag is available and an older
or equal one is not; `v1.3.0-rc.1` sorts below `v1.3.0`; an unparseable tag yields no update rather
than a guess; `safeReleaseURL` accepts the real shape and rejects each of wrong scheme, wrong host,
and right host with a foreign path.

**`checker_test.go` — earns its keep on the concurrency clause specifically.** Two cases, both over
a fake `fetch` and a fake `now`: (1) N concurrent `Status` calls produce exactly **one** fetch
(single-flight); (2) a second call inside `okInterval` produces none, a call after it produces one,
and a call after a *failed* check produces one at `failureInterval` rather than `okInterval`.

**No test is written for**: `httpFetch` (a request builder plus a JSON decode — a thin wrapper),
`UpdateService` (two-line pass-throughs), the shell seam (`app.Browser.OpenURL` cannot be driven
without a real `*App`), or `state/appUpdate.ts` (a `setInterval` and three assignments). Each is
explicitly on `CLAUDE.md`'s "gets nothing" list.

**`tests/ui/update-banner.spec.ts`**, two cases through the existing snapshot mock:

1. default boot (the `WILDCARD_DEFAULTS` entry below) → `[data-testid="update-available"]` has count
   0, and `status-bar` is still visible with its three existing readouts.
2. `relaunch({ control: [{ channel: IPC.updateStatus, args: [], result: { updateAvailable: true,
   currentVersion: '1.2.0', latestVersion: '1.3.0' } }] })` → the item is visible, reads
   `Update 1.3.0`, and clicking it records an `updateOpenReleasePage` call in the mock's own log.

Scaffolding this needs, each mirroring the `repoMap*` entries added by C3:

- `ipcChannels.ts`: `updateStatus: 'kira:update:status'`,
  `updateOpenReleasePage: 'kira:update:openReleasePage'`.
- `mockRuntime.ts` `FQN_SUFFIX_BY_IPC_KEY`: `UpdateService.Status`, `UpdateService.OpenReleasePage`.
- `mockRuntime.ts` `WILDCARD_DEFAULTS`: `[IPC.updateStatus]` →
  `{"updateAvailable":false,"currentVersion":"0.0.0-dev","latestVersion":""}`, and
  `[IPC.updateOpenReleasePage]` → `'null'`. The comment states the reason the `repoMapStatus`
  default already states: every boot calls it, no spec seeds it, and "no update" is the honest
  default for a dev-server run.

Because the default is "no update", **no existing UI or visual snapshot changes.**

---

## 9. Documentation to update

- **`docs/ARCHITECTURE.md`, Invariants** — the bullet *"Renderer loads no remote content, opens no
  window, navigates nowhere but its own base URL"* stays true and becomes load-bearing: add a
  clause noting that the update check is a Go-side request for exactly this reason, and that the
  browser is opened by the shell, never by the renderer.
- **`docs/ARCHITECTURE.md`, UI architecture** — a short subsection on the status bar's update
  readout: what is checked, how often, that an untagged build never checks, that a failure is
  silence, and that nothing is ever downloaded or installed.
- **`docs/PACKAGING.md` §7** — the *"No auto-update"* paragraph. It stays accurate (no feed, no
  publish provider, no `latest-mac.yml`, no `.blockmap`) and gains: the app now checks GitHub's
  `releases/latest` and shows a status-bar banner; it downloads nothing and installs nothing; S9 is
  what keeps that true; and **a draft release is invisible to the check** — step 4's "then
  publishes" is what makes a release reachable at all.
- **`docs/v1.6/mcp-repo-map-issues.md`** — whatever this phase's own dogfooding turns up.

**`.github/workflows/release.yml` needs no change.** Its release-notes text — *"This release has no
auto-update. The artifact below carries no update metadata or feed"* — remains literally true: the
artifact carries no metadata and there is no feed. Avoiding the
`docs/pending-changes/`-patch workaround entirely is a real saving, not a shortcut.

---

## 10. Explicitly out of scope

- **Downloading, verifying or installing anything.** SPEC's own premise, and S9 now enforces it.
- **A settings toggle for the check.** SPEC's P66 row does not ask for one, and the honest place for
  it would be a new instant-action Settings section: the Advanced tab is draft/Save-only and
  `SettingsDialog.vue:104-107`'s own G12 D9 comment forbids mixing an instant action into such a
  tab. That is a real piece of work and it is not this row's. OQ-2.
- **A "Check now" button.** Same reason, and the same section it would have to live in.
- **Dismissing the banner.** It is a 13-pixel status readout beside three others, not a modal. A
  dismiss affordance on it would be larger than the thing it dismisses. OQ-3.
- **Prerelease channels / opting into betas.** `/releases/latest` excludes prereleases by
  construction; an opt-in would need `/releases` paging and a settings leaf.
- **GitHub Enterprise or any host but `github.com`.** This app ships from one repository.
- **Surfacing the release notes in-app.** The release page shows them; rendering Markdown from a
  remote source inside the window is exactly what the Invariants bullet rules out.
- **Growing `AppService.Info`.** It reports build facts; update availability is not one.
- **Any change to `internal/ghclient`, `internal/httpclient`, or the settings schema.**

---

## 11. Verification

### 11.1 Mechanical

```
go build ./... && go vet ./...
go test ./apps/kira-studio/internal/appupdate/...
bun run typecheck
bun run lint
bun run build
bun run test:ui
bun run test:visual        # expect a zero-pixel diff — the banner is hidden by default (§8)
bun run verify:packaging   # S1/S2/S5 still green, S9 green
```

Then confirm by hand:

- `grep -rn "autoUpdater" apps/ packages/` finds nothing (§1.5).
- `git diff --stat` names no file under `internal/ghclient/`, `internal/httpclient/`,
  `packages/shared/domain/`, or `.github/`.
- `go mod tidy` leaves `go.sum` unchanged — both promoted modules were already in the graph.

### 11.2 Manual recipe

The interesting paths need deliberate setup, because §1.6 and §3.2 mean the default answer is
silence on both ends.

1. **Default dev run.** `bun run dev`. Status bar shows the three existing readouts and no update
   item. In DevTools' Network tab (and in the app's own log at debug level) there is **no request to
   `api.github.com` at all** — the §3.2 guard, not a failed request.
2. **A build that thinks it is a release.** Temporarily set `apps/kira-studio/build/config.yml`'s
   `info.version` to `0.0.1`, rebuild, launch. One request to
   `api.github.com/repos/vlad-cirstean/kira-studio/releases/latest` goes out and answers `404`
   today: still no banner, still no error surface, nothing in the console. Revert `config.yml`.
3. **The available path.** With `config.yml` still at `0.0.1`, temporarily point
   `latestReleaseURL`/`releasesPageURL` at a public repository that does have a published release.
   The banner appears reading `Update <that tag>`; the tooltip names both versions; clicking it
   opens that release's page in the default browser, not in the app window. Revert both constants.
   *(Note for whoever runs this: this container's proxy answers `403` for some `api.github.com`
   release endpoints — `wailsapp/wails/releases/latest` did. Run step 3 on a real Mac session.)*
4. **Two windows.** ⇧⌘N for a second window with step 3's setup in place. Both show the banner;
   exactly **one** outbound request was made (single-flight plus the shared cache, §3.3).
5. **Offline.** Disable networking, relaunch with step 3's setup. No banner, no error dialog, no
   console output, and the app boots at its normal speed — `Status` is off the critical path.
6. **Once this repository publishes a real release**, repeat step 2 with no constant edits: it is
   then the genuine end-to-end path.

### 11.3 Checklist

- [ ] No file under `internal/ghclient/` or `internal/httpclient/` changed.
- [ ] `internal/shell` is still the only package importing `pkg/application`.
- [ ] Zero `<a href>`, `target="_blank"` and `window.open` in `apps/kira-studio/frontend/src` — still
      true after this phase (§1.3, Renderer security surface).
- [ ] The renderer neither sends nor receives a URL (§4.3).
- [ ] An untagged build issues no request (§11.2 step 1).
- [ ] S9 present and green; S1/S2/S5 unchanged.
- [ ] Bindings regenerated through the task, never hand-edited (§4.4).
- [ ] A repo-map MCP `tools/call` answered correctly during the phase; logged.

---

## 12. Open questions for a human

**OQ-1 — repository coordinates.** §3.1 hard-codes `vlad-cirstean/kira-studio`, from `git remote -v`
and `README.md`'s CI badge. The Go module path says `kirathecat/kira-studio`, which is *not* a
GitHub location. If the repository is ever renamed or transferred, an old binary checks the old
place and silently stops finding releases. *Recommendation: ship the constants as written; treat a
transfer as needing a release that carries the new constants, and say so in `docs/PACKAGING.md` §7.*

**OQ-2 — no opt-out.** §10 leaves out a settings toggle because SPEC does not ask for one and the
only rule-abiding home for it is a new instant-action Settings section. The consequence is that a
tagged build contacts `api.github.com` up to four times a day with no user-visible switch. That is
mild (no credential, no identifier beyond a `User-Agent` carrying the app version, one GET) but it
is real, and `docs/PACKAGING.md` currently tells readers the app has no update machinery at all.
*Recommendation: ship without the toggle, and update `docs/PACKAGING.md` §7 (§9) so the behaviour is
documented rather than discovered. Add the toggle as its own row if it is wanted.*

**OQ-3 — no dismiss.** §10 leaves the banner permanent while a newer release exists. A user who does
not want to update sees it for the life of that version. *Recommendation: leave it — it is one muted
status item among four, not a modal — but this is a product call.*

**OQ-4 — what the click opens.** §3.5 opens the specific release's `html_url` when it validates,
falling back to `/releases`. SPEC says "the GitHub releases page", which the fallback matches
literally. *Recommendation: keep the specific release — it is the page that actually answers "what
changed and where is the download".*
