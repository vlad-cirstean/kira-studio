# P3 — Request body payload formats, at Postman parity

> **What this phase is.** `docs/v1.2/SPEC.md`'s P3 row: extend P2's two-mode request body (`none`,
> `json`) to **the full set of body modes Postman's own format exposes** — `raw` (with its
> Text/JavaScript/JSON/HTML/XML sub-selector), `urlencoded`, `formdata` **including real file
> fields**, `file` (a whole local file as the body, labelled *binary*), and `graphql` (query +
> variables). The work is three-layered: a widened Zod state schema in
> `packages/shared/domain/http.ts`, a real serializer in `internal/httpclient` that turns each mode
> into a correct `net/http.Request` (real `mime/multipart` writing, a correct `Content-Length`, the
> right `Content-Type` per mode), and the builder UI for each.
>
> **What does not land here.** Collections and Postman-format import/export (P4), variables and
> environments (P5), Faker dynamic values (P6), curl parse/generate (P7), response history (P8), the
> raw byte-level inspector and raw editor (P9), the timeline (P10), gRPC (P11). Also explicitly not
> here: a response-side binary/file *viewer* or a Save-response-to-file action (§4 D14, §8 OQ-3), a
> Description column on any key/value table (§8 OQ-5), an Auth tab (P2 §8 OQ-5, still open), a
> per-request timeout (§8 OQ-2). Nothing here is half-built toward any of them
> (`AGENTS.md`: *"Scope left out of a phase is left out entirely, not half-implemented"*).
>
> **Every claim below was re-read against the tree, not inherited from `P2-http-core.md`'s prose.**
> Base: branch `claude/feature-v1-2` at `e7826cd`. File:line citations point at that content. Wails
> internals were read from the installed module at
> `$(go env GOPATH)/pkg/mod/github.com/wailsapp/wails/v3@v3.0.0-beta.16/`, per `AGENTS.md`'s
> instruction to read the pinned source rather than the 403-blocked docs site.
>
> **The one-sentence design.** A file's bytes never enter the renderer or the IPC bridge — the
> native picker returns a *path*, the path travels in the send args as a short string, and Go opens
> and streams it into a real multipart body with an exact `Content-Length`; everything else is one
> tagged-union field on a wire struct that already exists.

---

## 0. Scope, non-scope, ground rules

### 0.1 In scope

| File | What changes |
|---|---|
| `packages/shared/domain/http.ts` | the six-mode vocabulary + the five raw languages, the per-mode state fields, P2's `'json'` kept as a **legacy alias**, the widened wire mirror, `CONTENT_TYPE_BY_RAW_LANGUAGE` |
| `apps/kira-studio/internal/httpclient/body.go` | **new** — every mode's serializer: the two-pass exact-length multipart writer, the urlencoded encoder, the GraphQL envelope, `GetBody` for redirect replay |
| `apps/kira-studio/internal/httpclient/body_test.go` | **new** — §6.3 |
| `apps/kira-studio/internal/httpclient/client.go` | `Request.Body string`/`HasBody bool` become one `Body` union; `Content-Type` precedence; `Body`/`GetBody`/`ContentLength` assigned explicitly |
| `apps/kira-studio/internal/bridge/http.go` | `HttpSendArgs.Body`/`HasBody` → `HttpSendArgs.Body httpclient.Body` |
| `apps/kira-studio/frontend/src/bridge/control.ts` | `httpSend`'s argument shape |
| `apps/kira-studio/frontend/src/state/tabKinds.ts` | a ninth `TabKindDef` member, `parseState` |
| `apps/kira-studio/frontend/src/state/tabs.ts` | `hydrateTabs` normalizes each restored record's state through that registry entry |
| `apps/kira-studio/frontend/src/views/httprequest/body.ts` | **new** — the mode/language vocabularies, the auto-`Content-Type` table, the body count badge |
| `apps/kira-studio/frontend/src/views/httprequest/files.ts` | **new** — the one `control.filesChooseOpen` wrapper both file surfaces share |
| `apps/kira-studio/frontend/src/views/httprequest/RequestBodyPane.vue` | **new** — the mode selector and the per-mode editor host |
| `apps/kira-studio/frontend/src/views/httprequest/FieldRowsTable.vue` | **new** — the one key/value row table |
| `apps/kira-studio/frontend/src/views/httprequest/{UrlEncodedTable,FormDataTable,BinaryBodyPicker,GraphQlBodyPane}.vue` | **new** |
| `apps/kira-studio/frontend/src/views/httprequest/{RequestHeadersTable,QueryParamsTable}.vue` | mount `FieldRowsTable` instead of hand-rolling the same rows |
| `apps/kira-studio/frontend/src/views/httprequest/HttpRequestView.vue` | the inline body block moves into `RequestBodyPane.vue` |
| `apps/kira-studio/frontend/src/views/httprequest/ResponsePane.vue` | Pretty learns XML (D13) |
| `apps/kira-studio/frontend/src/views/httprequest/state.ts` | `send()` builds the union |
| `apps/kira-studio/frontend/src/editor/languages.ts` | a `'graphql'` `StreamLanguage`, the file's own third-shape precedent |
| `apps/kira-studio/tests/ui/http-request-body.spec.ts` | **new** |
| `apps/kira-studio/tests/unit/go-ts-vocabulary-parity.spec.ts` | a second extractor + the body-mode/`Content-Type` parity pair |
| `docs/ARCHITECTURE.md` | the body-mode set, path-not-bytes, restored-state normalization |

### 0.2 Out of scope, explicitly

- **P4–P11's own rows**, listed in the header blockquote.
- **A response-side change of any kind beyond D13's XML pretty toggle.** In particular, a binary
  *response* is still reported and not rendered — P2 §8 OQ-3 already assigned that to P9's raw
  inspector, and §4 D14 restates why P3 is not the phase to take it.
- **A Description column** on params/headers/form-data/urlencoded rows. Postman's format carries one
  on all four; adding it to two of them would be incoherent. §8 OQ-5.
- **Multi-file form-data rows** (Postman's `src` may be an array). One file per row in P3; §8 OQ-6.
- **Postman's `file.content`** (inline base64 body content in the collection format). Only `src` (a
  path) is supported — which is the whole point of D4. §8 OQ-6.
- **A per-request timeout.** `defaultTimeout = 30s` (`client.go:26`) now also bounds a file upload,
  which is a real new limitation; §8 OQ-2 hands it forward rather than special-casing it.
- **Any new dependency**, TypeScript or Go (§4 D1).
- **Any storage migration, any new op kind, any new tab kind, any bindings *service* addition.**
  §3 establishes why none is needed. One bound method's *argument struct* changes, so bindings are
  regenerated — that is not a service addition.
- **Any menu, palette or accelerator change.** P2 §8 OQ-7 stays open, unchanged.

### 0.3 Ground rules

- **Studio's rendered output does not change.** C3 is the one commit that touches shared Studio
  state, and it is a strictly-additive normalization guarded by the existing suite (§4 D3).
- **A file's bytes never cross the IPC bridge.** §2 F7 measures what would happen if they did; §4 D4
  is that measurement applied, not a preference.
- **`views/httprequest/**` may not import another `views/<kind>/**`** (`biome.json:66-104`, the
  cross-kind list P2's C5 added `httprequest` to at `:87`/`:95`), and **`http/**` may not import
  `views/**` or `project/**`** (`:127-149`). Every new file in §0.1 lands in `views/httprequest/`,
  which is where a tab view's own modules belong (P2 D7); nothing new lands in `http/`.
- **Go owns the network, and now also owns the filesystem read.** `docs/ARCHITECTURE.md:41`'s Stack
  row and the "Go owns the network" invariant already put the socket in Go; D4 puts the file read
  beside it, on the exact precedent `internal/adapters/s3/transfer.go:103-117` already set for S3
  uploads.

---

## 1. What the code does today

### 1.1 The request body is two modes and one string, everywhere

`packages/shared/domain/http.ts:58` is the whole vocabulary:
`export const httpBodyModeSchema = z.enum(['none', 'json'])`. The tab state carries exactly two
related fields, `bodyMode` (`:79`) and `body: z.string().default('')` (`:80`).

The renderer's send (`views/httprequest/state.ts:45`) is one line —
`const hasBody = tab.state.bodyMode === 'json';` — and the wire carries
`body: hasBody ? tab.state.body : ''` plus `hasBody` (`:54-55`). The bound service's args mirror
that pair (`internal/bridge/http.go:31-32`), and `httpclient.Request` mirrors it again
(`internal/httpclient/client.go:67-68`). `Send` turns it into a reader in three lines:

```go
var body io.Reader
if req.HasBody {
    body = strings.NewReader(req.Body)
}
httpReq, err := http.NewRequestWithContext(sendCtx, req.Method, u.String(), body)
```

(`client.go:210-215`). **No `Content-Type` is ever set by the client** — not for JSON, not for
anything. A P2 user typing a JSON body and not adding `Content-Type: application/json` by hand sends
it without one. The only header the client adds on the user's behalf is `User-Agent`
(`client.go:222-235`).

The UI half is a two-option `SegmentedControl` inline in `HttpRequestView.vue:85-92`, a
`CodeMirrorHost language="json"` gated on `bodyMode === 'json'` (`:215-221`), and a Beautify
`IconButton` gated the same way (`:204-210`) calling `beautifyJson(state.body, 'indented')`
(`:102-110`).

### 1.2 The three key/value surfaces are already three near-copies

- `RequestHeadersTable.vue` — checkbox + name + value + remove, over `tab.state.headers`, with a
  trailing always-blank row (`:14-17`) and `updateField`/`toggleEnabled`/`removeRow` (`:19-37`).
- `QueryParamsTable.vue` — name + value + remove, over a `computed` derived from `state.url`
  (`:15-16`), writing back through `writeBack` (`:18-25`). No checkbox (P2 D6/§8 OQ-1).
- The two templates (`RequestHeadersTable.vue:40-71`, `QueryParamsTable.vue:39-63`) and the two
  `<style>` blocks are the same file with two of the four controls swapped.

### 1.3 There is already a native file picker, and it already hands Go a *path*

`bridge/files.go` exposes `FilesService.ChooseOpen(FilesChooseOpenArgs) (FilesChooseOpenResult, error)`
(`:78-100`), backed by `internal/shell/app.go:89-98`'s
`app.Dialog.OpenFile().AttachToWindow(...).PromptForSingleSelection()`. It returns
`ChosenFile{Path, Name string; Size int64}` (`files.go:29-33`) — the `Size` comes from a Go-side
`os.Stat` the service does itself (`:92-95`). `wailsFilter` (`:107-124`) collapses an Electron-style
filter list onto the single extension set Wails' macOS panel applies, and returns `ok == false` for
a `*` wildcard, which is how "all files" is expressed.

`control.ts:146-148` wraps it as `filesChooseOpen(args?)`. `tests/ui/support/ipcChannels.ts:34` and
`mockRuntime.ts:48` already carry the channel and its FQN, so the picker is mockable at the
`tests/ui` tier today.

**The end-to-end precedent already exists and is not hypothetical.** `UploadObjectDialog.vue:42-49`
picks a file, keeps `{path, name, size}` in a local ref, and `onUpload` (`:55-78`) sends only
`sourcePath: file.path` to Go. On the Go side `s3/mutate.go:181-185` pulls that path out and
`s3/transfer.go:103-117`'s `openUploadBody` `os.Stat`s it, refuses it over
`page.ObjectUploadMaxBytes` (`page/chunk.go:18`, 5 GiB), then `os.Open`s it and hands the
`*os.File` to the SDK as a seekable body of known length. **Not one byte of that file passes through
the webview.**

### 1.4 The editor already knows XML; it does not know GraphQL

`editor/languages.ts:10` declares `EditorLanguageId = 'json' | 'xml' | 'sql' | 'mongo' | 'redis' | 'plain'`
and `languageExtension` (`:162-181`) routes `'xml'` to `@codemirror/lang-xml`'s `xml()`
(`:167-168`) — a dependency already in `package.json:42`. The file establishes **three** shapes for
adding a grammar, in its own words: map onto a vendored `lang-sql` dialect, define an
`SQLDialect` (`:112-136`), or hand-write a `StreamLanguage` (`mongoLanguage` `:64-68`,
`redisLanguage` `:100-104`, both ~40 lines of tokenizer).

`beautify.ts` already exports **four** functions, not two: `scanJson` (`:177`), `beautifyJson`
(`:241`), `scanXml` (`:455`) and `beautifyXml` (`:502`) — the XML half described by its own header
comment as lossless, *"Attributes are copied verbatim inside their tag, never re-quoted/reordered/
entity-normalised"* (`:250-253`). `views/shared/celleditor/formats.ts:83-85`'s `canBeautify` is
already `format === 'json' || format === 'xml'`, and `beautifyFor` (`:94-98`) already dispatches
between them.

`ResponsePane.vue` uses only the JSON half: `isJson` is `scanJson(response.body).ok` (`:30`), the
Pretty/Raw toggle is gated on it (`:82`), and `bodyText` (`:56-63`) calls `beautifyJson` for
Pretty. A base64 body renders as the string *"N bytes of binary data"* (`:110-112`).

### 1.5 A restored tab's state is **never validated and never defaulted**

This is the one thing in P2's design that reads differently against the tree than it does in the
plan. `hydrateTabs` (`state/tabs.ts:178-197`) is:

```ts
const tabs = await control.tabsList();
tabsState.tabs = tabs;
```

`control.tabsList` (`control.ts:290-291`) is `unwrap(TabsService.List({windowKey})).then(r => trust<TabRecord[]>(r ?? []))`,
and `trust` (`control.ts:99-101`) is `v as T`. Grepping the entire renderer for a Zod parse finds
**two** call sites, both `connectionInputSchema` in `ConnectionDialog.vue` (`:293`, `:342`).
`tabRecordSchema` (`packages/shared/domain/tabs.ts:183-220`) is referenced exactly three times in
the repo, all inside its own file, and none of them is a `parse`/`safeParse`.

Go's side validates only the envelope, by design: `model.TabRecord.State` is `json.RawMessage`
(`model/tabs.go:18`) with a comment saying per-kind shape *"stays renderer-side"* (`:8-12`);
`repos/tabs.go`'s `List` drops a row only for a non-object `state_json` or an unrenderable kind
(`:50-60`), and `Save` validates only ID/path/kind/object-ness (`model/tabs.go:54-67`).

So today, a `state_json` missing a field simply arrives with that property `undefined`, and a
`state_json` carrying a stale enum value simply arrives with that value. §2 F1 draws out what that
means for P3.

### 1.6 The `tests/ui` tier can drive all of this, with one documented constraint

`mockRuntime.ts:353` — `const snap = list.length === 1 ? list[0] : findSnapWithRefreshFallback(callArgs)`
— a channel with exactly one snapshot answers args-blind. The renderer mints the send's op id
(`state.ts:37`), so two `httpSend` snapshots in one test are unmatchable (P2 §8 OQ-8). Both
`IPC.httpSend` (`ipcChannels.ts:56`) and `IPC.filesChooseOpen` (`:34`) are already registered, so a
file-pick-then-send flow is one snapshot each and needs no `mockRuntime.ts` change.

---

## 2. Findings

### F1 — P2's `.default()` forward-compatibility argument is **inert at runtime**, and P3 is the phase that finds out
P2 D6 states: *"Every field carries `.default()`, so a tab saved by P2 still restores once P3 widens
`bodyMode`"*, citing `repos/tabs.go`'s drop-on-failed-parse. §1.5 shows neither half is true of the
restore path: nothing parses, so nothing is dropped **and nothing is defaulted**. The `.default()`s
fire in exactly one place — `defaultHttpRequestTabState()`'s `httpRequestTabStateSchema.parse({})`
(`http.ts:89-90`) — which only ever runs for a *brand-new* tab.

Two concrete consequences for P3, in opposite directions:

- **Good news:** widening `httpBodyModeSchema` cannot drop a saved tab. There is no parse to fail.
- **Bad news:** a tab saved by P2 restores with `state.formData === undefined`,
  `state.graphqlQuery === undefined`, and `state.bodyMode === 'json'` — a value P3's own union does
  not contain. A component doing `props.tab.state.formData.map(...)` throws inside a render, which
  in this app means the tab renders blank with a console error and no user-facing explanation.

The same latent gap already exists for `keyValueTabStateSchema`'s and `streamTabStateSchema`'s own
`.default()` comments (`packages/shared/domain/tabs.ts:85-89`, `:118-133`), which make the identical
claim. §4 D3 fixes the class, not just P3's instance.

### F2 — Postman's body-mode set is **six**, and "XML" is not one of them
Verified against the published schema rather than recalled. `https://schema.postman.com/json/collection/v2.1.0/collection.json`
defines `request.body.mode` as the enum `["raw", "urlencoded", "formdata", "file", "graphql"]`, plus
the absence of a body (Postman's UI calls that **none**). Postman's own docs describe the builder's
radio set as *"none, form data, URL-encoded, raw, binary, or GraphQL"*
([Send parameters and body data](https://learning.postman.com/docs/use/send-requests/create-requests/parameters)).
Two spellings therefore differ between UI and format, both deliberately:

| Postman UI label | Postman format `mode` |
|---|---|
| none | *(no `body` member)* |
| form-data | `formdata` |
| x-www-form-urlencoded | `urlencoded` |
| raw | `raw` |
| binary | `file` |
| GraphQL | `graphql` |

**XML and JSON are not modes.** They are values of the raw sub-selector, whose exact list is
*"Text, JavaScript, JSON, HTML, or XML"* (same doc), stored as `body.options.raw.language`. So
`docs/v1.2/SPEC.md`'s P3 row — *"raw text, JSON, XML, form-data …"* — enumerates a mix of one mode
and two of its sub-languages; §4 D2 resolves that in Postman's favour and says so.

The per-item shapes, quoted from the schema:

- `urlencoded`: `{key (required), value, disabled (default false), description}[]`
- `formdata`: an `anyOf` of a **text** item `{key, value, type:"text", contentType, disabled, description}`
  and a **file** item `{key, src: string|null|array, type:"file", contentType, disabled}`
- `file`: `{src: string|null, content: string}`
- `raw`: a bare `string`
- `graphql`: `{"type": "object"}` — **untyped in the schema**, which is why §8 OQ-1 exists.

### F3 — Postman's `Content-Type` behaviour is a *default*, not an override, and P2's client sets none at all
Postman sets a header from the raw language (Text→`text/plain`, JSON→`application/json`,
XML→`application/xml`, HTML→`text/html`, JavaScript→`application/javascript`), sets
`multipart/form-data` with a boundary for form-data, `application/x-www-form-urlencoded` for
urlencoded, `application/json` for GraphQL, and — explicitly — *"Postman doesn't set any header type
for the binary body type."* And: *"If you manually select a Content-Type header, that value will
take precedence over what Postman sets."*

Against that, `client.go:196-247` sets no `Content-Type` in any circumstance. So P3 is not
*changing* a `Content-Type` policy; it is introducing the first one. The two values I could not
pin to a first-party Postman page rather than a synthesis are `application/javascript` (vs
`text/javascript`) and `application/xml` (vs `text/xml`); §8 OQ-4 records that rather than
pretending otherwise.

### F4 — `net/http` cannot replay a streamed body across a 307/308, and P2's client follows redirects by default
`sharedClient` has `CheckRedirect: checkRedirect` and follows up to `maxRedirects = 10`
(`client.go:31`, `:41-46`, `:100-113`). For 301/302/303, `net/http` rewrites the method to `GET` and
drops the body, so a streamed body is never re-read. For **307/308** it must resend the body
verbatim, and it does that through `Request.GetBody` — which is `nil` unless the caller set it.
`http.NewRequestWithContext` populates `GetBody` (and `ContentLength`) automatically **only** for
`*strings.Reader`, `*bytes.Reader` and `*bytes.Buffer`. P2's body is always a `*strings.NewReader`
(`client.go:212`), so P2 got this for free and never had to know. A `*os.File` or an `io.Pipe`
reader gets neither, and a 307 to a streamed body fails with
*"http: cannot retry request with non-replayable body"*.

### F5 — A streamed multipart body without `Content-Length` becomes chunked, and that is not a free choice
`net/http` sends `Transfer-Encoding: chunked` whenever `ContentLength` is unset (`0` with a non-nil
body is treated as unknown for a non-auto-detected reader). Several classes of endpoint reject a
chunked upload outright — S3-compatible presigned PUTs, PHP's default `enctype` handling, many WAF
front-ends. Postman sends a real `Content-Length`. So "stream it with `io.Pipe` and let it be
chunked" is not parity; §4 D6 does the arithmetic instead.

### F6 — `url.Values.Encode()` is the wrong builder for a urlencoded body, for two independent reasons
It **sorts keys** (`net/url`'s own documented behaviour), so a user's field order would be silently
rewritten — which for a form body is sometimes semantically load-bearing and is always confusing.
And it has no way to express a *disabled* row. Note the flip side of P2 D9: `url.QueryEscape`
encodes a space as `+`, which is **correct** in an `application/x-www-form-urlencoded` body and
**wrong** in a URL query string — exactly the reason `views/httprequest/url.ts:54-58`'s `buildQuery`
hand-rolls `encodeURIComponent` instead. The two encoders must therefore genuinely differ, and each
must say why.

### F7 — *Measured*: base64-through-IPC is not merely wasteful, it is **hard-capped at 64 MiB** and serialised into N round trips
Read from the pinned module, since nothing in `docs/ARCHITECTURE.md` documents the control plane's
own size behaviour (it documents the *data* plane's, `:871-882`).

- `internal/runtime/desktop/@wailsio/runtime/src/runtime.ts:21` — `const CHUNK_THRESHOLD = 512 * 1024;`
- `:159-163` — a serialized bound-call body over that threshold goes through `sendChunked`.
- `:189-226` — `sendChunked` `TextEncoder().encode()`s the **whole** body string (a full extra copy
  in the webview), slices it into 512 KiB pieces, and `await`s them **serially**, one `fetch` per
  chunk.
- `pkg/application/transport_http.go:36-38` —
  `maxChunkTotal = 1024`, `maxChunkBodyBytes = 1024 * 1024`, `maxAssembledBytes = 64 * 1024 * 1024`.
- `:243-248` — the assembled body over 64 MiB is refused outright: `"assembled body too large"`.
- `:270-278` — the assembled bytes are then `json.Unmarshal`ed whole into the request struct.

So a 48 MiB file base64-encoded is 64 MiB — *exactly* the ceiling — and would arrive as **128
sequential HTTP round trips**, after being held simultaneously as a JS string, a `Uint8Array`, and a
Go `[]byte`, before `encoding/json` parses it. A 50 MiB file cannot be sent **at all**, with an
error message the user could never map back to "your attachment is too big". Meanwhile the S3
upload path (§1.3) already sends a 5 GiB file with a ~200-byte call. §4 D4 is this measurement
applied.

### F8 — *Verified safe*: nothing outside `views/httprequest/` and the two wire structs reads the body fields
`git grep bodyMode` reaches `packages/shared/domain/http.ts`, `HttpRequestView.vue` and
`views/httprequest/state.ts`, and nothing else. `hasBody` reaches `http.ts:28`,
`control.ts:275`, `bridge/http.go:32`/`:65`, `client.go:68`/`:211`,
`views/httprequest/state.ts:45`/`:55`, and `tests/ui/http-request.spec.ts:86`. There is no Go
mirror of the tab-state schema at all (`model/tabs.go:8-12`), no `state_json` reader in Go, and no
op-log or storage consumer. **The blast radius of changing the body's shape is those eight files
plus one test assertion.**

### F9 — *Verified safe*: the op log, the op kinds, the tab kinds and the storage schema all need nothing
P3 adds no tab kind (`'http-request'` already exists in all four vocabularies —
`tabs.ts:7-19`, `:26-35`, `:42-51`, `model/tabs.go:26-32`) and no op kind (`'http'` already exists).
`tests/unit/go-ts-vocabulary-parity.spec.ts` therefore needs no change *for that reason*; §4 D12
extends it for a different one. `state_json` is opaque to Go, so a widened state schema is not a
migration.

### F10 — `duplicateState` deep-copies exactly one array, and P3 adds two more
`state/tabKinds.ts:185-188` is `{...tab.state, headers: tab.state.headers.map(h => ({...h}))}` with a
comment saying headers are deep-copied *"since each is an object in an array"*. `formData` and
`urlEncoded` are objects in arrays too; a shallow spread would make a duplicated tab share the
originals' row objects, so editing one request's form fields would edit the other's. Easy to miss,
invisible until someone duplicates a tab.

### F11 — `bridge/http.go` is the only caller of `httpclient.Send`, and `HttpService.Send`'s signature is already the awkward one
`Send(ctx context.Context, args HttpSendArgs)` (`bridge/http.go:46`) — P2 §6.1 flagged the
context-injection question as an explicit verification step and it came out fine (`control.ts:267-278`
calls `HttpService.Send(args)` with one argument). P3 changes `HttpSendArgs`'s *fields*, not the
method set, so bindings must be regenerated but the `$Call.ByName` FQN
(`mockRuntime.ts:69`: `HttpService.Send`) is unchanged and `tests/ui`'s channel map needs no edit.

### F12 — `SegmentedControl` is generic over a literal union and has no count slot
`theme/primitives/SegmentedControl.vue:5-14` — `modelValue: T`, `options: {value: T; label: string; title?: string; testid?: string}[]`,
`size?: 'sm'|'md'`. P2 already worked around the missing count slot by baking the count into
`label` (`HttpRequestView.vue:65-79`). Six body-mode options with Postman's own labels
(`x-www-form-urlencoded` is 21 characters) is a real width question, but `title` is available for
tooltips and the toolbar row can scroll — §4 D9 states the trade rather than widening a shared
primitive for one caller.

### F13 — The `-tags server` build has no file dialogs, and P3's file surfaces are the first thing that would notice
`docs/ARCHITECTURE.md:1257-1259`: *"Server mode has no file dialogs (`FilesService.ChooseSave`/`ChooseOpen`
answer a real HTTP 422), so a spec needing one stubs exactly that method through a passthrough route
that reuses `CHANNEL_TO_FQN`."* `tests/e2e-real/` is the only tier on that build, and P3 adds no
`e2e-real` coverage, so nothing breaks — but the property is worth recording, because it is the
reason §6.4 lists the native picker as real-hardware-only.

### F14 — A local path in the send args is a capability the renderer already has, and P3 does not widen it
`FilesService.ChooseOpen` returns a real absolute path to the renderer, and `uploadObject`
(`UploadObjectDialog.vue:62-69`) already hands an arbitrary renderer-supplied `sourcePath` to Go,
which opens it with no check that it came from a dialog. P3's file body modes use the identical
shape. So the threat model is unchanged — but it is unchanged at a level worth naming rather than
inheriting silently, since P3 is the first place a local file's bytes leave the machine over an
arbitrary user-typed URL. §8 OQ-7.

### F15 — `mime/multipart.Writer` produces byte-identical framing for a fixed boundary, which is what makes an exact `Content-Length` computable
`Writer.SetBoundary(string)` fixes the boundary; `CreatePart(textproto.MIMEHeader)` writes a
deterministic `--boundary\r\n<canonical headers>\r\n\r\n` prefix; `Close()` writes
`\r\n--boundary--\r\n`. Nothing in the writer is length- or content-dependent except the part
contents themselves. So a *dry run* over a counting writer — same boundary, same headers, adding
each file's `os.Stat` size instead of copying it — yields the exact byte count the real pass will
produce. §4 D6 uses this.

---

## 3. Checked, and not fired

- **No storage migration, no `state_json` column change, no `TabsRepo`/`OpsRepo` change.** F9 +
  `model/tabs.go:8-12` (state is opaque `json.RawMessage`).
- **No new tab kind, no new op kind, no new bound service, no `tests/ui/support/` channel or FQN
  addition.** F9 + F11 + §1.6 (`filesChooseOpen` is already mapped at `mockRuntime.ts:48`).
- **No new `httpclient` error code.** `CodeBadRequest`'s own doc is *"unparseable URL, non-http(s)
  scheme, missing host, unknown method — refused before anything is sent"* (`errors.go:14-16`), and
  every new failure P3 introduces (a form-data file that no longer exists, GraphQL variables that
  are not JSON, a directory chosen as a binary body) is exactly that: refused before a byte goes
  out. `errors.go` is untouched.
- **No new dependency.** §4 D1 states the check per candidate rather than asserting the conclusion;
  `NOTICES.md` and both `package.json`s are untouched.
- **No `beautify.ts` change.** F13 of P2 established `beautifyJson`'s losslessness; §1.4 shows
  `scanXml`/`beautifyXml` already exist with the same property. P3 imports them; it writes none.
- **No `@codemirror/lang-xml` addition** — `package.json:42` already has it and
  `languages.ts:167-168` already routes to it.
- **No `theme/primitives/` addition.** F12 (`SegmentedControl`), plus `TextField`, `IconButton`,
  `AppButton`, `MessageStrip`, `PanelSplitter` and `EmptyState` cover every surface P3 draws. The
  one new *shared* component (`FieldRowsTable.vue`) is `views/httprequest/`-local because it is
  specific to this view's three tables, not a house primitive.
- **No `bridge/files.go` change and no second file-dialog API.** `ChooseOpen` already returns
  `{path, name, size}` and already accepts an optional title and filters (`:25-28`, `:78-100`).
- **No `state/viewCommands.ts` change.** P2 F5 established `CommandTabKind` is a closed five-member
  union a new kind cannot be a member of; P3 adds no kind at all.
- **No `layoutSchema` change.** The GraphQL query/variables split is a fixed proportion, not a
  persisted one (D11).
- **No change to `client.go`'s redirect, timeout, TLS, proxy, `User-Agent`, `Host`-header or
  response-reading behaviour.** Only the body-construction lines (`:210-215`) and one
  `Content-Type` guard are touched.

---

## 4. Decisions

### D1 — No new library, and here is the check rather than the assertion
`AGENTS.md` requires reaching for a maintained library first and **naming the requirement** when
declining one. Five candidates were real enough to weigh:

- **A multipart-building library** (`github.com/technoweenie/multipartstreamer`, `go-resty`'s
  `SetFileReader`, etc.). Declined on the requirement, not the licence: what P3 needs is (a)
  streaming from disk, (b) an *exact* `Content-Length` (F5), and (c) a replayable `GetBody` (F4).
  `mime/multipart` in the stdlib gives (a) directly and, because its framing is deterministic for a
  fixed boundary (F15), gives (b) in ~20 lines of dry run. No candidate library offers (b) at all —
  `multipartstreamer` computes a length but only for a single file and with its own opinionated part
  headers; resty's builders wrap `net/http` anyway and would sit between the user's typed field
  names and the wire, which is the exact thing P2 D1 declined a client library to avoid.
- **A MIME-type sniffer** (`github.com/gabriel-vasile/mimetype`, `h2non/filetype`). Declined: the
  per-part content type is either what the user typed in the row's Content type field or
  `application/octet-stream`, which is what `multipart.CreateFormFile` already uses. Sniffing a
  file's real type would *silently* override what the user asked for, and P2 D1's whole standard is
  "no layer that can rewrite what the user asked for". Note the app already declined this once:
  `packages/shared/domain/object-store.ts:52-54` says its extension table is *"deliberately small
  and explicit rather than a dependency: the value is shown in an editable field, so a miss is
  visible and correctable before anything is sent"* — the same argument, already made, in the same
  situation. P3 reuses `contentTypeForFilename` (`:55-60`) from that module for the *prefill*.
- **A GraphQL parser/printer** (`github.com/vektah/gqlparser`, `graphql-js`). No subject. P3 sends
  the query text verbatim; it never parses, validates, minifies or re-prints it. Introspection-driven
  validation is a real feature and is not in this chapter's phase table at all.
- **`cm6-graphql` / `graphql-language-service`** for GraphQL syntax highlighting. Declined on cost
  against requirement: both pull the `graphql` reference implementation (a schema-aware parser,
  ~100 KB min) to deliver, for us, *colour* — we have no schema to be aware of, and the app's bundle
  is a stated property (`docs/ARCHITECTURE.md:28`, exactly two dynamic chunks). `editor/languages.ts`
  already establishes a hand-written `StreamLanguage` as this file's third supported shape, twice
  (`:64-68`, `:100-104`), for the identical requirement — highlight-only, no completion, no
  validation. D10 takes that shape.
- **A form/urlencoded encoder** (`net/url`'s own `Values.Encode`, `google/go-querystring`).
  Declined against F6: both sort keys and neither can express a disabled row.

### D2 — The vocabulary is **Postman's format spelling**, and the UI labels are **Postman's UI labels**
`httpBodyModeSchema` becomes:

```
'none' | 'raw' | 'urlencoded' | 'formdata' | 'file' | 'graphql'
```

— F2's format column verbatim, including `'file'` for what the UI calls *binary*. Two independent
reasons, and one honest cost:

- **P4's row makes Postman the exchange format** (`docs/v1.2/SPEC.md`: import *"reproduces its
  structure faithfully"*, export *"writes a real Postman Collection v2.1 JSON file"*). Every mode
  name we spell differently is one more entry in a rename table P4's importer, P4's exporter and
  P7's curl generator each have to get right and can each drift on.
- **A rename table is exactly the failure shape D12 exists to catch**, and catching it costs a test;
  not having one costs nothing.
- **The cost**, stated plainly: `'file'` reads as "a file field" to someone who has just read the
  form-data code, where a file field is a `formdata` item. The mitigation is naming, not renaming —
  the constant is `BodyFile`, its doc comment says *"Postman's `file` mode: one local file as the
  entire body; the UI calls this **binary**"*, and the UI's own label is `binary`.

The raw sub-selector is its own field, `rawLanguage`:

```
'text' | 'javascript' | 'json' | 'html' | 'xml'
```

— F2's list verbatim, in Postman's own dropdown order. `docs/v1.2/SPEC.md`'s P3 row lists "raw text,
JSON, XML" as if they were three modes; this plan follows Postman's actual model instead, because
the row's own stated bar is *"and any other body mode Postman's own format exposes"* and the format
exposes five modes with a sub-selector, not seven modes.

### D3 — A restored tab's state goes through its own kind's schema, in the registry, **merge-only**
F1's bad half has to be fixed before the schema widens, and the fix belongs in the registry P1 built
for exactly this (`docs/ARCHITECTURE.md:594-596`: *"Adding a tab kind means one registry entry
each"*). `TabKindDef` gains a ninth member:

```ts
/** A restored record's raw `state`, normalized through this kind's own schema — the one place
 *  every *TabStateSchema's `.default()` actually fires. `null` means "not parseable", and the
 *  caller keeps what was stored. */
parseState(raw: unknown): Extract<TabRecord, { kind: K }>['state'] | null;
```

Every entry is a one-liner over the schema it already imports. `hydrateTabs` (`state/tabs.ts:179-181`)
becomes:

```ts
const tabs = await control.tabsList();
tabsState.tabs = tabs.map((t) => {
  const parsed = TAB_KINDS[t.kind].parseState(t.state);
  return parsed ? ({ ...t, state: parsed } as TabRecord) : t;
});
```

**Merge-only, never replace, and that is the load-bearing part.** On success the record gains the
defaults it was missing; on failure it is kept exactly as it arrives today. So this change can only
ever *add* a field's default and can never lose one — which is what makes it safe to land in a
body-modes phase rather than a state-management one. A "parse or reset to `defaultState()`" version
would be simpler and strictly worse: a Studio tab whose stored state predates a *required* field
would silently lose its filter, its sort and its page position, and nothing in P3 would have any
reason to notice.

Three properties worth stating because they are testable:

- It makes `keyValueTabStateSchema`'s and `streamTabStateSchema`'s own comments true rather than
  aspirational (`packages/shared/domain/tabs.ts:85-89`, `:118-133`) — a pre-existing gap P3 closes
  as a side effect, not as its purpose.
- Zod strips unknown keys by default, so a key no schema knows about is dropped on restore instead
  of round-tripping. Deliberate and desirable: `tabsSave` writes `tabsState.tabs` straight back, so
  today a garbage key persists forever.
- The guard is the **existing suite passing with no spec edits**. If `tabs.spec.ts`,
  `data-view.spec.ts`, `console*.spec.ts`, `stream*.spec.ts` or `workbench.spec.ts` needs an edit,
  the merge rule was got wrong.

### D4 — A file's bytes reach the wire **from Go, by path**, and never enter the renderer or the bridge
The renderer picks a file through the existing native dialog, keeps `{path, name, size}` in
`state_json`, and sends **the path**. Go opens it and streams it. This is the phase brief's second
question, and F7 is the answer rather than an aesthetic preference:

| | bytes through IPC | path through IPC |
|---|---|---|
| Wire cost for a 20 MiB file | 26.7 MiB base64, split into **54 serial `fetch` round trips** (F7: `CHUNK_THRESHOLD = 512 KiB`) | one ~200-byte call |
| Peak copies | JS string + `Uint8Array` + Go `[]byte` + `encoding/json`'s parse, all live at once | one `os.File` + a 32 KiB copy buffer |
| Hard ceiling | **64 MiB assembled** (`transport_http.go:38`, `:243-248`), refused as *"assembled body too large"* | the filesystem's |
| Precedent in this repo | none | `s3/transfer.go:103-117`, shipping since P33/P58d, 5 GiB cap |
| Cancellation | the chunk loop is `await`ed serially in JS; a Stop mid-upload cancels nothing already sent | one context, already wired through `RunOp` |

The one thing the path form gives up is that Go reads a path the renderer supplied rather than one
it can prove came from the dialog — F14 shows that is already true of the S3 upload path, so P3
inherits the posture rather than widening it; §8 OQ-7 records it as a deliberate carry-forward.

Concretely: `FormDataField.path`, `binaryFile.path` — absolute, exactly as
`ChooseOpen` returned it. `name` and `size` are kept alongside purely so the builder can render
`report.csv (1.2 MB)` without a second round trip, the same three fields
`UploadObjectDialog.vue:20` already keeps. Go re-`os.Stat`s at send time and never trusts the stored
`size` — the file may have changed or vanished since it was picked, and a stale size would poison
the `Content-Length` (D6).

### D5 — The wire is one tagged union, replacing `body`/`hasBody`
`internal/httpclient`'s `Request` (`client.go:63-69`) becomes:

```go
type Request struct {
    Method  string   `json:"method"`
    URL     string   `json:"url"`
    Headers []Header `json:"headers"`
    Body    Body     `json:"body"`
}

// Body is a tagged union: Mode selects which member is meaningful and every other member is
// ignored. Postman's own `mode` spelling (P3 D2) — "file" is what its UI calls binary.
type Body struct {
    Mode        BodyMode     `json:"mode"`
    Raw         string       `json:"raw"`
    RawLanguage string       `json:"rawLanguage"`
    URLEncoded  []Field      `json:"urlEncoded"`
    FormData    []FormField  `json:"formData"`
    File        string       `json:"file"`     // absolute local path (D4)
    GraphQL     GraphQLBody  `json:"graphql"`
}

type Field struct{ Name, Value string }

type FormField struct {
    Name        string `json:"name"`
    Kind        string `json:"kind"`        // "text" | "file"
    Value       string `json:"value"`       // Kind == "text"
    Path        string `json:"path"`        // Kind == "file", absolute local path
    ContentType string `json:"contentType"` // optional per-part override, "" = default
}

// Variables is the user's own JSON text, carried verbatim rather than as a decoded map, so a
// large integer literal survives byte-identical — the same losslessness rule beautify.ts's own
// header comment states for JSON.
type GraphQLBody struct{ Query, Variables string }
```

`HttpSendArgs` (`bridge/http.go:25-33`) drops `Body string`/`HasBody bool` and gains
`Body httpclient.Body`; `Method`, `URL` and `Headers` stay top-level, so the existing
`tests/ui/http-request.spec.ts:81-87` send-args assertion changes by exactly two keys.

**A union rather than five nullable members** because Go has no sum types and the Wails generator
emits a plain interface either way; a `Mode` discriminant plus zero-valued siblings is the shape
`SavedQuery` already uses for the same reason (`control.ts:294-296`: *"Go has no sum types, so the
polymorphic body is opaque JSON on the wire and the discriminant is a plain [string]"*).

**Only enabled rows cross the wire.** The renderer filters `enabled === false` and
empty-named rows out before sending, exactly as it already does for headers
(`views/httprequest/state.ts:42-44`). `disabled` is builder state, never wire state — the same rule
P2 D6's own comment states for headers (`http.ts:46-48`).

### D6 — Go builds every body, with an exact `Content-Length` and a working `GetBody`
`internal/httpclient/body.go` exports one function:

```go
// buildBody turns a Body into what net/http needs. contentType is the default this mode implies
// (D7 decides whether it is actually used); length is exact, never -1, so nothing here is ever
// sent chunked (F5).
func buildBody(b Body) (body io.ReadCloser, getBody func() (io.ReadCloser, error),
                        length int64, contentType string, err error)
```

Per mode:

| Mode | Reader | Length | `GetBody` | Default `Content-Type` |
|---|---|---|---|---|
| `none` | nil | 0 | nil | — |
| `raw` | `strings.NewReader(b.Raw)` | `len(b.Raw)` | re-reader | from `rawLanguage` (D7) |
| `urlencoded` | `strings.NewReader(encoded)` | `len(encoded)` | re-reader | `application/x-www-form-urlencoded` |
| `graphql` | `bytes.NewReader(envelope)` | `len(envelope)` | re-reader | `application/json` |
| `file` | `os.Open(path)` | `os.Stat` size | re-opens the file | **none** (F3) |
| `formdata` | `io.Pipe`, written by one goroutine | the dry run (below) | re-runs the whole pass with the same boundary | `multipart/form-data; boundary=…` |

**The exact multipart length, from F15.** One boundary is minted per send
(`multipart.Writer.Boundary()` from a throwaway writer, then `SetBoundary` on both passes). Pass one
writes the identical part headers to a counting `io.Writer` and, for each file part, adds the
`os.Stat` size instead of copying anything; pass two streams for real into the pipe. Same boundary,
same headers, same terminator ⇒ the count is the byte count, and `ContentLength` is set. ~25 lines,
no dependency (D1), and it is what makes the request indistinguishable on the wire from Postman's.

Three correctness details that are easy to get wrong and are therefore explicit:

- **A file that changes size between the dry run and the stream would desynchronise
  `Content-Length`.** Each file part is copied with `io.CopyN(part, f, size)`: a file that shrank
  yields `io.ErrUnexpectedEOF` and the pipe is closed with that error, failing the send loudly; a
  file that grew is truncated to the counted size. Either way the bytes sent match the header.
- **The writer goroutine must not outlive the request.** It writes into `pw` and exits on the first
  write error; cancelling the request closes `pr`, so the next write returns `io.ErrClosedPipe` and
  the goroutine returns. `defer pw.CloseWithError(err)` covers the error path.
- **`GetBody` for the streamed modes** (F4). For `file` it is `func() (io.ReadCloser, error) { return os.Open(path) }`.
  For `formdata` it re-invokes the same pass-two builder with the same boundary. Without this a
  307/308 redirect on a file upload fails with `net/http`'s
  *"cannot retry request with non-replayable body"* — a message that would be genuinely
  unattributable from the UI.

**Pre-send refusals**, all `CodeBadRequest` (§3), all before a byte goes out: a form-data or binary
path that does not exist, is a directory, or is unreadable; GraphQL variables that are not valid
JSON (`json.Valid`); a `formdata`/`urlencoded` row with an empty name that the renderer somehow let
through.

**The urlencoded encoder** is hand-written per F6/D1: `url.QueryEscape(name) + "=" + url.QueryEscape(value)`,
joined with `&`, **in the user's order**. Its doc comment states the `+`-vs-`%20` split against
`views/httprequest/url.ts:54-58` explicitly, so neither side can be "fixed" into the other later.

**The GraphQL envelope** is built by marshalling
`struct{ Query string `json:"query"`; Variables json.RawMessage `json:"variables,omitempty"` }`,
with `Variables` being the user's text verbatim when it is non-blank and valid JSON. Marshalling a
`json.RawMessage` copies the bytes through, so a 19-digit id in the variables survives
byte-identical — the same reason P2 F13 chose `beautifyJson` over `JSON.stringify`. An empty
variables pane omits the member entirely rather than sending `{}`, since some servers reject a
non-object `variables` and none require the key.

### D7 — `Content-Type` is a **default Go applies only when the user supplied none**, with one named exception
`Send` gains one guard between the header loop and `sharedClient.Do`:

```go
if ct := buildBody's contentType; ct != "" && !userSetContentType {
    httpReq.Header.Set("Content-Type", ct)
}
```

matching Postman exactly (F3: *"if you manually select a Content-Type header, that value will take
precedence"*). The table:

| Mode / raw language | Default |
|---|---|
| raw · text | `text/plain` |
| raw · javascript | `application/javascript` |
| raw · json | `application/json` |
| raw · html | `text/html` |
| raw · xml | `application/xml` |
| urlencoded | `application/x-www-form-urlencoded` |
| formdata | `multipart/form-data; boundary=<generated>` |
| graphql | `application/json` |
| file (binary) | **none** |
| none | none |

**The one exception, and why it is not silent.** For `formdata`, a user-supplied
`Content-Type: multipart/form-data` **without** a `boundary` parameter would produce a request no
server can parse — the boundary is not knowable to the user, since Go mints it. So: if the user's
own value's media type is `multipart/form-data` and it carries no `boundary`, the generated boundary
is appended to *their* value (preserving any other parameters they set, e.g. `charset`); if it
carries a boundary, theirs is used verbatim for the header **and** passed to
`multipart.Writer.SetBoundary`, so the body actually matches. Any other media type is honoured
untouched — a user who deliberately mislabels a multipart body gets what they asked for.

This is also the one place P2's client changes behaviour for an existing user: a P2 `json` body sent
with no hand-written `Content-Type` header used to go out with none and will now go out with
`application/json`. That is a bug fix (§1.1: P2 set none at all, which is not Postman parity and is
not what any API expects), and it is called out in the C5 commit message rather than slipped in.

### D8 — The state schema grows six fields, and P2's `'json'` survives as a **one-line legacy alias**
`packages/shared/domain/http.ts`, replacing `:58` and extending `:75-86`:

```
method              (unchanged)
url                 (unchanged)
headers             (unchanged)
bodyMode            'none'|'raw'|'urlencoded'|'formdata'|'file'|'graphql'   .default('none')
rawLanguage         'text'|'javascript'|'json'|'html'|'xml'                 .default('json')
body                string                       — the raw buffer          .default('')
urlEncoded          { name, value, enabled }[]                             .default([])
formData            { name, kind, value, path, fileName, fileSize,
                      contentType, enabled }[]                             .default([])
binaryFile          { path, name, size } | null                            .default(null)
graphqlQuery        string                                                 .default('')
graphqlVariables    string                                                 .default('')
requestPane         (unchanged)
responsePane        (unchanged)
responseView        (unchanged)
requestPaneHeight   (unchanged)
```

**The legacy alias is two lines, not a migration:**

```ts
export const httpBodyModeSchema = z.preprocess(
  // P2 shipped bodyMode: 'json'; P3 D2 splits that into raw + rawLanguage. rawLanguage's own
  // .default('json') completes the mapping, so this is the whole of it.
  (v) => (v === 'json' ? 'raw' : v),
  z.enum(['none', 'raw', 'urlencoded', 'formdata', 'file', 'graphql']),
);
```

It works **only because D3 landed first** — nothing parses a restored state today (F1), so without
D3 this preprocess would never run on the value that needs it.

**`rawLanguage` defaults to `'json'`, not Postman's `'text'` — a deliberate, named divergence.** It
is what collapses the legacy mapping to one line, it is what an API client's user types nine times
out of ten, and Postman's own default *body mode* is `none` anyway, so the raw default only ever
applies after a conscious choice of raw. The alternative (default `'text'`, plus an object-level
preprocess to set `rawLanguage: 'json'` for the legacy case) is four more lines for a worse default.

**`body` keeps its name** rather than becoming `raw`: renaming it would need its own alias for the
same reason, for zero gain.

**Every mode keeps its own buffer**, which is Postman's behaviour and the reason the fields are flat
siblings rather than one nullable per-mode object: switching from raw to form-data and back must not
lose the raw text. Flat also keeps every field individually `.default()`-able, which is the property
D3 relies on.

**No Go mirror of this schema exists or is added** — `model/tabs.go:8-12` keeps `state_json` opaque
by design, and P2 D6 already established that.

**`duplicateState` deep-copies three arrays now, not one** (F10): `headers`, `urlEncoded`,
`formData`. `binaryFile` is copied as a fresh object.

### D9 — The body pane: a six-way `SegmentedControl`, a raw-language `select`, and a caption that says what will actually be sent
`views/httprequest/RequestBodyPane.vue` (the block currently inline at `HttpRequestView.vue:195-222`,
moved out because it grows from ~28 lines to ~120):

- **Mode**: one `SegmentedControl` with Postman's own six labels —
  `none · form-data · x-www-form-urlencoded · raw · binary · GraphQL` — in Postman's own order, each
  with a `title` tooltip. F12's width concern is real; the row is `flex` with `overflow-x: auto`, so
  a narrow pane scrolls rather than wrapping or truncating. Widening `SegmentedControl` for one
  caller was declined (§3).
- **Raw language**: a `p-select bordered` (the same primitive as the method select,
  `HttpRequestView.vue:154-161`), visible only in raw mode.
- **The auto-`Content-Type` caption**: a muted one-liner under the selector —
  *"Content-Type: application/json (auto)"*, or *"Content-Type: application/json (from your header)"*
  when the user has set one, or *"No Content-Type (binary)"*. This is the honest alternative to
  Postman's greyed "hidden headers" list: it tells the user exactly what D7 will do **before** they
  send, without injecting a fake row into `state.headers` that would then persist and go stale.
- **Beautify** is offered exactly where a lossless reformatter exists — raw·json and raw·xml — which
  is `formats.ts:83-85`'s own rule, reused rather than re-derived. On failure the existing
  `MessageStrip` + `beautifyError` shape (`HttpRequestView.vue:101-110`, `:212-214`) is kept
  verbatim.
- **The Body segment's count badge** (`HttpRequestView.vue:78`, currently the bare word *"Body"*)
  becomes mode-aware: `Body`, `Body (raw)`, `Body (3)` for a table mode with three enabled rows,
  `Body (1 file)` for binary. Same "bake it into the label" technique P2 already used for Params and
  Headers (`:65-79`).

### D10 — GraphQL gets a hand-written `StreamLanguage`, matching `languages.ts`'s own third shape
`EditorLanguageId` (`languages.ts:10`) gains `'graphql'`, and `languageExtension`'s switch
(`:162-181`) gains a case — the compiler catches every consumer, and there is exactly one total map
over the type (`formats.ts:69-80`, whose *values* are of this type and so is unaffected).

The tokenizer is ~40 lines in the shape `mongoToken` (`:22-62`) and `redisToken` (`:76-98`) already
set: `#` comments, `"…"` and `"""…"""` strings, numbers, `$variable`, `@directive`, the operation
keywords (`query`/`mutation`/`subscription`/`fragment`/`on`/`type`… as `keyword`), a field name
after a `{` or a newline as `propertyName`, punctuation and brackets. **Highlighting only, no
completion, no validation** — exactly what the file's own D23 comment says of mongo and redis
(`:12-14`). D1 records why `cm6-graphql` was declined for this.

The **variables** pane uses `language="json"`, which needs nothing new.

### D11 — The GraphQL pane is two stacked editors at a fixed proportion, not a persisted split
Query on top, Variables below, 2:1, separated by a plain divider — not a `PanelSplitter` bound to a
new state field. The request pane already has one persisted splitter
(`state.requestPaneHeight`, `HttpRequestView.vue:112-119`, `:225-232`) giving the user the macro
control over how much room the body gets; a second persisted ratio inside it is a tenth state field
to keep defaulted, migrated and reasoned about for a sub-pane most requests never open. If it grates
once GraphQL is used in anger, a `graphqlSplit: number .default(0)` field is a two-line addition on
top of D8's discipline — recorded so it is chosen, not drifted into.

### D12 — The Go/TS body vocabulary is guarded by the existing parity test, extended by one extractor
D2 puts the same six mode strings in two languages and D7 puts the same nine `Content-Type` values
in two languages (Go decides what to send; `views/httprequest/body.ts` decides what the caption
claims will be sent). That is exactly F1-of-P2's silent-drift shape, and
`tests/unit/go-ts-vocabulary-parity.spec.ts` already exists for it, already reads Go source as plain
text, and already documents that technique as deliberate (`:1-8`).

`extractGoStringSet` (`:19-30`) only handles a `map[string]bool` literal, so P3 adds a sibling
`extractGoStringMap` for a `map[string]string` literal and two tests:

1. `httpclient`'s `BodyMode` constant block matches `httpBodyModeSchema`'s options (minus the
   legacy `'json'` alias, which is input-only and deliberately has no Go counterpart).
2. Go's `contentTypeByRawLanguage` map matches TS's `CONTENT_TYPE_BY_RAW_LANGUAGE`.

The Go side is therefore written as a `var contentTypeByRawLanguage = map[string]string{…}` literal
rather than a `switch`, purely so this test can read it — stated in its own comment so nobody
"simplifies" it into a switch later.

**Generating one side from the other stays declined**, on P2 D10's own reasoning: too much machinery
for two short lists, in a repo whose only generated Go artefacts are FlatBuffers types and Wails
bindings.

### D13 — The response pane's Pretty toggle learns XML, and nothing else about the response changes
`ResponsePane.vue:30`'s `isJson` becomes a three-state `prettyFormat: 'json' | 'xml' | null`
computed from `scanJson` then `scanXml` (§1.4 — both already exist, both already lossless), the
Pretty/Raw toggle is gated on it being non-null, and `bodyText` (`:56-63`) dispatches to
`beautifyJson`/`beautifyXml` the way `formats.ts:94-98`'s `beautifyFor` already does. The read-only
editor's `language` follows the same computed.

**In scope, deliberately**, and this is the reasoning rather than a shrug: P3 is the phase that makes
XML a first-class request language (D2). A builder that syntax-highlights and beautifies an XML
request while the response pane next to it shows the SOAP reply as unhighlighted plain text is
incoherent in a way a user would read as a bug. The cost is ~8 lines against two functions already
in the tree, and it introduces no new state field (`responseView`'s `'pretty' | 'raw'` is unchanged).

### D14 — Binary **responses** stay out of scope, and here is the reason rather than an omission
This is the phase brief's fourth question, answered *out*, on three grounds:

1. **P2 already decided it, deliberately and in writing.** P2 §8 OQ-3 —
   *"Binary and non-UTF-8 responses are reported, not rendered … P7's raw inspector is the phase
   that renders them"* (P9 in the current numbering) — and `docs/ARCHITECTURE.md:609-616` records
   the related header-order limitation as a known property. Re-deciding a neighbouring phase's
   deliberate deferral from inside a body-modes phase is exactly the drift `docs/v1.2/README.md`'s
   "never retro-edited" discipline exists to prevent.
2. **The two are not actually coupled.** A `file`-mode *request* has no bearing on what comes back;
   uploading a PNG to an API overwhelmingly returns JSON. The one case where they pair up — POST an
   image, get an image back — needs an image *viewer*, which is a rendering surface this app has
   nowhere to put and which P9's raw inspector is the natural home for.
3. **The narrow version is a trap.** "Just add a Save response to file button" sounds like three
   lines. It needs `control.filesChooseSave` (exists, `control.ts:144-145`), a **new bound method**
   to write the bytes Go already discarded (the response body is currently returned as a string and
   the `*http.Response` is closed, `client.go:246`), and a decision about the 10 MiB transfer cap
   (`client.go:35`) — because "save the response" on a truncated body would save the wrong thing.
   That is a real feature with a real design, and `AGENTS.md`'s *"left out entirely, not
   half-implemented"* applies.

What P3 *does* change on the response side is D13 and nothing else. §8 OQ-3 carries the rest
forward with the shape it would take.

### D15 — Three tables become one, and the refactor lands before the two new tables exist
F(§1.2): `RequestHeadersTable.vue` and a urlencoded table would be the same file twice, and
`QueryParamsTable.vue` is already that file minus a checkbox. `views/httprequest/FieldRowsTable.vue`
takes `rows`, `enabled?: boolean` (whether to render the checkbox column), per-column placeholders
and a testid prefix, emits `update:rows`, and exposes a `#trailing` slot per row for the extra
controls form-data needs. The three existing callers become 10–25-line wrappers that keep their own
write semantics — headers writes `state.headers` directly, params writes *through the URL*
(`QueryParamsTable.vue:18-25`, P2 D9's rule), urlencoded writes `state.urlEncoded`.

**Landed as its own commit (C6), before C7/C8 use it**, with the guard that
`tests/ui/http-request.spec.ts` passes **unedited** — which it can, because every `data-testid` in
the two existing tables (`http-header-row`, `http-header-name`, `http-header-value`,
`http-header-enabled`, `http-header-remove`, `http-param-row`, `http-param-name`,
`http-param-value`, `http-param-remove`) is reproduced by the prefix. A spec edit here means the
extraction changed behaviour.

`FormDataTable.vue` uses the `#trailing` slot for the type `select` (Text / File) and, for a file
row, a **Choose file** `AppButton` plus a `name (size)` caption plus a clear button — the same three
elements `UploadObjectDialog.vue:104-109` already renders, in a row instead of a dialog. Both file
surfaces call one shared `views/httprequest/files.ts` helper wrapping `control.filesChooseOpen({title})`.

---

## 5. Implementation order

Twelve commits. C1 adds capability with no caller; C2 rewires the existing feature with no
user-visible change; C3 is the shared-state correction that must precede the schema widening; C4–C10
are one user-visible slice each; C11–C12 are the tests and the docs. Per `AGENTS.md`, run the fast
checks (`lint`, `typecheck`, `build`, `go build`/`go vet`) per commit and the expensive suites once
at the end.

### C1 — `feat(httpclient): a request-body serializer for every Postman mode`
`internal/httpclient/body.go` (D5's types, D6's `buildBody`, D7's `contentTypeByRawLanguage` map)
plus `body_test.go` (§6.3). `client.go` is untouched and nothing calls it —
`go test ./apps/kira-studio/internal/httpclient/...` is the whole proof, exactly the shape P2's own
C2 took.

### C2 — `refactor(http): the request body crosses the wire as a tagged union`
`client.go`'s `Request.Body`/`HasBody` → `Body Body`, with `buildBody`'s reader/`GetBody`/
`ContentLength` assigned onto the `*http.Request` explicitly (F4, F5) and D7's `Content-Type` guard;
`bridge/http.go`'s `HttpSendArgs`; `control.ts`'s `httpSend` signature;
`views/httprequest/state.ts:42-56` translating the still-two-mode state onto the union
(`'none'` → `{mode:'none'}`, `'json'` → `{mode:'raw', rawLanguage:'json', raw: state.body}`);
bindings regenerated via `wails3 task common:generate:bindings` (never a hand-typed flag list —
`AGENTS.md`'s `-names` warning). **No user-visible change** except D7's `Content-Type` fix, which is
stated in the commit body. `tests/ui/http-request.spec.ts:81-87`'s send-args assertion changes by
exactly two keys and nothing else in that spec moves.

### C3 — `fix(state): a restored tab's state goes through its own kind's schema`
D3: `TabKindDef.parseState`, eight one-line registry entries, the `hydrateTabs` map. **Guard: the
existing suite with no spec edits.** This commit is why P3 can widen a schema at all, and it is
independently valuable — it closes the same latent gap for `keyvalue` and `stream`.

### C4 — `feat(shared): the full Postman body-mode state, with P2's 'json' as a legacy alias`
D8's schema, D2's two vocabularies, D5's TS wire mirror, `CONTENT_TYPE_BY_RAW_LANGUAGE`, and
`duplicateState`'s two extra deep copies (F10). `HttpRequestView.vue`'s two-option control and
`setBodyMode` are adjusted minimally to the new union (`None | raw`) so everything typechecks; no
new UI. `tests/ui/http-request.spec.ts`'s restore test — which seeds `bodyMode: 'json'`
(`:150`) — passes **unedited**, and is thereby the end-to-end proof of the alias. A one-line comment
is added there recording that the value is now legacy and the row is deliberate regression coverage.

### C5 — `feat(http): raw bodies — Text, JavaScript, JSON, HTML and XML`
`RequestBodyPane.vue` extracted from `HttpRequestView.vue:195-222`, D9's mode selector and raw
`select`, per-language `CodeMirrorHost` (`json`/`xml` real grammars, the rest `plain`), Beautify for
json and xml via `formats.ts`'s own `canBeautify` rule, and D9's auto-`Content-Type` caption.
Plus D13 in `ResponsePane.vue`. `views/httprequest/body.ts` lands here.

### C6 — `refactor(http): one row table behind the params, headers and body key/value tables`
D15's `FieldRowsTable.vue`; `RequestHeadersTable.vue` and `QueryParamsTable.vue` become wrappers.
**Guard: `tests/ui/http-request.spec.ts` passes unedited.**

### C7 — `feat(http): x-www-form-urlencoded bodies`
`UrlEncodedTable.vue` over C6's table, wired to `state.urlEncoded`, mounted from
`RequestBodyPane.vue`. Go already serializes it (C1) and the caption already knows its
`Content-Type` (C5).

### C8 — `feat(http): form-data bodies, with real file fields`
`views/httprequest/files.ts` (the shared picker call), `FormDataTable.vue` (D15: the type `select`,
the Choose file button, `name (size)` from `formatBytes` (`format.ts:8-12`), the per-part content
type field prefilled from `contentTypeForFilename`, `packages/shared/domain/object-store.ts:55-60`).
The path — never bytes — reaches `state.formData[i].path` and rides the send args (D4).

### C9 — `feat(http): a binary body — one file, sent as the whole body`
`BinaryBodyPicker.vue`: Choose file / `name (size)` / Clear, over `state.binaryFile`. The caption
reads *"No Content-Type (binary)"* per F3/D7.

### C10 — `feat(http): GraphQL bodies — a query pane and a variables pane`
`GraphQlBodyPane.vue` (D11's fixed 2:1 stack), the `'graphql'` `StreamLanguage` in
`editor/languages.ts` (D10), and a `MessageStrip` when the variables pane is non-blank and not valid
JSON — surfaced in the builder rather than waiting for Go's `E_BAD_REQUEST` at send time, since it
is knowable while typing (`scanJson` is right there).

### C11 — `test: the request body modes, and the Go/TS body vocabulary parity guard`
`tests/ui/http-request-body.spec.ts` (§6.2) and the `go-ts-vocabulary-parity.spec.ts` extension
(D12).

### C12 — `docs(architecture): the request body's mode set, and how a file's bytes reach the wire`
`docs/ARCHITECTURE.md`: the `:41` Stack row extended with the body-mode set and the multipart
`Content-Length` property; a UI-architecture paragraph for the six modes and Postman's format-vs-UI
spelling split; a Process-model paragraph stating **path-not-bytes** with F7's actual numbers (the
512 KiB chunk threshold, the 64 MiB assembled ceiling) since that constraint is currently documented
nowhere and is the reason for a design decision; and one paragraph for D3's restored-state
normalization, which is a property of every tab kind now, not just this one.

---

## 6. Verification

### 6.1 What runs here
`bun run lint`, `bun run typecheck`, `bun run build`, `bun run test:unit`, `bun run test:ui`,
`bun run test:ipc:fe`, plus `go build ./... && go vet ./... && go test ./apps/kira-studio/internal/...`.
`scripts/setup.sh` first in a fresh container — **mandatory this phase**: C2 changes a bound method's
argument struct, so `apps/kira-studio/frontend/bindings/**` must be regenerated or the Vite build
fails on a type that no longer exists.

Two bindings checks, from `AGENTS.md`'s own warnings and P2 §6.1's precedent:

1. The regenerated `httpservice.ts` must still call `$Call.ByName("…bridge.HttpService.Send", …)`,
   not `$Call.ByID(<n>, …)` — a `-names`-less regeneration silently breaks **every** `tests/ui` spec
   at the first bound call of boot, surfacing as a `status-bar` selector timeout with a page-level
   `no CHANNEL_TO_FQN entry for undefined`.
2. The regenerated models must include `httpclient.Body`, `httpclient.FormField`, `httpclient.Field`
   and `httpclient.GraphQLBody` as real exported types — a nested struct inside an args struct is a
   shape this repo already generates (`FilesChooseOpenResult.File *ChosenFile`,
   `bridge/files.go:34-37`), but it is worth confirming once rather than assuming.

### 6.2 The new UI spec — `tests/ui/http-request-body.spec.ts`
`tests/ui` drives the real built bundle in real WebKit with both wire planes mocked
(`docs/ARCHITECTURE.md:1232-1240`). Per §1.6 a channel answers args-blind only with exactly one
snapshot, so this is **four tests**, one `httpSend` snapshot each.

1. **Raw · XML round-trips through the builder and the wire.** New request → Body → `raw` → language
   `XML`, type a small document, assert the editor is XML-highlighted (`.cm-content` carries a
   lezer XML tag class), click Beautify and assert the indented form, then Send and assert the args
   carry `body: {mode:'raw', rawLanguage:'xml', raw:'<the beautified text>'}`. Assert the caption
   reads `application/xml`.
2. **form-data with a real file field sends a path, never bytes.** Two snapshots:
   `IPC.filesChooseOpen` returning `{canceled:false, file:{path:'/tmp/report.csv', name:'report.csv', size:2048}}`,
   and one `IPC.httpSend`. Add a text row, add a file row, click **Choose file**, assert the row
   shows `report.csv (2 KB)`, then Send. Assert the send args' `body.formData` is
   `[{name:'title', kind:'text', value:'…'}, {name:'upload', kind:'file', path:'/tmp/report.csv'}]`
   and — the load-bearing assertion — that **no `httpSend` argument anywhere in the call log exceeds
   a few hundred bytes**, i.e. the file's contents are demonstrably not in the payload (D4).
   Also assert an unchecked row is absent from the args entirely (D5).
3. **Binary and GraphQL both persist and restore.** Seed `IPC.tabsList` with an `http-request` tab
   whose `state_json` carries `bodyMode:'file'` and a `binaryFile`, boot, assert the picker shows the
   stored name and size; switch to GraphQL, type a query and variables, assert `IPC.tabsSave` fired
   with both fields, then Send and assert
   `body: {mode:'graphql', graphql:{query:…, variables:…}}` with the variables text byte-identical to
   what was typed.
4. **A pre-P3 tab restores into raw · JSON.** Seed a record with P2's exact `state_json` shape —
   `bodyMode:'json'`, no `formData`, no `graphqlQuery`, no `binaryFile` — and assert on boot that the
   mode control reads **raw**, the language reads **JSON**, the body text is byte-identical, and
   switching to form-data renders an empty table rather than throwing (D3 + D8, the two halves of
   F1's fix, proven together through the real hydration path).

The existing `tests/ui/http-request.spec.ts` is edited in exactly one place across the whole phase
(C2's two send-args keys) and is otherwise a regression guard for C3, C4 and C6.

### 6.3 The Go tests, and what they deliberately do not cover
`internal/httpclient/body_test.go` against `net/http/httptest`. It exists because `buildBody` is
`AGENTS.md`'s named category — *"a parser/splitter with several interacting rules"* over a real wire
format, where the failure modes are silent (a wrong `Content-Length` hangs the request; a missing
`GetBody` fails only on a 307; a chunked upload is rejected only by some servers). Seven cases, one
per rule that is genuinely easy to get wrong:

1. **form-data with a real temp file**: the server's `r.ParseMultipartForm` sees both the text field
   and the file part, the file's bytes are byte-identical to what was on disk, the part's own
   `Content-Type` is the row's override when set and `application/octet-stream` when not.
2. **The multipart `Content-Length` is exact and the request is not chunked**: the server sees a
   `Content-Length` equal to the bytes it actually read, and `r.TransferEncoding` is empty (F5, D6's
   dry run).
3. **A 307 redirect replays a file body** (F4): a two-hop server where the second hop asserts it
   received the same bytes; without `GetBody` this is the case that fails, so it is the case that is
   tested.
4. **urlencoded preserves order and encodes a space as `+`** (F6): fields `b`, `a` in that order
   arrive in that order, and `hello world` arrives as `hello+world`.
5. **GraphQL variables survive losslessly**: a 19-digit integer literal in the variables text
   arrives byte-identical in the JSON envelope, and blank variables omit the key entirely; invalid
   JSON is `CodeBadRequest` before anything is sent.
6. **A binary body sets an exact `Content-Length` and no `Content-Type`** (F3), and a missing path is
   `CodeBadRequest` with the path in the message.
7. **`Content-Type` precedence** (D7): a user-set `application/vnd.api+json` beats raw·json's
   default; a user-set bare `multipart/form-data` gets the generated boundary appended and the body
   still parses server-side.

**Explicitly not tested:** that `text` maps to `text/plain` (a table lookup — D12's parity test is
the guard that matters there), that a `none` body sends nothing, that the mode enum rejects an
unknown string. Each is `AGENTS.md`'s *"everything else gets nothing"*.

### 6.4 What only a real Mac and a real network can settle
1. **The native picker** in a real Wails window, for both a form-data file row and a binary body —
   `tests/ui` mocks `FilesService.ChooseOpen` and `-tags server` has no dialogs at all (F13), so
   nothing below this line exercises `internal/shell/app.go:89-98`.
2. **A real multipart POST of a genuinely large file** (≥ 500 MB) to a real endpoint: memory stays
   flat (the pipe streams), the server reports the byte count Go computed, and the transfer is not
   chunked.
3. **Stop, mid-upload.** The op-log row flips to `cancelled`, the ring clears, the writer goroutine
   exits and no file descriptor is left open (`lsof` on the running app).
4. **A file deleted between picking and sending** fails visibly with a legible message, and the tab
   is still usable afterwards.
5. **`defaultTimeout`'s new meaning**: a file large enough to exceed 30 s is aborted as `E_TIMEOUT`
   with a message that does not read like a network failure. This is §8 OQ-2's evidence, and it is
   the one item here expected to *find* something.
6. **`HTTPS_PROXY` with a multipart body** — `http.ProxyFromEnvironment` (`client.go:43`) is
   unchanged, but a streamed body through a proxy is a different code path in `net/http` than a
   `*strings.Reader` one.

### 6.5 What must not regress
- **Studio renders identically.** C3 is the only commit touching shared Studio state, and its guard
  is the existing suite passing **with no spec edits**.
- **`tests/ui/http-request.spec.ts` is edited exactly once**, in C2, in exactly two object keys.
  Any other edit to that file is a signal that C3, C4 or C6 changed behaviour it was not supposed
  to.
- **`tests/ui/mode-switch.spec.ts` passes unedited.** P3 touches neither `http/HttpStart.vue` nor
  `http/CollectionsPanel.vue`.
- **The bundle keeps exactly two dynamic chunks** (`docs/ARCHITECTURE.md:28`). Everything added is
  statically imported; D1 declined the one candidate (`cm6-graphql`) that would have moved the
  needle.
- **`bun run test:ipc:fe` passes unedited.** No data-plane frame, adapter or fixture change; `git
  diff` must touch nothing under `internal/adapterhost/`, `internal/adapters/`, `internal/page/`,
  `internal/storage/migrations/` or `packages/shared/protocol/`.
- **No file under `views/httprequest/**` imports another `views/<kind>/**`, and nothing new lands
  under `http/**`** — `bun run lint` is the check (`biome.json:66-104`, `:127-149`).
- **`NOTICES.md`, `package.json` and `go.mod` are unchanged** — D1.
- **`docs/PERF.md` gains no budget and needs none**: an upload's elapsed time is the network's and
  the disk's, and nothing here touches a budgeted path. The one thing that *could* have — bytes
  through the bridge — is precisely what D4 declined.

---

## 7. Acceptance checklist

Filled in by the implementing session as each item is actually done, not in advance.

- [ ] C1 — `internal/httpclient/body.go` serializes all six modes; the multipart dry run produces an
      exact `Content-Length`; `GetBody` is non-nil for every mode; `body_test.go`'s seven cases green.
- [ ] C2 — the union crosses the wire; bindings regenerated with `$Call.ByName` and the four new
      models confirmed (§6.1); `Content-Type` defaults applied only when the user set none; the
      existing UI spec edited in exactly two keys.
- [ ] C3 — `TabKindDef.parseState` on all eight kinds; `hydrateTabs` merges, never replaces; existing
      suite green with **no spec edits**.
- [ ] C4 — the six-mode enum, the five raw languages, the six new state fields with `.default()` on
      every one, the `'json'` preprocess alias, `duplicateState`'s three deep copies; the P2 restore
      test passes unedited.
- [ ] C5 — raw mode with all five languages; JSON and XML highlighted; Beautify offered for exactly
      those two; the auto-`Content-Type` caption correct in all three of its states; the response
      pane's Pretty toggle handles XML.
- [ ] C6 — one `FieldRowsTable`; headers and params are wrappers; every existing `data-testid`
      preserved; `http-request.spec.ts` unedited.
- [ ] C7 — urlencoded rows send in order, with `+` for spaces, with disabled rows omitted.
- [ ] C8 — a form-data file row picks through the real dialog, shows `name (size)`, and sends a path;
      per-part content type prefilled and overridable.
- [ ] C9 — a binary body sends the whole file with an exact length and no `Content-Type`.
- [ ] C10 — GraphQL query + variables, both persisted; the `'graphql'` grammar highlights; invalid
      variables are flagged in the builder before send.
- [ ] C11 — `tests/ui/http-request-body.spec.ts` (four tests) and the two new parity tests, each
      passing twice in a row.
- [ ] C12 — `docs/ARCHITECTURE.md` updated (the mode set, the format-vs-UI spelling split,
      path-not-bytes with F7's numbers, D3's restored-state normalization).
- [ ] §6.1's full command set green.
- [ ] §6.4's six real-hardware steps — run, or recorded as unrunnable here with what was read
      instead, in the same shape P1's and P2's own checklists took.

---

## 8. Open questions, handed forward

**OQ-1 — Postman's GraphQL body is untyped in its own schema.** F2: `collection.json` defines
`"graphql": {"type": "object"}` and nothing more, and
`postmanlabs.com/postman-collection/RequestBody.html` says only that it *"holds raw graphql data"*.
D6 sends `{"query", "variables"}` with `Content-Type: application/json` — the GraphQL-over-HTTP
convention, and what Postman's own docs describe the GraphQL body mode as producing — but three
sub-questions are genuinely unverified and matter to **P4's round-trip**, not to P3's sending:
(a) whether Postman stores `variables` as a JSON *string* or a nested object; (b) whether it ever
emits `operationName` from the classic HTTP request builder (as opposed to its separate GraphQL
request type); (c) whether an `operationName` is required for a multi-operation document. The
honest resolution is to export one GraphQL request from a real Postman install and read the JSON —
which P4 has to do anyway for every mode, and which cannot be done from this sandbox.

**OQ-2 — `defaultTimeout` now bounds an upload, and 30 s is the wrong number for one.**
`client.go:26` was chosen for a request/response exchange (P2 D4) and is now also the ceiling on how
long a 2 GB multipart body may take to reach the server — which on a domestic uplink it will not.
The Stop button works throughout, so nothing hangs; the failure is an `E_TIMEOUT` on a transfer that
was progressing fine. The right fix is a per-request timeout setting, which needs a request-settings
surface to live in — the same surface P2 §8 OQ-4's TLS-verification toggle needs. Both should land in
whichever phase builds one, together, not separately.

**OQ-3 — The response side, restated with what P3 learned.** D14 keeps binary responses out. Two
things P3 now knows that P2 did not: a `file`-mode request makes "download this response" a
*plausible* next ask rather than a theoretical one, and `client.go` currently discards the
`*http.Response` body after copying it into a string (`:246-263`), so any save-to-disk feature is a
**new bound method streaming to a path**, not a renderer-side blob — the exact mirror image of D4.
Whoever builds P9's raw inspector should build that at the same time, and should decide then whether
the 10 MiB transfer cap (`client.go:35`) still applies to a body destined for a file.

**OQ-4 — Two `Content-Type` values I could not pin to a first-party page.** F3: raw·JavaScript
(`application/javascript` vs `text/javascript`, the latter being what RFC 9239 now prefers) and
raw·XML (`application/xml` vs `text/xml`). D7 picks the former of each on the strength of a
docs-derived synthesis rather than a quoted Postman page. Low stakes — D7 makes both overridable by a
hand-set header, and D12's parity test keeps the two languages agreeing on whatever value is chosen
— but worth confirming against a real Postman send when someone has one, and changing in one place if
wrong.

**OQ-5 — The Description column, on all four key/value tables at once.** Postman's format carries
`description` on query params, headers, urlencoded fields and form-data text fields (F2). P2 has it
on none of them and P3 adds it to none, deliberately (§0.2): it is a property of *a key/value row*,
so adding it to two of the four would be incoherent, and D15's `FieldRowsTable` is now the single
place it would go. P4's importer must preserve descriptions round-trip regardless of whether they
are editable, which makes P4 the natural phase to decide — and P2 §8 OQ-1's own disabled-query-param
question is the same shape, on the same table, and should be settled in the same pass.

**OQ-6 — Two corners of Postman's format P3 does not represent.** (a) `formdata`'s `src` may be an
**array** — Postman lets one key carry several files. D8 models one path per row; importing an array
would need P4 either to expand it into N rows with the same key (lossless for *sending*, lossy for
*exporting*) or to widen the field. (b) `file.content` — some exporters inline base64 body content
instead of a path. P3 supports only `src`, which is D4's whole point; an import carrying `content`
has no path to store and would have to either write a temp file or refuse. Both are P4's to decide,
and both are cheaper to decide there than to half-build here.

**OQ-7 — A renderer-supplied path is a capability, and now it leaves the machine.** F14: Go opens
whatever path the renderer sends, with no proof it came from a dialog — already true of the S3
upload (`UploadObjectDialog.vue:62-69` → `s3/transfer.go:112`), so P3 changes nothing about the
posture. What P3 *does* change is the destination: an S3 upload goes to a connection the user
configured; an HTTP body goes to a URL typed into a text field seconds earlier. The renderer is our
own bundle and loads no remote content, so there is no attacker in the current model — but the
mitigation, if one is ever wanted, is small and worth naming now so it is chosen rather than
retrofitted: `FilesService.ChooseOpen` returns an opaque handle alongside the path, Go keeps a
short-lived map of handles to paths, and a body may only reference a handle. That is a change to a
shared service used by S3 too, which is why it does not belong inside a body-modes phase.

**OQ-8 — The six-way mode control's width.** F12/D9: `x-www-form-urlencoded` is 21 characters and
`SegmentedControl` has no truncation behaviour of its own. D9 makes the row horizontally scrollable,
which is honest but not lovely in a narrow request pane. Postman uses radio buttons on one wrapping
line. If the scroll grates, the contained fix is a `wrap` prop on `SegmentedControl` (it is the only
caller that would need one) or shorter labels (`form-data · urlencoded · raw · binary · GraphQL`) at
the cost of Postman's exact wording — recorded so the choice is deliberate.

---

### Critical files for implementation

- `/home/user/kira-studio/packages/shared/domain/http.ts`
- `/home/user/kira-studio/apps/kira-studio/internal/httpclient/client.go`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/views/httprequest/HttpRequestView.vue`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/state/tabs.ts`
- `/home/user/kira-studio/apps/kira-studio/internal/bridge/files.go`

---

**Sources for the Postman parity claims in F2/F3** (used in place of recall, per the brief's
instruction to pin them down rather than approximate):

- [Postman Collection Format v2.1.0 JSON Schema](https://schema.postman.com/json/collection/v2.1.0/collection.json) — the `mode` enum and every per-mode payload shape
- [Send parameters and body data with API requests in Postman](https://learning.postman.com/docs/use/send-requests/create-requests/parameters) — the builder's six body types, the raw format dropdown's five entries, "Postman doesn't set any header type for the binary body type", and Content-Type precedence
- [RequestBody — Postman Collection SDK](https://www.postmanlabs.com/postman-collection/RequestBody.html) — `RequestBody.MODES`' five members and the untyped `graphql` member
- [Make a GraphQL call with an HTTP request | Postman Docs](https://learning.postman.com/docs/sending-requests/graphql/graphql-http) — the Query / GraphQL variables editors

