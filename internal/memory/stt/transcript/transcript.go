// Package transcript turns repeated whisper hypotheses into stable dictation text: word agreement
// between passes, removal of silence tags, and merging a decoded chunk into the committed text.
// Pure Go, no cgo.
package transcript

import (
	"strings"
	"unicode"
)

// Word is one decoded word. EndMS is its end time relative to the start of the decoded audio.
type Word struct {
	Text  string
	EndMS int
}

// Normalize lowercases w and strips punctuation from both edges, so "Hello," and "hello" agree.
func Normalize(w string) string {
	w = strings.ToLower(w)
	return strings.TrimFunc(w, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
}

// Tracker finds the words two consecutive hypotheses agree on (LocalAgreement-2).
type Tracker struct {
	prev   []string
	stable int
}

// Reset starts a new segment.
func (t *Tracker) Reset() { t.prev, t.stable = nil, 0 }

// Stable is the current stable word count.
func (t *Tracker) Stable() int { return t.stable }

// Update records the latest hypothesis and returns how many leading words are stable: the longest
// common prefix, by normalised word, of the previous and current hypothesis. The count never
// shrinks within a segment, though it is clamped to the hypothesis length.
func (t *Tracker) Update(words []Word) int {
	cur := make([]string, len(words))
	for i, w := range words {
		cur[i] = Normalize(w.Text)
	}
	n := 0
	for n < len(cur) && n < len(t.prev) && cur[n] == t.prev[n] {
		n++
	}
	t.stable = max(t.stable, n)
	t.prev = cur
	return min(t.stable, len(cur))
}

const maxTagWords = 6

// Clean drops silence and sound tags such as "[BLANK_AUDIO]", "(soft music)" and "*clears throat*".
// An opening mark with no closing one within maxTagWords stays, since it is probably real text.
func Clean(words []Word) []Word {
	out := make([]Word, 0, len(words))
	for i := 0; i < len(words); i++ {
		closer := tagCloser(words[i].Text)
		if closer == "" {
			out = append(out, words[i])
			continue
		}
		end := -1
		for j := i; j < len(words) && j < i+maxTagWords; j++ {
			t := strings.TrimRight(words[j].Text, ".,!?")
			if strings.HasSuffix(t, closer) && (j > i || len(t) > 1) {
				end = j
				break
			}
		}
		if end < 0 {
			out = append(out, words[i])
			continue
		}
		i = end
	}
	return out
}

func tagCloser(w string) string {
	switch {
	case strings.HasPrefix(w, "["):
		return "]"
	case strings.HasPrefix(w, "("):
		return ")"
	case strings.HasPrefix(w, "*"):
		return "*"
	}
	return ""
}

// Text joins words with single spaces.
func Text(words []Word) string {
	parts := make([]string, len(words))
	for i, w := range words {
		parts[i] = w.Text
	}
	return strings.Join(parts, " ")
}

const maxRepeat = 3

// Merge appends a decoded chunk to the committed text. It drops a leading run of up to maxRepeat
// words that repeats the committed tail (chunk boundaries re-decode a word or two), joins with one
// space, and lowercases the chunk's first word when committed does not end a sentence, unless the
// word is all caps, "I" or one of the glossary terms.
func Merge(committed string, words []Word, glossary []string) string {
	words = Clean(words)
	tail := strings.Fields(committed)
	for k := min(maxRepeat, len(words), len(tail)); k > 0; k-- {
		if sameWords(words[:k], tail[len(tail)-k:]) {
			words = words[k:]
			break
		}
	}
	if len(words) == 0 {
		return committed
	}
	parts := make([]string, len(words))
	for i, w := range words {
		parts[i] = w.Text
	}
	if committed == "" {
		return strings.Join(parts, " ")
	}
	if !endsSentence(committed) && shouldLower(parts[0], glossary) {
		parts[0] = lowerFirst(parts[0])
	}
	return committed + " " + strings.Join(parts, " ")
}

func sameWords(words []Word, tail []string) bool {
	for i := range words {
		a := Normalize(words[i].Text)
		if a == "" || a != Normalize(tail[i]) {
			return false
		}
	}
	return true
}

func endsSentence(s string) bool {
	s = strings.TrimRight(s, " \"')]”’")
	return strings.HasSuffix(s, ".") || strings.HasSuffix(s, "?") || strings.HasSuffix(s, "!")
}

func shouldLower(w string, glossary []string) bool {
	core := strings.TrimFunc(w, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
	if core == "" || core == "I" || strings.HasPrefix(w, "I'") || strings.HasPrefix(w, "I’") {
		return false
	}
	if len([]rune(core)) > 1 && core == strings.ToUpper(core) {
		return false
	}
	norm := strings.ToLower(core)
	for _, g := range glossary {
		if strings.EqualFold(g, norm) {
			return false
		}
	}
	return true
}

func lowerFirst(w string) string {
	for i, r := range w {
		if unicode.IsLetter(r) {
			return w[:i] + string(unicode.ToLower(r)) + w[i+len(string(r)):]
		}
	}
	return w
}
