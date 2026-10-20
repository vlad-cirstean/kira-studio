package importer

import "regexp"

// needsRewrite decides only whether the model is called; it never edits text. It is broad on purpose: a
// false positive costs one call, and a false negative needs a text with no tag shape, no listed filler
// word and no over-width line, which the rewrite prompt leaves byte for byte anyway ("Already clean").
func needsRewrite(text string) bool {
	return tagShape.MatchString(text) || fillerWord.MatchString(text) || widest(text) > RewriteWidth
}

// tagShape covers phase, plan and review tags (P107, M2, C5 §3.1, v1.8, iter2, "Part 2", "round 2"),
// plan-doc paths and review words.
var tagShape = regexp.MustCompile(`\b[A-Z]{1,2}\d+|§|docs/plans/|\bv\d+\.\d+|\biter\d|(?i:\bround \d|\bpart \d|\bfinding)`)

// fillerWord is the closed filler list of the rewrite prompt; "just" is matched in any use.
var fillerWord = regexp.MustCompile(`(?i)\b(?:really|basically|actually|simply|just)\b`)
