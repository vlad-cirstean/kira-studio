# P7 — curl parse and generate

> **What this phase is.** `docs/v1.2/SPEC.md`'s P7 row: *"Paste a curl command and have it populate a
> request (method, URL, headers, body, auth); generate an equivalent curl command from the current
> request's state, with any `{{variable}}`/`{{$dynamic}}` reference resolved to its real value in
> the generated command, since curl itself has no notion of either."* Two directions over the same
> vocabulary: **argv → `HttpRequestTabState`** (P3's six body modes, P4's saveable request) and
> **resolved request → a runnable command string** (P5's secrets, P6's dynamic values).
>
> **The two questions this phase exists to answer, both settled here rather than deferred.**
>
> 1. **Library or hand-rolled** — settled by measurement, not by preference, in F5–F9 and D1. The
>    answer is *split*: the **shell-quoting half is a library** (`shlex@3.0.0`, MIT, zero deps,
>    2.3 KB minified), because it is a solved problem and the two obvious alternatives measurably
>    corrupt real input; the **curl-flag half is hand-written**, because every published curl parser
>    measurably mis-parses the single commonest paste shape and none of them can know this app's own
>    `none|raw|code|urlencoded|formdata|file` mode vocabulary, which deliberately is not Postman's.
>
> 2. **The secret-reveal question P5 OQ-10 and P6 OQ-8 both handed forward** — settled in D10/D11.
>    A generated command that substitutes a secret's real value **is a reveal** (P5 D9's line:
>    *"this gate is about turning a secret into visible text, not about using it"*), so it goes
>    through the **existing** `localauth` gate — and the dialog opens **masked**, with `{{token}}`
>    still literal, so the reveal is an explicit act rather than a side effect of opening a dialog.
>    Both halves matter: without the gate the mask is theatre; without the masked default, opening
>    *Copy as curl* would prompt for a fingerprint, which is exactly the friction P14 D5 warned makes
>    a security feature get switched off.
>
> **Where the code lives: entirely in the renderer, in TypeScript. No Go file changes at all** (D2).
> Not a convenience — it is what keeps a fully-resolved, secret-bearing request out of the one place
> a request's text becomes persisted. `bridge/http.go:68`/`:88` feed `op.SetCommand` the
> **unresolved** URL on purpose (P5 F3); a Go-side "generate curl" method would be a second Go entry
> point holding exactly the material that ordering exists to keep out of `op_log.command`, with its
> own chance to get the ordering wrong. Generation in the renderer has no op, no bound call, no
> `slog` line and no persisted column to be careful about.
>
> **What does not land here.** Response history (P8), the raw byte-level inspector and raw editor
> (P9), the timeline (P10), gRPC (P11), the module rename and package split (P12), the UI
> consistency pass (P13). Also explicitly not here: an **auth model** (there still is none — F3;
> curl's `-u`/`--oauth2-bearer`/`-b` map onto real headers, which is what curl itself puts on the
> wire, not onto a placeholder Auth tab); **widening `HTTP_METHODS`** past its seven members (P4 §8
> OQ-3 stays open — D9 coerces and warns, exactly as P4's own importer does); **a Copy-as-curl on a
> collection tree row** (§8 OQ-3); **reading a local file's bytes in the renderer** for `-d @file`
> (D8 — P3 D4's path-not-bytes rule is not weakened here); **importing a curl command into the
> *current* tab** (D12 opens a new one — non-destructive by construction); **`--config`/`-K` files,
> `--proxy`, client certificates, cookie jars, `--resolve`, rate limits** (D7's warned list).
> Nothing here is half-built toward any of them (`AGENTS.md`: *"Scope left out of a phase is left
> out entirely, not half-implemented"*).
>
> **Every claim below was re-read against the tree, and every library and curl claim was measured
> rather than recalled.** Base: branch `claude/feature-v1-2` at `92cf3b4` (*"docs(plan): fill in
> P6's acceptance checklist and the F5 bundle deviation"*), i.e. P6's eight commits have landed.
> File:line citations point at that content. Library behaviour in F5–F8 was measured by installing
> each candidate from the real npm registry and running it; curl behaviour in F10–F13 was measured
> against **curl 8.5.0** talking to a local sink that echoed the exact bytes and headers it received.
>
> **The one-sentence design.** A well-maintained POSIX lexer turns the pasted text into `argv` and
> turns each generated argument back into a shell-safe token; everything between those two points is
> this app's own flag table over this app's own body-mode vocabulary, and the only thing that ever
> reaches Go is the reveal call that was already built.

---

## 0. Scope, non-scope, ground rules

### 0.1 In scope

| File | What changes |
|---|---|
| `package.json` (root) | one `dependencies` entry: `"shlex": "3.0.0"` (D1) |
| `apps/kira-studio/frontend/src/http/curl/tokenize.ts` | **new** — the `shlex.split` wrapper: the `curl` prefix, shell operators/comments, the unterminated-quote error (D3) |
| `apps/kira-studio/frontend/src/http/curl/flags.ts` | **new** — the flag table: aliases, arity, the ignored set, the warned set (D6/D7) |
| `apps/kira-studio/frontend/src/http/curl/parse.ts` | **new** — argv → `ParsedCurl` (state patch + warnings) (D5–D9) |
| `apps/kira-studio/frontend/src/http/curl/generate.ts` | **new** — a resolved request → the command string (D13–D15) |
| `apps/kira-studio/frontend/src/http/substituteRequest.ts` | **new** — `substituteBody` moves here out of `views/httprequest/state.ts`, plus `applySecretValues`, the renderer twin of `httpvars.ResolveRequest`'s stage 2 (D11) |
| `apps/kira-studio/frontend/src/http/state/curl.ts` | **new** — both dialogs' state, the reveal loop, the clipboard write (D10–D12) |
| `apps/kira-studio/frontend/src/http/ImportCurlDialog.vue` | **new** — paste, live preview, live warnings, Import (D12) |
| `apps/kira-studio/frontend/src/http/CopyAsCurlDialog.vue` | **new** — the generated command, masked by default, one *Show secret values* action (D10) |
| `apps/kira-studio/frontend/src/http/menus.ts` | one background-menu item (*Import from curl…*), one `CollectionMenuActions` member |
| `apps/kira-studio/frontend/src/http/CollectionsPanel.vue` | one action wired, one `registerCommand('http.importCurl', …)` |
| `apps/kira-studio/frontend/src/http/HttpStart.vue` | a third front-door button beside *New request* / *Import collection…* |
| `apps/kira-studio/frontend/src/views/httprequest/state.ts` | imports `substituteBody` instead of defining it; exports the frozen-resolution helper `resolveForExport` (D11) |
| `apps/kira-studio/frontend/src/views/httprequest/HttpRequestView.vue` | one toolbar `IconButton`, one `registerCommand('http.copyAsCurl', …)` |
| `apps/kira-studio/frontend/src/views/httprequest/BinaryBodyPicker.vue` | one `v-if` so an imported file with no known size renders `report.csv`, not `report.csv (0 B)` (F15) |
| `apps/kira-studio/frontend/src/shortcuts/state.ts` | two palette entries |
| `apps/kira-studio/frontend/src/App.vue` | mounts both dialogs beside the other overlays |
| `apps/kira-studio/tests/unit/http-curl.spec.ts` | **new** — §6.2 |
| `apps/kira-studio/tests/unit/curl-cases.json` | **new** — the corpus both directions are pinned to (D17) |
| `apps/kira-studio/tests/ui/http-curl.spec.ts` | **new** — §6.3 |
| `docs/ARCHITECTURE.md` | one UI-architecture sub-section, one paragraph in the secrets section |

### 0.2 Out of scope, explicitly

- **P8–P13's own rows**, listed in the header blockquote.
- **Any Go change whatsoever.** §3 establishes why none is needed and D2 why none is wanted. No
  migration, no bound method, no `packages/shared` change, **no bindings regeneration**.
- **An auth model.** P4 §8 OQ-2 and P5 §0.2/F8 both leave it open, and P5's own words are that
  *"there is no auth field in the request builder to substitute into"*. D9 maps curl's credential
  flags onto headers — the actual wire form — and D16 refuses to decode an `Authorization: Basic`
  header back into `-u` on the way out.
- **Widening `HTTP_METHODS`** (`packages/shared/domain/http.ts:8`). P4 §8 OQ-3 named P7 as the
  phase that would want it (`curl -X PROPFIND`); D9 declines to take it here and says why, and §8
  OQ-1 re-hands it with the extra evidence this phase produced.
- **Reading a file's bytes in the renderer.** P3 D4/F7 is unchanged: a path crosses the bridge, a
  byte never does. `-d @file` therefore cannot be honoured as *inline data* (D8).
- **Executing anything.** Nothing here ever runs a shell, a subprocess or curl itself. A `;`, `|`,
  `&&` or backtick in the pasted text is text to be *stopped at*, not text to be run (D3).
- **A pre-import diff/merge against the current tab.** Import opens a fresh tab (D12).
- **Postman's own `Code` snippet panel** (curl for Python/Go/JS/…). One target, curl, per the SPEC
  row. §8 OQ-5.
- **Any change to `send()`'s behaviour.** C4 moves one private function out of that file and
  changes nothing it does (§6.5).
- **Any change to `theme/primitives/`.** `DialogFrame`, `MessageStrip`, `AppButton`, `IconButton`,
  `TextField` and the existing `.p-strip`/`.p-code` classes cover both dialogs.

### 0.3 Ground rules

- **`http/**` may not import `views/**` or `project/**`** (`biome.json`'s `http/**` override, the
  block P5 F8 cited at `:125-149`); the reverse is unrestricted and `HttpRequestView.vue:5-8`
  already imports four `http/` modules. Every new module in §0.1 lands under `http/` and imports
  nothing from `views/`; the two request-view edits (a toolbar button, a `v-if`) go the permitted
  direction. **C4 exists to make that true rather than to work around it** — `substituteBody` is
  Http-module logic that happens to live in a view file today.
- **Test files stay per-module** (`docs/v1.2/SPEC.md`'s boundary section: *"a single test command
  covering both is fine, a single test file covering both is not"*). `http-curl.spec.ts` in both
  tiers is Http-only; no existing mixed file gains a case.
- **A secret's plaintext exists in the renderer in exactly one place** — `http/state/variables.ts:202`'s
  `revealedValues`, transient and dropped on close. D10 adds a second transient map with the
  identical discipline and no third.
- **Nothing generated is ever persisted.** Not in `state_json` (D10), not in `op_log.command`
  (there is no op), not in a `slog` line (there is no Go call). §6.3 asserts the first two.
- **Faithful over helpful.** Where curl would send something surprising (a JSON body with
  `Content-Type: application/x-www-form-urlencoded`, F11), the import reproduces what curl would
  actually have sent and *says so* in a warning, rather than quietly improving it. This is P2 D1's
  standard — *"no layer that can rewrite what the user asked for"* — applied to an importer.

---

## 1. What the code does today

### 1.1 There is no curl anywhere in the repo

`git grep -in curl -- apps packages` reaches documentation prose and this plan's siblings only: no
parser, no generator, no flag table, no clipboard producer of a command string. The one adjacent
thing that exists is `frontend/src/clipboard.ts:10-12` — `copyText(text)` over
`navigator.clipboard.writeText`, already used by `OperationsPanel.vue`, `TabStrip.vue`,
`DefinitionView.vue`, `views/keyvalue/menu.ts`, `views/definition/columnsMenu.ts`,
`views/browse/menu.ts` and `views/grid/SlickGridHost.vue`. P4 already uses it for a collections
row's *Copy URL*. So the "put a string on the clipboard" half of this phase is one existing import.

### 1.2 The request's own model is six modes, one wire union, and no auth

`packages/shared/domain/http.ts:116` — `HTTP_BODY_MODES = ['none','raw','code','urlencoded','formdata','file']`,
with `CODE_LANGUAGES = ['javascript','json','html','xml']` (`:122`). `HttpBodyWire` (`:49-57`) is
the tagged union Go switches on; `HttpRequestWire` (`:63-70`) is `method/url/headers/body` plus
P5's `collectionId`/`environmentId`. The tab state (`:189-215`) keeps **one buffer per mode** —
`body` (raw), `code` + `codeLanguage`, `urlEncoded[]`, `formData[]`, `binaryFile` — plus P4's
`itemId`/`name` and the three pane fields.

The file's own long comment at `:99-115` is the breadcrumb this phase is downstream of: the mode
vocabulary is **deliberately not** Postman's `body.mode` (Postman has one `raw` with a five-value
`language`; this app split it into `raw` = plain text and `code` = the other four, and dropped
`graphql` outright). Any library that maps curl onto "a Postman request" therefore lands on the
wrong vocabulary by construction — D1 leans on this.

**There is no auth field of any kind**: no `auth` member in the tab state, no Auth tab in
`HttpRequestView.vue`'s three-way `requestPane` (`params | headers | body`, `http.ts:169`), and no
`Auth` in `HttpSendArgs` (`internal/bridge/http.go:29-37`). P5 §0.2 records the same fact from the
other side.

### 1.3 Substitution is two stages, and stage 1 is a pure exported function

`http/substitute.ts:48` — `resolve(text, values, secretNames, dynamic?)` returns
`{text, refs}` with each ref classified `resolved | deferred | dynamic | unknown`. A `$`-prefixed
name is handed to the optional `dynamic` callback **once per occurrence** (P6 D3); a `null` return
leaves the span verbatim.

`views/httprequest/state.ts` wraps it for a whole request:

- `buildBodyWire(state)` (`:13-56`) — tab state → `HttpBodyWire`, dropping disabled and unnamed rows.
- `substituteBody(body, sub)` (`:63-87`) — **module-private** — the D7 field walk over the wire
  body (raw/code/urlencoded/formdata-text, never a file path).
- `resolveTabState(state, values, secretNames, dynamic?)` (`:108-131`) → `ResolvedRequest`
  (`:89-96`: `url`, `headers`, `body`, `refs`).
- `mergedValuesAndSecrets(collectionId, environmentId)` (`:134-152`) — D2's environment-over-collection
  precedence over `http/state/variables.ts:151`'s cache.
- `collectionIdFor(state)` (`:155-158`), and `send()` (`:186-`), which calls `resolveTabState` once
  and, **only if some ref came back `dynamic`**, a second time with `await loadDynamicGenerator()`.

`HttpRequestView.vue:105-122` calls the same `resolveTabState` with **three** arguments for the live
unresolved-reference chip — P6 F2's rule that the preview must never generate anything.

Stage 2 is Go: `internal/httpvars/resolve.go`'s `ResolveRequest` re-walks the same field list with
the decrypted secrets, called from `bridge/http.go:71-73`, **after** `op.SetCommand` at `:68`.

### 1.4 The reveal gate exists, is shared, and already hands a plaintext to the renderer

`internal/httpvars/reveal.go`'s `Reveal(variableID, confirmed) RevealResult` goes through the same
`*localauth.Authorizer` instance `connections.Service` uses (P5 D8), never errors across the bridge,
and returns one of `revealed | cancelled | confirmation-required | error`. On `revealed` it carries
the decrypted string.

`http/state/variables.ts:207-227`'s `revealVariable(id, confirmed)` is the renderer half: it calls
`control.variablesReveal`, writes the plaintext into `revealedValues` (`:202`, a `reactive` map
described in its own comment as *"the one place a secret's plaintext exists in the renderer at
all"*), recurses once through `confirmDialog()` on `confirmation-required`, and writes any error
into `variablesDialogState.error` (`:225`).

Two consequences for P7, both load-bearing:

- **The plaintext is reachable from the renderer, by design, once the gate has been passed.** That
  is what a reveal *is*. So a curl generator does not need Go to substitute a secret — it needs the
  gate, which already exists.
- `revealVariable`'s error sink is the *variables dialog*'s. D10 notes the one-line generalization.

`docs/ARCHITECTURE.md:447-448` states the policy this phase is applying: *"`Connect`, `Test`, and
`Duplicate` all continue to use the stored secret unprompted… this gate is about turning a secret
into visible text, not about using it."*

### 1.5 The dialog, menu, palette and front-door seams are all already established

- Every Http dialog lives in `http/` and is mounted in `App.vue:72-79` behind its own
  `*DialogState.open`. `http/state/dynamicValues.ts` is the whole store for the simplest of them
  (17 lines).
- `http/menus.ts` describes the collections tree's row and background menus with **injected
  actions** (its own comment: *"The actions themselves are injected rather than imported, so this
  module stays free of both the store's mutation half and the request-view's open path"*).
  `backgroundMenu` already carries *New collection*, *Import collection…*, *Environments…*,
  *Dynamic values…*.
- `CollectionsPanel.vue:83-88` registers four `http.*` commands on mount;
  `HttpRequestView.vue:167-176` registers three view-scoped ones including `http.save`.
- `shortcuts/state.ts:19-53`'s `paletteCommands` is a flat list of `{id, label, run}`.
- `HttpStart.vue:24-33` is the mode's front door: two `p-dlgbtn`s, one primary.

Nothing in P7 invents a seam; every entry point is one entry in one of these lists.

### 1.6 The `Content-Type` the app actually sends is a *default*, applied only when the user set none

`internal/httpclient/client.go:284-300`: a user-set `Content-Type` wins; otherwise
`buildBody`'s per-mode default is applied — `text/plain` for raw,
`contentTypeByCodeLanguage` (`body.go:43-48`) for code, `application/x-www-form-urlencoded` for
urlencoded, `multipart/form-data; boundary=<minted>` for formdata, and **none at all** for `file`
(P3 F3: Postman sets none either). `views/httprequest/body.ts:87-100`'s `defaultContentTypeFor`
mirrors that table renderer-side for the pane caption.

The client also **follows up to 10 redirects** (`client.go:32`), applies a 30 s deadline (`:27`),
sets `User-Agent: Kira Studio/<version>` when the user set none (`:275-278`), and never sets
`Accept-Encoding` itself (`:279-282`). D14 decides, one by one, which of those belong in a
generated command.

`buildURLEncoded` (`body.go:138-150`) `url.QueryEscape`s **both** the name and the value, in the
user's order — F13 is why that single fact decides how a urlencoded body is generated.

### 1.7 The `tests/ui` tier can already drive a reveal, and can count the calls

`tests/ui/support/mockRuntime.ts:104` maps `variablesReveal → VariablesService.Reveal`, and
`http-variables.spec.ts` already registers four `IPC.variablesReveal` snapshots in one test
(`:114-129`, matched by args since a channel with more than one snapshot is arg-matched,
`mockRuntime.ts:386`) and asserts the exact number of reveal calls made (`:150`, `:165`). That is
precisely the guard D10 needs — *one prompt per referenced secret, zero for a dynamic value, zero
when the command is copied masked* — with no `mockRuntime.ts` change at all.

---

## 2. Findings

### F1 — Nothing in Go has any reason to see a curl command, in either direction
Import produces **tab state**, and `model.TabRecord.State` is `json.RawMessage` whose own comment
says the per-kind shape *"stays renderer-side"* (`model/tabs.go:8-12`); P3 F9 established that a
widened tab-state shape is not a migration and Go has no mirror of it. Generation produces a
**string for the clipboard**, and `navigator.clipboard` is a renderer API. Neither direction reads
a file, opens a socket, or touches storage — the three things `docs/ARCHITECTURE.md:41`'s Stack row and its "Go owns the
network" invariant put on the Go side. So the Go/TS question (D2) is not "which is nicer" but "is there any work here
Go must do", and the answer is no.

### F2 — Generation in Go would re-open the exact hazard P5 F3 closed
`bridge/http.go:68` and `:88` both call `op.SetCommand` with `args.URL` — the *unresolved* URL —
because `op_log.command` is a persisted SQLite column rendered in the Operations panel, and
`?api_key={{key}}` is exactly what a user puts a credential in. A hypothetical
`HttpService.GenerateCurl(args)` would be a **second** bound method receiving a request, and the
material it would receive is the fully-resolved one (that is the point of the feature). It would
therefore be one careless `op.SetCommand`, one `slog.Info` naming the command, or one future
"run generation through `RunOp` like everything else" refactor away from writing a decrypted
credential into `kira.sqlite`. The renderer has no `RunOp`, no `op_log` and no `slog`, so the
hazard is not mitigated there — it does not exist there. D2.

### F3 — There is no auth model to populate, and the SPEC row's word "auth" still has a faithful landing site
§1.2. The SPEC's P7 row lists *"method, URL, headers, body, auth"*; P4 §8 OQ-2 deferred auth to a
phase that can design collection/folder/request inheritance, and P5 §0.2 confirms nothing was built.
But curl's own credential flags are **header sugar**, not a separate concept — measured in F12:
`-u alice:s3cr3t` puts `Authorization: Basic YWxpY2U6czNjcjN0` on the wire and nothing else. So
mapping them onto header rows is not a stub standing in for auth; it is what curl does. D9.

### F4 — An imported credential lands in `state_json` in plaintext — and that is already true of a typed one
`curl -u alice:s3cr3t …` imports to a header row, and a request tab's state is persisted verbatim
in `tabs.state_json` (unencrypted; only `connections.password` and `http_variables.secret_value` go
through `internal/secrets`). This is **not new**: typing `Authorization: Bearer …` into the headers
table today does exactly the same thing. P3 F14 recorded an inherited-posture finding the same way
for local file paths. P7 inherits it rather than widening it, and D9 adds the one honest mitigation
that costs nothing: a warning line naming the fact, with **no** automatic promotion to a secret
variable (that needs a collection the tab may not have, and silently rewriting a pasted command is
the opposite of this phase's ground rule). §8 OQ-4.

### F5 — *Measured*: `curlconverter` is the most-maintained candidate and is still the wrong tool, for two independent reasons
`curlconverter@4.12.0` (npm, published 2025-02-07; 108,466 downloads in the week of 2026-08-23;
GitHub `curlconverter/curlconverter`, 8,172 stars, MIT, last pushed 2026-03-10). Genuinely healthy.
Declined on requirement:

- **It has no structured-request API.** Its README describes the JavaScript API as *"a bunch of
  functions that can take either a string of Bash code or an array of already-parsed arguments…
  and return a string with the resulting program"*. Every documented export returns **generated
  source code** in one of 30 languages. The internal `Request` type it builds on the way there is
  not part of the documented surface, so depending on it means depending on an unstated internal.
- **It cannot run in this webview without shipping and serving WASM.** Its dependencies are
  `tree-sitter` (a native N-API addon — cannot execute in a webview at all), `web-tree-sitter` and
  `tree-sitter-bash`, and the README states: *"If you want to host curlconverter yourself and use it
  in the browser, it needs two WASM files to work, `tree-sitter.wasm` and `tree-sitter-bash.wasm`,
  which it will request from the root directory of your web server"*, plus a `topLevelAwait` bundler
  flag. This app is not served from a web server root — on Linux the desktop build intercepts
  `wails://` inside the native process (`AGENTS.md`'s Wails section), and the bundle's chunk count
  is a stated property (`docs/ARCHITECTURE.md:697`). Unpacked package size: 3.59 MB.

### F6 — *Measured*: every published TypeScript/JavaScript curl **parser** mis-parses input this app must handle
Installed from the real registry and run against a fixed set of commands. What came back:

| Package | Version / published | License | Measured result |
|---|---|---|---|
| `curl-parser-ts` | 0.3.0, 2025-05-30 (3,793/wk) | MIT | **`url` is wrong on the commonest paste.** For a DevTools-shaped command with `\`-continuations it returned `url: "Authorization: Bearer abc.def"`. For `-F 'file=@/tmp/report.csv;type=text/csv'` it returned `url: "file=@/tmp/report.csv;type=text/csv"`; for `--data-binary @/tmp/blob.bin`, `url: "@/tmp/blob.bin"`. Even on the one-line JSON case it invents `Content-Type: application/x-www-form-urlencoded` for a `--data-raw` body, splits the query string out of the URL into a separate `query` map, mis-sets `-G` to POST, and produces `url: ""` with a header named `$'X-A` for an ANSI-C-quoted command. Its declared repository (`hp77-creator/curl-parser-ts`) does not resolve from this session. |
| `@scrape-do/curl-parser` | 0.4.3, 2026-07-29 (2,486/wk) | MIT | **The published build does not load at all**, in ESM or CJS: `dist/index.js` imports `./dist/shellwords` with no extension → `ERR_MODULE_NOT_FOUND`. Repo `scrape-do/curl-parser`, 2 stars. |
| `parse-curl` | 0.2.6, **2017-11-17** (14,544/wk) | **none declared** | An absent `license` field fails `AGENTS.md`'s *"only fully open-source libraries"* rule before behaviour matters. Behaviour is also insufficient: it returns only `{method, header, url}` — the body is dropped for `-d`, `--data-raw`, `-F` and `--data-binary` alike — and it loses the URL entirely on an ANSI-C-quoted command. |
| `curl-parser-js` | 0.0.3, 2017-12-01 (13/wk) | MIT | Regex-based by its own description; effectively unused and unmaintained. Not probed further. |
| `killlowkey/parse-curl` (Go) | last pushed 2023-01-12 | **none declared** | 15 stars, 5 KB, a port of the 2017 JS package above. Fails the same licence rule, and D2 means Go is not the home anyway. |

The pattern is not incidental: three of the four JS packages pick the URL by "the last argument no
flag consumed", which is wrong the moment a flag they do not know about takes a value.

### F7 — *Measured*: `shell-quote` (78 M downloads/week) silently corrupts curl input in three distinct ways
The obvious first choice for the tokenizing half — `shell-quote@1.10.0`, MIT, zero deps, ljharb-maintained,
78,146,086 downloads in the sampled week — and it is genuinely unsuitable here:

1. **`$VAR` is deleted.** `parse(`curl -H "Authorization: Bearer $TOKEN" https://x`)` →
   `["curl","-H","Authorization: Bearer ","https://x"]`. It performs environment substitution against
   an empty environment by default. Passing `env: (k) => '$' + k` restores the literal, so this one
   is fixable — but it is silent until you look.
2. **A line continuation and an empty argument are indistinguishable.** `\` + newline yields a
   spurious `""` token (`… "https://x", "", "-H", "A: 1" …`) — and a genuine `curl -d '' https://x`
   yields `["curl","-d","","https://x"]`. **The same token, from two different inputs.** Filtering
   empty strings breaks `-d ''`; not filtering injects a phantom argument into the flag walk. The
   naive pre-pass (replace `\`+newline with a space before tokenizing) is wrong too: inside single
   quotes, backslash-newline is literal, so a body containing one would be corrupted — you need a
   quote-state-tracking tokenizer to safely pre-process for the tokenizer.
3. **ANSI-C quoting is unsupported**, and unquoted URLs come back as objects.
   `$'https://x/é'` → `"$https://x/\\u00e9"`; `curl https://x/a?b=1` →
   `{"op":"glob","pattern":"https://x/a?b=1"}`; `;`, `|` and `#` come back as `{op}`/`{comment}`
   objects.

### F8 — *Measured*: `shlex@3.0.0` gets all of it right, in 303 lines, and also does the escaping half
`shlex` (npm; a port of CPython's `shlex`; MIT; **zero dependencies**; 21 KB unpacked; 466,958
downloads in the sampled week; published 2025-06-28; ships its own `shlex.d.ts` declaring exactly
`split`, `quote`, `join`). Measured against the same corpus that broke everything above:

| Input | `shlex.split` result |
|---|---|
| `curl -X POST 'https://x' \␊  -H 'A: 1' \␊  -d 'k=v'` | `["curl","-X","POST","https://x","-H","A: 1","-d","k=v"]` — **no phantom token** |
| `curl -d '' https://x` | `["curl","-d","","https://x"]` — a real empty argument, still distinguishable |
| `curl $'https://x/café' -H $'X-A: b'` | `["curl","https://x/café","-H","X-A: b"]` — real ANSI-C decoding |
| `curl -H "Authorization: Bearer $TOKEN" https://x` | `[…,"Authorization: Bearer $TOKEN",…]` — no environment expansion |
| `curl -H 'X: {{token}}' https://x` | `[…,"X: {{token}}",…]` — **this app's own reference syntax survives untouched** |
| `curl https://x/a?b=1&c=2` | `["curl","https://x/a?b=1&c=2"]` — a plain string, no glob object |
| `curl -d "{\"a\":\"b\"}" https://x` | `["curl","-d",'{"a":"b"}',"https://x"]` |
| `curl 'unterminated` | **throws** `Got EOF while in a quoted string` — a legible parse error |

Reading its source (303 lines, `shlex.js`) confirms this is implemented rather than accidental:
`ansiCQuotes`/`localeQuotes` are explicit options, the ANSI-C escape table covers
`\a \b \e \f \n \r \t \v`, octal, `\xHH`, `\uHHHH`, `\UHHHHHHHH` and `\cX`, and the escaped-newline
case is handled as *"An escaped newline just means to continue the command on the next line"*.

**And `quote()` is the generation half.** Round-tripped `quote()` → `split()` over 16 values —
including `it's`, a JSON body containing `'`, an embedded newline, a tab, `$TOKEN`, `{{token}}`,
`a"b`, `semi;colon`, `pipe|char`, `café`, a backslash, and the empty string — **16/16 identical**.
The escape it emits for a single quote is the standard `'"'"'` sandwich.

Bundle cost, measured with `esbuild --bundle --minify`: **2,343 bytes minified, 1,117 bytes
gzipped**, and it is a plain ESM module with no Node built-in imports, so it neither adds a chunk
nor needs a shim.

### F9 — `shlex` has no notion of shell *syntax* above the word level, and that is a fact P7 must handle rather than a defect
It is a lexer, so `curl https://x ; rm -rf /` tokenizes to `[…,"https://x",";","rm","-rf","/"]` and
`curl https://x # note` to `[…,"#","note"]`. Nothing is executed — this app never runs a shell — but
treating `rm` as a second URL would be silently wrong. D3 stops the walk at the first bare `;`, `|`,
`||`, `&&`, `&`, `>`, `<`, `>>` or `#` token and warns. (Note the asymmetry that makes this safe:
those tokens can only appear *bare* if they were unquoted in the source, since a quoted `;` comes
back as part of its own argument.)

### F10 — *Measured against curl 8.5.0*: `-F` refuses a text value beginning with `@`, and `--form-string` is the fix
`curl -F 'note=@notafile'` **fails** (curl treats the leading `@` as a filename and the file does not
exist). `curl --form-string 'note=@notafile'` sends a text part whose body is the literal
`@notafile`. So a generated `-F` for a text row whose value happens to start with `@` or `<` would
produce a command that either fails or uploads an unrelated file. D15 emits `--form-string` for
**every** text row and `-F` only for file rows.

Also measured: `-F "file=@<path>;type=text/csv"` produces
`Content-Disposition: form-data; name="file"; filename="report.csv"` + `Content-Type: text/csv` —
i.e. `;type=` is exactly `HttpFormFieldWire.contentType` and the filename is curl's own basename of
the path, which is what `formData[].fileName` already holds.

### F11 — *Measured*: curl's `Content-Type` defaults differ from this app's, and the difference is semantic
| Command | Content-Type curl actually sent |
|---|---|
| `curl -d '{"a":1}' …` | `application/x-www-form-urlencoded` |
| `curl --data-binary @report.csv …` | `application/x-www-form-urlencoded` |
| `curl --json '{"a":1}' …` | `application/json`, **plus** `Accept: application/json` |
| `curl -T report.csv …` | *none*, method PUT |
| `curl --data-binary @f -H 'Content-Type:' …` | *none* — the empty-value `-H` **removes** the header |

Against this app: a `raw` body sends `text/plain`, a `code`/json body `application/json`, and a
`file` body **nothing** (§1.6). So neither direction can assume the other's default:

- **Import**: `curl -d '{"a":1}'` with no `Content-Type` header would have been sent as
  urlencoded. Importing it as `code`/json would send a *different* request than the command did.
  D8 imports it faithfully and warns.
- **Generate**: `--data-binary @path` alone would make curl add a `Content-Type` this app never
  sends. The measured fix is the empty-value `-H 'Content-Type:'`, and D15 uses it.

### F12 — *Measured*: the credential and header edge shapes behave exactly as documented
`-u alice:s3cr3t` → `Authorization: Basic YWxpY2U6czNjcjN0` and nothing else.
`-H 'X-Empty;'` → the header is sent with an empty value (curl's documented `Name;` form).
Multiple `-d` flags merge with `&` (`-d 'a=1' -d 'b=2'` → body `a=1&b=2`), matching the man page's
*"the data pieces specified are merged with a separating &-symbol"*.
`-d @file` **strips newlines** (`hello,csv\n1,2\n` → `hello,csv1,2`) while `--data-binary @file`
does not — which is why D15 never generates a bare `-d`.

### F13 — *Measured*: `--data-urlencode` cannot reproduce this app's urlencoded body
`curl --data-urlencode 'a b=c d' --data-urlencode 'x&y=z&w'` sent `a b=c+d&x&y=z%26w`: the **name is
left raw** (a literal space, a literal `&` that breaks the pair) and only the value is encoded.
`buildURLEncoded` (`body.go:144`) `url.QueryEscape`s **both** halves. So there is no `--data-urlencode`
spelling that reproduces what this app sends. D15's answer — emit the already-encoded string as
`--data-raw` plus the explicit `Content-Type` — was verified byte-for-byte: `--data-raw 'a+b=1%262&c=%C3%A9'`
arrived as exactly those 18 bytes.

Related, and also measured: `curl -G -d 'q=hello world'` **fails outright** with
`URL rejected: Malformed input to a URL function`, because `-G` appends the data to the query string
verbatim. So `-G` data is query text, not a decoded pair list — D8 appends it as text.

### F14 — Import must not silently discard the current tab's contents, and `openHttpRequestTab` already gives the alternative for free
`state/tabs.ts:398-402` — `openHttpRequestTab()` opens a fresh `http-request` tab with
`defaultHttpRequestTabState()` and `reuse: false`, and `patchHttpRequestTabState(id, patch)`
(`:677-679`) applies a partial state to it. So "import into a new tab" is two existing calls, and it
removes the whole question of what to do about an unsaved request the user was in the middle of.
D12.

### F15 — An imported `binaryFile` has no size, and today's caption would print `(0 B)`
`BinaryBodyPicker.vue:31` renders `{{ name }} ({{ formatBytes(size) }})` unconditionally.
`httpBinaryFileSchema` (`http.ts:163-167`) requires `size: number`, and an imported
`--data-binary @/path/blob.bin` has no size to supply — the renderer must not `stat` (P3 D4), and Go
re-`os.Stat`s at send anyway (`body.go:156-180`), which is exactly why the stored size is
display-only. `size: 0` plus a one-line `v-if` in the caption is the whole fix.

### F16 — *Verified safe*: no new tab kind, no new op kind, no new bound method, no new IPC channel
The import target is the existing `'http-request'` kind; generation makes no bound call at all; the
one bound call the reveal loop makes (`variablesReveal`) is already registered in
`tests/ui/support/ipcChannels.ts` and `mockRuntime.ts:104` and is not an op
(`bridge/variables.go:203-209` calls `HttpVars.Reveal` directly, never `Router.Host().RunOp`). So
`tabKindSchema`, `RENDERABLE_TAB_KINDS`, `TAB_KIND_MODE`, `tabRecordSchema`, `model.RenderableTabKinds`,
`model.opKinds` and `tests/unit/go-ts-vocabulary-parity.spec.ts` are all byte-identical after this
phase, and `mockRuntime.ts` needs no `WILDCARD_DEFAULTS` entry (both dialogs are opened by an
explicit action, never fetched on mount — F9 of P5's hazard does not apply).

---

## 3. Checked, and not fired

- **No Go file changes, no `go build`/`go vet` in the loop, no bindings regeneration.** F1 + F16.
  `internal/httpvars/`, `internal/httpclient/`, `internal/bridge/`, `internal/postman/` and
  `packages/shared/` are byte-identical after this phase, exactly as P6 left Go untouched.
- **No storage migration, no `state_json` shape change.** Import writes fields that already exist
  (§1.2); nothing new is persisted (D10).
- **No `packages/shared/domain/http.ts` change.** The parse result is a `Partial<HttpRequestTabState>`
  over existing fields; the generate input is `HttpBodyWire` + `HttpHeaderWire[]`, both existing.
  `HTTP_BODY_MODES`, `CODE_LANGUAGES` and `CONTENT_TYPE_BY_CODE_LANGUAGE` are read, never widened.
- **No `substitute.ts` change.** P6 added the only parameter this phase needs (`dynamic`), and D11
  uses `resolve()` unchanged for the second, secrets-only pass.
- **No `internal/httpvars/testdata/substitution.json` change** and no `tests/unit/http-substitution.spec.ts`
  change. The cross-language corpus is about the `{{name}}` grammar, which P7 does not touch.
- **No new `theme/primitives/` component.** `DialogFrame` + `MessageStrip` + `AppButton` +
  `IconButton` + the existing `.p-strip`/`.p-code`/`.p-sm muted` classes cover both dialogs, the
  same bar P4 D12 and P6 D11 set.
- **No `tests/ui/support/` change.** F16.
- **No `clipboard.ts` change.** `copyText` already exists and already handles the failure case
  (`:5-9`'s own comment).
- **No change to `send()`'s behaviour, `op_log`, the Operations panel, or the two-stage split.**
  C4 moves one private function between files; §6.5 is the guard.
- **No `NOTICES.md` change.** That file's own header scopes it to *"third-party icon assets"* and
  its only section is `simple-icons`; MIT code dependencies (`zod`, `slickgrid`, `sql-formatter`,
  CodeMirror, faker) have never been listed there.

---

## 4. Decisions

### D1 — The shell-quoting half is `shlex`; the curl-flag half is written here. Both sides of that, with the measurement
`AGENTS.md`: *"Reach for an existing, well-maintained library before hand-rolling non-trivial
infrastructure… a hand-rolled version earns its keep only against a real requirement no library
meets — name that requirement when declining a library."* Two separate problems, two different
answers, and the split is the whole point.

**Adopted: `shlex@3.0.0`** for `split()` on the way in and `quote()` on the way out. MIT, zero
dependencies, 2.3 KB minified / 1.1 KB gzipped (F8's measurement), ships its own types, plain ESM.
It is the one candidate that handled every shape this app must survive — escaped-newline
continuations, a genuinely empty argument, ANSI-C `$'…'`, an un-expanded `$VAR`, an untouched
`{{token}}`, an unquoted query string, and a legible error on an unterminated quote — and it also
solves the *generation* escaping, which nothing else on the list even attempts. Adding it to root
`dependencies` (beside `zod`, `@floating-ui/dom`, `slickgrid`, `flatbuffers`) is the whole install.

**Declined, each against the requirement it fails:**

- **`curlconverter`** (F5) — the healthiest package here by every maintenance measure, and still
  wrong twice: it exposes **no structured-request API** (every documented export returns generated
  source in another language), and it **cannot run in this webview** without serving
  `tree-sitter.wasm` + `tree-sitter-bash.wasm` from a web-server root this app does not have, plus
  a `topLevelAwait` bundler flag, for a 3.59 MB package. Neither is a preference; both are
  requirements it does not meet.
- **`curl-parser-ts`, `@scrape-do/curl-parser`, `parse-curl`, `curl-parser-js`,
  `killlowkey/parse-curl`** (F6) — measured wrong on the shapes that matter (a DevTools paste, a
  `-F` file field, a `--data-binary @file`, an ANSI-C-quoted command), and two of the five declare
  **no licence at all**, which fails `AGENTS.md`'s open-source rule before behaviour is even
  reached. One of the five does not load at all as published.
- **`shell-quote`** (F7) — the highest-usage package in the whole search, declined on three measured
  behaviours, of which one is decisive: **a line continuation and an empty `-d ''` produce the
  identical `""` token**, so there is no post-filter that is correct for both, and the pre-filter
  that would fix it needs quote-state tracking, i.e. the tokenizer it was supposed to replace.
- **`bash-parser`** — a full bash AST (2017, 21 transitive dependencies). A grammar for a language
  we are deliberately *not* interpreting; F9's stop-at-the-first-operator rule is the correct
  posture, not a parse tree of a pipeline we would then refuse to run.
- **`string-argv`** (36 M/wk) and **`argv-split`** — probed alongside `shlex`: `string-argv` leaves
  `\` continuations as literal `"\\"` tokens, mangles `\"` inside double quotes, and does not know
  `$'…'`. Simpler than `shlex` and measurably less correct.

**The requirement no library meets, named as the rule asks:** the mapping target. A curl command's
flags have to land on **this app's own** `none|raw|code|urlencoded|formdata|file` vocabulary with
its own `codeLanguage` sub-selector and no `graphql` mode — a vocabulary
`packages/shared/domain/http.ts:99-115` explains was *deliberately* diverged from Postman's, and
which every published parser therefore cannot target. On top of that, D8's mode-selection rule turns
on this app's own `Content-Type` precedence (§1.6/F11) and D15's generation turns on
`buildURLEncoded`'s own both-halves encoding (F13) — three facts that live in this repository, not
in any package. The flag walk itself is a table plus one loop; what earns the dedicated tests is not
its size but its interacting rules, which is exactly `AGENTS.md`'s *"a parser/splitter with several
interacting rules"* clause (D17).

### D2 — Both directions are **pure renderer TypeScript**, under `http/curl/`. No Go, in either direction
The brief's third question, answered against F1/F2 rather than by analogy:

| | Why it is not Go |
|---|---|
| **Parse** | Produces tab state, which Go treats as opaque `json.RawMessage` by design (`model/tabs.go:8-12`). A Go parser would have to ship its result back across the bridge to become the very thing Go refuses to model. |
| **Generate** | Must substitute **secrets and dynamic values**. Dynamic values are `@faker-js/faker`, renderer-only by P6's own row. Secrets are reachable in the renderer only *after* the gate (§1.4) — which is precisely the property that makes the gate meaningful. |
| **Generate, the security argument** | F2: a Go generator would be a second bound method holding a fully-resolved, credential-bearing request, one line away from `op.SetCommand`/`slog`. In the renderer there is no op, no persisted column, no log sink — the hazard is absent, not mitigated. |

**Contrast with P5's deliberately dual engine, so the difference is on the record.** `{{name}}`
substitution is written twice (`http/substitute.ts` and `internal/httpvars/resolve.go`) because Go
*must* finish the secret half at send time, after `SetCommand`. curl has no send: nothing about a
curl command ever needs to exist while a request is in flight. So the "shell-quoting is
parser-shaped like the `{{name}}` grammar, therefore it should be dual too" reasoning does not
follow — what made substitution dual was **where the secrets have to be decrypted**, not that it was
a parser. There is no second consumer to be in parity with, so there is no corpus to share and no
`go-ts-vocabulary-parity.spec.ts` entry to add.

This makes P7 shaped exactly like P6: renderer-only, no migration, no bound method, **no bindings
regeneration**, `docs/ARCHITECTURE.md`'s *"Go is untouched by P6"* paragraph gaining a sibling.

**Module boundary.** New code lands under `apps/kira-studio/frontend/src/http/curl/` (pure logic)
and `http/` (the two dialogs and their store), which is where `docs/v1.2/SPEC.md`'s boundary section
puts Http-specific frontend code and what P12 will move as a unit. Nothing new lands in `views/`
except two edits inside the already-Http-owned `views/httprequest/` directory. `http/curl/*` imports
`shlex` and `@shared/domain/http` and nothing else — pure, Vue-free, DOM-free, the same property
`substitute.ts`'s own header comment claims and that makes its corpus test a plain import.

### D3 — Tokenizing: `shlex.split`, plus three rules of our own
`http/curl/tokenize.ts` exports one function:

```ts
export type TokenizeResult =
  | { ok: true; argv: string[]; warnings: CurlWarning[] }
  | { ok: false; error: string };

export function tokenize(text: string): TokenizeResult
```

1. **Unterminated quote / trailing escape** — `shlex.split` throws (`Got EOF while in a quoted
   string`); caught and returned as `{ok:false, error}`, which is what disables the dialog's Import
   button with the message shown. No exception escapes this module.
2. **The `curl` prefix is optional and stripped.** A leading token equal to `curl` (or ending
   `/curl`) is dropped; anything else is kept, so a pasted fragment starting at `-X POST` still
   parses. If the first token is some *other* command word, the walk still runs — the flag table is
   what decides meaning, and a warning names the unexpected leading word.
3. **The walk stops at the first bare shell operator** — `;`, `&`, `&&`, `|`, `||`, `>`, `>>`, `<`,
   `#` (F9) — keeping everything before it and emitting a `shell-operator` warning naming what was
   dropped. Nothing is ever executed; this is about not mistaking `rm` for a URL.

`shlex.split` is called with no options, so ANSI-C and locale quoting stay on and no environment
substitution ever happens — F8's measured behaviour is the contract.

### D4 — The parse result is a **state patch plus a warning list**, and the warnings are part of the feature
```ts
export const CURL_WARNING_KINDS = [
  'shell-operator', 'unknown-flag', 'unsupported-flag', 'method-coerced', 'multiple-urls',
  'header-malformed', 'data-file-inline', 'form-file-content', 'form-filename',
  'implied-content-type', 'credential-in-command', 'no-url',
] as const;
export type CurlWarningKind = (typeof CURL_WARNING_KINDS)[number];
export interface CurlWarning { kind: CurlWarningKind; detail: string }

export interface ParsedCurl {
  /** Only the fields a curl command can express — everything else keeps its default. */
  state: Pick<HttpRequestTabState,
    'method' | 'url' | 'headers' | 'bodyMode' | 'body' | 'code' | 'codeLanguage' |
    'urlEncoded' | 'formData' | 'binaryFile'>;
  warnings: CurlWarning[];
}
export function parseCurl(text: string): ParsedCurl | { error: string };
```

A closed union rather than free-form strings, for the same reason `internal/postman`'s warning kinds
are one (P4 D12): the UI keys a `<li data-kind>` off it and a test asserts a kind, not prose.

**The warnings are shown live in the import dialog, before Import is pressed**, not as a strip
afterwards — which is the one place this phase deliberately diverges from P4's post-hoc
`ImportReportStrip`. A collection import is a long operation over a file you cannot see; a curl
paste is a short string sitting in the textarea in front of you, so the honest place to say *"`-k`
was ignored; this app always verifies TLS"* is beside it, while it can still be edited. No new
per-tab runtime state, no strip in the request view, and `ImportReportStrip.vue` is untouched.

### D5 — Method, URL and headers
**Method**, in precedence order: `-X`/`--request <m>` wins; else `-I`/`--head` → `HEAD`; else
`-T`/`--upload-file` → `PUT`; else `-G`/`--get` → `GET`; else any `-d`-family or `-F` flag → `POST`;
else `GET`. (`-G` beats a body flag, matching curl's own *"makes all data specified with --data,
--data-binary or --data-urlencode to be used in an HTTP GET request instead of the POST request"*.)

**URL**: the first argument the flag walk did not consume, or the value of `--url`. Later
non-flag arguments produce a `multiple-urls` warning and are dropped (curl would fetch each one; a
request tab is one request). No URL at all → a `no-url` warning and an empty URL field, which is a
valid, editable tab state rather than a refusal. `-G`'s data is appended as query text
(`?` or `&` as appropriate) exactly as curl does — F13 measured that curl appends it verbatim,
so nothing is re-encoded here.

**Headers**: `-H`/`--header 'Name: value'` in order; `Name;` sets an empty value (F12); a value with
no colon and no semicolon is dropped with a `header-malformed` warning. Sugar flags become real
header rows, which is what they are on the wire (F3/F12):

| Flag | Header row |
|---|---|
| `-A`, `--user-agent` | `User-Agent: <v>` |
| `-e`, `--referer` | `Referer: <v>` |
| `-b`, `--cookie` (a `k=v` string, not a filename) | `Cookie: <v>` |
| `-u`, `--user <user:pass>` | `Authorization: Basic <base64>` (F12) |
| `--oauth2-bearer <t>` | `Authorization: Bearer <t>` |
| `--json` | `Content-Type: application/json` **and** `Accept: application/json` (F11), plus the data (D8) |

`-u` and `--oauth2-bearer` additionally raise a `credential-in-command` warning (F4/D9).
`-b` naming a file rather than a `k=v` pair is an `unsupported-flag` warning — reading a cookie jar
would be a filesystem read the renderer must not do.

### D6 — The flag table is data, and both "ignored" lists are explicit
`http/curl/flags.ts` holds one record per known flag: its long and short spellings and whether it
takes a value (which is the only thing the argv walk needs to stay in step — a flag whose arity we
get wrong swallows the URL, which is exactly F6's failure mode). Short-flag clustering (`-sSL`) is
expanded, and `--flag=value` is split on the first `=`.

Two deliberately separate sets, because conflating them is how an importer becomes either noisy or
dishonest:

- **Ignored silently** — flags that change nothing about the request as the server sees it:
  `-s/--silent`, `-S/--show-error`, `-v/--verbose`, `-i/--include`, `-o/--output`, `-O`,
  `-w/--write-out`, `--fail`, `-#/--progress-bar`, `-N/--no-buffer`, `--compressed`,
  `-L/--location`, `--http1.0/1.1/2/3`, `--retry*`, `-4/-6`. (`-L` and `--compressed` are ignored
  *on import* because this app already follows redirects and already negotiates encoding —
  §1.6 — so honouring them is the default, not a change.)
- **Warned** (`unsupported-flag`) — flags that would have changed the request and cannot be
  represented: `-k/--insecure` (this client always verifies TLS, `client.go:38-42`, with no
  per-request opt-out — a command that disabled verification will behave differently here, and that
  must be said), `-x/--proxy`, `--cert`/`--key`/`--cacert`, `--resolve`, `--interface`,
  `-c/--cookie-jar`, `--limit-rate`, `-m/--max-time`/`--connect-timeout` (the 30 s deadline is fixed,
  `client.go:27`; P3 §8 OQ-2 still owns a per-request timeout), `-K/--config`, `--proto*`,
  `--netrc*`, `-E`, `--anyauth`/`--digest`/`--ntlm`.
- **Anything else** → `unknown-flag`, named verbatim. An unknown flag is assumed to take **no**
  value; the alternative (assume it takes one) eats the URL, which is F6's exact failure.

### D7 — Body mode selection is decided by the *effective* `Content-Type`, and by nothing else first
The rule, in order, over the merged `-d`-family data:

1. **An explicit `Content-Type` header in the command wins.** `application/x-www-form-urlencoded`
   **and** every piece parses as `k=v` → `urlencoded` rows. A type whose subtype maps into
   `CODE_LANGUAGES` (`application/json`+`+json`, `application/xml`/`text/xml`+`+xml`, `text/html`,
   `application/javascript`/`text/javascript`) → `code` with that `codeLanguage`. Anything else →
   `raw`, with the header kept so the request still sends what the command sent.
2. **No `Content-Type` header, `-d`-family data present** → curl would have sent
   `application/x-www-form-urlencoded` (F11, measured). If every piece parses as `k=v`, that is
   `urlencoded` mode and the app's own default for that mode is the same string, so nothing extra is
   added. Otherwise the mode is `raw` **and an explicit `Content-Type: application/x-www-form-urlencoded`
   header row is added**, with an `implied-content-type` warning saying exactly that — because
   `raw`'s own default is `text/plain` (§1.6) and silently sending a different type than the command
   did would be the "helpfully rewrites what the user asked for" failure this repo declines
   everywhere else.
3. **`-F`/`--form` present** → `formdata`, regardless of any `Content-Type` header (curl mints its
   own boundary; a stated one cannot be honoured). D8 covers the row shapes.
4. **`-T`/`--upload-file`** → `file` mode with that path, method PUT.
5. **No data at all** → `none`.

**A DevTools-style `--data-binary` carrying a hand-built multipart body is imported as `raw`, not as
`formdata`.** `everything.curl.dev`'s own *Copy as curl* page records that browsers emit form posts
as *"handcrafted `--data-binary` solutions including the mime separator strings"* rather than `-F`.
Re-parsing a multipart payload back into rows would mean writing a MIME parser to guess at
boundaries the header already states, and would silently rewrite the boundary on the next send.
Keeping the bytes and the header is faithful and lossless; §8 OQ-2 records it.

### D8 — `@file`, `<file` and the path rule P3 D4 set
The renderer never reads a file's bytes (P3 D4/F7), so curl's file-reading forms cannot all be
honoured, and each gets a decision rather than a shrug:

| Form | P7 |
|---|---|
| `--data-binary @path` as the **only** data piece | → `file` (binary) mode, `binaryFile = {path, name: basename(path), size: 0}`. This is exactly *"one local file as the whole body"*, which is what the mode is. Go re-`os.Stat`s at send (`body.go:156-180`), so a path that does not exist fails legibly there — the same treatment P4 F5 already relies on for an imported `file.src`. F15's one-line caption fix. |
| `-d @path` / `--data @path` / `--data-ascii @path` | `data-file-inline` warning, piece dropped. curl would inline the file's contents **with newlines stripped** (F12) — an app that cannot read the file cannot fake that, and inventing an empty body would be worse than saying so. |
| `--data-urlencode @path` / `=@path` / `name@path` | same `data-file-inline` warning. |
| `-F 'k=@path'` | a `formData` **file** row: `kind:'file'`, `path`, `fileName: basename(path)`, `fileSize: 0`, `contentType` from `;type=` when present (F10). |
| `-F 'k=<path'` | `form-file-content` warning, row dropped — `<` means *"a text field whose contents come from this file"*, and a text row's value has to be text we do not have. |
| `-F 'k=v;filename=other'` | the row is kept; a `form-filename` warning records that the per-row filename override has no home in `httpFormDataFieldSchema` (P3 §0.2 already excluded per-row extras). |
| `-F 'k=v'` (plain) | a text row. |
| `--data-raw @anything` | literal — `--data-raw` is documented as *"without the special interpretation of the @ character"*, so no warning and no file handling. |

Every dropped piece is named in its warning, so nothing disappears without a sentence.

### D9 — Auth is headers, a coerced method is warned, and neither pretends to be more than it is
**Auth**: D5's table. This is not a placeholder for the Auth tab P4 §8 OQ-2 still owns — it is what
curl sends (F12), so a request built this way is byte-equivalent to the command. When auth lands,
its importer can promote an `Authorization` header the same way P4 D9's contract promotes a Postman
`auth` block; nothing here has to be undone. §8 OQ-4.

**A credential in a pasted command raises `credential-in-command`**, with the honest sentence: the
value will be stored in this tab's state in plain text, and the app's place for a credential is a
**secret variable** (P5). It **does not** offer to create one: that needs a collection a scratch tab
may not have, needs a name the user has not chosen, and would mean the importer silently rewriting
the command it was given. §8 OQ-4.

**A method outside `HTTP_METHODS`' seven members** (`curl -X PROPFIND`) is coerced to `GET` with a
`method-coerced` warning naming the original — **the exact rule P4 D7 already applies** to an
imported Postman request, so the two importers behave identically rather than each inventing a
policy. Widening the vocabulary is declined here for P4 §8 OQ-3's own stated cost: a genuinely
custom method needs an editable combo box in place of the `<select>` (`HttpRequestView.vue:212-219`)
and a default colour family for `httpMethodClass`'s four (`http.ts:295-306`) — a request-toolbar
change, which is P13's territory, not a corner of a curl phase. §8 OQ-1 re-hands it with this
phase's evidence: `curl -X PROPFIND` is now a *measured* real input, not a hypothesis.

### D10 — **A generated command carrying a secret's real value is a reveal.** The dialog opens masked; the reveal is one explicit action, through the gate that already exists
This is the question P5 §8 OQ-10 and P6 §8 OQ-8 both handed forward, and P5 D21 pre-committed the
rule. It is settled here, in full, because *"generate a runnable curl command"* is the phase.

**The rule, stated generally so the other two surfaces inherit it rather than re-deriving it:**
*any surface that renders a secret variable's substituted value as visible text is a reveal.* It
defaults to masked, it goes through `localauth` when un-masked, and it never persists what it shows.
That covers *Copy as curl* (built here), P5 OQ-10's resolved-URL hover preview and P6 OQ-8's
resolved-body preview (neither built here — they are UI questions, and the *secret* question they
were both blocked on is no longer open).

**The flow, concretely:**

1. `HttpRequestView.vue` computes the request **once** on open, exactly as `send()` does: `resolveTabState(state, values, secretNames, await loadDynamicGenerator())` when any ref is `dynamic`, otherwise the three-argument form (P6 D7's short-circuit, so a request with no `{{$…}}` still loads no faker chunk). It hands the store the frozen `ResolvedRequest`, the method, and the `deferred` ref names.
2. The dialog renders `toCurl(...)` over that immediately. Secrets are still `{{token}}` — that is what stage 1 leaves (P5 D6) — and a `.p-strip note` says *"2 secret values are not shown. The command will not run as-is."* with a **Show secret values** button. **Nothing has prompted.**
3. Pressing it runs the reveal loop: for each deferred name, look its id up in `cachedVariables` (`http/state/variables.ts:151`) and call `revealVariable(id, false)` — the existing function, the existing four outcomes, the existing `confirmDialog` fallback. The 5-minute process-wide grace (`docs/ARCHITECTURE.md:441-443`) means **one** prompt covers every secret in the command, this session, and a connection-password reveal too.
4. `applySecretValues` (D11) finishes the frozen resolution with the revealed values and the command is re-rendered. The strip becomes a `warn` tone: *"This command contains real secret values."*
5. **A cancelled, unavailable-and-declined, or errored reveal leaves that reference literal** and the strip says which names are still masked. Nothing throws, nothing is refused — P5 D10's and P6 D13's identical *"leave the token literal"* treatment.

**Why masked-by-default rather than prompt-on-open**, stated as the trade because it is the part P5
could not settle: prompting on open makes *Copy as curl* cost a fingerprint every time, including
the overwhelmingly common case of a request that references no secret at all (where there is nothing
to reveal) and the case where the user wants the masked, shareable form (a bug report, a colleague,
a `{{token}}`-carrying template). That is precisely the friction P14 D5 identified as what *"gets a
security feature disabled"*. Masked-by-default costs one click in the case that genuinely needs it
and zero in every other.

**Copy is available in both states.** Copying the masked form is a legal, useful act producing a
non-runnable command; copying the revealed form requires having passed the gate. The button's label
does not change — the strip above it already says which one is on the clipboard.

**Dynamic values are not a reveal and are not gated** (P6 D12 fact 3). They are generated once on
open, per occurrence, and frozen — so the dialog also carries P6 D12 fact 2 as one caption line:
*"`{{$…}}` values are generated once for this command; running it twice sends the same values."*
That is inherent to curl having no notion of a dynamic value, and the SPEC row asks for exactly it.

**Nothing generated is persisted.** The command string lives in a `reactive` store field cleared on
close, the same discipline `revealedValues` (`variables.ts:202`, dropped in `closeVariablesDialog`
at `:117-123`) and `runtime[tabId].response` already follow; it never enters `patchHttpRequestTabState`,
so it never reaches `tabs.state_json`; and there is no bound call, hence no `op_log.command` row and
no `slog` line (D2/F2). §6.3 asserts all three.

### D11 — The renderer's own "stage 2": one frozen resolution, then a secrets-only second pass
The subtle failure this exists to prevent: re-running `resolveTabState` with the revealed secrets in
`values` would **re-roll every `{{$…}}` dynamic value** (P6 D3 generates per occurrence, per call),
so pressing *Show secret values* would change the UUIDs in a command the user was already looking
at. The fix is the shape Go already uses — resolve once, then finish the leftovers:

```ts
// http/substituteRequest.ts — pure, @shared-only, no Vue and no views/ import.
export function substituteBody(body: HttpBodyWire, sub: (t: string) => string): HttpBodyWire;

/** The renderer twin of internal/httpvars.ResolveRequest's stage 2: a second `resolve()` pass over
 *  an already-resolved request, carrying only the secret values a gated reveal produced. Everything
 *  stage 1 finished is already text, so this pass can only ever fill in a `deferred` span — a
 *  frozen {{$guid}} is not re-rolled because it is no longer a reference at all. */
export function applySecretValues(
  resolved: ResolvedRequest,
  secretValues: Readonly<Record<string, string>>,
): ResolvedRequest;
```

`substituteBody` **moves here verbatim** from `views/httprequest/state.ts:63-87`, which imports it
back. That is C4, and it is the boundary-correct home rather than a workaround: it is a pure walk
over `HttpBodyWire`, i.e. Http-module logic that has been sitting in a view file, and `http/state/curl.ts`
cannot import `views/**` (§0.3). One import line changes in `state.ts`; no behaviour does.

### D12 — Import opens a **new** request tab, and the preview is live
`openHttpRequestTab()` then `patchHttpRequestTabState(id, parsed.state)` (F14). Non-destructive by
construction: an unsaved request the user was mid-edit on is never overwritten, there is no "are you
sure" to design, and the imported tab is immediately saveable into a collection through P4's
existing Save/Save as… — which is the *"benefits from P4 existing"* half of the SPEC row, with no new
collection machinery.

The dialog is a `DialogFrame` with a plain `<textarea>` (not CodeMirror — there is no grammar to
highlight and P3 D1's bundle argument applies), and everything below it recomputes on every input:

- a one-line summary — `POST · api.example.com/v1/orders · 3 headers · JSON body`;
- the warnings, as `<li :data-kind>` on the existing `.p-strip warn` shape `ImportReportStrip.vue`
  established;
- a parse error (`{ok:false}` from D3), which disables **Import** and shows the message.

Entry points, all existing seams (§1.5), none of them new machinery:
`http/menus.ts`'s `backgroundMenu` gains *Import from curl…*; `CollectionsPanel.vue` wires the
action and registers `http.importCurl`; `HttpStart.vue` gains a third front-door button;
`shortcuts/state.ts` gains one palette entry. (Pasting a curl command **into the URL field** —
Postman's own idiom — is deliberately not built: it means intercepting a `TextField` paste and
silently replacing the request the user is editing, which is exactly what D12 chose against. §8 OQ-6.)

### D13 — Generation takes plain data and returns a string
```ts
export interface CurlRequest {
  method: string;
  url: string;
  headers: readonly HttpHeaderWire[];
  body: HttpBodyWire;
  /** P3 D7's per-mode default, computed by the caller from views/httprequest/body.ts's own
   *  defaultContentTypeFor — passed in rather than recomputed here, so there is one table and
   *  http/curl/ keeps its no-views-import property. '' means "this mode sends none". */
  defaultContentType: string;
}
export function toCurl(req: CurlRequest): string;
```

Pure, synchronous, no `{{ }}` awareness at all — every reference the caller could resolve is already
text by the time it arrives, and any that remains is emitted verbatim (which is what makes the
masked form a real, copyable command with `{{token}}` visibly in it).

**Layout**: `curl` first, then `-L` and `-X` when they apply, then the quoted URL, then one flag per
line joined with ` \\\n  ` — the shape browsers and Postman both emit, and the shape D17's round-trip
test proves re-parses. Every argument goes through `shlex.quote` (F8), which is the whole of the
escaping story.

### D14 — Which of this client's own defaults appear in the generated command, and the line between them
The rule: **emit a default that changes how the server interprets the request; do not emit one that
merely identifies the client.**

| This client's behaviour | In the command? |
|---|---|
| Follows up to 10 redirects (`client.go:32`) | **`-L`, yes.** curl does not follow by default, so omitting it makes the command *not* equivalent — a 301 would print a stub instead of the resource. |
| Applies the mode's default `Content-Type` when the user set none (§1.6) | **Yes, as an explicit `-H`.** F11 measured that curl's own defaults differ (`-d` → urlencoded even for JSON), so leaving it out changes how the body is parsed. |
| Sends no `Content-Type` at all for a `file` body (P3 F3) | **Yes — as `-H 'Content-Type:'`**, the empty-value form that *removes* a header, measured in F11. Without it curl adds `application/x-www-form-urlencoded` to a binary upload. |
| `User-Agent: Kira Studio/<version>` when the user set none (`client.go:275-278`) | **No.** It identifies the client and changes nothing about interpretation; curl supplies its own `curl/x.y`. Putting this app's UA in a command run by curl would be a small lie about what produced the request. A user-*typed* `User-Agent` header row is of course emitted like any other header. |
| 30 s deadline (`client.go:27`) | **No.** A client-side convenience, not part of the request. `--max-time` is also on D6's warned list in the other direction, so the two are symmetric. |
| No `Accept-Encoding` set; Go's transport adds `gzip` transparently (`client.go:279-282`) | **No `--compressed`.** It changes only transfer encoding, never the decoded body, and emitting it would put a flag in the command the user never asked for. Recorded as a known asymmetry rather than hidden. |
| TLS always verified, no opt-out (`client.go:38-42`) | Nothing to emit — curl verifies by default too. `-k` is never generated. |

### D15 — The per-mode generation table, every row of it measured
| Mode | Emitted |
|---|---|
| `none` | nothing |
| `raw` | `--data-raw <text>` — **never `-d`**, which strips newlines from `@file` input and interprets a leading `@` (F12) |
| `code` | `--data-raw <text>` |
| `urlencoded` | **`--data-raw '<the exact encoded string>'`** plus the `Content-Type` header. F13 is why: `--data-urlencode` leaves the *name* unencoded, while `buildURLEncoded` (`body.go:144`) `url.QueryEscape`s both halves, so no `--data-urlencode` spelling reproduces what this app sends. The generator builds the identical string the same way (`encodeURIComponent`-equivalent per half, `+` for a space, joined with `&`, in row order) — verified byte-for-byte against a real curl in F13. |
| `formdata`, text row | **`--form-string 'name=value'`** — F10: `-F` refuses (or misreads) a value beginning with `@` or `<`, and `--form-string` exists for exactly that |
| `formdata`, file row | `-F 'name=@/abs/path'`, with `;type=<contentType>` appended when the row sets one (F10) |
| `file` (binary) | `--data-binary @/abs/path` **plus `-H 'Content-Type:'`** (D14/F11) |

**The formdata `Content-Type` exception, stated because it is the mirror image of P3 D7's.** curl's
`-F` mints its own boundary, so a user-set `multipart/form-data; boundary=…` header cannot be
honoured — emitting it would produce a command whose header contradicts its own body. So for
`formdata`: a user-set `Content-Type` is emitted **only when it is not `multipart/form-data`**, and
when it is, the header is dropped and the dialog says one line about why. Every other mode emits the
user's header verbatim.

**Disabled and unnamed rows never appear** — the generator is handed the `HttpBodyWire` that
`buildBodyWire` already filtered (P3 D5), so there is no second filter to disagree with the first.

### D16 — An `Authorization` header is emitted as a header, never decoded back into `-u`
The temptation is to turn `Authorization: Basic YWxpY2U6…` back into `-u alice:s3cr3t`, and it is
declined on two counts: it is a *guess* (the header may be a token that merely looks base64), and
it would move a credential from the place the user put it into a differently-shaped flag, so a
round trip through this phase would not be the identity. `-H 'Authorization: …'` is exactly what
curl puts on the wire either way (F12), so nothing is lost. This is also what makes D17's round-trip
property hold.

### D17 — What gets a dedicated test, and what does not
`AGENTS.md`'s bar: a test earns its keep only guarding *"a parser/splitter with several interacting
rules"* among a short list. This phase contains one of those and several things that are not, and
the split is deliberate:

**Tested, via one JSON corpus** (`apps/kira-studio/tests/unit/curl-cases.json`) read by
`apps/kira-studio/tests/unit/http-curl.spec.ts` — the same shape P5 D18's substitution corpus
established, minus the second language (D2: there is no Go twin to be in parity with, so the corpus
lives beside its one reader rather than in `internal/*/testdata/`):

1. **`parseCurl`** — the interacting rules are real and each pair of them can break the other: mode
   selection × the effective `Content-Type` (D7's five-way ladder), method inference × `-G` × `-T` ×
   a body flag (D5), `@`/`<` handling × the flag it appears in (D8), flag arity × an unknown flag ×
   the URL pick (D6), and the tokenizer's operator stop (D3). Each corpus case is
   `{name, command, want: {method, url, headers, bodyMode, …}, warnings: [kind…]}`.
2. **`toCurl`** — `--form-string`-vs-`-F` (F10), the pre-encoded urlencoded string (F13), the
   `-H 'Content-Type:'` suppression (F11), `-L`, and quoting through `shlex.quote`.
3. **The round trip**, which is the strongest single property this phase can assert:
   `parseCurl(toCurl(x))` reproduces `x` for every mode — `none`, `raw`, `code`×4 languages,
   `urlencoded` (including a value with `&`, `=`, `+`, a space and a `%`), `formdata` (text + file +
   a text value starting with `@`), and `file`. It catches an escaping bug and a mapping bug in one
   assertion, in both directions at once.
4. **`tokenize`'s** own three rules (D3), including the unterminated-quote error path.

**Not tested, deliberately**: `shlex` itself (a maintained dependency with its own suite — F8 was
due-diligence for the *choice*, not a regression suite we now own), the flag *table*'s contents
(data, and a wrong entry shows up as a corpus failure), the two dialogs' Vue rendering beyond the
`tests/ui` scenarios in §6.3, and `applySecretValues` (a ten-line reuse of `resolve()`, whose one
interesting property — that a frozen dynamic value is not re-rolled — is asserted as a `tests/ui`
scenario where it can actually be observed).

### D18 — Where the eleven new files live, against the boundary rule
```
frontend/src/http/curl/tokenize.ts     pure   shlex only
frontend/src/http/curl/flags.ts        pure   nothing
frontend/src/http/curl/parse.ts        pure   @shared/domain/http, ./flags, ./tokenize
frontend/src/http/curl/generate.ts     pure   @shared/domain/http, shlex
frontend/src/http/substituteRequest.ts pure   @shared/domain/http, ../http/substitute
frontend/src/http/state/curl.ts        store  bridge/control, ./variables, ../curl/*, state/confirmDialog
frontend/src/http/ImportCurlDialog.vue        theme/primitives, ./state/curl
frontend/src/http/CopyAsCurlDialog.vue        theme/primitives, ./state/curl, clipboard
```
No file imports `views/**` or `project/**`. Both dialogs live in `http/` beside
`VariablesDialog`/`EnvironmentsDialog`/`DynamicValuesDialog` and mount in `App.vue:72-79` — including
the request-scoped one, because P5 D11's precedent is exactly this (`EnvironmentSelect.vue` lives in
`http/` and renders inside the request view's toolbar). The two `views/httprequest/` edits are a
toolbar `IconButton` and a `v-if`; both go the permitted direction.

---

## 5. Implementation order

Nine commits. C1–C4 add capability with nothing mounted (each builds and typechecks on its own);
C5–C6 are one user-visible slice each; C7–C9 are the tests and the docs. Per `AGENTS.md`, run the
fast checks (`lint`, `typecheck`, `build`) per commit and the expensive suites once at the end.
**No Go command is needed at any point** (F1/D2), and **no bindings regeneration** (F16).

### C1 — `feat(http): the curl argv tokenizer`
Root `package.json` gains `"shlex": "3.0.0"` in `dependencies`; `bun install` updates `bun.lock`.
`http/curl/tokenize.ts` (D3). Nothing imports it yet.
**Guards:** `bun run typecheck` (shlex ships its own `.d.ts`, so a missing-types failure would show
here), `bun run build`, `bunx biome check`. Record the built bundle's total size before and after —
F8 predicts ≈2.3 KB minified and no new chunk; a materially different number means something else
got pulled in.

### C2 — `feat(http): parse a curl command into request state`
`http/curl/flags.ts` (D6) and `http/curl/parse.ts` (D4/D5/D7/D8/D9). Pure; nothing mounted.
**Guard:** typecheck/build/lint. `HTTP_BODY_MODES` and `CODE_LANGUAGES` are imported, not restated —
a mode name typo is a compile error.

### C3 — `feat(http): generate a curl command from a resolved request`
`http/curl/generate.ts` (D13/D14/D15/D16). Pure; nothing mounted.

### C4 — `refactor(http): the wire-body substitution walk moves into http/`
`http/substituteRequest.ts` gains `substituteBody` (moved verbatim from
`views/httprequest/state.ts:63-87`) and `applySecretValues` (D11); `state.ts` imports the first and
loses its private copy.
**Guard, and this is the real proof rather than a formality:** `tests/ui/http-request.spec.ts`,
`http-request-body.spec.ts`, `http-variables.spec.ts` and `http-dynamic-values.spec.ts` **pass
unedited**. A move that needed a spec edit was not a move.

### C5 — `feat(http): Import from curl`
`http/state/curl.ts`'s import half, `http/ImportCurlDialog.vue`, `App.vue` mount,
`http/menus.ts` + `CollectionsPanel.vue` (menu item, action, `http.importCurl` command),
`HttpStart.vue`'s third button, one `shortcuts/state.ts` palette entry, and
`BinaryBodyPicker.vue`'s `v-if` (F15).
**Guard:** the two existing specs that click `new-request-start` (P4 F11) still pass — the primary
button's testid is untouched.

### C6 — `feat(http): Copy as curl, with secret values behind the existing reveal gate`
`http/state/curl.ts`'s generate half (the frozen resolution, the reveal loop, `applySecretValues`,
the clipboard write), `http/CopyAsCurlDialog.vue`, `App.vue` mount,
`HttpRequestView.vue`'s toolbar `IconButton` + `registerCommand('http.copyAsCurl', …)`, one palette
entry. D10 in full.
**Guard:** `http-variables.spec.ts` passes unedited — the reveal loop calls the *existing*
`revealVariable`, and the only change to `http/state/variables.ts` is the optional error-sink
argument its own comment describes.

### C7 — `test: the curl corpus, both directions, and the reveal gate`
`tests/unit/curl-cases.json` + `tests/unit/http-curl.spec.ts` (D17), and
`tests/ui/http-curl.spec.ts` (§6.3).

### C8 — `docs(architecture): curl parse and generate`
`docs/ARCHITECTURE.md`: one UI-architecture sub-section (the two directions, where they live, why
neither is Go — the sibling of the existing *"Go is untouched by P6"* paragraph), and one paragraph
in the secrets section stating D10's general rule for every surface that renders a substituted
secret.

### C9 — `docs(plan): fill in P7's acceptance checklist`
§7 below, filled in by the implementing agent with what actually ran, including anything §6.4 could
only be checked on real hardware.

---

## 6. Verification and acceptance

### 6.1 Fast checks, every commit
`bunx biome check .` · `bun run typecheck` (all three projects) · `bun run build`.
**No `go build`, no `go vet`, no `go test`, no `wails3 task common:generate:bindings`** — F1/F16
mean there is nothing on the Go side to build or regenerate, and a session that finds itself
regenerating bindings has changed something this plan says it should not have.

### 6.2 `bun run test:unit` — the corpus (D17)
`tests/unit/http-curl.spec.ts`, three `describe`s over `curl-cases.json`:

- **tokenize** — the `curl` prefix (present, absent, `/usr/bin/curl`), a `\`-continuation, an empty
  `-d ''`, `$'…'`, an unterminated quote (error, not throw), and the operator stop (`; rm -rf /`
  yields the URL plus a `shell-operator` warning and no `rm`).
- **parseCurl** — at minimum: a DevTools-shaped paste; `-d` JSON with no `Content-Type`
  (→ `raw` + an added urlencoded header + `implied-content-type`); the same with
  `-H 'content-type: application/json'` (→ `code`/json); `-d 'a=1' -d 'b=2'` (→ `urlencoded`, two
  rows, in order); `--json`; `-F` text + file + `;type=`; `-F 'k=<f'` (dropped + warning);
  `--data-binary @path` (→ `file`); `-d @path` (dropped + warning); `-T path` (→ PUT + `file`);
  `-G -d` (→ GET, query text, no body); `-u`, `--oauth2-bearer`, `-A`, `-e`, `-b`; `-I`;
  `-X PROPFIND` (→ GET + `method-coerced`); `-k` (→ `unsupported-flag`); `--frobnicate`
  (→ `unknown-flag`, and **the URL is still right** — F6's failure, asserted against);
  two URLs; no URL; `-H 'X-Empty;'`; a header with no colon.
- **toCurl and the round trip** — D17 item 3, over every mode, plus the specific escapes: a body
  containing `'`, a header value containing a space and a `"`, a form text value starting with `@`,
  a urlencoded value containing `&`/`=`/`+`/`%`/a space, and a `{{token}}` left unresolved.

### 6.3 `bun run test:ui` — `tests/ui/http-curl.spec.ts`
Six scenarios, all against the real built bundle, none needing a `mockRuntime.ts` change (F16):

1. **Import populates a new tab.** Open the dialog from the collections background menu, paste a
   POST with two headers and a JSON body, assert the live summary and zero warnings, press Import,
   and assert a **second** tab exists with the first one's contents intact (D12/F14) — method chip,
   URL field, both header rows, `Body (code)` badge, and the body text.
2. **Warnings are shown before Import.** Paste a command with `-k` and `-X PROPFIND`; assert two
   `<li>`s with `data-kind="unsupported-flag"` and `"method-coerced"`, and that after importing the
   method is GET.
3. **A parse error disables Import.** Paste an unterminated quote; assert the message and the
   disabled button.
4. **Copy as curl, no secrets.** A request with one plain `{{host}}` variable: open the dialog,
   assert the command contains the *resolved* host and no `{{`, assert `control.log()` has **zero**
   `IPC.variablesReveal` entries and **zero** `IPC.httpSend` entries, and that no `tabsSave` payload
   contains the command string.
5. **Copy as curl, with a secret — the gate.** A request whose header is `Bearer {{apiKey}}` where
   `apiKey` is secret. On open: the command shows `{{apiKey}}` literally, the note strip says one
   value is hidden, and the reveal count is **0**. Press *Show secret values* with a mocked
   `revealed` outcome: the command now shows the plaintext, the strip is `warn`, and the reveal
   count is **exactly 1** (`http-variables.spec.ts:150`/`:165`'s own technique). Then assert the
   **negative**: nothing written to `tabsSave` and no `httpSend` carries the plaintext.
   A second scenario with a `cancelled` outcome asserts the reference stays literal, the strip names
   it, and nothing throws.
6. **A dynamic value is frozen across the reveal.** A request containing two `{{$guid}}` references
   and one secret. Capture the two UUIDs from the masked command; reveal; assert **the same two
   UUIDs** are still in the revealed command (D11's whole reason to exist), and that they differ
   from each other (P6 D3's per-occurrence rule).

### 6.4 Real hardware only
- **The actual OS authentication prompt.** `tests/ui` mocks the outcome, as
  `credential-reveal.spec.ts` and `http-variables.spec.ts` already do; that a real Touch ID sheet
  appears once and its 5-minute grace then covers a second *Copy as curl* is a macOS check
  (`AGENTS.md`: there is no Linux keychain backend at all, so a Linux run needs
  `KIRA_INSECURE_SECRETS=1` and takes the `confirmation-required` path instead).
- **The clipboard.** `navigator.clipboard.writeText` needs a focused, secure context; the `tests/ui`
  assertions are made against the store's own state, not by reading the system clipboard back.
  Pasting a generated command into a real terminal and getting the same response the app got is the
  end-to-end proof, and it is a human step.
- **Round-tripping a real browser's *Copy as cURL*.** Copy a request from Chrome and Firefox
  DevTools and from Safari, paste each into the import dialog, and record what the warnings said.
  This is the input class the whole parse side exists for and no fixture fully substitutes for it.
  §7 has a line for it.

### 6.5 What must not regress
- **`send()` behaves identically.** C4 moves one private function; `resolveTabState`, the
  `dynamic`-ref short-circuit (P6 D7) and the wire args are untouched. The four existing Http
  `tests/ui` specs passing **unedited** is the guard.
- **`op_log.command` never contains a resolved secret.** P5 F3/D6's ordering in `bridge/http.go`
  is not touched by this phase at all, and generation never reaches Go (D2/F2).
- **Studio mode renders identically.** Nothing outside `http/`, `views/httprequest/`,
  `shortcuts/state.ts` (two entries) and `App.vue` (two mounts) is touched.
- **No new bound method, no new op kind, no new tab kind, no new IPC channel, no bindings
  regeneration, no migration** (F16).
- **The bundle gains ≈2.3 KB and no chunk** (F8). `docs/ARCHITECTURE.md:697`'s "the bundle's two dynamic chunks" property must still hold — `shlex` is a static import, and the faker chunk P6 added is
  still the only lazily-loaded thing on this path.

---

## 6.6 Deviations from this plan, recorded honestly

- **§0.1's file table did not list `http/CollectionsTree.vue`, but C5 had to touch it.**
  `menus.ts`'s `backgroundMenu()` gains its *Import from curl…* item exactly as planned, but the
  concrete `CollectionMenuActions` object satisfying that interface is `CollectionsTree.vue`'s own
  `actions` const (`menus.ts`'s own comment: *"the actions themselves are injected… CollectionsTree.vue
  is the one place that knows how to perform any of it"*) — the object literal would not typecheck
  against the widened interface without an `importCurl` member there too. One line
  (`importCurl: () => openImportCurlDialog()`) plus its import. Not a scope change, just a knock-on
  edit the file table missed.
- **The bundle grew more than F8's own "≈2.3 KB" figure** — see the checklist item below; that
  number was always scoped to `shlex` alone (confirmed in C1), not the whole phase's payload.

## 7. Final checklist

*Filled in by the implementing agent (C9) with what actually ran, in this sandbox, on
`claude/feature-v1-2` after C1–C8 landed.*

- [x] `bunx biome check .` clean — 458 files checked, no fixes needed after formatting fixes were
      applied and committed along the way.
- [x] `bun run typecheck` clean (tests, web, unit) — `tsgo`/`vue-tsc` all pass with zero errors.
- [x] `bun run build` clean; bundle delta recorded, **no new chunk**. Measured (production build,
      minified, `dist/assets/index-*.js`, the one chunk this phase's static `shlex` import lands
      in): **1,395.58 KB → 1,416.16 KB minified (+20.6 KB), 424.20 KB → 430.95 KB gzip (+6.75 KB)**.
      The three existing chunks (`fakerEntry`, `generators`, `sqlFormatterEntry`) are unchanged in
      count and size — nothing this phase added is dynamically imported. The +20.6 KB is *every*
      new module together (shlex ≈2.3 KB per F8's own isolated measurement, plus `tokenize.ts`,
      `flags.ts`, `parse.ts`, `generate.ts`, `substituteRequest.ts`, `state/curl.ts`, both dialog
      components' compiled render functions, and the small edits to five already-bundled files) —
      not a regression against F8's own number, which was scoped to the library alone. Recorded
      honestly as a deviation from a literal reading of "the bundle gains ≈2.3 KB" (§6.5): that
      sentence is about `shlex` specifically (confirmed unused/zero-delta in C1, before anything
      imported it), not the whole phase's payload, which was never going to be that small once six
      new pure modules and two dialogs actually mount.
- [x] `bun run test:unit` — the corpus passes: 61/61 in `http-curl.spec.ts` (30 parse cases, 8
      tokenize cases, 10 `toCurl` cases, the round trip over all six modes — `none`, `raw`,
      `code`×4 languages, `urlencoded`, `formdata`, `file`). Full `tests/unit` run: 335/335 across
      38 files.
- [x] `bun run test:ui` — `http-curl.spec.ts`'s six scenarios (seven tests — the gated reveal has
      its own cancelled-outcome case) all pass against the real built bundle.
- [x] `http-request.spec.ts`, `http-request-body.spec.ts`, `http-variables.spec.ts`,
      `http-dynamic-values.spec.ts`, `collections.spec.ts`, `mode-switch.spec.ts` pass **unedited**
      — confirmed individually after C4/C5/C6 and again in the full `tests/ui` run below.
- [x] Full `tests/ui` suite (all 35 spec files, 126 tests): 125 passed, 1 failed
      (`budgets.spec.ts`'s scroll-latency tripwire, p50 measured 13ms against a 12ms budget) —
      re-run alone it passed cleanly (p50 8ms); the test's own comment names exactly this cause
      ("cross-file worker contention, which no in-file serialization mode addresses"). Unrelated to
      this phase — no P7 file is anywhere near that test's own path — and not re-run again to
      chase a timing flake.
- [x] `go build ./apps/kira-studio/internal/...` and `go test ./apps/kira-studio/internal/...`
      still pass (every package `ok` or `[no test files]`), and `git diff --stat` from the base
      commit shows **no Go file changed** (`internal/`, `packages/shared/` both empty diffs).
- [x] No `apps/kira-studio/frontend/bindings/**` change (empty diff from the base commit;
      `wails3 task common:generate:bindings` was never re-run after the initial `bun run setup`).
- [ ] Real hardware: one Touch ID prompt covers a whole *Copy as curl*, and a second within the
      grace window does not re-prompt. **Not run** — this sandbox has no display and no biometry;
      `tests/ui` mocks the reveal outcome instead, per §6.4's own scope.
- [ ] Real hardware: a generated command pasted into a terminal returns the same status/body the
      app showed, for at least `code`/json, `urlencoded`, `formdata` (text + file) and `file`
      modes. **Not run** — needs a real terminal and a real network round trip; §6.4 names this a
      human step.
- [ ] Real hardware: Chrome, Firefox and Safari *Copy as cURL* output each imports; warnings
      recorded. **Not run** — needs the three real browsers' own DevTools; §6.4 names this a human
      step and the input class the whole parse side exists for, so it is not a formality to skip
      lightly, only genuinely out of reach in this environment.
- [x] `docs/ARCHITECTURE.md` updated (C8) — one UI-architecture sub-section (the sibling of P6's
      own "Go is untouched by P6" paragraph) and one paragraph in the secrets section stating D10's
      general reveal rule.

---

## 8. Open questions, handed forward

**OQ-1 — `HTTP_METHODS` is still seven, and `curl -X PROPFIND` is now a measured real input.** P4 §8
OQ-3 flagged this and named P7's curl parser as the phase that would want it; D9 declines it here
and coerces to GET with a warning, exactly as P4's own importer does, so the two behave identically
rather than diverging. What is still owed is the same short list P4 named: an editable combo box in
place of `HttpRequestView.vue`'s `<select>`, a widened enum, and a default colour family for
`httpMethodClass`'s four. That is a request-toolbar change, which makes **P13** (the Api-module UI
pass) the natural home — it is already restyling that toolbar. Re-handed there with the note that
two importers now depend on the answer, not one.

**OQ-2 — A hand-built multipart body imports as `raw`, and that is the right call until it isn't.**
D7 item 5: a browser's *Copy as cURL* emits a form post as `--data-binary` with the boundary strings
inline, and P7 keeps the bytes and the header rather than re-parsing them into `formData` rows.
The cost is that such an import cannot be *edited* field-by-field, only re-sent. The fix, if someone
wants it, is a MIME multipart reader over a stated boundary — real work with a real failure mode
(a re-serialized body will not be byte-identical, and a file part's contents cannot become a path),
so it needs its own decision rather than being smuggled in. `docs/v1.2/SPEC.md`'s P9 row (the raw
request editor) is arguably where a user gets the ability to work with such a body directly.

**OQ-3 — *Copy as curl* is request-tab-scoped only.** The SPEC row says *"from the current
request's state"*, and D10's whole design turns on a live tab's resolved request, its collection and
the active environment. A collections-tree row also has all three (the row knows its collection, the
environment is app-global) and *Copy URL* already sits in that menu — so a row-level *Copy as
curl…* is a small addition that was left out to keep one surface rather than two while the reveal
rule was being settled. Worth adding once D10's flow has been used in anger; it should open the same
dialog, not a second code path.

**OQ-4 — An imported credential is stored in plaintext tab state, and the app knows better.** F4/D9:
`curl -u …` lands in `tabs.state_json` unencrypted, exactly as a typed `Authorization` header does
today, and P7 only warns. The genuinely good version is *"turn this into a secret variable"* — one
click that creates a secret in the request's collection and rewrites the header to `{{name}}`. It
was declined here because it needs a collection a scratch tab may not have, a name the user has not
chosen, and it means the importer rewriting the command it was handed. It should be built with, or
just after, the **auth phase** (P4 §8 OQ-2, still open), since that phase has to decide where a
credential lives anyway and will want the same affordance for an imported Postman `auth` block.

**OQ-5 — One target language, curl.** Postman's *Code* panel emits ~20 languages from the same
resolved request, and `toCurl`'s input (`CurlRequest`) is language-neutral — a second generator
would be a sibling file and a `<select>`, with no change to the resolution or the reveal flow. Not
built: the SPEC row asks for curl, and every extra target is another escaping dialect to get right
and test. Recorded because the seam is now shaped for it.

**OQ-6 — Pasting a curl command into the URL field does nothing special.** Postman and Bruno both
detect it and convert in place; D12 declined it because in-place conversion silently replaces the
request the user is editing, which is the exact thing the new-tab rule exists to avoid. A middle
option exists and is cheap: detect a paste beginning with `curl ` in the URL `TextField` and *open
the import dialog pre-filled* rather than converting. It needs a `@paste` handler on a shared
primitive, which is `theme/primitives/` territory this phase declined to enter (§3). Worth doing in
P13 if discoverability turns out to be the complaint.

**OQ-7 — P5 OQ-10 and P6 OQ-8's remaining half is now unblocked, and still unbuilt.** D10 settles the
*secret* question those two were stuck on — masked by default, revealed through the existing gate,
never persisted — for every surface, not just this one. What is still not built is the surface
itself: a hover or inline preview of the request's *resolved* form beside the URL field. P6 OQ-8
adds the second obstacle, which D10 does **not** resolve: an honest preview of `{{$guid}}` must
either show a value the next send will not use, or say *"a fresh value will be generated here"*.
This phase's answer for its own dialog is that the values shown **are** the values in the command
(they are frozen into it), which a live preview cannot say. So the preview needs that copy decision
made, not the secret decision — a smaller, purely-UI question, and P13's.

---

### Critical files for implementation

- `/home/user/kira-studio/apps/kira-studio/frontend/src/http/curl/parse.ts` *(new — D5–D9's flag walk, where every measured library failure in F6 would be repeated if the URL pick and the flag arity are not kept in step)*
- `/home/user/kira-studio/apps/kira-studio/frontend/src/http/curl/generate.ts` *(new — D15's table; `--form-string` (F10), the pre-encoded urlencoded string (F13) and `-H 'Content-Type:'` (F11) are the three rows that were measured rather than assumed)*
- `/home/user/kira-studio/apps/kira-studio/frontend/src/http/state/curl.ts` *(new — D10's flow: masked first, one gated reveal, nothing persisted; the one file where getting the order wrong turns the mask into theatre)*
- `/home/user/kira-studio/apps/kira-studio/frontend/src/http/substituteRequest.ts` *(new — D11's `applySecretValues`; a second full `resolveTabState` here instead would silently re-roll every `{{$…}}` in a command the user is already looking at)*
- `/home/user/kira-studio/apps/kira-studio/frontend/src/http/state/variables.ts` *(read and called, barely changed — `revealVariable` at `:207` and `cachedVariables` at `:151` are the whole reveal integration)*
- `/home/user/kira-studio/apps/kira-studio/frontend/src/views/httprequest/state.ts` *(the `substituteBody` move, and the frozen resolution `send()` already demonstrates at `:186-`)*
- `/home/user/kira-studio/apps/kira-studio/internal/bridge/http.go` *(read, and deliberately not changed — `:68`/`:88`'s unresolved-URL `SetCommand` is the ordering F2 says a Go generator would put at risk)*
- `/home/user/kira-studio/apps/kira-studio/internal/httpclient/body.go` *(read, not changed — `:43` and `:138-150` are the two tables D15's generation has to match byte-for-byte)*
