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

Second pass, v0.2.15-v0.2.17 (`b407b4e..d281527`, 194 files): every non-test source file read in diff. Areas:
- Change request sync (P352): `gitsession/crsync.go`, `entry.go`, `registry.go`, `subscriber.go`, `changerequests.go`; `githost/github/sync.go`, `graphql.go`, `errors.go`; `storage/repos/githostchangerequests.go`; migrations 0047-0049; `gitrpc/changerequests.go`, `handlers.go`, `contract.go`, `wire.go`; `appwire`; git-ipc `contract.ts`/`validate.ts`; git-ui `changeRequests.ts`, `App.vue`, `repoScopedReload.ts`, `repo.ts`; every `repo.changed` subscriber checked against the new `changeRequestsChanged` kind.
- Graph order (P347): `porcelain/log.go` `--date-order`, `gitsearch/scan.go`, `displayOrder.ts`, `rowPlan.ts`, `lanes.ts`; fork-stub removal in `CommitGrid.vue`, `rowSvg.ts`, `graphColumn.ts`, `columns.ts`, `hitTest.ts`.
- ADE: `review_agent.go`, `review.go`, `board_writes.go`, `board_facts.go`, `gitfacts.go`, `storage/repos/adetask.go`, `bridge/adetask.go`, `adewire`, `llmprompts/registry.go`; frontend `AdeReviewAgentPanel.vue`, `AdeAddPopover.vue`, `AdeEstimateField.vue`, `AdeBranchPanel.vue`, `AdeTaskPanel.vue`, `AdeTaskTab.vue`, `AdeBranchRow.vue`, `AdeBasePicker.vue`, `AdeReviewFiles.vue`, `AdeStepBlock.vue`, board `actions.ts`/`rebaseActions.ts`/`catalogParts.ts`/`reviewCode.ts`/`baseMarker.ts`/`changeBase.ts`, `dialog/flow.ts`, `adeDialogs.ts`, `adeReviewWindow.ts`, `wire.ts`, `queries.ts`; git-ui `ReviewView.vue` `lockTarget`, `main.ts`.
- Shell and UI: `shell/registry.go` focus, `timing.ts`, theme `BranchChip.vue`/`VarText.vue`/`varText.ts`, `ToolbarSeparator.vue` and the Studio toolbar swaps, `AppToolbar.vue`, `blameLine.ts`, `reviewAnchor.ts`.
- Packaging (P346/P349): workflows `macos-26`, plists, both darwin `Taskfile.yml`, `install.sh`, `verify-packaging.sh`, `check-ui-primitives.sh`, `.gitignore`s.

Not read line by line, by choice: tests and test harness (`*_test.go`, `*.spec.ts`, `tests/`, `flowharness/harness.go`, `fakehost/fakehost.go`), `bun.lock`, `en.json` copy, `icon.json`/SVG assets, `site/` docs, READMEs, `CLAUDE.md`, deleted files (`AdeChangesTab.vue`, `AdeReviewCompose.vue`, `hitTest.ts`) beyond checking no caller is left. None ships behaviour a review dimension covers.


Checked and found sound: MoveItems cycle and descendant guards, cross-collection subtree move, dense re-index of left-behind parents. Also DeleteMany cascade skip and all-or-nothing missing id. Also the frontend `topmost`/`placementFor`/`isNoop`, selection pruning on visible-key change, and Escape ordering between drag and selection collapse. Also `treePointerDrag` against the old connection reorder: same tolerance, auto-scroll, cancel and click swallow. Keyed virtual rows keep the pressed element's `dataset`, so no regression. Also MarkFiles lock per path and tip resolved once, `AppFocused` probe outside `n.mu`, and the persisted layout ref cached in a detached scope.

Counts: High 0, Medium 2, Low 6. Performance: R1-3 and R1-6.

Second pass, also sound: GraphQL partial errors with data, checks batching at 50, 404 to `gone` to drop, prune-once ordering, subscriber coalescing of the new kind, every git-side `repo.changed` listener ignoring `changeRequestsChanged`, `--date-order` keeping children before parents for lanes and scan prefix, repoless task start guard, `Day` validation, unnamed-task guard, `InvokeSync` unhide, archive confirm only when nothing is at risk.

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

### R1-6 Medium: one change request syncer per RepoEntry, many per repo key
`apps/kira-space/internal/gitsession/entry.go:212` (`newCRSyncer` per entry), `crsync.go:418` (`SyncState` read in `prepare`), `:450` and `:529` (`PutSyncState`).

Failure: a linked worktree is its own RepoEntry (`registry.go:265`). Two clones of one remote also share a repo key (`provider|host|owner/name`). Open main checkout plus two worktrees: three syncers run on one key. Each runs its own backfill, delta probe and 2-minute pending-checks refresh, so host calls triple and rate-limit sooner. Each reads `git_host_sync_state` at run start and writes it back whole. Syncer A advances the watermark and cursor; syncer B, started earlier, then writes its stale state over it. The next run re-walks pages already read, or restarts a backfill. Each syncer also fires `changeRequestsChanged` only to its own entry's subscribers, so the badge refresh differs per window.

Fix: own one refcounted syncer per repo key on `Registry`; entries attach and detach. Fan `noteChangeRequests` out to every attached entry. Minimum fix: a per-key mutex around a run, with state re-read under it before each `PutSyncState`.

### R1-7 Low: forward reports failure after the comments were sent
`apps/kira-space/internal/ade/review_agent.go:172-180` (`ForwardReviewComments`).

Failure: `tr.Send` pastes the comments into the agent. `store.MarkSent` then fails (DB busy, disk full). The call returns an error, the panel shows it, and the comments stay `open`. The user clicks Forward again and the agent receives the same comments twice.

Fix: treat a `MarkSent` failure after a successful send as success with a logged warning, and still return the count. Or stamp first inside a transaction and roll back if `Send` fails.

### R1-8 Low: packaging A6 stays a soft note on CI
`scripts/verify-packaging.sh:274`, `:376`.

Failure: A6 fails only when the linked SDK is 26 or later; below that it prints a note and passes. Its comment says the soft path holds "until the runner is macos-26". This range moved all three workflows to `macos-26`, but the soft path stayed. If CI ever links an older SDK (image drift, pinned Xcode), the release ships binaries with `minos 14.0` under an `LSMinimumSystemVersion 26.0.0` plist, and verify passes.

Fix: fail A6 when the SDK is below 26 under `CI=true`. Keep the note for local runs only. Update the comment.
