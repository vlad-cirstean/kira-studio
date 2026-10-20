package memory

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/kirathecat/kira-studio/internal/harness"
	"github.com/kirathecat/kira-studio/internal/harness/claude"
	"github.com/kirathecat/kira-studio/internal/llmprompts"
	"github.com/kirathecat/kira-studio/internal/memory/embed"
	"github.com/kirathecat/kira-studio/internal/memory/memfmt"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

type fakeRunner struct {
	calls []string // "gate" | "reconcile"
	gate  func(in gateInput) string
	rec   func(in map[string]any) string
	hook  func(kind string)
}

func (f *fakeRunner) Fail(kind error) error { return claude.New().Fail(kind) }

func (f *fakeRunner) Run(_ context.Context, c Call) (json.RawMessage, error) {
	kind := "reconcile"
	if c.System == llmprompts.MemoryGateSystem.Text(llmprompts.Defaults(), llmprompts.GateVars{MaxKeywords: MaxKeywords}) {
		kind = "gate"
	}
	f.calls = append(f.calls, kind)
	if f.hook != nil {
		f.hook(kind)
	}
	if kind == "gate" {
		var in gateInput
		_ = json.Unmarshal([]byte(c.Input), &in)
		return json.RawMessage(f.gate(in)), nil
	}
	var in map[string]any
	_ = json.Unmarshal([]byte(c.Input), &in)
	return json.RawMessage(f.rec(in)), nil
}

func (f *fakeRunner) count(kind string) int {
	n := 0
	for _, c := range f.calls {
		if c == kind {
			n++
		}
	}
	return n
}

// acceptAll echoes each item as one fact.
func acceptAll(in gateInput) string {
	var items []map[string]any
	for _, gi := range in.Items {
		items = append(items, map[string]any{"index": gi.Index, "verdict": "accept", "questions": []string{},
			"facts": []map[string]any{{"fact": gi.Fact, "reason": gi.Reason, "keywords": []string{"kw"}}}})
	}
	b, _ := json.Marshal(map[string]any{"items": items})
	return string(b)
}

// it is a personal fact stated by the user.
func it(fact, reason string) Item {
	return Item{Fact: fact, Reason: reason, Origin: OriginUser, Scope: ScopePersonal}
}

func req(items ...Item) StoreRequest {
	return StoreRequest{Items: items, Source: SourceUI}
}

func newService(t *testing.T, r Runner) (*Service, *Store) {
	st := newStore(t)
	return NewService(st, r, ServiceOptions{}), st
}

func TestChallengeStoresNothing(t *testing.T) {
	fr := &fakeRunner{gate: func(in gateInput) string {
		return `{"items":[{"index":0,"verdict":"accept","questions":[],"facts":[{"fact":"a clear fact","reason":"r","keywords":[]}]},
			{"index":1,"verdict":"challenge","questions":["Which project?"],"facts":[]}]}`
	}}
	svc, st := newService(t, fr)
	res, err := svc.Store(context.Background(), req(it("a clear fact", "r"), it("it uses 8080", "because")))
	if err != nil || res.Status != "challenged" || len(res.Challenges) != 1 || res.Challenges[0].Index != 1 {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	if rows, _ := st.Recent(context.Background(), 10); len(rows) != 0 {
		t.Errorf("a challenge must store nothing, got %v", facts(rows))
	}
}

func TestSplitAndNoCandidatesSkipsReconcile(t *testing.T) {
	fr := &fakeRunner{gate: func(in gateInput) string {
		return `{"items":[{"index":0,"verdict":"accept","questions":[],"facts":[
			{"fact":"alpha service owns billing","reason":"org chart","keywords":["billing"]},
			{"fact":"zebra cluster is in eu-west","reason":"infra doc","keywords":["region"]}]}]}`
	}}
	svc, st := newService(t, fr)
	res, err := svc.Store(context.Background(), req(it("alpha owns billing and zebra is in eu-west", "docs")))
	if err != nil || len(res.Outcomes) != 2 {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	if fr.count("reconcile") != 0 {
		t.Error("no candidates must not call reconcile")
	}
	if rows, _ := st.Recent(context.Background(), 10); len(rows) != 2 {
		t.Errorf("rows = %v", facts(rows))
	}
}

func TestHashShortCircuit(t *testing.T) {
	fr := &fakeRunner{gate: acceptAll}
	svc, _ := newService(t, fr)
	if _, err := svc.Store(context.Background(), req(it("Port is 8080", "ops"))); err != nil {
		t.Fatal(err)
	}
	res, err := svc.Store(context.Background(), req(it("port is  8080", "OPS")))
	if err != nil || res.Outcomes[0].Action != ActionNoop {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	if fr.count("reconcile") != 0 {
		t.Error("hash short-circuit must not call reconcile")
	}
}

func updateAll(in map[string]any) string {
	facts := in["facts"].([]any)
	var ds []map[string]any
	for _, f := range facts {
		fm := f.(map[string]any)
		cs := fm["candidates"].([]any)
		ds = append(ds, map[string]any{"index": fm["index"], "action": "update", "target": cs[0].(map[string]any)["id"],
			"fact": fm["fact"], "reason": fm["reason"], "why": "refines"})
	}
	b, _ := json.Marshal(map[string]any{"decisions": ds})
	return string(b)
}

func TestUpdateSupersedesAndKeepsHistory(t *testing.T) {
	fr := &fakeRunner{gate: acceptAll, rec: updateAll}
	svc, _ := newService(t, fr)
	ctx := context.Background()
	if _, err := svc.Store(ctx, req(it("api port is 8080", "initial"))); err != nil {
		t.Fatal(err)
	}
	res, err := svc.Store(ctx, req(it("api port is 9090", "moved")))
	if err != nil || res.Outcomes[0].Action != ActionUpdate || res.Outcomes[0].Version != 2 {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	cur, _ := svc.Search(ctx, SearchArgs{Query: "port"})
	all, _ := svc.Search(ctx, SearchArgs{Query: "port", IncludeHistory: true})
	if len(cur) != 1 || len(all) != 2 {
		t.Fatalf("current=%v all=%v", facts(cur), facts(all))
	}
	h, err := svc.History(ctx, all[0].ID)
	if err != nil || len(h.Memories) != 2 || len(h.Events) != 2 || h.Events[1].Action != ActionUpdate {
		t.Fatalf("history=%+v err=%v", h, err)
	}
}

func TestForeignTargetFailsOnlyThatFact(t *testing.T) {
	fr := &fakeRunner{
		gate: func(in gateInput) string {
			return `{"items":[{"index":0,"verdict":"accept","questions":[],"facts":[
				{"fact":"redis cache size is 2gb","reason":"r","keywords":[]},
				{"fact":"postgres cache size is 4gb","reason":"r","keywords":[]}]}]}`
		},
		rec: func(in map[string]any) string {
			fs := in["facts"].([]any)
			c0 := fs[0].(map[string]any)["candidates"].([]any)[0].(map[string]any)["id"]
			return `{"decisions":[{"index":0,"action":"update","target":"` + c0.(string) + `","fact":"x","reason":"y","why":"w"},
				{"index":1,"action":"noop","target":"` + c0.(string) + `","fact":"","reason":"","why":"w"}]}`
		},
	}
	svc, st := newService(t, fr)
	add(t, st, "redis cache size is 1gb", "old")
	add(t, st, "postgres cache size is 3gb", "old")
	res, err := svc.Store(context.Background(), req(it("cache sizes", "r")))
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Outcomes) != 2 || res.Outcomes[1].Action != ActionFailed || res.Outcomes[0].Action == ActionFailed {
		t.Fatalf("outcomes=%+v", res.Outcomes)
	}
}

func TestConcurrentWriterRetriesThenFails(t *testing.T) {
	fr := &fakeRunner{gate: acceptAll, rec: updateAll}
	svc, st := newService(t, fr)
	add(t, st, "deploy target is staging", "seed")
	n := 0
	fr.hook = func(kind string) {
		if kind == "reconcile" {
			n++
			add(t, st, "unrelated filler "+strings.Repeat("x", n), "bump")
		}
	}
	res, err := svc.Store(context.Background(), req(it("deploy target is production", "r")))
	if err != nil {
		t.Fatal(err)
	}
	if o := res.Outcomes[0]; o.Action != ActionFailed || !strings.Contains(o.Error, "changed concurrently") {
		t.Fatalf("outcome=%+v", o)
	}
	if fr.count("reconcile") != 3 {
		t.Errorf("reconcile calls = %d, want 1 + 2 retries", fr.count("reconcile"))
	}
}

func TestStaleRedecidesLaterFacts(t *testing.T) {
	fr := &fakeRunner{
		gate: func(in gateInput) string {
			return `{"items":[{"index":0,"verdict":"accept","questions":[],"facts":[
				{"fact":"deploy target is production","reason":"r","keywords":[]},
				{"fact":"zebra cluster is in eu-west","reason":"r","keywords":[]}]}]}`
		},
		rec: updateAll,
	}
	svc, st := newService(t, fr)
	add(t, st, "deploy target is staging", "seed")
	first := true
	fr.hook = func(kind string) {
		if kind == "reconcile" && first {
			first = false
			add(t, st, "zebra cluster is in eu-west region", "foreign")
		}
	}
	res, err := svc.Store(context.Background(), req(it("deploy and zebra", "r")))
	if err != nil || len(res.Outcomes) != 2 {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	if o := res.Outcomes[1]; o.Action != ActionUpdate {
		t.Fatalf("later fact outcome = %+v, want update of the foreign fact", o)
	}
}

func TestGateMissingIndexIsOutputError(t *testing.T) {
	fr := &fakeRunner{gate: func(gateInput) string { return `{"items":[]}` }}
	svc, st := newService(t, fr)
	_, err := svc.Store(context.Background(), req(it("some fact", "r")))
	if !errors.Is(err, harness.ErrOutput) {
		t.Fatalf("err = %v", err)
	}
	if rows, _ := st.Recent(context.Background(), 10); len(rows) != 0 {
		t.Error("nothing may be stored")
	}
}

// fakeEmbedder maps text to a fixed unit vector; unknown text embeds to the zero vector. A set
// err makes every call fail.
type fakeEmbedder struct {
	vecs map[string][]float32
	err  error
}

func (f *fakeEmbedder) Spec() embed.Spec {
	return embed.Spec{ID: "fake", Dim: 3, QueryPrefix: "q: ", DocFloor: 0.85, QueryFloor: 0, QueryCeil: 1}
}

func (f *fakeEmbedder) Status() embed.Status { return embed.Status{State: embed.StateReady} }

func (f *fakeEmbedder) Embed(_ context.Context, texts []string, _ bool) ([][]float32, error) {
	if f.err != nil {
		return nil, f.err
	}
	out := make([][]float32, len(texts))
	for i, t := range texts {
		out[i] = f.vecs[t]
		if out[i] == nil {
			out[i] = []float32{0, 0, 0}
		}
	}
	return out, nil
}

func TestHybridSearchUnionsKeywordAndSemantic(t *testing.T) {
	ctx := context.Background()
	emb := &fakeEmbedder{vecs: map[string][]float32{
		"uses postgres for billing":    {1, 0, 0},
		"prefers tabs for indentation": {0, 1, 0},
		"deploys happen on fridays":    {0, 0, 1},
		"whitespace conventions":       {0, 1, 0}, // no word shared with the tabs fact
		"postgres":                     {0, 0, 1}, // keyword hit, but vector points at fridays
		"tabs":                         {0, 1, 0},
	}}
	st := newStore(t)
	svc := NewService(st, nil, ServiceOptions{Embedder: emb})
	t.Cleanup(svc.Close)
	for _, f := range []string{"uses postgres for billing", "prefers tabs for indentation", "deploys happen on fridays"} {
		add(t, st, f, "why")
	}
	for svc.backfillOnce(ctx) {
	}

	byFact := func(ms []Memory) map[string]string {
		out := map[string]string{}
		for _, m := range ms {
			out[m.Fact] = m.Match
		}
		return out
	}

	got, err := svc.Search(ctx, SearchArgs{Query: "whitespace conventions", Limit: 1})
	if err != nil || len(got) != 1 || got[0].Fact != "prefers tabs for indentation" || got[0].Match != matchSemantic {
		t.Fatalf("semantic-only: %+v, %v", got, err)
	}

	got, _ = svc.Search(ctx, SearchArgs{Query: "postgres", Limit: 2})
	m := byFact(got)
	if len(got) != 2 || m["uses postgres for billing"] != matchKeyword || m["deploys happen on fridays"] != matchSemantic {
		t.Fatalf("union: %+v", got)
	}
	if got[0].Fact != "uses postgres for billing" {
		t.Errorf("keyword part breaks the relevance tie: %v", facts(got))
	}

	got, _ = svc.Search(ctx, SearchArgs{Query: "tabs", Limit: 1})
	if len(got) != 1 || got[0].Match != matchBoth {
		t.Fatalf("both: %+v", got)
	}
	if sc := got[0].Score; sc == nil || sc.Keyword <= 0 || sc.Semantic != 1 || sc.Relevance <= sc.Keyword*0.45 || sc.Total < sc.Relevance {
		t.Fatalf("both-source score parts: %+v", sc)
	}

	emb.err = errors.New("worker down")
	got, err = svc.Search(ctx, SearchArgs{Query: "postgres"})
	if err != nil || len(got) != 1 || got[0].Match != matchKeyword {
		t.Fatalf("embedder failure should leave keyword results: %+v, %v", got, err)
	}
}

func TestNoChallengeStoresAcceptedItems(t *testing.T) {
	var sawFlag bool
	fr := &fakeRunner{gate: func(in gateInput) string {
		sawFlag = in.Challenge != nil && !*in.Challenge
		return `{"items":[{"index":0,"verdict":"accept","questions":[],"facts":[{"fact":"a clear fact","reason":"r","keywords":[]}]},
			{"index":1,"verdict":"challenge","questions":["Which project?"],"facts":[]}]}`
	}}
	svc, _ := newService(t, fr)
	r := req(it("a clear fact", "r"), it("it uses 8080", "because"))
	r.NoChallenge = true
	res, err := svc.Store(context.Background(), r)
	if err != nil || res.Status != "stored" || len(res.Outcomes) != 1 || len(res.Challenges) != 1 || res.Challenges[0].Index != 1 || !sawFlag {
		t.Fatalf("res=%+v err=%v flag=%v", res, err, sawFlag)
	}
}

func TestApplyDocDecisions(t *testing.T) {
	svc, st := newService(t, &fakeRunner{})
	ctx := context.Background()
	const (
		group = "kg_0123456789ab"
		a, b  = "km_0123456789ab", "km_0123456789ac"
		c, d  = "km_0123456789ad", "km_0123456789ae"
	)
	doc := func(origin string, facts ...memfmt.Fact) memfmt.Doc {
		p := memfmt.Provenance{Origin: origin, Scope: ScopePersonal}
		if origin == OriginExternal {
			p.Source = "doc"
		}
		return memfmt.Doc{Group: group, Title: "Notes", Provenance: p, Facts: facts}
	}
	applyAt := func(dc memfmt.Doc, path string) map[string]string {
		t.Helper()
		res, err := svc.ApplyDoc(ctx, ApplyDocRequest{Doc: dc, FileID: "file-1", Path: path})
		if err != nil {
			t.Fatal(err)
		}
		got := map[string]string{"orphaned": strconv.Itoa(res.Orphaned)}
		for _, o := range res.Outcomes {
			got[o.ID] = o.Action
		}
		return got
	}
	apply := func(dc memfmt.Doc) map[string]string { return applyAt(dc, "") }
	same := func(got map[string]string, want map[string]string) {
		t.Helper()
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	}

	same(apply(doc(OriginExternal,
		memfmt.Fact{ID: a, Fact: "api port is 8080", Reason: "ops"},
		memfmt.Fact{ID: b, Fact: "cache is redis", Reason: "ops"},
		memfmt.Fact{ID: c, Fact: "queue is nats", Reason: "ops"})),
		map[string]string{a: "add", b: "add", c: "add", "orphaned": "0"})
	same(apply(doc(OriginExternal,
		memfmt.Fact{ID: a, Fact: "API port is 8080", Reason: "ops"},
		memfmt.Fact{ID: b, Fact: "cache is valkey", Reason: "ops"})),
		map[string]string{a: "noop", b: "update", "orphaned": "1"})

	// A user fact outranks an agent doc; an equal or higher doc still updates.
	same(apply(doc(OriginUser, memfmt.Fact{ID: d, Fact: "deploys run on friday", Reason: "team rule"})),
		map[string]string{d: "add", "orphaned": "3"})
	same(apply(doc(OriginAgent, memfmt.Fact{ID: d, Fact: "deploys never run on friday", Reason: "guess"})),
		map[string]string{d: DocSkipped, "orphaned": "3"})

	// A fact without a reason rebuilds the source locator from "from", else from the doc's own path,
	// and a second apply of the same doc is a noop. An update keeps the stored keywords.
	const e, f = "km_0123456789af", "km_0123456789ag"
	withFrom := doc(OriginUser, memfmt.Fact{ID: e, Fact: "jobs run nightly", Section: "Jobs"}, memfmt.Fact{ID: f, Fact: "queue depth is 10"})
	withFrom.Keywords, withFrom.From = []string{"cron"}, "docs/ops.md"
	same(applyAt(withFrom, "docs/other.md"), map[string]string{e: "add", f: "add", "orphaned": "4"})
	same(applyAt(withFrom, "docs/other.md"), map[string]string{e: "noop", f: "noop", "orphaned": "4"})
	stored := func(id string) Memory {
		t.Helper()
		h, err := svc.History(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		return h.Memories[len(h.Memories)-1]
	}
	if m := stored(e); m.Reason != "Stated in docs/ops.md, Jobs" || !reflect.DeepEqual(m.Keywords, []string{"cron"}) {
		t.Errorf("section fact = %+v", m)
	}
	if m := stored(f); m.Reason != "Stated in docs/ops.md" {
		t.Errorf("section-less fact reason = %q", m.Reason)
	}
	withFrom.From = ""
	withFrom.Keywords = []string{"other"}
	same(applyAt(withFrom, "docs/ops.md"), map[string]string{e: "noop", f: "noop", "orphaned": "4"})
	withFrom.Facts[0].Fact = "jobs run hourly"
	same(applyAt(withFrom, "docs/ops.md"), map[string]string{e: "update", f: "noop", "orphaned": "4"})
	if m := stored(e); m.Fact != "jobs run hourly" || !reflect.DeepEqual(m.Keywords, []string{"cron"}) {
		t.Errorf("updated fact = %+v", m)
	}

	h, err := svc.History(ctx, b)
	if err != nil || len(h.Memories) != 2 || h.Memories[1].Fact != "cache is valkey" || h.Events[0].Source != SourceImport ||
		h.Events[0].SourceRef == nil || *h.Events[0].SourceRef != "file-1" {
		t.Fatalf("history=%+v err=%v", h, err)
	}
	if rows, _ := st.Recent(ctx, 10); len(rows) != 6 {
		t.Errorf("rows = %v", facts(rows))
	}
}

// TestImportPinsLocatorReason: gate and reconcile reword reasons, yet an import-mode add or update
// commits the item's source locator, or the bare locator when the item's reason is not one.
func TestImportPinsLocatorReason(t *testing.T) {
	reword := func(in gateInput) string {
		var items []map[string]any
		for _, gi := range in.Items {
			items = append(items, map[string]any{"index": gi.Index, "verdict": "accept", "questions": []string{},
				"facts": []map[string]any{{"fact": gi.Fact, "reason": "Reworded quote", "keywords": []string{"billing"}}}})
		}
		b, _ := json.Marshal(map[string]any{"items": items})
		return string(b)
	}
	updateReworded := func(in map[string]any) string {
		var ds []map[string]any
		for _, f := range in["facts"].([]any) {
			fm := f.(map[string]any)
			ds = append(ds, map[string]any{"index": fm["index"], "action": "update", "target": fm["candidates"].([]any)[0].(map[string]any)["id"],
				"fact": fm["fact"], "reason": "Reconcile wording", "why": "refines"})
		}
		b, _ := json.Marshal(map[string]any{"decisions": ds})
		return string(b)
	}
	svc, st := newService(t, &fakeRunner{gate: reword, rec: updateReworded})
	ctx := context.Background()
	store := func(items ...Item) {
		t.Helper()
		r := req(items...)
		r.Source, r.SourceRef, r.ImportPath = SourceImport, "file-1", "docs/a.md"
		if _, err := svc.Store(ctx, r); err != nil {
			t.Fatal(err)
		}
	}
	reasons := func() map[string]string {
		rows, _ := st.Recent(ctx, 10)
		out := map[string]string{}
		for _, m := range rows {
			out[m.Fact] = m.Reason
		}
		return out
	}
	store(it("billing port is 8080", "Stated in docs/a.md, Ports > Billing"), it("billing queue is nats", "a quote from the file"),
		it("billing cache is redis", "Stated in docs/other.md, Cache"))
	want := map[string]string{
		"billing port is 8080":   "Stated in docs/a.md, Ports > Billing",
		"billing queue is nats":  "Stated in docs/a.md",
		"billing cache is redis": "Stated in docs/a.md",
	}
	if got := reasons(); !reflect.DeepEqual(got, want) {
		t.Fatalf("added reasons = %v, want %v", got, want)
	}
	store(it("billing port is 9090", "Stated in docs/a.md, Ports > Billing v2"))
	if got := reasons(); got["billing port is 9090"] != "Stated in docs/a.md, Ports > Billing v2" || len(got) != 3 {
		t.Fatalf("updated reasons = %v, want the locator kept over the reconcile wording", got)
	}
}
