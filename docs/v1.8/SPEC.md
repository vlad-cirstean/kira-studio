# Kira Studio — v1.8

v1.7 shipped the database MCP server as one cohesive chapter (`docs/v1.7/SPEC.md`, M1-M8). This
chapter returns to v1.1/v1.2/v1.4/v1.6's own shape: independent, unrelated phases across two
existing modules — the API client and the git module — so it continues `P` numbering (`P71`+)
rather than taking a fresh letter, the same reason v1.6's own opening paragraph gives for reusing
`P` instead of picking a new one.

**Eight feature rows plus one code-review round and the closing docs row.** Every row below comes
directly from the request that opened this chapter; nothing is invented scope. This table was
originally nineteen rows (sixteen feature rows plus two review rounds plus docs); by explicit
instruction it's consolidated to roughly half that and down to a single code-review round instead
of `CLAUDE.md`'s standard two, given the smaller total surface a shorter table leaves to review.
Small, self-contained items that used to get their own row are now bundled into whichever row they
sit closest to — by shared component when one exists (settings relocation folded into the graph-
panel row that motivates it, blame widget and worktree creation folded together as two small,
unrelated, self-contained git-module additions, the same precedent P71 itself already set by
bundling incognito mode with input sizing), or by shared subsystem when there's no shared root cause
but the same code area (P75's three code-navigation items are one Monaco/codegraph subsystem, not
one bug). P71 already landed as its own row before this consolidation and is unchanged.

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
  vs. double-click) — P73's "open commit changes" multi-file request and go-to-file/virtual-file
  request extend this path, not replace it. The desktop app's own tab strip
  (`apps/kira-studio/frontend/src/workbench/panels/TabStrip.vue`) independently implements the same
  preview-tab convention (`.is-preview` italic styling) — P73's "temporary tab" ask is about this
  tab strip specifically, separate from the VS Code-extension surface.
- Review UI: `packages/git-ui/src/components/review/` (`ReviewView.vue`, `ReviewCommitRow.vue`,
  `ReviewFilesPane.vue`, `ReviewCommentsPane.vue`, `BaseSelector.vue`), state in
  `packages/git-ui/src/state/review.ts`/`reviewFiles.ts`/`reviewComments.ts`; app-side glue at
  `apps/kira-studio/frontend/src/repo/git/reviewSession.ts` and
  `apps/kira-studio/frontend/src/repo/RepoReviewView.vue`.
- Settings: per-repo git-graph settings already distinguish a per-repo flag from a global one —
  `packages/git-ui/src/state/repoSettings.ts`'s `instanceWide` schema flag (documented L25-40),
  merged across repos regardless of which repo's write triggered the change event. P72's settings-
  relocation piece reuses this exact mechanism (or promotes further into the app-wide
  `SettingsDialog.vue`/`settings.ts` where a setting is genuinely app-wide, not just instance-wide-
  but-still-per-repo-shaped) rather than inventing a second one.
- Seti file icons already exist and are used in the file tree —
  `packages/git-ui/src/icons/setiFileIcon.ts` (+ test), consumed by `FileTree.vue` and mirrored
  app-side at `apps/kira-studio/frontend/src/repo/fileIcon.ts`. P73 is wiring this into
  `TabStrip.vue`, not building a new icon set.
- Branches/stashes: `packages/git-ui/src/components/BranchPicker.vue` (also handles worktree
  switch/open-in-new-window, bubbled from `WorktreeList.vue`), `StashList.vue`/
  `GlobalStashList.vue`/`StashDetailPane.vue`.
- Row-level right-click already has a working framework — `packages/git-ui/src/components/
  RowContextMenu.vue`, a thin wrapper over `@kira/kira-ui`'s `KuiContextMenu`, driven by
  `rowMenuModel.ts`'s `MenuSection[]`, used by 8 row components today. P76's worktree action plugs
  into this, reusing `WorktreeList.vue`'s existing create/switch machinery rather than a new dialog.
- Status bar is `apps/kira-studio/frontend/src/workbench/StatusBar.vue` (currently CPU/memory/cache/
  update-state only — no blame widget yet). P76 adds one.
- The API module's request/response UI is `apps/kira-studio/frontend/src/views/httprequest/`
  (`HttpRequestView.vue`, `RequestBodyPane.vue`, `RequestHeadersTable.vue`, `QueryParamsTable.vue`,
  `ResponsePane.vue`, etc.), backed by `apps/kira-studio/frontend/src/api/state/`
  (`collections.ts`, `variables.ts`, `history.ts`) and the protocol layer in
  `packages/api-core/src/http/*`. **Nothing here is browser-local** — tabs, history and variables
  are all backend-owned records synced over the bridge to Go/SQLite
  (`apps/kira-studio/frontend/src/state/tabs.ts`, `internal/storage`, `internal/apivars/`), unlike a
  typical browser "incognito" implementation. No incognito/private-session concept exists anywhere
  in the app yet — P71 is new ground, not extending a partial mechanism.
- Code navigation: `apps/kira-studio/frontend/src/views/repo/navigation.ts` registers Monaco
  `DefinitionProvider`/`HoverProvider` (F12/hover both work) backed by `internal/codegraph`, but
  never `registerReferenceProvider`/`registerImplementationProvider`, and Cmd/Ctrl+click doesn't
  navigate despite the same provider backing F12. `internal/codegraph/resolve.go` ranks candidates
  by scope-proximity only (never receiver-type/method-set) — the hover UI's own markdown already
  labels every result "_Name-resolved, not type-resolved._" Go's `ImplementationsOf` returns nothing
  today because `internal/codeparse/queries/go/tags.scm`'s `method_declaration` capture stores a
  method's name only, never its receiver type — TS/Java already resolve further via
  `extends_clause`/`implements_clause`/`superclass` captures. Monaco's own stock peek-references/
  peek-implementation UI is already fully bundled in this app (`register.all.js` pulls in
  `ReferencesController`, `GoToImplementationAction` — confirmed present, not stripped), so wiring
  the missing providers isn't blocked on UI; it's blocked on `Refs.Sites`/`Target` carrying no per-
  occurrence confidence signal a bare `Location[]` can express. All three findings came from the
  same code-intelligence discussion, not from any phase's own planning pass — P75 covers them.

**Sequencing.** P71 (API module, already landed) is fully independent of the git-module rows.
Within the git module: P72 (remove the dead repo-switch dropdown, fix graph rendering/perf/layout —
reload-on-return, checkout misalignment, scroll flicker, label sizing, sticky graph-header-vs-tab-
bar — then relocate the settings that touching those fixes may have moved) goes first among the
git-module rows since P74/P75's own dependents need stable graph navigation to build on; the
settings-relocation piece sits last within P72 itself so it isn't relocating a setting whose
behavior is about to change again mid-phase. P73 (tab-strip seti icons, markdown reading-view font)
is small, unrelated, self-contained polish bundled into one row per this chapter's own precedent
(P71's own two-item bundle) and placed right after P72 since one of its two items touches the same
tab strip P72's sticky-header fix does. P74 (commit detail: show-more, PR icon relocation, PR icon
per commit; diff viewing: multi-file open, temporary tabs, go-to-file including virtual files) is
one row since both extend `DetailPane.vue`'s file-opening path directly — the PR/detail-panel work
naturally precedes the diff-viewing work internally, same reasoning as before, just no longer split
across two rows. P75 (review tab: fix broken commit-diff/graph navigation, then the checkbox/
placement/comment-interactivity/highlight polish) is one row — fixing broken navigation and then
polishing the view it just fixed always had to happen in that order, so folding them into a single
row changes nothing about execution, only the row count; it needs P72's graph stability and P74's
diff-opening path already landed, exactly as before. P76 (blame widget, worktree creation) bundles
two small, self-contained, unrelated git-module additions — same "small items don't need separate
rows" reasoning as P73, placed after the review-tab work since neither depends on it. P77 (branches/
stashes redesign) stays its own row — the largest single UI-scope item remaining, not a candidate for
bundling. P78 (Cmd/Ctrl+click fix, Go inheritance matching, reference/implementation wiring) merges
what were three separately-discovered rows in the same Monaco/codegraph subsystem: internally, the
click fix has no dependency on the other two and can land first or in parallel within the phase; Go
inheritance matching must land before reference/implementation wiring within the same phase, for the
same reason as before — `ImplementationsOf` returns nothing for Go until the receiver-type/method-set
gap closes, so wiring a Go-to-implementation command ahead of that would ship dead functionality for
the app's own primary backend language. P79 (the single code-review round, by explicit instruction
rather than `CLAUDE.md`'s standard two) and P80 (main-docs update) close the chapter.

| Phase | Deliverable | Why here |
|---|---|---|
| **P71 API module: incognito mode per tab, 4-row auto-growing inputs** | A per-tab incognito toggle: when on, nothing from that tab's session persists once its tab closes — no history entry, no env/variable writes, no collection changes, no saved request. Since the API module has no browser-local storage at all (`apps/kira-studio/frontend/src/state/tabs.ts` and `api/state/*` all write through the bridge to Go/SQLite), this phase's own planning pass designs how an incognito tab's runtime state stays purely in-memory on the frontend and never reaches those bridge calls, while everything else about the tab (rendering, running requests, viewing responses) keeps working normally — plus a clear visual indicator the tab is incognito. Second, unrelated item in the same row since both are small, module-local, UI-only changes: the raw-text inputs (headers/body/params, wherever a textarea currently clips) grow up to 4 rows before switching to internal scroll, instead of a fixed single-row height | Self-contained, no dependency on any other row. **Landed** — see plan/implementation commits |
| **P72 Git graph panel: remove repo-switch dropdown, rendering/perf/layout fixes, settings relocation** | Delete `RepoPicker.vue` and its `AppToolbar.vue` mount point — Kira Studio's own left sidebar and the VS Code extension's one-repo-per-window model both already make it redundant. Fix four related rendering/perf symptoms in `CommitGrid.vue`/`graph/layoutStore.ts`/`graph/layout.worker.ts`/`graph/rowSvg.ts`: the graph fully reloads every time its tab regains focus instead of keeping its computed layout; checking out a branch/commit visibly disaligns the graph before it snaps back; scrolling flickers; branch/tag labels render smaller than the adjacent commit-message text and should match. This phase's own planning pass determines whether the first three share one root cause (stale-cache/recompute-on-mount, or worker round-trip timing) or are separate bugs, and states which. Then audit `RepoSettingsDialog.vue`'s full settings list against `repoSettings.ts`'s existing `instanceWide` flag and relocate look/appearance settings (and anything else with no legitimate per-repo axis) into the app-wide `SettingsDialog.vue`/`settings.ts`, setting by setting, stated with reasons — not a blanket move | First among the git-module rows: P74/P75 both depend on stable graph navigation; settings relocation sits last within this row so it isn't relocating a setting whose look/appearance behavior this same row may have just changed |
| **P73 Tab-strip icons and markdown reading-view font** | `TabStrip.vue`'s tab icons don't reuse the seti icon set already used in `FileTree.vue` (`packages/git-ui/src/icons/setiFileIcon.ts`, mirrored at `apps/kira-studio/frontend/src/repo/fileIcon.ts`) — wire it in so a file's tab icon matches its tree-view icon. Separately: the markdown preview's default reading-mode view is already correct, but its font size renders noticeably smaller than the code editor's own font size — fix it to match | Small, self-contained, unrelated pair bundled per this chapter's own P71 precedent; placed right after P72 since the tab-strip icon change sits beside P72's sticky-header fix |
| **P74 Commit detail, PR integration and diff viewing** | `DetailPane.vue`/`CommitMeta.vue`: fix "show more" (truncated commit message/body expansion currently does nothing); replace the GitHub PR icon's current click behavior (opens the PR in an embedded webview — this phase's own planning pass locates that webview path, not found in `git-ui`'s current commit-detail code during this chapter's own scoping, so it may live in the desktop app's own git integration or the VS Code extension host; confirm before changing) with inline PR status (open/closed/merged) in the panel plus an external-browser link, never embedded; extend `pr.ts`'s `PrState` beyond branch-tip-only lookup so any commit on a PR-associated branch shows a small GitHub icon on its time/sha line, reachable from anywhere on the branch. Then diff viewing: "open commit changes" currently opens only one changed file instead of all of them — open every changed file; those diff tabs currently pin as persistent tabs in `TabStrip.vue` and should open as temporary/preview tabs instead (the same `.is-preview` convention used elsewhere), promoted to pinned only on the same double-click/explicit-edit interaction the file-tree preview convention already uses; add a "go to file" action matching the VS Code extension's own `actions.openInEditor` behavior — jump to the real file and line, working for virtual/synthetic diff content (deleted/renamed/staged-only) too, not just real files | Right after P72/P73: both halves extend `DetailPane.vue`'s file-opening path directly, and the PR/detail-panel fixes naturally precede the diff-viewing fixes that touch the same file rows |
| **P75 Review tab: fix navigation, then UX polish** | From the review tab (`ReviewView.vue`/`RepoReviewView.vue`), opening a commit's diff and revealing a commit in the graph both currently do nothing — trace both broken call paths (likely stale references into the pre-P72 graph-navigation API, or a session-scoped commit list `reviewSession.ts` builds that the graph/detail-panel actions don't recognize) and fix. Once navigation works, polish the same view: the mark-reviewed control is round, make it square; reposition it given the go-to-file button already in the same row area, this phase's own planning pass picks the layout; "add review comment" opens something but isn't interactive in any way — fix it end to end; a partial-review state needs its own indeterminate checkbox visual, not a third color on the same two-state control; once a file is marked fully reviewed, its green "reviewed" row highlight should disappear instead of persisting | After P72 (graph stability) and P74 (diff-opening path); the navigation half is literally broken calls into those two mechanisms, and the polish half only makes sense once navigation is fixed |
| **P76 Git-blame status-bar widget and right-click worktree creation** | Show git blame for the line under the cursor in `StatusBar.vue` (author, relative date, commit summary), updating as the cursor moves. Separately: add a "Create worktree" action to the existing row context-menu framework (`RowContextMenu.vue`/`rowMenuModel.ts`), reusing `WorktreeList.vue`'s existing create machinery already used from `BranchPicker.vue` rather than a second worktree-creation path | Two small, self-contained, unrelated git-module additions bundled per this chapter's own small-item precedent; placed after the review-tab work since neither depends on it |
| **P77 Redesign the branches/stashes dropdown** | `BranchPicker.vue` (branches + worktree switch/open) and the stash components (`StashList.vue`/`GlobalStashList.vue`/`StashDetailPane.vue`) are hard to navigate today per the request. This phase's own planning pass proposes a concrete redesign (grouping, search/filter, disclosure structure) before implementing it, not a cosmetic pass over the existing structure | Kept as its own row — the largest single UI-scope item in the chapter, not a fit for bundling |
| **P78 Code navigation: Cmd/Ctrl+click fix, Go inheritance matching, reference/implementation wiring** | Three findings from this chapter's own code-intelligence discussion, same Monaco/codegraph subsystem: (1) Cmd/Ctrl+click doesn't navigate even though the same `DefinitionProvider` (`navigation.ts`) already backs F12/hover — root-cause before fixing (modifier-click never reaching the provider, a platform Cmd-vs-Ctrl mismatch, an editor option shadowing the binding, or the provider silently failing on click-triggered requests specifically) and fix only the confirmed cause; (2) close `internal/codegraph`'s Go-specific data gap — `method_declaration` captures a method's name only, never its receiver type (`internal/codeparse/queries/go/tags.scm`), so add that capture, extend `go/m1c_fields.scm`'s struct-field capture to the embedded-field case it already documents skipping, build the resulting type→method-set index, and have the Go resolver path check it before falling back to name-proximity; (3) wire `registerReferenceProvider`/`registerImplementationProvider` into `navigation.ts` — Monaco's stock peek UI is already bundled, the backend (`ReferencesTo`/`ImplementationsOf`) already returns lists, but `Refs.Sites`/`Target` carry no per-occurrence confidence signal a bare `Location[]` can express, so design and implement that surfacing (extended return data, a peek-list label/decoration, or another mechanism the plan justifies) before wiring the providers | Found live, not by any phase's own plan; the click fix is independent and can land anywhere within this row, but item (2) must land before item (3) internally — wiring Go-to-implementation ahead of the receiver-type fix would ship a command that silently does nothing for Go |
| **P79 Code review** | Three parallel Opus subagents, one per dimension — architecture/security, functional correctness, performance/resource efficiency — findings-only, per `CLAUDE.md`'s own process, scoped to this chapter's own diff (P71-P78). One sequential Sonnet subagent fixes every finding judged real. A single round, not `CLAUDE.md`'s standard two, by explicit instruction | After P71-P78 land: a review needs a finished tree |
| **P80 Update main docs** | Brings `README.md`, `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md`, `CLAUDE.md` current for this chapter's changes — API incognito mode, the git module's rendering/PR/diff/review/settings/blame/worktree changes, and the code-navigation fixes (click, Go inheritance matching, reference/implementation wiring) — the same "read the current tree, don't trust prose" bar v1.6's P70 and v1.7's M8 used | Last of all: needs the review round's fixes landed first |

## P71 result

Landed per plan (`docs/v1.8/plans/P71-api-incognito-input-sizing.md`), 8 commits (`64463e0d`..
`edc83cfd`). Incognito: a frontend-only per-tab flag (`state/tabIncognito.ts`) filters every tab
snapshot before `tabsSave`, plus new `Incognito bool` fields on the Go RPCs (`HttpSendArgs`/
`GrpcCallArgs`) guarding response-history recording and `internal/oplog`'s persistence (a running
incognito op still shows live in the Operations panel, just never written); an incognito tab's
active environment is a per-tab in-memory override rather than touching the shared active-env row.
4-row auto-grow: a CSS grid-replica trick (`primitives.css`'s `.p-input.is-grow`) behind an opt-in
`grow` prop on `TextField.vue`/`AutocompleteField.vue`, wired into every raw-text cell the plan
scoped in (params/headers/form-data/gRPC metadata), correctly leaving out the URL/target fields,
Monaco body editors, form-data's content-type cell and `VariableRow`'s password-type value cell.
Independently re-verified: `go build/vet/test` clean, `bun typecheck/lint/build` clean, 1370/1370
unit tests, 118/118 relevant Playwright UI specs. One pre-existing, unrelated flake noted and
confirmed untouched by this phase's diff (`internal/grpcclient`'s reflection test, a port race in
that package's own suite). No known gaps against the plan.

## P72 result

Landed per plan (`docs/v1.8/plans/P72-git-graph-panel.md`), 8 commits (`ed550d39`..`8b346fc3`).
Root cause confirmed and fixed in three independent pieces: reload-on-tab-focus fixed by keeping
`RepoGraphView.vue` mounted across tab switches (`KeepAlive`) rather than tearing down and
rebuilding the whole layout; checkout misalignment fixed by keeping the graph layout on screen
across a refresh instead of resetting it to zero lanes mid-stream; scroll flicker fixed by
rebuilding row heights when PR badges resolve (`invalidateRowHeights()` alongside
`invalidateAllRows()`) — the plan's own fallback `minRowBuffer` widening (§5.2) was confirmed
unnecessary once this landed, and the `ResizeObserver`-on-`KeepAlive` open question was confirmed
answered (fires reliably on both Chromium and WebKit via a standalone repro) so the plan's fallback
`MountHandle.refresh()` method was correctly never added. Label sizing now reads off the shared
`--kv-*` type scale. Settings: `dateFormat` and `kiraVersion.log.level` moved app-wide
(`appearance.dateFormat`, `advanced.gitLogLevel`); `log.level`'s key stays a genuine `source:
'repo'` schema entry since VS Code's `RepoSettingsDialog.vue` remains its only editing surface
there (host-conditional via the `MountOptions.host` seam) — only its `instanceWide` cross-repo-
collapse special case was deleted, per the plan's own detailed prose over its summary table's
shorthand. Independently re-verified: `go build/vet/test` clean, `bun typecheck/lint` clean, both
`bun run build` (desktop) and `bun run build:vscode` (extension) succeed, 1370/1370 unit tests,
26/26 relevant desktop Playwright specs (`repo-graph-lifecycle`, `repo-workspace`, `tabs`,
`settings-apply-on-save`, `settings-code-intelligence`) plus 16/16 VS Code extension
`graph-columns.spec.ts`. No known gaps against the plan.

## P73 result

Landed per plan (`docs/v1.8/plans/P73-tab-icons-markdown-font.md`), 3 commits (`4c1a741e`..
`ea539a39`). Tab icons: `TabKindDef.icon` widened to `string | { filePath }`; `repo-file` is the
one kind that returns `{ filePath: tab.path }`, resolved by `TabStrip.vue` through the same
`fileIconStyle()` the repo file tree already uses — `repo-diff` stays on `git-compare` per the
plan's stated reason (the only glance-level diff signal given tab-title truncation). Deleted the
now-orphaned `repoFileIcon()` and its `monacoLanguageFor` import, verified by grep rather than the
repo-map MCP server per the plan's own dogfooding note (its confirmed non-call-read false negative,
`docs/v1.8/mcp-repo-map-issues.md`). Markdown font: root cause was never the base size (already
tied to `--kira-font-size`, matching Monaco) but two real defects either side of it — fenced code
inherited `:deep(code)`'s `--kira-t-sm` step-down, fixed by a more-specific `:deep(pre code)` rule
at `--kira-t-md`; and Tailwind preflight zeroes heading `font-size` with `.md-reading` never
restoring it, fixed with an `em`-based `h1`-`h6` scale (1.6/1.4/1.2/1.05/1) that tracks the
Appearance font-size setting rather than a literal or `--kira-t-xl`. Two assertions added to the
two existing specs the plan named (`repo-workspace.spec.ts`'s per-language-icon test, a tab's
`.tab-file-icon` mask-image now compared to its tree row's; `markdown-reading.spec.ts`'s
Source/Reading test, a fenced block's computed `pre code` font-size compared to a Monaco
`.view-line`'s) — no new spec file, no new unit test, per the plan's own bar. Independently
re-verified: `go build/vet` clean (no Go touched), `bun typecheck/lint` clean, both `bun run build`
(desktop) and `bun run build:vscode` succeed (`packages/git-ui/` untouched, confirmed by diff),
1370/1370 unit tests, 268/270 full `ui` Playwright tier passing — the two failures
(`cell-editor.spec.ts`'s <250ms grid-response bound, `grpc-request.spec.ts`'s debounce-timing
assertion) are pre-existing wall-clock-contention flakes in files this phase's diff never touches,
neither reproducing when re-run outside the full-parallel tier. No known gaps against the plan.

## P74 result

Landed per plan (`docs/v1.8/plans/P74-commit-detail-pr-diff-viewing.md`), 9 commits (`679f508f`..
`89ee3cc5`) — the plan's own 7, plus 2 follow-up fixes for regressions this phase's full-suite pass
caught, per `CLAUDE.md`'s "implement whole plan first, then test once" rule.

§1.4's runtime check (harness, `.kv-detail-pane-meta` after "Show more"): `maxHeight` resolves to
`px` at both a 300px and an 800px app height (`50%`, not `none`), and `scroll` (891) exceeds
`client` (150/400) at both — confirming §1.3b's clipping defect, not §1.4's unproven "cap never
resolves" candidate. Fix: the Refs row now gates on `detail.decoration.length` (a reactive prop
read) instead of a non-reactive `decorationEl.childNodes.length`; the expanded region moved from a
hard `max-height: 50%` clip to `flex: 0 1 auto; min-height: min(220px, 60%); max-height: 70%;
overflow: auto` — bounded and scrollable, not unbounded (the plan's own "clipping" framing read as
unbounded growth; it isn't, and `commit-meta-clamp.spec.ts` now asserts the real shape:
`clientHeight` grows past the collapsed cap and `overflowY` is `auto`, not `scrollHeight <=
clientHeight`, which is false by design against the harness's own deliberately-tall fixture).

§3's external PR link: fixed all four anchor sites, two beyond the plan's own grep
(`BranchPicker.vue`/`StackList.vue`'s stack badges, `refBadges.ts`'s SlickGrid-formatter badge) —
each now a `<button>` calling `pr.browserUrl`/`GitHubService.OpenPullRequestURL`, never a raw
`<a href>`. Contract version 35 → 36.

§5.1's host-check ("does desktop already open N tabs"): substituted source-reading
(`hostHandlers.ts:265`-`291`) for a literal GUI click-and-count — no GUI in this sandbox — per the
plan's own §0 allowance. Confirmed: desktop already opened one tab per changed file; the defect was
`pinned: true` making every one of them permanent. Fixed by widening `previewIdByWorkspace` to
`previewIdsByWorkspace` (a cohort) and passing `pinned: false` with `previewCohort` set on every
file but the first.

§7 (Go to file): implemented per plan, reusing `mapLineAcrossDiff` verbatim (never re-derived) for
the live-file drift remap; `repo-file` tabs carry an optional `rev`, titled with the short rev when
set; two callers wired (`FileTree.vue`'s row menu, gated on `sha` being available; `RepoDiffView.vue`'s
new `repo.goToFileFromDiff` command). One named gap: `RepoDiffView.vue` has no toast/announce
channel of its own (unlike `packages/git-ui`'s shared `App.vue`) — its `unavailable`/failure case
falls back to `console.warn`, a real gap, not a silently invented notification system.

**§10 tests — one deviation from the plan's own file names, stated plainly.** The plan names
`tests/ui/tabs.spec.ts` for the §5.2/§6 cohort/promotion assertions and `tests/ui/repo-workspace.spec.ts`
for §7.2/§7.3's go-to-file assertions. Neither can carry them as written: `tabs.spec.ts` is
exclusively the Postgres/DB tab system (no git fixture at all, and `preview: true` is never passed
for any non-repo tab, so there is nothing to assert there regardless of what's added);
`repo-workspace.spec.ts`'s own `gitStreamMock` answers only `app.init`/`repo.list`/`refs.list` and
has no streaming support for `graph.stream` or a `commit.detail` response, so no commit can be
selected to trigger "Open all changes" or "Go to file" through it as built — extending that mock
with real streaming support was not part of this phase's scope. Extended
`tests/unit/repo-tab-slots.spec.ts` instead — `state/tabs.ts`'s own preview-cohort/promotion
mechanism already carries a `§15.1`-style doc comment naming that file as its intended direct unit
test, the same precedent the file's pre-existing C5-era tests already follow — plus two new files in
that same one-topic-per-file directory: `repo-file-tab-revision.spec.ts` (`openRepoFileTab`'s
rev-aware identity and title) and `repo-go-to-file-handler.spec.ts` (`editor.goToFile`'s three
outcomes, live/historical/unavailable, including the line remap). `pr.test.ts`'s ancestry-walk
tests and `commit-meta-clamp.spec.ts`'s two new assertions landed exactly where the plan named them.
`rebuildAncestry` gained an optional `budget` parameter (default unchanged, every production caller
unaffected) purely so the budget-cutoff test needs a 5-row fixture instead of a 50,000-row one — an
initial version without it built the real-sized fixture and, combined with a `sha` helper that
padded on the wrong side and collided every row into one `ShaTable` hash bucket, hung a test run
long enough to need killing; both are fixed, and the lesson (pad a synthetic sha on the
most-significant side, or use a testability seam instead of a large fixture) is recorded here rather
than as a standing rule, since it's a one-off test-authoring fact, not a working-agreement change.
`wireConformance.test.ts` (named in the plan's §11.3 for keeping a contract version bump in step)
does not exist anywhere in this repo — confirmed by search, not fixed here (out of this phase's
scope). Its absence had a concrete, not hypothetical, cost: `165b376b`'s own contract version bump
left three things stale that only this phase's own full-suite verification pass (not any per-commit
fast check) caught: `packages/git-ipc/testdata/graphChunkFrame.{bin,json}`'s own captured
envelope version (regenerated via `gitsock`'s `TestFixtures_CaptureGraphChunkFrame`,
`KIRA_GIT_FIXTURES=write`), `internal/gitrpc/stash_test.go`'s `TestContractVersion_Is35` (moved
forward to `Is36`, its own established per-bump convention), and `internal/bridge/gitstream.go`'s
allowlist missing the new `pr.browserUrl` method entirely (caught by
`TestGitrpcDispatch_EveryMethodIsClassified`, a security-relevant classification gap, not cosmetic).
All three fixed as the two follow-up commits above.

Independently re-verified: `go build/vet` clean, `go test ./...` clean (`internal/grpcclient`'s
reflection test is the same pre-existing full-parallel-run flake P71 already noted — reproduces only
under the full suite's resource contention, passes standalone and does not recur on a second full
run), `bun typecheck/lint` clean, both `bun run build` (desktop) and `bun run build:vscode` succeed,
1456/1456 unit tests (`bun run test:unit`), 275/275 `ui`+`ui-timing` Playwright tests (`bun run
test:ui`, 7.9m). No other known gaps against the plan.

## Layout

- **`SPEC.md`** — this file, one row per phase, updated as phases land or split.
- **`plans/`** — one implementation plan per phase, committed before that phase's implementation
  starts, written by an Opus subagent per `CLAUDE.md`'s own process, never edited afterward.
- **`mcp-repo-map-issues.md`** — this chapter's own repo-map MCP dogfooding log, continuing the
  practice v1.5/v1.6/v1.7 established.
