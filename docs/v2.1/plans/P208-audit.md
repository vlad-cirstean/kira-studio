# P208 requirements audit

Base `ba8419e`, head `c83ac5d0a` (`v2.1-stream-F`). Scope: `git diff ba8419e..HEAD` (367 files). Read-only audit;
discovery through `codegraph_explore`, then greps, targeted specs and screenshots.

Verdicts: 18 MET, 3 PARTIAL, 0 NOT MET.

## Checks run

- Space UI (`--project=ui`, webkit): `panel-resize`, `terminal-quick-commands`, `repo-graph-pr-badge`,
  `repo-graph-rewalk`, `repos-dialog`, `settings-claude-code`, `ade-v2-task-menu`, `ade-v2-plan`,
  `ade-v2-workflows`, `ade-v2-sessions`, `memory-module`, `modules`: 74 passed. `ade-v2-launch`, `ade-v2-panel`,
  `ade-v2-run`, `ade-v2-review`: 55 passed.
- Studio UI: `panel-resize`, `terminal-module`, `slick-grid`, `docker-module`, `settings*`: 58 passed.
- Go: `apps/kira-space` `./internal/ade/... ./internal/adeagent/... ./internal/gitsession/...` ok; root
  `./internal/memory/... ./internal/docker/...` ok.
- Screenshots at 1440x900 from a temporary spec (deleted, not committed), all viewed: `space-ade-plan.png`,
  `space-ade-task-panel.png` (+ `crop-estimate.png`), `space-ade-task-menu.png`, `space-ade-stageblock-menu.png`,
  `space-ade-panel-sessions.png`, `space-ade-workflows.png`, `space-repos-dialog.png`, `space-terminal.png`,
  `space-quick-command-dialog.png`, `space-memory.png`, `space-memory-add.png`, `studio-docker-list.png`,
  `studio-docker-stats.png`. Location: session scratchpad `shots/`.

## Per requirement

1. **Panel resize releases. MET.** `ResizableHandle.vue:39-53` keeps `hitAreaMargins` identity stable and replays
   release via `useDragReleaseFallback.ts`; same fallback in `DockResizeHandle.vue:43` and
   `AdePanelResizeHandle.vue:62`. `panel-resize.spec.ts` passes in both apps.
2. **One add path, multiline, both apps. MET.** `TerminalPanel.vue:164-170` header `+` is the only add control;
   empty state is text only (`:246`). `QuickCommandsDialog.vue:117-125` 8-row monospace resizable `Textarea`,
   Cmd/Ctrl+Enter saves. Space wiring: `createCustomScriptsStore` callers in both apps' `state/customScripts.ts`,
   Space `customscriptsservice` bindings. Screenshot `space-terminal.png`, `space-quick-command-dialog.png`.
3. **Collections, left titles. MET.** `TerminalPanel.vue:48-71` groups and collapses; dialog collection field with
   datalist (`QuickCommandsDialog.vue:144-174`). Screenshot shows Backend/Frontend groups, titles left-aligned.
4. **PR cache, tip-only badge. MET.** `gh.go:167` `markStale` replaces drop, `ensureSnapshot` serves stale and
   revalidates (`:373-398`); `pr.ts:501` `prsHeadedAt` is the only grid lookup (`CommitGrid.vue:350,881`);
   `CommitMeta.vue:295` keeps ancestry `prForCommit`. `repo-graph-pr-badge.spec.ts` passes.
5. **Keep-awake setting Space only. MET.** Grep: `keepAwakeWithAgents`/`ClaudeCodePane` only under `apps/kira-space`
   and `internal/keepawake`; none in Studio. `KeepAwakeRecompute` called from Space `main.go:180,195,197,553`.
6. **Agents look like the workbench. PARTIAL.** Plan, Task, Workflows panes use one frame, `PanelHeader`,
   tab chips (screenshots). Gaps seen:
   - `ade/v2/panel/AdeEstimateField.vue:67-76,89-99`: `type="number"` `Input` at `w-14` renders only the WebKit
     spinner, no visible value (`crop-estimate.png`). Fix: widen to fit (`w-20`) or drop the spinner
     (`[appearance:textfield]` plus hidden spin buttons), as other numeric inputs in the app.
   - `workflows/AdeStageCard.vue:106-108`, `workflows/AdeStepCard.vue:64-66`: text glyphs `↑ ↓ ✕` as button
     labels. Fix: `TooltipIconButton` with codicons `arrow-up`/`arrow-down`/`close`, as the Git and Terminal panels do.
   - Workflow editor still nests three frames: pane, stage card, step card (`space-ade-workflows.png`). Fix: steps
     render as divided rows inside the stage card (border-t between steps), no own border/background.
7. **One repo list, one dialog in Git. MET.** `ReposDialog.vue` mounted only in `GitPanel.vue:634`; openers
   `GitPanel.vue:189,367`, `GitStart.vue`, Agents empty state (`AdeView.vue:29`) which calls
   `reposDialog.show()` -> `setMode('git')` (`repo/state/reposDialog.ts:15-22`). Nickname, prepare script,
   timeout, base path, integration branches, environments in the dialog (`space-repos-dialog.png`). Grep: no
   `AdeReposPage`/`ade-tab-repos`; `UpdateRepo` used only under `repo/`. ADE tabs: backlog, needs, plan, workflows.
8. **Agents git refresh. MET.** `ade-v2-plan.spec.ts` and `board_refresh_test.go` pass; Refresh all and per-repo
   refresh visible (`space-ade-plan.png`).
9. **Stage forward and back. MET.** `runs.go:871` `SetTaskStage` (any stage or done, refused while live, skipped
   stages refused); `AdeStageMover.vue` Back/picker/Next visible in `space-ade-task-panel.png`.
10. **Tabs by stage; session id copyable. MET.** `sessionView.ts:68-74` names tabs `<stage> · <step> · <repo>`;
    `AdeSessionId.vue` full id + `useClipboard` copy, used in `AdeHeadlessPane`/`AdeTuiPane`; task menu Copy has
    Claude session id (`ade-v2-task-menu.spec.ts`).
11. **SQL widths kept across reloads. MET.** `slick-grid.spec.ts` passes (P195 case).
12. **Workflow Save; started work keeps its version. MET.** `AdeWorkflowSaveBar.vue` Save/Discard, no autosave
    debounce left (only YAML validation debounce, `AdeWorkflowYaml.vue:41`); snapshot via `snapshotWorkflow`
    in `StartRun`/`SetTaskStage`/`LaunchStage`; badge `AdeWorkflowBlock.vue:58-63`.
13. **Right-click stage -> Skip. MET.** `AdeStageCard.vue:26-45` menu with Skip/Don't skip, up, down, remove;
    task-view stage block menu (`AdeStageBlock.vue:66`) seen in `space-ade-stageblock-menu.png`;
    `ade-v2-workflows.spec.ts` passes.
14. **Task context menu. MET.** `space-ade-task-menu.png`: Retry, Move to stage, Skip, Show sessions, Plan, Mark as
    not merging, Open Jira, Copy, Archive; `ade-v2-task-menu.spec.ts` passes.
15. **Kira Space MCP for agents. PARTIAL.** Flag in editor (`AdeWorkflowForm.vue:103`), four tools
    (`adeagent/space.go:127-186`), grants for headless and TUI (`runs.go:536`, `launches.go:275-305`), `origin='agent'`.
    Gap: manual/derived branch creation is not removed. With `kira_space_mcp: true`, `StartRun`
    (`runs.go:247`) still calls `prepareWorktrees`, whose `ensureWorktree(..., names[sb.ID])` gives every unnamed
    `mine` branch a derived `feat/<slug>` name (`setup.go:174-190`) before the agent starts; the Run dialog still asks
    for branch names (`run/AdeRunDialog.vue:31,103-115`). `RequestBranch` then refuses a different name
    (`agenttools.go:307-308`). So agents name only repos they declare after the run started. Fix: when
    `spaceEnabled(task)`, `StartRun` skips creating unnamed `mine` branches; such runs start in the repo root
    read-only like `launchDirs` does for TUI (`launches.go:460-468`), with the prompt telling the agent to call
    `request_branch` first; the Run dialog hides branch inputs for these workflows; `stepTargets` keeps unnamed
    branches as targets. Go test for "StartRun with the flag creates no branch" plus a Run-dialog spec case.
16. **Docker module. PARTIAL.** Functional scope met: `internal/docker`, `packages/docker-ui`, Studio mode
    `docker` (modes `studio, api, terminal, docker`); containers grouped by Compose, images, volumes, networks,
    start/stop/restart, logs, exec terminal, CPU/RAM per row and Stats tab; `docker-module.spec.ts` passes. "Much better
    UI than Docker Desktop" not reached in what the screenshots show:
    - `DockerPanel.vue:98` section chips `flex-wrap`: at default panel width "Networks 1" wraps to a second row
      (`studio-docker-list.png`). Fix: no wrap; shrink labels or use an overflow menu, one row like other panels.
    - `formatBytes` (`packages/workbench/src/util/format.ts:8-12`) stops at MB: engine memory reads "16384.0 MB",
      limits "1907.3 MB". Fix: add a GB step (>= 1024 MB) there, every caller benefits.
    - Container rows put name, image, CPU and RAM in one run of text with no column alignment or header
      (`studio-docker-list.png`). Fix: fixed-width right-aligned CPU and RAM columns, image muted and truncated.
    - Overview leaves most of the main pane empty: tiles plus six lines of facts. Fix: list running containers with
      sparkline CPU/RAM under the tiles.
17. **Memory MCP in Space. MET.** Space `memory` mode last (`modes.ts:12`), Studio has none; gate isolation
    `internal/memory/claude.go:83-91` (`--model sonnet`, `--setting-sources ""`, `--strict-mcp-config`,
    `--tools ""`, `--safe-mode`, env scrub `:57-80`); reconcile add/update/noop with history
    (`reconcile.go:80-155`); `includeHistory` on `search_memories` (`mcpserver/server.go:36,66`); author per
    request; UI store author fixed `user` (`bridge/memory.go:163`); Add memory dialog resubmits clarifications
    (`AddMemoryDialog.vue:45-59`). `memory-module.spec.ts`, Go tests pass.
18. **Prepare-script progress and failure. MET.** Shared `ScriptProgress` used by `AdeSetupProgress.vue`,
    `setupStatus.ts`, git-ui `AppToolbar.vue`, `WorktreeDialog.vue`; `E_PREPARING` wait in
    `ade/v2/state/useSetupWait.ts`; `ade-v2-panel.spec.ts` "See error ... Retry setup" passes. Space Git module does
    not run prepare scripts at all (`repo/git/hostHandlers.ts:206-208`, user decision), so nothing to show there.
19. **Graph click keeps commits. MET.** `repo-graph-rewalk.spec.ts` passes (fails on base per P203 result).
20. **Terminal after Agents in Space. MET.** `MODE_ORDER = ['git','ade','terminal','memory']`; live mode tabs read
    the same order.
21. **Standing rules. MET.** Added-line grep for `TODO|FIXME|XXX|HACK|stub` finds only two plan-doc mentions of test
    stubs. Every added/changed `.vue` has `<script setup lang="ts">` (one `generic=` variant), no second script, no
    new `<style>` block, no `defineComponent`. New stores single-concern (`reposDialog`, `dockerUi`, `dockerStats`,
    `dockerExecSessions`, `memoryUi`, `customScripts`). New deps: `moby/moby/client`, `docker/cli` (Apache-2.0),
    `anser` (MIT). Every commit subject since base is Conventional Commits. Plans exist for every phase
    (`P185-P196`, `P197-P202`, `P200`, `P201`, `P203-P207`).

## Defects noticed along the way

- Memory mode shows an empty tab strip above the main pane (`space-memory.png`); also P201 Part 2's own open item.
  Fix: hide the editor tab strip for modes with no tabs, or render Memory as a full-layout module.
- Workflow editor drops unsaved edits on module switch (P196 open item). Fix: keep the draft in the workflows UI
  store per workflow id, or confirm before leaving with unsaved edits.
- Task panel "Sessions 1" counts a finished session while the tab body says "Nothing running."
  (`space-ade-panel-sessions.png`). Fix: count running sessions, or label the count as total.
- `ade/v2/panel/AdeLinkRow.vue:78`: the empty link input is `border-dashed font-data`, so the GitHub placeholder renders monospace with a dashed border
  (`crop-estimate.png`), unlike the Jira row above it; P207 restricts `font-data` to code-like text.

No regressions found in the specs above. No dead code found in the touched areas beyond what `lint:dead` covers.
