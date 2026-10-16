# P237 plan: opt-in tests against a real `claude` CLI

SPEC row P237. User's words: "Prepare tests using a real `claude -p`. NOT run automatically (they
consume real tokens); the agent runs them individually when changes land in that area."

Base: `v2.0` at `a6637fbdf`. Stream B (SPEC stream table). One sequential Sonnet implementer.

Discovery: `codegraph_explore` over `internal/agenthooks` (Manager, Server, handleHook,
hookRequest, buildHooksDocument), `internal/terminal` (BoundService.Open, Registry.AgentSessions),
`internal/memory` smoke tests; `apps/kira-space/**` read directly (not indexed). CLI behaviour below
was measured in this sandbox with `claude` 2.1.295 (`/opt/node22/bin/claude`), haiku, about
0.002 USD per call.

## 1. Measured facts the suite builds on

- `claude -p ... --settings <hooks.json>` fires `SessionStart`, `UserPromptSubmit`, `Stop` hooks.
  Stop payload carries `hook_event_name`, `session_id`, `cwd`, `transcript_path`,
  `stop_hook_active`, `last_assistant_message` ("pong"), `background_tasks`, `session_crons`.
- An interactive TUI in a PTY works here when the temp `HOME` has `.claude.json`
  `{"hasCompletedOnboarding":true,"theme":"dark","projects":{"<cwd>":{"hasTrustDialogAccepted":true}}}`.
  Without `projects[cwd]` it stops at the folder-trust dialog. Hooks fire the same in the TUI.
  This corrects `docs/DEV_ENVIRONMENT.md` "An interactive `claude` cannot sign in here (P149)".
- Auth here comes from env (proxy-managed), so a temp `HOME` still authenticates. A temp HOME's
  `~/.claude/settings.json` stays byte-identical across a run; the CLI writes `.claude.json`,
  `backups/`, `policy-limits.json`, `projects/` itself (P233 A13).
- Inherited `CLAUDE_CODE_SESSION_ID`/`CLAUDECODE` from this agent session leak into a child: the
  child's hook `session_id` equalled the parent session's id. The suite unsets those two (only) and
  the preflight asserts the child id differs. Never unset auth-related vars.
- `statusLine` from `--settings` runs in the TUI; payload has `rate_limits` (P239 uses this; not this
  suite's area).

Not verified (no Mac here): keychain auth with a temp `HOME` on macOS. Preflight handles it (2.3).

## 2. Design

### 2.1 Gate: two locks, both required

- Build tag `realclaude` on every file of the suite. `go test ./...`, `test:flows:*`, pre-commit,
  pre-push and CI never compile them.
- `TestMain` skips the whole package unless `KIRA_REAL_CLAUDE=1`, printing
  `real claude tests: set KIRA_REAL_CLAUDE=1 (spends real tokens)`.
- Retag the two existing real-CLI smokes from `claudesmoke` to `realclaude` and add the same env
  check: `internal/memory/smoke_test.go`, `internal/memory/importer/smoke_test.go`; update the
  `claudesmoke` mention in `internal/memory/importer/engine_test.go`'s `TestMain` comment (the
  `KIRA_TEST_MEMORY_MCP` re-exec is set by the smoke test itself and keeps working). One tag for every real-CLI test. `embedsmoke` stays (no
  tokens).

### 2.2 Packages

- `apps/kira-space/internal/realclaude/` (new): Space areas. Imports `flowharness` (unchanged; owned
  by Stream A). `main_test.go`: `os.Exit(realMain(m))` = env gate, then `flowharness.Main(m)` (so
  the test binary still serves `gh`, askpass, `memory-mcp`).
- `apps/kira-studio/internal/realclaude/` (new): Studio areas, Studio `flowharness` unchanged.
- Shared helper code per package in `helpers_test.go` (build-tagged), no exported package.

### 2.3 Harness use without editing the harness

`newRealApp(t)`:

1. `real, err := exec.LookPath("claude")` before `flowharness.New` (skip with a clear message if not
   found). Resolve symlinks.
2. `app := flowharness.New(t)`; then replace `app.BinDir/claude` (the fake) with a symlink to
   `real`. Launches resolve `claude` through the login shell's PATH, whose first entry is `BinDir`
   (P150 profile fix), so the real binary runs; a `~/.local/bin` install outside the temp HOME
   still works because the symlink is absolute.
3. Seed `app.Home/.claude.json`: onboarding done, theme, and `projects[<dir>]` trust for each cwd
   the test will launch in (`seedTrust(app, dirs...)`, rewritten before each launch). Check once
   whether trust of a parent dir covers a worktree below it; if not, seed the worktree path from
   `StartBranch`'s result before `LaunchStage`.
4. darwin only: copy `oauthAccount` and `userID` (only those keys, read-only) from the real
   `~/.claude.json` into the seeded file if present. Unverified need; preflight decides.
5. Env for the app process (`t.Setenv`): `ANTHROPIC_MODEL=haiku` (app-composed launches have no
   `--model`), unset `CLAUDE_CODE_SESSION_ID` and `CLAUDECODE`.
6. Preflight once per package (`sync.Once`): `claude -p "Reply: ok" --model haiku --max-budget-usd
   0.02 --output-format json` in the temp HOME. Assert exit 0, `modelUsage` has a `haiku` key
   (proves the model pin), `session_id` differs from the parent's. On auth failure: `t.Skip` with
   the stderr tail and the DEV_ENVIRONMENT section name, never a fail.

### 2.4 Cost guards

- Every argv the test builds: `--model haiku --max-budget-usd 0.05`, prompts of one sentence asking
  for a fixed one-word reply or one specific tool call.
- App-built launches (ADE headless, TUI): `ANTHROPIC_MODEL=haiku`, single-step workflow with a
  one-line prompt; read `total_cost_usd` from the run's stream-json result line and fail above
  0.10 USD per test.
- Per-test `context.WithTimeout` 3 min; package `-timeout 15m` in the documented command.
- Expected full-suite spend: under 0.30 USD (about 12 calls, haiku). Write the measured figure into
  the DEV_ENVIRONMENT table after the first full run.

## 3. Tests (area -> file)

Space (`apps/kira-space/internal/realclaude/`):

| File | Test | Asserts |
|---|---|---|
| `hooks_test.go` | `TestTerminalAgentHooks` | `Terminal.Open` with `LaunchKind: claude-code`, `Command: "claude --model haiku"` in a real repo; type a one-word prompt + Enter through `Terminal.Write`; `app.Events` (ChannelAgentEvent recorder) sees `SessionStart`, `UserPromptSubmit`, `Stop` with this `terminalId`; `Terminal.AgentSessions` lists it while live; `Close` removes it |
| `hooks_test.go` | `TestHookPayloadContract` | plain `claude -p` with a capture-only hooks file (a test shim writing raw stdin): every `json` tag of `agenthooks.hookRequest` the event should carry is present (`hook_event_name`, `session_id`, `cwd` always; `tool_name`, `tool_use_id` on a forced `Bash` `true` call's Pre/PostToolUse; `source` on SessionStart). Every name in `agenthooks.hookEvents` is accepted by the CLI (no settings validation error on stderr). Catches CLI payload drift. Field list copied into the test (the struct is unexported), with a comment naming `internal/agenthooks/http.go` |
| `hooks_test.go` | `TestShimInertForPlainClaude` | a Kira `hooks.json` (from `app.W.AgentHooks.Status().SettingsPath`) passed to a plain `claude -p` without `KIRA_*` env: the listener receives 0 requests (count via the Events recorder) |
| `settings_test.go` | `TestRealClaudeSettingsUntouched` | seed `~/.claude/settings.json`, `<repo>/.claude/settings.json`, `<repo>/.claude/settings.local.json`; run a terminal agent session, an ADE TUI stage, an ADE headless run, an app restart; mode + sha256 of all three equal. `.claude.json` excluded with the A13 reason in a comment. Real-CLI twin of `claudeflow.TestClaudeSettingsUntouched` |
| `ade_test.go` | `TestAdeHeadlessRun` | one-step workflow ("Call finish_step with summary ok."); `StartRun` -> run reaches `done`; the run log has the `kira-ade` `finish_step` tool call; `--setting-sources` honoured (seed a project setting that would break it under `user` and run with `ade.headlessSettingSources: user`) |
| `ade_test.go` | `TestAdeStageSession` | `LaunchStage` (TUI) -> Stop hook bumps the record's last active; the Claude session id recorded matches `SessionStart`; `Send` delivers a second prompt and a second Stop arrives |
| `memory_test.go` | `TestMemoryMcpThroughClaude` | `claude -p --strict-mcp-config --mcp-config <stdio: test binary memory-mcp, KIRA_MEMORY_HOME=temp>` asked to call `search_memories`; stream-json shows the `mcp__kira-memory__search_memories` tool use and a result |
| `memory_test.go` | `TestMemoryInstallRegisters` | `Memory.InstallClaudeCode` under the temp HOME; `claude mcp list` (temp HOME) shows `kira-memory`; the entry lands in the temp `.claude.json` (proves the install used the temp HOME; the real `~/.claude.json` is not checked, other `claude` processes rewrite it) |

Studio (`apps/kira-studio/internal/realclaude/`):

| File | Test | Asserts |
|---|---|---|
| `dbmcp_test.go` | `TestDbMcpThroughClaude` | SQLite connection created, `DbMcp.SetEnabled(true)`; `--mcp-config` with the server URL and `headersHelper`; `claude -p --strict-mcp-config` asked to call `list_connections`; tool use + the connection name in the result |
| `dbmcp_test.go` | `TestDbMcpInstallRegisters` | `DbMcp.InstallClaudeCode` under temp HOME; `claude mcp list` shows `kira-db` connected |

Existing, retagged: `internal/memory` `TestSmokeRealClaude` (gate), `internal/memory/importer`
`TestSmokeImport` (import).

## 4. Docs

### 4.1 `docs/DEV_ENVIRONMENT.md` new section "Real `claude` tests (P237)"

Content (terse, per CLAUDE.md):

- What: opt-in tests that run the real `claude` CLI and spend tokens. Never in CI or hooks.
- Gate: `-tags realclaude` and `KIRA_REAL_CLAUDE=1`; both required.
- Needs: authenticated `claude` on PATH. Uses haiku, temp HOME, `--max-budget-usd`. Measured spend
  per test and full suite (fill after first run).
- Rule: changed code in an area below -> run that row before calling the change done.
- Table:

| Changed area (paths) | Command |
|---|---|
| Hook injection, shim, listener: `internal/agenthooks/**`, `apps/kira-space/internal/ade/tracker.go`, `internal/terminal/bound.go` | `KIRA_REAL_CLAUDE=1 CGO_ENABLED=1 go test -tags realclaude ./apps/kira-space/internal/realclaude/ -run 'TestTerminalAgentHooks\|TestHookPayloadContract\|TestShimInertForPlainClaude' -v -timeout 15m` |
| Claude config isolation (anything that composes a `claude` argv or env, `appwire/wire.go`) | `... -run TestRealClaudeSettingsUntouched ...` |
| ADE runs and sessions: `apps/kira-space/internal/{ade,adeagent,adeflow}/**` | `... -run 'TestAdeHeadlessRun\|TestAdeStageSession' ...` |
| Memory MCP and install: `internal/memory/memorycli/**`, `internal/mcpinstall/**`, `apps/kira-space/internal/bridge/memory.go` | `... -run 'TestMemoryMcpThroughClaude\|TestMemoryInstallRegisters' ...` |
| Memory gate: `internal/memory/{claude.go,gate*.go,service.go}` | `KIRA_REAL_CLAUDE=1 go test -tags realclaude ./internal/memory/ -run Smoke -v` |
| Memory import: `internal/memory/importer/**` | `KIRA_REAL_CLAUDE=1 go test -tags realclaude ./internal/memory/importer/ -run Smoke -v` (about 50 s, 0.14 USD, P211) |
| DB MCP: `apps/kira-studio/internal/dbmcp/**`, `apps/kira-studio/internal/bridge/dbmcp.go` | `KIRA_REAL_CLAUDE=1 CGO_ENABLED=1 go test -tags realclaude ./apps/kira-studio/internal/realclaude/ -v -timeout 15m` |
| Claude CLI upgrade | whole suite: both `realclaude` packages plus the two memory rows |

- Sandbox notes: TUI works with the seeded `.claude.json` (replace the P149 bullet in the
  server-tag section); unset `CLAUDE_CODE_SESSION_ID`/`CLAUDECODE` inside an agent session;
  lint the tagged files with `golangci-lint run --build-tags realclaude ./apps/kira-space/internal/realclaude/... ./apps/kira-studio/internal/realclaude/...`.
- Update the "Memory MCP and the `claude` CLI" section's two `claudesmoke` commands to the new tag.
- Remove the duplicated "Kira Studio flow suites (P232)" section (two copies today; merge into one).
- Add one line under the Space flow suites section pointing at the P236 coverage gate:
  `apps/<app>/internal/flows/coverage/` (fails on a bound method with no flow call; exempt with a
  reason in `exempt.txt`). Stream A creates that path; the line is docs only.

### 4.2 `CLAUDE.md`: one bullet

Under the testing bullets: "**Real `claude` tests are opt-in and cost tokens.** After changing
Claude integration code, run the matching row of `docs/DEV_ENVIRONMENT.md` "Real `claude` tests";
never wire them into hooks or CI."

### 4.3 `docs/ARCHITECTURE.md`

Not edited by Stream B (Stream C owns it). The Testing section's tier list gets the realclaude tier
in the post-landing doc pass the orchestrator runs (P236 plan section 7).

## 5. Commits

1. `test: realclaude tag and env gate; retag memory smokes`.
2. `test(space): real claude hook, settings and payload contract tests`.
3. `test(space): real claude ade and memory mcp tests`.
4. `test(studio): real claude db mcp tests`.
5. `docs: real claude test table, sandbox TUI note, dedupe flow section`.
6. Fixes for anything the real runs find (own commits; a finding in a Stream A or C file goes to
   `docs/v2.2/plans/P237-findings.md` marked "after landing").

## 6. Verification checklist (orchestrator)

- Default runs never compile the suite: `go vet ./... && go test ./apps/kira-space/internal/realclaude/ 2>&1 | grep -q 'no test files\|build constraints exclude'`.
- `grep -rn "claudesmoke" --include=*.go .` returns nothing; `grep -rln "go:build realclaude" apps internal` lists both packages and the memory smokes.
- Env lock: `CGO_ENABLED=1 go test -tags realclaude ./apps/kira-space/internal/realclaude/ -v 2>&1 | grep -i 'KIRA_REAL_CLAUDE'` shows the skip line, 0 tokens spent.
- Compiles and lints with the tag: `go vet -tags realclaude ./apps/kira-space/internal/realclaude/ ./apps/kira-studio/internal/realclaude/ ./internal/memory/...`; golangci-lint with `--build-tags realclaude` on those paths.
- One real run here (cheap): `KIRA_REAL_CLAUDE=1 ... -run TestHookPayloadContract -v` passes; result section records its spend.
- Full real run once at phase end, all green; spend recorded in the DEV_ENVIRONMENT table.
- `git grep -n "Real \`claude\` tests" docs/DEV_ENVIRONMENT.md`; table has every area row above;
  `grep -c "Kira Studio flow suites (P232)" docs/DEV_ENVIRONMENT.md` is 1; the P149 "cannot sign in" bullet is gone.
- `git diff a6637fbdf -- CLAUDE.md | grep '^+' | grep -v '^+++' | wc -l` is 1 to 3 lines (one bullet).
- No hook/CI/package.json change: `git diff --stat a6637fbdf..HEAD -- .githooks .github package.json` empty.
- `git diff --stat` touches only Stream B paths.
