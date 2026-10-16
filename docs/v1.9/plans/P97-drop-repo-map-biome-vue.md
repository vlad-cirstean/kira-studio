# P97 — drop repo-map/tree-sitter code intelligence; Biome lints Vue files

`docs/v1.9/SPEC.md`'s P97 row, turned into concrete steps. Two bundled, code-independent tooling
changes, planned against `v1.9` at `8a436b4` (P96 landed). Part A removes a whole shipped
subsystem; Part B widens what Biome analyses. They share no file except `docs/v1.9/SPEC.md` and one
`.vue` finding (§13.3), so the order between them is free — §14 still fixes one, for a legible log.

Every count, file list and finding below is a real measurement taken in this container against
`8a436b4`, not an estimate copied from the SPEC row's own illustrative list. §1 and §12 record the
two places where the SPEC row's guess turned out wrong.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| Were `internal/mcpinstall`/`internal/mcpauth` repo-map's only consumers? | **No — both stay.** `internal/dbmcp` (the DB MCP server, M1) imports both: `bridge/dbmcp.go` builds `mcpinstall.New`, and `dbmcp/http.go`/`dbmcp/server.go` use `mcpauth` for its own token. Deleting either breaks the DB MCP server | §1.2 |
| Is `internal/codeindex` fully removable? | **No — one function survives.** `codeindex.EnumerateAll` (a `git ls-files -z --cached --others --exclude-standard` wrapper, no tree-sitter anywhere in it) is the repo file tree's and repo search's own enumerator, via `codeworkspace/files.go` and `codeworkspace/search.go`. It moves into `internal/codeworkspace`; the rest of the package goes | §1.3 |
| Which `internal/codegraph`? | **This app's own Go package**, `apps/kira-studio/internal/codegraph` — 14 files, 3878 lines, a query layer over `codeindex.db`. **Not** the external `codegraph` CLI/MCP tool registered in `.mcp.json` and documented in `CLAUDE.md`'s CodeGraph section, which this phase does not touch at all. The name collision is why this plan always writes the removal target with its `internal/` prefix | §1.1 |
| Is in-app code navigation replaced? | **No. Explicitly dropped, not replaced, by instruction** (SPEC's own wording). After this phase the repo file viewer has no go-to-definition, no hover, no find-references, no go-to-implementation, no peek, and no nav readout in the status bar. Monaco keeps syntax highlighting, the diff view, blame, search and quick open — all of which are independent of the graph | §3 |
| Does removal reach past the SPEC row's list? | **Yes, by seven more live surfaces** the row does not name: `views/repo/textModels.ts` + its unit test, `state/navStatus.ts` + the StatusBar readout, the `NavResult`/`NavTarget`/`RefResult`/`RefSite` half of `packages/shared/domain/repo.ts`, `codeworkspace/nav.go` + `textpos.go`, `CodeWorkspaceService.Definitions`/`Implementations`/`References` + `IndexStore` + the `OnRepoRemoved`/`OnRepoRenamed` hooks, the `code_repos.mcp_enabled` column and `codeIntel.mcpServerEnabled` settings leaf, and the ten tree-sitter `go.mod` requires | §2 |
| Does Biome 2.5.13 lint `.vue` at all today? | **Partly — `<script>` only.** `biome check .` already processes all 201 `.vue` files (verified with `--verbose` on a single file), which is why P96's `**/*.vue` override exists. What it does *not* analyse is the `<template>` and `<style>` blocks. That gap is what `html.experimentalFullSupportEnabled` closes | §11 |
| How is `.vue` linting widened? | One config key: `"html": { "experimentalFullSupportEnabled": true, "formatter": { "enabled": false } }`. Biome's own documented switch for "full support for HTML, Vue, Svelte, and Astro files", present in 2.5.13's `configuration_schema.json` as `HtmlConfiguration.experimentalFullSupportEnabled`. No plugin, no `includes` change, no version bump | §11.1 |
| Does it collide with P96's `**/*.vue` override? | **Yes, and the override mostly stops being needed.** Measured with the flag on and the override deleted: `useImportType` drops to **0** findings (the template-blindness P96 diagnosed is gone), `noUnusedImports`/`noUnusedVariables` drop to **9**, of which **8 are genuine dead code** and 1 is a different, narrower false positive (`<script setup generic="…">`). P97 deletes the override, fixes the 8, and puts one targeted `biome-ignore` on the 1 | §13 |
| Does this phase fix the new `.vue` findings? | **Split, with a reason.** The flag surfaces **314** real findings. P97 fixes the **59** that are mechanical or genuine defects (1 parse error, 9 correctness, 49 style). It does **not** fix the **255** `lint/a11y` findings: each is a real UI design decision (which `div` becomes a `button`, which control gets a label), and P99 rewrites every one of those components onto shadcn-vue primitives that carry correct roles and labels already. Fixing 255 by hand now and rewriting the same lines in P99 is double work on a design surface. They get an explicit, reasoned `**/*.vue` override plus a **new P101 row in `docs/v1.9/SPEC.md`** — a named follow-up phase, per `CLAUDE.md`'s own exception clause, never a line in a result section | §12 |
| Is there an installed base to migrate? | **No.** `internal/storage/migrations/embed.go`'s own package doc: "The app has never shipped, so there is no installed base with a partially-applied schema to preserve." So `0025` is a plain forward-only drop, and no runtime cleanup code is written for stale `${KIRA_HOME}` files — §8.3 handles those with one line in `docs/DEV_ENVIRONMENT.md` | §8 |
| One subagent or several? | **One sequential.** Part A is one continuous dependency-ordered unwind (frontend surface, then the bridge, then the Go packages, then `go.mod`); each step breaks the build until the next lands. Part B is small. Nothing here is independent enough to fan out | §14 |

---

# Part A — remove repo-map and the tree-sitter code-intelligence engine

## 1. Confirmed current state

### 1.1 The four Go packages that go wholesale

Import graph, measured with `grep -rln 'kira-studio/internal/<pkg>"' --include=*.go .`:

| Package | Files | Go lines | Imported by (outside itself) |
|---|---|---|---|
| `apps/kira-studio/internal/repomap` | 15 | 3533 | `cmd/kira-repo-map/main.go`, `internal/bridge/repomap.go` |
| `apps/kira-studio/internal/codegraph` | 14 | 3878 | `internal/repomap`, `internal/codeworkspace` (`nav.go`, `session.go`) |
| `apps/kira-studio/internal/codeparse` | 44 | 2700 | `internal/codeindex`, `internal/codegraph` (tests), `internal/repomap` |
| `apps/kira-studio/internal/codeindex` | 23 | 3734 | `internal/codegraph`, `internal/repomap`, `internal/codeworkspace`, `main.go`, `bridge/codeworkspace.go` |

Plus `apps/kira-studio/cmd/kira-repo-map/` (1 file), the repo's only `main` package besides
`cmd/g1measure`.

`internal/codegraph` here is **this app's own package**. The external CodeGraph tool
(`.mcp.json`, `CLAUDE.md`'s CodeGraph section, `.claude/hooks/session-start.sh`) is a separate
binary this repo's Claude Code sessions call as an MCP server. Nothing in this phase touches it.

### 1.2 The two packages that stay — verified, not assumed

SPEC said "`internal/mcpinstall`/`internal/mcpauth` if repo-map was their only consumer". It was
not:

- `internal/mcpinstall` — imported by `internal/bridge/dbmcp.go` and `main.go:506`
  (`&bridge.DbMcpService{… Installer: mcpinstall.New(mcpinstall.Deps{})}`).
- `internal/mcpauth` — imported by `internal/bridge/dbmcp.go`, `internal/dbmcp/http.go` and
  `internal/dbmcp/server.go`.

Both packages stay, code unchanged. Only their doc comments change (§7.2): both lead with repo-map
as the primary consumer and cite `internal/repomap` by path.

### 1.3 `internal/codeindex` is not wholly dead — `EnumerateAll` is load-bearing

`internal/codeworkspace` calls exactly one `codeindex` function that has nothing to do with
parsing:

- `codeworkspace/files.go:38` — `codeindex.EnumerateAll(ctx, s.Runner, s.GitPath, s.Root)`, the
  repo file tree's whole listing.
- `codeworkspace/search.go:228` — the same call, repo search's enumeration.

`EnumerateAll` (`codeindex/enumerate.go:47`) imports only `gitclient` and runs one
`git ls-files -z --cached --others --exclude-standard`. Its sibling `Enumerate` (the
`codeparse.Detect`-filtered variant) is used only by the indexer and goes with it. There is no
`enumerate_test.go`.

The other `codeindex` uses in `codeworkspace/session.go` (`*codeindex.Index`, `*codeindex.Watcher`,
`AcquireSyncLock`) all belong to the index lifecycle, which this phase removes.

### 1.4 The frontend navigation surface

- `frontend/src/views/repo/navigation.ts` — sole export `ensureNavigationRegistered(mod)`;
  registers Monaco definition, hover, implementation and reference providers on the `kira-repo`
  scheme. Called from `views/repo/RepoFileView.vue:152` and `views/repo/useDiffEditor.ts:200`.
- `frontend/src/views/repo/textModels.ts` — `createKiraTextModelService` /
  `installKiraTextModelService`, a `kira-repo`-aware `ITextModelService` added by P78 §1.4 **so
  cross-file definition previews resolve**. Installed from `frontend/src/editor/monaco.ts:124`;
  its only reason to exist is the peek/preview widget the definition providers open.
- `frontend/src/state/navStatus.ts` — written only by `navigation.ts`
  (`publishNavStatus`, 4 call sites), read only by `workbench/StatusBar.vue` (the
  `[data-testid="nav-status"]` item).
- `frontend/src/state/repomap.ts` — the Code intelligence tab's store; `hydrateRepoMap` called from
  `frontend/src/main.ts:311` and `workbench/SettingsDialog.vue`, the four mutators from
  `SettingsDialog.vue` only.
- `frontend/src/views/repo/monacoEntry.ts:142` — `export { StandaloneServices } from
  'monaco-editor/…/standaloneServices.js'`, a re-export that exists solely as `textModels.ts`'s
  override seam.
- `gotoLocation: { multipleDefinitions/multipleReferences/multipleImplementations }` editor options
  at `RepoFileView.vue:191` and `useDiffEditor.ts:255`.

### 1.5 The bridge and storage surface

- `internal/bridge/repomap.go` + `repomap_test.go` (190 lines) — whole files.
- `internal/bridge/codeworkspace.go` — `IndexStore` field (`:41`), the `OnRepoRemoved`/
  `OnRepoRenamed` hook fields (`:51`-`:52`) and their two call sites (`:351`, `:368`),
  `sess.EnsureIndex` in `OpenWorkspace` (`:427`), `Definitions`/`Implementations`/`References`
  (`:463`-`:547`), and `Shutdown`'s `IndexStore.Close()` (`:551`).
- `main.go` — the `codeindex`/`mcpinstall` imports, `repoMapSvc` in `embedded` (`:472`, `:495`-`:498`),
  `application.NewService(repoMapSvc)` (`:191`), `codeIndexStore := codeindex.OpenStore()` (`:515`)
  and the `IndexStore:` field it feeds, the two `OnRepoRemoved`/`OnRepoRenamed` closures
  (`:521`-`:522`), `repoMapSvc` in `wireLifecycle`'s signature (`:584`) and
  `bridge.StopRepoMap(repoMapSvc)` (`:613`).
- `internal/storage/model/settings.go` — `CodeIntelSettings`, `CodeIntelPatch`, the `CodeIntel`
  field on `Settings`/`SettingsPatch`, and its default.
- `internal/storage/repos/settings.go` — the `codeIntel.mcpServerEnabled` `leaf(...)` read (`:77`)
  and `upsertCodeIntelSection` (`:232`) plus its call (`:299`).
- `internal/storage/model/coderepos.go` — `McpEnabled` (`:18`).
- `internal/storage/repos/coderepos.go` — `mcp_enabled` in `codeReposSelectColumns` (`:10`), the
  `row.Scan` (`:20`), the `INSERT` column list (`:76`-`:84`), and `SetMcpEnabled` (`:88`-`:104`).

### 1.6 Shared domain, tests, scripts, build

- `packages/shared/domain/repomap.ts` — whole file.
- `packages/shared/domain/repo.ts` — `navTargetSchema`/`NavTarget`, `navResultSchema`/`NavResult`,
  `refSiteSchema`/`RefSite`, `refResultSchema`/`RefResult` (`:87`-`:128`). The rest of the file
  (file listings, diffs, search) stays.
- `packages/shared/domain/settings.ts` — `codeIntelSettingsSchema`/`CodeIntelSettings` (`:157`),
  the `codeIntel` key in the settings schema (`:210`), the patch schema (`:227`) and the defaults
  (`:269`). `dbMcpSettingsSchema` sits directly below it and is explicitly kept.
- `frontend/src/bridge/index.ts` — the five `repoMap*` control methods (`:346`-`:355`) and the
  three `codeWorkspaceDefinitions`/`Implementations`/`References` methods (`:524`-`:557`).
- `frontend/src/state/settings.ts` — `'Code intelligence'` in `sections` (`:28`) and the
  `Object.assign(settingsState.codeIntel, …)` hydrate (`:79`).
- `frontend/bindings/.../internal/bridge/repomapservice.ts` (67 lines) plus the `RepoMapService`
  import/export and six `RepoMap*` model re-exports in `bindings/.../bridge/index.ts`, the six
  `RepoMap*` interfaces in `bindings/.../bridge/models.ts`, and the `NavResult`/`NavTarget`/
  `RefResult`/`RefSite` interfaces in `bindings/.../internal/codeworkspace/models.ts`. **Generated
  — regenerate, never hand-edit** (§5.4).
- `apps/kira-studio/tests/ui/settings-code-intelligence.spec.ts` (144 lines) — whole file.
- `apps/kira-studio/tests/ui/repo-workspace.spec.ts` — the two navigation tests at `:937`-`:993`
  (modifier-click definition link) and `:998`-onwards (Shift+F12 peek + status readout), plus the
  `DEFINITION` snapshot and any now-unused imports they leave behind.
- `apps/kira-studio/tests/unit/repo-preview-models.spec.ts` — whole file (it tests
  `textModels.ts`'s preview-model registry).
- `apps/kira-studio/tests/ui/support/ipcChannels.ts:146`-`150` and `mockRuntime.ts:151`-`155` +
  `:358`-`:369` (the `repoMapStatus` seed) — plus the `codeWorkspaceDefinitions`/`References`/
  `Implementations` channel entries.
- `scripts/mcp-repo-map.ts` — whole file.
- `package.json` — the `mcp:repo-map` and `mcp:repo-map:build` scripts.
- `knip.json` — the `ignoreBinaries` comment naming `mcp:repo-map:build` as one of six `go` callers.
- `biome.json` — `"!apps/kira-studio/internal/codeparse/testdata"` in `files.includes`.
- `go.mod` — the ten `tree-sitter*` requires (`tree-sitter-grammars/tree-sitter-svelte`,
  `tree-sitter/go-tree-sitter`, and the css/go/html/java/javascript/json/python/rust/typescript
  grammar modules) and whatever `go mod tidy` drops with them.

### 1.7 Docs

`CLAUDE.md:209`-`210`, `README.md` (`:6`-`:7`, `:166`-`:204`, `:229`, `:384`-`:386`, `:459`-`:460`,
`:483`, `:508`-`:509`), `NOTICES.md:71`-`:105`, `docs/ARCHITECTURE.md` (the `codeparse` and MCP-SDK
dependency-table rows, the app-data list, and the whole "repo-map MCP server" / code-graph /
navigation sections plus four "Known open items" entries), `docs/DEV_ENVIRONMENT.md` (`:221`-`:228`
and the whole `## repo-map MCP server` section, `:281`-`:335`, plus `:385`-`:397`'s cross-references
from the DB MCP section).

**Chapter plan docs under `docs/v1.5/`-`docs/v1.8/` and the per-chapter `mcp-repo-map-issues.md`
files are never edited** — `CLAUDE.md`: a plan is "never edited afterward". They are the historical
record of a feature that existed.

## 2. What is explicitly kept

Named here so a later reader can tell "kept on purpose" from "missed":

- `internal/mcpauth`, `internal/mcpinstall`, `internal/dbmcp` and the whole DB MCP server (§1.2).
- `internal/codeworkspace` — file tree, file read, diff, search, quick open. It loses `nav.go`,
  `textpos.go`, `textpos_test.go` and the index/graph/watcher half of `session.go`, and gains
  `EnumerateAll`.
- `internal/pathsafe` — real consumers remain (`codeworkspace/paths.go`, `codeworkspace/search.go`).
  Only its doc comment changes (§7.2).
- The repo file viewer, diff viewer, blame, review tabs, repo search, quick open, the repo graph.
- `packages/shared/domain/repo.ts`'s non-nav half, `settings.ts`'s `dbMcp` leaf.
- `github.com/modelcontextprotocol/go-sdk` in `go.mod` — the DB MCP server still needs it.
- The external CodeGraph MCP tooling: `.mcp.json`, `.claude/hooks/session-start.sh`,
  `CLAUDE.md`'s CodeGraph section (its last paragraph alone changes, §7.5).

## 3. The dropped capability, stated plainly

In-app code navigation is **removed with no replacement**, by explicit instruction (SPEC's P97 row:
"explicitly dropped, not replaced, by instruction"). Concretely, after this phase a file open in a
repo workspace has:

- no go-to-definition (F12, Cmd-click, the `.goto-definition-link` underline);
- no hover card showing a symbol's kind/target/rule/confidence;
- no find-references or peek-references (Shift+F12);
- no go-to-implementation;
- no `nav-status` readout in the status bar;
- no background `codeindex.db` parse/sync/watch per open repository.

Nothing is stubbed, no menu entry is left pointing at a removed action, and no "coming back later"
comment is written. Syntax highlighting, the diff editor, inline blame, repo search and quick open
are unaffected — none of them read the graph (`bridge/codeworkspace.go:684` already records that
search is deliberately graph-independent).

## 4. Removal order

Each step compiles only once the previous one has landed, so the order is not cosmetic:

1. Frontend leaves (nothing imports them once the two call sites go).
2. Frontend bridge + state + settings section.
3. Shared domain.
4. Go bridge + `main.go`.
5. Go packages + `cmd/`.
6. `codeindex.EnumerateAll` relocation (must precede deleting `internal/codeindex`).
7. Storage migration.
8. `go.mod` / build surface / generated bindings.
9. Tests.
10. Docs.

## 5. Implementation steps

### 5.1 Frontend

1. Delete `frontend/src/views/repo/navigation.ts`, `frontend/src/views/repo/textModels.ts`,
   `frontend/src/state/navStatus.ts`, `frontend/src/state/repomap.ts`.
2. `frontend/src/views/repo/RepoFileView.vue` — drop the `ensureNavigationRegistered` import
   (`:25`) and call (`:152`), and the `gotoLocation` option block (`:187`-`:195`) with its comment.
   While here, drop the now-unused `watch` from the `vue` import at `:6` (§13.3).
3. `frontend/src/views/repo/useDiffEditor.ts` — same two removals (`:29`, `:200`, `:255`-`:259`).
4. `frontend/src/editor/monaco.ts` — drop the `installKiraTextModelService` dynamic import and call
   (`:120`-`:125`) and the P78 §1.4 comment above it.
5. `frontend/src/views/repo/monacoEntry.ts` — drop the `StandaloneServices` re-export (`:136`-`:142`)
   and its comment; it exists only for the deleted override.
6. `frontend/src/workbench/StatusBar.vue` — drop the `navStatusState` import (`:10`), the
   `navStatus`/`navStatusTooltip` computeds (`:88`-`:93`) and the `v-if="navStatus"` item
   (`:154`-`:161`).
7. `frontend/src/workbench/SettingsDialog.vue` — drop the `../state/repomap` import block
   (`:43`-`:50`), every `repoMap*` ref/handler/computed/poll (`:193`-`:302`, including
   `repoMapPollTimer`, `repoMapStillIndexing`, `stopRepoMapPoll`, the `activeSection` watcher's
   `'Code intelligence'` branch at `:255`, and `repoMapTokenExpired`), and the whole
   `v-else-if="activeSection === 'Code intelligence'"` template branch (from `:1646`). Leave the
   `'Database MCP'` branch intact — it is a separate section (`ARCHITECTURE.md`'s own note that DB
   MCP "is *not* part of the Code intelligence section"). Two comments elsewhere in this file cite
   Code intelligence as a precedent (`:676`, `:1306`, `:1591`) — reword them to name
   `'Connected editors'`/`'Database MCP'` instead of a deleted section.
8. `frontend/src/state/settings.ts` — drop `'Code intelligence'` from `sections` (`:28`), the
   `codeIntel` hydrate line (`:79`), and fix the two comments at `:15`/`:18` that name it.
9. `frontend/src/main.ts` — drop the `hydrateRepoMap` import (`:21`) and its entry in the boot
   `Promise.all` (`:311`).
10. `frontend/src/bridge/index.ts` — drop the five `repoMap*` methods, the three
    `codeWorkspace{Definitions,Implementations,References}` methods, the `RepoMapService` binding
    import, and the now-unused `RepoMapStatus`/`RepoMapInstallResult`/`NavResult`/`RefResult` type
    imports.
11. `frontend/src/editor/paintSpans.ts:106` — the comment cites `mcp-repo-map-issues.md`, a
    historical chapter doc that still exists. **Leave it**; it is a provenance note, not a pointer
    into deleted code.

### 5.2 Shared domain

1. Delete `packages/shared/domain/repomap.ts`.
2. `packages/shared/domain/repo.ts` — delete `navTargetSchema`/`NavTarget`,
   `navResultSchema`/`NavResult`, `refSiteSchema`/`RefSite`, `refResultSchema`/`RefResult`
   (`:80`-`:128`) and any import left unused.
3. `packages/shared/domain/settings.ts` — delete `codeIntelSettingsSchema`/`CodeIntelSettings`, the
   `codeIntel` key in the settings schema, the patch schema and the defaults. Keep
   `dbMcpSettingsSchema`; rewrite its "mirrors `codeIntelSettingsSchema` exactly" comment to stand
   alone. Check the `:184` comment about old rows with no `codeIntel` key — it describes the
   `.default(...)` tolerance the other leaves still need, so reword rather than delete.

### 5.3 Go — bridge, main, packages

1. Delete `internal/bridge/repomap.go` and `internal/bridge/repomap_test.go`.
2. `internal/bridge/codeworkspace.go` — delete the `codeindex` import, the `IndexStore` field, the
   `OnRepoRemoved`/`OnRepoRenamed` fields and their two call sites in `RenameRepo`/`RemoveRepo`,
   `sess.EnsureIndex(...)` in `OpenWorkspace`, `CodeWorkspaceDefinitionArgs`,
   `CodeWorkspaceReferenceArgs`, `Definitions`, `Implementations`, `References`, and
   `Shutdown`'s `IndexStore.Close()`. `OpenWorkspace` keeps its `session(ctx, args.ID)` call — that
   is what opens the registry entry `CloseWorkspace` pairs with — and its doc comment is rewritten
   to say so instead of naming the index.
3. `main.go` — delete the `codeindex` and `mcpinstall` imports (`mcpinstall` is still used at
   `:506` for DB MCP, so delete **only** if that line's construction is untouched — it is, so the
   import **stays**; re-check with `go build`), the `repoMapSvc` field and construction, its
   `application.NewService` registration, `codeIndexStore`, the `IndexStore:` field, the two
   `OnRepo*` closures, `repoMapSvc` from `wireLifecycle`'s parameter list and call site, and
   `bridge.StopRepoMap(repoMapSvc)`.
4. Create `internal/codeworkspace/enumerate.go` holding `EnumerateAll` moved verbatim from
   `codeindex/enumerate.go` (package clause, the `codeindex:` error-message prefix and the doc
   comment's `C1`/`Enumerate` cross-reference updated; the git argv and the tier-2 path-byte rule
   stay byte-identical). Update `files.go:38` and `search.go:228` to the unqualified call.
5. `internal/codeworkspace/session.go` — delete the `index`/`graph`/`watcher` fields, `EnsureIndex`,
   `graphAndReady`, the sync-lock goroutine and the `codeindex`/`codegraph` imports; `Registry.Close`
   keeps closing the catfile session.
6. Delete `internal/codeworkspace/nav.go`, `textpos.go`, `textpos_test.go`.
   `LineIndex` has no consumer outside `nav.go` and its own test — verified by grep.
7. Delete `internal/repomap/`, `internal/codegraph/`, `internal/codeparse/`, `internal/codeindex/`,
   `cmd/kira-repo-map/`.

### 5.4 Generated Wails bindings

`apps/kira-studio/frontend/bindings/**` is generated by
`wails3 task common:generate:bindings`, wrapped by `scripts/setup.sh` (`bun run setup`). `wails3`
is on `PATH` in this container (`$(go env GOPATH)/bin/wails3`).

**Run `bun run setup` and commit whatever it emits.** Do not hand-edit a generated file. If
regeneration fails for an environment reason, stop and report it — do not fall back to editing
`repomapservice.ts`/`models.ts`/`index.ts` by hand, because the next `predev` would silently
re-add the deleted surface.

Expected delta: `bridge/repomapservice.ts` deleted; `bridge/index.ts` loses the `RepoMapService`
import/export and the six `RepoMap*` model re-exports; `bridge/models.ts` loses the six `RepoMap*`
interfaces and `CodeWorkspaceDefinitionArgs`/`CodeWorkspaceReferenceArgs`;
`internal/codeworkspace/models.ts` loses `NavResult`/`NavTarget`/`RefResult`/`RefSite`;
`internal/storage/model/models.ts` loses `CodeIntelSettings`/`CodeIntelPatch` and `code_repos`'
`mcpEnabled`.

## 6. Storage: migration `0025`

Create `apps/kira-studio/internal/storage/migrations/0025_p97_drop_repo_map.sql`, matching the
existing files' comment-then-DDL shape:

```sql
-- P97: repo-map is removed. Both the per-repository MCP grant (0019) and the settings leaf that
-- toggled the embedded server have no reader left.
ALTER TABLE code_repos DROP COLUMN mcp_enabled;
DELETE FROM settings WHERE key = 'codeIntel.mcpServerEnabled';
```

Register it in `migrations/embed.go`'s `names` table as
`{25, "p97_drop_repo_map", "0025_p97_drop_repo_map.sql"}`.

`ALTER TABLE … DROP COLUMN` needs SQLite ≥ 3.35; the app is on `modernc.org/sqlite v1.58.0`, well
past it. Confirm by running the app's own migration path in the Go test suite (`go test
./internal/storage/...`) rather than by asserting the version — if it fails, fall back to the
12-step table rebuild the SQLite docs specify, in the same migration file.

`0019_p67d_repo_map_access.sql` is **not** edited or deleted — migrations are forward-only, and
`embed.go`'s own note about collapsing `0001`-`0005` was a pre-`0006` one-off, not a standing
licence to rewrite history.

## 7. Comment and doc rewrites

### 7.1 The rule

A comment whose *reasoning* survives but whose *pointer* dies gets rewritten to stand alone. A
comment that only exists to explain deleted code gets deleted with it. No comment is left naming a
file or package that no longer exists.

### 7.2 Go comments pointing at deleted packages

| File | What it says now | Action |
|---|---|---|
| `internal/pathsafe/pathsafe.go:4`-`:6` | package doc justifies the package by `internal/repomap`'s source reader and the headless binary | Rewrite: the consumers are now `codeworkspace/paths.go` and `codeworkspace/search.go` |
| `internal/mcpauth/token.go:2`, `:6`-`:7`, `:118`, `:140`-`:141` | package doc, the `slug` parameter and the two-server error label all lead with repo-map | Rewrite around the one remaining server. The `label`/`slug` parameters stay in the API — they are still correct, just no longer two-valued in practice |
| `internal/mcpinstall/install.go:1`-`:2` | "registers the repo-map MCP server's embedded instance…" | Rewrite to name the DB MCP server |
| `internal/dbmcp/server.go:4`, `:10`, `:35`, `:41`, `:89`, `:117`; `dbmcp/http.go:26`, `:30`, `:59`, `:64`, `:74`; `dbmcp/render.go:42` | each explains a choice by pointing at `internal/repomap`'s identical one | Rewrite each to state the reason directly. `server.go:35`'s "adjacent to repo-map's 8765" keeps the port number as history but drops the live cross-reference |
| `internal/bridge/agenthooks.go:119`, `terminal.go:74`, `update.go:11` | cite `repomap.go`'s `startIfEnabled` / `RepoMapInstaller` as precedent | Rewrite to carry the reasoning inline, or point at `dbmcp.go`'s surviving equivalent |

### 7.3 `README.md`

- `:6`-`:7` — the one-line pitch says "a git client with code intelligence … go-to-definition".
  Drop "code intelligence" and "go-to-definition" from the list; keep file tree, Monaco viewer,
  diffs, search.
- `:166`-`:204` — the `## Code intelligence features` section. Delete the repo-map MCP server and
  Code navigation entries; keep the DB MCP server entry, renaming the section to match what is
  left (it currently opens with "Code intelligence" and closes with "A second local MCP server —
  separate from the repo-map one", which no longer parses).
- `:229` — "both described under Code intelligence above" in the Kira Version paragraph.
- `:384`-`:386` — the App data list: drop `codeindex.db`, `codeindex-sync-<12 hex>.lock` and
  `mcp-repo-map-*-token.json`; keep `mcp-db-token.json`.
- `:459`-`:460` — the repo-layout table: drop `codeparse/codeindex/codegraph/repomap` from the
  `internal` row (keep `codeworkspace`) and delete the `cmd/kira-repo-map` row, correcting
  "the repo's only other `main` package" on the `cmd/g1measure` side.
- `:483`, `:508`-`:509` — the chapter index. `docs/v1.5/` stays listed as a completed chapter; its
  description shifts to past tense ("the code intelligence chapter, since removed in v1.9 P97") so
  a reader is not sent looking for shipped code.

Per `CLAUDE.md`, `README.md` keeps normal prose — do not compress it into the terse house style.

### 7.4 `NOTICES.md`

Delete the whole `## tree-sitter grammars and vendored tags.scm queries` section (`:71`-`:105`).
Nothing in the shipped binary links tree-sitter or carries a vendored `tags.scm` after this phase.
Re-read the surrounding sections for a dangling "eleven modules"-style count.

### 7.5 `CLAUDE.md`

Only the CodeGraph section's last paragraph (`:209`-`:210`) changes: "Doesn't touch the shipped
repo-map feature (Settings dialog's Code intelligence tab, `internal/repomap`) — that stays
product, unrelated to this dev-tooling swap." That caveat is obsolete; replace it with one line
noting the shipped repo-map feature was removed in P97, so `codegraph` is now the only code-index
in the repo and there is no name collision to keep straight. Everything above it stands.

### 7.6 `docs/ARCHITECTURE.md`

The largest doc edit. Sections to delete outright: `### The repo-map MCP server (C3, P64-P69d)`
and everything under it through the DB MCP section's start; the `internal/codegraph` "computes the
code graph live" block (`:952`-`:1010`); the `codeindex.db` third-SQLite-file block (`:903`-`:925`);
the navigation half of the C6 diff-tabs section (`:1271`-`:1345`), keeping the diff/reveal/quick-open
paragraphs that describe surviving behaviour.

Dependency table (`:52`-`:53`): delete the `Code parsing (C1, C2)` row entirely. The
`MCP servers (C3, M1)` row stays but is rewritten around `internal/dbmcp` — the `+12.38 MB` C3
binary-size measurement is now historical, and the row must not read as if `internal/repomap` is
still linked.

App-data list (`:456`-`:458`): same three entries as README's.

`## Known open items`: delete the four entries whose subject is gone — the `go-pointer` registry
leak per parse (`:4123`), the double-parse when the workspace and the MCP server serve the same
repository (`:4157`, restated at `:4209`), the watcher-armed-before-initial-sync race (`:4170`), and
the `codeindex.EnumerateAll` glob-matcher entry (`:4186`). Keep `:4214`'s HTTP-timeout entry but
narrow it to `internal/dbmcp/http.go` alone. Re-read every remaining entry for a reference to a
deleted package; `CLAUDE.md`'s rule is to delete an entry the moment it is resolved, and "the
subsystem no longer exists" resolves it.

`:3743`'s note that Database MCP "is *not* part of the Code intelligence section" needs rewording
now that there is no Code intelligence section.

### 7.7 `docs/DEV_ENVIRONMENT.md`

- Delete the whole `## repo-map MCP server — running and registering it in this environment`
  section (`:281`-`:335`).
- `:221`-`:228` — the cgo/C-compiler paragraph: `internal/codeparse` is gone, so the
  "unconditionally-cgo" claim is false. Rewrite to describe only the surviving `darwin && cgo`
  build-tagged files.
- `:385`-`:397` — the DB MCP section's "Unlike repo-map…", "the same 7-day expiry as repo-map's"
  and "identical to `CLAUDE.md`'s repo-map recipe" cross-references: rewrite so each stands alone,
  and correct `:385`-`:386`'s claim that `cmd/` holds `g1measure` **and** `kira-repo-map`.
- Add one line, in the app-data or cleanup area: a dev box that ran a pre-P97 build still has
  `${KIRA_HOME}/codeindex.db*`, `codeindex-sync-*.lock` and `mcp-repo-map-*-token.json`; delete
  them by hand. No runtime cleanup code is shipped — §8's "never shipped" finding means there is no
  installed base, so a permanent housekeeping path in a shipping app would be permanent code for a
  one-off developer chore.

## 8. Notes on data and disk

1. **No installed base.** `migrations/embed.go`'s package doc states it outright. So §6 is a plain
   forward drop and no data is preserved.
2. **`codeindex.db` is not `kira.db`.** It is a separate SQLite file under `${KIRA_HOME}`, opened
   only by the deleted packages. Nothing migrates it; §7.7 tells a developer to delete it.
3. **Tokens.** `mcp-repo-map-*-token.json` files are orphaned the same way. `mcp-db-token.json` is
   untouched and still live.

## 9. Verification for Part A

Run in this order; every one must be clean before Part A counts as done.

```
bun run setup                     # regenerates bindings — commit the delta
go build ./...                    # needs frontend/dist to exist first; see P96 §2.2
go vet ./...
go test ./...
bun run typecheck
bun run build
bun run build:vscode
bun run lint:all                  # biome + check-tokens + golangci-lint + knip
bun run test:unit
bun run test:webview
bun run test:ui
```

Then the "nothing left half-removed" sweep — each of these must print **nothing**:

```
grep -rn "internal/repomap\|internal/codeparse\|internal/codeindex\|internal/codegraph" \
  --include=*.go --include=*.ts --include=*.vue --include=*.json apps packages scripts
grep -rni "repomap\|repo-map\|codeIntel\|Code intelligence" \
  --include=*.go --include=*.ts --include=*.vue --include=*.json --include=*.sh \
  apps packages scripts package.json knip.json biome.json
grep -rn "tree-sitter\|tree_sitter" --include=*.go apps packages
grep -rn "navStatus\|ensureNavigationRegistered\|textModels\|NavResult\|RefResult" \
  --include=*.ts --include=*.vue apps packages
grep -n "tree-sitter" go.mod
grep -rni "repo-map\|repomap\|tree-sitter\|codeparse\|codeindex\|internal/codegraph\|code intelligence" \
  CLAUDE.md README.md NOTICES.md docs/ARCHITECTURE.md docs/DEV_ENVIRONMENT.md
```

The last one has two permitted survivors, and only these two: `CLAUDE.md`'s new one-line note that
P97 removed the feature (§7.5), and `README.md`/`docs/ARCHITECTURE.md`'s past-tense chapter-index
references to `docs/v1.5/` (§7.3). Anything else is a miss.

Also confirm by hand:

- `find . -path ./node_modules -prune -o -name '*.go' -print | xargs grep -l 'EnsureIndex'` is
  empty.
- `go mod tidy` leaves `go.mod`/`go.sum` unchanged after the tree-sitter requires are dropped
  (i.e. the drop was complete and nothing else needed them).
- Opening a repo workspace and a file in the running app (`bun run dev`) shows the tree, the
  editor, blame and search, and F12 / Cmd-click do nothing at all — no console error, no rejected
  IPC call.
- The Settings dialog's section list shows ten entries, `Database MCP` still opens and still shows
  its own toggle, command and Install button.

---

# Part B — Biome lints `.vue` files

## 10. Confirmed current state

`@biomejs/biome` is pinned at **2.5.13** in `package.json` and `bun.lock` (the P94 pin, unchanged).
`biome.json`'s `$schema` already points at `2.5.13`.

`biome check .` currently processes **1181 files** and reports **0** diagnostics. All **201** `.vue`
files in the repo are already among those 1181 — verified with
`biome check --verbose <one>.vue`, which lists the file under "Files processed". So the SPEC row's
framing ("Biome actually lints `.vue` files, not just `.ts`/`.js`") is half-true: the `<script>`
block is linted today; the `<template>` and `<style>` blocks are not.

## 11. The mechanism

### 11.1 The one config key

Biome's own language-support page documents Vue as experimental since 2.3.0, enabled by:

```json
"html": {
  "experimentalFullSupportEnabled": true
}
```

`node_modules/@biomejs/biome/configuration_schema.json` confirms the key exists on
`HtmlConfiguration` at this exact version, described as "Enables full support for HTML, Vue,
Svelte, and Astro files." No plugin, no `files.includes` change, no version bump.

Add it with the HTML formatter explicitly off:

```json
"html": {
  "experimentalFullSupportEnabled": true,
  "formatter": { "enabled": false }
}
```

### 11.2 Why the formatter stays off — measured

With `html.formatter.enabled: true`, `biome check .` reports **126 `format` diagnostics**, i.e. 125
`.vue` files whose templates Biome would rewrite. That is a repo-wide whitespace churn across the
exact files P99 rewrites onto Tailwind and shadcn-vue, on an experimental formatter, for no lint
benefit. P97 is a **linting** change. Turning the HTML formatter on is its own decision, for a
phase that can absorb the diff — name it there, not here. Setting `enabled: false` explicitly (not
by omission) is what makes that a recorded decision rather than an accident.

## 12. What the flag surfaces — measured, and how it is split

Two full `biome check . --max-diagnostics=5000 --reporter=json` runs in this container at
`8a436b4`, flag on. Counts below exclude one `format` diagnostic on `biome.json` itself, an
artifact of how the experiment rewrote that file.

**314 findings across 88 files.**

| Group | Count | P97? |
|---|---|---|
| `parse` — `RepoFileView.vue:355`'s `:deep(> *)` CSS selector | 1 | **fix** |
| `lint/correctness/noUnusedVariables` | 5 | **fix** |
| `lint/correctness/noUnusedImports` | 4 | **fix** (1 suppressed, §13.2) |
| `lint/style/noNonNullAssertion` (warning) | 21 | **fix** |
| `lint/style/useVueHyphenatedAttributes` (info) | 19 | **fix** |
| `lint/style/useTemplate` (info) | 5 | **fix** |
| `lint/style/noDescendingSpecificity` (warning) | 4 | **fix** |
| `lint/a11y/*` — 12 rules, 85 files | 255 | **defer to P101** |

### 12.1 Why the 59 are fixed here

They are mechanical or genuine: one CSS selector Biome's parser rejects, eight genuinely dead
imports/variables, 19 kebab-case attribute renames, five string concatenations, four CSS ordering
swaps, and 21 non-null assertions. None requires a UI decision. This matches P94 pass 1's precedent
of landing a newly-enabled tool on a clean baseline.

### 12.2 Why the 255 a11y findings are not

`CLAUDE.md`: a lint finding gets fixed on the spot, with one exception — work "genuinely outside
the phase's own scope (a different subsystem, a real design decision)", which becomes "its own named
follow-up phase in `SPEC.md`". Every one of these qualifies:

- `noLabelWithoutControl` (79), `useSemanticElements` (15), `useButtonType` (5),
  `noNoninteractiveElementToInteractiveRole` (4) — each asks which element should become which
  semantic control, with real focus, styling and keyboard consequences.
- `noStaticElementInteractions` (65), `useKeyWithClickEvents` (54), `useFocusableInteractive` (5) —
  each asks for a keyboard interaction model this app does not have yet for that control.
- `noAutofocus` (14) — each is a deliberate UX choice to re-litigate, not a typo.

And they land exactly where **P99** rewrites: the top files are `ConnectionDialog.vue` (27),
`SettingsDialog.vue` (22), `StreamView.vue` (21), `RequestSettingsPane.vue` (14),
`git-ui/BranchPicker.vue` (5), `CommandPalette.vue` (6), `ContextMenu.vue` (5) — dialogs, menus and
pickers that P99 replaces with shadcn-vue primitives carrying correct roles and labels already.
Hand-fixing 255 findings now and rewriting those same lines in P99 is double work on a design
surface.

So P97 adds one override, with the reason in the file:

```json
{
  "includes": ["**/*.vue"],
  "linter": { "rules": { "a11y": "off" } }
}
```

and **adds a P101 row to `docs/v1.9/SPEC.md`** — "Fix the 255 `.vue` accessibility findings and
delete the `a11y: off` override", sequenced after P99 so it fixes what the migration leaves rather
than what it is about to replace. Nothing is hidden: the override names the count and the phase, and
deleting it is P101's own acceptance test.

Confirm `"a11y": "off"` is a valid group-level value against `2.5.13`'s
`configuration_schema.json` before writing it; if the schema requires per-rule entries, list the
twelve rules explicitly instead. Do not guess.

## 13. Interaction with P96's `**/*.vue` override

`biome.json`'s override at the `**/*.vue` includes block (landed by P96, `5ef0549`) turns off
`noUnusedImports`, `noUnusedVariables` and `useImportType`. P96's reason was template-blindness:
Biome could not see `<template>`, so a constant used only there looked unused. Full support removes
that blindness.

Measured with the flag on and that override deleted:

### 13.1 `useImportType` — 0 findings. Delete it from the override.

P96 §5.2's false positive (`RequestSettingsPane.vue`'s `HTTP_VERSIONS` and three `*_RANGE`
constants) does not reproduce. The rule is correct once the template is analysed. Removing this
entry is the direct payoff of Part B and should be called out in the P97 result section.

### 13.2 `noUnusedImports`/`noUnusedVariables` — 9 findings, 8 of them genuine

| Site | Verdict |
|---|---|
| `api/CollectionsPanel.vue:5` `connColorVar` | genuine — one occurrence in the file, the import line |
| `api/CollectionsPanel.vue:21` `variablesState` | genuine — one occurrence |
| `views/definition/DefinitionView.vue:38` `connectionStatus` | genuine — destructured, never read |
| `views/documents/DocumentView.vue:98` `connectionStatus` | genuine |
| `views/stream/StreamView.vue:101` `connectionStatus` | genuine |
| `views/keyvalue/KeyValueView.vue:13` `props` | genuine — `defineProps` result never read |
| `views/repo/RepoTerminalView.vue:8` `loadTerminalRenderer` | genuine — dead function |
| `views/repo/RepoFileView.vue:6` `watch` | genuine — one occurrence (§13.3) |
| `theme/primitives/TreeHost.vue:3` `StickyRowLike` | **false positive** — used only in the `<script setup lang="ts" generic="T extends StickyRowLike & { key: string }">` attribute, which Biome does not analyse |

Fix the eight; put a one-line `biome-ignore lint/correctness/noUnusedImports` on `TreeHost.vue:3`
naming the `generic` attribute as the reason. One targeted suppression beats keeping two rules off
across 201 files for a single site — the inverse of P96 §5.2's call, and correct for the inverse
ratio (1 false positive here, 12 per-line ignores there).

Net: the `**/*.vue` override loses all three of its current rules and gains the a11y entry from
§12.2. Re-read it end to end rather than patching around it.

### 13.3 One overlap with Part A

`views/repo/RepoFileView.vue`'s unused `watch` import is the same file Part A edits for the
navigation removal (§5.1 step 2). Fix it in Part A's commit, not Part B's, so the file is touched
once — and leave §13.2's table entry as the record of why.

### 13.4 The parse error

`views/repo/RepoFileView.vue:355`'s `.md-reading :deep(> *)` makes Biome's CSS parser emit
`Expected a selector but instead found '>'`. It is the only `:deep(> …)` in the repo; the other 27
files using `:deep(` parse fine. Rewrite as `.md-reading > :deep(*)`, which Vue compiles to the
identical `.md-reading[data-v-…] > *`. **Verified in this container:** with that one-line change,
`biome check` on the file reports no parse error, and reverting restores it.

## 14. Commits

Conventional Commits, in this order. Part A's steps break the build individually, so its first four
commits land as one dependency-ordered sequence, not as independently-buildable points; the Go
build is green again from `refactor(codeworkspace)` onward.

| # | Message | Contents |
|---|---|---|
| 1 | `refactor(repo)!: drop in-app code navigation` | §5.1, §5.2 — frontend nav modules, status readout, Code intelligence tab, shared nav/settings domain. `BREAKING CHANGE:` footer naming go-to-definition/hover/F12 |
| 2 | `refactor(bridge)!: drop RepoMapService and the code-index bridge surface` | §5.3 steps 1-3 |
| 3 | `refactor(codeworkspace): move EnumerateAll out of codeindex` | §5.3 step 4 — the relocation, alone, so the diff reads as a move |
| 4 | `refactor!: remove repomap, codeparse, codeindex and the internal codegraph packages` | §5.3 steps 5-7, `cmd/kira-repo-map`, `scripts/mcp-repo-map.ts`, the two `package.json` scripts, the `codeparse/testdata` entry in `biome.json`, `go.mod`/`go.sum` after `go mod tidy` |
| 5 | `chore(bindings): regenerate after the repo-map removal` | §5.4's `bun run setup` output, alone |
| 6 | `feat(storage): drop code_repos.mcp_enabled and the codeIntel settings leaf` | §6 |
| 7 | `test: drop the code-navigation and Code intelligence specs` | §1.6's test deletions and the mock/channel entries |
| 8 | `docs: record the repo-map removal` | §7.3-§7.7 — README, NOTICES, ARCHITECTURE, DEV_ENVIRONMENT, CLAUDE.md |
| 9 | `chore(biome): lint Vue template and style blocks` | §11's `html` config block, §13's rewritten `**/*.vue` override, `knip.json`'s stale `mcp:repo-map:build` comment |
| 10 | `fix(vue): fix the findings Vue-aware linting surfaces` | §12.1's 59 fixes minus §13.3's, plus §13.2's one `biome-ignore` |
| 11 | `docs(v1.9): record P97` | `SPEC.md`'s `## P97 result` section **and** the new P101 row (§12.2) |

Every commit ends with the attribution lines the session's own instructions give. Commit 11's result
section states, at minimum: that `mcpinstall`/`mcpauth` stayed and why; that `EnumerateAll` moved
rather than died; the 314/59/255 split and the P101 deferral; that `useImportType` needed no
override once templates were analysed; and any deviation from this plan.

**`--no-verify` is not available as an exit.** If a pre-commit hook fails at any point, root-cause
and fix it before the phase is reported done — `CLAUDE.md`'s rule, restated here because commits
1-4 deliberately pass through a non-building tree and the temptation is real. Use it only to park
mid-sequence work, and never on a commit that ships red.

## 15. Verification for Part B

```
bun run lint            # biome check . + check-tokens
bun run lint:all        # + golangci-lint + knip
bun run typecheck
bun run build
bun run test:unit
bun run test:ui
```

Done looks like:

- `biome check .` reports **0 errors, 0 warnings, 0 infos**, over a file count at least as large as
  today's 1181.
- `biome.json` contains `html.experimentalFullSupportEnabled: true` and
  `html.formatter.enabled: false`, and its `**/*.vue` override contains the a11y entry **and
  nothing else** — no `noUnusedImports`, no `noUnusedVariables`, no `useImportType`.
- Exactly one `biome-ignore` exists for `noUnusedImports` in a `.vue` file, on `TreeHost.vue`.
- `grep -rn 'biome-ignore' --include=*.vue apps packages` returns nothing beyond that one line and
  whatever predates this phase.
- `bun run test:ui` passes at or above P96's recorded baseline (316 tests; P96's two official runs
  landed 311 and 310 passing, with every failure dated and classified as resource contention).
  Minus the two deleted navigation tests, the expected total is 314.
- `docs/v1.9/SPEC.md` has a `## P97 result` section and a `P101` row.

## 16. Deliberately out of scope — confirmed, not forgotten

- **Biome's HTML/Vue formatter** (§11.2) — 126 files would be rewritten. A separate decision.
- **The 255 a11y findings** (§12.2) — P101, sequenced after P99.
- **Replacing in-app code navigation** (§3) — explicitly dropped by instruction.
- **`internal/mcpauth`/`internal/mcpinstall`/`internal/dbmcp`** (§1.2) — live, DB MCP's.
- **Historical chapter docs** (`docs/v1.5/`-`docs/v1.8/`, the `mcp-repo-map-issues.md` files) —
  never edited after landing.
- **Runtime cleanup of stale `${KIRA_HOME}` files** (§8) — no installed base exists, so a permanent
  housekeeping path would be permanent code for a one-off developer chore. One line in
  `docs/DEV_ENVIRONMENT.md` instead.
- **`.github/workflows/`** — grepped; no workflow references repo-map, `codeparse` or cgo build
  steps, so nothing there needs the `docs/pending-workflows/` dance.
