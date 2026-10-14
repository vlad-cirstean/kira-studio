package importer

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
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
	MaxDistillRunes  = 120_000
	maxDistillChunks = 16
	// distillSpendCapUSD stops a call from starting new chunks once the reported spend reaches it.
	distillSpendCapUSD = 2.00
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
}

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
		return DistillResult{}, invalid("input is %d characters, the limit is %d", in, MaxDistillRunes)
	}
	chunks, _, err := chunkFile(kind, text, rel, DefaultBudget)
	if err != nil {
		return DistillResult{}, invalid("cannot read the input as %s: %v", kind, err)
	}
	if len(chunks) > maxDistillChunks {
		return DistillResult{}, invalid("input splits into %d parts, the limit is %d", len(chunks), maxDistillChunks)
	}
	prompts := d.Prompts
	if prompts == nil {
		prompts = llmprompts.Defaults()
	}

	var mu sync.Mutex
	var spent float64
	capped := false
	results := make([][]DistillLine, len(chunks))
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(distillWorkers)
	for i, c := range chunks {
		g.Go(func() error {
			mu.Lock()
			stop := spent >= distillSpendCapUSD
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
			return nil
		})
	}
	err = g.Wait()
	res := DistillResult{CostUSD: spent, Chunks: len(chunks), InRunes: in}
	switch {
	case err != nil:
		return res, err
	case capped:
		return res, fmt.Errorf("distill stopped at its spend cap: %.2f USD spent, %.2f USD allowed", spent, distillSpendCapUSD)
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
		return "", "", "", invalid("cannot read %s: %v", req.Path, err)
	case skip != "":
		return "", "", "", invalid("cannot distill %s: %s", req.Path, skip)
	}
	kind, ok := kindOf(req.Path)
	if !ok {
		kind = KindText
	}
	return text, kind, filepath.Base(req.Path), nil
}
