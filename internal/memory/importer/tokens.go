package importer

import "unicode/utf8"

// EstimateTokens is ceil(runes / 3). Claude's tokenizer is not published; English averages near 4
// characters per token, so this over-counts and chunks land under budget, never over.
func EstimateTokens(s string) int { return (utf8.RuneCountInString(s) + 2) / 3 }
