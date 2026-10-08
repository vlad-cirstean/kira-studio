package memory

import (
	"context"
	"errors"
	"fmt"
	"unicode/utf8"

	"github.com/google/uuid"
	"golang.org/x/sync/semaphore"
)

const (
	maxItems          = 20
	maxClarifications = 10
	maxClarifyLen     = 1000
	maxPipelines      = 2
	maxStaleRetries   = 2
)

// ErrInvalid marks a request the caller can fix; its message is safe to show verbatim.
var ErrInvalid = errors.New("invalid memory request")

type Item struct {
	Fact   string `json:"fact"`
	Reason string `json:"reason"`
}

type Clarification struct {
	Question string `json:"question"`
	Answer   string `json:"answer"`
}

type StoreRequest struct {
	Items          []Item
	Clarifications []Clarification
	Author         string // "user" | "agent"
	Source         string // "mcp" | "ui"
	// Progress, when set, is told the stage: "checking", "reconciling", "saving".
	Progress func(stage string)
}

type ItemChallenge struct {
	Index     int      `json:"index"`
	Fact      string   `json:"fact"`
	Questions []string `json:"questions"`
}

type FactOutcome struct {
	Fact       string `json:"fact"`
	Reason     string `json:"reason"`
	Action     string `json:"action"` // add | update | noop | failed
	ID         string `json:"id"`
	LineageID  string `json:"lineageId"`
	Version    int    `json:"version"`
	PreviousID string `json:"previousId"`
	Why        string `json:"why"`
	Error      string `json:"error"`
}

type StoreResult struct {
	Status     string          `json:"status"` // "stored" | "challenged"
	Challenges []ItemChallenge `json:"challenges"`
	Outcomes   []FactOutcome   `json:"outcomes"`
}

// Service is the one entry point for both callers: the stdio MCP server and Kira Space's bridge.
type Service struct {
	store    *Store
	runner   Runner
	sem      *semaphore.Weighted
	onChange func()
}

func NewService(store *Store, runner Runner, onChange func()) *Service {
	return &Service{store: store, runner: runner, sem: semaphore.NewWeighted(maxPipelines), onChange: onChange}
}

func invalid(format string, a ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, a...))
}

func validateRequest(req StoreRequest) error {
	if n := len(req.Items); n < 1 || n > maxItems {
		return invalid("send 1 to %d items", maxItems)
	}
	for i, it := range req.Items {
		if n := utf8.RuneCountInString(it.Fact); n < 1 || n > MaxFactLen {
			return invalid("item %d: fact must be 1 to %d characters", i, MaxFactLen)
		}
		if utf8.RuneCountInString(it.Reason) > MaxReasonLen {
			return invalid("item %d: reason must be at most %d characters", i, MaxReasonLen)
		}
	}
	if len(req.Clarifications) > maxClarifications {
		return invalid("send at most %d clarifications", maxClarifications)
	}
	for _, c := range req.Clarifications {
		if utf8.RuneCountInString(c.Question) > maxClarifyLen || utf8.RuneCountInString(c.Answer) > maxClarifyLen {
			return invalid("clarifications must be at most %d characters", maxClarifyLen)
		}
	}
	if req.Author != AuthorUser && req.Author != AuthorAgent {
		return invalid("author must be %q or %q", AuthorUser, AuthorAgent)
	}
	if req.Source != SourceMCP && req.Source != SourceUI {
		return invalid("unknown source %q", req.Source)
	}
	return nil
}

func (s *Service) progress(req StoreRequest, stage string) {
	if req.Progress != nil {
		req.Progress(stage)
	}
}

// Store gates, reconciles and commits. A challenge stores nothing. A runner error fails the whole
// request; per-fact failures land in Outcomes.
func (s *Service) Store(ctx context.Context, req StoreRequest) (StoreResult, error) {
	if err := validateRequest(req); err != nil {
		return StoreResult{}, err
	}
	if err := s.sem.Acquire(ctx, 1); err != nil {
		return StoreResult{}, err
	}
	defer s.sem.Release(1)

	s.progress(req, "checking")
	verdicts, err := s.runGate(ctx, req)
	if err != nil {
		return StoreResult{}, err
	}
	res := StoreResult{Challenges: []ItemChallenge{}, Outcomes: []FactOutcome{}}
	for _, v := range verdicts {
		if v.Verdict == "challenge" {
			res.Challenges = append(res.Challenges, ItemChallenge{Index: v.Index, Fact: req.Items[v.Index].Fact, Questions: v.Questions})
		}
	}
	if len(res.Challenges) > 0 {
		res.Status = "challenged"
		return res, nil
	}
	res.Status = "stored"

	var works []*work
	for _, v := range verdicts {
		for _, f := range v.Facts {
			works = append(works, &work{Fact: f.Fact, Reason: f.Reason, Keywords: f.Keywords})
		}
	}

	s.progress(req, "reconciling")
	rev, err := s.store.Revision(ctx)
	if err != nil {
		return StoreResult{}, err
	}
	var pending []*work
	for _, w := range works {
		need, err := s.prepare(ctx, w)
		if err != nil {
			return StoreResult{}, err
		}
		if need {
			pending = append(pending, w)
		}
	}
	if err := s.reconcile(ctx, pending); err != nil {
		return StoreResult{}, err
	}

	s.progress(req, "saving")
	requestID := uuid.NewString()
	committed := false
	for i := range works {
		out := s.commit(ctx, req, requestID, works[i:], &rev)
		committed = committed || out.Action != ActionFailed
		res.Outcomes = append(res.Outcomes, out)
	}
	if committed && s.onChange != nil {
		s.onChange()
	}
	return res, nil
}

// commit applies the first work's decision. When the store moved underneath, it re-decides every
// work not yet committed, since each was decided against the older revision.
func (s *Service) commit(ctx context.Context, req StoreRequest, requestID string, rest []*work, rev *int64) FactOutcome {
	w := rest[0]
	fail := func(err error) FactOutcome {
		return FactOutcome{Fact: w.Fact, Reason: w.Reason, Action: ActionFailed, Error: err.Error()}
	}
	for attempt := 0; ; attempt++ {
		if w.dec.Err != nil {
			return fail(w.dec.Err)
		}
		r, err := s.store.commitFact(ctx, commitInput{
			Revision: *rev, Action: w.dec.Action, TargetID: w.dec.Target, Fact: w.dec.Fact, Reason: w.dec.Reason,
			Keywords: w.Keywords, Author: req.Author, Source: req.Source, RequestID: requestID, Why: w.dec.Why,
		})
		if err == nil {
			*rev = r.Revision
			return FactOutcome{Fact: w.dec.factOr(w.Fact), Reason: w.dec.reasonOr(w.Reason), Action: w.dec.Action,
				ID: r.ID, LineageID: r.LineageID, Version: r.Version, PreviousID: r.PreviousID, Why: w.dec.Why}
		}
		if !errors.Is(err, errStale) {
			return fail(err)
		}
		if attempt == maxStaleRetries {
			return fail(errStale)
		}
		if err := s.redecide(ctx, rest, rev); err != nil {
			return fail(err)
		}
	}
}

// redecide refreshes the revision and reruns candidate retrieval and one reconcile for every work given.
func (s *Service) redecide(ctx context.Context, works []*work, rev *int64) error {
	var err error
	if *rev, err = s.store.Revision(ctx); err != nil {
		return err
	}
	var pending []*work
	for _, w := range works {
		need, err := s.prepare(ctx, w)
		if err != nil {
			return err
		}
		if need {
			pending = append(pending, w)
		}
	}
	return s.reconcile(ctx, pending)
}

func (d decision) factOr(fallback string) string {
	if d.Fact != "" {
		return d.Fact
	}
	return fallback
}

func (d decision) reasonOr(fallback string) string {
	if d.Reason != "" {
		return d.Reason
	}
	return fallback
}

func (s *Service) Search(ctx context.Context, a SearchArgs) ([]Memory, error) {
	return s.store.Search(ctx, a)
}

func (s *Service) Recent(ctx context.Context, limit int) ([]Memory, error) {
	return s.store.Recent(ctx, limit)
}

func (s *Service) History(ctx context.Context, id string) (History, error) {
	return s.store.Lineage(ctx, id)
}
