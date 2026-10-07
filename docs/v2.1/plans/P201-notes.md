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

---

# Part 2 notes: move the Memory module to Kira Space

## What landed

- `5fb98e6` `internal/mcpinstall` hoisted to repo root. Header-helper trio moved to
  `apps/kira-studio/internal/mcpauth/helperscript.go`. `ShellQuote` exported.
- `eae7ab3` the move, one commit with `git mv` for `bridge/memory.go`, `memoryControl.ts`,
  `memoryModule.ts`, `memory-module.spec.ts`. Space: `memory-mcp` branch, `MemoryService`
  registration and `CloseMemory` teardown, `memory` mode (last), `windows.mode` vocabulary entry,
  App.vue provide, bridge spread, UI mocks. Studio back to v2.0 content apart from the `mcpinstall`
  import path. `ConnectClaudeDialog.vue` gained the E7 sentence.
- `633a8d6` fix: `gocognit` rejected `main` (32 > 30) after the second argv branch. Both shims now
  run from `runArgvShim`.

## Deviations from the plan

- Base is current v2.0 (`42c6813`, stream F merged), not `1721559`. `git diff v2.0 -- apps/kira-studio`
  held only Part 1, so Studio files were restored from `v2.0`.
- `SPEC.md` rebase conflict: the single P201 row (v2.0 side) became the two Part rows, kept
  before P203.
- `mode-switch.spec.ts` title and comment say four mode tabs (v2.0 said three, count was 4).
- Space `main.go` bound-service count in the startup comment updated to 18 (was stale).
- `memory-module.spec.ts` in Space defines a local `modeTab` (no `support/apiMode` there).
- Mode order union with stream F's P206 not applied here: base order is still `git, terminal, ade,
  memory`. P206 resolves to `git, ade, terminal, memory` when it lands.

## Verification

- `go build ./apps/kira-space/... ./apps/kira-studio/... ./internal/...`; `go build -tags server` for
  both apps. `go test -race ./internal/... ./apps/kira-space/... ./apps/kira-studio/...` green.
- `bun run lint`, `lint:go` (0 issues), `lint:dead` (knip clean), `typecheck` green via the hook.
- `bun run test:ui:space`: 200 passed. `bun run test:ui:studio`: 336 passed, 1 failed, 4 did not
  run. Failure is `slick-grid.spec.ts:1220` (P22 Pass B C9 pacing invariant, renders-per-frame
  `< 2`). It is flaky on pristine `v2.0` too (1 of 3 runs failed in `/home/user/kira-studio`), so
  unrelated to this move. Root cause is a timing property of the grid scroll path under sandbox
  load; fixing it is grid-scroll work outside P201. Proposed follow-up phase for the user to place.
- Real MCP path: `-tags server` Space binary, `claude -p --strict-mcp-config --mcp-config` with
  `KIRA_MEMORY_HOME` temp. `store_memory` returned `stored`. `search_memories` returned the fact,
  also while a Space server instance held `app.lock`. `printf '' | kira-space memory-mcp` exits 0.
- Visual check: Playwright screenshots of the Memory mode in Space (list, detail with version
  trail, search with history). Spacing and proportions match the Studio module.
- Unverified: macOS app-bundle binary spawned as a CLI child.
- Greps: `memory-mcp` in `apps/*/main.go` only in Space; `NewMemoryService` only in Space; no
  `apps/kira-studio/internal/mcpinstall`; `internal/mcpinstall` imports nothing under `apps/`.

## Proposed `ARCHITECTURE.md` edits

Replace Studio with Space in the Memory section:

- MCP server: `<Kira Space executable> memory-mcp`, branch in `apps/kira-space/main.go` before
  `startupfail` and `acquireSingleInstance`, so Claude Code can spawn it while the window is open.
  Registration name `kira-memory`.
- Bridge: Space `MemoryService` (`apps/kira-space/internal/bridge/memory.go`), `memory` mode last in
  `MODE_ORDER`, `windows.mode` vocabulary gains `memory`. Studio hosts no Memory module.
- `internal/mcpinstall` is repo-root, shared; DB MCP header-helper script lives in Studio's
  `mcpauth`.
- Known open items: replace "Kira Space does not host the module or the subcommand" with "Kira
  Studio does not host the Memory module". Add: the memory mode shows an empty tab strip.

## Proposed `DEV_ENVIRONMENT.md` edits

Memory smoke: build with `go build -tags server ./apps/kira-space`; the stdio server entry uses
that binary with `args: ["memory-mcp"]`.

## Failing visual baselines

All are the sandbox font-drift signature (1 to 3 percent, glyph-wide, no element moved), not
regressions. None regenerated.

- Space: `settings.spec.ts` Appearance, Git, Connected editors, Advanced panes.
- Studio: `connection-dialog`, `console`, `data-view`, `http-request-view`, `schema-dialog`,
  `terminal-module` (quick commands dialog, empty), `workbench` (shell at rest), and
  `settings.spec.ts` Appearance, Data, Cache, Api, Database MCP, Advanced panes.
