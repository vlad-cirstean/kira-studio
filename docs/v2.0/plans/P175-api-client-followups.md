# P175: Studio API client follow-ups

Source: `SPEC.md` row P175. Origin: P168 Part 10 F24, Part 6 F12, Part 7 F15, plus the renderer
halves of Part 6 F13, Part 7 F17 and Part 7 F18. Stream C. One sequential implementer.

Every decision below was approved by the user before planning. This plan records the design, not
a choice still open.

## Current behavior (read from source at `386733d`)

### F24: three hand-rolled server-state caches

- **Cookies** (`frontend/src/views/httprequest/cookies.ts`): Pinia store `useCookiesStore`, per-tab
  `{cookies, loading, actionError, url}`, `fetchSeq` supersession, `supersede()`, tab-closed
  guards. Fed by `HttpRequestView.vue:398-433` (`useDebounceFn` 300 ms over `resolvedCookiesUrl`,
  plus `onSendCompleted` from `httprequest/state.ts:130-141`). Read by `CookiesPane.vue` and the
  Cookies segment badge (`HttpRequestView.vue:327-329`). Error from a list fetch is swallowed to `[]`
  (any code).
- **Response history** (`frontend/src/api/state/history.ts`, `createHistoryStore`): per-tab
  `{entries, loading, stale, viewing, error}`, three counters (`latestSeq`, `staleSeq`, `viewSeq`),
  retry-on-stale. Wrapped by `views/httprequest/history.ts` (adds `selected`) and
  `views/grpcrequest/history.ts`. P8 D11 (`docs/v1.2/plans/P8-response-history.md:755`): one
  fetch on the response pane's mount, then after a send refetch only when the History pane is
  showing, else mark stale and fetch when it next shows. Readers: HTTP `ResponsePane.vue`,
  `ResponseHistoryList.vue`, `RawExchangePane.vue`, `TimelinePane.vue`; gRPC `ResponsePane.vue`,
  `CallHistoryList.vue`. Writers: `httprequest/state.ts:215` (`noteSendRecorded`),
  `grpcrequest/state.ts:197,371` (`noteGrpcCallRecorded`). Both response panes also reset
  `entries = null` on an `itemId` change (Save as adopt). Go scope key
  (`repos/history.go:165-167`): `itemId`, else `tab:<tabId>`.
- **gRPC schema** (`views/grpcrequest/state.ts:123-263`): `schemaRuntime[tabId] = {status, schema,
  error, genId}`, `loadSchema(tabId, reload)`. Fed by `GrpcRequestView.vue:123-137`
  (`useDebounceFn` 150 ms over `descriptorMode`/`target`/`protoPath`), Reload in
  `SchemaBrowser.vue:73`. Read by `GrpcRequestView.vue:64-67,92,106`, `SchemaBrowser.vue`, and
  `call()` (`state.ts:291`). Go caches descriptors itself (`grpcclient/descriptors.go`
  `cacheKey`): proto mode keys on `protoPath`+`importPaths`; reflection keys on resolved `target`,
  TLS fields and metadata **names** only.

### F12: cookie Remove

`httpclient/cookies.go` wraps stdlib `net/http/cookiejar`. `JarCookies` returns name/value only
(stdlib exposes nothing else). `DeleteJarCookie(rawURL, name)` expires `name` under every candidate
domain and path (landed in `b06ab01`), so two same-name cookies matching one URL are removed
together. `bridge/http.go:201-223` `HttpCookieDeleteArgs{URL, Name}`. `CookiesPane.vue:66-69`
`onRemove(name)`, `cookies.ts:89-101` `deleteCookie(tabId, url, name)`,
`bridge/apiControl.ts:104-105` `httpDeleteCookie(url, name)`.

### F15: dotenv bulk editor

`packages/api-core/src/http/dotenv.ts`. `needsQuoting` already quotes a value starting with `'`
(landed), so a stored `'%Y-%m-%d'` round-trips. Still open:

- No inline comments: `KEY=abc # prod key` stores `abc # prod key`.
- A quoted value must end the line exactly: `K="a" # note` is a parse error.
- A line whose value starts with `'` or `"` without a matching close (`K='abc`, typed or pasted)
  is a parse error, so the whole editor cannot Apply.

### F13 renderer half

`api/state/apiQueries.ts:67-94`: both saved-request `queryFn`s `catch { return null }`. A transient
`E_INTERNAL` caches as "deleted" (`null`, orphan) under `staleTime: Infinity`. Go returns
`E_NOT_FOUND` for a missing item now. Imperative callers: `CollectionsTree.vue:58-77` `onOpen`
(relies on "never throws"), `collections.ts:511,520` `duplicateRow` (already in `try/catch`).

### F17

`api/state/raw.ts:81-87` `applyEditRaw` patches `result.state` wholesale. `generate.ts:61-63` emits
only enabled, named header rows; `parse.ts:148` gives every row `description: ''`. A no-edit Apply
deletes disabled and blank-name rows and blanks every description.

### F18 renderer half

`requestFieldsElided` (`shared/domain/response-history.ts:49`) and `metadataElided`
(`grpc-history.ts:52`) arrive (Go half `a083091`) with no reader. Existing notes to sit beside:
HTTP `ResponsePane.vue:387` (`http-history-truncated`), `RawExchangePane.vue:230`
(`http-history-request-truncated`), gRPC `ResponsePane.vue:369-371` (`requestMessageTruncated`).

## Decisions

### D1 (F12): fork stdlib `net/http/cookiejar`; no third-party jar fits

Requirement: list every jar entry with its effective domain, path and attributes, and delete one
entry by its exact `domain;path;name` id, with current stdlib RFC 6265 behaviour (SameSite,
`Quoted`, IP-host and public-suffix rules as of Go 1.27).

Libraries checked (module proxy, source read):

- `github.com/juju/persistent-cookiejar` (BSD-3-Clause, Go Authors' license): has `AllCookies()`
  and `RemoveCookie()`. One tag, `v1.0.0`, 2017; no `go.mod`; forked from the 2016 stdlib jar, so
  no SameSite or `Quoted` in its entries and none of the stdlib fixes since. Pulls
  `gopkg.in/errgo.v1`, `gopkg.in/retry.v1` and file locking for a persistence feature this app
  must not use (the jar is in-memory by design, P90 item 1). Not maintained.
- `github.com/orirawlings/persistent-cookiejar` (same license, fork of the above): last tag
  `v0.3.2`, 2022; still no SameSite; 17 transitive modules incl. `gopkg.in/mgo.v2`. Not maintained.
- `net/http/cookiejar`: no listing, no delete.

Decision: copy Go 1.27.1's `net/http/cookiejar` (`jar.go`, `punycode.go`, BSD-3-Clause, same
license as the toolchain) into `apps/kira-studio/internal/httpclient/cookiejar/`, unmodified except
the one `net/http/internal/ascii` import, which becomes a local `ascii.go` copied from
`net/http/internal/ascii/print.go` (`EqualFold`, `ToLower`, `Is`, plus whatever those call). Keep the
Go `LICENSE` beside it. All additions live in a separate `entries.go`, so a later resync is a file
copy plus a diff of one import. Upstream's own `jar_test.go`, `punycode_test.go` and
`dummy_publicsuffix_test.go` come along verbatim: they are what keeps the fork honest.

Additions (`entries.go`):

- `type Entry struct { Name, Value, Domain, Path, SameSite string; Secure, HttpOnly, HostOnly,
  Persistent bool; Expires time.Time }`.
- `func (j *Jar) Entries(u *url.URL) []Entry`: same selection and order as `cookies(u, now)`
  (scheme check, `shouldSend`, expiry skip, sort), read-only: never updates `LastAccess`, never
  deletes expired entries.
- `func (j *Jar) Delete(domain, path, name string) bool`: `key := jarKey(domain, j.psList)`,
  removes `entries[key][domain+";"+path+";"+name]`, drops the submap when empty. Under `j.mu`.
  `domain` is the entry's own `Domain` as `Entries` reported it, so the id is exact by
  construction. Returns whether an entry was removed.

No `HostOnly` on the wire: a host-only entry's `Domain` is its host, which is its real id domain.
Display stays `Domain=<host>`; not a goal of this phase.

### D2 (F12): delete by exact id end to end

- `httpclient.JarCookies(rawURL)` returns `Entries(u)` mapped to `Cookie` with every attribute:
  `Expires` (RFC3339 when `Persistent`, else `""`), `SameSite` (`"SameSite=Strict"` → `"strict"`,
  `Lax` → `"lax"`, `None` → `"none"`, default → `""`). The P90 "request mode has no
  domain/path" limitation ends.
- `httpclient.DeleteJarCookie(domain, path, name string)` calls `currentJar().Delete`. Delete
  `cookieDomainCandidates`, `cookiePathCandidates` and the `idna` import.
- `bridge/http.go`: `HttpCookieDeleteArgs{URL, Name, Domain, Path}`. `DeleteCookie` refuses an
  empty `Name`, `Domain` or `Path` with `ipcerr.BadRequest`, deletes, returns `Cookies(URL)`. A
  miss (already gone) is not an error; the returned list is the truth.
- Renderer passes `c.domain` and `c.path` (`CookiesPane.vue` → cookies module →
  `apiControl.httpDeleteCookie(url, {name, domain, path})`).

### D3 (F15): dotenv rules

Adopted from the common dotenv implementations (python-dotenv, Docker Compose, dotenvy; shell
semantics). One rule set, parse side only; `serializeEnv` already quotes every value these rules
could misread (any `#`, leading `'`, `"`, edge whitespace).

1. **Unquoted value**: text after `=`; an inline comment starts at a `#` preceded by whitespace and
   runs to end of line; the result is trimmed. `K=abc # note` → `abc`. `K=abc#def` → `abc#def`
   (URL fragments survive; motdotla/dotenv's "any `#`" rule would cut them, so not adopted).
   `K=#abc` → `#abc`.
2. **Quoted value**: a value starting with `'` or `"` is quoted only if a closing quote exists on
   the same line and is followed by nothing, or by whitespace then an optional `# comment`.
   Single quotes are literal; double quotes keep today's escapes (`\n`, `\t`, `\\`, `\"`, lenient
   others). `K="a b" # note` → `a b`.
3. **Unmatched or trailing-junk quote**: anything else starting with a quote is an unquoted value
   under rule 1. `K='abc` → `'abc`; `K='a'b` → `'a'b`. Never a parse error, so the editor stays
   appliable.
4. `hasValue: false` only when the value is empty and unquoted after comment removal (`K=` and
   `K= # note`). `K=""` and `K=''` stay `hasValue: true`.
5. Quoted values stay single-line (multi-line expressed as `\n` inside `"`). Cross-line quotes,
   backtick quotes and `${VAR}` expansion are not adopted: a cross-line search would let one stray
   `'` swallow every following line, contradicting rule 3, and expansion would rewrite `{{name}}`-
   adjacent text the API client resolves itself.

Parse errors remaining: a line with no `=`, and an empty key. No library: `dotenv`/`dotenv-*` npm
`parse` returns a key→value object, which drops order, duplicate keys, comment-as-description,
the secret marker, `hasValue` and line-numbered errors, all of which `reconcileEnv` (P17 D22)
needs.

### D4 (F24): TanStack Query for the three caches

Shared shape: `staleTime: Infinity` (nothing changes on a timer), invalidation from the event that
changes the data, `refreshApiQuery` (`apiQueries.ts`) as the invalidation helper wherever a fetch
may already be in flight when the change lands (its double-invalidate is the F2/F8 race fix the
hand-rolled `staleSeq` retry did), and `enabled` carrying P8 D11's lazy-when-hidden rule. All
removed: `fetchSeq`, `supersede`, `latestSeq`, `staleSeq`, `viewSeq`, `genId`, every `loading`/
`error`/`stale` field, `onSendCompleted`.

**Cookies** — new `views/httprequest/cookies.ts` (replaces the Pinia store; no Pinia left, it held
no client state):

- Key `['httpJarCookies', url]`. `queryFn`: `control.httpCookies(url)`; an `E_BAD_REQUEST`
  (unparseable or still-templated URL) returns `[]`, every other code throws and shows in the pane.
- `useJarCookies(url: MaybeRefOrGetter<string>, enabled: MaybeRefOrGetter<boolean>)`.
  `HttpRequestView.vue` calls it once: `url` = `refDebounced(resolvedCookiesUrl, 300)` (VueUse),
  `enabled` = jar on and url non-empty. The badge and `CookiesPane` (now taking the query result
  as props, so the debounced key is computed once) read it. Lazy rule: a hidden tab is unmounted,
  so it has no observer and does not refetch until it mounts again; the jar-off pane never fetches.
- `invalidateJarCookies()`: `refreshApiQuery` over every cached `['httpJarCookies', *]` key.
  Called by `httprequest/state.ts` after a send succeeds (the jar is process-wide: a send to one
  host can change another URL's list).
- `deleteJarCookie(url, cookie)` and `clearJarCookies()`: `useMutation` in `CookiesPane.vue`
  (its `error` replaces `actionError`). Delete: `await queryClient.cancelQueries({queryKey:
  ['httpJarCookies']})` first (an in-flight list must not land after and resurrect the cookie, the
  old `supersede` job), then `setQueryData(key(url), returned list)` and `invalidateJarCookies()`
  for the other URLs. Clear: cancel, then `setQueriesData({queryKey: ['httpJarCookies']}, [])`
  (the jar is empty, so `[]` is exact for every URL). Clear keeps its confirm dialog.

**Response history** — rewrite `api/state/history.ts` from `createHistoryStore` into
`createHistoryQueries(opts)` returning keys, options and helpers; the two Pinia stores keep only
UI state:

- List key `[domain, itemId, scratchTabId]`, `domain` = `'httpHistory' | 'grpcHistory'`,
  `scratchTabId` = `''` when `itemId` is set (mirrors Go's scope key, so two tabs on one saved
  request share one list, and a send in one refreshes the other's visible pane).
- Snapshot key `[domain + 'Snapshot', id]`, `staleTime: Infinity` (an entry never changes).
- `useHistoryList(tab)`: `enabled` = `tab.state.responsePane === 'history'`. A disabled observer
  still reads the cached list (the segment count), but is not `active`, so invalidation only
  marks it stale; turning the pane on refetches once. This is D11 exactly.
- Response pane mount and `itemId` change: `watch(listKey, () => queryClient.prefetchQuery(
  listOptions), {immediate: true})` — D11's one initial fetch, and the adopt refetch that the
  `entries = null` hack did (a new key is a new query).
- `noteRecorded(tabId)`: clear the tab's viewing id, then `refreshApiQuery(listKey)` (refetches
  only an active, i.e. visible, observer; the in-flight case gets its second invalidate).
- `remove`/`clear`: plain async actions; after success clear viewing if it pointed at a removed
  id, `removeQueries` its snapshot key, `refreshApiQuery(listKey)`. Failure goes to a per-tab
  `actionError` in the UI store (not server state; same role as before).
- Tab close (`registerTabRuntimeCleanup`): `removeQueries` the scratch-scope list key (`tab:` scope
  dies with the tab); item-scope lists are left to `gcTime`.
- UI stores: `useHttpHistoryStore` keeps per-tab `{viewingId, selected, actionError}` and actions
  `view`, `backToLatest`, `noteSendRecorded`, `deleteHistoryEntry`, `clearHistory`,
  `toggleSelected`; `useGrpcCallHistoryStore` the same minus `selected`. One concern each (history
  pane selection), as now.
- `useHttpHistoryViewing(tabId)` / `useGrpcHistoryViewing(tabId)`: snapshot `useQuery`
  (`enabled: !!viewingId`), returning `{id, snapshot} | null` (null until data). Replaces every
  `historyRt.viewing` read. A snapshot error shows where `rt.error` showed.

**gRPC schema** — new `views/grpcrequest/schemaQuery.ts`:

- Key mirrors Go's `cacheKey` so the renderer never refetches what Go would answer from cache:
  proto `['grpcSchema', 'proto', protoPath, importPaths.join('\0')]`; reflection `['grpcSchema',
  'reflection', target, tlsEnabled, caFile, serverName, enabledMetadataNames.join('\0'),
  collectionId, environmentId]` (`target` is the raw template, so the owner ids join the key; never
  a resolved value, so no secret enters the cache key).
- `queryFn` takes the source snapshot (tab-independent): reflection resolves `target` and
  metadata through `loadVariableRows` + `mergeVariableRows` + `resolveGrpcTabState` (dynamic
  generator loaded on demand, as `resolveForDescribe` does), then `control.grpcDescribe({...,
  reload: false})`. Metadata values are read at fetch time, not keyed: Go ignores them on a
  non-reload Describe.
- `useGrpcSchema(tab, collectionId, envId)`, called once in `GrpcRequestView.vue`: key from
  `refDebounced(source, 150)`; `enabled` = source complete (`reflection` needs `target`, `proto`
  needs `protoPath`) — the watch's own early returns. `SchemaBrowser.vue` gets `schema`, `status`,
  `error` and `reload` as props.
- Reload: `queryClient.fetchQuery({queryKey, queryFn: describe(reload: true), staleTime: 0})`,
  which replaces that key's data (Go invalidates its own cache on `reload`).
- `call()`: after `variablesForSend` (which already yields the ids), read
  `queryClient.getQueryData(grpcSchemaKey(source))`. Call stays disabled until `findMethod`
  resolves (P108 F14), now against the query's data.

`apiQueries.ts`'s header comment ("the one module owning every API-client server-state cache")
becomes "collections and variables caches; jar cookies, history and gRPC schema live in
`views/httprequest/cookies.ts`, `api/state/history.ts`, `views/grpcrequest/schemaQuery.ts`". The
schema module must sit under `views/grpcrequest/` because it calls `resolveGrpcTabState`, and
`api/**` may not import `views/**` (biome).

### D5 (F13): `null` only for `E_NOT_FOUND`

Both `queryFn`s: catch, return `null` when `(err as {code?: string}).code === 'E_NOT_FOUND'`, else
rethrow. Retry stays off (app default). A failed query leaves the tab `unresolved` (Save is a no-op,
P108 F4) until the next mount or a `kira:api:dataChanged` refetch — not cached as deleted, which
was the bug. `CollectionsTree.vue` `onOpen` now can throw: move its fetch-and-open into a
collections store action `openRequestRow(row)` with `duplicateRow`'s own `try/catch → state.error`
shape, and fix the "never throw" comment.

### D6 (F17): merge parsed headers back onto the originals

New pure `mergeRawHeaders(original, parsed)` in `packages/api-core/src/http/raw/mergeHeaders.ts`,
exported from the package index. `generate.ts` exports its row predicate (`isRawEmittedHeader(h) =
h.enabled && h.name.trim() !== ''`) and uses it, so both sides share one definition.

1. Each parsed row takes the description of the first unused emitted original with the same
   `name` and `value`.
2. Each non-emitted original (disabled, or blank name) is re-inserted after the result position of
   its nearest preceding original that is in the result (a matched emitted row or an
   already-placed non-emitted row); with none, at the start. Unmatched emitted originals (edited or
   deleted) are not anchors.
3. Parsed rows with no original (typed, or the generated default `Content-Type`) keep their parsed
   position.

A no-edit Apply is the identity on `headers`. `applyEditRaw` reads the tab's current headers
(`findHttpRequestTab(state.tabId)`) and patches `{...result.state, headers: mergeRawHeaders(...)}`.

### D7 (F18): elision notes

`variant="note"` `Alert`s beside the existing storage notes:

- HTTP `ResponsePane.vue`: `requestFieldsElided` → "Request field values were not stored — too
  large for history." `data-testid="http-history-fields-elided"`.
- `RawExchangePane.vue`, in the reconstructed-request block beside
  `http-history-request-truncated`: same text, `data-testid="http-history-request-fields-elided"`.
- gRPC `ResponsePane.vue`, beside the `requestMessageTruncated` note: `metadataElided` →
  "Metadata, headers and trailers were not stored — too large for history."
  `data-testid="grpc-history-metadata-elided"`.

## Steps

One commit per step, hook-clean (no `--no-verify`). Fast checks per commit: `bun run typecheck`,
`bun run lint`, `bun run lint:go` for Go steps, the touched package's unit tests. UI suite runs once
at the end (step 11). Regenerate bindings with `wails3 task common:generate:bindings` after step 2
(untracked output, needed for typecheck/build).

1. **`feat(httpclient): fork net/http/cookiejar with entry listing and exact delete`** (D1).
   Add `internal/httpclient/cookiejar/{jar.go,punycode.go,ascii.go,entries.go,LICENSE,jar_test.go,
   punycode_test.go,dummy_publicsuffix_test.go,entries_test.go}`. Header comment in `jar.go` and
   `ascii.go`: copied from Go 1.27.1, the one import change, resync by file copy. `entries_test.go`:
   two same-name cookies on `/` and `/a` for one host → `Entries` reports both with domain/path;
   `Delete(host, "/a", name)` removes only that one; a `Domain=example.com` cookie seen from
   `sub.example.com` deletes by `example.com`; `Entries` does not touch `LastAccess` (order of a
   later `Cookies` call unchanged). If `lint:go` flags the copied upstream files (not
   `entries.go`), add a `.golangci.yml` `exclusions.rules` entry for
   `internal/httpclient/cookiejar/(jar|punycode|ascii)\.go` with a comment naming them vendored
   stdlib; fix anything it flags in `entries.go`.
2. **`fix(api): cookie Remove deletes the exact domain and path`** (D2). `httpclient/cookies.go`
   (switch import to the fork, `JarCookies`, `DeleteJarCookie`, drop candidates/`idna`, refresh
   the doc comments that describe the old limitation), `cookies_test.go` (replace the two
   candidate tests with: list carries domain/path/attributes; delete of one of two same-name
   cookies leaves the other; delete of a parent-domain cookie by its domain), `bridge/http.go`
   (args, validation), `bridge/apiControl.ts` (`httpDeleteCookie(url, {name, domain, path})`),
   `views/httprequest/cookies.ts` `deleteCookie` and `CookiesPane.vue` `onRemove(c)` pass-through
   (rewritten again in step 6; this keeps the commit hook-clean), `CookiesPane.vue` remove
   `data-testid` → `http-cookies-remove-${c.name}-${c.domain}${c.path}`; stale comment at
   `CookiesPane.vue:43-45`. UI spec in `tests/ui/http-request.spec.ts`: mock `HttpService.Cookies`
   returning `sid` on `/` and `sid` on `/a`; click Remove on `/a`; assert the `DeleteCookie` call
   carried `{name: 'sid', domain, path: '/a'}`, mock returns the remaining list, one row remains.
3. **`fix(api): saved-request queries cache null only for E_NOT_FOUND`** (D5). `apiQueries.ts`,
   `CollectionsTree.vue`, `api/state/collections.ts` (`openRequestRow`).
4. **`fix(api): raw editor Apply keeps disabled header rows and descriptions`** (D6).
   `packages/api-core/src/http/raw/{mergeHeaders.ts,generate.ts}`, `packages/api-core/src/index.ts`,
   `api/state/raw.ts`. Unit test `packages/api-core/test/http-raw-merge-headers.spec.ts` (duplicate
   names and anchoring interact, meets the bar): no-edit identity with disabled rows between and
   around enabled ones and duplicate name+value pairs; an edited value drops that row's description
   but keeps its neighbours' disabled rows in place; a deleted enabled row's trailing disabled row
   anchors to the previous survivor; a new parsed row keeps its position. UI spec in
   `tests/ui/http-raw.spec.ts`: tab with an enabled header carrying a description and a disabled
   header; Edit raw → Apply with no edit → both rows present, disabled row still disabled,
   description intact.
5. **`fix(api): dotenv editor follows dotenv inline-comment and quoting rules`** (D3).
   `packages/api-core/src/http/dotenv.ts` (parse rules, `parseEnv`/`serializeEnv` doc comments),
   `packages/api-core/test/http-dotenv.spec.ts`: replace "an unterminated double-quoted value is a
   parse error" with rule 3 cases; add rule 1 (`# ` stripped, `a#b` kept, `#abc` kept), rule 2
   (comment after a closed quote), rule 4 (`K= # x` is `hasValue: false`), and a round-trip case
   for values `'abc`, `a # b`, `"x`. Check `BulkVariablesEditor.vue` for any help text describing the
   old rules; update it if present.
6. **`refactor(api): jar cookie list moves to TanStack Query`** (D4 cookies).
   `views/httprequest/cookies.ts` (rewrite), `CookiesPane.vue`, `HttpRequestView.vue`,
   `views/httprequest/state.ts` (drop `onSendCompleted`/`noteSendCompleted`, call
   `invalidateJarCookies()`). Delete `tests/unit/http-cookies-store-race.spec.ts` (tests removed
   machinery; the delete-vs-in-flight rule moves to step 8's spec).
7. **`refactor(api): response history list and snapshots move to TanStack Query`** (D4 history).
   `api/state/history.ts` (rewrite), `views/httprequest/history.ts`, `views/grpcrequest/history.ts`,
   HTTP `ResponsePane.vue`, `ResponseHistoryList.vue`, `RawExchangePane.vue`, `TimelinePane.vue`,
   gRPC `ResponsePane.vue`, `CallHistoryList.vue`, `httprequest/state.ts`, `grpcrequest/state.ts`
   (call sites only). Delete `tests/unit/history-runtime-reactivity.spec.ts` and
   `history-view-supersession.spec.ts`. Update `tests/unit/http-send-tab-close-leak.spec.ts` and
   `grpc-stream-terminal-race.spec.ts` where they read the removed runtime (keep what they guard:
   no runtime recreated for a closed tab, one record per call).
8. **`test(api): pin lazy history refresh and cookie delete ordering`**. New
   `tests/unit/api-server-state-refresh.spec.ts` (invalidation with interacting rules, and a race,
   so it meets the bar): (a) a send with the History pane hidden issues zero list calls, showing
   the pane issues exactly one and lists the new entry; (b) a list fetch in flight when a send lands
   with the pane showing ends with the new entry (the `refreshApiQuery` second invalidate);
   (c) a cookie list fetch in flight when Remove succeeds does not resurrect the cookie. Drive an
   observer with `effectScope().run(() => useQuery(...))` (vue-query accepts an effect scope as
   its injection context only via the explicit `queryClient` argument, which every composable here
   passes); read results through `queryClient.getQueryData`, as
   `tests/unit/api-collections-delete-orphans-cache.spec.ts` does.
9. **`refactor(api): gRPC schema moves to TanStack Query keyed by source`** (D4 schema). New
   `views/grpcrequest/schemaQuery.ts`, `views/grpcrequest/state.ts` (drop `schemaRuntime`,
   `loadSchema`, `resolveForDescribe` moves into the query module; `call()` reads the cache),
   `GrpcRequestView.vue`, `SchemaBrowser.vue`. Delete `tests/unit/grpc-schema-supersession.spec.ts`
   (a key change is a new query; nothing left to supersede).
10. **`feat(api): note elided request fields and metadata on history entries`** (D7). HTTP
    `ResponsePane.vue`, `RawExchangePane.vue`, gRPC `ResponsePane.vue`. UI specs: in
    `tests/ui/http-history.spec.ts` a stored snapshot with `requestFieldsElided: true` shows
    `http-history-fields-elided` and, on Raw, `http-history-request-fields-elided`; one without
    shows neither. In `tests/ui/grpc-request.spec.ts` a snapshot with `metadataElided: true` shows
    `grpc-history-metadata-elided`.
11. **Phase-end verification**, fixes as `fix:` commits per root cause: `bun run typecheck`,
    `bun run lint`, `bun run lint:go`, `bun run lint:dead` (knip: the removed exports),
    `go test ./apps/kira-studio/internal/httpclient/... ./apps/kira-studio/internal/bridge/...`,
    `bun run test:unit`, then `bun run test:ui:studio` in full (the migration rewires every
    existing history, cookie, raw and gRPC UI spec, which are the regression net:
    `http-history.spec.ts` P18 D1/D3, `grpc-request.spec.ts` debounce/D1/D3, `http-raw.spec.ts`,
    `http-timeline.spec.ts`, `http-pipes.spec.ts`, `api-ui-consistency.spec.ts`).
12. **`docs: record P175 API client decisions`**. `docs/ARCHITECTURE.md`: extend "Renderer
    server-state cache (TanStack Query, P99/P112)" (line ~1164) with the three new query families,
    their keys and D11-as-`enabled`; one fact on the forked jar (why, where, resync rule); one fact
    on the dotenv rule set (D3). This plan's Result section. `docs/v2.0/SPEC.md` row status is the
    orchestrator's (see Concurrency).

Grep checks before calling it done: `rg "fetchSeq|staleSeq|latestSeq|viewSeq|genId|schemaRuntime|
onSendCompleted|createHistoryStore|cookieDomainCandidates" apps/kira-studio` returns nothing;
`rg "useQuery|useMutation" apps/kira-studio/frontend/src/views/httprequest/cookies.ts
apps/kira-studio/frontend/src/api/state/history.ts
apps/kira-studio/frontend/src/views/grpcrequest/schemaQuery.ts` finds real call sites;
`rg "\.Delete\(|\.Entries\(" apps/kira-studio/internal/httpclient/cookies.go` finds the fork used.

## Tests and the CLAUDE.md bar

- Kept/added: forked jar upstream tests plus `entries_test.go` (RFC 6265 domain/path rules);
  `cookies_test.go` (adapter-adjacent jar behaviour, exact-delete rule); `http-raw-merge-headers`
  (matching with duplicates plus anchoring); dotenv parser cases (several interacting rules);
  `api-server-state-refresh` (invalidation rules and two races).
- No unit test for: F13 (one condition), F18 notes (template `v-if`), query options and key
  builders, the bridge validation (one `if`).
- UI specs per the SPEC acceptance: cookie remove (step 2), raw Apply round trip (step 4), elision
  notes (step 10).
- Deleted: four unit specs whose subject (hand-rolled supersession) no longer exists.

## File ownership

All paths under `apps/kira-studio/` unless they start with `packages/` or `docs/`.

| Path | Step | Change |
|---|---|---|
| `internal/httpclient/cookiejar/*` (new) | 1 | forked jar, tests, LICENSE |
| `.golangci.yml` | 1 | vendored-path exclusion, only if lint flags upstream code |
| `internal/httpclient/cookies.go`, `cookies_test.go` | 2 | exact delete, full listing |
| `internal/bridge/http.go` | 2 | delete args, validation |
| `frontend/src/bridge/apiControl.ts` | 2 | `httpDeleteCookie` signature |
| `frontend/src/views/httprequest/cookies.ts` | 2, 6 | pass-through, then query module |
| `frontend/src/views/httprequest/CookiesPane.vue` | 2, 6 | remove args/testid, query props |
| `frontend/src/views/httprequest/HttpRequestView.vue` | 6 | cookie query, debounce |
| `frontend/src/views/httprequest/state.ts` | 6, 7 | invalidation call sites |
| `frontend/src/api/state/apiQueries.ts` | 3, 6 | F13, header comment |
| `frontend/src/api/CollectionsTree.vue`, `frontend/src/api/state/collections.ts` | 3 | `openRequestRow` |
| `packages/api-core/src/http/raw/mergeHeaders.ts` (new), `generate.ts`, `packages/api-core/src/index.ts` | 4 | header merge |
| `packages/api-core/test/http-raw-merge-headers.spec.ts` (new) | 4 | test |
| `frontend/src/api/state/raw.ts` | 4 | `applyEditRaw` |
| `packages/api-core/src/http/dotenv.ts`, `packages/api-core/test/http-dotenv.spec.ts` | 5 | rules, tests |
| `frontend/src/api/BulkVariablesEditor.vue` | 5 | help text, only if it states old rules |
| `frontend/src/api/state/history.ts` | 7 | query factory |
| `frontend/src/views/httprequest/{history.ts,ResponsePane.vue,ResponseHistoryList.vue,RawExchangePane.vue,TimelinePane.vue}` | 7, 10 | history queries, notes |
| `frontend/src/views/grpcrequest/{history.ts,ResponsePane.vue,CallHistoryList.vue}` | 7, 10 | history queries, note |
| `frontend/src/views/grpcrequest/state.ts` | 7, 9 | call sites, schema removal |
| `frontend/src/views/grpcrequest/schemaQuery.ts` (new), `GrpcRequestView.vue`, `SchemaBrowser.vue` | 9 | schema query |
| `tests/unit/{http-cookies-store-race,history-runtime-reactivity,history-view-supersession,grpc-schema-supersession}.spec.ts` | 6, 7, 9 | delete |
| `tests/unit/{http-send-tab-close-leak,grpc-stream-terminal-race}.spec.ts` | 7 | adapt |
| `tests/unit/api-server-state-refresh.spec.ts` (new) | 8 | test |
| `tests/ui/{http-request,http-raw,http-history,grpc-request}.spec.ts` | 2, 4, 10 | new specs; existing ones only if a renamed testid breaks them |
| `frontend/bindings/**` | 2 | regenerated, untracked |
| `docs/v2.0/plans/P175-api-client-followups.md` | 12 | Result |
| `docs/ARCHITECTURE.md` | 12 | **shared with P174** |
| `docs/v2.0/SPEC.md` | — | **shared with P174**, row status only |

No `go.mod`/`go.sum` change (the fork adds no dependency; `golang.org/x/net` is already direct).
No `packages/shared` change (`HttpCookieWire` already carries every field).

## Concurrency with P174

P174's plan (`/home/user/kira-studio-streamA/docs/v2.0/plans/P174-result-loading.md`, "File
ownership") owns the page wire (`packages/shared/protocol/*`, `internal/page`), adapters,
`adapterhost`, `dbmcp`, `queryplan`, `views/console`, `views/stream`, `views/grid`,
`state/viewCommands.ts`, `views/shared/celleditor/state.ts`, `state/cellSelection.ts`, one new grid
unit spec, `tests/ipc/{sqs,kafka}`.

- Code overlap: none. P175 touches no file in that list, P174 none in the table above.
- `.golangci.yml`: P175 may add one exclusion; P174 does not list it. No overlap.
- Bindings: untracked, and P174 changes no bridge type.
- `tests/ui/*`: P174 adds none and leaves `fixtures.ts` alone; P175 edits four spec files only.
- Ordering dependency: none either way.
- Shared: `docs/ARCHITECTURE.md` (P175 edits only the server-state paragraph and the HTTP/API
  client facts; P174 its adapter/SQS/Kafka/MCP/grid sections) and `docs/v2.0/SPEC.md` (row status).

Verdict: P175 can run concurrently with P174. Use P174's option (a): neither stream edits
`SPEC.md`; P175's step 12 ARCHITECTURE hunk stays its own commit, so the orchestrator can land it
after rebase (or accept the different-hunk overlap, option (b)).

## Result

Commits 1-11 landed on `p168-stream-c`, one per plan step (`git log ce4f8b6..`). Step 12 is this
docs commit.

Deviations:
- `ascii` copy lives in `cookiejar/internal/ascii`, so `jar.go` and `punycode.go` differ from
  upstream only by the import path. `.golangci.yml` excludes the vendored files from gocognit,
  gocyclo, gocritic and bodyclose.
- `deleteJarCookie` and `clearJarCookies` call `cancelQueries` after the bridge call, not first. A
  spec mutation-test shows cancelling first lets an in-flight list fetch resurrect the row.
- `resolveGrpcTabState` moved to `views/grpcrequest/resolve.ts` to avoid an import cycle with
  `schemaQuery.ts`.
- `grpcSchemaSourceFor` is synchronous and gated by a `ready` flag on the collections tree load.
- Removed stale `terminalShutdown` mock entries (unbound `TerminalService.Shutdown`) in step 3,
  fixing a pre-existing `mock-runtime-bindings` failure.
- Accepted per plan: the viewing flash while a different snapshot loads, and "Method not resolved"
  for up to 150 ms after a schema-source edit.

Checks: typecheck, lint, lint:go, lint:dead, go build/vet/test (httpclient, bridge), `test:unit`
(1796 pass), and the full Playwright ui project at phase end. Not run: ui-timing, real-hardware.

