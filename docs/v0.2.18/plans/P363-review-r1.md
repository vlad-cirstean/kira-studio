# P363 code review, round 1

Base: `b407b4e` (v0.2.14 squash). It holds the last review session: P342 round 1 (base `ac9b371`), all fixed. v0.2.15, v0.2.16 and v0.2.17 had no review. Scope: `b407b4e..ba5192f`, 264 files, about 10.4k insertions.

Discovery: CodeGraph MCP server failed to connect all session (`codegraph` executable not found in `$PATH`). `ToolSearch "codegraph"` returned no tool. Tracing used Grep, Read and `git diff`.

## Coverage

Covered in full: this chapter's P357-P362 source diff `d281527..HEAD` (83 files). Areas read:
- P357/P358 review diff: `useDiffEditor.ts`, `reviewDecorations.ts`, `diffNavigation.ts`, `diffLayout.ts`, `RepoDiffView.vue`, `reviewNavigation.ts`.
- P358 batch mark and folder state: `review.markMany` end to end (`gitrpc/incremental.go`, `gitsession/incremental.go`, `reviewFiles.ts`, `transport.ts` repaint), `folderReview.ts`, `FileTree.vue`, `fileTreeModel.ts`.
- P359: `AnyFocused`, `AppFocused` atomic wiring, notifier.
- P360: terminal key handler, `CLAUDE_CODE_SCROLL_SPEED`, U41 exemption.
- P361: `decodeVariableEntry`, `unwrapAPIDocument`, `VariableValue`, empty/disabled warnings, legacy promotion.
- P362: `collections_batch.go`, bridge `MoveItems`/`DeleteMany`, `collectionDrop.ts`, `collectionSelection.ts`, `collections.ts` store, `CollectionsTree.vue`, `CollectionRow.vue`, `menu.ts`, `treePointerDrag.ts`, `connectionReorder.ts`, `listNavigation.ts` extend keys, `hasOpenRequestTab`.

Sampled only: v0.2.15-v0.2.17 (`b407b4e..d281527`, 189 files). Read `gitsession/crsync.go` in full and the `github/sync.go` batching. No finding there. The rest of those chapters, including `displayOrder.ts`/`rowPlan.ts`, ADE review agent and window focus, was not reviewed line by line.

Checked and found sound: MoveItems cycle and descendant guards, cross-collection subtree move, dense re-index of left-behind parents. Also DeleteMany cascade skip and all-or-nothing missing id. Also the frontend `topmost`/`placementFor`/`isNoop`, selection pruning on visible-key change, and Escape ordering between drag and selection collapse. Also `treePointerDrag` against the old connection reorder: same tolerance, auto-scroll, cancel and click swallow. Keyed virtual rows keep the pressed element's `dataset`, so no regression. Also MarkFiles lock per path and tip resolved once, `AppFocused` probe outside `n.mu`, and the persisted layout ref cached in a detached scope.

Counts: High 0, Medium 1, Low 4. Performance found nothing beyond R1-3.

## Findings

### R1-1 Medium: comment reveal overwrites user selection on every reload
`apps/kira-space/frontend/src/views/repo/reviewDecorations.ts:419` (`revealCommentLines`), called from `:460` (`loadComments`) and `:659` (`onDidUpdateDiff`).

Failure: a review file has at least one comment. The user selects lines 40-55 in the modified editor. Before they pick "Mark reviewed" from the context menu, a repaint lands. The repaint comes from the Comments pane, another tab or the review agent adding a comment, which runs `loadComments`, or from a mark, which runs `loadDiff` and then `onDidUpdateDiff`. `setSelections`/`setSelection` collapse the selection to a caret on the first comment line. `currentSelectionRange()` (`:495`) then marks that one line, not 40-55. Keyboard cursor position also jumps to the first comment after every own mark.

Fix: save `getSelections()` before the reveal and restore it after. Restore through `setSelections` with the saved ranges, so the hidden-region feature still sees the comment lines first. An alternative is to reveal only on the first load and on a diff update after a model change. Never reveal on a comment-only reload while the user has a non-empty selection.

### R1-2 Low: legacy variable promotion diverges from fresh import
`apps/kira-studio/internal/storage/repos/variables.go:1143` (`promotedVariableRow`), `:1202`.

Failure 1: a legacy `origin_json` entry with `"enabled": false` gets promoted. A fresh import of the same file skips it (`decodeVariableEntry` honours both `enabled:false` and `disabled:true`).

Failure 2: the strict struct decode fails for the whole array when one entry has `"disabled": "true"` or a non-string `type`. The new `Disabled bool` field adds this failure mode. The code then logs, sets entries to nil, still deletes `variable` from origin and commits. Every collection variable is lost.

Fix: export one entry decoder from `internal/postman` (for example a `DecodeVariableEntries(raw)` wrapping `decodeVariableEntry`) and use it here. The JSON-shape rules then stay in one place. Also, never drop `origin["variable"]` when decoding failed.

### R1-3 Low: cross-file adjacency rebuilds the tree on each read and goes stale
`apps/kira-space/frontend/src/views/repo/RepoDiffView.vue:65` (`hasAdjacentFile`), `packages/git-ui/src/components/review/ReviewView.vue:382`, `packages/git-ui/src/lib/fileTreeModel.ts` (`orderedFilePaths`).

Failure: each `canNext`/`canPrevious` evaluation runs a full filter, tree build and flatten. That happens twice per `navTick`, which bumps on every diff update and every change step. Cost is O(n log n) for a large review list. The navigator is not reactive, so the buttons go stale until the next tick when filter, list mode or file list change. Example: a restored diff tab mounts before the list loads, so "next change" stays disabled at the last change of the file.

Fix: keep the ordered path list as a `computed` in `ReviewView` over files, filter and listMode. Answer `adjacentFile` by index lookup in it. Let the host subscribe to a change callback, or bump `navTick` from `onReviewApi`, so the buttons refresh when the order changes.

### R1-4 Low: multi-select delete label counts nested rows
`apps/kira-studio/frontend/src/api/menu.ts:77`.

Failure: the user selects collection C and request R inside it. The menu reads "Delete 2 items". The confirm dialog then uses `planDelete().top` and asks "Delete collection C?", one row. The label and the action disagree.

Fix: pass the topmost count to the label. Either `menuForSelection` takes `topmost(rows, items)`, or `CollectionsTree` passes `planDelete(rows).top.length`.

### R1-5 Low: item branch of `CollectionsRepo.Delete` has no production caller
`apps/kira-studio/internal/storage/repos/collections.go:465`.

Failure: after P362 the only production caller is import rollback, with target `"collection"` (`bridge/collections.go:500`). The item path keeps its own sibling re-index, duplicating `DeleteMany`, and only tests use it (`collections_test.go:67`, `:112`). Two delete paths can drift apart.

Fix: narrow it to `DeleteCollection(id)`, or route rollback through `DeleteMany([]string{id}, nil)`. Move the item-delete tests onto `DeleteMany`.
