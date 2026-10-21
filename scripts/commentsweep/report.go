package main

import (
	"cmp"
	"encoding/csv"
	"fmt"
	"math/rand"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/scripts/internal/runledger"
)

const (
	stRewritten        = "rewritten"
	stUnchanged        = "unchanged"
	stRestored         = "restored"
	stPending          = "pending"
	stError            = "error"
	notAppliedMaxLines = 2000
)

// finalStatuses joins the manifest with results and restores: the status each comment ends in.
func finalStatuses() ([]Comment, map[string]string, map[string]Result, error) {
	cs, err := loadAll[Comment]("manifest.jsonl")
	if err != nil {
		return nil, nil, nil, err
	}
	units, err := loadUnits()
	if err != nil {
		return nil, nil, nil, err
	}
	results, err := loadResults()
	if err != nil {
		return nil, nil, nil, err
	}
	restored, err := loadRestored()
	if err != nil {
		return nil, nil, nil, err
	}
	key := map[string]string{}
	for _, u := range units {
		key[u.ID] = u.InputKey
	}
	st := map[string]string{}
	byID := map[string]Result{}
	for _, c := range cs {
		if c.Status != stEligible {
			st[c.ID] = c.Status
			continue
		}
		r, ok := results[key[c.ID]]
		if ok {
			byID[c.ID] = r
		}
		switch {
		case restored[c.ID]:
			st[c.ID] = stRestored
		case !ok:
			st[c.ID] = stPending
		case r.Outcome == outKept:
			st[c.ID] = "kept:" + r.Gate
		default:
			st[c.ID] = r.Outcome
		}
	}
	return cs, st, byID, nil
}

var statusOrder = []string{stOverMax, "kept:", stError, stPending, stRestored, stNotWholeLine, stCRLF, stParseError, stDirective, stLicense, stGenerated, stExcluded, stUnchanged}

func rank(status string) int {
	for i, p := range statusOrder {
		if strings.HasPrefix(status, p) {
			return i
		}
	}
	return len(statusOrder)
}

// perFile statuses list a count per file: their comments are many and never in scope.
func perFile(status string) bool { return status == stExcluded || status == stGenerated }

type tally struct {
	counts   map[string]map[string]int
	byStatus map[string][]Comment
	statuses []string
}

func tallyOf(cs []Comment, st map[string]string) tally {
	t := tally{counts: map[string]map[string]int{}, byStatus: map[string][]Comment{}}
	for _, c := range cs {
		s := st[c.ID]
		if t.counts[s] == nil {
			t.counts[s] = map[string]int{}
		}
		t.counts[s][c.Lang]++
		if s != stRewritten && s != stBelowMin {
			t.byStatus[s] = append(t.byStatus[s], c)
		}
	}
	t.statuses = sortedKeys(t.counts)
	sort.SliceStable(t.statuses, func(i, j int) bool { return rank(t.statuses[i]) < rank(t.statuses[j]) })
	return t
}

func (t tally) header(meta Meta) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# P320 comments not applied\n\nBase `%s`; line numbers refer to it. Original first line shown. Statuses:\n", meta.Base)
	fmt.Fprintf(&b, "`below-min` (under %d chars) count only; the list lives in the work-dir manifest. `rewritten` shipped.\n\n", meta.MinChars)
	b.WriteString("| status | go | ts | vue | total |\n|---|---|---|---|---|\n")
	for _, s := range t.statuses {
		c := t.counts[s]
		fmt.Fprintf(&b, "| %s | %d | %d | %d | %d |\n", s, c["go"], c["ts"], c["vue"], c["go"]+c["ts"]+c["vue"])
	}
	b.WriteString("\n")
	return b.String()
}

// section lists one status: a line per comment, or a count per file for the file-level statuses.
func (t tally) section(s string, byID map[string]Result) string {
	var b strings.Builder
	list := t.byStatus[s]
	sort.SliceStable(list, func(i, j int) bool {
		if list[i].File != list[j].File {
			return list[i].File < list[j].File
		}
		return list[i].Line < list[j].Line
	})
	fmt.Fprintf(&b, "## %s (%d)\n\n", s, len(list))
	if perFile(s) {
		per := map[string]int{}
		for _, c := range list {
			per[c.File]++
		}
		for _, f := range sortedKeys(per) {
			fmt.Fprintf(&b, "- `%s`: %d comments\n", f, per[f])
		}
		b.WriteString("\n")
		return b.String()
	}
	for _, c := range list {
		why := c.Reason
		if r, ok := byID[c.ID]; ok && (strings.HasPrefix(s, "kept:") || s == stError) {
			why = cmp.Or(r.Error, r.Reason)
		}
		if why != "" {
			why = " [" + clip(why, 120) + "]"
		}
		fmt.Fprintf(&b, "- `%s:%d` %d chars%s: %s\n", c.File, c.Line, c.Chars, why, c.First)
	}
	b.WriteString("\n")
	return b.String()
}

// runNotApplied writes the not-applied report: full into the work dir, and the committed copy under docs.
func runNotApplied(docOut string) error {
	cs, st, byID, err := finalStatuses()
	if err != nil {
		return err
	}
	meta, _ := loadMeta()
	t := tallyOf(cs, st)
	var full, short strings.Builder
	full.WriteString(t.header(meta))
	short.WriteString(t.header(meta))
	for _, s := range t.statuses {
		if s == stRewritten || s == stBelowMin {
			continue
		}
		sec := t.section(s, byID)
		full.WriteString(sec)
		if s == stOverMax || strings.HasPrefix(s, "kept:") || s == stError || s == stPending {
			short.WriteString(sec)
		}
	}
	if err := os.WriteFile(wpath("not-applied.md"), []byte(full.String()), 0o644); err != nil {
		return err
	}
	if err := writeCSV(cs, st); err != nil {
		return err
	}
	lines := strings.Count(full.String(), "\n")
	doc := full.String()
	if lines > notAppliedMaxLines {
		doc = short.String() + "Full list (every status, " + strconv.Itoa(lines) + " lines): `" + wpath("not-applied.md") + "` (untracked work dir); every comment of any size: `" + wpath("manifest.jsonl") + "`.\n"
	}
	if docOut != "" {
		if err := os.WriteFile(docOut, []byte(doc), 0o644); err != nil {
			return err
		}
	}
	fmt.Printf("full report %s (%d lines), csv %s, committed copy %s (%d lines)\n", wpath("not-applied.md"), lines, wpath("not-applied.csv"), docOut, strings.Count(doc, "\n"))
	for _, s := range t.statuses {
		c := t.counts[s]
		fmt.Printf("  %-16s go %5d ts %5d vue %4d\n", s, c["go"], c["ts"], c["vue"])
	}
	return nil
}

func writeCSV(cs []Comment, st map[string]string) error {
	f, err := os.Create(wpath("not-applied.csv"))
	if err != nil {
		return err
	}
	defer f.Close()
	w := csv.NewWriter(f)
	_ = w.Write([]string{"status", "lang", "file", "line", "chars", "reason", "first"})
	for _, c := range cs {
		if st[c.ID] == stRewritten {
			continue
		}
		_ = w.Write([]string{st[c.ID], c.Lang, c.File, strconv.Itoa(c.Line), strconv.Itoa(c.Chars), c.Reason, c.First})
	}
	w.Flush()
	return w.Error()
}

func fence(s string) string { return "```\n" + s + "\n```\n" }

// summaryTable is the per-language outcome table and the kept-by-gate list.
func summaryTable(cs []Comment, st map[string]string) string {
	var b strings.Builder
	b.WriteString("| lang | units | rewritten | unchanged | kept | error | pending | over-max | skipped |\n|---|---|---|---|---|---|---|---|---|\n")
	gates := map[string]map[string]int{}
	for _, l := range []string{"go", "ts", "vue"} {
		c := map[string]int{}
		for _, m := range cs {
			if m.Lang != l {
				continue
			}
			s := st[m.ID]
			switch {
			case strings.HasPrefix(s, "kept:"):
				c["kept"]++
				if gates[s] == nil {
					gates[s] = map[string]int{}
				}
				gates[s][l]++
			case s == stDirective || s == stLicense || s == stNotWholeLine || s == stCRLF:
				c["skipped"]++
			default:
				c[s]++
			}
			if m.Status == stEligible {
				c["units"]++
			}
		}
		fmt.Fprintf(&b, "| %s | %d | %d | %d | %d | %d | %d | %d | %d |\n", l, c["units"], c[stRewritten]+c[stRestored], c[stUnchanged], c["kept"], c[stError], c[stPending], c[stOverMax], c["skipped"])
	}
	b.WriteString("\nKept by gate:\n\n")
	for _, g := range sortedKeys(gates) {
		fmt.Fprintf(&b, "- %s: go %d, ts %d, vue %d\n", g, gates[g]["go"], gates[g]["ts"], gates[g]["vue"])
	}
	return b.String()
}

// sampleSection is the seeded uniform sample of one language's rewritten units, before and after.
func sampleSection(lang string, units []Unit, st map[string]string, results map[string]Result, n int, seed int64) string {
	var pool []Unit
	for _, u := range unitsOfLang(units, lang) {
		if st[u.ID] == stRewritten {
			pool = append(pool, u)
		}
	}
	rng := rand.New(rand.NewSource(seed))
	rng.Shuffle(len(pool), func(i, j int) { pool[i], pool[j] = pool[j], pool[i] })
	pool = pool[:min(n, len(pool))]
	sortUnits(pool)
	var b strings.Builder
	fmt.Fprintf(&b, "\n## %s sample (%d)\n", lang, len(pool))
	for _, u := range pool {
		r := results[u.InputKey]
		fmt.Fprintf(&b, "\n### %s `%s:%d`\n\nBefore:\n%s\nAfter:\n%s\n", u.ID, u.File, u.Line, fence(u.Text), fence(r.Text))
		ctx := strings.Split(u.Context, "\n")
		fmt.Fprintf(&b, "Context:\n%s\n", fence(strings.Join(ctx[:min(8, len(ctx))], "\n")))
		if len(r.Dropped) > 0 {
			b.WriteString("Dropped:\n")
			for _, d := range r.Dropped {
				fmt.Fprintf(&b, "- %s (%s)\n", oneLine(d.Text), d.Why)
			}
		}
		fmt.Fprintf(&b, "Reason: %s\n", r.Reason)
	}
	return b.String()
}

// runSample writes the per-language sampled before/after report for the judge.
func runSample(n int, seed int64, out string) error {
	cs, st, _, err := finalStatuses()
	if err != nil {
		return err
	}
	units, err := loadUnits()
	if err != nil {
		return err
	}
	results, err := loadResults()
	if err != nil {
		return err
	}
	meta, _ := loadMeta()
	var wall time.Duration
	_ = readLines("runs.jsonl", func(r RunLog) { wall += r.End.Sub(r.Start) })
	spent := runledger.TotalCharged(workDir)
	var b strings.Builder
	fmt.Fprintf(&b, "# P320 report\n\nBase `%s`, seed %d, %d rewritten units sampled per language. Line numbers refer to the base.\n\n", meta.Base, seed, n)
	fmt.Fprintf(&b, "Spend %.2f USD over %d results (%.4f per unit); run wall time %s.\n\n", spent, len(results), spent/float64(max(len(results), 1)), wall.Round(time.Minute))
	b.WriteString(summaryTable(cs, st))
	for _, l := range []string{"go", "ts", "vue"} {
		b.WriteString(sampleSection(l, units, st, results, n, seed))
	}
	b.WriteString("\n## Over-limit units\n\n")
	for _, c := range cs {
		if c.Status == stOverMax {
			fmt.Fprintf(&b, "- `%s:%d` %d chars\n", c.File, c.Line, c.Chars)
		}
	}
	return os.WriteFile(out, []byte(b.String()), 0o644)
}

func oneLine(s string) string { return strings.Join(strings.Fields(s), " ") }

// runStatus prints units, outcomes, spend and applied files.
func runStatus() error {
	cs, st, _, err := finalStatuses()
	if err != nil {
		return err
	}
	counts := map[string]map[string]int{}
	for _, c := range cs {
		if counts[c.Lang] == nil {
			counts[c.Lang] = map[string]int{}
		}
		counts[c.Lang][st[c.ID]]++
	}
	for _, l := range []string{"go", "ts", "vue"} {
		fmt.Printf("%s:", l)
		for _, s := range sortedKeys(counts[l]) {
			fmt.Printf(" %s=%d", s, counts[l][s])
		}
		fmt.Println()
	}
	fmt.Printf("spend %.4f USD\n", runledger.TotalCharged(workDir))
	applied := map[string]map[string]bool{}
	_ = readLines("applied.jsonl", func(a Applied) {
		if applied[a.Lang] == nil {
			applied[a.Lang] = map[string]bool{}
		}
		applied[a.Lang][a.File] = true
	})
	for _, l := range []string{"go", "ts", "vue"} {
		fmt.Printf("applied files %s: %d\n", l, len(applied[l]))
	}
	return nil
}
