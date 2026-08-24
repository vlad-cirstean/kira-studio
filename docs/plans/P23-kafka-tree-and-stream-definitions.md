# P23 — Kafka tree reshape + definitions for the stream engines

> Not an original SPEC.md §10 deliverable line — P23 is user-directed, reported against shipped
> work. The ask, verbatim: *"for kafka don't expand a topic with the partitions, and have a folder
> for other elements like consumer groups"* and, in the same message, *"add open definition for all
> the other connections where there's some definition to show."* Added to §10 as a historical
> record, the same way P16's and P22's rows are.
>
> **Why one phase, and why a new one.** The two halves are the same story told twice: partitions
> stop being tree rows and *reappear* in the topic's definition view, which is P19's own ground
> rule — *"Nothing the tree stops showing may become unreachable… This is a relocation, not a
> deletion"* — applied to a second engine. Splitting them would ship a phase that deletes the only
> place partition metadata is visible, which is precisely the half-implementation AGENTS.md rules
> out. Filing it as a **P19 addendum** was the real alternative and was rejected: both halves
> reverse explicit `## 5 Explicitly out of scope` bullets of P19 (*"Folders for Redis, Kafka, SQS
> and S3 levels"*, *"A definition view for … kafka topics"*), and the P18 §9 / P19 §9 addendum test
> is "a defect in what this plan shipped, or the other half of a line it already owns" — extending a
> mechanism to engines a plan deliberately excluded is scope *extension*, not completion. SPEC §10's
> P19 row is also already written as a closed past-tense record of what shipped; growing it to cover
> three more adapters, two `caps` reversals and a new wire field would make it misdescribe its own
> commit range.
>
> This phase touches four layers: one renderer-only tree table, two adapters' `caps` + a new
> `definition.ts` each, one new field on the definition wire shape, and the definition view's load
> path. The engine-side tree walk (`children()`) is **not** changed — F4 is why.

## 0. Ground rules for this phase

- **Relocation, not deletion.** Every fact a partition tree row carried — that the topic has N
  partitions, which ids they are — is reachable after this phase, in the topic's definition view
  (D5) and in the stream view's own partition filter (F4). The partition rows carried almost
  nothing else (F5) and this plan says exactly what each of those affordances becomes.
- **Grouping stays a renderer policy.** No adapter learns a folder, no encoded path grows a
  segment, no `NodeKind` is added. P19's D2 settled this and P23 reuses the mechanism verbatim:
  two rows appended to one literal table (D1). If applying P19's grouping to Kafka needs anything
  beyond that table, the design is wrong.
- **Curated vocabularies, not exhaustive ones.** The Kafka folder set is a literal two-entry
  extension of `GROUPED_KINDS`, not "fold every root kind". The definition sections per engine are
  a fixed, named list per adapter, not "dump every attribute the SDK returns" — except where the
  SDK's own attribute map *is* the object's definition, which is the SQS case and is stated as such
  (D9).
- **Enabling `caps.definition` reverses a deliberate decision and says so.** `kafka/caps.ts:4-5`
  and `sqs/caps.ts:3-4` both carry P10's *"no definition"* comment; `redis/caps.ts:3` and
  `s3/caps.ts:5-6` carry P9's and P17's. This phase flips exactly two of the four and records why
  the other two stay `false` (D11, D12) rather than leaving them looking like an oversight.
- **No new dependency, no new view.** The definition view built by P19 (`views/definition/`) is the
  one that renders this; `kafkajs` and `@aws-sdk/client-sqs` are already direct dependencies and
  every call used here is already typed in the installed packages (F8, F9).
- **A definition load must never poll an SQS queue.** SPEC §5.1's hard rule is that SQS *reads* are
  never automatic. `GetQueueAttributes` is not `ReceiveMessage` and makes nothing invisible — D9
  states that explicitly, because the definition tab *does* auto-load on mount.
- Comments per AGENTS.md: only where the code cannot say it for itself.
- Run `bun run lint`, `bun run typecheck` and `bun run build` throughout; `bun run test:db` matters
  from step 2 on (this phase does change adapters); `xvfb-run -a bun run test:ui` from step 1 on.

## 1. Findings (verified against the tree and `node_modules`, not assumed)

**F1 — topics and consumer groups are already flat root-level siblings; only the *partitions* nest.**
`kafka/catalog.ts:11-17`'s `listRoot()` is `[...listTopics(admin), ...listGroups(admin)]`, with its
own comment recording why groups are not nested under topics. `listTopics` (`:19-40`) emits
`kind: 'topic'`, `hasChildren: true`, `detail: '${n} partition(s)'`; `listGroups` (`:42-61`) emits
`kind: 'consumerGroup'`, `hasChildren: false`. `kafka/index.ts:64-79`'s `children()` routes a
one-segment topic path to `catalog.listPartitions()` and returns `[]` for everything else. So the
user's first clause is about the *topic → partition* level, and the second is about organising a
root list that is already flat — not about un-nesting groups.

**F2 — SPEC §5.1's own Kafka row never mentioned partitions.** It reads *"cluster → topics,
consumer groups"* (SPEC.md:181). `kafka/caps.ts:3-5` quotes that same row. Removing the partition
level brings the tree back into line with the spec sentence that describes it, rather than
departing from it.

**F3 — P19's grouping mechanism is kind-keyed, level-agnostic, and already runs at the connection
root.** `project/state/tree.ts:342-392`'s `buildRows()` calls `partitionChildren(visible)` at
*every* level including `parentPath === ''` (`:411` passes the connection's own children with
`parentPath: ''`), emits one synthetic `kind: 'group'` row per non-empty entry of
`GROUPED_KINDS`, keys it `groupPath(parentPath, kind)` = `` `${parentPath}#${kind}` `` (`:37-39`),
and toggles it through `toggleGroup()` (`:156-160`), which flips `treeState.expanded` directly with
no IPC. `grouping.ts:11-22`'s table is four entries today and its own comment names *"kafka topics,
partitions and consumer groups"* among the kinds deliberately left ungrouped. **Adding Kafka
folders is two rows in that table** — `groupPath('', 'topic')` is `#topic`, which collides with
nothing (`#` cannot occur in an encoded path, P19 realities #8) and is per-connection unique because
`rowKey()` prefixes the connection id (`:89-91`). `groupMenu` already targets `groupParentPath()`
(`menus.ts:453-470`), which for a root folder resolves to `''` — the connection root — correctly.

**F4 — the stream view's partition filter reads the topic's `children()`, so that call must keep
working.** `StreamView.vue:246-270`: `loadPartitionOptions()` calls
`control.treeChildren(connectionId, props.tab.path, false)` and maps `Number(n.name)`, re-fetched
every time the popover opens; its own comment says *"a topic's path already resolves to its
partition list one level down, kafka/index.ts's `children()`"*. The multiselect
(`StreamView.vue:543-585`, testids `stream-filter-partition` / `stream-filter-partition-option-N`)
is the only place a partition is *actionable* in the app. This is the single most important finding
in the phase: it is why P19's D5 answer ("delete the adapter method, it had no other caller") does
not transfer, and why D3 below is a renderer-only change.

**F5 — a partition tree row is, today, almost inert.** `ProjectTree.vue:36-38` records that
`'partition'`/`'consumerGroup'` *"stay browse-only leaves with nothing to open"*, and `onOpen`'s
`if (!row.hasChildren) return` guard (`:107`) makes double-click a no-op. `menus.ts:89-90` gives it
`simpleObjectMenu` — **Copy name** (which copies `"0"`) and **Copy qualified name**, which filters
segments through `QUALIFIED_KINDS` (`menus.ts:43-52`, a seven-entry set containing neither `topic`
nor `partition`) and therefore copies **the empty string**. And `kafka/index.ts:132-141`'s
`resolveTopicTarget()` reads `segments[0]` only, so even if a partition row *could* open a stream
tab it would browse the whole topic, ignoring the partition. Nothing of value is lost by removing
the row; one latent bug goes with it.

**F6 — `caps.definition` is the single gate for the menu item, and the item is attached per
row-kind, not globally.** `menus.ts:314-327` (relations) and `:398-411` (collections) each splice in
`open-definition` when `connectionsState.states[id]?.caps?.definition === true`. `streamNodeMenu`
(`:569-599`, shared by `topic` and `queue`) and `simpleObjectMenu` (`:630-648`, shared by
`consumerGroup`, `sequence` and `function`) have no such item. **`simpleObjectMenu` cannot simply
gain one**: Postgres and MariaDB have `caps.definition: true` but their adapters still throw
`E_UNSUPPORTED` for `sequence`/`function` paths (P19 §5), so an unconditional item there would offer
a menu entry that always errors. D7 splits `consumerGroup` into its own builder for this reason.

**F7 — the definition view hard-requires `describe()` today, and Kafka/SQS have none.**
`views/definition/state.ts:58-61` is a `Promise.all([treeDefinition, treeDescribe])`, so a rejected
`describe()` fails the whole load; `DefinitionView.vue:244` renders the Structure body only under
`v-else-if="definition && meta"`. `kafka/index.ts:81-84` and `sqs/index.ts:80-83` both throw
`E_UNSUPPORTED` from `describe()` and `ObjectMeta` (`shared/domain/tree.ts:112-125`) is SQL-shaped —
`columns`/`primaryKey`/`foreignKeys`/`referencedBy`/`indexes`/`rowEstimate` — with no slot for a
partition or a queue attribute. There is precedent for tolerating a failed describe: P19 realities
#9 records `views/grid/state.ts:70-80`'s `loadMeta()` and its *"deliberately silent catch"*. D8
takes that shape. `DefinitionView.vue:205-212` also renders **Open in console** unconditionally,
which for `caps.sql: false` engines (kafka `caps.ts:12`, sqs `caps.ts:11`) would open a console tab
for an engine that has none — D8 gates it.

**F8 — every Kafka call this needs is already typed in the installed `kafkajs@2.2.4`, and no new
package is involved.** `node_modules/kafkajs/types/index.d.ts`:
`describeConfigs({ resources: ResourceConfigQuery[], includeSynonyms: boolean })` (`:532-535`)
returns `DescribeConfigResponse` whose `resources[].configEntries` are
`{ configName, configValue, isDefault, configSource, isSensitive, readOnly, configSynonyms }`
(`:334-341`); `ConfigResourceTypes.TOPIC = 2` (`:280-285`). `fetchTopicMetadata` (`:517`) returns
`ITopicMetadata` (`:255-258`) whose `partitions` are `PartitionMetadata`
(`:139-146`) — `{ partitionErrorCode, partitionId, leader, replicas, isr, offlineReplicas? }`, i.e.
leader/replica/ISR data the tree never surfaced. `describeGroups(groupIds)` (`:539`) returns
`GroupDescription` (`:851-857`) — `{ groupId, members, protocol, protocolType, state }` with
`ConsumerGroupState` a six-member union (`:843-849`) and `MemberDescription` (`:834-840`)
`{ clientHost, clientId, memberId, memberAssignment: Buffer, memberMetadata: Buffer }`.
`fetchOffsets({ groupId })` (`:518-522`) returns committed offsets per topic/partition.
`kafka/index.ts:127-130` already holds a connected `Admin`.

**F9 — SQS needs one command the adapter already imports.** `sqs/read.ts:2` imports
`GetQueueAttributesCommand` and calls it twice already, with narrow `AttributeNames`
(`['VisibilityTimeout']` at `:65`, `['ApproximateNumberOfMessages']` at `:128-130`).
`AttributeNames: ['All']` is the same command. `sqs/index.ts:36,72-78` keeps a `queueUrls`
name→URL map populated by `children()` with a `GetQueueUrl` fallback, so a definition path resolves
its URL for free through `resolveQueueUrl()`.

**F10 — Redis and S3 already show, in the tab a user opens anyway, everything a definition would
say.** Redis: `redis/read.ts:18,27-52` puts `redisType`, `ttlMs` and a best-effort `MEMORY USAGE`
onto every `KeyValuePage`, and `KeyValueView.vue` renders them — a Redis key's "definition" would be
a second view of data the primary view already carries, for a `key` node whose only other property
is its name. S3: SPEC §10's P17 row records that an object's *"metadata (ContentType/Size/
LastModified/ETag/StorageClass/user Metadata) plus a `Body` field/value row"* is exactly what
`KeyValueView` shows. A *bucket* definition (region, versioning, encryption, lifecycle, policy,
tagging) is genuinely new information, but it is five separate SDK calls each of which a
single-bucket IAM policy commonly denies — and `s3/catalog.ts:17-37` exists specifically because
such policies are the common case. D11/D12 turn both of these into a stated decision.

**F11 — the L1 cache and the tab machinery need no change for a new definition-bearing kind.**
`main/tree-service.ts:116-134` keys `metadata_cache` by `(connectionId, path, 'definition')` with no
per-kind logic, and a payload that fails `objectDefinitionSchema.safeParse` is dropped and refetched
(P19 realities #16) — so adding a field is self-healing. `tabKindSchema` already has `'definition'`,
`TabStrip.vue` already has its icon case and `MainView.vue` its render branch (P19 D14).

**F12 — the existing Kafka/SQS specs assert today's shape in five places each.** DB:
`tests/db/kafka.spec.ts:102` (`caps.definition === false`), `:133-144` (scenario 4, partitions from
`children()`), `:146-157` (scenario 5, a partition path's children are `[]`), `:169-176`
(scenario 6, `definition()` rejects); `tests/db/sqs.spec.ts:139`, `:175-182`. UI:
`tests/ui/kafka.spec.ts:125-127` (`expandRow(page, '')` then `findRow(EMPTY_TOPIC_PATH)` — which
after this phase is inside a folder), `:137-145` (the partition-row block), `:188-190` (the
consumer-group menu has no `open-console`).

## 2. Shapes introduced in this plan

```ts
// src/shared/domain/definition.ts   (one added field; nothing existing changes)

/** A named block of name/value facts about an object that is neither SQL text nor ObjectMeta:
 *  a Kafka topic's partitions and its non-default config, a consumer group's members, an SQS
 *  queue's attributes. Rendered by views/definition/PropertiesSection.vue, one section per entry,
 *  in the order the adapter returned them. [] for postgres/mariadb/mongodb (D6). */
export const definitionSectionSchema = z.object({
  title: z.string(),
  rows: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      /** Muted secondary text on the same row — a partition's replicas/ISR, a config's source. */
      detail: z.string().nullable(),
    }),
  ),
});
export type DefinitionSection = z.infer<typeof definitionSectionSchema>;

export const objectDefinitionSchema = z.object({
  // …unchanged…
  /** `.default([])` so a definition cached before this phase still parses (F11). */
  sections: z.array(definitionSectionSchema).default([]),
});
```

```ts
// src/renderer/project/grouping.ts   (two rows; no other change to this file)
export const GROUPED_KINDS = [
  { kind: 'view',          label: 'Views' },
  { kind: 'matview',       label: 'Materialized views' },
  { kind: 'sequence',      label: 'Sequences' },
  { kind: 'function',      label: 'Functions', labelFor: { mariadb: 'Routines' } },
  { kind: 'topic',         label: 'Topics' },           // P23 D1
  { kind: 'consumerGroup', label: 'Consumer groups' },  // P23 D1
];

/** P23 D3: a kafka topic joins table/view/matview — its partitions moved into the definition
 *  view, and the stream view's partition filter reads them through children() instead (F4). */
export function isLeafKind(kind: NodeKind): boolean;  // + 'topic'
```

```ts
// src/engine/adapters/kafka/definition.ts   (new)
export function buildTopicDefinition(admin: Admin, topic: string): Promise<ObjectDefinition>;
export function buildGroupDefinition(admin: Admin, groupId: string): Promise<ObjectDefinition>;

// src/engine/adapters/sqs/definition.ts     (new)
export function buildQueueDefinition(
  client: SQSClient, queueUrl: string, name: string,
): Promise<ObjectDefinition>;
```

```vue
<!-- src/renderer/views/definition/PropertiesSection.vue (new) -->
<!-- One `definition.sections[]` entry: the same section chrome + count badge IndexesSection.vue
     already uses, over a name / value / muted-detail row list. -->
```

## 3. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Kafka's root is organised by appending `topic` → "Topics" and `consumerGroup` → "Consumer groups" to `GROUPED_KINDS`. Nothing else changes in the grouping code.** Both folders are collapsed by default, in the one `treeState.expanded` set, exactly like P19's four. | F3: the mechanism is kind-keyed and already runs at the connection root, so this is literally two table rows — no new state, no new row type, no IPC, no adapter change, and `collapseAll()` / `dropConnectionState()` / search auto-expansion keep working for free. Because no other adapter emits `topic` or `consumerGroup`, no other engine's tree moves by a pixel. It also generalises the way the user asked for: a future Kafka root kind (brokers, ACLs) is one more row, and the label table is the one place to add it. |
| D2 | **Topics get a folder too — the root is *entirely* foldered, not "topics first, other kinds foldered".** | This is the phase's one genuinely two-sided call, and the deciding argument is scale. P19's "primary kind first, ungrouped" works because a schema has tens of tables and the folders sit below them; a Kafka cluster routinely has hundreds of topics, and a lone trailing "Consumer groups" folder would sit *below all of them* — the user would have to scroll past every topic to reach the thing they asked to have foldered. Two folders at the top is the shape that actually makes consumer groups findable, which is what was asked for. **Rejected: a `defaultExpanded` flag on `GROUPED_KINDS` so Topics opens automatically.** It needs a second set (`collapsed`) alongside `expanded` to distinguish "never touched" from "explicitly closed", and that second set immediately breaks the three things P19's D4 bought by using one set — `collapseAll()`, `dropConnectionState()` and the search-time `descendantMatch` expansion would each need a matching branch. One extra click, once per session (tree expansion is not persisted — P19 realities #6), is not worth a second expansion mechanism. §8's first open question is exactly this, with the one-line flip named. |
| D3 | **A topic stops expanding: `catalog.listTopics()` sets `hasChildren: false`, *and* `isLeafKind()` gains `'topic'` so a listing cached before this phase also shows no twisty.** | The two-part shape is P19's D5 verbatim and for the same reason: L1 has no TTL and is only rewritten on reconnect or an explicit Refresh, so the adapter change alone would leave a live twisty on every already-cached topic until the next reconnect. `hasChildren` is the *tree* hint and is now honest. The `detail` line (`'3 partitions'`, `catalog.ts:35`) stays and becomes the tree's at-a-glance partition count. |
| D4 | **`kafka/index.ts`'s `children()` and `catalog.listPartitions()` are left exactly as they are — a topic path still enumerates its partitions.** One added comment at `index.ts:77` records that this now serves the stream view's partition filter rather than the tree. | F4: `StreamView.vue:246-270` is a second, live consumer, so P19's D5 reasoning ("delete it, nothing else calls it") does not transfer — and this is the difference between the two cases, stated rather than glossed. `children()` is the adapter's catalog-enumeration API, not a promise about what the tree renders; P19 already established that tree *shape* is a renderer policy (its D2), so the two can legitimately disagree. The alternative — moving the filter's option list onto `treeDefinition` — was considered and rejected: it would make a popover open cost a `describeConfigs` round trip it has no use for, and would have the renderer parse partition ids back out of display rows. `tests/db/kafka.spec.ts`'s scenarios 4 and 5 therefore stay meaningful and stay green. |
| D5 | **Kafka gets `caps.definition: true` and a real `definition()` for two node kinds.** *Topic*: `sections` = **Partitions** (one row per partition: name = id, value = `leader <nodeId>`, detail = `replicas 1,2,3 · isr 1,2`) and **Configuration** (one row per `describeConfigs` entry; `isDefault` entries are shown with a muted `default` detail, `isSensitive` values render as `••••` and never carry the real value). Source = the whole `{ partitions, config }` document, `language: 'json'`, `origin: 'server'`. *Consumer group*: `sections` = **Group** (state, protocolType, protocol, member count) and **Members** (one row per member: name = `clientId`, value = `clientHost`, detail = `memberId`) and **Committed offsets** (one row per `topic[partition]`). | This is where the partition rows go (ground rule 1), and it is strictly more than they carried: leader, replicas and ISR are already in the `fetchTopicMetadata` response the tree threw away (F8), and topic config — retention, cleanup policy, compression — is the thing a person actually opens a topic to check. It costs two admin calls on a path the user opened deliberately, never on a browse. `isSensitive` is honoured because Kafka marks credentials that way and this app has a standing rule that a secret needs an explicit, logged path (P1 D9); a definition pane is not one. A consumer group is the one node in the app that previously had *no* view at all, and `describeGroups` + `fetchOffsets` is the whole of what a client can say about one. |
| D6 | **`ObjectDefinition` gains `sections: DefinitionSection[]`, `.default([])`, rather than a per-engine field.** Postgres, MariaDB and Mongo return `[]` and are otherwise untouched. | `documentSchema` is the precedent for "one engine's structure that `ObjectMeta` has no room for" (P19 D12), and a second single-engine nullable field would start a pattern of one field per adapter. A name/value/detail section list is the shape *both* new engines need and the shape any future one would (an S3 bucket's properties, if D12's follow-up ever lands, is the same table). `.default([])` means a definition cached before this phase parses unchanged, so there is no cache bump, no migration and no forced refetch (F11). |
| D7 | **`Open definition` is added to `streamNodeMenu` (topic, queue) behind the existing `caps.definition === true` gate, and `consumerGroup` is split out of `simpleObjectMenu` into its own `consumerGroupMenu` that carries the same gated item.** `case 'partition'` is deleted from `menuForRow`'s switch; the `'partition'` `NodeKind`, its `KIND_ICON` entry and `catalog.listPartitions` all stay. | F6: `simpleObjectMenu` is shared with `sequence`/`function` on Postgres and MariaDB, where `caps.definition` is `true` but the adapter still throws for those paths — so gating on caps alone would offer a menu item that always errors. A three-line builder is cheaper and clearer than a per-kind allowlist threaded through the shared one. The `'partition'` menu case is unreachable once no partition row can render, and P19's D10 precedent says to keep the enum member (`decodePath` must stay total over paths already on disk) while deleting its consumers — here `listPartitions` is *not* a dead consumer (D4), so only the menu case goes. `icons.ts`'s `KIND_ICON` is a `Record<NodeKind, string>` and must stay total regardless. |
| D8 | **The definition view stops requiring `describe()`.** `views/definition/state.ts`'s `Promise.all` becomes `Promise.allSettled`: a rejected `treeDefinition` still sets `status: 'error'`, a rejected `treeDescribe` leaves `meta: null` and is otherwise ignored. `DefinitionView.vue`'s Structure body renders whenever `definition` is present — `PropertiesSection` per `definition.sections`, then Columns/Indexes/Constraints/Validation exactly as today, each already conditional on the data it needs. **Open in console** is gated on the connection's `caps.sql`. | F7: Kafka and SQS have no `describe()` and `ObjectMeta` has no shape for them, so the alternative is a fake `ObjectMeta` full of empty arrays — a lie on the wire to satisfy a `Promise.all`. Tolerating a failed describe is already this app's pattern for exactly this data (`views/grid/state.ts`'s `loadMeta()`, P19 realities #9), and it has an independent benefit: a `describe()` that fails for a *SQL* table (a permissions error on `pg_constraint`, say) no longer blanks a perfectly good Source pane. The console gate is a real bug being pre-empted, not hypothetical — the button is unconditional today and Kafka has no console (P10's D13). |
| D9 | **SQS gets `caps.definition: true` and a `definition()` built from one `GetQueueAttributes({ AttributeNames: ['All'] })`**: `sections` = a single **Attributes** section, rows sorted by name, with `RedrivePolicy` / `Policy` / `RedriveAllowPolicy` pretty-printed as JSON in `value`; Source = the attribute map as a JSON document, `language: 'json'`, `origin: 'server'`. | A queue genuinely *is* its attributes — visibility timeout, retention, delay, max message size, DLQ redrive, FIFO/content-dedup, KMS key, ARN, created/modified timestamps — and the app currently shows none of them anywhere. It is one command the adapter already imports (F9), one round trip, no new dependency, and the URL is already cached (`sqs/index.ts:72-78`). **This does not violate SPEC §5.1's "SQS reads are never automatic"**: that rule is about `ReceiveMessage` making messages invisible to real consumers, and `GetQueueAttributes` neither receives nor hides anything — worth stating outright because the definition tab *does* load on mount, unlike the stream view's explicit Poll. |
| D10 | **Redis keeps `caps.definition: false`, permanently, and its caps comment is reworded to say why instead of merely stating it.** | F10: a Redis key's type, TTL and memory usage are already on every `KeyValuePage` and already rendered by `KeyValueView`. A definition tab would be a second, staler view of the same three facts, reached by an extra click, for a node kind whose only other property is its name. The honest answer to *"all the other connections where there's some definition to show"* is that Redis is the one with nothing to show — and saying so is better than shipping an almost-empty pane to look complete. |
| D11 | **S3 keeps `caps.definition: false` in this phase, as a deferral with a named follow-up, not a permanent no.** | F10: an *object* already shows its full metadata in the key/value view it opens into (P17), so only a *bucket* has anything new — and a bucket's properties are five separate SDK calls (`GetBucketLocation`, `GetBucketVersioning`, `GetBucketEncryption`, `GetBucketLifecycleConfiguration`, `GetBucketTagging`), each of which a single-bucket IAM policy routinely denies. `s3/catalog.ts:17-37` exists precisely because that policy shape is common, so the realistic outcome is a pane of five "access denied" rows. Doing it properly means per-call degradation and a `notes` line per denial — a real, self-contained piece of work with its own decisions, and not what makes this phase coherent. §5 names it as the follow-up. |
| D12 | **`docs/SPEC.md` is updated in the same commit**: §5.1's Kafka row (*"cluster → topics (folder), consumer groups (folder)"*, partitions no longer a tree level), §8.3's grouping paragraph (which today names only the four SQL kinds), §8.10's row for stream nodes gaining **Open definition** plus a new consumer-group row, §8.11's *"Available wherever `caps.definition` is true"* sentence gaining Kafka topics/consumer groups and SQS queues and describing the Properties sections, §11's per-adapter file list (`kafka/definition.ts`, `sqs/definition.ts` — SPEC.md:601 quotes that fixed shape as a rule), and the P23 phasing row. | The spec is the contract every later phase reads, and three of those lines would otherwise actively misdescribe the app: §5.1 would claim a tree level that no longer exists, §8.3 would claim grouping is a SQL-only affair, and §8.11 would claim the definition view is Postgres/MariaDB/Mongo only. |

## 4. Implementation order

1. **The tree, renderer-only.** Two rows in `grouping.ts`'s `GROUPED_KINDS`, `'topic'` added to
   `isLeafKind()`, `case 'partition'` removed from `menus.ts`'s `menuForRow` switch. Update
   `tests/ui/kafka.spec.ts`: expand `#topic` and `#consumerGroup` before looking for topic/group
   rows, replace the partition-row block (`:137-145`) with "a topic row has no twisty and no
   partition rows exist", and assert expanding a folder issues no IPC — the same assertion
   `tree.spec.ts` already makes for Postgres folders. Nothing engine-side has moved yet, so
   `bun run test:db` is untouched and green.
2. **`hasChildren: false` on topic nodes.** One line in `kafka/catalog.ts:34`, one comment at
   `kafka/index.ts:77` recording D4. `tests/db/kafka.spec.ts` scenario 4 gains a
   `hasChildren === false` assertion on the topic node and keeps its partition enumeration.
   `bun run test:db` green.
3. **The wire shape.** `definitionSectionSchema` + `sections` on `objectDefinitionSchema`
   (`.default([])`); `[]` returned from `postgres/definition.ts`, `mariadb/definition.ts` and
   `mongo/definition.ts`. Nothing renders it yet. Everything green, app unchanged.
4. **`PropertiesSection.vue` and the tolerant load.** `views/definition/state.ts`'s
   `Promise.allSettled`, `DefinitionView.vue`'s Structure body restructured per D8, the `caps.sql`
   gate on Open in console, and `PropertiesSection.vue` itself. Still no engine produces a section,
   so the SQL/Mongo definition tabs must look and behave identically — `tests/ui/definition.spec.ts`
   green with no edits is the check.
5. **Kafka.** `kafka/caps.ts` → `definition: true` (comment updated per the ground rule),
   `kafka/definition.ts` (topic + group builders, `describeConfigs` failure degrading to a `notes`
   line rather than failing the load), `kafka/index.ts`'s `definition()` dispatching on
   `segments[0].kind`, `menus.ts`'s `streamNodeMenu` item and the new `consumerGroupMenu` (D7).
   `tests/db/kafka.spec.ts` scenario 6 flips from "definition rejects" to real topic and group
   assertions; `:102` flips to `true`.
6. **SQS.** `sqs/caps.ts` → `definition: true`, `sqs/definition.ts`, `sqs/index.ts`'s
   `definition()` resolving the URL through the existing cache. `tests/db/sqs.spec.ts:139,175-182`
   updated the same way. `redis`/`s3` caps comments reworded per D10/D11 (no behaviour change);
   their specs' `definition === false` assertions stay.
7. **UI coverage and docs.** `tests/ui/kafka.spec.ts` gains a definition-tab block (open a topic's
   definition, assert the Partitions and Configuration sections and the Source pane's JSON; assert
   **Open in console** is absent); `tests/ui/sqs.spec.ts` gains the queue equivalent. Then
   `docs/SPEC.md` per D12 and this plan committed alongside.

## 5. Explicitly out of scope

- **A definition for Redis** (D10) — permanent, not deferred.
- **A definition for an S3 bucket or object** (D11) — deferred, and the follow-up is named: five
  bucket-metadata calls with per-call degradation to a `notes` line when the policy denies one.
- **A definition for a Postgres/MariaDB sequence or function.** Unchanged from P19 §5 and its §8
  open question 4; `caps.definition` is `true` for those connections but the adapters still throw
  for those paths, which is why D7 does not touch `simpleObjectMenu`.
- **Consumer lag.** D5 ships a group's *committed* offsets from one `fetchOffsets` call. Lag needs
  the high watermark for every topic the group is subscribed to — N more `fetchTopicOffsets` calls
  on a path that must stay one round trip — and it deserves its own decision about refresh
  semantics, since lag is the one number here that is meaningless if stale.
- **Editing anything.** No topic config alteration, no queue attribute change, no consumer-group
  offset reset — even though `kafkajs` exposes `alterConfigs`, `setOffsets` and `resetOffsets`.
  The definition view is read-only in both panes (SPEC §1) and Kafka is read-only for writes other
  than produce (`kafka/caps.ts:19-25`).
- **Folders for Redis, S3, SQS or Mongo levels.** None of those emit `topic` or `consumerGroup`, so
  they are untouched by construction, not by exception (D1) — the same sentence P19's §5 used.
- **Restoring a per-partition browse.** `resolveTopicTarget` already ignores a partition segment
  (F5); the stream view's partition multiselect (F4) remains the only way to narrow a browse, and it
  is unchanged.
- **Persisting or configuring the grouping.** No setting to turn Kafka's folders off, no
  per-connection override — same as P19 §5.
- **`describe()` for Kafka or SQS.** D8 makes the view tolerate its absence rather than inventing an
  `ObjectMeta` shape that would be empty arrays and nulls all the way down.

## 6. Target tree at the end of P23

```
src/shared/
  domain/definition.ts         MOD  definitionSectionSchema + ObjectDefinition.sections (D6)
  domain/tree.ts                --  UNCHANGED ('partition' NodeKind kept, D7)
src/engine/adapters/
  kafka/caps.ts                MOD  definition: true; P10's "no definition" comment rewritten
  kafka/catalog.ts             MOD  listTopics: hasChildren false (D3); listPartitions unchanged
  kafka/index.ts               MOD  definition() dispatching topic|consumerGroup; children()
                                    unchanged + one comment recording D4
  kafka/definition.ts          NEW  buildTopicDefinition / buildGroupDefinition (D5)
  sqs/caps.ts                  MOD  definition: true; comment rewritten
  sqs/index.ts                 MOD  definition() via the existing queueUrls cache
  sqs/definition.ts            NEW  buildQueueDefinition (D9)
  redis/caps.ts                MOD  comment only — why definition stays false (D10)
  s3/caps.ts                   MOD  comment only — why definition stays false for now (D11)
  {postgres,mariadb,mongo}/definition.ts   MOD  sections: [] (D6)
src/renderer/
  project/grouping.ts          MOD  two GROUPED_KINDS rows; 'topic' in isLeafKind (D1/D3)
  project/menus.ts             MOD  open-definition in streamNodeMenu; new consumerGroupMenu;
                                    case 'partition' removed (D7)
  project/state/tree.ts         --  UNCHANGED (the mechanism already generalises, F3)
  project/icons.ts              --  UNCHANGED ('partition' entry stays, D7)
  views/stream/StreamView.vue   --  UNCHANGED (the partition filter still works, F4/D4)
  views/definition/state.ts    MOD  Promise.allSettled; meta may stay null (D8)
  views/definition/DefinitionView.vue  MOD  Structure body no longer requires meta; sections
                                    rendered; Open-in-console gated on caps.sql (D8)
  views/definition/PropertiesSection.vue  NEW  one DefinitionSection, count badge
tests/db/
  kafka.spec.ts                MOD  caps; topic hasChildren; scenario 6 -> real definitions
  sqs.spec.ts                  MOD  caps; scenario 6 -> a real queue definition
  {redis,s3}.spec.ts            --  UNCHANGED (definition still false, deliberately)
tests/ui/
  kafka.spec.ts                MOD  folders; no partition rows; a topic definition tab
  sqs.spec.ts                  MOD  a queue definition tab
  definition.spec.ts            --  UNCHANGED (verified: step 4 must not move SQL/Mongo behaviour)
  tree.spec.ts                  --  UNCHANGED (no Postgres kind is in the two new rows)
docs/
  SPEC.md                      MOD  §5.1, §8.3, §8.10, §8.11, §11, P23 phasing row (D12)
  plans/P23-kafka-tree-and-stream-definitions.md  NEW  this document
```

## 7. Acceptance checklist

- [ ] Expanding a Kafka connection shows exactly two rows — **Topics** and **Consumer groups** —
      both collapsed, both with the folder icon and `data-kind="group"`, at
      `data-path="#topic"` / `data-path="#consumerGroup"`.
- [ ] Expanding either folder issues **zero** IPC calls and creates **zero** op-log rows (D1),
      asserted, not assumed — the same assertion `tree.spec.ts` already makes for Postgres.
- [ ] A folder with no members does not render — a cluster with no consumer groups shows only
      **Topics**.
- [ ] A topic row shows **no twisty**, expands to nothing, and keeps its `N partitions` detail —
      including on a connection whose root listing was cached before the upgrade and has not
      reconnected since (D3).
- [ ] No `partition` tree row exists anywhere, and the tree search still finds a topic by name
      (inside its collapsed folder, which auto-expands on a match).
- [ ] **The stream view's partition filter still works**: opening a Kafka stream tab's partition
      popover lists every partition and filtering by one narrows the browse (F4/D4) — the single
      most important regression check in this phase.
- [ ] Postgres, MariaDB, Mongo, Redis, SQS and S3 trees are byte-for-byte what they are today.
- [ ] **Open definition** appears on Kafka topic and consumer-group rows and on SQS queue rows, and
      on nothing for Redis or S3 (D7/D10/D11).
- [ ] A topic's definition tab opens on **Structure** and shows a **Partitions** section (id, leader,
      replicas, ISR) and a **Configuration** section with count badges; **Source** shows the same
      data as formatted JSON, read-only, and Copy copies it.
- [ ] A config entry Kafka marks `isSensitive` renders masked and its real value appears nowhere in
      the payload (D5).
- [ ] A topic on a cluster that denies `DESCRIBE_CONFIGS` still opens: Partitions renders and a note
      explains the missing config, instead of the whole tab erroring (D5).
- [ ] A consumer group's definition shows its state, its members and its committed offsets; an empty
      group shows an honest empty state rather than an empty table.
- [ ] An SQS queue's definition shows its attributes, with `RedrivePolicy` readable as JSON, and
      **no message is received or made invisible** by opening it (D9) — verified against the
      queue's `ApproximateNumberOfMessages` before and after.
- [ ] **Open in console** does not appear on a Kafka or SQS definition tab, and still appears on
      Postgres/MariaDB/Mongo ones (D8).
- [ ] A Postgres, MariaDB and Mongo definition tab is unchanged in every respect —
      `tests/ui/definition.spec.ts` passes with no edits (D8's regression guard).
- [ ] A definition cached before this phase still loads without a forced refetch (`sections`'
      `.default([])`, F11/D6).
- [ ] `docs/PERF.md`'s cached tree-expand budget still passes unchanged — Kafka's root now renders
      two rows instead of N, so it can only get cheaper.
- [ ] `bun run lint`, `bun run typecheck` (all three) and `bun run build` clean;
      `xvfb-run -a bun run test:ui` and `bun run test:db` green, including the flipped caps
      assertions and the new definition scenarios.

## 8. Open questions for the user

1. **Topics in a folder, or topics first and ungrouped?** D2 folders both root kinds, on the
   argument that a lone "Consumer groups" folder sitting below several hundred topics is not
   findable. The literal reading of the ask — *"have a folder for **other** elements like consumer
   groups"* — is the other option: topics stay at the root exactly as they are, and only the other
   kinds fold. That is a one-row deletion from `GROUPED_KINDS` and mirrors P19's SQL rule precisely,
   at the cost of the consumer-groups folder being below the fold on any real cluster. Worth
   confirming before step 1; it is cheap to steer before and tedious after, since it changes every
   Kafka path in `tests/ui/kafka.spec.ts`.
2. **Is SQS worth including, or should this phase be Kafka-only?** D9 says yes — one command the
   adapter already imports, and a queue's attributes are genuinely invisible in the app today. The
   argument against is that it widens a phase whose spine is the Kafka tree, and that SQS's
   definition is the one place where "some definition to show" is a judgment call rather than an
   obvious yes. Dropping it removes steps 6 and half of 7 and changes nothing else.
