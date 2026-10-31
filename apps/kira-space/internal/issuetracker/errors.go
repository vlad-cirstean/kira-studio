package issuetracker

import (
	"context"
	"errors"
)

// Typed failures of Provider.Issue.
var (
	ErrUnavailable     = errors.New("issuetracker: CLI not installed")
	ErrUnauthenticated = errors.New("issuetracker: CLI not signed in")
	ErrNotFound        = errors.New("issuetracker: issue not found or not visible")
	ErrOtherSite       = errors.New("issuetracker: issue is on a site other than the signed-in one")
	ErrTimeout         = errors.New("issuetracker: CLI did not answer in time")
)

// Reason words, stable wire values.
const (
	ReasonUnavailable     = "unavailable"
	ReasonUnauthenticated = "unauthenticated"
	ReasonNotFound        = "notFound"
	ReasonOtherSite       = "otherSite"
	ReasonTimeout         = "timeout"
	ReasonFailed          = "failed"
)

// Reason maps an Issue error to its reason word; nil maps to the empty string.
func Reason(err error) string {
	switch {
	case err == nil:
		return ""
	case errors.Is(err, ErrUnavailable):
		return ReasonUnavailable
	case errors.Is(err, ErrUnauthenticated):
		return ReasonUnauthenticated
	case errors.Is(err, ErrNotFound):
		return ReasonNotFound
	case errors.Is(err, ErrOtherSite):
		return ReasonOtherSite
	case errors.Is(err, ErrTimeout), errors.Is(err, context.DeadlineExceeded):
		return ReasonTimeout
	default:
		return ReasonFailed
	}
}
