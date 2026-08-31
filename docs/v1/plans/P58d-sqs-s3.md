# P58d — SQS and S3, native (M8)

> **Parent:** `docs/v1/plans/P58-go-native-adapters.md`. That document's §0.3 splits P58 into six
> sub-phases and assigns **P58d** the single milestone **M8 — SQS, S3**: *"S3 carries
> `caps.fileTransfer` and the temp-file-then-rename download."* Its sub-phase table's own
> justification for grouping the two: *"The two service-protocol SQL-adjacent adapters sharing one
> SDK (`aws-sdk-go-v2`), with no new driver decision this plan has not already settled."* §1.1 checks
> that justification against the tree and finds it exactly right about the driver and materially
> wrong about the sharing — which changes this plan's shape (one ~70-line helper package, not a
> `mysqlfamily`-style shared core), not its scope.
>
> **Predecessors:** `docs/v1/plans/P58a-substrate-postgres.md` (M0–M5), `P58b-mysql-sqlite-clickhouse.md`
> (M6.0–M6.4) and `P58c-mongo-redis.md` (M7.0–M7.4), all complete; each records real results in its
> own §12/§13. **Seven of ten kinds are Go-native at `b40a09e`** (P58c M7.4's own commit):
> `postgres`, `mariadb`, `mysql`, `sqlite`, `clickhouse`, `mongodb`, `redis`. RabbitMQ was dropped
> from v1's scope before P58c was written (the parent plan's amendment note) — ten kinds remain, not
> eleven. **P58d writes no substrate**: `internal/page`, `internal/enginecache`,
> `internal/enginebackend` and `internal/adapterhost`'s scheduler/dispatcher/session halves are
> untouched, and even the two testsupport lifts M8.1 makes are test-only (§1.3).
>
> **What this document may not relitigate.** The parent's decisions (**P58 D1–D20**), its research
> (§1), its target tree (§3), its designs (§4), its testing plan (§5) and its sequencing (§9) are
> settled, as are **P58a A1–A21**, **P58b B1–B24** and **P58c C1–C25** for everything already built.
> Where this plan deviates from a parent *design* it says so in the open with the reason (§2's
> **P58d D3** is the one that matters); where the tree contradicts a predecessor plan's own closeout
> claim, §1 records the tree (§1.11 does exactly that, three times).
>
> **Decision numbering, and the collision this sub-phase cannot avoid.** P58a used `A<n>`, P58b
> `B<n>`, P58c `C<n>` — a letter per sub-phase. P58d's letter is **D**, which is also the letter the
> *parent* plan uses for its own twenty top-level decisions. Every child plan so far has written a
> parent decision as **P58 D\<n\>** in full, with the prefix, precisely to keep that space clear.
> This document keeps the sub-phase-letter convention and makes the disambiguation absolute:
>
> - **A bare `D<n>` never appears in this document.** Not once, not in a table cell, not in a
>   parenthetical.
> - This plan's own decisions are always **P58d D\<n\>** — including their own section headers in §2.
> - A parent decision is always **P58 D\<n\>**; P58a's are **P58a A\<n\>**; P58b's **P58b B\<n\>**;
>   P58c's **P58c C\<n\>**.
> - Checkpoints keep P58c's rule too: a checkpoint is always written with the word "checkpoint"
>   immediately before it (**checkpoint C1c**). P58d declares no new checkpoint (§7).
>
> Every claim below was read out of the tree as it stands at `b40a09e` with `git grep`, `wc -l` and
> the actual files. Every Go SDK claim is marked **researched** — and, unlike P58c, "researched" here
> means the module's own source was downloaded from `proxy.golang.org` and read (`aws-sdk-go-v2`
> v1.45.1, `service/s3` v1.109.1, `service/sqs` v1.48.1, `config` v1.33.1,
> `testcontainers-go/modules/localstack` v0.44.0, and Wails v3.0.0-beta.15 from this box's own module
> cache); the exact files and line numbers are cited where a claim rests on them. Anything that needs
> a *running* LocalStack to settle is **must be proven in M8.0** and appears in §6, never as a settled
> fact.

## 0. What this sub-phase is, and what it is not

### 0.1 The four bodies of work

1. **M8.0 — probes.** Throwaway Go programs, no product code, settling the five things this plan's
   decisions rest on that only a running LocalStack (or a real SDK call) can confirm: that LocalStack
   comes up under a bare `testcontainers.GenericContainer` in **this** sandbox (TC-4); the SQS
   client's own request shape, error types and cancellation behaviour (AWS-1); what
   `config.LoadDefaultConfig` does with a named profile that does not exist, and when (AWS-2); the
   S3 upload/download path under the SDK's **default checksum calculation**, plus `HeadObject`'s
   field values against LocalStack (AWS-3); and a character-by-character diff of the JS and Go
   renderings of an SQS message's `headers`/`attrs` cells (AWS-4). §6.
2. **M8.1 — the shared lifts.** Two test-only additions both M8.2 and M8.3 depend on and that are far
   cheaper before the adapters than after: `testsupport/spec.go` gains the **`StreamPage` readers** it
   has `TabularPage`, `DocumentPage` and `KeyValuePage` ones of today (§1.3 gap 1), and
   `testsupport/localstack.go` lands the shared LocalStack container starter plus the
   **operation-counting reverse proxy** two SQS scenarios need and Go has no `spyOn` for (§1.3 gap 2,
   **P58d D10**). **`nativeKinds` does not change in M8.1**, so the whole existing suite must stay
   green through it.
3. **M8.2 — SQS.** One `sqs` package plus the ~70-line `awscfg` helper both adapters share
   (**P58d D2**), on `aws-sdk-go-v2/service/sqs`. `nativeKinds` gains `sqs`. First `StreamPage` Go
   has ever produced.
4. **M8.3 — S3.** One `s3` package on `aws-sdk-go-v2/service/s3`, carrying **the first real
   `DownloadObject` in the whole phase** — every native adapter so far returns `E_UNSUPPORTED` there
   because its `caps.fileTransfer` is false, and S3's is the only `true` in the app. `nativeKinds`
   gains `s3`, reaching **nine of ten**; only `kafka` is left for P58e.

### 0.2 Not in this sub-phase

- **No substrate change at all.** Not one line under `internal/page`, `internal/enginecache`,
  `internal/enginebackend`, `internal/adapterhost` (beyond the two `nativeKinds` entries), or
  `internal/adapters`' own shared files. §1.3 is the evidence: every hook these two adapters need
  already exists, including `page.NewStreamPageBuilder` (present since P58a M2, never called), and
  `page.NewKeyValuePageBuilder` (first called by redis in P58c). Every constant S3 needs —
  `ObjectBodyPreviewBytes`, `ObjectBodyEditBytes`, `ObjectUploadMaxBytes` are all already in
  `page/chunk.go`.
- **No `src/` change at all.** Not one file, not one line — the same strong form **P58b B21** and
  **P58c C22** asserted and met. `git diff --stat src/` returns empty at every milestone boundary
  (**P58d D21**).
- **No `tests/ui/` change and no `tests/ipc/` change.** **P58a A10** still holds.
  `tests/ipc/sqs/`'s backend half keeps driving the TypeScript SQS adapter and keeps passing; §1.12
  records what that costs and why bringing **P58 D13**'s generator port forward for one adapter
  would be worse.
- **No new placeholder move.** Unlike P58c, P58d inherits **no** placeholder debt: `TestKindNodeServed`
  is already `"kafka"` (`adapterhost/router.go`) and `tests/e2e-real/mariadb-real.spec.ts`'s
  coexistence half is already Kafka-paired. §1.10 shows the grep. **P58c C14/C15 paid for this
  sub-phase's silence**, and that is worth naming rather than enjoying quietly.
- **No new `tests/e2e-real/` spec** — and, specifically, **not** the S3 `objectDownload` spec
  P58 §5.5 floats. §5.6 shows why it cannot be built: Wails v3.0.0-beta.15's server platform has no
  file-dialog implementation at all.
- **No deletion of `src/engine/`.** Both TypeScript adapters stay where they are; P58f deletes them.
- **`shell/go.mod` gains exactly four runtime modules** (`aws-sdk-go-v2`, `.../config`,
  `.../credentials`, `.../service/sqs`, `.../service/s3` — four named plus the core, see **P58d D1**)
  and **no test-only testcontainers module** (**P58d D22**).

### 0.3 The one thing in P58d that is hard to walk back

Everything M8.1–M8.3 adds is additive Go: two new packages, one helper package, two test fixtures,
one counting proxy.

**Flipping a `nativeKinds` bit is not additive**, and P58d flips two. P58b §0.3 and P58c §0.3 both
said why. What is *different* in P58d — and better — is that neither flip breaks anything else in the
tree (§1.10): no test constant moves, no `tests/e2e-real/` spec loses its subject, no other package's
test comment goes stale. The structural answers are therefore only the two that always apply:

1. **Each kind flips in its own commit**, at the end of its own milestone (**P58d D19**).
2. **The Go acceptance spec lands and fails before its adapter** (**P58 D12** / its **R3**), per
   adapter.

What *is* genuinely new risk, and gets §6 and §5.4 in proportion: **S3's `DownloadObject` is the
first adapter method in this phase whose failure mode is a wrong file on the user's disk**, not a
wrong page in a tab. `transfer.ts`'s temp-file-then-rename discipline exists for exactly that
(P58 §0.2 names it in its "no behavioural rewrite" list), and the port has to reproduce it under a
cancellation model that changes (**P58d D3**) rather than one that stays put.

## 1. What re-reading the tree found

### 1.1 The parent's grouping justification, checked — right about the driver, wrong about the sharing

**"Sharing one SDK … with no new driver decision this plan has not already settled."** The first half
is exactly right and the second half is *more* right than the parent knew: **P58 D6**'s table names
`aws-sdk-go-v2/service/sqs` and `aws-sdk-go-v2/service/s3`, both are still the only real option, and
this is the first sub-phase since P58a to reverse **no** parent driver decision (P58b reversed two —
**P58b B7** for SQLite, **P58b B11** for ClickHouse). **P58d D1** confirms both rows verbatim.

**"The two service-protocol SQL-adjacent adapters."** This is where the grouping's implied
economy — one SDK, therefore one shared body of work — does not survive contact with the files.

- What the two adapters genuinely share is **98 lines out of 1 586**: `sqs/client.ts` (49) and
  `s3/client.ts` (49) are near-identical, and `s3/client.ts`'s own header says so
  (*"Mirrors sqs/client.ts exactly (same D8/D9 fields-mode repurposing of database→region,
  username→named profile; same URI-mode static-key exception; same `options.endpoint` override)"*).
  The only difference is one clause: S3 additionally sets `forcePathStyle: true` whenever an endpoint
  override is present. `sqs/errors.ts` (34) and `s3/errors.ts` (35) are near-identical too, differing
  by exactly **one** entry in the `E_AUTH` name list — `InvalidAccessKeyId`, present in S3's, absent
  from SQS's.
- Everything else is disjoint. Different page kind (`StreamPage` vs `KeyValuePage`), different
  pagination (`batch` vs `token`), different tree shape (flat one-level vs unbounded `/`-delimited),
  different mutation sentinels (`$body`/`$headers`/`messageId` vs `_key`/`$value`/`$file`/
  `$contentType`), different `caps` in nine of twenty-one fields, and one of them has a `definition`
  and the other does not. There is no `mysqlfamily`-shaped core here.

So P58d's real shape is: **one ~70-line shared helper, two entirely independent adapters, one page
builder that has never been called, and the phase's first real file transfer.** **P58d D2** sizes the
helper accordingly — a package, not a core.

**One thing the grouping *understates*.** These two are, by a wide margin, the phase's **most
different adapters from everything already ported** in one specific respect: their cancellation model
is the exact inverse of the four SQL adapters', of Mongo's, and of Redis's. §1.4 is that finding, and
**P58d D3** is the decision it forces. A reader arriving from P58c with `RunWithAbortRace` in hand
will reflexively reach for it and will, silently, destroy the only cancellation mechanism either
adapter has.

### 1.2 The two adapters, measured

`git grep -c "" -- src/engine/adapters/<dir>` for this plan. **16 files, 1 586 lines**, matching the
parent's §1.1 totals exactly (671 + 915).

| File | sqs | s3 |
|---|---:|---:|
| `index.ts` | 157 | 168 |
| `mutate.ts` | 141 | **232** |
| `read.ts` | 135 | 150 |
| `catalog.ts` | 56 | 140 |
| `definition.ts` | 63 | — (`definition: false`) |
| `client.ts` | 49 | 49 |
| `caps.ts` | 36 | 48 |
| `errors.ts` | 34 | 35 |
| `transfer.ts` | — | **93** |
| **subtotal** | **671** (8 files) | **915** (8 files) |

Three shapes worth naming before anyone starts:

- **`s3/mutate.ts` (232 lines) is the largest file in either adapter**, and it is three independent
  operations plus five sentinel extractors, not one algorithm. `applyUpdate` is HeadObject →
  PutObject-with-preserved-attributes; `applyInsert` is HeadObject-as-a-collision-check →
  `openUploadBody` → PutObject; `applyDelete` is HeadObject-as-an-existence-check → DeleteObject.
  Each of the three issues **two** round trips, deliberately, and the reason is different each time.
- **`s3/transfer.ts` (93 lines) is the smallest file with the largest blast radius.** It is the only
  file in either adapter that touches the filesystem, and the only implementation of `DownloadObject`
  anywhere in `src/engine/adapters/` — the other nine adapters' `downloadObject` is a two-line
  `unsupported()` throw. §1.5.
- **`sqs/read.ts`'s 135 lines hide two adapter-local caches with JavaScript-specific semantics.**
  `receiptHandles` is a `Map` whose **insertion order** is load-bearing for its 5 000-entry eviction,
  and neither it nor `index.ts`'s `queueUrls` is guarded by anything, because JavaScript is
  single-threaded. Both properties evaporate in Go. **P58d D9**.

**Expected Go size.** The calibrations this repo has: P58a's Postgres ran 1.26× the TypeScript;
P58b's three and P58c's two ran roughly the same. Applying it: **~845 for `sqs`, ~1 150 for `s3`**,
plus ~70 for `awscfg` and ~1 100 of Go test. Two adjustments in known directions: `s3/mutate.go` will
run *shorter* than 232×1.26 (`preservedAttributes`'s seven-key `Record<string, unknown>` spread
becomes seven typed field assignments — **P58d D13**), and `sqs/read.go` will run *longer* (the
ordered bounded map **P58d D9** requires is more code than a `Map` plus `.keys().next()`).

### 1.3 What the substrate already gives P58d for free — and the two gaps

Read out of `shell/internal/`, not inferred.

**Free, already built, no change needed:**

| Needed by P58d | Where it already is | Notes |
|---|---|---|
| `Adapter`, `Caps`, `Deps`, `OpCtx`, `ConnectInfo`, `ReadRequest`/`CountRequest`/`CountResult`, `TreeChildren` | `internal/adapters/adapter.go`, `caps.go` | Both implement the interface verbatim. `Caps.Pagination` already has both constants these two need — `PaginationBatch` and `PaginationToken` — and **neither has ever been emitted by a native adapter** |
| `model.ObjectDownloadRequest` / `model.ObjectTransferResult` | `internal/storage/model/objectstore.go` | Complete, with `Bytes int64` and its `json:"bytes"` tag. Written in P58a and never yet returned by a real implementation |
| The eight error codes, `Error`, `New`, `CodeOf`, `Unsupported`, `NoQueryConsole`, `AssertWritable`, `CheckNotStarted`, `CheckCancelled`, `RequireConnected` | `internal/adapters/errors.go` | Both `errors.ts` ports map onto this closed set |
| `Register(kind, ctor)` from each package's own `init()` | `internal/adapters/registry.go` | **No edit to `registry.go`.** `shell/main.go` gains two blank imports (§4.7's most-forgotten step) |
| `page.NewStreamPageBuilder(visibilityTimeoutSeconds *int)`, `page.StreamRow`, `StreamPage`'s `MarshalJSON` with `"kind":"stream"` and the five chunk fields | `internal/page/builder.go` | Present, complete, **never called** — P58a M2 ported all four builders; SQS is the first native producer of this one |
| `page.NewKeyValuePageBuilder(redisType string, ttlMs, memoryBytes *int64, singleRow bool)`, `page.UnpagedPosition` | `internal/page/builder.go` | First called by redis in P58c M7.4; S3 is the second caller and the only one that passes `redisType: "object"` |
| `page.ObjectBodyPreviewBytes` (4 MB), `page.ObjectUploadMaxBytes` (5 GiB), `page.ObjectBodyEditBytes`, `MaxCellBytes` | `internal/page/chunk.go` | All four already present, ported from `page.ts`. **S3 needs no new constant** |
| L2/L3 cache, cache-aside discipline, op scheduler, panic boundary, `op:start`/`op:end`, the data-op dispatcher, request `Validate()`s, the per-kind router, the single-writer stream session | `internal/enginecache/`, `internal/adapterhost/` | None of it is kind-specific. `adapterhost/data.go`'s `ObjectDownload` already runs the download under `RunOp` with `Kind: "transfer"` and **no cache interaction at all**, and `wire.go`'s `Validate()` already bounds `destPath` at 4 096 runes |
| `model.NodePath`/`PathSegment`/`TreeNode`/`ObjectDefinition`/`DefinitionSection`, `model.MutationPlan`/`MutationRowOp`/`MutationResult`, `model.RowValues` (order-preserving, **P58a A4**) | `internal/storage/model/` | Every type both adapters name |
| `testsupport.IsDockerAvailable`, `DockerUnavailableMessage`, `fixture[T]`'s memo + the `TestMain`-not-`t.Cleanup` rule (**P58b B15**), `Seg`/`NodePath`/`ChildNames`/`ContainsName`/`Strp`/`KVPairs`/`KVValueAt` | `internal/adapters/testsupport/fixture.go`, `spec.go` | Two new fixtures plug straight into `fixture[T]`; S3's suite reuses `KVPairs` unchanged |
| `Router.childrenNative`'s nil-`Nodes` normalization | `adapterhost/router.go` (**P58c C16**) | Landed in P58c M7.1. Both P58d adapters return `[]` at leaves, and the router now guarantees `"nodes":[]` on the wire regardless |
| The renderer's dual chunk decoder | `src/renderer/bridge/port.ts`'s `toTypedArray` | Both branches verified present at `b40a09e` — this is why P58d touches no `src/` file (**P58d D21**) |

**Explicitly *not* used, and P58d is the first sub-phase for which this is true of the entire SQL
half *and* the page-token half:** all eighteen of `sqltext.go`'s functions and all nine of
`sqlmutate.go`'s. Neither adapter renders SQL, so `OrderedOps`, `RenderRowOp`, `LiteralRenderer`,
`AssertKeyIsPrimaryKey`, `AssertAffectedExactlyOne`, `WhereClause`, `QuoteIdent` and the whole keyset
planner are all unreachable. **And — unlike every previous sub-phase, including P58c — neither
adapter calls `EncodePageToken`/`DecodePageToken`/`RequestFingerprint`/`SafeInt` either.** SQS's
`PagePosition` is a constant literal (every field null or false, `strategy: 'batch'`) and S3's is
`unpagedPosition(1)`; S3's only continuation token is `ListObjectsV2`'s own, consumed inside a single
`listPrefixChildren` call and never crossing the wire. **That is not an omission to fix**, and it is
the reason §5.5 concludes that P58d adds no unit test at all.

**Not free — the two gaps, both test-only, both M8.1:**

1. **`testsupport/spec.go` has no `StreamPage` reader.** It grew `CellAt` (tabular) in P58b,
   `DocIDAt`/`DocBodyAt`/`KVPairs`/`KVValueAt` in P58c M7.1 (**P58c C16**'s sibling lift), and
   `chunkCellAt` is already the shared one-chunk primitive. `StreamPage` has five chunks (`Keys`,
   `Headers`, `Attrs`, `Timestamps`, `Bodies`) and no reader for any of them. The TypeScript side has
   the analogue this needs — `sqs.spec.ts`'s `rowAt` — and one suite writing its own copy is one
   chance to get the null-vs-empty distinction wrong in a helper, which is exactly the reasoning
   **P58c C16**'s gap 3 used.
2. **There is no LocalStack fixture, and there is no Go analogue of `spyOn`.**
   `tests/db/support/{sqs,s3}.ts` both start `localstack/localstack:3` through
   `@testcontainers/localstack`; the Go side has no LocalStack helper at all. Worse,
   `sqs.spec.ts`'s `countGetQueueUrlCalls` monkey-patches `SQSClient.prototype.send` — its own
   comment calls this *"the only vantage point outside [the adapter] that can see a cache hit vs. a
   miss"* — and Go has no prototype to patch and no way to reach inside an adapter that builds its
   own client. **P58d D10** solves this with a counting reverse proxy in front of LocalStack, which
   is a testsupport lift, not an adapter change.

### 1.4 Cancellation here is the exact inverse of every adapter ported so far

This is the single most important finding in the plan and the one a reader coming from P58c is most
likely to get backwards.

`sqs/index.ts` and `s3/index.ts` both implement:

```ts
async cancel(): Promise<boolean> {
  return false;
}
```

…and both carry a comment above them saying why it is permanent, not a gap.
`sqs/index.ts`: *"D14: the SDK's own abortSignal request option (passed straight through in
read.ts/pollQueue) is the sole cancel mechanism — this stays a permanent no-op, mirroring kafka's own
cancel()."* `s3/index.ts` says the same for its own `catalog.ts`/`read.ts`. Both `caps.cancel` are
nonetheless `true` (`sqs/caps.ts`: *"the SDK's own abortSignal request option is fully effective
(P10's D14)"*; `s3/caps.ts` the same), and that is honest for the same reason **P58c C9** found
Redis's honest: the cap describes whether pressing stop does something real, and it does.

**Where every previous sub-phase's adapters differ.** `adapters.RunWithAbortRace` (`abort.go`) exists
because pgx, `go-sql-driver/mysql`, `clickhouse-go`'s HTTP path, `modernc.org/sqlite` and
`mongo-driver` all honour `context.Context` natively **and each of those adapters has an
authoritative server-side kill** (`pg_cancel_backend`, `KILL QUERY &lt;threadId&gt;`,
`KILL QUERY … SYNC`, `sqlite3_interrupt`, `killOp`) that the driver's own abort would race and
usually win — dropping the tracking entry before the real kill runs. `abort.go`'s own doc comment
spells that out over twenty lines. Redis's **P58c C9** uses the same helper for the opposite reason:
go-redis *would* abort mid-RESP-stream and there is no server-side kill worth protecting.

**SQS and S3 have no server-side kill at all.** There is nothing for a driver abort to race. The
abort *is* the mechanism. Wrapping either adapter's SDK calls in `RunWithAbortRace` — which runs
`issue(context.WithoutCancel(ctx))` on its own goroutine — would mean:

- a cancelled `ReceiveMessage` with `WaitTimeSeconds` still runs to completion server-side, having
  **already made messages invisible to real consumers** for the queue's visibility timeout; and
- a cancelled `DownloadObject` returns `E_CANCELLED` to the caller **while its goroutine keeps
  streaming the object into the temp file**, so `s3.spec.ts`'s contract (*"leaves no file behind"*)
  becomes a race between the unlink and a writer that is still running. That is not a theoretical
  regression: it is the exact scenario the ported test asserts.

**P58d D3** therefore forbids `RunWithAbortRace` in both packages, and says so as a rule rather than
an omission, because "this adapter doesn't use the shared helper the other five use" reads like a
bug to anyone who does not know why.

### 1.5 S3 is the first native adapter with a real `DownloadObject`, and the call contract, end to end

Traced for this plan, because P58 §4.1's interface comment is the only place it is written down and
it is written from the adapter's side only.

1. **Renderer.** `src/renderer/state/objectStore.ts`'s `downloadObject(connectionId, path, tabId)`:
   reads `pathTail(path)`, refuses anything whose tail is not an `object` node, calls
   `control.filesChooseSave(tail.name)` — a **native save dialog** — and, if the user picked a path,
   calls `data.objectDownload({opId, tabId, connectionId, path, destPath})`. Two entry points reach
   it: `views/keyvalue/KeyValueView.vue` (the open object tab's toolbar) and `views/browse/menu.ts`
   (the Browse tab's context menu, with `tabId: null`).
2. **Control plane, for the dialog only.** `bridge/files.go`'s `FilesService.ChooseSave` →
   `internal/shell/app.go`'s `dialogs.SaveFile` → `app.Dialog.SaveFile()`. This is the half §5.6
   shows cannot run headless.
3. **Data plane.** `data.objectDownload` is `DATA_OP.objectDownload` = the wire string
   `"data:objectDownload"`, sent with **`NO_TIMEOUT`** (`src/renderer/bridge/data.ts`) —
   deliberately, since a multi-hundred-MB transfer has no sensible deadline.
4. **Go, today.** `adapterhost/dataframe.go` decodes an `ObjectDownloadRequestWire`, validates it
   (`wire.go`: `opId` required, `connectionId` required, `destPath` 1–4 096 runes), and calls
   `Dispatcher.ObjectDownload` (`data.go`). That runs the adapter call inside `host.RunOp` with
   **`Kind: "transfer"`** — `data.go`'s own comment: *"'transfer', not 'read' (P58 D9), so a
   multi-hundred-MB download reads as a file transfer in the Operations panel. No cache interaction
   at all"* — and returns `{bytes}`.
5. **Adapter.** `adapter.go`'s contract, verbatim: *"streams one object's bytes into req.DestPath. A
   read — never blocked by the connection's read-only flag. Gated by Caps().FileTransfer; every
   adapter with that flag false returns E_UNSUPPORTED. **Honours ctx mid-stream and leaves no file
   behind on cancellation or failure.**"*

Every one of those five layers already exists and none of them changes. **The whole of P58d's
download work is `s3/transfer.go`**, and the contract it must meet is already written down in Go, in
the interface's own doc comment, by P58a. §4.4 designs it against that sentence.

Two consequences worth stating because they are easy to miss:

- **`readOnly` must not gate it.** `s3/index.ts` calls `downloadObject` without `assertWritable`,
  and the Go port must not "helpfully" add the guard every mutation path has.
- **The `.kira-partial-<uuid>` temp file is a *sibling of destPath*, not a file in `os.TempDir()`**
  (`transfer.ts`, and its own comment says why: *"Same directory as destPath, so the rename is
  atomic on one filesystem"*). A Go port that reaches for `os.CreateTemp("", …)` breaks the atomicity
  the whole design exists for, and breaks it only on machines where `/tmp` is a different
  filesystem — i.e. silently, on someone else's laptop.

### 1.6 The AWS SDK for Go v2's own facts that decide the port's shape

All **researched** — read out of the module sources downloaded from `proxy.golang.org` for this plan.
Anything below that needs a running server to settle is deferred to §6 and marked.

| Fact | Source | Why it matters here |
|---|---|---|
| **`RequestChecksumCalculation` defaults to `WhenSupported`** — the SDK computes and sends a CRC32 checksum on every upload unless told otherwise | `aws-sdk-go-v2@v1.45.1/aws/config.go`, `aws/checksum.go` | For a **non-seekable** body the SDK falls back to `aws-chunked` trailer encoding, which some S3-compatible servers reject. **P58d D6** and AWS-3(a)/(b). The JS SDK v3 the TypeScript uses has no equivalent default, so this is a behaviour the port introduces, not one it inherits |
| **The endpoint override is `Options.BaseEndpoint *string`**, and path-style addressing is `Options.UsePathStyle bool` | `service/s3@v1.109.1/options.go` | Custom `EndpointResolver`s are deprecated in the same file (*"use the client option BaseEndpoint instead"*). **P58d D5** |
| **SQS speaks AWS JSON 1.0, not the legacy query protocol** — every operation sets `X-Amz-Target: AmazonSQS.<Operation>` | `service/sqs@v1.48.1/serializers.go` | Makes **P58d D10**'s counting proxy trivially reliable: one header comparison, no body parsing |
| **SQS's endpoint ruleset takes only `Region`/`UseDualStack`/`UseFIPS`/`Endpoint` — there is no `QueueUrl` parameter** | `service/sqs@v1.48.1/endpoints.go`; `grep QueueUrl endpoints.go` returns nothing | The host embedded in a returned `QueueUrl` never becomes the request target: it is a body field. This removes the `LOCALSTACK_HOST` hazard that would otherwise make the fixture fragile (§1.15). AWS-1(a) confirms it against a live container rather than resting on the read alone |
| **Typed error shapes exist for exactly the cases both `errors.ts` files care about** — SQS: `types.QueueDoesNotExist`, `types.InvalidAddress`, `types.InvalidSecurity`, `types.OverLimit`, `types.RequestThrottled`; S3: `types.NoSuchKey`, `types.NoSuchBucket`, `types.NotFound`, `types.AccessDenied`, `types.InvalidRequest` | `service/sqs@v1.48.1/types/errors.go`, `service/s3@v1.109.1/types/errors.go` | `types.NotFound` is what `HeadObject` returns for a missing key (S3's HEAD has no response body, so there is no `NoSuchKey` to parse) — the distinction **P58d D14** turns on |
| **`HeadObjectOutput.ContentLength` is `*int64`; `StorageClass` is a `types.StorageClass` enum (empty when absent); `Metadata` is `map[string]string`** | `service/s3@v1.109.1/api_op_HeadObject.go` | `head.ContentLength === undefined` becomes `head.ContentLength == nil`; `if (res.StorageClass)` becomes `if res.StorageClass != ""`. Both are one-character-class mistakes away from silently changing `countObject`'s answer |
| **`ReceiveMessageInput` has both a deprecated `AttributeNames []types.QueueAttributeName` and the current `MessageSystemAttributeNames []types.MessageSystemAttributeName`**; `MessageAttributeNames` is a plain `[]string` | `service/sqs@v1.48.1/api_op_ReceiveMessage.go` | `read.ts` passes `MessageAttributeNames: ['All']` and `MessageSystemAttributeNames: ['All']` — the Go port uses `[]string{"All"}` and `[]types.MessageSystemAttributeName{types.MessageSystemAttributeNameAll}`, never the deprecated field. AWS-1(c) confirms LocalStack honours it |
| **`types.Message.Attributes` is `map[string]string`; `MessageAttributes` is `map[string]types.MessageAttributeValue`, a five-field struct plus `noSmithyDocumentSerde`** | `service/sqs@v1.48.1/types/types.go` | §1.7 — the one wire-visible divergence in the SQS half |
| **`config.WithSharedConfigProfile(v)` exists and `config.SharedConfigProfileNotExistError` is a real exported type** returned by the shared-config loader | `config@v1.33.1/load_options.go`, `shared_config.go` | The direct analogue of `fromIni({profile})` — and the reason a bad profile now fails **at connect** rather than at the first request (§1.9, **P58d D7**) |

### 1.7 `json.Marshal` of an SDK struct is not `JSON.stringify` of a JS SDK object — the `headers` cell

`sqs/read.ts` builds a stream row's `headers` cell as
`JSON.stringify(message.MessageAttributes ?? {})`, and `sqs.spec.ts` asserts `row.headers.source`
matches `{ StringValue: 'seed' }`. That text is a real cell value: the stream view renders it, and
`tests/ipc/sqs/sqs.fixture.ts` freezes it.

The JS SDK v3 deserializes a message attribute into a plain object carrying **only the fields the
service sent** — `{"StringValue":"seed","DataType":"String"}`. Go's `types.MessageAttributeValue` is a
struct with five fields (`BinaryListValues [][]byte`, `BinaryValue []byte`, `DataType *string`,
`StringListValues []string`, `StringValue *string`), and `encoding/json` emits **all five**, with the
absent ones as `null`:

```json
{"BinaryListValues":null,"BinaryValue":null,"DataType":"String","StringListValues":null,"StringValue":"seed"}
```

The ported assertion would still pass (it reads one key off a parsed object), which is precisely why
this would ship. What would change is what a user sees in the `headers` column of every SQS page, and
what `tests/ipc/sqs/sqs.fixture.ts` would have to be regenerated to (P58f's problem, made worse).
**P58d D8** hand-writes the encoder.

A second, smaller divergence in the same cell, recorded so it is a decision rather than a discovery:
a **binary** message attribute is a `Uint8Array` on the JS side, which `JSON.stringify` renders as an
index-keyed object (`{"0":72,"1":101,…}`) — the same wart **P58 D5** exists to kill on the chunk wire.
Go's `[]byte` marshals as base64. No fixture exercises a binary attribute, so nothing observes it;
**P58d D8** picks base64 and records it as a deliberate, unobserved improvement rather than
reproducing a JS artifact on purpose.

### 1.8 Three timestamps, two formats, and the one the other native adapters already chose

`new Date(x).toISOString()` always emits exactly three fractional digits and a literal `Z`
(`2024-01-01T00:00:00.000Z`). Go's `time.RFC3339Nano` **drops trailing zeros**, so the same instant
formats as `2024-01-01T00:00:00Z`. Three sites in P58d:

| Site | TypeScript | What the Go port must do |
|---|---|---|
| SQS stream row `timestamp` (`read.ts`) | `new Date(Number(attrs.SentTimestamp)).toISOString()` | a **cell value** a user reads and `tests/ipc/sqs/sqs.fixture.ts` freezes → `time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000Z07:00")` |
| S3 `LastModified` field row (`read.ts`) | `meta.LastModified.toISOString()` | same, same format |
| SQS `ObjectDefinition.generatedAt` (`definition.ts`) | `new Date().toISOString()` | **not** a cell value — a wall-clock field every other native adapter already emits as `time.Now().UTC().Format(time.RFC3339Nano)` (`postgres/definition.go`, `sqlite/definition.go`, `mysqlfamily/definition.go`, `mongo/definition.go`, `clickhouse/definition.go`). Follow the five, not the TypeScript |

**P58d D11** states that split. Getting it backwards in either direction is invisible until a fixture
regenerates.

### 1.9 Credentials: `fromIni` is lazy, `LoadDefaultConfig` is not

`sqs/client.ts` and `s3/client.ts` are both
`credentials = cfg.username ? fromIni({ profile: cfg.username }) : undefined`, over the
fields-mode repurposing `docs/ARCHITECTURE.md` documents: `database` holds the **AWS region**,
`username` holds the **named AWS profile**, `host`/`port` are unused (and
`connections/input.go`'s `awsStyleKinds` is the Go-side validator that already knows this).
URI mode carries static keys directly, `sqs://accessKeyId:secretAccessKey@region`.

The Go analogue is `config.LoadDefaultConfig(ctx, config.WithRegion(region),
config.WithSharedConfigProfile(profile))` — but with one real behavioural difference, **researched**:
`fromIni` returns a *provider* that reads `~/.aws/credentials` on the first request, so a typo'd
profile name surfaces as a failed read; `LoadDefaultConfig` resolves the shared config **during the
call** and returns `config.SharedConfigProfileNotExistError` (`config@v1.33.1/shared_config.go`)
before any client exists.

Since both adapters call their credential resolution inside `connect()`, the visible effect is that a
bad profile name now fails **at connect time**, which is where the connection dialog's Test button
reports it, rather than at the first tree expansion. That is a gain, and **P58d D7** records it as a
deliberate behaviour change rather than letting it be discovered. AWS-2 confirms the error type and
the timing rather than resting on the source read.

**One thing neither language's test suite covers, and this plan will not pretend otherwise.**
`sqs.spec.ts` 2 and `s3.spec.ts` 2 are *URI-parse* failures, not auth failures — there is **no
`E_AUTH` scenario in either spec**, unlike `redis.spec.ts` 2 and `mongo.spec.ts` 2 which both have
one. LocalStack accepts any credentials by default, so there is no cheap way to produce a genuine
SigV4 rejection in this tier. The `E_AUTH` mapping ports on the strength of the SDK's own error codes
and stays unexercised in both languages. §10 OQ-4 raises it rather than inventing a test that would
need real AWS.

### 1.10 Flipping `"sqs"` and `"s3"`: the grep, and the debt P58c already paid

`grep -rn '"sqs"\|"s3"' shell/internal --include=*.go`, run for this plan exactly as `AGENTS.md`'s
P58a findings require:

| File | What it is | Fate |
|---|---|---|
| `internal/connections/input.go` | `awsStyleKinds = map[string]bool{"sqs": true, "s3": true}` — the fields-mode "no host/port" validator | Correct, untouched |
| `internal/storage/model/connection.go` | the valid-connection-kind set | Correct, untouched |

That is the **entire** literal-string surface, and there is nothing to move:

- `adapterhost.TestKindNodeServed` is already `"kafka"` (`router.go`), with a doc comment that
  already names P58d's own kinds as ones it must never point at (*"never point it at redis … or at a
  P58d kind (sqs/s3, native one sub-phase before Kafka)"*). Kafka stays Node-served through P58d and
  goes native only in P58e, so the constant does not move here at all.
- `tests/e2e-real/mariadb-real.spec.ts`'s coexistence half already connects **Kafka** as its
  Node-served side (`[data-testid="connection-kind-kafka"]`, `support/kafka.ts` present), so
  **checkpoint C1b**'s vehicle keeps working unchanged through both of P58d's flips.
- `router_test.go`'s `const fakeKind = "kira-test-fake-kind"` is untouchable and untouched.

**P58d has no equivalent of P58c C14/C15, and that is entirely because P58c did the work.**
§10 OQ-5 of P58c argued for the general rule — *"when a test needs 'a kind that is definitely still
Node-served', it must name the kind that goes native last"* — and P58d is the sub-phase that
collects the dividend. It should be said out loud in the P58d findings entry so P58e (which
**does** break both, being Kafka's own sub-phase) plans for it.

### 1.11 Three predecessor closeout claims the tree contradicts, and P58d inherits all three

Checked with `ls`, `git log --diff-filter=D` and the actual file, because P58d's own M8 mandate ends
with a spec deletion and a documentation edit, and this plan should not inherit a precedent that was
never set.

1. **P58b's four `tests/db/*.spec.ts` deletions still have not landed.** At `b40a09e`,
   `tests/db/` holds `clickhouse.spec.ts`, `kafka.spec.ts`, `mariadb.spec.ts`, `mysql.spec.ts`,
   `s3.spec.ts`, `sqlite.spec.ts`, `sqs.spec.ts` — seven files. `postgres.spec.ts` (P58a M5),
   `mongo.spec.ts` and `redis.spec.ts` (P58c M7.3/M7.4) are gone, so **P58c honoured its own
   deletion rule and P58b still has not**. P58c §1.10 recorded this and raised it as its OQ-1; the
   disposition it took (*"P58c deletes its own two and records the other four as outstanding"*) is
   the one P58d inherits. After M8.3, `bun run test:db` would run **four** full container suites
   against TypeScript adapters serving no real connection in the app, plus kafka's. §10 OQ-1.
2. **`docs/ARCHITECTURE.md`'s per-database mapping table was not updated by P58c either — the same
   half-edit, one sub-phase later.** P58c §8 criterion 9 required both the Redis Cancel cell and
   (per its own OQ-2) the SQLite one. At `b40a09e`, the SQLite cell still reads *"none —
   SQLite has no interruptible statement (`sqlite3_interrupt` doesn't exist in `node:sqlite`, and
   the whole API is synchronous)"* — false since P58b M6.3 — and the Redis cell still reads
   *"abort the SCAN loop; `CLIENT KILL` for blocking cmds"*, which P58c §1.7 established the adapter
   has never done. The **per-engine prose sections were rewritten** and are excellent (they all name
   the Go drivers and the real mechanisms); it is only the table that keeps being missed. The Stack
   line still reads *"Driver libraries — the best-maintained option per engine: `pg`, `mariadb`,
   `mongodb`, `ioredis`, …"* — seven of those ten are no longer used at all. **This has now failed
   twice in two consecutive sub-phases with the criterion written down both times**, which is
   evidence that a prose acceptance criterion is not enough. §10 OQ-2 and §8's phrasing of the
   criterion as a **grep** are the response.
3. **P58c §1.1's claim that Redis's is *"the only `Truncated` producer anywhere in the ten
   adapters"* is wrong.** `grep -rn truncated src/engine/adapters/*/catalog.ts` returns two:
   `redis/catalog.ts` and **`s3/catalog.ts`**. The claim came from misreading
   `src/renderer/project/state/tree.ts`'s comment, which says the *project tree* never renders a
   level that can truncate (*"Redis/S3 stop expanding at the database/bucket, P41 D5"*) — a
   statement about the consumer, not about the producers. Nothing already built depends on the
   wrong version, but §5.4's own truncation test does depend on the right one: **S3 is the second
   `Truncated` producer and the second engine whose Browse tab can show the truncation strip.**

**And the "its only consumer" claim, re-grepped for P58d's own two support modules** — the mistake
`AGENTS.md`'s P58a findings name explicitly (*"a plan's own 'its only consumer' claim about a shared
support file is a snapshot, not a standing fact"*):

| Support file | Consumers other than its own `tests/db/*.spec.ts` | Fate |
|---|---|---|
| `tests/db/support/sqs.ts` | `tests/ipc/sqs/sqs.backend.spec.ts` | **KEEP** — §1.12 |
| `tests/db/support/s3.ts` | **none found** at `b40a09e` (`scripts/capture-tree.ts` imports mongo's and redis's, not these) | **Deletable — but re-grep at implementation time** (**P58d D20**) |
| `tests/db/fixtures/0006_sqs_seed.ts` | `support/sqs.ts`, `sqs.spec.ts`, `tests/ipc/sqs/sqs.backend.spec.ts` | **KEEP** |
| `tests/db/fixtures/0007_s3_seed.ts` | `support/s3.ts`, `s3.spec.ts` only | **Deletable with `support/s3.ts`, same re-grep** |

The seed files are TypeScript functions, not `.sql` — so, exactly as **P58c C21** found for
Mongo/Redis, **the Go seeders cannot read the same file** and must re-express it. §4.6 makes that a
checklist rather than a memory, and M8.0's AWS-4 cross-checks the two seeders once against a live
container.

### 1.12 `tests/ipc/sqs/`'s backend half, and the freeze P58f will inherit

Same shape as P58b §1.10 and P58c §1.11, one adapter instead of three.

`tests/ipc/` has seven adapters; **`sqs` is one of them, `s3` is not** (s3, like postgres, sqlite and
mongo, has no `tests/ipc/` split). After M8.2 the real app serves SQS from Go while
`tests/ipc/sqs/sqs.backend.spec.ts` keeps asserting against the TypeScript adapter — the anti-drift
guarantee `docs/ARCHITECTURE.md`'s Testing section states still holds, for a producer that no longer
runs in production. **P58 D13**'s generator port is P58f's and nothing here should bring it forward.

What is worth recording now, because P58f will have to reproduce it in Go: SQS's fixture carries
**two** freezes, both with their reasoning in place. `connectionSummaryOf` freezes
`host`/`port`/`createdAt`/`updatedAt` **and** `options.endpoint`, because LocalStack's own ephemeral
host port travels in `options.endpoint` for SQS's URI-mode connections. And `freezeQueueTimestamps`
rewrites **every ten-digit run** in the definition's `statements[0]` JSON text *and* the matching
`CreatedTimestamp`/`LastModifiedTimestamp` rows, because LocalStack stamps the queue's creation
wall-clock in epoch **seconds** and it appears twice in two different encodings. A Go generator that
freezes only the structured rows and not the raw JSON text will produce a fixture that diffs on every
run.

### 1.13 The two specs, counted, and how much of each ports

Counted for this plan (`grep -c "^  test('" tests/db/{sqs,s3}.spec.ts`) and read scenario by
scenario. **1 242 lines, 45 scenarios** — fewer lines than P58c's 1 695 but *fewer still* per
scenario, because these two suites are dense and repetitive by design.

| Spec | Lines | Scenarios | Ports as-is | Re-baselined against the Go SDK | Collapses to a caps assertion | Rewritten, with a reason |
|---|---:|---:|---:|---:|---:|---:|
| `sqs.spec.ts` | 506 | 17 | 13 | 1 (10) | 1 (3) | 2 (15, 16) |
| `s3.spec.ts` | 736 | 28 | 24 | 3 (12, 22, 27) | 1 (3) | 0 |

The columns, explained once:

- **Ports as-is** — drives the adapter against the same seeded dataset and asserts a shape, a cell
  value or a count. Reuse `testsupport`'s helpers (gap 1, §1.3) rather than writing per-package
  copies.
- **Re-baselined against the Go SDK, never loosened** (P58 §1.10's first non-portable point).
  SQS 10 (*"a nonexistent queue is E_QUERY, not E_NOT_FOUND"*) asserts a code, which ports
  unchanged, but the driver message behind it changes from the JS SDK's `QueueDoesNotExist` wording
  to `types.QueueDoesNotExist`'s own — re-derive it against a real container, do not guess. S3 12 and
  27 are the same for a missing object; S3 22's *second* delete is the sharper case, because its
  error comes from `HeadObject`'s **`types.NotFound`** (an empty-bodied 404) rather than from a
  `NoSuchKey` with a parsed message.
- **Collapses to a caps assertion.** Scenario 3 in both files is *cap honesty* — a one-line
  comparison against the caps literal. Keep a three-line case per adapter anyway, as the cheapest
  possible proof that the literal is what the plan says it is (**P58d D18**).
- **Rewritten, with a reason.** SQS 15 and 16 count `GetQueueUrl` round trips through
  `spyOn(SQSClient.prototype, 'send')`. Go has no prototype and the adapter constructs its own
  client, so the *assertion* ports verbatim and the *vantage point* does not: **P58d D10**'s counting
  reverse proxy replaces the spy. Neither scenario is dropped — they pin `sqs/index.ts`'s D14 cache
  (*"avoids a GetQueueUrl round trip on every read()/count() call"*, fixing F14/F22), which nothing
  else observes.

**Two things port with more weight than their line counts suggest**, and §5.3/§5.4 call them out:
SQS 6's *"opening the definition must not receive or hide a single message"* (a count-before,
definition, count-after sandwich — the executable form of `docs/ARCHITECTURE.md`'s SQS read policy),
and S3 25–28, the four download scenarios, which are the **only** automated coverage of the contract
§1.5 traces and the only place in the phase where an adapter writes to the user's filesystem.

### 1.14 The false-positive-fixture trap, in its P58d form — and it is a *sequencing* trap, not a schema one

`AGENTS.md` records this pattern twice for P58a/P58b (a "no primary key" test pointed at a table that
had one) and P58c found two sharper equivalents of its own. Neither adapter here has a primary-key
concept, so the literal trap does not transfer. Its two real equivalents do, and the SQS one is
**worse than anything the phase has hit so far**, because it is a property of the protocol rather
than of the fixture:

- **SQS: reading a queue *changes* it.** `ReceiveMessage` makes every message it returns invisible
  for the queue's `VisibilityTimeout`. `0006_sqs_seed.ts` already carries the scar tissue — its own
  comment on `DRAIN_QUEUE` says the drain scenario needs *"a second, dedicated queue … reusing
  ORDERS_QUEUE there would race against whichever other test already received (and so, by SQS's own
  VisibilityTimeout, temporarily hid) its messages first."* And `sqs.spec.ts` 17's own comment picks
  `EMPTY_QUEUE` *"so this doesn't perturb any other test's assumptions"* — while scenarios 9 and 11
  both assert `EMPTY_QUEUE` is empty. **In `bun:test` the file runs top to bottom in one process, so
  9 and 11 always run before 17.** Go's `testing` package runs top-level tests in source order too,
  but nothing enforces it, and `-shuffle` or a future `t.Parallel()` would break it silently —
  scenario 11 would see the message 17 sent and read `{value: 1, exact: false}`. **P58d D23**: every
  SQS test that sends or deletes a message creates its **own** queue, named after the test, from the
  fixture's own side client — the direct analogue of **P58c C24**'s `mutate_probe`/`slow_probe` rule
  and of P58a's `no_pk_probe`. `ORDERS_QUEUE`, `DRAIN_QUEUE` and `EMPTY_QUEUE` become read-only
  fixtures that no test ever writes to.
- **S3: the bucket split already exists and must be honoured.** `0007_s3_seed.ts`'s comment is
  explicit: `MUTABLE_BUCKET` exists *"so that scenarios 5/6/9/10/11/13 — which assert MAIN_BUCKET's
  exact listings/bodies — never become order-dependent on a scenario that writes to it (F24: one
  memoized LocalStack container serves the whole file)."* The Go port keeps the split exactly, and
  **P58d D23** extends it with the one case the TypeScript gets away with and Go should not:
  `s3.spec.ts` 23 writes `UPLOAD_TARGET_KEY` into `MUTABLE_BUCKET` and 22 deletes
  `DELETE_TARGET_KEY` from it, while 17's `preview()` names both keys — harmless because `preview()`
  never touches the network, but worth a comment in the Go port so nobody "improves" it into a
  round-trip.

**And one genuine false positive already in the fixture, worth naming because the Go port could
easily preserve it.** `0007_s3_seed.ts` seeds `SECOND_DELETE_TARGET_KEY` and `BINARY_OBJECT_KEY` for
scenarios in the **deleted** `tests/e2e/s3.spec.ts` (both comments say so: *"tests/e2e/s3.spec.ts's
delete scenario"*, *"tests/e2e/s3.spec.ts's binary-object scenario"*). No surviving spec asserts
either. The Go seeder should keep `BINARY_OBJECT_KEY` — it is the only non-UTF-8 object in the
fixture and **P58d D12**'s lossy-decode rule has no other subject — and should keep
`SECOND_DELETE_TARGET_KEY` only if §5.4 gives it an assertion, dropping it otherwise rather than
carrying a seed nothing reads.

### 1.15 Environment and SDK facts checked for this plan

- **Module versions, researched** against `proxy.golang.org`'s own `@latest` endpoints, no `go get`
  run: `github.com/aws/aws-sdk-go-v2` **v1.45.1**, `.../config` **v1.33.1**, `.../credentials`
  **v1.20.1**, `.../service/s3` **v1.109.1**, `.../service/sqs` **v1.48.1** (all from the one
  monorepo). `shell/go.sum` has **zero** `aws-sdk-go-v2` entries today (`grep -c` returns 0), so
  nothing is pulled in transitively — the parenthetical worth checking from P58's own prompt is
  answered: it is not already there.
- **`testcontainers-go/modules/localstack` exists at v0.44.0**, matching the core already pinned in
  `shell/go.mod`. Two facts read out of its source argue against using it, and both are in
  **P58d D22**: `Run` calls `testcontainers.MustExtractDockerSocket(ctx)` and bind-mounts the Docker
  socket into the container — a Lambda feature neither S3 nor SQS needs, and a `Must*` that panics
  rather than returning an error; and its `go.mod` requires `github.com/aws/aws-sdk-go` **v1**
  alongside v2 for its own tests. Its wait strategy is
  `wait.ForHTTP("/_localstack/health").WithPort("4566/tcp").WithStartupTimeout(120s)`, which is
  worth copying verbatim into a bare `GenericContainer` — exactly the shape `testsupport/redis.go`
  already uses after `modules/redis` turned out to lack the option it needed (P58c M7.0's TC-3
  finding).
- **The image is `localstack/localstack:3`** (`tests/db/support/{sqs,s3}.ts`), **already
  namespaced** — so it mirrors at `mirror.gcr.io/localstack/localstack:3` with **no `library/`
  prefix** (`AGENTS.md`'s Docker section names this exact image in its rule).
- **`SERVICES=s3,sqs`** is worth setting on the container: LocalStack 3's community image starts
  every emulator by default, and the two the fixture needs are a small fraction of them. TC-4
  measures the difference rather than asserting one.
- **Neither `./internal/adapters/sqs` nor `./internal/adapters/s3` needs GTK/WebKit headers.** Both
  are pure Go plus stdlib plus the SDK; cgo stays on for the module as a whole
  (`mattn/go-sqlite3` in `internal/storage`, `modernc.org/sqlite` in `internal/adapters/sqlite`,
  Wails' GTK bindings in `internal/shell`), so `CGO_ENABLED=0` is still not an option, but the fast
  loop is `go test ./internal/adapters/{sqs,s3}` and never `./...`.
- **`bun test tests/db/{sqs,s3}.spec.ts` runs here and is a live oracle** to diff the Go port
  against, exactly as P58b §11 recommended for SQLite and P58c §11 for Mongo. Both are Docker-gated,
  both pull `localstack/localstack:3` through the mirror.
- **Wails v3.0.0-beta.15's server platform has no file dialogs.** `pkg/application/dialogs_linux.go`
  is `//go:build linux && !android && !server`, there is **no `dialogs_server.go`**, and
  `application_server.go`'s `serverSaveFileDialog.show()` returns
  `errors.New("file dialogs not available in server mode")`. §5.6 and §10 OQ-5.

## 2. Decisions

Per the preamble: this plan's own decisions are always written **P58d D\<n\>**, including in their
own headers. A bare `D<n>` appears nowhere in this document.

**P58d D1 — both adapters use `aws-sdk-go-v2`, confirming P58 D6's two rows without amendment;
`shell/go.mod` gains five modules and no test-only one.** `github.com/aws/aws-sdk-go-v2` (v1.45.1),
`.../config` (v1.33.1), `.../credentials` (v1.20.1), `.../service/sqs` (v1.48.1) and `.../service/s3`
(v1.109.1). This is the first sub-phase since P58a to reverse no parent driver decision — P58b
reversed **P58 D8**'s driver (**P58b B7**) and **P58 D6**'s ClickHouse row (**P58b B11**), and P58c
reversed none but had two open questions about consequences; P58d has neither. **No
`testcontainers-go/modules/localstack`** (**P58d D22**), so the test tier adds nothing to `go.mod`
either. The transitive cost is real and should be looked at once with `go mod graph`: the S3 client
pulls `aws/protocol/eventstream`, `internal/v4a`, `service/internal/{accept-encoding,checksum,
presigned-url,s3shared}` and `smithy-go`; the config package pulls `feature/ec2/imds`,
`internal/ini`, `service/{sso,ssooidc,sts}`. All are AWS's own, all versioned from one monorepo, and
`package.json` loses `@aws-sdk/client-sqs`, `@aws-sdk/client-s3` and `@aws-sdk/credential-providers`
in P58f in exchange.

**P58d D2 — one small shared package, `internal/adapters/awscfg`, holding client-config resolution
and the SDK error mapper; `sqs` and `s3` keep their own `client.go` and `errors.go` as thin
adapters over it.** §1.1 is the measurement: the shared surface is 98 of 1 586 lines, and the two
TypeScript copies are *documented* duplicates (`s3/client.ts`'s own header: *"Mirrors
sqs/client.ts exactly"*). Two copies in Go would be two chances to drift on **credential handling**,
which is the one place in either adapter where a drift is a security bug rather than a rendering bug.
`awscfg` exports exactly two things:

- `Resolve(cfg model.ResolvedConnectionConfig, log func(level, message string)) (Resolved, error)` —
  the region/credentials/endpoint resolution both `client.ts` files perform identically, returning
  `Resolved{AWSConfig aws.Config; BaseEndpoint string}`. The **only** difference between the two
  adapters (S3's `forcePathStyle`) stays in `s3/client.go`, where it belongs, as a two-line
  functional option on `s3.NewFromConfig`.
- `MapError(err error) error` — the shared SDK-error → `adapters.ErrorCode` mapper, **P58d D4**.

*Named alternative, rejected:* a `mysqlfamily`-shaped shared core with two thin profile packages
(**P58b B1**). Rejected on the ratio: mysqlfamily shares 1 645 of 1 782 lines and the profiles are
68 and 69 lines; here the sharing runs the other way round and a "core" would be 6% of the code with
two adapters hanging off it that agree on nothing else.

*Named alternative, also rejected:* keep both copies, as the TypeScript does. Rejected because the
TypeScript's own comment shows the duplication was tolerated, not chosen, and because **P58d D4**'s
one-list error mapper is a small correctness improvement that only exists if there is one list.

**P58d D3 — neither adapter uses `adapters.RunWithAbortRace`; the op's own `context.Context` is
passed straight to every SDK call, and this is a rule with a reason, not an omission.** §1.4 is the
evidence and this is the plan's most important decision. `RunWithAbortRace` exists to stop a
context-native driver from racing — and beating — an adapter's *authoritative server-side kill*
(`abort.go`). SQS and S3 have no server-side kill: `Cancel()` returns `false` permanently in both,
deliberately, and the SDK's request abort **is** the mechanism (`sqs/index.ts`, `s3/index.ts`).
Detaching the context would therefore:

1. leave a cancelled `ReceiveMessage` running to completion server-side after the caller unblocked —
   and a completed `ReceiveMessage` has already hidden those messages from real consumers for the
   queue's visibility timeout, which is precisely the side effect `docs/ARCHITECTURE.md`'s SQS read
   policy exists to keep under explicit user control;
2. leave a cancelled `DownloadObject` **still writing its temp file** while the caller's error path
   unlinks it, turning `s3.spec.ts`'s *"leaves no file behind"* contract into a race; and
3. buy nothing, because there is no second mechanism for it to protect.

Every SDK call in both packages takes the `ctx` the `Adapter` method received. `CheckNotStarted(ctx)`
runs before the first call (Adapter rule 2) and `CheckCancelled(ctx)` between loop iterations exactly
where the TypeScript calls `throwIfCancelled` (`sqs/read.ts`, `s3/catalog.ts`, `s3/read.ts`,
`s3/mutate.ts`, `s3/transfer.ts`). **Both packages carry a short comment at their `Cancel` saying why
the shared helper is absent**, so the next reader finds the reasoning rather than an apparent
oversight.

**P58d D4 — one shared error mapper over `smithy.APIError` codes and the SDK's typed errors; the
`E_AUTH` list is the union of the two TypeScript lists, and the widening is recorded.**
`errors.ts`'s dispatch order ports verbatim: cancellation first, then auth, then timeout, then
connect, then `E_QUERY` as the default — and the default is load-bearing, because *"a queue gone at
read time … is an ordinary query-time condition, not a connection failure — E_QUERY, deliberately
not E_NOT_FOUND"* (`sqs/errors.ts`, and `s3/errors.ts` says the same for a missing bucket/object).
The Go re-derivation:

| TypeScript test | Go |
|---|---|
| `name === 'AbortError' \|\| /aborted/i.test(message)` | `errors.Is(err, context.Canceled)` **first**, before anything else — the SDK wraps with `%w` through `*smithy.OperationError`; AWS-1(e) confirms the wrap survives |
| `name` in `{CredentialsProviderError, UnrecognizedClientException, InvalidClientTokenId, AccessDenied, SignatureDoesNotMatch}` (+ S3's `InvalidAccessKeyId`) | `var api smithy.APIError; errors.As(err, &api)` then `api.ErrorCode()` against the **union** of the six, plus `config.SharedConfigProfileNotExistError` and whatever AWS-2 finds the credential-chain failure to be |
| `name === 'TimeoutError' \|\| code === 'ETIMEDOUT'` | `errors.Is(err, os.ErrDeadlineExceeded)` or `errors.Is(err, context.DeadlineExceeded)`, plus `api.ErrorCode() == "RequestTimeout"` |
| `code` in `{ECONNREFUSED, ENOTFOUND}` or `name === 'NetworkingError'` | `*net.OpError`/`*net.DNSError` via `errors.As` — the same Go re-derivation `postgres/errors.go`, `mysqlfamily/errors.go` and `redis/errors.go` already made for their own Node errnos |
| everything else | `E_QUERY`, message verbatim (Adapter rule 4) |

The **widening**, stated rather than smuggled: SQS now maps `InvalidAccessKeyId` to `E_AUTH` where
the TypeScript let it fall through to `E_QUERY`. The asymmetry in the two TS lists is an oversight —
SigV4 rejects an unknown access key identically for both services — and a single list is the point of
**P58d D2**. Recorded in `AGENTS.md`'s P58d findings.

**P58d D5 — the endpoint override is `Options.BaseEndpoint`; S3 additionally sets
`Options.UsePathStyle = true` whenever an override is present, and never otherwise.** §1.6, and this
is the direct translation of `s3/client.ts`'s `{ endpoint, forcePathStyle: true }` together with its
own reasoning (*"a non-AWS S3-compatible endpoint almost always needs path-style addressing … turning
it on has no effect against real AWS S3 when no override is set"*). Both are set as functional options
on `sqs.NewFromConfig`/`s3.NewFromConfig`, never through a custom `EndpointResolverV2` — the s3
module's own `options.go` marks that path deprecated in favour of `BaseEndpoint`.

**P58d D6 — the upload body is an `*os.File`, and `RequestChecksumCalculation` is left at the SDK
default unless AWS-3 shows LocalStack rejects it.** The trap, stated because it is invisible until it
fires: `aws-sdk-go-v2` computes a CRC32 checksum on every upload by default, and for a
**non-seekable** body it does so with `aws-chunked` trailer encoding, which several S3-compatible
servers reject outright. `openUploadBody` (`transfer.ts`) already `stat()`s the file and hands the
SDK a stream plus an explicit `ContentLength`, so the Go port handing back an `*os.File` — seekable,
statted, length known — lets the SDK checksum by seeking instead. If AWS-3(a) shows LocalStack 3
rejecting even that, the fallback is
`config.WithRequestChecksumCalculation(aws.RequestChecksumCalculationWhenRequired)`, taken
**explicitly**, with the reason written down at the moment it is taken. The file is opened in
`transfer.go` and **closed by the caller with a `defer`** — the TypeScript never closes its
`createReadStream` because the SDK consumes it and Node's GC finishes the job; a leaked fd in Go is
real, and `mutate.go`'s insert path owns the close.

**P58d D7 — credentials resolve once per `Connect`, through `config.LoadDefaultConfig`; a URI carries
static keys, a fields-mode `username` names a shared-config profile, and a bad profile now fails at
connect.** §1.9. URI mode →
`config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(user, pass, ""))` when both
halves are present, and no credentials option at all when they are not (matching `client.ts`'s
`undefined`, which lets the SDK's own default chain run). Fields mode →
`config.WithSharedConfigProfile(*cfg.Username)` when a profile is named, nothing otherwise. Region is
`cfg.Database` in fields mode and the URI's **host** in URI mode (`sqs://key:secret@us-east-1` — the
region is the host, which reads oddly and is deliberate: `client.ts`). The region-missing message
ports byte-identically: `a region is required (the "database" field)`. The behaviour change — a
nonexistent profile is `config.SharedConfigProfileNotExistError` at connect rather than a failed read
at first use — is a gain (the Test button reports it) and is recorded as a named change in
`docs/ARCHITECTURE.md` and `AGENTS.md`, the same standard **P58b B4/B22** and **P58c C2** held their
own changes to.

**P58d D8 — the SQS `headers` cell is built by a hand-written encoder over
`types.MessageAttributeValue`, never `json.Marshal` of the SDK struct.** §1.7. Fields are emitted
only when non-nil/non-empty, in the fixed order `DataType`, `StringValue`, `BinaryValue`,
`StringListValues`, `BinaryListValues`; `BinaryValue` is **base64**, not a JS-style index-keyed
object. The outer map is `map[string]json.RawMessage` marshalled by `encoding/json`, so attribute
names sort — a difference from JS's insertion order that no consumer observes (the cell is parsed,
not compared) but that should be stated once rather than discovered. The sibling `attrs` cell is
`map[string]string` and needs no encoder: `json.Marshal` matches. AWS-4 diffs both cells against the
JS adapter's output character by character before M8.2 writes a line.

**P58d D9 — SQS's two adapter-local caches are mutex-guarded, and `receiptHandles` is
insertion-ordered with an explicit FIFO eviction list.** Two JavaScript guarantees are load-bearing
in `sqs/index.ts`/`read.ts` and **neither survives translation**:

1. **Single-threadedness.** `queueUrls` and `receiptHandles` are plain `Map`s with no locking,
   because nothing in Node can touch them concurrently. In Go, two tabs on one connection are two
   goroutines through one `*Adapter`, and both maps are written on the read path. Unguarded, this is
   a data race the detector will find — which is why **`-race` is the bar** (§8), and why it matters
   more in P58d than in P58c despite P58d having no `RunWithAbortRace` goroutines of its own.
2. **`Map` insertion order.** `read.ts` evicts *"the oldest entry first (Map preserves insertion
   order)"* once `receiptHandles` passes `RECEIPT_HANDLE_CAP = 5000`. Go's map iteration order is
   deliberately randomised, so a literal port evicts an arbitrary handle — and the failure is
   invisible: deleting a message whose handle was evicted produces `sqs/mutate.ts`'s *"this message
   was not received in the current session"* error, which looks exactly like the legitimate case it
   was written for. The Go shape is a `map[string]string` plus a `[]string` insertion queue (or
   `container/list`), popped from the front on overflow, all under one mutex.

Neither of these is a design decision so much as a translation hazard, and both are exactly the class
of thing `AGENTS.md`'s own findings say gets lost in a port that "reads correct".

**P58d D10 — SQS's two `GetQueueUrl`-counting scenarios keep their assertions and change their
vantage point: a counting reverse proxy in `testsupport`, keyed on the `X-Amz-Target` header.**
§1.3 gap 2 and §1.13. `sqs.spec.ts` patches `SQSClient.prototype.send`; Go has no prototype and no
injection point into an adapter that builds its own client from `cfg` — and adding one would put a
test hook in production code. The fixture already controls the one thing the adapter takes from the
outside: `options.endpoint`. So `testsupport` starts an `httptest.Server` in front of LocalStack that
counts requests whose `X-Amz-Target` equals `AmazonSQS.GetQueueUrl` and forwards everything verbatim,
and the fixture's `options.endpoint` points at the proxy. The header value is **researched**
(`service/sqs@v1.48.1/serializers.go` sets `X-Amz-Target: AmazonSQS.<Operation>` on every operation —
SQS moved to AWS JSON 1.0 and is no longer the legacy query protocol) and AWS-1(b) confirms it on the
wire rather than from the read alone. The counter is mutex-guarded and exposes `Count()`/`Reset()`;
`-race` covers it. Roughly 40 lines, used by exactly two tests, and it is the only way those two
tests survive the port.

*Named alternative, rejected:* drop scenarios 15 and 16. Rejected because they pin
`sqs/index.ts`'s D14 cache and its `disconnect()`-clears-it property, both of which were written to
fix real findings (F14/F22) and neither of which any other test observes.

**P58d D11 — the two data timestamps use JS `toISOString()`'s exact format; `generatedAt` follows the
five existing native adapters.** §1.8. `time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000Z07:00")`
for SQS's `SentTimestamp` and S3's `LastModified` — three fixed fractional digits, because both are
cell values a user reads and one of them is frozen in a `tests/ipc/` fixture. `time.RFC3339Nano` for
`ObjectDefinition.GeneratedAt`, matching `postgres/definition.go` and its four siblings rather than
the TypeScript, because internal consistency across the Go adapters is worth more there than
byte-parity with a field nothing asserts.

**P58d D12 — an S3 object body is decoded lossily, at the adapter, with `strings.ToValidUTF8`, and
the one place it differs from `TextDecoder` is recorded.** `s3/read.ts`'s comment is explicit:
*"Lossy on purpose (fatal: false) — a binary object opened for preview degrades to U+FFFD replacement
characters rather than the whole read failing."* Go's equivalent is
`strings.ToValidUTF8(string(body), "�")`. **The difference, stated:** `TextDecoder` emits one
U+FFFD per invalid *sequence*, `strings.ToValidUTF8` emits one per maximal *run* of invalid bytes, so
a run of three bad bytes renders as three replacement characters in the TypeScript and one in Go. The
fixture's only non-UTF-8 object is `BINARY_OBJECT_KEY` (a 1×1 PNG, under the preview limit) and no
scenario asserts its decoded text, so nothing observes the difference — which is exactly why it is
written down here instead of being found later.

*Named alternative, rejected:* push the raw bytes into the chunk and let the renderer's own
`TextDecoder` do the replacement, which would be byte-identical to the TypeScript's rendered output.
Rejected because `page.Chunk`'s truncation walks UTF-8 boundaries (`page/builder.go`'s `appendValue`
→ `MaxCellBytes`), and feeding it a Go string that is not valid UTF-8 puts invalid input into a codec
whose invariants assume otherwise. The adapter is the right place to make the string valid.

**P58d D13 — `preservedAttributes` becomes seven explicit typed field assignments on
`PutObjectInput`, and its comment ports with it.** `s3/mutate.ts` builds a `Record<string, unknown>`
and spreads it into `PutObjectCommand`; Go has no spread and `PutObjectInput` has real fields, so the
port is seven `if head.X != nil { in.X = head.X }` lines for `ContentType`, `CacheControl`,
`ContentEncoding`, `ContentDisposition`, `ContentLanguage`, `StorageClass` (a `types.StorageClass`, so
`!= ""`) and `Metadata`. **The comment must port** (*"PutObject replaces an object wholesale, so
anything not resent here is gone: silently turning application/json into binary/octet-stream, or
dropping Content-Encoding: gzip, would change how the object is served to everything downstream"*),
because the Go version reads like boilerplate and is not: an eighth attribute added to
`HeadObjectOutput` by a future SDK is a silent data loss, exactly as it is today.

**P58d D14 — the insert path's collision check matches on `*types.NotFound`, not on a mapped error
code, and the tightening is recorded.** `s3/mutate.ts` does `HeadObject`; on success it throws
`key already exists`; on failure it maps the error and rethrows *unless* the mapped code is `E_QUERY`
(i.e. treats "any query-level error" as "not found, proceed"). In Go the honest form is
`var nf *types.NotFound; if errors.As(err, &nf) { proceed } else { return awscfg.MapError(err) }` —
proceed **only** on a real 404. This is a narrowing: a malformed-request or throttling error that the
TypeScript would have swallowed as "probably not found" now fails the insert. That is the correct
behaviour (it is the difference between "the key is free" and "we could not find out"), it changes no
existing test, and it is recorded as a deliberate tightening with a case in §5.4.

**P58d D15 — `formatBytes` ports as a small helper in `s3/read.go` and its output is asserted
byte-exactly, not reasoned about.** `s3/read.ts`. It reaches the user twice: the `ContentLength`
field row (`${n} bytes (${formatBytes(n)})`) and `preview()`'s update text, which `s3.spec.ts`
asserts as the literal string `PutObject s3://<bucket>/<key> (18 B)`. Go's `%.1f` and JS's
`toFixed(1)` agree on every value the fixture produces, and they do **not** agree in general (Go
rounds half to even, `toFixed` does not) — so the port asserts the exact strings for the fixture's
own sizes in §5.4 rather than arguing from the formatting verbs.

**P58d D16 — `countObject`'s formula ports verbatim, including its `4 + len(Metadata)` base.**
`s3/read.ts`. The four are ContentType/ContentLength/LastModified/ETag; `StorageClass` adds one when
non-empty; a `Body` row adds one when `ContentLength != nil && *ContentLength <=
page.ObjectBodyPreviewBytes`. The formula looks like a magic number and is not — `read.ts`'s comment
explains that it exists so *"Count and the visible row count never disagree (F6)"* — and the comment
ports with it. AWS-3(d) settles whether LocalStack reports `StorageClass: STANDARD` on `HeadObject`;
either answer keeps `s3.spec.ts` 19's relative assertion (`oversized == small - 1`) true, which is
why that scenario is written relatively in the first place.

**P58d D17 — both packages keep one Go file per TypeScript file.** **P58 D18**, **P58a A20**,
**P58b B19**, **P58c C17**, applied. `index.ts` → `adapter.go`; everything else keeps its name.
`sqs/`: `adapter.go`, `caps.go`, `catalog.go`, `client.go`, `definition.go`, `errors.go`,
`mutate.go`, `read.go` — eight files. `s3/`: `adapter.go`, `caps.go`, `catalog.go`, `client.go`,
`errors.go`, `mutate.go`, `read.go`, `transfer.go` — eight files, no `definition.go`, because
`s3Caps.definition` is `false` (P23 D11, and `caps.ts`'s comment says it is a named follow-up rather
than a permanent no) and `definition()` is a two-line `Unsupported`. The point is diffability: when a
Go behaviour disagrees with the TypeScript, `s3/mutate.go` and `s3/mutate.ts` are the two files to
put side by side.

**P58d D18 — the two caps literals port value for value, and nothing changes.** `sqsCaps`'s 21
fields and `s3Caps`'s 21, verbatim, comments included. Explicitly, because each looks like an error to
a reader who has not read its comment: **`sqsCaps.definition` is `true` while `describe` is `false`**
(P23 D9 reversed P10's original call — a queue *is* its attributes, and one `GetQueueAttributes` is
not a `ReceiveMessage`); **`sqsCaps.canDelete` is `true` and `canUpdate` is `false`** (a delivered
message cannot be edited in place); **both `cancel` flags stay `true`** despite both `Cancel()`
methods returning `false` (§1.4, **P58d D3**); **`s3Caps.exactCount` is `true`** and describes a
*per-object* field count via `HeadObject`, the same per-item-exact resolution `redis/caps.ts` makes,
**not** a bucket-wide count — and `docs/ARCHITECTURE.md`'s own mapping table currently says something
different, which §8 fixes; **`s3Caps.pagination` is `'token'`** and no page token ever crosses the
wire (§1.3); **`s3Caps.fileTransfer` is `true`**, the only `true` in the app. P58d is not the phase
that revisits any of these.

**P58d D19 — `nativeKinds` grows in two separate commits, never one.** `{"sqs"}` at the end of M8.2,
`{"s3"}` at the end of M8.3, reaching **nine of ten**. Each commit's message records which acceptance
suite went green immediately before it, and each is followed by the full `tests/e2e-real/` sweep §5.6
requires.

**P58d D20 — `tests/db/{sqs,s3}.spec.ts` are deleted in the commit *after* their Go successors are
green, per adapter; the two support modules are re-grepped first and only `s3.ts` is expected to
go.** **P58 D12**'s third rule and **P58a A21**'s discipline. §1.11's table is a snapshot: at
`b40a09e`, `support/sqs.ts` has a real second consumer (`tests/ipc/sqs/sqs.backend.spec.ts`) and
`support/s3.ts` has none. The re-grep runs at implementation time and its result is recorded; if
`support/s3.ts` really has no consumer, it and `fixtures/0007_s3_seed.ts` go with `s3.spec.ts`, and
if it has acquired one, they stay and that is recorded too. M8.3's closeout also records, again,
whether P58b's own four deletions (§1.11) are still outstanding.

**P58d D21 — P58d's `src/` diff is empty, and §5.2 asserts the strong form.** `git diff --stat src/`
returns nothing at all, no exclusions — the same form **P58b B21** and **P58c C22** asserted and met,
and it holds for the same reason: `toTypedArray`'s base64 branch already exists in the tree, verified
at `b40a09e`. If it is ever non-empty, either **P58 D1** was broken or the substrate has a coupling
no plan in this phase has found, and the implementer stops and says so rather than absorbing it.

**P58d D22 — the LocalStack fixture is a plain `testcontainers.GenericContainer`, not
`testcontainers-go/modules/localstack`.** §1.15. Three reasons, in order of weight: the module's
`Run` calls `testcontainers.MustExtractDockerSocket(ctx)` and bind-mounts the Docker socket into the
container — a Lambda-only feature neither service needs, behind a `Must*` that panics rather than
returning an error, in a sandbox where the socket path is exactly the kind of thing that varies; its
`go.mod` requires `github.com/aws/aws-sdk-go` **v1** alongside v2 for its own tests, which is graph
noise this repo has no reason to carry; and the repo's own precedent is already this —
`testsupport/redis.go` uses a bare `GenericContainer` with an explicit wait strategy after P58c
M7.0's TC-3 found `modules/redis` lacked the option it needed. The wait strategy copies the module's
own (`wait.ForHTTP("/_localstack/health").WithPort("4566/tcp")`), and `SERVICES=s3,sqs` is set to
trim startup. TC-4 proves it here before M8.2 depends on it.

**P58d D23 — every SQS test that sends or deletes a message creates its own queue; every mutating S3
test targets `MUTABLE_BUCKET`.** §1.14. The SQS half is stricter than the TypeScript's, on purpose:
`ReceiveMessage` mutates visibility, `bun:test`'s top-to-bottom single-process ordering is what keeps
scenarios 9/11 and 17 from colliding today, and Go's `testing` package gives no such guarantee under
`-shuffle` or a future `t.Parallel()`. `ORDERS_QUEUE`, `DRAIN_QUEUE` and `EMPTY_QUEUE` become
read-only fixtures. The S3 half is the fixture's own existing rule (`0007_s3_seed.ts`) restated so
nobody "simplifies" a mutating test onto `MAIN_BUCKET`.

**P58d D24 — the Go seeders re-express `0006_sqs_seed.ts` and `0007_s3_seed.ts`, and the cost is
named.** The same weakening of **P58 D12**'s *"byte-identical dataset"* property that **P58c C21**
recorded: these seeds are TypeScript functions, not `.sql`, so the Go fixtures cannot read the same
file. §4.6 turns every seeded shape into a checklist table, and AWS-4 cross-checks the two seeders
once against a live container in M8.0 — nearly free, since that probe already has the container up.

## 3. Target tree

```
shell/internal/adapters/
  awscfg/                       NEW    M8.2  (P58d D2) ~70 lines, two exported functions
    config.go                   NEW    M8.2  Resolve() — region/credentials/endpoint, both modes
    errors.go                   NEW    M8.2  MapError() — the shared smithy/typed-error mapper
  testsupport/
    spec.go                     EDITED M8.1  + StreamKeyAt/StreamHeadersAt/StreamAttrsAt/
                                             StreamTimestampAt/StreamBodyAt — the StreamPage
                                             readers spec.go has TabularPage/DocumentPage/
                                             KeyValuePage ones of today (§1.3 gap 1)
    localstack.go               NEW    M8.1  the shared localstack/localstack:3 GenericContainer
                                             starter (P58d D22) + the operation-counting reverse
                                             proxy two SQS scenarios need (P58d D10)
    sqs.go                      NEW    M8.2  three seeded queues, 0006_sqs_seed.ts's own shapes
                                             re-expressed in Go (P58d D24, §4.6)
    s3.go                       NEW    M8.3  three seeded buckets, 0007_s3_seed.ts's own shapes
  sqs/                          NEW    M8.2  (P58d D17) 8 files, one per sqs/*.ts:
    adapter.go   caps.go   catalog.go   client.go
    definition.go errors.go  mutate.go    read.go
    sqs_test.go, main_test.go   NEW    M8.2
  s3/                           NEW    M8.3  (P58d D17) 8 files, one per s3/*.ts — no definition.go:
    adapter.go   caps.go   catalog.go   client.go
    errors.go    mutate.go read.go      transfer.go
    s3_test.go, main_test.go    NEW    M8.3

shell/internal/adapterhost/router.go        EDITED  M8.2/M8.3  nativeKinds += sqs, then s3, in two
                                                    separate commits (P58d D19). TestKindNodeServed
                                                    is NOT touched — it is already "kafka" (§1.10)
shell/main.go                               EDITED  two blank imports (sqs, s3), one per milestone
                                                    — §4.7's most-forgotten step
shell/go.mod / go.sum                       EDITED  + aws-sdk-go-v2 {core, config, credentials,
                                                    service/sqs, service/s3}; no test-only module

shell/internal/{page,enginecache,enginebackend}/**  UNCHANGED  §1.3 — deliberately, not by omission
shell/internal/adapters/{sqltext,sqlmutate,abort,caps,errors,registry,live,adapter}.go  UNCHANGED
shell/internal/{oplog,enginehost,storage,tree,connections,bridge,shell}/**  UNCHANGED
src/**                                              UNCHANGED  P58d D21 — every file, port.ts included

tests/db/sqs.spec.ts                        DELETED M8.2 last commit (P58d D20)
tests/db/s3.spec.ts                         DELETED M8.3 last commit (P58d D20)
tests/db/support/sqs.ts                     UNCHANGED  real consumer in tests/ipc/sqs (§1.11)
tests/db/support/s3.ts                      DELETED M8.3  only if the re-grep is clean (P58d D20)
tests/db/fixtures/0006_sqs_seed.ts          UNCHANGED  still read by support/sqs.ts + tests/ipc/sqs
tests/db/fixtures/0007_s3_seed.ts           DELETED M8.3  with support/s3.ts, same re-grep
tests/e2e-real/**                           UNCHANGED  §5.6 — no flip breaks its coexistence half
tests/ipc/**                                UNCHANGED  §1.12 — the generator port is P58f's
tests/ui/**                                 UNCHANGED  P58a A10
package.json                                UNCHANGED  test:db runs a directory (P58b §5.1)

docs/ARCHITECTURE.md                        EDITED  the per-database mapping table's SQS and S3
                                                    Cancel/Exact-count cells; the Redis and SQLite
                                                    cells P58c left stale (§1.11, OQ-2); the Stack
                                                    driver line; the SQS and S3 per-engine sections
docs/v1/plans/P58d-sqs-s3.md                EDITED  §12 M8.0 results, then §13 M8.1-M8.3 results
AGENTS.md                                   EDITED  the P58d findings entry
```

## 4. Designs

### 4.1 `awscfg` — the whole of the shared half

Two files, roughly 70 lines, written against `sqs/client.ts` and `s3/client.ts` read side by side so
neither shapes it alone.

```go
// Resolved is what both adapters need from a ResolvedConnectionConfig before constructing a client.
type Resolved struct {
    AWS          aws.Config
    BaseEndpoint string // "" when the connection has no options.endpoint override
}

func Resolve(ctx context.Context, cfg model.ResolvedConnectionConfig,
             log func(level, message string)) (Resolved, error)
```

`Resolve` reproduces `client.ts`'s own logic exactly, for both modes:

| Step | TypeScript | Go |
|---|---|---|
| URI mode region | `parseConnectionUri(cfg.uri).host` | `url.Parse(*cfg.URI)` then `u.Hostname()`. **Trap:** Go's `url.Parse` is permissive where `new URL` throws — `url.Parse("not a valid uri at all")` succeeds with an empty `Host`, so the **emptiness check** is what carries scenario 2's `E_QUERY`, not the parse error. `sqlite/client.go` already documents the same asymmetry for its own port |
| URI mode credentials | `{accessKeyId, secretAccessKey}` when both present, else `undefined` | `config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(u.User.Username(), pass, ""))`, or no option at all |
| fields mode region | `cfg.database`, else throw `a region is required (the "database" field)` | same, message byte-identical |
| fields mode credentials | `fromIni({ profile: cfg.username })` when set | `config.WithSharedConfigProfile(*cfg.Username)` (**P58d D7**) |
| endpoint override | `cfg.options.endpoint` when a non-empty string; logs `info` `"<kind>: overriding endpoint to <endpoint>"` | same, and the log line keeps its per-kind prefix — so `Resolve` takes the kind label as a parameter rather than hardcoding one |
| region missing / URI unparseable | `throw mapError(new Error(...))` → `E_QUERY` | `MapError` on a plain error → `E_QUERY`, same code, same text |

`MapError` is **P58d D4**'s table, in one function, used by both packages' one-line `errors.go`
wrappers (which exist only so a future divergence has a place to live — **P58d D17**'s file-per-file
rule applies).

### 4.2 `sqs`, file by file

`aws-sdk-go-v2/service/sqs`, the op's own context on every call (**P58d D3**).

| Go file | Ports | Key points |
|---|---|---|
| `client.go` | `client.ts` | `awscfg.Resolve` plus `sqs.NewFromConfig(r.AWS, func(o *sqs.Options){ if r.BaseEndpoint != "" { o.BaseEndpoint = aws.String(r.BaseEndpoint) } })`. No path-style analogue — that is S3's alone |
| `adapter.go` | `index.ts` | The `Adapter` impl. `Connect` runs `catalog.ListQueues` and **closes nothing on failure** — the SDK client owns no sockets to destroy, so `client.destroy()` (`index.ts`) has no Go counterpart and is deleted rather than emulated; `ConnectInfo{ServerVersion: "Amazon SQS"}`; `Disconnect` clears **both** caches (`index.ts`) under the mutex (**P58d D9**), which is what scenario 16 asserts; `Children` returns `[]model.TreeNode{}` for any non-empty path (Adapter rule 5) and populates `queueUrls` from `ListQueues`'s free name→URL map; `Describe` is `Unsupported`; `resolveQueueTarget`'s message ports verbatim (`read requires a queue path, got: <encoded>`); `Cancel` is the permanent `false` with its comment, extended to name **P58d D3** |
| `catalog.go` | `catalog.ts` | `ListQueues` with `MaxResults: aws.Int32(1000)` and `NextToken` looping until exhausted — `sqs.NewListQueuesPaginator` is the idiomatic form and is fine, but the loop must keep collecting the **name→URL map** rather than discarding it (`catalog.ts`'s whole point, D14). Queue name is the URL's last path segment; nodes sorted by name; `hasChildren: false`. `ResolveQueueURL` is `GetQueueUrl`, with the `queue not found: <name>` fallback when the response carries no URL |
| `read.go` | `read.ts` | `PollQueue`: `RECEIVE_LIMIT = 10`, `WAIT_TIME_SECONDS = 1`, `batchLimit = min(10, pageSize-collected)`, loop until `collected >= pageSize`, **break on a short batch** (`read.ts`'s *"queue is likely drained"*), `CheckCancelled(ctx)` at the top of each round. `op.SetCommand("ReceiveMessage " + queueURL)` **before** the first call (Adapter rule 3). `MessageAttributeNames: []string{"All"}` and `MessageSystemAttributeNames: []types.MessageSystemAttributeName{types.MessageSystemAttributeNameAll}` (§1.6). Rows push through `page.NewStreamPageBuilder(visibilityTimeoutSeconds)` — the builder's **first ever caller**. `headers` per **P58d D8**, `attrs` a plain `json.Marshal` of `map[string]string`, `timestamp` per **P58d D11**, `key` the `MessageId` (nil-able), `body` `aws.ToString(m.Body)`. `position` is the constant literal (`read.ts`): every field null/false, `Strategy: "batch"` — **not** a call into `sqltext.go`. `FetchVisibilityTimeout` is best-effort with a swallowed error (`read.ts`, *"mirrors redis/read.ts's MEMORY USAGE fallback"*). `CountQueue` is `GetQueueAttributes(ApproximateNumberOfMessages)` → `{value, exact: false}` |
| `definition.go` | `definition.ts` | `GetQueueAttributes(All)`; attribute names **sorted**; the three-entry `JSON_ATTRIBUTES` set (`RedrivePolicy`, `Policy`, `RedriveAllowPolicy`) pretty-printed with `json.Indent` and **swallowing a parse failure back to the raw string** (`definition.ts`); `statements[0]` is the whole attribute map as 2-space-indented JSON — note Go's `json.MarshalIndent` over a `map[string]string` sorts keys, which matches what `Object.keys().sort()` already produces for the rows but **not** what `JSON.stringify(attributes, null, 2)` produces for the statement (insertion order). Sorting both is the smaller divergence and is what the Go port does; recorded, since `tests/ipc/sqs/sqs.fixture.ts` freezes that text and P58f will regenerate it |
| `mutate.go` | `mutate.ts` | `$body`/`$headers` insert sentinels and the `messageId` delete key, all three verbatim; `parseHeaders`'s three error messages byte-identical (`malformed $headers JSON`, `$headers must be a JSON object of string values`, `$headers.<k> must be a string`); `Preview` synchronous, no network (Adapter rule 3), rendering `SendMessage(<queue>)` / `DeleteMessage(<queue>)` and throwing `E_UNSUPPORTED` *"sqs has no update operation — delete and resend instead"* for an update; `Mutate` calls `AssertWritable` first, `op.SetCommand(strings.Join(preview, ";\n"))` second; the delete path looks the receipt handle up under the mutex and produces the long *"this message was not received in the current session (its receipt handle is gone) — poll again before deleting"* message verbatim when it is absent |
| `errors.go` | `errors.ts` | A three-line wrapper over `awscfg.MapError` (**P58d D2/D4**) |
| `caps.go` | `caps.ts` | **P58d D18**'s literal, comments included |

### 4.3 `s3`, file by file

`aws-sdk-go-v2/service/s3`, `UsePathStyle` when an endpoint override is present (**P58d D5**).

| Go file | Ports | Key points |
|---|---|---|
| `client.go` | `client.ts` | `awscfg.Resolve` plus `s3.NewFromConfig(r.AWS, func(o *s3.Options){ if r.BaseEndpoint != "" { o.BaseEndpoint = aws.String(r.BaseEndpoint); o.UsePathStyle = true } })`. The two go together, exactly as `client.ts` pairs them |
| `adapter.go` | `index.ts` | The `Adapter` impl. `Connect` reads `options.bucket` into `scopedBucket` **before** calling `ListBuckets`, so a scoped connection never issues `ListBuckets` at all; `ConnectInfo{ServerVersion: "Amazon S3"}`; `Describe` and `Definition` are both `Unsupported`; `Children`'s three-way path walk (empty → buckets; `object` tail → `[]`; otherwise accumulate `prefix` segments) with its two `E_NOT_FOUND` messages verbatim; `resolveObjectTarget` reads **only** the first and last segments and its message ports verbatim; `DownloadObject` forwards to `transfer.go` **without** `AssertWritable` (§1.5); `Cancel` is the permanent `false` with its comment extended to name **P58d D3** |
| `catalog.go` | `catalog.ts` | `ListBuckets` (or `HeadBucket` on the scoped path, with the same one-node result and the IAM reasoning in its comment); `ListPrefixChildren` with `Delimiter: "/"`, `MAX_LIST_ROUNDS = 20`, `CheckCancelled(ctx)` per round; `CommonPrefixes` → `prefix` nodes carrying the **local** segment (`cp.Prefix[len(prefix):len(cp.Prefix)-1]`), `Contents` → `object` nodes carrying the **full key** (`catalog.ts`'s five-line reason ports with the code), the exact-prefix directory marker skipped; prefixes sorted then objects sorted, concatenated in that order; and P43 iter2 F16/D21's rule verbatim — **`truncated` is true only when `continuationToken != "" && rounds >= MAX_LIST_ROUNDS`**, never for an ordinary complete listing. S3 is the **second** `Truncated` producer in the app, correcting P58c §1.1 (§1.11) |
| `read.go` | `read.ts` | `ReadObject`: `CheckNotStarted(ctx)`, `op.SetCommand("GetObject s3://<bucket>/<key>")`, then **HeadObject first, always** (`read.ts`'s own reason: it answers "too large to preview" without ever opening a body stream). Builder is `page.NewKeyValuePageBuilder("object", nil, head.ContentLength, true)` — `memoryBytes` is the object's `ContentLength` (P33 D5), and it is already an `*int64`, which is the type the builder wants. The over-limit branch pushes metadata only; the normal branch issues `GetObject`, pushes metadata from the **GetObject** output (identical fields), reads the body with `io.ReadAll`, re-checks cancellation, and pushes a `Body` row decoded per **P58d D12**. `pushMetadataFields` stays one function so the two branches cannot drift (`read.ts`'s reason). Position is `page.UnpagedPosition(1)`. `CountObject` is **P58d D16** |
| `mutate.go` | `mutate.ts` | `resolveBucketSegment` and the four sentinel extractors (`_key`, `$value`, `$file`, `$contentType`), each message byte-identical including the `an s3 <label> mutation requires a non-empty <sentinel>` shape; `Preview` synchronous over `renderOpText` and asserted byte-exactly (**P58d D15**); `Mutate` calls `AssertWritable` first, `op.SetCommand` second, then loops with `CheckCancelled` per op; `applyUpdate` = HeadObject → PutObject with **P58d D13**'s seven preserved attributes; `applyInsert` = HeadObject-as-collision-check (**P58d D14**) → `openUploadBody` → PutObject with `ContentLength` and `ContentType`, closing the file with a `defer` (**P58d D6**); `applyDelete` = HeadObject-as-existence-check → DeleteObject, which is what makes a second delete `E_QUERY` rather than a silent success (D13 in P33's numbering, `s3.spec.ts` 22) |
| `transfer.go` | `transfer.ts` | §4.4 |
| `errors.go` | `errors.ts` | A three-line wrapper over `awscfg.MapError` |
| `caps.go` | `caps.ts` | **P58d D18**'s literal, comments included |

### 4.4 `DownloadObject` in Go, precisely

The phase's first real implementation, against the contract `adapters/adapter.go` already states.
Every step below is `transfer.ts` translated, in the same order, for the same reasons.

```
1. CheckNotStarted(ctx)                        // an already-cancelled op never creates a file
2. op.SetCommand("GetObject s3://<b>/<k> -> <destPath>")   // Adapter rule 3, before any call
3. HeadObject(ctx, …)                          // a real "no such object" before any local file
                                               // exists (transfer.ts)
4. tmp := destPath + ".kira-partial-" + uuid   // a SIBLING of destPath, never os.TempDir()
                                               // (transfer.ts — the rename must be atomic
                                               // on one filesystem)
5. f, err := os.Create(tmp)                    // defer f.Close()
6. out := GetObject(ctx, …)                    // defer out.Body.Close()
   if out.Body == nil -> E_QUERY "<key> has no body to download"
7. n, err := io.Copy(f, out.Body)              // ctx cancellation surfaces here, mid-stream
8. f.Sync(); f.Close()
9. os.Rename(tmp, destPath)
10. return ObjectTransferResult{Bytes: n}
on ANY error from 5-9: os.Remove(tmp) (error ignored), then return awscfg.MapError(err)
```

Five things that are decisions rather than transcription, each with the reason attached:

- **The byte count comes from `io.Copy`, not from a second `os.Stat`.** `transfer.ts` stats the temp
  file because Node's `pipeline` returns nothing useful; `io.Copy` returns the count directly. One
  fewer syscall and one fewer failure mode, and `s3.spec.ts` 25/28 assert the value either way.
- **`uuid` is `github.com/google/uuid`**, already an indirect dependency of `testcontainers-go`
  (`go.mod`'s indirect block) — promote it to a direct require rather than hand-rolling a random
  suffix. It is the same generator the TypeScript's `randomUUID` uses in spirit and the temp name
  format (`.kira-partial-<uuid>`) ports verbatim, because a user who finds one on disk after a crash
  should be able to search for the same string in both versions.
- **The cleanup runs on *every* non-success path**, including the cancellation path, and it runs
  **before** the error is returned, not in a goroutine. This is only safe because **P58d D3** keeps
  the copy on the caller's own goroutine — under `RunWithAbortRace` the unlink would race a writer
  that is still running (§1.4).
- **`os.Rename` is the last step and is never retried.** A cross-device rename fails with `EXDEV`;
  step 4's sibling-temp-file rule is what makes that impossible, and there is no fallback copy, on
  purpose — a fallback would silently reintroduce the non-atomic write the design exists to prevent.
- **No `readOnly` guard.** §1.5.

### 4.5 Cancellation, pagination and error mapping — the table P58 §4.7 requires

| | sqs | s3 |
|---|---|---|
| **Cancel mechanism** | **None server-side, deliberately.** `Cancel(opID)` returns `false` permanently (P10 D14). The SDK request abort, driven by the op's own `context.Context`, is the entire mechanism; `adapterhost.Host.CancelOp`'s **first** step (cancelling the op context) is what triggers it | Identical, for the identical reason (`s3/index.ts`) |
| **Driver ctx** | **the op's own, always** — never `RunWithAbortRace`, never `context.WithoutCancel` (**P58d D3**). The inverse of postgres/mysqlfamily/sqlite/clickhouse/mongo/redis, and the comment at each `Cancel` says so | Identical. Additionally load-bearing for `DownloadObject`'s temp-file cleanup (§4.4) |
| **`caps.cancel`** | `true`, unchanged — and honest, despite `Cancel()` returning `false` | `true`, unchanged, same |
| **Pagination** | `pagination: "batch"`. Every poll is an independent, non-resumable snapshot with **no addressable position**: `PagePosition{Offset: nil, PageSize: req.PageSize, HasMore: false, NextToken: nil, PrevToken: nil, Strategy: "batch"}`, a constant literal. No page token is ever encoded or decoded | `pagination: "token"` — and **no page token ever crosses the wire**. An object's own field listing is `page.UnpagedPosition(1)`; `ListObjectsV2`'s continuation token lives entirely inside one `ListPrefixChildren` call and never leaves it. `EncodePageToken`/`DecodePageToken` are unused by both adapters (§1.3) |
| **Tree truncation** | never — a region's queue list is enumerated to exhaustion | `truncated` set only when `MAX_LIST_ROUNDS` (20) cut the listing short with a continuation token still outstanding. The **second** producer in the app, after redis (§1.11) |
| **Error mapping** | ctx first → `E_CANCELLED`; the six-code `E_AUTH` union + `config.SharedConfigProfileNotExistError`; `RequestTimeout`/deadline → `E_TIMEOUT`; `*net.OpError`/`*net.DNSError` → `E_CONNECT`; everything else → `E_QUERY`, **including a nonexistent queue** | Identical mapper (**P58d D2/D4**), **including a nonexistent bucket or object** → `E_QUERY`, and `HeadObject`'s `*types.NotFound` is the one the insert path matches on structurally (**P58d D14**) |

### 4.6 `testsupport`: one LocalStack starter, two fixtures, and the seeds that cannot be reused

`localstack.go` holds one unexported `startLocalStack()` — image `localstack/localstack:3`, env
`SERVICES=s3,sqs`, exposed `4566/tcp`, wait `ForHTTP("/_localstack/health").WithPort("4566/tcp")`
(**P58d D22**) — plus the counting proxy (**P58d D10**). `sqs.go` and `s3.go` each own a
`fixture[T]` memo, an exported `StartX(t)` with the `IsDockerAvailable` gate, and an exported
`StopX()` called from that package's own `TestMain` after `m.Run()` — never `t.Cleanup`, for the
reason `fixture.go`'s package doc gives (**P58b B15**). **Two packages means two test binaries means
two containers**; that is the same cost every other engine pays and is not worth working around.

**P58d D24's cost, made concrete.** P58a's and P58b's Go seeders read `tests/db/fixtures/*.sql`
unchanged. `0006`/`0007` are TypeScript **functions**, so the Go seeders re-express them. The
checklist, so it is a table rather than a memory:

| Fixture | Container | Every shape the Go seeder must reproduce |
|---|---|---|
| `sqs.go` | LocalStack, `SERVICES=s3,sqs`, URI-mode config `sqs://test:test@us-east-1` with `options.endpoint` pointing at **the proxy**, not the container | `orders-queue` with **5** messages, each body `{"seq":<i>}` and one message attribute `source` = String `"seed"`; `drain-queue` with **7** identical-shaped messages (its own reason: no single `pageSize: 2` poll can see them all); `empty-queue` created and never written. Exported constants mirroring `0006`'s: `SQSOrdersQueue`, `SQSOrdersMessageCount`, `SQSDrainQueue`, `SQSDrainMessageCount`, `SQSEmptyQueue`. Plus a side client + a `CreateQueue` helper the per-test queues of **P58d D23** use |
| `s3.go` | LocalStack, URI-mode config `s3://test:test@us-east-1` with `options.endpoint` on the container directly (no proxy needed) | **`main-bucket`**: `readme.txt` (`text/plain`, metadata `seeded=true`, body `hello from the bucket root`); `reports/2024/summary.json` (`application/json`, body `{"year":2024,"total":42}`); `reports/notes.txt` (`text/plain`); `sizes/small-for-count.txt` (`text/plain`); `sizes/oversized.bin` = **`page.ObjectBodyPreviewBytes + 1024`** bytes of `'x'` (sized off the shared constant, not a literal, exactly as `0007` does); `sizes/logo.png` = the 1×1 PNG from `BINARY_OBJECT_BASE64` (`image/png`) — kept because **P58d D12** has no other subject (§1.14). **`empty-bucket`**: created, empty. **`mutable-bucket`**: `editable.json` (`application/json`, metadata `seeded=true`, body `{"status":"draft"}`), `readonly-target.txt`, `delete-target.txt`; `uploaded-from-disk.txt` **never seeded** — scenario 23 creates it |

**The cross-check that buys back most of what P58d D24 costs**, and it is nearly free because AWS-4
already has a container up: run the TypeScript fixture and the Go fixture side by side once, and diff
the two queue inventories (names, `ApproximateNumberOfMessages`, one message's attribute map) and the
two bucket inventories (`ListObjectsV2` key sets, each object's `ContentType`/`ContentLength`/
`Metadata`). Recorded in §12 as a probe result, not repeated per run.

### 4.7 The router flip, and what else it touches

`nativeKinds` is the whole mechanism (P58 §4.6). Enumerated so the implementer checks each rather
than trusting "the router handles it":

- **Control plane** — `connections.{Test,Connect,Disconnect,Remove}` and
  `tree.{Children,Describe,Definition}` start reaching `adapterhost.Host` for that kind. Nothing to
  write, and — unlike P58b and P58c — **no constant to move** (§1.10).
- **Data plane** — that kind's pages start arriving base64-encoded and `toTypedArray`'s first branch
  handles them. No change. **But M8.2's flip is the first after which a `StreamPage` crosses the wire
  from Go**, so §5.6's full sweep is not optional there.
- **Cancel** — routes on op ownership, not kind (**P58a A13**). A flip changes nothing.
- **`connections.MarkAllErrored`** — **P58a A15** narrowed it to Node-served kinds. After M8.3, nine
  of ten kinds are excluded and only `kafka` is not; `tests/e2e-real/mariadb-real.spec.ts`'s second
  test is the live check that this is still right, and it is already Kafka-paired.
- **`cache:stats`** — **P58a A16**'s merge is unchanged.
- **The Browse tab** — S3 is the **second** `caps.keyBrowser` engine on the native path (redis was
  the first, P58c M7.4), and the second `Truncated` producer. `views/browse/state.ts` is the only
  consumer of either.
- **`shell/main.go`** — one blank import per new adapter package. **The single most likely thing to
  be forgotten**, because omitting it produces no compile error: `CreateAdapter` returns
  `E_UNSUPPORTED "<kind> connections are not supported yet"` (`registry.go`) at connect time, in
  the real app only, and never in `go test ./internal/adapters/<engine>` (which constructs the
  adapter through `CreateAdapter` *after* the package's own blank import in its `_test.go`). §8 makes
  it a per-milestone acceptance check, exactly as P58b §4.6 and P58c §4.6 did.

## 5. Testing plan

### 5.1 What survives untouched

- **`tests/ui/`** entirely — 36 tests, 18 spec files, both wire planes mocked. **P58a A10** holds:
  the mocked tier still speaks the index-keyed chunk encoding, which `toTypedArray`'s second branch
  still decodes.
- **`tests/ipc/`** entirely — all three halves of all seven adapters, `sqs` included. §1.12 records
  the cost of that being true and the two freezes P58f inherits.
- **`tests/e2e-real/`** entirely — no spec changes, no support changes. §5.6.
- **`tests/unit/`** entirely. Nothing in P58d has a TypeScript unit-test subject that moves.
- **`package.json`.** `test:db` runs a directory (`scripts/run-db-tests.sh`'s
  `bun test tests/db --path-ignore-patterns '**/kafka.spec.ts'`), so deleting two spec files needs no
  script edit.

### 5.2 The `src/` non-change, asserted in its strong form

Every milestone from M8.1 onward ends with `git diff --stat src/` returning **empty** — no exclusion
(**P58d D21**). If it is ever non-empty the implementer stops and says so rather than absorbing it.

### 5.3 The SQS Go tier

`shell/internal/adapters/sqs/sqs_test.go`, driven by `testcontainers-go` against
`localstack/localstack:3`, seeded per §4.6. §1.13's table is the scope: 13 scenarios port as-is, 1 is
re-baselined, 1 collapses to a caps assertion, 2 are rewritten around **P58d D10**'s proxy.

Four cases carry more weight than the rest:

| Test | Why |
|---|---|
| **opening the definition receives no message** (scenario 6, ported verbatim, **must not be softened**) | The count-before / definition / count-after sandwich is the executable form of `docs/ARCHITECTURE.md`'s SQS read policy — *"Reads are never automatic … `ReceiveMessage` makes messages invisible to real consumers"*. If `buildQueueDefinition` ever grows a `ReceiveMessage`, this is the only test in the repo that notices. Keep the sandwich; do not replace it with "assert the definition has rows" |
| **the `headers` cell is the JS shape, not the SDK struct's** (new, **P58d D8**) | Assert the exact JSON text of a seeded message's `headers` cell — `{"source":{"DataType":"String","StringValue":"seed"}}` — as a **literal string**, not by parsing it and reading one key, which is what `sqs.spec.ts` does and what would let §1.7's five-field-with-nulls form through unnoticed. AWS-4 produces the expected string; this test pins it |
| **a second read and a count issue no second `GetQueueUrl`** (scenarios 15/16, rewritten around the proxy) | **P58d D10**. Three assertions in order: first read → 1 call (cache miss), second read → 0, `count()` → 0 (the same cache). Then disconnect/reconnect → 1 again, which is what pins `Disconnect`'s cache clear |
| **repeated small polls eventually see every message** (scenario 8, ported verbatim) | `pageSize: 2` against a 7-message queue with a bounded guard loop. This is the only test that exercises the multi-round `ReceiveMessage` loop and its short-batch break, and it is the reason `drain-queue` exists separately from `orders-queue` |

**P58d D23** governs every mutating case: scenario 17's send/delete round trip creates its own queue,
never `EMPTY_QUEUE`.

### 5.4 The S3 Go tier

`shell/internal/adapters/s3/s3_test.go`, same container image, seeded per §4.6. 24 of 28 scenarios
port as-is — the highest ratio in P58 — because S3's spec is almost entirely about the adapter's own
key/prefix logic rather than about a driver.

| Test | Why it is called out |
|---|---|
| **the four download scenarios** (25–28, ported verbatim) | The **only** automated coverage of §1.5's contract, and the only place in the phase where an adapter writes to the user's filesystem. 25: exact bytes, exact count, **and `os.ReadDir(tmpDir)` returning exactly one entry** — the no-partial-sibling assertion, which is the whole point of the temp-file design. 26: an already-cancelled ctx → `E_CANCELLED` **and an empty directory**. 27: a missing key → `E_QUERY` **and an empty directory**. 28: the over-limit object, byte-exact against `bytes.Repeat([]byte("x"), n)`, because the read path never fetches its body at all and Download is the only way to see it. Use `t.TempDir()`, which Go cleans up itself |
| **a cancelled download mid-stream leaves no file** (new, extending 26) | Scenario 26 only covers an *already*-cancelled context, which never reaches `io.Copy`. The mid-stream case is the one **P58d D3** exists to keep correct: start the download of `sizes/oversized.bin` on a goroutine, cancel after the first bytes land, assert `E_CANCELLED` and an empty directory. This is the P58d analogue of P58a's `pg_sleep(30)` cancel test — the case no probe and no unit test can reach |
| **`truncated` is set only when the round cap cut the listing short** (extending 5) | P43 iter2 F16/D21, and §1.11's correction: S3 is the second producer, and the browse tab's truncation strip has no other source for it. The existing spec asserts only the negative (`result.truncated` undefined for an ordinary listing). Add the positive against a temporarily lowered cap or a prefix seeded past 20 rounds |
| **`preview()` renders byte-exact text** (scenario 17, ported verbatim) | **P58d D15**. Three literal strings including `(18 B)` from `formatBytes`. Also the synchronous `E_NOT_FOUND` for a non-bucket-rooted path, which proves `Preview` never touches the network (Adapter rule 3) |
| **an insert refuses an existing key on a real 404 check** (scenario 24, ported, **with P58d D14's tightening**) | The collision branch must match `*types.NotFound` structurally. Add one case the TypeScript has no analogue for: a `HeadObject` failure that is *not* a 404 must fail the insert rather than proceed |
| **update preserves ContentType and user Metadata** (scenario 20, ported verbatim) | **P58d D13**. The one test standing between "PutObject preserves the object's serving behaviour" and a silent `binary/octet-stream` regression |
| **count excludes the Body row for an over-limit object** (scenario 19, ported verbatim) | **P58d D16**, and it is written *relatively* (`oversized == small - 1`) so it holds whichever way AWS-3(d) resolves LocalStack's `StorageClass` |

**P58d D23** governs every mutating case: they run against `mutable-bucket`.

### 5.5 Unit-level, against `AGENTS.md`'s own bar — nothing qualifies, and that is the honest answer

**P58d adds no Go unit test at all.** It is the first sub-phase in P58 for which that is true, and the
reason is structural rather than a judgement call:

- The bar names *"a parser or splitter with several interacting lexical rules"* — **neither adapter
  has a parser.** SQS's only text input is `$headers`, which is `json.Unmarshal` plus a
  three-condition type check; S3's sentinels are map lookups.
- It names *"cursor/pagination boundary arithmetic with real boundary cases"* — **neither adapter
  does any.** §1.3 establishes that neither calls `EncodePageToken`, `DecodePageToken`,
  `RequestFingerprint` or `SafeInt`; SQS's `PagePosition` is a constant literal and S3's is
  `UnpagedPosition(1)`.
- It names *"cache eviction/invalidation with rules that interact"* — the closest candidate is
  **P58d D9**'s bounded receipt-handle map, and it is a FIFO with one rule. A dedicated test for it
  would be a "delete the oldest of three" round trip, which the bar's own exclusion list covers
  (*"a branch is not complexity"*). The real risk it carries is **concurrency**, and the thing that
  catches concurrency here is `-race` over the acceptance suite, not a unit test.
- It names *"concurrency — ordering, backpressure, cancellation, races"* — the cancellation behaviour
  **P58d D3** turns on is only observable against a real in-flight request, which is §5.4's
  mid-stream download case, not a unit test.

Candidates considered and rejected by name, so nobody re-proposes them: `formatBytes` (a five-line
loop, pinned byte-exactly by two acceptance assertions — **P58d D15**); **P58d D8**'s headers encoder
(a five-field struct-to-JSON, pinned by an exact-string acceptance assertion); `awscfg.Resolve`'s
mode branching (two branches and a required-field guard, the bar's own example of what gets nothing);
`countObject`'s formula (arithmetic over three booleans, pinned by scenarios 13 and 19). This mirrors
P58c's own finding that almost nothing in Mongo/Redis cleared the bar except the two parsers — with
the difference that P58d has no parser at all, so the count goes to zero rather than to two.

### 5.6 `tests/e2e-real/` — nothing changes, the full suite still runs after every flip, and the one spec P58 §5.5 wants cannot be built

**Nothing in `tests/e2e-real/` changes.** §1.10 is the evidence: `TestKindNodeServed` is already
`"kafka"`, `mariadb-real.spec.ts`'s coexistence half already connects Kafka as its Node-served side,
and Kafka stays Node-served through P58d. **P58d needs no equivalent of P58c C14 or C15.**

**The full suite still runs after every flip**, per `AGENTS.md`'s P58b M6.4 finding, restated as this
sub-phase's rule:

> A `tests/e2e-real/*.spec.ts` regression sweep must be re-run in full after every `nativeKinds`
> flip, not just for the kind that just went native, because a shared code path — `adapterhost.Router`
> above all — is common to every native adapter.

M8.2 and M8.3 each end with `postgres-real.spec.ts` (2 tests), `sqlite-real.spec.ts` and
`mariadb-real.spec.ts` (2 tests) green, including their `expect(consoleErrors).toEqual([])`
assertions.

**P58 §5.5's proposed S3 `objectDownload` spec cannot be built in this tier, and this plan says so
with the evidence rather than declining on taste.** The parent writes: *"The one addition worth making
is a spec for the S3 `objectDownload` file-write contract, which `P57-e2e-revisit.md` §7 left
conditional and which is the last full-stack behaviour with no automated home."* The first step of
that flow is `control.filesChooseSave` (§1.5 step 1) — a native save dialog. Under `-tags server`,
Wails v3.0.0-beta.15 supplies `serverSaveFileDialog` whose entire `show()` body is
`return ch, errors.New("file dialogs not available in server mode")`
(`pkg/application/application_server.go`), and there is **no `dialogs_server.go`** at all
(`dialogs_linux.go` is `//go:build linux && !android && !server`). So the renderer can never obtain a
`destPath`, and a spec that bypassed the dialog by calling the data plane directly would be testing
the dispatcher, which `adapterhost/data_test.go` already covers. The download contract's real
coverage is §5.4's four ported scenarios plus the mid-stream case; the full-stack half stays
P58 §6's manual macOS row (*"A real S3 download through the AppKit save panel"*), where P57 D16 put
it. §10 OQ-5 asks the parent's author to amend §5.5 so P58f does not re-propose it.

### 5.7 What P58d deliberately does not test

- **The `tests/ipc/sqs/` fixtures against the Go producer.** §1.12 — **P58 D13**'s job, P58f's
  milestone. Doing one of seven early would leave two generators in the tree.
- **An `E_AUTH` round trip.** §1.9: LocalStack accepts any credentials, neither TypeScript spec has
  such a scenario, and producing a real SigV4 rejection would need real AWS. The mapping ports on the
  SDK's own error codes and the gap is recorded (OQ-4), not papered over.
- **A multipart upload.** `openUploadBody`'s 5 GiB ceiling and its *"multipart upload is not
  supported"* message port verbatim; the branch is asserted with a small stubbed size check, not by
  seeding a 5 GiB file.
- **A scoped-bucket (`options.bucket`) connection against a genuinely `ListBuckets`-denying IAM
  policy.** The `HeadBucket` path is exercised; the IAM shape it exists for cannot be reproduced on
  LocalStack's permissive default and is not worth an `ENFORCE_IAM` fixture.
- **Packaging.** No bundle change; `verify-packaging.sh` is untouched and still correct.

## 6. M8.0 — the probes, concretely

Five throwaway Go programs under the scratch directory (**never committed; no product code lands in
M8.0**), each answering one question with a printed PASS/FAIL. The deliverable is a findings
subsection appended to this document (§9 commit 1) and, for anything surprising, an `AGENTS.md`
entry. Ordering: TC-4 first (everything else needs a container), then AWS-1 and AWS-2, then AWS-3,
then AWS-4 last (it needs both seeders).

**These probes are written against `AGENTS.md`'s own hardest-won lesson**, from P58b M6.3:
*"an M6.0-style probe is only as complete as the specific inputs it tried."* Probes AWS-1(c), AWS-3(d)
and AWS-4 are therefore written as **input inventories**, not capability checks.

| Probe | What it runs | Asserts | If it fails |
|---|---|---|---|
| **TC-4** | A bare `testcontainers.GenericContainer` for `localstack/localstack:3` (mirror-retagged, **no `library/` prefix** — already namespaced), `SERVICES=s3,sqs`, exposed `4566/tcp`, `wait.ForHTTP("/_localstack/health").WithPort("4566/tcp")`. Create a queue and a bucket through the SDK, then terminate. Time the startup with and without `SERVICES=s3,sqs` | It starts **here**, under this sandbox's fixed 20 000 `ulimit -Hn` (the ClickHouse subclass problem, P58b's own finding — LocalStack is not expected to set one, but check rather than assume); the health endpoint is the right readiness signal (a `ForLog` on `"Ready."` is the named fallback); `SERVICES` measurably cuts startup; **and no Docker socket bind is needed** for either service, which is the load-bearing half of **P58d D22** | If the bare container will not come up, fall back to `modules/localstack@v0.44.0` and take **P58d D22**'s cost explicitly — `MustExtractDockerSocket`'s panic path and the `aws-sdk-go` v1 graph entry — written down at the moment it is taken, not discovered later |
| **AWS-1 (SQS)** | Against that container: **(a)** `ListQueues`, print the returned `QueueUrl`s, then call `ReceiveMessage` with a **deliberately mangled** `QueueUrl` host (pointing at a black hole) and confirm the request still reaches LocalStack — proving the URL is a body parameter, not the request target; **(b)** capture the raw HTTP request through a tiny logging proxy and print the `X-Amz-Target` header for `GetQueueUrl`, `ReceiveMessage` and `GetQueueAttributes`; **(c)** send one message with a String attribute, one with a Binary attribute, and one with none, then `ReceiveMessage` with `MessageAttributeNames: ["All"]` + `MessageSystemAttributeNames: [All]` and print the **complete** `types.Message` — every field of `Attributes` and of each `MessageAttributeValue`, plus what `json.Marshal` of that struct produces; **(d)** `GetQueueUrl` and `ReceiveMessage` against a queue that does not exist, printing `%T`, `ErrorCode()` and `Error()`; **(e)** `ReceiveMessage` with `WaitTimeSeconds: 20`, cancel the ctx after 300 ms, and print whether the call returns promptly and whether `errors.Is(err, context.Canceled)` holds through the SDK's `*smithy.OperationError` wrapper; **(f)** `GetQueueAttributes(All)` on a seeded queue, printing the full key set | (a) the endpoint read of §1.6 confirmed against a live server — if it is wrong, the fixture needs `LOCALSTACK_HOST` and a fixed host-port binding, and §4.6 changes; (b) `AmazonSQS.GetQueueUrl` exactly, which **P58d D10**'s proxy keys on; (c) the input inventory **P58d D8**'s encoder is written against, including what the naive `json.Marshal` would have emitted; (d) the `E_QUERY` path's real message text, for §5.3's re-baseline; (e) **the single most load-bearing assertion in M8.0** — if a cancelled ctx does *not* abort an in-flight SDK request, **P58d D3**'s entire premise fails and both adapters' `caps.cancel` have to be re-examined; (f) that `VisibilityTimeout`, `ApproximateNumberOfMessages`, `QueueArn`, `CreatedTimestamp` and `LastModifiedTimestamp` are all present on LocalStack, which scenario 6 asserts | (e) failing is a **stop and raise** — it would mean neither adapter has any cancellation at all and `caps.cancel: true` is a lie in Go where it was true in TypeScript. (a) failing changes §4.6's fixture, not any decision. (b) failing changes **P58d D10**'s discriminator (fall back to matching the JSON body's operation, which is uglier but works) |
| **AWS-2 (credentials)** | `config.LoadDefaultConfig` in four shapes, with `AWS_CONFIG_FILE`/`AWS_SHARED_CREDENTIALS_FILE` pointed at a temp dir: **(a)** `WithRegion` + `WithCredentialsProvider(NewStaticCredentialsProvider(...))`; **(b)** `WithRegion` + `WithSharedConfigProfile("does-not-exist")` with no config file at all; **(c)** the same with a real config file containing a different profile; **(d)** the same with the named profile present. For each, print `%T` and `Error()` of any error, and **when** it appeared (at `LoadDefaultConfig` or at the first `ListQueues`) | (b) and (c) return `config.SharedConfigProfileNotExistError` **from `LoadDefaultConfig`**, confirming §1.9's timing change; (d) resolves; (a) never touches the filesystem. Also: what a wrong static key produces against LocalStack (expected: nothing — LocalStack accepts it — which is the honest confirmation that §5.7's untested `E_AUTH` gap is real, not a missing test) | If the profile error appears at first-request time instead, **P58d D7**'s recorded behaviour change is wrong and the note is deleted rather than shipped |
| **AWS-3 (S3)** | Against the same container, with `BaseEndpoint` + `UsePathStyle`: **(a)** `PutObject` with an `*os.File` body and explicit `ContentLength`, under the **default** `RequestChecksumCalculation`; **(b)** the same with a deliberately non-seekable `io.Reader` (an `io.LimitReader` over a pipe), to see the `aws-chunked` path and whether LocalStack accepts it; **(c)** `HeadObject` and `GetObject` on a missing key, printing `%T`/`ErrorCode()`/`Error()` for each; **(d)** `HeadObject` on a seeded object, printing **every** field — is `StorageClass` empty or `"STANDARD"`, are `Metadata` keys lowercased, does `ETag` carry quotes, is `ContentLength` non-nil; **(e)** `GetObject` of a 5 MB object, `io.Copy` into a temp file, ctx cancelled after ~100 KB — does `io.Copy` return promptly, does `errors.Is(err, context.Canceled)` hold, and is the partial file removable; **(f)** `ListObjectsV2` with `Delimiter: "/"` over the seeded prefixes, printing `CommonPrefixes`, `Contents` and whether an exact-prefix directory marker appears; **(g)** `PutObject` with each of **P58d D13**'s seven preserved attributes set, then `HeadObject`, confirming all seven survive | (a) succeeds → **P58d D6** needs no override; (b) tells us how much of a cliff the non-seekable path is, for the record; (c) `*types.NotFound` for HEAD and `*types.NoSuchKey` for GET, with their real messages for §5.4's re-baseline; (d) the input inventory **P58d D16**'s formula and §5.4's assertions depend on; (e) the mid-stream cancellation §5.4's new case and **P58d D3** both rest on; (f) that the catalog's prefix/object split works against LocalStack the way it does against real S3; (g) that seven-field preservation is real and not silently dropped by LocalStack | (a) failing → take `config.WithRequestChecksumCalculation(aws.RequestChecksumCalculationWhenRequired)` explicitly and record it against **P58d D6**. (e) failing (a copy that runs to completion after cancellation) → **stop**: §4.4's cleanup ordering is unsafe and the download design needs rethinking before M8.3 |
| **AWS-4 (cross-check)** | Start the TypeScript fixtures (`bun test tests/db/sqs.spec.ts -t '4\.'` is enough to bring one up, or run `support/sqs.ts`'s seeder directly) and a Go-seeded container side by side. Diff: the two queue inventories (names, message counts, one message's full attribute map) and the two bucket inventories (`ListObjectsV2` key sets, and each object's `ContentType`/`ContentLength`/`Metadata`). Separately, print the JS adapter's `headers` and `attrs` cell text for a seeded message and the Go encoder's (**P58d D8**) for the same message, and **diff them character by character** | The two seeders produce the same dataset (**P58d D24**'s cost bought back); and the two `headers`/`attrs` renderings are identical, or **differ in a named, understood way**. The predicted divergences are exactly two: none for `attrs`, and none for `headers` **once the hand encoder is used** — the probe's job is to prove that the naive `json.Marshal` form is what would have differed, and to produce the exact expected string §5.3's test pins | A third divergence means §1.7's analysis is incomplete and **P58d D8**'s encoder needs another field before M8.2 writes a line |

## 7. Checkpoint — none, and why that is the right answer rather than an omission

P58 §0.3 defines **checkpoint C1** (after M5) and **checkpoint C2** (before M10) and assigns no
checkpoint to M8. P58b §7 added **checkpoint C1b** on the grounds that it was *"the half of C1 that
P58a could not run"*; P58c §7 added **checkpoint C1c** on the narrower grounds that **P58c was the
sub-phase that broke checkpoint C1b's own vehicle** (its MongoDB half went native), so a plan that
re-pointed the vehicle owed a re-run of the proof.

**Neither reason applies to P58d, and this plan does not manufacture a third.**

- **P58d breaks no vehicle.** §1.10: `TestKindNodeServed` is already `"kafka"`,
  `mariadb-real.spec.ts`'s coexistence half is already Kafka-paired, and Kafka stays Node-served
  through this whole sub-phase. Checkpoint C1b's proof and checkpoint C1c's re-run both remain valid
  and both keep passing, unmodified, after each of P58d's two flips — which §5.6's mandatory full
  sweep verifies twice.
- **P58 D4's coexistence property is already proven twice in a running app**, by checkpoint C1b and
  again by checkpoint C1c (`AGENTS.md`'s P58c entry records all 14 steps passing). A third run of the
  same proof against the same pairing would be ceremony.

**What P58d does owe, and gets as acceptance criteria rather than as a numbered checkpoint** (§8's
M8.2 and M8.3 lists), because two page-level firsts genuinely have never met the real renderer:

1. **A native `StreamPage`.** SQS is the first Go producer of `page.NewStreamPageBuilder`, which has
   been in the tree since P58a M2 and never called. Every stream page the app has ever rendered came
   from the Node child.
2. **A native S3 object page and Browse tab.** Redis proved `KeyValuePage` and `caps.keyBrowser` in
   checkpoint C1c, but S3's is a different producer with a different `redisType`, a different
   `memoryBytes` source and — uniquely — a Download menu item the renderer gates on
   `caps.fileTransfer`.

Both are checked the way checkpoint C1c was actually run: **a throwaway `tests/e2e-real/` script, not
committed**, in one Bash invocation, recorded step by step in §13 with "not available in this
session" written out rather than implied. That is a verification step in an acceptance list, not a
coexistence proof, and calling it one would devalue the two that are.

## 8. Acceptance criteria

**Per milestone**

- **M8.0** — all five probes have a recorded PASS, or a recorded FAIL with its consequence taken
  explicitly (§6). **No product code committed.** **P58d D3**'s premise (AWS-1(e)) and **P58d D6**'s
  default (AWS-3(a)) are either confirmed or corrected in writing before M8.2/M8.3 start.
- **M8.1** — `cd shell && go test ./... -race` green with **`nativeKinds` unchanged**;
  `testsupport.StreamKeyAt`/`StreamHeadersAt`/`StreamAttrsAt`/`StreamTimestampAt`/`StreamBodyAt`
  present and built on the existing `chunkCellAt`; `testsupport`'s LocalStack starter and counting
  proxy present with a connectivity test that starts a container, proxies one `GetQueueUrl` and
  asserts the counter reads 1; **`grep -rn 'TestKindNodeServed' shell/internal` still shows
  `"kafka"`** (P58d moves nothing — §1.10); `git diff --stat src/` empty.
- **M8.2** — `go test ./internal/adapters/sqs/ -race` green against a real container, or explicitly
  recorded as Docker-unavailable; `nativeKinds` contains `sqs`; **`shell/main.go` has the blank
  import** (§4.7's most-forgotten step); §5.3's four called-out cases all present and passing;
  `tests/db/sqs.spec.ts` deleted in the milestone's last commit, `tests/db/support/sqs.ts` **kept**
  after a re-grep (**P58d D20**); the whole existing suite (`bun run lint`, `bun run typecheck`,
  `bun run test:unit`, `bun run test:go`, `bun run test:ui`, `bun run test:ipc:fe`) green; **the full
  `tests/e2e-real/` suite green** (§5.6); a **native `StreamPage` rendered in the real app** and
  recorded (§7); `git diff --stat src/` empty.
- **M8.3** — `go test ./internal/adapters/s3/ -race` green against a real container; `nativeKinds`
  contains `s3`, reaching **nine of ten**; `shell/main.go` has the second blank import; §5.4's seven
  called-out cases all present and passing, **including the mid-stream cancellation case**;
  `tests/db/s3.spec.ts` deleted last, and `tests/db/support/s3.ts` + `fixtures/0007_s3_seed.ts`
  deleted **only if** the re-grep is clean, with the result recorded either way; **the full
  `tests/e2e-real/` suite green**; a **native S3 object page and Browse tab rendered in the real
  app** and recorded (§7); `git diff --stat src/` empty.

**Phase-level**

1. `bun run lint`, `bun run typecheck` (all four projects), `bun run test:unit`, `bun run test:go`,
   `bun run test:ui`, `bun run test:ipc:fe` are green.
2. `cd shell && go test ./... -race` is green. **`-race` is the bar, not plain `go test`** — and in
   P58d it earns its keep for a reason no previous sub-phase had: **P58d D9**'s two adapter-local
   caches are written on the read path from whatever goroutine an op runs on, and the TypeScript
   they are ported from was safe only because JavaScript is single-threaded.
3. **`git diff --stat src/` is empty.** Not "empty except one file" — empty (**P58d D21**).
4. **`git diff --stat tests/ui tests/ipc tests/e2e-real` is empty**, including every `*.fixture.ts`
   (§1.12, §5.6).
5. `git diff --stat shell/internal/page shell/internal/enginecache shell/internal/enginebackend`
   is empty (§1.3 — the substrate needed nothing).
6. The whole `git diff --stat` scope, enumerated in advance so a surprise is visible:
   - **`shell/internal/adapters/`** — three new directories (`awscfg/`, `sqs/`, `s3/`),
     `testsupport/` grown by three files and one edited `spec.go`.
   - **`shell/internal/adapterhost/router.go`** — `nativeKinds` ×2, nothing else.
   - **`shell/main.go`** — two blank imports. **`shell/go.mod`/`go.sum`** — five AWS modules,
     `github.com/google/uuid` promoted from indirect to direct, nothing test-only.
   - **`tests/db/`** — two spec deletions, at most one support deletion and one fixture deletion.
   - **`docs/`, `AGENTS.md`** — per §3.
   - **`src/`, `tests/ui/`, `tests/ipc/`, `tests/e2e-real/`, `package.json`, `scripts/`,
     `.github/`** — nothing.
7. `AGENTS.md` gains a **"P58d implementation findings"** entry on the P52–P58c pattern, carrying at
   minimum: M8.0's five probe results; whether AWS-1(e) confirmed that a cancelled `context.Context`
   really aborts an in-flight SDK request (**P58d D3**'s premise); whether the SDK's default checksum
   calculation needed an override (**P58d D6**); the two JavaScript guarantees that did not survive
   translation (**P58d D9** — `Map` insertion order and single-threadedness, both invisible in a port
   that reads correct); §1.11's three unmet predecessor closeout claims, recorded as observed; and
   the general lesson **P58c C14/C15 earned and P58d collected**: *a placeholder parked on the kind
   that goes native **last** costs its author one line and costs nobody anything afterwards* — P58d
   moved no placeholder at all, and P58e should expect the opposite, since it is Kafka's own
   sub-phase and both placeholders point at Kafka.
8. `docs/ARCHITECTURE.md` is updated, and **criterion 8 is phrased as a grep rather than as a prose
   claim**, because the prose form has now failed twice (§1.11):
   - `grep -n "node:sqlite\|CLIENT KILL\|AbortSignal on the SDK call\|AbortController on the SDK call" docs/ARCHITECTURE.md`
     returns **nothing between the mapping table's first and last row** — i.e. the SQLite cell, the
     Redis cell, the SQS cell and the S3 cell are all rewritten;
   - the S3 row's **Exact count** cell no longer says *"`KeyCount` per listed page only"*, which
     contradicts `s3Caps.exactCount = true` and `countObject`'s per-object exact answer
     (**P58d D18**);
   - the **Stack** driver line names the Go drivers for the nine native kinds;
   - the **SQS** and **S3** per-engine sections gain the "Go-native as of P58d M8.2/M8.3" treatment
     P58b and P58c gave theirs, naming: the two adapters' inverted cancellation model (**P58d D3**),
     the profile-resolution timing change (**P58d D7**), the `headers` encoding (**P58d D8**), and
     the fact that S3's `DownloadObject` is the phase's first and only real file transfer.
9. This document gains its own **§12 M8.0 results** and **§13 M8.1–M8.3 results** sections, the way
   P58a's, P58b's and P58c's §12/§13 record what actually happened — including any decision that
   turned out wrong.

## 9. Sequencing

Four milestones, in order, with the commits inside each. The parent's hard rules apply unchanged: its
**R2** (the substrate lands before any adapter) is why M8.1 is a milestone rather than two scattered
edits; its **R3** (an adapter's Go tests land and fail before its implementation) is encoded in
M8.2's and M8.3's commit lists; its **R4** (probes before the work they inform) is why M8.0 is first;
its **R1** is P58f's and does not bind here.

**M8.0 — probes** *(no commits to `shell/`)*
1. `docs: record P58d M8.0 probe results` — this document gains a findings subsection; **P58d D3**'s
   premise and **P58d D6**'s default are confirmed or corrected in writing.

**M8.1 — the shared lifts** *(`nativeKinds` unchanged throughout)*
2. `test(testsupport): stream-page readers for the acceptance suites` — `spec.go` gains
   `StreamKeyAt`/`StreamHeadersAt`/`StreamAttrsAt`/`StreamTimestampAt`/`StreamBodyAt`, all built on
   the existing `chunkCellAt` so the null-vs-empty rule lives in one place (§1.3 gap 1).
3. `test(testsupport): a LocalStack container fixture and an operation-counting proxy` —
   `localstack.go` (**P58d D22**) plus the `X-Amz-Target`-keyed counting reverse proxy
   (**P58d D10**), with a connectivity test that starts a container, proxies one `GetQueueUrl` and
   asserts the counter. **Full `go test ./... -race` runs here**, `nativeKinds` untouched.

**M8.2 — SQS**
4. `test(sqs): a container fixture with three seeded queues` — `testsupport/sqs.go` plus a trivial
   connectivity test proving the seed matches §4.6.
5. `test(sqs): the Go acceptance suite, against a real LocalStack container` — `sqs_test.go`,
   `main_test.go`, **failing** (**P58 D12** / its **R3**), including §5.3's four called-out cases.
6. `feat(adapters): shared AWS client config and SDK error mapping` — `awscfg/` (**P58d D2**,
   **P58d D4**, **P58d D7**), written against both `client.ts` files side by side.
7. `feat(sqs): client, connect, the queue catalog and its URL cache` — `client.go`, `errors.go`,
   `caps.go`, `catalog.go`, and `adapter.go`'s connect/disconnect/children. Carries **P58d D9**'s
   mutexes and ordered eviction; the commit to review hardest in this milestone.
8. `feat(sqs): poll a queue, count it, and show its attributes` — `read.go`, `definition.go`. First
   caller of `page.NewStreamPageBuilder`; carries **P58d D8** and **P58d D11**.
9. `feat(sqs): send and delete a message` — `mutate.go`.
10. `feat(adapterhost): serve sqs in-process` — `nativeKinds += sqs`, `main.go` += one blank import.
    **Full `tests/e2e-real/` sweep runs here**; the commit message records it, the acceptance run,
    and the first native `StreamPage` render (§7).
11. `test: delete tests/db/sqs.spec.ts, its subject now in Go` (**P58d D20**) — **re-grep
    `support/sqs.ts`'s consumers first**; it is expected to stay (§1.11).

**M8.3 — S3**
12. `test(s3): a container fixture with three seeded buckets` — `testsupport/s3.go`.
13. `test(s3): the Go acceptance suite, against a real LocalStack container` — `s3_test.go`,
    `main_test.go`, **failing**, including §5.4's seven called-out cases.
14. `feat(s3): client, connect and the bucket/prefix catalog` — `client.go` (**P58d D5**),
    `errors.go`, `caps.go`, `catalog.go`, and `adapter.go`'s connect/children. Carries the app's
    second `Truncated` producer.
15. `feat(s3): read and count one object` — `read.go`. Carries **P58d D12** and **P58d D16**.
16. `feat(s3): edit, upload and delete an object` — `mutate.go`. Carries **P58d D13**,
    **P58d D14** and **P58d D6**'s `*os.File` body.
17. `feat(s3): the first native object download` — `transfer.go`. **The commit to review hardest in
    the whole sub-phase**: it is the only code in P58 that writes to a user's filesystem, and §4.4's
    ten steps are its whole specification.
18. `feat(adapterhost): serve s3 in-process` — `nativeKinds += s3`, `main.go` += one blank import.
    **Nine of ten. Full `tests/e2e-real/` sweep runs here**; the commit message records it and the
    first native S3 object page / Browse tab render (§7).
19. `test: delete tests/db/s3.spec.ts, its subject now in Go` (**P58d D20**) — **re-grep first**;
    `support/s3.ts` and `fixtures/0007_s3_seed.ts` go with it only if the grep is clean.
20. `docs: P58d findings — two AWS adapters, one SDK, and the first real file transfer` —
    `AGENTS.md`, `docs/ARCHITECTURE.md` (including the two mapping-table cells P58c left stale, per
    §8 criterion 8's grep form), and this document's §12/§13.

**Why SQS before S3.** Three reasons, in order of weight. SQS is the smaller adapter (671 lines to
915) and the one whose Go shape is most nearly a transcription, so it is the cheaper place to
discover that **P58d D3** or **P58d D4** is wrong. It is also the one that carries `awscfg`'s first
use, and shaping a shared package around the *simpler* of two consumers and then adapting is safer
than the reverse. And S3 carries `transfer.go`, the phase's one genuinely new capability — landing it
last means it can take a second pass without blocking a flip that is already green.

**Why `awscfg` lands inside M8.2 rather than in M8.1.** It has no consumer until the SQS adapter
exists, and a package with no consumer is a package written against one reading of two files rather
than against a compiler. **P58b B14** hoisted `RunWithAbortRace` into its own milestone *because
`postgres/query.go` was already there to call it*; nothing here is. It is written in commit 6 with
both `client.ts` files open, and if S3 needs it changed in M8.3 that change is its own commit and is
recorded.

## 10. Open questions for the parent plan's author

Each of these affects P58e–P58f as much as P58d, or records a predecessor plan's claim that the tree
contradicts. None is silently resolved; where P58d needs a working assumption to proceed it is stated
as *interim* and marked reversible.

**OQ-1 — P58b's four `tests/db/*.spec.ts` deletions are still outstanding, two sub-phases later, and
P58d is about to follow the same instruction for the fifth and sixth time.** §1.11.
`tests/db/{clickhouse,mariadb,mysql,sqlite}.spec.ts` are all still in the tree at `b40a09e`; only
P58a's and P58c's own deletions ever landed. After M8.3, `bun run test:db` would run four container
suites against TypeScript adapters serving no real connection, plus kafka's. P58c raised this as its
own OQ-1 and took disposition (a) — *"delete my own two, record the other four as outstanding"* —
which is what P58d does too (**P58d D20**). The parent's author still owns the choice between (a),
(b) *"P58d deletes all six"*, and (c) *"amend P58 D12's third rule; every remaining
`tests/db/*.spec.ts` retires in P58f alongside `src/engine/`"*. Note that (c) has a real argument
behind it that has still never been written down: a still-passing TypeScript spec is a live oracle to
diff a Go port against, which P58b §11 and P58c §11 both explicitly recommended using, and which §11
below recommends again for SQS and S3.

**OQ-2 — the `docs/ARCHITECTURE.md` mapping-table edit has now been required by two consecutive
sub-phases' acceptance criteria and made by neither.** §1.11. P58b §8 criterion 9 required the
SQLite Cancel cell; P58c §8 criterion 9 required the Redis cell and, per its own OQ-2, SQLite's too.
At `b40a09e` the SQLite row still says *"none — SQLite has no interruptible statement
(`sqlite3_interrupt` doesn't exist in `node:sqlite`…)"* and the Redis row still says *"`CLIENT KILL`
for blocking cmds"*. In both sub-phases the **per-engine prose sections were rewritten and are
excellent** — it is only the table that gets missed, which suggests the criterion's *form* is the
problem, not anyone's diligence. **P58d interim: fix all four cells plus the Stack driver line, and
phrase the criterion as a grep** (§8 criterion 8) so it fails mechanically rather than being
self-assessed. The parent's author may prefer that a sub-phase never edit another's rows; if so, say
so, because the alternative is that the table stays wrong until someone notices a third time.

**OQ-3 — P58c §1.1's "only `Truncated` producer" claim is wrong, and the corrected version matters
for P58d's own tests.** §1.11. `s3/catalog.ts` is the second producer; P58c misread
`project/state/tree.ts`, which is a statement about the project tree's *consumers*. Nothing already
built depends on the wrong version. Recording it because §5.4 adds the positive truncation test S3
needs, and because a future reader diffing the two plans would otherwise trust the older one.

**OQ-4 — neither SQS nor S3 has an `E_AUTH` oracle in either language, and P58d does not add one.**
§1.9, §5.7. LocalStack accepts any credentials by default; neither TypeScript spec has an
auth-failure scenario (both scenario 2s are URI-parse failures); and producing a genuine SigV4
rejection would need either real AWS or a LocalStack `ENFORCE_IAM` configuration whose fidelity is
itself unproven. **P58d interim: port the mapping on the strength of the SDK's own error codes
(AWS-2 prints them), record the gap in `AGENTS.md`, and add no test.** If the parent's author wants
the gap closed, the cheapest honest vehicle is a `ENFORCE_IAM=1` LocalStack variant in a single
scenario, and it should be scoped as its own piece of work rather than absorbed here.

**OQ-5 — P58 §5.5's proposed `tests/e2e-real/` S3 download spec cannot be built, and the reason is
structural rather than circumstantial.** §5.6. Wails v3.0.0-beta.15 has no `dialogs_server.go`;
`application_server.go`'s `serverSaveFileDialog.show()` returns
`errors.New("file dialogs not available in server mode")`; and `control.filesChooseSave` is the first
step of the renderer's own download flow. So the tier this repo uses as its substitute for a GUI can
never exercise the contract. **P58d interim: do not add the spec**; coverage stays §5.4's four ported
scenarios plus the new mid-stream case, and the full-stack half stays P58 §6's manual macOS row,
where P57 D16 put it. The parent's author should amend §5.5 so P58f does not re-propose it as
outstanding work — and, if a headless full-stack download check is genuinely wanted, the honest
vehicle is a `//go:build server` dialog stub in *this* repo's `internal/shell`, which is a design
decision (a test-only code path in the shell) rather than a test.

## 11. Environment notes for the implementing session

- **A fresh container has none of the toolchain.** Go, plus
  `apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev pkg-config` for anything that builds
  `internal/shell` or the root `main` package. `./internal/adapters/...` needs none of it, so the
  fast loop for the whole of M8.1–M8.3 is `go test ./internal/adapters/{sqs,s3}` and never `./...`.
  Only the `tests/e2e-real/` sweeps and §7's two render checks need the headers.
- **Docker**: `nohup dockerd > /tmp/dockerd.log 2>&1 & disown` here; `colima start` on macOS. P58d
  needs exactly **one** image: **`localstack/localstack:3`**, which is **already namespaced**, so it
  mirrors at `mirror.gcr.io/localstack/localstack:3` with **no `library/` prefix** —
  `AGENTS.md`'s Docker section names this exact image in its own rule. The `tests/e2e-real/` sweeps
  additionally need `mariadb:11.4` (official → `library/`), `postgres:17` (official → `library/`) and
  `confluentinc/cp-kafka:8.0.7` (already namespaced → no prefix).
- **LocalStack is slow to start.** The TypeScript fixtures allow 120 s
  (`tests/db/support/{sqs,s3}.ts`) and the testcontainers module's own wait strategy allows the same.
  Budget accordingly, set `SERVICES=s3,sqs` (TC-4 measures what it saves), and remember that **two Go
  packages means two test binaries means two containers** — `go test ./internal/adapters/...` will
  start LocalStack twice.
- **`bun test tests/db/{sqs,s3}.spec.ts` runs here and is a live oracle** to diff the Go port
  against, exactly as P58b §11 recommended for SQLite and P58c §11 for Mongo. Both are Docker-gated,
  both pull through the mirror, and `s3.spec.ts` in particular is worth running once before writing
  its Go successor — its download scenarios are the reference AWS-3(e) is checked against.
- **`go test ./... -race` is the bar**, not `go test ./...`, and in P58d it matters for a reason no
  previous sub-phase had: **P58d D9**'s `queueUrls` and `receiptHandles` are written from whatever
  goroutine an op runs on, and the TypeScript they come from was safe only because JavaScript is
  single-threaded. The counting proxy's own counter needs a mutex too.
- **Use `t.TempDir()` for every download destination**, never a hand-rolled path under `/tmp`: Go
  cleans it up, and §5.4's assertions read the directory's contents to prove no `.kira-partial-*`
  sibling survived.
- **Install `wails3` pinned** to `shell/go.mod`'s exact version (`v3.0.0-beta.15`), never `@latest`
  (P55's finding).
- **`shell/frontend/bindings` is git-ignored** and must be regenerated
  (`wails3 generate bindings -b -i -ts -names`) before `bun run build` resolves its imports. P58d
  changes no bound method signature, so one regeneration per fresh container is enough.
- **`shell/runtime/` is git-ignored too**, and P58d still needs both halves: `scripts/vendor-node.sh`
  for `runtime/node/bin/node` and `bun run build:engine` for `runtime/engine/engine.cjs`. The app
  refuses to start without the engine bundle (P56 D12), and after M8.3 the child still serves
  **one of ten** kinds — `kafka`, and only `kafka`.
- **A background process started in one shell invocation cannot be signalled from a later one**
  (P51's finding, still true). §7's two render checks — start, exercise, tear down — are one Bash
  invocation with a 120–150 s timeout.
- **There is no real X display here**, so §7's checks are written against `tests/e2e-real/`'s
  `-tags server` vehicle rather than `xdotool`/`import -window`. Do not spend a session trying to
  make the screenshot path work; P58a already established that it does not. And note the corollary
  §5.6 rests on: the same `server` build tag that makes that vehicle possible is what removes the
  file dialogs, so the download flow's first step is unreachable there.
- **Comparing a struct containing an `any` field with `==` panics at runtime** rather than failing to
  compile (P55's finding). `model.ConnectionState.Caps` is such a field — use `go-cmp` (already a
  dependency), never `==`.

## 12. M8.0 results

Ran all five probes in a throwaway scratch Go module against `localstack/localstack:3` on real
Docker (`docker` 29.3.1, this sandbox), per §6. No product code lands from this milestone.

**TC-4 — PASS, with one prediction corrected.** The bare `GenericContainer` starts here in ~4 s once
the image layer is warm (first pull/first container in a session pays a one-time ~18 s cold-start
tax that has nothing to do with `SERVICES`). `CreateQueue` and `CreateBucket` both succeeded through
the SDK with no Docker socket bind configured anywhere — **P58d D22**'s load-bearing half holds.
**Correction to the plan's own prediction:** run three times each way, alternating order to control
for warm-cache effects, `SERVICES=s3,sqs` showed **no measurable startup improvement** over the
default (all-services) image in this sandbox — both land at 3.8–4.3 s. The plan's "SERVICES
measurably cuts startup" claim does not hold here; `SERVICES=s3,sqs` is kept anyway for the reason
that survives regardless (trimming what the container tries to initialize is still the right default
even where this sandbox's local disk/network make the difference too small to see), and this
correction is the answer if a future session re-measures and is confused by a flat result.

**AWS-1 (SQS) — PASS on every point, including the load-bearing one.**
- (a) A mangled `QueueUrl` host does not matter at all: the physical request target is
  `Options.BaseEndpoint`, always, regardless of what host is embedded in the URL string a prior
  `CreateQueue` returned — confirming §1.6's model outright rather than merely "not breaking".
- (b) `X-Amz-Target` is exactly `AmazonSQS.<Operation>` for every operation tried
  (`CreateQueue`, `ListQueues`, `GetQueueUrl`, `ReceiveMessage`, `GetQueueAttributes`) —
  **P58d D10**'s discriminator is confirmed on the wire, not just from the source read.
- (c) The naive `json.Marshal` of `types.MessageAttributeValue` produces exactly the
  all-fields-with-nulls shape **P58d D8** exists to avoid:
  `{"source":{"DataType":"String","BinaryListValues":null,"BinaryValue":null,"StringListValues":null,"StringValue":"seed"}}`.
  The JS adapter's own source (`src/engine/adapters/sqs/read.ts`'s `pushMessage`,
  `JSON.stringify(message.MessageAttributes ?? {})`) confirms the target shape is
  `{"source":{"DataType":"String","StringValue":"seed"}}` — `JSON.stringify` drops `undefined`
  fields, which is exactly what **P58d D8**'s hand encoder reproduces by emitting only non-nil/
  non-empty fields. `attrs` needs no encoder either way: `json.Marshal` of `map[string]string`
  already matches `JSON.stringify` of the same map.
- (d) `GetQueueUrl`/`ReceiveMessage` against a missing queue both come back as
  `*smithy.OperationError` wrapping a `smithy.APIError` with `ErrorCode() ==
  "AWS.SimpleQueueService.NonExistentQueue"` and message `The specified queue does not exist.` —
  recorded for §5.3's re-baseline.
- **(e) — the single most load-bearing assertion in M8.0 — PASS.** A `ReceiveMessage` with
  `WaitTimeSeconds: 20`, cancelled after 300 ms, returned in **330 µs** with
  `errors.Is(err, context.Canceled) == true`. **P58d D3**'s entire premise is confirmed: the SDK's
  own context plumbing aborts an in-flight long-poll immediately, through
  `*smithy.OperationError`'s wrap, with no `RunWithAbortRace` needed or wanted.
- (f) `VisibilityTimeout`, `ApproximateNumberOfMessages`, `QueueArn`, `CreatedTimestamp` and
  `LastModifiedTimestamp` are all present on `GetQueueAttributes(All)` against LocalStack.

**AWS-2 (credentials) — PASS, confirming P58d D7's timing change exactly.** A nonexistent
`SharedConfigProfile` fails **at `config.LoadDefaultConfig`**, both with no config file present at
all and with a config file present naming a different profile — in both cases the error is a bare
(unwrapped) `config.SharedConfigProfileNotExistError` with message `failed to get shared config
profile, does-not-exist`. A present profile resolves region and credentials correctly. Static
credentials never touch the filesystem and a wrong static key produces nothing from
`LoadDefaultConfig` — the first place it could surface is a real request, confirming §5.7's "no
`E_AUTH` round trip" gap is a real gap in test coverage, not a missing behavior.

**AWS-3 (S3) — PASS, with one new finding not in the plan's own research.**
- (a) `PutObject` with an `*os.File` body and explicit `ContentLength`, under the SDK's **default**
  `RequestChecksumCalculation`, succeeded outright. **P58d D6** needs no override.
- (b) A non-seekable `io.Reader` body failed immediately, client-side, before any request left the
  process: `compute input header checksum failed, unseekable stream is not supported without TLS
  and trailing checksum`. This is a harder cliff than "LocalStack might reject it" — the SDK itself
  refuses a non-seekable body over plain HTTP (LocalStack's endpoint is HTTP, not HTTPS) regardless
  of what the server would have done. It changes nothing about **P58d D6** (the design already
  always hands the SDK a seekable `*os.File`) but sharpens the reason: it is not a LocalStack quirk
  to work around, it is the SDK's own contract for an unencrypted connection.
- (c) `HeadObject`/`GetObject` on a missing key: `*types.NotFound` (HEAD) and `*types.NoSuchKey`
  (GET), both `*smithy.OperationError`-wrapped, both structurally `errors.As`-matchable — confirming
  **P58d D14**'s collision-check design matches on the right type.
- **(d) — a genuine new finding, not anticipated by the plan's research: S3 metadata keys come back
  lowercased.** A `Metadata: {"SeededBy": "aws3-probe"}` sent on `PutObject` reads back from
  `HeadObject` as `map[string]string{"seededby": "aws3-probe"}` — LocalStack (and real S3, per
  AWS's own documented behavior for `x-amz-meta-*` headers) lowercases metadata keys in transit.
  Neither `s3/mutate.ts` nor this plan's **P58d D13** mentions this, and it does not change the
  design (metadata is preserved as a whole map either way), but it means a Go test asserting an
  exact metadata key must assert the lowercased form, and it is worth one line in
  `docs/ARCHITECTURE.md`'s S3 section so a future reader does not "fix" what looks like a casing bug.
  `StorageClass` came back **empty**, not `"STANDARD"`, on LocalStack — confirming **P58d D16**'s
  relative-assertion design (`oversized == small - 1`) was the right call regardless of which way
  this resolved. All six other preserved attributes (`ContentType`, `CacheControl`,
  `ContentEncoding`, `ContentDisposition`, `ContentLanguage`, plus `Metadata`) round-tripped exactly.
- (e) A 5 MB `GetObject`, cancelled after the first 100 KB was read from the body stream: the next
  read after `cancel()` returned in 86 µs with `errors.Is(err, context.Canceled) == true`. The
  mid-stream cancellation §4.4's `DownloadObject` design and §5.4's new mid-stream test both depend
  on is real and prompt — **P58d D3** holds for `GetObject`'s streaming body exactly as it holds for
  `ReceiveMessage`'s long-poll.
- (f) `ListObjectsV2` with `Delimiter: "/"` over `reports/`, `reports/2024/summary.json`,
  `reports/notes.txt` and an exact-prefix marker object at key `reports/` itself: `CommonPrefixes`
  correctly groups everything under `reports/2024/` into one prefix, while `Contents` returns both
  `reports/` (the exact-prefix marker) and `reports/notes.txt` — confirming `catalog.ts`'s need to
  skip the exact-prefix marker explicitly (§4.3's `catalog.go` row) rather than assuming
  `ListObjectsV2` already excludes it.
- (g) All seven of **P58d D13**'s preserved attributes survive a `PutObject`/`HeadObject` round
  trip (folded into (d) above).

**AWS-4 (cross-check) — done by direct source comparison rather than a live dual-container run, and
one real gap found in this plan's own §4.6.** Reading `tests/db/fixtures/0006_sqs_seed.ts` and
`0007_s3_seed.ts` directly (the ground truth a live run would only reproduce) against §4.6's Go
seeder checklist:
- The SQS shapes match exactly: `orders-queue` (5 messages, `{"seq":<i>}` bodies, one `source`
  String attribute each), `drain-queue` (7 identical-shaped messages), `empty-queue` (created,
  empty). No correction needed.
- **The S3 checklist in §4.6 is missing one seeded object**: `0007_s3_seed.ts` also seeds
  `SECOND_DELETE_TARGET_KEY = 'second-delete-target.txt'` into `mutable-bucket` (body *"a second
  object, deleted from an open tab instead of the tree"*), needed because the TypeScript's delete
  scenario removes one object from a tree row and a different one from an open tab in the same test.
  §4.6's table lists `editable.json`, `readonly-target.txt` and `delete-target.txt` for
  `mutable-bucket` but not this fourth object. `testsupport/s3.go` must seed it too, as
  `S3SecondDeleteTargetKey`, or the tab-based delete scenario (S3 test suite scenario mirroring
  `s3.spec.ts`'s tab-delete case) has no second object to target. Recorded here rather than
  discovered mid-M8.3.
- The `headers`/`attrs` cell comparison was settled by AWS-1(c) together with a direct read of
  `src/engine/adapters/sqs/read.ts`'s `pushMessage` (verbatim above) rather than by running the
  bun test harness a second time — the source read is the same ground truth a live diff would
  produce, and it is unambiguous: `JSON.stringify(message.MessageAttributes ?? {})` in JS is
  reproduced by **P58d D8**'s hand encoder emitting only non-nil/non-empty fields, and `attrs`'
  `json.Marshal(map[string]string)` already matches `JSON.stringify` of the same map with no encoder
  needed.

**Consequences for M8.1 onward:** none of the five probes forced a design change to §2's decisions.
**P58d D3** and **P58d D6** are both confirmed as written. The two corrections are: TC-4's startup-
time claim (§6's table wording, harmless — the container still starts, the claimed saving just
isn't visible here) and §4.6's missing `SECOND_DELETE_TARGET_KEY` (real — M8.3's `testsupport/s3.go`
must seed it). AWS-3(d)'s lowercased-metadata-keys finding is new information for
`docs/ARCHITECTURE.md`'s S3 section (§8 criterion 8) and for any Go test asserting an exact metadata
key.
