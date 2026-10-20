package importer

import (
	"regexp"
	"strings"
	"unicode"
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
	GateOutput    = "output"
	GateHedge     = "hedge"
)

// The gates only accept or reject a draft; none edits text.

// directives are tool directives and licence headers; a line holding one stays byte for byte.
var directives = []string{
	"//go:build", "//go:generate", "//go:embed", "//nolint", "eslint-disable", "biome-ignore",
	"@ts-expect-error", "@ts-ignore", "/// <reference", "SPDX-License-Identifier", "Copyright",
}

// markers, longest first.
var markers = []string{"///", "//", "/**", "/*", "<!--", "#"}

var backtickSpan = regexp.MustCompile("`[^`\n]+`")

// protectedTokens are matched on the input; quoted spans are paired by quotesOutsideBackticks.
var protectedTokens = []*regexp.Regexp{
	backtickSpan,
	regexp.MustCompile(`\b\d+(?:[.,:]\d+)*\b`),
	regexp.MustCompile(`\b[A-Za-z_]\w*(?:[./]\w+)+\b`),
	regexp.MustCompile(`\b[a-z][a-z0-9]*[A-Z]\w*\b`),
	regexp.MustCompile(`\b[A-Z][a-z0-9]+[A-Z]\w*\b`),
	regexp.MustCompile(`\b[A-Za-z0-9]+_\w+\b`),
}

// gateDraft returns the first gate that rejects the draft, or "" when every mechanical gate passes.
func gateDraft(input, draft string, dropped []DroppedSpan) string {
	if !isCommentText(input) {
		switch {
		case utf8.RuneCountInString(draft) > utf8.RuneCountInString(input):
			return GateGrew
		case !proseKept(input, draft):
			return GateForm
		case !tokensKept(input, draft, dropped):
			return GateTokens
		}
		return ""
	}
	switch {
	case utf8.RuneCountInString(draft) > utf8.RuneCountInString(input)+reflowAllowance(input, draft):
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
	if strings.HasSuffix(input, "\n") != strings.HasSuffix(draft, "\n") {
		return false
	}
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

// widthKept rejects a changed draft that keeps any line over the width, an inherited over-width line included.
func widthKept(_, draft string) bool {
	return widest(draft) <= RewriteWidth
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

// reflowAllowance is what a reflow of an over-width input may add: each extra line costs about twice its prefix
// (indent and marker). It applies only when the draft fixes the width.
func reflowAllowance(input, draft string) int {
	if widest(input) <= RewriteWidth || widest(draft) > RewriteWidth {
		return 0
	}
	in, out := nonBlank(input), nonBlank(draft)
	if len(out) <= len(in) {
		return 0
	}
	prefix := 0
	for _, r := range out[0] {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			break
		}
		prefix++
	}
	return (len(out) - len(in)) * 2 * prefix
}

// quotesOutsideBackticks returns the double-quoted spans of s, paired in order per line, ignoring
// quote characters inside backtick spans. A span holding backticks is returned without them.
func quotesOutsideBackticks(s string) []string {
	var spans []string
	for _, l := range splitLines(s) {
		raw := l
		l = backtickSpan.ReplaceAllStringFunc(l, func(m string) string { return strings.Repeat(" ", len(m)) })
		var at []int
		for i := 0; i < len(l); i++ {
			if l[i] == '"' {
				at = append(at, i)
			}
		}
		for k := 0; k+1 < len(at); k += 2 {
			if n := at[k+1] - at[k] - 1; n >= 1 && n <= 80 {
				spans = append(spans, strings.ReplaceAll(raw[at[k]:at[k+1]+1], "`", ""))
			}
		}
	}
	return spans
}

var lineBreak = regexp.MustCompile(`[ \t]*\n[ \t]*(?:///?|\*|#|<!--)?[ \t]*`)

// tokensKept requires every protected token of the input in the draft, unless a dropped span holds it.
// A path token is checked per component, so a dropped tag joined to it does not kill the rest. The
// draft is also read with its line breaks and comment markers joined, so a reflow cannot split a token.
func tokensKept(input, draft string, dropped []DroppedSpan) bool {
	forms := []string{draft, lineBreak.ReplaceAllString(draft, ""), lineBreak.ReplaceAllString(draft, " ")}
	present := tokenPresence(forms, dropped)
	return protectedTokensKept(input, present) && quotedSpansKept(input, forms, present)
}

// tokenPresence reports whether a token sits in any draft form or any dropped span.
func tokenPresence(forms []string, dropped []DroppedSpan) func(string) bool {
	return func(tok string) bool {
		for _, f := range forms {
			if strings.Contains(f, tok) {
				return true
			}
		}
		for _, d := range dropped {
			if strings.Contains(d.Text, tok) {
				return true
			}
		}
		return false
	}
}

// protectedTokensKept checks every protected token of input; a path token is checked per component.
func protectedTokensKept(input string, present func(string) bool) bool {
	for _, re := range protectedTokens {
		for _, tok := range re.FindAllString(input, -1) {
			if !tokenKept(tok, present) {
				return false
			}
		}
	}
	return true
}

func tokenKept(tok string, present func(string) bool) bool {
	if !strings.Contains(tok, "/") || strings.HasPrefix(tok, "`") {
		return present(tok)
	}
	for _, part := range strings.Split(tok, "/") {
		if part != "" && !present(part) {
			return false
		}
	}
	return true
}

// quotedSpansKept checks every double-quoted span of input, ignoring backticks in the draft forms.
func quotedSpansKept(input string, forms []string, present func(string) bool) bool {
	for _, tok := range quotesOutsideBackticks(input) {
		found := false
		for _, f := range forms {
			if strings.Contains(strings.ReplaceAll(f, "`", ""), tok) {
				found = true
				break
			}
		}
		if !found && !present(tok) {
			return false
		}
	}
	return true
}

// isCommentText tells a code comment from prose: its first line opens with a comment marker, or every
// non-blank line starts with "#".
func isCommentText(s string) bool {
	in := nonBlank(s)
	if len(in) == 0 {
		return false
	}
	first := strings.TrimLeft(in[0], " \t")
	for _, m := range markers {
		if !strings.HasPrefix(first, m) {
			continue
		}
		if m != "#" {
			return true
		}
		for _, l := range in {
			if !strings.HasPrefix(strings.TrimLeft(l, " \t"), "#") {
				return false
			}
		}
		return true
	}
	return false
}

var hedgeToken = regexp.MustCompile(`(?i)^(?:really|basically|actually|simply|just)\W*$`)

// proseKept accepts a prose draft that is the input with only listed hedge words removed: same line
// structure, no reflow, no other word gone.
func proseKept(input, draft string) bool {
	in, out := splitLines(input), splitLines(draft)
	if len(in) != len(out) {
		return false
	}
	for i := range in {
		if strings.TrimSpace(in[i]) == "" != (strings.TrimSpace(out[i]) == "") {
			return false
		}
		if leading(in[i]) != leading(out[i]) {
			return false
		}
		want := strings.Fields(out[i])
		k := 0
		for _, w := range strings.Fields(in[i]) {
			switch {
			case k < len(want) && strings.EqualFold(w, want[k]):
				k++
			case hedgeToken.MatchString(w):
			default:
				return false
			}
		}
		if k != len(want) {
			return false
		}
	}
	return true
}

var hedgeWord = regexp.MustCompile(`(?i)\b(?:really|basically|actually|simply)\b`)

// quotedSpan matches a double-quoted span of up to 80 runes per line, wrapped across at most one line break.
var quotedSpan = regexp.MustCompile(`"(?:[^"\n]{1,80}|[^"\n]{0,80}\n[^"\n]{0,80})"`)

// hedgeLeft reports whether text still holds an unambiguous hedge word outside backtick code and
// double-quoted spans; the prompt requires every such word gone.
func hedgeLeft(text string) bool {
	lines := splitLines(text)
	for i, l := range lines {
		lines[i] = backtickSpan.ReplaceAllString(l, " ")
	}
	return hedgeWord.MatchString(quotedSpan.ReplaceAllString(strings.Join(lines, "\n"), " "))
}
