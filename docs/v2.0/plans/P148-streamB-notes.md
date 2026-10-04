# P148 Stream B notes

Frontend stream. Base `4dc1d3fb`, branch `v2.0-p148-b`.

## Commits

```
51440752 feat(kira-space): ade v2 Claude dialog machinery and rebase / queue after dialogs
ecd0f97b feat(kira-space): ade v2 merge dialog, fix menu and merge buttons
d59141b3 feat(kira-space): ade v2 Sessions tab and Take over
6180d78c feat(kira-space): ade v2 stage and start launches, task actions and attention targets
1c6049b1 feat(kira-space): ade v2 task archive dialog and archived sessions
6378a398 feat(kira-space): ade v2 Needs you page and all sessions
a6e001ee feat(kira-space): headless setting sources switch saves with the settings dialog
ecaefe98 chore(kira-space): drop ade v2 knip entries
30896a81 test(kira-space): ade v2 dialog specs
39687844 test(kira-space): ade v2 sessions specs
9c1136b3 test(kira-space): ade v2 launch specs
d5b3d83b test(kira-space): ade v2 archive specs
7784c881 test(kira-space): ade v2 needs-you specs and board parity cases
bbfd511d fix(kira-space): align ade v2 sessions, needs-you and dialogs with the mockup
```

Tests landed as five spec commits, not one: each spec file committed as it passed (resumability).
The mockup fix commit and this file close the stream.

## Mockup comparison (§6.3)

Chromium 1440x900 mockup against the built test app on the mock runtime (webkit, per the UI
project). Screens compared: Needs you and All sessions, task Sessions tab (headless stuck with log,
TUI tab, Finished / stopped), branch header actions, fix menu on `b_auth`, Details `Merged into`
with Merge / Re-merge, Re-merge, Rebase, Queue after, stage, start and archive dialogs.

Defects found and fixed:

- Dialog target chips sat right of the branch name in grey. Now own line, selected chip in the Claude tone.
- Push switch lacked the `(off: stays local, push it yourself later)` suffix.
- Busy alert: title not bold, Override below the rows. Now Override at right, rows monospace.
- Archive risk was a boxed alert; now amber text with the mockup sentence. `Delete anyway` was a
  left-aligned solid button; now red outline next to Cancel.
- Dialog title weight.
- TUI status bar lacked the age (`interactive · needs input · 4m ago`).
- Session strip showed a scrollbar.

Accepted differences:

- `Stop` button (R15), shared context-menu look (R20; the menu wraps `Re-merge into develop (stale)` near the right edge), real xterm in the TUI pane, Take over confirm (D3), app fonts.
- Fixture data: task titles show the Jira key (`PAY-102`) where the mockup shows the title; extra running TUI `tk01`; no mockup `waiting on CI` count (D9); `took 1m 12s` sits under the text rather than in the age column.
- Needs you order follows SPEC2 section 11 rank (stuck, failed, question, approval, setup failed, stale merge); the mockup lists `setup failed` first.
- All sessions filter labels `Running` / `Stopped` per R19; the mockup says `Active` / `Older`.
- Headless branch dialogs show the single alert `A background run is active on <branch>. Stop it in Sessions, or wait.` (R-decision), not the mockup's busy list.

## Deviations

- R15: `Stop` on the headless status bar (SPEC2 shows none). Gives `StopRun` its caller.
- R20: fix menu uses the shared context-menu primitive, not the mockup's bespoke popup.
- `archive/useArchive.ts` from the plan's file list not created: the flow lives in `dialog/flow.ts` (`requestArchive`, `deleteAnyway`) beside the other sends.

## Mock runtime

`terminal:open` needed a default `{ shell }` answer in `adeV2Control`; without it the mock 422s,
`openLaunch` throws and the flow cancels its turn watch.

## CodeGraph

`codegraph_explore` calls in this stream's implementer sessions: 0. Work was executing named fixes
from the plan, not discovery.
