package claude

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// evalSource is one manifest entry. Select is whole, section:<heading line> or comments; Kind is the
// extension the materialised file gets, which picks the chunker.
type evalSource struct {
	ID       string `json:"id"`
	Set      string `json:"set"`
	Category string `json:"category"`
	Path     string `json:"path"`
	Select   string `json:"select"`
	Kind     string `json:"kind"`
	Bytes    int    `json:"bytes"`
}

type evalManifest struct {
	Commit  string       `json:"commit"`
	Sources []evalSource `json:"sources"`
}

func evalRepoRoot() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", ".."))
}

func evalCorpusDir() string {
	return filepath.Join(evalRepoRoot(), "docs", "v2.5", "plans", "P285-corpus")
}

// evalCorpus291Dir holds the P291 prompts, schemas and questions.
func evalCorpus291Dir() string { return filepath.Join(evalPlansDir(), "P291-corpus") }

// evalPlansDir is docs/v2.5/plans, where corpus, runs and rounds live.
func evalPlansDir() string { return filepath.Join(evalRepoRoot(), "docs", "v2.5", "plans") }

// evalRunsDir is the runs dir of this process: P285-runs, or KIRA_EVAL_RUNS_DIR (a name under plans).
func evalRunsDir() string {
	return filepath.Join(evalPlansDir(), filepath.Base(envOr("KIRA_EVAL_RUNS_DIR", "P285-runs")))
}

// roundDirOf resolves a round reference: a bare name lives under the runs dir, "<dir>/<round>" under plans.
func roundDirOf(ref string) string {
	if strings.Contains(ref, "/") {
		return filepath.Join(evalPlansDir(), ref)
	}
	return filepath.Join(evalRunsDir(), ref)
}

func loadManifest() (evalManifest, error) {
	var m evalManifest
	raw, err := os.ReadFile(filepath.Join(evalCorpusDir(), "manifest.json"))
	if err != nil {
		return m, err
	}
	return m, json.Unmarshal(raw, &m)
}

func (m evalManifest) pick(set string) []evalSource {
	var out []evalSource
	for _, s := range m.Sources {
		if set == "all" || s.Set == set {
			out = append(out, s)
		}
	}
	return out
}

// gitShow reads a file at the pinned commit, so later edits never change the corpus.
func gitShow(commit, path string) (string, error) {
	cmd := exec.Command("git", "-C", evalRepoRoot(), "show", commit+":"+path)
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git show %s:%s: %v: %s", commit, path, err, errb.String())
	}
	return out.String(), nil
}

// materialise returns the exact text a source ingests.
func materialise(commit string, s evalSource) (string, error) {
	raw, err := gitShow(commit, s.Path)
	if err != nil {
		return "", err
	}
	switch {
	case s.Select == "whole":
		return raw, nil
	case s.Select == "comments":
		return extractComments(s.Path, raw), nil
	case strings.HasPrefix(s.Select, "section:"):
		sec, ok := markdownSection(raw, strings.TrimPrefix(s.Select, "section:"))
		if !ok {
			return "", fmt.Errorf("%s: heading %q not found", s.ID, s.Select)
		}
		return sec, nil
	}
	return "", fmt.Errorf("%s: unknown select %q", s.ID, s.Select)
}

// fileName is the ingested file's name: the original basename, plus .txt when the kind differs.
func (s evalSource) fileName() string {
	base := filepath.Base(s.Path)
	if filepath.Ext(base) == "."+s.Kind {
		return base
	}
	return base + "." + s.Kind
}

func headingLevel(line string) int {
	n := 0
	for n < len(line) && line[n] == '#' {
		n++
	}
	if n == 0 || n > 6 || n >= len(line) || line[n] != ' ' {
		return 0
	}
	return n
}

// markdownSection returns the heading line through the line before the next heading of the same or
// higher level. Fenced code is skipped when looking for headings.
func markdownSection(text, heading string) (string, bool) {
	lines := strings.Split(text, "\n")
	want := headingLevel(heading)
	start, fence := -1, false
	for i, l := range lines {
		if strings.HasPrefix(strings.TrimSpace(l), "```") {
			fence = !fence
		}
		if fence {
			continue
		}
		lvl := headingLevel(l)
		if start < 0 {
			if lvl > 0 && strings.TrimSpace(l) == heading {
				start = i
			}
			continue
		}
		if lvl > 0 && lvl <= want {
			return strings.TrimRight(strings.Join(lines[start:i], "\n"), "\n") + "\n", true
		}
	}
	if start < 0 {
		return "", false
	}
	return strings.TrimRight(strings.Join(lines[start:], "\n"), "\n") + "\n", true
}

func isCommentLine(t string) bool {
	if strings.HasPrefix(t, "//go:") || strings.HasPrefix(t, "// Code generated") {
		return false
	}
	return strings.HasPrefix(t, "//") || strings.HasPrefix(t, "/*") || strings.HasPrefix(t, "*")
}

func stripMarker(t string) string {
	for _, m := range []string{"/**", "/*", "*/", "//", "*"} {
		if strings.HasPrefix(t, m) {
			t = strings.TrimPrefix(t, m)
			t = strings.TrimSuffix(t, "*/")
			t = strings.TrimPrefix(t, " ")
			return strings.TrimRight(t, " \t")
		}
	}
	return t
}

// extractComments writes each consecutive comment-line block, then a `code:` line naming the first
// declaration after it, so a doc comment keeps its subject.
func extractComments(path, src string) string {
	lines := strings.Split(src, "\n")
	var b strings.Builder
	fmt.Fprintf(&b, "Comments from %s\n\n", path)
	for i := 0; i < len(lines); {
		if !isCommentLine(strings.TrimSpace(lines[i])) {
			i++
			continue
		}
		var block []string
		for i < len(lines) && isCommentLine(strings.TrimSpace(lines[i])) {
			block = append(block, stripMarker(strings.TrimSpace(lines[i])))
			i++
		}
		code := ""
		for j := i; j < len(lines); j++ {
			t := strings.TrimSpace(lines[j])
			if t == "" || isCommentLine(t) {
				continue
			}
			code = t
			break
		}
		b.WriteString(strings.Join(block, "\n"))
		b.WriteString("\ncode: " + code + "\n\n")
	}
	return b.String()
}
