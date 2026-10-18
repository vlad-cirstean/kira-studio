package importer

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/kirathecat/kira-studio/internal/llmprompts"
	"github.com/kirathecat/kira-studio/internal/memory"
)

const (
	mergeBaseTimeout = 120 * time.Second
	mergeBatchTime   = 30 * time.Second
	mergeMaxTimeout  = 10 * time.Minute
	mergeBaseBudget  = 0.20
	mergeBatchBudget = 0.05
	mergeMaxBudget   = 1.00

	// maxMergeLines is the most lines one merge returns: every part at its fact cap.
	maxMergeLines = MaxDistillChunks * maxFactsPerChunk
)

// Line is one merged line: a short plain text and whether it states a fact or a rule.
type Line struct {
	Text string `json:"text"`
	Kind string `json:"kind"`
}

// MergeInput is the facts extracted from one input, in document order.
type MergeInput struct {
	Path, Title string
	ChunkCount  int
	Facts       []FinalFact
}

// MergeOutput.CostUSD is valid even alongside an error.
type MergeOutput struct {
	Lines      []Line
	Unresolved []UnresolvedFact
	Dropped    []DroppedFact
	CostUSD    float64
}

type mergeFact struct {
	ID         string `json:"id"`
	Chunk      int    `json:"chunk"`
	Section    string `json:"section"`
	Evidence   string `json:"evidence"`
	Fact       string `json:"fact"`
	Unresolved string `json:"unresolved,omitempty"`
}

type mergeWire struct {
	Document finalizeDoc `json:"document"`
	Facts    []mergeFact `json:"facts"`
}

func mergeLimits(facts int) (time.Duration, string) {
	batches := math.Ceil(float64(facts) / factsPerBatch)
	timeout := min(mergeBaseTimeout+time.Duration(batches)*mergeBatchTime, mergeMaxTimeout)
	budget := min(mergeBaseBudget+mergeBatchBudget*batches, mergeMaxBudget)
	return timeout, fmt.Sprintf("%.2f", budget)
}

// Merge runs the no-store half of import's finalize: one call, no tools, that merges duplicates across
// parts, resolves unresolved facts and returns short lines. It never reads the store.
func (a ClaudeAgent) Merge(ctx context.Context, in MergeInput) (MergeOutput, error) {
	wire := mergeWire{Document: finalizeDoc{Path: in.Path, Title: in.Title, Chunks: in.ChunkCount}}
	for _, f := range in.Facts {
		wire.Facts = append(wire.Facts, mergeFact{ID: f.ID, Chunk: f.Chunk, Section: f.Section, Evidence: f.Evidence, Fact: f.Fact.Fact, Unresolved: f.Unresolved})
	}
	input, err := json.Marshal(wire)
	if err != nil {
		return MergeOutput{}, err
	}
	timeout, budget := mergeLimits(len(in.Facts))
	res, err := a.Runner.RunResult(ctx, memory.Call{
		System: llmprompts.MemoryMergeSystem.Text(a.prompts(), llmprompts.MergeVars{MaxLines: maxMergeLines}),
		Input:  string(input), Schema: llmprompts.MemoryMergeSystem.Schema(),
		Timeout: timeout, Budget: budget,
	})
	out := MergeOutput{CostUSD: res.CostUSD}
	if err != nil {
		return out, err
	}
	var parsed struct {
		Lines      []Line
		Unresolved []UnresolvedFact
		Dropped    []DroppedFact
	}
	if err := json.Unmarshal(res.Output, &parsed); err != nil {
		return out, memory.ErrClaudeOutput
	}
	out.Lines, out.Unresolved, out.Dropped = cleanLines(parsed.Lines), parsed.Unresolved, parsed.Dropped
	return out, nil
}

// cleanLines trims, folds line breaks, drops empty and over-long lines and lines of an unknown kind
// (an empty kind means fact), and caps the count.
func cleanLines(in []Line) []Line {
	out := make([]Line, 0, len(in))
	for _, l := range in {
		l.Text = strings.TrimSpace(strings.NewReplacer("\r\n", " ", "\n", " ", "\r", " ").Replace(l.Text))
		if n := utf8.RuneCountInString(l.Text); n == 0 || n > memory.MaxFactLen {
			continue
		}
		switch l.Kind {
		case "":
			l.Kind = memory.KindFact
		case memory.KindFact, memory.KindRule:
		default:
			continue
		}
		out = append(out, l)
		if len(out) == maxMergeLines {
			break
		}
	}
	return out
}
