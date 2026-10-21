package importer

import "testing"

func TestHedgeLeftQuoteMask(t *testing.T) {
	cases := []struct {
		name, text string
		want       bool
	}{
		{"bare", "this is really fine", true},
		{"quoted", `the flag "really on" stays`, false},
		{"wrapped quote", "the flag \"really\non\" stays", false},
		{"backtick", "use `actually` here", false},
		{"hedge after wrapped quote", "say \"a\nb\" and basically go", true},
		{"unclosed quote not masked", "say \"a\nb simply c\nd", true},
		{"quote over two breaks not masked", "\"a\nb\nreally\"", true},
	}
	for _, c := range cases {
		if got := hedgeLeft(c.text); got != c.want {
			t.Errorf("%s: hedgeLeft = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestProseKeptHedgePunctuation(t *testing.T) {
	cases := []struct {
		name, in, draft string
		want            bool
	}{
		{"hedge dropped", "It is really fast.", "It is fast.", true},
		{"final hedge moves the period", "It is fast, really.", "It is fast.", true},
		{"dangling comma rejected", "It is fast, really.", "It is fast,", false},
		{"old punctuation kept rejected", "It is fast, really.", "It is fast,.", false},
		{"mid hedge keeps the comma", "It is, really, fast.", "It is, fast.", true},
		{"leading hedge", "Really, it is fast.", "it is fast.", true},
		{"hedge kept", "It is fast, really.", "It is fast, really.", true},
		{"other word gone", "It is fast, really.", "It fast.", false},
	}
	for _, c := range cases {
		if got := proseKept(c.in, c.draft); got != c.want {
			t.Errorf("%s: proseKept = %v, want %v", c.name, got, c.want)
		}
	}
}
