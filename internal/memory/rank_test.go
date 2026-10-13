package memory

import (
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/internal/kiratime"
)

func ptr(s string) *string { return &s }

func TestScore(t *testing.T) {
	now := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	ago := func(days float64) string {
		return kiratime.FormatISO(now.Add(-time.Duration(days * 24 * float64(time.Hour))))
	}

	t.Run("keyword part", func(t *testing.T) {
		cases := []struct {
			name              string
			bm25, best, cover float64
			want              float64
		}{
			{"pool best with full coverage", 8, 8, 1, 1},
			{"half bm25, full coverage", 4, 8, 1, 0.65},
			{"weakest real match stays above 0", 0.1, 8, 0.5, 0.159},
			{"coverage lifts a lower bm25", 3, 8, 1, 0.563},
			{"no positive best counts as full bm25", 0, 0, 0, 0.7},
			{"coverage above 1 clamps", 8, 8, 2, 1},
		}
		for _, c := range cases {
			if got := keywordPart(c.bm25, c.best, c.cover); got != c.want {
				t.Errorf("%s: got %v, want %v", c.name, got, c.want)
			}
		}
	})

	t.Run("semantic part", func(t *testing.T) {
		cases := []struct {
			name             string
			cos, floor, ceil float32
			want             float64
		}{
			{"at floor", 0.55, 0.55, 0.70, 0},
			{"below floor clamps", 0.3, 0.55, 0.70, 0},
			{"midway", 0.625, 0.55, 0.70, 0.5},
			{"above ceil clamps", 0.9, 0.55, 0.70, 1},
			{"degenerate band above floor", 0.6, 0.5, 0.5, 1},
			{"degenerate band at floor", 0.5, 0.5, 0.5, 0},
		}
		for _, c := range cases {
			if got := semanticPart(c.cos, c.floor, c.ceil); got != c.want {
				t.Errorf("%s: got %v, want %v", c.name, got, c.want)
			}
		}
	})

	t.Run("fusion", func(t *testing.T) {
		cases := []struct {
			name     string
			kw, sem  float64
			semantic bool
			want     float64
		}{
			{"both full", 1, 1, true, 1},
			{"keyword only side", 1, 0, true, 0.45},
			{"semantic only side", 0, 1, true, 0.45},
			{"agreement rewards min", 0.8, 0.4, true, 0.4*0.1 + 0.45*1.2},
			{"semantic off keeps keyword score", 0.8, 0.9, false, 0.8},
		}
		for _, c := range cases {
			if got := relevance(c.kw, c.sem, c.semantic); got != round3(c.want) {
				t.Errorf("%s: got %v, want %v", c.name, got, round3(c.want))
			}
		}
	})

	t.Run("boosts", func(t *testing.T) {
		billing := "github.com/acme/billing"
		mem := func(origin, scope string, project *string, created string, historical bool) Memory {
			return Memory{Origin: origin, Scope: scope, Project: project, CreatedAt: created, Historical: historical}
		}
		cases := []struct {
			name    string
			m       Memory
			project string
			want    Score
		}{
			{"user project fact in target project", mem(OriginUser, ScopeProject, &billing, ago(0), false), billing,
				Score{Grade: 1.10, Scope: 1.15, Recency: 1.05, History: 1, Boost: "project"}},
			{"agent fact in another project", mem(OriginAgent, ScopeProject, ptr("github.com/acme/web"), ago(90), false), billing,
				Score{Grade: 1, Scope: 0.85, Recency: 1.025, History: 1, Boost: "other-project"}},
			{"external company fact", mem(OriginExternal, ScopeCompany, nil, ago(180), false), billing,
				Score{Grade: 1.05, Scope: 1.05, Recency: 1.013, History: 1, Boost: "company"}},
			{"personal superseded fact", mem(OriginAgent, ScopePersonal, nil, ago(900), true), billing,
				Score{Grade: 1, Scope: 1, Recency: 1.0, History: 0.6, Boost: "personal"}},
			{"no target project is neutral", mem(OriginAgent, ScopeProject, &billing, ago(900), false), "",
				Score{Grade: 1, Scope: 1, Recency: 1.0, History: 1}},
		}
		for _, c := range cases {
			got := newScore(c.m, 1, 1, true, c.project, now)
			if got.Grade != c.want.Grade || got.Scope != c.want.Scope || got.Recency != c.want.Recency ||
				got.History != c.want.History || got.Boost != c.want.Boost || got.Group != 1 {
				t.Errorf("%s: got %+v, want %+v", c.name, got, c.want)
			}
		}
	})

	t.Run("group boost caps", func(t *testing.T) {
		for peers, want := range map[int]float64{0: 1, 1: 1.05, 3: 1.15, 9: 1.15} {
			if got := groupBoost(peers); got != want {
				t.Errorf("peers %d: got %v, want %v", peers, got, want)
			}
		}
	})

	t.Run("total reproduces from rounded parts", func(t *testing.T) {
		m := Memory{Origin: OriginUser, Scope: ScopeCompany, CreatedAt: ago(0)}
		s := newScore(m, 0.71, 0.64, true, "p", now)
		s.applyGroup(2)
		// relevance 0.45*0.71+0.45*0.64+0.1*0.64 = 0.6715 -> 0.672 (rounded half away from zero)
		want := round3(0.672 * 1.10 * 1.05 * 1.05 * 1 * 1.10)
		if s.Relevance != 0.672 || s.Total != want {
			t.Errorf("relevance %v total %v, want 0.672 and %v", s.Relevance, s.Total, want)
		}
	})

	t.Run("coverage prefix-matches fact and keywords only", func(t *testing.T) {
		m := Memory{Fact: "Deployment runs on Kubernetes", Keywords: []string{"k8s"}, Reason: "pipeline staging"}
		cases := []struct {
			terms []string
			want  float64
		}{
			{[]string{"deploy", "kubernetes"}, 1},
			{[]string{"deploy", "k8s", "pipeline", "nothing"}, 0.5},
			{nil, 0},
		}
		for _, c := range cases {
			if got := coverage(c.terms, m); got != c.want {
				t.Errorf("%v: got %v, want %v", c.terms, got, c.want)
			}
		}
	})

	t.Run("ordering ties", func(t *testing.T) {
		mk := func(seq int64, total, rel, kw float64) rankedMemory {
			r := rankedMemory{score: Score{Total: total, Relevance: rel, Keyword: kw}}
			r.seq = seq
			return r
		}
		got := []rankedMemory{mk(1, 0.5, 0.5, 0.5), mk(2, 0.5, 0.5, 0.9), mk(3, 0.5, 0.6, 0.1), mk(4, 0.5, 0.5, 0.5), mk(5, 0.9, 0.1, 0)}
		sortRanked(got)
		var seqs []int64
		for _, r := range got {
			seqs = append(seqs, r.seq)
		}
		want := []int64{5, 3, 2, 4, 1}
		for i := range want {
			if seqs[i] != want[i] {
				t.Fatalf("order = %v, want %v", seqs, want)
			}
		}
	})

	t.Run("pool size", func(t *testing.T) {
		for limit, want := range map[int]int{1: 100, 25: 100, 40: 160, 100: 400, 200: 400} {
			if got := poolSize(limit); got != want {
				t.Errorf("limit %d: got %d, want %d", limit, got, want)
			}
		}
	})
}
