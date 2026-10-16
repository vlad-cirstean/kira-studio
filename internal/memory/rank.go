package memory

import (
	"cmp"
	"math"
	"slices"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/internal/kiratime"
)

// Ranking constants. Relevance decides; boosts stay near 1 so provenance only breaks near-ties.
const (
	// Candidate pool per source: fusion only ranks what it sees, so it reads wider than the result limit.
	poolFactor = 4
	poolMin    = 100
	poolMax    = 400

	// Keyword part: bm25 keeps magnitude, term coverage restores order under the OR query.
	kwBM25Weight = 0.7
	kwCoverage   = 0.3

	// Fusion: neither source is known better; agreement on both is the strongest evidence.
	fuseKeyword  = 0.45
	fuseSemantic = 0.45
	fuseAgree    = 0.10

	// Grade: user over external over agent, small because agent facts stay useful reference.
	gradeUser     = 1.10
	gradeExternal = 1.05

	// Scope relative to the target project: current work first, other projects stay visible.
	scopeSameProject  = 1.15
	scopeCompany      = 1.05
	scopePersonal     = 1.00
	scopeOtherProject = 0.85

	// Recency: facts age slowly, so the bonus only breaks ties.
	recencyBonus    = 0.05
	recencyHalfLife = 90.0

	// Superseded versions rank below the current one but stay listed.
	historyFactor = 0.60

	// Group: co-hits from one doc, thread, task or request signal the context asked for.
	groupBonus = 0.05
	groupCap   = 3
)

const (
	boostProject      = "project"
	boostCompany      = "company"
	boostPersonal     = "personal"
	boostOtherProject = "other-project"
)

// Score explains one search result's rank. Total is Relevance times the five boosts.
type Score struct {
	Total     float64 `json:"total"`
	Relevance float64 `json:"relevance"`
	Keyword   float64 `json:"keyword"`
	Semantic  float64 `json:"semantic"`
	Grade     float64 `json:"grade"`
	Scope     float64 `json:"scope"`
	Recency   float64 `json:"recency"`
	History   float64 `json:"history"`
	Group     float64 `json:"group"`
	// Boost names the scope case: project, company, personal, other-project; empty without a target project.
	Boost string `json:"boost,omitempty"`
}

func round3(x float64) float64 { return math.Round(x*1000) / 1000 }

func clamp01(x float64) float64 { return math.Max(0, math.Min(1, x)) }

// poolSize is the per-source candidate count for a result limit.
func poolSize(limit int) int { return min(max(poolFactor*limit, poolMin), poolMax) }

// keywordPart is the [0, 1] keyword score: bm25 relative to the pool best, blended with term coverage.
func keywordPart(bm25, bestBM25, coverage float64) float64 {
	bnorm := 1.0
	if bestBM25 > 0 {
		bnorm = clamp01(bm25 / bestBM25)
	}
	return round3(kwBM25Weight*bnorm + kwCoverage*clamp01(coverage))
}

// semanticPart maps a cosine linearly between the model's unrelated and near-certain cosines.
func semanticPart(cos, floor, ceil float32) float64 {
	if ceil <= floor {
		if cos > floor {
			return 1
		}
		return 0
	}
	return round3(clamp01(float64(cos-floor) / float64(ceil-floor)))
}

// relevance fuses the two source scores; with no semantic source it is the keyword score.
func relevance(kw, sem float64, semantic bool) float64 {
	if !semantic {
		return round3(kw)
	}
	return round3(fuseKeyword*kw + fuseSemantic*sem + fuseAgree*math.Min(kw, sem))
}

func gradeBoost(origin string) float64 {
	switch GradeOf(origin) {
	case GradeOf(OriginUser):
		return gradeUser
	case GradeOf(OriginExternal):
		return gradeExternal
	}
	return 1
}

// scopeBoost weighs a fact against the target project. No target means neutral and an empty name.
func scopeBoost(m Memory, project string) (float64, string) {
	if project == "" {
		return 1, ""
	}
	switch m.Scope {
	case ScopeProject:
		if m.Project != nil && *m.Project == project {
			return scopeSameProject, boostProject
		}
		return scopeOtherProject, boostOtherProject
	case ScopeCompany:
		return scopeCompany, boostCompany
	}
	return scopePersonal, boostPersonal
}

func recencyBoost(createdAt string, now time.Time) float64 {
	t, err := kiratime.ParseISO(createdAt)
	if err != nil {
		return 1
	}
	age := math.Max(0, now.Sub(t).Hours()/24)
	return round3(1 + recencyBonus*math.Pow(2, -age/recencyHalfLife))
}

func historyBoost(m Memory) float64 {
	if m.Historical {
		return historyFactor
	}
	return 1
}

func groupBoost(peers int) float64 { return round3(1 + groupBonus*float64(min(peers, groupCap))) }

// coverage is the share of query terms that prefix-match a token of the fact or its keywords.
func coverage(terms []string, m Memory) float64 {
	if len(terms) == 0 {
		return 0
	}
	tokens := splitTerms(m.Fact + " " + strings.Join(m.Keywords, " "))
	hit := 0
	for _, t := range terms {
		if slices.ContainsFunc(tokens, func(tok string) bool { return strings.HasPrefix(tok, t) }) {
			hit++
		}
	}
	return float64(hit) / float64(len(terms))
}

// total multiplies the parts; every part is already rounded, so the total is reproducible from them.
func (s *Score) total() float64 {
	return round3(s.Relevance * s.Grade * s.Scope * s.Recency * s.History * s.Group)
}

// newScore builds a result's score without the group boost, which needs the whole result list.
func newScore(m Memory, kw, sem float64, semantic bool, project string, now time.Time) Score {
	s := Score{Keyword: kw, Semantic: sem, Relevance: relevance(kw, sem, semantic), Grade: gradeBoost(m.Origin),
		Recency: recencyBoost(m.CreatedAt, now), History: historyBoost(m), Group: 1}
	s.Scope, s.Boost = scopeBoost(m, project)
	s.Total = s.total()
	return s
}

func (s *Score) applyGroup(peers int) {
	s.Group = groupBoost(peers)
	s.Total = s.total()
}

// rankedMemory pairs a result with its sort tie-breaker.
type rankedMemory struct {
	Memory
	score Score
}

// sortRanked orders by total, then relevance, then keyword part, then newest.
func sortRanked(r []rankedMemory) {
	slices.SortFunc(r, func(a, b rankedMemory) int {
		return cmp.Or(
			cmp.Compare(b.score.Total, a.score.Total),
			cmp.Compare(b.score.Relevance, a.score.Relevance),
			cmp.Compare(b.score.Keyword, a.score.Keyword),
			cmp.Compare(b.seq, a.seq))
	})
}
