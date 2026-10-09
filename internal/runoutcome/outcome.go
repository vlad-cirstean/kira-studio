// Package runoutcome is the one end-state type for every script and agent run.
package runoutcome

import (
	"fmt"
	"strings"
)

type Status string

const (
	StatusDone      Status = "done"
	StatusFailed    Status = "failed"
	StatusBlocked   Status = "blocked"
	StatusCancelled Status = "cancelled"
)

type Source string

const (
	SourceAgent   Source = "agent"
	SourceExit    Source = "exit"
	SourceTimeout Source = "timeout"
	SourceStart   Source = "start"
	SourceUser    Source = "user"
	SourceRestart Source = "restart"
)

const lastErrorCap = 1024

type Outcome struct {
	Status    Status `json:"status"`
	Reason    string `json:"reason"`
	Source    Source `json:"source"`
	Reported  bool   `json:"reported"`
	ExitCode  *int   `json:"exitCode,omitempty"`
	LastError string `json:"lastError,omitempty"`
	Summary   string `json:"summary,omitempty"`
}

// Ended reports whether the outcome is set.
func (o Outcome) Ended() bool { return o.Status != "" }

// WithLastError returns o with the last stderr line, capped at 1 KiB.
func (o Outcome) WithLastError(line string) Outcome {
	line = strings.TrimSpace(line)
	if len(line) > lastErrorCap {
		line = strings.ToValidUTF8(line[:lastErrorCap], "")
	}
	o.LastError = line
	return o
}

type Kind int

const (
	KindScript Kind = iota
	KindAgent
)

type End int

const (
	EndExit End = iota
	EndTimeout
	EndStartErr
	EndUser
	EndWindow
	EndQuit
	EndRestart
)

type Process struct {
	Kind     Kind
	End      End
	ExitCode int
	Err      error
	Timeout  string
	App      string
}

// ForProcess maps how a process ended to its outcome. It is the one wording source.
func ForProcess(p Process) Outcome {
	prefix := ""
	if p.Kind == KindAgent {
		prefix = "no report: "
	}
	fail := func(src Source, reason string) Outcome {
		return Outcome{Status: StatusFailed, Source: src, Reason: reason}
	}
	switch p.End {
	case EndTimeout:
		return fail(SourceTimeout, prefix+"timed out after "+p.Timeout)
	case EndStartErr:
		return fail(SourceStart, fmt.Sprintf("could not start: %v", p.Err))
	case EndUser:
		return Outcome{Status: StatusCancelled, Source: SourceUser, Reason: "stopped by you"}
	case EndWindow:
		return Outcome{Status: StatusCancelled, Source: SourceUser, Reason: "its window closed while it ran"}
	case EndQuit:
		return fail(SourceRestart, "Kira "+p.App+" quit while it ran")
	case EndRestart:
		return fail(SourceRestart, "interrupted: Kira "+p.App+" closed while it ran")
	}
	code := p.ExitCode
	out := Outcome{Source: SourceExit, ExitCode: &code}
	switch {
	case p.Kind == KindAgent && code == 0:
		out.Status, out.Reason = StatusFailed, "no report: Claude ended without calling finish_step"
	case p.Kind == KindAgent:
		out.Status, out.Reason = StatusFailed, fmt.Sprintf("no report: claude exited with status %d", code)
	case code == 0:
		out.Status = StatusDone
	case code < 0:
		out.Status, out.Reason = StatusFailed, "ended by a signal"
	default:
		out.Status, out.Reason = StatusFailed, fmt.Sprintf("exited with status %d", code)
	}
	return out
}
