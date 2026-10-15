package claude

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/kirathecat/kira-studio/internal/claudeheadless"
	"github.com/kirathecat/kira-studio/internal/memory/importer"
)

// Judge calls run through a direct `claude -p`: memory.Call pins the pipeline's `sonnet`, and the
// grader must be a different, stronger model (Opus). Same isolation flags as memory.claudeArgs.
const (
	goldenBudget = "1.00"
	scoreBudget  = "1.50"
)

type judgeResult struct {
	Output []byte
	Cost   float64
	Model  string
}

// judgeCall runs one schema call on model: opus for golden, score and questions, sonnet for keys and telegraph.
func judgeCall(ctx context.Context, model, system string, schema []byte, input any, budget string) (judgeResult, error) {
	var res judgeResult
	in, err := json.Marshal(input)
	if err != nil {
		return res, err
	}
	dir, err := os.MkdirTemp("", "p285-judge-")
	if err != nil {
		return res, err
	}
	defer os.RemoveAll(dir)
	c, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(c, "claude", "-p", "--model", model, "--safe-mode", "--setting-sources", "", "--strict-mcp-config",
		"--tools", "", "--disable-slash-commands", "--no-session-persistence", "--permission-prompts", "none",
		"--output-format", "json", "--json-schema", string(schema), "--system-prompt", system, "--max-budget-usd", budget)
	cmd.Dir = dir
	cmd.Env = claudeheadless.ScrubSessionEnv(os.Environ())
	cmd.Stdin = bytes.NewReader(in)
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	runErr := cmd.Run()
	var r struct {
		IsError          bool                      `json:"is_error"`
		Subtype          string                    `json:"subtype"`
		Result           string                    `json:"result"`
		StructuredOutput json.RawMessage           `json:"structured_output"`
		TotalCostUSD     float64                   `json:"total_cost_usd"`
		ModelUsage       map[string]map[string]any `json:"modelUsage"`
	}
	if json.Unmarshal(out.Bytes(), &r) != nil {
		return res, fmt.Errorf("judge: no JSON result (%v): %s", runErr, tail(out.String()+errb.String(), 400))
	}
	res.Cost = r.TotalCostUSD
	for k := range r.ModelUsage {
		res.Model = k
	}
	if runErr != nil || r.IsError || len(r.StructuredOutput) == 0 {
		return res, fmt.Errorf("judge: %v subtype=%s: %s", runErr, r.Subtype, tail(r.Result, 300))
	}
	res.Output = r.StructuredOutput
	return res, nil
}

func readCorpusFile(name string) ([]byte, error) {
	return os.ReadFile(filepath.Join(evalCorpusDir(), name))
}

// Golden facts.

type goldenFact struct {
	ID     string `json:"id"`
	Fact   string `json:"fact"`
	Weight string `json:"weight"`
	Quote  string `json:"quote"`
}

type goldenLine struct {
	ID      string       `json:"id"`
	Model   string       `json:"model"`
	CostUSD float64      `json:"costUsd"`
	Facts   []goldenFact `json:"facts"`
	// Dropped lists golden facts the sanity pass removed: quote not in the source.
	Dropped []goldenFact `json:"dropped"`
}

func loadGolden() (map[string]goldenLine, error) {
	out := map[string]goldenLine{}
	raw, err := readCorpusFile("golden.jsonl")
	if err != nil {
		return out, err
	}
	for _, l := range strings.Split(string(raw), "\n") {
		if strings.TrimSpace(l) == "" {
			continue
		}
		var g goldenLine
		if err := json.Unmarshal([]byte(l), &g); err != nil {
			return out, err
		}
		out[g.ID] = g
	}
	return out, nil
}

func collapseWS(s string) string { return strings.Join(strings.Fields(s), " ") }

// sanityGolden drops golden facts whose quote is not in the source, after whitespace folding.
func sanityGolden(src string, facts []goldenFact) (kept, dropped []goldenFact) {
	flat := collapseWS(src)
	for _, f := range facts {
		if q := collapseWS(f.Quote); q != "" && strings.Contains(flat, q) {
			kept = append(kept, f)
		} else {
			dropped = append(dropped, f)
		}
	}
	return kept, dropped
}

func authorGolden(ctx context.Context, s evalSource, text string) (goldenLine, error) {
	system, err := readCorpusFile("judge-golden.md")
	if err != nil {
		return goldenLine{}, err
	}
	schema, err := readCorpusFile("judge-golden.schema.json")
	if err != nil {
		return goldenLine{}, err
	}
	input := map[string]any{"source": map[string]string{"id": s.ID, "path": s.Path, "category": s.Category, "text": text}}
	res, err := judgeCall(ctx, "opus", string(system), schema, input, goldenBudget)
	evalSpend("golden", s.ID, res.Cost)
	if err != nil {
		return goldenLine{}, err
	}
	var parsed struct{ Facts []goldenFact }
	if err := json.Unmarshal(res.Output, &parsed); err != nil {
		return goldenLine{}, err
	}
	kept, dropped := sanityGolden(text, parsed.Facts)
	return goldenLine{ID: s.ID, Model: res.Model, CostUSD: res.Cost, Facts: kept, Dropped: dropped}, nil
}

// Scoring.

type goldenGrade struct {
	ID          string   `json:"id"`
	Covered     string   `json:"covered"`
	By          []string `json:"by"`
	InExtracted bool     `json:"inExtracted"`
}

type storedGrade struct {
	ID          string `json:"id"`
	Atomic      bool   `json:"atomic"`
	Standalone  bool   `json:"standalone"`
	Support     string `json:"support"`
	DuplicateOf string `json:"duplicateOf"`
	Valuable    bool   `json:"valuable"`
	ReasonOK    bool   `json:"reasonOk"`
	Note        string `json:"note"`
}

type scoreGrades struct {
	Golden []goldenGrade `json:"golden"`
	Stored []storedGrade `json:"stored"`
}

func validateGrades(g scoreGrades, gold []goldenFact, stored []storedFact) error {
	check := func(kind string, want, got []string) error {
		slices.Sort(want)
		slices.Sort(got)
		if !slices.Equal(want, got) {
			return fmt.Errorf("%s ids graded %d, want %d (each exactly once)", kind, len(got), len(want))
		}
		return nil
	}
	var w, got []string
	for _, f := range gold {
		w = append(w, f.ID)
	}
	for _, x := range g.Golden {
		got = append(got, x.ID)
	}
	if err := check("golden", w, got); err != nil {
		return err
	}
	w, got = nil, nil
	for _, f := range stored {
		w = append(w, f.ID)
	}
	for _, x := range g.Stored {
		got = append(got, x.ID)
	}
	return check("stored", w, got)
}

func scoreSource(ctx context.Context, s evalSource, text string, gold goldenLine, rec runRecord) (scoreGrades, string, error) {
	system, err := readCorpusFile("judge-score.md")
	if err != nil {
		return scoreGrades{}, "", err
	}
	schema, err := readCorpusFile("judge-score.schema.json")
	if err != nil {
		return scoreGrades{}, "", err
	}
	type gIn struct {
		ID     string `json:"id"`
		Fact   string `json:"fact"`
		Weight string `json:"weight"`
	}
	type sIn struct {
		ID     string `json:"id"`
		Fact   string `json:"fact"`
		Reason string `json:"reason"`
	}
	type eIn struct {
		ID   string `json:"id"`
		Fact string `json:"fact"`
	}
	in := struct {
		Source    string `json:"source"`
		Golden    []gIn  `json:"golden"`
		Stored    []sIn  `json:"stored"`
		Extracted []eIn  `json:"extracted"`
	}{Source: text, Golden: []gIn{}, Stored: []sIn{}, Extracted: []eIn{}}
	for _, f := range gold.Facts {
		in.Golden = append(in.Golden, gIn{f.ID, f.Fact, f.Weight})
	}
	for _, f := range rec.Stored {
		in.Stored = append(in.Stored, sIn{f.ID, f.Fact, f.Reason})
	}
	for _, f := range rec.Extracted {
		in.Extracted = append(in.Extracted, eIn{f.ID, f.Fact})
	}
	var lastErr error
	model := ""
	for range 2 {
		res, err := judgeCall(ctx, "opus", string(system), schema, in, scoreBudget)
		evalSpend("judge", s.ID, res.Cost)
		if res.Model != "" {
			model = res.Model
		}
		if err != nil {
			lastErr = err
			continue
		}
		var g scoreGrades
		if err := json.Unmarshal(res.Output, &g); err != nil {
			lastErr = err
			continue
		}
		if err := validateGrades(g, gold.Facts, rec.Stored); err != nil {
			lastErr = err
			continue
		}
		return g, model, nil
	}
	return scoreGrades{}, model, lastErr
}

// Metrics. Aggregates sum counts over sources, never average ratios.

type tally struct {
	EssN, EssCov, AllN, AllCov float64
	// Missed essential golden facts: the extract step had them, or lost them.
	MissEssFinalize, MissEssExtract int
	Stored, Atomic, Standalone      int
	Bad, Dup, NotValuable           int
	ReasonOK, Precise               int
	FactRunes, FactTokens           int
	RecRunes, DocRunes, SrcRunes    int
	Extracted                       int
}

func (t *tally) add(o tally) {
	t.EssN += o.EssN
	t.EssCov += o.EssCov
	t.AllN += o.AllN
	t.AllCov += o.AllCov
	t.MissEssFinalize += o.MissEssFinalize
	t.MissEssExtract += o.MissEssExtract
	t.Stored += o.Stored
	t.Atomic += o.Atomic
	t.Standalone += o.Standalone
	t.Bad += o.Bad
	t.Dup += o.Dup
	t.NotValuable += o.NotValuable
	t.ReasonOK += o.ReasonOK
	t.Precise += o.Precise
	t.FactRunes += o.FactRunes
	t.FactTokens += o.FactTokens
	t.RecRunes += o.RecRunes
	t.DocRunes += o.DocRunes
	t.SrcRunes += o.SrcRunes
	t.Extracted += o.Extracted
}

type ratios struct {
	REss, RAll, P, Atomic, Standalone, Unsupported, Duplicate, NotValuable, ReasonOK float64
	CFact, CFactTok, CRec, CDoc                                                      float64
}

func div(a, b float64) float64 {
	if b == 0 {
		return 0
	}
	return a / b
}

func (t tally) ratios() ratios {
	st := float64(t.Stored)
	return ratios{
		REss: div(t.EssCov, t.EssN), RAll: div(t.AllCov, t.AllN),
		P: div(float64(t.Precise), st), Atomic: div(float64(t.Atomic), st), Standalone: div(float64(t.Standalone), st),
		Unsupported: div(float64(t.Bad), st), Duplicate: div(float64(t.Dup), st), NotValuable: div(float64(t.NotValuable), st),
		ReasonOK: div(float64(t.ReasonOK), st),
		CFact:    div(float64(t.FactRunes), float64(t.SrcRunes)), CRec: div(float64(t.RecRunes), float64(t.SrcRunes)),
		CDoc: div(float64(t.DocRunes), float64(t.SrcRunes)),
		// Source tokens use the same estimate as the fact tokens.
		CFactTok: div(float64(t.FactTokens), float64(importer.EstimateTokens(strings.Repeat("x", t.SrcRunes)))),
	}
}

func tallyOf(text string, gold goldenLine, rec runRecord, g scoreGrades) tally {
	t := tally{SrcRunes: utf8.RuneCountInString(text), Stored: len(rec.Stored), Extracted: len(rec.Extracted),
		DocRunes: utf8.RuneCountInString(rec.RenderedDoc)}
	weight := map[string]string{}
	for _, f := range gold.Facts {
		weight[f.ID] = f.Weight
	}
	for _, x := range g.Golden {
		v := map[string]float64{"full": 1, "partial": 0.5, "none": 0}[x.Covered]
		t.AllN++
		t.AllCov += v
		if weight[x.ID] == "essential" {
			t.EssN++
			t.EssCov += v
			if x.Covered == "none" {
				if x.InExtracted {
					t.MissEssFinalize++
				} else {
					t.MissEssExtract++
				}
			}
		}
	}
	byID := map[string]storedFact{}
	for _, f := range rec.Stored {
		byID[f.ID] = f
		t.FactRunes += utf8.RuneCountInString(f.Fact)
		t.FactTokens += importer.EstimateTokens(f.Fact)
		t.RecRunes += utf8.RuneCountInString(f.Fact) + utf8.RuneCountInString(f.Reason) + utf8.RuneCountInString(strings.Join(f.Keywords, " "))
	}
	for _, x := range g.Stored {
		bad := x.Support != "supported"
		if x.Atomic {
			t.Atomic++
		}
		if x.Standalone {
			t.Standalone++
		}
		if bad {
			t.Bad++
		}
		if x.DuplicateOf != "" {
			t.Dup++
		}
		if !x.Valuable {
			t.NotValuable++
		}
		if x.ReasonOK {
			t.ReasonOK++
		}
		if x.Atomic && x.Standalone && !bad && x.DuplicateOf == "" && x.Valuable {
			t.Precise++
		}
	}
	return t
}

// Spend. Every judge, golden and pipeline cost lands in spend.jsonl right away, so a crash loses
// nothing and the phase total survives a restart.

var (
	spendFileMu sync.Mutex
	runSpentUSD float64
	curRound    string
)

type spendLine struct {
	Time  string  `json:"time"`
	Round string  `json:"round"`
	Kind  string  `json:"kind"`
	ID    string  `json:"id"`
	USD   float64 `json:"usd"`
}

// spendPath is the phase ledger: spend.jsonl, or the file KIRA_EVAL_LEDGER names (one per part).
func spendPath() string {
	return filepath.Join(evalRunsDir(), filepath.Base(envOr("KIRA_EVAL_LEDGER", "spend.jsonl")))
}

func evalSpend(kind, id string, usd float64) {
	if usd == 0 {
		return
	}
	spendFileMu.Lock()
	defer spendFileMu.Unlock()
	runSpentUSD += usd
	if err := os.MkdirAll(evalRunsDir(), 0o755); err != nil {
		return
	}
	f, err := os.OpenFile(spendPath(), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	line, _ := json.Marshal(spendLine{Time: time.Now().UTC().Format(time.RFC3339), Round: curRound, Kind: kind, ID: id, USD: usd})
	_, _ = f.Write(append(line, '\n'))
}

func phaseSpent() float64 {
	spendFileMu.Lock()
	defer spendFileMu.Unlock()
	raw, _ := os.ReadFile(spendPath())
	var total float64
	for _, l := range strings.Split(string(raw), "\n") {
		var s spendLine
		if json.Unmarshal([]byte(l), &s) == nil {
			total += s.USD
		}
	}
	return total
}

func runSpent() float64 {
	spendFileMu.Lock()
	defer spendFileMu.Unlock()
	return runSpentUSD
}
