# Kira Studio — v1.8

v1.7 shipped the database MCP server as one cohesive chapter (`docs/v1.7/SPEC.md`, M1-M8). This
chapter returns to v1.1/v1.2/v1.4/v1.6's own shape: independent, unrelated phases across two
existing modules — the API client and the git module — so it continues `P` numbering (`P71`+)
rather than taking a fresh letter, the same reason v1.6's own opening paragraph gives for reusing
`P` instead of picking a new one.

**Thirteen feature rows plus the two standing code-review rounds and the closing docs row.** Every
row below comes directly from the request that opened this chapter; nothing is invented scope.
Several requests share a root component and are grouped into one row so a phase's own planning pass
can fix a shared cause once rather than patch symptoms three times (the git-graph rendering/perf/
layout row is the clearest case: reload-on-return, checkout misalignment, scroll flicker and the
sticky-header/tab-bar overlap are all plausibly the same worker/layout-recompute cost surfacing in
different ways — the phase's own planning pass confirms or splits this before implementing).

**Confirmed today, checked directly, not assumed** (an `Explore` pass over the current tree before
this table was written):

- The git module's UI lives in `packages/git-ui/src/`, shared between the desktop app (embedded via
  `apps/kira-studio/frontend/src/repo/git/gitUiModule.ts`) and the VS Code extension
  (`apps/kira-studio-vscode`) — a fix here lands in both surfaces at once, and P72's dropdown removal
  in particular must stay correct for both (the VS Code extension already has one repo per window;
  Kira Studio's own left sidebar already switches repos, per the request itself).
- Graph rendering: `packages/git-ui/src/components/CommitGrid.vue`, geometry/layout engine in
  `packages/git-ui/src/graph/` (`layoutStore.ts`, `layout.worker.ts`, `rowSvg.ts`, `geometry.ts`,
  `graphColumn.ts`, `hitTest.ts`, `palette.ts`). The repo-switch dropdown is
  `packages/git-ui/src/components/RepoPicker.vue`, mounted in `AppToolbar.vue`.
  Commit detail is `packages/git-ui/src/components/DetailPane.vue` (+ `CommitMeta.vue` +
  `FileTree.vue`). PR metadata already exists — `packages/git-ui/src/state/pr.ts` (`PrState`),
  rendered as a plain link row in `CommitMeta.vue` (~L331-345) — but only for the branch tip; no
  per-arbitrary-commit PR lookup and no icon on the time/sha line yet. Diff opening for a single
  file already goes through VS Code's native diff editor
  (`DetailPane.vue`'s `actions.openInEditor`, with a preview- vs. pinned-tab distinction on click
  vs. double-click) — P75's "open commit changes" multi-file request and P76's go-to-file/virtual-
  file request extend this path, not replace it. The desktop app's own tab strip
  (`apps/kira-studio/frontend/src/workbench/panels/TabStrip.vue`) independently implements the same
  preview-tab convention (`.is-preview` italic styling) — P75's "temporary tab" ask is about this
  tab strip specifically, separate from the VS Code-extension surface.
- Review UI: `packages/git-ui/src/components/review/` (`ReviewView.vue`, `ReviewCommitRow.vue`,
  `ReviewFilesPane.vue`, `ReviewCommentsPane.vue`, `BaseSelector.vue`), state in
  `packages/git-ui/src/state/review.ts`/`reviewFiles.ts`/`reviewComments.ts`; app-side glue at
  `apps/kira-studio/frontend/src/repo/git/reviewSession.ts` and
  `apps/kira-studio/frontend/src/repo/RepoReviewView.vue`.
- Settings: per-repo git-graph settings already distinguish a per-repo flag from a global one —
  `packages/git-ui/src/state/repoSettings.ts`'s `instanceWide` schema flag (documented L25-40),
  merged across repos regardless of which repo's write triggered the change event. P74 reuses this
  exact mechanism (or promotes further into the app-wide `SettingsDialog.vue`/`settings.ts` where a
  setting is genuinely app-wide, not just instance-wide-but-still-per-repo-shaped) rather than
  inventing a second one.
- Seti file icons already exist and are used in the file tree —
  `packages/git-ui/src/icons/setiFileIcon.ts` (+ test), consumed by `FileTree.vue` and mirrored
  app-side at `apps/kira-studio/frontend/src/repo/fileIcon.ts`. P77 is wiring this into
  `TabStrip.vue`, not building a new icon set.
- Branches/stashes: `packages/git-ui/src/components/BranchPicker.vue` (also handles worktree
  switch/open-in-new-window, bubbled from `WorktreeList.vue`), `StashList.vue`/
  `GlobalStashList.vue`/`StashDetailPane.vue`.
- Row-level right-click already has a working framework — `packages/git-ui/src/components/
  RowContextMenu.vue`, a thin wrapper over `@kira/kira-ui`'s `KuiContextMenu`, driven by
  `rowMenuModel.ts`'s `MenuSection[]`, used by 8 row components today. P83's worktree action plugs
  into this, reusing `WorktreeList.vue`'s existing create/switch machinery rather than a new dialog.
- Status bar is `apps/kira-studio/frontend/src/workbench/StatusBar.vue` (currently CPU/memory/cache/
  update-state only — no blame widget yet). P81 adds one.
- The API module's request/response UI is `apps/kira-studio/frontend/src/views/httprequest/`
  (`HttpRequestView.vue`, `RequestBodyPane.vue`, `RequestHeadersTable.vue`, `QueryParamsTable.vue`,
  `ResponsePane.vue`, etc.), backed by `apps/kira-studio/frontend/src/api/state/`
  (`collections.ts`, `variables.ts`, `history.ts`) and the protocol layer in
  `packages/api-core/src/http/*`. **Nothing here is browser-local** — tabs, history and variables
  are all backend-owned records synced over the bridge to Go/SQLite
  (`apps/kira-studio/frontend/src/state/tabs.ts`, `internal/storage`, `internal/apivars/`), unlike a
  typical browser "incognito" implementation. No incognito/private-session concept exists anywhere
  in the app yet — P71 is new ground, not extending a partial mechanism, and its own planning pass
  has to decide how a per-tab flag suppresses these backend writes without a parallel in-memory
  storage layer duplicating every write path.

**Sequencing.** P71 (API module) is fully independent of the git-module rows and floats to the
front only because it is unrelated, self-contained work — no ordering constraint ties it to
anything else. Within the git module: P72 (remove the dead repo-switch dropdown) is a pure deletion,
goes first, and shrinks `AppToolbar.vue`/`RepoPicker.vue` surface before P73 touches the same
toolbar area. P73 (graph rendering/perf/layout: reload-on-return, checkout misalignment, scroll
flicker, label sizing, sticky graph-header-vs-tab-bar) comes next since P75/P79 both depend on graph
navigation actually being stable to build "jump to this commit in the graph" links against. P74
(settings relocation) follows immediately — it's cutting over what P73 may have just touched
(look/appearance knobs), so doing it right after avoids relocating a setting whose behavior is about
to change again. P75 (commit detail: show-more, PR icon relocation off the webview, PR icon on
every commit's time/sha line for a PR-associated branch) and P76 (diff viewing: multi-file open,
temporary tabs, go-to-file including virtual files) both extend `DetailPane.vue`'s file-opening path
directly, P75 before P76 since P76's temporary-tab work touches the same file rows P75's multi-file
open produces. P77 (tab-strip seti icons) and P78 (markdown reading-view font) are small, unrelated,
self-contained polish items placed after the tab-strip/diff work they sit beside so they're not
touching a tab strip mid-change. P79 (review tab: fix broken commit-diff/graph navigation) needs
P73's graph stability and P76's diff-opening path already landed — it's explicitly described as
"can't open commit diff nor see the commit in the graph", i.e. broken calls into exactly those two
paths. P80 (review UX polish: checkbox shape/state, placement, comment interactivity, highlight)
comes right after — no point redesigning a checkbox in a view whose navigation P79 just fixed, before
P79 lands. P81 (blame widget), P82 (branches/stashes redesign) and P83 (worktree creation) are each
self-contained and placed last among the feature rows, in roughly ascending UI scope (a status-bar
widget, then a full dropdown redesign, then a new context-menu action). P84/P85 (the two code-review
rounds) and P86 (main-docs update) close the chapter exactly as `CLAUDE.md`'s standing process and
v1.6/v1.7's own closing rows require.

| Phase | Deliverable | Why here |
|---|---|---|
| **P71 API module: incognito mode per tab, 4-row auto-growing inputs** | A per-tab incognito toggle: when on, nothing from that tab's session persists once its tab closes — no history entry, no env/variable writes, no collection changes, no saved request. Since the API module has no browser-local storage at all (`apps/kira-studio/frontend/src/state/tabs.ts` and `api/state/*` all write through the bridge to Go/SQLite), this phase's own planning pass designs how an incognito tab's runtime state stays purely in-memory on the frontend and never reaches those bridge calls, while everything else about the tab (rendering, running requests, viewing responses) keeps working normally — plus a clear visual indicator the tab is incognito. Second, unrelated item in the same row since both are small, module-local, UI-only changes: the raw-text inputs (headers/body/params, wherever a textarea currently clips) grow up to 4 rows before switching to internal scroll, instead of a fixed single-row height | Self-contained, no dependency on any other row |
| **P72 Git graph: remove the repo-switch dropdown** | Delete `RepoPicker.vue` and its mount point in `AppToolbar.vue`. Kira Studio's own left sidebar already switches repos; the VS Code extension already has one repo per window. The dropdown duplicates both, in neither surface it needs to | Pure deletion — goes first so P73 isn't touching toolbar code the dropdown still occupies |
| **P73 Git graph rendering/perf/layout fixes** | Four related symptoms in the same rendering path (`CommitGrid.vue`, `graph/layoutStore.ts`, `graph/layout.worker.ts`, `graph/rowSvg.ts`): (1) the graph fully reloads every time the git-graph tab regains focus, instead of keeping its already-computed layout; (2) checking out a branch/commit visibly disaligns the graph for a moment before it snaps back into place; (3) scrolling the graph flickers; (4) branch/tag labels render in a smaller font than the commit-message text next to them and should match. This phase's own planning pass determines whether (1)-(3) share one root cause (a stale-cache/recompute-on-mount bug in `layoutStore.ts`, or worker round-trip timing) or are separate bugs, and fixes accordingly — reporting which, not assuming | After P72, before anything else that depends on stable graph navigation (P75, P79) |
| **P74 Move per-repo git-graph settings that are actually global into general settings** | Audit `RepoSettingsDialog.vue`'s full settings list against `repoSettings.ts`'s existing `instanceWide` flag; anything about look/appearance (and any other setting that has no real reason to differ per repo) moves into the app-wide `SettingsDialog.vue`/`settings.ts`, either by flipping `instanceWide` where that's already sufficient or by relocating the control entirely when the setting has no legitimate per-repo axis at all. This phase's own planning pass states, setting by setting, which move and why — not a blanket relocation | Right after P73, before its possible appearance-setting changes get relocated a second time |
| **P75 Commit detail panel: show-more fix, PR icon relocated off the webview, PR icon on every commit's time/sha line** | Three fixes to `DetailPane.vue`/`CommitMeta.vue`: (1) "show more" (truncated commit message/body expansion) currently does nothing — fix it; (2) clicking a GitHub PR icon currently opens the PR in an embedded webview — this phase's own planning pass locates that webview path (not found in `git-ui`'s current commit-detail code in this chapter's own scoping pass, so it may live in the desktop app's own git integration or the VS Code extension host — confirm before changing) and replaces it with inline PR status (open/closed/merged) shown directly in the commit-detail panel plus a link that opens the PR in the external browser, never embedded; (3) extend `pr.ts`'s `PrState` beyond branch-tip-only lookup so any commit on a branch associated with a PR shows a small GitHub icon on its time/sha line, linking to that PR — reachable from any commit on the branch, not only the tip | After P73 (needs stable graph/detail-panel navigation to build on) and before P76 (both touch the same file-opening/detail-panel surface) |
| **P76 Diff viewing: multi-file "open commit changes", temporary tabs, go-to-file for virtual files** | "Open commit changes" currently opens only one changed file's diff instead of all of them — fix to open every changed file. Those diff tabs currently pin as persistent tabs in the desktop app's own `TabStrip.vue`; they should open as temporary/preview tabs (the same `.is-preview` convention `TabStrip.vue` already implements elsewhere), promoted to pinned only on the same interaction (double-click/explicit edit) the file-tree preview convention already uses. Add a "go to file" action from a diff view matching the VS Code extension's own `actions.openInEditor` behavior — jump to the real file and the corresponding line, and this phase's own planning pass makes it work for virtual/synthetic content too (a diff side that has no on-disk file, e.g. a deleted/renamed/staged-only version), not just real files | Right after P75, same file-opening surface |
| **P77 Tab-strip icons: reuse the seti file-icon set** | `TabStrip.vue`'s tab icons currently don't use the seti icon set already used in `FileTree.vue` (`packages/git-ui/src/icons/setiFileIcon.ts`, mirrored at `apps/kira-studio/frontend/src/repo/fileIcon.ts`). Wire the same icon resolution into the tab strip so a file's tab icon matches its tree-view icon | Small, self-contained; placed after the tab-strip changes P76 makes so it isn't racing them |
| **P78 Markdown default view: reading mode, editor-matching font size** | Confirm/set the default open mode for `.md` files to reading (preview) view — already the case per the request ("it works well") — and fix the preview font size, which currently renders noticeably smaller than the code editor's own font size; it should match | Small, self-contained |
| **P79 Fix review tab: broken commit-diff opening and graph navigation** | From the review tab (`ReviewView.vue`/`RepoReviewView.vue`), opening a commit's diff and revealing a commit in the graph both currently do nothing. Trace both broken call paths (likely stale references into the pre-P73 graph-navigation API, or a session-scoped commit list `reviewSession.ts` builds that the graph/detail-panel opening actions don't recognize) and fix | After P73 (graph stability) and P76 (diff-opening path) both land — this row's own bugs are broken calls into exactly those two mechanisms |
| **P80 Review UX polish: checkbox shape/state, placement, comment interactivity, highlight** | In the review UI: (1) the mark-reviewed control is currently round — make it square; (2) find a better position for it now that a go-to-file button already sits in the same row area (added earlier in this phase's own history, per the request) — this phase's own planning pass picks the layout; (3) "add review comment" opens something but isn't interactive in any way — fix it end to end; (4) a partial-review state needs its own indeterminate checkbox visual, not just a third color reusing the same two-state control; (5) once a file is marked fully reviewed, its green "reviewed" row highlight should disappear (currently persists after marking) | Right after P79 — polishing a view whose navigation was just fixed |
| **P81 Git-blame status-bar widget** | Show git blame for the line under the cursor in `StatusBar.vue` (author, relative date, commit summary — matching what a blame gutter/widget in VS Code itself shows), updating as the cursor moves | Self-contained, placed after the review-tab work since it touches an unrelated status-bar surface |
| **P82 Redesign the branches/stashes dropdown** | `BranchPicker.vue` (branches + worktree switch/open) and the stash components (`StashList.vue`/`GlobalStashList.vue`/`StashDetailPane.vue`) are hard to navigate today per the request. This phase's own planning pass proposes a concrete redesign (grouping, search/filter, disclosure structure) before implementing it, not a cosmetic pass over the existing structure | Self-contained; placed near the end since it's the largest single UI-scope item among the remaining rows |
| **P83 Right-click: create worktree** | Add a "Create worktree" action to the existing row context-menu framework (`RowContextMenu.vue`/`rowMenuModel.ts`), reusing `WorktreeList.vue`'s existing create machinery (already used from `BranchPicker.vue`) rather than building a second worktree-creation path | After P82, since P82 may restructure the branch row this context menu attaches to |
| **P84 Code review, round 1** | Three parallel Opus subagents, one per dimension — architecture/security, functional correctness, performance/resource efficiency — findings-only, per `CLAUDE.md`'s own process, scoped to this chapter's own diff (P71-P83). One sequential Sonnet subagent fixes every finding judged real | After P71-P83 land: a review needs a finished tree |
| **P85 Code review, round 2** | The same three-dimension cycle, run again in full — against the tree P84's fixes leave, re-read fresh rather than trusting P84's summary — per `CLAUDE.md`'s "repeat the whole loop" rule. A round finding nothing real says so rather than manufacturing a finding | After P84's fixes land |
| **P86 Update main docs** | Brings `README.md`, `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md`, `CLAUDE.md` current for this chapter's changes — API incognito mode, and the git module's rendering/PR/diff/review/settings/blame/worktree changes — the same "read the current tree, don't trust prose" bar v1.6's P70 and v1.7's M8 used | Last of all: needs both review rounds' fixes landed first |

## Layout

- **`SPEC.md`** — this file, one row per phase, updated as phases land or split.
- **`plans/`** — one implementation plan per phase, committed before that phase's implementation
  starts, written by an Opus subagent per `CLAUDE.md`'s own process, never edited afterward.
- **`mcp-repo-map-issues.md`** — this chapter's own repo-map MCP dogfooding log, continuing the
  practice v1.5/v1.6/v1.7 established.
