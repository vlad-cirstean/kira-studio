# Packaging: local build and verification

See the [README](../README.md) for what the app is and how to run it.

Kira Studio ships as an unsigned (ad-hoc), local, arm64-only macOS build in v1 — see SPEC.md §1/§3.
Config lives in `electron-builder.yml`; packaging scripts live in `package.json`.

## 1. Building locally

Requires macOS 13+ arm64, Bun, and Xcode command-line tools.

```
bun install
bun run package:mac        # electron-vite build, then electron-builder --mac --arm64
```

Expected artifacts:
- `dist/Kira Studio-0.1.0-arm64.dmg`
- `dist/Kira Studio-0.1.0-arm64-mac.zip`
- `dist/mac-arm64/Kira Studio.app`

`bun run package:mac:dir` produces only the `.app` (skips `dmg`/`zip` packaging) and is the faster
loop for cold-start and RSS measurements.

## 2. Config summary (`electron-builder.yml`)

- `appId: com.kirathecat.kira-studio`, `productName: Kira Studio`.
- `asar: true`, with `out/main/engine.js` unpacked (`asarUnpack`) — it's loaded via
  `utilityProcess.fork()` and a forked entry point can't be exec'd from inside an asar archive.
- `mac.identity: '-'` (ad-hoc) with `mac.hardenedRuntime: false` — deliberately not `identity: null`
  (which skips signing entirely and gets killed by the kernel on Apple Silicon) or the
  hardened-runtime default (which needs an entitlements file for ad-hoc signing to launch).
- Targets: `dmg` and `zip`, arm64 only, into `dist/` (already gitignored).
- `npmRebuild: false` — every native dependency in the tree belongs to a devDependency; the
  production dependency set is pure JS.
- `electronLanguages: ['en']` — dark-mode-only, English-only v1; trims `.lproj` locale weight.

## 3. Verification checklist — results from this environment

This environment is Linux, not macOS, so the human checklist below (§4) has not been run for real.
What **was** verified here is the build itself, since electron-builder's cross-platform behavior
turned out to be substantially better than expected (see §5) — real, non-simulated builds were run
and their output inspected directly:

| Check | Result |
|---|---|
| `electron-builder --mac --arm64 --dir --publish never` completes | **pass** — exit 0, produces a complete `Kira Studio.app` |
| `appId` present in the built `Info.plist` | pass |
| `engine.js` unpacked correctly | pass — present at `Contents/Resources/app.asar.unpacked/out/main/engine.js` |
| Production driver present in the asar | pass — `npx asar list ".../app.asar" \| grep -c node_modules/pg` returned 23 matches, **without** needing `node_modules/**/*` added to `files` (the plan's fallback for this case was not needed) |
| `.lproj` locale trimming | pass — trimmed to 1 `.lproj` folder (`en.lproj`), confirming `electronLanguages: ['en']` took effect |
| `.app` on-disk size (lever L-D, budget ≤ 300 MB) | **252 MB** — under budget |
| Full (non-`--dir`) build, `zip` target | **pass** — produced `dist/Kira Studio-0.1.0-arm64.zip`, 315 MB |
| Full (non-`--dir`) build, `dmg` target | **fails** — see §5 |

Not verifiable off macOS (needs a human on real hardware — see §4): code signature check, Gatekeeper
quarantine behavior, cold-start timing, packaged RSS cross-check, `~/.kira-studio/` real-home
creation, and full click-through of the app.

## 4. Human checklist (run on macOS 13+ arm64)

Every item below is a pass/fail a human should record here after running it for real:

1. `codesign -dv --verbose=2 "dist/mac-arm64/Kira Studio.app"` reports `Signature=adhoc`. — *not
   yet run*
2. `npx asar list "dist/mac-arm64/Kira Studio.app/Contents/Resources/app.asar" | grep -c
   node_modules/pg` is non-zero. Confirmed non-zero (23) in this environment's Linux build already;
   re-confirm on macOS. — *not yet run*
3. Launching the app shows the workbench, with the engine status dot green. If it dies immediately,
   `utilityProcess.fork` could not load the engine from inside the asar (the `asarUnpack` entry
   above is the fix, and is already in place). — *not yet run*
4. Gatekeeper: an unsigned, unnotarized build needs right-click → Open, or
   `xattr -dr com.apple.quarantine "/Applications/Kira Studio.app"`. Expected, not a defect. —
   *not yet run*
5. `~/.kira-studio/` is created with `kira.sqlite` and `logs/` on first launch — the real home,
   since `KIRA_HOME` is unset in a packaged run. — *not yet run*
6. Create a connection, expand the tree, open a data tab, scroll, open the cell editor, quit
   cleanly. The View menu has no Reload / Toggle DevTools (`app.isPackaged` is true). — *not yet
   run*
7. Cold start: launch 3 times, discard the first, take the median from the `startup` log line in
   `~/.kira-studio/logs/`; record against the ≤ 1500 ms target. — *not yet run, see
   `docs/PERF.md` §3*
8. RSS cross-check: rebuild the 5-connection/10-tab scenario by hand, sum the app's processes via
   `ps -o rss=` or Activity Monitor, record against 350 MB. — *not yet run, see `docs/PERF.md` §3*
9. Record the `.app` on-disk size (lever L-D). — **252 MB**, recorded above from the Linux `--dir`
   build; re-confirm on macOS since a real macOS build may differ slightly.

## 5. Off-macOS verification (what this environment could actually check)

The plan anticipated that `bunx electron-builder --mac --arm64 --dir --publish never` would fail
with a platform error immediately after resolving and parsing `electron-builder.yml`, without
producing anything. That is **not** what happens with electron-builder 26.15.3: the `--dir` build
completes fully and successfully on Linux (see the table in §3) — it downloads prebuilt Electron
binaries for the target platform and assembles a complete, correctly-structured `.app` bundle,
skipping only the macOS-only code-signing step (ad-hoc signing is a no-op off Darwin). Going
further, the full (non-`--dir`) build's `zip` target also completes successfully. Only the `dmg`
target fails, and only on a genuine macOS-only tool dependency:

```
⨯ sips process failed ENOENT
Exit code: ENOENT
Output:
Exit code: ENOENT. spawn sips ENOENT  failedTask=build stackTrace=Error: sips process failed ENOENT
```

`sips` (Scriptable Image Processing System) is a macOS-only image tool electron-builder shells out
to when building a `dmg`; it does not exist on Linux. This is a more favorable and more precise
platform-failure point than the plan assumed — the `dir` build, the asar contents, the locale
trimming, and even the `zip` artifact are all verifiable off macOS; only `dmg` construction
genuinely requires real macOS.

## 6. Known gaps

- **No app icon.** electron-builder falls back to the default Electron icon — no icon asset is
  specified anywhere in SPEC.md and none exists in the tree. Left as a design decision for a later
  phase, not invented here.
- **Ad-hoc signature only.** The build is not distributable outside the machine that built it —
  SPEC.md §3 explicitly defers signing/notarization past v1.
- **No CI, no tag-triggered build, no auto-update.** All P15's job.
- **`dmg` construction requires real macOS** (the `sips` dependency above) — the `zip` target and
  the `.app` bundle itself do not.
- **Human checklist items in §4 are unrun** — no macOS hardware has been available in this
  environment. Whoever runs a build on real hardware should fill in the "not yet run" rows above.
