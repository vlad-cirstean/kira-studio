package main

import (
	"crypto/sha1"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var wordRe = regexp.MustCompile(`[a-z0-9]{5,}`)

// carried reports whether at least 40% of the long words of src appear in hist.
func carried(src, hist string) bool {
	words := wordRe.FindAllString(strings.ToLower(src), -1)
	if len(words) == 0 {
		return true
	}
	hist = strings.ToLower(hist)
	n := 0
	for _, w := range words {
		if strings.Contains(hist, w) {
			n++
		}
	}
	return n*10 >= len(words)*4
}

type sample struct {
	u    Unit
	rec  Record
	spec string
	key  string
}

type pool struct {
	all                []sample
	fallbacks, pending int
}

func (pl *pool) add(ch, runs string) error {
	recs, err := loadRecords(filepath.Join(runs, ch+".jsonl"))
	if err != nil {
		return err
	}
	commit := ""
	for _, r := range recs {
		commit = r.SourceCommit
		break
	}
	if commit == "" {
		return fmt.Errorf("%s: no runs recorded", ch)
	}
	p, err := loadChapter(ch, commit)
	if err != nil {
		return err
	}
	spec, err := git("show", commit+":docs/"+ch+"/SPEC.md")
	if err != nil {
		return err
	}
	for _, u := range buildUnits(p) {
		if u.Notes {
			continue
		}
		r, ok := recs[u.Slug]
		switch {
		case !ok:
			pl.pending++
		case r.State != stateOK:
			pl.fallbacks++
		}
		if ok {
			pl.all = append(pl.all, sample{u: u, rec: r, spec: spec, key: fmt.Sprintf("%x", sha1.Sum([]byte(ch+" "+u.ID)))})
		}
	}
	return nil
}

func tagged(line, hist string) string {
	tag := "[CHECK]"
	if carried(line, hist) {
		tag = "[carried]"
	}
	return fmt.Sprintf("  %s %s\n", tag, clip(oneLine(line), 260))
}

func writeSample(w io.Writer, s sample) {
	hist := strings.Join(s.rec.Lines, " ")
	fmt.Fprintf(w, "\n## %s %s %s\nstate %s, %d lines, source %d chars\nhistory:\n", s.u.Chapter, s.u.ID, clip(oneLine(s.u.Title), 80), s.rec.State, len(s.rec.Lines), s.rec.InChars)
	for _, l := range s.rec.Lines {
		fmt.Fprintf(w, "  %s\n", clip(oneLine(l), 220))
	}
	if s.rec.State != stateOK {
		fmt.Fprintf(w, "  (fallback: %s)\n", s.rec.Reason)
	}
	fmt.Fprintf(w, "source markers in unit:\n")
	ms := markerLines(s.u.Text)
	for i, l := range ms {
		if i == 6 {
			fmt.Fprintf(w, "  ... %d more\n", len(ms)-6)
			break
		}
		fmt.Fprint(w, tagged(l, hist))
	}
	if len(ms) == 0 {
		fmt.Fprintf(w, "  (none)\n")
	}
	fmt.Fprintf(w, "other SPEC marker lines naming %s:\n", s.u.ID)
	idRe := regexp.MustCompile(`\b` + regexp.QuoteMeta(s.u.ID) + `\b`)
	shown := 0
	for _, l := range markerLines(s.spec) {
		if shown < 4 && idRe.MatchString(l) && !strings.Contains(s.u.Text, l) {
			shown++
			fmt.Fprint(w, tagged(l, hist))
		}
	}
	if shown == 0 {
		fmt.Fprintf(w, "  (none)\n")
	}
}

// cmdVerify writes a sample report: per sampled phase its history lines, the source marker sentences of
// its unit and the SPEC's other marker lines that name it.
func cmdVerify(runs, outPath string, n int, chapters []string) error {
	var pl pool
	for _, ch := range chapters {
		if err := pl.add(ch, runs); err != nil {
			return err
		}
	}
	sort.Slice(pl.all, func(i, j int) bool { return pl.all[i].key < pl.all[j].key })
	n = min(n, len(pl.all))
	var w io.Writer = os.Stdout
	if outPath != "-" {
		f, err := os.Create(outPath)
		if err != nil {
			return err
		}
		defer f.Close()
		w = f
	}
	fmt.Fprintf(w, "# History verify sample\n\nChapters: %s. Sample %d of %d phases. Fallback units: %d. Pending units: %d.\n"+
		"`[carried]` = at least 40%% of the source line's long words appear in the phase's history lines; `[CHECK]` needs a human read.\n",
		strings.Join(chapters, ", "), n, len(pl.all), pl.fallbacks, pl.pending)
	for _, s := range pl.all[:n] {
		writeSample(w, s)
	}
	return nil
}
