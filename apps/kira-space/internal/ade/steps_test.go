package ade

import (
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

func view(def stepDef, targets []string, runs ...model.AdeRun) stepView {
	v := stepView{Def: def, Targets: targets, Runs: map[string]model.AdeRun{}}
	for _, r := range runs {
		v.Runs[r.BranchID] = r
	}
	return v
}

func run(branch, state string, attempt int) model.AdeRun {
	return model.AdeRun{ID: branch + state, BranchID: branch, State: state, Attempt: attempt}
}

func TestStepState(t *testing.T) {
	targets := []string{"a", "b"}
	for name, tc := range map[string]struct {
		runs []model.AdeRun
		want string
	}{
		"no runs":       {nil, model.AdeRunPending},
		"all done":      {[]model.AdeRun{run("a", "done", 1), run("b", "done", 1)}, model.AdeRunDone},
		"done+pending":  {[]model.AdeRun{run("a", "done", 1), run("b", "pending", 1)}, model.AdeRunPending},
		"back is run":   {[]model.AdeRun{run("a", "done", 1), run("b", "back", 1)}, model.AdeRunRunning},
		"failed>run":    {[]model.AdeRun{run("a", "running", 1), run("b", "failed", 1)}, model.AdeRunFailed},
		"stuck>failed":  {[]model.AdeRun{run("a", "stuck", 1), run("b", "failed", 1)}, model.AdeRunStuck},
		"one of two":    {[]model.AdeRun{run("a", "done", 1)}, model.AdeRunPending},
		"running+done":  {[]model.AdeRun{run("a", "done", 1), run("b", "running", 1)}, model.AdeRunRunning},
		"stuck+running": {[]model.AdeRun{run("a", "running", 1), run("b", "stuck", 1)}, model.AdeRunStuck},
	} {
		if got := view(stepDef{}, targets, tc.runs...).state(); got != tc.want {
			t.Errorf("%s: state = %s, want %s", name, got, tc.want)
		}
	}
}

func TestNextAction(t *testing.T) {
	one := []string{"a"}
	auto := stepDef{ID: "s", Before: "auto", OnFailure: "stop"}
	gated := stepDef{ID: "g", Before: "approval", OnFailure: "stop"}
	retry1 := stepDef{ID: "r", Before: "auto", OnFailure: "retry 1"}
	retry2 := stepDef{ID: "r", Before: "auto", OnFailure: "retry 2"}
	back := stepDef{ID: "b", Before: "auto", OnFailure: "back:s"}
	done := view(auto, one, run("a", "done", 1))

	for name, tc := range map[string]struct {
		steps []stepView
		want  action
	}{
		"first step never auto-starts":      {[]stepView{view(gated, one)}, action{Kind: actIdle, Step: 0}},
		"next step starts":                  {[]stepView{done, view(auto, one)}, action{Kind: actStart, Step: 1}},
		"gate waits for approval":           {[]stepView{done, view(gated, one)}, action{Kind: actAwaitApproval, Step: 1}},
		"pending with runs waits on setup":  {[]stepView{view(auto, one, run("a", "pending", 1))}, action{Kind: actIdle, Step: 0}},
		"running waits":                     {[]stepView{view(auto, one, run("a", "running", 1)), view(auto, one)}, action{Kind: actIdle, Step: 0}},
		"stuck waits for a person":          {[]stepView{view(retry2, one, run("a", "stuck", 1))}, action{Kind: actIdle, Step: 0}},
		"stop leaves failed":                {[]stepView{view(auto, one, run("a", "failed", 1))}, action{Kind: actIdle, Step: 0}},
		"back is a plain failure":           {[]stepView{done, view(back, one, run("a", "failed", 1))}, action{Kind: actIdle, Step: 1}},
		"retry 1 attempt 1 retries":         {[]stepView{view(retry1, one, run("a", "failed", 1))}, action{Kind: actRetry, Step: 0, Retry: []model.AdeRun{run("a", "failed", 1)}}},
		"retry 1 attempt 2 gives up":        {[]stepView{view(retry1, one, run("a", "failed", 2))}, action{Kind: actIdle, Step: 0}},
		"retry 2 attempt 2 retries":         {[]stepView{view(retry2, one, run("a", "failed", 2))}, action{Kind: actRetry, Step: 0, Retry: []model.AdeRun{run("a", "failed", 2)}}},
		"retry 2 attempt 3 gives up":        {[]stepView{view(retry2, one, run("a", "failed", 3))}, action{Kind: actIdle, Step: 0}},
		"all done completes the stage":      {[]stepView{done, view(auto, one, run("a", "done", 2))}, action{Kind: actStageComplete, Step: 1}},
		"no steps (user stage) stays idle":  {nil, action{Kind: actIdle}},
		"done step before a stuck one idle": {[]stepView{done, view(auto, one, run("a", "stuck", 1)), view(auto, one)}, action{Kind: actIdle, Step: 1}},
	} {
		if got := nextAction(tc.steps); !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%s: action = %+v, want %+v", name, got, tc.want)
		}
	}
}

func TestStepTargets(t *testing.T) {
	mine := []mineBranch{{"b1", "api"}, {"b2", "web"}, {"b3", "api"}}
	for name, tc := range map[string]struct {
		runsOn string
		want   []string
		fails  bool
	}{
		"once is the first":  {"once", []string{"b1"}, false},
		"each repo is all":   {"each repo", []string{"b1", "b2", "b3"}, false},
		"only by nickname":   {"only api", []string{"b1", "b3"}, false},
		"only unresolved":    {"only db", nil, true},
		"empty runsOn = all": {"", []string{"b1", "b2", "b3"}, false},
	} {
		got, err := stepTargets(tc.runsOn, mine)
		if (err != nil) != tc.fails || !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%s: got %v, %v", name, got, err)
		}
	}
	if _, err := stepTargets("once", nil); err == nil {
		t.Error("a task without a mine branch has no target")
	}
}
