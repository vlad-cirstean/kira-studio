package importer

import "regexp"

// needsRewrite decides only whether the model is called; it never edits text. It is broad on purpose: a
// false positive costs one call. A text with no tracking-label shape, no history word, no listed hedge
// and no over-width line has nothing the rewrite prompt drops, so the model would return it verbatim.
func needsRewrite(text string) bool {
	return labelShape.MatchString(text) || historyWord.MatchString(text) || hedgeWord.MatchString(text) ||
		widest(text) > RewriteWidth
}

// labelShape matches ID-like tokens (letters and digits, #123, a section sign), dotted versions,
// document references (.md) and
// tracking vocabulary.
var labelShape = regexp.MustCompile(`\b[A-Z]{1,5}-?\d+\b|#\d+|§|\bv\d+(?:\.\d+)+\b|\.md\b|(?i:\b(?:phase|round|iter(?:ation)?|milestone|finding|ticket|plan|spec|tracker)\b)`)

// historyWord matches the vocabulary of history narration.
var historyWord = regexp.MustCompile(`(?i)\b(?:previously|formerly|originally|no longer|until now|used to|was|were|now|old|legacy|renamed|moved|replaced|earlier|before|ago|instead)\b`)

// hedgeWord is the closed hedge list of the rewrite prompt; "just" is matched in any use.
var hedgeWord = regexp.MustCompile(`(?i)\b(?:really|basically|actually|simply|just)\b`)
