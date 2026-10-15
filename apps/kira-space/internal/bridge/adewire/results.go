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
	// DefaultMaxReturns is the return limit of an automatic step that sets none.
	DefaultMaxReturns = 3
	MaxMaxReturns     = 10
)

// DefaultLimit is the return limit of a step that sets none; 0 is no limit (a review step, a human drives).
func DefaultLimit(review bool) int {
	if review {
		return 0
	}
	return DefaultMaxReturns
}

// LegacyLimit is the return limit an on_failure rule implies: retry N gives N, anything else the default.
func LegacyLimit(onFailure string, review bool) int {
	if n, ok := strings.CutPrefix(onFailure, "retry "); ok {
		if v, err := strconv.Atoi(n); err == nil && v > 0 {
			return v
		}
	}
	return DefaultLimit(review)
}

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
			failed.Next, failed.Loop = stepID, true
		}
	} else if id, ok := strings.CutPrefix(onFailure, "back:"); ok {
		failed.Next, failed.Loop = id, true
	}
	return []StepResult{{ID: ResultDone, OK: true, Next: RouteNext}, failed}
}

// LegacyOnFailure is the on_failure rule that results and the step's return limit equal, when they equal
// one exactly. earlier lists the step ids before stepID in its stage.
func LegacyOnFailure(stepID string, results []StepResult, earlier []string, maxReturns int, review bool) (string, bool) {
	if len(results) != 2 {
		return "", false
	}
	d, f := results[0], results[1]
	if d.ID != ResultDone || !d.OK || d.Description != "" || d.Next != RouteNext ||
		f.ID != ResultFailed || f.OK || f.Description != "" {
		return "", false
	}
	var rule string
	switch {
	case f.Next == RouteStop:
		rule = "stop"
	case f.Next == stepID && (maxReturns == 1 || maxReturns == 2):
		rule = "retry " + strconv.Itoa(maxReturns)
	case f.Next != stepID && slices.Contains(earlier, f.Next):
		rule = "back:" + f.Next
	default:
		return "", false
	}
	if maxReturns != LegacyLimit(rule, review) {
		return "", false
	}
	return rule, true
}
