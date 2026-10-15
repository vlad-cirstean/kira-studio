package importer

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"golang.org/x/sync/errgroup"

	"github.com/kirathecat/kira-studio/internal/llmprompts"
	"github.com/kirathecat/kira-studio/internal/memory"
)

// Distill modes.
const (
	ModeFacts        = "facts"
	ModeInstructions = "instructions"
)

const (
	maxLinesPerChunk = 40
	distillTimeout   = 180 * time.Second
	distillBudget    = "0.50"

	// MaxDistillRunes bounds one distill call's input (about 40 000 estimated tokens).
	MaxDistillRunes = 120_000
	// MaxDistillChunks bounds the parts one distill call splits into.
	MaxDistillChunks = 16
	// DistillSpendCapUSD stops a call from starting new chunks once the reported spend reaches it.
	DistillSpendCapUSD = 2.00
	distillWorkers     = 3
)

// DistillInput is one distill call: a chunk of text.
type DistillInput struct {
	Source, Section, Context, Text string
	Instructions                   bool
}

// DistillLine is one distilled line. Unresolved names what the text leaves open; empty when none.
type DistillLine struct {
	Text       string `json:"text"`
	Unresolved string `json:"unresolved"`
}

// DistillOutput.CostUSD is valid even alongside an error.
type DistillOutput struct {
	Lines   []DistillLine
	CostUSD float64
}

type distillWire struct {
	Source  string `json:"source,omitempty"`
	Section string `json:"section,omitempty"`
	Context string `json:"context,omitempty"`
	Text    string `json:"text"`
}

// distillCall runs the distill prompt over one chunk. It is the one core import and the MCP tool share.
func distillCall(ctx context.Context, runner *memory.CLIRunner, prompts llmprompts.Source, in DistillInput) (DistillOutput, error) {
	input, err := json.Marshal(distillWire{Source: in.Source, Section: in.Section, Context: in.Context, Text: in.Text})
	if err != nil {
		return DistillOutput{}, err
	}
	res, err := runner.RunResult(ctx, memory.Call{
		System: llmprompts.MemoryDistillSystem.Text(prompts, llmprompts.DistillVars{MaxLines: maxLinesPerChunk, Instructions: in.Instructions}),
		Input:  string(input), Schema: llmprompts.MemoryDistillSystem.Schema(),
		Timeout: distillTimeout, Budget: distillBudget,
	})
	out := DistillOutput{CostUSD: res.CostUSD}
	if err != nil {
		return out, err
	}
	var parsed struct{ Lines []DistillLine }
	if err := json.Unmarshal(res.Output, &parsed); err != nil {
		return out, memory.ErrClaudeOutput
	}
	out.Lines = cleanLines(parsed.Lines)
	return out, nil
}

// cleanLines trims, folds line breaks, drops empty and over-long lines and caps the count.
func cleanLines(in []DistillLine) []DistillLine {
	out := make([]DistillLine, 0, len(in))
	for _, l := range in {
		l.Text = strings.TrimSpace(strings.NewReplacer("\r\n", " ", "\n", " ", "\r", " ").Replace(l.Text))
		if n := utf8.RuneCountInString(l.Text); n == 0 || n > memory.MaxFactLen {
			continue
		}
		l.Unresolved = strings.TrimSpace(l.Unresolved)
		out = append(out, l)
		if len(out) == maxLinesPerChunk {
			break
		}
	}
	return out
}

// DistillRequest is text or one absolute file path, never both.
type DistillRequest struct {
	Text string
	Path string
	// Mode is ModeFacts (default) or ModeInstructions.
	Mode string
	// Progress, when set, is called with Done 0 after chunking and once per finished chunk. It runs
	// under the call's lock and must return quickly.
	Progress func(DistillProgress)
}

// DistillProgress is the parts finished so far and the spend they reported.
type DistillProgress struct {
	Done, Total int
	CostUSD     float64
}

// Reasons a DistillError carries; each maps to one UI message.
const (
	ReasonTooLong      = "tooLong"
	ReasonTooManyParts = "tooManyParts"
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

// DistillResult is the distilled lines in source order plus what the call cost and shrank.
type DistillResult struct {
	Lines    []string
	CostUSD  float64
	Chunks   int
	InRunes  int
	OutRunes int
}

// Distiller condenses text or a file into terse atomic lines without touching the store.
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

// Distill chunks the input like an import, distills each chunk (three at once) and joins the lines in
// source order. It starts no chunk once the spend reaches the per-call cap; the error then names the
// amount spent.
func (d Distiller) Distill(ctx context.Context, req DistillRequest) (DistillResult, error) {
	instructions, err := distillMode(req.Mode)
	if err != nil {
		return DistillResult{}, err
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
	chunks, _, err := chunkFile(kind, text, rel, DefaultBudget)
	if err != nil {
		return DistillResult{}, invalidReason(ReasonUnreadable, map[string]string{"path": req.Path, "reason": err.Error()},
			"cannot read the input as %s: %v", kind, err)
	}
	if len(chunks) > MaxDistillChunks {
		return DistillResult{}, invalidReason(ReasonTooManyParts, map[string]string{"count": strconv.Itoa(len(chunks)), "max": strconv.Itoa(MaxDistillChunks)},
			"input splits into %d parts, the limit is %d", len(chunks), MaxDistillChunks)
	}
	prompts := d.Prompts
	if prompts == nil {
		prompts = llmprompts.Defaults()
	}

	var mu sync.Mutex
	var spent float64
	done := 0
	capped := false
	if req.Progress != nil {
		req.Progress(DistillProgress{Total: len(chunks)})
	}
	results := make([][]DistillLine, len(chunks))
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(distillWorkers)
	for i, c := range chunks {
		g.Go(func() error {
			mu.Lock()
			stop := spent >= DistillSpendCapUSD
			if stop {
				capped = true
			}
			mu.Unlock()
			if stop {
				return nil
			}
			out, err := distillCall(gctx, d.Runner, prompts, DistillInput{Source: rel, Section: c.HeadingPath, Context: c.Context, Text: c.Text, Instructions: instructions})
			mu.Lock()
			spent += out.CostUSD
			mu.Unlock()
			if err != nil {
				return err
			}
			results[i] = out.Lines
			if req.Progress != nil {
				mu.Lock()
				done++
				req.Progress(DistillProgress{Done: done, Total: len(chunks), CostUSD: spent})
				mu.Unlock()
			}
			return nil
		})
	}
	err = g.Wait()
	res := DistillResult{CostUSD: spent, Chunks: len(chunks), InRunes: in}
	switch {
	case err != nil:
		return res, err
	case capped:
		return res, &DistillError{
			Reason: ReasonSpendCap,
			Vars:   map[string]string{"spent": fmt.Sprintf("%.2f", spent), "cap": fmt.Sprintf("%.2f", DistillSpendCapUSD)},
			msg:    fmt.Sprintf("distill stopped at its spend cap: %.2f USD spent, %.2f USD allowed", spent, DistillSpendCapUSD),
		}
	}
	for _, lines := range results {
		for _, l := range lines {
			res.Lines = append(res.Lines, l.Text)
			res.OutRunes += utf8.RuneCountInString(l.Text)
		}
	}
	return res, nil
}

func distillMode(mode string) (instructions bool, err error) {
	switch mode {
	case "", ModeFacts:
		return false, nil
	case ModeInstructions:
		return true, nil
	}
	return false, invalid("mode must be %s or %s", ModeFacts, ModeInstructions)
}

// distillSource is the text to chunk, its chunking kind and the name shown to the model as source.
func distillSource(req DistillRequest) (text, kind, rel string, err error) {
	hasText, hasPath := strings.TrimSpace(req.Text) != "", req.Path != ""
	switch {
	case hasText == hasPath:
		return "", "", "", invalid("give exactly one of text and path")
	case hasText:
		return req.Text, KindMarkdown, "", nil
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
