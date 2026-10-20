package importer

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// Gate codes: the check that rejected a rewrite draft.
const (
	GateGrew      = "grew"
	GateForm      = "form"
	GateIndent    = "indent"
	GateWidth     = "width"
	GateDirective = "directive"
	GateTokens    = "tokens"
	GateCheck     = "check"
	GateOutput    = "output"
)

// The gates only accept or reject a draft; none edits text.

// directives stay byte for byte; the prompt lists the same strings.
var directives = []string{
	"//go:build", "//go:generate", "//go:embed", "//nolint", "eslint-disable", "biome-ignore",
	"@ts-expect-error", "@ts-ignore", "/// <reference", "SPDX-License-Identifier", "Copyright",
}

// markers, longest first.
var markers = []string{"///", "//", "/**", "/*", "<!--", "#"}

var protectedTokens = []*regexp.Regexp{
	regexp.MustCompile("`[^`\n]+`"),
	regexp.MustCompile(`"[^"\n]{1,80}"`),
	regexp.MustCompile(`\b\d+(?:[.,:]\d+)*\b`),
	regexp.MustCompile(`\b[A-Za-z_]\w*(?:[./]\w+)+\b`),
	regexp.MustCompile(`\b[a-z][a-z0-9]*[A-Z]\w*\b`),
	regexp.MustCompile(`\b[A-Z][a-z0-9]+[A-Z]\w*\b`),
	regexp.MustCompile(`\b[A-Za-z0-9]+_\w+\b`),
}

// gateDraft returns the first gate that rejects the draft, or "" when every mechanical gate passes.
func gateDraft(input, draft string, dropped []DroppedSpan) string {
	switch {
	case utf8.RuneCountInString(draft) > utf8.RuneCountInString(input):
		return GateGrew
	case !formKept(input, draft):
		return GateForm
	case !indentKept(input, draft):
		return GateIndent
	case !widthKept(input, draft):
		return GateWidth
	case !directivesKept(input, draft):
		return GateDirective
	case !tokensKept(input, draft, dropped):
		return GateTokens
	}
	return ""
}

func splitLines(s string) []string { return strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n") }

func nonBlank(s string) []string {
	var out []string
	for _, l := range splitLines(s) {
		if strings.TrimSpace(l) != "" {
			out = append(out, l)
		}
	}
	return out
}

func formKept(input, draft string) bool {
	in, out := nonBlank(input), nonBlank(draft)
	if len(in) == 0 {
		return true
	}
	if len(out) == 0 {
		return false
	}
	first := strings.TrimLeft(in[0], " \t")
	marker := ""
	for _, m := range markers {
		if strings.HasPrefix(first, m) {
			marker = m
			break
		}
	}
	switch marker {
	case "":
		return true
	case "/**", "/*", "<!--":
		if !strings.HasPrefix(strings.TrimLeft(out[0], " \t"), marker) {
			return false
		}
		for _, closer := range []string{"*/", "-->"} {
			if strings.HasSuffix(strings.TrimRight(in[len(in)-1], " \t"), closer) &&
				!strings.HasSuffix(strings.TrimRight(out[len(out)-1], " \t"), closer) {
				return false
			}
		}
		return true
	}
	for _, l := range in {
		if !strings.HasPrefix(strings.TrimLeft(l, " \t"), marker) {
			return true
		}
	}
	for _, l := range out {
		if !strings.HasPrefix(strings.TrimLeft(l, " \t"), marker) {
			return false
		}
	}
	return true
}

func leading(l string) string { return l[:len(l)-len(strings.TrimLeft(l, " \t"))] }

func indentKept(input, draft string) bool {
	in, out := nonBlank(input), nonBlank(draft)
	if len(in) == 0 || len(out) == 0 {
		return true
	}
	if leading(in[0]) != leading(out[0]) {
		return false
	}
	set := map[string]bool{}
	for _, l := range in {
		set[leading(l)] = true
	}
	for _, l := range out {
		if !set[leading(l)] {
			return false
		}
	}
	return true
}

// columns counts a tab as 4.
func columns(l string) int {
	n := 0
	for _, r := range l {
		if r == '\t' {
			n += 4
		} else {
			n++
		}
	}
	return n
}

func widest(s string) int {
	w := 0
	for _, l := range splitLines(s) {
		w = max(w, columns(l))
	}
	return w
}

// widthKept never widens past the input's own widest line.
func widthKept(input, draft string) bool {
	return widest(draft) <= max(RewriteWidth, widest(input))
}

func directivesKept(input, draft string) bool {
	for _, l := range splitLines(input) {
		for _, d := range directives {
			if strings.Contains(l, d) {
				if !strings.Contains(draft, l) {
					return false
				}
				break
			}
		}
	}
	return true
}

func tokensKept(input, draft string, dropped []DroppedSpan) bool {
	for _, re := range protectedTokens {
		for _, tok := range re.FindAllString(input, -1) {
			if strings.Contains(draft, tok) {
				continue
			}
			excused := false
			for _, d := range dropped {
				if strings.Contains(d.Text, tok) {
					excused = true
					break
				}
			}
			if !excused {
				return false
			}
		}
	}
	return true
}
