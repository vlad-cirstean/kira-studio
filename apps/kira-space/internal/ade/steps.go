package ade

import (
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

// steps.go is the pure half of the step machine: which branches a step runs on, a step's aggregate
// state and the next action. It mirrors frontend ade/v2/board/progress.ts, which fixes the rules.

// stepDef is one step of the current stage. A script stage is one step whose id is the stage id and
// whose Prompt is the command.
type stepDef struct {
	ID, Name, RunsOn, Before, OnFailure, Timeout, Prompt string
	AllowedTools                                         []string
	// SmartScript names the smart script that replaces Prompt; Params are its values.
	SmartScript string
	Params      map[string][]string
}

// stageSteps lists a stage's steps; a user stage has none.
func stageSteps(st adewire.Stage) []stepDef {
	switch st.Kind {
	case "script":
		runsOn := st.RunsOn
		if runsOn == "" {
			runsOn = "once"
		}
		onFailure := st.OnFailure
		if onFailure == "" {
			onFailure = "stop"
		}
		return []stepDef{{ID: st.ID, Name: st.Name, RunsOn: runsOn, Before: "auto", OnFailure: onFailure, Timeout: st.Timeout, Prompt: st.Command}}
	case "agent":
		out := make([]stepDef, len(st.Steps))
		for i, s := range st.Steps {
			out[i] = stepDef{ID: s.ID, Name: s.Name, RunsOn: s.RunsOn, Before: s.Before, OnFailure: s.OnFailure,
				Timeout: s.Timeout, Prompt: s.Prompt, AllowedTools: s.AllowedTools,
				SmartScript: s.SmartScript, Params: s.Params}
		}
		return out
	}
	return nil
}

// mineBranch is a task's mine branch with its repo's display name (nickname, else name).
type mineBranch struct{ ID, Nick string }

// stepTargets resolves a step's branches in task order: once = the first, each repo = all, only
// <nick> = those in that repo.
func stepTargets(runsOn string, mine []mineBranch) ([]string, error) {
	if len(mine) == 0 {
		return nil, fmt.Errorf("the task has no branch of its own to run on")
	}
	if nick, ok := strings.CutPrefix(runsOn, "only "); ok {
		var out []string
		for _, b := range mine {
			if b.Nick == nick {
				out = append(out, b.ID)
			}
		}
		if len(out) == 0 {
			return nil, fmt.Errorf("the step runs only on %q, which has no branch in this task", nick)
		}
		return out, nil
	}
	if runsOn == "once" {
		return []string{mine[0].ID}, nil
	}
	out := make([]string, len(mine))
	for i, b := range mine {
		out[i] = b.ID
	}
	return out, nil
}

// stepView is a step with its targets and the latest run per target branch.
type stepView struct {
	Def     stepDef
	Targets []string
	Runs    map[string]model.AdeRun
}

// state is the worst-of aggregate: stuck > failed > running/back > pending; done when all targets are done.
func (v stepView) state() string {
	if len(v.Targets) == 0 {
		return model.AdeRunPending
	}
	var stuck, failed, running, done int
	for _, id := range v.Targets {
		switch v.Runs[id].State {
		case model.AdeRunStuck:
			stuck++
		case model.AdeRunFailed:
			failed++
		case model.AdeRunRunning, model.AdeRunBack:
			running++
		case model.AdeRunDone:
			done++
		}
	}
	switch {
	case stuck > 0:
		return model.AdeRunStuck
	case failed > 0:
		return model.AdeRunFailed
	case running > 0:
		return model.AdeRunRunning
	case done == len(v.Targets):
		return model.AdeRunDone
	}
	return model.AdeRunPending
}

func (v stepView) started() bool { return len(v.Runs) > 0 }

type actionKind int

const (
	actIdle actionKind = iota
	actStart
	actAwaitApproval
	actRetry
	actStageComplete
)

// action is nextAction's answer. Step is the index of the step it concerns; Retry lists the failed
// runs to attempt again.
type action struct {
	Kind  actionKind
	Step  int
	Retry []model.AdeRun
}

// sendBackTarget resolves steps[idx]'s `back:<step>` rule to the index of an earlier step of the
// same stage (D13).
func sendBackTarget(steps []stepView, idx int) (int, bool) {
	id, ok := strings.CutPrefix(steps[idx].Def.OnFailure, "back:")
	if !ok {
		return 0, false
	}
	for i := 0; i < idx; i++ {
		if steps[i].Def.ID == id {
			return i, true
		}
	}
	return 0, false
}

// rerun is one step run chainRerun queues again on a branch.
type rerun struct {
	Step    int
	Branch  string
	Attempt int
	Loops   int
}

// chainRerun finds, per target branch, the first step that must run again after a send-back fix
// (R4). Walking the stage's steps in order, round is the highest loops among the done runs so far; a
// done or `back` run with fewer loops than the round is stale and is queued again with loops =
// round. A missing, running, pending, stuck or failed run ends the walk.
func chainRerun(steps []stepView) []rerun {
	var branches []string
	seen := map[string]bool{}
	for _, s := range steps {
		for _, id := range s.Targets {
			if !seen[id] {
				seen[id] = true
				branches = append(branches, id)
			}
		}
	}
	var out []rerun
walk:
	for _, bid := range branches {
		round := 0
		for i, s := range steps {
			if !slices.Contains(s.Targets, bid) {
				continue
			}
			r, ok := s.Runs[bid]
			if !ok {
				continue walk
			}
			switch r.State {
			case model.AdeRunDone:
				if r.Loops < round {
					out = append(out, rerun{Step: i, Branch: bid, Attempt: r.Attempt + 1, Loops: round})
					continue walk
				}
				round = max(round, r.Loops)
			case model.AdeRunBack:
				if r.Loops < round {
					out = append(out, rerun{Step: i, Branch: bid, Attempt: r.Attempt + 1, Loops: round})
				}
				continue walk
			default:
				continue walk
			}
		}
	}
	return out
}

// retryLimit is N of `retry N`; 0 for any other rule (stop, back:<step>).
func retryLimit(onFailure string) int {
	n, ok := strings.CutPrefix(onFailure, "retry ")
	if !ok {
		return 0
	}
	v, err := strconv.Atoi(n)
	if err != nil || v < 0 {
		return 0
	}
	return v
}

// nextAction looks at the first step that is not done. A running or stuck step waits. A failed step
// retries the runs whose rule still allows an attempt (a `back:` failure was decided when it was
// recorded: sent back, or failed for good). A
// pending step with runs waits on its worktree gate; without runs it starts (auto) or waits for
// Approve, except the first, which only StartRun starts. All steps done = the stage is complete;
// the user moves on with StageDone.
func nextAction(steps []stepView) action {
	for i, s := range steps {
		switch s.state() {
		case model.AdeRunDone:
			continue
		case model.AdeRunFailed:
			limit := retryLimit(s.Def.OnFailure)
			var retry []model.AdeRun
			for _, id := range s.Targets {
				if r := s.Runs[id]; r.State == model.AdeRunFailed && r.Attempt <= limit {
					retry = append(retry, r)
				}
			}
			if len(retry) > 0 {
				return action{Kind: actRetry, Step: i, Retry: retry}
			}
			return action{Kind: actIdle, Step: i}
		case model.AdeRunPending:
			switch {
			case s.started() || i == 0:
				return action{Kind: actIdle, Step: i}
			case s.Def.Before == "approval":
				return action{Kind: actAwaitApproval, Step: i}
			}
			return action{Kind: actStart, Step: i}
		}
		return action{Kind: actIdle, Step: i}
	}
	if len(steps) == 0 {
		return action{Kind: actIdle}
	}
	return action{Kind: actStageComplete, Step: len(steps) - 1}
}
