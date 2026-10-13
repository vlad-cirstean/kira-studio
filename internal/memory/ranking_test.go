package memory

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/internal/kiratime"
	"github.com/kirathecat/kira-studio/internal/memory/embed"
)

//go:embed testdata/ranking/store.json
var rankingStoreJSON []byte

//go:embed testdata/ranking/queries.json
var rankingQueriesJSON []byte

type rankingFact struct {
	ID        string     `json:"id"`
	Fact      string     `json:"fact"`
	Reason    string     `json:"reason"`
	Keywords  []string   `json:"keywords"`
	Origin    string     `json:"origin"`
	SourceTag string     `json:"sourceTag"`
	Scope     string     `json:"scope"`
	Project   string     `json:"project"`
	Groups    []GroupRef `json:"groups"`
	AgeDays   float64    `json:"ageDays"`
	Updates   string     `json:"updates"`
	Vec       []float32  `json:"vec"`
}

type rankingCase struct {
	Name           string    `json:"name"`
	Category       string    `json:"category"`
	Query          string    `json:"query"`
	Vec            []float32 `json:"vec"`
	Semantic       bool      `json:"semantic"`
	Scopes         []string  `json:"scopes"`
	Origins        []string  `json:"origins"`
	Project        string    `json:"project"`
	IncludeHistory bool      `json:"includeHistory"`
	Limit          int       `json:"limit"`
	Expect         struct {
		Top    string     `json:"top"`
		Before [][]string `json:"before"`
		Within []struct {
			ID string `json:"id"`
			N  int    `json:"n"`
		} `json:"within"`
		Absent   []string `json:"absent"`
		MinCount int      `json:"minCount"`
	} `json:"expect"`
}

// rankingEmbedder maps the case query text to the case vector. Documents are pre-embedded.
type rankingEmbedder struct{ query, vec []float32 }

func (e *rankingEmbedder) Spec() embed.Spec {
	return embed.Spec{ID: "ranking", Dim: 8, QueryFloor: 0.3, QueryCeil: 1}
}
func (e *rankingEmbedder) Status() embed.Status { return embed.Status{State: embed.StateReady} }
func (e *rankingEmbedder) Embed(_ context.Context, texts []string, _ bool) ([][]float32, error) {
	out := make([][]float32, len(texts))
	for i := range texts {
		out[i] = e.vec
	}
	return out, nil
}

func unit(v []float32) []float32 {
	var sum float64
	for _, x := range v {
		sum += float64(x) * float64(x)
	}
	out := make([]float32, len(v))
	for i, x := range v {
		out[i] = float32(float64(x) / math.Sqrt(sum))
	}
	return out
}

// seedRanking writes the fixture store and returns version id to fixture id.
func seedRanking(t *testing.T, st *Store) map[string]string {
	t.Helper()
	ctx := context.Background()
	var fx struct {
		Facts []rankingFact `json:"facts"`
	}
	if err := json.Unmarshal(rankingStoreJSON, &fx); err != nil {
		t.Fatal(err)
	}
	ids := map[string]string{}
	current := map[string]string{}
	age := map[string]float64{}
	for _, f := range fx.Facts {
		rev, err := st.Revision(ctx)
		if err != nil {
			t.Fatal(err)
		}
		in := commitInput{Revision: rev, Action: ActionAdd, Fact: f.Fact, Reason: f.Reason, Keywords: f.Keywords,
			Origin: f.Origin, SourceTag: f.SourceTag, Scope: f.Scope, Project: f.Project, Source: SourceMCP,
			RequestID: "seed-" + f.ID, Groups: f.Groups, Vec: embed.Encode(unit(f.Vec)), Model: "ranking"}
		if f.Updates != "" {
			in.Action, in.TargetID = ActionUpdate, current[f.Updates]
		}
		res, err := st.commitFact(ctx, in)
		if err != nil {
			t.Fatalf("seed %s: %v", f.ID, err)
		}
		ids[res.ID], current[f.ID] = f.ID, res.ID
		age[res.ID] = f.AgeDays
	}
	db, err := st.conn()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`DROP TRIGGER memories_immutable`); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	for id, days := range age {
		created := kiratime.FormatISO(now.Add(-time.Duration(days * 24 * float64(time.Hour))))
		if _, err := db.Exec(`UPDATE memories SET created_at = ? WHERE id = ?`, created, id); err != nil {
			t.Fatal(err)
		}
	}
	return ids
}

func describeRanking(got []Memory, ids map[string]string) string {
	var b strings.Builder
	for i, m := range got {
		s := m.Score
		fmt.Fprintf(&b, "  %2d %-5s total=%.3f rel=%.3f kw=%.3f sem=%.3f grade=%.2f scope=%.2f(%s) rec=%.3f hist=%.2f grp=%.2f match=%s\n",
			i+1, ids[m.ID], s.Total, s.Relevance, s.Keyword, s.Semantic, s.Grade, s.Scope, s.Boost, s.Recency, s.History, s.Group, m.Match)
	}
	return b.String()
}

func TestRankingFixtures(t *testing.T) {
	var qs struct {
		Cases []rankingCase `json:"cases"`
	}
	if err := json.Unmarshal(rankingQueriesJSON, &qs); err != nil {
		t.Fatal(err)
	}
	st := newStore(t)
	ids := seedRanking(t, st)
	for _, c := range qs.Cases {
		t.Run(c.Category+"/"+c.Name, func(t *testing.T) {
			opts := ServiceOptions{}
			if c.Semantic {
				opts.Embedder = &rankingEmbedder{vec: unit(c.Vec)}
			}
			svc := NewService(st, nil, opts)
			defer svc.Close()
			got, err := svc.Search(context.Background(), SearchArgs{Query: c.Query, IncludeHistory: c.IncludeHistory,
				Limit: c.Limit, Scopes: c.Scopes, Origins: c.Origins, Project: c.Project})
			if err != nil {
				t.Fatal(err)
			}
			pos := map[string]int{}
			for i, m := range got {
				pos[ids[m.ID]] = i + 1
			}
			fail := func(format string, a ...any) {
				t.Helper()
				t.Errorf(format+"\nranked:\n%s", append(a, describeRanking(got, ids))...)
			}
			e := c.Expect
			if e.Top != "" && (len(got) == 0 || ids[got[0].ID] != e.Top) {
				fail("top = %v, want %s", firstID(got, ids), e.Top)
			}
			for _, p := range e.Before {
				a, b := pos[p[0]], pos[p[1]]
				if a == 0 || (b != 0 && b < a) {
					fail("%s must rank before %s (positions %d, %d)", p[0], p[1], a, b)
				}
			}
			for _, w := range e.Within {
				if p := pos[w.ID]; p == 0 || p > w.N {
					fail("%s at position %d, want within top %d", w.ID, p, w.N)
				}
			}
			for _, id := range e.Absent {
				if pos[id] != 0 {
					fail("%s must be absent, found at %d", id, pos[id])
				}
			}
			if len(got) < e.MinCount {
				fail("got %d results, want at least %d", len(got), e.MinCount)
			}
		})
	}
}

func firstID(got []Memory, ids map[string]string) string {
	if len(got) == 0 {
		return "none"
	}
	return ids[got[0].ID]
}
