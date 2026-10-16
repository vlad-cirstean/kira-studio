# M1 — Local DB MCP server: list/metadata/query tools, and 7-day token rotation in `mcpauth`

Two deliverables in one phase (`docs/v1.7/SPEC.md`'s M1 row):

1. A new Go MCP server, `internal/dbmcp`, sibling to `internal/repomap`: enumerate this app's
   connections, browse their metadata, run a query — through the existing adapter layer, never a
   parallel path.
2. 7-day expiry and rotation built into `internal/mcpauth` itself, **applied to both servers** —
   the new one from day one, the repo-map server's existing non-expiring token retrofitted onto the
   same mechanism.

Everything below was read directly in the current tree (`v1.7` at `7636b23e`+), or reproduced
against a live repo-map server started per `CLAUDE.md`'s headless steps. Line numbers are from that
tree.

M1 is plan-only; M1ab implements this plan twice from one commit. That raises the bar on this
document: both arms must land the same thing from this text alone, so every decision below is
stated as a decision, not a range.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| Extend `mcpauth` or add a sibling package? | Extend `mcpauth`. Settled by SPEC's own scope change (`66dbf2da`): both servers share one mechanism | §2 |
| Record shape for expiry | `Record` gains `ExpiresAt time.Time` (`json:"expiresAt,omitempty"`). Zero value = never expires, which is exactly what every pre-M1 file on disk already means | §2.1 |
| Auto-remint on expiry, or manual? | Neither alone: **remint only at a moment a human can read the new plaintext** — server start, or an explicit Regenerate. Never mid-flight | §2.3 |
| Does that differ between the two servers? | No. One rule, two surfaces: the headless repo-map binary has "start" (it prints the command); the app has both start and Regenerate | §2.3 |
| What happens to a repo-map token already registered and still valid? | **Stamp on first post-M1 load**: a record with no `ExpiresAt` gets `now + 7d` written back, same hash and salt. Nobody breaks at upgrade; everybody is on rotation from the first start after it | §2.4 |
| What a lapsed client sees | 401 whose body names the condition, the expiry instant, and the fix. One implementation in `mcpauth`, used by both servers | §2.5 |
| Separate process/port, or shared with repo-map? | Separate package, separate `mcp.Server`, separate listener (8766, ephemeral fallback), separate token file — but **embedded in the app process only**, no headless binary | §3.1, §3.2 |
| Own storage root or share `KIRA_HOME`? | Share `KIRA_HOME`. Collision is impossible: `mcp-db-token.json` vs `mcp-repo-map-<slug>-token.json` | §2.2 |
| `list_databases` / `list_schemas` | Refined into one `list_children`. Justified: `database` is the root level for 6 of 10 kinds and wrong for the other 4; `schema` exists in 1 of 10 | §4.2 |
| Which adapter kinds in v1 | All ten. No kind carve-out: each tool gates on the `Caps` flag the UI already gates on, and an adapter that cannot serve one already answers `E_UNSUPPORTED` in its own words | §4.6 |
| Result DTOs for metadata | Reuse `model.ObjectMeta`, `model.RelationColumns`, `model.TreeNode`, `model.ConnectionSummary` verbatim — the exact structs the frontend gets | §5.1 |
| Result shape for `run_query` | A new projection, unavoidably: rows cross to the frontend as FlatBuffers (`internal/page/encode.go`), so no JSON row shape exists to reuse | §5.2 |
| Settings toggle | Yes — a new `Database MCP` section, mirroring `Code intelligence` | §6.2 |
| Per-connection scoping | Yes, from the start: `connections.mcp_enabled`, deny by default, allow-list edited in that same Settings section. Deliberately P67d's shape, arrived at before the same retrofit was forced | §6.1 |
| Tests | Two, both named and justified. Nothing else | §8 |
| One Sonnet pass or split? | One | §10.2 |

## 1. Confirmed current state

### 1.1 The repo-map server's shape, as precedent

`repomap.New` (`server.go:106`) resolves a repository, opens `codeindex.Store`, builds the tool
server, binds the listener, returns before serving. `bindHTTP` (`http.go:30-56`) tries
`127.0.0.1:8765`, falls back to `127.0.0.1:0`, mounts `mcp.NewStreamableHTTPHandler` under `/mcp`
behind `auth.RequireBearerToken`. `Serve` blocks; `Close` is idempotent and `sync.Once`-guarded
(`server.go:316`).

Tool registration is `mcp.NewServer` + seven `mcp.AddTool` calls (`server.go:191-228`). Every
handler has signature `func(ctx, *mcp.CallToolRequest, In) (*mcp.CallToolResult, any, error)`, with
`In` a plain struct whose `json:` + `jsonschema:` tags *are* the published input schema
(`tools.go:54-70`). `Out` is `any` everywhere, so the SDK publishes no output schema and every
answer is one `TextContent` (`tools.go:11-16`).

Two callers construct a `Server`: `cmd/kira-repo-map/main.go:47` (headless) and
`bridge/repomap.go:107` (embedded). `internal/repomap` imports nothing from `internal/bridge`;
`internal/layering_test.go` enumerates every `internal/*` package from `go list` and enforces that
for all of them automatically, so `internal/dbmcp` is covered the moment it exists.

### 1.2 `mcpauth` today

`token.go` is 131 lines: `Mint` (32 random bytes + 16 salt), `hashToken` = `sha256(salt‖token)`,
`Verify` (constant-time, undecodable input still compared), `Path`, `Load`, `Save`, `LoadOrMint`,
`Slug`. `Record` is `{Hash, Salt []byte}` — no expiry field, no time import.

Three call sites reach it: `cmd/kira-repo-map/main.go:52`, `bridge/repomap.go:84` and `:218`
(confirmed with `find_references`).

`repomap/http.go:44-48` passes `AllowMissingExpiration: true` with the comment "D8's own token
carries no exp claim". That option is what M1 makes load-bearing in a new way — see §2.5.

### 1.3 The query path the console actually uses

`adapterhost.Dispatcher.Execute` (`data.go:199-227`): require a live adapter, decode the path, then
`host.RunOp(ctx, OpSpec{Kind: "execute", …})` wrapping `adapter.Execute(ctx, model.ConsoleRequest{
Path, Statements}, op)`. `RunOp` (`host.go:141`) mints an op id, refuses a duplicate, applies the
per-connection throttle (`throttle.go`), emits `op:start`/`op:end`, and recovers panics into
`E_INTERNAL`.

The renderer reaches that method through the data-frame channel: `HandleDataFrame` →
`handleDataOp` → `case "data:execute"` (`dataframe.go:175-182`). `Dispatcher` is unexported and
`Router` exposes no `Execute`, so M1 needs one three-line exported seam (§7, `router.go`).

Per-adapter `Execute` reads the *first path segment* to select the database:
`postgres/adapter.go:367-377` (`if Segments[0].Kind == "database"`), `mongo/adapter.go:280-295`
(same, and errors `no database selected for the console` when neither a path segment nor the
connection's own default supplies one), `sqlite/adapter.go:371` (ignores the path — one file, one
database). So a `run_query` tool that omits the path is wrong for Postgres/MySQL/ClickHouse/Mongo.

Read-only enforcement is already per-adapter and already wired: `postgres/console.go:155-180` wraps
the whole batch in `BEGIN READ ONLY` and calls `AssertNoTransactionEscalation` first, driven by the
connection's own `ReadOnly` flag.

### 1.4 The metadata path

`tree.Service` (`tree/service.go`) is cache-aside over `metadata_cache`, backed by `Router`'s
`tree.Backend` methods. Four kinds: `children`, `describe`, `definition`, `columns`. Two properties
matter here:

- A non-`refresh` read can be answered **while the connection is disconnected** (`getCached`,
  `:123-132`, and `freshnessFloor`, `:106-112`: no floor applies when not connected). So metadata
  tools can often answer with no live connection at all.
- A cache miss calls `requireConnected` (`:89-98`) and fails with `ipcerr.Disconnected(name)`.

`Router.Children/Describe/SchemaColumns` (`router.go:139-251`) each normalise nil slices to `[]`
before returning, so the JSON an MCP client sees is already the JSON the frontend sees.

### 1.5 Level shapes, per kind — why `list_databases`/`list_schemas` cannot both be honest

Root children, read from each adapter's `catalog.go`:

| Kinds | Root child kind | Has a `schema` level |
|---|---|---|
| postgres, mariadb, mysql, sqlite, clickhouse, mongodb, redis | `database` | postgres only |
| kafka | `topic` | no |
| s3 | `bucket` | no |
| sqs | `queue` | no |

`list_databases` is a lie for 3 of 10 kinds; `list_schemas` for 9 of 10. Redis goes
`database → namespace → key`, Kafka `topic → partition`, S3 `bucket → prefix → object` — levels two
fixed-name tools have no name for at all.

### 1.6 Capability flags

`Caps().SQL` is true for postgres, mariadb, mysql, sqlite, clickhouse, mongodb, redis — it means
"has a console", not "speaks SQL". False for kafka, s3, sqs. `Caps().Describe` is false for redis,
kafka, s3, sqs. `Caps().SchemaColumns` is true only for the five SQL kinds. `adapter.go`'s own
package doc states the rule these exist for: "the `Caps` declaration the UI reads instead of a kind
check".

### 1.7 Settings and connection storage

`model.CodeIntelSettings{McpServerEnabled bool}` (`settings.go:47`), persisted as the dotted leaf
`codeIntel.mcpServerEnabled` (`repos/settings.go:67`, `:155`), defaulted in `DefaultSettings`
(`:84`) and in `packages/shared/domain/settings.ts:119`. The dialog block is
`SettingsDialog.vue:865-935`, reached from the `sections` array at `:108-114`.

`ConnectionFields` (`model/connection.go:7-28`) already carries two first-class booleans/floats
added by migration (`0004_p18_auto_explain.sql`, `0005_p28_throttle.sql`), each an
`ALTER TABLE … ADD COLUMN … NOT NULL DEFAULT` with no rebuild. `connections.Input` embeds
`ConnectionFields`, so a new bool needs no `input.go` change. `state/connections.ts`'s
`openEditDialog` spreads every summary field into the draft (`:111-125`), so a new field
round-trips through `ConnectionDialog.vue` untouched — only `defaultDraft()` needs the new key.

## 2. The token: 7-day rotation in `mcpauth`, shared by both servers

### 2.1 Record shape

```go
type Record struct {
	Hash      []byte    `json:"hash"`
	Salt      []byte    `json:"salt"`
	ExpiresAt time.Time `json:"expiresAt,omitempty"` // zero = never expires (pre-M1 file)
}

const TTL = 7 * 24 * time.Hour
```

`time.Time` marshals as RFC 3339 and unmarshals back exactly; an absent key leaves the zero value.
That zero value is the whole reason this is additive: every `mcp-repo-map-*-token.json` already on
disk parses unchanged and means precisely "no expiry recorded yet", which §2.4 then acts on. No
migration, no file-format version, no reader that has to branch on a schema number.

### 2.2 File naming

```go
func PathNamed(home, name string) string { return filepath.Join(home, name+"-token.json") }
func Path(home, slug string) string      { return PathNamed(home, "mcp-repo-map-"+slug) }
```

`Path` keeps its exact current behaviour and its three call sites are untouched. `dbmcp` uses
`PathNamed(home, "mcp-db")` → `$KIRA_HOME/mcp-db-token.json`.

No slug for the DB server: repo-map is keyed by repo id because one machine can serve several
checkouts (`server.go:1-11`); the DB server is one instance per app process per `KIRA_HOME`, with
no second identity to key on. Collision with repo-map's files is impossible — different prefix,
and no slug can ever produce the string `db`, since `Slug` returns 12 hex characters.

### 2.3 Rotation trigger

**Rule: a token is minted only at a moment a human can read the new plaintext.** A hash cannot be
reversed (`server.go:296`), so a mint nobody sees is a mint that silently breaks the registered
client with no way to recover short of finding the file.

Two such moments, and only two:

- **Server start** — `LoadOrMintTTL` mints when the file is missing **or** the stored record has
  lapsed. The headless binary prints the registration command (`cmd/kira-repo-map/main.go:62-65`);
  the app's Settings section shows it.
- **Explicit Regenerate** — `MintTTL` + `Save` + `SetToken` on the live server. Already implemented
  for repo-map (`bridge/repomap.go:212-230`); `dbmcp` gets the identical method.

**Never mid-flight.** A server that is up and serving when its token lapses does not quietly swap
in a new one; it starts returning §2.5's error until one of the two moments above happens. Anything
else would present a working server to a client holding a token that can no longer work, with no
signal either could act on.

This is one rule, not two schemes. The two servers differ only in which moments they have: the
headless repo-map binary has restart (and `CLAUDE.md`'s own instruction already ends in "restart the
server"); the app has restart and a button.

```go
func MintTTL(ttl time.Duration) (plain string, rec Record, err error)   // Mint + ExpiresAt
func Expired(rec Record, now time.Time) bool                            // !ExpiresAt.IsZero() && !now.Before(ExpiresAt)
func LoadOrMintTTL(path string, ttl time.Duration) (plain string, rec Record, minted bool, err error)
```

`Mint` stays, unexported-in-spirit: `MintTTL(0)` would mean "never expires", which nothing should
want any more. Delete `Mint` and `LoadOrMint` outright and update all three call sites — leaving a
non-expiring mint in the package is exactly the "two parallel schemes" the scope change forbids.

### 2.4 The retrofit: what happens to an existing repo-map token

`LoadOrMintTTL` on a record whose `ExpiresAt` is zero **stamps it**: sets `ExpiresAt = now + ttl`,
re-`Save`s the same `Hash` and `Salt` at mode 0600, and returns it as a load (`minted=false`,
`plain=""`). Stamping happens once — the next start sees a non-zero `ExpiresAt` and leaves it alone,
so the clock is not reset by restarts.

Chosen over the two alternatives:

- *Treat an unstamped record as already expired.* Breaks every currently-registered dev setup at the
  instant of upgrade, for no security gain — the token never leaves loopback, and the client that
  holds it is the one the user deliberately registered.
- *Grandfather unstamped records forever.* Then rotation applies to no existing install, only to
  clean ones. That is scope half-implemented, which `CLAUDE.md` rules out outright.

Stamping applies the property to everyone, gives each existing client exactly one ordinary 7-day
window to notice, and needs no migration step of its own.

Consequence to state plainly, because it is the user-visible cost: **about a week after M1 lands,
every developer's registered `kira-repo-map` entry stops working until they restart the server and
re-run the `claude mcp add` command it prints.** That is the feature, not a defect — but it is why
§7 updates `CLAUDE.md`'s "a later run reuses it" sentence in this phase rather than waiting for M8.

### 2.5 What a lapsed client sees

The SDK middleware turns a verifier error that unwraps to `auth.ErrInvalidToken` into
`http.Error(w, err.Error(), 401)` (`auth/auth.go`, `verify` + `RequireBearerToken`). So a custom,
actionable 401 body needs no custom middleware at all — only a verifier that returns a wrapped
error carrying the text.

`mcpauth` grows the verifier, so both servers get one implementation:

```go
// Outcome distinguishes the three cases a bearer check can land in — a lapsed token must not be
// reported as a wrong one, since the remedies differ.
type Outcome int
const (OutcomeValid Outcome = iota; OutcomeExpired; OutcomeInvalid)

func Check(presented string, rec Record, now time.Time) Outcome

// TokenVerifier is the auth.TokenVerifier both servers mount. load reads the server's own current
// record under its own lock, so a Regenerate mid-flight is picked up by the very next request.
func TokenVerifier(label string, load func() Record) auth.TokenVerifier
```

`Check` compares hashes first and only then tests expiry, so a wrong token never learns the real
one's expiry instant. On `OutcomeExpired` the verifier returns:

```
%w: the %s MCP token expired at <RFC3339>. Kira Studio mints a fresh one when the server restarts
or when you press Regenerate in Settings; re-register this server with the command it shows.
```

wrapping `auth.ErrInvalidToken` (`label` is `"kira-repo-map"` or `"kira-db"`). On `OutcomeInvalid`
it returns bare `auth.ErrInvalidToken` — "invalid token", unchanged from today.

Both `http.go` files keep `AllowMissingExpiration: true`. That is now a deliberate choice, not an
inherited one: the SDK's own expiry check produces the flat body `"token expired"`
(`auth.go`'s `verify`), which would override the actionable text above. Expiry is checked in exactly
one place — `Check` — and `TokenInfo` stays empty. Note it in the comment where today's "carries no
exp claim" comment stands, so the next reader does not "fix" it by populating `Expiration`.

### 2.6 One defect found while dogfooding, fixed here because M1 owns this file

`mcpauth.Save` calls `os.WriteFile` with no `MkdirAll` (`token.go:94`). On a machine where
`$KIRA_HOME` does not exist yet, the repo-map server fails to start outright:

```
kira-repo-map: repomap: resolve token: mcpauth: write /root/.kira-studio/mcp-repo-map-…-token.json: … no such file or directory
```

Reproduced in this container on the first `bun run mcp:repo-map`. `dbmcp` would hit it identically.
Fix in `Save`: `os.MkdirAll(filepath.Dir(path), 0o700)` before the write. Mode 0700, matching the
0600 the file itself already uses.

## 3. The server

### 3.1 Separate server, embedded only — and why there is no headless binary

Separate, confirmed: its own package, its own `mcp.Server`, its own listener, its own token file,
its own Settings toggle. The two serve unrelated things with opposite trust postures (SPEC's own
framing), and a shared process would put a tool that can run DDL behind the same token as a
read-only code index.

But **no `cmd/kira-db-mcp` binary**, unlike repo-map. Three things a separate process could not
reach:

1. `adapters.GetLiveAdapter` is a package-level map in the app's own process (`adapters/live.go:7`).
   A second process has no live adapters and would have to open its own connections to every
   database — doubling every server's connection count and every session's pre-connect script.
2. Credentials decrypt through `secrets.Cipher`, wired from the OS keychain in `main.go`. A headless
   process would need its own keychain access, prompting outside any UI the user is looking at.
3. Op-log, throttle and cancel all live in the app's `Router`/`Host`. A second process's queries
   would not appear in the Operations panel — the one surface where a human can see what an AI
   client just ran, which is the main safety property M1 gets for free (§4.5).

State this as a decision, not an omission: the DB MCP server runs when Kira Studio runs.

### 3.2 Transport and port

`DefaultPort = 8766`, adjacent to repo-map's 8765, with the same `127.0.0.1:0` fallback on conflict
and the same loopback-only bind — copy `repomap/http.go:30-56`'s structure verbatim. Path `/mcp`.
`Stateless: true`, as repo-map uses.

### 3.3 Lifecycle

Copy `bridge/repomap.go`'s shape exactly, including the parts that exist for non-obvious reasons:

- `bridge.DbMcpService{Deps appcore.Deps, Installer RepoMapInstaller}` — the installer interface is
  already declared in `bridge/repomap.go:19-22` and reused as-is, not re-declared.
- `startLocked(mint bool)` / `stopLocked()` under one mutex; `go srv.Serve()`.
- `startIfEnabled` and `stop` **unexported**, reached only through package-level
  `StartDbMcpIfEnabled(s)` / `StopDbMcp(s)`. `bridge/repomap.go:166-173` explains why: Wails binds
  every exported method of a registered service, and a wire-callable `Stop` would let a stray call
  bypass the settings leaf.
- `main.go`: construct beside `repoMapSvc` (`:265`), `StartDbMcpIfEnabled` there, `StopDbMcp` in
  `teardown` beside `bridge.StopRepoMap` (`:311`), register in the `Services` slice (`:370`).
- A start failure is logged, never fatal — `gitSock.Start()`'s posture, which repo-map already
  mirrors.

`dbmcp.Server` has no index to build, so it needs none of repo-map's readiness gate, sync lock or
watcher. `New` binds and returns; `Close` shuts the listener down, `sync.Once`-guarded.

`dbmcp.Config`:

```go
type Config struct {
	Home     string                // "" → config.KiraHome()
	Token    TokenProvider         // required, same seam as repomap.TokenProvider
	Conns    ConnectionsReader     // connections.Service
	Tree     MetadataReader        // tree.Service
	Query    QueryRunner           // adapterhost.Router
	Logger   *slog.Logger
}
```

Each of the three backend fields is a consumer-declared interface in `dbmcp`, per the repo's own
A11 discipline (`tree.Backend`, `connections.Backend`, `bridge.Canceller` are the precedents):

```go
type ConnectionsReader interface {
	List() ([]model.ConnectionSummary, error)
	StateOf(connectionID string) model.ConnectionState
	Connect(connectionID string) (model.ConnectionState, error)
}
type MetadataReader interface {
	Children(connectionID, path string, refresh bool) (tree.ChildrenResult, error)
	Describe(connectionID, path string, refresh bool, tabID *string) (tree.DescribeResult, error)
	SchemaColumns(connectionID, path string, refresh bool) (tree.SchemaColumnsResult, error)
}
type QueryRunner interface {
	Execute(ctx context.Context, req adapterhost.ExecuteRequestWire) (adapterhost.ExecuteResponse, error)
}
```

`*connections.Service`, `*tree.Service` and `*adapterhost.Router` satisfy these structurally once
§7's three-line `Router.Execute` seam exists.

## 4. Tools

Five tools. `mcp.NewServer(&mcp.Implementation{Name: "kira-db", Title: "Kira Studio databases",
Version: serverVersion}, &mcp.ServerOptions{Instructions: …})`, then five `mcp.AddTool` calls —
`repomap/server.go:191-228`'s structure.

Server instructions, one paragraph in repo-map's register:

> These tools read and query the databases configured in this Kira Studio app. Only connections the
> user has explicitly exposed are visible; start with `list_connections`. Walk structure with
> `list_children`, passing back a `path` it returned — levels differ per engine, so do not assume a
> database or schema level exists. `describe_schema` gets every relation's columns in one call and
> is cheaper than one `describe_table` per table. `run_query` runs one statement through the same
> path the app's own SQL console uses, against the connection's own permissions; results are capped
> and say so when truncated. Every query appears in the user's Operations panel.

### 4.1 `list_connections`

```go
type listConnectionsArgs struct{}
```

No inputs. Returns every connection with `mcp_enabled` true, as JSON:

```json
[{"id":"…","name":"analytics","kind":"postgres","readOnly":true,"status":"connected",
  "serverVersion":"16.4","capabilities":{"query":true,"describe":true,"schemaColumns":true}}]
```

`id/name/kind/readOnly` from `model.ConnectionSummary`; `status`/`serverVersion` from
`ConnectionState`; `capabilities` from the live adapter's `Caps` when connected, and omitted when
not (caps are not knowable for a connection that has never connected — say nothing rather than
guess). A connection the user has not exposed is absent entirely, not listed-and-denied: its
existence is not the AI client's business.

This struct is M2's insertion point for the free-text description field.

### 4.2 `list_children` — replacing `list_databases` and `list_schemas`

```go
type listChildrenArgs struct {
	ConnectionID string `json:"connectionId" jsonschema:"Connection id from list_connections."`
	Path         string `json:"path,omitempty" jsonschema:"Encoded path of the container to list, exactly as a previous list_children returned it. Omit for the connection's top level."`
	Refresh      bool   `json:"refresh,omitempty" jsonschema:"Bypass the cached listing and re-read from the server. Default false."`
}
```

Calls `Tree.Children(connectionID, path, refresh)`; returns `[]model.TreeNode` as JSON — each node
already carries `kind`, `name`, `path`, `hasChildren`, `detail`, `badges`.

Justification for the refinement, against §1.5's table: the adapter layer's metadata primitive is
one lazy level (`Adapter.Children`, `adapter.go:41`), and the levels differ per kind. Two
fixed-name tools would answer wrongly for most kinds and would need a level-mapping table this app
does not have and has never needed — the tree UI navigates by `hasChildren` + returned `path`,
exactly as this tool does. The returned `kind` is what tells a client it just listed databases,
topics or buckets, which is strictly more information than a tool name could have carried.

One tool also removes the class of error where a client calls `list_schemas` against MySQL, gets an
empty list, and concludes the database is empty.

### 4.3 `describe_table`

SPEC's name, kept.

```go
type describeTableArgs struct {
	ConnectionID string `json:"connectionId"`
	Path         string `json:"path" jsonschema:"Encoded path of the table, view or collection, from list_children."`
	Refresh      bool   `json:"refresh,omitempty"`
}
```

Calls `Tree.Describe(connectionID, path, refresh, nil)`; returns `model.ObjectMeta` as JSON —
columns, primary key, foreign keys, inbound foreign keys, indexes, row estimate, comment. `tabID` is
nil: there is no tab to tag the op-log row to.

Gated on `Caps().Describe`. Redis/Kafka/S3/SQS report false and their adapters already return
`E_UNSUPPORTED` with their own wording (`kafka/caps.go`'s comment: "a stream has no column/PK/FK
metadata"); surface that message rather than inventing one.

### 4.4 `describe_schema`

Not in SPEC's list, added because the method exists, is already cache-backed, and is the single
biggest token saving available to a client about to write SQL.

```go
type describeSchemaArgs struct {
	ConnectionID string `json:"connectionId"`
	Path         string `json:"path" jsonschema:"Encoded path of a database or schema, from list_children."`
	Refresh      bool   `json:"refresh,omitempty"`
}
```

Calls `Tree.SchemaColumns`; returns `[]model.RelationColumns` as JSON. One round trip for every
table and view in a container with its columns — `Adapter.SchemaColumns`'s own documented purpose
(`adapter.go:47-55`). Gated on `Caps().SchemaColumns` (the five SQL kinds).

This is the same instinct `outline_file` embodies in the repo-map server: the cheapest way to see
what something contains without reading all of it.

### 4.5 `run_query`

```go
type runQueryArgs struct {
	ConnectionID string `json:"connectionId"`
	SQL          string `json:"sql" jsonschema:"One statement to run. Not a script — send one statement per call."`
	Path         string `json:"path,omitempty" jsonschema:"Encoded path selecting the database to run against, from list_children. Required for engines with more than one database; ignored by engines with one."`
	MaxRows      int    `json:"maxRows,omitempty" jsonschema:"Rows to return, 1-2000. Default 200. The query still runs in full; this caps what is returned."`
}
```

Builds `adapterhost.ExecuteRequestWire{OpID: uuid.NewString(), ConnectionID, Path, Statements:
[]string{sql}}` and calls `Query.Execute`. That is `Dispatcher.Execute` — literally the method
`case "data:execute"` calls for the console (`dataframe.go:175-182`), so throttling, op-logging,
cancellation, panic recovery and each adapter's read-only wrap all apply with nothing re-implemented.

**One statement per call, deliberately.** Statement splitting lives in the frontend's
`sql-split.ts`; there is no Go splitter, and `CLAUDE.md` forbids hand-rolling a parser when the
requirement can be met without one. A client that sends `a; b` gets the server's own rejection
(pgx's extended protocol refuses multi-statement text), which is a true and legible error.

**Safety properties, all inherited rather than added:**

- The connection's `ReadOnly` flag already forces `BEGIN READ ONLY` and rejects transaction
  escalation (`postgres/console.go:155-180`).
- `ThrottlePerSec` already paces the op (`host.go:168-181`).
- Every call emits `op:start`/`op:end` with the statement text, so it appears in the Operations
  panel — a human can see what the AI ran, after the fact, without opting in.

**Stated limitation, resolved by M3, not by M1.** `Execute` has no LIMIT injection: a
`SELECT * FROM big_table` is fetched in full by the adapter, and `maxRows` only caps the projection.
Adding a Go-side statement rewrite to inject LIMIT would be a SQL parser this phase must not build,
and M3's own row is the EXPLAIN-before-query heavy-query gate that addresses it properly. Say so in
the tool description so a client knows the cap is on the answer, not the work.

### 4.6 Adapter-kind scope: all ten, gated on `Caps`

No kind carve-out, and no "SQL kinds first" phasing. Each tool tests the flag the UI already tests
(§1.6), and an adapter that cannot serve a call already returns `E_UNSUPPORTED` with an
engine-specific message. A hardcoded kind list in `dbmcp` would be a second, drifting copy of
information `Caps` already holds — the exact thing `adapters/adapter.go`'s package doc says `Caps`
exists to prevent.

Net coverage: `run_query` works on 7 kinds, `describe_table` on 6, `describe_schema` on 5,
`list_children` and `list_connections` on all 10.

One thing M2/M3/M5 must plan around, recorded here rather than discovered there: `Caps().SQL` is
true for Mongo and Redis, whose "statements" are a JS-shell method call and a Redis command line.
M2's read/write/DDL classification therefore cannot be SQL-only from the start — SPEC's M2 row
already anticipates this, and §1.6's flag is the evidence for it.

## 5. Result shaping

### 5.1 Metadata: reuse, do not invent

`list_children`, `describe_table` and `describe_schema` marshal `model.TreeNode`,
`model.ObjectMeta` and `model.RelationColumns` with `encoding/json` and return the bytes as one
`TextContent`. These are the exact structs the frontend receives, with the same field names, so the
MCP view and the schema explorer's view can never disagree about a column's type — `RelationColumns`
reuses `ColumnMeta` for precisely that reason (`model/tree.go:87-97`).

Compact JSON, no prose wrapper and no human formatting. The client is a model composing SQL against
identifiers that can contain spaces, quotes and non-ASCII; JSON round-trips them exactly and a
rendered table would not. This is a deliberate divergence from the repo-map server's prose output,
whose answers are positions and source lines, not identifiers to be re-emitted verbatim.

`Router` already normalises nil slices to `[]` on all three paths (`router.go:163`, `:185`, `:235`),
so no extra normalisation is needed here.

### 5.2 Query results: a projection, because no JSON row shape exists

Rows cross to the frontend as FlatBuffers (`page/encode.go`, `page/wire`); `page.Chunk` is three
packed buffers plus a NULL bitset (`chunk.go:24-48`). There is no existing JSON row DTO to reuse, so
`dbmcp/render.go` owns one projection per page kind, reading cells through the existing
`page.CellText`/`page.IsNull` accessors:

```json
{"kind":"tabular","columns":[{"name":"id","dataType":"int4","typeClass":"number"}],
 "rows":[["1"],[null]],"rowCount":2,"returned":2,"truncatedCells":0}
```

- `TabularPage` → `columns` (name, dataType, typeClass — `nullable`/`isPrimaryKey` are always
  `true`/`false` for a console result and carry no information, `postgres/console.go:96-104`) plus
  `rows` of JSON strings, `null` for SQL NULL.
- `DocumentPage` → `{"kind":"document","documents":[{"id":…,"body":…}]}` — body is already EJSON
  text.
- `KeyValuePage` → `{"kind":"keyvalue","redisType":…,"ttlMs":…,"memoryBytes":…,
  "entries":[{"field":…,"value":…}]}`.
- `StreamPage` → `{"kind":"stream","messages":[{"key":…,"timestamp":…,"headers":…,"attrs":…,
  "body":…}]}` — reachable only if a future kind gains `Caps().SQL`; implement it rather than
  panicking on the fourth arm of a type switch.

`rowCount` is the page's own count, `returned` is what survived `maxRows`; when they differ, add
`"truncated": true`. `truncatedCells` is `TabularPage.TruncatedCells` — cells the builder cut at
`page.MaxCellBytes` (64 KiB) — surfaced so a client never treats a clipped value as complete.

**The NULL-versus-empty-string distinction is the one thing that is easy to get silently wrong**: a
NULL row and an empty string both have `Offsets[i] == Offsets[i+1]`, and only the `Nulls` bitset
separates them (`chunk.go:35-38`). §8 puts a test on exactly this.

### 5.3 Errors

Follow `repomap/tools.go:11-24`'s split, which is the SDK's own contract:

- Caller-correctable (unknown connection id, connection not exposed, unsupported for this kind,
  a server-side query error) → `CallToolResult{IsError: true}` with the adapter's own message
  verbatim and its `E_*` code. `adapters.CodeOf` (`errors.go:44`) extracts it.
- A genuine internal fault → a Go `error`.

A disconnected connection that also misses the metadata cache surfaces
`ipcerr.Disconnected(name)`'s existing text, prefixed with what the client can do: name the
connection and say it must be connected in Kira Studio, or that `run_query` will connect it (§6.3).

## 6. Scope, settings, lifecycle

### 6.1 Per-connection scoping, designed in rather than retrofitted

SPEC's M2 row and v1.6's unlanded P67d row are the same lesson twice: the repo-map toggle shipped
scoped to one working directory and P67d exists to make it general with a per-repo access list. M1
does not repeat it.

- New column: `0019_m1_connection_mcp.sql` —
  `ALTER TABLE connections ADD COLUMN mcp_enabled INTEGER NOT NULL DEFAULT 0;`
  A plain column with a non-NULL default, the `0004`/`0005` precedent, no rebuild-and-swap.
  First-class rather than an `options_json` key for `0005`'s own stated reason, which applies with
  more force here: `options` round-trips through the connection URI and the Copy URI menu item, and
  an access grant must not be settable — or clearable — by pasting a URI.
- `ConnectionFields.McpEnabled bool` (`json:"mcpEnabled"`), and `mcpEnabled: z.boolean()
  .default(false)` in `connectionFieldsSchema`. `.default` is load-bearing exactly as
  `autoExplain`'s is: an older stored row has no such key.
- **Deny by default.** Every tool resolves the connection and refuses unless `McpEnabled` is true;
  `list_connections` omits it entirely.
- M2 relocates the control into its new MCP tab and adds the three permission modes beside it. M1's
  column is the one it extends, not one it replaces.

### 6.2 Settings surface

A new `Database MCP` section in `SettingsDialog.vue`'s `sections` array, holding a near-copy of the
`Code intelligence` block (`:865-935`): an instant-action toggle (not part of the draft/Save flow —
it both persists and starts/stops the server in one call), then the registration command, then
`Register with Claude Code` / `Regenerate`, in that DOM order, per §11.4's "enabling is never a
silent action".

Below it, the allow-list: one checkbox per connection from `connectionsState.records`, writing
through the existing `connections.Update` path. Put it here rather than in `ConnectionDialog.vue`
for two reasons — it is the shape P67d prescribes for the same problem on the repo-map side, and it
keeps M1's entire `.vue` footprint inside one `<template v-else-if>` block in one file, which
matters for M1ab (SPEC picked M1 for the A/B precisely because it has no meaningful Vue surface, and
`.vue` files are a confirmed repo-map blind spot).

New settings leaf, mirroring `codeIntel` exactly: `model.DbMcpSettings{ServerEnabled bool}`,
`DbMcpPatch`, `DefaultSettings` entry, `dbMcp.serverEnabled` in `repos/settings.go`'s `leaf` reader
and patch writer, and `dbMcpSettingsSchema` in `packages/shared/domain/settings.ts` with
`.default({serverEnabled: false})`.

The `Code intelligence` block also gains one line: the repo-map token's expiry, or
`expired — regenerate`, from `RepoMapStatus.ExpiresAt`. Without it the retrofit is a silent trap.

### 6.3 Connecting on demand

Metadata tools need no live connection when the cache answers (§1.4); on a miss, and always for
`run_query`, a live adapter is required.

**`run_query` connects on demand, via `Conns.Connect(id)`; metadata tools do not.** Rationale:
exposing a connection to MCP (§6.1) is the human's explicit, per-connection consent, and `Connect`
is the same deduplicated path the UI uses (`connections/service.go:548-571`) — it emits state
changes, so the connection visibly comes up in the app rather than opening invisibly. Metadata tools
stay passive: they answer from cache if they can and otherwise say the connection is not connected,
because a browse should never be what starts a pre-connect script.

A `Connect` failure is returned as an error result carrying the connection's own error state text,
not retried.

## 7. Files

New:

| File | What |
|---|---|
| `apps/kira-studio/internal/dbmcp/server.go` | `Config`, `TokenProvider`, `Server`, `New`, `buildMCPServer` (5 `AddTool` calls), `Token`/`SetToken`, `Close` |
| `apps/kira-studio/internal/dbmcp/http.go` | `bindHTTP` (8766 → ephemeral, loopback), `mcpauth.TokenVerifier` mount, `Port`/`URL`/`Serve`/`closeHTTP` |
| `apps/kira-studio/internal/dbmcp/tools.go` | Five input structs and five handlers |
| `apps/kira-studio/internal/dbmcp/access.go` | Connection lookup, `McpEnabled` gate, caps gate, on-demand connect |
| `apps/kira-studio/internal/dbmcp/render.go` | JSON envelopes; `page.Page` → JSON per page kind; error-result helpers |
| `apps/kira-studio/internal/dbmcp/render_test.go` | §8's page-projection test |
| `apps/kira-studio/internal/bridge/dbmcp.go` | `DbMcpService`: `Status`/`SetEnabled`/`Regenerate`/`InstallClaudeCode`, plus unexported `startIfEnabled`/`stop` behind `StartDbMcpIfEnabled`/`StopDbMcp` |
| `apps/kira-studio/internal/storage/migrations/0019_m1_connection_mcp.sql` | `mcp_enabled` column |
| `packages/shared/domain/dbmcp.ts` | `dbMcpStatusSchema`, mirroring `repomap.ts` |

Modified:

| File | Change |
|---|---|
| `internal/mcpauth/token.go` | `Record.ExpiresAt`; `TTL`; `MintTTL`/`Expired`/`LoadOrMintTTL` replacing `Mint`/`LoadOrMint`; stamp-on-load (§2.4); `Check`/`Outcome`/`TokenVerifier`; `PathNamed`; `MkdirAll` in `Save` (§2.6) |
| `internal/mcpauth/token_test.go` | §8's expiry/stamping test |
| `internal/repomap/http.go` | Verifier becomes `mcpauth.TokenVerifier("kira-repo-map", …)`; update the `AllowMissingExpiration` comment per §2.5 |
| `internal/repomap/server.go` | Add `TokenExpiry() time.Time` beside `Token()`, under the same `RLock` |
| `internal/bridge/repomap.go` | `tokenProviderFor` uses `LoadOrMintTTL`/`MintTTL`; `Regenerate` uses `MintTTL`; `RepoMapStatus.ExpiresAt string` |
| `cmd/kira-repo-map/main.go` | `LoadOrMintTTL`; startup print states the expiry date when reusing, and that the old one lapsed when it re-mints |
| `internal/adapterhost/router.go` | Three-line exported `Execute` forwarding to `r.dispatcher.Execute` — the in-process peer of `case "data:execute"` |
| `internal/storage/model/connection.go` | `McpEnabled bool` on `ConnectionFields` |
| `internal/storage/repos/connections.go` | `mcp_enabled` in the shared column list and the scan, and in `Insert`, `Update`, `InsertWithSecret`, `InsertDuplicateWithSecret`, `UpdateWithSecret` |
| `internal/storage/model/settings.go` | `DbMcpSettings`, `DbMcpPatch`, `Settings.DbMcp`, `DefaultSettings` entry |
| `internal/storage/repos/settings.go` | `dbMcp.serverEnabled` leaf read and patch write |
| `apps/kira-studio/main.go` | Construct `dbMcpSvc` beside `repoMapSvc`; `StartDbMcpIfEnabled`; `StopDbMcp` in `teardown`; register in `Services` |
| `frontend/src/bridge/index.ts` | `dbMcpStatus`/`dbMcpSetEnabled`/`dbMcpRegenerate`/`dbMcpInstallClaudeCode` |
| `frontend/src/workbench/SettingsDialog.vue` | New `Database MCP` section + allow-list; one expiry line in `Code intelligence` |
| `frontend/src/state/connections.ts` | `mcpEnabled: false` in `defaultDraft()` |
| `packages/shared/domain/settings.ts` | `dbMcpSettingsSchema`, added to settings/patch/defaults |
| `packages/shared/domain/connection.ts` | `mcpEnabled: z.boolean().default(false)` |
| `packages/shared/domain/repomap.ts` | `expiresAt: z.string()` |
| `CLAUDE.md` | Correct the now-false "a later run reuses it" sentence and the stale re-mint instruction in the Repo-map MCP section (§2.4) |

`frontend/bindings/` is gitignored and regenerated by the Wails build — nothing to hand-write.

## 8. Tests

`CLAUDE.md`'s bar is "no dedicated unit test" by default. Two earn it; nothing else does.

**1. `internal/mcpauth/token_test.go` — expiry, stamping, and the three-way check.** Crypto-adjacent
state with a boundary and a one-shot side effect: exactly-at-`ExpiresAt` must read as expired; a
zero-`ExpiresAt` record must be stamped once and not re-stamped on the next load; `Check` must
return `OutcomeInvalid` (not `OutcomeExpired`) for a wrong token against a lapsed record, so the
expiry instant never leaks to a caller who does not hold the token. Getting any of these backwards
either breaks every developer's registration or weakens the token, and none is visible from reading
the function body.

**2. `internal/dbmcp/render_test.go` — page projection.** Four page kinds, and within `TabularPage`
the NULL-versus-empty-string case that only the `Nulls` bitset distinguishes (§5.2), plus a
truncated cell. A table test over builder-produced pages. This is silently-wrong territory: a
projection that renders NULL as `""` produces valid JSON that a model will reason over incorrectly,
with nothing failing anywhere.

Nothing else:

- Tool registration and cap gating are one- and two-condition guards.
- The migration and the repo column are a CRUD round-trip.
- The settings leaf is a required-field pass-through.
- `bridge/dbmcp.go` is a thin wrapper, and `bridge/repomap.go` — its model — has no test either.
- **No adapter conformance change.** M1 adds no `Adapter` method and changes no adapter behaviour,
  so `adapters/*/*_test.go` is untouched. The exemption in `CLAUDE.md` is for per-capability
  coverage of the adapter contract; this phase does not touch that contract.

Fast checks per commit (`go build ./...`, `go test ./...`, `bun run typecheck`, `bun run lint`).
`go test ./...` also re-runs `internal/layering_test.go`, which is what confirms `internal/dbmcp`
stayed below `internal/bridge`.

## 9. Out of scope, and the seams later phases plug into

Out of scope for M1, stated so it stays out entirely rather than half-built:

- Per-operation permissions and the prompt-for-approval flow — M2. M1's only gate is the
  per-connection on/off of §6.1, plus the connection's existing `ReadOnly` flag.
- `explain_query` and heavy-query flagging — M3. §4.5's uncapped fetch is M3's problem, named there.
- Faker and anonymization — M4/M5. `run_query` returns real values in M1; M5 inserts its filter
  between `Query.Execute` and `render.go`'s projection, which is why that projection is a separate
  file with a single entry point.
- Writes/DDL via MCP are *possible* in M1 on a connection that is not read-only, because
  `Execute` permits whatever the adapter permits. That is the honest state of it: M1 adds no
  write-specific gate, and M2's row exists to add one.
- No mutation of `list_connections`'s output for M2's description field — the struct is M1's, the
  field is M2's.

Seams, named so M2-M5 do not have to rediscover them:

| Later phase | Seam |
|---|---|
| M2 permissions | `dbmcp/access.go`'s gate, and `connections.mcp_enabled`'s own migration/column pattern for three more mode columns |
| M2 description | `list_connections`'s response struct in `dbmcp/render.go` |
| M3 EXPLAIN | A sixth `AddTool` in `buildMCPServer`, over the same `QueryRunner` |
| M4 Faker | A seventh `AddTool`; no query path involvement |
| M5 anonymization | Between `Query.Execute` and `render.go`'s page projection — one call site |

## 10. Order and sizing

### 10.1 Implementation order

Order matters: the Go side must compile and pass before any frontend file is touched, so an M1ab
arm that runs long has a clean stopping point.

1. `mcpauth`: record shape, TTL API, stamping, `Check`/`TokenVerifier`, `PathNamed`, `MkdirAll`,
   test. Update the three existing call sites and `repomap/http.go`. Green `go build ./...`.
2. Migration + `ConnectionFields.McpEnabled` + `repos/connections.go` + settings leaf.
3. `Router.Execute` seam.
4. `internal/dbmcp`: server, http, access, render (+ test), tools.
5. `bridge/dbmcp.go` + `main.go` wiring.
6. Frontend: zod schemas, `bridge/index.ts`, `SettingsDialog.vue`, `defaultDraft()`.
7. `CLAUDE.md` sentence fix.
8. Full `go test ./...` + `bun run typecheck` + `bun run lint`.

Commits land per numbered step, Conventional Commits, `feat(dbmcp):` / `feat(mcpauth):` /
`docs(mcp):`.

### 10.2 One pass, not a split

One Sonnet pass. The work is one continuous, order-dependent thread: the tool signatures in step 4
depend on the seams in steps 2-3, and steps 5-6 are pure consequence of step 4's exported shapes. A
second subagent would start cold and have to re-derive them from the tree, which is the exact cost
`CLAUDE.md` warns against ("never split one continuous, order-dependent piece of work across
subagents to run it concurrently"). The v1.6 splits it would be imitating were not this shape:
P64→P64b/P64c split along independent language extractors, C5→C5/C6 along two separable features.

Size is real but not the kind that forces a split — 9 new files, 19 edits, of which 11 are one- to
five-line mechanical additions.

If an arm does run out of room, the seam is **after step 5**: the Go server is then complete,
wired, testable over curl per `CLAUDE.md`'s own headless technique, and only the Settings surface
remains. Do not split anywhere else.

## 11. Dogfooding note

The repo-map MCP server was used for navigation throughout this planning pass, started per
`CLAUDE.md`'s headless steps (`bun run mcp:repo-map:build`, `bun run mcp:repo-map`, then
`tools/call` over curl — the native tool surface does not appear in an agent-harness session, as
that section documents).

Used for: locating every `Execute` across the tree in one call (`search_symbols`, 25 hits across
adapters, adapterhost and the frontend — the call that established §1.3's routing), outlining
`internal/connections/service.go`'s 42 declarations without reading its 692 lines, reading
`mcpauth.LoadOrMint`'s declaration exactly (`read_symbol`), finding all three `mcpauth.Path` call
sites (`find_references`, §1.2), and locating `state/connections.ts` by path fragment
(`search_files`). It did real work; the outline and reference calls in particular replaced whole-file
reads.

Two observations:

1. **Non-trivial — the server will not start when `$KIRA_HOME` does not exist.** First
   `bun run mcp:repo-map` in this container exited 1 with
   `mcpauth: write /root/.kira-studio/mcp-repo-map-fc694cca06c3-token.json: … no such file or
   directory`. `mcpauth.Save` writes without creating the parent directory (`token.go:94`). Worked
   around here by `mkdir -p`; not fixed in this pass, per the log's own rule. M1 fixes it as part of
   the `mcpauth` work it already owns (§2.6) — noted so the log entry and the fix do not collide.
2. **Trivial, and by design.** `find_references` with `file` + `symbol` (`token.go`, `Path`)
   returned 10 hits, 6 of them unrelated `fd.Path()` calls in `internal/grpcclient` — the `file`
   hint narrows which symbol is *resolved*, not which results are returned. The server's own
   instructions already say results are name-resolved, not type-resolved, so this is the documented
   contract rather than a defect. Worth knowing before trusting a reference count.
