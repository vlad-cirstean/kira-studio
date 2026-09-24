# P108 Part 8 — review plan: Studio API client backend

Chunk A7, stream A position 7 (pre-plan §5.7). One Opus reviewer runs this plan and reports
findings. It fixes nothing. One Sonnet fixer then lands one commit per finding. Tree surveyed:
`1dbffa5` (Part 7 result recorded).

Paths repo-relative. `SI` = `apps/kira-studio/internal`, `SF` = `apps/kira-studio/frontend/src`,
`SD` = `packages/shared/domain`, `AC` = `packages/api-core`.

## 0. Method

- **`codegraph_explore`** for discovery, before any Read. Targets:
  - stage-2 substitution and masking: `apivars.Resolver`/`resolveWithSanitizer`/`ResolveRequest`,
    `bridge/http.go` `Send`/`secretReplacer`/`maskSecrets`/`maskSendErrTimeline`, `bridge/grpc.go`
    `resolveGrpcSource`/`resolveGrpcCallSource`/`maskGrpcError`/`maskGrpcResult`/`runServerStream`;
  - reveal: `apivars.Service.reveal` against `localauth.Gated`/`Authorizer`, `VariablesRepo.RevealValue`/
    `RevealHistoryValue`/`SecretsFor`/`mergeSecrets`;
  - gRPC descriptors: `grpcclient.resolveSource`/`cacheKey`/`InvalidateCache`/`descriptorCachePut`,
    `resolveReflection`/`linker.link`/`negotiateAndListServices`, `dialConn`, `Unary`/`ServerStream`;
  - HTTP send: `httpclient.Send`, `checkRedirectFor`/`sameRedirectHost`, `transportFor`, `jarFor`,
    `buildBody`/`buildFile`/`buildFormData`, `readResponseBody`, `timeline.go`, `wire.go`;
  - Postman: `postman.Parse`/`walkItems`/`checkSchemaVersion`/`Write`/`ShedOrigin`, `bridge/collections.go`
    `Import`/`Export`/`writeFileAtomically`, `CollectionsRepo.ImportTree`, `VariablesRepo.ImportVariables`;
  - api-core: `resolve`/`parseReference` (`AC/src/http/substitute.ts`), `applySecretValues`,
    `applyPipeline`, `parseCurl`/`toCurl`, `parseRawRequest`/`generateRawRequest`, `parseEnv`/`reconcileEnv`.
  Blast radius of any proposed fix is checked the same way.
- **Mirror check by reading both halves side by side**, not trusting the parity specs alone:
  `apivars/resolve.go` against `AC/src/http/substitute.ts` (shared fixture
  `SI/apivars/testdata/substitution.json`, read by `resolve_test.go` and
  `AC/test/http-substitution.spec.ts`); `apivars/transforms.go` against `AC/src/http/transforms.ts`
  (behavior, not just the name list); `httpclient` wire types against `SD/http.ts`; `grpcclient`
  types against `SD/grpc.ts`; `model.{ResponseHistory,GrpcCallHistory}*` against
  `SD/{response-history,grpc-history}.ts`; `model.Variable`/`Environment` against `SD/variables.ts`;
  `model.{Collection,CollectionItem,SavedRequest,SavedGrpcRequest}` against `SD/collections.ts`,
  `SD/http.ts`, `SD/grpc.ts`.
- **Scratch replicas** in the session scratchpad, never in the tree, where a claim depends on runtime
  behavior: `go test -overlay` against a local `httptest` server (redirect chains, echo endpoints,
  cookie jar), a local gRPC server with reflection (reuse `grpcclient/testserver_test.go`'s shape) for
  cyclic/oversized descriptor sets and slow reflection, `bun` one-liners for JS/Go transform
  divergence (`toUpperCase` vs `cases.Upper`, `btoa` on non-Latin-1), and crafted Postman files for
  import edge cases. Mark each claim "verified" or "not verified".
- **Prior decisions read first**, so an accepted trade-off is not re-reported as new:
  `docs/v1.2/plans/P11-grpc-support.md` §masking table (response message/trailer echo is P8 OQ-6's
  accepted open question), the `docs/ARCHITECTURE.md` gRPC/history sections, and `Known open items`
  (no API-client entry exists today). An accepted limitation that is still true but missing from
  `Known open items` is itself a finding (CLAUDE.md's rule), not a code fix.

## 1. Own file set

Production files first; tests are read where they are the package's own guard. About 5.6k Go
production lines, 3.9k Go test lines, 3.5k api-core source, 2.5k api-core test, 1.1k shared domain.
Matches pre-plan §4's ~17k.

- **`SI/httpclient`**: `client.go` (Send, `resolveURL`, `classifySendErr`, `sameRedirectHost`,
  `readResponseBody`, `buildWireExchange`), `options.go` (`normalize`, `transportFor`,
  `checkRedirectFor`), `body.go` (`buildBody` and the five mode builders, `validBodyModes`,
  `contentTypeByCodeLanguage`), `cookies.go` (shared jar, `jarFor`, `JarCookies`, `DeleteJarCookie`,
  `ClearJar`), `timeline.go` (hop trace, `maxHopHeaderBytes`), `wire.go` (rendered exchange,
  `maxWireBodyBytes`), `errors.go`. Tests: `{body,client,timeline,wire}_test.go`.
- **`SI/grpcclient`**: `descriptors.go` (types, process-global `descriptorCache`, `cacheKey`,
  `resolveSource`, `InvalidateCache`, `Describe`, `projectSchema`, `requestTemplate`,
  `resolveMethod`), `reflect.go` (v1/v1alpha transports, `negotiateAndListServices`,
  `retryOnTransportGlitch`, `resolveReflection`, `linker.link`), `proto.go` (`resolveProto`),
  `call.go` (`Unary`, `ServerStream`, `openStream`, `withMetadata`, `terminalOutcome`,
  `maxRecvMsgSize`, `maxStoredMessages`), `target.go` (`NormalizeTarget`, `dialConn`), `errors.go`.
  Tests: `{call,descriptor_cache,descriptors,target}_test.go`, `testserver_test.go`.
- **`SI/apivars`**: `vars.go` (`Service`, `Authorizer` seam, `New`), `reveal.go` (`Reveal`,
  `RevealHistory`, `reveal`), `resolve.go` (`ParseReference`, `Resolve`, `resolveWithSanitizer`,
  `Names`, `referencedFields`, `Resolver`, `UsedSecret`, `NewResolver`, `ResolveRequest`,
  `urlUnsafeReplacer`), `transforms.go` (`transformNames`, `ApplyPipeline`,
  `forgivingBase64Decode`). Test: `resolve_test.go`, `testdata/substitution.json`.
- **`SI/postman`**: `parse.go` (`Parse`, `maxCollectionBytes`, `checkSchemaVersion`, `walkItems`,
  `builderMethods`), `collection.go` (`Tree`/`Item`/`Variable`, warning kinds, decoders), `url.go`
  (`ImportURL`, `ImportParamDescriptions`), `body.go` (import/export body translation,
  `postmanCodeLanguages`), `aliases.go` (`aliasToFake` rewrite), `write.go` (`Write`, `buildItems`,
  `buildVariables`, `ShedOrigin` and its equality helpers). Tests: `aliases_test.go`,
  `parse_limit_test.go`, `roundtrip_test.go`, `write_test.go`, `testdata/*.json`.
- **`AC` (`packages/api-core`)**: `src/index.ts` (public surface), `src/http/{substitute,
  substituteRequest,transforms,escape,url,headers,body,saved,dotenv}.ts`, `src/http/curl/{detect,
  tokenize,flags,parse,generate}.ts`, `src/http/raw/{parse,generate}.ts`,
  `src/http/dynamic/{catalog,generators,fakerEntry}.ts`, `src/grpc/{metadata,saved}.ts`;
  `package.json` (deps `@faker-js/faker`, `shlex`), `tsconfig.json`, `README.md`. Tests:
  `test/{go-ts-api-parity,http-curl,http-curl-detect,http-dotenv,http-dynamic-fake,
  http-raw-generate-stored,http-raw-parse,http-substitution,http-url}.spec.ts`, `test/curl-cases.json`.
- **`SD`**: `http.ts` (wire interfaces, `HTTP_BODY_MODES`, `CODE_LANGUAGES`,
  `CONTENT_TYPE_BY_CODE_LANGUAGE`, `httpRequestTabStateSchema` with the legacy `json` preprocess),
  `collections.ts`, `grpc.ts` (`grpcRequestTabStateSchema`, wire types), `grpc-history.ts`
  (`GRPC_HISTORY_PER_SCOPE_LIMIT`), `response-history.ts` (`HISTORY_PER_SCOPE_LIMIT`),
  `variables.ts` (`VARIABLE_SCOPES`, `ApiVariable`).
- **Parity spec**: the SPEC row's `tests/unit/go-ts-vocabulary-parity.spec.ts` is
  **`apps/kira-studio/tests/unit/go-ts-vocabulary-parity.spec.ts`** (no repo-root `tests/unit`).
  What it actually checks: `model.RenderableTabKinds` against `STUDIO_RENDERABLE_TAB_KINDS`
  (`SF/state/tabDomain.ts`), `model.opKinds` against `opKindSchema` (`SD/ops.ts`),
  `repos/response_history.go` `historyPerScopeLimit` against `HISTORY_PER_SCOPE_LIMIT`, and
  `repos/grpc_history.go` `grpcHistoryPerScopeCap` against `GRPC_HISTORY_PER_SCOPE_LIMIT`. Its
  API-only siblings (body modes, content types, Postman code languages, transform names,
  dynamic-alias table) moved to `AC/test/go-ts-api-parity.spec.ts` (P12 D19) — reviewed here as
  part of `AC/**`. Only the two history-cap checks are API vocabulary; the tab/op-kind half is read
  for correctness of the extractor, its vocabularies belong to Parts 3/12.

## 2. One hop: callers

- **Bridge services (A6, closed; read for the seam, fixes under pre-plan §3.3 stay in stream A):**
  - `SI/bridge/http.go` `HttpService.Send` into `apivars.Service.ResolveRequest` then
    `httpclient.Send`; `Cookies`/`DeleteCookie`/`ClearCookies` into `JarCookies`/
    `DeleteJarCookie`/`ClearJar`; `secretReplacer`/`maskSecrets`/`maskSendErrTimeline` consume
    `apivars.UsedSecret`; `mapHttpError` consumes `httpclient.Error`.
  - `SI/bridge/grpc.go` `GrpcService.Describe` into `apivars.Service.NewResolver`/`Resolver.Text`,
    `grpcclient.InvalidateCache`/`Describe`; `Call` into `grpcclient.Unary`/`ServerStream` (via
    `serverStreamFn`); `recordGrpcHistory`, `maskGrpcError`/`maskGrpcResult`, `mapGrpcError`.
  - `SI/bridge/variables.go` `Reveal`/`RevealHistory` into `apivars.Service`; every other method
    wraps `repos.VariablesRepo` directly (Part 3's repo).
  - `SI/bridge/collections.go` `Import` into `postman.Parse`, `CollectionsRepo.ImportTree`,
    `VariablesRepo.ImportVariables` (compensating `Collections.Delete` on failure); `Export` into
    `CollectionsRepo.LoadTree`, `postman.Write` under `writeFileAtomically`. Guards:
    `collections_{import,export}_atomicity_test.go`.
  - `SI/bridge/{grpchistory,responsehistory}.go`: thin `List`/`Get`/`Delete`/`Clear`/`Adopt` over
    Part 3's repos; they carry the `SD/*-history.ts` wire shapes.
- **Storage repos calling into this chunk:** `repos/collections.go` `shedOriginJSON` into
  `postman.ShedOrigin` (4 callers), `ImportTree`/`LoadTree` over `postman.Tree`;
  `repos/variables.go` `ImportVariables` over `postman.Variable`; `repos/response_history.go`
  stores `httpclient.Response`.
- **Composition root:** `apps/kira-studio/main.go` `apivars.New(repositories.Variables, cipher,
  authorizer)` with the single `localauth.New` authorizer shared with `connections.Service`.
- **Renderer (A8, next; read only to decide reachability):**
  - `SF/bridge/apiControl.ts` (every bound API/variables/collections/history call; `trust<T>()`, no
    zod parse on results).
  - `AC` importers: `SF/api/{state/curl.ts,state/raw.ts,state/variables.ts,BulkVariablesEditor.vue,
    ImportCurlDialog.vue,CopyAsCurlDialog.vue,…}` (3+3 files), `SF/views/httprequest/**` (6),
    `SF/views/grpcrequest/**` (3), plus two outside Part 9: `SF/state/tabKinds.ts` (Part 12) and
    `SF/views/shared/request/resolve.ts` (Part 10, stage 1's own caller of `resolve`).
  - `SD` importers are Studio-only (`SF/api/**`, `SF/views/{httprequest,grpcrequest}/**`,
    `SF/state/{tabDomain,tabKinds}.ts`, `SF/bridge/apiControl.ts`, `AC/src/**`, and
    `apps/kira-studio/tests/unit/{api-*,grpc-*,go-ts-vocabulary-parity}.spec.ts`).
  - `SF/api/state/curl.ts` is `applySecretValues`' only caller (Copy-as-curl reveal path) — its
    name-to-variable precedence must match Go's `SecretsFor`.

## 3. One hop: callees (settled, Parts 2-3)

- `repos.VariablesRepo`: `SecretsFor`/`mergeSecrets` (collection then environment, first-wins by
  `sort_order` within a scope, undecryptable rows skipped with a warn), `RevealValue`,
  `RevealHistoryValue`, `ImportVariables`, `ApplyBulk`.
- `repos.CollectionsRepo.ImportTree` (one transaction), `Delete` (`ON DELETE CASCADE`).
- `repos.{ResponseHistory,GrpcHistory}.Record` (per-scope cap 30, `maxHistoryBodyBytes` 256 KiB
  byte-slice truncation, global byte budgets).
- `secrets.Cipher` (`ScopeVariable` AAD), `localauth.Authorizer`/`Gated` (5-minute shared grace).
- `adapterhost.Host().RunOp` (op-log `command`, `Incognito`), `adapters.OpCtx.SetCommand`.
- `internal/{ipcerr,kiratime,sqlitex}` (A1).
- Third-party: `net/http`, `net/http/cookiejar`, `httputil.DumpRequestOut`, `google.golang.org/grpc`
  (+ `reflection/grpc_reflection_v1{,alpha}`), `protobuf` (`protodesc`, `protoregistry`,
  `dynamicpb`, `protojson`), the `.proto` compiler behind `resolveProto`, `golang.org/x/text/cases`;
  TS `@faker-js/faker` 10.6.0, `shlex` 3.0.0.

## 4. Edge cases to weight

Security first: this chunk is where a user's secret variable becomes wire bytes.

1. **Secret isolation across scopes and requests.**
   - `ResolveRequest`/`NewResolver` trust the renderer's `CollectionID`/`EnvironmentID`. Check what a
     tab sends after its item is moved, duplicated or deleted, or when an unsaved tab carries a stale
     collection id. Can collection A's secrets resolve into a request that no longer belongs to A?
   - Precedence mismatch: when the environment's same-named secret is undecryptable or has a NULL
     `secret_value`, `mergeSecrets` skips it and the collection's secret silently wins. The renderer
     marked the name `deferred` on the environment's behalf. Same question for a plain-over-secret
     duplicate within one scope, where Go queries `is_secret = 1` only.
   - Copy-as-curl: `applySecretValues` fills names from renderer-side reveals. Does the renderer pick
     the same variable id that Go's precedence would? A mismatch copies a different credential than
     Send would use.
   - Two-stage expansion: stage 1 writes a plain value verbatim, so a plain value containing
     `{{secretName}}` is expanded by stage 2. That contradicts `Resolve`'s "one pass only" claim.
     Decide whether this is intended (Postman nests), whether the renderer preview agrees, and
     whether masking still covers it.
2. **Masking completeness (stage-2 output to every copyable or persisted surface).**
   - `secretReplacer` registers `Rendered`, `QueryEscape` and `PathEscape` forms. Look for re-encodings
     it misses:
     - a secret inside multipart form-data;
     - a JSON-escaped form (a secret containing `"`/`\` in a gRPC message or `code` body);
     - header-value normalization;
     - a `Location` built with a different escape;
     - `Timeline` `maxHopHeaderBytes` truncation cutting a secret mid-span, which leaves a prefix
       no pattern matches;
     - `maxWireBodyBytes` elision cutting one the same way.
   - Short secrets (1-3 chars) over-masking unrelated text: accepted by design (D6); only report if
     it corrupts a structural surface.
   - `Wire.MaskedSecrets` count against what is actually masked.
   - `resp.Body` and gRPC `Messages[].JSON` are never masked (P8 OQ-6 / P11 table, accepted). Confirm
     the decision still holds now that history persists them to `kira.sqlite`, and whether it
     belongs in `Known open items`.
   - `JarCookies` returns jar values unmasked over the bridge. Check whether a server-set cookie
     echoing a request secret can reach the Cookies pane.
3. **Secret injection into structured text.** Stage 2 substitutes verbatim, with no context-aware
   escaping. Weigh a secret containing `"` in:
   - a gRPC `MessageJSON` (can inject protobuf fields, or break the parse and leak the error line
     into `BadRequest` text: is that masked?);
   - a JSON `code` body;
   - a header value containing CR/LF (net/http rejects it; check that the resulting error text is
     masked);
   - a gRPC metadata value (`withMetadata` validation error text).
4. **Redirects carrying credentials.**
   - `checkRedirectFor` strips user headers on a host change only. `sameRedirectHost` treats a
     subdomain as same-host and ignores the scheme. An `https` to `http` downgrade on the same host
     keeps `Authorization` and every custom secret header in cleartext.
   - 307/308 re-send the body (possibly secret-bearing) cross-host via `GetBody`.
   - A→B→A: headers deleted at B stay deleted on the return hop. Correctness, not security.
5. **Cookie jar isolation.** One process-wide jar (P90 item 1). It is host-keyed, so two
   environments on the same host share session cookies by design. Check:
   - incognito's throwaway jar against `DisableCookieJar` precedence;
   - `ClearJar` racing an in-flight send;
   - `DeleteJarCookie` for host-only against domain cookies and path mismatch (expiry `Set` with a
     different path is a no-op).
6. **gRPC descriptor cache and schema supersession.**
   - `resolveSource` has no singleflight and no generation. `Describe(reload)` runs
     `InvalidateCache` and then resolves, while an older in-flight resolve can `Put` the pre-reload
     registry back after it. A concurrent `Call` can do the same. Result: stale schema after an
     explicit Reload.
   - Two concurrent misses on one key double-fetch and double-count `totalBytes` on replace.
     `Put` handles replace; verify the arithmetic.
   - `cacheKey` drops metadata values (finding 12). A reflection server that scopes its schema per
     tenant or auth token serves tenant A's schema to tenant B under the same header name. Weigh
     against the documented reason.
   - Proto mode is keyed on path, not content or mtime. An edited `.proto` is stale until Reload
     (documented D4). Check whether import-path order or symlinks give two keys for one file.
   - A server whose schema changed under a cached descriptor: `Call` marshals with stale field
     numbers and silently sends wrong bytes. No error path invalidates. Weigh an
     invalidate-on-`Unimplemented`/decode-error rule against "no timer" (D4).
   - `maxCachedDescriptorBytes` is approximate (re-marshal). A single oversized entry is kept alone
     by design.
7. **Reflection against an untrusted server.**
   - `linker.link` marks `linked` only after its deps link. A cyclic `dependency` list (illegal, but
     server-controlled) recurses without bound, and a Go stack overflow is fatal and unrecoverable.
     It kills the whole app. Verify with a scratch server.
   - Unbounded fan-out of `FileByFilename` fetches.
   - `negotiateAndListServices` retry bounds.
   - `Describe` does not go through `RunOp`. Check whether its ctx carries any deadline. A server that
     accepts the stream and never answers may hang the call forever with no Stop.
   - Reflection responses have no receive-size cap of their own (gRPC default 4 MiB, against
     `maxRecvMsgSize` 16 MiB for calls).
8. **gRPC call lifecycle.**
   - `ServerStream` cancel mid-stream: `Partial` counts, `maxStoredMessages` 100 against the true
     `MessageCount`, and history recorded exactly once (finding 6's guard).
   - Coalescer finish ordering against `recordGrpcHistory`.
   - `terminalOutcome` mapping `Unavailable` to a transport error vs a status result.
   - `unmarshalRequestJSON` unknown-field rejection.
   - `EmitUnpopulated`/`DiscardUnknown` on the response.
   - A client-streaming or bidi method selected: refused cleanly?
   - `NormalizeTarget` over `unix:`/`dns:`/IPv6 literals.
   - TLS: `CAFile` unreadable, `ServerName` override. `InsecureSkipVerify` must be unreachable.
9. **HTTP send bounds and errors.**
   - `MaxResponseMb` `0` means unbounded `io.ReadAll`. Reachable from Settings?
   - A timeout of 0 means none.
   - `buildFile`/`buildFormData` Stat-then-Open TOCTOU and a file changing size mid-send (exact
     `ContentLength`, never chunked, F5); `GetBody` reopen on redirect.
   - `resolveURL`'s https default and a scheme-less `localhost:8080` (parses as scheme `localhost`?).
   - `classifySendErr`: timeout vs cancel.
   - `DumpRequestOut` not firing the real trace.
   - Every error message path that embeds the resolved URL goes through `maskSendErrTimeline`
     (`resolveURL` parse error, transport error, `Hops[].Error`).
10. **Reveal gate (Part 8's half).**
    - `apivars.reveal` logs subject and id, never the value. `GateFetchError` returns `err.Error()`
      to the renderer: check that `RevealValue`'s error text never contains ciphertext or plaintext.
    - `Reveal` on a non-secret or a deleted id.
    - `RevealHistory` for a history row whose variable was flipped secret to plain or deleted (the
      purge-on-flip is Part 3's; check the reveal side).
    - The grace is shared with connection reveals by design (D8). Do not re-report it.
11. **Go/TS substitution and transform parity.**
    - `substitution.json` must be read by both runners. Confirm no test case is filtered on one side.
    - Transform behavior, not names: `upper`/`lower` (`String.prototype.toUpperCase` against
      `cases.Upper(language.Und)`: `ß`, final sigma, Turkish dotless i);
    - `base64decode` (`atob` forgiving-base64 against `forgivingBase64Decode`: whitespace set, `=`
      mid-string, non-canonical trailing bits);
    - `urlencode` (`goQueryEscapeLiteral` against `url.QueryEscape` on astral characters and lone
      surrogates, which JS can hold and Go cannot);
    - `urldecode` (`+` handling, malformed `%`).
    - A divergence means the preview shows one value and the wire sends another. Stage 1 is TS for
      plain values, stage 2 is Go for secrets.
12. **Postman import atomicity and format.**
    - `ImportTree` is one transaction. `ImportVariables` is a second transaction with a
      compensating `Delete`. Check that path when `Delete` also fails (the collection stays visible
      while the call reports failure), a concurrent edit landing between the two commits, and
      `sort_order` races between two concurrent imports.
    - Format edge cases:
      - `schema` absent or unrecognised (`checkSchemaVersion` lets an unknown future `v3` through);
      - `url` as a string vs an object without `raw`;
      - `variable[].value` as a non-string (number, bool, object);
      - `type: "secret"` variables (`postman.Variable.Secret` reaches `ImportVariables`, which
        fails the whole import when secret storage is unavailable; check the user-facing message);
      - `disabled` variables, duplicate names;
      - `description` as `{content,type}`;
      - `key` vs `name`;
      - deep nesting (Go's decoder caps at 10k depth; `walkItems` recursion);
      - 64 MiB cap (`maxCollectionBytes`) with a `cloneOrigin` copy per node, so peak memory is a
        multiple of the file.
    - **Plaintext credentials in `origin_json`.** Inert `auth` blocks (collection, folder, item)
      and folder- or item-level `variable[]` arrays, including `type: "secret"` ones, stay in
      `origin_json` as plaintext in `kira.sqlite`. They are re-emitted verbatim on export, while
      `ExportReport.SecretCount` tells the user secrets were written valueless. Check against Part
      3's "plaintext that escapes the cipher" rule.
    - `aliases.go` rewrites `{{$guid}}` to `fake.*` on import. Is export reverse-mapped? If not, a
      round-trip file no longer works in Postman. Also check which fields the rewrite touches
      (variable values? origin?).
    - `ShedOrigin` equality helpers against `importRequest`'s alias rewrite: does an untouched
      imported request shed its origin because the comparison sees rewritten vs raw text?
13. **Postman export.**
    - `writeFileAtomically`: the temp file sits beside the destination. Check permissions of the
      new file vs the replaced file's mode, a symlinked destination (rename replaces the link
      itself), and Windows is not a target (ARCHITECTURE).
    - A gRPC item is skipped and counted. A folder holding only gRPC items is emitted empty?
14. **api-core parsers over pasted, attacker-shaped input.**
    - `parseCurl`:
      - `-u` uses `btoa(v)`, which throws on a non-Latin-1 character. It also encodes Latin-1
        code points as single bytes, where curl sends UTF-8.
      - `-u user` without a colon.
      - `-u '{{user}}:{{pass}}'` gets base64'd at import, which permanently defeats substitution.
      - ANSI-C `$'…'` quoting, CRLF line continuations, `shlex` edge cases.
      - `@file`/`<file` refusals across every data flag and `-T` (P21 round 2 finding 1; confirm no
        flag was missed: `--data-urlencode name@file`, `--json @file`, `-K` config).
    - `parseRawRequest`: header folding, a missing blank line, `Host` vs absolute-form request line.
    - `parseEnv`/`reconcileEnv`:
      - `SECRET_MARKER` round trip;
      - a secret row with `KEY=` must leave the stored secret untouched (D22 rule 3), and Go's
        `ApplyBulk` must agree;
      - duplicate-key positional matching;
      - `export ` prefix, CRLF.
    - `toCurl`/`generateRawRequest`: shell quoting of values containing `'`, newlines and NUL.
      Masked `{{name}}` stays literal.
15. **History storage (this chunk owns the TS mirrors).**
    - Both caps are 30 in code. `docs/ARCHITECTURE.md`'s gRPC history paragraph still says "the
      same 20-per-scope trim". Doc drift.
    - Byte-slice truncation at 256 KiB can split UTF-8 and leaves truncated JSON in a gRPC
      message (the `truncated` flag exists; check that the renderer never `JSON.parse`s it
      unguarded, reading Part 9 only).
    - Stage-1 request persisted, never stage 2 (F3). Confirm on every record path, including
      `Partial`.
    - Incognito skips both `Record`s. Check that `op.SetCommand`'s unresolved command still reaches
      `op_log` for an incognito tab (RunOp's own rule, Part 6).
16. **Parity-spec robustness.** `extractGoStringSet`/`extractGoStringMap` end the literal at the
    first `}`, count a commented-out `"x": true` line, and ignore `false` entries.
    `extractGoIntConst` matches the first `name = N` anywhere in the file. A future edit to any of
    these Go literals can pass the spec while drifting. Weigh whether the extractor needs hardening
    or a sanity assertion (for example, a non-empty set).

## 5. Watch items (pre-plan §5.7, expanded)

- **Variable reveal grace and secret isolation:** §4.1, §4.10. The shared grace is intended (D8).
  Isolation is about which scope's secret resolves, and whether the renderer and Go agree on it.
- **Postman import atomicity:** §4.12 (two-transaction import with compensating delete;
  `bridge/collections_import_atomicity_test.go` is the guard), plus the `origin_json` plaintext
  finding candidate.
- **gRPC reflection and schema supersession:** §4.6 (Go-side stale `Put` after Reload; the renderer
  guard in `SF/views/grpcrequest/state.ts` `loadSchema`, pinned by
  `tests/unit/grpc-schema-supersession.spec.ts`, is Part 9's), §4.7 (cyclic reflection deps).
- **Go/TS history vocabulary parity:** §1's parity spec and §4.16; history caps §4.15.
- Masking surfaces added since P9: cookies (P90), timeline hops (P10), gRPC success path (P21 r2).
  Each masking helper lives in `bridge/*.go` (Part 7, closed). A fix there is a stream-A edit under
  §3.3.
- `apivars` must not import `connections` or Wails (package doc D8/D19). Check import lines.

## 6. Out of scope

- **Generated code:** none of pre-plan §6's exclusions (`SI/page/wire`,
  `packages/shared/protocol/wire`, `PI/gitwire`, `packages/git-ipc/src/generated`,
  `frontend/bindings`) intersects this chunk's own file set. `frontend/bindings` sits only on the
  caller side (§2) and is not read. The reflection packages under `google.golang.org/grpc` are
  third-party, not reviewed.
- **Part 9's frontend:** `SF/api/**`, `SF/views/{httprequest,grpcrequest}/**` and their
  `tests/unit`/`tests/ui` specs. These are read only to decide reachability or Go/TS agreement.
  Renderer-side reveal expiry (`createRevealExpiry`), TanStack Query keys and the `loadSchema`
  generation guard are Part 9's.
- **`SF/views/shared/request/resolve.ts`** (Part 10) and `SF/state/{tabKinds,tabDomain}.ts`
  (Part 12). Read only as `AC`/`SD` callers.
- **Part 3's repos** (`SecretsFor`, `ImportTree`, history `Record` trims) and **Part 7's bridge
  masking helpers.** Both are closed. Report a defect found there with its file, but review only
  their contract with this chunk.
- **Tab/op-kind vocabularies** in the parity spec (Parts 3/12). Only the extractor itself is
  reviewed here.
- P110's `--color-muted` collision.
