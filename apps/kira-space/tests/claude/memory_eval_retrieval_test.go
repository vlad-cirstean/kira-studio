package claude

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/internal/memory"
	"github.com/kirathecat/kira-studio/internal/memory/embed"
	"github.com/kirathecat/kira-studio/internal/memory/memfmt"
	"github.com/kirathecat/kira-studio/internal/textloss"
)

// Retrieval eval (P291): every stored fact of a round goes into one fresh memory.db through
// Service.ApplyDoc (no gate, no Claude), then the questions run through the real search path with the
// embedder on (hybrid), off (keyword), and a cosine ranking by the same client (semantic).

const crockford = "0123456789abcdefghjkmnpqrstvwxyz"

func crockfordID(prefix string, n int) string {
	b := make([]byte, 12)
	for i := 11; i >= 0; i-- {
		b[i] = crockford[n%32]
		n /= 32
	}
	return prefix + string(b)
}

type fkey struct{ Round, Source, ID string }

type seedFact struct {
	key      fkey
	src      evalSource
	fact     string
	reason   string
	keywords []string
	subject  string
	aspect   string
	section  string
	style    string
}

// Embedding wrapper.

type evalEmbedder struct {
	inner *embed.Client
	mu    sync.Mutex
	docs  map[string][]float32
	qs    map[string][]float32
}

func (e *evalEmbedder) vecs(ctx context.Context, texts []string, query bool) ([][]float32, error) {
	cache := e.docs
	if query {
		cache = e.qs
	}
	e.mu.Lock()
	var missing []string
	seen := map[string]bool{}
	for _, t := range texts {
		if _, ok := cache[t]; !ok && !seen[t] {
			seen[t] = true
			missing = append(missing, t)
		}
	}
	e.mu.Unlock()
	if len(missing) > 0 {
		vs, err := e.inner.Embed(ctx, missing, query)
		if err != nil {
			return nil, err
		}
		e.mu.Lock()
		for i, t := range missing {
			cache[t] = vs[i]
		}
		e.mu.Unlock()
	}
	out := make([][]float32, len(texts))
	e.mu.Lock()
	defer e.mu.Unlock()
	for i, t := range texts {
		out[i] = cache[t]
	}
	return out, nil
}

// recipeEmbedder is the memory.Embedder a Service sees: document texts (the stored fact) map to the
// recipe's text, queries pass through, and the model id carries the recipe so vectors never mix.
type recipeEmbedder struct {
	e       *evalEmbedder
	recipe  string
	docText map[string]string
}

func (r *recipeEmbedder) Spec() embed.Spec {
	s := r.e.inner.Spec()
	s.ID += "/" + r.recipe
	return s
}
func (r *recipeEmbedder) Status() embed.Status { return r.e.inner.Status() }
func (r *recipeEmbedder) Embed(ctx context.Context, texts []string, query bool) ([][]float32, error) {
	if query {
		return r.e.vecs(ctx, texts, true)
	}
	in := make([]string, len(texts))
	for i, t := range texts {
		in[i] = t
		if m, ok := r.docText[t]; ok {
			in[i] = m
		}
	}
	return r.e.vecs(ctx, in, false)
}

func recipeText(recipe string, f seedFact) string {
	kw := ""
	if strings.HasSuffix(recipe, "-kw") && len(f.keywords) > 0 {
		kw = " keywords: " + strings.Join(f.keywords, ", ")
	}
	switch strings.TrimSuffix(recipe, "-kw") {
	case "fact":
		return f.fact + kw
	case "sec-fact":
		if f.section == "" {
			return f.fact + kw
		}
		return f.section + ": " + f.fact + kw
	case "sa-fact":
		if f.subject == "" {
			return f.fact + kw
		}
		return f.subject + ", " + f.aspect + ": " + f.fact + kw
	}
	return f.fact
}

var allRecipes = []string{"fact", "fact-kw", "sec-fact", "sec-fact-kw", "sa-fact", "sa-fact-kw"}

// Round data.

type roundData struct {
	ref, name string
	recs      map[string]runRecord
	grades    map[string]scoreGrades
	scored    map[string]bool
}

func loadRound(ref string) (roundData, error) {
	dir := roundDirOf(ref)
	rd := roundData{ref: ref, name: filepath.Base(ref), recs: loadRecords(filepath.Join(dir, "facts.jsonl")), grades: map[string]scoreGrades{}, scored: scoredSources(dir)}
	if len(rd.recs) == 0 {
		return rd, fmt.Errorf("%s: no facts.jsonl records", ref)
	}
	for id := range rd.recs {
		raw, err := os.ReadFile(filepath.Join(dir, "judge", id+".json"))
		if err != nil {
			continue
		}
		var c struct {
			Grades scoreGrades `json:"grades"`
		}
		if json.Unmarshal(raw, &c) == nil {
			rd.grades[id] = c.Grades
		}
	}
	return rd, nil
}

// qMeta is one query of the eval. Answers are the round's stored fact ids the judge lists for the
// golden fact with covered full or partial; none means an end-to-end miss.
type qMeta struct {
	Source   string   `json:"source"`
	Golden   string   `json:"golden"`
	Form     string   `json:"form"`
	Text     string   `json:"text"`
	Category string   `json:"category"`
	Answers  []string `json:"answers"`
}

func (q qMeta) id() string { return q.Source + "/" + q.Golden + "/" + q.Form }

func buildQueries(man evalManifest, rd roundData, srcs []evalSource) ([]qMeta, int, error) {
	qs, err := loadQuestions()
	if err != nil {
		return nil, 0, err
	}
	var out []qMeta
	dropped := 0
	for _, s := range srcs {
		ql, ok := qs[s.ID]
		if !ok {
			return nil, 0, fmt.Errorf("no questions for %s", s.ID)
		}
		answers := map[string][]string{}
		for _, g := range rd.grades[s.ID].Golden {
			if g.Covered == "full" || g.Covered == "partial" {
				answers[g.ID] = g.By
			}
		}
		if os.Getenv("KIRA_EVAL_CONTROL") == "1" {
			// Negative control: every query gets the next item's answers, so hit rates must collapse.
			rot := map[string][]string{}
			for i, it := range ql.Items {
				rot[it.ID] = answers[ql.Items[(i+1)%len(ql.Items)].ID]
			}
			answers = rot
		}
		for _, it := range ql.Items {
			for _, form := range []string{"question", "query"} {
				text, leak := it.Question, it.QuestionLeak
				if form == "query" {
					text, leak = it.Query, it.QueryLeak
				}
				if leak {
					dropped++
					continue
				}
				out = append(out, qMeta{Source: s.ID, Golden: it.ID, Form: form, Text: text, Category: s.Category, Answers: answers[it.ID]})
			}
		}
	}
	return out, dropped, nil
}

// Seeding.

type seededStore struct {
	st    *memory.Store
	kw    *memory.Service
	facts []seedFact
	byKM  map[string]int // km_ id to index in facts
	km    map[fkey]string
}

func (s *seededStore) close() {
	s.kw.Close()
	_ = s.st.Close()
}

// storeCfg picks the seeded text: the style per source and the FTS keyword variant.
type storeCfg struct {
	style string // full | tele | tele-guard | mixed | mixed-swap
	fts   string // base | nokw | kw-sa
}

func (c storeCfg) name() string { return c.style + "/" + c.fts }

func styleOfSource(style string, idx int) string {
	switch style {
	case "mixed":
		return []string{"full", "tele"}[idx%2]
	case "mixed-swap":
		return []string{"tele", "full"}[idx%2]
	}
	return style
}

// gatherFacts lists the facts of the primary round (sources srcs) and the distractor rounds in a style.
func gatherFacts(man evalManifest, cfg storeCfg, primary roundData, srcs []evalSource, distract []roundData, keys bool) ([]seedFact, error) {
	var out []seedFact
	add := func(rd roundData, list []evalSource, wantKeys bool) error {
		for i, s := range list {
			rec, ok := rd.recs[s.ID]
			if !ok {
				continue
			}
			style := styleOfSource(cfg.style, i)
			stored, ok := styleFacts(rd.ref, s.ID, rec, style)
			if !ok {
				return fmt.Errorf("%s/%s: no %s facts (run telegraph first)", rd.name, s.ID, style)
			}
			var ks map[string]factKey
			if wantKeys {
				if ks, ok = loadKeys(rd.ref, s.ID); !ok {
					return fmt.Errorf("%s/%s: no keys file", rd.name, s.ID)
				}
			}
			for _, f := range stored {
				k := ks[f.ID]
				sf := seedFact{key: fkey{rd.name, s.ID, f.ID}, src: s, fact: f.Fact, reason: f.Reason, keywords: f.Keywords,
					subject: k.Subject, aspect: k.Aspect, section: sectionOf(s, f.Reason), style: style}
				switch cfg.fts {
				case "nokw":
					sf.keywords = nil
				case "kw-sa":
					if !wantKeys {
						break
					}
					sf.keywords = append([]string{k.Subject, k.Aspect}, f.Keywords...)
				}
				out = append(out, sf)
			}
		}
		return nil
	}
	if err := add(primary, srcs, keys); err != nil {
		return nil, err
	}
	own := map[string]bool{}
	for _, s := range srcs {
		own[s.ID] = true
	}
	for _, d := range distract {
		var list []evalSource
		for _, s := range man.Sources {
			if _, ok := d.recs[s.ID]; ok && !own[s.ID] && (d.scored == nil || d.scored[s.ID]) {
				list = append(list, s)
			}
		}
		if err := add(d, list, false); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func seedStore(ctx context.Context, dir string, facts []seedFact) (*seededStore, error) {
	st := memory.NewStore(filepath.Join(dir, "memory.db"))
	ss := &seededStore{st: st, facts: facts, byKM: map[string]int{}, km: map[fkey]string{}}
	ss.kw = memory.NewService(st, newAgentRunner(), memory.ServiceOptions{})
	groups := map[string]string{}
	for i, f := range facts {
		gk := f.key.Round + "/" + f.key.Source
		if groups[gk] == "" {
			groups[gk] = crockfordID("kg_", len(groups)+1)
		}
		id := crockfordID("km_", i+1)
		ss.byKM[id] = i
		ss.km[f.key] = id
		doc := memfmt.Doc{Group: groups[gk], Title: f.key.Source, From: f.src.fileName(), Version: 3, Keywords: f.keywords, Updated: evalDocDate,
			Provenance: memfmt.Provenance{Origin: memory.OriginAgent, Scope: memory.ScopeProject, Project: evalProject},
			Facts:      []memfmt.Fact{{ID: id, Fact: f.fact, Reason: f.reason, Section: f.section}}}
		res, err := ss.kw.ApplyDoc(ctx, memory.ApplyDocRequest{Doc: doc, FileID: "eval-" + f.key.Round + "-" + f.key.Source, Path: f.src.fileName()})
		if err != nil {
			ss.close()
			return nil, err
		}
		if len(res.Outcomes) != 1 || res.Outcomes[0].Action != memory.ActionAdd {
			ss.close()
			return nil, fmt.Errorf("seed %v: %+v", f.key, res.Outcomes)
		}
	}
	return ss, nil
}

// Ranking helpers.

type hit struct {
	idx   int // index into facts
	chars int
}

func (ss *seededStore) lookup(ms []memory.Memory) []hit {
	out := make([]hit, 0, len(ms))
	for _, m := range ms {
		if i, ok := ss.byKM[m.LineageID]; ok {
			f := ss.facts[i]
			out = append(out, hit{i, len([]rune(f.fact)) + len([]rune(f.reason))})
		}
	}
	return out
}

type grouping string

const (
	groupNone    grouping = "none"
	groupSection grouping = "section"
	groupSubject grouping = "subject"
)

func normSubject(s string) string { return strings.ToLower(strings.Join(strings.Fields(s), " ")) }

func (ss *seededStore) groupKey(g grouping, h hit) string {
	f := ss.facts[h.idx]
	switch g {
	case groupSection:
		return f.key.Round + "/" + f.key.Source + "/" + f.section
	case groupSubject:
		return f.key.Round + "/" + f.key.Source + "/" + normSubject(f.subject)
	}
	return fmt.Sprint(h.idx)
}

// rankAndChars returns the 1-based rank (0 = miss) of the first hit in the answer set and the reading
// cost of the first five groups, counting every member listed.
func (ss *seededStore) rankAndChars(g grouping, hits []hit, q qMeta, round string) (rank, chars5 int) {
	ans := map[string]bool{}
	for _, a := range q.Answers {
		ans[a] = true
	}
	order := []string{}
	pos := map[string]int{}
	for _, h := range hits {
		k := ss.groupKey(g, h)
		if _, ok := pos[k]; !ok {
			pos[k] = len(order) + 1
			order = append(order, k)
		}
		if p := pos[k]; p <= 5 {
			chars5 += h.chars
		}
		f := ss.facts[h.idx]
		if rank == 0 && f.key.Source == q.Source && ans[f.key.ID] && f.key.Round == round {
			rank = pos[k]
		}
	}
	return rank, chars5
}

// Metrics.

type agg struct {
	N, Answerable int
	Hit1, Hit3    float64
	Hit5, Hit10   float64
	MRR           float64
	CHit1, CHit3  float64
	CHit5, CHit10 float64
	CMRR          float64
}

func aggregate(ranks []int, qs []qMeta, keep func(qMeta) bool) agg {
	var a agg
	var h1, h3, h5, h10, mrr, c1, c3, c5, c10, cm float64
	for i, q := range qs {
		if !keep(q) {
			continue
		}
		r := ranks[i]
		a.N++
		rr := 0.0
		if r > 0 {
			rr = 1 / float64(r)
		}
		mrr += math.Min(rr, 1)
		in := func(k int) float64 {
			if r > 0 && r <= k {
				return 1
			}
			return 0
		}
		h1, h3, h5, h10 = h1+in(1), h3+in(3), h5+in(5), h10+in(10)
		if len(q.Answers) > 0 {
			a.Answerable++
			c1, c3, c5, c10, cm = c1+in(1), c3+in(3), c5+in(5), c10+in(10), cm+rr
		}
	}
	a.Hit1, a.Hit3, a.Hit5, a.Hit10, a.MRR = div(h1, float64(a.N)), div(h3, float64(a.N)), div(h5, float64(a.N)), div(h10, float64(a.N)), div(mrr, float64(a.N))
	n := float64(a.Answerable)
	a.CHit1, a.CHit3, a.CHit5, a.CHit10, a.CMRR = div(c1, n), div(c3, n), div(c5, n), div(c10, n), div(cm, n)
	return a
}

func percentiles(v []float64, ps ...float64) []float64 {
	out := make([]float64, len(ps))
	if len(v) == 0 {
		return out
	}
	s := slices.Clone(v)
	sort.Float64s(s)
	for i, p := range ps {
		out[i] = s[min(int(p*float64(len(s)-1)+0.5), len(s)-1)]
	}
	return out
}

func dot(a, b []float32) float64 {
	var s float64
	for i := range a {
		s += float64(a[i]) * float64(b[i])
	}
	return s
}

type calib struct {
	PosP10, PosP50, PosP90 float64
	NegP10, NegP50, NegP90 float64
	NegP99                 float64
	Pos, Neg               int
}

type retrievalFile struct {
	Round       string                    `json:"round"`
	RunsDir     string                    `json:"runsDir"`
	Set         string                    `json:"set"`
	Sources     []string                  `json:"sources"`
	Distractors []string                  `json:"distractors,omitempty"`
	Facts       int                       `json:"facts"`
	Dropped     int                       `json:"leakDropped"`
	Queries     []qMeta                   `json:"queries"`
	Ranks       map[string][]int          `json:"ranks"`
	Agg         map[string]map[string]agg `json:"agg"`
	Chars5      map[string]float64        `json:"chars5"`
	Calibration map[string]calib          `json:"calibration"`
	StylePairs  map[string]map[string]any `json:"stylePairs,omitempty"`
	DocPairs    map[string]map[string]any `json:"docPairs,omitempty"`
	Seconds     int                       `json:"seconds"`
}

func evalModelHome() string {
	if v := os.Getenv("KIRA_EVAL_MODEL_HOME"); v != "" {
		return v
	}
	d, err := os.UserCacheDir()
	if err != nil {
		d = os.TempDir()
	}
	return filepath.Join(d, "kira-eval")
}

func newEvalEmbedder(ctx context.Context) (*evalEmbedder, error) {
	if os.Getenv("KIRA_ORT_LIB") == "" {
		return nil, fmt.Errorf("retrieval needs KIRA_ORT_LIB (scripts/fetch-onnxruntime.sh linux-x64); refusing to run keyword-only")
	}
	home := evalModelHome()
	spec := embed.Default
	if dir := embed.ModelDir(home, spec); !embed.Installed(dir, spec) {
		if err := embed.Install(ctx, dir, spec, nil); err != nil {
			return nil, fmt.Errorf("install embedding model: %w", err)
		}
	}
	c := embed.NewClient(embed.ClientOptions{Spec: spec, Home: home, IdleTimeout: time.Hour,
		Command: func(dir string) *exec.Cmd {
			exe, _ := os.Executable()
			cmd := exec.Command(exe, "--model-dir", dir)
			cmd.Env = append(os.Environ(), "KIRA_EVAL_EMBED_WORKER=1")
			return cmd
		}})
	if _, err := c.Embed(ctx, []string{"warmup"}, false); err != nil {
		return nil, fmt.Errorf("embedding worker: %w", err)
	}
	return &evalEmbedder{inner: c, docs: map[string][]float32{}, qs: map[string][]float32{}}, nil
}

func evalRetrieval(t *testing.T, man evalManifest) {
	ctx := context.Background()
	rounds := splitList(os.Getenv("KIRA_EVAL_ROUNDS"))
	if len(rounds) == 0 {
		t.Fatal("KIRA_EVAL_ROUNDS is required for retrieval mode")
	}
	emb, err := newEvalEmbedder(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer emb.inner.Close()
	styles := splitList(envOr("KIRA_EVAL_STYLES", "full"))
	recipes := splitList(os.Getenv("KIRA_EVAL_RECIPES"))
	set := envOr("KIRA_EVAL_SET", "tuning")
	var distract []roundData
	for _, ref := range splitList(os.Getenv("KIRA_EVAL_DISTRACTORS")) {
		d, err := loadRound(ref)
		if err != nil {
			t.Fatal(err)
		}
		distract = append(distract, d)
	}
	for _, ref := range rounds {
		begin := time.Now()
		rd, err := loadRound(ref)
		if err != nil {
			t.Fatal(err)
		}
		var srcs []evalSource
		for _, s := range pickSources(man, set) {
			if _, ok := rd.recs[s.ID]; ok && len(rd.grades[s.ID].Golden) > 0 {
				srcs = append(srcs, s)
			}
		}
		qs, dropped, err := buildQueries(man, rd, srcs)
		if err != nil {
			t.Fatal(err)
		}
		hasKeys := true
		for _, s := range srcs {
			if _, ok := loadKeys(ref, s.ID); !ok {
				hasKeys = false
			}
		}
		useRecipes := recipes
		if len(useRecipes) == 0 {
			for _, r := range allRecipes {
				if hasKeys || !strings.HasPrefix(r, "sa-") {
					useRecipes = append(useRecipes, r)
				}
			}
		}
		out := retrievalFile{Round: rd.name, RunsDir: runsOf(ref) + controlSuffix(), Set: set, Queries: qs, Dropped: dropped,
			Ranks: map[string][]int{}, Agg: map[string]map[string]agg{}, Chars5: map[string]float64{}, Calibration: map[string]calib{},
			StylePairs: map[string]map[string]any{}, DocPairs: map[string]map[string]any{}}
		for _, s := range srcs {
			out.Sources = append(out.Sources, s.ID)
		}
		for _, d := range distract {
			out.Distractors = append(out.Distractors, d.name)
		}
		var cfgs []storeCfg
		for _, st := range styles {
			cfgs = append(cfgs, storeCfg{st, "base"})
			if st == "full" || st == "tele" {
				cfgs = append(cfgs, storeCfg{st, "nokw"})
			}
			if hasKeys && st == "full" {
				cfgs = append(cfgs, storeCfg{st, "kw-sa"})
			}
		}
		for _, cfg := range cfgs {
			facts, err := gatherFacts(man, cfg, rd, srcs, distract, hasKeys)
			if err != nil {
				t.Fatal(err)
			}
			out.Facts = len(facts)
			ss, err := seedStore(ctx, t.TempDir(), facts)
			if err != nil {
				t.Fatal(err)
			}
			runStore(t, ctx, emb, ss, cfg, useRecipes, qs, rd.name, &out)
			if cfg.fts == "base" {
				calibrate(ctx, emb, ss, cfg, useRecipes, qs, &out)
			}
			ss.close()
		}
		if pair := os.Getenv("KIRA_EVAL_PAIR_ROUND"); pair != "" {
			docPairs(ctx, t, emb, man, rd, pair, &out)
		}
		stylePairs(ctx, t, emb, man, rd, srcs, useRecipes, &out)
		out.Seconds = int(time.Since(begin).Seconds())
		raw, _ := json.Marshal(out)
		suffix := ""
		if set == "holdout" {
			suffix = "@holdout"
		}
		path := filepath.Join(evalRunsDir(), "retrieval", out.RunsDir+"__"+rd.name+suffix+".json")
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, raw, 0o644); err != nil {
			t.Fatal(err)
		}
		base := out.Agg["full/base/fact/hybrid"]["all"]
		t.Logf("%s: %d queries (%d leak-dropped), %d facts, hybrid MRR %.3f hit@10 %.3f (cond %.3f), %ds", rd.name, len(qs), dropped, out.Facts, base.MRR, base.Hit10, base.CHit10, out.Seconds)
	}
}

func controlSuffix() string {
	if os.Getenv("KIRA_EVAL_CONTROL") == "1" {
		return "-control"
	}
	return ""
}

// runsOf is the runs dir a round reference lives in.
func runsOf(ref string) string {
	if i := strings.Index(ref, "/"); i > 0 {
		return ref[:i]
	}
	return filepath.Base(envOr("KIRA_EVAL_RUNS_DIR", "P285-runs"))
}

func variantKey(c storeCfg, recipe, mode string) string { return c.name() + "/" + recipe + "/" + mode }

// runStore runs every query in the three modes for one seeded store.
func runStore(t *testing.T, ctx context.Context, emb *evalEmbedder, ss *seededStore, cfg storeCfg, recipes []string, qs []qMeta, round string, out *retrievalFile) {
	record := func(key string, ranks []int, chars []int) {
		out.Ranks[key] = ranks
		m := map[string]agg{"all": aggregate(ranks, qs, func(qMeta) bool { return true })}
		for _, form := range []string{"question", "query"} {
			m[form] = aggregate(ranks, qs, func(q qMeta) bool { return q.Form == form })
		}
		seenSrc, seenCat := map[string]bool{}, map[string]bool{}
		for _, q := range qs {
			if !seenSrc[q.Source] {
				seenSrc[q.Source] = true
				m["src:"+q.Source] = aggregate(ranks, qs, func(x qMeta) bool { return x.Source == q.Source })
			}
			if !seenCat[q.Category] {
				seenCat[q.Category] = true
				m["cat:"+q.Category] = aggregate(ranks, qs, func(x qMeta) bool { return x.Category == q.Category })
			}
		}
		if strings.HasPrefix(cfg.style, "mixed") {
			styleOf := map[string]string{}
			for _, f := range ss.facts {
				if f.key.Round == out.Round {
					styleOf[f.key.Source] = f.style
				}
			}
			for _, st := range []string{"full", "tele"} {
				m["style:"+st] = aggregate(ranks, qs, func(q qMeta) bool { return styleOf[q.Source] == st })
			}
		}
		out.Agg[key] = m
		if chars != nil {
			var sum float64
			for _, c := range chars {
				sum += float64(c)
			}
			out.Chars5[key] = div(sum, float64(len(chars)))
		}
	}
	runMode := func(svc *memory.Service, limit int, g grouping) ([]int, []int) {
		ranks, chars := make([]int, len(qs)), make([]int, len(qs))
		for i, q := range qs {
			ms, err := svc.Search(ctx, memory.SearchArgs{Query: q.Text, Limit: limit, Project: evalProject})
			if err != nil {
				t.Fatalf("search %q: %v", q.Text, err)
			}
			ranks[i], chars[i] = ss.rankAndChars(g, ss.lookup(ms), q, round)
		}
		return ranks, chars
	}
	// keyword: the real path without an embedder
	for _, g := range []grouping{groupNone} {
		r, c := runMode(ss.kw, 10, g)
		record(variantKey(cfg, "-", "keyword"), r, c)
	}
	runner := newAgentRunner()
	for _, recipe := range recipes {
		docText := map[string]string{}
		for _, f := range ss.facts {
			if _, ok := docText[f.fact]; !ok {
				docText[f.fact] = recipeText(recipe, f)
			}
		}
		re := &recipeEmbedder{e: emb, recipe: recipe, docText: docText}
		svc := memory.NewService(ss.st, runner, memory.ServiceOptions{Embedder: re})
		svc.StartBackfill()
		deadline := time.Now().Add(10 * time.Minute)
		for {
			st, err := svc.SemanticStatus(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if st.State == memory.SemanticReady && st.Done == st.Total {
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("backfill not done: %+v", st)
			}
			time.Sleep(200 * time.Millisecond)
		}
		r, c := runMode(svc, 10, groupNone)
		record(variantKey(cfg, recipe, "hybrid"), r, c)
		if cfg.fts == "base" {
			// grouping reads a longer list (limit 30), groups collapse in order of first appearance
			for _, g := range []grouping{groupNone, groupSection, groupSubject} {
				if g == groupSubject && !strings.HasPrefix(recipe, "sa-") {
					continue
				}
				r, c := runMode(svc, 30, g)
				record(variantKey(cfg, recipe, "hybrid+"+string(g)+"30"), r, c)
			}
			// semantic: cosine ranking by the same client
			docs := make([]string, len(ss.facts))
			for i, f := range ss.facts {
				docs[i] = recipeText(recipe, f)
			}
			dv, err := emb.vecs(ctx, docs, false)
			if err != nil {
				t.Fatal(err)
			}
			qtext := make([]string, len(qs))
			for i, q := range qs {
				qtext[i] = q.Text
			}
			qv, err := emb.vecs(ctx, qtext, true)
			if err != nil {
				t.Fatal(err)
			}
			ranks, chars := make([]int, len(qs)), make([]int, len(qs))
			for i, q := range qs {
				type sc struct {
					idx int
					s   float64
				}
				all := make([]sc, len(docs))
				for j := range docs {
					all[j] = sc{j, dot(qv[i], dv[j])}
				}
				sort.SliceStable(all, func(a, b int) bool { return all[a].s > all[b].s })
				var hits []hit
				for _, x := range all[:10] {
					f := ss.facts[x.idx]
					hits = append(hits, hit{x.idx, len([]rune(f.fact)) + len([]rune(f.reason))})
				}
				ranks[i], chars[i] = ss.rankAndChars(groupNone, hits, q, round)
			}
			record(variantKey(cfg, recipe, "semantic"), ranks, chars)
		}
		svc.Close()
	}
}

// calibrate records query-to-answer (positive) and query-to-other-source (negative) cosines per recipe.
func calibrate(ctx context.Context, emb *evalEmbedder, ss *seededStore, cfg storeCfg, recipes []string, qs []qMeta, out *retrievalFile) {
	qtext := make([]string, len(qs))
	for i, q := range qs {
		qtext[i] = q.Text
	}
	qv, err := emb.vecs(ctx, qtext, true)
	if err != nil {
		return
	}
	for _, recipe := range recipes {
		docs := make([]string, len(ss.facts))
		for i, f := range ss.facts {
			docs[i] = recipeText(recipe, f)
		}
		dv, err := emb.vecs(ctx, docs, false)
		if err != nil {
			return
		}
		var pos, neg []float64
		for i, q := range qs {
			ans := map[string]bool{}
			for _, a := range q.Answers {
				ans[a] = true
			}
			best := -2.0
			for j, f := range ss.facts {
				c := dot(qv[i], dv[j])
				switch {
				case f.key.Round == out.Round && f.key.Source == q.Source:
					if ans[f.key.ID] && c > best {
						best = c
					}
				default:
					neg = append(neg, c)
				}
			}
			if best > -2 {
				pos = append(pos, best)
			}
		}
		p, n := percentiles(pos, 0.1, 0.5, 0.9), percentiles(neg, 0.1, 0.5, 0.9, 0.99)
		out.Calibration[cfg.style+"/"+recipe] = calib{p[0], p[1], p[2], n[0], n[1], n[2], n[3], len(pos), len(neg)}
	}
}

// stylePairs: cosine of each full fact with its telegraphic rewrite, per recipe `fact` and fact-kw.
func stylePairs(ctx context.Context, t *testing.T, emb *evalEmbedder, man evalManifest, rd roundData, srcs []evalSource, recipes []string, out *retrievalFile) {
	var a, b []string
	var subjectCut int
	var total int
	for _, s := range srcs {
		rec := rd.recs[s.ID]
		tele, ok := styleFacts(rd.ref, s.ID, rec, "tele")
		if !ok {
			return
		}
		for i, f := range rec.Stored {
			a, b = append(a, f.Fact), append(b, tele[i].Fact)
			total++
			if len(textloss.Names(f.Fact)) > 0 && len(textloss.Names(tele[i].Fact)) == 0 {
				subjectCut++
			}
		}
	}
	av, err1 := emb.vecs(ctx, a, false)
	bv, err2 := emb.vecs(ctx, b, false)
	if err1 != nil || err2 != nil {
		return
	}
	cos := make([]float64, len(a))
	below := 0
	for i := range a {
		cos[i] = dot(av[i], bv[i])
		if cos[i] < float64(embed.Default.DocFloor) {
			below++
		}
	}
	p := percentiles(cos, 0.1, 0.5, 0.9)
	out.StylePairs["fact"] = map[string]any{"n": total, "p10": p[0], "p50": p[1], "p90": p[2], "belowDocFloor": below, "subjectCut": subjectCut}
}

// docPairs: doc-to-doc cosine of paraphrase pairs (stored facts covering the same golden fact in two
// rounds, one stored fact each) against random unrelated pairs.
func docPairs(ctx context.Context, t *testing.T, emb *evalEmbedder, man evalManifest, rd roundData, pairRef string, out *retrievalFile) {
	other, err := loadRound(pairRef)
	if err != nil {
		t.Logf("pair round: %v", err)
		return
	}
	var a, b []string
	var all []string
	for _, s := range man.Sources {
		ra, rb := rd.recs[s.ID], other.recs[s.ID]
		fa, fb := map[string]string{}, map[string]string{}
		for _, f := range ra.Stored {
			fa[f.ID] = f.Fact
			all = append(all, f.Fact)
		}
		for _, f := range rb.Stored {
			fb[f.ID] = f.Fact
		}
		gb := map[string]goldenGrade{}
		for _, g := range other.grades[s.ID].Golden {
			gb[g.ID] = g
		}
		for _, g := range rd.grades[s.ID].Golden {
			o := gb[g.ID]
			if g.Covered == "full" && o.Covered == "full" && len(g.By) == 1 && len(o.By) == 1 {
				a, b = append(a, fa[g.By[0]]), append(b, fb[o.By[0]])
			}
		}
	}
	if len(a) == 0 {
		return
	}
	rng := rand.New(rand.NewSource(291))
	var u1, u2 []string
	for range 2000 {
		x, y := all[rng.Intn(len(all))], all[rng.Intn(len(all))]
		if x != y {
			u1, u2 = append(u1, x), append(u2, y)
		}
	}
	cosOf := func(x, y []string) []float64 {
		xv, err1 := emb.vecs(ctx, x, false)
		yv, err2 := emb.vecs(ctx, y, false)
		if err1 != nil || err2 != nil {
			return nil
		}
		c := make([]float64, len(x))
		for i := range x {
			c[i] = dot(xv[i], yv[i])
		}
		return c
	}
	pp, up := percentiles(cosOf(a, b), 0.1, 0.5, 0.9), percentiles(cosOf(u1, u2), 0.5, 0.9, 0.99)
	out.DocPairs["fact"] = map[string]any{"pairRound": other.name, "paraphrasePairs": len(a), "paraphraseP10": pp[0], "paraphraseP50": pp[1], "paraphraseP90": pp[2],
		"unrelatedP50": up[0], "unrelatedP90": up[1], "unrelatedP99": up[2]}
}

// Compare.

type cmpOut struct {
	A       string             `json:"a"`
	B       string             `json:"b"`
	Form    map[string]cmpForm `json:"forms"`
	Seconds int                `json:"-"`
}

type cmpForm struct {
	N                    int
	MeanA, MeanB, Delta  float64
	CILow, CIHigh        float64
	HitA, HitB           float64
	ConditionalDelta     float64
	ConditionalN         int
	ConditionalCILow     float64
	ConditionalCIHigh    float64
	ConditionalMeanA     float64
	ConditionalMeanB     float64
	ConditionalHit10A    float64
	ConditionalHit10B    float64
	ConditionalHit10Diff float64
}

func loadRetrieval(name string) (retrievalFile, error) {
	var f retrievalFile
	dir := filepath.Join(evalRunsDir(), "retrieval")
	for _, cand := range []string{name, runsOf(name) + "__" + name} {
		raw, err := os.ReadFile(filepath.Join(dir, strings.ReplaceAll(cand, "/", "__")+".json"))
		if err == nil {
			return f, json.Unmarshal(raw, &f)
		}
	}
	return f, fmt.Errorf("no retrieval file for %q in %s", name, dir)
}

func rrOf(r int) float64 {
	if r <= 0 {
		return 0
	}
	return 1 / float64(r)
}

// bootstrap returns the mean of d and its 95% CI from 2000 resamples (fixed seed).
func bootstrap(d []float64) (mean, lo, hi float64) {
	if len(d) == 0 {
		return
	}
	for _, x := range d {
		mean += x
	}
	mean /= float64(len(d))
	rng := rand.New(rand.NewSource(291))
	means := make([]float64, 2000)
	for i := range means {
		var s float64
		for range d {
			s += d[rng.Intn(len(d))]
		}
		means[i] = s / float64(len(d))
	}
	sort.Float64s(means)
	return mean, means[int(0.025*float64(len(means)))], means[int(0.975*float64(len(means)))]
}

func evalCompare(t *testing.T) {
	rounds := splitList(os.Getenv("KIRA_EVAL_ROUNDS"))
	vars := splitList(envOr("KIRA_EVAL_VARIANTS", "full/base/fact/hybrid"))
	if len(rounds) == 0 || len(rounds) > 2 || len(vars) == 0 || len(vars) > 2 {
		t.Fatal("compare wants KIRA_EVAL_ROUNDS=<a[,b]> and KIRA_EVAL_VARIANTS=<x[,y]>")
	}
	if len(rounds) == 1 {
		rounds = append(rounds, rounds[0])
	}
	if len(vars) == 1 {
		vars = append(vars, vars[0])
	}
	fa, err := loadRetrieval(rounds[0])
	if err != nil {
		t.Fatal(err)
	}
	fb, err := loadRetrieval(rounds[1])
	if err != nil {
		t.Fatal(err)
	}
	ra, rb := fa.Ranks[vars[0]], fb.Ranks[vars[1]]
	if ra == nil || rb == nil {
		t.Fatalf("variant missing: %q in %s or %q in %s", vars[0], rounds[0], vars[1], rounds[1])
	}
	idxB := map[string]int{}
	for i, q := range fb.Queries {
		idxB[q.id()] = i
	}
	res := cmpOut{A: rounds[0] + "|" + vars[0], B: rounds[1] + "|" + vars[1], Form: map[string]cmpForm{}}
	for _, form := range []string{"question", "query", "all"} {
		var d, a, b, cd []float64
		var ha, hb, cha, chb float64
		var ca, cb []float64
		for i, q := range fa.Queries {
			j, ok := idxB[q.id()]
			if !ok || (form != "all" && q.Form != form) {
				continue
			}
			x, y := rrOf(ra[i]), rrOf(rb[j])
			d, a, b = append(d, y-x), append(a, x), append(b, y)
			if ra[i] > 0 && ra[i] <= 10 {
				ha++
			}
			if rb[j] > 0 && rb[j] <= 10 {
				hb++
			}
			if len(q.Answers) > 0 && len(fb.Queries[j].Answers) > 0 {
				cd, ca, cb = append(cd, y-x), append(ca, x), append(cb, y)
				if ra[i] > 0 && ra[i] <= 10 {
					cha++
				}
				if rb[j] > 0 && rb[j] <= 10 {
					chb++
				}
			}
		}
		var f cmpForm
		f.N = len(d)
		f.Delta, f.CILow, f.CIHigh = bootstrap(d)
		f.MeanA, _, _ = bootstrap(a)
		f.MeanB, _, _ = bootstrap(b)
		f.HitA, f.HitB = div(ha, float64(len(d))), div(hb, float64(len(d)))
		f.ConditionalN = len(cd)
		f.ConditionalDelta, f.ConditionalCILow, f.ConditionalCIHigh = bootstrap(cd)
		f.ConditionalMeanA, _, _ = bootstrap(ca)
		f.ConditionalMeanB, _, _ = bootstrap(cb)
		f.ConditionalHit10A, f.ConditionalHit10B = div(cha, float64(len(cd))), div(chb, float64(len(cd)))
		f.ConditionalHit10Diff = f.ConditionalHit10B - f.ConditionalHit10A
		res.Form[form] = f
	}
	name := strings.NewReplacer("/", "_", "|", "~").Replace(rounds[0]+"~"+vars[0]+"__"+rounds[1]+"~"+vars[1]) + ".json"
	dir := filepath.Join(evalRunsDir(), "compare")
	_ = os.MkdirAll(dir, 0o755)
	raw, _ := json.MarshalIndent(res, "", " ")
	if err := os.WriteFile(filepath.Join(dir, name), append(raw, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
	f := res.Form["all"]
	t.Logf("%s vs %s: MRR %.3f -> %.3f, delta %+.3f CI [%+.3f, %+.3f], n %d; cond delta %+.3f CI [%+.3f, %+.3f]", res.A, res.B, f.MeanA, f.MeanB, f.Delta, f.CILow, f.CIHigh, f.N,
		f.ConditionalDelta, f.ConditionalCILow, f.ConditionalCIHigh)
}
