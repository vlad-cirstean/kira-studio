package memory

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"unicode"
)

const maxMatchTerms = 32

var stopwords = map[string]struct{}{}

func init() {
	for _, w := range strings.Fields(`a an and are as at be but by for from has have he her his how i if in into is it
		its me my no not of on or our she so than that the their them then there these they this to us was we were
		what when where which who why will with you your`) {
		stopwords[w] = struct{}{}
	}
}

func splitTerms(s string) []string {
	return strings.FieldsFunc(strings.ToLower(s), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
}

// BuildMatch turns free text into an FTS5 MATCH expression that favours recall: every term is a
// quoted prefix term OR-ed together, plus the whole phrase so exact phrases rank first. User input
// never reaches the FTS5 parser as syntax. ok is false when no usable term remains.
func BuildMatch(query string) (match string, ok bool) {
	var all, kept []string
	seen := map[string]struct{}{}
	for _, t := range splitTerms(query) {
		if len([]rune(t)) < 2 {
			continue
		}
		if _, dup := seen[t]; dup {
			continue
		}
		seen[t] = struct{}{}
		all = append(all, t)
		if _, stop := stopwords[t]; !stop {
			kept = append(kept, t)
		}
	}
	if len(kept) == 0 {
		kept = all
	}
	if len(kept) == 0 {
		return "", false
	}
	if len(kept) > maxMatchTerms {
		kept = kept[:maxMatchTerms]
	}
	parts := make([]string, 0, len(kept)+1)
	for _, t := range kept {
		parts = append(parts, quote(t)+"*")
	}
	if len(kept) >= 2 {
		parts = append(parts, quote(strings.Join(kept, " ")))
	}
	return strings.Join(parts, " OR "), true
}

func quote(s string) string { return `"` + strings.ReplaceAll(s, `"`, `""`) + `"` }

func normalize(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(s)), " ")
}

func factHash(fact string) string {
	sum := sha256.Sum256([]byte(normalize(fact)))
	return hex.EncodeToString(sum[:])
}
