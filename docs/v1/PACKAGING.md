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
- `dist/Kira Studio-0.1.0-arm64.zip`
- `dist/mac-arm64/Kira Studio.app`

`bun run package:mac:dir` produces only the `.app` (skips `dmg`/`zip` packaging) and is the faster
loop for cold-start and RSS measurements.

## 2. Config summary (`electron-builder.yml`)

- `appId: com.kirathecat.kira-studio`, `productName: Kira Studio`.
- `asar: true`, with `out/main/engine.js` and (P32) the Kafka adapter's native driver
  (`node_modules/@confluentinc/kafka-javascript/build/Release/*.node`) unpacked (`asarUnpack`) —
  `engine.js` is loaded via `utilityProcess.fork()` and a forked entry point can't be exec'd from
  inside an asar archive; a native addon can't be `require()`'d from inside one either, for the
  same reason. `files` also excludes the driver's source/build-intermediate directories
  (`deps/`, `src/`, `util/`, `examples/`, `ci/`, `build/Release/{obj.target,.deps}/`) — only the
  built `.node` file the packaged app actually loads ships.
- `mac.identity: '-'` (ad-hoc) with `mac.hardenedRuntime: false` — deliberately not `identity: null`
  (which skips signing entirely and gets killed by the kernel on Apple Silicon) or the
  hardened-runtime default (which needs an entitlements file for ad-hoc signing to launch).
  **Keychain consequence (P25 D12):** `safeStorage`'s docs state the app "should be code signed
  for `safeStorage` to behave consistently," and a stable Developer ID signature is exactly what
  ad-hoc signing defers — so an unsigned build has no stable code-signing identity for macOS to
  key a Keychain ACL grant on across builds. In practice: the first launch after installing a new
  build may show one "Kira Studio wants to use your confidential information stored in…" prompt;
  **Always Allow** answers it permanently for that build. This is the honest cost of deferring
  signing rather than something worth working around with a private/bundled key, which would be
  strictly worse security and would have to be unpicked once real signing lands.
- Targets: `dmg` and `zip`, arm64 only, into `dist/` (already gitignored).
- `npmRebuild: false` — stays false even now that the tree has one real native production
  dependency (P32's `@confluentinc/kafka-javascript`): its Electron-ABI build is produced by
  `scripts/native-electron-build.sh` (run as `prepackage:mac`) rather than electron-builder's own
  rebuild step, which has no Bun support. By the time `electron-builder` runs, the driver is
  already built for the right ABI and just needs packaging, not rebuilding.
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

**P32 update:** this table predates the Kafka adapter's native driver and has not been re-run since
— `prepackage:mac`'s `native-electron-build.sh` step needs a real `electron-rebuild` against
Electron's headers, which this sandbox's proxy blocks (the same F20 finding that blocks it for
`predev`/`pretest:ui`). `scripts/verify-packaging.sh`'s new A6 check (the driver's `.node` is
present and unpacked under `app.asar.unpacked`, and absent from inside `app.asar` itself) exists
but has not been run against a real package for the same reason. This table's own asar/unpack/size
numbers are all pre-P32 and need a fresh run once the driver's macOS build is verified (plan step
1) — not assumed to still hold with a native module added to the tree.

Not verifiable off macOS (needs a human on real hardware — see §4): code signature check, Gatekeeper
quarantine behavior, cold-start timing, packaged RSS cross-check, `~/.kira-studio/` real-home
creation, and full click-through of the app.

## 4. Human checklist (run on macOS 13+ arm64)

Every item below is a pass/fail a human should record here after running it for real. Items **1,
2's config precondition, 3 and 9 are now also checked automatically**, on genuine macOS hardware,
by the `package-smoke` job in `.github/workflows/ci.yml` (§7) — but the row below is only updated
from an *observed* run, never from expectation, so it may still read "not yet run" here even once
that automation exists.

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
   build; re-confirm on macOS since a real macOS build may differ slightly. Automated going forward
   via `du -sh` in `package-smoke`.

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
- **`dmg` construction requires real macOS** (the `sips` dependency above) — the `zip` target and
  the `.app` bundle itself do not.
- **Human checklist items in §4 are unrun** — no macOS hardware has been available in this
  environment. Whoever runs a build on real hardware should fill in the "not yet run" rows above.

CI, the tag-triggered release build, and the auto-update decision are covered in §7 — P15 closed
those gaps; the DB test suite and the §4 human items remain deliberately out of CI's scope.

## 7. CI, releases, and the auto-update decision

**What runs on every push/PR** (`.github/workflows/ci.yml`, `macos-15`, pinned rather than
`macos-latest` so a runner-image change can't silently swap architecture or toolchain): `checks`
(lint, typecheck, build, `bun run verify:packaging`) on every push and PR to `main`;
`ui-smoke` (`bun run test:ui`) after `checks` passes;
`package-smoke` (`bun run package:mac:dir` plus the bundle assertions in §3/§4 items 1-3/9) after
`checks` passes, skipped on pull requests. No dependency caching and no pinned Bun version — this
repo pins neither elsewhere, and a stale cache serving old Electron would be a green CI for a build
nobody actually made.

**Why `bun run test:db` is not in CI.** GitHub-hosted macOS runners have no Docker and no nested
virtualization, so the Testcontainers-backed DB suite cannot run there at all. SPEC.md §9.1 already
scoped this suite as local-only for v1. The consequence: of the 26 UI specs, only the five that need
no container (`smoke`, `workbench`, `connections`, `startup`, `secrets` as of P25) really execute in
`ui-smoke`; the rest skip with `DOCKER_UNAVAILABLE_MESSAGE`, not a failure. **The DB suite and the
container-backed UI specs stay a local, pre-merge responsibility — CI does not replace them.**

**Cutting a release** (`.github/workflows/release.yml`, triggered on tags matching `v*.*.*`):
1. Bump `version` in `package.json`, commit it.
2. `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. The workflow checks the tag matches `package.json`'s version, re-runs `lint`/`typecheck`, runs
   `bun run package:mac` unmodified, deletes any `.blockmap` electron-builder wrote, re-verifies
   packaging in strict mode, and opens a **draft** GitHub Release with the `.dmg`/`.zip` attached
   plus a build-log artifact upload.
4. A human runs the §4 checklist against the draft release's artifacts on real hardware, fills in
   the rows, then publishes the release. The workflow does not publish automatically — five of §4's
   nine checks need a human on real macOS, and none of them are unrun by the time a user downloads a
   published release.

**The auto-update verification.** SPEC.md states "no auto-update" for v1 in three places (§1's
deferred list, §3's app-identity line, and by implication §10's P12 scope). Building a real
auto-updater now would also be incoherent with the rest of v1: macOS auto-update requires a *signed
and notarized* app, and signing is itself deferred (`mac.identity: '-'` is ad-hoc and satisfies no
Gatekeeper check). So P15 does not add `electron-updater`, a `publish:` provider, or a `latest-mac.yml`
feed — it **verifies** that the shipped configuration produces none of that, and keeps re-verifying
it:

- No `electron-updater`/`update-electron-app` dependency, and no `autoUpdater` reference in `src/`.
- `electron-builder.yml` has no `publish:` key at all, and both packaging scripts pass
  `--publish never` — so electron-builder never resolves a publish target.
- `dmg.writeUpdateInfo: false` stays set on the dmg target.
- No `dist/latest*.yml` update-feed file is ever produced (confirmed empirically: none exists after
  a full build).
- **One byproduct needed an action, not just an assertion**: electron-builder's macOS `zip` target
  writes a `.blockmap` — a differential-update artifact — unconditionally, regardless of publish
  config. It's inert without a feed file, but it *is* update machinery, so shipping it in a release
  would contradict a verified "no auto-update" posture. The release workflow deletes every
  `dist/*.blockmap` before creating the release and re-runs verification in strict mode
  (`KIRA_STRICT_UPDATE_CHECK=1`), which turns a leftover blockmap into a hard failure. A local
  `bun run package:mac` still leaves one behind — `bun run verify:packaging` reports it as a note,
  not a failure, so ordinary local builds stay ergonomic.

`bun run verify:packaging` (`scripts/verify-packaging.sh`) is the command that re-checks all of the
above, both locally and in CI (`checks` and `package-smoke`), and is what the release workflow runs
in strict mode before publishing an artifact.

**What a future auto-update would require, in order:** code signing and notarization (SPEC.md
§1/§3), then a SPEC.md scope change reversing "no auto-update", then an update feed and
`electron-updater` wiring. None of that is P15's job.

**Whether the release workflow has actually run:** *the release workflow has not yet been run; the
first tag pushed to this repository is its first execution.*
