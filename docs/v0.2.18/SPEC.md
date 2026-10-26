# v0.2.18

First phase `P357` (highest in `docs/HISTORY.md` is `P356`). Branch `chapter/v0.2.18`. Phases run top to bottom.

| # | Phase | Status |
|---|-------|--------|
| P357 | Review window diff shows hunks only. Today it renders entire files. Show changed hunks plus a few lines of context, collapse the rest. User asked for this before; verify against the real window, not just the code path. | Done |
| P358 | Review window: mark a folder reviewed (marks every file under it). Add next/previous change buttons and an inline/side-by-side diff toggle to the bar that holds go-to-file. | Done |
| P359 | Skip the agent-finished notification while the app window is focused. | Done |
| P360 | Terminal sessions (incl. Claude Code TUI): Cmd+Enter inserts a newline. TUI scroll too slow, match VS Code terminal scroll behavior. Darker terminal background, a dark grey from the app palette, not black. | Done |
| P361 | Postman import: collection variables and environment values missing, only keys import. Import every value. | Done |
| P362 | API module left panel: multiselect, drag and drop, delete of selection. | Pending |
| P363 | Code review, 1 round, over the full diff since the base (see CLAUDE.md). | Pending |
| P364 | Close chapter, open PR. | Pending |

## P357 Result

Cause: `useDiffEditor.ts` set `hideUnchangedRegions: { enabled: !review }`, so review diffs rendered whole files. Fix: enabled for review too (3 context lines, explicit). `reviewDecorations.ts` `revealCommentLines` selects each comment line; Monaco 0.56.0's cursor listener unhides it. Unhide runs contiguously from nearer region edge, so a comment mid-region shows more than 3 context lines (no public per-line API). Reruns on `onDidUpdateDiff`; alternates cursor column since the event fires only on primary-cursor move.

Tests: `TestReviewDiffLargeFileHunks` (flow, writes `tests/contract/git-review-hunks.json`), `ade-v2-review.spec.ts` "a review diff shows only the hunk and the commented line" (real review-window entry, webkit tier). `test:ui:space` 690 passed, `go test ./apps/kira-space/internal/flows/...` ok. Screenshot checked: lines 1-12 and 97-103 with comment glyph, "84 hidden lines" and "98 hidden lines" bars, unfold control reveals. Wails desktop build not runnable in Linux sandbox; Playwright webkit is closest real window.

## P358 Result

Folder mark: new request `review.markMany` (whole files, many paths), contract 51 -> 52 additive. `gitsession` `MarkFiles` resolves the branch tip once, then marks each path under its own lock via `markFileAt` (`MarkFile` unchanged). Paths dedupe in first-seen order; a mid-batch error keeps earlier writes and `ReviewFilesState.markMany` reloads the list. Transport repaint event carries `paths`. Tri-state in `lib/folderReview.ts`: all full true, all none false, else mixed (partial counts as some). Scope is the filtered tree under the row. Click on true unmarks every touched file; else marks the rest.

Next/previous change: `diffNavigation.ts` keeps its own index over `getLineChanges()`, not `goToDiff` (wraps, cannot report the last change). Past the last or first change it opens the review list's adjacent file (`adjacentFile` on `onReviewApi`, order of the shown tree or flat list) via Pinia `reviewNavigation`, landing on first or last change. Buttons stay off until the diff is computed. Review tabs show the bar in binary/too-large/missing states so crossing still works.

Layout toggle: `kira.repo.diffLayout` (`usePersistedState`, per device), all repo diff editors follow it.

Tests: `TestReviewMarkFolder`, `TestReviewNavigationFiles` (contracts `git-review-folder.json`, `git-review-nav.json`); `ade-v2-review.spec.ts` "a folder checkbox marks every file under it", "next and previous change walk hunks and cross files", "the diff layout toggle switches to inline and persists". Go flows ok. `test:ui:space` 692 passed, 1 failed: the nav test raced the diff compute; fixed (ready gate), then 72/72 on 3x8 repeats. Screenshots checked. Linux webkit tier only; desktop WKWebView build not run.

## P359 Result

Finished notes (`KindFinished`) skip while any app window, review windows included, is the macOS key window. `WindowRegistry.AnyFocused` probes native `IsFocused` outside `r.mu`. `agentnotify.notifyTerminal` calls the new `Deps.AppFocused` before taking `n.mu`; a skipped note burns no cooldown. Dead `Deps.Focus` removed. `appwire` holds the probe in an `atomic.Pointer` (hook goroutine reads, `BindShell` writes); `ShellHooks.AppFocused` overrides it. Other kinds keep the per-window tab rule from `ReportFocus`. No renderer, contract or i18n change.

Tests: `TestFocusedAppSkipsFinished` (new), `TestFocusedTabSuppresses` now on needs-input, proves app focus does not suppress it. `go test -race` notifyflow and shell ok, `go test ./apps/kira-space/internal/flows/...` ok. No frontend half: renderer and IPC unchanged.

Not verified on desktop: `isKeyWindow` reads only on macOS Wails; Linux sandbox cannot run it. Known edge: screen locked with Kira Space frontmost keeps the window key, so finished notes skip while user is away.

## P360 Result

Every terminal (repo, Automations, Docker exec, ADE pane, phone) builds through `terminalRenderer.ts`; one edit covers all.

Cmd+Enter: `attachCustomKeyEventHandler` sends `ESC CR` (xterm's own Alt+Enter bytes) via `term.input`, swallows all events of the chord, calls `preventDefault`. Cmd+Shift+Enter and plain Enter untouched. `check-ui-primitives.sh` gets a permanent U41 exemption for `terminalRenderer.ts` (xterm engine host).

Scroll: xterm sends one wheel report per DOM event, same as VS Code. Gap is Claude Code: without XTVERSION or `TERM_PROGRAM=vscode` it scrolls 1 row per report. `sessionEnv` now sets `CLAUDE_CODE_SCROLL_SPEED=3` unless already set; `scrollOnEraseInDisplay: true` added (VS Code parity). Declined: `TERM_PROGRAM=vscode`, XTVERSION answer, wheel repeat, xterm 6.1 beta (reasons in `plans/P360.md` §2.2).

Background: terminal theme and `TerminalHostView` frame use `--kira-bg-chrome` (`#181818`, VS Code Dark Modern panel). No new token.

Tests: `repo-workspace.spec.ts` "Cmd+Enter in a terminal sends meta-Enter (ESC CR); plain Enter stays CR" (new; checks `Gw0=` then `DQ==`). Terminal specs 3/3 pass. No backend test: env entry is a constant. Frame computed `rgb(24, 24, 24)`.

Only user can verify on real macOS: Cmd+Enter in Claude Code (repo terminal, ADE pane, review flow) inserts a newline and does not submit; in Kira Studio it does not fire the "Run statement" menu item (WKWebView forwarding after `preventDefault`); zsh continuation line; Claude Code fullscreen scroll feel with trackpad and wheel versus VS Code (hard flicks accelerate less; next lever is user's `CLAUDE_CODE_SCROLL_SPEED`); background shade on a real display.

## P361 Result

Leading suspected cause, outside this app: Postman exports empty values for non-shared variables. Since its September 2025 variables model a value is local by default, and only a value the user shared is written to `value`. An unshared variable exports as the key with `"value": ""`. That matches the report: keys present, values missing, "some" in environments. The app cannot import a value the file does not contain. Not an app bug. The user's own export was not checked (none in the repo); if one has non-empty `value`s that fail to import, that is a separate bug.

New warning `empty_values` (collections and environments): "{count} variables arrived without a value. Postman exports only shared values; share them in Postman, then export again." Counts imported entries whose value is `""`; disabled entries never count. Counts only, no value text logged.

In-app gaps fixed: G1 object and array `value` imported as `""`, now compact JSON. G2 Postman API envelopes `{"collection":...}` and `{"environment":...}` were refused, now unwrapped (one level, `unwrapAPIDocument`). G3 collection `variable[]` ignored `disabled: true`, now skipped and counted `disabled_variables`. G4 legacy promotion in `repos/variables.go` had its own scalar decode (`scalarString`), now `postman.VariableValue`, and skips `disabled: true`. Collection and environment parsers share `decodeVariableEntry`. `docs/ARCHITECTURE.md` updated.

Tests: `TestDecodeVariableEntry` (new, both paths), `TestParseFile` extended (wrappers, negatives, counts), `apiflow.TestPostmanImportCollectionAndEnvironment` extended (values via `VariablesService.List`, both warnings, wrapper file; contract `api-postman-multi` regenerated), `collections.spec.ts` "Postman import of a collection, an environment and a bad file" asserts `empty_values` lines. `TestPostmanImportSendExport` green with no fixture edit. Out of scope: globals, Collection v2.0, full data dump, folder-level variables.
