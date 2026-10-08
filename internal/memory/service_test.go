package memory

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

type fakeRunner struct {
	calls []string // "gate" | "reconcile"
	gate  func(in gateInput) string
	rec   func(in map[string]any) string
	hook  func(kind string)
}

func (f *fakeRunner) Run(_ context.Context, c Call) (json.RawMessage, error) {
	kind := "reconcile"
	if c.System == gatePrompt {
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
	for _, it := range in.Items {
		items = append(items, map[string]any{"index": it.Index, "verdict": "accept", "questions": []string{},
			"facts": []map[string]any{{"fact": it.Fact, "reason": it.Reason, "keywords": []string{"kw"}}}})
	}
	b, _ := json.Marshal(map[string]any{"items": items})
	return string(b)
}

func req(items ...Item) StoreRequest {
	return StoreRequest{Items: items, Author: AuthorUser, Source: SourceUI}
}

func newService(t *testing.T, r Runner) (*Service, *Store) {
	st := newStore(t)
	return NewService(st, r, nil), st
}

func TestChallengeStoresNothing(t *testing.T) {
	fr := &fakeRunner{gate: func(in gateInput) string {
		return `{"items":[{"index":0,"verdict":"accept","questions":[],"facts":[{"fact":"a clear fact","reason":"r","keywords":[]}]},
			{"index":1,"verdict":"challenge","questions":["Which project?"],"facts":[]}]}`
	}}
	svc, st := newService(t, fr)
	res, err := svc.Store(context.Background(), req(Item{"a clear fact", "r"}, Item{"it uses 8080", "because"}))
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
	res, err := svc.Store(context.Background(), req(Item{"alpha owns billing and zebra is in eu-west", "docs"}))
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
	if _, err := svc.Store(context.Background(), req(Item{"Port is 8080", "ops"})); err != nil {
		t.Fatal(err)
	}
	res, err := svc.Store(context.Background(), req(Item{"port is  8080", "OPS"}))
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
	if _, err := svc.Store(ctx, req(Item{"api port is 8080", "initial"})); err != nil {
		t.Fatal(err)
	}
	res, err := svc.Store(ctx, req(Item{"api port is 9090", "moved"}))
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
	res, err := svc.Store(context.Background(), req(Item{"cache sizes", "r"}))
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
	res, err := svc.Store(context.Background(), req(Item{"deploy target is production", "r"}))
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
	res, err := svc.Store(context.Background(), req(Item{"deploy and zebra", "r"}))
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
	_, err := svc.Store(context.Background(), req(Item{"some fact", "r"}))
	if !errors.Is(err, ErrClaudeOutput) {
		t.Fatalf("err = %v", err)
	}
	if rows, _ := st.Recent(context.Background(), 10); len(rows) != 0 {
		t.Error("nothing may be stored")
	}
}
