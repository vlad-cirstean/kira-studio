# P237 result

Opt-in real `claude` suite. Gate: build tag `realclaude` plus `KIRA_REAL_CLAUDE=1`. Stream B, branch
`p236-239-B`, base `e0a0e9874`.

## Delivered

- `internal/memory/smoke_test.go`, `internal/memory/importer/smoke_test.go`: retagged `claudesmoke` to
  `realclaude`, added the env skip. `engine_test.go` comment updated.
- `apps/kira-space/internal/realclaude/`: `TestTerminalAgentHooks`, `TestHookPayloadContract`,
  `TestShimInertForPlainClaude`, `TestRealClaudeSettingsUntouched`, `TestAdeHeadlessRun` (3 cases, one a
  control proving the poisoned project setting bites), `TestAdeStageSession`, `TestMemoryMcpThroughClaude`,
  `TestMemoryInstallRegisters`.
- `apps/kira-studio/internal/realclaude/`: `TestDbMcpThroughClaude`, `TestDbMcpInstallRegisters`.
- `docs/DEV_ENVIRONMENT.md`: section "Real `claude` tests (P237)" with area table, P149 bullet replaced,
  `claudesmoke` commands updated, duplicate Studio flow section merged, P236 coverage-gate line added.
- `CLAUDE.md`: one bullet.

## Deviations from the plan

- Env leak: unsetting `CLAUDE_CODE_SESSION_ID` and `CLAUDECODE` was not enough in this sandbox. The child
  reused `CLAUDE_CODE_REMOTE_SESSION_ID` as its `session_id`. Suite unsets that too.
- Wrapper script, not a bare symlink, replaces the fake `claude` in `BinDir`: it tees stdout of `claude -p`
  runs so the 0.10 USD per-test cost guard can read `total_cost_usd` (the ADE run log drops it). Interactive
  launches exec the real binary.
- Studio install test: the Studio harness fakes the MCP installer (harness owned by Stream A, unchanged).
  `TestDbMcpInstallRegisters` calls `DbMcp.InstallClaudeCode` against the fake, then forwards the recorded
  `url` and helper path to the real `mcpinstall` installer. Same arguments the app computes.
- Trust seeding: explicit per cwd (repo root and `launch.Cwd`). Not checked whether a parent dir covers a
  worktree. ADE `LaunchStage` on a task with no run uses the repo root as cwd.
- Spend counter: Space `TestMain` prints measured `claude -p` spend to stderr (TUI sessions not counted).
- `TestTerminalAgentHooks` passes `--model haiku` through the command; `--max-budget-usd` applies to `-p` only.
- `settings_test.go` ships with commit 3 (it depends on the ADE fixture), not commit 2.

## Findings in files other streams own

None.

## Verification checklist

Real output lines, run in `/home/user/kira-sB`.

- Default runs never compile the suite:
  `package github.com/kirathecat/kira-studio/apps/kira-space/internal/realclaude: build constraints exclude all Go files in ...`
  (the same line for the Studio package). `go list ./...` and `./...` patterns skip them.
- `grep -rn claudesmoke --include=*.go .` prints nothing. `grep -rln "go:build realclaude" apps internal` lists
  both new packages (`main_test.go`, `helpers_test.go`, ...) plus `internal/memory/smoke_test.go` and
  `internal/memory/importer/smoke_test.go`.
- Env lock, no tokens spent: `real claude tests: set KIRA_REAL_CLAUDE=1 (spends real tokens)` for both packages.
- `go vet -tags realclaude ./apps/kira-space/internal/realclaude/ ./apps/kira-studio/internal/realclaude/ ./internal/memory/...`
  clean. `golangci-lint run --build-tags realclaude` on those paths: `0 issues.`
- `TestHookPayloadContract`: `--- PASS: TestHookPayloadContract (5.00s)`.
- Full real run, all green:
  - Space: `ok  github.com/kirathecat/kira-studio/apps/kira-space/internal/realclaude  73.146s` and
    `real claude spend (claude -p results only, TUI sessions not counted): 0.0144 USD`.
  - Studio: `--- PASS: TestDbMcpThroughClaude (10.21s)`, `--- PASS: TestDbMcpInstallRegisters (1.33s)`.
  - Memory gate: `--- PASS: TestSmokeRealClaude (15.66s)`. Import: `--- PASS: TestSmokeImport (59.82s)`.
  - Estimated total for Space plus Studio plus memory gate: under 0.10 USD; import smoke 0.14 USD (P211).
- DEV_ENVIRONMENT: `docs/DEV_ENVIRONMENT.md:408:## Real `claude` tests (P237)`; table has every area row;
  `grep -c "Kira Studio flow suites (P232)"` prints `1`; `grep -c "cannot sign in"` prints `0`.
- CLAUDE.md added lines: `2`.
- `git diff --stat e0a0e9874..HEAD -- .githooks .github package.json` is empty.
- `git diff --name-only e0a0e9874` touches only Stream B paths.
