# v0.2.21

Branch `chapter/v0.2.21`. First `P` is 388 (highest in `docs/HISTORY.md` is P387).

Source: user request. Phases run top to bottom.

| Phase | Title | Status |
|---|---|---|
| P388 | ADE task list: calmer look, clear active-task marker, visible separators | Done |
| P389 | ADE tightening: drop plan top bar, drop task toolbar, drop session bar | Done |
| P390 | ADE git module last in order | Done |
| P391 | Both apps: scrollbars hidden until pointer is in the panel | Done |
| P392 | Review others' PRs: approve and comment; agent panel button to far right | Done |
| P393 | Terminals: Cmd+click opens link | Done |
| P394 | Code review, 1 round (Opus review, Sonnet fix) | Todo |
| P395 | Close chapter, open PR | Todo |

## Rows

### P388 ADE task list: calmer look, clear active-task marker, visible separators

ADE tasks view is busy and colorful; hard to focus on what is essential. Fix:

- Reduce color and visual noise; keep only what is essential.
- Add a clear visual indicator for the task open in the right panel.
- Make the separation between tasks more visible.

Result: plan `plans/P388.md`. Plan cards neutral: colour only on task status tag, red failures, amber needs-you/stale; task colour only as head dot. Task open in panel wears `border-focus ring-1` plus `aria-current`; head, branch row, span and history rows use `bg-select`. `Separator` (`ade-task-separator`) between tasks. `AdeTaskActionButton` gains `quiet`. Specs: geometry test rewritten, two new tests in `ade-v2-plan.spec.ts`. Checks: `bun run lint`, `typecheck` (pre-commit), `lint:dead` clean; `ade-` UI specs 314 pass; visual suite: only `ade-plan-branches` diffed, 4 baselines re-recorded (Inter font confirmed); screenshots re-run stable, 2 PNGs updated. `check-ui-primitives.sh` U37 exemptions added for `AdeBranchRow.vue`, `AdeDayBand.vue`. CodeGraph MCP unavailable. Follow-up: task card edge is `border-badge` (#616161, `border-strong` too close to `border`), open-task focus frame unchanged; branch-row repo badge wears repo colour again via `repoTint`, ADE fixture repos coloured.

### P389 ADE tightening: drop plan top bar, drop task toolbar, drop session bar

- Remove the plan top bar. Move its refresh-all button next to the project refresh controls.
- Task view: remove the top task toolbar. Move its buttons to the right end of the tab row (task, notes, …).
- Remove the session bar; the tab already shows its info. Keep the two missing items:
  - "x time ago" shown in a tooltip on the tab.
  - Tab right-click menu: copy session id.
- Tab right-click menu also gets restart: closes the session, then reopens it.

Result: plan `plans/P389.md`. Plan top bar gone: `AdePlanHeader` renamed `AdePlanRepos`, Refresh all at right end of repo row. `AdePanelFrame` drops `PanelHeader`; actions (`ade-panel-actions`) at tab row right end. `AdeSessionBar` and `AdeSessionId` deleted: session tab tooltip (`AdeSessionTabTip`, state and age) and right-click menu (`useSessionMenu`: Restart for running TUI, Copy session ID); Take over and Stop move to the tab row (`AdeSessionActions`). Go: `Tracker.Stop` (no grace wait) and `TaskBoard.RestartSession` (stop, close terminal, Take over), `AdeTaskService.RestartSession`, flow test `TestRestartSession`, contract `ade-session-restart.json`. i18n: `common.action.restart.label` replaces `docker.action.restart.label` (catalog rule C3). Checks: `lint`, `typecheck`, `lint:go`, `lint:dead` clean; Go ade/flows/bridge tests pass; `ade-` UI specs pass (2 new-spec fixes committed); visual: `branch-panel-details` re-recorded (Inter confirmed); screenshots re-run stable, 2 PNGs updated. CodeGraph MCP unavailable.

### P390 ADE git module last in order

Move the git module to the last position in the ADE module order.

Result: plan `plans/P390.md`. Space `MODE_ORDER` is now `ade, automations, memory, git` (`workbench/modes.ts`). Default start module stays `git` (`WindowModes.Default`); persisted mode is a name, so no migration; no numeric shortcuts exist. `modules.spec.ts` order test updated and asserts Git active at boot. Docs: `apps/kira-space/README.md`, `docs/ARCHITECTURE.md`. Re-recorded 3 framed shots (`space-agents-board`, `space-git-graph`, `space-memory`) and site `space-desktop`/`space-phone` baselines; all viewed, Git last. Checks: `typecheck`, `lint` clean; `test:ui:space` 746 pass; `test:visual:space` 20 pass, no diff; screenshots re-run stable. CodeGraph MCP unavailable.

### P391 Both apps: scrollbars hidden until pointer is in the panel

Studio and Space. Scrollbars hidden by default; shown only while the pointer is inside that panel. Like a modern app.

Result: plan `plans/P391.md`. `packages/theme/src/base.css` (pointer: fine): thumb colour rides `--kira-scrollbar-thumb`, transparent on every element (`:where(*)`), shown by `:where(:hover)`; `:active` keeps a dragged thumb shown. 12px gutter kept, no layout shift. `scrollbar-color`/`scrollbar-width` unused (they drop `::-webkit-scrollbar` styling in WebKit). Monaco, xterm untouched (own hover-reveal). Shared scenario `scenarios/scrollbars.ts` (3 tests: hover reveal and gutter, nested scroller, drag outside) run by both apps' `scrollbars.spec.ts`; fixed one test by moving the pointer after mouse up. Docs: `docs/ARCHITECTURE.md`. Checks: `typecheck`, `lint`, `lint:dead` clean; `test:ui:studio` 644 pass (incl. ui-timing); `test:ui:space` 749 pass; `test:visual:studio` 13 and `test:visual:space` 20 pass, no diff; screenshots re-run stable, 7 PNGs updated (4 framed, 3 detail), all viewed; `site:check` passed, Studio desktop and phone site baselines re-recorded (diff only the new shots). CodeGraph MCP unavailable.

### P392 Review others' PRs: approve and comment; agent panel button to far right

- Reviewing another person's work must allow approving the PR and leaving comments, same as for own PRs.
- Move the agent panel button to the far right.

Result: plan `plans/P392.md`. Cause: review target branch was a ref spelling (`origin/feat/x`, fork `<owner>/<head>`), so the PR lookup missed and no actions showed. `changeRequest.reviewState` looks up the host head name (origin prefix dropped) and takes optional `number`; contract 54 to 55, additive. `ReviewWindowTarget.changeRequest` carries the task link's PR number (covers forks). Kind `none` shows a disabled Review button with reason. `ade-review-toggle-agent` is the last title bar item. Flow `TestReviewForeignChangeRequest` + contract `ade-review-foreign.json`; `ade-host-link.json` unchanged. 4 UI specs in `ade-v2-review.spec.ts` (foreign, remote-only, none reason, far-right position). Docs: `docs/ARCHITECTURE.md`, `agents.mdx`. Checks: `typecheck`, `lint`, `lint:go`, `lint:dead`, `bun test packages/git-ipc`, Go tests (githost, gitsession, gitrpc, ade, adeflow, githostflow, coverage) clean; `test:ui:space` 753 pass; `test:visual:space` 20 pass, no diff; `site:check` 144 pass, no diff. CodeGraph MCP unavailable.

### P393 Terminals: Cmd+click opens link

In every terminal, Cmd+click on a link opens it.

Result: plan `plans/P393.md`. Cause: web-links addon default handler calls `window.open`, which does nothing in the Wails webview, and had no modifier check. `terminalRenderer.ts` now routes plain-text (`WebLinksAddon`) and OSC 8 (`linkHandler`) links through one `activate`: Cmd-click (mac) or Ctrl-click, http(s) only, via new `TerminalRendererDeps.openLink`/`linkActivation`. Hover hint shows target URL and modifier. Studio gets `control.openExternal`; lint U79 path moved to `bridge/index.ts`. Phone taps open via `window.open` noopener. No Go change, no contract bump. Flow `TestTerminalLinkOpen` (both apps) + contract `terminal-link.json`; shared UI scenario `terminalLinks.ts` (2 specs per app); phone spec. UI harness runs a mac UA, so specs use Meta. Hint hid via `hidden` class lost to tooltip `inline-flex`; now inline `display`. CodeGraph MCP unavailable.

### P394 Code review, 1 round (Opus review, Sonnet fix)

One round per `CLAUDE.md` "Code review". Base: last commit of v0.2.20 close (`6bd97b9a2`'s chapter content) to chapter HEAD; planner states exact base in the findings file.

### P395 Close chapter, open PR

Per `CLAUDE.md` "Closing a chapter". Tag `v0.2.21`.
