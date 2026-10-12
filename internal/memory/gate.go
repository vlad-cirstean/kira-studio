package memory

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/kirathecat/kira-studio/internal/llmprompts"
)

type gateInput struct {
	Items          []gateInputItem `json:"items"`
	Clarifications []gateClarify   `json:"clarifications,omitempty"`
	Related        []gateRelated   `json:"relatedMemories"`
}

type gateInputItem struct {
	Index     int    `json:"index"`
	Fact      string `json:"fact"`
	Reason    string `json:"reason"`
	Origin    string `json:"origin"`
	SourceTag string `json:"sourceTag,omitempty"`
	Scope     string `json:"scope"`
}

type gateClarify struct {
	Question string `json:"question"`
	Answer   string `json:"answer"`
}

type gateRelated struct {
	Fact   string `json:"fact"`
	Reason string `json:"reason"`
}

type gateFact struct {
	Fact     string   `json:"fact"`
	Reason   string   `json:"reason"`
	Keywords []string `json:"keywords"`
}

type gateVerdict struct {
	Index     int        `json:"index"`
	Verdict   string     `json:"verdict"`
	Questions []string   `json:"questions"`
	Facts     []gateFact `json:"facts"`
}

const gateRelatedLimit = 10

func (s *Service) runGate(ctx context.Context, req StoreRequest) ([]gateVerdict, error) {
	in := gateInput{Related: []gateRelated{}}
	text := make([]string, 0, 2*len(req.Items))
	for i, it := range req.Items {
		in.Items = append(in.Items, gateInputItem{Index: i, Fact: it.Fact, Reason: it.Reason, Origin: it.Origin, SourceTag: it.SourceTag, Scope: it.Scope})
		text = append(text, it.Fact, it.Reason)
	}
	for _, c := range req.Clarifications {
		in.Clarifications = append(in.Clarifications, gateClarify(c))
	}
	related, err := s.Search(ctx, SearchArgs{Query: strings.Join(text, " "), Limit: gateRelatedLimit})
	if err != nil {
		return nil, err
	}
	for _, m := range related {
		in.Related = append(in.Related, gateRelated{Fact: m.Fact, Reason: m.Reason})
	}
	body, err := json.Marshal(in)
	if err != nil {
		return nil, fmt.Errorf("memory: encode gate input: %w", err)
	}
	raw, err := s.runner.Run(ctx, Call{System: llmprompts.MemoryGateSystem.Text(s.opts.Prompts, llmprompts.GateVars{MaxKeywords: MaxKeywords}), Input: string(body), Schema: llmprompts.MemoryGateSystem.Schema()})
	if err != nil {
		return nil, err
	}
	var out struct {
		Items []gateVerdict `json:"items"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("%w: gate: %v", ErrClaudeOutput, err)
	}
	return validateGate(len(req.Items), out.Items)
}

// validateGate enforces the contract in Go rather than trusting the model: every index answered
// exactly once, challenges carry questions, accepts carry in-limit facts.
func validateGate(n int, items []gateVerdict) ([]gateVerdict, error) {
	bad := func(format string, a ...any) error {
		return fmt.Errorf("%w: gate: %s", ErrClaudeOutput, fmt.Sprintf(format, a...))
	}
	byIndex := make([]*gateVerdict, n)
	for i := range items {
		v := &items[i]
		if v.Index < 0 || v.Index >= n || byIndex[v.Index] != nil {
			return nil, bad("item index %d out of range or answered twice", v.Index)
		}
		byIndex[v.Index] = v
		switch v.Verdict {
		case "challenge":
			v.Questions = trimAll(v.Questions)
			if len(v.Questions) == 0 {
				return nil, bad("challenge for item %d has no question", v.Index)
			}
		case "accept":
			if len(v.Facts) == 0 {
				return nil, bad("accept for item %d has no fact", v.Index)
			}
			for j := range v.Facts {
				f := &v.Facts[j]
				f.Fact, f.Reason = collapse(f.Fact), collapse(f.Reason)
				f.Keywords = cleanKeywords(f.Keywords)
				if f.Fact == "" || len([]rune(f.Fact)) > MaxFactLen || f.Reason == "" || len([]rune(f.Reason)) > MaxReasonLen {
					return nil, bad("fact or reason of item %d is empty or too long", v.Index)
				}
			}
		default:
			return nil, bad("unknown verdict %q", v.Verdict)
		}
	}
	for i, v := range byIndex {
		if v == nil {
			return nil, bad("item %d not answered", i)
		}
	}
	return items, nil
}

// collapse trims s and folds every whitespace run, newlines included, to one space: formats hold
// one field per line.
func collapse(s string) string { return strings.Join(strings.Fields(s), " ") }

func trimAll(in []string) []string {
	out := []string{}
	for _, s := range in {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func cleanKeywords(in []string) []string {
	out := []string{}
	seen := map[string]struct{}{}
	for _, k := range in {
		k = strings.Join(strings.Fields(k), " ")
		low := strings.ToLower(k)
		if _, dup := seen[low]; k == "" || dup {
			continue
		}
		seen[low] = struct{}{}
		out = append(out, k)
		if len(out) == MaxKeywords {
			break
		}
	}
	return out
}
