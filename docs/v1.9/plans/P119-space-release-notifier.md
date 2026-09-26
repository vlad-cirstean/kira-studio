# P119 — Kira Space release feed and update notifier: plan

Opus planning pass. Plan only. Nothing here is implemented yet. Base: `5d2bdac2`. Sites are
`file:line` against that commit. The implementer re-reads each site before editing.

Path shorthands: `ST/` = `apps/kira-studio/`, `SF/` = `apps/kira-studio/frontend/src/`,
`KS/` = `apps/kira-space/`, `KF/` = `apps/kira-space/frontend/src/`, `WB/` =
`packages/workbench/src/`, `AU/` = repo-root `internal/appupdate/` (new).

## §0 Goal, method, acceptance

**Goal.** One shared `v*.*.*` tag builds, stamps, verifies and drafts both apps' DMGs under one
GitHub Release. Kira Space gets the same "Update available" status-bar item Kira Studio has. Each
app's checker picks its own DMG out of the one shared release's asset list.

**Method.** CodeGraph `codegraph_explore` first, on: `appupdate.Checker`/`isReleaseBuild`/
`NewChecker` and every caller; both `main.go` service lists and `shell.NewDeferredBrowser`; both
bridges' `Browser`/`LinkService`/`KeepAwakeService`/`WindowsService`; `createCoreControl`/
`CoreBindings`; `createKeepAwakeStore`/`createAppMetricsStore`; `useAppUpdateStore`/
`initAppUpdate`; both `StatusBar.vue`, both `App.vue`, both `bridge/index.ts`. Then Read, in full:
`.github/workflows/release.yml`, `docs/pending-changes/.github__workflows__release.yml.patch`,
`scripts/verify-packaging.sh` (S5, S9, S10, Space A1-N3), `docs/DEV_ENVIRONMENT.md:15-40`,
`docs/PACKAGING.md` §7-§8, `docs/ARCHITECTURE.md:2341-2372`, P116's plan and result section.

**Acceptance.** Restated from the SPEC row, made testable:

1. **Release job.** One `release` job, on one tag, stamps `ST/build/config.yml`,
   `KS/build/config.yml` and `apps/kira-space-vscode/package.json` to the tag. It runs
   `bun run package:studio` then `bun run package:space`. It names the images
   `kira-studio-macos-arm64.dmg` and `kira-space-macos-arm64.dmg`. `verify:packaging` runs with both
   bundles present, so Space's A1/A3/A5/A6/N2/A4/N3 checks actually execute. The explicit
   bundle/DMG assertion step covers both apps. One `gh release create` call attaches both DMGs to
   one draft. No second job, no `gh release upload`. Lands as a `docs/pending-changes/` patch.
   Check: `git apply --check` passes, and the patched file parses as YAML and matches §1's target.
2. **Stamped Space, behind latest.** A Space build stamped with a version lower than the latest
   published release's tag shows `[data-testid="update-available"]` reading `Update <tag>`.
3. **Own asset only.** Clicking it opens Space's own `kira-space-macos-arm64.dmg`
   `browser_download_url` from that release. It never opens Studio's asset. The same holds for
   Studio in reverse. A release missing this app's own DMG shows no item for this app. Check: §2's
   unit table, plus §5.3 on a Mac once a real two-asset release is published.
4. **Dev build shows nothing.** `KS/build/config.yml`'s `"0.0.0"` sentinel makes no request and
   shows no item. This holds already via `AU/version.go`'s `isReleaseBuild` (moved, unchanged).
   Check: Space UI spec's default case, plus `bun run dev:space` on a Mac.
5. **One implementation.** Both apps bind the same `AU/` checker, the same
   `WB/state/createAppUpdateStore.ts` and the same `WB/components/AppUpdateItem.vue`. Space has no
   reimplementation of any of them. Check: §5.2 greps.

## §1 Release workflow — one job, both apps

### §1.1 Current state (verified)

- `.github/workflows/release.yml:52-187` is Studio-only. It stamps `ST/build/config.yml`
  (`:88-95`) and `apps/kira-studio-vscode/package.json` (`:100-103`). It runs `bun run package`
  (`:111`), copies Studio's DMG (`:116`), runs `verify:packaging` (`:119`), asserts Studio's bundle
  (`:124-140`), and runs `gh release create` with one asset (`:175-181`).
- **Two lines in the live file are already broken.** `bun run package` no longer exists
  (`a93eca58` renamed it `package:studio`; root `package.json` has no `"package":` key).
  `apps/kira-studio-vscode` no longer exists (`7329c146` renamed it `apps/kira-space-vscode`).
- **A pending patch already exists for this file.**
  `docs/pending-changes/.github__workflows__release.yml.patch` (132 lines, `git apply --check`
  clean at base). It fixes both broken lines. It also adds a **separate `release-space` job**
  (`needs: [..., release]`, then `gh release upload`). That is P100 Part 3's per-job design. The
  SPEC row replaces it: extend the existing `release` job, one `gh release create` with both
  assets.
- `docs/DEV_ENVIRONMENT.md:36-40`: never recreate a pending file for the same target. So P119
  **rewrites that same patch file**. Its P106 rename and vscode retarget fold into the new content.
  The `release-space` job is dropped.
- `scripts/verify-packaging.sh:228-315` already carries Space's A1/A3/A5/A6/N2 (bundle) and
  A4/N3 (DMG) checks, gated on the bundle existing. `:106-123` S9 already checks the vscode manifest
  against `KS/build/config.yml`. `:140-149` S5 already reads both `package:*` scripts. No
  `verify-packaging.sh` change is needed for the packaging side. S10 changes for §2, see §2.4.
- `scripts/setup.sh:121-133` already generates both apps' bindings.

### §1.2 Target `release` job

Keep `test-matrix` and `db-compat` jobs unchanged. Replace `release.yml:52-187` with the block
below. The implementer writes it to a scratch copy, never to `.github/workflows/`.

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
      # its build reads a version (each Taskfile.yml's APP_VERSION). From there it is linked into the
      # binary and stamped into Info.plist; verify:packaging's A5 asserts both bundles carry it.
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
      # platform-qualified name its release asset carries. internal/appupdate matches on these exact
      # names (each app's main.go passes its own), so renaming one breaks that app's update item.
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
            # P10 ships the .dmg, so this opens the real thing: the image mounts, the app is inside
            # it, and so is the /Applications shortcut the install gesture needs.
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

          This release carries two apps, versioned together:

          - **Kira Studio** (database and API client): `kira-studio-macos-arm64.dmg`
          - **Kira Space** (git client): `kira-space-macos-arm64.dmg`

          ## Install

          1. Open the downloaded disk image.
          2. Drag the app onto the **Applications** shortcut inside it.

          ## First launch: Gatekeeper warning

          These builds aren't signed by Apple, so macOS blocks each one the first time you open it.
          Either of these fixes it:

          - Right-click the app (or the disk image, if it's blocked at that step instead) and
            choose **Open**.
          - Or run this in Terminal, once for the disk image and once for the installed app:

            ```
            xattr -dr com.apple.quarantine ~/Downloads/kira-studio-macos-arm64.dmg
            xattr -dr com.apple.quarantine "/Applications/Kira Studio.app"
            xattr -dr com.apple.quarantine ~/Downloads/kira-space-macos-arm64.dmg
            xattr -dr com.apple.quarantine "/Applications/Kira Space.app"
            ```

            (adjust the disk image paths if you saved them somewhere else)

          ## No auto-update

          New versions don't install themselves. Each app's status bar shows when a newer release
          exists; clicking it downloads that app's disk image in your browser. See
          docs/PACKAGING.md §7 for why, and what would need to change first.
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

Notes on choices:
- **Bindings cache key unchanged.** `actions/cache` versions an entry by its path list, so the
  four-path entry never collides with `pr.yml`'s Studio-only entry under the same key.
  `setup.sh:121-133` regenerates on a stale checksum regardless.
- **Stamp regex safety.** `KS/build/config.yml` has one two-space `  version:` line (`:14`);
  `:4` is unindented. `apps/kira-space-vscode/package.json:8` is the one two-space `"version"`.
  The `test` line after each rewrite fails the job if either assumption breaks.

### §1.3 Regenerating the pending patch

Build from the **unpatched** live file, never on top of the old patch.

```sh
S=<scratchpad>/p119-release; mkdir -p "$S"
cp .github/workflows/release.yml "$S/release.yml.orig"
cp .github/workflows/release.yml "$S/release.yml.new"
# edit $S/release.yml.new: replace lines 52-187 with §1.2's block
python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" "$S/release.yml.new"
{
  printf '%s\n\n' "Note: P119 — one release job builds, stamps, verifies and drafts BOTH apps under one shared tag and one release (supersedes P100 Part 3's separate release-space job); also carries P106's package -> package:studio rename and P100 Part 3's apps/kira-studio-vscode -> apps/kira-space-vscode stamp retarget. Apply with 'git apply' against .github/workflows/release.yml, then delete this file."
  diff -u --label a/.github/workflows/release.yml --label b/.github/workflows/release.yml \
    "$S/release.yml.orig" "$S/release.yml.new"
} > docs/pending-changes/.github__workflows__release.yml.patch
git apply --check docs/pending-changes/.github__workflows__release.yml.patch
cp "$S/release.yml.orig" "$S/check.yml"
patch -s "$S/check.yml" < docs/pending-changes/.github__workflows__release.yml.patch
cmp "$S/check.yml" "$S/release.yml.new"
```

`diff -u` exits 1 when files differ. Run it inside the `{ }` group without `set -e`. `git status`
must show only the `.patch` file changed, never `.github/workflows/release.yml`.

## §2 Hoist `appupdate` to repo-root, per-app asset

### §2.1 Current state (verified)

- `ST/internal/appupdate/checker.go` (229 lines) and `version.go` (38), plus `checker_test.go`
  (103) and `version_test.go` (81).
- **Callers (CodeGraph):** `ST/main.go:25` import, `:130` `appupdate.NewChecker(buildinfo.Version)`;
  `ST/internal/bridge/update.go:6` import, `:28` `Checker *appupdate.Checker`, `:32`
  `appupdate.Result`. Nothing else outside the package. No Space caller.
- **The one blocker to a straight move:** `checker.go:25` imports `ST/internal/buildinfo` for the
  User-Agent (`:212` `"Kira Studio/"+buildinfo.Version`). Go's `internal/` rule forbids a repo-root
  package importing `apps/kira-studio/internal/...`. The running version is already
  `Checker.running` (`:70`), so the User-Agent builds from that plus the app name.
- **Why the checker needs an asset today:** `buildResult` (`:147-158`) keeps only `html_url`.
  `safeReleaseURL` (`:175-187`) accepts any path under `/releases/`. The release page lists both
  DMGs, so neither app can open "its own" asset from it.
- Placement convention: repo-root shared Go packages live flat under `internal/`
  (`internal/keepawake`, `internal/metrics`, `internal/sqlitex`, `internal/terminal`,
  `internal/startupfail`). P116 H2/H4 used `git mv` plus a caller-side name parameter
  (`metrics.NewAppTicker(appName)`). Follow that.

### §2.2 New API

```go
// App is one app's own slice of the shared release: both apps ship under one tag, so the tag
// cannot tell them apart — only the asset name can.
type App struct {
	Name      string // User-Agent product token: "Kira Studio" / "Kira Space"
	AssetName string // this app's own DMG in the release: "kira-studio-macos-arm64.dmg"
}

func NewChecker(app App, runningVersion string) *Checker
```

- `Checker` gains `asset string`. `fetch` stays the `func(ctx) (release, error)` seam. `NewChecker`
  sets it to a closure calling `httpFetch(ctx, app.Name+"/"+runningVersion)`. `httpFetch` takes the
  User-Agent as a parameter. `buildinfo` import goes.
- `release` gains `Assets []asset` with `asset{Name string "json:name"; State string "json:state";
  BrowserDownloadURL string "json:browser_download_url"}`.
- `buildResult(running, assetName string, rel release)`:
  1. Draft or prerelease: no update. Unchanged.
  2. Not strictly newer: no update. Unchanged.
  3. No asset named `assetName` with `State == "uploaded"`: **no update**. That release has nothing
     this app can install. Same "one `if` against a server-side guarantee" reasoning as the
     draft/prerelease guard.
  4. Otherwise `UpdateAvailable = true`, `releaseURL = safeAssetURL(url, rel.TagName, assetName)`.
- `safeAssetURL` replaces `safeReleaseURL`. It returns raw only when: scheme `https`, host
  `github.com`, empty query and fragment, and `u.Path` equals exactly
  `"/"+repoOwner+"/"+repoName+"/releases/download/"+tag+"/"+assetName`. Anything else returns
  `releasesPageURL`. The exact-path match is what makes "never the other app's asset" hold even if
  an asset's own name and URL disagree.
- `ReleaseURL()` and `Result.releaseURL` keep their names. The asset lives inside the release, and
  renaming would change the bound `UpdateService.OpenReleasePage` FQN, every generated binding and
  both mock tables for no behavior gain. Update doc comments only.
- **Declined parameter: bundle identifier.** The SPEC row lists asset filename, display name and
  bundle identifier as the per-app distinguishers. The releases API exposes asset names, never a
  bundle identifier, so the checker has no use for one. An unused field is scaffolding
  (CLAUDE.md). Asset name discriminates; display name feeds the User-Agent. Record this in the
  result section so the orchestrator can confirm it with the user.
- **Each app's literals live in its own `main.go`**, the `metrics.NewAppTicker("Kira Space")`
  precedent. Add one comment naming `release.yml`'s "Name the signed disk images" step as the other
  place each name is written.

### §2.3 Behavior change, both apps (deliberate)

Clicking the item now opens the app's own DMG download link. It used to open the release page.
Studio changes too: one shared checker, and the SPEC row asks for each app's own asset. The
browser performs the download after a user click. The app still downloads and installs nothing.
The shared item's tooltip changes from "Opens GitHub in your browser." to "Downloads it from
GitHub in your browser." Record this in the result section as the one user-visible Studio change.

### §2.4 S10 guard (`scripts/verify-packaging.sh:125-132`)

S10 greps `apps/ packages/` for `browser_download_url|releases/download`. The hoisted package sits
in `internal/`, outside that scan. It would pass by location alone. That is a shortcut, not
compliance. S10's real intent is "the app never downloads an artifact in-process". Rewrite S10 to
guard that intent directly:

- **S10:** scan `apps/ packages/ internal/`. Exclude only `internal/appupdate/`. Fail on any hit.
- **S10b (new):** `internal/appupdate`'s non-test Go makes exactly one HTTP request, a GET to
  `latestReleaseURL`. A second request, or one with any other URL, fails:

```sh
REQS="$(grep -rhoE 'http\.(NewRequest(WithContext)?|Get|Head|Post|PostForm)\([^)]*' internal/appupdate \
  --include='*.go' --exclude='*_test.go')"
if [ "$REQS" != 'http.NewRequestWithContext(ctx, http.MethodGet, latestReleaseURL, nil' ]; then
  fail "update check requests more than releases/latest" "internal/appupdate must make exactly one request, a GET to latestReleaseURL; the asset URL is only ever handed to the OS browser"
fi
```

Update both checks' header comments: the asset URL is decoded and validated here, then handed only
to `Browser.OpenURL`.

### §2.5 Tests

Per CLAUDE.md's bar:
- `version_test.go`: moves unchanged. Semver and dev-sentinel logic is untouched. No new cases.
- `checker_test.go`: `TestChecker_Status_SingleFlight`/`TestChecker_Status_CacheIntervals` move.
  Adjust only fixtures: `testRelease()` gains an uploaded asset with the right URL, and each
  `&Checker{…}` sets `asset`. `CacheIntervals` asserts `UpdateAvailable` at its end
  (`checker_test.go:100-102`), so without the asset fixture it fails. That is the check that the
  fixture is right.
- **New: `TestBuildResult_PerAppAsset`**, one table-driven test. This is the one piece with real
  interacting rules: name match, upload state, exact-path URL validation and fallback. It is also
  the security property "never open the other app's asset". Rows, running `1.0.0`, tag `v1.1.0`
  unless stated:
  1. Both assets present, asset = Space's: update, URL = Space's.
  2. Both assets present, asset = Studio's: update, URL = Studio's.
  3. Only Studio's asset present, asset = Space's: no update.
  4. Space's asset with `state: "open"`: no update.
  5. Asset named Space's but URL ends `/kira-studio-macos-arm64.dmg`: update,
     `Checker.ReleaseURL()` returns `releasesPageURL`.
  6. Space's asset URL on another host, another repo, another tag, or with a query: update, falls
     back to `releasesPageURL`. One row per variant is fine inside the same table.
  7. Tag equal to running (`v1.0.0`): no update even with the asset present.
- **No test** for: the `App` struct, User-Agent composition, `NewChecker`, Space's `UpdateService`
  (thin delegation, same as Studio's, which has none), the store factory, the component. That is
  thin wiring following an established pattern.
- **UI spec, not a unit test:** Space gets `KS/tests/ui/update-banner.spec.ts`, a two-case mirror
  of `ST/tests/ui/update-banner.spec.ts`. It is the only sandbox-runnable proof that Space's status
  bar is wired, which acceptance 2 and 4 need. Studio's existing spec guards the component hoist
  unchanged.

## §3 Space `UpdateService` and status-bar item, through P116's seams

### §3.1 Go

- **`KS/internal/bridge/update.go` (new):** Studio's `ST/internal/bridge/update.go:16-51` minus the
  `Browser` interface. Space already declares that interface in `KS/internal/bridge/browser.go:6-8`.
  Contents: `UpdateStatus` (same three JSON fields), `UpdateService{Checker *appupdate.Checker;
  Browser Browser}`, `toWireUpdateStatus`, `Status(ctx)`, `OpenReleasePage()`. Precedent for a
  per-app bound copy over a shared primitive: `KS/internal/bridge/keepawake.go:13-28` (own
  `KeepAwakeService` plus own `KeepAwakeStatus` over `internal/keepawake`). A bound type must stay
  in each app's own `internal/bridge`. Wails derives the binding path and FQN from its package.
  Both apps' `@bindings/*` aliases and both mock tables' `BRIDGE_PKG` key on that path.
- **`KS/internal/bridge/browser.go:3-5`:** the comment says Space has no `UpdateService` yet.
  Rewrite it to say `update.go`'s `UpdateService` and `GitHubService` both consume this interface.
- **`KS/main.go`:** after `:111` `shell.NewDeferredBrowser()`, add
  `updateChecker := appupdate.NewChecker(appupdate.App{Name: "Kira Space", AssetName:
  "kira-space-macos-arm64.dmg"}, buildinfo.Version)`, with Studio's `ST/main.go:127-129` comment
  (no goroutine, no teardown). Register
  `application.NewService(&bridge.UpdateService{Checker: updateChecker, Browser: browserOpener})`
  in `:197-210`. `attachBrowser(app)` (`:231`) already covers it. Update the startup-order header
  comment (`:43-46`) listing the services.
- **`ST/main.go:130`:** `appupdate.NewChecker(appupdate.App{Name: "Kira Studio", AssetName:
  "kira-studio-macos-arm64.dmg"}, buildinfo.Version)`. Import path `:25` moves to
  `github.com/kirathecat/kira-studio/internal/appupdate`. Same for `ST/internal/bridge/update.go:6`.
- Regenerate bindings (`sh scripts/setup.sh`) after the Go commit. Space gains
  `@bindings/updateservice.js` and `UpdateStatus` in its models.

### §3.2 Shared control seam (`WB/bridge/createCoreControl.ts`)

H5's pattern:
- `CoreBindings` (`:36-81`) gains `update: { Status(): Promise<unknown>; OpenReleasePage():
  Promise<void> }`.
- Declare `export interface UpdateStatus { updateAvailable: boolean; currentVersion: string;
  latestVersion: string }` beside `KeepAwakeStatus` (`:93-98`). It follows the same "restated, not
  imported from `@bindings`" reasoning.
- `CoreControl` (`:109-160`) gains `updateStatus: () => Promise<UpdateStatus>` and
  `updateOpenReleasePage: () => Promise<void>`. `createCoreControl` (`:162-239`) implements them as
  `unwrap(b.update.Status()).then((r) => trust<UpdateStatus>(r))` and
  `unwrap(b.update.OpenReleasePage())`.
- Header comment (`:5-34`): add a P119 sentence. Recount the moved-method totals in it and in
  `SF/bridge/index.ts:60-67` and `KF/bridge/index.ts:122-124` by counting the actual objects, not
  by arithmetic on the old numbers.
- `SF/bridge/index.ts:70-71`: delete `updateStatus`/`updateOpenReleasePage` from `studioControl`.
  Pass `update: UpdateService` in Studio's `createCoreControl` call.
- `KF/bridge/index.ts:1-12,126-136`: import `* as UpdateService from '@bindings/updateservice.js'`
  and pass `update: UpdateService`.

### §3.3 Shared store factory (`WB/state/createAppUpdateStore.ts`, new)

- Store id `appUpdate`. Body = `SF/state/appUpdate.ts:5-37`. Control interface
  `AppUpdateControl { updateStatus(): Promise<UpdateStatus> }`, the `AppMetricsControl` precedent
  (`WB/state/createAppMetricsStore.ts:8-10`). No `extend` seam. Neither app adds anything.
- **Swap the raw `setInterval` (`SF/state/appUpdate.ts:34`) for VueUse `useIntervalFn`.**
  CLAUDE.md's VueUse rule applies to a new shared surface. Precedent in this package:
  `WB/util/usePendingDecision.ts:1,29`. Use `useIntervalFn(() => void poll(), POLL_MS,
  { immediate: false, immediateCallback: true })`. `initAppUpdate()` returns early when
  `isActive.value`, else calls `resume()`. `isActive` replaces the `started` flag. It runs inside
  Pinia's setup-store effect scope, so VueUse's scope-dispose hook has a scope.
- TanStack Query declined for this store, with two named reasons. The SPEC row names a
  `createAppUpdateStore` factory. Go already owns the cache (`AU/checker.go:45-50` 6h/30m plus
  singleflight). The renderer has no loading or error surface to drive: a failure is silence and
  keeps the previous state.
- `SF/state/appUpdate.ts` becomes `export const useAppUpdateStore = createAppUpdateStore(control);`
  plus a one-line P119 comment. `KF/state/appUpdate.ts` (new) is identical.

### §3.4 Shared component (`WB/components/AppUpdateItem.vue`, new)

- H7's pattern (`WB/components/TitleBarWindowActions.vue:12-13`: props in, emits out, no control
  import). Move verbatim from `SF/workbench/StatusBar.vue`: the `Tooltip`/button markup (`:85-97`),
  the `updateTooltip` computed (`:38-42`, with §2.3's text change), and the Tailwind comment
  (`:132-140`) that belongs to that button.
- Props: `available: boolean; currentVersion: string; latestVersion: string`. Emits: `open`. Keep
  `data-testid="update-available"`, the `cloud-download` icon, the `Update {{ latestVersion }}`
  text and the button's utility classes exactly.
- `SF/workbench/StatusBar.vue`: render `<AppUpdateItem … @open="onOpenReleasePage" />` first in
  `#right`, where it is today. Keep `onOpenReleasePage` (`:44-46`) app-side. The control call stays
  per-app, the H7 rule. Drop the now-unused `updateTooltip`. Update the `:16-18` header comment.

### §3.5 Space frontend

- `KF/workbench/StatusBar.vue`: import `useAppUpdateStore` and `control`. Render `AppUpdateItem`
  first in `#right` (`:58-60`), before `AppMetricsItem`. That matches Studio's order. Add
  `onOpenReleasePage` as Studio's (`void control.updateOpenReleasePage().catch(() => {})`). Update
  the `:17-19` header comment.
- `KF/main.ts`: after `app.mount('#app')` (`:93`), call `useAppUpdateStore().initAppUpdate();` with
  Studio's `SF/main.ts:370-371` comment (off the critical path). Rewrite the `:21-27` header
  comment. It says Space has no appUpdate store.

### §3.6 Space UI support and spec

- `KS/tests/ui/support/ipcChannels.ts`: add `updateStatus: 'kira:update:status'`,
  `updateOpenReleasePage: 'kira:update:openReleasePage'` (Studio's values,
  `ST/tests/ui/support/ipcChannels.ts:146-147`).
- `KS/tests/ui/support/mockRuntime.ts`: `FQN_SUFFIX_BY_IPC_KEY` (`:66-70`) gains
  `updateStatus: 'UpdateService.Status'`, `updateOpenReleasePage: 'UpdateService.OpenReleasePage'`.
  `WILDCARD_DEFAULTS` (`:87-116`) gains Studio's two entries (`ST/tests/ui/support/mockRuntime.ts:
  330-339`), since `initAppUpdate` polls on every boot. `bootSnapshots.ts` needs nothing
  (its own `:15` rule).
- `KS/tests/ui/update-banner.spec.ts` (new): Studio's two cases. In case 1, drop the
  `engine-status` assertion, which is Studio-only. Keep `[data-testid="status-bar"]` visible. It
  comes from the shared `WB/components/WorkbenchShell.vue:227`, so Space renders it too. Add
  `[data-testid="caret-status"]` visible (`WB/components/StatusBar.vue:19`) as the
  other-readouts-unaffected check.

## §4 Split assessment and commit sequence

**Call: one sequential Sonnet implementer. No stream split.** Candidate streams: CI patch; Go
hoist; frontend. CLAUDE.md's test fails on both counts:
- **Ordering dependency.** Space's frontend needs `@bindings/updateservice.js`. That only exists
  after Space's Go `UpdateService` lands and bindings regenerate. `createCoreControl`'s `update`
  binding needs both apps' binding modules. The S10 rewrite must land with the checker code that
  first decodes `browser_download_url`.
- **File overlap.** `docs/ARCHITECTURE.md` and `docs/PACKAGING.md` take edits from every stream.
  `scripts/verify-packaging.sh` (S10) belongs to both the Go and CI work. `ST/main.go` gets the
  hoist's import move and the asset literal.

The asset names are fixed by this plan: `kira-studio-macos-arm64.dmg` is already live, and
`kira-space-macos-arm64.dmg` comes from the SPEC row. So the CI patch has no runtime dependency
on the Go work. Overlap alone still rules out a split.

Commits, in order. Each lands as it completes. Run §5.1's fast checks per commit.

1. `refactor: hoist appupdate to repo-root internal, name the app per checker` — `git mv
   ST/internal/appupdate internal/appupdate`. Add `App{Name}` only, with `AssetName` in commit 2
   so no field sits unused. `NewChecker(app, version)`. User-Agent from `app.Name`. Drop the
   `buildinfo` import. Update `ST/main.go:25,130` and `ST/internal/bridge/update.go:6`. Studio's
   behavior is unchanged apart from the User-Agent's source.
2. `feat(appupdate): pick each app's own DMG out of the shared release` — `App.AssetName`,
   `release.Assets`, `buildResult`'s rule 3, `safeAssetURL`, test fixture updates,
   `TestBuildResult_PerAppAsset`, `ST/main.go` passes Studio's asset name, and S10/S10b in
   `scripts/verify-packaging.sh` (§2.4). Run `bun run verify:packaging` here: S10/S10b pass,
   artifact checks skip on Linux.
3. `feat(kira-space): bind UpdateService over the shared appupdate checker` — §3.1 Space Go, the
   `browser.go` comment, then `sh scripts/setup.sh`.
4. `refactor(workbench): hoist update-status control methods into createCoreControl` — §3.2.
5. `refactor(workbench): add createAppUpdateStore` — §3.3. Studio switched.
6. `refactor(workbench): add AppUpdateItem` — §3.4. Studio switched. Run
   `ST/tests/ui/update-banner.spec.ts` once here: `bun run build:test:studio && npx playwright test
   --config=apps/kira-studio/playwright.config.ts --project=ui update-banner`.
7. `feat(kira-space): update-available status-bar item` — §3.5.
8. `test(kira-space): update-banner UI spec` — §3.6.
9. `ci: stage one-job two-app release as a pending release.yml patch` — §1.3. Rewrites the
   existing pending file. Nothing under `.github/workflows/` is touched.
10. `docs: record shared update check and one-tag two-app release` — see below.
11. `docs(v1.9): record P119 result` — `## P119 result` in `docs/v1.9/SPEC.md`. Include the commit
    table, §2.2's declined bundle-identifier parameter, §2.3's Studio click-target change, the
    pending patch still awaiting a `workflow`-scoped push, and §5.3's outcome or why it could not
    run yet.

Commit 10 touches:
- `docs/ARCHITECTURE.md:2341-2372` (P66 section): the checker is repo-root `internal/appupdate`,
  shared by both apps. Each app passes its own `App{Name, AssetName}`. A release missing this app's
  DMG shows nothing. The click opens that app's own validated asset URL. Rewrite the "Nothing is
  ever downloaded" bullet: the browser downloads after a click, the app never does. S10/S10b keep
  that true. `safeReleaseURL` becomes `safeAssetURL`'s exact-path rule. `internal/bridge.
  UpdateService` becomes "each app's own".
- `docs/ARCHITECTURE.md` Kira Space banner (`:2395-2400`, P116's sentence): add the update item
  to Space's status-bar list and `AppUpdateItem.vue`/`internal/appupdate` to its shared-primitive
  list.
- `docs/PACKAGING.md:369-381` ("Cutting a release"): stamps both config.yml files plus the vscode
  manifest, runs both `package:*` scripts, one draft with both DMGs. `:390` S5 bullet: both
  `package:*` scripts, not `package`. `:409-410` S10 bullet plus a new S10b bullet.
  `:417-426` P66 paragraph: both apps, asset link. §8 (`:455-`): Space releases ride the same tag
  and draft.
- Leave historical SPEC rows and older plans alone.

| Area | Files |
| --- | --- |
| Shared Go | `internal/appupdate/**` (moved plus edits) |
| Studio Go | `ST/main.go`, `ST/internal/bridge/update.go` |
| Space Go | `KS/main.go`, `KS/internal/bridge/{update,browser}.go` |
| Shared frontend | `WB/bridge/createCoreControl.ts`, `WB/state/createAppUpdateStore.ts`, `WB/components/AppUpdateItem.vue` |
| Studio frontend | `SF/bridge/index.ts`, `SF/state/appUpdate.ts`, `SF/workbench/StatusBar.vue` |
| Space frontend | `KF/bridge/index.ts`, `KF/state/appUpdate.ts`, `KF/workbench/StatusBar.vue`, `KF/main.ts` |
| Space tests | `KS/tests/ui/update-banner.spec.ts`, `KS/tests/ui/support/{ipcChannels,mockRuntime}.ts` |
| Scripts/CI | `scripts/verify-packaging.sh`, `docs/pending-changes/.github__workflows__release.yml.patch` |
| Docs | `docs/ARCHITECTURE.md`, `docs/PACKAGING.md`, `docs/v1.9/SPEC.md` (result only) |

Resume rule: this doc plus the commit log is the full state. An interrupted run resumes at the
first commit above not yet in `git log`.

## §5 Verification

### §5.1 Per commit (fast)

- Go commits: `go build ./...`, `bun run lint:go`, `go test ./internal/appupdate/...
  ./apps/kira-studio/internal/bridge/... ./apps/kira-space/internal/bridge/...`.
- Every commit: `bun run lint`, `bun run typecheck` (the pre-commit hook runs both).

### §5.2 Once, near phase end (full)

- `bun run test:go`, `bun run test:unit`.
- `bun run test:ui:studio`, `bun run test:ui:space`. Space's run includes the new spec.
- `bun run lint:dead`: every new export has a real caller in both apps.
- `bun run verify:packaging` passes.
- `git apply --check docs/pending-changes/.github__workflows__release.yml.patch`, plus §1.3's
  `cmp` and YAML parse.
- Orchestrator greps (real checks, not subagent prose):
  - `test ! -d apps/kira-studio/internal/appupdate` and
    `grep -rn "apps/kira-studio/internal/appupdate" --include=*.go .` gives 0.
  - `grep -rn "kirathecat/kira-studio/internal/appupdate" apps/*/main.go apps/*/internal/bridge/update.go`
    gives 4 hits, 2 per app.
  - `grep -n "AssetName:" apps/*/main.go` gives `kira-studio-macos-arm64.dmg` in Studio's and
    `kira-space-macos-arm64.dmg` in Space's. Both names appear in the pending patch's `cp` step and
    its `gh release create` line.
  - `grep -n "bridge.UpdateService" apps/kira-space/main.go` gives 1 hit.
  - `grep -rn "createAppUpdateStore" apps/*/frontend/src/state` gives 2 hits, one per app.
    `grep -rn "AppUpdateItem" apps/*/frontend/src/workbench` gives 4 hits, 2 per app.
  - `grep -rn "updateStatus\|updateOpenReleasePage" apps/kira-studio/frontend/src/bridge/index.ts`
    gives 0. Both live in `createCoreControl.ts` only.
  - `grep -n "setInterval" packages/workbench/src/state/createAppUpdateStore.ts` gives 0, and
    `grep -n "useIntervalFn"` on the same file gives a hit.
  - The pending patch has exactly one `gh release create` and no `release-space:` or
    `gh release upload`.
  - `git diff 5d2bdac2 --stat -- .github/workflows/` is empty.
  - `grep -n "TestBuildResult_PerAppAsset" internal/appupdate/checker_test.go` gives 1 hit.

### §5.3 Manual, on a Mac (implementer's job when on macOS)

A Linux sandbox cannot run a packaged app or reach a real published two-asset release. If the
implementer's session is Linux-only, it stops after §5.2 and says so. The phase stays open until
this checklist runs.

1. `bun run dev:space`: no update item appears. The dev sentinel means no request is made.
2. Apply the pending patch from a `workflow`-scoped session. Push a tag, let the draft build, and
   confirm it carries both DMGs. Run PACKAGING §4 against both, then publish.
3. Locally set `KS/build/config.yml`'s version to one below that tag. Do not commit it. Run
   `bun run package:space` and open the app. The item shows `Update <tag>`. Clicking it downloads
   `kira-space-macos-arm64.dmg` in the browser, not Studio's DMG.
4. Repeat step 3 for Studio (`ST/build/config.yml`, `bun run package:studio`). The click downloads
   `kira-studio-macos-arm64.dmg`.
5. Revert both local version edits.
