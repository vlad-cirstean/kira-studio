# P242 Part 2 result

Plan: `P242-part2-plan-iter2.md`. Branch `p242b-J`, rebased on v2.0.

## Delivered

- `internal/claudeheadless` (moved from Space `adeagent`): model, budget, tool flags, isolation, result event, user MCP servers. Shared login shell and fake claude.
- `scripts` smart kind, params, tool allowlist. `scriptruns` Preview, Start, ReadLog, McpServers, McpTools, launch tokens, run logs. Both apps, identical migrations.
- Workbench: smart script editor, run dialog (task/branch popup, full preview, interpolated variables via VarText), run tab.
- Tests: flows in both apps, UI specs, e2e-real, real claude `TestSmartScriptRun` in both apps.
- Docs: ARCHITECTURE, DEV_ENVIRONMENT row "Smart scripts", SPEC row.

## Applied decisions

- Needs-you `automation` entry dropped.
- Studio keeps report server name `kira-ade`.
- Smart runs load no Claude settings files.
- Defaults: sonnet, 1 USD, 15 min.
- No credential reads anywhere.

## Fixes beyond the plan (pre-existing)

- Space `mobileflow` `freePort` picks below the ephemeral range: `TestEnableTrustPort` failed once on a stolen port.
- Studio `docker-module` spec: endpoint chip scoped to the panel (two chips matched).
- Studio visual baselines (5 stale after the Automations rename, plus script dialog) regenerated.
- Studio real claude `TestDbMcpInstallRegisters`: installer now resolves the real claude. The shared fake claude sat first on PATH and failed `mcp add`.

## Checks

- gofmt, `go vet ./...`, `go build ./...`, `bun run typecheck`, `bun run lint`, `bun run lint:dead`: clean. golangci-lint on realclaude-tagged packages: 0 issues.
- `test:flows:space`, `test:flows:studio`: green, coverage gate green, both `exempt.txt` empty.
- `go test ./apps/kira-space/internal/... ./apps/kira-studio/internal/... ./internal/...`: green on rerun.
- Space UI 344 pass; Space visual 8 pass. Studio UI 359 pass first run, 2 failures: docker spec (fixed), `http-timeline` failed-send (load flake, 15 of 15 pass on repeat). Studio visual 13 pass.
- e2e-real: Space 28 pass, Studio 24 pass.
- Real claude: Space `TestAdeHeadlessRun|TestAdeStageSession|TestAdeRebaseRun|TestRealClaudeSettingsUntouched|TestSmartScriptRun` PASS (0.0220 USD, smart 0.0013 USD); hooks and memory MCP rows PASS; memory gate smoke PASS; Studio suite PASS (smart 0.0003 USD).

## Not done

- Complete flow suites (`:complete`) not run.
- `go build -tags server` for Space not run (missing `frontend/dist-mobile` locally, as in Part 1).
- `TestRebaseRun` failed twice in a row at one point (condition not met in 20 s) then passed on every later run, 8 in total; cause not isolated, likely host load after the UI suites.
