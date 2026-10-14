package importer

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode"

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

// Verdict is the cross-check's judgement of one questionable fact. Fact is set for a rewrite.
type Verdict struct {
	Verdict string `json:"verdict"`
	Fact    string `json:"fact"`
	Why     string `json:"why"`
}

// VerifyFact is a questionable fact sent to the cross-check.
type VerifyFact struct {
	ID         string `json:"id"`
	Fact       string `json:"fact"`
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

// Questionable reports whether a fact needs the cross-check: the distiller doubted it, or one of
// its salient tokens (see salientTokens) is missing from the chunk text, which catches an invented
// claim. chunkText is the chunk plus the context the distiller saw.
func Questionable(chunkText string, f Fact) bool {
	return questionableIn(normalizeQuote(chunkText), f)
}

// questionableIn is Questionable over chunk text already passed through normalizeQuote.
func questionableIn(normChunk string, f Fact) bool {
	if f.Unresolved != "" {
		return true
	}
	for _, tok := range salientTokens(f.Fact) {
		if !strings.Contains(normChunk, normalizeQuote(tok)) {
			return true
		}
	}
	return false
}

var quotedSpan = regexp.MustCompile("`([^`]+)`|\"([^\"]+)\"")

// salientTokens lists what a distortion changes: backticked and double-quoted spans, and words
// holding a digit, `_`, `::`, a `/` or `.` between letters, or an inner capital (camelCase, PascalCase).
func salientTokens(fact string) []string {
	var out []string
	for _, m := range quotedSpan.FindAllStringSubmatch(fact, -1) {
		out = append(out, m[1]+m[2])
	}
	for _, w := range strings.Fields(quotedSpan.ReplaceAllString(fact, " ")) {
		w = strings.Trim(w, ".,;:!?()[]{}\"'`*")
		if w != "" && salientWord(w) {
			out = append(out, w)
		}
	}
	return out
}

func salientWord(w string) bool {
	if strings.ContainsAny(w, "_0123456789") || strings.Contains(w, "::") {
		return true
	}
	rs := []rune(w)
	for i := 1; i+1 < len(rs); i++ {
		switch {
		case (rs[i] == '/' || rs[i] == '.') && unicode.IsLetter(rs[i-1]) && unicode.IsLetter(rs[i+1]):
			return true
		case unicode.IsUpper(rs[i]) && unicode.IsLetter(rs[i-1]) && !unicode.IsUpper(rs[i-1]):
			return true
		}
	}
	return len(rs) > 1 && unicode.IsUpper(rs[len(rs)-1]) && unicode.IsLower(rs[len(rs)-2])
}

func normalizeQuote(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(s), " "))
}

func truncateRunes(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
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
				Why: truncateRunes(strings.TrimSpace(v.Why), 300)}
		}
	}
	if len(out.Verdicts) == 0 {
		return out, memory.ErrClaudeOutput
	}
	return out, nil
}
