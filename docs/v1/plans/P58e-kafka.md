# P58e — Kafka, native (M9)

> **Parent:** `docs/v1/plans/P58-go-native-adapters.md`. That document's §0.3 splits P58 into six
> sub-phases and assigns **P58e** the single milestone **M9 — Kafka, on franz-go (D7), against M0's
> already-proven probe. Ends with `nativeKinds` complete — all ten — and `tests/db/kafka.spec.ts`
> deleted, along with `scripts/run-db-tests.sh`'s whole reason for existing.** Its sub-phase table's
> own justification for isolating Kafka: *"Alone, deliberately. It is the only adapter whose driver
> choice is a genuine decision (D7), the only one with a non-trivial consumer model, and the one
> carrying the still-open native-module packaging gap. Isolating it late means it can take a second
> pass without blocking the four sub-phases that do not depend on it — and it must land before P58f,
> because the cutover cannot happen while any kind is still Node-served."* §1.1 checks all three
> clauses against the tree and finds the first **already settled by P58a's own M0** (which changes
> this plan's §6 shape more than anything else), the second exactly right, and the third
> **understated** — being last is not merely a scheduling property, it is what makes P58e the
> sub-phase that must retire two placeholders, rewrite a coexistence proof, and record **checkpoint
> C2**.
>
> **Predecessors:** `P58a-substrate-postgres.md` (M0–M5), `P58b-mysql-sqlite-clickhouse.md`
> (M6.0–M6.4), `P58c-mongo-redis.md` (M7.0–M7.4) and `P58d-sqs-s3.md` (M8.0–M8.3), all complete;
> each records real results in its own §12/§13. **Nine of ten kinds are Go-native at `1065518`**
> (P58d's own closeout commit): `postgres`, `mariadb`, `mysql`, `sqlite`, `clickhouse`, `mongodb`,
> `redis`, `sqs`, `s3`. RabbitMQ was dropped from v1's scope before P58c was written (the parent
> plan's amendment note) — ten kinds, not eleven. **P58e writes no substrate**: `internal/page`,
> `internal/enginecache` and `internal/enginebackend` are untouched, and `internal/adapterhost` is
> touched at exactly three places, all of which §1.9 enumerates and two of which exist only because
> Kafka is *last*.
>
> **What this document may not relitigate.** The parent's decisions (**P58 D1–D20**), its research
> (§1), its target tree (§3), its designs (§4), its testing plan (§5) and its sequencing (§9) are
> settled, as are **P58a A1–A21**, **P58b B1–B24**, **P58c C1–C25** and **P58d D1–D24** for
> everything already built. Where this plan deviates from a parent *design* it says so in the open
> with the reason (§2's **P58e E9**, **P58e E20** and **P58e E22** are the three that matter); where
> the tree contradicts a predecessor plan's own closeout claim, §1 records the tree (§1.12 does
> exactly that, twice).
>
> **Decision numbering.** P58a used `A<n>`, P58b `B<n>`, P58c `C<n>`, P58d `D<n>` — a letter per
> sub-phase. P58e's letter is **E**, which collides with nothing, but P58d's own preamble established
> a discipline worth keeping verbatim rather than relaxing because this sub-phase happens to be lucky:
>
> - **A bare `E<n>` never appears in this document**, and neither does a bare `D<n>`. Not once, not in
>   a table cell, not in a parenthetical.
> - This plan's own decisions are always **P58e E\<n\>** — including their own section headers in §2.
> - A parent decision is always **P58 D\<n\>**; P58a's are **P58a A\<n\>**; P58b's **P58b B\<n\>**;
>   P58c's **P58c C\<n\>**; P58d's **P58d D\<n\>**.
> - A checkpoint is always written with the word "checkpoint" immediately before it
>   (**checkpoint C2**). P58e declares no *new* checkpoint and **runs the one the parent already
>   declared** (§7).
>
> Every claim below was read out of the tree as it stands at `1065518` with `git grep`, `wc -l` and
> the actual files. Every Go driver claim is marked **researched**, and — as in P58d — "researched"
> means the module's own source was read: `github.com/twmb/franz-go@v1.21.6`,
> `franz-go/pkg/kadm@v1.18.0`, `franz-go/pkg/kmsg@v1.13.1` and
> `testcontainers-go/modules/kafka@v0.44.0`, all four of which are **already present in this box's
> own module cache** (§1.13) even though `shell/go.sum` has zero franz-go entries. Exact files and
> line numbers are cited where a claim rests on them. Anything that needs a *running* broker to
> settle is **must be proven in M9.0** and appears in §6, never as a settled fact.

## 0. What this sub-phase is, and what it is not

### 0.1 The five bodies of work

1. **M9.0 — three probes, not five.** §6 argues this from first principles rather than copying
   P58d's shape. **P58a's own M0 already ran a full Kafka probe (KF-1) and it passed outright**,
   including both capabilities **P58 D7** hoped to recover — so the two questions that would have
   dominated an M9.0 written in ignorance (*can franz-go browse at explicit offsets without creating
   group state?* and *does `kadm` really expose `DescribeTopicConfigs`/cluster id?*) are already
   answered, in writing, in `P58a-substrate-postgres.md` §12. What KF-1 did **not** ask is what
   M9.0 asks: cancellation semantics (**KF-2**), end-of-log detection for the
   transaction-commit-marker gap (**KF-3**), and a container/input inventory (**KF-4**).
2. **M9.1 — the fixture and the failing suite.** `testsupport/kafka.go` (the container starter plus
   a Go re-expression of `tests/db/fixtures/0005_kafka_seed.ts`) and
   `shell/internal/adapters/kafka/kafka_test.go`, landing **red** per **P58 D12** / its **R3**.
   **`nativeKinds` does not change in M9.1**, so the whole existing suite must stay green through it.
   The five `StreamPage` readers this suite needs already exist — P58d M8.1 built them
   (`testsupport/spec.go:121-151`), and P58e is the first sub-phase in the whole phase whose test
   tier needs **no** testsupport lift at all.
3. **M9.2 — the adapter.** One `kafka` package, eight Go files, one per `src/engine/adapters/kafka/*.ts`
   (**P58e E17**), on `franz-go` + `kadm`. No shared helper package — §1.2 measures why there is
   nothing to share.
4. **M9.3 — the flip, and the two placeholders that finally move.** `nativeKinds += kafka` reaching
   **ten of ten**; `shell/main.go`'s tenth blank import; the retirement of
   `adapterhost.TestKindNodeServed` (**P58e E20**), which after this flip points at a kind that *is*
   native and so becomes an actively wrong constant in four test files; and the rewrite of
   `tests/e2e-real/mariadb-real.spec.ts`'s second test (**P58e E21**), whose entire premise —
   "Kafka is Node-served" — stops being true in the same commit.
5. **M9.4 — checkpoint C2, the deletions, the docs.** The parent's own **checkpoint C2** (its §0.3,
   its §8 criterion 2, its **R1**) is *"the zero-traffic proof … before M10 (the deletion milestone)
   starts"*. M10 is P58f's first milestone and M9 is the last milestone before it, so **P58e is the
   sub-phase that owes checkpoint C2** — and §7 shows the instrument it names does not exist in the
   tree and has to be built here.

### 0.2 Not in this sub-phase

- **No substrate change.** Not one line under `internal/page`, `internal/enginecache`,
  `internal/enginebackend`, or `internal/adapters`' own shared files (`adapter.go`, `caps.go`,
  `errors.go`, `registry.go`, `live.go`, `abort.go`, `sqltext.go`, `sqlmutate.go`). §1.4 is the
  evidence: every hook Kafka needs already exists, including `page.NewStreamPageBuilder` (first
  called by SQS in P58d M8.2), `PaginationOffsetWindow` (`caps.go:14` — declared in P58a M1, **never
  yet emitted by a native adapter**), and `EncodePageToken`/`DecodePageToken`/`RequestFingerprint`
  (`sqltext.go:61/73/93`, which P58d was the first sub-phase *not* to use and P58e uses again).
- **No `src/` change at all.** Not one file, not one line — the same strong form **P58b B21**,
  **P58c C22** and **P58d D21** asserted and met (**P58e E23**).
- **No `tests/ui/` change and no `tests/ipc/` change.** **P58a A10** still holds.
  `tests/ipc/kafka/`'s backend half keeps driving the TypeScript Kafka adapter and keeps passing;
  §1.11 records what that costs and why bringing **P58 D13**'s generator port forward for the last
  adapter would be worse than doing all seven at once in P58f.
- **No deletion of `src/engine/`, `internal/enginehost/`, the vendored Node, or the engine bundle.**
  The parent's **M10** owns every one of those and **R1** forbids starting M10 before checkpoint C2
  is recorded — which is P58e's own last milestone. **After P58e the Node engine child still spawns,
  still runs, and serves exactly zero kinds.** That is not an oversight; it is the state checkpoint
  C2 exists to certify (§7).
- **No deletion of `router.go`'s `*ViaChild` half.** Six methods plus `forwardToChild` become
  unreachable-in-practice on M9.3 and stay in the tree until P58f collapses the two `EngineBackend`
  implementations into one (parent M10). Deleting them here would break `internal/connections`' and
  `internal/tree`'s own tests, which is exactly what **P58e E20** exists to keep working.
- **No packaging-script logic change.** `scripts/verify-packaging.sh`'s A2/A4 Kafka blocks and
  `scripts/sign-bundle.sh`'s `KAFKA_NATIVE` block are P58f's to delete (the parent's §3 target tree
  says so in its own `sign-bundle.sh` row: *"Kafka note deleted"*). P58e changes only the two
  **message strings** that become factually false on M9.3, and **P58e E22** is that decision.
- **`shell/go.mod` gains exactly three runtime modules and one test-only module** (**P58e E1**,
  **P58e E19**) — the first sub-phase since P58a to add a test-only testcontainers module, which is a
  reversal of **P58d D22**'s precedent taken deliberately and with its reason written down.

### 0.3 The two things in P58e that are hard to walk back

Everything M9.1–M9.2 adds is additive Go: one new package, one test fixture, one acceptance suite,
one unit test.

**Flipping the last `nativeKinds` bit is not additive, and it is qualitatively different from the
nine before it.** P58b §0.3, P58c §0.3, P58d §0.3 each said why a flip is hard to walk back. What is
new here — and what **P58d D19**'s "each kind flips in its own commit" rule cannot help with — is
that this flip **removes a property from the app rather than adding one**:

1. **There is no longer any kind whose behaviour differs when the Node child dies.** `MarkAllErrored`
   (`connections/service.go:529-548`) skips every connection whose kind `IsNativeKind` reports true;
   after M9.3 that is every kind, so the function's body runs to completion and emits nothing.
   `tests/e2e-real/mariadb-real.spec.ts`'s second test asserts the opposite
   (`expect(kafkaStatusDot).toHaveAttribute('data-status', 'error')`, line 235) and **will fail** —
   not flake, fail — in the same commit. §1.10 traces this precisely and **P58e E21** is the
   response.
2. **`adapterhost.TestKindNodeServed` becomes a lie in four test files.** Its own doc comment
   (`router.go:21-29`) already predicted this: *"Kafka (P58c C14): the last of the ten kinds to go
   native (P58e), so this is the final move before P58f retires the constant entirely."* §1.9 shows
   that "retires the constant" is not free, because one of its four consumers cannot use a synthetic
   kind: `connections/service_test.go`'s `fieldsInput` goes through `connections.Service.Create` →
   `input.go:31`'s `model.ValidConnectionKind`, which rejects anything outside
   `model/connection.go:47`'s closed ten-kind set.

The structural answers are the three that always apply plus one that is new:

1. **The kind flips in its own commit**, at the end of its own milestone (**P58e E18**) — and here
   that commit necessarily also carries the constant retirement and the e2e rewrite, because leaving
   either for a later commit means shipping a red tree.
2. **The Go acceptance spec lands and fails before the adapter** (**P58 D12** / its **R3**).
3. **The full `tests/e2e-real/` sweep runs after the flip** (`AGENTS.md`'s P58b M6.4 finding).
4. **New:** checkpoint C2 is recorded *after* the flip and *before* anything in P58f
   (parent **R1**), and §7 designs the instrument it needs.

## 1. What re-reading the tree found

### 1.1 The parent's isolation justification, checked — one clause already discharged, one understated

**"The only adapter whose driver choice is a genuine decision (D7)."** True when the parent was
written; **discharged before this plan was.** `docs/v1/plans/P58a-substrate-postgres.md` §10 OQ-5
asked whether the Kafka probe should run inside P58a's own M0 and **resolved yes** (*"Accepted as
recommended: the Kafka probe (KF-1) runs inside P58a's own M0"*, §1523), on the explicit grounds
that *"discovering that in P58e rather than now would mean [taking D7's cgo fallback] late"*. §12 of
that document records the result verbatim:

> **KF-1 — PASS in full, including both capabilities P32 D13/D14 recorded as lost.** franz-go's
> `kgo.ConsumePartitions` at explicit start offsets consumed all 10 produced records across both
> partitions with `kadm.ListGroups` reporting **zero** groups afterward (no `kira-studio-browse` ever
> created) — the no-group claim §1.7 makes is not just true of the current adapter's design, it is
> what franz-go's own client does by construction when you never call `Subscribe`. Each partition's
> `FetchTopicPartition.HighWatermark` matched `kadm.ListEndOffsets`'s own value exactly.
> `kadm.DescribeTopicConfigs` and `kadm.Metadata` (giving the cluster id) both succeeded […]
> **D7 needs no fallback; the primary recommendation is fully validated.**

So **P58e E1** confirms **P58 D7** without amendment and without a fallback branch, and §6 is
correspondingly small. This is the opposite starting position from P58d's, whose M8.0 needed five
probes from scratch, and the plan should say so rather than performing the same ceremony.

**"The only one with a non-trivial consumer model."** Exactly right, and §1.5/§1.6 are that finding.
It is the only adapter in the app with a *stateful, resumable, multi-cursor* read: a page's position
is a set of per-partition `[next, end)` windows carried in a page token, one window per partition,
frozen at browse start and advanced only by records the adapter actually delivered. Nine other
adapters have either one cursor or none.

**"The one carrying the still-open native-module packaging gap."** §1.14 locates the gap precisely
(two shell scripts, four blocks, exact lines) and finds that the parent's own quotation of it —
*"`AGENTS.md`'s still-open finding that no build step in this repository vendors
`@confluentinc/kafka-javascript`'s native module"* — **no longer appears in `AGENTS.md` at all**
(`grep -n "vendors\|require() time\|packaged build" AGENTS.md` returns nothing); it was trimmed in
`385167c` (*"docs: trim AGENTS.md verbosity, move app facts to ARCHITECTURE.md"*). The gap itself is
still live, in `scripts/verify-packaging.sh` and `scripts/sign-bundle.sh`.

**What the justification understates.** "Isolating it late" is presented as a scheduling convenience
(*"it can take a second pass without blocking the four sub-phases that do not depend on it"*). Being
**last** is a structural property with four consequences the parent's table does not name, and three
of them are work:

| Consequence of being last | Where it lands |
|---|---|
| `TestKindNodeServed` has nothing left to point at | §1.9, **P58e E20** — 4 test files, one of which cannot use a synthetic kind |
| `mariadb-real.spec.ts`'s coexistence half loses its subject and **fails** | §1.10, **P58e E21** |
| **Checkpoint C2** becomes possible for the first time, and is owed before P58f starts | §7, **P58e E24** |
| `MarkAllErrored`'s Node-served narrowing (**P58a A15**) becomes a no-op for every connection | §1.9 |

`AGENTS.md`'s own P58d findings entry called this out in advance and this plan is the collection of
that debt: *"P58e (Kafka's own sub-phase) should expect the opposite: both placeholders point at
Kafka, and it inherits the cost this phase never had to pay."*

### 1.2 The adapter, measured — and why there is no shared package to write

`wc -l src/engine/adapters/kafka/*` for this plan. **8 files, 1 150 lines**, matching the parent's
§1 table exactly (*"`adapters/kafka/` | 1 150 | 8 | assign-at-offset browse, never joins a group"*).

| File | Lines | What it is |
|---|---:|---|
| `read.ts` | **337** | `freshWindows` + `readTopic`'s bounded poll loop + `countTopic` |
| `definition.ts` | **195** | topic definition (partitions + an empty Configuration section) and group definition |
| `index.ts` | 164 | the `Adapter` impl |
| `produce.ts` | 144 | `$key`/`$body`/`$headers` sentinels, preview, the produce path |
| `client.ts` | 108 | one librdkafka property map, one long-lived compat Admin |
| `catalog.ts` | 92 | root = topics ∪ consumer groups; partitions one level down |
| `errors.ts` | 74 | librdkafka numeric-code classification |
| `caps.ts` | 36 | the 21-field literal |
| **total** | **1 150** | |

**There is no `awscfg`-shaped shared half to extract, and no `mysqlfamily`-shaped core.** P58d's
§1.1 found 98 shared lines out of 1 586 across two adapters and sized a package to it (**P58d D2**).
P58e has **one** adapter; the only cross-adapter surface it touches is
`internal/adapters/{errors,caps,sqltext}.go`, which already exist. **P58e E2** records this as a
decision rather than an omission, because a reader arriving from P58d will look for the shared
package and there is none to find.

**Expected Go size.** The calibrations this repo now has: Postgres ran 1.26× the TypeScript; P58b's
three and P58c's two ran roughly 1.0×; P58d's SQS ran 1.27× (671 → 849) and S3 ran 1.06× (915 →
974). Applying it naively gives ~1 220–1 450. Two adjustments in known directions, both sized:

- **~90 lines vanish outright** and must not be ported. `read.ts`'s six callback-to-Promise wrappers
  and its int64 guard: `connectConsumer` (8), `disconnectConsumer` (5), `consumeBatch` (8),
  `toNativeOffset` (16 incl. its comment); `produce.ts`'s `connectProducer` (8), `flushProducer` (8),
  `disconnectProducer` (5); `definition.ts`'s `reverseLookup`/`groupStateName`/`groupTypeName` (16)
  plus their 12-line P32 D15 comment. franz-go is context-native and synchronous where it matters,
  its `DescribedGroup.State` is **already a string** (§1.7), and Go's `int64` makes the safe-integer
  guard meaningless (**P58e E6**).
- **~60 lines appear** that have no TypeScript counterpart: the Configuration section now has real
  content (**P58e E11**), the end-of-log clamp needs explicit per-partition high-watermark
  bookkeeping where librdkafka gave an event (**P58e E9**), and three cells need
  `strings.ToValidUTF8` where Node's `Buffer.toString('utf8')` was doing it invisibly
  (**P58e E8**).

Net estimate: **~1 250 lines of Go plus ~750 of Go test plus ~180 of `testsupport/kafka.go`**.

### 1.3 What KF-1 proved, and the three things it did not ask

This is the section §6 rests on, so it is written as a ledger rather than prose.

| Claim | Settled by | Status |
|---|---|---|
| `kgo.ConsumePartitions` at explicit start offsets consumes the right records across two partitions | KF-1 | **PASS**, recorded |
| A browse creates **no** consumer group (`kadm.ListGroups` reports zero afterwards), by construction, because `Subscribe` is never called | KF-1 | **PASS**, and KF-1 strengthened the claim from "this adapter's design" to "franz-go's own behaviour" |
| `FetchPartition.HighWatermark` matches `kadm.ListEndOffsets` per partition | KF-1 | **PASS** |
| `kadm.DescribeTopicConfigs` works (recovers P32 D14's loss) | KF-1 | **PASS** |
| `kadm.Metadata` gives a cluster id (recovers P32 D13's loss) | KF-1 | **PASS** |
| Produce with a key and headers | KF-1 implicitly — *"consumed all 10 produced records"* means a produce happened; the record shape is not stated | **partly**; folded into KF-4 |
| `kadm.ListGroups`/`DescribeGroups` field inventory against a real seeded group | — | **not asked** → KF-4 |
| **Does a cancelled `context.Context` abort an in-flight fetch or admin call promptly, and how does the error present?** | — | **not asked** → **KF-2**, the load-bearing probe |
| **Does franz-go report end-of-log for a partition whose remaining offset is a transaction commit marker?** (P43 iter2 F19/D26's whole subject) | — | **not asked** → **KF-3** |
| `ListOffsetsAfterMilli`'s answer for a partition with no record at or after the timestamp | — | **not asked** → KF-4 |
| Does `testcontainers-go/modules/kafka@v0.44.0` start `confluentinc/cp-kafka:8.0.7` **here**? | — | **not asked**; KF-1's own container mechanism is not recorded in P58a §12 → KF-4, and §10 OQ-8 |
| Idempotent-producer default and its `InitProducerId` round trip | — | **not asked**, and §1.8 shows it is a real behaviour change → KF-4 |

Three probes, each answering something KF-1 explicitly did not ask. **Reflexively running P58d's
five-probe shape would mean re-proving D7 for a third time** (once in the parent's own research, once
in KF-1) and would leave KF-2 and KF-3 — the two things that can actually be wrong — no better
covered.

### 1.4 What the substrate already gives P58e for free — and there are no gaps

Read out of `shell/internal/`, not inferred. **P58e is the first sub-phase in P58 that needs no
testsupport lift and no substrate addition of any kind.**

| Needed by P58e | Where it already is | Notes |
|---|---|---|
| `Adapter`, `Caps`, `Deps`, `OpCtx`, `ConnectInfo`, `ReadRequest`/`CountRequest`/`CountResult`, `TreeChildren` | `internal/adapters/adapter.go` (200 lines), `caps.go` | Implemented verbatim |
| `Caps.Pagination = PaginationOffsetWindow` | `internal/adapters/caps.go:14` | Declared in P58a M1 and **never emitted by a native adapter**. Kafka is the first and only |
| `page.NewStreamPageBuilder(visibilityTimeoutSeconds *int)`, `page.StreamRow{Key *string; Headers string; Attrs string; Timestamp *string; Body string}`, `StreamPage`'s `MarshalJSON` with `"kind":"stream"` | `internal/page/builder.go:309-390` | SQS was the first Go producer (P58d M8.2); **Kafka is the second**, and the only one that passes `visibilityTimeoutSeconds: nil` |
| `EncodePageToken(key []string, fingerprint string)`, `DecodePageToken`, `RequestFingerprint(parts any)` | `internal/adapters/sqltext.go:61, 73, 93` | P58d was the first sub-phase to use **none** of these; P58e uses all three. `RequestFingerprint` is sha1→hex→16 chars and its doc already says *"Deterministic within a process is all that is required — a token is only ever decoded by the process that minted it"* — which **P58e E7** leans on |
| The eight error codes, `Error`, `New`, `CodeOf`, `Unsupported`, `NoQueryConsole`, `AssertWritable`, `CheckNotStarted`, `CheckCancelled`, `RequireConnected` | `internal/adapters/errors.go:15-96` | `errors.ts`'s port maps onto this closed set |
| `Register(kind, ctor)` from the package's own `init()` | `internal/adapters/registry.go` | **No edit to `registry.go`.** `shell/main.go` gains its tenth blank import (§4.7's most-forgotten step) |
| `testsupport.StreamKeyAt`/`StreamHeadersAt`/`StreamAttrsAt`/`StreamTimestampAt`/`StreamBodyAt` | `internal/adapters/testsupport/spec.go:121, 128, 134, 140, 146` | **Built by P58d M8.1** for SQS, on the shared `chunkCellAt` (`spec.go:56`). Kafka's suite is their second consumer and needs no new reader. This is P58c C16's gap-3 argument paying out a second time |
| `testsupport.IsDockerAvailable`, `DockerUnavailableMessage`, `fixture[T]`'s memo (`fixture.go:13-52`) + the `TestMain`-not-`t.Cleanup` rule (**P58b B15**), `Seg`/`NodePath`/`ChildNames`/`ContainsName`/`Strp` | `testsupport/fixture.go`, `spec.go` | One new fixture plugs straight into `fixture[T]` |
| `Router.childrenNative`'s nil-`Nodes` normalization (**P58c C16**) | `adapterhost/router.go:266-268` | Kafka returns `[]model.TreeNode{}` at three separate leaf shapes; the router guarantees `"nodes":[]` regardless |
| `model.ValidateObjectDefinition`'s nil→`[]` normalization on the native path | `adapterhost/router.go:363` | Kafka's `ObjectDefinition` has `constraints: []` and a `notes` slice that is now sometimes empty (**P58e E11**) — this is exactly the P58b closeout bug that guard exists for |
| The renderer's dual chunk decoder | `src/renderer/bridge/port.ts`'s `toTypedArray` | Both branches verified present — this is why P58e touches no `src/` file (**P58e E23**) |

**Explicitly not used:** all eighteen of `sqltext.go`'s functions except the three token/fingerprint
ones; all nine of `sqlmutate.go`'s; `adapters.RunWithAbortRace` (**P58e E3**); `page`'s tabular,
document and key/value builders; `page.ObjectBodyPreviewBytes` and friends. Kafka renders no SQL,
has no primary key, has no `describe`, has no console, has no update or delete, and has no file
transfer — **it is the adapter that exercises the fewest `Adapter` methods**, exactly as the parent's
§9 says (*"Postgres exercises every method; Kafka exercises the fewest"*).

### 1.5 The consumer model, read out of `read.ts` line by line

This is the "non-trivial consumer model" the parent names, and it is four interacting mechanisms, not
one. Everything below is `src/engine/adapters/kafka/read.ts` as it stands.

**1. The window.** `PartitionWindow {partition: number; next: string; end: string}` (`:11-15`), with
`end` explicitly documented as *"frozen high watermark for this browse (never re-fetched mid-browse,
D7)"*. `freshWindows` (`:76-143`) builds one per selected partition from
`admin.fetchTopicOffsets(topic)` (low/high per partition), applies the stream filter, and returns
`{partition, next: start, end: high}`.

**2. The filter, applied only to a fresh browse.** `read.ts:70-75`'s own comment: *"only ever
consulted for a fresh browse (a token-continued page's windows were already resolved once … and
re-applying the filter there would just be wrong once the user has paged partway through)."* Three
knobs (`src/shared/domain/streamFilter.ts`, 45 lines): `partitions[]` narrows (union, not
intersection; empty selection is `E_QUERY` with `topic X has no partition(s) 3, 4`), `timestampMs`
**wins over** `offset` and reseeds via `fetchTopicOffsetsByTimestamp`, and `offset` is a decimal
string clamped into each partition's own `[low, high]` (`:130-135`).

**3. The browse itself.** `readTopic` (`:193-319`):
- a `before` cursor is `E_UNSUPPORTED` — *"kafka offset-window pagination is forward-only; there is
  no previous page"* (`:199-204`);
- `fingerprint = requestFingerprint({topic, pageSize, filter})` (`:205`) — note the fingerprint
  covers only those three, deliberately;
- `remaining = windows.filter(w => next < end)`; if empty, a terminal empty page is returned
  **without ever constructing a consumer** (`:211-215`);
- a `KafkaConsumer` is constructed with `group.id: 'kira-studio-browse'`, `enable.auto.commit:
  false`, `enable.auto.offset.store: false`, `enable.partition.eof: true`,
  `auto.offset.reset: 'error'`, then **`assign()`s** exactly the remaining partitions at their start
  offsets (`:249-254`). `read.ts:186-192`'s comment is the promise: *"No JoinGroup, no SyncGroup, no
  Heartbeat, no LeaveGroup, no OffsetCommit, no OffsetFetch."*
- the loop runs `while (collected < pageSize && !allDone() && !allEof())`, with `MAX_EMPTY_POLLS = 2`
  consecutive empty polls as the escape hatch and `POLL_TIMEOUT_MS = 1000` per poll;
- every delivered message is **re-checked against its own window** (`offset < w.next || offset >=
  w.end → continue`, `:280`) before being pushed, and only then does `w.next = offset + 1n`.

**4. The EOF clamp — the one piece with a real bug in its history.** `:299-308`, P43 iter2 F19/D26:

> a partition's own `end` was frozen from its high watermark at browse start, and `partition.eof`
> from librdkafka means the consumer's position *reached* that watermark — proof, not a heuristic,
> that nothing between `next` and `end` will ever be delivered (a transaction marker, a compacted
> offset, an offset aged out by retention). Left unclamped, `hasMore` stayed true forever and every
> later browse re-hit EOF immediately for zero rows. `emptyPolls` is deliberately not clamped the
> same way: an empty poll with no EOF is indistinguishable from a slow broker, and there genuinely
> may be more.

**franz-go has no `partition.eof` event.** It has something the parent's **P58 D7** already argued is
*stronger* — `FetchPartition.HighWatermark` on every fetch response
(`kgo/record_and_fetch.go`'s `FetchPartition`, fields `Partition`, `Err`, `HighWatermark`,
`LastStableOffset`, `LogStartOffset`, `Records`) — but "stronger in principle" is not "the same
signal", and **the exact question the clamp turns on is whether franz-go returns a `FetchPartition`
entry at all for a partition whose only remaining offset is a commit marker.** That is **KF-3**, and
it is the one probe whose failure would change a design rather than a constant.

### 1.6 Cancellation: franz-go's shape is a third one, different from both P58d's and P58c's

A reader arriving from P58d will reach for "pass the op's ctx straight through, never
`RunWithAbortRace`" and be **right about the conclusion and wrong about one API detail**, which is
worth stating in that order.

**The conclusion is the same as P58d D3's, for the same reason.** `index.ts:134-136`'s
`cancel()` is `return false` permanently, and `:125-128`'s comment says why: *"`ctx.signal.
addEventListener('abort', () => consumer.disconnect())` inside read() is the sole cancel mechanism,
mirroring P9's D7/D8 — this stays a permanent no-op."* `caps.ts:34` is nonetheless `cancel: true`,
honestly, for the same reason **P58c C9** found Redis's honest and **P58d D18** found SQS's and S3's
honest. **There is no server-side kill.** Kafka's protocol has none: a fetch is a request the broker
answers or times out; there is no `pg_cancel_backend`, no `KILL QUERY`, no `killOp`. So there is
nothing for a driver abort to race, and `RunWithAbortRace` (`abort.go`, whose 20-line doc comment
spells out that it exists *"to stop a context-native driver from racing — and beating — an adapter's
authoritative server-side kill"*) would buy nothing and cost two real things: a browse client left
fetching after the caller unblocked, and a `Close()` deferred onto a detached goroutine.

**The API detail P58d's shape does not prepare a reader for.** For the admin half this is ordinary:
every `kadm.Client` method takes `ctx` and returns `(T, error)`, so a cancelled ctx produces a
returned error the mapper sees. For the **fetch** half it is not. `kgo.Client.PollRecords`
(`kgo/consumer.go:495`) returns a `Fetches`, **not** an error, and its own doc (`:474-488`) says:

> If the client is closed, a fake fetch will be injected that has no topic, a partition of -1, and a
> partition error of `ErrClientClosed`. **If the context is canceled, a fake fetch will be injected
> with `ctx.Err`.** These injected errors can be used to break out of a poll loop.

So a cancelled browse surfaces as `fetches.Err0()` / `fetches.Err()` returning `context.Canceled`,
**not** as a returned error, and a literal port that inspects only `fetches.Errors()` for Kafka
errors and then loops would keep calling `PollRecords` against a dead context. **P58e E3** makes the
explicit `fetches.Err()` check part of the loop contract, and KF-2(a) confirms both the shape and the
*promptness* — the second half being the thing no source read can settle, exactly as **P58d D3**'s
own premise needed AWS-1(e) rather than a read of the SDK.

**A cancellation-model table across the whole phase**, since P58e is the last entry and this is
where it becomes complete:

| Adapter | Server-side kill | Driver ctx | Helper |
|---|---|---|---|
| postgres | `pg_cancel_backend` on a side connection | detached | `RunWithAbortRace` |
| mariadb / mysql | `KILL QUERY <threadId>` on a side connection | detached | `RunWithAbortRace` |
| clickhouse | `KILL QUERY … SYNC` on a second HTTP request | detached | `RunWithAbortRace` |
| sqlite | `sqlite3_interrupt` via an adapter-owned per-op ctx | **inverted** (**P58b B8**) | `RunWithAbortRace` |
| mongodb | `$currentOp` + `killOp` on the **same** client | detached | `RunWithAbortRace` |
| redis | none; `CheckCancelled` between bounded SCAN rounds | detached (**P58c C9**) | `RunWithAbortRace` |
| sqs / s3 | **none at all** | **the op's own** (**P58d D3**) | none |
| **kafka** | **none at all** | **the op's own** (**P58e E3**) | **none**, plus an explicit `fetches.Err()` check the other two do not need |

### 1.7 franz-go's own facts that decide the port's shape

All **researched** — read out of the module cache at
`$(go env GOPATH)/pkg/mod/github.com/twmb/franz-go@v1.21.6/` and
`.../franz-go/pkg/kadm@v1.18.0/`. Anything needing a running broker is deferred to §6 and marked.

| Fact | Source | Why it matters here |
|---|---|---|
| **`kgo.ConsumePartitions(map[string]map[int32]Offset)` is a client-construction `ConsumerOpt`**, and its doc says *"a way to explicitly consume from subsets of partitions in topics, or to consume at exact offsets … not compatible with group consuming"* | `kgo/config.go:1708-1720` | The one-for-one expression of `assign()`. Because it is a construction option, the browse client is **per-browse and ephemeral** (**P58e E5**) — `AddConsumePartitions` (`kgo/consumer.go:931`) exists but silently no-ops on a client that is not already a direct consumer (`if c.d == nil … return`), which is a footgun a "reuse the admin client" design would walk into |
| **`kgo.NewOffset().At(n)`** produces an exact-offset `Offset` | `kgo/consumer.go:66, 173` | `toNativeOffset`'s whole reason for existing evaporates: the argument is `int64` (**P58e E6**) |
| **`FetchPartition` carries `HighWatermark`, `LastStableOffset`, `LogStartOffset` and `Err` on every fetch** | `kgo/record_and_fetch.go`'s `FetchPartition` | The EOF-clamp replacement (**P58e E9**), and the reason **P58 D7** called this *stronger* than `partition.eof`. `LastStableOffset` is additionally the transaction-aware watermark, which is precisely KF-3's subject |
| **`kgo.Record` has `Key []byte`, `Value []byte`, `Headers []RecordHeader`, `Timestamp time.Time`, `Partition int32`, `Offset int64`** — and `RecordHeader` is `{Key string; Value []byte}` | `kgo/record_and_fetch.go` | `Offset` is a real `int64`, `Timestamp` a real `time.Time`. Headers are a **flat ordered slice**, closer to librdkafka's `[{k:v}]` array than to kafkajs's `Record` — so `headersToPlain`'s repeated-key promotion (`read.ts:37-50`) ports **unchanged in intent** (**P58e E8**) |
| **`Fetches.Err0()`/`Err()`/`EachError`/`EachPartition`/`NumRecords`/`Empty`** | `kgo/record_and_fetch.go:457-717` | `EachPartition(func(FetchTopicPartition))` is how the loop reads watermarks; `Err()` is how it sees a cancelled ctx (§1.6) |
| **`kadm.Metadata{Cluster string; Controller int32; Brokers BrokerDetails; Topics TopicDetails}`**, `TopicDetail{Topic, ID, IsInternal, Partitions}`, `PartitionDetail{Topic, Partition, Leader, LeaderEpoch, Replicas, ISR, OfflineReplicas, Err}` | `kadm/metadata.go:16-193` | One call answers `listTopics`, `listPartitions`, `buildTopicDefinition`'s Partitions section **and** the cluster id, where the TypeScript needed `fetchTopicMetadata` plus a capability it did not have. `IsInternal` is a real field, so `catalog.ts`'s `name.startsWith('__')` heuristic can stay (for group names, which have no such flag) but is no longer needed for topics — **P58e E10** |
| **`kadm.ListStartOffsets` / `ListEndOffsets` / `ListOffsetsAfterMilli(ctx, ms, topics...)` all return `ListedOffsets = map[string]map[int32]ListedOffset{Topic, Partition, Timestamp, Offset, LeaderEpoch, Err}`** | `kadm/metadata.go:316-497` | `fetchTopicOffsets` becomes **two** calls (start + end), not one. `ListOffsetsAfterMilli`'s doc says *"If a partition has no offsets after the requested millisecond, the offset will be the current end offset"* — a **different** answer from librdkafka's, which returns `-1`/`OFFSET_END`; scenario 19's re-baseline depends on it, KF-4(c) confirms it |
| **A missing topic surfaces as a special `-1` partition carrying `kerr.UnknownTopicOrPartition`**, not as a returned error | `kadm/metadata.go:400-497`, repeated in every `List*Offsets` doc | The `E_QUERY`-for-a-nonexistent-topic path (`kafka.spec.ts` 11) is a **`ListedOffsets` inspection**, not an error check. A literal port of `try { fetchTopicOffsets } catch` would silently return an empty window set and a blank page instead of `E_QUERY` — **P58e E12** |
| **`kadm.ListGroups(ctx, filterStates...)` → `ListedGroups` of `ListedGroup{Coordinator int32; Group string; ProtocolType string; State string}`** | `kadm/groups.go:246-291` | `listGroups`'s port. No internal-group flag, so `isInternal` stays for groups |
| **`kadm.DescribeGroups(ctx, groups...)` → `DescribedGroups` of `DescribedGroup{Group, Coordinator BrokerDetail, State string, ProtocolType string, Protocol string, Members []DescribedGroupMember, Err, ErrMessage}`** | `kadm/groups.go:131-148` | **`State` is already a string** ("Empty", "Stable", …), so `definition.ts`'s whole `reverseLookup`/`ConsumerGroupStates` numeric-enum apparatus is deleted rather than ported. **There is no `Type` field and no `PartitionAssignor` field** — §1.8 and **P58e E13** |
| **`BrokerDetail = kgo.BrokerMetadata{NodeID int32; Port int32; Host string; Rack *string}`** | `kadm/kadm.go:166-167`, `kgo/broker.go:113` | `coordinator`'s row value is `fmt.Sprintf("%s:%d", d.Coordinator.Host, d.Coordinator.Port)` — byte-identical to `definition.ts:128` |
| **`kadm.FetchOffsets(ctx, group)` → `OffsetResponses = map[string]map[int32]OffsetResponse`**, each embedding `Offset{Topic, Partition, At int64, LeaderEpoch, Metadata}` plus `Err` | `kadm/groups.go:664-941` | `admin.fetchOffsets({groupId})`'s port, best-effort with a note on failure (`definition.ts:146-161`) |
| **`kadm.DescribeTopicConfigs(ctx, topics...)` → `ResourceConfigs` of `ResourceConfig{Name, Configs []Config, Err, ErrMessage}`**, `Config{Key string; Value *string; Sensitive bool; Source kmsg.ConfigSource; Synonyms}` with a `MaybeValue() string` helper | `kadm/configs.go:13-90` | **The capability P32 D14 recorded as permanently lost.** `kmsg.ConfigSourceDefaultConfig = 5` (`kmsg/generated.go:68279`) is what `detail: 'default'` becomes — **P58e E11** |
| **`kgo.ProduceSync(ctx, rs ...*Record) ProduceResults`**, with `ProduceResults.FirstErr()` and `First()`; each `ProduceResult.Record` has its `Offset`/`Partition` filled in on success | `kgo/producer.go:333-359` | A **capability gain** over `produce.ts`, whose own comment concedes it reports *"queued into librdkafka, not the broker acknowledged this specific message"*. **P58e E14** |
| **Idempotent producing is franz-go's default**; `kgo.DisableIdempotentWrite()` turns it off | `kgo/config.go:1187` | §1.8 — the one silent behaviour change in the port, and it is a connect-time hang risk on a real single-broker cluster |
| **`kgo.NewClient` opens no connection**; `Client.Ping(ctx)` *"returns whether any broker is reachable … iterating over any discovered broker or seed broker"* | `kgo/client.go:628-633` | The direct analogue of `client.ts:96`'s bounded `admin.listTopics({timeout})` probe, which exists because *"admin.connect() alone proves nothing about broker reachability"*. **P58e E15** |
| **`kgo.SeedBrokers`, `ClientID`, `DialTimeout`, `DialTLSConfig`, `SASL`, `RetryTimeout`, `FetchMaxWait`, `MetadataMinAge`** all exist as plain options | `kgo/config.go:716, 819, 832, 846, 916, 988, 998, 1502` | `client.ts`'s librdkafka property map ports to typed options; `sasl/plain.Auth{User,Pass}` is at `kgo/../sasl/plain/plain.go:12`. **P58e E16** |
| **`kerr.Error{Message string; Code int16; Retriable bool; Description string}`**, reached with `errors.As`; `kerr.IsRetriable`; the named values `UnknownTopicOrPartition` (3), `RequestTimedOut` (7), `InvalidGroupID` (24), `TopicAuthorizationFailed` (29), `GroupAuthorizationFailed` (30), `ClusterAuthorizationFailed` (31), `SaslAuthenticationFailed` (58), `GroupIDNotFound` (69), `UnknownTopicID` (100) | `kerr/kerr.go:17-32, 75-320` | Every one of `errors.ts`'s four code sets has a named `kerr` counterpart **except** the four `ERR__`-prefixed *client-local* codes (`ERR__TRANSPORT`, `ERR__RESOLVE`, `ERR__ALL_BROKERS_DOWN`, `ERR__STATE`, `ERR__TIMED_OUT`, `ERR__AUTHENTICATION`, `ERR__UNKNOWN_TOPIC`), which are librdkafka inventions with **no protocol-level equivalent**. **P58e E4** re-derives those four from Go's own `*net.OpError`/`*net.DNSError`/`context.DeadlineExceeded`, exactly as `postgres/errors.go`, `mysqlfamily/errors.go`, `redis/errors.go` and `awscfg/errors.go` already did for their own Node errnos |
| **`kgo.ErrClientClosed`** is injected as a fake fetch, not returned | `kgo/errors.go:292` | The browse's `defer cl.Close()` racing a still-running loop must not be mapped to `E_QUERY` |

### 1.8 Two silent behaviour changes the port introduces, both invisible until they fire

Neither is a design *choice*; both are properties of the Go client that differ from librdkafka's, and
both are the class of thing `AGENTS.md`'s own findings say gets lost in a port that "reads correct".

**1. Idempotent producing is on by default in franz-go and off by default in librdkafka.** An
idempotent producer must first issue `InitProducerId`, which the broker answers only once
`__transaction_state` exists — and `__transaction_state` is created with
`transaction.state.log.replication.factor`, whose Kafka default is **3**. On a single-broker cluster
that topic can never be created, so `InitProducerId` **hangs rather than failing**. This is not
speculation: `tests/db/support/kafka.ts:41-48` carries the scar, in its own words —

> KafkaContainer's own KRaft defaults … set the offsets-topic replication factor and the
> transaction-log min ISR down to 1 for a single-broker cluster, but miss the transaction-log
> replication factor itself — that stays at Kafka's default of 3. With only one broker to replicate
> to, `__transaction_state` can never be created, so any transactional producer … wedges the broker's
> `InitProducerId` handling indefinitely. Nothing to do with Electron or the client library — a bare
> single-node Kafka gotcha.

The current TypeScript producer never hits it because librdkafka's `enable.idempotence` defaults to
`false`. A verbatim franz-go port would hit it **on a user's single-broker cluster**, at their first
produce, as a hang. **P58e E14** sets `kgo.DisableIdempotentWrite()` and says why; KF-4(e) confirms
the failure mode rather than resting on the read.

**2. Node's `Buffer.toString('utf8')` replaces invalid sequences; Go's `string([]byte)` does not.**
Three cells are affected — `key` (`read.ts:282-286`), `body` (`:290`) and every header **value**
(`:42`) — all of which are raw broker bytes with no encoding guarantee. Go's `string(b)` on invalid
UTF-8 produces a Go string that is *not valid UTF-8*, which then enters
`page/builder.go`'s `appendValue` → `MaxCellBytes` truncation, a codec whose UTF-8-boundary walk
assumes otherwise. This is precisely the hazard **P58d D12**'s *rejected alternative* names
(*"feeding it a Go string that is not valid UTF-8 puts invalid input into a codec whose invariants
assume otherwise"*). **P58e E8** applies `strings.ToValidUTF8(s, "�")` at the adapter, and
records the same one-per-run-vs-one-per-sequence divergence **P58d D12** recorded for S3 — with the
difference that here it applies to three cells rather than one, and one of them (`key`) is asserted
by `kafka.spec.ts` 7 (`assert.match(row.key ?? '', /^key-\d$/)`), which no fixture value can
distinguish.

### 1.9 Flipping `"kafka"`: the grep, and the placeholder debt P58c/P58d deferred here

`grep -rn 'kafka' shell/internal --include=*.go`, run for this plan exactly as `AGENTS.md`'s P58a
findings require (*"Flipping a kind's `nativeKinds` bit is a cross-package breaking change. Grep the
literal kind string across `internal/` before flipping it"*). **Three hits, and one of them is the
problem:**

| File:line | What it is | Fate |
|---|---|---|
| `internal/storage/model/connection.go:49` | the valid-connection-kind set | Correct, untouched |
| `internal/adapters/sqs/mutate.go:15` | a prose comment (*"mirrors mongo's `$document`, kafka's `$body`"*) | Correct, untouched |
| **`internal/adapterhost/router.go:30`** | **`const TestKindNodeServed = "kafka"`** | **Must be retired in the flip's own commit** |

`grep -rn 'TestKindNodeServed' shell/` returns **10 lines across 5 files** — its declaration plus
five real uses and three explanatory comments:

| File | Use | Can it take a synthetic kind? |
|---|---|---|
| `adapterhost/router.go:21-30` | the declaration + 9 lines of doc comment | — |
| `adapterhost/integration_test.go:23` | `conns := fakeKindLookup{"conn-1": TestKindNodeServed}` | **Yes** — a hand-written `KindLookup` fake, no validation |
| `adapterhost/dataframe_test.go:94` | `conns["conn-2"] = TestKindNodeServed` | **Yes**, same |
| `tree/service_test.go:66` | a raw `INSERT INTO connections (…, kind, …) VALUES (…, ?, …)` | **Yes** — raw SQL, bypasses `model.ValidConnectionKind` entirely |
| `connections/service_test.go:82` (`fieldsInput`) and `:225` | `model.ConnectionFields{Kind: adapterhost.TestKindNodeServed, …}` handed to `connections.Service.Create` | **No.** `connections/input.go:31` calls `model.ValidConnectionKind(in.Kind)` against `model/connection.go:47`'s closed ten-kind set. A synthetic kind is rejected before the router is ever consulted |

That last row is why **P58e E20** is a decision rather than a rename. Two of those tests'
whole subject is `connections.Service`'s **child-forwarding** path — which still exists in shipped
code until P58f's M10 collapses the two `EngineBackend` implementations — so deleting them now would
be deleting coverage of live code.

**Everything else the flip touches, enumerated so the implementer checks rather than trusting "the
router handles it":**

- **`connections.MarkAllErrored`** (`connections/service.go:529-548`) — **P58a A15** narrowed it to
  Node-served kinds via `s.deps.Backend.IsNativeKind(summary.Kind)`. After M9.3 that guard `continue`s
  for **every** connection and the function emits nothing. It is not dead code (P58f deletes it) but
  it is a no-op, and the test that proved it worked is the one **P58e E21** rewrites.
- **`adapterhost.Router.Cancel`** (`router.go:396-414`) — routes on op ownership, not kind
  (**P58a A13**), and still forwards an *unknown* opID to the child unconditionally. This is one of
  the three surviving child-request paths §7 has to account for in checkpoint C2.
- **`Router.HandleDataFrame`** (`dataframe.go:49-84`) — `"ping"` **always** forwards to the child
  (**P58a A17**, `:61-63`); `"cache:stats"` is answered locally (**P58a A16**); `"cache:clear"` is
  answered locally **and** forwarded. Every other op reads `payload.connectionId` and routes on kind,
  which after M9.3 is always native. §7 again.
- **`Router.PushCacheConfig`** (`router.go:75-80`) — pushes to both caches, including the child's,
  and is called at startup (`main.go:145`) and on every settings save (`bridge/settings.go:36`).
  §7 again.
- **`shell/main.go`** — one blank import (`main.go:19-27` currently lists nine, alphabetically
  scrambled: mariadb, mysql, clickhouse, mongo, postgres, redis, s3, sqlite, sqs). **The single most
  likely thing to be forgotten**, because omitting it produces no compile error: `CreateAdapter`
  returns `E_UNSUPPORTED "kafka connections are not supported yet"` (`registry.go`) at connect time,
  in the real app only, and never in `go test ./internal/adapters/kafka` (which constructs the
  adapter through `CreateAdapter` *after* the package's own blank import in its `_test.go`). §8
  makes it a per-milestone acceptance check, exactly as P58b §4.6, P58c §4.6 and P58d §4.7 did.

### 1.10 `tests/e2e-real/mariadb-real.spec.ts` — the file that necessarily breaks

Read in full (276 lines) because it is the single most consequential file outside
`shell/internal/adapters/` that P58e touches, and because P58d's own findings entry predicted this
exact moment.

**What it is.** Two tests. The first (`:50-135`, *"C1b: real MariaDB (native), end to end, keyset
paging over big_rows"*) drives MariaDB alone and asserts `engine-status` is `ok` at the end — it is
unaffected by P58e. The second (`:140-276`) is the load-bearing one, and its own header comment
(`:137-139`) says so: *"the only evidence in the entire P58 phase that the coexistence property
(P58 D4) holds in a running app, not only in adapterhost's own router unit tests."*

**Why it breaks.** Its shape is: connect MariaDB (native) → connect Kafka (Node-served) → open
`topic:orders` and render a real stream page → `pgrep -P serverPid` → `SIGKILL` every child →

```
await expect(kafkaStatusDot).toHaveAttribute('data-status', 'error', { timeout: 15_000 });
await expect(mariaRowAfterReload.locator('.status-dot')).toHaveAttribute('data-status', 'connected');
```

and again after a reload (`:256-258`). After M9.3, `MarkAllErrored` skips Kafka exactly as it skips
MariaDB, so the Kafka dot **stays `connected`** and both assertions at `:235` and `:256` fail. This
is a deterministic failure in the flip's own commit, not a flake.

**What the file already says about its own retirement.** `:20-26`:

> The Node-served half is Kafka, not MongoDB (P58c C15) … Kafka is the last of the ten kinds to go
> native (P58e), **so this is the last re-pointing this vehicle needs before P58f retires the whole
> coexistence concept** — see AGENTS.md's P58a/P58b/P58c findings for why "the kind that goes native
> last" is the rule.

The file's own author anticipated P58f retiring it. What the file does *not* anticipate is that P58e
is where it stops passing — P58f is one sub-phase too late. **P58e E21** rewrites the second test
into the proof that is actually true after M9.3, and §7 explains why that rewrite is *also*
checkpoint C2's automated half rather than a consolation prize.

**The support file, and the re-grep-before-delete rule.** `tests/e2e-real/support/kafka.ts` (3 lines)
is a pure re-export: `export { type KafkaFixture, startKafka } from '../../db/support/kafka';`. So
`tests/db/support/kafka.ts` has a **live consumer in `tests/e2e-real/`** — and §1.11 finds a second
one in `tests/ipc/`.

### 1.11 The "its only consumer" re-grep, and the two files that must survive the spec deletion

The mistake `AGENTS.md`'s P58a findings name explicitly (*"a plan's own 'its only consumer' claim
about a shared support file is a snapshot, not a standing fact"*), and which **P58d D20** turned into
a procedure. `grep -rln "support/kafka\|0005_kafka_seed" tests/ scripts/ package.json`:

| File | Lines | Consumers other than `tests/db/kafka.spec.ts` | Fate |
|---|---:|---|---|
| `tests/db/kafka.spec.ts` | 776 | — | **DELETED**, M9.4's own commit (**P58 D12**) |
| `tests/db/support/kafka.ts` | 91 | `tests/e2e-real/support/kafka.ts:3`, `tests/ipc/kafka/kafka.backend.spec.ts:16` | **KEPT** |
| `tests/db/fixtures/0005_kafka_seed.ts` | 121 | `tests/db/support/kafka.ts:3`, `tests/ipc/kafka/kafka.backend.spec.ts:14` | **KEPT** |
| `tests/db/support/page.ts`'s `readStream` | (1 of 4 exports) | after this deletion: **none** — `sqs.spec.ts` went in P58d M8.2 | Dead export; `page.ts` itself still has three live consumers (`clickhouse`/`mariadb`/`mysql`/`sqlite` specs use `readTabular`). **Left alone**; P58f deletes the directory |
| `scripts/run-db-tests.sh` | 25 | `package.json:28`'s `test:db` | **SIMPLIFIED**, not deleted (**P58e E19**) |

**P58d's own §1.11 table is confirmed a second time**, and this is the third consecutive sub-phase
for which the naive "delete the support file with the spec" instinct would have broken another tier.

**`scripts/run-db-tests.sh`, and what the parent means by "its whole reason for existing".** The
script is 25 lines and does two things: `bun test tests/db --path-ignore-patterns '**/kafka.spec.ts'`,
then esbuild-bundles `kafka.spec.ts` and runs it under `shell/runtime/node/bin/node`. Its own header
comment says why: *"Bun cannot load `@confluentinc/kafka-javascript`'s native addon under any ABI
(P32 F21), so that one file runs esbuild-bundled under a real Node process instead."* Once
`kafka.spec.ts` is deleted, **the entire second half plus the ignore-pattern is dead**, and the
script collapses to one line. The parent assigns this to M9; the *deletion* of the script is M10's
(parent §9's M10 list names `scripts/run-{db-tests,ipc-backend}.sh`). **P58e E19** takes the
simplification and leaves the deletion.

### 1.12 Two predecessor closeout claims the tree contradicts, both inherited

Checked with `ls`, `git log` and the actual files.

1. **P58b's four `tests/db/*.spec.ts` deletions are still outstanding — now for the fourth
   consecutive sub-phase.** At `1065518`, `tests/db/` holds `clickhouse.spec.ts`, `kafka.spec.ts`,
   `mariadb.spec.ts`, `mysql.spec.ts`, `sqlite.spec.ts` — five files. `postgres.spec.ts` (P58a M5),
   `mongo.spec.ts`/`redis.spec.ts` (P58c M7.3/M7.4) and `sqs.spec.ts`/`s3.spec.ts` (P58d M8.2/M8.3)
   are all gone, so **P58a, P58c and P58d each honoured their own deletion rule and P58b still has
   not**. P58c raised it as its OQ-1, P58d carried it forward as its own OQ-1, and after M9.4
   `bun run test:db` would run **four** full container suites against TypeScript adapters serving no
   real connection in the app — with nothing else left in the directory. §10 OQ-1, and the question
   is now sharper than it was: with Kafka gone, `tests/db/` is *entirely* dead weight.
2. **`docs/ARCHITECTURE.md`'s Stack line and its Kafka row are both about to become false, and the
   mapping table has a history of being missed.** P58d §1.11 recorded the table failing its own
   acceptance criterion **twice in two consecutive sub-phases**, and fixed it by phrasing criterion 8
   as a grep. P58e inherits that discipline and needs four specific edits (`:48-49` *"Kafka is the
   only kind still Node-served"*; `:104`'s Kafka row Cancel cell *"close the assigned consumer,
   `AbortSignal`"*; `:263-281`'s whole **Kafka (`@confluentinc/kafka-javascript`, P32)** section;
   `:315`'s *"only Kafka is left for P58e"*). §8 criterion 8 phrases all four as greps.

### 1.13 The dependency situation, and the one thing that is already on disk

- **`shell/go.sum` has zero franz-go entries** (`grep -c franz shell/go.sum` → `0`), so nothing is
  pulled in transitively today.
- **But the module cache already has all three**, from P58a's own KF-1 probe:
  `$(go env GOPATH)/pkg/mod/github.com/twmb/franz-go@v1.21.6/`,
  `.../franz-go/pkg/kadm@v1.18.0/`, `.../franz-go/pkg/kmsg@v1.13.1/`, each with a matching
  `cache/download/.../@v/*.zip`. **This is why every franz-go claim in this document is "researched"
  in P58d's strong sense** — the source was read from disk, not fetched or inferred, and no network
  access was needed to write §1.7.
- **`testcontainers-go/modules/kafka@v0.44.0` is also already in the cache**, matching the
  `testcontainers-go` core `shell/go.mod` already pins. Its `go.mod` requires
  **`github.com/IBM/sarama v1.42.1`** — an entire second Kafka client — plus `jcmturner/gokrb5/v8`
  and its four sibling Kerberos modules, for its **own tests**. That is the same class of graph noise
  **P58d D22** rejected `modules/localstack` over, and §1.15/**P58e E19** weigh it against what the
  module actually buys.
- **`github.com/twmb/franz-go/pkg/kmsg` is a direct import, not just transitive.** `definition.go`
  needs `kmsg.ConfigSourceDefaultConfig` to render a topic config row's `default` detail
  (`kmsg/generated.go:68274-68281`), and `kadm.Config.Source` is typed `kmsg.ConfigSource`. So
  `go.mod` names it explicitly rather than letting it sit indirect.

### 1.14 The packaging gap, located precisely

The parent's sub-phase table calls Kafka *"the one carrying the still-open native-module packaging
gap"* without saying where it lives. `grep -n -i "kafka\|confluent" scripts/verify-packaging.sh
scripts/sign-bundle.sh`:

| Location | What it says | State after M9.3 |
|---|---|---|
| `verify-packaging.sh:72` | a comment: *"`@confluentinc/kafka-javascript` (external to the esbuild bundle, P52 §10.1) is NOT checked …"* | Still literally true |
| `verify-packaging.sh:84-86` | **A2**: if `…/runtime/engine/node_modules/@confluentinc/kafka-javascript/build/Release/confluent-kafka-javascript.node` is missing, `note "… Kafka's native module is not yet vendored into the packaged bundle (known gap …); **Kafka connections will fail at runtime in this build**"` | **The last clause becomes false.** Kafka connections are served in-process by Go |
| `verify-packaging.sh:101-113` | **A4**: if the file *is* present, check arch and ad-hoc signature | Correct but unreachable; harmless |
| `sign-bundle.sh:32-36` | signs the same path if present; otherwise `echo "… not present, skipping (Kafka's native module is not yet vendored into the packaged bundle — **a known gap**, not this script's job to fix)"` | *"a known gap"* becomes false — there is no gap, the subject is gone |

So the gap is **two message strings that become factually wrong on M9.3**, wrapped around checks
whose subject P58f deletes. The parent's own §3 assigns the *deletion* to P58f
(`scripts/sign-bundle.sh  EDITED  no nested node binary; Kafka note deleted`), and the parent's §6
manual-check table assigns *"A Kafka connection in a packaged build — Connect, browse a topic,
produce a message — the first time this has ever been verifiable in a packaged bundle"* to the
phase's macOS pass, not to any milestone. **P58e E22** takes the narrow, defensible slice: rewrite
the two strings so a packaging run does not print a false warning, change no check logic, and leave
the blocks for P58f. §10 OQ-4 asks the parent's author to confirm the split.

### 1.15 Environment and container facts checked for this plan

- **Image: `confluentinc/cp-kafka:8.0.7`**, pinned by `tests/db/support/kafka.ts:19` with its own
  reasoning (P32 D25: *"bumped from 7.6.1 (Kafka 3.6) to the 8.0 line (Apache Kafka 4.0) — a phase
  whose entire premise is Kafka 4 protocol compatibility that only ever ran against Kafka 3.6
  verified nothing"*). Already namespaced, so it mirrors at
  `mirror.gcr.io/confluentinc/cp-kafka:8.0.7` with **no `library/` prefix** — `AGENTS.md`'s Docker
  section names this exact image in its own rule, as its worked example.
- **`testcontainers-go/modules/kafka@v0.44.0`, read in full (230 lines).** `Run(ctx, img, opts...)`
  sets fifteen `KAFKA_*` env vars, replaces the entrypoint with a wait-for-script shim, copies a
  starter script that rewrites `KAFKA_ADVERTISED_LISTENERS` from the mapped host port, formats a KRaft
  storage dir with a random uuid, and waits on
  `wait.ForLog(".*Transitioning from RECOVERY to RUNNING.*").AsRegexp()`. Three facts decide
  **P58e E19**:
  1. **It already sets `KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: "1"`** (`kafka.go:63`) — the
     exact variable `tests/db/support/kafka.ts:48` had to add by hand because the *TypeScript*
     module omits it. The Go module is strictly better here, on the one setting this repo has already
     been bitten by.
  2. **`validateKRaftVersion` short-circuits for any image that is not `confluentinc/confluent-local`**
     (`kafka.go:210-213`: *"do not validate if the image is not the official one"*), so
     `confluentinc/cp-kafka:8.0.7` passes through untouched.
  3. **It sets no ulimits** — the ClickHouse subclass problem (`AGENTS.md`'s ClickHouse section) has
     no analogue here.
  Against that: `IBM/sarama` + gokrb5 in its `go.mod` (§1.13), and a log-regex wait strategy that is
  a Kafka-4.0 message this repo has never asserted against from Go. KF-4(a) settles the latter.
- **Seeding cannot copy the TypeScript's mechanism, and should not.** `0005_kafka_seed.ts` runs the
  broker's own CLI *inside* the container (`container.exec`), and its 18-line comment (`:11-28`)
  explains the reason precisely: *"this is what keeps a JS Kafka client out of the Playwright/Node
  process entirely (F24)"*, plus a hard-won in-container-listener gotcha (bootstrap via `:9092`, the
  BROKER listener, never `:9093`, because *"the AdminClient's very next call reconnects to the
  address the broker just advertised for that listener — the host-mapped port — which is not
  reachable from inside the container"*). **Neither reason survives translation**: the Go test binary
  already links franz-go, so there is no client to keep out, and seeding from the host over the
  PLAINTEXT listener has no advertisement problem at all. **P58e E25** seeds from Go.
- **`bun test`-ing the old suite is not a live oracle here, unlike every previous sub-phase.**
  P58b §11, P58c §11 and P58d §11 all recommended running the TypeScript spec beside the Go one to
  diff against. `tests/db/kafka.spec.ts` **cannot run under `bun test` at all** — it is the one file
  `scripts/run-db-tests.sh` excludes, and it needs `shell/runtime/node/bin/node` plus an esbuild
  bundle. It *can* still be run (`sh scripts/run-db-tests.sh` does exactly that) and is worth one run
  before writing the Go successor, but it costs `scripts/vendor-node.sh` + `bun run build:engine`
  first. §11 says so rather than repeating the previous sub-phases' cheaper advice.
- **`./internal/adapters/kafka` needs no GTK/WebKit headers.** franz-go is pure Go; cgo stays on for
  the module as a whole (`mattn/go-sqlite3`, `modernc.org/sqlite`, Wails' GTK bindings in
  `internal/shell`), so `CGO_ENABLED=0` is still not an option, but the fast loop is
  `go test ./internal/adapters/kafka` and never `./...`.
