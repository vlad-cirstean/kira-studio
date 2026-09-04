# P5 — Collection variables and environments

> **What this phase is.** `docs/v1.2/SPEC.md`'s P5 row: **variables scoped to a collection**, and
> **separate named environments** (a switchable set layered on top of the collection's own), both
> **resolved via `{{name}}` substitution wherever a request references one — URL, headers, body**.
> Each entry can be marked a **secret** with a checkbox: masked inline in the list, shown only after
> a system authentication prompt, **reusing v1.1 P14's existing fingerprint/Touch ID mechanism
> rather than rebuilding it**. Both keep a **history of prior values**, and both **reorder**.
>
> **The thing that makes this phase harder than it looks.** Two of its requirements pull in opposite
> directions. *Substitution* wants to live in TypeScript — P6's whole row is `{{$dynamic}}` values
> from `@faker-js/faker`, which is a **root-`package.json` dependency** (`package.json:47`,
> `10.6.0`), so an engine that P6 "extends" (the SPEC's own word) has to be renderer-side.
> *Secrets* want the opposite — v1.1 P14's headline finding was that the pre-P14 bug was not a
> missing confirmation but that **"the plaintext is already in the renderer, in the DOM, before the
> user asks for anything"** (`docs/v1.1/plans/P14-credential-reveal-confirmation.md`, header). A
> P5 that loads secret values into the renderer store so the renderer can substitute them would
> re-create that exact bug and make the mask theatre. **D6 is the resolution: substitution is two
> stages** — the renderer resolves every reference it can see, Go resolves the ones that name a
> secret, at send time, and neither stage ever holds the other's material.
>
> **The finding that makes that not merely tidy but necessary (F9).** `bridge/http.go:59` calls
> `op.SetCommand(fmt.Sprintf("%s %s", args.Method, args.URL))`, and `op_log.command` is a **persisted
> SQLite column** (`repos/ops.go:16-18`) rendered in the Operations panel. A design that resolved
> secrets before that line would write a plaintext credential into `kira.sqlite` and onto the screen,
> every send. D6's ordering — resolve secrets *strictly after* `SetCommand`, never feeding back —
> is what stops it.
>
> **Where environments attach: nowhere. They are top-level (D2).** The SPEC says *"**separate** named
> environments"*; P4 §0.2 already classified `.postman_environment.json` as *"a different top-level
> format"*; and, decisively, a request tab need not belong to a collection at all — `itemId` is
> `z.string().nullable().default(null)` (`packages/shared/domain/http.ts:203`), so a scratch request
> would have **no** variables at all if environments were collection-scoped. `http_environments` has
> no collection foreign key.
>
> **What does not land here.** `{{$dynamic}}` faker values (P6 — D17 reserves the `$` prefix and
> reports it, it does not resolve it), curl parse/generate (P7 — D21 hands it the reveal rule a
> generated command needs), response history (P8), the raw inspector (P9), the timeline (P10), gRPC
> (P11). Also explicitly not here: an auth surface (P4 §8 OQ-2 — and F8 records that there is no auth
> field in the request builder to substitute *into*), `.postman_environment.json` import or export,
> per-variable `enabled` checkboxes, folder-level and item-level `variable[]` promotion, recursive
> variable expansion, variable substitution into a local file path, and drag-reorder in the
> collections **tree** (P4 §8 OQ-9 is untouched — D14 explains why this phase does not close it).
> Nothing here is half-built toward any of them (`AGENTS.md`: *"Scope left out of a phase is left out
> entirely, not half-implemented"*).
>
> **Every claim below was re-read against the tree, not inherited from prose.** Base: branch
> `claude/feature-v1-2` at `4e24249` (*"docs: fill in P4's acceptance checklist"*), i.e. P4's twelve
> commits have landed. File:line citations point at that content.
>
> **The one-sentence design.** A variable is a row in one `http_variables` table owned by either a
> collection or an environment; its plaintext lives in `value` and its secret lives, encrypted with
> the **same `internal/secrets` cipher connection passwords already use**, in a second column the
> list query never selects — and a request is resolved in two passes, one in the renderer over what
> the renderer is allowed to know, one in Go over what it is not.

---

## 0. Scope, non-scope, ground rules

### 0.1 In scope

| File | What changes |
|---|---|
| `apps/kira-studio/internal/storage/migrations/0007_p5_variables.sql` | **new** — `http_environments`, `http_variables`, `http_variable_history`, three indexes, one `ALTER TABLE http_collections` (D4) |
| `apps/kira-studio/internal/storage/migrations/embed.go` | one `names` entry |
| `apps/kira-studio/internal/storage/model/variables.go` | **new** — `Environment`, `Variable`, `VariableHistoryEntry`, `VariableScope`, `Validate` (D5) |
| `apps/kira-studio/internal/storage/repos/variables.go` | **new** — `VariablesRepo`: `ListEnvironments`, `CreateEnvironment`, `RenameEnvironment`, `DeleteEnvironment`, `SetActiveEnvironment`, `ReorderEnvironments`, `List`, `Upsert`, `Delete`, `Reorder`, `History`, `SecretsFor`, `PromoteImported` |
| `apps/kira-studio/internal/storage/repos/variables_test.go` | **new** — §6.2 |
| `apps/kira-studio/internal/storage/repos/repos.go` | one field, one constructor line |
| `apps/kira-studio/internal/httpvars/vars.go` | **new** — the package doc, `Service`, its `Deps` (repo + cipher + the shared `*localauth.Authorizer`) |
| `apps/kira-studio/internal/httpvars/reveal.go` | **new** — `Reveal`/`RevealHistory`, `RevealResult` (D8) |
| `apps/kira-studio/internal/httpvars/resolve.go` | **new** — the Go half of the engine: `Resolve`, `ResolveRequest`, `Names` (D6/D17) |
| `apps/kira-studio/internal/httpvars/resolve_test.go` | **new** — the shared corpus, Go side (§6.2) |
| `apps/kira-studio/internal/httpvars/testdata/substitution.json` | **new** — the cross-language corpus (D18) |
| `apps/kira-studio/internal/appcore/deps.go` | one field: `HttpVars *httpvars.Service` (D19) |
| `apps/kira-studio/internal/bridge/variables.go` | **new** — `VariablesService`, thirteen methods (D19) |
| `apps/kira-studio/internal/bridge/http.go` | `HttpSendArgs` gains `CollectionID`/`EnvironmentID`; `Send` resolves secrets **after** `SetCommand` (D6/F9) |
| `apps/kira-studio/main.go` | `httpvars.New(...)` beside the existing `authorizer`, one `deps.HttpVars` assignment, one `application.NewService(&bridge.VariablesService{Deps: deps})` line |
| `apps/kira-studio/internal/postman/collection.go` | `Tree.Variables`, one new warning kind (D15) |
| `apps/kira-studio/internal/postman/parse.go` | collection-level `variable[]` promoted out of origin; `countInertMembers` no longer counts it at that level (D15) |
| `apps/kira-studio/internal/postman/write.go` | `variable` becomes the exporter's **fourth owned member**, and a secret exports valueless (D15/D16) |
| `apps/kira-studio/internal/postman/roundtrip_test.go` | the collection-level `variable` assertion changes from byte-identical to promoted-round-trip; the `variables_inert` count drops to the folder/item levels (§6.2) |
| `apps/kira-studio/internal/postman/testdata/inert.json` | unchanged — the same file now proves the *new* rule |
| `apps/kira-studio/internal/storage/repos/collections.go` | `ImportTree` inserts promoted variables and stamps `variables_promoted`; `LoadTree` fills `Tree.Variables` |
| `packages/shared/domain/variables.ts` | **new** — the mirrors, the scope union, the reveal-outcome union (D20) |
| `packages/shared/domain/http.ts` | `HttpRequestWire` gains `collectionId`/`environmentId` (D6) |
| `apps/kira-studio/frontend/src/bridge/control.ts` | thirteen wrappers; `httpSend` gains the two scope ids |
| `apps/kira-studio/frontend/src/http/substitute.ts` | **new** — the engine (pure, DOM-free, Vue-free) (D17) |
| `apps/kira-studio/frontend/src/http/state/variables.ts` | **new** — the store, the active environment, the reveal map, both dialogs' state |
| `apps/kira-studio/frontend/src/http/VariablesDialog.vue` | **new** — one scope's variable list (D11) |
| `apps/kira-studio/frontend/src/http/VariableRow.vue` | **new** — one row: name, value, secret checkbox, mask+eye, history, grip (D11/D12) |
| `apps/kira-studio/frontend/src/http/VariableHistoryMenu.vue` | **new** — the per-row history popover (D13) |
| `apps/kira-studio/frontend/src/http/EnvironmentsDialog.vue` | **new** — the environment list: create/rename/delete/reorder/edit (D11) |
| `apps/kira-studio/frontend/src/http/EnvironmentSelect.vue` | **new** — the switcher (D11) |
| `apps/kira-studio/frontend/src/http/menus.ts` | one collection-row item (*Variables…*), one background item (*Environments…*) |
| `apps/kira-studio/frontend/src/http/CollectionsPanel.vue` | one `#actions` `IconButton` opening the environments dialog |
| `apps/kira-studio/frontend/src/views/httprequest/HttpRequestView.vue` | `EnvironmentSelect` in `#toolbar-2`; the unresolved-reference chip (D16) |
| `apps/kira-studio/frontend/src/views/httprequest/state.ts` | `send()` resolves before it builds the wire args (D6/D7) |
| `apps/kira-studio/frontend/src/shortcuts/state.ts` | two palette entries |
| `apps/kira-studio/frontend/src/App.vue` | mounts both new dialogs beside the other overlays |
| `apps/kira-studio/tests/ui/support/ipcChannels.ts` | thirteen channel names |
| `apps/kira-studio/tests/ui/support/mockRuntime.ts` | thirteen FQNs, two `WILDCARD_DEFAULTS` entries |
| `apps/kira-studio/tests/ui/http-variables.spec.ts` | **new** — §6.3 |
| `apps/kira-studio/tests/unit/http-substitution.spec.ts` | **new** — the corpus, TS side (§6.2) |
| `docs/ARCHITECTURE.md` | the storage schema block, a Storage paragraph, a secrets paragraph, a UI-architecture paragraph |

### 0.2 Out of scope, explicitly

- **P6's `{{$...}}` dynamic values.** D17 gives the `$` prefix its own classification in the
  resolver's report so P5 never mislabels one as a typo, and P6 slots a generator in behind an
  existing seam. P5 resolves none of them and ships no faker call.
- **P7's curl generation.** D21 states the rule P7 inherits — a generated command that substitutes a
  secret *is* a reveal and must go through the same gate — but generates nothing here.
- **An auth surface, and applying an imported `auth` block.** P4 §8 OQ-2 asked for auth and P5 to be
  planned together because they share the credential-storage decision. **That decision is made here**
  (D4/D8: `internal/secrets`'s cipher, a `secret_value` column the list never selects, the shared
  `localauth.Authorizer`), and auth can now be built on it — but no auth field, tab or signer lands
  in this phase. F8 records that the request builder has no auth field to substitute into.
- **`.postman_environment.json`, in either direction.** A different top-level format from the
  collection schema, and nothing in the SPEC's P5 row asks for file interchange of environments.
  §8 OQ-6.
- **A per-variable `enabled` checkbox.** Postman has one; the SPEC's P5 row lists name, value, the
  secret checkbox, history and reordering, and not this. Adding a column nothing writes is the
  half-implementation `AGENTS.md` forbids. §8 OQ-5.
- **Folder-level, item-level and `url.variable` promotion.** Only collection-level `variable[]` is
  promoted (D15); the other three levels stay inert in `origin_json` exactly as P4 left them, and
  keep being counted `variables_inert`.
- **Recursive expansion.** One pass (D17). A value that itself contains `{{other}}` is not
  re-expanded. §8 OQ-3.
- **Substituting into a local file path** (`binaryFile.path`, a form-data file row's `path`). D7
  states why.
- **Drag-reorder in the collections tree.** P4 §8 OQ-9 stays open and untouched: D14's reorder is a
  flat list inside a dialog and adds nothing to `TreeHost.vue`.
- **A per-mode left-panel width.** P4 §8 OQ-7 re-handed it forward naming *"P5's variables table"* as
  the likely trigger. D11 puts the table in a dialog, not the panel, so the trigger did not fire;
  the question is re-handed unchanged (§8 OQ-8).
- **Any menu or accelerator change.** P1 §8 OQ-3 / P2 §8 OQ-7 stay open; D11 uses context-menu items,
  a header button and two palette entries — the bar P2 D13 and P4 D15 both set.
- **Any new tab kind and any new op kind.** §3 establishes why neither is needed.
- **Any new dependency**, Go or TypeScript (§4 D1).

### 0.3 Ground rules

- **A secret's plaintext never reaches the renderer except through the gated reveal, and never
  reaches a log or a persisted column at all.** This is the phase's own invariant, and it is
  checkable: §6.3's UI spec asserts it against the real bundle, and §6.2's repo test asserts the
  list projection.
- **`http/**` may not import `views/**` or `project/**`** (`biome.json:126-149`, P1 D7). `views/**`
  may import `http/**` — `HttpRequestView.vue:5` already imports `http/state/collections`, which is
  what lets D11 put the switcher component under `http/` and mount it from the request view.
- **New test files, per module, not appended to a mixed one.** P4 D17 extended
  `tests/unit/go-ts-vocabulary-parity.spec.ts` — a file that covers Studio's tab/op vocabularies and
  Http's body vocabulary together — and flagged untangling it as P12's. P5 adds **no case to that
  file**: its own parity guard is its own file (§6.2), so this phase adds none of that debt.
- **Reuse before invention.** D8 enumerates, method by method, what v1.1 P14 already built that this
  phase calls unchanged, and what genuinely has no existing home.
- **Where a Postman-format claim cannot be verified from a first-party source here, it says so**
  (§8 OQ-1) rather than being asserted.

---

## 1. What the code does today

### 1.1 There is no substitution anywhere, and P4 already wrote around the syntax

Verified, not assumed. `git grep` for `substitut|interpolat|resolveVariable` over `apps/` and
`packages/` returns only unrelated prose. The only code in the tree that knows `{{` exists at all is
`internal/postman/url.go`, which handles it **as an opaque token it must not damage**:

```go
// url.go:75-77
// containsVariable reports whether s carries a {{name}} reference — P5's own syntax, which must
// survive the split/build round trip untouched.
func containsVariable(s string) bool { return strings.Contains(s, "{{") }
```

`hostSegments` (`:130`) refuses to split a host on `.` when it carries one, `Split` (`:100`) refuses
to read a `:` inside one as a port, and `roundtrip_test.go:635` asserts `"host": ["{{baseUrl}}"]` is
one segment and not three. So P4 left the syntax intact on the storage side and built none of it.

### 1.2 The send path is one function, and every substitutable field passes through it

`views/httprequest/state.ts`'s `send(tabId)` (`:80-120`) is the single choke point. It reads
`findHttpRequestTab(tabId)`, filters the headers (`enabled && name.trim() !== ''`), calls
`buildBodyWire(tab.state)` (`:11-53`, the five-mode switch), and posts
`{opId, tabId, method, url, headers, body}` through `control.httpSend`. Nothing else in the renderer
composes an outbound request.

`buildBodyWire` is where every body-mode text lives: `raw` → `state.body`, `code` → `state.code`,
`urlencoded` → each enabled row's `{name, value}`, `formdata` → each enabled row's
`{name, kind, value, path, contentType}`, `file` → `state.binaryFile?.path ?? ''`.

### 1.3 The URL is authoritative, so query params need no separate treatment

`packages/shared/domain/http.ts:179` and its own comment: *"There is deliberately no `params` array:
the URL is the single source of truth for the query string (D9), and the Params table is a derived
editor over it."* `views/httprequest/url.ts`'s `splitUrl`/`parseQuery`/`buildQuery` are the pure
splitter; `QueryParamsTable` writes back through `state.url`. So resolving `state.url` resolves the
query string, with no second surface to remember.

### 1.4 v1.1 P14 built the reveal gate as a real, reusable Go package — and a non-reusable renderer function

**Go — genuinely reusable, unchanged.** `internal/localauth` is a self-contained gate.
`Authorizer.Authorize(reason string, confirmed bool) (Outcome, error)` (`localauth.go:104-130`)
implements P14 D6's whole decision table: a live grace grants immediately; when `available()` is
false a renderer `confirmed: true` grants *this one reveal and records no grace*, and `false` returns
`Unavailable`; otherwise it calls the platform `evaluate` and, on `Granted`, arms a **fixed,
non-sliding** `GraceWindow = 5 * time.Minute` (`:60-64`). It is `sync.Mutex`-guarded because *"Wails
bound-service calls each run on their own goroutine"* (`:71-75`). `main.go:78-80` constructs exactly
one, beside the cipher, with a comment saying so.

`connections.Service.Reveal(id string, confirmed bool) RevealResult`
(`internal/connections/service.go:387-410`) is the one caller, and it is **not** reusable: it is
`s.deps.Secrets.Get(id)` against `repos.SecretsRepo`, which is hardcoded to
`SELECT password FROM connections WHERE id = ?` (`repos/secrets.go:32-45`). Its four-outcome
vocabulary (`revealed | cancelled | confirmation-required | error`, `service.go:72-77`) is the shape
worth copying; its body is not.

**Renderer — not reusable, and there is nothing to import.** `requestReveal(id, confirmed)` is a
**local `async function` inside `project/ConnectionDialog.vue`** (`:227-248`), not exported, not a
composable. It switches on the four outcomes, recurses **exactly once** for the
confirmation-required → `confirmDialog()` → re-ask-with-`confirmed: true` path, and writes the
result into the dialog's own `draft.password`. `state/confirmDialog.ts`'s `confirmDialog(message,
{danger})` is the shared piece it leans on, and that *is* importable.

The eye button is `onEyeClick` (`:261-267`): un-revealed, it *is* the reveal action; once revealed,
it is a free client-side mask toggle — *"no second round trip, no second prompt"*.

### 1.5 The cipher is credential-agnostic; the secrets **repo** is not

`secrets.Cipher` (`internal/secrets/cipher.go:30-115`) is `Encrypt(plain string) (string, error)` /
`Decrypt(stored string) (string, error)` over AES-256-GCM under a key held in the macOS Keychain,
with a `kira:v2:` envelope prefix. It takes no connection id, no table, no column — it is a pure
string cipher. `New()` never fails: an unavailable backend is a valid `Cipher` whose Encrypt/Decrypt
refuse with `E_SECRET_STORE` naming the reason (`:74-80`, `:87-93`). Linux development uses
`KIRA_INSECURE_SECRETS=1` and a hardcoded key, logged as a `slog.Warn` at startup and honestly
described as *"obfuscation under a key anyone can read, not encryption"* (`:24-27`).

`repos.SecretsRepo` (`repos/secrets.go`) is the opposite — every method is a statement against
`connections.password`. It is not a store; it is that column's accessor.

### 1.6 How P4 left collections, and the contract it wrote for this phase

`http_collections(id, name, sort_order, origin_json, created_at, updated_at)` and
`http_items(id, collection_id, parent_id, kind, name, sort_order, method, url, request_json,
origin_json, created_at, updated_at)` (`migrations/0006_p4_collections.sql`), with
`http_items_tree` on `(collection_id, parent_id, sort_order)`. `sort_order` is dense and rewritten
wholesale within a parent (`repos/collections.go:429`'s `reindexSiblings`). `parent_id` self-cascades
for real, because `db.go`'s DSN sets `_foreign_keys=1` on every pooled connection.

`internal/postman` keeps **the original Postman object verbatim** per row, minus its `item` array
(`collection.go:6-11`), and `write.go` rewrites exactly three members — `url`, `header`, `body` —
under one rule, plus `method` unconditionally.

P4 D9's hand-off, quoted:

> **The contract P5 must honour**, stated here because P5 will otherwise export them twice: when P5
> promotes `variable[]` out of `origin_json` into its own table, it must **remove that member from
> `origin_json` in the same migration**, and take over emitting it in `internal/postman/write.go`.
> D6's rule already has the right shape for it — `variable` simply joins `url`/`header`/`body` as a
> member the exporter owns.

D15 honours both halves, and F5 is why the *migration* cannot literally do the removal.

### 1.7 The two list-editing precedents this phase copies rather than invents

- **A bounded value history**: `repos/filter_history.go`. `historyLimit = 20` (`:14`); `Record`
  dedupes by deleting an identical prior row before inserting (so re-recording moves an entry to the
  top rather than duplicating it, `:44-51`), then trims with a `DELETE … WHERE id NOT IN (SELECT id
  … ORDER BY used_at DESC, rowid DESC LIMIT ?)` (`:62-70`) — all inside one transaction.
- **A drag-reordered flat list**: `views/grid/ColumnsMenu.vue`. A `draggable="true"` row with a
  `<CodiconIcon name="gripper" :size="13" />` handle (`:126-134`), and
  `onDragStart`/`onDragOver`/`onDragEnd` (`:66-81`) doing an index splice into a local `order` array,
  committed once on close. `TabStrip.vue`'s own reorder (`:128`) is bespoke to the strip and is not
  the shape to copy.

Server-side, `ConnectionsService.Reorder(ids []string)` (`bridge/connections.go:57-59`) is the
existing "here is the new order, in full" call shape.

### 1.8 The request view's chrome already has the row a switcher belongs in

`ViewChrome.vue:93-95` renders a second toolbar row whenever a `toolbar-2` slot is supplied;
`HttpRequestView.vue:192-199` supplies it today with one `SegmentedControl`. `primitives.css` has
`.p-select`/`.p-select.bordered` (`:264-310`), `.p-chip` with four variants (`:426-453`),
`.p-push` (`:22`) and `.p-iconbtn` (`:35`). Nothing new is needed to draw any of D11's surfaces.

---

## 2. Findings

### F1 — There is no auth field to substitute into, so the brief's fourth question answers itself
`httpRequestTabStateShape` (`packages/shared/domain/http.ts:184-215`) is, in full: `method`, `url`,
`headers`, `bodyMode`, `body`, `code`, `codeLanguage`, `urlEncoded`, `formData`, `binaryFile`,
`itemId`, `name`, `requestPane`, `responsePane`, `responseView`, `requestPaneHeight`. There is no
auth member at any level, `httpclient.Request` has none either (`bridge/http.go:26-32`), and P4 D9
records that an imported `auth` block is *"preserved verbatim, never applied"*. So D7's field list is
complete as written — auth adds nothing to it, and will inherit substitution for free when the phase
that builds it lands (because it will be composed in the same `send()`).

### F2 — The seven-member method enum makes `{{method}}` unrepresentable
`HTTP_METHODS` (`http.ts:8`) is a closed seven-value Zod enum feeding a `<select>`
(`HttpRequestView.vue:155-162`). A user cannot type `{{verb}}` into a `<select>`, and
`httpRequestTabStateSchema.parse` would reject the whole state for a value outside the enum (P4 F4
established this from the other side). So `method` is not a substitutable field — not by policy, by
construction.

### F3 — `op_log.command` is persisted, and today it is built from the URL
`repos/ops.go:16-18`:

```
opsInsertSQL = `INSERT INTO op_log (id, connection_id, tab_id, started_at, duration_ms, kind, status, rows, command, error) …`
opsUpdateSQL = `UPDATE op_log SET status = ?, duration_ms = ?, rows = ?, command = ?, error = ? WHERE id = ?`
```

`bridge/http.go:59` and `:66` both call `op.SetCommand` with `args.Method` and `args.URL` — the
second one after the response, adding the status. `docs/ARCHITECTURE.md`'s schema block lists
`op_log(… command, error)` as a real, rotated-but-persisted table, and `OperationsPanel.vue` renders
it. **A `{{token}}` in a URL is exactly the kind of thing a user puts a credential in** (`?
api_key={{key}}`), so any design that resolves secrets before `SetCommand` writes a plaintext
credential into `kira.sqlite`. This is the single most load-bearing finding in the phase and it
decides D6's ordering.

### F4 — `secrets.Cipher` is reusable verbatim; `repos.SecretsRepo` is not
F(§1.5). `Encrypt`/`Decrypt` take and return plain strings, so a second consumer needs no change to
`internal/secrets` at all. The repo is a column accessor and cannot be reused; P5's own repo does its
own `cipher.Encrypt` on write and `cipher.Decrypt` on read, exactly as `SecretsRepo` does for its
column. That is one interface (`repos.Cipher`, `repos/secrets.go:11-14`) satisfied twice, not a
second cipher.

### F5 — A SQL migration cannot do P4 D9's "remove the member in the same migration"
P4 D9 asks for `variable` to be removed from `origin_json` *in the migration*. `origin_json` is a
JSON text column; removing one member of it needs either SQLite's JSON1 functions (whose presence in
this build's `mattn/go-sqlite3` compilation is not something this plan can verify from here) or Go.
`migrations/embed.go` embeds `*.sql` files only — `migrate.go` runs SQL text, and there is no
Go-migration seam at all.

D15 therefore honours the *contract* (no member is ever emitted twice) by a different mechanism than
the letter (one column, `variables_promoted`, plus a one-shot Go promotion on first read). The
property P4 wanted — **the exporter is the single writer of `variable`** — holds either way, and it
is the property that matters.

### F6 — P4's own round-trip test asserts the behaviour this phase changes
`internal/postman/roundtrip_test.go:455` asserts collection-level `variable` is
`reflect.DeepEqual`-identical after a full import→SQLite→export cycle, and `:493-495` asserts
`WarnVariablesInert == 3` for `testdata/inert.json`. `countInertMembers` (`parse.go:141-152`) is
called at three levels — the document (`:60`), each folder (`:120`) and each item (`:132`) — so that
count spans all three. Promoting the collection level changes both assertions. The test is in this
phase's in-scope list for that reason, and §6.2 states exactly what it becomes.

### F7 — `appcore.Deps` deliberately excludes the cipher, and says so
`appcore/deps.go:29-33`: *"P52's deps.ts row also lists Secrets and Log; neither is added here: the
cipher reaches the bridge through `Connections.SecretsStatus()` exactly as `ipc/connections.ts:44`
does today."* Deps carries **services** — `Connections *connections.Service`, `Tree *tree.Service`,
`Router`, `Repos`, `Events` — not their ingredients. D19 follows that shape rather than breaking it:
one new `HttpVars *httpvars.Service` field, with the cipher and the authorizer injected into that
service in `main.go` where both already exist.

### F8 — `views/**` may import `http/**`, and already does
`biome.json:125-149` restricts `http/**` from importing `project/**` and `views/**`. The reverse is
unrestricted, and `HttpRequestView.vue:5` already imports
`../../http/state/collections` for the Save affordance. That single fact is what lets D11 put every
new component under `http/` — the module-boundary-correct home — while still mounting the
environment switcher inside the request view's own toolbar.

### F9 — `tests/ui` 422s on an unmocked channel, and the panel/view both fetch on mount
`mockRuntime.ts:353-368`: with no snapshot and no wildcard, a bound call is fulfilled with a 422
`E_FIXTURE_MISS`. P4 added `[IPC.collectionsList]: JSON.stringify({collections: [], items: []})` to
`WILDCARD_DEFAULTS` (`:180`) precisely because `mode-switch.spec.ts` boots with no collections
fixture. P5's environment list is fetched on the same mount path, and `http-request.spec.ts` /
`http-request-body.spec.ts` both open a request tab with no variables fixture at all — so
`variablesListEnvironments` and `variablesList` each need a `'[]'`-shaped wildcard or three existing
specs break.

### F10 — *Verified safe*: no new tab kind, no new op kind
The variables editor is a dialog (D11), and the send op is the existing `"http"` kind
(`bridge/http.go:54`). So `tabKindSchema`, `RENDERABLE_TAB_KINDS`, `TAB_KIND_MODE`, `tabRecordSchema`,
`model.RenderableTabKinds` and `model.opKinds` are all byte-identical after this phase, and
`tests/unit/go-ts-vocabulary-parity.spec.ts` needs no edit — which is also what keeps §0.3's
"no new debt in the mixed spec file" rule free rather than costly.

### F11 — *Verified safe*: a long bound call cannot block the control plane
P2 §2 F12, restated by P4 F10 and unchanged: Wails' `transport_http.go` handles each bound call as
its own HTTP request in its own goroutine. So a `Reveal` that sits waiting on a Touch ID prompt
blocks that call and nothing else — which is what makes D8's synchronous, backend-authoritative gate
safe to copy from P14 verbatim.

### F12 — The renderer already knows which entries are secrets without knowing their values
D4's list projection returns `{id, scope, ownerId, name, value, isSecret, sortOrder}` with `value`
empty whenever `isSecret` is true. That is enough for the renderer's stage of D6 to tell three cases
apart — *resolved*, *deferred to Go because it names a secret*, and *genuinely unknown* — without a
single plaintext crossing the bridge. Without that distinction the renderer would have to report
every secret reference as unresolved, and D16's warning chip would be permanently wrong.

### F13 — `ImportTree` writes the collection row and every item in one transaction
`repos/collections.go:463-527`. So promoting `variable[]` into rows at import time is three more
statements inside a transaction that already exists — not a second pass, not a second commit, and
atomic with the collection it belongs to.

---

## 3. Checked, and not fired

- **No `internal/localauth` change of any kind.** D8: `Authorizer` is called, not extended. Its
  decision table, its grace window and both platform shims are byte-identical after this phase.
- **No `internal/secrets` change.** F4: `Cipher.Encrypt`/`Decrypt` are string-in/string-out.
- **No `internal/connections` change, and no import of it from Http-scoped Go.** D8 declines sharing
  `connections.RevealResult` — a three-field struct — because importing Studio's connections package
  from `internal/httpvars` is precisely the coupling P12 exists to remove.
- **No `repos.SecretsRepo` change** and no second `connections.password` reader. F4.
- **No `internal/httpclient` change.** P2 C2's own commit title is *"a net/http client that sends
  exactly what it was given"*; D6 resolves in `bridge/http.go` and hands `httpclient.Send` an already
  final request.
- **No `TreeHost.vue`, `LeftPanel.vue`, `TitleBar.vue` or `WorkbenchShell.vue` change.** D11's
  surfaces are two dialogs, one `<select>` in an existing `toolbar-2` slot, and one `IconButton` in
  an existing `#actions` slot.
- **No new `theme/primitives/` component.** `DialogFrame`, `TextField`, `AppButton`, `IconButton`,
  `MessageStrip`, `PopoverPanel` and `EmptyState` cover every surface; `.p-select`, `.p-chip`,
  `.p-row` and `.p-push` cover every style (§1.8).
- **No new tab kind, no new op kind, no fourth-vocabulary edit.** F10.
- **No `tabs` table, `model/tabs.go` or `TabsRepo` change.** The active environment is app-global
  (D2), not per-tab, so no tab state field is added and no restore path changes.
- **No `layoutSchema`/`ui_layout` change.** D3 explains why the active environment is a column on
  `http_environments` rather than a layout leaf, and §8 OQ-8 re-hands P4 OQ-7 unchanged.
- **No `settings` change.** The gate has no toggle and the grace has no setting — P14 §0.3's own
  policy, unchanged (its OQ-3 is still open, and still not P5's).
- **No new shortcut id.** Two palette entries (`{id:'http.variables'}`, `{id:'http.environments'}`);
  `registerCommand`'s id is a plain `string` (`shortcuts/commands.ts:7`), so
  `packages/shared/domain/shortcuts.ts`'s closed map is untouched — P4 D15's bar.
- **No `menutemplate.go` change, no accelerator.** §0.2.
- **No case added to `tests/unit/go-ts-vocabulary-parity.spec.ts`.** §0.3, and D18 gives this phase's
  own guard its own file.
- **No new dependency.** §4 D1.

---

## 4. Decisions

### D1 — No new library, and here is the check rather than the assertion
`AGENTS.md` requires reaching for a maintained library first and **naming the requirement** when
declining one. Three candidates were real enough to weigh.

- **A template engine for the substitution** — `handlebars`, `mustache`, or Go's `text/template`.
  Declined on three requirements, not on size:
  1. **Escaping.** Handlebars and Mustache HTML-escape `{{x}}` by default (`{{{x}}}` is the raw
     form). A JSON or XML body carrying `&`, `<` or `"` in a substituted value would be silently
     corrupted on the wire. This app already fights that battle once — `internal/postman` and
     `internal/ipcfixture` both set `SetEscapeHTML(false)` for the same reason (`write.go:22-25`).
  2. **Reporting, not throwing.** D16 needs the resolver to *classify* every reference it found —
     resolved, deferred-to-Go, dynamic, unknown — and hand the list back. A template engine's
     contract is "render or fail"; extracting a per-reference report means walking its AST or
     pre-scanning anyway, which is the whole engine.
  3. **Grammar.** Postman's variable names are not identifiers (`{{base url}}`, `{{x-api-key}}`
     appear in real collections), and every one of these engines treats the inside of `{{ }}` as a
     path expression with its own dotted/segment semantics. Matching Postman means *not* having a
     path grammar.
  What the engine actually is: find `{{`, find the next `}}`, trim, look up, else pass through
  literally. D17 is that, in about forty lines per side, with no expression language to get wrong.
- **A JS crypto/secret-storage library** for the secret values. Declined on placement before merit:
  F4 shows the app already has exactly the right cipher, in Go, behind the OS keychain, and the
  renderer must never hold the material at all (D5/D6). There is nothing for a renderer-side library
  to do.
- **A drag-and-drop library** (`sortablejs`, `vuedraggable`) for D14's reorder. Declined against a
  named requirement: `SlickGridHost.vue:1832-1835` records that this repo deliberately keeps
  Sortable.js out of the bundle (`enableColumnReorder: false`) and reorders columns through
  `ColumnsMenu.vue`'s own fifteen lines of HTML5 drag events instead. A variables list is the same
  shape as that column list — a short, single-level, non-virtualized list in a popover/dialog — so
  adopting a library here would contradict a decision this repo already made, for a list that is
  smaller.

### D2 — Environments are top-level; collection variables are collection-scoped
The brief asks this to be settled from evidence rather than assumed. Four pieces of evidence, all
pointing the same way:

1. **The SPEC's own wording**: *"Variables scoped to a collection, and **separate** named
   environments (a switchable set of variables **layered on top of** collection variables)"*. A set
   that layers on top of *a* collection's variables and is *separate* from them is not owned by one.
2. **A request need not have a collection.** `itemId` is `.nullable().default(null)`
   (`http.ts:203`), and `openHttpRequestTab` creates tabs with `connectionId: null` and no collection
   at all (`state/tabs.ts:392-396`). If environments were collection-scoped, a scratch request — the
   most common thing anyone does in this mode — would have no variables whatsoever, which makes the
   feature useless exactly where it is most useful.
3. **P4 already classified the file format that way.** §0.2 of P4 declined
   `*.postman_environment.json` as *"A different top-level format, and environments are P5's row"* —
   a top-level format for a top-level object.
4. **Switchability.** *"Switchable"* only has meaning across a boundary: switching between Staging
   and Production while working in three different collections is the workflow. A collection-scoped
   environment would need re-creating per collection.

So: `http_variables` rows are owned by **either** a collection (`collection_id` non-null) **or** an
environment (`environment_id` non-null), and `http_environments` has **no** collection foreign key.

**Precedence, stated once:** for a given request, a reference resolves against **the active
environment first, then the request's own collection's variables, then nothing**. A request with no
`itemId` (a scratch tab) has no collection layer at all — only the environment's. That is the
"layered on top" of the SPEC row, read literally, and it matches Postman's own ordering.

### D3 — The active environment is app-global, and lives on its own row
One environment is active at a time, app-wide, stored as `http_environments.is_active`.

- **Why not a `ui_layout` leaf.** `ui_layout` is a typed per-leaf model
  (`repos/layout.go:44-49`'s `leaf(stored, "panel.project.width", …)` list, mirrored in
  `model.Layout` and `packages/shared/domain/layout.ts`); a new leaf costs a Zod field, a
  `LayoutPatch` branch, a Go struct field, a `leaf(...)` line and a broadcast — the exact five-part
  cost P4 §8 OQ-7 declined for the panel width. A foreign key to a row in another table is also not
  what that table is for: every existing leaf is a number or a boolean.
- **Why not a `settings` key.** `settings` is preferences — fonts, budgets, toggles
  (`model/settings.go`). Which environment is selected is session state, not a preference.
- **Why not per-window.** Per-window would mean the `windows` table and a per-window broadcast, for a
  selection Postman itself keeps at workspace level. §8 OQ-4 records the residue honestly: a second
  window's switcher shows the stale selection until it re-lists — the *same* residue P4 §8 OQ-4
  already recorded for the collections tree, with the same known fix (a `Emitter` broadcast) and the
  same reason for not building it yet.
- **The invariant** (at most one active row) is enforced in the repo, in one transaction:
  `UPDATE http_environments SET is_active = 0` then `UPDATE … SET is_active = 1 WHERE id = ?`.
  Selecting "No environment" is the first statement alone. Deleting the active environment leaves
  none active, which is a valid state.

### D4 — The exact SQLite schema
`migrations/0007_p5_variables.sql`, with `embed.go`'s `names` gaining
`{7, "p5_variables", "0007_p5_variables.sql"}`:

```sql
-- P5 D2/D4: variables are rows in this app's own database, owned by either a collection or an
-- environment — never both, never neither. Environments are top-level (docs/v1.2/SPEC.md's P5 row
-- calls them "separate", and a scratch request tab belongs to no collection at all), so they carry
-- no collection foreign key.
CREATE TABLE http_environments (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  -- D3: the app-global selection. The repo keeps at most one row set, in one transaction.
  is_active  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE http_variables (
  id             TEXT PRIMARY KEY,
  -- Exactly one owner. Both cascade for real: db.go's DSN sets _foreign_keys=1 on every connection
  -- the pool opens (P4 F9), so deleting a collection or an environment deletes its variables.
  collection_id  TEXT REFERENCES http_collections(id) ON DELETE CASCADE,
  environment_id TEXT REFERENCES http_environments(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  -- D5: a non-secret's plaintext. '' whenever is_secret = 1 — a plaintext value and a secret value
  -- never share a column, so the list projection below can be trusted by construction rather than
  -- by a per-row branch in Go.
  value          TEXT NOT NULL DEFAULT '',
  is_secret      INTEGER NOT NULL DEFAULT 0,
  -- D5: the internal/secrets kira:v2: AES-256-GCM envelope, the same one connections.password
  -- carries. NULL whenever is_secret = 0. NO query that feeds the renderer's list ever selects it.
  secret_value   TEXT,
  sort_order     INTEGER NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  CHECK ((collection_id IS NULL) <> (environment_id IS NULL)),
  CHECK (is_secret IN (0, 1)),
  CHECK ((is_secret = 0 AND secret_value IS NULL) OR (is_secret = 1 AND value = ''))
);

-- D13: the history of prior values, per entry, in both scopes. An environment's "history" is its
-- entries' histories — there is no second notion of one.
CREATE TABLE http_variable_history (
  id           TEXT PRIMARY KEY,
  variable_id  TEXT NOT NULL REFERENCES http_variables(id) ON DELETE CASCADE,
  value        TEXT NOT NULL DEFAULT '',
  is_secret    INTEGER NOT NULL DEFAULT 0,
  secret_value TEXT,
  recorded_at  TEXT NOT NULL
);

CREATE INDEX http_variables_collection  ON http_variables(collection_id, sort_order);
CREATE INDEX http_variables_environment ON http_variables(environment_id, sort_order);
CREATE INDEX http_variable_history_var  ON http_variable_history(variable_id, recorded_at);

-- D15/F5: 0 means "this collection's origin_json may still carry an unpromoted top-level
-- variable[]" — true for every row that existed before this migration. Every row P5's importer
-- writes stamps 1. VariablesRepo.PromoteImported is the one-shot that flips it.
ALTER TABLE http_collections ADD COLUMN variables_promoted INTEGER NOT NULL DEFAULT 0;
```

Six choices, each with its reason:

- **One `http_variables` table for both scopes, not two.** A collection variable and an environment
  variable have the same six fields, the same secret handling, the same history table, the same
  dense-`sort_order` arithmetic and the same UI component. Two tables would be `repos/variables.go`
  written twice with a name changed. P4 D2 split `http_collections` from `http_items` for the
  opposite reason — a collection is *the unit of export* and carries an `info` block no item has;
  here there is no such asymmetry.
- **A `CHECK` for exactly-one-owner rather than a `scope` discriminator column.** The two nullable
  foreign keys are what actually give `ON DELETE CASCADE`; a `scope` string beside them would be a
  third source of the same fact, derivable from which key is null. `model.Variable.Scope` is computed
  on scan, not stored.
- **`value` and `secret_value` are separate columns.** The whole security property of this phase is
  *"the list never returns a secret"*, and separate columns make that a property of the **SQL
  projection** (`SELECT id, collection_id, environment_id, name, value, is_secret, sort_order …`)
  rather than of a Go branch someone can later forget. It is the same discipline P4 D2 applied to
  `request_json`/`origin_json` — *"`List` never selects them"* — applied where it matters more.
- **Dense `sort_order` per owner, rewritten wholesale on any insert, delete or reorder** — exactly
  `TabsRepo.Save`'s and `reindexSiblings`'s discipline (P4 D2). A variables list is a handful to a
  few dozen rows, always rewritten inside one transaction; sparse keys buy nothing.
- **History is its own table, not a JSON column on the row.** It needs its own `ON DELETE CASCADE`,
  its own `ORDER BY … LIMIT` trim (D13), and its own secret column; a JSON array would need
  read-modify-write on every change and would put ciphertext inside a column the list projection
  might one day select.
- **`ALTER TABLE ADD COLUMN` rather than a rebuild.** SQLite supports it directly with a NOT NULL
  DEFAULT, no table rewrite, and `http_collections` has no dependent view or trigger.

`repos.Repos` gains `Variables *VariablesRepo` and one line in `New` (`repos/repos.go:51-64`). **No
prepared statement**: the list queries run on dialog open and on send, not per keystroke.

### D5 — A secret's plaintext never enters the renderer except through the gated reveal
This is the decision the phase's security posture turns on, and it is taken *because* of v1.1 P14
rather than merely alongside it.

P14's header states the bug it fixed: `openEditDialog` called `connectionsReveal(id)` on **every**
Edit click and wrote the plaintext into the draft the eye button merely un-masked, so *"gating the
eye toggle alone would be theatre: the secret would still be one devtools inspection … away"*. A P5
that shipped `List` returning secret values, with the mask done in CSS, would be **the identical
bug**, in a new table, three chapters later.

So, concretely:

- `VariablesService.List` returns `value: ''` and `isSecret: true` for a secret entry. The ciphertext
  does not cross the bridge either — there is nothing the renderer can do with it, and shipping it
  would be a gratuitous copy of key-derived material into a process that never needs it.
- `VariablesService.Reveal({variableId, confirmed})` is the only way a plaintext reaches the
  renderer, and it is gated (D8).
- A revealed value lives in a **non-reactive-persisted** `revealed: Record<string, string>` on the
  variables store, cleared on dialog close. It is never written to tab state, never to `tabs.state_json`,
  never to a collection row. This mirrors P14 §0.3's own honest limit — *"Scrubbing plaintext from
  renderer memory after a reveal"* is not something JS offers, and pretending otherwise would be the
  stub `AGENTS.md` forbids — so the plan says what it does (drops the reference) rather than claiming
  to zero anything.
- **Nothing logs a resolved value.** `internal/httpvars` `slog`s the *count* of secrets resolved and
  their **names**, never their values, and only at `Debug`. `connections.Service.Reveal`'s own
  `slog.Info(fmt.Sprintf("secret revealed for %s", id))` (`service.go:407`) is the precedent: the
  subject, not the secret.

### D6 — Substitution is two stages, and the ordering is decided by F3
The engine is **renderer-side TypeScript**, and the secret half is **Go, at send time, strictly after
`op.SetCommand`**.

**Stage 1 — the renderer** (`http/substitute.ts`, called from `views/httprequest/state.ts`'s
`send()`): resolves every reference whose name matches a non-secret entry in the active environment
or the request's collection. A reference naming a *secret* entry is left **verbatim** (`{{name}}`)
and classified `deferred`. A reference naming nothing is left verbatim and classified `unknown`. A
`$`-prefixed reference is left verbatim and classified `dynamic` (D17).

**Stage 2 — Go** (`bridge/http.go`'s `Send`, via `httpvars.Service.ResolveRequest`): reads the secret
entries for `args.CollectionID`/`args.EnvironmentID`, decrypts them, and resolves the remaining
references. Then, and only then, calls `httpclient.Send`.

The ordering inside `Send`, spelled out because F3 is the reason it exists:

```
op.SetCommand(method + " " + args.URL)       // the *unresolved* URL — never the resolved one
resolved := httpvars.ResolveRequest(args)    // secrets enter here and go no further
resp := httpclient.Send(runCtx, resolved)
op.SetCommand(method + " " + args.URL + " → " + status)   // still the unresolved URL
```

`args.URL` is used in both `SetCommand` calls and `resolved.URL` in neither. `op_log.command` is a
persisted column (F3) rendered in the Operations panel, so this is not a stylistic choice.

**Why this split rather than either extreme**, stated as requirements:

- *All in Go* would put the engine somewhere `@faker-js/faker` cannot reach. P6's SPEC row says it
  *"extends the same `{{...}}` substitution engine P5 builds"* and names `@faker-js/faker` (a root
  `package.json` dependency since v1.1's P15). A Go engine would force P6 to either add a Go faker
  (contradicting its own row) or build the second substitution mechanism its row exists to avoid.
- *All in the renderer* would require secret plaintexts in the renderer store, which is D5's bug.
- The cost is one small scanner on each side, and D18 is the guard that keeps the two honest. It is
  the same shape the repo already accepts elsewhere: `httpclient.validBodyModes` and
  `HTTP_BODY_MODES`, `contentTypeByCodeLanguage` and `CONTENT_TYPE_BY_CODE_LANGUAGE` are each written
  twice with a parity test between them, deliberately (P3 D12).

**`HttpRequestWire`/`HttpSendArgs` gain two fields**, `collectionId` and `environmentId`, both
possibly empty. Empty `collectionId` (a scratch tab) means no collection layer; empty
`environmentId` means no environment selected. Go treats an id that no longer resolves as "no
entries" rather than an error — a deleted environment must not make a request unsendable.

### D7 — Exactly which fields are substituted, and which deliberately are not
Derived from §1.2's `send()` and F1/F2, not from a general rule.

| Field | Substituted | Why |
|---|---|---|
| `state.url` | **yes** | includes the query string and the fragment — the URL is the single source of truth (§1.3), so the Params table needs no separate handling |
| each enabled header's `name` | **yes** | `{{header-name}}` is rare but legal, and excluding it would be an arbitrary asymmetry with the value |
| each enabled header's `value` | **yes** | the common case — `Authorization: Bearer {{token}}` |
| `raw` body → `state.body` | **yes** | |
| `code` body → `state.code` | **yes** | including a JSON body whose values are `"{{id}}"` |
| `urlencoded` rows → `name`, `value` | **yes** | |
| `formdata` **text** rows → `name`, `value`, `contentType` | **yes** | |
| `formdata` **file** rows → `name`, `contentType` | **yes** | |
| `formdata` file rows → `path` | **no** | see below |
| `file` body → `binaryFile.path` | **no** | see below |
| `method` | **no** | F2: unrepresentable in a seven-member `<select>` |
| auth fields | **n/a** | F1: there are none |

**Why a local file path is not substituted.** A path in this app is produced by the native file
dialog and validated at send by `httpclient`'s own `os.Stat` (`body.go:156-180`,
`prepareFormParts` `:191-215`), which is what makes an unresolvable file fail legibly rather than
silently (P4 F5 relies on this). A `{{dir}}/report.csv` path would be a path the picker never saw,
whose existence nothing checks until the request is already running, and whose failure message would
name a string the user never typed. The exclusion is one line in `buildBodyWire`'s caller and is
stated in the UI as nothing at all — a `{{...}}` in a path simply is not a variable reference.
§8 OQ-7 hands it forward with the argument for reconsidering it.

### D8 — What is reused from v1.1 P14, and what is newly built — method by method
The brief asks for this to be exact, so it is a table rather than a claim.

| Piece | P5 |
|---|---|
| `internal/localauth` package — `Authorizer`, `Authorize`'s decision table, `GraceWindow`, `evaluate_darwin.go`, `evaluate_other.go` | **reused verbatim, not one line changed** |
| The **single `*localauth.Authorizer` instance** built in `main.go:78-80` | **reused, the same object** — passed into `httpvars.New` alongside the cipher, so a grace granted by a connection reveal covers a variable reveal and vice versa. That is the point of a *process-wide* grace, and building a second Authorizer would silently halve it |
| `secrets.Cipher` (`Encrypt`/`Decrypt`) | **reused verbatim** (F4) |
| `state/confirmDialog.ts`'s `confirmDialog()` | **reused verbatim** — the OS-auth-unavailable fallback, exactly as `ConnectionDialog.vue:240-245` uses it |
| The four-outcome vocabulary `revealed \| cancelled \| confirmation-required \| error`, and the never-throws contract | **reused as a shape**, redeclared in `internal/httpvars` |
| `connections.Service.Reveal`'s body | **not reusable** — it is `Secrets.Get(connectionID)` against `connections.password` (§1.4). `httpvars.Service.Reveal` is its sibling, ~25 lines, against `http_variables.secret_value` |
| `connections.RevealResult` the Go type | **deliberately not shared.** Importing `internal/connections` from an Http-scoped package would be the exact Studio↔Http coupling `docs/v1.2/SPEC.md`'s module-boundary section asks every phase to avoid and P12 to audit. Two three-field structs is the cheaper side of that trade, by a wide margin |
| `ConnectionDialog.vue`'s `requestReveal` | **nothing to reuse — it is a local, unexported function inside a `.vue` file** (§1.4). `http/state/variables.ts` gets its own `revealVariable(id)`, same recurse-once shape, ~20 lines |
| Extracting a **shared** reveal composable for both callers | **declined.** It would have to live in `state/` (the only directory both `project/**` and `http/**` may import), i.e. a new Studio↔Http shared module, created in the chapter whose stated goal is removing them. The two also differ in what they do with a success: one writes a dialog draft field, the other writes a transient reveal map. §8 OQ-2 hands the observation to P12, which is the phase that can move both at once |
| `ConnectionDialog.vue`'s eye-button behaviour (un-revealed = the action; revealed = a free toggle) | **reused as a pattern**, in `VariableRow.vue` |
| `tests/ui/credential-reveal.spec.ts`'s technique (mock the outcome per scenario rather than drive a real prompt) | **reused as a pattern** in the new `http-variables.spec.ts` (§6.3) |

**`httpvars.Service.Reveal`, in full shape:**

```go
func (s *Service) Reveal(variableID string, confirmed bool) RevealResult {
    outcome, err := s.auth.Authorize(revealReason, confirmed)   // the SAME Authorizer as connections
    // err  -> {Outcome: "error", Error: &msg}, slog.Warn with the id, never the value
    // Cancelled -> {Outcome: "cancelled"}            (P14 D11: no message, that would be nagging)
    // Unavailable -> {Outcome: "confirmation-required"}
    // Granted  -> decrypt secret_value, {Outcome: "revealed", Value: plain}
}
```

`RevealHistory(historyID, confirmed)` is the same function against `http_variable_history`.
Both **never error** across the bridge, matching P25 D9's contract that P14 inherited.

### D9 — The reveal gates *display*, not *use* — and that is the established policy, not a new one
`docs/ARCHITECTURE.md:447-448`, describing P14 as shipped: *"`Connect`, `Test`, and `Duplicate` all
continue to use the stored secret unprompted, exactly as before — this gate is about turning a secret
into visible text, not about using it."*

Applied here: **sending a request that substitutes a secret prompts for nothing.** The user asked for
the request, the value is never shown, and D6 keeps it out of the renderer, the op log and every
`slog` line. Prompting per send would be per-keystroke-grade friction on the app's most common
action, and P14 D5's own reasoning (*"that is exactly the friction that gets a security feature
disabled"*) applies unchanged.

What **does** prompt: pressing the eye on a variable row, and pressing the eye on a history entry.
D21 hands P7 the third case — a generated curl command with a secret substituted into it *is*
turning a secret into visible text, and belongs behind the same gate.

### D10 — Secrets when the cipher is unavailable
`Cipher.Encrypt` refuses with `E_SECRET_STORE` and a reason string when the backend is unavailable
(`cipher.go:74-80`), which on Linux without `KIRA_INSECURE_SECRETS=1` is the normal state. P5 does not
work around it:

- **Marking a variable secret when the cipher is unavailable fails the save**, with the cipher's own
  reason surfaced in the dialog's `MessageStrip` — the same treatment `ConnectionDialog` gives a
  failed password save. Writing the plaintext into `value` "for now" would be the exact
  silently-weaker-than-it-looks behaviour `AGENTS.md` and `secrets/cipher.go:24-27` both refuse.
- **A secret whose decrypt fails at send time** (a keychain reset, a database copied from another
  machine) resolves to nothing: the reference stays literal, the send proceeds, and the failure is
  reported once per send at `slog.Warn` naming the variable, not the value. Refusing the send would
  turn one bad row into a dead request; leaving the token literal is visible in the response the
  server gives back, which is the honest signal.
- The variables dialog shows `secrets.Status`'s existing reason line when `available` is false, via
  the **already-bound** `ConnectionsService.SecretsStatus` call the connection dialog uses — no new
  status plumbing.

### D11 — Four surfaces, all under `http/`, none of them a new tab kind or a change to shared chrome
F8 is what makes this possible: `views/**` may import `http/**`, so every new component lives in the
Http module's own directory even when it renders inside the request view.

**`http/EnvironmentSelect.vue`** — the switcher. A `.p-select.bordered` listing *No environment*,
every environment by name, and a trailing *Manage environments…* option that opens the environments
dialog. Mounted in **`HttpRequestView.vue`'s existing `#toolbar-2` slot** (`:192-199`), right-aligned
with `.p-push` beside the request-pane `SegmentedControl`.

Two alternatives were weighed and declined:
- *The left panel's header.* `LeftPanel.vue` renders `#empty` **instead of** `#body` when `empty` is
  true (`:86-100`), and environments exist independently of collections — so with no collections the
  switcher would disappear while still being meaningful. Fixing that means changing `LeftPanel.vue`,
  which is shared chrome Studio also uses (§3).
- *The title bar.* Shared with Studio, and the SPEC's module-boundary section is explicit that Http
  must not grow into Studio's files.

The request toolbar is also simply where the selection matters: it is visible exactly when a request
is about to be sent.

**`http/VariablesDialog.vue`** — one scope's variable list, on the existing `DialogFrame`
(`width: 720`, `maxHeight: '80vh'`). Title is `Variables — <collection name>` or
`Environment — <environment name>`; the body is a header row plus `VariableRow`s plus a trailing
blank row (`FieldRowsTable.vue`'s trailing-blank-row UX, reimplemented rather than imported —
`http/**` may not import `views/**`, and the row differs by three columns anyway). Opened from the
collection row's context menu (*Variables…*), from the environments dialog's per-row *Edit
variables…*, and from a palette entry.

**`http/VariableRow.vue`** — one row: a grip handle (D14), a name `TextField`, a value cell, a
**secret** checkbox, an eye `IconButton` (secrets only), a history `IconButton`, a remove
`IconButton`. The value cell renders `••••••••` as read-only text when the row is a secret and not
revealed; pressing the eye is the reveal action; once revealed it is an ordinary editable
`TextField` and the eye is a free mask toggle (P14's own pattern, §1.4). Ticking *secret* on a row
that already has a plaintext value moves that value into the encrypted column on save and clears
`value` — and, because that is a one-way door for anyone reading the list, the row shows the value
masked immediately.

**`http/EnvironmentsDialog.vue`** — the list of environments: name (inline-editable `TextField`),
*Edit variables…*, delete, a grip handle for reordering, an *Active* radio, and a *New environment*
button. `DialogFrame`, `width: 480`.

**`http/menus.ts`** gains one item on the collection row menu (*Variables…*, icon `symbol-variable`)
and one on the background menu (*Environments…*), both injected through the existing
`CollectionMenuActions` seam (`menus.ts:12-23`) rather than imported — the shape that file already
has. `CollectionsPanel.vue` gains one `#actions` `IconButton` (`icon="settings-gear"`,
`data-testid="http-environments"`).

### D12 — The row model, and what it deliberately does not have
```ts
export interface HttpVariable {
  id: string;
  scope: 'collection' | 'environment';
  ownerId: string;
  name: string;
  /** '' whenever isSecret — the plaintext of a secret never crosses the bridge (D5). */
  value: string;
  isSecret: boolean;
  sortOrder: number;
}
```

No `enabled` (§0.2 — the SPEC's list does not include it, and a column nothing writes is the
half-implementation the rules forbid), no `description` (P4 §8 OQ-10 already tracks per-row
descriptions as one change across four tables, and this would be a fifth), no `type` (Postman's own
`variable.type` is preserved through export by D16's mapping and is not a field this app edits).

A duplicate `name` within one scope is **allowed by the schema and resolved first-wins by
`sort_order`**, with the dialog marking the later row with a `.p-chip.warn` reading *duplicate*.
Rationale: a `UNIQUE` constraint would make reordering-while-renaming fail mid-edit and would refuse
an imported collection that legitimately carries two entries with the same key (P4 F1 established
that Postman permits it for items; the same leniency applies here). First-wins is deterministic
because `sort_order` is dense and total.

### D13 — History is per entry, recorded on change, bounded, and restorable
The SPEC says *"Both variables and environments keep a history of prior values"*. Resolved reading:
**an environment's history is its entries' histories** — there is no second, environment-level notion
of a "prior value", because an environment has no value of its own, only a name and a set of entries.
Stated here so it is a decision rather than an ambiguity the implementer resolves silently.

- **Recorded** by `VariablesRepo.Upsert`, inside the same transaction, whenever the stored value
  actually changes (comparing ciphertext for a secret is meaningless — GCM nonces differ per
  encryption — so a secret's change is detected by decrypting the stored value once and comparing
  plaintext, inside Go, and never logging either).
- **Bounded** at `historyLimit = 20` per variable, trimmed with the same
  `DELETE … WHERE id NOT IN (SELECT id … ORDER BY recorded_at DESC, rowid DESC LIMIT ?)` statement
  `repos/filter_history.go:62-70` already uses. Mirroring an existing bound rather than inventing one.
- **Secret history rows carry ciphertext**, and viewing one goes through `RevealHistory` (D8) — a
  secret's old value is exactly as sensitive as its current one.
- **Restoring** an entry writes it as the current value through the ordinary `Upsert` path, which
  records the value being replaced. So restore is itself in the history, and undoable.
- **Rendered** by `http/VariableHistoryMenu.vue` on the existing `PopoverPanel`, anchored to the row's
  history button: each entry's `recorded_at` (relative, e.g. *2 days ago*), its value (masked for a
  secret, with its own eye), and a *Restore* action. Empty state: *No previous values.*
- Deleting a variable cascades its history (`ON DELETE CASCADE`, D4).

### D14 — Reordering, by drag **and** by keyboard, and it does not touch `TreeHost`
Two independent lists reorder: a scope's variables, and the environments themselves. Both use the
same mechanism.

- **Drag**: `draggable="true"` on the row, a `<CodiconIcon name="gripper" :size="13" />` handle, and
  `dragstart`/`dragover.prevent`/`dragend` splicing a local `order` array — `ColumnsMenu.vue:66-81`
  and `:122-134` copied in shape, not imported (it lives under `views/grid/`, which `http/**` may not
  import, and it is fifteen lines).
- **Keyboard**: `Alt+↑` / `Alt+↓` on a focused row moves it one position. A drag-only affordance is
  unusable from the keyboard, and this is a form dialog where every other control is reachable by
  Tab. No new shortcut id — it is a local `keydown` handler on the row, the same way
  `CollectionsTree.vue` handles `←`/`→` locally.
- **Committed** on drop / on keypress with one `Reorder({scope, ownerId, ids})` call carrying the
  full new order — `ConnectionsService.Reorder(ids []string)`'s existing shape (§1.7) — which
  rewrites `sort_order` dense in one transaction.

**This does not close P4 §8 OQ-9.** That question is about drag-reorder *in the collections tree*,
which needs drop-between and drop-into targets, auto-expand-on-hover and a cross-parent reindex
inside `TreeHost.vue` so Studio's tree could adopt it too. A flat list in a dialog shares none of
that, and `TreeHost.vue` is byte-identical after this phase (§3). Said out loud so nobody reads this
decision as having answered that one.

### D15 — Import promotes collection-level `variable[]`; export owns the member outright
P4 D9's contract, honoured in both halves (F5 explains why the mechanism differs from the letter).

**`postman.Tree` gains `Variables []Variable`** (`Name`, `Value string`, `Secret bool`).

**Import** (`parse.go`): the collection-level `variable[]` is decoded into `Tree.Variables` and
**deleted from `Tree.Origin`**, so the origin no longer carries it and cannot re-emit it.
`countInertMembers` is split: the document-level call (`parse.go:60`) no longer counts `variable`,
and a new `WarnVariablesImported` reports the promoted count with its own message. The folder-level
(`:120`) and item-level (`:132`) calls are unchanged, and those levels stay inert in origin — the
SPEC's row is collection variables and environments, and Postman's folder-scoped variables carry an
inheritance rule that is a feature of its own.

Per-entry decoding, from what P4 already established about the schema: `key` is the name, `value` is
untyped (`decodeScalarString`, `collection.go:128-152`, already handles a numeric or boolean value —
reused, not rewritten). `type == "secret"` marks the entry secret. **`type: "secret"` is
[unverified against a real Postman export from this sandbox]** — §8 OQ-1 — so the importer treats any
*other* `type` value as non-secret rather than refusing it, and the round trip preserves the original
`type` string per entry so an unrecognised one survives export.

**Export** (`write.go`): `variable` becomes the exporter's **fourth owned member**, alongside `url`,
`header` and `body` — but unconditionally, not under D6's unchanged-⇒-verbatim rule. There is no
"unchanged" case to detect: the rows *are* the collection's variables now, and origin no longer has
the member to compare against. `buildVariables(tree.Variables)` emits
`[{key, value, type?}]`, and D16 decides what a secret's `value` is.

**Pre-P5 rows** (`variables_promoted = 0`, F5): `VariablesRepo.PromoteImported(collectionID)` runs on
the first `List` for that collection — read `origin_json`, decode, move any top-level `variable[]`
into rows, write the shed origin back, set `variables_promoted = 1`, all in one transaction. Every
row the P5 importer writes stamps `1` at insert, so this path only ever fires for a collection
imported before this phase, exactly once.

### D16 — A secret is exported without its value, and that is stated rather than hidden
The exported file is a plain JSON document the user shares, mails and commits. Writing a decrypted
credential into it would defeat the entire masking feature at the one moment it matters most, and it
would happen with no prompt, from a context-menu item that says *Export collection…*.

So: an entry with `is_secret = 1` exports as `{"key": <name>, "value": "", "type": "secret"}`.

This is honestly lossy, and it is named in three places: this decision, the export's own confirmation
(the export path gains one `MessageStrip` line in the panel — *"N secret values were not written to
the file"* — when the exported collection has any), and `docs/ARCHITECTURE.md`. The alternative — a
*"include secret values?"* checkbox on export — is a real feature with a real decision behind it
(what it means to write a credential to a chosen path, whether that is itself a reveal) and is handed
forward as §8 OQ-9 rather than half-built.

### D17 — The engine: one pass, a two-token grammar, and a classified report
`http/substitute.ts` and `internal/httpvars/resolve.go` implement the same function.

```
resolve(text, values, secretNames) -> { text: string, refs: Reference[] }
Reference = { name: string, kind: 'resolved' | 'deferred' | 'dynamic' | 'unknown' }
```

The grammar, in full:

- Scan for `{{`. From there, scan for the next `}}`. No `}}` ⇒ the rest is literal text and the scan
  ends.
- The name is the text between, `trim`ed. An empty name is not a reference — `{{}}` is literal.
- Nesting is not a thing: the inner text is taken as-is, so `{{a{{b}}}}` takes `a{{b` as a name,
  finds nothing, and passes through literally. Postman behaves the same way; more importantly, this
  rule is total and terminating with no special cases.
- **One pass.** A resolved value that itself contains `{{other}}` is **not** re-expanded. Recursive
  expansion needs a cycle detector and a depth cap for a capability nobody has asked for, and a
  single pass is terminating by construction. §8 OQ-3.
- A name starting with `$` is classified **`dynamic`** and left verbatim. This is not a partial
  implementation of P6: it is this phase's own grammar deciding that `{{$randomEmail}}` is a
  reference *of a kind P5 does not resolve*, so D16's warning says *"dynamic values arrive in a later
  phase"* rather than mislabelling a correct reference as a typo. P6 adds a resolver behind the
  existing `dynamic` branch and changes no scanning.
- A name matching a known **secret** entry is classified **`deferred`** and left verbatim — Go
  finishes it (D6). Go's own pass classifies a still-unresolved reference `unknown` and leaves it.

Both implementations are pure and dependency-free: `substitute.ts` imports nothing (no Vue, no DOM,
no `@shared`), which is what makes `tests/unit/http-substitution.spec.ts` a plain import.

### D18 — The two implementations are pinned by one corpus, read by both languages
The parity risk here is not a vocabulary list (P2 D10's `extractGoStringSet` technique does not
apply) — it is *behaviour*. So the guard is a shared fixture rather than a source-text scrape:

`internal/httpvars/testdata/substitution.json` — an array of cases:

```json
[{ "name": "an unterminated open brace is literal",
   "template": "a {{b",
   "values": { "b": "x" },
   "secrets": [],
   "want": "a {{b",
   "refs": [] }, …]
```

Read by `internal/httpvars/resolve_test.go` and by
`apps/kira-studio/tests/unit/http-substitution.spec.ts` (a relative `readFileSync`, exactly the way
`go-ts-vocabulary-parity.spec.ts:36-41` already reaches into the Go tree from a TS test). A case
added to the file must pass on both sides or one of them fails — which is a stronger guard than two
independent test suites, and cheaper than generating one side from the other (P2 D10's own rejected
option, for the same reason).

The corpus covers, at minimum: plain substitution; a name needing trimming; an unknown name; a
secret name (deferred on the TS side, resolved on the Go side with the same corpus run twice, once
per role); a `$`-prefixed name; `{{}}`; an unterminated `{{`; a `}}` with no opener; a value that
itself contains `{{x}}` (not re-expanded); two references in one string; a reference adjacent to
another with no separator (`{{a}}{{b}}`); a name with a space and a name with a hyphen; a value
containing `&`, `<` and `"` (D1's escaping requirement, asserted byte-for-byte).

### D19 — One new Go service package, one new `Deps` field, one new bound service
**`internal/httpvars`** is Http-scoped Go, beside `internal/httpclient` and `internal/postman` — the
directory shape the SPEC's module-boundary section names. It owns the service (`vars.go`), the reveal
gate's caller (`reveal.go`) and the Go half of the engine (`resolve.go`). It imports
`internal/storage/repos`, `internal/secrets` and `internal/localauth`, and **not** `internal/connections`
(D8) and not Wails.

`httpvars.New(repo *repos.VariablesRepo, cipher *secrets.Cipher, auth *localauth.Authorizer) *Service`,
called in `main.go` immediately after `secretsRepo` is built (both ingredients already exist there:
`cipher := secrets.New()` at `:77`, `authorizer := localauth.New(...)` at `:80`, the latter with its
own comment saying it is *"constructed beside the cipher"*). `appcore.Deps` gains one field,
`HttpVars *httpvars.Service`
— the same shape `Connections`/`Tree` already have, and consistent with F7's own note that Deps
carries services, not their ingredients.

`bridge/variables.go` is `VariablesService{Deps appcore.Deps}` (the `QueriesService` shape) with
thirteen methods, each a typed-struct wrapper with an explicit guard and an `ipcerr` translation:

| Method | Returns |
|---|---|
| `ListEnvironments()` | `[]Environment` (`{id, name, sortOrder, isActive}`) |
| `CreateEnvironment({name})` | `Environment` |
| `RenameEnvironment({id, name})` | `void` |
| `DeleteEnvironment({id})` | `void` |
| `SetActiveEnvironment({id})` | `void` (`id: ""` = none) |
| `ReorderEnvironments({ids})` | `void` |
| `List({scope, ownerId})` | `[]Variable` — **never a secret's value** (D5) |
| `Upsert({scope, ownerId, id, name, value, isSecret})` | `Variable` (`id: ""` = create) |
| `Delete({id})` | `void` |
| `Reorder({scope, ownerId, ids})` | `void` |
| `History({variableId})` | `[]VariableHistoryEntry` — **never a secret's value** |
| `Reveal({variableId, confirmed})` | `RevealResult` — never errors (D8) |
| `RevealHistory({historyId, confirmed})` | `RevealResult` — never errors |

`main.go` gains one `application.NewService(&bridge.VariablesService{Deps: deps})` line.

**No op-log row and no new op kind**, for P4 D11's reasons unchanged: these are local, all-or-nothing
SQLite transactions with nothing useful to cancel, initiated from a dialog with no tab. The one call
that can genuinely block — `Reveal`, waiting on a Touch ID prompt — blocks only itself (F11), which
is exactly what P14 already ships for connections.

### D20 — The TypeScript mirrors, and where they are parsed
`packages/shared/domain/variables.ts`: `httpVariableSchema`, `httpEnvironmentSchema`,
`httpVariableHistoryEntrySchema`, `VARIABLE_SCOPES = ['collection', 'environment']`, and
`REVEAL_OUTCOMES = ['revealed', 'cancelled', 'confirmation-required', 'error']`.

Following P2 D5's rule — *"the wire shapes live in Go and are mirrored, not re-validated"* — these are
**types, not guards**, and `control.ts` `trust<T>()`s them like every other bound result. The one
exception P4 D4 made (Zod-parsing `httpSavedRequest` at `openCollectionRequestTab`) exists because a
bad shape there becomes *tab state* and breaks a render; nothing here becomes tab state.

`packages/shared/domain/http.ts`'s `HttpRequestWire` gains `collectionId: string` and
`environmentId: string`, mirroring `HttpSendArgs`.

### D21 — What P7 inherits, written down now so it is not rediscovered
P7's SPEC row: *"generate an equivalent curl command … with any `{{variable}}`/`{{$dynamic}}`
reference resolved to its real value in the generated command, since curl itself has no notion of
either."*

Two facts P5 hands it:

1. **`http/substitute.ts` is the generator's resolver too** — same function, same classification, and
   P6's `dynamic` branch will already be filled in by then.
2. **A generated curl command carrying a secret's real value is a reveal** (D9's line: turning a
   secret into visible text). It goes onto the clipboard, into a terminal's scrollback and often into
   a bug report. So P7's *Copy as curl* on a request that references a secret must go through
   `VariablesService.Reveal` for each referenced secret — the gate already exists, the grace window
   means one prompt covers a working session, and the alternative (a curl command with `{{token}}`
   still in it) is not runnable, which is the thing P7's row exists to fix.

---

## 5. Implementation order

Fourteen commits. C1–C5 add capability with nothing mounted (each builds and tests on its own);
C6–C11 are one user-visible slice each; C12 closes P4's hand-off; C13–C14 are the tests and the docs.
Per `AGENTS.md`, run the fast checks (`lint`, `typecheck`, `build`, `go build`/`go vet`) per commit and
the expensive suites once at the end.

### C1 — `feat(shared): the variable, environment and reveal-outcome domain`
`packages/shared/domain/variables.ts` (D20), and `http.ts`'s two new `HttpRequestWire` fields (D6).
No behaviour, no UI. **Guard: `tests/ui/http-request.spec.ts` and `http-request-body.spec.ts` pass
unedited** — two optional wire fields cannot change a P3 tab's behaviour.

### C2 — `feat(http): the {{name}} substitution engine`
`http/substitute.ts` (D17), `internal/httpvars/testdata/substitution.json` (D18) and
`tests/unit/http-substitution.spec.ts`. Nothing calls it — `bun test apps/kira-studio/tests/unit` is
the whole proof, the shape P2's C2 and P3's C1 both took.

### C3 — `feat(storage): collection variables, environments and their value history`
`migrations/0007_p5_variables.sql` + the `embed.go` entry (D4), `model/variables.go`,
`repos/variables.go` (including `PromoteImported`, D15), `repos/repos.go`'s one field, and
`repos/variables_test.go` (§6.2). Still no caller. Guard: `go test ./apps/kira-studio/internal/storage/...`,
which per `repos/helpers_test.go:12-24` runs the **real** migration chain against a real temp-file
database, so the migration is covered by construction.

### C4 — `feat(httpvars): the variables service, secret storage and the gated reveal`
`internal/httpvars/{vars,reveal,resolve}.go` and `resolve_test.go` reading C2's corpus (D18). The
cipher round trip for a secret value (D5), `Reveal`/`RevealHistory` over the injected
`*localauth.Authorizer` (D8), and `ResolveRequest` (D6's stage 2). Nothing bound yet.

### C5 — `feat(bridge): VariablesService`
`bridge/variables.go`'s thirteen methods (D19), `appcore/deps.go`'s one field, the `main.go` wiring
(`httpvars.New` + the service line), `control.ts`'s thirteen wrappers, bindings regenerated via
`wails3 task common:generate:bindings` (never a hand-typed flag list — `AGENTS.md`'s `-names`
warning), plus `tests/ui/support/ipcChannels.ts`'s thirteen names, `mockRuntime.ts`'s thirteen FQNs
and the two `'[]'` wildcards (F9).

### C6 — `feat(http): the variables store and the environment switcher`
`http/state/variables.ts` (the store, the active environment, the environment list), and
`http/EnvironmentSelect.vue` mounted in `HttpRequestView.vue`'s `#toolbar-2` (D11). Read-only at this
point: it lists and switches; nothing edits. **Guard: `mode-switch.spec.ts`, `http-request.spec.ts`
and `http-request-body.spec.ts` all pass unedited** (F9's wildcards from C5 are what make that true).

### C7 — `feat(http): the collection variables editor`
`http/VariablesDialog.vue`, `http/VariableRow.vue`, `menus.ts`'s *Variables…* item, `App.vue`'s mount,
and the palette entry. Create, rename, edit and delete a plaintext variable; no secrets, no history,
no reorder yet.

### C8 — `feat(http): named environments`
`http/EnvironmentsDialog.vue`, `CollectionsPanel.vue`'s `#actions` button, `menus.ts`'s
*Environments…* background item, the second palette entry. Create/rename/delete an environment, edit
its variables through C7's dialog, and set the active one (D3).

### C9 — `feat(http): secret variables, masked and revealed behind local authentication`
The secret checkbox, the `••••••••` cell, the eye button, `revealVariable()` with its recurse-once
`confirmDialog()` fallback (D8), and D10's unavailable-cipher handling with `SecretsStatus`'s
existing reason line.

### C10 — `feat(http): a value history per variable, and reordering`
`http/VariableHistoryMenu.vue` with restore and a gated per-entry reveal (D13); the grip handle,
the drag splice and `Alt+↑`/`Alt+↓` on both lists, committed through `Reorder` (D14).

### C11 — `feat(http): resolve {{name}} in the URL, headers and body when a request is sent`
`views/httprequest/state.ts`'s `send()` running stage 1 over D7's exact field list;
`HttpSendArgs`/`control.httpSend` carrying the two scope ids; `bridge/http.go`'s stage 2 placed
**after** `op.SetCommand` and never feeding back into it (D6/F3); `HttpRequestView.vue`'s
unresolved-reference `.p-chip.warn` with its tooltip listing the names (D16's three classifications).

### C12 — `feat(postman): collection variables promoted out of the imported origin`
`postman.Tree.Variables`, `parse.go`'s promotion and split `countInertMembers`, `write.go`'s fourth
owned member with D16's valueless secret, `repos/collections.go`'s `ImportTree`/`LoadTree` halves,
`PromoteImported`'s wiring, the new import-report warning kind, and the export's
*"N secret values were not written"* strip line. `roundtrip_test.go`'s two affected assertions are
updated here, with the corpus file itself unchanged (§6.2).

### C13 — `test: the substitution engine, the variables repo and the reveal gate`
`tests/ui/http-variables.spec.ts` (§6.3), plus any corpus case the earlier commits proved was
missing. Its own file, per §0.3 — nothing is appended to `collections.spec.ts` or to
`go-ts-vocabulary-parity.spec.ts`.

### C14 — `docs(architecture): variables, environments and the two-stage substitution`
`docs/ARCHITECTURE.md`: the storage schema block gains the three tables and the new column; a Storage
paragraph for the two-column secret split and why the list projection is the guarantee; an addition
to the existing P14 secrets paragraph (`:440-448`) recording that the same `Authorizer` now gates a
second kind of reveal and that *use* is still ungated; a UI-architecture paragraph for the two-stage
substitution, its ordering against `op_log.command`, and the export's secret-value omission.

---

## 6. Verification

### 6.1 What runs here
`bun run lint`, `bun run typecheck`, `bun run build`, `bun run test:unit`, `bun run test:ui`,
`bun run test:ipc:fe`, plus
`go build ./... && go vet ./... && go test ./apps/kira-studio/internal/...`.
`scripts/setup.sh` first in a fresh container — **mandatory this phase**: C5 adds a bound service, so
`apps/kira-studio/frontend/bindings/**` must be regenerated or the Vite build fails on an
unresolvable import.

Two bindings checks, from `AGENTS.md`'s own warnings and P2/P3/P4's precedent:

1. The generated `variablesservice.ts` must call
   `$Call.ByName("…bridge.VariablesService.List", …)`, not `$Call.ByID(<n>, …)` — a `-names`-less
   regeneration silently breaks **every** `tests/ui` spec at the first bound call of boot, surfacing
   as a `status-bar` selector timeout with a page-level `no CHANNEL_TO_FQN entry for undefined`.
2. The regenerated models must include `model.Variable`, `model.Environment`,
   `model.VariableHistoryEntry` and `httpvars.RevealResult` as real exported types, and
   `HttpSendArgs` must carry its two new fields.

Also verify, once, by reading the generated `httpvars` model: `RevealResult.Value` is a `string` and
not a pointer, and **no** generated type exposes `secret_value` — the bridge never returns it.

### 6.2 The Go and unit tests, and what they deliberately do not cover
`AGENTS.md`'s bar: a test earns its keep only for *"a parser/splitter with several interacting
rules"*, *"cursor/pagination boundary arithmetic"*, *"crypto beyond encrypt-then-decrypt"* and
similar. Three things here qualify; the CRUD does not.

**`internal/httpvars/resolve_test.go` + `tests/unit/http-substitution.spec.ts`** — the corpus (D18).
A scanner with a two-token grammar, a trim rule, four classifications, an unterminated-open case, a
no-re-expansion rule and a byte-exact escaping requirement is squarely the named category, and it is
written **twice in two languages**, which is precisely the drift a corpus pins. Each side runs every
case; the secret cases run in both roles (deferred on the TS side, resolved on the Go side).

**`repos/variables_test.go`** — four cases, each guarding arithmetic or an invariant, none a CRUD
round-trip:

1. **`sort_order` is dense and stable** across an insert into the middle, a delete and a reorder, in
   both scopes independently (a collection's reorder must not renumber an environment's).
2. **History is recorded on change, deduped and trimmed at 20**, oldest first, and a restore records
   the value it replaced. The boundary case — writing the same value twice records once — is the one
   most likely to regress.
3. **`List` never returns a secret's plaintext or ciphertext**, asserted by writing a secret row,
   reading it back through the repo's list projection and checking `value == ""` **and** that the
   returned struct has no field carrying the envelope. Then `Reveal`'s path decrypts it correctly —
   the encrypt-then-decrypt half is one line and would not earn a test on its own; the projection is
   the invariant.
4. **`PromoteImported` is one-shot and idempotent**: a pre-P5 collection row carrying
   `variable[]` in `origin_json` promotes once, sheds the member, sets the flag, and a second call
   changes nothing.

**`internal/postman/roundtrip_test.go`** — two existing assertions change (F6), and one is added:

- `TestPreservedButInertSurvivesAFullCycle` drops `"variable"` from its **collection-level**
  byte-identical member list (`:455`) and keeps it in the folder/item list (`:473`) — folder- and
  item-level variables are still inert.
- The `WarnVariablesInert` expectation (`:493`) drops to the folder/item count for
  `testdata/inert.json`, and a new `WarnVariablesImported` expectation covers the promoted
  collection-level ones. The fixture file itself is **not** edited: the same input now proves the
  new rule, which is the point.
- A new case: a collection with variables imports → the rows exist with the right names, values,
  order and secret flags → export re-emits `variable` from the rows, in order, with a secret's
  `value` empty and its `type` `"secret"` (D16).

**Explicitly not tested:** that `CreateEnvironment` then `ListEnvironments` returns it; that
`RenameEnvironment` renames; that a missing name is refused; that the cipher round-trips a string.
Each is `AGENTS.md`'s *"everything else gets nothing"* — CRUD round-trips, one-condition guards, and
encrypt-then-decrypt.

### 6.3 The new UI spec — `tests/ui/http-variables.spec.ts`
Its own file (§0.3). `tests/ui` drives the real built bundle in real WebKit with both wire planes
mocked; per `mockRuntime.ts:353`, a channel with exactly one snapshot answers args-blind. Modelled on
`credential-reveal.spec.ts`, which mocks the *outcome* per scenario rather than branching on the host
OS or driving a real prompt this tier cannot reach at all. **Five tests:**

1. **A secret is masked, and revealing it is gated.** Seed `variablesList` with one plaintext and one
   secret entry. Open the collection's *Variables…* dialog; assert the plaintext value is visible,
   the secret cell reads `••••••••`, and **no `variablesReveal` call has been made**. Press the eye
   with a `confirmation-required` snapshot; assert the app's own `confirmDialog` appears; accept;
   assert a second `variablesReveal` fired with `confirmed: true` and the value now renders. Then run
   the `cancelled` and `error` outcomes and assert the value stays masked in both. **The
   load-bearing assertion, asserted over the whole call log: no bound call's arguments or response
   carried the secret's plaintext before the reveal.**
2. **Substitution reaches the wire, and a secret does not.** Seed one environment (active) with
   `{host: "api.example.com"}` plus a secret `token`, open a request tab, set the URL to
   `https://{{host}}/v1/x?k={{missing}}` and a header `Authorization: Bearer {{token}}`, press Send.
   Assert the `httpSend` args carry `https://api.example.com/v1/x?k={{missing}}` — resolved,
   unknown left literal — the header value **still** `Bearer {{token}}` (D6's deferral), and
   `environmentId` set. Assert the unresolved chip shows `1` and its tooltip names `missing`, not
   `token`.
3. **Precedence is environment-over-collection.** Same name in both scopes; assert the wire carries
   the environment's value, and that switching to *No environment* falls back to the collection's.
4. **Reorder persists what was dragged.** Drag row 3 above row 1; assert `variablesReorder` fired
   once with the full id list in the new order, and that `Alt+↑` on a focused row produces the same
   call shape.
5. **History restores a prior value.** Seed `variablesHistory` with three entries; open the popover,
   assert the entries render newest-first, click *Restore* on the middle one, assert `variablesUpsert`
   fired with that value and the row now shows it.

### 6.4 What only a real Mac can settle
1. **The real Touch ID / system-password prompt** for `VariablesService.Reveal`, including that the
   5-minute grace is genuinely shared with a connection reveal (reveal a connection password, then a
   variable, and confirm the second does not prompt). `evaluate_darwin.go` is cgo over
   `LAContext.evaluatePolicy` and cannot be compiled, let alone driven, from this container; every
   `tests/ui` outcome above is mocked, and the `-tags server` build takes the `Unavailable` branch
   unconditionally.
2. **The real macOS Keychain** as the key source for a secret variable's `kira:v2:` envelope — this
   sandbox runs the `KIRA_INSECURE_SECRETS=1` fallback, which exercises the same code path under a
   different key but not the keychain item itself.
3. **A round trip through real Postman** for D15/D16: export a collection with variables from this
   app, import it into Postman, and confirm the variables appear, in order, and that a `type:
   "secret"` entry is understood as such (§8 OQ-1's open half). Then the reverse — a Postman
   collection with variables, imported here, promoted, and exported back.
4. **Two windows** (D3/§8 OQ-4): switch the environment in one; the other's switcher shows the stale
   selection until it re-lists. A real property of a per-window renderer with no invalidation event,
   recorded rather than pretended away.
5. **The native export dialog** with a collection carrying secrets, confirming the file on disk has
   empty `value`s for them (D16) — the file-writing half is Go and testable here, but the
   `FilesService.ChooseSave` panel that leads to it is not.

### 6.5 What must not regress
- **Studio renders identically.** `git diff` must touch nothing under `project/**`, `views/grid/**`,
  `views/console/**`, `internal/adapters/**`, `internal/adapterhost/**`, `internal/connections/**`,
  `internal/localauth/**`, `internal/secrets/**` or `packages/shared/protocol/**`.
- **`tests/ui/credential-reveal.spec.ts` passes unedited.** P14's gate is called, not changed — if
  this file needs an edit, D8 was not honoured.
- **`tests/ui/mode-switch.spec.ts`, `http-request.spec.ts`, `http-request-body.spec.ts` and
  `collections.spec.ts` pass unedited.** The first three are the F9 trap (they boot with no variables
  fixture); the fourth is P4's, and P5 adds no case to it.
- **`tests/unit/go-ts-vocabulary-parity.spec.ts` is byte-identical** (F10, §0.3).
- **`bun run test:ipc:fe` passes unedited** — no data-plane, adapter or fixture change.
- **No file under `http/**` imports `views/**` or `project/**`** — `bun run lint` is the check.
- **The bundle keeps exactly two dynamic chunks** (`docs/ARCHITECTURE.md:28`). Everything added is
  statically imported; D1 declined every candidate that could have moved the needle.
- **`NOTICES.md`, both `package.json`s and `go.mod` are unchanged** — D1.
- **`docs/PERF.md` gains no budget and needs none.** The one path on a hot surface is `send()`'s
  stage 1, which is a linear scan over a handful of short strings, once per Send.
- **No new plaintext-secret sink.** `git grep` after the phase must show `secret_value` appearing only
  in `migrations/0007_p5_variables.sql`, `repos/variables.go` and `model/variables.go` — never in
  `bridge/**`, never in a `slog` call, never in a generated binding.

---

## 7. Acceptance checklist

Filled in by the implementing session as each item is actually done, not in advance.

- [ ] C1 — the shared domain lands; `HttpRequestWire`'s two new fields default cleanly; both existing
      http specs pass **unedited**.
- [ ] C2 — the engine's grammar matches D17 case for case; the corpus runs green on the TS side with
      nothing mounted.
- [ ] C3 — migration 0007 applies through the real chain; both `CHECK`s reject what they should;
      `sort_order` is dense per owner; history trims at 20; `List`'s projection cannot return a
      secret.
- [ ] C4 — `Reveal` uses the **same** `*localauth.Authorizer` instance as `connections`; all four
      outcomes are produced; the corpus runs green on the Go side from the same file.
- [ ] C5 — thirteen bound methods; bindings regenerated with `$Call.ByName` and §6.1's two model
      checks verified in the generated output, not assumed; both wildcards added.
- [ ] C6 — the switcher lists and switches; `LeftPanel.vue`, `TreeHost.vue` and `TitleBar.vue` are
      byte-identical; the three existing specs pass unedited.
- [ ] C7 — the variables dialog creates, edits, reorders nothing yet, and deletes; duplicate names are
      marked, not refused.
- [ ] C8 — environments create/rename/delete; exactly one is ever active; deleting the active one
      leaves none active rather than a dangling id.
- [ ] C9 — the mask is not CSS over a present value: with no reveal, the plaintext is not in the DOM,
      not in the store and not in any bound call's payload.
- [ ] C10 — history records on change only, restores through the ordinary write path, and a secret's
      history entry is itself gated; both lists reorder by drag **and** by `Alt+↑`/`Alt+↓`.
- [ ] C11 — stage 1 covers exactly D7's field list; stage 2 runs after `op.SetCommand` and the op log
      records the **unresolved** URL; the warn chip distinguishes unknown from dynamic.
- [ ] C12 — collection-level `variable[]` promotes once; the exporter is the member's only writer; a
      secret exports valueless; `roundtrip_test.go`'s two changed assertions are green with the
      fixture file unedited.
- [ ] C13 — `http-variables.spec.ts`'s five tests, each passing twice in a row; nothing appended to
      `collections.spec.ts` or the mixed parity spec.
- [ ] C14 — `docs/ARCHITECTURE.md` updated (three tables, the new column, the two-column secret split,
      the second reveal caller, the two-stage substitution and its ordering, the export omission).
- [ ] §6.1's full command set green.
- [ ] §6.4's five real-hardware/real-Postman steps — record which were unrunnable here and what was
      done instead, in the same shape P1–P4's checklists took.

---

## 8. Open questions, handed forward

**OQ-1 — Postman's `variable.type: "secret"` is unverified from a first-party source here.** P4's
fetched schema (its F2/F6) documents `variable` as `{key (required), value (untyped), type,
disabled, description}` and does not enumerate `type`'s values. D15 writes and reads `"secret"`
because it is the natural marker and because an unknown `type` is preserved per entry either way, so
the blast radius is bounded: a wrong guess means a Postman import shows the variable as an ordinary
one, with its value already blank (D16). §6.4 step 3 settles it against the real product.

**OQ-2 — Two reveal call sites now exist, and neither can share the other's renderer code.** D8
declines extracting a shared composable because the only directory both `project/**` and `http/**`
may import is `state/`, i.e. a new Studio↔Http shared module created inside the chapter whose stated
goal is removing them. **P12 is the phase that can do it properly**: once the Api module is its own
workspace package, the honest answer is either a genuinely shared `useReveal()` in a package both
depend on, or two deliberate copies with a comment each. Recorded so P12 finds it rather than
discovers it.

**OQ-3 — One-pass resolution means a variable cannot reference another variable.** D17 chose a single
pass because recursion needs a cycle detector and a depth cap for a capability nobody asked for.
Postman itself does resolve nested references, so a user migrating a collection that relies on
`{{baseUrl}}` being defined as `{{scheme}}://{{host}}` will see it not work. The contained fix is a
bounded loop (resolve, re-scan, stop after N passes or when nothing changed) with a visited set for
cycle detection, in `substitute.ts` and `resolve.go` together, pinned by new corpus cases. Worth doing
the first time someone hits it; not worth guessing the depth cap in advance.

**OQ-4 — A second window's environment selection and variables list go stale.** Exactly P4 §8 OQ-4's
shape, with the same known fix (an `Emitter` broadcast — `appcore/deps.go:23-27` — subscribed to in
`http/state/variables.ts`, mirroring `state/connections.ts`'s `onConnectionsChanged`) and the same
reason for not building it: it is a whole new event channel, and multi-window Http is not a workflow
anyone has asked for. When one of these two is built, both should be, in one pass.

**OQ-5 — A variable has no `enabled` checkbox.** Postman has one, and "keep the row, stop it
resolving" is a real workflow (toggling between a staging and a production `baseUrl` inside one
scope). Left out because the SPEC's P5 row does not list it and a column nothing writes is worse than
no column. Adding it later is one migration line, one field in three mirrors, one checkbox, and one
filter in the resolver's value map — and it should be added at the same time as OQ-6's environment
duplication, since both are about managing several near-identical sets.

**OQ-6 — There is no environment import, export or duplicate.** `.postman_environment.json` is a
different top-level format (P4 §0.2) and nothing in the SPEC asks for it. *Duplicate environment* is
the cheaper and probably more useful half — copying N rows within one transaction — and is the
natural companion to OQ-5.

**OQ-7 — A local file path is not substitutable** (D7). The argument for reconsidering: a form-data
upload whose file lives under a per-machine directory is exactly the case a variable solves, and
`{{uploadDir}}/report.csv` is a real Postman idiom. The argument against, which is why it is not
here: the path this app stores comes from a native picker and is `os.Stat`-checked at send
(`httpclient/body.go:156-180`), so a substituted path would be validated for the first time inside
the request, with a failure message naming a string the user never typed. If it is built, the picker
needs a "type a path" affordance beside it and the row needs to show the resolved path — a
`BinaryBodyPicker`/`FormDataTable` change, not a resolver change.

**OQ-8 — A per-mode left-panel width, re-handed unchanged.** P1 §8 OQ-1 deferred it *"until there is
real content to size"*; P4 §8 OQ-7 re-deferred it and named *"P5's variables table"* as the likely
trigger. D11 put that table in a dialog rather than the panel, so the trigger did not fire and the
answer is still *not yet*, for P4's own stated cost (a `layoutSchema` entry, a `LayoutPatch` branch, a
Go model field and a broadcast). Re-handed to whichever phase first makes the panel show something
genuinely wide — P11's gRPC service/method browser is now the better candidate.

**OQ-9 — Export omits secret values, with no way to include them** (D16). The missing feature is an
*"include secret values"* choice on export, which needs a decision this phase declined to take
unilaterally: writing a decrypted credential to a user-chosen path is itself a reveal (D9's line), so
it would need the gate, a prominent warning, and probably a different default file name. Worth
building the first time someone needs to hand a working environment to a colleague — and it should be
built alongside OQ-6's environment export, since that is the same act.

**OQ-10 — Nothing shows a request's *resolved* form before it is sent.** D16 gives a count of
unresolved references and their names; it does not show the URL as it will actually go out. A hover
preview on the URL field is cheap (`substitute.ts` is already imported there) and would make a
mis-scoped variable obvious at a glance — but it is also the one surface where a *secret* would be
shown, which makes it a reveal (D9) and therefore not free. P7's *Copy as curl* hits exactly the same
wall (D21) and the two should be settled together, with the gate.

---

### Critical files for implementation

- `/home/user/kira-studio/apps/kira-studio/internal/httpvars/resolve.go` *(new — D6's stage 2 and D17's grammar, the centre of the phase)*
- `/home/user/kira-studio/apps/kira-studio/frontend/src/http/substitute.ts` *(new — the same grammar, the side P6 and P7 extend)*
- `/home/user/kira-studio/apps/kira-studio/internal/bridge/http.go` *(the ordering F3 makes load-bearing: `SetCommand` before resolution, always)*
- `/home/user/kira-studio/apps/kira-studio/internal/storage/repos/variables.go` *(new — D4/D5's projection is the security guarantee, and D13's history arithmetic)*
- `/home/user/kira-studio/apps/kira-studio/internal/localauth/localauth.go` *(read, called, and not changed — D8)*
- `/home/user/kira-studio/apps/kira-studio/frontend/src/project/ConnectionDialog.vue` *(`requestReveal`, `:227-248` — the pattern to copy, not the code to import)*
- `/home/user/kira-studio/apps/kira-studio/internal/postman/write.go` *(where `variable` becomes the fourth owned member — P4 D9's contract, closed)*
