# M5 — PII masking over MCP and in the data viewer

Implementation plan. Chapter v1.7, phase M5. Written against the tree at `aedb799f` (branch `v1.7`).

## 0. Scope

Per-column PII rules per connection. A rule replaces a real value with a **partially redacted**
version of itself, in two places:

1. `run_query` results, before they leave `internal/dbmcp` toward an MCP client.
2. The normal data viewer (`views/grid/` + `views/shared/celleditor/`), behind a per-tab toggle,
   as a display-layer transform that never touches the page store or staged changes.

### What this phase is not

- **No realistic-value replacement.** No Faker, no fake names, no fake emails. M4 was descoped for
  exactly this reason (SPEC's M4 row). `docs/v1.7/plans/M4-faker-bridge.md` is historical record —
  not a dependency, not a seam to build against. If an implementation step reaches for "a plausible
  substitute value", that step is wrong.
- **No hash-as-output.** A digest shown in place of the value is rejected — §2.1 states why.
- **No per-JSON-path rules.** A Mongo document body and a Kafka message body are free-form; rules
  are `table.column` shaped. §4.4 states what happens instead (refuse, not partially mask).
- **No SQL binder.** Result columns are matched by name, never by parsing which base table they
  came from — §4.2 states why, and why that fails safe.

## 1. Confirmed current state

Read directly, not from prior plan prose.

### 1.1 The MCP result path

- `apps/kira-studio/internal/dbmcp/render.go:185` — `renderPage(p page.Page, maxRows int, plan
  *planSummary) (any, error)`. Its own header comment at `render.go:91-94` already names this as
  M5's seam: "One entry point (renderPage) so M5's anonymization filter has exactly one place to
  insert itself, between Query.Execute and this projection". That holds; M5 takes it.
- `render.go:218-237` — `renderTabularPage`. Builds `columns []tabularColumn` from `pg.Columns`,
  then a `returned × len(pg.Chunks)` grid of `*string` via `cellAt` (`render.go:173`). `nil` means
  SQL NULL; `page.IsNull` is the only thing distinguishing NULL from `""` (`render.go:170-172`).
- `render.go:239-270` — `renderDocumentPage`, `renderKeyValuePage`, `renderStreamPage`. Only
  `keyValueResult` carries a per-entry name (`keyValueEntry.Field`, `render.go:135-138`); document
  and stream entries carry opaque bodies.
- `apps/kira-studio/internal/dbmcp/tools.go:248` — the sole `renderPage` call site, in `runQuery`.
  Verified by `find_references` (§10): 6 references, 5 of them in `render_test.go`.
- `tools.go:142-253` — `runQuery`'s gate order, unchanged by this phase: resolve → refuse if all
  three modes deny → clamp `maxRows` → connect → classify → verdict → auto-force-explain → heavy
  check → at most one approval → `Execute` → `renderPage`.
- `tools.go:278-366` — `explainQuery`. Returns a `queryplan.Plan`, no result rows.

### 1.2 Column metadata carries no table origin

`apps/kira-studio/internal/page/builder.go:22-29`:

```go
type ColumnDescriptor struct {
	Name         string
	DataType     string
	TypeClass    TypeClass
	Nullable     bool
	IsPrimaryKey bool
	Generated    bool
}
```

No table, no schema, no source relation. `TabularPage` (`builder.go:76-85`) carries `Columns` and
index-aligned `Chunks`, nothing more. This is the single fact that decides §4.2's matching rule.

`TypeClass` (`builder.go:11-19`) is `number | text | boolean | temporal | binary | json | other` —
usable as a sanity check on a rule, not as a substitute for one.

### 1.3 The connection model and migrations

- `apps/kira-studio/internal/storage/model/connection.go:7-44` — `ConnectionFields`, carrying
  M1's `McpEnabled` (:30), M2's `McpDescription`/`McpReadMode`/`McpWriteMode`/`McpDdlMode`
  (:33-38), M3's `McpAutoExplain` (:43). Header comment (:3-6) records D9: no `password` field in
  this package, enforced by the type.
- **Highest applied migration is 0022**, confirmed on disk, not assumed:
  `apps/kira-studio/internal/storage/migrations/` ends at `0022_m3_connection_mcp_explain.sql`, and
  `migrations/embed.go`'s `names` slice ends at `{22, "m3_connection_mcp_explain", ...}`. M4 shipped
  no migration (descoped before that step). **M5 takes 0023.**
- Table-creating precedent with a connection FK: `0001_init.sql` lines 37, 53, 61, 89, 100 all use
  `connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE`. Foreign keys are on:
  `apps/kira-studio/internal/storage/db.go:54` sets `_foreign_keys=1`.
- Column-adding precedent: `0021_m2_connection_permissions.sql` and `0022`, both stating why a
  first-class column beats an `options_json` key (`options` round-trips through the connection URI
  and the Copy URI menu item, so a safety gate must not be settable by pasting a URI).
- `apps/kira-studio/internal/storage/repos/coderepos.go:10-46` — the plain-repo shape M5's rules
  repo follows: a `selectColumns` const, a `scan*Row(rowScanner)` helper, `List` ordered
  deterministically.

### 1.4 The secret store

- `apps/kira-studio/internal/secrets/scope.go:9-23` — `Scope` is AES-GCM additional authenticated
  data, three values today (`connection`, `variable`, `variable-history`), frozen by
  `cipher_test.go:245`'s `TestScopeStringsAndEnvelopePrefixAreFrozen`. `valid()` (:17) rejects
  anything else, so a new scope is a two-line change plus a frozen-strings test update.
- `apps/kira-studio/internal/storage/repos/secrets.go:21-23` — `SecretsRepo` is "the only file in
  this tree that reads or writes connections.password". Its `Get`/`Set` (:35/:50) encrypt through
  `Cipher.Encrypt(secrets.ScopeConnection, ...)`. This is the precedent M5's correlation key
  follows exactly: a secret column on `connections`, owned by one repo, absent from
  `ConnectionFields`.
- The store has a degraded mode: `secretStatus.available` / `secretStatus.insecureFallback`, surfaced
  in `ConnectionDialog.vue`'s credential note (:865+). §2.5 states what that means for the key.

### 1.5 The grid's display path

The seam is precise and already factored.

- `apps/kira-studio/frontend/src/views/grid/slick/dataSource.ts:25-65` —
  `createDisplayValueExtractor(tabId, page, columnOrder)` returns
  `(item: RowHandle, field: string) => CellView`. Body order: pending-insert branch → staged-edit
  branch → `cell(tabId, item.row, pageCol)`.
- `apps/kira-studio/frontend/src/views/grid/page.ts:20-42` — `CellView { text, isNull, truncated }`
  and `cell()`. **`cell()` memoises the built `CellView` through `store.cachedView` (page.ts:37).**
  Mutating the returned object poisons that cache for the tab's lifetime. §6.2 turns this into a
  hard rule.
- `SlickGridHost.vue:507-521` — `dataSourceState(p, order)`, which sets
  `extractValue: createDisplayValueExtractor(props.tabId, p, order)`.
- `SlickGridHost.vue:1971-1972` — the grid option
  `dataItemColumnValueExtractor: (item, columnDef) => dataSource?.extractValue(item, String(columnDef.field))`.
  Bound once at construction; `dataSource.setState` swaps the closure without rebuilding the grid
  (`shared/slick/dataSource.ts:213-216`).
- `SlickGridHost.vue:174-213` — `cellFormatter`. Receives exactly what `extractValue` returned
  (`render.go`-style comment at :182-186 says so). NULL → `{text:'NULL', addClasses:'cell-null'}`,
  truncated → `cell-truncated`, insert rows → a live `<input>`.
- `SlickGridHost.vue:310-312` — `displayCell(row, displayCol)`, delegating to the same shared
  helper the extractor uses.
- `SlickGridHost.vue:2296-2343` — the `SelectedCell` publication watch. `value: view.isNull ? null :
  view.text` comes from `displayCell(...)` (:2318), and `onEdit`/`onRevert` (:2333-2338) are set
  only when `canEditTable() && !isDeleted(targetRow)`.
- `SlickGridHost.vue:237-239` — `canEditTable() = isWritable() && hasPrimaryKey() && !!caps()?.canUpdate`.
  `SlickGridHost.vue:246-253` — a `computed` wrapping it feeds the `editable`-sync watch via
  `grid.setOptions`.
- `apps/kira-studio/frontend/src/views/grid/state.ts:44` — `searchOpen: boolean` in
  `DataViewRuntime`, defaulted at :61. Per-tab, session-only. The mask-preview flag joins it.
- `apps/kira-studio/frontend/src/views/grid/menu.ts:466-543` — `headerMenu(ctx)`: sort asc/desc,
  clear sort, hide column, show all, copy column name, copy column values. `menu.ts:60` —
  `qualifiedNameForPath(connectionId, path)` already resolves a tab's target to a qualified name.
- `apps/kira-studio/frontend/src/views/grid/DataToolbar.vue:51-53` — `isWritable`; :226-280 — the
  existing `IconButton` row (`toolbar-count`, `toolbar-columns`, `toolbar-add-row`,
  `toolbar-generate-data`, `toolbar-delete-row`, `toolbar-search`).

### 1.6 The cell editor

- `apps/kira-studio/frontend/src/state/cellSelection.ts:7-39` — `SelectedCell`. `value` is "the
  decoded server text" (:23), `onEdit?`/`onRevert?` are set only by a publisher that can genuinely
  stage a write (:28-38): absent means the panel forces read-only.
- `apps/kira-studio/frontend/src/views/shared/celleditor/state.ts:10-14` — `ReadOnlyReason` is a
  four-value union (`connection-read-only`, `value-truncated`, `no-primary-key`,
  `not-editable-yet`); `readOnlyReasonFor` (:38-44) resolves it, connection-read-only first.
- `CellEditorView.vue:98` calls `readOnlyReasonFor`; :114-130 map each reason to a chip label and
  an explanation.
- `CellEditorDock.vue:20` — `selectedCellFor(props.tabId)` is the panel's only input.

### 1.7 The connection dialog and settings

- `ConnectionDialog.vue:110` — `type DetailTab = 'General' | 'Advanced' | 'Pre-connect' | 'MCP'`;
  :495-537 the `.p-tab-strip`; :302-310 `TAB_FOR_FIELD` routing a field error to its tab.
- `ConnectionDialog.vue:779-849` — the MCP tab pane: enable checkbox, description textarea,
  auto-explain checkbox, three `SegmentedControl`s, helper text. **Already trimmed twice to fit the
  dialog's fixed box** (`5e77928b`, `ef2ed03b`). §7.4 uses this fact.
- `SettingsDialog.vue:125` — `'Database MCP'` section; :1117-1160 its pane; M2 added a read-only
  per-row glance to the "Exposed connections" list there (SPEC's M2 result paragraph).
- `packages/shared/domain/dbmcp.ts` — this chapter's own zod domain (M1's status schemas, M3's
  approval-plan schemas). M5's rule schema lands here.
- Bridge shape: `internal/bridge/connections.go:10-12` — a struct with `Deps appcore.Deps` and
  exported methods, registered at `apps/kira-studio/main.go:371` via
  `application.NewService(&bridge.ConnectionsService{Deps: deps})`. Args structs are per-method
  (`ConnectionsUpdateArgs`, :22-25), validated with `ipcerr.BadRequest`.

## 2. The masking design

### 2.1 Why masking, not hashing

Plain prose, because the reasoning is the point.

A salted hash of a low-cardinality value is not private. A first name, a ZIP code, a two-letter
country code, a birth year, a boolean-ish status word — each of these draws from a candidate set
small enough to enumerate. An attacker who holds the salt hashes every candidate once and reads the
answer straight off a lookup table. This is a property of the *input's* entropy, not of the hash
function: SHA-256 and Argon2id both fall to it, the second just more slowly. Salting and stretching
raise the cost of the enumeration; they do not change the fact that the enumeration terminates.

Masking is not vulnerable to that attack because there is nothing to invert. When the mask for
`Gonzalez` is `G•••••••`, the seven redacted characters were not transformed into something else —
they were discarded before the value left the process. No amount of computation recovers a
character that was never encoded into the output. The only information an attacker gets is exactly
the information the rule chose to keep, and each rule below states precisely what that is.

### 2.2 Why a keyed correlation tag is nonetheless required, and why it is not the rejected hash

The requirement is stated in the SPEC's M5 row: "Deterministic per real value (same input always
produces the same masked output within a connection), so correlation and referential joins across a
foreign key survive."

That requirement, taken literally, forces a function with two properties: equal inputs give equal
outputs, and *unequal inputs give unequal outputs*. The second half is what makes a join correct. A
purely positional mask does not have it — `James` and `Jamal` both mask to `J••••`, so a join on
the masked column produces rows that do not belong together, and a `GROUP BY` undercounts. The
information an AI client would draw from such a result is wrong, which is worse than absent.

So the design separates two things that are easy to conflate:

- **The redaction** is the visible transform of the real value. It is destructive and unkeyed. It
  is the thing the user asked for.
- **The correlation tag** is a short opaque token that travels beside the redaction, carrying
  identity and nothing else. It is `HMAC-SHA256` under a per-connection secret key, truncated.

The tag is not the rejected mechanism, for one specific reason: **the adversary does not have the
key.** The dictionary attack described in §2.1 requires computing the transform over candidate
inputs. An attacker can compute `SHA256(salt || "James")` because a salt travels with the data. They
cannot compute `HMAC(K, "James")` without `K`, and `K` is never sent to an MCP client, never written
to the rules table, never shown in any UI, and never leaves the app process except as ciphertext in
the keychain-backed secret store (§2.5). Under that assumption the tag is an unlinkable pseudonym.
Drop the assumption — hand an attacker the key — and the tag *is* dictionary-attackable for a
low-entropy column. That is stated honestly rather than argued away: key secrecy is the load-bearing
control, and §2.5 places the key accordingly.

Truncation to 30 bits (§2.4) is a second, weaker line: it is there to limit cross-dataset linkage
and to keep the cell readable, not to defeat a key-holder.

A rule may set `correlate: false`, in which case no tag is emitted for that column and no key is
ever needed for it. If every rule on a connection sets it false, the connection never gets a key at
all.

### 2.3 Mask kinds, per PII class

Seven kinds. Each states what is kept, what is destroyed, and why that split is "not usable for
identification but still somewhat informative".

Universal rules, ahead of the table:

- **NULL is never masked.** A NULL cell stays NULL (`nil` in `render.go`'s `[][]*string`,
  `isNull: true` in the grid's `CellView`). Masking a NULL would invent a value that is not there.
- **Empty string stays empty.** Same reason.
- **A kind that cannot apply falls through to `redact`**, never to the original. A `number` rule on
  a non-numeric cell, a `date` rule on unparseable text, an `email` rule on a value with no `@` —
  all emit `[redacted]`, never an echo. Fail closed, everywhere, with no exceptions.
- **The redaction glyph is `•` (U+2022)**, one per destroyed character where a length hint is kept.
  Chosen over `*` because `*` is a SQL wildcard and a shell glob and reads as syntax in a result an
  AI client will compose SQL against.
- **Length hints count Unicode graphemes**, not bytes and not UTF-16 units, so a masked CJK or
  emoji-bearing value does not lie about its size.

#### `name` — a short human-readable text field

Keep: the first grapheme of each whitespace-separated word, plus each word's length.
Destroy: every other character.

```
Maria Gonzalez   ->  M•••• G•••••••#K7QW3F
Bob              ->  B••#3ZB1PX
```

Why: the shape is informative — a human or an AI reads "two words, a name, roughly this long" and
can tell the column holds people, not product codes. The initials and lengths are a quasi-identifier
over a small population (initial + length pins a name in a table of a few hundred employees more
often than is comfortable), so `keepHint: false` drops the initials and emits `••••• ••••••••`
instead. The plan states this residual weakness rather than pretending the default is safe for every
table; `redact` is the right kind for a column where even the shape matters.

#### `email`

Keep: the domain after the last `@`, in full; the local part's first grapheme and its length.
Destroy: the rest of the local part.

```
maria.gonzalez@acme.example  ->  m•••••••••••••@acme.example#K7QW3F
```

Why the domain stays: a domain is organizational, not personal. It is shared across every row from
the same employer or provider, so it identifies nobody on its own, and it is the part an AI actually
reasons with — "these rows are internal, those are gmail" is useful for understanding the table. A
rare or vanity domain *is* identifying, which is why `keepHint: false` redacts the domain too
(`•••••••••••••@••••••••••••`). A value with no `@` is not an email: it falls through to `name`'s
shape, never emitting more than that would.

#### `text` — free text: a note, an address, a comment

Keep: nothing of the content. A bucketed length only.
Destroy: everything.

```
"14 Rue de la Paix, 75002 Paris"  ->  ••• (text, 16-32 chars)#K7QW3F
```

Why no first character and no exact length: the first word of an address or a note is frequently the
entire giveaway — a house number, a surname, a diagnosis. And the *exact* length of a free-text
field is itself a strong fingerprint; in a table of a few thousand addresses, an exact character
count narrows the candidates sharply. Buckets are fixed powers of two (`0`, `1-8`, `8-16`, `16-32`,
`32-64`, `64-128`, `128-256`, `256-512`, `512+`), public and data-independent, so a bucket boundary
never leaks anything about the table's own distribution.

#### `number` — a magnitude: salary, balance, age, count

Keep: the sign and the order of magnitude, as a fixed decade range.
Destroy: every digit.

```
 4823  ->  [1000-10000)
  -17  ->  (-100--10]
    0  ->  0
```

Why a range and not full redaction: the user's stated goal is "not usable for identification but
still somewhat informative". A salary column where every cell reads `[redacted]` teaches an AI
client nothing — it cannot write a sensible `WHERE`, cannot judge whether a filter will return three
rows or three million, and cannot tell cents from dollars. A decade-wide bucket cannot identify
anyone and answers all three questions. The boundaries are **fixed powers of ten, never derived from
the data**: a quantile bucket would leak the column's distribution and would also not be
deterministic, since a different page would produce different quantiles for the same real value.

Zero maps to `0` rather than a bucket. Zero is not identifying, and it is a very common, very
meaningful value — collapsing it into `[0-1)` alongside `0.004` destroys a signal for no privacy
gain. This is a stated exception, not an oversight.

**`number` never carries a correlation tag.** Appending one makes the cell non-numeric, and there is
no honest way to keep a value both bucketed and joinable — the bucket is many-to-one by
construction. A numeric column that is actually a key (a customer id stored as an integer) must use
`id`, not `number`. The UI (§7.4) says so where the kind is chosen.

#### `id` — an opaque identifier: a customer id, an account number, a UUID, a foreign key

Keep: nothing.
Emit: the correlation tag alone.

```
7f3c1a9e-... ->  #K7QW3F
CUST-004823  ->  #M2BX0T
```

Why: an identifier's only content is identity. Magnitude, length and prefix carry no analytical
value and do carry re-identification risk (`CUST-000001` is the first customer; a sequential id
leaks ordering and volume). Identity is exactly what must survive and exactly what must not be
recoverable — which is what the tag is. This is the kind the SPEC's "join on a masked foreign key"
requirement lives in: `orders.customer_id` and `customers.id` holding the same real value produce
the same tag, so the join is correct, and neither side reveals the value.

`correlate: false` on an `id` rule is refused at validation time — it would emit `[redacted]` for
every row, which is what `redact` is for.

#### `date` — a temporal value: date of birth, a signup timestamp

Keep: the year, and the value's own granularity shape.
Destroy: month, day, and every time component.

```
1987-03-14            ->  1987-••-••
2024-06-01T09:31:22Z  ->  2024-••-••T••:••:••Z
```

Why the year stays: a year alone is shared by millions and identifies nobody, while being the one
part an AI genuinely needs — cohort reasoning, retention windows, "how fresh is this data". Month
and day are the parts that combine with other quasi-identifiers into a re-identification: the
date-of-birth + postal-code + sex triple is the textbook example, and it works because the day
narrows a population by a factor of ~365. `keepHint: false` drops the year too (`••••-••-••`).

Unparseable temporal text falls through to `text`, never echoed.

`date` carries a tag only when `correlate` is on and the rule is on a text-class column; a masked
date is a poor join key and the UI defaults `correlate` off for this kind.

#### `redact` — keep nothing, say nothing

Output: the literal `[redacted]`, plus the tag when `correlate` is on.

Why it exists: it is the correct default for a column whose classification the user is unsure of,
and the only correct answer for a column whose *shape* is sensitive — a free-text clinical note, a
credential, a security answer. It is also §2.3's universal fall-through target.

### 2.4 The correlation tag, exactly

```
tag(v) = "#" + crockfordBase32(HMAC-SHA256(key, v))[0:6]
```

- `key` — 32 random bytes, per connection (§2.5).
- The HMAC message is the value's raw UTF-8 bytes and **nothing else**. No column name, no table
  name, no rule identity is mixed in. That is deliberate: mixing the column in would give
  `customers.id` and `orders.customer_id` different tags for the same customer, breaking exactly the
  foreign-key join the requirement names. The scope of a tag is the connection, and nothing finer.
- The consequence is stated rather than hidden: if the same real value appears in two unrelated
  columns, the masked output reveals that they are equal. That is the requirement working, not a
  leak.
- Crockford base32 (no `I`, `L`, `O`, `U`) so a tag never reads as a word and never confuses `0`/`O`
  when a human retypes it.
- **6 characters = 30 bits.** Collision probability by the birthday bound is about 1.9e-5 across a
  200-row page (`runQueryDefaultMaxRows`, `tools.go:116`) and about 1.9e-3 across a 2000-row page
  (`runQueryMaxMaxRows`, :117). Two distinct values colliding produce one false join row. That is
  acceptable at these page sizes and is recorded here so a later reader does not have to rederive
  it. Not 8+ characters: a longer token dominates the cell visually and buys precision the page size
  cannot use.

### 2.5 Where the key lives, and whether a salt is needed

**Masking itself needs no key and no salt.** The redaction in §2.3 is a pure function of the value's
text — that is exactly what makes it uninvertible, and exactly why M4's salt-plus-seed sketch does
not carry over. Nothing in this design uses a salt.

The key exists solely for the correlation tag.

- **Scope: per connection.** Not global — two connections holding the same customer must not produce
  cross-linkable output unless the user deliberately wants that, and per-connection matches M1/M2/M3's
  whole model. Not per column or per rule — that breaks the joins §2.4 exists to preserve.
- **Storage: the existing keychain-backed secret store**, following `SecretsRepo`'s precedent
  exactly (§1.4). A new `secrets.ScopeMaskKey Scope = "mask-key"` (`scope.go:11-15`, plus `valid()`
  at :17 and the frozen-strings test at `cipher_test.go:245`). The ciphertext lives in a new
  `connections.mask_correlation_key TEXT NOT NULL DEFAULT ''` column, read and written only by a new
  `MaskKeysRepo` — the same "only file that touches this column" discipline `secrets.go:21-23`
  states. **It is not a `ConnectionFields` field** (model/connection.go:3-6's D9), so it cannot
  reach the renderer, the connection URI, or the Copy URI menu item.
- **Not in the rules table and not a plain column.** A plaintext key sitting beside the rules would
  mean anyone who can read the app's SQLite file can recompute every tag for every value — which is
  the dictionary attack of §2.1, one file away. The whole argument in §2.2 depends on this.
- **Lazy creation.** The key is generated on first use: the first time a connection renders a mask
  whose rule has `correlate: true`. A connection with no correlating rule never has one.
- **Rotation is manual and explicit.** A "Regenerate correlation key" action in the Privacy tab
  (§7.4), behind a plain-language confirmation: regenerating changes every tag, so masked output
  already shared with an AI client or a colleague no longer correlates with anything produced
  afterwards. Never automatic — an automatic rotation would silently break a running analysis.

One security caveat, stated plainly rather than buried. The secret store has a degraded mode: when
the OS keychain is unavailable, `internal/secrets` falls back to a weaker local mechanism, which the
connection dialog already surfaces to the user as `secretStatus.insecureFallback` (§1.4). The
correlation key inherits that posture exactly. On a machine in fallback mode, an attacker with
filesystem access can recover the key, and with the key the tag becomes dictionary-attackable for a
low-entropy column, per §2.2. The redaction itself is unaffected — it stays uninvertible under any
key compromise, because there is no key involved. The Privacy tab must say this where the user can
see it, using the same credential-note pattern the dialog already has, rather than leaving the user
to assume the tag is as strong as the redaction.

### 2.6 Determinism, restated as the actual mechanism

Resolving open question 2 with one answer, not two options:

**The mask's visible characters do not depend on the real value's content beyond what the rule
explicitly keeps; the per-value distinction is carried entirely by the keyed tag.**

Concretely, for `name`: the initials and the length come from the value (both are declared "kept"),
the `•` runs carry no information, and `#K7QW3F` is the only part that distinguishes one `J•••••`
from another. The HMAC never chooses *which* characters get redacted and never selects a bucket —
those are fixed by the rule and by the value's shape. Keeping the HMAC out of the redaction decision
matters: a value-dependent redaction pattern would be a side channel, leaking bits of the real value
through the positions it chose to keep.

The whole function is `mask(rule, key, value)`, pure and total, with no stored per-value mapping
table. A mapping table was considered and declined: it would have to persist every real PII value
the user has ever viewed, in the app's own database, which is a new copy of exactly the data this
phase exists to keep from leaking — strictly worse than a computed mask on every axis that matters.

## 3. Storage

### 3.1 Migration `0023_m5_column_mask_rules.sql`

```sql
-- M5: per-column PII masking rules, and the per-connection correlation key they use.
--
-- A table, not an options_json key and not a blob on `connections`: the rule set is queried by
-- (connection_id, column_name) on every run_query render (plan §4.2), listed in two UIs, and edited
-- one row at a time. 0021's own reasoning also applies — `options` round-trips through the
-- connection URI and the Copy URI menu item, and a privacy rule must not be settable, or
-- clearable, by pasting a URI.
CREATE TABLE connection_mask_rules (
  id            TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  -- '*' matches any table. A concrete name is kept even though matching is by column name alone
  -- (plan §4.2): it is what makes a rule legible in the UI and what the grid's header menu writes.
  table_name    TEXT NOT NULL,
  column_name   TEXT NOT NULL,
  -- name | email | text | number | id | date | redact
  mask_kind     TEXT NOT NULL,
  -- Keep this kind's own small hint: the initials for `name`, the domain for `email`, the year for
  -- `date`. Meaningless for text/number/id/redact, stored anyway so the column stays one flag
  -- rather than three kind-specific ones.
  keep_hint     INTEGER NOT NULL DEFAULT 1,
  -- Emit the keyed correlation tag (plan §2.4). Forced 0 for `number`, forced 1 for `id`.
  correlate     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- Matching is case-insensitive (plan §4.2), so uniqueness must be too — otherwise `Email` and
-- `email` are two rows that collapse to one at render time, and which one wins is arbitrary.
CREATE UNIQUE INDEX connection_mask_rules_unique
  ON connection_mask_rules(connection_id, lower(table_name), lower(column_name));
CREATE INDEX connection_mask_rules_conn ON connection_mask_rules(connection_id);

-- The per-connection correlation key (plan §2.5), stored as a kira:v3 envelope under the new
-- `mask-key` secret scope. '' means "no key yet" — minted lazily on the first correlating render.
-- Read and written only by MaskKeysRepo, the same single-owner discipline SecretsRepo has for
-- `password`; deliberately absent from ConnectionFields (model/connection.go D9).
ALTER TABLE connections ADD COLUMN mask_correlation_key TEXT NOT NULL DEFAULT '';
```

Register in `migrations/embed.go`'s `names`: `{23, "m5_column_mask_rules", "0023_m5_column_mask_rules.sql"}`.

### 3.2 Model and repos

New `apps/kira-studio/internal/storage/model/maskrule.go`:

```go
type MaskKind string

const (
	MaskKindName   MaskKind = "name"
	MaskKindEmail  MaskKind = "email"
	MaskKindText   MaskKind = "text"
	MaskKindNumber MaskKind = "number"
	MaskKindID     MaskKind = "id"
	MaskKindDate   MaskKind = "date"
	MaskKindRedact MaskKind = "redact"
)

type MaskRule struct {
	ID           string   `json:"id"`
	ConnectionID string   `json:"connectionId"`
	TableName    string   `json:"tableName"`
	ColumnName   string   `json:"columnName"`
	Kind         MaskKind `json:"kind"`
	KeepHint     bool     `json:"keepHint"`
	Correlate    bool     `json:"correlate"`
	CreatedAt    string   `json:"createdAt"`
	UpdatedAt    string   `json:"updatedAt"`
}

type MaskRuleFields struct { /* TableName, ColumnName, Kind, KeepHint, Correlate */ }

func ValidMaskKind(v string) bool
```

`ValidMaskKind` mirrors the zod enum, the way `ValidMcpPermissionMode` (`connection.go:105`) mirrors
`mcpPermissionModeSchema`.

New `apps/kira-studio/internal/storage/repos/maskrules.go` — `MaskRulesRepo`, following
`coderepos.go`'s shape: `maskRulesSelectColumns` const, `scanMaskRuleRow(rowScanner)`,
`ListForConnection(connectionID)` ordered `lower(table_name), lower(column_name)`, `Upsert(fields)`
(on the unique index), `Remove(id)`, `CountByConnection()` for the Settings glance (§7.5).

New `apps/kira-studio/internal/storage/repos/maskkeys.go` — `MaskKeysRepo`, a near-copy of
`secrets.go`'s two methods against `connections.mask_correlation_key` under `secrets.ScopeMaskKey`,
constructed the same way `NewSecrets(db, cipher)` is (`secrets.go:30-32`) because it needs the same
`Cipher` that does not exist inside `repos.New`. Methods: `Get(connectionID) (*[]byte, error)`,
`EnsureKey(connectionID) ([]byte, error)` (get-or-mint, 32 bytes from `crypto/rand`),
`Regenerate(connectionID) error`.

Also update `repos/connections.go`: its write statements must not clobber `mask_correlation_key`.
Confirmed live via `find_references` on `McpAutoExplain` (§10) — five writers, six bind sites:
`Insert` (:195), `Update` (:231), `InsertWithSecret` (:283), `InsertDuplicateWithSecret` (:337),
`UpdateWithSecret` (:385 and :401). None of them names the new
column, so none clobbers it; `InsertDuplicateWithSecret` in particular must **not** copy it, so a
duplicated connection gets its own key and its tags are not linkable to the original's. Add a
one-line comment there saying so, and a repo test asserting it (§8).

## 4. Backend: masking on the MCP path

### 4.1 The masking package

New `apps/kira-studio/internal/mask/` — a leaf package, importing only stdlib. No dependency on
`dbmcp`, `page` or `model` (it takes plain strings and its own `Rule` struct), so the frontend port
and the Go original have identical, testable surfaces.

```go
package mask

type Kind string  // name | email | text | number | id | date | redact

type Rule struct {
	Kind      Kind
	KeepHint  bool
	Correlate bool
}

// Masker holds one connection's resolved key. A zero key means no rule on this connection
// correlates; Apply then never calls tag().
type Masker struct{ key []byte }

func New(key []byte) *Masker

// Apply masks one non-NULL cell. Total: every input produces an output, and no input path returns
// the original text (plan §2.3's fail-closed rule).
func (m *Masker) Apply(r Rule, value string) string
```

Plus unexported `maskName`, `maskEmail`, `maskText`, `maskNumber`, `maskID`, `maskDate`,
`lengthBucket`, `decadeRange`, `tag`.

### 4.2 Matching a result column to a rule

Resolving open question 4(a).

`page.ColumnDescriptor` carries no table origin (§1.2) and `run_query` takes arbitrary SQL. So:

**Rules are matched by column name alone, case-insensitively, across every rule on the connection,
ignoring `table_name`.**

Why not parse the SQL to attribute each result column to a base table: this app has no name
resolver and no binder. Attributing `SELECT c.name FROM customers c JOIN orders o USING (id)` to
`customers.name` correctly requires per-dialect alias and scope resolution, subquery and CTE
handling, and `SELECT *` expansion against live metadata. Every one of those has failure modes, and
**every failure mode leaks a real PII value** — the parse misses, no rule matches, the raw value
goes out. Column-name matching has the opposite failure mode: it over-masks (a non-PII `name` column
in an unrelated table also gets masked), which costs an AI client some utility and costs the user
nothing. That is the right direction to be wrong in, and it is why `table_name` is display metadata
rather than a matching key.

`table_name = '*'` is supported and means "any table" explicitly, so a user can express the
already-effective semantics deliberately.

**Conflict resolution.** Two rules with the same `column_name` under different tables can disagree.
Fold to the stricter, by an explicit rank (most redacting first):

```
redact > id > text > date > email > name > number
```

and within one kind, `keepHint: false` beats `keepHint: true`, `correlate: false` beats
`correlate: true`. Same posture as M2's `strictestOf` (`permissions.go:22-30`): an ambiguity must
never resolve to the more permissive option.

**Cost.** Resolving open question 4(a)'s second half: the lookup is **per column, once per call**,
never per row. Before the row loop in `renderTabularPage`, build a `[]*mask.Rule` index-aligned with
`pg.Columns`. The inner loop does one nil check per cell. A page with no matching column allocates
one nil slice and pays nothing further.

### 4.3 The insertion point

`renderPage` (`render.go:185`) gains a fourth parameter:

```go
func renderPage(p page.Page, maxRows int, plan *planSummary, mk *maskset) (any, error)
```

where `maskset` is `dbmcp`'s own small struct holding the resolved `*mask.Masker` and the
connection's folded `map[string]mask.Rule` (lowercased column name → rule). A nil `mk` means no
rules on this connection and the projection behaves exactly as it does today.

`renderTabularPage` gains the same parameter and does the per-column resolve described in §4.2, then
masks inside `cellAt`'s result:

```go
for c, chunk := range pg.Chunks {
	v := cellAt(chunk, r)
	if v != nil && rules[c] != nil {
		masked := mk.masker.Apply(*rules[c], *v)
		v = &masked
	}
	row[c] = v
}
```

`nil` (SQL NULL) passes through untouched, per §2.3.

`renderKeyValuePage` also masks: a Redis hash field or an S3 metadata key **is** column-shaped, so a
rule whose `column_name` matches `keyValueEntry.Field` masks that entry's `Value`. Ten lines, and
declining it would leave an obvious hole on exactly the engines where a hash of user attributes is
the normal storage pattern.

`renderDocumentPage` and `renderStreamPage` do **not** mask — §4.4.

Call-site change in `tools.go:248`: build the maskset before `Execute` (so a key-store failure fails
the call before the query runs, not after), then pass it.

### 4.4 Non-tabular pages: refuse, not partially mask

A Mongo document body and a Kafka message body are free-form JSON/bytes. A `table.column` rule does
not address anything inside them, and no amount of per-column matching makes it.

**Decision: on a connection with at least one mask rule, a `run_query` call whose result is a
document or stream page is refused**, before rendering:

```
this connection has PII masking rules, which cannot be applied to a document result; masking rules
address table columns, and a document body has none — narrow the query to a projection, or remove
the rules in the connection's Privacy tab
```

Why refuse rather than return unmasked with a warning flag: returning the rows would ship real PII
to an AI client from the one place PII most often lives unstructured, with the user believing
masking is on. A flag in the JSON does not undo that — the data has already left. CLAUDE.md's
"scope left out of a phase stays out entirely, never half-implemented" points the same way.

Per-JSON-path rules are the real answer for document stores and are explicitly out of scope for M5,
not stubbed.

### 4.5 `explain_query` and the metadata tools

- **`explain_query` is unchanged.** A plan carries no result rows. An EXPLAIN body can echo literal
  filter values, but those literals came from the SQL the client itself sent — echoing a client's
  own input back is not a leak. Stated here so a reviewer does not read the omission as an oversight.
- **`list_connections` gains a `maskedColumns` field**: an array of `"table.column: kind"` strings,
  sorted, capped at 50 with a trailing `"+N more"` entry. An AI client that does not know a column
  is masked will misread `[1000-10000)` as a literal, so the one tool the server's own
  `instructions` (`server.go:127`) already tells it to call first must say so. Cheap: one repo read
  per `list_connections` call, which is a human-frequency operation.
- **`describe_table`/`describe_schema` are unchanged.** Both return `tree.*Result` shapes owned by
  `internal/tree`; threading a marker through them means changing a metadata contract three other
  callers share, for information `list_connections` already carries. Declined deliberately.
- The server's `instructions` string (`server.go:127`) gains one sentence: masked columns are listed
  per connection by `list_connections`, their values are redacted, and a `#TAG` suffix is an opaque
  correlation token that is equal when and only when the real values are equal.

### 4.6 Service and bridge

New `apps/kira-studio/internal/maskrules/service.go` — `Service`, holding `*repos.MaskRulesRepo`,
`*repos.MaskKeysRepo` and a small read cache. Methods:

- `List(connectionID) ([]model.MaskRule, error)`
- `Upsert(connectionID string, f model.MaskRuleFields) (model.MaskRule, error)` — validates kind,
  rejects empty `column_name`, forces `correlate=false` for `number` and `correlate=true` for `id`
  (§2.3).
- `Remove(id string) error`
- `RegenerateKey(connectionID string) error`
- `MaskSetFor(connectionID) (*maskset, error)` — the folded map of §4.2 plus a lazily-minted key;
  this is what `dbmcp` consumes.
- `Counts() (map[string]int, error)` — the Settings glance.

`dbmcp` consumes it through a new consumer-declared interface beside `ConnectionsReader`/
`MetadataReader`/`QueryRunner` (`server.go:46-69`), per that file's A11 note:

```go
// MaskRules is dbmcp's own consumer-declared interface over *maskrules.Service — the only thing
// run_query's render path needs. A nil Config.MaskRules means no masking, which is a construction
// error, not a default: New rejects it, the same way it rejects a nil Approvals.
type MaskRules interface {
	MaskSetFor(connectionID string) (mask.Set, error)
}
```

Required in `Config`, validated in `New` (`server.go:143-151`) alongside the existing required
fields. A silently-nil masker would mean every query returns unmasked data with nothing surfacing —
exactly the failure mode `ExplainThreshold`'s own comment (`server.go:90-94`) guards against.

New `apps/kira-studio/internal/bridge/maskrules.go` — `MaskRulesService{Deps appcore.Deps}` with
`List`, `Upsert`, `Remove`, `RegenerateKey`, `Counts`, each taking a per-method args struct validated
with `ipcerr.BadRequest`, following `connections.go:22-31`. Registered in `main.go` beside
`ConnectionsService` (`main.go:371`) and added to `ipcfixture/harness.go:93`'s service set.

## 5. Frontend: the shared masking port

The grid preview must produce byte-identical output to the Go masker, or the toggle lies about what
an AI client sees.

**Port the algorithm to TypeScript and pin both against one shared fixture set** — M3's exact
precedent (`internal/queryplan/parse_test.go:14-19` reads
`apps/kira-studio/tests/fixtures/explain-plans/*.{input,expected}.json`, and
`apps/kira-studio/tests/unit/explain-plan.spec.ts` reads the same files, so drift in either port
fails on the same bytes).

- New `packages/shared/domain/mask.ts` — the zod schemas (`maskKindSchema`, `maskRuleSchema`,
  `maskRuleFieldsSchema`) and the pure masking functions, mirroring `internal/mask/` function for
  function.
- New `apps/kira-studio/tests/fixtures/mask/*.{input,expected}.json` — one case per kind, plus the
  edge cases: NULL, empty string, a kind applied to an incompatible value (each of the seven
  fall-through paths), a grapheme-cluster value (emoji, combining marks), an email with no `@`, an
  email with multiple `@`, a negative number, zero, each length-bucket boundary, each decade
  boundary, an unparseable date, and a fixed-key tag vector.
- HMAC on the TS side comes from Web Crypto (`crypto.subtle.importKey`/`sign`), already available in
  the renderer; no new dependency. The tag is therefore async in TS and sync in Go — §6.3 handles
  that.

The alternative — calling into Go per cell over IPC — is rejected on its face: a 200×20 page is
4,000 round trips per render.

## 6. Frontend: the grid and cell-editor preview

### 6.1 Framing, stated once

**The grid toggle is a preview, not a control.** The security boundary is the MCP path (§4), where
the user is not the adversary. The toggle exists so a human can see what an AI client sees, over
their own data, on their own machine — where they already hold the real values. Several questions
below (search, clipboard) only have clean answers once that is said out loud, so it is said here and
must appear in the implementation's own comments.

### 6.2 Where the toggle lives and how it intercepts

Resolving open question 4(b).

- **Control**: a new `IconButton` in `DataToolbar.vue`, beside the existing row (:226-280),
  `data-testid="toolbar-mask-preview"`, icon `eye-closed`. Rendered only when the tab's connection
  has at least one mask rule — a permanently inert toggle is worse than no toggle
  (`deleteRowTooltip`'s own standing rule at `DataToolbar.vue:74-78`: name the condition, never a
  silently-disabled control).
- **State**: `maskPreview: boolean` in `DataViewRuntime` (`views/grid/state.ts:44`, beside
  `searchOpen`), defaulted `false` at :61, with `setMaskPreview`/`toggleMaskPreview` exported from
  the same factory. Per-tab, session-only, never persisted — a masked view must not silently outlive
  the session and leave a user reading buckets as real numbers tomorrow.
- **Mechanism**: `createDisplayValueExtractor` (`views/grid/slick/dataSource.ts:25`) gains a fourth
  parameter, a `(CellView, field) => CellView` transform resolved by `dataSourceState`
  (`SlickGridHost.vue:507-521`) from the tab's rules and the page's columns. When mask preview is
  off it is `undefined` and the extractor is byte-for-byte what it is today.
- **The transform returns a new object; it never mutates.** `page.ts:37`'s `store.cachedView`
  memoises the `CellView` that `cell()` returns. Writing `view.text = masked` poisons that cache for
  the tab's lifetime — the mask would survive the toggle going off, with nothing to clear it short
  of a reload. This is the single highest-value comment in the diff. Write it at the transform.
- **Re-render**: a watch on `rt()?.maskPreview` calls `dataSource.setState(dataSourceState(p,
  order))` then `grid.invalidateAllRows()` + `grid.render()`. The page store is untouched; only the
  closure is swapped, which is exactly what `shared/slick/dataSource.ts:174-183`'s header comment
  says `setState` is for.
- The `#TAG` suffix gets a `.cell-masked` class via `cellFormatter`
  (`SlickGridHost.vue:174-213`), styled muted, so a masked cell is visually distinct from a real one
  at a glance. This is the one visual affordance that keeps a user from misreading the preview.

### 6.3 The async-HMAC problem

`cellFormatter` runs inside SlickGrid's synchronous render (`SlickGridHost.vue:149-152`'s own rule),
and Web Crypto's `sign` is async. The transform cannot await.

Solution: **precompute tags per page, not per render.** When mask preview turns on (and on every
`pageVersion` bump while it is on), walk the page's masked columns once, compute every distinct
value's tag in one async pass, and fill a `Map<string, string>` cache. The synchronous transform
reads that map; a miss (a value that arrived after the pass — a staged edit) renders the redaction
with no tag and schedules a refill. Distinct values per page are bounded by 2000 × masked-column
count, and the pass is one `Promise.all` over `crypto.subtle.sign`.

The redaction itself is synchronous and unkeyed, so a cache miss degrades to *less* information,
never to a leaked value. Fail-closed again.

### 6.4 Editing must be impossible while masked

The worst bug this feature could ship is a user committing `J•••••#K7QW3F` into their database. Two
paths lead there — the grid's inline editor and the cell editor panel — and both are closed by one
predicate.

`canEditTable()` (`SlickGridHost.vue:237-239`) gains `&& !maskPreviewOn()`:

```go
isWritable() && hasPrimaryKey() && !!caps()?.canUpdate && !maskPreviewOn()
```

That one change closes every path, because everything already routes through it:

- the `editable` grid option, kept live by the existing computed + `setOptions` watch (:246-253);
- `SelectedCell.onEdit`/`onRevert` (:2333-2338), which become `undefined`, which the cell editor
  already reads as "this publisher cannot stage a write" (`cellSelection.ts:28-38`);
- `cellFormatter`'s insert-row `<input>` branch (:186-194), since no insert row can be added.

Additionally:

- The toolbar's add-row / generate-data / delete-row buttons gate on `isWritable`, so the same
  `maskPreviewOn` term goes into `DataToolbar.vue`'s `isWritable` computed (:51-53), with each
  tooltip naming the real reason ("Values are masked — turn the preview off to edit").
- `DataView.vue:190-192`'s `grid-writable-badge` reads `read-only` while masked, since it is.
- A `MessageStrip` (the `data-action-error` pattern at `DataView.vue:285-293`) states that displayed
  values are masked and are not the stored values.
- **The toggle is disabled while `hasPending(tabId)`** (`DataView.vue:86`), tooltip "Commit or
  discard pending changes first". Otherwise a staged edit's own text gets masked and the user loses
  sight of what they staged — and un-masking it would require distinguishing staged text from stored
  text inside the transform, which is complexity bought for a case nobody needs.

### 6.5 The cell editor

Almost free, because the panel's only input is `SelectedCell` and that already flows through the
masked extractor.

- `SlickGridHost.vue:2318` calls `displayCell(...)` → `rvDisplayCell` → the same extractor, so
  `SelectedCell.value` is already the masked text. No change at the call site beyond §6.4's.
- `SelectedCell` gains `masked?: boolean` (`cellSelection.ts:7-39`), set by the publisher.
- `ReadOnlyReason` (`celleditor/state.ts:10-14`) gains `'masked'`, and `readOnlyReasonFor` (:38-44)
  checks it **first**, ahead of `connection-read-only`. Masked is the transient state the user can
  fix by toggling, so it is the one worth naming; `CellEditorView.vue:114-130`'s chip/explanation
  maps gain the matching arms ("Masked preview", "Values are masked for this tab — turn the preview
  off in the toolbar to see and edit the stored value").
- **No change to `detect.ts`, `formats.ts`, `binary.ts`, `validate.ts`, `timestamp.ts`.** Format
  detection running over masked text detects text, and the hex pane over a masked value shows the
  mask's bytes — both correct, because the panel's job is to display what is displayed. Stated here
  so a reviewer does not read the absence as a gap.

### 6.6 Clipboard and search

- **Copy follows display.** `menu.ts`'s `copy-column-values` (:533-543) and the cell/row copy paths
  route through the display extractor while preview is on, so copying a masked view yields masked
  text. Not a security control (§6.1) — a footgun guard: a user showing a colleague "the masked
  view" must not paste real values.
- **Search is unchanged**, over raw values (`views/grid/search.ts`). A match highlight over a masked
  cell reveals only that the raw value matched something the user themselves typed, on their own
  machine. Per §6.1 that is not a boundary this feature defends. The search toolbar gets one line of
  helper text saying search matches stored values, not displayed ones, so the behaviour is not
  surprising.

### 6.7 The header menu

`menu.ts`'s `headerMenu` (:466-543) gains a separator and a `Mark column as PII ▸` submenu: the
seven kinds plus `Not PII` (removes the rule), with the current kind checked.

This is the "schema-explorer-driven picker" the SPEC's drafting named, realized where it costs
nothing: the grid already holds the connection id, the tab's target path — and `menu.ts:60`'s
`qualifiedNameForPath(connectionId, path)` already turns that into the qualified table name the rule
needs — and the column name. No new metadata path, and the user marks a column PII at the moment
they are looking at the values that made them want to.

`HeaderMenuContext` gains `connectionId` and `tablePath`; the submenu's `run` calls the new
`maskRules.upsert` IPC and then toggles mask preview on for that tab, so the effect is immediately
visible.

## 7. Frontend: rule management UI

### 7.1 Decision, stated

Resolving open question 5.

**Rules live in a new fifth `DetailTab` — `Privacy` — in `ConnectionDialog.vue`. Not inside M2's MCP
tab.** Two reasons, both concrete:

1. The MCP tab is full. It has already been trimmed twice to fit the dialog's fixed box (`5e77928b`
   for M2, `ef2ed03b` for M3), and it currently holds a checkbox, a textarea, another checkbox,
   three `SegmentedControl`s and a helper paragraph (`ConnectionDialog.vue:779-849`). A scrollable
   list of per-column rules with three controls each does not fit beside that.
2. **Masking is not MCP-only.** The SPEC's own second consumption point is the normal data viewer.
   Filing a rule set that governs the grid under a tab named "MCP" would misdescribe what it does,
   and would leave a user who never enables MCP unable to find a feature that applies to them.

A live schema-explorer picker inside the dialog was considered and declined: the dialog can be open
for a connection that is not connected, so it would need its own connect-and-browse path, inside a
modal, for a list the header menu (§6.7) already populates from real usage at zero cost.

### 7.2 Where the state lives

New `apps/kira-studio/frontend/src/state/maskRules.ts`, mirroring `state/connections.ts`: a
`reactive` store keyed by connection id, `loadMaskRules`, `upsertMaskRule`, `removeMaskRule`,
`regenerateMaskKey`, and a `maskRulesFor(connectionId)` reader the grid, the menu and the dialog all
share. One store, no second copy in the dialog's draft — a rule takes effect immediately (it is not
part of the connection's save/cancel draft), which matches how the header menu writes one.

### 7.3 Rendering order

`ConnectionDialog.vue:110` — `DetailTab` gains `'Privacy'`, tab strip button at :495-537 following
the MCP button's shape exactly, `TAB_FOR_FIELD` (:302-310) routing rule validation errors there.

### 7.4 The Privacy pane

- A short paragraph: rules redact values for this connection's MCP clients and for the data viewer's
  masking preview; they never change stored data.
- A scrollable rule list: table, column, a kind `<select>`, a `keepHint` checkbox whose label changes
  per kind ("Keep initials" / "Keep domain" / "Keep year", hidden for the four kinds where it means
  nothing), a `correlate` checkbox (disabled and forced for `number` and `id`, per §2.3), a remove
  button.
- An add row: two text inputs (table — placeholder `*`, column) and a kind select.
- A per-kind one-line explanation under the select, taken verbatim from §2.3, so the user picking
  `number` reads "shows an order of magnitude, never a joinable key — use `id` for a numeric
  identifier".
- A "Regenerate correlation key" button behind a confirmation. The confirmation text is plain prose,
  per CLAUDE.md's carve-out for irreversible actions: regenerating the correlation key changes every
  masked correlation tag for this connection. Masked results already given to an AI client, or saved
  anywhere outside this app, will no longer correlate with results produced after the change. The
  real values are not affected, and this cannot be undone.
- The secret-store caveat from §2.5, rendered with the same `credential-note` pattern the dialog
  already uses at :865+, shown when `secretStatus.insecureFallback` is true.

### 7.5 Settings

Extend M2's existing read-only glance on the Database MCP section's "Exposed connections" list
(`SettingsDialog.vue:1117-1160`) with a masked-column count per row ("3 masked columns" / nothing
when zero), linking to the connection's Privacy tab. No new Settings section and no second editor —
M2's own established split (glance in Settings, editing in `ConnectionDialog`) applied unchanged.

## 8. Test scope

Per CLAUDE.md's sparse-testing default: most of this gets nothing. Stated explicitly in both
directions.

### Earns a test

- **`internal/mask/mask_test.go`** — seven kinds with interacting flags (`keepHint`, `correlate`),
  seven fall-through paths, grapheme counting, bucket and decade boundaries, the NULL/empty
  invariants, and the fail-closed property (**no input on any path returns the original text**).
  This is a decision structure too large to hold in your head, which is exactly the bar's own
  wording.
- **Cross-language parity** — `internal/mask/parity_test.go` and
  `apps/kira-studio/tests/unit/mask-parity.spec.ts`, both reading
  `apps/kira-studio/tests/fixtures/mask/*.{input,expected}.json`. M3's precedent
  (`queryplan/parse_test.go:14-19`). Two ports of one algorithm drifting silently is the failure
  this guards, and it is the only thing that can catch it.
- **Determinism and key scoping** — same value, same key → same tag, across calls and across
  columns; different keys → different tags; `correlate: false` → no tag. Short, and it pins the
  §2.4 contract a future refactor could quietly break.
- **`dbmcp/render_test.go`** gains: masking applied per column not per row (assert the resolve
  happens once), NULL passing through unmasked, a document page refused when rules exist (§4.4),
  and a keyvalue entry masked by its `Field` name (§4.3).
- **Conflict folding** — §4.2's strictness order, the same shape as M2's `strictestOf`, which has
  its own test.
- **`repos/maskrules_test.go`** — narrow: the case-insensitive unique index, `ON DELETE CASCADE`,
  and that `InsertDuplicateWithSecret` does not copy `mask_correlation_key` (§3.2). The last of
  those is a real correctness property with a silent failure mode, not a CRUD round-trip.

### Deliberately gets nothing

- The repo's plain `List`/`Upsert`/`Remove` round-trips beyond the three properties above — CRUD.
- `bridge/maskrules.go`'s arg validation — required-field guards, explicitly named in the bar's
  exclusion list.
- `state/maskRules.ts` — a thin IPC wrapper.
- The zod schemas — they restate the Go model.
- The Privacy pane's rendering — covered by the UI sweep below, not by a unit test.

### UI

One new `apps/kira-studio/tests/ui/mask-preview.spec.ts`: mark a column PII from the header menu,
toggle preview, assert the cell shows a redaction, assert the grid is read-only and the cell editor
shows the `masked` chip, toggle off, assert the real value returns and editing works again. Plus the
standing fixture sweep every M-phase has needed — M1ab's own post-mortem (SPEC's M1ab result) records
that `mcpEnabled` was missed in more specs than the first pass targeted, so sweep every `tests/ui/`
fixture for the new connection field and the new table rather than patching the two that fail first.

## 9. Files

### New

| Path | What |
|---|---|
| `apps/kira-studio/internal/storage/migrations/0023_m5_column_mask_rules.sql` | §3.1 |
| `apps/kira-studio/internal/storage/model/maskrule.go` | §3.2 |
| `apps/kira-studio/internal/storage/repos/maskrules.go` | §3.2 |
| `apps/kira-studio/internal/storage/repos/maskrules_test.go` | §8 |
| `apps/kira-studio/internal/storage/repos/maskkeys.go` | §3.2 |
| `apps/kira-studio/internal/mask/mask.go` | §4.1 |
| `apps/kira-studio/internal/mask/mask_test.go` | §8 |
| `apps/kira-studio/internal/mask/parity_test.go` | §8 |
| `apps/kira-studio/internal/maskrules/service.go` | §4.6 |
| `apps/kira-studio/internal/bridge/maskrules.go` | §4.6 |
| `packages/shared/domain/mask.ts` | §5 |
| `apps/kira-studio/tests/fixtures/mask/*.{input,expected}.json` | §5 |
| `apps/kira-studio/tests/unit/mask-parity.spec.ts` | §8 |
| `apps/kira-studio/frontend/src/state/maskRules.ts` | §7.2 |
| `apps/kira-studio/frontend/src/views/grid/maskPreview.ts` | §6.2/§6.3 — the transform + tag cache |
| `apps/kira-studio/tests/ui/mask-preview.spec.ts` | §8 |

### Modified

| Path | What |
|---|---|
| `internal/storage/migrations/embed.go` | register 23 |
| `internal/storage/repos/connections.go` | comment: duplicate must not copy the key (§3.2) |
| `internal/secrets/scope.go` | `ScopeMaskKey` + `valid()` |
| `internal/secrets/cipher_test.go` | frozen-strings test gains the new scope |
| `internal/dbmcp/render.go` | `renderPage`/`renderTabularPage`/`renderKeyValuePage` masking (§4.3) |
| `internal/dbmcp/render_test.go` | §8 |
| `internal/dbmcp/tools.go` | build maskset, pass it, refuse document/stream pages, `maskedColumns` on `list_connections` |
| `internal/dbmcp/server.go` | `MaskRules` interface, `Config` field + `New` validation, `instructions` sentence |
| `internal/appcore/deps.go` | the new service on `Deps` |
| `apps/kira-studio/main.go` | construct + register (`:371` neighbourhood) |
| `internal/ipcfixture/harness.go` | the new service (`:93`) |
| `frontend/src/views/grid/state.ts` | `maskPreview` + setters (`:44`, `:61`) |
| `frontend/src/views/grid/slick/dataSource.ts` | fourth param on `createDisplayValueExtractor` (`:25`) |
| `frontend/src/views/grid/SlickGridHost.vue` | `dataSourceState` (`:507`), `canEditTable` (`:237`), `cellFormatter` class (`:174`), `SelectedCell.masked` (`:2318`), the preview watch |
| `frontend/src/views/grid/DataToolbar.vue` | the toggle, `isWritable` (`:51`), tooltips |
| `frontend/src/views/grid/DataView.vue` | badge + strip (`:190`, `:285`) |
| `frontend/src/views/grid/menu.ts` | `headerMenu` submenu (`:466`), copy routing (`:533`) |
| `frontend/src/state/cellSelection.ts` | `masked?: boolean` (`:7-39`) |
| `frontend/src/views/shared/celleditor/state.ts` | `'masked'` reason (`:10`, `:38`) |
| `frontend/src/views/shared/celleditor/CellEditorView.vue` | chip + explanation (`:114-130`) |
| `frontend/src/project/ConnectionDialog.vue` | fifth tab (`:110`, `:302`, `:495`), Privacy pane |
| `frontend/src/workbench/SettingsDialog.vue` | masked-column count on the exposed list (`:1117`) |
| `packages/shared/domain/dbmcp.ts` | `maskedColumns` on the connection view |

## 10. Implementation order

One sequential Sonnet subagent. The work is order-dependent — the frontend port is checked against
the Go original, and the UI is checked against the storage — so it does not split for parallelism.

1. **Migration + model + repos** (§3). `go build/vet` + the narrow repo test.
2. **`internal/mask`** (§4.1) with its own test and the fixtures. Fixtures are generated from the Go
   side here and consumed by the TS port in step 6 — M3 generated from TS first because the TS port
   was the original; here the Go side is.
3. **`internal/maskrules` service + bridge + wiring** (§4.6). `go build/vet/test`.
4. **`dbmcp` render path** (§4.3/§4.4/§4.5) + `render_test.go`. `go test ./...`.
5. **Shared domain + TS port + parity spec** (§5). `bun typecheck/lint` + the unit spec.
6. **Grid preview** (§6.2-§6.4, §6.6) — extractor, state, toolbar, edit lockout.
7. **Cell editor + header menu** (§6.5, §6.7).
8. **Connection dialog Privacy tab + Settings glance** (§7).
9. **UI spec + the full fixture sweep** (§8), then the whole `tests/ui/` suite once.

Per CLAUDE.md: fast checks per commit, the expensive suite once near the end, fixes as follow-up
commits. Commits stay granular — roughly one per step, more where a step splits naturally.

**Fallback split point: after step 5.** Steps 1-5 are a complete, shippable increment — masking works
end to end on the MCP path, which is the security-relevant half, with rules editable only via the
bridge. Steps 6-9 are the viewer preview, which is a convenience. If the phase has to be cut, cut
there and carry 6-9 as M5b rather than leaving a half-built toggle.

## 11. Rejected alternatives

| Option | Why not |
|---|---|
| Faker-style realistic replacement | Explicitly descoped (SPEC M4). A realistic substitute is indistinguishable from real data to a reader, which is worse than an obvious redaction. |
| Salted hash as the visible value | §2.1 — dictionary-attackable for low-entropy input. |
| Hash then truncate | Same weakness, plus collisions, plus it discards the shape information §2.3 deliberately keeps. |
| Format-preserving encryption (FF1/FF3) | Invertible by construction — the key recovers the value exactly. That is the opposite of the requirement. |
| Per-value stored mapping table | Would persist every real PII value the user has viewed, in the app's own DB. A new copy of the data this phase exists to protect. §2.6. |
| SQL parsing to attribute result columns to base tables | §4.2 — every parse failure leaks. Name matching fails safe. |
| Rules in `connections.options_json` | SPEC forbids it; 0021's own reasoning (URI round-trip) applies. |
| Masking inside `Query.Execute` / the adapter layer | Would mask the console too, and the console is the human's own data. The seam `render.go:91-94` already names is the right one. |
| Rules in M2's MCP tab | §7.1 — the tab is full, and masking is not MCP-only. |
| Masking document/stream pages by best effort | §4.4 — partial masking that the user believes is total is worse than a refusal. |

## 12. Dogfooding — repo-map MCP server

Set up per CLAUDE.md's own section, headless. `bun run mcp:repo-map:build` (clean, exit 0), then
`bun run mcp:repo-map`.

**The delete-and-restart case fired, as CLAUDE.md's step 2 warns.** The first start printed "Using
this repository's existing token, valid until 2026-09-22" with no plaintext — unusable from this
session, which has no prior registration. Recovery, following the documented path: `pgrep -af
"mcp-repo-map|kira-repo-map"` listed PIDs 21347 (`bun run scripts/mcp-repo-map.ts`) and 21400
(`apps/kira-studio/bin/kira-repo-map`); killed both by PID after reading the output, deleted
`/root/.kira-studio/mcp-repo-map-fc694cca06c3-token.json`, restarted, and the fresh start printed the
`claude mcp add` command with a plaintext token. Registered it; `claude mcp list` reports
`kira-repo-map: ... - ✓ Connected`. As CLAUDE.md predicts, the eight tools never surfaced natively in
this harness, so every call below went over plain HTTP/JSON-RPC via curl.

Findings, for folding into `docs/v1.7/mcp-repo-map-issues.md`:

1. **M1c's struct-field fix verified live, independently of the implementer's report.** Trivial /
   positive. `find_references` on `McpAutoExplain` returned 8 references including
   `apps/kira-studio/internal/dbmcp/tools.go:195` `if summary.McpAutoExplain {` — a plain
   selector-expression read, which is exactly the M1c bug class. Cross-checked against grep: the only
   `McpAutoExplain` occurrences not listed are the declaration itself
   (`model/connection.go:43`) and a prose mention in a comment (`connections/service.go:478`), both
   correctly not references. No gap.

2. **`.vue` files are no longer a dead zone.** Non-trivial / positive, and it contradicts a claim
   this chapter's own SPEC still carries. `docs/v1.6/mcp-repo-map-issues.md`'s P60a/P63/P67e entries
   and `docs/v1.7/SPEC.md`'s Sequencing paragraph both state `.vue` SFCs return zero results. That
   was not true in this session: `search_symbols` on `cellAt` returned
   `frontend/src/views/console/ConsoleSlickGrid.vue:535`, `read_symbol` on `cellFormatter` with
   `file` set to `SlickGridHost.vue` returned the full 40-line body **with its leading comment
   block**, and `outline_file` on `DataToolbar.vue` returned 24 symbols with correct line:column.
   This materially changed how this planning pass worked — §1.5's entire seam
   (`createDisplayValueExtractor` → `dataSourceState` → `dataItemColumnValueExtractor`) was traced
   through `search_symbols`/`read_symbol` rather than by reading three files totalling ~3,300 lines.
   Worth verifying whether this is a genuine fix (P67f? the `extractionVersion` 3→4 reindex M1c
   forced?) or a partial one, and if genuine, the SPEC's own Sequencing claim should be annotated —
   it is load-bearing there, since it is the stated reason M1 rather than any other row was chosen
   for the M1ab A/B.

3. **`find_implementations` rejects `limit`; every sibling tool accepts it.** Trivial / fix inline.
   `{"symbol":"StatementClassifier","limit":10}` fails with
   `validating "arguments": validating root: unexpected additional properties ["limit"]`. Without
   `limit` it answers cleanly ("Go interfaces are structural; implementations are not derivable from
   the index" — a correct and useful answer). The inconsistent parameter surface costs a round trip
   on the first call. Either accept and ignore `limit`, or say so in the tool description.

4. **`find_references` on an ambiguous name disambiguates well.** Positive, no action.
   `find_references` on `cellAt` — 13 symbols across Go and TS — returned the candidate list with
   file:line and a one-line signature each, and told the caller to re-call with `file` or `languages`
   set. That is the right behaviour and it found the right symbol in one extra call.

Token note, for the M1ab thread: this pass used repo-map for symbol location and targeted body
reads, and `Read`/`Grep` for the places a whole file's structure genuinely mattered (migrations,
`ConnectionDialog.vue`'s template). The mix felt right; the `.vue` capability in finding 2 is what
made repo-map worth reaching for here in a way M1ab's backend-only scope could not show.
