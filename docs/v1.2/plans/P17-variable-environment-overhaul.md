# P17 — variable/environment management overhaul, Faker scoping, and value pipes

> **What this phase is.** `docs/v1.2/SPEC.md`'s P17 row: a third user-driven batch, and the first
> in this chapter that is mostly new capability rather than polish. Eight items, listed in §0.1.
>
> **The SPEC row hands this file three questions by name**, and this plan answers all three
> concretely rather than deferring them to the implementer:
>
> 1. *Where a piped/transformed secret's masking replacer registers the **transformed** form.*
>    §5 is the whole answer, and D9 is the mechanism: `apivars.Resolver` stops recording
>    `name → plaintext` and starts recording *the exact text it actually wrote* per distinct
>    `(name, pipeline)` pair, so `bridge/http.go`'s `secretReplacer` masks the base64 (or
>    upper-cased, or URL-encoded) form of a secret exactly as P14 round 2 taught it to mask the
>    `QueryEscape`/`PathEscape` forms. A naive implementation reopens that exact bug class, silently.
> 2. *Whether a pipe applies before or after per-occurrence dynamic-value generation.* **After** —
>    D8, with the reasoning and the corpus case that pins it.
> 3. *The exact shape of the `fake.` re-namespacing.* D12: the `fake.` namespace is **additive and
>    permanent alongside** Postman's `$name` spellings, which are not migrated, not deprecated in
>    storage, and never rewritten in a stored request — because they are the import/export contract
>    with Postman (P6 D4), not a legacy spelling this app is free to retire. There is no data
>    migration, by design, and D12 states what would break if there were one.
>
> **The pipe item is this phase's real architectural risk, and it is deliberately its spine.**
> `packages/api-core/src/http/substitute.ts:1-13` states *"one pass, no expression language, no
> nesting"* as a load-bearing decision (P5 D1/D17), and P5's secret-masking, P6's per-occurrence
> freshness and P9/P10/P14's masking-at-every-encoding-surface fixes all rest on it. D6 reopens that
> decision **narrowly and explicitly**: the `{{`…`}}` *scan* does not change by one character; what
> changes is how the already-extracted text between the delimiters is read. That distinction is the
> whole safety argument and §0.3 spells it out.
>
> **Base commit.** Read against `d136764` (branch `claude/feature-v1-2`), i.e. P16 landed and its
> checklist closed. Every file:line citation points at that commit.
>
> **The precedents this matches.** `docs/v1.2/plans/P15b-request-builder-editor-behavior.md`
> (extending the substitution surface additively, with the shared Go/TS corpus as the guard),
> `docs/v1.2/plans/P16-sql-grid-consistency-search.md` (a multi-scope user-driven batch, and its §5
> "the masking analysis this phase owes" section, which §5 here is the direct descendant of), and
> `docs/v1.2/plans/P5-collection-variables-environments.md` (the storage model every item here
> extends).

---

## 0. Scope

### 0.1 The eight items, and where each lands

| # | Item (SPEC row wording) | Decisions | Commits |
|---|---|---|---|
| 1 | The method select restyled to the app's own design system and colour-coded per HTTP method | D18, D19 | R13 |
| 2 | A Description field on variable/environment entries (and any other configurable field the investigation finds it belongs on) | D14, D15 | R6 |
| 3 | Editing a variable set or an environment opens as its own tab rather than a dialog | D16 | R10 |
| 4 | Environments can be cloned | D17 | R7 |
| 5 | A bulk-edit mode through a `.env`-format text editor, applied as a diff | D3, D4, D5 | R8, R9, R11 |
| 6 | Faker autocomplete, re-scoped under a `fake.`-style namespace | D12, D13 | R4, R5 |
| 7 | A pipe/transform syntax for variables, environments and dynamic values alike | D6, D7, D8, D9, D10, D11 | R1, R2, R3, R5 |
| 8 | One panel, from any request tab, showing the environment's and the collection's variables together | D20 | R12 |

### 0.2 Files this phase touches

**`packages/api-core`**

| File | Items |
|---|---|
| `src/http/substitute.ts` | 7 (the name→name+pipeline parse; `parseReference`; `applyPipeline` wiring), 6 (`fake.` in the dynamic branch) |
| `src/http/transforms.ts` *(new)* | 7 (the six-transform closed vocabulary) |
| `src/http/dotenv.ts` *(new)* | 5 (parse / serialize / reconcile) |
| `src/http/dynamic/catalog.ts` | 6 (`FAKE_NAMES`, `ALIAS_TO_FAKE`, `isDynamicReference`) |
| `src/http/dynamic/generators.ts` | 6 (`Record<FakeName, …>` replaces `Record<DynamicName, …>`) |
| `src/index.ts` | exports for all of the above |
| `test/http-substitution.spec.ts`, `test/http-dotenv.spec.ts` *(new)*, `test/go-ts-api-parity.spec.ts` | §4 |

**Go (`apps/kira-studio/internal`)**

| File | Items |
|---|---|
| `apivars/transforms.go` *(new)* | 7 (the Go twin of the transform vocabulary) |
| `apivars/resolve.go` | 7 (pipeline parse; `Resolver.Used()` becomes `[]UsedSecret`; `\|` joins the URL-unsafe set), 6 (`fake.` prefix) |
| `apivars/testdata/substitution.json` | 6, 7 (new corpus cases) |
| `apivars/resolve_test.go` | §4 |
| `bridge/http.go` | 7 (`secretReplacer`/`maskSecrets`/`maskSendErrTimeline` over `[]UsedSecret`) |
| `bridge/grpc.go` | 7 (the second `secretReplacer` consumer) |
| `bridge/variables.go` | 2, 4, 5 (Description on Upsert; `CloneEnvironment`; `ApplyBulk`) |
| `storage/migrations/0011_p17_variable_description.sql` *(new)*, `migrations/embed.go` | 2 |
| `storage/model/variables.go` | 2 |
| `storage/model/tabs.go` | 3 (`RenderableTabKinds` gains `variable-set`) |
| `storage/repos/variables.go` | 2, 4, 5 (`Description`; `CloneEnvironment`; `ApplyBulk`) |
| `postman/collection.go`, `postman/parse.go`, `postman/write.go` | 2 (a variable's `description` stops being dropped on round-trip) |

**`packages/shared`**

| File | Items |
|---|---|
| `domain/variables.ts` | 2 (`description` on `ApiVariable`/`ApiEnvironment`), 5 (`ApiVariableBulkEntry`/`ApiVariableBulkResult`) |
| `domain/tabs.ts` | 3 (`variable-set` in four vocabularies + its state schema) |
| `domain/http.ts` | 1 (`httpMethodToken` replaces `httpMethodClass`) |

**Frontend (`apps/kira-studio/frontend/src`)**

| File | Items |
|---|---|
| `theme/tokens.css` | 1 (eight `--kira-method-*` aliases) |
| `theme/primitives.css` | 1 (`.p-method` family) |
| `theme/primitives/AutocompleteField.vue`, `theme/primitives/completion.ts` | 6, 7 (`candidates` may be a function of the token; `templateToken` knows about `\|`) |
| `state/tabKinds.ts`, `workbench/tabViews.ts` | 3 |
| `api/state/variables.ts` | 2, 3, 4, 5, 8 |
| `api/tabs.ts` | 3 (`openVariableSetTab`, `renameVariableSetTabs`) |
| `api/VariableSetView.vue` *(new — replaces `VariablesDialog.vue`)* | 2, 3, 5 |
| `api/VariableRow.vue` | 2 (a description cell) |
| `api/BulkVariablesEditor.vue` *(new)* | 5 |
| `api/EnvironmentsDialog.vue` | 2, 3, 4 |
| `api/VariablesOverviewPanel.vue` *(new)* | 8 |
| `api/DynamicValuesDialog.vue` | 6 |
| `api/ApiDialogs.vue`, `api/CollectionsPanel.vue`, `api/CollectionsTree.vue`, `api/menus.ts` | 3 (call sites move from dialog to tab) |
| `api/MethodSelect.vue` *(new)*, `api/CollectionRow.vue` | 1 |
| `views/httprequest/HttpRequestView.vue`, `views/httprequest/ResponseHistoryList.vue` | 1, 8 |
| `views/httprequest/variableCompletion.ts` | 6, 7 |
| `views/grpcrequest/GrpcRequestView.vue` | 8 |
| `apps/kira-studio/tests/ui/*`, `tests/unit/*` | §4 |

### 0.3 Why the pipe item is the phase's spine, and why it does not reopen what P5 D1 closed

`substitute.ts`'s own doc comment (`:1-13`) declines *a template engine* — handlebars/mustache, a
path-expression grammar, HTML escaping, "render or fail". Every one of those reasons still holds
and nothing here touches them. What P5 D17 actually built is two things stacked:

1. **a scan** — find `{{`, find the next `}}`, no nesting, one pass (`substitute.ts:87-136`,
   `resolve.go:77-113`, `splitTemplateSpans:191-219`); and
2. **a name read** — `text.slice(open + 2, close).trim()` (`substitute.ts:99`, `resolve.go:91`),
   followed by a four-branch classification (`classifyReference:65-74`).

**This phase changes (2) and does not touch (1).** The scan's byte-level behaviour — where a span
starts, where it ends, what happens to an unterminated `{{`, what `{{a{{b}}}}` means, that a
resolved value is never re-scanned — is bit-for-bit identical after D6. Every property the later
phases were built on survives by construction:

- **P5 D6's two-stage split** (renderer resolves non-secrets, Go resolves secrets after
  `op.SetCommand`) is untouched: a deferred span is still emitted verbatim, pipeline text included,
  so Go's stage 2 still finds it by an exact byte match (D7).
- **P6 D3's per-occurrence freshness** is untouched: `dynamic?.(name)` is still called once per
  occurrence, at the same point in the same walk, and the transform is applied to its return value
  (D8).
- **P14 round 2's finding 6** (`sanitizeUrlSpan`) still applies to exactly the same two kinds and
  never to `deferred`; its character table grows one entry (D11).
- **P9/P10/P14's masking** is the one thing that genuinely does *not* survive unchanged, and §5 is
  the analysis and the fix.

The single-pass property that would be dangerous to lose is *"a substituted value is never
re-scanned for `{{`"*. A transform output is likewise never re-scanned: `applyPipeline` returns a
string that is appended to `out` and the walk continues past `close + 2` (D6). A transform cannot
introduce a reference, because nothing looks at its output again.

### 0.4 Out of scope, explicitly

- **Transform *arguments*.** `{{name | truncate:20}}`, `{{name | replace:a:b}}`, `{{$randomInt(1,9)}}`
  (P6 D10's own declined argument syntax) — all out. The vocabulary is six zero-argument transforms
  (D7). The moment a transform takes an argument, quoting rules follow, and quoting rules are an
  expression language. OQ-2.
- **Nested or conditional references**, `{{a || b}}` defaults, arithmetic — none of it.
- **A new reveal surface for secrets.** The overview panel (D20) shows *that* a name is secret and
  never offers a reveal; the bulk editor (D3) can neither read nor write a secret's plaintext by
  construction. P14's whole finding class was "one more surface that can reveal"; this phase adds
  zero.
- **Rewriting stored `{{$name}}` references.** D12 — there is no migration, deliberately.
- **Per-row `description` on the four request tables** (headers / params / urlencoded / form-data).
  That is P4 §8 OQ-10, and D15 explains why it stays there rather than being folded in here.
- **A `description` on a collection, folder or saved request.** D15.
- **gRPC's own request-builder parity work** — SPEC P18 item 3 owns it. Item 8's panel is mounted
  in `GrpcRequestView.vue` because "reachable from any request tab" says so and the component lives
  in `api/`, which that view already imports (`GrpcRequestView.vue:6`); nothing else about that view
  changes.
- **Environment colour-coding** — SPEC P18 item 5.
- **`enabled` on a variable row.** P5 D12 declined it and nothing in this row asks for it.
- **Anything in Studio mode.** Unlike P16, this batch is Api-only. The one shared-primitive edit is
  `AutocompleteField.vue`/`completion.ts` (D13), whose two Studio call sites must be provably
  unchanged (§4).

---

## 1. Findings

### F1 — The substitution engine is written twice and pinned by one corpus, and both copies read the name in exactly one place

`packages/api-core/src/http/substitute.ts:99` and `internal/apivars/resolve.go:91` are the same
line in two languages:

```ts
const name = text.slice(open + 2, close).trim();
```
```go
name := strings.TrimSpace(text[open+2 : closeAt])
```

`splitTemplateSpans:208` is a third copy of the same expression, and it is the one the highlighter
and the hover walk (`variableCompletion.ts:60-72`). `classifyReference:65-74` is the fourth place
the *name* is interpreted, and P15b D1 already extracted it precisely so those consumers could not
drift.

The corpus (`internal/apivars/testdata/substitution.json`, 138 lines) is read by
`packages/api-core/test/http-substitution.spec.ts:24-32` and `internal/apivars/resolve_test.go:35-48`.
The Go side compares `Refs` field-by-field in a loop (`resolve_test.go:56-70`); the TS side uses
`expect(result.refs).toEqual(c.refs)`. **This matters for D6's wire shape**: a new *optional* field
on a reference, present only when a pipeline exists, leaves every existing corpus case deep-equal on
both sides with no edit to the 138 lines.

### F2 — `Resolver.Used()` returns plaintext keyed by name, and that is exactly what the masking replacer is built from

`resolve.go:219-238`:

```go
func (r *Resolver) text(text string, sanitize func(string) string) string {
	result := resolveWithSanitizer(text, r.secretValues, nil, sanitize)
	for _, ref := range result.Refs {
		if ref.Kind == KindResolved {
			r.used[ref.Name] = r.secretValues[ref.Name]   // ← the PLAINTEXT, by name
		}
	}
	return result.Text
}
```

and `bridge/http.go:152-182` turns that map into the replacer, registering three forms per secret:

| pair | added by | why |
|---|---|---|
| `value → {{name}}` | P9 D6 | the plaintext as it lands in a header or a raw body |
| `url.QueryEscape(value) → {{name}}` | P14 round 1, finding 6 | a urlencoded body's rendered wire text is `QueryEscape`'s output, never the plaintext |
| `url.PathEscape(value) → {{name}}` | P14 round 2, finding 4 | a secret in a URL *path* segment is `PathEscape`'s output, and the two escapers differ (space → `%20` vs `+`) |

The comment above it (`:142-151`) states the property in so many words: a `strings.Replacer` *"can
only over-mask … and never under-mask a surface that carries the secret's own plaintext verbatim —
D6's own stated property, **which does not by itself cover a surface that carries a re-encoded form
instead**"*.

**A pipe is a fourth re-encoding, and it is the first one the user asks for by name.** With
`{{token | base64}}`, the plaintext never appears on the wire at all; `base64(plaintext)` does. All
three registered pairs miss it. The rendered exchange (`Wire.Request`), `FinalURL`,
`Redirects[].URL`, `Timeline.Hops[].URL`, `Hops[].Headers[].Value`, `Hops[].Error` and
`herr.Message` — every surface `maskSecrets`/`maskSendErrTimeline` exist to cover, several of them
persisted to `kira.sqlite` by P8 — would carry a base64-encoded credential with the pane still
claiming *"N secret values shown as `{{name}}`"*. That is finding-6/finding-4's exact shape, one
encoding later. §5 and D9.

There is a second consumer: `bridge/grpc.go:450-458` builds the same replacer from the same
`Used()` (P11 D9/F21's extraction), so any change to the shape is two call sites, not one.

### F3 — The renderer never has a secret's plaintext, so the *only* piped-secret masking risk is Go-side — with one exception, and it is already correct

P5 D5/D6, restated at `substitute.ts:28-31` and `api/state/variables.ts:245-250`: a secret's
plaintext never enters the renderer, which is why `deferred` exists as a kind at all. So stage 1
cannot leak a transformed secret — it never transforms one.

The exception is *Copy as curl* (P7 D10), which deliberately reveals plaintext client-side through
the gate and then calls `applySecretValues(resolved, revealedSecretValues)`
(`api/state/curl.ts:190`), whose body is `resolve(text, secretValues, [])`
(`substituteRequest.ts:63-72`). **That path needs no change**: it is the same engine, so a
`{{token | base64}}` span left literal by stage 1 is transformed by the same `applyPipeline` D6
adds, and the command the user copies carries the same bytes the send would. Recorded because the
obvious worry — "does the curl exporter need its own transform pass?" — has the answer *no, by
construction*, and that is worth stating rather than rediscovering.

`resolveForExport` (`views/httprequest/state.ts:245-248`) dedupes `deferredNames` by `ref.name`,
which stays the **bare** variable name under D6, so its reveal loop and
`findSecretVariableId` (`curl.ts:202-215`) keep working with no edit.

### F4 — `sanitizeUrlSpan`'s character table has no `|`, and a deferred secret whose decrypt fails reaches `url.Parse` through the *unknown* branch

`substitute.ts:146-155` / `resolve.go:50-53` percent-encode space, tab, CR, LF, `&`, `#`, `=` inside
a span that is left literal. `|` is not in the table, and `|` is not a legal URL character
(RFC 3986); Go's `url.Parse` tolerates it in a query today, but the table's stated purpose is
"characters that would otherwise break `url.Parse`'s RawQuery or the request line itself" and a
literal `|` in a request line is exactly that class.

The path that makes this reachable is not obvious and is worth writing down: `Resolver.URLText`
(`resolve.go:215-217`) calls `resolveWithSanitizer(text, r.secretValues, **nil**, sanitize)` — with
`secretNames` nil. A secret whose decrypt failed (a keychain reset, a database copied between
machines — `repos/variables.go:663-667` logs and skips it) is therefore classified `KindUnknown`,
not `KindDeferred`, and *is* sanitized. So a piped secret reference in a URL can reach the sanitizer.
D11.

### F5 — The dynamic catalogue is already namespace-shaped on the Studio side, and Postman's `$name` spellings are an export contract, not a legacy

`packages/api-core/src/http/dynamic/catalog.ts:1-19` is explicit about why the 58 names are spelled
Postman's way: *"Adopting Postman's spellings is what makes a `{{$randomEmail}}` reference imported
from a real Postman collection keep working here, for the same reason it works there (F6)."* And
`internal/postman/write.go:145-161` re-emits a collection's variables from rows on export — but a
`{{$randomEmail}}` reference lives inside a *request's* URL/header/body text, which round-trips
through `origin_json` and the saved-request columns verbatim. **Rewriting `$names` in stored
requests would corrupt the export**: the file would come back out of this app with references
Postman does not recognise.

Meanwhile Studio already has the namespace this phase wants, and it is faker's own:
`views/grid/fakeData/recipes.ts:17-35` is a list of `GeneratorId`s spelled `person.fullName`,
`internet.email`, `location.city`, `lorem.sentence` — the literal faker module.method paths. So
`fake.` + faker's own path is not a new vocabulary to invent; it is the vocabulary this repo
already uses one directory over, prefixed.

`generators.ts:21-…` is a `Record<DynamicName, (f: Faker) => string>`, and `catalog.ts:83-86`
records that the compiler — not a test — proves the two halves exhaustive against each other.
Whatever D12 does must keep that property.

### F6 — Autocomplete for dynamic values already exists; what does not exist is autocomplete *after* a pipe, or a candidate list that varies by position

P15b D3(b)/D4 already ship it: `variableCompletion.ts:110-114` puts every `DYNAMIC_NAMES` entry into
the `candidates` array, `completion.ts`'s `templateToken` opens the popup only inside `{{…}}`, and
`AutocompleteField.vue` ranks and accepts. So SPEC item 6's *"gains autocomplete"* is, for the
`$names`, **already true at the base commit** — what item 6 actually needs is (a) the `fake.` names in
that list, and (b) `DynamicValuesDialog.vue`'s own comment at `:31-32` says it out loud: *"P17 owns
the catalogue's own fake. re-namespacing and autocomplete."*

Two real gaps remain, both created by item 7:

1. **`templateToken` will mis-tokenize a pipeline.** It returns the run between the nearest unclosed
   `{{` and the caret, so at `{{token | b|` the word is `token | b` — no candidate ranks, and
   accepting one would splice over the variable name.
2. **`candidates` is a static array prop.** After a `|` the correct list is the six transforms, not
   the variable names; before it, the reverse. One flat list would offer `base64` as a variable name
   and `baseUrl` as a transform. D13.

### F7 — The two dialogs are 582 lines that already implement, twice, most of what item 3 and item 8 need

`api/VariablesDialog.vue` (332 lines) is the variable table: per-row drafts committed on blur
(`:131-155`), the trailing blank row (`:88-96`), drag + Alt+↑/↓ reorder (`:211-247`), the P16 D14
name-only filter (`:72-106`), duplicate-name marking (`:110-115`), the reveal fold-in (`:61-66`).
`api/EnvironmentsDialog.vue` (250 lines) is the environment list: inline rename (`:57-67`), active
radio, *Edit variables…* (`:73-75`), delete-with-confirm, the same drag/keyboard reorder.

Both are `DialogFrame`-hosted and both are opened from `api/state/variables.ts`'s two `open` flags
(`:71-80`, `:95-115`). Item 3 does **not** need either rewritten — it needs the variables one
re-hosted in a tab view, which is a `<DialogFrame>` → `<ViewChrome>` swap plus moving
`variablesDialogState`'s four fields into tab state. D16.

### F8 — The tab-kind registry is a five-vocabulary change with one silent failure mode, and the app has done it twice already

Adding a kind touches, in order: `packages/shared/domain/tabs.ts`'s `tabKindSchema:8-23`,
`RENDERABLE_TAB_KINDS:30-40`, `TAB_KIND_MODE:49-59` and `tabRecordSchema:191-233`; then
`state/tabKinds.ts`'s `TAB_KINDS:135-285` (nine members, `badge?` optional since P15 D8);
`workbench/tabViews.ts:17-27`; and **`internal/storage/model/tabs.go:26-33`'s `RenderableTabKinds`**,
which `tabs.ts:26-28` names as *"the one of the four kind vocabularies TypeScript's own
exhaustiveness checks can't catch a miss on (D10's parity test)"* — miss it and a restored tab row
is silently dropped. P2 (`http-request`) and P11 D2 (`grpc-request`) are the two worked examples.

`openTab` (`state/tabs.ts:233-239`) takes `(kind, connectionId, path, makeState, {reuse})` and
reuses on `kind + connectionId + path`. P4 F13 records why request tabs pass `reuse: false` and keep
identity in state instead — that reasoning is about a *duplicated* request tab carrying its
original's `path`. A variable-set tab has no duplicate-to-try-a-variant story, so `reuse: true`
against a real path is available here and is the right answer (D16).

### F9 — There is a clone precedent, it is a raw-column copy, and it deliberately never touches the OS key

`internal/connections/service.go:328-350`: read the row, `Name + " copy"`, insert under a fresh
uuid, then `s.deps.Secrets.Copy(id, newID)` with the comment *"P25 D11: a raw column copy, not
decrypt-then-re-encrypt — the plaintext is never used, so there is no reason for this path to need
the OS key at all."* `api_variables.secret_value` holds the same `kira:v2:` AES-256-GCM envelope
(`0007_p5_variables.sql:27-29`), so the identical technique applies verbatim to an environment
clone. D17.

### F10 — Postman carries a `description` on a variable, this app drops it, and P5 said why in one line

`internal/postman/parse.go:76-92` decodes `key`, `value`, `type` and nothing else;
`write.go:145-161` emits `key`, `value`, `type?`. Postman's own schema carries `description` on a
`variable[]` entry, and `roundtrip_test.go:245-252` shows this repo already preserves *object-shaped*
descriptions elsewhere (on items and header rows) through `origin_json`.

P5 D12 (`P5-collection-variables-environments.md:837-839`) declined the field for one reason and one
reason only: *"no `description` (P4 §8 OQ-10 already tracks per-row descriptions as one change across
four tables, and this would be a fifth)"*. That is a sequencing argument, not a design objection —
and the SPEC row now asks for the field directly, for these two tables only. D15 splits the two
halves cleanly: the variable/environment half lands here, the four-request-table half stays in
OQ-10 where it is, unchanged.

`api_collections` has no `description` column either; a Postman collection's own
`info.description` survives untouched inside `origin_json` (`postman/collection.go:62-67`) and this
app has never offered to edit it. D15.

### F11 — Six frontend call sites open the two dialogs, and three specs assert on the method select's *value*

Dialog entry points, all of which item 3 redirects: `CollectionsTree.vue:94` (row menu
*Variables…*), `CollectionsPanel.vue:59`/`:66` (the `api.variables` palette command),
`EnvironmentsDialog.vue:74` (*Edit variables…*), plus `CollectionsPanel.vue:72` /
`CollectionsTree.vue:95` / `EnvironmentSelect.vue:24` for the environments dialog (which stays a
dialog — D16).

The method select's own consumers: `HttpRequestView.vue:308-316` (the control),
`api-ui-consistency.spec.ts:423-430` (its height must equal the URL field's — P16 D6),
`http-raw.spec.ts:213`, `http-request.spec.ts:191`, `collections.spec.ts:130` (all three
`toHaveValue('…')`). D18 names the exact edit those three need and why it is worth paying.

### F12 — The app already draws its own menu where a native `<select>` could not be styled, and named the decision

`views/shared/celleditor/CellEditorView.vue:461-470` renders a `<button class="p-select bordered
format-select">` plus an app-drawn menu, and `:613-617` explains it: *"P42 D27: an app-drawn menu
trigger, not a native `<select>` — border/background/padding/cursor still come from
`.p-select.bordered` (plain CSS, unaffected by the element swap); its own
`appearance:base-select`/`::picker(select)`/`option` rules are select-only and simply don't match a
`<button>`, which is why the chevron below is drawn explicitly instead of relying on one."*

That is exactly item 1's situation: per-option colour is `option`-level styling, which only lands
under `appearance: base-select` (`primitives.css:382`) and only in engines that implement it. The
closed state — the surface that is visible 100% of the time — is plain CSS either way. D18.

### F13 — The method colour map has four families for seven methods, and PUT/PATCH share one

`packages/shared/domain/http.ts:403-414`: `GET/HEAD/OPTIONS → info`, `POST → ok`, `PUT/PATCH → warn`,
`DELETE → err`, everything else `info`. The four families are `.p-chip.{info,ok,warn,err}`
(`primitives.css:549-564`), i.e. the app's *status* palette borrowed for methods (P4 D16).

The SPEC asks for *"GET/POST/PUT/DELETE/PATCH each a distinct colour"*, so PUT and PATCH must
separate — four families cannot express five distinct colours. Meanwhile `tokens.css:103-117`
already carries a twelve-hue palette built for exactly this problem: *"softened to
oklch(0.72 0.09 h): one lightness and one chroma for all eleven hues plus a near-neutral grey, so no
connection shouts louder than another"*. Three consumers read `httpMethodClass` today:
`HttpRequestView.vue:61`, `ResponseHistoryList.vue:162`, `CollectionRow.vue:134`. D19.

### F14 — `.env` has no standard, and the three things a bulk editor can destroy are all metadata this app stores per row

There is no `.env` RFC; dotenv implementations differ on quoting, `export ` prefixes, interpolation
and multi-line values. What *is* fixed is what a `KEY=VALUE` line cannot carry, and each absence maps
to a stored column that a naive round-trip would silently drop:

| Stored per row (`0007_p5_variables.sql:15-36`, plus D14) | Expressible in `KEY=VALUE`? |
|---|---|
| `id` | **no** — and it is what `api_variable_history.variable_id` is FK'd to (`:40-47`) |
| `is_secret` + `secret_value` | **no**, and the plaintext is not in the renderer to write out (F3) |
| `description` (D14) | only as a convention — a comment line |
| `sort_order` | yes, implicitly: line order |
| `name`, `value` | yes |

So the reconcile design's whole job is deciding what happens to the first three. D3/D4/D5, and the
rule that keeps history alive is *match by name, and say plainly that a rename in bulk is a delete
plus an add*.

---

## 2. Decisions

### D1 — Item ordering: the substitution work lands first, alone, and the storage work second

R1→R3 (the pipeline, its Go twin, the masking fix) land before anything else touches
`api/state/variables.ts` or the tab registry. Reason: R3 changes a Go signature four files depend on
(`ResolveRequest`'s fourth return, `Resolver.Used()`, `secretReplacer`, and both bridges), and
merging that with a UI reshuffle in the same window makes the one commit whose correctness is a
security property harder to review in isolation. §3.

### D2 — Two new pure modules in `packages/api-core`, and their Go twins where a twin is required

| Module | Twin | Why a twin, or why not |
|---|---|---|
| `src/http/transforms.ts` | `internal/apivars/transforms.go` | **Required.** Stage 2 resolves a secret in Go and must apply the same pipeline to it. Pinned by the shared corpus, like `resolve` itself. |
| `src/http/dotenv.ts` | none | Bulk edit is a renderer-side authoring format; Go receives a normalized entry list (D5), never `.env` text. No second parser to drift. |

Both modules are pure and DOM-free, which is what makes them unit-testable as plain imports
(`substitute.ts:12-13`'s own stated reason).

### D3 — The pipe grammar: `{{ name | transform | transform }}`, parsed inside the name, not by the scanner (item 7)

One new exported function in `substitute.ts`, and the two `.trim()` call sites (`:99` and `:208`)
start calling it:

```ts
export interface ParsedReference {
  /** The bare reference name — what classifyReference, the hover, the reveal loop and Go's
   *  stage 2 all key on. Unchanged from today for a reference with no pipeline. */
  name: string;
  /** The transform names, left to right. Empty for today's references — which is what keeps
   *  every existing corpus case, every stored request and every Postman import byte-identical. */
  pipeline: readonly TransformName[];
  /** The normalized span text `{{name | a | b}}` — one space either side of each `|`,
   *  regardless of how it was typed. The masking placeholder (D9) and nothing else. */
  normalized: string;
}

export function parseReference(inner: string): ParsedReference;
```

The rules, in full:

1. `inner` is the already-extracted, already-trimmed text between `{{` and `}}` — **the scanner is
   not consulted and does not change** (§0.3).
2. If `inner` contains no `|`, the result is `{name: inner, pipeline: [], normalized: '{{'+inner+'}}'}`.
   This is today's behaviour, reached by a `indexOf('|') === -1` fast path, so the common case pays
   one `indexOf` over a short string.
3. Otherwise split on `|`, trim each segment. **If every segment after the first is a member of the
   closed transform vocabulary (D7), and the first segment is non-empty**, the parse succeeds.
4. **Otherwise the whole of `inner` is the name, exactly as today** — pipeline empty. This is the
   backward-compatibility rule, and it is deliberately "all or nothing": a variable legitimately
   named `a|b` (Postman permits arbitrary names — `substitute.ts:5-6`) keeps resolving, and a typo'd
   `{{token | base46}}` becomes an `unknown` reference named `token | base46`, which the live chip
   already reports, the highlighter already paints `.cm-kira-var-unknown`, and the hover can name
   precisely (D13).
5. An empty name after a pipeline split (`{{ | upper}}`) fails rule 3 and falls to rule 4, which
   then hits `resolve`'s existing *"an empty name is not a reference"* branch only if `inner` itself
   is empty — `{{ | upper}}` is a non-empty name that resolves to nothing, i.e. `unknown`. Corpus
   case.

Go's `apivars.ParseReference` is the same function, same rules, pinned by the same corpus.

**Why not a separate delimiter** (`{{name::base64}}`, `{{name!base64}}`): `|` is the pipe every
comparable tool uses (Jinja, Liquid, Vue filters, shell), it is the character a user will try first,
and rule 4 makes its collision risk with real names precisely zero.

### D4 — `Reference` grows an optional pipeline, and nothing else about the reported shape changes

```ts
export interface Reference {
  name: string;              // still the BARE name
  kind: ReferenceKind;       // still the same four
  pipeline?: readonly TransformName[];  // present only when non-empty
}
```

`pipeline` is **omitted, not `undefined`**, when empty — which is what keeps
`expect(result.refs).toEqual(c.refs)` (F1) passing against all 138 corpus lines with no edit. Go's
`Reference` gains `Pipeline []string` (nil for today's cases, and `resolve_test.go`'s field-by-field
loop is extended to compare it).

**`name` stays bare** so that every existing consumer keeps working with no edit: the unresolved-count
chip's dedupe (`HttpRequestView.vue:171-177`), `resolveForExport`'s `deferredNames`
(`state.ts:245-248`), `curl.ts`'s `findSecretVariableId:202-215`, and Go's `Names()`
(`resolve.go:120-144`) — which becomes `ParseReference(inner).name`, so a pre-send "does this field
reference anything" check counts `{{token | base64}}` as referencing `token`.

### D5 — Kind classification is unchanged; a failing transform is the only new way to be `unknown`

`classifyReference(name, values, secretNames)` keeps its exact four-branch order (P15b D1) and is
called with the **bare** name. The pipeline does not participate in classification: `{{token |
base64}}` is `deferred` if `token` is a secret, `resolved` if it is a value, `dynamic` if it starts
with `$` or `fake.` (D12), `unknown` otherwise — the same as `{{token}}`.

What *is* new: **applying the pipeline can fail** (invalid base64 in `base64decode`, a malformed
percent-escape in `urldecode`). The rule, in both languages:

> A transform that cannot be applied leaves the **entire span verbatim** and classifies the
> reference `unknown`. Nothing is emitted half-transformed, nothing becomes the empty string, and
> nothing throws.

Rationale, in order of weight: (a) it matches the module's standing posture — *"this package never
fails a caller over one unresolved reference (D10), the server's own response is the honest signal"*
(`resolve.go:203-206`); (b) silently emitting `""` for a failed `base64decode` of a **secret** would
send an empty credential and look like an auth bug, not a template bug; (c) `unknown` is already
wired end to end — the chip counts it, the highlighter paints it, `sanitizeUrlSpan` sanitizes it.

Go-side consequence worth stating: a secret whose transform fails is **not** recorded in
`Resolver.Used()` (nothing was written, so there is nothing to mask), which falls out of D9's design
rather than needing a special case.

### D6 — Where the transform runs: one line in each engine, at the point the value is already final

In `resolve` (`substitute.ts:87-136`) and `resolveWithSanitizer` (`resolve.go:77-113`), each of the
three value-producing branches gains the same wrapper:

| branch | today | after |
|---|---|---|
| `dynamic`, generator returned a value | `out += generated` | `out += apply(pipeline, generated)` |
| `resolved` | `out += values[name]` | `out += apply(pipeline, values[name])` |
| `deferred` | `out += span` | `out += span` — **unchanged**, pipeline text included |
| `dynamic` uncatalogued, `unknown` | `out += sanitize?(span) ?? span` | unchanged |

`apply` returns `null` on failure, and the branch then falls through to the `unknown` path (D5).

The `deferred` row is the load-bearing one: stage 1 emits `{{token | base64}}` **byte-for-byte as
typed** (not normalized — normalization is only for the masking placeholder, D9), so Go's stage 2
finds it with the same scan, parses the same pipeline and applies it to the decrypted plaintext.
`substitute.ts:122-127`'s existing comment — *"Never sanitized: a downstream pass (Go's
apivars.Resolve) still has to find this span by its exact, untouched name"* — is extended to say
"…name and pipeline".

### D7 — Six transforms, closed, zero-argument, and byte-identical across the two languages (item 7)

| name | TS | Go | notes |
|---|---|---|---|
| `base64` | `btoa` over `new TextEncoder().encode(s)` bytes | `base64.StdEncoding.EncodeToString([]byte(s))` | **Not bare `btoa(s)`** — `btoa` throws on any code point > 255, so a non-ASCII value would throw where Go happily encodes. Standard alphabet, padded, both sides. |
| `base64decode` | decode → `TextDecoder('utf-8', {fatal: true})` | `base64.StdEncoding.DecodeString` + `utf8.Valid` | Invalid base64 **or** invalid UTF-8 ⇒ failure (D5). `fatal: true` is what makes the two agree; the default decoder substitutes U+FFFD and would disagree with Go. |
| `upper` | `s.toUpperCase()` | `strings.ToUpper(s)` | Both are Unicode-aware; the locale-sensitive triples (Turkish dotted I) differ between `toUpperCase` and `strings.ToUpper` only under a locale-aware variant neither uses. Named in §4 as an untested edge. |
| `lower` | `s.toLowerCase()` | `strings.ToLower(s)` | same |
| `urlencode` | `goQueryEscape`'s own `escapeLiteral` (`escape.ts:10-15`), exported as `goQueryEscapeLiteral` | `url.QueryEscape(s)` | **This repo already owns a byte-for-byte match of Go's `QueryEscape` in TypeScript** (P12 D7/P9 F16) — reusing it is the whole reason this transform is cheap to get right. Space → `+`. |
| `urldecode` | the inverse of the above (`+` → space, then `decodeURIComponent`) | `url.QueryUnescape(s)` | A malformed `%` escape ⇒ failure (D5), matching `QueryUnescape`'s own error. |

`urlencode`'s space handling is a genuine choice: `QueryEscape` gives `+`, `PathEscape` gives `%20`.
**Query semantics wins** because it matches the escaper this repo already ships on both sides, and
because a value piped through `urlencode` is overwhelmingly headed for a query string. The
catalogue's own description says so, and the hover repeats it (D13) together with the warning that
matters:

> the query builder already escapes a param's value — use this when embedding a value inside
> *another* encoding (a JSON string, a nested URL), not for a plain `?a={{x}}`

**Why exactly six**: the SPEC row names base64 encode/decode, upper/lower and URL encode/decode.
Adding `trim`, `json`, `sha256`, `hmac` etc. is one line each and zero of them are asked for; a
closed vocabulary is what makes D3 rule 4 safe (an unknown segment must be recognisably not a
transform) and what keeps Go/TS parity a finite claim. OQ-2.

### D8 — A pipe applies **after** per-occurrence dynamic-value generation (the SPEC's second question)

`{{fake.string.uuid | upper}}` generates a fresh UUID for this occurrence and then upper-cases it.
Two such references in one request produce two different upper-cased UUIDs.

- **It is the only order that means anything.** A transform is a function on a string; a generator is
  not a string. "Apply base64 to the generator, then generate" has no referent.
- **P6 D3's freshness is untouched by construction.** The generator callback is still invoked once
  per occurrence at the same point in the same walk (`substitute.ts:112`); D6 wraps its *return
  value*. Nothing about `dynamic?.(name)`'s call count, position or arguments changes.
- **P6 D7's short-circuit is untouched.** `send()` (`views/httprequest/state.ts:164-167`) still runs
  a first pass with three arguments and only loads the generators chunk when a `dynamic` ref was
  found. A pipeline does not make a reference dynamic; the bare name does.
- Corpus/unit case, pinned: `resolve('{{$guid | upper}}/{{$guid | upper}}', …, () => String(n++))`
  produces two distinct values, both upper-cased.

### D9 — The masking replacer registers the form that actually reached the wire, per distinct `(name, pipeline)` (the SPEC's first question)

This is the phase's security decision. §5 is the full analysis; the mechanism is:

**(a) `Resolver` records rendered text, not plaintext.**

```go
// UsedSecret is one substituted secret span: the text actually written into the request, and the
// placeholder it is masked back to. Rendered is a secret's plaintext ONLY when the span carried no
// pipeline — with one, it is the transformed form, which is exactly as sensitive.
type UsedSecret struct {
	Name        string // for the Debug log (names only, D5) and the distinct-secret count
	Rendered    string
	Placeholder string // ParseReference's `normalized`: "{{name}}" or "{{name | base64}}"
}

func (r *Resolver) Used() []UsedSecret   // was: map[string]string
```

**(b) The rendered text reaches the resolver through a callback, never through `Reference`.**
`resolveWithSanitizer` gains an optional `onResolved func(ref Reference, rendered string)`, invoked
for the `KindResolved` branch only. `Reference` is a struct whose entire purpose is to be *reported*
— putting a secret's rendered plaintext on it would be one refactor away from being marshalled to
the renderer or logged. The callback is used by exactly one caller (`Resolver.text`), which is
already the one place holding decrypted values.

**(c) `secretReplacer` takes `[]UsedSecret` and registers three pairs per entry** — the same three
P14 arrived at, keyed on `Rendered` instead of the plaintext:

```
Rendered                    → Placeholder
url.QueryEscape(Rendered)   → Placeholder   (if different)
url.PathEscape(Rendered)    → Placeholder   (if different)
```

**(d) Entries are per distinct `(Name, Placeholder)` pair, not per name.** A request using both
`{{token}}` and `{{token | base64}}` produces two entries, so *both* wire forms are masked. This is
the property that makes the fix complete rather than a shift: today's model has one form per secret
and cannot represent two.

**(e) `Wire.MaskedSecrets` counts distinct `Name`s**, not entries — the pane's caption means "how
many secrets were masked", and two spellings of one secret is still one secret.

**(f) Ordering.** `strings.NewReplacer` matches at each position by the earliest-listed pattern that
matches, so a longer rendered form that *contains* a shorter one must be listed first. Entries are
sorted by `len(Rendered)` descending before the replacer is built. This is not hypothetical:
`base64("secret")` and `"secret"` share no prefix, but `upper("abc")` = `ABC` and a second secret
whose plaintext is `AB` would. Cheap, total, stated.

Every downstream surface is then covered with **no further edit**, because they all go through
`secretReplacer`: `Wire.Request`, `Timeline.Hops[].URL`/`.Headers[].Value`/`.Error`, `Redirects[].URL`,
`FinalURL`, `herr.Message` (`bridge/http.go:185-260`) and gRPC's own consumer
(`bridge/grpc.go:450-458`).

### D10 — `ResolveRequest`'s fourth return changes shape, and both bridges change with it

`ResolveRequest` (`resolve.go:255-322`) returns `(url, headers, body, map[string]string, error)`
today. It becomes `(…, []UsedSecret, error)`. Two callers, both updated in the same commit
(`bridge/http.go`, `bridge/grpc.go`). The Debug log (`:313-319`) keeps logging **names only** — the
count is `len(distinct names)`, the list is those names, and `Rendered` is never logged, which is
`connections.Service.Reveal`'s own *"the subject, not the secret"* rule (P5 D5) applied to a struct
that now holds a second sensitive field.

### D11 — `|` joins the URL-unsafe set, in both implementations (F4)

`URL_UNSAFE_PATTERN`/`URL_UNSAFE_ENCODED` (`substitute.ts:146-155`) and `urlUnsafeReplacer`
(`resolve.go:50-53`) gain `'|' → '%7C'`. It applies to exactly the two kinds it already applied to
(`unknown`, uncatalogued `dynamic`) and never to `deferred` — so a piped secret still reaches Go's
stage 2 with its `|` intact, while a piped reference to a name that will never resolve (including a
secret whose decrypt failed, which arrives as `KindUnknown` via `URLText` — F4) cannot put a raw `|`
into a request line. Corpus case on both sides.

### D12 — `fake.` is additive and permanent beside `$name`; there is no migration, deliberately (item 6, the SPEC's third question)

**The shape.** A second spelling of the same catalogue, using faker's own module.method paths —
which is the vocabulary `views/grid/fakeData/recipes.ts:17-35` already uses one directory over (F5):

```
{{fake.person.fullName}}   {{fake.internet.email}}   {{fake.string.uuid}}
{{fake.location.city}}     {{fake.lorem.sentence}}   {{fake.number.int}}
```

**The structure that keeps one generator per capability** (F5's compile-time exhaustiveness must
survive):

```ts
export const FAKE_NAMES = ['fake.string.uuid', 'fake.internet.email', …] as const;
export type FakeName = (typeof FAKE_NAMES)[number];

/** Postman's spellings, kept verbatim and permanently (P6 D4) — each mapped onto the fake. name
 *  that produces it. Several $names share one: $guid and $randomUUID are both fake.string.uuid. */
export const ALIAS_TO_FAKE: Record<DynamicName, FakeName> = { … };

// generators.ts
export const GENERATORS: Record<FakeName, (f: Faker) => string> = { … };
```

`DYNAMIC_NAMES` is untouched; `generate(name)` resolves an alias through `ALIAS_TO_FAKE` first.
The two `Record<…>` types keep F5's guarantee: a `FAKE_NAMES` entry with no generator, or a
`DynamicName` with no alias, is a `tsc` error rather than something a test must catch.

**The classification branch** becomes one shared predicate, in both languages:

```ts
export function isDynamicReference(name: string): boolean {
  return name.startsWith('$') || name.startsWith('fake.');
}
```

used by `classifyReference` (replacing `name.startsWith('$')`, `substitute.ts:70`) and by
`resolve.go:98`'s `strings.HasPrefix(name, "$")`. Corpus cases pin both.

**There is no migration, and this is the decision, not an omission.** Nothing rewrites a stored
`{{$randomEmail}}`, in a request, a collection, an environment, `origin_json`, or history. Three
reasons, in order:

1. **It would corrupt Postman export.** A `$name` inside a request's URL/header/body is written back
   out by `postman/write.go` as part of that request's text. Rewriting it to `fake.internet.email`
   produces a file whose references Postman does not resolve — breaking the interop P6 D4 chose
   Postman's spellings for in the first place. This alone settles it.
2. **A rewrite would have to be a text migration over five columns** (`api_items.request_json`,
   `api_collections.origin_json`, `api_variables.value`, `api_response_history`'s request columns,
   `api_variables.secret_value` — which is ciphertext and therefore *cannot* be rewritten without
   the OS key). A partial rewrite is worse than none.
3. **`$names` are not deprecated, they are aliases.** `DynamicValuesDialog` lists both (R4), the
   completion list offers `fake.` names first and `$` names under a `postman alias` detail (D13),
   and `substitution.json` keeps every existing `$` case.

**What breaks without the alias layer** (the SPEC asks the question, so it is answered explicitly):
every imported Postman collection's `{{$randomInt}}`, `{{$guid}}`, `{{$timestamp}}` reference stops
resolving and starts rendering as literal text in real requests, silently, on the next send.

**The two clock values.** `$timestamp` and `$isoTimestamp` read the clock, not the RNG (P6 D9), and
faker has no path for them. They are still given `fake.` spellings — `fake.date.timestamp` and
`fake.date.iso` — because that is where a user will look for them, with the catalogue's comment
stating plainly that these two are the namespace's only non-faker entries. The alternative (leaving
them `$`-only) makes the new namespace incomplete in exactly the way a user notices first.

**Collision.** A *variable* literally named `fake.something` is newly shadowed by the dynamic branch,
exactly as a variable named `$foo` already is. Vanishing likelihood, already-flagged behaviour
(`classifyReference`'s branch order is a documented precedence), and the live chip reports it as an
unknown dynamic value rather than failing silently. OQ-5.

### D13 — Completion becomes position-aware, through one union-typed prop on `AutocompleteField` (items 6 and 7)

Two changes, both additive, both leaving the two Studio call sites (`FilterToolbar`'s WHERE/ORDER BY)
byte-identical:

**(a) `completion.ts`'s `templateToken` learns about `|`.** Inside `{{…}}`, if the run from the
opening `{{` to the caret contains a `|`, the token starts after the **last** `|` plus any
whitespace. So at `{{token | b`, the word is `b` with `from` pointing at the `b` — which is what
makes `accept` splice correctly (it already replaces `wordStart`→caret).

**(b) `candidates` may be a function.**

```ts
candidates?: readonly Completion[] | ((ctx: { text: string; from: number; word: string }) => readonly Completion[]);
```

Array call sites are unaffected. `variableSupport` (`views/httprequest/variableCompletion.ts:56-121`)
returns the function form:

| caret position | list |
|---|---|
| inside `{{…}}`, before any `\|` | variables (`detail: 'variable'` / `'secret'`), then `fake.*` (`detail: 'dynamic'`), then `$…` (`detail: 'postman alias'`) |
| inside `{{…}}`, after a `\|` | the six transforms (`detail: 'transform'`), each with the one-line description D7's table carries |

`icon` stays `'symbol-variable'` for names and becomes `'symbol-method'` for a transform — both
already in `theme/icons.ts`'s set.

**(c) The hover gains two lines** (`hoverAt`, `variableCompletion.ts:69-100`), which is where D3's
rule-4 fallback becomes legible rather than mysterious:

| case | lines |
|---|---|
| a reference with a pipeline | the existing kind line, plus `→ base64 → upper` naming the chain in order |
| a `resolved` reference with a pipeline | the **transformed** value, truncated at 200 — the renderer has the plaintext for a non-secret, so showing the piped result is both possible and more useful than showing the input |
| a `deferred` reference with a pipeline | `secret — base64-encoded when the request is sent`; **never a value**, transformed or not (P15b §4's security assertion, extended) |
| a name that *looks* piped but did not parse (D3 rule 4) | `not defined in this collection or environment` plus `“base46” is not a transform — try base64, base64decode, upper, lower, urlencode, urldecode` |

### D14 — `description` is a column on both tables, empty-string-defaulted, and absent from history (item 2)

```sql
-- 0011_p17_variable_description.sql
ALTER TABLE api_variables    ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE api_environments ADD COLUMN description TEXT NOT NULL DEFAULT '';
```

`NOT NULL DEFAULT ''` rather than nullable: `model.Variable.Description string` then has no
three-state to represent, and SQLite's `ALTER TABLE ADD COLUMN` with a non-null default is a metadata
change, not a table rewrite. Registered in `migrations/embed.go`'s `names` list as
`{11, "p17_variable_description", "…"}`.

Surface changes, in full:

- `model.Variable`/`model.Environment` gain `Description string \`json:"description"\`` — and note
  `Variable`'s doc comment (`model/variables.go:24-27`) is about the *secret* projection, which this
  does not weaken: a description is not a secret.
- `VariablesRepo.List`/`ListEnvironments`/`Upsert`/`CreateEnvironment`/`RenameEnvironment` carry it.
  `RenameEnvironment` becomes `UpdateEnvironment(id, name, description)` — renaming and describing
  are one row update and two IPC calls for one blur is worse than one.
- `bridge/variables.go`'s `VariablesUpsertArgs` and the environment args gain the field;
  `apiControl.ts`'s wrappers follow; `@shared/domain/variables`'s two interfaces follow.
- **History does not.** `api_variable_history` records *prior values* (P5 D13) — a description is
  metadata about the entry, not a value it once had. Stated so the omission is a decision.
- **Postman round-trip** (F10): `postman.Variable` gains `Description`; `decodeVariables`
  (`parse.go:76-92`) reads `description` leniently — a JSON string, or an object's `content` member,
  matching how Postman writes both; `buildVariables` (`write.go:145-161`) emits `description` as a
  plain string when non-empty. A description that arrived as an object is re-emitted as a string:
  Postman accepts that shape, and the alternative (round-tripping an opaque object through a column
  the user can edit) is not honest.

UI: a third cell in `VariableRow.vue`, and a second field on the environment row. Both commit on
blur through the same draft mechanism the name/value cells already use (`VariablesDialog.vue:157-172`).

### D15 — Description lands on variables and environments **only**, and the investigation says why for each of the four candidates the SPEC's parenthetical implies (item 2)

| Candidate | Verdict | Why |
|---|---|---|
| **variable entry** | **in** | The row asks for it; F10 shows Postman already carries one and this app silently drops it on round-trip, so the field also closes a real fidelity gap |
| **environment** | **in** | Same row; environments are app-local so there is no round-trip question at all, just a column and a field |
| collection / folder / saved request | **out** | A collection's Postman `info.description` lives untouched inside `origin_json` (`postman/collection.go:62-67`) and this app has never edited it. Making it editable means a column, an origin-merge on write, and a UI — and, unlike a variable, nothing here is *lost* today. Recorded as a follow-on, not folded in |
| the four request tables' rows (headers, params, urlencoded, form-data) | **out** | This is P4 §8 OQ-10 verbatim, and it is a genuinely different change: four `HttpBodyWire`/`SavedRequest` shapes, `httpRequestTabStateSchema`, the Go body model, `postman/write.go`'s four row builders and `FieldRowsTable.vue`'s column layout. P4 OQ-10 already says *"the change still belongs where the tables live"*. It stays open, unchanged, and this phase does not half-do it (AGENTS.md: *"scope left out of a phase is left out entirely, not half-implemented"*) |

### D16 — One new tab kind, `variable-set`, reused by path; the environments **list** stays a dialog (item 3)

**One kind, not two.** A collection's variable set and an environment's variable set are the same
table over the same rows differing only in `scope` — `VariablesRepo` itself is one repo for both
scopes *"not two"* (`repos/variables.go:20-24`), and duplicating that split into two tab kinds would
contradict the storage model for no gain.

```ts
export const variableSetTabStateSchema = z.object({
  scope: z.enum(['collection', 'environment']),
  ownerId: z.string(),
  /** The owner's last-known name — the tab title before the list has loaded after a restore, and
   *  what a rename patches (renameVariableSetTabs), mirroring HttpRequestTabState.name. */
  name: z.string().default(''),
});
```

**What is deliberately *not* in the state**: the filter query and the bulk-mode flag. P16 §8 OQ-8's
own rule — *"a lens, not a setting"* — plus the specific hazard that persisting bulk mode would
restore a tab into an editor holding an unapplied buffer that no longer matches the rows. Both stay
component-local.

**Registry wiring** (F8's five vocabularies, all in R10):
`tabKindSchema`, `RENDERABLE_TAB_KINDS`, `TAB_KIND_MODE` (`'api'`), `tabRecordSchema`,
`TAB_KINDS['variable-set']` (title = `state.name || 'Variables'`; icon = `'symbol-variable'` for
collection scope / `'settings-gear'` for environment; `railColor: () => undefined`; `dropResources:
noDrop`; `menuExtras: () => []`; `parseState`; `duplicateState` returns the same target's state,
since a variable set has no variant-to-try story), `TAB_VIEWS`, and **`model.RenderableTabKinds`**
in `internal/storage/model/tabs.go:26-33` — the one that fails silently if missed (F8).

**Identity and reuse.** `path` is `variables:collection:<id>` / `variables:environment:<id>` and
`openTab` is called with `reuse: true`. Unlike a request tab (P4 F13), a variable-set tab has no
duplicate-carrying-the-original's-path hazard: `duplicateState` returns the same owner, so a
duplicate *is* the same tab's target and reusing it is correct, not a bug.

**Lifecycle.**
- Renaming a collection or environment patches every open tab's `state.name`
  (`renameVariableSetTabs`, modelled on `renameApiRequestTabs`, `api/tabs.ts:73-79`).
- Deleting the owner closes any open tab for it (the environments dialog's delete path and the
  collections tree's delete path both call it).
- A restored tab whose owner no longer exists renders an `EmptyState` (*"This variable set no longer
  exists"*) rather than an empty table — P4 D14's orphan posture.

**`VariablesDialog.vue` is deleted**, its body becoming `api/VariableSetView.vue` with
`DialogFrame` → `ViewChrome` (icon, name, no refresh/stop — `:can-refresh="false"`), the filter box
moving into `#toolbar-2` beside the bulk toggle, and `variablesDialogState`'s `scope`/`ownerId`/
`title` fields disappearing into tab state. `rows`/`error` become per-tab runtime
(`createRuntimeStore`, the shape `views/httprequest/state.ts:132` already uses). The environment
scope additionally renders the name + description fields and the *Duplicate* button at the top of
the view.

**The environments *list* stays a `DialogFrame`.** The SPEC row says *editing* opens as a tab; the
list is a manager (create, delete, set-active, reorder, duplicate) reached from a `<select>` in a
toolbar (`EnvironmentSelect.vue:24`), and turning a picker's overflow action into a tab is worse,
not better. Its *Edit variables…* button opens the tab (and closes the dialog).

### D17 — Duplicating an environment is a raw-column copy, keeps no history, and is never active (item 4)

`VariablesRepo.DuplicateEnvironment(id) (model.Environment, error)`, one transaction:

1. read the source row; insert a new environment with `name + " copy"`, `description` copied,
   `sort_order = MAX + 1`, **`is_active = 0`**;
2. `INSERT INTO api_variables (…) SELECT <new uuid per row>, NULL, :newEnvId, name, value,
   is_secret, secret_value, sort_order, :now, :now FROM api_variables WHERE environment_id = :srcId
   ORDER BY sort_order` — **`secret_value` copied as the raw ciphertext column**, never decrypted,
   which is `connections.Service.Duplicate`'s own P25 D11 rule (F9) and means duplication needs no
   OS key, prompts no reveal gate, and works on a machine whose keychain entry is missing;
3. no `api_variable_history` rows are copied. A clone has no prior values — its rows were created
   just now — and copying history would put a *second* variable's secret ciphertext into a history
   table row the user never wrote. Stated as a decision because "copy everything" is the reflex.

`is_active = 0` because the active environment is a single app-global selection (P5 D3): duplicating
the active environment must not create a second active row or silently steal the selection.

**Affordance**: an `IconButton icon="copy"` on each `EnvironmentsDialog` row, tooltip *Duplicate*,
`data-testid="environment-duplicate"`. The word is **Duplicate**, not Clone — that is this app's
existing vocabulary (`connections.Service.Duplicate`, the tree menu's `duplicate` item,
`TabStrip.vue:88`), and inventing a synonym for one surface is how vocabularies drift.

### D18 — The method select becomes an app-drawn menu trigger, on the P42 D27 precedent (item 1)

`api/MethodSelect.vue`: a `<button class="p-select bordered method-select">` carrying the method's
own colour class, plus a `PopoverPanel` menu of the seven methods, each row colour-coded and the
active one checked. Identical border/background/padding/height to today (they come from
`.p-select.bordered`, unaffected by the element swap — F12), so P16 D6's height rule and
`api-ui-consistency.spec.ts:423-430`'s measurement hold unchanged.

**Why not keep the native `<select>`.** Per-option colour is `option`-level styling, which lands only
under `appearance: base-select` (`primitives.css:382`) and only where the engine implements it. The
closed state would be colourable either way; the *open list* — the Postman-style part the row asks
for — would be a coin flip per platform. The app already made this exact call once, for this exact
reason, and wrote it down (F12).

**Cost, stated rather than discovered:** three specs assert `toHaveValue` on
`[data-testid="http-method-select"]` (F11). The button carries `data-value="POST"`, and those three
assertions become `toHaveAttribute('data-value', 'POST')` — still asserting the tab's state, not its
rendering. That is a three-line test edit, named here so it is a planned change rather than a
surprise (§4).

### D19 — Seven method colours, aliased from the palette the app already tuned for exactly this (item 1)

`tokens.css` gains eight aliases, no new hues:

```css
--kira-method-get:     var(--kira-conn-blue);    /* #7ba8dc */
--kira-method-post:    var(--kira-conn-green);   /* #7db485 */
--kira-method-put:     var(--kira-conn-amber);   /* #bca260 */
--kira-method-patch:   var(--kira-conn-violet);  /* #b296d2 */
--kira-method-delete:  var(--kira-conn-red);     /* #d78e88 */
--kira-method-head:    var(--kira-conn-teal);    /* #5fb7a5 */
--kira-method-options: var(--kira-conn-cyan);    /* #58b4c4 */
--kira-method-other:   var(--kira-conn-grey);    /* #9fa5ac */
```

- **Why the connection palette and not new values**: `tokens.css:103-105` says it was built as *"one
  lightness and one chroma for all eleven hues … so no connection shouts louder than another"* —
  which is precisely the property a seven-method row needs. Inventing seven fresh hues would mean
  re-deriving that balance by eye.
- **Why aliases and not `var(--kira-conn-blue)` at the call site**: colour in this app means
  *connection identity* in Studio; a method is a different vocabulary that happens to want the same
  hues. One indirection keeps "what it means" and "what it is" separable, and it is what
  `--kira-search-match: color-mix(… var(--kira-warn) …)` (P39 D15) already did for the same reason.
- **Why these assignments**: GET/POST/PUT/DELETE keep the hue family they read as today
  (blue/green/amber/red from `info/ok/warn/err` — F13), so nothing a user has learned is re-taught;
  **PATCH is the one that moves**, from amber-shared-with-PUT to violet, which is what "each a
  distinct colour" requires. HEAD/OPTIONS get the two remaining cool hues; anything else (an imported
  `PROPFIND` — `http.ts:407-409`'s own F4 case) gets grey.

`primitives.css` gains `.p-method` + eight modifiers, styled as `.p-chip` is (tinted background via
`color-mix(in srgb, var(--kira-method-x) 16%, transparent)`, text in the token) so the chip and the
select trigger share one rule.

`httpMethodClass` (`shared/domain/http.ts:412-414`) is **replaced** by
`httpMethodToken(method): 'get'|'post'|…|'other'`, and all three consumers move
(`HttpRequestView.vue:61`, `ResponseHistoryList.vue:162`, `CollectionRow.vue:134`) — one method
colour vocabulary app-wide rather than two. `grpc.ts:119`'s comment referencing it is updated.

### D20 — The unified panel is a read-only popover over the already-merged data, with no reveal (item 8)

`api/VariablesOverviewPanel.vue`, opened from an `IconButton icon="symbol-variable"` placed in
`#toolbar-2` beside `EnvironmentSelect` in **both** `HttpRequestView.vue` and `GrpcRequestView.vue`
(both already import from `api/` — `HttpRequestView.vue:17`, `GrpcRequestView.vue:6`), rendered as a
`PopoverPanel` anchored to that button (the app's own idiom: `SavedListMenu`, `ColumnsMenu`,
`VariableHistoryMenu`).

**Contents**: one list, merged in `mergedValuesAndSecrets`' own precedence order — environment over
collection (`api/state/variables.ts:219-234`) — each row showing:

| column | content |
|---|---|
| name | `{{name}}`, monospace, click-to-copy (`DynamicValuesDialog.vue:43-45`'s own affordance) |
| value | the value, truncated; for a secret, a `.p-chip` reading `secret` and **no value** |
| scope | a chip: `environment` / `collection`; a collection row shadowed by a same-named environment row is dimmed with a `shadowed` tooltip (P5 D2's precedence, made visible for the first time) |
| description | D14's new field, dimmed |

Plus a `PanelSearchBox` (name-only, P16 D14's rule — §5 of the P16 plan explains why a
value-matching filter over a secret-carrying list is an oracle, and that reasoning applies here
verbatim), and a footer with two links: *Edit collection variables…* / *Edit environment
variables…*, each opening the D16 tab and closing the popover.

**No reveal, at all.** A secret's plaintext is not in the renderer (F3) and this panel does not call
`revealVariable`. Adding a third reveal surface — after the variable table and Copy as curl — is
exactly the surface-count growth P14's two rounds of findings were about, and an overview panel has
no use for a plaintext it would only display.

**Why a popover and not a dockable panel**: "reachable from any request tab" is a per-tab
affordance; the workbench's left panel is Api-mode-global and already owns collections, and a second
dockable panel is a workbench-layout change (`WorkbenchShell`, splitters, persisted sizes) for a
lookup surface. OQ-4.

### D21 — `.env` bulk edit: the format (item 5)

`packages/api-core/src/http/dotenv.ts`, three pure functions.

**Serialize** (`serializeEnv(rows: EnvRow[]): string`) — one block per row, in `sort_order`:

```
# The tenant's public base URL, no trailing slash
BASE_URL=https://api.example.com

# secret — the value is not shown here and is left unchanged unless you type one
API_TOKEN=
```

- the description, when non-empty, becomes `# `-prefixed comment lines above the pair (one per
  line of the description);
- a secret emits the fixed marker comment above and an **empty value**, because the renderer does
  not have the plaintext (F3) — this is a property of the architecture, not a choice;
- the value is quoted (double, with `\n`/`\t`/`\\`/`\"` escapes) iff it is empty-but-the-row-is-not-
  secret, has leading/trailing whitespace, or contains `\n`, `"` or `#`; otherwise emitted raw.

**Parse** (`parseEnv(text: string): EnvParseResult`) — line-oriented, single-line values only:

| input | handled as |
|---|---|
| blank line | separator; ends the pending comment block |
| `# text` | accumulates into the pending description for the next pair |
| `# secret — …` (the exact marker) | recognised and dropped, never a description |
| `export KEY=VALUE` | the `export ` prefix is tolerated and stripped |
| `KEY=VALUE` | unquoted: trimmed both ends |
| `KEY="…"` | double-quoted: escapes decoded |
| `KEY='…'` | single-quoted: literal, no escapes |
| `KEY=` | a key with **no value given** — `hasValue: false` (D22 rule 3) |
| anything else | a parse error carrying the 1-based line number; the apply button is disabled and the message names the line |

Multi-line values are **not** supported as literal newlines; a value containing a newline
round-trips through the `"…\n…"` escape form, which is lossless and keeps the parser one-pass.
Interpolation (`${OTHER}`) is **not** implemented — `{{other}}` is this app's reference syntax and a
second one would be a genuine ambiguity.

Duplicate keys are permitted (P5 D12 permits them in storage); the Nth occurrence of a key maps to
the Nth existing row with that name (D22).

### D22 — `.env` bulk edit: the reconcile, and what happens to every piece of metadata (item 5)

`reconcileEnv(existing: EnvRow[], parsed: EnvEntry[]): EnvDiff` is pure, and it is the answer to
F14's table. **Matching is by name, positionally for duplicates.** The five rules:

1. **A line whose key matches an existing row** → *update*. The row keeps its `id`, therefore its
   **history**, and keeps its `is_secret` flag. `description` is replaced by the parsed comment block
   (an absent block means an empty description — the text is the source of truth in bulk mode, or
   round-tripping would make a deletion impossible).
2. **A line whose key matches nothing** → *create*, non-secret, with the parsed value and
   description. There is no `.env` syntax for the secret flag, so bulk edit cannot create a secret;
   the row-level toggle is the only path, and it stays gated exactly as it is (P5 D9).
3. **A matched row that is a secret, with `hasValue: false`** → its `secret_value` is **not touched**.
   With a non-empty value, the typed plaintext becomes the new secret value (still secret) and
   history records the replaced one through the ordinary path. This is the rule that makes the
   editor safe to open on a set full of secrets and press Apply without thinking.
4. **An existing row whose name appears in no line** → *delete*, cascading its history.
5. **Line order becomes `sort_order`** — bulk edit doubles as a reorder tool, which is what a user
   who just pasted a block expects.

**The rename hazard, stated rather than heuristically papered over.** `.env` text carries no row
identity, so renaming `API_KEY` to `API_TOKEN` in the editor is rule 4 plus rule 2: the old row (and
its history) is deleted and a new one is created. There is no rename detection and there will not
be one — a heuristic that guesses wrong silently destroys a value history, which is precisely what
history exists to prevent. Instead:

- the diff summary shown before Apply lists **removals by name** and, when a diff contains both a
  removal and an addition, adds one line: *"Renaming a key here removes the old one and its value
  history. Rename in the table to keep it."*;
- Apply is behind the app's existing `confirmDialog` whenever the diff removes anything.

**The summary itself** — `N added · N updated · N removed · N reordered` — is rendered from
`EnvDiff` above the editor, live as the user types, so Apply is never a leap.

### D23 — Applying a bulk diff is one Go transaction, not N IPC calls (item 5)

`VariablesRepo.ApplyBulk(scope, ownerID string, entries []model.VariableBulkEntry) (model.VariableBulkResult, error)`,
where an entry is `{Name, Value, Description string; HasValue bool}`. One transaction: match by name
(positional for duplicates), update / insert / delete per D22, record history through the existing
`recordHistory` helper (`repos/variables.go:405-437`) for every value that actually changed, then
re-index `sort_order` dense in line order.

**Why not N `Upsert` + M `Delete` + one `Reorder` from the renderer**: a fifteen-line paste would be
sixteen IPC round trips with no atomicity — a failure halfway leaves a set that is neither the old
one nor the new one, and the user's own text is the only record of what they meant. Atomicity is the
whole reason this operation exists as a bulk one.

One bridge method (`VariablesService.ApplyBulk`), one `apiControl.ts` wrapper
(`variablesApplyBulk`), returning the counts the view already computed locally — which is also the
guard that the two reconciles agree (§4).

---

## 3. Commit sequence

Pure logic first, then Go's twin and the masking fix, then storage, then the surfaces. `bun run
lint`, `bun run typecheck`, `bun run build` per commit; `go build ./...` + `go test
./apps/kira-studio/internal/apivars/... ./apps/kira-studio/internal/bridge/...
./apps/kira-studio/internal/storage/...` per Go commit; `bun run test:unit` after R1/R2/R8;
`bun run test:ui` **once**, after R14 (AGENTS.md's implement-then-test cadence).

| # | Commit | Items | Touches | Risk |
|---|---|---|---|---|
| R1 | `feat(api-core): a reference's pipeline, and the six value transforms` | 7 | `http/substitute.ts`, new `http/transforms.ts`, `http/escape.ts` (export `goQueryEscapeLiteral`), `index.ts`, corpus JSON, `test/http-substitution.spec.ts` | medium — the grammar change; rule 4's all-or-nothing parse is what makes it inert for every existing input |
| R2 | `feat(apivars): the Go twin of the pipeline and the transforms` | 7 | new `apivars/transforms.go`, `apivars/resolve.go`, `apivars/resolve_test.go`, corpus JSON | medium — must pass the same corpus byte-for-byte |
| R3 | `fix(apivars): a piped secret is masked in the form that actually reached the wire` | 7 | `apivars/resolve.go` (`UsedSecret`, `Used()`, `ResolveRequest`), `bridge/http.go`, `bridge/grpc.go`, `bridge/http_test.go`, `bridge/grpc_test.go` | **highest — this is the security commit.** §5 |
| R4 | `feat(api-core): the fake. dynamic-value namespace beside Postman's own $names` | 6 | `http/dynamic/catalog.ts`, `http/dynamic/generators.ts`, `http/substitute.ts` (`isDynamicReference`), `apivars/resolve.go`, `index.ts`, corpus, `api/DynamicValuesDialog.vue` | low — additive by construction (D12) |
| R5 | `feat(api): completion and hover know about pipes and fake. names` | 6, 7 | `theme/primitives/completion.ts`, `theme/primitives/AutocompleteField.vue`, `views/httprequest/variableCompletion.ts` | medium — a shared primitive; both Studio call sites must be provably untouched |
| R6 | `feat(storage): variables and environments carry a description` | 2 | new migration `0011`, `migrations/embed.go`, `storage/model/variables.go`, `storage/repos/variables.go`, `bridge/variables.go`, `postman/{collection,parse,write}.go`, `@shared/domain/variables.ts`, `bridge/apiControl.ts`, `api/VariableRow.vue`, `api/EnvironmentsDialog.vue` | low-medium — a schema change, but additive with a non-null default |
| R7 | `feat(storage): an environment can be duplicated` | 4 | `storage/repos/variables.go`, `bridge/variables.go`, `bridge/apiControl.ts`, `api/state/variables.ts`, `api/EnvironmentsDialog.vue` | low — F9's precedent, verbatim |
| R8 | `feat(api-core): the .env bulk format — parse, serialize, reconcile` | 5 | new `http/dotenv.ts`, `index.ts`, new `test/http-dotenv.spec.ts` | medium — a real parser; §4's unit cases are the guard |
| R9 | `feat(storage): applying a bulk variable diff in one transaction` | 5 | `storage/model/variables.go`, `storage/repos/variables.go`, `storage/repos/variables_test.go`, `bridge/variables.go`, `bridge/apiControl.ts`, `@shared/domain/variables.ts` | medium — history/secret preservation lives here |
| R10 | `feat(api): a variable set opens as its own tab` | 3 | `@shared/domain/tabs.ts`, `state/tabKinds.ts`, `workbench/tabViews.ts`, `storage/model/tabs.go`, new `api/VariableSetView.vue`, `api/tabs.ts`, `api/state/variables.ts`, `api/ApiDialogs.vue`, `api/CollectionsPanel.vue`, `api/CollectionsTree.vue`, `api/EnvironmentsDialog.vue`, **delete** `api/VariablesDialog.vue` | medium-high — five vocabularies, one of which fails silently (F8) |
| R11 | `feat(api): the .env bulk editor inside the variable-set tab` | 5 | new `api/BulkVariablesEditor.vue`, `api/VariableSetView.vue`, `api/state/variables.ts` | medium |
| R12 | `feat(api): one panel showing the environment's and the collection's variables together` | 8 | new `api/VariablesOverviewPanel.vue`, `views/httprequest/HttpRequestView.vue`, `views/grpcrequest/GrpcRequestView.vue` | low |
| R13 | `feat(api): the method select is app-drawn and colour-coded per method` | 1 | `theme/tokens.css`, `theme/primitives.css`, `@shared/domain/http.ts`, new `api/MethodSelect.vue`, `views/httprequest/HttpRequestView.vue`, `views/httprequest/ResponseHistoryList.vue`, `api/CollectionRow.vue`, `@shared/domain/grpc.ts` (comment) | low-medium — three spec assertions change (D18) |
| R14 | `test(p17): the specs §4 enumerates` | — | `tests/ui/*`, `tests/unit/*`, `packages/api-core/test/*` | low |

**Ordering that matters:** R1 → R2 → R3 is one continuous piece and must stay in that order and in
that window — R3 is meaningless before R2 and R2 fails the corpus before R1. R4 depends on R1 (the
shared `isDynamicReference`) and R2 (the Go branch). R5 depends on R1/R4. R6 → R9 → R11 (bulk apply
carries `description`, so the column must exist first). R10 must precede R11 (the editor lives in
the tab). R7, R12, R13 are independent of everything above and of each other.

---

## 4. Verification plan

**Per commit**: `bun run lint`, `bun run typecheck`, `bun run build`; `go build ./...` and the
package's own `go test` for a Go commit.

### 4.1 The corpus is the load-bearing check of R1–R4

`internal/apivars/testdata/substitution.json` is read by both
`packages/api-core/test/http-substitution.spec.ts` and `internal/apivars/resolve_test.go` (F1). Every
existing case must pass **unedited** after R1 and R2 — that is the proof D3's rule 4 made the
grammar change inert for every input that exists today.

New corpus cases (each passing on both sides, or one of them fails):

1. `{{token | base64}}` with `token` in `values` → the base64 of the value; `refs` carries
   `pipeline: ["base64"]` and `name: "token"`;
2. the same with `token` in `secrets` → **left verbatim, byte-for-byte as typed**, `kind: deferred`
   (D6's load-bearing row);
3. `{{ token|upper }}` — whitespace variations around the name and the pipe, same result as case 1;
4. `{{token | base64 | upper}}` — chaining, left to right;
5. `{{token | base46}}` — an unknown transform: name is the whole `token | base46`, `kind: unknown`,
   text verbatim (D3 rule 4);
6. `{{a|b}}` where a *variable literally named* `a|b` exists in `values` → resolved (rule 4 again,
   from the other direction — this is the backward-compatibility case);
7. `{{token | base64decode}}` where the value is not valid base64 → verbatim, `unknown` (D5);
8. `{{fake.internet.email}}` with no generator supplied → verbatim, `kind: dynamic` (D12);
9. `{{fake.internet.email | upper}}` → verbatim, `dynamic`, `pipeline: ["upper"]`;
10. `{{missing | upper}}` in a URL with `sanitizeUrlSpan` → `{{missing%20%7C%20upper}}` (D11), and
    the assertion that `new URL(...)` parses it.

### 4.2 New unit coverage, held to AGENTS.md's bar

These earn tests because they are multi-rule scanners and a reconciler, not CRUD:

**`packages/api-core/test/http-substitution.spec.ts`** (beside the corpus loop, TS-only):
- D8's ordering: `resolve('{{$guid | upper}}/{{$guid | upper}}', {}, [], () => next())` yields two
  *different* upper-cased values — the one assertion that pins "pipe after generation, per
  occurrence" (P6 D3 + D8 together);
- `parseReference`: no pipe / one / three / unknown segment / empty name / whitespace-only segment;
- `normalized` is stable across spacing variants (`{{a|b}}`, `{{ a | b }}` → the same placeholder) —
  the property D9's masking depends on;
- each transform's own round trip and its failure mode; **`base64` over a non-ASCII value** (the
  `btoa` trap, D7) and `base64decode` over valid-base64-but-invalid-UTF-8.

**`packages/api-core/test/http-dotenv.spec.ts`** (new, R8):
- parse: unquoted / double-quoted with escapes / single-quoted / `export ` prefix / `KEY=` /
  comment blocks becoming descriptions / the secret marker being dropped rather than becoming one /
  a malformed line's reported line number;
- serialize→parse round trip over a set containing every quoting trigger (empty value, leading
  space, embedded `#`, embedded newline, embedded `"`);
- reconcile, one case per D22 rule, plus the two that matter most:
  **a secret with an untouched empty line keeps `hasValue: false`**, and a reorder-only edit
  produces zero adds/updates/removes and a non-empty reorder.

**`apps/kira-studio/tests/unit/autocomplete-tokenizers.spec.ts`** (existing file, extended):
`templateToken` at `{{tok`, `{{token | `, `{{token | b`, `{{token | base64 | u`, and outside a
reference (must be `null`).

**Go** (`internal/storage/repos/variables_test.go`), the two rules that are properties rather than
plumbing:
- `DuplicateEnvironment` copies `secret_value` **as ciphertext** (assert the copied row's ciphertext
  differs from a re-encryption by decrypting both and comparing plaintext, while the source's
  ciphertext string is byte-identical to the copy's — proving no decrypt/re-encrypt happened),
  copies **no** history rows, and produces `is_active = 0` even when the source is active;
- `ApplyBulk` with a secret entry carrying `HasValue: false` leaves `secret_value` byte-identical,
  and one carrying a new plaintext records exactly one history row.

Nothing else gets a unit test: the migration, the bridge wrappers, the tab-registry entry and the
Vue components are CRUD, pass-through or DOM behaviour (AGENTS.md).

### 4.3 The Go/TS parity checks

- `packages/api-core/test/go-ts-api-parity.spec.ts` gains one check in its existing style (reading
  the Go source as text, P2 D10): `apivars.transformNames` (a `map[string]bool` literal, so
  `extractGoStringSet` works unchanged) equals `TRANSFORM_NAMES`. A transform added on one side and
  not the other is then a failing test rather than a silent divergence at send time.
- `apps/kira-studio/tests/unit/go-ts-vocabulary-parity.spec.ts`'s tab-kind check picks up
  `variable-set` automatically once both lists carry it — and **fails if `model/tabs.go` is missed**,
  which is F8's silent failure mode caught by an existing test.

### 4.4 `tests/ui`, once, after R14

**Must pass unedited** (the "this phase is additive" guard):

| Spec | What it proves |
|---|---|
| `autocomplete.spec.ts` | D13's two new `AutocompleteField` behaviours left Studio's WHERE/ORDER BY completion untouched |
| `http-variables.spec.ts` (5 tests) | the reveal gate, substitution-reaches-the-wire, environment-over-collection precedence, reorder and history restore all survive the dialog→tab move (R10) and the schema change (R6). **These five are the regression net for the whole storage half** |
| `api-secret-reveal-isolation.spec.ts` | R10's teardown still clears `revealedValues` on tab close as the dialog did on close (finding 5's own hazard, re-homed) |
| `http-curl.spec.ts` | Copy as curl still resolves and reveals identically (F3) |
| `http-dynamic-values.spec.ts` | every `$name` still resolves after R4 — D12's no-migration claim, asserted |
| `collections.spec.ts`, `http-raw.spec.ts`, `http-request.spec.ts` | **except** the three `toHaveValue` assertions D18 names, which change to `toHaveAttribute('data-value', …)` — the only intentional spec edits in this phase, and they assert the same fact |
| `tabs.spec.ts` | the tab strip, restore and close paths with a ninth kind present |

**New coverage in `api-ui-consistency.spec.ts`** (Api-only, per the SPEC's module-boundary rule):

1. typing `{{base_url | ` in the URL field lists the six transforms and **not** the variable names
   (D13(b)); accepting `base64` yields `{{base_url | base64}}`;
2. a URL holding `{{known | base64}}` paints `.cm-kira-var` (resolved, not unknown) and one holding
   `{{known | nope}}` paints `.cm-kira-var-unknown` (D3 rule 4 through the highlighter);
3. hovering `{{secret | base64}}` shows the "base64-encoded when the request is sent" line and
   **not any value** — asserted as an absence; the security assertion of this phase's UI half;
4. the method select opens an app-drawn menu, picking `PATCH` sets `data-value="PATCH"`, and the
   trigger's own colour class differs from `PUT`'s (D19's "each distinct", asserted as inequality of
   the resolved colour rather than as a hex literal);
5. *Variables…* on a collection row opens a **tab** (not a dialog), a second invocation activates
   the same tab rather than opening a second (D16's `reuse: true`), and renaming the collection
   retitles it;
6. duplicating an environment produces `<name> copy` carrying the same variable names, with the
   original still active (D17);
7. the bulk editor: switch to `.env` mode, add a line, remove a line, see the live
   `1 added · 1 removed` summary and the rename warning, Apply through the confirm, and see the
   table reflect it — plus **a secret row's line left empty leaves the secret intact** (the send in
   `http-variables.spec.ts` is what would catch a broken one);
8. the overview panel opens from a request tab, lists an environment variable and a collection
   variable with their scope chips, shows `secret` instead of a value for a secret, and its
   *Edit…* link opens the D16 tab.

**A new `tests/ui/http-pipes.spec.ts`** — the end-to-end proof of §5, which no unit test can give
because it is a property of what reaches the wire:

1. a secret piped through `base64` **arrives base64-encoded at the test server** (proving the
   transform runs in Go's stage 2, on the decrypted value);
2. the Raw pane, the timeline's hop URL, and the persisted history entry all show
   `{{secret | base64}}` and **contain neither the plaintext nor its base64 form** — asserted as two
   absences, over the same surfaces `http-variables.spec.ts:185` already walks for the un-piped case;
3. a request using **both** `{{secret}}` and `{{secret | base64}}` masks both (D9(d) — the case a
   name-keyed model structurally cannot pass).

### 4.5 Not run, and named

- **Locale-sensitive case mapping.** `toUpperCase`/`strings.ToUpper` agree on every code point this
  app will realistically see and differ on none without an explicit locale, but no Turkish-locale
  case is exercised. Recorded, not claimed.
- **A real macOS render of the method menu.** Placement is `PopoverPanel`/`floatingPosition.ts`'s,
  the same engine four other floating surfaces use; nothing here is measured by hand.
- **A real Postman round trip of a variable description through Postman itself.** `roundtrip_test.go`
  proves this app's own read→write fidelity; whether Postman renders the string form of a
  description that arrived as an object is unverifiable from this sandbox (the same limit
  `postman/collection.go`'s F2/OQ-1 already records).

---

## 5. Piped secrets and the masking replacer — the analysis this phase owes

The SPEC row asks for this by name. This section is the answer in full.

### 5.1 What the invariant actually is

P9 D6, as widened by P10 D14/F16 and P14 rounds 1–2, is: **a secret's plaintext must never reach a
copyable surface ungated, nor `kira.sqlite` outside `api_variables.secret_value`.** The mechanism is
`bridge/http.go:152-182`'s `strings.Replacer`, and its stated property (`:142-151`) is that a
replacer *can only over-mask, never under-mask a surface that carries the plaintext verbatim* — with
the explicit caveat that this *"does not by itself cover a surface that carries a re-encoded form
instead"*. P14 found that caveat twice: `url.QueryEscape` (round 1, finding 6) and `url.PathEscape`
(round 2, finding 4). Both were fixed by registering the re-encoded form as an additional pair.

### 5.2 Why a pipe is the same bug, and worse

A pipe is a **user-requested, arbitrary re-encoding applied before the value ever leaves Go**. With
`{{token | base64}}`:

- the plaintext appears **nowhere** on the wire — so the plaintext pair never matches;
- `QueryEscape(plaintext)` and `PathEscape(plaintext)` never match either — they are encodings of
  the wrong string;
- the base64 text lands in `Wire.Request` (copyable), `Timeline.Hops[].URL` and `.Headers[].Value`
  (copyable, and rendered by `TimelinePane.vue`), `Redirects[].URL` and `FinalURL` (**persisted to
  `kira.sqlite` by P8**), and `herr.Message`/`Hops[].Error` on a failure (turned into
  `ipcerr.Error.Details`, another copyable surface);
- and `Wire.MaskedSecrets` would still be non-zero, so the pane would claim *"N secret values shown
  as `{{name}}`"* over text that shows one in full.

Worse than P14's cases in one specific way: `QueryEscape`/`PathEscape` are *reversible but
obfuscating*; base64 of a bearer token is the **exact form the token is normally transported in**.
Anyone reading that pane has a working credential.

### 5.3 Why the fix cannot be "mask the plaintext harder"

Three non-fixes, each rejected for a stated reason:

1. **Register the transform of the plaintext for every transform in the vocabulary** (six pairs per
   secret, unconditionally). Wrong for two reasons: it over-masks in a way that corrupts unrelated
   text (`upper(plaintext)` of a short secret can collide with ordinary body content), and it is
   O(vocabulary) rather than O(what was actually used) — every future transform silently widens the
   blast radius.
2. **Refuse to pipe a secret.** The user's stated reason for wanting pipes is Basic auth
   (`{{user}}:{{pass}} | base64`) and signed headers — refusing exactly the case the feature is for.
3. **Mask by the placeholder before the value is substituted.** There is no "before": stage 2's whole
   job is producing the resolved text the client sends.

### 5.4 The fix: record what was written, not what was stored (D9)

`Resolver` stops answering *"which secrets did I use, and what are they"* and starts answering
*"what exact text did I write into this request, and what should it be masked back to"*:

```go
type UsedSecret struct{ Name, Rendered, Placeholder string }
```

- `Rendered` comes from the substitution walk itself, through a callback, so it is by construction
  *the bytes that went into the request* — not a re-derivation that could drift from them. This is
  the property the whole fix rests on: the masking input and the wire content have one source.
- `Placeholder` is `ParseReference().normalized` — `{{token}}` or `{{token | base64}}` — so the
  masked pane still reads as the template the user wrote, and the P9 caption stays true. It is
  normalized (single spaces) rather than the user's exact spacing so that two spellings of one span
  do not produce two placeholders for identical wire bytes.
- One entry per distinct `(Name, Placeholder)`, so a request using a secret both plainly and piped
  masks **both** forms. A name-keyed map cannot express this, which is why the shape change is
  necessary rather than cosmetic.
- The three-pair expansion (`Rendered`, `QueryEscape(Rendered)`, `PathEscape(Rendered)`) is P14's
  own fix, unchanged and now applied to the right string — the piped form is *still* subject to
  `QueryEscape` if it lands in a urlencoded body, so dropping that expansion would reopen finding 6
  one level down.
- Entries sort by `len(Rendered)` descending before the replacer is built, so a shorter rendered
  form that is a substring of a longer one cannot shadow it.

### 5.5 What is still not covered, honestly

- **Over-masking grows slightly.** A base64 or upper-cased secret is more likely than a raw one to
  collide with unrelated response text — e.g. `upper("test")` = `TEST`. The replacer already
  over-masks by design (`:143-145`) and the failure mode is a masked-looking response, not a leak.
  Named, accepted.
- **A transform that *loses* information does not need masking and does not get it.** There is no
  such transform in D7's six (all are reversible or case-folding), but if one is ever added — a hash,
  say — its output is not sensitive and registering it would be pure over-masking. The rule to
  record then is per-transform, and it does not exist yet. OQ-3.
- **Stage 1 remains unable to leak a transformed secret** because it never holds a secret (F3). The
  one client-side path that does — *Copy as curl* — reveals through the existing gate and then runs
  the same engine, so its output carries the transformed value **deliberately**, exactly as the
  un-piped reveal already carries the plaintext (P7 D10). Nothing about that changes, and nothing
  about it should.

---

## 6. What this phase deliberately does not do

- **Does not change the `{{`…`}}` scan** — not one branch, not one index (§0.3). The pinned corpus
  passing unedited is the proof (§4.1).
- **Does not migrate, rewrite or deprecate a single stored `{{$name}}`** (D12), and states what
  would break if it did.
- **Does not add transform arguments, defaults, conditionals or nesting** (§0.4, OQ-2).
- **Does not add a third place a secret can be revealed** — the overview panel shows `secret`, the
  bulk editor cannot read or write a plaintext it does not have (D20, D22 rule 3).
- **Does not touch `substitute.ts`'s dynamic-generation timing, count or short-circuit** (D8).
- **Does not add `description` to collections, folders, saved requests, or the four request tables**
  (D15) — P4 OQ-10 stays open, unchanged.
- **Does not turn the environments *list* into a tab** (D16) — only editing moves.
- **Does not touch Studio mode.** The one shared primitive edited (`AutocompleteField`) has two
  Studio call sites, both provably unchanged by an unedited `autocomplete.spec.ts` (§4.4).
- **Does not touch the response/timeline/history panes**, beyond the method-chip class rename
  (D19) which is one attribute per call site.

---

## 7. Open questions, and how each is resolved here

**OQ-1 — should `parseReference` be memoized?** `resolve` now calls it once per reference, and the
live preview re-resolves the whole tab state on every keystroke (`HttpRequestView.vue:166-178`). The
fast path is one `indexOf('|')` over a name-length string when no pipe is present, which is every
reference that exists today, so the added cost for the common case is a single scan of ~10
characters per reference per keystroke. **Resolved: no memoization.** A cache keyed on a string
that changes on every keystroke is the wrong shape, and AGENTS.md's *"measure when there's a real
question at stake"* rule says this is not one.

**OQ-2 — transform arguments will be asked for.** `truncate:20`, `default:foo`, `replace:a:b`,
`repeat:3` are the obvious four, and the moment one lands, quoting rules follow (what if the
argument contains `:` or `}}`?), and quoting rules are the expression language P5 D1 declined.
**Resolved for this phase: no arguments**, and the recommended shape if it is ever reopened is a
*second* closed vocabulary of single-integer-argument transforms (`truncate:20` only, integers
only), never free-form strings — because an integer needs no quoting.

**OQ-3 — a lossy transform would need a per-transform masking rule.** §5.5. All six of D7's
transforms produce output that is exactly as sensitive as their input, so one rule ("register the
rendered form") covers all of them. A hash would not need registering at all. **Resolved: no
per-transform masking policy is introduced**, because introducing one for a case that does not exist
is speculative machinery; the rule to add it lands with the first such transform.

**OQ-4 — should the overview panel be a dockable workbench panel instead of a popover?** D20 chose a
popover. The counter-argument is real: a user comparing a request against a large variable set wants
it pinned open. **Resolved: popover now**, because a second dockable panel is a `WorkbenchShell`
layout change (splitters, persisted sizes, the panel registry) for a lookup surface, and the popover
is a one-line change away from being hosted elsewhere later. Flagged for whoever next touches the
workbench layout.

**OQ-5 — `fake.` shadows a variable of the same name.** D12. A variable literally named
`fake.anything` becomes unreachable, exactly as `$anything` already is. **Resolved: accepted**, with
the live chip reporting it as an unknown dynamic value (which is visible, not silent). The
alternative — checking `values` before the prefix — would make the dynamic branch's precedence depend
on the variable set, i.e. the same name would mean different things in different collections.

**OQ-6 — bulk edit cannot create a secret, and cannot un-secret a row.** D22 rules 2 and 3. A
`KEY=value` line for a name that does not exist creates a **non-secret** row, and the secret flag of
an existing row is never changed by bulk text. **Resolved: deliberate.** Every syntax considered for
expressing it (`KEY!=…`, a `# secret` directive, a `KEY.secret=true` sibling) makes the format
non-`.env`, and the row-level toggle already carries the reveal gate that turning a secret *off*
requires (P5 D9 — un-securing is itself a reveal). The editor says so in one line above the textarea.

**OQ-7 — `.env` bulk edit for *environments themselves* (a set of environments), not their
variables.** The SPEC row says *"a bulk-edit mode for variables and environments"*, which reads two
ways. **Resolved: it means the variables of either scope** — a collection's set or an environment's
set, both edited through the same tab and the same editor (D16 is one tab kind for both, which is
what makes this true without a second implementation). A `.env` file has no representation for "a
list of environments, each with a name and a set" — that is a multi-document format, i.e. not
`.env`. Stated so the reading is a decision rather than an ambiguity discovered mid-implementation.

---

## Checklist

- [ ] **R1** `parseReference` + `TRANSFORM_NAMES`/`applyPipeline` in `api-core`; `Reference.pipeline`
      optional and omitted when empty; `goQueryEscapeLiteral` exported; corpus cases 1–10 added;
      **every existing corpus case passes unedited** *(item 7)*
- [ ] **R2** `apivars/transforms.go` + `ParseReference` + the three-branch wiring in
      `resolveWithSanitizer`; `|` in the URL-unsafe table; `Names()` reads the bare name; the Go
      corpus test compares `Pipeline` *(item 7)*
- [ ] **R3** `UsedSecret{Name,Rendered,Placeholder}`; `Resolver.Used() []UsedSecret` fed by an
      `onResolved` callback (never a field on `Reference`); `ResolveRequest`'s fourth return;
      `secretReplacer` over rendered forms, length-sorted, three pairs each; `MaskedSecrets` counts
      distinct names; both bridges updated; the Debug log still names only names *(item 7, §5)*
- [ ] **R4** `FAKE_NAMES` + `ALIAS_TO_FAKE` + `GENERATORS: Record<FakeName, …>`;
      `isDynamicReference` shared by `classifyReference` and Go; the two clock entries documented as
      the namespace's only non-faker paths; `DynamicValuesDialog` lists both spellings; **no stored
      reference is rewritten** *(item 6)*
- [ ] **R5** `templateToken` splits at the last `|`; `AutocompleteField`'s `candidates` accepts a
      function; `variableSupport` returns position-aware candidates and the four new hover lines;
      both Studio call sites untouched *(items 6, 7)*
- [ ] **R6** migration `0011` + `embed.go`; `Description` through model → repo → bridge → control →
      shared domain → row UI; `RenameEnvironment` → `UpdateEnvironment`; Postman decode (string or
      object `content`) and emit; history deliberately unchanged *(item 2)*
- [ ] **R7** `DuplicateEnvironment`: raw ciphertext copy, no history, `is_active = 0`, `" copy"`
      suffix; the row's *Duplicate* button *(item 4)*
- [ ] **R8** `dotenv.ts`: serialize (comment-block descriptions, the secret marker, the quoting
      rules), parse (the eight line forms + line-numbered errors), reconcile (D22's five rules +
      the rename warning) *(item 5)*
- [ ] **R9** `ApplyBulk` in one transaction: match by name, positional for duplicates, history
      through the existing helper, `secret_value` untouched when no value was given, dense re-index
      in line order *(item 5)*
- [ ] **R10** `variable-set` in all five vocabularies **including `model/tabs.go`**;
      `VariableSetView.vue` replacing `VariablesDialog.vue`; `reuse: true` on a real path; rename
      patches, delete closes, orphan renders an `EmptyState`; six call sites redirected *(item 3)*
- [ ] **R11** the `.env` toggle, the live diff summary, the rename warning, the confirm-on-removal,
      and the secret-line note *(item 5)*
- [ ] **R12** `VariablesOverviewPanel.vue` in both request views' `#toolbar-2`; merged rows with
      scope chips and the shadowed-duplicate mark; name-only filter; **no reveal** *(item 8)*
- [ ] **R13** eight `--kira-method-*` aliases; `.p-method` family; `httpMethodToken` replacing
      `httpMethodClass` at all three call sites; `MethodSelect.vue` on the P42 D27 precedent; the
      three `toHaveValue` assertions converted *(item 1)*
- [ ] **R14** §4.2's unit cases, §4.3's two parity checks, §4.4's eight `api-ui-consistency` cases
      and the new `http-pipes.spec.ts`
- [ ] full `bun run test:ui` once, after R14; fixes land as follow-up commits

---

## 8. Sources

**Read in full at `d136764`:** `packages/api-core/src/http/{substitute.ts,substituteRequest.ts,
escape.ts,dynamic/catalog.ts}`, `packages/api-core/src/index.ts`,
`packages/api-core/test/{http-substitution.spec.ts,go-ts-api-parity.spec.ts}`,
`internal/apivars/{resolve.go,vars.go}`, `internal/apivars/testdata/substitution.json`,
`internal/bridge/{http.go (masking half),variables.go}`, `internal/storage/repos/variables.go`,
`internal/storage/model/{variables.go,tabs.go}`,
`internal/storage/migrations/{0007_p5_variables.sql,0010_p12_api_rename.sql,embed.go}`,
`packages/shared/domain/{variables.ts,tabs.ts}`,
`frontend/src/api/{VariablesDialog.vue,EnvironmentsDialog.vue,DynamicValuesDialog.vue,
EnvironmentSelect.vue,ApiDialogs.vue,CollectionsPanel.vue,menus.ts,state/variables.ts,state/curl.ts,
tabs.ts}`, `frontend/src/views/httprequest/{HttpRequestView.vue,state.ts,variableCompletion.ts}`,
`frontend/src/state/tabKinds.ts`, `frontend/src/workbench/tabViews.ts`, `frontend/src/theme/tokens.css`.

**Read for a specific claim:** `internal/connections/service.go` (`Duplicate`, F9),
`internal/postman/{collection.go,parse.go,write.go,roundtrip_test.go}` (F10),
`internal/apivars/resolve_test.go` (the corpus comparison shape, F1),
`frontend/src/theme/primitives.css` (`.p-chip`, `.p-select`, F13/F12),
`frontend/src/views/shared/celleditor/CellEditorView.vue` (P42 D27, F12),
`frontend/src/views/grid/fakeData/recipes.ts` (the `GeneratorId` namespace, F5),
`frontend/src/views/grpcrequest/GrpcRequestView.vue` (the `api/` imports item 8 needs),
`frontend/src/state/tabs.ts` (`openTab`, F8), `packages/shared/domain/http.ts` (F13),
`apps/kira-studio/tests/ui/{http-variables,http-curl,http-raw,http-request,collections,
api-ui-consistency}.spec.ts` (F11, §4).

**Prior plans consulted:** `P5-collection-variables-environments.md` (D2/D3/D4/D5/D6/D12/D13/D17/D18
— the model every item here extends, and D12's own "no description, and why"),
`P6-faker-dynamic-values.md` (D2/D3/D4/D9/D10/D13 — the catalogue, per-occurrence freshness and the
declined argument syntax), `P9-raw-inspector-editor.md` and `P10-request-timeline.md` (D6/D14/F16 —
the masking surfaces), `P15b-request-builder-editor-behavior.md` (D1/D3/D4 — the classifier, the
overlay and the completion seams this phase extends by one prop),
`P16-sql-grid-consistency-search.md` (D6/D14 and its §5 — the select-height rule, the name-only
filter rule, and the "the masking analysis this phase owes" section shape), `P4-collections.md`
(D14/D16, F13 and §8 OQ-10). `AGENTS.md`'s library-first rule, unit-test bar (§4.2) and
implement-then-test cadence (§3).
