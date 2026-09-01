# Packaging: local build and verification

See the [README](../README.md) for what the app is and how to run it.

Kira Studio ships as an unsigned (ad-hoc), local, arm64-only macOS build in v1 — see SPEC.md §1/§3.

Packaging is Wails v3's own [Task](https://taskfile.dev)-based pipeline (P57): config lives in
`apps/kira-studio/build/config.yml`, the task graph in `apps/kira-studio/Taskfile.yml` and `apps/kira-studio/build/darwin/Taskfile.yml`,
and the entry points in the repo-root `package.json`'s `scripts` plus `scripts/sign-bundle.sh` and
`scripts/verify-packaging.sh`. There is no `electron-builder.yml`, no asar, and no native-module ABI
rebuild step — all deleted with Electron in P57 M7. **As of P58f M10, there is no vendored Node
runtime and no bundled Node engine either** — `scripts/vendor-node.sh` is deleted outright, and
every database adapter is served in-process by the Go binary itself.

## 1. Building locally

Requires macOS arm64, Bun, Go (`go.mod`: 1.25.0), and Xcode command-line tools. Everything else —
`bun install`, `go mod download`, and the `wails3` CLI at the version `go.mod` pins
(`v3.0.0-beta.15`) — installs itself:

```sh
bun run package                 # installs everything first, then wails3 task darwin:package:dmg, then scripts/sign-bundle.sh
```

`bun run package` and `bun run dev` both run `bun run setup` first (wired as `prepackage`/`predev`),
which is `scripts/install-deps.sh` (`bun install` + `go mod download`) followed by
`scripts/wails-dev-setup.sh` (the pinned `wails3` CLI + generated bindings). Both scripts are
idempotent and do only what is missing — `sh scripts/wails-dev-setup.sh` installs the pinned wails3
and generates the Wails bindings (`wails3 generate bindings -b -i -ts -names` — gitignored, and
`apps/kira-studio/frontend/src/bridge/*.ts` imports them, so `bun run build` fails without them). To
run just the install step (e.g. to warm up a machine before writing code), use `bun run setup`.
`apps/kira-studio/{bin,frontend/dist,frontend/bindings}` are gitignored (`apps/kira-studio/.gitignore`).

Expected artifacts (nothing lands in `dist/` or `out/` any more):

- `apps/kira-studio/bin/Kira Studio.dmg` — **the shipped artifact** (P10): the styled, ad-hoc-signed
  disk image holding the app and an `/Applications` shortcut to drag it onto.
- `apps/kira-studio/bin/Kira Studio.app` — the packaged, ad-hoc-signed bundle the image is built
  from. Still produced, and still what you run locally; it is simply no longer what ships.
- `apps/kira-studio/bin/Kira Studio` — the bare Go binary the bundle is assembled around.

No `.zip` is produced anywhere any more — the release workflow uploads the `.dmg` (§7).

**Bundle layout** (`apps/kira-studio/build/darwin/Taskfile.yml`'s `create:app:bundle`):

```
apps/kira-studio/bin/Kira Studio.app/
  Contents/
    Info.plist                       CFBundleName/CFBundleExecutable "Kira Studio",
                                     CFBundleIdentifier com.kirathecat.kira-studio
    Resources/
      icons.icns                     the only icon the bundle carries; no Assets.car ships (§6)
    MacOS/
      Kira Studio                    the compiled Go binary — the literal filename, space included,
                                     must equal CFBundleExecutable or the bundle neither launches
                                     nor codesigns
```

There is no `runtime/` subtree any more (P58f M10) — the compiled Go binary is the whole app.
`create:app:bundle` used to assert `runtime/{node,engine}` existed and copy that tree in before
signing; both the guard and the copy step are gone, since there is nothing left to vendor.

**Dev loop:** `bun run dev` (`cd apps/kira-studio && wails3 task dev`) launches a real native window
with hot reload — the Wails task's own dev-mode config drives the frontend build via
`common:dev:frontend`; `predev` runs `wails-dev-setup.sh` first. `wails3 task darwin:run` builds and
runs a `Kira Studio.dev.app` from `build/darwin/Info.dev.plist` without packaging.

## 2. Config summary

**`apps/kira-studio/build/config.yml`** — the source Wails generates build assets from:

- `info.productName: "Kira Studio"`, `info.productIdentifier: "com.kirathecat.kira-studio"` (P57 D11:
  the Wails build is the only build now, so P51/P52's deliberately-distinct `…-shell` identifier is
  gone), `info.companyName`, and `info.version` — **the app's version, and the only place one is
  defined** (see "Where the version comes from" below).
- `dev_mode` drives `wails3 dev`: watched extensions, ignore lists, and the three dev commands.
- Editing `info` requires `wails3 task common:update:build-assets` to regenerate the assets, which
  overwrites hand edits under `build/` — so `Info.plist` below is regenerated, not hand-maintained.

**`apps/kira-studio/build/darwin/Info.plist`** — `CFBundleName` and `CFBundleExecutable` are both `Kira Studio`,
`CFBundleIdentifier` is `com.kirathecat.kira-studio`, `CFBundleVersion`/`CFBundleShortVersionString`
`0.0.0` (the scaffolded value; the *bundle's* copy is stamped at packaging time, below),
`CFBundleIconFile` `icons`, `LSMinimumSystemVersion` `14.0.0`. That floor is hand-narrowed
from Wails' template default of `12.0.0`, and matches the build's `MACOSX_DEPLOYMENT_TARGET`/`CGO_*`
flags and the README's macOS 14+ product claim. The template hardcodes `12.0.0`, so a
`wails3 task common:update:build-assets` run reverts both plists — re-narrow them after regenerating.
The floor is 14 rather than 13 because Go 1.27 builds its own objects for macOS 13 minimum: a lower
`-mmacosx-version-min` only earns a linker warning that the object file was built for a newer macOS
than is being linked.

### Where the version comes from

`build/config.yml`'s `info.version` is the single source, and everything else is stamped from it at
build time:

| Consumer | How it gets there |
|---|---|
| The Go binary | `apps/kira-studio/Taskfile.yml`'s `APP_VERSION` reads `config.yml`; `BUILD_FLAGS` links it in with `-ldflags "-X …/internal/buildinfo.Version=<version>"`, in both the dev and production branches |
| The About dialog | `main.go`'s `application.Options.Description`. The macOS About item is the `application.About` role (`internal/shell/menutemplate.go`), which Wails renders with its own dialog — name, description, icon, and **no version field of its own** — so the version rides in the description |
| `AppService.Info()`'s `appVersion` | reads the same `buildinfo.Version`. Nothing in the renderer calls it today; it is API surface, not a display path |
| `Contents/Info.plist` (`CFBundleShortVersionString`, `CFBundleVersion`) — what Finder's Get Info and the version column read | `create:app:bundle` runs PlistBuddy over the bundle's *copy* after `cp`. The checked-in plist keeps its scaffolded `0.0.0`: it is a generated file, and a hand-edit there would not survive `common:update:build-assets` anyway |

An unlinked build — `go run`, `go test`, `go build ./...` by hand — reports `internal/buildinfo`'s own
literal, `0.0.0-dev`, which is how you can tell one from a real build. `verify-packaging.sh`'s **A5**
asserts the packaged bundle's `CFBundleShortVersionString` equals `config.yml`'s `info.version`, so a
bundle assembled around a stale plist, or one where the PlistBuddy step silently skipped (its guard is
`-x /usr/libexec/PlistBuddy`, absent off macOS), fails the check rather than shipping quietly.

The root `package.json`'s `version` is **not** it — that is npm metadata for a private, unpublished
workspace root, and nothing in the app or the build reads it.

**`apps/kira-studio/Taskfile.yml` + `apps/kira-studio/build/darwin/Taskfile.yml`** — the task graph `bun run package` drives:

| Task | What it does |
|---|---|
| `darwin:package:dmg` | what `bun run package` invokes: `deps: package`, then `create:dmg` |
| `create:dmg` | `wails3 tool package --format dmg` over the built `.app` — background `darwin/dmg-background.png`, volume icon *and* file icon `darwin/icons.icns`, window 540×380. The tool adds the `/Applications` symlink and places the two icons itself. macOS only (`platforms: [darwin]`) |
| `darwin:package` | `deps: build`, then `create:app:bundle`. Still callable on its own when all you want is the bundle |
| `darwin:build` → `build:native` | on macOS: `deps` = `common:go:mod:tidy`, `common:build:frontend`, `common:generate:icons`; then `go build -tags production -trimpath -buildvcs=false -ldflags="-w -s" -o bin/Kira Studio` with `GOOS=darwin CGO_ENABLED=1 GOARCH=$ARCH` (host arch unless overridden) and `MACOSX_DEPLOYMENT_TARGET=14.0` |
| `darwin:build` → `build:docker` | off macOS only: cross-compiles in the `wails-cross` Docker image. Never exercised in this repo (§5) |
| `create:app:bundle` | `rm -rf`s any previous bundle, then makes `Contents/{MacOS,Resources}` and copies `icons.icns`, `Assets.car` (if one is ever added back), the binary and `Info.plist`, then `codesign:adhoc` on macOS (`codesign:skip` elsewhere). The `rm -rf` matters: every other step only copies *into* the bundle, so without it a resource an earlier build produced outlives the build that stopped producing it |

`common:build:frontend` runs the same `bun run build` the checklist above already ran; Task's
`sources`/`generates` up-to-date checking makes the second invocation a no-op against fresh output, so
building the renderer first is cheap insurance, not duplicated work.

**`scripts/sign-bundle.sh`** — ad-hoc signing, run by `bun run package` after the Task pipeline. macOS
only; exits 1 elsewhere.

```sh
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
```

One deep sign over the whole bundle is all that is left (P58f M10) — there is no nested vendored Node
binary or Kafka native module to sign individually any more, so the two `codesign --force --sign -`
calls that used to precede the deep sign are gone with them. `create:app:bundle` already ran its own
`codesign --force --deep --sign -`; `sign-bundle.sh` re-signs and then *verifies* — redundant but
harmless, and it is the script a human or CI actually invokes.

The `.dmg` is signed there too, and the order is what makes that work: `create:app:bundle` signs the
bundle *before* `create:dmg` copies it into the image, so the copy inside is already signed and
`sign-bundle.sh`'s later re-sign of the outer `.app` — which cannot reach inside a built image — does
not need to. The image itself gets a plain `codesign --force --sign -`; `--deep` is deliberately
absent, since a disk image is a flat file with no bundle tree to recurse into.

**Deliberately present in the Taskfile but not wired into any `package.json` script:** `darwin:sign`
and `darwin:sign:notarize` (`wails3 tool sign [--notarize]`, Developer ID) and
`darwin:build:universal`/`package:universal`. Signing/notarization are deferred past v1 by
SPEC.md §3; the app is arm64-only, so a universal binary has nothing to be universal across.

**Keychain consequence of ad-hoc signing.** Credentials are encrypted under an AES-256-GCM key held in
a macOS Keychain generic-password item (`apps/kira-studio/internal/secrets/keyring_darwin.go`, service
"Kira Studio Secrets"). Keychain ACLs are keyed to a stable code-signing identity, which is
exactly what ad-hoc signing defers, so the first launch after installing a new build may show one
"Kira Studio wants to use your confidential information stored in…" prompt; **Always Allow** answers it
permanently for that build. Expected, and the honest cost of deferring signing — not worth working
around with a bundled private key.

## 3. Verification checklist — results from this environment

This environment is **Linux, with no macOS, no `codesign`, and no `/usr/libexec/PlistBuddy`**. Nothing
below is a claim about a real packaged bundle; the layout in §1 is read from `create:app:bundle`, not
observed in one. It is kept as the record of *that* environment: P10 later ran the packaging on real
macOS arm64 hardware, and what that run observed is recorded in §4's own items, not by rewriting the
table below.

| Check | Result |
|---|---|
| `bun run build` (vite → `apps/kira-studio/frontend/dist`) | **pass** — run here this session |
| `bun run typecheck`, `bun run lint` | **pass** |
| `sh scripts/verify-packaging.sh` | **pass** — static checks S1/S2/S5 ran; A1/A3/N2 correctly reported *skipped*, since no `apps/kira-studio/bin/Kira Studio.app` exists here |
| `wails3 task darwin:package` | **not run** — needs macOS (or the untested Docker cross-compile path, §5) |
| `scripts/sign-bundle.sh` | **not run** — `codesign` is macOS-only and the script refuses to run off Darwin |
| Real bundle contents, `Info.plist` values, ad-hoc signatures | **not verified** — no bundle was produced here |
| `.app` on-disk size | **not measured** — expect substantially less than the pre-P58f figure now that there is no ~126 MB vendored `runtime/` tree to carry, likely close to the compiled Go binary's own size alone; not a recorded number |

Not verifiable off macOS (needs a human on real hardware — see §4): code signature checks, Gatekeeper
quarantine behavior, launching the app at all, `~/.kira-studio/` creation, cold-start timing, packaged
RSS, and the `.app` size.

## 4. Human checklist (run on macOS 14+ arm64)

Every item is a pass/fail a human should record here after running it for real. Items 1–3, 10 and 11
are also checked automatically on macOS by the `package-smoke` job in `ci.yml` (§7) — but this list is
only updated from an *observed* run, never from expectation. The items marked **pass (P10)** were
observed on macOS 26.5.2 arm64 while wiring up the DMG; everything still marked *not yet run* needs a
human to launch the packaged app and use it.

1. `bun run package` completes and `sign-bundle.sh` prints `signed and verified`. — **pass**
   (P10, macOS 26.5.2 arm64): printed twice, once for the `.app` and once for the `.dmg`.
2. `codesign -dv --verbose=2 "apps/kira-studio/bin/Kira Studio.app"` reports `Signature=adhoc`. There is no
   nested vendored Node binary to check separately any more (P58f M10). — **pass** (P10):
   `Signature=adhoc`, `Identifier=com.kirathecat.kira-studio`, `TeamIdentifier=not set`.
3. `bun run verify:packaging` passes against the real bundle — i.e. A1/A3/N2 actually execute
   instead of reporting "skipped". — **pass** (P10): all checks passed with both artifacts present,
   so A1/A3/N2 and P10's own A4/N3 all executed.
4. Launching the app shows the workbench with the engine status dot green — "the engine" is this
   process itself now (P58f D11), so there is no vendored runtime for a missing-file check to name;
   a launch failure here is an ordinary Go panic/crash, not a missing-sidecar error. — *not yet run*
5. Gatekeeper: an unsigned, unnotarized build needs right-click → Open, or
   `xattr -dr com.apple.quarantine "/Applications/Kira Studio.app"`. Expected, not a defect. —
   *not yet run*
6. `~/.kira-studio/` is created with `kira.sqlite` and `logs/` on first launch — the real home, since
   `KIRA_HOME` is unset in a packaged run. — *not yet run*
7. Create a connection, expand the tree, open a data tab, scroll, open the cell editor, quit cleanly.
   The View menu has no Reload / Toggle DevTools in a `-tags production` build. — *not yet run*
8. Kafka: connecting is **expected to succeed** in a packaged build — Kafka has been served
   in-process by the native Go adapter since P58e M9, and as of P58f M10 there is no Node engine
   left for a native-module `require()` to fail against even in principle. — *not yet run*
9. Cold start: launch 3 times, discard the first, take the median from the startup log line in
   `~/.kira-studio/logs/`; record against the ≤ 1500 ms target. RSS cross-check: rebuild the
   5-connection/10-tab scenario by hand and sum the app's processes via `ps -o rss=`, against 350 MB —
   expect a materially better number than any pre-P58f measurement, since there is no second
   process's baseline RSS to add on top of the webview and shell any more. —
   *not yet run, see `docs/PERF.md` §3, whose recorded numbers still predate this bundle*
10. Record the `.app` on-disk size (`du -sh`, lever L-D, budget ≤ 300 MB) — expect a large drop from
    any pre-P58f measurement, now that the ~126 MB vendored `runtime/` tree is gone. — **pass**
    (P10): **42 MB** for the `.app`, **16 MB** for the compressed `.dmg` around it, against a
    300 MB budget.
11. The disk image installs the way it looks like it should (P10): it mounts, holds `Kira Studio.app`
    beside an `/Applications` symlink, and carries the app's own icon as both its Finder icon and its
    volume icon. — **partial**: mount, contents, both icons and `Signature=adhoc` on the image were
    verified from the shell; the drag-onto-Applications gesture and how the window *looks* when
    Finder opens it — background, icon placement — still want a human's eyes.

## 5. Off-macOS: what this environment could actually check

Unlike the electron-builder pipeline this replaced — which assembled a complete, inspectable `.app` on
Linux by downloading prebuilt Electron binaries, and only failed at the macOS-only `sips` step for
`dmg` — the Wails pipeline compiles a real Go binary with `CGO_ENABLED=1` against macOS system
frameworks. On Linux that leaves three doors, and none of them was opened here:

- **`build:native`** requires macOS. Not attempted.
- **`build:docker`** (`darwin:build`'s automatic off-macOS branch) needs Docker plus a locally built
  `wails-cross` image (`wails3 task setup:docker`). Not attempted; this repo has never exercised it, so
  it is unverified rather than known-good or known-broken.
- **`codesign`** does not exist off Darwin at all. `create:app:bundle` falls back to `codesign:skip`
  (a printed warning), and `sign-bundle.sh` exits 1 on purpose.

Consequently `scripts/verify-packaging.sh` degrades honestly off macOS: with no bundle it prints one
"skipped A1/A3/N2" note and passes on the static checks alone, and even with a bundle it would skip
A1/A3/N2 for want of `codesign`/`PlistBuddy`. **A green `verify:packaging` on Linux proves only the
static checks (S1/S2/S5), not that any bundle is correct.**

What *is* fully verifiable off macOS: everything that feeds the bundle rather than being the bundle —
the renderer build, typecheck, lint, the Go unit tests, and the static half of `verify:packaging`.

## 6. Known gaps

- **Closed (P57 M7 → P58e M9 → P58f M10, in that order).** The packaging gap started as "Kafka's
  native module was never vendored into the packaged bundle" (P57 M7): `build:engine` marked
  `@confluentinc/kafka-javascript` `--external` and no build step vendored it, so a packaged build's
  Kafka connections would fail at `require()` time. P58e M9 made the gap moot without closing it:
  Kafka went native in Go (`docs/v1/plans/P58e-kafka.md`) and stopped reaching the Node engine child
  at all, so the dead `require()` path was simply never exercised — `sign-bundle.sh` and
  `verify-packaging.sh` kept probing for the native module and printing a harmless "not present" note.
  P58f M10 closed it for real: the Node engine, `build:engine`, and every check that probed for that
  module are deleted outright, not merely dead-code-kept. There is no native-module packaging
  question left to have a gap in.
- **Ad-hoc signature only** (identity `-`). The build is not distributable outside the machine that
  built it, and SPEC.md §3 defers signing/notarization past v1. `wails3 tool sign [--notarize]` is
  available via `darwin:sign`/`darwin:sign:notarize` but is wired into nothing.
- **The DMG is what ships (P10).** `bun run package` runs `darwin:package:dmg`, so a build produces
  the `.app` *and* the styled image around it, and `scripts/sign-bundle.sh` ad-hoc signs both. The
  window is 540×380 with the app at 28% and the `/Applications` shortcut at 72% of its width
  (positions come from `wails3 tool package` itself, not from anything in this repo); the volume
  icon and the image's own Finder icon are both `darwin/icons.icns`, and `darwin/dmg-background.png`
  is a flat gradient in the app icon's own palette with an arrow between the two icon positions.
  The scaffolded `dmg-file-icon.icns`/`.png` were Wails-branded drive artwork and were deleted with
  the same reasoning as `Assets.car`. What is still deferred is Developer ID signing and
  notarization, which SPEC.md §3 puts past v1 — an ad-hoc-signed image is still Gatekeeper-blocked
  on first launch (§4's checklist covers the workaround).
- **Every item in §4 is unrun** — no macOS hardware has been available. Whoever runs a build on real
  hardware should fill in those rows.
- **The bundle has no `Assets.car`, and the icon comes from `icons.icns` alone.** `appicon.png` and
  `appicon.icon/Assets/kira_icon_vector.svg` are the app's real icon, swapped in from Wails'
  scaffolded default; `wails3 task common:generate:icons` regenerates `darwin/icons.icns` from that
  artwork correctly. The asset catalog could not follow: building one needs Apple's `actool`
  (`wails3 generate icons`'s `-iconcomposerinput`/`-macassetdir` flags), which ships with full Xcode
  and not with the Command Line Tools, and which fails silently rather than loudly when absent. The
  scaffolded, Wails-artwork `Assets.car` therefore sat in the repo unchanged — and won, because
  `CFBundleIconName` resolves against `Assets.car` **before** `CFBundleIconFile` falls back to
  `icons.icns`, so a packaged app showed the old Wails icon while `icons.icns` beside it was right.
  Both the file and the `CFBundleIconName` key are now gone from `darwin/`, which leaves
  `CFBundleIconFile` → `icons.icns` as the only path and ships the correct icon. Note `wails3 update
  build-assets` adds that key back on its own whenever an `Assets.car` is present, so the two belong
  together: reintroduce both or neither. `appicon.icon` is kept for whoever regenerates a catalog on
  a machine with Xcode — the cost of going without one is that macOS composes no appearance
  variants (dark, tinted) from the icon. `icon.json` was simplified when the artwork was swapped in:
  the scaffolded layer was tuned for a small monochrome glyph over an automatic gray background
  (0.85 scale, forced near-white/gray recolor in dark/tinted appearances, a specular highlight and
  translucency) — all wrong for a full-color, pre-composed 1024×1024 icon, so those were replaced
  with a 1.0-scale, unrecolored, non-specular single layer. That JSON is still unverified beyond
  `wails3 generate icons` accepting it; whoever builds the catalog should eyeball the result.

## 7. CI, releases, and auto-update

**Status:** applied. `.github/workflows/{ci,release}.yml` now hold the content described below — the
staging directory (`docs/v1/plans/p58-pending-ci-workflows/`) it waited in, through sessions whose
GitHub token lacked the `workflow` OAuth scope, is gone. No CI run has exercised them yet.

**`ci.yml`** (push/PR to `main`, plus `workflow_dispatch`):

| Job | Runner | What it does |
|---|---|---|
| `checks` | `macos-15` (pinned, not `macos-latest`) | `bun install --frozen-lockfile`, install the `wails3` version pinned in `go.mod`, generate bindings, then `lint`, `typecheck`, `build`, `test:go`, `verify:packaging` |
| `ui` | `ubuntu-latest` | bindings, Playwright WebKit plus its system libraries, `bun run test:ui`; uploads `playwright-report/` on failure |
| `container-tests` | `ubuntu-latest` | `bun run test:unit`, `bun run test:go` |
| `package-smoke` | `macos-15`, skipped on pull requests | `bun run package`, then asserts the bundle: `CFBundleIdentifier` is `com.kirathecat.kira-studio`, `Signature=adhoc`, `du -sh`; finally `bun run verify:packaging` |

`checks`' own `test:go` step (on `macos-15`, no Docker) only ever exercises the driver-independent
half of `apps/kira-studio/internal/adapters/*/*_test.go` — every Testcontainers-backed test skips itself with a
named `DockerUnavailableMessage` when no Docker daemon answers, rather than failing. The real,
full-coverage run of that same `test:go` needs a runner with Docker, which is what `container-tests`
is for. This split predates P58f and is unaffected by it: `packages/db-fixtures/`'s per-engine specs used to be
the ones needing Docker-on-Linux (Electron-hosted macOS runners have neither Docker nor nested
virtualization); P58f D1 moved that coverage into `apps/kira-studio/internal/adapters/*/*_test.go`
(`docs/ARCHITECTURE.md`'s Testing section) without changing which runner needs to be the one that
actually exercises it.

**Cutting a release** (`release.yml`, on tags matching `v*.*.*`):

1. `git tag vX.Y.Z && git push origin vX.Y.Z`. The workflow writes the tag (minus its `v`) into
   `build/config.yml`'s `info.version` in its own checkout — no pre-tag version-bump commit is
   needed — and from there it reaches the binary, the About dialog and the bundle's `Info.plist`
   (see "Where the version comes from"). It asserts the write landed before building.
2. It generates bindings, runs `lint`/`typecheck`, then `bun run package` unmodified.
3. It copies the already-signed `apps/kira-studio/bin/Kira Studio.dmg` to
   `kira-studio-macos-arm64.dmg` (the platform-qualified asset name — the image itself is built and
   signed by step 2's `bun run package`, not here), re-runs `verify:packaging`, and opens a **draft**
   GitHub Release with that disk image attached plus an artifact upload.
4. A human runs §4 against the draft's artifact on real hardware, fills in the rows, then publishes.
   The workflow never publishes automatically.

**No auto-update — unchanged, not newly removed.** SPEC.md defers auto-update past v1 (§1's deferred
list, §3's app-identity line), and that was already true under Electron. macOS auto-update also requires
a signed and notarized app, which §6 defers. `verify-packaging.sh` keeps re-asserting the absence:

- **S1** — no `electron-updater`/`update-electron-app` dependency in `package.json`.
- **S2** — no `autoUpdater`/`electron-updater` reference anywhere in `src/`.
- **S5** — `package.json`'s `package` script still runs `wails3 task darwin:package`, so this check
  fails loudly if the packaging entry point is swapped for something that could publish.

There is no publish provider, no update feed, no `latest-mac.yml`, and no `.blockmap` — the last of
those was an electron-builder differential-update artifact that has no equivalent here, so it is absent
by construction rather than deleted per build.

**What a future auto-update would require, in order:** code signing and notarization (SPEC.md §1/§3),
then a SPEC.md scope change reversing "no auto-update", then an update feed and updater wiring.

**Whether the release workflow has actually run:** *no — and the workflow file in `.github/workflows/`
is still the pre-P57 Electron one (§6), so the first tag pushed must not be pushed before those files
are applied.*
