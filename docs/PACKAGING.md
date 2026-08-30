# Packaging: local build and verification

See the [README](../README.md) for what the app is and how to run it.

Kira Studio ships as an unsigned (ad-hoc), local, arm64-only macOS build in v1 — see SPEC.md §1/§3.

Packaging is Wails v3's own [Task](https://taskfile.dev)-based pipeline (P57): config lives in
`shell/build/config.yml`, the task graph in `shell/Taskfile.yml` and `shell/build/darwin/Taskfile.yml`,
and the entry points in the repo-root `package.json`'s `scripts` plus `scripts/vendor-node.sh`,
`scripts/sign-bundle.sh` and `scripts/verify-packaging.sh`. There is no `electron-builder.yml`, no
asar, and no native-module ABI rebuild step — all deleted with Electron in P57 M7.

## 1. Building locally

Requires macOS arm64, Bun, Go (`shell/go.mod`: 1.25.0), Xcode command-line tools, and the `wails3`
CLI at the version `shell/go.mod` pins (`v3.0.0-beta.15`) — `sh scripts/wails-dev-setup.sh` installs
exactly that version, and is also wired as `predev`.

```sh
bun install
sh scripts/wails-dev-setup.sh   # wails3 CLI + generated bindings + the two runtime pieces below
bun run build:engine            # esbuild → shell/runtime/engine/engine.cjs
bun run build                   # vite build → shell/frontend/dist (embedded by shell/main.go)
bun run package                 # wails3 task darwin:package, then scripts/sign-bundle.sh
```

`scripts/wails-dev-setup.sh` is idempotent and does only what is missing: it installs the pinned
`wails3`, generates the Wails bindings (`wails3 generate bindings -b -i -ts -names` — gitignored, and
`src/renderer/bridge/*.ts` imports them, so `bun run build` fails without them), runs
`scripts/vendor-node.sh`, and runs `bun run build:engine`. Both runtime pieces and
`shell/{bin,frontend/dist,frontend/bindings,runtime}` are gitignored (`shell/.gitignore`).

Expected artifacts (nothing lands in `dist/` or `out/` any more):

- `shell/bin/Kira Studio.app` — the packaged, ad-hoc-signed bundle.
- `shell/bin/Kira Studio` — the bare Go binary the bundle is assembled around.

No `.dmg` and no `.zip` are produced locally; the release workflow zips the `.app` itself (§7).

**Bundle layout** (`shell/build/darwin/Taskfile.yml`'s `create:app:bundle`):

```
shell/bin/Kira Studio.app/
  Contents/
    Info.plist                       CFBundleName/CFBundleExecutable "Kira Studio",
                                     CFBundleIdentifier com.kirathecat.kira-studio
    Resources/
      icons.icns
      Assets.car                     (copied only if build/darwin/Assets.car exists)
    MacOS/
      Kira Studio                    the compiled Go binary — the literal filename, space included,
                                     must equal CFBundleExecutable or the bundle neither launches
                                     nor codesigns
      runtime/
        node/bin/node                vendored Node runtime (scripts/vendor-node.sh)
        engine/engine.cjs            bundled Node engine child process (bun run build:engine)
```

**Both `runtime/` pieces must exist before packaging.** `shell/main.go`'s `resolveEngine()` looks for
`runtime/node/bin/node` and `runtime/engine/engine.cjs` *next to the running executable* — i.e.
`Contents/MacOS/runtime/…` in a packaged bundle — and `log.Fatalf`s if either is missing. Without them
the build still succeeds, producing a deceptively small `.app` (~14 MB of Go binary instead of that
plus the pair's own ~126 MB) that then refuses to start at all. `create:app:bundle` guards this with an
explicit precondition and fails with a message naming both commands.

**Dev loop:** `bun run dev` (`bun run build && cd shell && wails3 task dev`) launches a real native
window with hot reload; `predev` runs `wails-dev-setup.sh` first. `wails3 task darwin:run` builds and
runs a `Kira Studio.dev.app` from `build/darwin/Info.dev.plist` without packaging.

## 2. Config summary

**`shell/build/config.yml`** — the source Wails generates build assets from:

- `info.productName: "Kira Studio"`, `info.productIdentifier: "com.kirathecat.kira-studio"` (P57 D11:
  the Wails build is the only build now, so P51/P52's deliberately-distinct `…-shell` identifier is
  gone), `info.companyName`, `info.version: "0.0.0"`.
- `dev_mode` drives `wails3 dev`: watched extensions, ignore lists, and the three dev commands.
- Editing `info` requires `wails3 task common:update:build-assets` to regenerate the assets, which
  overwrites hand edits under `build/` — so `Info.plist` below is regenerated, not hand-maintained.

**`shell/build/darwin/Info.plist`** — `CFBundleName` and `CFBundleExecutable` are both `Kira Studio`,
`CFBundleIdentifier` is `com.kirathecat.kira-studio`, `CFBundleVersion`/`CFBundleShortVersionString`
`0.0.0`, `CFBundleIconFile` `icons`, `LSMinimumSystemVersion` `12.0.0`. Note the floor: the plist and
the build's `MACOSX_DEPLOYMENT_TARGET`/`CGO_*` flags say macOS 12, while SPEC.md §3 and the README
scope the product at macOS 13+. The stricter product claim stands; the plist is simply Wails' default
and has not been narrowed.

**`shell/Taskfile.yml` + `shell/build/darwin/Taskfile.yml`** — the task graph `bun run package` drives:

| Task | What it does |
|---|---|
| `darwin:package` | `deps: build`, then `create:app:bundle` |
| `darwin:build` → `build:native` | on macOS: `deps` = `common:go:mod:tidy`, `common:build:frontend`, `common:generate:icons`; then `go build -tags production -trimpath -buildvcs=false -ldflags="-w -s" -o bin/Kira Studio` with `GOOS=darwin CGO_ENABLED=1 GOARCH=$ARCH` (host arch unless overridden) and `MACOSX_DEPLOYMENT_TARGET=12.0` |
| `darwin:build` → `build:docker` | off macOS only: cross-compiles in the `wails-cross` Docker image. Never exercised in this repo (§5) |
| `create:app:bundle` | makes `Contents/{MacOS,Resources}`, copies `icons.icns`, `Assets.car` (if present), the binary and `Info.plist`, asserts `runtime/{node,engine}` exist, copies `runtime/` in, then `codesign:adhoc` on macOS (`codesign:skip` elsewhere) |

`common:build:frontend` runs the same `bun run build` the checklist above already ran; Task's
`sources`/`generates` up-to-date checking makes the second invocation a no-op against fresh output, so
building the renderer first is cheap insurance, not duplicated work.

**`scripts/vendor-node.sh`** — downloads Node **22.20.0** from nodejs.org (SHA-256 pinned per
platform) into `shell/runtime/node/`, then trims what a runtime never needs: `include/` (~64 MB of C
headers, only used to compile native addons *against* this Node) and `lib/node_modules/npm` (~17 MB).
It also removes the now-dangling `bin/{npm,npx,corepack}` symlinks — a dangling symlink fails
`codesign --deep --strict` resource validation, and the engine child is always spawned as
`node <script>` directly. This is an ordinary nodejs.org runtime, not the system `node` and not
Electron's embedded one.

**`bun run build:engine`** — esbuild bundles `src/engine/stdio-main.ts` to
`shell/runtime/engine/engine.cjs` (`--platform=node --format=cjs`), with
`@confluentinc/kafka-javascript`, `ssh2` and `cpu-features` marked `--external` — same externals as
before, but see §6: nothing vendors those externals into the bundle.

**`scripts/sign-bundle.sh`** — ad-hoc signing, run by `bun run package` after the Task pipeline. macOS
only; exits 1 elsewhere and exits 1 if the bundle or the vendored node binary is missing.

```sh
codesign --force --sign - "$APP/Contents/MacOS/runtime/node/bin/node"
codesign --force --sign - "…/@confluentinc/kafka-javascript/build/Release/confluent-kafka-javascript.node"  # only if present (§6)
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
```

The two nested Mach-O files are signed individually first because `codesign` does not descend into a
plain (non-framework) nested executable on its own. `create:app:bundle` already ran its own
`codesign --force --deep --sign -`; `sign-bundle.sh` re-signs and then *verifies* — redundant but
harmless, and it is the script a human or CI actually invokes.

**Deliberately present in the Taskfile but not wired into any `package.json` script:**
`darwin:package:dmg` (`wails3 tool package --format dmg`), `darwin:sign` and `darwin:sign:notarize`
(`wails3 tool sign [--notarize]`, Developer ID), and `darwin:build:universal`/`package:universal`.
Signing/notarization are deferred past v1 by SPEC.md §3; the DMG is a scope decision (§6).

**Keychain consequence of ad-hoc signing.** Credentials are encrypted under an AES-256-GCM key held in
a macOS Keychain generic-password item (`shell/internal/secrets/keyring_darwin.go`, service
"Kira Studio Safe Storage"). Keychain ACLs are keyed to a stable code-signing identity, which is
exactly what ad-hoc signing defers, so the first launch after installing a new build may show one
"Kira Studio wants to use your confidential information stored in…" prompt; **Always Allow** answers it
permanently for that build. Expected, and the honest cost of deferring signing — not worth working
around with a bundled private key.

## 3. Verification checklist — results from this environment

This environment is **Linux, with no macOS, no `codesign`, and no `/usr/libexec/PlistBuddy`**. Nothing
below is a claim about a real packaged bundle; the layout in §1 is read from
`create:app:bundle` and `resolveEngine()`, not observed in one.

| Check | Result |
|---|---|
| `bun run build` (vite → `shell/frontend/dist`) | **pass** — run here this session |
| `bun run build:engine` (esbuild → `shell/runtime/engine/engine.cjs`) | **pass** — run here this session |
| `sh scripts/vendor-node.sh` | **pass** — run here this session, on the `linux-x64` branch (checksum-pinned); the `darwin-arm64` download is a different archive and was not exercised |
| `bun run typecheck`, `bun run lint` | **pass** |
| `sh scripts/verify-packaging.sh` | **pass** — static checks S1/S2/S5 ran; A1–A4/N1–N2 correctly reported *skipped*, since no `shell/bin/Kira Studio.app` exists here |
| `wails3 task darwin:package` | **not run** — needs macOS (or the untested Docker cross-compile path, §5) |
| `scripts/sign-bundle.sh` | **not run** — `codesign` is macOS-only and the script refuses to run off Darwin |
| Real bundle contents, `Info.plist` values, ad-hoc signatures | **not verified** — no bundle was produced here |
| `.app` on-disk size | **not measured** — expect roughly 140 MB from `create:app:bundle`'s own figures (~14 MB binary + ~126 MB `runtime/`); not a recorded number |

Not verifiable off macOS (needs a human on real hardware — see §4): code signature checks, Gatekeeper
quarantine behavior, launching the app at all, `~/.kira-studio/` creation, cold-start timing, packaged
RSS, and the `.app` size.

## 4. Human checklist (run on macOS 13+ arm64)

Every item is a pass/fail a human should record here after running it for real. Items 1–3 and 10 are
also checked automatically on macOS by the `package-smoke` job in the intended `ci.yml` (§7) — but this
list is only updated from an *observed* run, never from expectation.

1. `bun run package` completes and `sign-bundle.sh` prints `signed and verified`. — *not yet run*
2. `codesign -dv --verbose=2 "shell/bin/Kira Studio.app"` reports `Signature=adhoc`, and the same for
   `Contents/MacOS/runtime/node/bin/node`. — *not yet run*
3. `bun run verify:packaging` passes against the real bundle — i.e. A1–A4/N1–N2 actually execute
   instead of reporting "skipped". — *not yet run*
4. Launching the app shows the workbench with the engine status dot green. If it exits immediately,
   `resolveEngine()` could not find `Contents/MacOS/runtime/{node/bin/node,engine/engine.cjs}` — the
   log line names both paths. — *not yet run*
5. Gatekeeper: an unsigned, unnotarized build needs right-click → Open, or
   `xattr -dr com.apple.quarantine "/Applications/Kira Studio.app"`. Expected, not a defect. —
   *not yet run*
6. `~/.kira-studio/` is created with `kira.sqlite` and `logs/` on first launch — the real home, since
   `KIRA_HOME` is unset in a packaged run. — *not yet run*
7. Create a connection, expand the tree, open a data tab, scroll, open the cell editor, quit cleanly.
   The View menu has no Reload / Toggle DevTools in a `-tags production` build. — *not yet run*
8. Kafka: connecting is **expected to fail** in a packaged build today — `engine.cjs` `require()`s a
   native module nothing vendors into the bundle (§6). Record the actual failure, and do not treat a
   pass here as possible until that gap closes. — *not yet run*
9. Cold start: launch 3 times, discard the first, take the median from the startup log line in
   `~/.kira-studio/logs/`; record against the ≤ 1500 ms target. RSS cross-check: rebuild the
   5-connection/10-tab scenario by hand and sum the app's processes via `ps -o rss=`, against 350 MB. —
   *not yet run, see `docs/PERF.md` §3, whose recorded numbers still predate this bundle*
10. Record the `.app` on-disk size (`du -sh`, lever L-D, budget ≤ 300 MB). — *not yet run*

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
"skipped A1-A4/N1-N2" note and passes on the static checks alone, and even with a bundle it would skip
A1/A3/N2 for want of `codesign`/`PlistBuddy`. **A green `verify:packaging` on Linux proves only the
static checks (S1/S2/S5), not that any bundle is correct.**

What *is* fully verifiable off macOS: everything that feeds the bundle rather than being the bundle —
the renderer build, the engine bundle, the vendored Node runtime (on this platform's own Node archive),
typecheck, lint, the Go unit tests, and the static half of `verify:packaging`.

## 6. Known gaps

- **Kafka's native module is not vendored into the packaged bundle.** `build:engine` marks
  `@confluentinc/kafka-javascript` `--external`, but no build step copies that dependency (or any
  `node_modules/` tree) alongside `engine.cjs`, the way `vendor-node.sh` does for the Node runtime. A
  packaged build therefore produces a working app whose **Kafka connections fail at `require()` time**.
  Both `sign-bundle.sh` and `verify-packaging.sh` treat the missing
  `Contents/MacOS/runtime/engine/node_modules/@confluentinc/kafka-javascript/build/Release/confluent-kafka-javascript.node`
  as a non-fatal note rather than asserting success against something nothing produces; if it ever does
  appear, both scripts pick it up (individual ad-hoc signature, Mach-O arm64 and signature checks). This
  is a real open gap, not a regression from removing Electron — the old pipeline's mechanism for it
  (`electron-rebuild` for the Electron ABI plus `asarUnpack`) is gone along with the ABI and the asar —
  and it is plausibly moot if P58 removes the Node engine sidecar entirely. Tracked in
  `docs/v1/plans/P57-cutover.md`'s M7 entry.
- **Ad-hoc signature only** (identity `-`). The build is not distributable outside the machine that
  built it, and SPEC.md §3 defers signing/notarization past v1. `wails3 tool sign [--notarize]` is
  available via `darwin:sign`/`darwin:sign:notarize` but is wired into nothing.
- **No DMG.** `darwin:package:dmg` exists in the Taskfile, but no `package.json` script calls it and
  the release workflow zips the `.app` instead. A deliberate scope decision: verifying a DMG pipeline
  needs real macOS, which was not available when the decision was made — not an oversight.
- **The CI workflow updates are staged, not applied.** `.github/workflows/{ci,release}.yml` still hold
  their pre-P57 Electron content; the intended files live in `docs/v1/plans/p57-pending-ci-workflows/`
  with copy-and-commit steps, because the session that wrote them lacked GitHub's `workflow` OAuth
  scope. Until someone applies them, everything in §7 describes intent, not what runs.
- **Every item in §4 is unrun** — no macOS hardware has been available. Whoever runs a build on real
  hardware should fill in those rows.

## 7. CI, releases, and auto-update

**Status:** the workflows described below are the *intended* P57 ones, staged in
`docs/v1/plans/p57-pending-ci-workflows/` (`ci.yml`, `release.yml`, plus a README with the two `cp`
commands and the commit). `.github/workflows/` still contains the pre-P57 Electron versions, which
reference deleted scripts. Applying them is the first pending job for anyone pushing with `workflow`
scope.

**Intended `ci.yml`** (push/PR to `main`, plus `workflow_dispatch`):

| Job | Runner | What it does |
|---|---|---|
| `checks` | `macos-15` (pinned, not `macos-latest`) | `bun install --frozen-lockfile`, install the `wails3` version pinned in `shell/go.mod`, generate bindings, then `lint`, `typecheck`, `build:engine`, `build`, `test:go`, `verify:packaging` |
| `ui` | `ubuntu-latest` | bindings, Playwright WebKit plus its system libraries, `bun run test:ui`; uploads `playwright-report/` on failure |
| `db-unit-tests` | `ubuntu-latest` | `bun run test:unit`, `bun run test:db` |
| `package-smoke` | `macos-15`, skipped on pull requests | `vendor-node.sh` + `build:engine`, `bun run package`, then asserts the bundle: `engine.cjs` and `runtime/node/bin/node` present, `CFBundleIdentifier` is `com.kirathecat.kira-studio`, `Signature=adhoc`, `du -sh`; finally `bun run verify:packaging` |

`test:db` **is** in CI now, on Linux. The old constraint was Electron-specific in practice: the suite
had to run on the same macOS runner as the rest, and GitHub-hosted macOS runners have no Docker or
nested virtualization. With the shell in Go and the DB adapters plain Bun, the Testcontainers suite
moves to `ubuntu-latest`, where Docker exists.

**Cutting a release** (`release.yml`, on tags matching `v*.*.*`):

1. `git tag vX.Y.Z && git push origin vX.Y.Z`. The workflow writes `package.json`'s `version` from the
   tag itself — no pre-tag version-bump commit is needed.
2. It generates bindings, runs `lint`/`typecheck`, runs `vendor-node.sh` + `build:engine`, then
   `bun run package` unmodified.
3. It zips the ad-hoc-signed bundle with `ditto -c -k --keepParent "shell/bin/Kira Studio.app"
   kira-studio-macos-arm64.zip`, re-runs `verify:packaging`, and opens a **draft** GitHub Release with
   that zip attached plus an artifact upload.
4. A human runs §4 against the draft's artifact on real hardware, fills in the rows, then publishes.
   The workflow never publishes automatically.

Note: that verify step still sets `KIRA_STRICT_UPDATE_CHECK=1`, which the rewritten
`verify-packaging.sh` no longer reads — the strict mode existed to make a leftover electron-builder
`.blockmap` fatal, and no such artifact exists in this pipeline. The env var is inert, not load-bearing;
drop it whenever the workflows are applied.

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
