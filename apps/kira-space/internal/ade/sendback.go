package ade

import (
	"fmt"
	"log/slog"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

// sendback.go is the `back:<step>` failure rule (R3-R5): the failing step's run becomes `back`, the
// target step runs again on the same branch in its Claude session, and the chain continues from
// there (steps.go chainRerun).

const maxSendBackRounds = 3

// runOpts are the per-run extras queueRun carries to launch. Launch lives on the run row until the
// run launches, so a run held behind a setup resumes the same way after a restart.
type runOpts struct {
	Loops  int
	Launch model.AdeRunLaunch
}

// sendBack is a decided send-back: the target step to run again on one branch.
type sendBack struct {
	tc      *taskCtx
	plan    []stepView
	target  int
	branch  string
	attempt int
	opts    runOpts
}

// decideSendBack applies the `back:` rule to a failed run's outcome. It returns the send-back to
// queue (nil when none) and the outcome to record: `back` with the round note, or `failed` when the
// rounds are spent or the target cannot be resumed.
func (b *TaskBoard) decideSendBack(run model.AdeRun, out outcome) (*sendBack, outcome) {
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
	target, ok := sendBackTarget(plan, idx)
	if !ok {
		return nil, out
	}
	reason := cmpNonEmpty(out.summary, out.note)
	spent, err := b.deps.Tasks.CountRuns(run.TaskID, run.StageID, run.StepID, run.BranchID, model.AdeRunBack)
	if err != nil {
		slog.Warn("ade: count send-back rounds", "scope", "ade", "run", run.ID, "err", err)
		return nil, out
	}
	round := spent + 1
	if round > maxSendBackRounds {
		out.note = fmt.Sprintf("%s (sent back %d times)", reason, maxSendBackRounds)
		out.out.Reason = out.note
		return nil, out
	}
	branchName := ""
	if sb, ok := tc.branch(run.BranchID); ok {
		branchName = sb.Name
	}
	targetDef, from := plan[target].Def, plan[idx].Def
	prev, ran := plan[target].Runs[run.BranchID]
	if !ran {
		out.note = fmt.Sprintf("cannot send back: %s did not run on %s", targetDef.Name, branchName)
		out.out.Reason = out.note
		return nil, out
	}
	opts := runOpts{Loops: round, Launch: model.AdeRunLaunch{Note: fmt.Sprintf("sent back by %s: %s", from.Name, reason)}}
	line := fmt.Sprintf("%s failed on %s: %s. Fix the implementation.", from.Name, branchName, reason)
	if id := b.claudeIDOfSession(prev.SessionID); id != "" {
		opts.Launch.ResumeID, opts.Launch.Prompt = id, line
	} else {
		opts.Launch.Extra = line
	}
	out.state = model.AdeRunBack
	out.note = fmt.Sprintf("%s → back to %s (%d of %d)", reason, targetDef.Name, round, maxSendBackRounds)
	out.out.Reason = out.note
	return &sendBack{tc: tc, plan: plan, target: target, branch: run.BranchID, attempt: prev.Attempt + 1, opts: opts}, out
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

// queue starts the target step's fix run; the task mutex is held.
func (sb *sendBack) queue(b *TaskBoard) {
	if _, err := b.queueRun(b.ctx, sb.tc, sb.plan, sb.target, sb.branch, sb.attempt, "", sb.opts); err != nil {
		slog.Warn("ade: send back", "scope", "ade", "branch", sb.branch, "err", err)
	}
}
