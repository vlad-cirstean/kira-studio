# P23 — SQLite storage unbounded-growth audit

> **What this phase is.** `docs/v1.2/SPEC.md`'s P23 row, which exists to answer one categorical
> user question: *"Make sure that there are no thing in the sqlite db that accumulate without any
> limit."* Not "cap the tables this chapter's review rounds happened to touch" — **every** table in
> `~/.kira-studio/kira.db`, and any on-disk cache alongside it, gets read and answered for.
>
> **What the audit found, up front.** The app is in **better shape than the row assumes**, and this
> plan is scoped to what is actually missing rather than padded to look thorough. Of the **nineteen
> tables** the schema defines (F1), **seventeen are already bounded** — most by a deliberate cap a
> prior phase added, several because the table simply cannot grow from machinery (a closed key set,
> one row per user-created object, one row per live window). **Two are genuinely unbounded**, and
> both are unbounded in the same way: a *count* cap exists, a *byte* cap does not, and the column
> that can hold arbitrary user text has no ceiling at all.
>
> **Four corrections this investigation makes to the row's own premises:**
>
> 1. *"connections, tabs, collections, variables/environment history … and any other table"* —
>    **none of those five is a gap.** `connections`/`api_collections`/`api_items`/`api_variables`/
>    `api_environments` grow only when a person creates something and shrink when they delete it;
>    `tabs` is rewritten in place per window on every save and cascades on window close (F11);
>    `api_variable_history` has had a 20-per-variable trim since P5 (F9). The row named the wrong
>    five tables. The two that are actually unbounded — **`op_log`** and **`filter_history`** — are
>    the two the row mentions least (`op_log` in passing, `filter_history` not at all).
> 2. *"metrics/telemetry if any"* — **there is none.** `internal/metrics` is an in-memory ticker
>    with no `*sql.DB`, no repo, and no table (F14). Nothing in this app writes telemetry anywhere.
> 3. *"(and any on-disk cache alongside it)"* — **there is no on-disk cache alongside `kira.db`.**
>    `~/.kira-studio/` contains exactly `kira.db` (plus SQLite's own `-wal`/`-shm`) and `logs/`
>    (F15). The three caches `docs/ARCHITECTURE.md`'s Caching section names are one SQLite table
>    (`metadata_cache`, capped, F8) and two in-memory tiers; `internal/grpcclient`'s descriptor
>    cache is a fourth in-memory one, already byte-budgeted. Nothing else touches disk.
> 4. The row is silent on the **file** as opposed to the tables, and that turns out to matter: every
>    cap in this app — the ones that already exist and the ones this phase adds — deletes rows, and
>    **no code path anywhere returns the freed pages to the filesystem** (F16). `kira.db` is a
>    permanent high-water mark today. That is a real finding the row did not ask for, and it is in
>    scope, because a cap that bounds row count while the file only ever grows does not answer the
>    user's question.
>
> **Base commit.** Read against `01c7743` (branch `claude/feature-v1-2`), i.e. P22 part 2 landed and
> its row is marked implemented. Every file:line citation points at that commit.
>
> **Measurements are real.** F16, F17 and D6 rest on three throwaway Go tests run in this worktree
> against `modernc.org/sqlite v1.57.0` — the exact pinned driver — and against the pinned SQLite
> amalgamation's own compiled-in defaults. Numbers are quoted as observed, not as remembered from
> SQLite's documentation. The throwaway package was deleted after the run; §4 turns the two
> load-bearing observations into permanent tests.
>
> **The precedents this matches.** `docs/v1.2/plans/P8-response-history.md` (D6's three-caps
> reasoning, which this plan reuses almost verbatim for `op_log`) and
> `docs/v1.2/plans/P11-grpc-support.md` (D11's fourth application of the same pattern, and its
> argument for a *smaller* budget on a table whose rows are worth less). For the shape of an audit
> that corrects its own row rather than manufacturing gaps:
> `docs/v1.2/plans/P19-connection-dialog-mongo-console-sql-tooling.md`.

---

## 0. Scope

### 0.1 What this phase does

| # | Item | Findings | Decisions | Commits |
|---|---|---|---|---|
| 1 | Audit every table in `kira.db`; record what is already bounded and how | F1-F15 | — | T7 |
| 2 | `op_log` gains a per-row byte cap and a table byte budget | F3, F4, F5 | D1, D2, D3 | T1, T2, T3, T6 |
| 3 | `filter_history` gains a per-connection bound, not only a per-path one | F6, F7 | D4 | T4, T6 |
| 4 | `kira.db` can return freed pages to the filesystem | F16 | D5 | T5, T6 |
| 5 | `kira.db-wal` stops keeping its high-water mark for the session | F17 | D6 | T5, T6 |

### 0.2 Files this phase touches

- `apps/kira-studio/internal/storage/migrations/0015_p23_op_log_bytes.sql` — **new**: two columns
  on `op_log`, one covering index, one backfill, one legacy-row purge.
- `apps/kira-studio/internal/storage/repos/ops.go` — the per-row caps, `stored_bytes`, the third
  pass in `Prune`.
- `apps/kira-studio/internal/storage/repos/ops_internal_test.go` — **new**: the
  `SetOpLogByteBudgetForTest` hook, mirroring `response_history_internal_test.go` exactly.
- `apps/kira-studio/internal/storage/repos/ops_test.go` — **new**: §4.2's cases.
- `apps/kira-studio/internal/storage/repos/filter_history.go` — the per-connection trim and the
  per-row text cap.
- `apps/kira-studio/internal/storage/repos/filter_history_test.go` — extended with §4.2's cases.
- `apps/kira-studio/internal/storage/repos/helpers_test.go` — one `newOpsRepo` helper beside the
  two that already exist.
- `apps/kira-studio/internal/storage/model/ops.go` — `OpRecord.CommandTruncated`.
- `packages/shared/domain/ops.ts` — the same field on `opRecordSchema`.
- `apps/kira-studio/internal/storage/db.go` — two DSN parameters.
- `apps/kira-studio/internal/storage/dsn_test.go` — **new**: §4.2's pragma-readback case.
- `apps/kira-studio/internal/storage/repos/maintenance.go` — **new**: `Reclaim`, the startup
  incremental-vacuum pass.
- `apps/kira-studio/main.go` — one call, beside the two `SweepOrphans` calls already there
  (`main.go:146-152`).
- `apps/kira-studio/frontend/src/workbench/panels/OperationsPanel.vue` — Re-run is disabled on a
  truncated command; the expanded detail says so.
- `apps/kira-studio/frontend/bindings/**` — regenerated (`OpRecord` gained a field).
- `docs/ARCHITECTURE.md` — the growth-bound table §5 specifies.
- `docs/v1.2/SPEC.md` — the P23 row.

### 0.3 Not in scope, and why

- **`~/.kira-studio/logs/`.** The SPEC row's wording is "every table and cache in the app's own
  `kira.db` (and any on-disk cache alongside it)". A log directory is neither a table nor a cache,
  so it is outside what the row asks. It was checked anyway and is already bounded:
  `internal/logging/log.go:33-51` rolls one file per local day and
  `internal/logging/sweep.go:15,21` deletes any `kira-*.log` older than 30 days by mtime at every
  launch (`main.go:71`), so the directory holds at most ~30 files. The honest residue — a single
  day's file has no size cap — is not worth acting on: the handler is `slog` at
  `LevelInfo` (`log.go:69`) and nothing in this app logs a payload, only short structured records.
- **The two in-memory cache tiers** (`internal/enginecache`'s L2 page cache, `internal/grpcclient`'s
  descriptor cache). Both are byte-budgeted LRUs already (`enginecache/pages.go:14`,
  `grpcclient/descriptors.go:147-163`), neither touches disk, and neither survives a restart. F13
  records them so the audit reads as complete.
- **The renderer-side page stores.** Deliberately unbudgeted, by a decision taken twice and
  recorded in `docs/ARCHITECTURE.md`'s Caching section ("A fourth, renderer-side tier, deliberately
  unbudgeted") against `docs/PERF.md` §2.2's lever L-B. Not SQLite, not on disk, and re-opening it
  is `docs/v1.1/plans/P5-ram-usage.md` §8 OQ-2's business, not this phase's.
- **Converting an existing `kira.db` to `auto_vacuum=INCREMENTAL`.** D5 declines it, with reasons.
- **Any change to the caps that already exist.** `api_response_history`'s 30/scope + 128 MiB,
  `grpc_call_history`'s 30/scope + 32 MiB, `metadata_cache`'s 200/connection, and
  `api_variable_history`'s 20/variable are all confirmed correct and enforced (F8, F9, F10). This
  phase touches none of their numbers. Whether `metadata_cache` should refresh *more* aggressively
  is `docs/v1.2/SPEC.md`'s **P24** row's question, explicitly not this one's.

---

## 1. Findings

### F1 — The nineteen tables, and where each is defined

Grepped across `internal/storage/migrations/*.sql` (the ground truth for schema) and
`internal/storage/repos/*.go` (the ground truth for write paths). `schema_version` is created by
`internal/storage/migrate.go:14` rather than by a migration file; the other eighteen come from the
fourteen migration files.

| Table | Defined at | Written by |
|---|---|---|
| `schema_version` | `migrate.go:14` | `migrate.go:22,61` |
| `settings` | `0001_init.sql:3` | `repos/settings.go:141` |
| `connections` | `0001_init.sql:8` (+ `0004`, `0005`) | `repos/connections.go`, `repos/secrets.go` |
| `saved_queries` | `0001_init.sql:35` | `repos/saved_queries.go:115` |
| `filter_history` | `0001_init.sql:51` | `repos/filter_history.go:25` |
| `metadata_cache` | `0001_init.sql:60` | `repos/metadata_cache.go:54` |
| `op_log` | `0001_init.sql:69` | `repos/ops.go:32,46` |
| `ui_layout` | `0001_init.sql:82` | `repos/layout.go:126` |
| `tabs` | `0001_init.sql:87`, rebuilt `0002:24` | `repos/tabs.go:95` |
| `connection_tree_filters` | `0001_init.sql:99` | `repos/filters.go:49` |
| `windows` | `0002_p8_windows.sql:7` (+ `0014`) | `repos/windows.go:70,106,157,170,188` |
| `connection_ddl` | `0003_p18_connection_ddl.sql:6` | `repos/schema.go:32` |
| `api_collections` | `0006:6` (+ `0007:56`), renamed `0010:14` | `repos/collections.go:216,635` |
| `api_items` | `0006:17` (+ `0009:5`), renamed `0010:15` | `repos/collections.go:350` |
| `api_environments` | `0007:5` (+ `0011`, `0012`), renamed `0010:16` | `repos/variables.go:82` |
| `api_variables` | `0007:15` (+ `0011`), renamed `0010:17` | `repos/variables.go:382` |
| `api_variable_history` | `0007:40`, renamed `0010:18` | `repos/variables.go:541` |
| `api_response_history` | `0008:5`, renamed `0010:19` | `repos/response_history.go:60` |
| `grpc_call_history` | `0009_p11_grpc.sql:19` | `repos/grpc_history.go` |

One doc drift worth fixing in passing: `docs/ARCHITECTURE.md`'s Storage schema block names a table
`connection_filters(id, connection_id, node_kind, pattern, is_regex, action)`. No such table exists
— `0001_init.sql:99` defines `connection_tree_filters(connection_id, scope, value)`, a set with no
`id` and no ordering, per P28 D12's own comment there. T8 corrects it.

There are **no other SQL writers**: a grep for `INSERT INTO`/`UPDATE `/`DELETE FROM` across
`internal/` outside `storage/repos` and `storage/migrations` returns only `migrate.go`'s own two
statements, the adapters' generated statements against *user* databases
(`adapters/sqlmutate.go:179-197` and friends), and container-fixture seed SQL under
`adapters/testsupport/`. Every write into `kira.db` goes through a repo.

### F2 — What "bounded" means here, and the four shapes this app already uses

Four distinct bounding shapes already exist in the tree, and every decision below reuses one rather
than inventing a fifth:

1. **Insert-then-trim, per scope** — `DELETE … WHERE <scope> = ? AND id NOT IN (SELECT id … ORDER
   BY <time> DESC, rowid DESC LIMIT ?)`, inside the inserting transaction.
   `filter_history.go:62-73` (20), `variables.go:557-568` (20), `response_history.go:158-167` (30),
   `grpc_history.go:170-176` (30), and — keyed on connection rather than scope —
   `metadata_cache.go:86-97` (200).
2. **A per-entry byte cap on whatever column holds free-form text**, so no single row can dominate.
   `response_history.go:18` (256 KiB, applied to the request body and the response body
   separately), `grpc_history.go:17` (64 KiB per message), `metadata_cache.go:15` (4 MiB per row,
   refused rather than truncated).
3. **A table-wide byte budget**, evicted oldest-first *across* every scope, gated behind a cheap
   indexed `SUM` and executed as one window-function `DELETE`. `response_history.go:186-202`
   (128 MiB), `grpc_history.go:195-203` (32 MiB), with the covering indexes
   `0013_p21r3_history_bytes_index.sql` added so the gate is an index-only scan.
4. **A sweep against a liveness oracle**, run once at launch. `response_history.go:356`,
   `grpc_history.go:340` (both use `tabs` as the oracle), `oplog/wire.go:123-127` (`Prune`),
   `logging.Sweep()` — all four called from `main.go:71,141,146,150`.

Shape 3 is what makes `api_response_history` and `grpc_call_history` the only two tables in this
app that are bounded *in bytes* rather than only in rows. Everything below is about which other
tables need it.

### F3 — `op_log` is bounded in rows and in age, and not at all in bytes

`repos/ops.go:123-137`'s `Prune` runs two passes: a retention cut
(`DELETE FROM op_log WHERE started_at < ?`, from `settings.advanced.opLogRetentionDays`, default 30,
range 1-365 — `model/settings.go:48,107`) and a hard row cap (`hardCapRows = 20_000`, `ops.go:13`).
`oplog/wire.go:91,213-216` calls it once at launch and again after every `pruneEveryOps = 500`
completed operations.

Both passes bound the **count** of rows. Neither bounds the **size** of one. `op_log.command` and
`op_log.error` are plain `TEXT` (`0001_init.sql:78-79`) and nothing on the path to them truncates:

- `adapters.OpCtx.SetCommand` (`adapters/adapter.go:162-166`) stores the string verbatim.
- `adapterhost.Host.RunOp` (`adapterhost/host.go:203-209`) reads it back verbatim and puts it on the
  `op:end` payload.
- `oplog.Wiring.handleOpEnd` (`oplog/wire.go:191-193`) hands it to `OpsRepo.Finish` verbatim.
- `OpsRepo.Finish` (`ops.go:46-57`) writes it verbatim.

### F4 — And `command` is a whole pasted console document, not a label

This is what turns F3 from theoretical into real. The SQL console's own execute path calls
`op.SetCommand` **once for the whole batch**, with every statement joined:

- `adapters/postgres/console.go:172` — `op.SetCommand(joinSemicolons(statements))`, where
  `joinSemicolons` (`postgres/mutate.go:179-188`) is a plain `";\n"` concatenation with no cap.
- `adapters/sqlite/mutate.go:134`, `adapters/postgres/mutate.go:136` — the same, for a batch mutate.
- `adapters/redis/console.go:112` — `op.SetCommand(strings.Join(lines, "\n"))`.
- `adapters/postgres/query.go:36` — `op.SetCommand(sql + " -- params: " + string(b))`, appending a
  JSON encoding of the parameter list.

So a user who pastes a 5 MB migration script into the query console and runs it writes a single
5 MB `op_log` row, and does so again on every re-run. The 20,000-row cap never fires; the retention
cut only fires 30 days later. Twenty re-runs of that script in one afternoon is 100 MB of `op_log`,
permanently, and there is no upper limit on it at all — the ceiling is whatever the user is willing
to paste, times whatever `opLogRetentionDays` allows through.

`error` has the same shape with a smaller realistic ceiling: `adapterhost/host.go:198-201` stores
`err.Error()` verbatim, and an adapter's mapped error can embed a server diagnostic of arbitrary
length.

**`op_log` is the app's highest-volume machine-written table and the only one whose per-row cost is
completely unbounded.** It is finding number one.

### F5 — `op_log.command` is not display-only: the Operations panel re-runs it

Truncating it is therefore a product decision, not a storage detail.
`frontend/src/workbench/panels/OperationsPanel.vue`:

- `:97-105` — **Re-run** feeds `record.command` through `splitSqlStatements` and opens a fresh
  console tab that runs it. A silently half-truncated command would re-run *part* of a script,
  which is worse than not offering the action at all.
- `:125-129` — **Copy command** copies `record.command`.
- `:245` — the collapsed row renders it as one truncated line with the full text in a tooltip.
- `:247-249` — the expanded detail row renders it in a `CodeMirrorHost`.
- `frontend/src/state/ops.ts:58` — the panel's filter predicate searches it.

Nothing acts on `error`; it is only rendered and searched.

### F6 — `filter_history` is capped per path, and the number of paths is unbounded

`filter_history.go:62-73` trims to `historyLimit = 20` rows per `(connection_id, path)`. There is no
second bound of any kind: no per-connection cap, no table-wide cap, no age cut, no orphan sweep. The
only thing that ever removes a `(connection_id, path)` scope wholesale is deleting the *connection*
(`0001_init.sql:53`'s `ON DELETE CASCADE`).

Rows are written **implicitly**, not by an explicit save: `bridge/queries.go:148-156`'s
`HistoryRecord` is called whenever a filter or sort is applied, and `filter_history.go:26-28` only
declines the "I cleared the filter" case (both `nil`). So the scope count grows with the number of
distinct tables/collections a person has ever filtered, on a connection they have never deleted —
which, against a warehouse with tens of thousands of relations, has no natural ceiling. There is
also no liveness oracle: a table dropped on the server leaves its 20 rows behind forever, and unlike
`api_response_history`'s scratch-tab rows (which have `tabs` to check against, `response_history.go:352-363`)
there is nothing to check a path against.

`where_text` is likewise uncapped — `bridge/queries.go:144,152` passes `args.Where *string` straight
through, and a Mongo filter document or a long SQL predicate goes in whole.

**This is finding number two, and it is genuinely smaller than F4.** Realistically: a hundred
filtered tables × 20 rows × a few hundred bytes is a few hundred kilobytes. It is on this list
because the user's question is categorical and because `filter_history` is the *only* history table
in the app with no cross-scope bound whatsoever — not because anyone is about to notice it.

### F7 — What `filter_history` should be measured against

`metadata_cache` answers the adjacent question — "how many distinct paths within one connection is
it worth keeping per-path state for?" — at **200 rows per connection**
(`metadata_cache.go:16`, P43 iter2 D20, re-affirmed by P22c which merged a fourth `kind` into the
same row specifically so `columns` would not "compete with the tree's own `children` rows for the
same 200-row-per-connection budget"). That is the number to derive from, not to re-invent (D4).

### F8 — `metadata_cache` is bounded three ways, and is fine

- **Per row**: `metadata_cache.go:72-75` refuses a merged payload over `maxMetadataPayloadBytes`
  (4 MiB) outright — logged, not an error, nothing written.
- **Per connection**: `:86-97` evicts everything outside the 200 most recently fetched paths, in the
  same transaction as the upsert.
- **Whole connection**: `connections/service.go:639` calls `DropConnection` on **every successful
  connect**, so a connection the user actually uses starts each session with an empty cache; and
  `0001_init.sql:61`'s `ON DELETE CASCADE` clears it when the connection is deleted.

P22c's fourth `kind` changes none of this: it merges into the *same row* keyed on
`(connection_id, path)` (`0001_init.sql:106`'s unique index), which is exactly why the plan chose a
container-keyed `columns` payload over one row per relation. Worst case is 200 × 4 MiB per
connection, but the reconnect drop means that ceiling is only reachable by a connection that is
never reconnected, and real payloads are orders of magnitude under it. **No change needed.**

### F9 — `api_variable_history` is capped, and the P21 r3 purge is a separate rule

`variables.go:18` (`variableHistoryLimit = 20`) and `:557-568` trim per `variable_id`, in the same
transaction as the insert, using shape 1 verbatim. The scope count is the number of variables, which
is user-created. `0007_p5_variables.sql:42`'s `ON DELETE CASCADE` clears a variable's history with
it, and `variables.go:476` additionally deletes every plaintext row for a variable that transitions
to secret (P21 round 3) — a *confidentiality* rule, not a size rule, and it does not substitute for
the count cap, which is what actually bounds the table. The row-count question the brief asks about
is answered: **the table itself is capped at 20 rows per variable.** Per-row size is uncapped, but a
variable's value is something a person typed into a one-line field. **No change needed.**

### F10 — `api_response_history` and `grpc_call_history` are the model, and are fine

Confirmed all four shapes present and enforced in the single writer of each:

- `response_history.go:18` 256 KiB per body (request and response independently, `:80,90-93,214-228`);
  `:121-131` a whole-snapshot backstop at half the budget with `RequestFieldsElided`;
  `:23` 30 per scope, trimmed at `:157-167`; `:31` 128 MiB table budget swept at `:186-202` behind
  the `api_response_history_bytes` covering index (`0013:8`); `:356` orphan sweep at launch.
- `grpc_history.go:17-22,30` the same four plus `maxGrpcStoredMessages = 100` and `MetadataElided`;
  `:340` orphan sweep.

`main.go:146-152` calls both sweeps. **No change needed.** These are what D1-D3 copy.

### F11 — `tabs` and `windows` cannot accumulate

- `tabs`: `TabsRepo.Save` (`tabs.go:95-151`) upserts each record by `id` and then deletes exactly
  the rows for that window that fell out of the incoming set (`:128-145`) — the table's size is the
  number of tabs actually open, by construction. `0002:32`'s `window_key … ON DELETE CASCADE` takes
  a closed window's tabs with it. `state_json` per row can reach ~1 MB (`tabs.go`'s own P21 round 3
  comment says so), but bounded by the open-tab count, which the user sees.
- `windows`: `main.go:291-301` deletes a window's row on close **unless it is the last one**
  (`RemoveAndCount(rec.Key) > 0`), which is D5 of P8 — the last window's row is what session restore
  reads. So the table holds one row per live window, plus at most one. Bounded.
  - One residue, dev-only: the `-tags server` build has no native shell, so nothing ever deletes a
    row, and `WindowsRepo.EnsureExists` (`windows.go:106-136`, called from `bridge/windows.go:35`)
    mints one for any `?window=<key>` a browser tab asks for. That build exists only for
    `tests/e2e-real/` and sandbox work (`AGENTS.md`'s Wails section), against a `t.TempDir()`
    `KIRA_HOME`, so it accumulates nothing that outlives a test run. Recorded, not fixed.

### F12 — The remaining eight tables grow only when a person creates something

- `schema_version` — one row, ever (`migrate.go:14-24`).
- `settings`, `ui_layout` — key/value tables over a **closed** key set. Every writer is an explicit,
  hand-listed leaf: `settings.go:68-132`'s `upsertSettingsLeaf` calls and `layout.go:71-130`'s
  patch arms. There is no path that writes an arbitrary key. Two documented orphan leaves exist
  (`advanced.engineMemoryCapMb`, `window.bounds` — `docs/ARCHITECTURE.md`'s Storage section,
  `0002:2-6`); both are single inert rows, deliberately not migrated away.
- `connections`, `connection_ddl`, `connection_tree_filters`, `saved_queries` — one row (or one set)
  per thing a person explicitly created, every one of them cascading on connection delete
  (`0001:37,53`, `0003:7`, `0001:100`). `connection_ddl.ddl` and `saved_queries.body` are uncapped
  per row, but both hold text a person deliberately pasted and can see and delete.
- `api_collections`, `api_items`, `api_environments`, `api_variables` — the collection tree and its
  variables, created by the user or by an import, deleted by the user, cascading throughout
  (`0006:19,23`, `0007:19,20`). The import path is already bounded upstream:
  `bridge/collections.go:20` refuses an assembled Postman body over 64 MiB, and
  `postman/parse.go:30` caps the same figure.

A config table with a handful of rows, and a tree of objects a person made on purpose, are exactly
the cases the brief calls "fine unbounded". **No change needed for any of these eight.**

### F13 — The two in-memory caches are byte-budgeted; neither is on disk

- `internal/enginecache` — the L2 page cache, `DefaultPageBudgetBytes = 64 MiB`
  (`enginecache/pages.go:14`), configurable via `settings.cache.l2BudgetMb` and pushed at
  `main.go:120,138`. Never persisted (`docs/ARCHITECTURE.md`'s Caching section).
- `internal/grpcclient` — the descriptor cache, `maxCachedDescriptorBytes = 64 MiB`
  (`descriptors.go:147`), a `map[string]*list.Element` + `container/list` byte-budgeted LRU
  (`:159-171`) that was *specifically* rebounded from an entry count to a byte budget by P11's own
  round-2 review finding 9. Process-lifetime only.

### F14 — There is no metrics or telemetry storage

`internal/metrics` has no `*sql.DB`, no repo, and no table — a grep for `sql.DB|Repos|storage`
across the package returns nothing. `main.go:155-159` constructs a ticker that samples process
memory into an in-memory emitter for the status bar. The row's "metrics/telemetry if any" resolves
to **none**.

### F15 — Nothing else in this app writes to `~/.kira-studio/`

`config.EnsureLayout` (`config/paths.go:63-73`) creates exactly `KiraHome()` and `LogsDir()`. A grep
for `os.Create|os.WriteFile|os.OpenFile|MkdirAll` across `internal/` and `main.go`, excluding tests
and container fixtures, returns four sites: `config/paths.go:43` (those two directories),
`logging/log.go:43,60` (the daily log file), `bridge/collections.go:341` (a collection **export** to
a path the user picked in a save dialog) and `adapters/s3/transfer.go:49` (an S3 **download**, same).
The last two write outside `KIRA_HOME` to a destination the user chose, and neither is a cache.

So the row's parenthetical "any on-disk cache alongside it" has an empty answer, and the on-disk
surface of this app is exactly: `kira.db`, `kira.db-wal`, `kira.db-shm`, `logs/kira-YYYY-MM-DD.log`.

### F16 — Nothing ever returns freed pages to the filesystem — measured

`storage/db.go:32-39`'s `buildDSN` sets four pragmas: `_busy_timeout`, `_foreign_keys`,
`_journal_mode=WAL`, `_synchronous=NORMAL`. A grep for `VACUUM|auto_vacuum|incremental_vacuum`
across every `.go` and `.sql` file in `apps/kira-studio` returns **zero hits**. So `kira.db` runs
with SQLite's default `auto_vacuum=NONE` and is never explicitly vacuumed.

What that means concretely: every cap in this app deletes rows, and a deleted row's pages go on the
freelist and are reused by later inserts — but the **file never shrinks**. A database that once held
128 MiB of response history stays ≥ 128 MiB on disk forever, even after *Clear* empties every scope.
The same will be true of everything D1-D4 adds.

Measured in this worktree against `modernc.org/sqlite v1.57.0` (throwaway test, since deleted):

| | fresh DB (`auto_vacuum` default) | fresh DB with `_auto_vacuum=INCREMENTAL` |
|---|---|---|
| after inserting ~40 MB | `db` = 41,123,840 | `db` = 41,123,840, `PRAGMA auto_vacuum` = 2 |
| after `DELETE FROM t` | `db` = 41,123,840 (freelist 10,025 pages) | 41,123,840 (freelist 10,025) |
| after `PRAGMA incremental_vacuum` | n/a (pragma is a no-op under `auto_vacuum=NONE`) | **`db` = 12,288, freelist 0** |

And, critically for how the fix has to be scoped — the DSN parameter **does not take on a database
that already exists**:

```
opened an existing DB with _auto_vacuum=INCREMENTAL -> PRAGMA auto_vacuum = 0
```

which matches the pinned driver's own comment at `sqlite.go:424-426`: *"auto_vacuum must be applied
while the database is still new: a journal_mode change or the first table materialises page 1 and
locks the setting in."* Converting an existing file needs a full `VACUUM` with the pragma set (which
does work — `auto_vacuum` reads back 2 afterwards), i.e. a whole-file rewrite.

### F17 — The `-wal` file keeps its high-water mark for the session — measured

`SQLITE_DEFAULT_JOURNAL_SIZE_LIMIT` is **-1** and `SQLITE_DEFAULT_WAL_AUTOCHECKPOINT` is **1000**
pages in the pinned amalgamation (`modernc.org/sqlite@v1.57.0/lib/sqlite.go:3370,3392`). A limit of
-1 means a checkpoint *restarts* the WAL rather than truncating it, so `kira.db-wal` grows to the
largest transaction's high-water mark and stays there. Measured:

```
after one ~60 MB transaction:            db=61,603,840  wal=61,973,072
after DELETE + 50 small inserts:         db=61,603,840  wal=61,973,072   (unchanged)
after db.Close():                        db=61,603,840  wal=absent
```

Two honest qualifications, both of which make this the **smallest** of the four findings:

1. The WAL is deleted on a clean close, so this is a within-session (or after-a-crash) effect, not
   permanent accumulation across restarts.
2. `SetMaxOpenConns(1)` (`db.go:54`) means only one transaction is ever in flight, so the high-water
   mark is one transaction's worth — reachable today by a large collection import or a maximal
   `api_response_history` snapshot, not by ordinary use.

It is on this list because the fix is one DSN parameter in the file D5 already touches, and because
it was measured to work:

```
opened with _pragma=journal_size_limit(4194304):
  PRAGMA journal_size_limit = 4194304, PRAGMA journal_mode = wal
  after the same ~60 MB transaction:  wal=61,973,072
  after the next small commit:        wal=4,194,304      (truncated back)
```

Note the mechanism the measurement also settles: `modernc.org/sqlite` has **no `_journal_size_limit`
shorthand** — the shorthand list is `_busy_timeout`, `_auto_vacuum`, `_foreign_keys`,
`_journal_mode`, `_synchronous`, `_query_only`, and a few non-pragma keys (`sqlite.go:305-380`).
It goes through the generic `_pragma=` list (`:433-445`), which is executed verbatim and
**before** `_journal_mode` in the apply order (`:446-462`). The readback above confirms that
ordering is fine in practice. It also means a typo in that parameter fails **loudly** (a malformed
`_pragma` errors the connection open, `:305-306`) while an unrecognised *top-level* key would be
ignored silently — which is why §4.2 pins the readback with a test.

---

## 2. Decisions

### D1 — `op_log` gets the two caps it is missing, mirroring `api_response_history`'s own three (F3, F4)

`op_log` already has two of the three bounds P8 D6 identified ("three caps, because three
independent things can grow — bytes per entry, count per scope, and bytes across the whole table"):
a **count** bound (`hardCapRows = 20_000`) and, uniquely, an **age** bound. It is missing both byte
bounds. This adds them, in the shapes F2 enumerates, with no new mechanism:

**(a) Per-row cap on `command`: 64 KiB.** Two independent derivations land on the same number, which
is why it is this one and not a figure picked to look round:

- It is `grpc_history.go:17`'s `maxGrpcMessageBytes` verbatim, and for P11 D11's own stated reason:
  that cap is half HTTP's 256 KiB "since a streamed message is one of many rather than the one thing
  a response is." An op-log `command` is the same category — one label among as many as 20,000 —
  and if anything it is worth *less* than a stored gRPC message, which a user opens and reads.
- It is the largest value that keeps the table under **twice** its budget between two prunes.
  `oplog/wire.go:46` prunes every 500 completed ops, so the worst-case overshoot between prunes is
  `pruneEveryOps × (command cap + error cap)`. At 64 KiB + 8 KiB that is 500 × 72 KiB ≈ 35 MiB,
  i.e. roughly one budget of overshoot on top of one budget. Any larger per-row cap makes the
  overshoot dominate the budget and the budget stop meaning anything.

64 KiB is ~1,500 lines of SQL. Nothing this app *generates* comes close (`joinSemicolons` over a
console batch is the largest, and that is bounded by what a person pasted); only a deliberately
enormous pasted script trips it.

**(b) Per-row cap on `error`: 8 KiB.** An error string is a diagnostic sentence or a server
message, never a pasted document, and nothing in the app acts on it (F5) — it is rendered and
searched. 8 KiB is `httpclient/timeline.go:18`'s `maxHopHeaderBytes`, this app's existing answer for
"a block of machine-generated text worth keeping in full", and it is far beyond any error any
adapter here produces. Truncation is **silent** for `error`, with no flag: there is no action to
disable and no correctness question, unlike (c).

**(c) A `command_truncated` flag, because Re-run exists.** F5 is the reason this is not a pure
storage change. Storing a silently-truncated command would let **Re-run** execute the first 64 KiB
of a script as though it were the whole thing — a genuinely destructive outcome, and precisely the
"stubbed behaviour" `AGENTS.md` forbids. So the truncation is *recorded*, the same way both history
tables record theirs (`BodyStorageTruncated`, `RequestBodyStorageTruncated`, `MessagesElided`,
`MetadataElided`): a `command_truncated INTEGER NOT NULL DEFAULT 0` column, surfaced on
`model.OpRecord`/`opRecordSchema` as `commandTruncated`, and read by `OperationsPanel.vue` to
**disable Re-run** for that row (one more clause beside the existing `disabled: !record.command ||
!canSql` at `:144`) and to mark the expanded detail. *Copy command* stays enabled — copying a
64 KiB prefix is honest and useful; running it is not.

Rejected alternative: **store nothing** when the command is over-cap (`NULL`), which needs no
column and no frontend change, since `disabled: !record.command` (`:128,144`) already disables both
actions. Declined because it throws away the log entry's only human-readable content for exactly the
operation most worth being able to identify later — "the 40-second `execute` at 14:02" becomes a row
with a dash where the statement was. Keeping a readable 64 KiB head is worth one column.

Rejected alternative: **truncate in the middle with an inline marker.** Declined because
`splitSqlStatements` would treat an SQL-comment marker as a comment and Re-run would still fire.

Byte-slicing at the cap may split a UTF-8 sequence. That is the established behaviour here —
`response_history.go:91` does `resp.Body = resp.Body[:maxHistoryBodyBytes]` with no rune-boundary
handling — and matching it is deliberate rather than inventing a second convention for the same
problem.

### D2 — A third pass in `Prune`, not a fourth statement on the append path (F3)

The table budget is **32 MiB**, and it is enforced in `OpsRepo.Prune`, not in `Append`/`Finish`.

**Why 32 MiB.** It is `grpc_history.go:30`'s `grpcHistoryByteBudget` verbatim, and P11 D11's
argument for choosing a quarter of HTTP's 128 MiB transfers directly and with more force. P8 D6 drew
the line itself, in `docs/ARCHITECTURE.md`'s own words: *"unlike `op_log`, whose rows accumulate from
machinery, a response history row is a result the user asked for."* A table of machine-generated
labels does not get the same budget as a table of results a person asked for and re-reads. With the
64 KiB per-row cap, 32 MiB guarantees at least 512 maximal rows survive; in ordinary use — commands
of a few hundred bytes — 20,000 rows is ~2-4 MB and this pass never deletes anything at all.

**Why in `Prune` rather than on every write.** `response_history.go`/`grpc_history.go` pay their
sweep once per *send*, a user-initiated action. `op_log` gets a row for **every database operation
the app performs** — every `children`, every `describe`, every `read`, every `count`. Putting a
`SUM` plus a window-function `DELETE` in front of all of them would be strictly worse than the
situation P21 round 1 and round 3 already had to fix twice on the history tables (A8, and finding 11
which discovered the "cheap indexed aggregate" comment was false). `Prune` already runs at launch
and every 500 completed ops (`oplog/wire.go:91,213-216`), it is already the place both other passes
live, and the overshoot that cadence permits is bounded by construction — that is exactly what D1's
64 KiB cap was derived from.

**The sweep itself is `response_history.go:190-202` transposed**, ordering by `started_at DESC,
rowid DESC` (the order `Recent` at `ops.go:66` and the existing hard-cap pass at `:131` already use),
gated behind `SELECT COALESCE(SUM(stored_bytes), 0) FROM op_log` so the expensive statement is
skipped whenever the table is nowhere near budget. The safety invariant is the same one
`response_history.go:169-172` states and D1(a) supplies: no single row can exceed the budget
(64 KiB + 8 KiB ≪ 16 MiB, half the budget, with three orders of magnitude of margin), so the row
just inserted is never itself evicted.

**Pass ordering inside `Prune`**: retention cut, then row cap, then byte sweep. Cheapest and most
selective first; each pass shrinks the input to the next.

### D3 — `0015_p23_op_log_bytes.sql`: two columns, one covering index, one backfill, one purge (F3)

```
ALTER TABLE op_log ADD COLUMN stored_bytes      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE op_log ADD COLUMN command_truncated INTEGER NOT NULL DEFAULT 0;
UPDATE op_log SET stored_bytes = length(CAST(coalesce(command,'') AS BLOB))
                               + length(CAST(coalesce(error,'')   AS BLOB));
DELETE FROM op_log WHERE stored_bytes > <maxOpCommandBytes + maxOpErrorBytes>;
CREATE INDEX op_log_bytes ON op_log(stored_bytes);
```

- **`stored_bytes` as a real column, not a computed `length()` in the sweep.** The two history
  tables both carry one, and `0013_p21r3_history_bytes_index.sql` exists precisely because the
  budget gate must be an index-only scan. A `SUM(length(...))` cannot use an index at all — that is
  the exact regression P21 round 3 finding 11 caught. Written by `Finish` in Go as
  `len(command) + len(error)` after truncation, so it is exact and depends on no SQL function.
- **Both `ALTER TABLE … ADD COLUMN` with a non-NULL default are metadata changes, not table
  rewrites** — the same property `0011`, `0012` and `0014` each record in their own comments, and
  neither column is a `REFERENCES` column, so `0002`'s rebuild-and-swap restriction does not apply.
- **The backfill uses `CAST(… AS BLOB)`**, which counts bytes; bare `length()` on `TEXT` counts
  characters and would under-count a non-ASCII command.
- **The purge of pre-existing oversized rows is deliberate, and is delete-not-truncate.** Rows
  written before this migration have no cap, and a single 5 MB one would break D2's safety invariant
  on the very first sweep (its `running` exceeds the budget at position 1, so the `DELETE` empties
  the whole table). Truncating them in SQL instead would need byte-exact `substr` over a `BLOB` cast
  with a rune-splitting hazard, for rows that are by definition the pathological ones nobody wants.
  Deleting them is one statement with no edge case. The app has not shipped
  (`docs/ARCHITECTURE.md`'s Storage section states this twice), so the only databases this can touch
  are developers' own.
- **Migrations run inside a transaction** (`migrate.go:56-64`), and every statement above is
  transactional — no `VACUUM` here, which is why D5's file-level work is not a migration.

### D4 — `filter_history` gets a per-connection row cap of 4,000 and a per-row text cap (F6, F7)

**The cap.** One more `DELETE … WHERE connection_id = ? AND id NOT IN (SELECT id … WHERE
connection_id = ? ORDER BY used_at DESC, rowid DESC LIMIT ?)` in the transaction
`filter_history.go:40-78` already runs, immediately after the existing per-path trim. Shape 1, third
application in the same function's file.

**Why 4,000.** It is not a new number: it is `metadata_cache`'s existing **200 paths per
connection** (F7) multiplied by `filter_history`'s existing **20 rows per path**. Both factors are
already decided and already defended in this codebase; the product is what "a connection retains
full filter history for as many distinct objects as this app already thinks one connection's tree
is worth caching" comes to. Eviction is by `used_at DESC` across the whole connection, so the paths
you keep filtering keep their history and the one you filtered once last March falls off first —
which is the behaviour anyone would want, and the one a flat per-path cap alone cannot give.

Together with the existing cascade on connection delete, `filter_history` is then bounded at
`4,000 × <connections>` rows, with connections being user-created. That closes the finding.

**The per-row cap: 4 KiB, on `where_text` and on the encoded `order_by_json`.** A filter predicate
is a line a person typed into a filter box; 4 KiB is ~4,000 characters, well past anything anyone
types and past every Mongo filter document this app's own tests use. Truncated silently and with no
flag, for F5's reason inverted: nothing re-runs a history entry blind — selecting one **populates
the filter box**, where the user sees and edits the text before it is applied
(`bridge/queries.go:127-138`'s `HistoryList` feeds a picker, not an executor). A truncated entry is
visibly truncated at the moment it matters.

**Deliberately not added: an age cut or an orphan sweep.** There is no liveness oracle for a path
(F6) — nothing in `kira.db` knows whether a table still exists on the server, and asking the server
would mean connecting on startup, which this app pointedly does not do. And a filter a person typed
is a result they asked for, not machinery, which is P8 D6's own stated reason for refusing a
time-based expiry on `api_response_history`. The count cap is the whole fix.

### D5 — A fresh `kira.db` can reclaim; an existing one is not rewritten (F16)

Two changes, and one deliberate omission.

**(a) `buildDSN` gains `_auto_vacuum=INCREMENTAL`** (`db.go:32-39`). Measured to take on a
brand-new database (`PRAGMA auto_vacuum` = 2) and to be inert on an existing one (= 0), so it needs
no version gate and can never half-convert anything. `INCREMENTAL` rather than `FULL`: `FULL`
reorganises pages on **every commit**, which on a single-writer configuration store that commits on
every keystroke-debounced tab save is a cost paid constantly for a benefit wanted occasionally.
`INCREMENTAL` puts freed pages on the freelist and hands the reclaim decision to (b).

**(b) One reclaim pass at startup**, `repos.Maintenance.Reclaim`, called from `main.go` beside the
two `SweepOrphans` calls already at `:146-152`. It reads `PRAGMA auto_vacuum`, `PRAGMA
freelist_count` and `PRAGMA page_size`; if `auto_vacuum` is 2 **and** the freelist exceeds
**16 MiB**, it runs `PRAGMA incremental_vacuum` and logs what it reclaimed. Otherwise it does
nothing. Measured to work: 41,123,840 → 12,288 bytes with the freelist emptied.

16 MiB as the trigger, not zero: `incremental_vacuum` moves pages, and doing it for a few hundred
kilobytes at every launch is churn for no user-visible benefit. 16 MiB is half `op_log`'s new budget
(D2) and an eighth of `api_response_history`'s — i.e. "one of this app's caps actually fired and
released something worth releasing." The pass is placed at startup rather than at quit for the same
reason every other sweep here is: quit is when a write must not be the thing that goes wrong
(`response_history.go:352-355`'s own reasoning), and startup already owns this seam.

**(c) Deliberately not done: converting an existing `kira.db`.** It would need `PRAGMA
auto_vacuum=INCREMENTAL` followed by a full `VACUUM` — which cannot live in a migration (`VACUUM`
cannot run inside `migrate.go:56`'s transaction) and, at startup, would block every storage read
behind a whole-file rewrite for as long as it takes, on the boot path, before the first window
exists. The reason not to pay that: **there is no installed base.** `docs/ARCHITECTURE.md`'s Storage
section says so twice ("The app has not shipped, so there is no installed base to orphan"), and the
only databases that exist today are developers' own, none of which is large — because the very caps
that would let one get large are what this phase is adding. A developer who wants their own
`kira.db` converted runs one `VACUUM` by hand; T8 records that in `docs/ARCHITECTURE.md` alongside
the rest. If the app ever does ship before this changes, the conversion becomes a real question
again, and §5 records it as such rather than leaving it implicit.

### D6 — `journal_size_limit` = 4 MiB, so the WAL does not keep its high-water mark (F17)

`buildDSN` gains `_pragma=journal_size_limit(4194304)`. F17 measured this exact form on the pinned
driver: accepted, applied before `_journal_mode=WAL`, reads back correctly, and truncates a
61,973,072-byte WAL to 4,194,304 on the next commit.

**Why 4 MiB.** It is not chosen, it is derived: `SQLITE_DEFAULT_WAL_AUTOCHECKPOINT` is 1,000 pages
(`sqlite.go:3392`) and SQLite's default page size is 4 KiB, so 4 MiB is exactly the size the WAL is
*expected* to reach between two automatic checkpoints. A limit at that figure therefore never
truncates a WAL that is doing its ordinary job — it only reclaims after an unusually large
transaction has pushed the file past what the checkpoint interval implies. Any smaller value would
mean truncating and re-growing the file on every normal checkpoint.

This is the smallest of the four findings and is stated as such: F17 measured that the WAL is
deleted outright on a clean close, so what this actually fixes is peak disk *during* a long session
and the size of a WAL left behind by a crash. It is in the plan because it is one parameter in the
same function D5(a) already edits and because it was measured rather than assumed.

---

## 3. Commit sequence

Conventional Commits, one concern each. `go build ./... && go vet ./...` plus `bun run typecheck`
per commit; the full `bun run test:go` / `test:unit` / `test:ui` run once near the end, per
`AGENTS.md`'s cadence rule.

| # | Commit | Covers |
|---|---|---|
| T1 | `feat(storage): op_log records what each row costs` | D3's migration, `Finish` writing `stored_bytes`, D1(a)/(b)'s truncation, D1(c)'s flag through `model.OpRecord` + `opRecordSchema` + bindings |
| T2 | `feat(storage): the op log's prune enforces a byte budget` | D2 |
| T3 | `fix(workbench): a truncated command cannot be re-run` | D1(c)'s `OperationsPanel.vue` half |
| T4 | `feat(storage): filter history is bounded per connection, not only per path` | D4 |
| T5 | `feat(storage): a new kira.db can return free pages to the filesystem` | D5(a)+(b), D6 — all three are `db.go`/`main.go` |
| T6 | `test(storage): the storage caps this phase added actually hold` | §4.2 |
| T7 | `docs(architecture): every kira.db table's growth bound, in one table` | §5, plus F1's `connection_filters` doc-drift fix |
| T8 | `docs(spec): P23 implemented` | the SPEC row |

Ordering notes: **T1 before T2** — the sweep reads a column that has to exist and be backfilled
first. **T1 before T3** — the frontend reads a field the bindings do not carry until T1
regenerates them (`AGENTS.md`: regenerate via `wails3 task common:generate:bindings`, never a
hand-typed flag list, and `-names` is load-bearing). T4 and T5 are independent of everything and of
each other. T6 lands after T1-T5 so a single run covers all of them.

---

## 4. Verification plan

### 4.1 Fast checks

`go build ./...`, `go vet ./...`, `bun run typecheck`, `bun run lint`, `bun run build` per commit.
Bindings regenerated after T1 and confirmed to carry `commandTruncated` on `OpRecord`.

### 4.2 Go (`bun run test:go`) — the cases this phase owes

Per `AGENTS.md`'s bar, three of the four items below are "cache eviction/invalidation with
interacting rules", which the bar names explicitly as earning a test; the fourth is argued
separately.

1. **`repos/ops_test.go`** (new; there is no `ops_test.go` today) — `op_log`'s caps, which now
   interact four ways (age cut, row cap, byte budget, per-row truncation) and whose sweep is only
   *safe* because the truncation holds:
   - a `command` longer than the cap is stored truncated to exactly the cap, `command_truncated`
     reads 1, and `stored_bytes` equals the byte length of what was actually stored;
   - a `command` under the cap is stored verbatim with `command_truncated` = 0 (so the flag cannot
     be set spuriously);
   - an `error` longer than its cap is truncated and carries **no** flag (D1(b));
   - with the budget shrunk via `SetOpLogByteBudgetForTest`, `Prune` evicts oldest-first across the
     whole table until under budget, keeps the newest rows, and **never empties the table** — the
     invariant D2 rests on;
   - the existing retention cut and the 20,000-row cap still behave exactly as they do today
     (regression cases, since `Prune` is being restructured and had no test before).
2. **`repos/ops_internal_test.go`** (new) — `SetOpLogByteBudgetForTest`, a verbatim port of
   `response_history_internal_test.go:10-15`, for the same reason: the sweep cannot be exercised
   from `repos_test` without materialising 32 MiB of real rows.
3. **`repos/filter_history_test.go`** (extend) — the per-connection cap interacting with the
   per-path cap and the NULL-safe dedupe delete:
   - 21 recordings on one path still leave 20 (unchanged);
   - past the per-connection cap, the **least-recently-used path's** rows are evicted and the
     most-recently-used path's are not;
   - the dedupe path still moves an identical entry to the top without growing the row count;
   - a `where_text` over the per-row cap is stored truncated.
4. **`repos/history_bytes_index_test.go`** (extend, one case) — `EXPLAIN QUERY PLAN` for
   `SELECT COALESCE(SUM(stored_bytes), 0) FROM op_log` uses `COVERING INDEX op_log_bytes`. This
   file exists for exactly this assertion on the two history tables (`:39-55`) and the third table
   joins it; without it D2's gate silently degrades to the full scan P21 round 3 finding 11 caught.
5. **`storage/migrations/migrate_op_log_bytes_test.go`** (new) — the `0015` migration against
   **seeded** data, on `migrate_rename_test.go`'s precedent (the one test here that seeds rather
   than migrating an empty schema): a pre-existing under-cap row keeps its command and gets a
   correct byte-counted `stored_bytes`, including for a non-ASCII command where a character count
   would differ; a pre-existing over-cap row is gone.
6. **`storage/dsn_test.go`** (new, one case) — a freshly-opened `storage.Open()` database reads back
   `PRAGMA auto_vacuum` = 2 and `PRAGMA journal_size_limit` = 4194304.
   *Why this one clears the bar despite being two assertions on constants*: what it pins is not a
   branch in our own code but a **string parsed by a third-party driver**, whose failure mode F17
   established is *silent* for an unrecognised top-level key. `_journal_size_limit` is not a
   shorthand this driver has; the value only works because it goes through the generic `_pragma`
   list. A driver upgrade that reorders or renames that handling would turn both fixes off with no
   error anywhere, and nothing else in the repo would notice.

**No test is added for**: `metadata_cache`, `api_variable_history`, `api_response_history` or
`grpc_call_history` (their caps are unchanged and already covered by `metadata_cache_test.go`,
`variables_test.go`, `response_history_test.go`, `grpc_history_test.go`); D5(b)'s reclaim pass
(a threshold and one pragma call — `AGENTS.md`'s "a single `if` guarding one obvious case isn't
complexity"); or any of F11/F12's already-bounded tables, which this phase does not touch.

### 4.3 Unit (`bun run test:unit`)

No new case. `opRecordSchema` gains one optional boolean; `go-ts-vocabulary-parity.spec.ts` needs no
entry, since it pins only numbers the TS side also *names* (`:68-81`) and none of this phase's
constants has a TS counterpart.

### 4.4 UI (`bun run test:ui`)

One case, in whichever existing spec owns the Operations panel: with a row whose `commandTruncated`
is true, **Re-run** is disabled and **Copy command** is not. That is D1(c)'s whole product surface
and the one behaviour a user could hit; asserting it is cheaper than reasoning about it later.

### 4.5 What is deliberately not verified

- **That the `.db` file actually shrinks on a real machine after `incremental_vacuum`.** F16
  measured it here, on the pinned driver, at 41 MB → 12 KB. Repeating it as a permanent test would
  mean materialising tens of megabytes on every `test:go` run to assert a SQLite behaviour we do not
  own. §4.2 case 6 pins the thing we *do* own — that the pragma is set — which is where the failure
  would actually be.
- **The overshoot bound between two prunes.** D1's 64 KiB is derived from `pruneEveryOps`
  arithmetic, not measured; writing 500 maximal ops in a test to observe ~35 MiB of overshoot would
  prove multiplication.
- **Anything about how this looks on a real Mac.** This sandbox cannot build or render the app
  (`AGENTS.md`'s Wails section); T3's surface is two `disabled` clauses and §4.4 is the substitute.

---

## 5. The audit's answer, for `docs/ARCHITECTURE.md`

T7 adds this table to the Storage section — the durable record of what the audit found, so the next
phase that adds a table has a standard to meet rather than a precedent to guess at.

| Table | Grows with | Bound after P23 |
|---|---|---|
| `schema_version` | nothing | one row |
| `settings`, `ui_layout` | nothing | closed key set; every writer is a hand-listed leaf |
| `connections`, `connection_ddl`, `connection_tree_filters`, `saved_queries` | user action | user action; all cascade on connection delete |
| `api_collections`, `api_items`, `api_environments`, `api_variables` | user action / import | user action; import capped at 64 MiB upstream |
| `tabs` | open tabs | rewritten per window per save; cascades on window close |
| `windows` | live windows | one row per live window (+1 for session restore) |
| `metadata_cache` | browsing | 4 MiB/row, 200 rows/connection — **no longer dropped whole on reconnect** (P24 D6: a connect moves the connection's freshness epoch forward instead, and each row is re-read lazily, once, the first time a user opens that path again) |
| `api_variable_history` | value edits | 20 per variable |
| `filter_history` | filter/sort use | 20 per path, **4,000 per connection**, **4 KiB per row** |
| `api_response_history` | sends | 256 KiB/body, 30/scope, 128 MiB table, orphan sweep at launch |
| `grpc_call_history` | calls | 64 KiB/msg, 100 msgs/entry, 30/scope, 32 MiB table, orphan sweep |
| `op_log` | every DB operation | 30 days, 20,000 rows, **64 KiB command + 8 KiB error**, **32 MiB table** |
| the file itself | — | **`auto_vacuum=INCREMENTAL` on new databases + a startup `incremental_vacuum` above 16 MiB of freelist** |
| `kira.db-wal` | one transaction | **`journal_size_limit` = 4 MiB** |
| `logs/` | one file per day | 30 days by mtime (`logging.Sweep`) |

**The standard a new table has to meet**, stated once so it does not have to be re-derived: if a
table's rows are written by *machinery* rather than by a person, it needs a count bound **and** a
byte bound; if its rows are written by a person, a cascade to whatever they created is enough. Every
table above follows that rule after this phase, and `op_log` is the one that did not.

---

## 6. Open questions

- **OQ-1 — converting an existing database, if the app ships before someone does.** D5(c) declines
  the conversion on the strength of "there is no installed base." That premise has an expiry date.
  Whoever notices it has expired needs `PRAGMA auto_vacuum=INCREMENTAL` + `VACUUM` run once per
  database, off the boot path (a background pass after the first window is up, or a *Compact
  database* action beside the settings dialog's existing *Clear caches*), plus a `settings` leaf so
  a database that cannot be converted does not retry every launch.
- **OQ-2 — `op_log` has no per-connection or per-tab scope, and this phase does not give it one.**
  Every other history table in the app trims per scope, so one noisy connection cannot crowd out
  another's history. `op_log` is deliberately app-wide (the Operations panel is one list), and
  D2's oldest-first sweep is chronological, so a single connection running thousands of operations
  will evict another connection's older rows. That is the correct behaviour for a chronological
  log and the wrong behaviour for a per-connection audit trail. Nobody has asked for the latter;
  recorded so the question is answered on purpose if it ever comes up.
- **OQ-3 — `saved_queries.body` and `connection_ddl.ddl` are uncapped per row.** F12 rules both
  fine because a person pasted them deliberately and can see and delete them. If a future phase adds
  a path that writes either *programmatically* (a "save this console tab automatically", a "fill
  DDL from the connection" that runs on a schedule rather than on a button — P19 D15 added the
  button), that reasoning stops holding and both need D4's treatment.
