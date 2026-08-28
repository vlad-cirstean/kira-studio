# P53 — Go storage core: db, migrations, model, and the ten repos

> Scope comes from `docs/v1/plans/P52-wails-go-migration.md`'s phasing table (§0.3): **P53 = "Go
> storage core: db, migrations, 10 repos, settings/layout model", touches no `src/` files.** P52
> §4–§10 are the settled architectural record; this plan cites and executes them rather than
> reopening them. Gate G1 has passed for real (261.7 MB on Apple Silicon, `docs/PERF.md` §2.4), and
> P52 §15 authorises P53 to start. **P53 has no gate of its own and this plan does not invent one.**

## 0. What this phase is, and what it is not

P52 built a walking skeleton: enough storage to boot the real renderer and answer nine read-only
calls against an empty database. P53 turns that skeleton into the finished storage layer — every
table the app has, every method the app actually calls, and the first Go test tier in this repo.

It is deliberately *not* the phase that wires any of it up. Nine bridge methods exist today
(P52 §3.2); the other 52 are P56's, the services that will call most of these repos are P55's, and
the renderer is P57's. Per P52 §2.3's third reason for the coexistence window, each of P53–P56
delivers "a **complete, tested** Go subsystem verified by Go tests against real SQLite" — which is
what makes it legitimate for `SecretsRepo`, `SavedQueriesRepo`, `FilterHistoryRepo` and
`MetadataCacheRepo` to have no production caller at the end of this phase. **Nothing here is a
stub**: every method is fully implemented and covered by a test against a real database. What is
missing is a caller, not an implementation, and `AGENTS.md`'s no-stubs rule is about the latter.

## 1. What the diff against `src/main/storage/` found

Re-read for this plan against the current tree, not trusted from P52's prose.

### 1.1 Migrations: already complete, nothing to add

`diff src/main/storage/migrations/000{1..5}*.sql shell/internal/storage/migrations/` is **empty for
all five files** — P52 copied them byte for byte as §4.3 required. Between them they already create
every table this phase needs:

| Table | Created by | Repo that owns it |
|---|---|---|
| `settings` | 0001 | `settings.go` |
| `connections` (+ `preconnect` 0003, `preconnect_sidecar` 0004) | 0001/0003/0004 | `connections.go`, and `secrets.go` for the `password` column only |
| `saved_queries` (+ `pinned` 0002) | 0001/0002 | `saved_queries.go` |
| `metadata_cache` | 0001 | `metadata_cache.go` |
| `op_log` | 0001 | `ops.go` |
| `ui_layout` | 0001 | `layout.go` |
| `tabs` | 0001 | `tabs.go` |
| `filter_history` | 0002 | `filter_history.go` |
| `connection_tree_filters` | 0005 (which also `DROP`s `connection_filters`) | `filters.go` |

**P53 adds no `.sql` file and does not touch `migrations/embed.go`.** The brief's expectation that
the four missing repos need tables of their own does not survive contact with the files: three of
them were created in 0001/0002, and `secrets` has never had a table — `src/main/storage/repos/
secrets.ts`'s own header says it is "the only file in the codebase that reads or writes
`connections.password`", and that stays true in Go.

### 1.2 The six existing Go repos: what each one is missing

| File | Has today | Missing, against the `.ts` |
|---|---|---|
| `settings.go` | `GetAll` | `Set(patch)` (D15's patched-leaves-only write); read-side validation of enum/bounded leaves |
| `layout.go` | `GetAll` | `Set(patch)` (writes all six leaves, `layout.ts`'s `flatten(merged)`) |
| `tabs.go` | `List`, `Save` | Nothing structural — but see the `'ddl'` coercion (§3.1) and the state-JSON shape check (D3) |
| `ops.go` | `Recent` | `Append`, `Finish`, `Prune`; and `Recent` must **lose** the `'ddl'` coercion and **gain** row validation |
| `connections.go` | `List` | `Get`, `Insert`, `Update`, `Delete`, `Reorder`; and `List` has two real bugs (§1.3) |
| `filters.go` | `List` | `Replace`; and the unrecognised-scope warn `filters.ts` logs |

### 1.3 Two real bugs in the P52 skeleton

Both in `shell/internal/storage/repos/connections.go`:

1. **The secondary sort is missing.** `listConnections` orders by
   `asc(sortOrder), asc(name)`; the Go query is `ORDER BY sort_order ASC` only. Two connections
   sharing a `sort_order` (which `Reorder` makes possible the moment it exists) come back in
   arbitrary order, so the sidebar reorders itself between launches.
2. **`options_json` is passed through unparsed.** The Go code does
   `c.Options = json.RawMessage(options.String)` with no validation. A row whose `options_json` is
   not valid JSON produces a `ConnectionSummary` that, once marshalled by Wails, emits a **corrupt
   JSON response for the whole call** — every connection in the list is lost, not just the bad row.
   The TS build parses it and drops the single row. Fixed by D2 below.

### 1.4 Four repos not written at all

`filter_history`, `metadata_cache`, `saved_queries`, `secrets`. Their TS counterparts are 110, 130,
176 and 83 lines; they are the bulk of this phase's new code.

### 1.5 One unbounded-SQL family, not one site

P52 §5.4 names `repos/ops.ts`'s `pruneOps` as the reason the statement cache needed a cap. Reading
for this plan, **it is not the only one**: `metadata-cache.ts`'s eviction pass builds
`notInArray(path, keepPaths)` over up to 200 paths, and `filter-history.ts` caps its ring with a
loop of one `DELETE` per stale row. All three are the same shape and all three get §5.4's same
answer — one SQL string, one bound parameter, a subquery (§3.2).

### 1.6 A format trap worth stating before anyone writes code

`op_log.started_at` is **not written by Go**. It arrives from the Node engine
(`src/engine/scheduler/ops.ts:45`, `new Date().toISOString()`) and is stored as TEXT. `pruneOps`
then does a **lexicographic** `started_at < cutoff` comparison against a string Go generates, and
`filter_history`/`saved_queries`/`metadata_cache` all order by TEXT timestamps too. So every
timestamp Go writes must be byte-compatible with JavaScript's `toISOString()`:
`2006-01-02T15:04:05.000Z` — UTC, exactly three fractional digits, literal `Z`. Go's
`time.RFC3339Nano` is **not** this (it trims trailing zeros, so `…:05.1Z` sorts after `…:05.05Z`
lexicographically while being earlier in time). D8 pins this.

## 2. Decisions this phase makes

Numbered so later phases can cite them. Each is something P52 left open, not a re-litigation.

**D1 — The `model` package is created, and the wire structs move into it.**
P52 §2.1's target tree allocates `internal/storage/model/` for "Go structs replacing
`storage/schema/*` + the zod row validation", and the phasing table's P53 row names the
"settings/layout model" explicitly. The walking skeleton put those structs in `repos` as a
shortcut, and `repos/connections.go`'s own comment already flags the smell ("`ConnectionState` … is
kept in-memory by the connections service (not read from this table) — listed here only as the
shared wire type"). P53 moves them, because P55's `connections`/`tree` services need
`ConnectionSummary`, `ConnectionInput` and `SecretStorageStatus` without importing a storage repo.
Mechanically this is a type move plus new types; `repos` imports `model`, nothing imports `repos`
for a type any more.

**D2 — `ConnectionSummary.Options` is `map[string]any`, not `json.RawMessage`.**
Fixes §1.3's second bug: the repo unmarshals `options_json`, and a failure drops that row with a
warn (the TS `parseRow` discipline) instead of emitting invalid JSON into a bridge response. `NULL`
or empty → `map[string]any{}` (never `nil`, so it marshals as `{}` not `null`).

**D3 — Tab `state` stays opaque to Go.**
`repos/tabs.go`'s existing comment defers this to "P53/P56"; deciding it here. `tabs.state_json` is
written by the renderer and read by the renderer; Go never interprets it. Replicating
`src/shared/domain/tabs.ts`'s seven-arm discriminated union and its ~15 `.default()` calls in Go
would be re-implementing renderer state-shape migration in the platform, and P51 §1.4 has already
removed the obligation those defaults exist for. **The repo validates the row envelope it owns** —
`kind ∈ RENDERABLE_TAB_KINDS`, `state_json` parses *and is a JSON object* — and passes `state`
through as `json.RawMessage` byte-identically. Per-kind validation and forward-compatible defaults
stay renderer-side. This narrows P52 §7.1's "the renderer stops doing zod parsing of platform
responses" by exactly one field, deliberately; P56/P57 must not silently re-add a Go-side per-kind
union.

**D4 — Read-side validation fails closed to the default, and logs; it does not fail the call.**
`settings.ts`/`layout.ts` end with a hard `settingsSchema.parse()` whose comment says a stale row
"must fail loudly". Under a fresh `kira.db` (§5.1) a stale row cannot exist, and the only way to get
one is hand-editing — where the TS behaviour is *the app refuses to launch*, since `getAllSettings`
runs during startup. P52's `leaf()` helper already chose fallback-to-default; P53 keeps that and
**extends it to semantic validation** (enums, ranges), which `leaf()` does not do today — a stored
`appearance.rowDensity: "banana"` currently reaches the renderer. Every rejected leaf is
`slog.Warn`ed under its `scope`. Row-level repos (connections, ops, tabs, saved queries, filter
history) keep the TS "drop the row, keep the rest" behaviour unchanged.

**D5 — Repos are constructed once through `repos.New(db)`, which owns §5.4's prepared statements.**
P52 §5.4 is explicit that the hot queries "are held as `*sql.Stmt` prepared once at `openDb` and
kept for the process lifetime, on the repo struct". That needs a constructor that can fail, so the
struct-literal wiring in `main.go` goes away in favour of one aggregate with one `Close()`.
`SecretsRepo` is **not** in the aggregate — it needs a `Cipher` that does not exist until P55, so it
gets its own `repos.NewSecrets(db, cipher)`.

**D6 — Every capped/evicting query gets a deterministic tiebreak.**
The three cap passes (`op_log`, `metadata_cache`, `filter_history`) order by a millisecond-precision
TEXT timestamp; several rows written in the same millisecond make "which rows survive" arbitrary —
untestable, and in the TS build genuinely nondeterministic. All of them order by
`<timestamp> DESC, rowid DESC` (every one of these tables has an implicit rowid). `Recent` gets the
same tiebreak so the Operations panel's order is stable too.

**D7 — `LayoutPatch.Window.Bounds` is `*WindowBounds` (absent or set), not tri-state.**
`layoutPatchSchema` allows `bounds: null` to mean "clear". Grepped for this plan: the only writer in
the entire codebase is `src/main/window.ts:40`, which always passes a real rectangle. Modelling
absent/null/value in Go costs a `json.RawMessage` field plus a decode helper for a state no caller
has ever produced. Recorded as a deliberate narrowing so P56's generated TS type
(`bounds?: WindowBounds`) is not mistaken for an oversight.

**D8 — One timestamp helper, JS-compatible, used for every TEXT timestamp Go writes.**
`model.NowISO()` → `time.Now().UTC().Format("2006-01-02T15:04:05.000Z")`. Reason in §1.6.

**D9 — Ids are generated by `internal/id`, with no new dependency.**
`filter_history` and `saved_queries` call `crypto.randomUUID()` today (and P55's connections service
will need the same for `create`/`duplicate`). P52 §2.2's dependency list is deliberate and short and
does not include a UUID library; a compliant RFC 4122 v4 generator over `crypto/rand` is ~15 lines.
It lives in `shell/internal/id/` rather than in `repos` so P55's services can use it without
importing storage.

**D10 — `INSERT OR IGNORE` for `connection_tree_filters`.**
Its primary key is `(connection_id, scope, value)` and the payload is a *set*; a duplicate entry in
the incoming array is a no-op, not an error. (The TS build would throw.)

## 3. The two special cases P52 flagged, plus the one it didn't

### 3.1 `recentOps`'s legacy `'ddl' → 'definition'` coercion is dropped — and so is `tabs`'

P52 §4.3: "`recentOps`'s legacy `'ddl' → 'definition'` coercion is **dropped** — it exists for rows
written before P19 and §1.4 removes any obligation to them."

**The P52 skeleton ported it anyway.** `shell/internal/storage/repos/ops.go` currently contains:

```go
// P19 legacy coercion: an op logged before the ddl->definition rename.
if o.Kind == "ddl" {
    o.Kind = "definition"
}
```

Delete it, comment included. Under the new `kira.db` (§5.1) no `'ddl'` row can exist, and with the
coercion gone a hand-made one is dropped by the kind validation, which is the correct outcome and
is what the test asserts.

**`repos/tabs.go` has the same coercion**, ported from `tabs.ts`. P52 §4.3 named only `recentOps`,
so this plan decides it: **drop it too.** The reasoning is identical and verbatim — it exists solely
for rows written before P19, §1.4 removes the obligation, and the renderer has not written `'ddl'`
since P19. Keeping one and dropping the other would leave the codebase inconsistent for no reason.
With the coercion gone, `'ddl'` simply is not in `RENDERABLE_TAB_KINDS`, so such a row is dropped
with a warn on restore — the same path any other unknown kind takes.

### 3.2 `pruneOps` — §5.4's rewrite, and the two siblings it turns out to have

P52 §5.4 gives the replacement statement literally:

```sql
DELETE FROM op_log
 WHERE id NOT IN (SELECT id FROM op_log ORDER BY started_at DESC LIMIT ?)
```

Implement it exactly, with D6's tiebreak (`ORDER BY started_at DESC, rowid DESC`) and the retention
cut ahead of it, unchanged in meaning:

```sql
DELETE FROM op_log WHERE started_at < ?      -- cutoff = NowISO() - retentionDays (see D8/§1.6)
```

Two more sites in the same family, which §5.4's principle ("no per-call-shape SQL anywhere in the Go
tree") covers even though it names only `pruneOps`:

```sql
-- metadata_cache eviction (was notInArray over <=200 paths)
DELETE FROM metadata_cache
 WHERE connection_id = ?
   AND path NOT IN (SELECT path FROM metadata_cache
                     WHERE connection_id = ?
                     ORDER BY fetched_at DESC, rowid DESC
                     LIMIT ?)

-- filter_history ring cap (was a per-row DELETE loop over rows.slice(20))
DELETE FROM filter_history
 WHERE connection_id = ? AND path = ?
   AND id NOT IN (SELECT id FROM filter_history
                   WHERE connection_id = ? AND path = ?
                   ORDER BY used_at DESC, rowid DESC
                   LIMIT ?)
```

### 3.3 `secrets.go` — §6's envelope change, and what does *not* get written

P53 owns **`repos/secrets.go` only**. The cipher itself (`internal/secrets/`, `kira:v2:`,
AES-256-GCM, `keybase/go-keychain`, the `SecretStorageStatus` probe) is P55's row in the phasing
table and is **not** written here. What P53 does:

- Declare the consumer-side interface the repo needs, in `repos/secrets.go`:

  ```go
  // Cipher is implemented by internal/secrets (P55) — P52 §6's kira:v2: AES-256-GCM envelope.
  type Cipher interface {
      Encrypt(plain string) (string, error)
      Decrypt(stored string) (string, error)
  }
  ```

  Note what is **absent**: `isEnveloped`. Its only TS caller is `upgradeLegacySecrets`, which
  §6.4 deletes outright, so the interface tightens by one method. `status` is absent for the same
  reason — the repo never reads it; the cipher enforces availability inside `Encrypt`/`Decrypt`
  and returns `E_SECRET_STORE` itself (§6.5).
- Port `SecretStore`'s four methods with their P25 semantics intact — in particular **`Copy` copies
  the stored column value verbatim, with no decrypt and no re-encrypt** (P25 D11); it must not
  touch the cipher at all, and the test asserts that by call count.
- **Do not port `upgradeLegacySecrets`** (§6.4: "deleted, not ported"). It is 30 lines whose entire
  purpose is rows written before P25, which a fresh `kira.db` cannot contain.
- **Do not add a plaintext passthrough.** §6.4 drops P25 D10: a non-enveloped stored value is an
  error from the cipher, and the repo surfaces it rather than swallowing it. The repo itself does no
  envelope inspection — that is the cipher's business.

## 4. Target tree, file by file

Everything is under `shell/`. Nothing under `src/`, `tests/`, `scripts/` or `build/` is touched.

```
shell/
  go.mod                              + github.com/google/go-cmp (test-only, P52 §2.2)
  main.go                             MODIFIED  (D5 wiring)
  internal/
    id/uuid.go  uuid_test.go          NEW       (D9)
    appcore/deps.go                   MODIFIED  (D5 wiring)
    bridge/{settings,layout,tabs,ops,connections,filters}.go
                                      MODIFIED  (type refs repos.X -> model.X; s.Deps.X -> s.Deps.Repos.X)
    storage/
      db.go                           MODIFIED  (migrate() moved out)
      db_test.go                      NEW
      migrate.go                      NEW       (moved verbatim from db.go, P52 §2.1's layout)
      migrate_test.go                 NEW
      migrations/                     UNCHANGED (embed.go + the 5 .sql files)
      model/                          NEW
        settings.go  settings_test.go
        layout.go
        tabs.go
        connection.go
        ops.go
        queries.go   queries_test.go
        treefilter.go
        time.go                       (D8's NowISO)
      repos/
        repos.go                      NEW       (D5 aggregate + the 5 prepared statements)
        connections.go                REWRITTEN
        filters.go                    EXTENDED
        filter_history.go             NEW
        layout.go                     EXTENDED
        metadata_cache.go             NEW
        ops.go                        EXTENDED + coercion removed
        saved_queries.go              NEW
        secrets.go                    NEW
        settings.go                   EXTENDED
        tabs.go                       EXTENDED (coercion removed, object check added)
        helpers_test.go               NEW       (newDB(t) harness)
        *_test.go                     NEW       (one per repo, 10 files)
```

### 4.1 `internal/id/uuid.go`

```go
package id

// New returns an RFC 4122 version-4 UUID in the canonical 8-4-4-4-12 hex form, the same shape
// crypto.randomUUID() produces in the Electron build.
func New() string
```

`crypto/rand.Read` into a `[16]byte`, set version nibble to 4 and variant bits to `10`, format.
A `rand.Read` failure panics — this is `crypto/rand`, and a process that cannot get entropy has no
business writing rows.

### 4.2 `internal/storage/model/`

Plain structs with `json` tags matching `src/shared/domain/*` field names exactly, plus the
validators the repos need. No zod-equivalent framework; validation is explicit predicates.

**`time.go`**

```go
func NowISO() string  // 2006-01-02T15:04:05.000Z — see D8
```

**`settings.go`** — `AppearanceSettings`, `DataSettings`, `CacheSettings`, `AdvancedSettings`,
`Settings`, `DefaultSettings()` (all moved from `repos/settings.go` unchanged), plus:

```go
type SettingsPatch struct {
    Appearance *AppearancePatch `json:"appearance,omitempty"`
    Data       *DataPatch       `json:"data,omitempty"`
    Cache      *CachePatch      `json:"cache,omitempty"`
    Advanced   *AdvancedPatch   `json:"advanced,omitempty"`
}
type AppearancePatch struct {
    FontFamily *string `json:"fontFamily,omitempty"`
    FontSize   *int    `json:"fontSize,omitempty"`
    RowDensity *string `json:"rowDensity,omitempty"`
    WordWrap   *bool   `json:"wordWrap,omitempty"`
}
type DataPatch     struct{ DefaultPageSize *int `json:"defaultPageSize,omitempty"` }
type CachePatch    struct{ L2BudgetMb      *int `json:"l2BudgetMb,omitempty"` }
type AdvancedPatch struct {
    EngineMemoryCapMb  *int `json:"engineMemoryCapMb,omitempty"`
    OpLogRetentionDays *int `json:"opLogRetentionDays,omitempty"`
}

func (p SettingsPatch) Validate() error   // the bounds below; error names the offending leaf

func ValidRowDensity(v string) bool       // compact | comfortable
func ValidPageSize(v int) bool            // 10 | 100 | 1000 | 10000
func InRange(lo, hi int) func(int) bool    // l2BudgetMb 8..1024, engineMemoryCapMb 256..4096,
                                           // opLogRetentionDays 1..365
```

Bounds are transcribed from `src/shared/domain/settings.ts`; `fontFamily` and `fontSize` have no
bounds there and get none here.

**`layout.go`** — `WindowBounds`, `PanelProject`, `PanelOperations`, `PanelCellEditor`, `Layout`,
`DefaultLayout()` (moved), plus `LayoutPatch` / `PanelsPatch` / the three per-panel patch structs,
with `Window *WindowPatch{ Bounds *WindowBounds }` per D7.

**`tabs.go`** — `TabRecord` (moved; `State json.RawMessage` per D3), `RenderableTabKinds`,
`IsRenderableTabKind(string) bool`.

**`connection.go`**

```go
type ConnectionFields struct {
    Name, Kind, Color, Mode string
    ReadOnly                bool
    Host, Database, Username, URI *string
    Port                    *int
    Options                 map[string]any
    Preconnect              *string
    PreconnectSidecar       bool
}
type ConnectionSummary struct {
    ID string `json:"id"`
    ConnectionFields          // embedded: JSON-inlined, exactly connectionSummarySchema's shape
    SortOrder int    `json:"sortOrder"`
    CreatedAt string `json:"createdAt"`
    UpdatedAt string `json:"updatedAt"`
}
type ConnectionState struct{ ... }   // moved from repos/connections.go, unchanged

func ValidConnectionKind(string) bool   // the 11 kinds
func ValidConnectionColor(string) bool  // the 13 colours — the whole set, not
                                        // CONNECTION_COLOR_CHOICES (P42 F27: a retired colour
                                        // must keep parsing or trimming the palette deletes rows)
func ValidConnectionMode(string) bool   // fields | uri
```

There is **no `Password` field anywhere in this package** — P1 D9 enforced by the type, exactly as
the TS build's `.omit({password: true})` does.

**`ops.go`** — `OpRecord` (moved), `OpAppend{ID, ConnectionID, TabID, Kind, StartedAt}`,
`OpFinish{Status, DurationMs, Rows, Command, Error}`, `ValidOpKind` (the 11 kinds including
`transfer`; **`ddl` is not one of them**), `ValidOpStatus` (running/ok/error/cancelled).

**`queries.go`**

```go
type SortTerm struct{ Column string `json:"column"`; Direction string `json:"direction"` }

// SortSpec is src/shared/domain/queries.ts's discriminated union. The custom codec is what keeps
// the two arms honest: marshalling never emits the other arm's key, and unmarshalling rejects a
// value that carries neither.
type SortSpec struct {
    Kind  string     // "structured" | "text"
    Terms []SortTerm // structured only
    Text  string     // text only, <= 4096 (queries.ts's own cap)
}
func (s SortSpec) MarshalJSON() ([]byte, error)
func (s *SortSpec) UnmarshalJSON([]byte) error

type FilterBody  struct{ Where *string `json:"where"`; OrderBy *SortSpec `json:"orderBy"` }
type ConsoleBody struct{ Text string `json:"text"` }

type SavedQuery struct {
    ID, ConnectionID, Path, Name, Kind string
    Body      json.RawMessage   // validated against Kind on read; stored bytes preserved
    Pinned    bool
    CreatedAt string
    UsedAt    *string
}
type SavedQueryPatch struct{ Name *string; Pinned *bool }

type FilterHistoryEntry struct {
    ID, ConnectionID, Path string
    Where   *string   `json:"where"`
    OrderBy *SortSpec `json:"orderBy"`
    UsedAt  string
}

func ValidSavedQueryKind(string) bool  // filter | console
func ValidSavedQueryName(string) error // trimmed, 1..120 (queries.ts's savedQueryBase)
```

`SavedQuery.Body` stays `json.RawMessage` rather than a Go sum type: the bytes are the wire value,
the repo validates them against `Kind` by unmarshalling into `FilterBody`/`ConsoleBody` and
discarding the result, and a failure drops the row. This keeps one struct on the wire without
inventing a Go-side union the renderer would have to be taught about.

**`treefilter.go`** — `TreeVisibility`, `EmptyVisibility()` (moved from `repos/filters.go`).

### 4.3 `internal/storage/db.go` and `migrate.go`

`migrate()` moves verbatim from `db.go` into `migrate.go`, matching P52 §2.1's `storage/ db.go
migrate.go` layout. No behaviour change: same forward-only `schema_version` runner, same refusal on
a newer version, same one transaction per step. `db.go` keeps `Open()`, the four pragmas, the
`os.Chmod` ordering (and its comment — P52's own finding that `sql.Open` is lazy) and `Close()`.

### 4.4 `internal/storage/repos/repos.go`

```go
type Repos struct {
    Settings      *SettingsRepo
    Layout        *LayoutRepo
    Tabs          *TabsRepo
    Connections   *ConnectionsRepo
    Ops           *OpsRepo
    Filters       *FiltersRepo
    SavedQueries  *SavedQueriesRepo
    FilterHistory *FilterHistoryRepo
    Metadata      *MetadataCacheRepo
}

// New prepares P52 §5.4's five hot statements once and hands back every repo that needs no
// cipher. SecretsRepo is constructed separately (NewSecrets) because its Cipher lands in P55.
func New(db *sql.DB) (*Repos, error)
func (r *Repos) Close() error
```

The five prepared statements, per §5.4's own list ("settings read, layout read, tabs list, op-log
append/finish"): `SettingsRepo.selectAll`, `LayoutRepo.selectAll`, `TabsRepo.selectAll`,
`OpsRepo.insert`, `OpsRepo.update`. Everything else uses `db.Query`/`db.Exec` directly — §5.4 is
explicit that at this app's row counts that is not a measurable cost.

### 4.5 The ten repos: exact method sets

All methods return `(…, error)`; errors wrap with `fmt.Errorf("repos/<name>: …: %w", err)` matching
the existing files. Dropped rows are `slog.Warn`ed with a `scope` attribute
(`slog.Warn(msg, "scope", "storage/tabs")`) — P52 §4.1's `internal/logging` will install the file
handler via `slog.SetDefault` in a later phase, and no repo changes when it does.

```go
// settings.go
func (r *SettingsRepo) GetAll() (model.Settings, error)
func (r *SettingsRepo) Set(patch model.SettingsPatch) (model.Settings, error)

// layout.go
func (r *LayoutRepo) GetAll() (model.Layout, error)
func (r *LayoutRepo) Set(patch model.LayoutPatch) (model.Layout, error)

// tabs.go
func (r *TabsRepo) List() ([]model.TabRecord, error)
func (r *TabsRepo) Save(records []model.TabRecord) error   // name kept: the bound channel is tabs.save

// connections.go
func (r *ConnectionsRepo) List() ([]model.ConnectionSummary, error)
func (r *ConnectionsRepo) Get(id string) (*model.ConnectionSummary, error)   // (nil, nil) when absent
func (r *ConnectionsRepo) Insert(id string, f model.ConnectionFields, createdAt string) (model.ConnectionSummary, error)
func (r *ConnectionsRepo) Update(id string, f model.ConnectionFields, updatedAt string) (model.ConnectionSummary, error)
func (r *ConnectionsRepo) Delete(id string) error
func (r *ConnectionsRepo) Reorder(ids []string) ([]model.ConnectionSummary, error)

// ops.go
func (r *OpsRepo) Append(op model.OpAppend) error
func (r *OpsRepo) Finish(id string, patch model.OpFinish) error
func (r *OpsRepo) Recent(limit int) ([]model.OpRecord, error)
func (r *OpsRepo) Prune(retentionDays int) error

// filters.go
func (r *FiltersRepo) List(connectionID string) (model.TreeVisibility, error)
func (r *FiltersRepo) Replace(connectionID string, v model.TreeVisibility) (model.TreeVisibility, error)

// saved_queries.go
func (r *SavedQueriesRepo) ListFilters(connectionID, path string) ([]model.SavedQuery, error)
func (r *SavedQueriesRepo) ListConsole(connectionID, path string) ([]model.SavedQuery, error)
func (r *SavedQueriesRepo) SaveFilter(connectionID, path, name string, body model.FilterBody, pinned bool) (model.SavedQuery, error)
func (r *SavedQueriesRepo) SaveConsole(connectionID, path, name string, body model.ConsoleBody, pinned bool) (model.SavedQuery, error)
func (r *SavedQueriesRepo) Update(id string, patch model.SavedQueryPatch) (model.SavedQuery, error)
func (r *SavedQueriesRepo) Delete(id string) error
func (r *SavedQueriesRepo) Touch(id string) error

// filter_history.go
func (r *FilterHistoryRepo) Record(connectionID, path string, where *string, orderBy *model.SortSpec) error
func (r *FilterHistoryRepo) List(connectionID, path string, limit int) ([]model.FilterHistoryEntry, error)

// metadata_cache.go
func (r *MetadataCacheRepo) Get(connectionID, path, kind string) (json.RawMessage, error) // (nil, nil) on miss
func (r *MetadataCacheRepo) Put(connectionID, path, kind string, payload json.RawMessage) error
func (r *MetadataCacheRepo) Drop(connectionID, path string) error
func (r *MetadataCacheRepo) DropConnection(connectionID string) error

// secrets.go
type Cipher interface { Encrypt(string) (string, error); Decrypt(string) (string, error) }
func NewSecrets(db *sql.DB, c Cipher) *SecretsRepo
func (r *SecretsRepo) Get(connectionID string) (*string, error)
func (r *SecretsRepo) Set(connectionID string, secret *string) error
func (r *SecretsRepo) Copy(from, to string) error
func (r *SecretsRepo) Delete(connectionID string) error
```

Behaviour notes the implementer must not have to re-derive from the `.ts`:

- **`SettingsRepo.Set`** validates the patch (`model.SettingsPatch.Validate()`), then writes **only
  the leaves the caller actually patched** in one transaction (D15's whole point — a full rewrite
  would touch eleven unrelated rows), upserting with
  `INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  and returns `GetAll()` afterwards.
- **`LayoutRepo.Set`** deliberately does the opposite — it writes **all six** leaves every time,
  mirroring `layout.ts`'s `flatten(merged)`. Do not "optimise" it into a patched-leaves-only write;
  the two repos differ on purpose.
- **`ConnectionsRepo.Insert`** computes `COALESCE(MAX(sort_order), -1) + 1` **inside the same
  transaction as the insert**. The TS build does these as two separate statements; under Go's
  `SetMaxOpenConns(1)` a transaction costs nothing and removes the race outright.
- **`ConnectionsRepo.List`** orders by `sort_order ASC, name ASC` (§1.3), never selects `password`,
  and drops a row whose `options_json`, `kind`, `color` or `mode` fails validation.
- **`Reorder`** writes `sort_order = index` for each id in one transaction, then returns `List()`.
- **`TabsRepo.Save`** rewrites `order` as the slice index so the stored order is always dense (D17).
- **`FilterHistoryRepo.Record`** returns early when both `where` and `orderBy` are nil ("I cleared
  the filter is not history"), then in one transaction: delete the identical prior entry, insert the
  new one with `id.New()` and `model.NowISO()`, and apply §3.2's cap statement. The dedupe `DELETE`
  uses SQLite's **`IS`** operator (`WHERE connection_id = ? AND path = ? AND where_text IS ? AND
  order_by_json IS ?`) — `IS` compares NULLs as equal, so one SQL string replaces the TS build's
  `isNull`-vs-`eq` conditional and keeps §5.4's no-per-call-shape rule intact.
- **`MetadataCacheRepo.Put`** merges into the existing row's payload object
  (`{children?, describe?, definition?}` — the unique index is `(connection_id, path)` and `kind` is
  informational), refuses a merged payload over **4 MiB** with a warn and no write, upserts with
  `ON CONFLICT(connection_id, path) DO UPDATE`, then runs §3.2's 200-row-per-connection eviction —
  all in one transaction.
- **`OpsRepo.Recent`** drops a row whose `kind` or `status` is not in the model's vocabulary, with a
  warn. There is no `'ddl'` special case (§3.1).

### 4.6 Wiring changes outside `internal/storage/`

Mechanical, all inside `shell/`:

- `internal/appcore/deps.go`: the six `*repos.XRepo` fields become one `Repos *repos.Repos`.
- `main.go`: `repos.New(db.DB)` once, `defer r.Close()`, assign into `Deps`.
- `internal/bridge/{settings,layout,tabs,ops,connections,filters}.go`: `s.Deps.Settings` →
  `s.Deps.Repos.Settings` (one line each), and `repos.Settings`/`repos.Layout`/`repos.TabRecord`/
  `repos.OpRecord`/`repos.ConnectionSummary`/`repos.ConnectionState`/`repos.TreeVisibility` →
  `model.…`.

**No bridge method is added, removed or re-specified.** The nine boot calls keep behaving exactly
as they do today; P56 owns the other 52.

## 5. Testing plan

Follows P52 §13 to the letter: `go test ./...`, standard-library `testing`, table-driven, one test
dependency (`github.com/google/go-cmp`), tests beside the code, `package <pkg>_test` where the
public surface is enough (it is, everywhere except `model`'s codec tests if they need internals),
`t.Setenv("KIRA_HOME", t.TempDir())` in every test that touches the filesystem, real SQLite and the
real embedded migrations rather than mocks. **These are the first Go tests in this repo** —
`bun run test:go` currently passes vacuously.

**The harness** (`repos/helpers_test.go`, `package repos_test`):

```go
func newDB(t *testing.T) *repos.Repos    // t.Setenv KIRA_HOME -> t.TempDir(); storage.Open();
                                          // repos.New(); t.Cleanup closes both
```

Going through the real `storage.Open()` is what makes the migrations covered on every single run —
P52 §13's stated reason for preferring real dependencies, and something `tests/unit/`'s hand-restated
DDL never achieved.

### 5.1 `internal/storage` (P52 §13's `storage` row)

| Test | Asserts |
|---|---|
| `TestOpenCreatesTightPermissions` | db file `0600`; `KIRA_HOME` and `logs/` `0700` |
| `TestOpenAppliesPragmas` | table: `journal_mode=wal`, `synchronous=1`, `foreign_keys=1`, `busy_timeout=5000` |
| `TestMigrateIsIdempotent` | Open, close, Open again — no error, `schema_version` still at max |
| `TestMigrateRefusesNewerSchemaVersion` | set version 99, reopen, error mentions "newer" |
| `TestMigrateCreatesExpectedSchema` | the nine tables of §1.1 exist; `connection_filters` does **not** (0005 drops it) |

### 5.2 `internal/storage/repos` (P52 §13's `storage/repos` row, ~line 991)

Every item §13 names is covered, plus the per-repo round trip it asks for.

- **`settings_test.go`** — defaults on an empty DB; **per-leaf fallback**: seed only
  `appearance.fontSize`, assert that leaf changes and every other leaf stays at its default;
  round trip `Set` → `GetAll` with `go-cmp`; **patched-leaves-only** (D15): after
  `Set({cache:{l2BudgetMb:128}})` the `settings` table holds exactly one row; table of invalid
  stored leaves (`"banana"` for `rowDensity`, `2000` for `l2BudgetMb`, `"12"` for `fontSize`) each
  falling back to its default (D4); table of out-of-range patches each rejected by `Set`.
- **`layout_test.go`** — defaults on empty; `Set` writes all six leaves; window-bounds round trip
  and the `nil` default; unparseable leaf → default.
- **`tabs_test.go`** — **JSON shape**: `Save` → `List` returns `State` byte-identical; dense
  re-indexing (records handed in with `order` 7/3/9 come back 0/1/2); `connection_id` NULL round
  trip; table of dropped rows raw-inserted through the `*sql.DB`: invalid JSON state, non-object
  state (`[]`), kind `'banana'`, and **kind `'ddl'`** — the last one is the regression guard that
  §3.1's coercion stays deleted.
- **`connections_test.go`** — insert/get/list round trip including `Options`, `Preconnect` and every
  nullable; `sort_order` assignment 0,1,2 across three inserts; `Reorder`; the `name` tiebreak
  (§1.3) with two rows sharing a `sort_order`; `Update`; `Delete` **cascades** (seed a
  `saved_queries`, `metadata_cache`, `connection_tree_filters` and `filter_history` row first, then
  assert all four are gone — which also proves the `foreign_keys` pragma is live); table of dropped
  rows: bad `options_json`, unknown `kind`, unknown `color`.
- **`ops_test.go`** — `Append` → `Recent` shows `running` with null duration/rows; `Finish` →
  `Recent` shows the terminal row; `limit` and `started_at DESC` ordering; dropped-row table
  (`kind='ddl'`, `kind='banana'`, `status='weird'`); **`Prune` retention cut** (rows at now−40d and
  now−1d, `retentionDays=30`); **`Prune` 20 000-row hard cap** — insert 20 050 rows in one
  transaction with a prepared statement, assert exactly 20 000 survive and that they are the
  newest; `Prune` on an empty table is a no-op.
- **`filters_test.go`** — `Replace` → `List` round trip; replacing with an empty set clears;
  duplicate values in the input are absorbed (D10); a raw-inserted unknown `scope` is ignored;
  per-connection isolation.
- **`filter_history_test.go`** — record/list round trip for where-only, orderBy-only and both;
  both-nil records nothing; re-recording an identical entry moves it to the top without duplicating
  (count stays 1) — including the **NULL `where_text`** case, which is what the `IS` operator is
  there for; the 20-per-`(connection,path)` cap keeps the newest; `limit`; a raw-inserted invalid
  `order_by_json` row is dropped.
- **`saved_queries_test.go`** — save/list round trip for both kinds; kinds do not leak across
  `ListFilters`/`ListConsole`; ordering `pinned DESC, used_at DESC, name`; partial `Update` of
  `name`/`pinned`; `Touch` moves `used_at`; `Delete`; name validation table (empty, whitespace,
  121 chars); dropped-row table: invalid body JSON, and a body of the wrong shape for its kind
  (`kind='filter'` with `{"text":"x"}`).
- **`metadata_cache_test.go`** — put/get per kind; `children` and `describe` at one path coexist in
  one row and are both readable; miss returns nil; a >4 MiB merged payload is refused and leaves the
  existing row intact; `Drop`/`DropConnection`; the 200-row eviction keeps the newest and does not
  touch a second connection's rows (deterministic thanks to D6).
- **`secrets_test.go`** — a **real** AES-256-GCM cipher built in the test (random key, `kira:v2:`
  envelope) rather than a mock: set/get round trip; `Set(nil)` clears; `Get` on a NULL password
  returns nil; `Copy` reproduces the stored column **byte for byte** and, wrapped in a call-counting
  decorator, performs **zero** `Decrypt`/`Encrypt` calls (P25 D11); `Delete` nulls the column; a
  cipher error from `Decrypt` propagates out of `Get` rather than being swallowed.

### 5.3 `internal/storage/model` and `internal/id`

- `queries_test.go` — `SortSpec` marshal/unmarshal table: structured with terms, structured with an
  empty term list, text, text over 4096 rejected, unknown `kind` rejected, `null` handling; assert
  marshalling never emits the other arm's key.
- `settings_test.go` — `SettingsPatch.Validate()` bounds table, one row per constraint, each error
  naming its leaf.
- `uuid_test.go` — canonical shape, version/variant nibbles, 10 000 generated ids all distinct.

## 6. Sequencing

Five milestones, each ending at a green `go build ./...` (and from M2 on, a green `go test`).

- **M1 — `internal/id` + `internal/storage/model`.** Move the existing structs out of `repos`, add
  the new ones and the validators, update `repos`/`bridge`/`appcore` references. No behaviour
  change; the nine boot calls still return what they returned.
- **M2 — `db.go`/`migrate.go` split, plus `internal/storage`'s tests.** Establishes the harness and
  the `t.Setenv("KIRA_HOME", …)` convention before any repo test is written.
- **M3 — the six existing repos to full CRUD**, including §1.3's two fixes and §3.1's two coercion
  deletions, each with its test file.
- **M4 — the four new repos** (`saved_queries`, `filter_history`, `metadata_cache`, `secrets`),
  each with its test file.
- **M5 — `repos.New` aggregate, §5.4's five prepared statements, and the `Deps`/`main.go`/`bridge`
  rewiring.** Finish with `gofmt -l shell`, `go vet ./...`, `bun run test:go`, and a manual
  `bun run build:wails && cd shell && task darwin:build` (or the Linux equivalent) to confirm the
  app still boots and the renderer still gets its nine answers.

## 7. Scope boundary

**P53 touches no file under `src/`.** Confirmed by working through what a full storage layer needs:
the schema is already ported, the domain shapes are transcribed into Go rather than imported, and
no repo has an Electron dependency. Nothing about this phase requires a bridge method, an
`EngineHost` call or a renderer change to be buildable or testable — the Go test tier is the caller.

The only files changed outside `internal/storage/` are `main.go`, `internal/appcore/deps.go` and six
`internal/bridge/*.go` files, all for D1/D5's mechanical rewiring, all inside `shell/`.

Also explicitly out of scope: `internal/secrets` (the cipher and Keychain — P55, §3.3);
`internal/logging` (repos use `slog.Default()`, and a later phase installs the file handler with
`slog.SetDefault`, changing no repo); the op-log's `wireOplog` orchestration and its 500-op prune
counter (P55 — `OpsRepo.Prune` is the primitive it will call); `TreeService`'s cache-aside logic
(P55 — `MetadataCacheRepo` is the primitive); every remaining bridge method (P56); `docs/` updates
(P52 §14 assigns those to P57).

**No gate.** P52 §15: G1 is the only gate and it has passed.

## 8. Acceptance criteria

1. `bun run test:go` is green, and every row of P52 §13's `storage` and `storage/repos` coverage
   table has a named test (§5.1, §5.2).
2. All ten `src/main/storage/repos/*.ts` files have a Go counterpart under
   `shell/internal/storage/repos/`, with every method their TS callers use
   (`src/main/{connections,tree-service,oplog,window,engine-config,index}.ts` and
   `src/main/ipc/{settings,layout,tabs,ops,filters,queries}.ts`).
3. No `'ddl'` string appears anywhere under `shell/` (§3.1).
4. No SQL statement anywhere under `shell/` is built by string concatenation or has a
   parameter count that varies per call (§3.2 / P52 §5.4).
5. `upgradeLegacySecrets` has no Go counterpart, and no code path returns a non-enveloped stored
   value as a plaintext password (§3.3 / P52 §6.4).
6. `git diff --stat` shows zero files changed under `src/`, `tests/` and `scripts/`.
7. `gofmt -l shell` is empty and `go vet ./...` is clean.
8. The app still builds and boots, and the renderer still receives real answers to the nine boot
   calls.

## 9. Environment notes for the implementing session

- Per `AGENTS.md`'s P52 findings, **a fresh container has none of the toolchain**. For storage work
  specifically, the SQLite driver is cgo but needs no GTK, so `go test ./internal/...` and
  `go build ./internal/...` work with nothing installed. A bare `go test ./...` compiles the root
  `main` package, which imports Wails and therefore does need
  `apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev pkg-config` on Linux. Add that distinction
  to `AGENTS.md`'s P52-findings list — it is exactly the kind of environment fact that section
  exists to stop the next session re-deriving.
- `github.com/google/go-cmp` comes from `proxy.golang.org`, which is not blocked (P51/`AGENTS.md`).
  It is the **only** dependency this phase adds, and it is test-only.
- Inserting 20 050 rows for the hard-cap test should be one transaction with one prepared statement;
  done that way it runs in well under a second and needs no `testing.Short()` gate.
