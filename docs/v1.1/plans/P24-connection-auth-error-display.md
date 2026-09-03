# P24 — connection auth root-cause, paired username/password, and hover-detail on connection errors

> **What this phase is.** Three parts, in priority order. Part 1 is a real, reproduced-against-a-
> real-container regression: most Postgres/MySQL/MariaDB connections created without an explicit
> `database` field fail outright at connect time — not the hypothesis the task brief opened with
> (validation "requiring" `database`; `input.go`'s `Validate()` never does, confirmed below), but a
> genuine bug in the connect path itself, in **two independent places**, one per engine family.
> Parts 2 and 3 are `ConnectionDialog.vue` layout/UX fixes: username/password on one line (matching
> the dialog's own existing paired-field convention), and hover-for-detail on truncated connection
> errors, reusing the app's one existing tooltip mechanism (`v-tooltip`, `workbench/state/tooltip.ts`)
> rather than inventing a second one.
>
> **Every claim below was re-verified against the tree at this phase's own base commit** (`f1a61f4`,
> `fix(grid): wire the cell editor dock into SlickGrid, and fix the perf/budget suite's stale
> selectors`, branch `claude/feature-v1-1-p5-onwards-2isfzt`) — file:line citations point at that
> commit's content unless marked "(post-fix)". Part 1's root causes were **reproduced against real
> Postgres 17, MySQL 8.4 and MariaDB 11.4 containers** (`testsupport.StartPostgres`/`StartMysql`/
> `StartMariadb`, the same fixtures `apps/kira-studio/internal/adapters/*/*_test.go` already use),
> not inferred from reading code alone — see §1.4 for the exact before/after transcripts.

---

## 0. Scope and non-scope

**In scope**: `apps/kira-studio/internal/adapters/postgres/client.go` (`buildConfig`),
`apps/kira-studio/internal/adapters/mysqlfamily/adapter.go` (`Connect`'s probe query),
`frontend/src/project/ConnectionDialog.vue` (fields-mode layout, test-result tooltip),
`frontend/src/project/TreeRow.vue` (connection-row error display), and one regression test each in
`apps/kira-studio/internal/adapters/postgres/postgres_test.go` /
`apps/kira-studio/internal/adapters/mysqlfamily/mysqlfamily_test.go`.

**Out of scope, explicitly**: anything under `apps/kira-studio/frontend/src/views/grid/` or
grid-related `tests/ui/*` specs — a separate, concurrent phase (the SlickGrid migration) owns those
files right now, and this phase touches **zero** files in that set (confirmed by the final diff,
§5). `packages/shared/domain/connection.ts`'s `connectionInputSchema` and
`apps/kira-studio/internal/connections/input.go`'s `Validate()` are read and cited (§1.1) but not
changed — neither is the bug, and requiring `database` there would be the wrong fix for a kind whose
whole point is browsing every database on the server (§1.1).

---

## 1. Part 1 — the auth-failure regression

### 1.1 What the task brief's own hypothesis got right and wrong

The brief opened with: *"I think there's an issue parsing or requiring the database field."* Two
validators were checked first, per the brief's own "already ruled out" note, and both were
re-confirmed here:

- **`apps/kira-studio/internal/connections/input.go`'s `Validate()`** (`:26-77`): for `Mode ==
  "fields"` and a non-file, non-AWS-style kind (`postgres`/`mariadb`/`mysql`/`clickhouse`/`mongodb`/
  `redis`/`kafka`), only `Host` (`:63-65`) and `Port` (`:66-68`) are required. `Database` is never
  checked at all outside the `fileKinds` branch (`:51-61`, SQLite only).
- **`packages/shared/domain/connection.ts`'s `connectionInputSchema`** (the frontend's own zod
  mirror, `:131-161`): the `superRefine` only adds a `database` issue for `FILE_KINDS` (`:133-147`);
  the `else` branch for every other fields-mode kind (`:148-155`) checks `host`/`port` only, exactly
  matching `input.go`.

So the premise "the field is wrongly *required*" is false in both validators — a Postgres or
MySQL/MariaDB connection with `database: null` (or `database: ''`) saves and passes validation
today, at both layers, unmodified by this phase. The brief's own instinct that the bug was
downstream of validation, in the actual connect path, is what panned out — but the mechanism in
each engine family turned out to be different from what either of the brief's two named hypotheses
predicted (an adapter *rejecting* an empty database, or a server reporting an *auth-shaped* error
for a missing one). Both real bugs instead make `Connect()` itself fail outright, before
authentication is even meaningfully separable from database selection in the user-visible error.

### 1.2 Root cause 1 — PostgreSQL: an omitted `database` startup parameter defaults to the username

**`apps/kira-studio/internal/adapters/postgres/client.go`'s `buildConfig`** (pre-fix, `:24-55`)
built a `*pgx.ConnConfig` from `pgx.ParseConfig("")` for fields mode (`:32-37`) and set
`connConfig.Database` only `if database != "" ... else if cfg.Database != nil` (`:51-55`, the `database`
parameter here is `ConnSet.get`'s own side-database override, `client.go:119-123`, empty for the
primary connection). When a fields-mode connection has no `database` — a state `Validate()`
explicitly allows, §1.1 — `cfg.Database` is `nil`, so `connConfig.Database` is left at whatever
`pgx.ParseConfig("")` produced.

**`pgx.ParseConfig("")` never sets a `database` key at all** unless the `PGDATABASE` environment
variable is set (confirmed by reading the installed module source,
`$(go env GOPATH)/pkg/mod/github.com/jackc/pgx/v5@v5.10.0/pgconn/defaults.go:12-44`'s
`defaultSettings()` — it sets `host`, `port`, `user`, `passfile`, TLS paths, and
`target_session_attrs`, never `database`). With `connConfig.Database == ""`, pgconn's own
`Connect`/`SendStartupMessage` path **omits the `database` startup parameter from the wire message
entirely**:

```go
// pgconn.go:405-406 (v5.10.0)
if config.Database != "" {
    startupMsg.Parameters["database"] = config.Database
}
```

Per the Postgres wire protocol, an omitted `database` startup parameter is not "connect without a
database" — the server defaults it to **the connecting user name** (the same default `psql`/libpq
apply when no `dbname` is given). For a real least-privilege application role — not the fixture's
own `postgres` superuser, whose name coincidentally matches its own always-present default database
— that means the server tries to open a database that essentially never exists, and fails the
connection outright with `FATAL: database "<user>" does not exist` (SQLSTATE `3D000`).

**`apps/kira-studio/internal/adapters/postgres/errors.go`'s `mapError`** (`:24-52`) only maps
`28P01`/`28000` to `E_AUTH` and `57014` to `E_CANCELLED` (`:33-38`); `3D000` falls through to the
generic `E_QUERY` fallback (`:39`). The resulting message — *"database \"app_user\" does not exist"*
— reads exactly like the user's own framing ("fail to authenticate… an issue… requiring the
database field") even though the mapped error code isn't literally `E_AUTH`: the connection is
refused instantly, before the user has any chance to interact with anything else, with a message
whose first legible word most users will read as a permissions/credentials problem, not "you forgot
to fill in a field that the dialog never told you was required."

This is exactly the shape the task brief called out as plausible but didn't itself find: *"an
adapter that should treat an empty/default database as valid… instead sends something a real server
would reject."* PostgreSQL is precisely that outlier — the ClickHouse adapter (§1.3.1) gets this
right already, which is what makes Postgres's gap a real, fixable inconsistency rather than
inherent protocol behavior this app has no choice about.

### 1.3 Root cause 2 — MySQL/MariaDB: `DATABASE()` returns SQL NULL, and the Go port never expected that

**`apps/kira-studio/internal/adapters/mysqlfamily/client.go`'s `BuildConfig`** (`:28-124`) only sets
`mc.DBName` when `cfg.Database != nil` (`:92-94`, fields mode) or `strings.TrimPrefix(parsed.Path,
"/")` is non-empty (`:66`, URI mode) — a completely conventional MySQL client behavior: connecting
with no default schema selected is a normal, legal thing to do (the equivalent of `mysql -u user -p`
with no trailing database name).

**`apps/kira-studio/internal/adapters/mysqlfamily/adapter.go`'s `Connect`** (pre-fix, `:50-93`) ran
the connect probe as:

```go
// adapter.go:64, pre-fix
var serverVersion, database, charset string
...
// adapter.go:66-70, pre-fix
err = exec(ctx, "SELECT VERSION() AS version, DATABASE() AS `database`, @@character_set_server AS charset", nil,
    func(rows *sql.Rows) error {
        found = true
        return rows.Scan(&serverVersion, &database, &charset)
    })
```

`DATABASE()` returns SQL `NULL` — not an empty string — whenever no default schema is selected,
which is exactly the state a connection with no `database` field is in. Go's `database/sql`
`Rows.Scan` into a plain, non-nullable `string` destination for a `NULL` column value returns an
error: `sql: Scan error on column index 1, name "database": converting NULL to string is
unsupported`. `Connect` treats any error from this probe as fatal (`:71-74`, pre-fix) and tears the
connection back down — so **every** MySQL or MariaDB connection with no `database` field failed
`Connect()` outright, 100% reproducibly, regardless of username or credentials. This reads to the
error-mapping layer as a plain `E_QUERY` (`mysqlfamily/errors.go`'s fallback, `:41`) with a message
that gives no hint at all that "database" in the message means "the SQL column named database", not
"the database field on your connection" — but the practical user experience is identical to root
cause 1's: the connection simply never succeeds, and the failure fires at the exact moment
credentials are being checked.

This is the Go port introducing a real regression the original TypeScript adapter didn't have —
JavaScript's `null` round-trips through a `string | null`-typed variable with no equivalent failure
mode, so this bug has no earlier history in this codebase; it dates to the MySQL/MariaDB Go port
(P58b M6.2, per `docs/ARCHITECTURE.md`'s own dating) and was never exercised by the existing
`mysqlfamily_test.go` suite, none of which previously tried a database-less connection.

### 1.3.1 What the other adapters do (for contrast, not fixed here)

Checked for the same shape of bug — an adapter silently sending something a real server rejects
when `database` is absent — across every other adapter package:

- **ClickHouse** (`apps/kira-studio/internal/adapters/clickhouse/client.go`'s `resolveTarget`,
  `:112-125`): `target := resolvedTarget{..., database: "default"}` (`:112`), overridden only `if
  database != nil && *database != ""` (`:116-118`). Already defaults sanely to ClickHouse's own
  always-present `default` database — the precedent this phase's Postgres fix (§1.4) follows.
- **Redis** (`apps/kira-studio/internal/adapters/redis/client.go:65-66`): `cfg.Database` sets the
  numeric DB index only when present; Redis's own protocol default (index 0, always valid) applies
  otherwise — no bug.
- **MongoDB** (`apps/kira-studio/internal/adapters/mongo/client.go:98-99`): `cfg.Database` is only
  appended to the connection URI's path when non-empty; the driver connects with no default database
  (auth against `admin` unless `authSource` says otherwise) — no bug, this is normal MongoDB usage.

Neither of these needed a change. PostgreSQL and MySQL/MariaDB are the two real, broad regressions.

### 1.4 Reproduced against real containers, before and after

All four runs below used this phase's own worktree, Docker images pulled via `mirror.gcr.io` per
`AGENTS.md`'s Docker section (`postgres:17-alpine`, `mysql:8.4`, `mariadb:11.4`), and a role/user
shaped like a real least-privilege application account — not the fixtures' own admin/superuser
credentials, since (per §1.2) the bug is specifically invisible to an account whose name happens to
match an existing database.

**PostgreSQL, before the fix** — a real `CREATE ROLE app_user LOGIN PASSWORD 'app_pw'` granted
`CONNECT` on `kira_test` only, then `Connect()` with `cfg.Database = nil`:

```
info={ServerVersion: Details:map[]} err=failed to connect to `user=app_user database=`:
127.0.0.1:32771 (localhost): server error: FATAL: database "app_user" does not exist (SQLSTATE 3D000)
adapters.Error Code="E_QUERY" Message="failed to connect to `user=app_user database=`: ... FATAL:
database \"app_user\" does not exist (SQLSTATE 3D000)"
```

**PostgreSQL, after the fix** (§1.5): the same role, same `cfg.Database = nil`, connects
successfully — `info.Details["database"] == "postgres"`.

**MySQL 8.4 and MariaDB 11.4, before the fix** — the fixtures' own `kira`/`kira` app user (already
scoped, not root), `Connect()` with `cfg.Database = nil`:

```
info={ServerVersion: Details:map[]}
err=sql: Scan error on column index 1, name "database": converting NULL to string is unsupported
adapters.Error Code="E_QUERY" Message="sql: Scan error on column index 1, name \"database\":
converting NULL to string is unsupported"
```
(identical failure text for both MySQL and MariaDB — same driver, same `DATABASE()` NULL shape).

**MySQL and MariaDB, after the fix** (§1.6): both connect successfully —
`info.Details["database"] == ""` (no default schema selected, which is exactly correct — nothing
was asked for).

### 1.5 The fix — PostgreSQL

`apps/kira-studio/internal/adapters/postgres/client.go:51-66` (post-fix):

```go
if database != "" {
    connConfig.Database = database
} else if cfg.Database != nil && *cfg.Database != "" {
    connConfig.Database = *cfg.Database
} else if connConfig.Database == "" {
    // P24: no explicit database anywhere (cfg.Database blank, and neither the URI's own path
    // nor pgx.ParseConfig("")'s PGDATABASE fallback supplied one). Left alone, the Postgres
    // wire protocol defaults an omitted "database" startup parameter to the connecting
    // *user* name (pgconn's own SendStartupMessage — client.go's non-URI branch above never
    // sets one either) — which fails outright with "database \"<user>\" does not exist" for
    // any real least-privilege role whose name doesn't happen to match an existing database.
    // "postgres" is the maintenance database every real server ships with, and the sane
    // bootstrap target anyway: this connection's whole point is to enumerate every database
    // on the server (docs/ARCHITECTURE.md's Postgres tree, database -> schema -> table), not
    // to land in one particular one.
    connConfig.Database = "postgres"
}
```

Two things worth being explicit about:

- **`*cfg.Database != ""` was added to the middle branch too**, not just the new `else if`. Before
  this phase, `cfg.Database != nil` alone let an empty-but-non-nil string (a user who typed into the
  Database field and then cleared it — `ConnectionDialog.vue`'s `TextField` binds
  `draft.database = $event` on every keystroke, §2, so a cleared field is `''`, not `null`) through
  as `connConfig.Database = ""`, silently reproducing the exact same bug for that specific input
  shape. Guarding both branches on non-empty closes both paths into the same, correct fallback.
- **`"postgres"` was chosen over leaving the field genuinely empty** because there is no "genuinely
  empty and still valid" state for a Postgres startup `database` parameter — some string always goes
  on the wire, whether this app picks it deliberately or the server does (with a much worse default).
  `"postgres"` is the maintenance database every real Postgres server ships with (created by
  `initdb`, alongside `template0`/`template1`); a Postgres role that lacks even `CONNECT` on it is a
  security posture this app was already just as unable to work around before this phase, since the
  connection would have failed the same way (username-as-database essentially never resolves
  either) — this fix strictly improves the common case without making any existing working case
  worse.

### 1.6 The fix — MySQL/MariaDB

`apps/kira-studio/internal/adapters/mysqlfamily/adapter.go:63-88` (post-fix):

```go
exec := execFor(entry.Conn, entry.ThreadID, op, a.trackerFor(op.OpID))
var serverVersion, charset string
// P24: DATABASE() is SQL NULL, not "", whenever the connection was opened with no default
// schema (client.go's BuildConfig only sets mc.DBName when cfg.Database is non-empty) — a
// completely ordinary case for a connection meant to browse every database on the server
// (docs/ARCHITECTURE.md's MariaDB/MySQL tree, database -> tables), and one Validate (input.go)
// deliberately allows. Scanning that NULL into a plain string panics-the-query with "converting
// NULL to string is unsupported", failing Connect outright for every such connection — a
// sql.NullString is what actually tolerates it.
var database sql.NullString
found := false
err = exec(ctx, "SELECT VERSION() AS version, DATABASE() AS `database`, @@character_set_server AS charset", nil,
    func(rows *sql.Rows) error {
        found = true
        return rows.Scan(&serverVersion, &database, &charset)
    })
...
a.primaryDatabase = database.String
```

and the `ConnectInfo.Details` map (`:97-99`) reads `database.String` too. Unlike PostgreSQL,
**no default-database substitution is needed here** — MySQL/MariaDB connections with no default
schema are already fully functional (every catalog query in this adapter qualifies table names
explicitly, `docs/ARCHITECTURE.md`'s per-engine table), so the only actual bug was the probe's own
inability to represent "no default schema" without crashing. `database.String` is `""` when
`DATABASE()` was NULL — exactly what `a.primaryDatabase` and `ConnectInfo.Details["database"]`
already meant for "no primary database" everywhere else they're read (`catalog.go:65`'s `if name ==
currentDatabase` — an empty `currentDatabase` simply never matches any real database name, so no
tree node gets spuriously marked "connected", which is correct).

### 1.7 Regression tests added

Per `AGENTS.md`'s carve-out — *"the adapter conformance suites are exempt from [the no-dedicated-
unit-test] bar… keep per-capability coverage there even where it reads like a CRUD round-trip"* —
both adapter conformance suites already contained a numbered "auth failure" case
(`TestPostgres_AuthFailure`, `postgres_test.go:111-127` pre-phase; the `"auth failure"` subtest,
`mysqlfamily_test.go:149-162` pre-phase) that this bug sits directly beside conceptually, so a
permanent regression test was added next to each, both against real containers (no mock):

- **`TestPostgres_ConnectWithNoDatabaseDefaultsToMaintenanceDB`**
  (`postgres_test.go`, added directly after `TestPostgres_AuthFailure`): creates a real
  `app_user` role granted `CONNECT` on `kira_test` only (no same-named database), connects with
  `cfg.Database = nil`, and asserts both that `Connect` succeeds and that
  `info.Details["database"] == "postgres"`.
- **`"connect with no database"`** (`mysqlfamily_test.go`, added directly after the `"auth
  failure"` subtest, inside `runFamilySuite` so it runs for both MariaDB and MySQL): connects with
  `cfg.Database = nil` against the fixtures' own already-scoped `kira` user, and asserts `Connect`
  succeeds with `info.Details["database"] == ""`.

---

## 2. Part 2 — username and password on one line

**Before**: `ConnectionDialog.vue`'s fields-mode template paired `Database`/`Region` with
`User`/`AWS profile` in one `.field-row` (pre-phase `:503-522`), then rendered `Password` alone in
its own full-width `.field` below (`:523-543`) — `Host`/`Port` were already the dialog's one
existing paired-row precedent (`:481-501`), which Part 2 was asked to match.

**After** (`ConnectionDialog.vue`, post-fix): `Database` (or `Region`, for the two AWS-style kinds)
now sits alone on its own full-width row; `User` and `Password` are paired in a `.field-row`
together, the same `.field`-per-column shape `Host`/`Port` already uses. The AWS-style branch
(`sqs`/`s3`, which has no password field at all — `isAwsStyle`, `:299`) keeps `Region` and
`AWS profile (optional)` paired exactly as before, since that pairing was never the reported
problem and nothing about it needed to change.

No `data-testid` changed (`connection-database`, `connection-username`, `connection-password` are
identical strings, just relocated in the template), so no existing Playwright locator broke — this
was confirmed rather than assumed (§4).

---

## 3. Part 3 — hover-for-detail on truncated connection errors

### 3.1 The existing mechanism, read before writing anything

`workbench/state/tooltip.ts` (`:1-298`) is this app's one tooltip primitive: a `v-tooltip` directive
(`:282-298`) writes a `data-kira-tip` attribute a document-level pointer-move/focus controller reads
to open a floating `AppTooltip.vue` after `TOOLTIP_DELAY_MS` (`:11`). `OperationsPanel.vue:238`
already uses it for exactly this shape of problem — a truncated, CSS-ellipsized error string with
the full text on hover:

```html
<span v-if="item.record.status === 'error'" class="mono truncate error-text" v-tooltip="item.record.error ?? ''">
  {{ item.record.error }}
</span>
```

This phase reuses that same directive at both of the brief's two named sites, adding no second
mechanism.

### 3.2 Investigation: what was *actually* truncated-with-no-detail in the project tree

The brief's premise — *"connection error indicators in the project tree… shows a truncated error"*
— was checked against the real render path (`frontend/src/project/state/tree.ts`'s `searchResult`,
`:481-529`, the single function `visibleRows` derives from, `:531`, used for both searching and
plain browsing) rather than assumed. Two genuinely distinct error surfaces already exist on a
connection row, and neither was a truncated *visible* string:

- **`row.error`** (`tree.ts:519`, `treeState.errors[connKey]`) is a **post-connect children-fetch**
  failure (`loadChildren`, `tree.ts:109-124`) — set only after `Connect()` already succeeded. It
  already renders through `ErrorPopover.vue` (`TreeRow.vue:149`), a click-to-expand popover with
  Copy/Close (not this phase's mechanism, and not broken — already gives full detail on demand).
- **`row.statusDetail`** (`tree.ts:523`, `state?.error` when `status === 'error'`) is the actual
  **connect failure** reason — and before this phase, `TreeRow.vue` exposed it only as a
  `v-tooltip` on the 8px `.status-dot` (`:131`, unchanged by this phase). That already used the
  right mechanism and already showed the complete text on hover — it was never *truncated*, it was
  simply invisible until a very small target was found and hovered, with **no visible text
  indicator that a connection had failed and why**, anywhere in the row. `expand()`
  (`tree.ts:147-166`) confirms `row.error` is genuinely never set on a connect failure — line 161
  returns early (`if (connectionsState.states[connectionId]?.status !== 'connected') return;`)
  before `loadChildren` (which is what would ever populate `treeState.errors`) is reached.

So the fix that actually matches the brief's intent — *"errors are shown truncated today… but
there's no way to see the full detail"* — is to give the connect-failure reason a real, visible,
truncated inline indicator for the first time, with the hover-detail mechanism applied to it from
the start, rather than "fixing" an already-working popover or an already-working (if easy-to-miss)
tooltip.

### 3.3 The fix — `TreeRow.vue`

```html
<ErrorPopover v-if="row.error" :message="row.error" />
<span
  v-else-if="row.kind === 'connection' && row.status === 'error' && row.statusDetail"
  class="detail error-text"
  data-testid="connection-error-detail"
  v-tooltip="row.statusDetail"
  >{{ row.statusDetail }}</span
>
<span v-else-if="row.detail" class="detail">{{ row.detail }}</span>
```

`.detail` is the tree's own existing truncated-cell style (`overflow: hidden; text-overflow:
ellipsis`, inheriting `white-space: nowrap` from `.tree-row`, `TreeRow.vue:163`); `.error-text {
color: var(--kira-error) }` is added alongside it, mirroring `OperationsPanel.vue`'s own
`.error-text` rule (`:360-362`) rather than inventing a new error color token. `row.error` keeps
priority in the `v-if`/`v-else-if` chain — a connection that connected, then failed to enumerate its
own databases, still gets the richer click-to-copy `ErrorPopover` it always did; the new branch only
fires for the state that previously had no visible indicator at all.

### 3.4 The fix — `ConnectionDialog.vue`'s Test connection flow

`.test-chip` (`:842-846` pre-phase) already truncates (`overflow: hidden; text-overflow: ellipsis;
white-space: nowrap`) — exactly the "truncated today, no way to see more" shape the brief named.
One attribute added, no CSS or markup restructuring:

```html
<span
  v-if="testState.status !== 'idle'"
  class="test-chip p-chip"
  :class="testState.status === 'ok' ? 'ok' : testState.status === 'error' ? 'err' : 'info'"
  data-testid="connection-test-result"
  v-tooltip="testState.status === 'error' ? (testState.message ?? '') : undefined"
>
```

`undefined` for every non-error status is deliberate, not an oversight — `updateTip`
(`tooltip.ts:250-274`) treats a falsy `v-tooltip` value as "remove the tooltip entirely" (`:251-260`),
so `Testing…`/`OK — <version>` (both short, never truncated) get no tooltip at all, matching
`OperationsPanel.vue`'s own conditional (`item.record.status === 'error'` gates the whole
`error-text` branch, not just its class).

---

## 4. Verification

### 4.1 Go gate

All run from this phase's own isolated worktree, against real Docker containers pulled via
`mirror.gcr.io` per `AGENTS.md`'s Docker section (`postgres:17-alpine`, `mysql:8.4`, `mariadb:11.4`,
`clickhouse/clickhouse-server:26.3`, `confluentinc/cp-kafka:8.0.7`).

| Check | Command | Result |
|---|---|---|
| Build | `go build ./apps/kira-studio/internal/...` | clean |
| Vet | `go vet ./apps/kira-studio/internal/...` | clean |
| Postgres adapter suite | `go test ./apps/kira-studio/internal/adapters/postgres/...` | all pass (29 tests, incl. the new `TestPostgres_ConnectWithNoDatabaseDefaultsToMaintenanceDB`) |
| MySQL/MariaDB adapter suite | `go test ./apps/kira-studio/internal/adapters/mysqlfamily/...` | all pass (both `TestMariaDB` and `TestMySQL`, incl. the new `"connect with no database"` subtest on each) |
| Every other adapter suite | `go test ./apps/kira-studio/internal/adapters/...` | all pass (clickhouse, kafka, mongo, redis, s3, sqlite, sqs, testsupport) |
| Full internal suite | `go test ./apps/kira-studio/internal/...` | all pass |

### 4.2 Frontend gate

| Check | Command | Result |
|---|---|---|
| Lint | `bun run lint` | `Checked 385 files … No fixes applied.` |
| Typecheck (tests/web/unit) | `bun run typecheck` | clean, all three projects |
| Build | `bun run build` | succeeds |

### 4.3 `tests/ui/` — targeted, then the full suite once

| Check | Command | Result |
|---|---|---|
| Targeted (connections, preconnect, tree, tooltips, tabs) | `playwright test --project=ui connections.spec.ts preconnect.spec.ts tree.spec.ts tooltips.spec.ts tabs.spec.ts` | **7/7 pass** |
| Full suite | `playwright test --project=ui` (82 tests) | **78/82 pass.** The 4 failures are all in `cell-editor.spec.ts` (3) and `slick-grid.spec.ts` (1) — files this phase never touches (§0), squarely inside the concurrent SlickGrid migration's own scope |

**The 4 grid-suite failures were confirmed pre-existing, not caused by this phase** — this phase's
entire diff was `git stash`-ed, the frontend rebuilt against the resulting pristine tree (the exact
base commit this branch started from), and the same two spec files re-run in isolation: identical 3
`cell-editor.spec.ts` failures (`locator.click: Target page… has been closed`, a closed-browser
timeout unrelated to any connection/tree/dialog code) reproduced with zero of this phase's changes
present. The stash was then restored (`git stash pop`) and the frontend rebuilt again before
resuming. Not investigated further or fixed — per this phase's own explicit boundary (§0) and the
task brief's own warning that a separate agent is concurrently landing the SlickGrid migration on
this same shared branch; fixing grid-owned files here would risk exactly the collision the isolated-
worktree instruction exists to avoid.

`connections.spec.ts` (CRUD/colors/secrets) and `preconnect.spec.ts` (which already exercises a
connect *failure* end-to-end, `preconnect.spec.ts:178-195`, asserting the status dot's own
`data-kira-tip` attribute) both pass unmodified — confirming Part 2's layout change and Part 3(a)'s
new `.detail.error-text` sibling span don't disturb either existing assertion (the dot's own
tooltip attribute is untouched by this phase; the new span is an addition, not a replacement).

---

## 5. What this phase deliberately did not do

- **Did not touch `input.go`'s or `connectionInputSchema`'s validation** to require `database`. Both
  already correctly allow it to be absent for every kind whose adapter is meant to browse the whole
  server (§1.1) — the bug was never in validation, and adding a requirement there would regress a
  legitimate use case (a connection meant to enumerate every database) rather than fix anything.
- **Did not touch any file under `frontend/src/views/grid/`** or any grid-related `tests/ui/` spec —
  confirmed by the final diff (§4.3's stash-and-diff check doubles as this confirmation).
- **Did not change MySQL/MariaDB's actual default-database behavior.** Unlike Postgres, no substitute
  database is chosen when none is given — `""`/no default schema is already fully functional for
  this adapter (§1.6), so the fix is scoped to the probe query's own NULL-handling bug, nothing more.
- **Did not add `autoUpdate`, a new positioning primitive, or any second tooltip mechanism** for
  Part 3 — `v-tooltip` already exists, already does exactly this job elsewhere
  (`OperationsPanel.vue`), and both new call sites in this phase use it exactly as-is.
- **Did not change `ErrorPopover.vue`** — it already provides full-detail (click, not hover) for the
  one error class it owns (`row.error`, a post-connect children-fetch failure), and that was never
  reported broken; Part 3(a)'s new branch is additive, for a genuinely different, previously-
  unindicated error state (§3.2).

---

## 6. Sources

**Reproduced here** (this worktree, isolated per the task brief's instruction, 2026-09-03): real
`postgres:17-alpine`, `mysql:8.4` and `mariadb:11.4` containers via `testsupport.StartPostgres`/
`StartMysql`/`StartMariadb`, with a fresh least-privilege Postgres role (`CREATE ROLE app_user LOGIN
PASSWORD 'app_pw'`, granted `CONNECT` only) for the Postgres reproduction specifically, since the
bug is invisible to the fixtures' own admin/matching-name credentials (§1.2/§1.4); `go test` output
before and after each fix; the full `tests/ui/` Playwright suite (webkit), including the stash/
rebuild/re-run isolation check for the 4 pre-existing grid-suite failures (§4.3).

**Read directly from source**: `github.com/jackc/pgx/v5@v5.10.0`'s installed module
(`$(go env GOPATH)/pkg/mod/github.com/jackc/pgx/v5@v5.10.0/pgconn/defaults.go`,
`pgconn/config.go`, `pgconn/pgconn.go:405-406`) for the startup-parameter-omission behavior; this
repo's own pre-phase `internal/connections/input.go`, `packages/shared/domain/connection.ts`,
`internal/adapters/postgres/{client,errors}.go`, `internal/adapters/mysqlfamily/{client,adapter,
errors}.go`, `internal/adapters/{clickhouse,redis,mongo}/client.go`,
`frontend/src/project/{ConnectionDialog,TreeRow,ErrorPopover}.vue`, and
`frontend/src/project/state/tree.ts`, all cited by file:line above against the base commit `f1a61f4`.

**In-repo**: `docs/ARCHITECTURE.md` (the Adapter contract and per-engine sections, read in full
before touching any adapter's connect path; the Postgres/MariaDB/MySQL tree-shape facts §1.5/§1.6
cite), `AGENTS.md` (the adapter-conformance-suite test-bar carve-out §1.7 follows, the "measure when
there's a real question at stake" rule this phase's container reproductions satisfy),
`docs/v1.1/plans/P23-library-adoption.md` (this plan doc's own structural precedent, and
`workbench/state/tooltip.ts`'s own header comment, which P23 verified and this phase re-read before
reusing it for Part 3).
