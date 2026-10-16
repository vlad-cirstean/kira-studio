# P146 Stream A notes

Base `2ad7fdea`, branch `v2.0-p146-a`. Not pushed.

## Commits

- `d66011f4` feat: ade sessions rebuild, run log and run writes (migration 0010, repos)
- `902dd562` feat: ade worktree creation and setup gate
- `f2817f6e` feat: headless claude runner and stream-json parser
- `6a455e0f` feat: finish_step MCP server
- `f23d5ae4` feat: ade step machine and script stages
- `aa4f83cd` feat: AdeTaskService P146 methods and channels
- `541d0cb5` test: ade run engine with a fake claude
- `fd6deb40` fix: ade lint findings

## Deviations

- Real `claude -p` smoke ran as a scratch Go test (deleted) on the engine's own test harness with
  `ClaudeBin=claude`, not a `-tags server` build. Same engine code path; no bindings or UI involved.
- Smoke result: setup `prepared`, headless session row `stopped`, `finish_step` over MCP reached the
  engine (`done`, summary stored), script stage after `StageDone` logged `feat/fix-login`.
- Todo `[2,2]` not observed with real claude 2.1.289. In `-p` mode it reports no TodoWrite,
  TaskCreate or TaskUpdate tool exists (ToolSearch finds none), so `todo` stays null. Parser covers
  both shapes via the recorded fixtures `testdata/{todowrite,taskcreate}.jsonl`; the fake-claude
  engine test asserts todo 2/2 end to end. Open question for the user: whether todo progress is
  reachable in headless mode at all.
- `quotePOSIX` leaves safe words unquoted, so `{branch}` prints `feat/fix-login`, not
  `'feat/fix-login'`. Quoting still applies to values with shell metacharacters.
- A pending run behind a failed setup keeps note `waiting for worktree setup`; `worktree setup
  failed` appears only on runs queued after the failure. The setup state itself shows failed.
- Failing-test list: `internal/gitsock` `TestIntegration_AddThenListRoundTrips` fails in
  `go test ./apps/kira-space/...`. Not in Stream A column (P152 owns gitsock, plan §6.4).

## Checks

- `go test ./apps/kira-space/...`: all ok except gitsock (above).
- `go test -race ade adeagent adeflow`: ok.
- `bun run lint:go`: 0 issues. `bun run lint:dead`: exit 0.
- `go mod tidy`: no diff. `git diff 2ad7fdea -- go.mod go.sum package.json bun.lock`: empty.
- Contract diff (`wire.ts`, `adewire`, `tests/fixtures/ade-v2`, `packages/shared`): empty.
- Greps: token only in 0600 config file (argv holds the path); `allowedTools(def.AllowedTools)` and
  `b.settingSources()` feed `adeagent.Spec`; `FinishStepSuffix` appended in `composePrompt`;
  `gitsession.ParsePrepareTimeout` used by `setup.go`; `adeagent.Run` called from `runs.go`.

## codegraph_explore

No `codegraph_explore` call is recorded in the part of the run after context compaction. Calls made
before it are not verifiable from this stream's own record.
