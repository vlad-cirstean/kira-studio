# P201 notes: Memory MCP server and Memory module (stream D)

Plan: `P201-plan.md`. Branch `v2.1-stream-D`. Eight code commits plus this one.

## What landed

| Commit | Content |
|---|---|
| `5d62d11` | `internal/memory` schema, `Store`, `BuildMatch` recall-first search, `sqlitex.OpenImmediate`, `KIRA_MEMORY_HOME` in `testx` |
| `e68a955` | `memory.CLIRunner` (isolated `claude -p`), `toolexec.RunIO`/`ClaudeCandidates`, `mcpinstall` on the shared candidate list |
| `25c09b2` | `gate.go`, `reconcile.go`, `service.go` |
| `c7df00e` | `mcpserver` (`store_memory`, `search_memories`, `memory_history`, prompt `remember`), `memorycli`, `mcpinstall.StdioCommand`/`InstallStdio`, `claudesmoke` test |
| `1655545` | `bridge.MemoryService` |
| `7b1f981` | `packages/shared/domain/memory.ts`, `packages/workbench/src/memory/**` |
| `16967ba` | Seam commit: Memory mode, `main.go` subcommand and wiring, `memoryControl`, mock runtime entries |
| `abe857c` | `memory-module.spec.ts`; mode-tab count 3 to 4 in `mode-switch.spec.ts`, `terminal-module.spec.ts` |

## Deviations from the plan

- All edits to shared seam files (`main.go`, `mode.ts`, `modes.ts`, `window.go`, `App.vue`,
  `bridge/index.ts`, `events.ts`, `mockRuntime.ts`, `ipcChannels.ts`) sit in one commit
  (`16967ba`) at the coordinator's request. The `memory-mcp` branch in `main.go` therefore landed
  there, not in the MCP server commit. Group 4 was verified through `memorycli` and an in-memory
  transport; the real-binary check ran after the seam commit.
- `ChannelMemoryChanged` lives in `bridge/memory.go`, not `bridge/events.go`: one fewer shared
  file. Move it if stream B edits `events.go` and prefers one list.
- `memoryControl.ts` imports `@bindings/memoryservice.js` itself and exports `memoryControl`;
  `bridge/index.ts` only spreads it. `workbench/memoryModule.ts` returns `{ control }`.
- `Service.Close` is the package-level `bridge.CloseMemory`: Wails binds every exported method of
  a registered service.
- `StoreRequest` gained `Progress func(stage string)`: `store_memory` forwards it as MCP
  progress notifications (`checking`, `reconciling`, `saving`).
- `toolexec.RunIO` returns captured stdout also alongside an `*ExecError`: `claude -p` prints its
  structured error (`is_error`, `subtype`) to stdout and exits non-zero.
- `commitFact` returns the post-commit revision. Without it a request storing several facts
  counted its own insert as a concurrent writer and reran reconcile.
- Added `ErrClaudeOutdated` (unknown-flag stderr maps to "update Claude Code", plan §13).
- Mode-tab count asserts in `mode-switch.spec.ts` and `terminal-module.spec.ts` went 3 to 4;
  `modeTab()` in `support/apiMode.ts` accepts `'memory'`.

## Verification

- `go test -race ./internal/memory/... ./internal/toolexec/... ./apps/kira-studio/internal/...`,
  `bun run lint`, `bun run lint:go`, `bun run lint:dead`, `bun run typecheck`: green.
- `bun run test:ui:studio` equivalent (full `ui` + `ui-timing`): 334 passed, 1 failed.
  The failure, `slick-grid.spec.ts` "pacing invariant holds with N staged insert rows", is a
  timing test unrelated to this phase; it passes alone (22 s).
- No visual baseline failed. None regenerated.
- Real Claude smoke, `go test -tags claudesmoke ./internal/memory/ -run Smoke -v` (CLI 2.1.292,
  authenticated): ambiguous item challenged; clear item `add`; refining item `update` (v2, old
  row searchable only with history). 13.7 s for five Sonnet calls.
- Real MCP path: `go build -tags server ./apps/kira-studio`, then
  `claude -p --mcp-config` with the stdio server (`<binary> memory-mcp`, temp
  `KIRA_MEMORY_HOME`): Claude called `store_memory` (status `stored`), then a second run reported a
  `noop` through the hash short-circuit, and `search_memories` returned the row. `memory-mcp` with
  closed stdin exits 0.
- Run the smoke again: `go test -tags claudesmoke ./internal/memory/ -run Smoke -v`. Needs an
  authenticated `claude` on `PATH`. Costs a few cents.

## Proposed `ARCHITECTURE.md` section: "Memory MCP server and module (P201)"

- Storage: `$KIRA_MEMORY_HOME/memory.db` (default `~/.kira-memory/memory.db`), its own SQLite file
  and migration sequence (`internal/memory/migrations`), shared by Kira Studio and the stdio
  server. Opened lazily with `_txlock=immediate`; WAL, `busy_timeout` 5000.
- Schema: `memories` (immutable versions; `current`/`superseded`; one current row per lineage by
  partial unique index; update and delete blocked by trigger except `current` to `superseded`),
  `memories_fts` (FTS5 external content, `porter unicode61 remove_diacritics 2`, prefix 2 3),
  `memory_revision` (insert counter), `memory_events` (every add/update/noop with author, source,
  request id, rationale).
- Search is recall-first: every term a quoted prefix term OR-ed, plus the whole phrase; stopwords
  dropped; gate-written keywords indexed; bm25 `(10, 2, 4)` orders only; no score cutoff. One
  builder (`memory.BuildMatch`) serves MCP, module and reconcile candidates. User input never
  reaches FTS5 as syntax.
- Pipeline: `Service.Store` = validation, gate (one Sonnet call, splits into atomic facts,
  challenges ambiguity, adds keywords), reconcile (one call for facts with candidates; hash
  short-circuit and no-candidate add skip it), commit per fact in one `BEGIN IMMEDIATE`
  transaction with an optimistic revision check (2 retries). A challenge stores nothing and is
  stateless: the caller resubmits with `clarifications`. At most 2 pipelines run at once.
- Claude Code isolation: `claude -p --model sonnet --safe-mode --setting-sources "" --strict-mcp-config
  --tools "" --disable-slash-commands --no-session-persistence --permission-prompts none
  --output-format json --json-schema … --system-prompt … --max-budget-usd 0.50`; input on stdin;
  empty temp cwd; session env variables stripped, auth variables kept; 120 s timeout. Not
  `--bare` (forces API-key auth).
- MCP server: `<Kira Studio binary> memory-mcp`, stdio, spawned per session by Claude Code, so it
  works with the app closed. Tools `store_memory`, `search_memories`, `memory_history`; prompt
  `remember` (slash command `/mcp__kira-memory__remember`). Registered with
  `claude mcp add-json --scope user kira-memory` from the Connect dialog.
- Studio: `MemoryService` opens the store on first call, emits `kira:memory:changed` after its own
  writes and, via a 2 s `PRAGMA data_version` watcher, after the MCP subprocess writes. Module is
  a panel mode (`memory`): search panel, detail with version trail, Add memory and Connect dialogs.
- Failure modes: no `claude` on `PATH` or not logged in surfaces a typed message in the dialog and
  as an MCP tool error; the gate can over-challenge; model latency 5 to 20 s per store.
- Known open items to add: Kira Space does not host the module or the subcommand; no semantic
  (embedding) search; stored memories are not deletable by design.

## Proposed `DEV_ENVIRONMENT.md` lines

- `KIRA_MEMORY_HOME` scopes `memory.db` (default `~/.kira-memory`). `testx.RunWithTempHomes` sets
  it for test binaries.
- Memory smoke against the real CLI (not in CI): `go test -tags claudesmoke ./internal/memory/
  -run Smoke -v`; needs an authenticated `claude`. For the MCP path build with `go build -tags
  server ./apps/kira-studio` and run `claude -p --mcp-config <file> --strict-mcp-config` with a
  `stdio` server `{command: <binary>, args: ["memory-mcp"], env: {KIRA_MEMORY_HOME: <tmp>}}`.

## Failing visual baselines

None.
