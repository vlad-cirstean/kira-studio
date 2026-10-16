# M3 — EXPLAIN path over MCP: parsed responses, auto-force-explain, heavy-query flag

`docs/v1.7/SPEC.md`'s M3 row, turned into concrete steps. Everything below was read in the current
tree (`v1.7` at `a3895b7b`, M2 landed); line numbers are from that tree, not from M1's or M2's plan
doc.

Three deliverables, one phase:

1. `explain_query` — a sixth MCP tool returning the same normalized plan the console panel renders.
2. A per-connection auto-force-explain switch that plans a `run_query` SELECT before running it.
3. A heavy-query flag that raises M2's approval dialog for the **human**, not a note to the AI.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| Can `parseExplainPages` be reused from Go? | No. It is pure data transformation (good), but it is TypeScript in `frontend/src/views/console/`, and M4 — not M3 — owns the Go→JS bridge. Ported to a new Go package `internal/queryplan`, with a shared parity fixture set pinning the two implementations to identical output | §2 |
| `explain_query`'s input/output schema | `{connectionId, sql, path?, includeRaw?}` → `QueryPlan` JSON, `planModel.ts`'s exact field names, plus `thresholdRows`; `raw` omitted unless asked for | §4 |
| auto-force-explain: reuse `AutoExplain` or a new column? | New column, `mcp_auto_explain`. `AutoExplain` keeps its exact current meaning for the console. Reusing it would make one switch mean two different things with two different consequences | §3.1 |
| Where it plugs into `run_query` | After M2's classify-and-deny, before M2's prompt — so a denied statement buys no EXPLAIN, and one call raises at most one prompt | §5.2 |
| The heaviness threshold | `settingsState.advanced.expensiveQueryRows`'s own Go leaf (`model.Settings.Advanced.ExpensiveQueryRows`, default 100 000), read fresh per call through a new `Config.ExplainThreshold` closure | §3.3 |
| What "flagged back to the human" means | The query **pauses** on M2's `ApprovalBroker` and the human approves or denies it, exactly as a prompt-mode write does. One broker, one dialog, one queue — a second reason to raise it, not a second dialog | §6 |
| Heavy = the console's flag rule? | No, stricter: `overThreshold` only, never "any warn issue". The console's strip is advisory; a modal that blocks an AI client and interrupts a human must not fire on a SQLite full scan of a 40-row table | §6.1 |
| Which kinds support EXPLAIN | postgres, mysql, mariadb, sqlite, clickhouse. Not mongodb, redis, kafka, s3, sqs | §7 |
| Should EXPLAIN-ing a `DELETE` bypass the write/DDL gate? | The question does not arise: `explain_query` refuses anything that is not SELECT/WITH, on the console's own `isExplainable` rule. The composed EXPLAIN is then gated as `ClassRead` through M2's existing classifier, with no new permission vocabulary | §8 |
| Tests | One, named and justified: the five-dialect plan port, against fixtures the TypeScript spec reads too. Everything else declined | §10 |
| One Sonnet pass or a split | One, with two named fallback seams | §11.2 |

## 1. Confirmed current state

### 1.1 The EXPLAIN infrastructure is entirely in the renderer

Nothing in `apps/kira-studio/internal/` issues, spells or parses an EXPLAIN. `grep -rni explain
--include=*.go internal` returns only `ConnectionFields.AutoExplain`
(`storage/model/connection.go:21`-`24`), its column plumbing (`storage/repos/connections.go`), its
migration (`0004_p18_auto_explain.sql`) and unrelated prose. The adapters have no EXPLAIN concept:
the frontend composes EXPLAIN as ordinary statement text and sends it down the same
`data.execute` path any other statement takes.

The whole mechanism, per file:

| File | Lines | What |
|---|---|---|
| `frontend/src/views/console/explain.ts` | 48 | `isExplainable(sql)` (strip leading comments, require leading `SELECT`/`WITH`); `explainStatementsFor(kind, sql)` — the per-dialect statement composer |
| `views/console/plan.ts` | 105 | `parseExplainPages(kind, pages, thresholdRows)` — page-shape glue plus `ExplainTruncatedError` |
| `views/console/planModel.ts` | 63 | `QueryPlan`, `PlanNode`, `PlanIssue`, `CostUnit`, `ScanEstimate` — the normalized model |
| `views/console/planIssues.ts` | 57 | `pushWideScanIssue`, `maxEstimatedRows`, `rollupIssues`, `isOverThreshold` — the shared rules |
| `views/console/planParsers/postgres.ts` | 137 | |
| `views/console/planParsers/mysql.ts` | 194 | |
| `views/console/planParsers/mariadb.ts` | 159 | |
| `views/console/planParsers/sqlite.ts` | 66 | |
| `views/console/planParsers/clickhouse.ts` | 127 | |

`explainStatementsFor` (`explain.ts:24`-`48`) returns, per kind:

| Kind | Statement(s) |
|---|---|
| postgres | `EXPLAIN (FORMAT JSON, COSTS TRUE, VERBOSE FALSE, SETTINGS FALSE, BUFFERS FALSE) <sql>` |
| mysql, mariadb | `EXPLAIN FORMAT=JSON <sql>` (identical spelling, two genuinely different response schemas — F13) |
| sqlite | `EXPLAIN QUERY PLAN <sql>` |
| clickhouse | `EXPLAIN PLAN json = 1, indexes = 1, description = 1 <sql>` **and** `EXPLAIN ESTIMATE <sql>` — two statements, one Execute call |
| everything else | `[]` |

**`ANALYZE` is never emitted, on any dialect.** `explain.ts:18`-`19` states it as the premise the
whole feature rests on (P18 F16: EXPLAIN alone is ~800× cheaper than running the query). §8 makes
that property load-bearing rather than incidental.

### 1.2 `parseExplainPages` is pure — and is still TypeScript

`parseExplainPages(kind, pages, thresholdRows)` (`plan.ts:48`-`105`) reads only its arguments: the
`Page[]` returned by `data.execute`, the connection kind and a number. It touches no Vue reactive
state, no store, no DOM. Every `planParsers/*.ts` function under it is likewise `(rawText, number)
→ QueryPlan`, with `JSON.parse` and plain object walks. `planIssues.ts`'s four helpers are pure
functions over arrays.

So the honest answer to SPEC's first open question is **both halves at once**: it is exactly the
shape that ports cleanly, and it is nonetheless unreachable from a Go process today.

The only frontend coupling is the page accessors — `cellText`/`isNull`/`isTruncated` from
`@shared/protocol/page` — and each has a Go peer or near-peer (§2.3).

### 1.3 The threshold already exists, on the Go side

`model.Settings.Advanced.ExpensiveQueryRows` (`storage/model/settings.go:27`), default `100_000`
(`:83`), validated `InRange(1_000, 1_000_000_000)` (`:172`, `:193`), persisted as the dotted leaf
`advanced.expensiveQueryRows` (`repos/settings.go:63`, `:133`). The console reads its renderer-side
mirror, `settingsState.advanced.expensiveQueryRows`, at both call sites
(`views/console/state.ts:354`, `:561`).

`repos.Repos.Settings` is a `*SettingsRepo` with `GetAll()`/`Set(patch)` (`repos/settings.go:26`,
`:74`), and `appcore.Deps.Repos` carries it — so `bridge.DbMcpService` already has a handle.

### 1.4 The console's own flag rule, and why M3 does not copy it wholesale

`state.ts:291`-`293`:

```ts
function isFlaggedPlan(plan: QueryPlan): boolean {
  return plan.overThreshold || plan.issues.some((issue) => issue.severity === 'warn');
}
```

`overThreshold` is strictly the row-count test (`planIssues.ts:52`-`57`). A `warn` issue is a
structural rule — `full-scan`, `unused-index`, `filesort`, `temp-table`, `pk-not-narrowed`,
`all-parts-read`, `temp-btree`, `nested-loop-wide-inner`. On SQLite `overThreshold` is *always*
false (`planParsers/sqlite.ts:63` — the dialect reports no row estimate at all) while
`detail.startsWith('SCAN ')` pushes a `warn` for every full scan, which on a small SQLite file is
most queries. §6.1 is where that matters.

### 1.5 `run_query` as M2 actually shipped it

`dbmcp/tools.go:134`-`214`, in order: `resolveEnabled` (`access.go:15`); refuse before connecting
when all three modes deny (`:141`-`143`); clamp `maxRows` to 1-2000 (`:145`-`151`);
`connectForQuery` (`access.go:53`) and refuse when the state is not `connected`; `ClassifyStatement`
with a classifier error degrading to `ClassUnknown` (`:163`-`167`); `switch verdictFor(m, class)`
over allow / deny / prompt (`:169`-`195`); `Query.Execute`; `renderPage(resp.Pages[0], maxRows)`.

`renderPage` (`render.go:170`-`186`) is the single projection entry point M1 §9 named as M5's seam;
it has six references, five of them in `render_test.go` (found with `find_references`, §12).

`QueryRunner` (`server.go:63`-`69`) is `Execute` + `ClassifyStatement`. `adapterhost.ExecuteRequestWire`
takes `Statements []string` and `ExecuteResponse` returns `Pages []page.Page` (`adapterhost/wire.go:198`),
so a two-statement ClickHouse EXPLAIN is one call returning two pages — exactly what the console
does today.

`adapters.ClassifySQL` (`adapters/classify.go:79`-`135`) already has an `EXPLAIN` branch:
`ClassRead` unless the next word is `ANALYZE`, in which case it recurses into the remainder. Every
statement `explainStatementsFor` composes therefore classifies `ClassRead` today, with no change.

### 1.6 The approval machinery M2 built

- `dbmcp.ApprovalBroker` (`approval.go:73`-`210`): FIFO, `notify.Emitter[ApprovalSnapshot]`,
  120 s `ApprovalTimeout`, 50-entry cap, `Request` selecting on result / deadline / `ctx.Done()`,
  `Approve`/`Deny`/`AbandonAll`.
- `ApprovalRequest` (`approval.go:45`-`54`): RequestID, ConnectionID, ConnectionName, Kind, Class,
  Statement, EnqueuedAt, ExpiresAt.
- Wire: `bridge.DbMcpApprovalRequest`/`DbMcpApprovalSnapshot` (`bridge/dbmcp.go:286`-`314`),
  statement capped at 4000 rune-safe bytes; channel `kira:dbmcp:approval` (`bridge/events.go:61`,
  subscribed at `:128`); zod `dbMcpApprovalSchema`/`dbMcpApprovalSnapshotSchema`
  (`packages/shared/domain/dbmcp.ts`).
- UI: `workbench/DbMcpApprovalDialog.vue` (126 lines), always mounted at `App.vue`, Deny focused on
  mount, Escape denies, 1 s countdown ticker, "1 of N waiting", `CLASS_WORDS` lookup.

### 1.7 The connection record and its surfaces

`ConnectionFields` (`model/connection.go:7`-`39`) now carries `AutoExplain`, `ThrottlePerSec`,
`McpEnabled`, `McpDescription`, `McpReadMode`, `McpWriteMode`, `McpDdlMode`.

- Highest migration on disk: `0021_m2_connection_permissions.sql`. **Next number is 0022.**
- `connectionSelectColumns` (`repos/connections.go:12`-`16`) and `scanConnectionRow` (`:30`-`80`)
  are one shared list and one shared scan; five write methods bind their own value lists
  (`:186`, `:221`, `:272`, `:324`, `:372`/`:387`).
- `destinationUnchanged` (`connections/service.go:477`-`488`) compares only destination-relevant
  fields — it is documented as a deny-list, so a new non-destination field is an exception
  automatically. M1 and P28 each added a sentence to its doc comment naming their own new
  exception; M3 does the same and changes no code there.
- `connectionFieldsSchema` (`packages/shared/domain/connection.ts:106`+) and `defaultDraft()`
  (`state/connections.ts:71`-`91`) both list every key.
- `ConnectionDialog.vue`'s MCP tab is `DetailTab`'s fourth value (`:103`), with the exposure
  checkbox at `:775`, the description textarea at `:786` and the three `SegmentedControl` rows at
  `:806`/`:815`/`:824`, every one of them `:disabled="!draft.mcpEnabled"`.
- `SettingsDialog.vue:1202`-`1223` renders the per-connection glance row: name, then
  `read allow · write prompt · DDL deny`, then the description's first line.

## 2. The Go plan port — `internal/queryplan`

### 2.1 Decision: port, do not bridge

Three routes exist; two are refused for stated reasons.

**Refused — call the TypeScript from Go over a Bun subprocess.** M4's row owns the Go→JS bridge and
has not designed it yet; SPEC sequences M3 before M4 precisely so M4 can build one bridge rather
than two. Building it here would pre-empt M4's own planning pass and would put a process spawn on a
latency-sensitive path: auto-force-explain runs before a `run_query`, so every MCP SELECT would pay
it. It would also make an MCP tool's correctness depend on the frontend's module graph
(`views/console/planParsers/*` imports `@shared/protocol/page`), which is application source, not a
published package.

**Refused — return the raw driver output and let the model parse it.** SPEC's M3 row rules it out in
so many words: "the same nicely-parsed plan structure the console UI already renders, not a raw
driver dump". It is also the expensive answer in tokens, which is the whole reason the normalized
model exists.

**Chosen — port to Go, and pin the two implementations to the same fixtures.** The port is
mechanical: every function involved is pure (§1.2). The real cost is that the repo then states the
plan rules twice, and that is the cost this plan must pay down rather than wave at — §2.4.

Not considered a fourth option: making the renderer call Go for the parse, deleting the TypeScript
copy. It would be one source of truth, but it means re-sending already-decoded FlatBuffers pages
back across IPC and changing the human console's own behaviour, which M2 established this chapter
does not do (`M2 §4.3`).

### 2.2 Package shape

`apps/kira-studio/internal/queryplan/`, a new package below `internal/bridge`
(`internal/layering_test.go` picks it up automatically). It imports `internal/page` and stdlib only
— not `internal/dbmcp`, not `internal/adapters`.

| File | Ported from | What |
|---|---|---|
| `plan.go` | `planModel.ts` | `Plan`, `Node`, `Issue`, `Metric`, `Cost`, `CostUnit`, `scanEstimate` |
| `issues.go` | `planIssues.ts` | `pushWideScanIssue`, `maxEstimatedRows`, `rollupIssues`, `isOverThreshold` |
| `statements.go` | `explain.ts` | `Explainable(sql) bool`, `StatementsFor(kind, sql) []string`, `Supported(kind) bool` |
| `parse.go` | `plan.ts` | `FromPages(kind string, pages []page.Page, thresholdRows int) (Plan, error)`, `ErrTruncated`, the shared unknown-key collector |
| `postgres.go`, `mysql.go`, `mariadb.go`, `sqlite.go`, `clickhouse.go` | `planParsers/*.ts` | one parser each |

Go model, field-for-field with `planModel.ts` and JSON-tagged to produce the identical object:

```go
type CostUnit string // "postgres-planner" | "mysql-cost" | "mariadb-cost" | "none"

type Issue struct {
	Severity string `json:"severity"` // "warn" | "info"
	Code     string `json:"code"`
	Message  string `json:"message"`
}

type Metric struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

type Cost struct {
	Total   float64  `json:"total"`
	Startup *float64 `json:"startup,omitempty"`
}

type Node struct {
	Label         string   `json:"label"`
	Relation      string   `json:"relation,omitempty"`
	Detail        string   `json:"detail,omitempty"`
	EstimatedRows *float64 `json:"estimatedRows,omitempty"`
	Cost          *Cost    `json:"cost,omitempty"`
	Metrics       []Metric `json:"metrics"`
	Issues        []Issue  `json:"issues"`
	Children      []Node   `json:"children"`
}

type Plan struct {
	Kind              string   `json:"kind"`
	Root              Node     `json:"root"`
	EstimatedRowsRead *float64 `json:"estimatedRowsRead,omitempty"`
	NativeCost        *struct {
		Value float64  `json:"value"`
		Unit  CostUnit `json:"unit"`
	} `json:"nativeCost,omitempty"`
	Issues        []Issue `json:"issues"`
	OverThreshold bool    `json:"overThreshold"`
	Raw           string  `json:"raw,omitempty"`
}
```

`float64`, not `int`, for row estimates: Postgres's `Plan Rows` and MariaDB's `rows` are JSON
numbers the TypeScript side keeps as `number`, and rounding them in Go would make the two
implementations disagree on a fixture. `Metrics`, `Issues` and `Children` are always non-nil slices
so they marshal as `[]`, never `null` — `Router` already applies that rule on every metadata path
(`M1 §5.1`).

### 2.3 Two mechanical differences the port must handle deliberately

**1. `page.IsTruncated` does not exist on the Go side.** `plan.ts:33`-`36`'s `firstCellTruncated`
is what turns a plan clipped at `page.MaxCellBytes` (64 KiB) into `ExplainTruncatedError` rather
than an opaque JSON parse failure, and it fires for postgres, mysql, mariadb and clickhouse — every
dialect that returns its whole plan in one cell. Go has `page.IsNull` and `page.CellText`
(`page/chunk.go:51`, `:56`) but no truncation accessor; `Chunk.Truncated` is a sorted `[]uint32` of
row indices (`chunk.go:43`; TS reads it with a binary search, `protocol/page.ts:248`-`250`).

Add, beside `IsNull`:

```go
// IsTruncated reports whether row's cell was clipped at MaxCellBytes. Truncated is the sorted row
// index list the builder writes, not a bitset — protocol/page.ts's isTruncated binary-searches the
// same list.
func IsTruncated(chunk Chunk, row int) bool
```

Three lines over `sort.Search`. It belongs in `page`, not `queryplan`: it is the peer of an
accessor the package already owns, and putting it anywhere else would be the second reader of a
wire detail.

**2. Go maps have no insertion order, and `metrics` is built from one.** Every parser's
`metricsFrom`/`tableMetrics` iterates `Object.entries(raw)` and emits each key the parser has no
typed slot for, in document order. Go's `map[string]json.RawMessage` cannot reproduce that.

Resolution: each Go parser decodes twice — once into its typed struct, once into
`map[string]json.RawMessage` — and emits the untyped keys **sorted by label**, through one shared
helper in `parse.go`. The order of `metrics` is declared non-contractual in `plan.go`'s doc comment
and in `explain_query`'s tool description; a client that needs the server's exact field order reads
`raw`, which is verbatim. §2.4's parity check sorts `metrics` on both sides before comparing, so
this is the one difference the fixtures deliberately do not pin.

Rejected alternative: a streaming `json.Decoder`/`Token()` walk to preserve key order. It is real
machinery — a hand-rolled ordered-object decoder, per parser — bought for a property no consumer
has: neither the panel (which renders a list) nor a model reading JSON depends on which order two
metric labels arrive in.

### 2.4 Paying down the second copy: shared parity fixtures

`apps/kira-studio/tests/unit/explain-plan.spec.ts` (348 lines) already holds F11-F15's verified
real-server output, pasted verbatim inline, plus per-rule assertions. Those fixtures are the
strongest verification material in the repo for this code, and they are currently reachable from
one language.

New: `apps/kira-studio/tests/fixtures/explain-plans/`, one pair per case —

- `<case>.input.json` — `{"kind": "...", "pages": [...]}`, where `pages` is the raw EXPLAIN text
  each dialect returns (for SQLite, the id/parent/detail rows; for ClickHouse, both pages).
- `<case>.expected.json` — the normalized `Plan`, metrics sorted by label.

Both sides read the same files:

- `tests/unit/explain-plan.spec.ts` gains one `describe('parity fixtures')` block that runs the
  TypeScript parser over each input, sorts `metrics`, and deep-equals `expected.json`. **Its
  existing per-rule assertions stay exactly as they are** — they are richer than a fixture compare
  and this phase does not rewrite passing tests. Moving the inline fixture strings out into the new
  files and importing them back is the only edit to the existing blocks.
- `internal/queryplan/parse_test.go` reads the same files and asserts the same equality (§10).

Cases, one per shape the existing spec already covers: postgres join plan, postgres index-only
scan, mysql single table, mysql nested loop, mysql materialized subquery, mariadb nested loop,
mariadb filesort, sqlite scan/search mix, sqlite covering index, clickhouse with ESTIMATE,
clickhouse without ESTIMATE, plus one truncated-cell case per single-cell dialect asserting
`ErrTruncated`/`ExplainTruncatedError`.

This is what makes the second implementation defensible: a drift in either language fails a test in
that language, on the same bytes. It is also what pins `explain_query`'s own wire contract, since
the tool returns exactly this JSON.

## 3. auto-force-explain

### 3.1 A new column, not a reuse of `AutoExplain`

**Decision: `mcp_auto_explain`, separate from `auto_explain`.**

`AutoExplain` today means: the console's `run()` issues EXPLAIN before a SELECT and shows a warning
strip, never blocking (`model/connection.go:21`-`24`, `state.ts:393`-`424`). M3's switch means: the
MCP server issues EXPLAIN before a `run_query` SELECT and, past the threshold, **blocks the AI
client on a modal a human must answer**.

Reusing one column would mean:

- Turning on the console's advisory strip silently turns on modal interrupts for every MCP query on
  that connection. A user who wanted a warning gets a gate.
- A user who wants the MCP gate but not the console strip cannot have it.
- The reverse tightening at migration time would change the behaviour of a pre-existing,
  human-facing feature that has shipped since P18 — the exact risk this table entry exists to name.

It is also the shape M2 already chose in this chapter: `ReadOnly` governs the console, the three
`mcp_*_mode` columns govern MCP, and `model/connection.go:34`-`35` says so in a comment. M3 follows
the precedent rather than inverting it one phase later.

`AutoExplain`'s meaning, behaviour, column, migration, UI control and console code path are
**untouched by this phase**.

### 3.2 Migration `0022_m3_connection_mcp_explain.sql`

```sql
-- M3: per-connection auto-force-explain on the DB MCP server's run_query path. One plain column
-- with a non-NULL default, the 0004/0020/0021 precedent — first-class rather than an options_json
-- key for the same reason those three give: `options` round-trips through the connection URI and
-- the Copy URI menu item, and a safety gate must not be settable, or clearable, by pasting a URI.
--
-- Deliberately separate from auto_explain (0004), which governs this app's own console and is left
-- untouched: that switch shows a warning strip after the fact, this one can block an AI client on a
-- modal a human must answer. One switch cannot honestly mean both.
--
-- Default 1, not 0: M1 §4.5 recorded run_query's uncapped fetch as the gap M3 exists to close, and
-- a protection nobody turns on protects nobody. Applied to rows exposed under M1/M2 as well, the
-- same not-opt-in tightening 0021 made.
ALTER TABLE connections ADD COLUMN mcp_auto_explain INTEGER NOT NULL DEFAULT 1;
```

plus `{22, "m3_connection_mcp_explain", "0022_m3_connection_mcp_explain.sql"}` in
`migrations/embed.go`'s `names`.

INTEGER, not TEXT: this is a boolean, and `auto_explain`/`mcp_enabled` are both stored that way
(`repos/connections.go:39`, `:80`).

**The cost of defaulting on, stated plainly because it is user-visible**: on a postgres/mysql/
mariadb/sqlite/clickhouse connection already exposed to MCP, every `run_query` whose statement is a
SELECT or WITH now issues one extra EXPLAIN round trip, and a plan over the threshold raises a
modal the user did not previously see. §9.2 puts that sentence in the Settings section's own helper
text rather than letting a user discover it.

### 3.3 Model, validation, schema, threshold

- `model.ConnectionFields` gains:

```go
// M3: runs this connection's own EXPLAIN before every explainable run_query on the DB MCP path,
// and pauses the query for a human decision when the plan crosses the expensive-query row
// threshold. Separate from AutoExplain, which governs this app's own console — see the migration's
// own comment for why one switch cannot mean both.
McpAutoExplain bool `json:"mcpAutoExplain"`
```

- `connectionSelectColumns` gains `mcp_auto_explain`; `scanConnectionRow` gains an `int` scan target
  beside `autoExplain`/`mcpEnabled` and `c.McpAutoExplain = mcpAutoExplain != 0`; the five write
  methods bind `boolToInt(f.McpAutoExplain)`.
- No `connections/input.go` change — a bool has no constraint to enforce, exactly as `McpEnabled`
  needed none (M1 §1.7).
- `connections/service.go`'s `destinationUnchanged` doc comment gains one sentence naming
  `McpAutoExplain` as an exception for the same reason `McpEnabled` is: it gates what this
  connection does on the MCP path, never what it connects to. No code change (§1.7).
- `packages/shared/domain/connection.ts`: `mcpAutoExplain: z.boolean().default(true)`, beside
  `mcpEnabled`. `.default` is load-bearing for older stored rows exactly as its neighbours' are.
- `state/connections.ts`'s `defaultDraft()` gains `mcpAutoExplain: true`.

**The threshold seam.** `dbmcp.Config` gains:

```go
// ExplainThreshold is the expensive-query row threshold (advanced.expensiveQueryRows) — read
// fresh on every call, never cached: a stale threshold silently mis-flags every query after the
// user changes it. A plain func rather than an interface, gitsession.Registry.Settings's own seam
// (registry.go:48-58), so this package keeps its four existing backends and adds no fifth service
// dependency. Required.
ExplainThreshold func() int
```

Checked in `New` beside `Approvals` (`server.go:139`-`141`). Required rather than nil-defaulted:
a silently-defaulted threshold makes every heavy-query verdict wrong in a way nothing surfaces.
`bridge/dbmcp.go` supplies it from `s.Deps.Repos.Settings.GetAll()`, falling back to
`model.DefaultSettings().Advanced.ExpensiveQueryRows` on a read error (a settings read failure must
not break a query; it must use the documented default and log once).

## 4. `explain_query`

### 4.1 Input

```go
type explainQueryArgs struct {
	ConnectionID string `json:"connectionId" jsonschema:"Connection id from list_connections."`
	SQL          string `json:"sql" jsonschema:"One SELECT or WITH statement to plan. It is not executed — EXPLAIN is always issued without ANALYZE."`
	Path         string `json:"path,omitempty" jsonschema:"Encoded path selecting the database to plan against, from list_children. Required for engines with more than one database; ignored by engines with one."`
	IncludeRaw   bool   `json:"includeRaw,omitempty" jsonschema:"Also return the server's own raw EXPLAIN text. Default false — it can be tens of kilobytes, and the parsed plan above is the point."`
}
```

No `maxRows`: a plan is not rows.

### 4.2 Output

`queryplan.Plan` as compact JSON (§2.2's tags), plus one MCP-only field the TypeScript model has no
need for:

```json
{"kind":"postgres",
 "root":{"label":"Limit","cost":{"total":7814.41,"startup":7814.39},"estimatedRows":10,
         "metrics":[],"issues":[],"children":[…]},
 "estimatedRowsRead":184153,
 "nativeCost":{"value":7814.41,"unit":"postgres-planner"},
 "issues":[{"severity":"warn","code":"full-scan","message":"full table scan on \"t\" with a filter — no index was used"}],
 "overThreshold":true,
 "thresholdRows":100000}
```

`thresholdRows` is added because the client cannot otherwise interpret `overThreshold` — the panel
knows the threshold from settings, an MCP client does not.

`raw` is **omitted unless `includeRaw`**, the one deliberate divergence from `QueryPlan`'s TS shape.
It can be a full 64 KiB cell, and shipping it by default would undo the token saving the normalized
model exists to produce.

### 4.3 Handler order

1. `resolveEnabled(connectionId)` — unchanged gate.
2. `queryplan.Supported(summary.Kind)` — false for mongodb/redis/kafka/s3/sqs; `errResult` naming
   the kind (§7). **Before connecting**: nothing this call can do will succeed.
3. `queryplan.Explainable(args.SQL)` — false for anything but SELECT/WITH; `errResult` (§8).
   Before connecting, same reason.
4. `summary.McpReadMode == "deny"` → `errResult`. Before connecting: a denied caller starts no
   pre-connect script.
5. `connectForQuery` — unchanged helper; refuse when the resulting state is not `connected`.
6. `statements := queryplan.StatementsFor(summary.Kind, args.SQL)`; for each, assert
   `Query.ClassifyStatement` reports `ClassRead` (§8.3). A non-read verdict is an internal
   refusal, not a caller error.
7. `verdictFor(modesOf(summary), adapters.ClassRead)` — i.e. the read mode. `prompt` raises M2's
   approval with `Reason: ApprovalReasonPermission` and the composed statement; `deny` is already
   handled at step 4; `allow` falls through.
8. `Query.Execute` with all composed statements in one `ExecuteRequestWire`.
9. `queryplan.FromPages(kind, resp.Pages, threshold)`. `ErrTruncated` → an `errResult` saying the
   plan was too large to parse and suggesting a narrower statement; any other parse error →
   `errResult` with the parser's own message. Neither is a Go error: both are conditions the caller
   can act on.
10. `jsonResult(plan + thresholdRows)`, dropping `Raw` unless `IncludeRaw`.

Registration in `buildMCPServer` (`server.go:188`) as a sixth `AddTool`, M1 §9's named seam:

> `explain_query` — Plan one SELECT or WITH statement without running it, and return the normalized
> plan: the node tree, each node's estimated rows and native cost, and the structural issues this
> app detects (full scans, unused indexes, filesorts). Not available on mongodb, redis, kafka, s3
> or sqs. Metric order within a node is not contractual; pass includeRaw for the server's own text.

The server `instructions` paragraph (`server.go:120`) gains one sentence: plan an expensive-looking
query with `explain_query` before running it, and expect `run_query` to plan it anyway on
connections whose owner turned auto-explain on.

## 5. auto-force-explain inside `run_query`

### 5.1 The shared helper

`internal/dbmcp/explain.go`, new — the body both `explainQuery` and `runQuery` call, so the compose
/ classify-assert / execute / parse sequence exists once:

```go
// planFor composes, verifies and runs this connection's own EXPLAIN for sql, and parses the result.
// Returns (nil, nil) when this kind has no EXPLAIN this app can parse or sql is not explainable —
// a no-op, not a failure.
func (s *Server) planFor(ctx context.Context, summary model.ConnectionSummary, sql, path string) (*queryplan.Plan, error)
```

```go
// planSummary is what an AI client gets beside a run_query result, and what the approval dialog
// renders: the numbers a decision turns on, never the whole tree (that is explain_query's job).
type planSummary struct {
	EstimatedRowsRead *float64 `json:"estimatedRowsRead,omitempty"`
	ThresholdRows     int      `json:"thresholdRows"`
	OverThreshold     bool     `json:"overThreshold"`
	Issues            []queryplan.Issue `json:"issues"`
}
```

### 5.2 Gate order, and why it is not M2's stated seam

M2 §11's seam table predicted "auto-force-explain runs before the §4.2 gate, since a plan is a read
regardless of what it plans". **That is changed here, deliberately, and the reason is the heavy
flag M2 did not yet have to place.** Two things force the move:

- A statement the permission gate will *deny* must buy no server work. Planning first would issue
  an EXPLAIN for a `DELETE` on a connection whose write mode is `deny` — work done for a caller who
  is about to be refused.
- One `run_query` call must raise **at most one** prompt. A permission prompt and a heavy prompt for
  the same statement would be two modals for one decision. So the plan has to exist *before* the
  prompt is raised, which puts the EXPLAIN after classification and before the approval.

Final order in `runQuery`, with the M2 steps marked unchanged:

| # | Step | New? |
|---|---|---|
| 1 | `resolveEnabled` | unchanged |
| 2 | refuse before connecting when all three modes deny | unchanged |
| 3 | clamp `maxRows` | unchanged |
| 4 | `connectForQuery`, refuse when not `connected` | unchanged |
| 5 | `ClassifyStatement`, degrading to `ClassUnknown` on error | unchanged |
| 6 | `verdict := verdictFor(m, class)`; **`deny` → refuse here, before any EXPLAIN** | reordered |
| 7 | when `summary.McpAutoExplain` → `planFor(...)`; a nil plan or any error degrades to "no plan", never blocks | **new** |
| 8 | `heavy := plan != nil && plan.OverThreshold` (§6.1) | **new** |
| 9 | when `verdict == "prompt" || heavy` → **one** `Approvals.Request` (§6.2); anything but approval refuses | extended |
| 10 | `Query.Execute` | unchanged |
| 11 | `renderPage(resp.Pages[0], maxRows, summaryOf(plan))` | extended |

Step 7's failure posture is the console's own D19 rule 6 (`state.ts:360`-`371`): an EXPLAIN-call
failure never blocks the real run. Logged at `Warn` with the connection id, then treated as "no
plan". A `run_query` must not start failing because a plan could not be parsed.

**Consequence, stated rather than hidden**: on a connection whose read mode is `prompt` with
auto-force-explain on, the plan-only EXPLAIN runs *before* the human is asked about the query. That
is deliberate — it is the minimum work needed to tell the human what they are approving, it does
not execute the statement (`ANALYZE` is never emitted, §1.1/§8.3), and the alternative is either a
prompt with no information in it or two prompts for one statement.

**Bound, also stated**: auto-force-explain only fires for statements `queryplan.Explainable`
accepts, i.e. SELECT and WITH. A write or DDL statement is never planned, so its permission prompt
carries no plan. SPEC's "before every `run_query` call" is bounded by what can be planned without
running it, and by §7's kind matrix.

### 5.3 The result envelope

`renderPage` gains a third parameter and each of the four `render*Page` functions sets one embedded
field, rather than a post-hoc type switch over `any`:

```go
// planEnvelope is embedded in each result struct so `plan` inlines into the same JSON object the
// client already reads — run_query's response shape is otherwise unchanged from M1/M2.
type planEnvelope struct {
	Plan *planSummary `json:"plan,omitempty"`
}
```

Embedded into `tabularResult`, `documentResult`, `keyValueResult`, `streamResult`. Omitted entirely
when no plan was produced — never a `"plan": null` a client might read as "planned, found nothing".
`renderPage` stays the single projection entry point M5 inserts itself before (M1 §9's seam,
unchanged). `render_test.go`'s five call sites take one extra `nil` argument.

## 6. The heavy-query flag

### 6.1 What counts as heavy — stricter than the console's rule

**`plan.OverThreshold` only.** Not `isFlaggedPlan`'s `overThreshold || any warn issue`.

The console's strip is advisory and free to be chatty: it appears, the query runs anyway, the user
reads it or does not. This gate blocks an AI client and interrupts a human with a modal. Those
earn different bars:

- SQLite reports no row estimate at all, so `overThreshold` is permanently false there, while every
  `SCAN` pushes a `warn` (§1.4). Under the console's rule, auto-force-explain on a SQLite
  connection would raise a modal for most queries against a file that may hold forty rows.
- The same holds more mildly for `unused-index` and `filesort` on MySQL/MariaDB: real advice, not a
  reason to stop the world.
- A gate that fires on the harmless case trains the user to approve without reading, which costs
  more safety than it buys.

The `warn` issues are not discarded: they travel to the AI client in every `run_query` result's
`plan.issues` (§5.3) and to the human in the dialog whenever one is raised for any reason (§6.3).
They just do not, by themselves, raise one.

Named consequence, for §7's table: on SQLite, and on ClickHouse when `EXPLAIN ESTIMATE` returns no
rows, the heavy flag can never fire, because neither produces the row estimate the threshold
compares against. Auto-force-explain still runs and still returns the plan; it simply has nothing to
stop.

Declined: a second, cost-based threshold. P18's own OQ-7 records why (`P18-sql-language-server-explain.md:1444`-`1447`):
MySQL's and MariaDB's identically-named `cost` differ by three orders of magnitude for a comparable
scan, so a single cost number is not comparable across the dialects one threshold would have to
serve. The row threshold is the one figure that means the same thing everywhere.

### 6.2 Reuse M2's broker and dialog — and nothing new

**Decision: the same `ApprovalBroker`, the same `DbMcpApprovalDialog.vue`, one more reason to
raise it.** M2 §11's seam table already committed to this shape, and this plan confirms it after
working through what "flagged back to the human" has to mean operationally.

P18 anticipated this phase by name. Its own OQ-5
(`P18-sql-language-server-explain.md:1436`-`1438`) is *"Auto-explain that blocks — 'This query is
estimated to read 40 M rows. Run anyway?' is a real product option and a real annoyance; D19 rule 5
chose warn-and-run. If it is ever wanted, the threshold leaf is already the trigger."* M3 is that
option, taken on the MCP path only: the threshold leaf is indeed the trigger (§3.3), and the
annoyance P18 weighed is why the console keeps warn-and-run untouched (§3.1) and why the bar here
is stricter than the strip's (§6.1).

Operationally it means: **the query pauses, and does not run until a human answers.** The
alternatives fail SPEC's own wording —

- *Warn after the fact, in the result.* The warning then reaches the AI client and nobody else,
  which is precisely the "silently to the AI" SPEC rules out.
- *A non-blocking toast to the human while the query runs.* The human sees it after the 40-million-row
  read has started. A notification that cannot change the outcome is not a flag.
- *A second, heavy-specific dialog.* Two dialogs that can both be open, two queues, two countdowns,
  two keyboard postures — for one question ("should this run?") that already has a surface.

The broker itself needs no logic change: no queue change, no timeout change, no new resolution path.
`approval_test.go` is untouched.

`approval.go` grows two request fields and their types:

```go
// ApprovalReason is why this request was raised — M2's permission gate, or M3's heavy-plan flag.
// Both are the same question ("should this run?") asked for different reasons, so they share one
// queue and one dialog rather than competing for the user's attention.
type ApprovalReason string

const (
	ApprovalReasonPermission ApprovalReason = "permission"
	ApprovalReasonHeavy      ApprovalReason = "heavy"
)

// ApprovalPlan is the plan evidence the dialog shows — never the whole tree.
type ApprovalPlan struct {
	EstimatedRowsRead *float64
	ThresholdRows     int
	OverThreshold     bool
	Issues            []ApprovalPlanIssue // warn first, capped
	IssuesOmitted     int
}
```

`ApprovalRequest` gains `Reason ApprovalReason` and `Plan *ApprovalPlan`. Issues are capped at 10 on
the wire with `IssuesOmitted` carrying the remainder — a rolled-up plan can carry many, the dialog
renders them, and an uncapped list is the same unbounded-render hazard `capApprovalStatement`
(`bridge/dbmcp.go:269`) already guards for the statement text.

When both apply — `verdict == "prompt"` **and** heavy — one request is raised with
`Reason: ApprovalReasonPermission` and `Plan` set: the permission gate is the stricter reason
(the user said "ask me about every write"), and the plan evidence rides along.

### 6.3 Dialog changes

`DbMcpApprovalDialog.vue` gains, on the existing dialog:

- Title by reason: `"Approve this query?"` for `permission` (unchanged), `"Run this heavy query?"`
  for `heavy`.
- Lede by reason: for `heavy`, *"`<name>` (`<kind>`) wants to run a query estimated to read
  N rows — over your threshold of M."* with `toLocaleString()` on both numbers, the same formatting
  `pushWideScanIssue` uses.
- A plan block, rendered whenever `pending.plan` is non-null regardless of reason: the estimate and
  threshold, then each issue as one line with its severity, then `"+N more"` when `issuesOmitted`.
  Testids `db-mcp-approval-plan`, `db-mcp-approval-plan-rows`, `db-mcp-approval-plan-issue`.

Unchanged and deliberately so: Deny focused on mount, Escape denies, the 120 s countdown, the
"1 of N waiting" line, the statement `<pre>`, both button testids. A heavy query and a write are the
same keyboard interaction.

Deliberately **not** in M3, carried forward as seams rather than half-built: an OS notification or
window-raise for a pending approval (M2 §5.4 named it first; `main.go:445`-`510`'s pairing path is
the precedent), and any "don't ask me again for this statement" affordance — a fourth permission
behaviour wearing a button, which belongs in the mode vocabulary or nowhere.

## 7. Per-adapter-kind support

`explainStatementsFor`'s own switch is the authority, and it is a kind switch by design — P18 D11
(`P18-sql-language-server-explain.md:904`-`920`) names the exception: no capability flag can express
"which SQL grammar is this", so dialect selection is a kind decision. `queryplan.Supported(kind)` is
`len(StatementsFor(kind, "x")) > 0`, one function, no second list.

| Kind | `Caps().SQL` | `explain_query` | auto-force-explain | Heavy flag can fire |
|---|---|---|---|---|
| postgres | yes | yes | yes | yes |
| mysql | yes | yes | yes | yes |
| mariadb | yes | yes | yes | yes |
| sqlite | yes | yes | yes | **no** — the dialect reports no row estimate (§6.1) |
| clickhouse | yes | yes | yes | only when `EXPLAIN ESTIMATE` returns rows |
| mongodb | yes | **no** | no-op | no |
| redis | yes | **no** | no-op | no |
| kafka, s3, sqs | no | **no** (unreachable — `run_query` cannot reach them either) | no-op | no |

**Degradation.** `explain_query` against an unsupported kind returns an `errResult` naming the kind
and saying this app has no EXPLAIN it can parse for it — the same posture M1 §4.3 took for
`describe_table` on redis/kafka/s3/sqs. auto-force-explain on such a connection is a **silent
no-op**: the setting persists, it simply does nothing, and the ConnectionDialog control is disabled
with a note for those kinds (§9.1) so the state is visible where it is set rather than discovered.

**Mongo, checked rather than assumed.** MongoDB does have its own explain concept —
`db.c.find().explain()`, `aggregate(..., {explain: true})`, the `explain` database command. It is
not reachable through this app: `model.MongoConsoleMethods` (`storage/model/console.go:16`-`27`) is
ten methods with no `explain` among them, and `mongo/console.go:84`'s `parseStatement` rejects both
an unsupported method and any trailing content after the closing paren (M2 §1.2). Supporting it
would mean extending the Mongo console grammar — a human-facing change to the console this chapter
has otherwise left alone — plus a sixth dialect parser over a genuinely different output shape and
a sixth `Plan.Kind`. **Out of scope for M3 entirely**, per `CLAUDE.md`'s "scope left out of a phase
stays out entirely", and recorded in §12's seam table so a later phase does not rediscover the
reasoning.

Redis, Kafka, S3 and SQS have no query planner at all. Nothing to degrade to.

## 8. EXPLAIN versus M2's permission gate

SPEC asks whether EXPLAIN-ing a `DELETE` should bypass the write/DDL gate, since EXPLAIN does not
execute the statement. The answer has three parts.

### 8.1 The question does not arise, because non-SELECT targets are refused

`explain_query` accepts only what `queryplan.Explainable` accepts — a leading `SELECT` or `WITH`
after comment stripping, `isExplainable`'s exact rule, ported and not re-decided.

That is a reuse, not a new restriction. P18 D12 (`:921`-`932`) set it for the console; P18's own
OQ-4 (`:1434`-`1435`) records that DML explains are safe without `ANALYZE` on
Postgres/MySQL/MariaDB/**SQLite** — four of the five, with ClickHouse the one it does not clear.
`explain_query` must not be the place that discovers a dialect where an EXPLAIN spelling executes
its target, so the rule that already covers four dialects and refuses the fifth is the right one to
inherit.

The permission argument points the same way. If DML-explain were allowed and gated as a read, a
client whose write mode is `deny` could still use `explain_query` as an oracle on write statements —
whether they parse, which tables and indexes they would touch, how many rows they would match. Small,
but it is capability the user's `deny` said no to.

### 8.2 The EXPLAIN itself is gated as a read, through M2's existing classifier

`explain_query` classifies the **composed** statement (`EXPLAIN (FORMAT JSON, …) SELECT …`), not the
target, through the `Query.ClassifyStatement` seam M2 built. `ClassifySQL`'s existing `EXPLAIN`
branch (`adapters/classify.go`, read via `read_symbol`) returns `ClassRead` unless the next word is
`ANALYZE`. So `explain_query` needs **no permission vocabulary of its own** — M2 §11's seam table
predicted exactly this, and it holds.

Consequences, each intended: a connection with `mcpReadMode: deny` refuses `explain_query`; one with
`prompt` prompts for it, showing the composed EXPLAIN text; one with `allow` runs it. An AI client
touching the database is an AI client touching the database, whatever it asks for.

### 8.3 The defense in depth that makes it sound

The whole argument rests on one property: this app never composes an EXPLAIN that executes its
target. That property lives in one function today (`explain.ts:24`-`48`, ported to
`queryplan.StatementsFor`) and is defended by a comment.

M3 makes it checkable. Before executing a composed EXPLAIN batch — in `explain_query` and in
auto-force-explain alike — each composed statement is passed through `Query.ClassifyStatement` and
must report `ClassRead`; anything else refuses the call as an internal error and logs it. Cost: one
extra classification per composed statement, which for the five SQL kinds is a pure text scan with
no server round trip. Benefit: if a future dialect's EXPLAIN spelling ever classifies as anything
but a read, it cannot reach the server through this path — the failure mode it guards against is
silently executing a statement the user's own permissions denied, which is the exact class M2 built
the gate for.

## 9. Frontend

### 9.1 `ConnectionDialog.vue`'s MCP tab

One new control, between the description textarea (`:786`) and the three `SegmentedControl` rows
(`:806`):

- `Checkbox` bound to `draft.mcpAutoExplain`, testid `connection-mcp-auto-explain`, labelled
  "Plan queries before running them".
- Helper text: an EXPLAIN runs before every SELECT this connection's MCP clients send, and a plan
  estimated to read more than the expensive-query threshold pauses the query until you approve it.
- `:disabled="!draft.mcpEnabled || !mcpExplainSupported"`, where `mcpExplainSupported` is a
  `computed` over `draft.kind` against the five supported kinds — the same list `explain.ts`'s
  switch already carries, spelled once in a frontend constant beside it rather than copied into the
  dialog.
- When the kind is unsupported, one line of helper text saying this engine has no query plan this
  app can read, so the setting has no effect. Disabled and explained, never hidden — the M2 pane's
  own posture (§7.2 there).

`TAB_FOR_FIELD` needs no entry: a bool has no validation error to route to.

### 9.2 `SettingsDialog.vue`'s glance row

The existing per-connection line (`:1211`-`1213`) becomes
`read allow · write prompt · DDL deny · plans queries` — the last segment present only when
`conn.mcpAutoExplain`, so the row does not grow for a connection that has it off.

The `muted-note` above the list (`:1193`-`1196`) gains one sentence: newly exposed connections plan
their queries before running them, and a plan over the expensive-query threshold pauses for
approval. That is where the §3.2 default's user-visible consequence gets stated.

### 9.3 Wire and state

- `packages/shared/domain/dbmcp.ts`: `dbMcpApprovalPlanSchema` (`estimatedRowsRead:
  z.number().nullable()`, `thresholdRows`, `overThreshold`, `issues` array of
  `{severity, code, message}`, `issuesOmitted`), and `dbMcpApprovalSchema` gains
  `reason: z.enum(['permission','heavy'])` and `plan: dbMcpApprovalPlanSchema.nullable()`.
- `packages/shared/domain/connection.ts`: `mcpAutoExplain: z.boolean().default(true)`.
- `bridge/dbmcp.go`: `DbMcpApprovalRequest` gains `Reason string` and `Plan *DbMcpApprovalPlan`;
  `toWireApprovalSnapshot` projects both, capping issues at 10.
- `bridge/dbmcp.go`: the `dbmcp.Config` literal (`:119`) gains `ExplainThreshold`.
- `state/dbmcp.ts`: nothing beyond what the widened schema already carries — the approval state is
  already `pending`/`queued` and parses through the schema.
- `frontend/bindings/` is gitignored and regenerated by the Wails build.

### 9.4 Fixture sweep — called out because this is the third time

`grep -rln mcpReadMode --include=*.ts --include=*.vue apps/kira-studio packages` reports 24
non-generated files today (`tests/ui/*.spec.ts`, `tests/ui/support/*Fixture.ts`,
`packages/db-fixtures/support/*`). `mcpAutoExplain: z.boolean().default(true)` makes the key
required in the inferred **output** type, so every literal that builds a `ConnectionSummary` or
`ConnectionInput` needs it.

Do the sweep by grep, all at once — not by fixing whatever `bun run typecheck` names first. M1ab
lost a pass to exactly this (SPEC's own M1ab result section), and M2 §8 wrote the warning down; this
is its third occurrence.

## 10. Tests

`CLAUDE.md`'s default is no dedicated unit test. **One** clears the bar. Everything else is named
and declined.

**`internal/queryplan/parse_test.go` — the five-dialect plan port, against §2.4's shared fixtures.**
Five dialects × several node shapes × the structural issue rules is the decision structure
`CLAUDE.md` names outright, and the existing TypeScript spec's own header already made that case
("the five EXPLAIN plan normalizers + D15's issue rules earn a unit test"). Two things make the Go
test earn its keep beyond restating that:

- It is a **second implementation in a second language** of rules stated once. That is precisely
  where drift is invisible: both sides keep passing their own tests while producing different plans
  for the same server output. Reading the same `expected.json` is what makes a divergence fail.
- It pins `explain_query`'s wire contract, since the tool returns exactly this JSON.

Table-driven over the fixture directory; the truncated-cell cases assert `ErrTruncated` by identity,
not by message. `page.IsTruncated` is exercised there rather than tested on its own.

`tests/unit/explain-plan.spec.ts` gains the matching parity block (§2.4) and loses its inline
fixture strings to the shared files. Its per-rule assertions are not rewritten.

Declined, explicitly:

- **`overThreshold` and the heavy decision** (`plan != nil && plan.OverThreshold`) — a one-condition
  comparison against a number. A test would restate the line. The fixtures already pin
  `overThreshold` per dialect, which is the part with any rule in it.
- **`queryplan.Explainable` / `StatementsFor`** — a regex and a five-arm switch, both ported
  verbatim from code with existing TypeScript coverage, and both exercised by every fixture case.
- **`ApprovalBroker`** — unchanged logic (§6.2). `approval_test.go` stays exactly as M2 wrote it.
- **The migration, the column, the repo scan, the zod field, `defaultDraft`** — CRUD round-trips
  and required-field guards, `CLAUDE.md`'s named exclusions.
- **`explain_query`'s handler and `runQuery`'s new steps** — sequences of guards over seams that are
  themselves tested; a test would be a mock-shaped restatement of the order table in §4.3/§5.2.
- **The Vue dialog and dialog copy** — template work.
- **No adapter conformance change.** M3 adds no `Adapter` method, changes no adapter behaviour, and
  introduces no new capability: `adapters/*/*_test.go`'s per-capability contract is untouched, and
  the P25/P26 real-container suites gain nothing — every statement this phase composes runs through
  the same `Execute` path those suites already drive.
- **`tests/e2e-real/`** — unchanged. The EXPLAIN spellings are already exercised against real
  servers by `tests/ui/console-explain.spec.ts` and the P18 captures the fixtures come from.

Fast checks per commit: `go build ./...`, `go vet ./...`, `go test ./...`, `bun run typecheck`,
`bun run lint`. Once, near the end: `bun run build` and the full `tests/ui/` Playwright suite —
where a missed fixture field shows up (§9.4).

**One UI spec is worth extending, not writing fresh**: `tests/ui/connection-dialog-tabs.spec.ts`
already asserts which controls live on which tab; add `connection-mcp-auto-explain` to its existing
MCP-tab assertions. An edit to a spec whose whole subject is the tab strip, not a new test.

## 11. Order and sizing

### 11.1 Implementation order

Go first and green before any `.vue` file is touched — M1's and M2's ordering discipline.

1. `page.IsTruncated` (§2.3). `go build ./...` green.
2. Fixture extraction: move `tests/unit/explain-plan.spec.ts`'s inline fixtures to
   `tests/fixtures/explain-plans/`, add its parity block, generate each `expected.json` from the
   **TypeScript** parser (it is the reference implementation; the Go port is what gets pinned to
   it). `bun test` green before a line of Go is written.
3. `internal/queryplan`: model, issues, statements, the five parsers, `FromPages`, `parse_test.go`
   against the same fixtures. `go test ./internal/queryplan/...` green.
4. `dbmcp`: `Config.ExplainThreshold` + required check; `explain.go`'s `planFor`/`planSummary`;
   `explain_query` handler and its `AddTool`; the instructions sentence.
5. `render.go`: `planEnvelope`, `renderPage`'s third parameter, `render_test.go`'s five call sites.
6. Migration `0022` + `embed.go` + `ConnectionFields.McpAutoExplain` + `repos/connections.go` +
   `destinationUnchanged`'s doc sentence.
7. `runQuery`'s reordered gate (§5.2), including the `deny`-before-EXPLAIN move.
8. `approval.go`'s `Reason`/`Plan` fields; `bridge/dbmcp.go`'s wire projection and the
   `ExplainThreshold` closure; `main.go` if the service construction needs it.
9. Frontend: zod schemas, `state/connections.ts`, `DbMcpApprovalDialog.vue`, `ConnectionDialog.vue`,
   `SettingsDialog.vue`.
10. The fixture sweep (§9.4) and the `connection-dialog-tabs.spec.ts` extension.
11. Full `go test ./...`, `bun run typecheck`, `bun run lint`, `bun run build`, then the whole
    `tests/ui/` suite.

Commits per numbered step, Conventional Commits: `feat(queryplan):`, `feat(dbmcp):`,
`feat(connections):`, `test(queryplan):`.

Step 2 before step 3 is load-bearing: generating the expected outputs from the Go port would pin the
port to itself.

### 11.2 One pass, two named fallback seams

One Sonnet pass. Steps 3-7 are one continuous thread — the `Plan` shape set in step 3 is
`explain_query`'s wire contract, `planFor`'s return type and the approval dialog's evidence, and a
second subagent would start cold and re-derive all of it.

Size, honestly: 11 new Go files plus a fixture directory, ~25 edits. Larger than M2. The port itself
(~900 lines of Go from ~750 lines of TypeScript) is mechanical but not small.

**Primary fallback seam — after step 8.** The Go side is then complete and testable over curl per
`CLAUDE.md`'s headless technique: `explain_query` answers, `run_query` plans and blocks, and
`PendingApprovals`/`ApproveQuery` are reachable. Only the renderer remains.

**Earlier seam, if the port itself runs long — after step 5.** `explain_query` is then shipped
whole and useful on its own (deliverable 1 of 3), with auto-force-explain and the heavy flag
(steps 6-9) as the second piece. Both halves are coherent; a reader of the commit log sees a tool
land, then a gate land.

Do not split anywhere else. In particular never between steps 6 and 7, which would leave a column
that persists and does nothing, and never between 7 and 8, which would leave a heavy flag that
blocks with a dialog that cannot say why.

## 12. Out of scope, and the seams later phases plug into

Out, stated so it stays out entirely rather than half-built:

- **Mongo explain** (§7). The grammar change, the sixth parser and the sixth `Plan.Kind` are one
  coherent piece of work or none.
- **`EXPLAIN ANALYZE`-grade plans.** P18's own OQ-6 (`:1439`-`1443`) already framed it: actual rows,
  real timings and buffer counts come from *executing the statement*, which is a different feature
  with a different consent model. This phase composes no `ANALYZE` anywhere and §8.3 makes that
  checkable.
- **A cost-based threshold** beside the row threshold (§6.1, P18 OQ-7 at `:1444`).
- **LIMIT injection** into a heavy statement. It is a SQL rewrite, i.e. the parser `CLAUDE.md`
  forbids hand-rolling; the heavy flag stops the query instead of silently changing it, which is
  also the honest behaviour — a model told "here are your rows" must not have been given different
  rows than it asked for.
- **Any change to the human console path.** `views/console/state.ts`, `explain.ts`, `plan.ts`,
  `planParsers/*` and `AutoExplain` behave exactly as they do today (§3.1). The only edit under
  `tests/unit/` is the fixture extraction, which changes no assertion.
- **A "don't ask again" affordance** and an **OS notification** for a pending approval (§6.3).

Seams:

| Later phase | Seam |
|---|---|
| M4 Faker | A seventh `AddTool`, unchanged from M1 §9. If M4's Go→JS bridge turns out cheap and general, `internal/queryplan` is the obvious second consumer to re-evaluate — but only as a deliberate consolidation with the parity fixtures kept, never as a silent swap |
| M5 anonymization | Still `renderPage`'s single entry point, now taking a plan summary alongside the page (§5.3). A plan carries relation and column names in `label`/`detail`/`raw`, so M5's own planning pass must decide whether the plan is filtered too — named here because it is easy to miss |
| A later Mongo explain phase | `model.MongoConsoleMethods` + `mongo/console.go`'s `parseStatement` is the grammar gate; `queryplan.Supported`/`StatementsFor` is the one switch to extend; `Plan.Kind` is already a plain string |
| A later notification phase | `main.go:445`-`510`'s pairing notification path, driven by the same approval snapshot subscription M2 wired |

## 13. Dogfooding note

The repo-map MCP server was used throughout this planning pass, started per `CLAUDE.md`'s headless
steps (`bun run mcp:repo-map:build`, `bun run mcp:repo-map`) and called over curl — the native tool
surface does not appear in an agent-harness session, as that section documents.

It did real work: `read_symbol` on `ClassifySQL` returned the whole function and its doc comment —
the evidence §1.5/§8.2 rest on — without opening `adapters/classify.go`; `find_references` on
`renderPage` found all six call sites (five of them the `render_test.go` edits §11.1 step 5 needs)
in one call; `find_references` on `parseExplainPages` returned all three TypeScript call sites
including the one in `tests/unit/explain-truncated.spec.ts`, which is how §2.4's truncated-case
requirement was found; `outline_file` on `page/chunk.go` gave the four accessors and the `Chunk`
fields that established §2.3's missing `IsTruncated`; `search_files` on "explain" enumerated all
eleven explain-related files including six `tests/unit/` specs no grep in this pass had reached.

Five observations, for the log keeper to fold into `docs/v1.7/mcp-repo-map-issues.md`:

1. **M1c's fix confirmed live, on a field it was not fixed against.**
   `find_references{"symbol":"McpDdlMode"}` returns 13 exact references with lines across
   `repos/connections.go`, `model/connection.go` and `dbmcp/permissions.go` — the exact query shape
   that returned "no references found" during M2's planning pass. Recorded as closure evidence for
   the M1c entry, not as a new finding.
2. **Trivial, argument-name inconsistency — same class as M2's observation #2, different tool.**
   `outline_file` takes `file`, not `path`; calling it with `path` fails with
   `validating "arguments": unexpected additional properties ["path"]`. `find_references` and
   `search_symbols` take `symbol`/`query`, `search_files` takes `query`, `outline_file` takes
   `file`. Reading `tools/list`'s real `inputSchema` first remains the only reliable move.
3. **Trivial, worth writing down once.** `find_implementations` still rejects `limit` while
   `find_references`, `search_symbols` and `search_files` accept it — reconfirmed from `tools/list`
   this pass, unchanged since M2 logged it.
4. **Not a defect, but a per-session cost worth stating.** A restart within the 7-day window prints
   "Using this repository's existing token, valid until …" and no command — correct by M1's design
   (a hash cannot be reversed), but a fresh planning session holds no plaintext and therefore cannot
   call the server at all. The only route is `CLAUDE.md`'s own documented one: delete
   `mcp-repo-map-*-token.json` and restart to mint a fresh token, which invalidates whatever client
   was registered before. That happened again this pass. Worth a sentence in the log so the next
   session budgets for it rather than debugging a 401.
5. **Reconfirms v1.7's existing `pkill` entry, one degree further.** Killing by PID from `pgrep -af`
   is the documented workaround, and it works — but `pgrep -af`'s own output includes the invoking
   shell's command line, because the pattern appears in it. The PID to kill is the `bun run
   scripts/mcp-repo-map.ts` row, not the `/bin/bash -c … pgrep …` row directly beneath it. Read the
   output, never pipe it into `kill`.
