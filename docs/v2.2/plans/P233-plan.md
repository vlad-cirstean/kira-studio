# P233 plan: Claude Code configuration only through Kira Space session launches

SPEC row P233. User's words: "I think there are some settings that hook into claude code. I want the
hooking to be done only for sessions started by kira space. So no changes into the actual
settings.json. This is another phase."

Base: `v2.0` at `6b6294118`. Branch `v22-fix-P233`. One sequential Sonnet implementer (no split:
the Go changes, wire shapes and UI form one dependency chain).

Discovery: `codegraph_explore` (indexed tree, same commit as base) for `internal/agenthooks`,
`internal/mcpinstall`, `internal/memory/claude.go`, Studio `bridge/dbmcp.go`, workbench memory
settings. `apps/kira-space/**` is not indexed; read directly. CLI facts below were measured against
the installed `claude` 2.1.295 in a throwaway `HOME`.

## 1. Audit

Every place either app reads or writes the user's Claude Code configuration, or sets process env for
a `claude` process. "Global" means it changes a file Claude Code reads for sessions Kira did not
start.

| # | What | Where | Writes | Trigger | Scope today |
|---|---|---|---|---|---|
| A1 | Memory MCP "Register with Claude Code" | Space Settings > Memory > Connect Claude Code (`ClaudeCodeMcpSection.vue` → `MemoryService.InstallClaudeCode`, `apps/kira-space/internal/bridge/memory.go:340`) → `mcpinstall.InstallStdio` → `register` (`internal/mcpinstall/install.go:211`) | runs `claude mcp remove --scope user kira-memory` then `claude mcp add-json --scope user kira-memory {"type":"stdio","command":"<Kira Space exe>","args":["memory-mcp"]}`. CLI writes top-level `mcpServers.kira-memory` in `~/.claude.json` (`$CLAUDE_CONFIG_DIR/.claude.json` when set; measured) | user click | **Global** |
| A2 | DB MCP "Install in Claude Code" | Studio Settings > Database MCP (`DatabaseMcpPane.vue` `db-mcp-install-button` → `DbMcpService.InstallClaudeCode`, `apps/kira-studio/internal/bridge/dbmcp.go:328`) → `mcpinstall.Install` | same remove + `add-json --scope user kira-db {"type":"http","url":"http://127.0.0.1:8766/mcp","headersHelper":"'<KIRA_HOME>/mcp-header-helper.sh'"}` into `~/.claude.json` | user click | **Global** |
| A3 | Copy-paste commands | `mcpinstall.StdioCommand` (Space status `command`), `mcpinstall.Command` (Studio status `command`) | none by Kira; shows a `--scope user` command | display | user's own action |
| A4 | Legacy entries from earlier versions | v1.9 pre-F2 DB MCP: `claude mcp add --transport http --scope user kira-db <url> --header "Authorization: Bearer <token>"` (`git show 42f5ca307`); v1.5-v1.8 repo-map: same form, name `kira-repo-map`, `http://127.0.0.1:<port>/mcp` (`git show 5b7392367`, removed `31983411a`) | entries still sitting in users' `~/.claude.json` | earlier clicks | **Global, stale** |
| A5 | Agent hooks (ADE + terminal agent tabs) | `internal/agenthooks` `New` writes `hooks.json` + `hook` shim into a 0700 `mkdtemp` dir (`kira-agent-*`), deleted on `Close`; `Manager.ComposeLaunch` appends `--settings '<hooks.json>'` and env `KIRA_TERMINAL_ID`, `KIRA_AGENT_HOOK_SOCKET`, `KIRA_AGENT_HOOK_TOKEN`; wired by `appwire/wire.go:95` `tracker.SetHooks`; applied in `ade.Tracker.Compose` for every `LaunchKindClaudeCode` open (`internal/terminal/bound.go:117`) | temp files only | Kira Space claude-code launch | **Per session** already. Gap: shim is not env-gated (posts with an empty token if ever loaded elsewhere; harmless 401, but not inert) |
| A6 | ADE TUI grant | `ade/launches.go:291` `--mcp-config <0600 file> --allowedTools ...`; file under `<KIRA_SPACE_HOME>/ade/runs`, pruned by `recover.go:38` | Kira home only | ADE launch | Per session |
| A7 | ADE headless runs | `adeagent/process.go:76` `claude -p --mcp-config <file> --setting-sources user\|user,project,local` | none (reads settings per `ade.headlessSettingSources`) | ADE run | Per session |
| A8 | Memory gate/reconcile/import `claude -p` | `internal/memory/claude.go:102` `--setting-sources "" --strict-mcp-config --tools ""`, inline `--mcp-config`, temp cwd, scrubbed env | none | memory store/import | Per call, fully isolated |
| A9 | Studio agent hooks | removed in P127 (`bound.go:109`); Studio `TerminalService` leaves `ComposeAgent` nil | none | — | n/a |
| A10 | `~/.claude/settings.json`, project `.claude/settings(.local).json`, `.mcp.json`, `CLAUDE.md`, statusline, `claude config` | grep over `apps internal packages scripts` (Go/TS/Vue/sh, non-test): no writer. Only reads: `toolexec.ClaudeCandidates` stats `~/.claude/local/claude` | none | — | **Nothing to change** |
| A11 | Askpass | `gitaskpass/broker.go:141` sets `GIT_ASKPASS`/`SSH_ASKPASS` on git spawns | env of Kira's own git processes only | git ops | Not Claude config |
| A12 | Connected editors, mobile web | `apps/kira-space-vscode`, `mobileweb`, `mobileterm`: no Claude config access; phone attach reuses the already-composed PTY | none | — | n/a |
| A13 | Claude CLI's own state | the real CLI rewrites `~/.claude.json` (counters, `projects[<cwd>]` trust) and `~/.claude/backups`, `policy-limits.json` on every invocation (measured) | CLI-owned | any real `claude` run | Not Kira's write; out of scope. Reason the regression test runs the fake CLI |

Global writes to fix: A1, A2. Stale data to migrate: A1, A2 and A4 entries. Hardening: A5 shim gate.
Everything else is already per session or not Claude config.

## 2. Design

### 2.1 Per-session MCP injection (replaces A1, A2)

- Kira Space adds a second per-launch flag beside `--settings`: `--mcp-config '<file>'`. Measured:
  `--mcp-config <configs...>` is variadic and a repeated flag accumulates (`claude -p --mcp-config
  a.json --mcp-config b.json` validated both files), so it composes with A6's own `--mcp-config`.
  Never `--strict-mcp-config` in interactive sessions: it would drop the user's own servers.
- File: `<agenthooks dir>/mcp-<seq>.json`, 0600, one per launch (counter, not terminal id, so no
  quoting risk), removed with the dir on `Server.Close`. Content `{"mcpServers": {...}}`:
  - `kira-memory`: `{"type":"stdio","command":"<memoryExecutable()>","args":["memory-mcp"]}`. Always.
  - `kira-db`: `{"type":"http","url":...,"headersHelper":"'<helper>'"}` only while Studio's DB MCP
    server runs (2.3). Same names as before, so `/mcp__kira-memory__remember` and tool names keep
    working.
- Hook point: `agenthooks.Options` gains `SessionMCP func() ([]byte, error)`. `ComposeLaunch`
  calls it, writes the file and appends ` --mcp-config '<path>'` after `--settings`. nil func or an
  error: log once per launch (`slog.Warn`, scope `ade`) and compose without it; a launch never
  fails for MCP. Rationale for living in `agenthooks.Manager`: it is already the one launch
  composer with a lifecycle-managed private dir; a second package would need its own teardown in
  `appwire` (P231 territory). Rename its doc to "launch composer"; no package rename.
- Covers every Kira Space claude-code launch: terminal agent tabs (no intent → hooks-only path
  `tracker.go:362`), ADE TUI stage/review sessions (`Tracker.Compose`), phone attach (same PTY).
  Variadic safety: Tracker appends ` -- '<message>'` after; `--add-dir a b` / `--allowedTools x y`
  precede it and are terminated by the `--settings` option.
- Not covered: ADE headless runs (A7). D3.
- Space provider: `bridge.SessionMCPConfig()` (new `apps/kira-space/internal/bridge/claudesession.go`)
  builds the doc via `claudecfg.SessionConfig`, using `memoryExecutable()` and `claudecfg.ReadDBEndpoint`.

### 2.2 Hook shim env gate (A5)

`buildShim` gains, before curl: `[ -n "$KIRA_AGENT_HOOK_TOKEN" ] && [ -n "$KIRA_TERMINAL_ID" ] || exit 0`.
A `hooks.json` loaded anywhere else is inert. No other change: hooks already reach only Kira-started
sessions.

### 2.3 DB MCP endpoint discovery (keeps DB MCP inside Kira Space sessions)

- Studio `DbMcpService` `StartFn`, after `dbmcp.New` succeeds: `claudecfg.WriteDBEndpoint(home,
  {URL: srv.URL(), HeadersHelper: <helper path>})` → `<KIRA_HOME>/mcp-db-endpoint.json`, 0600,
  atomic. `StopFn`: remove it. Failure to write: `slog.Warn`, server still runs.
- Space reads `kirapaths.Home("KIRA_HOME", ".kira-studio")` + that file. Inject `kira-db` only when:
  URL is `http://127.0.0.1:<port>/mcp`, helper is an absolute existing file, and a TCP dial to the
  port succeeds within 300 ms (stale file after a Studio crash). Space never imports Studio's
  `internal/` packages (Go forbids it); the shared contract lives in root `internal/claudecfg`.
- Token rotation needs nothing: the helper script reads the live token file (F2 design).

### 2.4 Legacy cleanup (migration for A1, A2, A4)

Root package `internal/claudecfg`:
- `ConfigPath(getenv, home)`: `$CLAUDE_CONFIG_DIR/.claude.json` when set, else `<home>/.claude.json`.
- `DetectLegacy(path) (Legacy, error)`: read-only parse of the top-level `mcpServers` only (never
  `projects[*].mcpServers`: Kira always used `--scope user`). Missing file → empty, no error.
  Exact-match rules, every field checked, anything extra (e.g. `env`) → not ours:
  - `kira-memory`: `type` `stdio`; `args` exactly `["memory-mcp"]`; `command` absolute and its base
    is `Kira Space` or `kira-space`, or equals the running executable.
  - `kira-db`: `type` `http`; `url` `http://127.0.0.1:8766/mcp` or `http://localhost:8766/mcp`; and
    either `headersHelper` is `'<abs>/mcp-header-helper.sh'` (quoted or bare), or `headers` is exactly
    `{"Authorization": "Bearer <non-empty>"}` (pre-F2 form).
  - `kira-repo-map`: `type` `http`; `url` `http://127.0.0.1:<1-65535>/mcp`; `headers` exactly one
    `Authorization: Bearer ...` (no helper form ever shipped for it).
  Entry projection on the wire: name + a one-line summary (command or URL); never a token value.
- `CleanupLegacy(ctx, deps, path, names)`: re-detects (only names still matching are touched), copies
  the file byte-for-byte to `<app home>/claude-config-backups/claude.json.<UTC yyyymmddThhmmssZ>`
  (dir 0700, file 0600) before any change, then per name runs `claude mcp remove --scope user <name>`
  through `mcpinstall` (CLI owns the file format and its own write safety; measured: remove deletes
  only that key). `No MCP server named` counts as removed. Then re-detects and reports
  `removed[]`, `remaining[]`, `backupPath`. CLI not found → outcome `notFound` with the exact
  remove commands to copy; nothing edited, no backup made.
- Never runs on its own: no startup hook, no auto-cleanup. Detection is a read the Settings pane
  makes when it opens (TanStack Query).
- Both apps list every Kira-written entry (one matcher list): a user with only one app installed
  still sees all of them.

### 2.5 `mcpinstall` after the change

Delete `Install`, `InstallStdio`, `register`, `StdioCommand`, `serverJSON`/`stdioServerJSON` users
that no longer exist. Keep `New`, `Status`, `ShellQuote`, `Command` (Studio's copy text, D2). Add
`Remove(ctx, name) Result` (the `mcp remove --scope user` half of old `register`, same
not-registered tolerance). `McpInstaller` (Studio) and `MemoryMcpInstaller` (Space) become
`{Status(); Remove(ctx, name)}`; `mcpinstall.New(mcpinstall.Deps{})` call sites in `apps/kira-studio/main.go`
and `appwire/appwire.go:189` stay byte-identical.

### 2.6 Wire shapes and bound methods

No new bound service (keeps `appwire` `Bound()` count and Studio `main.go` registration unchanged).
- Space `MemoryService`: delete `InstallClaudeCode`. `McpStatus` → `{executable, claudeAvailable,
  claudePath, probed}` (drop `command`). Add `ClaudeLegacy() ClaudeLegacyStatus` and
  `RemoveClaudeLegacy(ctx) ClaudeLegacyCleanup`.
- Studio `DbMcpService`: delete `InstallClaudeCode`. Add the same two methods. `DbMcpStatus.command`
  stays (D2).
- `packages/shared/domain/claudeConfig.ts` (new): `claudeLegacyStatusSchema` `{file, entries:
  [{name, summary}]}`, `claudeLegacyCleanupSchema` `{outcome: 'removed'|'nothing'|'notFound'|
  'failed', removed[], remaining[], backupPath, detail, commands[]}`. `memory.ts`: update
  `memoryMcpStatusSchema`, delete `memoryInstallResultSchema`. `dbmcp.ts`: delete
  `DbMcpInstallResult`.
- Regenerate bindings (`wails3 task common:generate:bindings`, DEV_ENVIRONMENT) for both apps.

### 2.7 UX

- Space Settings > Memory: `ClaudeCodeMcpSection.vue` becomes "Claude Code" status, no buttons:
  "Claude Code sessions Kira Space starts (agent terminal tabs, ADE sessions) get the kira-memory
  tools: store_memory, search_memories, memory_history and /mcp__kira-memory__remember. Kira Space
  does not change your Claude Code configuration." Plus CLI line: found at `<path>` / not found,
  with probed paths. `data-testid="memory-mcp-section"` kept; `memory-mcp-command`,
  `memory-mcp-copy`, `memory-mcp-install`, `memory-mcp-install-outcome` removed.
- Studio Settings > Database MCP: delete Install button and outcome. Text: "Claude Code sessions
  Kira Space starts get kira-db while this server runs." Command block kept behind a "Use outside
  Kira Space" disclosure, labelled as a command to run yourself (D2).
- Shared `packages/workbench/src/claude/LegacyClaudeConfigSection.vue` (both apps, props: status +
  remove functions, TanStack Query inside): hidden when no entries. Otherwise: "Earlier versions of
  Kira registered these MCP servers in your Claude Code configuration (`<file>`): kira-memory, ...
  Kira no longer needs them." Button "Remove…" opens shadcn `Dialog` confirm naming the file, the
  entries and the backup location; confirm runs the cleanup; result line shows removed/remaining and
  the backup path, or the copyable commands on `notFound`. Tailwind utilities only; `<script setup
  lang="ts">`. Mounted under the memory status (Space) and under the DB MCP pane (Studio).
- Space `memoryControl.ts`, workbench `module.ts`/`queries.ts` (`useInstallMemoryMcp` deleted;
  `useClaudeLegacy`, `useRemoveClaudeLegacy` added, invalidate on success). Studio
  `state/dbmcp.ts` drops `installResult`/`installDbMcpClaudeCode`; legacy calls go through
  TanStack Query in the section, not the Pinia store.

## 3. File ownership

P233 owns:
- new `internal/claudecfg/{session.go,endpoint.go,legacy.go,cleanup.go,legacy_test.go}`
- `internal/agenthooks/{agenthooks.go,manager.go,shim.go,server_test.go}`
- `internal/mcpinstall/{install.go,install_test.go}`
- `apps/kira-space/internal/bridge/memory.go`, new `apps/kira-space/internal/bridge/claudesession.go`
- `apps/kira-studio/internal/bridge/dbmcp.go`, new `apps/kira-studio/internal/bridge/dbmcp_claude_test.go`
- new `apps/kira-space/internal/flows/claudeflow/{doc.go,main_test.go,helpers_test.go,isolation_test.go,legacy_test.go}`
- `apps/kira-space/frontend/bindings/**`, `apps/kira-studio/frontend/bindings/**` (regenerated)
- `packages/shared/domain/{memory.ts,dbmcp.ts}`, new `packages/shared/domain/claudeConfig.ts`
- `packages/workbench/src/memory/{module.ts,queries.ts}`, `packages/workbench/src/memory/settings/ClaudeCodeMcpSection.vue`,
  new `packages/workbench/src/claude/LegacyClaudeConfigSection.vue`
- `apps/kira-space/frontend/src/bridge/memoryControl.ts`,
  `apps/kira-space/frontend/src/workbench/settings/MemoryPane.vue` (mounts the legacy section)
- `apps/kira-studio/frontend/src/{state/dbmcp.ts,bridge/index.ts,workbench/settings/DatabaseMcpPane.vue}`
- `apps/kira-space/tests/ui/{settings-memory.spec.ts,support/mockRuntime.ts,support/ipcChannels.ts}`,
  `apps/kira-space/tests/visual/settings.spec.ts` + its baselines
- `apps/kira-studio/tests/ui/support/{mockRuntime.ts,ipcChannels.ts}`
- `docs/ARCHITECTURE.md` (memory MCP, agent hooks, DB MCP sections, Known open items),
  `docs/DEV_ENVIRONMENT.md` (Memory MCP section), this plan

Overlap with the concurrent P231 fixer (`/home/user/kira-v22-A`), stated exactly:
- `apps/kira-space/internal/appwire/wire.go`, function `wireTracker` only: the
  `agenthooks.NewManager(agenthooks.Options{...})` literal gains one field
  `SessionMCP: bridge.SessionMCPConfig,`. No other line in `appwire/**`.
- `apps/kira-space/internal/flows/memoryflow/store_test.go`: delete `TestConnectClaudeCode` (asserts
  the global `add-json`), plus imports and `recordedArgs`/`callNumber` only if then unused.

Not touched (P231's): `flowharness/**` incl. `fakeagent`, `appwire/appwire.go` and `Options`,
`internal/shell/wails.go`, `gitsession`, `ade/**`, `adeagent/**`, `bridge/mobile*.go`, other flow
packages. The fake CLI's `mcp` emulation lives in claudeflow's own `TestMain` (4.1), not `fakeagent`.
Landing: rebase onto `v2.0` after P231 lands; a conflict outside the two lines above means this
table was wrong: stop and report.

## 4. Tests (test-first)

Unit-test bar: `legacy_test.go` qualifies (matcher with several interacting rules per entry kind).
Everything else is real-flow.

### 4.1 Kira Space real flow: `flows/claudeflow`

- `main_test.go`: `TestMain` checks `os.Args[1] == "claudecfg-emulate"` first and runs
  `emulateMcp(os.Args[2:])`, else `flowharness.Main(m)`.
- `helpers_test.go`:
  - `fakeCLI(t, app)`: renames the harness's `<BinDir>/claude` symlink to `<BinDir>/real/claude`
    (memoryflow `jsonClaude` precedent) and writes `<BinDir>/claude`:
    `case "$1" in mcp) exec '<test binary>' claudecfg-emulate "$@";; *) exec '<real>' "$@";; esac`.
  - `emulateMcp`: emulates the real CLI on `$CLAUDE_CONFIG_DIR/.claude.json` or `$HOME/.claude.json`:
    `mcp add-json --scope user N J` sets `mcpServers[N]`; `mcp remove --scope user N` deletes it or
    prints `No MCP server named "N" in user scope` with exit 1. Appends argv to
    `<KIRA_FAKE_DIR>/cfg-<n>.args`.
  - `seedClaudeConfig(t, home, repo)`: writes `~/.claude/settings.json` (a user `PostToolUse` hook,
    `permissions.allow`), `~/.claude/settings.local.json`, `~/.claude.json` (`mcpServers.mine` stdio
    entry, a `projects` map), `<repo>/.claude/settings.json`, `<repo>/.claude/settings.local.json`,
    `<repo>/.mcp.json`, `<repo>/CLAUDE.md`.
  - `snapshot(t, roots...) map[string]string`: relative path → mode + sha256 for every regular file
    under `~/.claude/`, `~/.claude.json` and the repo's `.claude/`, `.mcp.json`, `CLAUDE.md`; also
    records absence of files that must not appear (`~/.claude/settings.json` created, etc.).
  - minimal ADE helpers copied from `adeflow` (import repo, create task, launch first stage); not
    imported, `adeflow` helpers are `_test` files.
- `isolation_test.go` `TestClaudeConfigUntouched`, one app, `fakeCLI` + seed, `before := snapshot`,
  subtests in order, each ends with `snapshot == before` (failure names flow and changed paths):
  1. `memory_connect`: `Memory.McpStatus()`; pre-fix also `Memory.InstallClaudeCode(ctx)` (the
     button); post-fix `Memory.ClaudeLegacy()` (the pane's reads). 
  2. `terminal_agent_session`: `Terminal.Open` `LaunchKindClaudeCode` `Command: "claude"`, cwd repo,
     scenario `{"*": [{}]}` (exit 0). Wait for the fake's `.args`. Assert argv has `--settings <abs
     hooks.json>` and `--mcp-config <abs file>`; that file parses and names `kira-memory` stdio with
     `args == ["memory-mcp"]` and an absolute command. Then connect to it with the go-sdk
     `mcp.CommandTransport` and call `search_memories` (`{"query":"x"}`): proves memory MCP
     availability inside the session (the test binary serves `memory-mcp` via `RunArgvShim`). No
     `kira-db` entry (no endpoint file).
  3. `terminal_agent_session_with_db`: write `<KIRA_HOME>/mcp-db-endpoint.json` pointing at a
     test-local `net.Listen("tcp","127.0.0.1:0")` and an absolute temp helper file; open a second
     agent tab; assert the session file also names `kira-db` with that URL and the quoted helper.
     Close the listener, open a third tab: no `kira-db` (dial probe).
  4. `ade_session_start`: launch one ADE stage TUI session through the board API, open its terminal
     (adeflow `openLaunch`), assert the composed command carries both the grant `--mcp-config` and
     the session `--mcp-config`, plus `--settings`.
  `before` is also compared after `app.Restart()` at the end (startup must not touch anything).
- Shim gate: `internal/agenthooks/server_test.go` gains `TestShimInertWithoutSessionEnv`: run the real
  shim from a live `New` server with the hook env unset and with it set; unset → exit 0 and the
  server's request counter (a test `OnEvent` plus an `http` hit counter in the existing
  `newTestServer`) sees zero requests; set → one event (existing `TestValidRequestDeliversEvent` path).
  Pre-fix it sees one rejected request.
- `legacy_test.go` `TestLegacyCleanup` (lands with the feature, see 5):
  seed `~/.claude.json` with: exact `kira-memory`; `kira-db` helper form; `kira-repo-map`; user
  `mine`; `kira-memory-dev` (exact shape, other name: not ours). `ClaudeLegacy()` lists exactly the
  three ours. `RemoveClaudeLegacy` with `fakeCLI`: outcome `removed`; decoded values of `mine` and
  `kira-memory-dev` and every other top-level key unchanged (the emulation re-marshals, so compare
  decoded JSON, not bytes); backup file byte-identical to the pre-cleanup file, mode 0600;
  `ClaudeLegacy()` then empty. Subtest `config_dir`: `CLAUDE_CONFIG_DIR` set, its file holds the
  pre-F2 `kira-db` header form plus a `kira-memory` with an extra `env` key (not ours) → only
  `kira-db` listed and removed, `~/.claude.json` byte-identical. Subtest `no_cli`: `claude` absent
  from PATH → `notFound`, commands listed, file byte-identical, no backup dir.

### 4.2 Kira Studio: `apps/kira-studio/internal/bridge/dbmcp_claude_test.go` (package `bridge_test`)

Builds `appcore.Deps` via `ipcfixture.NewApp(t)`; `HOME` temp with the same seed (shared seed text
duplicated, ~20 lines, two apps cannot share test helpers across `internal/` without a new package;
acceptable), fake `claude` = a POSIX sh script that appends `"x"` to `$HOME/.claude.json` on any `mcp`
call (the byte change is the signal; Studio has no emulation need). Flow: `SetEnabled(true)` (skip
with `"port 8766 in use: <error>"` when the status reports a bind error), `Status`, pre-fix
`InstallClaudeCode`, `Regenerate`, `SetEnabled(false)`. Assert snapshot unchanged; post-fix also
assert `mcp-db-endpoint.json` exists while running with the live URL and is gone after disable.

### 4.3 Pre-fix failures (recorded at Commit 1)

- `TestClaudeConfigUntouched/memory_connect`: `memory_connect changed Claude Code config: home/.claude.json changed (-rw-r--r-- sha256 f2cbdfa37f8cbabd to -rw-r--r-- sha256 a113efc2c870620d)`
- `.../terminal_agent_session`, `.../terminal_agent_session_with_db`: `agent launch argv has no --mcp-config: ["--settings" "/tmp/kira-agent-.../hooks.json"]`
- `.../ade_session_start`: `agent launch argv has no --mcp-config: ["--session-id" "..." "--settings" "/tmp/kira-agent-.../hooks.json" "--" ...]`
- `TestClaudeConfigUntouched` (restart check): `app restart changed Claude Code config: home/.claude.json changed (...)` (cascade of memory_connect)
- `TestShimInertWithoutSessionEnv`: `shim without session env reached the server 3 time(s), want 0`
- `TestDbMcpLeavesClaudeConfig`: `DB MCP flow enable changed Claude Code config: .claude.json`
- `TestLegacyCleanup`: lands with Commit 5 (needs `ClaudeLegacy`).

## 5. Commits

Conventional Commits, trailers per CLAUDE.md. Fast checks (`bun run lint`, `bun run typecheck`,
`go build ./...`, `go vet` on touched packages) per commit; full suites once at the end (6).

1. `test(space,studio): Claude config isolation flows (failing)` — `claudeflow` main/helpers/
   isolation, `dbmcp_claude_test.go`, `TestShimInertWithoutSessionEnv`. Record actual failure lines into §4.3 of this plan, same commit.
2. `feat(claudecfg): session MCP config, DB endpoint file, legacy detect and cleanup` — package +
   `legacy_test.go`; `mcpinstall.Remove`.
3. `feat(agenthooks): per-launch --mcp-config and env-gated hook shim` — `Options.SessionMCP`,
   `ComposeLaunch`, `shim.go`, `server_test.go` updates; `bridge/claudesession.go`; `wire.go` line.
4. `feat(studio): DB MCP endpoint file, drop global install, legacy cleanup` — `bridge/dbmcp.go`;
   test 4.2 switched to post-fix flow.
5. `feat(space)!: memory MCP per session only, legacy cleanup` — `bridge/memory.go`; delete
   `memoryflow` `TestConnectClaudeCode`; `claudeflow` isolation switched to post-fix flow;
   `legacy_test.go` (flow). `BREAKING CHANGE:` footer: bound `InstallClaudeCode` removed in both apps.
6. `refactor(mcpinstall)!: remove user-scope registration` — delete `Install`, `InstallStdio`,
   `register`, `StdioCommand`; tests.
7. `feat(ui): Claude Code status and legacy cleanup in Settings` — shared domain, workbench section,
   both apps' panes/state/bridge, bindings regenerated, UI specs, visual baselines.
8. `docs: P233 per-session Claude Code configuration` — 7.
Fixes found by the end-of-phase run land as follow-up `fix:` commits.

## 6. Checks (end of phase)

- `go build ./...`, `go build -tags server ./apps/kira-space`, `bun run lint:all`, `bun run typecheck`.
- `go test ./internal/claudecfg/... ./internal/agenthooks/... ./internal/mcpinstall/... ./apps/kira-studio/internal/bridge/...`
- `bun run test:flows:space` (all flows, not only claudeflow: `memoryflow`, `adeflow`, `termflow`
  run through the changed `ComposeLaunch`).
- `bun run test:ui:space -- settings-memory`, `bun run test:visual:space`, `bun run test:ui:studio`,
  `bun run test:visual:studio`, `bun run test:unit`.
- Grep gates (orchestrator verifies): `rg -n 'add-json|"--scope", "user"' --glob '*.go' internal apps`
  → only `mcpinstall.Command` copy text and test emulation; `rg -n 'InstallClaudeCode|InstallStdio'`
  → none; a real caller of `claudecfg.SessionConfig` in `bridge/claudesession.go` and of
  `SessionMCP` in `wire.go`; `rg -n 'claudecfg-emulate'` only in `claudeflow`.
- Hooks green on every commit, no `--no-verify` in the final history.

## 7. Docs

- `docs/ARCHITECTURE.md`: memory section line "Registered as `kira-memory` with `claude mcp add-json
  --scope user` from Settings > Memory" → per-session `--mcp-config`; agent hooks section: launch
  composer adds `--mcp-config`, shim env gate; DB MCP section: endpoint file
  `<KIRA_HOME>/mcp-db-endpoint.json`, no global install, Space injects `kira-db`; new short "Claude
  Code configuration" rule: neither app writes Claude Code config; legacy cleanup only on user
  action with backup under `<app home>/claude-config-backups/`. Remove the stale "Open: no
  'registered with Claude Code' detection" line. Known open items: add D3 if the default holds.
- `docs/DEV_ENVIRONMENT.md` Memory MCP section: testing outside Kira Space needs a manual
  `--mcp-config`; `claudeflow` uses an `mcp` emulation, never the real CLI (A13).
- SPEC row P233 status and result section: orchestrator, after verification.

## 8. Mac handover

1. Before upgrading: `cp ~/.claude.json ~/claude.json.pre-p233` and
   `shasum -a 256 ~/.claude/settings.json ~/.claude.json`.
2. Install the build. Open Kira Space Settings > Memory: status shows the CLI path
   (`~/.local/bin/claude` or `/opt/homebrew/bin/claude`); the legacy card lists `kira-memory` if it
   was registered (command `/Applications/Kira Space.app/Contents/MacOS/Kira Space`).
3. Start an agent terminal tab. In it, `/mcp`: `kira-memory` connected. `ps -o args= -p <pid>` of the
   `claude` process shows `--settings '/var/folders/.../kira-agent-.../hooks.json' --mcp-config
   '/var/folders/.../kira-agent-.../mcp-1.json'`. Check activity icons still update (hooks).
4. With the legacy entry still present, confirm the session's `/mcp` lists one `kira-memory`, not an
   error (name clash between user scope and `--mcp-config`; D4). Record the result in the SPEC row.
5. Kira Studio: enable Database MCP; `ls ~/.kira-studio/mcp-db-endpoint.json`; new Kira Space agent
   tab → `/mcp` lists `kira-db`. Disable → file gone; next tab has no `kira-db`.
6. Run "Remove…" in either app; confirm. Backup at `~/.kira-space/claude-config-backups/` (Space) or
   `~/.kira-studio/claude-config-backups/` (Studio); `claude mcp list` no longer shows the Kira
   entries; other servers unchanged (`diff` the backup against the file: only the removed keys).
7. Plain `claude` in Terminal.app: no Kira hooks, no `kira-memory`/`kira-db`.
8. `shasum` again after using both apps: `~/.claude/settings.json` identical. `~/.claude.json` changes
   only through the CLI's own state (A13) and the cleanup.

## 9. Deferred decisions (defaults the orchestrator takes unless the user says otherwise)

- D1 DB MCP inside Kira Space sessions via Studio's endpoint file (2.3). Default: yes. Alternative:
  no injection; DB MCP then works only where the user registers it by hand.
- D2 Copy commands. Default: Space drops its `kira-memory` command entirely; Studio keeps its
  `kira-db` command behind "Use outside Kira Space" as text the user runs, since Studio starts no
  Claude sessions. A user who runs it will see that entry in the legacy card (exact match); the card
  says "Remove only if you did not add it yourself".
- D3 ADE headless runs (`claude -p`, A7) get no `kira-memory`/`kira-db`. Default: unchanged (they had
  them only through the global entry, and `--allowedTools` blocked unlisted MCP tools in `-p` anyway).
  Adding them touches `adeagent`/`ade` (P231 files): a follow-up phase if wanted.
- D4 Same server name in user scope and `--mcp-config`: not measurable here (needs a logged-in
  CLI). Default: keep the names; Mac step 4 checks it. If the CLI errors or duplicates, follow-up
  `fix:` renames the session entries `kira-memory-session`, at the cost of the
  `/mcp__kira-memory__remember` command name.
- D5 Legacy cleanup scope: both apps list all three Kira names. Alternative: each app only its own.
- D6 Backups are kept indefinitely (small text). Alternative: keep last 5.
