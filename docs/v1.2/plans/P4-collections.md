# P4 — Collections: SQLite storage, real Postman-format import/export, a left-panel tree

> **What this phase is.** `docs/v1.2/SPEC.md`'s P4 row: **collections stored in this app's own
> `kira.sqlite`** — a normalized folder/request tree, not loose Postman files on disk and not a
> git-shaped edit-the-file workflow — with **genuine Postman Collection v2.1 fidelity at the
> import/export boundary**, and a **left-panel folder/request tree** built on P1's modularized panel
> machinery, replacing `http/CollectionsPanel.vue`'s and `http/HttpStart.vue`'s placeholders.
>
> **The thing that makes this phase harder than it looks.** After P3's same-session correction, this
> app's body-mode vocabulary is **not** Postman's. Postman has one `raw` mode with an
> `options.raw.language` sub-field covering Text/JavaScript/JSON/HTML/XML, plus a `graphql` mode.
> This app has `none | raw | code | urlencoded | formdata | file`, where `raw` is plain text only,
> `code` owns the other four languages via its own `codeLanguage` field, and **there is no GraphQL
> mode at all** (`packages/shared/domain/http.ts:94-119`, `docs/ARCHITECTURE.md:624-650`). Both the
> schema comment and `ARCHITECTURE.md` say in as many words that the translation is P4's to build.
> So the input and output shapes genuinely differ, in both directions, and §4 D7 is the table that
> resolves it — including what an imported `graphql` body does, and where the round trip is
> lossless (collections this app wrote) versus where it honestly is not (corners of collections
> authored in real Postman).
>
> **What does not land here.** Collection variables and environments (P5 — P4 *preserves* Postman's
> `variable[]` verbatim and models none of it, §4 D9), Faker dynamic values (P6), curl parse/generate
> (P7), response history (P8 — P4 preserves Postman's saved `response[]` verbatim and renders none
> of it), the raw inspector (P9), the timeline (P10), gRPC (P11). Also explicitly not here:
> executing pre-request/test scripts, applying any `auth` block, drag-reorder in the tree, moving an
> item between folders, multi-select, a collection-settings surface, Postman Collection **v2.0.0**
> import, `.postman_environment.json` import, Postman API/cloud sync, filesystem watching or
> external-edit detection. Nothing here is half-built toward any of them (`AGENTS.md`: *"Scope left
> out of a phase is left out entirely, not half-implemented"*).
>
> **Every claim below was re-read against the tree, not inherited from `P1`/`P2`/`P3`'s prose.**
> Base: branch `claude/feature-v1-2` at `4cfd514` (*"docs: record the raw/code split and GraphQL
> removal"*). File:line citations point at that content. The Postman schema was **fetched and read**,
> not recalled: `https://schema.postman.com/json/collection/v2.1.0/collection.json`, 55,081 bytes,
> `$schema: http://json-schema.org/draft-04/schema#`, `id: https://schema.getpostman.com/json/collection/v2.1.0/`.
> Every shape quoted in §2 comes out of that file.
>
> **The one-sentence design.** A collection is a normalized `http_collections`/`http_items` tree
> plus, per row, **the original Postman JSON kept verbatim** — so export re-emits every member this
> app does not model byte-identically, and rebuilds only the three members it does own (`url`,
> `header`, `body`) and only when the user has actually changed them.

---

## 0. Scope, non-scope, ground rules

### 0.1 In scope

| File | What changes |
|---|---|
| `apps/kira-studio/internal/storage/migrations/0006_p4_collections.sql` | **new** — `http_collections`, `http_items`, one index (D2) |
| `apps/kira-studio/internal/storage/migrations/embed.go` | one `names` entry |
| `apps/kira-studio/internal/storage/model/collections.go` | **new** — `Collection`, `CollectionItem`, `SavedRequest` + its body types, `Validate` (D4) |
| `apps/kira-studio/internal/storage/repos/collections.go` | **new** — `CollectionsRepo`: `List`, `GetRequest`, `SaveRequest`, `CreateCollection`, `CreateItem`, `Rename`, `Delete`, `ImportTree`, `LoadTree` |
| `apps/kira-studio/internal/storage/repos/collections_test.go` | **new** — §6.2 |
| `apps/kira-studio/internal/storage/repos/repos.go` | one field, one constructor line |
| `apps/kira-studio/internal/postman/collection.go` | **new** — the v2.1 wire structs, the `oneOf` decoders (F2), the origin capture |
| `apps/kira-studio/internal/postman/parse.go` | **new** — file → `postman.Tree` |
| `apps/kira-studio/internal/postman/write.go` | **new** — `postman.Tree` → file, with D6's unchanged-⇒-verbatim rule |
| `apps/kira-studio/internal/postman/body.go` | **new** — D7's mode translation, both directions, plus the two parity map literals |
| `apps/kira-studio/internal/postman/url.go` | **new** — raw string ↔ Postman's broken-down `url` object (D8) |
| `apps/kira-studio/internal/postman/*_test.go` | **new** — §6.2, including the golden round-trip corpus |
| `apps/kira-studio/internal/postman/testdata/*.json` | **new** — the round-trip corpus |
| `apps/kira-studio/internal/bridge/collections.go` | **new** — `CollectionsService`, nine methods (D11) |
| `apps/kira-studio/main.go` | one `application.NewService(&bridge.CollectionsService{Deps: deps})` line |
| `apps/kira-studio/frontend/src/bridge/control.ts` | nine wrappers |
| `packages/shared/domain/collections.ts` | **new** — `httpSavedRequestSchema`, the tree summary mirrors, `ImportReport` (D4) |
| `packages/shared/domain/http.ts` | `itemId`/`name` on the tab state; `httpMethodClass` moves here (D16) |
| `apps/kira-studio/frontend/src/state/tabKinds.ts` | `duplicateState` clears `itemId` (D14) |
| `apps/kira-studio/frontend/src/state/tabs.ts` | `openCollectionRequestTab`, `renameHttpRequestTabs` |
| `apps/kira-studio/frontend/src/http/state/collections.ts` | **new** — the store, the row model, search, selection |
| `apps/kira-studio/frontend/src/http/CollectionsPanel.vue` | rewritten — a real tree, header actions, empty state |
| `apps/kira-studio/frontend/src/http/CollectionsTree.vue` | **new** — the `TreeHost` consumer (D13) |
| `apps/kira-studio/frontend/src/http/CollectionRow.vue` | **new** — one row, incl. inline rename |
| `apps/kira-studio/frontend/src/http/menus.ts` | **new** — the row and background context menus |
| `apps/kira-studio/frontend/src/http/SaveRequestDialog.vue` | **new** — name + target folder (D15) |
| `apps/kira-studio/frontend/src/http/ImportReportStrip.vue` | **new** — D12 |
| `apps/kira-studio/frontend/src/http/HttpStart.vue` | a second action: *Import collection…* |
| `apps/kira-studio/frontend/src/views/httprequest/HttpRequestView.vue` | the Save affordance, the saved name, the dirty mark |
| `apps/kira-studio/frontend/src/views/httprequest/url.ts` | `httpRequestTitle` prefers the saved name |
| `apps/kira-studio/frontend/src/views/httprequest/saved.ts` | **new** — `toSavedRequest` / `fromSavedRequest` / `isDirty` |
| `apps/kira-studio/frontend/src/shortcuts/state.ts` | two palette entries |
| `apps/kira-studio/frontend/src/App.vue` | mounts `SaveRequestDialog` beside the other overlays |
| `apps/kira-studio/tests/ui/support/ipcChannels.ts` | nine channel names |
| `apps/kira-studio/tests/ui/support/mockRuntime.ts` | nine FQNs, one `WILDCARD_DEFAULTS` entry |
| `apps/kira-studio/tests/ui/collections.spec.ts` | **new** — §6.3 |
| `apps/kira-studio/tests/unit/go-ts-vocabulary-parity.spec.ts` | one new parity pair (D17) |
| `docs/ARCHITECTURE.md` | the storage schema block, a Storage paragraph, two UI-architecture paragraphs |

### 0.2 Out of scope, explicitly

- **P5–P11's own rows**, listed in the header blockquote. In particular **collection variables are
  P5's** — P4 decides only that `variable[]` *survives* a round trip, and §4 D9 states the hand-off
  contract P5 must honour.
- **Executing `event[]` scripts, ever, in this phase.** D9 preserves them inert. Running them means
  a JS sandbox and a "do you trust this imported file" decision; neither is in the chapter's phase
  table.
- **Applying `auth`.** D9 preserves it inert, and names the honest consequence: an imported request
  that relied on collection-level Bearer auth will 401 when sent from this app. P2 §8 OQ-5 asked
  whose job auth is; P4 answers *"not P4's"*, with reasoning, and hands it forward with a sharper
  shape (§8 OQ-2).
- **Postman Collection v2.0.0 import.** D10 refuses it with a legible message rather than
  half-supporting a format whose `url` is string-only and which has no `options.raw.language` at
  all.
- **Postman environment files** (`*.postman_environment.json`). A different top-level format, and
  environments are P5's row.
- **Drag-reorder, move-between-folders, multi-select, cut/paste in the tree.** `TreeHost.vue` has no
  drag support and `sort_order` exists so adding it later is not a migration (D18).
- **A collection-level settings surface** (description, collection auth editor, collection
  variables). Nothing edits `origin_json`'s contents in P4.
- **De-duplicating a re-imported collection.** Importing the same file twice makes two collections;
  `info._postman_id` survives in `origin_json` so a future "update in place" has its key (§8 OQ-6).
- **Any menu or accelerator change** (no ⌘S, no ⌘N rework). P1 §8 OQ-3 / P2 §8 OQ-7 stay open,
  unchanged; D15 uses a button plus a palette entry, the same bar P2 D13 set.
- **Any new tab kind and any new op kind.** §3 establishes why neither is needed.
- **Any new dependency**, Go or TypeScript (§4 D1).

### 0.3 Ground rules

- **Studio's rendered output does not change.** Nothing in this phase touches `project/**`,
  `views/grid/**`, `views/console/**`, an adapter, or the data plane.
- **`http/**` may not import `views/**` or `project/**`** (`biome.json:126-149`, P1 D7). Every
  decision in §4 about where a module lives is decided by that rule, not by taste — it is why the
  collections tree gets its own row component instead of reusing `project/TreeRow.vue`, and why
  `httpMethodClass` moves into `packages/shared/domain/http.ts` (D16).
- **A file's bytes never cross the IPC bridge.** P3 D4/F7 measured the control plane's 512 KiB chunk
  threshold and 64 MiB assembled ceiling; a Postman collection JSON is a file like any other, so Go
  reads it and Go writes it (D11).
- **The exchange format is real or it is nothing.** Every shape in §2 is quoted from the fetched
  schema. Where this plan cannot verify something from a first-party source it says so (§8 OQ-1,
  OQ-4) rather than asserting it.

---

## 1. What the code does today

### 1.1 Http's left panel and start page are two deliberate placeholders

`http/CollectionsPanel.vue` is 36 lines: a `LeftPanel` with `empty` **hardcoded true** (`:15`), the
title `Collections` (`:17`), one `IconButton icon="add"` with `data-testid="new-request"` in the
`#actions` slot (`:20-26`), and an `EmptyState` reading *"Collections arrive in a later phase"* with
a `data-testid="new-request-empty"` button (`:29-33`). Its own header comment says `empty` is
*"always true: collections themselves don't land until P4, so there is genuinely no tree here yet"*
(`:8-11`).

`http/HttpStart.vue` is `StudioStart.vue`'s first-run shape verbatim: a globe mark, *"No request
open"*, one line of copy, and one `p-dlgbtn primary` button with `data-testid="new-request-start"`
(`:11-21`).

Both import only `openHttpRequestTab` from `../state/tabs` (`:2` in each) — the sole `http/ → state/`
edge either has.

### 1.2 An HTTP request tab has nowhere to live, and knows it

`openHttpRequestTab()` (`state/tabs.ts:392-396`) is:

```ts
return openTab('http-request', null, 'request', () => defaultHttpRequestTabState(), {
  reuse: false,
}).id;
```

— `connectionId` null, `path` the literal constant `'request'`, `reuse: false` so every call makes a
fresh tab. The comment above it (`:388-391`) restates P2 D2's reasoning: *"an HTTP request has no
target to reuse by (its own id is its identity)"*. `docs/ARCHITECTURE.md:587-607` records the same
from the other side and adds the forward-looking half: P4 *"is free to replace it with a real
`collection:<id>/request:<id>` path the day a request has somewhere to live"*.

The tab's title comes from exactly one place: `TAB_KINDS['http-request'].title` is
`httpRequestTitle((tab as HttpRequestTabRecord).state)` (`state/tabKinds.ts:210`), and
`httpRequestTitle` (`views/httprequest/url.ts:66-78`) derives *"the URL's path, else its host, else
the raw text, else `'New request'`"*. There is no notion of a request having a name.

`duplicateState` for this kind (`state/tabKinds.ts:221-227`) deep-copies `headers`, `urlEncoded`,
`formData` and `binaryFile`, and spreads everything else — deliberately, since *"an HTTP request's
state **is** the request"* (`:216-220`).

### 1.3 How this app persists its own state, in five conventions

- **Forward-only numbered SQL.** `migrations/embed.go`'s `names` slice is the ordering authority
  (five entries today, `{1,"init"}` … `{5,"p28_throttle"}`); `storage/migrate.go` runs each pending
  step in **its own transaction** and refuses a database whose `schema_version` is newer than the
  binary knows.
- **Hand-written `database/sql`, no ORM** (`docs/ARCHITECTURE.md:471-476`). Repos live in
  `internal/storage/repos/`, one struct per table with a `DB *sql.DB` field, constructed once by
  `repos.New` (`repos/repos.go:29-65`), which also prepares the five hot statements.
- **A bad row is dropped and logged on read, and refused on write.** `repos/tabs.go:50-60` drops a
  tab whose `state_json` is not a JSON object or whose kind is unrenderable, with a `slog.Warn`;
  `TabsRepo.Save` validates **every** record up front before opening its transaction (`:84-88`).
  `repos/saved_queries.go:23-69` is the richer version of the same shape: it `json.Valid`s the body,
  then decodes it with `DisallowUnknownFields` against its own kind's struct, and returns
  `(nil, nil)` — *drop the row* — on a mismatch.
- **A JSON column whose shape is renderer-owned stays opaque to Go.** `model.TabRecord.State` is
  `json.RawMessage` with a comment saying per-kind shape *"stays renderer-side"*
  (`model/tabs.go:8-12`).
- **Ordering is rewritten dense on every write.** `TabsRepo.Save` deletes the window's whole set and
  re-inserts with `"order"` set to the array index (`repos/tabs.go:96-106`).

Two engine facts that matter to a self-referencing tree: `storage/db.go:32-39`'s DSN sets
`_foreign_keys=1` on **every** connection the pool opens (so `ON DELETE CASCADE` is genuinely
enforced, including a self-reference), and `SetMaxOpenConns(1)` (`db.go:54`) serialises every
statement onto one connection.

### 1.4 The file dialogs exist; a "write these bytes to that path" call does not

`FilesService.ChooseOpen(FilesChooseOpenArgs) (FilesChooseOpenResult, error)`
(`bridge/files.go:78-100`) returns `ChosenFile{Path, Name, Size}` and accepts an optional `Title` and
an Electron-style `Filters []FileFilter` that `wailsFilter` (`:107-124`) collapses onto the single
extension set Wails' macOS panel applies. `ChooseSave(FilesChooseSaveArgs)` (`:60-75`) returns a
chosen path (defaulting to `~/Downloads`, `filepath.Base`-d so a `/` in the suggested name cannot
become a subdirectory).

`control.ts:144-148` wraps both. `views/httprequest/files.ts:14-18` is P3's shared `ChooseOpen`
wrapper.

**But `ChooseSave` has exactly one caller in the whole renderer** — `state/objectStore.ts:61-78`'s
`downloadObject`, which hands the chosen path to `data.objectDownload`, i.e. the **adapter data
plane**, which needs a live S3 connection. There is no general "Go, write this content to this path"
bound method. P3 §8 OQ-3 already noticed the gap from the response side: any save-to-disk feature is
*"a new bound method streaming to a path, not a renderer-side blob"*.

### 1.5 P1 left exactly the tree machinery a second tree needs, and none of the row

`theme/primitives/TreeHost.vue` is `generic="T extends StickyRowLike & { key: string }"` (`:1`) with
props `rows`/`rowHeight`/`selectedKey` (`:10-17`), a `#row="{ row, sticky, top }"` scoped slot
(`:67-76`), a `background-contextmenu` emit (`:19-21`), and an exposed
`revealKey(key)` that does the animation-frame wait, the index lookup, the band inset and the scroll
(`:47-53`, `defineExpose` at `:61`). Its own header comment states the contract: *"this component
knows nothing about connections, engines or openable kinds, only `depth`/`hasChildren`/`expanded`/
`key`"* (`:6-9`).

`workbench/panels/LeftPanel.vue` owns the header geometry (`.p-panel-head { height: 34px }`,
`:105-107`), the search reveal/toggle (`:26-36`, testid `toggle-search`), the VS-Code type-ahead
redirect (`:41-68`), and four slots — `#title`, `#actions`, `#body`, `#empty` (`:71-100`). Search is
a `search` prop + `update:search` emit (`:10-22`), so *the mode owns the string*; Http passes
neither today.

`project/ProjectTree.vue:179-201` is the reference consumer: `TreeHost` bound to `visibleRows`, a
`rowHeight` computed from `settingsState.appearance.rowDensity` (`:54`), a `#row` slot rendering
`TreeRow`, and a `pendingScrollKey` watch calling `treeHostRef.revealKey` (`:65-72`).
`project/TreeRow.vue` is the row: an indent of `8 + depth * 14` px (`:100`), a roving tabindex
(`:106`), a twisty whose icon flips for a group row (`:28`), `<mark>`-based search highlighting
(`:53-73`), and — the parts that are DB-only — a per-row connection colour rail (`:42`, `:111`), a
connection status dot, an `EngineIcon`, and an `ErrorPopover`.

### 1.6 The body-mode vocabulary, as it actually stands

`packages/shared/domain/http.ts:111` — `HTTP_BODY_MODES = ['none','raw','code','urlencoded','formdata','file']`;
`:117` — `CODE_LANGUAGES = ['javascript','json','html','xml']`; `:125-130` —
`CONTENT_TYPE_BY_CODE_LANGUAGE`. The tab state (`:184-200`) carries `bodyMode`, `body` (raw's
buffer), `code`, `codeLanguage`, `urlEncoded[]`, `formData[]`, `binaryFile`, plus four UI-only
fields (`requestPane`, `responsePane`, `responseView`, `requestPaneHeight`). `:211-218` is the
object-level preprocess that maps P2's legacy `bodyMode: 'json'` onto `code`+`codeLanguage:'json'`.

`:102-110` is a comment addressed to this phase by name:

> *BREADCRUMB for whoever builds Postman collection import/export: this vocabulary no longer maps
> 1:1 onto Postman's own `body.mode` … A real translation belongs at that import/export boundary …
> a Postman `graphql` body has nowhere to land and needs its own explicit decision.*

The Go half is `internal/httpclient/body.go`: `BodyMode` constants (`:23-31`), `validBodyModes`
(`:35-37`, a `map[string]bool` literal kept literal *specifically* so the parity test can read it,
`:33-34`), `contentTypeByCodeLanguage` (`:43-48`, likewise), and `Body`/`Field`/`FormField`
(`:50-80`). `buildFile` (`:156-180`) `os.Stat`s the path at send time and returns `CodeBadRequest`
with the path in the message when it is missing or a directory; `prepareFormParts` (`:191-215`) does
the same per file row. **This is what makes an unresolvable imported file reference fail legibly at
send rather than silently.**

### 1.7 There is no Postman-format handling anywhere in the repo

Verified, not assumed. `git grep -il postman` over `apps/`, `packages/`, `scripts/` returns exactly
six files, all of them P3's own: `views/httprequest/{BinaryBodyPicker,RequestBodyPane}.vue`,
`views/httprequest/body.ts`, `internal/httpclient/{body,client}.go`, `packages/shared/domain/http.ts`
— every hit a **comment** about Postman's naming, not a line of format handling. `git grep -in
collection` over the same trees hits only Mongo's `collection` node kind (`theme/icons.ts:14`,
`project/menus.ts:76-77`, `project/grouping.ts:26`) and P1's two placeholder components. No parser,
no writer, no schema, no fixture.

---

## 2. Findings

### F1 — The item tree: recursive, ordered, and discriminated by the presence of `item`
From the fetched schema. The document requires `["info","item"]`; `item` is

```json
{"type":"array","items":{"title":"Items","oneOf":[{"$ref":"#/definitions/item"},
                                                  {"$ref":"#/definitions/item-group"}]}}
```

`#/definitions/item` (a **request**) `required: ["request"]`, properties
`{id, name, description, variable, event, request, response[], protocolProfileBehavior}`.
`#/definitions/item-group` (a **folder**) `required: ["item"]`, properties
`{name, description, variable, item, event, auth, protocolProfileBehavior}` — and its own `item` is
an `anyOf` of the same two, i.e. arbitrarily deep.

Three consequences that decide D3:

1. **`name` is optional on both.** A nameless item is legal and must be given one on import.
2. **The discriminator is structural, not a field.** Neither carries a `type`. A folder is *"has an
   `item` member"*; a request is *"has a `request` member"*. `rbretecher/go-postman-collection`'s own
   `Items.IsGroup()` uses exactly this test (`items.go`, `return i.Items != nil`).
3. **`item` is an *array*, so order is data, not presentation.** Postman's UI order, a runner's
   execution order and a diff of two exports all depend on it. A `map`-shaped or unordered storage
   model would silently scramble a collection on its first round trip.

### F2 — Six `oneOf`s in the format that a naive struct model gets wrong
Quoted from the schema, each with the case that breaks:

| Member | Schema | The case a `string`/`[]T` field breaks on |
|---|---|---|
| `request` | `oneOf: [{object}, {"type":"string"}]`, *"If a string, the string is assumed to be the request URL and the method is assumed to be 'GET'"* | `"request": "https://api.example.com/x"` |
| `request.header` | `oneOf: [header-list, {"type":"string"}]` | a raw `"A: 1\nB: 2"` header block |
| `url` | `oneOf: [{object}, {"type":"string"}]` | `"url": "https://api.example.com"` |
| `url.host` | `oneOf: [{"type":"string"}, {"type":"array","items":{"type":"string"}}]` | `"host": "api.example.com"` (not `["api","example","com"]`) |
| `url.path` | `oneOf: [{"type":"string"}, {"type":"array","items":{"oneOf":[{"type":"string"},{"type":"object","properties":{"type":..,"value":..}}]}}]` | `"path": ["users", {"type":"string","value":":id"}]` — a path **variable** segment |
| `description` | `oneOf: [{object: {content,type,version}}, {"type":"string"}, {"type":"null"}]` | `"description": {"content":"…","type":"text/markdown"}` |
| `script.exec` | `oneOf: [{array of string}, {"type":"string"}]` | a script stored as one string |
| `variable.value` | **untyped** (`"value": {"description": …}` with no `type`) | `{"key":"port","value":8080,"type":"number"}` |

Every one of these is a real shape that appears in real exports, and every one of them is a
`json.Unmarshal` **error** (not a silent zero) against the obvious struct. F7 shows a shipping
library getting four of them wrong.

### F3 — The body: five modes, exact per-item shapes, and an `options` member the schema does not type
`request.body` is `oneOf: [{object}, {"type":"null"}]`. The object's `mode` is

```json
"mode": {"enum": ["raw", "urlencoded", "formdata", "file", "graphql"]}
```

— five, plus *no `body` member at all*, which Postman's UI calls **none**. Per-mode payloads,
verbatim:

- `raw`: `{"type": "string"}` — a bare string.
- `urlencoded`: array of `{key (required), value, disabled (default false), description}`.
- `formdata`: array of an `anyOf` of two shapes —
  - text: `{key (required), value, disabled, type: enum["text"], contentType, description}`
  - file: `{key (required), src: oneOf[string, null, array], disabled, type: enum["file"], contentType, description}`
- `file`: `{"src": oneOf[{"type":"string","description":"Contains the name of the file to upload. _Not the path_."}, {"type":"null","description":"A null src indicates that no file has been selected as a part of the request body"}], "content": {"type":"string"}}`
- `graphql`: `{"type": "object"}` — **completely untyped**, exactly as P3 §8 OQ-1 recorded.
- `options`: `{"type":"object","description":"Additional configurations and options set for various body modes."}` — **also untyped**.
- `disabled`: `{"type":"boolean","default":false,"description":"When set to true, prevents request body from being sent."}`

So `options.raw.language` — the thing the whole raw/code split turns on — **is not in the schema at
all**. It is a documented Postman *convention*: the builder's raw sub-selector offers *"Text,
JavaScript, JSON, HTML, or XML"* ([Send parameters and body data]) and stores the choice at
`options.raw.language`, which is also what `pm.request.body.update()` takes and what
`rbretecher/go-postman-collection` models (`body.go`: `BodyOptions{Raw BodyOptionsRaw}`,
`BodyOptionsRaw{Language string}`, with the five constants `html/javascript/json/text/xml`). D7
therefore treats `options.raw.language` as a **free-form string with five known values**, not a
closed enum — an unknown value must degrade, not fail.

### F4 — `request.method` is a 15-member enum *plus* any custom string; this app has seven
```json
"method": {"anyOf": [
  {"type":"string","enum":["GET","PUT","POST","PATCH","DELETE","COPY","HEAD","OPTIONS","LINK",
                           "UNLINK","PURGE","LOCK","UNLOCK","PROPFIND","VIEW"]},
  {"description":"The Custom HTTP method associated with this request.","type":"string"}]}
```

`packages/shared/domain/http.ts:8` is `HTTP_METHODS = ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']`
— a closed Zod enum feeding a seven-option `<select>` (`HttpRequestView.vue:28`). Go imposes no
limit at all (`httpclient.Send` passes `req.Method` straight to `http.NewRequestWithContext`), so
this is purely a renderer-side vocabulary gap. Eight enum members plus every custom string have no
representation in the tab state, and `httpRequestTabStateSchema.parse` would **reject the whole
state** for one of them, not just that field. D7 handles it; §8 OQ-3 hands the widening forward.

### F5 — Postman's own schema says a `file` body's `src` is a **name, not a path**
Quoted in F3. That single sentence is the difference between "import a binary body and press Send"
and "import a binary body and get `E_BAD_REQUEST: could not read local file report.csv`". It is also
why P3 D4's whole design — the renderer sends a path, Go opens it — cannot be satisfied by an
imported collection on its own: the path may simply not be there.

`formdata`'s file `src` carries **no** such note and in practice holds an absolute local path from
the exporting machine, which is still a machine that is not this one.

Neither case is a bug to fix; both are cases to **report** (D12) rather than discover at send time.

### F6 — Five members, at three levels, that this app models none of
`auth` (collection, folder, request), `event[]` (collection, folder, item), `variable[]` (collection,
folder, item, and `url.variable`), `response[]` (item), `protocolProfileBehavior` (collection,
folder, item). Plus `info.{_postman_id, description, version}`, `request.{proxy, certificate,
description}`, and every per-row `description` on headers, query params, urlencoded fields and
form-data fields (P3 §8 OQ-5 already flagged the last one).

`auth` alone is eleven types (`apikey, awsv4, basic, bearer, digest, edgegrid, hawk, ntlm, oauth1,
oauth2, noauth`), each an array of `auth-attribute` `{key (required), value (untyped), type}`.
`event` is `{id, listen (required), script, disabled}` where `script` is
`{id, type, exec (array|string), src (url), name}`.

**This is the fidelity risk of the whole phase**, and it is not a small one: a user's collection is
mostly *these*, once you get past the requests themselves. A design that models what it understands
and drops the rest would make export a destructive operation for anyone who has ever written a test
script. D5 is the answer; D9 states the policy per member.

### F7 — The library check has a concrete subject, and reading it is what decides D1
`github.com/rbretecher/go-postman-collection` v0.9.0 (MIT, `LICENSE` read from the module zip;
latest release **2022-09-20** per `proxy.golang.org/@latest`, README's own words: *"For now, it does
not offer support all objects"*). Read from the module source, not the README:

- ✅ It solves four of F2's `oneOf`s properly, with custom `UnmarshalJSON`: `URL` (`url.go`),
  `Request` (`request.go`), `Description` (`description.go`), `HeaderList` (`header.go`).
- ❌ **`Items.Description` and `ItemGroup.Description` are plain `string`** (`items.go`), not the
  `Description` type with the decoder — so an item whose `description` is an *object* fails to
  unmarshal. `Header.Description` is a plain `string` too (`header.go`).
- ❌ **`URL.Host []string` / `URL.Path []string`** (`url.go`) — F2's third and fourth rows. A
  `"host": "api.example.com"` string, or a path-variable segment object, is an unmarshal error.
- ❌ **`Variable.Value string`** (`variable.go`) — F2's last row. A numeric or boolean variable value
  is an unmarshal error.
- ❌ **`Script.Exec []string`** (`event.go`) — the string form is an unmarshal error.
- ➖ `Body.URLEncoded/FormData/File/GraphQL` are all `interface{}` (`body.go`), so every per-mode
  shape D7 cares about is ours to write regardless.
- ➖ `Request.MarshalJSON` collapses a bodyless, headerless GET into a **bare string** — legal, but
  it means the writer's output shape is not ours to control.

And the decisive one, which no library anywhere solves: **`encoding/json` drops every member a
struct does not declare.** Round-tripping F6's five-members-at-three-levels through *any* typed
model loses them. Fidelity here is not a parsing problem, it is a *retention* problem — which is
what D5 is.

### F8 — *Verified safe*: no new tab kind, no new op kind, no fourth-vocabulary edit
A collection request opens the **existing** `'http-request'` tab (D14), so `tabKindSchema`
(`packages/shared/domain/tabs.ts:7-19`), `RENDERABLE_TAB_KINDS` (`:26-35`), `TAB_KIND_MODE`
(`:42-51`), `tabRecordSchema` (`:183-220`) and Go's `model.RenderableTabKinds`
(`model/tabs.go:26-32`) are all **byte-identical** after this phase. A folder and a collection open
nothing at all. D11 adds no op kind either, so `opKindSchema`/`model.opKinds` are untouched — the
existing parity tests (`tests/unit/go-ts-vocabulary-parity.spec.ts:53-71`) need no edit *for that
reason*; D17 extends the file for a different one.

### F9 — *Verified safe*: a self-referencing `ON DELETE CASCADE` is genuinely enforced here
`storage/db.go:35` sets `_foreign_keys=1` in the DSN — *"here means every connection the pool ever
opens carries them, not just the first"* (`:28-31`). `repos/helpers_test.go:36-45`'s own comment
confirms the property is relied on already: *"foreign_keys=ON (P52 §4.3) enforces this for real"*.
So `http_items.parent_id REFERENCES http_items(id) ON DELETE CASCADE` deletes a subtree in one
statement, at any depth, with no recursive delete in Go.

### F10 — *Verified safe*: a long bound call cannot block the control plane
P2 §2 F12 established it and nothing has changed: Wails' `transport_http.go` handles each bound call
as its own HTTP request in its own goroutine. So `CollectionsService.Import` parsing a 20 MB file
inside one call blocks that call and nothing else. D11 leans on this instead of inventing a
background job.

### F11 — `tests/ui` 422s on an unmocked channel, and `WILDCARD_DEFAULTS` is the precedented fix
`mockRuntime.ts:353-368`: with no snapshot and no wildcard, the route is fulfilled with a 422
`E_FIXTURE_MISS`. `WILDCARD_DEFAULTS` (`:152-169`) exists for exactly the calls every spec makes and
no spec asserts on — `queriesList: '[]'` is the closest analogue, with the stated reasoning that its
caller is *not* wrapped in a `try/catch` so a miss would break the UI outright.

`mode-switch.spec.ts` boots with **no** collections fixture and asserts (`:113-115`) that
`[data-testid="http-start"]` is visible and the panel contains `Collections`. So `collectionsList`
needs a `'[]'`-shaped wildcard or that spec fails the moment Http's panel starts fetching. And
`http-request.spec.ts:18` / `http-request-body.spec.ts:17` both click
`[data-testid="new-request-start"]`, so `HttpStart.vue` must keep that testid exactly.

### F12 — `httpRequestTitle` is the only title source, and it is URL-derived
`state/tabKinds.ts:210` and `HttpRequestView.vue:26` both call it; nothing else names a request. A
saved request called *"Create order"* pointing at `POST /v2/orders` would show as `/v2/orders`
everywhere. The cheapest correct fix is a name **in the tab state**, so the function stays pure and
no consumer learns about collections (D14).

### F13 — `duplicateTab` copies `path` verbatim, which is why identity must not move into `path`
`state/tabs.ts:402-420`: the new record takes `path: source.path` (`:411`) and
`state: duplicateState(source)` (`:416`). So a design that put a saved request's id in `path` would
produce a duplicate carrying the original's `path` while `duplicateState` cleared the id from its
state — two disagreeing sources of one fact, and `openTab`'s reuse lookup (`:243-245`, keyed on
`kind`+`connectionId`+`path`) would then activate the *duplicate* when the user opened the saved
request. P2 D2 anticipated giving `path` a real value; F13 is why D14 declines it.

### F14 — The panel's search string is the mode's to own, and Http owns none today
`LeftPanel.vue:10-22` takes `search` and emits `update:search`; `:86-95` hides the search box
entirely when `empty` is true. `CollectionsPanel.vue:15` passes `empty` and no `search`. So wiring
search is two bindings plus a filter — and it must be Http's own filter: `project/filterTree.ts` is
the *Filters dialog's* model (visibility rules, kind counts, per-connection `TreeVisibility`), not a
search filter, and `http/**` may not import `project/**` in any case.

### F15 — Studio's tree is lazy because its data is remote; Http's is not
`project/state/tree.ts:58-70`'s `treeState` carries a `children` cache keyed `connectionId|path`,
`expanded`/`loading` Sets, per-connection `visibility`, a 150 ms search debounce and a
`searchIncomplete` note (`ProjectTree.vue:203-208`) — all because expanding a node **connects a
connection and issues an IPC call** (P1 §2 F4). A collections tree has none of that: the whole tree
is rows in a local SQLite table, listable in one call. The row model is therefore a pure `computed`
over one array with no cache, no loading set and no incomplete-search caveat — a genuine
simplification to state rather than a shape to copy.

### F16 — P3's control-plane arithmetic applies to a collection file too
P3 §2 F7, measured from the pinned Wails module: `CHUNK_THRESHOLD = 512 * 1024`
(`runtime.ts:21`), serial `fetch` per chunk (`:189-226`), `maxAssembledBytes = 64 * 1024 * 1024`
and an outright refusal above it (`transport_http.go:38`, `:243-248`). A Postman collection with a
few hundred saved example responses is routinely multiple megabytes; the largest are tens. Reading
the file in the renderer and posting its text to Go would be 20–100 serial round trips for a 10–50
MB file and an unattributable *"assembled body too large"* above 64 MB. D11 is that measurement
applied, exactly as P3 D4 was.

---

## 3. Checked, and not fired

- **No new tab kind, no new op kind, no `RENDERABLE_TAB_KINDS`/`opKinds` edit.** F8.
- **No `TabsRepo`, `model/tabs.go` or `tabs` table change.** A request tab's `state_json` gains two
  fields, which is a renderer-side schema change Go never sees (`model/tabs.go:8-12`).
- **No `layoutSchema` change and no second panel width.** P1 D8/§8 OQ-1 explicitly deferred a
  per-mode width until Http's panel had content worth sizing; it now does, and the answer is still
  *not yet* — the shared width is not visibly wrong, and a second entry costs a schema field, a
  `LayoutPatch` branch, a Go model field and a broadcast. §8 OQ-7 re-hands it forward with the
  evidence P1 asked for.
- **No `TreeHost.vue`, `VirtualList.vue` or `stickyBand.ts` change.** F(§1.5): the props, the
  `#row` slot, `revealKey` and the background-contextmenu emit are exactly what a second tree needs.
  If any of them turns out to need widening, that is a signal D13 got the row model wrong.
- **No `LeftPanel.vue` change.** F14: `search`/`update:search`/`#actions`/`#empty` already cover
  everything the collections panel draws.
- **No `theme/primitives/` addition.** `EmptyState`, `IconButton`, `AppButton`, `TextField`,
  `MessageStrip`, `DialogFrame`, `PanelSearchBox` cover every surface. The one new *shared* thing is
  a pure function (`httpMethodClass`) in `packages/shared/domain/http.ts`, not a component (D16).
- **No `theme/icons.ts` change.** Its `KIND_ICON` is `Record<NodeKind, string>` and `NodeKind` is
  Studio's tree vocabulary — which already contains a `collection` (Mongo's, `:14`) that has nothing
  to do with this one. The Http tree's three row kinds are its own literal union in
  `http/state/collections.ts`, and its icons are codicon names chosen at the row (D13). Extending
  `NodeKind` to carry Http's kinds would put Http's vocabulary inside Studio's tree domain for zero
  gain.
- **No new shortcut id.** D13 reuses `tree.open`/`tree.rename`/`tree.delete`/`tree.duplicate` from
  `packages/shared/domain/shortcuts.ts` via `shortcutFor` (`shortcuts/keys.ts`), the same list
  `ProjectTree.vue:145-152` uses. `registerCommand`'s id is a plain `string`
  (`shortcuts/commands.ts:7`), so D15's `http.save` needs no vocabulary change either.
- **No `menutemplate.go` change, no accelerator.** §0.2; P1 OQ-3 / P2 OQ-7 unchanged.
- **No `internal/httpclient` change of any kind.** D7's translation produces a `SavedRequest`, which
  the existing renderer send path (`views/httprequest/state.ts:11-53`) already turns into the
  existing wire `Body`. `buildFile`/`prepareFormParts`'s existing missing-file refusals
  (`body.go:156-215`) are exactly the right behaviour for F5's unresolvable `src`, unchanged.
- **No `bridge/files.go` change.** `ChooseOpen`'s `Filters`/`Title` and `ChooseSave`'s
  `DefaultName` cover both dialogs; `wailsFilter` already turns `[{name:'Postman collection',
  extensions:['json']}]` into the one extension set the macOS panel applies (`:107-124`).
- **No data-plane, adapter, `adapterhost` or `oplog` change.** D11 states why the import is not an
  op.
- **No new dependency.** §4 D1.

---

## 4. Decisions

### D1 — No new library, and here is the check rather than the assertion
`AGENTS.md` requires reaching for a maintained library first and **naming the requirement** when
declining one. Four candidates were real enough to weigh.

- **`github.com/rbretecher/go-postman-collection` (MIT).** The only Go library for this format worth
  the name, and F7 read its source rather than its README. Declined on **two** requirements, not on
  licence:
  1. **Retention.** The requirement is that `auth`, `event[]`, `variable[]`, `response[]`,
     `protocolProfileBehavior` and every per-row `description` (F6) survive an export unchanged.
     Its model — like any `encoding/json` struct model — drops every member it does not declare, and
     it declares few of them. D5 needs the *original bytes*, which no typed library can give.
  2. **Correctness on real files.** F7 found four `oneOf`s it gets wrong (`Items.Description`,
     `URL.Host`, `URL.Path`, `Variable.Value`, `Script.Exec`) — each an unmarshal **error**, i.e. a
     whole-file import failure, on shapes the published schema explicitly allows. Adopting it would
     mean carrying patches for those five fields *and* writing D5's retention layer beside it, which
     is more code than writing the ~200 lines of decoders outright, on top of a dependency last
     released four years ago.
     What it *does* give for free is a correctness oracle: its four working `UnmarshalJSON`
     implementations are the shape §6.2's own decoders are written and tested against.
- **A JSON-Schema validator** (`santhosh-tekuri/jsonschema`, `xeipuuv/gojsonschema`) run against the
  fetched `collection.json`, to validate an import up front. Declined against the requirement, which
  is *"import a real Postman file"* — and real Postman files fail their own published schema
  routinely (`info` requires `schema`, which hand-written and SDK-generated collections omit;
  `header` requires `value`, which a valueless header row violates). A validator would turn a
  perfectly importable file into a refusal, which is the opposite of interoperability. Being
  **lenient on read and strict on write** (Postel, and D10) is the requirement; a validator serves
  the write side, where we control the output and a Go test with a golden file is a cheaper, more
  legible guard.
- **A TypeScript Postman library** (`postman-collection`, the official SDK). Declined on placement
  before merit: the file never enters the renderer (D11/F16), so there is no subject.
- **An ordered-map / lossless-JSON library** (`iancoleman/orderedmap`, `tidwall/sjson`) for D5's
  retention. Declined: `map[string]json.RawMessage` **is** the lossless representation — every
  unparsed member's bytes are preserved exactly — and `encoding/json` re-marshals a `json.RawMessage`
  through unchanged. What is genuinely lost is **member order within an object**, which is not
  semantic in JSON and which Postman's own exporter does not preserve stably either. That is stated
  in D5 rather than papered over.

### D2 — The exact SQLite schema
`migrations/0006_p4_collections.sql`, with `embed.go`'s `names` gaining
`{6, "p4_collections", "0006_p4_collections.sql"}`:

```sql
-- P4 D2: collections live in this app's own database (docs/v1.2/SPEC.md's P4 row), not as Postman
-- files on disk. A collection is a *normalized* folder/request tree — Postman's `item` is an
-- ordered array, so `sort_order` is data, not presentation — plus one opaque `origin_json` column
-- per row holding the original Postman object verbatim, which is what makes an export re-emit
-- everything this app does not model (auth, scripts, variables, saved examples) unchanged (D5).
CREATE TABLE http_collections (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL,
  -- The whole original collection object, minus its `item` array (those are rows below) and minus
  -- `info.name` (the column above). '{}' for a collection created in this app.
  origin_json TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE http_items (
  id            TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES http_collections(id) ON DELETE CASCADE,
  -- NULL = a direct child of the collection root. The self-reference cascades for real: db.go's
  -- DSN sets _foreign_keys=1 on every connection (F9), so deleting a folder deletes its subtree at
  -- any depth in one statement.
  parent_id     TEXT REFERENCES http_items(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,               -- 'folder' | 'request'
  name          TEXT NOT NULL,
  sort_order    INTEGER NOT NULL,            -- dense index within this parent's own item[] array
  -- Denormalized out of request_json so the tree renders a method chip and searches URLs without
  -- reading (potentially large) request bodies. '' for a folder. repos/collections.go is the only
  -- writer of either and always writes both together.
  method        TEXT NOT NULL DEFAULT '',
  url           TEXT NOT NULL DEFAULT '',
  -- kind='request': model.SavedRequest (D4) — the request half of the renderer's own
  -- httpRequestTabStateSchema, and the only thing this app actually edits. '' for a folder.
  request_json  TEXT NOT NULL DEFAULT '',
  -- The original Postman item object verbatim, minus its own `item` array (D5). '{}' for an item
  -- created in this app, and individually shed member-by-member as the user edits (D6).
  origin_json   TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX http_items_tree ON http_items(collection_id, parent_id, sort_order);
```

Five choices, each with its reason:

- **Two tables, not one self-referencing table with a `kind='collection'` root.** A collection is
  the *unit of export* and the only thing carrying an `info` block; folding it in would mean a
  nullable `collection_id` on its own root row and an `info` column that is meaningless for 99% of
  rows. Two tables also make `ON DELETE CASCADE` from collection to subtree a single declaration.
- **`parent_id` nullable rather than a synthetic root row per collection**, matching how
  `connection_id` is nullable on `tabs` (`0001_init.sql:89`) — a root child is
  `collection_id = ? AND parent_id IS NULL`, which the index covers.
- **Dense `sort_order`, rewritten wholesale within a parent on any insert or delete**, exactly the
  discipline `TabsRepo.Save` already applies to `tabs."order"` (`repos/tabs.go:99-106`). Sparse
  ordering keys were considered and declined: a collection's children are a handful to a few hundred
  rows, always rewritten inside one transaction, so the gap-management complexity buys nothing.
- **`request_json` and `origin_json` are the last two columns, and `List` never selects them.**
  SQLite stores a row's columns in declaration order and spills the tail into overflow pages, so a
  projection that stops before them is the cheap path for the one query that runs on every panel
  mount.
- **No `UNIQUE` on `(collection_id, parent_id, name)`.** Postman permits duplicate sibling names and
  a nameless item (F1); identity is the id.

`repos.Repos` gains `Collections *CollectionsRepo` (`repos/repos.go:11-25`) and one line in `New`
(`:51-64`). **No prepared statement** — the list query runs once per panel mount, not per keystroke,
so it does not belong in `New`'s hot-statement set.

### D3 — The item tree maps onto rows by (parent, index), and the discriminator is structural
Import walks `item[]` depth-first, in order, assigning `sort_order = <index within this parent>` and
a fresh `uuid.NewString()` id per row (the same id source `repos/saved_queries.go:112` uses). Export
walks `ORDER BY sort_order` and rebuilds the arrays. Order is therefore preserved exactly, in both
directions, with no sorting anywhere in the pipeline.

**Folder vs request** (F1): an object with an `item` member is a folder; otherwise it is a request.
Three edge cases decided rather than discovered:

- **Both members present** (ill-formed): `item` wins, and the `request` member survives untouched in
  `origin_json`, so the export re-emits exactly what came in.
- **Neither member present** (also ill-formed — `item` requires `request`): the row is **skipped**
  and counted in the import report's warnings. Dropping-and-reporting matches
  `repos/saved_queries.go:63-66`'s own drop-and-log posture for a row it cannot classify; refusing
  the whole file for one malformed item would be hostile.
- **A missing `name`** (legal, F1): the request's URL-derived title if there is one, else
  `Untitled request` / `New Folder`. This is the one place import *adds* a member the file lacked;
  it is named here because it makes an otherwise-lossless round trip differ by one key, and the
  alternative — a nameless row in the tree — is worse.

### D4 — The saved request is its own small document, mirrored in Go and TypeScript
`http_items.request_json` holds `model.SavedRequest`: the **request half** of
`httpRequestTabStateSchema`, field name for field name, and nothing else.

```go
// model.SavedRequest is what a saved collection request *is* — deliberately field-identical to the
// request half of packages/shared/domain/http.ts's httpRequestTabStateSchema, so the renderer can
// spread it straight into tab state. Method is a plain string, not a closed enum: Postman's own
// method list is 15 values plus any custom string (P4 F4), and a value this app's builder cannot
// show is coerced at exactly one boundary (D7), not silently rejected at the storage layer.
type SavedRequest struct {
    Method       string           `json:"method"`
    URL          string           `json:"url"`
    Headers      []SavedHeader    `json:"headers"`
    BodyMode     string           `json:"bodyMode"`
    Body         string           `json:"body"`          // the `raw` mode's own buffer
    Code         string           `json:"code"`          // the `code` mode's own buffer
    CodeLanguage string           `json:"codeLanguage"`
    URLEncoded   []SavedField     `json:"urlEncoded"`
    FormData     []SavedFormField `json:"formData"`
    BinaryFile   *SavedFile       `json:"binaryFile"`
}
```

with `SavedHeader{Name, Value string; Enabled bool}`, `SavedField` the same,
`SavedFormField{Name, Kind, Value, Path, FileName string; FileSize int64; ContentType string; Enabled bool}`,
`SavedFile{Path, Name string; Size int64}`.

Three things it deliberately is **not**:

- **Not `state_json`.** The four UI-only fields (`requestPane`, `responsePane`, `responseView`,
  `requestPaneHeight`, `http.ts:195-199`) stay out. They are per-tab furniture; saving them into a
  collection would make scrolling a pane mark a request dirty.
- **Not `httpclient.Body`.** The wire body drops disabled rows and carries no `fileName`/`fileSize`
  (P3 D5, and `views/httprequest/state.ts:11-53` is the filter that does it). A saved request must
  keep a disabled row — that is the whole point of the checkbox.
- **Not opaque to Go, unlike `tabs.state_json`.** `model/tabs.go:8-12` keeps tab state opaque
  because only the renderer ever writes it; here **Go writes it too** (on import), so Go needs the
  type. That is the same division `httpclient.Body`/`HttpBodyWire` already has (P3 D5: the wire
  shape lives in Go and is mirrored, not re-validated, in TypeScript), applied to a stored document
  instead of a call argument.

The TypeScript mirror is `packages/shared/domain/collections.ts`'s `httpSavedRequestSchema`, and it
**is** Zod-parsed — at exactly one boundary, `openCollectionRequestTab`, where the parsed result
becomes tab state and a bad shape would break a render. That reuses the mechanism P3 C3 already
built (`TabKindDef.parseState`, `state/tabKinds.ts:67-70`) rather than adding a second trust
boundary: the tab state is assembled as
`httpRequestTabStateSchema.parse({ ...defaultHttpRequestTabState(), ...saved, itemId, name })`.

`model.SavedRequest.Validate` checks what SQL cannot: a non-empty method, a `bodyMode` in
`validBodyModes`, a `codeLanguage` in the four. A row failing it is **dropped and logged** on read
(`repos/saved_queries.go:23-69`'s posture) and **refused** on write (`repos/tabs.go:84-88`'s).

### D5 — The original Postman JSON is kept verbatim, per row, and that is what makes fidelity real
This is the decision the whole phase turns on. F6 lists five members at three levels this app models
none of, and F7 shows that no typed model — library or hand-written — can round-trip them.

So each row carries `origin_json`: **the original Postman object, verbatim, minus only its `item`
array** (which is the recursion, and lives as rows). Concretely, import decodes each item **twice**:
once into the typed model D7 needs, and once into a `map[string]json.RawMessage` that is stored
as-is. Export starts from `origin_json` and overwrites only what it owns.

What this buys, stated as properties rather than intentions:

- Every `auth` block, every `event[]` script, every `variable[]`, every saved `response[]`, every
  `protocolProfileBehavior`, every `description` in any of its three legal shapes, every
  `request.proxy`/`certificate`, `info._postman_id`/`version`/`description`, and **every member a
  future Postman revision adds that this plan has never heard of** comes back out unchanged.
- The one thing genuinely not preserved is **member order within a JSON object**, since
  `map[string]json.RawMessage` re-marshals sorted. That is not semantic in JSON, Postman's own
  exporter does not guarantee it either, and a `git diff` of two exports is not a workflow this
  phase supports (`docs/v1.2/SPEC.md`'s P4 row explicitly defers the git-based workflow). Named
  here so it is a known property, not a surprise.

**The cost, with the arithmetic.** For an imported, unedited request the body text is stored twice —
once inside `origin_json`'s `request.body`, once in `request_json`. A collection whose file is 5 MB
becomes roughly 8–9 MB of rows. D6's shedding rule caps this: the moment a member is edited, its
stale copy is deleted from `origin_json`, so the duplication only ever covers requests the user has
not touched. The alternative — storing hashes and rebuilding everything — makes "re-emit verbatim"
impossible, which is the property being bought. The duplication is the price of the property and it
is a fair one for a file the user already has on disk.

### D6 — Export rewrites exactly three members, and only when they actually changed
The export rule, in one sentence, applied per request item:

> Start from `origin_json`. Set `name`. For each of **`url`**, **`header`** and **`body`**: if
> re-running the *importer* over the origin's own member yields exactly what is stored in
> `request_json`, re-emit the origin member **byte-identically**; otherwise write a freshly built
> member from `request_json`. `method` is always written from `request_json`. Every other member is
> re-emitted from origin, untouched.

Why this exact shape:

- **It is one rule, not four heuristics.** `import(origin.X) == stored.X ? origin.X : build(stored.X)`
  is mechanically checkable and directly testable (§6.2's round-trip corpus is nothing but this
  assertion at scale).
- **It makes an untouched round trip lossless where it matters most.** `url`'s parsed breakdown, its
  `variable[]` path variables and its per-query-param `description`/`disabled`; each header's
  `description`; `body.options` beyond `raw.language`, `body.disabled`, and the per-row
  `description` on urlencoded and form-data entries — all survive, because none of them was touched.
- **It guarantees an edited request exports something correct rather than something stale.** Edit the
  URL and the exported `url` object is rebuilt from the new string; the old `raw`, `host[]` and
  `path[]` cannot linger and disagree with it.
- **`method` needs no origin path** — there is nothing to preserve beyond the string itself, and
  writing it unconditionally removes a comparison.

**Shedding.** `CollectionsRepo.SaveRequest` performs the same comparison and *deletes* each rewritten
member from `origin_json` before writing. So an edited request stops carrying a stale duplicate of
its own body (D5's cost), and export's rule degenerates correctly: with the member gone from origin,
the `else` branch is taken.

The honest boundary, stated plainly because the brief asks for it:

- **A collection this app created and re-exports round-trips losslessly.** There is no origin, every
  member is built canonically, and re-importing that file reproduces the same rows.
- **A collection imported from real Postman and re-exported *untouched* round-trips losslessly**
  (modulo object member order, D5) — every member is re-emitted verbatim.
- **A collection imported from real Postman, *edited*, and re-exported does not round-trip
  losslessly, and cannot.** The edited member is rebuilt in this app's canonical form, which drops
  what this app does not model *about that member*: a query param's `description` and its `disabled`
  flag when the URL changed (P2 §8 OQ-1 — a disabled param has no representation in a URL-authoritative
  model); a header's `description` when the header list changed (P3 §8 OQ-5); a form-data row's
  `description` when the body changed; and a `graphql` body's identity the moment it is edited (D7).
  This is a real limitation and it is stated rather than hidden.

### D7 — The body-mode translation, both directions
**Import**, Postman → this app:

| Postman `body` | this app | Notes |
|---|---|---|
| absent, `null`, or no `mode` | `bodyMode:'none'` | |
| `mode:'raw'`, `options.raw.language` absent or `"text"` | `bodyMode:'raw'`, `body:<raw>` | plain text is what `raw` now means |
| `mode:'raw'`, language `"javascript"`/`"json"`/`"html"`/`"xml"` | `bodyMode:'code'`, `code:<raw>`, `codeLanguage:<language>` | the split, translated |
| `mode:'raw'`, an **unrecognised** language | `bodyMode:'raw'`, `body:<raw>` | F3: `options` is untyped, so the value is free-form. Degrades to plain text; the original language survives in origin, so an unedited export restores it |
| `mode:'urlencoded'` | `bodyMode:'urlencoded'`, rows `{name:key, value, enabled: !disabled}` | `description` → origin (P3 §8 OQ-5) |
| `mode:'formdata'`, `type:'text'` (or absent) | `{name:key, kind:'text', value, contentType, enabled: !disabled}` | `type` is optional in the `anyOf`; absent means text |
| `mode:'formdata'`, `type:'file'`, `src` a string | `{name:key, kind:'file', path:src, fileName: filepath.Base(src), fileSize: 0, contentType, enabled}` | not `os.Stat`ed at import (D12) |
| `mode:'formdata'`, `type:'file'`, `src` an **array** | **N rows with the same key**, one per entry | P3 §8 OQ-6(a), answered: expansion is lossless *for sending* (repeated names are legal in a multipart form) and legal *for exporting* (Postman accepts repeated `formdata` keys). No collapse heuristic on export is needed, because D6 re-emits the original array verbatim for an untouched body |
| `mode:'formdata'`, `src: null` | a file row with `path: ''` | the picker shows "No file chosen"; `prepareFormParts` (`body.go:201-204`) already refuses a send with a legible message |
| `mode:'file'`, `src` a string | `bodyMode:'file'`, `binaryFile:{path:src, name: filepath.Base(src), size:0}` | F5: the schema calls `src` a *name*, so this is optimistic by design and reported |
| `mode:'file'`, `src` null, or only `content` | `bodyMode:'file'`, `binaryFile: null` | P3 §8 OQ-6(b), answered: **no temp file is written.** Inlined base64 content is preserved in origin (so export is lossless) and reported as unresolvable. Materialising a temp file would put an app-created file on disk with no owner, no lifetime and no cleanup story — a real feature, not a corner |
| `mode:'graphql'` | `bodyMode:'code'`, `codeLanguage:'json'`, `code:` the **GraphQL-over-HTTP envelope** | see below |
| `body.disabled: true` | imported as its mode | no equivalent in this app; preserved in origin. Postman keeps the body and doesn't send it; this app will send it. Named in the report |

**The `graphql` decision, which the brief asks to be explicit about.** Four options were real:
refuse the whole file; skip the item; import as `none`; import as JSON. The answer is **import as
`code`·`json`, carrying the envelope this app would actually have sent**, i.e.
`{"query": <graphql.query>, "variables": <graphql.variables parsed when it is valid JSON, omitted otherwise>}`
— byte-for-byte what P3 D6's own GraphQL serializer built before GraphQL was removed, and what
`Content-Type: application/json` + a GraphQL-over-HTTP endpoint expects. Reasoning:

1. **The imported request stays runnable**, which is the entire point of importing it. `none` and
   *skip* both produce a request that silently does nothing; refusing the file for one item is
   hostile when real exports routinely contain one.
2. **The round trip stays lossless while it is untouched** — D6 re-emits `mode:'graphql'` verbatim,
   so importing and re-exporting a GraphQL-bearing collection produces a file Postman still reads as
   GraphQL.
3. **The moment the user edits that body, it stops being a GraphQL body**, and export writes
   `mode:'raw'` + `options.raw.language:'json'`. That is honest: an app with no GraphQL mode cannot
   claim to have edited a GraphQL body. It is stated in the report and in `ARCHITECTURE.md`.

Note the schema gives no help here (F3: `"graphql": {"type":"object"}`), and P3 §8 OQ-1's three
sub-questions — whether `variables` is a string or an object, whether `operationName` appears —
remain unverified from a first-party source. The importer therefore handles **both** shapes for
`variables` (a string is parsed as JSON when valid, otherwise carried as a JSON string) and copies
`operationName` into the envelope when present. §8 OQ-1 carries the residue.

**The method (F4).** `SavedRequest.Method` stores whatever the file said. The coercion happens at
**one** boundary — `openCollectionRequestTab`, where the state must satisfy the seven-member Zod
enum: an unsupported method becomes `GET`, the original survives in `origin_json`, export restores
it, and the import report counts it. Widening `HTTP_METHODS` was declined here because a 15-option
`<select>` plus a custom-method affordance is a request-*builder* change and this is a storage
phase; §8 OQ-3 hands it forward.

**Export**, this app → Postman, under D6's `else` branch:

| this app | Postman `body` |
|---|---|
| `none` | member omitted entirely |
| `raw` | `{"mode":"raw","raw":<body>,"options":{"raw":{"language":"text"}}}` |
| `code` | `{"mode":"raw","raw":<code>,"options":{"raw":{"language":<codeLanguage>}}}` |
| `urlencoded` | `{"mode":"urlencoded","urlencoded":[{"key","value","disabled"?}]}` — `disabled` emitted only when true, matching the schema's `default: false` |
| `formdata` | `{"mode":"formdata","formdata":[{"key","type":"text","value","contentType"?,"disabled"?} \| {"key","type":"file","src","contentType"?,"disabled"?}]}` |
| `file` | `{"mode":"file","file":{"src":<path>}}`, or `{"mode":"file","file":{"src":null}}` when there is no file |

`language:"text"` is written explicitly for `raw` rather than omitted, so a Postman import shows the
Text sub-selector rather than Postman's own default — the export states the app's intent instead of
relying on a default it does not control.

### D8 — The URL: the raw string is canonical; export writes Postman's own broken-down object
This app's model is URL-authoritative (P2 D6/D9: there is no `params` array, the Params table is a
derived editor over `state.url`, and `views/httprequest/url.ts` is the pure splitter). Postman's
`url` is `oneOf [object, string]` and its own exporter always writes the object in v2.1 (F2).

- **Import**: a string `url` is the URL. An object `url` uses `raw` when it is present and non-empty
  — which is the common case and which preserves `:pathVariable` segments and `{{baseUrl}}`
  references exactly as typed. When `raw` is absent, the URL is reconstructed from
  `protocol`/`host`/`port`/`path`/`query`/`hash`, with `host` and `path` each handling both their
  string and array forms (F2), and a path-variable segment object contributing its `value`.
  A `query` entry with `disabled: true` is **omitted from the reconstructed string** (a disabled
  param has no representation in a URL — P2 §8 OQ-1) and survives in origin.
- **Export**, when the URL changed: a full object — `{raw, protocol, host: [...], port, path: [...],
  query: [{key, value}], hash}` — derived from the string by `internal/postman/url.go`, with `host`
  split on `.` and `path` on `/`, empty members omitted. Writing a bare string would also be legal,
  but the object is what Postman itself writes and is the shape with no ambiguity about how it is
  consumed. A `{{variable}}` in the host or path is passed through as a single segment rather than
  split, so P5's own syntax survives untouched.
- **Export**, when the URL did not change: the original value re-emitted verbatim (D6) — including
  its `variable[]`, its query descriptions and its disabled params.

`internal/postman/url.go` is a Go sibling of `views/httprequest/url.ts:16-58`, deliberately **not**
`net/url.Parse`: like the TypeScript half, it must handle a half-formed or `{{variable}}`-bearing
URL without throwing, and `net/url` has its own escaping opinions the round trip must not inherit.
The two files' shared rule (split on the first `?` and the first `#`) is stated in both.

### D9 — Auth, scripts, variables and saved responses are preserved losslessly and are inert — and the P5 hand-off is a contract, not a hope
| Member | P4 |
|---|---|
| `event[]` (pre-request/test scripts), all three levels | **preserved verbatim, never executed** |
| `auth`, all three levels | **preserved verbatim, never applied** |
| `variable[]`, all four levels | **preserved verbatim, never resolved, edited or displayed** |
| `response[]` (saved examples) | **preserved verbatim, never rendered** |
| `protocolProfileBehavior` | preserved verbatim |

**Scripts: preserved, not dropped, and here is why rather than a shrug.** Executing them means
shipping a JS sandbox and deciding whether arbitrary JavaScript from a file the user just imported
may run inside this app — a security decision with no mandate in `docs/v1.2/SPEC.md`'s phase table.
But *dropping* them would make export destructive for the single most common real-world collection
feature after requests themselves: import a tested collection, add one header, export, and every
test is gone with no warning. Preserved-but-inert costs one column that D5 already added and zero
UI, and D12's report says so out loud exactly once so nobody believes they run.

**Auth: preserved, not applied, and the consequence is named.** Applying it needs a request-composition
surface (an Auth tab — P2 §8 OQ-5, still open), a signer for each of the eleven types beyond
Basic/Bearer (`awsv4`, `digest`, `hawk`, `ntlm`, `oauth1`, `oauth2`, `edgegrid`), and a decision
about where a credential is stored (`internal/secrets`). That is a phase. **The honest consequence:
an imported request that relied on collection-level Bearer auth will 401 when sent from this app**
until that phase lands. The report counts auth-bearing items so the user learns it at import time
rather than from a confusing 401.

**Variables: the answer to the brief's explicit question is that survival is in scope now and
everything else is P5's.** `docs/v1.2/SPEC.md` assigns collection variables and environments to P5;
P4 neither resolves `{{name}}` nor offers a place to edit one. What P4 guarantees is that a
collection's `variable[]` at every level survives an import/export round trip untouched.

**The contract P5 must honour**, stated here because P5 will otherwise export them twice: when P5
promotes `variable[]` out of `origin_json` into its own table, it must **remove that member from
`origin_json` in the same migration**, and take over emitting it in `internal/postman/write.go`.
D6's rule already has the right shape for it — `variable` simply joins `url`/`header`/`body` as a
member the exporter owns.

### D10 — v2.1 only, checked leniently
`info` requires `["name","schema"]`, and `info.schema` *"should ideally hold a link to the Postman
schema"*. Import's rule:

- `info.schema` containing `v2.1.0` → parse.
- `info.schema` **absent or unrecognised** → parse anyway. Hand-written and SDK-generated
  collections routinely omit it, and refusing a file for a missing advisory URL is the validator
  mistake D1 declined.
- `info.schema` explicitly naming `v2.0.0` or `v1` → **refuse**, with a message naming the version
  found and suggesting Postman's own upgrade. v2.0's `url` is string-only and it has no
  `options.raw.language` at all, so "supporting" it would mean a second translation table that is
  half-tested by construction — precisely `AGENTS.md`'s *"left out entirely, not half-implemented"*.

Export always writes
`"schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"` — the string
Postman's own exporter writes and its importer checks — regardless of what the imported file said,
because the file being written **is** v2.1 by construction. This is the one `info` member that is
not re-emitted from origin.

Export writes the file with `json.MarshalIndent(v, "", "\t")` and
`Encoder.SetEscapeHTML(false)` — the same `mustMarshalNoEscape` discipline
`internal/ipcfixture/write.go` already applies for the same reason (Go's default escapes `<`, `>`
and `&`, which would mangle an HTML body or a `{{var}}`-adjacent character in a way that survives
re-import but reads as corruption in a diff).

### D11 — Import and export are Go, behind one new bound service, with no op-log row
**Go reads and writes the file.** F16 is the measurement: a 10–50 MB collection through the control
plane is 20–100 serial round trips, and above 64 MiB it is refused outright with a message the user
could never attribute. The renderer's whole involvement is a path string from
`FilesService.ChooseOpen`/`ChooseSave` — the identical shape P3 D4 established for a request body's
file, and the identical shape `state/objectStore.ts:61-78` already uses for an S3 download.

`internal/postman` is self-contained: no `storage`, no `adapters`, no Wails — one `Parse(io.Reader)
(*Tree, error)` and one `Write(io.Writer, *Tree) error`, drivable from a plain `go test` with a
`testdata/` corpus. That is `internal/httpclient`'s own shape (P2 D4) applied to a second
self-contained concern. `postman.Tree` carries exactly what the rows carry — name, kind, order,
`model.SavedRequest`, origin — so `repos/collections.go` maps it in about twenty lines.
`internal/postman` imports `internal/storage/model` for `SavedRequest`; `model` imports only the
standard library, so there is no cycle.

`bridge/collections.go` is `CollectionsService{Deps appcore.Deps}` — the `QueriesService` shape
(`bridge/queries.go:13`) — with nine methods, each a typed-struct wrapper with an explicit guard and
an `ipcerr` translation:

| Method | Returns |
|---|---|
| `List()` | `CollectionsTree{Collections []CollectionSummary; Items []ItemSummary}` — **flat arrays**, the renderer builds the tree, mirroring how `TreeService.Children` returns flat nodes. One call per panel mount; no N+1 |
| `GetRequest({itemId})` | `model.SavedRequest` — read on demand, so the list path never touches `request_json` |
| `SaveRequest({itemId, name, request})` | the updated `ItemSummary` |
| `CreateCollection({name})` | `CollectionSummary` |
| `CreateItem({collectionId, parentId, kind, name, request})` | `ItemSummary` |
| `Rename({id, target, name})` | `void` (`target` is `'collection' \| 'item'`) |
| `Delete({id, target})` | `void` |
| `Import({path})` | `ImportReport` |
| `Export({collectionId, path})` | `void` |

`main.go:190-206` gains one `application.NewService(&bridge.CollectionsService{Deps: deps})` line.

**No op-log row and no new op kind.** `docs/ARCHITECTURE.md:71` states *"Every operation that can
exceed ~150 ms shows progress and a working stop button"*, and this is the reasoning rather than an
omission:

- The ring-and-Stop machinery that invariant refers to is `ViewChrome` + `useRunState(tabId)`, which
  is **per tab**. An import initiated from the left panel has no tab, so joining the op log would
  buy an Operations-panel row and nothing the user is looking at.
- Cancelling a single all-or-nothing local transaction has no useful semantics — the tree either
  gains the collection or it does not.
- The Operations panel is a *database* activity log; P2 D3 already widened it once for HTTP, and
  P2 §8 OQ-6 flagged the resulting naming strain. Widening it again for a file import is the wrong
  trade inside a storage phase.

What the invariant is honoured with instead: the panel's own header action is disabled with a
spinner for the duration, and the whole import is one transaction (F10 means it blocks nothing else).
The honest residue — a pathological, tens-of-megabytes collection blocking that one call for a
second or two with only a spinner — is §8 OQ-5.

### D12 — The import report is part of the feature, not decoration
`Import` returns:

```go
type ImportReport struct {
    CollectionID string          `json:"collectionId"`
    Name         string          `json:"name"`
    Folders      int             `json:"folders"`
    Requests     int             `json:"requests"`
    Warnings     []ImportWarning `json:"warnings"` // {Kind string; Count int; Detail string}
}
```

Eight warning kinds, each corresponding to a decision above, each counted rather than listed
per-item:

| Kind | Message |
|---|---|
| `scripts_inert` | *"N pre-request/test scripts were kept but are not run — they survive an export unchanged."* (D9) |
| `auth_inert` | *"N requests or folders carry an auth block. It is kept but not applied — those requests will need an Authorization header."* (D9) |
| `variables_inert` | *"N collection variables were kept but are not resolved yet."* (D9, P5) |
| `graphql_body` | *"N GraphQL bodies were imported as JSON bodies carrying the same query."* (D7) |
| `unsupported_method` | *"N requests use a method this builder cannot show yet and will open as GET."* (F4) |
| `unresolved_file` | *"N requests reference a file by a name or a path from another machine."* (F5) |
| `inline_file_content` | *"N binary bodies carry inline content rather than a file. The content is kept, but a file must be chosen before sending."* (D7) |
| `malformed_item` | *"N items were neither a folder nor a request and were skipped."* (D3) |

Rendered by `http/ImportReportStrip.vue` — a `MessageStrip` under the panel header, dismissible,
carrying the counts and the warning lines. It exists because every one of these is a case where the
app quietly does something other than what the file says, and the alternative to telling the user is
letting them find out from a 401 or an `E_BAD_REQUEST` minutes later.

A **pre-import preview dialog** was considered and declined: it is a second UI for an operation that
is almost never wrong, and the report after the fact carries the same information at a tenth of the
cost. Import is not undoable in P4; deleting the collection is the undo, and it is one context-menu
item away.

### D13 — The collections tree is a real `TreeHost` consumer, not a parallel implementation
Four new files under `http/`, and **not one line of tree mechanics** among them.

**`http/state/collections.ts`** — the store and the row model:

```ts
export interface CollectionRowVm {
  key: string;               // `c:<id>` | `i:<id>` — TreeHost's own required member
  depth: number;             // StickyRowLike
  hasChildren: boolean;      // StickyRowLike
  expanded: boolean;         // StickyRowLike
  kind: 'collection' | 'folder' | 'request';
  id: string;
  collectionId: string;
  parentId: string | null;
  name: string;
  method: string;            // requests only — the row's leading chip
  url: string;               // requests only — searched, not shown
  matched: boolean;
}
```

Four structural members plus seven of its own — versus `TreeRowVm`'s fourteen
(`project/state/tree.ts:11-32`), of which `connectionId`, `color`, `status`, `statusDetail`,
`groupKind`, `badges`, `loading` and `error` have no meaning here. That is F(P1 §2 F4/F5) restated
from the other side — the *mechanics* generalize, the *rows* do not, which is exactly why P1 factored
`TreeHost` out and left `TreeRow` where it was.

`collectionsState = reactive({ collections: [], items: [], expanded: new Set<string>(), selected: null, search: '', renamingKey: null, requests: {} as Record<string, HttpSavedRequest>, busy: false, report: null })`.
`visibleRows` is a **pure computed** over `collections`/`items` — no children cache, no loading set,
no debounce, no *"Searching cached nodes only"* note. F15 is why: the entire tree arrives in one
`List()` call because it is rows in a local table, so there is nothing to fetch lazily and nothing
to be incomplete about.

Search: a row survives if its `name` or `url` matches the query case-insensitively, **or** it has a
surviving descendant. While a query is active every ancestor of a match renders expanded without
mutating `expanded`, so clearing the search restores exactly the shape the user had.

**`http/CollectionsTree.vue`** — mounts `TreeHost` with `:rows="visibleRows"`, the same
`rowHeight` computed from `settingsState.appearance.rowDensity` `ProjectTree.vue:54` uses,
`:selected-key`, a `#row` slot, and `@background-contextmenu`. Keyboard via
`shortcutFor(e, ['tree.open','tree.rename','tree.delete','tree.duplicate'])` plus `←`/`→` for
collapse/expand — the same shape `ProjectTree.vue:158-174` has, over the existing shortcut ids (§3).

**`http/CollectionRow.vue`** — the same 8 + depth × 14 px indent, roving tabindex and twisty as
`project/TreeRow.vue:96-128`, with three differences that are the whole reason it is a separate file:
no connection rail, no status dot, no `EngineIcon`; a leading **method chip** for a request row
(coloured by `httpMethodClass`, D16 — what Postman itself shows and what makes a long request list
scannable); and an **inline rename input** that replaces the label when
`collectionsState.renamingKey === row.key`, committing on Enter/blur and cancelling on Escape.

Inline rename is deliberately doing double duty: *New collection*, *New folder* and *New request*
each create the row with a default name and immediately put it in rename mode, so there is one
naming interaction instead of a prompt dialog the app does not have (`state/confirmDialog.ts` is
confirm-only; every other named creation in the app goes through a full-blown dialog like
`ConnectionDialog.vue`, which is far more than a name needs). It is also VS Code's explorer
behaviour, which is the tree this panel is modelled on.

Icons: `folder-library` for a collection, `folder`/`folder-opened` for a folder (the same
expand-state flip `TreeRow.vue:28` already does for a group), and no icon for a request — the method
chip is its identity.

**`http/menus.ts`** — the row and background context menus, built with the existing `MenuItem` type
from `state/contextMenu.ts` (a permitted `http/ → state/` edge, the same one
`CollectionsPanel.vue:2` already uses):

- collection: *New request*, *New folder*, ─, *Rename* (`tree.rename`), *Export collection…*, ─,
  *Delete* (`tree.delete`, `danger`)
- folder: *New request*, *New folder*, ─, *Rename*, *Duplicate* (`tree.duplicate`), ─, *Delete*
- request: *Open*, ─, *Rename*, *Duplicate*, *Copy URL*, ─, *Delete*
- background: *New collection*, *Import collection…*

**`http/CollectionsPanel.vue`**, rewritten: `LeftPanel` with `v-model:search`,
`:empty="collections.length === 0"`, `#title` `Collections`, `#actions` keeping
`data-testid="new-request"` **exactly as it is** (F11) plus *New collection* and *Import
collection…*, `#body` the tree, and an `#empty` state offering *New collection* / *Import
collection…* alongside the existing `data-testid="new-request-empty"` button. `HttpStart.vue` keeps
`data-testid="new-request-start"` untouched and gains a secondary *Import collection…* action.

### D14 — A saved request opens the **existing** `'http-request'` tab; identity lives in the state, not the path
Answering the brief's fourth question directly: **yes** — the same view P2 and P3 built, with its
state sourced from a collection row instead of `defaultHttpRequestTabState()`.

`httpRequestTabStateSchema` gains exactly two fields, both `.default()`ed like every other
(`http.ts:184-200`):

```
itemId   z.string().nullable()   .default(null)   // the http_items row this tab is bound to
name     z.string()              .default('')     // the saved request's name, so the title stays pure
```

`state/tabs.ts` gains:

```ts
export function openCollectionRequestTab(itemId: string, name: string,
                                         saved: HttpSavedRequest): OpenTabResult
```

which activates an existing `http-request` tab whose `state.itemId === itemId` if there is one, and
otherwise creates a fresh one via the existing `openTab('http-request', null, 'request', …)` with
`reuse: false`.

**`path` stays the literal constant `'request'`.** P2 D2 explicitly offered P4 the option of a real
`collection:<id>/request:<id>` path, and F13 is why it is declined: `duplicateTab` copies `path`
verbatim (`state/tabs.ts:411`) while `duplicateState` clears `itemId`, so a duplicated tab would
carry the saved request's *path identity* with a state that says it is unsaved — and `openTab`'s
reuse lookup would then activate the duplicate when the user opened the original. Keeping identity
in exactly one place (`state.itemId`) and doing the lookup explicitly is four lines and has no such
failure mode. `path` therefore keeps the property `ARCHITECTURE.md:600-604` records for it —
*"carrying no false uniqueness"*.

`TAB_KINDS['http-request'].duplicateState` (`state/tabKinds.ts:221-227`) gains
`itemId: null, name: ''` to its spread: a duplicated tab is an **unsaved copy**, which is what
duplicating a saved request to try a variant means.

`httpRequestTitle` (`views/httprequest/url.ts:66-78`) gains one leading line —
`if (state.name) return state.name;` — keeping it pure and keeping `state/tabKinds.ts:210` and
`HttpRequestView.vue:26` unchanged (F12). Renaming a request in the tree calls
`renameHttpRequestTabs(itemId, name)` in `state/tabs.ts`, which patches every bound tab's
`state.name`, so the strip and the header follow immediately.

**The orphan rule**: an `itemId` that no longer resolves (its row was deleted, in this window or
another) is treated as unsaved — Save falls back to *Save as…*, and the header shows the name it
last knew. Deleting a request does **not** close its open tabs; a tab is an editing surface with its
own persisted state, and silently closing one because a tree row went away would lose work.

### D15 — Save, Save as…, and a dirty mark that is a computation, not a state machine
Two views of the same request exist by construction: `http_items.request_json` (the saved one) and
`tabs.state_json` (the tab's, autosaved on the existing 1 s debounce, `state/tabs.ts:122-128`). P4
does **not** merge them, and that is deliberate:

- **Autosaving edits straight into the collection row** was considered — it is what tabs, layout and
  settings all do. Declined: it makes "open a saved request and try something" destructive, which is
  the single most common thing anyone does with a saved request, and it gives no place to stand for
  a *Revert*.
- **A stored dirty flag** was also declined. Dirtiness is `toSavedRequest(tab.state)` deep-compared
  against `collectionsState.requests[itemId]` — a pure function of two things already in memory, so
  there is no flag to set, clear, migrate or get wrong.

`views/httprequest/saved.ts` (new, pure, DOM-free in the spirit of `url.ts:1-5`) is
`toSavedRequest(state) → HttpSavedRequest`, `fromSavedRequest(saved) → Partial<HttpRequestTabState>`
and `isDirty(state, saved)`. `toSavedRequest` drops the four UI-only fields (D4), which is what stops
resizing the request pane from marking a request dirty.

The affordance: a `Save` `AppButton` beside Send in `HttpRequestView.vue`'s `#toolbar`, enabled when
`itemId !== null && isDirty(...)`, and a `Save as…` that opens `http/SaveRequestDialog.vue` — one
`TextField` for the name and one indented `<select>` of every collection and folder as the target,
on the existing `DialogFrame`. A `•` sits next to the name in the view header while dirty; the tab
strip gets **no** dirty dot, because `TabStrip.vue` renders purely from `TAB_KINDS`
(`ARCHITECTURE.md:587-590`) and adding a `dirty(tab)` registry member for one kind out of eight is a
shared-machinery change for a cosmetic gain. §8 OQ-8.

**No ⌘S.** `packages/shared/domain/shortcuts.ts` is a closed map and a menu accelerator needs the
seven-file path P1 §8 OQ-3 / P2 §8 OQ-7 deferred as one deliberate pass. Two palette entries —
`{id:'http.save', label:'Save request'}` and `{id:'http.import', label:'Import collection…'}` — are
the discoverability answer, exactly the bar `shortcuts/state.ts:15-18` states for that list and the
same one P2 D13 used for *New request* (`:23`).

### D16 — `httpMethodClass` moves into the shared domain
`HttpRequestView.vue:32-40`'s `METHOD_CLASS` maps a method onto `.p-chip`'s four variants. The tree
row needs the same map, and `http/**` may not import `views/**` (`biome.json:139-142`). Rather than
copy seven lines into `http/`, `httpMethodClass(method: string): 'info'|'ok'|'warn'|'err'` joins
`statusClass` (`packages/shared/domain/http.ts:266-271`) — its exact sibling, in its exact home —
and `HttpRequestView.vue` imports it. Takes a plain `string`, not `HttpMethod`, so an imported
`PROPFIND` (F4) has a colour rather than an exception.

### D17 — One new parity pair, on the vocabulary that would drift silently
The translation table lives only in Go, so most of it needs no parity guard. One list does: the four
**code languages**. If a fifth is ever added on the TypeScript side, `internal/postman/body.go`'s
importer would silently stop recognising it (importing that language's bodies as plain `raw`) and
its exporter would silently stop emitting it — with nothing failing.

`internal/postman/body.go` therefore declares

```go
// P4 D17: a map[string]bool literal, read as plain text by
// tests/unit/go-ts-vocabulary-parity.spec.ts against CODE_LANGUAGES (http.ts) — do not turn this
// into a switch or derive it from another table.
var postmanCodeLanguages = map[string]bool{
    "javascript": true, "json": true, "html": true, "xml": true,
}
```

and the spec gains a third `describe` using the existing `extractGoStringSet`
(`go-ts-vocabulary-parity.spec.ts:23-34`) — no new extractor, no new technique.

### D18 — What the tree deliberately does not do, so it is chosen rather than drifted into
- **No drag-reorder and no move-between-folders.** `TreeHost.vue` has no drag support at all
  (`TabStrip.vue:144-157`'s reorder is bespoke to the strip), and doing it properly means drop
  targets between rows *and* into rows, auto-expand-on-hover, and a cross-parent reindex. The
  `sort_order` column and the dense-rewrite discipline (D2) exist so that landing it later is a
  UI change and not a migration. Creating *into* a chosen folder via the context menu is enough to
  build a structure in P4. §8 OQ-9.
- **No multi-select, no cut/copy/paste of items.**
- **No collection-settings surface.** Nothing in P4 edits `origin_json`'s contents; the tree renames
  and deletes, and the request view edits a request.
- **No "unsaved request" persistence into a collection on close.** A scratch tab stays a scratch tab
  until *Save as…*, which is P2's behaviour unchanged.

---

## 5. Implementation order

Twelve commits. C1–C4 add capability with nothing mounted (each builds and tests on its own); C5–C6
make the feature exist; C7–C10 are one user-visible slice each; C11–C12 are the tests and the docs.
Per `AGENTS.md`, run the fast checks (`lint`, `typecheck`, `build`, `go build`/`go vet`) per commit
and the expensive suites once at the end.

### C1 — `feat(postman): the Collection v2.1 format, read and written`
`internal/postman/{collection,parse,write,body,url}.go` plus `*_test.go` and `testdata/`. F2's six
`oneOf` decoders, D5's origin capture, D6's unchanged-⇒-verbatim writer, D7's translation both ways,
D8's URL splitter/builder, D10's version gate, D17's parity map. Depends on `internal/storage/model`
for `SavedRequest`, so D4's model types land here too. **Nothing calls it** —
`go test ./apps/kira-studio/internal/postman/...` is the whole proof, the shape P2's C2 and P3's C1
both took.

### C2 — `feat(storage): collections, folders and requests in SQLite`
`migrations/0006_p4_collections.sql` + the `embed.go` entry (D2), `model/collections.go`'s
validation, `repos/collections.go`, `repos/repos.go`'s one field, `repos/collections_test.go`
(§6.2). Still no caller. Guard: `go test ./apps/kira-studio/internal/storage/...` — which, per
`repos/helpers_test.go:12-24`, runs the **real** migration chain against a real temp-file database,
so the migration is covered by construction.

### C3 — `feat(bridge): CollectionsService`
`bridge/collections.go`'s nine methods (D11), the `main.go` service line, `control.ts`'s nine
wrappers, bindings regenerated via `wails3 task common:generate:bindings` (never a hand-typed flag
list — `AGENTS.md`'s `-names` warning), plus `tests/ui/support/ipcChannels.ts`'s nine names,
`mockRuntime.ts`'s nine FQNs and the `collectionsList: '[]'` wildcard (F11).

### C4 — `feat(shared): the saved-request document and a request's collection identity`
`packages/shared/domain/collections.ts` (D4's `httpSavedRequestSchema`, the tree summaries, the
report type); `http.ts`'s `itemId`/`name` fields and `httpMethodClass` (D16);
`views/httprequest/saved.ts` (D15's three pure functions); `state/tabKinds.ts`'s `duplicateState`
clearing both new fields (D14); `httpRequestTitle`'s one new line; `HttpRequestView.vue` importing
`httpMethodClass` instead of its local map. No new UI. **Guard: `tests/ui/http-request.spec.ts` and
`http-request-body.spec.ts` pass unedited** — two `.default()`ed fields cannot change a P3 tab's
behaviour, and if they do, the defaults are wrong.

### C5 — `feat(http): a real collections tree in the left panel`
`http/state/collections.ts`, `http/CollectionsTree.vue`, `http/CollectionRow.vue`, `http/menus.ts`,
and `CollectionsPanel.vue` rewritten (D13). Read-only at this point: the tree lists, expands,
selects, searches and reveals; no creation, no rename, no open. **Guard:
`tests/ui/mode-switch.spec.ts` passes unedited** (F11: the wildcard from C3 plus the preserved
`Collections` title and `new-request` testids are what make that true).

### C6 — `feat(http): open a saved request into the request tab`
`openCollectionRequestTab` (D14), the double-click/Enter dispatch in `CollectionsTree.vue`, the
`GetRequest` fetch and its `collectionsState.requests` cache, the saved name in the view header and
the tab strip.

### C7 — `feat(http): create, rename and delete collections, folders and requests`
Inline rename (D13), the three creation paths, `confirmDialog`-gated delete (the
`project/menus.ts:245` precedent), the empty state's own actions, and the two palette entries.

### C8 — `feat(http): save a request into a collection`
The Save / Save as… affordances, `SaveRequestDialog.vue`, the dirty mark, `SaveRequest`'s
origin-shedding half (D6), `renameHttpRequestTabs`.

### C9 — `feat(http): import a Postman collection`
The `ChooseOpen` call with a `Postman collection`/`json` filter, `CollectionsService.Import`, the
tree refresh, `ImportReportStrip.vue` (D12), and the `HttpStart.vue` secondary action.

### C10 — `feat(http): export a collection as Postman v2.1 JSON`
The `ChooseSave` call defaulting to `<name>.postman_collection.json`,
`CollectionsService.Export`, the context-menu item.

### C11 — `test: the Postman round trip, the collections repo, and the tree`
`internal/postman`'s golden round-trip corpus (§6.2), `repos/collections_test.go`'s ordering and
cascade cases, `tests/ui/collections.spec.ts` (§6.3), and D17's parity pair.

### C12 — `docs(architecture): collections storage, and the Postman boundary`
`docs/ARCHITECTURE.md`: the Storage schema block (`:456-469`) gains both tables; a Storage paragraph
for D5's origin column and what it buys; a UI-architecture paragraph for the collections tree as
`TreeHost`'s second consumer and for a saved request opening the existing tab kind; and — appended
to the existing body-mode paragraph at `:624-650`, which currently ends by handing the translation
to this phase — the resolved translation, including the GraphQL answer and the two honest
lossiness boundaries from D6.

---

## 6. Verification

### 6.1 What runs here
`bun run lint`, `bun run typecheck`, `bun run build`, `bun run test:unit`, `bun run test:ui`,
`bun run test:ipc:fe`, plus `go build ./... && go vet ./... && go test ./apps/kira-studio/internal/...`.
`scripts/setup.sh` first in a fresh container — **mandatory this phase**: C3 adds a bound service, so
`apps/kira-studio/frontend/bindings/**` must be regenerated or the Vite build fails on an
unresolvable import.

Two bindings checks, from `AGENTS.md`'s own warnings and P2/P3's precedent:

1. The generated `collectionsservice.ts` must call
   `$Call.ByName("…bridge.CollectionsService.List", …)`, not `$Call.ByID(<n>, …)` — a `-names`-less
   regeneration silently breaks **every** `tests/ui` spec at the first bound call of boot,
   surfacing as a `status-bar` selector timeout with a page-level
   `no CHANNEL_TO_FQN entry for undefined`.
2. The regenerated models must include `model.SavedRequest`, `model.SavedFormField`,
   `bridge.CollectionsTree`, `bridge.ItemSummary` and `bridge.ImportReport` as real exported types.
   Nested structs inside an args/result struct are a shape this repo already generates
   (`FilesChooseOpenResult.File *ChosenFile`, `bridge/files.go:34-37`), but confirming once beats
   assuming.

### 6.2 The Go tests, and what they deliberately do not cover
`internal/postman` is `AGENTS.md`'s named category — *"a parser/splitter with several interacting
rules"* over a real wire format, where every failure mode is silent (a dropped `event[]` is invisible
until someone opens the export in Postman; a scrambled `sort_order` looks like the user's own
ordering). `repos/collections.go`'s tree/ordering/cascade arithmetic is the second half of the same
category.

**`internal/postman/roundtrip_test.go` — the corpus, and the one assertion that matters.** A
`testdata/` set of hand-written v2.1 files, each isolating one shape, plus one "everything" file:

1. **Nesting and order.** Three levels, siblings in a deliberately non-alphabetical order → parse →
   write → the item arrays come back in the same order, at the same depths.
2. **Every `oneOf` from F2 in one file** — a string `request`, a string `header` block, a string
   `url`, a string `host`, a path-variable segment object, an object `description`, a string
   `script.exec`, a numeric `variable.value`. **Parse must not error**, and the round trip must
   preserve each. This is the file that would fail against the library D1 declined, which is why it
   exists.
3. **Every body mode round-trips untouched, byte-identically**, including `raw` with each of the
   five languages, `raw` with an *unknown* language, `urlencoded` with a disabled row and a
   description, `formdata` with a text row, a file row, a `src: null` row and a `src` **array**
   row, `file` with a `src`, `file` with only `content`, and `graphql`. Asserted as: the exported
   `body` member is `json.RawMessage`-equal to the input's.
4. **An edited body exports canonically, and sheds its origin.** Import each of the above, mutate
   the stored `SavedRequest`, export → the body is the D7 export-table shape, the graphql case
   becomes `raw` + `language:"json"`, and the origin's stale body is gone.
5. **The unchanged-⇒-verbatim rule holds per member.** Edit only the URL → `url` is rebuilt and
   `header`/`body` are still byte-identical to the input's. Edit only a header → the reverse.
6. **Preserved-but-inert survives** (D9): a file with collection-level `auth` + `event[]` +
   `variable[]`, folder-level `auth` + `event[]`, item-level `event[]` + `response[]` +
   `protocolProfileBehavior` → every one of those members is byte-identical after a full
   import→SQLite→export cycle.
7. **The version gate** (D10): a `v2.0.0` schema URL is refused with the version in the message; a
   missing `info.schema` parses.
8. **The malformed cases** (D3): an item with neither `item` nor `request` is skipped and counted;
   an item with both is treated as a folder with its `request` preserved.
9. **`url.go`'s splitter/builder**: a `{{baseUrl}}/users/:id?q=a+b#frag` round-trips through
   `Split`/`Build` unchanged, and its derived `host`/`path` arrays are what Postman writes.

**`repos/collections_test.go`** — four cases, each guarding arithmetic rather than CRUD:

1. **`sort_order` is dense and stable** across an insert into the middle, a delete, and a re-read.
2. **A folder delete cascades to arbitrary depth** in one statement (F9), and does not touch a
   sibling subtree.
3. **`List` never reads `request_json`** — asserted by writing a row with a deliberately invalid
   `request_json` and confirming `List` still returns its summary while `GetRequest` refuses it.
4. **`SaveRequest` sheds exactly the changed members from `origin_json`** and leaves the rest.

**Explicitly not tested:** that `CreateCollection` then `List` returns the collection; that `Rename`
renames; that a required field's absence is refused. Each is `AGENTS.md`'s *"everything else gets
nothing"* — CRUD round-trips and one-condition guards.

### 6.3 The new UI spec — `tests/ui/collections.spec.ts`
`tests/ui` drives the real built bundle in real WebKit with both wire planes mocked. Per
`mockRuntime.ts:353`, a channel with exactly one snapshot answers args-blind, so each test uses one
snapshot per channel. **Four tests:**

1. **The tree renders a real collection and opens a request into the existing tab kind.** Seed
   `IPC.collectionsList` with a two-level tree (one collection, one folder, two requests) and
   `IPC.collectionsGetRequest` with a `POST` request. Switch to Http, assert the rows, their depths
   and their method chips; expand and collapse; double-click a request and assert
   `[data-testid="http-request-view"]` is visible with the **saved name** in the header and the tab
   strip (not the URL), the method select on `POST`, and the body pane showing the saved body.
   Double-click the same row again and assert the tab count is still 1 (D14's reuse).
2. **Editing marks dirty; Save clears it.** From (1), type in the URL field; assert the dirty mark
   appears and `Save` enables; click Save and assert `IPC.collectionsSaveRequest` fired with the
   edited request and **without** any of the four UI-only fields (D15's `toSavedRequest`), and that
   the mark clears.
3. **Search filters the tree and keeps ancestors.** Type a request's name into the panel search;
   assert only its branch survives, its ancestors render, and clearing restores the original
   expansion state exactly (D13's "does not mutate `expanded`").
4. **Import reports what it did.** One `IPC.filesChooseOpen` snapshot returning a path and one
   `IPC.collectionsImport` returning a report with three warning kinds; click *Import collection…*,
   assert the strip lists the counts, and assert `IPC.collectionsList` was re-fetched. The
   load-bearing assertion: **no argument of any call in the log carries file contents** — only the
   path (D11/F16), the same shape P3's own form-data test asserts.

### 6.4 What only a real Mac, and a real Postman, can settle
1. **The native dialogs** — `ChooseOpen` with the `json` filter and `ChooseSave` with the
   `.postman_collection.json` default name, in a real Wails window. `tests/ui` mocks both and the
   `-tags server` build has no dialogs at all (`docs/ARCHITECTURE.md:1329-1331`).
2. **The round trip through the real product.** Export a real Postman collection **out** of Postman,
   import it here, export it back, and **import that file into Postman** — the SPEC row's own bar.
   Check specifically: folder order and nesting; every request's method, URL, headers and body mode;
   that test scripts still appear on the items that had them; that collection auth is still set;
   that saved example responses are still listed.
3. **A collection that actually uses the corners** — path variables, a GraphQL request, a binary
   body, a multi-file form-data field, a disabled query param, a header with a description — through
   the same loop, with a diff of the two files read by eye.
4. **A large collection** (≥ 2,000 requests): import time, tree scroll smoothness, and whether the
   panel's spinner is enough (§8 OQ-5's evidence).
5. **A collection whose `file.src` values are bare filenames** (F5) — the report's count should be
   non-zero, and sending one should fail with `body.go:163`'s legible message, not a crash.
6. **Two windows.** Import in one; the other's tree does not update until it re-lists. That is a
   real property of a per-window renderer with no invalidation event, and §8 OQ-4 records it rather
   than pretending it is fine.

### 6.5 What must not regress
- **Studio renders identically.** `git diff` must touch nothing under `project/**`, `views/grid/**`,
  `views/console/**`, `internal/adapters/**`, `internal/adapterhost/**` or `packages/shared/protocol/**`.
- **`tests/ui/mode-switch.spec.ts` passes unedited.** It asserts `http-start` visible, the panel
  containing `Collections`, and — the trap — boots with no collections fixture (F11).
- **`tests/ui/http-request.spec.ts` and `http-request-body.spec.ts` pass unedited.** Both click
  `[data-testid="new-request-start"]`; both exercise a tab state that gains two `.default()`ed
  fields. An edit to either is a signal C4 changed behaviour.
- **`bun run test:ipc:fe` passes unedited** — no data-plane, adapter or fixture change.
- **No file under `http/**` imports `views/**` or `project/**`, and no file under `views/**`
  imports `workbench/**`** — `bun run lint` is the check (`biome.json:66-149`).
- **The bundle keeps exactly two dynamic chunks** (`docs/ARCHITECTURE.md:28`). Everything added is
  statically imported; D1 declined the only candidate that could have moved the needle.
- **`NOTICES.md`, both `package.json`s and `go.mod` are unchanged** — D1.
- **`docs/PERF.md` gains no budget and needs none.** The one path that could plausibly want one is
  the collections tree's own `visibleRows`, which is a pure computed over an in-memory array behind
  the same virtualizer the tree-expand budget (`docs/PERF.md`, ≤ 50 ms p95) already covers.

---

## 7. Acceptance checklist

Filled in by the implementing session as each item is actually done, not in advance.

- [ ] C1 — `internal/postman` parses every `oneOf` in F2 without erroring; D7's table translates both
      ways; D6's rule is per-member; the round-trip corpus is green.
- [ ] C2 — migration 0006 applies through the real chain; `sort_order` is dense; a folder delete
      cascades at depth; `List` never reads `request_json`.
- [ ] C3 — nine bound methods; bindings regenerated with `$Call.ByName` and the five new models
      confirmed (§6.1); `collectionsList` wildcard added.
- [ ] C4 — `itemId`/`name` default cleanly; `duplicateState` clears both; `httpMethodClass` has one
      definition; both existing http specs pass **unedited**.
- [ ] C5 — the tree mounts `TreeHost` with no tree mechanics of its own; search keeps ancestors and
      does not mutate `expanded`; `mode-switch.spec.ts` passes unedited.
- [ ] C6 — a saved request opens the existing `'http-request'` tab, reuses on re-open, and shows its
      saved name everywhere.
- [ ] C7 — inline rename doubles as the naming step for all three creation paths; delete is
      confirm-gated.
- [ ] C8 — dirty is a computation over two in-memory values; Save writes no UI-only field and sheds
      the stale origin members.
- [ ] C9 — import reports all eight warning kinds correctly against a file that triggers each; no
      file contents cross the bridge.
- [ ] C10 — export writes a file real Postman imports (§6.4 step 2).
- [ ] C11 — the corpus, the four repo cases, `collections.spec.ts`'s four tests and D17's parity
      pair, each passing twice in a row.
- [ ] C12 — `docs/ARCHITECTURE.md` updated (both tables, the origin column, the tree, the resolved
      translation with its two lossiness boundaries).
- [ ] §6.1's full command set green.
- [ ] §6.4's six real-hardware/real-Postman steps — run, or recorded as unrunnable here with what was
      read instead, in the same shape P1's, P2's and P3's own checklists took.

---

## 8. Open questions, handed forward

**OQ-1 — Postman's `graphql` body is still untyped, and P3 §8 OQ-1's three sub-questions are still
open.** F3: the schema says `{"type":"object"}` and nothing more. D7 handles `variables` as either a
string or an object and copies `operationName` when present, which covers every shape anyone has
described — but none of it is confirmed against a real Postman export, which is what P3 already
asked for and which still cannot be done from this sandbox. §6.4 step 3 is where it gets settled.
The blast radius is bounded: an unexpected shape produces a JSON body with a missing or
oddly-encoded `variables` member, and D6 means the original still exports verbatim.

**OQ-2 — Auth, restated with what P4 learned.** P2 §8 OQ-5 asked whether auth is a request concern
or a collection concern. P4's answer is *both, and neither is P4's*: the format puts `auth` at
collection, folder **and** request level with folder-level inheritance, so an Auth tab on the request
alone would not be enough — the phase that builds it needs an inheritance rule and a collection-level
surface to set the default in. It also needs `internal/secrets` for anything with a stored
credential, which is the same machinery P5's secret variables need. **Auth and P5 should be planned
together, or auth should immediately follow P5**, because they share the credential-storage decision
and because a Bearer token is far more often a variable than a literal. D5 means every imported auth
block is already sitting in `origin_json` waiting to be promoted, exactly as D9's variables contract
describes.

**OQ-3 — The method vocabulary is seven and the format's is fifteen-plus-anything** (F4). D7 coerces
the rest to GET at one boundary and reports it. Widening `HTTP_METHODS` is mechanical for the enum
and the `<select>`, but a genuinely *custom* method needs an editable combo box, and
`httpMethodClass`/`METHOD_CLASS`'s four colour families need a default for the other eight. Worth
doing in the phase that next touches the request toolbar — P7's curl parser will want it too, since
`curl -X PROPFIND` is exactly the input that produces one.

**OQ-4 — A second window's collections tree does not update when the first imports.** Every other
cross-window invalidation in this app goes through an `Emitter` broadcast
(`appcore/deps.go:23-27`, e.g. `CHANNEL.connectionsChanged`). P4 adds no event, so a second window
shows a stale tree until it re-lists. That is a real gap and the fix is small and known — a
`collectionsChanged` broadcast emitted by the mutating service methods and subscribed to in
`http/state/collections.ts`, mirroring `state/connections.ts`'s own `onConnectionsChanged` — but it
is a whole new event channel (a `CHANNEL` constant, an `Emitter` call, a `control.ts` subscription, a
`mockRuntime` entry), and multi-window Http is not a workflow anyone has asked for yet. Recorded so
it is a choice.

**OQ-5 — A pathological import blocks one bound call with only a spinner.** D11's reasoning for
staying off the op log holds for every realistic collection; a 50 MB one would sit for a second or
two. F10 means nothing else is blocked and the transaction is atomic either way. If it bites, the
contained fix is `Host.RunOp` with a new `'collection'` op kind (one string in two lists plus D17's
existing parity test) and a `context`-cancellable parse loop — not a background job queue.

**OQ-6 — Re-importing the same collection makes a second one.** `info._postman_id` survives in
`origin_json` (D5), so "this file matches a collection you already have — replace it, or import a
copy?" is a query away. Deliberately not built: a real *update* is a three-way merge (the file's
tree, the stored tree, and whatever the user changed since importing), which is a feature with a
real design and not a corner of a storage phase.

**OQ-7 — A per-mode left-panel width, with the evidence P1 asked for.** P1 §8 OQ-1 deferred it
*"until there is real content to size"*. There now is, and the answer is still not yet: a collections
tree's rows are short (a method chip and a name) and fit the shared width fine, while the change
costs a `layoutSchema` entry, a `LayoutPatch` branch, a Go model field and a broadcast
(`packages/shared/domain/layout.ts`, `state/layout.ts:16-20`). Re-hand it forward to whichever phase
first makes the panel show something wide — P5's variables table is the obvious candidate.

**OQ-8 — The tab strip has no dirty indicator** (D15). Adding one means a `dirty(tab)` member on
`TabKindDef` (`state/tabKinds.ts:60-78`) that seven of the eight kinds would answer `false` to, plus
a `TabStrip.vue` render change. Worth it only if the header's own mark proves insufficient in real
use — and if it is done, it should be done as a *general* tab-dirty concept (P8's history and a
future editable console both want one), not as a special case for one kind.

**OQ-9 — Reordering and moving items** (D18). `sort_order` is ready; `TreeHost` is not. When it
lands it wants: drop-between and drop-into targets, auto-expand-on-hover, a cross-parent dense
reindex in one transaction, and a decision about whether reordering marks a collection changed for
export purposes. It belongs with whichever phase next touches `TreeHost` — and it should be built in
`TreeHost` so Studio's own tree could adopt it, not privately in `http/`.

**OQ-10 — Per-row `description` is now lossy in exactly one direction, and P3 §8 OQ-5 is why.**
Postman carries `description` on query params, headers, urlencoded fields and form-data fields; this
app models it on none. D6 preserves every one of them for an *unedited* member and drops them for an
edited one. The fix is the same one P3 already scoped: a Description column on
`views/httprequest/FieldRowsTable.vue`, added to all four tables at once. P4 makes the case stronger
— the data is now real, imported and visible in the file — but the change still belongs where the
tables live. P2 §8 OQ-1's disabled-query-param question is the same shape on the same surface and
should be settled in the same pass.

---

### Critical files for implementation

- `/home/user/kira-studio/apps/kira-studio/internal/storage/repos/collections.go` *(new — D2/D3/D6's storage half)*
- `/home/user/kira-studio/apps/kira-studio/internal/postman/body.go` *(new — D7's translation, the centre of the phase)*
- `/home/user/kira-studio/packages/shared/domain/http.ts` *(the body-mode vocabulary and the tab state both sides translate to)*
- `/home/user/kira-studio/apps/kira-studio/frontend/src/http/CollectionsPanel.vue` *(the placeholder P4 replaces)*
- `/home/user/kira-studio/apps/kira-studio/frontend/src/state/tabs.ts` *(D14's `openCollectionRequestTab` and the reuse rule)*

---

**Sources for every Postman-format claim above** (fetched and read during planning, per the brief's
instruction to pin them down rather than approximate):

- [Postman Collection Format v2.1.0 JSON Schema](https://schema.postman.com/json/collection/v2.1.0/collection.json) — fetched, 55,081 bytes; the source of every shape quoted in F1–F6 (`item`/`item-group`, `request`, `url`, `header`, `description`, `variable`, `event`, `script`, `auth`, `response`, `info`, and the `body` mode enum with all five payload shapes)
- [Send parameters and body data with API requests | Postman Docs](https://learning.postman.com/docs/use/send-requests/create-requests/parameters/) — the six builder body types, the raw dropdown's *"Text, JavaScript, JSON, HTML, or XML"*, *"Postman doesn't set any header type for the binary body type"*, and Content-Type precedence
- [RequestBody — Postman Collection SDK](https://www.postmanlabs.com/postman-collection/RequestBody.html) — `MODES` (`file`, `formdata`, `graphql`, `raw`, `urlencoded`) and `options` being an untyped Object with no documented internal structure
- `github.com/rbretecher/go-postman-collection@v0.9.0` — read from the module proxy zip (`body.go`, `url.go`, `items.go`, `request.go`, `header.go`, `description.go`, `event.go`, `variable.go`, `LICENSE`); the subject of F7 and D1
</content>
