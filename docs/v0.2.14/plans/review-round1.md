# v0.2.14 code review, round 1

Base: `ac9b371` (v0.2.13). No earlier review session in git. Scope: `git diff ac9b371..HEAD`:
P340, P341, P342, plus pre-chapter commits `764d24a` (macOS title bar) and `16abe18` (pager label).

## 1. Architecture, maintainability, security

Sandbox profile: no real finding beyond F5. Profiles now render the former opt-in `keychain=true`
branch exactly: no `mach-lookup` deny, `~/Library/Keychains` read allow. Write protection
(`protectWrites`, `profile.go:145`) and policy guard (`policy.go` `newGuard`/`covers`) are
unchanged, so user `read`/`allow` entries still cannot cover the keychain dir. Matches P341 intent.
Migration 0046 is registered in `embed.go` at version 46, file name matches, `DELETE` is idempotent.
No leftover `sandboxKeychain`/`AuthReason`/`IsAuthFailure`/removed i18n key references.

### F7 (Low) Stale KeepAlive comments in repo-workspace spec

`apps/kira-space/tests/ui/repo-workspace.spec.ts:1066-1068, 1131-1143, 1164`. Comments cite
`MainView.vue`'s `KEEP_ALIVE_VIEWS`, `:max="20"` and "deactivates/reactivates". None exist now.
They also claim a `TabViewStateStore` round trip is impractical in one session. Workspace
close/reopen now reaches it (`repo-graph-keep-state.spec.ts` case 3).
Fix: rewrite to the kept-mounted (v-show) model; drop the "impractical" paragraph.

## 2. Functional correctness

### F1 (Medium) Switching to the ADE module drops every kept graph

`apps/kira-space/frontend/src/workbench/WorkbenchShell.vue:65-66`:
`<component :is="fullView" v-if="isFull" /> <MainView v-else>`. `ade` is a `layout: 'full'`
module, so entering it unmounts MainView. `visited` resets and every kept RepoGraphView unmounts.
Scenario: scroll the graph, select a commit, open ADE, return to Git. Graph cold-mounts: new
git-ui app, `app.init`, `graph.stream` re-walk, restore from persisted view state. P342's own
symptom ("reloads entirely from scratch"), via a common switch.
Fix: keep MainView mounted (wrap in a `v-show="!isFull"` element; `fullView` keeps `v-if`). Feed
the suspended state into MainView so the active kept view gets `active=false` (and so
`setVisible(false)`) while ADE shows. Add a case to `repo-graph-keep-state.spec.ts`: ADE and back,
assert the `data-p342` tag survives and `app.init`/`graph.stream` counts stay flat.

### F2 (Medium, unverified) "Open in graph" reveal scrolls a hidden grid

`apps/kira-space/frontend/src/repo/git/hostHandlers.ts:349-358`, `packages/git-ui/src/App.vue:542-555`,
`packages/git-ui/src/components/CommitGrid.vue:1230-1241`. Before P342 the graph was unmounted while
a file/diff tab was active, so `emitLocal('ui.action')` found no listener and the reveal went
through the cold-mount stash. Now the hidden graph listens. The handler emits first, then calls
`activateTab`. For an already-loaded sha, `revealSha` resolves immediately. `selection.select` and
`grid.scrollRowIntoView` then run in a microtask queued before Vue's render flush. The grid is
still `display:none`, so the `scrollTop` write has no box to apply to.
Scenario: graph scrolled to top, open a file, blame "Open commit in graph" on a commit at row 250.
Graph shows with the row selected but off-screen.
Fix: activate the tab first, then emit after the post-flush show (`await nextTick()` plus one rAF),
or have RepoGraphView queue `ui.action` until `active` turns true. Add a UI spec for this flow.

### F3 (Low) Mount-time options now stale for the whole session

`apps/kira-space/frontend/src/views/repo/RepoGraphView.vue:30, 51`. `repoHead` (repo name and
colour) and `appearance.dateFormat` are read once at mount. Before P342 every tab switch remounted,
so a change showed on the next switch. Now it shows only after workspace close or app restart.
Scenario: change Settings, Appearance, date format. The open graph keeps the old format all session.
Fix: pass both as reactive inputs (a provided `shallowRef`, like `GRAPH_VISIBLE_KEY`, or a
`MountHandle.update()`), watched in RepoGraphView. Update the `MountOptions.dateFormat` doc in
`packages/git-ui/src/main.ts`.

### F5 (Medium, unverified, needs a real Mac) OAuth token refresh under the sandbox

`internal/agentsandbox/profile.go:145` still denies `file-write*` under `~/Library/Keychains`. The
legacy file keychain writes `login.keychain-db` in-process. A `claude` refresh of an expired OAuth
token from a sandboxed run would likely be denied. P341 also removed the `setup-token` path. So if
the refresh fails, sandboxed headless runs fail after token expiry with no supported workaround.
This defeats the P341 premise ("harness needs keychain access to work"). SPEC lists this as an open
risk; only the `DEV_ENVIRONMENT.md` Mac checklist (step 9) covers it.
Fix: run checklist step 9 before release. If refresh fails, allow writes on the login keychain file
literals (db, journal, lock) and keep the rest of `~/Library/Keychains` write-denied. Otherwise
record it in `docs/ARCHITECTURE.md` Known open items.

### F6 (Low) Lifecycle "bug 1" test no longer reaches its regression

`apps/kira-space/tests/ui/repo-graph-lifecycle.spec.ts:77-113`. The test guarded "a graph unmount
disposes the shared transport, so a remount hangs". Opening a file no longer unmounts the graph, so
no lease is disposed and no remount happens. The test passes whether or not `leaseOf` isolates
leases. Keep-state case 3 does not cover it either: workspace close disposes the whole shared client.
Fix: drive a real lease dispose next to a live mount. Switch GitPanel Review on, then off
(`RepoReviewView` unmounts and disposes its lease), emit `repo.changed`, and assert the graph still
refreshes and stays `connected`. Update the test comment.

No real finding in: RepoDiffView unmount guard (both awaits re-check `diffEditor !== handle`);
MainView `visited` pruning on tab close; browse leaf double-click; Docker restore banner/dialog;
pager label; title bar.

## 3. Performance and resource use

### F4 (Medium) Unbounded kept graphs keep doing full refresh work while hidden

`packages/workbench/src/components/MainView.vue:21-37`. Nothing evicts from `visited`; P79's
KeepAlive had `:max`. Each visited repo workspace keeps:
- a git-ui Vue app;
- a layout Web Worker (`packages/git-ui/src/graph/layoutClient.ts:65`);
- the full `CommitStore`/`LayoutStore` (up to whatever was loaded, e.g. 200k rows);
- SlickGrid DOM;
- every `repo.changed` subscriber.

`setVisible(false)` defers only CommitGrid's grid rebuild. `GraphViewState` (`graphView.ts:133-138`)
still runs `graph.refresh`, a stream reopen and `#rebuildLayout`: a main-thread plan rebuild plus a
worker relayout of the whole store. `StackState`, refs, stash and ops reloads run too.
Scenario: 8 repos visited, ADE runs committing across them, or autofetch. Every `refsChanged`
costs a full relayout per hidden graph that nobody sees. Memory grows with repos visited this
session, never shrinks.
Fix:
- cap `visited` with an LRU (e.g. 4-5 most recently active). An evicted view unmounts and
  cold-restores from `TabViewStateStore`.
- defer `GraphViewState` auto-refresh while hidden: mark pending, run once on show, as CommitGrid
  already does for its rebuild.
