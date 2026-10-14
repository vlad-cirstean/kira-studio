package memory

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/kirathecat/kira-studio/internal/memory/memfmt"
)

// DocSkipped is the outcome action of a doc fact ApplyDoc left alone.
const DocSkipped = "skipped"

// ApplyDocRequest is a parsed kira-memory doc and the import file it came from.
type ApplyDocRequest struct {
	Doc    memfmt.Doc
	FileID string
}

// DocOutcome is one doc fact's result: add, update, noop or skipped, with why.
type DocOutcome struct {
	ID     string `json:"id"`
	Action string `json:"action"`
	Why    string `json:"why"`
}

type ApplyDocResult struct {
	Outcomes []DocOutcome
	// Orphaned counts facts stored in the doc's group that the doc no longer lists.
	Orphaned int
}

// ApplyDoc stores a doc's facts as they are: no gate, no reconcile, no Claude call. A fact without
// a stored lineage is added under the doc's id; an identical one is a noop; a changed one becomes a
// new version, unless the stored version ranks higher by origin.
func (s *Service) ApplyDoc(ctx context.Context, req ApplyDocRequest) (ApplyDocResult, error) {
	d := req.Doc
	if err := checkProvenance("doc", Item{Origin: d.Origin, SourceTag: d.Source, Scope: d.Scope, Project: d.Project}); err != nil {
		return ApplyDocResult{}, err
	}
	if d.Session != "" && !sessionPattern.MatchString(d.Session) {
		return ApplyDocResult{}, invalid("doc session must be 1 to %d characters from A-Z, a-z, 0-9 and ._:-", maxSessionLen)
	}
	requestID := uuid.NewString()
	groups := []GroupRef{{ID: d.Group, Kind: GroupDocument, Key: d.Group, Title: d.Title}, {Kind: GroupRequest, Key: requestID}}
	if d.Session != "" {
		groups = append(groups, GroupRef{Kind: GroupSession, Key: d.Session})
	}
	var res ApplyDocResult
	committed := false
	for _, f := range d.Facts {
		out, err := s.applyDocFact(ctx, req, requestID, groups, f)
		if err != nil {
			return res, err
		}
		committed = committed || out.Action == ActionAdd || out.Action == ActionUpdate
		res.Outcomes = append(res.Outcomes, out)
	}
	var err error
	if res.Orphaned, err = s.store.orphans(ctx, d.Group, d.Facts); err != nil {
		return res, err
	}
	if committed {
		if s.opts.OnChange != nil {
			s.opts.OnChange()
		}
		s.kickBackfill()
	}
	return res, nil
}

func (s *Service) applyDocFact(ctx context.Context, req ApplyDocRequest, requestID string, groups []GroupRef, f memfmt.Fact) (DocOutcome, error) {
	d := req.Doc
	out := DocOutcome{ID: f.ID}
	keywords := cleanKeywords(d.Keywords)
	if n := utf8.RuneCountInString(f.Fact); n > MaxFactLen {
		out.Action, out.Why = DocSkipped, fmt.Sprintf("Fact is over %d characters.", MaxFactLen)
		return out, nil
	}
	if n := utf8.RuneCountInString(f.Reason); n > MaxReasonLen {
		out.Action, out.Why = DocSkipped, fmt.Sprintf("Reason is over %d characters.", MaxReasonLen)
		return out, nil
	}
	in := commitInput{
		Fact: f.Fact, Reason: f.Reason, Keywords: keywords, Origin: d.Origin, SourceTag: d.Source, Scope: d.Scope, Project: d.Project,
		SessionID: d.Session, Source: SourceImport, SourceRef: req.FileID, RequestID: requestID, Groups: groups,
	}
	for attempt := 0; ; attempt++ {
		rev, err := s.store.Revision(ctx)
		if err != nil {
			return out, err
		}
		cur, found, err := s.store.currentOf(ctx, f.ID)
		if err != nil {
			return out, err
		}
		in.Revision = rev
		switch {
		case !found:
			in.Action, in.FactID, in.TargetID, in.Why = ActionAdd, f.ID, "", "Added from a kira-memory doc."
		case sameDocFact(cur, f, keywords):
			in.Action, in.TargetID, in.Why = ActionNoop, cur.ID, "The doc matches the stored fact."
		case GradeOf(d.Origin) >= GradeOf(cur.Origin):
			in.Action, in.TargetID, in.Why = ActionUpdate, cur.ID, "The doc changed the fact."
		default:
			out.Action, out.Why = DocSkipped, "Stored fact ranks higher; doc not applied."
			return out, nil
		}
		_, err = s.store.commitFact(ctx, in)
		if err == nil {
			out.Action, out.Why = in.Action, in.Why
			return out, nil
		}
		if !errors.Is(err, errStale) || attempt == maxStaleRetries {
			return out, err
		}
	}
}

func sameDocFact(cur Memory, f memfmt.Fact, keywords []string) bool {
	if normalize(cur.Fact) != normalize(f.Fact) || collapse(cur.Reason) != collapse(f.Reason) || len(cur.Keywords) != len(keywords) {
		return false
	}
	have := make([]string, len(cur.Keywords))
	want := make([]string, len(keywords))
	for i, k := range cur.Keywords {
		have[i] = strings.ToLower(k)
	}
	for i, k := range keywords {
		want[i] = strings.ToLower(k)
	}
	slices.Sort(have)
	slices.Sort(want)
	return slices.Equal(have, want)
}
