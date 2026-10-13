package importer

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/internal/llmprompts"
	"github.com/kirathecat/kira-studio/internal/memory"
)

// Cross-check verdicts.
const (
	VerdictConfirmed   = "confirmed"
	VerdictRewritten   = "rewritten"
	VerdictUnsupported = "unsupported"
	VerdictAmbiguous   = "ambiguous"
)

const (
	verifyBatch       = 40
	verifyBaseTimeout = 120 * time.Second
	verifyFactTime    = 10 * time.Second
	verifyMaxTimeout  = 10 * time.Minute
	verifyBaseBudget  = 0.30
	verifyFactBudget  = 0.03
	verifyMaxBudget   = 2.00
	verifyBaseTurns   = 3
	verifyMaxTurns    = 20
)

// Verdict is the cross-check's judgement of one questionable fact. Fact and Evidence are set for a
// rewrite and, for Evidence, a confirmation.
type Verdict struct {
	Verdict  string `json:"verdict"`
	Fact     string `json:"fact"`
	Evidence string `json:"evidence"`
	Why      string `json:"why"`
}

// VerifyFact is a questionable fact sent to the cross-check.
type VerifyFact struct {
	ID         string `json:"id"`
	Fact       string `json:"fact"`
	Evidence   string `json:"evidence"`
	Section    string `json:"section"`
	Unresolved string `json:"unresolved,omitempty"`
}

type VerifyInput struct {
	Path, Title string
	// Source is the file's content; the call reads a copy of it named source<ext>.
	Source []byte
	Ext    string
	Facts  []VerifyFact
}

// VerifyOutput.CostUSD is valid even alongside an error.
type VerifyOutput struct {
	Verdicts map[string]Verdict
	CostUSD  float64
}

// Questionable reports whether a fact needs the cross-check: the extractor doubted it, or its quote
// is not in the chunk (whitespace and case aside), which catches an invented quote.
func Questionable(chunkText string, f Fact) bool {
	return questionableIn(normalizeQuote(chunkText), f)
}

// questionableIn is Questionable over chunk text already passed through normalizeQuote.
func questionableIn(normChunk string, f Fact) bool {
	if f.Unresolved != "" {
		return true
	}
	ev := normalizeQuote(f.Evidence)
	return ev == "" || !strings.Contains(normChunk, ev)
}

func normalizeQuote(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(s), " "))
}

func verifyLimits(facts int) (time.Duration, string, int) {
	timeout := min(verifyBaseTimeout+time.Duration(facts)*verifyFactTime, verifyMaxTimeout)
	budget := min(verifyBaseBudget+verifyFactBudget*float64(facts), verifyMaxBudget)
	return timeout, fmt.Sprintf("%.2f", budget), min(verifyBaseTurns+facts/4, verifyMaxTurns)
}

type verifyDoc struct {
	Path   string `json:"path"`
	Title  string `json:"title"`
	Source string `json:"source"`
}

type verifyWire struct {
	Document verifyDoc    `json:"document"`
	Facts    []VerifyFact `json:"facts"`
}

// Verify judges the facts against a copy of the source in an otherwise empty working dir, with
// only Read and Grep.
func (a ClaudeAgent) Verify(ctx context.Context, in VerifyInput) (VerifyOutput, error) {
	source := "source" + strings.ToLower(filepath.Ext(in.Path))
	input, err := json.Marshal(verifyWire{Document: verifyDoc{Path: in.Path, Title: in.Title, Source: source}, Facts: in.Facts})
	if err != nil {
		return VerifyOutput{}, err
	}
	timeout, budget, turns := verifyLimits(len(in.Facts))
	res, err := a.Runner.RunResult(ctx, memory.Call{
		System: llmprompts.MemoryImportVerifySystem.Text(a.prompts(), llmprompts.VerifyVars{MaxFacts: verifyBatch}),
		Input:  string(input), Schema: llmprompts.MemoryImportVerifySystem.Schema(),
		Tools: []string{"Read", "Grep"}, Files: map[string][]byte{source: in.Source}, MaxTurns: turns,
		Timeout: timeout, Budget: budget,
	})
	out := VerifyOutput{CostUSD: res.CostUSD}
	if err != nil {
		return out, err
	}
	var parsed struct {
		Verdicts []struct {
			ID string `json:"id"`
			Verdict
		}
	}
	if err := json.Unmarshal(res.Output, &parsed); err != nil {
		return out, memory.ErrClaudeOutput
	}
	asked := map[string]bool{}
	for _, f := range in.Facts {
		asked[f.ID] = true
	}
	out.Verdicts = map[string]Verdict{}
	for _, v := range parsed.Verdicts {
		switch v.Verdict.Verdict {
		case VerdictConfirmed, VerdictRewritten, VerdictUnsupported, VerdictAmbiguous:
		default:
			continue
		}
		if asked[v.ID] {
			out.Verdicts[v.ID] = Verdict{Verdict: v.Verdict.Verdict, Fact: truncateRunes(strings.TrimSpace(v.Fact), memory.MaxFactLen),
				Evidence: truncateRunes(strings.TrimSpace(v.Evidence), maxEvidenceLen), Why: truncateRunes(strings.TrimSpace(v.Why), 300)}
		}
	}
	if len(out.Verdicts) == 0 {
		return out, memory.ErrClaudeOutput
	}
	return out, nil
}
