package ade

import (
	"fmt"
	"log/slog"
	"slices"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

// route.go routes a finished step run on its result (R4, R5): forward, to the end of the stage, to a
// stop, or back to this step or an earlier one. A loop is bounded by its result's max, counted per
// (task, stage, step, branch, result) and never reset. A loop to an earlier step resumes that step's
// Claude session with a fix line; the chain then runs again (steps.go chainRerun).

// runOpts are the per-run extras queueRun carries to launch. Launch lives on the run row until the
// run launches, so a run held behind a setup resumes the same way after a restart.
type runOpts struct {
	Loops  int
	Launch model.AdeRunLaunch
}

// pendingLoop is a decided loop: the step to run again on one branch.
type pendingLoop struct {
	tc      *taskCtx
	plan    []stepView
	target  int
	branch  string
	attempt int
	opts    runOpts
}

// resultFor picks the result a run's outcome stands for: the reported id, else (no report: a crash, a
// timeout, an exit code) the step's `failed` result when the process failed, `done` when it
// succeeded; a step without that name falls back to the first result of the right kind, and a failure
// to a stop (D7).
func resultFor(def stepDef, out outcome) adewire.StepResult {
	if r, ok := def.resultOf(out.out.Result); ok && out.out.Result != "" {
		return r
	}
	want, id := out.state == model.AdeRunDone, adewire.ResultFailed
	if want {
		id = adewire.ResultDone
	}
	if r, ok := def.resultOf(id); ok {
		return r
	}
	if want {
		if i := slices.IndexFunc(def.Results, func(r adewire.StepResult) bool { return r.OK }); i >= 0 {
			return def.Results[i]
		}
		return adewire.StepResult{ID: id, OK: true, Next: adewire.RouteNext}
	}
	return adewire.StepResult{ID: id, Next: adewire.RouteStop}
}

// decideRoute applies the step's result route to a finished run's outcome. It returns the loop to
// queue (nil when none) and the outcome to record: `back` for a loop with its note, `done` for a
// forward or end route even on a not-ok result, `failed` for a stop or a spent loop.
func (b *TaskBoard) decideRoute(run model.AdeRun, out outcome) (*pendingLoop, outcome) {
	tc, err := b.loadTaskCtx(run.TaskID)
	if err != nil || tc.stage == nil || tc.stage.ID != run.StageID {
		return nil, out
	}
	plan, err := b.plan(tc)
	if err != nil {
		return nil, out
	}
	idx := stepIndex(plan, run.StepID)
	if idx < 0 {
		return nil, out
	}
	res := resultFor(plan[idx].Def, out)
	out.out.Result = res.ID
	var target int
	switch res.Next {
	case adewire.RouteNext:
		return nil, forward(out, adewire.RouteNext)
	case adewire.RouteEnd:
		return nil, forward(out, adewire.RouteEnd)
	case adewire.RouteStop:
		return nil, stopped(out)
	default:
		target = stepIndex(plan, res.Next)
	}
	if target < 0 {
		return nil, stopped(out)
	}
	if target > idx {
		return nil, forward(out, res.Next)
	}
	return b.decideLoop(tc, plan, run, out, res, idx, target)
}

func forward(out outcome, route string) outcome {
	out.state, out.out.Route = model.AdeRunDone, route
	return out
}

func stopped(out outcome) outcome {
	out.state, out.out.Route = model.AdeRunFailed, adewire.RouteStop
	return out
}

// decideLoop routes a result back to plan[target] (the step itself when target == idx).
func (b *TaskBoard) decideLoop(tc *taskCtx, plan []stepView, run model.AdeRun, out outcome, res adewire.StepResult, idx, target int) (*pendingLoop, outcome) {
	reason := cmpNonEmpty(out.summary, out.note)
	spent, err := b.loopsSpent(run, res.ID)
	if err != nil {
		slog.Warn("ade: count loop rounds", "scope", "ade", "run", run.ID, "err", err)
		return nil, stopped(out)
	}
	round := spent + 1
	self := target == idx
	if round > res.Max {
		verb := "sent back"
		if self {
			verb = "retried"
		}
		out = stopped(out)
		out.note = fmt.Sprintf("%s (%s %d times)", reason, verb, res.Max)
		out.out.Reason = out.note
		return nil, out
	}
	loop := &pendingLoop{tc: tc, plan: plan, target: target, branch: run.BranchID, attempt: run.Attempt + 1, opts: runOpts{Loops: run.Loops}}
	out.state = model.AdeRunBack
	if self {
		out.out.Route = "retry"
		out.note = fmt.Sprintf("retry %d of %d", round, res.Max)
		out.out.Reason = cmpNonEmpty(reason, out.note)
		return loop, out
	}
	branchName := ""
	if sb, ok := tc.branch(run.BranchID); ok {
		branchName = sb.Name
	}
	targetDef, from := plan[target].Def, plan[idx].Def
	prev, ran := plan[target].Runs[run.BranchID]
	if !ran {
		out = stopped(out)
		out.note = fmt.Sprintf("cannot send back: %s did not run on %s", targetDef.Name, branchName)
		out.out.Reason = out.note
		return nil, out
	}
	loop.attempt, loop.opts.Loops = prev.Attempt+1, b.nextLoops(plan, run.BranchID)
	loop.opts.Launch = model.AdeRunLaunch{Note: fmt.Sprintf("sent back by %s: %s", from.Name, reason)}
	line := fmt.Sprintf("%s failed on %s: %s. Fix the implementation.", from.Name, branchName, reason)
	if id := b.claudeIDOfSession(prev.SessionID); id != "" {
		loop.opts.Launch.ResumeID, loop.opts.Launch.Prompt = id, line
	} else {
		loop.opts.Launch.Extra = line
	}
	out.out.Route = "back:" + targetDef.ID
	out.note = fmt.Sprintf("%s → back to %s (%d of %d)", reason, targetDef.Name, round, res.Max)
	out.out.Reason = out.note
	return loop, out
}

// nextLoops is the stage round of a loop to an earlier step on a branch: one more than any run of
// the branch has, so the rounds stay in order across different failing steps.
func (b *TaskBoard) nextLoops(plan []stepView, branch string) int {
	round := 0
	for _, v := range plan {
		if r, ok := v.Runs[branch]; ok {
			round = max(round, r.Loops)
		}
	}
	return round + 1
}

// loopsSpent counts the earlier `back` runs of the run's step and branch that reported the result.
// A back run from before results has no result id: it counts as `failed`.
func (b *TaskBoard) loopsSpent(run model.AdeRun, resultID string) (int, error) {
	runs, err := b.deps.Tasks.RunsOfTask(run.TaskID)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, r := range runs {
		if r.StageID != run.StageID || r.StepID != run.StepID || r.BranchID != run.BranchID || r.State != model.AdeRunBack {
			continue
		}
		got := adewire.ResultFailed
		if r.Outcome != nil && r.Outcome.Result != "" {
			got = r.Outcome.Result
		}
		if got == resultID {
			n++
		}
	}
	return n, nil
}

// claudeIDOfSession is the Claude session id behind an ade_sessions record id, "" when unknown.
func (b *TaskBoard) claudeIDOfSession(sessionID string) string {
	if sessionID == "" {
		return ""
	}
	rec, err := b.deps.Sessions.Get(sessionID)
	if err != nil || rec == nil {
		return ""
	}
	return rec.ClaudeSessionID
}

// queue starts the loop's run; the task mutex is held.
func (l *pendingLoop) queue(b *TaskBoard) {
	if _, err := b.queueRun(b.ctx, l.tc, l.plan, l.target, l.branch, l.attempt, "", l.opts); err != nil {
		slog.Warn("ade: loop run", "scope", "ade", "branch", l.branch, "err", err)
	}
}
