package importer

import (
	"context"
	"fmt"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"

	"golang.org/x/sync/errgroup"

	"github.com/kirathecat/kira-studio/internal/llmprompts"
	"github.com/kirathecat/kira-studio/internal/memory"
)

const (
	// MaxDistillRunes bounds one distill call's input (about 40 000 estimated tokens).
	MaxDistillRunes = 120_000
	// MaxDistillChunks bounds the parts one distill call splits into.
	MaxDistillChunks = 16
	// DistillSpendCapUSD stops a call from starting new work once the reported spend reaches it.
	DistillSpendCapUSD = 2.00
	distillWorkers     = 3

	// distillText is the source name of pasted text.
	distillText = "text.md"

	// RewriteMaxRunes bounds the text of one rewrite call.
	RewriteMaxRunes = 2000
	// RewriteMaxContextRunes bounds the read-only code around the text.
	RewriteMaxContextRunes = 6000
	// RewriteWidth is the column limit the rewrite prompt and the width gate share.
	RewriteWidth = 100
)

// Distill modes: facts merges lines, rewrite cleans one short text in its own form.
const (
	ModeFacts   = "facts"
	ModeRewrite = "rewrite"
)

// DistillRequest is text or one absolute file path, never both.
type DistillRequest struct {
	Text string
	Path string
	// Mode is ModeFacts (or empty) or ModeRewrite. Rewrite takes text only.
	Mode string
	// Context is read-only code around the text; rewrite only.
	Context string
	// Check adds a second call that checks the rewrite kept every fact; rewrite only.
	Check bool
	// Progress, when set, is called when a stage starts (Done 0) and after each finished step of it. It
	// runs under the call's lock and must return quickly.
	Progress func(DistillProgress)
}

// Distill stages, in order.
const (
	StageExtract = "extract"
	StageVerify  = "verify"
	StageMerge   = "merge"
	StageRewrite = "rewrite"
	StageCheck   = "check"
)

// DistillProgress is the steps finished so far in a stage (parts, cross-check batches, the one merge)
// and the spend reported so far.
type DistillProgress struct {
	Stage       string
	Done, Total int
	CostUSD     float64
}

// Reasons a DistillError carries; each maps to one UI message.
const (
	ReasonTooLong      = "tooLong"
	ReasonTooManyParts = "tooManyParts"
	ReasonTooManyFacts = "tooManyFacts"
	ReasonUnreadable   = "unreadable"
	ReasonSpendCap     = "spendCap"
)

// DistillError is a refused or capped distill call. Error is the English text MCP clients see; Reason
// and Vars let the UI pick a catalog message without parsing it.
type DistillError struct {
	Reason string
	Vars   map[string]string
	msg    string
	wrap   error
}

func (e *DistillError) Error() string { return e.msg }
func (e *DistillError) Unwrap() error { return e.wrap }

// DistillResult is the merged lines in source order plus what the call cost and shrank. Unresolved
// lists facts the input leaves open; dropped facts are not returned. In rewrite mode Rewrite holds
// the outcome and Lines and Unresolved stay empty.
type DistillResult struct {
	Mode       string
	Rewrite    *RewriteResult
	Lines      []Line
	Unresolved []UnresolvedFact
	CostUSD    float64
	Chunks     int
	InRunes    int
	OutRunes   int
}

// Distiller condenses text or a file into short lines without touching the store. It runs the import
// pipeline (chunk, extract, cross-check, merge) and stops where import would store.
type Distiller struct {
	Runner  *memory.CLIRunner
	Prompts llmprompts.Source
}

func invalid(format string, a ...any) error {
	return fmt.Errorf("%w: %s", memory.ErrInvalid, fmt.Sprintf(format, a...))
}

func invalidReason(reason string, vars map[string]string, format string, a ...any) error {
	return &DistillError{Reason: reason, Vars: vars, msg: invalid(format, a...).Error(), wrap: memory.ErrInvalid}
}

// distillRun is the state of one Distill call shared by its stages.
type distillRun struct {
	agent    Agent
	progress func(DistillProgress)

	mu    sync.Mutex
	spent float64
}

func (r *distillRun) charge(cost float64) {
	r.mu.Lock()
	r.spent += cost
	r.mu.Unlock()
}

// capped reports whether the spend has reached the cap.
func (r *distillRun) capped() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.spent >= DistillSpendCapUSD
}

func (r *distillRun) capError() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return &DistillError{
		Reason: ReasonSpendCap,
		Vars:   map[string]string{"spent": fmt.Sprintf("%.2f", r.spent), "cap": fmt.Sprintf("%.2f", DistillSpendCapUSD)},
		msg:    fmt.Sprintf("distill stopped at its spend cap: %.2f USD spent, %.2f USD allowed", r.spent, DistillSpendCapUSD),
	}
}

func (r *distillRun) report(stage string, done, total int) {
	if r.progress == nil {
		return
	}
	r.mu.Lock()
	r.progress(DistillProgress{Stage: stage, Done: done, Total: total, CostUSD: r.spent})
	r.mu.Unlock()
}

// Distill chunks the input like an import and extracts facts from each part (three at once). Facts
// the extractor doubted go through the cross-check against the source, then one merge call joins
// duplicates across parts and returns the lines in source order. No stage starts once the spend
// reaches the per-call cap; the error then names the amount spent. A failed call is not retried.
func (d Distiller) Distill(ctx context.Context, req DistillRequest) (DistillResult, error) {
	switch req.Mode {
	case "", ModeFacts:
		if req.Context != "" || req.Check {
			return DistillResult{}, invalid("context and check need mode %s", ModeRewrite)
		}
	case ModeRewrite:
		return d.checkedRewrite(ctx, req)
	default:
		return DistillResult{}, invalid("unknown mode %q", req.Mode)
	}
	text, kind, rel, err := distillSource(req)
	if err != nil {
		return DistillResult{}, err
	}
	in := utf8.RuneCountInString(text)
	if in > MaxDistillRunes {
		return DistillResult{}, invalidReason(ReasonTooLong, map[string]string{"count": strconv.Itoa(in), "max": strconv.Itoa(MaxDistillRunes)},
			"input is %d characters, the limit is %d", in, MaxDistillRunes)
	}
	chunks, title, err := chunkFile(kind, text, rel, DefaultBudget)
	if err != nil {
		return DistillResult{}, invalidReason(ReasonUnreadable, map[string]string{"path": req.Path, "reason": err.Error()},
			"cannot read the input as %s: %v", kind, err)
	}
	if len(chunks) > MaxDistillChunks {
		return DistillResult{}, invalidReason(ReasonTooManyParts, map[string]string{"count": strconv.Itoa(len(chunks)), "max": strconv.Itoa(MaxDistillChunks)},
			"input splits into %d parts, the limit is %d", len(chunks), MaxDistillChunks)
	}
	run := &distillRun{agent: ClaudeAgent{Runner: d.Runner, Prompts: d.Prompts}, progress: req.Progress}
	res := DistillResult{Mode: ModeFacts, Chunks: len(chunks), InRunes: in}
	finish := func(err error) (DistillResult, error) {
		res.CostUSD = run.spent
		return res, err
	}

	facts, verify, err := run.extract(ctx, rel, title, chunks)
	if err != nil {
		return finish(err)
	}
	if len(facts) == 0 {
		return finish(nil)
	}
	if tooManyFacts(facts) {
		return finish(invalidReason(ReasonTooManyFacts, nil, "the input yields too many facts for one merge; split it"))
	}
	verdicts, err := run.verify(ctx, rel, title, path.Ext(rel), text, verify)
	if err != nil {
		return finish(err)
	}
	kept, _ := applyVerdicts(facts, verdicts)
	if len(kept) == 0 {
		return finish(nil)
	}
	merged, err := run.merge(ctx, MergeInput{Path: rel, Title: title, ChunkCount: len(chunks), Facts: kept})
	if err != nil {
		return finish(err)
	}
	res.Lines, res.Unresolved = merged.Lines, merged.Unresolved
	for _, l := range res.Lines {
		res.OutRunes += utf8.RuneCountInString(l.Text)
	}
	return finish(nil)
}

// checkedRewrite validates a rewrite request, then runs it.
func (d Distiller) checkedRewrite(ctx context.Context, req DistillRequest) (DistillResult, error) {
	if req.Path != "" {
		return DistillResult{}, invalid("mode %s takes text, not a path", ModeRewrite)
	}
	if strings.TrimSpace(req.Text) == "" {
		return DistillResult{}, invalid("give text to rewrite")
	}
	if n := utf8.RuneCountInString(req.Text); n > RewriteMaxRunes {
		return DistillResult{}, invalidReason(ReasonTooLong, map[string]string{"count": strconv.Itoa(n), "max": strconv.Itoa(RewriteMaxRunes)},
			"input is %d characters, the limit is %d", n, RewriteMaxRunes)
	}
	if n := utf8.RuneCountInString(req.Context); n > RewriteMaxContextRunes {
		return DistillResult{}, invalid("context is %d characters, the limit is %d", n, RewriteMaxContextRunes)
	}
	return d.rewrite(ctx, req)
}

// extract runs the extract prompt over every part, three at once, and returns the facts in document
// order plus the questionable ones for the cross-check.
func (r *distillRun) extract(ctx context.Context, rel, title string, chunks []Chunk) ([]FinalFact, []VerifyFact, error) {
	r.report(StageExtract, 0, len(chunks))
	results := make([][]Fact, len(chunks))
	var done int
	capped := false
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(distillWorkers)
	for i, c := range chunks {
		g.Go(func() error {
			if r.capped() {
				r.mu.Lock()
				capped = true
				r.mu.Unlock()
				return nil
			}
			out, err := r.agent.Extract(gctx, ExtractInput{Path: rel, Title: title, Index: i, Count: len(chunks),
				HeadingPath: c.HeadingPath, Context: c.Context, Text: c.Text})
			r.charge(out.CostUSD)
			if err != nil {
				return err
			}
			results[i] = out.Facts
			r.mu.Lock()
			done++
			n := done
			r.mu.Unlock()
			r.report(StageExtract, n, len(chunks))
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return nil, nil, err
	}
	if capped {
		return nil, nil, r.capError()
	}
	var facts []FinalFact
	var verify []VerifyFact
	for i, c := range chunks {
		ffs, vs := chunkFinalFacts(rel, i, c.HeadingPath, c.Text, results[i])
		facts, verify = append(facts, ffs...), append(verify, vs...)
	}
	return facts, verify, nil
}

// verify cross-checks the questionable facts against the source, one batch at a time, and returns a
// verdict per fact (ambiguous when the cross-check returned none).
func (r *distillRun) verify(ctx context.Context, rel, title, ext, text string, facts []VerifyFact) (map[string]Verdict, error) {
	verdicts := map[string]Verdict{}
	if len(facts) == 0 {
		return verdicts, nil
	}
	batches := (len(facts) + verifyBatch - 1) / verifyBatch
	r.report(StageVerify, 0, batches)
	for n := range batches {
		if r.capped() {
			return nil, r.capError()
		}
		batch := facts[n*verifyBatch : min((n+1)*verifyBatch, len(facts))]
		out, err := r.agent.Verify(ctx, VerifyInput{Path: rel, Title: title, Source: []byte(text), Ext: ext, Facts: batch})
		r.charge(out.CostUSD)
		if err != nil {
			return nil, err
		}
		for id, v := range batchVerdicts(batch, out) {
			verdicts[id] = v
		}
		r.report(StageVerify, n+1, batches)
	}
	return verdicts, nil
}

// merge runs the one merge call.
func (r *distillRun) merge(ctx context.Context, in MergeInput) (MergeOutput, error) {
	if r.capped() {
		return MergeOutput{}, r.capError()
	}
	r.report(StageMerge, 0, 1)
	out, err := r.agent.Merge(ctx, in)
	r.charge(out.CostUSD)
	if err != nil {
		return MergeOutput{}, err
	}
	r.report(StageMerge, 1, 1)
	return out, nil
}

// distillSource is the text to chunk, its chunking kind and the name shown to the model as source.
func distillSource(req DistillRequest) (text, kind, rel string, err error) {
	hasText, hasPath := strings.TrimSpace(req.Text) != "", req.Path != ""
	switch {
	case hasText == hasPath:
		return "", "", "", invalid("give exactly one of text and path")
	case hasText:
		return req.Text, KindMarkdown, distillText, nil
	case !filepath.IsAbs(req.Path):
		return "", "", "", invalid("path must be absolute")
	}
	text, _, skip, err := ReadText(req.Path, DefaultCaps.MaxFileBytes)
	switch {
	case err != nil:
		return "", "", "", invalidReason(ReasonUnreadable, map[string]string{"path": req.Path, "reason": err.Error()},
			"cannot read %s: %v", req.Path, err)
	case skip != "":
		return "", "", "", invalidReason(ReasonUnreadable, map[string]string{"path": req.Path, "reason": skip},
			"cannot distill %s: %s", req.Path, skip)
	}
	kind, ok := kindOf(req.Path)
	if !ok {
		kind = KindText
	}
	return text, kind, filepath.Base(req.Path), nil
}
