# P29 — production-readiness audit: what ships that shouldn't

> **What this phase is.** A sweep of the whole shipped surface — `apps/kira-studio/frontend/src`,
> `apps/kira-studio/internal`, `apps/kira-studio/main.go`, `apps/kira-studio/cmd`,
> `packages/shared`, and the build/package pipeline that turns them into a `.dmg` — asking one
> question per construct: *does this reach a packaged build, and should it?* It is an audit phase,
> not a feature phase: the deliverable is a small number of precise removals and gates, plus an
> explicit written justification for every dev-ergonomics construct that is deliberately left
> alone.
>
> **The headline finding, stated up front so the rest reads in proportion:** the codebase is
> already unusually clean by the measures this kind of audit normally turns up — zero `TODO`/
> `FIXME`/`XXX`/`HACK`/`debugger` anywhere under `apps/`, zero `fmt.Print`/`println`/`log.Print`
> in shipped Go, exactly **one** `console.*` call in the entire frontend source (and it is inside
> an opt-in diagnostic), no hardcoded dev URL or port in any shipped path, a strict CSP, and a dev
> menu correctly gated behind Wails' own `production` build tag. What the sweep did find is a
> single real class of leakage — **eight `window.__kira*` debug globals installed unconditionally
> into every build, including the packaged one** — plus a dead measurement scaffold still embedded
> in the shipped binary, and a handful of small correctness/consistency defects around them. There
> is no debug backdoor, no dev-only auth bypass, and no credential in any log this sweep could
> find.
>
> **Every claim below was verified against the tree at this phase's own base commit** (`f4a81d6`,
> *docs: fix the stale SlickGrid entry, record P30's reopening of Pass B §6*, branch
> `claude/feature-v1-1-p5-onwards-2isfzt`) — every `file:line` citation points at that commit's
> content. Nothing here is inferred from a previous phase's prose; the source was re-read.

---

## 0. Scope and non-scope

**In scope** — everything that can end up inside `Kira Studio.app`:

- `apps/kira-studio/frontend/src/**` (the whole Vue bundle Vite emits into `frontend/dist`, which
  `main.go:53`'s `//go:embed all:frontend/dist` swallows whole)
- `apps/kira-studio/main.go`, `apps/kira-studio/internal/**`, `packages/shared/**`
- `apps/kira-studio/blank/**` (embedded — `main.go:60`)
- the build/package pipeline: `apps/kira-studio/frontend/vite.config.ts`,
  `apps/kira-studio/Taskfile.yml`, `apps/kira-studio/build/Taskfile.yml`,
  `apps/kira-studio/build/darwin/Taskfile.yml`, `package.json`'s `scripts`,
  `scripts/verify-packaging.sh`, `.github/workflows/release.yml`
- the docs that describe the above where they have gone stale against it

**Out of scope, explicitly**:

- `apps/kira-studio/tests/**` and `packages/db-fixtures/**` — nothing there is linked, embedded or
  bundled into a shipped artifact. Their hygiene was checked anyway (§1) and is fine.
- `apps/kira-studio/internal/adapters/testsupport/**` and `apps/kira-studio/internal/ipcfixture/**`
  — these are non-`_test.go` files in ordinary packages, so they *look* shippable, but **no
  non-test file anywhere imports either package** (verified by grep across every `.go` file under
  `apps/kira-studio` excluding `_test.go` and the packages themselves). `testcontainers-go` and
  `testing` therefore never enter the app binary's import graph. No action.
- Adapter behaviour, protocol shape, UI — this phase changes no product behaviour at all. The one
  exception is §2.6, which *adds a test assertion* and changes nothing that runs in the app.
- Dependency versions and licensing — P19 and P23 own those.
- Auto-update, notarisation, hardened runtime — `docs/PACKAGING.md` §7 already records these as
  deliberate deferrals, and `scripts/verify-packaging.sh`'s S1/S2 already enforce the first.

---

## 1. What was actually searched — including what turned up nothing

`AGENTS.md`'s multiple-passes rule says a pass that finds nothing real should say so rather than
manufacture a finding. Most of this table is that sentence, per search.

| Search | Where | Result |
|---|---|---|
| `console.(log\|debug\|trace\|info\|warn\|error)` | `frontend/src` | **1 hit**: `views/shared/slick/scrollTrace.ts:352`, a `console.warn` inside `stop()`'s "you didn't call `start()`" guard. Keep (§4). |
| `debugger` | all of `apps/` | 0 |
| `TODO` / `FIXME` / `XXX` / `HACK` | all of `apps/` | 0 |
| `import.meta.env` / `process.env` / `NODE_ENV` / `__DEV__` | `frontend/**` | **1 hit**, `vite.config.ts:17` (`WAILS_VITE_PORT`) — build config, not shipped code. The frontend source has *no* dev/prod discrimination mechanism at all today; §2.1 is downstream of exactly that. |
| `fmt.Print*` / `println(` / `log.Print*` / `os.Stdout` | `internal/**`, `main.go` | 0 ad-hoc prints. `main.go` uses `log.Fatalf` for 8 unrecoverable startup failures (correct — there is no logger yet at `EnsureLayout`/`logging.Init` time, and no window to show anything in). `cmd/g1measure` prints freely, and should — it is a CLI, not the app (§4). |
| `os.Getenv` / `os.LookupEnv` | non-test Go | 5: `KIRA_HOME` (`config/paths.go:12`), `KIRA_DEV` (`config/env.go:14`), `KIRA_INSECURE_SECRETS` (`secrets/cipher.go:40`), `KIRA_G1_BLANK` (`main.go:361`), `KIRA_IPC_FIXTURES` (`ipcfixture/write.go:17`, test-only package). Each is adjudicated individually — §2.2, §2.4, §2.5, §4. |
| `localhost` / `127.0.0.1` / `0.0.0.0` / `http://` / `ws://` | `frontend/src` | 0 |
| `localhost` / `127.0.0.1` | non-test Go | 4, all *default host values for a user-entered connection form* (`mongo/client.go:81`, `kafka/client.go:54`, `redis/client.go:70`, `mysqlfamily/client.go:56`). Not dev endpoints. |
| `//go:build` tags | all Go | 13, all `darwin`/`cgo`/platform splits. **No repo-owned `server` tag exists** — `-tags server` (`AGENTS.md`, `tests/e2e-real/fixtures.ts:68`) selects *Wails'* own headless platform, so there is no repo source that a `server` build turns on. §4. |
| `innerHTML` / `eval(` / `new Function` | `frontend/src` | 0. `SlickGridHost.vue:1742` records that the `innerHTML` branch was deliberately removed because cell text is untrusted database content. |
| `test.only` / `describe.only` / `it.only` | `tests/**` | 0. Every `test.skip` (5) and `t.Skip` (17) is environment-conditional (Docker absent, `KIRA_TEST_MATRIX` unset, no outbound network) with a message naming the condition. |
| tracked build artefacts | `git ls-files` | 0 binaries, 0 `.dmg`/`.app`/`.log`. Largest tracked files are the app icons and plan docs. `dist`, `test-results/`, `playwright-report/`, `.tools/` all gitignored. |
| CSP | `frontend/index.html:5-8` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:` — no remote script origin at all. This is load-bearing for §2.1's risk assessment. |
| window capability posture | `internal/shell/security.go:15-28` | Microphone/camera/geolocation/notifications denied, clipboard-read allowed (copy-cell needs it), `JavaScriptCanOpenWindowsAutomatically` disabled. Correct, no change. |
| dev menu | `internal/shell/menutemplate.go:84-89` | `Reload` + `OpenDevTools` appended **only** `if isDev`, where `isDev` is `app.Env.Info().Debug` (`main.go:332`) — Wails' own flag, `false` whenever the binary was built with `-tags production`, which the packaging path always passes (`build/darwin/Taskfile.yml`'s `BUILD_FLAGS`). Correctly gated. |
| release path | `.github/workflows/release.yml` | `bun run package` → `darwin:package:dmg` → `-tags production -trimpath -buildvcs=false -ldflags "-w -s -X …buildinfo.Version=…"`, then `sh scripts/sign-bundle.sh`, then `bun run verify:packaging`. Symbols stripped, no sourcemaps (Vite's `build.sourcemap` defaults to `false` and is not overridden). Correct. |

Everything below is what did *not* come back clean.

---

## 2. Findings

### 2.1 F1 — `main.ts` installs eight `__kira*` debug globals into **every** build, packaged included

**What it is.** `frontend/src/main.ts:225-268` runs, at module scope with no condition of any kind:

```ts
window.__kiraScrollTrace = { start: startScrollTrace, stop: stopScrollTrace };
window.__kiraGridTuning = {};
window.__kiraGridRetainedBytes = totalRetainedBytes;
window.__kiraRetainedBytes = () => …;          // 228-233
window.__kiraRetention = () => { … };          // 234-265
window.__kiraCount = data.count;               // 266
window.__kiraCacheStats = data.cacheStats;     // 267
window.__kiraTreeConnectionIds = () => Array.from(knownConnectionIds());  // 268
```

Their own doc comments (`main.ts:129-167`) say what they are: *"Playwright-only hook
(tests/e2e/perf.spec.ts)"*, *"Playwright-only hooks (tests/e2e/leaks.spec.ts)"*, *"Playwright-only
hook (tests/e2e/budgets.spec.ts)"*, *"Playwright-only hook (P5 C1, tests/ui/leaks.spec.ts)"*. Five
more modules carry `/** Playwright-only (main.ts's window.__kiraRetention, C1). */` on exports that
exist only to feed the probe (`views/grid/page.ts:15`, `views/documents/page.ts:15`,
`views/keyvalue/page.ts:12`, `views/stream/page.ts:12`, `views/console/resultPages.ts:28`,
`views/console/explainResults.ts:29`, `views/shared/document/rows.ts:225`,
`views/shared/page/store.ts:71`), and `project/state/tree.ts:276` notes `knownConnectionIds` is
kept *"only for the Playwright-only `window.__kiraTreeConnectionIds` hook."*

So: nine files declare, in prose, that this surface is test-only. All of it ships.

**Why it is a concern.** Three reasons, in descending order of how much they actually matter —
stated honestly rather than inflated, because overstating this one would make the rest of the
document less trustworthy:

1. **Stated intent and reality disagree, and nothing catches it.** This is the exact defect class
   the SlickGrid cutover just removed by deleting `window.__kiraGridEngine`/`KIRA_GRID_ENGINE`
   (`tests/ui/fixtures.ts:82`, `tests/ui/slick-grid.spec.ts:22` still narrate that deletion). That
   flag was worse — it switched product behaviour at runtime — but it survived as long as it did
   for the same structural reason these have: **there is no mechanism in this frontend that can
   distinguish a shipped build from a test build**, so "test-only" is a comment, not a property.
   Until that mechanism exists, the next hook added is shipped too.
2. **It is a real, if small, capability surface.** `__kiraCount` is *literally* `data.count` and
   `__kiraCacheStats` is *literally* `data.cacheStats` — live bound calls to the Go backend,
   reachable as one-liners from any script that runs in the webview. Today nothing can get such a
   script in: `index.html`'s CSP is `script-src 'self'`, and `shell/security.go` forbids
   automatic `window.open`. So the honest risk statement is **not** "this is exploitable"; it is
   "this converts any future CSP relaxation, or any pasted-into-the-console snippet, from a
   nuisance into a data-plane handle." That is a defence-in-depth argument, and should be
   presented as one.
3. **It taxes production code shape.** Eight modules export accessors, and one module keeps a
   whole `Set` alive, purely so a probe can read them. Gating the install lets every one of those
   exports become unreferenced in a production build and tree-shake, without deleting them from
   source.

What it is **not**: it is not a bundle-size problem worth measuring. `scrollTrace.ts` is 368 lines,
`main.ts`'s probe block ~180; minified and gzipped this is single-digit kilobytes inside a binary
that already embeds a WebKit-driven desktop app. Per `AGENTS.md`'s measure-with-purpose rule, a
byte-for-byte bundle comparison is **not** taken here, because the decision does not turn on it —
saying so plainly is better than producing a number nobody acts on.

**The constraint that makes "just delete them" wrong.** Every one of the eight is load-bearing for
a suite or a documented protocol that must keep working:

| Hook | Consumer | Can it be deleted? |
|---|---|---|
| `__kiraGridRetainedBytes` | `tests/ui/perf.spec.ts:69` | No |
| `__kiraRetainedBytes` | `tests/ui/leaks.spec.ts:107`, `slick-grid.spec.ts:530/548/650/677` | No |
| `__kiraRetention` | `tests/ui/leaks.spec.ts:115`, `slick-grid.spec.ts:400/527/544/647/673` | No |
| `__kiraCount`, `__kiraCacheStats` | `tests/ui/leaks.spec.ts` (`perf.spec.ts:35` explains why these two are *not* pure-renderer hooks) | No |
| `__kiraTreeConnectionIds` | `tests/ui/leaks.spec.ts:416` | No |
| `__kiraGridScrollWorkStart` | set by `tests/ui/support/measure.ts:143`, *read* by `SlickGridHost.vue:617` | No |
| `__kiraScrollTrace` | `tests/ui/scroll-trace.spec.ts`, `slick-grid.spec.ts:575…1073`, and `docs/PERF.md` §2.1a/§2.1c/§2.1d's real-hardware protocol | No |
| `__kiraGridTuning` | `tests/ui/slick-grid.spec.ts:609/655/805/830`, and every A/B protocol in `docs/PERF.md` §2.1c-§2.1f | No |

And `package.json`'s `test:ui` / `test:ipc:fe` both run `bun run build` — the **production** Vite
build — before Playwright, and `tests/e2e-real/fixtures.ts:64` does the same. So a naive
`if (import.meta.env.DEV)` deletes the hooks from exactly the build the tests run against.

**The fix.** One explicit build-time flag, defaulting off, turned on by the three entry points that
need it. Not a runtime flag — a `define` constant, so a shipped build cannot be talked into
enabling it, which is the property `__kiraGridEngine` lacked.

1. `frontend/vite.config.ts` — convert the default export to the function form and add:
   ```ts
   export default defineConfig(({ command }) => {
     // `serve` is `wails3 dev`'s Vite dev server, whose DevTools console is the only place
     // docs/PERF.md's real-hardware scroll protocol can run. KIRA_DEBUG_HOOKS covers the two
     // *built* bundles that also need them: build:dev (a DEV=true native build) and build:test.
     const debugHooks = command === 'serve' || process.env.KIRA_DEBUG_HOOKS === '1';
     return { …, define: { __KIRA_DEBUG_HOOKS__: JSON.stringify(debugHooks) }, … };
   });
   ```
2. `frontend/src/env.d.ts` — `declare const __KIRA_DEBUG_HOOKS__: boolean;`
3. `frontend/src/main.ts` — wrap **only** lines 225-268 in `if (__KIRA_DEBUG_HOOKS__) { … }`. The
   `declare global` block (127-224) stays exactly as-is: it is type-only, emits nothing, and
   `tests/ui/global.d.ts` and `views/shared/slick/kiraSlickGrid.ts:28-57` both re-declare the same
   shape for their own TS programs and must keep matching it.
4. `frontend/package.json` — add `"build:test": "KIRA_DEBUG_HOOKS=1 vite build"`, and set the same
   variable on the existing `build:dev`.
5. Root `package.json` — add `"build:test": "cd apps/kira-studio/frontend && bun run build:test"`,
   and point `test:ui` and `test:ipc:fe` at it instead of `bun run build`.
6. `tests/e2e-real/fixtures.ts:65` — `['run', 'build']` → `['run', 'build:test']`.

**Deliberately not gated**: the *read* sites — `SlickGridHost.vue:550/617/1781`,
`ConsoleSlickGrid.vue:191`, `kiraSlickGrid.ts:68/224/366`. Every one is already an optional read
(`window.__kiraGridTuning?.x ?? DEFAULT`, `window.__kiraGridScrollWorkStart?.(now)`); with the
object never installed they fall through to the compiled default, which is the correct production
behaviour. Gating them would drag `__KIRA_DEBUG_HOOKS__` into `tests/unit`'s separate TS program
(`kiraSlickGrid.ts` is in it) for no runtime gain. Four lines of diff beats forty.

**What the gate buys, concretely.** With the eight assignments dead, rolldown drops as unreachable:
`main.ts`'s `storeStats`/`sumMatches`/`frameBufferStats` (`main.ts:82-125`), the whole `__kiraRetention`
closure, `scrollTrace.ts`'s `start`/`stop`/`summarize`/`stats` recording half (the `note*` no-op
guards stay, since `SlickGridHost.vue` and `kiraSlickGrid.ts` still call them), the five
`pageStoreEntries` exports, `explainResults.ts`'s `planCount`, `rows.ts`'s `retentionSnapshot`, and
`store.ts`'s per-scope internals accessor. **No source is deleted** — this phase stops *shipping*
instrumentation, it does not remove it.

**The trap the fix creates, and the guard that closes it.** `build:test` writes to the same
`frontend/dist` the packaging path embeds, and `build/Taskfile.yml`'s `build:frontend` task is
fingerprinted (`sources: ["**/*", exclude node_modules, exclude dist]`, `generates: dist/**/*`).
So: run `bun run test:ui`, then `bun run package` with no intervening source edit, and Task
**skips the rebuild** and embeds the hooks-enabled bundle. This is not hypothetical, and it is not
an inference — `docs/PACKAGING.md:136-137` already states the mechanism approvingly: *"Task's
`sources`/`generates` up-to-date checking makes the second invocation a no-op against fresh
output."* That is exactly right today, when both invocations produce the same bytes, and becomes
wrong the moment §2.1 makes them differ. The guard, which is required and not optional:

- **`scripts/verify-packaging.sh` — new check S6.** After the bundle exists, grep
  `apps/kira-studio/bin/Kira Studio.app/Contents/…` — or, more portably and so the check also runs
  on Linux and before packaging, `apps/kira-studio/frontend/dist/**/*.js` — for the identifiers
  that exist *only* inside the gated block: `__kiraCount`, `__kiraCacheStats`, `__kiraRetention`,
  `__kiraRetainedBytes`, `__kiraTreeConnectionIds`. Any hit fails the run with "the packaged
  frontend bundle carries the Playwright debug hooks — rebuild with `bun run build`, not
  `build:test`." Follows the file's own idiom: every check runs, one run reports everything.
  (`__kiraScrollTrace` is deliberately **not** in the grep list: its `console.warn` string literal
  at `scrollTrace.ts:352` survives in the retained `note*` half of the module, so it would be a
  false positive. The five above appear nowhere else.)
- The check must run in `.github/workflows/release.yml` — it already does, via
  `bun run verify:packaging` at line 56.

### 2.2 F2 — `KIRA_G1_BLANK` and the embedded `blank/index.html` are dead P52 scaffolding still inside the shipped binary

**What it is.** `main.go:56-61` embeds `blank/index.html`, and `main.go:360-369`'s `assetHandler()`
swaps the *entire application frontend* for it when `KIRA_G1_BLANK=1`:

```go
func assetHandler() http.Handler {
	if os.Getenv("KIRA_G1_BLANK") == "1" { … return application.AssetFileServerFS(sub) }
	return application.AssetFileServerFS(assets)
}
```

**Why it is a concern.** It is measurement scaffolding for P52's gate G1, and that gate is closed —
`docs/PERF.md` §2.3 and §2.4 already report its numbers. Three things make it worse than merely
unused:

- It is **already bit-rotted**. `blank/index.html`'s comment describes measuring *"Wails +
  WKWebView/WebKitGTK + Go + the vendored Node child"* — the Node child was deleted in P58f. And
  it calls `Call.ByID(3273072800)` with a hand-copied bound-method id, while `AGENTS.md` records
  that bindings are generated with `-names`, i.e. every real call site emits `Call.ByName(...)`.
  Whether that numeric id still resolves has not been true-by-construction since the generator flag
  changed. It could not be trusted for a measurement today without repair.
- `apps/kira-studio/README.md:26-27` says `blank/` and `cmd/g1measure/` are *"not part of the
  shipped app."* For `cmd/g1measure` that is true. For `blank/` it is **false** — `//go:embed`
  puts it in the binary. A doc that contradicts the code is worse than no doc.
- It is the one shipped code path where an environment variable replaces the entire product with
  something else. `docs/PERF.md:965-966` even documents reaching it inside a packaged, LaunchServices-
  started `.app` via `launchctl setenv KIRA_G1_BLANK 1`.

**The fix — delete.** Remove `apps/kira-studio/blank/` (directory and `index.html`), the
`//go:embed blank/index.html` + `blankAssets` declaration (`main.go:56-61`), the `KIRA_G1_BLANK`
branch and the now-unused `io/fs` and `os` imports from `main.go`, and collapse `assetHandler()`
into the single `application.AssetFileServerFS(assets)` call at its one call site (`main.go:217`).
Update `apps/kira-studio/README.md:26-27` to name only `cmd/g1measure/`, and add one line to
`docs/PERF.md` §2.3 recording that configuration (1)'s scaffold was removed in P29 and what would
be needed to rebuild it (a fresh static page against the current `-names` bindings).

**`cmd/g1measure` stays** — see §4.

### 2.3 F3 — `AppService.Info()` reports a Wails version this build does not use

`internal/bridge/app.go:32` returns a string literal:

```go
Wails: "v3.0.0-beta.15",
```

`go.mod:30` pins `github.com/wailsapp/wails/v3 v3.0.0-beta.16`, and `package.json` pins
`@wailsio/runtime` at `3.0.0-beta.16`. P19's bump moved the dependency and left this literal
behind. It is small, but it is a shipped surface reporting a false fact about the build — precisely
the kind of thing a production-readiness audit exists to catch, and the field is the About-adjacent
diagnostic a bug report would quote.

**The fix.** Replace the literal with a value read from the build itself, so it cannot drift again:
`runtime/debug.ReadBuildInfo()`, scanning `bi.Deps` for `github.com/wailsapp/wails/v3` and taking
its `Version` (falling back to `"unknown"` when build info is unavailable, which is the case under
`go test` for some build modes). Note that `-trimpath -buildvcs=false` do **not** strip module
dependency versions from build info, so this works in the packaged binary.

Worth recording alongside it: `app.go:12-15`'s own comment says *"Nothing in the current renderer
reads AppInfo's fields"* — and that is still true (`bridge/control.ts:102` defines `appInfo()`;
grep finds no caller in `frontend/src`). Deleting the whole service would be defensible, but it is
the one method `blank/index.html` calls and the natural place a future About dialog reads from, and
this phase already deletes that page — deleting the service in the same phase would be two
independent scope calls stacked on one commit. **Fix the string, keep the service**, and record the
zero-caller fact here so a later phase can decide deliberately.

### 2.4 F4 — two independent, disagreeing definitions of "is this a dev build?"

The app answers that question two different ways:

| Site | Signal | Value in a packaged `.app` |
|---|---|---|
| `main.go:332` → the View menu's Reload/OpenDevTools (`shell/menutemplate.go:84-89`) | `app.Env.Info().Debug` — Wails' own, driven by the `production` build tag the packaging path always passes | `false` |
| `internal/logging/log.go:64-67` → whether every log record is also mirrored to stderr | `config.IsDev()` (`config/env.go:13-22`) — `KIRA_DEV` env override, else "is the executable path inside `.app/Contents/MacOS`?" | usually `false`, but see below |

`config.IsDev()` has three properties worth naming:

- It **fails open**: `os.Executable()` erroring returns `true` (`env.go:18-20`).
- It is a **path heuristic**. A packaged binary invoked from outside its bundle layout, or a bundle
  relocated in a way that changes that substring, reads as a dev build.
- Its `KIRA_DEV` override is an env var that re-enables dev behaviour on a shipped binary.

The *consequence* today is mild — a packaged app launched from Finder has nowhere for stderr to go,
so the worst case is duplicated writes, not a leak; and the log content itself is disciplined (§4).
This is a consistency and correctness finding, not a security one, and should be written up as
such.

It is also worth saying why the divergence exists rather than treating it as an oversight:
`logging.Init()` runs at `main.go:77`, long before `application.New` at `main.go:193`, so
`app.Env.Info().Debug` genuinely is not available to it. That is a real ordering constraint, not
sloppiness.

**The fix.** Give both sites one definition that is available at any time and cannot be flipped at
runtime: a build-tag constant, mirroring how the rest of the build already works.

- New `internal/config/prod.go` — `//go:build production` → `const isProductionBuild = true`
- New `internal/config/prod_default.go` — `//go:build !production` → `const isProductionBuild = false`
- `config.IsDev()` becomes: `if isProductionBuild { return false }` — unconditionally, with **no**
  `KIRA_DEV` escape hatch in a production build — then the existing `KIRA_DEV` override, then
  `true`. The `os.Executable()` path-sniffing heuristic is deleted outright.

This removes the fail-open branch, removes the heuristic, makes `KIRA_DEV` inert in exactly the
build where it should be, and keeps `KIRA_DEV=1` working for this Linux sandbox (which is why the
override exists — `env.go:11-12`). `main.go:332` can keep reading `app.Env.Info().Debug` for the
menu (it is the same tag, and it is the idiomatic Wails read), but the two now provably agree in
every shipped build. `internal/shell/menu_wails_test.go:37` passes `IsDev` explicitly and is
unaffected.

### 2.5 F5 — `KIRA_INSECURE_SECRETS=0` *enables* the insecure fallback

`internal/secrets/cipher.go:131-135`:

```go
case "linux":
	if insecureEnv != "" { … return Status{Available: true, Backend: BackendBasicText, InsecureFallback: true}, sum[:] }
```

The test is "set to anything non-empty", so `KIRA_INSECURE_SECRETS=0` and `=false` both switch on
obfuscation-under-a-hardcoded-key (`cipher.go:27`). `config.IsDev()` in the same tree treats `"0"`
and `"false"` as off (`env.go:15`); a user who has learned that convention from one variable will
be wrong about the other, and wrong in the unsafe direction.

**Severity: low, and honestly so.** The product ships macOS only, and `probe`'s `darwin` branch
(`cipher.go:125-130`) never consults `insecureEnv` at all — so on the shipped platform this
variable is structurally inert, which `AGENTS.md` already states and
`tests/ui/secrets.spec.ts`'s "keychain available" scenario already guards. This is a
consistency fix on a developer-facing path, not a shipped vulnerability, and should be described
that way rather than dressed up.

**The fix.** One line: `if insecureEnv != "" && insecureEnv != "0" && insecureEnv != "false"`.
`internal/secrets/cipher_test.go` has **no** test for `probe` today — it calls it only as a helper
to build a cipher (`cipher_test.go:19`). This is one of the few places `AGENTS.md`'s unit-test bar
is met on its own terms (a decision table whose *unsafe* branch is the one being changed), so add a
small table test over `probe`'s three `goos` branches and the `""`/`"0"`/`"false"`/`"1"` inputs.

### 2.6 F6 — the op log persists raw adapter error text to disk, and nothing has ever verified it cannot carry a password

**What the mechanism is.** `internal/adapterhost/host.go:146-161` builds an `op:end` payload whose
`Error` field is `err.Error()` — the driver's error string, verbatim, with no filtering.
`internal/oplog/wire.go:161-179` forwards it, and `internal/storage/repos/ops.go:16-18` writes it
into the `op_log` table's `error` column in `~/.kira-studio/kira.db`, where it stays for
`advanced.opLogRetentionDays` (default 30). Adapter `mapError` implementations pass driver text
through unchanged — e.g. `internal/adapters/mongo/errors.go:21`, `message := err.Error()`.

The connection config reaching an adapter carries a live password: `injectURIPassword`
(`internal/connections/uri.go:44-70`) puts it back into the URI before `Connect`.

**What is and is not known.** No leak was observed. The credential-handling around this is
otherwise careful — `stripURIPassword` keeps the password out of the stored connection row,
`internal/connections/service.go:380/394/397` log reveal events by connection *id* only and never
the secret, and none of the ~40 `slog` call sites across `internal/` interpolates a config value.
But **no test anywhere asserts that a failed connect's error text does not contain the password**,
and the question is genuinely adapter-and-driver-specific (a URI-parse or option-validation error
that echoes its input is the realistic shape). Listing this as a confirmed leak would be
manufacturing a finding; listing it as an unverified invariant on a path that writes to disk for 30
days is accurate.

**The fix — verify first, and get the verification nearly for free.** `AGENTS.md` exempts the
adapter conformance suites from the unit-test bar and says to extend the complete suite's own
harness rather than build a parallel mechanism. That harness is
`internal/adapters/testsupport/matrix.go`'s `RunMatrix`, it already receives the resolved `cfg`,
and every adapter's `authmatrix_test.go` already contains wrong-password cases (e.g.
`postgres/authmatrix_test.go:132-134`, `"superuser, wrong password"`). So:

- In `RunMatrix`'s failure branch (after `matrix.go:117`'s `err == nil` check), add one assertion
  that runs for **every** failing case in **every** adapter:
  ```go
  if p := cfg.Password; p != nil && *p != "" && strings.Contains(err.Error(), *p) {
      t.Errorf("Connect error text contains the connection password verbatim")
  }
  ```
  plus the same test against the password extracted from `cfg.URI` when the case is URI-mode. The
  failure message must **not** print the error — printing it would put the credential in CI logs.
- Ten adapters × their whole wrong-password/least-privilege permutation set, from ~12 lines in one
  file, under the already-opt-in `KIRA_TEST_MATRIX=1` (`scripts/test-matrix.sh`).

**Then decide.** If the run is clean, this finding closes as "verified, no redaction layer needed,
and now guarded against regression" — which is a genuinely better outcome than adding a redactor
nobody can justify. If any adapter fails, the fix is a single scrubbing pass applied at the
`adapters.New(...)` boundary (one place, all adapters), and that becomes its own follow-up commit
with real evidence behind it. Do not build the redactor speculatively.

### 2.7 F7 — `scripts/verify-packaging.sh` has no guard for any of the above

The script is the repo's existing home for "this property must hold of what ships" (S1: no updater
dependency; S2: no updater code; S5: the package script still runs the DMG task; A1/A3/A5/N2/A4/N3
over the artefacts). Every finding in §2.1-§2.4 is exactly that shape, and none is covered — which
is *why* `__kiraGridEngine` survived to be deleted by hand rather than being caught.

**The fix.** Two static checks, alongside S6 from §2.1:

- **S7 — no un-gated debug global.** `frontend/src/main.ts` must not assign `window.__kira*` outside
  an `if (__KIRA_DEBUG_HOOKS__)` block. Cheap, robust form: assert the count of
  `^\s*window\.__kira` lines in `main.ts` equals the count inside the gated block, or more simply
  assert `main.ts` contains `if (__KIRA_DEBUG_HOOKS__)` and that no `window.__kira` assignment
  appears before it. Fails loudly when the next hook is added at module scope.
- **S8 — no dev-mode env branch in shipped Go.** Assert `apps/kira-studio/main.go` contains no
  `os.Getenv` call at all (true after §2.2's deletion). This is a precise, low-false-positive
  invariant for the app's own entry point, and it is the check that would have caught
  `KIRA_G1_BLANK` five phases ago.

Both are static, both run on Linux and macOS, both follow the file's "every check runs, one run
reports everything" contract, and both belong in `docs/PACKAGING.md`'s check-ID table.

---

## 3. Findings — documentation and comments the SlickGrid cutover left behind

Separated from §2 because none of it ships, but all of it is in scope for "what the SlickGrid work
left behind."

### 3.1 `docs/PERF.md` still documents the deleted `__kiraGridEngine` switch

Three live instructions tell a reader to type a global that no longer exists:

- `docs/PERF.md:319` — *"behind `window.__kiraGridEngine === 'slick'`, mounted by
  `views/grid/DataView.vue` instead of the incumbent `DataGrid.vue`"*
- `docs/PERF.md:347` — protocol step 3: *"`window.__kiraGridEngine = 'slick'`, then reload the tab"*
- `docs/PERF.md:546` — the §2.1d protocol header repeats it

`DataGrid.vue` does not exist, `@tanstack/vue-virtual` was retired (commit `402f42e`), and the flag
was deleted at Pass B's cutover. Anyone following §2.1c today runs both "runs" against the same
engine and reports a meaningless A/B.

**The fix.** These are historical records of a completed comparison, and `docs/v1.1/README.md`'s
discipline is that plan docs are never retro-edited — but `docs/PERF.md` is *not* a plan doc; it is
a live protocol document that `docs/ARCHITECTURE.md` treats as current. Add a dated note at the
head of §2.1c and §2.1d marking the two-engine protocol as **superseded — there is one engine
now**, keep the recorded numbers and reasoning intact (they are the evidence for the cutover), and
rewrite the *steps* that are still meant to be executable (§2.1a's fling protocol, and the
`__kiraGridTuning` A/Bs in §2.1c step 6 / §2.1d / §2.1e / §2.1f, all of which still work) to drop
the engine-switch step. Add one sentence naming the build a reader must use, now that §2.1 gates
the hooks: `wails3 task dev`, or a `DEV=true` native build — **not** a packaged `.dmg`.

### 3.2 `apps/kira-studio/README.md` misstates what ships

Covered in §2.2: line 26-27 claims `blank/` is not part of the shipped app while `//go:embed` puts
it in the binary. Fixed by the same commit that deletes it.

### 3.3 Comment rot — ~40 comments cite files the cutover deleted

`DataGrid.vue` (deleted) and `ConsoleResultGrid.vue`'s *tabular* branch (deleted; the file itself
survives as the document/non-tabular result view and is still imported at `ConsoleView.vue:24`) are
cited as if live across `views/shared/page/{columns,search,store,visibleRows}.ts`,
`views/shared/{eventCoords.ts,document/DocumentRow.vue,celleditor/CellEditorView.vue}`,
`views/shared/slick/{dataSource,kiraSlickGrid,scrollTrace}.ts`, `views/keyvalue/KeyValueView.vue`,
`views/stream/StreamView.vue`, `views/definition/ConstraintsSection.vue` and
`packages/shared/domain/tree.ts`.

**Severity: cosmetic**, and worth saying so — none of it affects behaviour, and most of the
comments carry real reasoning that must survive. **The fix is a referent rewrite, not a deletion**:
change *"mirrors `DataGrid.vue`'s own `rowAtDisplayPosition`"* to name `SlickGridHost.vue` /
`views/grid/slick/dataSource.ts` where the logic actually lives now, and where the referent is
genuinely historical (*"the incumbent tanstack grid had no equivalent hazard"*) mark it as history
rather than pretending it is current. Per `AGENTS.md`'s comments rule, any comment that only
restates what the code shows gets deleted instead of rewritten.

This is the lowest-priority item in the phase and should be the last commit, so that abandoning it
under time pressure costs nothing.

---

## 4. Keep — with the justification, one per construct

Everything in this table was found, considered, and deliberately left alone. The justification is
the deliverable; a bare "fine" is not one.

| Construct | Where | Why it stays |
|---|---|---|
| `__kiraScrollTrace` / `__kiraGridTuning` **in dev builds** | `main.ts:225-226`, `scrollTrace.ts`, `kiraSlickGrid.ts:64-90` | The only instrument in this repo that can observe a *real* WebKit momentum fling — `tests/ui`'s harness drives `scrollTop` from the main thread and so structurally cannot reproduce the user's symptom (`scrollTrace.ts:3-13`). `docs/PERF.md` §2.1a-§2.1f are built on it, and several A/Bs there are explicitly still unrun. It is reachable only through DevTools, DevTools exists only in a dev build (`menutemplate.go:84-89`), and §2.1 makes that alignment structural rather than incidental. Removing it would delete the repo's only real-hardware scroll instrument to close a hole the same commit closes anyway. |
| `scrollTrace.ts`'s hot-path `note*` calls | `scrollTrace.ts:189/198/214/226/244`, called from `SlickGridHost.vue:616` and `kiraSlickGrid.ts:332/483` | Every one returns immediately on `if (!recording) return`. The residual cost in a production build is one boolean load per scroll event — correctly gated already, and gating it further would need the define in more TS programs (§2.1) for no measurable gain. |
| `scrollTrace.stop()`'s clipboard write | `scrollTrace.ts:359-364` | Only reachable after an explicit `start()`, wrapped in `try/catch` with a `.catch(() => {})`, and documented as the way to get JSON out of a build whose inspector will not attach. It cannot fire unasked. |
| `console.warn` at `scrollTrace.ts:352` | same | The only `console.*` in the frontend. It is the operator-facing error message of an interactive tool, in a module that only exists in dev/test builds after §2.1. Removing it would make `stop()` fail silently. |
| `//go:build server` (`-tags server`) | Wails-owned; used by `tests/e2e-real/fixtures.ts:68`, `playwright.config.ts:40` | **No repo source is gated on it** — verified: the tag appears in this repo only in comments and build invocations. It selects Wails' own headless platform, is opt-in at *compile* time, and the packaging path passes `-tags production` and never `server`. It is also the only way to get a real bound-call surface under test in a sandbox with no display (`AGENTS.md`). A packaged build cannot be talked into it. |
| `KIRA_INSECURE_SECRETS` | `secrets/cipher.go:40/131` | `probe`'s `darwin` branch (`cipher.go:125-130`) never reads it — on the only platform this app ships on, the variable is structurally inert, so even a machine with it globally exported cannot weaken the Keychain. Without it on Linux, secret storage is *unavailable* and a password-bearing save fails visibly rather than silently degrading. That is the correct posture. (§2.5 fixes only the `"0"` parsing.) |
| `KIRA_HOME` | `config/paths.go:11-14` | A user-facing data-directory override, not a dev flag; every Go test and both Playwright real-backend fixtures depend on it for isolation, and `tests/e2e-real/fixtures.ts:130-133` refuses to run unless it points under the OS tmpdir. Redirecting your own app's data directory grants no authority you did not already have. |
| `KIRA_IPC_FIXTURES`, `KIRA_TEST_MATRIX`, `KIRA_COMPAT_IMAGE_*` | `ipcfixture/write.go:17`, `testsupport/matrix.go:23`, `testsupport/images.go:14` | All three live in packages **no non-test file imports** (verified). They cannot be read by the app because their code is not in the app. |
| `cmd/g1measure` | `apps/kira-studio/cmd/g1measure/` | A separate `main` package: never linked into the app, never embedded, never packaged. `docs/PERF.md:1492-1508` documents it as the *standing* RSS instrument for the status-bar cross-check — unlike `blank/`, it has a live consumer and is not bit-rotted (it reads its process-set needles from `internal/metrics`, per P55 §6.1). Its `fmt.Printf` calls are its output. |
| `frontend/wails/runtime.js` | tracked, 1.5 KB | A Vite import-resolution stand-in for the `/wails/runtime.js` URL the generated bindings import literally. Its own header records that `wails3 dev` serves Wails' real bundle instead, and that `vite.config.ts`'s `external: [/^\/wails\//]` keeps the production bundle from ever reaching it. Correct as written. |
| `debug.Stack()` on adapter/data-frame panic | `adapterhost/host.go:176`, `adapterhost/dataframe.go:73` | The recover boundary that turns a driver panic into a failed op instead of a dead app. A goroutine stack in the app log is the diagnostic that makes such a crash actionable; it carries function names and file paths, not connection state. |
| `settleWindow` / `killGrace` as package `var`s | `preconnect/supervisor.go:39-45` | Lowered by `supervisor_internal_test.go` so two tests do not each cost 2s. Documented as deliberate (P55 §2 D9, following P54 D10), unexported, and unreachable from any shipped path — a test seam, not a runtime knob. |
| `InsecureSkipVerify: true` for `sslmode=require`/`prefer` | `postgres/client.go:81`, `mysqlfamily/client.go:104`, `redis/client.go:80`, `mongo/client.go:50` | This is **libpq's actual semantics**, not a weakened check: `require` means "encrypt, do not verify"; `verify-full` is the mode that verifies, and all four adapters implement it with a real verifying `tls.Config` (`postgres/client.go:83` sets `ServerName`). Each site carries a `//nolint:gosec` with the reason. Every adapter also *fails loudly* on an unrecognised `sslmode` rather than falling back to plaintext (`postgres/client.go:85-89` and siblings) — the genuinely dangerous behaviour, correctly avoided. `redis/client_test.go:52-56` already regression-guards `verify-full`. |
| 462 `data-testid` attributes across 68 components | `frontend/src/**` | They ship, and they should. Stripping them needs a compiler plugin (a new dependency, `AGENTS.md`'s library bar applies) and would change the DOM that `tests/ui` — which runs the production build — asserts against, trading a real regression risk for zero security benefit and a few kilobytes. `tests/ui/support/mockRuntime.ts`'s whole request-interception layer is keyed on this markup. |
| `log.Fatalf` × 8 in `main.go` | `main.go:75-108`, `:342-356` | Each is a startup step with no possible recovery and no window to report into yet (`EnsureLayout`, `logging.Init`, `storage.Open`, repo construction, settings read, window list/create, `app.Run`). Failing loudly with a named cause beats a half-initialised app. |
| The app log's content | ~40 `slog` sites across `internal/` | Every one was read. They log ids, counts, scopes, durations, error *kinds* and driver error text — never a password, never a full DSN, never a settings value. Retention is bounded (`logging/sweep.go`, fixed 30 days by mtime, deliberately *not* the user's op-log setting), files are `0600` in a `0700` directory (`logging/log.go:43/60`). §2.6 is the one open question about that content, and it is about adapter error strings, not about these call sites. |
| `wails3 dev` port `9245`, `WAILS_VITE_PORT` | `vite.config.ts:13-19`, `Taskfile.yml` | Dev-server config in build files, bound to `127.0.0.1`, never read by shipped code. |

---

## 5. Implementation order

One phase, sequential, one commit per item — `AGENTS.md`'s conventional-commit format. Fast checks
(`bun run lint`, `bun run typecheck`, `go build ./apps/kira-studio/internal/...`) per commit; the
expensive suites once at the end (§6).

| # | Commit | Files |
|---|---|---|
| **C1** | `chore(shell): delete the P52 gate-G1 blank-page scaffold` (§2.2) | delete `apps/kira-studio/blank/`; `main.go` (drop `//go:embed blank/index.html`, `blankAssets`, the `KIRA_G1_BLANK` branch, `assetHandler()` itself, and the `io/fs`+`os` imports); `apps/kira-studio/README.md:26-27`; one note in `docs/PERF.md` §2.3 |
| **C2** | `fix(bridge): report the Wails version from build info, not a stale literal` (§2.3) | `internal/bridge/app.go` |
| **C3** | `refactor(config): derive dev mode from the production build tag` (§2.4) | new `internal/config/prod.go`, `internal/config/prod_default.go`; `internal/config/env.go` (delete the `os.Executable` heuristic and the fail-open branch). `internal/config/` has no test file today; a two-line `IsDev()` needs none under `AGENTS.md`'s bar |
| **C4** | `fix(secrets): treat KIRA_INSECURE_SECRETS=0/false as off` (§2.5) | `internal/secrets/cipher.go:132`; a new `probe` table test in `internal/secrets/cipher_test.go` |
| **C5** | `test(adapters): assert a failed connect never echoes the password` (§2.6) | `internal/adapters/testsupport/matrix.go` (`RunMatrix`'s failure branch, plus a URI-mode password extraction helper) |
| **C6** | `build(frontend): gate the Playwright debug hooks behind a build-time flag` (§2.1) | `frontend/vite.config.ts` (function form + `define`); `frontend/src/env.d.ts`; `frontend/src/main.ts:225-268`; `frontend/package.json`; root `package.json`; `apps/kira-studio/tests/e2e-real/fixtures.ts:65` |
| **C7** | `build(packaging): guard the shipped bundle against debug hooks and env branches` (§2.1, §2.7) | `scripts/verify-packaging.sh` (S6, S7, S8); `docs/PACKAGING.md`'s check-ID table |
| **C8** | `docs(perf): mark the two-engine A/B protocols superseded` (§3.1) | `docs/PERF.md` §2.1c/§2.1d headers, and the executable steps in §2.1a/§2.1c-§2.1f |
| **C9** | `docs: retarget comments that still cite the deleted tabular grid` (§3.3) | the ~14 frontend files listed in §3.3 |

**Ordering rationale.** C1-C5 are independent and touch only Go; each is safe alone. C6 is the
largest behavioural change and must land **before** C7, whose S6/S7 checks assert the property C6
creates. C8 must land after C6, because it has to name the build a reader needs now that the hooks
are gated. C9 is last and is the one item that can be dropped without consequence.

---

## 6. Verification plan

1. **Per commit** — `bun run lint`, `bun run typecheck`, `go build ./apps/kira-studio/internal/...`
   (cgo-free, fast — `AGENTS.md`).
2. **After C5** — `KIRA_TEST_MATRIX=1 sh scripts/test-matrix.sh` against real containers (pulled
   via `mirror.gcr.io` per `AGENTS.md`). This is the run that answers §2.6. Record the verdict in
   this document's own §2.6 as "verified clean" or as a named adapter failure — the phase is not
   complete with the question open.
3. **After C6** — `bun run test:ui` and `bun run test:ipc:fe` must pass **unchanged**. Every spec in
   §2.1's table exercises a hook, so a green run is the direct proof the flag reaches the test
   build. `bun run test:e2e-real` (sqlite scenario, Docker-free) proves `fixtures.ts` was updated.
4. **After C6, the negative proof** — `bun run build` (no `KIRA_DEBUG_HOOKS`), then grep
   `apps/kira-studio/frontend/dist/assets/*.js` for `__kiraCount`, `__kiraCacheStats`,
   `__kiraRetention`, `__kiraRetainedBytes`, `__kiraTreeConnectionIds`: **zero hits**. Then
   `bun run build:test` and grep again: **all five present**. Two greps, both decisive; no bundle
   measurement is taken, because §2.1 already records that the decision does not turn on size.
5. **After C7** — `bun run verify:packaging` on Linux (static checks S1/S2/S5/S6/S7/S8 run;
   artefact checks print "skipped" and pass, per the script's own contract). Then deliberately
   break each new check once — run `bun run build:test` then `verify:packaging` (S6 must fail);
   temporarily hoist one `window.__kira` assignment above the gate (S7 must fail); add a throwaway
   `os.Getenv` to `main.go` (S8 must fail). A guard nobody has watched fail is not a guard.
6. **On real macOS hardware, once, at the end** — build and package (`bun run package`), confirm
   the app launches, and confirm from the packaged app's own webview that `window.__kiraCount` is
   `undefined` while the app is fully functional. This is the only claim in the phase that a sandbox
   cannot settle: `AGENTS.md` records that `/wails/runtime` is unreachable over plain HTTP from a
   desktop build on Linux. Also confirm, in a `wails3 task dev` build, that
   `__kiraScrollTrace.start()` still works from View → Open DevTools — the property §4 justifies
   keeping.

---

## 7. What this phase deliberately does not do

- **It does not delete any instrumentation.** §2.1 stops shipping the hooks; every hook, and every
  accessor feeding it, stays in source and stays available to `tests/ui` and to a dev build. A
  phase that deleted them would have to delete `tests/ui/leaks.spec.ts`, `perf.spec.ts`,
  `scroll-trace.spec.ts` and half of `slick-grid.spec.ts` with them.
- **It does not build a log/error redactor.** §2.6 verifies first. Building a scrubbing layer with
  no evidence any driver echoes a credential would be exactly the speculative infrastructure
  `AGENTS.md` warns against, and it would add a silent failure mode (a redactor that mangles a
  legitimate error) in exchange for a hypothetical.
- **It does not strip `data-testid`.** §4 gives the reasoning: new dependency, real regression risk
  against a suite that runs the production build, no security benefit.
- **It does not delete `AppService.Info()`** despite it having zero renderer callers (§2.3). That is
  a separate scope call and is recorded here so a later phase can make it deliberately.
- **It does not touch adapter TLS behaviour.** `InsecureSkipVerify` for `sslmode=require`/`prefer`
  is libpq's own semantics, correctly implemented, with `verify-full` genuinely verifying (§4).
- **It does not add a `docs/v1.1/SPEC.md` row.** That table ends at P22; P23-P27 and P30 all landed
  as plan files without one, and this phase follows the established practice rather than changing it
  unilaterally.
- **It does not re-run any `docs/PERF.md` A/B.** C8 corrects the *protocol text*; whoever next has
  real hardware runs the protocol.

---

## 8. Sources

Read in full for this plan, at `f4a81d6`:

- `AGENTS.md` (process rules, and the `KIRA_INSECURE_SECRETS` / `-tags server` / bindings sections)
- `apps/kira-studio/main.go`, `apps/kira-studio/README.md`, `apps/kira-studio/blank/index.html`
- `apps/kira-studio/internal/config/{env,paths}.go`, `internal/logging/{log,sweep}.go`,
  `internal/secrets/cipher.go`, `internal/shell/{security,menutemplate}.go`,
  `internal/bridge/app.go`, `internal/adapterhost/host.go`, `internal/oplog/wire.go`,
  `internal/storage/repos/ops.go`, `internal/connections/{service,uri}.go`,
  `internal/preconnect/supervisor.go`, `internal/adapters/testsupport/matrix.go`,
  `internal/adapters/{postgres,mongo,redis,mysqlfamily}/client.go`,
  `internal/adapters/mongo/errors.go`, `internal/ipcfixture/write.go`
- `apps/kira-studio/frontend/{index.html,vite.config.ts,package.json}`,
  `frontend/src/{main.ts,env.d.ts}`, `frontend/src/views/shared/slick/{scrollTrace,kiraSlickGrid}.ts`,
  `frontend/src/views/grid/SlickGridHost.vue`, `frontend/wails/runtime.js`
- `apps/kira-studio/{Taskfile.yml,build/Taskfile.yml,build/darwin/Taskfile.yml}`,
  `package.json`, `scripts/verify-packaging.sh`, `.github/workflows/release.yml`, `.gitignore`
- `apps/kira-studio/tests/e2e-real/fixtures.ts`, `tests/ui/global.d.ts`, and the hook call sites in
  `tests/ui/{leaks,perf,budgets,scroll-trace,slick-grid}.spec.ts`, `tests/ui/support/measure.ts`
- `docs/PERF.md` (§2.1a-§2.1f, §2.3, §2.4), `docs/PACKAGING.md` (§2's build path, §3's check
  results), `docs/v1.1/README.md`, `docs/v1.1/SPEC.md`,
  `docs/v1.1/plans/P27-active-filter-indicator-color.md` (structure)
