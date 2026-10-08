package memory

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

const reconcilePrompt = `You reconcile new facts against a long-term memory store. Output only the schema.

` + dataHygiene + `

Input: "facts", each with its "candidates": existing memories found by a loose, recall-first search. Most candidates are unrelated.

For each fact choose exactly one action:
- "noop" with "target": a candidate already states the same fact and its reason already covers the new one.
- "update" with "target": a candidate is about the same subject and the new fact replaces, corrects or refines it, or adds to its reason. Return the full new "fact" and a merged "reason". The old memory stays as history.
- "add": no candidate is about the same subject. Two facts on related topics that are both true are two memories, not an update.
"why" is one sentence explaining the choice. "target" is "" for add. For noop copy the new fact and reason into "fact" and "reason". Answer every fact index exactly once.`

const reconcileSchema = `{
  "type": "object", "additionalProperties": false, "required": ["decisions"],
  "properties": {"decisions": {"type": "array", "items": {
    "type": "object", "additionalProperties": false,
    "required": ["index", "action", "target", "fact", "reason", "why"],
    "properties": {
      "index": {"type": "integer"},
      "action": {"enum": ["add", "update", "noop"]},
      "target": {"type": "string"},
      "fact": {"type": "string"}, "reason": {"type": "string"}, "why": {"type": "string"}
    }}}}
}`

const reconcileCandidateLimit = 10

// work is one accepted fact moving through reconcile and commit.
type work struct {
	Fact, Reason string
	Keywords     []string
	cands        []Memory
	dec          decision

	// vec is Fact's embedding (nil when none could be made); mergedFact/mergedVec cache an
	// update's rewritten fact across commit retries.
	vec        []float32
	mergedFact string
	mergedVec  []float32
}

type decision struct {
	Action string
	Target string // real memory id; update/noop
	Fact   string
	Reason string
	Why    string
	Err    error
}

type reconcileInputFact struct {
	Index      int                  `json:"index"`
	Fact       string               `json:"fact"`
	Reason     string               `json:"reason"`
	Candidates []reconcileCandidate `json:"candidates"`
}

type reconcileCandidate struct {
	ID        string `json:"id"`
	Fact      string `json:"fact"`
	Reason    string `json:"reason"`
	CreatedAt string `json:"createdAt"`
}

type reconcileDecision struct {
	Index  int    `json:"index"`
	Action string `json:"action"`
	Target string `json:"target"`
	Fact   string `json:"fact"`
	Reason string `json:"reason"`
	Why    string `json:"why"`
}

// prepare resolves what needs no model: an exact duplicate is a noop, a fact with no candidates is
// an add. It reports whether the fact still needs the reconcile call.
func (s *Service) prepare(ctx context.Context, w *work) (needsLLM bool, err error) {
	same, err := s.store.currentByHash(ctx, factHash(w.Fact))
	if err != nil {
		return false, err
	}
	for _, m := range same {
		if normalize(m.Reason) == normalize(w.Reason) {
			w.dec = decision{Action: ActionNoop, Target: m.ID, Why: "Identical fact and reason already stored."}
			return false, nil
		}
	}
	if w.vec == nil {
		w.vec = s.embedDoc(ctx, w.Fact)
	}
	cands, err := s.candidates(ctx, w)
	if err != nil {
		return false, err
	}
	w.cands = cands
	if len(cands) == 0 {
		w.dec = decision{Action: ActionAdd, Fact: w.Fact, Reason: w.Reason, Why: "No related memory."}
		return false, nil
	}
	return true, nil
}

// candidates are the keyword top reconcileCandidateLimit plus up to reconcileVectorCandidates
// memories whose embedding is within the spec's DocFloor of the new fact, keyword matches first.
func (s *Service) candidates(ctx context.Context, w *work) ([]Memory, error) {
	cands, err := s.store.searchFTS(ctx, SearchArgs{
		Query: w.Fact + " " + strings.Join(w.Keywords, " "), Limit: reconcileCandidateLimit,
	})
	if err != nil || w.vec == nil {
		return cands, err
	}
	top, err := s.store.vectorTopK(ctx, s.opts.Embedder.Spec().ID, w.vec, false, reconcileVectorCandidates)
	if err != nil {
		return nil, err
	}
	have := make(map[int64]struct{}, len(cands))
	for _, c := range cands {
		have[c.seq] = struct{}{}
	}
	var extra []int64
	for _, t := range top {
		if _, dup := have[t.seq]; !dup && t.score >= s.opts.Embedder.Spec().DocFloor {
			extra = append(extra, t.seq)
		}
	}
	loaded, err := s.store.memoriesBySeq(ctx, extra)
	if err != nil {
		return nil, err
	}
	for _, seq := range extra {
		if m, ok := loaded[seq]; ok {
			cands = append(cands, m)
		}
	}
	return cands, nil
}

// reconcile makes one model call for every work needing it and fills each work's dec. A bad
// decision fails that fact only.
func (s *Service) reconcile(ctx context.Context, works []*work) error {
	if len(works) == 0 {
		return nil
	}
	in := struct {
		Facts []reconcileInputFact `json:"facts"`
	}{}
	tempIDs := make([]map[string]string, len(works))
	next := 1
	for i, w := range works {
		f := reconcileInputFact{Index: i, Fact: w.Fact, Reason: w.Reason, Candidates: []reconcileCandidate{}}
		tempIDs[i] = map[string]string{}
		for _, m := range w.cands {
			id := "c" + strconv.Itoa(next)
			next++
			tempIDs[i][id] = m.ID
			f.Candidates = append(f.Candidates, reconcileCandidate{ID: id, Fact: m.Fact, Reason: m.Reason, CreatedAt: m.CreatedAt})
		}
		in.Facts = append(in.Facts, f)
	}
	body, err := json.Marshal(in)
	if err != nil {
		return fmt.Errorf("memory: encode reconcile input: %w", err)
	}
	raw, err := s.runner.Run(ctx, Call{System: reconcilePrompt, Input: string(body), Schema: []byte(reconcileSchema)})
	if err != nil {
		return err
	}
	var out struct {
		Decisions []reconcileDecision `json:"decisions"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return fmt.Errorf("%w: reconcile: %v", ErrClaudeOutput, err)
	}
	seen := make([]bool, len(works))
	for _, d := range out.Decisions {
		if d.Index < 0 || d.Index >= len(works) || seen[d.Index] {
			continue
		}
		seen[d.Index] = true
		works[d.Index].dec = checkDecision(d, works[d.Index], tempIDs[d.Index])
	}
	for i, ok := range seen {
		if !ok {
			works[i].dec = decision{Err: fmt.Errorf("%w: reconcile skipped this fact", ErrClaudeOutput)}
		}
	}
	return nil
}

func checkDecision(d reconcileDecision, w *work, ids map[string]string) decision {
	fail := func(format string, a ...any) decision {
		return decision{Err: fmt.Errorf("%w: reconcile: %s", ErrClaudeOutput, fmt.Sprintf(format, a...))}
	}
	why := strings.TrimSpace(d.Why)
	switch d.Action {
	case ActionAdd:
		if d.Target != "" {
			return fail("add must not name a target")
		}
		return decision{Action: ActionAdd, Fact: w.Fact, Reason: w.Reason, Why: why}
	case ActionNoop, ActionUpdate:
		target, ok := ids[d.Target]
		if !ok {
			return fail("target %q is not a candidate of this fact", d.Target)
		}
		if d.Action == ActionNoop {
			return decision{Action: ActionNoop, Target: target, Why: why}
		}
		fact, reason := strings.TrimSpace(d.Fact), strings.TrimSpace(d.Reason)
		if fact == "" || len([]rune(fact)) > MaxFactLen || reason == "" || len([]rune(reason)) > MaxReasonLen {
			return fail("updated fact or reason is empty or too long")
		}
		return decision{Action: ActionUpdate, Target: target, Fact: fact, Reason: reason, Why: why}
	}
	return fail("unknown action %q", d.Action)
}
