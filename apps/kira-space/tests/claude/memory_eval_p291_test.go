package claude

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/kirathecat/kira-studio/internal/memory/importer"
	"github.com/kirathecat/kira-studio/internal/memory/memfmt"
	"github.com/kirathecat/kira-studio/internal/textloss"
)

// P291 paid passes: questions (Opus), keys and telegraph (Sonnet), and the telegraph judge (TJ). Every
// pass writes its files per source before the next call, so a crash loses only the call in flight.

func readCorpus291(name string) ([]byte, error) {
	return os.ReadFile(filepath.Join(evalCorpus291Dir(), name))
}

// p291Call runs one schema call from a P291-corpus prompt pair and books its cost under kind.
func p291Call(ctx context.Context, model, kind, id, promptFile, schemaFile, extraSystem string, input any, budget string, out any) error {
	system, err := readCorpus291(promptFile)
	if err != nil {
		return err
	}
	schema, err := readCorpus291(schemaFile)
	if err != nil {
		return err
	}
	res, err := judgeCall(ctx, model, string(system)+extraSystem, schema, input, budget)
	evalSpend(kind, id, res.Cost)
	if err != nil {
		return err
	}
	return json.Unmarshal(res.Output, out)
}

// capHit reports whether a paid pass must stop starting calls: the run cap or the phase cap minus 2.
func capHit(runCap, phaseCap float64) bool {
	return runSpent() >= runCap || phaseSpent() >= phaseCap-2
}

func splitList(v string) []string {
	var out []string
	for _, x := range strings.Split(v, ",") {
		if x = strings.TrimSpace(x); x != "" {
			out = append(out, x)
		}
	}
	return out
}

// pickSources applies KIRA_EVAL_SET and KIRA_EVAL_ONLY to the manifest.
func pickSources(man evalManifest, defSet string) []evalSource {
	srcs := man.pick(envOr("KIRA_EVAL_SET", defSet))
	if only := splitList(os.Getenv("KIRA_EVAL_ONLY")); len(only) > 0 {
		var keep []evalSource
		for _, s := range srcs {
			if slices.Contains(only, s.ID) {
				keep = append(keep, s)
			}
		}
		return keep
	}
	return srcs
}

// parallel runs fn for each source with at most n at once.
func parallel(srcs []evalSource, n int, fn func(evalSource)) {
	var wg sync.WaitGroup
	sem := make(chan struct{}, max(n, 1))
	for _, s := range srcs {
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			fn(s)
		}()
	}
	wg.Wait()
}

// Questions.

type evalQuestion struct {
	ID           string `json:"id"`
	Question     string `json:"question"`
	Query        string `json:"query"`
	QuestionLeak bool   `json:"questionLeak,omitempty"`
	QueryLeak    bool   `json:"queryLeak,omitempty"`
}

type questionLine struct {
	Source  string         `json:"source"`
	Model   string         `json:"model"`
	CostUSD float64        `json:"costUsd"`
	Items   []evalQuestion `json:"items"`
}

var leakStop = map[string]bool{}

func init() {
	for _, w := range strings.Fields(`a an the and or but of to in on at by for with from as is are was were be been being it its this that
		these those there their they them he she we you i do does did done has have had not no if then than so such can could
		should would will may might must into onto over under about after before when while which who whom what where how why
		also only each any all some more most other another via per`) {
		leakStop[w] = true
	}
}

var wordTokenRe = regexp.MustCompile(`[a-z0-9_]+`)

func contentWords(s string) []string {
	var out []string
	for _, w := range wordTokenRe.FindAllString(strings.ToLower(s), -1) {
		if !leakStop[w] {
			out = append(out, w)
		}
	}
	return out
}

// leaks reports whether q shares 4 consecutive content words with any of the texts (D3).
func leaks(q string, texts ...string) bool {
	qw := contentWords(q)
	for _, t := range texts {
		tw := strings.Join(contentWords(t), " ")
		for i := 0; i+4 <= len(qw); i++ {
			if strings.Contains(" "+tw+" ", " "+strings.Join(qw[i:i+4], " ")+" ") {
				return true
			}
		}
	}
	return false
}

func loadQuestions() (map[string]questionLine, error) {
	out := map[string]questionLine{}
	raw, err := readCorpus291("questions.jsonl")
	if err != nil {
		if os.IsNotExist(err) {
			return out, nil
		}
		return out, err
	}
	for _, l := range strings.Split(string(raw), "\n") {
		if strings.TrimSpace(l) == "" {
			continue
		}
		var q questionLine
		if err := json.Unmarshal([]byte(l), &q); err != nil {
			return out, err
		}
		out[q.Source] = q
	}
	return out, nil
}

func essentialGolden(g goldenLine) []goldenFact {
	var out []goldenFact
	for _, f := range g.Facts {
		if f.Weight == "essential" {
			out = append(out, f)
		}
	}
	return out
}

func evalQuestions(t *testing.T, man evalManifest) {
	curRound = "questions"
	golden, err := loadGolden()
	if err != nil {
		t.Fatal(err)
	}
	have, err := loadQuestions()
	if err != nil {
		t.Fatal(err)
	}
	runCap, phaseCap := envFloat("KIRA_EVAL_CAP_USD", 2.5), envFloat("KIRA_EVAL_PHASE_CAP_USD", 20)
	path := filepath.Join(evalCorpus291Dir(), "questions.jsonl")
	var mu sync.Mutex
	parallel(pickSources(man, "all"), int(envFloat("KIRA_EVAL_PARALLEL", 2)), func(s evalSource) {
		mu.Lock()
		_, done := have[s.ID]
		mu.Unlock()
		if done {
			return
		}
		if capHit(runCap, phaseCap) {
			t.Errorf("%s: skipped, spend cap (run %.2f, phase %.2f)", s.ID, runSpent(), phaseSpent())
			return
		}
		text, err := materialise(man.Commit, s)
		if err != nil {
			t.Error(err)
			return
		}
		ess := essentialGolden(golden[s.ID])
		type fIn struct {
			ID    string `json:"id"`
			Fact  string `json:"fact"`
			Quote string `json:"quote"`
		}
		in := struct {
			Source map[string]string `json:"source"`
			Facts  []fIn             `json:"facts"`
		}{Source: map[string]string{"id": s.ID, "path": s.Path, "category": s.Category, "text": text}}
		byID := map[string]goldenFact{}
		for _, f := range ess {
			in.Facts = append(in.Facts, fIn{f.ID, f.Fact, f.Quote})
			byID[f.ID] = f
		}
		var items []evalQuestion
		var cost float64
		for attempt := 0; attempt < 2; attempt++ {
			before := runSpent()
			var out struct{ Items []evalQuestion }
			if err := p291Call(context.Background(), "opus", "questions", s.ID, "questions.md", "questions.schema.json", "", in, "1.50", &out); err != nil {
				t.Logf("%s: attempt %d: %v", s.ID, attempt+1, err)
				cost += runSpent() - before
				continue
			}
			cost += runSpent() - before
			ids := map[string]bool{}
			ok := len(out.Items) == len(ess)
			for _, q := range out.Items {
				ids[q.ID] = true
				if _, in := byID[q.ID]; !in {
					ok = false
				}
			}
			if ok && len(ids) == len(ess) {
				items = out.Items
				break
			}
			t.Logf("%s: attempt %d: id set mismatch", s.ID, attempt+1)
		}
		if items == nil {
			t.Errorf("%s: no valid questions", s.ID)
			return
		}
		leakQ, leakK := 0, 0
		for i, q := range items {
			f := byID[q.ID]
			items[i].QuestionLeak = leaks(q.Question, f.Fact, f.Quote)
			items[i].QueryLeak = leaks(q.Query, f.Fact, f.Quote)
			if items[i].QuestionLeak {
				leakQ++
			}
			if items[i].QueryLeak {
				leakK++
			}
		}
		line, _ := json.Marshal(questionLine{Source: s.ID, Model: "opus", CostUSD: cost, Items: items})
		mu.Lock()
		defer mu.Unlock()
		f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
		if err != nil {
			t.Error(err)
			return
		}
		_, _ = f.Write(append(line, '\n'))
		_ = f.Close()
		t.Logf("questions %s: %d items, leaks question %d query %d, %.3f USD", s.ID, len(items), leakQ, leakK, cost)
	})
	t.Logf("run spend %.3f USD, phase total %.3f USD", runSpent(), phaseSpent())
}

// Keys.

type factKey struct {
	ID      string `json:"id"`
	Subject string `json:"subject"`
	Aspect  string `json:"aspect"`
}

type keysFile struct {
	Source  string    `json:"source"`
	Round   string    `json:"round"`
	CostUSD float64   `json:"costUsd"`
	Facts   []factKey `json:"facts"`
}

func p291RoundOut(sub, round string) string {
	return filepath.Join(evalRunsDir(), sub, filepath.Base(round))
}

func loadKeys(round, source string) (map[string]factKey, bool) {
	raw, err := os.ReadFile(filepath.Join(p291RoundOut("keys", round), source+".json"))
	if err != nil {
		return nil, false
	}
	var k keysFile
	if json.Unmarshal(raw, &k) != nil {
		return nil, false
	}
	out := map[string]factKey{}
	for _, f := range k.Facts {
		out[f.ID] = f
	}
	return out, true
}

func idSet[T any](items []T, id func(T) string) []string {
	var out []string
	for _, x := range items {
		out = append(out, id(x))
	}
	slices.Sort(out)
	return out
}

func evalKeys(t *testing.T, man evalManifest) {
	rounds := splitList(os.Getenv("KIRA_EVAL_ROUNDS"))
	if len(rounds) == 0 {
		t.Fatal("KIRA_EVAL_ROUNDS is required for keys mode")
	}
	runCap, phaseCap := envFloat("KIRA_EVAL_CAP_USD", 1.2), envFloat("KIRA_EVAL_PHASE_CAP_USD", 20)
	for _, round := range rounds {
		curRound = "keys:" + filepath.Base(round)
		recs := loadRecords(filepath.Join(roundDirOf(round), "facts.jsonl"))
		scored := scoredSources(roundDirOf(round))
		outDir := p291RoundOut("keys", round)
		if err := os.MkdirAll(outDir, 0o755); err != nil {
			t.Fatal(err)
		}
		parallel(pickSources(man, "all"), int(envFloat("KIRA_EVAL_PARALLEL", 2)), func(s evalSource) {
			rec, ok := recs[s.ID]
			if !ok || (scored != nil && !scored[s.ID]) {
				return
			}
			out := filepath.Join(outDir, s.ID+".json")
			if _, err := os.Stat(out); err == nil {
				return
			}
			if capHit(runCap, phaseCap) {
				t.Errorf("%s/%s: skipped, spend cap", round, s.ID)
				return
			}
			type fIn struct {
				ID   string `json:"id"`
				Fact string `json:"fact"`
			}
			var in struct {
				Facts []fIn `json:"facts"`
			}
			for _, f := range rec.Stored {
				in.Facts = append(in.Facts, fIn{f.ID, f.Fact})
			}
			var res struct{ Facts []factKey }
			var cost float64
			for attempt := 0; attempt < 2; attempt++ {
				before := runSpent()
				err := p291Call(context.Background(), "sonnet", "keys", filepath.Base(round)+"/"+s.ID, "keys.md", "keys.schema.json", "", in, "0.60", &res)
				cost += runSpent() - before
				if err == nil && slices.Equal(idSet(res.Facts, func(k factKey) string { return k.ID }), idSet(rec.Stored, func(f storedFact) string { return f.ID })) {
					raw, _ := json.MarshalIndent(keysFile{Source: s.ID, Round: round, CostUSD: cost, Facts: res.Facts}, "", " ")
					_ = os.WriteFile(out, append(raw, '\n'), 0o644)
					t.Logf("keys %s/%s: %d facts, %.3f USD", filepath.Base(round), s.ID, len(res.Facts), cost)
					return
				}
				t.Logf("keys %s/%s: attempt %d failed: %v", filepath.Base(round), s.ID, attempt+1, err)
			}
			t.Errorf("keys %s/%s: no valid output", round, s.ID)
		})
	}
	t.Logf("run spend %.3f USD, phase total %.3f USD", runSpent(), phaseSpent())
}

// Telegraph post-pass.

type teleFact struct {
	ID     string `json:"id"`
	Fact   string `json:"fact"`
	Reason string `json:"reason"`
}

type teleFile struct {
	Source  string     `json:"source"`
	Round   string     `json:"round"`
	CostUSD float64    `json:"costUsd"`
	Facts   []teleFact `json:"facts"`
	// Residual lists fact ids that still lose a protected token after the retry (D27).
	Residual []string `json:"residual"`
}

func isLocator(reason string) bool { return strings.HasPrefix(reason, "Stated in ") }

func loadTele(round, source string) (teleFile, bool) {
	raw, err := os.ReadFile(filepath.Join(p291RoundOut("telegraph", round), source+".json"))
	if err != nil {
		return teleFile{}, false
	}
	var f teleFile
	return f, json.Unmarshal(raw, &f) == nil
}

// teleLoss lists the protected tokens a rewritten fact or reason drops.
func teleLoss(old storedFact, cur teleFact) []string {
	out := textloss.LostText(old.Fact, cur.Fact)
	if !isLocator(old.Reason) {
		out = append(out, textloss.LostText(old.Reason, cur.Reason)...)
	}
	return out
}

func evalTelegraph(t *testing.T, man evalManifest) {
	rounds := splitList(os.Getenv("KIRA_EVAL_ROUNDS"))
	if len(rounds) == 0 {
		t.Fatal("KIRA_EVAL_ROUNDS is required for telegraph mode")
	}
	runCap, phaseCap := envFloat("KIRA_EVAL_CAP_USD", 1.6), envFloat("KIRA_EVAL_PHASE_CAP_USD", 20)
	for _, round := range rounds {
		curRound = "telegraph:" + filepath.Base(round)
		recs := loadRecords(filepath.Join(roundDirOf(round), "facts.jsonl"))
		scored := scoredSources(roundDirOf(round))
		outDir := p291RoundOut("telegraph", round)
		if err := os.MkdirAll(outDir, 0o755); err != nil {
			t.Fatal(err)
		}
		var lmu sync.Mutex
		parallel(pickSources(man, "all"), int(envFloat("KIRA_EVAL_PARALLEL", 2)), func(s evalSource) {
			rec, ok := recs[s.ID]
			if !ok || (scored != nil && !scored[s.ID]) {
				return
			}
			out := filepath.Join(outDir, s.ID+".json")
			if _, err := os.Stat(out); err == nil {
				return
			}
			if capHit(runCap, phaseCap) {
				t.Errorf("%s/%s: skipped, spend cap", round, s.ID)
				return
			}
			orig := map[string]storedFact{}
			for _, f := range rec.Stored {
				orig[f.ID] = f
			}
			type fIn struct {
				ID     string `json:"id"`
				Fact   string `json:"fact"`
				Reason string `json:"reason"`
			}
			var in struct {
				Facts []fIn `json:"facts"`
			}
			for _, f := range rec.Stored {
				in.Facts = append(in.Facts, fIn{f.ID, f.Fact, f.Reason})
			}
			call := func(extra string, input any, want []string) (map[string]teleFact, float64, error) {
				var res struct{ Facts []teleFact }
				var cost float64
				for attempt := 0; attempt < 2; attempt++ {
					before := runSpent()
					err := p291Call(context.Background(), "sonnet", "telegraph", filepath.Base(round)+"/"+s.ID, "telegraph.md", "telegraph.schema.json", extra, input, "0.60", &res)
					cost += runSpent() - before
					if err == nil && slices.Equal(idSet(res.Facts, func(f teleFact) string { return f.ID }), want) {
						m := map[string]teleFact{}
						for _, f := range res.Facts {
							m[f.ID] = f
						}
						return m, cost, nil
					}
					t.Logf("telegraph %s/%s: attempt %d failed: %v", filepath.Base(round), s.ID, attempt+1, err)
				}
				return nil, cost, fmt.Errorf("no valid output")
			}
			want := idSet(rec.Stored, func(f storedFact) string { return f.ID })
			cur, cost, err := call("", in, want)
			if err != nil {
				t.Errorf("telegraph %s/%s: %v", round, s.ID, err)
				return
			}
			// A locator reason is metadata and always carries over unchanged.
			for id, f := range cur {
				if isLocator(orig[id].Reason) {
					f.Reason = orig[id].Reason
					cur[id] = f
				}
			}
			failing := func() (ids []string, lost map[string][]string) {
				lost = map[string][]string{}
				for _, f := range rec.Stored {
					if l := teleLoss(f, cur[f.ID]); len(l) > 0 {
						ids = append(ids, f.ID)
						lost[f.ID] = l
					}
				}
				return ids, lost
			}
			bad, lost := failing()
			if len(bad) > 0 {
				type fixIn struct {
					ID           string   `json:"id"`
					Fact         string   `json:"fact"`
					Reason       string   `json:"reason"`
					Previous     teleFact `json:"previousRewrite"`
					LostPreserve []string `json:"mustKeepVerbatim"`
				}
				var fix struct {
					Facts []fixIn `json:"facts"`
				}
				for _, id := range bad {
					fix.Facts = append(fix.Facts, fixIn{id, orig[id].Fact, orig[id].Reason, cur[id], lost[id]})
				}
				extra := "\nRetry: each input carries your previous rewrite and tokens it lost. Rewrite again, keeping every token in mustKeepVerbatim exactly."
				if redo, c2, err := call(extra, fix, slices.Sorted(slices.Values(bad))); err == nil {
					cost += c2
					for id, f := range redo {
						if isLocator(orig[id].Reason) {
							f.Reason = orig[id].Reason
						}
						cur[id] = f
					}
				} else {
					cost += c2
				}
			}
			residual, lost2 := failing()
			tf := teleFile{Source: s.ID, Round: round, CostUSD: cost, Residual: residual}
			for _, f := range rec.Stored {
				tf.Facts = append(tf.Facts, cur[f.ID])
			}
			raw, _ := json.MarshalIndent(tf, "", " ")
			_ = os.WriteFile(out, append(raw, '\n'), 0o644)
			lmu.Lock()
			lf, err := os.OpenFile(filepath.Join(outDir, "losses.tsv"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
			if err == nil {
				for _, id := range bad {
					state := "fixed"
					if slices.Contains(residual, id) {
						state = "residual"
					}
					fmt.Fprintf(lf, "%s\t%s\t%s\t%s\n", s.ID, id, state, strings.Join(append(lost[id], lost2[id]...), " | "))
				}
				_ = lf.Close()
			}
			lmu.Unlock()
			t.Logf("telegraph %s/%s: %d facts, %d failed token check, %d residual, %.3f USD", filepath.Base(round), s.ID, len(rec.Stored), len(bad), len(residual), cost)
		})
	}
	t.Logf("run spend %.3f USD, phase total %.3f USD", runSpent(), phaseSpent())
}

// styleFacts returns a record's stored facts in the given style: full, tele, or tele-guard (facts
// that fail the token check keep their full text).
func styleFacts(round, source string, rec runRecord, style string) ([]storedFact, bool) {
	if style == "full" {
		return rec.Stored, true
	}
	tf, ok := loadTele(round, source)
	if !ok {
		return nil, false
	}
	byID := map[string]teleFact{}
	for _, f := range tf.Facts {
		byID[f.ID] = f
	}
	out := make([]storedFact, 0, len(rec.Stored))
	for _, f := range rec.Stored {
		g := f
		if tr, ok := byID[f.ID]; ok && !(style == "tele-guard" && slices.Contains(tf.Residual, f.ID)) {
			g.Fact, g.Reason = tr.Fact, tr.Reason
		}
		out = append(out, g)
	}
	return out, true
}

// TJ: the frozen score judge over a round's telegraph facts (D28).

func evalScoreTele(t *testing.T, man evalManifest) {
	rounds := splitList(os.Getenv("KIRA_EVAL_ROUNDS"))
	if len(rounds) == 0 {
		t.Fatal("KIRA_EVAL_ROUNDS is required for score mode")
	}
	golden, err := loadGolden()
	if err != nil {
		t.Fatal(err)
	}
	runCap, phaseCap := envFloat("KIRA_EVAL_CAP_USD", 2.4), envFloat("KIRA_EVAL_PHASE_CAP_USD", 20)
	for _, round := range rounds {
		curRound = "tj:" + filepath.Base(round)
		recs := loadRecords(filepath.Join(roundDirOf(round), "facts.jsonl"))
		scored := scoredSources(roundDirOf(round))
		outDir := p291RoundOut("", round)
		if err := os.MkdirAll(filepath.Join(outDir, "judge-tele"), 0o755); err != nil {
			t.Fatal(err)
		}
		var mu sync.Mutex
		grades, texts := map[string]scoreGrades{}, map[string]string{}
		trecs := map[string]runRecord{}
		var srcs []evalSource
		for _, s := range pickSources(man, "tuning") {
			if rec, ok := recs[s.ID]; ok && (scored == nil || scored[s.ID]) {
				srcs = append(srcs, s)
				text, err := materialise(man.Commit, s)
				if err != nil {
					t.Fatal(err)
				}
				texts[s.ID] = text
				tr := rec
				stored, ok := styleFacts(round, s.ID, rec, "tele")
				if !ok {
					t.Fatalf("%s/%s: no telegraph file", round, s.ID)
				}
				tr.Stored = stored
				trecs[s.ID] = tr
			}
		}
		parallel(srcs, int(envFloat("KIRA_EVAL_PARALLEL", 2)), func(s evalSource) {
			jp := filepath.Join(outDir, "judge-tele", s.ID+".json")
			rec := trecs[s.ID]
			var cached struct {
				Model  string      `json:"model"`
				Grades scoreGrades `json:"grades"`
			}
			if raw, err := os.ReadFile(jp); err == nil && json.Unmarshal(raw, &cached) == nil && validateGrades(cached.Grades, golden[s.ID].Facts, rec.Stored) == nil {
				mu.Lock()
				grades[s.ID] = cached.Grades
				mu.Unlock()
				return
			}
			if capHit(runCap, phaseCap) {
				t.Errorf("%s: skipped, spend cap", s.ID)
				return
			}
			g, model, err := scoreSource(context.Background(), s, texts[s.ID], golden[s.ID], rec)
			if err != nil {
				t.Errorf("%s: %v", s.ID, err)
				return
			}
			raw, _ := json.MarshalIndent(map[string]any{"model": model, "grades": g}, "", "  ")
			_ = os.WriteFile(jp, append(raw, '\n'), 0o644)
			mu.Lock()
			grades[s.ID] = g
			mu.Unlock()
		})
		writeScores(t, outDir, "scores-tele.json", evalCfg{round: round, budget: importer.DefaultBudget}, "tuning", srcs, texts, golden, trecs, grades, "opus", false, nil)
	}
	t.Logf("run spend %.3f USD, phase total %.3f USD", runSpent(), phaseSpent())
}

// sectionOf is the locator section of a stored fact's reason, "" when it has none.
func sectionOf(s evalSource, reason string) string {
	sec, _ := memfmt.ParseLocator(reason, s.fileName())
	return sec
}

// sortedKeys is a small helper for deterministic output.
func sortedKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
