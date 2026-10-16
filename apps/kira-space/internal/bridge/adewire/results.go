package adewire

// Result routes: a result's Next is one of these or a step id of the workflow.
const (
	RouteNext = "next"
	RouteEnd  = "end"
	RouteStop = "stop"
)

// Default result ids of a step that declares none.
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

// DefaultRoute is where a result goes when it names no route.
func DefaultRoute(ok bool) string {
	if ok {
		return RouteNext
	}
	return RouteStop
}

// DefaultResults are the results of a step that declares none: done goes on, failed stops the run.
func DefaultResults() []StepResult {
	return []StepResult{
		{ID: ResultDone, OK: true, Next: RouteNext},
		{ID: ResultFailed, Next: RouteStop},
	}
}

// DefaultStatus is the task status of a step that sets none.
func DefaultStatus(kind StepKind) TaskStatus {
	if kind == KindReview {
		return "In review"
	}
	return "In progress"
}
