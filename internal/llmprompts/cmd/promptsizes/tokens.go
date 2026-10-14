package main

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	actionRe   = regexp.MustCompile(`\{\{.*?\}\}`)
	numberRe   = regexp.MustCompile(`\d+(?:\.\d+)?`)
	backtickRe = regexp.MustCompile("`[^`]+`")
	quotedRe   = regexp.MustCompile(`"[^"\n]+"`)
	identRe    = regexp.MustCompile(`[A-Za-z0-9]+(?:[_.][A-Za-z0-9]+)+|\b[a-z]+[A-Z][A-Za-z0-9]*\b`)
	negationRe = regexp.MustCompile(`(?i)\b(?:not|never|no|only|except)\b|n't\b`)
	wordRe     = regexp.MustCompile(`[A-Za-z_][A-Za-z0-9_]*`)
)

// lost lists the protected tokens of old that the new text dropped.
func lost(old, cur string, fields []string) []string {
	var out []string
	oa, na := actionRe.FindAllString(old, -1), actionRe.FindAllString(cur, -1)
	if strings.Join(oa, "\x00") != strings.Join(na, "\x00") {
		out = append(out, "actions "+strings.Join(oa, " ")+" changed to "+strings.Join(na, " "))
	}
	body := func(s string) string { return actionRe.ReplaceAllString(s, "") }
	ob, nb := body(old), body(cur)
	for _, re := range []*regexp.Regexp{numberRe, backtickRe, quotedRe, identRe} {
		for tok, n := range counts(re.FindAllString(ob, -1)) {
			if counts(re.FindAllString(nb, -1))[tok] < 1 && n > 0 {
				out = append(out, tok)
			}
		}
	}
	nw := counts(wordRe.FindAllString(nb, -1))
	ow := counts(wordRe.FindAllString(ob, -1))
	for _, f := range fields {
		if ow[f] > 0 && nw[f] == 0 {
			out = append(out, "field "+f)
		}
	}
	nn, on := counts(lowerAll(negationRe.FindAllString(nb, -1))), counts(lowerAll(negationRe.FindAllString(ob, -1)))
	for w, c := range on {
		if nn[w] < c {
			out = append(out, fmt.Sprintf("negation %q (%d to %d)", w, c, nn[w]))
		}
	}
	return out
}

func lowerAll(in []string) []string {
	for i := range in {
		in[i] = strings.ToLower(in[i])
	}
	return in
}

func counts(in []string) map[string]int {
	m := map[string]int{}
	for _, s := range in {
		m[s]++
	}
	return m
}
