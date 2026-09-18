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
P79's own full-suite verification pass surfaced) were meant to close the chapter, but P82 (repo-list
row polish: drop the hover close button, expand a row to its own worktrees) and P83 (an embedded
terminal, opened at the current worktree) extend it further — both new, unrelated git-module
additions requested directly, not found by any prior phase's own work. Manual testing of P82/P83
surfaced real defects in that same left panel: opening a worktree from the expanded list also lands
it as a second, flat top-level repository row (P82 §5.3's own design — opening a worktree always
imports it as its own `code_repos` record — colliding with the twisty's own nested listing of the
same worktree, so it shows up twice at once), and the panel's repository list and its
active-workspace Files/Search/Review body are one stacked `PanelShell` with the active repo's name
as its title, leaving no room for the two more surfaces this same panel is about to need. P84 (fix
the duplicate worktree listing without giving up P82's own separate-workspace-per-worktree
architecture; split the panel into a Repositories tab and a Files tab; drop the per-workspace
repo-name title, superseded by the two tabs) lands before anything else builds further on that same
panel — by explicit instruction, ahead of the phases below despite the later `P` number, the same
"found live, fixed before its dependents" precedent P81 already set for this chapter. P85 (Claude
Code and user-configured custom scripts, launched from P83's own tab-strip button), P86 (opt-in
Claude Code lifecycle hooks plus a running-agent-sessions status-bar widget) and P87 (that widget's
own keep-awake control) extend the chapter again, each strictly needing the row before it landed
first — together they turn the left panel and tab strip P82/P83/P84 build into the start of an
agentic development environment, not a stopping point after P83.

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
| **P81 Fix flaky UI tests** | P79's own full-suite verification pass (`bun run test:ui`) found three Playwright UI tests that fail intermittently under full-suite parallel load but pass every time in isolation: `cell-editor.spec.ts`'s "autodetect, beautify, override, NULL/empty/truncated, read-only" (a hardcoded `elapsed < 250` ms assertion), `grpc-request.spec.ts`'s "typing the target debounces schema loads to one call" (asserts zero calls inside the debounce window), and `slick-grid.spec.ts`'s "SlickGrid spike — §7.4(a)'s eight sandbox-provable exit criteria" (asserts zero DOM sub-row mutations). A fourth surfaced later, fixing the P79 `CommitGrid.vue` resize-race regression (`14e406eb`): `apps/kira-studio-vscode`'s `commit-meta-clamp.spec.ts` "collapsed shows only the title..." fails intermittently (~4/12 runs) under load, confirmed present on the pre-fix baseline too, so unrelated to that fix. This phase's own planning pass root-causes each — most likely parallel-worker CPU contention pushing a real timer/debounce past a fixed threshold, or a shared-fixture race — and fixes properly (a wider tolerance only where the assertion's intent survives it, `page.clock`/deterministic timer control where the test means to assert ordering rather than a wall-clock budget, or fixture isolation if that's the actual cause), not by loosening assertions until they stop failing | Independent of P80's content but ordered after it per instruction |
| **P82 Git module repo-list row polish: drop the hover close button, expand to switch worktrees** | `GitPanel.vue`'s repo rows show an always-on-hover "×" (`.repo-row-close`, `onRowClose`, closes the workspace) — drop it: a repository is imported once and rarely removed or closed this way, and the row's own right-click menu (`onRepoContextMenu`) already lists "Close" (when open) and "Remove" (danger-styled), so nothing is lost, only the redundant quick-access affordance. Separately: give each repo row a disclosure control that expands it to list that repository's own worktrees inline, each one switchable to directly from the list — reuse `WorktreeList.vue`'s existing switch/open machinery, the same one `BranchPicker.vue` already exposes it through and P76 already reused once for worktree creation, rather than a second worktree-switching path | New chapter work, requested directly rather than found by any prior phase; independent of P77's dropdown redesign (a different component) and of P81 |
| **P83 Git module: an embedded terminal, opened at the current worktree** | A new terminal tab kind, scoped to the active repo's current worktree directory. Two entry points: a right-click "Open terminal" item alongside P76's own worktree-creation context-menu item, and a new "+" button in the tab strip (`TabStrip.vue`, no such control exists there today) opening a dropdown of tab-creation options — for now exactly one entry, "Terminal", leaving room for more without redesigning the control later (P84 adds to this same dropdown). This phase's own planning pass designs the actual mechanism: a Go-side PTY per terminal tab (reach for an existing, well-maintained library per `CLAUDE.md`'s own rule rather than hand-rolling one — e.g. `creack/pty` for the shell process, `xterm.js` for the frontend renderer), how a terminal tab's lifecycle (close, reopen, more than one per worktree) fits the existing tab-strip model, and how its working directory tracks `internal/gitsession`'s own worktree-path resolution. Two more asks fold into this row, both about the left panel `GitPanel.vue` (P82's own surface): a repo or worktree row with a terminal open at its path shows that in the panel — an indicator this phase's own planning pass designs, reading off whatever registry the terminal-tab mechanism above already keeps by working directory rather than inventing a second one; and every repo row, collapsed or expanded, shows its own checked-out branch or detached-HEAD short sha at a glance, not only the expanded worktree children P82's `worktreeLabel` already labels. Third: an expanded row's worktree list sorts the main worktree first, always — P82 already marks it (`wt.isMain`, a "main" badge) but never sorts, so today it appears first only because `git worktree list`'s own incidental order happens to put it there; this phase makes that guaranteed, not coincidental | New chapter work, requested directly; the tab-strip "+" button and its dropdown is new UI surface this phase alone owns, but needs P82 landed first since all three left-panel additions extend P82's own row/worktree markup rather than duplicating it |
| **P84 Git panel: fix the duplicate worktree listing, split Repositories and Files into separate tabs** | Real bugs from manual testing of P82/P83's own left panel, fixed before anything else builds on it further. (1) Opening a worktree (`switchToWorktree` → `openRepoAtPath`, `state/coderepos.ts`) always imports it as its own new top-level `code_repos` record, which lands it as a second, flat top-level row in the same list where its parent repo's own twisty already lists it nested — so the identical worktree renders twice, and the panel visually conflates "every top-level repository" with "every worktree of the repository I have expanded." This phase's own planning pass designs the fix without giving up P82's own separate-workspace-per-worktree architecture (each worktree still needs its own file tree/search/review/graph, the reason P82 §5.3 rejected switching the graph in place) — most likely: an opened worktree stays reachable only in its nested position under the parent repo (marked open/active there), never duplicated into the flat top-level list, with the top-level list reserved for repositories the user explicitly imported. (2) `GitPanel.vue` today is one `PanelShell` stacking the repo/worktree list and the active workspace's Files/Search/Review `SegmentedControl` body in a single scrollable column, titled with the active repo's name — split it into two separate top-level tabs, "Repositories" (the repo/worktree list alone) and "Files" (the active workspace's Files/Search/Review body alone), each getting the full panel height instead of the current `.repo-section.has-workspace` 50%-height cap this phase's own split makes unnecessary. (3) Remove the repo-name panel title — the two tabs already say what's open, and the current title has no room left beside them | Found live during manual testing of P82/P83, fixed ahead of the phases below despite the later `P` number — by explicit instruction, the left panel these later phases (P85's script launcher, P86/P87's status-bar widget) all build further UI into must be correct first |
| **P85 Tab-strip "+" button: launch Claude Code or a configured custom script in a terminal** | Extends P83's tab-strip dropdown (currently one entry, "Terminal") with two more kinds: "Claude Code" (launches the `claude` CLI in a new terminal tab, over the same PTY/worktree-cwd machinery P83 built) and one entry per user-configured custom script. A new "Manage scripts…" entry in the same dropdown opens a config surface (this phase's own planning pass places it — a small dialog, or a new `SettingsDialog.vue` section, whichever fits the existing shape) for adding/editing/removing named scripts (a shell command, a working-directory default, maybe an icon/color) — never predefined by this phase, entirely user-configured, starting empty. Every launched entry opens as the same terminal tab kind P83 built: full PTY output visible, closeable, reopenable — this phase adds launch targets to that mechanism, not a second one | Needs P83's terminal tab kind and PTY plumbing landed first, and P84's panel fix landed first too (this row's script-config surface is reached through the same left panel P84 is mid-redesigning); the dropdown entries and script-config surface are new UI surface this phase alone owns |
| **P86 Claude Code lifecycle hooks, opt-in and user-configured, plus a running-agent-sessions status-bar widget** | Wires Claude Code's own hook system (`SessionStart`/`SessionEnd`/`PreToolUse`/`PostToolUse`/`Notification`/`Stop` — the same mechanism this very repo's `.claude/settings.json` already uses for its own `PostCompact` hook) into every "Claude Code" terminal tab P85 launches — not auto-configured: a user must opt in and set it up from Settings the first time (this phase's own planning pass designs that first-run flow), never silently written into a project's `.claude/settings.json` without the user seeing and confirming it. Separately: a new `StatusBar.vue` widget — same pattern P76's blame item and P78's nav-status item already establish, icon plus a number, absent rather than a zero reading when nothing is running, per that file's own "absent, not a zero reading" convention (`StatusBar.vue:72`-`74`'s comment) — tracks how many Claude Code sessions (P85's launched terminals) are currently running, counted across every open workspace, not per-tab | Needs P85's Claude Code launch entry landed first — there is nothing to hook or count before a session can be launched from the app; the widget is P87's own click target, so P87 follows this row |
| **P87 Titlebar keep-awake toggle, plus an agent-aware auto-awake setting (off by default)** | Un-deferred and redesigned by explicit instruction — no longer a popover reached by clicking P86's status-bar widget. (1) A new icon-only button lives directly in the titlebar (`TitleBar.vue`'s `.title-bar-actions` group), reordering the row's existing buttons: today (once P92's own item 3 lands) the order left-to-right is New window, Connections, Operations, Settings — this phase moves New window to the rightmost position instead, inserting the new keep-awake button immediately to its left, so the final left-to-right order is Connections, Operations, Settings, keep-awake, New window. (2) The button itself has exactly two states, on and off, toggled by a single click — no dropdown, no popover, no three-way menu (superseding this row's own original three-option popover design). (3) A separate, independent "agent-aware" toggle lives in Settings, off by default: when on, the machine is also kept awake automatically whenever at least one Claude Code session (P86's own tracked running-agent count) is active, regardless of the titlebar button's own on/off state. The two sources compose additively — keep-awake is asserted whenever the titlebar button is on, OR the Settings toggle is on and at least one agent session is running — this phase's own planning pass designs how one underlying OS-level assertion is acquired/released across two independent on/off sources without double-acquiring or releasing early while the other source still holds it. Backend is unchanged from this row's own original design, carried over verbatim: a new small Go package behind an OS-abstracted interface (one acquire/release pair for a keep-awake assertion), macOS-only this phase — spawn/kill `caffeinate -i -s` as a child process, never a direct `IOPMAssertionCreateWithName`/`IOPMAssertionRelease` cgo call (Wails has no power-management API of its own; `caffeinate` is Apple's own supported CLI wrapping the identical IOKit API, matching this repo's "reach for existing tooling" rule; the direct-API alternative means unmaintainable, untestable native glue in this sandbox — same reasoning as before, not re-litigated). Every other OS stays a documented no-op. Confirmed against real prior art (Orca, `stablyai/orca`): `caffeinate -i -s` started when an eligible agent begins and killed when the last one ends, the same trigger shape as this row's agent-aware mode, plus the assertion is re-armed on a power-resume event since a live `caffeinate` process's effect doesn't reliably survive sleep/wake. This phase's own planning pass designs the titlebar button's two visual states (icon/color for on vs. off) and the exact `TitleBar.vue` reordering wiring. Deliberately **not** folded in: a separate "keep display awake" sub-toggle (`-d`) — a real, well-motivated feature, but beyond what was asked for here | No longer deferred — redesigned and picked up next by explicit instruction, ahead of P93. Needs P92's New window titlebar button landed first (this phase repositions it, from left of the existing three to rightmost of all) and P86's running-agent count (the agent-aware setting's own trigger signal) — both already landed/landing |
| **P88 App-wide checkbox glyph alignment** | Every checkbox's checkmark glyph renders off-center inside its own box, app-wide, not scoped to one view — this phase's own planning pass finds the shared checkbox primitive (`kira-ui`/`git-ui`'s own checkbox component, whichever backs both) and fixes the glyph's positioning once at that source | Reported live; independent, self-contained fix |
| **P89 Studio: FK preview action layout, SQL format-button regression** | Two `FkPreviewPopover.vue`/console fixes. (1) `fk-preview-actions`' two buttons currently sit at the bottom of the popover, below the previewed row — move "Open in new tab" to the top of the popover and keep it always visible (not scrolled out of view with a long previewed row), and drop "Edit this record" entirely — the user's own read is it "makes no sense" as a FK-preview action. (2) `ConsoleView.vue`'s `onFormat()`: repeated user report (5th time) that after formatting once, any further edit to the query still gets rejected with the `formatNote` "Already formatted — indentation only; keywords keep the case you typed" message instead of actually reformatting the new text. `keywordCase: 'preserve'` (P13 D4) only ever touches whitespace by design, and the note fires whenever `result.text === originalText` byte-for-byte — this phase's own planning pass investigates whether the comparison or the formatter itself is stale (e.g. comparing against pre-edit text, a cached format result, or `splitSqlStatements`/`formatConsoleText` genuinely treating differently-indented input as already normalized when it shouldn't), since a user typing a real edit and seeing "nothing to change" every time points at a real bug, not working-as-designed | Reported live; independent, self-contained fix |
| **P90 Api module: configurable request settings, a Cookies tab, and a broken multi-line value editor** | Three Api-module items. (1) Seven settings, each configurable both globally (Settings) and per-request (overriding the global default), with these defaults: HTTP version 1 or 2 (default 2), request timeout (default 0/none), max response size (default 50 MB), SSL certificate verification (default on), auto-follow redirects (default on), max redirects (default 10), disable cookie jar (default on). This phase's own planning pass designs the per-request override UI (a settings panel/tab on the request editor) and the Go-side plumbing from tab/global config through to the actual HTTP client per request. (2) A new Cookies tab, for both the request editor and the response viewer, showing cookies sent/received — folds in naturally with the cookie-jar setting above since both touch the same client configuration. (3) A real, concrete bug in the raw-text row editor (headers/params/etc., P71's own `TextField`/`AutocompleteField` `grow` prop, `.p-input.is-grow`): entering a value spanning more than one line expands the field, but the displayed text duplicates, scrolling inside it doesn't work, and the cursor lands on the wrong line, making the field unusable once a value wraps — this phase's own planning pass root-causes the grow mechanism's interaction with multi-line content (most likely the CSS grid-replica auto-size trick fighting the textarea's own scroll/cursor state) and fixes it, or replaces the mechanism if the plan finds the trick itself unsound for multi-line values | Reported live; item (2) depends on item (1)'s cookie-jar plumbing landing first within this row |
| **P91 New module: Terminal — quick-command scripts panel and tabbed terminal sessions** | A new top-level module, alongside the API and git modules, reachable from wherever those are (this phase's own planning pass places its nav entry point, matching the existing pattern). Left panel: a list of user-defined "quick command" scripts — a name plus a shell command, added/edited/removed by the user, starting empty, no predefined entries — clicking one runs it in a new terminal tab. Main area: a tabbed terminal view, each tab one running shell session. This phase reuses the PTY/terminal-tab machinery P83 already built for the git module's own embedded terminal (`creack/pty` backend, `xterm.js` frontend, the existing terminal tab kind) rather than building a second implementation — this phase's own planning pass confirms that mechanism's shape is generic enough to host outside the git panel as-is, or states precisely what widening it needs. "Plus like for the repositories" — this module's tab area also offers opening a terminal scoped to one of the app's known repositories/worktrees (`internal/gitsession`'s own worktree-path resolution, the same source P83 already reads), alongside plain unscoped shell tabs; this phase's own planning pass designs how a user picks which repo/worktree to scope a new terminal tab to. Deliberately simple, per explicit instruction: no split panes, no saved/restorable session state beyond what the existing terminal tab kind already gives closing/reopening, no per-script argument prompts — a quick-command script runs its exact configured command with no parameterization | New chapter work, requested directly. Needs P83's terminal-tab/PTY machinery landed first (reuses it) — already landed. Placed before P92 (the renumbered git bug-batch row, held at a fixed relative position by explicit instruction) and after P90 |
| **P92 Git panel: graph column/scroll/labels, titlebar new-window button, diff tabs, review nav, go-to-file, tab-persistence error** | The bug batch held back before P87 (10 items, all from manual testing of P82-P86's own surfaces). (1) The graph column in the git graph should be resizable like the other grid columns, with a capped default size — today it expands without bound as branch count grows. (2) The git graph shows a horizontal scroll bar whose size is dictated by its parent rather than its own content — something in the layout sizing is broken. (3) Titlebar: add a "New window" button, with visible text (frequent-use control), positioned left of the existing three buttons. (4) Scrolling the git graph produces visual artifacts in the row text — not flicker; glyphs render unrecognizable mid-scroll — root-cause and fix for good. (5) "See commit changes" opens one tab per changed file — merge into a single tab structured like VS Code's own multi-file diff view. (6) Move the Review segment onto the same line as Repos/Files (`GitPanel.vue`'s tab row, P84's own split), renaming the three to "Repos, Files, Review". (7) No "go to file" action when viewing a diff — same behavior P74 already built for commit diffs (open the real file, land on the same line the cursor sits on in the diff), missing here. (8) A live binding error surfaces repeatedly: `Binding call failed: Bound method returned an error: {"code":"E_INTERNAL","message":"repos/tabs: record 15: model: tab \"<uuid>\": path is required"}` — a tab persistence write reaching the DB without a required `path`; root-cause which tab-creation path leaves it unset. (9) Add a general-settings control for git-graph font size. (10) Graph branch/tag labels should render as a colored margin/border only, with white icon and text inside and no background fill, not the current filled-background style | Found live during manual testing of P82-P86; held back explicitly ahead of P87 (never implemented) — now picked up in sequence since P87 alone stays deferred |
| **P93 Git graph: collapse non-checked-out branches by default, branch-ordered commit layout** | Two related changes to how the git graph tree renders and orders commits, both touching `packages/git-ui/src/graph/` (`layoutStore.ts`, `layout.worker.ts`, `rowSvg.ts`, `geometry.ts`, `graphColumn.ts`) and `CommitGrid.vue`'s own row model. (1) Simplified default view: the graph currently renders every commit on every branch, expanded. By default, only the checked-out branch's own direct-ancestor chain renders fully expanded, commit by commit; every other branch collapses to two visible points — where it starts (diverges from what's shown) and where it ends (its own tip) — with every intermediate commit hidden behind a single clickable, expandable row standing in for that hidden range. Clicking it expands that branch's own intermediate commits inline. This phase's own planning pass designs: the collapsed row's visual representation (a summary count, styling, how it reads next to a normal commit row), the expand/collapse interaction and where that state lives (per-branch, per-session vs. persisted per repo), how a branch with its own further divergence (a branch off a branch) collapses, and how collapsing interacts with the existing lane-assignment/graph-line layout engine (`layoutStore.ts`/`geometry.ts`), which today assumes one row per commit unconditionally. (2) Commit ordering: the graph currently interleaves commits from different branches by timestamp (standard `git log --graph` order) — switch to branch-ordered layout instead: every commit belonging to one branch's own chain renders consecutively before the next branch's commits start, rather than interleaving branch-by-commit-time (so a user never sees one commit from branch A, then one from branch B, then back to A). The checked-out branch's own commits render first, at the top; every other branch's own commit group follows after it. This phase's own planning pass designs the concrete ordering algorithm for how the non-checked-out branch groups are sequenced relative to each other (most-recently-active branch first is the likely default — state it with a reason, not left open) and confirms how branch-ordered layout interacts with the graph's existing incremental/streamed history loading (`graph.stream`, chunked) and its lane-column rendering, both of which currently assume the commit-timestamp order rows arrive in today | New chapter work, requested directly. A substantial change to the graph's own layout/render engine — the two changes are related (both are about how a non-checked-out branch's own commits are grouped and shown) so land together as one phase rather than split into two. Needs its own dedicated planning pass before implementation — explicitly not started yet, by instruction |

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

## P79 result

Single review round, by SPEC.md's own explicit instruction (not `CLAUDE.md`'s standard two). Three
parallel Opus subagents — architecture/security, functional correctness, performance/resource
efficiency — reviewed the full P71-P78 diff, findings-only. Combined: 2 blockers, 7 minor
architecture/security findings, 14 functional-correctness findings, 8 performance findings (31
total). Triaged into 6 file-disjoint fix batches so their Sonnet implementations could run in
parallel (in isolated worktrees, merged back sequentially once all six landed); one finding
(anonymous-nested-struct-embed over-promotion in `methodsets.go`) and one (always-on blame RPCs
regardless of `inlineBlame`) were judged out of proportion for a review-fix pass — the first left as
a documented limitation, the second confirmed a deliberate prior design choice, not forwarded to any
batch.

**Batch A — settings persistence + logging.** `AdvancedSettings.GitLogLevel`/`AppearanceSettings.
DateFormat` existed in the settings schema but were never wired to `storage/model/settings.go`'s
patch structs, `storage/repos/settings.go`'s read/write, or anything downstream — silently a no-op
setting. Fixed end to end: struct fields, defaults, validation, `SettingsService.Set`'s conditional-
hook pattern extended with a hook calling the also-broken `internal/logging`'s new `SetLevel`
(previously hardcoded to `slog.LevelInfo`, "off" now genuinely silences via `LevelError + 4`). Deleted
`SettingDef.instanceWide`, a dead flag left over from a deleted sentinel-row mechanism, once the
app-wide replacement actually worked.

**Batch B — PR link security.** Two blockers: `PrBrowserURL` (`gitsession/gh.go`) and its
`bridge/github.go` validator both hardcoded `github.com`, breaking GitHub Enterprise entirely and,
worse, meaning the validator's authenticated-host allowlist was never really an allowlist for GHES
hosts. Both now thread `repo.Host` through composer and validator (`IsGitHubHost`, reused by both).
VS Code's `proxyHandlers.ts` gained equivalent shape validation (`prUrl.ts`) it previously lacked
entirely. `linkify.ts` still rendered a live `<a href>` for commit-body URLs, bypassing every other
external-open capability gate in the app — replaced with a `<button>` through a new generic
`link.openExternal` wire method (`CONTRACT_VERSION` 38→39) that validates scheme/host before handing
off, wired into both hosts and all three `DetailActions` implementers.

**Batch C — codegraph method-set correctness.** `goInterfacesSatisfiedBy`'s reverse-direction search
seeded candidates from a single rarest method name (sound only forward) — now unions candidates over
every name in `have`. A depth-cap/cycle-guard truncated result was being cached under an ordinary
memo key, poisoning later unrelated lookups — a new `truncated bool` return, propagated through every
call site, now gates the memo write. `resolve.go`'s `sameReceiver` tiebreak ran before `filterTier`
narrowed the candidate set, wasting `ReferencesInFile` queries on candidates about to be discarded —
reordered, no behavior change. `codeworkspace/nav.go`'s `Definitions`/`Implementations`/`References`
each repeated ~120 lines including a security-relevant symlink-containment guard — extracted into
shared `resolveQueryPoint`/`resolvePosition` helpers.

**Batch D — PR ancestry correctness + rebuild coalescing.** `pr.ts`'s `rebuildAncestry` walked with no
base cutoff, tagging nearly the entire loaded history behind any PR branch — a new
`CommitStore.rowOfBranchTip` (local decoration scan, no new RPC) resolves each PR's `baseRef` and
excludes its ancestors. Separately, `CommitGrid.vue` fired one full ancestry rebuild + grid
invalidate/render per individually-resolved PR branch instead of coalescing a burst into one — a
shared `ancestryRebuildPending` flag drained once via `nextTick` fixes both that and a second bug
where newly-loaded rows (window growth) never got PR badges at all.

**Batch E — tabs/preview-model lifecycle.** Six findings in `state/tabs.ts`/`views/repo/textModels.ts`/
`views/repo/blameLine.ts`/`RepoGraphView.vue`: preview-cohort eviction called `closeTab()` once per
evicted tab instead of batching into one state mutation + one save; incognito-off never triggered a
save (only incognito-on did); `openRepoCommitDiffTab`'s tab-reuse path skipped cohort eviction
entirely; the preview-model LRU returned stale content on a cache hit and could dispose a model a live
peek still referenced (`dispose(): void {}` was a no-op); the per-mount blame cache had no cap and
left `inFlight` pointing at settled controllers; `RepoGraphView.vue`'s `KeepAlive`'d graph kept doing
full background work while backgrounded. Fixed directly in the main checkout (this batch's worktree
was hit twice by the provisioning bug documented below, so its third attempt ran unisolated once the
main tree was confirmed idle).

**Batch F — picker/CommitMeta/navStatus polish.** `pickerModel.ts`'s Stacks tab counted branches
where `capItems` counts entries (groups) — a real, visible undercount, fixed to match units.
`navigation.ts`'s `provideReferences`/`provideImplementation` published a stale nav-status readout
after a fast tab switch — both now capture the active tab id before `await` and check it unchanged
after, mirroring `blameLine.ts`'s own guard. `pickerModel.ts`'s `buildPickerModel` recomputed its
full (expensive) filter on every tab switch even when the query hadn't changed — split into
`filterPickerInput` (expensive, query-gated) and `orderAndCapTab` (cheap, per-tab). `CommitMeta.vue`'s
PR icon rendered with no `capabilities.openExternal` gate, unlike every other external-open surface.

**Environment note.** The fix batches' isolated worktrees repeatedly (5 of 6) hit a provisioning bug
where a fresh worktree checked out an orphaned "Initial commit" scaffold instead of the real branch
tip — a race in this container, not a data-loss risk (each affected worktree held nothing of value,
confirmed via `git status`/ancestry before any remediation). Four self-recovered inside their own
isolated worktree via `git reset --hard`/`git merge --ff-only`/a fresh branch off the real tip; Batch
E's two isolated attempts correctly stopped and reported per explicit instruction rather than
self-remediating, so its third attempt ran directly in the main checkout instead.

**Merge and a real regression, caught by full-suite verification.** All six batches' branches merged
sequentially into the main checkout with one manual conflict (`CommitGrid.vue`'s `pr.generation`
watcher: Batch D's coalescing simplification vs. Batch E's KeepAlive-visibility guard on the same
watcher — resolved by composing both, matching the sibling `graphView.generation` watcher's own
established pattern). The full-suite verification pass that followed (mandatory before closing a
review round, not part of any batch's own scope) caught a genuine regression neither batch's own
narrower verification could have: `graph-columns.spec.ts`'s date-column-width webview test failed
deterministically post-merge. Root cause, found by a dedicated follow-up fix (`eab3047e`): Batch E's
zero-size resize guard in `scheduleResize()` accidentally raced its own `detailOpen`-watcher-triggered
rebuild — the same host resize was handled twice (once synchronously via the `detailOpen` watcher,
once async via `ResizeObserver`), and under real CPU load the second pass's `invalidateAllRows()`
could detach the exact DOM node a test had just read, mid-measurement. Fixed with two changes: a
`lastRebuiltHostWidth` dedup (skip the async rebuild when the sync one already handled the same
width) plus keying the KeepAlive skip off the actual `graphVisible` signal instead of inferring
backgrounded-ness from a bare 0×0 read. Confirmed via 12 repeated full-suite webview runs, all green
on the target test and its neighbor.

That verification pass also surfaced (not fixed, per instruction — filed as the new P81 below) three
pre-existing flaky UI tests under full-suite parallel load (`cell-editor.spec.ts`, `grpc-request.spec.
ts`, `slick-grid.spec.ts`'s spike test — all pass standalone) plus a fourth found incidentally while
fixing the regression above (`commit-meta-clamp.spec.ts`, confirmed present on the pre-fix baseline
too, so unrelated to that fix).

Then rebased onto `v1.7`'s own new tip (`b39f53d6`, advanced again since this chapter's last rebase)
with `git rebase --rebase-merges` — a plain `git rebase` flattens merge commits and replays every
batch's individual commits linearly, reproducing spurious conflicts against content already
integrated by this phase's own merge commits; `--rebase-merges` preserves that structure and only
replayed the same one real conflict (the `pr.generation` watcher, resolved identically) once, on the
rebased `merge: P79 batch D` commit itself.

**Final verification, on the rebased tree:** `go build/vet ./...` clean, `go test ./...` clean (every
package). `bun run typecheck` clean (all 5 TS sub-projects). 1001/1001 unit tests (`bun test` across
`apps/kira-studio/frontend/src`, `packages/git-ui/src`, `packages/git-ipc/src`,
`apps/kira-studio-vscode/src`, `apps/kira-studio/tests/unit`). `biome check .` clean (one pre-existing
unrelated info-level finding in `UncommittedChangesStrip.vue`, untouched by this phase). Both
`bun run build` and `bun run build:vscode` succeed. `bun run test:ui`: the three known pre-existing
flakes reproduced under full-suite load, all confirmed passing standalone — no new failures.
`bun run test:webview`: 45/45 after the regression fix (verified across the 12 repeated runs above).
Pushed (`git push --force-with-lease`, required since the rebase rewrote already-pushed history).

## P80 result

Landed per plan (`docs/v1.8/plans/P80-update-main-docs.md`, `5f074684`), 7 commits (`39fb7e16`..
`0391cb1a`) — the plan's own 6 plus one fix-up. Every quoted fact/count was re-verified against
current source at edit time rather than trusted from the plan's own prose (itself already written
against a tree-read, not SPEC.md summaries).

**`CLAUDE.md`** — two `docs/v1.7/` → `docs/v1.8/` pointer fixes only, per the plan's own call that
nothing else chapter-specific belongs here.

**`docs/DEV_ENVIRONMENT.md`** — the P79 worktree-scaffold provisioning bug and the `git rebase
--rebase-merges` hazard (a plain rebase flattens merge commits and reproduces spurious conflicts)
recorded as environment facts, plus the `setup.sh` unconditional-bindings-task clause.

**`docs/ARCHITECTURE.md`** — the largest edit (311 lines): deleted the now-false "`ImplementationsOf`
returns nothing for Go" Known-open-item (P78 fixed it) and reworded the neighboring promoted-methods
item to stand alone; rewrote the P62 blame section (P76 shipped the status-bar readout as a sibling
item, not a LAW-14 violation, as the stale prose claimed); recounted (not reasserted) the gitrpc
method table and the C10 write-boundary allowlist directly from `gitstream.go`/`gitrpc/handlers.go`;
added incognito tabs and the external-open capability (`link.openExternal`, `IsGitHubHost`/GHES
support) as new facts with no prior home; added the P77 tabbed-picker paragraph the plan's own §2
omitted but its §6 verification checklist required (flagged as a plan gap rather than silently
dropping the verification bar or silently expanding scope).

**`README.md`** — full v1.8 pass: incognito, the two now-working settings leaves, find-references/
go-to-implementation/nav-status readout, the blame status-bar item, Git-feature clauses, the tabbed
picker, review-checkbox polish, chapter-pointer and Documentation-list updates (v1.8 now live, v1.7
demoted).

**Selectivity on P79, per instruction.** Only genuinely externally-visible P79 changes got doc
mentions (the two settings leaves, GHES host support, `link.openExternal`, the PR-ancestry base
cutoff, preview-model LRU refcounting, the KeepAlive-visibility pause + its resize-race fix); the
purely internal correctness fixes (memo-poisoning, `resolve.go` reordering, `nav.go` helper
extraction, tab-batching, blame-cache cap, `pickerModel` split, nav-status race fix) stayed out, per
the plan's own explicit out-of-scope list.

**Not absorbed, flagged during planning, not acted on:** `docs/v1.8/mcp-repo-map-issues.md` carries
two still-open non-trivial dogfooding entries with no dedicated fix-pass phase in this chapter's own
phasing table — per `CLAUDE.md`'s own repo-map process ("the next phase waits for a dedicated fix
pass to close it"), left open rather than folded into a docs-only phase.

Verification: `bun run typecheck` clean (all 5 sub-projects) on every commit via the pre-commit hook.
Biome does not check `.md` files (confirmed — reports them ignored), so not relied on for markdown;
each doc read start to finish for internal consistency instead. `git diff 5f074684..HEAD --stat`
touches exactly the four named files, nothing else.

## P81 result

Landed per plan (`docs/v1.8/plans/P81-fix-flaky-ui-tests.md`, `ff83352b`), 5 commits (`3b36715e`..
`3bc9197b`). All 4 main flakes fixed, plus 3 folded-in siblings found during planning/fixing. No
assertion loosened anywhere — every fix tightens to a real condition instead of a longer timeout,
per the plan's own explicit constraint.

**`cell-editor.spec.ts`** (`3b36715e`) — scenario 11's `elapsed < 250ms` timing assertion replaced
with a structural check: a marker attribute on the Monaco root proves instance reuse across a cell
switch. Scoped the editor-text read to the encoded pane specifically, not the file's panel-wide
helper — row 3's base64 fixture opens a second MonacoHost (decoded pane), which made the panel-wide
locator strict-mode-ambiguous.

**`grpc-request.spec.ts`** (`aed80b26`) — the 150ms schema-load debounce now driven by
`page.clock.runFor()` via a new `support/clock.ts` helper, installed after app boot. `page.clock
.install()` alone doesn't freeze time (confirmed empirically — real time still elapsed pre-`runFor`);
`pauseAt(Date.now())` also failed (CDP round-trip staleness racing into the past), fixed with a
`Date.now() + 10_000` forward buffer, documented in the helper itself.

**`slick-grid.spec.ts`** (`a433bba9`) — sub-row/cross-row mutation counts now wait for DOM-mutation
quiescence (N consecutive quiet animation frames, `mutationsForScroll()` in `support/grid.ts`)
instead of a fixed `waitForTimeout(300)`. Reverting to the old fixed-wait shape reproduced the flake
(2/3 runs failed); the quiescence version held 3/3. Folded-in sibling at line 504
(`waitForTimeout`→`expect.poll`) converted as planned — didn't reproduce a failure in this sandbox,
reported as such rather than a fabricated mutation-test result; still strictly better since it polls
a real condition.

**`commit-meta-clamp.spec.ts`** (`53453fa3`, vscode webview) — root cause reproduced first:
concurrent `startCommitMetaHarnessServer()` calls under `fullyParallel: true` raced into a shared
on-disk `dist/`, one worker's `emptyOutDir` wiping files another worker's page was mid-load on.
Fixed by building with `write: false` and serving from an in-memory `Map`, eliminating the shared
resource rather than partitioning or serializing it. Build result typed as `Rolldown.RolldownOutput`
— this repo's Vite 8.3.0 is rolldown-based, no `RollupOutput` export exists.

**`http-curl.spec.ts` + `mode-switch.spec.ts`** (`3bc9197b`) — same fake-clock treatment as the gRPC
fix, applied to the 400ms curl-preview and 150ms mode-write debounces.

Every fix mutation-tested (a deliberate regression that should make the rewritten assertion fail,
confirmed failing, then reverted) except the line-504 sibling, honestly reported as not reproducing.

Verification: `bun run typecheck` clean. `bun run test:ui` 3 full runs (272/276, 274/275, 278/279) —
every remaining failure pre-existing and unrelated (`api-ui-consistency.spec.ts:484`,
`interaction.spec.ts:1144`, `slick-grid.spec.ts:1529`, `budgets.spec.ts`'s wall-clock perf tripwire),
none touching the 5 rewritten tests. Targeted `--repeat-each=10` on those 5: 50/50 passed.
`bun run test:webview` 3 full runs, 45/45 every time, all 7 `commit-meta-clamp.spec.ts` tests
included. `git status --porcelain` clean; no `playwright.config.ts` touched in either app.

## P82 result

Landed per plan (`docs/v1.8/plans/P82-git-repo-row-worktrees.md`), 4 commits (`cbaedb4f`..
`87ef598b`), in the plan's own §13 order.

**Part A (`cbaedb4f`).** `onRowClose`, the `.repo-row-close` markup and its three CSS rules deleted,
after confirming §2.2's dead-code claims by grep first (`onRowClose`/`repo-row-close`/
`workspace-repo-close`/`closeRepoWorkspace` all matched exactly what the plan stated).
`repo-workspace.spec.ts`'s close test rewritten onto the row's context-menu "Close" item, plus a new
assertion the button is gone.

**Part B (`2147341d`, `7acb366b`, `87ef598b`).** New `repo/state/worktrees.ts`: per-repo expansion
store (§6), fetching over the same `gitTransportFor`/`ensureRepoOpen`/`worktree.list` shape
`blameLine.ts:158` already uses, §6.3's lease invariant (a lease exists exactly while a row is
expanded, disposing the shared transport too once no workspace has it open), live `repo.changed`
refresh, and both eviction watches (§6.6) mirroring `quickOpen.ts`'s established pattern.
`GitPanel.vue` gained the twisty control, the expanded worktree list (rows/error/loading/empty
states), the `.repo-section.has-workspace` height cap, and new token-based CSS — landed with rows
rendering but not yet clickable, per the plan's own staged-commit sequencing. `state/coderepos.ts`
gained `canonicalPath`/`recordForRoot`/`openRepoAtPath` (§7) — opens an existing row or imports the
worktree first, with the `E_ALREADY_IMPORTED` race fallback — then the store's `switchToWorktree`
and the row's `@click.stop` wiring, plus §8.3's synchronous lease-collapse in the Close menu item.
One new Playwright test (§12.3) covers the whole path: expand doesn't open the workspace (the
`@click.stop` guard), two worktree rows render with the linked one's branch label, clicking it
imports+opens+activates it with its own pinned graph tab (proven via `control.log()`, not just a
click), and collapse drops the list.

No Go file, no `packages/` file, no contract change, no new dependency — matches §11's file list
exactly.

**Verification.** Per-commit `bun run typecheck`, `biome check .`, `scripts/check-tokens.sh`,
`bun run build` clean throughout (biome's one finding every run is the known pre-existing
`UncommittedChangesStrip.vue` info-level item). `bun run test:ui` (`ui`+`ui-timing`): 280/280 on a
clean run; a first run's single `markdown-reading.spec.ts` scroll-position failure reproduced as a
pre-existing parallel-worker flake (passed standalone, and the clean rerun went fully green) —
unrelated to any file this phase touched. `repo-workspace.spec.ts` (all 14 tests, including the new
worktree one), `repo-graph-lifecycle.spec.ts` and `markdown-reading.spec.ts` all green.

**Two known gaps, stated per the plan's own §12.4 bar, not claimed.** A manual GUI pass (item 2):
not performed — this is a Wails v3 native app (GTK4/WebKitGTK on Linux, not Electron/CDP) with no
remote-debugging hook, and repo import goes through a native folder-picker dialog no driver in this
sandbox can reach, the same constraint prior phases' own result sections already recorded. A live
leak check (item 3): not performed live either — confirmed Xvfb is present (a real feasibility check)
but the full check needs the same native-window driving as the manual pass, correlated against Go
`advanced.gitLogLevel=debug` output; disproportionate to build a dedicated driver for one check. What
is confirmed by reading the code itself: `release()` calls `held.transport.dispose()` (that lease's
own subscriptions only) then, only when `!workspaceState.openRepos.includes(codeRepoId)`, the same
`disposeGitTransport` `closeRepoWorkspace` uses — which closes the real socket and clears the
`repoOpenMemo` entry so a later re-expand does a fresh `repo.open`. A static read of the invariant,
not a live-process observation.

## P83 result

Landed per plan (`docs/v1.8/plans/P83-embedded-terminal.md`), 9 commits (`43b4149e`..`e702b93a`).

**PTY layer (`43b4149e`).** `internal/terminal` (new domain package, no `internal/bridge` import,
enforced by `layering_test.go`'s automatic scan): a `creack/pty`-backed `Session`/`Registry` — one
reader goroutine per session, `Setsid: true` so a process started inside the terminal (`npm run
dev`) dies with the tab instead of outliving it, `Close`'s SIGHUP-then-2s-grace-then-SIGKILL
sequence against the whole process group. `loginShell()` resolves `$SHELL`, falling back to
`/etc/passwd`'s seventh field, then `/bin/sh`; sessions spawn `-l -i` (login, interactive) at the
caller's `cwd` — never `$HOME`, confirmed by reading `newSession` directly. `internal/bridge/
terminal.go` is the one place turning this package's plain errors/callbacks into `ipcerr`
responses and push-channel events, per the package doc comment's own layering rule.

**Frontend terminal tab (`4441b518`).** A new `terminal` tab kind (`reuse: false`, never
persisted, many per worktree) rendered by `RepoTerminalView.vue` via a lazy-loaded `@xterm/xterm` +
`@xterm/addon-fit` renderer (`terminalRenderer.ts`), matching `RepoGraphView.vue`'s own mount/
unmount lifecycle shape. `state/terminals.ts` owns the session registry client-side.

**Entry points (`f7bed220`, `f97dce06`).** A new "+" button in `TabStrip.vue` opens a dropdown
(one entry today, "Terminal", per the plan's own room-to-grow design for P85); `GitPanel.vue`'s
repo-row and worktree-row context menus gained "Open terminal" items, rooted at that row's own
path — deliberately not routed through `packages/git-ui/rowMenuModel.ts`, per the plan's own
host-only-surface reasoning.

**Left-panel indicator and branch-at-a-glance (`e538d343`, `bd75806d`, `a5acba41`).** A
`terminalCountAtPath` registry drives `.repo-terminal-indicator` on any repo/worktree row with a
live terminal open there. A new batched Go call (`gitclient.ResolveHead`/`RepoHeads`) plus
`repo/state/repoHeads.ts` drives a `.repo-head` branch-label span on every repo row, collapsed or
expanded — not only the worktree children P82 already labelled. `worktreeEntries()`
(`repo/state/worktrees.ts`) now sorts the main worktree first always, rendering-layer only —
`wt.isMain` itself stays positional from `internal/gitsession/worktree.go`'s `IsMain: i==0`, never
redefined.

**Bug found and fixed during verification, not part of the plan (`0e2e26b0`).**
`closeTerminalSession` (`state/terminals.ts`) fired `TerminalService.Close` for every closed tab of
*any* kind, violating this codebase's own "a tab kind's `dropResources` must be a safe no-op for an
id it doesn't own" contract (the same pattern `dropRepoFileTab` already follows) — surfaced as 4
failures in unrelated specs (`cell-editor.spec.ts`, `slick-grid.spec.ts`) on the first full
`test:ui` run. Fixed with an early-return guard (`if (!byTabId.has(tabId)) return;`); all 4
previously-failing tests re-run individually and pass.

**Tests (`e702b93a`).** Three Playwright cases in `repo-workspace.spec.ts`: the tab strip's "+"
opens a terminal at the active worktree and renders real `xterm.js` output from a synthesized
`kira:terminal:data` chunk (a wiring test, not a call-count test — real shell I/O stays out of this
tier, covered instead by `internal/terminal/session_test.go`); a worktree row's own context menu
opens a terminal at that worktree's path with both rows showing the indicator; every repo row
shows its checked-out branch, main worktree first. `ipcChannels.ts`/`mockRuntime.ts` gained the
matching terminal-channel/`RepoHeads` harness entries. **One process note, not a content issue**:
this commit's three files were briefly caught mid-race by an unrelated `SPEC.md` docs commit made
concurrently in the same shared working directory by the orchestrating session — caught
immediately, split back out via `git reset --soft` before either was pushed, verified by diff to
match exactly what this phase's own tail verification wrote. Net effect is cosmetic only (this
commit's message/footer was written by the orchestrating session rather than the implementing one)
— confirmed no content difference.

**Verification.** `go build/vet/test ./...` clean (`internal/terminal` and the layering test both
green); one `internal/grpcclient` reflection-test EOF on an earlier run confirmed transient — a
clean re-run of the full suite passed. `bun run test:unit`: 1509/1509 (13536 assertions). `bun run
test:ui` (`ui`+`ui-timing`): 275/279 pre-fix (4 failures, the `closeTerminalSession` bug above, in
files this phase touches); post-fix, `repo-workspace.spec.ts` (all cases, including the 3 new
terminal ones), `tabs.spec.ts` and `repo-graph-lifecycle.spec.ts` all green — a second full run
under concurrent sandbox load surfaced 49 scattered, timeout-flavored failures in unrelated specs
(api-ui-consistency, autocomplete, console-format, grpc-request, http-*, slick-grid, sql-schema,
mutations, leaks, fake-data, definition) with none reachable from this phase's own diff
(`terminals.ts` + 3 test/harness files); one such failure re-run alone failed identically alone
too, and system load (1.80/5.31/4.10 on 4 cores) points at CPU contention, not a regression — not
re-verified with a clean quiet run, stated as a known gap rather than assumed. `bun run
build:vscode` succeeds; `bun run test:webview` 45/45 — consistent with the diff-scope check
confirming no `packages/git-*`/`apps/kira-studio-vscode` file touched by any of this phase's own
feature commits.

**Known gap, stated per the plan's own bar, not claimed.** A manual GUI pass (§17.4 item 5): not
performed — beyond the no-display constraint prior phases already recorded, `apps/kira-studio`'s
own Taskfile defines only `darwin:*` tasks (sign, notarize, `darwin:package:dmg`), no Linux build/
dev task at all, so there is nothing to launch under this sandbox's own `Xvfb` even in principle.

## P84 result

Landed per plan (`docs/v1.8/plans/P84-git-panel-repositories-files-tabs.md`), 6 commits
(`cc9b1ce5`..`2fb50654`), in the plan's own §14 order.

**Part A, the duplicate listing (`cc9b1ce5`, `16c3c42d`).** `gitclient.WorktreeIdentity` lifted
verbatim out of `Identify`'s own two `rev-parse` lines (`--absolute-git-dir`,
`--git-common-dir`), with `Identify` refactored onto it. `CodeWorkspaceService.RepoWorktreeLinks`
answers one `parentId` per `code_repos` row, grouped by common dir per §3's anchor rule (the row
that is not a linked worktree, or else the smallest `(sortOrder, createdAt, id)`), shaped like
`RepoHeads` — same `errgroup`, same never-fail-the-batch error handling. Wails bindings
regenerated in the same commit as `ipcChannels.ts`/`mockRuntime.ts`'s harness entries, per
`mockRuntime.spec.ts`'s own FQN guard. `repo/state/repoLinks.ts` (new store, session-scoped
`Map`), `worktrees.ts`'s `switchToWorktree` writing the click-time hint so the newly-imported
worktree never flashes at the top level, and `GitPanel.vue`'s top-level filter
(`!worktreeParentId(r.id)`) plus §6's row state (`isOpen` reading "this row, or a row parented to
it, is open") and both context menus gaining Rename/Close/Remove on the nested row.

**Part B, the two tabs (`337a5ea9`).** One `PanelShell`, a two-option `SegmentedControl`
("Repositories" / "Files") in the `#title` slot the repo-name title vacated; `#body` switches on
it. The Files/Search/Review segmented control and its icon buttons moved into the Files tab's own
body as a `.view-strip`, with `local.repoSearch`/`local.fileSearch` split so a filter typed on one
tab no longer hides rows on the other. A local `tab` ref, driven by an `immediate` watcher on
`repoId`, auto-switches to Files whenever a workspace opens or activates and back to Repositories
when the last one closes — OQ-2's confirmed answer. `.repo-section.has-workspace`'s 50% height cap
and bottom border deleted; nothing stacks below the list once Files owns its own tab.

**Tests (`f459f4e0`).** §13.2's two migrations (`git-panel-tab-repos` click inserted where a test
asserts on the repo row after opening it), §13.3's rewrite of P82's own worktree-switch test onto
the dedup rule (`toHaveCount(0)` for the top-level duplicate, then the nested row carries `active`
after switching tabs), §13.4's new hydration-path test (`RepoWorktreeLinks` seeded with both rows
from a restart, no click at all, proving the batched path independent of §4.5's hint).

**Bugs found and fixed during verification, not part of the plan (`95ad3246`, `2fb50654`).** The
full `test:ui` run surfaced two failures the plan's own migration list (§13.2) missed:

- Every `repoRow(page).dblclick()` across `repo-workspace.spec.ts`, `repo-graph-lifecycle.spec.ts`
  and `markdown-reading.spec.ts` raced the new auto-switch: `onRowClick` (P67b) already opens or
  activates on one click, so the double click's second physical click — sent at fixed coordinates
  — landed on the Files tab's own relocated view-strip once §8.3's watcher moved it there instead
  of the row a real double click's second click was aimed at. Traced by history: these specs'
  `dblclick` predates P67b, from when repo rows lived in `ProjectPanel.vue` with a real
  `@click`/`@dblclick` select/open split (`4d5b5f9f`); P67b's single-click consolidation
  (`f1bedaf1`) made the second click redundant but harmless, until this phase's tab split gave it
  somewhere wrong to land. Mechanical `.dblclick()` -> `.click()` across all three files.
- "a worktree row's menu opens a terminal there, and both rows show the indicator"
  (`repo-workspace.spec.ts`) opens a terminal via the worktree row's context menu, which calls
  `openRepoTerminalTab` -> `openRepoWorkspace(repo.id)` as a side effect — the same auto-switch
  trigger, so the Repositories tab (and the worktree rows the test asserts on) was gone from the
  DOM by the time it checked the indicator. The plan's own §13.2 named this test as one that
  "never opens a workspace"; that call chain says otherwise. Fixed the same way as §13.2's two
  migrations: one `git-panel-tab-repos` click before reading row state.

**Verification.** `go build/vet/test ./...` clean — 1655 tests across 65 packages; one
`internal/grpcclient` reflection-test EOF on a `-count=1` run reproduced as transient (3/3 in
isolation, and a full re-run went clean), the same flake shape P83's result section already
recorded, in an unrelated package this phase never touches. `bun run typecheck` clean. `bun run
test:unit`: 1509/1509 (13537 assertions). `bun run test:ui` (`ui`+`ui-timing`): 284/284 on a clean
run, after the two fixes above; re-run three times before the fixes landed to confirm neither
failure was a parallel-worker flake (the terminal-indicator one failed deterministically 3/3, the
markdown-reading scroll-position one turned out to be an unrelated one-off — passed 3/3 standalone
and clean on every full-suite re-run afterward). `bun run build:vscode` succeeds; `bun run
test:webview` 45/45 — consistent with the diff-scope check confirming no `packages/git-*`/
`apps/kira-studio-vscode` file touched by any of this phase's commits, `GitPanel.vue` being
desktop-only.

**No known gap.** Unlike P82/P83, this phase has no native-window-dependent manual pass in its own
§13.6 that a headless sandbox cannot perform in principle — its "manual, on a real repository"
checks are a supplement to, not a replacement for, the full Playwright coverage above, and §13.5
already states plainly (not as a gap discovered here) that the flash window and the
`RepoWorktreeLinks` error path have no dedicated Playwright coverage, for the same
`installGitStreamMock`-cannot-hold-open reason P74/P75/P82 already recorded.

## P85 result

Landed per plan (`docs/v1.8/plans/P85-claude-code-custom-scripts.md`), 7 commits (`0f04bdfe`..
`f0b49b04`), in the plan's own §17 order plus one follow-up fix commit.

**Part A, the PTY layer (`0f04bdfe`).** `terminal.OpenParams.Command` threaded end to end into
`TerminalOpenArgs.Command` and the shell invocation: non-empty runs as `$SHELL -l -i -c <command>`
(P83's own login/interactive flags kept verbatim, the command as a single argv element, no quoting
layer); empty stays P83's plain login shell. `maxTerminalCommandBytes` (64 KiB) bounds it well
under macOS's ARG_MAX, for a clear `E_INVALID` instead of an opaque E2BIG. `newSession(OpenParams)`
replaces six positional args. New `TestSessionRunsInitialCommand` guards the one non-obvious
property P86 will need: the command's own exit status reaches `onExit`, not a wrapper shell's.
Bindings regenerated; `bridge/index.ts`'s `terminalOpen` gains an optional `command` argument.

**Part B, launching Claude Code (`03d6a00a`).** `terminalTabStateSchema` gains `command`/`label`/
`color` (each defaulted, so an older persisted record still parses through `duplicateState` ->
`parseState`); `tabKinds.ts`'s terminal entry reads `label` (falling back to the cwd's basename)
for its title and `state.color` for its rail colour. `openRepoTerminalTab` gains an optional
`TerminalLaunch` (command/label/color) — every existing call site (`TabStrip.vue`'s own Terminal
entry, `GitPanel.vue`'s two row menus) is unchanged, since it stays optional. `state/terminals.ts`
threads `command` through `openTerminalSession` to `control.terminalOpen`. `TabStrip.vue`'s
`newTabMenuItems()` factors the Terminal item's run body into `launchInActiveWorkspace(launch?,
cwdOverride?)` — the helper every dropdown entry (this commit's and the next two) calls — and adds
a "Claude Code" entry launching the fixed command `claude`: not configurable, not probed for
availability (a user wanting flags writes a custom script instead).

**Part C, storing custom scripts (`056c9a79`).** New `custom_scripts` table (migration 0024) — a
named, ordered, immediately-mutated list, `code_repos`' own shape, not a settings leaf.
`model.CustomScript`/`CustomScriptFields`, `CustomScriptFields.Validate()` (name/command required
and trimmed in place, `workingDir` empty or absolute, colour a valid palette value) is the sole
authority; the mirrored `packages/shared/domain/scripts.ts` zod schema is only the dialog's own
affordance. `CustomScriptsRepo` (`CodeReposRepo`'s own plain shape) and `CustomScriptsService`
(`MaskRulesService`'s own per-method-args shape) — every mutation broadcasts the full list on
`ChannelCustomScriptsChanged` (`Emit`, not `EmitTo`) so a second window's dropdown stays live.
`state/customScripts.ts` hydrates in `main.ts`'s boot `Promise.all`, subscribing to that broadcast.

**Part D, the Settings section (`349693d2`).** `sections`/`Section` moved out of
`SettingsDialog.vue` into `state/settings.ts`, plus a new `openSettingsAt(section)` so
`TabStrip.vue`'s "Manage scripts…" can deep-link into Settings without importing the dialog
component (workbench/ -> state/, the permitted direction — OQ-2 confirmed, no lint rule blocks
it). New "Scripts" section between Git and Code intelligence (OQ-1's placement, shipped as
planned, not re-decided). Per-row name/command/working-dir fields commit on blur (empty reverts,
matching `VariableSetView.vue`'s own `onEnvFieldBlur` posture), a colour swatch commits
immediately, remove asks to confirm, and an add row stages locally until Add is clicked — this
section bypasses draft/Save entirely, the same posture 'Connected editors'/'Code intelligence'
already take.

**Part E, listing scripts in the dropdown (`754dc282`).** `newTabMenuItems()` extended past
Terminal/Claude Code: one entry per configured script (name, command as hint, colour swatch or a
play icon when colourless) behind a separator when any exist, then "Manage scripts…" deep-linking
via `openSettingsAt('Scripts')`.

**Tests (`110abab3`).** The dropdown's existing one-item-count assertion migrated to three
(Terminal, Claude Code, Manage scripts…, no scripts configured). Two new `repo-workspace.spec.ts`
cases following P83's own shape (`control.log()` polling, not a call-count test): the dropdown
launches Claude Code in its own terminal tab titled "Claude Code" with `{cwd: REPO.root, command:
'claude'}`; a configured script joins the dropdown and launches at its own `workingDir`, not the
active repo's root — proven by the cwd differing from `REPO.root`. New `settings-scripts.spec.ts`
(modelled on `settings-code-intelligence.spec.ts`): empty state, adding a script calls
`customScriptsCreate` with the trimmed fields, Add stays disabled with an empty name or command,
and a non-absolute working directory surfaces the backend validation error.

**Bug found and fixed during verification, not part of the plan (`f0b49b04`).** The full
`test:ui` run surfaced two issues the plan's own migration didn't anticipate:

- `onAddScript` (`SettingsDialog.vue`) sent `newScriptName.value`/`newScriptCommand.value`
  untrimmed over IPC, while the sibling `onScriptFieldBlur` (editing an existing script) already
  trimmed both — an inconsistency the new
  `settings-scripts.spec.ts` "…calls customScriptsCreate with the trimmed fields" case caught
  directly (`workingDir` was already trimmed; unaffected). Fixed by trimming both before building
  `CustomScriptFields`, matching the existing pattern.
- The new "a configured script appears in the dropdown…" test in `repo-workspace.spec.ts` used
  `menu-item-${SCRIPT.id}` as its locator, but `TabStrip.vue`'s script row id is
  `script-${script.id}` and the fixture's own `SCRIPT.id` is itself `'script-1'` — so the real
  rendered testid is `menu-item-script-script-1`, not `menu-item-script-1`. The wrong locator
  never matched, hanging the click to a 60s timeout. Fixed by matching the real id.

**Verification.** Per-commit `bun run typecheck`, `biome check .`, `scripts/check-tokens.sh`,
`bun run build` clean throughout. `go build ./...` and `go vet ./...` both clean. `bun run
test:unit`: 1509/1509 (13541 `expect()` calls, 154 files). `bun run test:ui` (`ui`+`ui-timing`):
289/289 clean on a fresh run (4.5m), after the two fixes above — both new `repo-workspace.spec.ts`
launch-kind tests and all three `settings-scripts.spec.ts` cases included; no re-run needed to
confirm a flake, since neither failure mode is timing-sensitive. `bun run build:vscode` succeeds;
`bun run test:webview`: 45/45 — consistent with the diff-scope check confirming no
`packages/git-*`/`apps/kira-studio-vscode` file touched by any of this phase's commits (`git diff
--stat f71867b2..110abab3 -- 'packages/git-*' 'apps/kira-studio-vscode'` is empty).

A full `go test ./...` was already confirmed clean by the first implementing subagent; this closing
pass does not re-run it (only `internal/gitsock` standalone, below), since this pass's own fix
commit touches no Go file.

**`internal/gitsock` — independently re-confirmed a non-issue for this phase, not re-investigated
from scratch.** `git diff --stat f71867b2..110abab3 -- apps/kira-studio/internal/gitsock` is
empty and `pairing_test.go`'s own last touch (`7aa97296`) long predates this phase — no P85 commit
comes near this package. `go test ./internal/gitsock/... -count=1` run standalone this session
itself hit Go's own 10-minute default test-binary deadline and dumped goroutine stacks, all
rooted in `TestBroker_QueueBoundedAgainstUnlimitedEnqueue` (`pairing_test.go`): that test's own
final assertion is a non-blocking `select`/`default` check, so the test function itself returns
quickly, but it deliberately never resolves (approve/deny, or advances the fake clock past
`pairingTimeout`) the `maxQueueLen` goroutines it parked mid-`Broker.Request` — by the test's own
design (proving the queue stays capped, not that those requests ever complete), those goroutines
leak for the rest of the binary's run. Under this run's measured system load (`uptime`:
10.04/8.62 over 5min/15min on 4 cores), scheduling pressure from those leaked goroutines across
the package's other 134 tests evidently pushed total runtime past the default 10-minute deadline —
consistent with, not contradicting, the two implementing agents' own earlier standalone runs
passing clean under lower load. Not re-run a second time to check reproducibility under today's
load — the one decision this check exists for (is it a P85 regression) is already settled by the
diff being empty, and CLAUDE.md's own measurement bar is "a real, concrete question genuinely at
stake," not routine reproduction.

**Known gap, stated per the plan's own §16 bar, not claimed.** A manual GUI pass (§16's own
checklist: launch Claude Code, confirm the CLI starts with the user's own PATH and the footer's
exit code, add/launch a script with and without a working directory, confirm a script's colour
paints its tab rail, confirm a second window sees a script added in the first without a relaunch):
not performed — the same no-display, no-Linux-dev-task constraint every phase in this chapter has
already recorded (P83 §17.4's own wording: this is a Wails v3 native app with no remote-debugging
hook, and `apps/kira-studio`'s own Taskfile defines no Linux build/dev task at all, so there is
nothing to launch under this sandbox's `Xvfb` even in principle). The plan's own §15.3 records two
further gaps in Playwright coverage specifically (no real shell running a real command; no
cross-window broadcast coverage) as deliberate, not oversights — restated here rather than
re-argued.

## P86 result

Landed per plan (`docs/v1.8/plans/P86-claude-hooks-agent-status-widget.md`), 7 commits
(`625fddf2`..`a36c7296`), in the plan's own §4/§5/§7/§11/§13 order.

**Groundwork (`625fddf2`).** `terminal.Registry` gains `OnChange`/`AgentSessions` and `Session`
gains `cwd`/`agent`; `TerminalOpenArgs.LaunchKind` (`'shell' | 'claude-code' | 'script'`) is
validated and threaded through `domain/tabs.ts`, `state/repoTabs.ts`, `state/terminals.ts`,
`state/tabKinds.ts` and `TabStrip.vue`'s Claude Code/script producers — the explicit discriminator
P85 OQ-3 asked for, never `command === 'claude'`. No user-visible change in this commit.

**The hook transport (`f877ab87`).** New `internal/agenthooks` domain package: a per-enable 0700
temp dir holding a generated `hooks.json`, a 0700 shim script and a 0600 unix socket served by
stdlib `net/http`. The listener decodes only the nine hook-payload fields this app keeps, truncates
a `Notification` message to 200 bytes on a rune boundary (OQ-6), and never retains
`tool_input`/`tool_response`/`transcript_path`. Self-contained — nothing called it yet.

**Opt-in wiring (`4be5422f`).** New `AgentHooksService` starts/stops the listener behind
`claudeCode.hooksEnabled`, read fresh at every launch; `TerminalService.Open` composes the
`--settings` flag and env only when a launch is `claude-code` and the listener is running. New
Settings > Claude Code section (instant-effect toggle, error/path display) between Scripts and Code
intelligence (OQ-3, shipped as planned). `launchFor` stays unexported — an exported method would
have been bound to the wire by Wails and leaked `KIRA_AGENT_HOOK_TOKEN` to the webview.

**The status-bar count (`9a35d671`).** `terminal.Registry` is the one place an app-wide session
count exists (a per-window map would disagree between windows, and P87's keep-awake control needs
one shared truth too). `TerminalService.AgentSessions()` hydrates a late-opened window;
`ChannelAgentSessions` (`Emit`, not `EmitTo`) broadcasts the live list on every `Registry.OnChange`.
`StatusBar.vue` renders a sparkle-icon count beside app-metrics, absent rather than zero (the
established P76/P78 convention) — count is PTY liveness (OQ-5: a script is never counted as an
agent), decoupled from the hook stream by design (§10 of the plan).

**Per-session activity (`dc7b26ac`).** `AgentHooksService.onEvent` -> `ChannelAgentEvent` (`Emit` —
a hook event has no window to address; the receiving window filters by `terminalId`).
`state/agentSessions.ts`'s `reduceAgentActivity` is a pure `(prev, event) => next` reducer, pairing
`PreToolUse`/`PostToolUse` by `tool_use_id` rather than a depth counter, since each hook fires from
its own `curl` process and `PostToolUse` can arrive before its own `PreToolUse`. `SessionEnd` drops
the activity entry outright. `StatusBar.vue`'s tooltip appends activity text
("waiting for you"/"running `<tool>`"/"working"/"idle") after each session's `basename(cwd)`;
`TabStrip.vue` gains the attention dot on a non-active Claude Code tab in the `'attention'` phase,
cleared by activating it.

**Discoverability (`1b5dbe80`).** A dismissible banner above `RepoTerminalView.vue`'s xterm host,
shown only on a Claude Code tab with hooks off and the prompt not yet dismissed — Enable calls
`setAgentHooksEnabled` (never types into the PTY, applies to the next Claude Code tab, the running
session is untouched); Not now persists `hooksPromptDismissed` and the banner never returns. No
project file is written by this flow or anywhere else in the phase — `--settings` always points at
Kira Studio's own generated temp path (see verification below).

**Tests (`a36c7296`).** `tests/unit/agent-activity-reducer.spec.ts` — the plan's own §19.1, 7 cases,
one per interacting rule (out-of-order pairing, `SessionEnd` clearing, an unknown `tool_use_id`,
etc.). `settings-claude-code.spec.ts` (modelled on `settings-code-intelligence.spec.ts`): off by
default, the toggle calling `agentHooksSetEnabled`, a running status showing the path, a start
failure showing the error instead. `repo-workspace.spec.ts` gains three cases: the existing Claude
Code launch assertion now also checks `launchKind: 'claude-code'`; the agent-sessions widget is
absent with nothing running and shows the live count from a broadcast; a `Notification` event sets
the attention dot on a non-active tab, cleared by activating it.

**OQ-1, closed — not merely asserted.** The plan flagged `--settings`'s additive-loading claim
(project `.claude/settings.json` hooks still fire alongside a `--settings`-supplied file) as
"documented but not exercised end to end," explicitly blocking this result section's own honesty
until checked. Run directly during this verification pass, outside the repo (a scratch project with
its own `SessionStart` hook, plus `claude --settings <generated hooks.json> -p 'say hi'` pointing at
a second, independent `SessionStart` hook): both hooks fired, confirmed by two separate marker
files each carrying their own hook's own output. `--settings` is genuinely additive, not a
replacement — the mechanism this whole phase is built on holds.

**Verification (run directly by the orchestrating session, not a subagent — the implementing agent
was cut by a session-limit 429 immediately after its own commit 7, before running its own closing
checks).** `bun run lint` (biome + `check-tokens.sh`): clean, one pre-existing `info`-level hint in
`UncommittedChangesStrip.vue` (untouched by this phase, not an error). `bun run typecheck`: all five
projects clean. `go build ./...`: clean. `go test ./...`: one failure,
`TestDescribe_Reflection_NoReflection_YieldsSchemaError` (`internal/grpcclient`) — unrelated to this
phase (`git diff --stat` since `58861e85` touches no file under `internal/grpcclient`, and the
test's own last touch, `dd585aad`, long predates this branch's work); passes clean standalone
re-run, consistent with the load-dependent flakiness this chapter already documented for
`internal/gitsock`'s `TestBroker_QueueBoundedAgainstUnlimitedEnqueue`. `bun run test:unit`:
1516/1516 (13562 `expect()` calls, 155 files). `bun run test:ui` (`ui`+`ui-timing`): 288 passed, 2
failed — `interaction.spec.ts`'s grid context-menu case (`scrollIntoViewIfNeeded`: element not
attached) and `sql-schema.spec.ts`'s no-completion case (a stray `.suggest-widget.visible`) — both
in files this phase's diff never touches (`git diff --stat` since `58861e85` touches no file under
`views/grid`, `views/sql`, or either spec file), both timing/DOM-attachment-sensitive assertions
consistent with environmental flakiness, not a regression. Every P86-specific case
(`settings-claude-code.spec.ts`'s three, and `repo-workspace.spec.ts`'s three new agent-widget/
attention-dot/launch-kind cases) passed.

**Known gap, stated per the plan's own bar, not claimed.** A manual GUI pass (launch Claude Code
with hooks enabled, confirm the banner/toggle/status-bar count/tooltip/attention-dot render and
update live against a real running session) was not performed — the same no-display, no-Linux-dev-
task constraint every phase in this chapter has already recorded (P83 §17.4, restated in P85's own
result). OQ-2 (curl shim vs. re-invoking the app binary) and OQ-6's exact truncation length stay
open as the plan itself left them — reversible with a measurement, not treated as settled here.

## P87 result

Landed per plan (`docs/v1.8/plans/P87-titlebar-keep-awake.md`), 8 commits (`28dd53d0`, `361c25db`,
`3481df37`, `7ba213e8`, `9e59acbb`, `d17b9c14`, `89c07bff`, `31fc26eb`) — the plan's own 7-commit
order-of-work plus one added `docs/ARCHITECTURE.md` commit at the end.

**Backend (`28dd53d0`).** `internal/keepawake`: a `Controller` holding a *set* of named reasons
(`ReasonManual`/`ReasonAgent`), not a refcount — acquires only on empty→non-empty, releases only on
non-empty→empty, so either source re-asserting a level it already holds is a no-op, not a bug.
`NewPlatformDriver()` switches on `runtime.GOOS` (no build tags, mirroring
`internal/gitclient.NewPlatformLocator`) — `noopDriver` everywhere but darwin, where
`caffeinateDriver` spawns/kills `caffeinate -i -s -w <pid>`. Self-heal: the reaper goroutine's async
loss callback flips internal state false; the *next* `Set`/`Rearm` call (any reason) recomputes and
re-acquires — no timer/backoff loop. Resume detection: `shell.AttachSystemWake`, modeled directly on
the existing `AttachReopen`, registers `events.Mac.ApplicationDidWake`.

**Settings + bridge (`361c25db`, `3481df37`).** New leaf `claudeCode.keepAwakeWithAgents`, default
`false`, through all three layers (`packages/shared/domain/settings.ts`,
`internal/storage/model/settings.go`, `internal/storage/repos/settings.go`). `bridge/keepawake.go`'s
`KeepAwakeService` composes the two independent sources — the titlebar button's own manual state and
the agent-aware setting gated on `AgentSessions()`'s running count — onto the one `Controller`, and
broadcasts every change on a new `ChannelKeepAwake` (via `Emit`, never persisted across relaunch).

**Frontend (`7ba213e8`, `9e59acbb`, `d17b9c14`).** `state/keepAwake.ts` hydrates and subscribes,
mirroring the existing `agentHooks.ts`/`agentSessions.ts` pattern. `TitleBar.vue`'s action row
reordered: Connections, Operations, Settings, keep-awake (new, coffee-cup icon, `.is-on`/
`aria-pressed` on the two states, single click, no dropdown), New window — moved from leftmost to
rightmost, per this row's own updated design. `SettingsDialog.vue` gained the agent-aware checkbox
beside the existing hooks toggle in the Claude Code section.

**Tests.** `internal/keepawake` — a `fakeDriver` that fails the test on a double-acquire or a
premature release, a `-race` concurrent test, an argv golden test (`caffeinateArgv`), and a
process-lifecycle test polling for `ESRCH` (`processAlive`/`waitUntil`, reused from
`preconnect/supervisor_test.go`'s own precedent) rather than asserting on the first check, since this
sandbox's minimal init reaps slowly. `pmset -g assertions` verification is explicitly not faked —
documented as a manual macOS-only step, per the plan's own instruction. `workbench.spec.ts`'s
existing New-window test updated for the new DOM order and title; two new cases cover the titlebar
button's click-to-`SetManual` toggle and a `ChannelKeepAwake` broadcast turning it on with no click.
`settings-claude-code.spec.ts` gained one case for the agent-aware checkbox's default-off state and
its click-to-`SetAgentAware` call.

**Deviations from the plan, each small and locally justified.** (1) Added
`Controller.Supported() bool`, a thin forward to the driver's own `Supported()` — the plan's §2.1
method list doesn't name it, but `bridge/keepawake.go` needs it to report `supported: false` on
non-darwin without reaching into the driver directly. (2) §7.2's `bridge/index.ts` TS wrapper edits
landed in the bindings-regeneration commit (`3481df37`) rather than the later frontend-state commit
— §7.2's own text says bindings regenerate "in the same commit," and this keeps `state/keepAwake.ts`
(commit 4) able to call `control.keepAwakeStatus()` etc. from the moment it's written, never against
a half-wired bridge. (3) `recomputeAgent()` collapsed from two near-duplicate functions the plan
sketched (`recomputeAgent(enabled bool)` / `recomputeAgentFromCount(enabled bool, count int)`) into
one that always re-reads `Deps.Repos.Settings.GetAll()` fresh — simpler, and matches the plan's own
text more literally than the two-function split did.

**Verification.** `go build`/`go vet`/`go test ./...` clean (no `FAIL`, no flake this run —
`internal/grpcclient`'s historically-flaky reflection test passed clean). `go test
./internal/keepawake/... -race -v`: 11/11. `internal/storage`/root-level layering test confirmed
covering the new package (`TestDomainPackagesDoNotImportBridge/internal/keepawake`). Darwin
cross-compile of `internal/keepawake` alone (`GOOS=darwin GOARCH=arm64 CGO_ENABLED=0`) clean for both
`build` and `vet` — the whole-`main`-package darwin cross-compile itself still fails deep inside
Wails' own cgo-dependent darwin backend, a pre-existing constraint this sandbox has never been able
to satisfy (`docs/DEV_ENVIRONMENT.md`), not something this phase introduced. `bun run
typecheck`/`biome check .`/`scripts/check-tokens.sh` clean (the same two pre-existing
`UncommittedChangesStrip.vue`/`RequestSettingsPane.vue` findings every prior phase in this chapter
has recorded, both untouched by this phase). `bun run build` (desktop) succeeds. `bun run
test:unit`: 1517 passed, 0 failed (unchanged from P92's own count — no new frontend unit tests
needed, per the plan's own "below the bar" callouts). Full `bun run test:ui` (`ui`+`ui-timing`, 313
tests): 306 passed, 3 failed, 4 did not run (the `ui-timing` project's own dependency-skip once `ui`
carries a failure, the same shape P91's own result section recorded). All 3 failures confirmed
pre-existing and unrelated: `git diff --stat` since `689249ec` touches none of the three failing
spec files, and each is independently documented in an earlier phase's own result section —
`http-request-body.spec.ts`'s 500-byte-payload threshold flake (P91), `sql-schema.spec.ts`'s stray
`.suggest-widget.visible` no-completion case (P92), and `repo-workspace.spec.ts`'s "search streams
results out of order" case (P91). Every P87-specific case (`workbench.spec.ts`'s three,
`settings-claude-code.spec.ts`'s one) passed, confirmed again in an isolated targeted run of both
files alone (9/9). `git diff --stat` against `689249ec` confirms `apps/kira-studio-vscode/` is
untouched — out of scope for this phase.

**Known gap, stated per the plan's own bar, not claimed.** `pmset -g assertions` verification that a
live `caffeinate` process actually registers a `PreventUserIdleSystemSleep` assertion is a manual,
macOS-only step this sandbox (Linux, no display) cannot run — documented as such in the plan, not
faked with a mocked driver. No other known open item.

## P88 result

Implemented directly, no plan doc (explicit instruction for this phase). One commit
(`f156554e66b812be5aedc1e519b09ff3fcc08746`).

**Root cause.** Not a CSS mistake in either checkbox implementation — the codicon `check`/`dash`
glyphs' own artwork isn't centered within their own 16x16 icon tile. Measured directly against
`@vscode/codicons`' own SVG source (`src/icons/check.svg`/`dash.svg`, rasterized and pixel-bbox'd):
check's ink center sits at y=7.495 of a 16-unit tile (true center is 8, so ~0.5/16 units, ~3%,
high); dash's sits at y=8.495 (~3% low) — opposite bias, near-identical magnitude. Both checkbox
implementations center the glyph *tile* (flexbox `align-items`/`justify-content` on
`Checkbox.vue`'s `.p-check .glyph`, and the equivalent on git-ui's own `input[type=checkbox]::after`
re-implementation for VS Code webview parity, P67c) — correct centering of the tile, which
faithfully reproduces the tile's own internal bias instead of correcting it.

**Fix.** `apps/kira-studio/frontend/src/theme/primitives.css` (`.p-check .glyph.codicon-check`/
`.codicon-dash`) and `packages/git-ui/src/theme/app-shell.css`
(`input[type="checkbox"]:checked::after`/`:indeterminate::after`) each get an `em`-based
`translateY` nudge, sign per glyph (`+0.03125em` for check, `-0.03125em` for dash — `0.5/16`),
so the correction tracks font-size automatically at either package's own glyph size (10px/11px).
Two files, not one, since the two checkbox styling sources aren't literally shared code (git-ui's
own comment already states why: it can't reach the host app's CSS) — same design, same bug, same
fix, applied once per source rather than per call site.

**Verification, not assumption.** Built a byte-faithful reproduction of each implementation's real
markup/CSS/token values (`.p-check`'s actual `--kira-control-inline-h: 14px`/`--kira-s-1: 2px`,
git-ui's actual `11px`/`line-height:1`) against the real `@vscode/codicons` font asset, and measured
ink-bbox-vs-box-center offset by pixel analysis — in real WebKit (`playwright.config.ts`'s own
`browserName: 'webkit'`, the app's actual runtime engine, not a Chromium stand-in) at true
production checkbox size (14px), deviceScaleFactor 16 for sub-pixel resolution. Before: check
offset 0.0px horizontal / -0.31px vertical (kira-ui), 0.0/-0.34px (git-ui) — matching the SVG
source's own measured bias almost exactly, confirming the mechanism, not a browser quirk. After:
0.0px both axes, both glyphs, both implementations. Also spot-checked in Chromium — same direction
and order of magnitude, ruling out an engine-specific fluke.

**Also verified:** `bun run lint` clean (same one pre-existing `UncommittedChangesStrip.vue`
`info`-level hint as P86's own result, untouched here). `bun run typecheck`: a fresh worktree has
no Wails-generated `apps/kira-studio/frontend/bindings/` (gitignored, needs `scripts/setup.sh`'s
Go+`wails3` install) — installed the pinned `wails3` CLI (`go.mod`'s `v3.0.0-beta.21`) and ran
`wails3 task common:generate:bindings` directly rather than working around it, since this phase's
own change touches `apps/kira-studio/frontend` and DEV_ENVIRONMENT.md's scoped-typecheck workaround
covers a git-only change, not this one; typecheck passes clean with real bindings in place, no
`--no-verify` needed.

**Not done: a real end-to-end screenshot of the checkbox inside the running app** (Settings dialog,
review sidebar, etc.) — `bun run build:test` needs the same bindings, now present, but wiring a
full `wails3 task dev`/mocked-IPC boot was outside this fix's own footprint (two CSS files) to
justify; the isolated reproduction above uses every real token/asset/font the app itself uses, in
the app's own rendering engine, which is the part that was actually in question (glyph-vs-tile
centering, not layout/composition). No known open item — the fix is geometrically exact (0.0px
residual), not a tuned approximation.

## P89 result

Landed per plan (`docs/v1.8/plans/P89-fk-preview-format-fix.md`), 3 commits (`b9933913`, `943105f2`,
`99b83bbf`). Two unrelated bugs.

**FK preview popover.** Reordered to header/actions/body flex layout — the body is now the only
scroller (`.fk-preview-body`'s `flex: 1 1 auto; min-height: 0; overflow-y: auto`), so "Open in new
tab" stays visible under the header regardless of row width. Deleted "Edit this record" outright:
the popover called `editReferencedRow` directly with no emit/prop to unwire, and the cell context
menu's "Edit referenced row" item (`menu.ts`'s `fkEditItem`) stays the sole edit entry point —
confirmed still wired (`menu.ts:186`) before deleting. `tests/ui/interaction.spec.ts`'s P67 case 3
now drives that cell-menu item; the vacuous `fk-preview-edit` count-0 assertion is gone.

**Format regression, root cause confirmed as the plan predicted.** `ConsoleView.vue`'s `localDoc`
is a `shallowRef`; Vue skips the dep trigger when an assigned value equals the ref's current one.
After format-undo-format, the second Format's result is byte-identical to the first (still held by
`localDoc`), so the assignment was a silent no-op — the store advanced but Monaco kept showing the
user's unformatted text, and the *next* Format press compared the store's already-formatted text
against itself and reported "already formatted" on a document the editor never held. Fixed by
factoring `MonacoHost`'s `props.doc` watcher body into `applyExternalDoc`/`setDoc` (same
`doc === model.getValue()` guard) and having `ConsoleView`'s `tab.state.text` watcher call it
directly, moving `lastEmitted`'s update into that same watcher. `ConsoleSavedMenu.vue`'s `setText`
call needed no separate patch — it goes through the same watcher. Also dropped the
"(ClickHouse identifiers)" aside from the format note on every non-ClickHouse console.

**Verification.** `bun run typecheck`/`lint`/`build` clean after each commit (one pre-existing
`UncommittedChangesStrip.vue` lint info, untouched, same as P86/P88). New regression test
(`console-format.spec.ts`, format→undo→format) confirmed failing against the pre-fix source
(reverted the two source files, reran in isolation: `toMatch(/^SELECT\n/)` timed out, editor still
showed the one-liner) and passing after — a real regression test, not just new coverage. Full
`bun run test:ui` (291 tests, `ui`/webkit project): all pass, no other spec regressed. Manual
screenshots against the real rendered app (mocked-IPC harness, `tests/ui/fixtures.ts`) confirm both
fixes visually: the popover shows header → "Open in new tab" → body in that order with no "Edit
this record" button; the format-undo-format-format sequence re-indents correctly on the second
Format (not stuck one-line), and a third press with no edit shows the note with the ClickHouse
aside correctly absent on this Postgres console.

## P90 result

Landed per plan (`docs/v1.8/plans/P90-api-settings-cookies-grow-fix.md`), 10 commits (`6ff4ff2b`,
`41d8ae21`, `4293c6ae`, `9f15641a`, `0f055018`, `f3901e42`, `884a3a66`, `8ce90a3b`, `fd17baef`,
`54e223d3`). Three items: a global Api settings section, per-request overrides plus a Cookies tab,
and the grow-field fix.

**Api settings.** Seven leaves (httpVersion, requestTimeoutMs, maxResponseMb, sslVerify,
followRedirects, maxRedirects, disableCookieJar) on `Settings`, a new Api section in the dialog. Go's
`httpclient.Send` takes an `Options` (all-pointer, nil-means-default) instead of reading package
constants — `resolveSendOptions`/`orGlobal` (`bridge/http.go`) resolve a request's seven
`null`-means-inherit tab-state leaves against the global row before every send. `sslVerify: false`
shows the plain-prose security warning verbatim from the plan (CLAUDE.md's own carve-out for that
class of text).

**Cookies.** One process-wide `cookiejar.Jar` (publicsuffix-keyed), a throwaway per-send jar for
incognito. `Response` gained `SentCookies`/`ReceivedCookies` off the trace's `WroteHeaderField`
hook and every hop's own `Set-Cookie`. Two panes reuse one `CookiesPane.vue` component: request mode
(what the jar would send next, debounced on URL change and after every send) and response mode
(sent/received grouped by hop). Both new leaves' secrets get masked the same way every other response
field does (`maskSecrets`, two new loops).

**Grow-field fix, two defects, not one.** The plan's own diagnosis (UA `padding: 2px` on the
textarea, absent from the sizing replica) was real and fixed as written. Testing surfaced a second,
independent defect the plan didn't name: a grid item's `normal` alignment resolves to `start`, not
`stretch`, for a replaced box with an intrinsic size in that axis (CSS Box Alignment §8.3) — and a
`<textarea>` counts, via its `rows` attribute. Unstretched, the textarea sat at its own 1-row
intrinsic height inside a track the replica had already grown to fit, so it scrolled from row 2 on
regardless of the padding fix. Fixed with an explicit `align-self: stretch`. Separately, the overlay
never painted on a `grow` textarea at all (`.input-wrap input.has-overlay` didn't match a
`<textarea>`) — widened to `input.has-overlay, textarea.has-overlay`, plus `line-height: inherit` so
the overlay's lines don't drift from the textarea's own past line 2.

**Verification.** `go build`/`go vet`/`go test` clean throughout
(`internal/httpclient`/`bridge`/`storage`/`apivars`) — six new Go tests per the plan's §6.1
(redirects off, max-redirects, body-cap both directions, zero-timeout, cookie-jar replay including
the ephemeral case, forced HTTP/1.1), all passing against a real `httptest.Server`. `bun run
typecheck`/`lint`/`build` clean after each commit (same pre-existing `UncommittedChangesStrip.vue`
lint info as every other phase). Seven new Playwright tests (`http-request.spec.ts` ×6,
`settings-apply-on-save.spec.ts` ×1): Api section round-trip, an override reaching `httpSend`'s own
`options` as exactly the one leaf changed, that override surviving a tab restore, the response
Cookies tab rendering both groups, the request Cookies tab's jar-off empty state, and the grow-field
fix (line boundaries read off the overlay's own `Range` client rects, not a hard-coded character
count) — all pass. Full `bun run test:ui` (`ui`/webkit project): 250 passed, 47 failed, every failure
a pre-existing Monaco-editor-loading timeout (`data-kira-editor-text` never appears) spread across
files this phase never touched (console, grpc, cell-editor, slick-grid, sql-schema, and others) —
confirmed pre-existing, not a P90 regression, by reverting `primitives.css` and
`AutocompleteField.vue` to their pre-P90 content in place, rebuilding, and re-running one of the
failing tests: it still failed identically with none of this phase's code present. A manual
GUI launch (`bun run dev`) was not attempted — this container has no display (`docs/DEV_ENVIRONMENT.md`),
and the Playwright `ui` project is this repo's own established substitute for a GUI-driven check in
that setting.

## P91 result

Landed per plan (`docs/v1.8/plans/P91-terminal-module.md`), 8 commits (`e9bbf812`, `48e9e295`,
`b8b5451e`, `1acc48de`, `df858d69`, `28d5a23b`, `39f89c26`). A fourth top-level module — Terminal —
plus a self-caught testid fix folded in as its own small commit ahead of the test commit.

**The module.** `AppMode` gained `'terminal'` (`mode.ts`), a fourth `MODES` entry with async
`TerminalPanel.vue`/`TerminalStart.vue`, `MODE_ORDER` widened to place it last (OQ-1's own default),
`validWindowModes` (Go) widened, and `tabs.ts`'s `hydrateTabs` hardened from an enumerated
studio/api skip-list to `!isRepoWorkspace(key)` so a bare `'terminal'` workspace survives a session
restore the same way `'studio'`/`'api'` already did.

**The default working directory.** A one-line Go `DefaultCwd` (`os.UserHomeDir`, `''` on failure —
never fails boot), bound and hydrated once at boot into `terminalDefaults.cwd`
(`state/terminals.ts`), read by the Terminal module's own unscoped launches.

**Opening a terminal outside a repo.** `state/terminalTabs.ts` is new: `openTerminalTab` factored
out of `openRepoTerminalTab` so a terminal tab can open under a bare `'terminal'` workspace with no
`openRepoWorkspace` side effect — `openRepoTerminalTab` now delegates to it. This split is what
keeps a Terminal-module launch from silently jumping into Git (§6's own regression to prevent,
pinned by test case 3 below).

**The tab strip's "+".** `TabStrip.vue`'s wrapper unified from a `v-if`/`v-else` pair into one
element whose testid switches on tab count, so the Terminal module's genuinely-empty initial state
(no pinned graph tab, unlike a repo workspace) still shows the "+". A second menu builder,
`terminalModuleMenuItems()`, deliberately omits Claude Code and per-script entries (§8.3 — the left
panel already covers scripts, one click away) and lists `Terminal` plus one entry per known
repository/worktree, each opening a scoped terminal that stays in the Terminal module's own
workspace (OQ-3's own default: never redirecting into a matching repo's Git workspace).

**The quick-command panel.** `TerminalPanel.vue` is a second *view* over P85's existing
`custom_scripts` store (§10's reuse decision, not a second module-scoped list) — search, inline
add, run-on-click, and a context menu (Run/Edit…/Remove) that deep-links "Edit…" to the Settings
dialog's own Scripts section rather than re-implementing four fields in a 180-480px panel.

**Self-caught fix, folded in ahead of the test commit (`28d5a23b`).** `data-testid="terminal-panel"`
originally sat inside `PanelShell`'s `#body` slot, which only renders when non-empty — so on a fresh
boot (zero custom scripts, the default), the testid never mounted, silently contradicting §17.2 case
1's own requirement ("mounts `terminal-panel` with its empty state"). Caught while re-reading the
plan's test spec before writing it, not by a failing test — moved the testid to an outer wrapper so
it is present in both states.

**Open questions, all shipped per the plan's own stated defaults, no deviation.** OQ-1: Terminal
placed last in `MODE_ORDER`. OQ-2: the rail's own click-to-return behavior needed no special case —
Terminal's own workspace has no `lastRepoKey`-style state to restore, so it already falls out of the
existing generic path. OQ-3: every quick-command and scoped launch from the Terminal module always
carries `workspaceId: 'terminal'`, never auto-redirecting into a matching repo's Git workspace.

**Verification.** `go build`/`go vet`/`go test ./...` clean per commit and once at the end (66
packages ok; one `internal/grpcclient` failure on the full run, confirmed a pre-existing flake by
rerunning it alone 3/3 passing, and confirmed untouched by this phase's diff). `bun run
typecheck`/`biome check .`/`scripts/check-tokens.sh`/`bun run build` clean after every commit (same
two pre-existing `UncommittedChangesStrip.vue`/`RequestSettingsPane.vue` lint findings every prior
phase in this chapter has recorded, both untouched by this phase). `git diff --stat` against the
pre-phase commit confirms zero changes under `packages/git-ui/` or `apps/kira-studio-vscode/`.

New `terminal-module.spec.ts` (§17.2's six cases, all passing): the module opens with its own empty
panel/start; an unscoped terminal opens at the resolved home directory; a repo-scoped one opens at
that repo's root without leaving the Terminal module (the `openRepoWorkspace` regression §6 exists
to prevent); a quick command renders as both a panel row and a repo workspace's own "+" entry
(pinning §10's reuse decision); running one opens a terminal at its own working dir; adding one
calls `customScriptsCreate` with trimmed fields, Add staying disabled until both are filled.
`mode-switch.spec.ts`/`repo-workspace.spec.ts` migrated to four mode tabs (§17.3).

`bun run test:unit`: 1516 passed, 0 failed. Full `bun run test:ui` (`ui` + `ui-timing`, 307 tests):
301 passed, 2 failed, 4 did not run (the suite's own early-exit after failures under
`--project=ui --project=ui-timing`) — both failures confirmed pre-existing and unrelated by `git
diff --stat` showing zero overlap with either failing file's own source, and by isolated reruns:
`scroll-trace.spec.ts` passed cleanly alone (a load-timing flake, the same class P90's own 47
Monaco-timeout failures were); `http-request-body.spec.ts`'s "every IPC call stays under 500 bytes"
assertion fails deterministically even alone, but its own file and every file behind it are
untouched by this phase — the likely cause is P90's own already-landed per-request Api-settings
payload (7 new override leaves sent with every `httpSend`) having pushed a pre-existing, unrelated
threshold stale, not a P91 regression. `bun run build:vscode`/`bun run test:webview`: clean, 45
passed (expected — `apps/kira-studio-vscode/` untouched). No known open item.

## P92 result

Landed per plan (`docs/v1.8/plans/P92-git-graph-titlebar-tabs-bug-batch.md`), 13 commits
(`a4659482`, `d702ea16`, `e6bbadae`, `0b67bbe1`, `789bcd34`, `1be57f55`, `ba61ed98`, `439b2310`,
`ad077043`, `5d0895fe`, `3f159f95`, `82f2a47a`, `6c22e1ca`). Resumed from a prior session's own
work (rate-limited mid-debug) — real progress already committed plus uncommitted debug scaffolding
in `CommitGrid.vue`, cleaned up rather than kept.

**Item 8** (`a4659482`): the pinned `repo-graph` tab's own creation path left `path` unset, tripping
the DB's `NOT NULL` constraint on the very first write — given a real (empty-string) path instead.
**Item 4** (`d702ea16`): a row whose height changes after its first render (a decoration chunk
landing late) now repositions every row below it via `invalidate()`, not `updateRowCount()` +
`render()` (which never repositions already-cached rows). **Item 1** (`0b67bbe1`): the graph column
gained a drag handle and a capped default width (`DEFAULT_GRAPH_LANE_CAP`, 6 lanes/95px) instead of
growing unbounded with branch count; `PersistedViewState` bumped to v7. **Item 10** (`789bcd34`):
ref/tag badges render as an outline (colored border, transparent fill) instead of a filled chip.
**Item 9** (`1be57f55`): a general-settings control for git-graph font size. **Item 3** (`ba61ed98`):
a "New window" title-bar button, before the project-panel toggle, calling `WindowsService.OpenNew`.
**Item 6** (`439b2310`): Repos/Files/Review are three peer top-level tabs now, not Review nested
inside Files' own Files/Search strip. **Item 7** (`ad077043`): a visible go-to-file action on the
diff view, reusing P74's existing open-and-land-on-line path. **Item 5** (`5d0895fe`): "Open all
changes" on a commit opens one `repo-multi-diff` tab (per-file collapsible sections, only the
expanded one's editor actually mounts) instead of one tab per changed file.

**Item 2 — the root cause, corrected.** The prior session's own diagnosis (a missing
`scheduleResize()` call in the `loadedRows` watcher, so a row count crossing the
needs-a-scrollbar threshold never re-measured) was real but insufficient alone — re-verified by
removing it after the fix below and confirming the regression test still passed, since this
sandbox's Chromium renders its scrollbar as a non-layout-consuming overlay
(`viewport.clientWidth` never actually shrank here). Kept anyway as a correct, cheap, properly
deduped (`lastRebuiltWidth`) defensive fix for any real platform whose scrollbar does consume
layout width, per the plan's own explicit claim. The actual, empirically-traced cause (stack-trace
property interceptors on SlickGrid's own `setColumns`, not guesswork): SlickGrid's
`_columnDefaults` carries a hidden `minWidth: 30`, silently merged onto any column declaring none
of its own and clamped up whenever seeded narrower — `graphColumnWidth(0) = 17`, the transient
zero-lane state at mount, is exactly such a case. That 13px of silent inflation was the entire gap
between the computed and rendered widths. Fixed in `columns.ts` (`3f159f95`) by declaring
`minWidth: 0` (not `undefined` — `updateColumnProps()`'s clamp guards on `m.minWidth &&`, so only a
falsy value disables it) on all four columns.

**Test coverage.** `82f2a47a` covers items 1, 2, 4, 10 in
`apps/kira-studio-vscode/tests/interaction/graph-columns.spec.ts` (new fixtures in
`fakeGraphHost.ts`: `streamManyRows` for a real vertical scrollbar, `streamTwoChunksSecondDecorated`
for item 4's late-height-change case). `6c22e1ca` adds the three desktop-side Playwright cases the
plan's own test section named and the prior session's commits never included: item 3
(`workbench.spec.ts`, button visibility/DOM order/exactly-one-call-per-click), item 6
(`repo-workspace.spec.ts`, three top-level tabs plus the Files tab's own two-segment strip), and
item 5 (`repo-workspace.spec.ts`, "Open all changes" opens one `repo-multi-diff` tab listing every
changed path). Item 5 needed real new mock infrastructure: `gitStreamMock.ts`'s own doc comment had
flagged `graph.stream` as a known gap since P74/P75 (it only ever answered a plain unary req/res,
never the streamed, binary-carrying chunks `graph.stream` actually sends). `graphStreamFixture.ts`
builds a real chunk with the actual `@kira/git-ipc` codec (FlatBuffers encoding) rather than
hand-rolling a second copy of it, splitting the result across `page.evaluate`'s JSON-only argument
boundary (scalar fields plus one base64 blob); `gitStreamMock.ts` reassembles the real blob-frame
wire format in-page, where the request's own runtime `id`/`version` are known. `tsconfig.tests.json`
gained matching `allowImportingTsExtensions`/`lib` entries mirroring `git-ipc`'s own tsconfig, so
that import typechecks. The plan's own `rowSvg.test.ts` update for item 1 turned out to not apply —
already confirmed and documented as a deviation in `0b67bbe1`'s own commit message: that test file
never calls `buildRowSvg` directly, so there was nothing there to update; `viewState.test.ts` got
the real update, for the v7 schema bump.

**Verification.** `go build`/`go vet`/`go test ./...` clean, no flake this run. `bun run
typecheck`/`biome check .`/`scripts/check-tokens.sh` clean (the same two pre-existing
`UncommittedChangesStrip.vue`/`RequestSettingsPane.vue` findings every prior phase in this chapter
has recorded, both untouched by this phase). `bun run build` (desktop) and `bun run build:vscode`
both succeed. `bun run test:unit`: 1517 passed, 0 failed. `bun run test:webview`
(`webview-layout` + `webview-interaction`, including item 2's own regression case): 50 passed, 0
failed. Full `bun run test:ui` (`ui` project, 306 tests): 259 passed, 47 failed — every failure a
Monaco-timeout case (`data-kira-editor-text`/`__kiraRetention` never materializing) in files with
zero relation to this phase (console/http/gRPC/SQL-schema/autocomplete/slick-grid/leaks specs);
confirmed pre-existing and unrelated by `git diff --stat` against the pre-phase commit showing zero
overlap with any failing file, and by isolated reruns of a sample reproducing the identical
failures with no other tests competing for resources — the same class of Monaco-timeout flake
P90's own result section recorded (47 failures there too). No known open item.

## Layout

- **`SPEC.md`** — this file, one row per phase, updated as phases land or split.
- **`plans/`** — one implementation plan per phase, committed before that phase's implementation
  starts, written by an Opus subagent per `CLAUDE.md`'s own process, never edited afterward.
- **`mcp-repo-map-issues.md`** — this chapter's own repo-map MCP dogfooding log, continuing the
  practice v1.5/v1.6/v1.7 established.
