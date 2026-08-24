# P33 — S3: download, upload, delete, and a bounded object editor

> **SPEC.md §10, the P33 row, verbatim:** *"S3 objects gain download and upload actions, and the
> demo-seed script gains more/larger sample content to exercise them against. Also add delete, and
> edit where the object is small enough to reasonably render/parse — above a size threshold, an
> object is neither parsed nor rendered, matching the grid's own large-value-truncation precedent
> (§8.6) rather than risking a stalled frame or a runaway parse."*
>
> **The user's own words:** *"For S3 i should be able to download and upload a file, and the seed
> script to actually add more content there. Also delete, and maybe even edit, but only for a
> reasonable file size, if it s too big don t render/parse it at all"*
>
> **What this phase is.** The mutation half of the S3 adapter that P17 deliberately deferred, plus
> the two file-transfer actions that only make sense for an object store, plus the seed data that
> makes all of it demonstrable. It touches all three processes: a new main-process file-dialog IPC
> domain, one new engine data op and one new `Adapter` method, a widened `Caps`, and the
> `keyvalue` view's mutation affordances gaining an S3 branch.
>
> **What this phase is not.** It is not a general "object store management" feature. No bucket
> create/delete, no versioning/ACL/tagging/lifecycle surface, no presigned URLs, no multipart
> upload, no recursive prefix delete or folder upload, no drag-and-drop. Every one of those is
> named in §6 as out, not silently missing.

## 0. Ground rules for this phase

- **Reuse the mutation machinery that already exists; do not build a second one.** `mutate()`,
  `MutationPlan`, `MutationRowOp` and the `data:mutate` op already carry Redis's and Mongo's
  whole-value writes through reserved sentinels (`redis/mutate.ts:17-18`, `documentMutations.ts:22`).
  S3's edit, delete **and upload** ride that same path. Only *download* gets new surface, because
  it is the one operation with no mutation shape at all.
- **Immediate execute, no staging.** §8.14's pending-change set is the SQL grid's own; both other
  engines that render into this page kind mutate immediately (D1). Nothing in this phase may touch
  `views/grid/pendingChanges.ts` or grow a second pending set.
- **Never buffer or decode a body without a ceiling, and never let a ceiling be a lie.** P17's own
  ground rule, tightened: today the adapter fetches up to 32 MB in order to display at most 4 MB
  (F3). This phase makes "not parsed, not rendered" literal at one number, and Download becomes
  the honest answer for everything above it (D4).
- **A truncated or lossily-decoded value is never writable.** §8.6's own rule, already enforced for
  grid cells (`CellEditorView.vue:86-88`, P24 D27): *"Only the first 64 KB was fetched — committing
  it would overwrite the full value."* An S3 body that was cut, or that came back through a lossy
  UTF-8 decode, is in exactly that position and gets exactly that treatment (D6, D7).
- **The read-only guard is enforced in the engine, not greyed out in the UI.** §8.13, and the
  standard every other `mutate.ts` in the tree already meets (`redis/mutate.ts:96`). Download is a
  read and is *not* blocked by it.
- **Every operation that reaches the network gets an op-log row, a real command string and a
  working stop button.** §2.1 and §8.12. A multi-hundred-MB download that cannot be cancelled is
  not acceptable; the SDK's `abortSignal` plus stream destruction is the mechanism (D9).
- **A cancelled or failed download must never leave a partial file at the user's chosen path.**
  Write to a sibling temp file, `rename` on success, `unlink` on any failure (D10).
- **No new dependency.** `@aws-sdk/client-s3@3.1116.0` already ships `PutObjectCommand`,
  `DeleteObjectCommand`, `CopyObjectCommand` and `GetObject`'s streaming body (verified by
  `require`ing the installed package). `@aws-sdk/lib-storage` (multipart) is **not** installed and
  is not being added — see D12 for what that costs and how the limit is surfaced.
- **The tree never learns about engines.** Menu items are gated on `Caps` flags, never on
  `record.kind === 's3'` (§5: *"the UI picks a view from the page kind, never from the database
  type"*). That is why this phase adds a cap rather than a special case (D3).
- **Comments per AGENTS.md** — only where the code cannot say it for itself.
- **Green after every commit:** `bun run lint`, all three `typecheck:*` splits, `bun run build`,
  and the four container-free UI specs (`smoke`, `startup`, `workbench`, `connections`). Every
  `tests/db/` suite and every engine-backed `tests/ui/` spec is Docker-backed and **cannot run in
  Claude Code's Linux web container** (AGENTS.md: the blocked `production.cloudfront.docker.com`
  CDN). §5 names exactly what must be run elsewhere before this phase is called verified.

## 1. Findings (verified against the tree, not assumed)

### What the S3 adapter is today

**F1 — S3 is structurally read-only, in three places that must all flip together.**
`s3/caps.ts:29-32` sets `canInsert`/`canUpdate`/`canDelete`/`writable` all `false`;
`s3/index.ts:116-120` throws `E_UNSUPPORTED` from `preview()` ("no mutation UI ever calls preview()
for s3"); `s3/index.ts:122-124` throws the same from `mutate()`. `S3Adapter` also never reads
`cfg.readOnly` in `connect()` (`s3/index.ts:42-55`) — unlike `redis/index.ts:52`, which stores it
for its own guard. All four are this phase's edit.

**F2 — the object target resolver already exists and is correct.**
`s3/index.ts:142-155`'s `resolveObjectTarget()` reads the first (`bucket`) and last (`object`)
segment only, because a leaf `object` node's `name` is the **full bucket-relative key** verbatim
(`s3/catalog.ts:109-123` — the D3 decision P17 recorded, mirroring Redis's key nodes). Every new
operation in this phase addresses an object the same way, and needs no prefix-segment joining.

**F3 — there are two body budgets today and they disagree by 8×.** `s3/read.ts:23` sets
`MAX_BODY_DOWNLOAD_BYTES = 32 * 1024 * 1024` as the buffering ceiling; the page builder is created
with `singleRow: true` (`s3/read.ts:81-86`), which caps the `Body` **value** at
`DOCUMENT_TRUNCATE_BYTES_SINGLE` = `MAX_CELL_BYTES * 64` = 4 MB (`page.ts:145-150`,
`page.ts:389-395`). So an object between 4 MB and 32 MB is fully transferred over the network,
fully decoded into a JS string, and then 87–99% of it is thrown away by
`ColumnScratch.appendValue`'s truncation (`page.ts:246-268`). Above 32 MB the adapter does the
right thing already — `HeadObject` only, and a `Body` row whose *value is a human-readable note*
(`s3/read.ts:88-93`).

**F4 — the "too large" state is a note inside a data row, which the renderer cannot distinguish
from content.** `s3/read.ts:91-92` pushes `Body` = `"(too large to preview — 41.2 MB, over the
32.0 MB preview limit)"`. Nothing on the wire says this row is a notice rather than the object's
actual first 24 characters; a renderer wanting to gate Edit on it would have to string-match.

**F5 — a binary body is decoded lossily and rendered as replacement characters, on purpose.**
`s3/read.ts:112-115`: *"Lossy on purpose (fatal: false) — a binary object opened for preview
degrades to U+FFFD replacement characters rather than the whole read failing."* That is a sound
read-side decision and this phase keeps it — but it means the decoded string in the renderer is
**not** a faithful representation of the object's bytes, so writing it back would corrupt the
object (D7).

**F6 — `countObject` derives its number from `readObject`'s own field selection by hand.**
`s3/read.ts:151-158` counts `4 + Metadata keys`, `+1` for `StorageClass`, `+1` whenever
`ContentLength !== undefined` (the `Body` row). If `readObject` stops pushing a `Body` row for an
over-limit object, this arithmetic has to follow or Count and the visible row count disagree.

**F7 — `ttlMs`/`memoryBytes` are hardcoded `null` for S3, and the view hides both badges because of
it.** `s3/read.ts:82-85` passes `ttlMs: null, memoryBytes: null`; `KeyValueView.vue:180`'s
`isSingleObjectPage` suppresses the TTL chip and the memory badge together
(`KeyValueView.vue:403-414`), with a comment saying both are *"Redis-only concepts"*. TTL genuinely
is. `memoryBytes` is not: an object's `ContentLength` is exactly "how many bytes this thing is",
and it is the number every size gate in this phase needs (D5).

### What Redis already does, and why S3 should do the same

**F8 — Redis mutates immediately, with no staging, no preview step and no pending set.**
`views/keyvalue/keyValueMutations.ts:6-9`, verbatim: *"Keyvalue mutates immediately (mirrors
views/documents/documentMutations.ts's discipline exactly) — no pendingChanges.ts-style staged
plan, no preview step. Every action calls data.mutate directly and reloads the tab's current page
on success."* SPEC §8.8 says the same normatively: *"All three execute **immediately** — no
pending-change staging or preview."* §8.7 says it again for the document view.

**F9 — `preview()` still exists for an immediate-execute engine, and its job is the op log.**
`redis/mutate.ts:62-65` implements `preview()` synchronously, and `redis/mutate.ts:98` calls it
from inside `mutate()` to feed `ctx.setCommand(...)`. So implementing `preview()` for S3 is not
"building a preview UI" — it is how the Operations panel's command column gets a real string.

**F10 — the sentinel pattern for a whole-value write is established twice.** `redis/mutate.ts:17-18`
reserves `_key` (which key) and `$value` (the new string), *"expressed through the existing
relational-shaped MutationRowOp rather than widening the shared mutation schema — mirrors
mongo/mutate.ts's `$document` precedent"*. `keyValueMutations.ts:13-14` mirrors the same two
constants on the renderer side. S3's object key/body are the identical shape.

**F11 — `plan.path` for a keyvalue engine resolves to the *container*, not the item.**
`redis/mutate.ts:20-29` requires a `database`-rooted path and the op's own `_key` names the target;
`redis/index.ts:117-120` explains why (*"an `insert` … by definition has no existing key a path
could point at yet"*). The S3 analogue is a `bucket`-rooted path, which every object tab's own path
already starts with (F2) and every bucket/prefix tree row already is.

**F12 — the destructive-action confirmation precedent is `window.confirm`.**
`KeyValueView.vue:216-220` for Redis's delete, `menus.ts:234-237` for deleting a connection, both
described in-tree as *"mirrors documentMenu.ts's window.confirm() precedent for a destructive,
un-staged action"*. `tests/ui/connections.spec.ts:144` shows the Playwright handling
(`page.once('dialog', (dialog) => dialog.accept())`).

**F13 — the view's write gating is already a two-part cap + read-only computed, per action.**
`KeyValueView.vue:146-151` (`caps.canUpdate && !record.readOnly`, ×3), with
`KeyValueView.vue:161-163`'s `writeDisabledReason()` distinguishing *"Not supported for this
connection type"* from *"Connection is read-only"*. The three toolbar buttons
(`keyvalue-add` :479, `keyvalue-edit` :515, `keyvalue-delete` :548) and `keyValueMenu.ts:127-154`'s
context menu already read those computeds. Flipping S3's caps lights all of them up — which is
exactly why the labels and the `editableType` predicate (`KeyValueView.vue:157`, hardcoded to
`redisType === 'string'`) need an S3 branch rather than being left to say "Add key (string value)"
over a bucket.

### The three-process seams this phase has to cross

**F14 — there is no file dialog anywhere in the app yet.** `grep` for `showSaveDialog` /
`showOpenDialog` / `dialog.` across `src/main/` returns nothing; `src/main/ipc/` has eleven domain
files and `registry.ts` wires each with one line. §11 predicts this exact case: *"Adding
`kira:tabs:*` for session restore, or `kira:s3:*` later, is a new file and one registry line, never
an edit to unrelated handlers."*

**F15 — the engine is a plain Node `utilityProcess`, so it can do the file I/O itself.**
`adapter.ts:34-36` rule 1: *"An adapter imports nothing from `electron`. It is a plain Node
module."* Nothing forbids `node:fs`. `engine/index.ts:20-37` shows the engine talking to main over
`process.parentPort` and to the renderer over a `MessagePort`; `engine/rpc.ts:8-38` is the op table
that `bridge/data.ts:36-62` calls into. Bulk bytes therefore never transit main (§4) — the renderer
sends a *path*, the engine streams the *bytes*.

**F16 — `runOp` gives cancellation, the op-log row and the command string for free.**
`scheduler/ops.ts:31-88`: any `fn(ctx)` wrapped in `runOp({kind, opId, tabId, connectionId})` emits
`op:start`/`op:end`, owns an `AbortController` whose signal is `ctx.signal`, and records
`setCommand`/`setRows`. `op_log.kind` is a bare `TEXT NOT NULL` column with no `CHECK`
(`0001_init.sql:56-66`) and `OperationsPanel.vue:222` renders `{{ item.record.kind }}` as plain
text — so adding an `OpKind` member is a one-line enum change in `shared/domain/ops.ts:3-14` with
no migration and no renderer switch to update.

**F17 — the modal-dialog pattern is "state module holds the open flag, `App.vue` mounts it".**
`App.vue:54`: `<ConnectionDialog v-if="connectionsState.dialog.open" />`, with the state in
`state/connections.ts:11-30` and the opener (`openCreateDialog`) called from `project/menus.ts`.
`ProjectPanel.vue:62` does the same for `FiltersDialog`, opened from
`project/state/tree.ts:79-84`. This is how the tree can open a dialog without importing a component
sideways.

**F18 — a reusable CodeMirror editor already exists and is already used for exactly this job.**
`editor/CodeMirrorHost.vue:19-47` takes `doc` / `language` (`'json' | 'xml' | 'sql' | 'mongo' |
'redis' | 'plain'`, `languages.ts:9`) / `readOnly` and emits `update:doc`.
`DocumentView.vue:631, 691, 708` mount it inline for Mongo's add/edit areas with an explicit Save
button — not blur-commit. That is the precedent for S3's body editor (D8).

**F19 — the cell editor's `onEdit` seam is deliberately staging-shaped, so S3 must not use it.**
`state/cellSelection.ts:24-34`: *"Set only by a publisher that can genuinely stage a write for this
exact cell (today, only `DataGrid.vue`)"*, and `CellEditorView.vue` stages the buffer on
`focusout`. Wiring `onEdit` for an immediate-execute engine would turn losing focus into a silent
`PutObject`. S3 publishes its rows to the panel read-only, exactly as it does today
(`KeyValueView.vue:285-310`).

**F20 — a tree menu item with a `shortcut` id gets keyboard support for free.**
`ProjectTree.vue:126-133` lists `TREE_SHORTCUTS` including `'tree.delete'`
(`shared/shortcuts.ts:58-62`: `Delete`, `Cmd+Backspace` on mac), and
`ProjectTree.vue:154` dispatches through `runMenuShortcut(menuForRow(row), id)`. Adding a
`shortcut: 'tree.delete'` item to `objectMenu` makes the Delete key work on a selected object row
with no new wiring.

**F21 — `containerMenu` and `namespaceMenu` are each shared across engines.**
`menus.ts:63-93`'s `menuForRow` routes `bucket` → `containerMenu` (`:260-287`, also
`database`/`schema`) and `prefix` → `namespaceMenu` (`:474-492`, also Redis's `namespace`). Both
need an S3-only item, so both need a cap-gated branch rather than an unconditional one.

### Demo seed and tests

**F22 — the S3 demo seed is 17 lines and covers none of this phase's states.**
`scripts/demo-dbs/s3/seed.sh` creates two buckets and three tiny text/JSON objects, all well under
every threshold, none binary, none with user metadata (unlike
`tests/db/fixtures/0007_s3_seed.ts:27`, which does set `Metadata: { seeded: 'true' }` — the two
have drifted). `scripts/demo-dbs/README.md:107-113` documents the two buckets and warns the S3 seed
is not idempotent.

**F23 — `tests/db/s3.spec.ts` has 16 scenarios and two of them assert the read-only contract that
this phase reverses.** Scenario 3 (`:107-120`) asserts `canInsert`/`canUpdate`/`canDelete`/
`writable` are all `false`; scenario 14 (`:322-337`) asserts `preview()`/`mutate()`/`execute()` all
throw `E_UNSUPPORTED`. Both must change (not be deleted — `execute()` stays unsupported).

**F24 — the DB spec shares one LocalStack container across every scenario**
(`tests/db/support/s3.ts:22-28`, memoized). Any mutating scenario that touches `MAIN_BUCKET`'s
seeded objects would break scenarios 5, 6, 9, 10, 11 and 13, which assert their exact
contents/listings. Mutations need their own bucket in the fixture (D14).

**F25 — the Playwright harness can stub Electron's native dialogs.** `tests/ui/fixtures.ts:74-80`
already calls `app.evaluate(({ BrowserWindow }) => …)` against the main process, so
`app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath:
… }); })` is available with no new mechanism — the only way to test a native dialog, which
Playwright cannot click.

## 2. Shapes introduced in this plan

### 2.1 `shared/caps.ts` — one new flag

```ts
  // ---- graph + writes
  foreignKeys: boolean;
  …
  /** P33: this engine's items are *files* — they can be streamed to and from a local path, and
   *  the UI may offer an OS file dialog for them. Orthogonal to canInsert/canUpdate: S3 is the
   *  only engine where "add an item" means "pick a file", and the only one with a download at
   *  all. Gates the Download action outright; gates Upload together with canInsert. */
  fileTransfer: boolean;
```

Added to `capsSchema` (`caps.ts:62-81`) as `z.boolean()`, and to all seven adapters' cap literals —
`true` for `s3/caps.ts`, `false` for `postgres`/`mariadb`/`mongo`/`redis`/`kafka`/`sqs`.

`s3/caps.ts` additionally flips `canInsert`/`canUpdate`/`canDelete`/`writable` to `true` and
replaces the *"Read-only browsing only in this phase (P17)"* header comment.

### 2.2 `shared/protocol/page.ts` — the two size gates, beside the family they belong to

```ts
export const MAX_CELL_BYTES = 64 * 1024;
export const DOCUMENT_TRUNCATE_BYTES = MAX_CELL_BYTES;
export const DOCUMENT_TRUNCATE_BYTES_SINGLE = MAX_CELL_BYTES * 64;

/** P33: the ceiling on an object body the app fetches, decodes and renders **at all**. Equal to
 *  DOCUMENT_TRUNCATE_BYTES_SINGLE by construction, not by coincidence: a body that could only be
 *  shown truncated is a body whose remainder was transferred for nothing, now that Download
 *  hands over the whole file instead. Above this, nothing is fetched and no Body row exists. */
export const OBJECT_BODY_PREVIEW_BYTES = DOCUMENT_TRUNCATE_BYTES_SINGLE; // 4 MB

/** P33: the ceiling on an object body the app will let the user edit and write back. Lower than
 *  the render ceiling because editing is a different cost class — a mutable CodeMirror buffer,
 *  a full re-encode and a PutObject of the result — and because a bad write is not undoable in
 *  an unversioned bucket. Sixteen cell budgets: far above a DB cell (a 200 KB JSON export is a
 *  normal thing to fix by hand), far below a document-sized page. */
export const OBJECT_BODY_EDIT_BYTES = MAX_CELL_BYTES * 16; // 1 MB

/** P33: AWS's hard limit for a single PutObject. Above it an upload needs multipart, which this
 *  phase does not implement (D12) — the adapter refuses with a message that says so. */
export const OBJECT_UPLOAD_MAX_BYTES = 5 * 1024 * 1024 * 1024; // 5 GiB
```

### 2.3 `shared/domain/object-store.ts` — new file

```ts
import { z } from 'zod';
import type { NodePath } from './tree';

/** Adapter-side (mirrors mutations.ts's MutationPlan): built by engine/data.ts from a decoded
 *  NodePath plus the wire's own destPath, never parsed whole at a boundary. */
export interface ObjectDownloadRequest {
  path: NodePath;
  /** Absolute local path, chosen by the user through the main-process save dialog. */
  destPath: string;
}

export interface ObjectTransferResult {
  bytes: number;
}

/** The reserved sentinels for an S3 upload, on top of redis/mutate.ts's own `_key`. Same
 *  discipline, same reason (F10): a local file path is not a column value, and `$` can never
 *  start a real S3 metadata field name. */
export const OBJECT_KEY_SENTINEL = '_key';
export const OBJECT_VALUE_SENTINEL = '$value';
export const OBJECT_FILE_SENTINEL = '$file';
export const OBJECT_CONTENT_TYPE_SENTINEL = '$contentType';

/** Extension → Content-Type for the upload dialog's prefill. Deliberately small and explicit
 *  rather than a dependency: the value is shown in an editable field, so a miss is visible and
 *  correctable before anything is sent, never silent. */
export function contentTypeForFilename(name: string): string { … }

export const localFilePathSchema = z.string().min(1).max(4096);
```

### 2.4 `shared/protocol/data-ops.ts` — one new op

```ts
export const DATA_OP = {
  …
  /** P33: streams one S3 object's bytes into a local file. Never returns bytes over the port —
   *  the engine writes the file itself (§4: bulk data never transits main *or* the renderer). */
  objectDownload: 'data:objectDownload',
} as const;

export interface ObjectDownloadRequestWire {
  opId: string;
  tabId: string | null;
  connectionId: string;
  path: string;
  destPath: string;
}

export const objectDownloadRequestWireSchema = z.object({
  opId: z.string(),
  tabId: z.string().nullable(),
  connectionId: z.string(),
  path: z.string(),
  destPath: localFilePathSchema,
});

export interface ObjectDownloadResponse {
  bytes: number;
}
```

### 2.5 `shared/domain/ops.ts` — one new op kind

`opKindSchema` gains `'transfer'` (F16: no migration, no renderer switch). Upload and delete stay
`'mutate'`; only the download uses it.

### 2.6 `engine/adapters/adapter.ts` — one new method

```ts
  /**
   * P33: streams one object's bytes into `req.destPath`. A **read** — never blocked by the
   * connection's read-only flag. Gated by `caps.fileTransfer`; every adapter with that flag
   * false throws `E_UNSUPPORTED`. Honours `ctx.signal` mid-stream and leaves no file behind on
   * cancellation or failure.
   */
  downloadObject(req: ObjectDownloadRequest, ctx: OpCtx): Promise<ObjectTransferResult>;
```

Required, not optional — the tree's convention is that every adapter implements every method and
throws `E_UNSUPPORTED` where it cannot (`redis/index.ts:96-99`, `s3/index.ts:96-104`). Six
four-line stubs. `adapter.ts:128-132`'s roadmap comment is amended in the same commit, and
`docs/v1/plans/P1-connections-and-tree.md` §4b with it — that file's own rule.

### 2.7 `engine/adapters/s3/mutate.ts` — new file, shaped after `redis/mutate.ts`

Three ops on a `bucket`-rooted `plan.path` (F11), each op naming its object through `_key`:

| Op | Sentinels | What runs |
|---|---|---|
| `update` | `key: { _key }`, `changes: { $value }` | `HeadObject` (existence + the metadata to preserve), then `PutObject` with the new body and the object's own `ContentType`, `CacheControl`, `ContentEncoding`, `ContentDisposition`, `ContentLanguage`, `StorageClass` and user `Metadata` carried over verbatim (D11) |
| `insert` | `values: { _key, $file, $contentType? }` | `HeadObject` → reject with `E_QUERY` if the key already exists (D13), then `PutObject` streaming `createReadStream($file)` with `ContentLength` from `stat()` |
| `delete` | `key: { _key }` | `HeadObject` → `E_QUERY` if absent, then `DeleteObjectCommand` |

`preview(plan)` renders, synchronously and without any network call (F9, `adapter.ts:101-105`):

```
PutObject s3://main-bucket/reports/notes.txt (1.4 KB)
PutObject s3://main-bucket/uploads/data.csv <- /Users/me/data.csv
DeleteObject s3://main-bucket/readme.txt
```

`mutate()` opens with the read-only guard (`if (readOnly) throw new AdapterError('E_UNSUPPORTED',
'connection is read-only')`), calls `ctx.setCommand(preview(plan).join(';\n'))`, checks
`ctx.signal.aborted` between ops, and returns `{ affectedRows }` counting one per applied op.

### 2.8 `engine/adapters/s3/transfer.ts` — new file, the only one that touches `node:fs`

```ts
export async function downloadObject(client, bucket, key, destPath, ctx): Promise<{bytes:number}>
export async function openUploadBody(sourcePath): Promise<{ stream: Readable; size: number }>
```

`downloadObject`: `ctx.setCommand(\`GetObject s3://${bucket}/${key} -> ${destPath}\`)`, `HeadObject`
for a real "no such object" error before any file is created, then `GetObject` with
`abortSignal: ctx.signal`, then `pipeline(res.Body as Readable, createWriteStream(tmpPath), { signal:
ctx.signal })` where `tmpPath = \`${destPath}.kira-partial-${randomUUID()}\`` in the same directory
(same filesystem, so the `rename` is atomic), then `rename(tmpPath, destPath)`. Any throw —
including an abort — `unlink`s the temp file in a `finally` before rethrowing through `mapS3Error`
(D10).

`openUploadBody`: `stat()`s the file (so a missing/unreadable source fails before any network call),
refuses `size > OBJECT_UPLOAD_MAX_BYTES` with `E_UNSUPPORTED` naming multipart (D12), and hands back
the stream plus its exact length — the AWS SDK requires `ContentLength` for a streamed body.

### 2.9 `engine/adapters/s3/read.ts` — the size gate, rewritten

```ts
// P33 D4: one number governs fetch, decode and render alike. Above it nothing is transferred and
// no Body row exists at all — the renderer's own gate is the same constant, not a parsed string.
if (head.ContentLength === undefined || head.ContentLength > OBJECT_BODY_PREVIEW_BYTES) {
  pushMetadataFields(builder, head);   // ← no Body row (D4/F4)
} else {
  … GetObject, decode, builder.push('Body', text) …
}
```

and the builder gains the object's real size:

```ts
const builder = createKeyValuePageBuilder({
  redisType: 'object',
  ttlMs: null,
  // P33 D5: an object's ContentLength *is* "how many bytes this item is" — the same question
  // memoryBytes answers for a redis key. Every size gate in the renderer reads it from here.
  memoryBytes: head.ContentLength ?? null,
  singleRow: true,
});
```

`countObject` (F6) follows: the `Body` row is counted only when
`ContentLength !== undefined && ContentLength <= OBJECT_BODY_PREVIEW_BYTES`.

`MAX_BODY_DOWNLOAD_BYTES` and its 32 MB literal are deleted; `formatBytes` stays (it is used by the
metadata rows).

### 2.10 `main/ipc/files.ts` — new IPC domain (F14)

```ts
export function registerFilesHandlers(): void {
  handle(IPC.filesChooseSave, async (event, payload) => {
    const { defaultName } = chooseSaveSchema.parse(payload);
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const res = win
      ? await dialog.showSaveDialog(win, { defaultPath: join(app.getPath('downloads'), basename(defaultName)) })
      : await dialog.showSaveDialog({ … });
    return { canceled: res.canceled, filePath: res.filePath ?? null };
  });

  handle(IPC.filesChooseOpen, async (event) => {
    const res = await dialog.showOpenDialog(win, { properties: ['openFile'] });
    if (res.canceled || !res.filePaths[0]) return { canceled: true, file: null };
    const path = res.filePaths[0];
    const info = await stat(path);
    return { canceled: false, file: { path, name: basename(path), size: info.size } };
  });
}
```

`basename(defaultName)` is not decoration: the renderer supplies the suggested name, and an S3 key
contains `/`. Parenting the dialog to the requesting window makes it a sheet on macOS. One line in
`registry.ts`; `IPC.filesChooseSave`/`filesChooseOpen` in `shared/protocol/ipc.ts` with their
`KiraApi` signatures; the two matching `ipcRenderer.invoke` lines in `preload/index.ts`; two
wrappers in `bridge/control.ts`.

### 2.11 `renderer/state/objectStore.ts` — new file, the one seam the tree and the view share

Lives in `state/` because §11 puts *"cross-view app state … so `views/` doesn't have to reach into
`workbench/` to read it"* there, and because `project/menus.ts` must not import a `views/` module
sideways (F17).

```ts
export const uploadDialogState = reactive<{ open: boolean; connectionId: string | null;
                                            containerPath: string }>({ … });
export function openUploadDialog(connectionId: string, containerPath: string): void
export function closeUploadDialog(): void

/** Save dialog → data.objectDownload. Returns the chosen path, or null when cancelled. */
export async function downloadObject(connectionId: string, path: string, tabId: string | null): Promise<string | null>

/** Confirm → data.mutate delete. Callers reload/refresh; this module never touches a view's runtime. */
export async function deleteObject(connectionId: string, path: string, tabId: string | null): Promise<boolean>

/** data.mutate insert with the `$file` sentinel; resolves to the new object's encoded path. */
export async function uploadObject(args: { connectionId: string; containerPath: string;
                                           key: string; sourcePath: string; contentType: string;
                                           tabId: string | null }): Promise<string>
```

`containerPath` is the encoded path of the bucket or prefix the object lands in — for the object
tab's own Upload button, `pathParent(tab.path)` (`tree.ts:54-58`).

### 2.12 `renderer/workbench/UploadObjectDialog.vue` — new file

A `DialogFrame` modal, mounted once in `App.vue` beside `ConnectionDialog` (F17), driven entirely
by `uploadDialogState`. Contents:

- a **Choose file…** `AppButton` calling `control.filesChooseOpen()`, showing the chosen file's
  name and `formatBytes(size)` once picked;
- a **Key** `TextField`, prefilled with `<container prefix><basename>` and editable;
- a **Content type** `TextField`, prefilled from `contentTypeForFilename()` (§2.3) and editable —
  a wrong guess is visible and correctable, never silent;
- an inline error line (`popover-error` styling, as `KeyValueView.vue:495` uses);
- **Cancel** / **Upload**, with Upload disabled until a file is chosen and the key is non-empty,
  and while the upload is in flight.

On success it closes, refreshes the container node in the tree, and opens the new object's tab.

### 2.13 `renderer/views/keyvalue/ObjectBodyEditor.vue` — new file

The inline edit band for an object's body, mounted inside `KeyValueView`'s panel when
`editOpen && isSingleObjectPage`. Mirrors `DocumentView.vue:691`'s own inline edit area rather than
Redis's single-line `TextField` popover, because the thing being edited is a document-sized body
(D8):

```vue
<CodeMirrorHost v-model:doc="draft" :language="language" :read-only="saving" />
```

with `language` derived from the page's `ContentType` row (`application/*json` → `'json'`,
`*xml`/`text/html` → `'xml'`, else `'plain'`), a byte counter, an error line, and **Cancel** /
**Save**. No blur-commit anywhere (F19).

### 2.14 `renderer/views/keyvalue/KeyValueView.vue` — the S3 branch

| Today | After |
|---|---|
| `editableType` = `redisType === 'string'` (`:157`) | a two-branch computed: for `'object'` pages, `objectEditGate` (below); Redis unchanged |
| `editTitle` = *"Only string values are editable in this version"* (`:166`) | for an object, the gate's own reason string |
| `addTitle` = *"Add a new key"* (`:170`) | *"Upload a file"* for an object |
| `openAdd()` opens the add-key popover (`:189`) | for an object, `openUploadDialog(connectionId, pathParent(tab.path))` |
| `openEdit()` fills a `TextField` draft (`:190`) | for an object, opens `ObjectBodyEditor` with the Body row's text |
| `onDeleteKey()` confirms and `deleteKey(...)` (`:216`) | for an object, `deleteObject(...)` from `state/objectStore.ts` |
| — | a new `keyvalue-download` `IconButton` (`cloud-download` codicon), shown when `caps.fileTransfer`, enabled regardless of `readOnly` |
| memory badge hidden for object pages (`:406-414`) | shown, as the object's size; the TTL chip stays hidden (D5) |
| — | a `MessageStrip` in `#strips` for the over-limit state (D4) |

`objectEditGate` is the whole of the size decision, in one computed, returning
`{ editable: boolean; reason: string }`:

```ts
if (!canUpdate) return writeDisabledReason(caps.canUpdate)
if (bodyRow === null)                 → 'Too large to edit — download it to open it locally'
if (bodyRow.isTruncated)              → 'Only part of this object was fetched — editing it would overwrite the rest'
if (bodyRow.value.includes('�')) → "This object isn't valid UTF-8 text — download it to edit it locally"
if (size > OBJECT_BODY_EDIT_BYTES)    → `Too large to edit (${formatBytes(size)} — the limit is ${formatBytes(OBJECT_BODY_EDIT_BYTES)})`
else editable
```

### 2.15 `renderer/project/menus.ts` — three gated items (F21)

- `objectMenu` (`:534-564`) gains **Download…**, a separator, and **Delete** (`danger`,
  `shortcut: 'tree.delete'` — F20), each gated on `caps.fileTransfer` / `caps.canDelete &&
  !readOnly`.
- `bucket` stops routing to `containerMenu` and gets `bucketMenu(row)` = `containerMenu(row)` plus
  **Upload file…**, gated on `caps.fileTransfer && caps.canInsert && !readOnly`.
- `prefix` stops routing to `namespaceMenu` and gets `prefixMenu(row)` = `namespaceMenu(row)` plus
  the same item.

The gate is a tiny shared helper (`uploadMenuItem(row)`), mirroring `consoleMenuItem(row)`
(`menus.ts:96-111`) exactly — one gating rule, two call sites.

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| **D1** | **S3 mutations execute immediately — no staging, no pending-change set, no preview UI.** Edit and Upload commit on an explicit **Save**/**Upload** press; Delete commits after a `window.confirm`. `preview()` is still implemented, but only to feed `ctx.setCommand()` and the op log (F9). | Three independent reasons, in order of weight. (a) **Precedent, exactly on point:** S3 renders into the `keyvalue` page kind, and the other engine that does — Redis — executes immediately, in code (F8, `keyValueMutations.ts:6-9`) and in the spec (§8.8: *"All three execute immediately — no pending-change staging or preview"*). §8.7 says the same for documents. §8.14's staged model is described throughout as the SQL grid's own. (b) **The staging machinery does not fit:** §8.14 stages *cell edits, added rows and deleted rows*, addressed **by primary key**, tinted per cell, struck through per row, in a grid. An object tab shows exactly one item and a flat metadata listing; there are no rows to tint, no PK to address by, and `views/grid/pendingChanges.ts` is grid-only state that would have to be generalized for one engine's single-item tab. (c) **Staging would promise atomicity S3 cannot deliver:** §8.14's Commit is one transaction with a Rollback; `s3/caps.ts` has `transactions: false` and always will. A three-op staged set that fails on op 2 would leave op 1 applied with no undo — strictly worse than three separate, individually-confirmed actions that each report their own result. The safety that staging buys in the grid is bought here instead by three explicit gestures: a confirm for delete, an explicit Save for edit, and an OS file dialog for upload. |
| **D2** | **Edit, delete and upload ride the existing `mutate()` path** with the `_key`/`$value`/`$file` sentinels; only **download** gets a new `Adapter` method and a new `DATA_OP`. | Upload *is* an insert and delete *is* a delete; expressing them as anything else would mean a second write path with its own read-only guard, its own op-log kind and its own cache invalidation to keep in sync with the first. The sentinel technique is established twice already (F10) and costs one constant. Download is genuinely different: it returns no rows, mutates nothing, and its payload is a filesystem path — `MutationPlan`'s `preview()` contract (*"exact commands, no execution"*) has nothing to say about it, and forcing it in would make `preview()` lie. One new method for the one operation that has no existing shape is the smaller change. |
| **D3** | The new cap is **`fileTransfer`**, not a `kind === 's3'` check and not a reuse of `canInsert`. | §5's rule is that the UI reads capabilities, never engine identity, and `menus.ts:96-111`'s `consoleMenuItem` is the in-tree pattern for a cap-gated menu row. `canInsert` alone cannot express it: it is already `true` for Kafka, SQS, Mongo and Redis, none of which has a file to download or an OS dialog to open. Upload's gate is therefore `fileTransfer && canInsert` — "this engine deals in files" **and** "this engine accepts new items" — which reads exactly as it behaves. |
| **D4** | **One render/parse threshold: `OBJECT_BODY_PREVIEW_BYTES` = `DOCUMENT_TRUNCATE_BYTES_SINGLE` = 4 MB.** Above it, the adapter issues `HeadObject` only — no `GetObject`, no decode, **no `Body` row at all** — and the view shows an explicit over-limit strip plus an enabled Download button. Today's 32 MB `MAX_BODY_DOWNLOAD_BYTES` is deleted. | This is the user's *"if it's too big don't render/parse it at all"*, made literal. Today it is not literal: an object between 4 and 32 MB **is** fully transferred and fully decoded, and then up to 87% of it is discarded by the page builder (F3) — the network and the decode both happen, only the display is spared. Tying the fetch ceiling to the display budget makes the two numbers one number, and makes "the Body row exists" mean "you are looking at the whole object", which is the invariant every gate downstream depends on (D6). Dropping the row entirely rather than pushing a notice-as-value (F4) means the renderer's gate is a comparison against a shared constant instead of a string match. The behaviour this removes — seeing the first 4 MB of a 12 MB log — is replaced by something strictly better in the same phase: downloading all 12 MB and opening it in a real editor. (Raised as OQ1 anyway, because it is a deliberate reversal of shipped behaviour.) |
| **D5** | **`memoryBytes` carries the object's `ContentLength`** instead of `null`, and the view shows it as the size badge for object pages. The TTL chip stays hidden. | The renderer needs the object's true byte size for the edit gate, and parsing it back out of the `ContentLength` display row (`"1234 bytes (1.2 KB)"`, `s3/read.ts:45-49`) would be a string-parse of a formatted string — the exact fragility D4 avoids elsewhere. `memoryBytes` is not a Redis concept wearing a costume: `KeyValueView.vue:127`'s `memoryText` already renders it as `formatBytes(...)`, which is precisely what an object's size wants to look like. This *removes* a special case (`:406-414`'s blanket suppression of both badges) rather than adding one — TTL genuinely has no S3 meaning; size very much does. |
| **D6** | **One edit threshold: `OBJECT_BODY_EDIT_BYTES` = `MAX_CELL_BYTES * 16` = 1 MB** — S3's own number, not the cell editor's 64 KB and not the render ceiling's 4 MB. | The cell editor's 64 KB (`page.ts:145`) is sized for *a column value in a grid row*, where hundreds are fetched per page; an S3 object is fetched one at a time and a 200 KB JSON export is an entirely normal thing to want to fix by hand, so reusing 64 KB would refuse the phase's most obvious use case. The render ceiling is wrong in the other direction: rendering is a one-way, read-only paint, while editing means a mutable CodeMirror document, an `update:doc` per keystroke, a full re-encode and a `PutObject` of the result — a different cost class against §2.1's budgets, and one where a mistake is unrecoverable in an unversioned bucket. 1 MB is expressed in the same `MAX_CELL_BYTES * N` idiom `DOCUMENT_TRUNCATE_BYTES_SINGLE` already uses, and sits one order of magnitude either side of both neighbours. Between 1 MB and 4 MB an object is fully readable, copyable and downloadable, and Edit is disabled **with the size and the limit both named** — never a silently missing button. |
| **D7** | **A body that came back truncated, or that contains U+FFFD after decoding, is not editable** — checked in the renderer, with no new field on the wire. | The first half is §8.6/P24 D27 applied verbatim (*"a partial value can be read and copied, but never staged as a write over the full one"*); with D4 in place it can only trigger when a lossy decode expands the byte count past the budget, but it still can, so the guard stays. The second half addresses F5: the decoder is deliberately lossy, so for a binary object the string in the renderer is *not* the object's bytes, and saving it would replace a PNG with a field of `EF BF BD`. Testing the decoded text for U+FFFD needs no protocol change, no second decode and no new page field, and errs in the safe direction — the only false positive is a genuine text file that legitimately contains a replacement character, whose cost is one refused edit and a Download button that still works. Rendering is unchanged: a binary object still previews lossily exactly as it does today, because that preview is genuinely useful for spotting *what* a file is. |
| **D8** | The body editor is an **inline `CodeMirrorHost` band inside the view**, with an explicit Save — not the Redis `TextField` popover, and **not** the cell editor panel's `onEdit` seam. | `DocumentView.vue:691` already mounts `CodeMirrorHost` inline for exactly this job (a document-sized body, an explicit Save), and a 1 MB body in a 320 px single-line `TextField` (`KeyValueView.vue:523-528`) is unusable. The cell editor is ruled out by F19: its `onEdit` contract is *"a publisher that can genuinely **stage** a write"*, and it commits the buffer on `focusout` — under D1's immediate-execute model that turns clicking away into a silent `PutObject`. S3 keeps publishing its rows to the panel read-only, as it does today. |
| **D9** | **Download and upload are cancellable, appear in the Operations panel, and download gets its own op kind `'transfer'`.** | §2.1: *"Every operation that can exceed ~150 ms shows progress and a working stop button"*, and a 500 MB download is the longest operation this app can start. Wrapping both in `runOp` (F16) buys the op-log row, the cancel token and the command string with no new machinery; the SDK's `abortSignal` plus `pipeline`'s own `signal` makes the cancel real rather than cosmetic (§5.1: *"Cancellation is never 'stop showing the result'"*). A distinct kind costs one enum member — no migration, no renderer switch (F16) — and buys an Operations panel where a 40-second row is legible as a file transfer rather than as a mysteriously slow `read`. Upload stays `'mutate'`, because it is one. |
| **D10** | A download writes to **`<dest>.kira-partial-<uuid>` in the destination directory and `rename`s on success**, unlinking the temp file on any failure or cancellation. | Streaming straight to the chosen path means a cancelled or failed download leaves a truncated file wearing the name of a complete one — the kind of half-result AGENTS.md's "no shortcuts" rule exists to prevent, and one the user has no way to detect. Same directory, so the rename is atomic on one filesystem. |
| **D11** | An **edit preserves every object attribute `HeadObject` returns and `PutObject` accepts** — `ContentType`, `CacheControl`, `ContentEncoding`, `ContentDisposition`, `ContentLanguage`, `StorageClass` and all user `Metadata`. | `PutObject` replaces an object wholesale; anything not resent is gone. Silently turning `application/json` into `binary/octet-stream`, or dropping `Content-Encoding: gzip`, would change how the object is *served* to everything downstream — a data-corrupting side effect of a body edit, invisible in the UI. The cost is one `HeadObject` per edit, which the existence check needs anyway. Object tags and ACLs are **not** preserved because this phase never reads them; that gap is OQ2, not a silent omission. |
| **D12** | Upload is a **single `PutObject` streamed from disk**, hard-capped at `OBJECT_UPLOAD_MAX_BYTES` (5 GiB) with an `E_UNSUPPORTED` that names multipart as the missing piece. No `@aws-sdk/lib-storage`. | 5 GiB is AWS's own limit for a single `PutObject`, so the cap is the API's, not an invented one. Multipart would add a dependency, a part-size/concurrency policy, an abort-incomplete-upload cleanup path and its own resumability semantics — a phase's worth of work for a case (a >5 GiB single object) that no part of the brief mentions. Refusing with an accurate message is complete behaviour; a silent failure at 5 GiB would not be. The `stat()` happens before any network call, so the refusal costs nothing. |
| **D13** | **Delete is per-object only.** No prefix delete, no bucket delete, no multi-select. **Upload refuses a key that already exists**, with the key named in the error. | *Prefix delete:* a "prefix" is not an S3 entity — it is a `CommonPrefixes` artifact of one `ListObjectsV2` call (`s3/catalog.ts:56-60`). Deleting one means paginating an unbounded key space and batching `DeleteObjects`, under a listing discipline that is explicitly round-capped (`s3/catalog.ts:15`, `MAX_LIST_ROUNDS = 20`) — so a capped recursive delete would report success having deleted *some* of a folder, which is worse than not offering it. No bulk delete exists anywhere else in the app either (§8.10's matrix). Named as a follow-up in §6, not omitted quietly. *Overwrite:* `redis/mutate.ts:121-122` uses `SET … NX` and errors on collision for exactly this reason — an insert must never silently destroy an existing item; replacing an object's contents is what Edit is for. `PutObject` has no `NX`, so the `HeadObject` pre-check supplies it. (OQ4 asks whether to add an explicit Replace affordance later.) |
| **D14** | `tests/db/fixtures/0007_s3_seed.ts` gains a **dedicated `MUTABLE_BUCKET`**, plus size/binary ladder objects in `MAIN_BUCKET` that no mutating scenario touches. | F24: one memoized LocalStack container serves every scenario in the file, and scenarios 5, 6, 9, 10, 11 and 13 assert `MAIN_BUCKET`'s exact listings and bodies. A delete or an edit against those objects makes the suite order-dependent — the classic shared-fixture trap. Read-only ladder objects can safely live in `MAIN_BUCKET` because scenario 5 asserts only the *bucket root* listing; they go under their own prefix. |
| **D15** | The file dialogs live in a **new, engine-neutral `main/ipc/files.ts`** domain (`kira:files:chooseSave` / `kira:files:chooseOpen`), not in an `kira:s3:*` domain and not in `app.ts`. | §11 predicts the shape (F14) and "ask the user for a path to save to" is an application capability, not an S3 one — an export-to-CSV feature (out of v1 scope, but named in §1's deferred list) would use the identical handler. Main is the right process: `dialog` is Electron-only and main is already *"the single source of truth for state"* (§4). The bytes never follow the path back through main (D2/§4). |
| **D16** | The renderer sends a **path** to the engine, which reads/writes it directly. No path-scoping token, no sandbox. | The path in question came out of an OS dialog the user just confirmed, and the renderer already holds `data.mutate` — the ability to rewrite any object in any connected bucket. A path adds no authority the renderer did not have, and the trust boundary is unchanged: renderer and engine are both first-party code in a desktop app that loads no remote content. Stated explicitly so the absence is a decision rather than an oversight. |
| **D17** | The upload dialog is a **`DialogFrame` modal in `workbench/`, driven by state in `state/objectStore.ts`**, opened from both the tree menu and the object tab's toolbar. | F17's established pattern, and the only one that lets `project/menus.ts` open a dialog without importing a `views/` component sideways (§11's dependency rule). One dialog with two entry points instead of a tree-only flow plus a view-only popover, which would be two places for the key-naming and content-type rules to drift. It also covers the case an object-tab-only affordance cannot: an **empty bucket** (the fixture's `EMPTY_BUCKET`) has no object to open, so without a tree entry point there would be no way to put the first object in it. |
| **D18** | **Download is never blocked by the connection's read-only flag**; Edit/Delete/Upload are, in the engine. | A download reads. §8.13 enumerates what the read-only guard disables — *"`+ row`, `− row`, cell editing, document edit/delete and console execution of anything but a read"* — and every entry is a write. Blocking a read would make the toggle mean something it has never meant. The write side is enforced in `s3/mutate.ts`'s first statement, matching `redis/mutate.ts:96` and §8.13's *"the guard is enforced in the engine, not just greyed out in the UI"*. |

## 4. Implementation order

Nine commits. Each leaves `bun run lint`, `bun run typecheck` (all three splits) and
`bun run build` green, and the app launchable; the four container-free UI specs (`smoke`,
`startup`, `workbench`, `connections`) must pass after every one.

---

### Commit 1 — `feat(caps): add fileTransfer and the object-transfer contract`

**Files:** `src/shared/caps.ts`, `src/shared/protocol/page.ts`,
`src/shared/domain/object-store.ts` (new), `src/shared/domain/ops.ts`,
`src/shared/protocol/data-ops.ts`, `src/engine/adapters/adapter.ts`, the six non-S3 adapters'
`caps.ts` and `index.ts`, `docs/v1/plans/P1-connections-and-tree.md`.

1. `Caps.fileTransfer` + `capsSchema` + `false` in six cap literals (§2.1).
2. The three size constants in `page.ts` (§2.2).
3. `shared/domain/object-store.ts` (§2.3) and the wire shapes + `DATA_OP.objectDownload` in
   `data-ops.ts` (§2.4).
4. `'transfer'` in `opKindSchema` (§2.5).
5. `Adapter.downloadObject` (§2.6) + six `E_UNSUPPORTED` stubs, and the amendment to
   `adapter.ts:128-132`'s roadmap comment plus P1's plan §4b that the comment itself demands.

**Why first:** everything else in the phase compiles against these types, and this commit changes
no behaviour at all — it is pure contract, reviewable on its own.

---

### Commit 2 — `feat(s3): object edit, delete and upload through mutate()`

**Files:** `src/engine/adapters/s3/caps.ts`, `src/engine/adapters/s3/mutate.ts` (new),
`src/engine/adapters/s3/transfer.ts` (new — the `openUploadBody` half only),
`src/engine/adapters/s3/index.ts`.

Flip the four cap flags and add `fileTransfer: true`; capture `cfg.readOnly` in `connect()` (F1);
implement `preview()`/`mutate()` per §2.7 and the upload streaming helper per §2.8; wire both
through `index.ts` with a `bucket`-rooted path resolver mirroring `redis/index.ts:121-131`.

**Must stay green additionally:** `tests/db/s3.spec.ts` scenarios 3 and 14 now fail by design —
they are rewritten in commit 8. Note that in the commit message; do not "fix" them by weakening the
adapter.

---

### Commit 3 — `feat(s3): stream an object to a local file`

**Files:** `src/engine/adapters/s3/transfer.ts`, `src/engine/adapters/s3/index.ts`,
`src/engine/data.ts`, `src/engine/rpc.ts`, `src/renderer/bridge/data.ts`.

`downloadObject` per §2.8 (temp file + rename + unlink, D10); `handleObjectDownload` in
`engine/data.ts` mirroring `handleMutate`'s shape (`data.ts:120-139`) but wrapped in
`runOp({ kind: 'transfer' })` and with **no** cache interaction — a download reads nothing the
cache holds; one line in `rpc.ts`'s handler table; one method on `bridge/data.ts`'s `data` object
with `NO_TIMEOUT` (`data.ts:19-21`).

---

### Commit 4 — `feat(main): file save/open dialogs over a new kira:files IPC domain`

**Files:** `src/main/ipc/files.ts` (new), `src/main/ipc/registry.ts`,
`src/shared/protocol/ipc.ts`, `src/preload/index.ts`, `src/renderer/bridge/control.ts`.

§2.10. Both handlers go through `ipc/errors.ts`'s `handle()` wrapper so a failure reaches the
renderer with its code prefix like every other domain.

**Must stay green additionally:** launch the app and confirm the two new `KiraApi` members exist on
`window.kira` (the preload is the one file where a missed line fails silently at runtime rather
than at typecheck).

---

### Commit 5 — `feat(s3): bounded body preview and the object-size gates`

**Files:** `src/engine/adapters/s3/read.ts`.

§2.9: the `OBJECT_BODY_PREVIEW_BYTES` gate replacing `MAX_BODY_DOWNLOAD_BYTES`, no `Body` row above
it, `memoryBytes` = `ContentLength`, and `countObject`'s matching arithmetic (F6).

**Why separate from commit 2:** it is the one commit that changes what an *existing*, already-shipped
read path returns (D4/OQ1), and it should be revertable on its own.

---

### Commit 6 — `feat(keyvalue): download, upload, delete and bounded edit for S3 objects`

**Files:** `src/renderer/state/objectStore.ts` (new),
`src/renderer/workbench/UploadObjectDialog.vue` (new),
`src/renderer/views/keyvalue/ObjectBodyEditor.vue` (new),
`src/renderer/views/keyvalue/KeyValueView.vue`, `src/renderer/views/keyvalue/keyValueMenu.ts`,
`src/renderer/project/menus.ts`, `src/renderer/App.vue`.

§2.11–§2.15, in that order. `keyValueMenu.ts` gets the same treatment as the toolbar: its
`'Edit value (string keys only)'` label (`:135`) and `'Delete key'` label (`:150`) become
object-aware, and a **Download…** row is appended when `caps.fileTransfer`.

**Must stay green additionally:** a manual pass against the demo LocalStack container (commit 7's
seed): download a small object and diff it against the source; edit a JSON object and confirm its
`ContentType` survives; upload from an empty bucket's tree row; delete from the tree and from the
tab; check every disabled state's tooltip text; check a read-only connection leaves only Download
enabled.

---

### Commit 7 — `feat(demo): more and larger S3 sample content`

**Files:** `scripts/demo-dbs/s3/seed.sh`, `scripts/demo-dbs/README.md`.

The seed grows from 3 objects in 2 buckets to roughly 1,220 objects in 3 buckets, chosen so every
state this phase introduces is reachable by hand:

| What | Why it exists |
|---|---|
| `kira-demo-bucket/readme.txt` with `--metadata seeded=true` | closes the drift with the test fixture (F22) — the `Metadata.*` rows had no demo coverage |
| `kira-demo-bucket/reports/2024/summary.json`, `reports/notes.txt` | unchanged — the existing nesting/CommonPrefixes demo |
| `kira-demo-bucket/reports/quarter one (Q1).json` | a key with spaces and parentheses — exercises path encoding through download, delete and the tab title |
| `kira-demo-bucket/sizes/tiny.txt` (0 bytes) | the `ContentLength === 0` branch: a Body row that exists and is empty |
| `kira-demo-bucket/sizes/small.json` (~4 KB) | the ordinary editable case |
| `kira-demo-bucket/sizes/medium.csv` (~512 KB) | editable, but big enough that the editor's responsiveness is visible |
| `kira-demo-bucket/sizes/large.log` (~2 MB) | **renders, does not edit** — between `OBJECT_BODY_EDIT_BYTES` and `OBJECT_BODY_PREVIEW_BYTES` |
| `kira-demo-bucket/sizes/huge.bin` (~8 MB) | **neither renders nor parses** — the D4 over-limit strip, and the object Download exists for |
| `kira-demo-bucket/sizes/logo.png` (a real small PNG) | the binary/not-UTF-8 edit refusal (D7), with a correct `image/png` |
| `kira-demo-bucket/bulk/item-0001.json` … `item-1200.json` | 1,200 objects under one prefix, past `ListObjectsV2`'s 1,000-key page — exercises `listPrefixChildren`'s continuation loop, which the 3-object seed never did |
| `kira-uploads-bucket` (empty) | the upload target, and the D17 case of a bucket with nothing to open |
| `kira-empty-bucket` | unchanged |

Generated with `awslocal` and shell builtins only (`head -c … /dev/zero | tr '\0' 'x'` for the
deterministic large files, `base64 -d` from an inline literal for the PNG) — no new tooling, and
the whole seed stays a `docker exec -i kira-sqs bash < seed.sh` one-liner
(`scripts/demo-dbs/seed.sh:34-35`). `mb` calls become idempotent (`|| true`) and the README's
§"S3 gets two buckets" paragraph (`:107-113`) is rewritten.

---

### Commit 8 — `test(s3): cover transfer, delete and bounded edit`

**Files:** `tests/db/fixtures/0007_s3_seed.ts`, `tests/db/s3.spec.ts`, `tests/ui/s3.spec.ts`, plus
one added `fileTransfer` assertion in each of `tests/db/{postgres,mariadb,mongo,redis,kafka,sqs}.spec.ts`'s
existing cap-honesty scenario.

Full list in §5. **These cannot be executed in this sandbox** (AGENTS.md's Docker CDN block); the
commit message must say so, exactly as P24's and P26's did.

---

### Commit 9 — `docs(spec): record S3 mutations in §1, §5, §8.8, §8.10, §10 and §11`

**Files:** `docs/v1/SPEC.md`.

- **§1** — *"S3 stays read-only"* is now false and must be rewritten: S3 gains object edit/delete/
  upload plus download, executed immediately like Mongo/Redis/Kafka/SQS, with an explicit size
  bound on edit.
- **§5**'s `Caps` block gains `fileTransfer`.
- **§8.8**'s key/value section describes the S3 half: download and upload for any object, delete for
  any object, edit bounded by size and by UTF-8 validity, all immediate.
- **§8.10**'s right-click coverage gains the S3 object/bucket/prefix rows (P17's plan noted their
  absence was consistent with there being nothing to hang there — that is no longer true).
- **§10**'s P33 row gains its "Implemented …" note, in P22/P23/P24's style, including the
  unverifiable-here test caveat.
- **§11**'s tree annotation gains `main/ipc/files.ts`, `shared/domain/object-store.ts`,
  `state/objectStore.ts` and the two new components.

## 5. Tests

### 5.1 `tests/db/s3.spec.ts` — two rewritten scenarios, eleven new

Scenarios **3** and **14** are rewritten, not deleted (F23): scenario 3 asserts the four write caps
and `fileTransfer` are now `true` (and that `sql`/`definition` are still `false`); scenario 14
keeps asserting `execute()` throws `E_UNSUPPORTED` and drops the `preview`/`mutate` half. New
scenarios, numbered 17 onward:

| # | Name | Asserts |
|---|---|---|
| 17 | `preview() renders exact commands for update/insert/delete without executing` | the three command strings of §2.7; a re-read afterwards shows the object unchanged |
| 18 | `read: an object over the preview limit has no Body row and reports its size` | `fieldsOf(page).Body` is `undefined`, `page.memoryBytes` equals the fixture's byte length, and the metadata rows are all present (D4/D5) |
| 19 | `count: the Body row is excluded for an over-limit object` | `count()` on the over-limit object is exactly one lower than on an equivalent small one (F6) |
| 20 | `mutate update replaces the body and preserves ContentType and user Metadata` | edit `MUTABLE_BUCKET/editable.json`; re-read shows the new body, the original `application/json`, and `Metadata.seeded` intact (D11) |
| 21 | `mutate update on a read-only connection is refused and writes nothing` | a second adapter connected with `readOnly: true` rejects `E_UNSUPPORTED`; the object is byte-identical afterwards (D18) |
| 22 | `mutate delete removes the object; deleting a missing key is E_QUERY` | `affectedRows === 1`, a re-read is `E_QUERY` (`s3/errors.ts:6`'s own precedent), a second delete of the same key is `E_QUERY`, not silent success (D13) |
| 23 | `mutate insert uploads a local file with its length and content type` | write a temp file, insert with `$file`/`$contentType`, re-read and compare bytes and `ContentType` |
| 24 | `mutate insert refuses an existing key and a missing source file` | `E_QUERY` naming the key; `E_QUERY` for a nonexistent `$file`, with the target key never created (D13) |
| 25 | `downloadObject writes the exact bytes and returns the count` | round-trips `NESTED_OBJECT_BODY` through a temp path; `bytes` equals the file size; the file is not left with a `.kira-partial-` sibling |
| 26 | `downloadObject with an already-aborted signal leaves no file behind` | `E_CANCELLED`, `existsSync(dest) === false`, and no `.kira-partial-*` entry in the directory (D10) |
| 27 | `downloadObject on a nonexistent object is E_QUERY and creates no file` | the `HeadObject` pre-check fires before anything is opened |

Plus one line in each other engine spec's cap-honesty scenario: `expect(<engine>Caps.fileTransfer).toBe(false)`.

### 5.2 `tests/ui/s3.spec.ts` — six new scenarios

The existing single scenario (tree + object browser) stays unchanged. All six new ones stub the
native dialogs through `kira.app.evaluate(({ dialog }) => …)` (F25) and handle `window.confirm`
with `page.once('dialog', d => d.accept())` (F12).

1. **`s3 — download an object to disk`** — Download from the object tab writes a file whose bytes
   equal `ROOT_OBJECT_BODY`, and an Operations panel row of kind `transfer` appears with a
   `GetObject … -> …` command.
2. **`s3 — edit a small object's body`** — Edit opens the inline `CodeMirrorHost`, Save reloads the
   tab with the new Body, and the `ContentType` row is unchanged (D11 through the UI).
3. **`s3 — an over-limit object is neither rendered nor editable`** — the over-limit fixture object
   shows the size badge and the over-limit strip, has no `Body` row, has Edit disabled with a
   tooltip naming the limit, and has Download enabled (D4).
4. **`s3 — a binary object refuses to edit but still previews`** — the PNG fixture renders its
   metadata and a lossy body, Edit is disabled with the not-UTF-8 reason, Download works (D7).
5. **`s3 — upload from an empty bucket's tree menu`** — Upload file… on `EMPTY_BUCKET`, stubbed open
   dialog, dialog prefills key and content type from the filename, Upload creates the object, the
   tree row appears and the new tab opens (D17).
6. **`s3 — delete, and the read-only guard`** — delete an object from the tree row (confirm
   accepted) and from a tab; then toggle the connection read-only and assert Edit/Delete/Upload are
   disabled with the read-only reason while Download stays enabled (D18).

### 5.3 What is deliberately not added

- **No unit tests** — SPEC §9 is two suites only.
- **No new spec files.** S3 has one DB spec and one UI spec; both grow.
- **No perf/budget scenario for the editor.** `budgets.spec.ts` measures grid and cell-editor
  interactions against Postgres; a 1 MB CodeMirror mount behind an explicit Edit press is not one of
  §2.1's listed budgets, and adding a container-backed budget test would make the budget suite
  depend on LocalStack for one number.
- **No test that a >5 GiB upload is refused** (D12) — creating a 5 GiB fixture to assert a `stat()`
  comparison is not a proportionate use of CI minutes; scenario 24's missing-file case covers the
  same pre-flight branch.

### 5.4 What cannot be verified in this sandbox

Every `tests/db/` scenario above and all seven `tests/ui/s3.spec.ts` scenarios need a LocalStack
container. Per AGENTS.md, Claude Code's Linux web containers cannot pull images
(`production.cloudfront.docker.com` is blocked by network policy), so **none of §5.1 or §5.2 can be
run here**. They must be run in CI or on the macOS/Colima box before this phase is called verified,
and the phase hand-off must say explicitly whether that happened — the same caveat P24, P25 and P26
each recorded.

## 6. Explicitly out of scope

- **Bucket lifecycle**: create, delete, rename, region/policy/CORS/lifecycle/versioning/ACL/tagging
  views. `caps.definition` stays `false` for S3 for the reason P23 D11 already recorded (a bucket's
  properties are five SDK calls a single-bucket IAM policy routinely denies).
- **Recursive prefix delete, bulk/multi-select delete, and folder upload** (D13). A capped
  recursive delete would silently half-delete; doing it properly needs an unbounded-listing story
  the app deliberately does not have.
- **Multipart upload and resumable transfers** (D12). Single `PutObject`, capped at AWS's own 5 GiB,
  with an accurate refusal above it.
- **Presigned URLs, "copy public link", object copy/move/rename.** A rename is a `CopyObject` +
  `DeleteObject` pair with its own failure-midway semantics; none of it is in v1 scope.
- **Drag-and-drop upload** onto the tree or the view. The OS dialog is the complete flow; drag-drop
  is an additional affordance for the same operation, and adding it here would mean a second
  entry-point's worth of key-naming and content-type UI.
- **Progress reporting during a transfer.** `OpCtx.onProgress` exists but has no consumer anywhere
  in the tree (`scheduler/ops.ts:65-68`: *"No P1 consumer of progress events yet"*). Wiring a
  progress bar means a renderer-side consumer for **every** op kind, which is its own phase; a
  transfer shows as a running op with a working stop button, which is what §2.1 requires today.
- **Editing an object's metadata or content type in place.** Edit replaces the *body* and preserves
  everything else (D11); a metadata editor is a separate surface.
- **Any change to Redis's behaviour.** `redis/mutate.ts`, `redis/caps.ts` and the Redis half of
  `KeyValueView.vue`/`keyValueMenu.ts` keep behaving exactly as they do — the S3 work is added as a
  branch beside them, never by generalizing Redis's rules.
- **`views/grid/pendingChanges.ts` and §8.14's staged model** (D1).
- **The cell editor panel's `onEdit` seam** (D8/F19). S3 rows stay read-only in the panel.

## 7. Target tree at the end of P33

```
src/
  main/
    ipc/
      files.ts                    ← NEW: kira:files:chooseSave / chooseOpen (§2.10, D15)
      registry.ts                 ← + registerFilesHandlers()
  preload/index.ts                ← + the two files* invoke lines
  engine/
    adapters/
      adapter.ts                  ← + downloadObject(); roadmap comment amended (§2.6)
      postgres/ mariadb/ mongo/ redis/ kafka/ sqs/
        caps.ts                   ← + fileTransfer: false
        index.ts                  ← + downloadObject() E_UNSUPPORTED stub
      s3/
        caps.ts                   ← canInsert/canUpdate/canDelete/writable/fileTransfer → true
        index.ts                  ← preview()/mutate() wired; downloadObject(); readOnly captured
        mutate.ts                 ← NEW: update/insert/delete + preview() (§2.7)
        transfer.ts               ← NEW: downloadObject + openUploadBody, the only node:fs file (§2.8)
        read.ts                   ← preview ceiling; no Body row above it; memoryBytes (§2.9)
        catalog.ts client.ts errors.ts   unchanged
    data.ts                       ← + handleObjectDownload (runOp kind 'transfer', no cache touch)
    rpc.ts                        ← + one handler-table line
  renderer/
    App.vue                       ← + <UploadObjectDialog v-if="uploadDialogState.open" />
    bridge/
      control.ts                  ← + filesChooseSave / filesChooseOpen
      data.ts                     ← + objectDownload
    state/
      objectStore.ts              ← NEW: upload-dialog state + download/upload/delete flows (§2.11)
    workbench/
      UploadObjectDialog.vue      ← NEW: choose file → key → content type → upload (§2.12, D17)
    project/
      menus.ts                    ← objectMenu + Download/Delete; bucketMenu/prefixMenu + Upload (§2.15)
    views/keyvalue/
      ObjectBodyEditor.vue        ← NEW: inline CodeMirrorHost + Save/Cancel (§2.13, D8)
      KeyValueView.vue            ← S3 branch on the mutation affordances + Download + strips (§2.14)
      keyValueMenu.ts             ← object-aware labels + a Download row
      keyValueMutations.ts        state.ts kvPage.ts kvSearch.ts   unchanged
  shared/
    caps.ts                       ← + fileTransfer (§2.1)
    domain/
      object-store.ts             ← NEW: transfer types, sentinels, contentTypeForFilename (§2.3)
      ops.ts                      ← + 'transfer' op kind (§2.5)
    protocol/
      page.ts                     ← + the three size constants (§2.2)
      data-ops.ts                 ← + DATA_OP.objectDownload and its wire shapes (§2.4)
      ipc.ts                      ← + the two files* channels and KiraApi members
scripts/demo-dbs/
  s3/seed.sh                      ← 3 buckets, ~1,220 objects, the full size/type ladder (§4 c7)
  README.md                       ← the S3 paragraph rewritten
tests/
  db/
    fixtures/0007_s3_seed.ts      ← + MUTABLE_BUCKET and the ladder objects (D14)
    s3.spec.ts                    ← scenarios 3 and 14 rewritten, 17–27 added (§5.1)
    postgres|mariadb|mongo|redis|kafka|sqs.spec.ts   ← one fileTransfer assertion each
  ui/
    s3.spec.ts                    ← + six scenarios (§5.2)
docs/v1/
  SPEC.md                         ← §1, §5, §8.8, §8.10, §10's P33 row, §11
  plans/P1-connections-and-tree.md ← §4b: the Adapter interface widened by downloadObject
  plans/P33-s3-mutations.md       ← this file
```

Net: **six files added**, no file deleted, ~30 edited.

## 8. Acceptance checklist

- [ ] An S3 object tab shows **Download**, **Upload**, **Edit** and **Delete**; a Redis key tab is
      byte-for-byte unchanged in behaviour, labels and testids.
- [ ] Download writes the object's exact bytes to the chosen path, appears in the Operations panel
      as a `transfer` row with a real command string, and its stop button actually aborts the
      transfer.
- [ ] A cancelled or failed download leaves **no** file at the destination and **no**
      `.kira-partial-*` sibling.
- [ ] Upload works from a bucket row, a prefix row, and an open object's toolbar; the key and
      content type are prefilled and editable; uploading onto an existing key is refused with the
      key named; the new object appears in the tree and opens in a tab.
- [ ] Delete works from an object row (including via the `Delete` key on a selected row) and from
      the object tab, always behind a confirm; the tab then shows the ordinary "no longer exists"
      error rather than a stale page.
- [ ] Edit is **enabled** for a text object ≤ 1 MB and writes the new body back while preserving
      `ContentType`, the user `Metadata` and the other preserved headers (D11).
- [ ] Edit is **disabled, with a reason naming the actual number**, for an object over 1 MB, for one
      whose body was truncated, and for one that is not valid UTF-8.
- [ ] An object over 4 MB shows its metadata rows, its size badge, and an over-limit strip — and
      **no** `Body` row: the network trace shows a `HeadObject` and no `GetObject`.
- [ ] `count()` on that object matches the number of rows the view actually renders.
- [ ] A **read-only** connection disables Edit, Upload and Delete with the read-only reason, leaves
      Download enabled, and the engine rejects a mutation even if the UI is bypassed.
- [ ] Nothing in the phase's diff touches `views/grid/pendingChanges.ts`; there is no S3 pending
      set, no Commit/Rollback and no preview panel.
- [ ] `caps.fileTransfer` is `true` only for S3; no renderer file branches on `record.kind === 's3'`.
- [ ] `bun run lint`, all three `typecheck:*` splits and `bun run build` are clean; `smoke`,
      `startup`, `workbench`, `connections` pass locally.
- [ ] `scripts/demo-dbs/seed.sh` runs end to end against a fresh `docker compose up`, and every
      state in the acceptance list above is reachable by hand from the seeded data.
- [ ] `tests/db/s3.spec.ts` (27 scenarios) and `tests/ui/s3.spec.ts` (7 scenarios) pass in CI or on
      the macOS/Colima box — and if they could not be run, the hand-off says so explicitly (§5.4).
- [ ] The other six `tests/db/*.spec.ts` suites and `tests/ui/redis.spec.ts` pass unchanged apart
      from the one added `fileTransfer` assertion each.
- [ ] SPEC §1 no longer says S3 is read-only; §5, §8.8, §8.10, §10 and §11 all describe what
      shipped.

## 9. Open questions for the user

**OQ1 — the preview ceiling drops from 32 MB to 4 MB (D4), which is a deliberate reversal of shipped
behaviour.** Today a 12 MB log file shows its first 4 MB, marked `truncated`. After this phase it
shows its metadata plus "too large to display — download it", and the Download button hands over all
12 MB. The reasoning is in D4: the current 32 MB number causes the app to transfer and decode up to
8× what it can ever display, and once Download exists, "the first 4 MB of a file you cannot edit
anyway" is a strictly worse answer than "the whole file, locally, in your own editor".
**Recommendation: proceed.** If the partial preview is wanted regardless, the alternative is to keep
a truncated-render tier between 4 MB and, say, 32 MB — but then the *"if it's too big don't
render/parse it at all"* line only starts applying at 32 MB, and the edit gate needs a third number
rather than falling out of "the Body row exists".

**OQ2 — object tags and ACLs are not preserved across an edit (D11).** `HeadObject` does not return
either; preserving them needs `GetObjectTagging` + `GetObjectAcl` on every edit and their `Put`
counterparts after, i.e. four extra calls per save, each of which a narrow IAM policy commonly
denies (the same failure mode P23 D11 cited for bucket properties).
**Recommendation: leave them out of this phase and say so in §8.8**, since an object with tags is
uncommon in the kind of bucket this client is used against and a denied `GetObjectTagging` would
otherwise turn every edit into a failure. If tag preservation matters, the honest version is a
per-call degradation with a visible note, which is its own piece of work.

**OQ3 — no recursive prefix delete (D13).** The tree makes a prefix *look* like a folder, so
"Delete" not appearing on one is a visible gap. The reason it is not offered is that it cannot be
offered honestly under the app's own round-capped listing discipline — a partial recursive delete
reported as a success is worse than no button. **Recommendation: leave it out and record it as a
named follow-up**; if it is wanted, it needs its own design for the unbounded-listing and
partial-failure cases (a progress-reporting op, a resumable delete, and a real count in the
confirmation), not a checkbox on this phase.

**OQ4 — upload refuses to overwrite an existing key (D13).** This mirrors Redis's `SET … NX`
exactly, and "replace this object's contents" is what Edit is for — but Edit is bounded at 1 MB and
requires the body to be text, so there is currently **no** way to replace a large or binary object
with a new local file. That is a real gap for the "upload a new build of this artifact" workflow.
**Recommendation: add a "Replace existing object" checkbox to the upload dialog, unchecked by
default**, carrying an `$overwrite` sentinel that skips the `HeadObject` collision check. It is
roughly fifteen lines across the dialog and `s3/mutate.ts` and it closes the gap without weakening
the default. It is raised rather than decided because it makes a destructive path reachable in one
extra click, and that should be an explicit choice.
