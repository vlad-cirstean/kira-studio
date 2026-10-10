# Code review round 1 (P236-P261)

Base `071eba1e1` (`docs: close out P235`, confirmed via `git log --grep=P235`). Head `e504071c8`
(`docs: P261 result`). Scope: `git diff 071eba1e1..HEAD`, 341 commits, 1351 files. All treated as
unreviewed. Three dimensions: architecture/security, correctness, performance.

15 findings: 0 high, 5 med, 10 low. Grouped by file or root cause; one commit per group.

## Group A: Space tab and workspace state

### 1. med: reusing a permanent diff tab as a preview open demotes it

`apps/kira-space/frontend/src/state/repoTabs.ts:148-158`. The reuse branch calls
`evictPreviewCohort(workspaceId, existing.id)`, which sets the cohort to `[existing.id]` even when
`existing` is a permanent tab.

Scenario: double-click file A in a commit (permanent diff tab), then single-click A again (preview
open, reuses the tab). The tab joins the preview cohort. A single click on file B now closes A's
tab, which the user had pinned.

Fix: when `existing` is not in the workspace's current cohort, only activate it (same as
`createTabsStore.reuseExistingTab`, which never touches the cohort for a preview reuse). Evict only
when `existing` is already a preview member. Pre-existing (not touched in range), fix anyway.

### 2. med: reload lands on the first restored repo, not the last opened

`apps/kira-space/frontend/src/main.ts:136-148`, `apps/kira-space/frontend/src/state/workspace.ts:55`.
`lastRepoKey` is session-only; boot activates `workspaceStore.openRepos[0]`, the first repo with a
restored tab.

Scenario: open repos X then Y, work in Y, quit. Relaunch shows X's graph. P261 result confirms the
same live.

Fix: persist the active workspace key per window (next to the mode `windowsEnsure` already
restores) and activate it at boot when it is still in `openRepos`; fall back to `openRepos[0]`.

## Group B: git review list mount cost

### 3. med: 500 review rows mount eagerly, each with two tooltip trees

`packages/git-ui/src/components/review/ReviewView.vue:543` (`REVIEW_ROW_RENDER_CAP = 500`),
`packages/git-ui/src/components/review/ReviewCommitRow.vue:252-266`. Every row mounts `TreeTwisty`
plus two `TooltipIconButton`s (each a reka `Tooltip` > `TooltipTrigger` > `Button` > `CodiconIcon`
tree), hidden by opacity only.

Measured (idle 4-core box, `repo-review-interaction.spec.ts`, `--workers=1`): "600 commits mount 500
rows" 4.5-5.4 s vs 1.8-1.9 s for "the back button" spec on the same fixture path, about 3 s of row
mounting. P247-result records the spec timing out at 5 s with load above 30; 10-19 s under load is
consistent. Real.

Fix: virtualize the list with the existing `@tanstack/vue-virtual` helper
(`packages/workbench/src/util/virtualRows.ts`); keep expanded rows measured. Drop the render cap and
"Show more" once virtualized. Cheaper interim: mount the action cluster only for the hovered or
focused row.

## Group C: Automations scheduler

### 4. med: timers measured on the monotonic clock miss fires after system sleep

`internal/scriptruns/scheduler.go:114`. The loop arms `clk.After(earliest - now)` once. On macOS the
Go runtime clock does not advance during sleep (golang/go#24595), so the timer fires late by the
sleep length. `tick` then skips the late entry (`Late` 60 s) and `advance` re-arms from the wake time.

Scenario: hourly script, armed 08:00 for 09:00. Lid closed 08:10-09:50. Timer fires near 10:40 wall
time. 09:00 skipped (expected), but 10:00, due while the app was awake, is also skipped; next fire
11:00.

Fix: cap each wait (e.g. 30 s) and re-check wall-clock `Now()` against `earliest` on every wake;
compare with monotonic stripped (`Round(0)`).

## Group D: ADE rebase agent tool grant

### 5. med (security): rebase agent's `Bash(git:*)` grant allows arbitrary command execution and push

`apps/kira-space/internal/ade/rebase.go:33`. The headless rebase run gets `Bash(git:*)` plus
`Write`/`Edit`. Any `git` invocation passes: `git -c alias.x='!sh -c …' x`, `git config core.hooksPath`,
`git push --force`.

Scenario: a conflicted file or commit message on the rebased branch carries a prompt-injection
instruction. The agent runs `git -c alias.z='!curl … | sh' z` or force-pushes, with no permission
prompt (`--permission-prompts none` only denies tools outside the allowlist).

Fix: replace the prefix grant with the subcommands the rebase needs (`git status`, `git diff`,
`git log`, `git show`, `git add`, `git rm`, `git checkout --ours/--theirs`, `git rebase --continue`,
`git rebase --skip`), and add a disallow list for `git push`, `git config`, `git -c`.

## Group E: git graph grid

### 6. low: `handleChunkLayout` doc names a call it does not make; full row teardown per chunk

`packages/git-ui/src/components/CommitGrid.vue:681-691`. Comment says `invalidateRowHeights()`
rebuilds the index; the body only calls `invalidateAllRows()` + `render()`. Each streamed chunk
tears down and rebuilds every rendered row.

Scenario: a maintainer trusts the comment when touching row heights; and a long stream does one full
DOM rebuild of the visible rows per chunk.

Fix: correct the comment (layout does not change heights, so no index rebuild needed). Invalidate
only rendered rows inside `_range` (`grid.invalidateRows(rowsInRange)`), not all rows.

## Group F: uncommitted-changes glyph

### 7. low: hollow dashed ring depends on CSS emit order

`packages/git-ui/src/components/UncommittedChangesStrip.vue:151-159`. The circle carries both
`fill-graph-lane-N` (from `laneClass`) and `fill-none`. It renders hollow only because Tailwind emits
`.fill-none` after `.fill-graph-lane-0` (checked in the built Space CSS). The hollow dashed ring
itself is intentional (file docblock: stash shape, "not a real commit"); not a defect.

Scenario: a Tailwind upgrade or a lane token rename reorders the rules; the ring fills solid.

Fix: set `fill: none` inline, as `rowSvg.ts:346` does, or pass a stroke-only lane class. If the
user wants a different glyph, that is a design call, not a fix.

## Group G: weight guard coverage

### 8. low: semibold/bold guard skips `apps/kira-space/frontend/src/views/repo`

`scripts/check-theme-classes.sh:784` scans `$GIT_UI_SRC` and `$SPACE_REPO_SRC`
(`apps/kira-space/frontend/src/repo`) only. `apps/kira-space/frontend/src/views/repo/RepoFileView.vue:354`
uses `@apply font-semibold`, undetected. ADE files' semibold is outside P258's git-module scope; not a
defect. The guard's comment (line 778) says Studio's scale is 400/500, but Studio, workbench and
docker-ui use `font-semibold`/`font-bold` 29 times.

Fix: add `apps/kira-space/frontend/src/views/repo` to the scan; change `RepoFileView.vue:354` to
`font-medium` (or exempt markdown headings explicitly); reword the comment to the git-module rule.

## Group H: stale comment

### 9. low: `contract.go` history names deleted `WorkingNumstatArgs`

`apps/kira-space/internal/gitrpc/contract.go:124-131`. Names `WorkingNumstatArgs` (deleted P257) and
extension-era plumbing (`proxyHandlers.ts`, `editor.openWorkingDiff`, deleted P243).

Scenario: reader greps for symbols that no longer exist.

Fix: trim the version-bump history to current facts, or drop the deleted symbol names.

## Group I: Docker disk cache

### 10. low: `kira.docker.diskUsage` localStorage map never pruned

`packages/docker-ui/src/queries.ts:152,175-179`. One entry per `context|host` scope, each with the
full per-volume size list; entries for removed contexts stay forever.

Scenario: user cycles through several contexts or remote hosts over months; stale entries with large
volume lists accumulate in localStorage.

Fix: on write, keep only the newest N (e.g. 5) entries by `takenAt`.

## Group J: Docker in-place network edit

### 11. low: alias change can leave the container detached from the network

`internal/docker/edit_apply.go:169-187`. An alias change disconnects, then connects. A connect
failure returns the error with the network already gone, contradicting the "each step is valid
alone" contract (line 66).

Scenario: reconnect fails (static address taken meanwhile, network removed concurrently). Running
container loses that network; UI reports a failed step with no hint it was detached.

Fix: on connect failure, best-effort reconnect with the original endpoint settings and report
`restored` in the error details, like `recreateRun.rollback`.

## Group K: P259 hidden repos

### 12. low: `SetHidden` on an unknown id returns an internal error; folder hide races a scan

`apps/kira-space/internal/storage/repos/coderepos.go:123-135` returns a plain `fmt.Errorf` for a
missing row, so `SetRepoHidden` surfaces `E_INTERNAL`. `apps/kira-space/internal/ade/repoconfig.go:309`
reads `FolderHidden` once before the import loop.

Scenario: repo removed in another window, then Hide clicked here: generic internal error. Folder
hidden while its scan runs: repos discovered after the read import visible.

Fix: return `ipcerr.NotFound` for the missing row. Re-read `FolderHidden` per import, or apply the
flag inside `SetFolderHidden`'s transaction to rows imported after it (an `UPDATE` after the loop).

## Group L: test quality vs CLAUDE.md

### 13. low: `packages/git-ipc/src/validate.test.ts` is a new trivial-guard test

Added in range (`5e06a42c6`). Tests version mismatch, wrap/unwrap round-trip, and single bad input
to single error: all on the CLAUDE.md "gets nothing" list.

Fix: delete the file.

### 14. low: migration default-value tests restate `DEFAULT` clauses

`apps/kira-space/internal/storage/migrations/migrate_smart_scripts_test.go`,
`migrate_scripts_in_ade_test.go`; Studio's same two files. Each asserts an `ADD COLUMN … DEFAULT x`
reads back `x`.

Fix: delete the four files. Keep the table-rebuild tests (`migrate_recurring_scripts_test.go`) and the
rename/classify tests (`migrate_automations_test.go`): real data movement.

## Group M: workflow graph editor save

### 15. low: Save overwrites a workflow changed elsewhere while the draft is dirty

`apps/kira-space/frontend/src/ade/v2/workflows/AdeWorkflowGraph.vue:65-75`,
`apps/kira-space/frontend/src/ade/v2/state/adeWorkflowDraft.ts:47-49`. `push` ignores external
updates while dirty (by design), and Save sends the whole draft with no base version.

Scenario: two windows edit the same workflow, or the YAML file is edited on disk. Last Save silently
discards the other change.

Fix: send the base workflow's hash with Save; backend refuses on mismatch; UI offers reload or
overwrite, same pattern as the Docker edit `baseHash`.

## Areas checked, nothing real found

- Docker recreate (`internal/docker/edit_apply.go` create, swap, rollback on a fresh context, old
  container kept on remove failure), edit validation (`validateClears` covers engine zero-means-
  unchanged), edit drafts (`packages/docker-ui/src/state/dockerEdit.ts` rebase/stale), disk and size
  measurement (`singleflight`, on-demand only), registry URL builder.
- `LinkService.OpenExternal` (both apps): `shell.OpenExternalURL` refuses non-http(s) and empty host.
- Migrations Space 0026-0032, Studio 0034-0037: correct column copies in the `script_runs` rebuild,
  indexes recreated; script run and log retention present (`internal/scriptruns/repo.go:244-306`).
- P259 services: folder hide is one transaction; re-import of a hidden repo unhides it; both paths
  emit the shared repos-changed event.
- No Keychain, OAuth token or credential reads added. P239 dropped the account source;
  `internal/claudeusage` reads statusline and stream-json numbers only. `~/.claude.json` is read for
  `mcpServers` only (`internal/claudeheadless/usermcp.go`), copied config written 0600 and removed
  after the run. DataGrip keychain import predates the range.
- Process spawning (`internal/scriptruns/headless.go`, `internal/claudeheadless/process.go`):
  `Setsid`, group SIGTERM then SIGKILL, `WaitDelay`, args single-quoted, prompt on stdin, bearer token
  in a 0600 file. Script folders (`internal/scripts/workdir.go`) refuse symlinked or non-dir paths.
- IPC surface: no stale reference to `GitClientsService`, `gitsock`, `gitvsix` or the extension.
- P257: remaining `--numstat` spawns (stash list, global stash log) kept for record framing, as the
  plan's D2 decided.
- Vue rules: every added or modified SFC is `<script setup lang="ts">`; no new `<style>` block; new UI
  uses shadcn primitives, VueUse, Pinia stores per concern, TanStack Query; new libraries
  (`@vue-flow/core`, `@dagrejs/dagre`, `gronx`, `vue-draggable-plus`) are MIT.
- Flow + UI split: Docker disk/edit/registry, hidden repos and Automations each have a Go flow test
  and a UI spec.
