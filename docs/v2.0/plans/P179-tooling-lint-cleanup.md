# P179: Tooling and lint cleanup

Row: `docs/v2.0/SPEC.md` "P179 Tooling and lint cleanup". Origin: P168 close-out (Part 8 area).
Base: `v2.0` at `af16d6c`. One sequential implementer. No stream split: item 1's `knip.json` edit
and item 2's final `knip.json` edit touch the same file, and the acceptance check (`lint:dead`
clean) needs every group landed.

Acceptance (row): `bun run lint:dead` exits 0 with no finding and no configuration hint.

## 1. Current state (measured at `af16d6c`)

`bun run lint:dead` (knip 6.37.0) exits 1:

```
Unlisted dependencies (1)
@bindings/gitcredentialservice.js  apps/kira-space/frontend/src/bridge/index.ts:5:39
Duplicate exports (6)
OVERSCAN_PX|BASE_LEAD_PX|BASE_TRAIL_PX                    apps/kira-studio/frontend/src/views/shared/page/columns.ts
MAX_NEW_CELLS_PER_RENDER|MAX_NEW_LEAD_CELLS_PER_RENDER    apps/kira-studio/frontend/src/views/shared/page/columns.ts
UNRESOLVED_ROW|PATCH_UNCHANGED                            packages/git-core/src/graph/types.ts
buildReviewRowMenu|buildReadOnlyRowMenu                   packages/git-ui/src/components/rowMenuModel.ts
MAX_CELL_BYTES|DOCUMENT_TRUNCATE_BYTES                    packages/shared/protocol/page.ts
DOCUMENT_TRUNCATE_BYTES_SINGLE|OBJECT_BODY_PREVIEW_BYTES  packages/shared/protocol/page.ts
Configuration hints (8)
.vue  apps/kira-studio/frontend  Extension in project not registered as a compiler
.vue  apps/kira-space/frontend   Extension in project not registered as a compiler
.vue  apps/kira-space-vscode     Extension in project not registered as a compiler
.vue  packages/workbench         Extension in project not registered as a compiler
.vue  packages/theme             Extension in project not registered as a compiler
.css  (root)                     Compiled extension excluded by project (imports not followed)
.vue  (root)                     Compiled extension excluded by project (imports not followed)
.css  packages/git-ui            Compiled extension excluded by project (imports not followed)
```

### 1.1 The unlisted dependency is sandbox state, not code

`apps/kira-space/frontend/bindings/` is gitignored (`apps/kira-space/.gitignore:4`) Wails output.
This worktree's copy predates `GitCredentialService` (`internal/bridge/gitcredential.go:18`): no
`gitcredentialservice.ts` on disk. Fix: run `sh scripts/prepare-worktree.sh` once before any check
(`docs/DEV_ENVIRONMENT.md`, fresh-worktree note). No commit.

### 1.2 Item 1: knip already follows `.vue` imports; registration is accidental

The row's premise ("knip does not follow `.vue` imports") does not hold today. Probes at
`af16d6c`, each reverted after:

- `--trace-export headerAwareMinWidth`: knip lists all 4 `.vue` importers
  (`SlickGridHost.vue`, `ConsoleSlickGrid.vue`, 2 proto SFCs).
- New unused export in `columns.ts` (studio) and in `rowMenuModel.ts` (git-ui): both reported.
- New orphan `.vue` in studio and in space frontend, each importing a TS export: both reported as
  unused files.
- Scratch config adding a `vue/compiler-sfc` compiler globally: same 6 duplicates, zero new
  unused exports or files.

Why it works: knip's Vue plugin (`node_modules/knip/dist/plugins/vue/index.js`) registers its
built-in SFC compiler (`_vue/auto-import.js`, uses `vue/compiler-sfc`) only for a workspace whose
own manifest lists `vue`, `nuxt`, `unplugin-vue` or `@vitejs/plugin-vue`
(`WorkspaceWorker.registerCompilers`, own `this.dependencies`). Root lists `vue` and
`@vitejs/plugin-vue`, so root registers it, and the shared program applies it to every
workspace. The 5 "not registered" hints are real: they name workspaces whose SFC parsing hangs on
root's manifest. Remove `vue` from root and those SFCs stop being parsed.

So item 1 is a config fix that makes registration explicit, not a missing capability. No new dead
export surfaces (measured above), so no removal list.

Library decision: use knip's own Vue plugin (ISC; compiler from `vue/compiler-sfc`, MIT). No
custom compiler, no `knip.ts` conversion, no second SFC pass. A custom `compilers.vue` in
`knip.ts` was tried in scratch: it registers globally, which adds 5 new "Compiled extension
excluded" hints (`api-core`, `git-core`, `git-ipc`, `shared`, root) for workspaces that hold no
SFC. Declined for that reason.

### 1.3 Hint causes and fixes

| Hint | Cause | Fix |
|---|---|---|
| `.vue` not registered: studio frontend, space frontend, workbench, theme | Manifest lacks `vue`; all 4 hold SFCs (115, 94, 31, 99) that import `vue` | Add `"vue": "3.5.42"` to each `dependencies` (same version as root, `git-ui`, `kira-ui`) |
| `.vue` not registered: `apps/kira-space-vscode` | Project glob `src/**/*.{ts,vue}`; workspace has 0 `.vue` files | Glob `src/**/*.ts`. Never add `vue` to this manifest: it is the published extension manifest `vsce` packages |
| `.vue`, `.css` excluded: root | Root has Vue and Tailwind enablers; its project (`scripts/**/*.ts`, `packages/db-fixtures/**/*.ts`) holds no SFC or CSS | Root workspace block: `"vue": false`, `"tailwind": false` |
| `.css` excluded: `packages/git-ui` | Tailwind enabler registers knip's CSS compiler (follows `@import`); project omits `.css` | Project `src/**/*.{ts,vue,css}` |

Verified in scratch at `af16d6c` (reverted): all four fixes together leave zero hints, no new
unused file, export or dependency, and no `ignoreDependencies` entry turns redundant. Root `vue`
and `@vitejs/plugin-vue` stay referenced (apps' `vite.config.ts` imports resolve to root).

Disabling root's two plugins is scoping, not suppression: root's project has nothing either
compiler could parse. SFC workspaces now register their own compiler.

### 1.4 Item 2: why knip flags each pair

`node_modules/knip/dist/typescript/visitors/exports.js:146`: an `export const B = A` whose
initializer is a bare identifier naming another export is a duplicate. Only an `@alias` JSDoc tag
silences it. That is suppression: banned. Each pair gets a real fix below.

## 2. Out of scope, flagged for the orchestrator (not a P179 deliverable)

A different, real `lint:dead` blind spot exists. `packages/shared`, `packages/theme` and
`packages/workbench` make every file an entry (`entry: **/*.ts` / `src/**/*.{ts,vue}`), and
knip never reports an entry file's unused exports. Scratch run with per-workspace
`includeEntryExports: true`: shared 93 unused exports, theme 19 exports + 2 types, workbench
14 exports + 17 types. Many are false positives: workbench `testing/**` exports feed app test
dirs outside any knip project. Separating real from false needs per-workspace entry redesign
(alias boundary, test dirs). That is a design decision outside this row's wording. Recommend a
new follow-up row; the orchestrator or user decides. P179 does not touch it.

## 3. File ownership

- `knip.json`
- `bun.lock` (regenerated by `bun install`, never hand-edited)
- `apps/kira-studio/frontend/package.json`, `apps/kira-space/frontend/package.json`,
  `packages/workbench/package.json`, `packages/theme/package.json`
- `apps/kira-studio/frontend/src/views/shared/page/columns.ts`
- `packages/git-core/src/graph/types.ts`
- `packages/git-ui/src/components/rowMenuModel.ts`,
  `packages/git-ui/src/components/review/ReviewCommitRow.vue`
- `packages/shared/protocol/page.ts`,
  `apps/kira-studio/frontend/src/views/shared/keyvalue/KeyValuePane.vue`
- Go mirror: `apps/kira-studio/internal/page/chunk.go`, `apps/kira-studio/internal/page/builder.go`,
  `apps/kira-studio/internal/adapters/s3/read.go`,
  `apps/kira-studio/internal/adapters/testsupport/s3.go`,
  `apps/kira-studio/internal/adapters/testsupport/mongo.go` (comment only)
- Comments only: `scripts/demo-dbs/README.md`, `scripts/demo-dbs/s3/seed.sh`

No other file. `SPEC.md` is not edited by the implementer (orchestrator closes the row).

## 4. Steps (one commit per group, Conventional Commits)

Step 0, no commit: `sh scripts/prepare-worktree.sh`. Confirm
`apps/kira-space/frontend/bindings/.../bridge/gitcredentialservice.ts` exists. Never commit
bindings.

### 4.1 `chore(knip): register SFC and CSS compilers per workspace`

1. Add `"vue": "3.5.42"` to `dependencies` of the 4 manifests in §1.3 (theme has no
   `dependencies` key: create it). Keep root's `vue`.
2. `bun install` to update `bun.lock` workspace entries (CI runs `--frozen-lockfile`). Confirm
   the diff touches only those 4 workspace blocks and installs no new package.
3. `knip.json`:
   - root block: add `"vue": false` and `"tailwind": false`, one short comment: root project
     holds no SFC or CSS.
   - `apps/kira-space-vscode` project: `["src/**/*.ts", "tests/**/*.ts"]`.
   - `packages/git-ui` project: `["src/**/*.{ts,vue,css}"]`.
4. `bun run lint:dead`: zero configuration hints; the 6 duplicates remain (still `warn`).

### 4.2 `refactor(studio): give grid tuning knobs their own values`

`columns.ts`. Both pairs are independent dials defaulted equal (their own comments say so), so
each gets its own literal; no alias.

- `:204-205`: `BASE_LEAD_PX = 560`, `BASE_TRAIL_PX = 560`. The row-axis runway, separate from
  `OVERSCAN_PX` (column-axis clamp, `kiraSlickGrid.ts:606`). One-line comment: defaulted equal to
  `OVERSCAN_PX`, tuned independently. Values unchanged, so `row-range-bounds.spec.ts`
  (`560 / 28 = 20`) stays valid.
- `:240`: `MAX_NEW_LEAD_CELLS_PER_RENDER = 600`. Trim its comment's "Defaulted EQUAL to
  MAX_NEW_CELLS_PER_RENDER" sentence to state the literal matches on purpose.

Behaviour byte-identical (same numbers).

### 4.3 `refactor(git-core): give PATCH_UNCHANGED its own literal`

`types.ts:62`: `export const PATCH_UNCHANGED = 0xffffffff;`. Keep the doc comment's reasoning
(same bit pattern as `UNRESOLVED_ROW` on purpose; never collides). No caller changes
(`edges.ts`, `layoutStore.ts`, tests import by name). Value unchanged.

### 4.4 `refactor(git-ui): one read-only commit row menu builder`

One function, one name. Keep `buildReadOnlyRowMenu` (sibling of `buildReadOnlyRefMenu` and
`buildReadOnlyStashMenu`; a review row is read-only too, per its own doc comment).

- `rowMenuModel.ts`: rename `buildReviewRowMenu` (`:125`) to `buildReadOnlyRowMenu`; merge the two
  doc comments (`:116-124`, `:294-300`) into one covering both callers (review row, native
  read-only graph); delete the alias at `:301`.
- `ReviewCommitRow.vue`: import and call at `:29`, `:115`; comments at `:8`, `:236`.
- `App.vue:58,735` and `rowMenuModel.test.ts` already use `buildReadOnlyRowMenu`: no change.

### 4.5 `refactor(page): drop aliased byte budgets`

TS and Go together (`chunk.go` mirrors `page.ts` by name). Values unchanged.

- `DOCUMENT_TRUNCATE_BYTES` (= `MAX_CELL_BYTES`): a multi-row document body is a cell. Delete it;
  `createDocumentPageBuilder` uses `MAX_CELL_BYTES`, same as `createKeyValuePageBuilder` already
  does for its non-single case. Go: delete `DocumentTruncateBytes`; `NewDocumentPageBuilder` uses
  `MaxCellBytes`; `testsupport/mongo.go:198` comment names `MaxCellBytes`.
- `DOCUMENT_TRUNCATE_BYTES_SINGLE` and `OBJECT_BODY_PREVIEW_BYTES`: equal by construction
  (`page.ts:158-162`: a body only showable truncated is a wasted transfer). One concept: the
  per-value budget for a page that is one explicitly requested row. Replace both with
  `SINGLE_ROW_MAX_BYTES = MAX_CELL_BYTES * 64` (name matches the builders' `singleRow` option).
  Its doc comment carries both reasons (P8 D1 "show all"; P33 fetch ceiling, nothing above it is
  fetched).
  - TS: `page.ts` builders (`:438`, `:476`, `:470-473` comment); `KeyValuePane.vue:37,288,979,989`.
  - Go: `chunk.go` (`SingleRowMaxBytes`; drop the stale `page.ts:175-197` line reference),
    `builder.go:243,313`, `s3/read.go:119,133,138,186,191`, `testsupport/s3.go:54`.
  - Comments: `scripts/demo-dbs/README.md:150`, `scripts/demo-dbs/s3/seed.sh:34`.
- Final grep must find no `DOCUMENT_TRUNCATE_BYTES`, `OBJECT_BODY_PREVIEW_BYTES`,
  `DocumentTruncateBytes` or `ObjectBodyPreviewBytes` outside `docs/v1*/` and `docs/v2.0/plans/`
  (historical records, left as written).

### 4.6 `chore(knip): fail on duplicate exports`

`knip.json`: delete the `rules` block and its comment (it justified `"duplicates": "warn"` for the
6 pairs now fixed). Default severity is error, so a new alias fails pre-push and CI.

## 5. Checks

Per commit (pre-commit hook runs them): `bun run lint`, `bun run typecheck`.

Once, after §4.6:

- `bun run lint:dead`: exit 0, output empty (no finding, no hint).
- `bun run lint:go`.
- `go build ./...` and `go test ./apps/kira-studio/internal/page/... ./apps/kira-studio/internal/adapters/s3/...`
  (the s3 container suite needs Docker; in this sandbox it skips, so the build plus `go vet` via
  `lint:go` covers the rename; P180 item 14 already lists the Docker s3 run).
- `bun test packages/git-core/src packages/git-ui/src apps/kira-studio/tests/unit` (touched
  packages; `packages/shared` specs live under `apps/kira-studio/tests/unit`).
- Grep from §4.5.
- `git diff --stat af16d6c` touches only §3's files.

Never `--no-verify`, never `git stash`. A failing hook or check gets fixed in this pass.

## 6. Result

(Implementer fills: commit hashes per group, final `lint:dead` output, check results.)
