# v0.2.18

First phase `P357` (highest in `docs/HISTORY.md` is `P356`). Branch `chapter/v0.2.18`. Phases run top to bottom.

| # | Phase | Status |
|---|-------|--------|
| P357 | Review window diff shows hunks only. Today it renders entire files. Show changed hunks plus a few lines of context, collapse the rest. User asked for this before; verify against the real window, not just the code path. | Done |
| P358 | Review window: mark a folder reviewed (marks every file under it). Add next/previous change buttons and an inline/side-by-side diff toggle to the bar that holds go-to-file. | Done |
| P359 | Skip the agent-finished notification while the app window is focused. | Done |
| P360 | Terminal sessions (incl. Claude Code TUI): Cmd+Enter inserts a newline. TUI scroll too slow, match VS Code terminal scroll behavior. Darker terminal background, a dark grey from the app palette, not black. | Done |
| P361 | Postman import: collection variables and environment values missing, only keys import. Import every value. | Done |
| P362 | API module left panel: multiselect, drag and drop, delete of selection. | Done |
| P363 | Code review, 1 round, over the full diff since the base (see CLAUDE.md). | Done |
| P364 | Close chapter, open PR. | Done |

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

## P362 Result

Backend: `MoveItems` and `DeleteMany` (repo `collections_batch.go`, bridge `CollectionsService`) replace `MoveItem` and `Delete`; each is one transaction. Move places the batch in argument order under any parent of any collection, before `beforeId` or last, rewrites the target dense and re-indexes every parent left. A move into the item itself or a descendant, under a non-folder, or before a foreign sibling is refused as `invalidMove` (bad request, i18n) and changes nothing. Delete skips ids a cascade already covers; a missing id deletes nothing. One `kira:api:dataChanged` emit per call (tree plus a variables change per deleted collection).

Frontend: `workbench/behaviour/treePointerDrag.ts` extracted from `connectionReorder.ts`; both trees use it. `useListNavigation` gains `onExtend` (Shift+Up/Down/Home/End); shortcut `tree.selectAll`. New `useCollectionSelectionStore` (focus, anchor, key set) replaces `state.selected`; rows leave it when they leave the visible list. Click, Ctrl/Cmd toggle, Shift range, Shift+arrows, Ctrl/Cmd+A, Escape collapse. `api/collectionDrop.ts` holds drop zones, `topmost`, placement and refusals; collection rows never drag; before/after refused while searching. Right-click inside a multi-selection opens `menuForSelection` (move, "Delete N items"); `tree.delete` and Shift+F10 use it. Bulk delete asks one confirmation with per-kind counts, a nested note and an open-tabs note.

Deleted requests' open tabs stay open as unsaved (existing orphan rule: saved-request caches write `null` for every cascaded id); a deleted collection closes its variable-set tab.

Deviations from the plan: no `cursor-not-allowed` while dragging (lint U35 forbids it); drag badge uses the popover z tier; count labels reuse `studio.api.importReport.*` keys (catalog C3).

Tests: flow `TestBatchMoveDelete` (contracts `api-move-many`, `api-delete-many`; `api-move` removed), repo tests for move and reindex, unit `api-collection-drop.spec.ts`, UI specs for multi-drag plus bulk delete (contract half), set menu, keyboard, search refusal. `go test` storage, bridge, apiflow ok; `go vet ./internal/...` clean; unit 871 passed; `ui` project 610 passed (includes `connection-order.spec.ts`). Screenshot viewed: selection highlight, `into` ring on the target folder, drag count badge. Not run: desktop WKWebView build (Linux sandbox), so Cmd+A versus the macOS Edit-menu select-all role is unverified.

## P363 Result

Round 1 review (`plans/P363-review-r1.md`, base `b407b4e`): 8 findings, all fixed. R1-1: `revealCommentLines` restores the saved selections after the reveal. R1-2: new `postman.DecodeVariables` drives legacy promotion, so `enabled:false` skips and badly typed fields decode like a fresh import; a non-array `variable` now stays in origin. R1-3: `ReviewView` caches the ordered path list in a `computed`, `adjacentFile` is an index lookup, and the navigator map is `shallowReactive` so the next/previous buttons refresh. R1-4: `menuForSelection` takes the topmost count; the label is pluralised. R1-5: `CollectionsRepo.Delete` narrowed to `DeleteCollection`; item-delete tests use `DeleteMany`. R1-6: minimal fix, not a refcounted syncer. The syncer leans on per-entry state (life context, `hostRepo`, breaker), so one shared syncer needs owner handoff. New `crShared` on `Registry`: a per-key gate held from sync state read to write, shared pending-checks spacing, and index changes notify every entry on the key. Remaining cost: each entry still probes the host once per interval (ETag, cheap). R1-7: `MarkSent` failure after a successful send logs and returns the count. R1-8: `verify-packaging.sh` A6 fails under `CI=true` below SDK 26, both apps. Also fixed a failing pre-existing unit test: `graphChunkFrame.bin` carried contract version 51, patched to 52.

Tests: `crshare_test.go` (gate serialises read-write, key independence, context, peers), `go test -race ./internal/gitsession`. Unit 1957 pass. Playwright: `ade-v2-review*` and `repo-review-interaction` 60 passed, studio `collections.spec.ts` 14 passed. Go flows studio ok.

## P364 Result

Chapter folded by hand into `docs/HISTORY.md`. `docs/v0.2.18/` removed. PR opened from `chapter/v0.2.18` to `main`.
