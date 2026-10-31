# P415 Part 2 Operations panel: memory MCP tool ops (out-of-process)

Plan for `docs/v0.2.23/SPEC.md` row P415 Part 2. Base: `1cec029` (P415 Part 1 done). Discovery ran through
`codegraph_explore` (memorycli `Run`, `appwire.RunArgvShim`, `agentsettings.go`, `mcpserver.Build`, `oplog.Log`,
`repos.OpLogRepo`, `agentmcp.recordCalls`, `ade.mcpRecorder`, `bridge.MemoryService.watch`, Space
`OperationsPanel.vue`), then Grep/Read for test launch sites, `sqlitex.Open` and `filelock`.

One sequential Sonnet implementer. No internal split: the shared middleware, the oplog foreign-writer seam, the
memory-mcp recorder and the flow test are one order-dependent chain.

## User ask

"I expect to see the ops done over mcp." Part 1 covers in-app `agentmcp`. Part 2: tool calls of the memory MCP server
(`kira-space memory-mcp`, a stdio process Claude Code spawns per session) reach the Space `op_log` and the panel.

## Findings (current tree)

- `appwire.RunArgvShim` runs `memorycli.Run(args, promptsPath, agentSelectorAt(config.DbPath()),
  memoryModelAt(config.DbPath()))` before any Wails code. memory-mcp already opens the app's `kira.db`, read only, once
  per call (`readSettingsAt`: missing file reads as defaults, never created).
- No socket or HTTP channel from memory-mcp to the app exists. The legacy `git.sock` is gone (P243 Part 2). The app
  may not run at all while Claude Code uses the memory server.
- Precedent for cross-process change detection: `bridge.MemoryService.watch` polls `PRAGMA data_version` on
  `memory.db` every 500 ms; it moves only for foreign commits.
- `sqlitex.Open` sets WAL, `busy_timeout=5000`, `SetMaxOpenConns(1)`. The app's `kira.db` handle is one
  connection, so `data_version` on it moves only for other processes' commits.
- `oplog` lives in `apps/kira-space/internal/oplog`; `internal/memory/**` cannot import it (Go `internal` rule).
  Anything Space-specific is injected from `appwire`.
- `oplog.Log` already has everything a writer needs: `Start`/`Finish`, redaction in `Finish`, persist through one
  writer goroutine to a `Store`, foreground/background rules, background failure dedupe, prune every 500 finished
  foreground ops. `Log.Start` mints `ID: rand.Text()`.
- `repos.OpLogRepo.ReconcileInterrupted` turns every `running` row into `error` at app start. A memory row may
  still be live then: Claude Code sessions outlive the app.
- `agentmcp.recordCalls` (receiving middleware) and `ade.mcpRecorder` (status mapping: canceled, Go error,
  `IsError`, ok) are Part 1's in-app pair. `mcpserver.Build` has no middleware.
- Space `OperationsPanel.vue` renders `record.module` raw and `module: z.string()` in `opsDomain.ts`: a new module
  value needs no frontend or `en.json` change. Part 1 stores reconcile text as plain English from Go.
- Test launch sites: memoryflow tests inherit `KIRA_SPACE_HOME` (flowharness `t.Setenv`); `tests/claude/memory_test.go:29`
  sets only `KIRA_MEMORY_HOME` in the MCP env, so it would write into whatever `KIRA_SPACE_HOME` the claude process
  carries. `scripts/docshistory` and `scripts/commentsweep` already set temp `KIRA_SPACE_HOME`.

## Channel options

1. **memory-mcp writes `op_log` rows into `kira.db` directly; the app ingests foreign commits.**
   Works with the app closed (rows wait in the table). Reuses `oplog.Log` + `OpLogRepo` unchanged in the child, so
   redaction, lanes, persist rules, dedupe and prune are one implementation. Precedents: memory-mcp already opens
   `kira.db`; `data_version` polling already detects the child's `memory.db` commits. Costs: one more writer on
   `kira.db` (WAL + 5 s busy timeout, single-statement upserts), a poll in the app, a liveness rule for rows a dead
   child leaves `running`.
2. **Post to the app over a local socket or HTTP callback.** No such endpoint exists; adding one means a listener,
   auth token handoff through the MCP env, and a spool anyway for the app-closed case. Rejected: two mechanisms
   where 1 needs one.
3. **Spool file the app tails.** New file format, rotation, cleanup, partial-line handling, and the app still writes
   the rows into `op_log` itself, so rows appear only while the app runs. Rejected: more moving parts than 1, and
   it duplicates what the table already is.

**Pick 1.** The table is the channel. Justification: survives app-closed, no new protocol, no new endpoint, one
op-log implementation on both sides, and it follows two existing precedents (`readSettingsAt`, `MemoryService.watch`).

## Design

### 1. Shared `tools/call` middleware (`internal/mcpcall`, new)

- `type Call struct { Tool string; Args []byte; Extra *mcp.RequestExtra }`.
- `type Hook func(ctx context.Context, c Call) (context.Context, func(isError bool, text string, err error))`.
- `func Record(srv *mcp.Server, hook Hook)`: the body of today's `agentmcp.recordCalls` (method filter, result text
  join), nil hook a no-op.
- `agentmcp.recordCalls` becomes a thin adapter: maps `Extra.TokenInfo` to the grant and calls `s.onCall` with the
  unchanged `agentmcp.ToolCall`. `agentmcp.Options.OnToolCall` keeps its signature.
- `oplog.FinishCall(op *Op, isError bool, text string, err error)`: the status mapping now in `ade.mcpRecorder`
  (canceled → `cancelled`, Go error → `error`, `IsError` → `error` with text, else `ok`). `ade.mcpRecorder` calls it.
  The memory recorder (section 4) calls it too: one mapping.

### 2. Foreign writer identity and liveness (`oplog/foreign.go`, new)

- `ModuleMemory = "memory"` (in `foreign.go`, not `record.go`; see Streams).
- Owner: a process that writes `op_log` from outside the app. `ClaimOwner(dir string) (*Owner, error)`: token
  `rand.Text()`, file `<dir>/<token>.lock` taken with `filelock.TryLock` and held for the process life.
  `Owner.Token()`, `Owner.Release()` (unlock, remove file).
- Foreign op id: `<token>.<rand.Text()>`. `rand.Text` is base32 (no `.`), so a `.` marks a foreign row and
  `OwnerToken(id) (string, bool)` cuts it. New `Option`: `WithIDPrefix(p string)`; `Log.Start` mints
  `l.idPrefix + rand.Text()` (one-line change in `log.go` plus the field).
- `OwnerAlive(dir, token string) bool`: `filelock.TryLock` on `<dir>/<token>.lock`. Lock taken (holder gone) or file
  missing → dead; on dead, remove the file. Busy → alive. Flock is per open file description, so the check also holds
  inside one process (unit tests).
- Ordering rule (stated in a comment): the owner file is locked before the first row is written and released only
  after `Log.Close` drained the writer. So a `running` foreign row whose owner is dead is truly orphaned.
- Owners dir: `<KiraSpaceHome>/op-owners`, from `opOwnersDir()` in `appwire/memoryops.go` (both the child and the
  app's `newOpLog` call it; no `config` edit). Created with `os.MkdirAll` by `ClaimOwner` only, never by the app.

### 3. App side: ingest foreign rows (`oplog/foreign.go`, `repos/oplogforeign.go`, `appwire`)

- `ForeignStore` interface (in `oplog`): `DataVersion(ctx) (int64, error)`; `MaxRowID() (int64, error)`;
  `ForeignAfter(rowid int64, ids []string) ([]Record, int64, error)` (rows with `instr(id, '.') > 0 AND (rowid > ?
  OR id IN (...))`, plus the new max rowid); `FailRunning(ids []string, msg string) error` (`UPDATE ... SET status =
  'error', error = ?, duration_ms = <now - started_ms> WHERE id IN (...) AND status = 'running'`).
  `repos.OpLogRepo` implements it in a new file `repos/oplogforeign.go`. Rowid is the cursor: SQLite assigns it at
  insert under the write lock, so rowid order is commit order across processes; `ON CONFLICT DO UPDATE` keeps it;
  prune deletes oldest rows only. No new column, no migration.
- `Log.Ingest(recs []Record)`: per record, replace the lane entry with the same id or insert it at its `StartedAt`
  position (newest first, lane cap kept); foreground → `emit`, background → `queueBatch`. Never persists (already in
  the table), never dedupes (each foreign failure is its own row; dedupe stays a writer-side rule), `Cancellable`
  false. Skip a record equal to the lane entry (status, duration, error) so a re-read emits nothing.
- `WatchForeign(ctx, l *Log, s ForeignStore, ownersDir string, every time.Duration)`: cursor = `MaxRowID` taken before
  `Seed`'s `Recent` read (a double read is idempotent). Each tick (1 s, `FlushInterval`): if `data_version` moved,
  `ForeignAfter(cursor, runningForeignIDs)` → `Ingest`, advance cursor. Every tick with running foreign ids: group by
  owner token, `OwnerAlive`; dead → `FailRunning(ids, "Memory MCP server stopped while this ran.")`, then re-read those
  ids and `Ingest`. `runningForeignIDs` comes from the fg and bg lanes under the log lock.
- Startup (`appwire.newOpLog`): `ReconcileInterrupted` skips foreign rows (`AND instr(id, '.') = 0`); then one
  sweep of `running` foreign rows by owner liveness before `Seed`, so the panel never shows a dead child's row as live.
  Start `WatchForeign` with the app ctx; stop on close.
- Retention: app prune counts foreign rows (same table). The child also prunes through its own `Log` (every 500
  finished foreground ops) and once on its first write, so growth stays bounded while the app is closed.

### 4. memory-mcp side: record every tool call (`mcpserver`, `memorycli`, `appwire/memoryops.go`)

- `mcpserver.Options.OnToolCall mcpcall.Hook`; `Build` calls `mcpcall.Record(srv, opts.OnToolCall)` after the tools
  are added. Nil: no recording (tests, scripts).
- `memorycli.Run` gains a last parameter `ops func(project string, importMode bool) (mcpcall.Hook, func())`: built
  once after `detectProject`, its close func deferred after `svc.Close`. Nil: no recording.
- `appwire/memoryops.go` (new, Space-only): `memoryOps(dbPath, ownersDir string) func(project string, importMode bool)
  (mcpcall.Hook, func())`.
  - `kira.db` missing → nil hook, never created (same rule as `readSettingsAt`). Opens with `sqlitex.Open` once for the
    process life (WAL; an idle connection holds no snapshot, so app checkpoints are not blocked). Probe
    `SELECT 1 FROM op_log LIMIT 0`: table missing (app older than migration 0060) → nil hook, one stderr line. Never
    runs migrations.
  - `ClaimOwner(ownersDir)`, then `oplog.New(oplog.WithStore(&repos.OpLogRepo{DB: db}), oplog.WithIDPrefix(token +
    "."))`, then one `Prune(now - Retention, MaxRows)`.
  - Hook: ctx `oplog.WithOrigin{Module: memory, Trigger: mcp, Label: "MCP " + tool}`; `Start(Meta{Category: mcp,
    Kind: tool, Source: "MCP " + tool, Subject: project, Background: importMode})`; `SetCommand(tool + " " +
    RedactJSON(args, 2<<10))`; done → `oplog.FinishCall`.
  - Import mode (`--import-ref`, the import runner's finalize agent): `Trigger auto`, `Background` true. Part 1's rule
    then applies unchanged: running and ok background rows are never written; only failures persist and reach the
    panel. An import of hundreds of facts does not flood the foreground lane.
  - Close func: `Log.Close()` (bounded drain), `db.Close()`, `Owner.Release()`, in that order.
- Any write failure is the `Log`'s existing `slog.Warn` to stderr; stdout stays protocol only.
- `RunArgvShim`'s `memory-mcp` case passes `memoryOps(config.DbPath(), opOwnersDir())`; `memory-ingest` passes nothing
  (it is not an MCP server).

### 5. What is not done, by design

- No Cancel from the panel for memory ops (`Cancellable` false): cancel would need a reverse channel; the agent's own
  client cancels the call.
- No nested steps under a memory op: memory tools spawn no git; their nested `claude` gate calls are the tool's own
  work, not app ops.
- Kira Studio does not run memory-mcp; nothing changes there.

## Files

New:
- `internal/mcpcall/record.go`
- `apps/kira-space/internal/oplog/foreign.go`, `apps/kira-space/internal/oplog/foreign_test.go`
- `apps/kira-space/internal/storage/repos/oplogforeign.go`
- `apps/kira-space/internal/appwire/memoryops.go`
- `apps/kira-space/internal/flows/memoryflow/ops_test.go`
- `apps/kira-space/tests/contract/space-ops-memory.json` (written by the flow test, `KIRA_CONTRACT=write`)
- `apps/kira-space/tests/ui/operations-memory.spec.ts`

Edited:
- `internal/agentmcp/optools.go` (adapter onto `mcpcall.Record`)
- `apps/kira-space/internal/ade/opsrecord.go` (`mcpRecorder` uses `oplog.FinishCall`)
- `apps/kira-space/internal/oplog/log.go` (`idPrefix` field, `Start` id line; `FinishCall` goes in `foreign.go`)
- `apps/kira-space/internal/storage/repos/oplog.go` (`ReconcileInterrupted` WHERE clause only)
- `apps/kira-space/internal/appwire/wire.go` (`RunArgvShim` memory-mcp case, `newOpLog` sweep and watcher start)
- `apps/kira-space/internal/appwire/appwire.go` only if the watcher's stop must hook the existing close path
- `internal/memory/mcpserver/server.go` (`Options.OnToolCall`, `Build` call)
- `internal/memory/memorycli/run.go` (`ops` parameter)
- `apps/kira-space/tests/claude/memory_test.go` (`KIRA_SPACE_HOME` in the MCP env at line 29; op_log assertion)
- `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md` (row path lists), `docs/v0.2.23/SPEC.md` (own row Result)

Every other `memorycli.Run` caller (`tests/claude/main_test.go` re-exec, flowharness `main.go` via `RunArgvShim`)
compiles through `RunArgvShim` or passes nil; the implementer greps `memorycli.Run(` and fixes each.

## Tests

Split at the IPC boundary per CLAUDE.md: Go flow half asserts the backend result and writes the contract; UI spec
half renders the same records.

- **Go flow** (`memoryflow/ops_test.go`, `TestMemoryMcpOps`, contract `space-ops-memory.json`). Uses the real
  memory-mcp subprocess (`memorySession`-style helper, env inherits the harness `KIRA_SPACE_HOME`) and reads the app
  through `OpsService.Recent` plus the `kira:op:update` event.
  - `#ok`: `search_memories` with a query containing `https://u:tok@host/x` → one row `module memory`, `category mcp`,
    `kind search_memories`, `trigger mcp`, `status ok`, `subject` the project key, `command` with `***`, id contains
    `.`; pushed on `kira:op:update` within 3 s.
  - `#error`: `memory_history` with an unknown id → row `status error` with the tool text.
  - `#running` then `#orphaned`: `store_memory` with a fakeagent gate rule using `WaitFile` → row `running`,
    `cancellable` false, in the app; `SIGKILL` the subprocess → row `error` "Memory MCP server stopped while this
    ran." within 3 s; the owner lock file is gone.
  - `#restart`: a second blocked `store_memory`, flowharness app restart while the child lives → row still `running`
    after restart (not reconciled); create the `WaitFile` → row `ok` ingested after restart.
  - No `kira.db`: memory-mcp with an empty temp `KIRA_SPACE_HOME` → `search_memories` succeeds, no `kira.db` created.
  - Import mode: reuse `import_test.go`'s finalize flow → no foreground `module memory` rows after the import.
- **Unit** (bar met: cross-process cursor and liveness races, lane merge rules):
  `oplog/foreign_test.go`: `Ingest` replaces by id, inserts by `StartedAt`, keeps caps, emits once per real change,
  never persists; `OwnerAlive` live/dead/missing and file removal; watcher cursor misses no row committed between
  `MaxRowID` and `Seed`, and re-reads running ids each change. Move the existing `OnToolCall` middleware unit from
  `internal/agentmcp` tests only if it now tests `mcpcall` alone; otherwise leave it.
- **UI spec** (`tests/ui/operations-memory.spec.ts`, header comment "backend half: memoryflow TestMemoryMcpOps",
  reads `space-ops-memory.json` via `./support/contract`): module cell `memory`, source `MCP search_memories`, error
  row Copy error writes the clipboard, running row shows the elapsed clock and no Cancel item, a pushed `onOpUpdate`
  for the running id flips it to error. A new file, not `operations.spec.ts` (P416 owns that one).
- **Real `claude`** (`docs/DEV_ENVIRONMENT.md` "Real `claude` tests"): Memory MCP and install row
  (`TestMemoryMcpThroughClaude|TestMemoryMcpFollowsDocs|TestMemoryInstallRegisters|TestMemoryDistill|TestMemoryDistillBridge`),
  ADE runs and sessions row and smart scripts row (`agentmcp/optools.go` changed). `TestMemoryMcpThroughClaude` gains
  a free assertion: `op_log` in `app.SpaceHome`'s `kira.db` holds `search_memories`, `store_memory` and
  `memory_context` rows, `module memory`. If that harness has no migrated `kira.db`, the test opens it through the
  app's storage open (migrates) before the claude run. Append `-count=1`.
- Full run once near the end: `go test ./...` (root and both apps), `bun run test:flows:space`, `bun run test:unit`,
  Space UI, `lint`, `lint:dead`, `lint:go`, `lint:claude`.

## docs/ARCHITECTURE.md edits (additive, Operations panel block and Known open items)

- New bullet after the persisted `op_log` bullet: out-of-process writers. memory-mcp writes `op_log` in `kira.db`
  through its own `oplog.Log` (same redaction, lanes, persist and prune rules); ids `<owner token>.<random>`; the
  owner holds `op-owners/<token>.lock` for its life. The app polls `PRAGMA data_version` (1 s) and ingests foreign
  rows by rowid cursor plus running ids, never persisting them. Start reconcile skips foreign rows; a running foreign
  row whose owner lock is free becomes `error`. Import-mode calls are background (failures only). Memory ops are not
  cancellable. No migration.
- Edit the MCP bullet: memory MCP calls share `mcpcall.Record` with `agentmcp`, status mapping `oplog.FinishCall`.
- Delete the Known open items entry "Memory MCP tool calls are not in the op log (P415 Part 2)", keep its last
  sentence (agent's own shell `git`) as its own entry if still true.
- `docs/DEV_ENVIRONMENT.md`: add `internal/mcpcall/**` to the ADE and smart scripts rows' path lists and
  `apps/kira-space/internal/appwire/memoryops.go` to the Memory MCP row.

## Commits (in order)

1. `refactor(mcp): shared tools/call recording middleware` — `internal/mcpcall`, `agentmcp/optools.go` adapter,
   `oplog.FinishCall`, `ade.mcpRecorder` onto it.
2. `feat(oplog): ingest op rows written by other processes` — `foreign.go` (owner, id prefix, `Ingest`,
   `WatchForeign`), `log.go` id prefix, `repos/oplogforeign.go`, `ReconcileInterrupted` skip, `newOpLog` sweep and
   watcher.
3. `feat(memory): record memory MCP tool calls in the op log` — `mcpserver.Options.OnToolCall`, `memorycli.Run`
   parameter, `appwire/memoryops.go`, `RunArgvShim`.
4. `test(oplog): foreign ingest and owner liveness units`.
5. `test(flows): memory MCP op flow and contract` — `TestMemoryMcpOps`, `space-ops-memory.json` (write, rerun
   `-count=2`), `tests/claude/memory_test.go` env and assertion.
6. `test(ui): memory MCP rows in the Operations panel`.
7. `fix: …` follow-ups from the full run, grouped by root cause.
8. `docs: document out-of-process op log writers` — ARCHITECTURE.md, DEV_ENVIRONMENT.md.
9. `docs: mark P415 Part 2 done with result` — own SPEC.md row Result, real `claude` rows run and spend.

## Streams

Part 2 runs alone as **one stream** (Stream A). It must not be split: commits 1 to 3 are a dependency chain and the
tests read their output.

Parallel with P416 (Stream B: Operations panel frontend, automation-runs UI) is possible with these boundaries.

| Stream | Owns (exclusive) |
| --- | --- |
| A (P415 Part 2) | `internal/mcpcall/**` (new); `internal/agentmcp/optools.go`; `internal/memory/mcpserver/server.go`; `internal/memory/memorycli/run.go`; `apps/kira-space/internal/oplog/foreign.go`, `foreign_test.go` (new); `apps/kira-space/internal/storage/repos/oplogforeign.go` (new); `apps/kira-space/internal/appwire/memoryops.go` (new); `apps/kira-space/internal/ade/opsrecord.go`; `apps/kira-space/internal/flows/memoryflow/ops_test.go` (new); `apps/kira-space/tests/contract/space-ops-memory.json` (new); `apps/kira-space/tests/ui/operations-memory.spec.ts` (new); `apps/kira-space/tests/claude/memory_test.go` |
| B (P416) | Operations panel frontend (`OperationsPanel.vue` both apps, `OpLogPanel.vue`, `createOpLogStore.ts`, `opsDomain.ts`, `lib/opLog.ts`), automation-runs UI (`packages/workbench/src/automations/runs/**`), `internal/scriptruns/**`, `oplog/record.go` (new category), next migration `0061` (Part 2 adds none), `tests/ui/operations.spec.ts`, `en.json` |

Shared at hunk level (no file is fully exclusive; each stream edits only the named part):

- `apps/kira-space/internal/oplog/log.go`: A adds the `idPrefix` field and changes the one `ID:` line in `Start`.
  B must not edit `Log.Start`; anything else B needs there goes in a new file of the package.
- `apps/kira-space/internal/storage/repos/oplog.go`: A edits only the `ReconcileInterrupted` WHERE clause. If B adds
  columns for automation runs it edits `Upsert`/`Recent`/the scan; disjoint hunks.
- `apps/kira-space/internal/appwire/wire.go`: A edits `RunArgvShim`'s `memory-mcp` case and `newOpLog`. B likely wires
  a scriptruns recorder in `appwire`; it must not edit those two functions.
- `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md`: additive bullets in separate places.
- `docs/v0.2.23/SPEC.md`: each stream writes only its own row Result.
- `packages/theme/src/i18n/en.json`: A does not touch it (Go-side text, no new UI string). B only.

Verdict: Part 2 is one stream. Against P416, zero file overlap is not achievable: `oplog/log.go`, `repos/oplog.go`,
`appwire/wire.go` and the two docs are shared at hunk level. The parallel run is safe only if P416's plan accepts the
function-level boundaries above (rebase merges disjoint hunks). Otherwise run P415 Part 2 then P416 sequentially, which
CLAUDE.md's table order already asks for.
