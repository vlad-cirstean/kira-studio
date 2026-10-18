package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Unit is one distill input: a phase or a chapter's notes.
type Unit struct {
	Slug, Chapter, ID, Title, Status string
	Text, Sha                        string
	Notes                            bool
	Phase                            *Phase
}

func git(args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git %s: %v: %s", strings.Join(args, " "), err, strings.TrimSpace(errb.String()))
	}
	return out.String(), nil
}

// chapterCommit is the last commit that added or changed a file under docs/<ch>; a deletion commit does not count.
func chapterCommit(ch string) (string, error) {
	out, err := git("log", "-1", "--format=%H", "--diff-filter=ACMR", "--", "docs/"+ch)
	if err != nil {
		return "", err
	}
	c := strings.TrimSpace(out)
	if c == "" {
		return "", fmt.Errorf("no commit touches docs/%s", ch)
	}
	return c, nil
}

func checkClean(ch string) error {
	out, err := git("status", "--porcelain", "--", "docs/"+ch)
	if err != nil {
		return err
	}
	if strings.TrimSpace(out) != "" {
		return fmt.Errorf("uncommitted changes under docs/%s:\n%s", ch, out)
	}
	return nil
}

var chapterRe = regexp.MustCompile(`^v\d+(?:\.\d+)?$`)

func checkChapter(ch string) error {
	if !chapterRe.MatchString(ch) {
		return fmt.Errorf("bad chapter %q", ch)
	}
	if ch == "v2.6" {
		return fmt.Errorf("v2.6 is the current chapter and is never folded")
	}
	return nil
}

// versionKey orders chapter names: v1 < v1.1 < v2.0.
func versionKey(ch string) []int {
	parts := strings.Split(strings.TrimPrefix(ch, "v"), ".")
	k := make([]int, 0, len(parts))
	for _, p := range parts {
		n, _ := strconv.Atoi(p)
		k = append(k, n)
	}
	return k
}

func chapterLess(a, b string) bool {
	x, y := versionKey(a), versionKey(b)
	for i := 0; i < len(x) && i < len(y); i++ {
		if x[i] != y[i] {
			return x[i] < y[i]
		}
	}
	return len(x) < len(y)
}

func sortChapters(chs []string, newestFirst bool) []string {
	out := append([]string(nil), chs...)
	sort.Slice(out, func(i, j int) bool {
		if newestFirst {
			return chapterLess(out[j], out[i])
		}
		return chapterLess(out[i], out[j])
	})
	return out
}

func sortedKeys(m map[string]string) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return ks
}

// planResultChapters are the chapters whose plan files carry Result sections that belong to SPEC phases.
var planResultChapters = map[string]bool{"v2.0": true, "v2.5": true}

// loadChapter reads docs/<ch> from commit and parses it.
func loadChapter(ch, commit string) (*Parsed, error) {
	out, err := git("ls-tree", "-r", "--name-only", commit, "--", "docs/"+ch+"/")
	if err != nil {
		return nil, err
	}
	show := func(path string) (string, error) { return git("show", commit+":"+path) }
	base := "docs/" + ch + "/"
	var spec, readme string
	extras, plans := map[string]string{}, map[string]string{}
	for _, f := range strings.Split(strings.TrimSpace(out), "\n") {
		if f == "" || !strings.HasSuffix(f, ".md") {
			continue
		}
		rel := strings.TrimPrefix(f, base)
		switch {
		case rel == "SPEC.md":
			spec, err = show(f)
		case rel == "README.md":
			readme, err = show(f)
		case !strings.Contains(rel, "/"):
			extras[rel], err = show(f)
		case planResultChapters[ch] && strings.HasPrefix(rel, "plans/") && strings.Count(rel, "/") == 1:
			plans[strings.TrimPrefix(rel, "plans/")], err = show(f)
		}
		if err != nil {
			return nil, err
		}
	}
	if spec == "" {
		return nil, fmt.Errorf("docs/%s/SPEC.md not in %s", ch, commit)
	}
	return Parse(ch, spec, readme, extras, plans), nil
}

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

func slug(ch, id string) string {
	return ch + "-" + strings.Trim(slugRe.ReplaceAllString(strings.ToLower(id), "-"), "-")
}

func (p *Phase) unitText(ch string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s %s\n\n", ch, p.ID)
	if t := strings.TrimSpace(p.Title); t != "" {
		b.WriteString(t + "\n\n")
	}
	if p.StatusFull != "" {
		b.WriteString("Status: " + p.StatusFull + "\n\n")
	} else if p.Status != "" {
		b.WriteString("Status: " + p.Status + "\n\n")
	}
	for _, c := range p.Cells {
		b.WriteString(c + "\n\n")
	}
	if len(p.Results) > 0 {
		b.WriteString("## Result\n\n" + strings.Join(p.Results, "\n\n") + "\n\n")
	}
	if len(p.Mentions) > 0 {
		b.WriteString("## Mentioned elsewhere\n\n" + strings.Join(p.Mentions, "\n\n") + "\n\n")
	}
	return strings.TrimRight(b.String(), "\n") + "\n"
}

func (p *Parsed) notesText() string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s notes\n\n", p.Chapter)
	if p.Intro != "" {
		b.WriteString(p.Intro + "\n\n")
	}
	for _, l := range p.Notes {
		b.WriteString(l + "\n\n")
	}
	return strings.TrimRight(b.String(), "\n") + "\n"
}

func sha(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func buildUnits(p *Parsed) []Unit {
	var us []Unit
	for _, ph := range p.Phases {
		t := ph.unitText(p.Chapter)
		us = append(us, Unit{Slug: slug(p.Chapter, ph.ID), Chapter: p.Chapter, ID: ph.ID, Title: ph.Title,
			Status: ph.Status, Text: t, Sha: sha(t), Phase: ph})
	}
	if p.Intro != "" || len(p.Notes) > 0 {
		t := p.notesText()
		us = append(us, Unit{Slug: p.Chapter + "-notes", Chapter: p.Chapter, ID: "notes", Title: "notes",
			Text: t, Sha: sha(t), Notes: true})
	}
	return us
}

// markerLines are the lines of text that carry a decision marker.
func markerLines(text string) []string {
	var out []string
	for _, l := range strings.Split(text, "\n") {
		l = strings.TrimSpace(l)
		if l != "" && !strings.HasPrefix(l, "#") && markerRe.MatchString(l) {
			out = append(out, l)
		}
	}
	return out
}
