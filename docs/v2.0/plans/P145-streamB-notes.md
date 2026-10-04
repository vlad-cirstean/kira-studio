# P145 Stream B notes

Base `B0` = `13e99974`. Branch `v2.0-p145-b`. No wire change needed.

## Commits

1. `d0a5338d` board queries, `adeBoardUi` store
2. `c9081185` shell, tab bar, capture box; `installAdeSignals` gains v2 board + credential pushes
3. `33f59cae` task cards, branch rows
4. `19552296` plan timeline, drag, load all, history; `dropPlan` unit spec
5. `045d0af8` Add popover, Force push dialog
6. `1b3d8f71` delete v1 frontend, specs, mock entries; colour allowlist pruned
7. `3433d487` UI specs (plan, add, force-push) + mock runtime `AdeTaskService`
8. Two fixes found by the specs and the mockup pass:
   - `caacec63` SortableJS only drags direct children of its list, so one list per day band.
   - `db22c64c` view root `h-full` (Plan did not scroll in the window); branch rows get the mockup's progress line.

## End checks

- `bun run test:unit`: 1727 pass.
- `bun run typecheck`, `bun run lint` (incl. `check-ade-colours`): clean.
- `bun run test:ui:space`: 59 pass (webkit) before the last fix; `ade-v2*` 16 pass after it.
- `bun run lint:dead`: NOT clean, nothing left in Stream B files:
  - `@tiptap/*` (6) unused: only the deleted notes editor used them. `package.json` is not B's.
  - 11 unused exported types in v1 `ade/wire.ts` (`AdeSession` ... `AdeBranchMetaPatch`). `wire.ts` is A's, goes at P148.
  - Closing needs: drop `@tiptap/*` from `package.json` (restore with the notes editor in P146), and
    `ignoreExports`/entry for `ade/wire.ts` until P148.
- knip dry run with `src/ade/v2/wire.ts` and `src/ade/v2/board/*.ts` removed from `knip.json` entries:
  NOT safe. 14 exports and 83 types in `board/*.ts` and `v2/wire.ts` have no UI caller yet
  (steps, deployments, integrations, needs-you items: P146+). Keep both entries until those waves land.
- `lint:go` not run (no Go touched).

## Deleted for later (restore with `git show B0:<path>`)

Under `apps/kira-space/frontend/src/ade/`: `AdeNotesEditor.vue`, `notesExtensions.ts`,
`AdeEstimateField.vue`, `AdePanelResizeHandle.vue`, `AdeChangesTab.vue`, `AdeActivityIcon.vue`,
`AdeActivityGlyph.vue`, `activity.ts`, `AdeClaudeDialog.vue`, `dialogCompose.ts`, `dialogFlow.ts`,
`launch.ts`, `turnWatch.ts`, `AdeConfirmDialog.vue` (v2 has its own generic `v2/AdeConfirmDialog.vue`),
`AdeDetailPanel.vue`, `AdeDetailsTab.vue`, `AdeAgentsTab.vue`, `AdeAllAgentsView.vue`, `AdeAllAgentsRow.vue`.
Also `tests/unit/ade-notes-markdown.spec.ts` (with `notesExtensions.ts`).
v1 push channels `kira:ade:sessions`, `kira:ade:repo`, `kira:ade:open-session` and the
`onAgentEvent` turn watch have no subscriber now. Cross-window Open (FocusSession) is dead until P147.
Everything else v1 under `ade/` and `ade/state/` is gone; kept: `AdeView.vue`, `queries.ts`, `wire.ts`,
`state/agentSessions.ts`.

## Mockup comparison (§6.3)

Real Chromium 1194, 1440x900. Mockup: `docs/v2.0/design/ade-v2/mockup.html` with Vue served from
`node_modules`. App: `build:test:space` + mock runtime on `board.json`, clock fixed to Tue 2026-09-22,
T_bill selected. Throwaway scripts, not committed. Images (scratchpad):
`/tmp/claude-0/-home-user-kira-studio/d44f5205-cc3e-52b8-b56f-c8f106d4670f/scratchpad/shots/`
`mockup-plan.png`, `app-plan.png`, `app-plan-2.png`, `app-plan-3.png` (app shots predate the 7x5 segment fix).

Match: ruler (day, hours, today dot, weekend hatch), first-10 cap and "Load all", "Load history" strip,
card box (10px radius, 4px task edge, 68px header, 10px gap, 600px max), header facts, two-line clamped
title, left tag column, branch rows (repo chip, base marker, owner pill, name, own progress line),
continuation rows, overflow strip, Refresh all and repo chips.

Defects found and fixed: Plan did not scroll in the window; branch rows lacked the progress line
(dots first, then 7x5 bars per the mockup).

Remaining differences, all accepted or data:
- No panel, no stage action buttons (F11), no Rebase/Queue after (U1a), no line-2 merged/deployed chips,
  only the Plan tab, app fonts.
- Fixture data differs from mockup data: titles fall back to the Jira key, no `!` attention circle
  (no stuck run with a question), review item R_sara sits past the first 10.
- "On merge" ripple line sits in the Plan header (mockup shows it in the panel).

## Deviations

- `useTimelineDrag.ts` and the other v1 helpers were rewritten as v2 files, not `git mv`-ed, so no
  moved file ever imported v1 `ade/wire.ts`. Same contents where the logic carried over.
- Pull-to-open history gesture (`useHistoryPull`) not ported; "↑ Load history" button only.
- Force push dialog and the day-off prompt share one `v2/AdeConfirmDialog.vue` (run resolves with an
  error message to stay open).
- `adeBoardUi.historyReach` (in-memory) added so "Go to" a past date can extend the history window.
- `codegraph_explore` calls in this stream: 1.
