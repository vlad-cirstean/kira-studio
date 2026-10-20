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
