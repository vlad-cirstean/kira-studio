# P108 Part 8 findings: Studio API client backend

Review of `apps/kira-studio/internal/{httpclient,grpcclient,apivars,postman}`, `packages/api-core/**`,
and the 6 `packages/shared/domain` files, against plan `P108-part8-studio-api-client-backend.md` (§4
edge cases first, then §1 sweep). `docs/ARCHITECTURE.md` Known open items had no API-client entry, so
nothing below re-reports a documented limitation.

"Verified" means reproduced with a scratch test (Go `-overlay` or bun) kept outside the tree.
"Code-read" means traced through source only. Order is by severity.

## F1: cyclic proto dependency from reflection server crashes whole app

- `apps/kira-studio/internal/grpcclient/reflect.go:301-335` (`linker.link`). `l.linked[path]` is set
  only at line 333, after the recursive dependency walk. No in-progress set exists.
- Bug: a reflection server that returns `a.proto` importing `b.proto` and `b.proto` importing
  `a.proto` sends `link` into unbounded recursion. Result: `fatal error: stack overflow` (goroutine
  stack exceeds 1000000000-byte limit). A Go stack overflow is not recoverable, so the whole Kira
  Studio process dies.
- Reachability: any gRPC Describe or Call against a server the user points at. Server controls the
  descriptors, so a buggy or hostile server kills the app. Verified.
- Fix: keep an `inProgress` set on `linker`. Mark `path` before recursing into its deps and unmark it
  after. When `link` re-enters a path still in progress, return a `BadRequest`-class error naming the
  cycle (`a.proto -> b.proto -> a.proto`). Consider also capping total files fetched per resolution.

## F2: secret headers re-sent after redirect A to B to B

- `apps/kira-studio/internal/httpclient/options.go:167`. The check compares
  `via[len(via)-1].URL` against `req.URL` only.
- Bug: net/http's `makeHeadersCopier` recopies the initial request's headers on every hop. Only its
  own Authorization/Cookie stripping is sticky. On A to B (cross-host) this code strips user headers,
  but on the next hop B to B the previous hop is the same host, so nothing is stripped. The original
  headers, secrets included, reach B.
- Reachability: any request with a secret-bearing custom header (`X-Api-Key: {{token}}`) whose
  server redirects off-host and then redirects again within the new host. Verified: header absent at
  `B/x`, `s3cret` present at `B/y`.
- Fix: compare against the original request, `via[0].URL`, not the previous hop. Once any hop has
  left the origin host, strip on every later hop too.

## F3: https to http same-host redirect keeps secret headers

- `apps/kira-studio/internal/httpclient/client.go:101-107` (`sameRedirectHost`), used by
  `options.go:167`.
- Bug: `sameRedirectHost` compares hostnames only. An `https://api.example` to
  `http://api.example` redirect counts as same host, so user headers are kept. net/http keeps
  `Authorization` on a same-host downgrade too. Secrets go out over plaintext.
- Reachability: any server (or a network attacker able to inject a 30x on the first hop's response
  path) that redirects to the http scheme. Verified: `X-Api-Key` and `Authorization: Bearer tok`
  both arrive on the http hop.
- Fix: treat a scheme downgrade (https to http) as a cross-origin hop in `checkRedirectFor`. Strip
  the user header names and delete `Authorization` and `Cookie` explicitly on that hop.

## F4: gRPC Describe has no deadline and no cancel path

- `apps/kira-studio/internal/bridge/grpc.go:139-165` (`Describe`) calls
  `grpcclient.Describe(ctx, src)` directly, not through the RunOp/Stop path.
- `apps/kira-studio/internal/grpcclient/reflect.go:234-289` (`resolveReflection`). No
  `context.WithTimeout`/`WithDeadline` exists anywhere in `internal/grpcclient`.
- `apps/kira-studio/frontend/src/bridge/apiControl.ts:110-121` (`grpcDescribe`) never cancels.
- Bug: a server that accepts the reflection stream and never answers leaves Describe blocked
  forever. The goroutine and connection leak, and the UI spinner never ends. Each retry adds another
  leaked call.
- Reachability: any unresponsive or overloaded reflection endpoint. Code-read.
- Fix: bound reflection with `context.WithTimeout` inside `resolveReflection` (reuse the call's
  configured timeout, or a fixed default). Alternatively route Describe through RunOp so Stop
  cancels it.

## F5: undecryptable or NULL env secret falls through to another scope's secret

- `apps/kira-studio/internal/storage/repos/variables.go:1105-1113` (`mergeSecrets`, used by
  `SecretsFor`).
- Bug: `seen[name] = true` is set only after a successful decrypt. A NULL row, or a row whose
  decrypt fails, `continue`s first. The next row with the same name (the collection's secret, or a
  lower scope) then wins. Send silently uses a different scope's value.
- Mismatch: `frontend/src/api/state/curl.ts:247-261` (`findSecretVariableId`) picks the first env
  secret row by name. Its reveal fails, so Copy-as-curl leaves `{{name}}` literal while Send used
  the collection value.
- Reachability: key rotation or a corrupted ciphertext on an env-scope secret that shadows a
  same-named collection secret. Code-read.
- Fix: mark `seen[name] = true` before the validity/decrypt checks, so a failed shadowing row still
  shadows. Leave the reference unresolved (literal) and keep the existing `slog.Warn`.

## F6: plain value containing `{{secretName}}` is expanded by stage 2

- `apps/kira-studio/internal/apivars/resolve.go:97-107` (`Resolve` doc says "One pass only") and
  `resolve.go:398-471` (`ResolveRequest`).
- Bug: stage 1 (TS `resolve`) substitutes a plain value verbatim. If that value itself contains
  `{{apiKey}}` and `apiKey` is a secret, stage 2 rescans the stage-1 output and expands it. That is
  a second pass, contradicting the "One pass only" contract. Stage 1 never reports the nested name as
  deferred, so `applySecretValues`
  (`packages/api-core/src/http/substituteRequest.ts:57-68`) cannot reveal it. Copy-as-curl and the
  preview show `{{apiKey}}` while Send sends the secret.
- Reachability: any plain variable whose value holds a secret reference, e.g. an env var
  `auth = Bearer {{apiKey}}`. Code-read.
- Fix: pick one semantics and apply it on both sides. Either stage 2 resolves only the names stage 1
  reported as deferred (positions recorded by stage 1, so pasted `{{...}}` text in plain values stays
  literal), or stage 1 recurses into plain values and reports nested secret names as deferred. Update
  the `Resolve` doc comment to match.

## F7: Postman object-form `{{$alias}}` rewrite breaks untouched round trip and ShedOrigin

- `apps/kira-studio/internal/postman/write.go:116,126,134` (`buildRequest`) and `write.go:214,218,221`
  (`ShedOrigin`).
- Bug: import rewrites `{{$guid}}`-style aliases to `{{fake.*}}` (`aliases.go:127`
  `rewriteRequestAliases`, called at `parse.go:227,252`). The comparisons re-run `ImportURL`,
  `importHeaders` and `importBody` on origin *without* that rewrite. So an untouched request with an
  alias in object-form url/header/body always compares unequal. Export writes a fresh member with
  `{{fake.string.uuid}}` instead of the origin bytes, and `ShedOrigin` drops those members from
  origin on first save. `aliases.go:117-120` claims byte-for-byte export for untouched requests;
  true only for the string-form request.
- Reachability: import any Postman collection using `{{$guid}}`, `{{$timestamp}}` etc. in an
  object-form request, then export without edits. Verified: exported file has `$guid` absent and
  `fake.string.uuid` present; after `ShedOrigin`, request origin kept only `{auth, method}`.
- Fix: apply the same alias rewrite to the re-imported origin member before comparing, in both
  `buildRequest` and `ShedOrigin`. Share one helper so the two cannot drift.

## F8: plaintext auth and folder/item secrets kept in origin_json and re-exported

- `apps/kira-studio/internal/postman/parse.go:38-83` (`Parse` deletes only `item`/`variable` from
  collection origin) and `parse.go:130-179` (`walkItems` keeps folder/item `auth`, `variable[]` and
  `request.auth`).
- `apps/kira-studio/internal/storage/repos/collections.go:538-603` (`ImportTree`) stores
  `origin_json` as plaintext.
- `apps/kira-studio/internal/bridge/collections.go:374-420` (`ExportReport`/`Export`):
  `SecretCount` counts only collection-level secret variables.
- Bug: collection/folder/request `auth` blocks (bearer tokens, API keys, passwords) and folder/item
  `variable[]` entries of `type: "secret"` stay in `origin_json` unencrypted in kira.sqlite. Export
  re-emits them verbatim, while collection-level secrets are blanked (D16). The export report's
  secret count tells the user nothing about these. The import warning at `collections.go:254` says
  the auth block "is kept but not applied", but not that it stays plaintext and gets re-exported.
- Reachability: import any collection with auth set. Verified: collection token, folder secret
  variable, folder API key and request password all appear verbatim in the exported file.
- Fix: at import, strip `auth` values (or whole `auth` members) and blank secret-typed
  folder/item variable values before storing origin. Alternatively keep them and blank on export. In
  either case include those entries in `SecretCount`/the report and reword the import warning.

## F9: curl `-u` import throws, mis-encodes, or destroys variable references

- `packages/api-core/src/http/curl/parse.ts:317-324`: `pushHeader(acc, 'Authorization',
  \`Basic ${btoa(v)}\`)`.
- Bugs (verified with bun):
  - `-u 'user:pa€ss'`: `btoa` throws `InvalidCharacterError`. `parseCurl` (`parse.ts:643`) is
    documented "never throws", so the import preview/submit path in `frontend/src/api/state/curl.ts`
    (`previewCurl`, `submitImportCurl`) and `applyCurlToTab` hit an uncaught error.
  - `-u 'user:pässwörd'`: `btoa` encodes Latin-1 (`dXNlcjpw5HNzd/ZyZA==`). curl sends UTF-8
    (`dXNlcjpww6Rzc3fDtnJk`). Wrong credentials, silently.
  - `-u '{{user}}:{{pass}}'`: base64 of the literal braces (`e3t1c2VyfX06e3twYXNzfX0=`). The
    variable references are destroyed.
- Fix: encode with `TextEncoder` then base64 (UTF-8, never throws). When the value contains `{{`,
  emit the header through the existing transform pipe instead (`Basic {{... | base64}}`-style, if
  the pipe grammar supports a composite), or keep the raw value and push a parse warning.

## F10: `--json @file` imported as literal body with no warning

- `packages/api-core/src/http/curl/parse.ts:333-337` (`case 'json'`) pushes
  `{id: 'data-raw', text: v}` unconditionally.
- Bug: `--json @body.json` means "read body from file" in curl. Import stores the literal text
  `@body.json` as the body, with no warning. The `--data` family handles `@` (check path/warn);
  `--json` does not.
- Reachability: any pasted curl command using `--json @file`. Verified.
- Fix: route `--json` through the same `@`-prefix handling as `--data` (same warning or file-body
  mapping), keeping the JSON content-type/accept headers it adds.

## F11: descriptor cache stale Put after Reload, plus duplicate fetches

- `apps/kira-studio/internal/grpcclient/descriptors.go:261-284` (`resolveSource`: Get, resolve,
  Put) and `descriptors.go:289-298` (`InvalidateCache`). Caller `bridge/grpc.go:139-165` invalidates
  on Reload.
- Bug: no generation counter and no singleflight. A resolution already in flight when the user hits
  Reload finishes after `InvalidateCache` and Puts the old descriptors back. Reload then shows stale
  schema. Two concurrent calls for the same key both fetch.
- Reachability: Reload while a Call or Describe is still resolving the same target. Code-read.
- Fix: add a per-key (or global) generation counter bumped by `InvalidateCache`. `resolveSource`
  captures it before resolving and skips the Put when it changed. Use
  `golang.org/x/sync/singleflight` to collapse concurrent resolutions of one key.

## F12: wire-log truncation can leave an unmasked secret prefix

- `apps/kira-studio/internal/httpclient/wire.go:20,53-58` (`capWireText` byte-slices to
  `maxWireBodyBytes` = 128 KiB) runs before masking in `apps/kira-studio/internal/bridge/http.go:302`
  (`maskSecrets`, applied to `Wire.Request`).
- Bug: if a secret value straddles the 128 KiB cut, the kept prefix no longer matches the full
  secret, so the replacer leaves it in clear. The byte slice can also split a UTF-8 rune.
- Reachability: request body over 128 KiB with a substituted secret near the boundary. Code-read.
- Fix: mask the full text before capping (move the cap after `maskSecrets`, or have `capWireText`
  take the replacer). Cut on a rune boundary.

## F13: protojson parse error can echo part of a secret

- `apps/kira-studio/internal/grpcclient/call.go:53-64` (`unmarshalRequestJSON`) returns
  `BadRequest(err.Error())`. Masking happens in `bridge/grpc.go:485-504` (`maskGrpcError`).
- Bug: protojson's syntax error quotes the offending token slice. When a substituted secret breaks
  JSON (e.g. contains `"`), the quoted slice is a fragment of the secret, which the full-value
  replacer cannot match. The fragment reaches the UI and error text.
- Reachability: request JSON with `{{secret}}` whose value contains a quote or backslash. Code-read.
- Fix: when the request used any secret, replace unmarshal error text with a generic "request JSON is
  invalid after variable substitution" plus position only, or validate JSON before stage-2 secret
  substitution so the error text never contains secret bytes.

## F14: Go `base64decode` accepts `"YQ="`, TS `atob` rejects it

- `apps/kira-studio/internal/apivars/transforms.go:52-72` (`forgivingBase64Decode`) vs
  `packages/api-core/src/http/transforms.ts:48-57`.
- Bug: Go pads any input with `len % 4` of 2 or 3 without first stripping or rejecting existing `=`.
  So `"YQ="` pads to `"YQ=="` and decodes to `a`. WHATWG forgiving-base64 (and `atob`) rejects it.
  The comment claims "matching the WHATWG algorithm exactly". Preview (TS) errors, Send (Go)
  succeeds.
- Reachability: `{{x | base64decode}}` on a value with wrong padding. Verified.
- Fix: follow WHATWG steps: strip ASCII whitespace, if `len % 4 == 0` remove one or two trailing
  `=`, then fail if `len % 4 == 1` or any `=` remains, then decode unpadded
  (`base64.RawStdEncoding`). Add the case to the shared parity corpus.

## F15: ARCHITECTURE.md drift (history cap, ResponseHead masking)

- `docs/ARCHITECTURE.md:1201` says "the same 20-per-scope trim". Code is 30:
  `repos/response_history.go:22` (`historyPerScopeLimit = 30`), `repos/grpc_history.go:21`
  (`grpcHistoryPerScopeCap = 30`).
- `docs/ARCHITECTURE.md:1952` says the replacer applies "to `Wire.Request` only — never
  `Wire.ResponseHead`". `bridge/http.go:302-341` (`maskSecrets`) masks `ResponseHead` too.
- Fix: change 20 to 30 and reword the masking paragraph to match `maskSecrets`.

## F16: unmasked response bodies, gRPC messages and jar cookies missing from Known open items

- `apps/kira-studio/internal/bridge/http.go:302-341` never masks `resp.Body`. `bridge/grpc.go:513-525`
  (`maskGrpcResult`) does not mask `Messages[].JSON`. `Cookies` bridge (~`http.go:203`) returns
  `JarCookies` unmasked.
- Accepted by design (P8 OQ-6, P11), but these values are persisted to kira.sqlite history in clear.
  A server echoing a secret stores it in plaintext. This is a real, current limitation absent from
  `docs/ARCHITECTURE.md` Known open items.
- Fix: add a Known open items entry stating response bodies, gRPC response messages and jar cookies
  are stored unmasked in history.

## F17: Go/TS parity extractors are fragile (latent)

- `packages/api-core/test/go-ts-api-parity.spec.ts:21-49` and
  `apps/kira-studio/tests/unit/go-ts-vocabulary-parity.spec.ts:26-45`.
- Bugs: `source.indexOf('}', bodyStart)` ends the map body at the first `}`, which a `}` in a
  comment or string would cut short. The `"x": true` regex also counts commented-out entries.
  `extractGoIntConst` matches the first `name = N` anywhere, comments included. All current
  literals parse correctly, so no false result today.
- Fix: strip `//` comment text per line before matching, end the body at the brace that closes the
  map (depth count), anchor the const regex to a non-comment line, and assert the extracted set is
  non-empty.

## F18: export file write replaces mode and symlinks (low)

- `apps/kira-studio/internal/bridge/collections.go:339-366` (`writeFileAtomically`).
- Bug: temp file is created by `os.Create` (0666 minus umask) and renamed over the target. Exporting
  over an existing 0600 file makes it 0644. Exporting to a symlink replaces the link with a regular
  file instead of writing through it. The export can hold unblanked secrets (F8).
- Fix: create the temp file with 0600, or copy the existing target's mode when present. Resolve the
  target with `filepath.EvalSymlinks` before building `tmpPath`.

## F19: failed compensating delete leaves a half-imported collection (low)

- `apps/kira-studio/internal/bridge/collections.go:271-326` (`Import`); compensating delete at
  line 303 only logs on failure.
- Bug: when the post-import step fails and the compensating `Delete` also fails, the call returns
  an error but the collection stays in the tree. User sees "import failed" plus a new collection.
- Fix: include the delete failure in the returned error (so UI can tell the user a partial
  collection remains), or run import plus follow-up in one DB transaction so no compensation is
  needed.

## Informational: cross-host 307/308 re-sends request body

- `apps/kira-studio/internal/httpclient/options.go:141-176`. A cross-host 307 re-sends the body
  (verified: `password=hunter2` reached host B). RFC 9110 behavior and same as curl `-L`. Not a
  bug. Mention only if F2's fix touches the same function.

## Checked, nothing real

- Reveal gate: errors carry no plaintext or ciphertext. Shared grace window is intended (D8).
- Substitution corpus: both sides loop it unfiltered.
- `capHopHeaders` (`httpclient/timeline.go:167-176`) drops whole headers, so no partial secret.
- `cacheKey` ignoring metadata values: documented (plan finding 12). No invalidation on server
  schema change: documented (D4).
- Lone-surrogate `urlencode` throw: unreachable; plain values arrive from Go already sanitized.
- net/http CR/LF header error does not include the header value.
- Multipart text parts carry `Rendered` verbatim, so masking covers them.
- Transform case mapping (ß, final sigma, İ, ﬁ, ǅ): Go and JS agree.
- Dotenv import (`packages/api-core/src/http/dotenv.ts` `parseEnv`/`reconcileEnv` vs Go
  `ApplyBulk`/`applyBulkMatchSecret`): no discrepancy. `KEY=` on a secret row leaves it untouched on
  both sides.
- `negotiateAndListServices` retries are bounded (4).
