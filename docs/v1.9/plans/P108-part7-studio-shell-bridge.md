# P108 Part 7 — review plan: Studio Go app shell, Wails bridge and agent integrations

Chunk A6, stream A position 6 (pre-plan §5.6). One Opus reviewer runs this plan and reports
findings. It fixes nothing. One Sonnet fixer then lands the findings. Tree surveyed: `6c81aab`
(Part 6 result recorded; Part 17 fixes landing concurrently in `apps/kira-space/internal/gitsock/**`,
no overlap).

Paths repo-relative. `SI` = `apps/kira-studio/internal`, `SF` = `apps/kira-studio/frontend/src`,
`SD` = `packages/shared/domain`.

## 0. Method

- **`codegraph_explore`** for discovery: `mcpinstall.Install`/`mcpauth` token flow, the
  `run_query`/`explain_query` gate chain (`resolveVerdict`, `maybeExplain`, `awaitApproval`,
  `renderPage`, `maskedColumnRenamedOrHidden`, `ApprovalBroker`), statement classification
  (`Router.ClassifyStatement` and every adapter `ClassifyStatement`), and
  `connections.Service.Connect`/`Shutdown` against main.go's teardown. Blast radius of any change
  checked the same way.
- **Real CLI behavior, not assumed.** `claude mcp add`/`add-json`/`remove` run against a scratch
  `HOME` (installed Claude Code 2.1.280): argv shape, name collision, remove-on-missing exit code.
- **Module source** where a claim depends on it: `go-sdk@v1.8.0` (`internal/jsonrpc2/conn.go`
  handler dispatch, panic recovery).
- **Mirror check by reading both halves:** `SI/bridge/dbmcp.go` wire structs against
  `SD/dbmcp.ts`; `SI/agenthooks` Event against `SD/agent.ts`; `mask.go`/`mask.ts` via the
  shared-fixture parity suites.
- **Known open items** in `docs/ARCHITECTURE.md` read first, so a documented limitation (view
  rename, tag provenance) is not re-reported as new.

## 1. Own file set

Production files first; tests read where they guard the package.

- **`SI/bridge`** (~4.4k prod): the hub. Security-weighted: `dbmcp.go` (DB MCP lifecycle, token,
  install, approval wire), `embedded.go` (settings-gated start/stop), `agenthooks.go`,
  `terminal.go` (claude launch, hook env), `keepawake.go`, `update.go`, `link.go`, `files.go`,
  `collections.go` (import/export paths, atomic write), `http.go`/`grpc.go` (secret masking of
  responses, errors, history), `variables.go` (reveal), `settings.go` (generic patch),
  `events.go`, `lifecycle.go`, `windows.go`, `datagrip.go`, `customscripts.go`, `maskrules.go`,
  plus the thin CRUD services (`app`, `connections`, `tree`, `schema`, `queries`, `filters`,
  `layout`, `tabs`, `ops`, `engine`, `stream`, `grpchistory`, `responsehistory`).
- **`SI/dbmcp`** (~2k): `server.go`, `http.go` (loopback bind, port fallback, bearer auth,
  cross-origin guard, bounded shutdown), `tools.go` (five tools + gate order), `access.go`,
  `permissions.go`, `approval.go`, `explain.go`, `render.go` (mask enforcement, error withholding).
- **`SI/mask`**, **`SI/maskrules`** (rule fold, per-connection cache, correlation key).
- **`SI/mcpauth`** (mint/verify/expiry, atomic save), **`SI/mcpinstall`** (`claude mcp add` spawn).
- **`SI/agenthooks`** (unix-socket hook listener, shim, hooks.json).
- **`SI/appupdate`**, **`SI/keepawake`**, **`SI/metrics`**, **`SI/queryplan`**,
  **`SI/appshell`**, **`SI/appcore`**, **`SI/config`**, **`SI/buildinfo`**.
- **`apps/kira-studio/main.go`** (boot wiring, teardown order), `cmd/g1measure`, `Taskfile.yml`,
  `build/**`, `SI/layering_test.go`.
- **TS**: `SD/{mask,dbmcp,agent}.ts`; `tests/unit/{mask-parity,agent-activity-reducer}.spec.ts`.

## 2. One hop: callers

- **Renderer over Wails bindings** (trusted: own webview): `SF/bridge/index.ts` (`trust<T>()`,
  no zod parse on DB MCP results), `SF/state/{dbmcp,agentSessions,settings,keepAwake}.ts`,
  `SF/workbench/settings/{DatabaseMcpPane,ClaudeCodePane}.vue`,
  `SF/workbench/DbMcpApprovalDialog.vue`, `SF/workbench/SettingsDialog.vue` (draft covers six
  sections, never `dbMcp`/`claudeCode`).
- **MCP clients** (untrusted content, authenticated): any local process presenting the bearer
  token to `http://127.0.0.1:<port>/mcp`; tool handlers run in go-sdk's own goroutines.
- **Claude Code hook process**: `hooks.json` → shim → `curl --unix-socket` → `POST /hook`.
- **OS**: Wails app events (system wake, reopen), `ShouldQuit`/`OnShutdown`.

## 3. One hop: callees (all settled, Parts 2-6)

- `SI/connections.Service`: `List`, `StateOf`, `Connect` (D11 dedupe, F4 cancel), `Shutdown`
  (`Preconnect.StopAll` only). `SI/preconnect.Supervisor.Start` spawns `/bin/sh -c`.
- `SI/tree.Service`: `Children`, `Describe`, `SchemaColumns`.
- `SI/adapterhost.Router`: `Execute` (dispatcher panic recovery), `ClassifyStatement`,
  `Host().RunOp`; adapter classifiers (`adapters.ClassifySQL`, ClickHouse, Mongo, Redis).
- `SI/storage/repos`: `Settings`, `MaskRules`, `MaskKeys`, `Variables`, `Collections`, history.
- Repo-root `internal/{tokenauth,toolexec,localsock,notify,shell,terminal,ipcerr,appevent}`.
- `SI/{httpclient,grpcclient,apivars,postman,datagrip}` (Part 8 reviews them as its own; this
  chunk reviews the bridge side of the seam).

## 4. Edge cases to weight

1. **Token handling.** Part 2's pointer: `mcpinstall` puts the bearer on argv. Verify fresh; weigh
   who can read argv (other uids on Linux `/proc`, exec-event logging on macOS) against the
   listener being TCP loopback, reachable by every local uid (unlike agenthooks' 0700 socket dir).
   Token rotation (7-day TTL, Regenerate, re-enable) against re-registration under the same name.
   Port fallback (8766 taken) against a registration still pointing at 8766.
2. **Masking bypass.** Column-name-only enforcement: whole-row serialization (`row_to_json`,
   `json_agg(t)`, composite `SELECT c FROM t c`), positional column aliasing in `FROM`,
   escaped identifiers, ClickHouse `APPLY`. Mask-set cache staleness under concurrent rule edits.
   Error-message withholding on every masked path. Page 0 only rendered.
3. **Approval gates.** Verdict, then explain, then at most one approval, then execute. Re-check
   after approval. Replay (request id single-use), queue cap, timeout, abandon on stop, shutdown
   drain. Classification of multi-statement and unknown input (strictest mode).
4. **Read-gate preamble** (P107 I2-44): every schema tool still refuses under read-mode deny.
5. **Lifecycle.** Settings leaf vs running server under concurrent toggles; lock held across a
   30s spawn; teardown order (connections before DB MCP) against on-demand `Connect`; hook shim
   deleted under a live session; keepawake driver-wide `expected` flag across Rearm/toggle.
6. **Crash surface.** Panics in MCP tool handlers (no framework recovery).
7. **Wire mirrors.** `DbMcpApprovalRequest` against `dbMcpApprovalSchema`; `DbMcpStatus`.
8. **Update check / links.** Release URL pinning, no renderer URL, bounded body.
9. **Metrics.** Log content and spam; Linux is dev/CI only (ARCHITECTURE), weigh accordingly.

## 5. Watch items (pre-plan §5.6)

- Masked-connection error path never leaks a raw driver message (`maskedToolError`).
- Approval flow ordering as above.
- Mirrors: `mask.go`/`mask.ts`; `queryplan` against the console plan parsers (A10, read only).
- `bridge/collections_*_atomicity_test.go` guard import/export rollback.

## 6. Out of scope

Generated bindings (`frontend/bindings`). Documented known open items (view-rename mask gap,
correlation-tag provenance). Part 8's own packages beyond the bridge seam. `SF/state/**` logic
beyond the wire seam (Part 12 re-reviews it with every caller settled).
