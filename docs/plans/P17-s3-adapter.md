# P17 — S3 adapter + object browser view

> Plan for SPEC.md §10 phase **P17**. Deliverable: *Adapter + object browser view (bucket →
> prefix/object, `/`-delimited, per §4/§9).* S3 was scoped into v1 from the start (§1, §5.1, §6)
> but never got its own phase; this closes the last v1-scoped-but-unbuilt engine. Read the row's
> silence on edit/delete the same way P9's row was read: this phase is **read-only browsing**.
>
> **Written retroactively.** AGENTS.md requires the Opus plan be committed before implementation;
> for P17 the Sonnet main session implemented first and this document was authored afterwards
> against the shipped tree. It is written as the plan the phase *should* have had, not as a
> description of what happens to exist — where the implementation diverges from what this plan
> would have called for, §4 records it explicitly rather than back-filling a rationale.

## 0. Ground rules for this phase

- Build exactly what §5.1's s3 row + §4/§9's object-browser wording + §6's S3 storage paragraph
  describe. No bucket create/delete, no object upload/delete, no presigned-URL surface, no
  versioning/lifecycle/ACL UI, no multi-region bucket sweep, no object-tagging view — none of
  those are named anywhere in v1 scope.
- §5.1's s3 row, literally: tree = `account → buckets → prefixes/objects (lazy, '/'-delimited)`;
  default view = `key/value (object browser)`; pagination = `ListObjectsV2` continuation token;
  exact count = `KeyCount` per listed page only (no cheap exact bucket count); cancel =
  `AbortController` on the SDK call.
- The adapter is read-only: `caps.writable: false`, `canInsert`/`canUpdate`/`canDelete` all false;
  `preview()`/`mutate()` throw `E_UNSUPPORTED`. §8.10's right-click coverage table has no S3 row,
  consistent with there being no in-view mutation UI to hang a menu item on.
- `describe()`/`ddl()`/`execute()` are unsupported stubs. `describe()` is only ever called from the
  grid's `celleditor`/`views/grid/state.ts` path, never reached by a `'keyvalue'` tab; `caps.ddl`
  and `caps.sql` are both `false`, which gates §8.10's "Open DDL" and §8.14's console menu items
  the same way Mongo's and SQS's do.
- Never an unbudgeted listing. Every `ListObjectsV2` loop is round-capped, mirroring
  `redis/catalog.ts`'s `MAX_SCAN_ROUNDS` discipline — a very wide prefix degrades to "not
  everything under this prefix is shown yet", never to an unbounded crawl.
- Never buffer an object body without a ceiling. A bucket can hold multi-GB objects; the preview
  path must decide *before* transferring whether a body is previewable at all.
- Cancellation: the AWS SDK v3 per-request `abortSignal` option is threaded through every
  `client.send()`, plus a pre-flight `ctx.signal.aborted` check at each entry point and between
  listing rounds. `adapter.cancel(opId)` is a permanent no-op returning `false`; `caps.cancel:
  true` regardless — same reasoning as P9's D7/D8 and P10's D14.
- No new view. This phase's whole bet is that an S3 object is a *flat field/value listing*, which
  is the exact shape `KeyValueView.vue` already renders (D1 below). If that bet requires more than
  cosmetic generalizations to the view, the bet was wrong and the phase should build its own view
  instead of bending a Redis-shaped one.
- `tests/db/s3.spec.ts` is a new numbered-scenario file mirroring `sqs.spec.ts`'s structure, over a
  LocalStack container (`@testcontainers/localstack`, already a dependency from P10). A
  `tests/ui/s3.spec.ts` mirrors `tests/ui/sqs.spec.ts`, and `scripts/demo-dbs/` gains S3 coverage —
  both are parity obligations P16 already established for every shipped engine, not optional extras.
- Run `bun run lint`, all three `typecheck:*` splits, `bun x electron-vite build`, `bun run
  test:db`, and `xvfb-run -a bun run test:ui` before committing.

### Realities this phase works with (verified against the tree)

1. **`KeyValuePage` is already a fixed `fields`/`values` `TextColumnChunk` pair** with page-level
   metadata (`redisType`/`ttlMs`/`memoryBytes`). Widening `redisType` with an `'object'` member is
   a one-literal change in `page.ts` plus the matching `keyValuePageEnvelopeSchema` `z.enum`.
2. **`createDocumentPageBuilder` already has the `singleRow` precedent** —
   `DOCUMENT_TRUNCATE_BYTES_SINGLE` (64 × `MAX_CELL_BYTES` = 4 MB) exists specifically for "this is
   the one thing being fetched directly, give it a bigger budget". `createKeyValuePageBuilder` has
   no such option yet; adding one is symmetrical, not novel.
3. **`PageKind` already includes `'keyvalue'`; `PaginationStrategy` already includes `'token'`**
   with the comment `// opaque continuation token (S3)` — reserved for this phase in P1. Note
   `PagePosition['strategy']` is a *different, narrower* union that does **not** include `'token'`.
4. **`connectionKindSchema` already includes `'s3'`**; `DEFAULT_PORT` correctly omits it (no
   conventional port). Only `ConnectionDialog.vue`'s `SUPPORTED_KINDS` needs `'s3'` added.
5. **P10's SQS adapter already solved the AWS-shaped connection problem** — `sqs/client.ts`
   repurposes `database` → region and `username` → named profile, with a `kind !== 'sqs'` exception
   in `connectionInputSchema`'s `superRefine` and an `isSqs` branch in `ConnectionDialog.vue`. Both
   are single-kind checks that must generalize to a set for a second AWS-shaped kind.
6. **`sqs/client.ts`'s `options.endpoint` override already exists** for LocalStack; S3 needs the
   same plus `forcePathStyle`, which non-AWS S3-compatible endpoints effectively always require.
7. **`sqs/errors.ts` is the direct error-mapping template** — AWS SDK v3 puts the AWS error code in
   `err.name`, so mapping is a `name` switch plus the shared abort/timeout/socket cases.
8. **`registry.ts` is a flat object literal** — adding s3 is one lazy-import entry.
9. **`nodeKindSchema` needs three fresh literals** — `bucket`, `prefix`, `object`. None of the
   existing literals fit: reusing `'database'` for a bucket would be as misleading as P10 found
   reusing anything for a topic, since a bucket is not a per-connection logical namespace.
10. **`ProjectTree.vue`'s `KEYVALUE_OPENABLE_KINDS` is a `Set`** — adding `'object'` alongside
    `'key'` is one entry; `bucket`/`prefix` stay expand-only like `database`/`namespace`.
11. **`menus.ts`'s `menuForRow()` is an exhaustive-by-convention switch with `default: return []`,
    and `openContextMenu()` opens the menu regardless of whether the item list is empty** — a
    `NodeKind` with no case produces an empty floating menu, not "no menu". Every kind added by
    P8/P9/P10 got a case; three new kinds need three.
12. **`views/keyvalue/state.ts`'s `DISCONNECTED_CODES` is `{E_NOT_FOUND, E_ENGINE_DOWN,
    E_CONNECT}`**, and a read failing with one of those calls `unmarkHydrated()` and returns
    *without* setting `rt.error` — flipping the view to the `ReconnectGate`. This is exactly why
    P9's D10 chose `E_QUERY` for a vanished Redis key, and why `sqs.spec.ts`'s test 10 is literally
    named "a nonexistent queue is `E_QUERY`, not `E_NOT_FOUND`".
13. **`redis/catalog.ts`'s `'key'` leaf carries the complete literal key as its `name`** (P9's D3),
    not just its last `:`-segment — and `KeyValueView.vue`'s `targetTail`/`keyName` both depend on
    that, for the view header's object name and for every mutation target.
14. **Every shipped adapter's `read()`/`count()` path calls `ctx.setCommand()`** (`redis/read.ts`
    `TYPE ${key}`, `sqs/read.ts` `ReceiveMessage ${queueUrl}`, `kafka/read.ts`, all four SQL
    paths). `scheduler/ops.ts` initialises `command = null` and writes whatever `setCommand` left
    into the `op:end` event → `op_log.command` → §8.11's Operations panel column.
15. **`KeyValueView.vue` renders a TTL chip and a memory badge unconditionally** from
    `page.ttlMs`/`page.memoryBytes`, and `TabStrip.vue`/`MainView.vue` hardcode `symbol-key` for
    every `'keyvalue'` tab — all three are Redis-shaped assumptions baked into the shared view.
16. **`@aws-sdk/client-s3` is not yet a dependency**; `@aws-sdk/credential-providers` and
    `@testcontainers/localstack` both already are (P10).

## 1. Shapes introduced in this plan

```ts
// src/shared/protocol/page.ts
// KeyValuePage.redisType gains 'object'. The field keeps its (now slightly inaccurate) name
// rather than being renamed to `valueType`: renaming it churns every reader in the renderer,
// the console result path, the envelope schema and both UI suites for no behavioural gain.
redisType: 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream' | 'object';
// ttlMs/memoryBytes are always null for an object — neither concept exists in S3.

// createKeyValuePageBuilder gains DocumentPageBuilder's own `singleRow` option, widening only
// the *value* budget (fields stay at MAX_CELL_BYTES — a field name is never large).
export function createKeyValuePageBuilder(opts: {
  redisType: KeyValuePage['redisType'];
  ttlMs: number | null;
  memoryBytes: number | null;
  singleRow?: boolean; // DOCUMENT_TRUNCATE_BYTES_SINGLE instead of MAX_CELL_BYTES
}): KeyValuePageBuilder;
```

```ts
// src/shared/domain/tree.ts — three new NodeKind literals.
'bucket'  // the root container; redis's 'database' equivalent, never opened as a tab
'prefix'  // an intermediate '/'-delimited level; redis's 'namespace' equivalent
'object'  // a leaf, opened as a 'keyvalue' tab; redis's 'key' equivalent
```

```ts
// src/shared/domain/connection.ts
// P10's single `kind !== 'sqs'` superRefine exceptions generalize to a shared set.
export const AWS_STYLE_KINDS: ReadonlySet<ConnectionKind> = new Set(['sqs', 's3']);
```

```ts
// src/engine/adapters/s3/caps.ts
export const s3Caps: Caps = {
  tabular: false, documents: false, keyValue: true, stream: false,
  defaultPageKind: 'keyvalue',
  sql: false, ddl: false,
  projection: false, serverFilter: false,
  exactCount: true,          // see D11 — a single object's field count is exact
  pagination: 'token',       // ListObjectsV2's ContinuationToken (tree listing)
  foreignKeys: false,
  canInsert: false, canUpdate: false, canDelete: false, writable: false,
  transactions: false,
  cancel: true,              // SDK abortSignal is fully effective (P9 D8 / P10 D14 precedent)
};
```

```ts
// src/engine/adapters/s3/client.ts
// Mirrors sqs/client.ts: fields mode repurposes `database` → region, `username` → named profile
// (fromIni); URI mode `s3://accessKeyId:secretAccessKey@region` carries static keys, per §5.1's
// "static keys accepted only in URI mode". `options.endpoint` overrides the endpoint and turns on
// forcePathStyle (D5). `options.bucket`/`options.prefix` pin the tree root when the credentials
// cannot ListBuckets (D4).
export function connectS3(cfg: ResolvedConnectionConfig, log: AdapterDeps['log']): { client: S3Client };
```

```ts
// src/engine/adapters/s3/errors.ts
// Same SDK-v3 `err.name` shape as mapSqsError. NoSuchBucket/NoSuchKey are mapped to E_QUERY, not
// E_NOT_FOUND — see D12 and reality #12.
export function mapS3Error(err: unknown): AdapterError;
```

```ts
// src/engine/adapters/s3/catalog.ts
// Root: ListBuckets → one 'bucket' node each, hasChildren: true.
export function listBuckets(client: S3Client, ctx: OpCtx): Promise<TreeNode[]>;
// One level: ListObjectsV2 { Prefix, Delimiter: '/' }, round-capped. CommonPrefixes become
// 'prefix' nodes (local segment only); Contents minus the exact-prefix directory-marker become
// 'object' nodes whose `name` is the FULL key (D3), matching redis's 'key' precedent.
export function listPrefixChildren(
  client: S3Client, bucket: string, prefixSegments: string[], ctx: OpCtx,
): Promise<TreeNode[]>;
```

```ts
// src/engine/adapters/s3/read.ts
// HeadObject first (metadata + size), then GetObject for the body only when the size is under
// MAX_BODY_DOWNLOAD_BYTES (D8) — so an oversized object never opens a body stream at all.
// Emits exactly one page: rowCount = metadata rows + one synthetic 'Body' row, hasMore: false.
// ctx.setCommand(`GetObject ${bucket}/${key}`) before the request (D13).
export function readObject(client: S3Client, bucket: string, key: string, ctx: OpCtx): Promise<KeyValuePage>;
// HeadObject only; returns the same row count readObject would produce, exact: true (D11).
export function countObject(client: S3Client, bucket: string, key: string, ctx: OpCtx): Promise<{ value: number; exact: boolean }>;
```

```ts
// src/engine/adapters/s3/index.ts
export function createS3Adapter(deps: AdapterDeps): Adapter;
// children(): [] for an 'object' leaf (rule 5). read()/count() resolve bucket + full key from the
// leaf's own `name` (D3). preview/mutate/execute/describe/ddl throw E_UNSUPPORTED.
// cancel(opId) is a permanent no-op returning false.
```

```ts
// src/renderer/project/menus.ts — three new menuForRow cases (D14).
// 'bucket' / 'prefix' → containerMenu-shaped: Refresh, Copy name.
// 'object'            → objectMenu: Open, Open in new tab, Copy name (mirrors keyMenu exactly).
```

## 2. Decisions made in this plan

| # | Decision | Rationale |
|---|---|---|
| D1 | An S3 object reuses the existing `'keyvalue'` page kind and `KeyValueView.vue`, with `redisType: 'object'`, rather than getting its own page kind and view. | An object is metadata (ContentType/ContentLength/LastModified/ETag/StorageClass/user `Metadata.*`) plus one body — a flat field/value listing, which is byte-for-byte the shape a Redis hash already renders through `fields`/`values`. Realities #1-2: the codec, the builder, the row renderer, the search toolbar and the cell-editor preview seam all already exist. Inventing a fifth `Page` member to carry the same two `TextColumnChunk`s would duplicate every one of them. |
| D2 | S3's tree is `bucket → prefix → object`, lazily listed one level at a time via `ListObjectsV2` with `Delimiter: '/'`, deliberately mirroring Redis's `database → namespace → key` shape. | §5.1's s3 row names exactly this ("lazy, `/`-delimited"). The two engines' trees are the same construction — a flat keyspace presented as a tree by splitting on a delimiter — so following P9's structure (per-level catalog call, ancestor segments collected on the way down, leaf never expanded) gets the whole level right by precedent instead of by re-derivation. `Delimiter` is what makes it lazy: the server does the grouping, so no level ever enumerates the whole bucket. |
| D3 | An `'object'` leaf node's `name` carries the **complete key** (`reports/2024/summary.json`), not just its last `/`-segment; `'prefix'` nodes carry only their own local segment. | Direct reuse of P9's D3, and the reason that decision existed: `KeyValueView.vue`'s header and every path-consuming call site read the leaf's `name` verbatim rather than re-joining ancestors. A local-segment-only leaf makes two objects at different prefixes render identically in the view header and the tab title, and pushes a join into every consumer. The tree row itself can still *display* the local segment — that is a `TreeRow.vue` presentation choice, separate from what the node's `name` means. |
| D4 | `connect()` probes with `ListBuckets`, but `options.bucket` (and optionally `options.prefix`) pins the tree root to a single bucket/prefix when set, in which case the probe is a `HeadBucket`/single `ListObjectsV2` instead. | §6 explicitly reserves `options_json` for "bucket/region/prefix defaults", and the IAM reality is that a great many real credentials can read one bucket but hold no account-wide `s3:ListAllMyBuckets`. A `ListBuckets`-only design makes those connections fail at connect time with an authorization error and no way forward — the spec already anticipated this and gave the escape hatch a home. |
| D5 | `forcePathStyle` is enabled automatically whenever `options.endpoint` is set, and only then. | A non-AWS S3-compatible endpoint (LocalStack, MinIO, Ceph) essentially never has per-bucket DNS/TLS for AWS's virtual-hosted form; real AWS is unaffected because the flag is only applied when an override is present. Making it automatic avoids a second option the user has to know to set. |
| D6 | Fields mode repurposes `database` → AWS region and `username` → named profile, generalizing P10's `kind !== 'sqs'` checks into `AWS_STYLE_KINDS`. Static keys remain URI-mode-only. | P10's D8 already made this call for SQS on §5.1's "named AWS profile" wording, and S3 sits under the same §5.1 paragraph. A second one-off `kind !== 's3'` clause beside the existing `kind !== 'sqs'` one is the shape that rots; a set is the shape that takes a third AWS kind for free. |
| D7 | One `GetObjectCommand` is not the read path — `HeadObject` runs first, `GetObject` second and only when the body is worth fetching. | `GetObject` returns as soon as headers arrive and hands back a *lazy body stream*; the size is only knowable from that same response. Deciding "too large" after the response means the stream is already open and must be explicitly destroyed or it holds a socket. `HeadObject` costs one cheap round trip and makes the size decision before anything is opened — and `count()` needs `HeadObject` anyway, so the two paths share it. |
| D8 | Objects larger than `MAX_BODY_DOWNLOAD_BYTES` (32 MB) get a `Body` row explaining the size instead of their content; below that, the body is decoded lossily (`TextDecoder('utf-8', { fatal: false })`) and truncated for display at `DOCUMENT_TRUNCATE_BYTES_SINGLE` (4 MB) via the builder's `singleRow` option. | Two separate ceilings doing two separate jobs: 4 MB is how much text the *renderer* will show (reality #2's precedent — an explicitly-opened single item earns a bigger budget than a row in a list), 32 MB is how much this process will ever *buffer* to produce that. Without the second one, previewing a 2 GB video means allocating 2 GB to throw 99.8% of it away. Lossy decoding means a binary object degrades to replacement characters with its ContentType visible right above, rather than failing the whole read. |
| D9 | Every listing loop is capped at `MAX_LIST_ROUNDS` (20 × the 1000-key `MaxKeys` default), and a listing that hits the cap surfaces a visible "not everything under this prefix is shown" indicator rather than silently returning a partial set. | The cap itself is `redis/catalog.ts`'s `MAX_SCAN_ROUNDS` discipline, non-negotiable per the ground rules. The indicator is the part that makes it honest: a silently-truncated tree level is indistinguishable from a complete one, and "the file I know is there isn't in the tree" is a much worse failure than "this prefix is too wide to show fully". |
| D10 | `read()` ignores `req.cursor`/`req.pageSize` and always returns a single, complete page (`hasMore: false`), and the view's pager and page-size controls are hidden for a `redisType: 'object'` page. | An object's field listing is fixed-length and small; there is genuinely nothing to paginate. But P10's D11 already set the rule for this exact situation — SQS hides its pager entirely rather than showing disabled buttons — because a live control that does nothing implies a capability that does not exist. Leaving the pager and the 10/100/1k/10k selector visible-but-inert is the failure mode that decision exists to prevent. |
| D11 | `count()` returns the object's exact field-row count via `HeadObject`, and `caps.exactCount` is therefore **`true`**. | `Adapter`'s own contract says `exact` is false *when `caps.exactCount === false`* — the two must agree. §5.1's "no cheap exact bucket count" describes counting *keys in a bucket*, which is a tree-level operation `count()` never performs; `count()` only ever answers "how many rows is the open tab showing", and for one object that number is exactly derivable. This is the identical distinction `redis/caps.ts` already documents in its own `exactCount: true` comment (per-key `HLEN`/`SCARD` vs §5.1's db-wide `DBSIZE` wording). |
| D12 | `NoSuchKey`/`NoSuchBucket` map to `E_QUERY`, not `E_NOT_FOUND`. | Reality #12: `E_NOT_FOUND` is overloaded by every view's `DISCONNECTED_CODES` to mean "the adapter/connection is gone", and the handler `unmarkHydrated()`s the tab and returns *without setting an error* — so an object deleted out from under an open tab silently becomes a "Reconnect" prompt on a perfectly healthy connection, which reconnects and gates again. P9's D10 made this exact call for a vanished Redis key and `sqs.spec.ts`'s test 10 asserts it by name. That the S3 SDK can *distinguish* not-found more precisely than SQS can is true and irrelevant: the constraint is what the renderer does with the code, not what the SDK knows. |
| D13 | Every `read()`/`count()` call issues `ctx.setCommand()` before its request (`GetObject ${bucket}/${key}`, `HeadObject ${bucket}/${key}`). | Adapter rule 3, and reality #14: `scheduler/ops.ts` writes whatever `setCommand` left into `op_log.command`. An adapter that never calls it produces op-log rows and Operations-panel entries with a blank command column, which is the one thing §8.11's command column exists to prevent. Every other adapter does this; nothing about S3 makes it exempt. |
| D14 | `menuForRow()` gains all three kinds: `bucket`/`prefix` get a container-shaped Refresh + Copy name, `object` gets keyMenu's exact Open / Open in new tab / Copy name. | Reality #11 — an unhandled `NodeKind` does not fall back to "no menu", it opens an *empty* menu. P9's D14 and P10's own `streamNodeMenu` both added minimal cases for exactly this reason; three new node kinds is three new cases, not a place to rely on `default`. |
| D15 | `KeyValueView.vue`'s Redis-specific chrome is gated on page kind, not left to render vacuously: the TTL chip and memory badge are hidden for `redisType: 'object'`, the header/tab icon becomes `file`, and the cell editor's `dataType` badge reads `s3 object field`. | The whole justification for D1's view reuse is that an object genuinely *is* this shape. Where it isn't — TTL and memory-usage are Redis concepts with no S3 analogue — the honest move is to hide the control, not to render "no expiry" and "unknown" badges on every object page. A reused view that displays two permanently meaningless badges is evidence the reuse was done to the letter rather than the intent. |
| D16 | `tests/db/s3.spec.ts` (LocalStack, mirroring `sqs.spec.ts`'s numbered structure), `tests/ui/s3.spec.ts` (mirroring `tests/ui/sqs.spec.ts`), and an S3 service in `scripts/demo-dbs/` are all in scope for this phase. | Every shipped engine has all three; P16's own deliverable was explicitly "full six-engine `demo-dbs` coverage". The existing `demo-dbs` SQS service is already `localstack/localstack:3` with `SERVICES: sqs`, so S3 coverage is one word plus a seed script — leaving it out makes P17 the first engine that ships without the parity the previous phase went out of its way to establish. |

## 3. Target tree at the end of P17

```
docs/
  SPEC.md                      MOD — §10 P17 row → implemented; §6's S3 storage paragraph
                                     reconciled with what the adapter actually reads (D4/D6).
src/shared/
  protocol/page.ts             MOD — redisType gains 'object' (+ envelope z.enum);
                                     createKeyValuePageBuilder gains `singleRow`.
  domain/tree.ts               MOD — nodeKindSchema gains 'bucket', 'prefix', 'object'.
  domain/connection.ts         MOD — AWS_STYLE_KINDS extracted; superRefine uses it.
src/engine/adapters/
  registry.ts                  MOD — s3: createS3Adapter entry.
  s3/                          NEW
    caps.ts                    NEW — s3Caps.
    client.ts                  NEW — connectS3 (region/profile/URI-static-keys, endpoint override
                                     + forcePathStyle, options.bucket/prefix pinning).
    errors.ts                  NEW — mapS3Error → AdapterError (NoSuchKey/NoSuchBucket → E_QUERY).
    catalog.ts                 NEW — listBuckets, listPrefixChildren (Delimiter-grouped, capped,
                                     truncation-flagged).
    read.ts                    NEW — readObject (Head-then-Get), countObject.
    index.ts                   NEW — createS3Adapter; unsupported write/DDL/console surface.
src/renderer/
  project/ConnectionDialog.vue MOD — SUPPORTED_KINDS gains 's3'; isSqs → isAwsStyle.
  project/ProjectTree.vue      MOD — KEYVALUE_OPENABLE_KINDS gains 'object'.
  project/icons.ts             MOD — bucket/prefix/object tree icons.
  project/menus.ts             MOD — 'bucket'/'prefix'/'object' cases (D14).
  views/keyvalue/KeyValueView.vue MOD — breadcrumb roots on 'bucket' too; TTL/memory chips and
                                     pager/page-size controls hidden for an object page (D10/D15);
                                     file icon; honest cell-editor dataType.
  workbench/panels/TabStrip.vue   MOD — 'keyvalue' tab icon is engine-aware (D15).
  workbench/panels/MainView.vue   MOD — same.
package.json                   MOD — @aws-sdk/client-s3.
tests/db/
  support/s3.ts                NEW — LocalStack fixture, mirrors support/sqs.ts.
  fixtures/0007_s3_seed.ts     NEW — two buckets (one empty), root + one-deep + two-deep objects.
  s3.spec.ts                   NEW — numbered scenarios: connect/disconnect, cap honesty, tree
                                     enumeration at three levels, leaf/empty-bucket children,
                                     read with metadata+body, nested-key resolution, missing
                                     object, count, unsupported writes, cancellation.
tests/ui/
  support/s3.ts                NEW — re-export wrapper.
  s3.spec.ts                   NEW — connect, tree walk, open an object tab, cell-editor preview.
scripts/demo-dbs/
  docker-compose.yml           MOD — localstack SERVICES: sqs,s3 (D16).
  s3/seed.sh                   NEW — demo buckets/objects.
  seed.sh                      MOD — invoke the S3 seed.
docs/plans/
  P17-s3-adapter.md            NEW — this document.
```

## 4. Deviations found — plan vs. the shipped implementation

This section exists because the plan was written after the code. Each entry is a place where the
implementation made a call this plan would not have, recorded rather than rationalized away.

| Plan | Shipped | Assessment |
|---|---|---|
| **D12** — `NoSuchKey`/`NoSuchBucket` → `E_QUERY` | `s3/errors.ts` maps both to `E_NOT_FOUND`, with a comment arguing the SDK's precision justifies it; `s3.spec.ts` test 12 asserts `E_NOT_FOUND` | **Bug.** `views/keyvalue/state.ts`'s `DISCONNECTED_CODES` swallows the error and shows the reconnect gate instead. P9's D10 and `sqs.spec.ts`'s test-10 name are the standing precedent; the comment reasons about the SDK and never checks the renderer. |
| **D13** — `setCommand()` on every read/count | Never called anywhere in `s3/` | **Bug.** Adapter rule 3; every S3 op logs a null command. |
| **D3** — leaf `name` is the full key | `catalog.ts` sets `name` to the local segment only | **Bug.** Nested objects render as `conn / bucket / summary.json`, losing `reports/2024/`; two objects at different prefixes are indistinguishable in the view header and tab title. `KeyValueView.vue`'s `keyName` comment ("the full redis key… verbatim") is now false for S3. |
| **D14** — three `menuForRow` cases | No cases added | **Bug.** Right-clicking any bucket/prefix/object opens an empty context menu. |
| **D11** — `exactCount: true` | `exactCount: false` (comment reasons about `ListObjectsV2`, an operation `count()` never calls) while `countObject` returns `exact: true` | **Contract violation.** The spec file asserts both halves (test 3 vs test 13) and test 13's own title says "exact… not approximate". `redis/caps.ts` documents the correct resolution. |
| **D7** — HeadObject first | Single `GetObject`; the >32 MB branch pushes a message and returns without consuming or destroying `res.Body` | **Bug (resource).** The body stream is already open at that point; it is never destroyed, holding the connection until the agent times it out. |
| **D10** — pager/page-size hidden for an object page | Both render and are live; `readObject` ignores `req.pageSize` and `req.cursor` entirely | **Wart.** Four page-size buttons and a Next/Prev pager that do nothing — the exact thing P10's D11 hid SQS's pager to avoid. |
| **D15** — Redis-only chrome hidden | TTL chip renders "no expiry" and the memory badge renders "unknown" on every object page; `TabStrip.vue`/`MainView.vue` still hardcode `symbol-key`, so an object's tab shows a key icon while its own header shows a file icon | **Wart.** The view-header icon and `dataType` label were generalized; these three were missed. |
| **D9** — truncation is surfaced | `MAX_LIST_ROUNDS = 20` silently returns a partial listing | **Gap.** A prefix over ~20 000 keys is quietly incomplete. |
| **D4/D6** — `options.bucket`/`prefix` honoured; §6 reconciled | Only `options.endpoint` is read; region lives in `database`; SPEC §6 (which says `database` is unused for S3 and that bucket/region/prefix live in `options_json`) was left unamended | **Spec divergence.** The region-in-`database` choice is defensible (it matches SQS), but §6 still says otherwise, and there is no path to connect with credentials lacking `s3:ListAllMyBuckets`. |
| **D16** — UI spec + demo-dbs coverage | Neither exists (`tests/ui/` has a spec for every other engine; `demo-dbs` covers six) | **Gap.** |
| — | `count()` counts a `Body` row only when `ContentLength > 0`, but `readObject` pushes one whenever `res.Body` is truthy — true for a 0-byte object | **Bug (minor).** Count is one low for empty objects. |
| — | `caps.pagination: 'token'` while `read()` emits `strategy: 'offset'`; `'token'` is not a member of `PagePosition['strategy']` at all | **Nit.** No page can ever carry it; harmless, but the cap describes the tree listing, not the page. |
| — | Disabled Add/Edit/Delete buttons are titled "Connection is read-only" | **Nit.** The *adapter* is read-only; the connection may not be. First engine to reach this view with `canInsert: false`. |
| — | Count button is titled "Exact count" | **Nit.** Correct under D11; inconsistent with the shipped `exactCount: false`. |

Everything else matches: the tree construction (`Delimiter`-grouped, directory-marker skipped,
prefixes-then-objects, both sorted), the `singleRow` builder addition, the caps surface, the
`AWS_STYLE_KINDS` generalization, the error map's abort/auth/timeout/socket arms, the client's
endpoint/`forcePathStyle` handling, `registry.ts`, the node kinds and their icons, and the db-spec's
scenario coverage all land where this plan would have put them.
