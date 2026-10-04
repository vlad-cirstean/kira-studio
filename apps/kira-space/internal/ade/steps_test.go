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
		"a capped back failure idles":       {[]stepView{done, view(back, one, run("a", "failed", 1))}, action{Kind: actIdle, Step: 1}},
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

func loopRun(branch, state string, attempt, loops int) model.AdeRun {
	r := run(branch, state, attempt)
	r.Loops = loops
	return r
}

func TestChainRerun(t *testing.T) {
	one := []string{"a"}
	impl := stepDef{ID: "impl", Before: "auto", OnFailure: "stop"}
	tests := stepDef{ID: "tests", Before: "auto", OnFailure: "back:impl"}
	ci := stepDef{ID: "ci", Before: "auto", OnFailure: "back:impl"}
	gated := stepDef{ID: "gate", Before: "approval", OnFailure: "stop"}

	for name, tc := range map[string]struct {
		steps []stepView
		want  []rerun
	}{
		"before any send-back nothing reruns": {
			[]stepView{view(impl, one, loopRun("a", "done", 1, 0)), view(tests, one, loopRun("a", "failed", 1, 0))}, nil},
		"fix still running waits": {
			[]stepView{view(impl, one, loopRun("a", "running", 2, 1)), view(tests, one, loopRun("a", "back", 1, 0))}, nil},
		"back step reruns after the fix": {
			[]stepView{view(impl, one, loopRun("a", "done", 2, 1)), view(tests, one, loopRun("a", "back", 1, 0))},
			[]rerun{{Step: 1, Branch: "a", Attempt: 2, Loops: 1}}},
		"steps between target and failer rerun first": {
			[]stepView{view(impl, one, loopRun("a", "done", 2, 1)), view(tests, one, loopRun("a", "done", 1, 0)), view(ci, one, loopRun("a", "back", 1, 0))},
			[]rerun{{Step: 1, Branch: "a", Attempt: 2, Loops: 1}}},
		"a rerun in flight ends the walk": {
			[]stepView{view(impl, one, loopRun("a", "done", 2, 1)), view(tests, one, loopRun("a", "running", 2, 1)), view(ci, one, loopRun("a", "back", 1, 0))}, nil},
		"current rounds are not stale": {
			[]stepView{view(impl, one, loopRun("a", "done", 2, 1)), view(tests, one, loopRun("a", "done", 2, 1)), view(ci, one, loopRun("a", "back", 1, 0))},
			[]rerun{{Step: 2, Branch: "a", Attempt: 2, Loops: 1}}},
		"second round uses the higher loops": {
			[]stepView{view(impl, one, loopRun("a", "done", 3, 2)), view(tests, one, loopRun("a", "back", 2, 1))},
			[]rerun{{Step: 1, Branch: "a", Attempt: 3, Loops: 2}}},
		"a missing run stops the walk": {
			[]stepView{view(impl, one, loopRun("a", "done", 2, 1)), view(gated, one), view(tests, one, loopRun("a", "back", 1, 0))}, nil},
		"approval is not consulted for a rerun": {
			[]stepView{view(impl, one, loopRun("a", "done", 2, 1)), view(gated, one, loopRun("a", "done", 1, 0))},
			[]rerun{{Step: 1, Branch: "a", Attempt: 2, Loops: 1}}},
		"a failed run is left to nextAction": {
			[]stepView{view(impl, one, loopRun("a", "done", 2, 1)), view(tests, one, loopRun("a", "failed", 1, 0))}, nil},
		"each branch walks on its own": {
			[]stepView{view(impl, []string{"a", "b"}, loopRun("a", "done", 2, 1), loopRun("b", "done", 1, 0)),
				view(tests, []string{"a", "b"}, loopRun("a", "back", 1, 0), loopRun("b", "done", 1, 0))},
			[]rerun{{Step: 1, Branch: "a", Attempt: 2, Loops: 1}}},
	} {
		if got := chainRerun(tc.steps); !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%s: reruns = %+v, want %+v", name, got, tc.want)
		}
	}
}

func TestSendBackTarget(t *testing.T) {
	impl := stepDef{ID: "impl"}
	tests := stepDef{ID: "tests", OnFailure: "back:impl"}
	later := stepDef{ID: "ci", OnFailure: "back:deploy"}
	deploy := stepDef{ID: "deploy"}
	steps := []stepView{view(impl, nil), view(tests, nil), view(later, nil), view(deploy, nil)}
	if i, ok := sendBackTarget(steps, 1); !ok || i != 0 {
		t.Errorf("tests = %d, %v; want step 0", i, ok)
	}
	if _, ok := sendBackTarget(steps, 2); ok {
		t.Error("a later step is not a send-back target")
	}
	if _, ok := sendBackTarget(steps, 0); ok {
		t.Error("a step without the rule has no target")
	}
}
