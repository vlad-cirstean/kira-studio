package adewire

import (
	"slices"
	"strconv"
	"strings"
)

// Result routes: a result's Next is one of these or a step id of the same stage.
const (
	RouteNext = "next"
	RouteEnd  = "end"
	RouteStop = "stop"
)

// Implicit result ids of a step that declares none.
const (
	ResultDone   = "done"
	ResultFailed = "failed"
)

const (
	// DefaultLoopMax is the loop budget of an edge that sets none (legacy back: uses it too).
	DefaultLoopMax = 3
	MaxLoopMax     = 10
)

// DefaultRoute is where a result goes when it names no route.
func DefaultRoute(ok bool) string {
	if ok {
		return RouteNext
	}
	return RouteStop
}

// ImplicitResults are the results of a step with no declared ones, derived from its legacy on_failure
// rule (stop | retry N | back:<step>). stepID is the step itself, the target of a retry.
func ImplicitResults(stepID, onFailure string) []StepResult {
	failed := StepResult{ID: ResultFailed, Next: RouteStop}
	if n, ok := strings.CutPrefix(onFailure, "retry "); ok {
		if v, err := strconv.Atoi(n); err == nil && v > 0 {
			failed.Next, failed.Max = stepID, v
		}
	} else if id, ok := strings.CutPrefix(onFailure, "back:"); ok {
		failed.Next, failed.Max = id, DefaultLoopMax
	}
	return []StepResult{{ID: ResultDone, OK: true, Next: RouteNext}, failed}
}

// LegacyOnFailure is the on_failure rule that results equal, when they equal one exactly. earlier
// lists the step ids before stepID in its stage.
func LegacyOnFailure(stepID string, results []StepResult, earlier []string) (string, bool) {
	if len(results) != 2 {
		return "", false
	}
	d, f := results[0], results[1]
	if d.ID != ResultDone || !d.OK || d.Description != "" || d.Next != RouteNext || d.Max != 0 ||
		f.ID != ResultFailed || f.OK || f.Description != "" {
		return "", false
	}
	switch {
	case f.Next == RouteStop && f.Max == 0:
		return "stop", true
	case f.Next == stepID && (f.Max == 1 || f.Max == 2):
		return "retry " + strconv.Itoa(f.Max), true
	case f.Next != stepID && f.Max == DefaultLoopMax && slices.Contains(earlier, f.Next):
		return "back:" + f.Next, true
	}
	return "", false
}
