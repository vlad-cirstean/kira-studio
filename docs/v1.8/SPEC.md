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
rather than `CLAUDE.md`'s standard two), P80 (main-docs update) and P81 (fix the flaky UI tests
P79's own full-suite verification pass surfaced) close the chapter.

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
| **P80 Update main docs** | Brings `README.md`, `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md`, `CLAUDE.md` current for this chapter's changes — API incognito mode, the git module's rendering/PR/diff/review/settings/blame/worktree changes, and the code-navigation fixes (click, Go inheritance matching, reference/implementation wiring) — the same "read the current tree, don't trust prose" bar v1.6's P70 and v1.7's M8 used | Needs the review round's fixes landed first |
| **P81 Fix flaky UI tests** | P79's own full-suite verification pass (`bun run test:ui`) found three Playwright UI tests that fail intermittently under full-suite parallel load but pass every time in isolation: `cell-editor.spec.ts`'s "autodetect, beautify, override, NULL/empty/truncated, read-only" (a hardcoded `elapsed < 250` ms assertion), `grpc-request.spec.ts`'s "typing the target debounces schema loads to one call" (asserts zero calls inside the debounce window), and `slick-grid.spec.ts`'s "SlickGrid spike — §7.4(a)'s eight sandbox-provable exit criteria" (asserts zero DOM sub-row mutations). A fourth surfaced later, fixing the P79 `CommitGrid.vue` resize-race regression (`14e406eb`): `apps/kira-studio-vscode`'s `commit-meta-clamp.spec.ts` "collapsed shows only the title..." fails intermittently (~4/12 runs) under load, confirmed present on the pre-fix baseline too, so unrelated to that fix. This phase's own planning pass root-causes each — most likely parallel-worker CPU contention pushing a real timer/debounce past a fixed threshold, or a shared-fixture race — and fixes properly (a wider tolerance only where the assertion's intent survives it, `page.clock`/deterministic timer control where the test means to assert ordering rather than a wall-clock budget, or fixture isolation if that's the actual cause), not by loosening assertions until they stop failing | Last: closes the chapter once docs are current; independent of P80's content but ordered after it per instruction |

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

## P75 result

Landed per plan (`docs/v1.8/plans/P75-review-tab-navigation-polish.md`), 6 commits (`b5c40f47`..
`c426acec`), in the plan's own §9.1 order.

**§1 (collapsed-row "Open all changes").** Root cause confirmed exactly as the plan's own §1.1
found it, not SPEC's original guess (stale references into the pre-P72 graph-navigation API): every
row-action bundle `ReviewCommitRow`'s `openAllChanges`/"Open in graph" call through was built per
*expansion*, `#createRowActions(repoId)` inside `expand()` — so a row never expanded had no bundle
at all, and its own "Open all changes" read `undefined`. Fixed by moving the bundle to session scope
(`ReviewSessionState.rowActions`, set in `setTarget`/cleared in `clearTarget`, reused rather than
rebuilt by `expand()`), reachable before a row is ever expanded.

**§2 ("Open in graph").** Root cause confirmed exactly as the plan's own §2.1/§2.2 found it, also
not SPEC's guess (a stale session-scoped commit list `reviewSession.ts` builds): the anchor was a
`command:kiraVersion.openCommitInGraph?…` URI, a VS Code webview escape hatch with no handler at any
layer in Kira Studio's own Wails WebView — both hosts already implement the reveal behind different
existing mechanisms, only the shared component's own route to either was missing. Fixed with a new
contract request, `graph.revealCommit` (`{repoId, sha} -> {revealed}`), answered locally by both
hosts (desktop: `hostHandlers.ts`, reusing the blame-reveal stash/activate sequence
`blameAnnotation.ts` used to duplicate; VS Code: `proxyHandlers.ts` calling into
`graphProvider.runUiAction('revealCommit', …)`). Contract version 36 → 37, `stash_test.go`'s
`TestContractVersion_Is36` renamed to `Is37`, `graphChunkFrame.{bin,json}` regenerated
(`KIRA_GIT_FIXTURES=write`) — the same three stale-artifact classes P74's own result section named,
this time caught before landing rather than by a follow-up commit, since this phase ran the fixture
regen and `TestGitrpcDispatch_EveryMethodIsClassified` as part of the commit itself (confirmed no
new `internal/bridge/gitstream.go` allowlist entry needed — `graph.revealCommit` is host-answered,
same class as `review.open`).

**§3 (comment compose zone unclickable).** Root cause confirmed as the plan's §3.1 found it: pinned
`monaco-editor@0.56.0` appends `.view-zones` before `.view-lines` in `.lines-content`, and
`.view-lines` carries `position: absolute; z-index: auto` with no z-index of its own — a later
positioned sibling with `z-index: auto` loses every hit test to it. Fixed with `z-index: 10` (VS
Code's own value for its view-zone widgets) on both view zones this repo creates: the compose zone
and the pre-existing error-banner zone's Retry button, which the plan's own corroboration paragraph
named as sharing the same defect. Also: the compose zone's fixed 120px height is now a starting
guess only, corrected once via a `nextTick`-deferred `scrollHeight` measurement of the mounted
`.review-thread` root plus `layoutZone`, so a long existing comment scrolls inside its own box
instead of clipping; `user-select: text` added to `.review-thread` (Monaco's `.view-lines` layer
otherwise won text selection inside the zone too).

**§4 (mark-reviewed control).** Landed as one atomic commit, per the plan's own "half-converted is
worse than either end state." `FileTree.vue`'s `KuiButton` icon toggle replaced with a real
`<input type="checkbox">` reusing the package's own square-checkbox CSS (`app-shell.css`, P67c D8)
rather than a hand-rolled variant; `indeterminate` gets its own codicon-dash glyph and fill
(`\eacc`, sharing every other declaration with `:checked` in one rule), not a third color on a
two-state control. Moved from the row's trailing cluster (where it shifted position with the
`+N/-N` counts' own width, row to row) to the leading edge, with a same-width empty slot on
directory rows so the whole tree keeps one aligned checkbox column. `click.prevent` since
`ReviewFilesState.mark`'s server answer is this control's only state — an optimistic native toggle
would contradict it for the round trip's duration.

**§5 (reviewed line tint persists after full review).** Fixed in both hosts' own `paint()`
(`reviewDecorations.ts` desktop, `reviewMarking.ts` VS Code extension) with the same three-line
`coverage({start: 1, end: lineCount}, reviewedRanges) === 'full'` guard the plan specified, reusing
the exact helper the per-hunk branch beside it already calls — a fully-reviewed file's whole-line
tint is now skipped; the per-hunk glyph, the overview ruler for a partial review, and the file
tree's own checked box are all unchanged.

**§8 (tests).** `fakeReviewHost.ts` gained a sixth-through-eighth scripted response
(`review.files` with three `none`/`partial`/`full` entries, `editor.openAllChanges`,
`graph.revealCommit`), each recorded onto its own `window.__*Calls` array the same way
`editor.openDiff` already was. `review-interaction.spec.ts`'s old "Open in graph reaches a
document-level listener" case is replaced, not extended — its whole mechanism (a bubble-phase
`document` click interceptor standing in for VS Code's own command-URI link handler) no longer
exists once §2 removed the anchor; the new case asserts the plain `graph.revealCommit` bridge call
instead. New cases: "Open all changes" on a never-expanded row sends `editor.openAllChanges` and
writes to `[data-testid="live-announcements"]`; the Files pane's reviewed control is
`input[type="checkbox"]` with correct `checked`/`indeterminate` across all three `review.files`
rows. Per the plan's own §8 bar, no dedicated unit test was added for §1/§2/§4/§5 — each is either a
type-checked guard/optional removal, a routing change with no decision structure, or a `coverage()`
call into an already-tested helper.

**Known gap, stated per the plan's own §8, not invented coverage.** §3's z-index fix and §5's
desktop-side tint guard live in `reviewDecorations.ts`, reachable only from a mounted review diff
tab; `repo-workspace.spec.ts`'s `gitStreamMock` still answers only `app.init`/`repo.list`/
`refs.list` with no streaming support (P74's own result section already recorded this), so no
harness in this repo can open a review diff to exercise either fix, and extending that mock is out
of this phase's scope. No GUI is available in this sandbox either (the same constraint P74's own
§5.1 footnote named), so verification here is by mechanism, not a literal click-through: confirmed
the exact Monaco layering defect by reading the pinned `monaco-editor@0.56.0` source
(`.view-zones`/`.view-lines` paint order, `.view-lines`'s own `z-index: auto`), confirmed `z-index:
10` is applied to both of this repo's view zones, and confirmed §5's guard reuses the identical
`coverage()` call the already-tested per-hunk branch beside it makes. A real click-through (open a
review diff, click a gutter `+`, type and submit; mark a file reviewed and confirm the tint clears
while hunk glyphs stay) was not performed and is not claimed.

**One deliberate deviation, not a gap.** `transport.ts`'s `emitUiAction`/
`localEmittersByCodeRepoId` are unchanged even though `blameAnnotation.ts`'s rewrite (§2.3) removed
their only caller — the plan's own §7 file table does not list `transport.ts`, deleting them would
cascade into `localEmittersByCodeRepoId`'s only other read site (a bigger ripple than the plan
describes), and both remain a legitimate general-purpose primitive for a future non-hostHandler
caller that needs to push `ui.action` from outside a host handler closure.

Independently re-verified: `go build/vet` clean, `go test ./...` clean, `bun typecheck/lint` clean,
both `bun run build` (desktop) and `bun run build:vscode` succeed, 1456/1456 unit tests (`bun run
test:unit`), 40/40 VS Code webview interaction/layout specs (`bun run test:webview`, including the
new/replaced review-interaction cases) across two full runs. `bun run test:ui` (`ui`+`ui-timing`)
had 2-3 failures per full run, a different set each time (`cell-editor.spec.ts`'s <250ms bound,
`console-format.spec.ts`'s note-visibility timeout, `grpc-request.spec.ts`'s debounce-timing
assertion, `interaction.spec.ts`'s hard 120s timeout) — none in a file this phase's diff touches,
and every one passed standalone or in a small isolated batch; the same full-parallel-run wall-clock
contention P73's own result section already documented for this exact pair of specs. No other known
gaps against the plan.

## P76 result

Landed per plan (`docs/v1.8/plans/P76-blame-widget-worktree-creation.md`), 5 commits (`1eae573a`..
`ee340945`), in the plan's own §13.1 order. No Go file touched, no contract change, no
`CONTRACT_VERSION` bump — confirmed by `go build/vet/test` staying fully cached across the whole
run.

**§2 (the revision-pinned guard).** A real, pre-existing bug, exactly as the plan named it: P74
added revision-pinned `repo-file` tabs (`rev !== null`, read via `file.read`, never the worktree),
but `RepoFileView.vue`'s `blameable` check never grew a matching guard — `blame.line` "always
blames the working tree," so a revision-pinned tab's blame annotation had been showing worktree
blame against different bytes since P74 landed. Fixed with the one added condition the plan
specified: `blameable = gitRepoId !== undefined && rev === null`.

**§4 (controller extraction).** `blameLine.ts` now owns the `blame.line` request/debounce/cache/
cancellation lifecycle, moved out of `blameAnnotation.ts` verbatim, including both bug-fix comments
at their fix sites (5a: the same-line early return must precede `cancelPending`; 5b: an aborted
request must never be cached as a miss). `blameAnnotation.ts` keeps only the Monaco decoration/
hover/reveal-action rendering, now driven by a `BlameLineController` instead of holding the
lifecycle itself. The controller exposes `gitRepoId`/`transport` (beyond the plan's own minimal
sketch) so the reveal action can call `graph.revealCommit` with no second transport lease — the
controller already holds both.

**§5 (status-bar blame item).** `state/blameStatus.ts` is a new owner-token store (mirroring
`cacheStats.ts`/`appMetrics.ts`'s own pattern, so `workbench/` never imports `views/repo/` or
`repo/git/` directly). `RepoFileView.vue` now creates the blame controller whenever `blameable`
(regardless of the `inlineBlame` setting — §5.3's deliberate call: the setting governs only the
inline annotation's own renderer), claims the store, and publishes the controller's state to it;
`inlineBlame` toggling only attaches/detaches `blameAnnotation.ts`'s renderer, never the controller
itself. `StatusBar.vue` renders the claimed state as a left-side item (`data-testid="blame-status"`,
author/relative-date/subject text, absolute-date tooltip), clicking it calls
`graph.revealCommit` verbatim — no new contract method, per the plan's own reuse of P75's request.

**§8/§9 (create-worktree row action).** `createWorktreeHere` (`plainItem`, not `gatedItem` —
`worktreeAdd` is not in `GATED_OP_KINDS`, so it stays enabled through an in-progress operation) is
now offered in `buildRefMenu`'s `branch`/`remoteBranch` arms and in `buildRowMenu`'s commit-row
menu, never `tag` (a tag is a point; its own commit row already offers the detached item) and never
either read-only builder. `WorktreeCreateSeed` (`state/worktrees.ts`) replaces
`WorktreeDialog.vue`'s boolean `createOpen` with `createRequest: WorktreeCreateSeed | undefined`, a
seeded reset watch applying `mode`/`branch`/`startPoint` defaults on open. All three call sites
wired: `App.vue`'s commit-row case (`{mode: 'detach', startPoint: sha}`) and ref-row case
(`existingBranch`/`branch` for a local branch, `newBranch`/`branch`+`startPoint` for a remote one,
via `localNameForRemoteBranch`), and `BranchPicker.vue`'s own identical ref-row case, forwarded
through `AppToolbar.vue`/`WorktreeList.vue`'s widened `create-worktree` emit (`WorktreeList.vue`
itself needed no code change — its own create button already forwards no seed, i.e. `{}`, unchanged
in shape).

**§12 (tests).** `blame-line-controller.spec.ts` — the one earned unit test, six cases per the
plan's own table (same-line in-flight, a later line superseding an earlier one, an aborted request
never cached, a genuine RPC failure cached as a miss, `repo.changed` scoped to its own repo, the
all-zero sha resolving to `'uncommitted'`). `rowMenuModel.test.ts` gained five cases proving
`createWorktreeHere` is un-gated and correctly scoped (present+enabled on branch/remoteBranch rows
mid-operation, absent for tag, present in `buildRowMenu`, absent from both read-only builders).

`repo-workspace.spec.ts`'s git-stream mock (`gitStreamMock.ts`) gained an optional, additive third
parameter merged into its own `resultByMethod` — opt-in per call, so every existing caller
(`repo-graph-lifecycle.spec.ts`'s bootstrap() included) keeps hanging on every method beyond
`app.init`/`repo.list`/`refs.list` exactly as before. One new test uses it twice: once answering
`repo.open`/`blame.line` to prove the status-bar item follows the cursor with the mocked
author/subject, and once — for the revision-pinned half — answering the same two plus `file.read`
(seeding a `repo-file` tab with `rev` set directly via `IPC.tabsList`, since the real navigation
paths to one need `graph.stream`/`file.goToTarget`, out of this mock's scope per the plan's §10).
Both `repo.open`/`blame.line` are deliberately left *resolvable* in the revision-pinned half too —
a resolvable trap, not an absent one: had §2's guard been missing, the controller would still have
called them and the item would wrongly have appeared, so its absence here actually proves the
guard rather than passing vacuously because nothing could answer.

**One test-infrastructure snag found and fixed while writing that test, not part of the plan's own
scope.** `mockRuntime.ts`'s `inferredBootMode()` (the "no explicit `windowsEnsure` snapshot" boot-
mode inference already used by other specs in this file) maps a `tabsList` boot tab's `kind`
straight through `TAB_KIND_MODE`, whose `repo-file`/`repo-graph` entry is the fixed sentinel
`'repo'` — never a real `AppMode` — because deriving the actual mode for a repo tab needs
`workspaceKeyOf`/`moduleOfWorkspace`, not that flat table. Seeding a `repo-file` tab as the active
boot tab with no explicit `windowsEnsure` snapshot therefore fed `workspaceState.active` (`state/
mode.ts:44`'s `hydrateMode`) the literal string `'repo'`, which crashed `WorkbenchShell.vue`'s
`MODES[moduleOfWorkspace(workspaceState.active)]` lookup on the very first render — not a bug in
this phase's own code, and not fixed in `mockRuntime.ts` itself (out of scope, and the restored-tab
test earlier in this same file already established the correct way around it). Worked around the
same way that earlier test does: an explicit `{channel: IPC.windowsEnsure, response: {mode:
'studio'}}` snapshot, sidestepping the inference entirely; the test's own explicit `openGitModule`
+ `repoRow.dblclick()` sequence is what actually activates the seeded workspace and reveals its
pre-seeded active tab.

Independently re-verified: `go build/vet` clean, `go test ./...` clean (fully cached — confirming no
Go file changed), `bun typecheck/lint` clean, both `bun run build` (desktop) and `bun run
build:vscode` succeed, 1467/1467 unit tests (`bun run test:unit`), 40/40 VS Code webview
interaction/layout specs (`bun run test:webview`). `bun run test:ui` (`ui`+`ui-timing`): one full
run had a single failure, `cell-editor.spec.ts`'s <250ms bound; a second run (forced to re-execute
`ui` as `ui-timing`'s own dependency) hit a different single failure,
`repo-workspace.spec.ts`'s own pre-existing "search streams results out of order" test — neither in
a file this phase's diff touches beyond adding an unrelated new test to the same spec file, and both
confirmed passing standalone; `ui-timing`'s own `budgets.spec.ts` interaction-budget test ran
borderline-over-bound (13ms/18ms against a 12ms p50) alone too, the same sandbox wall-clock
sensitivity `budgets.spec.ts`'s own in-file comment already names, unrelated to any file this phase
touched. The same full-parallel-run flakiness class P73/P74/P75's own result sections already
documented, not a regression. No other known gaps against the plan.

## P77 result

Landed per plan (`docs/v1.8/plans/P77-branches-stashes-redesign.md`), 9 commits (`3a2b4ca5`..
`2ab14e00`), in the plan's own §18.1 order plus two follow-ups (a fix and a split test commit, both
noted below).

**§9/§10/§11/§12/§7.1 (the shell).** `BranchPicker.vue`'s seven stacked sections fold into five
`KuiSegmented` tabs (Branches, Tags, Stashes, Worktrees, Stacks), one filter box and one scrollable
body shared across them. `pickerModel.ts` is new — the "pure fold out of the template" convention
`refListModel.ts`/`stashListModel.ts`/`stackListModel.ts` already follow, staged in three commits
(cap-only, then per-tab filter scoping, then pin/recency ordering) so each stage's own behavior
could be checked independently against the final test file. `refListModel.ts` itself is untouched
(`review/BaseSelector.vue`/`review/ReviewView.vue` still call it directly).

**§5 (scoped filter, cross-tab counts).** The one filter box now matches each tab's own row
identity (stash/worktree/stack rows, previously unreachable by it at all — N2) and every tab's
`KuiSegmented` badge is a live match count, computed for all five tabs on every keystroke
regardless of which is active, so a query typed on one tab still hints a match sitting on another.

**§6 (rank by recency, pin HEAD).** Local branches rank HEAD first, then a branch checked out in
another worktree, then the rest by `committerDate` descending (closing N3/N4); remote branches and
the global stash bucket rank by recency alone. Tags keep `naturalCompare`, the stash stack keeps
its own index, Stacks keeps its forest order — none of the three reordered. A pinned row is never
capped out (`capWithPins`), and a per-list "Show more" step (`capSteps`, threaded from
`BranchPicker.vue`) raises one list's own cap without touching any other's.

**§7.2/§7.3 (focus and keyboard nav).** Opening the panel focuses the filter box (N6); `ArrowDown`
from it moves into the first row; `ArrowUp`/`ArrowDown`/`Home`/`End`/`Enter` roam the active tab's
rows via `enabledNeighbour`/`firstEnabled` (`@kira/kira-ui`'s own roving-focus primitives, the same
ones `KuiMenuList` uses). One documented deviation from the plan's own prose: those two functions
take `MenuItem[]`, not the narrower `{id, disabled}[]` `pickerModel.ts`'s `rowIds` produces, so
`BranchPicker.vue` pads each row with a local `toMenuItems()` before calling either; a local
`lastEnabled()` (kira-ui exports no such counterpart) backs the `End` key, since
`enabledNeighbour(items, undefined, -1)` does not walk backward correctly from "no selection." All
five row-owning children (`TagList`/`StashList`/`GlobalStashList`/`WorktreeList`/`StackList`) gained
a `focusedRowId` prop purely for `:tabindex`/`:data-row-id` binding — the roving-focus logic itself
lives entirely in `BranchPicker.vue`, reached via one native `keydown` listener on the shared
scroll container (component boundaries don't block DOM event bubbling).

**§14/N9 (stash-selection dead end, fixed).** Selecting a stash from the picker used to leave the
detail pane showing nothing at a narrow breakpoint (`hasSelection` never true for a stash-only
selection) and, at any breakpoint, left the picker open behind the pane it had just filled.
`hasSelection` now also checks `selectionIsStash`; a new `stashState.selected` watch opens the
detail pane at a narrow breakpoint exactly like the existing graph-row watch; `StashList.vue`/
`GlobalStashList.vue` now emit `selected`, closed through the existing `closeForCheckout()` (the
W20 focus-before-close fix), rather than inventing a second close path.

**§13 (palette re-pointing).** Four new `UiActionKind` members — `openTagPicker`,
`openStashPicker`, `openWorktreePicker`, `openStackPicker` — each opening the same panel on its own
tab, replacing the eight `MUTATING_COMMANDS` entries (`tagDelete`, `stashApply`/`Pop`/`Drop`/
`Branch`, `worktreeRemove`, `stackSet`, `globalStashRemove`) that used to funnel into plain
`openBranchPicker` regardless of which row the command actually named. `App.vue`'s `runUiAction`
gains four cases; `AppToolbar.vue`'s `openBranchPicker` expose forwards an optional tab to
`BranchPicker.open`. Contract version 37 → 38 in both `validate.ts` and Go's `contract.go` (kept in
lockstep — `stash_test.go`'s `TestContractVersion_Is37` renamed to `Is38` asserts the Go constant
directly, the same pairing P74/P75's own result sections already established), `graphChunkFrame.
{bin,json}` regenerated. One deviation from the plan's own §16 file table: `contract.go`'s bump
isn't listed there, but is required by the Go-side assertion above — same "caught before landing,
not by a follow-up commit" discipline P75's own result section names for the identical bump.

**Follow-up fix, found while wiring the interaction spec, not part of the plan's own scope.**
`toggle()` (the trigger's own click handler) opened the panel by flipping `isOpen` directly,
bypassing `open()`'s nextTick filter-focus call — so §7.2/N6's focus-on-open only ever ran through
the palette's `runUiAction` route, never a plain trigger click, contradicting `open()`'s own doc
comment. Fixed by routing `toggle()`'s open half through `open()` (no `tab` argument, so the
click-trigger path keeps whatever tab was last active) — landed as its own `fix:` commit
(`7e8a5052`) ahead of the test commit that caught it.

**§17 (tests).** `pickerModel.test.ts` — the one earned unit test, 15 cases per the plan's own
table: HEAD/`checkedOutIn` pinning surviving a filter and a cap of 1, five orderings across seven
row kinds (two of which must not reorder), five filter scopes each over a different field
(`stashLabel`, not the raw message, for stashes), counts staying in sync with the filtered lists
they badge across all five tabs at once, a cap step touching exactly one list, and `rowIds`
unique/in-DOM-order per tab including both Stacks sub-groups. `fakeGraphHost.ts` gained five opt-in
scripted responses (`refs.list`/`stash.list`/`globalStash.list`/`worktree.list`/`stack.list`)
behind a new `withPickerData` option, additive per the plan's own "every existing caller keeps
hanging on every method beyond what it already answered." `branch-picker.spec.ts` is new: five
tabs' badges matching seeded counts, a tab switch swapping the body and the filter's own
`aria-label`, a query's match count following a tab switch (with the matching row rendered after
it), focus-on-open, and the filter/first-row roving-focus boundary in both directions. Per the
plan's own §17.3, `rowMenuModel.test.ts`/`stashListModel.test.ts`/`stackListModel.test.ts` are
untouched — nothing in their own scope changed.

**Two further documented deviations from the plan's own §16 sketch, neither a scope change.**
`pickerModel.ts` wraps a Stacks-tab entry as `PickerList<PickerStackGroup>` (`{summary, branches}`)
rather than the plan's own looser bare-array sketch, so a stack's own base/`needsRestack` survive
alongside its branches into `StackList.vue`. The `focusedRowId` prop on all five row-owning
children is not named for that exact purpose in §16's own file table, though it is structurally
required for §7.3's roving focus to reach real DOM attributes at all.

Independently re-verified: `go build/vet` clean, `go test ./...` clean (including `gitrpc`/
`gitsock` running fresh off the contract bump and fixture regen, not cached), `bun typecheck/lint`
clean, both `bun run build` and `bun run build:vscode` succeed, 1482/1482 unit tests (`bun run
test:unit`), 45/45 VS Code webview interaction/layout specs including the five new
`branch-picker.spec.ts` cases (`bun run test:webview`) across two full runs, one of which also hit
`graph-columns.spec.ts`'s own pre-existing `<date column width>`/`<rebuild gating>` flakes (neither
in a file this phase touches; both confirmed passing standalone, the same class P73's own result
section already documented for that spec). `bun run test:ui`: 270/276 passed, 2 failed
(`cell-editor.spec.ts`'s own <250ms bound, `grpc-request.spec.ts`'s own debounce-timing assertion),
4 not run after that pair — the identical two specs (and the identical assertions) P75's own result
section already named as this sandbox's full-parallel-run wall-clock contention, in neither a file
this phase touched; both confirmed passing standalone. No other known gaps against the plan.

## P78 result

Landed per plan (`docs/v1.8/plans/P78-code-navigation.md`), 11 commits (`21db4135`..`52ce834f`), in
the plan's own §12.1 order, no parallel subagents (the plan's own note: only the seam after commit 2
was real).

**Part A — §1 (the modifier-click affordance).** Root-caused exactly as the plan measured it:
Ctrl+click on macOS is not a bug (`clickLinkGesture.js` picks `metaKey` under `isMacintosh`, never
both), but the cross-file underline/preview never rendered because standalone Monaco's
`StandaloneTextModelService.createModelReference` only resolves an already-open model, and
`goToDefinitionAtPosition.js`'s single-result branch only calls `addDecoration` inside that promise's
`.then`. Fixed with a new `apps/kira-studio/frontend/src/views/repo/textModels.ts`, installed once in
`loadMonaco()`'s existing `.then` (before the first `editor.create`, while `ITextModelService` is
still an uninstantiated `SyncDescriptor`) — it resolves a tab-owned URI straight through
`mod.editor.getModel`, and a `kira-repo` URI with no open tab by reading the file over
`codeWorkspaceReadFile` and routing it through `getOrCreateModel` (the one cache a tab open later
reuses, never a second model path). A capped LRU registry evicts least-recently-resolved preview
models; a preview promoted to a real tab leaves the registry rather than being evicted out from under
it. `RepoDiffView.vue` needed no equivalent change — its own two models are always already open.

**Part B — §2-§5 (Go structural implementations).** `queries/go/p78_method_sets.scm` (new capture
query) plus `codeparse`'s registration now carry a Go method's own receiver type (anonymous today —
`§2.1`'s own gap, closed by naming it off the `receiver` capture), an interface's own method names,
and an embedded field/interface name per type — all as ordinary reference/symbol rows, no schema
migration. `internal/codegraph/methodsets.go` is new: `methodSet(ctx, typeName, depth)` walks
embedding up to a depth cap of 8 with a cycle guard (mutual embedding terminates cleanly, proven by
`TestGoMethodSetMutualEmbeddingTerminates`/`TestGoMethodSetEmbeddingCapsAtDepth`), seeded by
`rarestGoMethodName` (the wanted method with the fewest `FindSymbolsByName` rows, an accepted
bounded-cost heuristic — see Known gaps below) and matched by method name only, never a signature.
`implementations.go`'s Go arm now calls `goImplementationsOf` instead of returning `nil, nil`;
confidence is always `Scoped`, rule strings are `implementationsOf.goMethodSet` (own methods) or
`implementationsOf.goMethodSet.promoted` (completed via embedding) — no case ever claims `Exact`. A
seventh `resolve.go` tiebreak (`sameReceiver`) now demotes-not-filters same-receiver-type Go method
candidates ahead of `basenameMatches`, computed only when the reference site itself sits inside a Go
method (`receiverTypeOf` on both site and candidate, skipped entirely off that path per §5.2's own
cost note).

**Part C — §6-§8 (reference/implementation wiring).** `codegraph.Site` gained a `Confidence` field
(`Exact` for an `IncludeDefinition` row, the group's own confidence otherwise, `RepoWide` for a
singleton) — a thin field assignment, not tested per its own bar. `internal/codeworkspace/nav.go`
gained `Implementations` (a structural copy of `Definitions` over `graph.ImplementationsOf`) and
`References` (over `graph.ReferencesTo`, `RefOpts{Mode: Resolved, IncludeDefinition}`) — `References`
deliberately never early-returns on an empty `Sites` list, since `Total`/`Truncated`/`Unattributed`
can carry a real reading (every occurrence unattributed) even then. `bridge/codeworkspace.go` exposes
both over the wire (`CodeWorkspaceReferenceArgs` new, `Implementations` reuses
`CodeWorkspaceDefinitionArgs`); `packages/shared/domain/repo.ts` gained `refSiteSchema`/
`refResultSchema` and their inferred types. `views/repo/navigation.ts` registers
`registerReferenceProvider`/`registerImplementationProvider` on the same scheme-scoped selector the
existing definition/hover providers already use, publishing a `state/navStatus.ts` readout (new,
no-owner-token store per its own doc comment — `navigation.ts` is the sole writer) that
`StatusBar.vue` renders as a left-side item (`data-testid="nav-status"`) reading e.g. "3 references ·
2 unattributed" or "N implementations · method set, signatures not compared" (the caveat only when
every target's rule starts with `implementationsOf.goMethodSet`); the hover markdown grows its own
"Receiver-matched (Go)" line when every target resolved via `sameReceiver`, replacing the blanket
"not type-resolved" disclaimer for that case only. Both `RepoFileView.vue`/`RepoDiffView.vue` set
`gotoLocation.multipleReferences`/`multipleImplementations: 'peek'` explicitly (still `'goto'` for
definitions — §1.4's fix already lists every candidate in the hover, so the peek's own extra
dismissal buys nothing there).

**§11 (tests).** `implementations_test.go` narrowed to
`TestImplementationsOfGoEmptyInterfaceIsEmpty` (the zero-method-interface path only); the new
`methodsets_test.go` (9 cases) covers structural matching, missing-method exclusion, promotion
through embedding, interface-embedding on the want side, the mutual-embedding cycle guard, the
depth-8 cap, the empty-interface case, the reverse (concrete-name) query direction, and a
same-method-name-different-receiver disambiguation. `resolve_test.go` gained
`TestResolverGoSameReceiverTiebreak` (demotion, not filter — both candidates still returned). UI:
`repo-workspace.spec.ts` gained two Playwright cases per the plan's own §11.3 — modifier-click
(`Meta`, never `Control`; this tier's WebKit reports a Macintosh UA, so a `Control` press would pass
vacuously) rendering `.goto-definition-link` and navigating cross-file, and Shift+F12 opening
`.reference-zone-widget` with the status-bar readout. Case 1 was verified as a genuine regression
guard, not just a green test: temporarily disabling `textModels.ts`'s install call reproduces exactly
the plan's own predicted failure shape (the `.goto-definition-link` assertion fails while a plain
click-then-assert-tab test would have stayed green), then re-enabling it restores the pass. No
dedicated unit test for `Site.Confidence`, `nav.go`'s two new functions, `bridge/codeworkspace.go`'s
two methods, or `render.go`'s extra column — CLAUDE.md's own bar names each as a thin pass-through,
matching the plan's own §11.1 call.

**Known gap, found while writing tests, not fixed (in scope for Part B's own stated heuristic, not a
defect).** `rarestGoMethodName`'s seed-by-fewest-rows heuristic can miss a genuine implementer that
owns the seeded method *only* through embedding/promotion (never as its own literal receiver-based
method row) — `TestGoMethodSetPromotionThroughEmbeddedStruct`'s own comment documents the concrete
shape of this. This is the same "no signature-aware Go matching, no real type inference" boundary the
plan states explicitly as out of scope, not a bug introduced by this phase; it means a promotion-only
implementer can be invisible to `goImplementationsOf` specifically when its own directly-declared
methods are never the rarest name in the interface being queried. No open item filed in
`docs/ARCHITECTURE.md` — it is a property of the bounded-cost algorithm, not a currently-true
limitation of a specific feature.

Independently re-verified: `go build/vet` clean, `go test ./...` clean, `bun typecheck/lint` clean,
both `bun run build` and `bun run build:vscode` succeed (the latter, and `bun run test:webview`'s 44/
45-then-45/45 across two runs, completely unaffected by this phase's diff — no file either build
touches was changed). 1487/1487 unit tests (`bun run test:unit`). `bun run test:ui` (`ui`+
`ui-timing`): two full runs, six distinct failures total across both
(`cell-editor.spec.ts`'s own <250ms bound, `data-view.spec.ts`'s own stop-then-poll race,
`slick-grid.spec.ts`'s own two filter/selection timing cases, `sql-schema.spec.ts`'s own dialog-stage
timing case) plus one VS Code webview flake (`commit-meta-clamp.spec.ts`) on a third, separate
`test:webview` run — none in a file this phase's diff touches (confirmed by diffing every touched
spec file against the pre-phase tree: zero overlap), all confirmed passing standalone, the same
full-parallel-run wall-clock contention class P73 through P77's own result sections already document,
not a regression. No other known gaps against the plan.

## Layout

- **`SPEC.md`** — this file, one row per phase, updated as phases land or split.
- **`plans/`** — one implementation plan per phase, committed before that phase's implementation
  starts, written by an Opus subagent per `CLAUDE.md`'s own process, never edited afterward.
- **`mcp-repo-map-issues.md`** — this chapter's own repo-map MCP dogfooding log, continuing the
  practice v1.5/v1.6/v1.7 established.
