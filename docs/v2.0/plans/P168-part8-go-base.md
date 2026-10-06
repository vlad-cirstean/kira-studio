# P168 Part 8: review plan, shared Go base and repo tooling

Chunk A7, Stream A position 7 (pre-plan `P168-prep-plan.md` §5.7). One Opus reviewer runs this
plan and reports findings. It fixes nothing. One Sonnet fixer follows (§8).
Tree surveyed: `af3bd8c` (`p168-stream-a` = `v2.0` tip; Parts 2-7 fixed, Part 7 findings file
dropped; Stream B Parts 14-18 landed on `v2.0`).

Paths repo-relative. `SI` = `apps/kira-studio/internal`, `PI` = `apps/kira-space/internal`, `SF` =
`apps/kira-studio/frontend/src`, `ST` = `apps/kira-studio/tests`, `SD` = `packages/shared/domain`.
`internal/` alone means repo-root `internal/`. Line numbers are as of `af3bd8c`; re-read before
citing.

SPEC row and orchestrator agree on the name `P168-part8-go-base.md`.

## 0. Method for the reviewer

- **`codegraph_explore` first, mandatory.** Load it with `ToolSearch "codegraph"`, then call it
  with `projectPath=/home/user/kira-studio-streamA` before any Read/Grep on a symbol, call-path or
  blast-radius question. The orchestrator greps the run's tool log for real calls. Index:
  `.codegraph/` exists; run `sh scripts/codegraph-setup.sh` if missing. Seeds per area:
  - sockets and RPC: `localsock` (`Listen`, `Listener.Serve`, `Listener.Close`, `RandHex`);
    `agenthooks` (`New`, `Server.Close`, `mux`, `handleHook`, `bearerToken`, `truncateMessage`,
    `buildHooksDocument`, `buildShim`, `shellSingleQuote`, `Manager.Start`/`Stop`/`Status`/
    `ComposeLaunch`); `rpcstream` (`NewSession`, `Serve`, `handleRaw`, `handleRequest`,
    `handleOpen`, `handleCredit`, `handleCancel`, `sendChunk`, `sendResult`, `Emit`,
    `removeActiveWork`, `close`, `writeLoop`, `creditGate.acquire`/`grant`, `encodeBody`,
    `wireErrorFrom`, `wireError`); `tokenauth` (`Mint`, `Hash`, `Verify`).
  - processes: `procgroup` (`Kill`, `GracefulCancel`); `toolexec` (`Run`, `Locate`,
    `IsExecutable`, `FirstLineBounded`, `ExecError`); `terminal` (`Registry.Open`/`get`/`Close`/
    `remove`/`CloseWindow`/`CloseAll`/`AgentSessions`/`WindowOf`, `newSession`, `readLoop`,
    `waitExitCode`, `Session.Write`/`Resize`/`Close`, `loginShell`, `ValidateOpen`,
    `BoundService.Open`/`Write`/`Resize`/`Close`/`DefaultCwd`, `ShutdownBound`,
    `Service.OpenWithCoalescedOutput`, `outputCoalescer.flush`, `setWinsize`, `pollablePtmx`);
    `keepawake` (`Controller.Set`/`Rearm`/`Close`/`syncLocked`/`reportLost`, `caffeinateDriver`
    `Acquire`/`Release`/`reap`, `Toggle.SetManual`/`State`); `appupdate` (`Installer.Stage`/
    `begin`/`finish`/`Cancel`/`fetchScript`/`validateScript`/`writeScriptFile`/`openLogFile`/
    `spawnAndAwait`/`handleLine`/`handleCancel`, `tailError`, `Checker.Status`/`dueForCheck`/
    `refresh`, `version.go` compare); `startupfail` (`Reporter.Report`/`present`/`showAlert`/
    `copyDetails`/`Fatal`, `Classify`, `collapse`, `alertArgv`, `RenderAlert`,
    `RenderClipboard`).
  - shell and events: `shell` (`Quitter` `ShouldQuit`/`RequestQuit`/`Flushed`/`Shutdown`/
    `flushThenQuit`/`Attach`, `CloseFlushCoordinator.wait`/`Ack`, `AttachCloseFlush`,
    `WindowRegistry` `Add`/`AddEphemeral`/`Close`/`DetachAll`/`removeAndCount`/`RowDecision`/
    `OthersReal`/`Focus`, `closeDecision`, `OpenWindow`/`ReopenWindows`/`OpenNewWindow`, `window.go`
    bounds clamp, `security.go`, `link.go`, `menu.go`, `accel.go`, `debounce.go`, `wake.go`,
    `wails.go` `emitter`/`Dialogs`/`browserOpener` and `NewDeferred*`); `appevent` (`Emitter`,
    `Coalescer.Push`/`onTimer`/`Finish`/`flushLocked`); `notify` (`Emitter.Subscribe`/`Emit`,
    `OrderedEmitter.NextSeq`/`Emit`, `PendingQueue`); `windowsvc` (`Ensure`, `SetMode`, `OpenNew`).
  - storage and paths: `sqlitex` (`BuildDSN`, `escapeDSNPath`, `Open`, `Migrate`,
    `ReindexSortOrder`, `ReorderSortOrder`, `QueryAll`/`QueryOne`/`NextSortOrder`, `load.go`);
    `appsettings` (`UpsertLeaf`, `UpsertOptional`, `UpsertAppearance`, `Leaf`, `LeafValid`,
    `ReadAppearance`, `ValidateAppearance`); `appstorage` (`WindowRepo` `Create`/`List`/`Delete`/
    `EnsureExists`/`SetBounds`, `TabsRepo` `Save`/`List`/`ReplaceKeyed`/`SaveWindowTabs`,
    `leaves.go`); `kirapaths` (`Home`, `EnsureLayoutAt`, `requireTestHome`); `pathsafe`
    (`ValidateRelPath`, `requireUnder`); `logging` (`Init`, `SetLevel`, `dailyWriter.Write`,
    `Sweep`); `kiratime`; `jsonx.MarshalOrderedObject`; `metrics` (`Sampler.Sample`,
    `cpuDeltaPercent`, `AppProcessSet`, `CachedPIDs.PIDs`/`rescan`/`revalidate`, `Ticker`
    `Start`/`run`/`Stop`, darwin probes); `testx` (`RunWithTempHomes`, `WaitUntil`);
    `layeringtest` (`Run`, `RunAllowing`); `ipcerr` (`New`, `Wrap`, `InternalErr`,
    `InternalResult`, `NotFound`, `Error.Error`).
  - TS tooling: `tools/mutation/summarize.ts`, `stryker.config.mjs`, `scripts/check-class-
    conflicts.ts`, `scripts/codegraph-duplicates.ts`.
- **Shell and YAML have no symbols in the index.** Read `scripts/**/*.sh`, `.githooks/*`,
  `.claude/**`, `.github/workflows/*.yml` and root configs directly.
- **CodeGraph over-links names.** `Close`/`Serve`/`Open`/`Run`/`Install`/`Status`/`Emit`/
  `Shutdown`/`Session`/`Registry`/`Server` exist in Space (`gitsock`, `gitsession`, `adeagent`,
  `codeworkspace`, `gitvsix`), in Studio (`dbmcp`, `connections`, `adapters`) and in generated
  `page/wire`. Confirm every cross-package claim with `git grep` of import lines (Go's `internal/`
  rule makes those authoritative; module path `github.com/kirathecat/kira-studio`).
- **Library source** where a claim turns on library behavior: `sync.WaitGroup` (`Add` at zero
  racing `Wait`), `net` unix listener (`Close` unlinks the socket; `Accept` after close),
  `net/http` (`Server.Serve` on a closed listener, `MaxBytesReader`), `os/exec` (`Cmd.Cancel`,
  `WaitDelay`, `CommandContext` after `Start`), `syscall.Kill(-pid)` and `Setpgid`/`Setsid`,
  `github.com/creack/pty` (`StartWithAttrs`, `Setsize`, darwin blocking master),
  `modernc.org/sqlite` (DSN `_pragma`, WAL `-wal`/`-shm` file creation mode), Wails v3
  `application` (`App.Quit`, `ShouldQuit`/`OnShutdown` order, `Window.GetByName`,
  `RegisterHook(WindowClosing)`, `NewService` method exposure), `github.com/shirou/gopsutil/v4`
  (create-time reuse), `crypto/subtle`, Stryker 9 config, gremlins CLI.
- **Scratch probes** in the session scratchpad or a throwaway `_test.go`/`.spec.ts`, deleted
  before the findings commit, never committed, where a claim turns on runtime behavior: a
  `localsock` connect loop racing `Close` under `-race`; `creditGate.acquire` cancelled then
  `grant`; `Registry.Open` racing `CloseAll`/`CloseWindow`; `Coalescer` with a slow flush;
  `kirapaths.EnsureLayoutAt` on an existing shared directory; `sqlitex.Open` WAL sidecar modes
  under umask 022; a script argument with a space or a quote (`sh -c` with `set -x`).
- **Checks:** `go vet ./internal/...`; `go test -race ./internal/...`; `go build ./...` (both
  apps, one module); `go test -race` over the Studio one-hop callers that exercise this chunk
  (`./apps/kira-studio/internal/{storage/...,bridge,dbmcp,connections,adapterhost,oplog,
  preconnect,mcpinstall,mcpauth}`, `./apps/kira-studio` root `layering_test.go`); `go test`
  over Space callers read only (`./apps/kira-space/internal/{gitaskpass,gitsock,ade,adeagent,
  ghclient,gitclient,gitprepare,codeworkspace}/...`; a red Space test is reported, routed per §8,
  never fixed here); `bun run lint` (biome plus the four `scripts/check-*` linters), `bun run
  lint:go` (golangci-lint via `scripts/install-golangci-lint.sh`), `bun run lint:dead` (knip),
  `bun run typecheck`; `sh scripts/verify-packaging.sh` (Linux-safe checks only; report which
  steps skip off darwin); `sh -n` on every `.sh` and both hooks; `bun tools/mutation/summarize.ts`
  against a hand-made minimal run dir (scratch) to confirm it parses both report shapes;
  `sh scripts/mutation/run.sh go internal/notify` once (small, report-only, writes under
  gitignored `tools/mutation/out/`). Not available here: Docker (`docker info` fails),
  `shellcheck`, `actionlint`, macOS. Say so in coverage; read by hand instead. Missing deps or
  bindings: `bun install --frozen-lockfile` and `bun run setup` (or `sh scripts/
  prepare-worktree.sh`). A red check is a finding.
- **Network:** no probe contacts a public host. `appupdate` fetch tests use `httptest`.

## 1. Ownership re-run (pre-plan §8) and drift

Re-ran the §8 script verbatim at `af3bd8c`. **Part 8: 156 files, 16,364 code lines (tests
3,944).** Pre-plan (`f40cd35`): 156 files, 16,274 (3,944). Same as Part 7's plan survey
(`3410c8e`). The +90 lines come from four commits, all fixes from earlier chunks, none reviewed as
Part 8 code yet (unreviewed new code, §7):
- `aa218aa` (Part 6 F17): `internal/shell/wails.go` +45 net, `emitter`/`Dialogs`/`browserOpener`
  now hold the app in `atomic.Pointer`.
- `07e7387` (Part 6 F15): `internal/terminal/bound.go`, `Shutdown` method replaced by package func
  `ShutdownBound` (unbound); one-line caller rename in `apps/kira-space/main.go`.
- `66174c8` (Part 2 F10): `internal/sqlitex/reindex.go` +54, new `ReorderSortOrder`.
- `ee9a71e` (Part 6 F13): `internal/ipcerr/errors.go` +4, `NotFound`.

No Stream B or Stream C commit touches a Part 8 file (`git diff` of every Part 8 path from each
branch's merge base: empty). `p168-stream-b` is at Part 19 (review plan plus findings block 1);
its worktree is clean at plan time but live. `p168-stream-c` is at Part 13's review plan.

Drift elsewhere (since Part 7's plan at `3410c8e`):
- Part 2: 149 files, 20,179 to 20,198 (tests 8,088). Part 6: 96 files, 15,148 to 15,157 (4,591).
  Part 7: 91 files, 17,173 to 17,636 (6,556 to 6,760), its fixer. Parts 3-5 unchanged (27,825;
  16,751; 21,695). Part 9: 256 files, 14,723 (449), unchanged since the pre-plan.
- Stream C: Part 10 92 files, 23,917; Part 11 135 files, 30,837 to 30,845; Part 12 314 files,
  27,187 to 27,445 (10,424); Part 13 151 to 155 files, 26,924 to 26,939 (14,873).
- Stream B: Part 14 16,275; 15 15,641 to 15,661; 16 19,286; 17 23,653; 18 20,843 to 20,429; 19
  19,897 to 19,889; 20 20,312; 21 17,327; 22 19,849; 23 10,475.
- Totals: streams A 259,495, B 183,156; 2,904 owned, 0 orphans, 3,548 tracked (docs 491).
- **Stream drift (SPEC `8a008bd`, not in the script):** Parts 10-13 are Stream C. The script
  still labels them `[A]`. Edit scope follows the SPEC (§8).

**P166/P167:** findings `a37fdec` and `8a98250` list `internal/terminal` (readLoop, exitDrain,
ptmx files), `internal/testx/apphome.go`, `internal/kirapaths`, `scripts/mutation/{run,go,ts}.sh`,
`tools/mutation/{summarize.ts,stryker.config.mjs,package.json}`, `scripts/{prepare-ui-tests.sh,
codegraph-duplicates.ts,check-ade-colours.sh}` in **coverage only**; no finding names a Part 8
file (P167 F10's channel constants are `shared/protocol/events.ts`, Part 9). Both findings files
are deleted on this branch. Pre-plan churn for this chunk: 2,011 lines (mutation tooling,
terminal, shell), all reviewed in P166/P167's scope. Review the whole chunk anyway, not a diff.

**Gate G1 (Part 14 waits on Part 8) is waived and obsolete.** Stream B reviewed and fixed Parts
14-18 in parallel, at the user's direction. Those fixers read `internal/*` as an unreviewed
callee; this review sees settled Space callers instead. Consequence for edit scope: §8.

## 2. Own file set (156 files)

137 code files (12,420 production lines in 108 files, 3,944 test lines in 29 files) and 19
non-code files (not counted by the script). Per area (prod files/lines; test files/lines):

**`internal/**`, 26 packages, 115 files (86/8,613; 29/3,944):**
- **`shell`** (15/1,517; 7/743): `window` 230, `registry` 207, `wails` 193, `closeflush` 180,
  `openwindow` 156, `quit` 142, `menu` 139, `accel` 55, `deps` 43, `debounce` 38, `menutemplate`
  33, `link` 29, `security` 28, `wake` 24, `dialogs` 20. Tests: `quit_test` 271, `window_test`
  200, `menu_test` 99, `registry_test` 71, `security_test` 45, `closedecision_test` 38,
  `main_test` 19.
- **`terminal`** (7/1,021; 5/497): `session` 502, `service` 194, `bound` 141, `shell` 66,
  `validate` 56, `ptmx_linux` 47, `ptmx_other` 15. Tests: `session_test` 347,
  `session_linux_test` 73, `proc_linux_test` 42, `proc_other_test` 24, `main_test` 11.
- **`metrics`** (9/831; 2/360): `sampler` 417, `probe_darwin` 138, `ticker` 128,
  `processlist_darwin` 56, `processlist_other` 24, `responsible_darwin` 24, `responsible_other`
  17, `responsible_nocgo_darwin` 16, `probe_other` 11. Tests: `sampler_test` 288,
  `probe_darwin_calibration_test` 72.
- **`appupdate`** (4/673; 3/313): `install` 422, `checker` 201, `version` 38, `app` 12. Tests:
  `install_test` 156, `checker_test` 100, `version_test` 57.
- **`startupfail`** (7/613; 3/590): `report` 196, `classify` 149, `alert` 68, `step` 59, `render`
  53, `exec` 44, `info` 44. Tests: `report_test` 315, `classify_test` 173, `alert_test` 102.
- **`appstorage`** (4/554): `window` 242, `tabs` 153, `leaves` 115, `appstorage` 44.
- **`rpcstream`** (3/507; 2/464): `session` 366, `frame` 90, `credit` 51. Tests: `session_test`
  414, `frame_test` 50.
- **`agenthooks`** (5/492; 1/290): `agenthooks` 176, `http` 124, `manager` 81, `config` 73, `shim`
  38. Test: `server_test` 290.
- **`sqlitex`** (4/397): `sqlitex` 197, `reindex` 93, `query` 76, `load` 31.
- **`keepawake`** (4/369; 2/389): `keepawake` 161, `caffeinate` 123, `toggle` 47, `driver` 38.
  Tests: `keepawake_test` 230, `caffeinate_test` 159.
- **`appsettings`** (2/182): `repo` 104, `appsettings` 78. **`appevent`** (2/177): `coalescer` 95,
  `appevent` 82. **`notify`** (2/173; 2/122): `ordered` 122, `notify` 51; `ordered_test` 76,
  `notify_test` 46. **`logging`** (2/141; 1/42): `log` 99, `sweep` 42; `log_test` 42.
  **`toolexec`** (1/128; 1/134): `exec` 128; `exec_test` 134. **`localsock`** (1/118).
  **`testx`** (2/114): `testx` 67, `apphome` 47. **`kirapaths`** (4/109): `paths` 58, `env` 23,
  `prod_default` 17, `prod` 11. **`ipcerr`** (1/91). **`pathsafe`** (1/89). **`windowsvc`** (1/84).
  **`layeringtest`** (1/60). **`tokenauth`** (1/50). **`procgroup`** (1/49). **`jsonx`** (1/40).
  **`kiratime`** (1/34).

**Tooling, 22 code files (3,807):**
- **`scripts/`** (16/3,047): `check-theme-classes.sh` 701, `check-class-conflicts.ts` 526,
  `install.sh` 382, `codegraph-duplicates.ts` 369, `verify-packaging.sh` 366, `setup.sh` 132,
  `generate-wire.sh` 110, `check-ade-colours.sh` 92, `check-tokens.sh` 89, `prepare-ui-tests.sh`
  65, `lib.sh` 59, `sign-bundle.sh` 52, `prepare-worktree.sh` 46, `codegraph-setup.sh` 29,
  `prepare-dev-environment.sh` 15, `install-golangci-lint.sh` 14. Not owned: `scripts/demo-dbs/**`,
  `db-compat.sh`, `test-matrix.sh` (Part 3), `build-vscode.ts`, `package-vscode.ts` (Part 23).
- **`scripts/mutation/`** (3/317): `go.sh` 128, `run.sh` 121, `ts.sh` 68.
- **`tools/mutation/`** (2/428 code; 4 non-code): `summarize.ts` 366, `stryker.config.mjs` 62;
  `areas.json` 84, `tsconfig.json` 14, `package.json` 10, `.gitignore` 3.
- **`.claude/`**: `hooks/postcompact-style-reminder.sh` 15; `settings.json` 29 (non-code).

**Non-code (19 files):** `.githooks/{pre-commit 13, pre-push 14}`, `.github/workflows/{pr.yml 243,
release.yml 200}`, root `biome.json` 369, `.gitignore` 188, `package.json` 142, `knip.json` 140,
`go.mod` 137, `.golangci.yml` 51, `.jscpd.json` 14, `.mcp.json` 9, `tsconfig.json` 4,
`bunfig.toml` 2, plus the four `tools/mutation` and one `.claude` files above. Excluded, read as
context: `go.sum`, `bun.lock`, `tools/mutation/bun.lock` (lockfiles); `docs/pending-workflows/
mutation.yml` (docs; the staged workflow, §5.9).

## 3. One hop: callers (git grep of import lines)

Space callers (`PI`, `apps/kira-space/main.go`) are Stream B files (Parts 14-23). Studio callers
in `SI` are Parts 2-7 (closed). Edit rules: §8.

- **High fan-in:** `ipcerr` 67 importers (28 Studio, 28 Space, 11 in `internal`); `kiratime` 29 (27
  Studio); `sqlitex` 26 (11 Studio, 14 Space, `appstorage`); `testx` 21 (test-only, 5 Studio, 13
  Space, 3 internal); `appstorage` 19 (both apps' `storage/{db.go,model/{tabs,window}.go,
  repos/{layout,repos,settings,tabs,windows}.go}`, `bridge/tabs.go`, `shell/deps.go`). A
  signature change in any of these ripples into both apps.
- **`appevent`** (15): both `appcore/deps.go`, both `bridge/events.go`, `SI/bridge/grpc.go`
  (`grpcCoalescer`), `PI/bridge/{agentsessions,codeworkspace}.go` (`searchCoalescer`),
  `PI/main.go`; internal `shell/{closeflush,quit,wails}.go`, `terminal/{bound,service}.go`.
- **`appsettings`** (8): both apps' `storage/model/settings.go`, `storage/repos/{settings,
  layout}.go`; `PI/storage/{model,repos}/gitreposettings.go`. Mirror: `SD/settings.ts` (Part 9).
- **`notify`** (10): `SI/{adapterhost/host.go,connections/service.go,dbmcp/approval.go,
  oplog/wire.go,preconnect/supervisor.go}`; `PI/{gitrpc/handlers.go,gitsock/{pairing,server}.go,
  oplog/log.go}`; `internal/metrics/ticker.go`.
- **`shell`** (10): both `main.go`, both `appshell/{dialogs,menu}.go`, both `bridge/files.go`,
  `PI/bridge/{adetask,link}.go`.
- **`terminal`** (9): both `main.go`, both `bridge/terminal.go` (`struct{ *terminal.BoundService }`,
  Wails-bound), `PI/ade/tracker.go` (+test), `PI/bridge/{adetask,agentsessions}.go`;
  `internal/shell/openwindow.go`.
- **`procgroup`** (7): `PI/{adeagent/process.go,ghclient/runner.go,gitclient/runner.go,
  gitprepare/runner.go}`; `internal/{toolexec/exec.go,appupdate/install.go}` (+test).
- **`agenthooks`** (4): `PI/ade/tracker.go` (+test), `PI/bridge/agentsessions.go`, `PI/main.go`.
  Space only.
- **`localsock`** (2): `PI/gitaskpass/broker.go` (uses `Serve`), `internal/agenthooks/
  agenthooks.go` (hands the listener to `http.Server.Serve`, not `localsock.Serve`).
- **`rpcstream`** (2): `PI/gitsock/server.go`, `PI/bridge/gitstream.go`. TS mirror:
  `packages/git-ipc/src/rpc.ts` (`WireError`, `CreditGate`), `contract.ts` `WireErrorCode` (Part
  17, Stream B).
- **`tokenauth`** (3): `SI/mcpauth/token.go`, `PI/gitsock/token.go`, `PI/adeagent/mcp.go`.
- **`toolexec`** (4): `SI/mcpinstall/install.go`, `PI/{ghclient,gitclient}/discovery.go`,
  `PI/gitvsix/install.go`.
- **Two-app pairs** (each app's `main.go` plus its own wrapper): `appupdate` (`bridge/update.go`),
  `keepawake` (`bridge/keepawake.go`), `logging` (`bridge/settings.go`), `metrics`
  (`bridge/events.go`; also `SI/cmd/g1measure/main.go`), `windowsvc` (`bridge/windows.go`,
  Wails-bound by embedding), `kirapaths` (`config/{env,paths}.go`), `layeringtest` (both
  `layering_test.go`), `startupfail` (both `main.go`).
- **Single-app:** `jsonx` (`SI/adapters/redis/read.go`, `SI/storage/model/mutations.go`);
  `pathsafe` (`PI/codeworkspace/{paths,search}.go`).
- **Internal dependency edges:** `shell` -> `appevent`, `appstorage`, `terminal`; `terminal` ->
  `appevent`, `ipcerr`; `metrics` -> `notify`; `appupdate` -> `procgroup`, `ipcerr`; `toolexec` ->
  `procgroup`; `agenthooks` -> `localsock`; `rpcstream` -> `ipcerr`; `appstorage` -> `sqlitex`;
  `testx` -> `ipcerr`.
- **Wails-bound surface owned here:** `terminal.BoundService` (`Open`, `Write`, `Resize`, `Close`,
  `DefaultCwd`) and `windowsvc.Service` (`Ensure`, `SetMode`, `OpenNew`), each embedded in both
  apps' bridge services. Every exported method is renderer-callable.
- **Tooling callers:** `package.json` scripts (`setup`, `lint`, `lint:go`, `lint:dead`,
  `typecheck`, `package:*`, `verify:packaging`, `generate:wire`, `dedup:*`), `.githooks/*`, both
  workflows, `scripts/prepare-worktree.sh` (used by every P168 worktree), `.claude/settings.json`
  hooks, `appupdate.InstallScriptURL` (fetches `scripts/install.sh` from `main` on GitHub at
  runtime: a shipped binary executes this owned script).

## 4. One hop: callees

- **Stdlib:** `os/exec`, `syscall`, `net`, `net/http`, `database/sql`, `crypto/{rand,sha256,
  subtle}`, `log/slog`, `encoding/json`.
- **Libraries (go.mod):** Wails v3 `application`, `github.com/creack/pty` v1.1.24,
  `modernc.org/sqlite`, `github.com/shirou/gopsutil/v4` v4.26.8, `github.com/fsnotify/*`
  (callers). TS tooling: `@stryker-mutator/core`, `@hughescr/stryker-bun-runner`,
  `@vue/compiler-sfc`, `tailwind-merge` (`check-class-conflicts.ts`), gremlins (Go mutation,
  installed by `go.sh` at a pinned version), golangci-lint (`install-golangci-lint.sh`), knip,
  biome, jscpd, `dupl`. Licence of each new or tool dependency: fully open source (`CLAUDE.md`),
  checked per package and per feature used.
- **Binaries:** `/bin/sh`, `osascript`, `pbcopy`, `caffeinate`, `git`, `jq`, `tar`, `curl`
  (`install.sh`), `codesign`/`xcrun` (`sign-bundle.sh`), `codegraph`, `flatc` (`generate-wire.sh`).
- **Studio closed callees read for contract only:** `SI/storage/repos` (`ReorderSortOrder`
  callers `connections.go`, `variables.go`), `SI/adapterhost/host.go` (Part 5, also a routed
  item, §7).

## 5. Edge cases and failure modes to weight

Freeform: any kind of issue or bug counts. Weight edge cases. Security first: this chunk owns two
local auth listeners, a renderer-reachable PTY spawner, a self-update path that runs a fetched
shell script, process-group signalling, file modes for the app's data, and the CI/hook gates.

### 5.1 Local listeners and auth (`localsock`, `agenthooks`, `tokenauth`)

- **`localsock`** (`localsock.go:85-109`): `Serve` `Add`s after `Accept`, `Close` `Wait`s after
  closing the listener: routed Part 14 F4 (§7). Also: `Listen` 0700 mkdtemp then socket then
  chmod 0600 (window between `net.Listen` and `Chmod` where the socket has umask mode, inside a
  0700 dir: safe?); `sun_path` length on macOS with a long `$TMPDIR`; `Close` called twice
  (second `RemoveAll` and `Listener.Close` error); `RandHex` with `TokenBytes` 0.
- **`agenthooks`**: token check before body (`http.go:49-93`); `bearerToken` exact-case prefix;
  `X-Kira-Terminal` trusted as given (any token holder can attribute to any terminal: weigh);
  4 MiB body cap; `http.Server` timeouts on the unix socket (slow client holding a connection
  until `Close`); `Server.Close` versus in-flight `onEvent` (does `Close` wait for handlers, and
  does `onEvent` run after `Close` returns?); the hooks document and shim (`buildHooksDocument`,
  `buildShim`, `shellSingleQuote`) with a socket path or token containing `'`; file modes of the
  generated settings file; `Manager.Start` after `Stop`, double `Start`.
- **`tokenauth`**: `Verify` on an undecodable token still compares (constant time); `Hash`
  salt||tok without length prefix (fixed-length inputs: fine?); callers' TTL and dummy-compare
  discipline are theirs (Studio `mcpauth` Part 6 closed; Space Stream B).

### 5.2 RPC stream (`rpcstream`)

- **Wire error:** `wireErrorFrom` (`frame.go:84-90`) folds any non-`ipcerr` error to
  `E_INTERNAL` with `err.Error()` verbatim: can a handler's raw error carry a path, a remote URL
  with credentials or git stderr to the client? `wireError.Kind` dead (routed Part 17 F2, §7).
  Every code `rpcstream` emits (`E_INTERNAL`, `E_FRAME_TOO_LARGE`, `E_BAD_REQUEST`, others in
  `session.go`) must be in `git-ipc` `contract.ts` `WireErrorCode`; a missing one is a
  `needs-other-part-file` finding (Part 17).
- **Credit gate** (`credit.go:35-51`): `acquire` cancelled by ctx leaves its waiter channel in
  `waiters`; a later `grant` closes the dead channel and spends a credit on it. Does a stream
  that resumes after a cancel lose a credit permanently, or is the gate per stream and discarded
  on cancel? Confirm by probe.
- **Session lifecycle:** `writeLoop` versus `close` (send on a closed `sendCh`?); `Emit` after
  `Serve` returns; `handleOpen` on a duplicate stream id; `handleCancel` for an unknown id;
  `MaxFrameBytes` 0 meaning unbounded; blob frame layout (`encodeBody`) with a header over 4 GiB
  (uint32 overflow; unreachable under the frame cap?); P108 Part 2 F8 identity-keyed cleanup holds.

### 5.3 Processes (`procgroup`, `toolexec`, `terminal`, `keepawake`, `startupfail`)

- **`procgroup.GracefulCancel`**: `escalate` written in `Cancel` (Wait's goroutine), read in
  `stop`; contract says `stop` only after `Wait` returns. `WaitDelay` = delay: after it lapses
  stdlib kills only the direct child, not the group (does the SIGKILL timer still cover the group?).
  `cmd.Process.Pid` reuse after reap (P108 Part 2 #11 note in `toolexec.go:104`).
- **`toolexec.Run`**: stderr buffered unbounded in memory (`bytes.Buffer`), only the first line is
  kept; a chatty or hostile tool streams GBs. `cmd.Env = os.Environ()` by design. `Locate` probes
  candidates under user-writable dirs (who can plant a `claude`/`code` earlier in the list?).
- **`terminal`:**
  - `Registry.Open` reserves `sessions[id]=nil` during spawn. `CloseAll` and `CloseWindow` skip
    nil entries and the window index is set only after spawn: an Open racing teardown or a window
    close registers a live PTY after the sweep (orphan shell past quit, past `db.Close()`).
  - `OnChange` called outside the lock from `Open` and `remove`: two callers can deliver counts
    out of order to the keep-awake agent reason.
  - `Session.Close` versus `readLoop` (closed flag set by both; `done` wait bounds,
    `closeGracePeriod`/`closeKillWait`); darwin blocking master (Known open item: do not
    re-report).
  - `ValidateOpen`: cwd, cols/rows `[1,1000]`, `MaxCommandBytes`, `LaunchKind`; `Command` runs via
    `-c` in a login interactive shell (renderer-supplied; first-party trust model); `Env` from
    `ComposeAgent`.
  - Output: `outputCoalescer` base64 16 KiB batches; `appevent.Coalescer.flushLocked` calls
    `flush` (an `EmitTo`) while holding `c.mu`, so a slow emit blocks the PTY reader and the timer.
  - `Write` decode failure text; `Resize` `uint16` conversion after bound check.
  - `ShutdownBound` (new code, `07e7387`): confirm no other exported method on `BoundService` or
    on types it embeds is bound by accident (`Service.Shutdown` is exported but `Service` is not
    bound: confirm).
- **`keepawake`**: `Toggle.SetManual` sets `manual` under `t.mu`, then calls `Ctl.Set` outside
  it: two concurrent toggles can leave `manual` and the controller's reason disagreeing.
  `caffeinateDriver` reap versus `Release` (P108 Part 7 F12 reap race fixed: confirm, do not
  re-report); `-w <pid>` orphan guard.
- **`startupfail`**: argv-only `osascript`; `alertTimeout`; error text (any library string) in the
  alert and clipboard; `collapse`/`detailCap` on multi-byte text.

### 5.4 Self-update (`appupdate`, `scripts/install.sh`)

- **Trust:** `Installer` fetches `scripts/install.sh` from `raw.githubusercontent.com/.../main`
  on every Stage and runs it with `/bin/sh` (`install.go:23-31,74`); the contract line and host
  guard transport and compatibility, not authorship (code comment says so). A compromise of the
  repo's `main` branch is code execution on every user who clicks Install. No signature or
  pinned digest. If the reviewer finds no recorded decision accepting this (SPEC, ARCHITECTURE,
  a plan), file it `design-decision`; if one exists, cite it and file nothing.
- **Mechanics:** `maxScriptBytes` 256 KiB enforced on the body before read-all?; script written
  to a temp file (mode, location, symlink); fd-3 hand-off line protocol (`handleLine`), a `staged`
  line arriving after the timeout; `Cancel` during `stateHandedOff` no-op; `handleCancel`
  SIGTERM then SIGKILL on a reused pid; log tail (`tailError`) quoting user paths into an
  `ipcerr.Internal` message.
- **Checker:** proxy-aware client, cache intervals, single flight, version compare on pre-release
  and malformed tags (`version.go`), dev-build guard.
- **`install.sh`** (382 lines): `set -eu`, quoting of `$HOME`/app name with spaces, `curl`
  flags (`--fail`, `--proto =https`, `--speed-limit`), checksum or signature verification of the
  downloaded DMG/zip, quarantine attribute, atomic swap of the `.app`, rollback on failure, the
  contract line byte-exact at line 2.

### 5.5 Shell, windows and events (`shell`, `appevent`, `notify`, `windowsvc`)

- **Quit handshake** (`quit.go`): `Quitter.app` is a plain field written by `Attach` on main and
  read by `RequestQuit` (menu goroutine) and `flushThenQuit` (its own goroutine): same class as
  Part 6 F17 (`wails.go` atomics), not covered by that fix. `Flushed` before `flushThenQuit` seeds
  `pending` is ignored (fine); a window opened after seeding is never awaited; `teardown` before
  `done.Store(true)` and `q.app.Quit()` second pass; `Shutdown` (signal path) racing an
  in-progress `flushThenQuit`.
- **Close flush** (`closeflush.go`): one waiter per key; a second `wait` on the same key
  replaces the channel (first waiter only times out); P108 Part 2 F2 `flushing` reset on hide
  holds.
- **Window registry and open:** `removeAndCount` calls `detach` outside the lock (fine);
  `ReopenWindows` with zero rows; bounds clamp on a disconnected display (`window.go`);
  `security.go` navigation and new-window policy (an external link opening inside the WebView);
  `link.go` browser opener scheme allow-list (`file:`, `javascript:` URLs from the renderer).
- **`wails.go`** (new code, `aa218aa`): every reader goes through `Load`; `Dialogs.attached`
  error text; no remaining plain read of the app anywhere in `shell`.
- **`appevent.Coalescer`**: flush under lock (§5.3); timer `Stop` failing after fire (onTimer
  then flushes an empty or new batch: guarded by `len(pending)`); `Finish` racing `Push`.
- **`notify`**: `Emitter.Emit` delivering under or outside its lock (subscriber calling
  `Subscribe`/unsubscribe from a callback); `OrderedEmitter` P108 Part 2 F7 holds; `PendingQueue`.
- **`windowsvc`**: bound `Ensure`/`SetMode`/`OpenNew` args validation (`ipcerr` codes).

### 5.6 Storage and paths (`sqlitex`, `appsettings`, `appstorage`, `kirapaths`, `pathsafe`, `logging`)

- **`sqlitex.Open`** (`sqlitex.go:82-100`): `os.Chmod(path, 0600)` covers the main file only.
  WAL mode creates `-wal` and `-shm` beside it with the process umask (0644 typical): other local
  users can read recent writes (variables, history, secrets ciphertext). Also a window between
  `Ping` (create) and `Chmod`. Weigh against the home dir's 0700 (`EnsureLayoutAt`): if the dir is
  0700 the sidecars are unreachable; a `KIRA_HOME` pointing elsewhere changes that.
- **`Migrate`**: transaction per step; `SchemaTooNew`; a migration list with gaps or duplicates.
- **`ReorderSortOrder`** (new code, `66174c8`): `selectSQL`/`ids` contract; empty `ids`; large
  sets (one `Exec` per row inside one tx); error text quoting ids.
- **`kirapaths.EnsureLayoutAt`** (`paths.go:48-58`): `MkdirAll` then **`Chmod(home, 0700)`
  unconditionally**. `KIRA_HOME=/tmp` (or `$HOME`, or a shared project dir) chmods that directory
  to 0700. `Home` returns a relative path when `KIRA_HOME` is relative or `UserHomeDir` fails (P108
  F10 note); `requireTestHome` panics in any test binary missing `testx.RunWithTempHomes`.
- **`appsettings`**: leaf-key upsert and read (`Leaf`, `LeafValid` dropping an invalid stored
  value silently), `ValidateAppearance` ranges against `SD/settings.ts` (Part 9) zod.
- **`appstorage`**: window rows `EnsureExists`/`SetBounds` validation (negative or huge bounds),
  tabs `ReplaceKeyed`/`SaveWindowTabs` atomicity, `leaves.go`.
- **`pathsafe.ValidateRelPath`**: P108 Part 2 F10 dangling-symlink fix holds; `..`, absolute,
  NUL, case-insensitive APFS root comparison, a symlinked root.
- **`logging`**: daily writer rotation at midnight, file mode, concurrent `Write`; `Sweep` deletes
  by mtime only `kira-*.log`; `SetLevel` with an invalid string.

### 5.7 Metrics, test support, misc (`metrics`, `testx`, `layeringtest`, `jsonx`, `kiratime`, `ipcerr`)

- **`metrics`**: `cpuDeltaPercent` on pid reuse (create-time check), elapsed 0, logical CPUs 0;
  `AppProcessSet` needle matching (`containsAny`) picking an unrelated process whose name contains
  the app name; `CachedPIDs` rescan cadence; `Ticker.Stop` twice; darwin cgo probe calibration
  (not runnable here: say so).
- **`testx`**: `RunWithTempHomes` cleanup on panic; `WaitUntil` polling interval; `ProcessAlive`
  signal 0 semantics.
- **`layeringtest`**: exempt map and `allowedDeps`; does it catch an `internal/` package importing
  an app package (both directions)?
- **`ipcerr`**: `Wrap` passing through a wrapped `*Error`; `InternalErr` text; `NotFound` (new
  code) unused-code check.

### 5.8 Scripts, hooks and Claude config

- **Portability:** POSIX `sh` (dash on Linux) versus bash-isms (`[[`, arrays, `local`,
  `$'...'`, `read -d`), GNU versus BSD flags (`sed -i`, `stat -c`/`-f`, `date -d`, `readlink -f`,
  `grep -P`), `set -eu` with an unset optional var, `CDPATH= cd -- "$(dirname -- "$0")"` pattern.
- **Quoting:** unquoted `$var` and `$(...)` in commands; space-separated target lists
  (`run.sh:42` `TARGETS="$TARGETS $1"`, `go.sh:55` `for _t in $TARGETS`) breaking on a path with a
  space or glob character; `sed` regexes built from paths (`go_re` escapes only `.`); `eval`.
- **Per-script:** `setup.sh` and `prepare-worktree.sh` idempotence in a fresh worktree;
  `generate-wire.sh` output paths (P108 Part 2 F6 holds); `verify-packaging.sh` S-checks against
  current `package.json` keys (P108 F5 holds), checks that silently pass off darwin;
  `sign-bundle.sh` identity and entitlements args; `check-*.sh` linters: false negatives (a check
  that exits 0 on a parse failure: `check-class-conflicts.ts:372-377` logs and returns on an SFC
  parse error, so a broken file passes lint), exit codes, file globs missing new dirs (e.g.
  `packages/kira-ui`); `codegraph-setup.sh` failure modes; `install-golangci-lint.sh` pinned
  version and checksum; `codegraph-duplicates.ts` thresholds.
- **Mutation tooling (P151):** `run.sh`/`go.sh`/`ts.sh` argument parsing (`--changed`,
  `--resume`, `--dirty`), snapshot via `git ls-files | tar` (untracked files, symlinks, spaces),
  `unit_done` resume markers, gremlins install pin; `stryker.config.mjs` `MUTATION_ONLY` parse,
  `globSync` exclude; `summarize.ts` `new URL(import.meta.url).pathname` on a path with a space
  (`%20`, `toolsDir` wrong); unknown status keys silently ignored; `areas.json` globs against the
  current tree (an area naming a moved dir mutates nothing and reports green).
- **Git hooks:** `pre-commit` runs `bun run lint` and `bun run typecheck` only: no `gofmt`/`go
  vet` per commit (pre-push runs `go build`, `lint:go`, `lint:dead`; no Go tests anywhere in
  hooks). Weigh against `CLAUDE.md` ("fast checks per commit"). `core.hooksPath` set by
  `prepare` (`|| true` hides a failure); hooks from a subdirectory cwd; worktrees.
- **`.claude/`:** `settings.json` hook commands (`codegraph prompt-hook` missing binary: does a
  failing `UserPromptSubmit` hook block prompts?), `permissions.allow` scope; `postcompact-style-
  reminder.sh` needs `jq` (absent: hook errors every compaction).
- **`.mcp.json`:** `codegraph serve --mcp` assumes a global binary.

### 5.9 CI workflows (`.github/workflows/*`)

- **Permissions:** `pr.yml` `contents: read` (good); `release.yml` top-level `contents: write`
  applies to every job, including the test-matrix jobs that need none. Least privilege per job.
- **Pinning:** every action is pinned by mutable major tag (`actions/checkout@v7`,
  `oven-sh/setup-bun@v2`, `awalsh128/cache-apt-pkgs-action@v1`, ...). Third-party actions running
  with `contents: write` and `GH_TOKEN` in `release.yml` are the supply-chain exposure; SHA pins
  are the standard fix.
- **Triggers:** no `pull_request_target`, no `workflow_run` (confirm); `${{ github.event.* }}`
  interpolated into `run:` (script injection; none found at plan time, confirm); cache keys and
  `cache/save` from PR runs; `concurrency` groups.
- **Coverage and correctness:** steps referencing moved paths or removed scripts; `build:space`
  present (the P108 Part 2 F3/F4 patch is applied: `pr.yml:53,229`), so the
  `docs/ARCHITECTURE.md` Known open item claiming that staged patch "sits unapplied" is stale in
  part (report as a docs finding; `docs/pending-changes/` no longer exists);
  `docs/pending-workflows/mutation.yml` (read as staged context).
- **Edit path:** this session cannot push `.github/workflows/*`. A fix to an existing workflow is
  a `docs/pending-changes/.github__workflows__<name>.yml.patch` (git-diff patch plus one-line
  why); a new workflow goes to `docs/pending-workflows/` (`docs/DEV_ENVIRONMENT.md`). Merge into an
  existing pending file, never a second copy.

### 5.10 Dependencies, licences, root configs

- **`go.mod`:** Go `1.27.1` directive versus CI `setup-go` and `install-golangci-lint.sh`; direct
  deps used (unused `require` lines), test-only deps in the main module; `replace` directives.
- **`package.json`:** workspace list against real dirs; exact pins versus ranges; `prepare`;
  `typecheck` fan-out (`wait $pN` per job, exit code); scripts referencing removed files
  (`proto:*` scripts for the excluded Cheetah prototype are kept by design, P165).
- **Licences:** every root and `tools/mutation` dependency fully open source, per package and
  per feature used (`CLAUDE.md`). Report only a real violation.
- **`biome.json`, `knip.json`, `.golangci.yml`, `.jscpd.json`, `tsconfig.json`, `bunfig.toml`,
  `.gitignore`:** globs naming moved or deleted paths (P108 Part 2 F11 shape), ignores that hide
  real code (a whole dir excluded from lint or knip), linters disabled without a reason,
  `.gitignore` missing generated outputs (`SF/bindings`, `tools/mutation/out`, `.codegraph`).

### 5.11 Unit-test bar

`CLAUDE.md` bar: `rpcstream` session (ordering, credit, cancel), `notify` ordering, `shell` quit
handshake, `terminal` registry and session lifecycle, `keepawake` reap, `startupfail` classify
table, `appupdate` installer state machine clear it. Report only a true duplicate or a test
restating a trivial body (candidates: `version_test.go` 57, `closedecision_test.go` 38 against a
four-line function, `log_test.go` 42, `notify_test.go` 46, `security_test.go` 45).

## 6. What earlier fixes already changed (do not re-report)

- **P108 Part 2** (v1.9; this chunk's analogue, `docs/v1.9/SPEC.md` "P108 Part 2 result"): F1
  bounded `terminal.Session.Close` and concurrent `CloseAll`, F2 close-flush `flushing` reset on
  hide, F3/F4 `pr.yml` patch (now applied), F5 `verify-packaging.sh` S5 keys, F6
  `generate-wire.sh` gitwire path, F7 `OrderedEmitter` emit mutex, F8 `rpcstream` identity-keyed
  cleanup, F9 `BuildDSN` escaping, F10 `pathsafe` dangling symlink, F11 `biome.json` glob, F12
  `ipcerr.Error()` marshal fallback, F13 `startupfail` app name. Also P108 Part 7 F12 (keepawake
  reap race, now Part 8 code). Verify they hold; do not re-report.
- **P168 Parts 2-7** (closed) touching Part 8 files: Part 2 F10 `ReorderSortOrder` (`66174c8`),
  Part 6 F13 `ipcerr.NotFound` (`ee9a71e`), Part 6 F15 `ShutdownBound` (`07e7387`), Part 6 F17
  `wails.go` atomics (`aa218aa`). Review each as new code (§7), not as a reopened finding. Other
  Parts 2-7 fixes touch no Part 8 file. Part 5 F1 bounded `Host.CancelOp`.
- **Stream B Parts 14-18** (landed): Part 14 F4 and Part 17 F2 route here (§7); no other Stream B
  finding names a Part 8 file.
- **Parked design decisions (do not re-report, do not reopen):** Part 4 F8 (console results fully
  materialised) and F15 (sqs browse consumes on a read-only connection); Part 5 F4 binary half
  (kafka binary payload encoding); Part 6 F8 (`run_query` reaches Part 4 F8) and Part 6 F12
  exact-cookie half; Part 11 F7 (grid paging discards staged edits); Part 17 F5, F7 and the rest
  of F4; Part 18 F12.
- **Known open items** in `docs/ARCHITECTURE.md` touching this chunk: darwin terminal `Close`
  stall (P153/P157), `dbmcp` HTTP timeouts. Not a finding. The `pr.yml` coverage item is
  partly stale: report that as a docs finding only.
- **P166/P167**: no Part 8 file named in a finding; findings files deleted. Nothing to skip.

## 7. Routed items owned by this Part

Read `docs/v2.0/plans/P168-routed-to-stream-a.md`, `P168-routed-from-streamA.md`,
`P168-routed-from-streamB.md`, `P168-routed-from-streamC.md` on this branch, plus the copies on
`p168-stream-b`/`p168-stream-c` (`git show <branch>:docs/v2.0/plans/<file>`). At plan time the
`to-stream-a` and `from-streamB` files match on all three branches; this branch's
`from-streamA`/`from-streamC` are supersets of the other branches' copies. The reviewer verifies
each item below and files it with its own `F<n>`; the fixer fixes it.

- **Part 14 F4 (low): `localsock` `wg.Add` races `Close`'s `wg.Wait`.** `internal/localsock/
  localsock.go:85-109`. Confirm with a `-race` probe (connect loop while `Close`). Fix per the
  routed file: one mutex guards a `closed` flag and `Add`; `Serve` closes a conn accepted after
  `closed` without a handler; `Close` sets `closed` under the lock before `Wait`; add the `-race`
  test the routed note names (multi-goroutine, clears the test bar). The note says "same shape
  in `agenthooks`": `agenthooks` serves through `http.Server.Serve`, not `localsock.Serve`;
  reviewer checks `agenthooks.Server.Close` on its own terms (does it `Shutdown` the server and
  wait for handlers before `localsock.Close` removes the dir?). Caller `PI/gitaskpass/broker.go`
  needs no change if `Serve`/`Close` keep their signatures.
- **Part 17 F2 (low): dead `wireError.Kind`.** `internal/rpcstream/frame.go:11-19`. The Part 17
  fixer dropped `kind` from TS `WireError`/`RpcError`; confirm in `packages/git-ipc/src/rpc.ts`
  (read only), then remove the field and rewrite the struct comment. No ordering constraint.
  Also check the Go side against the shared `WireErrorCode` union (`packages/git-ipc/src/
  contract.ts:1040-1052`): every code `rpcstream` and `ipcerr` constructors reachable from
  `gitrpc` can emit is listed. A missing code is a Part 17 file: route, do not edit.
- **Part 12 F12 (low, Stream C): lost cancel before `RunOp` registers.** File `SI/adapterhost/
  host.go` (`CancelOp`, `RunOp`), Part 5's file. Part 5 closed and landed before this item was
  routed; it is unfixed at `af3bd8c` (no TTL set in `host.go`). **Decision: the Part 8 fixer
  fixes it.** `host.go` imports `internal/notify`, so it is a Part 8 one-hop caller, and pre-plan
  §3.3 lets an A fixer edit an earlier closed chunk's one-hop file in its own stream. The reviewer
  confirms the race and files it; fix per the routed note: a short-TTL set of
  cancelled-but-unknown op ids in `Host`, checked under `h.mu` in `RunOp` before registration,
  failing a match with `E_CANCELLED` without running; prune expired ids on insert. Test:
  cancel-before-run (concurrency, clears the bar). Run `go test -race ./apps/kira-studio/internal/
  {adapterhost,bridge,ipcfixture}/...` (ipcfixture needs Docker: say so if it skips). Commit names
  `P168 Part 8 (routed Part 12 F12)`.
- **Part 12 F17 (medium, Stream C): Kafka tombstone assertion in `ST/ipc/kafka/
  kafka.frontend.spec.ts`.** Part 5's file, not a Part 8 one-hop; Stream A has no other fixer
  left, so per §3.3 the orchestrator runs it as a fix-only step here, in the Part 8 fixer's pass,
  as its own commit naming `P168 Part 8 (routed Part 12 F17)`. The renderer half is landed
  (`SF/views/stream/StreamView.vue` `data-testid="stream-body-null"`). Constraint:
  `kafka.fixture.ts` is generated by `SI/ipcfixture/kafka_test.go` with `KIRA_IPC_FIXTURES=write`
  against a real Kafka container and holds no tombstone row today. Never hand-edit it (header
  rule, `ipc-fixture-sync.spec.ts`). If Docker is unavailable, the fixer records the blocker in
  the findings file and in `P168-routed-from-streamA.md` (seed step needed in `kafka_test.go`, then
  recapture, then the assertion), and the item becomes its own named follow-up in `SPEC.md` rather
  than a partial edit. Not a review finding of Part 8 code; the reviewer only confirms the state.
- **Not Part 8:** Part 4 F12/F20, Part 5 F4/F7, Part 6 F11/F13/F19, Part 7 F17/F18, Part 10 F6/F18
  (Stream C renderer halves or done). Confirm nothing else in the four files names a repo-root
  `internal/`, `scripts/`, `tools/`, `.githooks/`, `.claude/`, `.github/` or root config path
  (`git grep` across all three branches' routed and findings files).

## 8. Rubric, order and outputs

- **One Opus reviewer**, freeform "any kind of issue or bug", edge cases weighted. Not three
  dimension reviewers (user deviation from `CLAUDE.md`'s recipe, P168 only).
- Reports only. Fixes nothing, edits no code.
- **Whole chunk, one pass, in this block order** (security-weighted listeners and processes
  first, then lifecycle, then storage, then tooling and CI). About 12.4k production lines plus
  3.9k test lines: read tests only where they are the sole guard of a claim, or in block 8.
  1. **Listeners and RPC:** `localsock`, `agenthooks`, `tokenauth`, `rpcstream` (`frame`,
     `credit`, `session`); routed Part 14 F4 and Part 17 F2 here.
  2. **Processes:** `procgroup`, `toolexec`, `terminal` (all files, incl. `ShutdownBound` new
     code), `keepawake`, `startupfail`.
  3. **Self-update:** `appupdate`, `scripts/install.sh`.
  4. **Shell and events:** `shell` (all files, incl. `wails.go` new code), `appevent`, `notify`,
     `windowsvc`; both apps' `main.go` wiring of them (read only).
  5. **Storage, paths, misc:** `sqlitex` (incl. `ReorderSortOrder` new code), `appsettings`
     (against `SD/settings.ts`, read), `appstorage`, `kirapaths`, `pathsafe`, `logging`,
     `metrics`, `jsonx`, `kiratime`, `ipcerr` (incl. `NotFound` new code), `testx`,
     `layeringtest`; routed Part 12 F12 (`adapterhost/host.go`) verification here.
  6. **Scripts, mutation tooling, hooks, Claude config:** every owned `scripts/**`,
     `scripts/mutation/**`, `tools/mutation/**`, `.githooks/*`, `.claude/**`, `.mcp.json`.
  7. **CI and root configs:** both workflows, `docs/pending-workflows/mutation.yml` (context),
     `go.mod`, `package.json`, `biome.json`, `knip.json`, `.golangci.yml`, `.jscpd.json`,
     `tsconfig.json`, `bunfig.toml`, `.gitignore`; licence check; routed Part 12 F17 state check.
  8. **Tests and checks:** every Part 8 `_test.go`, the §0 checks and probes.
- **Resumable:** write `docs/v2.0/plans/P168-part8-findings.md` as blocks finish, and commit it
  after **every** block (`docs(v2.0): P168 Part 8 findings, block <n>`; normal commit, hooks
  green, explicit `git add <path>`). Mark each block done in the file's coverage section. An
  interrupted run reads the file, resumes at the first block not marked done, and never
  re-derives a committed block.
- Each finding: id (`F<n>`), severity (high/medium/low), `file:line` on the current tree, a
  concrete failure scenario (inputs, sequence, observed outcome; say which probe or real run
  confirmed it), and a proposed fix. Tag `design-decision` when it needs one; the fixer turns it
  into its own `SPEC.md` phase. A finding that restates a parked decision (§6) is not filed.
- **Edit scope tag.** Stream B (Parts 14-23) has a live worktree (`/home/user/kira-studio-
  streamB`, Part 19 in progress); pre-plan §3.3's "before Stream B starts" allowance is spent.
  - The fixer may edit: every Part 8 file; Stream A one-hop files in Parts 2-7 (closed) and Part 9
    (later, same stream): `SI/**` callers (`storage/**`, `bridge/**`, `appcore`, `connections`,
    `adapterhost`, `oplog`, `preconnect`, `dbmcp`, `mcpauth`, `mcpinstall`, `config`,
    `adapters/redis/read.go`, `cmd/g1measure`), `apps/kira-studio/main.go`,
    `apps/kira-studio/internal/layering_test.go`, `SD/settings.ts` and
    `shared/protocol/events.ts` (Part 9); the two routed Part 5 files (§7); `docs/` (an
    ARCHITECTURE or DEV_ENVIRONMENT fact the fix changes); `docs/pending-changes/` and
    `docs/pending-workflows/` for workflow fixes.
  - **Space (`kira-space`) files owned by Parts 14-23 are not editable**, except a one-line
    rename required to keep `go build ./...` green after a Part 8 API change (the `07e7387`
    precedent; say so in the commit message). Any other fix needing a Space file carries
    `needs-other-part-file: <path> (Part N)` and the fixer routes it to
    `docs/v2.0/plans/P168-routed-from-streamA.md` (Stream B section) with exact file and change.
    Prefer a Part 8 fix that keeps exported signatures stable, so Space callers need nothing.
  - Stream C files (Parts 10-13: `SF/api/**`, `SF/views/**`, `SF/state/**`, `SF/project/**`,
    `SF/workbench/**`, `ST/ui/**`, `ST/unit/**` outside Parts 5-7, `ST/fixtures/**`) carry
    `needs-other-part-file` and route to `P168-routed-from-streamA.md`; never edited here.
  - `.github/workflows/*` are never edited directly (§5.9 edit path).
- The findings file states base commit (`af3bd8c`), HEAD reviewed, checks run and results (vet,
  race over `internal` and one-hop callers, build, Space tests read only, lint, lint:go,
  lint:dead, typecheck, verify-packaging, `sh -n`, mutation smoke, probes), findings, then
  coverage per block: reviewed, skimmed (with reason), not reached, not runnable here (Docker,
  macOS, shellcheck, actionlint). No unexplained gap. A chunk with nothing real says so; never
  manufacture a finding.
- Final commit `docs(v2.0): P168 Part 8 findings`, normal commit, hooks green, before any fixer
  starts.
- Then one Sonnet fixer: one commit per group of related findings, naming `P168 Part 8`; routed
  items in their own commits (§7). A fix re-runs `go build ./...`, `go vet ./internal/...` and
  `go test -race` over the touched `internal` packages plus every one-hop caller package it could
  affect (both apps; Space tests run read only, a Space break that is not a one-line rename is a
  stop-and-route, never a Space edit); `bun run lint`, `bun run lint:go`, `bun run typecheck` for
  script, config or TS changes; `sh -n` and a real run of any edited script; `bun run setup` and
  the touched UI subset when a bound shape (`terminal.BoundService`, `windowsvc.Service`)
  changes. Workflow fixes land as patch files only. It deletes the findings file when done.
  Chunk lands per pre-plan §3.4 before Part 9's plan starts.

## 9. Candidate suspects (unconfirmed; verify, do not assume)

Raised during planning discovery. Each is a lead, not a finding.

1. `creditGate.acquire` (`credit.go:35-51`) leaves a cancelled waiter in `waiters`; the next
   `grant` closes it and burns a credit, so a live waiter behind it can stall.
2. `terminal.Registry.Open` (`session.go:345-377`): an id reserved as `nil` is skipped by
   `CloseAll` and `CloseWindow` (`byWindow` set only after spawn), so an Open racing quit or a
   window close leaves a live PTY past teardown.
3. `appevent.Coalescer.flushLocked` (`coalescer.go:83-95`) calls `flush` (`EmitTo`) under `c.mu`:
   a slow emit blocks the terminal reader goroutine and the gRPC/search producers.
4. `Quitter.app` (`quit.go:29,60,81,141`) is a plain field written by `Attach` and read from other
   goroutines; `aa218aa` made the `wails.go` holders atomic but not this one.
5. `kirapaths.EnsureLayoutAt` (`paths.go:48-58`) chmods an existing `KIRA_HOME` to 0700
   unconditionally: pointing `KIRA_HOME` at a shared dir changes that dir's mode.
6. `sqlitex.Open` (`sqlitex.go:82-100`) tightens the main DB file only; WAL `-wal`/`-shm` keep
   umask modes.
7. `toolexec.Run` (`exec.go:107-128`) buffers a child's whole stderr in memory to keep one line.
8. `keepawake.Toggle.SetManual` (`toggle.go:41-47`) updates `manual` and the controller under
   different locks: concurrent toggles can disagree.
9. `appupdate` runs a script fetched from the repo's `main` branch with no signature or digest
   (`install.go:23-31`): check for a recorded decision before filing `design-decision`.
10. `rpcstream.wireErrorFrom` (`frame.go:84-90`) sends a raw non-`ipcerr` error string to the
    client as `E_INTERNAL`.
11. `release.yml` grants `contents: write` workflow-wide and both workflows pin actions by mutable
    tag, third-party ones included.
12. `check-class-conflicts.ts:372-377` logs an SFC parse failure and returns: the lint passes on a
    file it could not check.
13. `summarize.ts:81` derives `toolsDir` from `URL.pathname` (percent-encoded on a path with a
    space); `run.sh:42`/`go.sh:55` split targets on spaces.
14. `pre-commit` runs no Go check (`gofmt`, `go vet`); Go breakage surfaces only at push.
15. `docs/ARCHITECTURE.md` Known open item on `pr.yml` says the staged P108 patch is unapplied;
    `pr.yml:53,229` show it applied and `docs/pending-changes/` is gone.

## 10. Out of scope

- Space callers' internals (`gitaskpass`, `gitsock`, `gitsession`, `ade`, `adeagent`,
  `codeworkspace`, `gitclient`, Stream B) beyond how they call this chunk.
- Studio callers' internals (Parts 2-7, closed) beyond the callee contract, except the routed
  `adapterhost/host.go` and `kafka.frontend.spec.ts` items (§7).
- `scripts/demo-dbs/**`, `db-compat.sh`, `test-matrix.sh` (Part 3); `build-vscode.ts`,
  `package-vscode.ts` (Part 23).
- `SD/settings.ts` and the rest of the shared frontend base (Part 9, next): read only as the
  `appsettings` mirror.
- Parked design decisions and Known open items (§6).
- Generated code (`SI/page/wire`, `PI/gitwire`, `git-ipc/src/generated`), lockfiles, docs, excluded
  files (pre-plan §6).
