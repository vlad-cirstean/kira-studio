package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"go/format"
	"go/scanner"
	"go/token"
	"io"
	"os"
	"os/exec"
	"sort"
	"strings"
)

// splice replaces each unit's [Start, End) with text(u), highest start first. The bytes it replaces must be the
// unit's original text and units must not overlap.
func splice(src []byte, us []Unit, text func(Unit) string) ([]byte, error) {
	sorted := append([]Unit(nil), us...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Start < sorted[j].Start })
	for i, u := range sorted {
		if u.End > len(src) || string(src[u.Start:u.End]) != u.Text {
			return nil, fmt.Errorf("unit %s: file text at %d..%d is not the scanned comment", u.ID, u.Start, u.End)
		}
		if i > 0 && sorted[i-1].End > u.Start {
			return nil, fmt.Errorf("units %s and %s overlap", sorted[i-1].ID, u.ID)
		}
	}
	out := append([]byte(nil), src...)
	for i := len(sorted) - 1; i >= 0; i-- {
		u := sorted[i]
		out = append(out[:u.Start], append([]byte(text(u)), out[u.End:]...)...)
	}
	return out, nil
}

type tokPair struct {
	tok token.Token
	lit string
}

// goTokens is the token stream with comments skipped; an auto-inserted semicolon keeps no literal.
func goTokens(src []byte) ([]tokPair, error) {
	fset := token.NewFileSet()
	file := fset.AddFile("", fset.Base(), len(src))
	var s scanner.Scanner
	var scanErr error
	s.Init(file, src, func(_ token.Position, msg string) { scanErr = errors.New(msg) }, 0)
	var out []tokPair
	for {
		_, tok, lit := s.Scan()
		if tok == token.EOF {
			break
		}
		if tok == token.SEMICOLON {
			lit = ""
		}
		out = append(out, tokPair{tok, lit})
	}
	return out, scanErr
}

// goDiff is "" when after holds the same code as before: equal token streams, equal comment-group count, and
// gofmt-clean after when before was.
func goDiff(name string, before, after []byte) string {
	a, err := goTokens(before)
	if err != nil {
		return "before: " + err.Error()
	}
	b, err := goTokens(after)
	if err != nil {
		return "after: " + err.Error()
	}
	if len(a) != len(b) {
		return fmt.Sprintf("token count %d != %d", len(a), len(b))
	}
	for i := range a {
		if a[i] != b[i] {
			return fmt.Sprintf("token %d differs: %v %q != %v %q", i, a[i].tok, a[i].lit, b[i].tok, b[i].lit)
		}
	}
	ga, _, err := goGroups(name, before)
	if err != nil {
		return "before: " + err.Error()
	}
	gb, _, err := goGroups(name, after)
	if err != nil {
		return "after: " + err.Error()
	}
	if len(ga) != len(gb) {
		return fmt.Sprintf("comment groups %d != %d", len(ga), len(gb))
	}
	if fa, err := format.Source(before); err == nil && bytes.Equal(fa, before) {
		if fb, err := format.Source(after); err != nil || !bytes.Equal(fb, after) {
			return "after is not gofmt-clean"
		}
	}
	return ""
}

// tsHelper is one long-lived `scan.ts check` process.
type tsHelper struct {
	cmd *exec.Cmd
	in  io.WriteCloser
	out *bufio.Reader
}

func startHelper() (*tsHelper, error) {
	cmd := exec.Command("bun", "scripts/commentsweep/scan.ts", "check")
	cmd.Stderr = os.Stderr
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return &tsHelper{cmd: cmd, in: in, out: bufio.NewReaderSize(out, 1<<20)}, nil
}

func (h *tsHelper) close() {
	_ = h.in.Close()
	_ = h.cmd.Wait()
}

// diff is "" when the printed code of before and after match and the comment ranges correspond one to one.
func (h *tsHelper) diff(name string, before, after []byte) (string, error) {
	req, err := json.Marshal(map[string]string{"file": name, "before": string(before), "after": string(after)})
	if err != nil {
		return "", err
	}
	if _, err := h.in.Write(append(req, '\n')); err != nil {
		return "", err
	}
	line, err := h.out.ReadBytes('\n')
	if err != nil {
		return "", err
	}
	var r struct {
		OK           bool       `json:"ok"`
		Reason       string     `json:"reason"`
		Ranges       []rawRange `json:"ranges"`
		RangesBefore []rawRange `json:"rangesBefore"`
	}
	if err := json.Unmarshal(line, &r); err != nil {
		return "", err
	}
	if !r.OK {
		return r.Reason, nil
	}
	ga, gb := tsGroups(before, r.RangesBefore), tsGroups(after, r.Ranges)
	if len(ga) != len(gb) {
		return fmt.Sprintf("comment groups %d != %d", len(ga), len(gb)), nil
	}
	return "", nil
}

type checker struct{ helper *tsHelper }

func (c *checker) diff(name, lang string, before, after []byte) (string, error) {
	if lang == "go" {
		return goDiff(name, before, after), nil
	}
	if c.helper == nil {
		h, err := startHelper()
		if err != nil {
			return "", err
		}
		c.helper = h
	}
	return c.helper.diff(name, before, after)
}

func (c *checker) close() {
	if c.helper != nil {
		c.helper.close()
	}
}

type applyOpts struct {
	lang     string
	prefixes []string
	dry      bool
}

// applyFile splices every unit, checks the code is unchanged, and on failure keeps the units that pass one by
// one. It returns the new source, the units used and the units rejected with their reason.
func applyFile(c *checker, file, lang string, src []byte, us []Unit, text func(Unit) string) ([]byte, []Unit, map[string]string, error) {
	out, err := splice(src, us, text)
	if err != nil {
		return nil, nil, nil, err
	}
	reason, err := c.diff(file, lang, src, out)
	if err != nil {
		return nil, nil, nil, err
	}
	if reason == "" {
		return out, us, nil, nil
	}
	var used []Unit
	rejected := map[string]string{}
	cur := src
	for _, u := range us {
		trial := append(append([]Unit(nil), used...), u)
		cand, err := splice(src, trial, text)
		if err != nil {
			rejected[u.ID] = err.Error()
			continue
		}
		r, err := c.diff(file, lang, src, cand)
		if err != nil {
			return nil, nil, nil, err
		}
		if r != "" {
			rejected[u.ID] = r
			continue
		}
		used, cur = trial, cand
	}
	return cur, used, rejected, nil
}

func loadRestored() (map[string]bool, error) {
	m := map[string]bool{}
	err := readLines("restored.jsonl", func(r Restored) { m[r.ID] = true })
	return m, err
}

// applyState is what one apply run reads once: units to write per file and their results.
type applyState struct {
	byFile  map[string][]Unit
	results map[string]Result
}

func loadApplyState(o applyOpts) (*applyState, error) {
	units, err := loadUnits()
	if err != nil {
		return nil, err
	}
	results, err := loadResults()
	if err != nil {
		return nil, err
	}
	restored, err := loadRestored()
	if err != nil {
		return nil, err
	}
	done := map[string]bool{}
	if err := readLines("applied.jsonl", func(a Applied) {
		for _, id := range a.Units {
			done[id] = true
		}
	}); err != nil {
		return nil, err
	}
	st := &applyState{byFile: map[string][]Unit{}, results: results}
	for _, u := range unitsOfLang(units, o.lang) {
		if r, ok := results[u.InputKey]; ok && r.Outcome == outRewritten && !restored[u.ID] && !done[u.ID] && (len(o.prefixes) == 0 || hasPrefix(u.File, o.prefixes)) {
			st.byFile[u.File] = append(st.byFile[u.File], u)
		}
	}
	return st, nil
}

type applyTotals struct{ written, units, rejected int }

// applyOne writes one file; stale reports a file that changed since the scan.
func (st *applyState) applyOne(c *checker, o applyOpts, f string, tot *applyTotals) (stale bool, err error) {
	us := st.byFile[f]
	src, err := os.ReadFile(f)
	if err != nil {
		return false, err
	}
	cur := sha(src)
	if cur != us[0].FileSha {
		var ok bool
		if us, ok = relocate(src, us); !ok {
			return true, nil
		}
	}
	text := func(u Unit) string { return st.results[u.InputKey].Text }
	out, used, rejected, err := applyFile(c, f, o.lang, src, us, text)
	if err != nil {
		return false, fmt.Errorf("%s: %w", f, err)
	}
	for _, u := range us {
		r, bad := rejected[u.ID]
		if !bad {
			continue
		}
		tot.rejected++
		fmt.Printf("rejected %s:%d %s: %s\n", f, u.Line, u.ID, r)
		if !o.dry {
			rr := st.results[u.InputKey]
			rr.Outcome, rr.Gate, rr.Reason, rr.Text = outKept, "apply", clip(r, 200), ""
			if err := appendWork("results.jsonl", rr); err != nil {
				return false, err
			}
		}
	}
	tot.units += len(used)
	if o.dry {
		for _, u := range used {
			fmt.Printf("--- %s:%d (%s)\n%s\n+++\n%s\n", u.File, u.Line, u.ID, u.Text, text(u))
		}
		return false, nil
	}
	if len(used) == 0 {
		return false, nil
	}
	return false, writeApplied(f, o.lang, cur, out, used, tot)
}

// relocate finds each unit's text again in a file that changed since the scan (an earlier apply shifted
// offsets). It succeeds only when every text occurs exactly once; the code check still gates the write.
func relocate(src []byte, us []Unit) ([]Unit, bool) {
	out := make([]Unit, len(us))
	for i, u := range us {
		if bytes.Count(src, []byte(u.Text)) != 1 {
			return nil, false
		}
		u.Start = bytes.Index(src, []byte(u.Text))
		u.End = u.Start + len(u.Text)
		out[i] = u
	}
	return out, true
}

func writeApplied(f, lang, beforeSha string, out []byte, used []Unit, tot *applyTotals) error {
	info, err := os.Stat(f)
	if err != nil {
		return err
	}
	if err := os.WriteFile(f, out, info.Mode().Perm()); err != nil {
		return err
	}
	ids := make([]string, len(used))
	for i, u := range used {
		ids[i] = u.ID
	}
	tot.written++
	return appendWork("applied.jsonl", Applied{Lang: lang, File: f, BeforeSha: beforeSha, AfterSha: sha(out), Units: ids})
}

func runApply(o applyOpts) error {
	st, err := loadApplyState(o)
	if err != nil {
		return err
	}
	c := &checker{}
	defer c.close()
	files := sortedKeys(st.byFile)
	var stale []string
	var tot applyTotals
	for _, f := range files {
		isStale, err := st.applyOne(c, o, f, &tot)
		if err != nil {
			return err
		}
		if isStale {
			stale = append(stale, f)
		}
	}
	fmt.Printf("%s: %d files written, %d units applied, %d rejected by the code check, %d files stale (changed since scan)\n",
		o.lang, tot.written, tot.units, tot.rejected, len(stale))
	for _, f := range stale {
		fmt.Println("stale:", f)
	}
	if len(stale) > 0 {
		return fmt.Errorf("%d stale files; rescan and rerun for them", len(stale))
	}
	return nil
}

// runRestore puts the original text back for the named units in the working tree.
func runRestore(ids []string) error {
	units, err := loadUnits()
	if err != nil {
		return err
	}
	results, err := loadResults()
	if err != nil {
		return err
	}
	byID := map[string]Unit{}
	for _, u := range units {
		byID[u.ID] = u
	}
	c := &checker{}
	defer c.close()
	for _, id := range ids {
		u, ok := byID[id]
		if !ok {
			return fmt.Errorf("unknown unit %s", id)
		}
		r := results[u.InputKey]
		if r.Outcome != outRewritten {
			return fmt.Errorf("unit %s was not rewritten", id)
		}
		src, err := os.ReadFile(u.File)
		if err != nil {
			return err
		}
		if n := bytes.Count(src, []byte(r.Text)); n != 1 {
			return fmt.Errorf("unit %s: rewritten text found %d times in %s; restore it by hand", id, n, u.File)
		}
		out := bytes.Replace(src, []byte(r.Text), []byte(u.Text), 1)
		reason, err := c.diff(u.File, u.Lang, src, out)
		if err != nil {
			return err
		}
		if reason != "" {
			return fmt.Errorf("unit %s: %s", id, reason)
		}
		info, err := os.Stat(u.File)
		if err != nil {
			return err
		}
		if err := os.WriteFile(u.File, out, info.Mode().Perm()); err != nil {
			return err
		}
		if err := appendWork("applied.jsonl", Applied{Lang: u.Lang, File: u.File, BeforeSha: sha(src), AfterSha: sha(out), Units: []string{id}}); err != nil {
			return err
		}
		if err := appendWork("restored.jsonl", Restored{ID: id, File: u.File}); err != nil {
			return err
		}
		fmt.Printf("restored %s:%d\n", u.File, u.Line)
	}
	return nil
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
