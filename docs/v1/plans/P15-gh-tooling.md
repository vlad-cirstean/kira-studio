# P15 — GitHub tooling: pre-commit hook, macOS CI, tag-triggered build, auto-update verification

> Plan for SPEC.md §10 phase **P15**. Deliverable: *Pre-commit hook; GitHub Actions CI
> (macOS-only); tag-triggered unsigned macOS binary build; auto-update configuration verified.
> Last, since CI and release tooling should target a finished, documented build rather than a
> moving one.*
>
> This is a tooling phase. **No `src/` changes, no `tests/` changes, no behaviour changes.** The
> non-Markdown edits permitted are: two new `package.json` script entries, one comment line in
> `electron-builder.yml`, and the new files listed in §1.

## 0. Ground rules for this phase

- **Automate only what a contributor already runs by hand.** Every CI step must be a script that
  exists in `package.json` today, or a check `docs/PACKAGING.md` already asks a human to perform.
  P15 does not invent new quality gates, new lint rules, or new test tiers.
- **Least tooling surface.** This repo uses Biome instead of ESLint+Prettier, `tsgo`/`vue-tsc`
  instead of a bundled toolchain, Bun instead of npm+a test runner. A hook manager, a
  staged-file runner, or a release-notes generator would each be a new dependency doing what one
  line of existing tooling already does. §3 and D2 record where that line is drawn.
- **Nothing in this phase may reverse a scope decision made in SPEC.md.** §2 is the phase's one
  genuinely ambiguous call and it is decided against adding a feature, with the reasoning written
  down.
- **Workflows cannot be executed from this environment.** The dev container is Linux; there is no
  macOS runner and no way to trigger Actions locally. The implementing session verifies what is
  locally verifiable (§10 steps 1–6), pushes, then **reads the actual run** and records the result
  (§10 steps 7–9). It must not write "CI is green" into any doc before seeing a green run — the
  same standard `docs/PACKAGING.md` §4 already holds itself to with its *not yet run* rows.
- **Pushing `.github/workflows/*` needs the `workflow` token scope.** A token without it gets
  `refusing to allow ... to create or update workflow ... without 'workflow' scope` at push time.
  If that happens, do **not** work around it by renaming the files or moving them out of
  `.github/workflows/`: stop, report it, and let the user push that commit or grant the scope.
- **Commits follow Conventional Commits** (`AGENTS.md`): `ci:` for the workflows and the hook,
  `docs:` for the documentation edits. The phase's last step is to land its commits on the v1
  feature branch per SPEC.md §12.
- Run `bun run lint`, `bun run typecheck` and `bunx electron-vite build` before committing (the
  `package.json` edit in D3 is the reason for the last two). The DB and UI suites do not need a
  local re-run for a tooling phase — CI is what newly runs them.

### Realities this phase works with (verified against the tree, 2026-08-23)

1. **There is no `.github/` directory, no hook manager, and no populated `.git/hooks/`.**
   `package.json` has no `husky`, `simple-git-hooks`, `lint-staged`, or `prepare` script;
   `.git/hooks/` contains only the stock `*.sample` files.
2. **The repo is public** (`vlad-cirstean/kira-studio`, `"visibility": "public"`,
   `"default_branch": "main"`), so GitHub-hosted macOS runners are available at no per-minute
   cost, within the standard public-repo concurrency limits. There are **no tags** in the repo yet.
3. **`main` is the default branch but not where v1 lives.** Work is on
   `claude/phases-p4-p12-fnvfqy`, replayed onto `feature/kickoff` per SPEC.md §12. Both
   `origin/main` and `origin/feature/kickoff` exist.
4. **Local checks are fast.** Measured in this container: `bun run lint` **0.35 s**;
   `typecheck:node` 1.0 s, `typecheck:web` 3.7 s, `typecheck:db` 0.6 s — **≈5.3 s for the full
   `bun run typecheck`**. Both exit 0 on the current tree. This is the measurement D1 rests on.
5. **Biome can already scope itself to staged files.** `biome check --staged` exists in 2.5.9
   (`--staged`, `--changed`, `--since=REF`, `--no-errors-on-unmatched`) and `biome.json` already
   sets `vcs: { enabled: true, clientKind: "git", useIgnoreFile: true }`. D1 declines to use it,
   with a reason.
6. **Bun runs the root package's `prepare` script on `bun install`.** Verified empirically in this
   container with a throwaway package (bun 1.3.11): both `prepare` and `postinstall` markers were
   written. This is what makes the zero-dependency hook bootstrap in §3 work.
7. **GitHub-hosted macOS runners have no Docker.** They do not support nested virtualization, so
   neither Docker Desktop nor Colima is available. `bun run test:db` therefore cannot run on them.
   SPEC.md §9.1 independently says so for its own reasons: *"Requires Colima … Local-only for now
   — no CI wiring in v1."*
8. **The UI suite degrades gracefully without Docker.** `tests/db/support/docker.ts`
   `isDockerAvailable()` swallows the `ENOENT` from a missing `docker` binary and returns `false`;
   every container-backed spec calls `test.skip(true, DOCKER_UNAVAILABLE_MESSAGE)` in
   `beforeAll`. Of 22 UI specs, **four are Docker-free** — `smoke.spec.ts`, `workbench.spec.ts`,
   `connections.spec.ts`, `startup.spec.ts` — and would really run in CI; the other 18 skip with a
   legible reason instead of failing.
9. **Playwright here never needs a browser download.** The suite only uses
   `_electron.launch()` against the Electron binary bun installs (`trustedDependencies:
   ["electron", "esbuild"]`), so no `playwright install` step is required in CI.
10. **`package.json`'s two packaging scripts hardcode `--publish never`** and
    `electron-builder.yml` has **no `publish:` key at all**, so electron-builder has no publish
    configuration to resolve.
11. **`dmg.writeUpdateInfo: false` is a dmg-only option.** In `app-builder-lib` 26.15.3 it is
    declared on `DmgOptions` (`out/options/macOptions.d.ts:329`, `@private`, `@default true`) and
    read at `dmg-builder/out/dmg.js:48`. `MacConfiguration` has no equivalent.
12. **The macOS `zip` target writes a `.blockmap` unconditionally.** `out/macPackager.js:117`
    constructs `new ArchiveTarget(name, outDir, this, true)` — the fourth argument is
    `isWriteUpdateInfo` — and `out/targets/ArchiveTarget.js:64` then calls `createBlockmap()` for
    every mac zip regardless of publish settings. Confirmed in the tree: P12's build left
    **`dist/Kira Studio-0.1.0-arm64.zip.blockmap`** (311 KB) next to the zip.
13. **The update *feed* file is never written.** `latest-mac.yml` comes from
    `PublishManager.writeUpdateInfoFiles()`, reached only when `getPublishConfigs()` returns a
    non-empty configuration (`out/publish/PublishManager.js:134-165`). With no `publish:` key and
    `--publish never` there is none — and indeed `dist/` contains **no `latest*.yml`**, only the
    zip, its blockmap, `builder-debug.yml` and `mac-arm64/`.
14. **Nothing in `src/` references an updater.** `grep -rn "autoUpdater\|electron-updater"
    src/ package.json` returns nothing. The only occurrence of the words "auto-update" in the repo
    is in `docs/SPEC.md`, `docs/PACKAGING.md`, `README.md` and the P12 plan — all of them saying
    there isn't one.
15. **Two docs name a zip artifact that the build does not produce.** `docs/PACKAGING.md` §1 and
    `README.md:94` both say `Kira Studio-0.1.0-arm64-mac.zip`, but `artifactName:
    ${productName}-${version}-${arch}.${ext}` yields `Kira Studio-0.1.0-arm64.zip` — which is what
    PACKAGING.md §3 recorded from the real build and what is on disk now. D11 fixes both lines.
16. **`docs/PACKAGING.md` §4 items 1–3 and 9 are macOS-only checks that a macOS runner can do**
    (ad-hoc signature, asar contents, unpacked `engine.js`, `.app` size). Items 4–8 need a human
    at a real machine (Gatekeeper flow, first-run `~/.kira-studio/` creation, click-through, cold
    start, RSS) and stay human.
17. **`README.md` has no badge and its "Not in v1" list ends with `… auto-update; unit tests;
    CI.`** P14 D8 deferred badges to this phase explicitly.
18. **`.gitignore` covers `dist`, `out`, `test-results/`, `playwright-report/`** and does not
    exclude `.github/` or dotted directories, so the new files are committable as-is.

---

## 1. The complete P15 file list

| Path | Action | Why |
|---|---|---|
| `.githooks/pre-commit` | **NEW** (mode `100755`) | §3 — the hook itself, checked into the repo. |
| `.github/workflows/ci.yml` | **NEW** | §5 — lint/typecheck/build, UI smoke, packaging smoke. |
| `.github/workflows/release.yml` | **NEW** | §6 — tag-triggered unsigned macOS build + draft release. |
| `scripts/verify-packaging.sh` | **NEW** (mode `100755`) | §4 — the executable form of "auto-update configuration verified". |
| `package.json` | **MOD**, two script lines | `prepare` (hook bootstrap, D2) and `verify:packaging` (D5). |
| `electron-builder.yml` | **MOD**, one comment | The `writeUpdateInfo: false` comment says "P15's call"; P15 makes it (D8). No key changes. |
| `docs/PACKAGING.md` | **MOD** | §1 zip name (D11); §4 rows CI now automates; §6 known-gaps line; new §7 (D9). |
| `README.md` | **MOD** | CI badge, script table rows, git-hooks note, zip name, "Not in v1" line, docs index (D12). |
| `docs/SPEC.md` | **MOD**, one line | Status line `P0–P14` → `P0–P15`. Nothing else. |
| `docs/plans/P15-gh-tooling.md` | **NEW** | This document. |

**Not created, deliberately:** any hook other than `pre-commit`; `.github/ISSUE_TEMPLATE/`,
`PULL_REQUEST_TEMPLATE.md`, `CODEOWNERS`, `dependabot.yml`, `SECURITY.md`, `CONTRIBUTING.md`; any
Linux or Windows CI job; any workflow that runs `bun run test:db`; any `electron-updater` wiring.
See §9.

---

## 2. The auto-update question — decision and reasoning

The P15 spec line ends with *"auto-update configuration verified"*, and it has two readings:

- **(a)** Build a real auto-updater — `electron-updater` plus a GitHub-Releases-backed feed — and
  "verify" that it works.
- **(b)** Verify that the shipped configuration deliberately produces **no** auto-update
  behaviour, end to end through the new CI/tag pipeline, and record that verification.

**Decision: (b).** Reasoning, from the spec itself and from the tree:

1. **The same document that contains the P15 line says "no auto-update" three times.** SPEC.md §1
   lists auto-update under *"Explicitly deferred"* alongside code signing and notarization; §3's
   app-identity line ends *"No auto-update."*; §10's P12 row scopes packaging to *"unsigned
   packaging"* only. A phase plan is not the right instrument for reversing a scope decision the
   spec states three times — that is a product call for whoever owns the spec, and SPEC.md's own
   preamble makes plans subordinate to it.
2. **Reading (a) is internally incoherent with the rest of v1.** Auto-update on macOS requires a
   *signed and notarized* app: Squirrel.Mac refuses to swap in an unsigned bundle, and §1/§3 defer
   signing past v1 (`mac.identity: '-'` is ad-hoc, carries no identity, and satisfies no Gatekeeper
   check — P12 D12). An updater built now could not update anything; it would be dead code plus a
   feed file, i.e. exactly the "half of an update channel nobody wired up" that P12 was avoiding.
3. **"Verified" is the operative word.** The other three P15 items are things to *build*
   (a hook, CI, a tag build); this one is phrased as a *verification*. Verification of an absent
   feature is a coherent, useful deliverable — and today the absence is genuinely unverified: the
   deferral lives in prose, and nothing prevents a future dependency bump, a builder-config edit,
   or a release workflow from quietly emitting an update feed.
4. **The tree agrees, but not completely — and that is why the verification has teeth.** Reality
   13 confirms no `latest-mac.yml` is produced. Reality 12 shows that electron-builder's macOS
   `zip` target writes a `.blockmap` — a *differential-update* artifact — unconditionally, and one
   is sitting in `dist/` right now from P12's build. It is inert without a feed file, but it is
   update machinery, and shipping it as a release asset would be the opposite of a verified "no
   auto-update" posture. D7 disposes of it explicitly rather than by silence.

So P15's auto-update deliverable is: **`scripts/verify-packaging.sh` (§4), run in both workflows
and available locally, plus `docs/PACKAGING.md` §7 recording the decision, the evidence, and what
would have to change if v1's successor ever wants updates.** No `electron-updater`, no feed, no
`publish:` block, no `autoUpdater` import.

**If a future reader disagrees:** the change is not a code change first, it is a SPEC.md §1/§3
change first, and it depends on signing/notarization landing before it.

---

## 3. Pre-commit hook

**Mechanism: a checked-in `.githooks/` directory plus `git config core.hooksPath`, bootstrapped by
a `prepare` script.** No new dependency (D2).

`package.json` gains, in `scripts`, next to the other entries:

```jsonc
"prepare": "git config core.hooksPath .githooks || true"
```

The `|| true` keeps `bun install` working where there is no git work tree or no `git` binary
(tarball checkouts, container images). Reality 6 confirms bun runs `prepare`; a contributor's
first `bun install` therefore installs the hook, and no one has to remember a setup command.

`.githooks/pre-commit`, committed with mode `100755`:

```sh
#!/bin/sh
# Kira Studio pre-commit — see docs/plans/P15-gh-tooling.md §3.
# Installed by `bun install` (package.json "prepare" sets core.hooksPath).
# Bypass for a work-in-progress commit with: git commit --no-verify
set -e

if [ ! -d node_modules ]; then
  echo "pre-commit: node_modules is missing — run \`bun install\` first." >&2
  exit 1
fi

bun run lint
bun run typecheck
```

- **What it runs and why:** `lint` + `typecheck`, whole-repo, ≈6 s total (Reality 4). These are the
  two checks whose failure blocks CI and whose fix is mechanical; they are cheap enough that
  staged-file scoping would cost more in complexity than it saves in seconds (D1).
- **What it does not run:** `bun run build`, `test:ui`, `test:db`, `verify:packaging`. A hook that
  takes minutes gets bypassed, and a bypassed hook is worse than no hook. CI covers all four.
- **No auto-fix.** The hook never runs `biome check --write`: rewriting files underneath a commit
  the developer already staged is surprising, and with partially staged files it silently commits
  content that was never reviewed. The failure message from Biome already names `bun run format`.

---

## 4. `scripts/verify-packaging.sh`

One POSIX `sh` script, runnable on Linux and macOS, called from both workflows and documented for
local use. It is the executable form of §2's decision (D5). Wire it up as
`"verify:packaging": "sh scripts/verify-packaging.sh"` in `package.json` `scripts`.

Behaviour: `set -eu`; a `fail()` helper that prints `verify-packaging: <what> — <why>` to stderr
and sets a failure flag; run **all** checks, then exit 1 if any failed (so one run reports
everything, not just the first problem). Use `grep` only — do not assume `rg` on a runner.

**Static checks (always run):**

| # | Check | Fails when |
|---|---|---|
| S1 | No updater dependency | `package.json` matches `electron-updater` or `update-electron-app` |
| S2 | No updater code | `grep -rn "autoUpdater\|electron-updater" src/` matches anything |
| S3 | Ad-hoc/no-publish config intact | `electron-builder.yml` lacks a line matching `^\s*writeUpdateInfo:\s*false` |
| S4 | No publish configuration | `electron-builder.yml` has a line matching `^publish:` or `^\s*publish:` |
| S5 | Packaging scripts cannot publish | either `package:mac` or `package:mac:dir` in `package.json` lacks `--publish never` |

**Artifact checks (run only when `dist/` exists; otherwise print `skipped — no dist/ build
present` and pass):**

| # | Check | Fails when |
|---|---|---|
| A1 | No update feed | any `dist/latest*.yml` exists |
| A2 | No differential-update payload | any `dist/*.blockmap` exists **(warning by default, see D7)** |
| A3 | Ad-hoc signature | `codesign` exists and `codesign -dv --verbose=2 "$APP" 2>&1` does not contain `Signature=adhoc` |
| A4 | Engine unpacked | `"$APP/Contents/Resources/app.asar.unpacked/out/main/engine.js"` is missing |
| A5 | Bundle identifier | `PlistBuddy` exists and `CFBundleIdentifier` ≠ `com.kirathecat.kira-studio` |

where `APP="dist/mac-arm64/Kira Studio.app"`; A3–A5 skip with a printed note when `$APP` or the
macOS-only tool is absent, so the script is green on Linux and on a `--dir`-less checkout.

**A2's exact semantics (D7):** a `.blockmap` in `dist/` is *reported*, not fatal, because
electron-builder produces it unconditionally for the mac zip (Reality 12) and a developer's normal
`bun run package:mac` will always leave one. It becomes fatal when `KIRA_STRICT_UPDATE_CHECK=1` is
set in the environment — which the **release** workflow sets, after deleting the blockmaps, so
that no differential-update artifact can ever reach a published release. Print, in the non-strict
case, one line naming the reason and pointing at `docs/PACKAGING.md` §7 so nobody reads the file
count as an oversight.

Quote every path (`"Kira Studio.app"` contains a space) and use `set -eu` plus explicit `|| true`
around greps whose non-match is the success case.

---

## 5. `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

Three jobs, all `runs-on: macos-15` (D3), all starting with the same three steps —
`actions/checkout@v4`, `oven-sh/setup-bun@v2` with `bun-version: latest` (D4), and
`bun install --frozen-lockfile`:

| Job | `needs` / `if` | `timeout-minutes` | Steps after install |
|---|---|---|---|
| `checks` | — | 15 | `bun run lint` · `bun run typecheck` · `bun run build` · `bun run verify:packaging` |
| `ui-smoke` | `needs: checks` | 25 | `bun run test:ui`; then `actions/upload-artifact@v4` with `if: failure()`, `name: playwright-report`, `path: playwright-report/`, `retention-days: 7` |
| `package-smoke` | `needs: checks`, `if: github.event_name != 'pull_request'` | 25 | `bun run package:mac:dir` · the bundle assertions below · `bun run verify:packaging` |

`package-smoke`'s assertion step (one `run: |` block, `set -eu` at the top):

```sh
APP="dist/mac-arm64/Kira Studio.app"
test -d "$APP"
test -f "$APP/Contents/Resources/app.asar.unpacked/out/main/engine.js"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")" \
  = 'com.kirathecat.kira-studio'
codesign -dv --verbose=2 "$APP" 2>&1 | grep -q 'Signature=adhoc'
du -sh "$APP"
```

That block is `docs/PACKAGING.md` §4 items 1–3 and 9, automated on real macOS for the first time
(Reality 16, D10). `verify:packaging` running afterwards covers the rest.

Notes for the implementer:

- **Do not add a `playwright install` step** (Reality 9) and **do not add a `test:db` job**
  (Reality 7, SPEC §9.1, D6).
- `ui-smoke` really executes four specs and skips eighteen with `DOCKER_UNAVAILABLE_MESSAGE`
  (Reality 8). Skips are not failures. Those four cover app launch, the workbench shell,
  connection CRUD and session restore — the only automated proof in CI that the built app boots.
- Keep `bun run test:ui` verbatim rather than splitting it into `bun run build && bunx playwright
  test --retries=1`; mirroring the contributor command is worth more than a retry. If the job
  proves flaky on the runner, the follow-up is `--retries=1` **plus a note in PACKAGING.md §7**,
  not silently marking the job `continue-on-error`.
- No dependency caching in v1 (D4).

---

## 6. `.github/workflows/release.yml`

```yaml
name: Release

on:
  push:
    tags: ['v*.*.*']

permissions:
  contents: write

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false
```

One job, `release`, `runs-on: macos-15`, `timeout-minutes: 40`,
`env: { GH_TOKEN: ${{ secrets.GITHUB_TOKEN }} }`. Steps, in order:

1. `actions/checkout@v4`; `oven-sh/setup-bun@v2` (`bun-version: latest`);
   `bun install --frozen-lockfile`.
2. **Tag/version guard** — fail fast before a 40-minute build:
   ```sh
   TAG="${GITHUB_REF_NAME#v}"
   PKG="$(node -p "require('./package.json').version")"
   [ "$TAG" = "$PKG" ] || {
     echo "tag $GITHUB_REF_NAME does not match package.json version $PKG" >&2; exit 1; }
   ```
3. `bun run lint` and `bun run typecheck` — 6 s of insurance that the tagged commit is the one CI
   saw. The UI suite is **not** re-run here (D13).
4. `bun run package:mac` — the unmodified P12 script, `--publish never` included (D8). Produces
   `dist/Kira Studio-<version>-arm64.dmg`, `…-arm64.zip`, `dist/mac-arm64/Kira Studio.app`.
5. **Drop the update payload** (D7):
   ```sh
   rm -f dist/*.blockmap
   ```
   with a comment citing SPEC §1/§3 and `docs/PACKAGING.md` §7.
6. `KIRA_STRICT_UPDATE_CHECK=1 bun run verify:packaging` — now fatal on any `.blockmap` or
   `latest*.yml`, plus every static and bundle check from §4.
7. **Compose release notes** into `release-notes.md` with a `cat > … <<'EOF'` heredoc: unsigned
   ad-hoc / arm64 / macOS 13+ line; the Gatekeeper workaround quoted verbatim from
   `docs/PACKAGING.md` §4 item 4; one line stating there is no auto-update and the artifacts carry
   no update metadata. (Mind YAML block-scalar indentation: the `EOF` terminator must sit at the
   same indentation as the heredoc body inside the `run: |` block.)
8. **Create the release**:
   ```sh
   gh release create "$GITHUB_REF_NAME" \
     --draft \
     --title "Kira Studio $GITHUB_REF_NAME" \
     --notes-file release-notes.md \
     dist/*.dmg dist/*.zip
   ```
   `gh` is preinstalled on GitHub-hosted runners, so no third-party release action is needed (D5).
   The globs are safe with the space in `Kira Studio-…`: glob expansion does not word-split, and
   `dist/*.zip` does not match `….zip.blockmap`.
9. `actions/upload-artifact@v4` with `name: kira-studio-macos-arm64`, `path: |` the dmg and zip,
   `retention-days: 14` — so a tag build's output is retrievable from the run even if the draft
   release is later discarded.

**Why a draft (D14).** The artifacts are unsigned and `docs/PACKAGING.md` §4's human items 4–8 are
still unrun. Publishing automatically would hand a user a binary nobody has launched. The workflow
builds, verifies and attaches; a human runs the §4 checklist on real hardware, fills in the rows,
and presses Publish — which is the same division of labour the packaging doc already assumes.

---

## 7. Documentation updates

### 7.1 `docs/PACKAGING.md`

- **§1** — fix the zip artifact name to `Kira Studio-0.1.0-arm64.zip` (Reality 15).
- **§4** — mark items **1, 2 (via the unpacked-`engine.js` proxy), 3's config precondition and 9**
  as *now checked automatically by the `package-smoke` job in `.github/workflows/ci.yml`*, and
  record the result **only after** a real green run has been observed (§10 step 8). Items 4–8 stay
  human and keep their *not yet run* markers.
- **§6** — replace *"No CI, no tag-triggered build, no auto-update. All P15's job."* with the
  shipped state: CI exists (macOS-only, lint/typecheck/build + UI smoke + packaging smoke); tag
  builds exist and produce a **draft** release; the DB suite is deliberately not in CI (no Docker
  on macOS runners, SPEC §9.1); auto-update deliberately does not exist and is now verified — see
  §7.
- **New §7, "CI, releases, and the auto-update decision"** — the phase's documentation
  deliverable, roughly:
  1. What runs on every push/PR, and what runs only on pushes to the long-lived branches.
  2. Why `test:db` is not in CI (Reality 7 + SPEC §9.1) and what the coverage consequence is: the
     18 container-backed UI specs skip on the runner, so **the DB and container-backed UI suites
     remain a local, pre-merge responsibility** — CI does not replace them.
  3. How to cut a release: bump `version` in `package.json`, commit, `git tag vX.Y.Z`,
     `git push origin vX.Y.Z`, wait for the workflow, run the §4 human checklist against the draft
     release's artifacts, then publish.
  4. **The auto-update verification** — §2's decision in short form, the evidence (no `publish:`
     key, `--publish never` on both scripts, `dmg.writeUpdateInfo: false`, no `latest*.yml`
     produced, no updater dependency or import), the `.blockmap` byproduct and how the release
     workflow disposes of it, and `bun run verify:packaging` as the command that re-checks all of
     it. Close with the one-line statement of what a future auto-update would require first:
     signing + notarization (SPEC §1/§3), then a spec change, then a feed.

### 7.2 `README.md`

- **Badge** (P14 D8's deferral, now due — D12): one CI badge immediately under the title:
  `[![CI](https://github.com/vlad-cirstean/kira-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/vlad-cirstean/kira-studio/actions/workflows/ci.yml)`.
  It tracks the **default branch** (`main`), which is stale until v1 lands there, so it will read
  *no status* for now. That is accurate and self-correcting; a `?branch=feature%2Fkickoff` badge
  would become wrong the moment v1 merges. No other badge — no coverage, no release, no licence.
- **Install section** — fix the zip name (Reality 15).
- **Development section** — add a short **Git hooks** paragraph: `bun install` points
  `core.hooksPath` at `.githooks/`; `pre-commit` runs `bun run lint` and `bun run typecheck`
  (about six seconds); bypass a work-in-progress commit with `git commit --no-verify`.
- **Script table** — add the two new rows (`bun run verify:packaging`; note `prepare` is a
  lifecycle script, not something to run by hand — mention it in the hooks paragraph instead of
  the table if that reads better).
- **"Not in v1"** — remove `CI` from the list (it now exists) and keep `auto-update`, qualified:
  deliberately absent and verified — link `docs/PACKAGING.md`. Keep `code signing/notarization` and
  everything else untouched.
- **Documentation index** — `docs/plans/` now reads "P0 through P15".
- Do **not** link a Releases page: there are still no published releases (Reality 2), and P14's
  reasoning for not linking an empty page has not changed.

### 7.3 `docs/SPEC.md`

One line: the status line at the top, `P0–P14 implemented` → `P0–P15 implemented`. **Nothing
else** — §1's deferred list, §3's "No auto-update", §9.1's "no CI wiring in v1" (which is still
literally true of the DB suite) and §10's phasing table all stay exactly as they are; §2's decision
depends on them saying what they say.

---

## 8. Decisions made in this plan

**D1 — The hook runs whole-repo `lint` + `typecheck`, not staged-file-scoped checks.** Reality 4:
`biome check .` is 0.35 s across the entire repo and the full typecheck is 5.3 s. Biome's
`--staged` (Reality 5) would shave a fraction of a second off the cheaper half while introducing
the partial-stage blind spot (`--staged` reads files from disk, so unstaged edits in a partially
staged file are what gets checked). Typechecking cannot be staged-scoped at all without abandoning
project-wide type checking. Whole-repo is both simpler and stricter here.

**D2 — `core.hooksPath` + a `prepare` script, not husky or simple-git-hooks.** Both packages exist
to do what `git config core.hooksPath .githooks` does in one line; both add a devDependency, a
config surface, and a shim layer to a repo that deliberately runs Biome instead of ESLint+Prettier
and `tsgo` instead of a bundled toolchain. Their one real advantage — reinstalling hooks
automatically after `git init`-adjacent operations — is covered here by `prepare`, which bun runs
on every install (Reality 6). The hook stays a plain, readable shell script that any contributor
can run by hand.

**D3 — Runners are pinned to `macos-15`, not `macos-latest`.** SPEC §3 targets `arm64` macOS 13+
only, and `macos-latest` has historically moved between architectures (it was Intel `macos-12`,
then `macos-14`, then `macos-15`). A silent move to an x64 image would build the wrong
architecture, or a move to a newer image would change Xcode/`sips`/`codesign` behaviour under the
release build without a commit. Pinning makes runner-image upgrades an explicit, reviewable edit.
`macos-15` is Apple Silicon and carries the Xcode command-line tools the dmg step needs.

**D4 — `bun-version: latest`, and no dependency caching.** The repo pins no Bun or Node version
anywhere (README says so explicitly), so a CI-only pin would be a fourth place versions live that
nobody updates. If a Bun release ever breaks CI, pinning *then* is a one-line fix with a reason
attached. Caching is skipped because the expensive download is Electron's postinstall, and a
mis-keyed cache that serves a stale Electron would produce a green CI for a build nobody actually
made; macOS minutes are free on this public repo (Reality 2), so the trade is not worth it.

**D5 — Verification lives in one checked-in shell script, and releases use `gh`, not a
third-party action.** The script is called from three places (CI `checks`, CI `package-smoke`,
release) and is runnable locally, which inline `run:` blocks would not be. `gh release create` is
preinstalled on every GitHub-hosted runner, so `softprops/action-gh-release` and friends would add
a third-party dependency in the one workflow that holds `contents: write`.

**D6 — `bun run test:db` is never wired into CI, and this is documented rather than left as a
gap.** GitHub's macOS runners have no Docker and no nested virtualization (Reality 7); SPEC §9.1
already says the DB suite is local-only for v1. The consequence — CI cannot prove adapter
behaviour, and 18 of 22 UI specs skip there — is stated in `docs/PACKAGING.md` §7 so nobody reads
a green check as coverage it does not have.

**D7 — The `.blockmap` is reported locally and deleted at release time.** Reality 12: mac zip
builds emit one unconditionally, so failing on it by default would fail every developer's local
`verify:packaging` run after a normal package. Deleting it in the release workflow, then
re-verifying under `KIRA_STRICT_UPDATE_CHECK=1`, means no differential-update artifact is ever
published while local builds stay ergonomic. This is the one place where "no auto-update" needed an
action, not just an assertion.

**D8 — `electron-builder.yml` keeps every key it has; only the comment changes.** `writeUpdateInfo:
false` stays (it is dmg-only, Reality 11, and it is correct); no `publish:` key is added, not even
`publish: null` — an absent key is what the code path checks (Reality 13) and adding one to a
config P12 verified would be change for symmetry's sake. The comment `# no auto-update in v1
(§1/§3); P15's call, not P12's` becomes a statement that P15 made the call, pointing at
`docs/PACKAGING.md` §7.

**D9 — The auto-update verification is documented in `docs/PACKAGING.md`, not in a new file.**
PACKAGING.md already owns the build configuration, the verification checklist, and the known-gaps
list — all three of which this phase touches. A separate `docs/CI.md` would split one story across
two files and duplicate the release instructions.

**D10 — CI closes four rows of `docs/PACKAGING.md` §4, and only after a real run.** Items 1, 2, 3's
config precondition and 9 are exactly what the `package-smoke` assertions check on genuine macOS
hardware. The rows get filled in from an observed run, never from this plan's expectations — the
same rule P12 and P13 followed with their measurements.

**D11 — The stale zip artifact name is fixed in both docs.** Reality 15: `-arm64-mac.zip` never
existed; `artifactName` produces `-arm64.zip` and that is what P12's build recorded. The release
workflow uses globs, so this is a documentation-accuracy fix, not a functional dependency — but a
user copying the wrong filename from the README is a real papercut and it is a two-word edit.

**D12 — The README gets exactly one badge, pointing at the default branch.** P14 D8 deferred badges
to this phase because a badge for a nonexistent workflow is a broken image. The workflow now
exists. The badge will read *no status* until v1 lands on `main`; that is honest, and it fixes
itself. Coverage/release/licence badges are still not added — there is no coverage measurement, no
published release, and the licence is already stated in the README's last section.

**D13 — The release workflow re-runs `lint` and `typecheck` but not the UI suite.** Six seconds to
confirm the tagged commit is not something that never passed CI, versus roughly twenty minutes to
re-run a suite that CI already ran on the same commit and whose container-backed majority skips on
the runner anyway.

**D14 — Releases are created as drafts.** Reality 16 and `docs/PACKAGING.md` §4: five of the nine
packaging checks require a human on real hardware and are unrun. A draft release is the artifact
handoff to that human; publishing is their action, after the checklist.

**D15 — Trigger scope is `main` for both pushes and PRs.** `concurrency` with
`cancel-in-progress: true` keeps a rapid push sequence from queueing three macOS runners.

---

## 9. Non-goals

P15 does **not**:

1. **Implement auto-update** — see §2. No `electron-updater`, no `publish:` provider, no
   `latest-mac.yml`, no `autoUpdater` import, no update UI.
2. **Add code signing or notarization**, or any secret beyond the automatic `GITHUB_TOKEN`. SPEC
   §1/§3 defer both past v1, and the release workflow needs no other credential.
3. **Run the DB suite (or Docker/Colima) in CI** (D6), or add a Linux/Windows job to make it
   possible. macOS-only is in the phase's own spec line.
4. **Add any hook other than `pre-commit`** — no `commit-msg` (no commitlint dependency; AGENTS.md
   is the convention and a human follows it), no `pre-push`, no `post-merge` install hook.
5. **Add repository-management files** — issue/PR templates, `CODEOWNERS`, `dependabot.yml`,
   `SECURITY.md`, `CONTRIBUTING.md`, labels, or branch-protection configuration. None is named by
   the spec line, and `AGENTS.md` already is this repo's contribution agreement.
6. **Change `src/`, `tests/`, `playwright.config.ts`, `biome.json`, or `tsconfig*.json`.** If the
   first CI run exposes a genuine repo bug, report it — do not fold a code fix into a tooling
   phase.
7. **Change the packaging scripts or `electron-builder.yml` keys** (D8). P12 verified them; P15
   reuses them verbatim so that what CI builds is what a developer builds.
8. **Bump `version` or create a tag.** The release workflow is delivered ready; cutting `v0.1.0` is
   a product decision, and §7.1's release runbook documents how.
9. **Add caching, matrices, reusable workflows, composite actions, or a release-notes generator.**
   Three jobs and one release job is the whole surface (D4, D5).

---

## 10. Verification

Locally verifiable in this container (steps 1–6), then the real run (7–9):

1. **Hook installs.** `bun install` (or `bun run prepare`) then `git config --get core.hooksPath`
   prints `.githooks`.
2. **Hook fires and passes.** `git commit` on a trivial staged change runs lint + typecheck and
   completes in roughly six seconds; `git commit --no-verify` skips it. Confirm the committed mode
   is executable: `git ls-files -s .githooks/pre-commit` shows `100755`.
3. **Hook fails loudly.** Temporarily introduce a formatting error, confirm the commit is refused
   with Biome's own message, revert.
4. **Verification script passes.** `bun run verify:packaging` exits 0 on the current tree. With
   `dist/` present from P12's build it reports the existing `.blockmap` as a note and still exits
   0; `KIRA_STRICT_UPDATE_CHECK=1 bun run verify:packaging` exits **1** on that same tree, naming
   the blockmap. Both behaviours are the point — check them.
5. **Verification script catches a regression.** Temporarily add `electron-updater` to
   `package.json`'s `devDependencies` (do not install it) and confirm S1 fails; revert.
6. **Workflows parse.** `python3 -c "import yaml,sys;[yaml.safe_load(open(f)) for f in
   sys.argv[1:]]" .github/workflows/*.yml` exits 0. Re-read both files against §5/§6 for job
   names, `needs`, `if`, and permissions — a YAML file can parse and still be a wrong workflow.
7. **Push, then read the run.** After pushing (watch for the `workflow` scope problem in §0),
   open the Actions run and confirm: `checks` green; `ui-smoke` green with four specs passed and
   eighteen skipped citing `DOCKER_UNAVAILABLE_MESSAGE`; `package-smoke` green with the ad-hoc
   signature, bundle id and unpacked `engine.js` assertions passing, and the `du -sh` size in the
   log.
8. **Record what the run proved.** Fill in `docs/PACKAGING.md` §4 items 1/2/3/9 and §7 from that
   log — actual values, not expectations. If the run is red, fix it inside this phase; a merged
   red workflow is worse than none.
9. **The release workflow is exercised only if the user asks for a tag.** It cannot be dry-run.
   If it is not exercised, `docs/PACKAGING.md` §7 says so plainly — *"the release workflow has not
   yet been run; the first tag is its first execution"* — in the same spirit as §4's unrun rows.

## 11. Acceptance checklist

- [ ] `docs/plans/P15-gh-tooling.md` exists (this document) and is committed.
- [ ] `.githooks/pre-commit` exists, mode `100755`, runs `bun run lint` and `bun run typecheck`,
      guards on missing `node_modules`, and documents `--no-verify`.
- [ ] `package.json` gained exactly two script entries — `prepare` and `verify:packaging` — and no
      new dependency of any kind.
- [ ] `git config --get core.hooksPath` returns `.githooks` after `bun install`.
- [ ] `scripts/verify-packaging.sh` exists, is POSIX `sh`, implements S1–S5 and A1–A5, reports all
      failures before exiting non-zero, is green on Linux, and honours
      `KIRA_STRICT_UPDATE_CHECK=1`.
- [ ] `.github/workflows/ci.yml` matches §5: triggers, `permissions: contents: read`, concurrency,
      three jobs on `macos-15`, no `test:db`, no `playwright install`, report artifact on failure.
- [ ] `.github/workflows/release.yml` matches §6: `tags: ['v*.*.*']`, `permissions: contents:
      write`, tag/version guard, `bun run package:mac`, blockmap removal, strict verification,
      `gh release create --draft` with dmg + zip globs, artifact upload.
- [ ] No `electron-updater`, no `publish:` key, no `autoUpdater` reference anywhere in the repo;
      `dmg.writeUpdateInfo: false` still set; both packaging scripts still carry `--publish never`.
- [ ] `electron-builder.yml` changed by exactly one comment line (D8).
- [ ] `docs/PACKAGING.md`: §1 zip name fixed; §4 rows updated **from an observed run**; §6
      known-gaps line replaced; new §7 covering CI, the release runbook, the DB-suite exclusion,
      and the auto-update verification with its evidence.
- [ ] `README.md`: one CI badge; zip name fixed; git-hooks paragraph; script table updated;
      "Not in v1" no longer lists CI and qualifies auto-update; docs index says P0–P15; still no
      Releases link, no second badge, no screenshot.
- [ ] `docs/SPEC.md` changed by exactly one line (status `P0–P15`).
- [ ] No file under `src/`, `tests/`, `biome.json`, `playwright.config.ts` or `tsconfig*.json` was
      modified.
- [ ] §10 steps 1–6 all performed locally; steps 7–8 performed against a real Actions run and its
      results written into the docs; step 9's caveat recorded if no tag was cut.
- [ ] `bun run lint`, `bun run typecheck` and `bunx electron-vite build` pass locally.
- [ ] Commits follow Conventional Commits (`ci(p15): …` for the tooling, `docs(p15): …` for the
      documentation) and are landed on the v1 feature branch per SPEC.md §12.

## 12. Target tree at the end of P15

```
.githooks/
  pre-commit                     NEW (100755) — lint + typecheck, ~6 s, bypass with --no-verify.
.github/workflows/
  ci.yml                         NEW — macos-15: checks / ui-smoke / package-smoke.
  release.yml                    NEW — tag v*.*.*: package:mac, verify, draft GitHub Release.
scripts/
  verify-packaging.sh            NEW (100755) — S1–S5 static + A1–A5 artifact checks; the
                                 executable form of "auto-update configuration verified".
  demo-dbs/                      unchanged
package.json                     MOD — "prepare" and "verify:packaging" scripts only.
electron-builder.yml             MOD — one comment line; no key changes.
README.md                        MOD — CI badge, hooks note, script rows, zip name, Not-in-v1,
                                 docs index P0–P15.
docs/
  SPEC.md                        MOD — status line P0–P15. Nothing else.
  PACKAGING.md                   MOD — §1 zip name, §4 automated rows, §6 gaps, new §7.
  PERF.md                        unchanged
  plans/P15-gh-tooling.md        NEW — this document.
src/                             unchanged
tests/                           unchanged
```
