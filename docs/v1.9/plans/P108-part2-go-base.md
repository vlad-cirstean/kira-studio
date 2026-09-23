# P108 Part 2 — review plan: shared Go base and repo tooling

Chunk A1, stream A position 1 (pre-plan §5.1). One Opus reviewer runs this plan, reports findings,
fixes nothing; one Sonnet fixer then lands one commit per finding. Tree surveyed: `23b42b0`.

Paths repo-relative. `Studio` = `apps/kira-studio`, `Space` = `apps/kira-space`, `SI`/`PI` = each
app's `internal/`.

## 0. Method

- **`codegraph_explore`** for discovery: `pathsafe` and its `codeworkspace` callers;
  `OrderedEmitter`/`PendingQueue` against `dbmcp.ApprovalBroker` and `gitsock.Broker`; terminal
  `Registry`/`Session` close paths against `shell.OpenWindow`, `AttachCloseFlush` and both apps'
  `TerminalService.Shutdown`.
- **`git grep` of import lines** for the exact importer set per package (§2). Go's `internal/` rule
  makes import lines authoritative, so no name-resolution over-linking applies here.
- **Vendored source read** where a finding depends on library behavior: Wails v3
  `WebviewWindow.HandleWindowEvent` (hook cancel skips listeners), modernc `newConn` (`file:` DSN
  goes to `sqlite3_open_v2` with `SQLITE_OPEN_URI`).
- **Executed** `sh scripts/verify-packaging.sh` on a clean tree to check a tooling claim.

## 1. Own file set

Pre-plan §5.1 list, resolved against the tree. Corrections are marked.

**Go, 20 packages under `internal/`** (production files; `_test.go` reviewed only where it is the
package's own guard, e.g. `notify/ordered_test.go`):

- `appevent/{appevent,coalescer}.go`
- `appsettings/{appsettings,repo}.go`
- `appstorage/{appstorage,leaves,tabs,window}.go`
- `ipcerr/errors.go`
- `jsonx/jsonx.go`
- `kirapaths/{paths,env,prod,prod_default}.go`
- `kiratime/time.go`
- `layeringtest/layeringtest.go`
- `localsock/localsock.go`
- `logging/{log,sweep}.go`
- `notify/{notify,ordered}.go`
- `pathsafe/pathsafe.go`
- `rpcstream/{session,frame,credit}.go`
- `shell/{accel,closeflush,debounce,deps,dialogs,link,menu,menutemplate,openwindow,quit,registry,security,wails,window}.go`
- `sqlitex/{sqlitex,load,query,reindex}.go`
- `startupfail/{alert,classify,exec,info,render,report,step}.go`
- `terminal/{session,service,shell,validate}.go`
- `testx/testx.go`
- `tokenauth/tokenauth.go`
- `toolexec/exec.go`

About 5.3k production lines plus 2.4k test lines.

**Repo tooling:**

- `scripts/{check-tokens,generate-wire,install-golangci-lint,lib,setup,sign-bundle,verify-packaging}.sh`.
  `db-compat.sh`/`test-matrix.sh`/`demo-dbs/` stay with Part 4. `scripts/{build,package}-vscode.ts`
  stay with Part 20.
- `.githooks/{pre-commit,pre-push}`, `.claude/hooks/{session-start,postcompact-style-reminder}.sh`.
- Root `package.json` (`scripts` block), `biome.json`, `knip.json`, `.golangci.yml`.
- Root `tsconfig.json`. Correction: no other root `tsconfig*.json` exists.
- `.github/workflows/{pr,release}.yml`, read-only.
- **Added:** `docs/pending-changes/.github__workflows__{pr,release}.yml.patch`. These are the only
  place a workflow fix can land (pre-plan §3.3). Review each patch as the workflow's effective
  future state. `docs/pending-workflows/` does not exist.

## 2. One hop: callers

Every Go importer, both apps, from import lines. Symbol counts are call-site references across
`apps/**`.

- **`ipcerr`** (`BadRequest` 193, `Internal` 110, `New` 31, `Error` 26, `Wrap` 15, `SecretStore` 7,
  `Disconnected` 3). Studio: 27 `SI/bridge` files, `connections/{input,service}.go`,
  `dbmcp/render.go`, `secrets/cipher.go`, `tree/service.go`. Space: 9 `PI/bridge` files, 16
  `PI/gitrpc` files. Internal: `appstorage/tabs.go`, `rpcstream`, `shell/{dialogs,link}.go`,
  `terminal/{service,validate}.go`, `testx`.
- **`kiratime`** (`NowISO` 71, `FormatISO` 8, `ParseISO` 1). Studio `storage/repos` (13 files),
  `adapterhost/host.go`, `connections/service.go`, `ipcfixture/harness.go`,
  `maskrules/service.go`, `oplog/wire.go`, `tree/service.go`. Space
  `bridge/codeworkspace.go`.
- **`sqlitex`** (`RequireOneRow` 9, `QueryAll` 8, `Migrate`/`LoadMigrations` 3, `Open` 2,
  `ReindexSortOrder` 3). Both apps' `storage/{migrations,repos}`, Space
  `gitreview/{db,migrate,migrations}`, `appstorage`.
- **`appstorage`**. Both apps' `storage/{db.go,model/{tabs,window}.go,repos/{layout,repos,settings,tabs,windows}.go}`,
  both `bridge/tabs.go` (`SaveWindowTabs`), `shell/deps.go` (type aliases).
- **`appsettings`** (`Leaf` 21, `UpsertOptional` 17, `LeafValid` 14, `InRange` 14). Both apps'
  `storage/{model,repos}/settings.go`, `repos/layout.go`. Space `model/gitreposettings.go`,
  `repos/gitreposettings.go`, `main.go`. TS mirror: `packages/shared/domain/settings.ts` (Part 13,
  open concurrently; pre-plan §3.3's handoff rule applies).
- **`notify`**. `Emitter`: Studio `adapterhost/host.go`, `connections/service.go`,
  `metrics/ticker.go`, `oplog/wire.go`, `preconnect/supervisor.go`. Space `gitrpc/handlers.go`,
  `gitsock/server.go`. `OrderedEmitter`/`PendingQueue`: `dbmcp/approval.go` (`ApprovalBroker`),
  `gitsock/pairing.go` (`Broker`).
- **`rpcstream`** (`NewSession`, `Session.Serve`/`Emit`, `Handlers`). Space `gitsock/server.go` and
  `bridge/gitstream.go` only. Wire peer: `packages/git-ipc/src/rpc.ts` `createRpcClient`. Ids start
  at 1 and increase monotonically.
- **`shell`**. Both `main.go` (`NewWindowRegistry`, `NewCloseFlushCoordinator`, `NewQuitter`,
  `OpenWindow`/`OpenNewWindow`/`ReopenWindows`, `AttachReopen`, `BuildMenu`, `NewDeferred*`),
  both `appshell/{dialogs,menu}.go`, both `bridge/{files,link}.go`.
- **`terminal`**. Both `main.go` (`NewRegistry`, `TermProgram*`), both `bridge/terminal.go`
  (`ValidateOpen`, `Service.OpenWithCoalescedOutput`, `Shutdown` into `Registry.CloseAll`),
  `shell/openwindow.go` (`Registry.CloseWindow` from each window's `WindowClosing` listener).
- **`startupfail`**. Both `main.go` only (`NewReporter`, `Fatal` per `Step`, `ReportPlatform` via
  `ErrorHandler`).
- **`logging`**. Both `main.go` (`Init`, `Sweep`, `SetLevel`), both `bridge/settings.go`
  (`SetLevel`).
- **`kirapaths`**. Both `config/{env,paths}.go`.
- **`localsock`**. Space `gitaskpass/broker.go` (`Serve`, per-conn deadline set), Studio
  `agenthooks/agenthooks.go` (`http.Server` over the listener).
- **`tokenauth`**. Space `gitsock/token.go`, Studio `mcpauth/token.go`.
- **`toolexec`**. `Run`: Studio `mcpinstall/install.go`, Space `gitvsix/install.go`; both check
  `ctx.Err()` themselves. `IsExecutable`/`Locate`: Space `gitclient/discovery.go`,
  `ghclient/discovery.go`.
- **`pathsafe`**. Space `codeworkspace/{paths,search}.go`. Via `codeworkspace.ValidateRelPath`:
  `diff.go`, `bridge/codeworkspace.go` `ReadFile`. All read-only.
- **`jsonx`**. Studio `adapters/redis/read.go`, `storage/model/mutations.go`.
- **`appevent`**. Both `appcore/deps.go`, both `bridge/events.go`, Studio `bridge/grpc.go`, Space
  `bridge/codeworkspace.go`.
- **`layeringtest`**, **`testx`**. Test-only importers: both `internal/layering_test.go`; 13
  `_test.go` files.

Tooling callers: `pre-commit` runs `lint`/`typecheck`, `pre-push` runs `go build`/`lint:go`/
`lint:dead`, and CI runs the patched workflows. Scripts call `lib.sh`. Taskfiles call `setup.sh`
(through `predev:*`/`prepackage:*`) and `sign-bundle.sh`.

## 3. One hop: callees

Stdlib, Wails v3 (`application`, `events`), `modernc.org/sqlite` (DSN parsing), `creack/pty`,
`google/uuid`, the `osascript`/`pbcopy`/`claude`/`code`/`open` binaries, the login shell.
Tooling: `wails3`, `flatc`, `golangci-lint`, `biome`, `knip`, `codesign`, `hdiutil`.

## 4. Edge cases to weight

This chunk is the widest blast radius in the tree. Weight each item against every caller in §2,
not just the package's own tests.

- **Concurrency.**
  - `rpcstream`: id reuse after `cancel`, since `activeWork`/`creditGates` are keyed by id alone.
    Also credit grant/acquire against cancellation, and the order of `close()` against in-flight
    sends.
  - `notify.OrderedEmitter`: whether "never publish stale" holds across the CAS-then-deliver gap.
  - `appevent.Coalescer`: timer against `Finish`.
  - `terminal.Session.Close`: whether every wait is bounded, given job-control process groups.
  - `shell.Quitter`/`CloseFlushCoordinator`: late acks, windows closing mid-quit, the
    Hide-instead-of-Close path re-entered after a Dock reopen.
  - `localsock.Close` waiting on handlers.
- **Resource and shutdown bounds.** Any unbounded wait on the teardown path. `teardown` runs
  `terminalSvc.Shutdown()` before `db.Close()`, so a hang there blocks quit. Also PTY and
  temp-directory cleanup, and timer escalation in `toolexec.Run`.
- **Path and URI safety.**
  - `pathsafe.ValidateRelPath`: absolute paths, `..`, symlinked ancestors, a dangling symlink
    leaf in the not-exist fallback.
  - `sqlitex.BuildDSN`: `?`, `#` and `%` in the path under SQLite URI parsing.
  - `shell.OpenExternalURL`: scheme and host.
  - `startupfail.alertArgv`: argv-only, never script source.
- **Error contracts.**
  - `ipcerr.Error()` fallback now that `Details` exists.
  - `rpcstream.wireErrorFrom` mapping.
  - `startupfail.Classify` depends on `SchemaTooNewError` arriving unwrapped. Verify every
    `storage.OpenAt`/`appstorage.OpenAt` path still returns it bare.
- **Storage.** `SetMaxOpenConns(1)` means any non-`tx` DB call inside a `ReplaceKeyed`/
  `UpdateLeaves` callback deadlocks. Also migration ordering, `schema_version` downgrade refusal,
  and the settings leaf round-trip against the TS mirror.
- **Security.**
  - `tokenauth` constant-time path on bad input.
  - `localsock` directory and socket modes.
  - Hardening in `shell.Harden`.
  - Terminal env forwarding.
- **Tooling correctness.** P106 renamed 15 root scripts; check every hook, script, workflow patch
  and checker that names one. Also check path-bearing config (Biome overrides, knip workspaces,
  `generate-wire.sh` output dirs, the CI `go test` list) against P100's Studio-to-Space moves.
  Check that CI can compile both apps' `//go:embed all:frontend/dist`.

## 5. Out of scope

- Generated code (pre-plan §6).
- Per-app packages reached only through §2. Report a defect found there as a pointer for its
  owning Part, not a finding here.
- Docs prose (P109).
- The `--color-muted` collision (P110).

## 6. Review procedure

1. Read each own-file in full.
2. For each candidate, trace its callers with `codegraph_explore` to confirm reachability and blast
   radius.
3. Confirm library-dependent claims against vendored source. Confirm tooling claims by running the
   script where the sandbox allows.
4. Report each finding with file:line, defect, why it is real, and fix direction. Record items
   considered and dismissed, so the fixer does not re-derive them.
