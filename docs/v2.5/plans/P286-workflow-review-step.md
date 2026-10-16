# P286 plan: Review step in workflows

Source: `docs/v2.5/SPEC.md` row P286. Depends on P279 (run resume, landed). Base `3ac9c6a60`.

Ask, condensed: new step type in the Space ADE workflow graph. A run reaching it waits for the user.
User opens the existing review window for that run's branch and adds comments of kind change request or
question. Explicit Send to agent routes them to (a) a dedicated new agent session or (b) the implementer
session of the same task, resumed through P279's path; per-step default, per-run override. Replies,
commits and answers flow back into the review (answer against the comment, state open/addressed).
Copy-for-AI stays.

Discovery: `codegraph_explore` over `ade/{steps,runs,route,recover,review,review_agent,smartstep,vars}.go`,
`adeflow/parse.go`, `claudeheadless/mcp.go`, `gitreview`, `gitsession/comments.go`, `gitrpc/comments.go`,
review window and workflow editor components. The root index had no `apps/kira-space` files;
`codegraph init apps/kira-space` built a nested index (`.codegraph/` is gitignored).

## 0. How things work today (facts the design builds on)

- Workflow: stages `user | agent | script` (`adeflow/parse.go` `stage`). Agent stage = list of steps
  (`PipelineStep`): `prompt` + `allowed_tools`, or `smart_script` + `params`; `results` with routes
  (`next | end | stop | <step id>` + `max`). Engine `ade/steps.go`: `stageSteps`, `stepView.state`
  (worst-of), `walkPath`, `chainRerun`, `nextAction`.
- Step run = `ade_runs` row per target branch (`runs_on`). `queueRun` holds behind worktree gate;
  `startRun` spawns headless `claude -p` (`superviseAgent`) or a script. Agent reports via MCP
  `finish_step` (`claudeheadless/mcp.go`). `recordOutcomeLocked` → `decideRoute` → loop or `advanceLocked`.
- `ade_runs.state` CHECK: `pending|running|stuck|failed|back|done`. `purpose` CHECK `''|rebase`.
- Send-back already resumes a previous step's Claude session: `decideLoop` → `claudeIDOfSession(prev.SessionID)`
  → `Launch.ResumeID` + `AdeSendBackLine`. P279 reuses that for restart resume: `RecoverRunning` keeps
  `launch_resume_id` for `purpose = ''` runs; `ResumeRun`; `EndResumeLost` when the CLI has no
  conversation (fails before any API call).
- Review window (P150): `OpenReviewWindow(branchId)`, three panes; right pane is the interactive review
  agent (one TUI session per task, `ade_sessions.purpose = 'review'`, `AdeReviewCompose` pastes questions).
  Comments live in `review.db` `review_comment` keyed by `review_session (repo_id, branch)`; no kind, no
  state, no reply. RPC `review.comment.{add,list,remove,clear,export}`; Monaco thread zones
  (`views/repo/ReviewThread.vue`, `reviewDecorations.ts`); git-ui `ReviewCommentsPane` has Copy for AI.
- Workflow editor: `AdeStepInspector.vue` mode toggle `prompt | smart`; `AdeStepNode.vue`; draft store
  `state/adeWorkflowDraft.ts`; YAML writer `adeflow/writer.go` (`stepOrder`).

## 1. Decisions (final)

1. **Step type = agent-stage step with a `review` block.** Why: lives in the existing step graph, so
   results, routes, `runs_on`, `before: approval` and the inspector all apply unchanged.
2. **One review run per target branch**, as any step. Why: comments are keyed by (repoId, branch).
3. **New run state `review`** (waiting on the user; no process). Why: `running` would be marked
   `stuck` at boot and counted by the quit gate; a waiting review must survive quit untouched.
4. **Agent work = review rounds**, each an `ade_runs` row `purpose = 'review'`, same stage/step/branch,
   spec in `spec_json`. Why: reuses `superviseAgent`, logs, `finish_step`, P279 recover/resume, quit gate.
5. **Headless rounds**, not the TUI review agent. Why: workflow steps are headless; resume and
   `EndResumeLost` are proven there. The TUI "Ask agent" panel stays as is.
6. **Default route `implementer`.** Why: that session already read the code and made the decisions;
   resume costs fewer tokens than a fresh agent; the send-back path proves it.
7. **Dedicated route keeps one session per review run**: round 1 fresh, later rounds resume it. Why:
   re-review keeps the reviewer's context.
8. **Comment kinds `change | question`, states `open | addressed`**, default `change`/`open`; existing
   rows migrate to `change`/`open`. Why: old comments were AI-paste instructions.
9. **Agent replies through a new MCP tool `reply_review_comment`**, granted only on round runs for the
   comment ids sent. Why: structured per-comment answers; no parsing of free text.
10. **Send sends every `open` comment** on the branch. Why: an unaddressed comment stays relevant;
    the user controls the set by reopening or deleting.
11. **No window pops on its own.** The run waits; Needs-you and the run line offer Review, which opens the
    window for that run's branch. Why: background window popping is disruptive; the click picks the branch.
12. **Lost target session → automatic fallback round on route `new`**, same comments, note on the
    review. Why: SPEC asks for it; the lost resume fails before any API call, so nothing is spent twice.
13. **Finish = user picks one of the step's results** (optional note). Results route as for any step.
    Default results of a new review step: `approved` (ok, next), `rejected` (not ok, stop).
14. **Smart-script steps and rebase runs are never implementer candidates.** Why: smart runs are isolated
    (own cwd, tools, model); resuming them under a normal agent spec mismatches.
15. **Review step is user-driven for P288**: its return limit default is 0 (no limit), as an interactive step.

## 2. Workflow schema

YAML (agent stage step):

```yaml
- id: review
  name: Code review
  runs_on: each repo
  review:
    send_to: implementer   # implementer | new; default implementer
    implementer: implement # optional earlier step id in this stage; default nearest earlier agent step
  timeout: 30m             # optional, per round
  results:
    - { id: approved, ok: true, next: next }
    - { id: rework, ok: false, next: implement, max: 2 }
    - { id: rejected, ok: false, next: stop }
```

- `adeflow/parse.go`: step fields add `review`. With `review`: refuse `prompt`, `allowed_tools`,
  `smart_script`, `params` ("%s is not allowed on review steps"). `review` must be a mapping with only
  `send_to`, `implementer`. `send_to` in `implementer|new` else "send_to must be implementer or new".
  `implementer` must name an earlier step of the stage that is not a review or smart step
  ("implementer must be an earlier agent step"). Empty mapping allowed (defaults).
- `adewire.PipelineStep` gains `Review *ReviewStepConfig \`json:"review"\`` with
  `SendTo string \`json:"sendTo"\``, `Implementer string \`json:"implementer"\``. Parser fills
  `SendTo: "implementer"` when absent. TS `PipelineStep.review: ReviewStepConfig | null`.
- `writer.go`: `stepOrder` adds `review` after `params`; nested keys `send_to`, `implementer`
  (always write `send_to`; omit `implementer` when empty).
- `stepDef` gains `Review *adewire.ReviewStepConfig`; `stageSteps` copies it.
- Old snapshots: field absent = not a review step. No migration of workflow files.

## 3. Storage

### 3.1 `kira.db` migration `0036_p286_review_step.sql`

- Rebuild `ade_runs` (precedent `0015`): `state` CHECK adds `'review'`; `purpose` CHECK adds `'review'`.
  Copy every current column (read the live schema from `0015`…`0035`, incl. `outcome_json`, `launch_*`,
  `purpose`, `spec_json`); recreate indexes `ade_runs_task`, `ade_runs_state`, `ade_runs_branch_purpose`.
- New table:

```sql
CREATE TABLE ade_reviews (
  run_id TEXT PRIMARY KEY REFERENCES ade_runs (id) ON DELETE CASCADE, -- the review step run
  route TEXT NOT NULL CHECK (route IN ('implementer', 'new')),          -- last route used or picked
  target_run_id TEXT NOT NULL DEFAULT '',  -- implementer run picked; '' = default
  dedicated_claude_id TEXT NOT NULL DEFAULT '', -- dedicated route's Claude session, '' until round 1
  rounds INTEGER NOT NULL DEFAULT 0
);
```

- `model.AdeRunPurposeReview = "review"`, `model.AdeRunReview = "review"` (state).
  `model.AdeReviewSpec{ReviewRunID string; Round int; Route string; CommentIDs []int64; HeadBefore string; Fallback bool}`
  in `spec_json` of a round run. `repos.AdeReviewsRepo{Get, Upsert, BumpRound, SetDedicated}`.
- `LatestRuns` partitions by purpose: subquery adds `AND b.purpose = a.purpose`. `plan()` skips
  `r.Purpose != ""`. Why: round attempts must never hide the review run (rebase runs use their own step id,
  so unaffected).
- `RecoverRunning`: `launch_resume_id` rule covers `purpose IN ('', 'review')`.
- `CountRunning` unchanged: waiting reviews are not counted, live rounds are.

### 3.2 `review.db` migration `gitreview/migrations/0004_p286_comment_kind.sql`

```sql
ALTER TABLE review_comment ADD COLUMN kind TEXT NOT NULL DEFAULT 'change' CHECK (kind IN ('change', 'question'));
ALTER TABLE review_comment ADD COLUMN state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'addressed'));
ALTER TABLE review_comment ADD COLUMN reply TEXT NOT NULL DEFAULT '';
ALTER TABLE review_comment ADD COLUMN replied_at INTEGER; -- unix millis
ALTER TABLE review_comment ADD COLUMN sent_at INTEGER;    -- last send to an agent
```

- `gitreview.Comment` gains `Kind, State, Reply string; RepliedAt, SentAt *time.Time`.
  `AddComment` takes kind. New store methods: `SetCommentState(ctx, repoID, branch, id, state)`,
  `ReplyComment(ctx, repoID, branch, id, reply, resolved bool, at)` (resolved → `addressed`),
  `MarkSent(ctx, repoID, branch, ids, at)`, `OpenComments(ctx, repoID, branch)`. All scoped to the
  session like `RemoveComment`; a missing id returns `false`, not an error. Each write calls the store
  observer (new `ReviewChange.State = "comment"`) so gitsession emits its existing comment repaint.
- `gitsession.CommentEntry` and git-ipc `ReviewComment` gain `kind`, `state`, `reply`, `repliedAt`
  (`number | null`), `sentAt` (`number | null`).
- RPC: `review.comment.add` params gain optional `kind` (default `change`; validate in `gitrpc` and
  `packages/git-ipc/src/validate.ts`). New `review.comment.setState {repoId, branch, id, state}` →
  `{changed: boolean}` (contract, validate, `gitrpc` handler, `COMMENT_MUTATION_METHODS` in
  `frontend/src/repo/git/transport.ts`).
- `FormatComments` (Copy for AI): anchor line gains ` [question]` for questions and ` [addressed]` for
  addressed; a reply prints as `  Reply: <text>` after the body. All comments still exported.
- Reply length: `MaxCommentBytes` (same bound as bodies).

## 4. Engine (`apps/kira-space/internal/ade`, new `reviewstep.go`)

### 4.1 Entering the step

- `startRun` with `def.Review != nil`: no process, no session. Patch `state = review`, `StartedAt`,
  clear launch spec, upsert `ade_reviews{route: def.Review.SendTo}` (keep an existing row: a re-run of
  the same review after a send-back loop starts a new run id, so a new row), pin the review session
  (`Registry.Review.SetPinned(gitRepoID, branch, true)` as `OpenReviewWindow` does; pin failure fails the
  launch with its error). Emit runs.
- `stepView.state`: `review` counts as running (step waits). `nextAction` idle. `chainRerun` treats
  `review` like running (ends walk). TS `aggregate`: `review` wins over `running` and `pending`, loses to
  `stuck`/`failed`; new `StepState 'review'`.
- `RetryRun`, `StopRun`, `TakeOver` on a run in state `review`: refused (`invalid("the review waits for you; finish it in the review window")`).

### 4.2 Phases (wire `Run.review` on the review run only)

`RunReview{Phase string; Round int; Route string; Note string}`; `Phase`:
- `waiting`: state `review`, no live round.
- `sent`: latest round `pending` (held behind the worktree gate or launching).
- `working`: latest round `running`.
- `stuck`: latest round `stuck` or `failed` (panel shows Resume or Send again).
- `done`: state `done` or `failed` (finished).
Computed in the board mapper from `ade_reviews` + latest round run (one query per task, `ReviewRoundsByTask`).

### 4.3 Implementer candidates

`reviewCandidates(tc, reviewRun)`: latest-attempt runs on the same branch, `purpose = ''`, whose step is an
agent step without `smart_script` and without `review`, with a non-empty Claude session id, state not
`running`/`pending`, from the current stage (steps before the review step, nearest first) then earlier
stages of the task's workflow snapshot (last stage first). Label parts: stage name, step name, attempt.
Default target: `review.implementer` step's run when present, else the first candidate. None → route
`implementer` is unavailable (picker shows it disabled with `space.ade.reviewStep.noImplementer.hint`;
Send uses `new`).

### 4.4 `SendReview(ctx, SendReviewArgs{RunID, Route, TargetRunID})`

Under the task mutex:
1. Run exists, state `review`, stage current; no round `pending`/`running` → else
   `invalid("a review round is already running")`.
2. `OpenComments(repoID, branch)`; none → `invalid("no open comments to send")`.
3. Route `implementer`: target = `TargetRunID` or default; must be a candidate → else
   `invalid("that agent run cannot take the review")`. Busy check: no running `ade_sessions` row with the
   same Claude id → else `invalid("that agent is busy; wait for it to stop")`.
4. Persist `ade_reviews{route, target_run_id}`; `BumpRound`; `MarkSent(ids)`.
5. Queue round run: `ade_runs{purpose: review, stage/step/branch of review run, attempt = rounds,
   state pending, spec_json: AdeReviewSpec{...HeadBefore: worktree HEAD}}` through `queueReviewRound`
   (same gate logic as `queueRun`, launch through `startReviewRound`).
6. Launch spec:
   - implementer: `ResumeID = claude id of target run`, prompt = `AdeReviewFollowUp` (§6) + finish instruction.
     Allowed tools = target step's `allowed_tools`.
   - new, round 1 (no `dedicated_claude_id`): fresh session, prompt = `AdeReviewRound`; store the new Claude
     id in `dedicated_claude_id` at launch. Default allowed tools.
   - new, later rounds: `ResumeID = dedicated_claude_id`, prompt = `AdeReviewFollowUp`.
   All: `claudeheadless.Grant{RunID: round, Results: implicit, Review: &ReviewGrant{CommentIDs}}`; allowed
   tools add `ReviewReplyTool`; cwd = branch worktree; timeout = step timeout.
7. Emit runs and `kira:adetask:review {taskId, branchId}`.

### 4.5 Round end

`recordOutcomeLocked` for `purpose = review`: never `decideRoute`/`advanceLocked` (`noAdvance`). Then
`completeReviewRound`: store outcome, count commits `HeadBefore..HEAD` in the worktree (existing git helper
used by `rebaseverify.go`; failure logs and shows no count), emit review event. Review run stays `review`.
- Outcome `EndResumeLost` and route `implementer` or a dedicated resume: clear `dedicated_claude_id` when
  the dedicated session was lost, then queue a fallback round on route `new`, fresh session, same comment ids,
  `Fallback: true`, run note `implementer session is gone; sent to a new review agent`
  (`space.ade.reviewStep.fallback.status`). One fallback per send (a fallback round that fails is not retried).
- Agent ends without replying to some ids: they stay `open`, reply empty.

### 4.6 `reply_review_comment` handler

`TaskBoard.ReplyReviewComment(runID, id, reply, resolved)`: round run → spec → id must be in `CommentIDs`
(else tool error `comment <id> was not sent to you`); resolve (repoID, branch) via `reviewTarget`;
`ReplyComment`; emit review event. Replies are allowed while the round runs only (released grant).

### 4.7 `FinishReview(ctx, FinishReviewArgs{RunID, Result, Note})`

Run state `review`, no live round, `Result` in the step's results → else `invalid`. Build
`outcome{state: done if result ok else failed, summary: Note, out.Result: Result}` and call
`recordOutcomeLocked` (normal route). A loop back to an earlier step uses the existing send-back path
(`decideLoop`): the target is resumed with `AdeSendBackLine` carrying the note. Later the review step
runs again (`chainRerun`): new review run, same comments on the branch, same session pin.

### 4.8 Quit and resume (P279)

- Waiting review at quit: nothing live; after restart still `review`. Review windows are ephemeral and not
  restored; the run line and Needs-you reopen them.
- Live round at quit: counted by the quit gate; boot marks it `stuck` with `ResumeID` (§3.1). Phase `stuck`.
- `ResumeRun` on a round (`purpose = review`): new branch `resumeReviewRound`: requeue attempt+1 with
  `ResumeID`, prompt `RunResumeLine` + review reply instruction + finish instruction, same `CommentIDs`.
  A lost conversation then follows §4.5 fallback.
- `RetryRun` on a round: refused (`invalid("send the review again from the review window")`).
- `TakeOver` on a live or stuck round: allowed as for step runs (TUI `--resume` of its session); its
  `finish_step` and replies land through the same grant path. Verify `TakeOver` does not branch on `purpose`
  in a way that drops review rounds; extend it if it does.

### 4.9 Board, Needs-you, archive

- `toWireRun` maps state `review` and `Review`. TS `RunState` adds `'review'`; every exhaustive switch
  (`runState.ts`, `AdeRunOutcome.vue` `STATE_TONE`, `progress.ts`, `stageBlocks.ts`, `needsYou.ts`,
  mobile web if it lists runs) gets the case; typecheck finds them.
- Round runs are not board step runs; the board lists them only through `Run.review`.
- Archive: `teardownReview` already unpins and purges review sessions; `ade_reviews` cascades with runs.

## 5. IPC (`bridge/adetask.go`, `adewire`)

- `ReviewStep(BranchArgs) (ReviewStepState, error)`: `{run: Run | null` (latest review run on the branch in
  the current stage, any state), `stepName, results: StepResult[], route, targetRunId, defaultTargetRunId,
  candidates: ReviewCandidate[] {runId, stage, step, attempt, finishedAt}, round: ReviewRound | null
  {run: Run, n, route, fallback, commits: number | null}}`. `null` run = no review step on this branch.
- `SendReview(SendReviewArgs{runId, route, targetRunId})`, `FinishReview(FinishReviewArgs{runId, result, note})`.
  Validation as other run args (`validateAdeItemID`, route enum, note ≤ 2000 runes).
- `ResumeRun` unchanged signature (dispatch in engine).
- Event `kira:adetask:review` `{taskId, branchId}` (emitter like `adeTaskBoardChanged`).
- Frontend: `bridge/index.ts` `adeTaskReviewStep`, `adeTaskSendReview`, `adeTaskFinishReview`;
  `queries.ts` `useReviewStep(branchId)` (TanStack query `['ade', 'reviewStep', branchId]`, invalidated by
  the review event and board pushes), `useSendReview`, `useFinishReview` mutations. Mock runtime handlers.

## 6. Prompts (`internal/llmprompts/registry.go`, Space, `NextCall`)

Terse now; P289 may distill further. Vars `ReviewRoundVars{Title, JiraKey, JiraURL, Repo, Branch, Base,
Worktree string; Round int; Comments []ReviewCommentVar}`, `ReviewCommentVar{ID int64; Kind, Path, Lines, Body string}`.

- `ade.review.comments` (`KindFragment`), the one place a question differs from a change request:

```
{{range .Comments}}#{{.ID}} {{.Kind}} {{.Path}}:{{.Lines}}
{{.Body}}
{{end}}Per comment, call reply_review_comment once.
change: make the change, commit it, reply what changed, resolved true.
question: answer in the reply, change no file for it, resolved true.
Cannot do it: reply why, resolved false.
```

- `ade.review.round.message` (`KindMessage`), dedicated agent, round 1:

```
Review of task {{.Title}}{{if .JiraKey}}
{{template "ade.jiraLine" .}}{{end}}
Repo {{.Repo}}, branch {{.Branch}} (base {{.Base}}), worktree {{.Worktree}}.
Read the branch diff against the base first. The reviewer left these comments:
{{template "ade.review.comments" .}}
```

- `ade.review.followup.message` (`KindMessage`), resumed session (implementer, or dedicated round 2+):

```
Review round {{.Round}} on {{.Branch}}. The reviewer left these comments on your work:
{{template "ade.review.comments" .}}
```

- `headless.tool.reply_review_comment` (`KindTool`, name `reply_review_comment`): `Answer one review
  comment. Call once per comment you were sent.` Args: `id` `The comment number, from the list.`;
  `reply` `What you changed, or the answer. Plain text.`; `resolved` `true when done or answered; false
  when you could not.`
- `headless.reviewReply.ack` (`KindToolResult`): `Saved.`
- Catalog keys `llmPrompts.entry.<camelId>.{title,description,usedBy.body}` for the three non-tool
  entries and the ack, as existing entries. Golden data, `checkprompts`, prompt-count assertion updated.
- Finish instruction: existing `HeadlessFinishStepSuffix` with implicit results.

## 7. `claudeheadless`

- `Grant.Review *ReviewGrant{CommentIDs []int64}`. A grant with `Review` builds a per-run server
  (`buildMCPServer` gains the review flag) that registers `reply_review_comment`; status enum stays implicit.
- `Options.Review ReviewReplier` (`interface{ Reply(runID string, id int64, reply string, resolved bool) error }`);
  nil + review grant → `Register` error.
- Handler: id in grant list else tool error; reply trimmed, non-empty, ≤ `MaxCommentBytes` (shared
  constant moved to `gitreview`) else tool error; calls `Reply`; returns the ack entry text.
- `ReviewReplyTool = "mcp__" + ServerName + "__reply_review_comment"`.
- Space wiring: `appwire` passes `TaskBoard` as `ReviewReplier`.

## 8. UI (Space frontend; shadcn-vue, Tailwind, VueUse, TanStack Query, i18n catalog)

### 8.1 Workflow editor (graph mode)

- `AdeStepInspector.vue`: mode toggle items `prompt | smart | review` (`ade-wf-step-mode-review`).
  `setMode('review')`: patch `{review: {sendTo: 'implementer', implementer: ''}, prompt: '',
  allowedTools: [], smartScript: '', params: {}}`; results set to `reviewDefaultResults()` (new in
  `board/workflowForm.ts`) only when the step still has the implicit pair. Leaving review sets `review: null`.
- Review fields (theme `NativeSelect`): Send to (`ade-wf-step-review-send-to`: Implementer session / New review
  agent), Implementer step (`ade-wf-step-review-implementer`: "Nearest earlier step" + earlier agent steps,
  shown only for implementer), timeout, results editor (existing `AdeStepResults`). Prompt and tools fields
  hidden in review mode.
- `AdeStepNode.vue`: badge `space.ade.workflows.stepNode.review.label` ("Review"); body line names the
  route ("Sends to implementer" / "Sends to a new agent").
- Draft store and YAML mode need no change beyond the field (`patchStep` is generic).
- **P288 boundary:** P286 does not touch `AdeWorkflowGraph.vue`'s toolbar, step add/remove or the canvas
  layout; it only adds the inspector mode and the node badge. P288 moves add/remove onto the graph surface
  and adds return limits; it keeps the review mode and treats review steps as interactive (default 0).

### 8.2 Board

- Run line (`stageBlocks.ts` / `AdeStageBlock.vue`): state chip by phase: `waiting`
  `space.ade.reviewStep.waiting.status` ("Waiting for review"), `sent` (`…sent.status`, "Review sent"),
  `working` (`…working.status`, "Agent working"), `stuck` (`…stuck.status`, "Review agent stopped").
  Button Review (`ade-run-review`) → `useReviewCode` with the run's branch id (opens or focuses the window).
- `needsYou.ts`: new kind `'review'` (label `space.ade.needs.kind.review.label`), one item per review run in
  phases `waiting|stuck`, action `Review` (same handler).
- `progress.ts`: step state `review` (tone blue, label "Review").

### 8.3 Review window right pane

- `AdeReviewWindow.vue` right section gets `SecondaryTabs` (`ade-review-right-tabs`): `Workflow review`
  (`ade-review-tab-workflow`, shown only when `useReviewStep(branchId).run` is non-null) and `Ask agent`
  (existing `AdeReviewAgentPanel`). Default tab: workflow review when its run is in state `review`.
  Selected tab lives in `useAdeReviewWindowStore` (same concern: the review window).
- New `AdeWorkflowReviewPanel.vue` (`ade-review-workflow`):
  - Header: step name, phase chip, round n, fallback note.
  - Comment list (TanStack query over `review.comment.list` on the repo git transport, key
    `['reviewComments', repoId, branch]`, invalidated by comment repaint events and the review event):
    per comment path:lines (click opens the file diff as `ReviewCommentsPane` does), kind chip
    (Change / Question), state chip (Open / Addressed), body, reply under it with time; buttons Reopen /
    Mark addressed (`review.comment.setState`).
  - Route: shadcn `RadioGroup` (`ade-review-route`): Implementer session + `NativeSelect` of candidates
    (`ade-review-target`), or New review agent. Initial value from `ReviewStepState`.
  - `Send to agent` (`ade-review-send-agent`, primary): disabled with tooltip when no open comments, a round
    is live, or the run is not `review`. Shows count of open comments.
  - Round block: live → state, Stop (existing `StopRun` on the round), Show log (`AdeRunLog kind="run"`);
    stuck/failed → outcome (`AdeRunOutcome`) with Resume when `resumable`; commits count when known.
  - Finish: one button per step result (`ade-review-finish-<id>`, ok tone green, else amber/red), optional
    note `Textarea`; disabled while a round is live; `ConfirmDialog` when open comments remain
    (`space.ade.reviewStep.finishOpen.body`).
- `ReviewThread.vue` compose mode: kind toggle `SecondaryTabs` segmented (`review-thread-kind`), default
  Change; submit emits `(body, kind)`; `reviewDecorations.ts` passes `kind` to `review.comment.add`.
  View mode: kind chip, state chip, reply block, Reopen / Mark addressed buttons (`review-thread-state`).
  git-ui `ReviewCommentsPane.vue`: kind and state chips only.
- Copy-for-AI unchanged in place (git-ui pane and `ReviewView` action).

### 8.4 i18n (`packages/theme/src/i18n/en.json`)

`space.ade.reviewStep.{waiting,sent,working,stuck,fallback}.status`, `…noImplementer.hint`,
`…noOpen.tooltip`, `…roundLive.tooltip`, `…send.label` ("Send to agent"), `…sendCount.label`
("{count} open"), `…route.implementer.label`, `…route.new.label`, `…round.label` ("Round {n}"),
`…commits.label` ("{count} new commits"), `…finish.note.placeholder`, `…finishOpen.body`
("{count} comments are still open. Finish anyway?"), `…tab.workflow.label`, `…tab.ask.label`;
`space.ade.needs.kind.review.label`; `space.ade.workflows.stepNode.review.label`,
`…stepNode.sendsImplementer.label`, `…stepNode.sendsNew.label`; `space.ade.workflows.inspector.review.*`
(mode, sendTo, implementer, nearest); `git.review.comments.kind.{change,question}.label`,
`git.review.comments.state.{open,addressed}.label`, `git.review.comments.reply.label`,
`git.review.comments.reopen.label`, `git.review.comments.markAddressed.label`; backend refusals as
`backend.space.ade.reviewStep.*.body` through the existing invalid path. Catalog lint rules apply.

## 9. Tests (split at the IPC boundary; no unit tests beyond parser cases)

| Scenario | Go flow (fakeagent, `adeflow/reviewstep_test.go`) | UI spec |
|---|---|---|
| Step waits | `TestReviewStepWaits`: implement → review → verify; implement `done`; review run `review`, phase `waiting`, review session pinned, verify not started; `ReviewStep` lists implement as default candidate | `ade-v2-review-step.spec.ts`: board from `#waiting` shows chip and Needs-you Review; click calls `OpenReviewWindow` with the branch id |
| Send to implementer | `TestReviewSendImplementer`: add a change and a question comment through the git socket; `SendReview` default; round `.args` has `--resume <implement Claude id>`, `.prompt` has both ids with kinds; fakeagent `mcp` replies both (`resolved` true), `sh` commits; comments `addressed` with replies, `sent_at` set; round `done`, phase `waiting`, commits 1. Contract `#working`, `#answered` | window from `#answered`: replies under comments, Addressed chips; Reopen calls `review.comment.setState`; from `#working`: Send disabled, round log shown |
| Dedicated route and re-review | `TestReviewSendNew`: route `new` → `--session-id`, prompt is the round message; reopen one comment, send again → round 2 resumes the dedicated id with the follow-up message | route picker: switching to New review agent and Send calls `SendReview` with `route: 'new'` |
| Finish and loop | `TestReviewFinish`: `approved` → review `done`, verify starts; second task: `rework` → implement resumed with send-back line + note, then review runs again (`review` state, comments kept) | Finish buttons per result call `FinishReview`; open-comments confirm |
| Lost session fallback | `TestReviewLostFallback`: implementer resume gets fakeagent `lost` → round `failed` `EndResumeLost`; fallback round on `new` launches with `--session-id`, `Fallback` true; contract `#fallback` | `#fallback` shows the note |
| Quit and resume | `TestReviewQuitResume`: round on `waitFile`; `app.Restart()`; round `stuck` resumable, review run still `review`; `ResumeRun` on round → `--resume` same id, resume line in prompt; done | `#stuck` shows Resume on the round block |
| Refusals | `TestReviewRefusals`: send with no open comments; send while a round runs; reply to an id not sent (tool error); `FinishReview` during a round; unknown result; `RetryRun` on a round and on a waiting review | errors inline in the panel |
| Comment kind/state RPC | `reviewflow/comments_test.go`: add with `kind: question`, list returns kind/state, `setState`, export markers, migration default for old rows (rows inserted before `0004`) | `repo-review-interaction.spec.ts`: compose with Question sends `kind: 'question'`; view shows chips |
| Workflow editor | `adeflow_test.go` parser/writer cases: valid review step, refusals (prompt with review, bad `send_to`, unknown or later `implementer`), YAML round-trip keeps `review` | `ade-v2-workflows.spec.ts`: mode Review sets fields, Save payload carries `review`; node badge |

Contract `apps/kira-space/tests/contract/ade-review-step.json` with keys `#waiting`, `#working`,
`#answered`, `#stuck`, `#fallback`, `#done`, written by the flow tests in the existing contract way.
Visual: `tests/visual/ade-review-step.spec.ts`, two new baselines (review window right pane on `#answered`,
graph with a review node), recorded in the sandbox per `docs/DEV_ENVIRONMENT.md`. Existing baselines stay.

Real `claude` rows (opt-in, after test-and-fix), `apps/kira-space/tests/claude/ade_test.go`:
- `TestAdeReviewStep`: haiku implement step writes and commits a file; review step; store adds one change and
  one question comment; `SendReview` (implementer). Expect `reply_review_comment` for both ids, a new commit
  for the change, no file change for the question, round `done`. Then route `new`, round on a reopened comment.
- `TestAdeReviewLost`: delete the implement transcript; send; expect `EndResumeLost` then a fallback round
  that replies. Report spend.
- Then the ADE row with the new names added.

## 10. Docs

- Site `site/src/content/docs/docs/space/agents.mdx`: `### Review steps` under Workflows (YAML, routes,
  phases, finish, fallback, resume); `## Review code` names the two right-pane tabs.
  `space/git.mdx` Branch review: comment kinds, states, replies. `reference/mcp-tools.md` Agent tools:
  `reply_review_comment`. Terse style (P284 rule); `bun run lint` and `site:check` green.
- `docs/ARCHITECTURE.md`: Workflows (review step, state `review`, rounds `purpose = review`, `ade_reviews`,
  candidates, fallback, `LatestRuns` partition), Review code (P150) section (tabs, comment kind/state/reply,
  `review.comment.setState`), App prompts list. Known open items: none expected; add one only if real.
- `docs/DEV_ENVIRONMENT.md` real `claude` ADE row adds `TestAdeReviewStep|TestAdeReviewLost`.

## 11. Execution (one sequential Sonnet implementer)

No streams: schema, engine, IPC and UI depend on each other in order. Each commit passes typecheck, lint
and build (`bun run lint`, `bun run lint:go`, `bun run typecheck`, Go build) through the normal hook.
Resume after interruption: `git log --oneline` from base `3ac9c6a60`; continue at the first missing commit.

1. `feat(gitreview): review comment kind, state and reply` (§3.2, git-ipc, gitrpc, transport, reviewflow test).
2. `feat(llmprompts): review step prompts and reply tool` (§6).
3. `feat(claudeheadless): reply_review_comment tool` (§7).
4. `feat(adeflow): review step in workflow schema` (§2, wire Go and TS, parser cases).
5. `feat(ade): review step engine` (§3.1, §4, §5 Go, appwire).
6. `test(ade): review step flow tests and contract` (§9 Go rows).
7. `feat(space): review step in workflow editor` (§8.1).
8. `feat(space): review state on board and Needs-you` (§8.2).
9. `feat(space): workflow review panel and comment kinds` (§8.3, §8.4, bridge, queries, mock runtime).
10. `test(space): review step UI specs and visual baselines` (§9 UI rows).
11. Full test pass once (Go `-race` on `ade`, `adeflow`, `claudeheadless`, `gitreview`, `gitsession`; UI and
    visual suites); fixes as `fix:` commits.
12. `docs: review step` (§10).
13. Real `claude` rows; fixes as `fix:` commits; report spend to the orchestrator.

Out of scope: P287 sandbox policy (round runs go through `superviseAgent`, so P287's policy hook covers them
as implementation-class agents writing only their worktree); P288 return limits and toolbar removal;
P289 prompt rewrite; GitHub PR comment sync of kinds or replies.
