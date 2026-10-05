# P156: persist held fix runs' resume spec across restart

Source: SPEC row P156, P147 carry-forward (`P147-ade-v2-wave4-interactive-archive-run-ui.md:604`,
`P147-streamA-notes.md:20`), P149 audit F3 (`P149-audit.md:55`), `ARCHITECTURE.md` Known open item
"Held fix runs lose their resume spec across restart (P147)". Base: `v2.0` at `49e35c5f`. App:
`apps/kira-space`. All paths below relative to it unless rooted.

## 1. Current tree (re-read, CodeGraph)

- `internal/ade/sendback.go:18` `runOpts{Loops, Note, ResumeID, Prompt, Extra}`. `decideSendBack`
  (`:56`) builds it: `Loops = round`, `Note = "sent back by <step>: <reason>"`, then either
  `ResumeID` + `Prompt` (target's Claude session known) or `Extra` (no session).
- `TaskBoard.runOpts map[string]runOpts` (`board.go:142`), guarded by `runMu`. `setRunOpts` /
  `takeRunOpts` (`sendback.go:29-41`) are its only users.
- `runs.go:336` `queueRun`: inserts the row (`Loops` persisted in `ade_runs.loops`), stores the
  extras in the map when non-default (`:365`), then launches or leaves it `pending` behind the
  worktree gate (`setupReady`, `setup.go:255`).
- `runs.go:383` `launch`: `takeRunOpts(run.ID)` consumes the map entry; `Note` goes to the run row,
  `ResumeID`/`Prompt`/`Extra` pick resume-vs-fresh prompt and the `ade_sessions.resumes` value.
- Held runs launch later from `launchHeldLocked` (`runs.go:674`), reached by `onSetupReady`
  (`runSetup` success; `launchGate`, `prepareAttached`, `prepareWorktrees`) and `RetrySetup`
  (`runs.go:817`). It passes the row read by `plan()` (`LatestRuns`), so the map is the only
  carrier of the spec.
- `recover.go:17` `Recover`: `RecoverRunning` turns `running` to `stuck` (`interrupted by restart`),
  `FailRunningSetups` fails running setups and rewrites their branch's pending notes to
  `worktree setup failed`. Pending rows survive; the map is empty in the new process, so the held
  fix run launches as a plain fresh attempt (prompt `Step i/n`, new Claude session, note cleared).
- Side leaks today: a pending run stopped (`StopRun` then `markStopped`) or deleted
  (`ResetWorkflow`) leaves its map entry behind until process exit.
- `ade_runs` (`0008_p144_ade_tasks.sql:33`): no spec columns. `adeRunColumns`
  (`repos/adetask.go:57`), `scanAdeRun` (`:690`), `InsertRun` (`:704`), `UpdateRun` (`:717`) list
  columns explicitly. `model.AdeRun` / `AdeRunPatch` in `model/adetask.go:102,132`.
- Round counter: `decideSendBack` counts the failing step's `back` rows (`CountRuns`) for the round;
  `loops` on the fix run is the round epoch `chainRerun` (`steps.go:163`) walks. Both are already
  on disk, so they survive restart. Nothing here changes them.
- Migrations: `internal/storage/migrations/`, last `0013_p155_drop_all_agents_filter.sql`, registered
  in `embed.go:31`.
- Wire: `adewire.Run` (`internal/bridge/adewire/wire.go:218`) carries `loops`, `note`, never the
  spec. Resume id and fix prompt are engine-internal.

## 2. Decisions

- **D1 Storage: four columns on `ade_runs`, not a side table.** The spec is 1:1 with a run row, read
  in the same `scanAdeRun` as the rest, dies with the row (`ResetWorkflow`, `ON DELETE CASCADE`). A
  side table would need its own cleanup and a join for no gain. Typed columns over one JSON blob:
  four flat strings, no parse step, no schema drift. Migration `0014_p156_run_launch_spec.sql`:
  ```sql
  -- P156: a held run's launch spec (send-back resume) persists until the run launches.
  ALTER TABLE ade_runs ADD COLUMN launch_note TEXT NOT NULL DEFAULT '';
  ALTER TABLE ade_runs ADD COLUMN launch_resume_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE ade_runs ADD COLUMN launch_prompt TEXT NOT NULL DEFAULT '';
  ALTER TABLE ade_runs ADD COLUMN launch_extra TEXT NOT NULL DEFAULT '';
  ```
  Existing rows get `''` (= no spec), the current meaning. No CHECK: SQLite cannot add a
  cross-column CHECK without a table rebuild; the invariant (D3) lives in code.
- **D2 Row is the only carrier; delete the in-memory map.** Not "map plus write-through": one
  source of truth, same path with and without a restart, and the D1-adjacent leaks vanish. Remove
  `TaskBoard.runOpts`, `setRunOpts`, `takeRunOpts`, and the `opts != (runOpts{...})` check.
- **D3 Lifecycle.** `queueRun` writes the spec in `InsertRun`. `launch` reads it from the run it is
  given and clears it in the same `UpdateRun` that sets `running` (consumed: the note moves to
  `note`, the resume id to `ade_sessions.resumes`, the prompt into the process). Invariant: a
  non-empty spec only on a row with `started_at IS NULL`. Done, failed, back, and stuck-after-launch
  rows therefore always hold an empty spec; no extra cleanup on terminal states is needed.
- **D4 Restart, held vs. stuck (D7 kept).**
  - `running` at restart: `stuck`, `interrupted by restart`, unchanged. Its spec was cleared at
    launch. No auto-resume. Retry is a plain new attempt (`Loops` kept), Take over resumes the
    conversation; both unchanged.
  - `pending` (held) at restart: stays `pending` with its spec; `Recover` only rewrites the note when
    its setup was running. It launches with the spec when the gate opens (`RetrySetup`,
    `onSetupReady`). `Recover` launches nothing (D7: nothing starts by itself at boot).
  - Crash window between a setup turning `ready` and `onReady` launching: the run stays `pending`
    behind a ready setup that `RetrySetup` refuses. Out of scope (pre-existing, not spec-related);
    the user path is Stop then Retry, which D5 makes spec-preserving.
- **D5 Stopped before launch keeps the spec; Retry carries it.** `markStopped` on a pending run
  leaves the spec (no `started_at`). `RetryRun` copies the spec from the stopped run when
  `run.StartedAt == nil`, so a stopped held fix run retries as the same resume. A run that launched
  retries as today. `advanceLocked`'s `actRetry` only sees `failed` runs, which launched: unchanged.
- **D6 Archive and purge.** `ArchiveTask` keeps run rows as history; a pending run of an archived task
  never launches (`stopTaskWork` cancels setups, so no `onReady`; archived branches leave the board).
  Its spec stays inert on the row: no cleanup. No task purge exists (`ade_tasks` has no delete path;
  `ResetWorkflow` deletes runs, spec goes with them). Nothing to add.
- **D7 Round counter (`loops`).** Unchanged. `loops` is already a column written at insert; the round
  is `CountRuns(back) + 1`, both from disk, so a send-back after a restart counts correctly. The fix
  run's `loops` is set from `runOpts.Loops` as now.
- **D8 Wire contract unaffected.** No `adewire` type or method changes (53 methods); the spec is not
  exposed. No serial step 0. `frontend/src/ade/v2/wire.ts` and the mock runtime untouched.
- **D9 Shape.** New `model.AdeRunLaunch{Note, ResumeID, Prompt, Extra string}`; `model.AdeRun` gains
  `Launch AdeRunLaunch`; `AdeRunPatch` gains `Launch *AdeRunLaunch`. `runOpts` becomes
  `{Loops int; Launch model.AdeRunLaunch}` (callers passing `runOpts{Loops: x}` stay as they are).
  `AdeRunLaunch` is comparable (all strings), so `run.Launch == (model.AdeRunLaunch{})` tests empty.

## 3. Changes (single sequential implementer, CLAUDE.md default; order-dependent: storage first)

### 3.1 Storage (commit 1: `feat(ade): persist run launch spec columns`)

- `internal/storage/migrations/0014_p156_run_launch_spec.sql` (D1); register
  `{Version: 14, Name: "p156_run_launch_spec", File: "0014_p156_run_launch_spec.sql"}` in `embed.go`.
- `model/adetask.go`: `AdeRunLaunch`, `AdeRun.Launch`, `AdeRunPatch.Launch` (D9).
- `repos/adetask.go`: append the four columns to `adeRunColumns`; `scanAdeRun` scans them;
  `InsertRun` writes them (placeholder count 16 to 20); `UpdateRun` applies `p.Launch` and writes the
  four columns. Every `SELECT adeRunColumns` site picks them up through the constant.
- Any other `ade_runs` writer with an explicit column list: grep `ade_runs` under `internal/` after the
  change; only `RecoverRunning`, `SetPendingNote`, `ResetWorkflow` exist and need nothing.

### 3.2 Engine (commit 2: `fix(ade): held fix runs resume their Claude session after restart`)

- `sendback.go`: `runOpts{Loops int; Launch model.AdeRunLaunch}`; delete `setRunOpts`, `takeRunOpts`;
  `decideSendBack` fills `opts.Launch.{Note,ResumeID,Prompt,Extra}`. Rewrite the `runOpts` comment
  (it now says the spec lives on the run row until launch).
- `board.go`: drop the `runOpts` field and its map literal.
- `runs.go` `queueRun`: `run.Launch = opts.Launch` before `InsertRun`; drop the map write.
- `runs.go` `launch`: `spec := run.Launch` replaces `takeRunOpts`; uses `spec.Note`, `spec.ResumeID`,
  `spec.Prompt`, `spec.Extra` where `opts.*` was; patch gets `Launch: &model.AdeRunLaunch{}` (clear,
  D3). `superviseAgent` keeps receiving the resume id as an argument.
- `runs.go` `RetryRun`: `opts := runOpts{Loops: run.Loops}`; `if run.StartedAt == nil { opts.Launch =
  run.Launch }` (D5). One-line comment on why.
- `recover.go`: doc comment gains one clause: held (pending) runs keep their launch spec and launch
  when their gate opens.

### 3.3 Test (same commit 2)

One test, the complex logic only (CLAUDE.md test bar: restart recovery with held rounds). Add a
subtest to `TestRunEngine_sendBack` or a sibling `TestRunEngine_recoverHeldFixRun` in
`internal/ade/runengine_wave4_test.go`, using the existing `newEngine` harness (fake claude via
`fakeEnv`, argv/prompt files) and the `TestRunEngine_recover` seeding style:

1. Workflow `impl` + `tests` (`on_failure: back:impl`), task on `api`, fake scenario
   `{"*": {"done", "done"}}` (fix run, then rerun tests).
2. Seed: `impl` attempt 1 `done` with a headless `ade_sessions` row (`ClaudeSessionID: "c-impl"`) as
   its `session_id`; `tests` attempt 1 `back` (`loops 0`, note `x → back to impl (1 of 3)`);
   `impl` attempt 2 `pending`, `loops 1`, note `noteWaitingSetup`,
   `Launch{Note: "sent back by tests: x", ResumeID: "c-impl", Prompt: "tests failed on <branch>: x. Fix the implementation."}`;
   setup row `running`.
3. `Recover()`. Assert: `impl` attempt 2 still `pending`, note `worktree setup failed`, `Launch`
   intact (read back via `GetRun`: proves the columns round-trip through the repo).
4. `RetrySetup(branch)` (no prepare script: ready at once, `launchHeldLocked` launches).
5. Assert on the fix run: argv file has `--resume\nc-impl` and no `--session-id`; prompt contains
   the fix line and `adeagent.FinishStepSuffix`, not `Step 1/2`; its session row `Resumes == "c-impl"`;
   after launch, `GetRun` shows `Launch` empty (D3).
6. Chain continues: `tests` attempt 2 reaches `done` with `loops 1` (round epoch survived, D7).

Restart is simulated by `Recover()` on the same engine with an empty in-memory state; after D2 there
is no in-memory spec to clear, which is exactly the point the test pins. The existing
`TestRunEngine_sendBack` subtests cover the no-restart path through the same row-only code; they must
pass unchanged. No test for D5 (one `if` on `StartedAt`), none for the migration (CLAUDE.md bar).

### 3.4 Docs (commit 3: `docs: P156 result, held fix run spec persists`)

- `docs/ARCHITECTURE.md`:
  - Storage list (`~3664`): add `` `0014`: `ade_runs.launch_note`, `launch_resume_id`, `launch_prompt`,
    `launch_extra` (held run's send-back spec, cleared at launch). ``
  - Step machine bullet (`~3712`): one sentence: the fix run's resume spec is on its run row until
    launch, so a run held behind a setup resumes the same Claude session after restart.
  - Restart recovery bullet (`~3718`): add "pending runs keep their launch spec and launch when their
    gate opens."
  - Delete the Known open item "Held fix runs lose their resume spec across restart (P147)."
- `docs/v2.0/SPEC.md`: P156 row per §7; no `## P156 result` section in SPEC (P155 precedent: result
  lives in the plan).
- This plan's `## Result`.

## 4. Ownership

Single implementer, every file in §3. Never touch `/home/user/kira-studio-c2` (P157 chain).

## 5. End checks

Run once after commit 2, fix anything red in place (pre-existing included, CLAUDE.md):

- `go build ./... && go test ./apps/kira-space/... ./internal/...`
- `go test -race ./apps/kira-space/internal/ade/... ./apps/kira-space/internal/storage/...`
- `bun run lint:all`, `bun run typecheck`, `bun run test:unit` (frontend untouched; cheap guard).
- `git grep -n 'runOpts\[\|setRunOpts\|takeRunOpts' apps/`: no hits.
- `git grep -n 'ade_runs' apps/kira-space/internal` after the change: every explicit column list
  carries the four columns or uses `adeRunColumns`.

Migration spot check (one shot, nothing committed): launch the server-tag build once on a temp
`KIRA_SPACE_HOME` at `49e35c5f`, relaunch on the new build, `SELECT version FROM schema_version` reads
14 and `PRAGMA table_info(ade_runs)` lists the four columns with default `''`.

Real-claude smoke (D4 end to end; sandbox `claude -p` works, interactive does not;
`docs/DEV_ENVIRONMENT.md` server-tag recipe and seeding notes):

1. Pick a uuid `U` and a throwaway git repo worktree `W`. In `W`:
   `claude -p --session-id U 'Remember the word kumquat. Reply ok.'`.
2. Server-tag build, temp `KIRA_SPACE_HOME`, seed `windows('main')`, `code_repos`, `git.path`, a
   workflow `impl` + `tests` (`back:impl`), the task, its branch on `W`, and the §3.3 rows with
   `ClaudeSessionID = U` on the `impl` attempt 1 session and `launch_resume_id = U` on the pending
   fix run; setup row `running`. Boot (this is the "restart": `Recover` runs).
3. Confirm the fix run is `pending`, note `worktree setup failed`, spec columns intact (sqlite3).
4. Call `RetrySetup` over the bound-call endpoint. Confirm: launched process argv
   (`/proc/<pid>/cmdline`) has `--resume U`; `ade_sessions.resumes = U`; the run's spec columns are
   `''`; `~/.claude/projects/<W slug>/U.jsonl` gained the fix prompt (same session, not a new file).
5. Kill leftover `claude` processes (anchored `pgrep -f '^claude'`, never a pattern in your own
   command line).

If the server-tag recipe is blocked, run the §3.3 test body once from a scratch, uncommitted copy
with `ClaudeBin` set to the real `claude` (fake env unset) and assert step 4's argv and transcript.
Record which path ran, and any part not observed, in `## Result`.

## 6. Acceptance

- Held `back:<step>` run survives `Recover()` with its spec and launches via `--resume <target
  session>` with the fix prompt and send-back note (test §3.3 plus smoke).
- No in-memory spec store left (`TaskBoard.runOpts` gone).
- Spec cleared at launch; non-empty only on never-launched rows.
- `RetryRun` of a stopped never-launched fix run keeps the resume.
- `running` at restart still becomes `stuck` with no auto-resume; `Recover` launches nothing.
- `0014` registered, applies on fresh and v13 DBs; `adewire` untouched (53 methods).
- ARCHITECTURE Known open item gone; storage, step machine and restart bullets updated; SPEC row
  updated.
- All §5 checks green on non-bypassed commits.

## 7. SPEC row update

P156 row status becomes:
`**Done.** Send-back launch spec (note, resume id, prompt, extra) moved from the in-memory `runOpts`
map to four `ade_runs` columns (migration `0014`), written at insert, cleared at launch. A held fix
run survives `Recover()` and resumes the target step's Claude session when its gate opens; `RetryRun`
of a stopped never-launched run keeps it. Running runs still go `stuck`, no auto-resume (D7). Wire
contract (`adewire`, 53 methods) untouched. Plan [P156](plans/P156-persist-held-fix-run-spec.md).`

## Result

_Pending implementation._
