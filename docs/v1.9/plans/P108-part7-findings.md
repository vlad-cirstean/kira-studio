# P108 Part 7 — remaining findings (F4+)

Review of `P108-part7-studio-shell-bridge.md` against tree `bc365eb`. Scope excludes F1 (`a24f02e`,
masked-connection whole-row/array/risky-SQL bypass) and F2 (`42f5ca3`, bearer token off argv).
`42f5ca3`'s message also names the name-collision/remove-before-add fix "F3", so numbering here starts
at F4. Findings only. Nothing below is fixed.

Discovery used `codegraph_explore` (token flow, run_query/explain_query gate chain, statement
classification, Connect/Shutdown vs teardown, keepawake driver). Behavior claims marked "verified" were
checked with scratch `go test -overlay` tests or the real `claude` CLI (2.1.281) against a scratch
`HOME`. No repo file other than this one was edited.

Paths repo-relative. `SI` = `apps/kira-studio/internal`, `SF` = `apps/kira-studio/frontend/src`.

## F4 — ClickHouse explain_query and auto-explain always fail (medium, functional)

- **Where:** `SI/adapters/clickhouse/console.go:30-49` (`classifyClickHouseSQL`), reached from
  `SI/dbmcp/explain.go:79-95` (`assertComposedStatementsAreReads`).
- **Bug:** `queryplan.StatementsFor("clickhouse", sql)` composes
  `EXPLAIN PLAN json = 1, indexes = 1, description = 1 <sql>` and `EXPLAIN ESTIMATE <sql>`. The EXPLAIN
  branch classifies the text after `EXPLAIN`, whose leading word is `PLAN`/`ESTIMATE`, so both
  classify `unknown`. Verified: both composed forms of `SELECT * FROM t` return `unknown`.
- **Reachable:** every `explain_query` on a ClickHouse connection returns a Go error and logs at Error
  level. `run_query`'s auto-explain (`maybeExplain`) always degrades to "no plan", so the heavy-query
  gate never fires on ClickHouse. `console_internal_test.go` only covers bare `EXPLAIN SELECT`/`DELETE`.
- **Fix:** in `classifyClickHouseSQL`, after `EXPLAIN`, skip one optional kind keyword (`AST`,
  `SYNTAX`, `QUERY TREE`, `PLAN`, `PIPELINE`, `ESTIMATE`, `TABLE OVERRIDE`) and its optional
  `k = v, ...` settings list, then classify the target. Add test cases built from
  `queryplan.StatementsFor("clickhouse", …)` so composer and classifier stay in lockstep.

## F5 — explain_query returns plan text unmasked on masked connections (medium, masking bypass)

- **Where:** `SI/dbmcp/tools.go:413-516` (`explainQuery`); plan text sources
  `SI/queryplan/mysql.go:115-116`, `SI/queryplan/mariadb.go:90-91` (`attached_condition` into
  `node.Detail`), `SI/queryplan/clickhouse.go` (index `Condition` into metrics); `Raw` at
  `tools.go:512`.
- **Bug:** only the error path is masked. Detail, condition metrics and `Raw` (via `includeRaw`) go
  back verbatim. MySQL/MariaDB read const tables during optimization and substitute real column
  values into other tables' `attached_condition`. Example:
  `SELECT o.* FROM orders o JOIN customers c ON c.email = o.email WHERE c.id = 42` yields
  `o.email = '<real address>'` in the plan, although `email` is a masked column. ClickHouse likely
  evaluates scalar subqueries at EXPLAIN time too (not verified).
- **Reachable:** a natural query triggers it without intent. That is the documented masking threat
  model (accidental exposure by an agent), not a contrived attack.
- **Fix:** when the connection has an active mask set, drop `Raw`, blank `Detail` and condition-type
  metrics, and withhold parse-error text; or refuse `explain_query` (and `includeRaw`) on masked
  connections with a clear message. Same treatment for `run_query`'s auto-explain output, if it ever
  reaches the client.

## F6 — explain_query's approval has no post-approval re-check (low)

- **Where:** `SI/dbmcp/tools.go:453-470` (prompt branch in `explainQuery`), vs `awaitApproval`
  `tools.go:359-388`.
- **Bug:** `run_query` re-runs `resolveEnabled` and the read verdict after `ApprovalApproved`.
  `explainQuery` does not.
- **Reachable:** the user disables MCP exposure for the connection, or sets read mode to deny, while
  the approval dialog waits (up to 2 minutes); a later approve (other window, stale dialog) still
  runs the EXPLAIN. Low impact because EXPLAIN is read-only, but it breaks the "gate re-checked after
  approval" invariant plan §4.3 names.
- **Fix:** after `ApprovalApproved`, re-resolve `resolveEnabled` and `verdictFor(ClassRead)`, same as
  `awaitApproval`.

## F7 — panic in any MCP tool handler crashes the app (medium, crash)

- **Where:** `SI/dbmcp/server.go:190-223` (`buildMCPServer`, six `mcp.AddTool` calls at 197-217).
- **Bug:** go-sdk v1.8.0 runs each request in `go c.handleAsync()`
  (`internal/jsonrpc2/conn.go:646`) with no `recover()` anywhere in the module. Only
  `Router.Execute` has its own `safeRun`. Everything else in a handler runs unguarded: `render.go`
  scanning over client SQL, `queryplan` parsers over server EXPLAIN output, mask transforms,
  `tree.Service` calls.
- **Reachable:** any nil deref or index panic on odd server output or odd client input kills the
  whole desktop app, including open editors and terminals, from an authenticated local client.
- **Fix:** wrap every handler passed to `mcp.AddTool` in one generic helper that `recover()`s, logs
  the stack, and returns an `IsError` result with a generic "internal error" message (no panic text,
  since it may carry row data on a masked connection).

## F8 — `minted` gate hides Command/Install after every restart (low-medium)

Answer to the flagged question: real.

- **Where:** `SI/bridge/dbmcp.go:104` (`statusFn`), `dbmcp.go:289-290` (`InstallClaudeCode`),
  `dbMcpTokenProviderFor` `dbmcp.go:140-170`, `Regenerate` `dbmcp.go:241-265`;
  `SF/workbench/settings/DatabaseMcpPane.vue:107-138`.
- **Bug:** after F2 the registration never carries the token. The helper file
  `<KiraHome>/mcp-db-header.token` survives restart and stays valid. Yet Command/Install still gate on
  `srv.Token()`'s `minted` flag, which is true only in the run that minted the token.
- **Reachable:** after any app restart inside the 7-day TTL:
  - the pane hides Command/Install and says the server "needs a fresh token", which is false;
  - `InstallClaudeCode` returns `notFound`, which the pane renders as "Claude Code's CLI isn't
    available";
  - the user is pushed into an unneeded Regenerate;
  - a port-fallback run (see F11) cannot show the new URL for re-registration without that detour.
- **Why a gate is still needed, just not this one:** pre-F2 installs have no helper file. `Save`
  succeeding then `SaveHelperToken` failing (mint branch 151-153, `Regenerate` 259) leaves record and
  helper file mismatched, and after restart the mismatch persists silently: every client gets 401.
- **Fix:** gate on "helper file exists and `mcpauth.Verify(helperPlain, currentRecord)` passes"
  instead of `minted`. On load with a missing or mismatched helper, remint (write record and helper
  together) rather than serve a record no client can match. Drop the now-unused in-memory plaintext.
  Update `SI/mcpauth/token.go:103`'s expiry message, which still says "re-register this server with
  the command it shows" (stale after F2).

## F9 — expired token while Command is shown has no remedy in the UI (low-medium)

- **Where:** `SF/workbench/settings/DatabaseMcpPane.vue:107-150`.
- **Bug:** the Regenerate button renders only in the `running && !command` branch (124-138). When a
  command is shown (minted run) and the 7-day token expires, line 147 says "Token expired — regenerate
  it above." but nothing above offers Regenerate.
- **Reachable:** any session left running past the TTL. Only fix is toggling the server off/on or
  restarting the app. The server also never rotates on its own although F2's helper design makes
  rotation transparent to clients.
- **Fix:** render Regenerate whenever the server runs (or at least when expired). Optionally
  auto-rotate on expiry: rewrite record plus helper file, then `SetToken`.

## F10 — headersHelper path is shell-interpreted and unquoted (low)

- **Where:** `SI/mcpinstall/install.go:136-200` (`EnsureHeaderHelperScript`, `add-json` payload
  `HeadersHelper` at 176, `Command` display string).
- **Bug:** Claude Code runs `headersHelper` through a shell. Verified with CLI 2.1.281: a helper path
  containing a space, stored unquoted, never runs, so no `Authorization` header is sent and every call
  gets 401 with no hint why. The single-quoted form works. The displayed `Command` string also breaks
  on a `'` in the path.
- **Reachable:** `KIRA_HOME` or `$HOME` containing a space (common on macOS for custom
  `KIRA_HOME`). Also, if `os.UserHomeDir` fails, `kirapaths.Home` can yield a relative path, which
  resolves against Claude Code's cwd, not Kira's.
- **Fix:** store `shellSingleQuote(helperPath)` as the `headersHelper` value; require an absolute
  path (refuse install otherwise); quote the displayed command with the same helper.

## F11 — port fallback leaves a registration pointing at a port another uid can hold (low-medium, security)

- **Where:** `SI/dbmcp/http.go:38-78` (`bindHTTP`, fallback to `127.0.0.1:0` at 41); status
  surfacing in `SI/bridge/dbmcp.go:95-112`.
- **Bug:** registrations point at `http://127.0.0.1:8766/mcp`. If 8766 is taken, Kira silently binds
  an ephemeral port. Claude Code's helper still sends the live bearer token to whatever process holds
  8766. The loopback listener is reachable by every local uid.
- **Reachable:** another local user binds 8766 before Kira starts, receives the token from the next
  Claude Code call, then presents it to Kira's ephemeral port (discoverable by scan). The UI shows
  the new URL only in the command text and never flags the change.
- **Fix:** surface fallback in status as a warning that requires re-registration; rotate the token
  whenever the bound port differs from the registered one; or refuse the fallback when a registration
  may exist and report the port conflict instead.

## F12 — keepawake Rearm/toggle race leaves the Mac held awake (medium, confirmed race)

- **Where:** `SI/keepawake/caffeinate.go:34` (driver-wide `expected`), `:74` (`Acquire` resets it),
  `:84-97` (`reap`), `:105` (`Release` sets it); `SI/keepawake/keepawake.go:77` (`Rearm`), `:136`
  (`reportLost`).
- **Bug:** `Rearm` does Release then Acquire. The old child's `reap` reads `d.expected` after `Wait`.
  If the new `Acquire` already reset it to false, the intentional kill is reported through `onLost`,
  and the Controller sets `held=false` while the new `caffeinate` runs.
- **Verified:** overlay test with a fake `caffeinate`: `held=false` after `Rearm` in 1/40 runs at
  default GOMAXPROCS, 37/40 at GOMAXPROCS=1.
- **Reachable:** every system wake calls `Rearm`; rapid off/on toggling hits the same path. After the
  race, toggling off does nothing (`syncLocked` sees want == held == false), so the machine stays
  awake until app exit and status shows Error "signal: killed".
- **Fix:** make the expectation per child: in `reap`, report loss only if `d.cmd == cmd` at exit
  (and clear `d.cmd` there), or keep a per-`*exec.Cmd` expected flag.

## F13 — teardown orphans preconnect sidecars and runs DB MCP past connection shutdown (low-medium)

- **Where:** `apps/kira-studio/main.go:469-470` (`connectionsSvc.Shutdown()` before
  `bridge.StopDbMcp`); `SI/connections/service.go:151-153` (`Shutdown` is only
  `Preconnect.StopAll`); `SI/preconnect/supervisor.go:171-184` (entry tracked only after the 2 s
  settle window).
- **Bug:** `StopAll` kills tracked entries only. A `Connect` inside its settle window is untracked,
  settles after `StopAll`, and its `Setpgid` sidecar (for example an ssh tunnel) outlives the app.
  `Shutdown` sets no closed flag, so new `Connect`s still start. DB MCP keeps serving during
  `Shutdown`, and its `run_query` connects on demand.
- **Reachable:** click Connect on a preconnect connection and quit within 2 s; or an MCP `run_query`
  on a disconnected preconnect connection during quit.
- **Fix:** stop DB MCP (and agenthooks) before `connectionsSvc.Shutdown()` in main.go. Make
  `Shutdown` set a closed flag that refuses new `Connect`s, cancel every in-flight attempt, wait for
  them, then `StopAll`.

## F14 — stale ARCHITECTURE.md known-open item (low, docs)

- **Where:** `docs/ARCHITECTURE.md:3980-3982`, "The dbmcp bearer token reaches `claude mcp add` in
  plaintext argv".
- **Bug:** F2 resolved it. CLAUDE.md requires deleting a known-open item once resolved.
- **Fix:** delete the entry. Also: F1's commit message says it documented an over-refusing
  JSON/array-column known item, but `ARCHITECTURE.md` has none. Add it or correct the record.

## Areas checked, nothing real found

- **§4.1 token handling:** argv exposure resolved by F2. Hash+salt record and `0600` atomic writes
  sound. Remaining issues are F8-F11 only.
- **§4.2 masking:** beyond F1 and F5, nothing new. Page 0-only rendering holds. `maskedToolError`
  (`SI/dbmcp/render.go:93-102`) returns non-coded errors as bare Go errors, which go-sdk forwards as
  text, but adapter errors reach it coded via `mapError`, so no raw driver message leak was found.
  Mask-set cache staleness not re-verified beyond what F1 covered.
- **§4.3 approval gates:** broker FIFO order, queue cap, timeout, request-id single use, abandon on
  stop, shutdown drain: all sound. Multi-statement input (`;`) classifies `unknown`, the strictest
  mode. Only gap is F6.
- **§4.4 read-gate preamble:** `list_children`, `describe_table`, `describe_schema` all go through
  `resolveReadGated`. Holds.
- **§4.5 lifecycle:** settings leaf vs running server serialized under `embedded.mu`. Holding that
  lock across the 30 s install spawn blocks toggles for up to 30 s but is correct, not a bug.
  Agenthooks: 0700 socket dir, token check, bounded body, shim exits 0 when the socket is gone.
  Real issues are F12 and F13.
- **§4.6 crash surface:** F7.
- **§4.7 wire mirrors:** not re-verified in this pass (`DbMcpApprovalRequest` vs
  `dbMcpApprovalSchema`, `DbMcpStatus`, agenthooks `Event` vs `SD/agent.ts`). No finding claimed.
- **§4.8 update check / links:** release URL pinned to `vlad-cirstean/kira-studio` (matches git
  remote), `safeReleaseURL` validation, 1 MiB body cap, no renderer-supplied URL. Sound.
- **§4.9 metrics:** one Warn per 5 s tick on sample failure, Linux dev/CI only. Not worth a finding.
- **§5 watch items:** `maskedToolError` as above. `bridge/files.go` sound. `mask.go`/`mask.ts` parity
  and `collections_*_atomicity_test.go` not re-verified in this pass; no finding claimed.
