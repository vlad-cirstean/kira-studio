# P257 plan: drop git line add/remove counts

Ask (user, SPEC row P257): per-file and per-commit added/removed line counts in the git module
are noisy and useless. Remove them from UI. Stop `git ... --numstat` spawns whose only purpose
was those counts. Hard constraint: keep per-file status indicators (kind letter for
added/modified/deleted/renamed/copied/typeChanged/unmerged, rename original path, similarity).
They come from `--name-status`.

Base: `v2.0` at `67c1ba0d9` (P256 landed). One sequential Sonnet implementer.

Method: `codegraph_explore` on the main checkout (index lacks `apps/kira-space/internal/gitclient`
symbols, so `CombineFileChanges`/`NumstatArgs` queries returned nothing useful; `FileChange` in
`git-core` resolved). Rest by grep/Read over the tree, plus a real git 2.43 probe (conflicted
working tree: `git diff --name-status -M -C HEAD` and `--numstat` list the same path set).

## 1. Findings

Count render sites (all of them):

- `packages/git-ui/src/components/FileTree.vue`: 4 sites. Tree-mode and flat-mode directory row
  (`N files +x -y`, aggregate from `fileTreeModel.ts`), tree-mode and flat-mode file row
  (`+a -d`, hidden when `isBinary`). FileTree serves commit detail, stash detail, working detail,
  review files pane and review commit rows.
- `apps/kira-space/frontend/src/ade/v2/panel/AdeChangesTab.vue`: `fileDelta()` renders
  `binary` / `+a −d` per branch file (ADE Changes tab, fed by `RangeFiles` via
  `ade/board_facts.go toWireFiles`).
- No per-commit count exists anywhere (commit list, graph, review commit rows, stash list): only
  the per-directory aggregate above. Stash list shows `FileCount` (file count, not lines).

`isBinary` consumers: only FileTree (to hide counts) and ADE `fileDelta`. The diff view decides
binary at diff time from the diff itself (`porcelain.BodyBinary`, `git-core model/diff.ts`
`kind: 'binary'`), covered by flow subtest `binary diff is not text`. So once counts go, the list
flag has no consumer.

No MCP, agent prompt, mobile or Studio screen reads counts or `isBinary` (grep over every tracked
file). VS Code extension is gone (P243).

Numstat spawns:

| Site | Purpose | Verdict |
|---|---|---|
| `gitsession/queries.go fileChanges` (CommitDetail) | counts + isBinary | drop |
| `gitsession/stash.go StashShow` | counts + isBinary | drop |
| `gitsession/working.go WorkingDetail` | counts + isBinary | drop |
| `gitsession/incremental.go` RangeFiles | counts + isBinary | drop |
| `gitsession/queuefacts.go` (ADE branch files) | counts + isBinary | drop |
| `gitsession/preflight.go PreflightStashPop` | paths only | switch to `--name-status` |
| `porcelain/stash.go StashListArgs`, `GlobalStashLogArgs` | `FileCount` + record framing | keep (D2) |

## 2. Decisions

- D1 binary flag source: none. Drop `isBinary` from `FileChange` (Go, git-ipc, git-core) and
  `binary` from ADE wire. Cheapest correct: zero spawns, zero attribute checks; no list consumer
  remains; diff view already detects binary per file at diff time. Rejected: keeping a numstat
  spawn only for binary (pays a full content diff for an unused flag); `git diff --raw` (gives
  modes/oids, not binaryness); `check-attr` (only sees attributes, not content).
- D2 stash list / global stash log keep `--numstat`. Counts are not displayed, but the numstat
  record shape (`digit-tab` / empty-path rename header) is what lets `collectNumstatRecs` tell a
  header from a path record by position (F14: a file literally named `stash@{0}` or a 40-hex
  name). Moving to `--name-status`/`--name-only` means re-deriving that parser for no visible
  gain; it is one spawn per list either way. Out of scope; say so in the result.
- D3 merge removal: with one input there is nothing to merge. `ParseNameStatusRecords` returns
  `[]FileChange` directly (OriginalPath set when non-empty; Similarity set for renamed/copied,
  same rules as today's `CombineFileChanges`). Delete `CombineFileChanges` and `NameStatusEntry`.
  Behaviour change: a name-status row without a numstat row was silently dropped; it now shows.
  Probe found no such case in real git output; parity otherwise.
- D4 directory row keeps `N file(s)`; only `+x -y` goes. Not a line count.
- D5 ADE Changes tab drops the delta column; file row shows path only (conflict tint unchanged).
  The tab runs on the same `RangeFiles` data, so keeping counts there would mean keeping a numstat
  spawn for ADE alone. User rationale ("noisy, useless") applies equally.
- D6 git contract: field removal is breaking. `ContractVersion` 47 -> 48 (Go `gitrpc/contract.go`
  with a `P257: 47 -> 48, breaking.` comment line; TS `git-ipc/src/validate.ts`
  `CONTRACT_VERSION`; every literal-47 assertion, e.g. `gitrpc/stash_test.go`, `validate.test.ts`,
  `rpc.test.ts` if they pin it; `docs/ARCHITECTURE.md` `(**47**, P246)` -> `(**48**, P257)`).
  ADE wire has no version number (P143 freeze rule): change Go `adewire` and TS `ade/v2/wire.ts`
  together; note it in the result.

## 3. Work

Go, `apps/kira-space`:

1. `internal/gitclient/porcelain/difftree.go`: delete `NumstatArgs`, `NameStatusEntry`,
   `CombineFileChanges`; `FileChange` loses `Additions`, `Deletions`, `IsBinary`;
   `ParseNameStatusRecords` returns `[]FileChange`. Keep `ParseNumstatRecords`/`fillCounts` for
   stash list (D2) but shrink `NumstatEntry` to what is read (`Path`, `OriginalPath`; still validate
   the two count fields as `-` or int, store nothing). Fix doc comments naming numstat joins.
2. `porcelain/workingdiff.go`: delete `WorkingNumstatArgs`; fix `WorkingNameStatusArgs` comment.
3. `porcelain/stash.go`: delete `StashShowArgs` (thin wrapper); callers use
   `NameStatusArgs(&base, sha)`. Fix comments that mention the pair.
4. `internal/gitsession/queries.go`: `fileChanges(ctx, args) ([]porcelain.FileChange, error)` =
   `runRecords` + `ParseNameStatusRecords`, no errgroup. Update CommitDetail caller.
5. Callers: `stash.go StashShow`, `working.go`, `incremental.go`, `queuefacts.go` take
   `[]FileChange` straight from `fileChanges`. `working.go` untracked append unchanged; fix its
   comment. `preflight.go`: stash paths from `fileChanges(ctx, NameStatusArgs(...))`, `Path` only
   (parity with numstat's new-path-only list); fix doc comment.
6. `internal/ade/board_facts.go toWireFiles`: `adewire.FileChange{Path}`.
   `internal/bridge/adewire/wire.go`: `FileChange` loses `Added`, `Deleted`, `Binary`.
7. `internal/gitrpc/contract.go` (+ comment 126 naming numstat), `wire.go` if it names the
   fields: D6 bump.
8. Tests: `porcelain/difftree_test.go` (drop combine test; rename/mixed name-status tests assert
   the `FileChange` output incl. originalPath/similarity), `workingdiff_test.go` (name-status only),
   `stash_test.go` (drop `TestStashShowArgs`), `fixtures_test.go` (stop writing
   `workingDiff/*.numstat.bin` and any `diffTree/*.numstat.bin` no test still reads; keep
   `renameWithEdit.numstat.bin` while `ParseNumstatRecords` tests use it), delete orphaned `.bin`
   files, `gitsession/working_test.go` (drop the nil-counts assert), `flows/gitflow/detail_test.go`
   (drop `IsBinary` assert; binary covered by `binary diff is not text`), `gitrpc/stash_test.go`
   version literal, `ade/folders_test.go` if it builds `FileChange` with counts.

TS:

9. `packages/git-ipc/src/contract.ts` `FileChange`: drop `additions`, `deletions`, `isBinary`;
   `validate.ts` bump; fix doc comments near line 1699.
10. `packages/git-core/src/model/commit.ts` `FileChange`: same drop.
11. `packages/git-ui/src/components/FileTree.vue`: remove the 4 count sites and the
    `countFormat` import; keep `N files`, status letter, rename display, tips; fix the P75 comment
    about count width. `fileTreeModel.ts`: drop `additions`/`deletions` from the directory node
    and the aggregation (keep `fileCount`). Delete `countFormat.ts` and `countFormat.test.ts`
    (sole consumer gone).
12. Unit tests: `fileTreeModel.test.ts`, `state/reviewFiles.test.ts`, `state/working.test.ts`
    fixture objects lose the fields.
13. ADE: `frontend/src/ade/v2/wire.ts` `FileChange` -> `{ path: string }`;
    `AdeChangesTab.vue` remove `fileDelta` and its span; `justify-between` row becomes plain
    truncating path. `tests/unit/support/adeV2Fixtures.ts` and `tests/fixtures/ade-v2/board.json`,
    `add-existing-branch.json` lose the fields.
14. UI spec mocks: `tests/ui/repo-workspace.spec.ts` (~996-1007), `tests/ui/ade-v2-review.spec.ts`,
    `tests/ui/support/gitUiPortFixtures.ts` (`file()` helper drops the two count params; update
    every caller), `tests/visual/git-module.spec.ts` `FILES`.
15. Docs: `docs/ARCHITECTURE.md` version line; grep it for `numstat`, `+N`, `line count`,
    `isBinary`, ADE `delta` and fix any stale sentence. No CLAUDE.md change.

Regenerate and re-record (run from `apps/kira-space` per `docs/DEV_ENVIRONMENT.md`):

- Contract fixtures via `KIRA_CONTRACT=write`: `tests/contract/git-commit-detail.json`
  (`flows/gitflow` `TestCommitDetailAndDiff`, matrix test), `tests/contract/ade-base.json`
  (`flows/adeflow` base/rebase tests), `tests/contract/ade-review-open.json` (`review_test.go`).
  Diff each: only the removed keys may change.
- UI specs to run: `repo-commit-detail`, `repo-workspace`, `repo-review-interaction`,
  `repo-file-tree`, `ade-v2-review`, `ade-v2-review-open`, `ade-v2-base-rebase`, `ade-v2-panel`,
  plus any spec importing `gitUiPortFixtures` or `adeV2Fixtures`.
- Visual baseline to re-record: `tests/visual/git-module.spec.ts-snapshots/
  git-graph-detail-visual-linux.png` only (detail pane file tree). Run the whole `git-module`
  visual spec; the other four must pass unchanged (the stash dialog has no file tree). ADE visual
  (`ade-workflow-graph`) does not render the Changes tab; must pass unchanged.

Checks: `go vet`/lint/tests for `apps/kira-space`, `bun run typecheck`, lint, `knip` (must flag
nothing: `countFormat`, removed types, `StashShowArgs`, `WorkingNumstatArgs`). Final grep
`additions|deletions|isBinary|IsBinary|CombineFileChanges|NumstatArgs` over `apps/kira-space`,
`packages/git-*` returns only stash-list numstat parsing and unrelated hits.

## 4. Ownership and concurrency

P257 owns: `apps/kira-space/internal/{gitclient/porcelain,gitsession,gitrpc,ade,bridge/adewire}`
files above, `apps/kira-space/internal/flows/{gitflow/detail_test.go,gitflow/matrix_test.go,
adeflow/{base,rebase,review}_test.go}` (only if fixture regen needs edits), `packages/git-ipc`,
`packages/git-core/src/model/commit.ts`, `packages/git-ui/src/{components,state}` files above,
`apps/kira-space/frontend/src/ade/v2/{wire.ts,panel/AdeChangesTab.vue}`, the test files and
fixtures listed in steps 12-14 and "Regenerate", `docs/ARCHITECTURE.md` version line.

Overlap with P250 (`/home/user/kira-sW`, branch `p250-W`):

- `apps/kira-space/tests/ui/repo-workspace.spec.ts`: P250 edits other hunks; P257 edits the
  FileChange mock at ~996-1007. Expect clean rebase; on conflict keep both.
- `apps/kira-space/tests/contract/ade-base.json`/`ade-review-open.json`: not touched by P250
  (its new `ade-branching.json`, `mobile-board.json` carry no file-count keys). If P250 lands
  first and adds a fixture with `added`/`binary`, regenerate it after rebase.
- `flows/adeflow/*_test.go`: P250 adds new test files, P257 only regenerates via existing ones.

No overlap with P253 (docker). One sequential implementer: Go removal and TS removal share the
wire contract and fixtures, so no split.

## 5. Deferred decisions (defaults applied unless user objects)

- ADE Changes tab loses counts too (D5). Alternative: keep a numstat spawn in `queuefacts.go`
  for ADE only.
- Stash list/global stash log keep `--numstat` for framing (D2). Alternative: rewrite the record
  walk on `--name-only`.
- ADE file row shows path only; no kind letter added (adding `kind` to ADE wire is new scope).
- No new UI/flow test for the removal; existing specs plus updated mocks cover it.
