# P386 code review, round 1

Base `902cf7e` (last commit of v0.2.19). Scope: full diff `902cf7e..HEAD`, phases P374-P385.

Discovery: `codegraph_explore` unavailable this run (MCP server failed to start, `codegraph` binary not
on PATH). Grep and Read used instead.

Counts: 0 high, 2 medium, 5 low.

## Findings

### F1 (medium, security) Fork PR link can auto-run the prepare script on untrusted code

- Where: `apps/kira-space/internal/ade/hostlink.go:63-66` (`AddHostLink` calls `prepareAttached` when
  kind is not review); kind comes from `resolveKind` (`apps/kira-space/internal/ade/gitfacts.go:115`),
  which marks a branch `mine` when its tip author email equals local `user.email`.
- What: P383 lets a pasted fork PR link fetch `refs/pull/<n>/head` from any third party. Commit author
  email is self-declared. A fork author who sets their commit email to the user's public email gets
  the branch classified `mine`. `prepareAttached` then creates a worktree and runs the repo's
  configured prepare script (typically `bun install` / `npm install`) inside it.
- Failure scenario: attacker opens a PR from a fork; tip commit authored as `victim@example.com`;
  `package.json` carries a `postinstall` payload. Victim pastes the PR link to review it. Task is created
  as a work item, the prepare script runs, the payload executes on the victim's machine. Before P383,
  only branches already on the user's own remotes could be attached this way.
- Fix: for `plan.target.Fork` (or any change-request link whose head repo is not the base repo), force
  review kind or skip `prepareAttached`. Let the user opt in through the existing explicit
  `Convert to work item` action (P377), which already runs prepare on demand.

### F2 (medium) Concurrent runs of one script still possible (P380 UI-only gate)

- Where: `packages/workbench/src/automations/runScript.ts:30`, `packages/workbench/src/automations/scriptTabs.ts:46-58`,
  `packages/workbench/src/tabs/scriptRunTabKind.ts:33` (`dropResources: () => {}`).
- What: the "one live run per key" rule only looks at tabs open in this window's automations
  workspace. Nothing on the server refuses a second run of the same `{scriptId, taskId, branchId}`.
- Failure scenarios:
  1. Start a smart script; close its tab. Closing a script-run tab does not stop the run
     (`dropResources` is a no-op). Press play again: no live tab, so a second concurrent run starts.
  2. Space: a second window (or the review window) has no tab for the key; play there starts a
     parallel run.
  3. Smart run: confirm the run dialog, then press play again before `runs.start` resolves and
     `openRun` adds the tab. `focusLive` sees nothing yet; a second dialog and run follow.
- Fix: gate on the run list too (`useScriptRuns` already holds `running`/`waiting` runs with
  `scriptId`/`taskId`/`branchId`): a live run for the key focuses or opens its tab instead of
  starting. Add a server-side refusal (`ScriptRuns.Start` returns a bad-request when a run of the key
  is running) so other windows and in-flight double starts are covered. Spec row P380 lists the
  server-side refusal as "Not done"; this finding asks for it.

### F3 (low) Status save can reuse a removed status id and skip its reassign

- Where: `apps/kira-space/internal/storage/repos/adestatus.go:137-176` (`normalizeSet` seeds `taken`
  only with kept ids), `:190` (`reassignRemoved` skips any old id present in `taken`).
- What: deleting a status and adding a new one with the same name in one save gives the new status the
  removed status's slug. `reassignRemoved` then treats the old id as kept.
- Failure scenario: set holds `blocked` (category active, 5 tasks). The user deletes `Blocked` choosing
  reassign to `in-progress`, and the same save (or a direct API call) adds a new `Blocked` with category
  review. The 5 tasks are not moved; they silently sit on the new status with a different category, and
  workflow steps whose `status: blocked` pointed at the old one now resolve to the new one. The UI
  issues delete and add as separate saves, so the pane alone does not hit this; the IPC accepts it.
- Fix: seed `taken` with every old id (not only kept ones) before generating slugs, so a new status
  never takes a removed id within the same save.

### F4 (low) New status gets a placeholder id until the board refetch lands

- Where: `apps/kira-space/frontend/src/ade/v2/queries.ts:175-182` (`withSavedStatuses` uses `s.name` as
  the id of a new status), `apps/kira-space/frontend/src/workbench/settings/TaskStatusesPane.vue:102`.
- What: the optimistic patch writes `id: "New status"` into the board cache. `mutateAsync` resolves
  before the board push refetch replaces it, so `fresh` is set to the placeholder id. The real id
  (`new-status`) is in the mutation result, which is ignored.
- Failure scenario: Add, then rename immediately. `edit()` sends `{id: "New status", ...}`; the repo
  refuses with `status "New status" does not exist`. When the refetch lands, the row's id changes,
  the row remounts, and the focused name input loses focus.
- Fix: in `useSaveStatuses`, `onSuccess` writes `result.statuses` into the board cache. `add()` reads
  the new id from the mutation result, not from `ids`.

### F5 (low) ProjectTree move chord refocuses before the move settles (carried item)

- Where: `apps/kira-studio/frontend/src/project/ProjectTree.vue:224-232` (`moveViaMenu`).
- What: same pattern P381 fixed in `CollectionsTree` with `runMenuShortcutAsync`: the move is fired
  without awaiting, then `revealKey` + `focusKey` run. Today the happy path is safe only because
  `reorderConnections` (`apps/kira-studio/frontend/src/state/connections.ts:92-101`) sets
  `state.records` synchronously before its first `await`.
- Failure scenario: the reorder rejects (connection deleted in another window). The store restores the
  persisted order after focus already landed; rows are index-keyed, so focus sits on an element now
  showing another connection. Any later change that adds an `await` before the optimistic write turns
  this into the happy-path bug P381 fixed.
- Fix: mirror `CollectionsTree`: `void runMenuShortcutAsync(menuForRow(row), id).then(() => revealKey(key)).then(() => nav.focusKey(key))`.

### F6 (low) Generated `unnamed_<n>` key can collide with a real key

- Where: `apps/kira-studio/internal/postman/parse.go:155-159` (`decodeVariableEntry`).
- What: keyless entries become `unnamed_1`, `unnamed_2`, ... without checking the names already in
  the array. `api_variables` has no unique constraint, so both rows import.
- Failure scenario: a collection holds `{key: "unnamed_1", value: "a"}` and a keyless `{value: "b"}`.
  Both import as `unnamed_1`; `{{unnamed_1}}` resolves to whichever row wins, and the user cannot tell
  the generated one from the real one.
- Fix: collect the array's real keys first (two passes in `decodeVariables` / `parseEnvironment`) and
  skip numbers whose name is taken.

### F7 (low, performance) Link resolve spawns git in every repo on each call

- Where: `apps/kira-space/internal/ade/hostlink.go:281-307` (`matchHostRepo`), reached from
  `resolveHostLink` on every `ResolveHostLink`, again in `AddHostLink`, and a third time for a tree link
  inside `fetchHostLink`.
- What: each call runs `git remote` plus `git remote get-url` per remote in every code repo (fan-out
  `boardFanOut`), then `BranchInventory`. The popover debounces and caches 30 s per URL, so a paste
  costs one round, but adding the link repeats it twice more.
- Failure scenario: a workspace with 40 repos and 2 remotes each spawns about 120 git processes per
  resolve, about 360 for one tree-link add. Noticeable latency on the Add button, no correctness impact.
- Fix: cache the parsed remote URL per repo entry (invalidate on `refsChanged`/config change), or reuse
  the plan's `CodeRepoID` in `AddHostLink` and re-check only that repo's remote.

## Carried items checked, nothing real

- P384 `ReviewWorking` / `ReviewWorkingDiff` path safety: the worktree comes from `GetBranch` +
  `worktreeOf` (git's own worktree list), never from the caller. `path` goes through
  `pathsafe.ValidateRelPath` (rejects absolute, `..`, symlink escape, dangling symlink). The HEAD side
  uses `<tip>:<path>` through cat-file, with the existing newline guard. No traversal found.
- P384 uncommitted-section refresh: board push (debounced server side), window focus, and agent
  `PostToolUse`/`Stop` inside the worktree (debounced `TIMING.fileSettle`) invalidate one key prefix.
  Getter query keys are unwrapped by vue-query 5.103 (`cloneDeepUnref` with `unrefGetters`).
  `ReviewFilesState` reloads on `refsChanged` (coalesced) and re-selects or clears the open file.
  Remounted diff tabs refetch with `staleTime: 0`, and `getOrCreateModel` rewrites stale model text.
  Nothing real.
- P383 link parsing and `gh` invocation: `https` only, claimed host only, owner/name matched against
  `^[\w.-]+$`, PR number digits only. The API path is built from validated parts. Branch names from the
  host pass `CheckBranchName` (leading `-` refused, then `git check-ref-format --branch`) plus a
  `:`/space check before any refspec is built. Refspecs go to `git fetch` as argv, not through a shell.
  No injection found. Trust of fork code is F1.
- P379 migration 0051: valid backfill; `workflow_json` is only ever NULL or app-written JSON, so
  `json_each` cannot fail on existing rows. The migration test covers the backfill. Status deletion:
  `UpdateTask` checks status existence in the same transaction; a missing id falls back to the
  category default (`statusOf`, `resolveStepStatus`). The only edge found is F3.
- P382 migration 0045: `NOT NULL DEFAULT 'inherit'` keeps every row's behaviour. Create and Update
  normalize `""` before validation. An unknown stored value coerces to `review` (fail closed). The
  frontend always sends the full record. Nothing real.
- P385 Postman defaults: entries import with defaults as specified; disabled entries are skipped before
  numbering. Only F6.
- P381 reorder backends (`ReorderCollections`, script `Move` with `beforeId`): single transaction,
  duplicate and unknown ids refused, dense rewrite. Nothing real.
- P374, P375, P376, P377, P378: nothing real found beyond F1 (P377 conversion runs prepare only on
  an explicit user action, which is fine).
