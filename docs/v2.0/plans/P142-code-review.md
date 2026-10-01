# P142 code review (round 2 of 2)

Status: in progress.

Head: `b43281ed`. Part A base `22cd3de7` (P141 fix commits `108ada87..b43281ed`). Part B base `771512bc`
(areas P141 skimmed or never reached). One Opus reviewer, three dimensions: architecture/security,
correctness, performance. CodeGraph via stdio fallback `cgx.mjs` (`codegraph_explore`).

## Findings

### F1 Resume refused for 2 min after an abandoned launch

- Dimension: correctness. Severity: low.
- `apps/kira-space/internal/ade/tracker.go:266` (`Prepare`), `recordHeldLocked` at `:190`.
- Problem: P141 F3 refuses a resume while any *pending* intent names the record. A pending intent
  only clears in `Compose` or after `PendingTTL` (2 min, `tracker.go:27`). `terminal.BoundService.Open`
  runs `ValidateOpen` before `ComposeAgent` (`internal/terminal/bound.go:80-92`), and the renderer can
  fail before `Open` at all. Any such failure leaves the intent behind; a retry of the same resume
  in the next 2 min fails with `ErrSessionRunning` ("session is already running") though nothing runs.
  Before P141 the retry succeeded.
- Fix: refuse in `Prepare` only when `byRecord` holds the record; on a pending duplicate, drop the
  older intent for that record. Close the double-resume race in `Compose` instead: under `t.mu`,
  refuse (`ErrSessionRunning`) when `byRecord` already holds `intent.RecordID`, and reserve it
  before `MarkRunning`.

### F2 FileTree parent picker and toolbar spacing doubled

- Dimension: maintainability (visual regression). Severity: low.
- `packages/git-ui/src/components/FileTree.vue:518`, `:533` (commit `91fefffe`, P110 A15).
- Problem: the legacy scale is `--kv-s-1..6` = 2/4/6/8/12/16px (`theme/kira-structure.css:17-22`)
  and git-ui's `kv:` root has `--spacing: 4px`, so s-N maps to 0.5/1/1.5/2/3/4. These two blocks
  were mapped one step as if s-N = N*4px: parent picker was `gap s-1; padding 0 s-5 s-4`
  (2px; 0 12px 8px), now `kv:gap-1 kv:px-5 kv:pb-4` (4px; 0 20px 16px); toolbar was
  `gap s-2; padding 0 s-4 s-2` (4px; 0 8px 4px), now `kv:gap-2 kv:px-4 kv:pb-2` (8px; 0 16px 8px).
  The filter row no longer lines up with ReviewView's `kv:px-2` panes or the tree rows' own 8px
  inset. Every other converted block in git-ui (checked all 37 files that dropped `--kv-s-*`) maps
  correctly.
- Fix: `:518` → `kv:gap-0.5 kv:px-3 kv:pb-2`; `:533` → `kv:gap-1 kv:px-2 kv:pb-1`.

### F3 install.sh calls ad-hoc codesign "the real gate"

- Dimension: security (misleading invariant). Severity: low.
- `scripts/install.sh:288`, `:291`; signing at `scripts/sign-bundle.sh:36`, `:47`.
- Problem: when the release has no `sha256:` digest the script logs that "codesign/identity checks
  below are the real gate". The bundle is ad-hoc signed (`codesign --sign -`), so
  `codesign --verify` (`:308`) only proves the bundle is self-consistent; anyone can re-sign a
  modified app ad-hoc and pass it, and `CFBundleIdentifier`/version are plain plist strings. The
  only real gate is TLS to the pinned GitHub API/asset URL. A future maintainer reading this
  comment will assume provenance is checked when it is not.
- Fix: reword both logs to "no digest; integrity rests on TLS to github.com only (bundle is
  ad-hoc signed)", or `die` when the digest is missing (GitHub reports `sha256:` for every
  release asset), keeping the codesign step as a corruption check only.

### F4 native-select comment names the wrong engine

- Dimension: maintainability. Severity: low.
- `packages/theme/src/components/ui/native-select/index.ts:8-10`.
- Problem: says "this app targets a single pinned Electron/Chromium build" to justify
  `appearance: base-select`. The apps ship in Wails (WKWebView on macOS, WebKitGTK on Linux) and
  the UI suites run on WebKit; the variant below (`:15`, "P61: WebKit's ... base-select box")
  already says so. The rationale for relying on Customizable Select is therefore wrong as written.
- Fix: say "Wails WebKit (WKWebView/WebKitGTK); see P61" and keep the support claim tied to the
  WebKit version the UI tests pin.

### F5 prepare-worktree installs without an index refresh

- Dimension: maintainability (dev tooling). Severity: low.
- `scripts/prepare-worktree.sh:23`.
- Problem: `apt-get install -y ...` with no `apt-get update`. Fresh container images ship with
  empty `/var/lib/apt/lists`, so the first run fails with "Unable to locate package" exactly when
  the script is needed (a fresh worktree on a fresh box). It also assumes root with no `sudo`
  fallback.
- Fix: `apt-get update -qq && apt-get install -y --no-install-recommends ...`, prefixed with
  `sudo` when `id -u` is not 0.

## Part B notes (verified clean)

- git-ui spacing: every file that dropped `var(--kv-s-*)` (37) was compared rule by rule against
  its new `kv:` classes; only F2 is off. `PreflightPrediction.vue` reproduces the old
  `--kv-s-4` margin (`kv:my-2`), `.kv-detail-pane-*` error/loading `--kv-s-5` → `kv:p-3`.
- `openAllChangesAnnounced.ts` is the old `CommitMeta`/`ReviewCommitRow` body verbatim.
  `createDetailActions` now forwards `fallbackSha` for review too (a fix, not a change in risk).
- `RepoScopedReload`/`FileListCursor` (state/*.ts): mechanical; same repoId guard, same kind
  filter per class (Ops has none, as before), same log names. Private-field init order puts
  `#fileList` before the refs that alias it in all three classes.
- `primitives.css` deletions: every removed class is now referenced only in comments; the kept
  `.p-input.is-grow`/`.input-wrap` is still used by `AutocompleteField.vue`.
- `check-ade-colours.sh`, `check-theme-classes.sh`, `check-class-conflicts.ts`: correct for what
  they claim (single-line `class=` attributes only in the shell checks, as documented).

## Part A notes (verified clean)

- `gitRepoIDOf` cache (`queue.go:346`): ade's `Conn` never releases a hold before `Close`, and a
  code repo's root is immutable (`CodeReposRepo` has no relocate), so a cached id always maps to a
  live entry for the same root. `Conn.Entry` miss falls back to the full open.
- `tipReachableFromMain = hasMain && depths[b]==0` (`queue.go:798`): depths is `AheadBehind(tip,
  mainTip)` ahead count, set for every found branch when `hasMain`; zero ahead iff tip is an
  ancestor of main. Equivalent to the removed `Ancestors` call.
- Push vs invalidation (`mutations.ts`, `queries.ts`): every write whose `onSettled` was dropped
  calls `notifyChanged` on success (`queue.go:1257-1368, 1468, 1604, 1741`); `installAdeSignals`
  invalidates snapshot and PRs on that push. Failed writes are transactional except Archive and
  Refresh, which still invalidate on error. BindNewWork keeps its snapshot invalidation (Go pushes
  sessions only).
- `applyActivity` (`queueActivity.ts`) reproduces `useQueue`'s `acts`/`agents`/`panel.running`
  exactly (same `activityKind` rule, same `actRank` sort). No other `useQueue` output reads
  activity. `AdeAllAgentsView` reads activity straight from the store via `buildAllAgents`, so
  `NO_ACTIVITY` there loses nothing.
- Session id quoting: `uuid.Parse` plus `quotePOSIX`; no frontend code parses the command.
- `ErrReviewNotesOnly`, `UpdateNewWork` repo/live scoping, `ListByRepo`, notes-by-itemId (`nw:`
  prefix matches `queue.go:1271`; `:` cannot appear in a git branch name): correct.
- `RequirePathPrefix` (`adapters/tree.go`): s3 uses only the bucket segment; redis picks its DB from
  segment 0 in `Adapter.Mutate`. Deeper paths carry no other meaning in either mutate.
