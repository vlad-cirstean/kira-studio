package memory

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/kirathecat/kira-studio/internal/harness"
)

// Call is one isolated structured agent request.
type Call = harness.StructuredCall

// Result is a finished call: the structured output plus what the agent reported spending.
type Result = harness.StructuredResult

// Runner runs one Call and returns the structured output object. Fail is the active provider's
// user-facing error of a harness.Err* kind.
type Runner interface {
	Run(ctx context.Context, c Call) (json.RawMessage, error)
	Fail(kind error) error
}

// ResultRunner is a Runner that also reports spend and can probe for the agent CLI.
type ResultRunner interface {
	Runner
	RunResult(ctx context.Context, c Call) (Result, error)
	Available() error
}

// ModelSource returns the model for the next call of a provider; nil means its catalog default.
type ModelSource func(provider string) (string, error)

// AgentRunner runs structured calls through the active provider.
type AgentRunner struct {
	sel    harness.Selector
	models ModelSource
}

func NewAgentRunner(sel harness.Selector, models ModelSource) *AgentRunner {
	return &AgentRunner{sel: sel, models: models}
}

// model resolves per call, so a settings change applies to the next call in a running process.
func (r *AgentRunner) model(p harness.Provider) string {
	cat := p.Models()
	if r.models == nil {
		return cat.Default
	}
	m, err := r.models(p.ID())
	if err != nil {
		slog.Warn("memory: read agent model, using default", "provider", p.ID(), "err", err)
		return cat.Default
	}
	if !cat.Valid(m) {
		slog.Warn("memory: invalid agent model, using default", "provider", p.ID(), "model", m)
		return cat.Default
	}
	return m
}

func (r *AgentRunner) Run(ctx context.Context, c Call) (json.RawMessage, error) {
	res, err := r.RunResult(ctx, c)
	return res.Output, err
}

// RunResult is Run plus the cost and turn count the agent reports.
func (r *AgentRunner) RunResult(ctx context.Context, c Call) (Result, error) {
	p := r.sel.Active()
	return p.RunStructured(ctx, r.model(p), c)
}

func (r *AgentRunner) Fail(kind error) error { return r.sel.Active().Fail(kind) }

// Available reports whether the active provider's CLI can be found.
func (r *AgentRunner) Available() error { return r.sel.Active().Available() }
