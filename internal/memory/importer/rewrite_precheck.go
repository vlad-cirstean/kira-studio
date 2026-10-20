package importer

import "regexp"

// needsRewrite decides only whether the model is called; it never edits text. It is broad on purpose: a
// false positive costs one call. A text with no tracking-label shape, no history word, no listed hedge
// and no over-width comment line has nothing the rewrite prompt drops, so the model would return it
// verbatim. Prose has no width rule.
func needsRewrite(text string) bool {
	// Phrases match across a line break and its comment marker ("used\n// to"); the copy is read, never kept.
	flat := lineBreak.ReplaceAllString(text, " ")
	return labelShape.MatchString(flat) || historyWord.MatchString(flat) || hedgeWord.MatchString(flat) ||
		(isCommentText(text) && widest(text) > RewriteWidth)
}

// labelShape matches ID-like tokens (letters and digits, #123, a section sign), dotted versions,
// document references (.md) and tracking vocabulary.
var labelShape = regexp.MustCompile(`\b[A-Z]{1,5}-?\d+\b|#\d+|§|\bv\d+(?:\.\d+)+\b|\.md\b|(?i:\b(?:phase|round|iter(?:ation)?|milestone|finding|ticket|plan|spec|tracker)\b)`)

// historyWord matches unambiguous narration only; common words (was, now, before) would send nearly
// every text to the model.
var historyWord = regexp.MustCompile(`(?i)\b(?:previously|formerly|originally|no longer|used to|renamed|moved from|replaced)\b`)

// hedgeWord is the closed hedge list of the rewrite prompt; "just" is matched in any use.
var hedgeWord = regexp.MustCompile(`(?i)\b(?:really|basically|actually|simply|just)\b`)
