package importer

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

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
	Check   *RewriteCheck `json:"check"`   // nil unless the check ran and gave a verdict
}

// DroppedSpan is a span of the input the draft left out. Why is tag, history, restatesCode or trivia.
type DroppedSpan struct {
	Text string `json:"text"`
	Why  string `json:"why"`
}

// RewriteCheck is the second call's verdict on a draft.
type RewriteCheck struct {
	OK    bool     `json:"ok"`
	Lost  []string `json:"lost"`
	Wrong []string `json:"wrong"`
}

type rewriteWire struct {
	Text    string `json:"text"`
	Context string `json:"context,omitempty"`
}

type checkWire struct {
	Original string `json:"original"`
	Rewrite  string `json:"rewrite"`
	Context  string `json:"context,omitempty"`
}

// rewriteDraft is one rewrite call's output; CostUSD is valid even alongside an error.
type rewriteDraft struct {
	Text, Reason string
	Dropped      []DroppedSpan
	CostUSD      float64
}

// Rewrite runs the one rewrite call: no tools, structured output. An empty text is unusable output.
func (a ClaudeAgent) Rewrite(ctx context.Context, text, code string) (rewriteDraft, error) {
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
		return out, memory.ErrClaudeOutput
	}
	out.Text, out.Dropped, out.Reason = parsed.Text, parsed.Dropped, parsed.Reason
	return out, nil
}

// CheckRewrite asks whether the draft kept every fact of the original.
func (a ClaudeAgent) CheckRewrite(ctx context.Context, original, draft, code string) (RewriteCheck, float64, error) {
	input, err := json.Marshal(checkWire{Original: original, Rewrite: draft, Context: code})
	if err != nil {
		return RewriteCheck{}, 0, err
	}
	res, err := a.Runner.RunResult(ctx, memory.Call{
		System: llmprompts.MemoryRewriteCheckSystem.Text(a.prompts(), llmprompts.NoVars{}),
		Input:  string(input), Schema: llmprompts.MemoryRewriteCheckSystem.Schema(),
		Timeout: rewriteTimeout, Budget: rewriteBudget,
	})
	if err != nil {
		return RewriteCheck{}, res.CostUSD, err
	}
	var check RewriteCheck
	if err := json.Unmarshal(res.Output, &check); err != nil {
		return RewriteCheck{}, res.CostUSD, memory.ErrClaudeOutput
	}
	check.Lost, check.Wrong = nonNilStrings(check.Lost), nonNilStrings(check.Wrong)
	return check, res.CostUSD, nil
}

// rewrite is the single-call path for short text: one rewrite (retried once on unusable output),
// mechanical gates, and an optional check call. A rejected draft keeps the original.
func (d Distiller) rewrite(ctx context.Context, req DistillRequest) (DistillResult, error) {
	run := &distillRun{progress: req.Progress}
	agent := ClaudeAgent{Runner: d.Runner, Prompts: d.Prompts}
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

	if !needsRewrite(req.Text) {
		res.Rewrite = &RewriteResult{Text: req.Text, Dropped: []DroppedSpan{}}
		return finish(nil)
	}

	run.report(StageRewrite, 0, 1)
	var draft rewriteDraft
	usable := false
	for range 2 {
		out, err := agent.Rewrite(ctx, req.Text, req.Context)
		run.charge(out.CostUSD)
		if errors.Is(err, memory.ErrClaudeOutput) {
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
	if !req.Check {
		return finish(nil)
	}

	run.report(StageCheck, 0, 1)
	check, cost, err := agent.CheckRewrite(ctx, req.Text, draft.Text, req.Context)
	run.charge(cost)
	if err != nil && !errors.Is(err, memory.ErrClaudeOutput) {
		return finish(err)
	}
	run.report(StageCheck, 1, 1)
	if err != nil { // unusable verdict: no retry, keep the original
		res.Rewrite = kept(GateCheck, draft)
		return finish(nil)
	}
	if !check.OK {
		res.Rewrite = kept(GateCheck, draft)
	}
	res.Rewrite.Check = &check
	return finish(nil)
}

func nonNilDropped(d []DroppedSpan) []DroppedSpan {
	if d == nil {
		return []DroppedSpan{}
	}
	return d
}

func nonNilStrings(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
