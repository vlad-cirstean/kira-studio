# M2 — Connection editor: MCP tab, per-operation permissions (read/write/DDL), deny/allow/prompt

`docs/v1.7/SPEC.md`'s M2 row, turned into concrete steps. Everything below was read in the current
tree (`v1.7` at `29238e84`, M1ab landed and rebased twice); line numbers are from that tree, not
from M1's plan doc, which predates two fix passes and a renumbered migration.

Three deliverables, one phase:

1. A fourth tab in `ConnectionDialog.vue`: description text, plus read/write/DDL each set to
   deny, allow or prompt.
2. Storage for those four fields, and their exposure to an MCP client through `list_connections`.
3. Enforcement in `dbmcp`'s `run_query`: classify the statement, look up its mode, run it, refuse
   it, or block on a human approval.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| How statement classification generalises past SQL | An optional adapter-side interface, `adapters.StatementClassifier`, implemented by the six adapter packages that can run a console statement; one shared `adapters.ClassifySQL` helper serves the five SQL kinds, Mongo reuses its own `isWriteStatement`, Redis its own `COMMAND`-table check. No kind switch anywhere | §3 |
| Whether that needs a SQL parser | No. Leading-keyword classification over comment-stripped text, plus one embedded-semicolon guard. A library is declined with a stated reason | §3.2 |
| The approval UI | A modal dialog, always mounted at `App.vue`'s root, fed by a FIFO broker whose shape is `gitsock.Broker`'s (G1's pairing prompt), settled from any window | §5 |
| Where `run_query` blocks | Between `connectForQuery` and `Query.Execute`, on `ApprovalBroker.Request`, which selects on the decision, the request's own 120s deadline, and the MCP request's `ctx` | §4.3, §5.2 |
| Timeout / app-close with a pending approval | 120s deadline per request (the app's two existing prompt-broker constants); `AbandonAll` on server stop and app quit resolves every pending request as abandoned, so no handler ever hangs | §5.3 |
| Whether Settings gains an overview list (SPEC's rebase note) | It already has one — M1 shipped "Exposed connections" in the Database MCP section. Keep it, add a read-only per-row glance of the three modes. No second editor | §7.3 |
| Where `list_connections` gains the description (M1 §9's named seam) | `connectionView` in `internal/dbmcp/render.go:70`-`78`, plus a `permissions` object beside it | §6.1 |
| Migration number | `0021_m2_connection_permissions.sql` — 0020 is the highest on disk today | §2.1 |
| Defaults for existing rows | read allow, write prompt, DDL deny. A deliberate tightening of what M1 shipped | §2.2 |
| Tests | Two, both named and justified: the SQL classifier and the approval broker. Nothing else | §9 |
| One Sonnet pass or a split | One, with a named fallback seam after step 6 | §10.2 |

## 1. Confirmed current state

### 1.1 `run_query` as M1 actually shipped it

`internal/dbmcp/tools.go:124`-`162`, in order: `resolveEnabled` (the per-connection exposure gate),
clamp `maxRows` to 1-2000, `connectForQuery`, refuse when the resulting state is not `connected`,
build `adapterhost.ExecuteRequestWire{OpID, ConnectionID, Path, Statements: []string{sql}}`, call
`s.cfg.Query.Execute`, render page 0.

`access.go:15`-`30`'s `resolveEnabled` scans `Conns.List()` and returns the
`model.ConnectionSummary` — so the permission fields arrive in the same call that already gates
exposure, with no extra lookup. `access.go:53`-`58`'s `connectForQuery` returns the existing state
when already connected (the M1ab arm-A fix, `8e2542d9`) and otherwise calls `Conns.Connect`.

`Query` is `dbmcp.QueryRunner` (`server.go:61`-`63`), satisfied by `*adapterhost.Router`;
`Router.Execute` (`adapterhost/router.go:286`-`288`) forwards to `Dispatcher.Execute`
(`adapterhost/data.go:199`-`226`), which resolves the live adapter, decodes the path and runs
`adapter.Execute` inside `host.RunOp` (op id, throttle, `op:start`/`op:end`, panic recovery).

### 1.2 What already classifies a statement, per kind

Every mechanism M2 needs exists; none is reachable from `dbmcp` today.

| Kind(s) | Existing mechanism | File:line |
|---|---|---|
| postgres | `AssertNoTransactionEscalation` backstop, then `BEGIN READ ONLY` for a read-only connection | `adapters/postgres/console.go:163`-`186` |
| mysql, mariadb | same backstop, same wrap | `adapters/mysqlfamily/console.go:146`-`160` |
| all SQL kinds | `stripSQLComments` (rune scan, nested block comments), `endsTransaction`, `StripOneTrailingSemicolon` | `adapters/errors.go:133`, `:102`; `adapters/sqltext.go:227` |
| mongodb | `writeConsoleMethods` + `isAggregateWrite` (`$out`/`$merge`) behind `isWriteStatement`, called per statement before dispatch | `adapters/mongo/console.go:39`-`82`, `:459` |
| redis | `isReadOnlyCommand` asks the server's own `COMMAND` table, caches it per connection set, fails closed on an unknown command or an unreachable table | `adapters/redis/client.go:265`-`278`, used at `redis/console.go:132` |

Two properties this phase depends on:

- **Mongo's grammar admits no schema statement.** `model.MongoConsoleMethods`
  (`storage/model/console.go:16`-`27`) is ten methods: find, findOne, insertOne, insertMany,
  updateOne, updateMany, deleteOne, deleteMany, countDocuments, aggregate. `parseStatement`
  (`mongo/console.go:84`) rejects an unsupported method and rejects trailing content after the
  closing paren, so nothing can be smuggled behind a first statement. DDL is unreachable on Mongo.
- **Redis has no DDL either**, and one `run_query` call is one command: `execute`
  (`redis/console.go:102`-`139`) tokenizes the whole statement with `tokenize`, which treats a
  newline as ordinary whitespace, so extra lines become arguments, never a second command.

The frontend's own precedent for cheap classification is `views/console/explain.ts:8`-`15`:
`isExplainable` strips leading comments with a regex and tests the first keyword against
`^(SELECT|WITH)`. Auto-explain has gated every console SELECT on exactly that since P18.

### 1.3 The connection record

`model.ConnectionFields` (`storage/model/connection.go:7`-`31`) carries `AutoExplain`,
`ThrottlePerSec` and M1's `McpEnabled`. `ConnectionSummary` embeds it (`:36`-`42`), so every field
inlines into the JSON the renderer and `dbmcp` both read.

- Migration precedent: `0004_p18_auto_explain.sql` and `0020_m1_connection_mcp.sql` are each one
  `ALTER TABLE connections ADD COLUMN ... NOT NULL DEFAULT`, no rebuild-and-swap; both state in
  their own comments why a first-class column beats an `options_json` key (`options` round-trips
  through the connection URI and the Copy URI menu item).
- Highest migration on disk: `0020_m1_connection_mcp.sql`; `migrations/embed.go:26`-`51` ends at
  `{20, "m1_connection_mcp", …}`. **Next number is 0021.**
- Repo surface: `connectionSelectColumns` (`storage/repos/connections.go:12`-`16`) and
  `scanConnectionRow` (`:30`-`45`) are one shared column list and one shared scan; `Insert`,
  `Update`, `InsertWithSecret`, `InsertDuplicateWithSecret`, `UpdateWithSecret` each bind their own
  value list.
- Validation: `connections.Input.Validate` (`connections/input.go:41`-`70`) is where every
  field constraint is enforced server-side, mirroring the zod schema; enum fields go through
  `model.Valid*` helpers (`model/connection.go:76`-`86`).
- Renderer: `connectionFieldsSchema` (`packages/shared/domain/connection.ts:106`-`118`) —
  `mcpEnabled: z.boolean().default(false)` is the shape to copy; `defaultDraft()`
  (`state/connections.ts:71`-`91`) lists every key; `openEditDialog` spreads a summary into the
  draft (`:112`-`125`), so a new field round-trips with no dialog change beyond its own control.
- `patchConnectionFields` (`state/connections.ts:194`-`211`) is the read-modify-write helper the
  Settings checkbox uses via `setConnectionMcpEnabled` (`:232`-`234`).

### 1.4 `ConnectionDialog.vue`'s tab strip

`DetailTab = 'General' | 'Advanced' | 'Pre-connect'` (`:89`), `activeTab` reset to General whenever
step 2 is re-entered (`:90`-`93`), `TAB_FOR_FIELD` maps a failed field to the tab that holds it
(`:281`-`288`, read by `onSave` at `:304`), the strip itself is three `<button class="p-tab">` in
`<nav class="p-tab-strip">` (`:473`-`507`), and each pane is a `<div class="tab-pane"
role="tabpanel">` (`:509`, `:671`, `:713`). The Advanced pane's read-only checkbox (`:672`-`676`)
and auto-explain checkbox (`:678`-`688`) are the control precedents for this phase's new pane.

`SegmentedControl.vue` (`theme/primitives/`) is a generic three-state control taking
`{value,label,title?,testid?}[]` — the right primitive for deny/allow/prompt, already used
elsewhere in the app.

### 1.5 The Database MCP settings section

`SettingsDialog.vue:1110`-`1200`, reached from the `sections` array (`:123`-`124`). It already
renders, after the enable toggle and the registration command: a `<div class="sec-label">Exposed
connections</div>`, then one `Checkbox` per `connectionsState.records` entry writing through
`setConnectionMcpEnabled` (`:1180`-`1199`). The Code intelligence section's own "Repository access"
list (P67d, `:1066`-`1106`) is the richer sibling — name, path, per-row status line, checkbox.

**So the per-entity access list SPEC's rebase note asks about already exists for connections.** §7.3
decides what it gains, not whether to build it.

### 1.6 The two existing "Go blocks until a human answers" surfaces

| Surface | Broker | Renderer |
|---|---|---|
| Git pairing (G1) | `gitsock.Broker` (`internal/gitsock/pairing.go`): FIFO `queue`, `byID` map, per-entry buffered result channel, `notify.Emitter[PairingSnapshot]`, 120s deadline (`:14`), 200-entry cap (`:26`), `Request` blocks on the channel (`:120`-`160`), `Approve`/`Deny` resolve by id (`:168`+), `ExpireOverdue` reaps | `GitPairingDialog.vue`, always mounted at `App.vue:94`, Deny focused on mount, live countdown, "1 of N waiting"; `state/gitClients.ts:53` subscribes to `kira:git:pairing` |
| Git askpass (P67e) | `gitaskpass.Broker` (`internal/gitaskpass/broker.go:22`): 120s `DefaultTimeout`, per-op prompter registration | `GitCredentialDialog.vue` + `state/gitCredential.ts`'s FIFO, `App.vue:95` |

Both settle from whichever window answers first and treat an already-resolved id as a no-op, never
an error. Event plumbing: a channel constant in `bridge/events.go:13`-`58`, a one-method producer
interface in `Sources` (`:68`-`84`), one subscribe-and-emit line in `Attach` (`:99`-`131`), a bound
method per action, a `CHANNEL`/`IPC` entry in `bridge/index.ts` and
`tests/ui/support/ipcChannels.ts`.

`notify.Emitter[T]` (`internal/notify`) documents the rule this phase must honour: never hold a
service mutex across `Emit`.

## 2. Storage

### 2.1 Migration `0021_m2_connection_permissions.sql`

```sql
-- M2: per-connection MCP metadata and per-operation permissions. Four plain columns with non-NULL
-- defaults, the 0004/0020 precedent — first-class rather than options_json keys for the same
-- reason those two give: `options` round-trips through the connection URI and the Copy URI menu
-- item, and a permission grant must not be settable, or clearable, by pasting a URI.
-- Defaults tighten what M1 shipped: an exposed connection could already be written to over MCP
-- (M1 §9's own stated honest state of it); after this migration a write prompts and DDL is
-- refused, on every existing row and every new one.
ALTER TABLE connections ADD COLUMN mcp_description TEXT NOT NULL DEFAULT '';
ALTER TABLE connections ADD COLUMN mcp_read_mode TEXT NOT NULL DEFAULT 'allow';
ALTER TABLE connections ADD COLUMN mcp_write_mode TEXT NOT NULL DEFAULT 'prompt';
ALTER TABLE connections ADD COLUMN mcp_ddl_mode TEXT NOT NULL DEFAULT 'deny';
```

plus `{21, "m2_connection_permissions", "0021_m2_connection_permissions.sql"}` in
`migrations/embed.go`'s `names`.

TEXT, not INTEGER: `mode` and `color` are already stored as their own words
(`connectionSelectColumns`), and a mode read straight out of the DB in a log line or a `sqlite3`
session must say `prompt`, not `2`.

### 2.2 Model, validation, schema

- `model.ConnectionFields` gains:

```go
// M2: free-text "what this DB is for", passed to an AI client as connection metadata
// (list_connections). Never interpreted by this app.
McpDescription string `json:"mcpDescription"`
// M2: per-operation MCP permission, one of deny/allow/prompt. Enforced only on the DB MCP
// server's run_query path — the human console is governed by ReadOnly, unchanged.
McpReadMode  string `json:"mcpReadMode"`
McpWriteMode string `json:"mcpWriteMode"`
McpDdlMode   string `json:"mcpDdlMode"`
```

- `model.ValidMcpPermissionMode(v string) bool` beside `ValidConnectionMode`
  (`model/connection.go:86`), over a package-level map of the three words.
- `connections.Input.Validate` gains: each of the three modes must satisfy
  `ValidMcpPermissionMode` (`ipcerr.BadRequest("invalid MCP permission mode")`), and
  `len(McpDescription) <= 1000` (`ipcerr.BadRequest("mcpDescription must be at most 1000
  characters")`). Matching guard in `repos/connections.go`'s `scanConnectionRow`, mirroring the
  existing kind/color/mode row-drop checks at `:48`-`58` — except a bad mode **is not** grounds to
  drop the whole row: an unreadable permission word is coerced to `deny` in the scan, with a
  `slog.Warn`. Dropping the row would hide the connection from the app entirely; coercing to the
  strictest value keeps it visible and keeps it safe.
- `connectionSelectColumns` gains the four columns; `scanConnectionRow` gains four scan targets;
  the five write methods bind the four values.
- `packages/shared/domain/connection.ts`:

```ts
export const mcpPermissionModeSchema = z.enum(['deny', 'allow', 'prompt']);
export type McpPermissionMode = z.infer<typeof mcpPermissionModeSchema>;
// in connectionFieldsSchema, beside mcpEnabled — `.default` load-bearing for older stored rows,
// exactly as mcpEnabled's is:
mcpDescription: z.string().max(1000).default(''),
mcpReadMode: mcpPermissionModeSchema.default('allow'),
mcpWriteMode: mcpPermissionModeSchema.default('prompt'),
mcpDdlMode: mcpPermissionModeSchema.default('deny'),
```

- `state/connections.ts`'s `defaultDraft()` gains the same four keys with the same defaults.

### 2.3 Why these defaults

Exposing a connection (M1's `mcp_enabled`) is the human's consent to *this app showing the
connection to an AI client*, not consent to schema changes. Read allow keeps an exposed connection
useful with no second opt-in. Write prompt makes every mutation visible at the moment it happens,
which is the whole point of the mode existing. DDL deny is the one class where an accident is not
recoverable by re-running a statement.

The migration applies these to rows exposed under M1 as well, so the tightening is not opt-in. Say
so in the Settings section's own helper text (§7.3) rather than letting a user discover it when a
previously-working write starts prompting.

## 3. Statement classification

### 3.1 Shape: an optional adapter interface, not a kind switch

`internal/adapters/classify.go`, new:

```go
// OpClass is what one console statement would do, as the connection's MCP permissions name it.
type OpClass string

const (
	ClassRead    OpClass = "read"
	ClassWrite   OpClass = "write"
	ClassDDL     OpClass = "ddl"
	ClassUnknown OpClass = "unknown" // classified by nothing; the caller applies its strictest rule
)

// StatementClassifier is optional adapter surface, deliberately not a method on Adapter: only the
// kinds with a console (Caps().SQL) can answer it at all, and adding a tenth method every adapter
// must stub would be the "hardcoded kind list" Caps exists to prevent, spelled differently.
type StatementClassifier interface {
	ClassifyStatement(ctx context.Context, statement string) (OpClass, error)
}
```

Implementations, six packages, each three to fifteen lines:

| Package | Body |
|---|---|
| `postgres`, `mysqlfamily`, `sqlite`, `clickhouse` | `return adapters.ClassifySQL(statement), nil` |
| `mongo` | `parseStatement`; a parse error returns `ClassUnknown` with the error; else `isWriteStatement(stmt)` picks `ClassWrite`, otherwise `ClassRead`. DDL is unreachable (§1.2) |
| `redis` | `tokenize` the statement; no tokens is `ClassUnknown`; `set.isReadOnlyCommand(ctx, conn, tokens[0])` picks `ClassRead`, else `ClassWrite`. The client comes from `a.requireSet()` plus `set.get(ctx, a.defaultDbIndex)` — the `COMMAND` table is server-wide, so the db index does not matter |

`mysqlfamily.Adapter` serves both mysql and mariadb (`adapters/registry.go`'s per-package `init()`
registration), so four SQL implementations cover five kinds.

kafka, s3 and sqs implement nothing: `Caps().SQL` is false for all three, so `run_query` cannot
reach them, and an adapter that does not implement the interface classifies as `ClassUnknown`
anyway (§4.2's strictest rule).

**Why not classify inside `dbmcp` with a switch on `kind`.** Mongo's write set and Redis's
`COMMAND` lookup already exist, unexported, inside their own packages. A copy in `dbmcp` would be a
second, drifting statement of engine knowledge — the exact thing `adapters/adapter.go`'s package
doc says `Caps` exists to prevent — and Redis's answer needs a live client `dbmcp` has no handle on.

### 3.2 `adapters.ClassifySQL`, and why not a parser

```go
func ClassifySQL(statement string) OpClass
```

Algorithm, in order:

1. `StripSQLComments(statement)` — today's `stripSQLComments` (`errors.go:133`), exported by this
   phase (one internal call site updated). It already handles line comments and nested block
   comments and replaces each with a space, verified against real servers.
2. `StripOneTrailingSemicolon` (`sqltext.go:227`), then trim.
3. **Embedded-semicolon guard.** If a `;` survives anywhere in the remaining text, return
   `ClassUnknown`. A leading keyword says nothing about a second statement smuggled behind it, and
   whether a driver executes it is a per-driver DSN detail (`go-sql-driver`'s `multiStatements`,
   `modernc.org/sqlite`'s multi-statement exec) this classifier must not depend on. A semicolon
   inside a string literal costs a false `ClassUnknown`, which costs a prompt; a missed second
   statement costs a silent write. Only one of those is acceptable.
4. First keyword, upper-cased:
   - `SELECT`: `ClassRead`, unless a word-boundary `INTO` appears in the statement (`SELECT … INTO`
     creates a table on Postgres and writes a file on MySQL), which makes it `ClassWrite`.
   - `WITH`: scan the whole statement for word-boundary write and DDL keywords, since Postgres
     allows a data-modifying CTE and a DDL statement can follow a CTE. Any DDL keyword is
     `ClassDDL`; else any write keyword is `ClassWrite`; else `ClassRead`.
   - `SHOW`, `DESCRIBE`, `DESC`, `VALUES`, `TABLE`: `ClassRead`.
   - `EXPLAIN`: `ClassRead` when the rest does not start with `ANALYZE`; when it does, classify the
     remainder recursively — `EXPLAIN ANALYZE` genuinely runs the statement.
   - Write set: `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `REPLACE`, `UPSERT`, `COPY`, `LOAD`, `IMPORT`.
   - DDL set: `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, `RENAME`, `COMMENT`, `GRANT`, `REVOKE`,
     `ATTACH`, `DETACH`, `REINDEX`, `VACUUM`, `OPTIMIZE`, `REFRESH`, `CLUSTER`, `ANALYZE`.
   - Everything else, `PRAGMA`, `SET`, `USE`, `BEGIN`, `COMMIT`, `ROLLBACK`, `CALL`, `DO`, `EXEC`
     and an empty statement included: `ClassUnknown`. `PRAGMA` is listed explicitly because
     `PRAGMA journal_mode=WAL` writes; `SET` because a session change is neither a read nor a write
     in this vocabulary; the transaction verbs because `AssertNoTransactionEscalation` already
     rejects them on a read-only connection and they express no data intent here.

`TRUNCATE` counts as DDL, not write — the SQL standard's own placement, and the UI helper text
spells it out (§7.2) so nobody has to guess which side it falls on.

**Library declined, with the requirement.** Go SQL parsers exist (`pg_query_go`, vitess's
`sqlparser`), each bound to one dialect's grammar: `pg_query_go` is Postgres's real parser via cgo,
vitess is MySQL's. This app runs five SQL dialects through one console path, and the question asked
here is one bit wide — what the statement's leading verb is. Taking two cgo-linked, dialect-bound
parsers (and still having nothing for ClickHouse) to answer it would add more failure surface than
it removes, and the repo already answers the same question the same cheap way in two places:
`isExplainable` (`views/console/explain.ts:8`-`15`) gates every auto-EXPLAIN, and
`AssertNoTransactionEscalation` (`adapters/errors.go:175`-`183`) gates every read-only console
batch. A parser would earn its keep only if the verdict had to be exact for a statement whose
leading keyword lies; the strictest-mode rule (§4.2) is what covers that case instead.

**Stated limitation, not a defect.** A classification is about the statement's declared shape, not
its effects: `SELECT write_function()` reads as `ClassRead`. This gate sits *on top of* the
connection's own `ReadOnly` flag and each adapter's own enforcement (`BEGIN READ ONLY`, Mongo's
per-method check, Redis's `COMMAND` check), never instead of them. Record it in `classify.go`'s doc
comment in those words, the way `AssertNoTransactionEscalation`'s own comment records its limits.

### 3.3 The seam `dbmcp` reaches it through

`adapterhost/router.go`, beside the existing three-line `Execute`:

```go
// ClassifyStatement answers what one console statement would do on connectionID's live adapter —
// dbmcp's own permission gate (M2). Deliberately outside RunOp: it issues no server work of its
// own (redis's COMMAND table is fetched once per connection set and cached), and the Execute it
// gates is the op that belongs in the op-log.
func (r *Router) ClassifyStatement(ctx context.Context, connectionID, statement string) (adapters.OpClass, error) {
	adapter, err := requireLiveAdapter(connectionID)
	if err != nil {
		return adapters.ClassUnknown, err
	}
	classifier, ok := adapter.(adapters.StatementClassifier)
	if !ok {
		return adapters.ClassUnknown, nil
	}
	return classifier.ClassifyStatement(ctx, statement)
}
```

`dbmcp.QueryRunner` (`server.go:61`-`63`) gains the same method, so `dbmcp` keeps exactly one seam
into the adapter layer.

## 4. Enforcement in `run_query`

### 4.1 Permission lookup

`internal/dbmcp/permissions.go`, new:

```go
type modes struct{ read, write, ddl string }

func modesOf(c model.ConnectionSummary) modes
// verdictFor returns the mode governing class: the named one for read/write/ddl, and for
// ClassUnknown the strictest of the three (deny beats prompt beats allow) — an unclassifiable
// statement must never be easier to run than the statement it might be.
func verdictFor(m modes, class adapters.OpClass) string
```

### 4.2 Order inside the handler

`tools.go`'s `runQuery`, after the existing `resolveEnabled` (which now yields the summary this
needs):

1. `summary, err := s.resolveEnabled(args.ConnectionID)` — unchanged.
2. If all three modes are `deny`, return an error result **before connecting**. Nothing this
   connection can be asked will run, and connecting would start a pre-connect script for a call
   that cannot succeed.
3. Clamp `maxRows` — unchanged.
4. `connectForQuery` — unchanged. Classification needs the live adapter (Redis's `COMMAND` table),
   and so does execution.
5. `class, err := s.cfg.Query.ClassifyStatement(ctx, args.ConnectionID, args.SQL)`. An error is not
   fatal: log it and continue with `ClassUnknown`, which step 6 treats as strictly as it can. A
   classifier failure must not be a way to bypass the gate, and must not be a way to break a
   connection either.
6. `switch verdictFor(modesOf(summary), class)`:
   - `allow`: fall through to `Execute`.
   - `deny`: error result, naming the class and where to change it —
     `"this connection's MCP permissions deny %s statements; change them in the connection's MCP tab"`.
   - `prompt`: §5's approval; on approval fall through, on anything else an error result naming
     which of denied, timed out or abandoned happened.
7. `Execute`, render — unchanged.

Every path above returns an `errResult` (caller-correctable), never a Go error — `render.go:21`-`28`
and M1 §5.3's split.

### 4.3 What the human path does

Nothing. M2 changes no console behaviour: `views/console/state.ts`'s `run()` is untouched, and the
connection's `ReadOnly` flag stays the human-side control. The three modes are labelled in the UI as
governing AI access specifically (§7.2), so the distinction is visible where it is set.

## 5. The approval flow

### 5.1 Broker

`internal/dbmcp/approval.go`, new — `gitsock.Broker`'s shape (§1.6), with one deliberate
difference noted below:

```go
const ApprovalTimeout = 120 * time.Second // the app's own existing prompt bound, twice over
const maxPendingApprovals = 50

type ApprovalOutcome int
const (
	ApprovalApproved ApprovalOutcome = iota
	ApprovalDenied
	ApprovalTimedOut
	ApprovalAbandoned // the server stopped, or the MCP client went away
)

type ApprovalActionResult int
const (ApprovalActionResolved ApprovalActionResult = iota; ApprovalActionAlreadyResolved)

// ApprovalRequest is one queued query — what the dialog renders.
type ApprovalRequest struct {
	RequestID      string
	ConnectionID   string
	ConnectionName string
	Kind           string
	Class          adapters.OpClass
	Statement      string
	EnqueuedAt     time.Time
	ExpiresAt      time.Time
}

type ApprovalSnapshot struct {
	Pending *ApprovalRequest
	Queued  int
}

type ApprovalBroker struct{ /* now func() time.Time; mu; queue []*entry; byID; emitter notify.Emitter[ApprovalSnapshot]; closed bool */ }

func NewApprovalBroker(now func() time.Time) *ApprovalBroker
func (b *ApprovalBroker) OnApprovalChange(fn func(ApprovalSnapshot)) (unsubscribe func())
func (b *ApprovalBroker) Pending() ApprovalSnapshot
func (b *ApprovalBroker) Request(ctx context.Context, req ApprovalRequest) ApprovalOutcome
func (b *ApprovalBroker) Approve(requestID string) ApprovalActionResult
func (b *ApprovalBroker) Deny(requestID string) ApprovalActionResult
func (b *ApprovalBroker) AbandonAll()
```

Rules, each of which the §9 test pins:

- FIFO; the head is the presented one; `Queued` is the whole queue's length. Every enqueue and
  every resolution emits a snapshot (G31 round 2's finding #6 on the pairing broker: emitting only
  on head changes leaves the "1 of N" count stale).
- `Emit` is called with `b.mu` released, `notify.Emitter`'s own documented requirement.
- One buffered result channel per entry, exactly one send over its lifetime. `Approve`/`Deny` on an
  unknown or already-resolved id report `ApprovalActionAlreadyResolved`, never an error — whichever
  window clicked first wins, the other is a no-op.
- **`Request` selects on three things**, not one: the result channel, `time.After` to its own
  `ExpiresAt`, and `ctx.Done()`. This is the difference from `gitsock.Broker`, which needs an
  external `ExpireOverdue` loop. Here `ctx` is the MCP request's own context, so a client that
  disconnects or times out stops the query from ever running; adding the deadline to the same
  select removes the need for a ticker entirely. On either non-decision exit the entry removes
  itself, a fresh snapshot is emitted, and the next head is presented.
- `Request` past `maxPendingApprovals` returns `ApprovalDenied` immediately rather than queueing —
  the pairing broker's own cap, for the same reason (an MCP client is a program and can call in a
  loop).
- `AbandonAll` resolves every pending entry as `ApprovalAbandoned` and empties the queue, leaving
  the broker usable: the DB MCP server can be toggled off and on again within one app run.

Lifetime: the broker is constructed once in `main.go` and outlives the `dbmcp.Server`, which starts
and stops with the settings toggle. That is what keeps the event subscription (`Events.Attach`,
wired once at boot) valid across a restart of the server.

### 5.2 Where `run_query` blocks

```go
outcome := s.cfg.Approvals.Request(ctx, dbmcp.ApprovalRequest{
	ConnectionID: args.ConnectionID, ConnectionName: summary.Name, Kind: summary.Kind,
	Class: class, Statement: args.SQL,
})
```

`dbmcp.Config` gains `Approvals *ApprovalBroker` (required, checked in `New` beside the other
required fields, `server.go:123`-`128`). `RequestID`, `EnqueuedAt` and `ExpiresAt` are minted by
the broker, not the caller.

The outcomes map to: approved, fall through to `Execute`; denied, `"denied by the user"`; timed
out, `"no answer within 2 minutes"`; abandoned, `"the database MCP server stopped before this was
answered"`. Each as an `errResult`, each naming the connection.

### 5.3 App close, server stop, client disappearance

- Toggle off, or app quit: `DbMcpService.stopLocked` calls `Approvals.AbandonAll()` after
  `server.Close()`. `main.go`'s `teardown` already calls `bridge.StopDbMcp` (`:323`), so quitting is
  covered by the same line.
- Client gone: `ctx.Done()` in the select. The statement never runs.
- Window closed with a dialog open: nothing is lost. The queue is server-side; the next window to
  mount fetches `PendingApprovals()` on boot, exactly as `state/gitClients.ts:53` does for pairing.

### 5.4 Why a modal dialog, not a dock

The AI client is blocked while the human decides. A dock or a notification-style queue tells the
user this can wait; the semantics say it cannot. The app already answers this exact question twice
the same way (§1.6), both of them prompts an external program is waiting on, and reusing that
answer means one mental model and a known-good keyboard posture (Deny focused on mount, Escape
denies). The Operations panel remains the after-the-fact record, as M1 built it.

Deliberately **not** in M2: an OS notification or window-raise for a pending approval (`main.go:445`-
`510`'s pairing path), and any "remember this decision" affordance. The first is a real question
for a later phase and is named here as a seam; the second is a fourth permission mode wearing a
button, and modes are set in the tab.

## 6. MCP surface

### 6.1 `list_connections`

`connectionView` (`render.go:70`-`78`) gains, per M1 §9's named seam:

```go
Description string                  `json:"description,omitempty"`
Permissions connectionPermissions   `json:"permissions"`
```

```go
type connectionPermissions struct {
	Read  string `json:"read"`
	Write string `json:"write"`
	DDL   string `json:"ddl"`
}
```

`permissions` is always present (a client that knows a write will be refused can say so instead of
composing one); `description` is omitted when empty.

### 6.2 Tool descriptions and server instructions

- `run_query`'s description (`server.go:175`-`178`) gains one sentence: each connection's
  read/write/DDL permission is checked first, and a statement in prompt mode waits for the user to
  approve it, which can take up to two minutes.
- The server `instructions` paragraph (`server.go:110`) gains one sentence pointing at
  `list_connections`' `permissions` object and its `description` field.

Both are the only places an AI client can learn this, so neither is optional polish.

## 7. Frontend

### 7.1 Wire and state

- `packages/shared/domain/dbmcp.ts`: `dbMcpApprovalSchema` (requestId, connectionId,
  connectionName, kind, class, statement, expiresAtMs) and `dbMcpApprovalSnapshotSchema`
  (`pending: nullable`, `queued: number`), mirroring `gitPairingSnapshot`'s own shapes.
- `bridge/events.go`: `ChannelDbMcpApproval = "kira:dbmcp:approval"`; `Sources` gains
  `DbMcp interface{ OnApprovalChange(func(dbmcp.ApprovalSnapshot)) func() }`; `Attach` gains one
  subscribe-and-emit through a `toWireApprovalSnapshot` projection (the statement is capped at
  4000 characters for the wire, with `truncated: true` beside it — a generated statement can be
  large, and the dialog renders it).
- `bridge/dbmcp.go`: `Approvals *dbmcp.ApprovalBroker` field, passed into `dbmcp.Config`;
  `AbandonAll` in `stopLocked`; three bound methods, `PendingApprovals()`,
  `ApproveQuery(DbMcpApprovalArgs)`, `DenyQuery(DbMcpApprovalArgs)`, each returning the current
  wire snapshot so the clicking window updates without waiting for its own broadcast.
- `main.go`: `approvals := dbmcp.NewApprovalBroker(time.Now)` beside `dbMcpSvc` (`:272`), passed to
  the service and added to `bridge.Sources` (`:292`).
- `frontend/src/bridge/index.ts` and `tests/ui/support/ipcChannels.ts` +
  `tests/ui/support/mockRuntime.ts`: four new entries (`dbMcpPendingApprovals`,
  `dbMcpApproveQuery`, `dbMcpDenyQuery`, and the `kira:dbmcp:approval` event).
- `state/dbmcp.ts`: `approval: { pending, queued }`, `hydrateDbMcpApprovals()` called from
  `main.ts` beside the existing hydration, a subscription to the channel, and
  `approveQuery`/`denyQuery` wrappers — `state/gitClients.ts:53`-`69`'s shape exactly.

### 7.2 `ConnectionDialog.vue`'s fourth tab

- `DetailTab` gains `'MCP'`; a fourth `<button class="p-tab" data-testid="connection-tab-mcp">`;
  a fourth `tab-pane`.
- `TAB_FOR_FIELD` gains `mcpDescription: 'MCP'` so a too-long description switches to this tab on a
  failed save.
- Pane contents, in DOM order:
  1. `Checkbox` bound to `draft.mcpEnabled`, labelled "Expose to the database MCP server", helper
     text saying nothing is exposed by default and that the same switch is in Settings.
  2. A `<textarea class="p-textarea">` bound to `draft.mcpDescription`, `maxlength="1000"`,
     labelled "Description — what this database is for", helper text saying an AI client reads it
     verbatim as connection metadata.
  3. Three `SegmentedControl` rows, read, write and DDL, options
     `[{value:'deny',label:'Deny'},{value:'allow',label:'Allow'},{value:'prompt',label:'Ask me'}]`,
     testids `connection-mcp-read`/`-write`/`-ddl`. Helper text under the group, one sentence each:
     what counts as read (SELECT and its engine equivalents), write (INSERT/UPDATE/DELETE and
     equivalents), DDL (CREATE/ALTER/DROP/TRUNCATE and equivalents, SQL engines only), and one
     line saying a statement this app cannot classify is treated as whichever of the three is
     strictest.
  4. A note that these govern the MCP server only, and that the Read-only flag on the Advanced tab
     is what governs this app's own console.
- Items 2-4 are disabled (`:disabled` on each control, not hidden) while `draft.mcpEnabled` is
  false: the settings still exist and still persist, they just do not apply. Hiding them would make
  the tab look empty for the common first visit.

### 7.3 The Settings overview list — decision

**Yes, keep the list; no, do not build a second editor.** The analogy to P67d's "Repository access"
holds, and M1 already acted on it: `SettingsDialog.vue:1180`-`1199` is that list. M2 extends each row
and leaves editing where the connection is edited:

- Each row becomes a two-line entry, the `repomap-repo-row` shape (`:1078`-`1105`): name on the
  first line, and beneath it `read allow · write prompt · DDL deny`, plus the description's first
  line when set, both `helper-text`. Read-only text, no controls beyond the existing checkbox.
- One `muted-note` above the list stating the defaults for a newly exposed connection and that
  per-connection permissions are edited in the connection's own MCP tab.

Reasons this is the right split, stated because SPEC asked for a deliberate answer:

- A connection already has a dedicated editor with a tab strip; a repository did not, which is why
  P67d had to put its checkbox somewhere and Settings was the only place.
- Three modes plus free text rendered per connection would turn a settings section into a second
  connection editor, and two editors for one field is how they drift.
- The glance is what the list is for: "which connections can an assistant touch, and how much" is
  exactly the question a user opens Settings to answer, and today the answer is a checkbox that no
  longer tells the whole story.

### 7.4 The approval dialog

`workbench/DbMcpApprovalDialog.vue`, mounted unconditionally at `App.vue` beside
`<GitPairingDialog />` (`:94`), rendering nothing while `dbMcpState.approval.pending` is null.
`GitPairingDialog.vue` is the template to follow, including the parts that exist for a reason:

- Deny focused on mount (`denyButton.value?.$el?.focus()`), close (Escape) denies.
- A 1s ticker driving a "Expires in Ns" line off `expiresAtMs`.
- "1 of N waiting" when `queued > 1`.
- Title: "Approve this query?"; body: connection name and kind, the class as a word ("a write
  statement"), then the statement itself in a scrollable `<pre class="mono">` capped by CSS
  `max-height` with the wire's own `truncated` note rendered when set.
- Testids `db-mcp-approval-dialog`, `db-mcp-approval-approve`, `db-mcp-approval-deny`,
  `db-mcp-approval-statement`, `db-mcp-approval-expires`, `db-mcp-approval-queue-count`.

## 8. Files

New:

| File | What |
|---|---|
| `apps/kira-studio/internal/storage/migrations/0021_m2_connection_permissions.sql` | Four columns (§2.1) |
| `apps/kira-studio/internal/adapters/classify.go` | `OpClass`, `StatementClassifier`, `ClassifySQL` (§3) |
| `apps/kira-studio/internal/adapters/classify_test.go` | §9's classifier test |
| `apps/kira-studio/internal/dbmcp/permissions.go` | `modesOf`, `verdictFor` (§4.1) |
| `apps/kira-studio/internal/dbmcp/approval.go` | `ApprovalBroker` and its types (§5.1) |
| `apps/kira-studio/internal/dbmcp/approval_test.go` | §9's broker test |
| `apps/kira-studio/frontend/src/workbench/DbMcpApprovalDialog.vue` | §7.4 |

Modified:

| File | Change |
|---|---|
| `internal/storage/migrations/embed.go` | `{21, "m2_connection_permissions", …}` |
| `internal/storage/model/connection.go` | Four fields on `ConnectionFields`; `ValidMcpPermissionMode` |
| `internal/storage/repos/connections.go` | Column list, scan (with the coerce-to-`deny` guard), five write methods |
| `internal/connections/input.go` | Mode and description validation in `Validate` |
| `internal/adapters/errors.go` | `stripSQLComments` exported as `StripSQLComments`; internal call site updated |
| `internal/adapters/postgres/console.go` (or `adapter.go`) | `ClassifyStatement` |
| `internal/adapters/mysqlfamily/…` | `ClassifyStatement` |
| `internal/adapters/sqlite/…` | `ClassifyStatement` |
| `internal/adapters/clickhouse/…` | `ClassifyStatement` |
| `internal/adapters/mongo/console.go` | `ClassifyStatement` over `parseStatement`/`isWriteStatement` |
| `internal/adapters/redis/console.go` | `ClassifyStatement` over `tokenize`/`isReadOnlyCommand` |
| `internal/adapterhost/router.go` | `ClassifyStatement` seam (§3.3) |
| `internal/dbmcp/server.go` | `QueryRunner` gains `ClassifyStatement`; `Config.Approvals`; required-field check; instructions and `run_query` description (§6.2) |
| `internal/dbmcp/tools.go` | `runQuery`'s gate (§4.2) |
| `internal/dbmcp/render.go` | `connectionView.Description`/`.Permissions` (§6.1) |
| `internal/bridge/events.go` | Channel, `Sources.DbMcp`, `Attach` line, wire projection |
| `internal/bridge/dbmcp.go` | `Approvals` field, `AbandonAll` on stop, three bound methods, wire types |
| `apps/kira-studio/main.go` | Construct the broker; pass it to the service and to `Sources` |
| `packages/shared/domain/connection.ts` | `mcpPermissionModeSchema` and four fields |
| `packages/shared/domain/dbmcp.ts` | Approval schemas |
| `frontend/src/bridge/index.ts` | Three calls plus the event subscription |
| `frontend/src/state/connections.ts` | `defaultDraft()` gains four keys |
| `frontend/src/state/dbmcp.ts` | Approval state, hydration, subscribe, approve/deny |
| `frontend/src/main.ts` | Hydrate pending approvals at boot |
| `frontend/src/App.vue` | Mount `DbMcpApprovalDialog` |
| `frontend/src/project/ConnectionDialog.vue` | The MCP tab (§7.2) |
| `frontend/src/workbench/SettingsDialog.vue` | Per-row glance and the defaults note (§7.3) |
| `tests/ui/support/{ipcChannels,mockRuntime}.ts` | Four new channels |
| `tests/ui/**` + `packages/db-fixtures/support/*` | The four new fields at every site that already spells `mcpEnabled` |

`frontend/bindings/` is gitignored and regenerated by the Wails build.

**Fixture sweep, called out because M1ab lost a pass to exactly this.** `grep -rn mcpEnabled
--include=*.ts --include=*.vue apps/kira-studio packages` reports 40 sites across 24 non-generated
files today. Every one that builds a `ConnectionSummary`/`ConnectionInput` literal needs the four
new keys, because each new zod field with `.default()` is required in the inferred output type. Do
the sweep by grep, not by fixing whatever `bun run typecheck` names first: arm A's first fix pass
patched two specs and missed the rest, and the miss only surfaced in a full Playwright run.

## 9. Tests

`CLAUDE.md`'s default is no dedicated unit test. Two clear the bar; the rest are named and declined.

**1. `internal/adapters/classify_test.go` — `ClassifySQL`.** A decision structure with several
interacting rules over untrusted text, where a wrong verdict silently permits a write: comment
stripping before keyword extraction (`/* c */ DROP TABLE t`, `-- c\nUPDATE …`), nested block
comments, the trailing-semicolon strip versus the embedded-semicolon guard (`SELECT 1; DROP TABLE
t` must be `ClassUnknown`), `WITH` bodies (`WITH x AS (SELECT …) SELECT` read; `WITH x AS (DELETE …
RETURNING *) SELECT` write; `WITH x AS (…) INSERT …` write), `SELECT … INTO`, `EXPLAIN SELECT` read
versus `EXPLAIN ANALYZE DELETE …` write, and the unknown verbs (`PRAGMA`, `SET`, empty). A table
test, no fixtures, no server. This is the precise shape `adapters/errors_test.go` already tests
`AssertNoTransactionEscalation` with.

**2. `internal/dbmcp/approval_test.go` — the broker.** Concurrency, ordering and cancellation, the
categories `CLAUDE.md` names outright: FIFO head presentation with three concurrent `Request`
calls; every enqueue and every resolution emitting a snapshot with the right `Queued`; a
double-`Approve` reporting `ApprovalActionAlreadyResolved` and never double-pumping the queue; a
ctx cancellation removing a *non-head* entry and leaving the head presented; the deadline path with
an injected clock; the queue cap; `AbandonAll` releasing every blocked caller and leaving the broker
usable afterwards. `gitsock/pairing_test.go` is the model.

Declined, explicitly:

- `verdictFor`/`modesOf` — a three-way lookup plus "strictest of three". A test would restate the
  function body; the classifier test covers the input side and the broker test the output side.
- The migration, the four columns, the repo scan, the zod schema, `defaultDraft` — CRUD round-trips
  and required-field guards.
- The per-adapter `ClassifyStatement` bodies — each is a two- to ten-line delegation to code this
  phase does not change: `ClassifySQL` (tested above) for four packages, `parseStatement` plus
  `isWriteStatement` for Mongo (whose parse path `TestMongo_Console_Execute` and
  `TestMongo_Console_UnsupportedMethod` already drive against a real server), and
  `tokenize` plus `isReadOnlyCommand` for Redis (`tokenize` has five dedicated tests in
  `redis/console_test.go`). **No adapter
  conformance change**: this phase adds no `Adapter` method and changes no adapter behaviour on any
  existing path, so `adapters/*/*_test.go`'s per-capability contract is untouched. The real-container
  suites (P25/P26) gain nothing either — the classifier's verdicts are a pure function of text on
  five of six kinds, and Redis's is a cached read of a table the read-only path already depends on.
- `bridge/dbmcp.go`'s new methods and the Vue surface — thin wrappers and template work.

Fast checks per commit: `go build ./...`, `go vet ./...`, `go test ./...`, `bun run typecheck`,
`bun run lint`. Once, near the end: the full `tests/ui/` Playwright suite, which is where a missed
fixture field shows up.

**One UI spec is worth extending, not writing fresh**: `tests/ui/connection-dialog-tabs.spec.ts`
already asserts which controls live on which tab; add the fourth tab to its existing assertions
(the strip switches, the MCP controls are absent from the other panes). That is an edit to a spec
whose whole subject is the tab strip, not a new test earning its own keep.

## 10. Order and sizing

### 10.1 Implementation order

Go first and green before any `.vue` file is touched, M1's own ordering discipline.

1. Migration + `embed.go` + `ConnectionFields` + `ValidMcpPermissionMode` + `repos/connections.go`
   + `input.go` validation. `go build ./...` green.
2. `adapters/classify.go` + `StripSQLComments` export + `classify_test.go`.
3. The six adapter `ClassifyStatement` implementations.
4. `Router.ClassifyStatement` + `dbmcp.QueryRunner`.
5. `dbmcp/approval.go` + `approval_test.go`.
6. `dbmcp/permissions.go`, `tools.go`'s gate, `render.go`'s `connectionView`, `server.go`'s
   instructions and `Config.Approvals`.
7. `bridge/events.go` + `bridge/dbmcp.go` + `main.go`.
8. Frontend: zod schemas, `bridge/index.ts`, `state/connections.ts`, `state/dbmcp.ts`, `main.ts`,
   `DbMcpApprovalDialog.vue`, `App.vue`, `ConnectionDialog.vue`, `SettingsDialog.vue`.
9. The fixture sweep (§8) and the `connection-dialog-tabs.spec.ts` extension.
10. Full `go test ./...`, `bun run typecheck`, `bun run lint`, `bun run build`, then the whole
    `tests/ui/` suite.

Commits per numbered step, Conventional Commits: `feat(dbmcp):`, `feat(adapters):`,
`feat(connections):`.

### 10.2 One pass, with a named fallback seam

One Sonnet pass. Steps 2-6 are one continuous thread — the `OpClass` vocabulary set in step 2
shapes every later signature, and step 6's gate is meaningless until steps 3-5 exist. Step 8 is
pure consequence of step 7's exported shapes. A second subagent would start cold and re-derive all
of it, which is the cost `CLAUDE.md` warns against.

Size: 7 new files, ~28 edits, of which about half are one- to five-line mechanical additions, plus
the fixture sweep.

**If an arm runs out of room, the seam is after step 7**: the Go side is then complete and testable
over curl per `CLAUDE.md`'s headless technique (`run_query` in prompt mode blocks, and
`PendingApprovals`/`ApproveQuery` are reachable), with only the renderer left. Do not split
anywhere else — in particular never between steps 2 and 6, which would leave a gate that classifies
but does not enforce.

## 11. Out of scope, and the seams M3/M5 plug into

Out, stated so it stays out entirely:

- Any change to the human console path (§4.3).
- A "remember this decision" affordance, an allow-list of statement shapes, or a per-request
  override of the connection's modes. A fourth behaviour belongs in the mode vocabulary or nowhere.
- OS notification and window-raise for a pending approval — real, and named as a seam below.
- Row-level or column-level permissions: M5's anonymization is the phase that shapes *what comes
  back*, not this one.
- LIMIT injection and heavy-query gating — still M3's, unchanged by this phase.

Seams:

| Later phase | Seam |
|---|---|
| M3 EXPLAIN | `explain_query` classifies as `ClassRead` through `ClassifySQL`'s own `EXPLAIN` rule, so it needs no permission vocabulary of its own; auto-force-explain runs before the §4.2 gate, since a plan is a read regardless of what it plans |
| M3 heavy-query flag | The approval dialog is the surface that already interrupts a human mid-query; a heavy-query warning can be a second reason to raise it, not a second dialog |
| M5 anonymization | Unchanged from M1 §9: between `Query.Execute` and `render.go`'s projection, one call site |
| A later phase wanting a notification | `main.go:445`-`510`'s pairing notification path (category, approve/deny actions, withdraw on resolve) is the working precedent, driven by the same snapshot subscription this phase adds |

## 12. Dogfooding note

The repo-map MCP server was used throughout this planning pass, started per `CLAUDE.md`'s headless
steps and called over curl (the native tool surface does not appear in an agent-harness session).
It did real work: `read_symbol` on `isReadOnlyCommand` returned the method and its whole doc comment
without opening `redis/client.go`'s 300+ lines, `outline_file` on `mongo/console.go` gave the
thirteen declarations that located `writeConsoleMethods`/`isWriteStatement` in one call rather than
reading 470 lines, `find_implementations` on `Adapter` enumerated all ten adapter packages with
line numbers, and `find_references` on `resolveEnabled` found the four `dbmcp` call sites exactly.

Four observations, for the log keeper to fold into `docs/v1.7/mcp-repo-map-issues.md`:

1. **Reproduced, not new — Go struct fields are invisible to both `search_symbols` and
   `find_references`.** `search_symbols{"query":"McpEnabled"}` answers "no symbols matching";
   `find_references{"symbol":"McpEnabled"}` answers "no references found", against a field with
   eight live uses across `model/connection.go`, `dbmcp/access.go`, `dbmcp/tools.go` and
   `repos/connections.go`. This is the same class already logged in v1.7's own log (the
   `ThrottlePerSec`/selector-expression entry) — worth recording that it reproduces on a second
   field, not worth a second entry.
2. **Trivial, schema inconsistency.** `find_implementations` rejects `limit` outright
   (`validating "arguments": unexpected additional properties ["limit"]`), while
   `search_symbols`, `find_references` and `search_files` all accept it. The tool's own answer then
   listed ten same-named symbols and asked for a `file`/`languages` narrowing, which is a sensible
   contract — but the inconsistent argument set is a thing to trip over. Read `tools/list` before
   assuming an argument exists.
3. **Trivial, worth knowing.** Initial sync on this repository takes well over 60s on this
   container; every tool call in that window returns "still building (initial sync running past
   25s) — retry shortly" as an `isError` result. Correct behaviour, but a planning pass should start
   the server before it needs it, not when.
4. **Not a repo-map defect, recorded so nobody else loses ten minutes.** `pkill -f mcp-repo-map`
   from this harness kills the shell running the command too, since the pattern matches the shell's
   own command line — which silently skipped the `rm` of the token file in a chained command and
   made a fresh mint look like a token reuse. Kill by PID from `pgrep`, or match a pattern that
   cannot match the invoking command.
