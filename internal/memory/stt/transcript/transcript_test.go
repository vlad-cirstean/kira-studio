package transcript

import "testing"

func words(ss ...string) []Word {
	out := make([]Word, len(ss))
	for i, s := range ss {
		out[i] = Word{Text: s}
	}
	return out
}

func TestTrackerAgreementIgnoresCaseAndPunctuationAndNeverShrinks(t *testing.T) {
	var tr Tracker
	if got := tr.Update(words("And", "so", "my")); got != 0 {
		t.Fatalf("first pass stable = %d, want 0", got)
	}
	if got := tr.Update(words("and", "so,", "my", "fellow")); got != 3 {
		t.Fatalf("stable = %d, want 3", got)
	}
	if got := tr.Update(words("And", "so", "me")); got != 3 {
		t.Fatalf("stable shrank to %d, want 3 kept", got)
	}
	if got := tr.Update(words("And", "so")); got != 2 {
		t.Fatalf("stable = %d, want clamp to 2", got)
	}
	tr.Reset()
	if got := tr.Update(words("hello")); got != 0 {
		t.Fatalf("stable after reset = %d, want 0", got)
	}
}

func TestMergeBoundaryRepeatJoinAndCasing(t *testing.T) {
	gloss := []string{"Postgres"}
	cases := []struct {
		name, committed string
		add             []Word
		want            string
	}{
		{"first chunk keeps case", "", words("Hello", "there."), "Hello there."},
		{"repeat dropped", "ask not what your", words("what", "your", "country", "can"), "ask not what your country can"},
		{"three word repeat", "a b c d", words("B", "c,", "d", "e"), "a b c d e"},
		{"lowercase mid sentence", "we deploy to", words("Production", "on", "Fridays."), "we deploy to production on Fridays."},
		{"capital kept after sentence", "Done.", words("Next", "step"), "Done. Next step"},
		{"I kept", "then", words("I'm", "done"), "then I'm done"},
		{"all caps kept", "we use", words("API", "keys"), "we use API keys"},
		{"glossary kept", "it runs on", words("Postgres", "16"), "it runs on Postgres 16"},
		{"whole chunk repeated", "see you", words("see", "you"), "see you"},
		{"tag only chunk", "see you", words("[BLANK_AUDIO]"), "see you"},
		{"multi word tag", "ok", words("(soft", "music)", "then", "go"), "ok then go"},
		{"unclosed tag stays", "ok", words("(maybe", "later"), "ok (maybe later"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := Merge(c.committed, c.add, gloss); got != c.want {
				t.Errorf("Merge = %q, want %q", got, c.want)
			}
		})
	}
}

func TestCleanEmptyHypothesis(t *testing.T) {
	if got := Clean(words("[BLANK_AUDIO]")); len(got) != 0 {
		t.Errorf("Clean = %v, want empty", got)
	}
	if got := Merge("", nil, nil); got != "" {
		t.Errorf("Merge of nothing = %q", got)
	}
}
