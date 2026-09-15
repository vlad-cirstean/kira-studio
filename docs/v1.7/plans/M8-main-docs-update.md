# M8 — Update main docs for v1.7

Last plan of the v1.7 chapter. Brings `README.md`, `docs/ARCHITECTURE.md`,
`docs/DEV_ENVIRONMENT.md` and `CLAUDE.md` current for everything v1.7 (M1-M7) shipped.

Documentation-accuracy pass, not a rewrite. Every item below is a specific wrong or missing
statement found by reading the current tree, with the current text quoted and the replacement
stated. Text that is already correct stays untouched, including text that reads oddly.

Same bar v1.6's own P70 used (`docs/v1.6/plans/P70-main-docs-update.md`) — read the current tree,
don't trust prose, including this plan's own prose. This plan was written against `704dda62`.

## 0. Chapter state, verified

Every v1.7 SPEC row's disposition, checked against `git log` on `v1.7` (`cfb87a8b..HEAD`, 112
commits), not SPEC prose:

| Row | Landed | Evidence |
|---|---|---|
| M1 (plan-only) | yes | `be6969f8` plan; `50d27015` `mcpauth` 7-day rotation |
| M1ab | yes | `2aceae9b`..`34d713d5` arm A, `c247b0cc`/`cecb88d7` fixes, merged `ae3b590e` |
| M1c | yes | `db228878` plan, `f453ee37`..`c08f6cc5` |
| M2 | yes | `0eeae704` plan, `8112097d`..`ef2ed03b`, migration `0021` |
| M3 | yes | `ca853cd5` plan, `95ede279`..`23a1a80d`, migration `0022` |
| **M4** | **no — descoped, never shipped** | `1b92baf8` plan kept; `aedb799f` descopes it. The four goja-bridge commits (`55229696`..`ca8b2e02`) are **not** in `cfb87a8b..HEAD` — verified, they were discarded, not merged |
| M5 | yes | `dcaf4bb7` plan, `f22cc301`..`4aba9458`, migration `0023` |
| M6 | yes | 19 fix commits `accaadf8`..`67b21707`, closed `7a2772a0` |
| M7 | yes | 33 fix commits `5ff00d57`..`7a69a8c5`, closed `704dda62` |

**M4 never shipped — none of the four docs may describe a Faker-MCP bridge as present.** No
`generate_fake_data` tool exists; `internal/dbmcp/server.go`'s `buildMCPServer` registers exactly
six tools and no goja package is in the tree. Grep all four files for `faker`, `goja` and
`generate_fake_data` before finishing: at `704dda62` the only hit is `README.md`'s Api-features
"Faker-backed dynamic values" bullet (line 139) and its Studio "Generate data…" bullet (line 115),
both of which describe the **frontend's** own pre-existing `@faker-js/faker` use and are correct —
leave both untouched. If any new hit appears, it is wrong and must go.

**Two genuinely open items exist and are already correctly recorded — not this plan's scope.**
Confirmed live in `docs/ARCHITECTURE.md`'s "Known open items" during this planning pass:

- **M5's correlation-tag chosen-plaintext oracle** (lines 3715-3726), from M6 round 1. Accurate as
  written, including its "accepted, not a defect to fix" reasoning and the threat model it names.
- **The dbmcp bearer token reaching `claude mcp add` in plaintext argv** (lines 3905-3914), from
  M6 round 1. Accurate, including the verified-against-the-real-CLI finding that `-H/--header`
  takes only a literal value.

Confirm both are still present and still true, then leave them alone. M8 re-litigates neither; its
job is the rest of the docs-accuracy sweep. Two further v1.7-era entries in the same section
(`internal/ipcfixture` golden-fixture staleness, lines 3694-3703; `maskedColumnRenamedOrHidden`'s
view-definition blind spot, lines 3706-3712) were also checked and are accurate — likewise leave.

**Everything else is landed.** Once M8's commits land, nothing in `docs/v1.7/SPEC.md` remains
unimplemented.

## 1. `README.md`

Outward-facing prose, the one file `CLAUDE.md`'s terse style exempts — keep normal prose here.

P70 left this file in good shape for v1.6. Its drift is therefore **almost entirely additive**:
v1.7's whole subsystem has no README presence at all, and the chapter pointers still name v1.6 as
live. Very little existing text is wrong.

### 1.1 Line 12-20 — Status names v1.6 as the current chapter

Current (the tail of the first Status bullet):

> v1.5 added a native code
> intelligence workspace inside Kira Studio's own window — import a repository, browse and diff its
> files, navigate its code — and v1.6 (the current chapter) made **git** a full peer of
> **Studio**/**Api** (its own mode, its own native graph and code-review layer) and enabled real
> git-write operations from that native surface.

Replace `v1.6 (the current chapter)` with plain `v1.6`, and append one sentence for v1.7 as the
current chapter: a second local MCP server that exposes a chosen connection's data to an AI client
under per-connection read/write/DDL permissions, with per-column PII masking. Keep the existing
"The VS Code extension remains a fully supported second frontend" sentence and the
"Expect bugs and breaking changes" sentence that follow, unchanged.

### 1.2 Studio features — per-column PII masking has no bullet

The section (lines 80-129) never mentions masking, which is a user-facing grid feature, not an
MCP-only one. Add one bullet after the **Mutations (SQL grid)** bullet (line 97-98), matching the
surrounding bullets' style and depth:

- **Column masking (PII)** — mark a column as PII from its own grid header menu (`Mark column as
  PII`, `views/grid/menu.ts:619`) with one of six masks — name, email, text, number, date or full
  redact — and a toolbar toggle previews the masked view live over the real rows
  (`views/grid/DataToolbar.vue`'s `toolbar-mask-preview`). Display-layer only: the underlying rows
  are never mutated, and the grid goes read-only while the preview is on. Rules are managed per
  connection in the connection dialog's **Privacy** tab.

Verify each claim against the tree before writing it — in particular that the six kinds are
name/email/text/number/date/redact (`internal/mask/mask.go:34-39`; there is **no** `id` kind, it was
dropped mid-M5) and that the edit lockout is real (`DataToolbar.vue:60-67`, 113, 126-130).

### 1.3 New section after "Code intelligence features" — the database MCP server

v1.7's whole subsystem has no README presence. Insert a new **"Database MCP features"** section
after the Code intelligence section ends (after line 175, before `## Git features`), matching the
existing sections' bullet style and depth. Cover what actually shipped, each claim read off the
tree:

- **A second local MCP server** — separate from the repo-map one: its own process-lifetime
  instance, its own loopback port (`internal/dbmcp`, `DefaultPort` **8766**, ephemeral fallback),
  its own bearer token. Off by default; enabled from **Settings → Database MCP**, which shows the
  registration command before its Install button, same as Code intelligence.
- **Six tools** — `list_connections`, `list_children`, `describe_table`, `describe_schema`,
  `run_query`, `explain_query` (`internal/dbmcp/server.go:202-224`). Note that `run_query` executes
  through the same adapter path the app's own SQL console uses. **Do not write
  `list_databases`/`list_schemas`** — `docs/v1.7/SPEC.md`'s M1 row names those, but the shipped tool
  is the single `list_children`; the tree wins.
- **Deny by default, per connection** — a connection is invisible to an AI client until its owner
  exposes it (`connections.mcp_enabled`, migration `0020`).
- **Per-operation permissions** — read, write and DDL each independently *allow*, *deny* or
  *prompt*, per connection, edited in the connection dialog's **MCP** tab. Defaults, read off
  migration `0021`: read **allow**, write **prompt**, DDL **deny**. A statement is classified before
  it runs (`internal/adapters/classify.go`), and a statement the classifier can't read falls to the
  strictest of the three modes rather than through the gate.
- **Human approval for `prompt`** — the query is not run until a person approves the actual
  statement text in a modal dialog (`workbench/DbMcpApprovalDialog.vue`).
- **EXPLAIN** — `explain_query` returns the same normalized plan the console renders (SELECT/WITH
  only). A per-connection auto-explain plans every eligible `run_query` first, and a plan estimated
  over the expensive-query row threshold pauses for the same human approval.
- **Masking over MCP** — the per-column rules from §1.2 are applied to results before an AI client
  sees them, with a keyed correlation tag so two rows holding the same real value are recognizably
  the same without the value being exposed or recoverable.

State plainly in this section that **DDL is denied by default and only executes if a person allows
it per connection.** That is what keeps this section from reading as a contradiction of the
"Not shipped" list's own `DDL editing` entry (line 461) — which stays untouched, since it is about a
DDL-editing UI in Studio, not about MCP. Do not edit the "Not shipped" list for this.

### 1.4 Line 321-327 — the app-data list is missing the DB MCP token

Current:

> **App data:** the app keeps `kira.db`, `logs/`, the git module's own `review.db`, `codeindex.db`
> (plus its `-wal`/`-shm`), its `git.sock`/`git.sock.lock`, the per-repository sync flocks
> `codeindex-sync-<12 hex>.lock`, and the repo-map MCP tokens `mcp-repo-map-*-token.json` under
> `~/.kira-studio/`.

Missing the DB MCP server's own token file. `bridge/dbmcp.go:22` names it `mcp-db`, and
`mcpauth.PathNamed` (`token.go:135-137`) appends `-token.json`, so the file is **`mcp-db-token.json`**
— one per `KIRA_HOME`, with no slug, unlike the repo-map family. Add it to the list. The
`KIRA_HOME` sentence after it is still correct and stays. Keep this list identical to §2.3's.

### 1.5 Line 395 — the layout block's `internal` line predates five packages

Current:

> ```
> apps/kira-studio/internal        the Go app: adapters, storage, IPC bridge, tree service, connection state, ops, git, code intelligence (codeparse/codeindex/codegraph/codeworkspace/repomap), the update checker
> ```

Five packages that now exist are unnamed: `dbmcp`, `mask`, `maskrules`, `queryplan` and `mcpauth`
(the last predates v1.7 but was never listed). Extend the line to name the database MCP group
alongside the code-intelligence one. Keep it one line, matching the block's existing shape.

### 1.6 Line 410 — the layout block points at the previous chapter

Current:

> `docs                 architecture, performance, packaging, design system; docs/v1.6 is the live record`

→ `docs/v1.7 is the live record`.

### 1.7 Line 414-420 — the chapter pointers make v1.6 live

Current:

> See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full current-state breakdown, and
> [`docs/v1.6/SPEC.md`](docs/v1.6/SPEC.md) for the live chapter. Earlier chapters, oldest first:

`docs/v1.7/` is the live chapter. Point the "live chapter" link at `docs/v1.7/SPEC.md` and move
v1.6 into the "Earlier chapters, oldest first" list, after v1.5, with its own one-word gloss
matching the others' style (the existing list already glosses each: Studio, Api, the headless git
backend, reliability/tooling polish, code intelligence).

### 1.8 Line 431-437 — the Documentation list makes v1.6 live

Current:

> - [`docs/v1.6/`](docs/v1.6/) — **the live chapter** (see `docs/v1.6/README.md`): editor
>   consolidation onto Monaco, a dependency/runtime upgrade, native git-blame, and the repo-map MCP
>   server. [`SPEC.md`](docs/v1.6/SPEC.md) and [`plans/`](docs/v1.6/plans/), one implementation plan
>   per phase.

Add a new `docs/v1.7/` entry above it, marked **the live chapter**, glossed as the local database
MCP server with per-connection permissions, an EXPLAIN path and per-column PII masking; then demote
the v1.6 entry to "the completed editor-consolidation/tooling chapter's own phasing record", keeping
its existing gloss text otherwise intact and matching the v1.5/v1.4 entries' wording shape.

`docs/v1.7/README.md` exists — confirmed — so the `(see …/README.md)` parenthetical is honest.

### 1.9 Verified correct — leave alone

Each checked during this planning pass; none is a change:

- Line 5-8's three-module intro. The MCP servers are not a fourth `AppMode` — `AppMode` is still
  `'studio' | 'api' | 'git'`. Leave.
- Lines 115-116's "Generate data…" bullet and 139-141's "Faker-backed dynamic values" bullet. Both
  describe the frontend's own `@faker-js/faker` use, which M4's descoping never touched (§0).
- Lines 126-129's Settings bullet, which enumerates only the draft/Save sections and already omits
  the instant-action ones (Connected editors, Git, Code intelligence). Database MCP is likewise
  instant-action, so its absence there is consistent, not drift. Do not add it.
- Lines 172-175's repo-map MCP server bullet. Still accurate post-M1: enabling per repository from
  Settings → Code intelligence, command shown before the Install button.
- Line 251-255's Requirements bullet. No MCP client is required to build or run the app.

## 2. `docs/ARCHITECTURE.md`

Well maintained where M6/M7 touched it — the Known open items section is current (§0). The gap is
different in kind: **the whole v1.7 subsystem is documented nowhere except as open items.** Grep
during this planning pass found no heading, and no descriptive paragraph, for `dbmcp`, masking,
statement classification or `queryplan`. Most of §2 is therefore additive; the find/replace items
are few and small.

### 2.1 Line 11-13 — the chapter list stops at v1.6

Current:

> Where this file and any chapter's `SPEC.md` disagree (`docs/v1/`,
> `docs/v1.1/`, `docs/v1.2/`, `docs/v1.3/`, `docs/v1.4/`, `docs/v1.5/`, `docs/v1.6/`), **this file is
> authoritative for behavior**

Add `docs/v1.7/` to the list.

### 2.2 Line 52 — the Stack table's MCP row is scoped to one server

The row's Concern cell reads `MCP server (C3)`. One SDK choice now carries two servers
(`internal/repomap` and `internal/dbmcp`, both on `go-sdk/mcp` + Streamable HTTP + the SDK's own
`auth.RequireBearerToken`). Two edits inside this row, nothing else:

- Concern cell → `MCP servers (C3, second server M1)`.
- The measured binary-size sentence reads *"**+12.38 MB** (`linux/amd64`, unstripped) for
  `internal/repomap`, `internal/mcpauth`, `internal/mcpinstall` and the SDK's own dependency
  graph"*. That number was measured at C3 and is not re-measured here — `CLAUDE.md`'s own
  measure-when-a-question-is-at-stake rule: the SDK and its dependency graph were already linked in,
  so `internal/dbmcp` adds app code, not a new dependency tree, and a fresh whole-binary comparison
  would not change any decision. Add one clause marking it as C3's measurement of the SDK's own
  arrival, and say `internal/dbmcp` reuses that same already-linked graph. Do not silently re-assert
  the figure as covering both servers, and do not delete it.

### 2.3 Line 602-605 — the `~/.kira-studio/` summary misses the DB MCP token

Current:

> `~/.kira-studio/` (dir `0700`), containing `kira.db` (`0600`), `logs/`, the git module's own
> `review.db`, `codeindex.db` (plus its `-wal`/`-shm`), `git.sock`/`git.sock.lock`, the
> per-repository sync flocks `codeindex-sync-<12 hex>.lock`, and the repo-map MCP tokens
> `mcp-repo-map-*-token.json` — each covered in its own paragraph below.

Add `mcp-db-token.json` (the DB MCP server's own token, one per `KIRA_HOME`, no slug — §1.4). Keep
identical to README §1.4's list.

### 2.4 Line 565-567 — the `connections` schema block is seven columns behind

Current:

> ```
> connections(id, name, kind, color, mode, read_only, host, port, database, username, password,
>             uri, options_json, preconnect, preconnect_sidecar, auto_explain, throttle_per_sec,
>             created_at, updated_at, sort_order)
> ```

Seven columns added by v1.7, read off the migrations rather than any summary:

| Column | Migration | Default |
|---|---|---|
| `mcp_enabled` | `0020_m1_connection_mcp.sql` | `0` |
| `mcp_description` | `0021_m2_connection_permissions.sql` | `''` |
| `mcp_read_mode` | `0021` | `'allow'` |
| `mcp_write_mode` | `0021` | `'prompt'` |
| `mcp_ddl_mode` | `0021` | `'deny'` |
| `mcp_auto_explain` | `0022_m3_connection_mcp_explain.sql` | `1` |
| `mask_correlation_key` | `0023_m5_column_mask_rules.sql` | `''` |

Add all seven to the column list, with a trailing comment in this block's own established style
naming the migration and the defaults, and one clause for `mask_correlation_key`: a `kira:v3`
envelope under the `mask-key` secret scope, read and written only by `MaskKeysRepo`, deliberately
absent from `ConnectionFields` — all four facts stated in `0023`'s own header comment, which should
be read directly rather than copied from here.

### 2.5 Same schema block — `connection_mask_rules` is missing entirely

`0023` creates a table the block never lists. Add it beside `connection_ddl` and
`connection_tree_filters` (its natural neighbours — per-connection auxiliary tables), in the block's
own style:

```
connection_mask_rules(id, connection_id, table_name, column_name, mask_kind, keep_hint,
                       correlate, created_at, updated_at)
```

with a trailing comment covering, all read off `0023`: M5/migration `0023`; `connection_id` ON
DELETE CASCADE; `table_name` `'*'` matches any table while matching itself is by column name alone;
`mask_kind` is one of `name|email|text|number|date|redact`; uniqueness is case-insensitive
(`lower(table_name)`, `lower(column_name)`); `correlate` is forced `0` for `number`, enforced in
`internal/mask.Apply` regardless of the stored flag. Say **why it is a table and not an
`options_json` key** — `0023`'s own reasoning, that `options` round-trips through the connection URI
and the Copy URI menu item, so a privacy rule must not be settable or clearable by pasting a URI.

### 2.6 Line 667-668 — the migration high-water mark is four behind

Current:

> `kira.db` is at migration **0019** as of P67d (`0019_p67d_repo_map_access.sql`) — `code_repos.
> mcp_enabled` on top of C5's `code_repos` plus `tabs.workspace_id` (above).

The directory's last file is `0023_m5_column_mask_rules.sql`. Rewrite: `kira.db` is at migration
**0023** as of M5, listing `0020`-`0023` and what each added, in one sentence each, per the table in
§2.4. Keep the existing P67d clause as the prior entry rather than deleting it.

### 2.7 Line 1078-1084 — the repo-map token paragraph predates the 7-day TTL

Current (inside the repo-map MCP server section):

> the embedded
> instance now mints/loads **one app-scoped token** covering every granted repository
> (`mcp-repo-map-app-token.json`, `mcpauth.Path(home, "app")` — an explicit enable uses
> `mcpauth.LoadOrMint`, not an unconditional fresh `Mint`, since one registration now covers every
> grant and a toggle-off-and-on must not silently invalidate it; the explicit Regenerate action is
> the one way to force a fresh one)

Two errors. (a) `mcpauth.LoadOrMint` is not the function called any more —
`bridge/repomap.go:357` calls **`mcpauth.LoadOrMintTTL(…, mcpauth.TTL)`**. Verify the current
spelling before quoting it. (b) The paragraph never mentions that every token now expires. M1
(`50d27015`) gave `mcpauth` a fixed **7-day** TTL (`mcpauth.TTL`, `token.go:39`) applied uniformly
to **both** servers, with `Record.ExpiresAt` zero meaning "not yet stamped" so a pre-M1 file on disk
is stamped on load with no migration and no file-format version.

Add one sentence covering the retrofit and one covering what a client sees when a token has lapsed:
`mcpauth.TokenVerifier` returns a distinct, actionable message naming the server
(`"kira-repo-map"` or `"kira-db"`) and the expiry instant, not a bare 401 — read `token.go:116-133`
and quote the real behaviour, not this summary. Rotation happens only at a moment a human can read
the fresh plaintext: server start, or an explicit Regenerate. Never mid-flight.

### 2.8 Line 1093-1098 — the registration paragraph names only one tab

Current:

> **Registration is Claude Code CLI only** (`internal/mcpinstall`, `claude mcp add --transport http
> --scope user <name> <url> --header "Authorization: Bearer <token>"`, verified against the real
> CLI): the Settings dialog's Code intelligence tab shows the command before its Install button,
> never the reverse […]

Still true for repo-map, and this sentence sits in the repo-map section, so it is not wrong. Add one
clause only: `internal/mcpinstall` is reused as-is by the DB MCP server's own Settings section
(`bridge/dbmcp.go` takes the same `RepoMapInstaller` interface rather than declaring a second,
identical one), which shows its own command before its own Install button the same way. Keeps the
"no second mechanism" fact discoverable from the section a reader lands in first.

### 2.9 New top-level section — the database MCP server has no home

**This is the bulk of M8's ARCHITECTURE work.** Add one new top-level `## Database MCP server
(v1.7)` section. Place it immediately before `## Renderer security surface` (line 3413) — i.e.
after `## Git module (v1.3)` and its subsections end, as a peer of `## Git module (v1.3)`, not
nested inside `## Storage` the way the code-intelligence sections are. That placement is chosen
deliberately: unlike `codeindex`, this subsystem did not begin as "a third SQLite file", so it has
no reason to inherit that section's history.

Write it as subsections, each stating what the code does with the file/symbol it does it in. Read
every one of these off the tree while writing — this plan names where to look, not what to say:

- **`### The server (M1)`** — `internal/dbmcp`, a second, separate instance of the same pattern
  `internal/repomap` uses (`go-sdk/mcp`, loopback-only Streamable HTTP, `mcpauth` bearer token),
  never a mode of the existing one. `DefaultPort` **8766**, adjacent to repo-map's 8765, with the
  same OS-assigned-ephemeral fallback on conflict (`http.go:37-43`). Say why they are two servers
  and not one: the two serve unrelated graphs (code structure vs. live query execution) with very
  different trust postures — repo-map is read-only by construction, this one can write and run DDL
  by design. One token file, `mcp-db-token.json`, no slug, because one instance exists per app
  process per `KIRA_HOME` (`bridge/dbmcp.go:22-25`). Lifecycle is `bridge.DbMcpService` — the
  server is constructed and started when the Settings toggle turns on (or already is, at boot) and
  stopped when it turns off or the app quits; the `ApprovalBroker` is constructed once in `main.go`
  and **outlives** the server's own start/stop, so the boot-time event subscription stays valid
  across a restart.
- **`### The six tools`** — `list_connections`, `list_children`, `describe_table`,
  `describe_schema`, `run_query`, `explain_query` (`server.go:202-224`). One line each. State that
  metadata routes through the existing `internal/adapters` layer and `run_query` through the same
  adapter query path the console uses (`adapterhost.Router.Execute`, exported for this at
  `ee98b26d`) — no second metadata or query path exists. Note M7's fix that the four
  schema-browsing tools are gated on read-mode deny (`21e5d77d`), not only `run_query`.
- **`### Permissions and statement classification (M2)`** — the three independent modes per
  connection and their defaults (§2.4). `internal/adapters/classify.go`: `OpClass` is
  `read|write|ddl|unknown`, exposed through an **optional** `StatementClassifier` interface, not a
  required `Adapter` method; `ClassifySQL` is shared by the five SQL kinds; Mongo and Redis reuse
  their own existing statement/command inspection; Kafka/S3/SQS are unreachable via `run_query` and
  deliberately unimplemented. State the gate order in `run_query` exactly as `tools.go` has it —
  refuse before connecting if all three modes deny, connect, classify, verdict, execute — and the
  two properties that make it safe: a classifier error degrades to `unknown` and never bypasses the
  gate, and `unknown` resolves to the **strictest** of the three modes. Record the two bypasses M6
  and M7 closed here, because both are the kind of thing a future change re-opens: comment
  stripping had to become quote- and dollar-quote-aware (`accaadf8`), and MySQL/MariaDB's
  `/*! … */` executable-comment syntax had to stop being stripped as a real comment (`16ea4f89`).
- **`### The approval flow`** — `internal/dbmcp/approval.go`'s `ApprovalBroker`, modeled on
  `internal/gitsock`'s own FIFO broker: a client disconnect stops the wait via `ctx`, with no
  external expiry ticker. The UI is `workbench/DbMcpApprovalDialog.vue`, a modal mounted beside
  `GitPairingDialog`. `Reason` is `"permission"` or `"heavy"`, and at most one prompt is raised per
  call when both apply.
- **`### EXPLAIN (M3)`** — `internal/queryplan` is a **Go port** of the frontend EXPLAIN parser, not
  a language bridge, pinned against a shared fixture set both `internal/queryplan/parse_test.go` and
  `tests/unit/explain-plan.spec.ts` read, so drift in either port fails on the same bytes.
  `explain_query` refuses anything but SELECT/WITH and refuses unsupported adapter kinds before
  connecting — say why, since it is not obvious: on ClickHouse, `EXPLAIN` can execute its own target
  on some forms, so a DDL/DML statement getting an EXPLAIN path would be a write oracle.
  Auto-force-explain is its own `mcp_auto_explain` column, deliberately **not** the existing
  human-facing `AutoExplain` console flag. The heaviness threshold is the existing
  `advanced.expensiveQueryRows` setting (default 100,000), read per call via
  `bridge/dbmcp.go`'s `explainThreshold`.
- **`### Masking (M5)`** — `internal/mask`: six kinds, `name|email|text|number|date|redact`, and
  **no `id` kind** (dropped mid-implementation; masking is opt-in per column, so an identifier
  nobody marks sensitive is already untouched). Grapheme-aware via `github.com/rivo/uniseg`.
  `Stricter()` folds two rules conflicting on one column. The correlation tag is a keyed HMAC-SHA256
  over the real value, so the same value yields the same tag within a connection — enough for
  cross-row and cross-join correlation, never enough to recover the value; `number` never correlates
  because a bucket is many-to-one. State the two-surface split plainly: the **MCP render path**
  (`internal/dbmcp/render.go`) is the security boundary, and the grid preview
  (`views/grid/maskPreview.ts`) is a *preview*, not a control — the user there already holds the
  real values. Both are pinned to each other by 60 shared Go-generated fixture pairs under
  `tests/fixtures/mask/` that `internal/mask/parity_test.go` and the TypeScript parity spec both
  read. Record the refusals rather than only the transforms, since they are the non-obvious half:
  document/stream pages **refuse** rather than silently skip when rules exist; a masked column that
  is aliased or transformed is refused rather than returned unmasked (`0176243e`, re-opened and
  properly closed by `5ff00d57` for the duplicate-name case); Redis key-value results are masked by
  real field name and refused otherwise (`640e5580`); and raw adapter error text is withheld on a
  masked connection, because a type-cast error embeds the literal it failed on (`1ad96285`).
- **`### The UI surfaces`** — **read the actual components, do not infer.** As of `704dda62`:
  `workbench/SettingsDialog.vue`'s `sections` array (line 119-128) has **eight** entries, and
  **`'Database MCP'` is its own section**, listed after `'Code intelligence'` — it is *not* a part
  of the Code intelligence tab. That section holds the enable toggle, the registration command and
  Install button, the token-expiry line, and a read-only **Exposed connections** glance (per-row
  read/write/DDL modes, auto-explain, and M5's masked-column count) with **no second editor**.
  `project/ConnectionDialog.vue`'s `DetailTab` is now **five** values —
  `'General' | 'Advanced' | 'Pre-connect' | 'MCP' | 'Privacy'` (line 121) — with all permission and
  description editing in **MCP** and all mask-rule editing in **Privacy**. The grid's own two
  surfaces are the header menu's `Mark column as PII` submenu (`views/grid/menu.ts`) and the toolbar
  preview toggle (`views/grid/DataToolbar.vue`).

### 2.10 Testing section — the two Go/TS parity fixture suites are unmentioned

`## Testing` (line 3484+) already documents the Go/TS parity technique elsewhere in the file (lines
1759, 1922-1923, 1964, all citing `tests/unit/go-ts-vocabulary-parity.spec.ts`). v1.7 added two more
instances of exactly that technique and neither is mentioned: the EXPLAIN-plan fixtures
(`internal/queryplan/parse_test.go` ↔ `tests/unit/explain-plan.spec.ts`) and the masking fixtures
(`internal/mask/parity_test.go` ↔ the TypeScript mask-parity spec, over `tests/fixtures/mask/`).

Add one short paragraph naming both, in the Testing section, framed as further instances of the
existing pattern rather than as a new one. Verify both spec paths and the fixture directory exist
under their current names before writing them — `ls` them, do not copy from here.

### 2.11 Known open items — confirm, change nothing

§0 settled this: the section is current, and the two items the M8 brief names are both there and
both accurate. Re-read the section once end to end while working in this file, and delete an entry
**only** if it is verifiably resolved on `704dda62`. This planning pass found none that is. Do not
add a new entry either — a new limitation found while writing docs gets logged, not absorbed (§7).

## 3. `docs/DEV_ENVIRONMENT.md`

### 3.1 New section — the DB MCP server can't be reached the way repo-map can

The file has a whole section on running the repo-map MCP server here and nothing at all on the DB
MCP server, and the difference between them is exactly the sort of thing this file exists for.
Verified during this planning pass:

- `apps/kira-studio/cmd/` holds **only** `g1measure` and `kira-repo-map`. There is **no** headless
  DB MCP binary.
- `package.json` has `mcp:repo-map` and `mcp:repo-map:build` and **no** DB MCP equivalent.

So the DB MCP server exists only inside the app process. Add a short section —
`## Database MCP server — reaching it in this environment (M1-M5)` — placed after the existing
repo-map section (after line 304, before the Playwright/webkit bullet, or as the file's last
section; either reads fine), covering:

- No headless binary and no `bun run mcp:*` script exists for it, unlike repo-map. The only ways to
  reach it here are `bun run dev` (needs a GUI this container does not have) or a
  `go build -tags server` boot proof — the same `//go:build server` route this file already
  documents at line 245-252 for the bound-call surface. M5's own verification did exactly that and
  drove a real `dbmcp` endpoint with `curl`.
- Its token is `${KIRA_HOME}/mcp-db-token.json` — no repo slug, one per `KIRA_HOME` — and it carries
  the same 7-day expiry as repo-map's since M1.
- Its port is `DefaultPort` **8766** with the same ephemeral fallback, so the read-it-off-the-banner
  rule at line 277-282 applies here too.
- The JSON-RPC `curl` shape is identical to `CLAUDE.md`'s repo-map recipe; only the port, the token
  and the tool names differ. Do not duplicate the recipe — point at it.

Keep it short. This is an environment note, not a second copy of §2.9.

### 3.2 Line 254 — the repo-map section heading's phase span stops before M1

Current:

> `## repo-map MCP server — running and registering it in this environment (C3, updated C8/P64c/P67d)`

M1 changed this server's token behaviour (7-day TTL, `50d27015`), which is exactly what the two
bullets at 272-288 are about. Widen the parenthetical to `(C3, updated C8/P64c/P67d/M1)`, matching
how this file already annotates its other sections.

### 3.3 Line 283-288 — the token bullet predates the 7-day TTL

Current:

> - **A restart cannot recover a token it didn't capture the first time.** `mcpauth` stores only a
>   salted hash (`${KIRA_HOME}/mcp-repo-map-<slug>-token.json`), so a restart prints "Using this
>   repository's existing token" and no token — a session that lost the first printout is stuck, and
>   a mismatched bearer answers `401 invalid token` with no hint the token itself is the problem.
>   Fix: delete that repository's token file and restart, then capture the freshly printed token
>   immediately (`CLAUDE.md`'s mint-a-fresh-one recipe).

Still true and still the right advice — reproduced during this planning pass, which hit exactly this
(a `mcp-repo-map-fc694cca06c3-token.json` left by an earlier session in this container), deleted it,
and got a fresh token on restart. Two additions, no deletions:

- The stuck window is now **bounded**: since M1 every token expires after 7 days, so a stale one
  eventually reminted itself. Deleting the file is how you stop waiting, not the only way out.
- A **lapsed** token is distinguishable from a wrong one: `mcpauth.TokenVerifier` answers with a
  message naming the server and the expiry instant, where a mismatched token still answers a bare
  `401 invalid token`. Worth one clause, since it changes what a `401` here means.

The `${KIRA_HOME}/mcp-repo-map-<slug>-token.json` path in this bullet is correct as written and
stays — it describes the **headless** binary, which still keeps one token file per repository
(`cmd/kira-repo-map/main.go:70`, `mcpauth.Slug(info.RepoID)`). Do not "fix" it to the embedded
instance's `mcp-repo-map-app-token.json`; both exist, by design, and this section is about the
headless path.

### 3.4 Confirm, do not change without checking

- Line 146's `(G1-G34)` heading range. P70 fixed it; verify it still reads `G34`.
- Line 261-267's "~34s cold cgo rebuild" and the few-seconds cold `Sync`. P64c's own measured
  numbers. Re-run or leave; do not silently adjust.
- Line 277-282's ephemeral-port paragraph. Reproduced again during this planning pass — the server
  bound `127.0.0.1:37733`, not 8765, on a container that had no other instance running. Accurate as
  written; leave.
- Line 42's Docker heading and the `packages/db-fixtures/` paths under it. Unchanged by v1.7.

## 4. `CLAUDE.md`

Process file. Small, and the structure is right. v1.7 added no new standing process rule, so this is
a pointer-and-formatting pass, not a content one.

### 4.1 Line 49 — points at the previous chapter

Current:

> - Each phase (the current chapter's `SPEC.md` phasing table — `docs/v1.6/` today) needs an
>   Opus-authored plan committed under that chapter's `plans/` before implementation starts

`docs/v1.7/` is the live chapter, and this same file's own repo-map section (line 209) already says
`docs/v1.7/` today. Self-inconsistent, exactly as it was a chapter ago. Change to `docs/v1.7/`.

### 4.2 Line 209-211 — the wrapping damage P70 flagged is back

Current:

> **Log what dogfooding finds** in the current chapter's own `mcp-repo-map-issues.md` (`docs/v1.7/`
> today). Trivial (config, registration,
> wiring): fix inline, log one line.

The second line breaks after four words — the `docs/v1.6/` → `docs/v1.7/` edit re-broke what P70
§4.4 reflowed. Cosmetic: one reflow to the file's ~100-column width, no wording change. Check the
paragraph's remaining lines while there.

### 4.3 Line 214-216 — the closing scope note names one server

Current:

> Development use only. The shipped end-user surface — the Settings dialog's Code intelligence tab
> — is product, not process; `docs/ARCHITECTURE.md` describes it and how the server works,
> `docs/DEV_ENVIRONMENT.md` covers log level, cleanup and this container's own quirks.

Accurate for repo-map, which is all this section is about. One clause is worth adding and no more:
the app's *other* MCP server (the database one, v1.7) is product too and is **not** this section's
tool — nothing in this file asks a session to run or dogfood it. That distinction is cheap to state
and expensive to rediscover, now that "the MCP server" is ambiguous in this repo. Implementer's
call on exact wording; keep it to one clause, since this file's own rule is to stay lean.

### 4.4 Verified correct — leave alone

- Line 202-207's 7-day token paragraph. Already corrected by M1 (`6a4ca118`) and matches
  `mcpauth.TTL` today.
- "the eight tools" (line 179) and the eight names listed at 152-153 and 197-199. Unchanged by v1.7 — M1c fixed
  `find_references`/`search_symbols` **results**, adding no tool. Confirmed live against the running
  server during this planning pass.
- Line 209's `docs/v1.7/` — already current; only its line wrapping is wrong (§4.2).
- Line 90's library-first examples (`Monaco, zod, sql-formatter and SlickGrid`). All four still
  present. `github.com/rivo/uniseg` (M5) would be a fair fifth, but the list is illustrative and
  already long enough to make its point — **do not add it.** This file's own rule is prune, not
  append.
- Lines 119-133's P25/P26 and adapter-conformance bullets. v1.7 added `adapters/classify_test.go`
  and `dbmcp/*_test.go`, neither of which changes what those bullets say.

## 5. Dogfooding

This planning pass used the repo-map MCP server over the HTTP/JSON-RPC path `CLAUDE.md` §4
describes. A prior session's token file was present, so the documented recipe applied verbatim:
delete `mcp-repo-map-fc694cca06c3-token.json`, restart, capture the freshly printed token. The
server bound an ephemeral port (`127.0.0.1:37733`) rather than 8765 with no other instance running,
and `search_symbols` for `MaskSetFor` returned both hits correctly with their source lines
(`internal/maskrules/service.go`, and the `dbmcp` test fake).

**No new repo-map finding, trivial or non-trivial.** Both frictions hit are already documented —
the token-deletion recipe (`CLAUDE.md` step 2, `docs/DEV_ENVIRONMENT.md` line 283-288) and the
ephemeral-port fallback (same file, line 277-282) — so neither earns a new entry in
`docs/v1.7/mcp-repo-map-issues.md`, which was read first and already carries entries through M5.
That file needs **no edit in this phase**. If the implementing subagent hits something genuinely
new, log it there per that file's own process section; do not log a repeat.

## 6. Verification

No code changes, so no test suite gates this phase. Instead:

1. `bun run lint` — Biome covers Markdown formatting in this repo; run it before each commit.
2. Every file path, symbol name, line number, migration number, default value and commit SHA quoted
   in a replacement must be re-checked against the tree at the moment it is written, not copied from
   this plan. This plan was written against `704dda62`; a line number moves the instant an earlier
   edit in the same file lands, so work each file bottom-up or re-locate by quoted text, never by
   the line numbers here.
3. Grep sweeps after the edits, each with a stated expectation:
   - `-i faker`, `-i goja`, `generate_fake_data` across the four files — only README's two
     frontend-Faker bullets may hit (§0).
   - `list_databases`, `list_schemas` — must return nothing; the shipped tool is `list_children`.
   - `-i "id kind"`, `'id'` near mask kinds — the `id` masking kind must appear nowhere.
   - `docs/v1.6` — every remaining hit must be a deliberate historical citation or the demoted
     completed-chapter entry, never a "live chapter" claim.
   - `8765` / `8766` — every hit must sit beside the read-it-off-the-banner sentence.
   - `LoadOrMint` — must not appear without the `TTL` suffix (§2.7).
4. `grep -c` the six tool names across the four files: each must appear at least once
   (README §1.3, ARCHITECTURE §2.9) and spelled exactly as `server.go` registers it.
5. Read `README.md` start to finish once as a newcomer would. It takes the largest additive edit and
   its failure mode is "technically accurate, still misleading".
6. Confirm `docs/ARCHITECTURE.md`'s heading list gained exactly one top-level heading
   (`grep -n "^#\{1,3\} "` before and after; 24 headings at P70, expect its successor count plus
   one `##` and its `###` children).

## 7. Explicitly not in this phase

- `docs/PERF.md` and `docs/PACKAGING.md`. The SPEC row names four files; these are not among them.
- Any code change. If a doc fix needs source read to state something correctly, read it — but if the
  *source* turns out wrong, log it and leave it. One known instance already: `dbmcp/server.go:193`'s
  comment says *"constructs the five-tool `mcp.Server`"* while `buildMCPServer` registers six. M8
  does not fix it; note it in the commit message of whichever commit documents the six tools, so it
  is findable.
- Restructuring `docs/ARCHITECTURE.md`. §2.9 adds one new section for a subsystem that has none; it
  moves no existing paragraph and does not relocate the code-intelligence sections out of
  `## Storage`.
- The two Known open items named in §0, and the other two v1.7-era entries beside them.
- `docs/v1.7/mcp-repo-map-issues.md` (§5) and `docs/v1.7/SPEC.md`. Both are kept as written, per the
  chapter's own `README.md`.
- Re-measuring the Stack table's C3 binary-size figure (§2.2).

## 8. Commit list

One commit per file, smallest and most mechanical first, so the large additive diffs land against
already-corrected pointers:

1. `docs(M8): point CLAUDE.md at the live chapter and reflow the dogfooding note` — §4.
2. `docs(M8): cover the database MCP server in DEV_ENVIRONMENT.md` — §3.
3. `docs(M8): correct ARCHITECTURE.md's schema, migration and token facts for v1.7` — §2.1 through
   §2.8, plus §2.10.
4. `docs(M8): document the database MCP server in ARCHITECTURE.md` — §2.9 alone.
5. `docs(M8): bring README.md current for the database MCP server` — §1.

Splitting 3 from 4 keeps the new section reviewable on its own rather than buried among small
corrections to existing lines — the same reason P70 split its own §2.10/§2.11 out.
