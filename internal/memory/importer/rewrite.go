package importer

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/kirathecat/kira-studio/internal/harness"
	"github.com/kirathecat/kira-studio/internal/llmprompts"
	"github.com/kirathecat/kira-studio/internal/memory"
)

const (
	rewriteTimeout = 90 * time.Second
	rewriteBudget  = "0.25"
)

// RewriteResult is the rewrite path's outcome. Changed is Text != input. Gate names the check that
// rejected a draft; "" with Changed false means the input was already clean (accepted, no-op).
type RewriteResult struct {
	Text    string        `json:"text"`
	Changed bool          `json:"changed"`
	Gate    string        `json:"gate"`    // "" unless a gate rejected the draft
	Reason  string        `json:"reason"`  // the model's one-sentence reason
	Draft   string        `json:"draft"`   // the rejected rewrite, when a gate rejected one
	Dropped []DroppedSpan `json:"dropped"` // what the draft left out; empty when the input came back unchanged
}

// DroppedSpan is a span of the input the draft left out. Why is tag, history, restatesCode or trivia.
type DroppedSpan struct {
	Text string `json:"text"`
	Why  string `json:"why"`
}

type rewriteWire struct {
	Text    string `json:"text"`
	Context string `json:"context,omitempty"`
}

// rewriteDraft is one rewrite call's output; CostUSD is valid even alongside an error.
type rewriteDraft struct {
	Text, Reason string
	Dropped      []DroppedSpan
	CostUSD      float64
}

// Rewrite runs the one rewrite call: no tools, structured output. An empty text is unusable output.
func (a ModelAgent) Rewrite(ctx context.Context, text, code string) (rewriteDraft, error) {
	input, err := json.Marshal(rewriteWire{Text: text, Context: code})
	if err != nil {
		return rewriteDraft{}, err
	}
	res, err := a.Runner.RunResult(ctx, memory.Call{
		System: llmprompts.MemoryRewriteSystem.Text(a.prompts(), llmprompts.RewriteVars{MaxWidth: RewriteWidth}),
		Input:  string(input), Schema: llmprompts.MemoryRewriteSystem.Schema(),
		Timeout: rewriteTimeout, Budget: rewriteBudget,
	})
	out := rewriteDraft{CostUSD: res.CostUSD}
	if err != nil {
		return out, err
	}
	var parsed struct {
		Text    string        `json:"text"`
		Dropped []DroppedSpan `json:"dropped"`
		Reason  string        `json:"reason"`
	}
	if err := json.Unmarshal(res.Output, &parsed); err != nil || strings.TrimSpace(parsed.Text) == "" {
		return out, a.Runner.Fail(harness.ErrOutput)
	}
	out.Text, out.Dropped, out.Reason = parsed.Text, parsed.Dropped, parsed.Reason
	return out, nil
}

// rewrite is the single-call path for short text: one rewrite (retried once on unusable output),
// mechanical gates. A rejected draft keeps the original.
func (d Distiller) rewrite(ctx context.Context, req DistillRequest) (DistillResult, error) {
	run := &distillRun{progress: req.Progress}
	agent := ModelAgent{Runner: d.Runner, Prompts: d.Prompts}
	res := DistillResult{Mode: ModeRewrite, InRunes: utf8.RuneCountInString(req.Text)}
	finish := func(err error) (DistillResult, error) {
		res.CostUSD = run.spent
		if res.Rewrite != nil {
			res.OutRunes = utf8.RuneCountInString(res.Rewrite.Text)
		}
		return res, err
	}
	kept := func(gate string, draft rewriteDraft) *RewriteResult {
		return &RewriteResult{Text: req.Text, Gate: gate, Reason: draft.Reason, Draft: draft.Text, Dropped: nonNilDropped(draft.Dropped)}
	}

	run.report(StageRewrite, 0, 1)
	var draft rewriteDraft
	usable := false
	for range 2 {
		out, err := agent.Rewrite(ctx, req.Text, req.Context)
		run.charge(out.CostUSD)
		if errors.Is(err, harness.ErrOutput) {
			continue
		}
		if err != nil {
			return finish(err)
		}
		draft, usable = out, true
		break
	}
	run.report(StageRewrite, 1, 1)
	if !usable {
		res.Rewrite = &RewriteResult{Text: req.Text, Gate: GateOutput, Dropped: []DroppedSpan{}}
		return finish(nil)
	}
	if draft.Text == req.Text {
		res.Rewrite = &RewriteResult{Text: req.Text, Reason: draft.Reason, Dropped: []DroppedSpan{}}
		return finish(nil)
	}
	if gate := gateDraft(req.Text, draft.Text, draft.Dropped); gate != "" {
		res.Rewrite = kept(gate, draft)
		return finish(nil)
	}
	res.Rewrite = &RewriteResult{Text: draft.Text, Changed: true, Reason: draft.Reason, Dropped: nonNilDropped(draft.Dropped)}
	return finish(nil)
}

func nonNilDropped(d []DroppedSpan) []DroppedSpan {
	if d == nil {
		return []DroppedSpan{}
	}
	return d
}
