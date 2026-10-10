# P257 result

Line counts and the list `isBinary` flag are gone from the git module. Status indicators (kind letter, rename
original path, similarity) are unchanged, still from `--name-status`. Defaults D1-D6 taken.

Commits: Go file lists, `ContractVersion` 48 and fixtures; git-ui, git-ipc and ADE frontend; docs.

## What changed

- `FileChange` (Go, git-ipc, git-core) loses `additions`, `deletions`, `isBinary`. ADE wire `FileChange` is `{path}`.
- `NumstatArgs`, `WorkingNumstatArgs`, `StashShowArgs`, `CombineFileChanges`, `NameStatusEntry` deleted.
  `ParseNameStatusRecords` returns `[]FileChange`. A name-status row without a numstat row now shows.
- `fileChanges` is one name-status spawn (no errgroup). Preflight stash paths use `--name-status`.
- Stash list and global stash log keep `--numstat` for record framing (D2). `NumstatEntry` keeps paths only.
- `ContractVersion` 47 to 48 (Go, TS, `docs/ARCHITECTURE.md`). ADE wire has no version (P143 freeze).
- FileTree: directory row keeps `N files`; `+x -y` and per-file counts removed. `countFormat` deleted.
- ADE Changes tab: delta column removed, path only.
- Fixtures: `git-commit-detail.json`, `ade-base.json`, `ade-review-open.json` lost the count keys only.
  `git-path.json` regenerated too: its `contractVersion` was stale (46) and is now 48.
- `FileChange` in `ade/v2/wire.ts` is no longer exported (knip).

## Gaps in the plan

- `git-path.json` is a fourth regenerated fixture (version-derived).
- `mixed.numstat.bin` and the three `workingDiff/*.numstat.bin` fixtures were orphaned and deleted; the
  stash-list framing test keeps `renameWithEdit.numstat.bin`, now captured by a literal argv in the test helper.
- Plan listed `board.json`/`add-existing-branch.json` under `tests/fixtures/ade-v2`; both edited by hand.
