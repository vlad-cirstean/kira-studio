# P147 Stream B notes

Base `7f40cbb5`, branch `v2.0-p147-b`. Frontend only: Workflows page, Repos page, run UI, worktree setup UI.

## Commits

```
e0414311 fix(kira-space): align ade v2 workflows, repos and run UI with the mockup
3e22874a test(kira-space): ade v2 workflows, repos and run UI specs
39084f8c feat(kira-space): ade v2 worktree setup UI
a4b80229 feat(kira-space): ade v2 run dialog and stage actions
2d75288a feat(kira-space): ade v2 panel workflow block, run lines and logs
a474e55c feat(kira-space): ade v2 repos page
8410cbde feat(kira-space): ade v2 workflow form editor
d0a5c3a6 feat(kira-space): ade v2 workflows page list, YAML mode and import
```

## Mockup comparison (§6.3)

Chromium 1440x900, mockup vs built test app on mock runtime. Shots: Plan with `T_bill`, `T_push`,
Workflows Form and YAML, Repos, `b_searchui` Details, Run dialog. Images in session scratchpad, not
committed.

Fixed after comparison:
- Stage number reads `1.` not `1`.
- Workflow name input 13px, not 20px.
- Stage and step remove buttons: neutral border, red glyph (was red-outlined).
- Stage type select min width 124px.
- Session toggle orange (Claude solid), folder watch toggle green.
- Repos heading lost its top border.
- Env remove button neutral border, red glyph.
- Run dialog: terminal icon in title, orange `Run in background` button.
- Branch panel chip reads `preparing` / `setup failed` (no glyph, no elapsed time).

Left as is (accepted): `Take over`, `▶ <Stage>`, `▶ Start`, Archive (R22); Sessions tab, Needs you
(P148); no "create a branch" lines, suffix read-only (R24); Import as path field (R25); `Allowed tools`
field (R26); app fonts; repo chip colours and run states differ because fixtures differ from mockup data.

## Deviations

- `onAdeTaskRuns` caller lives in `ade/queries.ts` (signal installer), not under `ade/v2/`.
- `useTaskAction` returns no action for `takeOver`, `stage`, `start`, `archive`; a failed action selects the task and shows the error in the panel header.
- Allowed tools stays a single-line input; comma separated (newline split kept in the pure parser).
- Run dialog open state: `adeBoardUi.runTaskId`; one dialog mounted in the shell.
- Step `Retry` and header `Retry` both call `RetryRun` per failed or stuck latest run.
- Copy YAML spec asserts the `Copied` label; WebKit has no `clipboard-write` permission to grant.
- Specs use a throwaway Chromium script for the mockup check; it is not committed.
