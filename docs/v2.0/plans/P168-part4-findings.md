# P168 Part 4 findings: Studio DB adapters II (document, key-value, stream, object-store)

Plan: `P168-part4-nosql-adapters.md`. Reviewer: one Opus pass, report only.
Base commit: `1a613e6`. HEAD reviewed: `4123010` (plan commit on top of base; no Part 4 code
change between them).

## Checks

Pending (block 7).

## Findings

Ranked high, medium, low within the final list. IDs are stable once committed.

### F1 (low) awscfg: URI with access key but no secret silently uses the ambient credential chain

- `apps/kira-studio/internal/adapters/awscfg/config.go:43-50`
- `u.User` set with a username but no password adds no credentials provider, so
  `LoadDefaultConfig` falls back to env vars, `~/.aws` default profile, SSO or IMDS.
- Scenario: user saves `sqs://AKIAEXAMPLE@us-east-1` and the secret store has no password (never
  entered, or cleared). Connect succeeds with whatever identity the host machine has (e.g. an
  admin default profile), not the key the user named. Browse and writes run as that identity.
- Fix: in URI mode, a non-empty username without a password is a config error
  (`mapConfigError("an access key needs a secret key ...")`); an empty userinfo keeps the default
  chain on purpose.

### F2 (medium) mongo literal parser: unbounded recursion crashes the whole process

- `apps/kira-studio/internal/adapters/mongo/literal.go:406-547` (`ParseValue` ->
  `parseObject`/`parseArray` -> `ParseValue`, no depth limit).
- Scenario: console statement, grid filter or `run_query` text holding about 1.5 MB of `[`.
  Probe (throwaway `_test.go`, deleted): `ParseJSON5Literal(strings.Repeat("[", 1_500_000))`
  dies with `runtime: goroutine stack exceeds 1000000000-byte limit`; 700,000 returns a normal
  parse error. A Go stack overflow is fatal, not a recoverable panic: the Studio process exits.
  No statement-length cap sits in front (`dbmcp` `run_query` passes `args.SQL` straight through),
  so an MCP agent can kill the app with one call.
- Fix: carry a depth counter in `LiteralParser`; refuse past a fixed limit (BSON's own nesting
  limit is 100 levels, so a few hundred is generous) with `CodeQuery` "literal nested too deep".

### F3 (medium) mongo Stop misses an op between cursor batches and leaves it running with no deadline

- `apps/kira-studio/internal/adapters/mongo/adapter.go:373-406` (`Cancel`),
  `console.go:242-259` (`runCursorOp`), `read.go:325-336`, `abort.go:26-45`.
- `Cancel` only finds work through `$currentOp` with `idleConnections: false` and the default
  `idleCursors: false`, so it sees an op only while a command is executing on the server. The op
  itself runs on `RunWithAbortRace`'s `context.WithoutCancel` ctx, which has no deadline and no
  cancel path of its own.
- Scenario: console `db.events.find()` on a large collection. `cursor.All` loops `getMore`; most
  wall time is spent between commands (network transfer, client decode). User presses Stop:
  `CancelOp` cancels the op ctx (the UI shows cancelled), `Cancel` runs `$currentOp`, finds no
  active `getMore`, returns false. The detached goroutine keeps fetching and buffering the whole
  collection into `[]bson.D`, then throws it away; the server cursor stays open until exhausted.
  Same for a Stop issued before the command reaches the server (server selection, pool checkout).
  Code-read; the driver does tag `getMore` with the comment on 4.4+ (`x/mongo/driver/
  batch_cursor.go:429-436`), so killOp works only when the timing lands on an executing command.
- Fix: keep a per-op `context.CancelFunc` for the detached ctx (register it beside the tracker
  token) and call it from `Cancel` in addition to killOp; the driver then stops the `getMore` loop
  and `cursor.Close` kills the server cursor. Optionally also query `$currentOp` with
  `idleCursors: true` and `killCursors` the matched cursor.

### F4 (medium) mongo console `deleteMany()` / `deleteOne()` with no argument delete with an empty filter

- `apps/kira-studio/internal/adapters/mongo/console.go:415-453` (`runFilterOnlyOp` uses
  `argOrEmptyDoc`, so a missing filter becomes `{}`).
- Scenario: user (or agent through `run_query`, classified write and allowed) types
  `db.users.deleteMany()` while still composing the filter and runs it. Every document in
  `users` is deleted. `deleteOne()` deletes an arbitrary document. mongosh refuses both
  ("Missing required argument at position 0"); this console silently widens to all documents.
- Fix: `deleteOne`/`deleteMany` require an explicit filter argument (keep the `{}` default only
  for `find`/`findOne`/`countDocuments`); an explicit `{}` still deletes everything on purpose.

### F5 (low) mongo `NumberInt` silently wraps out-of-range values

- `apps/kira-studio/internal/adapters/mongo/literal.go:321-329` (`int32(f)` with no range check).
- Probe: `ParseJSON5Literal("NumberInt(\"3000000000\")")` returns `int32(-2147483648)`, no error.
  An insert or filter then stores or matches a wrong value. `NaN`/`Inf` inputs are rejected by
  `ParseFloat`'s error path only for unparsable text, not for range.
- Fix: reject values outside `math.MinInt32..math.MaxInt32` (and non-integral values, if the
  shell truncation is not wanted) with the existing "invalid NumberInt" error.

### F6 (low) mongo: deprecated BSON types do not survive a grid edit

- `apps/kira-studio/internal/adapters/mongo/literal.go:571-585` (`ejsonWrapperKeys` lacks
  `$symbol`, `$undefined`, `$dbPointer`), read side `read.go:236` (canonical EJSON).
- Probe: canonical output of `bson.Symbol("x")`/`bson.Undefined{}` is
  `{"$symbol":"x"}`/`{"$undefined":true}`; `ResolveEJSONWrappers` returns them as plain nested
  documents. Scenario: a legacy document holding a Symbol field is opened and saved unchanged
  through the `$document` replace; the field is rewritten as an embedded document
  `{ "$symbol": "x" }` (MongoDB 5.0+ accepts `$`-prefixed nested names), silently changing type.
- Fix: add the three keys to `ejsonWrapperKeys` (`bson.UnmarshalExtJSON` decodes all three).

### F7 (low) mongo console cannot address collections whose names are not ASCII identifiers

- `apps/kira-studio/internal/adapters/mongo/console.go:99-157` (`parseStatement` takes the
  collection from one `ExpectIdent` token; `literal.go:66-70` identifiers are `[A-Za-z_$][A-Za-z0-9_$]*`).
- Scenario: collections `orders.archive`, `my-coll`, `système` are listed in the tree but the
  console cannot reach them: `db.orders.archive.find()` parses as collection `orders`, method
  `archive` ("unsupported console method"); `db["my-coll"].find()` and
  `db.getCollection("my-coll").find()` fail to parse. mongosh accepts all three forms.
- Fix: accept `db.getCollection("<name>")` and `db["<name>"]` (string token) as the collection
  term, and dotted segments before the method name (last identifier before `(` is the method).

### F8 (low, design-decision) console results are fully materialised with no row or byte cap

- `apps/kira-studio/internal/adapters/mongo/console.go:242-259` (`runCursorOp`: `cursor.All`
  into `[]bson.D`, then a page of every document).
- Scenario: `db.events.find()` on a 10 GB collection buffers every document as `bson.D`, then
  again as EJSON text in the page builder (per-cell truncation only, `page/builder.go:207`) before
  `dbmcp` caps rendered rows. Memory grows until the process is killed. The SQL consoles share
  the same shape (no row cap in `postgres`/`mysqlfamily` console), so this is a cross-engine
  decision, not a Part 4 regression. Combined with F3 the buffering also continues after Stop.
- Fix: decide a console row cap (e.g. a few thousand rows plus a "truncated" flag on the page),
  applied in `runCursorOp` with `SetBatchSize`/early cursor close; same cap for the SQL consoles.

## Coverage

- Block 1 (awscfg, core callee contract): done. `awscfg/config.go`, `awscfg/errors.go` reviewed
  in full. Core read as callee: `abort.go` (`RunWithAbortRace`: detached ctx, no deadline),
  `tracker.go` (`TrackerFor` no-op release while draining, `Drain` bounded by ctx), `connset.go`
  (`Get` single-flight, eviction `Close` unconditional, `CloseAll`). `url.Parse` error is replaced
  by a fixed message, so the URI (with secret) never reaches error text. `LoadDefaultConfig` with
  an explicit region does no IMDS region probe; credentials resolve lazily on the first request
  under the op ctx. `MapError` passes smithy text verbatim: operation, status, request ID, API
  message; no credential. Endpoint log line (`config.go:74`) logs the option verbatim; userinfo in
  an endpoint URL is not a supported shape, so not reported.
- Block 2 (mongo): done. All ten production files read in full: `client`, `adapter`, `literal`,
  `console`, `read`, `mutate`, `catalog`, `definition`, `errors`, `caps`. Verified, no finding:
  `Connect` returns promptly on ctx cancel (driver `Connect` is lazy, `buildInfo` server selection
  honours ctx, 10 s cap); probe failure disconnects the fresh client. `Disconnect` snapshot, cancel,
  bounded `Drain`, then `client.Disconnect` under a fixed 10 s deadline: bounded. `TrackerFor`
  no-op release while draining is covered by that deadline. `tlsConfigForSslmode` verifies for
  `require`/`prefer`, rejects unknown spellings; `SetTLSConfig` after `ApplyURI` overrides a URI
  `tlsInsecure`. `buildURIFromFields` escapes userinfo (P108 F13 holds). `isAggregateWrite`: the
  pipeline must be `bson.A` both for the check and for `asDocArray`, so no shape reaches the runner
  unchecked; escapes resolve before the key check; `$out`/`$merge` are illegal inside
  `$facet`/`$lookup`/`$unionWith`; `runAggregate` ignores extra args. `parseStatement` rejects
  trailing content and `;`, so one statement is one command. `ClassifyStatement` returns
  `ClassUnknown`+error on parse failure; `dbmcp` treats it as unknown, never as read. Grid bodies
  and ids use canonical EJSON, so numeric/date/binary types round-trip through `$document`
  (except F6). `\u` surrogate pairs decode correctly (probe). `keysetIDCondition` widening and
  missing-`_id` fallback hold (P108 F6/F7). `parseIdKey` operator documents cannot match a real
  `_id` (MongoDB forbids `$`-prefixed fields in `_id`). Catalog calls take the op ctx; cancel maps
  to `E_CANCELLED`. Caps match the unsupported stubs (`SchemaColumns`, `KeyTypes`,
  `DownloadObject`); leaf `Children` returns `[]`. Whole-document `ReplaceOne` is last-writer-wins
  (no version check); same as the SQL grid's PK-only update, not reported.
- Block 3 (redis): not reached.
- Block 4 (kafka): not reached.
- Block 5 (sqs): not reached.
- Block 6 (s3): not reached.
- Block 7 (tests, real-container runs): not reached.
