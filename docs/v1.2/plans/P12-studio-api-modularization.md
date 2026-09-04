# P12 — Studio/Api modularization, separability audit & rename

> **What this phase is.** `docs/v1.2/SPEC.md`'s P12 row: go back over P1–P11's output and tighten
> the Studio/Http boundary — **rename the module Http → Api**, extract what is genuinely reusable
> into a real workspace package, split any file that grew to cover both modules, audit
> `internal/bridge` and the rest of the Go side for coupling that would block splitting the Api
> module into a standalone app later, and put lint rules under the result so it does not erode
> again. **No new user-facing behaviour.** A structural pass.
>
> **What does not land here.** The UI-consistency pass (P13) and the module code review (P14).
> Also explicitly not here: the Monaco-vs-CodeMirror question (settled long ago — this repo uses
> CodeMirror and nothing in this phase reopens it), anything from the shelved v1.3 Git module
> (`docs/v1.3/` does not exist on this branch — see F1), any change to what a request *does*, any
> new bound method, any new tab kind, any new dependency, and — decisively — **`packages/api-ui`**,
> which D6 declines with a measurement rather than half-builds (`AGENTS.md`: *"Scope left out of a
> phase is left out entirely, not half-implemented"*).
>
> **Every claim below was re-read against the tree, not inherited from an earlier phase's prose.**
> Base: branch `claude/feature-v1-2` at `ccd1f25` (*"fix(grpc): replace NUL-byte select-value
> delimiter with a printable one"*). File:line citations point at that content.
>
> **Three preceding phases left this one a written instruction, and this plan answers all three.**
> P5 OQ-2 and P9 OQ-4 hand over the reveal-flow duplication (now three call sites, D13). P9 F16
> says *"`http/raw/` and `http/curl/` … P12 moves the two together"* and names the duplicated
> `goQueryEscape` (`http/raw/generate.ts:14-17`). P11's `views/grpcrequest/state.ts:21-24` says in
> so many words that its copy of `mergedValuesAndSecrets`/`collectionIdFor` is *"the coupling P12
> would have to unpick"*. P11 OQ-6 asks whether four capped-history tables should share a Go
> helper — D18 answers **no**, with the reason.
>
> **The one-sentence design.** The module is renamed **Api** wherever a name means *the mode* and
> left alone wherever it means *the HTTP protocol*; its ~2,000 lines of pure, DOM-free logic become
> a genuine Bun workspace package (`packages/api-core`) alongside a promoted `packages/shared`; the
> six `http_*` SQLite tables are renamed `api_*` by a real forward migration with a round-trip
> test; every shell↔module import that survives is either inverted, moved, or written down; and
> six new `biome.json` boundary rules make the resulting shape a lint error to break.

---

## 0. Scope, non-scope, ground rules

### 0.1 In scope

| File | What changes |
|---|---|
| `package.json` | `workspaces` gains `packages/shared` and `packages/api-core` (D5); `test:unit` runs both suite directories (D19) |
| `packages/shared/package.json` | **new** — `@kira/shared`, the source-only directory promoted to a real package (D5) |
| `packages/api-core/package.json`, `tsconfig.json`, `README.md` | **new** — `@kira/api-core` (D5, D6) |
| `packages/api-core/src/**` | **new (moved)** — `substitute.ts`, `substituteRequest.ts`, `curl/*`, `raw/*`, `dynamic/*`, `body.ts`, `url.ts`, `http/saved.ts`, `grpc/saved.ts` (D7) |
| `packages/api-core/test/**` | **moved** — `http-curl.spec.ts`, `http-raw-parse.spec.ts`, `http-substitution.spec.ts` (D19) |
| `packages/shared/domain/editor.ts` | **new** — `EditorLanguageId`, lifted out of `frontend/src/editor/languages.ts` so `body.ts` can leave the app (F14) |
| `packages/shared/domain/mode.ts` | `AppMode` becomes `'studio' \| 'api'` (D2 — in-memory only, F16) |
| `packages/shared/domain/variables.ts` | `HttpVariable`/`HttpEnvironment`/`HttpVariableHistoryEntry` → `Api*` (D3); dead `REVEAL_OUTCOMES` removed (F22) |
| `packages/shared/domain/collections.ts` | `HttpSavedGrpcRequest` → `GrpcSavedRequest` and its schema/default (D3) |
| `packages/shared/domain/tabs.ts` | imports move to `@kira/api-core`; `TAB_KIND_MODE`'s value becomes `'api'` (D2) |
| `apps/kira-studio/frontend/src/http/**` → `.../src/api/**` | directory rename; `grpc/target.ts` **deleted** (F21); `state/*` keeps its dialogs and stores (D4) |
| `apps/kira-studio/frontend/src/api/tabs.ts` | **new** — the twelve `openHttpRequestTab`-family functions moved out of `state/tabs.ts` (D9) |
| `apps/kira-studio/frontend/src/api/reveal.ts` | **new** — the one recurse-once reveal loop the module's three call sites share (D13) |
| `apps/kira-studio/frontend/src/api/state/history.ts` | **new** — `createHistoryStore`, the factory behind both protocols' history runtimes (D12) |
| `apps/kira-studio/frontend/src/views/httprequest/**`, `views/grpcrequest/**` | **kept where they are** (D8); imports rewritten; `history.ts` reduced to a factory call |
| `apps/kira-studio/frontend/src/state/tabs.ts` | `openTab`/`patchTabState` exported; every Api-specific function and import removed (D9) |
| `apps/kira-studio/frontend/src/state/tabKinds.ts`, `workbench/tabViews.ts`, `workbench/modes.ts`, `workbench/TitleBar.vue`, `shortcuts/state.ts`, `App.vue` | the host's own wiring, retargeted at the new names (D2, D4) |
| `apps/kira-studio/frontend/src/api/ApiDialogs.vue` | **new** — the one component `App.vue` mounts in place of eleven imports (C12, F19) |
| `apps/kira-studio/frontend/src/theme/primitives/PanelShell.vue` | **moved** from `workbench/panels/LeftPanel.vue` (D10) |
| `apps/kira-studio/frontend/src/bridge/control.ts` + `apiControl.ts` | split 106 → 67 + 39 methods, composed into the same exported `control` object (D11) |
| `apps/kira-studio/internal/httpvars/` → `internal/apivars/` | package rename; `Service`, `Resolver`, `RevealResult` unchanged (D3) |
| `apps/kira-studio/internal/appcore/deps.go` | `Deps.HttpVars` → `Deps.ApiVars` (D3) |
| `apps/kira-studio/internal/storage/migrations/0010_p12_api_rename.sql` | **new** — six `ALTER TABLE … RENAME TO`, eight index renames (D14, D15) |
| `apps/kira-studio/internal/storage/migrations/embed.go` | the tenth entry |
| `apps/kira-studio/internal/storage/repos/{collections,variables,response_history,grpc_history}.go` | table names in every SQL string (D14) |
| `apps/kira-studio/internal/storage/migrations/migrate_rename_test.go` | **new** — the 1→9 / 10 round-trip proof (D15, §6.3) |
| `biome.json` | six new/tightened boundary rules (D16) |
| `apps/kira-studio/tests/ui/*.spec.ts`, `tests/ui/support/mockRuntime.ts`, `tests/unit/*` | the renamed mode value, the renamed testids, the split parity spec (D19) |
| `docs/ARCHITECTURE.md` | the module-boundary section rewritten for the shipped shape; the storage table names; the rename's own migration paragraph |
| `docs/v1.2/SPEC.md` | **untouched** — `docs/v1.2/README.md` forbids retro-editing a spec (F2); this plan is where P12 re-scopes itself |
| `AGENTS.md` | nothing — no new environment fact |

### 0.2 Out of scope, explicitly

- **`packages/api-ui`.** D6 declines it with a measurement (90 of 287 renderer files import
  `theme/**`; the package needs a `packages/ui-kit` extraction first, which is a Studio-wide
  refactor landing directly under P13's feet). §8 OQ-1 proposes it as its own SPEC row rather than
  leaving it half-done here.
- **Renaming `internal/httpclient`, `internal/grpcclient`, `internal/postman`,
  `views/httprequest/`, `views/grpcrequest/`, the tab kinds `'http-request'`/`'grpc-request'`, the
  op kinds `'http'`/`'grpc'`, or `http_items.protocol`'s `'http'`/`'grpc'` values.** Every one of
  those names a protocol or a file format, not the module (D1's line, F5's table). Three of them
  are also persisted discriminants (F16) that would need a migration for no gain at all.
- **Extracting the op scheduler out of `internal/adapterhost`.** F12 measures the coupling and D17
  declines the move: `RunOp` is written against `adapters.OpCtx`/`adapters.New`/`oplog`, and the
  Api module joining Studio's *one* op log is a deliberate, documented design
  (`docs/ARCHITECTURE.md`'s "The op log records one connectionless op kind" paragraph), not an
  accident to undo.
- **Splitting `internal/storage/{model,repos}` along module lines.** F11 maps the entanglement
  (`model` → `httpclient`, `postman` → `model`, `repos` → `postman`); D17 writes it down as the
  named blocker to a standalone Api app and does not move it, because the SPEC's P12 row asks the
  Go side for an *audit*, and the move would rewrite five prepared-statement constructors and every
  repo test for zero behaviour change.
- **A `repos/capped.go` helper for the four insert-then-trim tables** (P11 OQ-6). D18 declines,
  with the reason.
- **Monaco vs CodeMirror.** Settled; not reopened, not measured, not mentioned again.
- **Anything from `docs/v1.3/` (the Git module).** F1: that directory does not exist on this
  branch. The SPEC's *"matching the precedent v1.3's Git module sets"* is aspirational language
  about a shelved chapter; D6 says so out loud rather than designing against a file nobody can read.
- **Any behaviour change.** Every UI spec in `tests/ui/` must pass with only mechanical edits
  (renamed mode value, renamed testids). §6.5 makes that a diff check.

### 0.3 Ground rules

- **A rename that touches persisted data needs a migration or a compat shim, and this plan says
  which for every one.** F16 enumerates the five persisted vocabularies that carry the word
  "http"; D2/D14 decide each individually. `docs/ARCHITECTURE.md:415`'s own precedent — the
  keychain service name, renamed while *"the app has not shipped … this is the last time the name
  can change for free"* — is the reasoning applied here, one table at a time.
- **The line between module and protocol is drawn once, in D1, and every rename decision cites
  it.** `docs/v1.2/SPEC.md`'s boundary section states the rule; this plan turns it into a
  file-by-file table (F5) so no later reader has to re-derive it.
- **No sentinel, delimiter or marker introduced by this phase may be a control character.**
  `ccd1f25` — the commit this plan is based on — exists because `GrpcRequestView.vue` joined a
  service and method name with a literal NUL byte, which made git treat the whole SFC as binary and
  destroyed its diffs permanently (the fix commit itself still shows as `Bin 11254 -> 11253 bytes`,
  because the *pre-image* was binary). This phase moves and rewrites ~60 files with scripted edits;
  every one must stay UTF-8 text, and any new sentinel (a lint-rule group separator, a migration
  marker) stays printable ASCII.
- **A directory move is not a boundary.** `docs/v1.2/SPEC.md` says so explicitly, and this plan
  agrees: the enforcement is `biome.json` (D16), and the proof that `packages/api-core` is real is
  that it type-checks and tests with no `apps/` on its path at all (§6.2).
- **The pre-commit hook runs `bun run lint` and `bun run typecheck`** (`.githooks/pre-commit`), so
  every commit in §5 is green on both by construction. The expensive suites run once at the end,
  per `AGENTS.md`.

---

## 1. What the code does today

### 1.1 The module is three renderer directories, four Go packages, and six bound services

Measured at `ccd1f25`:

| Half | Where | Lines |
|---|---|---|
| Renderer, module-level | `frontend/src/http/` (33 files: collections tree/panel/row, six dialogs, `state/*`, `curl/*`, `raw/*`, `dynamic/*`, `substitute*.ts`, `menus.ts`, `grpc/target.ts`) | 5,205 |
| Renderer, HTTP tab | `frontend/src/views/httprequest/` (26 files) | 3,431 |
| Renderer, gRPC tab | `frontend/src/views/grpcrequest/` (7 files) | 1,585 |
| Wire/domain mirrors | `packages/shared/domain/{http,grpc,collections,variables,response-history,grpc-history}.ts` | 878 |
| Go, protocol | `internal/httpclient/` + `internal/grpcclient/` | 5,478 |
| Go, module | `internal/httpvars/` + `internal/postman/` | 1,662 |
| Go, bridge | `bridge/{http,grpc,collections,variables,responsehistory,grpchistory}.go` | 1,455 |
| Go, storage | four `repos/*.go` + four `model/*.go` | 2,651 |

≈22,000 lines, about a third of the renderer's 287 source files. `main.go:223-228` registers six of
its nineteen bound services for this module — `HttpService`, `GrpcService`, `CollectionsService`,
`VariablesService`, `ResponseHistoryService`, `GrpcHistoryService`.

### 1.2 The mode seam is one string, and it is not persisted

`packages/shared/domain/mode.ts:3` is the whole vocabulary: `export type AppMode = 'studio' |
'http'`. `state/mode.ts:10` holds `modeState.active` in a bare `reactive({...})`;
`state/tabs.ts:216` sets it from the boot tab's own kind; `state/tabs.ts:87` keys
`activeIdByMode` on it; `workbench/TitleBar.vue:10` orders the two tabs;
`workbench/modes.ts:20-23` maps each to a label, an icon, a left panel and a start page. There is
no `mode` column, no settings key, no layout leaf — `docs/ARCHITECTURE.md`'s *"a tab's mode is a
function of its kind; switching modes writes nothing"* is exactly true, and a `grep` for `'http'`
across `packages/shared/domain/{layout,settings,shortcuts}.ts` returns nothing.

### 1.3 What the module reaches into the shell for

Every import specifier appearing in `http/**`, `views/httprequest/**` and `views/grpcrequest/**`,
counted:

| Target | Count | What it is |
|---|---|---|
| `@shared/domain/*` | 66 | wire/domain mirrors — 22 of them `domain/http`, 15 `domain/tabs` (`HttpRequestTabRecord`/`GrpcRequestTabRecord` only) |
| `../../state/tabs` | 20 | `openHttpRequestTab`, `patchHttpRequestTabState`, `findHttpRequestTab`, … — the Api-specific half of a shell file (§1.4) |
| `theme/primitives/*` | 43 | `IconButton`, `AppButton`, `DialogFrame`, `MessageStrip`, `TextField`, `SegmentedControl`, `EmptyState`, `ViewChrome`, `PanelSplitter`, `TreeHost`, `PopoverPanel` |
| `../../bridge/control` | 9 | 39 of `control`'s 106 methods |
| `../../format`, `../../beautify`, `../clipboard` | 13 | three app-root utility modules, shared with Studio |
| `../shared/viewOp` | 4 | `createRuntimeStore`, `classifyLoadError`, `stopOp` |
| `../../editor/*` | 8 | `CodeMirrorHost.vue`, `languages` (a *type*), `theme` |
| `../../state/tabRuntime` | 4 | `registerTabRuntimeCleanup` |
| `../shortcuts/commands`, `../shortcuts/keys` | 3 | `registerCommand`, `shortcutFor` |
| `../state/confirmDialog`, `../state/contextMenu`, `../state/settings` | 5 | app-wide singletons |
| `../state/connections` | 1 | **`connectionsState.secretStorage`** (`http/VariablesDialog.vue:4,227-245`) |
| `../workbench/panels/LeftPanel.vue` | 1 | `http/CollectionsPanel.vue:7` |
| `../shared/celleditor/formats` | 1 | `beautifyFor`/`canBeautify` (`views/httprequest/RequestBodyPane.vue:10`) |
| `@shared/domain/object-store` | 1 | `contentTypeForFilename` (`views/httprequest/FormDataTable.vue:3`) |

The single genuinely surprising one is `state/connections`: the Api module asks **Studio's
connection store** whether OS secret storage is available, because
`control.connectionsSecretsStatus()` is a method on `ConnectionsService`
(`bridge/control.ts:244-245`, `state/connections.ts:33,55`).

### 1.4 What the shell reaches into the module for — the reverse direction, which no rule forbids

`biome.json:129-147` stops `http/**` from importing `project/**` and `views/**`. Nothing stops the
traffic the other way, and there is real traffic:

- **`state/tabs.ts:51-52`** imports `views/grpcrequest/saved` and `views/httprequest/saved`, and
  `:406-492,723-776` define twelve Api-specific exported functions (`openHttpRequestTab`,
  `openCollectionRequestTab`, `renameHttpRequestTabs`, `patchHttpRequestTabState`,
  `findHttpRequestTab` and their gRPC twins) inside a 780-line shell file.
- **`state/tabKinds.ts:54`** imports `httpRequestTitle` from `views/httprequest/url`.
- **`workbench/tabViews.ts:8-9`** imports both view components. *This one is correct* — it is the
  registry `docs/ARCHITECTURE.md` describes as the designed mount point.
- **`shortcuts/state.ts:6,23`** imports `openHttpRequestTab`, and `:23-48` hard-codes ten
  `http.*` palette entries.
- **`App.vue:4-15`** imports six Api dialogs and five Api dialog stores directly.

### 1.5 The Go dependency graph, and where it entangles

```
internal/storage/model   ──imports──▶  internal/httpclient      (model/responsehistory.go:6)
internal/postman         ──imports──▶  internal/storage/model   (body/collection/parse/write.go)
internal/storage/repos   ──imports──▶  internal/postman         (collections.go:12, variables.go:12)
internal/storage/repos   ──imports──▶  internal/httpclient      (response_history.go:9)
internal/httpvars        ──imports──▶  httpclient, localauth, secrets, storage/repos
internal/appcore(Deps)   ──imports──▶  httpvars + connections + tree + adapterhost + repos
internal/bridge          ──imports──▶  everything above
```

No cycle (`model` and `repos` are distinct packages), but the shared storage trunk carries Api
types both ways: `model.ResponseHistorySnapshot` embeds `httpclient.Response` **by value**
(`model/responsehistory.go:44`), and `repos.CollectionsRepo` speaks `postman.Tree`/`postman.Item`
(`repos/collections.go:600,669`). `repos.Repos` (`repos/repos.go:14-29`) is one struct with all
fifteen repos, four of them Api's; `appcore.Deps` is one struct every bound service embeds by
value, carrying Studio's `Connections`/`Tree`/`Router` into `HttpService` and Api's `HttpVars` into
`ConnectionsService`.

### 1.6 What is persisted, and which of it carries the name

From `internal/storage/migrations/*.sql` and `docs/ARCHITECTURE.md`'s schema block:

| Persisted thing | Values / names | Names the… |
|---|---|---|
| Table names | `http_collections`, `http_items`, `http_environments`, `http_variables`, `http_variable_history`, `http_response_history` (`grpc_call_history` already correct) | **module** — `http_items` holds gRPC requests, `http_variables` resolves for gRPC calls |
| Index names | `http_items_tree`, `http_variables_collection`, `http_variables_environment`, `http_variable_history_var`, `http_response_history_{scope,age,tab}` | **module** |
| `tabs.kind` | `'http-request'`, `'grpc-request'` | protocol |
| `op_log.kind` | `'http'`, `'grpc'` | protocol |
| `http_items.protocol` | `'http'`, `'grpc'` | protocol |
| `http_items.kind` | `'folder'`, `'request'` | neither |
| `AppMode` | `'studio'`, `'http'` | **module — but not persisted at all** (§1.2) |
| Command ids | `http.save`, `http.import`, `http.copyAsCurl`, … | **module — in-memory registry only** (`shortcuts/commands.ts:5`) |

There are no views and no triggers anywhere in the schema, and `migrate.go:53-61` applies each
migration inside its own transaction on a connection whose DSN sets `_foreign_keys=1`
(`db.go:35`).

### 1.7 The lint rules that exist, and the holes in them

`biome.json` has three `noRestrictedImports` overrides:

- `:66-105` — `views/**` may not import `workbench/**`, and no `views/<kind>/**` may import another
  (the group list at `:79-98` names `httprequest` and `grpcrequest`, P11's own addition).
- `:109-122` — `project/**` may not import `views/**`.
- `:129-147` — `http/**` may not import `project/**` or `views/**`.

Four holes: **(a)** nothing stops `project/**` importing `http/**`; **(b)** nothing stops
`state/**` or `shortcuts/**` importing the module's views (§1.4 shows both do); **(c)** there is no
rule at all under `packages/`, so nothing would stop a future `packages/api-core` file importing
`vue` or reaching back into `apps/`; **(d)** `http/**` has no rule against `workbench/**`, which is
how `CollectionsPanel.vue:7` reaches `LeftPanel.vue`.

### 1.8 The build plumbing a package has to satisfy

Three things resolve `@shared/*` today and would have to keep doing so: `vite.config.ts:31-38`'s
alias block, `frontend/tsconfig.json:15`'s `paths` (plus its `include` of
`../../../packages/shared/**/*.ts`), and both test tsconfigs
(`tsconfig.tests.json:11`, `tests/unit/tsconfig.json:11`). Root `workspaces` is
`["apps/*/frontend"]`, so today's `packages/` directory is not a workspace at all — the shape
`docs/v1.2/SPEC.md` calls *"source-only, reached via a `@shared/*` path alias with no independent
`package.json`, build, or test"*. The frontend workspace package
(`frontend/package.json`, `@kira/kira-studio-frontend`) declares **zero dependencies of its own**;
everything is hoisted from the root manifest, so a new package that declares `zod`/`shlex`/
`@faker-js/faker` is the first in this repo to name its own runtime deps.

`frontend/bindings/**` is gitignored and regenerated (`AGENTS.md`), so no committed file depends on
its layout except through the two aliases.

### 1.9 The tests, and which files cover both modules

`tests/ui/` has 41 specs, nine of them Api-only (`http-*.spec.ts`, `grpc-request.spec.ts`,
`collections.spec.ts`). **`mode-switch.spec.ts` is the one genuinely cross-module spec** — it drives
Studio's create/connect/expand flow *and* Http mode, by design (it tests the seam). `tests/unit/`
has four Api specs; **`go-ts-vocabulary-parity.spec.ts` covers both** — its first `describe`
(`:54-76`) checks the tab- and op-kind vocabularies, which span Studio and Api, while `:77-110`'s
three describes are Api-only.

---

## 2. Findings

**F1 — `docs/v1.3/` does not exist on this branch.** `ls docs` returns `v1`, `v1.1`, `v1.2` only;
`grep -rn "api-core" docs` matches nothing but `SPEC.md`'s own P12 row. The SPEC's *"matching the
precedent v1.3's Git module sets"* therefore names a precedent this phase cannot read, let alone
match. D6 designs from this tree instead.

**F2 — `docs/v1.2/README.md:11-16` forbids retro-editing `SPEC.md`.** *"All three are kept exactly
as originally written once a phase starts."* So the SPEC's `views/httprequest/ → views/apirequest/`
line stays on the page even though D8 declines it; this plan is the record of the re-scope, which
is exactly what `SPEC.md:109-112` says a plan doc is for (*"later rows here may be re-scoped by
their own plan docs"*).

**F3 — `AppMode` is never written anywhere.** Traced every reader (§1.2). `state/tabs.ts:216`
derives it, `TitleBar.vue` renders it, `modes.ts` keys a registry on it. No `settings` key, no
`ui_layout` leaf, no column. **Renaming `'http'` → `'api'` costs one `sed` and no migration.**

**F4 — the command ids are the same story.** `shortcuts/commands.ts:5` is a
`Map<string, () => void>` populated on mount and cleared on unmount; `shortcuts/state.ts:19-48` is
a plain array. Nothing serialises either. `views/grpcrequest/GrpcRequestView.vue:191` registers
**`'http.save'`** — a gRPC view answering to a command id named after HTTP, which is the rename's
own argument in one line.

**F5 — the module/protocol line, drawn file by file.** Applying D1's rule to every name that
contains "http":

| Name | Verdict | Why |
|---|---|---|
| `internal/httpclient` | protocol — **keep** | `net/http`, body modes, redirects, `httptrace`. Nothing gRPC touches it |
| `internal/grpcclient` | protocol — keep | symmetric |
| `internal/postman` | file format — keep | Postman Collection v2.1, not a protocol and not the module |
| `internal/httpvars` | **module — rename `apivars`** | `bridge/grpc.go:17` imports it; it resolves `{{name}}` for gRPC targets, metadata and messages |
| `frontend/src/http/` | **module — rename `api/`** | contains `grpc/target.ts`, `state/collections.ts`'s `protocol: 'grpc'` branch, `CollectionRow.vue`'s gRPC chip |
| `views/httprequest/`, `views/grpcrequest/` | protocol — keep (D8) | one directory per tab kind, the convention every other `views/<kind>/` follows |
| `'http-request'`, `'grpc-request'` tab kinds | protocol — keep | and persisted (F16) |
| op kinds `'http'`, `'grpc'` | protocol — keep | and persisted |
| `HttpBodyWire`, `HttpHeaderWire`, `HttpResponseWire`, `HttpTimeline`, `httpMethodClass`, `statusHint` | protocol — keep | |
| `HttpVariable`, `HttpEnvironment`, `HttpVariableHistoryEntry` | **module — rename `Api*`** | a variable is resolved for both protocols |
| `HttpSavedRequest` | protocol — keep | the *HTTP* request document |
| **`HttpSavedGrpcRequest`** | **module prefix on a gRPC type — rename `GrpcSavedRequest`** | matches Go's own `model.SavedGrpcRequest` |
| Go `Deps.HttpVars`, `HttpService`, `HttpSendArgs`, `mapHttpError` | `HttpVars` module (rename); the other three protocol (keep) | a full `grep` over `internal/` returns exactly these four spellings |
| six `http_*` tables + eight `http_*` indexes | **module — rename (D14)** | |

**F6 — `packages/api-core`'s candidate set is 1,999 lines and imports nothing from the app.**
`http/{substitute,substituteRequest}.ts`, `http/curl/*` (913), `http/raw/*` (260),
`http/dynamic/*` (215), `views/httprequest/{body,url,saved}.ts` (352),
`views/grpcrequest/saved.ts` (83). Their entire non-relative import surface is `@shared/domain/*`,
`shlex`, `@faker-js/faker/locale/en` — plus **one exception**, F14.

**F7 — `views/httprequest/files.ts` is the one candidate that is not pure.** It imports
`../../bridge/control` (`files.ts:6`) for `filesChooseOpen`. It stays in the app.

**F8 — 90 of 287 renderer files import `theme/**`, and 33 import `editor/**`.** Measured by
`grep -rl`. This is the number that decides D6: a `packages/api-ui` cannot exist until
`theme/primitives/**` does, and moving `theme/` rewrites the imports of nearly a third of the
renderer — including `primitives.css`, which `docs/v1.2/SPEC.md`'s **P13 row names as its own
reference point**.

**F9 — `views/{httprequest,grpcrequest}/history.ts` are the same 100 lines twice.** Same
`createRuntimeStore` shape, same `{entries, loading, stale, viewing, error}` runtime, same seven
functions (`load`, `ensureLoaded`, `noteRecorded`, `viewEntry`, `backToLatest`, `deleteEntry`,
`clear`), same tab-closed-mid-flight guards, differing only in the four `control` methods, the two
snapshot types, the tab finder, and HTTP's extra `selected: string[]` compare list. P8 wrote the
first; P11 copied it verbatim and said so (`views/grpcrequest/history.ts:6-8`).

**F10 — `mergedValuesAndSecrets` and `collectionIdFor` are duplicated, and P11 wrote down that P12
owns it.** `views/httprequest/state.ts:104-129` and `views/grpcrequest/state.ts:25-48` are
character-identical apart from the tab-state type. `views/grpcrequest/state.ts:21-24`:
*"This duplicates views/httprequest/state.ts's own mergedValuesAndSecrets/collectionIdFor rather
than importing them — views/grpcrequest/** may not import views/httprequest/** … the same 'a few
lines is the coupling P12 would have to unpick' trade."* Both functions read only
`http/state/{collections,variables}.ts` — which **both views already import** — so the fix is a
move, not an abstraction.

**F11 — the Go storage trunk carries Api types in both directions.** §1.5's graph. Concretely:
deleting `internal/httpclient` from a hypothetical Studio-only build breaks
`model/responsehistory.go`, `repos/response_history.go`; deleting `internal/postman` breaks
`repos/collections.go` and `repos/variables.go`.

**F12 — the op scheduler is Studio-shaped and deliberately shared.** `adapterhost.Host.RunOp`
(`host.go:123-190`) mints an `adapters.OpCtx`, returns `adapters.New(...)` errors, emits through
`oplog`, and gates on a per-connection throttle it skips when `spec.ConnectionID == nil`.
`bridge/http.go:68` and `bridge/grpc.go:178` both pass `ConnectionID: nil`. Extracting a
protocol-agnostic scheduler means either moving `adapters.OpCtx`/`adapters.Error` out of the
adapter package or inventing a second error vocabulary — and `docs/ARCHITECTURE.md` already
justifies the sharing (*"a second one would mean either a dead ring on every HTTP tab or a second
`useRunState`/ops store"*).

**F13 — `bridge/control.ts` is one 605-line file, 39 of whose 106 methods are Api's.** Counted by
prefix (`httpSend`, `grpc*`, `onGrpcCall`, `collections*`, `variables*`, `history*`,
`grpcHistory*`). Everything in `http/**` and both view directories that talks to Go imports this
one object, so the Api module's binding surface is, today, the whole app's.

**F14 — `views/httprequest/body.ts:8` imports a *type* from `editor/languages.ts`, whose module
body imports four CodeMirror packages.** `verbatimModuleSyntax` erases the import at build time, so
there is no runtime coupling — but a package cannot type-check against a file it cannot resolve.
`EditorLanguageId` is a six-member string union declared at `editor/languages.ts:9`; lifting it to
`packages/shared/domain/editor.ts` costs one file and one re-export.

**F15 — `internal/httpvars/testdata/substitution.json` is read by a Go test and a TS test by
relative path.** `tests/unit/http-substitution.spec.ts:7-9` resolves it from the spec's own
location. Both the package rename (`httpvars` → `apivars`) and the spec's move into
`packages/api-core/test/` change that path. It is the one file in this phase touched by two
different renames at once.

**F16 — five persisted vocabularies contain "http"; only one group needs a migration.** §1.6's
table. `tabs.kind`, `op_log.kind` and `http_items.protocol` are protocol names and are left alone.
`AppMode` and the command ids are not persisted at all (F3, F4). That leaves the six table names
and eight index names — D14.

**F17 — SQLite renames tables safely here, and the schema has nothing that complicates it.** No
views, no triggers (`grep -in "CREATE VIEW\|CREATE TRIGGER" migrations/*.sql` → empty), so
`ALTER TABLE … RENAME TO` cannot fail on an unparseable dependent object. `db.go:35` sets
`_foreign_keys=1` on every pooled connection, which is the condition under which SQLite rewrites
other tables' `REFERENCES` clauses to follow the rename — the property `grpc_call_history.item_id
REFERENCES http_items(id) ON DELETE CASCADE` and `http_response_history`'s own FK depend on.
`http_response_history.scope_key` is `GENERATED ALWAYS AS (COALESCE(item_id, 'tab:' || tab_id))`,
which references only its own columns and is unaffected. **SQLite has no `ALTER INDEX RENAME`**, so
the eight index names need `DROP INDEX` + `CREATE INDEX`.

**F18 — `migrations/embed.go` collapsed 0001–0005 once, and must not do it again.** Its own comment
says the collapse was safe because *"the app has never shipped, so there is no installed base with a
partially-applied schema"* — but 0006–0009 are on every developer's `kira.sqlite` today, and
`migrate.go:41-45` refuses outright to run against a database whose `schema_version` is newer than
the build knows. A tenth forward migration is the only correct shape.

**F19 — `frontend/src/api/`'s dialogs are mounted six-at-a-time by `App.vue`.** `App.vue:4-15`:
six component imports and five store imports, one line each, interleaved with nothing else. The
host mounts a module's dialogs individually rather than through one module entry point.

**F20 — `http/CollectionsPanel.vue:7` is the module's only `workbench/**` import, and the file it
reaches for is generic.** `workbench/panels/LeftPanel.vue` owns "header geometry, the search
reveal/toggle and the VS-Code-style type-ahead redirect" (`docs/ARCHITECTURE.md`) and is mounted
by exactly two callers — `ProjectPanel.vue` (Studio) and `CollectionsPanel.vue` (Api). It is a
primitive living in the wrong directory.

**F21 — `http/grpc/target.ts` is dead code.** `grpcMethodDisplay` returns `method || ''` and
`grpcTargetDisplay` returns `target.trim()`; a repo-wide `grep` for either name outside the file
returns nothing. P11 created it for a sharing that never happened.

**F22 — eleven more exports in `http/**` have no importer outside their own file**, and one more in
`packages/shared`. `REVEAL_OUTCOMES` (`domain/variables.ts:44`), `collectionKey`, `itemKey`,
`loadCollections`, `revealItem` (`state/collections.ts`), `activeEnvironment`, `loadEnvironments`
(`state/variables.ts`), `summarizeParsed` (`state/curl.ts`), `RAW_EDITABLE_BODY_MODES`
(`raw/generate.ts`), `FLAG_TABLE` (`curl/flags.ts`), plus type-only ones. Harmless today; they are
exactly what a package's public surface must not include tomorrow.

**F23 — `clearGrpcHistory` (`views/grpcrequest/history.ts:100`) is exported, implemented, backed by
a real bound method, and wired to nothing.** `grpcrequest/ResponsePane.vue` imports
`deleteGrpcHistoryEntry`, `ensureGrpcHistoryLoaded`, `viewGrpcHistoryEntry` — not `clear`. The HTTP
pane has a Clear action; the gRPC pane does not. **This is a feature gap, not a structural one** —
§8 OQ-3 hands it to P13 rather than fixing it in a phase whose row says *"no new user-facing
behaviour"*.

**F24 — the palette has ten `http.*` entries and no gRPC one.** `shortcuts/state.ts:23` offers
*New request*; there is no *New gRPC request*, even though `HttpStart.vue:36` and
`http/menus.ts` both offer it. Same verdict as F23: recorded, handed to P13.

**F25 — the Api module has no `tests/e2e-real/` coverage at all.** That tier has five specs
(`mariadb-real`, `postgres-real`, `sqlite-real`, `multiwindow-real`, plus `fixtures.ts`), every one
of them Studio. A repo-wide grep for `http-request`, `collections` or `mode-tab` under
`tests/e2e-real/` returns nothing. So the module's entire behavioural coverage is `tests/ui/` —
nine specs against `mockRuntime.ts`'s intercepted bindings, with no run against a real
`-tags server` binary and a real `kira.sqlite`. That is a *coverage* observation, not a structural
one, and building such a spec is not this phase's job — but it is why §6.3's manual
real-database check exists, and why it is manual: there is no harness to add it to.

**F26 — Tailwind v4 discovers its sources from the Vite root, which is the app's frontend
directory.** `theme/base.css:1` is `@import "tailwindcss"` with no `@source` directive, and
`@tailwindcss/vite` auto-detects from the project root (`vite.config.ts`'s own directory,
`apps/kira-studio/frontend/`), skipping gitignored paths. `packages/api-core` contains **no
templates and no class names** (D7 moves only `.ts` logic), so this phase is unaffected — but a
future `packages/api-ui` full of `.vue` templates would silently lose every utility class until an
explicit `@source "../../packages/api-ui/src"` is added. Recorded against OQ-1, where it will
otherwise be discovered as a mysteriously unstyled dialog.

**F27 — after D5, the same file is reachable by two specifiers, and that is safe.** The app keeps
importing `@shared/domain/http` through the Vite/tsconfig alias while `packages/api-core` imports
`@kira/shared/domain/http` through the workspace link. TypeScript's module identity is the resolved
**file path**, not the specifier, so both yield one set of types and one `zod` schema instance —
there is no duplicate-declaration hazard and no second `zod` in the bundle. The mitigation if it
ever becomes confusing is a pure specifier swap (point the app at `@kira/shared` too), which is why
D5 keeps the `@shared/*` alias rather than deleting it.

**F28 — `bun install` must re-run after the `workspaces` change, and the pre-commit hook depends on
`node_modules` existing.** `.githooks/pre-commit:8-11` aborts if `node_modules` is missing, and
runs `bun run lint` + `bun run typecheck` on every commit. So C7 (the manifests) must be followed by
an install before C8's moves are committed, and `bun.lock` changes in C7 — one commit, visible,
rather than smeared across the phase.

**F29 — the Go package rename changes a *generated* bindings path.**
`bridge/variables.go:203,216` return `httpvars.RevealResult` by value, so Wails emits a model file
under `frontend/bindings/.../internal/httpvars/models.ts` and `variablesservice.ts` imports it.
That whole tree is gitignored, so nothing is committed — but a developer's existing
`frontend/bindings/` will keep a stale `internal/httpvars/` directory after C9, and Vite resolves
real files on disk. `rm -rf apps/kira-studio/frontend/bindings` before regenerating is part of C9,
not an afterthought. (`control.ts:25` imports only `@bindings-internal/storage/model/models.js`, so
no committed source references the renamed path.)

**F30 — inside `internal/bridge`, the two modules already share nothing but the package clause.**
The package declares four unexported helpers across its nineteen service files —
`downloadsDir`, `wailsFilter`, `wailsVersion` (Studio/app) and `newGrpcServiceForTest` (Api, in a
`_test.go`). Not one of the six Api files references a Studio one, and vice versa. So the "one Go
package holds both modules" coupling is a *namespace* fact, not a call-graph fact — which is what
lets D17 accept it instead of paying the FQN-rewrite cost of a package split (§3).

---

## 3. Checked, and not fired

- **Whether the two `saved.ts` files duplicate each other.** They do not:
  `views/httprequest/saved.ts` maps eleven HTTP body/header fields, `views/grpcrequest/saved.ts`
  maps eleven gRPC target/TLS/descriptor fields. Same *shape*, disjoint content. No extraction.
- **Whether `http_response_history` and `grpc_call_history` should merge.** P11 D11/F19 measured
  this and said no; re-reading both `CREATE TABLE`s confirms the columns genuinely differ
  (`status`/`redirects` vs `code`/`code_name`/`streaming`/`message_count`). Not reopened.
- **Whether `views/httprequest/` and `views/grpcrequest/` should merge into one polymorphic view.**
  P11 D13's four reasons still hold at `ccd1f25`, and its fourth is about this phase by name:
  *"two sibling protocol directories under one mode move as cleanly as one."* Not reopened.
- **Whether the substitution engine's two implementations (TS + Go) should become one.** P5 D17's
  reasoning (a template library HTML-escapes and has no seam for the per-reference report) is
  unchanged, and the shared corpus (`substitution.json`) is the guard. This phase only moves files;
  the corpus path changes (F15) and nothing else.
- **Whether `beautify.ts`/`format.ts`/`clipboard.ts` should move.** They are shared by both modules
  (13 Api call sites, 26 Studio ones) and live at the renderer root, which is already the neutral
  place for them. They would move only as part of `packages/ui-kit`, which D6 declines.
- **Whether `bridge` should split into `bridge` + `bridge/api` Go packages.** It would change every
  bound method's fully-qualified name — the `BRIDGE_PKG` constant at
  `tests/ui/support/mockRuntime.ts:33` plus 106 `FQN_SUFFIX_BY_IPC_KEY` entries, and the
  `@bindings/*` Vite/tsconfig aliases — for no compile-time boundary Go's own `internal/` rules
  don't already give. Declined; D17 records the per-file separation that is already there.

---

## 4. Decisions

### D1 — One rule decides every rename: does the name mean *the mode*, or *the wire protocol*?
`docs/v1.2/SPEC.md`'s boundary section states it; F5 applies it name by name. The operational test,
stated so a later reader can apply it without re-deriving: **if the thing it names also serves gRPC,
it names the module.** `internal/httpvars` resolves gRPC targets → module. `http_items` stores gRPC
requests → module. `internal/httpclient` never runs for a gRPC call → protocol. `'http-request'`
names one of two sibling tab kinds → protocol.

The rule's most useful consequence is negative: it stops the rename from becoming a global
find-and-replace. Of the four Go identifiers containing "Http" (F5), exactly one changes. Of the
eleven `Http*` types in `packages/shared/domain`, four change.

### D2 — `AppMode` becomes `'studio' | 'api'`, with no migration, because nothing persists it
F3 traced every reader and every writer; there is no writer. The change is
`packages/shared/domain/mode.ts:3`, `TAB_KIND_MODE`'s two values, `state/tabs.ts:87`'s
`activeIdByMode` initialiser and `:207`'s loop literal, `TitleBar.vue:10`'s `MODE_ORDER`,
`modes.ts`'s registry key, and `MODES.api.label` — *"Http"* → **"Api"**.

`HttpStart.vue`'s subtitle (*"Send an HTTP request and see its response here."*) becomes
*"Send a request and see its response here."* in the same commit — one line, and leaving it would
have the renamed mode's own front door still claiming to be HTTP-only while offering a **New gRPC
request** button directly beneath it (`HttpStart.vue:36-38`). The file itself is renamed
`api/ApiStart.vue`.

**The `data-mode="http"` attribute** (`TitleBar.vue:25`, asserted by four UI specs) follows the
value, since it *is* the value. §6.5's diff check covers the specs.

### D3 — The identifier renames, in full, and nothing more
- Go: `internal/httpvars` → `internal/apivars` (package clause, import paths, `Deps.HttpVars` →
  `Deps.ApiVars`, `main.go`'s construction). Types inside keep their names (`Service`, `Resolver`,
  `RevealResult`, `Reference`) — they are already package-scoped.
- TS: `HttpVariable` → `ApiVariable`, `HttpEnvironment` → `ApiEnvironment`,
  `HttpVariableHistoryEntry` → `ApiVariableHistoryEntry`, `HttpSavedGrpcRequest` →
  `GrpcSavedRequest` (+ `httpSavedGrpcRequestSchema` → `grpcSavedRequestSchema`,
  `defaultHttpSavedGrpcRequest` → `defaultGrpcSavedRequest`).
- Command ids: every `http.*` → `api.*`, including the one a gRPC view registers (F4). Ten entries
  in `shortcuts/state.ts`, seven `registerCommand` calls.
- **Not renamed**: `HttpSavedRequest`, every `Http*Wire`, `httpMethodClass`, `statusClass`,
  `HttpRequestTabState`, `HttpRequestTabRecord`, `bridge.HttpService`, `mapHttpError`,
  `views/httprequest/**`, `internal/httpclient/**`.

### D4 — `frontend/src/http/` becomes `frontend/src/api/`, and that directory keeps its job
It is the module-level half — the collections tree, the six dialogs, the module's stores, and (until
D7 moves them) its pure logic. After D7 it holds 20 files: `CollectionsPanel.vue`,
`CollectionsTree.vue`, `CollectionRow.vue`, `ApiStart.vue`, `EnvironmentSelect.vue`,
`ImportReportStrip.vue`, the six dialogs, `menus.ts`, `state/{collections,variables,curl,raw,
dynamicValues,history}.ts`, `tabs.ts` (D9) and `reveal.ts` (D13).

`grpc/target.ts` is **deleted**, not moved (F21). Deleting dead code is in scope for an audit phase
in a way that adding anything is not.

### D5 — Two real workspace packages: `@kira/shared` and `@kira/api-core`
Root `workspaces` becomes `["apps/*/frontend", "packages/shared", "packages/api-core"]` —
**enumerated, not `packages/*`**, because `packages/db-fixtures/` has no `package.json` and a glob
that matches a directory without a manifest is an install-time error, not a silent skip. §8 OQ-2
notes the SPEC asked for the glob.

`packages/shared` gets an eight-line `package.json` (`"name": "@kira/shared"`, `"private": true`,
`"type": "module"`, no build step — it stays source-only TypeScript consumed by a bundler). This
costs almost nothing and removes the *"source-only, reached via a `@shared/*` path alias with no
independent `package.json`"* shape the SPEC's own boundary section calls out as the weaker one. The
`@shared/*` alias stays in `vite.config.ts` and the three tsconfigs, so no import statement changes.

`packages/api-core` declares `@kira/shared` (workspace), `zod`, `shlex` and `@faker-js/faker` and
nothing else. Its `tsconfig.json` extends nothing from the app and resolves no `@bindings/*` alias —
which is what makes §6.2's check meaningful.

### D6 — `packages/api-ui` is **not** built in this phase, and the reason is a measurement
The SPEC asks for the Api-facing frontend code to become *"genuine Bun workspace package(s)"*. The
logic half can (D5/D7). The **Vue half cannot, without first extracting a shared UI-primitives
package**, and here is the arithmetic:

1. The module mounts **43 `theme/primitives/*` imports across 11 distinct components**, plus
   `CodiconIcon`, `CodeMirrorHost.vue`, `editor/theme`, `beautify`, `format`, `clipboard` and
   `views/shared/viewOp` (§1.3). Injecting eleven Vue components through a port is not a seam, it is
   a second component registry.
2. Extracting `packages/ui-kit` instead means moving `theme/**` — which **90 of 287 renderer files
   import** (F8) — plus `primitives.css`, `tokens.css` and `base.css`.
3. `docs/v1.2/SPEC.md`'s **P13 row names `primitives.css` and the shared token scale as the
   reference it checks the Api module against**, and P13 runs next. Moving those three files out
   from under P13 immediately before it starts is the same sequencing mistake the SPEC warns about
   in the other direction (*"sequenced after modularization … so it's polishing the module under
   its final name … rather than styling files P12 is about to move"*).
4. And the precedent the SPEC cites for demanding it — v1.3's Git module — **is not on this branch**
   (F1). There is no shape to match.

So: `packages/api-core` is real and provable; `packages/api-ui` is designed in §8 OQ-1 as its own
SPEC row with `packages/ui-kit` as its named prerequisite, and **nothing in this phase is
half-built toward it**. What this phase does instead is make the UI half's remaining couplings
*small, enumerated and lint-fenced* (D9, D10, D11, D16) so that later phase is a move rather than
an untangling — which is the SPEC's own stated goal for the boundary.

### D7 — What goes into `packages/api-core`, and what stays
**Moves** (1,999 lines, F6): `substitute.ts`, `substituteRequest.ts`, `curl/{tokenize,flags,parse,
generate}.ts`, `raw/{parse,generate}.ts`, `dynamic/{catalog,generators,fakerEntry}.ts`,
`views/httprequest/{body,url,saved}.ts` → `src/http/`, `views/grpcrequest/saved.ts` → `src/grpc/`.

**Stays in the app**: everything Vue, everything reactive, everything that calls `control` —
including `views/httprequest/files.ts` (F7) and the whole of `api/state/**`.

**Two consequences worth stating.** First, `http/raw/generate.ts`'s `goQueryEscape` and
`http/curl/generate.ts`'s private copy of the same function land in one directory, which is exactly
what P9 F16 said this phase should make possible; they become one exported helper in
`packages/api-core/src/http/escape.ts`, pinned by both existing corpus specs. Second,
`state/tabKinds.ts:54`'s import of `httpRequestTitle` and `state/tabs.ts:51-52`'s imports of the two
`saved.ts` files become imports of `@kira/api-core` — the host depending on the module package,
which is the correct direction and is what makes D16's rule (b) enforceable.

`packages/api-core/src/index.ts` is a real public surface: it re-exports exactly what the app and
the tests use, and the eleven accidental exports of F22 do not appear in it (they lose their
`export` keyword where they are file-local, and `FLAG_TABLE`/`RAW_EDITABLE_BODY_MODES` stay
exported only because their own specs import them).

### D8 — `views/httprequest/` and `views/grpcrequest/` keep their names and their places
`docs/v1.2/SPEC.md` proposes `views/httprequest/ → views/apirequest/` and adds *"(exact naming left
to P12's own plan)"*. **Declined**, for a reason that did not exist when that line was written: P11
landed `views/grpcrequest/` as a sibling. Renaming one of two protocol-specific sibling view
directories to a module name would say the HTTP tab is *the* Api tab and the gRPC tab is something
else. Both are protocol names under D1's rule, both follow the `views/<tab kind>/` convention every
other kind uses, and `biome.json:79-98`'s cross-kind rule is written against those exact directory
names.

The module is therefore three directories, not one, and **D16's lint rules name all three** — which
is what makes it a module rather than a directory. A future `packages/api-ui` (OQ-1) is where they
finally sit under one root.

### D9 — The twelve Api tab functions move out of `state/tabs.ts` into `api/tabs.ts`
`state/tabs.ts` exports `openTab` and `patchTabState` (today private, `:249` and `:676`), and
`api/tabs.ts` composes them into `openApiRequestTab`, `openCollectionRequestTab`,
`renameApiRequestTabs`, `patchHttpRequestTabState`, `findHttpRequestTab` and the five gRPC twins.
`state/tabs.ts` then imports nothing from `views/**` or `@kira/api-core` at all, and drops ~90 lines.

Why this and not an injected port: the twelve functions are *the module's own code that happened to
be written in a shell file* — moving them is a cut-and-paste, whereas inverting them would add an
indirection with exactly one implementation. The generic primitives (`openTab`, `patchTabState`,
`unmarkHydrated`, `registerTabRuntimeCleanup`) genuinely belong to the shell and stay there.

`shortcuts/state.ts` then imports `openApiRequestTab` from `api/tabs.ts` instead of `state/tabs.ts`
— still a shell→module import, but now a *declared* one at the module's front door rather than a
reach into a shell file's Api-shaped half. D16 rule (b) permits `shortcuts/**` → `api/**` and
forbids `shortcuts/**` → `views/httprequest|grpcrequest/**`.

### D10 — `LeftPanel.vue` becomes `theme/primitives/PanelShell.vue`
F20: it is generic chrome with exactly two consumers, one per mode, and it is the module's only
`workbench/**` import. Moving it removes that import entirely and lets D16 add *"`api/**` must not
import `workbench/**`"* with no carve-out — a rule with an exception is a rule nobody trusts. Two
import lines change (`ProjectPanel.vue`, `CollectionsPanel.vue`); the component is untouched.

### D11 — `bridge/control.ts` splits into two files composing one object
`bridge/apiControl.ts` holds the 39 Api methods (F13) and their type imports;
`bridge/control.ts` keeps the other 67 plus `unwrap`, `trust`, `on` and `windowKey`, which
`apiControl.ts` imports from it. The exported value stays one object:

```ts
export const control = { ...studioControl, ...apiControl };
```

Every one of the ~200 `control.xxx()` call sites is unchanged, `mockRuntime.ts`'s channel map is
unchanged, and the Api module's binding surface is now readable in one 39-method file — which is
the artefact a future `packages/api-ui` port would be generated from. This is the SPEC's
*"a single test **file** covering both modules is not [fine]"* rule applied to the one source file
where it bites hardest.

### D12 — One history-runtime factory, two instantiations
F9's duplication becomes `api/state/history.ts`:

```ts
export function createHistoryStore<Entry, Snapshot, Extra extends object = {}>(opts: {
  list: (itemId: string, tabId: string) => Promise<Entry[]>;
  get: (id: string) => Promise<Snapshot>;
  remove: (id: string) => Promise<void>;
  clear: (itemId: string, tabId: string) => Promise<void>;
  findTab: (tabId: string) => { state: { itemId?: string | null; responsePane: string } } | null;
  extra?: () => Extra;
}): { runtime; ensure; load; ensureLoaded; noteRecorded; view; backToLatest; del; clearAll };
```

HTTP's `selected: string[]` and its three compare functions ride in `extra` and stay in
`views/httprequest/history.ts`, which shrinks to a factory call plus ~25 lines; gRPC's shrinks to a
factory call. `clearGrpcHistory` stays exported-but-unwired (F23) — this commit must not change
behaviour, and wiring a Clear button is P13's.

**Why a factory and not two copies with a comment**, given P11 chose the copy: the choice P11 faced
was *"import across a forbidden boundary, or copy"*; the choice here is *"copy, or put the shared
thing in the module's own shared directory, which both views already import from"*. That third
option is the one `docs/v1.2/SPEC.md`'s boundary section names — *"once a piece of infrastructure is
generic rather than module-specific, it belongs in its own shared package/module the first time a
second consumer is foreseeable"* — and the second consumer is not foreseeable, it is shipped.

### D13 — One reveal loop for the module's three call sites; Studio's stays a deliberate copy
This answers **P5 OQ-2** and **P9 OQ-4** together, as P9 asked. `api/reveal.ts`:

```ts
export async function runReveal(
  call: (confirmed: boolean) => Promise<RevealResult>,
  onRevealed: (value: string) => void,
  onError: (message: string) => void,
  prompt: string,
): Promise<void>
```

— the four-outcome switch (`revealed | cancelled | confirmation-required | error`) with the
recurse-once-on-confirmation shape, used by `revealVariable`, `revealHistoryEntry`
(`api/state/variables.ts`) and the *Copy as curl* loop (`api/state/curl.ts`).

`project/ConnectionDialog.vue:227-250` **keeps its own copy**, and this is the decision, not an
omission: sharing it would need a home both `project/**` and `api/**` may import, i.e. a new
Studio↔Api shared module created by the phase whose job is removing them — P5 D8's exact argument,
which does not stop being true just because a third Api call site appeared. The four-outcome
vocabulary is already shared as a *type* (`domain/variables.ts`'s `RevealResult`), which is the part
that can drift; the twenty-line switch is the part that cannot.

### D14 — The six tables and eight indexes are renamed `api_*`, by a real forward migration
`0010_p12_api_rename.sql`:

```sql
ALTER TABLE http_collections      RENAME TO api_collections;
ALTER TABLE http_items            RENAME TO api_items;
ALTER TABLE http_environments     RENAME TO api_environments;
ALTER TABLE http_variables        RENAME TO api_variables;
ALTER TABLE http_variable_history RENAME TO api_variable_history;
ALTER TABLE http_response_history RENAME TO api_response_history;

DROP INDEX http_items_tree;               CREATE INDEX api_items_tree ON api_items(...);
-- …seven more, DROP + CREATE, because SQLite has no ALTER INDEX RENAME (F17)
```

**Why rename at all**, when the cost is a migration and the benefit is a name: `http_items` stores
gRPC requests today (`0009_p11_grpc.sql` added `protocol` to that very table) and `http_variables`
is what resolves a gRPC call's `authorization` metadata. The name is not stale, it is **wrong**, and
`docs/ARCHITECTURE.md:415` records this app's own precedent for exactly this situation — the
keychain service name was renamed *"Safe Storage"* → *"Secrets"* on the reasoning that the name was
*"actively misleading about what created it"* and that pre-ship is the last moment it is free.
Every month this waits, the same migration gets riskier.

**Why not rename `grpc_call_history` too**: it holds gRPC calls only. Correct as it stands.

**What makes it safe** (F17): no views or triggers to re-parse; `_foreign_keys=1` on every
connection, so `grpc_call_history.item_id REFERENCES http_items(id)` and
`http_response_history.item_id` both follow the rename; the generated `scope_key` references only
its own row. **What makes it verified rather than assumed**: D15.

**Why a tenth file rather than editing 0006–0009** (F18): those migrations are already applied on
every developer database, `migrate.go:41-45` refuses a database newer than the build, and
forward-only-numbered-files is this repo's stated rule. A fresh install will create `http_*` in
0006–0009 and immediately rename them in 0010; that is what forward-only means and it is correct.

### D15 — The migration gets a Go test that proves a populated database survives it
`internal/storage/migrations/migrate_rename_test.go` — the first test in this repo to exercise a
migration against seeded data, because it is the first migration that touches data rather than
adding to it:

1. Open a `t.TempDir()` database, apply migrations 1–9 only.
2. Insert a collection, a folder, an HTTP request item, a gRPC request item, a collection variable,
   an environment + its variable, a variable-history row, a response-history row and a
   grpc-call-history row.
3. Apply migration 10.
4. Assert every row is readable under the new table names with identical values;
   `api_response_history.scope_key` and `grpc_call_history.scope_key` still compute;
   `PRAGMA foreign_key_list(grpc_call_history)` now names `api_items`;
   `PRAGMA index_list` shows the eight `api_*` indexes and no `http_*` ones.
5. `DELETE FROM api_collections WHERE id = ?` and assert the items, variables and both history
   tables cascaded — the property the rename could most plausibly break silently.

This is a case `AGENTS.md`'s test bar admits by name (*"a decision structure too large to hold in
your head"* is not the argument; **"an irreversible data migration"** is the argument, and the file
is a one-time proof, not ongoing CRUD coverage).

### D16 — Six lint rules, and what each one stops
Added to `biome.json`'s `overrides`:

| # | Scope | Forbidden | Stops |
|---|---|---|---|
| (a) | `apps/kira-studio/frontend/src/api/**` | `**/project/**`, `**/views/**`, `**/workbench/**` | the P1 D7 rules, retargeted, plus the `workbench/**` ban D10 makes exception-free |
| (b) | `apps/kira-studio/frontend/src/state/**`, `.../shortcuts/**` | `**/views/httprequest/**`, `**/views/grpcrequest/**` | the reverse traffic of §1.4 — the shell reaching into the module's views. (Not a blanket `views/**` ban: `state/tabKinds.ts` and `state/schemas.ts` legitimately import five Studio view modules) |
| (c) | `apps/kira-studio/frontend/src/project/**` | `**/http/**`, `**/api/**` | the mirror of the rule that already exists in one direction only (hole (a) of §1.7) |
| (d) | `apps/kira-studio/frontend/src/views/httprequest/**`, `.../views/grpcrequest/**` | `**/project/**` | Studio's connection tree is not the Api views' to reach into either |
| (e) | `packages/api-core/**` | `vue`, `@codemirror/*`, `**/apps/**`, `@bindings*` | the package's whole claim — no framework, no DOM, no app |
| (f) | `packages/shared/**` | `**/apps/**`, `@kira/api-core` | keeps the base layer the base layer (F6's layering: shared → api-core → app) |

Rule (e) is the one that would otherwise erode silently: a Vue import inside `api-core` still
*builds* inside the app's Vite graph, so nothing would fail until someone tried to consume the
package elsewhere. §6.2's standalone typecheck is the belt to this braces.

The messages follow the existing convention (`"P12 D16(c): …"`), so a future reader gets a phase
and decision number rather than a bare prohibition.

### D17 — The Go side is audited and documented, not restructured
The SPEC asks P12 to *"audit `internal/bridge` and the remaining Go side for coupling that would
block splitting Http into a standalone app later."* The audit's result, written into
`docs/ARCHITECTURE.md` rather than acted on:

| Coupling | Verdict |
|---|---|
| `internal/bridge` is one package holding both modules' services | **accepted.** Already one file per service, and the six Api files import nothing from the thirteen Studio ones. Splitting the Go package would rewrite every bound method's FQN (`mockRuntime.ts:33` + 106 entries) and both `@bindings/*` aliases, for no boundary Go doesn't already give (§3) |
| `appcore.Deps` carries Studio's `Connections`/`Tree`/`Router` into Api services, and Api's `ApiVars` into Studio's | **accepted, documented.** One struct embedded by value into nineteen services; narrowing it means nineteen new interfaces. The honest note is that a standalone Api app needs `Deps{DB, Repos, ApiVars, Events}` and nothing else |
| `internal/storage/{model,repos}` carries both modules' tables and imports `httpclient`/`postman` (F11) | **the real blocker, named.** Splitting it is a five-constructor, every-repo-test change with zero behaviour delta. Recorded as the first thing a genuine app split does |
| `adapterhost.Host.RunOp` is the Api module's op scheduler (F12) | **accepted by design**, not by neglect — `docs/ARCHITECTURE.md` already argues why one op log beats two |
| `ConnectionsService.SecretsStatus` is the Api module's only Studio-service call (§1.3) | **accepted, documented.** It reports a *process-wide platform fact*, not a connection fact; the honest fix is a `SecretsService` of its own, which is a bound-method addition this phase's row forbids. §8 OQ-4 |

That table is the deliverable. Writing down a coupling with its cost is worth more here than moving
half of it.

### D18 — No `repos/capped.go` (answering P11 OQ-6)
Four tables (`filter_history`, `api_variable_history`, `api_response_history`,
`grpc_call_history`) share an insert-then-trim shape; two of them add a window-function byte sweep.
A shared helper would have to take the table name, the scope column, the order column and the cap as
**strings**, i.e. compose SQL per call — which `docs/ARCHITECTURE.md:665` records this codebase as
having already rejected once, for a `WHERE` clause, on index-usage grounds. The four bodies also
differ in what they trim on (count vs count+bytes) and in whether they run inside an outer
transaction. Four applications of a pattern, each written out, is what this repo already chose
three times; a fifth reader is better served by four legible statements than by one parameterised
builder.

### D19 — The two cross-module test files are split; nothing else about the suites changes
- **`tests/unit/go-ts-vocabulary-parity.spec.ts`** splits into
  `go-ts-vocabulary-parity.spec.ts` (its `:54-76` tab/op-kind block, which spans both modules by
  nature — a *vocabulary* parity check is host-level) and
  `packages/api-core/test/go-ts-api-parity.spec.ts` (the three Api describes at `:77-110`: body
  modes, content types, Postman code languages). The Go paths it reads become
  `../../apps/kira-studio/internal/...`.
- **`tests/ui/mode-switch.spec.ts` is not split.** It tests the *seam* — that the two modes
  coexist — so a per-module copy would test nothing. This is the one file the SPEC's split rule does
  not reach, and saying so is better than mechanically obeying it.
- The three Api unit specs move to `packages/api-core/test/` with the package (D7); `test:unit`
  becomes `bun test apps/kira-studio/tests/unit packages/api-core/test`, which is the SPEC's
  *"the runner command still runs both suites together"* shape exactly.
- `internal/apivars/testdata/substitution.json` keeps its name and its role; the TS spec's relative
  path is updated once (F15) and asserted by the spec passing.

### D20 — The edge cases, named, with what happens at each
A refactor phase's risk is concentrated in the seams it moves things across. These are the ones this
plan can see; each has a decided answer rather than a hope.

| # | Edge case | What happens |
|---|---|---|
| 1 | A developer runs a **pre-P12 build after migration 10 has applied** to their `kira.sqlite` | `migrate.go:41-45` refuses to start with *"database schema_version (10) is newer than this build knows about (9)"*. **This is correct behaviour, not a bug to soften** — the old build's prepared statements name `http_*` tables that no longer exist, and starting it would fail later and messier. It must be stated in the C10 commit message, because a bisect or a branch switch is exactly when it bites |
| 2 | **Two app processes against one database** during the upgrade | `db.go:32-38` sets WAL + `busy_timeout=5000` and `SetMaxOpenConns(1)`. A schema change needs the write lock; a second process holding it makes migration 10 fail with `SQLITE_BUSY` after five seconds and the app refuses to start rather than half-migrating. Acceptable (the same is true of every prior migration) and worth one sentence in `docs/ARCHITECTURE.md` |
| 3 | Migration 10 **partially applies** | It cannot: `migrate.go:53-61` wraps each migration and its `schema_version` bump in one `db.Begin()`/`Commit()`, and every statement in 0010 is DDL that SQLite rolls back transactionally |
| 4 | A **restored tab** whose `state_json` carries an `itemId` pointing at a renamed table's row | Unaffected. Ids are unchanged; only the table's *name* moves. `tabs.kind` (`'http-request'`/`'grpc-request'`) is untouched by D1, so `hydrateTabs`'s per-kind `parseState` still matches |
| 5 | A tab open in **Api mode when the app quits**, restored by a build where `AppMode` is `'api'` | Unaffected — mode is derived from the boot tab's kind (`state/tabs.ts:216`), never stored (F3) |
| 6 | A **stale `frontend/bindings/` tree** after the Go package rename | F29: `rm -rf` before regenerating, as part of C9 |
| 7 | The regenerated bindings come back **without `-names`** | `AGENTS.md`'s standing warning: every `tests/ui/` spec fails at the first bound call of boot with *"no CHANNEL_TO_FQN entry for undefined"*, and nothing about the failure points at bindings. C9 checks one generated file for `$Call.ByName(` before moving on (§6.1) |
| 8 | A file this phase moves is treated by git as **binary** | Only `views/grpcrequest/GrpcRequestView.vue` was ever in that state, and `ccd1f25` fixed it; `file` reports it UTF-8 text at this base. D8 does not move it anyway. The standing rule is §0.3's: nothing this phase writes introduces a control character |
| 9 | `packages/api-core` accidentally keeps working because Vite resolves through the app | D16 rule (e) plus §6.2's standalone `tsgo` run — the failure mode is *silence*, so it needs a check that runs outside the app's graph |
| 10 | The scripted rename hits a **protocol** name by accident | §6.4's four negative greps and four positive ones, run as a commit gate on C9 |

### D21 — Nine UI specs and `mockRuntime.ts` change mechanically, and that is the behaviour proof
`data-mode="http"` → `"api"` (five specs), `data-testid="http-*"` → `api-*` **only where the testid
names the module** (the mode tab; `http-body-mode-*` and `grpc-response-pane-*` name protocol
surfaces and are left alone). No assertion, no fixture, no `ControlSnapshot` and no channel name
changes. §6.5 turns that into a check: `git diff --stat` on `tests/ui/` must show only renamed
strings.

---

## 5. Implementation order

Fourteen commits. The sequence is chosen so that the two risky pieces — the storage migration and
the package extraction — land alone, early enough to be reverted without unpicking anything after
them, and so no commit leaves `lint`/`typecheck` red (the pre-commit hook runs both).

Per `AGENTS.md`: fast checks (`bun run lint`, `bun run typecheck`, `bun run build`,
`go build ./...`, `go vet ./...`) per commit; the expensive suites once, at C13.

### C1 — `refactor(api): delete dead code and narrow the module's export surface`
`http/grpc/target.ts` deleted (F21); the eleven file-local exports of F22 de-`export`ed;
`REVEAL_OUTCOMES` removed. No move, no rename — the smallest possible first commit, and the one
that shrinks everything the later commits have to carry.

### C2 — `refactor(shell): LeftPanel becomes a theme primitive`
`workbench/panels/LeftPanel.vue` → `theme/primitives/PanelShell.vue` (D10); two import lines.
Studio and Api both keep rendering identically — `tests/ui/workbench.spec.ts` and
`collections.spec.ts` are the incidental proof.

### C3 — `refactor(shell): the Api tab helpers move out of state/tabs.ts`
D9: `openTab`/`patchTabState` exported, `api/tabs.ts` created with the twelve functions,
`state/tabs.ts` loses both `views/**` imports. Call sites updated (`shortcuts/state.ts`,
`api/menus.ts`, `api/state/collections.ts`, both views). Behaviour-identical by construction — the
functions are moved verbatim.

### C4 — `refactor(api): one reveal loop, one history runtime`
D13's `api/reveal.ts` and D12's `api/state/history.ts`, with both `views/*/history.ts` reduced to
factory calls and the three reveal call sites re-pointed. The check is that
`tests/ui/http-variables.spec.ts`, `http-history.spec.ts` and `grpc-request.spec.ts` pass
**unedited** — this is the phase's one behaviour-preserving logic refactor and it stands or falls
on that.

### C5 — `refactor(api): the two protocols share one variable-resolution helper`
F10/P11's own forward pointer: `mergedValuesAndSecrets` and `collectionIdFor` move to
`api/state/variables.ts` and `api/state/collections.ts`; both `views/*/state.ts` import them; the
comment at `views/grpcrequest/state.ts:21-24` is replaced by a one-line pointer at the new home.

### C6 — `refactor(bridge): the renderer's Api binding surface is its own file`
D11: `bridge/apiControl.ts` with 39 methods, `control.ts` down to 67, one composed export. No call
site changes; `typecheck` is the whole proof.

### C7 — `build(packages): @kira/shared and @kira/api-core are real workspace packages`
D5: two `package.json`s, `packages/api-core/tsconfig.json`, root `workspaces` and `test:unit`
updated, `packages/shared/domain/editor.ts` created (F14) and re-exported from
`editor/languages.ts` so nothing else moves yet. `bun install` re-links. **No source moved in this
commit** — it is the scaffolding, reviewable on its own.

### C8 — `refactor(api-core): move the module's pure logic into its package`
D7: the 1,999 lines, the three unit specs, the merged `goQueryEscape`, `src/index.ts`. Every
importer updated to `@kira/api-core`. `state/tabs.ts` and `state/tabKinds.ts` now import the
package rather than `views/**` — the precondition for D16's rule (b).

### C9 — `refactor(api)!: rename the Http module to Api`
The rename commit, and the one with the `!`. `frontend/src/http/` → `frontend/src/api/`;
`internal/httpvars` → `internal/apivars` (+ `Deps.ApiVars`); `AppMode` `'http'` → `'api'` and the
mode label; the four TS type renames of D3; every `http.*` command id → `api.*`; `HttpStart.vue` →
`api/ApiStart.vue` with D2's one-line subtitle. Bindings regenerated (`wails3 task
common:generate:bindings`, never a hand-typed flag list — `AGENTS.md`). **No table names in this
commit** — C10 owns those, so a revert of either is clean.

> Executed as a scripted, reviewed set of `git mv`s plus targeted replacements, never a blind
> repo-wide `sed`: `internal/httpclient`, `views/httprequest`, `'http-request'`, `HttpBodyWire` and
> friends must survive untouched (F5). Every edited file stays UTF-8 text — §0.3's `ccd1f25` lesson.

### C10 — `refactor(storage)!: the collections tables are api_*, not http_*`
D14's `0010_p12_api_rename.sql`, `embed.go`'s tenth entry, the four repos' SQL strings, their
tests, and D15's `migrate_rename_test.go`. The one commit in this phase that touches persisted
data, and the one whose revert would need its own down-migration — which is why it is alone and
why its test seeds real rows before it runs.

### C11 — `chore(lint): six boundary rules under the new module shape`
D16's `biome.json` overrides, added **last among the structural commits** so every rule is green the
moment it lands rather than requiring the commits before it to be reordered. A rule that would fail
against C10's tree is a bug in the rule, and this commit is where that is found.

### C12 — `refactor(api): the host mounts the module through one entry point`
F19: `App.vue`'s eleven Api imports become one `<ApiDialogs />` component (`api/ApiDialogs.vue`,
a template-only wrapper mounting the six dialogs it already mounts, each still guarded by its own
store's `open` flag). Purely a reduction in the host's knowledge of the module's internals; no
dialog changes.

### C13 — `test: the renamed mode, the split parity spec, and the package's own suite`
D19/D21: the nine UI specs' mechanical string updates, `mockRuntime.ts`, the parity spec split.
**This is where the expensive suites run for the first time** — `test:ui`, `test:ipc:fe`,
`test:unit`, `go test -race ./apps/kira-studio/internal/...` — with fixes landing as follow-up
commits per `AGENTS.md`.

### C14 — `docs(architecture): the Api module, its boundary, and what still couples it to Studio`
`docs/ARCHITECTURE.md`: the module-boundary section rewritten to describe the shipped shape (three
renderer directories + one package + four Go packages), the storage schema block's renamed tables
with D14's justification and the migration's own paragraph, D17's coupling table, and explicit
answers to **P5 OQ-2 / P9 OQ-4** (D13), **P9 F16** (D7), **P11 OQ-6** (D18) so none of those
questions outlives this phase as still-open.

---

## 6. Verification

### 6.1 What runs here
`bun run lint`, `bun run typecheck`, `bun run build`, `bun run test:unit`, `bun run test:ui`,
`bun run test:ipc:fe`, plus `go build ./... && go vet ./... && go test ./apps/kira-studio/internal/...`.
`bun run setup` first in a fresh container (`AGENTS.md`'s Wails/Go section — the toolchain does not
persist between sessions).

`bun install` must be re-run after C7, since `workspaces` changed (F28).

**Two bindings checks at C9**, both from `AGENTS.md`'s standing warnings and both cheap:

1. `rm -rf apps/kira-studio/frontend/bindings` before `wails3 task common:generate:bindings`, so
   no stale `internal/httpvars/` tree survives the Go package rename (F29). Never a hand-typed
   `wails3 generate bindings` flag list — it has already drifted from the task's real flags once.
2. Confirm a regenerated file calls `$Call.ByName("…bridge.VariablesService.Reveal", …)` and
   **not** `$Call.ByID(<n>, …)`. A `-names`-less regeneration breaks every `tests/ui/` spec at the
   first bound call of boot, surfacing as a `status-bar` selector timeout with nothing pointing at
   bindings (D20 case 7).

**Nothing in this phase changes a bound method's name, arguments or return type**, so
`mockRuntime.ts`'s `FQN_SUFFIX_BY_IPC_KEY` map and `BRIDGE_PKG` constant (`:33`) are untouched —
which is itself worth confirming with a `git diff` on that file after C13.

### 6.2 The package is real, checked three ways
1. **`tsgo --noEmit -p packages/api-core/tsconfig.json` passes with no `@bindings/*` path mapping
   and no `apps/` in `include`.** If any moved file still needs the app, this fails loudly.
2. **`bun test packages/api-core/test` passes with the app's `dist/` absent.** The three moved
   specs plus the moved parity describes.
3. **`grep -rE "from '(vue|@codemirror|\.\./\.\./apps)" packages/api-core/src` is empty**, and
   D16 rule (e) makes it a lint error rather than a grep somebody remembers to run.

### 6.3 The migration is verified against a populated database
D15's `migrate_rename_test.go`, run under `go test ./apps/kira-studio/internal/storage/...`. Its
five assertions are listed in D15; the two that would catch a genuinely silent failure are the
`PRAGMA foreign_key_list` check (a `REFERENCES` clause left pointing at a dropped name would not
error until a delete failed to cascade, possibly months later) and the cascade delete itself.

Separately, a **manual one-time check against a real developer database**: copy an existing
`~/.kira-studio/kira.sqlite` that has collections in it, run the built binary against the copy,
and confirm the collections tree, variables, environments and both histories render exactly as
before. The automated test proves the SQL; this proves the app on top of it.

### 6.4 The rename hit exactly what D1 says it should
Four greps, each expected to return **zero** results after C9:
- `grep -rn "httpvars" --include=*.go apps/` — the Go package rename is complete.
- `grep -rn "'http'" packages/shared/domain/mode.ts packages/shared/domain/tabs.ts` — the mode
  value is gone from both.
- `grep -rn "'http\." apps/kira-studio/frontend/src` — the command ids are all `api.*`.
- `grep -rn "frontend/src/http" .` — no path references survive.

And four expected to return **non-zero**, proving the rename did not overreach:
`internal/httpclient`, `views/httprequest`, `'http-request'`, `HttpBodyWire`.

### 6.5 Behaviour did not change, and the test diff is the evidence
`git diff --stat` restricted to `apps/kira-studio/tests/ui/` after C13 must show only:
`data-mode="http"` → `"api"`, `mode: 'studio' | 'http'` → `'studio' | 'api'`, and the mode tab's
testid. **No changed assertion, no changed fixture, no changed `ControlSnapshot`, no new spec.** If
a spec needs a real edit, something in C1–C12 changed behaviour and the change is the bug.

The same rule stated for Go: `bridge/http_test.go`, `bridge/grpc_test.go`,
`apivars/resolve_test.go`, `postman/roundtrip_test.go` and the four repo tests change **only** in
package/import/table names.

### 6.6 What is deliberately not measured
No bundle-size comparison, no launch-time trace. `AGENTS.md`: *"Skip a measurement that wouldn't
change the decision."* Moving 1,999 lines between two directories inside the same Vite graph cannot
move either number, and no decision here turns on them. The one measurement this phase *does* take
(F8's 90/287) is the one that decides D6.

---

## 7. Acceptance checklist

1. `AppMode` is `'studio' | 'api'`; the title bar reads **Studio** and **Api**; no migration exists
   for it because nothing persisted it.
2. `frontend/src/http/` is gone; `frontend/src/api/` holds the module's Vue and stores;
   `views/httprequest/` and `views/grpcrequest/` are unmoved and unrenamed.
3. `internal/httpvars` is gone; `internal/apivars` is its exact contents; `internal/httpclient`,
   `internal/grpcclient` and `internal/postman` are byte-identical apart from import paths.
4. `packages/api-core` type-checks and tests with no reference to `apps/`; `packages/shared` and
   `packages/api-core` are both real workspace packages; `bun install` links them.
5. The six `api_*` tables exist, migration 10 applies cleanly to a database seeded at version 9,
   every row survives, both `scope_key` columns still compute, and deleting a collection still
   cascades to items, variables and both history tables.
6. `biome.json` carries D16's six rules and `bun run lint` is green.
7. `state/tabs.ts` imports nothing from `views/**`; `project/**` imports nothing from `api/**`;
   `api/**` imports nothing from `workbench/**`.
8. `bridge/apiControl.ts` holds 39 methods; `control.ts` holds the rest; no call site changed.
9. `views/httprequest/history.ts` and `views/grpcrequest/history.ts` are factory calls over one
   shared store; `mergedValuesAndSecrets`/`collectionIdFor` exist once.
10. `http/grpc/target.ts` is deleted and nothing referenced it.
11. Every `tests/ui/` spec passes with only renamed strings; every Go test passes with only renamed
    imports and table names.
12. `docs/ARCHITECTURE.md` describes the shipped shape, names the three remaining Go couplings with
    their costs, and closes P5 OQ-2, P9 OQ-4, P9 F16 and P11 OQ-6 in writing.
13. No new bound method, no new tab kind, no new dependency, no new user-facing behaviour, and no
    control character in any source file this phase wrote or moved.

---

## 8. Open questions, handed forward

**OQ-1 — `packages/api-ui` needs `packages/ui-kit` first, and that is its own phase.** D6 declines
it with F8's measurement. The shape, so the next phase does not re-derive it: extract
`theme/primitives/**` + `theme/{tokens,base,primitives}.css` + `beautify.ts`/`format.ts`/
`clipboard.ts` + `views/shared/viewOp.ts`'s two pure halves into `@kira/ui-kit`; rewrite 90 files'
imports; *then* `packages/api-ui` needs only three injected ports (`ApiBridge` — which C6 already
isolates as `apiControl.ts`; a tab port — which C3 already isolates as `api/tabs.ts`; and the three
app-wide singletons `confirmDialog`/`contextMenu`/`settings`). **This phase deliberately shaped C3
and C6 so those two ports already exist as files.** Sequencing note for whoever writes that row: it
must land *after* P13, not before, because P13's own row names `primitives.css` as its reference.

**OQ-2 — the SPEC asked for `workspaces: ["packages/*"]` and D5 enumerates instead.**
`packages/db-fixtures/` has no `package.json`, and a workspace glob matching a manifest-less
directory is an install error rather than a skip. Giving `db-fixtures` a manifest would make the
glob work and is probably right eventually — it is a real, separately-consumed thing
(`tests/e2e-real/` imports it directly) — but it is a Studio-side change in an Api-side phase.

**OQ-3 — the gRPC response pane has no Clear-history action, though the code for it exists**
(F23: `clearGrpcHistory` is implemented, bound and unwired) **and the palette has no *New gRPC
request* entry** (F24). Both are protocol-parity gaps, both are one wire-up each, and both are
**P13's**, which is the pass that reads every Api surface against every other. Recorded here
because a structural audit is where they surfaced, not because this phase should fix them.

**OQ-4 — `ConnectionsService.SecretsStatus` is the Api module's one call into a Studio service**
(§1.3, D17). It reports a *platform* fact — whether an OS keychain exists — that has nothing to do
with connections; it lives there only because connections needed it first. A `SecretsService` with
one method would remove the module's last Studio-service dependency outright. That is a new bound
method, which this phase's row forbids; it is three files of work for whoever is next allowed to add
one.

**OQ-5 — a standalone Api app needs `internal/storage/{model,repos}` split, and nothing here does
it** (F11, D17). The concrete shape, so it is not rediscovered: `model/{collections,variables,grpc,
responsehistory}.go` and `repos/{collections,variables,response_history,grpc_history}.go` move to an
`internal/apistore` package; `repos.Repos` keeps its four Api fields as an embedded
`*apistore.Repos`; `postman` then imports `apistore` instead of `model`, and `model` stops importing
`httpclient`. Roughly a day, no behaviour change, and worth doing only when a second host actually
exists — which is the same trigger OQ-1 waits on.

**OQ-6 — the module's three renderer directories are still three.** D8 keeps
`views/httprequest/`/`views/grpcrequest/` under `views/` for convention's sake, and D16 makes the
module a lint concept spanning `api/**` plus both. That is a boundary a linter understands and a
directory listing does not; OQ-1's package is where the three finally become one root. Until then,
a reader asking *"where is the Api module?"* is answered by `biome.json`, which is a worse answer
than a directory would be, and is recorded as such rather than hidden.
