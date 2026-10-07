package ade

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"slices"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/adeagent"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitprepare"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
)

// runs.go is the run engine: StartRun, the step machine's side effects (start, retry, advance),
// agent and script processes, and the log, session and stage reads. Every transition of a task runs
// under that task's mutex; a process runs outside it and re-enters to record how it ended.

const (
	defaultStepTimeout = 30 * time.Minute
	noteWaitingSetup   = "waiting for worktree setup"
	noteSetupFailed    = "worktree setup failed"
	noteWorktreeGone   = "worktree missing"
	noteNoFinish       = "ended without finish_step"
	settingSourcesUser = "user"
	settingSourcesAll  = "user,project,local"
)

// finishCall is a run's last finish_step call.
type finishCall struct{ status, summary string }

// recordFinish is the MCP server's callback; the last call of a run wins and is applied at exit.
func (b *TaskBoard) recordFinish(runID, status, summary string) {
	if b.tuiBound(runID) {
		b.goTracked(func() { b.applyTUIFinish(runID, status, summary) }) // a taken-over run: applied at call time (R14)
		return
	}
	b.runMu.Lock()
	b.finishes[runID] = finishCall{status, summary}
	b.runMu.Unlock()
}

func (b *TaskBoard) takeFinish(runID string) (finishCall, bool) {
	b.runMu.Lock()
	defer b.runMu.Unlock()
	f, ok := b.finishes[runID]
	delete(b.finishes, runID)
	return f, ok
}

func (b *TaskBoard) taskMu(id string) *sync.Mutex {
	b.runMu.Lock()
	defer b.runMu.Unlock()
	m, ok := b.taskMus[id]
	if !ok {
		m = &sync.Mutex{}
		b.taskMus[id] = m
	}
	return m
}

// taskCtx is one task with its stage snapshot and live branches.
type taskCtx struct {
	task     model.AdeTask
	stage    *adewire.Stage
	branches []model.AdeTaskBranch
	mine     []mineBranch
	nick     map[string]string // code repo id -> nickname, else name
}

func (tc *taskCtx) branch(id string) (model.AdeTaskBranch, bool) {
	for _, br := range tc.branches {
		if br.ID == id {
			return br, true
		}
	}
	return model.AdeTaskBranch{}, false
}

func (b *TaskBoard) loadTaskCtx(taskID string) (*taskCtx, error) {
	task, err := b.deps.Tasks.GetTask(taskID)
	if err != nil {
		return nil, err
	}
	if task.ArchivedAt != nil {
		return nil, invalid("task %s is archived", taskID)
	}
	tc := &taskCtx{task: task, nick: map[string]string{}}
	if task.CurrentStageJSON != "" {
		var st adewire.Stage
		if err := json.Unmarshal([]byte(task.CurrentStageJSON), &st); err != nil {
			return nil, fmt.Errorf("ade: unreadable stage of task %s: %w", taskID, err)
		}
		tc.stage = &st
	}
	live, err := b.deps.Tasks.BranchesLive()
	if err != nil {
		return nil, err
	}
	for _, br := range live {
		if br.TaskID == taskID {
			tc.branches = append(tc.branches, br)
		}
	}
	cfgs, err := b.deps.RepoConfig.List()
	if err != nil {
		return nil, err
	}
	for _, c := range cfgs {
		tc.nick[c.CodeRepoID] = cmpNonEmpty(c.Nickname, c.Name)
	}
	for _, br := range tc.branches {
		if br.Kind == model.AdeBranchKindMine {
			tc.mine = append(tc.mine, mineBranch{ID: br.ID, Nick: tc.nick[br.CodeRepoID]})
		}
	}
	return tc, nil
}

func cmpNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// refreshSnapshot applies workflow edits to the task's stage from the next step on (R13): the task's
// workflow (the live file until the task starts, then its own snapshot) replaces the stage snapshot
// when the stage still exists with the same kind.
func (b *TaskBoard) refreshSnapshot(tc *taskCtx) {
	if tc.stage == nil {
		return
	}
	wf, ok := b.taskWorkflow(tc.task)
	if !ok {
		return
	}
	for _, st := range wf.Stages {
		if st.ID != tc.stage.ID || st.Kind != tc.stage.Kind {
			continue
		}
		raw, err := json.Marshal(st)
		if err != nil || string(raw) == tc.task.CurrentStageJSON {
			return
		}
		if err := b.deps.Tasks.SetSnapshot(tc.task.ID, string(raw)); err != nil {
			slog.Warn("ade: refresh stage snapshot", "scope", "ade", "task", tc.task.ID, "err", err)
			return
		}
		tc.task.CurrentStageJSON = string(raw)
		tc.stage = &st
		return
	}
}

// plan resolves the current stage's steps to targets and latest runs.
func (b *TaskBoard) plan(tc *taskCtx) ([]stepView, error) {
	if tc.stage == nil {
		return nil, invalid("the task has no current stage")
	}
	steps := stageSteps(*tc.stage)
	latest, err := b.deps.Tasks.LatestRuns(tc.task.ID)
	if err != nil {
		return nil, err
	}
	out := make([]stepView, len(steps))
	for i, def := range steps {
		targets, err := stepTargets(def.RunsOn, tc.mine)
		if err != nil {
			return nil, invalid("step %q: %v", def.Name, err)
		}
		v := stepView{Def: def, Targets: targets, Runs: map[string]model.AdeRun{}}
		for _, r := range latest {
			if r.StageID == tc.stage.ID && r.StepID == def.ID {
				v.Runs[r.BranchID] = r
			}
		}
		out[i] = v
	}
	return out, nil
}

func stepIndex(plan []stepView, stepID string) int {
	return slices.IndexFunc(plan, func(v stepView) bool { return v.Def.ID == stepID })
}

func (b *TaskBoard) emitRuns(runs ...model.AdeRun) {
	if len(runs) == 0 {
		return
	}
	if b.deps.OnRuns != nil {
		ev := adewire.RunsChangedEvent{Runs: make([]adewire.Run, len(runs))}
		for i, r := range runs {
			ev.Runs[i] = toWireRun(r)
		}
		b.deps.OnRuns(ev)
	}
	b.scheduleBoard()
}

func (b *TaskBoard) notifySessions() {
	if b.deps.OnSessions != nil {
		b.deps.OnSessions()
	}
}

// --- StartRun ----------------------------------------------------------------------------------

// StartRun creates the task's missing branches and worktrees, starts their prepare scripts and
// starts the current agent or script stage's first step. Later steps follow by themselves or wait
// for Approve.
func (b *TaskBoard) StartRun(ctx context.Context, args adewire.StartRunArgs) (adewire.StartRunResult, error) {
	mu := b.taskMu(args.TaskID)
	mu.Lock()
	defer mu.Unlock()
	tc, err := b.loadTaskCtx(args.TaskID)
	if err != nil {
		return adewire.StartRunResult{}, err
	}
	if tc.stage == nil || tc.stage.Kind == "user" {
		return adewire.StartRunResult{}, invalid("the current stage is not an automated stage")
	}
	if err := b.snapshotWorkflow(&tc.task); err != nil {
		return adewire.StartRunResult{}, err
	}
	plan, err := b.plan(tc)
	if err != nil {
		return adewire.StartRunResult{}, err
	}
	if len(plan) == 0 {
		return adewire.StartRunResult{}, invalid("the current stage has no steps")
	}
	for _, v := range plan {
		if v.started() {
			return adewire.StartRunResult{}, invalid("stage %q already started", tc.stage.Name)
		}
	}
	if err := b.checkBranchNames(tc, args.BranchNames); err != nil {
		return adewire.StartRunResult{}, err
	}
	paths, err := b.prepareWorktrees(ctx, tc, args.BranchNames)
	if err != nil {
		return adewire.StartRunResult{}, err
	}
	if tc, err = b.loadTaskCtx(args.TaskID); err != nil { // branch names changed
		return adewire.StartRunResult{}, err
	}
	b.setStepMessage(tc.task.ID, tc.stage.ID, plan[0].Def.ID, args.Message)
	runs, err := b.startStep(ctx, tc, plan, 0, paths)
	if err != nil {
		return adewire.StartRunResult{}, err
	}
	res := adewire.StartRunResult{RunIDs: make([]string, len(runs))}
	for i, r := range runs {
		res.RunIDs[i] = r.ID
	}
	return res, nil
}

func (b *TaskBoard) checkBranchNames(tc *taskCtx, names map[string]string) error {
	for id := range names {
		br, ok := tc.branch(id)
		if !ok || br.Kind != model.AdeBranchKindMine || br.Name != "" {
			return invalid("branchNames: %s is not a not-yet-created branch of this task", id)
		}
	}
	return nil
}

// prepareWorktrees makes every mine branch's worktree exist and starts a setup in each new one.
func (b *TaskBoard) prepareWorktrees(ctx context.Context, tc *taskCtx, names map[string]string) (map[string]string, error) {
	paths := map[string]string{}
	title := taskTitle(tc.task, tc.branches)
	for _, sb := range tc.branches {
		if sb.Kind != model.AdeBranchKindMine {
			continue
		}
		rec, err := b.deps.CodeRepos.Get(sb.CodeRepoID)
		if err != nil {
			return nil, err
		}
		if rec == nil {
			return nil, invalid("code repo %s not found", sb.CodeRepoID)
		}
		res, err := b.ensureWorktree(ctx, title, *rec, sb, names[sb.ID])
		if err != nil {
			return nil, err
		}
		paths[sb.ID] = res.Path
		if res.Fresh {
			if err := b.startSetup(*rec, sb, res.Name, res.Path, b.onSetupReady); err != nil {
				return nil, err
			}
		}
	}
	return paths, nil
}

func stepMessageKey(taskID, stageID, stepID string) string {
	return taskID + "|" + stageID + "|" + stepID
}

// setStepMessage keeps the Run dialog's edited text for the step's runs, retries included. It lives
// in memory: after a restart a retry uses the composed default.
func (b *TaskBoard) setStepMessage(taskID, stageID, stepID, message string) {
	b.runMu.Lock()
	defer b.runMu.Unlock()
	if message == "" {
		delete(b.stepMsgs, stepMessageKey(taskID, stageID, stepID))
		return
	}
	b.stepMsgs[stepMessageKey(taskID, stageID, stepID)] = message
}

func (b *TaskBoard) stepMessage(taskID, stageID, stepID string) string {
	b.runMu.Lock()
	defer b.runMu.Unlock()
	return b.stepMsgs[stepMessageKey(taskID, stageID, stepID)]
}

// startStep creates attempt-1 runs for every target of plan[idx] and launches those whose worktree
// gate is open.
func (b *TaskBoard) startStep(ctx context.Context, tc *taskCtx, plan []stepView, idx int, paths map[string]string) ([]model.AdeRun, error) {
	out := make([]model.AdeRun, 0, len(plan[idx].Targets))
	for _, bid := range plan[idx].Targets {
		run, err := b.queueRun(ctx, tc, plan, idx, bid, 1, paths[bid], runOpts{})
		if err != nil {
			return out, err
		}
		out = append(out, run)
	}
	return out, nil
}

// queueRun inserts a run attempt and launches it, or leaves it pending behind the worktree gate.
func (b *TaskBoard) queueRun(ctx context.Context, tc *taskCtx, plan []stepView, idx int, branchID string, attempt int, path string, opts runOpts) (model.AdeRun, error) {
	if err := b.checkNotArchiving(tc.task.ID); err != nil {
		return model.AdeRun{}, err
	}
	sb, ok := tc.branch(branchID)
	if !ok {
		return model.AdeRun{}, invalid("branch %s is not on this task", branchID)
	}
	if path == "" {
		var err error
		if path, err = b.worktreeOf(ctx, sb); err != nil {
			return model.AdeRun{}, err
		}
	}
	setups, err := b.deps.Tasks.SetupByBranch()
	if err != nil {
		return model.AdeRun{}, err
	}
	run := model.AdeRun{
		ID: b.newID(), TaskID: tc.task.ID, StageID: tc.stage.ID, StepID: plan[idx].Def.ID, BranchID: branchID,
		Attempt: attempt, State: model.AdeRunPending, Loops: opts.Loops, Launch: opts.Launch,
	}
	open := path != "" && b.setupReady(sb, path, setups)
	if !open {
		run.Note = noteWaitingSetup
		switch s, has := setups[branchID]; {
		case has && s.State == model.AdeSetupFailed:
			run.Note = noteSetupFailed
		case !has || s.State == model.AdeSetupReady:
			run.Note = noteWorktreeGone
		}
	}
	if err := b.deps.Tasks.InsertRun(run); err != nil {
		return model.AdeRun{}, err
	}
	if !open {
		b.emitRuns(run)
		return run, nil
	}
	return b.launch(ctx, tc, plan, idx, run, sb, path)
}

func (b *TaskBoard) runVarsFor(tc *taskCtx, sb model.AdeTaskBranch, path string) runVars {
	return runVars{
		Task: taskTitle(tc.task, tc.branches), Jira: tc.task.JiraKey, Repo: tc.nick[sb.CodeRepoID],
		Branch: sb.Name, Worktree: path,
	}
}

// launch marks the run running and starts its process in the background. A failure other than an
// archive or shutdown leaves the run failed with the error as note, never a note-less pending row.
func (b *TaskBoard) launch(ctx context.Context, tc *taskCtx, plan []stepView, idx int, run model.AdeRun, sb model.AdeTaskBranch, path string) (model.AdeRun, error) {
	if err := b.checkNotArchiving(run.TaskID); err != nil {
		return run, err
	}
	out, err := b.startRun(ctx, tc, plan, idx, run, sb, path)
	if err != nil && !errors.Is(err, errBoardClosed) {
		b.failLaunch(run, err)
	}
	return out, err
}

// failLaunch records a run that could not start as failed.
func (b *TaskBoard) failLaunch(run model.AdeRun, cause error) {
	now := b.deps.Now().UnixMilli()
	state, note := model.AdeRunFailed, "could not start: "+cause.Error()
	updated, err := b.deps.Tasks.UpdateRun(run.ID, model.AdeRunPatch{State: &state, Note: &note, FinishedAt: &now})
	if err != nil {
		slog.Warn("ade: record launch failure", "scope", "ade", "run", run.ID, "err", err)
		return
	}
	b.emitRuns(updated)
}

func (b *TaskBoard) startRun(ctx context.Context, tc *taskCtx, plan []stepView, idx int, run model.AdeRun, sb model.AdeTaskBranch, path string) (model.AdeRun, error) {
	if path == "" {
		return run, invalid("worktree of %s is missing", sb.Name)
	}
	def := plan[idx].Def
	rec, err := b.deps.CodeRepos.Get(sb.CodeRepoID)
	if err != nil {
		return run, err
	}
	if rec == nil {
		return run, invalid("code repo %s not found", sb.CodeRepoID)
	}
	if err := b.deps.Logs.Reset(repos.AdeLogRun, run.ID, run.TaskID); err != nil {
		return run, err
	}
	if !b.track() {
		return run, errBoardClosed
	}
	started := false
	defer func() {
		if !started {
			b.wg.Done()
		}
	}()
	now := b.deps.Now().UnixMilli()
	spec := run.Launch
	note := spec.Note
	running := model.AdeRunRunning
	patch := model.AdeRunPatch{State: &running, StartedAt: &now, Note: &note, Launch: &model.AdeRunLaunch{}}
	vars := b.runVarsFor(tc, sb, path)

	var sessionID, prompt string
	if tc.stage.Kind == "agent" {
		sessionID = b.newID()
		patch.SessionID = &sessionID
		claudeID := cmpNonEmpty(spec.ResumeID, b.newID())
		if spec.ResumeID != "" {
			prompt = composeResumePrompt(spec.Prompt)
		} else {
			prompt = composePrompt(promptInput{
				Title: vars.Task, JiraKey: tc.task.JiraKey, JiraURL: tc.task.JiraURL, Vars: vars,
				Step: idx + 1, Of: len(plan), Def: def, Message: b.stepMessage(tc.task.ID, tc.stage.ID, def.ID), Extra: spec.Extra,
				Space: b.spaceEnabled(tc.task),
			})
		}
		if err := b.deps.Sessions.InsertHeadless(model.AdeSession{
			ID: sessionID, Mode: model.AdeSessionModeHeadless, TaskID: tc.task.ID, BranchID: sb.ID, StageID: tc.stage.ID,
			StepID: def.ID, RunID: run.ID, Resumes: spec.ResumeID, ClaudeSessionID: claudeID, Cwd: path,
			State: model.AdeSessionStateRunning, StartedAt: now, LastActiveAt: now,
		}); err != nil {
			return run, err
		}
		b.notifySessions()
	}
	updated, err := b.deps.Tasks.UpdateRun(run.ID, patch)
	if err != nil {
		return run, err
	}
	b.emitRuns(updated)

	timeout := parseStepTimeout(def.Timeout)
	runCtx, endRun := b.beginLive(b.live, run.ID)
	started = true
	if tc.stage.Kind == "agent" {
		go func() {
			defer b.wg.Done()
			defer endRun()
			b.superviseAgent(runCtx, updated, def, sessionID, spec.ResumeID, path, prompt, timeout)
		}()
	} else {
		go func() {
			defer b.wg.Done()
			defer endRun()
			b.superviseScript(runCtx, updated, def, *rec, sb, path, substitute(def.Prompt, vars, true), timeout)
		}()
	}
	return updated, nil
}

func parseStepTimeout(s string) time.Duration {
	if d, err := time.ParseDuration(s); err == nil && d > 0 {
		return d
	}
	return defaultStepTimeout
}

// outcome is how a run's process ended.
type outcome struct {
	state, note, summary string
	exit                 *int
	noAdvance            bool // a user stop: the engine does not move the task on
}

func (b *TaskBoard) settingSources() string {
	if b.deps.HeadlessSettingSources != nil && b.deps.HeadlessSettingSources() == "user" {
		return settingSourcesUser
	}
	return settingSourcesAll
}

func allowedTools(step []string, space bool) []string {
	out := slices.Clone(step)
	want := []string{adeagent.FinishStepTool}
	if space {
		want = append(want, adeagent.SpaceToolNames...)
	}
	for _, t := range want {
		if !slices.Contains(out, t) {
			out = append(out, t)
		}
	}
	return out
}

func (b *TaskBoard) superviseAgent(ctx context.Context, run model.AdeRun, def stepDef, sessionID, resume, path, prompt string, timeout time.Duration) {
	sink := b.newLogSink(repos.AdeLogRun, run.ID, run.TaskID)
	space := false
	if task, err := b.deps.Tasks.GetTask(run.TaskID); err == nil {
		space = b.spaceEnabled(task)
	}
	cfg, release, err := b.agent.Register(adeagent.Grant{RunID: run.ID, TaskID: run.TaskID, Space: space})
	if err != nil {
		sink.add(logStderr, "could not start: "+err.Error())
		sink.flush()
		b.completeRun(run, sessionID, outcome{state: model.AdeRunFailed, note: "could not start: " + err.Error()})
		return
	}
	bin := b.deps.ClaudeBin
	if bin == "" {
		bin = "claude"
	}
	cwdEnv := gitprepare.BuildEnv(os.Environ(), gitprepare.Vars{WorktreePath: path})
	exit, runErr := adeagent.Run(ctx, adeagent.Spec{
		ClaudeBin: bin, Dir: path, Prompt: prompt, SessionID: b.sessionClaudeID(sessionID), Resume: resume, MCPConfigPath: cfg,
		SettingSources: b.settingSources(), AllowedTools: allowedTools(def.AllowedTools, space), Timeout: timeout, Env: cwdEnv,
	}, adeagent.Handler{
		OnLine: func(l adeagent.Line) { sink.add(l.Stream, l.Text) },
	})
	sink.flush()
	release()
	if b.ctx.Err() != nil {
		return // app quit: rows stay running (R18)
	}
	if out, ok := stopOutcome(ctx); ok {
		b.takeFinish(run.ID)
		code := exit.Code
		out.exit = &code
		b.completeRun(run, sessionID, out)
		return
	}
	b.completeRun(run, sessionID, b.agentOutcome(run.ID, exit, runErr, def.Timeout))
}

// sessionClaudeID reads the Claude session id stored with the ade_sessions row.
func (b *TaskBoard) sessionClaudeID(sessionID string) string {
	rec, err := b.deps.Sessions.Get(sessionID)
	if err != nil || rec == nil {
		return b.newID()
	}
	return rec.ClaudeSessionID
}

func (b *TaskBoard) agentOutcome(runID string, exit adeagent.Exit, runErr error, timeout string) outcome {
	code := exit.Code
	out := outcome{exit: &code}
	f, finished := b.takeFinish(runID)
	switch {
	case finished && f.status == "done":
		out.state, out.summary = model.AdeRunDone, f.summary
	case finished && f.status == "needs_input":
		out.state, out.note, out.summary = model.AdeRunStuck, f.summary, f.summary
	case finished:
		out.state, out.summary = model.AdeRunFailed, f.summary
		out.note = cmpNonEmpty(f.summary, "failed")
	case runErr != nil:
		out.state, out.note = model.AdeRunFailed, "could not start: "+runErr.Error()
	case exit.TimedOut:
		out.state, out.note = model.AdeRunFailed, "timed out after "+timeout
	default:
		out.state, out.note = model.AdeRunFailed, noteNoFinish
	}
	return out
}

func (b *TaskBoard) superviseScript(ctx context.Context, run model.AdeRun, def stepDef, rec model.CodeRepo, sb model.AdeTaskBranch, path, command string, timeout time.Duration) {
	sink := b.newLogSink(repos.AdeLogRun, run.ID, run.TaskID)
	shell, login := gitprepare.ResolveShell(os.Getenv, gitprepare.IsExecutableFile)
	res, err := b.scriptRunner().Run(ctx, gitprepare.Spec{
		Shell: shell, LoginShell: login, Script: command, Dir: path, Timeout: timeout,
		Env: gitprepare.BuildEnv(os.Environ(), gitprepare.Vars{WorktreePath: path, WorktreeBranch: sb.Name, RepoRoot: rec.Root}),
		OnBatch: func(lines []gitprepare.Line) {
			for _, l := range lines {
				sink.add(l.Stream, l.Text)
			}
		},
	})
	sink.flush()
	if b.ctx.Err() != nil {
		return // app quit: rows stay running (R18)
	}
	code := res.ExitCode
	if out, ok := stopOutcome(ctx); ok {
		out.exit = &code
		b.completeRun(run, "", out)
		return
	}
	out := outcome{state: model.AdeRunDone, exit: &code}
	switch {
	case err != nil:
		out = outcome{state: model.AdeRunFailed, note: "could not start: " + err.Error()}
	case res.TimedOut:
		out.state, out.note = model.AdeRunFailed, "timed out after "+def.Timeout
	case res.ExitCode != 0:
		out.state, out.note = model.AdeRunFailed, fmt.Sprintf("exited with status %d", res.ExitCode)
	}
	b.completeRun(run, "", out)
}

// completeRun records how a process ended, then moves the task on.
func (b *TaskBoard) completeRun(run model.AdeRun, sessionID string, out outcome) {
	mu := b.taskMu(run.TaskID)
	mu.Lock()
	defer mu.Unlock()
	b.recordOutcomeLocked(run, sessionID, out)
}

// recordOutcomeLocked stores a run's outcome and acts on it: a failed `back:` step is sent back, any
// other outcome moves the task on unless it was a user stop. The task mutex is held.
func (b *TaskBoard) recordOutcomeLocked(run model.AdeRun, sessionID string, out outcome) {
	now := b.deps.Now().UnixMilli()
	if sessionID != "" {
		if err := b.deps.Sessions.MarkStopped(sessionID, now); err != nil {
			slog.Warn("ade: stop headless session", "scope", "ade", "session", sessionID, "err", err)
		}
		b.notifySessions()
	}
	var back *sendBack
	if out.state == model.AdeRunFailed && !out.noAdvance {
		back, out = b.decideSendBack(run, out)
	}
	updated, err := b.deps.Tasks.UpdateRun(run.ID, model.AdeRunPatch{
		State: &out.state, Note: &out.note, Summary: &out.summary, ExitCode: out.exit, FinishedAt: &now,
	})
	if err != nil {
		slog.Warn("ade: record run outcome", "scope", "ade", "run", run.ID, "err", err)
		return
	}
	b.emitRuns(updated)
	switch {
	case back != nil:
		back.queue(b)
	case !out.noAdvance:
		b.advanceLocked(b.ctx, run.TaskID)
	}
}

// advanceLocked applies the step machine's next action; the task mutex is held.
func (b *TaskBoard) advanceLocked(ctx context.Context, taskID string) {
	tc, err := b.loadTaskCtx(taskID)
	if err != nil || tc.stage == nil || tc.stage.Kind == "user" {
		return
	}
	b.refreshSnapshot(tc)
	plan, err := b.plan(tc)
	if err != nil {
		slog.Warn("ade: plan step", "scope", "ade", "task", taskID, "err", err)
		return
	}
	if rr := chainRerun(plan); len(rr) > 0 {
		for _, r := range rr {
			if _, err := b.queueRun(ctx, tc, plan, r.Step, r.Branch, r.Attempt, "", runOpts{Loops: r.Loops}); err != nil {
				slog.Warn("ade: rerun after send-back", "scope", "ade", "branch", r.Branch, "err", err)
			}
		}
		return
	}
	act := nextAction(plan)
	switch act.Kind {
	case actStart:
		if _, err := b.startStep(ctx, tc, plan, act.Step, nil); err != nil {
			slog.Warn("ade: start step", "scope", "ade", "task", taskID, "err", err)
		}
	case actRetry:
		for _, r := range act.Retry {
			if _, err := b.queueRun(ctx, tc, plan, act.Step, r.BranchID, r.Attempt+1, "", runOpts{Loops: r.Loops}); err != nil {
				slog.Warn("ade: retry run", "scope", "ade", "run", r.ID, "err", err)
			}
		}
	}
}

// onSetupReady launches the runs a finished prepare script was holding back.
func (b *TaskBoard) onSetupReady(branchID string) {
	sb, err := b.deps.Tasks.GetBranch(branchID)
	if err != nil {
		return
	}
	mu := b.taskMu(sb.TaskID)
	mu.Lock()
	defer mu.Unlock()
	b.launchHeldLocked(sb)
}

// launchHeldLocked launches the pending runs of a branch whose setup finished; the task mutex is held.
func (b *TaskBoard) launchHeldLocked(sb model.AdeTaskBranch) {
	branchID := sb.ID
	tc, err := b.loadTaskCtx(sb.TaskID)
	if err != nil || tc.stage == nil || tc.stage.Kind == "user" {
		return
	}
	plan, err := b.plan(tc)
	if err != nil {
		return
	}
	path, err := b.worktreeOf(b.ctx, sb)
	if err != nil {
		slog.Warn("ade: worktree of ready branch", "scope", "ade", "branch", branchID, "err", err)
		return
	}
	if path == "" {
		b.setPendingNote(branchID, noteWorktreeGone)
		return
	}
	for idx, v := range plan {
		r, ok := v.Runs[branchID]
		if !ok || r.State != model.AdeRunPending {
			continue
		}
		if _, err := b.launch(b.ctx, tc, plan, idx, r, sb, path); err != nil {
			slog.Warn("ade: launch held run", "scope", "ade", "run", r.ID, "err", err)
		}
	}
}

// --- Approve, RetryRun, StageDone --------------------------------------------------------------

// Approve starts a step that waits for approval.
func (b *TaskBoard) Approve(ctx context.Context, args adewire.StepArgs) error {
	mu := b.taskMu(args.TaskID)
	mu.Lock()
	defer mu.Unlock()
	tc, err := b.loadTaskCtx(args.TaskID)
	if err != nil {
		return err
	}
	if tc.stage == nil || tc.stage.ID != args.StageID {
		return invalid("stage %s is not the task's current stage", args.StageID)
	}
	plan, err := b.plan(tc)
	if err != nil {
		return err
	}
	idx := stepIndex(plan, args.StepID)
	if idx < 0 {
		return invalid("step %s is not in stage %s", args.StepID, args.StageID)
	}
	if act := nextAction(plan); act.Kind != actAwaitApproval || act.Step != idx {
		return invalid("step %q is not waiting for approval", plan[idx].Def.Name)
	}
	_, err = b.startStep(ctx, tc, plan, idx, nil)
	return err
}

// RetryRun starts a new attempt of a failed or stuck run.
func (b *TaskBoard) RetryRun(ctx context.Context, runID string) error {
	run, err := b.deps.Tasks.GetRun(runID)
	if err != nil {
		return err
	}
	mu := b.taskMu(run.TaskID)
	mu.Lock()
	defer mu.Unlock()
	tc, err := b.loadTaskCtx(run.TaskID)
	if err != nil {
		return err
	}
	if tc.stage == nil || tc.stage.ID != run.StageID {
		return invalid("the run's stage is no longer current")
	}
	plan, err := b.plan(tc)
	if err != nil {
		return err
	}
	idx := stepIndex(plan, run.StepID)
	if idx < 0 {
		return invalid("the run's step is no longer in the stage")
	}
	latest, ok := plan[idx].Runs[run.BranchID]
	if !ok || latest.ID != run.ID {
		return invalid("run %s is not the latest attempt", runID)
	}
	if run.State != model.AdeRunFailed && run.State != model.AdeRunStuck {
		return invalid("only a failed or stuck run can be retried")
	}
	opts := runOpts{Loops: run.Loops}
	if run.StartedAt == nil { // stopped before launch: the retry keeps the held resume spec
		opts.Launch = run.Launch
	}
	_, err = b.queueRun(ctx, tc, plan, idx, run.BranchID, run.Attempt+1, "", opts)
	return err
}

// StageDone moves the task to the next stage, or finishes the workflow after the last.
func (b *TaskBoard) StageDone(_ context.Context, taskID string) (adewire.Task, error) {
	mu := b.taskMu(taskID)
	mu.Lock()
	defer mu.Unlock()
	tc, err := b.loadTaskCtx(taskID)
	if err != nil {
		return adewire.Task{}, err
	}
	if tc.stage == nil {
		return adewire.Task{}, invalid("the task has no current stage")
	}
	if tc.stage.Kind != "user" {
		plan, err := b.plan(tc)
		if err != nil {
			return adewire.Task{}, err
		}
		if act := nextAction(plan); act.Kind != actStageComplete {
			return adewire.Task{}, invalid("stage %q has steps that are not done", tc.stage.Name)
		}
	}
	if err := b.snapshotWorkflow(&tc.task); err != nil {
		return adewire.Task{}, err
	}
	wf, ok := b.taskWorkflow(tc.task)
	if !ok {
		return adewire.Task{}, invalid("workflow %q is not available", tc.task.WorkflowID)
	}
	at := slices.IndexFunc(wf.Stages, func(s adewire.Stage) bool { return s.ID == tc.stage.ID })
	if at < 0 {
		return adewire.Task{}, invalid("stage %q is no longer in workflow %q", tc.stage.Name, wf.Name)
	}
	if next, more := nextRunnable(wf, at); !more {
		err = b.deps.Tasks.SetStage(taskID, "done", "")
	} else {
		var raw []byte
		if raw, err = json.Marshal(next); err == nil {
			err = b.deps.Tasks.SetStage(taskID, next.ID, string(raw))
		}
	}
	if err != nil {
		return adewire.Task{}, err
	}
	b.notifyBoard()
	task, err := b.deps.Tasks.GetTask(taskID)
	if err != nil {
		return adewire.Task{}, err
	}
	return b.wireTask(task)
}

// SetTaskStage moves the task to any stage of its workflow, or to "done". Runs are kept: a stage
// revisited shows its earlier runs as history. Refused while a run of the task is live.
func (b *TaskBoard) SetTaskStage(_ context.Context, taskID, stageID string) (adewire.Task, error) {
	mu := b.taskMu(taskID)
	mu.Lock()
	defer mu.Unlock()
	tc, err := b.loadTaskCtx(taskID)
	if err != nil {
		return adewire.Task{}, err
	}
	if tc.task.WorkflowID == "" {
		return adewire.Task{}, invalid("the task has no workflow")
	}
	if stageID == tc.task.StageID {
		return b.wireTask(tc.task)
	}
	if err := b.snapshotWorkflow(&tc.task); err != nil {
		return adewire.Task{}, err
	}
	var raw string
	if stageID != "done" {
		wf, ok := b.taskWorkflow(tc.task)
		if !ok {
			return adewire.Task{}, invalid("workflow %q is not available", tc.task.WorkflowID)
		}
		at := slices.IndexFunc(wf.Stages, func(st adewire.Stage) bool { return st.ID == stageID })
		if at < 0 {
			return adewire.Task{}, invalid("workflow %q has no stage %q", wf.Name, stageID)
		}
		if wf.Stages[at].Skip {
			return adewire.Task{}, invalid("stage %q is skipped in workflow %q", stageID, wf.Name)
		}
		enc, err := json.Marshal(wf.Stages[at])
		if err != nil {
			return adewire.Task{}, err
		}
		raw = string(enc)
	}
	running, err := b.deps.Tasks.HasRunning(taskID)
	if err != nil {
		return adewire.Task{}, err
	}
	if running {
		return adewire.Task{}, invalid("stop its running agents first")
	}
	if err := b.deps.Tasks.SetStage(taskID, stageID, raw); err != nil {
		return adewire.Task{}, err
	}
	b.clearStepMessages(taskID)
	b.notifyBoard()
	task, err := b.deps.Tasks.GetTask(taskID)
	if err != nil {
		return adewire.Task{}, err
	}
	return b.wireTask(task)
}

// RetrySetup reruns a failed prepare script.
func (b *TaskBoard) RetrySetup(ctx context.Context, branchID string) error {
	sb, err := b.deps.Tasks.GetBranch(branchID)
	if err != nil {
		return err
	}
	mu := b.taskMu(sb.TaskID)
	mu.Lock()
	defer mu.Unlock()
	setup, err := b.deps.Tasks.GetSetup(branchID)
	if err != nil {
		return err
	}
	if setup == nil || setup.State != model.AdeSetupFailed {
		return invalid("only a failed worktree setup can be retried")
	}
	path, err := b.worktreeOf(ctx, sb)
	if err != nil {
		return err
	}
	if path == "" {
		return invalid("the branch has no worktree")
	}
	rec, err := b.deps.CodeRepos.Get(sb.CodeRepoID)
	if err != nil {
		return err
	}
	if rec == nil {
		return invalid("code repo %s not found", sb.CodeRepoID)
	}
	if err := b.startSetup(*rec, sb, sb.Name, path, b.onSetupReady); err != nil {
		return err
	}
	if setup, err = b.deps.Tasks.GetSetup(branchID); err == nil && setup != nil && setup.State == model.AdeSetupReady {
		b.launchHeldLocked(sb) // no prepare script: ready at once, nobody else will launch the held runs
		return nil
	}
	if setup != nil && setup.State == model.AdeSetupRunning {
		b.setPendingNote(branchID, noteWaitingSetup)
	}
	return nil
}

// setPendingNote rewrites the note of a branch's pending runs (they wait behind its setup).
func (b *TaskBoard) setPendingNote(branchID, note string) {
	runs, err := b.deps.Tasks.SetPendingNote(branchID, note)
	if err != nil {
		slog.Warn("ade: pending run note", "scope", "ade", "branch", branchID, "err", err)
		return
	}
	b.emitRuns(runs...)
}

// StopRun stops a running run (it becomes stuck, "stopped by you") or a pending one.
func (b *TaskBoard) StopRun(_ context.Context, runID string) error {
	run, err := b.deps.Tasks.GetRun(runID)
	if err != nil {
		return err
	}
	switch run.State {
	case model.AdeRunRunning:
		done := b.cancelLive(b.live, runID, errStopped)
		if done == nil {
			return invalid("run %s has no live process", runID)
		}
		return b.awaitEnd(done)
	case model.AdeRunPending:
		mu := b.taskMu(run.TaskID)
		mu.Lock()
		defer mu.Unlock()
		if run, err = b.deps.Tasks.GetRun(runID); err != nil {
			return err
		}
		if run.State != model.AdeRunPending {
			return invalid("run %s is no longer pending", runID)
		}
		return b.markStopped(run)
	}
	return invalid("only a running or pending run can be stopped")
}

// markStopped makes a run that has no process stuck.
func (b *TaskBoard) markStopped(run model.AdeRun) error {
	now := b.deps.Now().UnixMilli()
	stuck, note := model.AdeRunStuck, errStopped.Error()
	updated, err := b.deps.Tasks.UpdateRun(run.ID, model.AdeRunPatch{State: &stuck, Note: &note, FinishedAt: &now})
	if err != nil {
		return err
	}
	b.emitRuns(updated)
	return nil
}

// --- reads -------------------------------------------------------------------------------------

// ReadLog returns a page of a run or setup log, readable while it is still being written.
func (b *TaskBoard) ReadLog(_ context.Context, args adewire.ReadLogArgs) (adewire.LogPage, error) {
	if args.Kind != repos.AdeLogRun && args.Kind != repos.AdeLogSetup {
		return adewire.LogPage{}, invalid("kind must be run or setup")
	}
	page, err := b.deps.Logs.Page(args.Kind, args.ID, args.AfterSeq)
	if err != nil {
		return adewire.LogPage{}, err
	}
	out := adewire.LogPage{Kind: args.Kind, ID: args.ID, Chunks: toWireChunks(page.Chunks), NextSeq: page.NextSeq, Truncated: page.Truncated}
	if args.Kind == repos.AdeLogRun {
		run, err := b.deps.Tasks.GetRun(args.ID)
		if err != nil {
			return adewire.LogPage{}, err
		}
		out.Done = run.State != model.AdeRunRunning && run.State != model.AdeRunPending
		return out, nil
	}
	setup, err := b.deps.Tasks.GetSetup(args.ID)
	if err != nil {
		return adewire.LogPage{}, err
	}
	out.Done = setup == nil || setup.State != model.AdeSetupRunning
	return out, nil
}

// Sessions lists the v2 task sessions, running first.
func (b *TaskBoard) Sessions(_ context.Context) (adewire.SessionsResult, error) {
	rows, err := b.deps.Sessions.ListTask()
	if err != nil {
		return adewire.SessionsResult{}, err
	}
	out := adewire.SessionsResult{Sessions: make([]adewire.Session, len(rows))}
	for i, s := range rows {
		out.Sessions[i] = toWireSession(s)
	}
	return out, nil
}

func toWireSession(s model.AdeSession) adewire.Session {
	w := adewire.Session{
		ID: s.ID, ClaudeSessionID: s.ClaudeSessionID, Mode: s.Mode, State: s.State, TerminalID: s.TerminalID,
		TaskID: s.TaskID, BranchID: s.BranchID, StageID: s.StageID, StepID: s.StepID, RunID: s.RunID, Resumes: s.Resumes, Purpose: s.Purpose,
		Cwd: s.Cwd, StartedAt: s.StartedAt, LastActiveAt: s.LastActiveAt,
	}
	if s.Mode == model.AdeSessionModeHeadless {
		w.Activity = "idle"
		if s.State == model.AdeSessionStateRunning {
			w.Activity = "working"
		}
	}
	if s.State == model.AdeSessionStateStopped {
		_, err := os.Stat(s.Cwd)
		w.CwdMissing = err != nil
	}
	return w
}
