# v0.2.18

First phase `P357` (highest in `docs/HISTORY.md` is `P356`). Branch `chapter/v0.2.18`. Phases run top to bottom.

| # | Phase | Status |
|---|-------|--------|
| P357 | Review window diff shows hunks only. Today it renders entire files. Show changed hunks plus a few lines of context, collapse the rest. User asked for this before; verify against the real window, not just the code path. | Done |
| P358 | Review window: mark a folder reviewed (marks every file under it). Add next/previous change buttons and an inline/side-by-side diff toggle to the bar that holds go-to-file. | Pending |
| P359 | Skip the agent-finished notification while the app window is focused. | Pending |
| P360 | Terminal sessions (incl. Claude Code TUI): Cmd+Enter inserts a newline. TUI scroll too slow, match VS Code terminal scroll behavior. Darker terminal background, a dark grey from the app palette, not black. | Pending |
| P361 | Postman import: collection variables and environment values missing, only keys import. Import every value. | Pending |
| P362 | API module left panel: multiselect, drag and drop, delete of selection. | Pending |
| P363 | Code review, 1 round, over the full diff since the base (see CLAUDE.md). | Pending |
| P364 | Close chapter, open PR. | Pending |

## P357 Result

Cause: `useDiffEditor.ts` set `hideUnchangedRegions: { enabled: !review }`, so review diffs rendered whole files. Fix: enabled for review too (3 context lines, explicit). `reviewDecorations.ts` `revealCommentLines` selects each comment line; Monaco 0.56.0's cursor listener unhides it. Unhide runs contiguously from nearer region edge, so a comment mid-region shows more than 3 context lines (no public per-line API). Reruns on `onDidUpdateDiff`; alternates cursor column since the event fires only on primary-cursor move.

Tests: `TestReviewDiffLargeFileHunks` (flow, writes `tests/contract/git-review-hunks.json`), `ade-v2-review.spec.ts` "a review diff shows only the hunk and the commented line" (real review-window entry, webkit tier). `test:ui:space` 690 passed, `go test ./apps/kira-space/internal/flows/...` ok. Screenshot checked: lines 1-12 and 97-103 with comment glyph, "84 hidden lines" and "98 hidden lines" bars, unfold control reveals. Wails desktop build not runnable in Linux sandbox; Playwright webkit is closest real window.
