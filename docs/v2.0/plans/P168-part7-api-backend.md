# P168 Part 7: review plan, Studio API client backend

Chunk A6, Stream A position 6 (pre-plan `P168-prep-plan.md` §5.6). One Opus reviewer runs this
plan and reports findings. It fixes nothing. One Sonnet fixer follows (§8).
Tree surveyed: `3410c8e` (`p168-stream-a` = `v2.0` tip; Parts 2-6 fixed, Part 6 findings file
dropped).

Paths repo-relative. `SI` = `apps/kira-studio/internal`, `SF` = `apps/kira-studio/frontend/src`,
`ST` = `apps/kira-studio/tests`, `SD` = `packages/shared/domain`, `AC` = `packages/api-core`. Line
numbers are as of `3410c8e`; re-read before citing.

SPEC row and orchestrator agree on the name `P168-part7-api-backend.md`.

## 0. Method for the reviewer

- **`codegraph_explore` first, mandatory.** Load it with `ToolSearch "codegraph"`, then call it
  with `projectPath=/home/user/kira-studio-streamA` before any Read/Grep on a symbol, call-path or
  blast-radius question. The orchestrator greps the run's tool log for real calls. Index:
  `.codegraph/` exists; run `sh scripts/codegraph-setup.sh` if missing. Seeds per area:
  - httpclient: `Send`, `resolveURL`, `prepareRequest`, `applyHeaders`, `buildBody`/`buildFile`/
    `prepareFormParts`/`multipartLength`, `readResponseBody`, `classifySendErr`/`finishFailed`,
    `Options.normalize`, `transportFor`, `checkRedirectFor`, `jarFor`/`currentJar`/`JarCookies`/
    `DeleteJarCookie`/`cookieDomainCandidates`/`cookiePathCandidates`/`ClearJar`,
    `sentCookiesFromHeaderValue`/`receivedCookiesFromHeader`, `newTimeline`/`closeHop`/
    `capHopHeaders`/`finishFinal`/`snapshot`, `buildWireExchange`/`renderRequestBody`/
    `renderResponseHead`/`classifyFidelity`/`wireProxyFunc`.
  - grpcclient: `NormalizeTarget`, `dialConn`, `withMetadata`, `mdToPairs`, `Unary`,
    `ServerStream`/`openStream`/`recvLoop`, `terminalOutcome`, `sanitizeUnmarshalError`,
    `resolveSource`/`resolveGroup`/`descriptorCacheGet`/`descriptorCachePut`/
    `descriptorCacheGeneration`/`InvalidateCache`/`cacheKey`/`approxDescriptorBytes`,
    `resolveReflection`/`negotiateAndListServices`/`retryOnTransportGlitch`/`linker.link`/`absorb`,
    `proto.go` (`protocompile` resolver), `Describe`/`resolveMethod`/`projectSchema`.
  - apivars: `ParseReference`, `Resolve`/`resolveWithSanitizer`/`resolveOneSpan`/
    `resolvePlainOrUnknown`/`nestedDeferredSecretRefs`, `Names`, `referencedFields`,
    `NewResolver`/`Resolver.Text`/`URLText`/`Used`, `ResolveRequest`, `forgivingBase64Decode`/
    `applyTransform`/`ApplyPipeline`, `Reveal`/`RevealHistory`/`reveal`; callee
    `localauth.Gated`/`Authorizer.Authorize`, `repos.VariablesRepo` (`RevealValue`,
    `RevealHistoryValue`, scope resolution).
  - postman: `Parse`, `decodeVariables`, `checkSchemaVersion`, `walkItems`, `importRequest`,
    `importHeaders`, `stripSensitiveOrigin`/`stripRequestAuthOrigin`/`blankSecretVariableValues`,
    `body.go` (`fileSources`, `importFileBody`), `url.go` (`Split`, `Build`, `ImportURL`,
    `reconstructURL`), `aliases.go` (`rewriteAliases`), `Write`/`buildItems`/`buildItem`/
    `buildRequest`/`ShedOrigin`/`importedOriginForCompare`.
  - TS: `AC/src/http/{substitute,substituteRequest,transforms,escape,url,headers,body,dotenv,saved}.ts`,
    `curl/{tokenize,parse,flags,generate,detect}.ts`, `raw/{parse,generate}.ts`,
    `dynamic/{catalog,generators,fakerEntry}.ts`, `grpc/{metadata,saved}.ts`; `SD/{http,collections,
    grpc,grpc-history,response-history,variables}.ts` zod schemas against the Go wire structs.
  - Bridge callers (Part 6, closed, read as one hop): `HttpService.Send`/`Cookies`/
    `DeleteCookie`/`ClearCookies`, `resolveSendOptions`, `secretReplacer`/`maskSecrets`/
    `maskSendErrTimeline`/`mapHttpError`; `GrpcService.Describe`/`Call`/`runServerStream`/
    `recordGrpcHistory`/`maskGrpcError`/`maskGrpcResult`/`mapGrpcError`/`grpcCoalescer`;
    `CollectionsService.Import`/`Export`/`readErr`/`writeFileAtomically`;
    `VariablesService.Reveal`/`RevealHistory`/`ApplyBulk`.
- **CodeGraph over-links names.** `Send`/`Parse`/`Write`/`Import`/`Reveal`/`Service`/`Stream`/
  `Resolve` exist in Space (`ade`, `adeflow`, `gitsession`, `codeworkspace`), in `connections`,
  `maskrules`, `tree`, `terminal` and in every engine. Confirm every cross-package claim with
  `git grep` of import lines (Go's `internal/` rule makes those authoritative).
- **Library source** where a claim turns on library behavior: `net/http` (`Client.CheckRedirect`
  and `makeHeadersCopier`, which headers it strips on a host change, `ErrUseLastResponse`,
  `ProxyFromEnvironment` caching, `Transport` gzip handling), `net/http/cookiejar` (entry id is
  `domain;path;name`, `domainAndType` lowercasing and IDNA, `SetCookies` with `MaxAge < 0`, what
  `Cookies(u)` returns), `golang.org/x/net/publicsuffix` (`EffectiveTLDPlusOne` on uppercase, IDN
  and trailing-dot hosts), `net/http/httputil.DumpRequestOut`, `google.golang.org/grpc`
  (`NewClient` lazy dial, `unix://` resolver, `MaxCallRecvMsgSize`, stream ctx cancel),
  `grpc/reflection` v1/v1alpha, `github.com/bufbuild/protocompile` (import resolution outside
  `ImportPaths`), `golang.org/x/text/cases` against JS `toUpperCase`/`toLowerCase`, `shlex` (npm)
  for the curl tokenizer, `@faker-js/faker`.
- **Scratch probes** in the session scratchpad or a throwaway `_test.go`/`.spec.ts`, deleted
  before the findings commit, never committed, where a claim turns on runtime behavior (a cookie
  delete on an uppercase/IDN/trailing-dot host; a redirect chain through a different port or
  scheme; a negative `RequestTimeoutMs`/`MaxResponseMb`; a deeply nested Postman file; a TS/Go
  corpus case for a pipe on a non-ASCII value; a reflection server returning a large or cyclic
  file set).
- **Checks:** `go vet` and `go test -race` over `./apps/kira-studio/internal/{httpclient,
  grpcclient,apivars,postman}/...`, plus `./apps/kira-studio/internal/bridge/...` (`http_test`,
  `grpc_test`, collections atomicity tests exercise this chunk) and
  `./apps/kira-studio/internal/storage/repos/...` (`collections_test`, `variables_test`,
  `response_history_test`, `grpc_history_test` call `postman` and `httpclient`);
  `go build ./apps/kira-studio/...`; `bun test packages/api-core/test
  ST/unit/go-ts-vocabulary-parity.spec.ts`; `bun run --cwd packages/api-core typecheck` and
  `bun run typecheck`. UI tier touching this chunk's surfaces (Part 10 specs, Stream C, run read
  only): `bun run test:ui:studio -- --grep "http-|grpc-|collections|api-|secrets|credential-reveal"`
  (mock runtime; confirm the specs still exercise the bound shapes this chunk returns). Missing
  deps or bindings: `bun install --frozen-lockfile` and `bun run setup` (or
  `sh scripts/prepare-worktree.sh`). A red check is a finding.
- **Network:** every Go test here uses `httptest` or an in-process gRPC server; no real outbound
  traffic is needed. Never point a probe at a public host.

## 1. Ownership re-run (pre-plan §8) and drift

Re-ran the §8 script verbatim at `3410c8e`. **Part 7: 91 files, 17,173 code lines (tests
6,556).** Pre-plan (`f40cd35`) and Part 6's plan base (`d7f1da9`): 90 files, 17,074 (6,514).
Only Part 7 change since the pre-plan: Part 6 fixer `b06ab01` (Part 6 F12, routed Part 10 F18):
`SI/httpclient/cookies.go` 168 to 225 (+57: `DeleteJarCookie` now expires the name under every
candidate domain and path; new `cookieDomainCandidates`, `cookiePathCandidates`; imports `net`,
`strings`) and new `SI/httpclient/cookies_test.go` (42). Unreviewed new code: block 1 reviews it
(§7).

**What Parts 5-6 changed in Part 7's one-hop files** (`git log f40cd35..3410c8e`, per file):
- `SI/bridge/collections.go` 460 to 477, `ee9a71e` (Part 6 F13, routed Part 10 F6): new generic
  `readErr` maps `repos.ErrItemNotFound` to `ipcerr.NotFound` (`E_NOT_FOUND`),
  `repos.ErrNotARequest` to `E_BAD_REQUEST`, the rest to `E_INTERNAL`; `GetRequest`/
  `GetGrpcRequest` use it. `Import`/`Export`/`writeFileAtomically` unchanged.
- `SI/storage/repos/collections.go`, `ee9a71e`: sentinels `ErrItemNotFound`/`ErrNotARequest`,
  wrapped by `getRequestBody`. No `postman` call site changed.
- `internal/ipcerr/errors.go`, `ee9a71e`: `NotFound(message)` constructor. No Part 7 file
  imports `ipcerr` (`httpclient/errors.go:10` only names it in a comment).
- **Unchanged, contrary to the hand-off note:** `SI/bridge/http.go`, `grpc.go`, `variables.go`,
  `grpchistory.go`, `responsehistory.go`, `apidata.go`, `http_test.go`, `grpc_test.go`, and
  `SF/bridge/{apiControl,index}.ts` have no commit since `f40cd35` (last `apiControl.ts` commit is
  P161 `cbdc489`). Part 6 F12 deliberately did **not** widen `HttpCookieDeleteArgs` or
  `httpDeleteCookie(url, name)`: the jar reports no domain or path to pass (§7).
- `SD/mask.ts` (`3561a85`) and `SD/dbmcp.ts` (`42c5def`) are Part 6 files; no Part 7 file or
  one-hop caller imports them (`git grep "domain/mask"` over Part 7 paths: none).
- Part 2 callees: `95e7f0f` (localauth serialises prompts, expires grace across sleep),
  `9c19663` (UTF-16 name counting, trimmed storage), `66174c8` (`Reorder` ids validated),
  `3616f54`/`validation.go` (new `model/validation.go`, Part 6 F16). All before or outside this
  chunk; callee contract notes only.

Drift elsewhere, none touching a Part 7 file:
- Part 2: 148 to 149 files, 20,159 to 20,179 (tests 8,088): new `model/validation.go`.
- Parts 3-5 unchanged since Part 6's plan (27,825; 16,751; 21,695).
- Part 6: 95 to 96 files, 14,757 to 15,148 (tests 4,464 to 4,591): its fixer.
- Part 8: 16,274 to 16,364 (`ipcerr.NotFound`, `shell` atomics, terminal unbind).
- Part 10: 92 files, 23,917 (10,431). Part 11: 30,837 (10,211). Part 12: 27,187 (10,389).
  Part 13: 26,924 (14,858). All Stream C.
- Stream B: Part 14 16,275; 15 15,641; 16 19,286; 17 23,653; 18 20,843; 19 19,897; 20 20,312;
  21 17,327; 22 19,849; 23 10,475.
- Totals: streams A 258,723, B 183,558; 2,903 owned, 0 orphans, 3,544 tracked (docs 488).
- **Stream drift (SPEC `8a008bd`, not in the script):** Parts 10-13 are Stream C. The script
  still labels them `[A]`. Edit scope follows the SPEC (§8).

P166/P167: findings `a37fdec` and `8a98250` name no Part 7 path. Both findings files are
deleted on this branch. Pre-plan churn for this chunk was 0 lines. Review the whole chunk, not a
diff.

## 2. Own file set (91 files)

51 production code files (10,617 lines), 28 test code files (6,556), 12 non-code (10 JSON test
fixtures, `AC/package.json`, `AC/tsconfig.json`; not counted). Per area (prod files/lines; test
files/lines):

- **`SI/httpclient`** (7/1,924; 5/1,622): `client` 477, `timeline` 407, `body` 363, `cookies`
  225, `options` 205, `wire` 193, `errors` 54. Tests: `client_test` 533, `wire_test` 365,
  `timeline_test` 347, `body_test` 335, `cookies_test` 42.
- **`SI/grpcclient`** (6/1,524; 7/1,388): `reflect` 476, `descriptors` 463, `call` 317, `target`
  171, `proto` 49, `errors` 48. Tests: `call_test` 328, `testserver_test` 287, `descriptors_test`
  271, `descriptor_cache_test` 197, `reflect_test` 117, `descriptors_invalidation_test` 116,
  `target_test` 72.
- **`SI/postman`** (6/1,744; 4/1,085; 8 JSON): `body` 390, `parse` 358, `write` 321, `url` 290,
  `collection` 242, `aliases` 143. Tests: `roundtrip_test` 871, `aliases_test` 104,
  `write_test` 71, `parse_limit_test` 39. `testdata/{bodies,inert,oneofs,nesting,malformed,
  aliases-object-form,no_schema,v2_0}.json`.
- **`SI/apivars`** (4/794; 2/358; 1 JSON): `resolve` 538, `transforms` 130, `reveal` 78, `vars`
  48. Tests: `resolve_test` 318, `transforms_test` 40. `testdata/substitution.json` 493 is the
  Go/TS shared corpus (also read by `AC/test/http-substitution.spec.ts`).
- **`AC/src`** (22/3,542): `http/curl/parse` 693, `http/substitute` 359, `http/dotenv` 327,
  `http/dynamic/catalog` 259, `http/headers` 185, `http/curl/flags` 181, `http/raw/parse` 174,
  `http/body` 173, `http/saved` 152, `http/url` 143, `http/curl/generate` 123, `http/raw/generate`
  111, `http/dynamic/generators` 109, `http/transforms` 98, `index` 94, `http/curl/tokenize` 84,
  `grpc/saved` 82, `http/substituteRequest` 68, `http/curl/detect` 52, `grpc/metadata` 39,
  `http/escape` 26, `http/dynamic/fakerEntry` 10.
- **`AC/test`** (9/1,968; 1 JSON): `http-curl` 558, `http-substitution` 352, `http-dotenv` 303,
  `http-raw-parse` 205, `go-ts-api-parity` 171, `http-url` 164, `http-raw-generate-stored` 84,
  `http-curl-detect` 73, `http-dynamic-fake` 58; `curl-cases.json` 595.
- **`SD`** (6/1,089): `http` 529, `grpc` 235, `collections` 146, `variables` 78, `grpc-history`
  53, `response-history` 48.
- **`ST/unit/go-ts-vocabulary-parity.spec.ts`** (1/135).
- **Not owned, read as callees or one hop:** `SI/bridge/{http 415, grpc 545, collections 477,
  variables 276, grpchistory 66, responsehistory 78, apidata 44}.go` (Part 6, closed);
  `SI/storage/model/{responsehistory 82, collections 153, variables 84, grpc, settings}.go` and
  `SI/storage/repos/{collections 734, variables 1,315, response_history 250, grpc_history 237}.go`
  (Part 2, closed); `SI/localauth/localauth.go` 200, `SI/secrets/cipher.go` 173 (Part 2).

## 3. One hop: callers (git grep of import lines)

- **Go importers of Part 7 packages from outside the chunk** (all closed, editable as one hop):
  - `httpclient`: `bridge/http.go` (+`http_test.go`), `storage/model/responsehistory.go`
    (`httpclient.Response`/`Header`/`Body` in the stored snapshot: a Part 2 model importing a
    Part 7 type), `storage/repos/response_history.go` (+test). Internal: `apivars/resolve.go`
    (`Header`, `Body`, `Field`, `FormField`), `postman/url.go`.
  - `grpcclient`: `bridge/grpc.go` (+`grpc_test.go`) only.
  - `apivars`: `appcore/deps.go` (`Deps.ApiVars`), `main.go` (`apivars.New`, shared
    `*localauth.Authorizer`), `bridge/{http,grpc,variables}.go` (+tests).
  - `postman`: `bridge/collections.go` (`Parse`, `Write`), `storage/repos/collections.go`
    (`ImportTree`/`LoadTree` take `*postman.Tree`), `storage/repos/variables.go`
    (`ImportVariables` takes `[]postman.Variable`), their tests.
  - A signature change in `httpclient.Response`/`Cookie`/`Timeline` or `postman.Tree` ripples into
    Part 2 storage and Part 6 bridge.
- **`settings` coupling:** `httpclient/options.go:58-60` says every `normalize` default equals
  `model.DefaultSettings().Api` field for field; `storage/model/settings.go` states the same back.
  Neither imports the other: the coupling is comment-only.
- **TS callers of `@kira/api-core`** (all Stream C, Part 10 unless noted): `SF/api/{BulkVariablesEditor,
  DynamicValuesDialog}.vue`, `SF/api/state/{curl,raw,variableCompletion}.ts`, `SF/api/tabs.ts`,
  `SF/views/grpcrequest/{GrpcMetadataTable,GrpcRequestView}.vue`, `views/grpcrequest/state.ts`,
  `SF/views/httprequest/{HttpRequestView,QueryParamsTable,RawExchangePane,RequestBodyPane,
  RequestHeadersTable}.vue`, `views/httprequest/state.ts`; `SF/views/shared/request/resolve.ts`
  (Part 11); `SF/state/tabKinds.ts` (Part 13). Also `biome.json`, `SF/../package.json`.
- **TS callers of the six `SD` files:** `SF/bridge/apiControl.ts` (Part 5, closed, editable:
  imports `http`, `grpc`, `grpc-history`, `response-history`, `variables`); `packages/theme/src/
  methodColor.ts` (Part 9, Stream A, later, editable: `HttpMethod` type);
  `packages/shared/protocol/events.ts` (Part 9: `variables`); every other importer is Stream C
  (`SF/api/**`, `SF/views/{httprequest,grpcrequest}/**`, `SF/state/{tabDomain,tabKinds}.ts`,
  `ST/unit/{api-*,grpc-*,http-*}`).
- **Wails surface:** none of the four Go packages is bound directly. Every renderer call reaches
  them through `HttpService`, `GrpcService`, `CollectionsService`, `VariablesService` (Part 6)
  and `SF/bridge/apiControl.ts` (Part 5).

## 4. One hop: callees

- **Part 2 (closed):** `storage/repos.VariablesRepo` (scope/environment resolution, `RevealValue`,
  `RevealHistoryValue`, secret decryption through its own `Cipher`), `repos.CollectionsRepo`,
  `repos.ResponseHistoryRepo`/`GrpcHistoryRepo` (via bridge), `storage/model`
  (`SavedRequest`, `SavedFile`, `SavedHeader`, `SavedGrpcMetaRow`, `Variable`); `secrets.Cipher`;
  `localauth` (`Gated`, `Authorizer.Authorize`, `GraceWindow`; Part 2 `95e7f0f` serialises prompts
  and expires grace across sleep).
- **Part 6 (closed):** `buildinfo.Version` (User-Agent, `httpclient/client.go`).
- **Part 8 (later, editable):** none imported directly by the four Go packages; bridge callers use
  `ipcerr`, `adapterhost.Host.RunOp` (Part 5) for op scheduling and cancel.
- **Libraries:** `net/http`, `net/http/cookiejar`, `net/http/httptrace`, `net/http/httputil`,
  `golang.org/x/net/publicsuffix`, `google.golang.org/grpc` (+`credentials`, `metadata`,
  `reflection/grpc_reflection_v1`, `v1alpha`), `google.golang.org/protobuf` (`protojson`,
  `dynamicpb`, `protodesc`, `protoregistry`), `github.com/bufbuild/protocompile`,
  `golang.org/x/sync/singleflight`, `golang.org/x/text/cases`; TS `zod`, `shlex` 3.0.0,
  `@faker-js/faker` 10.6.0. Licence of each: confirm fully open source (`CLAUDE.md`).

## 5. Edge cases and failure modes to weight

Freeform: any kind of issue or bug counts. Weight edge cases. Security first: this chunk sends
user-authored requests carrying decrypted secrets to arbitrary hosts, reads local files into
request bodies, stores exchanges in `kira.sqlite`, and parses untrusted collection files.

### 5.1 HTTP client (`SI/httpclient`)

- **Redirects** (`options.go:151` `checkRedirectFor`). P108 Part 8 F2/F3 strip user headers on a
  host change versus the origin and on an https-to-http downgrade. Weigh: a port-only change
  (`api.x:443` to `api.x:8443`), a host differing only in case or a trailing dot, an IP literal
  versus its hostname, `Cookie` set by the user as a header (stdlib strips it on host change; the
  jar re-adds per host), a 307/308 replaying a streamed body (`GetBody` reopens a file at send
  time: file changed between hops), `followRedirects=false` closing the final hop exactly once,
  `maxRedirects` 0 and 100, `ErrUseLastResponse` with a body read cap.
- **TLS:** `sslVerify=false` selects a cached transport with `InsecureSkipVerify` (`options.go:141`);
  `transportFor` caches at most four transports (http1 x skipVerify): connection reuse across a
  verify-on and verify-off send to one host (separate pools?); HTTP/2 negotiation when `http1`
  is false; a client-cert need (not offered: say so, no finding).
- **Proxies:** `http.ProxyFromEnvironment` (env read once per process); `NO_PROXY` matching;
  proxy credentials in `HTTPS_PROXY` reaching any rendered surface (`wire.go:46`
  `classifyFidelity`, timeline `RemoteAddr`, error text); `CONNECT` failure classification.
- **Timeouts and cancellation:** `normalize` clamps `RequestTimeoutMs` and `MaxResponseMb` with
  `max(v, 0)`, and 0 means "none"/"unbounded" (`options.go:75-90`). A negative value from the
  renderer or a stored setting therefore turns the cap off instead of rejecting or defaulting
  (Part 10 F16 clamps the renderer; Go is the last line). Stop and window-close cancel via
  `Host.RunOp`'s derived ctx: body read in progress, `DumpRequestOut` on a streamed body, a
  multipart file still uploading.
- **Body streaming and size caps:** `readResponseBody` (`client.go:433`) `io.ReadAll` up to
  `maxResponseBytes` (default 5 MiB, ceiling 2 GiB, 0 unbounded), then string and base64 (x1.33)
  and JSON over Wails: memory peak per send. Decompressed size versus wire size (gzip bomb: the
  cap applies after transparent decompression?). Request side: `buildFile`/form-data file rows
  read any local path the renderer names (`body.go:166`; trust model: first-party renderer;
  postman import never carries a path, P21 F3); `multipartLength` versus the real stream when a
  file grows between stat and send; `ContentLength` mismatch error text.
- **Cookie jar** (`cookies.go`): one shared in-memory jar per process; incognito gets a
  throwaway jar (`jarFor`); `DisableCookieJar`; `ClearJar` swaps under `jarMu` while a send holds
  the old jar (its cookies land in the discarded jar: fine?). `JarCookies` returns name and value
  only (`Domain`/`Path` always `""`). **New code (§7):** `DeleteJarCookie` now loops
  `cookieDomainCandidates(u.Hostname())` x `cookiePathCandidates(u.Path)`.
- **Timeline and cookies capture:** `capHopHeaders` 8 KiB per hop; `receivedCookies` uncapped by
  design (comment at `timeline.go:115-119`): a server sending thousands of `Set-Cookie` over 100
  redirect hops; httptrace hooks on transport goroutines under `tl.mu`; `Info1xx`; a failed send's
  timeline (`classifySendErr`) masked by the bridge before it leaves the op.
- **Credential leakage in logs and history:** `op.SetCommand` gets the unresolved URL (P5 D6/F3);
  `slog.Warn` in `buildWireExchange` logs `dumpErr`/`bodyErr`/`headErr` (`client.go:458-468`):
  can any carry a resolved URL, header or body fragment? `classifySendErr` messages wrap
  `url.Error`, which embeds the resolved URL: confirm `maskSendErrTimeline` masks `herr.Message`
  for every code (it does for `*httpclient.Error`; check errors returned before `Send` builds
  one, e.g. `resolveURL` and `prepareRequest` failures quoting a resolved URL into
  `E_BAD_REQUEST`). Response body, gRPC reply messages and jar cookies stored unmasked are a
  **Known open item** (`docs/ARCHITECTURE.md`, P108 Part 8 F16): do not re-report.

### 5.2 gRPC client (`SI/grpcclient`)

- **Target and dial:** `NormalizeTarget` passes `dns://`, `unix://`, `unix-abstract://`,
  `passthrough://` through untouched (`target.go:34,53-58`): a renderer-supplied `unix:///var/run/
  docker.sock` dials a local socket (weigh against the first-party trust model only). `dialConn`
  reads any `CAFile` path and echoes it in errors; `ServerName` override; no
  `InsecureSkipVerify` by design (D6). One `ClientConn` per call (`NewClient` lazy): closed on
  every path (`Unary` defer; `openStream` returns conn on later errors).
- **Reflection:** v1 then v1alpha on `Unimplemented`; `retryOnTransportGlitch`; `linker.link`
  recursion (P108 F1 cycle guard): depth on a long dependency chain, a server returning thousands
  of files or huge descriptors (`absorb` before any size check; `maxCachedDescriptorBytes` 64 MiB
  only bounds the cache), a server that answers `FileContainingSymbol` with an unrelated file.
  Reflection uses the call's metadata (auth).
- **Descriptor cache and supersession:** key excludes metadata values (finding 12), includes the
  resolved target; generation counter plus `singleflight` (P108 F11); `InvalidateCache` racing an
  in-flight `resolveGroup.Do` whose result is shared by a waiter that started after invalidate;
  LRU byte accounting via `approxDescriptorBytes` (re-marshal cost per Put); proto mode: a
  `.proto` edited on disk with the same path (cache never sees it until invalidate); protocompile
  import resolution escaping `ImportPaths` (absolute imports, `..`).
- **Streaming lifecycle:** `ServerStream` delivers each message through `onMessage` (bridge
  coalescer `EmitTo`); `maxStoredMessages` 100 bounds stored messages, not emitted ones; per
  message cap `maxRecvMsgSize` 16 MiB; a long or fast stream floods the renderer (coalescer
  throttle?); Stop mid-stream returns `Partial` counts for history; tab closed or window closed
  mid-stream; server half-close versus trailers-only error; client-streaming and bidi refused.
- **Metadata:** keys lowercased, validated by `metadataKeyPattern`; `-bin` suffixed keys (binary
  metadata must be base64 in grpc-go?) and reserved `grpc-*` keys; duplicate keys; response
  `Header`/`Trailer` masked by `maskGrpcResult` (bridge).
- **Errors:** `terminalOutcome` maps ctx-caused `Canceled`/`DeadlineExceeded` and `Unavailable`
  to errors, every other code to a result; `sanitizeUnmarshalError` (P108 F13) keeps position
  only; `SchemaError` on response render. `Describe` timeout (P108 F4).

### 5.3 apivars (interpolation, escaping, secrets, reveal)

- **Grammar parity:** Go `Resolve`/`ParseReference` against `AC/src/http/substitute.ts`, pinned by
  `apivars/testdata/substitution.json` (read by both `resolve_test.go` and
  `http-substitution.spec.ts`). Check: unbalanced `{{`, `{{{x}}}`, nested `{{a{{b}}}}`, empty
  name, whitespace inside braces, `|` in names, unknown transform, pipeline on a deferred secret,
  a dynamic `{{$guid}}` in Go stage 2 (Go never generates dynamics: confirm the TS side has
  substituted them before the bridge), surrogate pairs and invalid UTF-8.
- **Transforms:** `upper`/`lower` use `golang.org/x/text/cases` in Go and JS `toUpperCase`/
  `toLowerCase` in TS: `ß`, Turkish `İ`/`ı`, Greek final sigma, `ŉ`; `urlencode` via Go
  `QueryEscape` versus `goQueryEscapeLiteral` (`AC/src/http/escape.ts`); `urldecode` on `+`, `%`,
  invalid UTF-8 after decode; `base64decode` forgiving rules (P108 F14). Which of these lack a
  corpus case.
- **URL sanitising:** `URLText` percent-encodes unsafe characters of an unresolved span only;
  a resolved secret containing `#`, `?`, `&`, space or CRLF inserted into a URL raw (query
  injection, request-line breakage) versus TS `sanitizeUrlSpan`.
- **Header injection:** a resolved value with `\r\n` in a header name or value (Go `net/http`
  rejects invalid header values: error text quoting the value?).
- **Secret isolation:** `ResolveRequest` substitutes URL, header names and values, raw/code body,
  urlencoded and form-data text fields; never a file path (D7). `UsedSecret.Rendered` covers
  each piped form; `secretReplacer` (bridge) adds `QueryEscape`/`PathEscape` forms. Weigh: a
  secret rendered inside JSON (escaped `"` or `\`), inside multipart, inside a header name (masked
  only in the `Wire` text, not in `resp.Headers` names), or a secret shorter than 4 characters
  masking unrelated text. P108 F5 (undecryptable secret shadows) and F6 (plain value holding
  `{{secret}}`) fixed: confirm, do not re-report.
- **Reveal:** `Reveal`/`RevealHistory` share the one `*localauth.Authorizer` with connections
  (D8). `GateFetchError` logs the variable id and the decrypt error text (`reveal.go:72`): can
  that text contain plaintext? `confirmed` honoured only when OS auth is unavailable (Part 2).
  Bulk paths: `VariablesService.ApplyBulk`/`.env` apply (`AC/src/http/dotenv.ts`) must never
  return or log a secret value.

### 5.4 Postman import and export (`SI/postman`)

- **Parse limits:** `maxCollectionBytes` 64 MiB (`parse.go:33`), `io.ReadAll` then
  `json.Unmarshal` into `map[string]json.RawMessage`; `walkItems` (`parse.go:135`) recurses per
  folder and re-decodes each nested `RawMessage`: cost on a deep chain (Go's decoder caps depth at
  10,000; total work is about depth x remaining bytes), stack on a hostile file, `cloneOrigin` per
  node (memory amplification on 64 MiB input). `parse_limit_test.go` covers size only.
- **Robustness:** non-object `item` entries, `item` as an object not an array, `request` as a
  string (URL shorthand), `url` as string versus object with `raw`/`host`/`path` arrays
  (`ImportURL`, `reconstructURL`), `body.mode` unknown, `formdata` `src` oneOf
  (string/null/array; F5/P21 never keeps a path), `graphql` bodies, `options.raw.language`,
  header `disabled`, duplicate names, v2.0 versus v2.1 schema gate (`checkSchemaVersion`),
  `no_schema.json`, a `variable` array with non-string values, `$alias` rewriting
  (`aliases.go`, P108 F7).
- **Atomicity and secrets:** `CollectionsService.Import` (Part 6) runs `ImportTree` then
  `ImportVariables` with a compensating delete (P21 F10, P108 F19): confirm unchanged. Secret
  stripping at import (`stripSensitiveOrigin`, `stripRequestAuthOrigin`,
  `blankSecretVariableValues`, P108 F8) and valueless secret export: any member path that still
  keeps an `auth` block or secret value in `origin_json` (item-level `event`, `protocolProfile
  Behavior`, `request.auth` inside a string-form request).
- **Round trip:** `Write` keeps origin members verbatim unless edited (`importedOriginForCompare`);
  `SetEscapeHTML(false)`; gRPC items skipped and counted; ordering by `Order`; export of a
  request whose URL has `{{var}}` in host (Postman `host` array split).

### 5.5 TS api-core

- **curl import** (`curl/tokenize.ts`, `parse.ts` 693, `flags.ts`): `shlex` quoting, `$'...'`,
  line continuations (`\` CRLF), shell operators (`|`, `;`, `&&`, redirects) refused or warned,
  `-d @file`/`--data-binary @file`/`--json @file` (P108 F10), `-F` file parts, `-u` with a
  `{{var}}` (P108 F9), `-H` with no colon, repeated flags, `-X` with a body, `--url`, unknown
  flags, a 1 MB pasted command (regex backtracking). `curl/generate.ts` output re-parsed by
  `parseCurl` (round trip) and shell-safe quoting of a value with `'`.
- **Raw HTTP** (`raw/parse.ts`, `generate.ts`): CRLF versus LF, header folding, absolute-form
  request line, `Host` header versus URL host, body after a blank line with trailing CRLF.
- **dotenv** (`dotenv.ts` 327): quotes, escapes, `export ` prefix, comments after values,
  multiline, duplicate keys, CRLF, BOM.
- **Dynamic values** (`dynamic/catalog.ts`, `generators.ts`): Postman `$random*` catalogue parity
  with `postman/aliases.go`'s list, determinism in tests, a generator that throws.
- **Headers, url, body, saved:** `headers.ts` merge and case rules; `url.ts` query split and
  rebuild with `{{var}}` spans; `body.ts` content-type defaults against Go `applyHeaders`;
  `http/saved.ts`/`grpc/saved.ts` against `model.SavedRequest`/`SavedGrpcRequest` JSON.

### 5.6 Go and TS vocabulary parity (`SD` zod schemas)

- `SD/http.ts` (529) against `httpclient.Response`, `Cookie`, `Timeline`/`TimelineHop`/`Phase`,
  `WireExchange` (`Fidelity` values), `Options`/`resolved` defaults (`httpRequestSettingsSchema`
  ranges versus `normalize` clamps: `int().min(0)` in TS, `max(v,0)` in Go), body modes
  (`HTTP_BODY_MODES` versus Go `validBodyModes`), methods (`HTTP_METHODS` versus `validMethods`),
  `CODE_LANGUAGES` versus Go content types.
- `SD/grpc.ts` (235) against `grpcclient.CallResult`/`Message`/`Schema`/`Source`/`TLSConfig`/
  `MetaPair` and the bridge event payloads; error codes `E_GRPC_*` (Go `errors.go`) versus any
  TS list; `SD/grpc-history.ts`/`response-history.ts` against `model` entries and the per-scope
  caps (pinned by `go-ts-vocabulary-parity.spec.ts`: `historyPerScopeLimit`,
  `grpcHistoryPerScopeCap`); `SD/collections.ts`/`variables.ts` against `model.CollectionItem`,
  `Variable`, `Environment`, `RevealResult` outcomes (`apivars.Outcome*` four strings).
- `AC/test/go-ts-api-parity.spec.ts` and `ST/unit/go-ts-vocabulary-parity.spec.ts`: which Go
  vocabularies they pin, which they miss (a Go enum with no extractor is a drift risk, not a
  finding by itself; report a real mismatch). P108 F17 hardened the extractors: do not
  re-report.
- `httpclient` error codes (`E_BAD_REQUEST`, `E_CANCELLED`, `E_TIMEOUT`, `E_HTTP_TRANSPORT`)
  against the renderer's handling (Part 10, read only) and against `viewOp.ts`
  `DISCONNECTED_CODES` (must not overlap).

### 5.7 Unit-test bar

`CLAUDE.md` bar: substitution corpus, redirect header stripping, timeline races, descriptor cache
generation and singleflight, curl tokenizer, postman round trip clear it. Report only a true
duplicate or a test restating a trivial body (candidates: `transforms_test.go` 40 against the
corpus, `write_test.go` 71 against `roundtrip_test.go`, `http-curl-detect.spec.ts` 73,
`http-dynamic-fake.spec.ts` 58, `cookies_test.go` 42 against §7's enumeration: it is the
multi-rule enumeration the bar allows).

## 6. What earlier fixes already changed (do not re-report)

- **P108 Part 8** (v1.9; this chunk's analogue, `docs/v1.9/SPEC.md` "P108 Part 8 result"): F1
  reflection cycle guard, F2/F3 redirect header strip (host change, https-to-http downgrade), F4
  `Describe` timeout, F5 undecryptable secret shadows, F6 plain value with `{{secret}}` text
  reported deferred, F7 postman alias rewrite before origin compare, F8 auth and secret-variable
  stripping at import, F9 curl `-u` UTF-8 and `{{var}}`, F10 curl `--json @file`, F11 descriptor
  cache generation and singleflight, F12 mask before wire truncation, F13 protojson error
  sanitising, F14 forgiving base64, F15/F16 docs (F16: response bodies, gRPC messages, jar
  cookies unmasked in history, a **Known open item**, accepted by design), F17 parity extractor
  hardening, F18 `writeFileAtomically` mode and symlink, F19 compensating delete failure surfaced.
  Verify they hold; do not re-report.
- **P168 Part 2** (closed): `localauth` serialised prompts and grace expiry across sleep
  (`95e7f0f`); UTF-16 name counting (`9c19663`); `Reorder` validation (`66174c8`).
- **P168 Parts 3-5** (closed): no Part 7 file edited. Part 5 F1 bounded `Host.CancelOp` (HTTP
  and gRPC Stop goes through it).
- **P168 Part 6** (closed, `34b382a`..`3410c8e`): F12 `DeleteJarCookie` candidate expiry
  (`b06ab01`, a Part 7 file: reviewed as new code, §7), F13 saved-request `E_NOT_FOUND`
  (`ee9a71e`), F16 E_INTERNAL labels (`3616f54`). Other Part 6 fixes touch no Part 7 file.
- **Parked design decisions (do not re-report, do not reopen):**
  - Part 4 F8 (console results fully materialised, no row/byte cap) and Part 4 F15 (sqs browse
    consumes messages on a read-only connection).
  - Part 5 F4 binary half (kafka binary payload encoding flag versus marker).
  - Part 6 F8 (`run_query` reaches Part 4 F8's materialisation).
  - Part 6 F12 **exact-cookie half**: deleting one of two same-name cookies needs a jar that
    exposes entries (replace or fork `cookiejar`). Name-scoped delete is the shipped behavior.
  - Part 11 F7 (grid paging, sort, filter, Refresh discard staged edits silently).
- **Known open items** in `docs/ARCHITECTURE.md` touching this chunk (response body, gRPC
  messages, jar cookies unmasked in history): not a finding.
- **P166/P167**: no Part 7 file named; findings files deleted. Nothing to skip.

## 7. Routed items owned by this Part

Read `docs/v2.0/plans/P168-routed-from-streamA.md`, `P168-routed-from-streamC.md`,
`P168-routed-from-streamB.md` and `P168-routed-to-stream-a.md` (this branch), plus the copies on
`p168-stream-b`/`p168-stream-c` (`git show p168-stream-c:docs/v2.0/plans/<file>`). At plan time
none names a Part 7 file other than the item below (`git grep` of `httpclient|grpcclient|apivars|
postman|api-core|domain/(http|grpc|variables|collections)|response-history|vocabulary` across all
three branches' routed and findings files: no hit).

- **Stream C Part 10 F18 / Part 6 F12 (cookie delete): verify as unreviewed new code.** Part 6's
  fixer landed the name-scoped half in a Part 7 file (`SI/httpclient/cookies.go:104-163`,
  `b06ab01`) with `cookies_test.go`. No reviewer has read it. Block 1 checks:
  - `cookieDomainCandidates(u.Hostname())`: uppercase host (cookiejar lowercases the URL host and
    the `Domain` attribute; `publicsuffix.EffectiveTLDPlusOne` may not), IDN host (cookiejar
    punycodes; candidates computed from the Unicode form), trailing-dot host, IPv6 literal, a host
    that is itself a public suffix or eTLD+1 (`d != base` loop), `localhost` and single-label
    hosts, `EffectiveTLDPlusOne` error path (only host-only expired: a parent-domain cookie
    survives).
  - `cookiePathCandidates(u.Path)`: empty path, root, trailing slash, encoded `%2F` (cookiejar
    matches on `u.Path`, decoded), very long paths (candidate count x domain count `SetCookies`
    calls under the jar's lock).
  - Side effects: an expiring `SetCookies` for a `Secure` cookie through an `http://` URL; a
    `Domain=` candidate equal to the URL host versus host-only entry ids; `SetCookies` with
    `MaxAge -1` on a name the jar never held (no-op?); behavior when the bridge
    `DeleteCookie` is called for a URL whose scheme is not http(s).
  - Semantics: Remove now drops every cookie of that name the jar would send to the URL. Confirm
    the UI copy (Part 10, read only) does not promise more. The exact-cookie half stays parked
    (§6); `HttpCookieDeleteArgs`/`httpDeleteCookie(url, name)` stay name-only by Part 6's
    decision.
- **Stream C Part 10 F6 / Part 6 F13**: Go half landed in Part 6; renderer half routed to Stream C
  (`apiQueries.ts`). Not Part 7. Confirm only that no Part 7 code path depends on the old
  `fmt.Errorf` text of `getRequestBody`.
- **Every other routed item** (Part 4 F12/F20, Part 5 F4/F7, Part 6 F11/F19, Part 12 F12/F17,
  Part 14 F4): owned by Parts 5, 8, 12, 13. Not Part 7.

## 8. Rubric, order and outputs

- **One Opus reviewer**, freeform "any kind of issue or bug", edge cases weighted. Not three
  dimension reviewers (user deviation from `CLAUDE.md`'s recipe, P168 only).
- Reports only. Fixes nothing, edits no code.
- **Whole chunk, one pass, in this block order** (network and secret-bearing Go first, then
  parsers, then the TS mirrors, then tests). About 10.6k production lines plus 6.6k test lines:
  read tests only where they are the sole guard of a claim, or in block 7.
  1. **HTTP client:** `httpclient/{client,options,body,cookies,timeline,wire,errors}.go`, with
     the bridge's use of them (`bridge/http.go` `Send`, `resolveSendOptions`, `maskSecrets`,
     `maskSendErrTimeline`, cookie methods). Routed cookie-delete verification (§7) here.
  2. **Variables and secrets:** `apivars/{resolve,transforms,reveal,vars}.go`, the corpus,
     callees `repos.VariablesRepo` reveal/scope paths and `localauth.Gated` (read only),
     `bridge/variables.go`.
  3. **gRPC client:** `grpcclient/{target,call,descriptors,reflect,proto,errors}.go`, with
     `bridge/grpc.go` (`Describe`, `Call`, `runServerStream`, coalescer, `recordGrpcHistory`,
     masking).
  4. **Postman:** `postman/{parse,body,url,aliases,collection,write}.go`, with
     `bridge/collections.go` `Import`/`Export` and `repos.CollectionsRepo.ImportTree`/`LoadTree`,
     `repos.VariablesRepo.ImportVariables` (read).
  5. **TS api-core:** `AC/src/**` (curl, raw, dotenv, substitute, transforms, escape, url,
     headers, body, saved, dynamic, grpc).
  6. **Vocabulary and wire parity:** `SD/{http,grpc,grpc-history,response-history,collections,
     variables}.ts` against the Go structs; `go-ts-api-parity.spec.ts`,
     `go-ts-vocabulary-parity.spec.ts`; `SF/bridge/apiControl.ts` types (read).
  7. **Tests and checks:** every Part 7 `_test.go` and `AC/test/*.spec.ts`, the §0 checks, the UI
     subset if not run earlier.
- **Resumable:** write `docs/v2.0/plans/P168-part7-findings.md` as blocks finish, and commit it
  after **every** block (`docs(v2.0): P168 Part 7 findings, block <n>`; normal commit, hooks
  green, explicit `git add <path>`). Mark each block done in the file's coverage section. An
  interrupted run reads the file, resumes at the first block not marked done, and never
  re-derives a committed block.
- Each finding: id (`F<n>`), severity (high/medium/low), `file:line` on the current tree, a
  concrete failure scenario (inputs, sequence, observed outcome; say which probe or real run
  confirmed it), and a proposed fix. Tag `design-decision` when it needs one; the fixer turns it
  into its own `SPEC.md` phase. A finding that restates a parked decision (§6) is not filed.
- **Edit scope tag.** The fixer may edit Part 7 files and Stream A one-hop files (Parts 2-6
  closed, Parts 8-9 later; pre-plan §3.3): `SI/bridge/{http,grpc,collections,variables,
  grpchistory,responsehistory,apidata}.go` and their tests, `SI/storage/{model,repos}/**`,
  `SI/localauth`, `SI/secrets`, `SI/appcore/deps.go`, `apps/kira-studio/main.go`,
  `SF/bridge/{apiControl,index}.ts`, `internal/ipcerr`, `packages/theme/src/methodColor.ts`,
  `packages/shared/protocol/events.ts`. A finding whose fix needs a file outside that set carries
  `needs-other-part-file: <path> (Part N)`. That covers every Stream C file (Parts 10-13:
  `SF/api/**`, `SF/views/**` incl. `views/shared/request/resolve.ts`, `SF/state/**`,
  `ST/ui/**`, `ST/unit/{api-*,grpc-*,http-*}`, `ST/fixtures/**`) and every Stream B file (Parts
  14-23). The orchestrator routes those; the Part 7 fixer never edits them.
- The findings file states base commit (`3410c8e`), HEAD reviewed, checks run and results (vet,
  race, build, bun unit, api-core typecheck, typecheck, UI subset, probes), findings, then
  coverage per block: reviewed, skimmed (with reason), not reached. No unexplained gap. A chunk
  with nothing real says so; never manufacture a finding.
- Final commit `docs(v2.0): P168 Part 7 findings`, normal commit, hooks green, before any fixer
  starts.
- Then one Sonnet fixer: one commit per group of related findings, naming `P168 Part 7`. A fix
  re-runs `go build ./apps/kira-studio/...`, `go vet` and `go test -race` over the four Part 7
  Go packages, plus `SI/bridge`, `SI/storage/...` when a caller or contract changed; `bun test
  packages/api-core/test ST/unit/go-ts-vocabulary-parity.spec.ts` and the typecheck for any TS
  change; the shared corpus (`apivars/testdata/substitution.json`) gets a case for any grammar or
  transform fix, run by both `resolve_test.go` and `http-substitution.spec.ts`; `bun run setup`
  (bindings) and the UI subset (§0) when a bound shape changed. It deletes the findings file when
  done. Routed renderer halves go to `P168-routed-from-streamA.md` with exact file and change.
  Chunk lands per pre-plan §3.4 before Part 8's plan starts.

## 9. Candidate suspects (unconfirmed; verify, do not assume)

Raised during planning discovery. Each is a lead, not a finding.

1. `Options.normalize` (`options.go:75-90`): a negative `RequestTimeoutMs` or `MaxResponseMb`
   clamps to 0, which means "no timeout" and "unbounded body". A bad stored or sent value turns a
   safety cap off instead of falling back to the default.
2. `readResponseBody` (`client.go:433-447`) with `maxResponseBytes` 0 or up to 2 GiB reads the
   whole body into memory, then string, base64 and JSON copies: several GiB peak per send.
3. `DeleteJarCookie` (`cookies.go:104-163`) computes domain candidates from the raw
   `u.Hostname()`: an uppercase, IDN or trailing-dot host misses parent-domain entries that
   cookiejar stored under the lowercased punycode form, so Remove silently keeps the cookie.
4. `walkItems` (`parse.go:135`) re-decodes each nested `RawMessage` level and clones origin per
   node: super-linear time and memory on a deep or wide 64 MiB collection; no depth or item cap.
5. Errors raised before `httpclient.Send` builds its own `*Error` (resolveURL, prepareRequest,
   header validation) may quote the resolved URL or a header value; `maskSendErrTimeline` only
   masks `*httpclient.Error`. Check what reaches `mapHttpError` and the renderer.
6. `buildWireExchange` logs `dumpErr`/`bodyErr`/`headErr` with `slog.Warn` (`client.go:458-468`):
   an error string carrying a resolved URL or body fragment would land in the app log unmasked.
7. gRPC reflection `absorb`/`linker.link` accepts any number and size of files before any cap;
   `maxCachedDescriptorBytes` bounds only the cache. A hostile or huge reflection answer costs
   unbounded memory and CPU per `Describe`.
8. Server-streaming emits every message to the renderer (only stored messages are capped at
   100); a fast stream of 16 MiB messages floods the Wails event channel (`bridge/grpc.go`
   coalescer, `call.go:259+`).
9. `transforms` `upper`/`lower`: `golang.org/x/text/cases` (`language.Und`) versus JS
   `toUpperCase`/`toLowerCase` on `ß`, `İ`, final sigma; no corpus case found at plan time.
10. A resolved secret with `#`, `?`, `&` or CRLF substituted into a URL or header passes through
    `URLText`/`Text` raw (only unresolved spans are sanitised): query injection or request-line
    breakage, and its error text may echo the value.
11. `NormalizeTarget` passes `unix://` and `passthrough://` targets through; `dialConn` reads any
    `CAFile`. Weigh only against the first-party renderer trust model; report only if a
    non-renderer input (imported collection, saved gRPC request from another source) can set
    them.
12. Redirect header stripping compares hosts: a same-host port change (`:443` to `:8443`) or a
    case-only host difference may keep or strip user headers inconsistently (P108 F2/F3 fixed
    host and scheme; port untested).

## 10. Out of scope

- `SI/bridge` internals beyond how they call this chunk (Part 6, closed); `storage`, `secrets`,
  `localauth` internals (Part 2, closed) beyond the callee contract.
- `adapterhost` op scheduling (Part 5) beyond cancel reaching HTTP/gRPC sends.
- Root `internal/*` (Part 8, later): record only as a callee note when it breaks a Part 7
  contract.
- Frontend views and stores (Stream C: `SF/api/**`, `SF/views/{httprequest,grpcrequest,shared}/**`,
  `SF/state/**`): read only for reachability and mirrors; fixes tagged per §8.
- Parked design decisions and Known open items (§6).
- Generated Wails bindings (`SF/bindings`, gitignored), docs, excluded files (pre-plan §6).
