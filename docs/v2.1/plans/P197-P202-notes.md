# P197-P199, P202 notes

Stream E. Plan: `P197-P202-plan.md`. Q1 decision (user): keep boundary; Space Git window still refuses `worktree.prepare`.

## P197 Skip a workflow stage

Landed: `skip` on `adewire.Stage`, `adeflow` parse/write (`skip: true` only when set; all-skipped workflow rejected), `ade/stages.go` (`firstRunnable`, `nextRunnable`) used by `stageSnapshot`, `StageDone`; `SetTaskStage` refuses a skipped target. UI: stage card right-click menu, `skipped` chip, mover and stage block menus, `skipped` segment and block state.

Deviations:
- Menu primitive: workbench singleton `ContextMenu.vue` (shadcn-vue `DropdownMenu`), not a new shadcn `ContextMenu`. Every right-click menu in both apps uses it.
- No mock-runtime change: UI mock replies are static fixtures; refusal lives in Go (`stages_test.go`).
- `withSkip` helper dropped: card patches its own stage; `runnableCount` covers the last-runnable guard (`canSkip`).
- A skipped stage the task already sits on stays current; its block shows `now`, not `skipped`.
- Fixtures: `skip: false` added to stage objects in `board.json`, `task.json`, `workflows.json`; unit fixtures too.

## P198 Task context menu

Landed: `board/taskMenu.ts` (pure descriptors), `plan/useTaskMenu.ts`, wired on the card box (right-click), card head (Shift+F10, ContextMenu key), task action cell, review row cells, and a `⋯` "More actions" button in the task panel header. Spec `ade-v2-task-menu.spec.ts`.

Deviations:
- Handler sits on the whole card box, not only the head; branch rows still stop propagation. Review cards have no head, so their reachable spots are the box edge, the `review` tag cell and the panel button.
- Right-click calls `stopPropagation` so the enclosing day band's menu does not replace it.

## P199 Agent-requested branches (Kira Space MCP)

Landed: four tools on the loopback ADE MCP server, gated by workflow flag `kira_space_mcp` (wire `kiraSpaceMcp`): `task_info`, `declare_repos` (additive, branch origin `agent`), `request_branch` (name validated by `git check-ref-format --branch`; `main` and integration refused; idempotent; rename refused), `branch_status` (optional wait, polls). Repo refs resolve by nickname, name, then id. `ade/agenttools.go` implements `adeagent.SpaceTools` on `*ade.TaskBoard`; errors reach the agent as actionable `ToolError` text. Migration `0018` adds `ade_task_branch.origin`. UI: workflow form switch, workflow block row, `agent` chip on branch rows and panel.

Deviations:
- Live smoke: not run against real `claude`/server build. Protocol covered by `adeagent` `TestGrantScopes` (go-sdk client, grant scoping) and `agenttools_test.go` (four tests). Path: fake client only.
- `startSetup` has 5 non-test callers (`agenttools.go`, `board_writes.go`, `launches.go`, `runs.go` x2); the agent path is the added one.

## P202 Prepare script progress

Landed:
- Backend: `ade_worktree_setup.note` (migration `0019`), wire `WorktreeSetup.note`; failures recorded for every start path (`recordSetupFailure`); `RetrySetup` recreates the worktree; launches blocked by pending setup return `E_PREPARING` (`ErrSetupPending`).
- Shared `packages/theme/src/components/ScriptProgress.vue` (running/ready/failed, elapsed via `useIntervalFn`, `actions` slot).
- ADE: `AdeSetupProgress`, `AdeWorktreeSetup`, `useSetupWait`, `setupGate`/`setupStatus`; shown in launch dialogs, Claude dialog (stage dialogs use all task branches), run dialog, stage block, needs-you.
- git-ui G1: `OpsState` `worktreePrepareStatus`, `StartedAt`, `FinishedAt`, `LastPath`, `dismissWorktreePrepareResult()`; toolbar strip with `Output` popover, Cancel while running, dismiss when finished; failure stays until dismissed, success fades after 5 s (`useTimeoutFn`); `WorktreeDialog` uses `ScriptProgress`; new `PrepareOutput.vue`; bun test for status lifecycle.

Deviations:
- Toolbar strip shows spinner, folder, last output line; elapsed time lives in the popover's `ScriptProgress`, not the strip.
- Dialog `Close` after a finished run dismisses the result, so the strip does not repeat what the dialog showed.
- git-ui strip not screenshot-verified: no fake-host scenario drives `worktree.prepare`; covered by typecheck, lint, unit test. Space UI parts checked via Playwright screenshots.
- Kira Space Git window still refuses `worktree.prepare` (Q1).

## Verification

Pass: `go test -race` ade, adeflow, adeagent, bridge/..., storage/...; `bun test apps/kira-space/tests/unit packages/git-ui/src` (382); `bun run lint:dead`; `go build -tags server`; `go vet`; `gofmt`; lint and typecheck via hook; `bun run test:ui:space` (203 passed, no rerun needed). Failing visual baselines: none. Baselines not regenerated.

## Proposed ARCHITECTURE.md edits

- ADE: workflow stage `skip: true`; skipped stages are passed over by stage advance; a workflow needs at least one runnable stage.
- ADE MCP: with `kira_space_mcp`, agents get `task_info`, `declare_repos`, `request_branch`, `branch_status`. Branches they create have `origin: agent`.
- Worktree setup: row carries a failure `note`; launches wait on setup and fail with `E_PREPARING`. Kira Space Git window still refuses `worktree.prepare`; ADE paths and the VS Code extension host show script progress.
