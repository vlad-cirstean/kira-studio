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
	// StatusSkipped is a scheduled run that never started.
	StatusSkipped Status = "skipped"
)

type Source string

const (
	SourceAgent   Source = "agent"
	SourceExit    Source = "exit"
	SourceTimeout Source = "timeout"
	SourceStart   Source = "start"
	SourceUser    Source = "user"
	SourceRestart Source = "restart"
	SourceVerify  Source = "verify"
	SourceBudget  Source = "budget"
	// SourceSchedule is a scheduled run skipped by the scheduler itself.
	SourceSchedule Source = "schedule"
)

const (
	lastErrorCap  = 1024
	outputTailCap = 8 << 10
)

type Outcome struct {
	Status    Status `json:"status"`
	Reason    string `json:"reason"`
	Source    Source `json:"source"`
	Reported  bool   `json:"reported"`
	ExitCode  *int   `json:"exitCode,omitempty"`
	LastError string `json:"lastError,omitempty"`
	// OutputTail is the last sanitized output lines of a failed script run, capped at 8 KiB.
	OutputTail string `json:"outputTail,omitempty"`
	Summary    string `json:"summary,omitempty"`
	// Result is the id of the step result an agent reported through finish_step; empty otherwise.
	Result string `json:"result,omitempty"`
	// CostUSD is what a Claude run reported spending; nil when it reported none.
	CostUSD *float64 `json:"costUsd,omitempty"`
	// PermissionDenials names the tools Claude was denied during the run.
	PermissionDenials []string `json:"permissionDenials,omitempty"`
}

// Skipped is the outcome of a scheduled run that did not start; src is SourceSchedule or SourceUser.
func Skipped(reason string, src Source) Outcome {
	return Outcome{Status: StatusSkipped, Source: src, Reason: reason}
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

// WithOutputTail returns o with the end of s, capped at 8 KiB on a rune boundary.
func (o Outcome) WithOutputTail(s string) Outcome {
	s = strings.TrimSpace(s)
	if len(s) > outputTailCap {
		s = strings.ToValidUTF8(s[len(s)-outputTailCap:], "")
	}
	o.OutputTail = s
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
	// EndResumeLost is a resume whose agent conversation is gone.
	EndResumeLost
)

// Agent names the agent in outcome texts: Label as a name ("Claude"), Command as typed ("claude").
type Agent struct{ Label, Command string }

// Namer is what AgentOf reads; a harness provider satisfies it.
type Namer interface {
	Label() string
	Command() string
}

// AgentOf names the agent of p.
func AgentOf(p Namer) Agent { return Agent{Label: p.Label(), Command: p.Command()} }

func (a Agent) label() string {
	if a.Label == "" {
		return "The agent"
	}
	return a.Label
}

func (a Agent) command() string {
	if a.Command == "" {
		return "agent"
	}
	return a.Command
}

// Name is the agent's name for outcome texts.
func (a Agent) Name() string { return a.label() }

type Process struct {
	Agent    Agent
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
	case EndResumeLost:
		return fail(SourceStart, "could not resume: "+p.Agent.label()+" has no saved conversation for this run; start it again")
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
		out.Status, out.Reason = StatusFailed, "no report: "+p.Agent.label()+" ended without calling finish_step"
	case p.Kind == KindAgent:
		out.Status, out.Reason = StatusFailed, fmt.Sprintf("no report: %s exited with status %d", p.Agent.command(), code)
	case code == 0:
		out.Status = StatusDone
	case code < 0:
		out.Status, out.Reason = StatusFailed, "ended by a signal"
	default:
		out.Status, out.Reason = StatusFailed, fmt.Sprintf("exited with status %d", code)
	}
	return out
}
