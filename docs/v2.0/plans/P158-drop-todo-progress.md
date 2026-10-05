# P158: drop headless todo progress

Source: SPEC row P158; user decision (final): the only progress that matters is the workflow's own
steps. Drop agent todo progress and any other progress built on agent-internal state. Closes the
open question in the P149 result ("keep or drop the requirement") and the `ARCHITECTURE.md` Known
open item "Todo progress is unobservable in headless `claude -p` (P146)". Base: `v2.0` at
`56e3a10e`. App: `apps/kira-space`. Paths relative to it unless rooted.

SPEC2 (`docs/v2.0/design/ade-v2/SPEC2.md`) is the original ask and asks for todo progress (§1 Run,
§3 stage progress and branch rows, §5 per-repo runs, §13 `Run`). The user's decision overrides it.
SPEC2 gets minimal edits that name this decision; no other SPEC2 text changes.

## 1. Current tree (re-read, CodeGraph + repo-wide grep, all file types)

Producer (Go):
- `internal/adeagent/stream.go`: `Todo{Done, Total}` (`:24`); `Parser` holds `toolName`, `tasks`,
  `last`, `hasLast` (`:29-34`), all for todo only. `Feed` returns `(lines, *Todo)` (`:67`);
  `trackTodoCall` (`:130`) reads `TodoWrite` / `TaskUpdate`; `block` records `TaskCreate` ids from
  `tool_result` via `taskCreated` regexp (`:64`, `:116-121`); `progress` (`:163`). `contentBlock.ID`
  and `.ToolUseID` serve only the `toolName` map. Log lines (`▸ <tool> <arg>`, `✕`, `denied:`,
  `session`, `result:`) do not depend on todo state.
- `internal/adeagent/process.go`: `Handler.OnTodo` (`:57`), `NewParser()` (`:108`), the `OnTodo`
  call (`:117-123`). `doc.go:2` says "and todo progress".
- `internal/ade/runs.go`: `superviseAgent` passes `OnTodo` (`:494`); `setTodo` (`:520`) writes
  `AdeRunPatch.Todo` and emits runs. Only caller of `AdeRunPatch.Todo`.
- `internal/ade/board.go:473-475` `toWireRun` maps `TodoDone/TodoTotal` to `Run.Todo`.

Storage:
- `internal/storage/model/adetask.go`: `AdeRun.TodoDone/TodoTotal` (`:110-111`, comment `:101`),
  `AdeRunPatch.Todo` (`:147`).
- `internal/storage/repos/adetask.go`: `adeRunColumns` (`:57`), `scanAdeRun` (`:690-701`),
  `InsertRun` (`:709-711`, 20 placeholders), `UpdateRun` (`:735-738`, `:760-764`).
- `migrations/0008_p144_ade_tasks.sql:39,43`: `todo_done`, `todo_total` and a table CHECK
  `((todo_done IS NULL) = (todo_total IS NULL))`. SQLite 3.45 `DROP COLUMN` refuses a column named
  in a table CHECK (checked: `error in table t after drop column: no such column: a`). So removal
  is a table rebuild (precedent `0010` for `ade_sessions`). Nothing references `ade_runs` by FK;
  `ade_runs` references `ade_tasks`. Indexes: `ade_runs_task` (`0008`), `ade_runs_state` (`0010`).
  `0014` added `launch_*`. No migration-count assertion in tests.

Wire contract (adewire, frozen at P143, rule 1):
- Go `internal/bridge/adewire/wire.go:226` `Run.Todo *[2]int json:"todo"`.
- TS `frontend/src/ade/v2/wire.ts:199` `todo: [number, number] | null`.
- Fixtures: `tests/fixtures/ade-v2/board.json` (`"todo"` on every run, 46 keys, 10 non-null) and
  `event-runs.json` (`[4, 10]`). Read by `adewire/wire_test.go` (`TestFixturesMatchWireTypes`) and
  the TS fixture loaders.
- Contract doc `docs/v2.0/plans/P143-wire-contract.md:182` (Run body), `:399` (event-runs row),
  `§12 Amendments` (`:487`).
- Bindings `frontend/bindings/.../adewire/models.ts:500` are generated and untracked (rule 7).
- Method count stays 53; no contract version number exists for adewire. Only `Run` loses one field
  (15 to 14 fields).

Frontend:
- `frontend/src/ade/v2/board/progress.ts`: `StepRun.todo` (`:11`), `frac` doc (`:32`),
  `runFraction` (`:97-100`), `latestRun` copies `todo` (`:143`), pending default (`:161`), `barTip`
  (`:236`), `BranchProgress.label` doc (`:252`), `branchProgress` label (`:288`) and tip (`:297`).
- `frontend/src/ade/v2/board/stageBlocks.ts`: `RunLine.pct` (todo fraction, 100 when done) and
  `RunLine.todo` (`n/m`, else state text) (`:19-20`, `:89-101`); `showRuns` checks `r.todo`
  (`:114`).
- `frontend/src/ade/v2/panel/AdeStageBlock.vue:166-169`: per-run mini bar from `rl.pct`, text
  `rl.todo` (testid `ade-run-todo`).
- `plan/AdeTaskCard.vue:132-135` renders `p.percent`; it stays (see D2).

Tests:
- Go: `internal/adeagent/stream_test.go` (`feedFile` returns todos; `TestParserTaskCreateProgress`
  also asserts log fragments; `TestParserTodoWriteReportsOnlyChanges`;
  `TestParserDeletedAndOutOfOrder`), `testdata/todowrite.jsonl` (todo only), `testdata/
  taskcreate.jsonl` (real CLI 2.1.x capture, also used for log lines).
  `internal/ade/runengine_test.go`: fake `claude` emits three `TodoWrite` calls (`:75-97`); asserts
  `TodoDone == 2` (`:392-393`) and `▸ TodoWrite` in the run log (`:427`).
- Unit: `tests/unit/ade-v2-progress.spec.ts` (`:70-91`, `:121`, `:221-227`),
  `tests/unit/ade-v2-board-parity.spec.ts` (normalization 4, `:31`, `:66-68`),
  `tests/unit/support/adeV2Fixtures.ts:68` (`mkRun`).
- UI: `tests/ui/ade-v2-run.spec.ts:117-127` (`4/10` then `7/10`), `:202` (`ade-run-todo`), `:212`
  (`4/10` filter); `tests/ui/ade-v2-plan.spec.ts:189` (`Implement 6/9`), `:44` (`67%`, includes a
  todo fraction).
- Parity oracle `tests/unit/support/mockupV2Oracle.ts` runs `docs/v2.0/design/ade-v2/mockup.html`
  unmodified. Its data carries `todo` on 10 runs (lines `1202-1212`), and its `renderVals()` uses
  them for percent, `barTip`, branch label and tip. Parity on percent/`barTip`/label therefore
  needs the mockup data edited too.
- Mock runtime (`tests/ui/support/mockRuntime.ts`, `adeV2.ts`): no todo; serves fixtures only.
- Visual baselines: space visual suite is `tests/visual/settings.spec.ts` only (4 PNGs, settings
  panes); studio visual suite has no ADE. No baseline shows a run line. None change.

Docs:
- `docs/ARCHITECTURE.md:3717-3718` (todo parsing bullet), `:4272` (Known open item), `:3659-3665`
  (storage migration list, add `0015`).
- `docs/v2.0/design/ade-v2/SPEC2.md:20`, `:59`, `:61`, `:101`, `:349`.
- `docs/v2.0/SPEC.md` result sections (`:3774`, `:3805`, `:3832`, `:3864`, `:3874`) and the P146 row
  (`:78`) are history: unchanged.
- Other plans under `docs/v2.0/plans/` are history: unchanged, except the P143 contract doc
  (living contract, amended per rule 1).

Unrelated "todo" hits, kept: `StageSegment.state 'todo'` (a not-yet-reached stage,
`progress.ts:42,208`, `AdeTaskCard.vue:32`, parity `'todo'` segment), the `To do` task status,
`gitops/conflict`, `gitpreflight`, `gitclient/watcher`, `packages/git-core`, Studio budgets,
`// TODO` text in other apps.

## 2. Decisions

- D1. Remove, do not hide. Wire field, columns, parser state, handler, UI readouts and tests go.
- D2. Step progress stays: it is the workflow's own steps. Stage label `Implement 2/5` (done/total
  steps), task-card bar and percent, per-step state, per-repo run lines (glyph, repo, state text,
  loops, note), branch-row segments and label (`<step>`, `· stuck`, `· failed`, `· waiting`,
  `↩ sent back`, `· fix n`, `<stage> ✓`). Percent now averages over steps the share of each step's
  target runs that are `done`; a running run counts 0 (it counted its todo fraction).
- D3. Per-run mini bar in the panel goes. Its fill was the todo fraction; without it the bar is 0 or
  100 and repeats the `✓` glyph. This is the "other advanced progress on agent-internal state" the
  user dropped. The run line keeps the state text: `RunLine.todo` renamed `status` (`done`,
  `sent back`, else the state), testid `ade-run-todo` renamed `ade-run-status`.
- D4. Parser keeps every log line it emits today. With todo gone it has no state: replace
  `Parser`/`NewParser`/`Feed` with one package func `parseLine(raw string) []Line`; drop
  `contentBlock.ID`, `.ToolUseID`, `taskCreated`, the `regexp` import. `TaskCreate`, `TodoWrite`
  and `TaskUpdate` calls still log as ordinary `▸ <tool>` lines.
- D5. Storage: migration `0015_p158_drop_run_todo.sql` rebuilds `ade_runs` without `todo_done`,
  `todo_total` and their CHECK (SQLite refuses `DROP COLUMN` here, §1). Same columns, types,
  defaults, CHECKs, FK and both indexes otherwise. Stored todo values are discarded on purpose.
- D6. Contract change is serial step 0 (rule 1). One implementer, so step 0 is the first commit;
  it must carry every compile/typecheck consumer of the field because the pre-commit hook checks
  the whole tree.
- D7. Mockup: edit data only. Delete each `todo: [a, b]` from the default data (lines `1202-1212`),
  so the oracle's percent, `barTip`, branch label and tip match D2. The mockup's dormant `r.todo`
  logic stays (design file, no runtime). Parity normalization 4 (b_bill `3/10` vs `4/10`) goes;
  renumber the rest.
- D8. Single sequential implementer. No clean split: step 0 spans Go wire, TS wire, fixtures and
  all consumers; the later Go commits touch `runs.go`/storage that step 0's `board.go` edit
  borders.

## 3. Steps (one Sonnet implementer, commits in this order)

### Step 0: contract change and every wire consumer

Commit `feat(ade)!: drop todo from the Run wire contract` with footer
`BREAKING CHANGE: adewire Run loses todo (P158, user decision).`

1. `internal/bridge/adewire/wire.go`: delete `Run.Todo`. Realign gofmt.
2. `internal/ade/board.go`: `toWireRun` drops the `TodoDone/TodoTotal` block (`:473-475`).
3. `frontend/src/ade/v2/wire.ts`: delete `todo` from `Run`.
4. Fixtures: delete every `"todo"` key in `tests/fixtures/ade-v2/board.json` and
   `event-runs.json`. Keep everything else byte-identical (indent, order). Use a JSON-aware edit or
   delete exactly the `"todo": ...,` lines; confirm with `grep -c '"todo"'` = 0 and `go test
   ./internal/bridge/adewire/`.
5. `frontend/src/ade/v2/board/progress.ts`:
   - `StepRun`: drop `todo`; `latestRun` and the pending default drop it.
   - `runFraction(r)`: `r.state === 'done' ? 1 : 0`. Fold it inline if that reads simpler.
   - `frac` doc: "0..1: share of target runs done."
   - `barTip` mid: `r.state === 'done' ? '✓' : r.state`.
   - `branchProgress`: label drops the todo part (`pos.step.name + fix + suffix`); tip drops it;
     `BranchProgress.label` doc example `Implement 3/10` becomes `Implement`.
6. `frontend/src/ade/v2/board/stageBlocks.ts`: `RunLine` drops `pct`; `todo` renamed `status`:
   `done` / `sent back` / state. `showRuns` drops `r.todo`.
7. `frontend/src/ade/v2/panel/AdeStageBlock.vue`: delete the mini-bar `<span>` pair (`:166-168`);
   `rl.todo` to `rl.status`; testid `ade-run-status`.
8. `tests/unit/support/adeV2Fixtures.ts`: `mkRun` drops `todo`.
9. `tests/unit/ade-v2-progress.spec.ts`:
   - `:70` test renamed "averages done runs as 1 and others as 0, over steps and repos"; the
     `b_web` code run loses `todo`; expect fracs `[1, 0.5, 0]`, percent `50`, barTip
     `... web-app running ...`.
   - Delete "a running run with null todo counts zero, never NaN" (`:87-91`): nothing left to
     guard.
   - `:121` drop `todo: [1, 2]`.
   - `:221` rename "names the first unfinished step with fix round and state suffix"; expect
     `code · fix 1`.
10. `tests/unit/ade-v2-board-parity.spec.ts`: delete normalization 4 (comment `:31`, code
    `:66-68`); renumber the comment list and fix its count word.
11. `docs/v2.0/design/ade-v2/mockup.html`: D7 data edit.
12. `tests/ui/ade-v2-run.spec.ts`:
    - "a pushed runs event updates the step line": locate the b_bill line by
      `[data-branch-id="b_bill"]` inside the impl stage; assert status `running`; emit
      `{ ...ev.runs[0], state: 'done' }`; assert glyph `✓` and status `done`.
    - `:202` `ade-run-todo` to `ade-run-status`.
    - `:212` locate by `[data-branch-id="b_bill"]` instead of `4/10`.
13. `tests/ui/ade-v2-plan.spec.ts`: `:189` expect `Implement`; `:44` recompute the T_search
    percent (no running fraction) and confirm it equals the parity oracle's value for T_search.
    Re-check every other `ade-branch-prog` / percent assertion in `ade-v2-*.spec.ts`.
14. `docs/v2.0/plans/P143-wire-contract.md`: drop `todo` from the `Run` body (`:182`); fixture row
    `:399` reads `b_bill` impl running; append to §12: "P158 Step 0 (rule 1, user decision):
    `Run.todo` removed. Fixtures `board.json`, `event-runs.json` drop the key. Methods unchanged
    (53)."

Before committing: `go build ./...`, `go test ./internal/bridge/... ./internal/ade/...`,
`bun run typecheck`, `bun run test:unit`. `runengine_test` still passes here (it reads the model,
not the wire); step 1 rewrites it.

### Step 1: parser and run engine

Commit `refactor(ade): drop todo parsing from the headless run`.

1. `internal/adeagent/stream.go`: D4. Delete `Todo`, `Parser`, `NewParser`, `trackTodoCall`,
   `progress`, `taskCreated`; `Feed` becomes `parseLine(raw string) []Line`; `block` and `system`
   become plain funcs. Comment: "parseLine turns one `claude -p --output-format stream-json` line
   into log lines."
2. `internal/adeagent/process.go`: `Handler` keeps `OnLine` only (fix its doc: "Its callback ...");
   call `parseLine`; drop the todo branch.
3. `internal/adeagent/doc.go`: "parses the stream-json output into log lines".
4. `internal/adeagent/stream_test.go`: `feedFile` returns lines only. Rename
   `TestParserTaskCreateProgress` to `TestParserLogLines`, keep its log-fragment assertions (incl.
   `▸ TaskCreate`), drop the todo half. Delete `TestParserTodoWriteReportsOnlyChanges`,
   `TestParserDeletedAndOutOfOrder`, `testdata/todowrite.jsonl`. Keep `taskcreate.jsonl` (real
   capture, log coverage) and `denied.jsonl`. Oversize test switches to `parseLine`.
5. `internal/ade/runs.go`: delete `OnTodo` from `superviseAgent`'s handler and `setTodo`.
6. `internal/ade/runengine_test.go`: fake `claude` "done" action emits one ordinary tool call
   instead of three `TodoWrite`s (e.g. `Bash` with `command: "git status"`), then finishes. `:392`
   asserts only `Summary == "summary-done"`; `:427` asserts `▸ Bash git status`.

Checks: `go build ./...`, `go vet ./internal/adeagent/ ./internal/ade/`,
`go test ./internal/adeagent/ ./internal/ade/`, `bun run lint:go`.

### Step 2: storage

Commit `feat(ade): drop ade_runs todo columns (migration 0015)`.

1. `internal/storage/model/adetask.go`: delete `AdeRun.TodoDone`, `.TodoTotal`, `AdeRunPatch.Todo`;
   `AdeRun` comment loses "Todo is nil ...".
2. `internal/storage/repos/adetask.go`: `adeRunColumns` drops `todo_done, todo_total`;
   `scanAdeRun` drops `done, total`; `InsertRun` 18 placeholders, args drop the two; `UpdateRun`
   drops the patch branch and both `SET` terms.
3. `internal/storage/migrations/0015_p158_drop_run_todo.sql`:
   ```sql
   -- P158: todo progress dropped (user decision); SQLite cannot DROP COLUMN under the table CHECK.
   CREATE TABLE ade_runs_new (
     id TEXT PRIMARY KEY,
     task_id TEXT NOT NULL REFERENCES ade_tasks (id) ON DELETE CASCADE,
     stage_id TEXT NOT NULL, step_id TEXT NOT NULL, branch_id TEXT NOT NULL DEFAULT '',
     attempt INTEGER NOT NULL CHECK (attempt >= 1),
     state TEXT NOT NULL CHECK (state IN ('pending','running','stuck','failed','back','done')),
     loops INTEGER NOT NULL DEFAULT 0,
     note TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '',
     session_id TEXT NOT NULL DEFAULT '', exit_code INTEGER,
     started_at INTEGER, finished_at INTEGER,
     launch_note TEXT NOT NULL DEFAULT '', launch_resume_id TEXT NOT NULL DEFAULT '',
     launch_prompt TEXT NOT NULL DEFAULT '', launch_extra TEXT NOT NULL DEFAULT ''
   );
   INSERT INTO ade_runs_new (id, task_id, stage_id, step_id, branch_id, attempt, state, loops, note,
     summary, session_id, exit_code, started_at, finished_at, launch_note, launch_resume_id,
     launch_prompt, launch_extra)
     SELECT id, task_id, stage_id, step_id, branch_id, attempt, state, loops, note, summary,
       session_id, exit_code, started_at, finished_at, launch_note, launch_resume_id,
       launch_prompt, launch_extra FROM ade_runs;
   DROP TABLE ade_runs;
   ALTER TABLE ade_runs_new RENAME TO ade_runs;
   CREATE INDEX ade_runs_task ON ade_runs (task_id);
   CREATE INDEX ade_runs_state ON ade_runs (state);
   ```
   Re-read `0008`/`0010`/`0014` first and copy any column detail this sketch misses.
4. `migrations/embed.go`: `{Version: 15, Name: "p158_drop_run_todo", File: "0015_p158_drop_run_todo.sql"}`.
5. Scratch check (scratchpad dir, not committed): apply `0001`-`0014` to an empty SQLite file with
   `PRAGMA foreign_keys=ON`, insert one task and one run with `todo_done=1, todo_total=2` and
   non-empty `launch_*`, apply `0015`, confirm the run row survives field for field, `PRAGMA
   table_info(ade_runs)` has no `todo_*`, both indexes exist, `PRAGMA foreign_key_check` is empty.

Checks: `go build ./...`, `go test ./internal/storage/... ./internal/ade/... ./internal/bridge/...`.

### Step 3: docs

Commit `docs: P158 drop todo progress`.

1. `docs/ARCHITECTURE.md`: delete the todo bullet (`:3717-3718`); delete the Known open item
   (`:4272`); storage list gains "`0015`: rebuilds `ade_runs` without `todo_done`/`todo_total`
   (P158)."; if any text near `:3700-3720` describes the run line or percent with todo, align it to
   D2/D3.
2. `docs/v2.0/design/ade-v2/SPEC2.md`, minimal, each naming the decision once:
   - `:20` Run row: replace the todo sentence with "Progress counts workflow steps only; no agent
     todo progress (user decision, P158)."
   - `:59` percent: "each step counts the share of its repos whose run is done"; tooltip example
     `web-app running`.
   - `:61` `<current step> <todo n/m>` becomes `<current step>`.
   - `:101` drop "todo progress (`n/m` ...)," and "mini bar · 4/10" becomes "state".
   - `:349` drop `todo?: [...]` from `Run`.
3. `docs/v2.0/SPEC.md`: P158 row status `Done` with a one-line summary; fill this plan's `## Result`.

## 4. End checks (once, after step 3)

- `go build ./...`, `go vet ./...`, `go test ./...` (kira-space), `bun run lint:go`.
- `bun run typecheck`, `bun run lint:all`, `bun run lint:dead`, `bun run test:unit`,
  `bun run build:space`, `bun run test:ui:space` (full).
- Visual suites not rerun: no baseline covers ADE (§1). If a hook or CI script runs them anyway,
  they must stay green.
- Repo-wide grep, all file types, excluding `node_modules`, `dist`, untracked `bindings`, history
  plans and SPEC result sections:
  `grep -rniI 'todo' apps/kira-space docs/ARCHITECTURE.md docs/v2.0/design` returns only the §1
  "unrelated" hits, the mockup's dormant logic, and the SPEC2 decision note.
  `grep -rnI 'TodoWrite\|TaskUpdate\|OnTodo\|setTodo\|todo_done\|todo_total\|ade-run-todo'
  apps/kira-space --exclude-dir=node_modules --exclude-dir=dist` returns only migration `0008`,
  migration `0015`'s comment, and `testdata/taskcreate.jsonl`.
- Regenerate bindings in the build; `models.ts` `Run` has no `todo`.
- Live smoke (server build or `wails dev`, fake `claude`): start an agent step on a two-repo task;
  run lines show `● repo running` then `✓ repo done`, no mini bar; card percent moves only when a
  run finishes; branch row reads `<step>` then `<stage> ✓`. One line in the Result.

## 5. Acceptance

- No `todo` on the wire (Go, TS, fixtures, generated bindings), in storage (columns gone after
  `0015`, model and repo clean), in the parser, handler or engine, or in any frontend readout.
- Step progress (D2) unchanged except the running-run fraction: label, percent, segments, branch
  label, run lines, bar tooltip all pass parity against the edited mockup.
- Panel run line has no mini bar; state text under testid `ade-run-status`.
- All §4 suites green on normal (non-`--no-verify`) commits; four commits as §3.
- `ARCHITECTURE.md` Known open item gone; SPEC2 edits minimal and name the decision.
- Nothing in `internal/terminal/**` touched (P157 chain owns it).

## Result

_Placeholder: implementer fills commits, deviations, counts (unit, UI), smoke line._
