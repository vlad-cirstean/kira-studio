package claude

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/kirathecat/kira-studio/internal/memory"
	"github.com/kirathecat/kira-studio/internal/memory/importer"
	"github.com/kirathecat/kira-studio/internal/memory/memfmt"
	"github.com/kirathecat/kira-studio/internal/textloss"
)

const (
	evalProject  = "github.com/kirathecat/kira-studio"
	evalDocDate  = "2026-10-14"
	evalGroupID  = "kg_000000000000"
	evalProvOrig = memory.OriginAgent
)

func evalProvenance() importer.Provenance {
	return importer.Provenance{Origin: evalProvOrig, Scope: memory.ScopeProject, Project: evalProject}
}

// storedMemories turns a record's stored facts into memories the doc renderer takes. Ids are
// synthetic and valid (km_ plus 12 hex digits), in record order.
func storedMemories(stored []storedFact) []memory.Memory {
	project := evalProject
	out := make([]memory.Memory, 0, len(stored))
	for i, f := range stored {
		out = append(out, memory.Memory{LineageID: fmt.Sprintf("km_%012x", i+1), Fact: f.Fact, Reason: f.Reason, Keywords: f.Keywords,
			Origin: evalProvOrig, Scope: memory.ScopeProject, Project: &project})
	}
	return out
}

// renderChecked renders the doc the write-back would write for a file's stored facts through
// importer.RenderDoc, the same pure renderer, so C_doc never depends on whether the write succeeded.
// problems counts ParseDoc problems of the render (1 when it fails to render at all). A file with no
// stored fact has no doc and no problem.
func renderChecked(in importer.DocInput, mems []memory.Memory) (text string, problems int) {
	if len(mems) == 0 {
		return "", 0
	}
	text, _, _, err := importer.RenderDoc(in, mems)
	if err != nil {
		return "", 1
	}
	_, ok, ps := memfmt.ParseDoc([]byte(text))
	if !ok {
		return text, 1
	}
	return text, len(ps)
}

func renderedDoc(rec runRecord, title, rel, updated string) (string, int) {
	return renderChecked(importer.DocInput{GroupID: evalGroupID, Title: title, FileName: rel, Rel: rel, Prov: evalProvenance(), Updated: updated},
		storedMemories(rec.Stored))
}

type footprintRow struct {
	Source      string  `json:"source"`
	Set         string  `json:"set"`
	SrcRunes    int     `json:"srcRunes"`
	Facts       int     `json:"facts"`
	FactRunes   int     `json:"factRunes"`
	FactTokens  int     `json:"factTokens"`
	RecRunes    int     `json:"recRunes"`
	RecTokens   int     `json:"recTokens"`
	DocRunes    int     `json:"docRunes"`
	DocTokens   int     `json:"docTokens"`
	DocProblems int     `json:"docProblems"`
	CFact       float64 `json:"cFact"`
	CRec        float64 `json:"cRec"`
	CDoc        float64 `json:"cDoc"`
	// P291: StoreRunes = fact + non-locator reason + keywords (locators are doc metadata); DistillRunes =
	// the lines finalize received; Tok* count protected tokens of covered golden facts found in their
	// answering stored facts (D27); SubjectCut: facts that lose every name of their full text.
	StoreRunes   int     `json:"storeRunes"`
	DistillRunes int     `json:"distillRunes"`
	CStore       float64 `json:"cStore"`
	CDistill     float64 `json:"cDistill"`
	TokTotal     int     `json:"tokTotal"`
	TokKept      int     `json:"tokKept"`
	SubjectCut   int     `json:"subjectCut,omitempty"`
}

type footprintSum struct {
	Sources    int     `json:"sources"`
	SrcRunes   int     `json:"srcRunes"`
	Facts      int     `json:"facts"`
	FactRunes  int     `json:"factRunes"`
	FactTokens int     `json:"factTokens"`
	RecRunes   int     `json:"recRunes"`
	DocRunes   int     `json:"docRunes"`
	DocTokens  int     `json:"docTokens"`
	CFact      float64 `json:"cFact"`
	CRec       float64 `json:"cRec"`
	CDoc       float64 `json:"cDoc"`

	StoreRunes   int     `json:"storeRunes"`
	DistillRunes int     `json:"distillRunes"`
	CStore       float64 `json:"cStore"`
	CDistill     float64 `json:"cDistill"`
	TokTotal     int     `json:"tokTotal"`
	TokKept      int     `json:"tokKept"`
	TokenRecall  float64 `json:"tokenRecall"`
	SubjectCut   int     `json:"subjectCut,omitempty"`
}

func (s *footprintSum) add(r footprintRow) {
	s.Sources++
	s.SrcRunes += r.SrcRunes
	s.Facts += r.Facts
	s.FactRunes += r.FactRunes
	s.FactTokens += r.FactTokens
	s.RecRunes += r.RecRunes
	s.DocRunes += r.DocRunes
	s.DocTokens += r.DocTokens
	s.StoreRunes += r.StoreRunes
	s.DistillRunes += r.DistillRunes
	s.TokTotal += r.TokTotal
	s.TokKept += r.TokKept
	s.SubjectCut += r.SubjectCut
}

func (s *footprintSum) done() {
	s.CFact = div(float64(s.FactRunes), float64(s.SrcRunes))
	s.CRec = div(float64(s.RecRunes), float64(s.SrcRunes))
	s.CDoc = div(float64(s.DocRunes), float64(s.SrcRunes))
	s.CStore = div(float64(s.StoreRunes), float64(s.SrcRunes))
	s.CDistill = div(float64(s.DistillRunes), float64(s.SrcRunes))
	s.TokenRecall = div(float64(s.TokKept), float64(s.TokTotal))
}

func footprintOf(s evalSource, text string, rec runRecord) footprintRow {
	r := footprintRow{Source: s.ID, Set: s.Set, SrcRunes: utf8.RuneCountInString(text), Facts: len(rec.Stored)}
	for _, f := range rec.Stored {
		r.FactRunes += utf8.RuneCountInString(f.Fact)
		r.FactTokens += importer.EstimateTokens(f.Fact)
		kw := strings.Join(f.Keywords, " ")
		r.RecRunes += utf8.RuneCountInString(f.Fact) + utf8.RuneCountInString(f.Reason) + utf8.RuneCountInString(kw)
		r.RecTokens += importer.EstimateTokens(f.Fact) + importer.EstimateTokens(f.Reason) + importer.EstimateTokens(kw)
	}
	doc, problems := renderedDoc(rec, titleOf(text, s), s.ID+"."+s.Kind, evalDocDate)
	r.DocRunes, r.DocTokens, r.DocProblems = utf8.RuneCountInString(doc), importer.EstimateTokens(doc), problems
	r.CFact = div(float64(r.FactRunes), float64(r.SrcRunes))
	r.CRec = div(float64(r.RecRunes), float64(r.SrcRunes))
	r.CDoc = div(float64(r.DocRunes), float64(r.SrcRunes))
	for _, f := range rec.Stored {
		r.StoreRunes += utf8.RuneCountInString(f.Fact) + utf8.RuneCountInString(strings.Join(f.Keywords, " "))
		if !isLocator(f.Reason) {
			r.StoreRunes += utf8.RuneCountInString(f.Reason)
		}
	}
	for _, e := range rec.Extracted {
		r.DistillRunes += utf8.RuneCountInString(e.Fact)
	}
	r.CStore = div(float64(r.StoreRunes), float64(r.SrcRunes))
	r.CDistill = div(float64(r.DistillRunes), float64(r.SrcRunes))
	return r
}

// tokenRecall counts, over the golden facts covered full or partial, the protected tokens of the
// golden fact found in the union of its answering stored facts (D27).
func tokenRecall(gold goldenLine, grades scoreGrades, stored []storedFact) (total, kept int) {
	byID := map[string]string{}
	for _, f := range stored {
		byID[f.ID] = f.Fact
	}
	text := map[string]string{}
	for _, f := range gold.Facts {
		text[f.ID] = f.Fact
	}
	for _, g := range grades.Golden {
		if g.Covered != "full" && g.Covered != "partial" {
			continue
		}
		var parts []string
		for _, id := range g.By {
			parts = append(parts, byID[id])
		}
		a, b := textloss.Recall(text[g.ID], strings.Join(parts, " \n "))
		total, kept = total+a, kept+b
	}
	return total, kept
}

// titleOf is the document title the chunker reads, so the rendered header matches a real import.
func titleOf(text string, s evalSource) string {
	if s.Kind == "md" || s.Kind == "markdown" {
		_, title := importer.ChunkMarkdown(text, importer.DefaultBudget)
		return title
	}
	return ""
}

// evalFootprint re-renders the stored facts of finished rounds through importer.RenderDoc and writes
// footprint-<format>.json beside each round's scores. No claude, no spend, scores.json untouched.
func evalFootprint(t *testing.T, man evalManifest) {
	rounds := strings.Split(os.Getenv("KIRA_EVAL_ROUNDS"), ",")
	if rounds[0] == "" {
		t.Fatal("KIRA_EVAL_ROUNDS is required for footprint mode")
	}
	style := envOr("KIRA_EVAL_STYLE", "full")
	golden, _ := loadGolden()
	for _, round := range rounds {
		round = strings.TrimSpace(round)
		dir := roundDirOf(round)
		recs := loadRecords(filepath.Join(dir, "facts.jsonl"))
		if len(recs) == 0 {
			t.Fatalf("%s: no facts.jsonl records", round)
		}
		rd, _ := loadRound(round)
		scored := scoredSources(dir)
		format := "p273"
		rows := []footprintRow{}
		var tuning, holdout, all footprintSum
		for _, s := range man.Sources {
			rec, ok := recs[s.ID]
			if !ok || (scored != nil && !scored[s.ID]) {
				continue
			}
			text, err := materialise(man.Commit, s)
			if err != nil {
				t.Fatal(err)
			}
			full := footprintOf(s, text, rec)
			row := full
			if style != "full" {
				stored, ok := styleFacts(round, s.ID, rec, style)
				if !ok {
					t.Fatalf("%s/%s: no %s facts", round, s.ID, style)
				}
				rec.Stored = stored
				row = footprintOf(s, text, rec)
			}
			row.TokTotal, row.TokKept = tokenRecall(golden[s.ID], rd.grades[s.ID], rec.Stored)
			if style != "full" {
				for i, f := range recs[s.ID].Stored {
					if len(textloss.Names(f.Fact)) > 0 && len(textloss.Names(rec.Stored[i].Fact)) == 0 {
						row.SubjectCut++
					}
				}
			}
			if doc, _ := renderedDoc(rec, titleOf(text, s), s.ID+"."+s.Kind, evalDocDate); strings.Contains(doc, "\nkira-memory: 3\n") {
				format = "v3"
			}
			rows = append(rows, row)
			all.add(row)
			if s.Set == "tuning" {
				tuning.add(row)
			} else {
				holdout.add(row)
			}
		}
		slices.SortFunc(rows, func(a, b footprintRow) int { return strings.Compare(a.Source, b.Source) })
		for _, sum := range []*footprintSum{&tuning, &holdout, &all} {
			sum.done()
		}
		raw, _ := json.MarshalIndent(map[string]any{"round": round, "format": format, "style": style, "sources": rows,
			"tuning": tuning, "holdout": holdout, "all": all}, "", "  ")
		outDir := filepath.Join(evalRunsDir(), filepath.Base(round))
		_ = os.MkdirAll(outDir, 0o755)
		name := "footprint-" + format
		if style != "full" {
			name += "-" + style
		}
		out := filepath.Join(outDir, name+".json")
		if err := os.WriteFile(out, append(raw, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("%s %s %s: tuning C_distill %.3f C_fact %.3f C_store %.3f C_rec %.3f C_doc %.3f token recall %.3f (%d/%d); all C_doc %.3f", round, format, style,
			tuning.CDistill, tuning.CFact, tuning.CStore, tuning.CRec, tuning.CDoc, tuning.TokenRecall, tuning.TokKept, tuning.TokTotal, all.CDoc)
	}
}

// scoredSources lists the sources of a round's scores.json, nil when it has none. A round stopped by
// the spend cap holds records for sources it never scored; the footprint covers the scored set only.
func scoredSources(dir string) map[string]bool {
	raw, err := os.ReadFile(filepath.Join(dir, "scores.json"))
	if err != nil {
		return nil
	}
	var sc struct {
		Sources map[string]json.RawMessage `json:"sources"`
	}
	if json.Unmarshal(raw, &sc) != nil || len(sc.Sources) == 0 {
		return nil
	}
	out := map[string]bool{}
	for id := range sc.Sources {
		out[id] = true
	}
	return out
}
