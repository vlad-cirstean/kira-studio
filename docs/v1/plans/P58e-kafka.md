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

## 2. Decisions

Per the preamble: this plan's own decisions are always written **P58e E\<n\>**, including in their
own headers. A bare `E<n>` and a bare `D<n>` appear nowhere in this document.

**P58e E1 — Kafka uses `github.com/twmb/franz-go` v1.21.6 with `pkg/kadm` v1.18.0 and `pkg/kmsg`
v1.13.1, confirming P58 D7 without amendment and without a fallback branch.** §1.3 is the reason:
**P58 D7**'s own probe list was executed in P58a's M0 as KF-1 and passed in full, including the two
capability recoveries it hoped for. The named cgo fallback (`confluentinc/confluent-kafka-go`) is not
carried forward as a contingency in this plan, because keeping a rejected alternative alive after its
rejection has been empirically confirmed is how a plan grows branches nobody will ever take.
`shell/go.mod` gains exactly three runtime modules; `kmsg` is a **direct** require, not indirect,
because `definition.go` names `kmsg.ConfigSource` (§1.13). `package.json` loses
`@confluentinc/kafka-javascript` and its `trustedDependencies` entry in P58f, not here.

**P58e E2 — there is no shared package; `internal/adapters/kafka` is the whole of P58e's product
code.** §1.2. P58d extracted `awscfg` because two adapters documented themselves as duplicates;
P58b extracted `mysqlfamily` because two profiles shared 1 645 of 1 782 lines. P58e has one adapter
and nothing to share, and the shared surface it *does* use (`errors.go`, `caps.go`, `sqltext.go`'s
three token functions) already exists. Stated as a decision rather than left as an absence, so a
reader arriving from P58d does not go looking for a `kafkacfg`.

**P58e E3 — the op's own `context.Context` goes straight to every `kadm` and `kgo` call; no
`RunWithAbortRace`; and the browse loop checks `Fetches.Err()` explicitly because a cancelled context
does not surface as a returned error.** §1.6. Three parts, and the third is the one a reader coming
from P58d will not expect:

1. **No `adapters.RunWithAbortRace`, for P58d D3's reason.** Kafka has no server-side kill —
   `Cancel()` is `return false` permanently (`index.ts:134-136`) and there is no protocol operation
   that stops an in-flight fetch. There is nothing for a driver abort to race, so detaching the
   context would leave a browse client fetching after the caller unblocked and would defer its
   `Close()` onto a goroutine the caller no longer waits for. **The package carries a comment at its
   `Cancel` saying why the shared helper is absent**, because "this adapter doesn't use the helper
   six others use" reads like a bug to anyone who does not know why.
2. **`CheckNotStarted(ctx)` before the first call and `CheckCancelled(ctx)` exactly where the
   TypeScript calls `throwIfCancelled`** — `read.ts:88, 119, 216, 267, 297` and `:334`.
3. **The fetch loop maps `fetches.Err()` itself.** `kgo.Client.PollRecords` returns `Fetches`, not an
   error, and injects a fake fetch carrying `ctx.Err()` on cancellation and `kgo.ErrClientClosed` on
   close (`kgo/consumer.go:474-495`). The loop therefore reads: poll → `if err := fetches.Err(); err
   != nil { … }` → `errors.Is(err, context.Canceled)` → `E_CANCELLED`; `errors.Is(err,
   kgo.ErrClientClosed)` → treat as loop end, not an error; otherwise `mapError`. KF-2 confirms both
   the shape and the promptness, and a failure there is a **stop and raise** exactly as AWS-1(e) was
   for P58d.

*Named alternative, rejected:* keep the TypeScript's abort-listener bridge shape by launching the
browse on a goroutine and closing the client from a `select` on `ctx.Done()`. Rejected because it is
`RunWithAbortRace` rebuilt by hand, with the same two costs and none of the shared helper's care.

**P58e E4 — error mapping is over `*kerr.Error`'s protocol codes, not librdkafka's numeric codes, and
the four `ERR__` client-local codes are re-derived from Go's own error types.** `errors.ts`'s
dispatch order ports verbatim — cancellation first, then connect, then timeout, then auth, then the
unknown-topic → `E_QUERY` special case, then `E_QUERY` as the default — and the default is
load-bearing, because *"a topic/partition gone at read time (deleted concurrently) is an ordinary
query-time condition, not a connection failure — E_QUERY, deliberately not E_NOT_FOUND"*
(`errors.ts:32-35`). The re-derivation:

| `errors.ts` | Go |
|---|---|
| `name === 'AbortError' \|\| /aborted/i.test(message)` | `errors.Is(err, context.Canceled)` **first**, before anything else |
| `CONNECT_CODES` = `ERR__TRANSPORT`, `ERR__RESOLVE`, `ERR__ALL_BROKERS_DOWN`, `ERR__STATE` — **all four are librdkafka client-local, with no protocol code** | `*net.OpError` / `*net.DNSError` via `errors.As`, plus `kgo`'s own dial failures — the same Go re-derivation `postgres/errors.go`, `mysqlfamily/errors.go`, `redis/errors.go` and `awscfg/errors.go` already made. KF-4(d) prints the real shapes |
| `TIMEOUT_CODES` = `ERR__TIMED_OUT`, `ERR__TIMED_OUT_QUEUE` | `errors.Is(err, context.DeadlineExceeded)` or `errors.Is(err, os.ErrDeadlineExceeded)`, **plus** `kerr.RequestTimedOut` (code 7), which librdkafka's set did not cover |
| `AUTH_CODES` = `ERR__AUTHENTICATION`, `ERR_SASL_AUTHENTICATION_FAILED`, `ERR_TOPIC_AUTHORIZATION_FAILED`, `ERR_GROUP_AUTHORIZATION_FAILED`, `ERR_CLUSTER_AUTHORIZATION_FAILED` | `var ke *kerr.Error; errors.As(err, &ke)` then `ke.Code` against `kerr.SaslAuthenticationFailed` (58), `TopicAuthorizationFailed` (29), `GroupAuthorizationFailed` (30), `ClusterAuthorizationFailed` (31). The `ERR__AUTHENTICATION` client-local code has no protocol twin and folds into the connect branch |
| `UNKNOWN_TOPIC_CODES` = `ERR__UNKNOWN_TOPIC`, `ERR_UNKNOWN_TOPIC_OR_PART` | `kerr.UnknownTopicOrPartition` (3) and `kerr.UnknownTopicID` (100) → `E_QUERY`, message verbatim |
| the three `KafkaJS*`-named secondary fallbacks (`errors.ts:69-71`) | **deleted, not ported** — they exist only because the compat layer threw plain `Error` subclasses before any librdkafka call happened. franz-go has no compat layer |
| everything else | `E_QUERY`, message verbatim (Adapter rule 4) |

Because `kerr.Error.Error()` is `"MESSAGE: Description"` (`kerr/kerr.go:30-32`), **every user-visible
Kafka error message changes wording** — the parent's §7 item 4 already names this as a phase-wide,
accepted cost. §5.3 re-baselines against a real broker rather than guessing (**P58 §1.10**'s first
non-portable point).

**P58e E5 — the browse client is a fresh, ephemeral `kgo.Client` per `read()`, closed with a
`defer`; the adapter's long-lived client is admin-and-produce only.** `kgo.ConsumePartitions` is a
**construction-time** `ConsumerOpt` (`kgo/config.go:1720`), and `AddConsumePartitions` silently
no-ops on a client that was not built as a direct consumer (`kgo/consumer.go:931-935`:
`if c.d == nil || cl.cfg.regex { return }`) — so "reuse one client and re-point it" is not merely
inelegant, it fails silently. This also reproduces the TypeScript exactly (`client.ts:33-35`: *"One
long-lived Admin client per adapter instance … browse consumers are separate and fully ephemeral
(P10's D6)"*), and it is what makes `defer cl.Close()` a complete teardown with no listener bridge.
The browse client carries `kgo.ConsumePartitions(...)`, `kgo.FetchMaxWait(1 * time.Second)` (matching
`POLL_TIMEOUT_MS`) and **never** `kgo.ConsumeTopics`, `kgo.ConsumerGroup` or any group option — which
is what makes **P58 D7**'s no-group property structural rather than disciplinary.

**P58e E6 — `toNativeOffset` is deleted rather than ported, and scenario 20 is re-baselined rather
than dropped.** `read.ts:145-160`'s guard exists solely because *"the native API types offsets as
`number` while the app's own contract is int64-as-decimal-string"*, and its own comment says the
failure it prevents is *"a page of plausible-but-wrong messages, the worst failure mode a DB client
can have."* Go's `int64` and `kgo.NewOffset().At(int64)` remove the hazard entirely — the parent's §7
"what gets better" item 9 names exactly this. **The consequence for the test is real and must not be
papered over:** `kafka.spec.ts` 20 hand-crafts a page token whose `next` is
`String(Number.MAX_SAFE_INTEGER + 1)` and asserts `E_UNSUPPORTED` with the offset in the message.
That value is an *ordinary* `int64` in Go and produces an empty browse, not an error. The Go scenario
therefore re-baselines to the boundary that still exists — an offset exceeding `int64`
(`"9223372036854775808"`), which fails `strconv.ParseInt` → `E_QUERY` *"malformed page token"* — and
its comment records that the `E_UNSUPPORTED` branch was **removed as a capability gain, not lost**.

**P58e E7 — the page token's window payload uses `int64` numbers, not decimal strings, and a token
minted by the TypeScript adapter is not decodable by the Go one.** `read.ts:62` puts
`JSON.stringify(windows)` into `EncodePageToken`'s single-element `string[]`, with `next`/`end` as
decimal strings because JS has no int64. Go's `partitionWindow{Partition int32; Next int64; End
int64}` marshals them as numbers. The token stays a `[]string{string(jsonBytes)}` so
`sqltext.go:61`'s signature is unchanged, and `RequestFingerprint({topic, pageSize, filter})` keeps
its three inputs exactly (`read.ts:205`). **The stated cost:** a token minted by the Node child before
the flip, presented to the Go adapter after it, decodes to `"malformed page token"` (`E_QUERY`) rather
than working — because the JSON shape differs even though the fingerprint matches. This cannot occur
in practice (a `nativeKinds` flip ships in a rebuilt binary, and every connection reconnects), and
`sqltext.go:93`'s own doc already scopes fingerprints to *"deterministic within a process"*. Recorded
so it is a decision rather than a discovery.

*Named alternative, rejected:* keep `next`/`end` as decimal strings for byte-compatibility with the
TypeScript's token. Rejected because it reintroduces string↔int64 conversion at four sites for a
compatibility window that does not exist, and because the whole point of **P58e E6** is that Go's
offsets are integers.

**P58e E8 — `key`, `body` and every header **value** pass through `strings.ToValidUTF8(s, "�")`;
the `headers` cell is `map[string]any` (string or `[]string`) marshalled by `encoding/json`, with no
hand-written encoder.** §1.8. Two halves, and the contrast with **P58d D8** is the point:

- **The invalid-UTF-8 half is Kafka's own and has no SQS analogue.** Node's
  `Buffer.toString('utf8')` (`read.ts:42, 284, 290`) replaces invalid sequences; Go's `string(b)`
  does not, and `page/builder.go`'s `appendValue` truncation assumes valid UTF-8. Same lossy-decode
  decision **P58d D12** made for S3 object bodies, same recorded divergence (`TextDecoder` emits one
  U+FFFD per invalid *sequence*, `strings.ToValidUTF8` one per maximal *run*), applied to three cells
  instead of one. No fixture value is affected — the seed is ASCII — which is exactly why it is
  written down here.
- **The headers half is *simpler* than SQS's, and the plan should say so rather than reflexively
  reaching for a hand encoder.** **P58d D8** needed one because `types.MessageAttributeValue` is a
  five-field SDK struct whose `json.Marshal` emits explicit `null`s that `JSON.stringify` never
  produced. Kafka's TypeScript already builds a **plain** `Record<string, string | string[]>`
  (`headersToPlain`, `read.ts:37-50`) and `JSON.stringify`s it; franz-go's `RecordHeader{Key string;
  Value []byte}` maps onto the identical Go shape with the identical repeated-key promotion. So
  `json.Marshal(map[string]any)` **matches**, and the only divergence is Go's sorted map keys versus
  JS's insertion order — the same unobserved difference **P58d D8** recorded, since the cell is
  parsed, not compared. KF-4(f) diffs one seeded message's `headers` and `attrs` cells against the
  TypeScript's rendering to confirm there is no third difference.
- The sibling `attrs` cell is `{"partition": <number>, "offset": "<decimal string>"}`
  (`read.ts:288`) — **note the asymmetry, which ports verbatim**: partition is a JSON number, offset
  a JSON string. `kafka.spec.ts` 7 asserts exactly that (`typeof row.attrs.partition === 'number'`,
  `typeof row.attrs.offset === 'string'`), and a Go port that "tidies" offset into a number breaks a
  cell users read.

**P58e E9 — end-of-log detection is a per-fetch `HighWatermark` comparison, not an event, and
`MAX_EMPTY_POLLS` is kept as a second, independent terminator.** §1.5, and this is the decision with
the most history behind it (P43 iter2 F19/D26) and the one **KF-3** exists to confirm. The design:

- The loop keeps a `map[int32]int64` of the highest `HighWatermark` seen per partition, updated on
  every `fetches.EachPartition(func(FetchTopicPartition))`.
- A partition is **provably drained** when it appeared in a fetch that delivered no record inside its
  own `[next, end)` window **and** its reported `HighWatermark >= w.End`. That is the same proof
  `partition.eof` gave — the frozen `end` was a high watermark, and the consumer has now been told
  the current high watermark is at or beyond it with nothing left to hand over.
- After the loop, `for each drained partition: w.Next = w.End` — the clamp, verbatim in effect
  (`read.ts:306-308`), so `hasMore` cannot stay true forever across a compacted hole, a
  retention-aged offset or a transaction commit marker.
- `MAX_EMPTY_POLLS = 2` is **kept**, with `read.ts:304-305`'s reasoning ported verbatim (*"an empty
  poll with no EOF is indistinguishable from a slow broker, and there genuinely may be more"*). The
  parent's **P58 D7** said the fallback *"should be ported anyway — it costs nothing and the bug it
  was written for was real — but it stops being load-bearing"*; this plan agrees and keeps both.
- **The whole of this lives in one pure function** so it can be tested without a broker — see
  **P58e E26** and §5.5.

**KF-3's failure mode, stated in advance:** if franz-go does **not** return a `FetchPartition` entry
for a partition whose only remaining offset is a commit marker, the "provably drained" test never
fires and the design falls back to `MAX_EMPTY_POLLS` alone — which is the pre-P43-iter2 behaviour and
would reintroduce a real, previously-fixed bug. The fallback in that case is `LastStableOffset`
(available on the same struct and transaction-aware by definition): clamp when
`LastStableOffset >= w.End`. KF-3 prints both fields for exactly this fork.

**P58e E10 — internal-object filtering keeps `name.startsWith("__")` for groups and uses
`TopicDetail.IsInternal` for topics.** `catalog.ts:8-10`'s `isInternal` is a name heuristic applied to
both. `kadm.TopicDetail` has a real `IsInternal bool` (`kadm/metadata.go:85`), which is the broker's
own answer and is strictly better; `kadm.ListedGroup` has no equivalent, so groups keep the prefix
test. `TopicDetails.FilterInternal()` (`kadm/metadata.go:135`) does the topic half in one call. This
changes nothing observable (`__consumer_offsets` and `__transaction_state` are both flagged and both
`__`-prefixed) and is recorded so the asymmetry reads as deliberate.

**P58e E11 — the Configuration section is populated, the "not available" note is deleted, and this is
the phase's promised capability recovery landing.** `definition.ts:58-68` renders an **empty**
Configuration section plus the note *"Topic configuration is not available: this Kafka client has no
DescribeConfigs call"*, and its own comment says *"librdkafka's C API has rd_kafka_DescribeConfigs;
this binding simply does not wrap it, so this can come back from upstream without any change here."*
`kadm.DescribeTopicConfigs` (`kadm/configs.go:77`) is that call, confirmed working against a real
broker by KF-1. The Go section:

- rows are `{name: c.Key, value: c.MaybeValue(), detail: <source>}` sorted by `Key`, where `detail` is
  `"default"` when `c.Source == kmsg.ConfigSourceDefaultConfig` (5) and the source's own
  `String()` otherwise — matching the `default: r.detail === 'default'` contract the JSON `doc`
  already assumes (`definition.ts:77-81`);
- `Config.MaybeValue()` returns `""` for a nil or `Sensitive` value (`kadm/configs.go:36`), so a
  sensitive config renders blank rather than panicking on a nil deref;
- **`notes` becomes empty for a topic**, which is why `router.go:363`'s
  `model.ValidateObjectDefinition` nil→`[]` normalization matters here (§1.4);
- `kafka.spec.ts` 6's two assertions — `config?.rows.length === 0` and
  `topicDef.notes.some(n => /DescribeConfigs/.test(n))` — are **inverted**, not ported. §5.3.

**P58e E12 — a nonexistent topic is detected by inspecting `ListedOffsets`, not by catching an
error.** §1.7. `kadm.ListStartOffsets`/`ListEndOffsets` return `(ListedOffsets, error)` where a
missing topic produces *"a special -1 partition … with the expected error code
kerr.UnknownTopicOrPartition"* inside the map rather than a returned error
(`kadm/metadata.go:400-497`). A literal port of `try { admin.fetchTopicOffsets(topic) } catch { throw
mapError(err) }` would therefore return an **empty window set** and a blank page where
`kafka.spec.ts` 11 requires `E_QUERY`. The Go shape: call, check the returned error, **then** call
`ListedOffsets.Error()` (`kadm/metadata.go:360`, which folds every per-partition `Err` into one) and
map that too. This is the sharpest "reads correct, is wrong" hazard in the whole port and it is
invisible without the test.

**P58e E13 — the group definition loses its `type` and `partitionAssignor` rows, and this is
recorded as a small, named regression against two recoveries.** §1.7. `kadm.DescribedGroup`
(`kadm/groups.go:131-148`) has `Group`, `Coordinator`, `State`, `ProtocolType`, `Protocol`,
`Members`, `AuthorizedOperations`, `Err`, `ErrMessage` — and **no `Type`, no `PartitionAssignor`**.

- **`partitionAssignor` is not lost, it is merged.** kadm's `Protocol` is documented as *"the
  partition assignor strategy this group is using"* — the same value `definition.ts:125` renders
  under a second name. One row, `protocol`, carries it.
- **`type` (CLASSIC vs CONSUMER, KIP-848) genuinely has no kadm source.** The Group section drops
  from seven rows to five: `state`, `protocolType`, `protocol`, `coordinator`, `members`. `state`
  is now a plain string from the broker rather than a number needing `reverseLookup`, so
  `definition.ts:12-33`'s entire enum apparatus is deleted.

*Named alternative, rejected:* issue a raw `kmsg.NewListGroupsRequest()` through
`kgo.Client.Request` to read the v5+ `GroupType` field, which `kadm.ListGroups` does not surface.
Rejected for one cosmetic row: it trades a supported, versioned API for a generated protocol struct,
and `kadm` surfacing it upstream would then leave two code paths. Recorded in §10 OQ-5 so the
parent's author can overrule.

**P58e E14 — produce goes through `kgo.ProduceSync` on the adapter's long-lived client with
`kgo.DisableIdempotentWrite()`, and the whole `dr_cb`/Electron-V8-sandbox comment is deleted rather
than ported.** Four parts:

1. **`DisableIdempotentWrite()`.** §1.8. franz-go enables idempotent producing by default; librdkafka
   does not. Idempotency requires an `InitProducerId` round trip that **hangs** on a single-broker
   cluster whose `transaction.state.log.replication.factor` is Kafka's default 3 — a failure this
   repo has already been bitten by (`tests/db/support/kafka.ts:41-48`). Matching librdkafka's own
   default is the conservative choice and the one that keeps the port behaviour-preserving.
2. **`ProduceSync` is a capability gain, claimed rather than smuggled.** `produce.ts:98-107`'s comment
   concedes its cost: *"produce() below reports 'queued into librdkafka', not 'the broker
   acknowledged this specific message' — flush() still proves the whole batch drained, just not which
   messages succeeded individually."* `ProduceResults.FirstErr()` gives per-record errors and each
   successful `ProduceResult.Record` carries its assigned `Partition`/`Offset`
   (`kgo/producer.go:305-347`). `affectedRows` becomes the count of records the broker actually
   acknowledged.
3. **The 10-line Electron/`dr_cb`/`Nan::NewBuffer`/`ToLocalChecked` comment is deleted, not ported.**
   Its entire subject — a NAN addon adopting a malloc'd buffer under Electron's V8 sandbox — has no
   Go analogue whatsoever. This is one of the clearest "the migration deletes a workaround" moments
   in the phase and belongs in `AGENTS.md`'s findings entry.
4. **No separate producer client.** The TypeScript builds a fresh `Producer` per mutate because the
   compat wrapper forced `dr_cb`. In Go the adapter's own long-lived client produces directly; the
   only client that stays ephemeral is the browse consumer (**P58e E5**), for a real API reason.

**P58e E15 — `Connect` is `kgo.NewClient` + `Client.Ping(ctx)` + one `kadm.Metadata(ctx)`, and
`ConnectInfo.Details` becomes `{brokers, cluster}`.** `kgo.NewClient` opens no socket
(`kgo/client.go`), exactly like the compat `admin.connect()` that `client.ts:92-95` warns about
(*"admin.connect() alone proves nothing about broker reachability — it resolves on the 'ready' event
of a synchronously-created librdkafka handle, not a round trip"*). `Client.Ping` is franz-go's own
bounded reachability probe (`kgo/client.go:628-633`), and the `kadm.Metadata` call that follows both
proves the admin surface works and supplies the two `Details` values:

- **`cluster`** — `Metadata.Cluster` (`kadm/metadata.go:189`). **P32 D13 recorded this as permanently
  lost**; it comes back.
- **`brokers`** — `len(Metadata.Brokers)`, a **live cluster-wide count**, where `client.ts:25-30`
  could only report the configured bootstrap-address count and said so at length (*"no compat or
  native admin call exposes broker metadata … worth a real live-broker call the day it is"*). Today
  is that day.
- **`librdkafka` is dropped** — franz-go exposes no runtime version constant and inventing one would
  be worse than the honest omission. `ConnectInfo.ServerVersion` stays the literal `"Kafka"`
  (`index.ts:43`), which `kafka.spec.ts` 1 asserts and the status-bar tooltip renders.

**P58e E16 — the connection config ports option-for-option, and the sslmode security posture ports
unchanged.** `client.ts:36-107` → `kgo.SeedBrokers(host:port)`, `kgo.ClientID("kira-studio")`,
`kgo.DialTimeout(10 * time.Second)` (`CONNECT_TIMEOUT_MS`), `kgo.DialTLSConfig(&tls.Config{})` when
TLS is on, `kgo.SASL(plain.Auth{User: username, Pass: password}.AsMechanism())` when both credentials
are present. Defaults `localhost:9092`. URI mode uses `url.Parse` with the same emptiness check
`redis/client.go:36-47` and `awscfg/config.go` already use — **Go's `url.Parse` is permissive where
`new URL` throws**, so `client.ts:47`'s `if (!parsed?.host) throw` becomes a `u.Hostname() == ""`
check, which is what carries the "could not parse the connection URI" `E_QUERY`. **The sslmode
handling ports byte-identically**, including its own security note (`client.ts:75-77`): every
non-`disable` mode (`require`/`prefer`/`verify-full`) **verifies**, deliberately unlike libpq's
`require`, *"and a driver swap is the wrong commit to smuggle one into"* — which is exactly what this
commit is. An unknown sslmode keeps logging `kafka: unknown sslmode "<x>", ignoring` at `warn`.

**P58e E17 — one Go file per TypeScript file, keeping `produce.go`'s name rather than normalising it
to `mutate.go`.** **P58 D18**, **P58a A20**, **P58b B19**, **P58c C17**, **P58d D17**, applied.
`index.ts` → `adapter.go`; everything else keeps its name, **including `produce.go`** — every other
adapter's mutation file is `mutate.go`, and the temptation to rename for consistency loses the
diffability the rule exists for. Eight files: `adapter.go`, `caps.go`, `catalog.go`, `client.go`,
`definition.go`, `errors.go`, `produce.go`, `read.go`. When a Go behaviour disagrees with the
TypeScript, `kafka/read.go` and `kafka/read.ts` are the two files to put side by side.

**P58e E18 — `nativeKinds` gains `kafka` in one commit that also carries the `TestKindNodeServed`
retirement and the `tests/e2e-real/` rewrite, because splitting them means shipping a red tree.**
**P58d D19** said each kind flips in its own commit; that still holds — there is one kind. What is
different here is that two other changes are *forced by the same line*: `TestKindNodeServed`'s
contract (§1.9) and `mariadb-real.spec.ts`'s second test (§1.10) both become false the instant
`nativeKinds["kafka"]` is true. The commit message records all three and the acceptance run that
preceded them. **Ten of ten.**

**P58e E19 — `testsupport/kafka.go` uses `testcontainers-go/modules/kafka@v0.44.0`, reversing
P58d D22's precedent, with the reason written down.** §1.15. **P58d D22** chose a bare
`GenericContainer` over `modules/localstack` on three grounds; two of them apply here and one does
not, and the one that does not is decisive:

- *Applies:* the module's `go.mod` pulls graph noise for its own tests — `IBM/sarama v1.42.1` plus
  five `jcmturner` Kerberos modules. Real, and accepted.
- *Applies:* the repo's precedent is bare containers (`testsupport/redis.go`, `testsupport/localstack.go`).
- **Does not apply, and this is why the answer flips:** LocalStack is one HTTP service on one port
  with a health endpoint, so replicating `modules/localstack` was a four-line `ContainerRequest`. A
  single-node KRaft Kafka is not: it needs two listeners, a starter script that rewrites
  `KAFKA_ADVERTISED_LISTENERS` from the mapped host port *after* the container starts, a KRaft storage
  format step, and fifteen environment variables (`kafka.go:52-90`). Reimplementing that by hand is
  ~70 lines of shell-in-a-Go-string, and this repo has already lost a session to getting one line of
  it wrong (`0005_kafka_seed.ts:16-28`'s listener gotcha; `tests/db/support/kafka.ts:41-48`'s
  transaction-log replication factor — **which the Go module already sets and the TypeScript one does
  not**, `kafka.go:63`).

KF-4(a) proves it starts `confluentinc/cp-kafka:8.0.7` in this sandbox before M9.2 depends on it. The
named fallback, if the log-regex wait strategy does not match Kafka 4.0's output, is a bare
`GenericContainer` copying the module's own env map and starter script with
`wait.ForListeningPort` — taken **explicitly**, with its cost written down at the moment it is taken.

**P58e E20 — `adapterhost.TestKindNodeServed` is deleted and replaced by an exported test
constructor, `adapterhost.NewRouterAllNodeServed`, because one of its four consumers cannot use a
synthetic kind.** §1.9 is the measurement. The constraint that rules out the obvious answers:
`connections/service_test.go`'s `fieldsInput` (`:80-87`) goes through `connections.Service.Create` →
`connections/input.go:31`'s `model.ValidConnectionKind`, so a `"kira-test-node-served-kind"` literal
is rejected before the router is consulted, while `tree/service_test.go:63-70`'s raw
`INSERT INTO connections` and `adapterhost`'s two `KindLookup` fakes would accept one. The shape:

```go
// nativeKinds is complete as of P58e M9.3 — every kind is served in-process. Router keeps its own
// copy so the two consumer-side test packages that still cover the (live, P58f-deleted) Node
// forwarding path have a Router that reaches it; there is no longer any real kind that does.
type Router struct { …; native map[string]bool }

// NewRouterAllNodeServed constructs a Router that forwards EVERY kind to the Node engine child.
// Test-only, and it exists for exactly one reason: internal/connections' and internal/tree's tests
// cover connections.Service's and tree.Service's child-forwarding paths, which are still live
// shipped code until P58f's M10 collapses the two EngineBackend implementations into one. Before
// P58e there was always a real kind left to point them at (adapterhost.TestKindNodeServed, retired
// in M9.3); after it there is none. Delete this with the child.
func NewRouterAllNodeServed(deps adapters.Deps, cache *enginecache.Cache, child *enginehost.Host, conns KindLookup) *Router
```

`isNative(kind)` becomes `r.native[kind]`; the package-level `nativeKinds` map stays as the default
`NewRouter` fills from, so §4.7's flip is still a one-line edit to one table.

*Named alternatives, rejected:*
- **A synthetic kind everywhere.** Fails in `connections/service_test.go` (verified above), and
  widening `model/connection.go:47`'s validated kind set for a test is putting a test hook in
  production data validation.
- **A mutable package-level override (`adapterhost.SetNativeKindsForTest`).** Global mutable state
  reachable from four packages; the moment any of those tests gains `t.Parallel()` it is a data race,
  and `-race` is the bar (§8).
- **Deleting the four tests now.** They cover code that still ships. P58f deletes the code and the
  tests together; that is the correct commit for it.

**P58e E21 — `tests/e2e-real/mariadb-real.spec.ts`'s second test is rewritten into the all-native
survival proof, and the coexistence property is declared retired in the same commit.** §1.10 is why
this is forced rather than chosen. The rewrite keeps the file's whole vehicle — real `-tags server`
binary, real MariaDB container, real Kafka container, real `pgrep -P serverPid` + `SIGKILL` — and
changes what it proves:

| Step | Before (C1b) | After |
|---|---|---|
| connect MariaDB | native | unchanged |
| connect Kafka, expand tree, open `topic:orders` | Node-served; renders a stream page through the child's **index-keyed** chunk encoding | **native**; renders a stream page through Go's **base64** encoding — the app's first native Kafka read, and the first native `offsetWindow` page ever |
| kill the Node child | Kafka's dot → `error`, MariaDB's stays `connected` | **both stay `connected`**, and both still serve a read after `page.reload()` |
| `engine-status` | asserted `ok` in test 1 | additionally asserted **`down`** after the kill, which is what makes "the child died and nothing cared" an assertion rather than an absence |

The test is renamed (`C2: every connection survives killing the Node engine child — nothing is
Node-served any more`) and its header comment is rewritten to say that **P58 D4**'s coexistence
property was proven three times (checkpoint C1b, checkpoint C1c, and every P58d flip's sweep) and
has now expired by success. §7 explains why this rewrite is checkpoint C2's automated half.

**P58e E22 — the two packaging scripts' Kafka *messages* are corrected; their check logic is not
touched.** §1.14. `verify-packaging.sh:86`'s note currently ends *"Kafka connections will fail at
runtime in this build"* and `sign-bundle.sh:36`'s echo calls the absence *"a known gap"* — both false
from M9.3 onward. The edit replaces those clauses with a statement of the true state (the module is
unused; Kafka is served in-process by Go since P58e M9.3; the block is P58f's to delete). No `fail`
becomes a `note`, no `note` becomes a `fail`, no path changes.

*Named alternative, rejected:* leave both entirely to P58f, as the parent's §3 target tree implies.
Rejected because a packaging script that prints a false warning about a shipped build is worse than
one that prints nothing, and because P58f may be a different session weeks later. §10 OQ-4 gives the
parent's author the veto.

**P58e E23 — P58e's `src/` diff is empty, and §5.2 asserts the strong form.** `git diff --stat src/`
returns nothing at all, no exclusions — the same form **P58b B21**, **P58c C22** and **P58d D21**
asserted and met. `toTypedArray`'s base64 branch, `StreamView.vue`'s partition popover
(`:319-327`, a live second caller of `children(topicPath)` — `index.ts:69-77` explains why that call
survives even though the tree no longer expands a topic) and `streamFilter.ts`'s encoder are all
already in the tree and all already work against a native producer, because SQS proved the stream
wire path in P58d M8.2. If the diff is ever non-empty, either **P58 D1** was broken or the substrate
has a coupling no plan in this phase has found, and the implementer stops and says so.

**P58e E24 — P58e records checkpoint C2, and builds the instrument it needs, because the one the
parent names does not exist.** §7 is the whole design. In summary: the parent's C2 is *"a full manual
pass across all eleven connection kinds must leave `enginehost`'s own request counter at zero"*, and
`grep -rn "requestCount\|RequestCount" shell/internal/enginehost/` returns **nothing** — there is no
counter. §7 relocates it to `adapterhost.Router` (the only thing that routes to the child, and the
only layer that can tell an adapter-serving request from a lifecycle one), makes it emit a
`slog.Warn` naming the offending kind and op rather than only incrementing, and defines precisely
which three ops are excluded and why.

**P58e E25 — the Go seeder re-expresses `0005_kafka_seed.ts` from the host with `kadm` + `kgo`,
rather than shelling into the container, and the TypeScript's own reason for the CLI is quoted and
shown not to apply.** §1.15, and the same **P58 D12** "byte-identical dataset" weakening
**P58c C21** and **P58d D24** recorded. `0005_kafka_seed.ts`'s two reasons for the in-container CLI
were (a) keeping a JS Kafka client out of the test process (F24) and (b) not registering the consumer
group by *joining* it — *"a standing absurdity in a phase about not joining groups"*. (a) is void: the
Go test binary links franz-go by construction. (b) is preserved exactly, because
`kadm.CommitOffsets(ctx, group, offsets)` commits *"as a group outside the context of a Kafka group"*
(`kgo/config.go:1716-1718` points at it for precisely this use), producing the same
committed-offsets-with-no-members state the CLI's `--reset-offsets --to-earliest --execute` produced.
§4.6 turns every seeded shape into a checklist, and KF-4(f) cross-checks the two seeders once against
a live container.

**P58e E26 — the window arithmetic is extracted into one pure function and gets P58e's single Go unit
test.** §5.5 argues it against `AGENTS.md`'s bar rather than assuming it. Briefly: the bar names
*"cursor/pagination arithmetic with real boundary cases"* and *"a decision structure large enough that
no one can hold it in their head"*, and the window advance/clamp/`hasMore` computation is both — it
has four interacting inputs (the frozen windows, the records actually delivered, the per-partition
high watermarks, the empty-poll counter), five distinct outcomes, and **a real regression in its
history** (P43 iter2 F19/D26, whose symptom was `hasMore` stuck true forever). It is also the only
part of the adapter that is pure logic reachable without a broker. Everything else in the package is
explicitly rejected by name in §5.5.

**P58e E27 — every Go test that produces a message creates its own topic; `orders` and `empty-topic`
are read-only fixtures.** The direct analogue of **P58d D23** and **P58c C24**, and the trap is the
same shape. `kafka.spec.ts` 16 produces into `EMPTY_TOPIC` with its own comment saying why
(*"so this doesn't perturb the message-count assumptions tests 7/8/12 make about ORDERS_TOPIC"*) —
but scenarios **9 and 12 both assert `EMPTY_TOPIC` is empty**, and the only thing keeping them
correct is that `bun:test` runs the file top to bottom in one process. Go's `testing` runs top-level
tests in source order too, but nothing enforces it, and `-shuffle` or a future `t.Parallel()` breaks
it silently: scenario 9 would see 16's message and read `rowCount: 1`. Scenario 21's `gap-topic` is
already dedicated and stays so.

## 3. Target tree

```
shell/internal/adapters/
  kafka/                        NEW    M9.2  (P58e E17) 8 files, one per kafka/*.ts:
    adapter.go                  NEW          index.ts — the Adapter impl, path resolution, Cancel
    caps.go                     NEW          caps.ts — the 21-field literal, comments included
    catalog.go                  NEW          catalog.ts — root (topics ∪ groups), partitions
    client.go                   NEW          client.ts — kgo options, Ping, one long-lived client
    definition.go               NEW          definition.ts — topic (partitions + REAL configs,
                                             P58e E11) and group (5 rows, P58e E13) definitions
    errors.go                   NEW          errors.ts — kerr codes + Go net/ctx re-derivations
    produce.go                  NEW          produce.ts — sentinels, preview, ProduceSync
    read.go                     NEW          read.ts — freshWindows, the browse loop, countTopic
    read_test.go                NEW    M9.3  P58e E26's single unit test (window arithmetic)
    kafka_test.go               NEW    M9.1  the acceptance suite (lands failing, P58 D12 / R3)
    main_test.go                NEW    M9.1  TestMain -> StopKafka (P58b B15, never t.Cleanup)
  testsupport/
    kafka.go                    NEW    M9.1  modules/kafka container (P58e E19) + the Go
                                             re-expression of 0005_kafka_seed.ts (P58e E25)
  testsupport/spec.go           UNCHANGED    StreamKeyAt/HeadersAt/AttrsAt/TimestampAt/BodyAt all
                                             landed in P58d M8.1 — P58e needs no lift at all

shell/internal/adapterhost/router.go        EDITED  M9.3  nativeKinds += kafka (TEN OF TEN);
                                                    TestKindNodeServed DELETED and replaced by
                                                    NewRouterAllNodeServed (P58e E20); the
                                                    child-route counter + slog.Warn (P58e E24, §7)
shell/internal/adapterhost/integration_test.go  EDITED M9.3  P58e E20
shell/internal/adapterhost/dataframe_test.go    EDITED M9.3  P58e E20
shell/internal/tree/service_test.go             EDITED M9.3  P58e E20
shell/internal/connections/service_test.go      EDITED M9.3  P58e E20
shell/main.go                               EDITED  M9.3  the tenth blank import — §4.7's
                                                    most-forgotten step
shell/go.mod / go.sum                       EDITED  M9.1/M9.2  + franz-go, franz-go/pkg/kadm,
                                                    franz-go/pkg/kmsg (runtime);
                                                    + testcontainers-go/modules/kafka (test-only,
                                                    P58e E19 — reverses P58d D22's precedent)

shell/internal/{page,enginecache,enginebackend}/**  UNCHANGED  §1.4 — deliberately, not by omission
shell/internal/adapters/{sqltext,sqlmutate,abort,caps,errors,registry,live,adapter}.go  UNCHANGED
shell/internal/{oplog,enginehost,storage,bridge,shell,appcore}/**  UNCHANGED
src/**                                              UNCHANGED  P58e E23 — every file

tests/e2e-real/mariadb-real.spec.ts         EDITED  M9.3  the second test rewritten (P58e E21).
                                                    THE FIRST tests/e2e-real/ CHANGE IN THE PHASE
tests/e2e-real/support/kafka.ts             UNCHANGED  a 3-line re-export; its subject survives
tests/db/kafka.spec.ts                      DELETED M9.4 last commit (P58 D12)
tests/db/support/kafka.ts                   UNCHANGED  two live consumers (§1.11) — KEPT
tests/db/fixtures/0005_kafka_seed.ts        UNCHANGED  two live consumers (§1.11) — KEPT
tests/db/support/page.ts                    UNCHANGED  readStream becomes dead; three other
                                                    exports still live (§1.11)
tests/ipc/**                                UNCHANGED  §1.11 — the generator port is P58f's
tests/ui/**                                 UNCHANGED  P58a A10
package.json                                UNCHANGED  test:db still invokes the script

scripts/run-db-tests.sh                     EDITED  M9.4  collapses to `bun test tests/db`
                                                    (P58e E19's sibling; deletion is P58f's)
scripts/verify-packaging.sh                 EDITED  M9.4  one message string (P58e E22)
scripts/sign-bundle.sh                      EDITED  M9.4  one message string (P58e E22)

docs/ARCHITECTURE.md                        EDITED  the Stack line's "only kind still Node-served";
                                                    the mapping table's Kafka Cancel cell; the whole
                                                    Kafka per-engine section; the S3 section's
                                                    "only Kafka is left for P58e" (§8 criterion 8)
docs/v1/plans/P58e-kafka.md                 EDITED  §12 M9.0 results, then §13 M9.1-M9.4 results
AGENTS.md                                   EDITED  the P58e findings entry; the "Native Kafka
                                                    driver" section, whose subject is gone
```

## 4. Designs

### 4.1 `client.go` — options, not a property map

`client.ts`'s single `RdConfig` record of raw librdkafka properties becomes typed `kgo.Opt`s. The
whole of `client.ts:9-17`'s comment about *"one config vocabulary in this file instead of two"* and
its three `as never` casts evaporates: franz-go has one option vocabulary and it is type-checked.

| `client.ts` property | Go |
|---|---|
| `bootstrap.servers` | `kgo.SeedBrokers(net.JoinHostPort(host, strconv.Itoa(port)))` |
| `client.id: 'kira-studio'` | `kgo.ClientID("kira-studio")` |
| `socket.connection.setup.timeout.ms: 10_000` | `kgo.DialTimeout(10 * time.Second)` |
| `security.protocol: plaintext \| ssl \| sasl_plaintext \| sasl_ssl` | the cross product of `kgo.DialTLSConfig(&tls.Config{})` and `kgo.SASL(...)`, set independently — franz-go has no single protocol enum, which removes a four-way string switch |
| `sasl.mechanism: 'PLAIN'` + `sasl.username`/`sasl.password` | `kgo.SASL(plain.Auth{User: u, Pass: p}.AsMechanism())` |

`connect(ctx, cfg, log) (*kgo.Client, *kadm.Client, error)`:

1. resolve host/port/username/password from URI or fields mode (**P58e E16**), defaulting
   `localhost:9092`;
2. resolve `options.sslmode` with the same three-value accept list and the same `warn` log line;
3. `kgo.NewClient(opts...)` — **no I/O yet**;
4. `cl.Ping(ctx)` — the bounded reachability probe that turns a wrong host/port into `E_CONNECT`
   here rather than at the first tree expansion (`client.ts:92-95`'s own reason, unchanged);
5. `adm := kadm.NewClient(cl)` (`kadm/kadm.go:118`);
6. on any failure, `cl.Close()` before returning the mapped error — the direct analogue of
   `client.ts:98`'s `admin.disconnect().catch(() => {})`, and the P13 D2 discipline
   `router.go:120-122` already applies from the other side.

`Disconnect` is `cl.Close()`; `kgo.Client.Close` is idempotent-safe against a nil receiver guard the
adapter keeps.

### 4.2 `catalog.go` — one metadata call answers three questions

| Function | Ports | Key points |
|---|---|---|
| `listRoot` | `catalog.ts:15-18` | topics ∪ groups as **root-level siblings**, in that order, each sorted by name. `catalog.ts:12-14`'s reason ports with it (*"a consumer group can span many topics, or none of the ones currently browsed, so nesting it under one topic would misrepresent it"*). The TypeScript runs both halves under `Promise.all`; the Go port runs them sequentially — two round trips either way, and an `errgroup` for two calls on one connection buys latency this tree level does not need |
| `listTopics` | `catalog.ts:23-49` | `adm.Metadata(ctx)` → `Topics.FilterInternal()` (**P58e E10**) → one `model.TreeNode` per topic with `Kind: "topic"`, `HasChildren: false` (P23 D3), and `Detail: abbreviateCount(len(t.Partitions)) + " partition(s)"`. **`abbreviateCount` has no Go home yet** — `src/shared/format.ts`'s K/M/B/T abbreviation is renderer-side. Grep first: if no Go analogue exists in `internal/`, it is ~12 lines local to `catalog.go`, and the plan says so rather than discovering it (a partition count reaching 1 000 is possible on a real cluster, so `fmt.Sprintf("%d", n)` is not equivalent) |
| `listGroups` | `catalog.ts:51-70` | `adm.ListGroups(ctx)` → filter `strings.HasPrefix(name, "__")` → `Kind: "consumerGroup"`, `HasChildren: false`, sorted |
| `listPartitions` | `catalog.ts:72-92` | `adm.Metadata(ctx, topic)` → `TopicDetails[topic].Partitions.Sorted()` (`kadm/metadata.go:50`, already partition-ordered) → `Kind: "partition"`, name `strconv.FormatInt(int64(p.Partition), 10)`, two-segment path. **This call must survive** even though the tree never expands a topic — `index.ts:69-77` records that `StreamView.vue`'s partition-filter popover is a second live caller re-fetching on every open, and that *"deleting this the way P19's D5 deleted column enumeration would break that filter"* |

Sorting: `catalog.ts` uses `a.name.localeCompare(b.name)`. The Go port uses `sort.Strings`-equivalent
byte ordering, matching what every other native adapter already does — a divergence only for names
differing by locale collation, which Kafka topic names (`[a-zA-Z0-9._-]`) cannot exhibit. Recorded,
not probed.

### 4.3 `read.go` — the browse, precisely

The largest file, and the one whose design **P58e E9** and **KF-3** govern.

**`freshWindows(ctx, adm, topic, rawFilter)`** ports `read.ts:76-143`:

1. `starts, err := adm.ListStartOffsets(ctx, topic)`; `ends, err := adm.ListEndOffsets(ctx, topic)` —
   two calls where librdkafka's `fetchTopicOffsets` was one. **Then `ListedOffsets.Error()` on each**
   (**P58e E12**), which is what turns a nonexistent topic into `E_QUERY`.
2. `CheckCancelled(ctx)`.
3. Parse the filter. `parseKafkaStreamFilter`'s Go port is a `json.Unmarshal` into
   `struct{Offset *string; Partitions []int32; TimestampMs *int64}` with a zod-equivalent shape check;
   any failure is `E_QUERY "malformed stream filter"` byte-identically (`read.ts:94`).
4. Partition narrowing: a non-empty `Partitions` selects a **union**; an empty result is
   `E_QUERY "topic <t> has no partition(s) <joined>"`, byte-identical including the `", "` join.
5. `timestampMs` wins over `offset`: `adm.ListOffsetsAfterMilli(ctx, ms, topic)` reseeds every
   selected partition's start. **The one semantic difference to re-baseline:** kadm's own doc says
   *"If a partition has no offsets after the requested millisecond, the offset will be the current end
   offset"*, where librdkafka returned a sentinel. That makes the partition's window empty rather
   than full-range — arguably more correct, and KF-4(c) prints the real answer before §5.3's
   scenario 19 asserts anything.
6. Otherwise `offset` is `strconv.ParseInt`d (a failure is `E_QUERY "malformed offset filter: \"<x>\""`,
   byte-identical) and **clamped into `[low, high]` per partition** (`read.ts:130-135`).
7. Returns `[]partitionWindow{Partition int32; Next int64; End int64}`.

**`readTopic(ctx, cl, adm, topic, req, op)`** ports `read.ts:193-319`:

```
1.  req.Cursor.Mode == "before" -> E_UNSUPPORTED
      "kafka offset-window pagination is forward-only; there is no previous page"   (byte-identical)
2.  fingerprint := RequestFingerprint(struct{Topic; PageSize; Filter}{...})          (P58e E7)
3.  windows := (Mode == "after") ? decode(req.Cursor.Token, fingerprint)
                                 : freshWindows(...)
4.  remaining := windows where Next < End
    if len(remaining) == 0 -> NewStreamPageBuilder(nil).Finish(position(windows, false, ...))
                              -- NO CLIENT IS EVER CONSTRUCTED (read.ts:212-215)
5.  CheckCancelled(ctx)
6.  op.SetCommand("browse <topic> (<n> partition(s) of <m>)")                        (Adapter rule 3)
7.  browse, err := kgo.NewClient(baseOpts..., kgo.ConsumePartitions(...at exact offsets),
                                 kgo.FetchMaxWait(1*time.Second))                    (P58e E5)
    defer browse.Close()
8.  loop while collected < pageSize && !allDone() && !allEof():
      CheckCancelled(ctx)
      fetches := browse.PollRecords(ctx, pageSize-collected)
      if err := fetches.Err(); err != nil { ... }                                    (P58e E3)
      fetches.EachPartition(record HighWatermark per partition)
      if fetches.NumRecords() == 0 { emptyPolls++; if >= 2 break; continue }
      emptyPolls = 0
      for each record: window-check (offset in [Next, End)), push, Next = offset+1
9.  CheckCancelled(ctx)
10. clamp: for each provably-drained partition, Next = End                           (P58e E9)
11. hasMore := any(Next < End); Finish(position(windows, hasMore, fingerprint, pageSize))
```

Row construction, per `read.ts:281-291`, with **P58e E8** applied:

| Cell | Source | Note |
|---|---|---|
| `Key *string` | `nil` when `r.Key == nil`, else `Strp(strings.ToValidUTF8(string(r.Key), "�"))` | a nil key is a real `null`, not `""` — the null/empty distinction `page/chunk.go` is careful about |
| `Headers string` | `json.Marshal` of `map[string]any` built by the `headersToPlain` port | **P58e E8**; repeated key → `[]string` |
| `Attrs string` | `{"partition": <int32>, "offset": "<decimal>"}` | the number/string asymmetry ports verbatim |
| `Timestamp *string` | `nil` when `r.Timestamp.IsZero()`, else `r.Timestamp.UTC().Format("2006-01-02T15:04:05.000Z07:00")` | **P58d D11**'s exact-three-fractional-digits format, because this is a cell value a user reads and `tests/ipc/kafka/kafka.fixture.ts` freezes one. Never `time.RFC3339Nano`, which drops trailing zeros |
| `Body string` | `strings.ToValidUTF8(string(r.Value), "�")`, `""` when `r.Value == nil` | `read.ts:290`'s own `: ''` fallback — an empty body is `""`, not null |

`ObjectDefinition.GeneratedAt` follows the six existing native adapters (`time.Now().UTC().Format(
time.RFC3339Nano)`), **not** the TypeScript — **P58d D11**'s split, applied unchanged.

**`countTopic`** ports `read.ts:323-337`: `ListStartOffsets` + `ListEndOffsets`, `Error()` on each,
then `sum(high - low)` across every partition as an `int64`, `Exact: true`. Go's `int64` removes the
`Number(BigInt(high) - BigInt(low))` narrowing the TypeScript had to accept.

**`position(windows, hasMore, fingerprint, pageSize)`** ports `read.ts:52-66` exactly:
`{Offset: nil, PageSize: pageSize, HasMore: hasMore, NextToken: <token or nil>, PrevToken: nil,
Strategy: "offsetWindow"}`. The first `offsetWindow` position any native adapter has ever emitted.

### 4.4 `definition.go` — where two capability recoveries land

**Topic** (`definition.ts:35-97`):
- `adm.Metadata(ctx, topic)` → `Partitions.Sorted()` → the **Partitions** section, rows
  `{Name: "<p>", Value: "leader <n>", Detail: "replicas 1,2 · isr 1,2"}` — the `·` separator and the
  `,`-join port byte-identically, since `kafka.spec.ts` 6 asserts `/^leader \d+$/` on the value.
- `adm.DescribeTopicConfigs(ctx, topic)` → the **Configuration** section, now populated
  (**P58e E11**). `ResourceConfigs.On(topic, fn)` (`kadm/configs.go:62`) is the safe accessor;
  a `ResourceConfig.Err` degrades to an empty section **plus a note**, reusing the same
  "a missing section must not fail the whole tab" shape `definition.ts:58-64` already describes for
  the ACL-denied case — which stops being permanent and becomes ACL-dependent again, as the
  TypeScript's own comment hoped.
- `statements[0]` is the `{partitions: [...], config: [...]}` JSON, 2-space-indented
  (`json.MarshalIndent`). Note Go sorts map keys where `JSON.stringify` uses insertion order — the
  doc here is built from **structs and slices**, not maps, so field order is the struct's and the
  divergence **P58d D17**'s SQS `definition.go` row had to record does not arise.

**Group** (`definition.ts:99-195`):
- `adm.DescribeGroups(ctx, groupID)` → `DescribedGroups.On(groupID, ...)`; a missing group is
  `E_NOT_FOUND "consumer group not found: <id>"` byte-identically (`definition.ts:113`).
- **Group** section, five rows (**P58e E13**): `state` (already a string), `protocolType`, `protocol`,
  `coordinator` (`host:port`), `members` (count). The `|| '—'` em-dash fallback for empty strings
  ports verbatim — it is what the renderer shows for an unset value.
- **Members** section: `{Name: m.ClientID, Value: m.ClientHost, Detail: m.MemberID}`, in
  `DescribedGroup.Members`' own order (kadm documents it as sorted by `InstanceID` or `MemberID`).
- **Committed offsets** section: `adm.FetchOffsets(ctx, group)` in its own error scope, so *"a group
  with read access but no offset-fetch permission still shows its Group/Members sections rather than
  failing the whole load"* (`definition.ts:144-145`). Rows are `{Name: "<topic>[<p>]", Value:
  "<offset>"}`, sorted by topic then partition (`OffsetResponses.Sorted()`, `kadm/groups.go:759`).
  On failure, `notes = ["Committed offsets could not be read."]`, byte-identical.

### 4.5 `produce.go` and `adapter.go`

**`produce.go`** ports `produce.ts` with the four **P58e E14** changes:
- `$key`/`$body`/`$headers` sentinels and `assertInsert`'s message
  (*"kafka only supports producing new messages (insert)"*) port byte-identically;
- `parseHeaders`'s three error messages port byte-identically (`malformed $headers JSON`,
  `$headers must be a JSON object of string values`, `$headers.<k> must be a string`);
- `Preview` is **synchronous, no network, no catalog lookup** (Adapter rule 3), rendering
  `producer.produce('<topic>', null, Buffer.from(...), '<key>' | null)` verbatim — the string is a
  user-visible preview and changing it to a franz-go-shaped call would be a behavioural rewrite the
  parent's §0.2 forbids. §10 OQ-6 raises whether it *should* eventually change;
- `Mutate` calls `AssertWritable(readOnly)` **first** (`produce.ts:96`: *"enforced here, not only
  greyed out in the UI"*), `op.SetCommand(strings.Join(preview, ";\n"))` second, then builds one
  `*kgo.Record` per op and issues **one** `ProduceSync` for the whole batch;
- `affectedRows` counts acknowledged records; `ProduceResults.FirstErr()` fails the whole mutation.

**`adapter.go`** ports `index.ts`:
- `Connect` → §4.1, `ConnectInfo{ServerVersion: "Kafka", Details: {"brokers": …, "cluster": …}}`
  (**P58e E15**);
- `Children`: empty path → `listRoot`; `consumerGroup` root → `[]model.TreeNode{}` (Adapter rule 5,
  and `index.ts:61-62` names the rule explicitly); a non-`topic` non-`consumerGroup` root →
  `E_NOT_FOUND "unexpected root path segment kind: <k>"`; one-segment `topic` → `listPartitions`;
  anything deeper → `[]`;
- `Describe` → `Unsupported(kind, "describe")` — `caps.describe` is false (P31 D2);
- `Definition` → topic or group, else `E_NOT_FOUND "definition requires a topic or consumer group
  path, got: <encoded>"`;
- `Read`/`Count` → `resolveTopicTarget`, whose message ports verbatim
  (`read requires a topic path, got: <encoded>`);
- `Execute` → `NoQueryConsole(kind)` (`caps.sql` false, P10 D13);
- `DownloadObject` → `Unsupported(kind, "file transfer")`;
- `Cancel` → `false`, permanently, with the comment extended to name **P58e E3**.

### 4.6 `testsupport/kafka.go` — the container and the seed checklist

One `startKafka()` on `modules/kafka.Run(ctx, "confluentinc/cp-kafka:8.0.7")` (**P58e E19**), one
`fixture[T]` memo, an exported `StartKafka(t)` with the `IsDockerAvailable` gate, and an exported
`StopKafka()` called from `main_test.go` **after `m.Run()` — never `t.Cleanup`**, for the reason
`fixture.go`'s package doc gives (**P58b B15**: *"Go runs that cleanup the instant that test returns,
so a fixture documented as 'one container per test binary' actually restarted per test function"*).

**P58e E25's cost, made concrete.** `0005_kafka_seed.ts` is a TypeScript function, not a `.sql` file,
so the Go seeder re-expresses it. The checklist, so it is a table rather than a memory:

| Shape | `0005_kafka_seed.ts` | Go seeder (`kadm` + `kgo` from the host) |
|---|---|---|
| `orders` topic | 2 partitions, replication factor 1 | `adm.CreateTopics(ctx, 2, 1, nil, "orders")` |
| `empty-topic` | 1 partition, RF 1, never written | same, never produced to |
| `orders` messages | **6**, each `source:seed` header + key `key-<i>` + body `{"seq":<i>}` | 6 `*kgo.Record{Topic, Key: []byte("key-<i>"), Value: []byte(`{"seq":<i>}`), Headers: [{Key:"source", Value:[]byte("seed")}]}` through one `ProduceSync`. **> one partition's worth deliberately**, *"so browsing genuinely spans both"* (`0005:8`) |
| `kira-test-group` | registered with committed offsets and **no members**, via `--reset-offsets --to-earliest --execute` | `adm.CommitOffsets(ctx, "kira-test-group", offsetsAtStartFor("orders"))` (**P58e E25**) — same state, still no group join |
| exported constants | `ORDERS_TOPIC`, `EMPTY_TOPIC`, `ORDERS_PARTITION_COUNT=2`, `ORDERS_MESSAGE_COUNT=6`, `CONSUMER_GROUP` | `KafkaOrdersTopic`, `KafkaEmptyTopic`, `KafkaOrdersPartitionCount`, `KafkaOrdersMessageCount`, `KafkaConsumerGroup` |
| **new, P58e E27** | — | a `CreateTopic(t, name)` helper + a side `*kgo.Client` so every producing test gets its own topic |
| **new, scenario 21** | `gap-topic`, created and written **transactionally** inside the spec, not the seed | the acceptance suite creates it with `kgo.TransactionalID` + `BeginTransaction`/`EndTransaction`, driving the driver under test exactly as `kafka.spec.ts:696-738` drives its own. **The container's `KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1` is what makes this possible** and the Go module sets it (§1.15) |

**The cross-check that buys back most of what P58e E25 costs**, nearly free because KF-4 already has a
container up: start the TypeScript fixture (`sh scripts/run-db-tests.sh` brings one up) and the Go
fixture side by side once, and diff the two topic inventories (names, partition counts, per-partition
start/end offsets) and one message's full `headers`/`attrs` cell text. Recorded in §12 as a probe
result, not repeated per run.

### 4.7 The router flip, and what else it touches

`nativeKinds` is the whole mechanism (P58 §4.6). Enumerated so the implementer checks each rather
than trusting "the router handles it" — and for Kafka the list is **longer than any previous
sub-phase's**, because it is last:

- **Control plane** — `connections.{Test,Connect,Disconnect,Remove}` and
  `tree.{Children,Describe,Definition}` start reaching `adapterhost.Host` for kafka. Nothing to write.
- **Data plane** — kafka's pages start arriving base64-encoded and `toTypedArray`'s first branch
  handles them. SQS already proved the `StreamPage` wire path in P58d M8.2, so this is the second
  stream producer, not the first — but it is **the first `offsetWindow` position ever to cross the
  wire from Go**, which `views/stream/`'s pager reads (`data-pagination`). §5.6's sweep is not
  optional.
- **Cancel** — routes on op ownership, not kind (**P58a A13**). A flip changes nothing here, but
  `Router.Cancel`'s child fallback (`router.go:400-413`) survives and §7 counts it.
- **`connections.MarkAllErrored`** — **P58a A15**'s narrowing now excludes **every** kind (§1.9).
  Not dead, but a no-op.
- **`adapterhost.TestKindNodeServed`** — deleted in this same commit (**P58e E20**), touching four
  test files.
- **`tests/e2e-real/mariadb-real.spec.ts`** — rewritten in this same commit (**P58e E21**).
- **`cache:stats`** — **P58a A16**'s merge is unchanged; the child keeps reporting its own (empty)
  stats and the Router keeps summing them until P58f.
- **`shell/main.go`** — the tenth blank import. §8 makes it a per-milestone acceptance check.

## 5. Testing plan

### 5.1 What survives untouched

- **`tests/ui/`** entirely — both wire planes mocked; **P58a A10** holds.
- **`tests/ipc/`** entirely — all three halves of all seven adapters, `kafka` included. §1.11 records
  the cost of that being true: after M9.3, **every one of the seven `*.backend.spec.ts` files drives a
  TypeScript adapter that serves nothing in the real app**, which is the state **P58 D13**'s generator
  port exists to end, in P58f.
- **`tests/unit/`** entirely. Nothing in P58e has a TypeScript unit-test subject that moves.
- **`package.json`.** `test:db` invokes `scripts/run-db-tests.sh`, whose contents change but whose
  name and behaviour-for-the-caller do not.
- **`tests/e2e-real/postgres-real.spec.ts`** and **`sqlite-real.spec.ts`** — unchanged; only
  `mariadb-real.spec.ts`'s second test moves.

### 5.2 The `src/` non-change, asserted in its strong form

Every milestone from M9.1 onward ends with `git diff --stat src/` returning **empty** — no exclusion
(**P58e E23**). If it is ever non-empty the implementer stops and says so rather than absorbing it.

### 5.3 The Kafka Go tier

`shell/internal/adapters/kafka/kafka_test.go`, driven by `testcontainers-go` against
`confluentinc/cp-kafka:8.0.7`, seeded per §4.6. `tests/db/kafka.spec.ts` is **776 lines, 21
scenarios** (`grep -c "^  test('"`). How each ports:

| | Count | Scenarios |
|---|---:|---|
| **Ports as-is** | 13 | 1, 3, 4, 5, 7, 8, 9, 10, 12, 13, 14, 15, 16 |
| **Re-baselined against the Go driver, never loosened** | 4 | 11 (`E_QUERY` via **P58e E12**, and a new message), 19 (`ListOffsetsAfterMilli`'s different no-record-after answer), 20 (**P58e E6** — the int64 boundary), 21 (**P58e E9**'s clamp instead of `partition.eof`) |
| **Inverted, because the capability came back** | 1 | 6's Configuration half (**P58e E11**) |
| **Collapses to a caps assertion** | 1 | 2 |
| **Rewritten, with a reason** | 2 | 17 and 18 — see below |

**Six cases carry more weight than the rest**, and §8 requires each by name:

| Test | Why |
|---|---|
| **a browse creates no consumer group** (17, rewritten) | **The parent's §5.3 names this as one of only two tests it adds beyond the ported list**: *"a browse never creates group state (`ListGroups` is unchanged before and after) — kafka — P10 D6's promise, made structural by P32 and re-proven against a different client."* The TypeScript pages `orders` in full and then asserts the group list still holds exactly `CONSUMER_GROUP`. The Go version tightens it to the parent's own wording: snapshot `adm.ListGroups(ctx)` **before**, page `orders` to exhaustion at `pageSize: 2`, snapshot **after**, and assert the two sets are equal — a stronger assertion than "the seeded group is still the only one", because it also catches a browse that *deletes* or *mutates* group state. KF-1 already proved the property holds for franz-go by construction; this is the regression guard that keeps it true if someone ever adds `kgo.ConsumerGroup(...)` to §4.3's option list |
| **a browse commits no offsets** (18, rewritten) | Same phase-promise half. The TypeScript asks the adapter for `definition(groupPath('kira-studio-browse'))` and accepts either `E_NOT_FOUND` or a group with no `orders[...]` rows. The Go version drops the adapter from the loop and asks the broker directly — `adm.FetchOffsets(ctx, "kira-studio-browse")` — asserting either a group-not-found `kerr` or an empty `OffsetResponses`. Going below the adapter matters: the TypeScript version would pass even if `buildGroupDefinition` had a bug that hid rows |
| **the transaction commit-marker gap still terminates** (21, re-baselined) | P43 iter2 F19/D26, and **P58e E9**'s whole subject. Creates `gap-topic`, produces one record inside a franz-go transaction (`kgo.TransactionalID` + `BeginTransaction`/`EndTransaction`), then pages to exhaustion with a bounded guard loop and asserts `rowCount == 1`, `hasMore == false`, `nextToken == nil`. **The assertion that fails against a naive port** is the third one: without the clamp, `Next` stops one behind `End` (the commit marker's offset counts toward the watermark but is never delivered) and `hasMore` stays true forever. This is the single most important test in the suite and the only one whose subject is a previously-shipped bug |
| **the Configuration section has real rows and no "not available" note** (6, inverted) | **P58e E11**, and the phase's promised capability recovery. Asserts the section is non-empty, that a known key is present (`cleanup.policy` or `retention.ms` — KF-4(f) picks one the container actually reports), and that `notes` contains **nothing** matching `/DescribeConfigs/`. The TypeScript asserts the exact opposite in both halves, so this cannot be a port |
| **`ConnectInfo.Details` carries a real cluster id and a live broker count** (1, extended) | **P58e E15**, and P32 D13's recovery. Ports scenario 1 verbatim (`serverVersion == "Kafka"`, `details["brokers"]` non-empty, disconnect, then `children` → `E_CONNECT`) and adds `details["cluster"] != ""` — the assertion that proves the recovery landed rather than being claimed in a doc |
| **an already-cancelled context aborts the browse** (15, ported) plus **a mid-browse cancellation** (new) | **P58e E3**. Scenario 15 only covers an *already*-cancelled context, which never reaches `PollRecords`. The new case is the one **P58e E3** exists to keep correct and the one KF-2 alone cannot reach: start a browse of `orders` at `pageSize: 6` on a goroutine against a `context.WithCancel`, cancel once the first records land, assert `E_CANCELLED` and that the call returns within a bound well under `FetchMaxWait`. Direct analogue of P58a's `pg_sleep(30)` test and P58d's mid-stream download case |

**P58e E27** governs every producing case: scenario 16's produce-then-browse round trip creates its
own topic, never `empty-topic`.

**Two scenarios that look portable and are not, flagged so nobody ports them by reflex:**

- **Scenario 11's 20-second timeout.** Its own comment says the allowance was *"carried over from
  kafkajs's equivalent … unverified in this sandbox (no Docker)"* — a librdkafka metadata-retry
  budget. franz-go's own retry behaviour is governed by `kgo.RetryTimeout` (`kgo/config.go:916`) and
  is a different number. KF-4(d) measures the real latency and the Go test's timeout is set from that,
  not copied.
- **Scenario 20's `Number.MAX_SAFE_INTEGER` token.** **P58e E6**. Re-baselined to the int64 boundary,
  with a comment recording that the `E_UNSUPPORTED` branch was removed as a gain.

### 5.4 What P58e deliberately does not test

- **The `tests/ipc/kafka/` fixtures against the Go producer.** §1.11 — **P58 D13**'s job, P58f's
  milestone. Doing the last of seven early would leave two generators in the tree for one sub-phase
  and would regenerate a fixture (`kafka.fixture.ts`, 367 lines, with two documented freezes: the
  coordinator `host:port` and `sortStreamByKey`) that P58f has to regenerate again anyway.
- **An `E_AUTH` round trip.** The container is `PLAINTEXT` with no ACLs; producing a real
  `SaslAuthenticationFailed` needs a SASL-configured broker, and producing a
  `TopicAuthorizationFailed` needs ACLs enabled. Neither TypeScript nor Go has such a scenario today.
  The mapping ports on `kerr`'s own named codes (**P58e E4**) and the gap is recorded (§10 OQ-7), not
  papered over. **This is the same disposition P58d OQ-4 took for SQS/S3** and it is now the second
  adapter family with an untested `E_AUTH` branch.
- **A multi-broker cluster.** Every `replicas`/`isr` assertion runs against a single broker, so the
  Partitions section's `replicas 1 · isr 1` is degenerate. A three-broker testcontainers network is
  possible and is not worth it for one definition row; the TypeScript never did it either.
- **TLS.** `kgo.DialTLSConfig` is exercised by no test in either language. **P58e E16** ports the
  posture unchanged and says so.
- **Packaging.** No bundle change; **P58e E22** touches two strings and no check.

### 5.5 Unit-level, against `AGENTS.md`'s own bar — exactly one test qualifies

**P58e adds one Go unit test.** P58d added none and said why; P58c added two (its parsers). The
reasoning here is neither, and it is worth doing in the open because "one" looks like a compromise
and is not.

**What qualifies: the window arithmetic (`read.go`'s `advanceWindows`), extracted for the purpose
(P58e E26).** The bar names *"cursor/pagination arithmetic with real boundary cases"* and
*"a decision structure large enough that no one can hold it in their head"*. This function has:

- **four inputs that interact** — the frozen `[]partitionWindow`, the records actually delivered in
  this poll, the per-partition `HighWatermark`s observed this poll, and the empty-poll counter;
- **five outcomes that are all reachable and all different** — every window drained (`hasMore` false,
  no token); some drained (`hasMore` true, token); a partition provably at end-of-log with a *gap*
  inside `[next, end)` (clamp fires, `hasMore` may become false); an empty poll with no end-of-log
  evidence (do **not** clamp — `read.ts:304-305`'s explicit asymmetry); a partition absent from the
  fetch entirely (leave it alone);
- **a real regression in its history** — P43 iter2 F19/D26, whose symptom (`hasMore` stuck true
  forever, every later browse re-hitting EOF for zero rows) is exactly what a table-driven test
  catches and what an acceptance test catches only for the one transaction shape scenario 21 builds.

The test is table-driven over the five outcomes plus the two boundaries (`next == end` on entry;
`HighWatermark` exactly equal to `End` versus one below it), with a comment above it naming the rule
it guards, per the bar's own instruction.

**Candidates considered and rejected by name, so nobody re-proposes them:**

- **`headersToPlain`'s repeated-key promotion** (string → `[]string`). Three branches over a slice;
  the bar's own exclusion (*"a branch is not complexity"*). Pinned instead by an exact-string
  acceptance assertion on a seeded message's `headers` cell.
- **The offset clamp in `freshWindows`** (`requested < low ? low : requested > high ? high :
  requested`). Two comparisons; pinned by scenarios 19's and 20's own assertions.
- **`mapError`'s dispatch** (**P58e E4**). A closed set of `errors.As`/code comparisons — the bar's
  *"single bad-input → single-error paths"*. Pinned by scenarios 11 and 15 against a real broker,
  which is the only place the real error values exist.
- **Page-token encode/decode.** `sqltext.go:61-91`'s, already covered by P58a M1's own tests.
- **`abbreviateCount`'s Go port** (§4.2). If it turns out to need writing, it is a five-line loop
  whose output is asserted byte-exactly by the tree-node `detail` assertion in scenario 4 — the same
  disposition **P58d D15** took for S3's `formatBytes`.

### 5.6 `tests/e2e-real/` — the one file that changes, and the sweep that runs after the flip

**One spec changes, and it is forced.** §1.10, **P58e E21**. This is the first `tests/e2e-real/`
change in the whole of P58 — P58a, P58b, P58c and P58d each asserted the tier unchanged and each
met it. P58e cannot, and the reason is not that this plan is less disciplined but that the property
the file tests **ceases to exist** in M9.3's commit.

**The full suite still runs after the flip**, per `AGENTS.md`'s P58b M6.4 finding, restated as this
sub-phase's rule:

> A `tests/e2e-real/*.spec.ts` regression sweep must be re-run in full after every `nativeKinds`
> flip, not just for the kind that just went native, because a shared code path —
> `adapterhost.Router` above all — is common to every native adapter.

M9.3 ends with `postgres-real.spec.ts` (2 tests), `sqlite-real.spec.ts` and the **rewritten**
`mariadb-real.spec.ts` (2 tests) green, including their `expect(consoleErrors).toEqual([])`
assertions. The sweep after this particular flip is the one most likely to find something, for a
reason worth naming: it is the first sweep in which **no** connection in the app is served by the
Node child, so any path that silently depended on the child answering — `cache:stats`' merge
(**P58a A16**), `MarkAllErrored`, `Router.Cancel`'s fallback — runs in a configuration it has never
run in before.

## 6. M9.0 — three probes, and why not five

Three throwaway Go programs under the scratch directory (**never committed; no product code lands in
M9.0**), each answering one question with a printed PASS/FAIL. The deliverable is a findings section
appended to this document (§12) and, for anything surprising, an `AGENTS.md` entry.

**Why three and not five.** §1.3 is the ledger. P58d's M8.0 ran five probes because **nothing** about
its two adapters' driver had been exercised in this repo: the container, the request shape, the
credential model, the checksum default and the cell rendering were all open. P58e's driver has
already been run against a real `confluentinc/cp-kafka:8.0.7` broker in this repo, in P58a's own M0,
against a probe list **P58 D7** wrote specifically for it — and it passed on every point, including
the two capability recoveries. Re-running `ConsumePartitions`-creates-no-group would be the third
time that claim is established (once in the parent's research, once in KF-1). The parent's **R4**
(*"M0 before M5, and specifically M0's Kafka probe before P58e is planned"*) has already been
satisfied; running it again would satisfy a ceremony, not the rule.

What *is* open is the set of questions KF-1 did not ask, and each of the three probes below maps to
one row of §1.3's "not asked" block. They are written against `AGENTS.md`'s hardest-won lesson, from
P58b M6.3: *"an M6.0-style probe is only as complete as the specific inputs it tried."* KF-3 and
KF-4 are therefore **input inventories**, not capability checks.

Ordering: KF-4(a) first (everything else needs a container), then KF-2, then KF-3, then the rest of
KF-4.

| Probe | What it runs | Asserts | If it fails |
|---|---|---|---|
| **KF-2 (cancellation)** — the load-bearing one | Against a seeded broker: **(a)** a browse client built with `kgo.ConsumePartitions` at the start of a topic with more records than one fetch returns; call `PollRecords(ctx, n)` on a `context.WithCancel` cancelled after 300 ms mid-loop; print how soon it returns, whether `fetches.Err()` is non-nil, whether `errors.Is(fetches.Err(), context.Canceled)` holds, and what `fetches.Err0()` reports; **(b)** the same with the ctx cancelled *before* the first poll; **(c)** `adm.ListEndOffsets(ctx, topic)` with ctx cancelled after 50 ms, printing `%T` and whether `errors.Is(err, context.Canceled)` survives kadm's own wrapping; **(d)** call `cl.Close()` from a second goroutine mid-`PollRecords` and print whether the injected fetch carries `kgo.ErrClientClosed`; **(e)** repeat (a) 20 times and print the max return latency | (a) the loop unblocks **promptly** — under ~50 ms, not at `FetchMaxWait` — and the error is reachable through `Fetches.Err()`, which is **P58e E3**'s entire premise; (b) the pre-cancelled path is caught by `CheckNotStarted` before any client is built; (c) admin calls surface a *returned* error, so the mapper sees it; (d) `defer cl.Close()` racing a live loop produces `ErrClientClosed`, not a spurious `E_QUERY`; (e) no flake | **(a) failing is a stop and raise.** It would mean Kafka has no effective cancellation in Go where it had one in TypeScript, and `caps.cancel: true` becomes a lie — the same standard **P58d D3**'s AWS-1(e) was held to. The named remediation, taken **explicitly**: close the browse client from a `ctx.Done()` watcher goroutine, accept that this is `RunWithAbortRace`-shaped, and write the cost down. (c) failing changes **P58e E4**'s first branch to a string test, which is worse and must be recorded as such |
| **KF-3 (end-of-log and the commit-marker gap)** | Build `gap-topic` (1 partition) and produce **one** record inside a franz-go transaction (`kgo.TransactionalID`, `BeginTransaction`, `ProduceSync`, `EndTransaction(ctx, TryCommit)`). Then: **(a)** `adm.ListStartOffsets`/`ListEndOffsets` — print low and high (the high should be **2**: one record plus one commit marker); **(b)** a browse client at offset 0 with `FetchMaxWait(1s)`; poll repeatedly and, for **every** poll, print `fetches.NumRecords()`, and for every `FetchTopicPartition` seen, print `Partition`, `len(Records)`, `HighWatermark`, `LastStableOffset`, `LogStartOffset` and `Err`; **(c)** keep polling five more times after the record is delivered and print whether the partition still appears in the fetch at all; **(d)** the same experiment on an **ordinary** fully-read partition (no transaction), for the contrast; **(e)** the same on a partition with a compacted hole, if it can be produced cheaply — otherwise record it as not reproduced | **(b)/(c) are the fork P58e E9 turns on.** Either franz-go returns a `FetchPartition` with `len(Records) == 0` and `HighWatermark >= End` for the drained-with-a-gap partition — in which case the clamp fires on the `HighWatermark` test as designed — or it stops returning the partition entirely, in which case the clamp must key off `LastStableOffset` observed on the *last* fetch that did include it, or off the empty-poll counter alone. (a) confirms the high watermark really is one past the delivered record, which is the whole premise of P43 iter2 F19/D26 | Neither answer is a failure — both are designs. What **is** a failure is neither signal being available, which would leave `MAX_EMPTY_POLLS` as the sole terminator and **reintroduce a previously-fixed bug**. In that case §4.3 grows an explicit `ListEndOffsets` re-check at the end of a browse whose windows did not drain, and the extra round trip is written down against **P58e E9** |
| **KF-4 (container and input inventory)** | **(a)** `modules/kafka.Run(ctx, "confluentinc/cp-kafka:8.0.7")` in this sandbox, mirror-retagged (**already namespaced — no `library/` prefix**); time it, confirm the `wait.ForLog(".*Transitioning from RECOVERY to RUNNING.*").AsRegexp()` matches Kafka 4.0's output, and confirm no ulimit problem; **(b)** the Go seeder from §4.6 end to end, then `adm.Metadata`, `ListGroups`, `DescribeGroups`, `DescribeTopicConfigs`, `FetchOffsets` — printing **every** field of each, including which config keys the container reports and what `Config.Source` values appear; **(c)** `ListOffsetsAfterMilli` at three timestamps: before every record, between two, and after all — printing each partition's returned `Offset` and `Timestamp`, especially for the "no record after" case; **(d)** `ListStartOffsets`/`ListEndOffsets` on a topic that does not exist — print the returned error, the `ListedOffsets` map contents, `ListedOffsets.Error()`'s value, `%T`, and **the wall-clock latency**; also check `adm.Metadata(ctx)` afterwards to see whether the topic was **auto-created** by the attempt; **(e)** `ProduceSync` with and without `kgo.DisableIdempotentWrite()`, printing the returned `Partition`/`Offset` per record and the latency of the first produce each way; **(f)** produce one record with a String header and print the Go `headers`/`attrs` cell text beside the TypeScript adapter's for the same message; **(g)** `kgo.NewClient` + `Ping` against an unreachable host:port, printing `%T`, message and latency | (a) the fixture **P58e E19** depends on starts here; (b) the inventory §5.3's assertions are written against, rather than guessed — **specifically which config key to assert in the inverted scenario 6**; (c) settles §4.3 step 5 and scenario 19's re-baseline; (d) settles **P58e E12** against a live broker (the map-inspection path) *and* scenario 11's timeout *and* the auto-creation hazard — if a failed offsets listing auto-creates the topic, the fixture is polluted and `kgo.AllowAutoTopicCreation` must be confirmed default-off; (e) settles **P58e E14**'s idempotency call and prints the `InitProducerId` cost; (f) is **P58d D8**'s cross-check in its Kafka form — expected to show **no** divergence (§1.8), and the probe's job is to prove that rather than assume it; (g) settles **P58e E4**'s `E_CONNECT` branch and **P58e E15**'s probe latency | (a) failing → the bare-`GenericContainer` fallback named in **P58e E19**, taken explicitly with its cost written down. (d) showing auto-creation → set `kgo.AllowAutoTopicCreation` off explicitly and record it as a new decision. (e) showing idempotency succeeds here anyway → **keep `DisableIdempotentWrite` regardless**, because the container sets `KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1` and a user's cluster does not (§1.8) — a green probe does not discharge that risk, and the plan says so in advance so nobody "simplifies" the option away |

## 7. Checkpoint C2 — P58e owns it, and the instrument it names does not exist

P58 §0.3 defines two checkpoints. **Checkpoint C1** (after M5) was recorded by P58a, extended by
P58b as **checkpoint C1b** and re-run by P58c as **checkpoint C1c**. **Checkpoint C2** has never been
run, and it is defined as:

> **C2 — the zero-traffic proof.** Before M10 (the deletion milestone) starts, a full manual pass
> across all eleven connection kinds must leave `enginehost`'s own request counter at **zero** — the
> Node child is spawned, idle, and answers nothing. Deleting a sidecar that is still being called by
> a kind nobody remembered is the one failure this phase can make that looks fine in every test and
> breaks a real user's connection.

The parent's **R1** is unambiguous: *"nothing in M10 starts before C2 is recorded."* M10 is P58f's
first milestone; M9 is the last milestone before it. **P58e is therefore the sub-phase that owes
checkpoint C2**, and it is also the first sub-phase in which C2 can possibly pass — before M9.3,
Kafka is Node-served and the counter can never be zero.

Unlike P58b's and P58c's checkpoints, this is not a checkpoint this plan invents. It is one the
parent declared and left unassigned by name, and P58e is where the assignment lands by construction.

### 7.1 The instrument does not exist, and three requests survive the flip

`grep -rn "requestCount\|RequestCount\|Requests()" shell/internal/enginehost/` returns **nothing**.
There is no counter in `enginehost`, and the parent's one-line C2 definition does not survive
contact with the code in two further ways:

**First, `enginehost` is the wrong layer.** `Host.Call`/`CallTimeout` (`host.go:291-298`) and
`Host.SendData` are transport primitives that cannot tell an adapter-serving request from a
lifecycle one. The discrimination lives one layer up, in `adapterhost.Router`, which is the **only**
thing in the process that routes anything to the child.

**Second, three request paths survive M9.3 and are not adapter traffic**, so a literal
"counter at zero" is unreachable even in a perfectly migrated app. Traced for this plan:

| Surviving path | Where | Why it is not adapter traffic |
|---|---|---|
| `"ping"` | `dataframe.go:61-63` — **always** forwards to the child (**P58a A17**) | `src/renderer/workbench/state/engine.ts:13-24`'s `initEngineState` issues **exactly one** per app boot or `page.reload()`, with **no timer**. It is what paints the status bar's `engine` indicator; it says nothing about any connection |
| `"cache:configure"` | `enginehost/config.go:16-18` via `Router.PushCacheConfig` (`router.go:75-80`) | Called once at startup (`main.go:145`) and on every settings save (`bridge/settings.go:36`). A cache budget push, not a connection |
| `"cache:clear"` | `dataframe.go:70` — answered locally **and** forwarded | User-initiated, kind-agnostic (**P58a A16**) |
| `adapter:cancel` fallback | `router.go:400-413` — an opID the Go scheduler does not own is forwarded unconditionally | **This one is genuinely ambiguous.** After M9.3 the Go scheduler owns every op, so the fallback should never fire — which makes it *exactly* the kind of thing C2 should catch if it does. It counts |

So the honest form of the check is **"zero adapter-serving requests"**, not "zero requests", and the
excluded three must be named rather than quietly not counted. **P58e E24** states this and §10 OQ-2
puts it to the parent's author.

### 7.2 The design

`adapterhost.Router` gains one unexported helper and one exported reader, ~10 lines total, deleted by
P58f along with the child:

```go
// noteChildRoute records that a request reached the Node engine child on behalf of a real
// connection — the thing checkpoint C2 (P58 §0.3) must observe zero of before P58f's M10 deletes
// the sidecar. It deliberately does NOT count the three kind-agnostic paths that survive a fully
// native app: "ping" (A17, one per boot, paints the status bar), "cache:configure" (settings), and
// "cache:clear" — none of them belongs to a connection, and none of them is what a forgotten kind
// would look like. The slog line names the kind and the op because "the counter is 3" is not
// actionable and "connection kind X still routes adapter:children to the child" is.
func (r *Router) noteChildRoute(op, kind string) {
    r.childRoutes.Add(1)
    slog.Warn("adapterhost: routed a connection request to the Node engine child",
        "scope", "adapterhost", "op", op, "kind", kind)
}

// ChildRoutes reports how many connection-scoped requests have reached the Node child in this
// process's lifetime. Checkpoint C2's instrument; zero is the passing value.
func (r *Router) ChildRoutes() int64 { return r.childRoutes.Load() }
```

Called from all seven connection-scoped child paths: `connectViaChild`, `testViaChild`,
`disconnectViaChild`, `childrenViaChild`, `describeViaChild`, `definitionViaChild`, `Cancel`'s
fallback, and `forwardToChild` **only** when reached from `HandleDataFrame`'s connection-scoped
branch (`dataframe.go:80-83`) — not from the `ping`/`cache:clear` cases above it.

`childRoutes` is an `atomic.Int64` on the `Router` struct, which already carries a mutex for a
different purpose (`statsMu`, **P58a A16**) and is documented as such — this one needs no mutex and
should not borrow that one.

### 7.3 Running it, in two halves

**The automated half is `tests/e2e-real/mariadb-real.spec.ts`'s rewritten second test
(P58e E21).** That is not a coincidence and it is why the rewrite is a gain rather than a
consolation: the file that used to prove *"a Node-served kind dies with the child"* becomes the file
that proves *"no kind dies with the child, because none of them uses it"*. Killing the child and
observing that both connections keep serving reads **is** the zero-traffic property, observed from
the outside, on a real built binary. It runs in CI-shaped conditions and it runs on every future
sweep.

**The manual half is the pass the parent describes**, recorded in §13 with *"not available in this
session"* written out rather than implied, per the parent's §6 discipline:

1. Start the app (`-tags server`), with `slog` at `warn` or below, log captured to a file.
2. For **each of the ten kinds**, in one session: create a connection, connect it, expand its tree
   one level, open one object, and disconnect. `sqlite` needs no container; the other nine need
   `postgres:17`, `mariadb:11.4`, `mysql:8.4`, `clickhouse/clickhouse-server:26.3`, `mongo`,
   `redis:7`, `localstack/localstack:3` (×2, sqs and s3) and `confluentinc/cp-kafka:8.0.7` — all
   mirror-pulled per `AGENTS.md`'s Docker section. **Where a container cannot be brought up in the
   session, that kind is recorded as unavailable rather than skipped silently**, because an
   unexercised kind is precisely the failure C2 exists to catch.
3. Additionally exercise the three paths a per-kind pass misses: a **cancel** (press stop on a long
   read), a **settings save** (cache budget), and a **cache clear**.
4. `grep -c 'routed a connection request to the Node engine child' <logfile>` → **0**.
5. Confirm the child was in fact alive throughout (`engine-status` reads `ok`, `pgrep -P <serverPid>`
   is non-empty) — a zero count from a child that never started proves nothing.

Step 5 is the one a careless run gets wrong, and it is why the check is "spawned, idle, and answers
nothing" rather than "answers nothing".

### 7.4 Why P58e declares no new checkpoint of its own

P58b added **checkpoint C1b** on the grounds that it was *"the half of C1 that P58a could not run"*;
P58c added **checkpoint C1c** because it was the sub-phase that broke C1b's own vehicle; P58d added
none and said so. P58e **also breaks C1b's vehicle** (§1.10) — but the property that vehicle proved
is not one a later run can re-establish, because it has expired: after M9.3 there is no Node-served
kind to coexist with. Manufacturing a "checkpoint C1d" for a proof that can no longer be constructed
would be worse than ceremony; it would be dishonest. **Checkpoint C2 is what replaces it**, and it is
the checkpoint the parent already declared for exactly this moment.

## 8. Acceptance criteria

**Per milestone**

- **M9.0** — all three probes have a recorded PASS, or a recorded FAIL with its consequence taken
  explicitly (§6). **No product code committed.** **P58e E3**'s premise (KF-2(a)) and **P58e E9**'s
  clamp signal (KF-3(b)/(c)) are either confirmed or corrected in writing before M9.2 starts.
- **M9.1** — `cd shell && go test ./... -race` green with **`nativeKinds` unchanged**;
  `testsupport/kafka.go` present with `StartKafka`/`StopKafka` and every constant §4.6's checklist
  names; `kafka_test.go` and `main_test.go` present and **failing** for the right reason (no adapter
  registered), per **P58 D12** / its **R3**; **`grep -rn 'TestKindNodeServed' shell/internal` still
  shows `"kafka"`** (M9.1 moves nothing); `git diff --stat src/` empty.
- **M9.2** — `go test ./internal/adapters/kafka/ -race` green against a real container, or explicitly
  recorded as Docker-unavailable; **`nativeKinds` still does not contain `kafka`** (the flip is
  M9.3's); §5.3's six called-out cases all present and passing; §5.5's single unit test present;
  `git diff --stat src/` empty; `git diff --stat tests/` empty.
- **M9.3** — `nativeKinds` contains `kafka`, reaching **ten of ten**; **`shell/main.go` has the tenth
  blank import** (§4.7's most-forgotten step); `grep -rn 'TestKindNodeServed' shell/` returns
  **nothing** and all four consumers compile against `NewRouterAllNodeServed` (**P58e E20**);
  `tests/e2e-real/mariadb-real.spec.ts`'s second test rewritten (**P58e E21**) and **the full
  `tests/e2e-real/` suite green** (§5.6); `Router.ChildRoutes()` and its `slog.Warn` present
  (**P58e E24**); the whole existing suite (`bun run lint`, `bun run typecheck`, `bun run test:unit`,
  `bun run test:go`, `bun run test:ui`, `bun run test:ipc:fe`) green; `git diff --stat src/` empty.
- **M9.4** — **checkpoint C2 recorded** (§7), with each of the ten kinds marked pass or explicitly
  unavailable and the `grep -c` result quoted; `tests/db/kafka.spec.ts` deleted, and
  `tests/db/support/kafka.ts` + `fixtures/0005_kafka_seed.ts` **kept** after a re-grep whose result is
  recorded either way (**P58 D12**, §1.11); `scripts/run-db-tests.sh` reduced to its Bun half
  (**P58e E19**); the two packaging message strings corrected (**P58e E22**); the docs edits below.

**Phase-level**

1. `bun run lint`, `bun run typecheck` (all four projects), `bun run test:unit`, `bun run test:go`,
   `bun run test:ui`, `bun run test:ipc:fe` are green.
2. `cd shell && go test ./... -race` is green. **`-race` is the bar, not plain `go test`** — and in
   P58e it earns its keep for a reason no previous sub-phase had: **the browse client is created,
   consumed and `Close()`d on the op's goroutine while a `PollRecords` may be in flight**, and §5.3's
   new mid-browse cancellation case deliberately races a cancel against a live fetch. `-race` is what
   catches a teardown ordering mistake there.
3. **`git diff --stat src/` is empty.** Not "empty except one file" — empty (**P58e E23**).
4. **`git diff --stat tests/ui tests/ipc` is empty**, including every `*.fixture.ts` (§1.11, §5.1).
   `tests/e2e-real/` is **not** in this list, for the first time in the phase, and §5.6 says why.
5. `git diff --stat shell/internal/page shell/internal/enginecache shell/internal/enginebackend
   shell/internal/enginehost` is empty (§1.4 — the substrate and the sidecar transport both needed
   nothing).
6. The whole `git diff --stat` scope, enumerated in advance so a surprise is visible:
   - **`shell/internal/adapters/`** — one new directory (`kafka/`), `testsupport/` grown by one file
     and **no edited file** (P58d M8.1 already built the stream readers).
   - **`shell/internal/adapterhost/`** — `router.go` (`nativeKinds`, the `TestKindNodeServed`
     retirement, `NewRouterAllNodeServed`, the C2 counter) plus two `_test.go` files.
   - **`shell/internal/{tree,connections}/`** — one `_test.go` each, **P58e E20** only.
   - **`shell/main.go`** — one blank import. **`shell/go.mod`/`go.sum`** — three franz-go modules
     plus one test-only testcontainers module.
   - **`tests/db/`** — one spec deletion, **no support or fixture deletion**.
   - **`tests/e2e-real/`** — one spec, one test inside it.
   - **`scripts/`** — three files, message strings and one script body.
   - **`docs/`, `AGENTS.md`** — per §3.
   - **`src/`, `tests/ui/`, `tests/ipc/`, `package.json`, `.github/`** — nothing.
7. `AGENTS.md` gains a **"P58e implementation findings"** entry on the P52–P58d pattern, carrying at
   minimum: M9.0's three probe results; whether KF-2(a) confirmed that a cancelled `context.Context`
   really unblocks an in-flight `PollRecords` promptly and through `Fetches.Err()` rather than a
   returned error (**P58e E3**'s premise); which signal KF-3 showed franz-go actually gives for the
   commit-marker gap, and therefore which branch of **P58e E9** landed; the two silent behaviour
   changes §1.8 names (**idempotent producing on by default**, and **`string([]byte)` not replacing
   invalid UTF-8 where `Buffer.toString('utf8')` did**); the **`TestKindNodeServed` retirement's real
   constraint** (one of four consumers goes through `model.ValidConnectionKind`, so a synthetic kind
   was not an option — the general lesson being *the last kind to go native is where a
   "definitely-not-native" placeholder finally costs something, and the cost is a test constructor,
   not a rename*); the collection of P58d's own predicted debt, quoted; and **the fact that the
   `AGENTS.md` "Native Kafka driver" section's whole subject is gone** — that section is **rewritten,
   not left**, per the parent's §8 criterion 11.
8. `docs/ARCHITECTURE.md` is updated, and **criterion 8 is phrased as a grep rather than as a prose
   claim**, because the prose form failed twice before P58d made it mechanical (§1.12):
   - `grep -n "only kind still Node-served\|@confluentinc/kafka-javascript\|librdkafka\|native NAN addon\|AbortSignal" docs/ARCHITECTURE.md`
     returns **nothing outside the Testing section's historical `tests/ipc/` note** — i.e. the Stack
     line (`:48-49`), the mapping table's Kafka Cancel cell (`:104`) and the whole **Kafka** per-engine
     section (`:263-281`) are all rewritten;
   - `grep -n "only Kafka is left for P58e" docs/ARCHITECTURE.md` returns **nothing** (`:315`, the S3
     section's own forward reference);
   - the mapping table's **Kafka** row's Cancel cell reads the Go mechanism (no server-side kill; the
     op's own `context.Context` on every `kadm`/`kgo` call; `caps.cancel` stays `true` because that
     surface is genuinely effective) — the same shape the SQS and S3 rows got in P58d;
   - a new **Kafka (Go-native as of P58e M9)** section names: franz-go + kadm and why (**P58 D7**);
     that the browse still never joins a group and that this is now **structural rather than
     configured** (`Subscribe` is simply never called); **the two recovered capabilities**
     (`DescribeConfigs` → a real Configuration section; cluster id → `ConnectInfo.details.cluster`)
     and the one lost row (**P58e E13**); the idempotency default (§1.8); and that
     `caps.canUpdate`/`canDelete` stay permanently false for the same protocol reason as before;
   - the **Stack** driver line names franz-go and no longer lists a Node-served kind.
9. This document gains its own **§12 M9.0 results** and **§13 M9.1–M9.4 results** sections, the way
   P58a's, P58b's, P58c's and P58d's §12/§13 record what actually happened — **including checkpoint
   C2's own per-kind table** and including any decision that turned out wrong.
10. **`AGENTS.md`'s "Native Kafka driver — building and testing in this environment (P32, resolved
    P57)" section is rewritten or deleted**, because after M9.3 there is no native addon in any path
    the app takes. Its two remaining true statements (Bun cannot load the addon; a native npm package's
    install script may silently not run) belong elsewhere or nowhere: the first is only about
    `tests/db/kafka.spec.ts`, which M9.4 deletes; the second is a general npm fact whose only subject
    in this repo is the package P58f removes. **Recording the deletion is part of criterion 7.**

## 9. Sequencing

Five milestones, in order, with the commits inside each. The parent's hard rules apply unchanged: its
**R2** (the substrate lands before any adapter) is already satisfied and P58e adds no substrate; its
**R3** (an adapter's Go tests land and fail before its implementation) is encoded in M9.1/M9.2's
commit lists; its **R4** (probes before the work they inform) is why M9.0 is first; its **R1**
(nothing in M10 before checkpoint C2) is why M9.4 exists at all and is what makes it P58e's last
milestone rather than P58f's first.

**M9.0 — probes** *(no commits to `shell/`)*
1. `docs: record P58e M9.0 probe results` — this document gains §12; **P58e E3**'s premise and
   **P58e E9**'s clamp signal are confirmed or corrected in writing.

**M9.1 — the fixture and the failing suite** *(`nativeKinds` unchanged throughout)*
2. `test(kafka): a container fixture with the seeded orders/empty topics and a consumer group` —
   `testsupport/kafka.go` (**P58e E19**, **P58e E25**) plus a trivial connectivity test proving the
   seed matches §4.6's checklist. `shell/go.mod` gains `testcontainers-go/modules/kafka` here.
3. `test(kafka): the Go acceptance suite, against a real cp-kafka container` — `kafka_test.go`,
   `main_test.go`, **failing** (**P58 D12** / its **R3**), including §5.3's six called-out cases.
   `shell/go.mod` gains the three franz-go modules here, because the suite's own fixture and
   scenario 21's transactional producer import them. **Full `go test ./... -race` runs here**,
   `nativeKinds` untouched.

**M9.2 — the adapter**
4. `feat(kafka): client, connect and the topic/group catalog` — `client.go`, `errors.go`, `caps.go`,
   `catalog.go`, and `adapter.go`'s connect/disconnect/children. Carries **P58e E15**'s two
   capability recoveries and **P58e E16**'s security-posture port; the commit whose `Ping`-then-
   `Metadata` probe decides whether a wrong host is `E_CONNECT` or a silent success.
5. `feat(kafka): browse a topic at explicit offsets, and count it` — `read.go`. **The commit to
   review hardest in this milestone.** Carries **P58e E5** (the ephemeral browse client),
   **P58e E3** (the `Fetches.Err()` contract), **P58e E7** (the int64 token), **P58e E8** (the three
   UTF-8 cells), **P58e E9** (the clamp) and **P58e E12** (the missing-topic map inspection). First
   `offsetWindow` position Go has ever produced.
6. `test(kafka): the window-advance arithmetic` — `read_test.go`, **P58e E26**. Landed immediately
   after its subject rather than before it, deliberately: unlike an acceptance suite, a unit test over
   a pure function extracted *for* the test has nothing to fail against until the function exists,
   and **P58 D12**'s test-first rule is about adapter behaviour against a real server, not about
   every Go file.
7. `feat(kafka): topic and consumer-group definitions` — `definition.go`. Carries **P58e E11**'s
   recovered Configuration section and **P58e E13**'s reduced Group section.
8. `feat(kafka): produce a message` — `produce.go`. Carries **P58e E14**, including
   `DisableIdempotentWrite` and the deleted Electron/`dr_cb` comment.

**M9.3 — the flip, and the two placeholders**
9. `refactor(adapterhost): retire TestKindNodeServed ahead of the last flip` — **P58e E20**, landed
   **immediately before** the flip rather than in the same commit as it. This is the one place this
   plan splits what §0.3 called an atomic change, and the reason is that the constant's replacement is
   a pure refactor that must be green **on its own**: `NewRouterAllNodeServed` with `nativeKinds`
   still missing `kafka` behaves identically to today for all four consumers, so the commit proves
   the new constructor works before the flip removes the old constant's meaning.
10. `feat(adapterhost): serve kafka in-process — ten of ten` — `nativeKinds += kafka`, `main.go` += the
    tenth blank import, `mariadb-real.spec.ts`'s second test rewritten (**P58e E21**), and the C2
    counter/`slog.Warn` (**P58e E24**). **Full `tests/e2e-real/` sweep runs here**; the commit message
    records it, the acceptance run, and the first native Kafka read in the real app.

**M9.4 — checkpoint C2, the deletions, the docs**
11. `test: delete tests/db/kafka.spec.ts, its subject now in Go` (**P58 D12**) — **re-grep
    `support/kafka.ts`'s and `0005_kafka_seed.ts`'s consumers first**; both are expected to stay
    (§1.11). Also `scripts/run-db-tests.sh` reduced to its Bun half (**P58e E19**), which is the same
    commit because the script's Node half exists only for the file being deleted.
12. `chore(packaging): the Kafka native-module note is no longer true` — **P58e E22**, two strings.
13. `docs: P58e findings — the last adapter, and checkpoint C2` — `AGENTS.md` (including the
    rewritten/deleted "Native Kafka driver" section, criterion 10), `docs/ARCHITECTURE.md` (per §8
    criterion 8's grep form), and this document's §12/§13 **including checkpoint C2's per-kind
    table**.

**Why the fixture and the suite are one milestone rather than two.** P58d split them (M8.1's shared
lifts, then M8.2/M8.3's per-adapter suites) because the lifts had two consumers and had to land
before either. P58e has one adapter, one fixture and one suite, and no lift at all — splitting them
would produce a milestone whose only content is a container starter with nothing to start it for.

**Why checkpoint C2 is its own milestone rather than an acceptance bullet on M9.3.** Three reasons,
in order of weight. It needs the full ten-kind manual pass, which takes a session's worth of
containers and cannot be a line item. It is the parent's own gate on P58f (**R1**), so it needs a
commit that can be pointed at. And its result is a **table with per-kind pass/unavailable entries**
that §13 has to carry — the same "record 'not available in this session' rather than leaving it
implied" discipline the parent's §6 requires and that P58a's own C1 table modelled.

## 10. Open questions for the parent plan's author

Each of these affects P58f as much as P58e, or records a predecessor plan's claim that the tree
contradicts. None is silently resolved; where P58e needs a working assumption to proceed it is stated
as *interim* and marked reversible.

**OQ-1 — P58b's four `tests/db/*.spec.ts` deletions are still outstanding, three sub-phases later,
and after M9.4 they are the *only* thing left in the directory.** §1.12.
`tests/db/{clickhouse,mariadb,mysql,sqlite}.spec.ts` are all still in the tree at `1065518`; P58a's,
P58c's and P58d's own deletions all landed. P58c raised this as its OQ-1 and P58d carried it forward
as its own. The question is now materially different from the one they asked: after M9.4,
`bun run test:db` runs four container suites against TypeScript adapters serving no real connection,
**with nothing else in the directory**, and `scripts/run-db-tests.sh` is a one-line wrapper around
them. The parent's author still owns the choice between (a) *"each sub-phase deletes its own"* — which
is what P58e does (**P58 D12**), (b) *"P58e deletes all five"*, and (c) *"amend P58 D12's third rule;
every remaining `tests/db/*.spec.ts` retires in P58f alongside `src/engine/`"*. **P58e interim: (a).**
Note that (c)'s never-written-down argument — a still-passing TypeScript spec is a live oracle to diff
a Go port against — is **weakest here of anywhere**, because `kafka.spec.ts` cannot run under
`bun test` at all and needs the vendored Node plus an esbuild bundle to be an oracle (§1.15).

**OQ-2 — checkpoint C2's own definition needs amending, and P58e amends it interim.** §7. The
parent's C2 says *"leave `enginehost`'s own request counter at zero"*; there is no such counter
(`grep` returns nothing), `enginehost` cannot tell adapter traffic from lifecycle traffic, and three
kind-agnostic request paths survive a perfectly migrated app — `ping` (**P58a A17**, one per boot),
`cache:configure` (startup + every settings save) and `cache:clear`. **P58e interim: relocate the
instrument to `adapterhost.Router`, count only connection-scoped requests, emit a `slog.Warn` naming
the kind and op rather than only incrementing, and record the exclusions explicitly.** If the
parent's author wants the literal form, the alternative is to make those three paths not reach the
child at all — which is a real design change to **P58a A17** (`ping` is what paints the status bar's
engine indicator) and should be scoped as its own piece of work, not absorbed here.

**OQ-3 — `tests/e2e-real/mariadb-real.spec.ts`'s coexistence half necessarily retires, and P58e picks
its replacement rather than deleting the test.** §1.10, **P58e E21**. **P58 D4**'s coexistence
property was proven three times (checkpoint C1b, checkpoint C1c, and both P58d flips' sweeps) and
cannot be proven a fourth time, because after M9.3 there is nothing left to coexist with. **P58e
interim: rewrite the second test into the all-native survival proof** — kill the child, assert both
connections stay `connected` and still serve reads, and assert `engine-status` flips to `down` — which
doubles as checkpoint C2's automated half (§7.3). The alternative is deleting the test outright and
leaving C2 entirely manual; the parent's author may prefer that if P58f is going to delete the file
anyway, but a session between M9.4 and M10 with no automated zero-traffic evidence is exactly the
window **R1** exists to close.

**OQ-4 — who owns the packaging scripts' Kafka blocks, and when.** §1.14, **P58e E22**. The parent's
§3 assigns the *deletion* to P58f (`sign-bundle.sh EDITED … Kafka note deleted`), but two message
strings become **factually false** at M9.3 — `verify-packaging.sh:86`'s *"Kafka connections will fail
at runtime in this build"* and `sign-bundle.sh:36`'s *"a known gap"*. **P58e interim: correct the two
strings, change no check logic, leave the blocks.** The parent's author may prefer that a sub-phase
never touch another's files; if so, say so, because the alternative is a packaging run printing a
false warning about a shipped build for however long P58f takes. Separately: the parent's §6 manual
row *"A Kafka connection in a packaged build … the first time this has ever been verifiable in a
packaged bundle"* is now satisfiable on macOS and is **not** claimed by P58e, which has no macOS box.

**OQ-5 — the group definition loses its `type` row, and the plan chose not to reach past kadm for
it.** §1.7, **P58e E13**. `kadm.DescribedGroup` has no `Type` field; the CLASSIC-vs-CONSUMER
(KIP-848) distinction `definition.ts:116-117` deliberately added is available only through a raw
`kmsg.ListGroupsRequest` v5+ response field that kadm does not surface. **P58e interim: drop the row,
merge `partitionAssignor` into `protocol` (they name the same value), and record it as a small,
named regression offsetting two recoveries.** If the parent's author considers the row load-bearing —
its own comment calls it *"exactly where 'classic vs KIP-848 consumer protocol' … belong[s]"* — the
honest vehicle is ~15 lines of `kgo.Client.Request` against a generated protocol struct, and it
should be scoped as its own piece of work rather than smuggled into the port.

**OQ-6 — `preview()`'s rendered text still names an API that will not exist after P58f.**
`produce.ts:46-50` renders `producer.produce('<topic>', null, Buffer.from(...), '<key>')` — a
node-rdkafka call signature. **P58e interim: port it byte-identically**, because the parent's §0.2
forbids behavioural rewrites and a mutation preview is a user-visible string that
`tests/ipc/kafka/kafka.fixture.ts` may freeze. But after P58f no such call exists anywhere in the
repo, and the string becomes archaeology. The parent's author should decide whether P58f re-renders
it (e.g. `ProduceSync <topic> key=<key>`) and, if so, record it against **P58 D13**'s fixture
regeneration so the two land together rather than the fixture diffing on a string nobody meant to
change.

**OQ-7 — Kafka joins SQS and S3 as an adapter with an untested `E_AUTH` branch, and P58e does not
add one.** §5.4. The `cp-kafka` container runs `PLAINTEXT` with no ACLs; producing a real
`kerr.SaslAuthenticationFailed` needs a SASL-configured broker and a `TopicAuthorizationFailed` needs
ACLs enabled. Neither language's suite has such a scenario today, and **P58d OQ-4** took the same
disposition for the AWS pair. **P58e interim: port the mapping on the strength of `kerr`'s own named
codes (KF-4 prints the real shapes for the branches that *are* reachable), record the gap in
`AGENTS.md`, and add no test.** If the parent's author wants the gap closed, the cheapest honest
vehicle is a second container customizer enabling SASL/PLAIN in one scenario, and it should be scoped
as its own piece of work — noting it would then close the gap for *one* of the three adapters that
have it.

**OQ-8 — P58a's KF-1 did not record how it started its container, which is the one thing this plan
had to re-derive rather than inherit.** §1.3. `P58a-substrate-postgres.md` §12 says the probes ran
*"against `postgres:17-alpine` and `confluentinc/cp-kafka:8.0.7` (both pulled via `mirror.gcr.io` and
retagged)"* but not whether the Kafka container came from `testcontainers-go/modules/kafka`, a bare
`GenericContainer`, or a hand-run `docker run`. Since `shell/go.mod` has no testcontainers Kafka
module and the probe was a throwaway scratch module, the tree cannot answer it. **P58e interim:
KF-4(a) re-establishes it.** Recorded not as a criticism but as a process note worth adopting: a
probe's *harness* is as much a result as its assertions, and a future M-point-zero should record the
container mechanism alongside the finding — the cost is one sentence and it saved nothing here.

**OQ-9 — after P58e the Node engine child spawns, runs, and serves nothing, and `engine-status` still
reads `ok`.** §0.2 and §7. This is the correct state (the parent's **R1** requires the sidecar to
survive until checkpoint C2 is recorded, and P58f's M10 deletes it), but it means shipping a build —
if any ships between M9.4 and M10 — whose status bar advertises a healthy engine that answers exactly
one `ping` per boot. **P58e interim: change nothing.** The parent's author should confirm that no
release is expected in that window; if one is, the honest minimum is a one-line change to the status
bar's tooltip, which is a `src/` change and therefore outside **P58e E23**'s strong form and outside
this sub-phase.

## 11. Environment notes for the implementing session

- **A fresh container has none of the toolchain.** Go, plus
  `apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev pkg-config` for anything that builds
  `internal/shell` or the root `main` package. `./internal/adapters/...` needs none of it — franz-go
  is pure Go — so the fast loop for the whole of M9.1–M9.2 is `go test ./internal/adapters/kafka`
  and never `./...`. Only M9.3's `tests/e2e-real/` sweep and M9.4's checkpoint C2 need the headers.
- **Docker**: `nohup dockerd > /tmp/dockerd.log 2>&1 & disown` here; `colima start` on macOS. P58e's
  adapter work needs exactly **one** image: **`confluentinc/cp-kafka:8.0.7`**, which is **already
  namespaced**, so it mirrors at `mirror.gcr.io/confluentinc/cp-kafka:8.0.7` with **no `library/`
  prefix** — `AGENTS.md`'s Docker section uses this exact image as its own worked example of that
  rule. M9.3's sweep additionally needs `mariadb:11.4` and `postgres:17` (both official →
  `library/`). **Checkpoint C2 (M9.4) needs all nine container-backed kinds' images**, which is the
  largest image set any single milestone in this phase has required; budget a session for it and
  pull them in one pass.
- **Kafka is slow to start.** `tests/db/support/kafka.ts:21` allows 120 s and the Go module's own
  post-start hook waits on a log regex with no explicit timeout beyond testcontainers' default.
  Budget accordingly, and remember the module's start is **two-phase** — the container starts, then a
  `PostStarts` hook copies a starter script and *then* waits for readiness (`kafka.go:76-90`), so a
  "container started" log line is not readiness.
- **`sh scripts/run-db-tests.sh` is the only way to run the TypeScript Kafka spec**, and it is worth
  exactly one run before writing the Go successor — but it is **not** the cheap live oracle the four
  previous sub-phases recommended (§1.15). It needs `scripts/vendor-node.sh` (for
  `shell/runtime/node/bin/node`) plus an esbuild bundle, and `bun test tests/db/kafka.spec.ts` does
  not work at all. If the session's budget is tight, skip it: KF-4(f)'s cell diff is the part that
  actually matters and it is cheaper.
- **`go test ./... -race` is the bar**, not `go test ./...`. §8 criterion 2 gives P58e's own reason:
  the browse client's create/consume/`Close()` lifecycle runs on the op's goroutine while a
  `PollRecords` may be in flight, and §5.3's mid-browse cancellation case races a cancel against a
  live fetch deliberately.
- **franz-go, kadm, kmsg and `modules/kafka` are already in this box's module cache** (§1.13), so
  M9.1's `go get` is a cache hit and every §1.7 claim can be re-checked by reading
  `$(go env GOPATH)/pkg/mod/github.com/twmb/franz-go@v1.21.6/` rather than fetching anything —
  the same technique `AGENTS.md`'s Wails section prescribes for a docs site that is 403-blocked.
- **A background process started in one shell invocation cannot be signalled from a later one**
  (P51's finding, still true). M9.3's sweep and M9.4's checkpoint C2 pass — start, exercise, kill,
  read the log — are **one** Bash invocation each, with a 150 s+ timeout, polling a log file rather
  than sleeping a fixed interval.
- **There is no real X display here**, so checkpoint C2's manual pass runs against
  `tests/e2e-real`'s own `-tags server` vehicle, not `xdotool`/screenshots. P58a already established
  that the screenshot path does not work; do not spend a session on it.
- **Install `wails3` pinned** to `shell/go.mod`'s exact version (`v3.0.0-beta.15`), never `@latest`
  (P55's finding). **`shell/frontend/bindings` is git-ignored** and must be regenerated
  (`wails3 generate bindings -b -i -ts -names`) before `bun run build` resolves its imports; P58e
  changes no bound method signature, so one regeneration per fresh container is enough.
- **`shell/runtime/` is git-ignored too**, and P58e still needs both halves: `scripts/vendor-node.sh`
  for `runtime/node/bin/node` and `bun run build:engine` for `runtime/engine/engine.cjs`. The app
  refuses to start without the engine bundle (P56 D12), and **after M9.3 the child still starts and
  serves zero of ten kinds** — which is the whole point of checkpoint C2 and not a setup mistake to
  work around.
- **Comparing a struct containing an `any` field with `==` panics at runtime** rather than failing to
  compile (P55's finding). `model.ConnectionState.Caps` is such a field — use `go-cmp` (already a
  dependency), never `==`.
- **`.claude/worktrees/` exists and is empty** at `1065518`, and `git status --short` is clean. An
  earlier session in this workspace reported a stray copy of `src/engine/adapters/kafka` under
  `.claude/worktrees/agent-ae3fb894ac34e73cc/`; it is **gone**, it was an artifact of an unrelated
  session, and nothing in this plan depends on it. Recorded here rather than as an open question
  because there is nothing left to decide — but if a future session finds that directory repopulated,
  it is not a source of truth and `git grep` will not see it.

## 12. M9.0 results

All four probes ran against a real `confluentinc/cp-kafka:8.0.7` broker via
`testcontainers-go/modules/kafka@v0.44.0`, in a throwaway scratch module never committed to this
repo (per the M9.0 rule). Ordering followed §6: KF-4(a) first, then KF-2, then KF-3, then the rest
of KF-4.

**KF-4(a) — container startup: PASS, with one gap not anticipated by §1.15/§4.2/E19.**
`kafka.Run(ctx, "confluentinc/cp-kafka:8.0.7")` **fails outright** with `CLUSTER_ID is required.
Command [/usr/local/bin/dub ensure CLUSTER_ID] FAILED!` unless `kafka.WithClusterID(...)` is passed
explicitly — the module has no default. Confirmed by reading `modules/kafka@v0.44.0`'s own source
(`WithClusterID` at `kafka.go:152-156` is a plain `testcontainers.WithEnv` wrapper) and its own test
files, which all pass it. With `kafka.WithClusterID("kira-test-cluster")` added, the container
started in **7.475s** and `Brokers()` returned a live, single-broker address; no ulimit or
wait-strategy problem was encountered. **Action for M9.1: `testsupport/kafka.go` must call
`kafka.WithClusterID(...)`; this is not optional the way it reads in §1.15.**

**KF-2 — cancellation semantics: PASS, all five sub-probes, confirming P58e E3's premise exactly.**
The first version of this probe was a false pass: it produced 50 records and cancelled at 300ms,
but `PollRecords` drained all 50 in ~49ms — before the cancel fired — so it never exercised a real
blocking wait. Fixed by draining the client first so the probed poll genuinely has nothing left and
must block on `FetchMaxWait`. With that fix:
- **(a)** a cancelled `context.Context` aborts an in-flight, genuinely-blocking `PollRecords`
  promptly — returned after 300.71ms against a 300ms cancel (not the 20s `FetchMaxWait`), with
  `errors.Is(fetches.Err(), context.Canceled) == true`.
- **(b)** a pre-cancelled context short-circuits `PollRecords` immediately (1.9µs).
- **(c)** a pre-cancelled context short-circuits `kadm.ListEndOffsets` immediately (141µs), the
  error wrapped as `*fmt.wrapError` containing "operation was canceled" (not a bare
  `context.Canceled`, so the mapper must use `errors.Is`, never a type assertion).
- **(d)** `Close()` racing a live, genuinely-blocking `PollRecords` unblocks it promptly (300.75ms)
  with `errors.Is(fetches.Err(), kgo.ErrClientClosed) == true`.
- **(e)** repeated 10x with no flake; max latency 100.58ms, matching the cancel delay each round.

No correction to **P58e E3** is needed: the op's own `context.Context` passed directly to every
kadm/kgo call, with an explicit `Fetches.Err()` check via `errors.Is`, is confirmed sufficient.

**KF-3 — end-of-log / transaction-commit-marker gap: the E9 fork resolves to "signal available,"
plus one refinement not anticipated by §6's framing.** A `gap-topic` (1 partition) with one record
produced inside a franz-go transaction (`BeginTransaction`/`ProduceSync`/`EndTransaction`) confirmed
via `kadm.ListStartOffsets`/`ListEndOffsets`: start=0, end=2 (1 record + 1 invisible commit marker),
exactly as predicted. Browsing from offset 0:
- **Round 0 (the fetch that delivers the record) carries exactly the signal P58e E9's clamp needs**:
  `HighWatermark=2`, `LastStableOffset=2`, `LogStartOffset=0` alongside the one delivered record at
  offset 0. Consuming to `next = 1` and comparing against `HighWatermark = 2` is not yet "caught
  up" by raw offset arithmetic, but the record at the only other valid offset (1) is the commit
  marker itself and will never be delivered — so the clamp must treat "next has reached the last
  *deliverable* offset for this high watermark" as done, exactly the shape **P58e E9** already
  designs for. **This is confirmed on the plain (non-transactional) `ordinary-topic` too**
  (`HighWatermark=1` after consuming its one record, no gap) — the fork is real and the signal
  survives it.
- **Refinement**: every subsequent poll — on *both* the gap-topic and the plain contrast topic —
  did **not** return a quick, empty-but-successful result near `FetchMaxWait`. Raising the
  per-round context timeout from 2s to 10s to rule out a too-tight probe budget showed all 8 rounds
  block for the **full** 10s context deadline, every time, with **no partition metadata at all** on
  return (`Partition=-1` sentinel, only a top-level `context deadline exceeded`; `FetchMaxWait` is
  a per-broker-round-trip budget, not a caller-visible return latency — `PollRecords` keeps
  retrying internally and only returns when there is data or the caller's context ends). This is
  identical on the transactional and non-transactional topics, so it is general franz-go behavior,
  not specific to the commit-marker gap. **Consequence for the adapter design: the clamp must be
  derived once, from the watermark on the fetch that actually delivered the last record — never
  from a follow-up "peek" poll**, since a peek poll cannot return a fresh watermark without either
  genuinely blocking on new data or burning the caller's entire remaining timeout with no usable
  metadata. `MAX_EMPTY_POLLS` (already kept as the second terminator per E9) is unaffected by this,
  since it counts empty *delivered* batches within the loop's own bounded polls, not a peek
  mechanism. No fork of E9 is required; this narrows how the delivering-fetch watermark must be
  captured and used, and is worth a one-line comment at the clamp site in M9.2.

**KF-4(b) — full inventory: recorded, no surprises.** Seeding `orders` (2 partitions, 6 messages,
one `source:seed` header, keys `key-0`..`key-5`, JSON bodies) and registering `kira-test-group`
with committed offsets and no members (mirroring `0005_kafka_seed.ts`) via `kadm.CommitOffsets`
against `ListStartOffsets`' own results:
- `adm.Metadata` returns a real cluster ID, one broker (`Rack=nil`), and per-topic `IsInternal`
  (`__consumer_offsets` correctly flagged internal).
- `adm.ListGroups`/`DescribeGroups` show the group in `State="Empty"`, `ProtocolType=""`,
  `Members=0`, `Err=nil` — exactly the shape scenario 6 needs.
- `adm.DescribeTopicConfigs("orders")` returns 32 real config rows, all `Source=DEFAULT_CONFIG`
  except `flush.messages` (`STATIC_BROKER_CONFIG`). **`cleanup.policy=delete` and
  `retention.ms=604800000` are both present and stable** — either is a safe pick for scenario 6's
  inverted assertion (**P58e E11**).
- `adm.FetchOffsets("kira-test-group")` returns both partitions at offset 0, `Err=nil`.

**KF-4(c) — `ListOffsetsAfterMilli`: confirms the documented divergence (row 422), no new
decision.** Before any record: returns offset 0 with the first record's own timestamp echoed back.
After all records: returns the **current end offset** (3, matching the high watermark) with
`Timestamp=-1` — not librdkafka's `-1`/`OFFSET_END` sentinel *offset*. Scenario 19's re-baseline
should assert the end-offset value, not a `-1` offset.

**KF-4(d) — nonexistent-topic detection: PASS for the error shape, but surfaces a real fixture
hazard not anticipated by P58e E12's own framing.** `ListStartOffsets`/`ListEndOffsets` on
`does-not-exist-topic` return a top-level `nil` error with the per-partition entry carrying
`Partition=-1`, `Err=*kerr.Error` (`UNKNOWN_TOPIC_OR_PARTITION`) — confirming **P58e E12**'s
map-inspection path (never error-catching) is correct, in 3.96ms. **However: the topic is then
auto-created on the broker** (`adm.Metadata` afterward shows it present) — **even though the Go
client never called `kgo.AllowAutoTopicCreation()`, which defaults to `false`, and `kadm`'s own
`MetadataRequest` construction never sets `AllowAutoTopicCreation` either** (confirmed by reading
`kmsg.NewPtrMetadataRequest`'s `Default()`, a no-op, leaving the field at its zero value). The
auto-creation is happening broker-side, independent of anything the Go client requests — almost
certainly `cp-kafka`'s own `auto.create.topics.enable` broker default, which
`testcontainers-go/modules/kafka` does not override. **This is a new decision, not previously
named in §2 or §4: `testsupport/kafka.go` must set `KAFKA_AUTO_CREATE_TOPICS_ENABLE=false` at the
container level in M9.1.** A client-side `kgo.AllowAutoTopicCreation()` toggle (client already
defaults to not-allowing) is not the lever — it does not prevent this. Without the container-level
fix, any acceptance test exercising a "topic does not exist" scenario pollutes every test that
runs after it in the same container (a fresh nonexistent-topic name per test would dodge it, but
disabling it at the source is simpler and matches what a careful adapter author would want anyway).

**KF-4(e) — idempotent vs. non-idempotent produce: confirms P58e E14, no behavior change.** First
produce took 22.78ms with the default (idempotent) producer and 21.52ms with
`kgo.DisableIdempotentWrite()` — a negligible difference in this single-broker container. As §1.8
and the plan's own note already anticipate, this does **not** discharge the risk `DisableIdempotentWrite`
guards against: the container sets `KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1`, which a real
multi-broker cluster does not, so `InitProducerId`'s real-world cost is not visible here.
`DisableIdempotentWrite` stays in **P58e E14** regardless.

**KF-4(f) — header/attrs cross-check: PASS, no divergence, matching §1.8's prediction.** The Go
side reads back `headers = map[string]string{"source":"seed"}` and constructs
`attrs = {"partition":0,"offset":"0"}` for the same seeded message the TypeScript adapter would
render as `headers = Record<string,string|string[]>` JSON and `attrs = {partition:number,
offset:string}` JSON (`src/engine/adapters/kafka/read.ts:37-50,288`) — structurally identical once
folded through **P58e E8**'s single-value case. No adjustment to E8 needed.

**KF-4(g) — `Ping` against an unreachable host: confirms P58e E4/E15's fast-failure expectation.**
`kgo.NewClient(kgo.SeedBrokers("127.0.0.1:1")).Ping(ctx)` returned in 282.5µs with a
`*fmt.wrapError` wrapping `"unable to dial: dial tcp 127.0.0.1:1: connect: connection refused"` — a
plain `*net.OpError` underneath, reachable via `errors.As`, consistent with the Go re-derivation
already planned for `E_CONNECT` in §2's `E4`/`errors.go` design and **P58e E15**'s `Connect` probe
latency expectations.

**Summary — nothing here changes P58 D7 or forks a major design decision away from what §2 already
specifies.** Two concrete, previously-unstated action items land in M9.1: (1) `testsupport/kafka.go`
must pass `kafka.WithClusterID(...)` (KF-4(a)) and (2) must disable
`KAFKA_AUTO_CREATE_TOPICS_ENABLE` at the container level (KF-4(d)). One design refinement lands in
M9.2: the E9 clamp must be captured from the delivering fetch's own watermark, never refreshed via
a follow-up peek poll (KF-3).

## 13. M9.1–M9.4 results

**M9.1 — the fixture and the failing suite.** `testsupport/kafka.go` needed two fixes §1.15 did not
anticipate, both found by M9.0's own probes and folded in here: `kafka.WithClusterID(...)` is not
optional (the module fails outright with `CLUSTER_ID is required` without it), and the container
needs `KAFKA_AUTO_CREATE_TOPICS_ENABLE=false` set explicitly (the broker's own default silently
auto-creates a queried-but-missing topic, which would otherwise pollute every test that runs after a
nonexistent-topic scenario in the same container). `kafka_test.go` landed with all 21
`tests/db/kafka.spec.ts` scenarios ported plus one new case, failing at `CreateAdapter` with
`E_UNSUPPORTED "kafka connections are not supported yet"` — the right reason (no constructor
registered), confirmed rather than assumed.

**M9.2 — the adapter, and the acceptance suite's final shape.** All 22 top-level `Test*` functions in
`kafka_test.go` pass under `go test ./internal/adapters/kafka/... -race` against a real
`confluentinc/cp-kafka:8.0.7` container (23.3s), plus `read_test.go`'s 6-case
`TestAdvanceWindows` table for **P58e E26**'s window-arithmetic unit test — **28 passing cases in
total**, zero flakes across the runs this session made. Of §5.3's six called-out scenarios, all six
needed adjustment, exactly as predicted, and none needed a different fix than the plan named:
scenario 6's Configuration half is **inverted, not ported** (asserted populated, no "not available"
note — **P58e E11**'s capability recovery); scenario 11 re-baselines onto `ListedOffsets` inspection
rather than a caught error (**P58e E12**); scenarios 17 and 18 are **rewritten to check the broker
directly** (`ListGroups` before/after a full browse; `FetchOffsets` against the browse's own group
name) rather than trusting the adapter's own `definition()` view, because franz-go's own
no-group-join guarantee needed an assertion that could not just trust the code under test; scenario 20
re-baselines onto the real `int64` boundary now that **P58e E6** deletes `toNativeOffset`'s guard
entirely (the old `E_UNSUPPORTED` case is gone as a capability gain, not a loss); scenario 21
re-baselines onto **P58e E9**'s watermark clamp in place of librdkafka's `partition.eof`, and is the
one case whose outcome traces straight back to KF-3's own finding. Two more adjustments the plan's
own §5.3 table didn't single out but the acceptance run needed: scenario 2 collapses to a plain caps
assertion (there is no separate "supported operations" enumeration to port), and scenario 1 gains a
`details["cluster"]` assertion for **P58e E15**'s recovered capability. One case is genuinely new
(not a port): a mid-browse cancellation alongside scenario 15, the one **P58e E3**'s `Fetches.Err()`
contract needs and an already-cancelled-context case alone cannot reach.

**P58e E9 resolved to its primary branch — "signal available," not the `LastStableOffset` fallback.**
KF-3 confirmed `FetchPartition.HighWatermark` on the fetch that actually delivers a transaction's
last record before its commit marker carries exactly the proof the clamp needs, on both a
transactional and a plain topic. The one refinement KF-3 forced and §2's own text now carries: the
watermark must be captured from that delivering fetch and never refreshed by a later "peek" poll,
since a poll with nothing new to deliver blocks for the caller's *entire* remaining context timeout
with no partition metadata at all — not a quick, informative "nothing here yet" the way a
literal-minded design might assume.

**P58e E14's `DisableIdempotentWrite` proved prudent, not empirically necessary in this sandbox.**
KF-4(e) measured a negligible 22.78ms vs 21.52ms difference between idempotent and non-idempotent
first-produce latency, because this sandbox's own single-broker container already sets
`KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1` — the exact setting whose *absence* on a real
multi-broker cluster is what makes `InitProducerId` hang. The setting stays in `client.go` regardless,
guarding a failure mode this sandbox cannot construct rather than one it already exhibits.

**The `TestKindNodeServed` retirement's real diff (commit `423058c`): 6 files, 59 insertions, 39
deletions — 98 lines total, smaller than a naive four-consumer estimate.**
`NewRouterAllNodeServed`'s shape (an empty `native` map on an otherwise-unchanged `Router`) let three
of the four consumers (`adapterhost/integration_test.go`, `adapterhost/dataframe_test.go`,
`tree/service_test.go`) change only their constructor call. `connections/service_test.go`'s
`fieldsInput` was the one real constraint, exactly as §1.9 predicted: `model.ValidConnectionKind`
rejects a synthetic kind before the router is ever consulted, so it needed a real behavioural
adjustment, not a rename.

**M9.3's `tests/e2e-real/` sweep: all 5 tests across all 3 spec files green** after the flip
(`postgres-real.spec.ts` ×2, `sqlite-real.spec.ts` ×1, `mariadb-real.spec.ts` ×2 — the second of
which is the checkpoint-C2-automated-half rewrite itself, **P58e E21**). Re-confirmed again in M9.4
after the packaging/doc edits, with no regression.

**Checkpoint C2 — the manual pass, run for real in M9.4.** Ten kinds, one live `-tags server`
session, real containers throughout (`postgres:17-alpine`, `mariadb:11.4`, `mysql:8.4`,
`clickhouse/clickhouse-server:26.3` via the ulimit-free container helper, `mongo:7`, `redis:7`, two
independent `localstack/localstack:3` instances for sqs and s3, `confluentinc/cp-kafka:8.0.7`;
sqlite needed a real seeded temp file, no container). For each kind: create the connection, connect
it, expand its tree, dblclick into a real object (a table's grid, a document, a redis/s3 browse
descent into a keyvalue view, a Kafka/SQS stream page), then disconnect. Docker never became a
constraint in this session — every image was already mirror-pulled or pulled cleanly — so no kind
needed the "not available in this session" carve-out §7.3 requires when one does.

| Kind | Result |
|---|---|
| postgres | pass |
| mariadb | pass |
| mysql | pass |
| sqlite | pass |
| clickhouse | pass |
| mongodb | pass |
| redis | pass |
| kafka | pass |
| sqs | pass |
| s3 | pass |

The three paths a per-kind pass misses were exercised in the same session: a real Postgres
`SELECT pg_sleep(5);` console statement, stopped mid-flight via the stop button (a real
`Router.Cancel` round trip); a settings-dialog cache-budget change (`Router.PushCacheConfig`,
`cache:configure`); and the settings dialog's own "Clear caches" button (`cache:clear`).

`grep -c 'routed a connection request to the Node engine child' <the run's real KIRA_HOME log file>`
**→ 0.** The child was confirmed alive and idle throughout, not merely silent: `engine-status` read
`ok` both before the pass and after it, `pgrep -P <serverPid>` found a real running child process,
and the very same log file carried ordinary `INFO`-level lines from the run itself (the SQS and S3
adapters' own LocalStack endpoint-override notices) — proof the grep would have caught a `WARN` line
had one fired, rather than passing vacuously against an empty or silent log. The pass ran as a
throwaway, uncommitted `tests/e2e-real/` script, per the parent's own §6 discipline and checkpoint
C1c's own precedent (`AGENTS.md`'s "Checkpoint C1c" entry) — it existed only to produce this
evidence once, not to become a fourth permanent spec in that tier.

**M9.4 — the deletions and the packaging fixes, both exactly as scoped.** The re-grep §1.11
predicted was re-run before deleting anything: `grep -rln "support/kafka\|0005_kafka_seed" tests/
scripts/ package.json` still shows `tests/e2e-real/support/kafka.ts` and
`tests/ipc/kafka/kafka.backend.spec.ts` as live consumers of both `tests/db/support/kafka.ts` and
`tests/db/fixtures/0005_kafka_seed.ts` — both **kept**, exactly as predicted, and only
`tests/db/kafka.spec.ts` was deleted. `scripts/run-db-tests.sh` collapsed to one line (`bun test
tests/db`); the remaining `tests/db/` suite (mariadb/mysql/sqlite, 114 tests) still passes in full,
and `clickhouse.spec.ts`'s one failure is this sandbox's pre-existing `ulimit`/`rlimit` restriction
(`AGENTS.md`'s ClickHouse section), unrelated to the deletion. `scripts/verify-packaging.sh`'s and
`scripts/sign-bundle.sh`'s Kafka notes were corrected to say the module is unused rather than "a
known gap"/"will fail at runtime" — **P58e E22**'s own framing ("message-string corrections only, no
logic change") held exactly as written; the surrounding A2/A4 comments were also corrected, since
leaving them calling this "a real, open gap" next to a message that no longer says so would have been
a smaller but still-real inconsistency. `docs/PACKAGING.md`'s §6 gap bullet and §4 human-checklist
item 8 got the same correction (outside this plan's own file list, but in scope for the same reason).

**Nothing turned out to contradict this plan's own predictions.** Every §2 decision, every §6 probe
disposition and every §7 design choice landed exactly as designed; the only two additions beyond what
§2 named outright were KF-4(a)'s `WithClusterID` requirement and KF-4(d)'s auto-create-topics fix,
both container-configuration details rather than adapter-design corrections, and both already folded
into §12's own M9.0 write-up before M9.1 started.

### Critical files for implementation

- `src/engine/adapters/kafka/read.ts` — the 337-line ground truth for the browse: `PartitionWindow`, `freshWindows`, the bounded poll loop, and the P43 iter2 F19/D26 EOF clamp at `:299-308` that **P58e E9** must reproduce without `partition.eof`.
- `shell/internal/adapterhost/router.go` — `nativeKinds` (`:19`), `TestKindNodeServed` (`:30`, retired by **P58e E20**), and the seven `*ViaChild` paths checkpoint C2's counter instruments (§7).
- `tests/e2e-real/mariadb-real.spec.ts` — the coexistence proof whose second test (`:140-276`, specifically `:235` and `:256`) fails deterministically in the flip's own commit; **P58e E21** rewrites it into checkpoint C2's automated half.
- `src/engine/adapters/kafka/definition.ts` — where both recovered capabilities land (**P58e E11**'s Configuration section, replacing `:58-68`'s permanent "not available" note) and where the numeric-enum apparatus at `:12-33` is deleted rather than ported (**P58e E13**).
- `tests/db/kafka.spec.ts` — 776 lines, 21 scenarios, the port's own specification; scenarios 6, 11, 17, 18, 20 and 21 are the six that do not port as-is.
- `shell/internal/adapters/sqs/read.go` — the closest structural sibling in Go: the only other `page.NewStreamPageBuilder` caller, and the model for **P58e E8**'s cell construction.
