package ade

import (
	"fmt"
	"slices"
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
	// Results are the step's declared (or implicit) results with their routes.
	Results      []adewire.StepResult
	AllowedTools []string
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
		return []stepDef{{ID: st.ID, Name: st.Name, RunsOn: runsOn, Before: "auto", OnFailure: onFailure,
			Results: adewire.ImplicitResults(st.ID, onFailure), Timeout: st.Timeout, Prompt: st.Command}}
	case "agent":
		out := make([]stepDef, len(st.Steps))
		for i, s := range st.Steps {
			results := s.Results
			if len(results) == 0 { // a snapshot from before results: its on_failure rule
				results = adewire.ImplicitResults(s.ID, cmpNonEmpty(s.OnFailure, "stop"))
			}
			out[i] = stepDef{ID: s.ID, Name: s.Name, RunsOn: s.RunsOn, Before: s.Before, OnFailure: s.OnFailure, Results: results,
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
	actStageComplete
)

// action is nextAction's answer. Step is the index of the step it concerns.
type action struct {
	Kind actionKind
	Step int
}

// resultOf is the declared result with the id, false when the step has none such.
func (d stepDef) resultOf(id string) (adewire.StepResult, bool) {
	i := slices.IndexFunc(d.Results, func(r adewire.StepResult) bool { return r.ID == id })
	if i < 0 {
		return adewire.StepResult{}, false
	}
	return d.Results[i], true
}

// routeIndex resolves a run's stored forward route to the index of the step after steps[i]; len(steps)
// = the stage is complete. A run with no stored route (before results) counts as `next`.
func routeIndex(steps []stepView, i int, route string) int {
	switch route {
	case "", adewire.RouteNext:
		return i + 1
	case adewire.RouteEnd:
		return len(steps)
	}
	if j := slices.IndexFunc(steps, func(v stepView) bool { return v.Def.ID == route }); j > i {
		return j
	}
	return i + 1
}

func runRoute(r model.AdeRun) string {
	if r.Outcome == nil {
		return ""
	}
	return r.Outcome.Route
}

// forwardTarget is where the path goes after the done step i: the earliest forward route among its
// runs on the given branches (the step that skips the least, D8).
func forwardTarget(steps []stepView, i int, branches []string) int {
	next := len(steps)
	for _, id := range branches {
		if r, ok := steps[i].Runs[id]; ok {
			next = min(next, routeIndex(steps, i, runRoute(r)))
		}
	}
	if next < i+1 {
		return i + 1
	}
	return next
}

// walkPath follows the stage's routes from the first step: a done step moves to its forward target,
// the first step not done ends the path. skipped marks the steps the route went past.
func walkPath(steps []stepView) (path []int, skipped []bool) {
	skipped = make([]bool, len(steps))
	i := 0
	for i < len(steps) {
		path = append(path, i)
		if steps[i].state() != model.AdeRunDone {
			break
		}
		next := forwardTarget(steps, i, steps[i].Targets)
		for j := i + 1; j < next && j < len(steps); j++ {
			skipped[j] = true
		}
		i = next
	}
	return path, skipped
}

// rerun is one step run chainRerun queues again on a branch.
type rerun struct {
	Step    int
	Branch  string
	Attempt int
	Loops   int
}

// chainRerun finds, per target branch, the first step that must run again after a send-back fix
// (R4). Walking the branch's route path, round is the highest loops among the done runs so far; a
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
		for i := 0; i < len(steps); {
			s := steps[i]
			if !slices.Contains(s.Targets, bid) {
				i++
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
				i = forwardTarget(steps, i, []string{bid})
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

// nextAction looks at the last step of the route path: the first one not done. A running, stuck or
// failed step waits (a failure was routed when it was recorded: looped, continued or stopped). A
// pending step with runs waits on its worktree gate; without runs it starts (auto) or waits for
// Approve, except the first, which only StartRun starts. A path that ends past the last step = the
// stage is complete; the user moves on with StageDone.
func nextAction(steps []stepView) action {
	if len(steps) == 0 {
		return action{Kind: actIdle}
	}
	path, _ := walkPath(steps)
	i := path[len(path)-1]
	s := steps[i]
	switch s.state() {
	case model.AdeRunDone:
		return action{Kind: actStageComplete, Step: i}
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
